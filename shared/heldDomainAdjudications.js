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

/**
 * RELEASES (Phase DI-03B; proof model rebuilt in DI-03F after the DI-03E review). A hold ends only
 * through a release, never by deleting the hold above (the hold stays as the audit trail).
 *
 * Two uses:
 *   - a DOMAIN_OWNERSHIP_CORRECTION fixture carries a release record to authorise correcting the held
 *     row inside the correction transaction. holdReleaseProblems checks it is bound to the exact hold;
 *     the composite writer requires the SIGNED approval to list it by sha256 (release_sha256), so its
 *     authority is the authenticated reviewers' signatures, not names typed into the record.
 *   - HELD_DOMAIN_RELEASES (below) ends the hold for every reader — but only IN A DATABASE THAT PROVES
 *     IT. An entry names { release_id, domain, released_to_unitid, ledger_id, manifest_sha256 }, and it
 *     takes effect in a database only when that database's own correction ledger holds a COMMITTED
 *     (not reverted) composite correction with that id and manifest hash, whose signed approval still
 *     verifies for a SHARED_DEV or PRODUCTION target (a rehearsal on a disposable copy can never
 *     release), whose approval lists this release, whose manifest moved this domain from the held owner
 *     to the released one, and whose row still names the released owner
 *     (server/lib/refresh/holdRelease.js). A file in the repository proves nothing on its own: a
 *     database that never received the correction keeps the hold. HELD_DOMAIN_RELEASES ships empty.
 *
 * Readers pass the set of released domains for the database they read (releasedHeldDomains(db));
 * a reader that passes nothing treats every hold as in force (fail closed).
 */
export const HELD_DOMAIN_RELEASES = Object.freeze([]);

const normDomain = (d) => String(d ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
const HEX64 = /^[0-9a-f]{64}$/;
export { normDomain as normHeldDomain };

/** The hold record for a domain whether or not it has been released, or null. */
export function holdRecord(domain) {
  if (typeof domain !== 'string') return null;
  const d = normDomain(domain);
  return HELD_DOMAIN_ADJUDICATIONS.find((h) => h.domain.toLowerCase() === d) ?? null;
}

/** Problems with a release record against the hold it claims to end ([] = structurally bound to the hold). */
export function holdReleaseProblems(release, hold) {
  const p = [];
  if (!release || typeof release !== 'object') return ['no release record'];
  if (!hold) return [`${release.domain ?? '?'} has no hold to release`];
  const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && [...a].map(Number).sort().join(',') === [...b].map(Number).sort().join(',');
  if (!release.release_id) p.push('release_id is required');
  if (normDomain(release.domain) !== normDomain(hold.domain) || release.domain !== hold.domain) p.push(`release domain ${release.domain} is not exactly the held domain ${hold.domain}`);
  if (release.hold_recorded !== hold.recorded) p.push(`hold_recorded ${release.hold_recorded} does not match the hold (${hold.recorded})`);
  if (Number(release.stored_unitid) !== Number(hold.stored_unitid)) p.push(`stored_unitid ${release.stored_unitid} does not match the hold (${hold.stored_unitid})`);
  if (!sameSet(release.disputed_between, hold.disputed_between)) p.push('disputed_between does not match the hold');
  if (!hold.disputed_between.map(Number).includes(Number(release.released_to_unitid)) || Number(release.released_to_unitid) === Number(hold.stored_unitid)) p.push(`released_to_unitid ${release.released_to_unitid} must be the other disputed owner`);
  if (!release.approval_id) p.push('approval_id is required (the signed composite approval that lists this release)');
  if (String(release.reason || '').trim().length < 40) p.push('a documented reason (at least 40 characters) is required');
  const ev = release.evidence || {};
  if (!HEX64.test(ev.self_identification_sha256 || '')) p.push('evidence.self_identification_sha256 must reference the verified page body');
  if (!Array.isArray(ev.official_source_ids) || !ev.official_source_ids.length) p.push('evidence.official_source_ids must name the registered official sources');
  return p;
}

/** Is this domain's ownership under adjudication in the database whose released set is `released`? */
export function isHeldDomain(domain, released = null) {
  const hold = holdRecord(domain);
  return !!hold && !(released instanceof Set && released.has(normDomain(hold.domain)));
}

/** The held record for a domain, or null (null once validly released in that database). */
export function heldAdjudication(domain, released = null) {
  return isHeldDomain(domain, released) ? holdRecord(domain) : null;
}
