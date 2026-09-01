/**
 * The competitive truth layer, held to what a win/draw/loss record can say.
 *
 * The tests that matter most here are the refusals: a season that is not on
 * file must not become a zero, a record the roster contradicts must not be
 * quoted, and a rate must not rank two seasons by win total alone.
 */
import { describe, it, expect } from 'vitest';
import {
  competitiveHistory, seasonRow, seasonBenchmark, winPercentage, pointsRate,
  SEASONS, WINDOW, UNREADABLE, MIN_POOL, NO_BENCHMARK,
} from './competitiveHistory.js';

const S = (season, wins, losses, draws, confidence = 'ROSTER_CONSISTENT', historicalDivision = 'NCAA D1') =>
  ({ season, wins, losses, draws, confidence, historicalDivision });
const rich = [S(2022, 8, 7, 3), S(2023, 10, 5, 3), S(2024, 12, 4, 2), S(2025, 14, 3, 2)];

describe('the record string', () => {
  /**
   * Wins-losses-draws, because that is what every source publishes. Phase 12A
   * pulled these three headers off the schools' own schedule exports; if this
   * test ever fails the report is printing a season a family cannot find on
   * their own programme's website.
   */
  it('is W-L-D, matching the schools’ own published headers', () => {
    expect(seasonRow({ season: 2022, wins: 19, draws: 1, losses: 1 }).record).toBe('19-1-1');
    expect(seasonRow({ season: 2022, wins: 20, draws: 2, losses: 0 }).record).toBe('20-0-2');
    expect(seasonRow({ season: 2022, wins: 16, draws: 5, losses: 2 }).record).toBe('16-2-5');
  });
});

describe('the canonical rate', () => {
  // NCAA winning percentage: a draw is half a win. Verified against the same
  // three official headers, which publish .929, .955 and .804.
  it('reproduces the figure the schools publish', () => {
    expect(winPercentage(19, 1, 21)).toBeCloseTo(0.929, 3);
    expect(winPercentage(20, 2, 22)).toBeCloseTo(0.955, 3);
    expect(winPercentage(16, 5, 23)).toBeCloseTo(0.804, 3);
  });

  /**
   * The reason simple win percentage was rejected, and it is not theoretical:
   * Albany men's went 5-11-1 in 2023 and 5-6-6 in 2025. Identical win rate,
   * five losses apart.
   */
  it('separates two seasons that share a win total', () => {
    const a = seasonRow({ season: 2023, wins: 5, losses: 11, draws: 1 });
    const b = seasonRow({ season: 2025, wins: 5, losses: 6, draws: 6 });
    expect(a.wins / a.matchesPlayed).toBeCloseTo(b.wins / b.matchesPlayed, 3);
    expect(a.winPercentage).toBeLessThan(b.winPercentage);
  });

  // The case the brief names explicitly.
  it('does not treat 10-2-8 and 10-8-2 as the same season', () => {
    const good = seasonRow({ season: 2024, wins: 10, losses: 2, draws: 8 });
    const poor = seasonRow({ season: 2024, wins: 10, losses: 8, draws: 2 });
    expect(good.record).toBe('10-2-8');
    expect(poor.record).toBe('10-8-2');
    expect(good.winPercentage).toBe(0.7);
    expect(poor.winPercentage).toBe(0.55);
    expect(good.winPercentage).toBeGreaterThan(poor.winPercentage);
  });

  it('keeps league points per game alongside, and they are different measures', () => {
    expect(pointsRate(9, 7, 18)).toBeCloseTo(0.630, 3);
    expect(winPercentage(9, 7, 18)).toBeCloseTo(0.694, 3);
  });

  it('is null rather than zero for a season with no matches', () => {
    expect(winPercentage(0, 0, 0)).toBeNull();
    expect(pointsRate(0, 0, 0)).toBeNull();
  });
});

describe('the season sequence', () => {
  it('keeps every season and never collapses them', () => {
    const h = competitiveHistory({ rows: rich });
    expect(h.seasons.map((s) => s.record)).toEqual(['8-7-3', '10-5-3', '12-4-2', '14-3-2']);
    expect(h.describes).toEqual([2022, 2023, 2024, 2025]);
  });

  it('sorts into season order whatever order the rows arrive in', () => {
    const h = competitiveHistory({ rows: [...rich].reverse() });
    expect(h.seasons.map((s) => s.season)).toEqual([2022, 2023, 2024, 2025]);
  });

  it('ignores a season outside the window', () => {
    const h = competitiveHistory({ rows: [...rich, S(2021, 20, 0, 0), S(2026, 20, 0, 0)] });
    expect(h.describes).toEqual(SEASONS);
  });
});

