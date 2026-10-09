import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../db/migrate.js';
import { classifyEmailPublication, qualifyingAbsence, EMAIL_PUBLICATION, ABSENCE_REASON } from './emailPublication.js';
import { reconcileCoachRows } from './coachReconciler.js';
import { measureInProcess } from './refresh/integrityMeasure.js';
import { fixtureHash } from './refresh/protectedCorrection.js';
import { COACH_EMAIL_ABSENCE_KIND, planCoachEmailAbsence } from './refresh/coachCorrection.js';
import { runCompositeCorrection as runComposite, revertComposite, approvalHash, idSetHash, COMPOSITE_APPROVAL_KIND } from './refresh/compositeCorrection.js';
import { approvalFields, holdsFile } from './refresh/correctionTestKit.js';

/**
 * PHASE 8D.3D — positive email absence. The definition (classifyEmailPublication), its only effect
 * (the reconciler withholds a coach with a qualifying recorded observation), and the guarded writer.
 * Institutions, people and addresses are invented; addresses use the reserved .test TLD.
 */
const { UNKNOWN, COACH_PUBLISHED, PAGE_PUBLISHED, POSITIVELY_ABSENT } = EMAIL_PUBLICATION;
const SHA = 'a'.repeat(64);
const FETCHED = '2026-10-07T23:52:41.664Z'; // cycle 2026
const OWN = 142001; const OTHER = 320001;
const SRC = 'https://ownerathletics.test/sports/womens-soccer/coaches';
const coach = (over = {}) => ({ id: 'k-ab', full_name: 'Abby Example', email: 'ab1@owner.test', sport: 'womens-soccer', email_seen_on_source_at: null, email_seen_on_source_url: null, ...over });
const prog = { unitid: OWN, sport: 'womens-soccer' };
const page = (over = {}) => ({ page: { source_url: SRC, fetched_at: FETCHED, observed_season: 2026, sport: 'womens-soccer', source_complete: true, parser_version: 'sidearm-staff-2', structure: 'STAFF_TABLE',
  adapter_evidence: { sha256: SHA, title: "2026 Women's Soccer Coaches - Owner College Athletics" },
  people: [{ full_name: 'Abby Example', role: 'Assistant Coach', email: 'ab1-sw@owner.test' }, { full_name: 'Head Person', role: 'Head Coach', email: 'hp@owner.test' }], ...over } });
const classify = (o = {}) => classifyEmailPublication({ coach: coach(o.coach), programme: o.programme ?? prog, read: o.read === undefined ? page(o.page) : o.read, hostUnitid: 'hostUnitid' in o ? o.hostUnitid : OWN });

