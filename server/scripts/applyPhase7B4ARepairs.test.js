import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 7B.4A exception-closure applier guards (Part L). Same guard model as 7B.1/7B.3, plus the
 * two new ops the exception cases required: CORRECT_NAME (identity guard) and DOMAIN_REPAIR
 * (one-to-one guard), and CORRECT_EMAIL's promotion of a confirmed address to verified.
 * Synthetic fixtures use RFC 2606 reserved domains only.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase7B4ARepairs.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT, notes TEXT);
    CREATE TABLE coaches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, full_name TEXT, email TEXT, school TEXT, division TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, email_confirmed_at TEXT, source TEXT, currentness_status TEXT, currentness_checked_at TEXT, currentness_source_url TEXT, currentness_reason TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
    CREATE UNIQUE INDEX idx_coaches_identity ON coaches(email, school, sport);
  `);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)').run('c1', 'Example College', 'mens-soccer', 'NAIA', 900001, 1);
  db.prepare("INSERT INTO athletics_domains VALUES ('exampleathletics.com', 900001, 'VERIFIED', null)").run();
  db.prepare("INSERT INTO athletics_domains VALUES ('taken.example', 900002, 'VERIFIED', null)").run();
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source,currentness_status,email_source_url) VALUES ('leg','2020-01-01','Wrong Name','coach@example.com','Example College','mens-soccer','verified','legacy','UNKNOWN','https://exampleathletics.com/x')").run();
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source,currentness_status,email_source_url) VALUES ('inf','2020-01-01','Inferred Coach','guess@example.com','Example College','mens-soccer','inferred','legacy','UNKNOWN','https://exampleathletics.com/y')").run();
  db.close();
}
const write = (name, entries) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify({ entries })); return p; };
function run(fixtures, apply = true) {
  const args = ['--db', dbPath];
  for (const [flag, entries] of Object.entries(fixtures)) args.push(`--${flag}`, write(`${flag}.json`, entries));
  if (apply) args.push('--apply');
  try { return { ok: true, out: execFileSync('node', [APP, ...args], { cwd: ROOT, encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}
const coach = (id) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare('SELECT * FROM coaches WHERE id=?').get(id); d.close(); return r; };
const domain = (dm) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare('SELECT * FROM athletics_domains WHERE lower(domain)=?').get(dm); d.close(); return r; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7b4a-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 7B.4A exception applier', () => {
  it('refuses a REDACTED fixture at the door', () => {
    expect(run({ evidence: [{ coach_id: 'leg', email_seen_on_source_url: 'coach-x@redacted.invalid', auto_apply_safe: true }] }).ok).toBe(false);
  });
  it('CORRECT_NAME applies with matching expected-old name', () => {
    run({ name: [{ coach_id: 'leg', expected_old_name: 'Wrong Name', new_name: 'Right Name', new_role: 'Head Coach', evidence_url: 'https://exampleathletics.com/bio', auto_apply_safe: true }] });
    const r = coach('leg'); expect(r.full_name).toBe('Right Name'); expect(r.position_title).toBe('Head Coach'); expect(r.email).toBe('coach@example.com');
  });
  it('CORRECT_NAME is refused on expected-old-name mismatch', () => {
    const r = run({ name: [{ coach_id: 'leg', expected_old_name: 'Different Name', new_name: 'Right Name', evidence_url: 'https://x', auto_apply_safe: true }] });
    expect(r.ok).toBe(false); expect(coach('leg').full_name).toBe('Wrong Name');
  });
  it('CORRECT_NAME requires evidence_url', () => {
    expect(run({ name: [{ coach_id: 'leg', expected_old_name: 'Wrong Name', new_name: 'Right Name', auto_apply_safe: true }] }).ok).toBe(false);
  });
  it('CORRECT_EMAIL promotes an inferred address to verified with evidence', () => {
    run({ email: [{ coach_id: 'inf', expected_old_email: 'guess@example.com', new_email: 'real@example.com', email_source_url: 'https://exampleathletics.com/z', email_seen_on_source_url: 'https://exampleathletics.com/z', auto_apply_safe: true }] });
    const r = coach('inf'); expect(r.email).toBe('real@example.com'); expect(r.email_status).toBe('verified'); expect(r.currentness_status).toBe('CURRENT'); expect(r.email_confirmed_at).toBeNull();
  });
  it('ADD_EVIDENCE sets CURRENT + email_seen, email untouched', () => {
    run({ evidence: [{ coach_id: 'leg', expected_old_email: 'coach@example.com', currentness_source_url: 'https://x', email_seen_on_source_url: 'https://x', email_seen_on_source_at: '2026-09-28', auto_apply_safe: true }] });
    const r = coach('leg'); expect(r.currentness_status).toBe('CURRENT'); expect(r.email).toBe('coach@example.com'); expect(r.email_confirmed_at).toBeNull();
  });
  it('DOMAIN_REPAIR registers a new one-to-one mapping', () => {
    run({ domain: [{ domain: 'newhost.example', unitid: 900001, new_status: 'VERIFIED_ALIAS', expected_old_status: 'ABSENT', evidence_url: 'https://exampleathletics.com/proof', auto_apply_safe: true }] });
    const d = domain('newhost.example'); expect(d).toBeTruthy(); expect(d.unitid).toBe(900001); expect(d.status).toBe('VERIFIED_ALIAS');
  });
  it('DOMAIN_REPAIR refuses to overwrite a domain mapped to a DIFFERENT unitid (one-to-one guard)', () => {
    const r = run({ domain: [{ domain: 'taken.example', unitid: 900001, new_status: 'VERIFIED', evidence_url: 'https://x', auto_apply_safe: true }] });
    expect(r.ok).toBe(false); expect(domain('taken.example').unitid).toBe(900002);
  });
  it('DOMAIN_REPAIR refuses on expected-old-status mismatch', () => {
    const r = run({ domain: [{ domain: 'newhost2.example', unitid: 900001, new_status: 'VERIFIED', expected_old_status: 'VERIFIED', evidence_url: 'https://x', auto_apply_safe: true }] });
    expect(r.ok).toBe(false); expect(domain('newhost2.example')).toBeUndefined();
  });
  it('rollback: a bad entry aborts the whole batch', () => {
    const r = run({ name: [{ coach_id: 'leg', expected_old_name: 'Wrong Name', new_name: 'Right Name', evidence_url: 'https://x', auto_apply_safe: true }], domain: [{ domain: 'taken.example', unitid: 900001, new_status: 'VERIFIED', evidence_url: 'https://x', auto_apply_safe: true }] });
    expect(r.ok).toBe(false); expect(coach('leg').full_name).toBe('Wrong Name');
  });
  it('refuses a /data path', () => {
    let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--name', write('n.json', [])], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
});
