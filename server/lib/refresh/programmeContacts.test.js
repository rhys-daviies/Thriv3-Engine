import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld, W, PEOPLE } from './regressionWorld.js';
import { stageRefresh, writeStagedBatch } from './staging.js';
import { planPromotion, applyPromotion, revertManifest } from './promotion.js';
import { evaluateGates, planFootprint } from './integrityGate.js';
import { measureProgrammeContacts } from './integrityMeasure.js';
import { buildDiffReport } from './diffReport.js';
import { cycleOf } from './freshness.js';
import { coachIneligibility } from '../coachEligibility.js';
import { buildProgrammeContactContext, programmeContactProblems, programmeContactId, sexSignalOfAddress, isDepartmentInbox, PC_INELIGIBLE } from '../programmeContactEligibility.js';
import { programmeContactsForCollege } from '../programmeContacts.js';
import { validateProgrammeContacts } from '../../scripts/validateProgrammeContacts.js';
import { buildLeadQueue } from '../../scripts/programmeContactLeads.js';
import { runMonitor } from '../../scripts/integrityMonitor.js';

/**
 * PHASE 1B — programme contacts through the Phase 7E integrity pipeline, on the regression world.
 *
 * A programme contact is a communication endpoint the programme publishes, never a person. These
 * tests pin that it enters canonical data only through staging -> promotion, only on an official
 * owned page of the right programme and sport, only when its own mail domain is owned by that
 * programme's entity, never when a named coach holds the address — and that none of this moves a
 * single coach, outreach row or coach-eligibility answer.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const NOW = new Date('2027-08-21T00:00:00.000Z');
const ENT = 'AE-U900101';
const INBOX = 'msoccer@concordiatx.edu.example';
let dir; let dbPath;

/** Every table a programme-contact batch must leave untouched, hashed in key order. */
const UNTOUCHED = ['colleges', 'coaches', 'roster_players', 'athletics_domains', 'athletics_entities', 'institution_aliases', 'programme_membership_periods',
  'coach_seasons', 'outreach', 'outreach_send', 'programme_contact_attempts', 'programme_messages', 'campaign_first_touch_approvals', 'suppressions', 'engagement_rollup'];
const hashOf = (db, tables) => crypto.createHash('sha256').update(tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).raw().all())).join('|')).digest('hex');
const contactPage = (over = {}) => ({ dataset: 'PROGRAMME_CONTACT', source_kind: 'OFFICIAL_STAFF_DIRECTORY', source_url: 'https://concordiatx.example/sports/mens-soccer/coaches',
  fetched_at: '2027-08-20T00:00:00.000Z', observed_season: 2027, parser_version: 'test-1', institution_label: 'Concordia University Texas', sport: 'mens-soccer', contacts: [], ...over });
