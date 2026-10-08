/**
 * COMPOSITE CORRECTION WRITER — Phase 8D.3C.
 *
 * WHY. Some integrity repairs only make sense together. Reversing a wrongly-refused athletics host
 * (protectedCorrection.js) makes every coach whose email/source sits on that host corroborable at
 * once, including coaches who are filed under the wrong programme or are no longer employed. Run as
 * separate writers, each commit exposes a state no reviewer approved (Phase 8D.3A: the domain fix
 * alone made 7 coaches eligible prematurely). This coordinator runs ordered correction stages on
 * ONE connection inside ONE `BEGIN IMMEDIATE`, gates every stage on the uncommitted state, and
 * either commits all of it or none of it.
 *
 * STAGE TYPES (rank = the only order allowed; equal ranks may repeat):
 *   1 COACH_CURRENTNESS / withhold_before_A   — disproven currentness -> PROVEN_STALE
 *   1 COACH_EMAIL_ABSENCE                      — recorded address positively unpublished (8D.3D) -> observation row
 *   1.5 DOMAIN_OWNERSHIP_CORRECTION            — authenticated host ownership: reassign / restore / promote,
 *                                                bare + www together (domainOwnershipCorrection, DI-03B). It runs
 *                                                BEFORE relabels: a coach relabel is attributed through the hosts
 *                                                it lands on, so those hosts must already name the right owner.
 *   2 COACH_INSTITUTION                        — coach filed at the wrong programme -> right one
 *   3 COACH_CURRENTNESS / reinstate_after_B   — PROVEN_STALE -> CURRENT on the coach's own page
 *   4 PROTECTED_SOURCE_CORRECTION             — WRONG_INSTITUTION -> VERIFIED (protectedCorrection)
 *
 * AUTHORISATION. Nothing runs without an approval record (kind COMPOSITE_CORRECTION_APPROVAL) that
 * names the exact stage list — type, group, fixture hash, in order — the baseline eligible-coach ID
 * set hash it was approved against, and, per stage, the EXACT coach IDs that may become eligible
 * and that may stop being eligible. Counts are never compared on their own.
 *
 * PER-STAGE GATES, all on the same uncommitted connection (no other process can see them):
 *   - the stage's own expected-old preconditions, re-read inside the transaction
 *   - write accounting: SQLite total_changes() moves by exactly the manifest's entry count
 *   - identity validator PASS; host-ownership disagreements 0; foreign_key_check on the touched tables
 *   - eligibility measured IN-PROCESS by the one engine (coachReconciler via measureInProcess):
 *     added / removed ID sets equal the approved sets exactly; no integrity counter rises above the
 *     baseline; the programme universe (every division) is unchanged
 *   - attribution: every relabelled coach resolves to its new programme (or is ineligible)
 *   - currentness: every withheld coach is ineligible
 * ACTIVATION HOLDS (DI-03B): a run containing a DOMAIN_OWNERSHIP_CORRECTION stage may only make a coach
 *   newly eligible if that coach is already under an activation hold (server/data/seeds/
 *   coach_activation_holds.json, read through canonicalCoachEligibility.activationHolds — the file every
 *   send path enforces). An unreadable holds file, or any unheld newly eligible coach, refuses the whole
 *   run: an ownership correction can never activate outreach on its own.
 * FINAL: full PRAGMA integrity_check, then COMMIT. Any throw anywhere -> ROLLBACK of everything.
 *
 * The result manifest is ONE promotion-format revert list over every changed row; revertComposite
 * restores it in one transaction and refuses if any of those rows changed since (so it can never
 * overwrite someone else's later write).
 */
