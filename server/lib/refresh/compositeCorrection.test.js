import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../db/migrate.js';
import { fixtureHash, PROTECTED_CORRECTION_KIND, applyProtectedCorrectionsInTransaction } from './protectedCorrection.js';
import { COACH_INSTITUTION_KIND, COACH_CURRENTNESS_KIND, planCoachCurrentness, planCoachInstitution, applyCoachInstitutionInTransaction } from './coachCorrection.js';
import { runCompositeCorrection, revertComposite, approvalHash, idSetHash, validateComposite, COMPOSITE_APPROVAL_KIND } from './compositeCorrection.js';
import { measureInProcess } from './integrityMeasure.js';
import { reconcileCoachRows } from '../coachReconciler.js';

/**
 * PHASE 8D.3C — the composite correction writer. One invented world reproduces the 8D.3A shape:
 * a WRONG_INSTITUTION athletics host whose reversal makes coaches corroborable at once, including
 * one who left (must be withheld first), one filed under the wrong programme (relabelled first) and
 * one whose stale mark was judged against another school's page (reinstated after the relabel).
 */
const SCHEMA = fs.readFileSync(path.resolve(import.meta.dirname, '../../db/schema.sql'), 'utf8');
const OWN = 142001; const CLAIM = 240001; const WRONG = 310001; const OTHER = 320001;
const HOST = 'ownerathletics.com';
const NOW = '2026-10-08T00:00:00Z';

function world() {
  const db = new Database(':memory:'); db.exec(SCHEMA); migrate(db);
  const ent = db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?,?,?,'SINGLE','t','t')");
  ent.run('AE-OWN', 'Owner College', OWN); ent.run('AE-CLAIM', 'Claimant College', CLAIM); ent.run('AE-WRONG', 'Wrong Label College', WRONG); ent.run('AE-OTHER', 'Other College', OTHER);
  const col = db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?,'t','t',?,?,'NCAA D3',?,?,?)");
  col.run('c-own', 'Owner College', 'mens-soccer', 1, OWN, 'AE-OWN'); col.run('c-claim', 'Claimant College', 'mens-soccer', 1, CLAIM, 'AE-CLAIM');
  col.run('c-wrong', 'Wrong Label College', 'mens-soccer', 1, WRONG, 'AE-WRONG'); col.run('c-other', 'Other College', 'mens-soccer', 1, OTHER, 'AE-OTHER');
  col.run('c-gone', 'Retired College', 'mens-soccer', 0, 330001, null);
  const dom = (r) => db.prepare(`INSERT INTO athletics_domains (${Object.keys(r).join(',')}) VALUES (${Object.keys(r).map((k) => `@${k}`).join(',')})`).run(r);
  const base = { role: 'ATHLETICS_SITE', evidence_kind: 'OG_SITE_NAME', identity_method: 'VARIANT', identity_strength: 'WHOLE_NAME', platform: 'SIDEARM', http_status: 200, verification_method: 'PAGE_SELF_IDENTIFICATION', confidence: 'CERTAIN', notes: null, checked_at: '2026-09-01T09:28:40.920Z', athletics_entity_id: null, ownership_class: null };
  dom({ ...base, domain: HOST, unitid: OWN, status: 'WRONG_INSTITUTION', claimed_keys: JSON.stringify(['Owner College', 'Claimant']), claimed_unitids: JSON.stringify([OWN, CLAIM]), wrong_mappings: JSON.stringify([{ key: 'Claimant', claimantUnitid: CLAIM }]), evidence_text: 'Owner College Athletics', final_url: `https://${HOST}/` });
  dom({ ...base, domain: 'otherathletics.com', unitid: OTHER, status: 'VERIFIED', claimed_keys: '["Other College"]', claimed_unitids: `[${OTHER}]`, wrong_mappings: null, evidence_text: 'Other College Athletics', final_url: 'https://otherathletics.com/' });
  db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, source_url, imported_at) VALUES ('Owner College','mens-soccer',2025,'Somebody Else',?, 't')").run(`https://${HOST}/sports/mens-soccer/coaches`);
  const coach = db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, currentness_status, currentness_source_url) VALUES (?, 't', ?, ?, ?, 'NCAA D3', 'mens-soccer', 'Assistant Coach', 'verified', ?, ?, ?)");
  const src = `https://${HOST}/sports/mens-soccer/coaches`;
  coach.run('k-good', 'Alice Good', 'alice@owner.test', 'Owner College', src, null, null); // becomes eligible with the domain fix
  coach.run('k-gone', 'Bob Gone', 'bob@owner.test', 'Owner College', src, null, null); // left: withheld first
  coach.run('k-moved', 'Carl Moved', 'carl@owner.test', 'Wrong Label College', src, null, null); // misfiled: relabelled first
  coach.run('k-back', 'Dana Back', 'dana@owner.test', 'Owner College', src, 'PROVEN_STALE', 'https://otherathletics.com/sports/mens-soccer/coaches'); // stale judged on another school's page
  coach.run('k-other', 'Eve Other', 'eve@other.test', 'Other College', 'https://otherathletics.com/sports/mens-soccer/coaches', null, null);
  db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, source_url, imported_at) VALUES ('Other College','mens-soccer',2025,'Eve Other','https://otherathletics.com/sports/mens-soccer/coaches','t')").run();
  db.pragma('foreign_keys = OFF');
  db.prepare("INSERT INTO outreach (id, athlete_id, coach_id, token, created_at) VALUES ('o-1','p-1','k-back','tok-1','2026-08-27')").run();
  db.pragma('foreign_keys = ON');
  return db;
}

