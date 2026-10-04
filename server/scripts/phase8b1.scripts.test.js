import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld } from '../lib/refresh/regressionWorld.js';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';
import { seasonFingerprint } from '../lib/refresh/temporal.js';
import { runMonitor } from './integrityMonitor.js';

/**
 * PHASE 8B.1 — CCCAA / NWAC separation and host + path-scope locations through the guarded
 * universe applier, on the regression world (NAIA/NCAA rows present, so non-regression shows).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let dir; let dbPath;
const T = '2026-10-01T00:00:00Z';
const naiaNcaa = (db) => JSON.stringify(db.prepare("SELECT id, name, sport, division, conference, active, unitid, athletics_entity_id FROM colleges WHERE division NOT IN ('NJCAA','USCAA','CCCAA','NWAC') ORDER BY id").all());
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p8b1-')); dbPath = path.join(dir, 'w.sqlite'); buildRegressionWorld(dbPath); const db = new Database(dbPath);
  for (const [id, name, st, e, u] of [['c-elcamino', 'El Camino', 'CA', 'AE-U113980', 113980], ['c-phantomca', 'Ventura', 'CA', 'AE-U125028', 125028], ['c-njcaa', 'Casper College', 'WY', 'AE-U240000', 240000]]) {
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?, ?, ?, 'SINGLE', 'federal registry test', ?)").run(e, name, u, T);
    db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, unitid, state, active, athletics_entity_id) VALUES (?, ?, ?, ?, 'mens-soccer', 'NJCAA', 'CCCAA', ?, ?, 1, ?)").run(id, T, T, name, u, st, e);
    db.prepare("INSERT INTO programme_membership_periods (athletics_entity_id, sport, first_season, governing_body, division, membership_status, conference, college_id, source_tier, provenance, recorded_at) VALUES (?, 'mens-soccer', 2026, 'NJCAA', 'NJCAA', 'ACTIVE', 'CCCAA', ?, 'SEED', 'seed', ?)").run(e, id, T);
  }
  db.prepare("INSERT INTO programme_seasons (college_id, sport, season, wins, draws, losses, matches_played, source, source_record_name, confidence, imported_at) VALUES ('c-elcamino','mens-soccer',2025,10,2,5,17,'soccer-records','El Camino','UNCHECKED',?)").run(T);
  db.close();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const period = (div, url) => ({ governing_body: 'OTHER', division: div, membership_status: 'ACTIVE', conference: div, source_tier: 'B', source_url: url, provenance: `listed on the ${div} 2026-27 men's soccer listing` });
const fixture = (over = {}) => {
  const body = { entity_create: [], entity_update: [], college_repair: [], programme_create: [], membership_verify: [], row_link: [], deactivate: [], domain_register: [], association_correct: [], location_register: [], ...over };
  return { phase: '8B1-test', created_at: T, fixture_hash: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'), ...body };
};
const run = (fx, extra = []) => { const f = path.join(dir, 'fx.json'); fs.writeFileSync(f, JSON.stringify(fx)); return execFileSync(process.execPath, ['server/scripts/applyPhase8AUniverse.js', '--db', dbPath, '--fixture', f, '--fixture-hash', fx.fixture_hash, ...extra], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }); };
const fail = (fx) => { try { run(fx, ['--apply']); return ''; } catch (e) { return `${e.stdout}${e.stderr}`; } };
const correct = (id, div = 'CCCAA', exp = { division: 'NJCAA', active: 1 }) => ({ label: id, college_id: id, expected_old: exp, proposed: { division: div, conference: div }, period: period(div, 'https://www.cccaasports.org/sports/msoc/2026-27/standings'), evidence: 'association standings', reason: 'CCCAA programme labelled NJCAA by the legacy DB', blast_radius: 'one row + its SEED period' });

describe('CCCAA / NWAC separation', () => {
  it('a listed CCCAA programme stops being NJCAA; its history rows and NAIA/NCAA are untouched; idempotent; revertible', () => {
    let db = new Database(dbPath, { readonly: true }); const other = naiaNcaa(db); const fp = JSON.stringify(seasonFingerprint(db, 2025)); const ps = db.prepare("SELECT * FROM programme_seasons WHERE college_id='c-elcamino'").all(); db.close();
    const man = path.join(dir, 'm.json'); const fx = fixture({ association_correct: [correct('c-elcamino')] });
    expect(run(fx, ['--apply', '--manifest-out', man])).toMatch(/APPLIED — 1 action/);
    db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT division, active FROM colleges WHERE id='c-elcamino'").get()).toEqual({ division: 'CCCAA', active: 1 });
    expect(db.prepare("SELECT governing_body, division, source_tier FROM programme_membership_periods WHERE college_id='c-elcamino'").get()).toEqual({ governing_body: 'OTHER', division: 'CCCAA', source_tier: 'B' });
    expect(db.prepare("SELECT * FROM programme_seasons WHERE college_id='c-elcamino'").all()).toEqual(ps);
    expect(db.prepare("SELECT COUNT(*) n FROM colleges WHERE division='NJCAA' AND id='c-elcamino'").get().n).toBe(0);
    expect(naiaNcaa(db)).toBe(other); expect(JSON.stringify(seasonFingerprint(db, 2025))).toBe(fp);
    expect(validateEntityIdentity(db, { allowlist: [], knownWrongUnitid: [] }).status).toBe('PASS');
    db.close();
    expect(run(fx, ['--apply'])).toMatch(/noop 1/);
    execFileSync(process.execPath, ['server/scripts/applyPhase8AUniverse.js', '--db', dbPath, '--revert', man, '--apply'], { cwd: ROOT, stdio: 'pipe' });
    db = new Database(dbPath, { readonly: true }); expect(db.prepare("SELECT division FROM colleges WHERE id='c-elcamino'").get().division).toBe('NJCAA'); db.close();
  });
  it('an unlisted CA row is corrected AND retired as a phantom (never deleted)', () => {
    expect(run(fixture({ association_correct: [correct('c-phantomca')], deactivate: [{ label: 'Ventura [M] phantom', college_id: 'c-phantomca', expected_old: { active: 1 }, proposed: { active: 0, membership_status: 'DISCONTINUED' }, evidence: 'absent from the complete 2025-26 and 2026-27 CCCAA listings; no records', reason: 'no such programme', blast_radius: 'one row inactive' }] }), ['--apply'])).toMatch(/APPLIED/);
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT division, active FROM colleges WHERE id='c-phantomca'").get()).toEqual({ division: 'CCCAA', active: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM colleges WHERE id='c-phantomca'").get().n).toBe(1);
    db.close();
  });
  it('refuses a non-CCCAA/NWAC target, a verified period, and a stale expected-old', () => {
    expect(fail(fixture({ association_correct: [correct('c-njcaa', 'NCAA D1')] }))).toMatch(/not an out-of-scope association/);
    const db = new Database(dbPath); db.prepare("UPDATE programme_membership_periods SET source_tier='B' WHERE college_id='c-njcaa'").run(); db.close();
    expect(fail(fixture({ association_correct: [correct('c-njcaa')] }))).toMatch(/only a SEED open period/);
    expect(fail(fixture({ association_correct: [correct('c-elcamino', 'CCCAA', { division: 'NAIA', active: 1 })] }))).toMatch(/expected-old mismatch/);
  });
});

describe('host + path-scope locations', () => {
  const L = (over) => ({ label: 'loc', proposed: { location_id: 'loc-1', athletics_entity_id: 'AE-U240000', host: 'casper.edu', path_prefix: '/athletics', source_type: 'INSTITUTION_ATHLETICS_PATH', sport: null, status: 'VERIFIED', evidence_url: 'https://casper.edu/athletics/', provenance: 'institution site -> /athletics navigation', first_seen_season: 2026, last_verified_at: T, ...over }, evidence: 'nav', reason: 'athletics under the institution site', blast_radius: 'one location row; no host ownership change' });
  it('registers a path scope without making the institution host an athletics host', () => {
    expect(run(fixture({ location_register: [L()] }), ['--apply'])).toMatch(/APPLIED/);
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) n FROM athletics_domains WHERE domain='casper.edu'").get().n).toBe(0);
    expect(db.prepare("SELECT path_prefix FROM athletics_source_locations WHERE location_id='loc-1'").get().path_prefix).toBe('/athletics');
    db.close();
  });
  it('refuses a whole-host institution path, a shared root, and a host another entity owns', () => {
    expect(fail(fixture({ location_register: [L({ path_prefix: '/' })] }))).toMatch(/cannot be the whole host/);
    expect(fail(fixture({ location_register: [L({ host: 'casper.sidearmsports.com' })] }))).toMatch(/shared platform root/);
    const db = new Database(dbPath); db.prepare("INSERT INTO athletics_domains (domain, status, claimed_keys, claimed_unitids, verification_method, confidence, checked_at, athletics_entity_id) VALUES ('casper.edu','VERIFIED','[]','[]','t','CERTAIN',?,'AE-U900101')").run(T); db.close();
    expect(fail(fixture({ location_register: [L()] }))).toMatch(/owned by AE-U900101/);
  });
});

describe('monitor triage (Part V): reported, never fatal', () => {
  it('NJCAA rows in CA are an association mismatch WARN until corrected; the monitor never FAILs on NJCAA/USCAA triage', () => {
    const before = runMonitor(dbPath, { now: new Date('2026-10-01'), reconcile: false });
    const mm = before.checks.find((c) => c.id === 'association_mismatch_state');
    expect(mm.severity).toBe('WARN'); expect(mm.count).toBe(2);
    expect(before.checks.filter((c) => c.category === 'NJCAA').every((c) => c.severity !== 'HARD')).toBe(true);
    expect(before.checks.find((c) => c.category === 'NJCAA' && c.id === 'current_programme_without_source_location').severity).toBe('INFO');
    run(fixture({ association_correct: [correct('c-elcamino'), correct('c-phantomca')] }), ['--apply']);
    const after = runMonitor(dbPath, { now: new Date('2026-10-01'), reconcile: false });
    expect(after.checks.find((c) => c.id === 'association_mismatch_state').count).toBe(0);
    expect(after.status).toBe(before.status);
  });
  it('an NJCAA row in WA that an NJCAA listing VERIFIED is a real member — never an association mismatch', () => {
    const db = new Database(dbPath);
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-U495147','Pacific Northwest Christian',495147,'SINGLE','federal registry test',?)").run(T);
    db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, unitid, state, active, athletics_entity_id) VALUES ('c-pnwcc', ?, ?, 'Pacific Northwest Christian College', 'mens-soccer', 'NJCAA', 'NJCAA Region 18', 495147, 'WA', 1, 'AE-U495147')").run(T, T);
    db.prepare("INSERT INTO programme_membership_periods (athletics_entity_id, sport, first_season, governing_body, division, membership_status, conference, college_id, source_tier, source_url, provenance, recorded_at) VALUES ('AE-U495147','mens-soccer',2026,'NJCAA','NJCAA','ACTIVE','NJCAA Region 18','c-pnwcc','B','https://www.scenicwestsports.com/sports/msoc/2026-27/teams','listed',?)").run(T);
    db.close();
    const m = runMonitor(dbPath, { now: new Date('2026-10-01'), reconcile: false });
    expect(m.checks.find((c) => c.id === 'association_mismatch_state').sample.some((x) => /Pacific Northwest/.test(x))).toBe(false);
  });
});
