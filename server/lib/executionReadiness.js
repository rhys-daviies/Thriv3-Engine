import db from '../db/client.js';
import { utcToday } from './time.js';
import { programmeMessageWithContext, MESSAGE_STATE as CONTENT_STATE } from './programmeMessages.js';
import { programmePursuitPlan, PURSUIT_ACTION } from './pursuitPolicy.js';
import { followUpTiming } from './followUpTiming.js';
import { unresolvedSendFor } from './outreachSend.js';
import { mailbox, hasStoredCredential, MAILBOX_STATUS, MAILBOX_PROVIDER } from './connectedMailboxes.js';
import { isSendCapped } from './sendCap.js';
import { productionTransport } from './productionTransport.js';

/**
 * WOULD THIS MESSAGE GO, IF SOMEBODY PRESSED SEND NOW? — D4.9.
 *
 * ===========================================================================
 * ADVISORY, AND THE WORD IS LOAD-BEARING.
 *
 * This exists so a screen can grey out a button and say why, instead of
 * offering a send that refuses. It is NOT permission, it cannot be exchanged
 * for permission, and no code path leads from an answer here into
 * `executionClaim`. The claim takes ids and re-establishes every one of these
 * facts itself, inside the transaction that writes.
 *
 * WHY THAT MATTERS RATHER THAN BEING PEDANTRY: every fact below can move
 * between this answer and a send. An address is corrected, a coach replies, a
 * suppression lands, a mailbox is revoked, the day's capacity goes, the clock
 * ticks past midnight. A design in which "readiness said yes" let the claim
 * skip a check would be sending on the strength of a world that had already
 * changed.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * IT ASSEMBLES EXISTING AUTHORITIES. IT IMPLEMENTS NO POLICY.
 *
 * F11's `executionDecision` was considered for this and not converged, because
 * conforming it to D4.5–D4.8 would have meant copying the claim's own logic
 * into a second module — a second policy at the last gate before an email
 * leaves, which is the worst place in the system for two of them. Every line
 * below is a CALL:
 *
 *   programmeMessageWithContext  the message and its campaign context
 *   programmePursuitPlan         stance, suppression, revocation, lifecycle,
 *                                first-touch review, step, action, budget read
 *   followUpTiming               the four policy days, one implementation
 *   unresolvedSendFor            D4.4's relationship-blocking state
 *   isSendCapped                 the per-inbox recipient protection
 *   mailbox / hasStoredCredential  D2's ownership and readiness
 *
 * When a rule changes, this changes with it, because it never knew the rule.
 * ---------------------------------------------------------------------------
 *
 * IT WRITES NOTHING AND SPENDS NOTHING. No claim, no send row, no tracking
 * token, no attempt, no budget consumption — the plan READS the budget through
 * `outboundBudgetDecisionForAthlete` and consumes none of it.
 */

/** Why a message is not ready. Quoted from the owning authority wherever one exists. */
export const READINESS_BLOCKER = Object.freeze({
  MESSAGE_NOT_REVIEWED: 'MESSAGE_NOT_REVIEWED',
  MESSAGE_ALREADY_EXECUTED: 'MESSAGE_ALREADY_EXECUTED',
  RELATIONSHIP_HAS_UNRESOLVED_SEND: 'RELATIONSHIP_HAS_UNRESOLVED_SEND',
  FOLLOW_UP_NOT_DUE: 'FOLLOW_UP_NOT_DUE',
  MESSAGE_NOT_CURRENT: 'MESSAGE_NOT_CURRENT',
  CONTACT_ATTEMPT_STEP_DRIFT: 'CONTACT_ATTEMPT_STEP_DRIFT',
  NO_ACTION_TO_EXECUTE: 'NO_ACTION_TO_EXECUTE',
  SEND_CAP_REACHED: 'SEND_CAP_REACHED',
  MAILBOX_REQUIRED: 'MAILBOX_REQUIRED',
  MAILBOX_NOT_FOUND: 'MAILBOX_NOT_FOUND',
  MAILBOX_NOT_CONNECTED: 'MAILBOX_NOT_CONNECTED',
  MAILBOX_ATHLETE_MISMATCH: 'MAILBOX_ATHLETE_MISMATCH',
  MAILBOX_CREDENTIAL_MISSING: 'MAILBOX_CREDENTIAL_MISSING',
  MAILBOX_PROVIDER_UNSUPPORTED: 'MAILBOX_PROVIDER_UNSUPPORTED',
  TRANSPORT_NOT_CONFIGURED: 'TRANSPORT_NOT_CONFIGURED',
  CAMPAIGN_BLOCKED: 'CAMPAIGN_BLOCKED',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
});

/** The execution row this composition already has, if any. */
const EXECUTION_FOR_MESSAGE = db.prepare(
  'SELECT id, state FROM outreach_send WHERE programme_message_id = ?',
);
const OUTREACH_FOR = db.prepare(
  'SELECT id FROM outreach WHERE athlete_id = ? AND coach_id = ?',
);

/**
 * @param {string} args.programmeMessageId
 * @param {string} args.operatorUserId      from the session.
 * @param {string|null} args.connectedMailboxId  the mailbox a caller would use.
 * @returns {{readyNow, blockers, ...}} — blockers is EVERY reason, not the first.
 */
