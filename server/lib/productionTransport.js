import { MAILBOX_PROVIDER } from './connectedMailboxes.js';
import { providerCapability } from './providerCapability.js';
import { googleTransport } from './googleTransport.js';

/**
 * THE TRANSPORT A REAL SEND WOULD USE — D5.2.
 *
 * ===========================================================================
 * IT WAS `return null` UNTIL NOW, AND THE REASON THAT WAS ENOUGH HAS EXPIRED.
 *
 * From D4.7 to D5.1 this file existed as a seam: a single function a test
 * could replace, returning null so that nothing in the product could reach a
 * provider however badly anything else was configured. It had no imports at
 * all, and a test asserted that, because the only way to be certain a fake
 * could never be promoted to a real sender was for there to be nothing here to
 * promote.
 *
 * D5.2 wires it, so that guarantee has to be re-established somewhere real
 * rather than abandoned. It now lives in THREE places, and the strongest of
 * them is the one furthest from this file:
 *
 *   1  the orchestrator refuses before the claim, so no execution row and no
 *      ledger row exist for a send that cannot happen;
 *   2  the claim independently refuses a provider this build cannot service;
 *   3  `googleTransport` refuses inside itself, twice, before any Gmail
 *      request — and that one holds even if a future caller reaches the
 *      adapter directly with no orchestrator in front of it.
 *
 * So this registry may hand back a real Google adapter while real sending is
 * switched off. That is deliberate: the adapter is constructible, inspectable
 * and testable, and it still cannot submit a message.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * THE PROVIDER IS NEVER THE CALLER'S TO CHOOSE.
 *
 * It comes from `connected_mailboxes.provider`, snapshotted onto the execution
 * row at claim time and read back from the frozen snapshot — a column no
 * request body can influence, on a mailbox the claim proved the operator owns.
 * A `provider` field on a send request would be an authorisation bypass with
 * extra steps: name MICROSOFT, get a different adapter, and the mailbox the
 * athlete actually authorised is no longer the one being used.
 * ---------------------------------------------------------------------------
 *
 * A SECOND PROVIDER IS ONE ENTRY. Microsoft arrives as a case in the switch
 * below and an entry in `providerCapability`'s implemented list; the
 * orchestrator, the claim, the result boundary and the ledger do not change,
 * because none of them knows what a provider is.
 */
export function productionTransport({ provider = null, ...dependencies } = {}) {
  /**
   * NULL WHEN A REAL SEND COULD NOT PROCEED, FOR ANY OF THE THREE REASONS.
   *
   * Callers that need to know WHY ask `providerCapability` directly — the
   * orchestrator does, so it can answer `MAILBOX_PROVIDER_UNSUPPORTED` and
   * `PROVIDER_SEND_DISABLED` as the different things they are. This function
   * answers only "is there something to send with", which is the question
   * `executeProgrammeMessage` has always asked it.
   *
   * IT STILL RETURNS NULL WITH NO ARGUMENTS. Every existing caller and test
   * that asks `productionTransport()` gets exactly what it got before, because
   * a null provider is not implemented.
   */
  const capability = providerCapability(provider);
  if (!capability.sendEnabled) return null;

  switch (provider) {
    case MAILBOX_PROVIDER.GOOGLE:
      return googleTransport(dependencies);
    /**
     * NO DEFAULT THAT GUESSES. An unknown provider has already been refused by
     * the capability check above; this is here so that adding MICROSOFT is a
     * visible edit in two files rather than a silent fallthrough to whichever
     * adapter happens to be first.
     */
    default:
      return null;
  }
}
