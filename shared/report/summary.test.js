import { describe, it, expect } from 'vitest';
import {
  bandAgainstPool, splitDepthByEntry, originContextSummary,
  freshmanOpportunitySummary, experiencedArrivalSummary, replacementBehaviourSummary,
  squadTurnoverSummary, coachContextSummary, buildReportSummary, CLASSIFICATIONS,
} from './summary.js';

/** A depth-chart row as depthChartAt returns one. */
const d = (over = {}) => ({
  name: 'A', classLabel: 'Jr.', projectedMinutes: 900, eligibleTo: 2028, arrivedFrom: null, ...over,
});

describe('bandAgainstPool', () => {
  const q = { p25: 100, median: 300, p75: 700 };

  it('bands above the top quartile, at or above the median, and below it', () => {
    expect(bandAgainstPool(900, q)).toBe('high');
    expect(bandAgainstPool(700, q)).toBe('moderate');
    expect(bandAgainstPool(300, q)).toBe('moderate');
    expect(bandAgainstPool(299, q)).toBe('low');
  });

  // A midpoint invented where the pool cannot be read looks exactly like a
  // measurement, which is the failure percentileOfLadderTop already refuses.
  it('returns null rather than a midpoint where either side is missing', () => {
    expect(bandAgainstPool(null, q)).toBeNull();
    expect(bandAgainstPool(500, null)).toBeNull();
    expect(bandAgainstPool(500, { p25: 1, median: null, p75: 3 })).toBeNull();
  });
});

describe('splitDepthByEntry', () => {
  const depth = [
    d({ name: 'Stays', eligibleTo: 2028, projectedMinutes: 1200 }),
    d({ name: 'Stays too', eligibleTo: 2027, projectedMinutes: 300 }),
    d({ name: 'Goes', eligibleTo: 2026, projectedMinutes: 800 }),
    d({ name: 'Unknown', eligibleTo: null, projectedMinutes: 500 }),
  ];

  it('splits on whether eligibility currently reaches the entry season', () => {
    const s = splitDepthByEntry(depth, 2027);
    expect(s.stillEligibleAtEntry.map((x) => x.name)).toEqual(['Stays', 'Stays too']);
    expect(s.expiringBeforeEntry.map((x) => x.name)).toEqual(['Goes']);
    expect(s.eligibilityUnknown.map((x) => x.name)).toEqual(['Unknown']);
  });

  // Three buckets, never two. A player with no eligibility year recorded is
  // neither staying nor leaving as far as the record goes, and putting them in
  // either bucket manufactures a fact.
  it('never folds an unrecorded eligibility year into either side', () => {
    const s = splitDepthByEntry(depth, 2027);
    const placed = s.stillEligibleAtEntry.length + s.expiringBeforeEntry.length;
    expect(placed).toBe(depth.length - s.eligibilityUnknown.length);
    expect(s.eligibilityUnknown).toHaveLength(1);
  });

  it('sums the projected minutes attached to each bucket', () => {
    const s = splitDepthByEntry(depth, 2027);
    expect(s.expiringMinutes.currentProjectedMinutes).toBe(800);
    expect(s.stillEligibleMinutes.currentProjectedMinutes).toBe(1500);
    expect(s.unknownMinutes.currentProjectedMinutes).toBe(500);
  });

  it('reports minutes as null, not zero, where nobody in a bucket has a projection', () => {
    const s = splitDepthByEntry([d({ eligibleTo: 2026, projectedMinutes: null })], 2027);
    expect(s.expiringMinutes.currentProjectedMinutes).toBeNull();
    expect(s.expiringMinutes.players).toBe(1);
    expect(s.expiringMinutes.playersWithoutProjection).toBe(1);
  });

  it('moves players between buckets as the entry season moves', () => {
    expect(splitDepthByEntry(depth, 2029).expiringBeforeEntry).toHaveLength(3);
    expect(splitDepthByEntry(depth, 2026).expiringBeforeEntry).toHaveLength(0);
  });

  it('handles an empty or missing depth chart', () => {
    expect(splitDepthByEntry([], 2027).all).toEqual([]);
    expect(splitDepthByEntry(null, 2027).stillEligibleAtEntry).toEqual([]);
  });
});

