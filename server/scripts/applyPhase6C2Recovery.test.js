import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 6C.2 — mis-filed-record recovery applier guards. Proves same-name collisions
 * (Bethany WV vs KS, UAH vs Utah) reassign the existing row to the canonical target
 * only under expected-old-value guards; held/ambiguous targets are refused; no
 * duplicate is created; idempotent; rollback; /data refusal.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase6C2Recovery.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER);
    CREATE TABLE coaches (id TEXT PRIMARY KEY, full_name TEXT, email TEXT, school TEXT, division TEXT, sport TEXT, position_title TEXT, email_source_url TEXT, email_confirmed_at TEXT, currentness_status TEXT, currentness_checked_at TEXT, currentness_source_url TEXT, currentness_reason TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
  `);
  const p = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)');
  p.run('c1', 'Bethany (WV)', 'mens-soccer', 'NCAA D3', 237181, 1);   // correct target
  p.run('c2', 'Bethany (KS)', 'mens-soccer', 'NAIA', 154721, 1);      // wrong stored
  p.run('c3', 'Campus Merged', 'womens-soccer', 'NCAA D2', 498562, 1); // held campus-collision unitid
  db.prepare("INSERT INTO coaches (id,full_name,email,school,sport) VALUES ('w','Sam Fixture','sam.fixture@bethanywv.edu','Bethany (KS)','mens-soccer')").run();
  db.close();
}
const base = { coach_id: 'w', expected_old_school: 'Bethany (KS)', expected_old_sport: 'mens-soccer', expected_old_email: 'sam.fixture@bethanywv.edu', proposed_school: 'Bethany (WV)', proposed_unitid: 237181, proposed_sport: 'mens-soccer', proposed_division: 'NCAA D3', proposed_email: 'sam.fixture@bethanywv.edu', current_source_url: 'https://bethanybison.com/coaches', email_source_url: 'https://bethanybison.com/coaches', auto_apply_safe: true };
function fx(entries) { const p = path.join(dir, 'r.json'); fs.writeFileSync(p, JSON.stringify({ entries })); return p; }
function run(entries, apply = true) { try { const out = execFileSync('node', [APP, '--db', dbPath, '--recovery', fx(entries), ...(apply ? ['--apply'] : [])], { cwd: ROOT, encoding: 'utf8' }); return { ok: true, out }; } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; } }
const wolf = () => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare("SELECT * FROM coaches WHERE id='w'").get(); d.close(); return r; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6c2t-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 6C.2 recovery applier', () => {
  it('reassigns the mis-filed Bethany-KS row to Bethany-WV with fresh evidence, confirmed_at NULL', () => {
    run([base]);
    const r = wolf();
    expect(r.school).toBe('Bethany (WV)');
    expect(r.currentness_status).toBe('CURRENT');
    expect(r.email_seen_on_source_at).toBeTruthy();
    expect(r.email_confirmed_at).toBeNull();
  });
  it('will not touch the row on an expected-old-value mismatch', () => {
    const r = run([{ ...base, expected_old_email: 'someone.else@bethanywv.edu' }]);
    expect(r.ok).toBe(false);
    expect(wolf().school).toBe('Bethany (KS)');
  });
  it('refuses a held campus-collision / ambiguous target unitid', () => {
    const r = run([{ ...base, proposed_school: 'Campus Merged', proposed_unitid: 498562, proposed_sport: 'womens-soccer' }]);
    expect(r.ok).toBe(false);
    expect(wolf().school).toBe('Bethany (KS)');
  });
  it('does not apply held (auto_apply_safe:false) entries', () => {
    run([{ ...base, auto_apply_safe: false }]);
    expect(wolf().school).toBe('Bethany (KS)');
  });
  it('prevents a duplicate: blocks reassignment that would collide at the target', () => {
    const d = new Database(dbPath); d.prepare("INSERT INTO coaches (id,full_name,email,school,sport) VALUES ('dup','Sam Fixture','sam.fixture@bethanywv.edu','Bethany (WV)','mens-soccer')").run(); d.close();
    const r = run([base]);
    expect(r.ok).toBe(false);
    expect(wolf().school).toBe('Bethany (KS)');
  });
  it('is idempotent', () => {
    run([base]);
    const r = run([base]);
    expect(r.out).toMatch(/1 already/);
  });
  it('rolls back the batch if any entry fails', () => {
    const r = run([base, { ...base, coach_id: 'w', expected_old_school: 'WRONG' }]);
    expect(r.ok).toBe(false);
    expect(wolf().school).toBe('Bethany (KS)');
  });
  it('refuses a production /data path', () => {
    let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--recovery', fx([])], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
});