const seal = (fx) => ({ ...fx, fixture_hash: fixtureHash(fx) });
const coachOf = (db, id) => db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
const domOf = (db, d) => db.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(d);
function fixtures(db) {
  const C = seal({ kind: COACH_CURRENTNESS_KIND, phase: 't', created_at: 't', order: 'withhold first; reinstate after B',
    withhold_before_A: [{ action_id: 'C-W-gone', coach_id: 'k-gone', coach: 'Bob Gone', expected_old: { currentness_status: null }, proposed: { currentness_status: 'PROVEN_STALE', currentness_source_url: `https://${HOST}/sports/mens-soccer/coaches`, currentness_reason: 'absent from the 2026 staff page' }, evidence: 'staff page', reason: 'absent' }],
    reinstate_after_B: [{ action_id: 'C-R-back', coach_id: 'k-back', coach: 'Dana Back', expected_old: { currentness_status: 'PROVEN_STALE', school: 'Owner College' }, proposed: { currentness_status: 'CURRENT', currentness_source_url: `https://${HOST}/sports/mens-soccer/coaches`, currentness_reason: 'listed with email on the 2026 staff page' }, evidence: 'staff page', reason: 'stale mark came from another school' }] });
  const B = seal({ kind: COACH_INSTITUTION_KIND, phase: 't', created_at: 't',
    actions: [{ action_id: 'B-moved', coach_id: 'k-moved', coach: 'Carl Moved', expected_old: { school: 'Wrong Label College', division: 'NCAA D3', sport: 'mens-soccer', email: 'carl@owner.test', email_status: 'verified' }, proposed: { school: 'Owner College', division: 'NCAA D3' }, evidence: 'staff page', reason: 'email + source are Owner College' }] });
  const A = seal({ kind: PROTECTED_CORRECTION_KIND, phase: 't', created_at: 't',
    approvals: [{ approval_id: 'AP-A', approved_by: 'reviewer', approved_at: '2026-10-08', basis: 'test', hosts: [HOST] }],
    corrections: [{ action_id: `PC-${HOST}`, approval_id: 'AP-A', host: HOST, true_entity: 'AE-OWN', unitid: OWN,
      transition: { from_status: 'WRONG_INSTITUTION', to_status: 'VERIFIED', from_ownership_class: null, to_ownership_class: 'ENTITY_OWNED' },
      wrong_claimants: [{ key: 'Claimant', claimantUnitid: CLAIM }], expected_old: { ...domOf(db, HOST) },
      evidence: { institution_to_host: 'owner.edu links it', host_to_institution: 'og:site_name Owner College Athletics' },
      original_adjudication: { tool: 'verifyAthleticsDomains.js', timestamp: '2026-09-01', why_wrong: 'one refuted claim became the row status' }, reason: 'reversal', blast_radius: 'one row' }] });
  return { A, B, C };
}
const STAGES = ({ A, B, C }) => [
  { stage_id: 'S1', type: COACH_CURRENTNESS_KIND, group: 'withhold_before_A', fixture: C },
  { stage_id: 'S2', type: COACH_INSTITUTION_KIND, fixture: B },
  { stage_id: 'S3', type: COACH_CURRENTNESS_KIND, group: 'reinstate_after_B', fixture: C },
  { stage_id: 'S4', type: PROTECTED_CORRECTION_KIND, fixture: A },
];
const EXPECTED = { S1: [], S2: [], S3: [], S4: ['k-back', 'k-good', 'k-moved'] };
function approve(db, stages, { eligibility = EXPECTED, over = {} } = {}) {
  const base = measureInProcess(db).eligible_ids;
  const ap = { kind: COMPOSITE_APPROVAL_KIND, approval_id: 'AP-COMPOSITE', approved_by: 'reviewer', approved_at: '2026-10-08', basis: 'test', baseline: { eligible_ids_hash: idSetHash(base) },
    stages: stages.map((s) => ({ stage_id: s.stage_id, type: s.type, group: s.group ?? null, fixture_hash: s.fixture.fixture_hash, eligibility: { added: eligibility[s.stage_id] || [], removed: [] } })), ...over };
  return { ...ap, approval_hash: approvalHash(ap) };
}
/** every row of every table, so "nothing changed" is checked over the whole database */
const snapshot = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())]));
const setup = () => { const db = world(); const fx = fixtures(db); const stages = STAGES(fx); return { db, fx, stages, approval: approve(db, stages) }; };
const run = (db, stages, approval, opts = {}) => runCompositeCorrection(db, stages, approval, { apply: true, now: NOW, ...opts });

