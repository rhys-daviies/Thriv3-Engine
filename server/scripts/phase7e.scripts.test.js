import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld, W, PEOPLE } from '../lib/refresh/regressionWorld.js';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';
import { runMonitor } from './integrityMonitor.js';

/**
 * PHASE 7E — the permanent validator's new rules (H9 row links, H10 membership periods), the
 * reconciler's active-programme requirement, the guarded structural applier and the monitor.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let dir; let dbPath;
const T = '2026-09-29T00:00:00Z';
const v = (db) => validateEntityIdentity(db, { allowlist: [], knownWrongUnitid: [] });
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7e-scr-')); dbPath = path.join(dir, 'w.sqlite'); buildRegressionWorld(dbPath); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const addAltRow = (db) => db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, unitid, active, athletics_entity_id) VALUES ('c-ctx-alt', ?, ?, 'Concordia Univ. Texas', 'mens-soccer', 'NAIA', 'Red River', 900101, 1, 'AE-U900101')").run(T, T);

describe('validator H6/H9/H10 (Phase 7E)', () => {
  it('a second active row for one programme is a HARD duplicate until it is linked; the link documents it', () => {
    const db = new Database(dbPath); addAltRow(db);
    expect(v(db).hard.some((h) => h.startsWith('H6'))).toBe(true);
    db.prepare("INSERT INTO programme_row_links VALUES ('c-ctx-alt', ?, 'SAME_PROGRAMME_ALT_NAME', NULL, 'test', ?)").run(W.CTX, T);
    const r = v(db); expect(r.status).toBe('PASS'); expect(r.documented.some((d) => d.startsWith('LINKED'))).toBe(true);
    db.close();
  });
  it('H9: a link across programmes, a chain, or an active superseded row fails', () => {
    const db = new Database(dbPath);
    db.prepare("INSERT INTO programme_row_links VALUES (?, ?, 'SUPERSEDED_DIVISION_ROW', 2026, 'test', ?)").run(W.TEXAS, W.CTX, T);
    const hard = v(db).hard; expect(hard.some((h) => /H9 .*different programmes/.test(h))).toBe(true); expect(hard.some((h) => /still active/.test(h))).toBe(true);
    db.close();
  });
  it('H11: a UNITID correction that leaves the name alias behind fails', () => {
    const db = new Database(dbPath);
    db.prepare("UPDATE institution_aliases SET unitid=900102 WHERE alias_key='concordia university texas'").run();
    expect(v(db).hard.some((h) => h.startsWith('H11'))).toBe(true);
    db.close();
  });
  it('H10: colleges.division must agree with the open membership period', () => {
    const db = new Database(dbPath);
    db.prepare("UPDATE colleges SET division='NCAA D2' WHERE id=?").run(W.SSU);
    expect(v(db).hard.some((h) => /H10 P3 .*disagrees with current membership/.test(h))).toBe(true);
    db.close();
  });
});

describe('reconciler: never eligible at a programme that does not exist now', () => {
  it('a verified, corroborated coach on an INACTIVE programme row is not outreach-eligible', () => {
    const run = () => { execFileSync(process.execPath, ['server/scripts/reconcileCoaches.js', '--db', dbPath, '--csv', path.join(dir, 'o.csv')], { cwd: ROOT, env: { ...process.env, STRICT_CORROB_SCOPE: 'NAIA' }, stdio: 'pipe' }); const d = new Database(dbPath, { readonly: true }); const r = d.prepare('SELECT * FROM coaches_reconciled WHERE coach_id=?').get(PEOPLE.SSUHEAD.id); d.close(); return r; };
    const db = new Database(dbPath); db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, source_url, imported_at) VALUES ('Shawnee State','mens-soccer',2026,?, 'https://ssubears.example/sports/mens-soccer/roster/2026', ?)").run(PEOPLE.SSUHEAD.full_name, T); db.close();
    expect(run().outreach_eligibility).toBe('YES');
    const d2 = new Database(dbPath); d2.prepare('UPDATE colleges SET active=0 WHERE id=?').run(W.SSU); d2.close();
    const r = run(); expect(r.outreach_eligibility).toBe('NO'); expect(r.ineligible_reason).toMatch(/inactive/);
  }, 60000);
});

describe('applyPhase7EStructural (guarded, idempotent, revertible)', () => {
  const fixture = () => {
    const body = {
      entities: [], entity_notes: [],
      repairs: [{ college_id: W.TRINC, label: 'Trinity Christian', expected_old: { conference: 'CCAC' }, set: { conference: 'NCCAA Test' }, note: 'test repair' }],
      row_links: [{ college_id: 'c-ctx-alt', canonical_college_id: W.CTX, link_kind: 'SAME_PROGRAMME_ALT_NAME', effective_from_season: null, provenance: 'test', label: 'alt' }],
      periods: [], seed_periods: { first_season: 2026, source_tier: 'SEED', provenance: 'test seed' }, alias_entity_ties: [], coach_reassign: [], domains: [],
    };
    return { phase: '7E-structural', created_at: T, fixture_hash: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'), ...body };
  };
  const rehash = (fx) => { const { phase, created_at, fixture_hash, ...body } = fx; fx.fixture_hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'); return fx; };
  const runApply = (fx, extra = []) => { const f = path.join(dir, 'fx.json'); fs.writeFileSync(f, JSON.stringify(fx)); return execFileSync(process.execPath, ['server/scripts/applyPhase7EStructural.js', '--db', dbPath, '--fixture', f, '--fixture-hash', fx.fixture_hash, ...extra], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }); };
  it('dry run writes nothing; apply writes; a re-run is a no-op; the manifest reverts it', () => {
    const d0 = new Database(dbPath); addAltRow(d0); d0.close();
    const fx = fixture(); fx.repairs = []; rehash(fx);
    expect(runApply(fx)).toMatch(/DRY RUN/);
    let d = new Database(dbPath, { readonly: true }); expect(d.prepare('SELECT COUNT(*) n FROM programme_row_links').get().n).toBe(0); d.close();
    const man = path.join(dir, 'm.json');
    expect(runApply(fx, ['--apply', '--manifest-out', man])).toMatch(/APPLIED/);
    d = new Database(dbPath, { readonly: true }); expect(d.prepare('SELECT COUNT(*) n FROM programme_row_links').get().n).toBe(1); expect(v(d).status).toBe('PASS'); d.close();
    expect(runApply(fx, ['--apply'])).toMatch(/links 0 .* noop 1/);
    execFileSync(process.execPath, ['server/scripts/applyPhase7EStructural.js', '--db', dbPath, '--revert', man, '--apply'], { cwd: ROOT, stdio: 'pipe' });
    d = new Database(dbPath, { readonly: true }); expect(d.prepare('SELECT COUNT(*) n FROM programme_row_links').get().n).toBe(0); d.close();
  });
  it('a timeless conference rewrite (no membership period) is refused by the postcondition and rolled back', () => {
    const d0 = new Database(dbPath); addAltRow(d0); d0.close();
    let out = ''; try { runApply(fixture(), ['--apply']); } catch (e) { out = `${e.stdout}${e.stderr}`; }
    expect(out).toMatch(/ROLLED BACK: identity invariant FAIL[\s\S]*H10 P3/);
    const d = new Database(dbPath, { readonly: true }); expect(d.prepare('SELECT conference FROM colleges WHERE id=?').get(W.TRINC).conference).toBe('CCAC'); expect(d.prepare('SELECT COUNT(*) n FROM programme_row_links').get().n).toBe(0); d.close();
  });
  it('a postcondition failure (identity invariant) rolls everything back', () => {
    const d0 = new Database(dbPath); addAltRow(d0); d0.close();
    const fx = fixture(); fx.row_links = []; fx.repairs = []; rehash(fx); // leaves the duplicate unexplained -> H6
    let out = ''; try { runApply(fx, ['--apply']); } catch (e) { out = `${e.stdout}${e.stderr}`; }
    expect(out).toMatch(/ROLLED BACK: identity invariant FAIL/);
  });
  it('a fixture whose hash was not the reviewed one is refused', () => {
    const fx = fixture(); fx.fixture_hash = '0'.repeat(64);
    let code = 0; try { runApply(fx, ['--apply']); } catch (e) { code = e.status; }
    expect(code).toBe(1);
  });
});

describe('integrity monitor', () => {
  it('passes on the regression world and fails HARD when a frozen season is rewritten', () => {
    expect(runMonitor(dbPath, { now: new Date('2026-09-29'), reconcile: false }).status).toBe('PASS');
    const db = new Database(dbPath); db.prepare("UPDATE roster_players SET class_year_label='Jr.' WHERE id='r-b25'").run(); db.close();
    const r = runMonitor(dbPath, { now: new Date('2026-09-29'), reconcile: false });
    expect(r.status).toBe('FAIL'); expect(r.checks.find((c) => c.id === 'frozen_season_changed').count).toBe(1);
  });
});
