import db from '../db/client.js';
import { utcNow } from './time.js';
import { transitionSend, appendSendEvent, sendById } from './outreachSend.js';
import { reconcileProgrammeContactAttempt, attemptForCoach } from './contactAttempts.js';
import { TRANSPORT_OUTCOME } from './outboundTransport.js';
import { settleOutboundAttempt, OUTBOUND_ATTEMPT_DISPOSITION } from './outboundBudget.js';
import {
  MESSAGE_STATE, ACCEPTED_SOURCE, SEND_EVENT_TYPE,
} from '../../shared/outreachMessageState.js';

/**
 * WHAT THE PROVIDER SAID, WRITTEN DOWN ONCE — D4.7.
 *
 * ===========================================================================
 * THE ONE PLACE A TRANSPORT OUTCOME BECOMES DURABLE.
 *
 * Four outcomes, three states, four events, and no other module may write
 * any of them:
 *
 *   ACCEPTED   SENDING -> ACCEPTED, accepted_source PROVIDER_ACCEPTED, the
 *              provider's own identifiers, one ACCEPTED event.
 *   REJECTED   SENDING -> FAILED, one TRANSPORT_REJECTED event carrying what
 *              the provider actually said.
 *   UNKNOWN    SENDING -> UNKNOWN_PROVIDER_RESULT, one TRANSPORT_UNKNOWN
 *              event. No retry, ever, by any path — the state graph refuses it.
 * ===========================================================================
 *
 * IT IS NOT `executionResolution`. That module is F11's read-only preview for
 * a screen: it answers "what WOULD go", writes nothing, and stays that way.
 * This one answers "what HAPPENED" and is the only writer of the answer.
 *
 * ---------------------------------------------------------------------------
 * NO LEDGER ROW IS EVER REMOVED, ON ANY OUTCOME. ITS VERDICT IS SETTLED — D5.0.
 *
 * `outbound_send_attempt` was written inside the claim, before the provider was
 * called, and the row itself still stays exactly where it is. What this module
 * now adds is the answer to what became of it, in the same transaction as the
 * state and the event it belongs with:
 *
 *   ACCEPTED / REJECTED / UNKNOWN   SUBMITTED_OR_AMBIGUOUS. All three consume,
 *      and UNKNOWN consuming is the important one: an ambiguous send may
 *      genuinely be in an inbox, and handing its capacity back would let one
 *      transmission be paid for twice.
 *   REFUSED_BEFORE_TRANSPORT        released. The transport PROVED it never
 *      submitted anything, so no mailbox spent any of the world's attention.
 *
 * A REFUSAL IS STILL NOT A REFUND. Nothing is deleted and nothing decremented;
 * a row that never represented a transmission simply stops being counted as
 * one. See OUTBOUND_ATTEMPT_DISPOSITION for why that is a different thing.
 * ---------------------------------------------------------------------------
 *
 * AND THE ATTEMPT ADVANCES ONLY FOR ACCEPTED, IN ITS OWN TRANSACTION. See the
 * two-transaction note on `persistAccepted` below — the reason is the D4.1
 * principle that provider acceptance is primary truth.
 */

/** Every row this module writes carries this, and D4.6's sweep carries its own. */
export const RESULT_SOURCE = 'PROVIDER_TRANSPORT';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const PROVIDER_METADATA = db.prepare(`
  UPDATE outreach_send
     SET provider_message_id  = COALESCE(@providerMessageId, provider_message_id),
         provider_thread_id   = COALESCE(@providerThreadId, provider_thread_id),
         internet_message_id  = COALESCE(@internetMessageId, internet_message_id),
         provider_accepted_at = COALESCE(@providerAcceptedAt, provider_accepted_at)
   WHERE id = @sendId
`);

const trimmed = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * ALREADY SETTLED MEANS NOTHING HAPPENS — and it is not an error.
 *
 * A caller that lost its answer and asked again, a retried job, an operator
 * pressing a button twice: all of them arrive here with a message that is no
 * longer SENDING. Writing a second event would double-count one transmission,
 * and reopening a terminal state would be worse. So the durable truth is
 * returned as it stands, labelled, and nothing is written.
 */
function alreadySettled(sendId) {
  const row = sendById(sendId);
  if (!row) throw fail('SEND_NOT_FOUND', `No outreach_send ${sendId}`);
  if (row.state === MESSAGE_STATE.SENDING) return null;
  return { persisted: false, alreadyResolved: true, state: row.state, send: row };
}

