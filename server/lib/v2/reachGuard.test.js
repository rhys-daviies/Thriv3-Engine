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
   *
   * -- WHY THE THRESHOLD CHANGED AT A7.18 ---------------------------------
   *
   * This asserted `declared < undeclared / 2`, which assumed the undeclared
   * athlete's at-level band starts out badly placed. A7.14 measured that it
   * did, and that it was the WORST of the three profiles. The level anchor
   * exists to fix exactly that, and it applies at tau(3) to an athlete who
   * has stated nothing, so the undeclared baseline is now good: median rank
   * 14 for a rating 9 against 7 declared, and 6 against 4 for a rating 6.
   * Halving a number that is already near the front is not a property worth
   * asserting, and the ratio failed by a single place.
   *
   * What is asserted instead is the SPREAD the preference produces, which is
   * the thing the guard was really protecting: an athlete who asks for level
   * and an athlete who asks for playing time must get visibly different
   * bands, and declaring level must never be worse than saying nothing.
   */
  it.each([
    ['a strong athlete', 9],
    ['a mid athlete', 6],
  ])('%s', (_label, rating) => {
    const eq = equivalent(rating);
    const undeclared = medianRank(band(rank(rating, null, null), eq, -3, 3));
    const levelFirst = medianRank(band(rank(rating, 5, 1), eq, -3, 3));
    const playingFirst = medianRank(band(rank(rating, 1, 5), eq, -3, 3));

    // Declaring level never costs an at-level programme its place.
    expect(levelFirst).toBeLessThanOrEqual(undeclared);
    // And the two opposite statements are far apart, not cosmetically apart.
    expect(playingFirst).toBeGreaterThan(levelFirst * 3);
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

/**
 * A7.8.2 PLAYING PATHWAY GUARDS.
 *
 * The component exists so that a programme with nine midfielders projected to
 * remain does not read as a better pathway than one with two. These assert
 * the direction of that response and the two failure modes it must never
 * acquire: an unreadable roster scoring as an empty one, and an athlete who
 * cares about minutes being sent to the weakest programme on the board.
 */
describe('playing-opportunity priority changes how much competition matters', () => {
  it('barely moves the list at priority 1 and moves it at priority 5', () => {
    const low = rank(9, 5, 1);
    const high = rank(9, 1, 5);
    const order = (rows) => rows.slice().sort((a, b) => a.rank - b.rank).map((r) => r.name).join('|');
    expect(order(low)).not.toBe(order(high));
    // Both orderings must still cover the whole universe.
    expect(low.length).toBe(colleges.length);
    expect(high.length).toBe(colleges.length);
  });

  it('does not hand the list to the weakest programme when minutes are wanted', () => {
    // The realism guard for this component: an athlete who wants to play is
    // not thereby asking for the worst programme with the emptiest roster.
    const rows = rank(9, 3, 5);
    const eq = equivalent(9);
    const front = rows.filter((r) => r.rank <= Math.ceil(rows.length * 0.1));
    const weakest = Math.min(...rows.map((r) => r.strength));
    expect(Math.min(...front.map((r) => r.strength))).toBeGreaterThan(weakest);
    expect(band(rows, eq, 10, Infinity).filter((r) => r.rank <= Math.ceil(rows.length * 0.1))).toEqual([]);
  });

  it('still ranks every programme exactly once at any playing priority', () => {
    for (const playing of [1, 3, 5]) {
      const rows = rank(9, 3, playing);
      expect(rows.length).toBe(colleges.length);
      expect(new Set(rows.map((r) => r.rank)).size).toBe(rows.length);
    }
  });
});

/**
 * A7.18, property 8. The V3-F result in miniature.
 *
 * A7.15 measured that a family stating $8,000 gets a list that goes down
 * level, and that this is CORRECT rather than a failure: in the real universe
 * near-level programmes are less affordable than weaker ones - median
 * Financial 0.304 against 0.384 - so the right answer is cheaper programmes.
 * A7.16 froze that as condition B5 and every candidate had to keep it.
 *
 * The risk the level anchor introduces is that it undoes exactly this. It
 * must not: money is allowed to beat level, and this asserts that it still
 * does.
 */
describe('a tight budget still lifts affordable programmes below the athlete', () => {
  const rankWithBudget = (rating, budgetRange, level = 3) => {
    const rep = runPursuit({
      athlete: {
        label: { id: 'budget-guard' },
        v1Shape: { sport: 'mens-soccer', budgetRange, state: 'OH', origin: 'USA' },
        recruitability: { sport: 'mens-soccer', rating, position: 'MIDFIELD', entryYear: 2028, isInternational: false },
        opportunity: {
          sport: 'mens-soccer', position: 'MIDFIELD', rating,
          intendedMajor: null, priorityRanking: null,
          competitiveLevelPriority: level, playingOpportunityPriority: 3,
        },
      },
      sport: 'mens-soccer', colleges, ctx,
    });
    const byName = new Map(colleges.map((c) => [c.name, c]));
    return rep.pipeline.ranked.map((e) => ({
      name: e.name, rank: e.rank,
      strength: byName.get(e.name).soccer_score,
      netPrice: byName.get(e.name).net_price,
    }));
  };

  it('a constrained athlete is ranked differently from a wealthy one', () => {
    const rich = rankWithBudget(9, '$40k+/yr');
    const poor = rankWithBudget(9, 'Need Full Scholarship');
    expect(poor.map((r) => r.name)).not.toEqual(rich.map((r) => r.name));
  });

  it('the constrained list is cheaper at the front, even with a level anchor applied', () => {
    const rich = rankWithBudget(9, '$40k+/yr');
    const poor = rankWithBudget(9, 'Need Full Scholarship');
    const frontPrice = (rows) => {
      const f = rows.slice(0, front(rows)).map((r) => r.netPrice);
      return f.reduce((a, b) => a + b, 0) / f.length;
    };
    expect(frontPrice(poor)).toBeLessThan(frontPrice(rich));
  });

  it('affordable programmes below the athlete still reach the front of the list', () => {
    const poor = rankWithBudget(9, 'Need Full Scholarship');
    const eq = equivalent(9);
    const cheapAndBelow = poor.filter((r) => r.strength - eq < -15)
      .sort((a, b) => a.netPrice - b.netPrice).slice(0, 10);
    // At least one substantially-below programme that is cheap must be in
    // the first decile. The anchor may demote them; it may not exclude them.
    expect(cheapAndBelow.some((r) => r.rank <= front(poor))).toBe(true);
  });
});
