import { describe, it, expect } from 'vitest';
import {
  ARCHITECTURES, R_C_WITH_FLOOR, marketMatch, shrink, SHRINK_K,
} from './v2RecruitabilityArchitectures.js';

/**
 * A7.7.3. Diagnostic-only, but the property it pins is the one that decides
 * the architecture: a programme whose negative evidence is MISSING must not
 * score higher than an identical programme whose negative evidence was
 * measured. Three of the four candidates fail it, and they fail it for the
 * same reason - renormalising over the signals that happen to exist lets the
 * surviving signal absorb the missing one's weight.
 */
const A_measuredLow = { A: 1, P: 0.05, M: 0.8 };
const B_unknown = { A: 1, P: null, M: 0.8 };

describe('missing data must not be rewarded', () => {
  it('renormalising architectures reward it', () => {
    for (const name of ['R-A weighted core', 'R-B evidence-renormalised', 'R-D positive/negative/unknown']) {
      const fn = ARCHITECTURES[name];
      expect(fn(B_unknown), name).toBeGreaterThan(fn(A_measuredLow));
    }
  });

  it('R-C does not', () => {
    const fn = ARCHITECTURES['R-C baseline + modifiers'];
    expect(fn(B_unknown)).toBeLessThan(fn(A_measuredLow));
  });

  it('and neither does R-C with the evidence floor', () => {
    expect(R_C_WITH_FLOOR(B_unknown)).toBeLessThan(R_C_WITH_FLOOR(A_measuredLow));
  });

  it('the current architecture sidesteps it by refusing entirely', () => {
    // Not a number, so not compared. Correct, and it is why Tier 3 currently
    // leaves the ranked list.
    expect(ARCHITECTURES['CURRENT  A x (phi + (1-phi)P)'](B_unknown)).toBeNull();
  });
});

describe('athletic plausibility stays primary', () => {
  it('no behavioural evidence rescues an implausible athlete under any candidate', () => {
    const implausible = { A: 0.1, P: 1, M: 1 };
    for (const [name, fn] of Object.entries({ ...ARCHITECTURES, 'R-C floor': R_C_WITH_FLOOR })) {
      const v = fn(implausible);
      if (v === null) continue;
      expect(v, name).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });
});

describe('R-C with the evidence floor keeps the A7.3 refusal', () => {
  it('refuses when no behavioural signal exists at all', () => {
    // The NJCAA case: we can say the athlete is good enough and nothing
    // whatever about whether the programme would take one.
    expect(R_C_WITH_FLOOR({ A: 0.9, P: null, M: null })).toBeNull();
    expect(ARCHITECTURES['R-C baseline + modifiers']({ A: 0.9, P: null, M: null })).not.toBeNull();
  });

  it('scores when only the behavioural signal is known', () => {
    expect(R_C_WITH_FLOOR({ A: 0.9, P: null, M: 0.7 })).toBeGreaterThan(0);
  });
});

describe('shrinkage toward the division baseline', () => {
  it('pulls a three-observation rate most of the way back', () => {
    // 3 of 3 international arrivals, in a division that runs at 0.2.
    const v = shrink(3, 3, 0.2);
    expect(v).toBeLessThan(0.5);
    expect(v).toBeGreaterThan(0.2);
  });

  it('lets a programme with a full class of its own dominate', () => {
    expect(shrink(40, 40, 0.2)).toBeGreaterThan(0.75);
  });

  it('returns the baseline when nothing is observed', () => {
    expect(shrink(0, 0, 0.2)).toBeCloseTo(0.2, 6);
  });

  it('uses roughly one recruiting class as the pseudo-count', () => {
    expect(SHRINK_K).toBe(10);
  });
});

describe('market match', () => {
  const prog = { arrivals: 40, internationalShare: 0.6, nearShare: 0.8 };

  it('refuses a programme with too little history rather than guessing', () => {
    expect(marketMatch({ athleteIsInternational: true, distanceKm: null, prog: { arrivals: 4 } })).toBeNull();
    expect(marketMatch({ athleteIsInternational: false, distanceKm: 100, prog: null })).toBeNull();
  });

  it('matches an international athlete against international history', () => {
    expect(marketMatch({ athleteIsInternational: true, distanceKm: null, prog })).toBe(0.6);
  });

  it('reads a local footprint as evidence FOR a nearby athlete and AGAINST a distant one', () => {
    expect(marketMatch({ athleteIsInternational: false, distanceKm: 100, prog })).toBe(0.8);
    expect(marketMatch({ athleteIsInternational: false, distanceKm: 1500, prog })).toBeCloseTo(0.2, 6);
  });

  it('refuses when the athlete has no usable distance', () => {
    expect(marketMatch({ athleteIsInternational: false, distanceKm: null, prog })).toBeNull();
  });

  it('refuses when the programme has no domestic geographic history', () => {
    expect(marketMatch({ athleteIsInternational: false, distanceKm: 100, prog: { arrivals: 40, nearShare: null } })).toBeNull();
  });
});
