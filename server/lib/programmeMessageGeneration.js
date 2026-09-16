import {
  programmePursuitPlan, contactAttemptPreparation, PREPARATION_REFUSAL,
} from './pursuitPolicy.js';
import { BLOCKER_CODE } from './campaignExecution.js';
import { attemptForCoach, ATTEMPT_STATE } from './contactAttempts.js';
import { composeProgrammeMessage } from './programmeMessage.js';
import { createProgrammeMessage, messageForStep } from './programmeMessages.js';
import { utcNow } from './time.js';

/**
 * TURN A PREPARED INTENT INTO A DURABLE MESSAGE — F10b-3.
 *
 * ---------------------------------------------------------------------------
 * THE GATE SITS ABOVE BOTH AUTHORITIES AND INSIDE NEITHER.
 *
 * `composeProgrammeMessage` writes the words and asks no policy question.
 * `createProgrammeMessage` freezes them and asks no policy question. Neither
 * should: a composer that also gated would be two authorities in one function,
 * and a writer that also gated would be a third. This is the one place that
 * decides whether new content may be produced at all, and it is the only
 * production caller of the other two.
 * ---------------------------------------------------------------------------
 *
 * IT REUSES F9's DECISION RATHER THAN RESTATING IT, and the reuse is exact
 * rather than approximate. `contactAttemptPreparation` checks, in order: a
 * current coach, a cold action, the first-touch review, B3's standing
 * prohibitions, and — LAST — whether an attempt already exists. Because
 * ALREADY_PREPARED is last, that answer means EVERY POLICY CHECK ABOVE IT
 * PASSED and an intent is on file. Which is precisely generation's question.
 *
 * So the two questions differ by one line rather than by a second policy:
 *
 *   PREPARATION  may a NEW intent be recorded?      allowed === true
 *   GENERATION   is an EXISTING intent still sound? reason === ALREADY_PREPARED
 *
 * Gating on `preparableNow` would have been exactly wrong: preparing succeeds,
 * so an attempt exists, so preparation is refused from that moment on.
 *
 * ---------------------------------------------------------------------------
 * A MESSAGE THAT EXISTS IS HISTORY. WHETHER ONE MAY BE MADE IS LIVE.
 *
 * Nothing here ever mutates or deletes a stored message. A relationship that
 * later becomes do-not-contact, a campaign that closes, an approval that goes
 * stale — each stops NEW content being generated and none of them rewrites what
 * was already written. So the refusal comes back even where a message exists,
 * because a prohibited campaign must not look actionable merely because content
 * is on file, and the content stays because it is the record of what was
 * written at the time.
 * ---------------------------------------------------------------------------
 *
 * WHAT IT DOES NOT ASK. Timing, budget, mailbox configuration, sending identity
 * and transport availability are execution's, exactly as they are for F9
 * preparation: a follow-up four days out and a campaign with no mailbox limit
 * configured are both generated now and sent later, and neither is permission
 * to send.
 *
 * AND WHAT IT DOES NOT DO. It prepares nothing — F9 stays an explicit preceding
 * transition — moves no attempt, advances no step, reconciles no drift, touches
 * no campaign state and sends nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO TRANSACTION AROUND THE CHECK AND THE WRITE.
 *
 * IN ONE PROCESS THERE IS NO WINDOW. `better-sqlite3` is synchronous and Node
 * is single-threaded, so nothing interleaves between the safety reads and the
 * INSERT — no other handler runs during a call. This build runs one Express
 * process and nothing clusters it.
 *
 * ACROSS PROCESSES THE DUPLICATE RISK IS ALREADY CLOSED, by
 * UNIQUE (attempt, step): two generators racing produce one durable row and one
 * constraint failure, never two messages. What remains is a policy race — a
 * stance set in one process microseconds before another's INSERT — and the
 * consequence of losing it is a stored message, not a sent one.
 *
 * A TRANSACTION WOULD NOT CLOSE IT ANYWAY. SQLite's default deferred
 * transaction takes no write lock until the first write, so the reads would
 * still be unprotected; only BEGIN IMMEDIATE would help, and wrapping every
 * generation in one would serialise it against every other writer for the
 * length of a composition — which reads rosters, philosophy and five seasons of
 * history. No production writer in this build wraps its reads and writes that
 * way, and this is a worse trade than the risk it removes.
 *
 * THE DEFENCE IS THE ONE EXECUTION NEEDS REGARDLESS: safety is revalidated at
 * SEND, where the consequence is a message actually leaving. A message
 * generated a moment after a stance changed is stopped there.
 * ---------------------------------------------------------------------------
 */