const pub = (email, extra = {}) => ({ email, email_origin: 'PUBLISHED_ON_SOURCE', ...extra });
const input = (pages, extra = {}) => ({ season: 2027, scope: 'NAIA', parser_version: 'test-1', gathered_at: '2027-08-20T00:00:00Z', pages, ...extra });
const stage = (db, pages, now = NOW) => stageRefresh(db, input(pages), { now });
const promote = (db, staged) => { const plan = planPromotion(staged); return { plan, res: applyPromotion(db, plan, { batchHash: staged.batch.batch_hash, record: false }) }; };
const only = (staged) => { expect(staged.observations).toHaveLength(1); return staged.observations[0]; };
const why = (o) => JSON.parse(o.evidence_json || '{}').why || [];

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-pc-')); dbPath = path.join(dir, 'w.sqlite'); buildRegressionWorld(dbPath); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('classification: what a programme-contact page may establish', () => {
  it('a team inbox published on the programme\'s own official page is a NEW_RECORD with a registry-derived label', () => {
    const db = new Database(dbPath);
    const o = only(stage(db, [contactPage({ contacts: [pub(INBOX)] })]));
    expect(o.classification).toBe('NEW_RECORD');
    expect(o.proposed_action).toBe('CREATE_PROGRAMME_CONTACT');
    const p = JSON.parse(o.proposed_json);
    expect(p).toMatchObject({ contact_id: programmeContactId(ENT, 'mens-soccer', INBOX), athletics_entity_id: ENT, college_id: W.CTX, sport: 'mens-soccer', email: INBOX,
      label: "Concordia University Texas Men's Soccer", contact_role: 'TEAM_INBOX', status: 'VERIFIED', source_tier: 'A', observed_on_url: contactPage().source_url, observed_at: '2027-08-20T00:00:00.000Z' });
    expect(o.target_key).toBe(p.contact_id);
    expect(o.target_key).not.toContain('@');
    db.close();
  });

  it('a recruiting inbox is labelled RECRUITING_INBOX; the same address twice on a page is one observation', () => {
    const db = new Database(dbPath);
    const s = stage(db, [contactPage({ contacts: [pub('soccerrecruiting@concordiatx.edu.example'), pub('soccerrecruiting@concordiatx.edu.example')] })]);
    expect(JSON.parse(only(s).proposed_json).contact_role).toBe('RECRUITING_INBOX');
    db.close();
  });

  it('staging writes the staging tables only — no canonical table, no coach, no outreach row moves', () => {
    const db = new Database(dbPath); const before = hashOf(db, [...UNTOUCHED, 'programme_contacts']);
    writeStagedBatch(db, stage(db, [contactPage({ contacts: [pub(INBOX)] })]));
    expect(hashOf(db, [...UNTOUCHED, 'programme_contacts'])).toBe(before);
    expect(db.prepare("SELECT COUNT(*) n FROM refresh_observations WHERE dataset='PROGRAMME_CONTACT'").get().n).toBe(1);
    db.close();
  });

  it('only an address PUBLISHED on the page is ever staged', () => {
    const db = new Database(dbPath);
    const o = only(stage(db, [contactPage({ contacts: [{ email: INBOX, email_origin: 'INFERRED' }] })]));
    expect(o.classification).toBe('SOURCE_UNTRUSTED'); expect(o.proposed_action).toBeNull();
    db.close();
  });

  it('a NAMED COACH\'s address can never become a programme inbox — on the page or in the registry', () => {
    const db = new Database(dbPath);
    const attached = only(stage(db, [contactPage({ contacts: [pub(INBOX, { attached_to_person: 'Pat Headcoach' })] })]));
    expect(attached.classification).toBe('CONTRADICTION'); expect(attached.proposed_action).toBeNull();
    const held = only(stage(db, [contactPage({ contacts: [pub(PEOPLE.HEAD.email)] })]));
    expect(held.classification).toBe('CONTRADICTION'); expect(why(held)).toContain(PC_INELIGIBLE.NAMED_PERSON_ADDRESS);
    // a coach row of ANY status counts: an unverified named row holding a team address (the BC case) blocks it
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status) VALUES ('k-bc', '2026-01-01', 'Bo Named', ?, 'Concordia University Texas', 'NAIA', 'mens-soccer', 'Head Coach', 'unknown')").run(INBOX);
    expect(why(only(stage(db, [contactPage({ contacts: [pub(INBOX)] })])))).toContain(PC_INELIGIBLE.NAMED_PERSON_ADDRESS);
    db.close();
  });

  it('wrong sport fails closed: a women\'s page staged as men\'s, a women\'s address on a men\'s page, and an unproven sport', () => {
    const db = new Database(dbPath);
    expect(only(stage(db, [contactPage({ source_url: 'https://concordiatx.example/sports/womens-soccer/coaches', contacts: [pub(INBOX)] })])).classification).toBe('CONTRADICTION');
    const sex = only(stage(db, [contactPage({ contacts: [pub('wsoccer@concordiatx.edu.example')] })]));
    expect(sex.classification).toBe('CONTRADICTION'); expect(why(sex)).toContain(PC_INELIGIBLE.SEX_CONFLICT);
    const unproven = only(stage(db, [contactPage({ source_url: 'https://concordiatx.example/staff-directory', contacts: [pub(INBOX)] })]));
    expect(unproven.classification).toBe('SOURCE_UNTRUSTED'); expect(unproven.proposed_action).toBeNull();
    // the page TITLE can prove the sport when the URL does not
    expect(only(stage(db, [contactPage({ source_url: 'https://concordiatx.example/staff-directory', page_title: "Men's Soccer Coaching Staff", contacts: [pub(INBOX)] })])).classification).toBe('NEW_RECORD');
    db.close();
  });

  it('wrong programme fails closed: another institution\'s host, another institution\'s mail domain, an unowned domain', () => {
    const db = new Database(dbPath);
    const host = only(stage(db, [contactPage({ source_url: 'https://texassports.example/sports/mens-soccer/coaches', contacts: [pub(INBOX)] })]));
    expect(host.proposed_action).toBeNull(); expect(host.classification).not.toBe('NEW_RECORD');
    const other = only(stage(db, [contactPage({ contacts: [pub('msoccer@texassports.example')] })]));
    expect(other.classification).toBe('CONTRADICTION'); expect(why(other)).toContain(PC_INELIGIBLE.ADDRESS_DOMAIN_OTHER_ENTITY);
    const unowned = only(stage(db, [contactPage({ contacts: [pub('ctxsoccer@gmail.example')] })]));
    expect(unowned.classification).toBe('SOURCE_UNTRUSTED'); expect(why(unowned)).toContain(PC_INELIGIBLE.ADDRESS_DOMAIN_NOT_OWNED);
    db.close();
  });

  it('a branch campus cannot be proven by its parent\'s shared institutional domain', () => {
    const db = new Database(dbPath);
    const o = only(stage(db, [contactPage({ institution_label: 'Indiana University Columbus', source_url: 'https://crimsonpride.example/sports/mens-soccer/coaches', contacts: [pub('soccer@iu.example')] })]));
    expect(o.classification).toBe('IDENTITY_AMBIGUOUS'); expect(why(o)).toContain(PC_INELIGIBLE.ADDRESS_DOMAIN_PARENT_ONLY);
    // its OWN host is proof
    expect(only(stage(db, [contactPage({ institution_label: 'Indiana University Columbus', source_url: 'https://crimsonpride.example/sports/mens-soccer/coaches', contacts: [pub('msoccer@crimsonpride.example')] })])).classification).toBe('NEW_RECORD');
    db.close();
  });

  it('insufficient source authority fails closed: prior season, Wayback, discovery-only kinds, no fetch time, a department inbox', () => {
    const db = new Database(dbPath);
    const notNew = (pages) => { const o = only(stage(db, pages)); expect(o.proposed_action).toBeNull(); return o; };
    notNew([contactPage({ observed_season: 2026, page_season: 2026, contacts: [pub(INBOX)] })]);
    notNew([contactPage({ source_url: 'https://web.archive.org/web/2027/https://concordiatx.example/sports/mens-soccer/coaches', contacts: [pub(INBOX)] })]);
    notNew([contactPage({ source_kind: 'SEARCH_RESULT', contacts: [pub(INBOX)] })]);
    notNew([contactPage({ source_kind: 'OFFICIAL_ROSTER', contacts: [pub(INBOX)] })]);
    notNew([contactPage({ fetched_at: null, contacts: [pub(INBOX)] })]);
    expect(why(notNew([contactPage({ contacts: [pub('athletics@concordiatx.edu.example')] })]))).toContain(PC_INELIGIBLE.DEPARTMENT_INBOX);
    db.close();
  });

  it('is deterministic: the same input stages the same batch, ids and hash', () => {
    const db = new Database(dbPath);
    const a = stage(db, [contactPage({ contacts: [pub(INBOX), pub('soccerrecruiting@concordiatx.edu.example')] })]);
    const b = stage(db, [contactPage({ contacts: [pub(INBOX), pub('soccerrecruiting@concordiatx.edu.example')] })]);
    expect(b.batch.batch_hash).toBe(a.batch.batch_hash);
    expect(b.observations.map((o) => o.observation_id)).toEqual(a.observations.map((o) => o.observation_id));
    db.close();
  });
});