describe('the definition — classifyEmailPublication', () => {
  it('1. confirmed absence: complete, versioned, hashed, own institution and sport, coach named, address absent', () => {
    const r = classify();
    expect(r.status).toBe(POSITIVELY_ABSENT);
    expect(r.observation).toMatchObject({ coach_id: 'k-ab', email: 'ab1@owner.test', page_unitid: OWN, page_season: 2026, parser_version: 'sidearm-staff-2', evidence_sha256: SHA, staff_records: 2, emails_published: 2, other_email_for_coach: 'ab1-sw@owner.test' });
    expect(r.observation.observation_id).toMatch(/^[0-9a-f]{64}$/);
  });
  it('2. COACH_PUBLISHED only when the address is printed against this coach; elsewhere it is PAGE_PUBLISHED', () => {
    expect(classify({ page: { people: [{ full_name: 'Abby Example', email: 'AB1@owner.test' }] } }).status).toBe(COACH_PUBLISHED);
    expect(classify({ page: { people: [{ full_name: 'Abby Example', email: null }, { full_name: 'Head Person', email: 'ab1@owner.test' }] } })).toMatchObject({ status: PAGE_PUBLISHED, reasons: [expect.stringMatching(/another person \(Head Person\)/)] });
  });
  it('2b. PAGE_PUBLISHED blocks absence but proves nothing: footer, department label row, shared inbox, ambiguous name', () => {
    const named = [{ full_name: 'Abby Example', email: 'ab1-sw@owner.test' }, { full_name: 'Head Person', email: 'hp@owner.test' }];
    // footer / contact block: only in emails_on_page
    expect(classify({ page: { people: named, emails_on_page: ['ab1@owner.test', 'hp@owner.test'] } })).toMatchObject({ status: PAGE_PUBLISHED, reasons: [expect.stringMatching(/footer or contact block/)] });
    // department / programme inbox in a label row
    expect(classify({ page: { people: named, labels: [{ label: 'Recruiting Inquiries', emails: ['ab1@owner.test'] }] } })).toMatchObject({ status: PAGE_PUBLISHED, reasons: [expect.stringMatching(/label row/)] });
    // a shared inbox printed against the coach AND another person is not her personal address
    const shared = { people: [{ full_name: 'Abby Example', email: null }, { full_name: 'Head Person', email: null }],
      person_emails: [{ full_name: 'Abby Example', emails: ['ab1@owner.test'], shared_emails: ['ab1@owner.test'] }, { full_name: 'Head Person', emails: ['ab1@owner.test'], shared_emails: ['ab1@owner.test'] }] };
    expect(classify({ page: shared })).toMatchObject({ status: PAGE_PUBLISHED, reasons: [expect.stringMatching(/shared inbox/)] });
    // the coach's name on two people: association unproven
    const twice = { people: [{ full_name: 'Abby Example', email: 'ab1@owner.test' }, { full_name: 'Abby  Example', email: null }, { full_name: 'Head Person', email: 'hp@owner.test' }] };
    expect(classify({ page: twice })).toMatchObject({ status: PAGE_PUBLISHED, reasons: [expect.stringMatching(/more than one person/)] });
    // none of these is ever a positive absence
    for (const pg of [{ people: named, emails_on_page: ['ab1@owner.test'] }, shared, twice]) expect(classify({ page: pg }).observation).toBeUndefined();
  });
  it('3. an inaccessible or refused page is UNKNOWN, never absence', () => {
    expect(classify({ read: null }).status).toBe(UNKNOWN);
    expect(classify({ read: { refusal: { code: 'HTTP_403' } } })).toMatchObject({ status: UNKNOWN, reasons: [expect.stringMatching(/HTTP_403/)] });
  });
  it('4. incomplete parsing: zero records, an incomplete list, or missing provenance is UNKNOWN', () => {
    expect(classify({ read: { refusal: { code: 'PARSER_RETURNED_ZERO_RECORDS' } } }).status).toBe(UNKNOWN);
    expect(classify({ page: { people: [] } }).status).toBe(UNKNOWN);
    expect(classify({ page: { source_complete: false } }).status).toBe(UNKNOWN);
    expect(classify({ page: { parser_version: null } }).status).toBe(UNKNOWN);
    expect(classify({ page: { adapter_evidence: { sha256: 'short' } } }).status).toBe(UNKNOWN);
    expect(classify({ page: { source_url: 'http://ownerathletics.test/x' } }).status).toBe(UNKNOWN);
  });
  it('5. conflicting official evidence: the address observed published this cycle (or later) is UNKNOWN', () => {
    expect(classify({ coach: { email_seen_on_source_at: '2026-09-01T00:00:00Z', email_seen_on_source_url: SRC } }).status).toBe(UNKNOWN);
    expect(classify({ coach: { email_seen_on_source_at: '2025-09-01T00:00:00Z', email_seen_on_source_url: SRC } }).status).toBe(POSITIVELY_ABSENT); // last cycle: not current
  });
  it('6. wrong institution: the host identifies as another institution, or the coach is filed elsewhere', () => {
    expect(classify({ hostUnitid: OTHER }).status).toBe(UNKNOWN);
    expect(classify({ programme: { unitid: OTHER } }).status).toBe(UNKNOWN);
    expect(classify({ hostUnitid: null }).status).toBe(UNKNOWN);
  });
  it('7. wrong sport is UNKNOWN', () => {
    expect(classify({ page: { sport: 'mens-soccer' } }).status).toBe(UNKNOWN);
  });
  it('8. historical versus current: a page for another season, or titled for one, is UNKNOWN', () => {
    expect(classify({ page: { observed_season: 2025 } }).status).toBe(UNKNOWN);
    expect(classify({ page: { adapter_evidence: { sha256: SHA, title: '2024 Women\'s Soccer Coaches' } } }).status).toBe(UNKNOWN);
    expect(classify({ page: { adapter_evidence: { sha256: SHA, title: 'Women\'s Soccer Coaches' } } }).status).toBe(POSITIVELY_ABSENT);
  });
  it('8b. structure: a bio PROFILE can show publication but never absence; an unrecorded structure is not a list', () => {
    expect(classify({ page: { structure: 'PROFILE', source_complete: false, people: [{ full_name: 'Abby Example', email: 'ab1@owner.test' }] } }).status).toBe(COACH_PUBLISHED);
    expect(classify({ page: { structure: 'PROFILE', source_complete: false, people: [{ full_name: 'Abby Example', email: 'ab1-sw@owner.test' }] } }).status).toBe(UNKNOWN);
    expect(classify({ page: { structure: undefined } }).status).toBe(UNKNOWN);
    expect(classify({ page: { emails_on_page: ['ab1@owner.test'] } }).status).toBe(PAGE_PUBLISHED); // printed elsewhere on the page: not absent, not proof
  });
  it('9. identity: the coach not named, or named twice, is UNKNOWN; a page publishing no addresses says nothing', () => {
    expect(classify({ page: { people: [{ full_name: 'Head Person', email: 'hp@owner.test' }] } }).status).toBe(UNKNOWN);
    expect(classify({ page: { people: [{ full_name: 'Abby Example', email: null }, { full_name: 'Abby  Example', email: null }, { full_name: 'H', email: 'h@owner.test' }] } }).status).toBe(UNKNOWN);
    expect(classify({ page: { people: [{ full_name: 'Abby Example', email: null }, { full_name: 'Head Person', email: null }] } }).status).toBe(UNKNOWN);
  });
});

