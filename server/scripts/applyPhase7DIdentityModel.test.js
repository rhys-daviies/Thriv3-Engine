import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** PHASE 7D identity-model applier guards. Synthetic data; RFC 2606 domains. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase7DIdentityModel.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT PRIMARY KEY, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER, city TEXT, academic_rating REAL, identity_notes TEXT);
    CREATE TABLE athletics_domains (domain TEXT PRIMARY KEY, unitid INTEGER, status TEXT NOT NULL, role TEXT, claimed_keys TEXT NOT NULL, claimed_unitids TEXT NOT NULL, verification_method TEXT NOT NULL, confidence TEXT NOT NULL, notes TEXT, checked_at TEXT NOT NULL);
    CREATE TABLE institution_aliases (alias_key TEXT, unitid INTEGER);
    CREATE TABLE coaches (id TEXT, school TEXT, sport TEXT);
  `);
  const c = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?,?,?,?)');
  c.run('m', 'Saint Example (IL)', 'mens-soccer', 'NAIA', 100575, 1, 'Wrongtown', 6.5, null);
  c.run('w', 'University of Saint Example (IL)', 'womens-soccer', 'NAIA', 100584, 1, 'Righttown', 5, null);
  c.run('b', 'Example Branch', 'mens-soccer', 'NAIA', null, 1, null, null, null);
  c.run('s', 'Example Stale', 'mens-soccer', 'NJCAA', 100900, 1, null, null, null);
  c.run('s2', 'Example Stale College', 'mens-soccer', 'NAIA', 100900, 1, null, null, null);
  db.prepare("INSERT INTO athletics_domains VALUES ('example.org', 100575, 'VERIFIED', 'ATHLETICS_SITE', '[]', '[100584]', 'X', 'HIGH', NULL, 't')").run();
  db.prepare("INSERT INTO athletics_domains VALUES ('branch.example.net', NULL, 'INSUFFICIENT_EVIDENCE', 'ATHLETICS_SITE', '[]', '[]', 'X', 'NONE', NULL, 't')").run();
  db.prepare("INSERT INTO institution_aliases VALUES ('saint example il', 100575)").run();
  db.close();
}
const ent = (id, o) => ({ athletics_entity_id: id, display_name: id, federal_unitid: null, parent_unitid: null, campus_label: null, entity_kind: 'SINGLE', provenance: 'researched (test)', notes: null, created_at: '2026-09-29', ...o });
function fixture(over = {}) {
  const f = {
    entities: [ent('AE-U100584', { federal_unitid: 100584 }), ent('AE-X-BRANCH', { entity_kind: 'BRANCH_CAMPUS', parent_unitid: 100584, campus_label: 'Branch' }), ent('AE-U100900', { federal_unitid: 100900 })],
    assignments: [['m', 'AE-U100584'], ['w', 'AE-U100584'], ['b', 'AE-X-BRANCH'], ['s', 'AE-U100900'], ['s2', 'AE-U100900']].map(([college_id, e]) => ({ college_id, athletics_entity_id: e, expected_old: null })),
    repairs: [
      { op: 'CORRECT_FEDERAL_UNITID', college_id: 'm', expected: { name: 'Saint Example (IL)', sport: 'mens-soccer', unitid: 100575 }, set: { unitid: 100584, city: 'Righttown', academic_rating: 5 }, expected_old_fields: { city: 'Wrongtown', academic_rating: 6.5 }, provenance: 'test' },
      { op: 'CORRECT_ALIAS_UNITID', alias_key: 'saint example il', expected: { unitid: 100575 }, set: { unitid: 100584 }, provenance: 'test' },
      { op: 'CORRECT_DOMAIN_UNITID', domain: 'example.org', expected: { unitid: 100575, status: 'VERIFIED' }, set: { unitid: 100584 }, provenance: 'test' },
      { op: 'DEACTIVATE_STALE_ROW', college_id: 's', expected: { name: 'Example Stale', division: 'NJCAA', active: 1, coach_rows: 0 }, set: { active: 0 }, provenance: 'test' },
    ],
    domain_ownership: [
      { domain: 'branch.example.net', op: 'UPDATE', expected: { status: 'INSUFFICIENT_EVIDENCE', unitid: null }, set: { status: 'VERIFIED', unitid: null, athletics_entity_id: 'AE-X-BRANCH' }, provenance: 'test' },
      { domain: 'nontitle.example.com', op: 'INSERT', expected: { status: 'ABSENT' }, set: { status: 'VERIFIED', unitid: null, athletics_entity_id: 'AE-X-BRANCH', role: 'ATHLETICS_SITE', claimed_keys: ['x'], claimed_unitids: [] }, provenance: 'test' },
    ],
    duplicate_programme_allowlist: [],
    ...over,
  };
  f.fixture_hash = crypto.createHash('sha256').update(JSON.stringify({ entities: f.entities, assignments: f.assignments, repairs: f.repairs, domain_ownership: f.domain_ownership })).digest('hex');
  const p = path.join(dir, 'fx.json'); fs.writeFileSync(p, JSON.stringify(f)); return { p, h: f.fixture_hash };
}
function run(args) { try { return { ok: true, out: execFileSync('node', [APP, '--db', dbPath, ...args], { cwd: ROOT, encoding: 'utf8' }) }; } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; } }
const q = (sql) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare(sql).all(); d.close(); return r; };
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7d-app-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 7D identity-model applier', () => {
  it('refuses a /data path', () => { const { p, h } = fixture(); let refused = false; try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--fixture', p, '--fixture-hash', h], { cwd: ROOT, encoding: 'utf8' }); } catch (e) { refused = /Refusing production/.test((e.stdout || '') + (e.stderr || '')); } expect(refused).toBe(true); });
  it('refuses a fixture-hash mismatch', () => { const { p } = fixture(); expect(run(['--fixture', p, '--fixture-hash', 'deadbeef', '--apply']).out).toMatch(/hash mismatch/); });
  it('dry run changes nothing', () => { const { p, h } = fixture(); expect(run(['--fixture', p, '--fixture-hash', h]).out).toMatch(/DRY RUN/); expect(q("SELECT name FROM sqlite_master WHERE name='athletics_entities'")).toEqual([]); });
  it('apply builds the model, applies every proven repair, and passes the validator', () => {
    const { p, h } = fixture(); const r = run(['--fixture', p, '--fixture-hash', h, '--apply', '--manifest-out', path.join(dir, 'man.json')]);
    expect(r.ok).toBe(true); expect(r.out).toMatch(/validator hard 0/);
    expect(q('SELECT COUNT(*) n FROM athletics_entities')[0].n).toBe(3);
    expect(q('SELECT COUNT(*) n FROM colleges WHERE athletics_entity_id IS NULL')[0].n).toBe(0);
    expect(q("SELECT unitid, city, academic_rating FROM colleges WHERE id='m'")[0]).toEqual({ unitid: 100584, city: 'Righttown', academic_rating: 5 });
    expect(q("SELECT unitid FROM institution_aliases")[0].unitid).toBe(100584);
    expect(q("SELECT unitid FROM athletics_domains WHERE domain='example.org'")[0].unitid).toBe(100584);
    expect(q("SELECT active FROM colleges WHERE id='s'")[0].active).toBe(0);
    expect(q("SELECT status, athletics_entity_id FROM athletics_domains WHERE domain='branch.example.net'")[0]).toEqual({ status: 'VERIFIED', athletics_entity_id: 'AE-X-BRANCH' });
    expect(q("SELECT unitid FROM colleges WHERE id='b'")[0].unitid).toBeNull(); // no synthetic federal id written
  });
  it('is idempotent', () => { const { p, h } = fixture(); run(['--fixture', p, '--fixture-hash', h, '--apply']); const r = run(['--fixture', p, '--fixture-hash', h]); expect(r.out).toMatch(/assign 0 \(\+5 noop\) \| repairs 0 \(\+4 noop\) \| domains 0 \(\+2 noop\)/); });
  it('expected-old guard aborts with nothing changed', () => {
    const d = new Database(dbPath); d.prepare("UPDATE colleges SET city='Elsewhere' WHERE id='m'").run(); d.close();
    const { p, h } = fixture(); const r = run(['--fixture', p, '--fixture-hash', h, '--apply']);
    expect(r.out).toMatch(/expected-old city mismatch/); expect(q("SELECT unitid FROM colleges WHERE id='m'")[0].unitid).toBe(100575);
  });
  it('refuses an entity carrying a College Navigator location code as its federal UNITID', () => {
    const f = fixture(); const j = JSON.parse(fs.readFileSync(f.p, 'utf8')); j.entities[0] = ent('AE-X-LOC', { entity_kind: 'UNRESOLVED_FEDERAL', federal_unitid: 15111102 });
    const { p, h } = fixture({ entities: j.entities }); expect(run(['--fixture', p, '--fixture-hash', h, '--apply']).out).toMatch(/not a 6-digit IPEDS UNITID/);
  });
  it('refuses a shared-platform root in domain ownership', () => {
    const f = JSON.parse(fs.readFileSync(fixture().p, 'utf8')); f.domain_ownership.push({ domain: 'prestosports.com', op: 'INSERT', expected: { status: 'ABSENT' }, set: { status: 'VERIFIED', unitid: null, athletics_entity_id: 'AE-X-BRANCH', claimed_keys: [], claimed_unitids: [] }, provenance: 'test' });
    const { p, h } = fixture({ domain_ownership: f.domain_ownership }); expect(run(['--fixture', p, '--fixture-hash', h, '--apply']).out).toMatch(/shared-platform root refused/);
  });
  it('rolls back when the result would violate the identity invariant (unexplained duplicate programme)', () => {
    const f = JSON.parse(fs.readFileSync(fixture().p, 'utf8')); f.repairs = f.repairs.filter((r) => r.op !== 'DEACTIVATE_STALE_ROW');
    const { p, h } = fixture({ repairs: f.repairs }); const r = run(['--fixture', p, '--fixture-hash', h, '--apply']);
    expect(r.out).toMatch(/ROLLED BACK[\s\S]*H6 duplicate active programme/);
    expect(q("SELECT name FROM sqlite_master WHERE name='athletics_entities'").length).toBe(0);
  });
  it('--revert restores every recorded change', () => {
    const { p, h } = fixture(); const man = path.join(dir, 'man.json'); run(['--fixture', p, '--fixture-hash', h, '--apply', '--manifest-out', man]);
    const r = run(['--revert', man, '--apply']); expect(r.out).toMatch(/REVERTED/);
    expect(q("SELECT unitid, city, active FROM colleges WHERE id IN ('m','s') ORDER BY id")).toEqual([{ unitid: 100575, city: 'Wrongtown', active: 1 }, { unitid: 100900, city: null, active: 1 }]);
    expect(q('SELECT COUNT(*) n FROM athletics_entities')[0].n).toBe(0);
    expect(q("SELECT COUNT(*) n FROM athletics_domains WHERE domain='nontitle.example.com'")[0].n).toBe(0);
    expect(q("SELECT unitid FROM athletics_domains WHERE domain='example.org'")[0].unitid).toBe(100575);
    expect(q("SELECT unitid FROM institution_aliases")[0].unitid).toBe(100575);
  });
});
