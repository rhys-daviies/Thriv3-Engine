import db from '../db/client.js';
import { utcNow, utcToday } from './time.js';
import { RUN_ID } from './executionRun.js';
import { programmeMessageWithContext } from './programmeMessages.js';
import {
  assertExecutionSafety, executionSnapshot, CLAIM_REFUSAL,
} from './executionClaim.js';
import {
  transitionSend, claimSendForExecution, sendById, openSendFor,
} from './outreachSend.js';
import {
  recordOutboundAttempt, TRANSPORT, OUTBOUND_ATTEMPT_DISPOSITION,
} from './outboundBudget.js';
import { MESSAGE_STATE, SEND_EVENT_TYPE } from '../../shared/outreachMessageState.js';

/**
 * SENDING AGAIN, AFTER A SEND THAT PROVABLY NEVER HAPPENED — D5.0.
 *
 * ===========================================================================
 * THE ONLY RE-EXECUTION PATH IN THE SYSTEM, AND IT IS DELIBERATELY NARROW.
 *
 * A message whose transport refused BEFORE it submitted anything is in a
 * peculiar position: it is FAILED, the coach has nothing, no capacity was
 * really spent — and the approved words are still the right words. Making an
 * operator compose a new message to recover from an expired credential would
 * be asking them to do editorial work to fix an infrastructure problem.
 *
 * Everything else stays exactly as it was:
 *
 *   ACCEPTED   terminal. There is nothing to retry; it went.
 *   UNKNOWN    NEVER retryable, by any path. The message may be in the coach's
 *              inbox and no evidence here can rule it out. This module refuses
 *              it explicitly rather than relying on the state graph, so the
 *              refusal is a named answer and not an accident of a table.
 *   REJECTED   FAILED, but the provider RECEIVED the request and said no. A
 *              second identical request is a second thing the provider will
 *              refuse, and "FAILED" alone must not license it — which is why
 *              eligibility is decided on evidence and not on state.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT A SECOND `executionClaim`, AND IT HOLDS NO POLICY OF ITS OWN.
 *
 * Every safety rule is `assertExecutionSafety` — the same function, the same
 * code, extracted from the ordinary claim in this slice precisely so that there
 * is one copy. A refusal that happened this morning says nothing about this
 * afternoon: a coach may have replied, the campaign may have been stopped, the
 * address corrected, the inbox capped, the day rolled over. All of it is
 * re-asked, none of it is re-implemented.
 *
 * WHAT THIS MODULE OWNS IS EXACTLY TWO THINGS — whether the evidence proves a
 * non-send, and the atomic reclaim of an existing row. Nothing else.
 * ---------------------------------------------------------------------------
 *
 * IT DOES NOT WEAKEN `MESSAGE_ALREADY_EXECUTED`. That gate lives in the
 * ordinary claim and is untouched: a second execution of an approved message is
 * still refused, and still creates no second `outreach_send`. This path does
 * the opposite of creating one — it REQUIRES the existing row and re-uses its
 * id, its frozen bytes, its sequence and its mailbox. One approved message, one
 * execution record, however many attempts.
 */