/**
 * The classification modules, driven from hand-built models so the refusal
 * paths can be reached without arranging a database to be broken in a
 * particular way.
 */
const poolFor = (over = {}) => ({
  ladderByRank: [{ rank: 1, n: 100, p25: 200, median: 600, p75: 1100 }],
  dials: { newcomer: { p25: 5, median: 15, p75: 30 } },
  programmeDials: { newcomer: { n: 100, p25: 8, median: 18, p75: 28 } },
  vacancy: null, byPosition: [], poolMix: null, programmes: 120, ladderTopPercentile: 75,
  ...over,
});

const modelFor = (over = {}) => ({
  seasons: [
    { season: '2022', intake: 6, played: 4, starters: 1, share: 0.2 },
    { season: '2023', intake: 6, played: 4, starters: 1, share: 0.2 },
    { season: '2024', intake: 6, played: 4, starters: 1, share: 0.2 },
    { season: '2025', intake: 6, played: 4, starters: 1, share: 0.2 },
  ],
  ladder: [{ rank: 1, median: 1400, low: 1200, high: 1500, band: 'impact', agreement: 'tight', comparable: true, seasonsWithThisMany: 4, contributions: [] }],
  weightedLadder: null,
  dials: { n: 10, freshman: 20, newcomer: 15, returning: 65 },
  byPosition: [],
  benchmarks: poolFor(),
  benchmarksReason: null,
  verdict: { verdict: 'steady', note: 'one coach', describes: [2022, 2023, 2024, 2025] },
  tenure: { current: { coach: 'A', since: 2022 }, segments: [], changes: [], unknownSeasons: [], vacantSeasons: [], knownThrough: 2026 },
  coach: { coach: 'A', since: 2022 },
  freshman: {
    intake: [
      { season: '2022', freshmen: 6, readable: true, arrivalsMeasurable: true, newcomers: 2, newcomerMinutes: 900, newcomerStarters: 1, load: 9000 },
      { season: '2023', freshmen: 6, readable: true, arrivalsMeasurable: true, newcomers: 2, newcomerMinutes: 900, newcomerStarters: 1, load: 9000 },
      { season: '2024', freshmen: 6, readable: true, arrivalsMeasurable: true, newcomers: 2, newcomerMinutes: 900, newcomerStarters: 1, load: 9000 },
      { season: '2025', freshmen: 6, readable: true, arrivalsMeasurable: true, newcomers: 2, newcomerMinutes: 900, newcomerStarters: 1, load: 9000 },
    ],
    points: [], progression: [], grid: [], retention: null,
  },
  transfer: { points: [{ minutes: 800 }], window: { measurable: ['2023', '2024', '2025'], unmeasurable: [] }, measurable: true, density: 'few' },
  squad: { rostered: 0, cliff: null, arrivals: [], depth: null },
  athlete: null,
  fit: null,
  ...over,
});

const philosophyFor = (over = {}) => ({
  freshman: { unreadableSeasons: [], unknownRows: 0, seasonsWithAnImpactFreshman: 4, medianIntake: 6, medianPlayed: 4, medianImpactPerSeason: 1 },
  observations: Array.from({ length: 10 }, (_, i) => ({
    freshmenReadable: true, to: `202${2 + (i % 4)}`, departedStarters: 1, vacatedStarterShare: 0.2,
  })),
  ...over,
});

