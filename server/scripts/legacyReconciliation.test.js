import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../db/migrate.js';
import { planLegacyReconciliation, ledgerCoverage, DISPOSITION, MATCH } from './legacyReconciliationReport.js';
import { applyLegacyReconciliation, dryRunManifest, protectedFingerprint } from './legacyReconciliationApply.js';
import { programmeContactId } from '../lib/programmeContactEligibility.js';
import { indexFederalWebsites } from '../lib/federalInstitutionWebsites.js';

/**
 * PHASE 1G-B (B5) — the append-only legacy reconciliation ledger and its read-only planner.
 * A legacy generic row is never rewritten or deleted to look clean; each is accounted for beside
 * the verified contact that replaces it — and a row history points at is kept forever.
 */
const SCHEMA = fs.readFileSync(path.resolve(import.meta.dirname, '../db/schema.sql'), 'utf8');
const T = '2026-10-01T00:00:00.000Z';
const NOW = new Date('2026-10-08T00:00:00.000Z');

function world() {
  const db = new Database(':memory:'); db.exec(SCHEMA); migrate(db);
  const ent = db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?,?,?,'SINGLE','t',?)");
  const col = db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?,?,?,?,'mens-soccer','NCAA D3',1,?,?)");
  const dom = db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, ?, 'VERIFIED', 'ATHLETICS_SITE', '[]', '[]', 'TEST', 'CERTAIN', ?)");
  const lead = db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, source) VALUES (?, ?, NULL, ?, ?, 'NCAA D3', 'mens-soccer', 'Team Email', 'generic', ?, 'graduating_seniors.coaching_staff')");
  for (const [k, u] of [['alpha', 920001], ['beta', 920002], ['gamma', 920003], ['delta', 920004], ['eps', 920005]]) {
    ent.run(`AE-U${u}`, `${k} College`, u, T); col.run(`c-${k}`, T, T, `${k} College`, u, `AE-U${u}`); dom.run(`${k}.example`, u, T); dom.run(`${k}athletics.example`, u, T);
  }
  lead.run('g-superseded', T, 'msoccer@alpha.example', 'alpha College', 'https://alphaathletics.example/sports/mens-soccer/coaches');
  lead.run('g-referenced', T, 'msoccer@beta.example', 'beta College', 'https://betaathletics.example/sports/mens-soccer/coaches');
  lead.run('g-department', T, 'athletics@gamma.example', 'gamma College', 'https://gammaathletics.example/sports/mens-soccer/coaches');
  lead.run('g-invalid', T, 'msoccer@alpha.example', 'delta College', 'https://deltaathletics.example/sports/mens-soccer/coaches');  // another institution's mail domain
  lead.run('g-open', T, 'msoccer@eps.example', 'eps College', 'https://epsathletics.example/sports/mens-soccer/coaches');
  // the verified replacement for alpha
  db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
    VALUES (?, 'AE-U920001', 'c-alpha', 'mens-soccer', 'msoccer@alpha.example', 'alpha College Men''s Soccer', 'TEAM_INBOX', 'https://alphaathletics.example/sports/mens-soccer/coaches', ?, 'refresh:t', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
    .run(programmeContactId('AE-U920001', 'mens-soccer', 'msoccer@alpha.example'), '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z', T, T);
  // history on beta's legacy row
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug, email, video_id, video_chapters, graduation_year)
    VALUES ('p1', 'x', 'x', 'Test Athlete', 'Winger', 'mens-soccer', 'slug-p1', 'a@example.com', 'aqz-KE-bpKQ', '[]', 2027)`).run();
  db.prepare("INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, sent_at) VALUES ('o1', 'p1', 'g-referenced', 'tok-1', ?, ?)").run(T, T);
  return db;
}
const plan = (db, runId = 'RUN-1') => planLegacyReconciliation(db, { runId, now: NOW, federalIndex: indexFederalWebsites({ rows: [] }) });
const byCoach = (p) => Object.fromEntries(p.entries.map((e) => [e.coach_id, e]));

describe('the planner (read-only)', () => {
  it('accounts for every legacy row exactly once, with the right disposition', () => {
    const db = world(); const p = plan(db); const e = byCoach(p);
    expect(e['g-superseded']).toMatchObject({ disposition: DISPOSITION.SUPERSEDED, programme_contact_id: programmeContactId('AE-U920001', 'mens-soccer', 'msoccer@alpha.example') });
    expect(e['g-referenced']).toMatchObject({ disposition: DISPOSITION.RETAINED_REFERENCED, programme_contact_id: null });
    expect(JSON.parse(e['g-referenced'].evidence_json).references).toMatchObject({ outreach: 1 });
    expect(e['g-department'].disposition).toBe(DISPOSITION.BLOCKED);
    expect(e['g-invalid'].disposition).toBe(DISPOSITION.INVALID);
    expect(e['g-open'].disposition).toBe(DISPOSITION.UNRESOLVED);
    expect(p.summary.coverage).toEqual({ generic_rows: 5, accounted: 5, missing: [], duplicated: 0 });
  });
  it('a referenced row is RETAINED even when a verified replacement exists — and names it', () => {
    const db = world();
    db.prepare("INSERT INTO outreach (id, athlete_id, coach_id, token, created_at) VALUES ('o2', 'p1', 'g-superseded', 'tok-2', ?)").run(T);
    const e = byCoach(plan(db))['g-superseded'];
    expect(e).toMatchObject({ disposition: DISPOSITION.RETAINED_REFERENCED, programme_contact_id: programmeContactId('AE-U920001', 'mens-soccer', 'msoccer@alpha.example') });
  });
  it('is deterministic and writes nothing', () => {
    const db = world(); const before = db.prepare('SELECT total_changes() n').get().n;
    const a = plan(db); const b = plan(db);
    expect(a.summary.plan_hash).toBe(b.summary.plan_hash);
    expect(a.entries.map((x) => x.entry_id)).toEqual(b.entries.map((x) => x.entry_id));
    expect(db.prepare('SELECT total_changes() n').get().n).toBe(before);
    expect(db.prepare('SELECT COUNT(*) n FROM legacy_contact_reconciliation').get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM coaches WHERE email_status = 'generic'").get().n).toBe(5);
  });
});

describe('the ledger table (append-only)', () => {
  const insert = (db, e) => db.prepare(`INSERT INTO legacy_contact_reconciliation (entry_id, run_id, coach_id, disposition, programme_contact_id, cohort, reason, evidence_json, rule_version, recorded_at)
    VALUES (@entry_id, @run_id, @coach_id, @disposition, @programme_contact_id, @cohort, @reason, @evidence_json, @rule_version, @recorded_at)`).run(e);
  it('accepts the planner\'s entries, then refuses UPDATE and DELETE', () => {
    const db = world(); const p = plan(db);
    for (const e of p.entries) insert(db, e);
    expect(ledgerCoverage(db)).toMatchObject({ ledger: 'PRESENT', generic_rows: 5, accounted: 5, entries: 5 });
    expect(() => db.prepare("UPDATE legacy_contact_reconciliation SET reason = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM legacy_contact_reconciliation').run()).toThrow(/append-only/);
  });
  it('refuses a SUPERSEDED entry without its replacement, an unknown disposition, and a second entry for a coach in one run', () => {
    const db = world(); const e = byCoach(plan(db))['g-superseded'];
    expect(() => insert(db, { ...e, programme_contact_id: null })).toThrow(/CHECK/);
    expect(() => insert(db, { ...e, entry_id: 'LCR-x', disposition: 'DELETED' })).toThrow(/CHECK/);
    insert(db, e);
    expect(() => insert(db, { ...e, entry_id: 'LCR-y' })).toThrow(/UNIQUE/);
  });
  it('a later decision is a new entry in a new run; the ledger outlives the legacy row (no foreign key to coaches)', () => {
    const db = world(); const first = byCoach(plan(db, 'RUN-1'))['g-open'];
    insert(db, first);
    const later = byCoach(plan(db, 'RUN-2'))['g-open'];
    expect(later.entry_id).not.toBe(first.entry_id);
    insert(db, later);
    expect(db.prepare("SELECT COUNT(*) n FROM legacy_contact_reconciliation WHERE coach_id = 'g-open'").get().n).toBe(2);
    expect(db.prepare("PRAGMA foreign_key_list('legacy_contact_reconciliation')").all().map((f) => f.table)).toEqual(['programme_contacts']);
  });
});

/* ------------------------------------------------------------------------ */
/* PHASE 1G-E — explicit exact matching (LCR-2) and the gated, append-only apply */
/* ------------------------------------------------------------------------ */
const ev = (e) => JSON.parse(e.evidence_json);
const addContact = (db, ent, col, email) => db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
  VALUES (?, ?, ?, 'mens-soccer', ?, 'x Men''s Soccer', 'TEAM_INBOX', 'https://x.example/sports/mens-soccer/coaches', '2026-10-07T00:00:00.000Z', 'refresh:t', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', '2026-10-07T00:00:00.000Z', 'test', ?, ?)`)
  .run(programmeContactId(ent, 'mens-soccer', email), ent, col, email, T, T);