/** Why new content may not be generated. Everything else is quoted from F9. */
export const GENERATION_REFUSAL = Object.freeze({
  /**
   * NO INTENT HAS BEEN RECORDED. Generation does not prepare on somebody's
   * behalf: writing content for a pursuit nobody committed to would invert the
   * order F9 exists to establish, and would put a body in the database before
   * anything said the campaign meant to write at all.
   */
  CONTACT_ATTEMPT_REQUIRED: 'CONTACT_ATTEMPT_REQUIRED',
  /**
   * THE PURSUIT IS NOT BEING PURSUED. Only a `planned` attempt generates.
   * `stopped` is a decision somebody took and `active` is a state nothing can
   * currently reach — both fail closed rather than being read as permission.
   */
  CONTACT_ATTEMPT_NOT_PLANNED: 'CONTACT_ATTEMPT_NOT_PLANNED',
  /**
   * THE CAMPAIGN HAS MOVED ON. Policy now names a different coach — the
   * previous one replied, was suppressed, or had their pursuit stopped. The old
   * attempt is not retargeted and no message is quietly written for the new
   * coach: which person a campaign is writing to is not a detail to be fixed up
   * inside a generator.
   */
  COACH_NO_LONGER_CURRENT: 'COACH_NO_LONGER_CURRENT',
  /** The canonical spelling, quoted from B7 rather than respelled here. */
  CONTACT_ATTEMPT_STEP_DRIFT: BLOCKER_CODE.CONTACT_ATTEMPT_STEP_DRIFT,
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * GENERATE THE MESSAGE THIS CAMPAIGN INTENDS TO SEND THIS COACH.
 *
 * TWO IDENTIFIERS, exactly as composition takes. Not a subject, body, evidence
 * kind, structure, recipient, athlete, college or step — every one of those is
 * derived by an authority below this one, which is what stops a caller writing
 * content for somebody the campaign would never approach.
 *
 * THE ORDER IS LOAD-BEARING and is asserted in the suite:
 *
 *   1  the attempt exists, and is planned
 *   2  the campaign still names this coach
 *   3  the stored step and the derived step agree
 *   4  F9's decision passes — cold action, first touch, standing prohibitions
 *   5  a message for this step already exists?  return it, compose nothing
 *   6  otherwise compose, then persist
 *
 * SAFETY IS CHECKED BEFORE THE EXISTING MESSAGE IS LOOKED UP, and that is the
 * whole of §15: a campaign that has since closed refuses rather than handing
 * back content that makes it look actionable.
 *
 * AND THE EXISTING MESSAGE IS RETURNED WITHOUT RECOMPOSING, which is the whole
 * of §16. Evidence moves; the first generation is the durable snapshot. Were
 * this to compose first and hand the result to the writer, a harmless retry
 * after a roster changed would come back as MESSAGE_ALREADY_GENERATED — an
 * integrity refusal raised by nothing having gone wrong.
 *
 * IDEMPOTENT RETRY IS NOT REGENERATION. F10 has no regeneration: there is no
 * way to ask for different content for a step already written, and that is
 * deliberate rather than missing.
 *
 * @param {string} args.programmeCampaignId
 * @param {string} args.coachId
 * @returns {{created: boolean, message: object}}
 * @throws with `err.code` — see GENERATION_REFUSAL, PREPARATION_REFUSAL and
 *   CONTACT_REFUSAL. Nothing is written on any refusal.
 */
export function generateProgrammeMessage({ programmeCampaignId, coachId, at = utcNow() } = {}) {
  /**
   * ---- 1. an intent exists, and is still being pursued ----
   *
   * Read directly rather than through the plan, because the plan SKIPS a
   * stopped attempt's coach — so a stopped pursuit would otherwise surface as
   * "the campaign names somebody else", which is true and unhelpful. The
   * operator's question is why THIS one will not generate.
   */
  const attempt = attemptForCoach(programmeCampaignId, coachId);
  if (!attempt) {
    throw fail(
      GENERATION_REFUSAL.CONTACT_ATTEMPT_REQUIRED,
      'Nothing has been prepared for this coach, so there is no intent to write content for. '
      + 'Prepare the attempt first.',
    );
  }
  if (attempt.state !== ATTEMPT_STATE.PLANNED) {
    throw fail(
      GENERATION_REFUSAL.CONTACT_ATTEMPT_NOT_PLANNED,
      `This campaign's pursuit of this coach is ${attempt.state}`
      + `${attempt.state_reason ? ` — ${attempt.state_reason}` : ''}. `
      + 'A pursuit that is not being pursued does not produce new messages.',
    );
  }

  const plan = programmePursuitPlan({ programmeCampaignId });

  /**
   * ---- 2. the campaign still names this coach ----
   *
   * `plan.current` is policy's answer to who is being written to now. An
   * attempt whose coach is no longer it belongs to a pursuit the campaign has
   * moved past, and generating against it would produce content for a
   * conversation that is over.
   *
   * NOBODY AT ALL IS A DIFFERENT ANSWER, and F9's decision gives the better
   * one. When every address at a programme has been suppressed the plan names
   * no coach — and "this campaign is no longer approaching that coach" is true
   * and unhelpful, where NO_ELIGIBLE_COACH says what actually happened. So the
   * absence is handed to the decision below rather than answered here.
   */
  if (plan.current && plan.current.coachId !== coachId) {
    throw fail(
      GENERATION_REFUSAL.COACH_NO_LONGER_CURRENT,
      'This campaign is no longer approaching that coach at this programme. The prepared '
      + 'attempt is not retargeted and no message is written for anybody else.',
    );
  }
  if (!plan.current) {
    const nobody = contactAttemptPreparation(plan);
    throw fail(nobody.reason, refusalMessage(nobody.reason, plan));
  }

  /**
   * ---- 3. the two step records agree ----
   *
   * B6 derives the step from accepted campaign-local messages and cannot be
   * wrong; B4 stores one on the attempt. Where they disagree, F9b-1's writer
   * owns reconciliation — preparing again is what catches a stale attempt up —
   * and a generator that quietly did it instead would be repairing a record on
   * the way to writing content against it. Both directions fail closed: behind
   * needs re-preparing, ahead is an attempt claiming a message that is not on
   * file, and neither is generation's to fix.
   */
  if (attempt.step !== plan.step) {
    throw fail(
      GENERATION_REFUSAL.CONTACT_ATTEMPT_STEP_DRIFT,
      `The prepared attempt is on step ${attempt.step} and this campaign's message history says `
      + `step ${plan.step}. Nothing is generated while the two disagree — prepare the attempt `
      + 'again to reconcile it, or look at what was sent.',
    );
  }

  /**
   * ---- 4. F9's decision, whole ----
   *
   * ALREADY_PREPARED is the ONE refusal this caller does not honour, and it is
   * the answer it expects: because it is the last check in that function, it
   * means the cold action, the first-touch review and every standing
   * prohibition passed and an intent is on file.
   *
   * `allowed: true` here would mean no attempt was found by the plan even
   * though one exists for the coach it just named — an inconsistency rather
   * than a permission, so it fails closed under the same code as a missing one.
   */
  const preparation = contactAttemptPreparation(plan);
  if (preparation.reason !== PREPARATION_REFUSAL.ALREADY_PREPARED) {
    if (preparation.allowed) {
      throw fail(
        GENERATION_REFUSAL.CONTACT_ATTEMPT_REQUIRED,
        'This campaign does not hold the prepared attempt this coach was expected to have. '
        + 'Nothing was generated.',
      );
    }
    throw fail(preparation.reason, refusalMessage(preparation.reason, plan));
  }

  /**
   * ---- 5. already written ----
   *
   * Returned WITHOUT recomposing. The stored message is the durable snapshot of
   * what was generated, and asking the engine again would be asking a different
   * question of data that has since moved.
   */
  const existing = messageForStep(attempt.id, plan.step);
  if (existing) return { created: false, message: existing };

  // ---- 6. compose, then freeze ----
  const composition = composeProgrammeMessage({ programmeCampaignId, coachId });
  return createProgrammeMessage({
    programmeContactAttemptId: attempt.id,
    composition,
    at,
  });
}

/**
 * The sentence for a refusal F9 decided, in generation's own words.
 *
 * The CODES are B3's and B6's and are quoted; only the prose is here. Written
 * for GENERATING rather than reused from preparing, because the two differ in
 * what the operator is being told they cannot do — and the router owns what
 * leaves the building either way.
 */
function refusalMessage(reason, plan) {
  const where = plan?.programmeCampaign
    ? `${plan.programmeCampaign.collegeName} (${plan.programmeCampaign.sport})`
    : 'This programme';
  switch (reason) {
    case PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED:
      return `${where}: this athlete has already had confirmed outreach to this coach. `
        + (plan?.firstTouchReview?.approval?.status === 'stale'
          ? 'Further contact has been recorded since the review was given, so what was approved '
            + 'is no longer what is on file. Review the contact history again first.'
          : 'Review the contact history and approve the first touch before anything is written.');
    case PREPARATION_REFUSAL.NO_ELIGIBLE_COACH:
      return `${where} has nobody this campaign can approach.`;
    case PREPARATION_REFUSAL.NO_ACTION_TO_PREPARE:
      return `${where} has no next message to write: either somebody there has replied and it `
        + 'is waiting for a person, or the programme\'s cold outreach is finished.';
    default:
      /**
       * A B3 PROHIBITION. Named rather than explained, because the codes are
       * the contract and the vocabulary an operator reads is the router's —
       * `campaignLabels` already holds one sentence per code and a second set
       * here would be two explanations of the same rule.
       */
      return `${where}: nothing may be written under this campaign right now (${reason}).`;
  }
}
