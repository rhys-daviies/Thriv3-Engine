import db from '../db/client.js';
import { utcNow } from './time.js';
import { transitionSend, appendSendEvent, sendById } from './outreachSend.js';
import { advanceAttemptForConfirmedSend } from './contactAttempts.js';
import { TRANSPORT_OUTCOME } from './outboundTransport.js';
import {
  MESSAGE_STATE, ACCEPTED_SOURCE, SEND_EVENT_TYPE,
} from '../../shared/outreachMessageState.js';

/**
 * WHAT THE PROVIDER SAID, WRITTEN DOWN ONCE — D4.7.
 *
 * ===========================================================================
 * THE ONE PLACE A TRANSPORT OUTCOME BECOMES DURABLE.
 *
 * Three outcomes, three states, three events, and no other module may write
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
 * THE BUDGET IS NEVER TOUCHED, ON ANY OUTCOME.
 *
 * `outbound_send_attempt` was written inside the claim, before the provider was
 * called, and it stays exactly as it was. A refusal is not a refund: the
 * attempt was made, and on UNKNOWN the message may genuinely be in an inbox.
 * Handing capacity back would let a mailbox spend a day's allowance twice for
 * one transmission, which is the failure the ledger exists to prevent.
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
const ACCEPT = db.transaction(({ sendId, result, at }) => {
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

  return { persisted: true, alreadyResolved: false, state: MESSAGE_STATE.ACCEPTED };
});

/* -------------------------------------------------------------------------- */
/* REJECTED and UNKNOWN — one transaction each, state plus its event           */
/* -------------------------------------------------------------------------- */

const SETTLE = db.transaction(({ sendId, state, type, at, payload, observedAt }) => {
  const settled = alreadySettled(sendId);
  if (settled) return settled;

  transitionSend(sendId, state, { at });
  appendSendEvent({
    sendId, type, source: RESULT_SOURCE, observedAt: observedAt ?? at, at, payload,
  });

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
 * @returns {{persisted, alreadyResolved, state, send}}
 */
export function persistTransportResult(sendId, result, { at = utcNow() } = {}) {
  if (typeof sendId !== 'string' || !sendId.trim()) {
    throw fail('RESULT_SEND_ID_REQUIRED', 'Recording a transport outcome needs the send it belongs to.');
  }

  const outcome = result?.outcome;

  let out;
  switch (outcome) {
    case TRANSPORT_OUTCOME.ACCEPTED:
      out = ACCEPT.immediate({ sendId, result, at });
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
          const advance = advanceAttemptForConfirmedSend({
            programmeCampaignId: accepted?.programme_campaign_id ?? null,
            coachId: accepted?.coach_id ?? null,
            at,
          });
          out = {
            ...out,
            bookkeeping: {
              advanced: Boolean(advance?.changed),
              reason: advance?.reason ?? null,
              error: null,
            },
          };
        } catch (err) {
          /**
           * SAID OUT LOUD, because a step that silently stopped tracking a
           * campaign is a thing somebody has to be able to find. D4.8 owns the
           * repair; this owns not losing the acceptance over it.
           */
          console.error('[executionResult] acceptance recorded, attempt advancement failed',
            { sendId, code: err?.code, message: err?.message });
          out = {
            ...out,
            bookkeeping: {
              advanced: false,
              reason: 'THREW',
              error: err?.code ?? 'ATTEMPT_ADVANCE_FAILED',
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
      });
      break;

    default:
      throw fail('UNKNOWN_TRANSPORT_OUTCOME',
        `"${outcome}" is not a transport outcome. A result that cannot be classified must not `
        + 'be guessed at: leave the message SENDING and let recovery call it unknown.');
  }

  return { ...out, send: sendById(sendId) };
}
