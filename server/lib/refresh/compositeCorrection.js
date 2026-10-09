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
 * AUTHENTICATION (DI-03F): the approval is a SIGNED envelope (approvalValidator.verifyApproval): OpenSSH
 *   signatures by enrolled reviewer keys over the canonical approval body, bound to the EXACT target
 *   database (correctionTarget: class + identity — PRODUCTION / SHARED_DEV / DISPOSABLE; anything
 *   unidentified refuses), the stage list and fixture hashes, the evidence the domain stages use (pinned
 *   official sources + page hashes), every contradiction it resolves, every hold release (by sha256), the
 *   exact coach and inbox sendability changes and the activation-holds file, for at most 14 days. Every
 *   fixture approval and release must name the same approval id. Typed reviewer names carry no authority.
 * SENDABILITY (DI-03D, every composite): the whole coach and programme-inbox universe is evaluated with
 *   the send-time floor (minus the hold) before the first stage and after the last, inside the
 *   transaction (sendability.js). The coaches that become sendable AND those that stop being sendable
 *   must be exactly the approved sets; every newly sendable coach must be under an activation hold in
 *   the holds file the target database's application enforces (its sha256 is pinned in the approval).
 *   Any inbox that becomes sendable refuses (inboxes have no hold).
 * LEDGER (DI-03F): a committed correction writes its correction_ledger row (correctionLedger.js) in the
 *   same transaction — the signed envelope, the target, the canonical manifest and its hash. An approval
 *   is single-use (the ledger id is derived from it).
 * FINAL: full PRAGMA integrity_check, then COMMIT. Any throw anywhere -> ROLLBACK of everything.
 *
 * The result manifest is ONE promotion-format revert list over every changed row. REVERT (DI-03F) is a
 * privileged write held to the same standard: a signed COMPOSITE_REVERT_APPROVAL for the same classified
 * target, naming the ledger id and manifest hash; the manifest must be the one THIS database's ledger
 * recorded as committed and not yet reverted (a fabricated, stale or foreign manifest has none); every
 * entry is checked against an allow-list of tables, operations and real columns; sendability is measured
 * before and after (newly / no-longer sendable coaches exactly approved, newly sendable held, no inbox
 * opened); the eligible set must return to the manifest's baseline; and the ledger records the revert.
 * Rows that changed since the correction refuse (never overwriting a later write); all of it is atomic.
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
import { verifyApproval, asInstant, bodyHash, canonicalJson, APPROVAL_KINDS } from './approvalValidator.js';
import { correctionTarget } from './correctionTarget.js';
import { sendabilitySnapshot, sendabilityDelta } from './sendability.js';
import { evidenceStore } from './officialEvidence.js';
import { ledgerId, ledgerEntry, recordLedger, markReverted, manifestSha, ensureDatabaseIdentity, databaseIdentity, LEDGER_KINDS } from './correctionLedger.js';

export const COMPOSITE_APPROVAL_KIND = APPROVAL_KINDS.COMPOSITE;
export const COMPOSITE_REVERT_KIND = APPROVAL_KINDS.REVERT;
export const COMPOSITE_MANIFEST_PHASE = 'COMPOSITE_CORRECTION';
export const COMPOSITE_REVERT_PHASE = 'COMPOSITE_REVERT';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const idSetHash = (ids) => sha([...ids].sort().join(','));
const HEX64 = /^[0-9a-f]{64}$/;

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

const INTEGRITY_KEYS = ['source_domain_conflicts', 'wrong_institution_eligible', 'wrong_sport_eligible', 'stale_eligible', 'inferred_eligible', 'duplicate_identity', 'canonical_round_trip'];
const fail = (msg, problems) => Object.assign(new Error(msg), problems ? { problems } : {});
const sameSet = (x, y) => Array.isArray(x) && Array.isArray(y) && x.length === y.length && [...x].sort().join(',') === [...y].sort().join(',');
const sortedJson = (list) => canonicalJson([...list].map(canonicalJson).sort());

/** The approved sendability block: exact coach and inbox sets + the holds file hash. */
function sendabilityProblems(sb) {
  const p = [];
  if (!sb || !['newly_sendable_coaches', 'no_longer_sendable_coaches', 'newly_sendable_contacts', 'no_longer_sendable_contacts'].every((k) => Array.isArray(sb[k])) || !HEX64.test(sb.activation_holds_sha256 || '')) {
    p.push('approval must list sendability.newly_sendable_coaches, .no_longer_sendable_coaches, .newly_sendable_contacts and .no_longer_sendable_contacts (exact, may be empty) and pin sendability.activation_holds_sha256');
  } else if (sb.newly_sendable_contacts.length) p.push('a correction may not make a programme inbox sendable (inboxes carry no activation hold)');
  return p;
}

