import { describe, it, expect } from 'vitest';
import { evaluateFinancial, financialRow } from './financialRun.js';
import { AID_POLICY_STATUS, GRADE, REASON } from '../../../shared/matching/v2/index.js';

const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA', 'USCAA'];

const colleges = Array.from({ length: 120 }, (_, i) => ({
  id: `c${i}`,
  name: `College ${String(i).padStart(3, '0')}`,
  division: DIVISIONS[i % DIVISIONS.length],
  conference: i === 7 ? 'Ivy League' : `Conf ${i % 9}`,
  control: (i % 3 === 0) ? 1 : 2,
  net_price: i === 11 ? null : 5000 + ((i * 397) % 45000),
  tuition_in_state: 9000 + ((i * 97) % 6000),
  tuition_out_state: 22000 + ((i * 131) % 14000),
  state: ['OH', 'CA', 'TX', 'NY'][i % 4],
}));

const athlete = (over = {}) => ({ budgetRange: '$20k-$25k/yr', state: 'OH', origin: 'USA', ...over });

const run = (over) => evaluateFinancial({ athlete: athlete(over), colleges, sport: 'mens-soccer' });

describe('evaluating the layer across a pool', () => {
  const report = run();

  it('scores everything it holds a price for, and refuses the rest by name', () => {
    expect(report.counts.programmes).toBe(120);
    expect(report.counts.scoreable).toBe(119);
    expect(report.counts.unscoreable).toBe(1);
    expect(report.unscoreableReasons).toEqual({ [REASON.NO_COST_BASIS]: 1 });
  });

  it('reports grades as shares of the whole pool, so they read as parts of one hundred', () => {
    const { measuredRate, partialRate, unscoreableRate } = report.counts;
    expect(measuredRate + partialRate + unscoreableRate).toBeCloseTo(1, 10);
  });

  it('describes the distribution rather than a single number', () => {
    const v = report.viability;
    expect(v.n).toBe(119);
    expect(v.min).toBeLessThan(v.median);
    expect(v.median).toBeLessThanOrEqual(v.max);
    expect(v.max).toBeLessThanOrEqual(1);
    expect(v.min).toBeGreaterThan(0);
  });

  it('breaks the pool down by division, control, cost basis and aid policy', () => {
    expect(Object.keys(report.byDivision).sort()).toEqual([...DIVISIONS].sort());
    expect(Object.keys(report.byControl).sort()).toEqual(['private', 'public']);
    expect(report.byAidPolicy[AID_POLICY_STATUS.UNKNOWN]).toBe(20); // the USCAA sixth
    expect(report.byAidPolicy[AID_POLICY_STATUS.CONFERENCE_RULE]).toBe(1);
    expect(report.byAidPolicy[AID_POLICY_STATUS.DIVISION_RULE]).toBe(20); // D3
    expect(report.counts.aidPolicyUnknownRate).toBeCloseTo(20 / 120, 4);
  });

  it('keeps the aid state on a programme it could not price', () => {
    const refused = report.results.find((r) => !r.result.ok);
    expect(refused.result.detail.aidPolicy).toBeDefined();
    expect(financialRow(refused).aidPolicy).toBeDefined();
  });

  it('produces no ranking, because one layer is not a recommendation', () => {
    expect(report.results.map((r) => r.id)).toEqual(colleges.map((c) => c.id));
    expect(report).not.toHaveProperty('recommendations');
    expect(report).not.toHaveProperty('topN');
    expect(report).not.toHaveProperty('pursuitPriority');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(report));
  });
});

describe('what the pool view shows about the athlete, not just the schools', () => {
  it('a bigger budget never lowers the median', () => {
    const poor = run({ budgetRange: '$5k-$10k/yr' });
    const rich = run({ budgetRange: '$35k-$40k/yr' });
    expect(rich.viability.median).toBeGreaterThanOrEqual(poor.viability.median);
    expect(rich.viability.mean).toBeGreaterThan(poor.viability.mean);
  });

  it('an athlete with no budget makes the whole pool unscoreable, and says why once', () => {
    const none = run({ budgetRange: 'Undeclared' });
    expect(none.counts.scoreable).toBe(0);
    expect(none.viability).toBeNull();
    expect(none.unscoreableReasons[REASON.NO_FAMILY_CONTRIBUTION]).toBe(119);
    expect(none.unscoreableReasons[REASON.NO_COST_BASIS]).toBe(1);
  });

  it('marks an international athlete PARTIAL across the board', () => {
    const intl = run({ origin: 'International', state: null });
    expect(intl.counts.measuredRate).toBe(0);
    expect(intl.counts.partialRate).toBeCloseTo(119 / 120, 4);
  });

  it('gives a domestic athlete the in-state basis only in their own state', () => {
    const oh = run({ state: 'OH' });
    const basisCounts = oh.byCostBasis;
    expect(basisCounts.NET_PRICE_PUBLIC_IN_STATE).toBeGreaterThan(0);
    expect(basisCounts.NET_PRICE_PUBLIC_OUT_OF_STATE).toBeGreaterThan(basisCounts.NET_PRICE_PUBLIC_IN_STATE);
  });

  it('gives an athlete with no state a residency-unknown interval instead of a guess', () => {
    const nowhere = run({ state: null });
    expect(nowhere.byCostBasis.NET_PRICE_PUBLIC_RESIDENCY_UNKNOWN).toBeGreaterThan(0);
    expect(nowhere.byCostBasis.NET_PRICE_PUBLIC_IN_STATE).toBeUndefined();
    expect(nowhere.byCostBasis.NET_PRICE_PUBLIC_OUT_OF_STATE).toBeUndefined();
  });
});

describe('the flattened row a report prints', () => {
  it('carries the whole financial story for a scoreable programme', () => {
    const row = financialRow(run().results.find((r) => r.result.ok));
    for (const k of ['viability', 'viabilityRange', 'grade', 'coverage', 'costBasis',
      'applicableCostRange', 'budgetRange', 'familyContributionRange', 'fundingGapRange',
      'aidPolicy', 'aidPolicyKnown', 'aidHeadroomFraction']) {
      expect(row, k).toHaveProperty(k);
    }
    expect([GRADE.MEASURED, GRADE.PARTIAL]).toContain(row.grade);
  });

  it('carries no number at all for an unscoreable one', () => {
    const row = financialRow(run().results.find((r) => !r.result.ok));
    expect(row.scoreable).toBe(false);
    expect(row).not.toHaveProperty('viability');
    expect(row.reason).toBe(REASON.NO_COST_BASIS);
    expect(row.missing).toContain('costBasis');
  });
});
