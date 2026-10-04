import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { conformRosterRow, conformNationality } from './rosterRowConformance.js';
import { buildRegressionWorld, rosterPage } from './regressionWorld.js';
import { stageRefresh, writeStagedBatch, loadStagedBatch } from './staging.js';
import { planPromotion, applyPromotion, revertManifest } from './promotion.js';

/**
 * PHASE 8B.2 — a roster row promoted through the GENERIC refresh path must look like a row the importer
 * would have written. Without conformance, `integrity:promote` stores zero minutes for a season that has not
 * been played, "2027.0" as a season, a country name in `nationality`, and a third spelling of confidence.
 * Synthetic people and RFC 2606 hosts only.
 */
describe('conformRosterRow (pure)', () => {
  const staged = { college_name: 'X', sport: 'mens-soccer', division: 'NAIA', season: 2027, player_name: 'P One', source_page_season: 2027, data_confidence: 'High', position: null, nationality: null };
  it('never invents performance values: absent minutes/games/starts are explicit NULL, not the column default', () => {
    const r = conformRosterRow(staged);
    expect(r.minutes_played).toBeNull(); expect(r.games_played).toBeNull(); expect(r.games_started).toBeNull();
    expect(Object.keys(r)).toContain('minutes_played');                          // present, so the INSERT cannot fall back to DEFAULT 0
    expect(conformRosterRow({ ...staged, minutes_played: 450 }).minutes_played).toBe(450);   // a value the page really gave is kept
  });
  it('stores seasons as text, the way every existing row holds them', () => {
    const r = conformRosterRow(staged);
    expect(r.season).toBe('2027'); expect(r.source_page_season).toBe('2027');
    expect(conformRosterRow({ ...staged, source_page_season: null }).source_page_season).toBeNull();   // unknown stays unknown
  });
  it('uses the table sentinel for a missing position and lowercases confidence', () => {
    expect(conformRosterRow(staged).position).toBe('UNKNOWN');
    expect(conformRosterRow({ ...staged, position: '  ' }).position).toBe('UNKNOWN');
    expect(conformRosterRow({ ...staged, position: 'GK' }).position).toBe('GK');
    for (const [raw, want] of [['High', 'high'], ['HIGH', 'high'], ['medium', 'medium'], ['bogus', 'medium'], [undefined, 'medium']]) expect(conformRosterRow({ ...staged, data_confidence: raw }).data_confidence).toBe(want);
  });
  it('is idempotent and does not mutate its input', () => {
    const before = JSON.stringify(staged); const once = conformRosterRow(staged);
    expect(JSON.stringify(staged)).toBe(before); expect(conformRosterRow(once)).toEqual(once);
  });
  it('follows the nationality convention: USA | International with the name in country', () => {
    expect(conformNationality('Denmark', null)).toEqual({ nationality: 'International', country: 'Denmark' });
    expect(conformNationality('England', null)).toEqual({ nationality: 'International', country: 'United Kingdom' });
    expect(conformNationality('United States', null)).toEqual({ nationality: 'USA', country: null });
    expect(conformNationality('USA', null)).toEqual({ nationality: 'USA', country: null });
    expect(conformNationality('International', 'Japan')).toEqual({ nationality: 'International', country: 'Japan' });
    expect(conformNationality(null, null)).toEqual({ nationality: null, country: null });
    expect(conformNationality('Denmark', 'Denmark')).toEqual({ nationality: 'International', country: 'Denmark' });
  });
  it('does not guess a country it cannot place (a typo stays NULL, never a made-up region)', () => {
    expect(conformNationality('Denmrak', null)).toEqual({ nationality: null, country: null });
  });
});

describe('through the established stage -> plan -> promote -> revert path', () => {
  let dir; let dbPath;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p8b2-conf-')); dbPath = path.join(dir, 'w.sqlite'); buildRegressionWorld(dbPath); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = (pages) => ({ season: 2027, scope: 'NAIA', parser_version: 'test-1', gathered_at: '2027-08-20T00:00:00Z', pages });
  const page = () => rosterPage({ players: [
    { player_name: 'Robin Rookie', class_year_label: 'Fr.', nationality: 'Denmark' },                       // no position
    { player_name: 'Pat Placeholder', class_year_label: 'So.', position: 'DF', nationality: 'United States' },
    { player_name: 'Sam Spelling', class_year_label: 'Jr.', position: 'MF', nationality: 'Denmrak' },
  ] });

  it('the schema DEFAULT is the trap: a bare INSERT without minutes records ZERO (why conformance exists)', () => {
    const db = new Database(dbPath);
    expect(db.prepare("SELECT dflt_value FROM pragma_table_info('roster_players') WHERE name='minutes_played'").get().dflt_value).toBe('0');
    db.prepare("INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division, season, player_name) VALUES ('ctl','t','t','Concordia University Texas','mens-soccer','NAIA','2027','Control Player')").run();
    expect(db.prepare("SELECT minutes_played m FROM roster_players WHERE id='ctl'").get().m).toBe(0);
    db.close();
  });

  it('promoted rows carry NULL minutes, text seasons, lowercase confidence, UNKNOWN position and the nationality convention', () => {
    const db = new Database(dbPath);
    const staged = stageRefresh(db, input([page()])); writeStagedBatch(db, staged);
    const { batch, observations } = loadStagedBatch(db, staged.batch.batch_id);
    const plan = planPromotion({ batch, observations }, { frozen: new Set([2025]) });
    expect(plan.ops.filter((o) => o.action === 'INSERT_ROSTER_ROW')).toHaveLength(3);
    // the STAGED proposal is untouched (so a staging swap sees byte-identical proposals) ...
    expect(plan.ops.find((o) => o.proposed.player_name === 'Robin Rookie').proposed.position).toBeNull();
    applyPromotion(db, plan, { batchHash: batch.batch_hash });
    const get = (n) => db.prepare('SELECT * FROM roster_players WHERE player_name=?').get(n);
    for (const n of ['Robin Rookie', 'Pat Placeholder', 'Sam Spelling']) {
      const r = get(n);
      expect(r.minutes_played).toBeNull(); expect(r.games_played).toBeNull(); expect(r.games_started).toBeNull();
      expect(r.season).toBe('2027'); expect(r.source_page_season).toBe('2027'); expect(typeof r.source_page_season).toBe('string');
      expect(r.data_confidence).toBe('high'); expect(r.estimated_graduation_year).toBeNull(); expect(r.eligibility_end_year).toBeNull();
    }
    expect(get('Robin Rookie')).toMatchObject({ position: 'UNKNOWN', nationality: 'International', country: 'Denmark' });
    expect(get('Pat Placeholder')).toMatchObject({ position: 'DF', nationality: 'USA', country: null });
    expect(get('Sam Spelling')).toMatchObject({ position: 'MF', nationality: null, country: null });
    db.close();
  });

  it('a conformed insert is still exactly revertible', () => {
    const db = new Database(dbPath);
    const staged = stageRefresh(db, input([page()])); writeStagedBatch(db, staged);
    const { batch, observations } = loadStagedBatch(db, staged.batch.batch_id);
    const before = db.prepare('SELECT COUNT(*) n FROM roster_players').get().n;
    const res = applyPromotion(db, planPromotion({ batch, observations }, { frozen: new Set([2025]) }), { batchHash: batch.batch_hash });
    expect(db.prepare('SELECT COUNT(*) n FROM roster_players').get().n).toBe(before + 3);
    expect(revertManifest(db, res.manifest).reverted).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) n FROM roster_players').get().n).toBe(before);
    db.close();
  });
});