/**
 * Structural checks of stages against an approval BODY (already authenticated by verifyApproval), without
 * touching the database. Returns problems ([] = consistent).
 * `stages`: [{ stage_id, type, group?, fixture }] in execution order.
 */
export function validateComposite(stages, body) {
  const problems = [];
  if (!Array.isArray(stages) || !stages.length) return ['no stages'];
  if (body?.kind !== COMPOSITE_APPROVAL_KIND) problems.push(`approval kind must be ${COMPOSITE_APPROVAL_KIND}`);
  problems.push(...sendabilityProblems(body?.sendability));
  if (!body?.baseline?.eligible_ids_hash) problems.push('approval must pin baseline.eligible_ids_hash');
  const ap = Array.isArray(body?.stages) ? body.stages : [];
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
    // one approval id end to end (DI-03E C-3): a fixture's own approval records only name the signed one
    for (const fa of Array.isArray(s?.fixture?.approvals) ? s.fixture.approvals : []) if (fa?.approval_id !== body?.approval_id) problems.push(`${label}: fixture approval ${fa?.approval_id} is not the signed approval ${body?.approval_id}`);
    const a = ap[i];
    if (!a) return;
    if (a.stage_id !== s.stage_id || a.type !== s.type || (a.group ?? null) !== (s.group ?? null) || a.fixture_hash !== h) problems.push(`${label}: not the stage the approval authorises (approval #${i}: ${a.stage_id} ${a.type}/${a.group ?? '-'} ${String(a.fixture_hash).slice(0, 12)})`);
    if (!Array.isArray(a.eligibility?.added) || !Array.isArray(a.eligibility?.removed)) problems.push(`${label}: approval must list the exact eligibility added/removed coach IDs (may be empty)`);
  });
  // hold releases: exactly the fixtures' releases, each bound by its sha256 and to this approval id
  const rels = stages.flatMap((s) => (Array.isArray(s?.fixture?.hold_releases) ? s.fixture.hold_releases : []));
  const want = (Array.isArray(body?.hold_releases) ? body.hold_releases : []);
  for (const r of rels) {
    if (r?.approval_id !== body?.approval_id) problems.push(`hold release ${r?.release_id}: approval ${r?.approval_id} is not the signed approval ${body?.approval_id}`);
    const w = want.find((x) => x?.release_id === r?.release_id);
    if (!w) problems.push(`hold release ${r?.release_id} is not listed in the signed approval`);
    else if (w.domain !== r.domain || Number(w.released_to_unitid) !== Number(r.released_to_unitid) || w.release_sha256 !== bodyHash(r)) problems.push(`hold release ${r?.release_id}: the signed approval lists a different release (domain / owner / release_sha256)`);
  }
  for (const w of want) if (!rels.some((r) => r?.release_id === w?.release_id)) problems.push(`the signed approval lists hold release ${w?.release_id}, which no stage carries`);
  const domain = stages.some((s) => s?.type === DOMAIN_OWNERSHIP_KIND);
  const ev = body?.evidence;
  if (domain && (!ev || !Array.isArray(ev.official_sources) || !Array.isArray(ev.pages))) problems.push('approval must list the evidence the domain stages use (evidence.official_sources [{source_id, sha256}] and evidence.pages [sha256])');
  if (!domain && ev && ((ev.official_sources || []).length || (ev.pages || []).length)) problems.push('approval lists evidence but no stage uses any');
  if (body?.contradiction_resolutions != null && !Array.isArray(body.contradiction_resolutions)) problems.push('contradiction_resolutions must be a list');
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

