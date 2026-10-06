import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld, rosterPage } from '../lib/refresh/regressionWorld.js';
import { stageRefresh, writeStagedBatch } from '../lib/refresh/staging.js';

/**
 * PHASE 8B.2 — the fixture builder: deterministic, refuses the shared corpus, and its output is accepted by
 * the real applier (the builder -> applier contract). Synthetic world, invented people. The database lives
 * inside the checkout (gitignored) because the builder, correctly, refuses a corpus outside it.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = path.join(ROOT, 'server/scripts/buildPhase8B2Fixture.js');
const APPLY = path.join(ROOT, 'server/scripts/applyPhase8B2RosterPromotion.js');
let dir; let dbPath; let inputPath; let batchId;
const build = (out, extra = []) => spawnSync(process.execPath, [BUILD, '--db', dbPath, '--batch', batchId, '--input', inputPath, '--out-dir', out, ...extra], { cwd: ROOT, encoding: 'utf8' });
const read = (out) => JSON.parse(fs.readFileSync(path.join(out, 'fixture.json'), 'utf8'));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(ROOT, 'server/data/generated/_test_p8b2_builder_')); dbPath = path.join(dir, 'w.sqlite'); inputPath = path.join(dir, 'in.json'); buildRegressionWorld(dbPath);
  const input = { season: 2026, scope: 'NAIA', parser_version: 'test-1', gathered_at: '2026-09-20T00:00:00Z', pages: [rosterPage({ source_url: 'https://concordiatx.example/sports/mens-soccer/roster/2026', fetched_at: '2026-09-20T00:00:00.000Z', page_season: 2026, observed_season: 2026, adapter_evidence: { platform: 'TEST', title: "2026 Men's Soccer Roster - Concordia University Texas", sha256: 'abc', records: 3 }, currentness_check: { status: 'BLOCKED_NOW', checked_at: '2026-09-21', note: 'preserved' }, players: [
    { player_name: 'Robin Rookie', class_year_label: 'Fr.', nationality: 'Denmark' }, { player_name: 'Jordan Joiner', class_year_label: 'So.', position: 'DF' }, { player_name: 'Coach Carter', position: 'Head Coach' }] })] };
  fs.writeFileSync(inputPath, JSON.stringify(input));
  // the real database has its existing links materialised; give the synthetic world the same baseline (the builder refuses to invent links for existing rows)
  const proj = spawnSync(process.execPath, [path.join(ROOT, 'server/scripts/projectRosterMinutes.js'), '--season', '2026', '--from', '2025'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RECRUITMATCH_DB: dbPath } });
  if (proj.status !== 0) throw new Error(`baseline projection failed: ${proj.stderr.slice(-400)}`);
  const db = new Database(dbPath); const staged = stageRefresh(db, input); writeStagedBatch(db, staged); batchId = staged.batch.batch_id; db.close();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('buildPhase8B2Fixture', () => {
  it('two independent generations give a byte-identical fixture (same hash)', () => {
    const a = path.join(dir, 'a'); const b = path.join(dir, 'b');
    const ra = build(a); if (ra.status !== 0) throw new Error(ra.stderr.slice(-600)); expect(build(b).status).toBe(0);
    expect(fs.readFileSync(path.join(a, 'fixture.json'))).toEqual(fs.readFileSync(path.join(b, 'fixture.json')));
    expect(read(a).fixture_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('writes conformed rows with full provenance and the currentness status, and holds the staff row', () => {
    const out = path.join(dir, 'o'); build(out); const fx = read(out);
    expect(fx.roster_insert).toHaveLength(2); expect(fx.held.length).toBeGreaterThanOrEqual(1); expect(fx.held.every((h) => h.classification === 'HELD')).toBe(true);
    expect(fx.held.some((h) => fx.roster_insert.some((r) => r.observation_id === h.observation_id))).toBe(false);   // a held row is never also an insert
    for (const r of fx.roster_insert) {
      expect(r.proposed.minutes_played).toBeNull(); expect(r.proposed.season).toBe('2026'); expect(r.proposed.source_page_season).toBe('2026'); expect(r.proposed.data_confidence).toBe('high');
      expect(r.provenance).toMatchObject({ source_tier: 'A', ownership_decision: 'TRUSTED_OWN_HOST', platform: 'TEST', page_sha256: 'abc', currentness_status: 'BLOCKED_NOW', currentness_checked_at: '2026-09-21' });
      expect(r.provenance.staged_batch_id).toBe(batchId);
    }
    expect(fx.roster_insert.find((r) => r.proposed.player_name === 'Robin Rookie').proposed).toMatchObject({ nationality: 'International', country: 'Denmark', position: 'UNKNOWN' });
  });
  it('moves an insert whose source page is not complete to HELD instead of fixing it', () => {
    const input = JSON.parse(fs.readFileSync(inputPath, 'utf8')); input.pages[0].source_complete = false; fs.writeFileSync(inputPath, JSON.stringify(input));
    const out = path.join(dir, 'o'); expect(build(out).status).toBe(0); const fx = read(out);
    expect(fx.roster_insert).toHaveLength(0); expect(fx.held.some((h) => /PAGE_GATE: .*page not complete/.test(h.why))).toBe(true);
  });
  it('refuses the live database whatever flags are given (the corpus guard does not protect it in the owning checkout), and an unnamed batch', () => {
    const shared = path.join(ROOT, 'server/data/recruitmatch.sqlite');
    const r = spawnSync(process.execPath, [BUILD, '--db', shared, '--batch', 'x', '--input', inputPath, '--out-dir', path.join(dir, 'o'), '--canonical'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).not.toBe(0); expect(r.stderr).toMatch(/not a DISPOSABLE copy/);
    const nb = spawnSync(process.execPath, [BUILD, '--db', dbPath, '--input', inputPath, '--out-dir', path.join(dir, 'o')], { cwd: ROOT, encoding: 'utf8' });
    expect(nb.status).not.toBe(0); expect(nb.stderr).toMatch(/--batch/);
  });
  it('its output is accepted by the real applier and applies', () => {
    const out = path.join(dir, 'o'); build(out); const fx = read(out); const fxPath = path.join(out, 'fixture.json');
    const dry = spawnSync(process.execPath, [APPLY, '--db', dbPath, '--fixture', fxPath, '--fixture-hash', fx.fixture_hash], { cwd: ROOT, encoding: 'utf8' });
    if (dry.status !== 0) throw new Error(dry.stderr.slice(-700)); expect(dry.stdout).toMatch(/roster \+2/);
    const apply = spawnSync(process.execPath, [APPLY, '--db', dbPath, '--fixture', fxPath, '--fixture-hash', fx.fixture_hash, '--apply', '--manifest-out', path.join(out, 'm.json')], { cwd: ROOT, encoding: 'utf8' });
    expect(apply.status).toBe(0); expect(apply.stdout).toMatch(/APPLIED — roster \+2/);
    const db = new Database(dbPath, { readonly: true }); expect(db.prepare("SELECT COUNT(*) n FROM roster_players WHERE season='2026' AND player_name IN ('Robin Rookie','Jordan Joiner') AND minutes_played IS NULL").get().n).toBe(2); db.close();
  });
});