describe('freshman opportunity classification', () => {
  it('bands against the pool and says that is what it did', () => {
    const s = freshmanOpportunitySummary({ model: modelFor(), philosophy: philosophyFor() });
    expect(s.classification).toBe('high');
    expect(s.classificationBasis).toBe('pool-relative');
    expect(CLASSIFICATIONS).toContain(s.classification);
  });

  // No pool means no defensible threshold, and an invented one is worse than
  // no answer.
  it('is unclear where the pool could not be read', () => {
    const s = freshmanOpportunitySummary({
      model: modelFor({ benchmarks: null, benchmarksReason: 'no roster seasons on file for this sport' }),
      philosophy: philosophyFor(),
    });
    expect(s.classification).toBe('unclear');
    expect(s.classificationBasis).toBe('none');
    expect(s.poolReason).toMatch(/no roster seasons/);
  });

  it('is unclear where the evidence behind the figure is insufficient', () => {
    const s = freshmanOpportunitySummary({
      model: modelFor({ seasons: [{ season: '2025', intake: 2, played: 1, starters: 0, share: 0.1 }],
        freshman: { intake: [{ season: '2025', freshmen: 2, readable: true, arrivalsMeasurable: false }], points: [], progression: [], grid: [] } }),
      philosophy: philosophyFor(),
    });
    expect(s.classification).toBe('unclear');
  });

  it('is mixed where the seasons disagree too much for one word', () => {
    const s = freshmanOpportunitySummary({
      model: modelFor({ ladder: [{ rank: 1, median: 42, low: 14, high: 1001, band: 'none', agreement: 'wide', comparable: true, seasonsWithThisMany: 3, contributions: [] }] }),
      philosophy: philosophyFor(),
    });
    expect(s.classification).toBe('mixed');
  });

  it('is unavailable where there is no ladder at all', () => {
    const s = freshmanOpportunitySummary({ model: modelFor({ ladder: [] }), philosophy: philosophyFor() });
    expect(s.classification).toBe('unavailable');
    expect(s.primaryMetric).toBeNull();
  });

  // The weighted ladder is carried, never substituted, so a reader is never
  // handed one while thinking they have the other.
  it('carries the weighted ladder alongside and says whether it agrees', () => {
    const plain = freshmanOpportunitySummary({ model: modelFor(), philosophy: philosophyFor() });
    expect(plain.weightingApplied).toBe(false);
    expect(plain.weightedLadderTop).toBeNull();
    expect(plain.weightedAgrees).toBeNull();

    const weighted = freshmanOpportunitySummary({
      model: modelFor({
        weightedLadder: [{ rank: 1, median: 900, band: 'impact', weighted: true }],
        verdict: { verdict: 'regime-change', weightFrom: 2024, note: 'n' },
      }),
      philosophy: philosophyFor(),
    });
    expect(weighted.weightingApplied).toBe(true);
    expect(weighted.weightedLadderTop.median).toBe(900);
    expect(weighted.weightedAgrees).toBe(false);
    expect(weighted.weightFrom).toBe(2024);
  });
});

describe('experienced arrival reliance', () => {
  // The bug this guards: a programme MEAN placed against the spread of
  // individual position-seasons compresses toward the middle, because means
  // vary far less than the observations behind them.
  it('bands against the programme distribution, not the position-season one', () => {
    const s = experiencedArrivalSummary({
      model: modelFor({ dials: { n: 10, freshman: 20, newcomer: 29, returning: 51 } }),
      philosophy: philosophyFor(),
    });
    // 29 is above the programme p75 of 28 but below the observation p75 of 30.
    expect(s.classification).toBe('high');
    expect(s.pool.newcomer.p75).toBe(28);
    expect(s.pool.perObservation.p75).toBe(30);
  });

  it('is unavailable where no season can be compared with the one before it', () => {
    const s = experiencedArrivalSummary({
      model: modelFor({ transfer: { points: [], window: { measurable: [], unmeasurable: ['2022'] }, measurable: false, density: 'none' } }),
      philosophy: philosophyFor(),
    });
    expect(s.classification).toBe('unavailable');
    expect(s.measurable).toBe(false);
  });

  it('is unclear where the programme distribution is missing', () => {
    const s = experiencedArrivalSummary({
      model: modelFor({ benchmarks: poolFor({ programmeDials: null }) }),
      philosophy: philosophyFor(),
    });
    expect(s.classification).toBe('unclear');
  });

  it('reports arrivals per season and marks the unmeasurable ones null', () => {
    const s = experiencedArrivalSummary({
      model: modelFor({
        freshman: { intake: [
          { season: '2022', freshmen: 6, readable: true, arrivalsMeasurable: false, newcomers: 0, newcomerMinutes: null, newcomerStarters: 0, load: 9000 },
          { season: '2023', freshmen: 6, readable: true, arrivalsMeasurable: true, newcomers: 3, newcomerMinutes: 1200, newcomerStarters: 1, load: 9000 },
        ], points: [], progression: [], grid: [] },
      }),
      philosophy: philosophyFor(),
    });
    expect(s.perSeason[0]).toMatchObject({ season: '2022', arrivals: null, minutes: null, measurable: false });
    expect(s.perSeason[1]).toMatchObject({ season: '2023', arrivals: 3, minutes: 1200, measurable: true });
  });
});