describe('missing and unreadable seasons', () => {
  it('calls four readable seasons a complete window', () => {
    const h = competitiveHistory({ rows: rich });
    expect(h.window).toBe(WINDOW.COMPLETE);
    expect(h.completeWindow).toBe(true);
    expect(h.missingSeasons).toEqual([]);
  });

  it.each([[3, WINDOW.PARTIAL], [2, WINDOW.PARTIAL], [1, WINDOW.SINGLE_SEASON], [0, WINDOW.UNAVAILABLE]])(
    '%i readable seasons is %s', (n, expected) => {
      const h = competitiveHistory({ rows: rich.slice(0, n) });
      expect(h.window).toBe(expected);
      expect(h.readableSeasons).toBe(n);
      expect(h.expectedSeasons).toBe(4);
    });

  // The rule the whole codebase keeps: a gap is a gap.
  it('never turns a missing season into 0-0-0', () => {
    const h = competitiveHistory({ rows: [rich[0], rich[3]] });
    expect(h.seasons).toHaveLength(2);
    expect(h.missingSeasons).toEqual([2023, 2024]);
    expect(h.summary.totalMatches).toBe(rich[0].wins + rich[0].losses + rich[0].draws
      + rich[3].wins + rich[3].losses + rich[3].draws);
    expect(h.seasons.some((s) => s.matchesPlayed === 0)).toBe(false);
  });

  it('aggregates only the seasons it read, and says which', () => {
    const h = competitiveHistory({ rows: rich.slice(0, 3) });
    expect(h.describes).toEqual([2022, 2023, 2024]);
    expect(h.summary.aggregateRecord).toBe('30-16-8');
    expect(h.readableSeasons).toBe(3);
  });

  /**
   * A record the programme's own roster contradicts is refused, not quoted and
   * not silently averaged in. 29 seasons in the real table are in this state.
   */
  it('refuses a roster-contradicted season and carries the reason', () => {
    const h = competitiveHistory({ rows: [...rich.slice(0, 3), S(2025, 14, 3, 2, 'ROSTER_CONTRADICTED')] });
    expect(h.readableSeasons).toBe(3);
    expect(h.describes).not.toContain(2025);
    expect(h.unreadableSeasons).toEqual([{ season: 2025, reason: UNREADABLE.ROSTER_CONTRADICTED }]);
    // Refused, not missing — the difference between "we have nothing" and
    // "we have something we do not believe".
    expect(h.missingSeasons).toEqual([]);
  });

  // A range needs two points; at one season it is a sentence about nothing.
  it('publishes no range from a single season', () => {
    const h = competitiveHistory({ rows: rich.slice(0, 1) });
    expect(h.summary.winPercentageRange).toBeNull();
    expect(h.summary.medianWinPercentage).toBe(h.seasons[0].winPercentage);
    expect(h.summary.highestObservedSeason.season).toBe(h.summary.lowestObservedSeason.season);
  });

  it('returns no summary at all rather than an empty one', () => {
    const h = competitiveHistory({ rows: [] });
    expect(h.window).toBe(WINDOW.UNAVAILABLE);
    expect(h.summary).toBeNull();
    expect(h.seasons).toEqual([]);
  });
});

describe('the programme’s own spread', () => {
  it('reports the two ends and the distance between them', () => {
    const h = competitiveHistory({ rows: rich });
    expect(h.summary.winPercentageRange).toEqual({ lowest: 0.528, highest: 0.789, spread: 0.261 });
    expect(h.summary.medianWinPercentage).toBeCloseTo(0.68, 2);
  });

  // Deliberately absent: a standard deviation over four points would only ever
  // be thresholded into a label, which is what this phase refuses to create.
  it('publishes no variance, deviation or volatility measure', () => {
    const h = competitiveHistory({ rows: rich });
    const keys = JSON.stringify(h);
    expect(keys).not.toMatch(/variance|stdev|deviation|volatil/i);
  });
});

