import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../db/migrate.js';
import { planLegacyReconciliation, ledgerCoverage, DISPOSITION } from './legacyReconciliationReport.js';
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
    ent.run(`AE-U${u}`, `${k} College`, u, T); col.run(`c-${k}`, T, T, `${k} College`, u, `AE-U${u}`); dom.run(`${k}.edu`, u, T); dom.run(`${k}athletics.example`, u, T);
  }
  lead.run('g-superseded', T, 'msoccer@alpha.edu', 'alpha College', 'https://alphaathletics.example/sports/mens-soccer/coaches');
  lead.run('g-referenced', T, 'msoccer@beta.edu', 'beta College', 'https://betaathletics.example/sports/mens-soccer/coaches');
  lead.run('g-department', T, 'athletics@gamma.edu', 'gamma College', 'https://gammaathletics.example/sports/mens-soccer/coaches');
  lead.run('g-invalid', T, 'msoccer@alpha.edu', 'delta College', 'https://deltaathletics.example/sports/mens-soccer/coaches');  // another institution's mail domain
  lead.run('g-open', T, 'msoccer@eps.edu', 'eps College', 'https://epsathletics.example/sports/mens-soccer/coaches');
  // the verified replacement for alpha
  db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
    VALUES (?, 'AE-U920001', 'c-alpha', 'mens-soccer', 'msoccer@alpha.edu', 'alpha College Men''s Soccer', 'TEAM_INBOX', 'https://alphaathletics.example/sports/mens-soccer/coaches', ?, 'refresh:t', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
    .run(programmeContactId('AE-U920001', 'mens-soccer', 'msoccer@alpha.edu'), '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z', T, T);
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
    expect(e['g-superseded']).toMatchObject({ disposition: DISPOSITION.SUPERSEDED, programme_contact_id: programmeContactId('AE-U920001', 'mens-soccer', 'msoccer@alpha.edu') });
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
    expect(e).toMatchObject({ disposition: DISPOSITION.RETAINED_REFERENCED, programme_contact_id: programmeContactId('AE-U920001', 'mens-soccer', 'msoccer@alpha.edu') });
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