describe('promotion: the only writer', () => {
  it('creates the contact, touches nothing else, is idempotent and reverts exactly', () => {
    const db = new Database(dbPath); const before = hashOf(db, UNTOUCHED);
    const staged = stage(db, [contactPage({ contacts: [pub(INBOX)] })]);
    const { plan, res } = promote(db, staged);
    expect(res.applied).toBe(1);
    const row = db.prepare('SELECT * FROM programme_contacts').get();
    expect(row).toMatchObject({ email: INBOX, status: 'VERIFIED', athletics_entity_id: ENT, college_id: W.CTX, provenance: `refresh-observation:${plan.ops[0].observation_id}` });
    expect(hashOf(db, UNTOUCHED)).toBe(before);
    expect(applyPromotion(db, plan, { record: false }).noop).toBe(1);
    revertManifest(db, res.manifest);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_contacts').get().n).toBe(0);
    expect(hashOf(db, UNTOUCHED)).toBe(before);
    db.close();
  });

  it('a named coach acquiring the address between staging and promotion rolls the batch back', () => {
    const db = new Database(dbPath);
    const staged = stage(db, [contactPage({ contacts: [pub(INBOX)] })]);
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, sport, email_status) VALUES ('k-late', '2027-08-20', 'Late Person', ?, 'Concordia University Texas', 'mens-soccer', 'verified')").run(INBOX);
    expect(() => promote(db, staged)).toThrow(/named coach/);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_contacts').get().n).toBe(0);
    db.close();
  });

  it('a later observation only refreshes evidence; absence from a complete page is investigated, never deleted', () => {
    const db = new Database(dbPath);
    promote(db, stage(db, [contactPage({ contacts: [pub(INBOX)] })]));
    const again = only(stage(db, [contactPage({ fetched_at: '2027-09-15T00:00:00.000Z', contacts: [pub(INBOX)] })], new Date('2027-09-16T00:00:00Z')));
    expect(again.classification).toBe('CONFIRMED_UNCHANGED'); expect(again.proposed_action).toBe('REFRESH_PROGRAMME_CONTACT');
    promote(db, { batch: { batch_id: 'b2' }, observations: [again] });
    const row = db.prepare('SELECT * FROM programme_contacts').get();
    expect(row.observed_at).toBe('2027-09-15T00:00:00.000Z'); expect(row.email).toBe(INBOX);
    const gone = only(stage(db, [contactPage({ source_complete: true, contacts: [] })]));
    expect(gone.classification).toBe('DISAPPEARED_FROM_SOURCE');
    expect(planPromotion({ batch: { batch_id: 'b3' }, observations: [gone] }).ops).toHaveLength(0);
    db.close();
  });
});

