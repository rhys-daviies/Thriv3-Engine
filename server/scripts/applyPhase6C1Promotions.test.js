import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 6C.1 — coach_seasons promotion applier guards. Proves promotions only
 * insert current, exact-email, canonical-programme records; never a duplicate
 * person/email or an inferred/generic email; email_confirmed_at stays NULL;
 * expected-absence + idempotency + rollback + /data refusal hold.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase6C1Promotions.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER);
    CREATE TABLE coaches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, full_name TEXT, email TEXT, school TEXT, division TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, email_confirmed_at TEXT, source TEXT, currentness_status TEXT, currentness_checked_at TEXT, currentness_source_url TEXT, currentness_reason TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
    CREATE UNIQUE INDEX idx_coaches_identity ON coaches(email, school, sport);
  `);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)').run('p1', 'Test U', 'womens-soccer', 'NCAA D3', 555, 1);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)').run('p2', 'Inactive U', 'womens-soccer', 'NCAA D3', 556, 0);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)').run('p3', 'Other U', 'womens-soccer', 'NCAA D3', 557, 1);
  // pre-existing coach at a DIFFERENT institution with an email we will test reuse of
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source) VALUES ('x','2020-01-01','Jane Reuse','reuse@other.edu','Other U','womens-soccer','verified','legacy')").run();
  db.close();
}
const base = { canonical_programme: 'Test U', unitid: 555, sport: 'womens-soccer', division: 'NCAA D3', role: 'Head Coach', email_status: 'verified', source_url: 'https://x.edu/coaches', email_source_url: 'https://x.edu/coaches', email_seen_on_source_url: 'https://x.edu/coaches' };
function fx(entries) { const p = path.join(dir, 'promo.json'); fs.writeFileSync(p, JSON.stringify({ entries })); return p; }
function run(entries, apply = true) { try { const out = execFileSync('node', [APP, '--db', dbPath, '--promotion', fx(entries), ...(apply ? ['--apply'] : [])], { cwd: ROOT, encoding: 'utf8' }); return { ok: true, out }; } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; } }
const count = () => { const d = new Database(dbPath, { readonly: true }); const n = d.prepare('SELECT COUNT(*) n FROM coaches').get().n; d.close(); return n; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6c1t-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 6C.1 promotion applier', () => {
  it('inserts a valid promotion with full provenance and NULL email_confirmed_at', () => {
    run([{ ...base, name: 'Amy Coach', email: 'amy@test.edu' }]);
    const d = new Database(dbPath, { readonly: true });
    const r = d.prepare("SELECT * FROM coaches WHERE email='amy@test.edu'").get(); d.close();
    expect(r.currentness_status).toBe('CURRENT');
    expect(r.email_seen_on_source_at).toBeTruthy();
    expect(r.email_confirmed_at).toBeNull();
    expect(r.source).toBe('phase6c1_coach_seasons_promotion');
  });
  it('rejects an inferred email_status (whole txn aborts)', () => {
    const r = run([{ ...base, name: 'A', email: 'a@test.edu', email_status: 'inferred' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('rejects a generic email_status', () => {
    const r = run([{ ...base, name: 'A', email: 'soccer@test.edu', email_status: 'generic' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('refuses to insert into an inactive programme', () => {
    const r = run([{ ...base, canonical_programme: 'Inactive U', unitid: 556, name: 'A', email: 'a@inactive.edu' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('requires a canonical unitid', () => {
    const r = run([{ ...base, unitid: null, name: 'A', email: 'a@test.edu' }]);
    expect(r.ok).toBe(false);
  });
  it('prevents a duplicate person by blocking an email already at another institution', () => {
    const r = run([{ ...base, name: 'Jane Reuse', email: 'reuse@other.edu' }]);
    expect(r.ok).toBe(false); expect(count()).toBe(1);
  });
  it('is idempotent — re-inserting the same identity is a no-op', () => {
    run([{ ...base, name: 'Amy Coach', email: 'amy@test.edu' }]);
    const r = run([{ ...base, name: 'Amy Coach', email: 'amy@test.edu' }]);
    expect(r.out).toMatch(/1 already/);
    expect(count()).toBe(2); // x + amy, no third
  });
  it('rolls back the whole batch if any entry fails', () => {
    const r = run([{ ...base, name: 'Good', email: 'good@test.edu' }, { ...base, name: 'Bad', email: 'bad@test.edu', email_status: 'inferred' }]);
    expect(r.ok).toBe(false);
    expect(count()).toBe(1); // neither inserted
  });
  it('refuses a production /data path', () => {
    let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--promotion', fx([])], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
});
