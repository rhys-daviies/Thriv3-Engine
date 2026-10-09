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

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
 * RELEASES (Phase DI-03B, hardened DI-03D). A hold ends only through a reviewed release record, never
 * by deleting the hold above (the hold stays as the audit trail of why it was held).
 *
 * A release names the exact hold it ends (domain, stored UNITID, disputed pair, recorded date), the
 * owner the evidence settles on, the approval it belongs to (approval_id + reviewer_id — the composite
 * writer requires both to equal the composite approval and validates the reviewer against
 * shared/correctionReviewers.json), a documented reason, and references to evidence the correction
 * engine VERIFIES itself (the self-identification page body and the registered official sources the
 * action used) — see domainOwnershipCorrection.js.
 *
 * Two uses:
 *   - a DOMAIN_OWNERSHIP_CORRECTION fixture carries a release to authorise correcting the held row
 *     inside the correction transaction;
 *   - HELD_DOMAIN_RELEASES (below) lists releases that end the hold for EVERY reader of isHeldDomain.
 *     One takes effect only if `applied_correction` names a committed correction manifest IN THIS
 *     REPOSITORY (docs/validation/corrections/...) whose bytes hash to `manifest_sha256`, whose
 *     approval_id is the release's, and which contains the athletics_domains update that put this
 *     domain on the released owner. A release that cannot prove the correction was committed is
 *     ignored (the hold stays). HELD_DOMAIN_RELEASES ships empty.
 */
export const HELD_DOMAIN_RELEASES = Object.freeze([]);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORRECTIONS_DIR = 'docs/validation/corrections/';
const normDomain = (d) => String(d ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
const HEX64 = /^[0-9a-f]{64}$/;

/** The hold record for a domain whether or not it has been released, or null. */
export function holdRecord(domain) {
  if (typeof domain !== 'string') return null;
  const d = normDomain(domain);
  return HELD_DOMAIN_ADJUDICATIONS.find((h) => h.domain.toLowerCase() === d) ?? null;
}

/** Problems with a release against the hold it claims to end ([] = structurally valid and bound to the hold). */
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
  for (const k of ['approval_id', 'reviewer_id', 'approved_by', 'approved_at', 'expires_at']) if (!release[k]) p.push(`${k} is required (the composite writer binds it to its approval)`);
  if (String(release.reason || '').trim().length < 40) p.push('a documented reason (at least 40 characters) is required');
  const ev = release.evidence || {};
  if (!HEX64.test(ev.self_identification_sha256 || '')) p.push('evidence.self_identification_sha256 must reference the verified page body');
  if (!Array.isArray(ev.official_source_ids) || !ev.official_source_ids.length) p.push('evidence.official_source_ids must name the registered official sources');
  return p;
}

/**
 * Problems with a CODE-LEVEL release given the bytes of the manifest it names ([] = the hold is lifted).
 * Pure: the caller reads the file. Exported for tests.
 */
export function appliedReleaseProblems(release, hold, manifestBytes) {
  const p = holdReleaseProblems(release, hold);
  const ac = release?.applied_correction || {};
  if (!String(ac.manifest_path || '').startsWith(CORRECTIONS_DIR) || String(ac.manifest_path).includes('..')) p.push(`applied_correction.manifest_path must be a committed file under ${CORRECTIONS_DIR}`);
  if (!HEX64.test(ac.manifest_sha256 || '')) p.push('applied_correction.manifest_sha256 is required');
  if (!manifestBytes) { p.push(`manifest ${ac.manifest_path} is not in the repository`); return p; }
  if (crypto.createHash('sha256').update(manifestBytes).digest('hex') !== ac.manifest_sha256) { p.push('manifest bytes do not hash to applied_correction.manifest_sha256'); return p; }
  let m; try { m = JSON.parse(Buffer.from(manifestBytes).toString('utf8')); } catch { p.push('manifest is not JSON'); return p; }
  if (m?.phase !== 'COMPOSITE_CORRECTION' || !Array.isArray(m.manifest)) p.push('not a committed composite correction manifest');
  if (m?.approval_id !== release.approval_id) p.push(`manifest approval ${m?.approval_id} is not the release's ${release.approval_id}`);
  const moved = (m?.manifest || []).flatMap((x) => x.entries || []).some((e) => e.table === 'athletics_domains' && e.kind === 'UPDATE'
    && normDomain(e.key?.domain) === normDomain(hold.domain) && Number(e.new?.unitid) === Number(release.released_to_unitid) && Number(e.old?.unitid) === Number(hold.stored_unitid));
  if (!moved) p.push(`manifest does not contain the update that moved ${hold.domain} from ${hold.stored_unitid} to ${release.released_to_unitid}`);
  return p;
}

const readRepoFile = (rel) => { try { return fs.readFileSync(path.join(REPO_ROOT, rel)); } catch { return null; } };
/** Domains whose hold a committed, verifiable release has ended — computed once, from this repository. */
const RELEASED = new Set(HELD_DOMAIN_RELEASES.filter((r) => {
  const hold = holdRecord(r?.domain);
  return hold && appliedReleaseProblems(r, hold, readRepoFile(String(r?.applied_correction?.manifest_path || ''))).length === 0;
}).map((r) => normDomain(r.domain)));

/** Is this domain's ownership currently under adjudication? */
export function isHeldDomain(domain) {
  const hold = holdRecord(domain);
  return !!hold && !RELEASED.has(normDomain(hold.domain));
}

/** The held record for a domain, or null (null once validly released). */
export function heldAdjudication(domain) {
  return isHeldDomain(domain) ? holdRecord(domain) : null;
}