describe('replacement behaviour', () => {
  it('names the leading route only where it leads by a clear margin', () => {
    const clear = replacementBehaviourSummary({
      model: modelFor({ dials: { n: 10, returning: 65, freshman: 20, newcomer: 15 } }),
      philosophy: philosophyFor(),
    });
    expect(clear.dominantRoute).toBe('returning');

    const close = replacementBehaviourSummary({
      model: modelFor({ dials: { n: 10, returning: 36, freshman: 33, newcomer: 31 } }),
      philosophy: philosophyFor(),
    });
    expect(close.dominantRoute).toBe('mixed');
  });

  // No high/low band here: the three shares are a description, not a ranking,
  // and banding them would imply one route is better than another.
  it('does not band the three shares as good or bad', () => {
    const s = replacementBehaviourSummary({ model: modelFor(), philosophy: philosophyFor() });
    expect(s).not.toHaveProperty('classification');
    expect(s.shares).toEqual({ returning: 65, freshman: 20, newcomer: 15 });
  });

  it('reports readable observations out of the total', () => {
    const s = replacementBehaviourSummary({
      model: modelFor({ dials: { n: 7, returning: 65, freshman: 20, newcomer: 15 } }),
      philosophy: philosophyFor(),
    });
    expect(s.observations).toBe(7);
    expect(s.totalObservations).toBe(10);
  });

  it('leaves the route unnamed where the evidence is insufficient', () => {
    const s = replacementBehaviourSummary({
      model: modelFor({ dials: { n: 1, returning: 100, freshman: 0, newcomer: 0 } }),
      philosophy: philosophyFor({ observations: [{ freshmenReadable: true, to: '2025', departedStarters: 1, vacatedStarterShare: 0.2 }] }),
    });
    expect(s.dominantRoute).toBeNull();
  });
});

describe('coach context', () => {
  it('is not scored', () => {
    const s = coachContextSummary({ model: modelFor() });
    expect(s).not.toHaveProperty('score');
    expect(s).not.toHaveProperty('rating');
    expect(s.evidenceRelevance).toBe('describes-current');
  });

  it('says when the record describes the previous staff', () => {
    const s = coachContextSummary({
      model: modelFor({
        verdict: { verdict: 'new-coach-no-record', note: 'took over', since: 2026 },
        tenure: { current: { coach: 'New', since: 2026 }, segments: [], changes: [], unknownSeasons: [], vacantSeasons: [], knownThrough: 2026 },
      }),
    });
    expect(s.evidenceRelevance).toBe('describes-previous');
  });
});

describe('squad turnover', () => {
  const squadRow = (over = {}) => ({
    class_year_label: 'Jr.', season: '2026', position: 'DEFENSE',
    projected_minutes: 900, eligibility_end_year: 2028, ...over,
  });

  // No pool distribution for turnover exists, so there is no defensible band
  // and the module says so rather than inventing one.
  it('stays unclear and names why', () => {
    const s = squadTurnoverSummary({
      model: modelFor({ squad: { rostered: 2, cliff: [{ year: 2026, total: 900, players: 1, playersWithProjection: 1, playersWithoutProjection: 0, byPosition: [] }], arrivals: [], depth: null }, squadSeason: '2026' }),
      squadRows: [squadRow(), squadRow({ eligibility_end_year: 2026 })],
      entrySeason: 2027,
    });
    expect(s.classification).toBe('unclear');
    expect(s.classificationReason).toBe('no-pool-distribution-for-turnover');
  });

  it('reports the denominator and its coverage rather than a bare total', () => {
    const s = squadTurnoverSummary({
      model: modelFor({ squad: { rostered: 3, cliff: null, arrivals: [], depth: null } }),
      squadRows: [squadRow(), squadRow(), squadRow({ projected_minutes: null })],
      entrySeason: 2027,
    });
    expect(s.projectedMinutes.total).toBe(1800);
    expect(s.projectedMinutes.playersWithoutProjection).toBe(1);
    expect(s.projectedMinutes.describes).toBe('players with a prior season on file');
  });
});

