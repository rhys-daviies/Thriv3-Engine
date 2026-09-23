import { describe, it, expect } from 'vitest';
import { athleticPlausibility, plausibilityFromDelta } from './athleticPlausibility.js';
import { GRADE, REASON } from '../types.js';
import { COMPATIBILITY_AT_LEVEL, COMPATIBILITY_DECAY, COMPATIBILITY_RISE } from '../recruitingRules.js';

const A = (rating, soccerScore, sport = 'mens-soccer') => athleticPlausibility({ rating, soccerScore, sport });

describe('the curve is monotone, not a bell', () => {
  it('a better athlete is never less compatible at a fixed programme', () => {
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

  it('a weaker programme never lowers compatibility, all else equal', () => {
    let prev = Infinity;
    for (const score of [20, 35, 50, 65, 80, 95]) {
      const v = A(8, score).value;
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('is monotone non-decreasing across the whole achievable domain', () => {
    let prev = -1;
    for (let d = -1; d <= 1.0001; d += 0.005) {
      const v = plausibilityFromDelta(Math.min(1, Number(d.toFixed(5))));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('the value at the athlete\'s own level', () => {
  /**
   * The correction A7.7.13 exists to make. The ability scale already declares
   * that a rating IS a percentile of the programme distribution; scoring the
   * programme at that percentile as an even proposition discounted the same
   * fact twice, and because this term multiplies recruitability it halved
   * every at-level programme.
   */
  it('returns exactly the declared at-level constant at parity', () => {
    expect(plausibilityFromDelta(0)).toBe(COMPATIBILITY_AT_LEVEL);
    expect(plausibilityFromDelta(0)).toBe(0.8);
  });

  it('reads a real at-level programme as strongly compatible, not as a coin flip', () => {
    // Rating 8 maps to the 89th percentile; 73.38 is the score at that
    // percentile, so this is the programme the rating is calibrated against.
    const r = A(8, 73.38);
    expect(Math.abs(r.basis.delta)).toBeLessThan(0.01);
    expect(r.value).toBeGreaterThan(0.75);
    expect(r.value).toBeCloseTo(0.8, 1);
  });

  it('is continuous where the two branches meet', () => {
    const below = plausibilityFromDelta(-1e-9);
    const above = plausibilityFromDelta(1e-9);
    expect(Math.abs(above - below)).toBeLessThan(1e-7);
    expect(below).toBeLessThanOrEqual(COMPATIBILITY_AT_LEVEL);
    expect(above).toBeGreaterThanOrEqual(COMPATIBILITY_AT_LEVEL);
  });
});

describe('the published shape', () => {
  /**
   * The eight values the A7.7.13 robustness surface was chosen on, pinned so
   * that editing a constant is a visible decision rather than a silent drift.
   */
  const PUBLISHED = [
    [-0.20, 0.066], [-0.15, 0.123], [-0.10, 0.229], [-0.05, 0.428],
    [0.00, 0.800], [0.05, 0.893], [0.10, 0.943], [0.20, 0.984],
  ];

  it.each(PUBLISHED)('delta %s is about %s', (delta, expected) => {
    expect(plausibilityFromDelta(delta)).toBeCloseTo(expected, 3);
  });

  it('saturates toward one above the programme, without reaching it in range', () => {
    expect(plausibilityFromDelta(0.4)).toBeGreaterThan(0.99);
    expect(plausibilityFromDelta(0.8)).toBeGreaterThan(0.999);
    expect(plausibilityFromDelta(0.8)).toBeLessThan(1);
  });

  it('stays inside the unit interval even where the exponential underflows', () => {
    expect(plausibilityFromDelta(-5)).toBeGreaterThan(0);
    expect(plausibilityFromDelta(-5)).toBeLessThan(1e-20);
    expect(plausibilityFromDelta(5)).toBeLessThanOrEqual(1);
  });

  it('never leaves [0,1] anywhere in the achievable domain', () => {
    for (let d = -1; d <= 1.0001; d += 0.01) {
      const v = plausibilityFromDelta(Math.min(1, Number(d.toFixed(4))));
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
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

  it('falls away faster below the athlete than it climbs above, by design', () => {
    // The asymmetry that lets the curve tell an at-level programme apart from
    // a genuine reach on an axis that compresses at the top.
    const lost = COMPATIBILITY_AT_LEVEL - plausibilityFromDelta(-0.05);
    const gained = plausibilityFromDelta(0.05) - COMPATIBILITY_AT_LEVEL;
    expect(lost).toBeGreaterThan(gained * 3);
  });
});

describe('the parameters are separable from the form', () => {
  it('takes the at-level value, the decay and the rise as arguments', () => {
    const steep = athleticPlausibility({ rating: 5, soccerScore: 70, sport: 'mens-soccer', decay: 0.05 });
    const shallow = athleticPlausibility({ rating: 5, soccerScore: 70, sport: 'mens-soccer', decay: 0.2 });
    expect(steep.value).toBeLessThan(shallow.value);
    expect(steep.basis.decay).toBe(0.05);
  });

  it('defaults to the declared heuristics and records them', () => {
    const r = A(6, 55);
    expect(r.basis.atLevel).toBe(COMPATIBILITY_AT_LEVEL);
    expect(r.basis.decay).toBe(COMPATIBILITY_DECAY);
    expect(r.basis.rise).toBe(COMPATIBILITY_RISE);
    expect(r.basis.form).toBe('asymmetric exponential in percentile space');
  });

  it('a lower at-level value lowers the whole curve', () => {
    for (const d of [-0.2, -0.05, 0, 0.05, 0.2]) {
      expect(plausibilityFromDelta(d, { atLevel: 0.7 })).toBeLessThan(plausibilityFromDelta(d, { atLevel: 0.8 }));
    }
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
