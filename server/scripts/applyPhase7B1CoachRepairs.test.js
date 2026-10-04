import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** PHASE 7B.1 coach-repair applier guards (Part Q). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase7B1CoachRepairs.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER);
    CREATE TABLE coaches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, full_name TEXT, email TEXT, school TEXT, division TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, email_confirmed_at TEXT, source TEXT, currentness_status TEXT, currentness_checked_at TEXT, currentness_source_url TEXT, currentness_reason TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
    CREATE UNIQUE INDEX idx_coaches_identity ON coaches(email, school, sport);
  `);
  const p = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)');
  p.run('c1', 'Faulkner University', 'mens-soccer', 'NAIA', 101189, 1);
  p.run('c2', 'Other U', 'mens-soccer', 'NAIA', 999999, 1);
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source,currentness_status) VALUES ('leg','2020-01-01','Samfixture Testcase','samfixture@faulkner.edu','Faulkner University','mens-soccer','verified','graduating_seniors','UNKNOWN')").run();
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source,currentness_status) VALUES ('other','2020-01-01','Reuse Person','reuse@other.edu','Other U','mens-soccer','verified','legacy','UNKNOWN')").run();
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
const count = () => { const d = new Database(dbPath, { readonly: true }); const n = d.prepare('SELECT COUNT(*) n FROM coaches').get().n; d.close(); return n; };
const INS = { canonical_programme: 'Faulkner University', unitid: 101189, sport: 'mens-soccer', division: 'NAIA', role: 'Assistant', email_status: 'verified', email_seen_on_source_url: 'https://faulknereagles.com/coaches', source_url: 'https://faulknereagles.com/coaches', auto_apply_safe: true };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7b1t-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 7B.1 coach-repair applier', () => {
  it('refuses a REDACTED fixture at the door (assertUnredacted)', () => {
    const r = run({ current: [{ ...INS, name: '[name withheld — coach abc]', email: 'coach-abc@redacted.invalid' }] });
    expect(r.ok).toBe(false); expect(r.out).toMatch(/REDACTED|redacted\.invalid/);
  });
  it('1. ADD_EVIDENCE without email_seen_on_source_url is refused', () => {
    const r = run({ evidence: [{ coach_id: 'leg', expected_old_email: 'samfixture@faulkner.edu', currentness_source_url: 'https://x', auto_apply_safe: true }] });
    expect(r.ok).toBe(false); expect(coach('leg').currentness_status).toBe('UNKNOWN');
  });
  it('2/13. UPDATE_EMAIL requires source evidence AND matching expected-old', () => {
    const noEv = run({ email: [{ coach_id: 'leg', expected_old_email: 'samfixture@faulkner.edu', new_email: 'newcoach@faulkner.edu', auto_apply_safe: true }] });
    expect(noEv.ok).toBe(false);
    const badOld = run({ email: [{ coach_id: 'leg', expected_old_email: 'WRONG@faulkner.edu', new_email: 'newcoach@faulkner.edu', email_source_url: 'https://x', email_seen_on_source_url: 'https://x', auto_apply_safe: true }] });
    expect(badOld.ok).toBe(false); expect(coach('leg').email).toBe('samfixture@faulkner.edu');
  });
  it('2b. a valid email correction applies with fresh evidence, confirmed_at untouched', () => {
    run({ email: [{ coach_id: 'leg', expected_old_email: 'samfixture@faulkner.edu', new_email: 'newcoach@faulkner.edu', email_source_url: 'https://faulknereagles.com/x', email_seen_on_source_url: 'https://faulknereagles.com/x', auto_apply_safe: true }] });
    const r = coach('leg'); expect(r.email).toBe('newcoach@faulkner.edu'); expect(r.currentness_status).toBe('CURRENT'); expect(r.email_seen_on_source_at).toBeTruthy(); expect(r.email_confirmed_at).toBeNull();
  });
  it('3. MARK_STALE sets PROVEN_STALE', () => {
    run({ stale: [{ coach_id: 'leg', expected_old_school: 'Faulkner University', currentness_source_url: 'https://x', auto_apply_safe: true }] });
    expect(coach('leg').currentness_status).toBe('PROVEN_STALE');
  });
  it('4. INSERT replacement does not duplicate an existing identity (idempotent skip)', () => {
    run({ current: [{ ...INS, name: 'Samfixture Testcase', email: 'samfixture@faulkner.edu' }] });
    expect(count()).toBe(2); // no new row; identity already present
  });
  it('5. INSERT is refused when the email already belongs to another institution', () => {
    const r = run({ current: [{ ...INS, name: 'Reuse Person', email: 'reuse@other.edu' }] });
    expect(r.ok).toBe(false); expect(count()).toBe(2);
  });
  it('6. INSERT is refused for a non-existent (wrong) sport/programme', () => {
    const r = run({ current: [{ ...INS, sport: 'womens-soccer', name: 'X', email: 'x@faulkner.edu' }] });
    expect(r.ok).toBe(false);
  });
  it('11. inferred email INSERT refused', () => {
    const r = run({ current: [{ ...INS, name: 'X', email: 'x@faulkner.edu', email_status: 'inferred' }] });
    expect(r.ok).toBe(false); expect(count()).toBe(2);
  });
  it('12. generic email INSERT refused', () => {
    const r = run({ current: [{ ...INS, name: 'X', email: 'soccer@faulkner.edu', email_status: 'generic' }] });
    expect(r.ok).toBe(false);
  });
  it('14. idempotent rerun of a valid insert', () => {
    run({ current: [{ ...INS, name: 'New Asst', email: 'newasst@faulkner.edu' }] });
    const r = run({ current: [{ ...INS, name: 'New Asst', email: 'newasst@faulkner.edu' }] });
    expect(r.out).toMatch(/1 already/); expect(count()).toBe(3);
  });
  it('15. rollback: a bad entry aborts the whole batch', () => {
    const r = run({ current: [{ ...INS, name: 'Good', email: 'good@faulkner.edu' }, { ...INS, name: 'Bad', email: 'bad@faulkner.edu', email_status: 'inferred' }] });
    expect(r.ok).toBe(false); expect(count()).toBe(2);
  });
  it('16. refuses a /data path', () => {
    let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--current', write('c.json', [])], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
});
