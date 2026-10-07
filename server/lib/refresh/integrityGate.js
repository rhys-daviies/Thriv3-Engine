/**
 * PROMOTION GATE — Phase 7E. No refresh batch promotes unless ALL of these hold on the
 * simulated post-promotion database:
 *
 *   G1  every programme resolves to one athletics entity (validator H1/H6/H9/H10)
 *   G2  no cross-entity domain contradiction (validator H7 + zero eligible source-domain conflicts)
 *   G3  no wrong-institution eligible coach
 *   G4  no wrong-sport eligible coach
 *   G5  no stale (PROVEN_STALE) eligible coach
 *   G6  no inferred email becomes eligible (eligible => verified; every NEWLY eligible coach's
 *       address was seen on a host its own programme's entity owns)
 *   G7  no synthetic federal UNITID (validator H2/H3/H4/H5/H8)
 *   G8  no unexplained programme duplicate (validator H6)
 *   G9  no historical season rewritten (every season_freezes fingerprint unchanged)
 *   G10 every NCAA/NAIA/NJCAA/USCAA membership change is explained by an op in the batch
 *   G11 DB integrity_check ok
 *   G12 privacy: the redacted report carries no address and no person name
 *   G13 every VERIFIED programme contact passes the programme-contact floor (Phase 1B; its own
 *       validator, never the coach floor)
 *   G14 every programme-contact change is an op in the batch (nothing appears, moves or
 *       disappears that the plan did not write)
 */
import Database from 'better-sqlite3';
import { validateEntityIdentity } from '../../scripts/validateAthleticsEntityIdentity.js';
import { seasonFingerprint } from './temporal.js';
import { loadRefreshContext } from './context.js';
import { DIVISIONS } from './integrityMeasure.js';
import { buildProgrammeContactContext, programmeContactProblems } from '../programmeContactEligibility.js';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const byCat = (hard, codes) => hard.filter((h) => codes.some((c) => h.startsWith(c)));

/** Entities+sports and coach ids a plan legitimately touches (for G10 accounting). */
export function planFootprint(plan, observations = []) {
  const byObs = new Map(observations.map((o) => [o.observation_id, o]));
  const programmes = new Set(); const coaches = new Set(); const contacts = new Set();
  for (const op of plan.ops) {
    const o = byObs.get(op.observation_id);
    if (op.dataset === 'PROGRAMME_CONTACT' && op.expected?.contact_id) contacts.add(op.expected.contact_id);
    if (op.dataset === 'PROGRAMME' && o?.candidate_entity_id) programmes.add(`${o.candidate_entity_id}|${(JSON.parse(o.raw_json || '{}')).sport}`);
    if (op.dataset === 'COACH') { if (op.expected?.id) coaches.add(op.expected.id); if (op.action === 'CREATE_COACH') coaches.add(op.insert_id); }
  }
  return { programmes, coaches, contacts };
}

/**
 * pre/post: measureDatabase() results; postPath: the simulated post database file.
 * footprint: planFootprint(); redactedReport: the report text that will be shared.
 * extraExplained: {programmes:Set, coaches:Set} explained by a reviewed structural fixture.
 */
