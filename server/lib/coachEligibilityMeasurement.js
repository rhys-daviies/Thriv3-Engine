/**
 * COACH ELIGIBILITY MEASUREMENTS E1–E11 — deployment readiness §4.
 *
 * Measures, it does not decide. Every eligibility answer here comes from the
 * EXISTING rule functions, called unchanged on the app's own database handle:
 *
 *   coachRowIneligibility   the row check (address, verification, currentness): what 387b916 enforced
 *   coachIneligibility      the full send-time rule: row check + canonical decision + activation holds
 *   canonicalDecisions      the reconciler's own per-coach decision, for explaining a refusal
 *   activationHold(s)       the hold list
 *   programmeCoaches        what the manual composer OFFERS (the floor, then opt-outs withheld)
 *   isSuppressed            the send-time opt-out check
 *
 * No rule is re-implemented, widened or narrowed here. The only logic of its
 * own is counting, grouping, and comparing two results (`evaluateGate`).
 *
 * It reads the module-level `db` (server/db/client.js). The command line
 * points that at a migrated COPY and proves nothing was written; tests point
 * it at their in-memory database.
 */
import crypto from 'node:crypto';
import db from '../db/client.js';
import { coachRowIneligibility, coachIneligibility } from './coachEligibility.js';
import { canonicalDecisions, activationHold, activationHolds, CANONICAL_INELIGIBLE } from './canonicalCoachEligibility.js';
import { programmeCoaches } from '../routes/programmeCoaches.js';
import { isSuppressed } from './suppressions.js';

export const MEASUREMENT_VERSION = 1;

export { PILOT_CELLS, GATE, evaluateGate } from './eligibilityGate.js';

const lc = (s) => String(s ?? '').trim().toLowerCase();
/** Looser than the rules' own normalisation, ONLY to find an opt-out the rules' form could miss. */
const loose = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/^mailto:/, '').replace(/[<>\s]/g, '').replace(/\.$/, '');
const cellOf = (division, sport) => `${division ?? '(none)'}|${sport ?? '(none)'}`;
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; return o; };
const reasonCode = (r) => (r == null ? 'ELIGIBLE' : String(r).split(':')[0]);
const has = (table, col) => !!db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, col);
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

/** Why a lost coach was refused, from the engine's own records. `explained` is false only when the engine left no reason. */
function explainLoss(coach, reason, decisions) {
  const code = reasonCode(reason);
  const d = decisions.byCoach.get(coach.id) ?? null;
  const base = { coachId: coach.id, programme: coach.school, sport: coach.sport, division: coach.division ?? null, reason };
  if (code === CANONICAL_INELIGIBLE.ACTIVATION_HELD) {
    const hold = activationHold(coach.id);
    return { ...base, explained: !!hold, detail: hold ? { hold: hold.hold, reason: hold.reason ?? null } : null };
  }
  if (code === CANONICAL_INELIGIBLE.NO_CANONICAL_DECISION) {
    return { ...base, explained: false, detail: { why: 'The reconciler produced no decision for this coach; needs a manual explanation.' } };
  }
  const detail = d ? {
    classification: d.classification ?? null,
    outreachEligibility: d.outreach_eligibility ?? null,
    ineligibleReason: d.ineligible_reason ?? null,
    canonicalCollegeId: d.canonical_college_id ?? null,
    canonicalSchool: d.canonical_school ?? null,
    reconcilerAddressDiffers: lc(d.email) !== lc(coach.email),
  } : null;
  const explained = !!d && !!(detail.ineligibleReason || detail.reconcilerAddressDiffers
    || code === CANONICAL_INELIGIBLE.EMAIL_POSITIVELY_ABSENT
    || (code === CANONICAL_INELIGIBLE.CANONICAL_PROGRAMME_MISMATCH && (detail.canonicalCollegeId || detail.canonicalSchool || detail.classification)));
  return { ...base, explained, detail };
}

function newestOf(pairs) {
  const out = {};
  for (const [t, cols] of pairs) {
    if (!hasTable(t)) { out[t] = null; continue; }
    const col = cols.find((c) => has(t, c));
    out[t] = col ? { column: col, newest: db.prepare(`SELECT MAX("${col}") v FROM "${t}"`).get().v ?? null } : null;
  }
  return out;
}

/**
 * E1–E11 for the database the app is pointed at.
 * @param {object} opts
 * @param {string} opts.scope  STRICT_CORROB_SCOPE to measure under. Required: the engine's
 *                             default would otherwise apply silently.
 */
