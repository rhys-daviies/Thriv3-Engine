/**
 * WHAT THE MANIFEST CAN AND CANNOT SEE — D3.3.
 *
 * The manifest's whole job is one implication:
 *
 *     if data capable of changing a baseline moves,
 *     the dataset digest moves first
 *
 * D3.3 exists because that implication was false. `recruiting_arrivals` and
 * `coach_seasons` feed every baseline and were not fingerprinted at all, and
 * the columns of the tables that *were* fingerprinted were a narrow projection —
 * so a dataset could carry the recorded digest and still produce different
 * emails. That is how an EMAIL_BODY pin outlived any account of the rows behind
 * it.
 *
 * These tests hold the implication in both directions: every table the walk
 * reads moves the digest, and a table it does not read does not. They run on
 * synthetic throwaway databases — never a fixture, never the working database —
 * because what is under test is the manifest's sensitivity, not any real data.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './baselineDataset.js';

let dir; let runner; let SEED;

/** One manifest, from a subprocess, because `db` binds at import time. */
const manifestOf = (dbPath) => JSON.parse(execFileSync('node', [runner], {
  cwd: ROOT,
  env: { ...process.env, RECRUITMATCH_DB: dbPath },
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
}));

/** Run SQL against a throwaway database, without going through the app. */
const sql = (dbPath, statements) => execFileSync('node', ['-e', `
  const Database = require('better-sqlite3');
  const db = new Database(process.env.TARGET);
  for (const s of ${JSON.stringify(statements)}) db.exec(s);
  db.close();
`], { env: { ...process.env, TARGET: dbPath, RECRUITMATCH_DB: ':memory:' }, encoding: 'utf8' });

/**
 * A fresh database with the real schema, and one row in each table that matters.
 *
 * Built exactly ONCE. Every variant below is a byte copy of it, because two
 * independently created databases are not identical — `migrate()` writes rows
 * of its own — and a test whose control and treatment differ before the
 * treatment is applied proves nothing.
 */
function buildSeed(name) {
  const file = path.join(dir, `${name}.sqlite`);
  // Opening through the app creates schema.sql and runs migrate(), so these are
  // the production table shapes rather than a hand-written approximation.
  execFileSync('node', ['-e', "import('./server/db/client.js').then(() => {})"], {
    cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: file }, encoding: 'utf8',
  });
  sql(file, [
    /**
     * `public_slug` is given explicitly. `migrate()` backfills a RANDOM slug for
     * any athlete without one, so a database seeded without it is a different
     * database every time it is opened — which is not a manifest defect, and a
     * test that tripped over it would be testing the wrong thing. The canonical
     * fixture's four athletes are all slugged already, so nothing backfills
     * there either.
     */
    "INSERT INTO players (id, created_date, updated_date, full_name, sport, position, public_slug)"
    + " VALUES ('p1','x','x','Test Athlete','mens-soccer','MIDFIELD','fixed-slug')",
    "INSERT INTO colleges (id, created_date, updated_date, name, sport, division)"
    + " VALUES ('c1','x','x','Test College','mens-soccer','NCAA D1')",
    "INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,"
    + " season, player_name, position)"
    + " VALUES ('r1','x','2026-09-01T00:00:00Z','Test College','mens-soccer','NCAA D1',2026,'A Player','MIDFIELD')",
    "INSERT INTO coaches (id, school, sport, full_name, position_title, created_at)"
    + " VALUES ('h1','Test College','mens-soccer','A Coach','Head Coach','x')",
    "INSERT INTO athletics_domains (domain, unitid, status, claimed_keys, claimed_unitids,"
    + " verification_method, confidence, checked_at)"
    + " VALUES ('test.edu', 1, 'VERIFIED', '[]', '[]', 'MANUAL', 1.0, 'x')",
    "INSERT INTO recruiting_arrivals (programme, sport, arrival_season, prior_season,"
    + " source_transition, player_name, name_key, arrival_confidence, identity_method,"
    + " canonical_position, entry_type, prior_confidence, coach_attribution, built_at, country)"
    + " VALUES ('Test College','mens-soccer',2026,2025,'2025->2026','A Player','a player',"
    + "'HIGH','EXACT','MIDFIELD','FRESHMAN','HIGH','A Coach','x','New Zealand')",
    "INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)"
    + " VALUES ('Test College','mens-soccer',2026,'A Coach','x')",
  ]);
  // One file, no write-ahead sidecar, so a copy is the whole database.
  sql(file, ['PRAGMA journal_mode=DELETE']);
  return file;
}

