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
 * RELEASES (Phase DI-03B). A hold ends only through a reviewed release record, never by deleting the
 * hold above (the hold stays as the audit trail of why it was held). A release names the exact hold
 * it ends (domain, stored UNITID, disputed pair, recorded date), the owner the evidence settles on,
 * the reviewer, a reason, and the external evidence the hold's `resolves_when` asks for: the site's
 * own self-identification and the NCES/IPEDS record, each with its URL and sha256.
 *
 * Two uses, one validator (holdReleaseProblems):
 *   - a DOMAIN_OWNERSHIP_CORRECTION fixture may carry a release to authorise correcting the held
 *     row's ownership inside the correction transaction (domainOwnershipCorrection.js);
 *   - a release listed in HELD_DOMAIN_RELEASES ends the hold for every reader of isHeldDomain. It
 *     takes effect only with `applied_correction.manifest_hash` — the committed correction that put
 *     the row on the released owner — so merging a release before the data is corrected can never
 *     lend the held host's authority to the institution it was wrongly filed under.
 */
export const HELD_DOMAIN_RELEASES = Object.freeze([]);

const normDomain = (d) => String(d ?? '').trim().toLowerCase().replace(/^www\./, '');
const HEX64 = /^[0-9a-f]{64}$/;

/** The hold record for a domain whether or not it has been released, or null. */
export function holdRecord(domain) {
  if (typeof domain !== 'string') return null;
  const d = normDomain(domain);
  return HELD_DOMAIN_ADJUDICATIONS.find((h) => h.domain.toLowerCase() === d) ?? null;
}

/**
 * Problems with a release against the hold it claims to end ([] = a valid release).
 * `requireApplied`: a code-level release must also name the committed correction manifest.
 */
export function holdReleaseProblems(release, hold, { requireApplied = false } = {}) {
  const p = [];
  if (!release || typeof release !== 'object') return ['no release record'];
  if (!hold) return [`${release.domain ?? '?'} has no hold to release`];
  const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && [...a].map(Number).sort().join(',') === [...b].map(Number).sort().join(',');
  if (!release.release_id) p.push('release_id is required');
  if (normDomain(release.domain) !== normDomain(hold.domain)) p.push(`release domain ${release.domain} is not the held domain ${hold.domain}`);
  if (release.hold_recorded !== hold.recorded) p.push(`hold_recorded ${release.hold_recorded} does not match the hold (${hold.recorded})`);
  if (Number(release.stored_unitid) !== Number(hold.stored_unitid)) p.push(`stored_unitid ${release.stored_unitid} does not match the hold (${hold.stored_unitid})`);
  if (!sameSet(release.disputed_between, hold.disputed_between)) p.push('disputed_between does not match the hold');
  if (!hold.disputed_between.map(Number).includes(Number(release.released_to_unitid))) p.push(`released_to_unitid ${release.released_to_unitid} is not one of the disputed owners`);
  // the reviewer's name is sealed into the fixture hash the approver signs off; the repo-wide "NOT APPROVED" marker is refused
  if (!String(release.reviewer || '').trim() || /not approved/i.test(String(release.reviewer))) p.push('reviewer authorisation is required');
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(release.approved_at || ''))) p.push('approved_at (ISO date) is required');
  if (String(release.reason || '').trim().length < 40) p.push('a documented reason (at least 40 characters) is required');
  const ev = Array.isArray(release.evidence) ? release.evidence : [];
  const okEv = ev.filter((e) => /^https:\/\//.test(e?.url || '') && HEX64.test(e?.sha256 || ''));
  if (okEv.length !== ev.length) p.push('every evidence item needs an https url and a sha256');
  if (!okEv.some((e) => e.kind === 'SELF_IDENTIFICATION')) p.push('evidence must include the site\'s own SELF_IDENTIFICATION');
  if (!okEv.some((e) => e.kind === 'IPEDS')) p.push('evidence must include the NCES/IPEDS record (IPEDS)');
  if (requireApplied && !HEX64.test(release.applied_correction?.manifest_hash || '')) p.push('a code-level release must name the applied correction manifest (applied_correction.manifest_hash)');
  return p;
}

/** Is this domain's ownership currently under adjudication? `releases` exists for tests only. */
export function isHeldDomain(domain, { releases = HELD_DOMAIN_RELEASES } = {}) {
  const hold = holdRecord(domain);
  if (!hold) return false;
  return !releases.some((r) => normDomain(r?.domain) === normDomain(hold.domain) && holdReleaseProblems(r, hold, { requireApplied: true }).length === 0);
}

/** The held record for a domain, or null (null once validly released). */
export function heldAdjudication(domain) {
  return isHeldDomain(domain) ? holdRecord(domain) : null;
}
