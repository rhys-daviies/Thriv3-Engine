/**
 * CANONICAL COACH ELIGIBILITY AT SEND TIME — the reconciler's decision, applied by the runtime floor.
 *
 * Before this module the runtime floor (coachEligibility.js) admitted any coach with a verified,
 * not-PROVEN_STALE address: 4,944 coaches on shared dev, where the canonical engine
 * (coachReconciler.js — the same engine the integrity gates measure) admits 4,288. The 656 between
 * them were institution-withheld, uncorroborated, under review, reassigned to another institution,
 * or (Brosnihan, Phase 8D.3D) carry an address positively NOT published on their own official page.
 * Every outreach path — campaign pursuit, the manual picker, the manual send route, the claim of an
 * already-prepared campaign message, the drafting CLI — read the floor, so none of them enforced it.
 *
 * There is still exactly ONE eligibility engine. This module does not re-implement any rule: it runs
 * `reconcileCoachRows` in-process on the caller's own connection (≈90 ms for every coach) and
 * remembers the answer until that connection observes a write — its own (`total_changes()`) or
 * another connection's (`PRAGMA data_version`). A decision is therefore never older than the data
 * it is asked about, which is what makes it safe at send time.
 *
 * A coach at a filed programme is canonically eligible only if ALL hold:
 *   - the reconciler marks it outreach_eligibility = 'YES' for this exact address;
 *   - its canonical programme IS the filed programme (or a row linked to it by
 *     programme_row_links): a coach the reconciler REASSIGNS elsewhere is refused at the filed
 *     programme and is NOT offered at the other one — that would be an activation;
 *   - it is not under an ACTIVATION HOLD (server/data/seeds/coach_activation_holds.json): the 131
 *     coaches newly eligible after 8D.3F stay inactive until send-time verification is separately
 *     authorised, and the withheld / caution coaches are listed there too.
 * No decision (a coach the reconciler did not see) is a refusal — fail closed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileCoachRows } from './coachReconciler.js';
import { ABSENCE_REASON } from './emailPublication.js';

export const HOLDS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/seeds/coach_activation_holds.json');

export const CANONICAL_INELIGIBLE = Object.freeze({
  NO_CANONICAL_DECISION: 'COACH_NO_CANONICAL_DECISION',
  NOT_CANONICALLY_ELIGIBLE: 'COACH_NOT_CANONICALLY_ELIGIBLE',
  EMAIL_POSITIVELY_ABSENT: 'COACH_EMAIL_POSITIVELY_ABSENT',
  CANONICAL_PROGRAMME_MISMATCH: 'COACH_CANONICAL_PROGRAMME_MISMATCH',
  ACTIVATION_HELD: 'COACH_ACTIVATION_HELD',
});

const lc = (s) => String(s ?? '').trim().toLowerCase();

/**
 * A holds file is trusted only whole: the right kind, a non-empty `holds` array of {coach_id, hold},
 * no duplicate coach, and per-kind `counts` that agree with the list. Anything else — truncated,
 * hand-edited into a different shape, emptied — is unreadable, and unreadable holds everyone.
 */
function validHolds(seed) {
  if (!seed || seed.kind !== 'COACH_ACTIVATION_HOLDS' || !Array.isArray(seed.holds) || seed.holds.length === 0) return null;
  const index = new Map(); const counts = {};
  for (const h of seed.holds) {
    if (!h || typeof h.coach_id !== 'string' || !h.coach_id || typeof h.hold !== 'string' || !h.hold || index.has(h.coach_id)) return null;
    index.set(h.coach_id, h); counts[h.hold] = (counts[h.hold] || 0) + 1;
  }
  const declared = seed.counts || {};
  const kinds = new Set([...Object.keys(declared), ...Object.keys(counts)]);
  for (const k of kinds) if (declared[k] !== counts[k]) return null;
  return index;
}