import crypto from 'node:crypto';
import { fixtureHash, applyProtectedCorrectionsInTransaction, ownershipPostcheck, PROTECTED_CORRECTION_KIND } from './protectedCorrection.js';
import { applyCoachInstitutionInTransaction, applyCoachCurrentnessInTransaction, applyCoachEmailAbsenceInTransaction, COACH_INSTITUTION_KIND, COACH_CURRENTNESS_KIND, COACH_EMAIL_ABSENCE_KIND, CURRENTNESS_GROUPS } from './coachCorrection.js';
import { measureInProcess, DIVISIONS } from './integrityMeasure.js';
import { revertManifest } from './promotion.js';
import { loadRefreshContext } from './context.js';
import { hostOwnershipDisagreements } from './identityResolver.js';
import { validateEntityIdentity } from '../../scripts/validateAthleticsEntityIdentity.js';
import { applyDomainOwnershipInTransaction, domainOwnershipPostcheck, DOMAIN_OWNERSHIP_KIND } from './domainOwnershipCorrection.js';
import { activationHolds, HOLDS_PATH } from '../canonicalCoachEligibility.js';

export const COMPOSITE_APPROVAL_KIND = 'COMPOSITE_CORRECTION_APPROVAL';
export const COMPOSITE_MANIFEST_PHASE = 'COMPOSITE_CORRECTION';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const idSetHash = (ids) => sha([...ids].sort().join(','));

/** Stage type + group -> its rank in the only permitted order. */
export function stageRank(s) {
  if (s.type === COACH_EMAIL_ABSENCE_KIND) return 1; // a withhold: positive email absence (8D.3D)
  if (s.type === COACH_CURRENTNESS_KIND && s.group === 'withhold_before_A') return 1;
  if (s.type === DOMAIN_OWNERSHIP_KIND) return 1.5; // hosts must name the right owner before any relabel is attributed through them
  if (s.type === COACH_INSTITUTION_KIND) return 2;
  if (s.type === COACH_CURRENTNESS_KIND && s.group === 'reinstate_after_B') return 3;
  if (s.type === PROTECTED_CORRECTION_KIND) return 4;
  return null;
}

/** Approval hash: sha256 of the body without approval_hash / phase / created_at (fixture convention). */
export function approvalHash(ap) {
  const { approval_hash, phase, created_at, ...body } = ap; // eslint-disable-line no-unused-vars
  return sha(JSON.stringify(body));
}

const INTEGRITY_KEYS = ['source_domain_conflicts', 'wrong_institution_eligible', 'wrong_sport_eligible', 'stale_eligible', 'inferred_eligible', 'duplicate_identity', 'canonical_round_trip'];
const fail = (msg, problems) => Object.assign(new Error(msg), problems ? { problems } : {});

/**
 * Validate stages + approval without touching the database. Returns problems ([] = authorised).
 * `stages`: [{ stage_id, type, group?, fixture }] in execution order.
 */
export function validateComposite(stages, approval) {
  const problems = [];
  if (!Array.isArray(stages) || !stages.length) return ['no stages'];
  if (approval?.kind !== COMPOSITE_APPROVAL_KIND) problems.push(`approval kind must be ${COMPOSITE_APPROVAL_KIND}`);
  for (const k of ['approval_id', 'approved_by', 'approved_at', 'basis']) if (!approval?.[k]) problems.push(`approval missing ${k}`);
  if (!approval?.approval_hash || approvalHash(approval) !== approval.approval_hash) problems.push('approval_hash does not match the approval body');
  if (!approval?.baseline?.eligible_ids_hash) problems.push('approval must pin baseline.eligible_ids_hash');
  const ap = Array.isArray(approval?.stages) ? approval.stages : [];
  if (ap.length !== stages.length) problems.push(`approval lists ${ap.length} stage(s), run has ${stages.length}`);
  const ids = new Set(); let last = 0;
  stages.forEach((s, i) => {
    const label = s?.stage_id || `#${i}`;
    if (!s?.stage_id || ids.has(s.stage_id)) problems.push(`${label}: stage_id missing or duplicated`); ids.add(s?.stage_id);
    const rank = stageRank(s || {});
    if (rank == null) { problems.push(`${label}: unknown stage ${s?.type}/${s?.group ?? '-'}`); return; }
    if (rank < last) problems.push(`${label}: out of order (rank ${rank} after ${last}); order is withhold -> domain ownership -> institution -> reinstate -> protected domain`);
    last = Math.max(last, rank);
    if (s.type === COACH_CURRENTNESS_KIND && !CURRENTNESS_GROUPS[s.group]) problems.push(`${label}: unknown currentness group`);
    if (s.fixture?.kind !== s.type) problems.push(`${label}: fixture kind ${s.fixture?.kind} != stage type ${s.type}`);
    const h = s.fixture ? fixtureHash(s.fixture) : null;
    if (!h || h !== s.fixture.fixture_hash) problems.push(`${label}: fixture hash does not reproduce (computed ${String(h).slice(0, 12)}, stored ${String(s.fixture?.fixture_hash).slice(0, 12)})`);
    const a = ap[i];
    if (!a) return;
    if (a.stage_id !== s.stage_id || a.type !== s.type || (a.group ?? null) !== (s.group ?? null) || a.fixture_hash !== h) problems.push(`${label}: not the stage the approval authorises (approval #${i}: ${a.stage_id} ${a.type}/${a.group ?? '-'} ${String(a.fixture_hash).slice(0, 12)})`);
    if (!Array.isArray(a.eligibility?.added) || !Array.isArray(a.eligibility?.removed)) problems.push(`${label}: approval must list the exact eligibility added/removed coach IDs (may be empty)`);
  });
  return problems;
}