// ---------------------------------------------------------------------------- reconciler + writer world
const SCHEMA = fs.readFileSync(path.resolve(import.meta.dirname, '../db/schema.sql'), 'utf8');
const HOST = 'ownerathletics.test';
function world() {
  const db = new Database(':memory:'); db.exec(SCHEMA); migrate(db);
  const ent = db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?,?,?,'SINGLE','t','t')");
  ent.run('AE-OWN', 'Owner College', OWN); ent.run('AE-OTHER', 'Other College', OTHER);
  const col = db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?,'t','t',?,?,'NCAA D1',1,?,?)");
  col.run('c-own', 'Owner College', 'womens-soccer', OWN, 'AE-OWN'); col.run('c-other', 'Other College', 'womens-soccer', OTHER, 'AE-OTHER');
  const dom = db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?,?,'VERIFIED','ATHLETICS_SITE','[]','[]','PAGE_SELF_IDENTIFICATION','CERTAIN','t')");
  dom.run(HOST, OWN); dom.run('otherathletics.test', OTHER);
  db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, source_url, imported_at) VALUES ('Owner College','womens-soccer',2025,'Someone',?,'t')").run(SRC);
  db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, source_url, imported_at) VALUES ('Other College','womens-soccer',2025,'Someone','https://otherathletics.test/sports/womens-soccer/coaches','t')").run();
  const k = db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url) VALUES (?,'t',?,?,?,'NCAA D1','womens-soccer','Assistant Coach','verified',?)");
  k.run('k-ab', 'Abby Example', 'ab1@owner.test', 'Owner College', SRC);
  k.run('k-cd', 'Cody Example', 'cd1@owner.test', 'Owner College', SRC);
  k.run('k-ot', 'Otto Example', 'ot1@other.test', 'Other College', 'https://otherathletics.test/sports/womens-soccer/coaches');
  return db;
}
const seal = (fx) => ({ ...fx, fixture_hash: fixtureHash(fx) });
const absenceFixture = (obs, over = {}) => seal({ kind: COACH_EMAIL_ABSENCE_KIND, phase: 't', created_at: 't',
  actions: [{ action_id: 'D-ab', coach_id: 'k-ab', coach: 'Abby Example', expected_old: { email: 'ab1@owner.test', school: 'Owner College', sport: 'womens-soccer' }, observation: obs, evidence: SRC, reason: 'address not published', ...over }] });
