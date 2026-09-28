import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 6B — the guarded programme-repair applier. Proves the structural-repair
 * invariants: history is preserved (no row deleted, no coach/roster touched),
 * expected-old-value guards hold, retire == active=0, and the apply is idempotent
 * and refuses production.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APPLIER = 'server/scripts/applyPhase6BProgrammeRepairs.js';
let dir; let dbPath;

function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT PRIMARY KEY, name TEXT, sport TEXT, division TEXT, conference TEXT, unitid INTEGER, active INTEGER, updated_date TEXT);
    CREATE TABLE coaches (id TEXT, school TEXT, sport TEXT);
    CREATE TABLE coach_seasons (school TEXT, sport TEXT, season INTEGER, coach_name TEXT);
    CREATE TABLE roster_players (college_name TEXT);
  `);
  const ins = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?,?,?)');
  ins.run('p1', 'Dead U', 'mens-soccer', 'NAIA', 'X', 111, 1, null);       // -> retire
  ins.run('p2', 'Wrong Div U', 'mens-soccer', 'NAIA', 'Y', 222, 1, null);  // -> division fix
  ins.run('p3', 'Keep U', 'mens-soccer', 'NCAA D3', 'Z', 333, 1, null);    // untouched
  // history that must survive a retire
  db.prepare('INSERT INTO coaches VALUES (?,?,?)').run('c1', 'Dead U', 'mens-soccer');
  db.prepare('INSERT INTO coach_seasons VALUES (?,?,?,?)').run('Dead U', 'mens-soccer', 2025, 'Old Coach');
  db.prepare('INSERT INTO roster_players VALUES (?)').run('Dead U');
  db.close();
}
function writeFx(name, entries) { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify({ entries })); return p; }
function run(args, expectFail = false) {
  try { const out = execFileSync('node', [APPLIER, '--db', dbPath, ...args], { cwd: ROOT, encoding: 'utf8' }); return { ok: true, out }; }
  catch (e) { if (!expectFail) throw e; return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}
const col = (id) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare('SELECT * FROM colleges WHERE id=?').get(id); d.close(); return r; };
const counts = () => { const d = new Database(dbPath, { readonly: true }); const c = { coaches: d.prepare('SELECT COUNT(*) n FROM coaches').get().n, coach_seasons: d.prepare('SELECT COUNT(*) n FROM coach_seasons').get().n, roster: d.prepare('SELECT COUNT(*) n FROM roster_players').get().n, colleges: d.prepare('SELECT COUNT(*) n FROM colleges').get().n }; d.close(); return c; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6b-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 6B programme-repair applier', () => {
  it('retires via active=0 and preserves ALL history (no row/coach/roster deleted)', () => {
    const before = counts();
    const status = writeFx('s.json', [{ programme_id: 'p1', expect_name: 'Dead U', expect_active: 1, new_active: 0, reason: 'closed' }]);
    run(['--status', status, '--apply']);
    expect(col('p1').active).toBe(0);
    expect(counts()).toEqual(before); // NOTHING deleted — colleges/coaches/coach_seasons/roster all intact
  });

  it('corrects division without touching other columns', () => {
    const div = writeFx('d.json', [{ programme_id: 'p2', expect_name: 'Wrong Div U', expect_division: 'NAIA', new_division: 'NCAA D3', new_conference: 'SCAC', reason: 'wrong div' }]);
    run(['--division', div, '--apply']);
    const r = col('p2');
    expect(r.division).toBe('NCAA D3');
    expect(r.conference).toBe('SCAC');
    expect(r.active).toBe(1);
  });

  it('aborts the whole transaction on an expected-old-value mismatch (nothing changes)', () => {
    const status = writeFx('s.json', [{ programme_id: 'p1', expect_name: 'WRONG NAME', expect_active: 1, new_active: 0, reason: 'x' }]);
    const res = run(['--status', status, '--apply'], true);
    expect(res.ok).toBe(false);
    expect(col('p1').active).toBe(1); // unchanged
  });

  it('is idempotent (second apply changes nothing)', () => {
    const status = writeFx('s.json', [{ programme_id: 'p1', expect_name: 'Dead U', expect_active: 1, new_active: 0, reason: 'closed' }]);
    run(['--status', status, '--apply']);
    const r2 = run(['--status', status, '--apply']);
    expect(r2.out).toMatch(/0 to set \| 1 already/);
  });

  it('does not apply held (auto_apply_safe:false) entries', () => {
    const uni = path.join(dir, 'u.json');
    fs.writeFileSync(uni, JSON.stringify({ entries: [{ programme_id: 'p3', expect_name: 'Keep U', expect_unitid: 333, new_unitid: 999, auto_apply_safe: false, reason: 'held' }] }));
    run(['--unitid', uni, '--apply']);
    expect(col('p3').unitid).toBe(333); // held -> unchanged
  });

  it('refuses a production /data path', () => {
    let refused = false;
    try { execFileSync('node', [APPLIER, '--db', '/data/recruitmatch.sqlite'], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
});
