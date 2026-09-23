import { describe, it, expect } from 'vitest';
import { runPursuit } from './pursuitRun.js';
import { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } from './rosterEvidence.js';
import { abilityToProgrammeScore } from '../../../shared/matching/v2/index.js';

/**
 * THE STRUCTURAL GUARD FOR ATHLETIC RECRUITING COMPATIBILITY.
 *
 * A7.7.11 found that programmes at the athlete's own level were being pushed
 * to the bottom of the ranking - 28 of them for the Fixture A athlete, median
 * rank 463, two inside the first hundred - because compatibility was one half
 * at parity and multiplies recruitability. A7.7.13 replaced the curve.
 *
 * These tests exist so that neither the compression nor its opposite can
 * return silently. They assert the SHAPE of the ranking against the athlete's
 * own level, not a division mix and not a target distribution:
 *
 *   1. programmes at the athlete's level reach the front of the list;
 *   2. programmes far above the athlete do not;
 *   3. the two hold for a strong athlete and for a developmental one;
 *   4. they hold whether or not a competitive-level preference is declared.
 *
 * The pool is synthetic so the test is deterministic, but the axis is the
 * pinned production calibration, so "at level" means the same thing here as
 * it does in a real run.
 */

const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA'];

/** A strength ladder that covers the whole axis, with rungs at both athletes' own levels. */
const SCORES = [];
for (let s = 20; s <= 99; s += 1) SCORES.push(s);

const colleges = SCORES.map((score, i) => ({
  id: `c${i}`, name: `College ${String(score).padStart(3, '0')}`,
  division: DIVISIONS[i % DIVISIONS.length], conference: `Conf ${i % 9}`,
  control: (i % 3 === 0) ? 1 : 2,
  net_price: 12000 + ((i * 397) % 9000),
  tuition_in_state: 9000 + ((i * 97) % 6000),
  tuition_out_state: 21000 + ((i * 131) % 14000),
  state: 'OH',
  soccer_score: score,
  recent_win_pct: 0.5, prior_win_pct: 0.5,
  notable_majors: '["Business"]',
}));

/**
 * Identical roster evidence at every programme, so nothing except athletic
 * compatibility and the athlete's own preference can separate them by level.
 */
const roster = colleges.flatMap((c, i) => Array.from({ length: 12 }, (_, j) => ({
  college_name: c.name, player_name: `p${i}-${j}`,
  position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
  class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.'][j % 5],
  division: c.division, season: '2026',
  minutes_played: null, projected_minutes: j % 3 === 0 ? 1200 : 100,
  games_started: null, projected_games_started: null,
})));

const arrivals = colleges.flatMap((c, i) => Array.from({ length: 10 }, (_, j) => ({
  programme: c.name, sport: 'mens-soccer', arrival_season: '2026',
  canonical_position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
  is_international: (i + j) % 4 === 0 ? 1 : 0,
})));

const ctx = {
  rosterProgrammes: new Set(roster.map((r) => r.college_name)),
  rosterIndex: buildPositionIndex(roster),
  arrivalIndex: buildArrivalIndex(arrivals),
  divisionArrivals: divisionArrivalRates(arrivals, new Map(colleges.map((c) => [c.name, c]))),
  arrivalsHorizon: 2026,
};

const rank = (rating, level = null, playing = null) => {
  const rep = runPursuit({
    athlete: {
      label: { id: 'guard' },
      v1Shape: { sport: 'mens-soccer', budgetRange: '$40k+/yr', state: 'OH', origin: 'USA' },
      recruitability: { sport: 'mens-soccer', rating, position: 'MIDFIELD', entryYear: 2028, isInternational: false },
      opportunity: {
        sport: 'mens-soccer', position: 'MIDFIELD', rating,
        intendedMajor: null, priorityRanking: null,
        competitiveLevelPriority: level, playingOpportunityPriority: playing,
      },
    },
    sport: 'mens-soccer', colleges, ctx,
  });
  const byName = new Map(colleges.map((c) => [c.name, c]));
  return rep.pipeline.ranked.map((e) => ({
    name: e.name, rank: e.rank, strength: byName.get(e.name).soccer_score,
  }));
};