describe('gates G13 / G14', () => {
  const measureOf = (p) => { const d = new Database(p, { readonly: true }); const m = measureProgrammeContacts(d.prepare('SELECT * FROM programme_contacts').all()); d.close(); return m; };
  const shell = (pc) => ({ universe: {}, membership: {}, eligible_ids: [], eligible_detail: {}, canon: {}, integrity: { source_domain_conflicts: 0, wrong_institution_eligible: 0, wrong_sport_eligible: 0, stale_eligible: 0, inferred_eligible: 0 }, programme_contacts: pc });
  it('a planned, valid contact passes; an unplanned or invalid one fails', () => {
    const db = new Database(dbPath);
    const pre = shell(measureOf(dbPath));
    const staged = stage(db, [contactPage({ contacts: [pub(INBOX)] })]);
    const { plan } = promote(db, staged);
    db.close();
    const ok = evaluateGates({ pre, post: shell(measureOf(dbPath)), postPath: dbPath, footprint: planFootprint(plan, staged.observations), now: NOW });
    expect(ok.gates.G13_programme_contacts_valid).toBe(true);
    expect(ok.gates.G14_programme_contact_changes_accounted).toBe(true);
    const unplanned = evaluateGates({ pre, post: shell(measureOf(dbPath)), postPath: dbPath, footprint: { programmes: new Set(), coaches: new Set(), contacts: new Set() }, now: NOW });
    expect(unplanned.gates.G14_programme_contact_changes_accounted).toBe(false);
    // a row written around the pipeline with an unowned domain
    const w = new Database(dbPath);
    w.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, ?, ?, 'mens-soccer', 'ctx@gmail.example', 'x', 'TEAM_INBOX', 'https://concordiatx.example/sports/mens-soccer/coaches', '2027-08-20T00:00:00.000Z', 'manual', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', '2027-08-20T00:00:00.000Z', 'manual', 'x', 'x')`).run(programmeContactId(ENT, 'mens-soccer', 'ctx@gmail.example'), ENT, W.CTX);
    w.close();
    const bad = evaluateGates({ pre, post: shell(measureOf(dbPath)), postPath: dbPath, footprint: planFootprint(plan, staged.observations), now: NOW });
    expect(bad.gates.G13_programme_contacts_valid).toBe(false);
    expect(bad.gates.G14_programme_contact_changes_accounted).toBe(false);
  });

  it('the contact digest ignores write timestamps (a simulation and its live apply must agree)', () => {
    const r = { contact_id: 'PC-1', email: 'a@b.example', created_at: '1', updated_at: '1' };
    expect(measureProgrammeContacts([r]).hash).toBe(measureProgrammeContacts([{ ...r, created_at: '2', updated_at: '2' }]).hash);
    expect(measureProgrammeContacts([r]).hash).not.toBe(measureProgrammeContacts([{ ...r, email: 'c@b.example' }]).hash);
  });

  it('the redacted diff report carries no address', () => {
    const db = new Database(dbPath);
    const staged = stage(db, [contactPage({ contacts: [pub(INBOX), pub('ctxsoccer@gmail.example'), pub(PEOPLE.HEAD.email)] })]);
    const red = buildDiffReport(staged, { redact: true });
    expect(red).not.toMatch(/@/);
    expect(red).toMatch(/new programme inboxes \(1\)/);
    expect(buildDiffReport(staged, { redact: false })).toContain(INBOX);
    db.close();
  });
});

