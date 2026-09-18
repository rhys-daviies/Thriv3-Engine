/**
 * THE TRANSPORT A REAL REQUEST WOULD USE — and in this build there is not one.
 *
 * ===========================================================================
 * IT FAILS CLOSED, AND THE TEST FAKE IS NOT REACHABLE FROM HERE.
 *
 * D4.9 proves the whole application path — review, claim, freeze, transport,
 * result, reconciliation — against a fake. A real provider is D5. So this
 * returns null, and `executeProgrammeMessage` refuses with
 * TRANSPORT_NOT_CONFIGURED before it claims anything or spends any capacity.
 *
 * `fakeTransport` lives in `outboundTransport` and is passed in explicitly by
 * tests. THIS MODULE DOES NOT IMPORT IT AND MUST NEVER LEARN THAT IT EXISTS.
 * There is therefore no environment variable, no missing branch and no
 * configuration mistake that could promote a test double into a production
 * email sender — the only way to send anything is to hand a transport to the
 * orchestrator, and only a test does that.
 * ===========================================================================
 *
 * IT IS ITS OWN MODULE FOR ONE REASON: the HTTP route has no argument for a
 * transport, so an end-to-end route test needs a seam. One tiny module is a
 * seam; an environment flag read inside the orchestrator would be a way for
 * production to end up holding a fake.
 *
 * WHEN D5 LANDS this becomes the single place that resolves a Google adapter,
 * and the refusal stops being reachable for a connected Google mailbox.
 */
export function productionTransport() {
  return null;
}
