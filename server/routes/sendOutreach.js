import fs from 'node:fs';
import path from 'node:path';
import { Player } from '../db/entities/player.js';
import { findOrCreateCoach } from '../lib/coaches.js';
import { isSuppressed } from '../lib/suppressions.js';
import { isSendCapped, recentSendCount } from '../lib/sendCap.js';
import { createOutreach, markOutreachDrafted, markOutreachSent } from '../lib/outreach.js';
import { logEvidence } from '../lib/evidenceLog.js';
import { recordDraft, confirmSend } from '../lib/outreachSend.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';
import { campaignContactDecision } from '../lib/campaignAttribution.js';
import { assertContactAllowed } from '../lib/manualOutreachSafety.js';
import { normaliseOrigin } from '../../shared/outreachOrigin.js';
import { recordOutboundAttempt, TRANSPORT } from '../lib/outboundBudget.js';
import { evidenceFor } from '../lib/evidenceQueries.js';
import { templateVariant } from '../../shared/evidence/templateVariant.js';
import { BODY_SOURCE } from '../../src/lib/emailTemplate.js';
import { DEFAULT_EMAIL_TEMPLATE } from '../../src/lib/emailTemplate.js';
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

/**
 * @param {object} [args.evidence]  the `selectEvidence()` result behind this
 *   message. Callers that already computed it — the drafting CLI — pass it so
 *   the logged row is the one they actually rendered. Callers that did not
 *   get it computed here from `athleteId` and `collegeName`.
 *
 *   Never taken from an HTTP body. The browser composer receives rendered
 *   prose and flat metadata from `/api/players/:id/evidence`, not evidence
 *   objects, so it has nothing to post back; deriving it here also means the
 *   log records what the database supports rather than what a long-open tab
 *   was holding.
 */
/**
 * @param {string|null} [args.programmeCampaignId]  the programme campaign this
 *   message is being sent under, when there is one.
 *
 *   OPTIONAL, AND NOTHING INFERS IT. A manual send has no campaign and records
 *   NULL, which is the honest answer. When it is given it is validated against
 *   the athlete and the coach's programme before anything is written, and it is
 *   passed to BOTH writes for different reasons: `createOutreach` records it as
 *   the relationship's first-created provenance and only if the relationship is
 *   new, while `recordDraft` records it on the message itself, every time. The
 *   second is the authoritative one.
 */