const equivalent = (rating) => abilityToProgrammeScore(rating, 'mens-soccer');
const band = (rows, eq, lo, hi) => rows.filter((r) => r.strength - eq >= lo && r.strength - eq < hi);
const front = (rows) => Math.ceil(rows.length * 0.1); // the first decile stands in for the outreach slice

const medianRank = (rows) => (rows.length
  ? [...rows.map((r) => r.rank)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]
  : null);

describe('an athlete who asks for competitive level gets programmes at their level', () => {
  /**
   * The A7.7.11 defect stated so it cannot come back. Before A7.7.13 this
   * failed for every rating: compatibility was one half at parity, it
   * multiplies recruitability, and no amount of level preference could lift
   * the at-level band past programmes far below the athlete.
   */
  it.each([
    ['a strong athlete', 9],
    ['a mid athlete', 6],
    ['a developmental athlete', 3],
  ])('%s', (_label, rating) => {
    const rows = rank(rating, 5, 1);
    const eq = equivalent(rating);
    const atLevel = band(rows, eq, -3, 3);
    expect(atLevel.length, 'the ladder must contain programmes at this level').toBeGreaterThan(0);
    const inFront = atLevel.filter((r) => r.rank <= front(rows));
    expect(inFront.length, `no at-level programme reached the front decile for rating ${rating}`).toBeGreaterThan(0);
    expect(medianRank(atLevel)).toBeLessThan(rows.length * 0.25);
  });
});

describe('declaring a competitive-level preference materially moves the at-level band', () => {
  /**
   * Not a claim about how far it should move, only that it must move a long
   * way. If a future change quietly re-flattens compatibility, the preference
   * stops having anywhere to lift these programmes from and this fails.
   */
  it.each([
    ['a strong athlete', 9],
    ['a mid athlete', 6],
  ])('%s', (_label, rating) => {
    const eq = equivalent(rating);
    const undeclared = medianRank(band(rank(rating, null, null), eq, -3, 3));
    const declared = medianRank(band(rank(rating, 5, 1), eq, -3, 3));
    expect(declared).toBeLessThan(undeclared / 2);
  });
});

describe('programmes far above the athlete stay out of the front of the list', () => {
  it.each([
    ['a strong athlete, no preference declared', 9, null, null],
    ['a strong athlete who asked for level', 9, 5, 1],
    ['a mid athlete who asked for level', 6, 5, 1],
    ['a developmental athlete who asked for level', 3, 5, 1],
  ])('%s', (_label, rating, level, playing) => {
    const rows = rank(rating, level, playing);
    const eq = equivalent(rating);
    const farAbove = band(rows, eq, 10, Infinity);
    const intruders = farAbove.filter((r) => r.rank <= front(rows));
    expect(intruders.map((r) => `${r.name} #${r.rank}`)).toEqual([]);
  });
});

describe('the ranking degrades sensibly away from the athlete\'s level', () => {
  it('ranks an at-level programme ahead of one far above it', () => {
    const rows = rank(9, 5, 1);
    const eq = equivalent(9);
    const at = band(rows, eq, -3, 3).sort((a, b) => a.rank - b.rank)[0];
    const far = band(rows, eq, 10, Infinity).sort((a, b) => a.rank - b.rank)[0];
    expect(at.rank).toBeLessThan(far.rank);
  });

  it('does not promote a far-above programme over an at-level one for a developmental athlete', () => {
    const rows = rank(3, 5, 1);
    const eq = equivalent(3);
    const at = band(rows, eq, -3, 3).sort((a, b) => a.rank - b.rank)[0];
    const far = band(rows, eq, 10, Infinity).sort((a, b) => a.rank - b.rank)[0];
    expect(at.rank).toBeLessThan(far.rank);
  });

  it('still leaves the whole universe ranked, with no binary cut', () => {
    // Top 100 is an outreach slice, not a match test: every scoreable
    // programme keeps a place in one ordering.
    const rows = rank(9, 5, 1);
    expect(rows.length).toBe(colleges.length);
    expect(new Set(rows.map((r) => r.rank)).size).toBe(rows.length);
  });
});