/** Compare a measured sendability delta with the approved block; throw on any difference. */
function assertSendability(sd, sb, tgt, what) {
  const exact = (got, want, label) => {
    if (!sameSet(got, want)) throw fail(`${what}: ${label} are not the approved set`, [`${label} ${got.length} (approved ${want.length}); unapproved: ${got.filter((x) => !want.includes(x)).join(', ') || 'none'}; approved but absent: ${want.filter((x) => !got.includes(x)).join(', ') || 'none'}`]);
  };
  exact(sd.newly_sendable_coaches, sb.newly_sendable_coaches, 'newly sendable coaches');
  const unheld = sd.newly_sendable_coaches.filter((id) => !tgt.holds.has(id));
  if (unheld.length) throw fail(`${what}: ${unheld.length} newly sendable coach(es) without an activation hold in ${tgt.holdsFile} — it would activate outreach`, unheld);
  if (sd.newly_sendable_contacts.length) throw fail(`${what}: ${sd.newly_sendable_contacts.length} programme inbox(es) would become sendable — refused (inboxes carry no activation hold)`, sd.newly_sendable_contacts);
  exact(sd.no_longer_sendable_coaches, sb.no_longer_sendable_coaches, 'no-longer-sendable coaches');
  exact(sd.no_longer_sendable_contacts, sb.no_longer_sendable_contacts, 'no-longer-sendable inboxes');
}

/** Authenticate an envelope for this database. -> { tgt, target, grant, problems } (never throws for auth). */
function authenticate(db, envelope, kind, { activationHoldsFile, now }) {
  let tgt;
  try { tgt = correctionTarget(db, { activationHoldsFile }); } catch (err) { throw fail(`refused: ${err.message}`, [err.message]); }
  const target = { class: tgt.class, identity: tgt.identity };
  const { problems, grant } = verifyApproval(envelope, { kind, target, now });
  if (grant && grant.body.sendability?.activation_holds_sha256 !== tgt.holdsSha256) problems.push(`the approval was made against activation holds ${String(grant.body.sendability?.activation_holds_sha256).slice(0, 12)}, the target's holds file is ${tgt.holdsSha256.slice(0, 12)} (${tgt.holdsFile})`);
  return { tgt, target, grant, problems };
}

/**
 * Run the composite correction under a SIGNED approval envelope. `apply=false` runs EVERYTHING (writes,
 * gates, measurements, the ledger row) inside the transaction and then rolls it back — a full rehearsal
 * that leaves the database untouched. `inject(point)` is a test hook called at every named point; a
 * throw there must roll back all. Returns { committed, report, manifest, manifest_sha256 }.
 */