function stageGate(db, ctx) {
  const v = validateEntityIdentity(db);
  if (v.status !== 'PASS') throw fail('identity invariant FAIL', v.hard.slice(0, 20));
  const rc = loadRefreshContext(db);
  const dis = hostOwnershipDisagreements({ resolver: rc.resolver, domains: rc.domains, entities: [...new Set(rc.entities.map((e) => e.athletics_entity_id))] });
  if ((dis.length ?? dis) !== 0) throw fail(`host ownership disagreements: ${dis.length ?? dis}`);
  const hasAbs = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coach_email_absence_observations'").get();
  const fk = [...db.prepare('PRAGMA foreign_key_check(coaches)').all(), ...db.prepare('PRAGMA foreign_key_check(athletics_domains)').all(),
    ...(hasAbs ? db.prepare('PRAGMA foreign_key_check(coach_email_absence_observations)').all() : [])];
  if (fk.length) throw fail(`foreign_key_check: ${fk.length} violation(s)`);
  return ctx;
}

const diffIds = (a, b) => ({ added: [...b].filter((x) => !a.has(x)).sort(), removed: [...a].filter((x) => !b.has(x)).sort() });
const sameSet = (x, y) => x.length === y.length && [...x].sort().join(',') === [...y].sort().join(',');

/**
 * Run the composite correction. `apply=false` runs EVERYTHING (writes, gates, measurements) inside
 * the transaction and then rolls it back — a full rehearsal that leaves the database untouched.
 * `inject(point)` is a test hook called at every named point; a throw there must roll back all.
 * Returns { committed, report, manifest }.
 */
