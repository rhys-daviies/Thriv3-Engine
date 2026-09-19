import { describe, it, expect } from 'vitest';
import { compare, isIdentical, v1Ranker, TOP_N } from './parallelRun.js';
import { buildRosterIndex } from '../../../shared/matching/pool.js';
import { RANKING_STATE } from '../../../shared/matching/v2/index.js';

/**
 * A pool wide enough for the top-100 machinery to mean something, varied
 * enough that V1 produces a real order rather than a block of ties.
 */
const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];
const STATES = ['OH', 'PA', 'CA', 'TX', 'FL', 'NY', 'MI', 'IN'];

const colleges = Array.from({ length: 240 }, (_, i) => ({
  id: `c${i}`,
  name: `College ${String(i).padStart(3, '0')}`,
  division: DIVISIONS[i % DIVISIONS.length],
  conference: `Conf ${i % 12}`,
  active: 1,
  soccer_score: 20 + ((i * 7) % 78),
  academic_rating: 1 + (i % 10),
  sat_avg: 900 + ((i * 13) % 500),
  admit_rate: 0.2 + ((i % 7) / 10),
  net_price: 8000 + ((i * 431) % 42000),
  control: i % 2 ? 'Private' : 'Public',
  tuition_in_state: 9000 + ((i * 97) % 12000),
  tuition_out_state: 19000 + ((i * 131) % 22000),
  state: STATES[i % STATES.length],
  latitude: 32 + ((i * 3) % 14),
  longitude: -120 + ((i * 5) % 45),
  recent_win_pct: ((i * 17) % 100) / 100,
  prior_win_pct: ((i * 29) % 100) / 100,
}));

const roster = colleges.flatMap((c, i) => Array.from({ length: 6 }, (_, j) => ({
  college_name: c.name,
  player_name: `p${i}-${j}`,
  position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
  minutes_played: (j % 3 === 0) ? 1200 : 200,
  season: '2026',
  division: c.division,
  class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.'][(i + j) % 5],
})));

const rosterIndex = buildRosterIndex(roster);

const athlete = {
  sport: 'mens-soccer',
  level: 55,
  position: 'MIDFIELD',
  classYear: 2027,
  academicImportance: 5,
  gpa: 3.4,
  sat: 1200,
  budgetRange: '$15k-$30k/yr',
  state: 'OH',
  divisions: [],
  conferences: [],
};

const run = () => compare({ athlete, colleges, rosterIndex });

describe('V1 against itself', () => {
  const report = run();

  it('ranks a pool large enough for the comparison to mean anything', () => {
    expect(report.baseline.ranked).toBeGreaterThan(TOP_N);
    expect(report.candidate.ranked).toBe(report.baseline.ranked);
  });

  it('reports zero rank delta', () => {
    expect(report.diagnostics.rank.moved).toBe(0);
    expect(report.diagnostics.rank.maxAbsDelta).toBe(0);
    expect(report.diagnostics.rank.meanAbsDelta).toBe(0);
    expect(report.diagnostics.rank.compared).toBe(report.baseline.ranked);
  });

  it('reports nothing entering or leaving the top 100', () => {
    expect(report.diagnostics.topN.enteredCount).toBe(0);
    expect(report.diagnostics.topN.leftCount).toBe(0);
    expect(report.diagnostics.topN.entered).toEqual([]);
    expect(report.diagnostics.topN.left).toEqual([]);
  });

  it('reports an identical division composition', () => {
    expect(report.diagnostics.divisionComposition.identical).toBe(true);
    expect(report.diagnostics.divisionComposition.candidate)
      .toEqual(report.diagnostics.divisionComposition.baseline);
    expect(Object.values(report.diagnostics.divisionComposition.baseline)
      .reduce((a, b) => a + b, 0)).toBe(TOP_N);
  });

  it('reports no violations', () => {
    expect(report.diagnostics.violations.unscoreableOutranksMeasured.violations).toBe(0);
  });

  it('is identical by the harness own summary', () => {
    expect(isIdentical(report)).toBe(true);
  });

  it('is deterministic across repeated execution', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(report));
  });
});

