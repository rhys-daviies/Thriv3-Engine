import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';

/** Phase 7D permanent identity invariant. Synthetic data; RFC 2606 domains. */
let dir; let db;
function base() {
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER, athletics_entity_id TEXT);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT, athletics_entity_id TEXT);
    CREATE TABLE athletics_entities (athletics_entity_id TEXT PRIMARY KEY, display_name TEXT, federal_unitid INTEGER, parent_unitid INTEGER, campus_label TEXT, entity_kind TEXT, provenance TEXT, notes TEXT, created_at TEXT);
  `);
  const e = db.prepare('INSERT INTO athletics_entities VALUES (?,?,?,?,?,?,?,?,?)');
  e.run('AE-U100001', 'Parent', 100001, null, null, 'SINGLE', 'default: test', null, 't');
  e.run('AE-X-B', 'Branch', null, 100001, 'Branch', 'BRANCH_CAMPUS', 'researched', null, 't');
  e.run('AE-X-N', 'NonTitleIV', null, null, null, 'NON_TITLE_IV', 'researched', null, 't');
  const c = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?,?)');
  c.run('p', 'Parent', 'mens-soccer', 'NCAA D3', 100001, 1, 'AE-U100001');
  c.run('b', 'Branch', 'mens-soccer', 'NAIA', 100001, 1, 'AE-X-B');
  c.run('n', 'NonTitleIV', 'womens-soccer', 'NAIA', null, 1, 'AE-X-N');
  db.prepare("INSERT INTO athletics_domains VALUES ('branch.example.net', NULL, 'VERIFIED', 'AE-X-B')").run();
}
const run = (o = {}) => validateEntityIdentity(db, { allowlist: [], knownWrongUnitid: [], ...o });
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7d-val-')); db = new Database(path.join(dir, 't.sqlite')); });
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('athletics-entity identity invariant', () => {
  it('unmigrated database reports MODEL_ABSENT (not a failure)', () => {
    db.exec('CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER)');
    expect(validateEntityIdentity(db).status).toBe('MODEL_ABSENT');
  });
  it('a correctly modeled branch sharing its parent UNITID passes', () => { base(); const r = run(); expect(r.hard).toEqual([]); expect(r.status).toBe('PASS'); expect(r.counts.modeled_shared_unitids).toBe(1); });
  it('H1: an active programme without an entity fails', () => { base(); db.prepare("INSERT INTO colleges VALUES ('x','X','mens-soccer','NAIA',100009,1,NULL)").run(); expect(run().hard.join()).toMatch(/H1 active programme without entity/); });
  it('H2: a locator code in federal_unitid fails', () => { base(); db.prepare("INSERT INTO athletics_entities VALUES ('AE-X-L','L',15111102,NULL,NULL,'UNRESOLVED_FEDERAL','p',NULL,'t')").run(); expect(run().hard.join()).toMatch(/H2 AE-X-L/); });
  it('H4: colleges.unitid disagreeing with its entity fails (unless documented)', () => {
    base(); db.prepare("UPDATE colleges SET unitid=100777 WHERE id='n'").run();
    expect(run().hard.join()).toMatch(/H4 NonTitleIV/);
    expect(run({ knownWrongUnitid: ['AE-X-N'] }).hard).toEqual([]);
  });
  it('H4: an eight-digit colleges.unitid fails', () => { base(); db.prepare("UPDATE colleges SET unitid=15111102 WHERE id='b'").run(); expect(run().hard.join()).toMatch(/not a six-digit/); });
  it('H5: two entities sharing a UNITID without a proven parent link fail', () => {
    base(); db.prepare("INSERT INTO athletics_entities VALUES ('AE-X-ROGUE','R',NULL,NULL,NULL,'UNRESOLVED_FEDERAL','p',NULL,'t')").run();
    db.prepare("INSERT INTO colleges VALUES ('r','Rogue','womens-soccer','NAIA',100001,1,'AE-X-ROGUE')").run();
    expect(run().hard.join()).toMatch(/H5 UNITID 100001/);
  });
  it('H6: an unlisted duplicate programme fails; a listed one is documented; a stale listing warns', () => {
    base(); db.prepare("INSERT INTO colleges VALUES ('p2','Parent Dup','mens-soccer','NCAA D3',100001,1,'AE-U100001')").run();
    expect(run().hard.join()).toMatch(/H6 duplicate active programme/);
    const allow = [{ key: 'AE-U100001|mens-soccer', class: 'SAME_PROGRAMME_TWO_NAMES', college_ids: ['p', 'p2'] }];
    const r = run({ allowlist: allow }); expect(r.hard).toEqual([]); expect(r.documented.join()).toMatch(/SAME_PROGRAMME_TWO_NAMES/);
    db.prepare("UPDATE colleges SET active=0 WHERE id='p2'").run();
    expect(run({ allowlist: allow }).warnings.join()).toMatch(/stale allowlist/);
  });
  it('H7: a shared-platform root owned by an entity fails', () => { base(); db.prepare("INSERT INTO athletics_domains VALUES ('prestosports.com', NULL, 'VERIFIED', 'AE-X-B')").run(); expect(run().hard.join()).toMatch(/H7 shared-platform root/); });
  it('H7: an entity-owned domain whose UNITID disagrees fails', () => { base(); db.prepare("UPDATE athletics_domains SET unitid=100555").run(); expect(run().hard.join()).toMatch(/H7 domain branch.example.net/); });
  it('H8: a SINGLE federal id on no row with only default provenance fails', () => {
    base(); db.prepare("INSERT INTO athletics_entities VALUES ('AE-U100444','Ghost',100444,NULL,NULL,'SINGLE','default: one entity per UNITID',NULL,'t')").run();
    expect(run().hard.join()).toMatch(/H8 AE-U100444/);
  });
});
