import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 7D — athletics-entity identity through the REAL reconcile pipeline.
 * Branch campuses, non-Title-IV schools and campuses sharing one UNITID resolve by athletics
 * entity inside the strict scope (NAIA); outside it (NCAA) and without entity rows, the legacy
 * UNITID path is unchanged. Synthetic RFC 2606 domains only.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REC = 'server/scripts/reconcileCoaches.js';
let dir; let dbPath;
const COACH = { email: 'a.coach@example.org', status: 'verified', cur: 'CURRENT', curSrc: 'https://branch.example.net/coaches', seenAt: '2026-09-29', seenUrl: 'https://branch.example.net/coaches' };

function build({ entities = true, coachSchool = 'Parent U Branch', coachSport = 'mens-soccer', source = 'https://branch.example.net/coaches', email = COACH.email, branchHostRow = true, branchDivision = 'NAIA', coach = COACH, csName = null, extraCoaches = [] } = {}) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, unitid INTEGER, state TEXT, division TEXT, active INTEGER, athletics_entity_id TEXT);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT, athletics_entity_id TEXT);
    CREATE TABLE institution_aliases (alias_key TEXT, unitid INTEGER, alias_type TEXT);
    CREATE TABLE coach_seasons (school TEXT, sport TEXT, season INTEGER, coach_name TEXT, source_url TEXT);
    CREATE TABLE coaches (id TEXT, full_name TEXT, email TEXT, school TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, currentness_status TEXT, currentness_source_url TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
    CREATE TABLE athletics_entities (athletics_entity_id TEXT PRIMARY KEY, display_name TEXT, federal_unitid INTEGER, parent_unitid INTEGER, campus_label TEXT, entity_kind TEXT, provenance TEXT, notes TEXT, created_at TEXT);
  `);
  const col = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?,?,?)');
  // parent institution (its own athletics, NCAA D3) and its NAIA branch (no UNITID of its own)
  col.run('p-m', 'Parent U', 'mens-soccer', 700001, 'IL', 'NCAA D3', 1, entities ? 'AE-U700001' : null);
  col.run('b-m', 'Parent U Branch', 'mens-soccer', null, 'AZ', branchDivision, 1, entities ? 'AE-X-BRANCH' : null);
  // two NAIA campuses of one federal institution 700002 (no entity owns 700002 itself)
  col.run('ca-m', 'System U-Alpha', 'mens-soccer', 700002, 'PA', 'NAIA', 1, entities ? 'AE-X-SYS-ALPHA' : null);
  col.run('cb-m', 'System U-Beta', 'mens-soccer', 700002, 'PA', 'NAIA', 1, entities ? 'AE-X-SYS-BETA' : null);
  const dom = db.prepare('INSERT INTO athletics_domains VALUES (?,?,?,?)');
  dom.run('example.org', 700001, 'VERIFIED', null);          // parent institution + shared email domain
  dom.run('example.net', 700001, 'VERIFIED', null);          // parent athletics root
  if (branchHostRow) dom.run('branch.example.net', null, 'VERIFIED', entities ? 'AE-X-BRANCH' : null);
  dom.run('alpha.example.com', null, 'VERIFIED', entities ? 'AE-X-SYS-ALPHA' : null);
  dom.run('beta.example.com', null, 'VERIFIED', entities ? 'AE-X-SYS-BETA' : null);
  dom.run('example.com', 700002, 'VERIFIED', null);          // system-level domain: cannot pick a campus
  if (entities) {
    const e = db.prepare('INSERT INTO athletics_entities VALUES (?,?,?,?,?,?,?,?,?)');
    e.run('AE-U700001', 'Parent U', 700001, null, null, 'SINGLE', 'test', null, '2026-09-29');
    e.run('AE-X-BRANCH', 'Parent U Branch', null, 700001, 'Branch', 'BRANCH_CAMPUS', 'test', null, '2026-09-29');
    e.run('AE-X-SYS-ALPHA', 'System U-Alpha', null, 700002, 'Alpha', 'SYSTEM_CAMPUS', 'test', null, '2026-09-29');
    e.run('AE-X-SYS-BETA', 'System U-Beta', null, 700002, 'Beta', 'SYSTEM_CAMPUS', 'test', null, '2026-09-29');
  }
  if (csName) db.prepare('INSERT INTO coach_seasons VALUES (?,?,?,?,?)').run(coachSchool, coachSport, 2026, csName, 'https://elsewhere.example/roster');
  const ins = db.prepare('INSERT INTO coaches VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  ins.run('k1', 'Amy Coach', email, coachSchool, coachSport, 'Head Coach', coach.status, source, coach.cur, coach.curSrc, coach.seenAt, coach.seenUrl);
  for (const x of extraCoaches) ins.run(...x);
  db.close();
}
function reconcile(id = 'k1') {
  execFileSync('node', [REC, '--db', dbPath, '--csv', path.join(dir, 'o.csv')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STRICT_CORROB_SCOPE: 'NAIA' } });
  const D = new Database(dbPath, { readonly: true });
  const r = D.prepare('SELECT * FROM coaches_reconciled WHERE coach_id=?').get(id);
  D.close(); return r;
}
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7d-rec-')); dbPath = path.join(dir, 't.sqlite'); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 7D athletics-entity reconciliation (real pipeline)', () => {
  it('branch coach on its own entity host is strict-eligible on its OWN programme', () => {
    build(); const r = reconcile();
    expect(r.outreach_eligibility).toBe('YES');
    expect(r.corroboration_method).toBe('STRICT_AUTHORITATIVE_CURRENT');
    expect(r.canonical_college_id).toBe('b-m');
    expect(r.canonical_entity_id).toBe('AE-X-BRANCH');
    expect(r.canonical_school).toBe('Parent U Branch');
    expect(r.canonical_unitid).toBeNull(); // no synthetic federal id
  });
  it('LEGACY defect reproduced: without entities the branch coach is reassigned into the parent (NCAA D3) programme', () => {
    build({ entities: false, branchHostRow: false, source: 'https://example.net/coaches' }); const r = reconcile();
    expect(r.classification).toBe('REASSIGN');
    expect(r.canonical_unitid).toBe(700001);
    expect(r.canonical_school).toBe('Parent U');
  });
  it('parent-level site domain cannot move a branch coach into the parent (parent-only evidence)', () => {
    build({ branchHostRow: false, source: 'https://example.net/coaches' }); const r = reconcile();
    expect(r.classification).toBe('WITHHOLD');
    expect(r.resolution_method).toMatch(/PARENT_ONLY/);
    expect(r.canonical_college_id).toBe('b-m');
    expect(r.outreach_eligibility).toBe('NO');
  });
  it('shared parent EMAIL domain alone cannot move a branch coach either', () => {
    build({ branchHostRow: false, source: null }); const r = reconcile();
    expect(r.classification).not.toBe('REASSIGN');
    expect(r.canonical_college_id).toBe('b-m');
  });
  it('campus of a shared UNITID stays on its own campus programme (no silent campus rename)', () => {
    build({ coachSchool: 'System U-Alpha', source: 'https://alpha.example.com/coaches', email: 'a.coach@example.com', coach: { ...COACH, curSrc: 'https://alpha.example.com/coaches', seenUrl: 'https://alpha.example.com/coaches' } });
    const r = reconcile();
    expect(r.canonical_college_id).toBe('ca-m');
    expect(r.canonical_school).toBe('System U-Alpha');
    expect(r.outreach_eligibility).toBe('YES');
  });
  it('a system-level domain (UNITID owned by no entity) cannot pick a campus', () => {
    build({ coachSchool: 'System U-Alpha', source: 'https://example.com/staff', email: 'a.coach@example.com', coach: { ...COACH, curSrc: 'https://example.com/staff', seenUrl: 'https://example.com/staff' } });
    const r = reconcile();
    expect(r.classification).not.toBe('REASSIGN');
    expect(r.outreach_eligibility).toBe('NO');
    expect(r.canonical_college_id).toBe('ca-m');
  });
  it('same-name/sibling protection: evidence from the OTHER campus host is never a KEEP or strict pass', () => {
    build({ coachSchool: 'System U-Alpha', source: 'https://beta.example.com/coaches', email: 'a.coach@example.com', coach: { ...COACH, curSrc: 'https://beta.example.com/coaches', seenUrl: 'https://beta.example.com/coaches' } });
    const r = reconcile();
    expect(r.classification).toBe('REASSIGN');
    expect(r.canonical_college_id).toBe('cb-m');
    expect(r.corroboration_method).not.toBe('STRICT_AUTHORITATIVE_CURRENT');
    expect(r.outreach_eligibility).toBe('NO');
  });
  it('entity host must still meet every strict condition (PROVEN_STALE fails)', () => {
    build({ coach: { ...COACH, cur: 'PROVEN_STALE' } }); expect(reconcile().outreach_eligibility).toBe('NO');
  });
  it('outside the strict scope (NCAA) the legacy UNITID path is used even with entities present', () => {
    build({ coachSchool: 'Parent U', source: 'https://example.net/coaches', csName: 'Amy Coach', coach: { ...COACH, cur: null, curSrc: null, seenAt: null, seenUrl: null } });
    const r = reconcile();
    expect(r.outreach_eligibility).toBe('YES');
    expect(r.corroboration_method).toBe('COACH_SEASONS_IDENTITY');
    expect(r.canonical_unitid).toBe(700001);
    expect(r.canonical_entity_id).toBe('AE-U700001');
  });
  it('an EMPTY athletics_entities table is inert (legacy behaviour)', () => {
    build({ entities: false, source: 'https://example.net/coaches', branchHostRow: false });
    const D = new Database(dbPath); D.exec("UPDATE colleges SET athletics_entity_id = NULL"); D.close();
    expect(reconcile().classification).toBe('REASSIGN');
  });
});
