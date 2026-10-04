import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 7B.5B safe domain-repair applier guards. The temp athletics_domains table carries the real
 * NOT NULL columns (status, claimed_keys, claimed_unitids, verification_method, confidence, checked_at)
 * so the INSERT path is proven to populate them without weakening the schema.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase7B5BDomainRepairs.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE athletics_domains (
      domain TEXT PRIMARY KEY,
      unitid INTEGER,
      status TEXT NOT NULL,
      role TEXT,
      claimed_keys TEXT NOT NULL,
      claimed_unitids TEXT NOT NULL,
      wrong_mappings TEXT,
      evidence_kind TEXT,
      evidence_text TEXT,
      identity_method TEXT,
      identity_strength TEXT,
      platform TEXT,
      http_status INTEGER,
      final_url TEXT,
      verification_method TEXT NOT NULL,
      confidence TEXT NOT NULL,
      notes TEXT,
      checked_at TEXT NOT NULL
    );
  `);
  const ins = db.prepare(`INSERT INTO athletics_domains (domain,unitid,status,claimed_keys,claimed_unitids,verification_method,confidence,checked_at) VALUES (?,?,?,?,?,?,?,?)`);
  // unpromoted candidate: importer found the unitid but never verified
  ins.run('candidate.example', null, 'INSUFFICIENT_EVIDENCE', '["Example"]', '[900001]', 'PAGE_SELF_IDENTIFICATION', 'NONE', '2026-01-01');
  // already trusted to a DIFFERENT unitid (one-to-one guard target)
  ins.run('taken.example', 900002, 'VERIFIED', '["Other"]', '[900002]', 'PAGE_SELF_IDENTIFICATION', 'CERTAIN', '2026-01-01');
  // already at target state (idempotence target)
  ins.run('done.example', 900003, 'VERIFIED', '["Done"]', '[900003]', 'PAGE_SELF_IDENTIFICATION', 'CERTAIN', '2026-01-01');
  db.close();
}
const HELD = 'prestosports.com';
function writeFixture(entries) {
  const p = path.join(dir, 'fx.json');
  fs.writeFileSync(p, JSON.stringify({ phase: '7B.5B', entries }));
  const hash = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  return { p, hash };
}
function run(entries, { apply = true, hash, fixture } = {}) {
  const f = writeFixture(entries);
  const args = ['--db', dbPath, '--fixture', fixture || f.p, '--fixture-hash', hash || f.hash];
  if (apply) args.push('--apply');
  try { return { ok: true, out: execFileSync('node', [APP, ...args], { cwd: ROOT, encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}
const domain = (dm) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare('SELECT * FROM athletics_domains WHERE lower(domain)=?').get(dm); d.close(); return r; };
const count = () => { const d = new Database(dbPath, { readonly: true }); const n = d.prepare('SELECT count(*) n FROM athletics_domains').get().n; d.close(); return n; };

const UPD = { op: 'UPDATE', domain: 'candidate.example', unitid: 900001, new_status: 'VERIFIED', expected_old_status: 'INSUFFICIENT_EVIDENCE', expected_old_unitid: null, reason: 'verified one-to-one' };
const INS = { op: 'INSERT', domain: 'newhost.example', unitid: 900004, new_status: 'VERIFIED', expected_old_status: 'ABSENT', expected_old_unitid: null, claimed_keys: ['New Host U'], claimed_unitids: [900004], role: 'ATHLETICS_SITE', reason: 'verified one-to-one' };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7b5b-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 7B.5B safe domain-repair applier', () => {
  it('refuses a /data path', () => {
    const f = writeFixture([UPD]);
    let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--fixture', f.p, '--fixture-hash', f.hash, '--apply'], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing production \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
  it('refuses a fixture-hash mismatch', () => {
    const r = run([UPD], { hash: 'deadbeef' });
    expect(r.ok).toBe(false); expect(r.out).toMatch(/hash mismatch/i);
    expect(domain('candidate.example').status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('refuses production volume', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ ...UPD, domain: `d${i}.example` }));
    const r = run(many);
    expect(r.ok).toBe(false); expect(r.out).toMatch(/production volume/i);
  });
  it('refuses a REDACTED fixture at the door', () => {
    const r = run([{ ...UPD, reason: 'coach-x@redacted.invalid' }]);
    expect(r.ok).toBe(false);
    expect(domain('candidate.example').status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('UPDATE promotes an unpromoted candidate to VERIFIED with matching expected-old', () => {
    const r = run([UPD]);
    expect(r.ok).toBe(true);
    const d = domain('candidate.example');
    expect(d.status).toBe('VERIFIED'); expect(d.unitid).toBe(900001);
    expect(d.verification_method).toBe('PHASE7B5A_INDEPENDENT_ONE_TO_ONE');
    expect(d.verification_method).not.toBe('PAGE_SELF_IDENTIFICATION');
  });
  it('INSERT populates every NOT NULL column (schema not weakened)', () => {
    const r = run([INS]);
    expect(r.ok).toBe(true);
    const d = domain('newhost.example');
    expect(d).toBeTruthy();
    expect(d.status).toBe('VERIFIED'); expect(d.unitid).toBe(900004);
    expect(d.claimed_keys).toBe('["New Host U"]');
    expect(d.claimed_unitids).toBe('[900004]');
    expect(d.verification_method).toBe('PHASE7B5A_INDEPENDENT_ONE_TO_ONE');
    expect(d.confidence).toBe('HIGH');
    expect(d.checked_at).toBeTruthy();
    expect(d.role).toBe('ATHLETICS_SITE');
  });
  it('one-to-one guard: refuses to overwrite a domain mapped to a DIFFERENT unitid', () => {
    const r = run([{ op: 'UPDATE', domain: 'taken.example', unitid: 900001, new_status: 'VERIFIED', expected_old_status: 'VERIFIED', expected_old_unitid: 900002, reason: 'x' }]);
    expect(r.ok).toBe(false); expect(r.out).toMatch(/one-to-one guard/);
    expect(domain('taken.example').unitid).toBe(900002);
  });
  it('refuses on expected-old status mismatch', () => {
    const r = run([{ ...UPD, expected_old_status: 'UNREACHABLE' }]);
    expect(r.ok).toBe(false); expect(r.out).toMatch(/expected-old status/);
    expect(domain('candidate.example').status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('refuses an INSERT whose row already exists', () => {
    const r = run([{ ...INS, domain: 'candidate.example', expected_old_status: 'ABSENT' }]);
    expect(r.ok).toBe(false); expect(r.out).toMatch(/expected ABSENT but row exists|expected-old status ABSENT/);
  });
  it('is idempotent: a repair already at target is a NOOP', () => {
    const r = run([{ op: 'UPDATE', domain: 'done.example', unitid: 900003, new_status: 'VERIFIED', expected_old_status: 'INSUFFICIENT_EVIDENCE', expected_old_unitid: null, reason: 'x' }]);
    expect(r.ok).toBe(true); expect(r.out).toMatch(/NOOP 1/);
    expect(domain('done.example').status).toBe('VERIFIED');
  });
  it('refuses a HELD (collision/shared) domain even if present', () => {
    const r = run([{ op: 'UPDATE', domain: HELD, unitid: 900001, new_status: 'VERIFIED', expected_old_status: 'INSUFFICIENT_EVIDENCE', expected_old_unitid: null, reason: 'x' }]);
    expect(r.ok).toBe(false); expect(r.out).toMatch(/HELD domain/);
  });
  it('rollback: one bad entry aborts the whole batch (no partial writes)', () => {
    const before = count();
    const r = run([UPD, INS, { op: 'UPDATE', domain: 'taken.example', unitid: 900001, new_status: 'VERIFIED', expected_old_status: 'VERIFIED', expected_old_unitid: 900002, reason: 'x' }]);
    expect(r.ok).toBe(false);
    expect(domain('candidate.example').status).toBe('INSUFFICIENT_EVIDENCE'); // UPD not applied
    expect(domain('newhost.example')).toBeUndefined(); // INS not applied
    expect(count()).toBe(before);
  });
  it('dry-run makes no changes', () => {
    const r = run([UPD, INS], { apply: false });
    expect(r.ok).toBe(true); expect(r.out).toMatch(/DRY RUN/);
    expect(domain('candidate.example').status).toBe('INSUFFICIENT_EVIDENCE');
    expect(domain('newhost.example')).toBeUndefined();
  });
});