describe('composite correction — the world behaves like 8D.3A', () => {
  it('0. baseline: only the control coach is eligible; the domain fix alone would make the leaver eligible too', () => {
    const { db, fx } = setup();
    expect(measureInProcess(db).eligible_ids).toEqual(['k-other']);
    db.exec('BEGIN'); applyProtectedCorrectionsInTransaction(db, fx.A, { now: NOW });
    expect(measureInProcess(db).eligible_ids).toEqual(['k-gone', 'k-good', 'k-moved', 'k-other']); // premature: k-gone
    db.exec('ROLLBACK');
  });
  it('0b. the in-process engine is the CLI engine (same rows the CLI writes to coaches_reconciled)', () => {
    const { db } = setup();
    const rows = reconcileCoachRows(db, { scope: 'NAIA' });
    expect(rows.find((r) => r.coach_id === 'k-other').outreach_eligibility).toBe('YES');
    expect(rows.length).toBe(5);
  });
});

describe('composite correction — atomic apply', () => {
  it('1. all four stages commit together; every stage delta is the approved exact ID set', () => {
    const { db, stages, approval } = setup();
    const r = run(db, stages, approval);
    expect(r.committed).toBe(true);
    expect(r.report.stages.map((s) => [s.stage_id, s.eligibility.added, s.eligibility.removed])).toEqual([['S1', [], []], ['S2', [], []], ['S3', [], []], ['S4', ['k-back', 'k-good', 'k-moved'], []]]);
    expect(measureInProcess(db).eligible_ids).toEqual(['k-back', 'k-good', 'k-moved', 'k-other']);
    expect(coachOf(db, 'k-gone').currentness_status).toBe('PROVEN_STALE');
    expect(coachOf(db, 'k-moved').school).toBe('Owner College');
    expect(coachOf(db, 'k-back')).toMatchObject({ currentness_status: 'CURRENT', currentness_checked_at: NOW });
    expect(coachOf(db, 'k-back').currentness_reason).toMatch(/\[C-R-back, fixture [0-9a-f]{12}\]$/);
    expect(domOf(db, HOST)).toMatchObject({ status: 'VERIFIED', athletics_entity_id: 'AE-OWN', ownership_class: 'ENTITY_OWNED', unitid: OWN });
    expect(r.manifest.manifest.flatMap((m) => m.entries).map((e) => `${e.table}:${Object.values(e.key)[0]}`)).toEqual(['coaches:k-gone', 'coaches:k-moved', 'coaches:k-back', `athletics_domains:${HOST}`]);
  });
  it('2. only the approved columns change; ids are never re-keyed; history keeps pointing at the same coach', () => {
    const { db, stages, approval } = setup();
    const before = snapshot(db);
    run(db, stages, approval);
    const after = snapshot(db);
    expect(Object.keys(before).filter((t) => before[t] !== after[t]).sort()).toEqual(['athletics_domains', 'coaches']);
    expect(db.prepare('SELECT coach_id FROM outreach').get().coach_id).toBe('k-back');
    expect(db.prepare('SELECT id FROM coaches ORDER BY id').all().map((x) => x.id)).toEqual(['k-back', 'k-gone', 'k-good', 'k-moved', 'k-other']);
    const old = JSON.parse(before.coaches); const nu = JSON.parse(after.coaches);
    old.forEach((o, i) => { const changed = Object.keys(o).filter((k) => o[k] !== nu[i][k]); expect(changed.every((k) => ['school', 'division', 'currentness_status', 'currentness_checked_at', 'currentness_source_url', 'currentness_reason'].includes(k))).toBe(true); });
  });
  it('3. rehearsal mode runs every stage and gate, then leaves the database byte-for-byte unchanged', () => {
    const { db, stages, approval } = setup();
    const before = snapshot(db);
    const r = runCompositeCorrection(db, stages, approval, { apply: false, now: NOW });
    expect(r.committed).toBe(false); expect(r.report.final.eligible).toBe(4);
    expect(snapshot(db)).toEqual(before); expect(db.inTransaction).toBe(false);
  });
  it('4. eligibility is measured on the uncommitted state: a second connection sees nothing until COMMIT', () => {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'composite-'));
    const file = path.join(dir, 'w.sqlite'); const mem = world(); mem.exec(`VACUUM INTO '${file}'`);
    const db = new Database(file); db.pragma('journal_mode = WAL'); const fx = fixtures(db); const stages = STAGES(fx); const approval = approve(db, stages);
    const peer = new Database(file, { readonly: true });
    const seen = [];
    run(db, stages, approval, { inject: (p) => { if (p.endsWith(':eligibility') || p === 'final:precommit') seen.push([p, peer.prepare("SELECT school FROM coaches WHERE id='k-moved'").get().school, peer.prepare('SELECT status FROM athletics_domains WHERE domain=?').get(HOST).status]); } });
    expect(seen.every(([, school, status]) => school === 'Wrong Label College' && status === 'WRONG_INSTITUTION')).toBe(true);
    expect(peer.prepare("SELECT school FROM coaches WHERE id='k-moved'").get().school).toBe('Owner College');
    peer.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('composite correction — refusal before any write', () => {
  const refuses = (mutate, re) => { const { db, stages, approval } = setup(); const [s, a] = mutate(stages, approval, db); const before = snapshot(db); expect(() => run(db, s, a)).toThrow(re); expect(snapshot(db)).toEqual(before); };
  it('5. a fixture whose hash does not reproduce', () => refuses((s, a) => { s[1] = { ...s[1], fixture: { ...s[1].fixture, actions: [{ ...s[1].fixture.actions[0], reason: 'edited' }] } }; return [s, a]; }, /refused/));
  it('6. a tampered approval body', () => refuses((s, a) => [s, { ...a, approved_by: 'someone else' }], /refused/));
  it('7. an approval without the exact per-stage ID sets', () => refuses((s, a) => { const b = { ...a, stages: a.stages.map((x) => ({ ...x, eligibility: undefined })) }; return [s, { ...b, approval_hash: approvalHash(b) }]; }, /refused/));
  it('8. stages out of order (domain fix before the withhold)', () => refuses((s, a, db) => { const r = [s[3], s[0], s[1], s[2]]; return [r, approve(db, r)]; }, /refused/));
  it('9. a stage the approval does not authorise (different fixture hash)', () => refuses((s, a, db) => { const fx = fixtures(db); const B2 = seal({ ...fx.B, actions: fx.B.actions.map((x) => ({ ...x, reason: 'other' })) }); const r = [...s]; r[1] = { ...r[1], fixture: B2 }; return [r, a]; }, /refused/));
  it('10. a stale approval (baseline eligible set moved since approval)', () => refuses((s, a, db) => { db.prepare("UPDATE coaches SET email_status='inferred' WHERE id='k-other'").run(); return [s, a]; }, /stale approval/));
  it('11. a connection already inside a transaction', () => { const { db, stages, approval } = setup(); db.exec('BEGIN'); expect(() => run(db, stages, approval)).toThrow(/own its transaction/); db.exec('ROLLBACK'); });
  it('12. validateComposite lists every problem without touching the database', () => {
    const { stages, approval } = setup();
    expect(validateComposite(stages, approval)).toEqual([]);
    expect(validateComposite(stages, { ...approval, kind: 'X' }).join(' ')).toMatch(/approval kind/);
  });
});

describe('composite correction — failure anywhere rolls back everything', () => {
  const POINTS = ['begin', 'stage:S1:action', 'stage:S1:written', 'stage:S1:eligibility', 'stage:S2:begin', 'stage:S2:action', 'stage:S2:written', 'stage:S2:eligibility',
    'stage:S3:action', 'stage:S3:written', 'stage:S3:eligibility', 'stage:S4:begin', 'stage:S4:action', 'stage:S4:written', 'stage:S4:eligibility', 'final:integrity', 'final:precommit'];
  for (const point of POINTS) {
    it(`13. injected failure at ${point}: no coach or domain correction persists`, () => {
      const { db, stages, approval } = setup(); const before = snapshot(db);
      expect(() => run(db, stages, approval, { inject: (p) => { if (p === point) throw new Error(`injected at ${p}`); } })).toThrow(`injected at ${point}`);
      expect(snapshot(db)).toEqual(before); expect(db.inTransaction).toBe(false);
    });
  }
  it('14. expected-old drift at stage 2 rolls back the stage-1 withhold too', () => {
    const { db, stages, approval } = setup(); const before = snapshot(db);
    expect(() => run(db, stages, approval, { inject: (p) => { if (p === 'stage:S2:begin') db.prepare("UPDATE coaches SET email_status='unknown' WHERE id='k-moved'").run(); } })).toThrow(/coach institution correction refused/);
    expect(snapshot(db)).toEqual(before);
  });
  it('15. an unapproved eligibility gain (premature eligibility) refuses the stage and rolls back all', () => {
    const { db, fx } = setup(); const before = snapshot(db);
    const stages = [STAGES(fx)[3]]; // the domain fix alone
    const approval = approve(db, stages, { eligibility: { S4: ['k-back', 'k-good', 'k-moved'] } });
    expect(() => run(db, stages, approval)).toThrow(/eligibility delta is not the approved one/);
    expect(snapshot(db)).toEqual(before);
  });
  it('16. an approved addition that does not happen is also refused (exact sets, not counts)', () => {
    const { db, stages } = setup(); const before = snapshot(db);
    const approval = approve(db, stages, { eligibility: { ...EXPECTED, S4: ['k-back', 'k-good', 'k-gone'] } });
    expect(() => run(db, stages, approval)).toThrow(/eligibility delta/);
    expect(snapshot(db)).toEqual(before);
  });
});

describe('composite correction — revert', () => {
  it('17. one revert restores every table and the baseline eligible set', () => {
    const { db, stages, approval } = setup(); const before = snapshot(db);
    const r = run(db, stages, approval);
    const v = revertComposite(db, r.manifest, { apply: true });
    expect(v.reverted).toBe(4); expect(snapshot(db)).toEqual(before);
  });
  it('18. revert refuses (and changes nothing) if a corrected row was changed by someone else since', () => {
    const { db, stages, approval } = setup();
    const r = run(db, stages, approval);
    db.prepare("UPDATE coaches SET school='Other College' WHERE id='k-moved'").run();
    const mid = snapshot(db);
    expect(() => revertComposite(db, r.manifest, { apply: true })).toThrow(/revert refused/);
    expect(snapshot(db)).toEqual(mid);
  });
  it('19. a failure inside the revert rolls the revert back', () => {
    const { db, stages, approval } = setup();
    const r = run(db, stages, approval); const mid = snapshot(db);
    expect(() => revertComposite(db, r.manifest, { apply: true, inject: () => { throw new Error('boom'); } })).toThrow('boom');
    expect(snapshot(db)).toEqual(mid);
  });
});

describe('coach correction operations', () => {
  it('20. reinstatement needs the coach\'s OWN institution\'s page (the Southwestern KS/TX error)', () => {
    const { db, fx } = setup();
    const C = seal({ ...fx.C, reinstate_after_B: [{ ...fx.C.reinstate_after_B[0], proposed: { ...fx.C.reinstate_after_B[0].proposed, currentness_source_url: 'https://otherathletics.com/sports/mens-soccer/coaches' } }] });
    expect(planCoachCurrentness(db, C, 'reinstate_after_B').problems.join(' ')).toMatch(/does not self-identify as Owner College/);
  });
  it('21. a withhold may not set CURRENT, and a coach may not be in both groups', () => {
    const { db, fx } = setup();
    const bad = seal({ ...fx.C, withhold_before_A: [{ ...fx.C.withhold_before_A[0], proposed: { ...fx.C.withhold_before_A[0].proposed, currentness_status: 'CURRENT' } }] });
    expect(planCoachCurrentness(db, bad, 'withhold_before_A').problems.join(' ')).toMatch(/may only set PROVEN_STALE/);
    const both = seal({ ...fx.C, reinstate_after_B: [...fx.C.reinstate_after_B, { ...fx.C.reinstate_after_B[0], action_id: 'x', coach_id: 'k-gone', coach: 'Bob Gone' }] });
    expect(planCoachCurrentness(db, both, 'withhold_before_A').problems.join(' ')).toMatch(/both currentness groups/);
  });
  it('22. a relabel refuses inactive targets, non-institution fields, duplicates and identity drift', () => {
    const { db, fx } = setup(); const a = fx.B.actions[0];
    const p = (act) => planCoachInstitution(db, seal({ ...fx.B, actions: [act] })).problems.join(' ');
    expect(p({ ...a, proposed: { school: 'Retired College' } })).toMatch(/not active/);
    expect(p({ ...a, proposed: { school: 'Owner College', email: 'x@y.test' } })).toMatch(/non-institution field/);
    expect(p({ ...a, expected_old: { school: 'Wrong Label College' } })).toMatch(/must pin/);
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, sport, email_status) VALUES ('dup','t','Carl Moved','carl@owner.test','Owner College','mens-soccer','verified')").run();
    expect(p(a)).toMatch(/duplicate, not a relabel/);
  });
  it('23. the transaction-compatible operations refuse to run outside a caller-owned transaction', () => {
    const { db, fx } = setup();
    expect(() => applyCoachInstitutionInTransaction(db, fx.B)).toThrow(/caller-owned/);
    expect(() => applyProtectedCorrectionsInTransaction(db, fx.A)).toThrow(/caller-owned/);
  });
});
