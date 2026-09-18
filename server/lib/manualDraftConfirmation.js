import db from '../db/client.js';
import { utcNow } from './time.js';
import { sendById, transitionSend } from './outreachSend.js';
import { markOutreachSent } from './outreach.js';
import { recordManualOutboundAttempt } from './outboundBudget.js';
import { establishManualOnlyForConfirmedSend } from './manualContactStance.js';
import { MESSAGE_STATE, ACCEPTED_SOURCE, OPEN_STATES } from '../../shared/outreachMessageState.js';
import { OUTREACH_ORIGIN } from '../../shared/outreachOrigin.js';

/**
 * ONE DRAFT, ONE OPERATOR, ONE ASSERTION — F7b.
 *
 * ===========================================================================
 * THIS RECORDS WHAT A PERSON SAYS THEY DID. IT VERIFIES NOTHING.
 *
 * Thriv3 hands a message to Outlook through AppleScript and receives no
 * message id, no draft id and no handle of any kind back — `composeInOutlook`
 * returns only which account Outlook picked, scraped out of a window title.
 * There is no callback, nothing to poll and nothing to match on. So after the
 * operator presses Send in Outlook, THIS SYSTEM KNOWS NOTHING, and the only
 * way a send becomes recordable is that the person who sent it says so.
 *
 * Every word this produces must therefore be an assertion and never an
 * observation. `accepted_source` is OPERATOR_ASSERTED, which is the weakest
 * of the four and is the honest one. Nothing here may be worded, logged or
 * surfaced as "verified", "detected" or "delivered".
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS BESIDE `confirmSends` RATHER THAN INSIDE IT.
 *
 * `confirmSends` confirms a BATCH, addressed by `outreach` ids, grouped by a
 * thirty-minute gap in drafting time. That is the right shape for the CLI it
 * serves — draft twenty, send twenty, confirm twenty — and the wrong shape for
 * a screen: an operator who drafted ten and sent seven has no way to say so,
 * and a draft written days later lands in a batch of its own that nobody
 * mentioned.
 *
 * So this takes ONE `outreach_send.id` — the message, not the relationship and
 * not the sitting. The two coexist deliberately; neither is a second authority
 * because both delegate to the same writers, and this one is strictly
 * narrower.
 * ---------------------------------------------------------------------------
 *
 * IT IS FOR MANUAL MESSAGES ONLY. A campaign-origin message is refused
 * outright — the campaign engine has its own execution, its own claim and its
 * own acceptance, and an operator screen that could mark a campaign message
 * sent would be one workstream writing another's truth.
 */