export function evaluateGates({ pre, post, postPath, footprint, redactedReport = '', personNames = [], extraExplained = null, now = new Date() }) {
  const db = new Database(postPath, { readonly: true, fileMustExist: true });
  let v; let integ; let freezes = []; let ctx; let frozenDiff = []; let invalidContacts = [];
  try {
    v = validateEntityIdentity(db);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='programme_contacts'").get()) {
      const pcCtx = buildProgrammeContactContext(db);
      for (const r of db.prepare("SELECT * FROM programme_contacts WHERE status='VERIFIED' ORDER BY contact_id").all()) {
        const p = programmeContactProblems(r, pcCtx, { now });
        if (p.length) invalidContacts.push(`${r.contact_id}: ${p.join(',')}`);
      }
    }
    integ = db.pragma('integrity_check', { simple: true });
    freezes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='season_freezes'").get() ? db.prepare('SELECT * FROM season_freezes').all() : [];
    frozenDiff = freezes.filter((f) => JSON.stringify(seasonFingerprint(db, f.season)) !== f.fingerprint_json).map((f) => `${f.season}/${f.scope}`);
    ctx = loadRefreshContext(db);
  } finally { db.close(); }
  const hard = v.hard || [];
  const explainedProg = new Set([...(footprint?.programmes || []), ...(extraExplained?.programmes || [])]);
  const explainedCoach = new Set([...(footprint?.coaches || []), ...(extraExplained?.coaches || [])]);
  const entityOfCollege = new Map(ctx.colleges.map((c) => [c.id, `${c.athletics_entity_id}|${c.sport}`]));
  const unexplained = [];
  for (const d of DIVISIONS) {
    const a = new Set(pre.universe[d]?.keys || []); const b = new Set(post.universe[d]?.keys || []);
    for (const k of [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)))) if (!explainedProg.has(k)) unexplained.push(`${d} programme ${k}`);
    const ca = new Set(pre.membership[d]?.ids || []); const cb = new Set(post.membership[d]?.ids || []);
    for (const id of [...ca].filter((x) => !cb.has(x)).concat([...cb].filter((x) => !ca.has(x)))) {
      const progKey = entityOfCollege.get(post.canon[id] || pre.canon[id]);
      if (!explainedCoach.has(id) && !explainedProg.has(progKey)) unexplained.push(`${d} coach ${String(id).slice(0, 8)}`);
    }
  }
  const preElig = new Set(pre.eligible_ids);
  const newly = post.eligible_ids.filter((id) => !preElig.has(id));
  const badNew = newly.filter((id) => { const d = post.eligible_detail[id]; const ent = ctx.colleges.find((c) => c.id === d?.college_id)?.athletics_entity_id; return !d?.email_seen_host || !ent || !ctx.resolver.hostOwnedBy(d.email_seen_host, ent); });
  const preD = pre.programme_contacts?.digests || {}; const postD = post.programme_contacts?.digests || {};
  const explainedContacts = new Set([...(footprint?.contacts || []), ...(extraExplained?.contacts || [])]);
  const unexplainedContacts = [...new Set([...Object.keys(preD), ...Object.keys(postD)])].filter((id) => preD[id] !== postD[id] && !explainedContacts.has(id));
  const leak = EMAIL.test(redactedReport) || personNames.filter((n) => n && n.length > 3).some((n) => redactedReport.includes(n));
  const gates = {
    G1_programme_resolves_to_one_entity: byCat(hard, ['H1', 'H6', 'H9', 'H10']).length === 0,
    G2_no_cross_entity_domain_contradiction: byCat(hard, ['H7']).length === 0 && post.integrity.source_domain_conflicts === 0,
    G3_no_wrong_institution_eligible: post.integrity.wrong_institution_eligible === 0,
    G4_no_wrong_sport_eligible: post.integrity.wrong_sport_eligible === 0,
    G5_no_stale_eligible: post.integrity.stale_eligible === 0,
    G6_no_inferred_email_eligible: post.integrity.inferred_eligible === 0 && badNew.length === 0,
    G7_no_synthetic_federal_unitid: byCat(hard, ['H2', 'H3', 'H4', 'H5', 'H8']).length === 0,
    G8_no_unexplained_programme_duplicate: byCat(hard, ['H6']).length === 0,
    G9_no_historical_season_rewritten: frozenDiff.length === 0,
    G10_membership_changes_accounted: unexplained.length === 0,
    G11_db_integrity_ok: integ === 'ok',
    G12_privacy: !leak,
    G13_programme_contacts_valid: invalidContacts.length === 0,
    G14_programme_contact_changes_accounted: unexplainedContacts.length === 0,
  };
  return { pass: Object.values(gates).every(Boolean), gates, details: { validator_hard: hard, frozen_changed: frozenDiff, unexplained_membership: unexplained, newly_eligible: newly.length, newly_eligible_without_owned_evidence: badNew.map((x) => String(x).slice(0, 8)), freezes: freezes.length, programme_contacts_invalid: invalidContacts, programme_contacts_unexplained: unexplainedContacts } };
}
