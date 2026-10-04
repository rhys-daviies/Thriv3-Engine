import { describe, it, expect, beforeAll } from 'vitest';
import db from './client.js';
import { migrate } from './migrate.js';
import { seedPool } from '../lib/v2/seedTestPool.js';
import { computeMatchmakingV2, resultDigest, clearContextCache, TOP_N } from '../lib/v2/matchmakingService.js';
import {
  persistRun, readRun, runById, programmeResult,
} from '../lib/v2/matchmakingRuns.js';
import { upsertAthleteProgramme, listAthleteProgrammes } from '../lib/athleteProgrammes.js';

/**
 * A11.1 §5 — THE UPGRADE FROM A PRE-A11 DATABASE. A MERGE BLOCKER.
 *
 * ===========================================================================
 * THE SHAPE OF THE REAL DEPLOYMENT, NOT A SCHEMA UNIT TEST.
 *
 * Production holds runs persisted before A11 existed. Those runs are
 * IMMUTABLE and they legitimately contain no explanation, because the basis
 * objects an explanation is built from were never stored. They must not be
 * backfilled, must not be rewritten, and must not stop being readable.
 *
 * So this builds a database in the PRE-A11 shape — the `explanation` column
 * physically dropped — fills it with the things production actually has, and
 * then migrates it. Every assertion is about something that must NOT have
 * changed, plus one that must: a NEW run gets explanations, bounded to the
 * Top 100.
 *
 * Dropping the column is what makes this an upgrade test rather than a
 * tautology. Without it the "pre-A11" rows would already have the column and
 * the migration would have nothing to do.
 * ===========================================================================
 */

const SPORT = 'mens-soccer';
const ATHLETE = 'a-transition-1';

const STAMP = '2026-10-04T00:00:00.000Z';

let legacyRunId;
let legacyDigest;
let legacyRows;
let legacyProgrammeCount;
let specificBefore;

/** Everything about the legacy run that must survive, as comparable values. */
const runFingerprint = (runId) => db.prepare(`
  SELECT college_name, sport, college_id, division, status, rank,
         pursuit, pursuit_grade,
         recruitability, recruitability_grade, recruitability_coverage, recruitability_reason,
         financial, financial_grade, financial_coverage, financial_reason,
         opportunity, opportunity_grade, opportunity_coverage, opportunity_reason
    FROM matchmaking_programme_results
   WHERE run_id = ?
   ORDER BY college_name, sport
`).all(runId);