describe('end to end through the operator commands', () => {
  it('integrity:refresh --stage -> integrity:promote dry run -> --apply: PROMOTED, live re-measure == simulation, coaches unmoved', () => {
    // dated inside the CURRENT cycle so the G13 floor (judged at the real now) holds whenever this runs
    const fetched = new Date(Date.now() - 3600_000).toISOString(); const season = cycleOf(new Date());
    const inp = path.join(dir, 'in.json');
    fs.writeFileSync(inp, JSON.stringify({ season, scope: 'NAIA', parser_version: 'test-1', gathered_at: fetched, pages: [contactPage({ fetched_at: fetched, observed_season: season, contacts: [pub(INBOX)] })] }));
    const db0 = new Database(dbPath, { readonly: true }); const before = hashOf(db0, UNTOUCHED); db0.close();
    const o1 = execFileSync(process.execPath, ['server/scripts/integrityRefresh.js', '--db', dbPath, '--input', inp, '--stage', '--report-out', path.join(dir, 'r.md')], { cwd: ROOT, encoding: 'utf8' });
    const id = o1.match(/REFRESH (RB-\S+)/)[1]; const h = o1.match(/batch hash ([0-9a-f]{64})/)[1];
    const promoteCli = (...a) => execFileSync(process.execPath, ['server/scripts/integrityPromote.js', '--db', dbPath, '--batch', id, '--batch-hash', h, ...a], { cwd: ROOT, encoding: 'utf8' });
    const dry = promoteCli();
    expect(dry).toMatch(/PASS G13_programme_contacts_valid/); expect(dry).toMatch(/PASS G14_programme_contact_changes_accounted/); expect(dry).toMatch(/GATE PASS\. DRY RUN/);
    expect(promoteCli('--apply')).toMatch(/Live re-measure == simulation/);
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare('SELECT email, status FROM programme_contacts').all()).toEqual([{ email: INBOX, status: 'VERIFIED' }]);
    expect(hashOf(db, UNTOUCHED)).toBe(before);
    const v = validateProgrammeContacts(db);
    expect(v).toMatchObject({ status: 'PASS', verified: 1, eligible: 1 });
    db.close();
  }, 180000);
});

