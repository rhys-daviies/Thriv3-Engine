import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 6C.3 — true CORE acquisition applier guards. Proves acquisition inserts only
 * current, exact-email, canonical-active-programme records; never a duplicate person/
 * email, an inferred/generic email, an inactive/invalid/ambiguous programme, or an
 * UNKNOWN-currentness record; email_confirmed_at stays NULL; expected-absence,
 * idempotency, rollback, /data refusal and no-programme-mutation all hold; and a
 * source-fallout programme (0 existing coaches) is acquired like any other.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase6C3Acquisition.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER);
    CREATE TABLE coaches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, full_name TEXT, email TEXT, school TEXT, division TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, email_confirmed_at TEXT, source TEXT, currentness_status TEXT, currentness_checked_at TEXT, currentness_source_url TEXT, currentness_reason TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
    CREATE UNIQUE INDEX idx_coaches_identity ON coaches(email, school, sport);
  `);
  const p = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)');
  p.run('p1', 'Gap U', 'womens-soccer', 'NCAA D3', 555, 1);           // active target
  p.run('p2', 'Inactive U', 'womens-soccer', 'NCAA D3', 556, 0);      // inactive
  p.run('p3', 'Other U', 'womens-soccer', 'NCAA D3', 557, 1);         // holds a pre-existing coach
  p.run('p4', 'Held Campus', 'womens-soccer', 'NCAA D2', 498562, 1);  // held/ambiguous unitid
  p.run('p5', 'Fallout U', 'womens-soccer', 'NCAA D3', 558, 1);       // source-fallout: 0 coaches
  // pre-existing coach at a DIFFERENT institution, email we will test reuse of
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source) VALUES ('x','2020-01-01','Jane Reuse','reuse@other.edu','Other U','womens-soccer','verified','legacy')").run();
  db.close();
}
const base = { canonical_programme: 'Gap U', unitid: 555, sport: 'womens-soccer', division: 'NCAA D3', role: 'Head Coach', email_status: 'verified', currentness_status: 'CURRENT', source_url: 'https://gapu.edu/coaches', email_source_url: 'https://gapu.edu/coaches', email_seen_on_source_url: 'https://gapu.edu/coaches', auto_apply_safe: true };
function fx(entries) { const p = path.join(dir, 'acq.json'); fs.writeFileSync(p, JSON.stringify({ entries })); return p; }
function run(entries, apply = true) { try { const out = execFileSync('node', [APP, '--db', dbPath, '--fixture', fx(entries), ...(apply ? ['--apply'] : [])], { cwd: ROOT, encoding: 'utf8' }); return { ok: true, out }; } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; } }
const count = () => { const d = new Database(dbPath, { readonly: true }); const n = d.prepare('SELECT COUNT(*) n FROM coaches').get().n; d.close(); return n; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6c3t-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 6C.3 acquisition applier', () => {
  it('inserts a valid acquisition with full provenance and NULL email_confirmed_at', () => {
    run([{ ...base, name: 'Amy Coach', email: 'amy@gapu.edu' }]);
    const d = new Database(dbPath, { readonly: true });
    const r = d.prepare("SELECT * FROM coaches WHERE email='amy@gapu.edu'").get(); d.close();
    expect(r.currentness_status).toBe('CURRENT');
    expect(r.email_seen_on_source_at).toBeTruthy();
    expect(r.email_confirmed_at).toBeNull();
    expect(r.source).toBe('phase6c3_core_acquisition');
  });
  it('1. prevents a duplicate person (same email already at another institution)', () => {
    const r = run([{ ...base, name: 'Jane Reuse', email: 'reuse@other.edu' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('2. prevents a duplicate email at the same programme (idempotent skip, no second row)', () => {
    run([{ ...base, name: 'Amy Coach', email: 'amy@gapu.edu' }]);
    const r = run([{ ...base, name: 'Amy Coach', email: 'amy@gapu.edu' }]);
    expect(r.out).toMatch(/1 already/); expect(count()).toBe(2);
  });
  it('3. rejects an inactive programme', () => {
    const r = run([{ ...base, canonical_programme: 'Inactive U', unitid: 556, name: 'A', email: 'a@inactive.edu' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('4. rejects a null/invalid UNITID', () => {
    const r = run([{ ...base, unitid: null, name: 'A', email: 'a@gapu.edu' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('5. rejects a held/ambiguous programme unitid', () => {
    const r = run([{ ...base, canonical_programme: 'Held Campus', unitid: 498562, division: 'NCAA D2', name: 'A', email: 'a@held.edu' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('6. rejects an inferred email', () => {
    const r = run([{ ...base, name: 'A', email: 'a@gapu.edu', email_status: 'inferred' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('7. rejects a generic email', () => {
    const r = run([{ ...base, name: 'A', email: 'soccer@gapu.edu', email_status: 'generic' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('8. a consumer email inserts only when published/verified; generic-status consumer is refused', () => {
    run([{ ...base, name: 'Coach Gmail', email: 'coachgmail@gmail.com', email_status: 'verified' }]);
    expect(count()).toBe(2);
    const r = run([{ ...base, name: 'Coach Gmail2', email: 'coach2@gmail.com', email_status: 'generic' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(2);
  });
  it('9. rejects UNKNOWN currentness', () => {
    const r = run([{ ...base, name: 'A', email: 'a@gapu.edu', currentness_status: 'UNKNOWN' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('10/11. expected-absence + idempotent rerun', () => {
    run([{ ...base, name: 'Amy Coach', email: 'amy@gapu.edu' }]);
    const r = run([{ ...base, name: 'Amy Coach', email: 'amy@gapu.edu' }]);
    expect(r.out).toMatch(/1 already/); expect(count()).toBe(2);
  });
  it('12. rolls back the whole batch if any entry fails', () => {
    const r = run([{ ...base, name: 'Good', email: 'good@gapu.edu' }, { ...base, name: 'Bad', email: 'bad@gapu.edu', email_status: 'inferred' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('13. refuses a production /data path', () => {
    let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--fixture', fx([])], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
  it('14. does not mutate programme structure', () => {
    const before = new Database(dbPath, { readonly: true }); const b = before.prepare('SELECT * FROM colleges ORDER BY id').all(); before.close();
    run([{ ...base, name: 'Amy Coach', email: 'amy@gapu.edu' }]);
    const after = new Database(dbPath, { readonly: true }); const a = after.prepare('SELECT * FROM colleges ORDER BY id').all(); after.close();
    expect(a).toEqual(b);
  });
  it('15. handles a source-fallout programme (0 existing coaches) as a normal acquisition', () => {
    run([{ ...base, canonical_programme: 'Fallout U', unitid: 558, name: 'New Head', email: 'head@fallout.edu' }]);
    const d = new Database(dbPath, { readonly: true });
    const r = d.prepare("SELECT * FROM coaches WHERE school='Fallout U'").get(); d.close();
    expect(r.email).toBe('head@fallout.edu');
    expect(r.source).toBe('phase6c3_core_acquisition');
  });
  it('skips entries marked auto_apply_safe:false', () => {
    run([{ ...base, name: 'Held', email: 'held@gapu.edu', auto_apply_safe: false }]);
    expect(count()).toBe(1);
  });
});
