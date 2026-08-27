import fs from 'node:fs';
import path from 'node:path';
import { Player } from '../db/entities/player.js';
import { findOrCreateCoach } from '../lib/coaches.js';
import { isSuppressed } from '../lib/suppressions.js';
import { isSendCapped, recentSendCount } from '../lib/sendCap.js';
import { createOutreach, markOutreachSent } from '../lib/outreach.js';
import { composeInOutlook, isOutlookAvailable } from '../lib/outlook.js';
import { PUBLIC_BASE_URL, isPubliclyReachable, OUTLOOK_FROM_ADDRESS, complianceGaps, SENDER_IDENTITY, SENDER_POSTAL_ADDRESS } from '../lib/config.js';
import { checkRequiredCore } from '../export/renderProfile.js';
import { exportAthlete, OUTPUT_DIR } from '../export/exportProfiles.js';

/**
 * Creates outreach and hands one message per coach to Outlook.
 *
 * One email per coach, not one email CC'd to a staff, because attribution is
 * per (athlete, coach) pair: a shared link would credit every coach's viewing
 * to whoever happened to be in the To field, and leave the rest looking like
 * they never opened it.
 */

/** Swaps the greeting the composer pre-filled for this coach's name. */
function personalise(text, fromName, toName) {
  if (!fromName || fromName === toName) return text;
  const escaped = fromName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`Dear\\s+${escaped},`, 'i'), `Dear ${toName},`);
}

/**
 * Guarantees the tracked link is in the body. Templates written before
 * tracking existed have no {{player_profile_url}}, and an email without the
 * link is an email we learn nothing from.
 */
function ensureProfileLink(body, url) {
  if (body.includes(url)) return body;
  const filled = body.replace(/\{\{\s*player_profile_url\s*\}\}/g, url);
  if (filled.includes(url)) return filled;
  return `${filled.trimEnd()}\n\nProfile and highlight film:\n${url}\n`;   // blank line above: its own paragraph
}

/**
 * The compliance footer, appended at send time rather than offered as a
 * template variable.
 *
 * CAN-SPAM §7704(a)(5) wants three things in every commercial message: who it
 * is from, a valid physical postal address, and a working way to opt out.
 * Recruiting outreach to a coach's work address is commercial mail whether it
 * leaves through an ESP or through Outlook, so none of it is optional here.
 *
 * Not a `{{token}}` on purpose. An operator editing a template can delete a
 * token without noticing what it was for, and the resulting message is
 * unlawful rather than merely worse. This is concatenated after whatever they
 * wrote, every time, and `sendOutreach` refuses to run at all when the pieces
 * are unset.
 */
/**
 * The opt-out, as a reply rather than a link.
 *
 * A long unsubscribe URL is the clearest "this is bulk mail" signal in the
 * message, which is the one thing a first-touch email to a coach cannot
 * afford to look like. A reply-to address is an accepted unsubscribe facility
 * under both CAN-SPAM §7704(a)(3) and the NZ Unsolicited Electronic Messages
 * Act, so this stays compliant and reads like a person wrote it.
 *
 * The obligation moves rather than disappearing: opt-outs now arrive as email
 * and someone has to action them, within ten business days under CAN-SPAM.
 * `npm run suppress -- coach@example.edu` is that action, and the suppression
 * it writes is what stops every future athlete reaching them.
 *
 * The `/u/<token>` endpoint stays live. Emails already sent carry those links
 * and they must keep working — an opt-out that stops working is worse than
 * one that was never offered.
 */
const OPT_OUT_SENTENCE = "If you'd rather not hear from us, just reply and we'll take you off our list.";

function complianceFooter({ athleteName }) {
  // Two blank lines, not one. The body is rendered as HTML at compose time,
  // where a blank line starts a new paragraph and a single newline is only a
  // line break — with one, the footer ran straight on from the sign-off.
  return [
    '',
    '',
    '—',
    `Sent by ${SENDER_IDENTITY} on behalf of ${athleteName}.`,
    SENDER_POSTAL_ADDRESS,
    OPT_OUT_SENTENCE,
  ].join('\n');
}

/** The page has to exist before the link is worth sending. */
function ensureExported(athlete) {
  const file = path.join(OUTPUT_DIR, 'p', `${athlete.public_slug}.html`);
  if (!fs.existsSync(file)) exportAthlete(athlete);
}

export async function sendOutreach({
  athleteId, coaches = [], subject, body, greetingName,
  collegeName, division, matchId = null, send = false,
}) {
  const athlete = Player.get(athleteId);
  if (!athlete) throw new Error('Unknown athlete');
  if (!isOutlookAvailable()) throw new Error('Outlook automation is only available on macOS');

  // Checked before anything is composed, not per coach: a run that mails half
  // a list and then discovers it has no postal address has already broken the
  // law nineteen times.
  const gaps = complianceGaps();
  if (gaps.length) {
    throw new Error(
      `Cannot send: the compliance footer is not configured — missing ${gaps.join(', ')}. `
      + 'Every commercial email needs a sender identity, a physical postal address and a working opt-out link.'
    );
  }

  const missing = checkRequiredCore(athlete);
  if (missing.length) {
    throw new Error(
      `${athlete.full_name}'s profile page cannot be generated yet — missing ${missing.join(', ')}. `
      + 'Sending would put a dead link in front of a coach.'
    );
  }
  ensureExported(athlete);

  const results = [];
  let actualFrom = null;
  let fromMismatch = false;

  for (const coach of coaches) {
    try {
      // The one check that must not be skippable. Enforced here rather than
      // where the list is built, because every path to a send goes through
      // this loop and only some of them go through a list builder.
      if (isSuppressed(coach.email)) {
        results.push({ email: coach.email, name: coach.name, status: 'suppressed' });
        continue;
      }

      // Volume is experienced per inbox, not per athlete, and so is the spam
      // filter's view of it. Checked here for the same reason as suppression:
      // this loop is the only thing every send passes through.
      if (send && isSendCapped(coach.email)) {
        results.push({
          email: coach.email, name: coach.name, status: 'rate-capped',
          recentSends: recentSendCount(coach.email),
        });
        continue;
      }

      const record = findOrCreateCoach({
        full_name: coach.name,
        email: coach.email,
        school: collegeName,
        division,
        sport: athlete.sport,
        position_title: coach.title,
      });

      const outreach = createOutreach({ athleteId, coachId: record.id, matchId });
      const url = `${PUBLIC_BASE_URL}/p/${athlete.public_slug}.html?ref=${outreach.token}`;

      const personalisedBody = ensureProfileLink(
        personalise(body, greetingName, coach.name || 'Coach'),
        url
      ) + complianceFooter({ athleteName: athlete.full_name });

      const outcome = await composeInOutlook({
        to: coach.email,
        subject: personalise(subject, greetingName, coach.name || 'Coach'),
        body: personalisedBody,
        send,
      });
      if (outcome.from) actualFrom = outcome.from;
      if (outcome.fromMatches === false) fromMismatch = true;

      // Records that the message was handed to Outlook. Whether the user then
      // presses Send in Outlook is outside what we can observe.
      markOutreachSent(outreach.id);
      results.push({ email: coach.email, name: coach.name, status: send ? 'sent' : 'drafted', url });
    } catch (err) {
      results.push({ email: coach.email, name: coach.name, status: 'error', error: err.message });
    }
  }

  return {
    results,
    baseUrl: PUBLIC_BASE_URL,
    reachable: isPubliclyReachable(),
    from: { requested: OUTLOOK_FROM_ADDRESS, actual: actualFrom, mismatch: fromMismatch },
  };
}
