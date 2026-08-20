import fs from 'node:fs';
import path from 'node:path';
import { Player } from '../db/entities/player.js';
import { findOrCreateCoach } from '../lib/coaches.js';
import { createOutreach, markOutreachSent } from '../lib/outreach.js';
import { composeInOutlook, isOutlookAvailable } from '../lib/outlook.js';
import { PUBLIC_BASE_URL, isPubliclyReachable, OUTLOOK_FROM_ADDRESS } from '../lib/config.js';
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
  return `${filled.trimEnd()}\n\nProfile and highlight film:\n${url}\n`;
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
      );

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