describe('LCR-2: a replacement is named only for an explicit, unambiguous exact match', () => {
  it('an EXACT match records the evidence: same entity, sport and address, and the contact\'s own provenance', () => {
    const e = byCoach(plan(world()))['g-superseded'];
    expect(e.disposition).toBe(DISPOSITION.SUPERSEDED);
    expect(ev(e).match).toMatchObject({
      class: MATCH.EXACT, same_entity: true, same_sport: true, same_address: true,
      legacy: { coach_id: 'g-superseded', address: 'msoccer@alpha.example', athletics_entity_id: 'AE-U920001' },
      contact: { address: 'msoccer@alpha.example', athletics_entity_id: 'AE-U920001', sport: 'mens-soccer', status: 'VERIFIED', observed_on_url: expect.stringMatching(/^https:/), source: 'refresh:t' },
    });
  });
  it('a programme holding a verified contact at a DIFFERENT address is ambiguous: UNRESOLVED, nothing named', () => {
    const db = world(); addContact(db, 'AE-U920005', 'c-eps', 'wsocc-other@eps.example');
    const e = byCoach(plan(db))['g-open'];
    expect(e).toMatchObject({ disposition: DISPOSITION.UNRESOLVED, programme_contact_id: null });
    expect(ev(e).match.class).toBe(MATCH.AMBIGUOUS_PROGRAMME_ADDRESS);
  });
  it('two verified contacts at one programme make even the exact address ambiguous', () => {
    const db = world(); addContact(db, 'AE-U920001', 'c-alpha', 'soccer-two@alpha.example');
    const e = byCoach(plan(db))['g-superseded'];
    expect(e).toMatchObject({ disposition: DISPOSITION.UNRESOLVED, programme_contact_id: null });
    expect(ev(e).match.class).toBe(MATCH.AMBIGUOUS_PROGRAMME_ADDRESS);
  });
  it('an address verified for a DIFFERENT programme is never reconciled to it', () => {
    const db = world(); addContact(db, 'AE-U920002', 'c-beta', 'msoccer@eps.example');   // eps's legacy address, verified under beta
    const e = byCoach(plan(db))['g-open'];
    expect(e).toMatchObject({ disposition: DISPOSITION.UNRESOLVED, programme_contact_id: null });
    expect(ev(e).match.class).toBe(MATCH.AMBIGUOUS_ADDRESS_ELSEWHERE);
  });
  it('two legacy rows for one programme (its two spellings) and one address are both reconciled to the one contact', () => {
    const db = world();
    db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES ('c-alpha-alt', ?, ?, 'Alpha Coll.', 'mens-soccer', 'NCAA D3', 1, 920001, 'AE-U920001')").run(T, T);
    db.prepare("INSERT INTO programme_row_links (college_id, canonical_college_id, link_kind, provenance, recorded_at) VALUES ('c-alpha-alt', 'c-alpha', 'SAME_PROGRAMME_ALT_NAME', 'test', ?)").run(T);
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, source) VALUES ('g-superseded-alt', ?, NULL, 'msoccer@alpha.example', 'Alpha Coll.', 'NCAA D3', 'mens-soccer', 'Team Email', 'generic', 'https://alphaathletics.example/sports/mens-soccer/coaches', 'graduating_seniors.coaching_staff')").run(T);
    const p = plan(db); const e = byCoach(p);
    const pc = programmeContactId('AE-U920001', 'mens-soccer', 'msoccer@alpha.example');
    expect(e['g-superseded']).toMatchObject({ disposition: DISPOSITION.SUPERSEDED, programme_contact_id: pc });
    expect(e['g-superseded-alt']).toMatchObject({ disposition: DISPOSITION.SUPERSEDED, programme_contact_id: pc });
    expect(p.summary.contacts_naming_several_rows).toEqual([{ contact_id: pc, coach_ids: ['g-superseded', 'g-superseded-alt'] }]);
  });
});

