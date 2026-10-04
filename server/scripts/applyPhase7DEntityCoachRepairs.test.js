import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** PHASE 7D entity-aware coach evidence applier. Synthetic data; RFC 2606 domains. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/applyPhase7DEntityCoachRepairs.js';
let dir; let dbPath;
function build({ entities = true } = {}) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, division TEXT, unitid INTEGER, active INTEGER, athletics_entity_id TEXT);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT, athletics_entity_id TEXT);
    CREATE TABLE coaches (id TEXT PRIMARY KEY, full_name TEXT, email TEXT, school TEXT, sport TEXT, email_status TEXT, email_source_url TEXT, email_confirmed_at TEXT, currentness_status TEXT, currentness_checked_at TEXT, currentness_source_url TEXT, currentness_reason TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
  `);
  if (entities) db.exec(`CREATE TABLE athletics_entities (athletics_entity_id TEXT PRIMARY KEY, display_name TEXT, federal_unitid INTEGER, parent_unitid INTEGER, campus_label TEXT, entity_kind TEXT, provenance TEXT, notes TEXT, created_at TEXT);
    INSERT INTO athletics_entities VALUES ('AE-U100001','Parent',100001,NULL,NULL,'SINGLE','t',NULL,'t'), ('AE-X-B','Branch',NULL,100001,'Branch','BRANCH_CAMPUS','t',NULL,'t');`);
  db.exec(`INSERT INTO colleges VALUES ('p','Parent','mens-soccer','NCAA D3',100001,1,'AE-U100001'), ('b','Branch','mens-soccer','NAIA',NULL,1,'AE-X-B'), ('w','Wrong Filing','mens-soccer','NAIA',100777,1,'AE-U100777');
    INSERT INTO athletics_domains VALUES ('example.net',100001,'VERIFIED',NULL), ('branch.example.net',NULL,'VERIFIED','AE-X-B');
    INSERT INTO coaches (id, full_name, email, school, sport, email_status, email_source_url, currentness_status) VALUES
      ('k1','Amy Coach','a.coach@example.org','Branch','mens-soccer','verified','https://branch.example.net/coaches',NULL),
      ('k2','Ben Coach','b.coach@example.org','Branch','mens-soccer','inferred','pattern_inference:high',NULL),
      ('k3','Cat Coach','c.coach@example.org','Wrong Filing','mens-soccer','verified','https://branch.example.net/coaches','PROVEN_STALE');`);
  db.close();
}
const EV = { op: 'EVIDENCE', coach_id: 'k1', expected_old_email: 'a.coach@example.org', currentness_source_url: 'https://branch.example.net/coaches', email_seen_on_source_url: 'https://branch.example.net/coaches', checked_at: '2026-09-29', auto_apply_safe: true };
function run(entries, apply = true) { const p = path.join(dir, 'fx.json'); fs.writeFileSync(p, JSON.stringify({ entries })); try { return { ok: true, out: execFileSync('node', [APP, '--db', dbPath, '--fixture', p, ...(apply ? ['--apply'] : [])], { cwd: ROOT, encoding: 'utf8' }) }; } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; } }
const coach = (id) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare('SELECT * FROM coaches WHERE id=?').get(id); d.close(); return r; };
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7d-coach-')); dbPath = path.join(dir, 't.sqlite'); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 7D entity coach evidence applier', () => {
  it('requires the entity model to exist', () => { build({ entities: false }); expect(run([EV]).out).toMatch(/athletics_entities absent/); });
  it('accepts evidence observed on the coach’s OWN entity host (email unchanged, confirmed_at untouched)', () => {
    build(); const r = run([EV]); expect(r.ok).toBe(true);
    const c = coach('k1'); expect(c.currentness_status).toBe('CURRENT'); expect(c.email_seen_on_source_url).toBe('https://branch.example.net/coaches'); expect(c.email).toBe('a.coach@example.org'); expect(c.email_confirmed_at).toBeNull();
  });
  it('REFUSES evidence from the parent institution’s host for a branch coach', () => {
    build(); const r = run([{ ...EV, currentness_source_url: 'https://example.net/coaches', email_seen_on_source_url: 'https://example.net/coaches' }]);
    expect(r.out).toMatch(/example\.net belongs to AE-U100001, not AE-X-B/); expect(coach('k1').currentness_status).toBeNull();
  });
  it('never upgrades an inferred address', () => { build(); expect(run([{ ...EV, coach_id: 'k2', expected_old_email: 'b.coach@example.org' }]).out).toMatch(/not verified/); });
  it('expected-old email guard', () => { build(); expect(run([{ ...EV, expected_old_email: 'other@example.org' }]).out).toMatch(/expected-old email mismatch/); });
  it('REASSIGN requires the evidence host to belong to the target programme; then evidence applies on the new school', () => {
    build();
    expect(run([{ op: 'REASSIGN', coach_id: 'k3', expected_old_school: 'Wrong Filing', new_school: 'Parent', evidence_url: 'https://branch.example.net/coaches', auto_apply_safe: true }]).out).toMatch(/not the target programme/);
    const ok = run([{ op: 'REASSIGN', coach_id: 'k3', expected_old_school: 'Wrong Filing', new_school: 'Branch', evidence_url: 'https://branch.example.net/coaches', auto_apply_safe: true }, { ...EV, coach_id: 'k3', expected_old_email: 'c.coach@example.org', expected_school: 'Branch' }]);
    expect(ok.ok).toBe(true); expect(coach('k3').school).toBe('Branch'); expect(coach('k3').currentness_status).toBe('CURRENT');
  });
  it('dry run changes nothing', () => { build(); expect(run([EV], false).out).toMatch(/DRY RUN/); expect(coach('k1').currentness_status).toBeNull(); });
});