describe('the coach floor is untouched', () => {
  it('nameless generic "Team Email" coach rows stay ineligible, and promoting a programme contact changes no coach\'s answer', () => {
    const db = new Database(dbPath);
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, source) VALUES ('k-legacy', '2025-01-01', NULL, ?, 'Concordia University Texas', 'NAIA', 'mens-soccer', ?, 'generic', 'https://concordiatx.example/sports/mens-soccer/coaches', 'graduating_seniors.coaching_staff')").run(INBOX, "Men's Soccer (Team Email)");
    const answers = () => db.prepare('SELECT * FROM coaches ORDER BY id').all().map((c) => [c.id, coachIneligibility(c)]);
    const before = answers();
    expect(before.find(([id]) => id === 'k-legacy')[1]).toBe('EMAIL_NOT_VERIFIED:generic');
    const legacyBefore = JSON.stringify(db.prepare("SELECT * FROM coaches WHERE id='k-legacy'").get());
    // the legacy row is a lead, not a person: it does not block a FRESH observation of the same address
    const o = only(stage(db, [contactPage({ contacts: [pub(INBOX)] })]));
    expect(o.classification).toBe('NEW_RECORD');
    promote(db, { batch: { batch_id: 'b' }, observations: [o] });
    expect(answers()).toEqual(before);
    expect(JSON.stringify(db.prepare("SELECT * FROM coaches WHERE id='k-legacy'").get())).toBe(legacyBefore);
    db.close();
  });
});