export function runCompositeCorrection(db, stages, envelope, { apply = false, now = new Date().toISOString(), scope = 'NAIA', inject = null, activationHoldsFile = null, evidenceDir = null } = {}) {
  const hit = (p) => { if (inject) inject(p); };
  const nowD = asInstant(now);
  const { tgt, target, grant, problems } = authenticate(db, envelope, COMPOSITE_APPROVAL_KIND, { activationHoldsFile, now: nowD });
  const body = grant?.body;
  if (grant) problems.push(...validateComposite(stages, body));
  const ledger_id = grant ? ledgerId('CC', grant.body_hash) : null;
  if (ledger_id && ledgerEntry(db, ledger_id)) problems.push(`approval ${grant.approval_id} was already used (ledger ${ledger_id}) — approvals are single-use`);
  let store = null;
  if (stages?.some((s) => s?.type === DOMAIN_OWNERSHIP_KIND)) { try { store = evidenceStore(evidenceDir); } catch (err) { problems.push(err.message); } }
  if (problems.length) throw fail(`composite correction refused: ${problems.length} problem(s)`, problems);
  if (db.inTransaction) throw fail('composite correction must own its transaction (connection already in one)');
  const report = { approval_id: grant.approval_id, approval_body_hash: grant.body_hash, signers: grant.signers, ledger_id, applied_at: now, apply, stages: [] };
  const manifest = [];
  const relabelled = new Map(); const withheld = new Set();
  const used = { sources: new Map(), pages: new Set(), contradictions: [] };
  const total = () => db.prepare('SELECT total_changes() AS n').get().n;
  let man;
  db.exec('BEGIN IMMEDIATE');
  try {
    hit('begin');
    const m0 = measureInProcess(db, { scope });
    const base = new Set(m0.eligible_ids);
    if (idSetHash(base) !== body.baseline.eligible_ids_hash) throw fail(`baseline eligible-ID set ${idSetHash(base).slice(0, 12)} is not the approved baseline ${body.baseline.eligible_ids_hash.slice(0, 12)} — stale approval`);
    report.baseline = { eligible: base.size, eligible_ids_hash: idSetHash(base), integrity: m0.integrity, universe: Object.fromEntries(DIVISIONS.map((d) => [d, m0.universe[d].hash])) };
    report.target = { class: tgt.class, identity: tgt.identity, database: tgt.dbPath ?? ':memory:', why: tgt.why, activation_holds_file: tgt.holdsFile, activation_holds_sha256: tgt.holdsSha256, activation_holds: tgt.holdsCount };
    hit('sendability:before');
    const send0 = sendabilitySnapshot(db, { now: nowD });
    let prev = base;
    stages.forEach((s, i) => {
      hit(`stage:${s.stage_id}:begin`);
      const t0 = total();
      const onAction = (_p, k) => { if (k === 0) hit(`stage:${s.stage_id}:action`); };
      let r;
      if (s.type === PROTECTED_CORRECTION_KIND) r = applyProtectedCorrectionsInTransaction(db, s.fixture, { now, postcheck: ownershipPostcheck, onAction });
      else if (s.type === DOMAIN_OWNERSHIP_KIND) {
        r = applyDomainOwnershipInTransaction(db, s.fixture, { now, store, grant, ledger_id, postcheck: domainOwnershipPostcheck, onAction });
        r.evidence.official_sources.forEach((x) => used.sources.set(x.source_id, x)); r.evidence.pages.forEach((x) => used.pages.add(x)); used.contradictions.push(...r.evidence.contradictions_resolved);
      } else if (s.type === COACH_INSTITUTION_KIND) r = applyCoachInstitutionInTransaction(db, s.fixture, { onAction });
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
      const want = body.stages[i].eligibility;
      if (!sameSet(d.added, want.added) || !sameSet(d.removed, want.removed)) {
        throw fail(`${s.stage_id}: eligibility delta is not the approved one`, [
          `added ${d.added.length} (approved ${want.added.length}); unapproved additions: ${d.added.filter((x) => !want.added.includes(x)).join(', ') || 'none'}; approved but absent: ${want.added.filter((x) => !d.added.includes(x)).join(', ') || 'none'}`,
          `removed ${d.removed.length} (approved ${want.removed.length}); unapproved removals: ${d.removed.filter((x) => !want.removed.includes(x)).join(', ') || 'none'}; approved but absent: ${want.removed.filter((x) => !d.removed.includes(x)).join(', ') || 'none'}`]);
      }
      const rose = INTEGRITY_KEYS.filter((k) => (m.integrity[k] ?? 0) > (m0.integrity[k] ?? 0));
      if (rose.length) throw fail(`${s.stage_id}: integrity counter(s) rose: ${rose.map((k) => `${k} ${m0.integrity[k]}->${m.integrity[k]}`).join(', ')}`);
      const moved = DIVISIONS.filter((dv) => m.universe[dv].hash !== m0.universe[dv].hash);
      if (moved.length) throw fail(`${s.stage_id}: programme universe changed in ${moved.join(', ')}`);
      const misattributed = [...relabelled].filter(([id, tg]) => { const c = m.canon[id]; return now_.has(id) ? c !== tg : (c != null && c !== tg); });
      if (misattributed.length) throw fail(`${s.stage_id}: relabelled coach(es) resolve elsewhere: ${misattributed.map(([id]) => `${id} -> ${m.canon[id]}`).join(', ')}`);
      const staleEligible = [...withheld].filter((id) => now_.has(id));
      if (staleEligible.length) throw fail(`${s.stage_id}: withheld coach(es) eligible: ${staleEligible.join(', ')}`);
      manifest.push(...r.manifest);
      report.stages.push({ stage_id: s.stage_id, type: s.type, group: s.group ?? null, fixture_hash: s.fixture.fixture_hash, applied: r.applied, rows_changed: entries,
        eligibility: { before: prev.size, after: now_.size, added: d.added, removed: d.removed }, integrity: m.integrity });
      prev = now_;
    });
    hit('final:evidence');
    // the evidence the stages actually used is exactly the evidence the reviewers signed for
    const ev = body.evidence || { official_sources: [], pages: [] };
    if (sortedJson([...used.sources.values()]) !== sortedJson(ev.official_sources || [])) throw fail('the official sources the correction used are not the ones the approval lists', [`used ${canonicalJson([...used.sources.values()])}`, `approved ${canonicalJson(ev.official_sources || [])}`]);
    if (sortedJson([...used.pages]) !== sortedJson(ev.pages || [])) throw fail('the page evidence the correction used is not the evidence the approval lists', [`used ${[...used.pages].sort().join(', ')}`, `approved ${[...(ev.pages || [])].sort().join(', ')}`]);
    const unused = (body.contradiction_resolutions || []).filter((r) => !used.contradictions.some((c) => c.host === r.host && c.source_id === r.source_id && c.claimant === r.claimant));
    if (unused.length) throw fail(`${unused.length} contradiction resolution(s) resolve nothing this correction met — an approval resolves exactly what it needs`, unused.map((r) => `${r.host} ${r.source_id} ${r.claimant}`));
    hit('final:integrity');
    const integ = db.pragma('integrity_check', { simple: true });
    if (integ !== 'ok') throw fail(`integrity ${integ}`);
    report.final = { eligible: prev.size, eligible_ids_hash: idSetHash(prev), added: diffIds(base, prev).added, removed: diffIds(base, prev).removed };
    hit('final:sendability');
    const sd = sendabilityDelta(send0, sendabilitySnapshot(db, { now: nowD }));
    assertSendability(sd, body.sendability, tgt, 'correction');
    report.final.sendability = { ...sd, all_newly_sendable_held: true, activation_holds_file: tgt.holdsFile, activation_holds_sha256: tgt.holdsSha256 };
    const database_id = ensureDatabaseIdentity(db, target, nowD.toISOString());
    man = { phase: COMPOSITE_MANIFEST_PHASE, ledger_id, database_id, approval_id: grant.approval_id, approval_body_hash: grant.body_hash, target, signers: grant.signers.map((x) => ({ reviewer_id: x.reviewer_id, fingerprint: x.fingerprint })),
      applied_at: now, fixture_hashes: stages.map((s) => s.fixture.fixture_hash), baseline: { eligible_ids_hash: report.baseline.eligible_ids_hash }, final: { eligible_ids_hash: report.final.eligible_ids_hash }, manifest };
    hit('final:ledger');
    recordLedger(db, { ledger_id, database_id, kind: LEDGER_KINDS.CORRECTION, envelope, grant, target, manifest: man, committed_at: nowD.toISOString() });
    hit('final:precommit');
    if (apply) db.exec('COMMIT'); else db.exec('ROLLBACK');
  } catch (err) { if (db.inTransaction) { try { db.exec('ROLLBACK'); } catch { /* */ } } throw err; }
  return { committed: apply, report, manifest: man, manifest_sha256: manifestSha(man) };
}

