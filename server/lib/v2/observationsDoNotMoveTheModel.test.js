/**
 * =============================================================================
 * OBSERVATIONS ARE NOT INPUTS — A9.6 §AA.
 *
 * The single claim this whole phase rests on: Thriv3 can now record what
 * happened, and recording it changes NOTHING about what Thriv3 believes.
 *
 * This matters more than it sounds. The moment an outcome quietly reaches a
 * weight, the engine stops being the frozen, auditable thing the V2 freeze
 * describes and becomes something that drifts - and the drift would be
 * invisible, because every ranking would still look like a ranking.
 *
 * So: compute V2, fill the database with observations of every category
 * including offers, commitments and flat refusals, recompute, and require the
 * two results to be IDENTICAL - not similar, not close, identical across every
 * rank, layer, pursuit value and evidence state.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache, STATUS } from './matchmakingService.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { persistRun, currentRun } from './matchmakingRuns.js';
import { recordSelection, SELECTION_SOURCE } from './matchmakingSelection.js';
import {
  recordObservation, OBSERVATION_KIND, OBSERVATION_SOURCE, CLASSIFIER_METHOD,
} from './recruitingObservations.js';

const K = OBSERVATION_KIND;
const players = [];
let player;
let before;
let runRow;

function athlete() {
  const row = Player.create({
    full_name: `A9.6 AA ${players.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    contribution_state: 'STATED',
    max_annual_contribution_usd: 25000,
  });
  players.push(row.id);
  return Player.get(row.id);
}

/**
 * Everything except `computedAt`, which is a clock reading and is the only
 * field expected to differ between two runs of a deterministic engine.
 */
const comparable = (result) => ({
  sport: result.sport,
  programmes: result.programmes.map((p) => ({
    name: p.name,
    status: p.status,
    rank: p.rank ?? null,
    band: p.band ?? null,
    pursuit: p.pursuit ?? null,
    recruitability: p.recruitability ?? null,
    financial: p.financial ?? null,
    opportunity: p.opportunity ?? null,
    coverage: p.coverage ?? null,
    grade: p.grade ?? null,
  })),
});

beforeAll(() => {
  seedPool('mens-soccer', { count: 140, unscoreable: 6 });
  seedPool('womens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
  player = athlete();
  before = computeMatchmakingV2(db, player);
  persistRun(db, player, before);
  runRow = currentRun(db, player.id);
});

afterAll(() => {
  for (const id of players) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

/** A representative spread: every category, every classifier, both polarities. */
function fillWithObservations() {
  const ranked = before.programmes
    .filter((p) => p.status === STATUS.RANKED)
    .slice(0, 12);
  expect(ranked.length).toBeGreaterThan(5);

  const spread = [
    [K.ROSTER_PLACE_OFFERED, OBSERVATION_SOURCE.COACH_REPLY, null],
    [K.FINANCIAL_OFFER, OBSERVATION_SOURCE.COACH_REPLY, null],
    [K.COMMITTED, OBSERVATION_SOURCE.ATHLETE, null],
    [K.DECLINED_ATHLETE, OBSERVATION_SOURCE.COACH_REPLY, null],
    [K.NEGATIVE_REPLY, OBSERVATION_SOURCE.COACH_REPLY, null],
    [K.POSITIVE_REPLY, OBSERVATION_SOURCE.COACH_REPLY, null],
    [K.POSITION_FILLED, OBSERVATION_SOURCE.COACH_CALL, { position: 'MIDFIELD', recruitingClassYear: 2028 }],
    [K.POSITION_NEEDED, OBSERVATION_SOURCE.COACH_CALL, { position: 'GOALKEEPER' }],
    [K.ROSTER_COMPLETE, OBSERVATION_SOURCE.COACH_REPLY, null],
    [K.ATHLETE_NOT_INTERESTED, OBSERVATION_SOURCE.ATHLETE, null],
    [K.ATHLETE_WITHDREW, OBSERVATION_SOURCE.ATHLETE, null],
    [K.REQUESTED_CALL, OBSERVATION_SOURCE.COACH_REPLY, null],
  ];

  let written = 0;
  spread.forEach(([kind, source, attributes], i) => {
    const programme = ranked[i % ranked.length];
    const selection = recordSelection(db, player, {
      runId: runRow.id,
      collegeName: programme.name,
      sport: runRow.sport,
      source: SELECTION_SOURCE.TOP_100,
    });
    recordObservation(db, {
      athleteId: player.id,
      collegeName: programme.name,
      sport: runRow.sport,
      matchmakingSelectionId: selection.id,
      kind,
      attributes,
      source,
      classifierMethod: i % 3 === 0 ? CLASSIFIER_METHOD.AI_ASSISTED : CLASSIFIER_METHOD.MANUAL,
      classifierVersion: i % 3 === 0 ? 'reply-clf-0.1' : null,
      confidence: i % 3 === 0 ? 0.8 : null,
    });
    written += 1;
  });
  return written;
}

describe('A9.6 §AA. observations are not V2 inputs', () => {
  it('AA1. a database full of outcomes recomputes to an identical result', () => {
    const written = fillWithObservations();
    expect(written).toBe(12);
    expect(db.prepare('SELECT COUNT(*) n FROM recruiting_observations WHERE athlete_id = ?')
      .get(player.id).n).toBe(12);

    clearContextCache();
    clearCorpusDigestCache();
    const after = computeMatchmakingV2(db, player);

    expect(comparable(after)).toEqual(comparable(before));
  });

  it('AA2. every rank, band and pursuit value is unchanged, cell by cell', () => {
    clearContextCache();
    const after = computeMatchmakingV2(db, player);
    const byName = new Map(before.programmes.map((p) => [p.name, p]));

    let compared = 0;
    for (const p of after.programmes) {
      const was = byName.get(p.name);
      expect(was).toBeDefined();
      expect(p.rank ?? null).toBe(was.rank ?? null);
      expect(p.band ?? null).toBe(was.band ?? null);
      expect(p.pursuit ?? null).toBe(was.pursuit ?? null);
      expect(p.status).toBe(was.status);
      compared += 1;
    }
    expect(compared).toBe(before.programmes.length);
    expect(compared).toBeGreaterThan(100);
  });

  it('AA3. the three layers are unchanged, including their evidence grades', () => {
    clearContextCache();
    const after = computeMatchmakingV2(db, player);
    const byName = new Map(before.programmes.map((p) => [p.name, p]));

    for (const p of after.programmes) {
      const was = byName.get(p.name);
      for (const layer of ['recruitability', 'financial', 'opportunity']) {
        expect(JSON.stringify(p[layer] ?? null)).toBe(JSON.stringify(was[layer] ?? null));
      }
      expect(p.coverage ?? null).toEqual(was.coverage ?? null);
      expect(p.grade ?? null).toBe(was.grade ?? null);
    }
  });

  it('AA4. no engine module reads the observation tables', () => {
    // The structural half of the same claim: proved by import, not by output.
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.resolve(process.cwd(), 'shared/matching/v2');
    const offenders = [];
    for (const f of fs.readdirSync(root)) {
      if (!f.endsWith('.js') || f.endsWith('.test.js')) continue;
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      if (/recruiting_observations|recruitingObservations|matchmaking_selections|outreach_send/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