describe('legacy leads: read-only, never evidence', () => {
  it('lists each legacy generic row as LEAD_ONLY / not promotable, flags what stands in its way, and writes nothing', () => {
    const db = new Database(dbPath);
    const ins = db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, source) VALUES (?, '2025-01-01', NULL, ?, ?, 'NAIA', 'mens-soccer', ?, 'generic', ?, 'graduating_seniors.coaching_staff')");
    ins.run('g1', INBOX, 'Concordia University Texas', "Women's Soccer (Team Email)", 'https://concordiatx.example/sports/mens-soccer/coaches');
    ins.run('g2', 'athletics@concordiatx.edu.example', 'Concordia University Texas', 'Athletics Dept (general inbox)', 'https://concordiatx.example/sports/mens-soccer/coaches');
    ins.run('g3', 'ctxsoccer@gmail.example', 'Concordia University Texas', "Men's Soccer (Team Email)", 'https://elsewhere.example/coaches');
    ins.run('g4', PEOPLE.HEAD.email, 'Texas', "Men's Soccer (Team Email)", 'https://texassports.example/sports/mens-soccer/coaches');
    // the same address twice: a legacy duplicate is counted, not merged
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, source) VALUES ('g5', '2025-01-01', '', ?, 'Concordia University Texas', 'NAIA', 'womens-soccer', 'Team Email', 'generic', 'legacy')").run(INBOX);
    db.close();
    const ro = new Database(dbPath, { readonly: true }); ro.pragma('query_only = ON');
    const before = hashOf(ro, [...UNTOUCHED, 'programme_contacts']);
    const q = buildLeadQueue(ro); const q2 = buildLeadQueue(ro);
    expect(q2.digest).toBe(q.digest);
    expect(hashOf(ro, [...UNTOUCHED, 'programme_contacts'])).toBe(before);
    ro.close();
    const by = Object.fromEntries(q.leads.map((l) => [l.legacy.coach_id, l]));
    expect(q.leads.every((l) => l.promotable === false && l.evidence_status === 'LEAD_ONLY')).toBe(true);
    expect(q.summary.promotable).toBe(0);
    expect(by.g1).toMatchObject({ queue_status: 'REACQUIRE', priority: 'SUPPLEMENTARY', checks: { legacy_title_names_other_sex: true, address_sex_signal: 'AGREES', address_domain: 'OWNED', legacy_source_host_owned: true, ever_observed_on_source: false } });
    expect(by.g1.target.expected_contact_id).toBe(programmeContactId(ENT, 'mens-soccer', INBOX));
    expect(by.g2.queue_status).toBe('BLOCKED_DEPARTMENT_INBOX');
    expect(by.g3.queue_status).toBe('BLOCKED_ADDRESS_DOMAIN');
    expect(by.g3.target.page_to_fetch).toBeNull();
    expect(by.g4.queue_status).toBe('BLOCKED_NAMED_COACH_ADDRESS');
    expect(by.g1.checks.duplicate_lead_rows).toBe(1);
    // g5 sits on the women's programme with a men's address: the conflict is reported, the lead is never trusted
    expect(by.g5.checks.address_sex_signal).toBe('CONFLICTS');
    expect(q.summary.lead_rows).toBe(5);
  });
});

