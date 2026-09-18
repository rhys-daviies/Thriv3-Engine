import { utcNow, utcToday } from './time.js';
import { programmeMessage, MESSAGE_STATE as CONTENT_STATE } from './programmeMessages.js';
import { claimProgrammeMessageForExecution, executionSnapshot } from './executionClaim.js';
import { attemptSend, TRANSPORT_OUTCOME } from './outboundTransport.js';
import { persistTransportResult } from './executionResult.js';
/**
 * ITS OWN MODULE, so the HTTP route has a seam a test can replace. See the
 * file's own header for why an environment flag would have been worse.
 */
import { productionTransport } from './productionTransport.js';
import { reclaimRefusedExecution } from './executionRetry.js';

/**
 * SENDING ONE REVIEWED MESSAGE, END TO END — D4.9.
 *
 * ===========================================================================
 * IT ORCHESTRATES. IT IS NOT A SEVENTH AUTHORITY.
 *
 * Six steps, and five of them are somebody else's decision:
 *
 *   1  the words a person approved are still the words          (here)
 *   2  a transport exists to send them with                     (here)
 *   3  everything that must be true, atomically      executionClaim
 *   4  the bytes that were frozen                    executionSnapshot
 *   5  hand them to a provider                       outboundTransport
 *   6  write down what it said                       executionResult
 *
 * It holds no policy of its own. No stance, no suppression, no first-touch
 * review, no send cap, no budget, no timing, no mailbox validation, no content
 * generation, no state SQL, no attempt arithmetic and no error classification.
 * Every one of those is asked of the module that owns it, and asked INSIDE the
 * claim's transaction where it matters.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * THE TWO CHECKS IT DOES OWN, AND WHY THEY ARE HERE RATHER THAN IN THE CLAIM.
 *
 * Both are about the CALLER rather than about the campaign, and both must
 * happen before the claim, because the claim consumes budget.
 *
 *   MESSAGE_REVIEW_CHANGED    the client is looking at words that have since
 *      been edited. The claim cannot ask this: it has no idea what the client
 *      was shown. See the note on the precondition below.
 *   TRANSPORT_NOT_CONFIGURED  there is nothing to send with. Asked first of
 *      all, because discovering it after the claim would leave a message
 *      SENDING and a day's capacity spent for a request that could never have
 *      succeeded — and recovery would then have to call that message unknown,
 *      which is a lie about a send that never happened.
 * ---------------------------------------------------------------------------
 */

