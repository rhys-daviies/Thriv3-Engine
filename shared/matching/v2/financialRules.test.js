import { describe, it, expect } from 'vitest';
import {
  BUDGET_INTERVALS, LEGACY_BUDGET_INTERVALS, UNDECLARED_BUDGET, budgetInterval,
  ATHLETIC_AID_RULES, UNRULED_AID_DIVISIONS, NO_ATHLETIC_AID_CONFERENCES,
  CONTRIBUTION_ANCHOR, HALF_VIABILITY_RELATIVE_GAP, CONTROL,
} from './financialRules.js';

describe('budget bands as intervals', () => {
  it('keeps both ends of every current band', () => {
    for (const [band, [lo, hi]] of Object.entries(BUDGET_INTERVALS)) {
      expect(lo).toBeLessThanOrEqual(hi);
      expect(Number.isFinite(lo)).toBe(true);
      expect(band).toBeTruthy();
    }
  });

  it('tiles the range without gaps or overlaps', () => {
    const bands = Object.values(BUDGET_INTERVALS).slice(1); // skip Need Full Scholarship
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i][0]).toBe(bands[i - 1][1]);
    }
  });

  it('reads Need Full Scholarship as a stated zero, not as an absence', () => {
    expect(budgetInterval('Need Full Scholarship').interval).toEqual([0, 0]);
  });

  it('leaves the top band open at the top and stated at the bottom', () => {
    expect(budgetInterval('$40k+/yr').interval).toEqual([40000, Infinity]);
  });

  it('returns null - never zero - for every kind of "we do not know"', () => {
    for (const band of [UNDECLARED_BUDGET, null, undefined, '', 'made up', '$1m/yr']) {
      expect(budgetInterval(band)).toBeNull();
    }
  });

  it('reads the pre-2026-08-25 bands, and marks them as such', () => {
    const legacy = budgetInterval('$15k-$30k/yr');
    expect(legacy.interval).toEqual([15000, 30000]);
    expect(legacy.legacy).toBe(true);
    expect(budgetInterval('$20k-$25k/yr').legacy).toBe(false);
  });

  it('holds every legacy band as a genuine interval too', () => {
    for (const [lo, hi] of Object.values(LEGACY_BUDGET_INTERVALS)) expect(lo).toBeLessThan(hi);
  });
});

describe('athletic-aid rules', () => {
  it('names the divisions it holds and the ones it does not', () => {
    expect(Object.keys(ATHLETIC_AID_RULES).sort())
      .toEqual(['NAIA', 'NCAA D1', 'NCAA D2', 'NCAA D3', 'NJCAA']);
    expect(UNRULED_AID_DIVISIONS).toEqual(['USCAA']);
    for (const d of UNRULED_AID_DIVISIONS) expect(ATHLETIC_AID_RULES[d]).toBeUndefined();
  });

  it('records D3 as a rule of zero rather than as an absent rule', () => {
    expect(ATHLETIC_AID_RULES['NCAA D3']['mens-soccer'].maxFraction).toBe(0);
    expect(ATHLETIC_AID_RULES['NCAA D3']['womens-soccer'].maxFraction).toBe(0);
  });

  it('carries every rule for both sports', () => {
    for (const [division, bySport] of Object.entries(ATHLETIC_AID_RULES)) {
      for (const sport of ['mens-soccer', 'womens-soccer']) {
        expect(bySport[sport], `${division} ${sport}`).toBeDefined();
        expect(bySport[sport].maxFraction).toBeGreaterThanOrEqual(0);
        expect(bySport[sport].maxFraction).toBeLessThanOrEqual(1);
      }
    }
  });

  it('knows the conferences that forbid aid inside an association that permits it', () => {
    expect(NO_ATHLETIC_AID_CONFERENCES).toContain('Ivy League');
  });
});

describe('the two heuristic parameters', () => {
  it('anchors a zero contribution on something the pool justifies', () => {
    // The median net price across active men's programmes on 2026-09-20.
    expect(CONTRIBUTION_ANCHOR).toBe(19454);
  });

  it('states where one half sits, as a relative gap', () => {
    expect(HALF_VIABILITY_RELATIVE_GAP).toBe(0.5);
  });
});

describe('IPEDS control', () => {
  it('names the three codes so no caller compares against a string', () => {
    expect(CONTROL).toEqual({ PUBLIC: 1, PRIVATE_NONPROFIT: 2, PRIVATE_FOR_PROFIT: 3 });
  });
});