describe('what the harness does not pretend to know at A7.1', () => {
  const report = run();

  it('reports the layer and coverage sections as not applicable rather than empty', () => {
    expect(report.diagnostics.layers.applicable).toBe(false);
    expect(report.diagnostics.layers.distributions).toEqual({});
    expect(report.diagnostics.layers.coverage).toEqual({});
  });

  it('reports no gates, and says why rather than showing a zero rate', () => {
    expect(report.diagnostics.gates.applicable).toBe(false);
    expect(report.diagnostics.gates.firedByDivision).toEqual({});
  });

  it('leaves the low-plausibility count null, not zero', () => {
    expect(report.diagnostics.lowPlausibilityInTopN.applicable).toBe(false);
    expect(report.diagnostics.lowPlausibilityInTopN.count).toBeNull();
  });

  it('counts no limited-data programmes, because V1 cannot produce one', () => {
    expect(report.diagnostics.limitedData.count).toBe(0);
  });

  it('keeps every section structurally present, so a later layer changes contents not shape', () => {
    expect(Object.keys(report.diagnostics).sort()).toEqual([
      'divisionComposition', 'gates', 'layers', 'limitedData',
      'lowPlausibilityInTopN', 'rank', 'topN', 'violations',
    ]);
  });
});

describe('the harness can actually detect a difference', () => {
  /** A candidate that reverses V1. If the diff cannot see this, it sees nothing. */
  const reversed = (args) => {
    const base = v1Ranker(args);
    return { ...base, label: 'reversed', results: [...base.results].reverse() };
  };

  const report = compare({ athlete, colleges, rosterIndex, candidate: reversed });

  it('reports movement, and a large one', () => {
    expect(report.diagnostics.rank.moved).toBeGreaterThan(0);
    expect(report.diagnostics.rank.maxAbsDelta).toBeGreaterThan(TOP_N);
  });

  it('reports the top 100 turning over completely', () => {
    expect(report.diagnostics.topN.enteredCount).toBe(TOP_N);
    expect(report.diagnostics.topN.leftCount).toBe(TOP_N);
  });

  it('is not identical by the harness own summary', () => {
    expect(isIdentical(report)).toBe(false);
  });

  it('names the biggest movers so a person can go and look at them', () => {
    expect(report.diagnostics.rank.largest.length).toBeGreaterThan(0);
    expect(report.diagnostics.rank.largest[0]).toHaveProperty('name');
    expect(report.diagnostics.rank.largest[0]).toHaveProperty('before');
    expect(report.diagnostics.rank.largest[0]).toHaveProperty('after');
  });
});

describe('the violation that must always be zero', () => {
  const withLimited = (args) => {
    const base = v1Ranker(args);
    const results = [...base.results];
    // A limited-data programme placed ABOVE ranked ones - exactly the
    // neutral-prior inversion V2 exists to prevent.
    results[5] = { ...results[5], rankingState: RANKING_STATE.LIMITED_DATA, reasons: ['NO_ROSTER_ON_FILE'] };
    return { ...base, label: 'seeded', results };
  };

  const report = compare({ athlete, colleges, rosterIndex, candidate: withLimited });

  it('counts every ranked programme sitting below it', () => {
    expect(report.diagnostics.violations.unscoreableOutranksMeasured.violations)
      .toBe(report.candidate.ranked - 6);
  });

  it('names examples rather than only counting', () => {
    expect(report.diagnostics.violations.unscoreableOutranksMeasured.examples.length).toBe(5);
  });

  it('counts the limited-data programme and its reason', () => {
    expect(report.diagnostics.limitedData.count).toBe(1);
    expect(report.diagnostics.limitedData.byReason).toEqual({ NO_ROSTER_ON_FILE: 1 });
  });

  it('fails the identity summary', () => {
    expect(isIdentical(report)).toBe(false);
  });
});

describe('a pool difference is not a rank difference', () => {
  const short = (args) => {
    const base = v1Ranker(args);
    return { ...base, label: 'short', results: base.results.slice(0, 150) };
  };

  it('reports what only the baseline held, separately from movement', () => {
    const report = compare({ athlete, colleges, rosterIndex, candidate: short });
    expect(report.diagnostics.rank.onlyInBaseline).toBe(report.baseline.ranked - 150);
    expect(report.diagnostics.rank.onlyInCandidate).toBe(0);
    expect(report.diagnostics.rank.moved).toBe(0);
  });
});
