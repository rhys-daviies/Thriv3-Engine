/**
 * HANDING ONE FROZEN MESSAGE TO SOMETHING THAT SENDS IT — D4.7.
 *
 * ===========================================================================
 * A TRANSPORT ENCODES AN EMAIL. IT DOES NOT DECIDE ONE.
 *
 * Everything editorial is settled before this is called: the words were
 * approved by a person, the tracked link and the compliance footer were
 * substituted inside the claim transaction, and the exact bytes are on the
 * `outreach_send` row. A transport receives those bytes and turns them into
 * whatever shape its provider wants — MIME, a JSON body, an AppleScript
 * argument. It may not personalise, re-compose, append, trim or re-hash.
 * ===========================================================================
 *
 * THE FAKE IS THE ONLY IMPLEMENTATION IN THIS BUILD. No Gmail, no Microsoft
 * Graph, no Outlook. D4.7 is the CONTRACT and the result-persistence boundary;
 * a real provider is D5/D7, and building the contract first is what stops the
 * first real provider's shape becoming the contract by accident.
 *
 * ---------------------------------------------------------------------------
 * FOUR OUTCOMES, AND THE BOUNDARY BETWEEN THE LAST TWO IS THE SAFETY PROPERTY.
 *
 *   ACCEPTED   the provider answered, and the answer was yes.
 *   REJECTED   the provider answered, and the answer was no. An invalid
 *              recipient, a revoked scope, a quota: an ANSWER, not a silence.
 *   UNKNOWN    no answer this process can trust. A timeout after the request
 *              body may have gone out, a reset mid-transmission, a 5xx, a
 *              response it cannot parse — or a thrown exception, which is the
 *              same thing wearing different clothes.
 *   REFUSED_BEFORE_TRANSPORT  no request was ever issued, provably — D5.0. The
 *              only outcome that releases the capacity its claim reserved, and
 *              the only one an explicit retry may follow.
 *
 * A THROWN ERROR IS UNKNOWN, NEVER REJECTED. This is the single most important
 * rule in the file. A rejection licenses a retry; "the socket died" is not a
 * rejection, and treating it as one would resend a message that may already be
 * in a coach's inbox. `attemptSend` below enforces it so no implementation can
 * get it wrong — a transport that throws still produces UNKNOWN.
 * ---------------------------------------------------------------------------
 */

export const TRANSPORT_OUTCOME = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN',
  /**
   * NO REQUEST WAS EVER ISSUED, AND THIS PROCESS CAN PROVE IT — D5.0.
   *
   * =========================================================================
   * THE FOURTH ANSWER, AND IT IS THE ONLY ONE THAT RELEASES CAPACITY.
   *
   * A transport reaches this when it stopped BEFORE any request bytes could
   * have reached the provider: nothing configured to authenticate with, a
   * credential that would not open, an identity that disagreed with the frozen
   * one, a name that would not resolve, a connection refused outright. In every
   * case the provider was never asked, so no message can exist at the other
   * end — which is exactly what `REJECTED` and `UNKNOWN` cannot say.
   *
   * THE BAR IS PROOF, NOT LIKELIHOOD, and the distinction has to be defended
   * every time a new failure is classified. A connection reset, a timeout of
   * any kind, an unreadable answer: those all *probably* mean nothing arrived,
   * and every one of them is UNKNOWN, because a request body may already have
   * been transmitted in full. Being wrong in that direction costs a person two
   * minutes in a Sent folder. Being wrong in THIS direction releases capacity
   * and permits a retry of a message a coach may already be reading.
   *
   * IT IS NOT A SOFTER `REJECTED`. A rejection means the provider received the
   * request, understood it, and said no — an answer, and one worth keeping.
   * This means there was no conversation.
   * =========================================================================
   *
   * WHAT FOLLOWS FROM IT, all owned elsewhere and listed here because the
   * outcome is where they are decided:
   *
   *   state       FAILED, not a new one. Evidence about how a send failed is
   *               not a new thing for the message to BE.
   *   event       TRANSPORT_REFUSED, distinct from TRANSPORT_REJECTED.
   *   budget      the reservation settles to REFUSED_BEFORE_TRANSPORT and
   *               stops counting. The ledger row itself is never removed.
   *   retry       the one case an explicit re-execution is permitted — see
   *               executionRetry.js. Never automatic.
   */
  REFUSED_BEFORE_TRANSPORT: 'REFUSED_BEFORE_TRANSPORT',
});

const OUTCOMES = Object.freeze(Object.values(TRANSPORT_OUTCOME));
export const isTransportOutcome = (o) => OUTCOMES.includes(o);

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * WHAT EVERY TRANSPORT IS HANDED. Validated here so a provider implementation
 * cannot quietly accept half a message.
 *
 * `idempotencyKey` IS THE `outreach_send.id`, and it is a CORRELATION identity
 * rather than a promise. Gmail's `messages.send` offers no idempotency key and
 * neither does Graph's `sendMail`; nothing here claims otherwise. What it is
 * for is joining a provider's own record, or a later reconciliation, back to
 * the one execution row that authorised the send — and for letting a future
 * provider that DOES support such a key be given one that is already unique,
 * already durable, and already the thing every event and metric is keyed on.
 *
 * `threadRef` is the provider thread to attach a follow-up to, or null for a
 * first touch. Nothing in this build populates it; it is in the contract so
 * that adding follow-up threading later is not also a signature change.
 */