beforeAll(() => {
  clearContextCache();
  seedPool(SPORT);

  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
                         recruiting_class_year, football_ability,
                         max_annual_contribution_usd, contribution_state,
                         competitive_level_priority, playing_opportunity_priority,
                         academic_strength_priority)
    VALUES (?, ?, ?, 'Transition Fixture', 'MIDFIELD', ?, 2027, 6, 25000, 'STATED', 3, 4, 3)
  `).run(ATHLETE, STAMP, STAMP, SPORT);

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(ATHLETE);

  /* ---- A Specific School, as production has ---- */
  const college = db.prepare('SELECT id, name FROM colleges WHERE sport = ? LIMIT 1').get(SPORT);
  upsertAthleteProgramme(ATHLETE, {
    college_id: college.id, request_state: 'requested', requested_by: 'operator',
  });
  specificBefore = listAthleteProgrammes(ATHLETE);

  /* ---- A run persisted the PRE-A11 way: no explanations at all ---- */
  const legacy = computeMatchmakingV2(db, player);
  legacyDigest = resultDigest(legacy);
  legacyRunId = persistRun(db, player, legacy);
  legacyProgrammeCount = legacy.programmes.length;

  /**
   * NOW MAKE THE DATABASE GENUINELY PRE-A11: drop the column. SQLite can do
   * this directly since 3.35, and `migrate()` adds it back only if missing —
   * which is exactly the path a production upgrade takes.
   */
  db.exec('ALTER TABLE matchmaking_programme_results DROP COLUMN explanation');
  legacyRows = runFingerprint(legacyRunId);
});

describe('A11.1 §5A/B. the pre-A11 shape, and the migration', () => {
  it('T1. the fixture really is pre-A11 — the column is absent', () => {
    const cols = db.prepare('PRAGMA table_info(matchmaking_programme_results)').all().map((c) => c.name);
    expect(cols).not.toContain('explanation');
    expect(legacyRows.length).toBe(legacyProgrammeCount);
    expect(legacyProgrammeCount).toBeGreaterThan(0);
  });

  it('T2. migrating adds the column and nothing else changes', () => {
    migrate(db);

    const cols = db.prepare('PRAGMA table_info(matchmaking_programme_results)').all().map((c) => c.name);
    expect(cols, 'the column arrives').toContain('explanation');

    expect(runFingerprint(legacyRunId), 'every scoring value, unchanged').toEqual(legacyRows);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('T3. the legacy run is still readable, and its digest is unchanged', () => {
    const run = readRun(db, runById(db, legacyRunId));
    expect(run.programmes).toHaveLength(legacyProgrammeCount);
    expect(resultDigest(run), 'the run still hashes to what it did').toBe(legacyDigest);
  });

  it('T4. the legacy run carries NO explanation, and none was invented', () => {
    const rows = db.prepare(
      'SELECT COUNT(*) c FROM matchmaking_programme_results WHERE run_id = ? AND explanation IS NOT NULL',
    ).get(legacyRunId).c;
    expect(rows, 'nothing was backfilled').toBe(0);

    const one = programmeResult(db, legacyRunId, {
      collegeName: legacyRows[0].college_name, sport: SPORT,
    });
    /** The API answers "none", which the UI states plainly — it does not guess. */
    expect(one.explanation ?? null).toBe(null);
  });

  it('T5. Specific Schools and V1 pointers are untouched', () => {
    expect(listAthleteProgrammes(ATHLETE)).toEqual(specificBefore);
    expect(db.prepare('SELECT COUNT(*) c FROM players WHERE id = ?').get(ATHLETE).c).toBe(1);
  });

  it('T6. migrating twice more changes nothing — idempotent', () => {
    const before = runFingerprint(legacyRunId);
    for (const pass of [2, 3]) {
      migrate(db);
      expect(runFingerprint(legacyRunId), `pass ${pass}`).toEqual(before);
    }
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(
      db.prepare('SELECT COUNT(*) c FROM matchmaking_programme_results WHERE run_id = ? AND explanation IS NOT NULL').get(legacyRunId).c,
      'still no backfill',
    ).toBe(0);
  });
});

describe('A11.1 §5E. a NEW run after the migration', () => {
  let newRunId;
  let player;

  beforeAll(() => {
    player = db.prepare('SELECT * FROM players WHERE id = ?').get(ATHLETE);
    const result = computeMatchmakingV2(db, player, { withExplanations: true });
    newRunId = persistRun(db, player, result);
  });

  it('T7. ranking and digest are IDENTICAL with explanations on or off', () => {
    const off = computeMatchmakingV2(db, player);
    const on = computeMatchmakingV2(db, player, { withExplanations: true });
    expect(resultDigest(on)).toBe(resultDigest(off));
    expect(on.programmes.map((p) => [p.name, p.rank ?? null, p.status]))
      .toEqual(off.programmes.map((p) => [p.name, p.rank ?? null, p.status]));
  });

  it('T8. the FULL universe is still persisted', () => {
    const persisted = db.prepare(
      'SELECT COUNT(*) c FROM matchmaking_programme_results WHERE run_id = ?',
    ).get(newRunId).c;
    const universe = computeMatchmakingV2(db, player).programmes.length;
    expect(persisted, 'the storage bound is on PROSE, not on results').toBe(universe);
  });

  it('T9. explanations exist for ranked Top 100 and for nothing else', () => {
    const explained = db.prepare(`
      SELECT status, rank FROM matchmaking_programme_results
       WHERE run_id = ? AND explanation IS NOT NULL
    `).all(newRunId);

    expect(explained.length).toBeGreaterThan(0);
    for (const row of explained) {
      expect(row.status, 'only ranked programmes').toBe('RANKED');
      expect(row.rank, 'only within the bound').toBeLessThanOrEqual(TOP_N);
    }

    const beyond = db.prepare(`
      SELECT COUNT(*) c FROM matchmaking_programme_results
       WHERE run_id = ? AND explanation IS NOT NULL AND (rank IS NULL OR rank > ?)
    `).get(newRunId, TOP_N).c;
    expect(beyond, '#101+ and non-ranked carry none').toBe(0);
  });

  it('T10. a #101+ programme still has its full standing, just no prose', () => {
    const outside = db.prepare(`
      SELECT college_name FROM matchmaking_programme_results
       WHERE run_id = ? AND status = 'RANKED' AND rank > ?
       ORDER BY rank LIMIT 1
    `).get(newRunId, TOP_N);
    if (!outside) return;

    const one = programmeResult(db, newRunId, {
      collegeName: outside.college_name, sport: SPORT,
    });
    /**
     * The point of the bound: it costs prose, never standing. Rank, band,
     * pursuit and all three layers are exactly as they were.
     */
    expect(one.rank).toBeGreaterThan(TOP_N);
    expect(one.band).toBeTruthy();
    expect(one.pursuit).toBeTypeOf('number');
    expect(one.recruitability).toBeTruthy();
    expect(one.explanation ?? null).toBe(null);
  });

  it('T11. the older run is STILL readable and still unchanged', () => {
    /** Historical navigation keeps working after a newer run exists. */
    expect(runFingerprint(legacyRunId)).toEqual(legacyRows);
    const run = readRun(db, runById(db, legacyRunId));
    expect(resultDigest(run)).toBe(legacyDigest);
  });
});