/** What a revert may touch: table -> allowed entry kinds. Anything else in a manifest refuses. */
export const REVERTIBLE = Object.freeze({ athletics_domains: ['UPDATE'], coaches: ['UPDATE'], coach_email_absence_observations: ['INSERT'] });
const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Problems with a manifest's entries against the live schema ([] = every entry is a well-formed revertible write). */
export function manifestEntryProblems(db, manifest) {
  const p = [];
  if (!Array.isArray(manifest) || !manifest.length) return ['manifest has no entries'];
  for (const m of manifest) {
    for (const e of Array.isArray(m?.entries) ? m.entries : [null]) {
      const label = `${m?.observation_id ?? '?'} ${e?.table ?? '?'} ${JSON.stringify(e?.key ?? null)}`;
      if (!e || !REVERTIBLE[e.table]?.includes(e.kind)) { p.push(`${label}: ${e?.kind ?? '?'} on ${e?.table ?? '?'} is not a revertible correction write`); continue; }
      const cols = new Set(db.prepare(`PRAGMA table_info(${e.table})`).all().map((c) => c.name));
      const keys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : null);
      const k = keys(e.key); const nu = keys(e.new); const old = keys(e.old);
      if (!k?.length || k.some((x) => !IDENT.test(x) || !cols.has(x))) { p.push(`${label}: key must name real columns`); continue; }
      if (!nu?.length || nu.some((x) => !IDENT.test(x) || !cols.has(x))) { p.push(`${label}: "new" must be a non-empty set of real columns (an empty "new" would match any row)`); continue; }
      if (e.kind === 'UPDATE' && (!old?.length || old.some((x) => !IDENT.test(x) || !cols.has(x)) || [...old].sort().join(',') !== [...nu].sort().join(','))) p.push(`${label}: an UPDATE must restore exactly the columns it changed (old and new name the same real columns)`);
    }
  }
  return p;
}

/**
 * Revert a committed composite correction under a SIGNED COMPOSITE_REVERT_APPROVAL, in ONE transaction.
 * Returns { reverted, eligible_ids_hash, committed, ledger_id, sendability }.
 */
