/**
 * =============================================================================
 * DURABLE V2 RUNS — A9.2.
 *
 * A run is a historical record, so these tests are about what survives: that
 * a persisted run still says what it said after the player, the corpus or the
 * engine move, that nothing can half-write one, and that the derived half
 * rebuilds to exactly what the live service emitted.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache, resultDigest, STATUS } from './matchmakingService.js';
import {
  persistRun, currentRun, runById, readRun, programmeResult, runStaleness,
  inputSnapshot, inputDigest, INPUT_FIELDS, RESULT_SCHEMA_VERSION, INPUT_SCHEMA_VERSION, STALE_REASON,
} from './matchmakingRuns.js';
import { FREEZE_ENGINE_HEAD } from '../../../shared/matching/v2/freeze.js';

const created = [];

function athlete(extra = {}) {
  const row = Player.create({
    full_name: `A9.2 ${created.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    contribution_state: 'STATED',
    max_annual_contribution_usd: 25000,
    ...extra,
  });
  created.push(row.id);
  return Player.get(row.id);
}

const persisted = (player) => {
  const result = computeMatchmakingV2(db, player);
  return { result, runId: persistRun(db, player, result) };
};

beforeAll(() => { seedPool('mens-soccer'); seedPool('womens-soccer'); clearContextCache(); });
afterAll(() => { for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id); });

describe('A9.2 schema and V1 coexistence', () => {
  it('P1. the run tables exist with their indexes', () => {
    for (const t of ['matchmaking_runs', 'matchmaking_programme_results']) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)).toBeTruthy();
    }
    for (const i of ['idx_matchmaking_runs_player', 'idx_matchmaking_results_rank']) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(i), i).toBeTruthy();
    }
    /**
     * And deliberately NO index on college_id: the primary key already covers
     * (run_id, college_name, sport), which is the programme identity this
     * repository uses everywhere. Measured, the extra index cost 21% of the
     * table to save 0.05ms on a lookup.
     */
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_matchmaking_results_programme'").get())
      .toBeFalsy();
  });

  it('P2. nothing here reads or writes players.recommendations', () => {
    const a = athlete();
    db.prepare('UPDATE players SET recommendations = ? WHERE id = ?').run('/uploads/v1-blob.json', a.id);
    persisted(Player.get(a.id));
    expect(db.prepare('SELECT recommendations FROM players WHERE id=?').pluck().get(a.id))
      .toBe('/uploads/v1-blob.json');
  });

  it('P3. deleting an athlete takes their runs with them', () => {
    const a = athlete();
    persisted(a);
    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_programme_results r JOIN matchmaking_runs x ON x.id=r.run_id WHERE x.player_id=?').get(a.id).n)
      .toBeGreaterThan(0);
    db.prepare('DELETE FROM players WHERE id=?').run(a.id);
    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_runs WHERE player_id=?').get(a.id).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_programme_results r JOIN matchmaking_runs x ON x.id=r.run_id WHERE x.player_id=?').get(a.id).n).toBe(0);
  });
});

