/**
 * RUNTIME COACH ELIGIBILITY — Phase 8A. The one floor every outreach path applies.
 *
 * Before Phase 8A only one route could filter coaches (behind THRIV3_USE_RECONCILED_COACHES),
 * no environment set it, and the table it reads does not exist in any environment. Every other
 * path — campaign pursuit, the Top-100 composers, /api/outreach/send, the drafting CLI —
 * offered all 6,486 rows, including 1,540 whose address was inferred, generic or unknown, or
 * whose coach was PROVEN_STALE (departed).
 *
 * THE FLOOR (default ON, fail-safe):
 *   a coach may be offered or written to only if the address is a real, VERIFIED
 *   (published-and-observed) personal address and the coach is not PROVEN_STALE.
 * Every integrity-eligible coach (4,157 on shared dev, Phase 7E) passes it by construction —
 * the reconciler's eligibility already requires both — so the floor hides no valid coach.
 * It does NOT prove institution corroboration; that needs `coaches_reconciled`, which is
 * preferred wherever it is present (see programmeCoaches.js).
 *
 * LEGACY BEHAVIOUR IS AN EXPLICIT OPT-IN: THRIV3_ALLOW_LEGACY_COACHES=1 restores the pre-8A
 * unfiltered offer (for tests that model it, or a deliberate operator decision). Nothing
 * here reads or changes deployment configuration.
 */
import db from '../db/client.js';

export const LEGACY_COACHES_FLAG = 'THRIV3_ALLOW_LEGACY_COACHES';
const TRUTHY = /^(1|true|yes|on)$/i;
/** Read per call (never memoised) so an operator or a test can flip it without a restart. */
export function legacyCoachesAllowed(env = process.env) {
  return TRUTHY.test(String(env[LEGACY_COACHES_FLAG] ?? '').trim());
}

export const INELIGIBLE = Object.freeze({
  NO_USABLE_EMAIL: 'NO_USABLE_EMAIL',
  COACH_PROVEN_STALE: 'COACH_PROVEN_STALE',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  UNKNOWN_ADDRESS: 'UNKNOWN_ADDRESS',
  ADDRESS_AT_OTHER_PROGRAMME: 'ADDRESS_AT_OTHER_PROGRAMME',
});

const usable = (e) => !!e && String(e).includes('@') && String(e).trim() !== '' && String(e).trim().toUpperCase() !== 'N/A';

/** Why a coach row fails the floor, or null. Pure. */
export function coachIneligibility(row) {
  if (!row || !usable(row.email)) return INELIGIBLE.NO_USABLE_EMAIL;
  if (row.currentness_status === 'PROVEN_STALE') return INELIGIBLE.COACH_PROVEN_STALE;
  if (row.email_status !== 'verified') return `${INELIGIBLE.EMAIL_NOT_VERIFIED}:${row.email_status || 'unknown'}`;
  return null;
}
export const isCoachEligible = (row) => coachIneligibility(row) === null;

/** Apply the floor to a list of coach rows (no-op under the legacy opt-in). */
export function applyCoachFloor(rows, { env = process.env } = {}) {
  if (legacyCoachesAllowed(env)) return rows;
  return rows.filter(isCoachEligible);
}

const tableExists = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

/** Every colleges.name that carries the same programme (programme_row_links), incl. itself. */
export function programmeNames(collegeName, sport) {
  const names = new Set([collegeName]);
  if (!tableExists('programme_row_links')) return [...names];
  const row = db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?').get(collegeName, sport);
  if (!row) return [...names];
  const canon = db.prepare('SELECT canonical_college_id c FROM programme_row_links WHERE college_id = ?').get(row.id)?.c || row.id;
  for (const r of db.prepare(`SELECT c.name FROM colleges c WHERE c.id = @canon
      OR c.id IN (SELECT college_id FROM programme_row_links WHERE canonical_college_id = @canon)`).all({ canon })) names.add(r.name);
  return [...names];
}

/**
 * Is a RECIPIENT (address + programme) sendable? For paths whose recipient list came from
 * outside the coaches table (the recommendation blob, a client body). The address must
 * belong to an eligible coach row at this programme (any of its linked spellings).
 */
export function recipientIneligibility({ email, collegeName, sport }, { env = process.env } = {}) {
  if (legacyCoachesAllowed(env)) return null;
  if (!usable(email)) return INELIGIBLE.NO_USABLE_EMAIL;
  const rows = db.prepare('SELECT * FROM coaches WHERE lower(trim(email)) = lower(trim(?)) AND sport = ?').all(email, sport);
  if (!rows.length) return INELIGIBLE.UNKNOWN_ADDRESS;
  const names = new Set(programmeNames(collegeName, sport));
  const here = rows.filter((r) => names.has(r.school));
  if (!here.length) return INELIGIBLE.ADDRESS_AT_OTHER_PROGRAMME;
  return here.some(isCoachEligible) ? null : coachIneligibility(here[0]);
}