const obsFor = (o = {}) => classify(o).observation;
const elig = (db) => reconcileCoachRows(db).filter((r) => r.outreach_eligibility === 'YES').map((r) => r.coach_id).sort();
const snapshot = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())]));
const stage = (fx) => [{ stage_id: 'S0-absence', type: COACH_EMAIL_ABSENCE_KIND, fixture: fx }];
// DI-03D: approvals name an allow-listed reviewer, expire, and list the exact newly sendable coaches (none: an
// absence only removes); every run names its disposable holds file and a fixed time
const APPROVED_AT = '2026-10-08T00:00:00Z';
const HOLDS = holdsFile([]);
const runCompositeCorrection = (db, stages, approval, opts = {}) => runComposite(db, stages, approval, { now: APPROVED_AT, activationHoldsFile: HOLDS.file, ...opts });
function approve(db, stages, removed) {
  const ap = { kind: COMPOSITE_APPROVAL_KIND, approval_id: 'AP-D', ...approvalFields(APPROVED_AT), basis: 'test', baseline: { eligible_ids_hash: idSetHash(measureInProcess(db).eligible_ids) },
    sendability: { newly_sendable_coaches: [], newly_sendable_contacts: [], activation_holds_sha256: HOLDS.sha256 },
    stages: stages.map((s) => ({ stage_id: s.stage_id, type: s.type, group: null, fixture_hash: s.fixture.fixture_hash, eligibility: { added: [], removed } })) };
  return { ...ap, approval_hash: approvalHash(ap) };
}

describe('the reconciler — the only effect of a recorded absence', () => {
  it('10. existing eligible coaches: no table rows, no change (the safeguard is inert by default)', () => {
    const db = world();
    expect(elig(db)).toEqual(['k-ab', 'k-cd', 'k-ot']);
    db.exec('DROP TABLE coach_email_absence_observations');
    expect(elig(db)).toEqual(['k-ab', 'k-cd', 'k-ot']); // a database without the table behaves exactly as before
  });
  it('11. a qualifying observation withholds that coach and nobody else, with its own reason', () => {
    const db = world(); const r = runCompositeCorrection(db, stage(absenceFixture(obsFor())), approve(db, stage(absenceFixture(obsFor())), ['k-ab']), { apply: true, now: '2026-10-08T00:00:00Z' });
    expect(r.report.stages[0].eligibility.removed).toEqual(['k-ab']);
    expect(elig(db)).toEqual(['k-cd', 'k-ot']);
    expect(reconcileCoachRows(db).find((x) => x.coach_id === 'k-ab').ineligible_reason).toBe(ABSENCE_REASON);
  });
  it('12. later official publication of the same address supersedes the absence with no edit to the observation', () => {
    const db = world(); runCompositeCorrection(db, stage(absenceFixture(obsFor())), approve(db, stage(absenceFixture(obsFor())), ['k-ab']), { apply: true, now: '2026-10-08T00:00:00Z' });
    db.prepare("UPDATE coaches SET email_seen_on_source_at='2026-11-01T00:00:00Z', email_seen_on_source_url=? WHERE id='k-ab'").run(SRC);
    expect(elig(db)).toEqual(['k-ab', 'k-cd', 'k-ot']);
  });
  it('13. an observation stops applying when the coach\'s address or filing changes (wrong institution / old address)', () => {
    const db = world(); runCompositeCorrection(db, stage(absenceFixture(obsFor())), approve(db, stage(absenceFixture(obsFor())), ['k-ab']), { apply: true, now: '2026-10-08T00:00:00Z' });
    const rows = db.prepare('SELECT * FROM coach_email_absence_observations').all();
    expect(qualifyingAbsence(rows, { ...coach(), email: 'new@owner.test' }, prog)).toBeNull();
    expect(qualifyingAbsence(rows, coach(), { unitid: OTHER })).toBeNull();
    expect(qualifyingAbsence(rows, { ...coach(), sport: 'mens-soccer' }, prog)).toBeNull();
    expect(qualifyingAbsence(rows, coach(), prog)).not.toBeNull();
  });
});