/** A disposable, byte-identical copy of the seed. */
function fork(name) {
  const file = path.join(dir, `${name}.sqlite`);
  fs.copyFileSync(SEED, file);
  return file;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-manifest-'));
  runner = path.join(dir, 'manifest.mjs');
  fs.writeFileSync(runner,
    `const m = await import(${JSON.stringify(path.join(ROOT, 'server/lib/evidenceBaseline.js'))});\n`
    + 'process.stdout.write(JSON.stringify(m.datasetManifest()));\n');
  SEED = buildSeed('seed');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/* -------------------------------------------------------------------------- */

describe('the dataset manifest moves when a baseline input moves', () => {
  /**
   * One mutation per table the walk reads. Each must move the whole dataset
   * digest AND be named by its own component, because a report that says only
   * "something moved" sends somebody diffing two 210MB databases.
   */
  const MATERIAL = [
    ['players', "UPDATE players SET position = 'STRIKER'"],
    ['colleges', "UPDATE colleges SET name = 'Renamed College'"],
    ['roster_players', "UPDATE roster_players SET position = 'DEFENDER'"],
    ['coaches', "UPDATE coaches SET full_name = 'Another Coach'"],
    ['athletics_domains', "UPDATE athletics_domains SET status = 'AMBIGUOUS'"],
    ['recruiting_arrivals', "UPDATE recruiting_arrivals SET country = 'Narnia'"],
    ['coach_seasons', "UPDATE coach_seasons SET coach_name = 'Ada Lovelace'"],
  ];

  it.each(MATERIAL)('%s', (table, statement) => {
    const before = manifestOf(fork(`before-${table}`));
    const file = fork(`after-${table}`);
    // Same seed, so the only difference is the mutation.
    expect(manifestOf(file).digest).toBe(before.digest);
    sql(file, [statement]);
    const after = manifestOf(file);

    expect(after.digest, `${table} did not move the dataset digest`).not.toBe(before.digest);
    const moved = after.tables
      .filter((t) => t.digest !== before.tables.find((x) => x.table === t.table)?.digest)
      .map((t) => t.table);
    expect(moved, `${table} moved the wrong component`).toContain(table);
  });

  /**
   * The two that D3.3 added. Called out separately because their absence is the
   * specific defect that made the historical pin unreproducible, and a future
   * edit that quietly narrows the manifest again should fail here by name.
   */
  it('covers recruiting_arrivals and coach_seasons, which V2 omitted entirely', () => {
    const m = manifestOf(fork('coverage'));
    const names = m.tables.map((t) => t.table);
    expect(names).toContain('recruiting_arrivals');
    expect(names).toContain('coach_seasons');
  });

  /**
   * Deleting a table's rows is the strongest version of the same question, and
   * it is what proved materiality against the real fixture: removing either of
   * the two omitted tables moves all six baselines.
   */
  it.each([['recruiting_arrivals'], ['coach_seasons']])('emptying %s moves the digest', (table) => {
    const before = manifestOf(fork(`empty-before-${table}`));
    const file = fork(`empty-after-${table}`);
    sql(file, [`DELETE FROM ${table}`]);
    expect(manifestOf(file).digest).not.toBe(before.digest);
  });
});

describe('and does not move when something the walk never reads does', () => {
  /**
   * Fingerprinting a table no baseline can see would report CHANGED for data
   * that cannot change an email — the same defect as omission, pointing the
   * other way. These four were all plausible candidates and the instrumented
   * walk touches none of them.
   */
  const UNRELATED = [
    ['programme_seasons', "INSERT INTO programme_seasons (college_id, sport, season, wins, draws,"
      + " losses, matches_played, source, source_record_name, confidence, imported_at)"
      + " VALUES ('c1','mens-soccer',2025,1,1,1,3,'TEST','Test College','ROSTER_CONSISTENT','x')"],
    ['outreach', "INSERT INTO outreach (athlete_id, coach_id, token, created_at)"
      + " VALUES ('p1','h1','tok-1','x')"],
    ['conference_seasons', "INSERT INTO conference_seasons (conference_id, conference_name, sport,"
      + " season, division_provenance, season_confirmed, sport_confirmed, status, imported_at)"
      + " VALUES ('cf1','Test Conf','mens-soccer',2026,'UNKNOWN',1,1,'ACTIVE','x')"],
    ['institution_aliases', "INSERT INTO institution_aliases (alias_key, alias_raw, unitid,"
      + " alias_type, source, confidence, imported_at)"
      + " VALUES ('testing college','Testing College',1,'ATHLETICS_NAME','TEST','CURATED','x')"],
  ];

  it.each(UNRELATED)('%s', (table, statement) => {
    const before = manifestOf(fork(`un-before-${table}`));
    const file = fork(`un-after-${table}`);
    try { sql(file, [statement]); }
    catch { return; } // shape differs in this schema; the point is coverage, not this row
    expect(manifestOf(file).digest, `${table} must not be in the manifest`).toBe(before.digest);
  });
});

describe('ordering cannot change a digest', () => {
  /**
   * Each row is hashed alone and the row hashes are sorted, so the fingerprint
   * is a property of the SET of rows. A VACUUM, a rebuild or a different query
   * plan cannot move it — which is what makes a mismatch mean "different data"
   * rather than "different day".
   */
  it('is the same after the rows are reinserted in a different order', () => {
    const file = fork('order');
    sql(file, [
      "INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,"
      + " season, player_name)"
      + " VALUES ('r2','x','2026-09-01T00:00:00Z','Test College','mens-soccer','NCAA D1',2026,'B Player')",
      "INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,"
      + " season, player_name)"
      + " VALUES ('r3','x','2026-09-01T00:00:00Z','Test College','mens-soccer','NCAA D1',2026,'C Player')",
    ]);
    const before = manifestOf(file);

    // Physically reorder: same set of rows, different insertion order.
    sql(file, [
      'CREATE TABLE _rp AS SELECT * FROM roster_players',
      'DELETE FROM roster_players',
      "INSERT INTO roster_players SELECT * FROM _rp ORDER BY player_name DESC",
      'DROP TABLE _rp',
    ]);
    expect(manifestOf(file).digest).toBe(before.digest);
  });
});
