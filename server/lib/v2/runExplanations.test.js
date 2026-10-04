import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../db/client.js';
import { seedPool, SEASON } from './seedTestPool.js';
import { computeMatchmakingV2, resultDigest, clearContextCache } from './matchmakingService.js';
import {
  persistRun, currentRun, readRun, programmeResult, storableExplanation,
} from './matchmakingRuns.js';

/**
 * A11 §7, §8, §9 — EXPLANATIONS ARE CAPTURED WITH THE RUN.
 *
 * ===========================================================================
 * THE PROPERTY: TURNING EXPLANATIONS ON CHANGES NO RANKING.
 *
 * `explainProgramme` is documented as read-only, and this is the test that
 * holds it to that: the same athlete, scored twice, once with explanations and
 * once without, must produce the IDENTICAL result digest. If it ever does not,
 * explanations have become an input to the model and this phase has broken its
 * own first rule.
 *
 * THE SECOND PROPERTY: AN EXPLANATION IS OF THE RUN IT WAS STORED WITH.
 * It is never recomputed later, because a later computation would describe
 * today's corpus beside a rank from the run's corpus, and the two are allowed
 * to disagree.
 * ===========================================================================
 */

const SPORT = 'mens-soccer';

const ATHLETE = {
  id: 'a-explain-1',
  full_name: 'Explanation Fixture',
  position: 'MIDFIELD',
  sport: SPORT,
  recruiting_class_year: 2027,
  football_ability: 6,
  max_annual_contribution_usd: 25000,
  contribution_state: 'STATED',
  competitive_level_priority: 3,
  playing_opportunity_priority: 4,
  academic_strength_priority: 3,
};

let player;

beforeAll(() => {
  clearContextCache();
  seedPool(SPORT);
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
                         recruiting_class_year, football_ability,
                         max_annual_contribution_usd, contribution_state,
                         competitive_level_priority, playing_opportunity_priority, academic_strength_priority)
    VALUES (@id, '2026-10-04T00:00:00.000Z', '2026-10-04T00:00:00.000Z', @full_name, @position, @sport,
            @recruiting_class_year, @football_ability,
            @max_annual_contribution_usd, @contribution_state,
            @competitive_level_priority, @playing_opportunity_priority, @academic_strength_priority)
  `).run(ATHLETE);
  player = db.prepare('SELECT * FROM players WHERE id = ?').get(ATHLETE.id);
});

describe('A11 §9. explanations are a read, not an input', () => {
  it('X-S1. the result digest is IDENTICAL with and without explanations', () => {
    const plain = computeMatchmakingV2(db, player);
    const explained = computeMatchmakingV2(db, player, { withExplanations: true });

    expect(resultDigest(explained)).toBe(resultDigest(plain));

    /** And every rank, in order, is the same object position. */
    expect(explained.programmes.map((p) => [p.name, p.rank ?? null, p.status]))
      .toEqual(plain.programmes.map((p) => [p.name, p.rank ?? null, p.status]));
  });

  it('X-S2. without the flag, nothing carries an explanation', () => {
    const plain = computeMatchmakingV2(db, player);
    expect(plain.programmes.some((p) => p.explanation)).toBe(false);
  });

  it('X-S3. with the flag, every programme carries one', () => {
    const explained = computeMatchmakingV2(db, player, { withExplanations: true });
    expect(explained.programmes.length).toBeGreaterThan(0);
    expect(explained.programmes.every((p) => p.explanation)).toBe(true);
  });
});

describe('A11 §7. what is stored, and what is read back', () => {
  it('X-S4. the stored form drops the duplicated and the client-unsafe parts', () => {
    const e = {
      subject: {}, standing: {}, layerSummary: {}, nextChecks: [],
      reasons: [{ code: 'A', layer: 'financial' }],
      layerReasons: { financial: [{ code: 'A', layer: 'financial' }] },
      gateEffects: [{ x: 1 }],
      evidenceQuality: [{ y: 2 }],
    };
    const stored = storableExplanation(e);
    expect(stored.reasons, 'the reasons survive').toHaveLength(1);
    expect(stored.layerReasons, 'regrouped at read, not stored twice').toBeUndefined();
    expect(stored.gateEffects, 'CLIENT_UNSAFE').toBeUndefined();
    expect(stored.evidenceQuality, 'CLIENT_UNSAFE').toBeUndefined();
  });

  it('X-S5. a persisted run reads back with layerReasons regrouped', () => {
    const result = computeMatchmakingV2(db, player, { withExplanations: true });
    const runId = persistRun(db, player, result);

    const one = programmeResult(db, runId, {
      collegeName: result.programmes[0].name, sport: SPORT,
    });
    expect(one.explanation, 'stored and returned').toBeTruthy();
    expect(Object.keys(one.explanation.layerReasons).sort())
      .toEqual(['financial', 'opportunity', 'recruitability']);

    /** Regrouping is by each reason's own `layer`, so the parts sum to the whole. */
    const grouped = Object.values(one.explanation.layerReasons).flat().length;
    const pipelineLevel = one.explanation.reasons.filter(
      (r) => !['recruitability', 'financial', 'opportunity'].includes(r.layer),
    ).length;
    expect(grouped + pipelineLevel).toBe(one.explanation.reasons.length);
  });

  it('X-S6. the LIST payload carries no explanations at all', () => {
    const result = computeMatchmakingV2(db, player, { withExplanations: true });
    persistRun(db, player, result);

    const run = readRun(db, currentRun(db, player.id));
    /**
     * ~3 KB each across a full universe is megabytes on a request every
     * surface makes on mount, to carry prose read for one card. The
     * per-programme route serves that one.
     */
    expect(run.programmes.some((p) => p.explanation)).toBe(false);
  });

  it('X-S7. a run persisted WITHOUT explanations reads back null, not empty prose', () => {
    const plain = computeMatchmakingV2(db, player);
    const runId = persistRun(db, player, plain);

    const one = programmeResult(db, runId, {
      collegeName: plain.programmes[0].name, sport: SPORT,
    });
    /**
     * This is every run that existed before A11. The UI says so rather than
     * reconstructing one from the score — the basis objects were never
     * stored, so any reconstruction would be invention.
     */
    expect(one.explanation ?? null).toBe(null);
  });
});