describe('the writer — COACH_EMAIL_ABSENCE through the composite correction', () => {
  const problems = (db, fx) => planCoachEmailAbsence(db, fx).problems.join(' | ');
  it('14. refuses anything short of the definition, re-checked against the database', () => {
    const db = world();
    expect(problems(db, absenceFixture(obsFor()))).toBe('');
    expect(problems(db, absenceFixture({ ...obsFor(), parse_status: 'PARTIAL' }))).toMatch(/observation_id does not reproduce|not a positive absence/);
    expect(problems(db, absenceFixture({ ...obsFor(), page_unitid: OTHER }))).toMatch(/observation_id|wrong institution/);
    expect(problems(db, absenceFixture(obsFor({ page: { sport: 'womens-soccer' } }), { coach_id: 'k-ot', coach: 'Otto Example' }))).toMatch(/another coach/);
    db.prepare("UPDATE coaches SET email_seen_on_source_at='2026-09-01T00:00:00Z', email_seen_on_source_url=? WHERE id='k-ab'").run(SRC);
    expect(problems(db, absenceFixture(obsFor()))).toMatch(/conflicting official evidence/);
  });
  it('15. refuses a host that does not identify as the coach\'s institution, and a missing table', () => {
    const db = world(); db.prepare("UPDATE athletics_domains SET unitid=? WHERE domain=?").run(OTHER, HOST);
    expect(problems(db, absenceFixture(obsFor()))).toMatch(/does not self-identify/);
    const db2 = world(); db2.exec('DROP TABLE coach_email_absence_observations');
    expect(problems(db2, absenceFixture(obsFor()))).toMatch(/does not exist/);
  });
  it('16. the observation is append-only, and the composite revert removes exactly what it recorded', () => {
    const db = world(); const before = snapshot(db);
    const st = stage(absenceFixture(obsFor()));
    const r = runCompositeCorrection(db, st, approve(db, st, ['k-ab']), { apply: true, now: '2026-10-08T00:00:00Z' });
    expect(() => db.prepare("UPDATE coach_email_absence_observations SET email='x@owner.test'").run()).toThrow(/append-only/);
    const after = snapshot(db);
    expect(Object.keys(before).filter((t) => before[t] !== after[t])).toEqual(['coach_email_absence_observations']); // coaches untouched; programme / outreach tables untouched
    revertComposite(db, r.manifest, { apply: true });
    expect(snapshot(db)).toEqual(before);
  });
  it('17. an approval that does not name the removal is refused and nothing persists', () => {
    const db = world(); const before = snapshot(db); const st = stage(absenceFixture(obsFor()));
    expect(() => runCompositeCorrection(db, st, approve(db, st, []), { apply: true })).toThrow(/eligibility delta/);
    expect(snapshot(db)).toEqual(before);
  });
  it('18. programme-contact isolation: programme and outreach tables are byte-identical across apply and revert', () => {
    const db = world(); const pt = (s) => Object.fromEntries(Object.entries(s).filter(([t]) => /^programme_|^outreach|^tracking|^engagement|^suppress/.test(t)));
    const before = pt(snapshot(db)); const st = stage(absenceFixture(obsFor()));
    const r = runCompositeCorrection(db, st, approve(db, st, ['k-ab']), { apply: true });
    expect(pt(snapshot(db))).toEqual(before);
    revertComposite(db, r.manifest, { apply: true });
    expect(pt(snapshot(db))).toEqual(before);
    expect(Object.keys(before).length).toBeGreaterThan(5);
  });
});
