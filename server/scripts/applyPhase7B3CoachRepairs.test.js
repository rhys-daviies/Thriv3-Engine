import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 7B.3 coach-repair applier guards (Part T). Mirrors the 7B.1 pilot applier
 * (identical guard model) and adds the failure modes newly exercised at rollout scale:
 * the `phase7b3_naia_tier1` provenance tag, the EXISTING_DUAL_ROLE same-school/other-sport
 * insert, and the same-email-different-institution block.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase7B3CoachRepairs.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER);
    CREATE TABLE coaches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, full_name TEXT, email TEXT, school TEXT, division TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, email_confirmed_at TEXT, source TEXT, currentness_status TEXT, currentness_checked_at TEXT, currentness_source_url TEXT, currentness_reason TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
    CREATE UNIQUE INDEX idx_coaches_identity ON coaches(email, school, sport);
  `);
  const p = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)');
  p.run('c1', 'Nelson University', 'mens-soccer', 'NAIA', 228325, 1);
  p.run('c2', 'Nelson University', 'womens-soccer', 'NAIA', 228325, 1);
  p.run('c3', 'Other U', 'mens-soccer', 'NAIA', 999999, 1);
  // Synthetic fixtures use RFC 2606 reserved domains only — never a real institution domain.
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source,currentness_status) VALUES ('leg','2020-01-01','Legacy Coach','legacy@example.com','Nelson University','mens-soccer','verified','graduating_seniors','UNKNOWN')").run();
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source,currentness_status) VALUES ('dual','2020-01-01','Dual Role','dual@example.com','Nelson University','mens-soccer','verified','legacy','CURRENT')").run();
  db.prepare("INSERT INTO coaches (id,created_at,full_name,email,school,sport,email_status,source,currentness_status) VALUES ('other','2020-01-01','Reuse Person','reuse@example.net','Other U','mens-soccer','verified','legacy','UNKNOWN')").run();
  db.close();
}
const write = (name, entries) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify({ entries })); return p; };
function run(fixtures, apply = true, batch = 'T') {
  const args = ['--db', dbPath, '--batch', batch];
  for (const [flag, entries] of Object.entries(fixtures)) args.push(`--${flag}`, write(`${flag}.json`, entries));
  if (apply) args.push('--apply');
  try { return { ok: true, out: execFileSync('node', [APP, ...args], { cwd: ROOT, encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}
const coach = (id) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare('SELECT * FROM coaches WHERE id=?').get(id); d.close(); return r; };
const rows = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare(sql).all(...a); d.close(); return r; };
const count = () => rows('SELECT id FROM coaches').length;
const INS = { canonical_programme: 'Nelson University', unitid: 228325, sport: 'mens-soccer', division: 'NAIA', role: 'Assistant', email_status: 'verified', email_seen_on_source_url: 'https://nelsonlions.com/coaches', source_url: 'https://nelsonlions.com/coaches', auto_apply_safe: true };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7b3t-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 7B.3 coach-repair applier', () => {
  it('refuses a REDACTED fixture at the door', () => {
    const r = run({ current: [{ ...INS, name: '[withheld]', email: 'coach-abc@redacted.invalid' }] });
    expect(r.ok).toBe(false); expect(r.out).toMatch(/REDACTED|redacted\.invalid/);
  });
  it('ADD_EVIDENCE without email_seen_on_source_url is refused', () => {
    const r = run({ evidence: [{ coach_id: 'leg', currentness_source_url: 'https://x', auto_apply_safe: true }] });
    expect(r.ok).toBe(false); expect(coach('leg').currentness_status).toBe('UNKNOWN');
  });
  it('a valid ADD_EVIDENCE sets CURRENT + email_seen, leaves email + confirmed_at untouched', () => {
    run({ evidence: [{ coach_id: 'leg', expected_old_email: 'legacy@example.com', currentness_source_url: 'https://nelsonlions.com/x', email_seen_on_source_url: 'https://nelsonlions.com/x', email_seen_on_source_at: '2026-09-28', auto_apply_safe: true }] });
    const r = coach('leg'); expect(r.currentness_status).toBe('CURRENT'); expect(r.email).toBe('legacy@example.com'); expect(r.email_seen_on_source_url).toBeTruthy(); expect(r.email_confirmed_at).toBeNull();
  });
  it('UPDATE_EMAIL requires evidence and matching expected-old', () => {
    const badOld = run({ email: [{ coach_id: 'leg', expected_old_email: 'WRONG@example.com', new_email: 'new@example.com', email_source_url: 'https://x', email_seen_on_source_url: 'https://x', auto_apply_safe: true }] });
    expect(badOld.ok).toBe(false); expect(coach('leg').email).toBe('legacy@example.com');
  });
  it('MARK_STALE sets PROVEN_STALE', () => {
    run({ stale: [{ coach_id: 'leg', expected_old_school: 'Nelson University', currentness_source_url: 'https://x', auto_apply_safe: true }] });
    expect(coach('leg').currentness_status).toBe('PROVEN_STALE');
  });
  it('INSERT carries the phase7b3_naia_tier1 provenance tag', () => {
    run({ current: [{ ...INS, name: 'New Asst', email: 'newasst@example.com' }] });
    const r = rows("SELECT * FROM coaches WHERE email='newasst@example.com'")[0];
    expect(r).toBeTruthy(); expect(r.source).toBe('phase7b3_naia_tier1'); expect(r.currentness_status).toBe('CURRENT');
  });
  it('INSERT is refused when the email already belongs to ANOTHER institution', () => {
    const r = run({ current: [{ ...INS, name: 'Reuse Person', email: 'reuse@example.net' }] });
    expect(r.ok).toBe(false); expect(count()).toBe(3);
  });
  it('same-school other-sport INSERT is refused without EXISTING_DUAL_ROLE', () => {
    const r = run({ current: [{ ...INS, sport: 'womens-soccer', name: 'Dual Role', email: 'dual@example.com' }] });
    expect(r.ok).toBe(false); expect(count()).toBe(3);
  });
  it('same-school other-sport INSERT succeeds when marked EXISTING_DUAL_ROLE', () => {
    run({ current: [{ ...INS, sport: 'womens-soccer', name: 'Dual Role', email: 'dual@example.com', dedup_class: 'EXISTING_DUAL_ROLE' }] });
    const w = rows("SELECT * FROM coaches WHERE email='dual@example.com' AND sport='womens-soccer'");
    expect(w.length).toBe(1); expect(w[0].source).toBe('phase7b3_naia_tier1'); expect(count()).toBe(4);
  });
  it('inferred / generic email INSERT refused', () => {
    expect(run({ current: [{ ...INS, name: 'X', email: 'x@example.com', email_status: 'inferred' }] }).ok).toBe(false);
    expect(run({ current: [{ ...INS, name: 'Y', email: 'soccer@example.com', email_status: 'generic' }] }).ok).toBe(false);
    expect(count()).toBe(3);
  });
  it('idempotent rerun of a valid insert adds no duplicate', () => {
    run({ current: [{ ...INS, name: 'New Asst', email: 'newasst@example.com' }] });
    const r = run({ current: [{ ...INS, name: 'New Asst', email: 'newasst@example.com' }] });
    expect(r.out).toMatch(/1 already/); expect(count()).toBe(4);
  });
  it('rollback: a bad entry aborts the whole batch', () => {
    const r = run({ current: [{ ...INS, name: 'Good', email: 'good@example.com' }, { ...INS, name: 'Bad', email: 'bad@example.com', email_status: 'inferred' }] });
    expect(r.ok).toBe(false); expect(count()).toBe(3);
  });
  it('refuses a /data path', () => {
    let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--batch', 'T', '--current', write('c.json', [])], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
});