/** Why an explicit re-execution was refused. */
export const RETRY_REFUSAL = Object.freeze({
  EXECUTION_NOT_FOUND: 'EXECUTION_NOT_FOUND',
  /**
   * THE STATE IS WRONG — accepted, unresolved, cancelled, or in flight right
   * now. Deliberately one code for all of them at the boundary, with the state
   * named in the message: a caller does not need a different verb per state,
   * and enumerating them would invite somebody to handle one of them specially.
   */
  EXECUTION_NOT_RETRYABLE: 'EXECUTION_NOT_RETRYABLE',
  /**
   * IT IS FAILED, AND NOTHING PROVES IT NEVER LEFT.
   *
   * The distinction this whole module rests on. A provider rejection is also
   * FAILED, and re-sending it would hand the provider the same request to
   * refuse again — or, if the classification were ever wrong, hand a coach a
   * second copy. Absence of proof is a refusal here, never a default.
   */
  NO_PRE_TRANSPORT_EVIDENCE: 'NO_PRE_TRANSPORT_EVIDENCE',
  /** The frozen bytes are gone or incomplete; there is nothing safe to resend. */
  EXECUTION_SNAPSHOT_INCOMPLETE: 'EXECUTION_SNAPSHOT_INCOMPLETE',
  /** A caller named a different mailbox. A retry is of the same execution. */
  RETRY_MAILBOX_MISMATCH: 'RETRY_MAILBOX_MISMATCH',
  /** Somebody else reclaimed it first, or it is already in flight. */
  RETRY_CLAIM_LOST: 'RETRY_CLAIM_LOST',
  /** Another message on this relationship is open; the guard would refuse it. */
  RELATIONSHIP_HAS_OPEN_MESSAGE: 'RELATIONSHIP_HAS_OPEN_MESSAGE',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * IS THERE PROOF THAT NOTHING WAS EVER SUBMITTED FOR THIS MESSAGE?
 *
 * ===========================================================================
 * SET-BASED, NOT ORDER-BASED, AND THAT IS WHY IT IS TRUSTWORTHY.
 *
 * The obvious implementation is "look at the most recent result event". It is
 * also wrong, in a way that only shows up later: events are ordered by
 * (observed_at, id), two results written in the same second tie on the first
 * and fall back to a UUID, and the answer to "may this be sent again" would
 * then depend on which random identifier sorted higher.
 *
 * So the question is asked of the whole history instead, and of the ledger —
 * which is the record that actually knows. Every execution round reserves
 * exactly one `outbound_send_attempt` and settles it:
 *
 *   SUBMITTED_OR_AMBIGUOUS    a provider was reached, or may have been
 *   REFUSED_BEFORE_TRANSPORT  provably not
 *   RESERVED                  a round that never reported back
 *   NULL                      a legacy row, outside this model entirely
 *
 * "No row for this send is anything but REFUSED_BEFORE_TRANSPORT, and at least
 * one exists" is therefore the exact statement that no submission has EVER
 * occurred for this message — which is stronger than anything the latest event
 * could say, and has no ordering in it at all.
 *
 * A `RESERVED` ROW MAKES IT INELIGIBLE, and that is the fail-closed direction
 * required by D5.0's crash rule: the process that would have said what happened
 * is gone, so nobody can prove the message did not leave.
 * ===========================================================================
 *
 * TWO INDEPENDENT RECORDS MUST AGREE. The ledger says no submission ever
 * happened; the event log must also carry a `TRANSPORT_REFUSED` written by the
 * result boundary. Either alone would be enough on a correct system, and
 * requiring both means a single wrong write cannot license a resend.
 */
const LEDGER_EVIDENCE = db.prepare(`
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN disposition = @refused THEN 1 ELSE 0 END) AS refused
    FROM outbound_send_attempt
   WHERE outreach_send_id = @sendId
`);

const REFUSAL_EVENTS = db.prepare(`
  SELECT COUNT(*) AS n FROM outreach_send_event
   WHERE outreach_send_id = @sendId AND type = @type
`);

export function preTransportRefusalEvidence(sendId) {
  const ledger = LEDGER_EVIDENCE.get({
    sendId, refused: OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT,
  });
  const total = Number(ledger?.total ?? 0);
  const refused = Number(ledger?.refused ?? 0);
  const events = Number(REFUSAL_EVENTS.get({
    sendId, type: SEND_EVENT_TYPE.TRANSPORT_REFUSED,
  })?.n ?? 0);

  return {
    attempts: total,
    refusedAttempts: refused,
    refusalEvents: events,
    /** Every attempt ever made for this message is a proven non-send. */
    provenNeverSubmitted: total > 0 && refused === total && events > 0,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * RECLAIM A REFUSED EXECUTION AND PAY FOR A FRESH ATTEMPT.
 *
 * ---------------------------------------------------------------------------
 * ONE IMMEDIATE TRANSACTION, AND THE ORDER INSIDE IT IS THE ORDINARY CLAIM'S.
 *
 *   evidence -> safety -> reclaim the row -> and only then the budget.
 *
 * The reclaim comes before the spend for the same reason D4.5 put the claim
 * before the budget: two callers may reach here for one message, exactly one
 * wins the guarded UPDATE, and the loser must have spent nothing. Capacity is
 * never refunded, so a loser that paid would have paid permanently.
 *
 * NOTHING AWAITS IN HERE. The transport runs after this returns, exactly as it
 * does for the ordinary claim — see the note in executionClaim.js.
 * ---------------------------------------------------------------------------
 *
 * @param {string} args.outreachSendId   the existing execution to re-attempt.
 * @param {string} args.operatorUserId   from the session; never a field.
 * @param {string} [args.connectedMailboxId] if given, MUST equal the frozen one.
 * @returns the same shape the ordinary claim returns, so one orchestrator can
 *   drive both without knowing which produced it.
 */
export function reclaimRefusedExecution({
  outreachSendId, operatorUserId, connectedMailboxId = null,
  runId = RUN_ID, at = utcNow(), onDate = utcToday(), window = undefined,
  athleteLimit = undefined, mailboxLimit = undefined,
} = {}) {
  for (const [name, value] of [
    ['outreachSendId', outreachSendId],
    ['operatorUserId', operatorUserId],
    ['runId', runId],
  ]) {
    if (typeof value !== 'string' || !value.trim()) {
      throw fail('EXECUTION_RETRY_ARGUMENT_REQUIRED', `A re-execution needs ${name}.`);
    }
  }
  return RECLAIM.immediate({
    outreachSendId, operatorUserId, connectedMailboxId, runId, at, onDate, window,
    athleteLimit, mailboxLimit,
  });
}

const RECLAIM = db.transaction(({
  outreachSendId, operatorUserId, connectedMailboxId, runId, at, onDate, window,
  athleteLimit, mailboxLimit,
}) => {
  /* ---- 1. the execution this is a re-attempt of -------------------------- */
  const send = sendById(outreachSendId);
  if (!send) {
    throw fail(RETRY_REFUSAL.EXECUTION_NOT_FOUND, `No outreach_send ${outreachSendId}`);
  }
  if (!send.programme_message_id) {
    /**
     * A LEGACY OR MANUAL SEND. It has no approved composition behind it, no
     * campaign safety rules that could be re-asked, and no frozen wire body —
     * it handed a message to Outlook and that was that. Retrying one here would
     * be inventing an execution boundary it never crossed.
     */
    throw fail(RETRY_REFUSAL.EXECUTION_NOT_RETRYABLE,
      'This send was not made through a campaign execution, so there is nothing to re-attempt.');
  }

  /* ---- 2. only FAILED, and only with proof ------------------------------ */
  /**
   * THE STATE IS CHECKED BEFORE THE EVIDENCE, so an ACCEPTED or UNRESOLVED
   * message is refused for what it IS rather than for what its ledger says.
   * An operator told "no evidence of a pre-transport refusal" about a message
   * that was accepted an hour ago would reasonably think the system had lost
   * it.
   */
  if (send.state !== MESSAGE_STATE.FAILED) {
    throw fail(RETRY_REFUSAL.EXECUTION_NOT_RETRYABLE,
      send.state === MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT
        ? 'We do not know whether the provider accepted this message, so it may already be in '
          + 'the coach\'s inbox. It cannot be sent again — somebody has to establish what '
          + 'happened to it first.'
        : `This message is ${send.state}, and only a message that failed before reaching a `
          + 'provider may be attempted again.');
  }

  const evidence = preTransportRefusalEvidence(outreachSendId);
  if (!evidence.provenNeverSubmitted) {
    throw fail(RETRY_REFUSAL.NO_PRE_TRANSPORT_EVIDENCE,
      'This message failed, but nothing on file proves it never reached a provider — a '
      + 'provider may have received and refused it, or an attempt may have been left '
      + 'unresolved. Only a failure we can prove happened before any submission may be '
      + 'attempted again.');
  }

  /* ---- 3. the frozen bytes, which are what makes this a RE-attempt ------- */
  /**
   * NOTHING IS REGENERATED, AND THAT IS THE POINT OF RETRYING THIS ROW RATHER
   * THAN COMPOSING A NEW ONE. `executionContent` is not imported here and must
   * never be: five of its seven inputs are mutable — the athlete's name, their
   * public slug, and three environment variables — so re-deriving the body
   * would transmit different bytes under a row that attests to the originals.
   * The recipient, subject, body and wire hash all come back off the row.
   */
  const snapshot = executionSnapshot(outreachSendId);
  if (!snapshot?.complete) {
    throw fail(RETRY_REFUSAL.EXECUTION_SNAPSHOT_INCOMPLETE,
      'The frozen execution for this message is incomplete, so there is nothing safe to send '
      + 'again.');
  }

  /* ---- 4. the same mailbox, never a substitute -------------------------- */
  /**
   * A RETRY IS OF ONE EXECUTION IDENTITY, AND THE MAILBOX IS PART OF IT.
   *
   * `outreach_send.sending_identity` is the address this message was authorised
   * to go from, and it is already on the row, already in the ledger that paid
   * for it, and already the provenance every later reader will trust. Letting a
   * caller swap it would re-point a send at a different inbox after the fact —
   * changing who the coach sees it from, and moving the spend to a mailbox that
   * never agreed to it.
   *
   * A caller MAY name the mailbox, and it is then checked rather than used: an
   * API that silently ignored the field would be worse than one that refuses.
   * Changing mailbox is a new message, not a retry of this one.
   */
  const frozenMailboxId = snapshot.mailboxId;
  if (connectedMailboxId && connectedMailboxId !== frozenMailboxId) {
    throw fail(RETRY_REFUSAL.RETRY_MAILBOX_MISMATCH,
      'A re-attempt goes from the mailbox the message was authorised to be sent from. Sending '
      + 'it from a different one is a new decision, not a repeat of this one.');
  }

  /* ---- 5. everything the ordinary claim asks, asked again --------------- */
  /**
   * THE SAME FUNCTION THE ORDINARY CLAIM CALLS. Campaign state, stance,
   * suppression, revocation, response, first-touch review, step agreement,
   * follow-up timing, the recipient's address, the per-inbox send cap, and the
   * mailbox's own validity — all of it re-established now, because the world
   * has moved since the refusal.
   */
  const found = programmeMessageWithContext(send.programme_message_id);
  if (!found) {
    throw fail(CLAIM_REFUSAL.PROGRAMME_MESSAGE_NOT_FOUND,
      `The composition behind ${outreachSendId} no longer exists.`);
  }
  const { message, context } = found;
  const { identity } = assertExecutionSafety({
    message, context, operatorUserId, connectedMailboxId: frozenMailboxId, onDate, window,
  });

  /* ---- 6. nothing else on this relationship is open --------------------- */
  /**
   * `idx_outreach_send_one_open` allows one open message per relationship, and
   * this is about to reopen one. If a different message has been drafted for
   * this coach since the failure, the index would refuse the reclaim with a
   * constraint error; saying so in words first is the difference between an
   * operator knowing what to do and reading a SQLite message.
   */
  const open = openSendFor(send.outreach_id);
  if (open && open.id !== send.id) {
    throw fail(RETRY_REFUSAL.RELATIONSHIP_HAS_OPEN_MESSAGE,
      'Another message to this coach is already open. It has to be resolved before this one '
      + 'can be attempted again.');
  }

  /* ---- 7. the reclaim, BEFORE the budget -------------------------------- */
  /**
   * FAILED -> QUEUED -> SENDING, ON THE EXISTING GRAPH AND WITH THE EXISTING
   * PRIMITIVE.
   *
   * Both steps are already legal — `LEGAL_TRANSITIONS.FAILED` is ['QUEUED'] and
   * QUEUED is in `CLAIMABLE` — so nothing here widens the state machine, adds a
   * state, or teaches `claimSendForExecution` a new trick. QUEUED is not a
   * decorative intermediate: it is the state that MEANS "ready to be claimed",
   * and going FAILED -> SENDING directly would require adding an edge whose
   * only purpose was to save one write.
   *
   * ONE WINNER, DECIDED BY THE DATABASE. Two simultaneous retries both enter
   * this transaction; the first commits with the row at SENDING, and the second
   * — serialised behind the immediate write lock — finds FAILED gone and its
   * own `transitionSend` refused by the graph. There is no window in which both
   * reserve capacity, because the reclaim happens before the spend.
   */
  transitionSend(send.id, MESSAGE_STATE.QUEUED, { at, advanceAttempt: false });
  const { claimed, send: claimedSend } = claimSendForExecution(send.id, { runId, at });
  if (!claimed) {
    throw fail(RETRY_REFUSAL.RETRY_CLAIM_LOST,
      `This message is already ${claimedSend?.state ?? 'claimed'} — somebody else is attempting `
      + 'it. Nothing was claimed and no capacity was spent.');
  }

  /* ---- 8. a NEW reservation, at today's ceilings ------------------------ */
  /**
   * A SECOND LEDGER ROW, NEVER A REUSE OF THE FIRST. The earlier one stands
   * where it is, settled REFUSED_BEFORE_TRANSPORT and no longer counting; this
   * one is RESERVED and counts from now. That is what makes the arithmetic
   * honest across a retry: three attempts leave three rows, and only the ones
   * that actually reached a provider ever spent anything.
   *
   * TODAY'S BUDGET, NOT THE ORIGINAL DAY'S. The window is the current one, so a
   * message refused yesterday is paid for out of today's allowance — which is
   * correct, because today is when the mailbox would do the sending.
   */
  const { attempt } = recordOutboundAttempt({
    outreachId: send.outreach_id,
    athleteId: context.athleteId,
    sendingIdentity: identity,
    transport: TRANSPORT.PROVIDER_API,
    outreachSendId: send.id,
    disposition: OUTBOUND_ATTEMPT_DISPOSITION.RESERVED,
    at,
    ...(window ? { window } : {}),
    ...(athleteLimit === undefined ? {} : { athleteLimit }),
    ...(mailboxLimit === undefined ? {} : { mailboxLimit }),
  });

  return {
    send: sendById(send.id),
    outreach: { id: send.outreach_id },
    attemptId: message.programme_contact_attempt_id,
    programmeMessageId: message.id,
    mailbox: {
      id: frozenMailboxId, provider: snapshot.provider, sendingIdentity: identity,
    },
    step: message.step,
    ledgerAttemptId: attempt.id,
    /** The SAME frozen bytes, read back from the same row. */
    execution: executionSnapshot(send.id),
    /** So a caller can say this was a re-attempt without inferring it. */
    reattempt: true,
    priorAttempts: evidence.attempts,
  };
});