/** Why a confirmation was refused. Each is a fact about the row, never a policy. */
export const CONFIRMATION_REFUSAL = Object.freeze({
  /** No such message. */
  SEND_NOT_FOUND: 'SEND_NOT_FOUND',
  /** It belongs to a different athlete, or a different programme. */
  SEND_NOT_FOR_RELATIONSHIP: 'SEND_NOT_FOR_RELATIONSHIP',
  /**
   * It is a campaign message. The campaign engine owns its acceptance, and an
   * operator asserting one here would put OPERATOR_ASSERTED on a message a
   * provider is going to answer for.
   */
  NOT_A_MANUAL_MESSAGE: 'NOT_A_MANUAL_MESSAGE',
  /** Already accepted, cancelled, or in a state a person cannot resolve. */
  NOT_AWAITING_CONFIRMATION: 'NOT_AWAITING_CONFIRMATION',
  /**
   * The relationship was revoked. Its tracking link no longer resolves, so a
   * message confirmed through it would be recorded as reaching a coach who,
   * if they clicked, would find nothing. `confirmSends` excludes these from
   * its listing for the same reason; this refuses them by name.
   */
  OUTREACH_REVOKED: 'OUTREACH_REVOKED',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const OUTREACH_ROW = db.prepare('SELECT * FROM outreach WHERE id = ?');

/**
 * THE MESSAGE, PROVED TO BE THE ONE THE CALLER IS ENTITLED TO TOUCH.
 *
 * ---------------------------------------------------------------------------
 * A VALID ID IS NOT AN ENTITLEMENT. The route supplies an athlete and a
 * relationship from its URL and a send id from its body, and a client that
 * guessed a uuid must not be able to confirm somebody else's message. So all
 * three are compared: the message's own `athlete_id`, and the college name and
 * sport it was drafted against, must match the relationship the URL names.
 *
 * `college_name` and `sport` are denormalised onto `outreach_send` at draft
 * time precisely so a snapshot reads without a join, and they are what
 * `contactIntelligence` groups by — so comparing them here compares the same
 * identity the rest of the product uses.
 * ---------------------------------------------------------------------------
 */
export function pendingManualDraft({ sendId, athleteId, collegeName, sport }) {
  if (!sendId) throw fail(CONFIRMATION_REFUSAL.SEND_NOT_FOUND, 'No message was named.');

  const send = sendById(sendId);
  if (!send) throw fail(CONFIRMATION_REFUSAL.SEND_NOT_FOUND, `No message ${sendId}.`);

  if (send.athlete_id !== athleteId
    || send.college_name !== collegeName
    || send.sport !== sport) {
    /**
     * ONE REFUSAL FOR ALL THREE, AND DELIBERATELY VAGUE. Telling a caller
     * which part did not match would confirm that a message id they guessed is
     * real and say whose it is.
     */
    throw fail(CONFIRMATION_REFUSAL.SEND_NOT_FOR_RELATIONSHIP,
      'That message does not belong to this athlete and programme.');
  }

  if (send.origin !== OUTREACH_ORIGIN.MANUAL) {
    throw fail(CONFIRMATION_REFUSAL.NOT_A_MANUAL_MESSAGE,
      send.origin === OUTREACH_ORIGIN.CAMPAIGN
        ? 'That message was sent by a campaign. Campaign messages are accepted by the campaign '
          + 'engine, not confirmed by hand here.'
        : 'That message records no origin, so it cannot be confirmed as manual outreach.');
  }

  /**
   * DRAFT, AND ONLY DRAFT. QUEUED and SENDING belong to a transport that is
   * mid-flight; ACCEPTED is already done; CANCELLED was discarded; FAILED and
   * UNKNOWN_PROVIDER_RESULT are provider outcomes a person must not overwrite
   * with an assertion. A manual Outlook draft is only ever DRAFT.
   */
  if (send.state !== MESSAGE_STATE.DRAFT) {
    throw fail(CONFIRMATION_REFUSAL.NOT_AWAITING_CONFIRMATION,
      `That message is ${send.state}, so it is not a draft awaiting confirmation.`);
  }

  const outreach = OUTREACH_ROW.get(send.outreach_id);
  if (outreach?.revoked_at) {
    throw fail(CONFIRMATION_REFUSAL.OUTREACH_REVOKED,
      'Outreach to this coach was revoked, so their tracking link no longer resolves. '
      + 'This message cannot be confirmed as sent.');
  }

  return { send, outreach };
}

/**
 * THE OPERATOR SAYS THEY SENT THIS ONE.
 *
 * Four writes, in the order the existing batch path uses, through the existing
 * writers — this adds no new way to accept a message, it only addresses one
 * precisely.
 *
 *   1  the MESSAGE becomes ACCEPTED, sourced OPERATOR_ASSERTED
 *   2  the RELATIONSHIP takes its first-ever send date, first-wins
 *   3  the mailbox's day is charged for a message it really carried
 *   4  the campaign is told to leave this school alone
 *
 * ONE TRANSACTION for the first two, because a message accepted without its
 * relationship dated — or the reverse — is a denominator nobody can reason
 * about afterwards. The last two are best-effort OUTSIDE it, exactly as
 * `confirmSends` treats them: by the time an operator is confirming, the coach
 * already has the email, and declining to record that because a ledger write
 * or a policy write failed would lose the more important of the two facts.
 *
 * IDEMPOTENT BY REFUSAL, NOT BY SILENCE. A second confirmation of the same
 * message finds it ACCEPTED and is refused NOT_AWAITING_CONFIRMATION — which
 * is what a screen wants to hear, and is safe because every write underneath
 * is independently idempotent anyway: `markOutreachSent` is first-wins,
 * `establishManualOnly` is a no-op on an already-manual_only relationship.
 */
export function confirmManualDraftSent({
  sendId, athleteId, collegeName, sport, at = utcNow(),
} = {}) {
  const { send } = pendingManualDraft({ sendId, athleteId, collegeName, sport });

  db.transaction(() => {
    transitionSend(sendId, MESSAGE_STATE.ACCEPTED, {
      acceptedSource: ACCEPTED_SOURCE.OPERATOR_ASSERTED,
      at,
    });
    /**
     * FIRST-WINS, AND THAT IS THE EXISTING SEMANTIC RATHER THAN A CHOICE MADE
     * HERE. `markOutreachSent` writes `WHERE sent_at IS NULL`, so confirming a
     * follow-up cannot re-date the relationship's first contact and move
     * somebody's engagement window.
     */
    markOutreachSent(send.outreach_id, at);
  })();

  let attemptRecorded = true;
  try {
    recordManualOutboundAttempt({ outreachId: send.outreach_id, athleteId: send.athlete_id, at });
  } catch (err) {
    attemptRecorded = false;
    console.warn(`  outbound attempt not recorded for ${send.outreach_id}: ${err.message}`);
  }

  /**
   * AND THE CAMPAIGN BACKS OFF — F5b's seam, reached by its own function so
   * that provenance is re-read from the row rather than assumed from the fact
   * that we are in a manual module. It refuses anything but a manual origin,
   * it resolves the programme from `coaches.school`/`.sport` rather than from
   * any label held here, and it never downgrades `do_not_contact`.
   */
  let contactStance = null;
  try {
    contactStance = establishManualOnlyForConfirmedSend({
      outreachId: send.outreach_id, outreachSendId: sendId,
    });
  } catch (err) {
    console.warn(`  contact stance not established for ${send.outreach_id}: ${err.message}`);
  }

  return { send: sendById(sendId), attemptRecorded, contactStance };
}

/**
 * THE DRAFT WAS NEVER SENT, AND THE OPERATOR IS SAYING SO.
 *
 * ===========================================================================
 * CANCELLED IS THE EXISTING STATE FOR THIS, AND IT FITS EXACTLY.
 *
 * The state machine already defines it as "withdrawn before it went anywhere.
 * Terminal." — which is precisely what an Outlook draft the operator deleted,
 * or abandoned, or replaced by writing something else by hand, actually is.
 * DRAFT → CANCELLED is already a legal edge, and CANCELLED is deliberately
 * absent from RELATIONSHIP_BLOCKING_STATES, so discarding frees the
 * relationship to hold a new draft. No new state, no migration, no overloaded
 * meaning.
 * ===========================================================================
 *
 * IT CLAIMS NOTHING ABOUT OUTLOOK. Thriv3 cannot see whether the draft still
 * sits in the operator's drafts folder, and this does not delete it, touch it
 * or assert anything about it. What it records is that THIS MESSAGE RECORD is
 * no longer awaiting a confirmation — a statement about Thriv3's own books.
 *
 * THE HISTORY SURVIVES INTACT. The row stays, with its subject, its body hash,
 * its evidence payload, its coach, its date and its origin. `outreach_evidence`
 * is untouched. What Thriv3 composed remains answerable for ever; only the
 * claim that it is pending goes away.
 *
 * IT NEVER MARKS ANYTHING SENT. No `sent_at`, no ACCEPTED, no outbound attempt,
 * and emphatically no `manual_only` — a message nobody sent is not manual
 * contact, and establishing a contact policy from one would be the exact
 * fabrication F5b was built to prevent.
 *
 * THERE IS NO OUTBOUND RESERVATION TO RELEASE, AND THAT IS WORTH SAYING
 * PLAINLY BECAUSE IT READS LIKE THERE SHOULD BE.
 *
 * `sendOutreach` spends capacity only `if (send)` — a draft window hands
 * nothing to a provider, so an operator may draft a whole list for review
 * without spending a day's allowance on messages nobody has decided to send.
 * Since this route is now draft-only, a manual draft costs nothing when it is
 * created; the mailbox's day is charged at CONFIRMATION, by
 * `recordManualOutboundAttempt` in `confirmManualDraftSent` above, which is the
 * moment a person says a real message really went.
 *
 * So discarding releases nothing because nothing was held. The ledger stays a
 * record of what was spent rather than a balance anybody reconciles.
 */
export function discardManualDraft({
  sendId, athleteId, collegeName, sport, at = utcNow(),
} = {}) {
  const { send } = pendingManualDraft({ sendId, athleteId, collegeName, sport });
  transitionSend(sendId, MESSAGE_STATE.CANCELLED, { at });
  return { send: sendById(sendId) };
}

/* -------------------------------------------------------------------------- */
/* What is waiting, for the whole athlete, in one statement                     */
/* -------------------------------------------------------------------------- */

const OPEN_LIST = OPEN_STATES.map((s) => `'${s}'`).join(', ');

/**
 * EVERY MANUAL DRAFT THIS ATHLETE HAS WAITING, IN ONE STATEMENT.
 *
 * ---------------------------------------------------------------------------
 * ATHLETE-LEVEL BECAUSE THE SCREEN IS. Specific Schools renders a list, and a
 * pending-draft lookup per row would be an N+1 that grows with exactly the
 * athletes who have the most outreach — invisible from the network tab, since
 * the page would still be making one request per card by design rather than by
 * accident. One statement, indexed client-side by programme, the same shape
 * `contactIntelligence` already established for the same reason.
 *
 * NOT FOLDED INTO `contactIntelligence`. That module answers "what has
 * happened", derived from history and deliberately carrying no row ids: it is
 * a summary, and putting an actionable identifier inside it would make a
 * read-only intelligence payload into a handle for writes. This is a different
 * question — "what is still waiting for you" — and it is asked separately.
 * ---------------------------------------------------------------------------
 *
 * MANUAL ONLY. A campaign draft is not something an operator confirms by hand,
 * and including one would put an action on screen that the route below refuses.
 */
const PENDING = db.prepare(`
  SELECT
    s.id            AS send_id,
    s.outreach_id,
    s.college_name,
    s.sport,
    s.coach_id,
    s.subject,
    s.drafted_at,
    s.state,
    s.origin,
    c.full_name     AS coach_name,
    c.position_title
  FROM outreach_send s
  JOIN outreach o ON o.id = s.outreach_id
  LEFT JOIN coaches c ON c.id = s.coach_id
  WHERE s.athlete_id = @athleteId
    AND s.origin = @manual
    AND s.state IN (${OPEN_LIST})
    AND o.revoked_at IS NULL
  ORDER BY s.drafted_at, s.id
`);

export function pendingManualDraftsForAthlete(athleteId) {
  if (!athleteId) return [];
  return PENDING.all({ athleteId, manual: OUTREACH_ORIGIN.MANUAL });
}
