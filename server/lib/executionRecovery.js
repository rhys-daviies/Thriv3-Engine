import db from '../db/client.js';
import { utcNow } from './time.js';
import { RUN_ID } from './executionRun.js';
import { transitionSend, appendSendEvent } from './outreachSend.js';
import { MESSAGE_STATE, SEND_EVENT_TYPE } from '../../shared/outreachMessageState.js';

/**
 * WHAT A DEAD PROCESS LEFT BEHIND — D4.6.
 *
 * A message is claimed for execution and the process dies. The row stays
 * SENDING for ever, and SENDING means "a transport is working on it" — so the
 * relationship is blocked by a claim nobody holds, and the one question that
 * matters, did this message reach the coach, has no answer anywhere.
 *
 * This is the answer, and it is the honest one: WE DO NOT KNOW. The prior
 * process may have died before it opened a socket, while the request body was
 * in flight, or after the provider accepted and before the local write. Nothing
 * this process can read distinguishes those, so nothing here guesses between
 * them. The row becomes UNKNOWN_PROVIDER_RESULT and an event records why.
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS IT WOULD BE EASIER TO DO, AND WHY EACH IS WRONG.
 *
 *   REQUEUE IT.   A message that may already be in a coach's inbox would be
 *                 sent a second time. The state graph makes this impossible
 *                 rather than merely discouraged: UNKNOWN_PROVIDER_RESULT has
 *                 no edge to QUEUED and none to SENDING, so no code path —
 *                 including one nobody has written yet — can hand it back to a
 *                 transport. This module relies on that and adds no rule of
 *                 its own.
 *   FAIL IT.      FAILED is retryable by design, so calling it FAILED is
 *                 requeueing it with extra steps, and it asserts a refusal no
 *                 provider made.
 *   ACCEPT IT.    It claims a send nobody watched leave. That is what
 *                 PROVIDER_RECONCILED exists for, later, when somebody has
 *                 actually looked in the sent mailbox.
 * ---------------------------------------------------------------------------
 *
 * IT IS RECONSTRUCTION, NOT PERMISSION, which is why it asks nothing about
 * campaigns, stances, suppressions, first-touch holds, send caps, budgets,
 * mailboxes, credentials or recipient addresses. Those decide whether a message
 * MAY BE SENT. This one is about a message that was already claimed and may
 * already have gone: a campaign closing afterwards cannot make an ambiguous
 * send unambiguous, and refusing to record the ambiguity because the campaign
 * closed would leave the row lying in SENDING for ever.
 *
 * NO TRANSPORT, NO PROVIDER, NO CREDENTIAL, NO NETWORK, AND NOTHING ASYNC. It
 * reads two columns and writes two rows.
 */

/** The `source` every row this sweep writes carries. */
export const RECOVERY_SOURCE = 'RECOVERY_SWEEP';
/** The `payload.reason` behind it — what was observed, not what a provider did. */
export const RECOVERY_REASON = 'PRIOR_PROCESS_CLAIM';

/**
 * EVERY CLAIM THIS PROCESS DOES NOT HOLD.
 *
 * Bounded to SENDING, and `idx_outreach_send_claim (claim_run_id, claimed_at)
 * WHERE state = 'SENDING'` — created by D4.4 for exactly this read — is the
 * whole of what gets scanned. No other state is examined and none is written.
 *
 * ---------------------------------------------------------------------------
 * A NULL OWNER IS SWEPT TOO, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.
 *
 * `claimSendForExecution` is the only thing in this build that writes SENDING,
 * it refuses an empty run id, and it sets the state and the owner in ONE
 * UPDATE — so no row it produces can be SENDING without an owner. But
 * `transitionSend` is exported, DRAFT → SENDING and QUEUED → SENDING are legal
 * edges in the graph, and that path writes `state` alone. Nothing calls it that
 * way today; the column is nullable and the path exists, so the case is
 * possible rather than impossible and is not asserted away.
 *
 * It is swept because ownership has to be PROVEN, not assumed. The only
 * evidence this process owns a claim is its own run id written on the row, and
 * a row carrying no run id offers none. Treating a missing owner as "mine"
 * would mean a restart adopts an in-flight message it never claimed — the one
 * mistake the whole run-id mechanism exists to prevent — and leaving it alone
 * would block the relationship for ever with no record of why.
 *
 * Nothing becomes sendable either way: SENDING is not claimable, so an
 * ownerless row could never have been re-executed, and UNKNOWN_PROVIDER_RESULT
 * cannot be either. The payload records `priorClaimRunId: null` truthfully
 * rather than inventing an owner for it.
 * ---------------------------------------------------------------------------
 */