export function revertComposite(db, man, envelope, { apply = false, now = new Date().toISOString(), scope = 'NAIA', inject = null, activationHoldsFile = null } = {}) {
  const nowD = asInstant(now);
  if (man?.phase !== COMPOSITE_MANIFEST_PHASE || !Array.isArray(man.manifest)) throw fail('not a composite correction manifest');
  const { tgt, target, grant, problems } = authenticate(db, envelope, COMPOSITE_REVERT_KIND, { activationHoldsFile, now: nowD });
  const msha = manifestSha(man);
  if (grant) {
    const b = grant.body;
    problems.push(...sendabilityProblems(b.sendability));
    if (b.ledger_id !== man.ledger_id || b.manifest_sha256 !== msha) problems.push(`the revert approval is for ledger ${b.ledger_id} / manifest ${String(b.manifest_sha256).slice(0, 12)}, not ${man.ledger_id} / ${msha.slice(0, 12)}`);
  }
  const row = man.ledger_id ? ledgerEntry(db, man.ledger_id) : null;
  if (!row) problems.push(`manifest ${String(man.ledger_id)} is not a correction this database committed (no ledger row) — a fabricated, foreign or rehearsal manifest is never reverted`);
  else {
    if (row.kind !== LEDGER_KINDS.CORRECTION) problems.push(`ledger ${row.ledger_id} is a ${row.kind}`);
    if (row.status !== 'COMMITTED') problems.push(`ledger ${row.ledger_id} is already ${row.status}`);
    if (row.manifest_sha256 !== msha || row.manifest_json !== canonicalJson(man)) problems.push('the manifest is not byte-for-byte the one the ledger recorded');
    if (row.target_identity !== target.identity) problems.push(`ledger ${row.ledger_id} was committed to ${row.target_identity}, not this database`);
    if (!row.database_id || databaseIdentity(db)?.database_id !== row.database_id || man.database_id !== row.database_id) problems.push(`ledger ${row.ledger_id} belongs to database ${row.database_id ?? '?'}, not this one (${databaseIdentity(db)?.database_id ?? 'no identity'})`);
  }
  problems.push(...manifestEntryProblems(db, man.manifest));
  const rev_id = grant ? ledgerId('CR', grant.body_hash) : null;
  if (rev_id && ledgerEntry(db, rev_id)) problems.push(`revert approval ${grant.approval_id} was already used`);
  if (problems.length) throw fail(`revert refused: ${problems.length} problem(s)`, problems);
  if (db.inTransaction) throw fail('revert must own its transaction');
  db.exec('BEGIN IMMEDIATE');
  try {
    const send0 = sendabilitySnapshot(db, { now: nowD });
    const r = revertManifest(db, man.manifest, { inTransaction: true });
    if (inject) inject('revert:written');
    const v = validateEntityIdentity(db);
    if (v.status !== 'PASS') throw fail('identity invariant FAIL after revert', v.hard.slice(0, 20));
    const eligible_ids_hash = idSetHash(measureInProcess(db, { scope }).eligible_ids);
    if (eligible_ids_hash !== man.baseline.eligible_ids_hash) throw fail(`eligible-ID set after revert ${eligible_ids_hash.slice(0, 12)} != baseline ${man.baseline.eligible_ids_hash.slice(0, 12)}`);
    if (inject) inject('revert:sendability');
    const sd = sendabilityDelta(send0, sendabilitySnapshot(db, { now: nowD }));
    assertSendability(sd, grant.body.sendability, tgt, 'revert');
    const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw fail(`integrity ${integ}`);
    if (inject) inject('revert:ledger');
    markReverted(db, man.ledger_id, rev_id);
    const database_id = ensureDatabaseIdentity(db, target, nowD.toISOString());
    recordLedger(db, { ledger_id: rev_id, database_id, kind: LEDGER_KINDS.REVERT, envelope, grant, target, committed_at: nowD.toISOString(), reverts: man.ledger_id,
      manifest: { phase: COMPOSITE_REVERT_PHASE, ledger_id: rev_id, database_id, reverts: man.ledger_id, reverted_manifest_sha256: msha, approval_id: grant.approval_id, approval_body_hash: grant.body_hash, target, applied_at: now } });
    if (apply) db.exec('COMMIT'); else db.exec('ROLLBACK');
    return { reverted: r.reverted, eligible_ids_hash, committed: apply, ledger_id: rev_id, sendability: sd };
  } catch (err) { if (db.inTransaction) { try { db.exec('ROLLBACK'); } catch { /* */ } } throw err; }
}