export async function sendOutreach({
  athleteId, coaches = [], subject, body, greetingName,
  collegeName, division, matchId = null, send = false, evidence = null,
  evidenceSelection = null, evidenceStructure = null, bodySource = null,
  programmeCampaignId = null,
}, {
  /**
   * WHAT KIND OF ACTION THIS IS — A SECOND ARGUMENT, AND THAT IS THE POINT.
   *
   * `/api/outreach/send` passes `req.body` straight into the first parameter,
   * so anything named there is client-supplied by construction. Origin is a
   * claim about WHO IS ACTING, and a claim about who is acting that the actor
   * writes themselves is not a claim worth recording — still less one worth
   * making a safety decision on later. It therefore lives in a context object
   * that only a route handler builds, and no spread of a request body can
   * reach it.
   *
   * Null when a caller says nothing, which is the honest record of the legacy
   * composer path: it is neither a campaign send nor the relationship-scoped
   * manual workflow, and labelling it either would invent a fact.
   */
  origin = null,
} = {}) {
  /**
   * VALIDATED HERE, NOT WHERE IT IS WRITTEN.
   *
   * `recordDraft` normalises it too, but that runs inside the per-coach loop
   * where a throw is caught and recorded as one coach's failure. An origin
   * this code does not recognise is a caller bug about the whole run, so it
   * stops the whole run — before anything is composed, drafted or written.
   */
  const resolvedOrigin = normaliseOrigin(origin);

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

  /**
   * THE RELATIONSHIP GATE, BEFORE ANYTHING IS COMPOSED OR WRITTEN.
   *
   * `contact_stance` is a per-athlete, per-programme decision and this is the
   * only place every send path passes through, so it is checked here rather
   * than in the manual route that prompted it. A rule that only holds on the
   * screen that shows it is not a rule — an operator reaching this endpoint
   * from the match-card composer, a script, or a stale tab gets the same
   * refusal, and the client cannot soften it by saying otherwise in the body
   * because nothing here reads a stance the caller supplied.
   *
   * ONE PROGRAMME PER CALL, so this is a fact about the whole run like the
   * compliance check above, not a per-coach one.
   *
   * `visibility`, `flagged` and `request_state` are NOT consulted — see
   * server/lib/manualOutreachSafety.js for why each of them would be wrong.
   */
  /**
   * BOUND TO THE RECIPIENTS, NOT TO THE LABEL. `collegeName` and every address
   * below arrive from the caller on the shared endpoint, and
   * `findOrCreateCoach` would happily mint a coach row for a School A address
   * under a School B label — so a stance resolved from the label alone could
   * be a stance on a school nobody was writing to. See programmesReachedBy.
   */
  assertContactAllowed({
    athleteId,
    collegeName,
    sport: athlete.sport,
    coachEmails: coaches.map((c) => c && c.email).filter(Boolean),
  });

  /**
   * THE CAMPAIGN GATE, ONCE, BEFORE THE LOOP.
   *
   * Every coach in one call is at the same programme, so a stopped programme
   * or an inactive campaign is a fact about the whole run — evaluating it per
   * coach would print the same refusal twenty times and leave the operator to
   * work out that it was one problem. It is checked here against the first
   * coach whose identity resolves, and the run stops rather than half-running.
   *
   * THIS IS A COURTESY, NOT THE GUARANTEE. The authoritative gate is inside
   * `createOutreach` and `recordDraft`, which are the only two functions that
   * write a campaign-attributed row — so a future execution engine that skips
   * this endpoint entirely still cannot get past it. Coach-specific facts —
   * suppression, the per-inbox cap, revocation — stay in the loop, because
   * they differ per coach.
   */
  if (programmeCampaignId) {
    const first = coaches.find((c) => c && c.email);
    if (first) {
      const record = findOrCreateCoach({
        full_name: first.name, email: first.email, school: collegeName,
        division, sport: athlete.sport, position_title: first.title,
      });
      const decision = campaignContactDecision({
        programmeCampaignId, athleteId, coachId: record.id,
      });
      if (!decision.allowed && decision.reason !== 'SUPPRESSED') {
        const err = new Error(
          `Cannot send for this campaign: ${decision.reason}. `
          + 'Nothing was drafted.',
        );
        err.code = decision.reason;
        throw err;
      }
    }
  }

  const missing = checkRequiredCore(athlete);
  if (missing.length) {
    throw new Error(
      `${athlete.full_name}'s profile page cannot be generated yet — missing ${missing.join(', ')}. `
      + 'Sending would put a dead link in front of a coach.'
    );
  }
  ensureExported(athlete);

  // Derived here when the caller did not bring it, so the browser composer
  // logs the same evidence the CLI does without having to post facts back.
  // A failure to work it out must not stop a send — it is analysis, not
  // delivery — so it degrades to logging nothing.
  //
  // `evidenceSelection` is a list of evidence KINDS, never evidence. The engine
  // validates each against what it generated for this pairing, so an operator
  // override can change which true thing is said and cannot introduce an
  // untrue one, promote a SIGNAL, or reach a kind that failed its confidence
  // floor. An unrecognised kind is dropped, not honoured.
  let evidenceUsed = evidence;
  if (!evidenceUsed && collegeName) {
    try {
      evidenceUsed = evidenceFor(athlete, collegeName, {
        sport: athlete.sport,
        prefer: Array.isArray(evidenceSelection) ? evidenceSelection : null,
        // The structure the composer showed, revalidated here against the
        // server's own selection. An ineligible or unknown key is refused and
        // recorded rather than honoured — see resolveStructure — so a stale
        // tab cannot open an email on a relationship the evidence lost.
        preferStructure: typeof evidenceStructure === 'string' ? evidenceStructure : null,
      });
    } catch (err) {
      console.warn(`  could not derive evidence for ${collegeName}: ${err.message}`);
    }
  }

  // Which template shape rendered this email — a different variable from the
  // engine's `structure`, so a later A/B can separate the two.
  const variant = templateVariant(athlete.email_template);

  /**
   * Did the evidence sentence actually survive into what was sent?
   *
   * The composer hands the operator an editable body, and deleting the
   * programme sentence is a reasonable thing to do. Logging the evidence
   * regardless would then attribute a reply to a claim the coach never read,
   * which is precisely the measurement error this table exists to avoid.
   * Checked against the first selected sentence rather than the whole
   * paragraph, so light editing still counts as carried.
   */
  const haystack = String(body || '').toLowerCase();
  const sentences = evidenceUsed?.sentences ?? [];
  /**
   * Which claims survived, item by item.
   *
   * Per ITEM rather than per email, and that distinction is the reason this
   * changed with multi-evidence: an operator who keeps the opening sentence
   * and deletes the supporting paragraph has delivered one claim of three.
   * Counting the email as "evidence rendered" would credit all three angles
   * with whatever reply it earned, which is the measurement error the whole
   * table exists to prevent, scaled up by the number of angles.
   */
  const renderedKinds = sentences.length
    ? new Set(sentences.filter((s) => haystack.includes(String(s.text).toLowerCase()))
      .map((s) => s.kind))
    : null;
  // The lead item, which is what this column has always meant. Kept on that
  // definition so rows written before multi-evidence remain comparable.
  const firstSentence = sentences[0]?.text ?? null;
  const evidenceRendered = firstSentence
    ? haystack.includes(firstSentence.toLowerCase())
    : null;

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

      const outreach = createOutreach({ athleteId, coachId: record.id, matchId, programmeCampaignId });

      /**
       * A REVOKED OUTREACH RECORD IS NOT WRITEABLE THROUGH, on any path.
       *
       * Revocation withdraws the athlete's public page for ONE COACH: that
       * outreach record's token stops resolving. `campaignAttribution` has
       * refused a revoked outreach record since B1 — but only for
       * campaign-attributed sends, so a manual or recommendation send through
       * one composed happily and put a deliberately dead link in front of a
       * coach. The campaign path already calls that OUTREACH_REVOKED; this is
       * the same refusal for everything else.
       *
       * IT IS A FACT ABOUT ONE ATHLETE-COACH PAIR AND NOTHING WIDER. It is not
       * a programme-level block, and it says nothing about
       * `athlete_programmes` — not its contact stance, its visibility, its flag
       * or its request state. Another coach at the same school in the same call
       * is unaffected, which is why this skips rather than failing the run.
       *
       * Checked AFTER `createOutreach` because that function returns an
       * existing record untouched — nothing is written for one that already
       * exists. Un-revoking is its own deliberate act; nothing here clears it.
       */
      if (outreach.revoked_at) {
        results.push({
          email: coach.email,
          name: coach.name,
          status: 'revoked',
          /**
           * SAID OUT LOUD, because a skipped coach is otherwise a row with no
           * tick and no cross. `reason` is the machine-readable code the
           * campaign path already uses for this; `message` is what a person
           * reads. The other guards in this loop are deliberately left as they
           * were — widening their shape is not this change's business.
           */
          reason: 'OUTREACH_REVOKED',
          message: 'Outreach to this coach was revoked, so their tracking link no longer '
            + 'resolves. Nothing was drafted or sent.',
        });
        continue;
      }

      /**
       * THE SEQUENCE IS PER COACH, SO THE EVIDENCE IS TOO.
       *
       * `evidenceUsed` above is derived once for the whole run, which is right
       * while every coach at a programme gets the same email. Under a campaign
       * they do not: the head coach may be on their follow-up while the
       * assistant has never been written to, and one shared evidence result
       * would store the head coach's follow-up reasoning against the
       * assistant's first approach.
       *
       * Re-derived ONLY when a campaign is attributed, so the manual and
       * legacy paths cost nothing and behave identically. Best-effort like
       * every other analysis step here: a failure to work out the sequence
       * must not stop an email, so it falls back to the run-level result.
       */
      let coachEvidence = evidenceUsed;
      if (programmeCampaignId && collegeName) {
        try {
          coachEvidence = evidenceFor(athlete, collegeName, {
            sport: athlete.sport,
            prefer: Array.isArray(evidenceSelection) ? evidenceSelection : null,
            preferStructure: typeof evidenceStructure === 'string' ? evidenceStructure : null,
            programmeCampaignId,
            coachId: record.id,
          });
        } catch (err) {
          console.warn(`  could not derive the sequence for ${coach.email}: ${err.message}`);
        }
      }

      /**
       * THE OUTBOUND ACTION BUDGET, SPENT BEFORE THE TRANSPORT AND NEVER AFTER.
       *
       * Only when something is actually being SENT. `send: false` opens a
       * draft window and hands nothing to a provider, so it costs nothing —
       * an operator may draft a whole Top 100 for review without spending a
       * day's capacity on messages nobody has decided to send.
       *
       * LAST OF THE FOUR SAFETY CHECKS, and the order is deliberate: the
       * campaign gate, suppression and the per-inbox cap all refuse above this
       * line, so a message that was never permitted never spends budget.
       * Everything after this line is the attempt itself.
       *
       * The refusal ends this coach and not the run. A campaign that has used
       * its day should record nineteen sends and one refusal, not lose the
       * nineteen — and the operator needs to see which coach to pick up
       * tomorrow.
       */
      if (send) {
        try {
          recordOutboundAttempt({
            outreachId: outreach.id,
            // An assertion, checked against the relationship rather than
            // trusted: the athlete whose budget this spends is derived.
            athleteId,
            // The mailbox we are ASKING to send from. Outlook reports which
            // account it actually used only after the compose returns, so the
            // requested identity is the only one available before the spend —
            // see the mismatch reported at the end of this function.
            sendingIdentity: OUTLOOK_FROM_ADDRESS,
            transport: TRANSPORT.OUTLOOK_APPLESCRIPT,
          });
        } catch (err) {
          results.push({
            email: coach.email, name: coach.name, status: 'budget-refused',
            reason: err.code, error: err.message,
          });
          continue;
        }
      }
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

      /**
       * Drafted always; SENT only when something actually sent it.
       *
       * `send: true` means the AppleScript issued Outlook's own Send, which is
       * a confirmation we observe rather than infer. `send: false` opens a
       * draft window and nothing more, and whether the operator later presses
       * Send is outside what we can see — so it stays unconfirmed until they
       * say so through `npm run confirm-sends`.
       *
       * This line used to call `markOutreachSent` unconditionally. Drafting
       * twenty and sending fifteen therefore recorded twenty sends, and every
       * denominator keyed on `sent_at` — evidence performance, reply rates,
       * the per-inbox cap — overstated by the difference.
       */
      markOutreachDrafted(outreach.id);
      if (send) markOutreachSent(outreach.id);

      /**
       * The immutable record of THIS message.
       *
       * Written after the compose returned, so it records a body that reached
       * Outlook rather than one we intended to write — and in two phases,
       * because the world has two: the snapshot is frozen here from the
       * evidence and the body as sent, and the row only becomes an analytics
       * send when something we observed sent it.
       *
       * Wrapped, and deliberately so. `logEvidence` has always been
       * best-effort on the principle that a gap in the analysis is survivable
       * and a campaign that aborts halfway through a list is not. This is the
       * same trade: a coach has already received the email by the time we get
       * here, and throwing now would neither unsend it nor help.
       */
      if (coachEvidence) {
        try {
          recordDraft({
            outreachId: outreach.id,
            athleteId,
            coachId: record.id,
            collegeName,
            sport: athlete.sport,
            // Per message, and never read back off the relationship: see the
            // note in recordDraft.
            programmeCampaignId,
            /**
             * The context's origin, or `campaign` when this run is attributed
             * to one. Derived rather than asked for in the second case: a send
             * carrying a programme campaign id that passed the gate above IS a
             * campaign send, whatever a caller thought to say about it.
             */
            // Passed through. `recordDraft` overrides it with `campaign`
            // when the attribution it verifies says so, which is the only
            // authoritative answer to that question.
            origin: resolvedOrigin,
            evidence: coachEvidence,
            body: personalisedBody,
            subject: personalise(subject, greetingName, coach.name || 'Coach'),
            bodySource: Object.values(BODY_SOURCE).includes(bodySource) ? bodySource : null,
            templateVariant: variant,
            renderedKinds,
          });
          /**
           * The AppleScript issued Outlook's own Send and did not error, which
           * is stronger evidence than an operator's later recollection and
           * weaker than a provider API's answer. Recorded as what it is, so
           * the day Gmail or Graph returns a real acceptance the two are
           * distinguishable in the data.
           *
           * It still does not mean delivered. Nothing here observes a message
           * leaving a mail server.
           */
          if (send) {
            confirmSend(outreach.id, undefined, {
              source: ACCEPTED_SOURCE.OUTLOOK_COMMAND_ASSERTED,
            });
          }
        } catch (err) {
          console.warn(`  send record failed for outreach ${outreach.id}: ${err.message}`);
        }
      }

      // Written after the compose succeeded, so the table records messages
      // that actually reached Outlook rather than ones we intended to write.
      // Never throws — see server/lib/evidenceLog.js.
      if (coachEvidence) {
        logEvidence({
          outreachId: outreach.id,
          athleteId,
          collegeName,
          sport: athlete.sport,
          evidence: coachEvidence,
          rendered: evidenceRendered,
          templateVariant: variant,
          renderedKinds,
          // What the composer actually used to build this body. A log field,
          // not a safety one: nothing downstream trusts it to decide what may
          // be said, and it is constrained to the enum so a bad client cannot
          // put arbitrary text in a grouping column.
          bodySource: Object.values(BODY_SOURCE).includes(bodySource) ? bodySource : null,
        });
      }
      results.push({ email: coach.email, name: coach.name, status: send ? 'sent' : 'drafted', url });
    } catch (err) {
      /**
       * `code` travels with the message so a caller need not read prose to
       * tell a first-touch review hold from a compose failure. Null for the
       * errors that carry none, which is most of them.
       */
      results.push({
        email: coach.email, name: coach.name, status: 'error',
        error: err.message, code: err.code ?? null,
      });
    }
  }

  return {
    results,
    baseUrl: PUBLIC_BASE_URL,
    reachable: isPubliclyReachable(),
    from: { requested: OUTLOOK_FROM_ADDRESS, actual: actualFrom, mismatch: fromMismatch },
  };
}