export function runCompositeCorrection(db, stages, approval, { apply = false, now = new Date().toISOString(), scope = 'NAIA', inject = null, activationHoldsFile = HOLDS_PATH } = {}) {
  const hit = (p) => { if (inject) inject(p); };
  const problems = validateComposite(stages, approval);
  if (problems.length) throw fail(`composite correction refused: ${problems.length} problem(s)`, problems);
  if (db.inTransaction) throw fail('composite correction must own its transaction (connection already in one)');
  const report = { approval_id: approval.approval_id, approval_hash: approval.approval_hash, applied_at: now, apply, stages: [] };
  const manifest = [];
  const relabelled = new Map(); const withheld = new Set();
  const total = () => db.prepare('SELECT total_changes() AS n').get().n;
  db.exec('BEGIN IMMEDIATE');
  try {
    hit('begin');
    const m0 = measureInProcess(db, { scope });
    const base = new Set(m0.eligible_ids);
    if (idSetHash(base) !== approval.baseline.eligible_ids_hash) throw fail(`baseline eligible-ID set ${idSetHash(base).slice(0, 12)} is not the approved baseline ${approval.baseline.eligible_ids_hash.slice(0, 12)} — stale approval`);
    report.baseline = { eligible: base.size, eligible_ids_hash: idSetHash(base), integrity: m0.integrity, universe: Object.fromEntries(DIVISIONS.map((d) => [d, m0.universe[d].hash])) };
    let prev = base;
    stages.forEach((s, i) => {
      hit(`stage:${s.stage_id}:begin`);
      const t0 = total();
      const onAction = (_p, k) => { if (k === 0) hit(`stage:${s.stage_id}:action`); };
      let r;
      if (s.type === PROTECTED_CORRECTION_KIND) r = applyProtectedCorrectionsInTransaction(db, s.fixture, { now, postcheck: ownershipPostcheck, onAction });
      else if (s.type === DOMAIN_OWNERSHIP_KIND) r = applyDomainOwnershipInTransaction(db, s.fixture, { now, postcheck: domainOwnershipPostcheck, onAction });
      else if (s.type === COACH_INSTITUTION_KIND) r = applyCoachInstitutionInTransaction(db, s.fixture, { onAction });
      else if (s.type === COACH_EMAIL_ABSENCE_KIND) r = applyCoachEmailAbsenceInTransaction(db, s.fixture, { now, onAction });
      else r = applyCoachCurrentnessInTransaction(db, s.fixture, s.group, { now, onAction });
      const entries = r.manifest.reduce((n, m) => n + m.entries.length, 0);
      if (total() - t0 !== entries) throw fail(`${s.stage_id}: ${total() - t0} row change(s) but ${entries} manifest entr(ies) — an unaccounted write`);
      if (s.type === COACH_INSTITUTION_KIND) r.plan.forEach((p) => relabelled.set(p.row.id, p.target.id));
      if ((s.type === COACH_CURRENTNESS_KIND && s.group === 'withhold_before_A') || s.type === COACH_EMAIL_ABSENCE_KIND) r.plan.forEach((p) => withheld.add(p.row.id));
      hit(`stage:${s.stage_id}:written`);
      stageGate(db, {});
      hit(`stage:${s.stage_id}:eligibility`);
      const m = measureInProcess(db, { scope });
      const now_ = new Set(m.eligible_ids);
      const d = diffIds(prev, now_);
      const want = approval.stages[i].eligibility;
      if (!sameSet(d.added, want.added) || !sameSet(d.removed, want.removed)) {
        throw fail(`${s.stage_id}: eligibility delta is not the approved one`, [
          `added ${d.added.length} (approved ${want.added.length}); unapproved additions: ${d.added.filter((x) => !want.added.includes(x)).join(', ') || 'none'}; approved but absent: ${want.added.filter((x) => !d.added.includes(x)).join(', ') || 'none'}`,
          `removed ${d.removed.length} (approved ${want.removed.length}); unapproved removals: ${d.removed.filter((x) => !want.removed.includes(x)).join(', ') || 'none'}; approved but absent: ${want.removed.filter((x) => !d.removed.includes(x)).join(', ') || 'none'}`]);
      }
      const rose = INTEGRITY_KEYS.filter((k) => (m.integrity[k] ?? 0) > (m0.integrity[k] ?? 0));
      if (rose.length) throw fail(`${s.stage_id}: integrity counter(s) rose: ${rose.map((k) => `${k} ${m0.integrity[k]}->${m.integrity[k]}`).join(', ')}`);
      const moved = DIVISIONS.filter((dv) => m.universe[dv].hash !== m0.universe[dv].hash);
      if (moved.length) throw fail(`${s.stage_id}: programme universe changed in ${moved.join(', ')}`);
      const misattributed = [...relabelled].filter(([id, target]) => { const c = m.canon[id]; return now_.has(id) ? c !== target : (c != null && c !== target); });
      if (misattributed.length) throw fail(`${s.stage_id}: relabelled coach(es) resolve elsewhere: ${misattributed.map(([id]) => `${id} -> ${m.canon[id]}`).join(', ')}`);
      const staleEligible = [...withheld].filter((id) => now_.has(id));
      if (staleEligible.length) throw fail(`${s.stage_id}: withheld coach(es) eligible: ${staleEligible.join(', ')}`);
      manifest.push(...r.manifest);
      report.stages.push({ stage_id: s.stage_id, type: s.type, group: s.group ?? null, fixture_hash: s.fixture.fixture_hash, applied: r.applied, rows_changed: entries,
        eligibility: { before: prev.size, after: now_.size, added: d.added, removed: d.removed }, integrity: m.integrity });
      prev = now_;
    });
    hit('final:integrity');
    const integ = db.pragma('integrity_check', { simple: true });
    if (integ !== 'ok') throw fail(`integrity ${integ}`);
    report.final = { eligible: prev.size, eligible_ids_hash: idSetHash(prev), added: diffIds(base, prev).added, removed: diffIds(base, prev).removed };
    if (stages.some((s) => s.type === DOMAIN_OWNERSHIP_KIND)) {
      hit('final:activation-holds');
      const holds = activationHolds(activationHoldsFile);
      if (holds === null) throw fail(`activation holds unreadable (${activationHoldsFile}) — an ownership correction may not run without them (fail closed)`);
      const unheld = report.final.added.filter((id) => !holds.has(id));
      if (unheld.length) throw fail(`${unheld.length} newly eligible coach(es) without an activation hold — the correction would activate outreach`, unheld);
      report.final.activation_holds = { file: activationHoldsFile, newly_eligible: report.final.added.length, all_held: true };
    }
    hit('final:precommit');
    if (apply) db.exec('COMMIT'); else db.exec('ROLLBACK');
  } catch (err) { if (db.inTransaction) { try { db.exec('ROLLBACK'); } catch { /* */ } } throw err; }
  return {
    committed: apply, report,
    manifest: { phase: COMPOSITE_MANIFEST_PHASE, approval_id: approval.approval_id, approval_hash: approval.approval_hash, applied_at: now,
      fixture_hashes: stages.map((s) => s.fixture.fixture_hash), baseline: { eligible_ids_hash: report.baseline.eligible_ids_hash }, final: { eligible_ids_hash: report.final.eligible_ids_hash }, manifest },
  };
}