export function executionReadiness({
  programmeMessageId, operatorUserId, connectedMailboxId = null, onDate = utcToday(),
} = {}) {
  const found = programmeMessageWithContext(programmeMessageId);
  if (!found) return null;
  const { message, context } = found;

  /**
   * EVERY BLOCKER, NOT THE FIRST ONE. The claim stops at the first refusal
   * because it must not do anything after one. A screen has the opposite need:
   * an operator fixing one problem should not discover a second by pressing
   * send again.
   */
  const blockers = [];
  const add = (code, detail = null) => blockers.push(detail ? { code, ...detail } : { code });

  /* ---- the words ---------------------------------------------------------- */
  if (message.state !== CONTENT_STATE.REVIEWED) add(READINESS_BLOCKER.MESSAGE_NOT_REVIEWED);

  const prior = EXECUTION_FOR_MESSAGE.get(message.id);
  if (prior) add(READINESS_BLOCKER.MESSAGE_ALREADY_EXECUTED, { state: prior.state });

  /* ---- the relationship --------------------------------------------------- */
  const relationship = OUTREACH_FOR.get(context.athleteId, message.coach_id);
  if (unresolvedSendFor(relationship?.id ?? null)) {
    add(READINESS_BLOCKER.RELATIONSHIP_HAS_UNRESOLVED_SEND);
  }

  /* ---- what the campaign intends ------------------------------------------ */
  const plan = programmePursuitPlan({
    programmeCampaignId: context.programmeCampaignId,
    onDate,
  });

  let timing = null;
  if (!plan.current) {
    add(READINESS_BLOCKER.NO_ACTION_TO_EXECUTE, { reason: plan.reason ?? null });
  } else if (plan.current.coachId !== message.coach_id) {
    add(READINESS_BLOCKER.MESSAGE_NOT_CURRENT, { reason: plan.reason ?? null });
  } else if (plan.nextAction === PURSUIT_ACTION.AWAITING_OPERATOR) {
    add(READINESS_BLOCKER.CAMPAIGN_BLOCKED, { reason: plan.reason ?? null });
  } else {
    if (message.step !== plan.step || context.attemptStep !== plan.step) {
      add(READINESS_BLOCKER.CONTACT_ATTEMPT_STEP_DRIFT, {
        messageStep: message.step, attemptStep: context.attemptStep, planStep: plan.step,
      });
    }
    if (plan.firstTouchReview?.required) {
      add(READINESS_BLOCKER.CAMPAIGN_BLOCKED, { reason: plan.firstTouchReview.reason });
    }
    /**
     * THE FOUR-DAY CLOCK, THROUGH THE ONE IMPLEMENTATION OF IT. Reported with
     * its eligible date, because "not yet" without a date is not actionable.
     */
    if (plan.nextAction === PURSUIT_ACTION.FOLLOW_UP) {
      timing = followUpTiming(plan.current, onDate);
      if (!timing.due) {
        add(READINESS_BLOCKER.FOLLOW_UP_NOT_DUE, {
          nextEligibleOn: timing.policyEligibleOn ?? null,
          unresolved: timing.unresolved,
        });
      }
    }
  }

  /**
   * B3's OWN REFUSAL, REPORTED RATHER THAN RESTATED — and only where it was
   * actually evaluated. With no current coach the plan fills both of these with
   * `NO_CURRENT_COACH`, which the block above has already said better.
   */
  if (plan.safety?.evaluated && plan.safety.allowed === false) {
    add(READINESS_BLOCKER.CAMPAIGN_BLOCKED, { reason: plan.safety.reason ?? null });
  }
  /** B5's, READ and not consumed. `allowed` is undefined when unevaluated. */
  if (plan.budget?.evaluated && plan.budget.allowed === false) {
    add(READINESS_BLOCKER.BUDGET_EXHAUSTED, { reason: plan.budget.reason ?? null });
  }

  /* ---- the recipient's own protection ------------------------------------ */
  if (message.recipient_email && isSendCapped(message.recipient_email)) {
    add(READINESS_BLOCKER.SEND_CAP_REACHED);
  }

  /* ---- the mailbox a caller would use ------------------------------------ */
  let box = null;
  if (!connectedMailboxId) {
    add(READINESS_BLOCKER.MAILBOX_REQUIRED);
  } else {
    box = mailbox(connectedMailboxId, { operatorUserId });
    if (!box) add(READINESS_BLOCKER.MAILBOX_NOT_FOUND);
    else {
      if (box.athlete_id !== context.athleteId) add(READINESS_BLOCKER.MAILBOX_ATHLETE_MISMATCH);
      if (box.status !== MAILBOX_STATUS.CONNECTED) {
        add(READINESS_BLOCKER.MAILBOX_NOT_CONNECTED, { status: box.status });
      }
      if (box.provider !== MAILBOX_PROVIDER.GOOGLE) {
        add(READINESS_BLOCKER.MAILBOX_PROVIDER_UNSUPPORTED, { provider: box.provider });
      }
      if (!hasStoredCredential(box.id)) add(READINESS_BLOCKER.MAILBOX_CREDENTIAL_MISSING);
    }
  }

  /* ---- and something to send with ---------------------------------------- */
  if (!productionTransport()) add(READINESS_BLOCKER.TRANSPORT_NOT_CONFIGURED);

  return {
    programmeMessageId: message.id,
    step: message.step,
    coachId: message.coach_id,
    recipientEmail: message.recipient_email,
    reviewed: message.state === CONTENT_STATE.REVIEWED,
    /** So a client can send the precondition it was actually shown. */
    bodyHash: message.body_hash,
    connectedMailboxId: box?.id ?? null,
    sendingIdentity: box?.email_address ?? null,
    provider: box?.provider ?? null,
    plannedAction: plan.nextAction ?? null,
    planStep: plan.step ?? null,
    followUpEligibleOn: timing?.policyEligibleOn ?? null,

    readyNow: blockers.length === 0,
    blockers,
    /**
     * SAID IN THE PAYLOAD, not only in a comment. A client holding this object
     * is holding an observation, and the send path will ask everything again.
     */
    advisory: true,
    claimRechecksEverything: true,
    asOf: onDate,
  };
}