export function assertSendRequest(request) {
  const { mailboxId, to, subject, body, idempotencyKey } = request ?? {};
  for (const [name, value] of [
    ['mailboxId', mailboxId], ['to', to], ['subject', subject],
    ['body', body], ['idempotencyKey', idempotencyKey],
  ]) {
    if (typeof value !== 'string' || !value.trim()) {
      throw fail('TRANSPORT_REQUEST_INCOMPLETE',
        `A transport needs ${name}. A send assembled from a partial execution record would `
        + 'transmit something no row on file attests to.');
    }
  }
  return request;
}

/**
 * RUN A TRANSPORT AND ALWAYS COME BACK WITH ONE OF THE FOUR.
 *
 * The boundary that makes "a thrown error is UNKNOWN" a property of the system
 * rather than of every caller remembering it. The only thing that throws out of
 * here is a malformed REQUEST — a caller bug, detected before any I/O, where
 * nothing has been attempted and UNKNOWN would be a lie.
 *
 * ASYNC, AND THEREFORE NEVER INSIDE A TRANSACTION. The claim commits first and
 * the result is persisted afterwards, in its own transaction. Holding SQLite's
 * write lock across a provider's HTTP call would block every other writer for
 * as long as the network felt like taking, which is why `executionClaim` states
 * that nothing may await inside it.
 */
export async function attemptSend(transport, request) {
  assertSendRequest(request);
  try {
    const result = await transport.send(request);
    if (!result || !isTransportOutcome(result.outcome)) {
      /**
       * A TRANSPORT THAT ANSWERED UNINTELLIGIBLY HAS NOT ANSWERED. It may still
       * have sent the message, so this is UNKNOWN and not REJECTED.
       */
      return {
        outcome: TRANSPORT_OUTCOME.UNKNOWN,
        reason: 'TRANSPORT_RETURNED_NO_OUTCOME',
      };
    }
    return result;
  } catch (err) {
    return {
      outcome: TRANSPORT_OUTCOME.UNKNOWN,
      reason: 'TRANSPORT_THREW',
      /** The message only. A stack in a durable event is noise, and may carry paths. */
      detail: err?.message ? String(err.message).slice(0, 500) : null,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* The fake — the only transport in this build                                 */
/* -------------------------------------------------------------------------- */

/**
 * A TRANSPORT THAT SENDS NOTHING AND RECORDS WHAT IT WAS ASKED TO SEND.
 *
 * It exists to make the result boundary testable against a real sequence of
 * calls rather than a mock assembled per test, and to prove the one property
 * that matters most before any provider exists: THE BYTES A TRANSPORT RECEIVES
 * ARE THE BYTES THAT WERE FROZEN. Every request is kept in `sent` so a test can
 * compare them against the row.
 *
 * It opens no socket, resolves no DNS, reads no credential and imports nothing.
 */
export function fakeTransport({ outcome = TRANSPORT_OUTCOME.ACCEPTED, ...rest } = {}) {
  const sent = [];
  let calls = 0;

  return {
    name: 'FAKE',
    sent,
    get calls() { return calls; },

    async send(request) {
      calls += 1;
      sent.push({ ...request });

      /** A behaviour supplied as a function decides per call — for a retry test. */
      const decided = typeof outcome === 'function' ? outcome(request, calls) : outcome;

      if (decided === 'THROW') {
        throw new Error(rest.throwMessage ?? 'the fake transport failed to reach anything');
      }

      if (decided === TRANSPORT_OUTCOME.ACCEPTED) {
        return {
          outcome: TRANSPORT_OUTCOME.ACCEPTED,
          /**
           * Shaped like a provider's answer and obviously not one. A test that
           * asserted a realistic-looking Gmail id would be asserting a fiction.
           */
          providerMessageId: rest.providerMessageId ?? `fake-msg-${request.idempotencyKey}`,
          providerThreadId: rest.providerThreadId ?? `fake-thread-${request.idempotencyKey}`,
          internetMessageId: rest.internetMessageId ?? null,
          acceptedAt: rest.acceptedAt ?? null,
        };
      }

      if (decided === TRANSPORT_OUTCOME.REJECTED) {
        return {
          outcome: TRANSPORT_OUTCOME.REJECTED,
          providerCode: rest.providerCode ?? 'FAKE_REJECTED',
          providerMessage: rest.providerMessage ?? 'the fake transport refused this message',
        };
      }

      /**
       * D5.0 — AND IT NEEDS ITS OWN BRANCH RATHER THAN THE FALL-THROUGH BELOW.
       *
       * Everything unrecognised becomes UNKNOWN, which is the right default and
       * would have quietly swallowed this one: a test asking for a provable
       * non-send would have got an ambiguous result, the budget would not have
       * been released, and the test would still have passed for the wrong
       * reason. A named outcome needs a named branch.
       *
       * The reason is deliberately GENERIC. Nothing provider-shaped belongs in
       * this build — no invalid_grant, no 429, no identity mismatch — because
       * the fake must not teach the result boundary a vocabulary only Gmail
       * would ever produce.
       */
      if (decided === TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT) {
        return {
          outcome: TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT,
          reason: rest.reason ?? 'PRE_TRANSPORT_CONFIGURATION',
          detail: rest.detail ?? null,
        };
      }

      return {
        outcome: TRANSPORT_OUTCOME.UNKNOWN,
        reason: rest.reason ?? 'FAKE_UNKNOWN',
      };
    },
  };
}