/** Why an execution request was refused before anything was claimed. */
export const EXECUTION_REFUSAL = Object.freeze({
  /**
   * THE APPROVED WORDS MOVED UNDER THE CLIENT'S FEET.
   *
   * The caller sends the `bodyHash` it was shown. If the stored one differs,
   * somebody edited and re-reviewed the message since — so the person pressing
   * send is approving a body they have not read, which is the one thing review
   * exists to prevent.
   */
  MESSAGE_REVIEW_CHANGED: 'MESSAGE_REVIEW_CHANGED',
  /** Composed but not approved. Quoted from the claim's own vocabulary below. */
  MESSAGE_NOT_REVIEWED: 'MESSAGE_NOT_REVIEWED',
  /**
   * NOTHING CAN SEND THIS YET, AND THAT IS THE HONEST STATE OF THIS BUILD.
   *
   * D4.9 proves the application path with a fake transport. There is no
   * production transport: `productionTransport()` returns null, deliberately,
   * and the route therefore refuses every real request. A real provider is D5.
   */
  TRANSPORT_NOT_CONFIGURED: 'TRANSPORT_NOT_CONFIGURED',
  /**
   * The claim committed but the row it froze is not transportable. Unreachable
   * — the claim's own invariant is that a committed SENDING row carries its
   * bytes — and checked anyway, because the alternative to checking is handing
   * a transport a partial message.
   */
  EXECUTION_SNAPSHOT_INCOMPLETE: 'EXECUTION_SNAPSHOT_INCOMPLETE',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}


/**
 * @param {string} args.programmeMessageId  the reviewed composition to send.
 * @param {string} args.operatorUserId      from the session; never a field.
 * @param {string} args.connectedMailboxId  which of the athlete's mailboxes.
 * @param {string} args.bodyHash            the reviewed hash the client saw.
 * @param {object} [args.transport]         injected by tests; null in production.
 * @returns durable execution truth, read back from the committed rows.
 */
export async function executeProgrammeMessage({
  programmeMessageId, operatorUserId, connectedMailboxId, bodyHash,
  at = utcNow(), onDate = utcToday(),
  transport = productionTransport(),
} = {}) {
  for (const [name, value] of [
    ['programmeMessageId', programmeMessageId],
    ['operatorUserId', operatorUserId],
    ['connectedMailboxId', connectedMailboxId],
    ['bodyHash', bodyHash],
  ]) {
    if (typeof value !== 'string' || !value.trim()) {
      throw fail('EXECUTION_ARGUMENT_REQUIRED', `Sending a message needs ${name}.`);
    }
  }

  /* ---- 1. the words the client is looking at ----------------------------- */
  /**
   * THE REVIEWED COMPOSITION HASH, AND IT IS NOT THE EXECUTION HASH.
   *
   * `programme_messages.body_hash` is the hash of the APPROVED words. It is
   * written by `editProgrammeMessage`, which refuses anything but a `generated`
   * message, and `reviewed` is terminal — so once a message is approved this
   * value cannot change without the message going back through review, which
   * it cannot.
   *
   * `outreach_send.body_hash` is a different thing entirely: the canonical hash
   * of the WIRE body, which does not exist until the claim freezes it. Using
   * that here would be asking the client to predict a value only the server can
   * compute, after the moment this check has to happen.
   */
  const message = programmeMessage(programmeMessageId);
  if (!message) {
    throw fail('PROGRAMME_MESSAGE_NOT_FOUND', `No programme message ${programmeMessageId}`);
  }
  if (message.state !== CONTENT_STATE.REVIEWED) {
    throw fail(EXECUTION_REFUSAL.MESSAGE_NOT_REVIEWED,
      'Nobody has approved these words yet. A message is reviewed before it is sent.');
  }
  if (message.body_hash !== bodyHash) {
    throw fail(EXECUTION_REFUSAL.MESSAGE_REVIEW_CHANGED,
      'This message has been edited since it was loaded, so the body on screen is not the body '
      + 'that would go. Read it again before sending. Nothing was claimed and no capacity was '
      + 'spent.');
  }

  /* ---- 2. something to send it with, BEFORE any capacity is spent -------- */
  if (!transport) {
    throw fail(EXECUTION_REFUSAL.TRANSPORT_NOT_CONFIGURED,
      'No outbound transport is configured on this server, so nothing can be sent. Nothing was '
      + 'claimed and no capacity was spent.');
  }

  /* ---- 3. everything that must be true, atomically ---------------------- */
  /**
   * THE AUTHORITATIVE GATE. Not a preview, and not trusted from one: a
   * readiness answer computed a moment ago describes a world that may already
   * have moved. Every check runs again here, inside the transaction that
   * writes.
   */
  const claimed = claimProgrammeMessageForExecution({
    programmeMessageId, operatorUserId, connectedMailboxId, at, onDate,
  });

  return transmitClaimed(claimed, { transport, at, message });
}

/**
 * HAND ONE CLAIMED EXECUTION TO A TRANSPORT AND WRITE DOWN WHAT CAME BACK.
 *
 * ---------------------------------------------------------------------------
 * SHARED BY BOTH WAYS OF REACHING A PROVIDER — D5.0.
 *
 * A first execution and an explicit re-attempt differ entirely in how they get
 * permission and not at all in what happens afterwards: the same frozen bytes,
 * the same one transport call, the same result boundary, the same durable truth
 * read back. Writing that twice would be two places for the transport contract
 * to drift, and the drift would be invisible until a retry behaved differently
 * from a send.
 *
 * So both claim paths produce the same shape — `{ send, ledgerAttemptId,
 * execution, ... }` — and hand it here.
 * ---------------------------------------------------------------------------
 */
async function transmitClaimed(claimed, { transport, at, message }) {
  /* ---- 4. the bytes that were frozen, read back from the row ------------- */
  const snapshot = executionSnapshot(claimed.send.id);
  if (!snapshot?.complete) {
    throw fail(EXECUTION_REFUSAL.EXECUTION_SNAPSHOT_INCOMPLETE,
      'The claim did not leave a complete frozen execution, so there is nothing safe to send.');
  }

  /* ---- 5. one provider attempt, outside every transaction --------------- */
  /**
   * THE STORED BYTES, NEVER REGENERATED. `executionContent` is not imported
   * here and must never be: re-deriving the body after the claim would
   * transmit something no row on file attests to — five of its seven inputs are
   * mutable. See the freeze note in executionClaim.
   */
  const result = await attemptSend(transport, {
    mailboxId: snapshot.mailboxId,
    to: snapshot.recipientEmail,
    subject: snapshot.subject,
    body: snapshot.body,
    threadRef: null,
    /** A correlation identity, not a provider idempotency promise. */
    idempotencyKey: snapshot.sendId,
  });

  /* ---- 6. what it said, written down once ------------------------------- */
  const persisted = persistTransportResult(claimed.send.id, result, {
    at,
    /**
     * WHICH RESERVATION THIS EXECUTION TOOK — D5.0. Named explicitly so the
     * result boundary settles the row that actually paid for THIS attempt, not
     * whichever row of a retried message happens to sort last.
     */
    ledgerAttemptId: claimed.ledgerAttemptId,
  });

  /**
   * DURABLE TRUTH, READ BACK — never the transport's own answer. A caller must
   * see what is on file, because that is what recovery, reconciliation and the
   * next request will all read.
   */
  return {
    executionId: claimed.send.id,
    programmeMessageId: message.id,
    state: persisted.send.state,
    provider: persisted.send.provider ?? null,
    providerMessageId: persisted.send.provider_message_id ?? null,
    providerThreadId: persisted.send.provider_thread_id ?? null,
    acceptedAt: persisted.send.provider_accepted_at ?? null,
    sentAt: persisted.send.sent_at ?? null,
    acceptedSource: persisted.send.accepted_source ?? null,
    sequence: persisted.send.sequence,
    step: message.step,
    /** Present only for an acceptance; see executionResult's TXN 2b. */
    attempt: persisted.bookkeeping ?? null,
    /**
     * WHAT THE TRANSPORT ITSELF SAID, BESIDE WHAT WAS WRITTEN DOWN — D5.0.
     *
     * The state alone cannot answer the question a caller now has to ask.
     * FAILED is the durable truth for BOTH a provider rejection and a proven
     * non-send, and those mean opposite things about what to do next: one is
     * the provider's considered no, the other is an infrastructure problem that
     * may be fixable in a minute. So the outcome is reported alongside.
     *
     * `retryable` is derived from it rather than from the state, and it is the
     * ONLY place in the response that says a re-attempt is permitted. It is
     * still advisory — `reclaimRefusedExecution` re-establishes every safety
     * rule and may refuse anyway — for exactly the reason executionReadiness
     * carries `claimRechecksEverything`.
     */
    transportOutcome: result?.outcome ?? null,
    retryable: result?.outcome === TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT,
  };
}


/**
 * ATTEMPT AGAIN, ONCE, A MESSAGE THAT PROVABLY NEVER LEFT — D5.0.
 *
 * ===========================================================================
 * EXPLICIT, AND THERE IS NO OTHER KIND.
 *
 * Nothing in this system retries anything by itself. There is no scheduler, no
 * backoff, no loop, and no branch anywhere that turns a failure into a second
 * attempt — `attemptSend` makes exactly one call and both claim paths reserve
 * capacity before it. This function runs because a person or an application
 * asked it to, by naming the execution it is re-attempting.
 * ===========================================================================
 *
 * IT OWNS NO POLICY EITHER. Permission is `reclaimRefusedExecution`, which
 * re-establishes every safety rule through the same `assertExecutionSafety` the
 * ordinary claim uses; the bytes are the ones already frozen on the row; and
 * the result goes through the same boundary as a first send. This orchestrates
 * two calls and holds nothing.
 *
 * THE TRANSPORT CHECK IS STILL FIRST, for the same reason it is in a first
 * send: discovering there is nothing to send with AFTER reclaiming the row
 * would leave the message SENDING and a fresh reservation spent on an attempt
 * that could never have happened.
 *
 * @returns the same shape a first execution returns, plus `reattempt: true`.
 */
export async function reattemptExecution({
  outreachSendId, operatorUserId, connectedMailboxId = null,
  at = utcNow(), onDate = utcToday(),
  transport = productionTransport(),
} = {}) {
  for (const [name, value] of [
    ['outreachSendId', outreachSendId],
    ['operatorUserId', operatorUserId],
  ]) {
    if (typeof value !== 'string' || !value.trim()) {
      throw fail('EXECUTION_ARGUMENT_REQUIRED', `Re-attempting a message needs ${name}.`);
    }
  }

  if (!transport) {
    throw fail(EXECUTION_REFUSAL.TRANSPORT_NOT_CONFIGURED,
      'No outbound transport is configured on this server, so nothing can be sent. Nothing was '
      + 'reclaimed and no capacity was spent.');
  }

  const claimed = reclaimRefusedExecution({
    outreachSendId, operatorUserId, connectedMailboxId, at, onDate,
  });

  const out = await transmitClaimed(claimed, {
    transport,
    at,
    message: { id: claimed.programmeMessageId, step: claimed.step },
  });
  return { ...out, reattempt: true, priorAttempts: claimed.priorAttempts };
}
