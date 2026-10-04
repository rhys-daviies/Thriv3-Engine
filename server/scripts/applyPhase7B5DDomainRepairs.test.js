import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 7B.5D adjudicated collision/hold domain-repair applier guards: shared-root refusal,
 * collision_class gate, one-to-one guard, expected-old guards, NOT NULL INSERT, idempotence.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase7B5DDomainRepairs.js';
let dir; let dbPath;
function build() {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE athletics_domains (domain TEXT PRIMARY KEY, unitid INTEGER, status TEXT NOT NULL, role TEXT, claimed_keys TEXT NOT NULL, claimed_unitids TEXT NOT NULL, wrong_mappings TEXT, verification_method TEXT NOT NULL, confidence TEXT NOT NULL, notes TEXT, checked_at TEXT NOT NULL);`);
  const ins = db.prepare('INSERT INTO athletics_domains (domain,unitid,status,claimed_keys,claimed_unitids,verification_method,confidence,checked_at) VALUES (?,?,?,?,?,?,?,?)');
  ins.run('lsuish.example', null, 'INSUFFICIENT_EVIDENCE', '["La Sierra"]', '[117627]', 'PAGE_SELF_IDENTIFICATION', 'NONE', '2026-01-01');
  ins.run('wrongstatus.example', 117627, 'WRONG_INSTITUTION', '["La Sierra","Sierra"]', '[117627,123341]', 'X', 'CERTAIN', '2026-01-01');
  ins.run('taken.example', 900002, 'VERIFIED', '["Other"]', '[900002]', 'X', 'CERTAIN', '2026-01-01');
  db.close();
}
function writeFixture(entries) { const p = path.join(dir, 'fx.json'); fs.writeFileSync(p, JSON.stringify({ entries })); return { p, hash: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex') }; }
function run(entries, { apply = true, hash } = {}) {
  const f = writeFixture(entries);
  const args = ['--db', dbPath, '--fixture', f.p, '--fixture-hash', hash || f.hash];
  if (apply) args.push('--apply');
  try { return { ok: true, out: execFileSync('node', [APP, ...args], { cwd: ROOT, encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}
const domain = (d) => { const x = new Database(dbPath, { readonly: true }); const r = x.prepare('SELECT * FROM athletics_domains WHERE lower(domain)=?').get(d); x.close(); return r; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7b5d-')); dbPath = path.join(dir, 't.sqlite'); build(); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

const UPD = { op: 'UPDATE', domain: 'lsuish.example', unitid: 117627, new_status: 'VERIFIED', expected_old_status: 'INSUFFICIENT_EVIDENCE', expected_old_unitid: null, collision_class: 'ONE_TO_ONE_CORRECTION_PROVEN', evidence_url: 'https://lasierra.edu/athletics', reason: 'LSU=La Sierra' };

describe('Phase 7B.5D adjudicated domain applier', () => {
  it('refuses a /data path', () => {
    const f = writeFixture([UPD]); let refused = false;
    try { execFileSync('node', [APP, '--db', '/data/recruitmatch.sqlite', '--fixture', f.p, '--fixture-hash', f.hash, '--apply'], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { refused = /Refusing production \/data/.test((e.stdout || '') + (e.stderr || '')); }
    expect(refused).toBe(true);
  });
  it('refuses a hash mismatch', () => { const r = run([UPD], { hash: 'deadbeef' }); expect(r.ok).toBe(false); expect(r.out).toMatch(/hash mismatch/i); });
  it('refuses a shared-platform root', () => {
    const r = run([{ ...UPD, domain: 'prestosports.com' }]); expect(r.ok).toBe(false); expect(r.out).toMatch(/shared-platform root/);
  });
  it('refuses an unproven collision_class', () => {
    const r = run([{ ...UPD, collision_class: 'UNRESOLVED_COLLISION' }]); expect(r.ok).toBe(false); expect(r.out).toMatch(/not a proven one-to-one/);
  });
  it('applies a proven ONE_TO_ONE correction from INSUFFICIENT_EVIDENCE', () => {
    const r = run([UPD]); expect(r.ok).toBe(true);
    const d = domain('lsuish.example'); expect(d.status).toBe('VERIFIED'); expect(d.unitid).toBe(117627); expect(d.verification_method).toBe('PHASE7B5D_ADJUDICATED_ONE_TO_ONE');
  });
  it('applies a WRONG_INSTITUTION->VERIFIED same-unitid correction', () => {
    const r = run([{ op: 'UPDATE', domain: 'wrongstatus.example', unitid: 117627, new_status: 'VERIFIED', expected_old_status: 'WRONG_INSTITUTION', expected_old_unitid: 117627, collision_class: 'DISTINCT_DOMAINS_RESOLVED', evidence_url: 'https://x', reason: 'false Sierra flag' }]);
    expect(r.ok).toBe(true); expect(domain('wrongstatus.example').status).toBe('VERIFIED');
  });
  it('one-to-one guard: refuses overwriting a domain mapped to a different unitid', () => {
    const r = run([{ op: 'UPDATE', domain: 'taken.example', unitid: 117627, new_status: 'VERIFIED', expected_old_status: 'VERIFIED', expected_old_unitid: 900002, collision_class: 'ONE_TO_ONE_CORRECTION_PROVEN', evidence_url: 'https://x' }]);
    expect(r.ok).toBe(false); expect(r.out).toMatch(/one-to-one guard/); expect(domain('taken.example').unitid).toBe(900002);
  });
  it('refuses on expected-old status mismatch', () => {
    const r = run([{ ...UPD, expected_old_status: 'UNREACHABLE' }]); expect(r.ok).toBe(false); expect(r.out).toMatch(/expected-old status/);
  });
  it('INSERT populates NOT NULL columns', () => {
    const r = run([{ op: 'INSERT', domain: 'newhost.example', unitid: 159382, new_status: 'VERIFIED', expected_old_status: 'ABSENT', collision_class: 'ONE_TO_ONE_CORRECTION_PROVEN', evidence_url: 'https://x', claimed_keys: ['LSU Alexandria'], claimed_unitids: [159382], role: 'ATHLETICS_SITE' }]);
    expect(r.ok).toBe(true); const d = domain('newhost.example'); expect(d.claimed_unitids).toBe('[159382]'); expect(d.confidence).toBe('HIGH'); expect(d.checked_at).toBeTruthy();
  });
  it('is idempotent (NOOP on re-run)', () => {
    run([UPD]); const r = run([UPD]); expect(r.ok).toBe(true); expect(r.out).toMatch(/NOOP 1/);
  });
});
