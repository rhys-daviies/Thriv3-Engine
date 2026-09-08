/**
 * The pool origin benchmark.
 *
 * It replaces a sentence that was carried in the renderer as prose — "about
 * 40% more likely to play a starter's season, 37% against 27%" — and looked
 * measured beside computed numbers. These tests pin the properties that make
 * the replacement trustworthy: the same definition of a first-year as the
 * programme half, thin groups refused rather than reported, unpublished
 * minutes counted rather than read as zero, and no effect size computed.
 */
import { describe, it, expect } from 'vitest';
import { originBenchmark, originGroupStats, freshmanPoints, STARTER_MINUTES } from './philosophy.js';
import { MIN_COHORT_PLAYERS, MIN_COHORT_SEASONS } from './freshmanMinutes.js';

const pt = (over = {}) => ({
  season: '2024', name: 'A', position: 'DEFENSE', minutes: 900,
  origin: 'domestic', programme: 'One', ...over,
});

/** Enough players across enough seasons to clear both cohort minimums. */
const group = (n, over = {}) => Array.from({ length: n }, (_, i) => pt({
  name: `P${i}`, season: `202${2 + (i % 4)}`, programme: `Prog${i % 3}`, ...over,
}));

describe('originGroupStats', () => {
  it('counts players, programmes and seasons behind the figure', () => {
    const g = originGroupStats(group(12));
    expect(g.players).toBe(12);
    expect(g.programmes).toBe(3);
    expect(g.seasons).toBe(4);
    expect(g.seasonsRepresented).toEqual(['2022', '2023', '2024', '2025']);
  });

  it('counts a starter season at the same threshold the rest of the report uses', () => {
    const g = originGroupStats([
      ...group(6, { minutes: STARTER_MINUTES }),
      ...group(6, { minutes: STARTER_MINUTES - 1 }),
    ]);
    expect(g.impact).toBe(6);
    expect(g.impactShare).toBeCloseTo(0.5);
  });

  // The established minimums, reused rather than a second set invented for
  // the pool. A share of four players reads far more confidently than it
  // deserves to.
  it('withholds every share below the cohort minimums', () => {
    const thinPlayers = originGroupStats(group(MIN_COHORT_PLAYERS - 1));
    expect(thinPlayers.sufficient).toBe(false);
    expect(thinPlayers.impactShare).toBeNull();
    expect(thinPlayers.playedShare).toBeNull();
    expect(thinPlayers.medianMinutes).toBeNull();
    // The raw counts survive, so a caller can still say how many there were.
    expect(thinPlayers.players).toBe(MIN_COHORT_PLAYERS - 1);
    expect(thinPlayers.impact).toBeGreaterThan(0);
  });

  it('withholds shares for a group confined to too few seasons', () => {
    const oneSeason = originGroupStats(
      Array.from({ length: 20 }, (_, i) => pt({ name: `P${i}`, season: '2025' })));
    expect(oneSeason.seasons).toBeLessThan(MIN_COHORT_SEASONS);
    expect(oneSeason.sufficient).toBe(false);
    expect(oneSeason.impactShare).toBeNull();
  });

  it('reports how many of the group never had minutes published', () => {
    const g = originGroupStats(group(12), { unmeasuredRows: 40 });
    expect(g.withoutPublishedMinutes).toBe(40);
    // Those rows are NOT in the denominator: the share describes the players
    // that could be seen, and the count says how many could not.
    expect(g.players).toBe(12);
  });

  it('handles an empty group without dividing by nothing', () => {
    const g = originGroupStats([]);
    expect(g).toMatchObject({ players: 0, seasons: 0, impact: 0, impactShare: null, sufficient: false });
    expect(g.medianMinutes).toBeNull();
  });
});

