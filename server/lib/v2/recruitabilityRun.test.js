import { describe, it, expect } from 'vitest';
import { evaluateRecruitability, recruitabilityRow } from './recruitabilityRun.js';
import { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } from './rosterEvidence.js';
import { REASON } from '../../../shared/matching/v2/index.js';

const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];

const colleges = Array.from({ length: 100 }, (_, i) => ({
  id: `c${i}`,
  name: `College ${String(i).padStart(3, '0')}`,
  division: DIVISIONS[i % DIVISIONS.length],
  soccer_score: i === 3 ? null : 20 + ((i * 7) % 75),
}));

/** NJCAA programmes get no roster at all, exactly as the real data has it. */
const roster = colleges.filter((c) => c.division !== 'NJCAA').flatMap((c, i) =>
  Array.from({ length: 12 }, (_, j) => ({
    college_name: c.name,
    position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
    class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.'][(i + j) % 5],
    division: c.division,
    season: '2026',
    minutes_played: null,
    projected_minutes: j % 3 === 0 ? 1200 : 100,
    games_started: null, projected_games_started: null,
  })));

const arrivals = colleges.flatMap((c, i) => Array.from({ length: 10 }, (_, j) => ({
  programme: c.name, sport: 'mens-soccer', arrival_season: '2026',
  canonical_position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
  is_international: (i + j) % 4 === 0 ? 1 : 0,
})));

const ctx = {
  colleges,
  rosterIndex: buildPositionIndex(roster),
  arrivalIndex: buildArrivalIndex(arrivals),
  divisionArrivals: divisionArrivalRates(arrivals, new Map(colleges.map((c) => [c.name, c]))),
  arrivalsHorizon: 2026,
};

const athlete = (over = {}) => ({
  sport: 'mens-soccer', rating: 7, position: 'MIDFIELD', entryYear: 2027, isInternational: false, ...over,
});

const run = (over, overrides) => evaluateRecruitability({ athlete: athlete(over), ...ctx, overrides });

describe('scoring a pool', () => {
  const rep = run();

  it('refuses every junior college, and says why', () => {
    // This synthetic pool holds no arrivals, so the market arm is unknown
    // too and the evidence floor refuses. In the live pool junior colleges
    // DO carry arrivals, and market match can score some of them - without
    // ever making positional demand appear known.
    expect(rep.byDivision.NJCAA.scoreable).toBe(0);
    expect(Object.values(rep.unscoreableReasons).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(rep.results.filter((r) => r.division === 'NJCAA').every((r) => !r.result.ok)).toBe(true);
  });

  it('refuses a programme with no level on file', () => {
    const none = rep.results.find((r) => r.soccerScore === null);
    expect(none.result.ok).toBe(false);
    expect(none.result.reason).toBe(REASON.NO_PROGRAMME_LEVEL);
  });

  it('scores the divisions it holds evidence for', () => {
    for (const d of ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA']) {
      expect(rep.byDivision[d].scoreableRate, d).toBeGreaterThan(0.8);
    }
  });

  it('reports a distribution for each layer separately', () => {
    expect(rep.recruitability.n).toBe(rep.counts.scoreable);
    // Both component layers can be scoreable where recruitability is not:
    // the programme with no level has a readable roster, and every junior
    // college has a level. Neither on its own is an answer.
    expect(rep.athleticPlausibility.n).toBeGreaterThan(rep.recruitability.n);
    expect(rep.positionalOpportunity.n).toBeGreaterThanOrEqual(rep.counts.scoreable);
    // No arrivals in this pool, so the market arm is unknown everywhere.
    expect(rep.recruitingMarket).toBeNull();
  });

  it('reports zero low-plausibility, high-recruitability violations', () => {
    expect(rep.violations.lowPlausibilityHighRecruitability).toBe(0);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(rep));
  });

  it('produces no ranking', () => {
    expect(rep.results.map((r) => r.id)).toEqual(colleges.map((c) => c.id));
    expect(rep).not.toHaveProperty('pursuitPriority');
    expect(rep).not.toHaveProperty('topN');
  });
});

describe('the things that must not move it', () => {
  it('gives the same answer for a wealthy athlete and a poor one', () => {
    // There is no budget input to pass. Stated as a test so the day one
    // appears, this fails.
    const a = evaluateRecruitability({ athlete: { ...athlete(), budgetRange: '$40k+/yr' }, ...ctx });
    const b = evaluateRecruitability({ athlete: { ...athlete(), budgetRange: 'Need Full Scholarship' }, ...ctx });
    expect(a.recruitability).toEqual(b.recruitability);
  });

  it('gives the same answer whatever the academics', () => {
    const a = evaluateRecruitability({ athlete: { ...athlete(), gpa: 4.0, sat: 1600 }, ...ctx });
    const b = evaluateRecruitability({ athlete: { ...athlete(), gpa: 2.0, sat: null }, ...ctx });
    expect(a.recruitability).toEqual(b.recruitability);
  });

  it('gives the same answer whatever the geography', () => {
    const a = evaluateRecruitability({ athlete: { ...athlete(), state: 'CA' }, ...ctx });
    const b = evaluateRecruitability({ athlete: { ...athlete(), state: 'ME' }, ...ctx });
    expect(a.recruitability).toEqual(b.recruitability);
  });
});