export function measureCoachEligibility({ scope } = {}) {
  if (!scope) throw new Error('A STRICT_CORROB_SCOPE value is required (use production\'s, from §1b).');
  const decisions = canonicalDecisions(db, { scope, fresh: true });
  const coaches = db.prepare(`SELECT id, full_name, email, school, sport, division, email_status, currentness_status FROM coaches`).all();

  const e1 = {}; const e2 = {}; const e3 = {};
  const rowEligible = new Set(); const eligible = new Set();
  const lost = [];
  for (const c of coaches) {
    const cell = cellOf(c.division, c.sport);
    bump(e1, cell);
    const row = coachRowIneligibility(c);
    bump(e2[cell] ??= {}, reasonCode(row));
    if (row) continue;
    rowEligible.add(c.id);
    const full = coachIneligibility(c, { handle: db, decisions });
    bump(e3[cell] ??= {}, reasonCode(full));
    if (full == null) eligible.add(c.id);
    else lost.push(explainLoss(c, full, decisions));
  }

  // E4: programme coverage, by the programme's own division and sport.
  const colleges = db.prepare('SELECT id, name, sport, division FROM colleges WHERE active = 1').all();
  const filedEligible = new Map();
  for (const c of coaches) {
    if (!eligible.has(c.id)) continue;
    const k = `${c.school}|${c.sport}`;
    filedEligible.set(k, (filedEligible.get(k) ?? 0) + 1);
  }
  const e4 = {};
  for (const col of colleges) {
    const cell = e4[cellOf(col.division, col.sport)] ??= { programmes: 0, withEligibleCoach: 0, withOfferedCoach: 0 };
    cell.programmes += 1;
    if (filedEligible.get(`${col.name}|${col.sport}`)) cell.withEligibleCoach += 1;
    if (programmeCoaches({ collegeName: col.name, sport: col.sport }).length) cell.withOfferedCoach += 1;
  }
  for (const v of Object.values(e4)) v.coverage = v.programmes ? v.withEligibleCoach / v.programmes : null;

  // E5: lost coaches, each with the engine's own reason.
  const e5 = {
    lost: lost.length,
    byReason: lost.reduce((o, l) => bump(o, reasonCode(l.reason)), {}),
    unexplained: lost.filter((l) => !l.explained).length,
    coaches: lost.sort((a, b) => a.coachId.localeCompare(b.coachId)),
  };

  // E6: per-coach outcome, keyed for cross-database comparison. The fallback key is hashed, never an address.
  const e6 = coaches.map((c) => ({
    coachId: c.id,
    fallbackKey: crypto.createHash('sha256').update(`${lc(c.email)}|${c.school}|${c.sport}`).digest('hex').slice(0, 24),
    rowEligible: rowEligible.has(c.id),
    eligible: eligible.has(c.id),
  })).sort((a, b) => a.coachId.localeCompare(b.coachId));

  // E7: existing relationships whose coach main would refuse.
  const ineligibleIds = coaches.filter((c) => !eligible.has(c.id)).map((c) => c.id);
  const e7 = { confirmedSends: 0, pendingManualDrafts: 0, campaignLinkedSends: 0, athletesAffected: 0 };
  if (ineligibleIds.length && hasTable('outreach')) {
    // The ids travel as one JSON parameter: no temporary table, so nothing is written even to temp.
    const ids = JSON.stringify(ineligibleIds);
    const one = (sql) => db.prepare(sql).get(ids).n;
    const IN = 'IN (SELECT value FROM json_each(?))';
    e7.confirmedSends = one(`SELECT COUNT(*) n FROM outreach o WHERE o.coach_id ${IN} AND o.sent_at IS NOT NULL`);
    e7.athletesAffected = one(`SELECT COUNT(DISTINCT o.athlete_id) n FROM outreach o WHERE o.coach_id ${IN}`);
    if (hasTable('outreach_send') && has('outreach_send', 'state')) {
      e7.pendingManualDrafts = one(`SELECT COUNT(*) n FROM outreach_send s WHERE s.coach_id ${IN}
        AND s.sent_at IS NULL AND s.state = 'DRAFTED' AND s.origin = 'manual'`);
      e7.campaignLinkedSends = one(`SELECT COUNT(*) n FROM outreach_send s WHERE s.coach_id ${IN} AND s.programme_campaign_id IS NOT NULL`);
    }
  }

  // E8: opt-out safety, through the rules' own checks. Any violation blocks.
  const suppressions = db.prepare('SELECT email FROM suppressions').all().map((r) => r.email);
  const strict = new Set(suppressions.map(lc));
  const looseSet = new Set(suppressions.map(loose));
  const violations = [];
  const offeredCache = new Map();
  const offeredAt = (school, sport) => {
    const k = `${school}|${sport}`;
    if (!offeredCache.has(k)) offeredCache.set(k, new Set(programmeCoaches({ collegeName: school, sport }).map((x) => x.coach_id)));
    return offeredCache.get(k);
  };
  for (const c of coaches) {
    if (!eligible.has(c.id)) continue;
    const optedOut = strict.has(lc(c.email)) || looseSet.has(loose(c.email));
    if (!optedOut) continue;
    if (!isSuppressed(c.email)) violations.push({ coachId: c.id, check: 'SEND_TIME_NOT_SUPPRESSED' });
    if (offeredAt(c.school, c.sport).has(c.id)) violations.push({ coachId: c.id, check: 'OFFERED_DESPITE_OPT_OUT' });
  }
  const nonNormalised = suppressions.filter((e) => e !== lc(e)).length;
  const e8 = { suppressions: suppressions.length, nonNormalisedRows: nonNormalised, violations: violations.length, details: violations };

  // E9, E10, E11.
  const holds = activationHolds();   // a Map of coach id -> hold, or null when unreadable (every coach held)
  const e9 = holds
    ? { holdsReadable: true, holdEntries: holds.size, matchingCoaches: coaches.filter((c) => holds.has(c.id)).length }
    : { holdsReadable: false, holdEntries: null, matchingCoaches: coaches.length };
  const e10 = hasTable('programme_contacts')
    ? { programmeContacts: db.prepare('SELECT COUNT(*) n FROM programme_contacts').get().n,
      verified: db.prepare("SELECT COUNT(*) n FROM programme_contacts WHERE status = 'VERIFIED'").get().n }
    : { programmeContacts: null, verified: null };
  const e11 = newestOf([
    ['coach_seasons', ['imported_at', 'created_at', 'updated_at']],
    ['athletics_domains', ['checked_at', 'updated_at']],
    ['colleges', ['updated_date', 'created_date']],
    ['coaches', ['updated_at', 'created_at']],
  ]);

  return {
    version: MEASUREMENT_VERSION,
    scope,
    legacyCoachesFlag: process.env.THRIV3_ALLOW_LEGACY_COACHES ?? null,
    totals: { coaches: coaches.length, rowEligible: rowEligible.size, eligible: eligible.size },
    e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11,
  };
}