describe('applying a reviewed plan (the only writer)', () => {
  const RUN = 'LCR-1GE-TEST';
  const approved = (db) => planLegacyReconciliation(db, { runId: RUN, now: NOW }).summary.plan_hash;
  it('the dry run writes nothing and describes every insert', () => {
    const db = world(); const before = db.prepare('SELECT total_changes() n').get().n;
    const m = dryRunManifest(db, { runId: RUN, now: NOW });
    expect(m).toMatchObject({ would_insert: 5, writes: 0, ledger_rows_now: 0, table: 'legacy_contact_reconciliation' });
    expect(m.inserts.map((i) => i.disposition).sort()).toEqual(['BLOCKED', 'INVALID', 'RETAINED_REFERENCED', 'SUPERSEDED', 'UNRESOLVED']);
    expect(db.prepare('SELECT total_changes() n').get().n).toBe(before);
  });
  it('inserts exactly the approved entries and changes no protected table — history keeps its recipient', () => {
    const db = world(); const fp = protectedFingerprint(db);
    const r = applyLegacyReconciliation(db, { runId: RUN, expectedPlanHash: approved(db), now: NOW });
    expect(r).toMatchObject({ status: 'APPLIED', inserted: 5, ledger_before: 0, ledger_after: 5 });
    expect(protectedFingerprint(db)).toEqual(fp);
    expect(db.prepare("SELECT coach_id FROM outreach WHERE id = 'o1'").get().coach_id).toBe('g-referenced');   // never rewritten
    expect(db.prepare("SELECT COUNT(*) n FROM coaches WHERE email_status = 'generic'").get().n).toBe(5);       // never converted or deleted
    expect(db.prepare("SELECT disposition FROM legacy_contact_reconciliation WHERE coach_id = 'g-referenced'").get().disposition).toBe('RETAINED_REFERENCED');
  });
  it('refuses a plan that drifted after approval, and writes nothing', () => {
    const db = world(); const hash = approved(db);
    addContact(db, 'AE-U920005', 'c-eps', 'msoccer@eps.example');   // the world moved: eps now has a verified contact
    expect(() => applyLegacyReconciliation(db, { runId: RUN, expectedPlanHash: hash, now: NOW })).toThrow(/plan changed/);
    expect(db.prepare('SELECT COUNT(*) n FROM legacy_contact_reconciliation').get().n).toBe(0);
  });
  it('requires an approved plan hash', () => {
    const db = world();
    expect(() => applyLegacyReconciliation(db, { runId: RUN, now: NOW })).toThrow(/plan hash/);
  });
  it('is idempotent for the same run, and refuses reusing a run id for different entries', () => {
    const db = world(); const hash = approved(db);
    applyLegacyReconciliation(db, { runId: RUN, expectedPlanHash: hash, now: NOW });
    expect(applyLegacyReconciliation(db, { runId: RUN, expectedPlanHash: hash, now: NOW })).toMatchObject({ status: 'ALREADY_APPLIED', inserted: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM legacy_contact_reconciliation').get().n).toBe(5);
    // a manual ledger entry under the same run id for a row the plan would decide differently
    const db2 = world(); const h2 = approved(db2);
    db2.prepare(`INSERT INTO legacy_contact_reconciliation (entry_id, run_id, coach_id, disposition, programme_contact_id, cohort, reason, evidence_json, rule_version, recorded_at)
      VALUES ('LCR-manual', ?, 'g-open', 'BLOCKED', NULL, 'x', 'x', '{}', 'LCR-2', ?)`).run(RUN, T);
    expect(() => applyLegacyReconciliation(db2, { runId: RUN, expectedPlanHash: h2, now: NOW })).toThrow(/already holds a different set/);
  });
  it('rolls back everything if a protected table changes during the apply', () => {
    const db = world(); const hash = approved(db);
    db.exec("CREATE TRIGGER t_sneaky AFTER INSERT ON legacy_contact_reconciliation BEGIN UPDATE coaches SET position_title = 'changed' WHERE id = NEW.coach_id; END;");
    expect(() => applyLegacyReconciliation(db, { runId: RUN, expectedPlanHash: hash, now: NOW })).toThrow(/change nothing but the ledger/);
    expect(db.prepare('SELECT COUNT(*) n FROM legacy_contact_reconciliation').get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM coaches WHERE position_title = 'changed'").get().n).toBe(0);
  });
});