describe('highest and lowest observed seasons', () => {
  it('names them by the canonical rate, not by win count', () => {
    // 2024 has the most wins; 2023 has the higher rate on fewer losses.
    const h = competitiveHistory({ rows: [S(2023, 9, 2, 7), S(2024, 12, 8, 1)] });
    expect(h.summary.highestObservedSeason.season).toBe(2023);
    expect(h.summary.highestObservedSeason.wins).toBeLessThan(h.summary.lowestObservedSeason.wins);
  });

  it('breaks a tie toward the later season', () => {
    const h = competitiveHistory({ rows: [S(2022, 10, 5, 3), S(2025, 10, 5, 3)] });
    expect(h.summary.highestObservedSeason.season).toBe(2025);
  });

  // The wording is the contract: the record cannot see the schedule.
  it('never calls a season the best or the worst', () => {
    const h = competitiveHistory({ rows: rich });
    expect(Object.keys(h.summary)).toContain('highestObservedSeason');
    expect(Object.keys(h.summary)).toContain('lowestObservedSeason');
    expect(JSON.stringify(h.summary)).not.toMatch(/\bbest\b|\bworst\b/i);
  });
});

describe('the division-and-season benchmark', () => {
  const pool = (n, value = 0.5) => ({
    rates: Array.from({ length: n }, (_, i) => value + i / (n * 100)),
    scope: 'NCAA D1 men’s',
  });
  const d1 = (n, v) => ({ 'NCAA D1': pool(n, v) });

  it('refuses a pool below the evidence floor and says how small it was', () => {
    const b = seasonBenchmark(0.6, pool(MIN_POOL - 1), { division: 'NCAA D1' });
    expect(b.available).toBe(false);
    expect(b.n).toBe(MIN_POOL - 1);
    expect(b.reason).toMatch(/only 29 on file/);
  });

  it('reports a percentile, the median and the middle half', () => {
    const b = seasonBenchmark(0.6, pool(200, 0.4), { division: 'NCAA D1' });
    expect(b.available).toBe(true);
    expect(b.n).toBe(200);
    expect(b.percentile).toBeGreaterThan(0);
    expect(b.percentile).toBeLessThanOrEqual(1);
    expect(b.middleHalf.low).toBeLessThan(b.middleHalf.high);
    expect(b.scope).toBe('NCAA D1 men’s');
  });

  // A programme sitting exactly on a very common value must not be credited
  // with beating everybody who matched it.
  it('puts a tied value at the midpoint of its own band', () => {
    const b = seasonBenchmark(0.5, { rates: Array(100).fill(0.5), scope: 'x' }, { division: 'NCAA D1' });
    expect(b.percentile).toBe(0.5);
  });

  it('is null rather than a midpoint when there is no pool at all', () => {
    expect(seasonBenchmark(0.6, null)).toBeNull();
    expect(seasonBenchmark(null, pool(200), { division: 'NCAA D1' })).toBeNull();
  });

  it('benchmarks each season against its own season only', () => {
    const pools = { 2022: d1(100, 0.9), 2023: d1(100, 0.1) };
    const h = competitiveHistory({ rows: [S(2022, 10, 5, 3), S(2023, 10, 5, 3)], pools });
    expect(h.seasons[0].benchmark.percentile).toBeLessThan(h.seasons[1].benchmark.percentile);
  });

  it('leaves the benchmark null where no pool was supplied', () => {
    const h = competitiveHistory({ rows: rich });
    expect(h.seasons.every((s) => s.benchmark === null)).toBe(true);
  });

  /**
   * PHASE 12B.1 — the denominator is the season's OWN division.
   *
   * 12B keyed the pool on `colleges.division`, which is the CURRENT division,
   * and Mercyhurst men's played 2022 and 2023 in D2 before moving to D1. Every
   * internal source stamps those two seasons D1, so the report compared a D2
   * season against 213 D1 programmes. A disclosure does not make a wrong
   * denominator right; the refusal does.
   */
  it('refuses outright where the season’s division is not on file', () => {
    const b = seasonBenchmark(0.9, pool(200), { division: null });
    expect(b.available).toBe(false);
    expect(b.reason).toBe(NO_BENCHMARK.DIVISION_UNKNOWN);
    expect(b.percentile).toBeUndefined();
  });

  it('never falls back to another division’s pool', () => {
    // Mercyhurst's shape: a D2 season, and only a D1 pool on offer.
    const rows = [S(2022, 19, 1, 1, 'ROSTER_CONSISTENT', null)];
    const h = competitiveHistory({ rows, pools: { 2022: d1(213, 0.3) } });
    expect(h.seasons[0].benchmark.available).toBe(false);
    expect(h.seasons[0].benchmark.reason).toBe(NO_BENCHMARK.DIVISION_UNKNOWN);
  });

  it('compares a D2 season only with the D2 pool, never the D1 one', () => {
    const pools = { 2022: { 'NCAA D1': pool(213, 0.9), 'NCAA D2': pool(196, 0.1) } };
    const rows = [S(2022, 19, 1, 1, 'ROSTER_CONSISTENT', 'NCAA D2')];
    const h = competitiveHistory({ rows, pools });
    expect(h.seasons[0].benchmark.available).toBe(true);
    expect(h.seasons[0].benchmark.n).toBe(196);
    expect(h.seasons[0].benchmark.scope).toBe('NCAA D1 men’s'); // the fixture's own label
    // Against the D1 pool it would have landed mid-table; against its own it is top.
    expect(h.seasons[0].benchmark.percentile).toBe(1);
  });

  // The route Phase 12C opens: one programme, two divisions, two pools.
  it('benchmarks a programme that changed division against each season’s own pool', () => {
    // Its strong D2 season tops a weak D2 pool; its poor D1 season sits at the
    // bottom of a strong D1 pool. Neither is measured against the other's.
    const pools = {
      2022: { 'NCAA D2': pool(196, 0.10) },
      2025: { 'NCAA D1': pool(213, 0.55) },
    };
    const rows = [S(2022, 19, 1, 1, 'ROSTER_CONSISTENT', 'NCAA D2'),
      S(2025, 3, 10, 4, 'ROSTER_CONSISTENT', 'NCAA D1')];
    const h = competitiveHistory({ rows, pools });
    expect(h.seasons.map((s) => s.benchmark.n)).toEqual([196, 213]);
    expect(h.seasons[0].benchmark.percentile).toBeGreaterThan(h.seasons[1].benchmark.percentile);
  });

  it('reports the season’s division on every season row', () => {
    const h = competitiveHistory({ rows: rich });
    expect(h.seasons.map((s) => s.historicalDivision)).toEqual(Array(4).fill('NCAA D1'));
    expect(competitiveHistory({ rows: [{ season: 2022, wins: 1, draws: 1, losses: 1 }] })
      .seasons[0].historicalDivision).toBeNull();
  });
});