describe('A9.2 runs are immutable and versioned', () => {
  it('R1. a run records its matcher, engine, corpus, time and both schema versions', () => {
    const a = athlete();
    const { runId } = persisted(a);
    const row = runById(db, runId);
    expect(row.matcher_version).toBe('v2');
    expect(row.engine_freeze).toBe(FREEZE_ENGINE_HEAD);
    expect(row.corpus_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(row.result_schema_version).toBe(RESULT_SCHEMA_VERSION);
    expect(row.input_schema_version).toBe(INPUT_SCHEMA_VERSION);
    expect(typeof row.computed_at).toBe('string');
  });

  it('R2. recomputing writes a NEW run and leaves the old one exactly as it was', () => {
    const a = athlete();
    const first = persisted(a);
    const before = readRun(db, runById(db, first.runId));

    Player.update(a.id, { football_ability: 9 });
    const second = persisted(Player.get(a.id));
    expect(second.runId).not.toBe(first.runId);

    const after = readRun(db, runById(db, first.runId));
    expect(resultDigest(after)).toBe(resultDigest(before));
    expect(after.inputSnapshot.football_ability).toBe(6);
    /** And the newer run is the current one. */
    expect(currentRun(db, a.id).id).toBe(second.runId);
  });

  it('R3. the input snapshot carries what a ranking read, and no contact details', () => {
    const a = athlete({ intended_major: 'exercise science' });
    const { runId } = persisted(a);
    const snap = readRun(db, runById(db, runId)).inputSnapshot;
    expect(Object.keys(snap).sort()).toEqual([...INPUT_FIELDS].sort());
    expect(snap.intended_major).toBe('exercise science');
    for (const pii of ['guardian_email', 'club_coach_email', 'full_name', 'public_slug', 'highlights_url']) {
      expect(snap, pii).not.toHaveProperty(pii);
    }
  });

  it('R4. the snapshot digest is stable and order-independent', () => {
    const a = athlete();
    const snap = inputSnapshot(a);
    const shuffled = Object.fromEntries([...Object.entries(snap)].reverse());
    expect(inputDigest(shuffled)).toBe(inputDigest(snap));
  });

  it('R5. the full universe is persisted, not just the Top 100', () => {
    const a = athlete();
    const { result, runId } = persisted(a);
    const back = readRun(db, runById(db, runId));
    expect(back.programmes.length).toBe(result.programmes.length);
    expect(back.counts.ranked + back.counts.limitedData + back.counts.unsupported)
      .toBe(back.programmes.length);
  });

  it('R6. the persisted run round-trips to the canonical result exactly', () => {
    const a = athlete();
    const { result, runId } = persisted(a);
    const back = readRun(db, runById(db, runId));
    /** Byte-comparable, which is what makes "exactly" checkable rather than arguable. */
    expect(resultDigest(back)).toBe(resultDigest(result));

    const byId = new Map(back.programmes.map((p) => [p.programmeId, p]));
    for (const live of result.programmes) {
      const stored = byId.get(live.programmeId);
      expect(stored.status).toBe(live.status);
      expect(stored.rank ?? null).toBe(live.rank ?? null);
      expect(stored.pursuit ?? null).toBe(live.pursuit ?? null);
      /** Derived on read, and must agree with what the service emitted. */
      expect(stored.band ?? null).toBe(live.band ?? null);
      for (const L of ['recruitability', 'financial', 'opportunity']) {
        for (const k of ['value', 'grade', 'coverage', 'reason', 'state']) {
          expect(stored[L][k] ?? null, `${live.name}/${L}.${k}`).toBe(live[L][k] ?? null);
        }
      }
      if (live.missingLayers) expect(stored.missingLayers).toEqual(live.missingLayers);
    }
  });

  it('R7. scores survive storage at full precision', () => {
    const a = athlete();
    const { result, runId } = persisted(a);
    const stored = db.prepare('SELECT pursuit, recruitability, financial, opportunity, college_id FROM matchmaking_programme_results WHERE run_id=? AND rank IS NOT NULL').all(runId);
    const live = new Map(result.programmes.map((p) => [p.programmeId, p]));
    for (const row of stored) {
      const l = live.get(row.college_id);
      expect(Object.is(row.pursuit, l.pursuit), l.name).toBe(true);
      expect(Object.is(row.recruitability, l.recruitability.value ?? null)).toBe(true);
    }
    /** Ordering survives too: a rounding that changed order would show here. */
    const back = readRun(db, runById(db, runId)).programmes.filter((p) => p.status === STATUS.RANKED);
    for (let i = 1; i < back.length; i += 1) expect(back[i - 1].pursuit).toBeGreaterThanOrEqual(back[i].pursuit);
  });

  it('R8. a refusal is stored as NULL, never as a zero', () => {
    const a = athlete();
    const { runId } = persisted(a);
    const bad = db.prepare(`
      SELECT COUNT(*) n FROM matchmaking_programme_results
       WHERE run_id = ? AND status != 'RANKED' AND (pursuit = 0 OR recruitability = 0 OR financial = 0 OR opportunity = 0)`)
      .get(runId).n;
    expect(bad).toBe(0);
  });
});

describe('A9.2 transactional integrity', () => {
  it('T1. a failure part-way leaves zero partial run', () => {
    const a = athlete();
    const result = computeMatchmakingV2(db, a);
    const runsBefore = db.prepare('SELECT COUNT(*) n FROM matchmaking_runs').get().n;
    const rowsBefore = db.prepare('SELECT COUNT(*) n FROM matchmaking_programme_results').get().n;

    /**
     * A programme row that violates the status CHECK, placed in the middle, so
     * the write fails after the run row and some results are already inserted.
     */
    const poisoned = {
      ...result,
      programmes: result.programmes.map((p, i) => (i === 10 ? { ...p, status: 'NOT_A_REAL_STATUS' } : p)),
    };
    expect(() => persistRun(db, a, poisoned)).toThrow();

    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_runs').get().n).toBe(runsBefore);
    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_programme_results').get().n).toBe(rowsBefore);
  });
});

describe('A9.2 staleness is reported, never acted on', () => {
  let a; let runId;
  beforeEach(() => { a = athlete(); ({ runId } = persisted(a)); });

  it('N1. an untouched run is current', () => {
    expect(runStaleness(db, a, runById(db, runId))).toEqual({ current: true, reasons: [] });
  });

  it('N2. a changed athlete input is PLAYER_INPUT_CHANGED', () => {
    Player.update(a.id, { football_ability: 9 });
    const s = runStaleness(db, Player.get(a.id), runById(db, runId));
    expect(s.current).toBe(false);
    expect(s.reasons).toContain(STALE_REASON.PLAYER_INPUT_CHANGED);
  });

  it('N3. a changed scoring corpus is CORPUS_CHANGED', () => {
    const target = db.prepare("SELECT id FROM colleges WHERE sport='mens-soccer' AND active=1 LIMIT 1").pluck().get();
    db.prepare('UPDATE colleges SET soccer_score = COALESCE(soccer_score,0) + 1 WHERE id = ?').run(target);
    const s = runStaleness(db, a, runById(db, runId));
    expect(s.reasons).toContain(STALE_REASON.CORPUS_CHANGED);
  });

  it('N4. a different engine freeze is ENGINE_CHANGED, and is false under the current one', () => {
    expect(runStaleness(db, a, runById(db, runId)).reasons).not.toContain(STALE_REASON.ENGINE_CHANGED);
    const simulated = { ...runById(db, runId), engine_freeze: 'a'.repeat(40) };
    expect(runStaleness(db, a, simulated).reasons).toContain(STALE_REASON.ENGINE_CHANGED);
  });

  it('N5. nothing is deleted or recomputed by asking', () => {
    Player.update(a.id, { football_ability: 9 });
    const before = resultDigest(readRun(db, runById(db, runId)));
    runStaleness(db, Player.get(a.id), runById(db, runId));
    expect(resultDigest(readRun(db, runById(db, runId)))).toBe(before);
    expect(runById(db, runId)).toBeTruthy();
  });
});

describe('A9.2 historical retrieval', () => {
  it('H1. one programme is readable from a run without reading the run', () => {
    const a = athlete();
    const { result, runId } = persisted(a);
    const ranked = result.programmes.filter((p) => p.status === STATUS.RANKED);
    const deep = ranked[ranked.length - 1];
    const one = programmeResult(db, runId, { collegeId: deep.programmeId });
    expect(one.rank).toBe(deep.rank);
    expect(one.band).toBe(deep.band);
    expect(one.status).toBe(STATUS.RANKED);
    expect(programmeResult(db, runId, { collegeId: 'nope' })).toBe(null);
  });

  it('H2. a programme keeps its historical rank after the athlete changes', () => {
    const a = athlete();
    const { result, runId } = persisted(a);
    const top = result.programmes.find((p) => p.rank === 1);
    Player.update(a.id, { football_ability: 2 });
    persisted(Player.get(a.id));
    /** The point of the whole table: run X still says #1. */
    expect(programmeResult(db, runId, { collegeId: top.programmeId }).rank).toBe(1);
  });

  it('H3. the current run is the latest, and history is reachable by id', () => {
    const a = athlete();
    const first = persisted(a);
    const second = persisted(a);
    expect(currentRun(db, a.id).id).toBe(second.runId);
    expect(runById(db, first.runId).id).toBe(first.runId);
    expect(runById(db, 'no-such-run')).toBe(null);
  });
});
