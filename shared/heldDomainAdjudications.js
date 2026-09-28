/**
 * Athletics domains whose OWNERSHIP is under external adjudication.
 *
 * A held domain keeps its stored row exactly as it is — Phase 2C's lesson is
 * that guessing which side of a disagreement is right produces confident wrong
 * answers in BOTH directions, and `pct.edu` and `wvu.edu` are the two it got
 * backwards. What a hold removes is the domain's power to act as INSTITUTION
 * EVIDENCE while the question is open. The row is preserved; its authority is
 * suspended.
 *
 * This is not a denial list and not a repair. Holding a domain must never
 * reach any other domain, institution, coach or programme: an unresolved
 * question about one registry row is not a reason to withhold answers about
 * everything else.
 *
 * ADDING ONE IS A CLAIM THAT NEEDS EVIDENCE. Each entry states what is
 * observed, what is disputed, and what would settle it. Removing one requires
 * an external adjudication recorded in the Phase-2C ground-truth artifact, the
 * same standard every other domain decision is held to.
 */

/** @type {ReadonlyArray<{domain:string, stored_unitid:number, disputed_between:number[], observed:string, why_held:string, resolves_when:string, recorded:string, follow_up:string}>} */
export const HELD_DOMAIN_ADJUDICATIONS = Object.freeze([
  Object.freeze({
    domain: 'stmarytx.edu',
    stored_unitid: 123554,
    disputed_between: Object.freeze([123554, 228149]),
    observed:
      'Stored VERIFIED_ALIAS at 123554 (Saint Mary\'s, CA, NCAA D1) while its own claimed_unitids '
      + 'are [123554, 228149] — a MULTI-CLAIM domain, which is why the single-claim ownership check '
      + 'never surfaced it. Five coach rows are filed at 123554 through this domain and two at '
      + '228149 (St. Mary\'s, TX, NCAA D2). The Phase-2 contact-ledger README already listed '
      + '"stmarytx.edu→CA" among the registry\'s known errors.',
    why_held:
      'The 188-row Phase-3B fixture proposed moving it to 228149 and that fixture is superseded, so '
      + 'its proposal carries no weight. Nothing in Phase 2C, 2D or 6C.4 ever adjudicated this domain '
      + 'externally. The name is suggestive and suggestive is not evidence — it is exactly the '
      + 'reasoning Phase 2A used, and Phase 2B had to revert all 27 of its results.',
    resolves_when:
      'The site\'s own self-identification plus NCES/IPEDS establish the owning institution, recorded '
      + 'in phase2c_ground_truth.json with evidence URLs, to the standard Phase 6C.4 used.',
    recorded: '2026-09-28',
    follow_up: 'docs/validation/integrity-audit/held_domain_followup.json',
  }),
]);

const HELD = new Set(HELD_DOMAIN_ADJUDICATIONS.map((h) => h.domain.toLowerCase()));

/** Is this domain's ownership currently under adjudication? */
export function isHeldDomain(domain) {
  return typeof domain === 'string' && HELD.has(domain.trim().toLowerCase().replace(/^www\./, ''));
}

/** The held record for a domain, or null. */
export function heldAdjudication(domain) {
  if (!isHeldDomain(domain)) return null;
  const d = domain.trim().toLowerCase().replace(/^www\./, '');
  return HELD_DOMAIN_ADJUDICATIONS.find((h) => h.domain.toLowerCase() === d) ?? null;
}