describe('the floor itself, the read layer, the validator and the monitor', () => {
  const promoted = () => { const db = new Database(dbPath); promote(db, stage(db, [contactPage({ contacts: [pub(INBOX)] })])); return db; };

  it('sexSignalOfAddress is a conflict detector only; isDepartmentInbox spares sport-named addresses', () => {
    expect(sexSignalOfAddress('womenssoccer@x.edu')).toBe('womens-soccer');
    expect(sexSignalOfAddress('menssoccer@x.edu')).toBe('mens-soccer');
    expect(sexSignalOfAddress('muwomsoc@x.edu')).toBe('womens-soccer');
    expect(sexSignalOfAddress('bu.men.soccer@x.edu')).toBe('mens-soccer');
    expect(sexSignalOfAddress('soccer@x.edu')).toBeNull();
    expect(sexSignalOfAddress('carmen@x.edu')).toBeNull();          // a bare "men" inside a word is not a signal
    expect(sexSignalOfAddress('mensandwomenssoccer@x.edu')).toBeNull(); // both named: decides nothing
    expect(isDepartmentInbox('athletics@x.edu')).toBe(true);
    expect(isDepartmentInbox('athletics.soccer@x.edu')).toBe(false);
    expect(isDepartmentInbox('msoccer@x.edu')).toBe(false);
  });

  it('a VERIFIED row ages out of eligibility at the end of the next cycle — reported, not shown', () => {
    const db = promoted();
    const row = db.prepare('SELECT * FROM programme_contacts').get();
    const ctx = buildProgrammeContactContext(db);
    expect(programmeContactProblems(row, ctx, { now: NOW })).toEqual([]);
    expect(programmeContactProblems(row, ctx, { now: new Date('2028-08-01T00:00:00Z') })).toEqual([PC_INELIGIBLE.NOT_CURRENT]);
    expect(programmeContactProblems(row, ctx, { now: new Date('2027-01-01T00:00:00Z') })).toContain(PC_INELIGIBLE.OBSERVED_IN_FUTURE);
    expect(programmeContactProblems({ ...row, status: 'HISTORICAL' }, ctx, { now: NOW })).toContain(PC_INELIGIBLE.NOT_VERIFIED);
    db.close();
  });

  it('the read layer returns kind PROGRAMME_INBOX, sendable:false, provenance — and withholds what fails the floor now', () => {
    const db = promoted();
    const r = programmeContactsForCollege(W.CTX, { handle: db, now: NOW });
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0]).toMatchObject({ kind: 'PROGRAMME_INBOX', label: "Concordia University Texas Men's Soccer", email: INBOX, contact_role: 'TEAM_INBOX', sendable: false,
      provenance: { observed_on_url: contactPage().source_url, observed_at: '2027-08-20T00:00:00.000Z', freshness: 'CURRENT' } });
    expect(r.contacts[0]).not.toHaveProperty('coach_id');
    expect(r.contacts[0]).not.toHaveProperty('name');
    expect(programmeContactsForCollege(W.CTX, { handle: db, now: new Date('2028-08-01T00:00:00Z') })).toMatchObject({ contacts: [], withheld: 1 });
    expect(programmeContactsForCollege(W.CTX_W, { handle: db, now: NOW }).contacts).toEqual([]);   // the other sex's programme
    expect(programmeContactsForCollege('no-such-row', { handle: db, now: NOW })).toBeNull();
    db.close();
  });

  it('the validator and the monitor fail HARD on a VERIFIED row that breaks the floor; age alone is only a warning', () => {
    const db = promoted();
    expect(validateProgrammeContacts(db, { now: NOW }).status).toBe('PASS');
    expect(validateProgrammeContacts(db, { now: new Date('2028-08-01T00:00:00Z') })).toMatchObject({ status: 'PASS', eligible: 0, not_current: [expect.any(String)] });
    db.prepare("UPDATE programme_contacts SET observed_on_url='https://texassports.example/sports/mens-soccer/coaches'").run();
    const v = validateProgrammeContacts(db, { now: NOW });
    expect(v.status).toBe('FAIL'); expect(v.hard[0]).toMatch(/PC_SOURCE_NOT_OWNED/);
    db.close();
    const m = runMonitor(dbPath, { now: NOW, reconcile: false });
    const check = m.checks.find((c) => c.id === 'programme_contact_invalid');
    expect(check.severity).toBe('HARD'); expect(check.count).toBe(1);
  });

  it('V2: a contact_id that is not the deterministic id of its programme and address fails the validator', () => {
    const db = promoted();
    db.pragma('foreign_keys = OFF');
    db.prepare("UPDATE programme_contacts SET contact_id='PC-tampered'").run();
    expect(validateProgrammeContacts(db, { now: NOW }).hard.some((h) => h.startsWith('V2'))).toBe(true);
    db.close();
  });

  it('the table refuses a malformed address, an unknown role and a non-tier-A source outright', () => {
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON'); // as server/db/client.js runs every connection
    const ins = (over) => db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (@contact_id, @e, @c, 'mens-soccer', @email, 'L', @role, @url, 'x', 's', 'OFFICIAL_STAFF_DIRECTORY', @tier, 'VERIFIED', 'x', 'p', 'x', 'x')`).run({ contact_id: 'PC-x', e: ENT, c: W.CTX, email: INBOX, role: 'TEAM_INBOX', url: 'https://concordiatx.example/', tier: 'A', ...over });
    expect(() => ins({ email: 'MSoccer@Concordiatx.edu.example' })).toThrow(/CHECK/);
    expect(() => ins({ email: 'not-an-address' })).toThrow(/CHECK/);
    expect(() => ins({ role: 'HEAD_COACH' })).toThrow(/CHECK/);
    expect(() => ins({ tier: 'D' })).toThrow(/CHECK/);
    expect(() => ins({ url: 'http://concordiatx.example/' })).toThrow(/CHECK/);
    expect(() => ins({ c: 'no-such-college' })).toThrow(/FOREIGN KEY/);
    db.close();
  });
});