/* -------------------------------------------------------------------------- */
/* ACCEPTED — two transactions, and the split is the whole point               */
/* -------------------------------------------------------------------------- */

/**
 * TXN 2a. The provider's answer and nothing else.
 *
 * Deliberately minimal, and `advanceAttempt: false` is why: the campaign's step
 * does NOT move in here. `transitionSend` would normally advance it in the same
 * transaction, which is right for the Outlook path and wrong for this one — a
 * failure in a campaign table would roll back the record that a real email
 * reached a real coach.
 *
 * `PROVIDER_ACCEPTED`, never `PROVIDER_RECONCILED`: we watched this one leave.
 */
/**
 * SETTLE THE RESERVATION THIS EXECUTION TOOK, INSIDE THE CALLER'S TRANSACTION.
 *
 * ---------------------------------------------------------------------------
 * BY EXPLICIT LEDGER ID, NEVER BY RECENCY.
 *
 * `ledgerAttemptId` comes off the claim result and names the exact row that
 * reserved capacity for THIS attempt. A message that has been retried has
 * several, they can share an `attempted_at` to the second, and "the latest row
 * for this send" would eventually settle the wrong one — releasing capacity a
 * real transmission spent, which is the one accounting error that costs a coach
 * a duplicate email.
 *
 * OPTIONAL, AND SILENTLY SO. The recovery sweep and D4.7's own tests persist
 * results for sends whose ledger id they never held, and a throw here would
 * unwind a durable provider truth over a bookkeeping pointer. A caller that
 * knows the id gets the settlement; one that does not leaves the row at
 * RESERVED, which counts — the fail-closed direction.
 * ---------------------------------------------------------------------------
 */
function settleLedger(ledgerAttemptId, disposition) {
  if (typeof ledgerAttemptId !== 'string' || !ledgerAttemptId.trim()) return null;
  return settleOutboundAttempt(ledgerAttemptId, disposition);
}

const ACCEPT = db.transaction(({ sendId, result, at, ledgerAttemptId }) => {
  const settled = alreadySettled(sendId);
  if (settled) return settled;

  transitionSend(sendId, MESSAGE_STATE.ACCEPTED, {
    acceptedSource: ACCEPTED_SOURCE.PROVIDER_ACCEPTED,
    at,
    advanceAttempt: false,
  });

  PROVIDER_METADATA.run({
    sendId,
    providerMessageId: trimmed(result.providerMessageId),
    providerThreadId: trimmed(result.providerThreadId),
    internetMessageId: trimmed(result.internetMessageId),
    /** When the provider said yes, falling back to when we wrote it down. */
    providerAcceptedAt: trimmed(result.acceptedAt) ?? at,
  });

  appendSendEvent({
    sendId,
    type: SEND_EVENT_TYPE.ACCEPTED,
    source: RESULT_SOURCE,
    observedAt: trimmed(result.acceptedAt) ?? at,
    at,
    payload: {
      providerMessageId: trimmed(result.providerMessageId),
      providerThreadId: trimmed(result.providerThreadId),
      internetMessageId: trimmed(result.internetMessageId),
    },
  });

  /**
   * IN TXN 2a WITH THE ACCEPTANCE, AND THAT IS THE RIGHT SIDE OF THE SPLIT.
   *
   * D4.7's invariant is that provider acceptance becomes durable before any
   * secondary bookkeeping can fail. The ledger verdict is not secondary
   * bookkeeping about a CAMPAIGN — it is the accounting half of the same fact:
   * this mailbox made a request of the outside world. Committing the acceptance
   * without it would leave a real transmission sitting at RESERVED, which reads
   * identically to a crashed send.
   *
   * The campaign's step still moves in TXN 2b, where a failure costs the
   * bookkeeping and not the truth.
   */
  settleLedger(ledgerAttemptId, OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);

  return { persisted: true, alreadyResolved: false, state: MESSAGE_STATE.ACCEPTED };
});

/* -------------------------------------------------------------------------- */
/* REJECTED and UNKNOWN — one transaction each, state plus its event           */
/* -------------------------------------------------------------------------- */