describe('the things that must move it', () => {
  it('a stronger athlete raises the median', () => {
    let prev = -1;
    for (const rating of [3, 5, 7, 9]) {
      const v = run({ rating }).recruitability.median;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('an unmeasurable market arm costs its slice rather than being absorbed', () => {
    // A7.7.4. With no arrivals and no centroids in this pool the market arm
    // cannot be measured, so coverage reports 0.75 - the positional slice
    // alone. Under the old renormalised core it reported 1.00, which is the
    // property that let missing evidence be rewarded.
    const domestic = run({ isInternational: false });
    for (const r of domestic.results.filter((x) => x.result.ok)) {
      expect(r.result.coverage).toBeCloseTo(0.75, 10);
    }
  });

  it('scores a domestic and an international athlete the same when neither has market evidence', () => {
    const domestic = run({ isInternational: false });
    const intl = run({ isInternational: true });
    expect(domestic.counts.scoreableRate).toBe(intl.counts.scoreableRate);
  });

  it('the position changes the answer, because the normaliser and fill rate do', () => {
    const gk = run({ position: 'GOALKEEPER' }).recruitability.median;
    const mid = run({ position: 'MIDFIELD' }).recruitability.median;
    expect(gk).not.toBe(mid);
  });
});

describe('the heuristic overrides the sensitivity run uses', () => {
  it('a faster decay lowers a reaching athlete median', () => {
    const steep = run({ rating: 4 }, { decay: 0.06 }).recruitability.median;
    const shallow = run({ rating: 4 }, { decay: 0.2 }).recruitability.median;
    expect(steep).toBeLessThan(shallow);
  });

  it('a lower at-level value lowers everyone', () => {
    const low = run({ rating: 4 }, { atLevel: 0.6 }).recruitability.median;
    const high = run({ rating: 4 }, { atLevel: 0.9 }).recruitability.median;
    expect(low).toBeLessThan(high);
  });

  it('a higher phi raises everything without changing what is scoreable', () => {
    const low = run({}, { phi: 0.2 });
    const high = run({}, { phi: 0.5 });
    expect(high.recruitability.median).toBeGreaterThan(low.recruitability.median);
    expect(high.counts.scoreable).toBe(low.counts.scoreable);
  });

  it('a heavier arrival claim lowers opportunity where arrivals apply', () => {
    /**
     * Needs a season where places actually vacate AND arrivals are on file.
     * On the real data neither holds together: arrivals stop at 2026 and the
     * classes being recruited for are 2027 and 2028, so this term is
     * structurally present and currently inert. Exercised here so that it is
     * known to work when the data catches up.
     */
    const future = arrivals.map((a) => ({ ...a, arrival_season: '2027' }));
    const ahead = {
      ...ctx,
      arrivalIndex: buildArrivalIndex(future),
      divisionArrivals: divisionArrivalRates(future, new Map(colleges.map((c) => [c.name, c]))),
      arrivalsHorizon: 2027,
    };
    const at = (arrivalClaim) => evaluateRecruitability({
      athlete: athlete({ entryYear: 2027 }), ...ahead, overrides: { opportunityWeights: { arrivalClaim } },
    }).positionalOpportunity.mean;
    expect(at(1)).toBeLessThan(at(0.1));
  });

  it('raising the coverage floor cannot raise what is scoreable', () => {
    expect(run({}, { floor: 0.9 }).counts.scoreable).toBeLessThanOrEqual(run({}, { floor: 0.1 }).counts.scoreable);
  });
});

describe('the flattened row', () => {
  it('carries the whole recruitability story when scoreable', () => {
    const row = recruitabilityRow(run().results.find((r) => r.result.ok));
    for (const k of ['recruitability', 'athleticPlausibility', 'delta', 'core',
      'positionalOpportunity', 'vacatedStarters', 'typicalStarters', 'fillRate', 'fillLevel']) {
      expect(row, k).toHaveProperty(k);
    }
  });

  it('carries no recruitability number when unscoreable, but keeps the plausibility', () => {
    const row = recruitabilityRow(run().results.find((r) => !r.result.ok && r.plaus.ok));
    expect(row.scoreable).toBe(false);
    expect(row).not.toHaveProperty('recruitability');
    expect(row.athleticPlausibility).toBeGreaterThan(0);
  });
});
