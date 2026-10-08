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
 * Every integrity-eligible coach passes it by construction — the reconciler's eligibility already
 * requires both.
 *
 * AND THE CANONICAL DECISION (Phase 1G-D close-out, after Data Integrity 8D.3F): a coach that
 * passes the row checks must ALSO be eligible by the canonical engine (coachReconciler.js, the
 * one the integrity gates measure) at its filed programme, and must not be under an activation
 * hold. See canonicalCoachEligibility.js. Before this the floor admitted 4,944 coaches where the
 * engine admits 4,288 — including one whose address is positively not published on her own
 * official page — and every outreach path read only the floor.
 *
 * LEGACY BEHAVIOUR IS AN EXPLICIT OPT-IN: THRIV3_ALLOW_LEGACY_COACHES=1 restores the pre-8A
 * unfiltered offer (for tests that model it, or a deliberate operator decision). Nothing
 * here reads or changes deployment configuration.
 */
import db from '../db/client.js';
import { canonicalIneligibility, activationHold, CANONICAL_INELIGIBLE } from './canonicalCoachEligibility.js';

export { CANONICAL_INELIGIBLE };

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
  PROGRAMME_INACTIVE: 'PROGRAMME_INACTIVE',
});

const usable = (e) => !!e && String(e).includes('@') && String(e).trim() !== '' && String(e).trim().toUpperCase() !== 'N/A';

/** Why a coach row fails the ROW checks (address, currentness, verification), or null. Pure. */
export function coachRowIneligibility(row) {
  if (!row || !usable(row.email)) return INELIGIBLE.NO_USABLE_EMAIL;
  if (row.currentness_status === 'PROVEN_STALE') return INELIGIBLE.COACH_PROVEN_STALE;
  if (row.email_status !== 'verified') return `${INELIGIBLE.EMAIL_NOT_VERIFIED}:${row.email_status || 'unknown'}`;
  return null;
}

/**
 * Why a coach row fails the floor, or null: the row checks, then the canonical decision at its
 * filed programme and the activation holds (canonicalCoachEligibility.js), read on `handle` —
 * fresh as of that connection's last write, so a send-time call sees the current answer.
 */
export function coachIneligibility(row, { handle = db } = {}) {
  return coachRowIneligibility(row) || canonicalIneligibility(row, handle);
}
export const isCoachEligible = (row, opts) => coachIneligibility(row, opts) === null;

/**
 * The floor for what is OFFERED (selection: the manual picker, campaign pursuit, the staff list).
 * Under the explicit legacy opt-in the pre-8A unfiltered offer is kept — except an activation
 * hold, which no flag lifts. SEND TIME never calls this: the claim (executionClaim) and the send
 * boundary (recipientIneligibility, inside sendOutreach) apply coachIneligibility unconditionally.
 */
export function outreachIneligibility(row, { handle = db, env = process.env } = {}) {
  if (legacyCoachesAllowed(env)) {
    const held = row?.id ? activationHold(row.id) : null;
    return held ? `${CANONICAL_INELIGIBLE.ACTIVATION_HELD}:${held.hold}` : null;
  }
  return coachIneligibility(row, { handle });
}

/** Apply the floor to a list of coach rows. */
export function applyCoachFloor(rows, { env = process.env, handle = db } = {}) {
  return rows.filter((r) => outreachIneligibility(r, { env, handle }) === null);
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
export function recipientIneligibility({ email, collegeName, sport }, { handle = db } = {}) {
  // SEND TIME (sendOutreach, which every manual send and draft passes): the full floor. No flag is
  // read here — THRIV3_ALLOW_LEGACY_COACHES widens what is offered, never what is sent.
  const rows = usable(email) ? handle.prepare('SELECT * FROM coaches WHERE lower(trim(email)) = lower(trim(?)) AND sport = ?').all(email, sport) : [];
  if (!usable(email)) return INELIGIBLE.NO_USABLE_EMAIL;
  // a send must name a programme that exists NOW: a superseded or retired row (linked to its
  // successor by programme_row_links) never carries outreach, even to an address eligible there
  const named = handle.prepare('SELECT active FROM colleges WHERE name = ? AND sport = ?').get(collegeName, sport);
  if (named && named.active === 0) return INELIGIBLE.PROGRAMME_INACTIVE;
  if (!rows.length) return INELIGIBLE.UNKNOWN_ADDRESS;
  const names = new Set(programmeNames(collegeName, sport));
  const here = rows.filter((r) => names.has(r.school));
  if (!here.length) return INELIGIBLE.ADDRESS_AT_OTHER_PROGRAMME;
  // an address held by ANY coach row is refused, even if another row with it would pass
  const held = rows.map((r) => activationHold(r.id)).find(Boolean);
  if (held) return `${CANONICAL_INELIGIBLE.ACTIVATION_HELD}:${held.hold}`;
  return here.some((r) => isCoachEligible(r, { handle })) ? null : coachIneligibility(here[0], { handle });
}