describe('originBenchmark', () => {
  const points = [
    ...group(12, { origin: 'domestic', minutes: 100 }),
    ...group(12, { origin: 'international', minutes: 900 }),
    ...group(4, { origin: null, minutes: 400 }),
  ];

  it('reports both groups with their sample sizes', () => {
    const b = originBenchmark(points);
    expect(b.domestic.players).toBe(12);
    expect(b.international.players).toBe(12);
    expect(b.comparable).toBe(true);
  });

  // A row carrying neither nationality nor country is not a US recruit.
  // Sorting it into "domestic" by default would be the same error as reading
  // a blank minutes cell as a zero.
  it('keeps unrecorded origin out of both groups', () => {
    const b = originBenchmark(points);
    expect(b.originUnrecorded.players).toBe(4);
    expect(b.domestic.players + b.international.players).toBe(24);
    expect(b.originUnrecorded.sufficient).toBe(false);
  });

  it('is not comparable where either group is too thin to stand alone', () => {
    const b = originBenchmark([
      ...group(12, { origin: 'domestic' }),
      ...group(3, { origin: 'international' }),
    ]);
    expect(b.domestic.sufficient).toBe(true);
    expect(b.international.sufficient).toBe(false);
    expect(b.comparable).toBe(false);
  });

  // No difference, ratio or effect size. "40% more likely" invites a causal
  // reading the data cannot support; two shares beside their sample sizes do
  // not.
  it('computes no effect size of any kind', () => {
    const b = originBenchmark(points);
    const json = JSON.stringify(b);
    expect(json).not.toMatch(/"(difference|ratio|effect|lift|odds|moreLikely)"/);
    for (const key of Object.keys(b)) {
      expect(['domestic', 'international', 'originUnrecorded', 'comparable']).toContain(key);
    }
  });

  it('routes the unmeasured counts to the right groups', () => {
    const b = originBenchmark(points, {
      unmeasured: { domestic: 30, international: 5, unknown: 2 },
    });
    expect(b.domestic.withoutPublishedMinutes).toBe(30);
    expect(b.international.withoutPublishedMinutes).toBe(5);
    expect(b.originUnrecorded.withoutPublishedMinutes).toBe(2);
  });
});

/**
 * The definition has to be the same one the programme half uses, or the pool
 * comparison compares two different populations.
 */
describe('compatibility with the programme-side definition', () => {
  const row = (over = {}) => ({
    college_name: 'One', sport: 'mens-soccer', season: '2024', player_name: 'A',
    class_year_label: 'Fr.', position: 'DEFENSE', minutes_played: 900,
    games_played: 18, games_started: 18, nationality: 'USA', ...over,
  });

  it('is fed by the same freshmanPoints the programme half uses', () => {
    const rows = [
      row({ player_name: 'Fresh', minutes_played: 900 }),
      row({ player_name: 'Older', class_year_label: 'Jr.', minutes_played: 1200 }),
      // Never had minutes published: excluded from the points by construction.
      row({ player_name: 'Unpublished', minutes_played: 0, games_played: 12 }),
      row({ player_name: 'Redshirt', class_year_label: 'RS-Fr.', minutes_played: 800 }),
    ];
    const points = freshmanPoints(rows, { seasons: ['2024'] });
    expect(points.map((p) => p.name)).toEqual(['Fresh']);
    expect(originBenchmark(points).domestic.players).toBe(1);
  });

  // A first-year who was already on the previous roster did not arrive, and
  // vacancyObservations excludes those 322 pool-wide rows for the same reason.
  it('excludes a first-year who was already on the previous roster', () => {
    const rows = [
      row({ season: '2023', player_name: 'Same Person', class_year_label: 'Fr.' }),
      row({ season: '2024', player_name: 'Same Person', class_year_label: 'Fr.' }),
      row({ season: '2024', player_name: 'Genuine Arrival', class_year_label: 'Fr.' }),
    ];
    const points = freshmanPoints(rows, { seasons: ['2023', '2024'] });
    expect(points.filter((p) => p.season === '2024').map((p) => p.name)).toEqual(['Genuine Arrival']);
  });
});