/**
 * Revert a composite manifest in ONE transaction. Every row must still hold exactly the values the
 * correction wrote (else refused — a later writer's change is never overwritten); afterwards the
 * identity validator must PASS and, unless `checkEligibility` is false, the eligible-coach ID set
 * must be the manifest's baseline again.
 */
export function revertComposite(db, man, { apply = false, scope = 'NAIA', checkEligibility = true, inject = null } = {}) {
  if (man?.phase !== COMPOSITE_MANIFEST_PHASE || !Array.isArray(man.manifest)) throw fail('not a composite correction manifest');
  if (db.inTransaction) throw fail('revert must own its transaction');
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = revertManifest(db, man.manifest, { inTransaction: true });
    if (inject) inject('revert:written');
    const v = validateEntityIdentity(db);
    if (v.status !== 'PASS') throw fail('identity invariant FAIL after revert', v.hard.slice(0, 20));
    let eligible_ids_hash = null;
    if (checkEligibility) {
      eligible_ids_hash = idSetHash(measureInProcess(db, { scope }).eligible_ids);
      if (eligible_ids_hash !== man.baseline.eligible_ids_hash) throw fail(`eligible-ID set after revert ${eligible_ids_hash.slice(0, 12)} != baseline ${man.baseline.eligible_ids_hash.slice(0, 12)}`);
    }
    const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw fail(`integrity ${integ}`);
    if (apply) db.exec('COMMIT'); else db.exec('ROLLBACK');
    return { reverted: r.reverted, eligible_ids_hash, committed: apply };
  } catch (err) { if (db.inTransaction) { try { db.exec('ROLLBACK'); } catch { /* */ } } throw err; }
}
