import { describe, it, expect } from 'vitest';
import { athleticPlausibility, plausibilityFromDelta } from './athleticPlausibility.js';
import { GRADE, REASON } from '../types.js';
import { PLAUSIBILITY_SLOPE, PLAUSIBILITY_MIDPOINT } from '../recruitingRules.js';

const A = (rating, soccerScore, sport = 'mens-soccer') => athleticPlausibility({ rating, soccerScore, sport });

describe('the curve is monotone, not a bell', () => {
  it('a better athlete is never less plausible at a fixed programme', () => {
    let prev = -1;
    for (const rating of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const v = A(rating, 73.4).value;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('a strong athlete stays near 1 at a weak programme, where V1 would fall away', () => {
    // The Gaussian's defect stated as a test: a Division III coach does not
    // become less interested as the player in front of them gets better.
    expect(A(10, 20).value).toBeGreaterThan(0.99);
    expect(A(10, 20).value).toBeGreaterThan(A(10, 73.4).value);
  });

  it('a weaker programme never lowers coach interest, all else equal', () => {
    let prev = Infinity;
    for (const score of [20, 35, 50, 65, 80, 95]) {
      const v = A(8, score).value;
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('passes one half exactly at parity', () => {
    // Rating 8 maps to the 89th percentile; the score at that percentile is
    // the programme it is calibrated against.
    const r = A(8, 73.38);
    expect(Math.abs(r.basis.delta)).toBeLessThan(0.01);
    expect(r.value).toBeCloseTo(0.5, 2);
  });

  it('never reaches either end across the achievable range of delta', () => {
    // Both terms are percentiles of the same distribution, so delta lives in
    // (-1, 1) by construction. Far outside it the logistic saturates to
    // exactly 1 in floating point, which is why the domain is what is tested.
    for (let d = -1; d <= 1.0001; d += 0.02) {
      const v = plausibilityFromDelta(Math.min(1, Number(d.toFixed(4))));
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('stays inside the unit interval even where the exponential underflows', () => {
    expect(plausibilityFromDelta(-5)).toBeGreaterThan(0);
    expect(plausibilityFromDelta(5)).toBeLessThanOrEqual(1);
  });
});

describe('the ceiling bites where it must', () => {
  it('scores a developmental athlete at an elite programme near zero', () => {
    // Rating 3 (18th percentile) against a national contender (99th).
    expect(A(3, 95).value).toBeLessThan(0.01);
  });

  it('separates a reach from a stretch from an impossibility', () => {
    const atLevel = A(8, 73.38).value;
    const reach = A(8, 79.6).value;     // UNC Greensboro
    const stretch = A(8, 94.9).value;   // Maryland
    expect(atLevel).toBeGreaterThan(reach);
    expect(reach).toBeGreaterThan(stretch);
    expect(reach).toBeGreaterThan(0.25);
    expect(stretch).toBeLessThan(0.35);
  });
});

describe('the parameters are separable from the form', () => {
  it('takes slope and midpoint as arguments', () => {
    const steep = athleticPlausibility({ rating: 5, soccerScore: 70, sport: 'mens-soccer', slope: 0.06 });
    const shallow = athleticPlausibility({ rating: 5, soccerScore: 70, sport: 'mens-soccer', slope: 0.2 });
    expect(steep.value).toBeLessThan(shallow.value);
    expect(steep.basis.slope).toBe(0.06);
  });

  it('defaults to the declared heuristics and records them', () => {
    const r = A(6, 55);
    expect(r.basis.slope).toBe(PLAUSIBILITY_SLOPE);
    expect(r.basis.midpoint).toBe(PLAUSIBILITY_MIDPOINT);
  });

  it('a steeper slope is steeper on both sides of parity', () => {
    expect(plausibilityFromDelta(-0.1, { slope: 0.06 })).toBeLessThan(plausibilityFromDelta(-0.1, { slope: 0.2 }));
    expect(plausibilityFromDelta(0.1, { slope: 0.06 })).toBeGreaterThan(plausibilityFromDelta(0.1, { slope: 0.2 }));
  });
});

describe('what it refuses', () => {
  it('has no athlete level', () => {
    expect(A(null, 70).reason).toBe(REASON.NO_ATHLETE_LEVEL);
    expect(A(undefined, 70).ok).toBe(false);
  });

  it('has no programme level', () => {
    const r = A(8, null);
    expect(r.reason).toBe(REASON.NO_PROGRAMME_LEVEL);
    expect(r.available).toEqual(['athleteRating']);
  });

  it('never returns a neutral score for either', () => {
    expect('value' in A(null, 70)).toBe(false);
    expect('value' in A(8, null)).toBe(false);
  });
});

describe('both sides live on the calibrated percentile axis', () => {
  it('records the two percentiles and their difference', () => {
    const r = A(7, 50);
    expect(r.basis.athletePercentile).toBeCloseTo(0.78, 10);
    expect(r.basis.programmePercentile).toBeGreaterThan(0);
    expect(r.basis.delta).toBeCloseTo(r.basis.athletePercentile - r.basis.programmePercentile, 12);
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('reads the two sports on their own scales', () => {
    // The same rating against the same raw score means different things,
    // because Division I sits at a different place in each distribution.
    expect(A(6, 60, 'mens-soccer').value).not.toBe(A(6, 60, 'womens-soccer').value);
  });
});