describe('origin context', () => {
  const points = (n, origin, starters) => Array.from({ length: n }, (_, i) => ({
    season: `202${2 + (i % 4)}`, origin, minutes: i < starters ? 900 : 100, position: 'DEFENSE',
  }));

  it('compares the athlete’s background against the rest of the intake', () => {
    const s = originContextSummary({
      model: modelFor({
        athlete: { origin: 'international' },
        freshman: { points: [...points(8, 'international', 4), ...points(8, 'domestic', 2)], intake: [], progression: [], grid: [] },
      }),
      athlete: { origin: 'international' },
    });
    expect(s.requestedOrigin).toBe('international');
    expect(s.programme.sameOrigin).toMatchObject({ players: 8, starters: 4 });
    expect(s.programme.sameOrigin.share).toBeCloseTo(0.5);
    expect(s.programme.otherOrigin.players).toBe(8);
  });

  // A percentage of four reads far more confidently than it deserves to, so
  // below the established cohort minimum only the counts are given.
  it('withholds a share for a cohort below the established minimum', () => {
    const s = originContextSummary({
      model: modelFor({
        athlete: { origin: 'domestic' },
        freshman: { points: points(3, 'domestic', 1), intake: [], progression: [], grid: [] },
      }),
      athlete: { origin: 'domestic' },
    });
    expect(s.programme.sameOrigin.players).toBe(3);
    expect(s.programme.sameOrigin.share).toBeNull();
    expect(s.evidence.sufficient).toBe(false);
  });

  it('counts the first-years whose origin was never recorded', () => {
    const s = originContextSummary({
      model: modelFor({
        athlete: { origin: 'domestic' },
        freshman: { points: [...points(4, 'domestic', 1), { season: '2024', origin: null, minutes: 500 }], intake: [], progression: [], grid: [] },
      }),
      athlete: { origin: 'domestic' },
    });
    expect(s.programme.withRecordedOrigin).toBe(4);
    expect(s.programme.withoutRecordedOrigin).toBe(1);
  });

  // Quoting a pool figure from prior research beside computed ones is the
  // exact failure this codebase keeps documenting: a number that looks
  // measured and is not.
  it('refuses a pool comparison the benchmarks do not contain', () => {
    const s = originContextSummary({ model: modelFor(), athlete: { origin: 'domestic' } });
    expect(s.pool).toBeNull();
    expect(s.poolReason).toMatch(/no origin split/);
  });

  it('says when the athlete has no origin recorded', () => {
    const s = originContextSummary({ model: modelFor(), athlete: { origin: null } });
    expect(s.requestedOrigin).toBeNull();
    expect(s.unavailableReason).toMatch(/no origin recorded/);
  });
});

describe('buildReportSummary', () => {
  it('omits the athlete half entirely when there is no athlete', () => {
    const s = buildReportSummary({ model: modelFor(), philosophy: philosophyFor(), squadRows: [] });
    expect(s.athlete).toBeNull();
    expect(Object.keys(s.programme)).toEqual([
      'freshmanOpportunity', 'experiencedArrivalReliance', 'replacementBehaviour',
      'coachContext', 'squadTurnover',
    ]);
  });

  it('never produces an overall programme score', () => {
    const s = buildReportSummary({ model: modelFor(), philosophy: philosophyFor(), squadRows: [] });
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/"(score|rating|grade|overall)"/);
  });
});
