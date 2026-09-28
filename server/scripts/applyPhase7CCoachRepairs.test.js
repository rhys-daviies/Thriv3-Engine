import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 7C NAIA-tail applier guards (same guard model as 7B.5C). Same guard model as 7B.3/7B.4A, plus: generic-email
 * rejection, the outside-target guard (--targets), and the source-domain-verified precondition for
 * INSERT_CURRENT / ADD_EVIDENCE. No DOMAIN_REPAIR op exists here. Synthetic RFC 2606 domains only.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase7CCoachRepairs.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT, claimed_keys TEXT, claimed_unitids TEXT, verification_method TEXT, confidence TEXT, checked_at TEXT);
    CREATE TABLE coaches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, full_name TEXT, email TEXT, school TEXT, division TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, email_confirmed_at TEXT, source TEXT, currentness_status TEXT, currentness_checked_at TEXT, currentness_source_url TEXT, currentness_reason TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
    CREATE UNIQUE INDEX idx_coaches_identity ON coaches(email, school, sport);
  `);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)').run('c1', 'Example College', 'mens-soccer', 'NAIA', 900001, 1);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)').run('c2', 'Other College', 'womens-soccer', 'NAIA', 900002, 1);
  db.prepare("INSERT INTO athletics_domains VALUES ('example.com', 900001, 'VERIFIED', '[\"Example\"]', '[900001]', 'X', 'HIGH', '2026-01-01')").run();
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source,currentness_status,email_source_url) VALUES ('leg','2020-01-01','Legacy Coach','l.legacy@example.com','Example College','mens-soccer','verified','legacy',NULL,'https://example.com/x')").run();
  db.close();
}
const write = (name, entries) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify({ entries })); return p; };
function run(fixtures, { apply = true, targets } = {}) {
  const args = ['--db', dbPath];
  for (const [flag, entries] of Object.entries(fixtures)) args.push(`--${flag}`, write(`${flag}.json`, entries));
  if (targets) { const p = path.join(dir, 'targets.json'); fs.writeFileSync(p, JSON.stringify({ keys: targets })); args.push('--targets', p); }
  if (apply) args.push('--apply');
  try { return { ok: true, out: execFileSync('node', [APP, ...args], { cwd: ROOT, encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}
const coach = (id) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare('SELECT * FROM coaches WHERE id=?').get(id); d.close(); return r; };
const coachBy = (email, school, sport) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare('SELECT * FROM coaches WHERE email=? AND school=? AND sport=?').get(email, school, sport); d.close(); return r; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7c-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

const INSERT = { canonical_programme: 'Example College', sport: 'mens-soccer', unitid: 900001, name: 'New Coach', role: 'Head Coach', email: 'new.l.legacy@example.com', email_status: 'verified', email_source_url: 'https://example.com/staff', email_source_domain: 'example.com', email_seen_on_source_url: 'https://example.com/staff', email_seen_on_source_at: '2026-09-28', auto_apply_safe: true };

describe('Phase 7C NAIA-tail applier', () => {
  it('refuses a /data path', () => {
    let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--evidence', write('e.json', [])], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
  it('refuses a REDACTED fixture at the door', () => {
    expect(run({ evidence: [{ coach_id: 'leg', email_seen_on_source_url: 'coach-x@redacted.invalid', auto_apply_safe: true }] }).ok).toBe(false);
  });
  it('ADD_EVIDENCE sets CURRENT + email_seen when source domain is verified to the unitid', () => {
    const r = run({ evidence: [{ coach_id: 'leg', unitid: 900001, email_source_domain: 'example.com', currentness_source_url: 'https://example.com/staff', email_seen_on_source_url: 'https://example.com/staff', email_seen_on_source_at: '2026-09-28', auto_apply_safe: true }] });
    expect(r.ok).toBe(true);
    const c = coach('leg'); expect(c.currentness_status).toBe('CURRENT'); expect(c.email).toBe('l.legacy@example.com'); expect(c.email_confirmed_at).toBeNull();
  });
  it('ADD_EVIDENCE refused when source domain is NOT verified to the unitid', () => {
    const r = run({ evidence: [{ coach_id: 'leg', unitid: 900001, email_source_domain: 'unverified.example', email_seen_on_source_url: 'https://x', auto_apply_safe: true }] });
    expect(r.ok).toBe(false); expect(coach('leg').currentness_status).toBeNull();
  });
  it('INSERT_CURRENT adds a current staff member with verified source domain', () => {
    const r = run({ current: [INSERT] });
    expect(r.ok).toBe(true);
    const c = coachBy('new.l.legacy@example.com', 'Example College', 'mens-soccer');
    expect(c).toBeTruthy(); expect(c.currentness_status).toBe('CURRENT'); expect(c.email_status).toBe('verified');
  });
  it('INSERT_CURRENT refuses a generic email', () => {
    const r = run({ current: [{ ...INSERT, email: 'soccer@example.com' }] });
    expect(r.ok).toBe(false); expect(r.out).toMatch(/generic/);
  });
  it('INSERT_CURRENT refuses an outside-target programme', () => {
    const r = run({ current: [INSERT] }, { targets: ['900002|womens-soccer'] });
    expect(r.ok).toBe(false); expect(r.out).toMatch(/outside target/);
  });
  it('INSERT_CURRENT allows an in-target programme', () => {
    const r = run({ current: [INSERT] }, { targets: ['900001|mens-soccer'] });
    expect(r.ok).toBe(true);
  });
  it('CORRECT_EMAIL updates to the exact current published email (verified)', () => {
    const r = run({ email: [{ coach_id: 'leg', unitid: 900001, expected_old_email: 'l.legacy@example.com', new_email: 'l.l.legacy@example.com', email_source_url: 'https://example.com/staff', email_seen_on_source_url: 'https://example.com/staff', auto_apply_safe: true }] });
    expect(r.ok).toBe(true);
    const c = coach('leg'); expect(c.email).toBe('l.l.legacy@example.com'); expect(c.email_status).toBe('verified');
  });
  it('MARK_STALE marks a departed row', () => {
    const r = run({ stale: [{ coach_id: 'leg', expected_old_school: 'Example College', evidence_rationale: 'departed', auto_apply_safe: true }] });
    expect(r.ok).toBe(true); expect(coach('leg').currentness_status).toBe('PROVEN_STALE');
  });
  it('CORRECT_NAME needs matching expected-old name', () => {
    const bad = run({ name: [{ coach_id: 'leg', expected_old_name: 'Wrong', new_name: 'Right', evidence_url: 'https://x', auto_apply_safe: true }] });
    expect(bad.ok).toBe(false);
    const ok = run({ name: [{ coach_id: 'leg', expected_old_name: 'Legacy Coach', new_name: 'Legacy Coach Jr', evidence_url: 'https://example.com/bio', auto_apply_safe: true }] });
    expect(ok.ok).toBe(true); expect(coach('leg').full_name).toBe('Legacy Coach Jr');
  });
  it('rollback: one bad entry aborts the batch', () => {
    const r = run({ current: [INSERT], email: [{ coach_id: 'leg', expected_old_email: 'WRONG@x', new_email: 'x@example.com', email_source_url: 'https://x', email_seen_on_source_url: 'https://x', auto_apply_safe: true }] });
    expect(r.ok).toBe(false);
    expect(coachBy('new.l.legacy@example.com', 'Example College', 'mens-soccer')).toBeUndefined();
  });
  it('idempotent: an INSERT already present is a noop, not a duplicate', () => {
    run({ current: [INSERT] });
    const r = run({ current: [INSERT] });
    expect(r.ok).toBe(true);
    const d = new Database(dbPath, { readonly: true });
    const n = d.prepare('SELECT count(*) n FROM coaches WHERE email=?').get('new.l.legacy@example.com').n;
    d.close();
    expect(n).toBe(1);
  });
});

describe('Phase 7C provenance', () => {
  it('tags inserts with source=phase7c_naia_tail', () => {
    const r = run({ current: [INSERT] });
    expect(r.ok).toBe(true);
    const row = coachBy('new.l.legacy@example.com', 'Example College', 'mens-soccer');
    expect(row.source).toBe('phase7c_naia_tail');
    expect(row.currentness_status).toBe('CURRENT');
  });
});