const SETTLE = db.transaction(({
  sendId, state, type, at, payload, observedAt, ledgerAttemptId, disposition,
}) => {
  const settled = alreadySettled(sendId);
  if (settled) return settled;

  transitionSend(sendId, state, { at });
  appendSendEvent({
    sendId, type, source: RESULT_SOURCE, observedAt: observedAt ?? at, at, payload,
  });
  /**
   * THE THIRD WRITE, AND IT BELONGS IN HERE WITH THE OTHER TWO — D5.0.
   *
   * State, event and ledger verdict commit together or not at all. Splitting
   * the disposition into a transaction of its own would make a crash between
   * them leave a message FAILED with its capacity stranded at RESERVED for
   * ever — visibly failed, invisibly still charged, and nothing in the system
   * able to tell that apart from a send that died mid-flight.
   */
  settleLedger(ledgerAttemptId, disposition);

  return { persisted: true, alreadyResolved: false, state };
});

/* -------------------------------------------------------------------------- */

/**
 * PERSIST ONE TRANSPORT OUTCOME.
 *
 * Called AFTER the provider call has returned and the claim has long since
 * committed. Nothing in here awaits and nothing in here calls a provider.
 *
 * @param {string} sendId  the claimed `outreach_send` row.
 * @param {object} result  an `attemptSend` result — `{ outcome, ... }`.
 * @param {string} [opts.ledgerAttemptId]  the `outbound_send_attempt` this
 *   execution reserved, from `ledgerAttemptId` on the claim result — D5.0. The
 *   row whose disposition is settled here. Omitted by callers that never held
 *   one; the reservation then stays RESERVED and keeps counting.
 * @returns {{persisted, alreadyResolved, state, send}}
 */
