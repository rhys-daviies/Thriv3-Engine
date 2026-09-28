import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 6C.4 — domain-repair applier guards. Proves proven one-to-one corrections
 * update athletics_domains under expected-old-value guards; SHARED_PLATFORM/held
 * entries and invalid unitids are refused; no coach/programme mutation; idempotent;
 * rollback; /data refusal. Eligibility itself is proven in the reconcile integration test.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase6C4DomainRepairs.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER);
    CREATE TABLE athletics_domains (domain TEXT PRIMARY KEY, unitid INTEGER, status TEXT, wrong_mappings TEXT, notes TEXT, checked_at TEXT);
    CREATE TABLE coaches (id TEXT PRIMARY KEY, full_name TEXT, school TEXT, sport TEXT, email TEXT);
  `);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)').run('c1', 'Ozarks (AR)', 'mens-soccer', 'NCAA D3', 107558, 1);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)').run('c2', 'Simpson College', 'womens-soccer', 'NCAA D3', 154350, 1);
  db.prepare("INSERT INTO athletics_domains (domain,unitid,status,wrong_mappings) VALUES ('uofoathletics.com',107558,'WRONG_INSTITUTION','[{\"key\":\"Ozarks (MO)\",\"claimantUnitid\":178697}]')").run();
  db.prepare("INSERT INTO athletics_domains (domain,unitid,status) VALUES ('simpsonathletics.com',NULL,'INSUFFICIENT_EVIDENCE')").run();
  db.prepare("INSERT INTO coaches VALUES ('x','A Coach','Ozarks (AR)','mens-soccer','a@ozarks.edu')").run();
  db.close();
}
const uofo = { domain: 'uofoathletics.com', expected_status: 'WRONG_INSTITUTION', expected_unitid: 107558, proposed_status: 'VERIFIED', proposed_unitid: 107558, auto_apply_safe: true };
const simp = { domain: 'simpsonathletics.com', expected_status: 'INSUFFICIENT_EVIDENCE', expected_unitid: null, proposed_status: 'VERIFIED', proposed_unitid: 154350, auto_apply_safe: true };
function fx(entries) { const p = path.join(dir, 'd.json'); fs.writeFileSync(p, JSON.stringify({ entries })); return p; }
function run(entries, apply = true) { try { const out = execFileSync('node', [APP, '--db', dbPath, '--fixture', fx(entries), ...(apply ? ['--apply'] : [])], { cwd: ROOT, encoding: 'utf8' }); return { ok: true, out }; } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; } }
const get = (d) => { const D = new Database(dbPath, { readonly: true }); const r = D.prepare('SELECT unitid,status FROM athletics_domains WHERE domain=?').get(d); D.close(); return r; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6c4t-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 6C.4 domain-repair applier', () => {
  it('corrects a WRONG_INSTITUTION domain to VERIFIED with the right unitid (uofoathletics.com regression)', () => {
    run([uofo]);
    expect(get('uofoathletics.com')).toEqual({ unitid: 107558, status: 'VERIFIED' });
  });
  it('corrects an INSUFFICIENT_EVIDENCE/null domain to VERIFIED', () => {
    run([simp]);
    expect(get('simpsonathletics.com')).toEqual({ unitid: 154350, status: 'VERIFIED' });
  });
  it('5. aborts on an expected-old status mismatch', () => {
    const r = run([{ ...uofo, expected_status: 'VERIFIED' }]);
    expect(r.ok).toBe(false); expect(get('uofoathletics.com').status).toBe('WRONG_INSTITUTION');
  });
  it('7. aborts on an unexpected old-unitid collision', () => {
    const r = run([{ ...uofo, expected_unitid: 999999 }]);
    expect(r.ok).toBe(false); expect(get('uofoathletics.com').status).toBe('WRONG_INSTITUTION');
  });
  it('6. refuses a proposed unitid that is not a real institution', () => {
    const r = run([{ ...uofo, proposed_unitid: 424242 }]);
    expect(r.ok).toBe(false); expect(get('uofoathletics.com').status).toBe('WRONG_INSTITUTION');
  });
  it('4. does not apply a held (auto_apply_safe:false) shared-platform/ambiguous entry', () => {
    run([{ ...simp, auto_apply_safe: false }]);
    expect(get('simpsonathletics.com').status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('refuses to insert an absent domain unless allow_insert', () => {
    const r = run([{ domain: 'newdomain.com', proposed_status: 'VERIFIED', proposed_unitid: 107558, auto_apply_safe: true }]);
    expect(r.ok).toBe(false); expect(get('newdomain.com')).toBeUndefined();
  });
  it('inserts an absent domain when allow_insert:true', () => {
    run([{ domain: 'newdomain.com', proposed_status: 'VERIFIED', proposed_unitid: 107558, allow_insert: true, auto_apply_safe: true }]);
    expect(get('newdomain.com')).toEqual({ unitid: 107558, status: 'VERIFIED' });
  });
  it('8. does not mutate any coach row', () => {
    const before = new Database(dbPath, { readonly: true }); const b = before.prepare('SELECT * FROM coaches ORDER BY id').all(); before.close();
    run([uofo, simp]);
    const after = new Database(dbPath, { readonly: true }); const a = after.prepare('SELECT * FROM coaches ORDER BY id').all(); after.close();
    expect(a).toEqual(b);
  });
  it('9. does not mutate programme structure', () => {
    const before = new Database(dbPath, { readonly: true }); const b = before.prepare('SELECT * FROM colleges ORDER BY id').all(); before.close();
    run([uofo, simp]);
    const after = new Database(dbPath, { readonly: true }); const a = after.prepare('SELECT * FROM colleges ORDER BY id').all(); after.close();
    expect(a).toEqual(b);
  });
  it('10. is idempotent', () => {
    run([uofo]);
    const r = run([uofo]);
    expect(r.out).toMatch(/1 already/);
  });
  it('11. rolls back the whole batch if any entry fails', () => {
    const r = run([simp, { ...uofo, expected_status: 'WRONG' }]);
    expect(r.ok).toBe(false);
    expect(get('simpsonathletics.com').status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('12. refuses a production /data path', () => {
    let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--fixture', fx([])], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
});