const ABANDONED = db.prepare(`
  SELECT id, claim_run_id, claimed_at
    FROM outreach_send
   WHERE state = 'SENDING'
     AND (claim_run_id IS NULL OR claim_run_id <> @currentRunId)
   ORDER BY claimed_at, id
`);

const STATE_OF = db.prepare('SELECT state FROM outreach_send WHERE id = ?');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * ONE TRANSACTION FOR THE WHOLE SWEEP, and per row the transition and its
 * event go in together or neither does.
 *
 * A row moved to UNKNOWN_PROVIDER_RESULT with no event beside it is a message
 * nobody can explain: the state says the outcome is unknown and there is
 * nothing on file saying which run abandoned it or when. So if the append
 * throws, the transition it belongs to is rolled back with it and the row stays
 * SENDING — recoverable by the next boot, which is a better place to be than
 * silently unexplained.
 */
const SWEEP = db.transaction(({ currentRunId, at }) => {
  const sendIds = [];

  for (const row of ABANDONED.all({ currentRunId })) {
    /**
     * THE GUARD, AND THE REASON AN EVENT IS NEVER WRITTEN ON A LOST RACE.
     *
     * Two checks, because they fail differently. The state is re-read in case
     * the row moved after it was listed, and `changed` is read because
     * `transitionSend` reports a same-state call as a no-op rather than an
     * error. Either one means this sweep did not move the row — so this sweep
     * has nothing to record about it, and an event written anyway would be a
     * second, false account of one transition.
     */
    if (STATE_OF.get(row.id)?.state !== MESSAGE_STATE.SENDING) continue;

    const moved = transitionSend(row.id, MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT, { at });
    if (!moved.changed) continue;

    appendSendEvent({
      sendId: row.id,
      type: SEND_EVENT_TYPE.TRANSPORT_UNKNOWN,
      source: RECOVERY_SOURCE,
      /**
       * NO CONFIDENCE VALUE, and the column's own rule is why: it grades a
       * source that cannot be certain, and is NULL when the question does not
       * arise. It does not arise here. What was OBSERVED — this row was
       * SENDING, and the run that claimed it is not this one — is read straight
       * off the row and is certain. The uncertainty is in the provider's
       * outcome, which is what the TRANSPORT_UNKNOWN type already says; grading
       * it would be inventing a scale for a fact nobody measured.
       */
      observedAt: at,
      at,
      payload: {
        reason: RECOVERY_REASON,
        /** Null when the row carried no owner — see ABANDONED above. */
        priorClaimRunId: row.claim_run_id ?? null,
        claimedAt: row.claimed_at ?? null,
        recoveredByRunId: currentRunId,
      },
    });

    sendIds.push(row.id);
  }

  return { recovered: sendIds.length, sendIds };
});

/**
 * Resolve every execution claim a previous process left behind.
 *
 * Called ONCE, by the server's boot, before the application accepts a request.
 * Importing this module runs nothing.
 *
 * IDEMPOTENT WITHOUT A MARKER OF ITS OWN. The state transition is the marker: a
 * row recovered on one boot is no longer SENDING, so the next boot does not
 * list it and writes no second event. A flag column would be a second record of
 * the same fact, free to disagree with the first.
 *
 * NOTHING IS REFUNDED AND NOTHING ADVANCES. The `outbound_send_attempt` row
 * stays exactly as it was — capacity was genuinely spent on a transmission
 * that may have happened, and a refund would hand back a day's allowance for a
 * message that may already be in an inbox. The `programme_contact_attempt`
 * stays where it is too: only an ACCEPTED message moves a campaign's step, and
 * "we do not know" is not acceptance.
 *
 * @returns {{recovered: number, sendIds: string[]}} ids only — a recovery
 *   result is logged at boot, and a message body has no business in a log line.
 */
export function recoverPriorRunSendingClaims({ currentRunId = RUN_ID, at = utcNow() } = {}) {
  if (typeof currentRunId !== 'string' || !currentRunId.trim()) {
    throw fail('RECOVERY_RUN_ID_REQUIRED',
      'A recovery sweep must say which run is running it. Without one, every claim on file '
      + 'looks like somebody else\'s and a live message would be declared unknown underneath '
      + 'the transport still working on it.');
  }
  return SWEEP.immediate({ currentRunId: currentRunId.trim(), at });
}