let holdsMemo = null;
/** coach_id -> hold row. Read once; a missing, malformed or inconsistent file fails CLOSED (every coach is treated as held). */
export function activationHolds(file = HOLDS_PATH) {
  // re-read whenever the file changes, so a hold added to a running process applies to the next send
  let stamp = null;
  try { const st = fs.statSync(file); stamp = `${st.mtimeMs}:${st.size}`; } catch { stamp = 'missing'; }
  if (holdsMemo && holdsMemo.file === file && holdsMemo.stamp === stamp) return holdsMemo.index;
  let index;
  try {
    index = validHolds(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    index = null; // fail closed: see activationHold
  }
  holdsMemo = { file, stamp, index };
  return index;
}
/** The hold on a coach, or null. With no readable holds file every coach is held. */
export function activationHold(coachId, file = HOLDS_PATH) {
  const index = activationHolds(file);
  if (index === null) return { coach_id: coachId, hold: 'HOLDS_FILE_UNREADABLE', reason: 'activation holds could not be read' };
  return index.get(coachId) || null;
}

const memo = new WeakMap();
/** The connection's write state: changes by this connection, or a commit by any other. */
function writeToken(handle) {
  return `${handle.pragma('data_version', { simple: true })}:${handle.prepare('SELECT total_changes()').pluck().get()}`;
}

/**
 * The reconciler's decision for every coach on `handle`, fresh as of the connection's last write.
 * -> Map(coach_id -> reconciled row), plus `programmeOf` (colleges id -> logical programme id).
 */
export function canonicalDecisions(handle, { scope = process.env.STRICT_CORROB_SCOPE || 'NAIA' } = {}) {
  const token = `${writeToken(handle)}|${scope}`;
  const hit = memo.get(handle);
  if (hit && hit.token === token) return hit.value;
  const byCoach = new Map(reconcileCoachRows(handle, { scope }).map((r) => [r.coach_id, r]));
  const hasLinks = !!handle.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='programme_row_links'").get();
  const canonOf = new Map(hasLinks ? handle.prepare('SELECT college_id, canonical_college_id FROM programme_row_links').all().map((l) => [l.college_id, l.canonical_college_id]) : []);
  const filedId = new Map(handle.prepare('SELECT id, name, sport FROM colleges').all().map((c) => [`${c.name}|${c.sport}`, c.id]));
  const value = { byCoach, logical: (id) => (id == null ? null : canonOf.get(id) || id), filedId: (school, sport) => filedId.get(`${school}|${sport}`) ?? null };
  memo.set(handle, { token, value });
  return value;
}

/**
 * Why `row` (a coaches row: id, email, school, sport) is NOT canonically eligible at its filed
 * programme, or null. Read-only.
 */
export function canonicalIneligibility(row, handle, opts = {}) {
  if (!row?.id) return CANONICAL_INELIGIBLE.NO_CANONICAL_DECISION;
  const held = activationHold(row.id);
  if (held) return `${CANONICAL_INELIGIBLE.ACTIVATION_HELD}:${held.hold}`;
  const d = canonicalDecisions(handle, opts);
  const r = d.byCoach.get(row.id);
  if (!r) return CANONICAL_INELIGIBLE.NO_CANONICAL_DECISION;
  if (r.outreach_eligibility !== 'YES') {
    return r.ineligible_reason === ABSENCE_REASON ? CANONICAL_INELIGIBLE.EMAIL_POSITIVELY_ABSENT : CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE;
  }
  if (lc(r.email) !== lc(row.email)) return CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE;
  const filed = d.filedId(row.school, row.sport);
  // no colleges row for the filed school: only a KEEP at that same school name is the same programme
  if (filed == null) {
    const sameSchool = lc(r.legacy_school) === lc(row.school) && (r.canonical_school == null || lc(r.canonical_school) === lc(row.school));
    return r.classification === 'KEEP' && r.canonical_college_id == null && sameSchool ? null : CANONICAL_INELIGIBLE.CANONICAL_PROGRAMME_MISMATCH;
  }
  if (d.logical(filed) !== d.logical(r.canonical_college_id)) return CANONICAL_INELIGIBLE.CANONICAL_PROGRAMME_MISMATCH;
  return null;
}