describe('coach attribution is context, never a filter', () => {
  const attribution = {
    currentCoach: { name: 'Jane Kerr' },
    currentCoachReason: null,
    measuredSeasons: [
      { season: '2022', attribution: 'PREVIOUS_COACH' },
      { season: '2023', attribution: 'UNRESOLVED' },
      { season: '2024', attribution: 'CURRENT_COACH' },
      { season: '2025', attribution: 'CURRENT_COACH' },
    ],
  };

  it('keeps the whole history and counts the coach’s share beside it', () => {
    const h = competitiveHistory({ rows: rich, coachAttribution: attribution });
    expect(h.seasons).toHaveLength(4);
    expect(h.coach.competitiveSeasonCount).toBe(4);
    expect(h.coach.currentCoachCompetitiveSeasonCount).toBe(2);
    expect(h.coach.currentCoachCompetitiveSeasons).toEqual([2024, 2025]);
  });

  it('states the record across those seasons with its own denominator', () => {
    const h = competitiveHistory({ rows: rich, coachAttribution: attribution });
    expect(h.coach.currentCoachRecord).toEqual({ seasons: [2024, 2025], wins: 26, draws: 4, losses: 7 });
  });

  it('reports an unresolved season as unattributed rather than filling it in', () => {
    const h = competitiveHistory({ rows: rich, coachAttribution: attribution });
    expect(h.coach.unattributedSeasons).toEqual([2023]);
  });

  it('is null where no attribution was handed in, which is 402 programmes', () => {
    expect(competitiveHistory({ rows: rich }).coach).toBeNull();
  });

  it('names no coach where the attribution could not establish one', () => {
    const h = competitiveHistory({ rows: rich, coachAttribution: {
      currentCoach: null, currentCoachReason: 'no coach row on file for this season', measuredSeasons: [] } });
    expect(h.coach.currentCoach).toBeNull();
    expect(h.coach.currentCoachCompetitiveSeasonCount).toBe(0);
    expect(h.seasons).toHaveLength(4);
  });
});