export function persistTransportResult(sendId, result, {
  at = utcNow(), ledgerAttemptId = null,
} = {}) {
  if (typeof sendId !== 'string' || !sendId.trim()) {
    throw fail('RESULT_SEND_ID_REQUIRED', 'Recording a transport outcome needs the send it belongs to.');
  }

  const outcome = result?.outcome;

  let out;
  switch (outcome) {
    case TRANSPORT_OUTCOME.ACCEPTED:
      out = ACCEPT.immediate({ sendId, result, at, ledgerAttemptId });
      /**
       * TXN 2b — AFTER 2a HAS COMMITTED, and outside it.
       *
       * The campaign's step moves here. If it cannot — no attempt was planned,
       * the pursuit was stopped, or something in a campaign table is broken —
       * the acceptance above is already durable and stays that way. The failure
       * is reported on the result rather than thrown, because a caller that saw
       * an exception might reasonably conclude the send had not been recorded
       * and try again, which is how a coach receives an email twice.
       */
      if (out.persisted) {
        const accepted = sendById(sendId);
        try {
          /**
           * IT REPORTS WHAT IT DID, NOT MERELY THAT IT RAN. The helper answers
           * every case it cannot act on — no attempt was planned, the pursuit
           * was stopped — with a reason rather than an exception, so `advanced:
           * true` on the strength of "nothing threw" would claim a step moved
           * when none did.
           */
          /**
           * DERIVED, NOT INCREMENTED — D4.8.
           *
           * This used to add one to the stored step. Adding one is only right
           * if it happens exactly once, and the whole reason TXN 2b is a
           * separate transaction is that it might not happen at all. So it now
           * re-derives the step and the state from durable ACCEPTED rows: a run
           * that was missed is repaired by the next one, and a run that happens
           * twice changes nothing the second time.
           */
          const attempt = attemptForCoach(
            accepted?.programme_campaign_id ?? null,
            accepted?.coach_id ?? null,
          );
          const rec = attempt
            ? reconcileProgrammeContactAttempt(attempt.id, { at })
            : { reconciled: false, reason: 'NO_ATTEMPT', step: null, state: null, drift: false };
          out = {
            ...out,
            bookkeeping: {
              reconciled: Boolean(rec.reconciled),
              step: rec.step ?? null,
              state: rec.state ?? null,
              drift: Boolean(rec.drift),
              reason: rec.reason ?? null,
              error: null,
            },
          };
        } catch (err) {
          /**
           * SAID OUT LOUD, because a step that silently stopped tracking a
           * campaign is a thing somebody has to be able to find. D4.8 owns the
           * repair; this owns not losing the acceptance over it.
           */
          console.error('[executionResult] acceptance recorded, attempt reconciliation failed',
            { sendId, code: err?.code, message: err?.message });
          out = {
            ...out,
            bookkeeping: {
              reconciled: false,
              step: null,
              state: null,
              drift: false,
              reason: 'THREW',
              error: err?.code ?? 'ATTEMPT_RECONCILE_FAILED',
            },
          };
        }
      }
      break;

    case TRANSPORT_OUTCOME.REJECTED:
      /**
       * AN ANSWER, SO A DEFINITE STATE. FAILED is retryable by a person's
       * decision — the graph allows FAILED -> QUEUED — and nothing here retries
       * anything automatically.
       *
       * The provider's own words are kept in the event and never in a column: a
       * rejection is multi-valued across retries, and columns on one row cannot
       * hold two of them.
       */
      out = SETTLE.immediate({
        sendId,
        state: MESSAGE_STATE.FAILED,
        type: SEND_EVENT_TYPE.TRANSPORT_REJECTED,
        at,
        payload: {
          providerCode: trimmed(result.providerCode),
          providerMessage: trimmed(result.providerMessage),
        },
        ledgerAttemptId,
        /** The provider was reached and answered. The request was made. */
        disposition: OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS,
      });
      break;

    case TRANSPORT_OUTCOME.UNKNOWN:
      /**
       * NO ANSWER THIS PROCESS CAN TRUST, AND THE STATE SAYS SO.
       *
       * `source` is what tells this apart from D4.6's recovery sweep: both
       * append TRANSPORT_UNKNOWN, but one of them watched a transport run and
       * fail to answer, and the other found a claim abandoned by a dead
       * process. Reading them as one fact would make "how often does our
       * transport go silent" unanswerable.
       */
      out = SETTLE.immediate({
        sendId,
        state: MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT,
        type: SEND_EVENT_TYPE.TRANSPORT_UNKNOWN,
        at,
        payload: {
          reason: trimmed(result.reason) ?? 'PROVIDER_RESULT_UNREADABLE',
          detail: trimmed(result.detail),
        },
        ledgerAttemptId,
        /**
         * CONSUMED, AND THIS IS THE LINE THAT MATTERS MOST IN D5.0.
         *
         * The message may be in the coach's inbox. Releasing capacity for a
         * send we cannot rule out would let one transmission be paid for
         * twice — and, worse, would make an ambiguous result look like the
         * provable non-send that a retry is allowed to follow.
         */
        disposition: OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS,
      });
      break;

    case TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT:
      /**
       * NOTHING WAS SUBMITTED, AND THE TRANSPORT PROVED IT — D5.0.
       *
       * =====================================================================
       * FAILED, LIKE A REJECTION, AND RECORDED AS SOMETHING ELSE ENTIRELY.
       *
       * The state is the same because what the message IS is the same: it did
       * not go. The EVENT is different because how it failed is different, and
       * the difference is worth more than a constant —
       *
       *   it is the only evidence that licenses a re-execution. See
       *   executionRetry.js, which will not touch a FAILED row without it.
       *   Pooling this into TRANSPORT_REJECTED would make a genuine provider
       *   refusal look retryable, which is the double send in a third costume.
       *
       *   and it is the only way to answer "how often is our own configuration
       *   broken", separately from "how often does the provider say no".
       * =====================================================================
       *
       * NO PROVIDER METADATA IS WRITTEN. There is no provider message id, no
       * thread id and no acceptance timestamp, because there was no provider
       * interaction to have produced one. `PROVIDER_METADATA` is not reached on
       * this path at all.
       *
       * NO STEP ADVANCES AND NO FOLLOW-UP CLOCK STARTS. Both are consequences
       * of an ACCEPTED send and neither is asked for here: `transitionSend` is
       * given FAILED, and the four-day clock is anchored on
       * `outreach_send.sent_at` of an ACCEPTED row, which this is not. Nothing
       * needs to suppress them; there is simply nothing to advance.
       */
      out = SETTLE.immediate({
        sendId,
        state: MESSAGE_STATE.FAILED,
        type: SEND_EVENT_TYPE.TRANSPORT_REFUSED,
        at,
        payload: {
          reason: trimmed(result.reason) ?? 'REFUSED_BEFORE_TRANSPORT',
          detail: trimmed(result.detail),
          /**
           * Present only where a provider layer had one to give. It is a fact
           * about a request that never became a message, kept because a future
           * reader will want to know how far the attempt got.
           */
          httpStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : null,
          durationMs: Number.isInteger(result.durationMs) ? result.durationMs : null,
        },
        ledgerAttemptId,
        /** The one outcome that releases it. The row itself is never removed. */
        disposition: OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT,
      });
      break;

    default:
      throw fail('UNKNOWN_TRANSPORT_OUTCOME',
        `"${outcome}" is not a transport outcome. A result that cannot be classified must not `
        + 'be guessed at: leave the message SENDING and let recovery call it unknown.');
  }

  return { ...out, send: sendById(sendId) };
}
