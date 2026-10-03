/**
 * A7.18. The twelve properties Candidate G was accepted on, asserted so that
 * a future change cannot quietly undo any of them.
 *
 * These are NOT tests of the numbers 0.45, 0.35, 0.18 and tau. They are tests
 * of the ORDERINGS and the ABSENCES that A7.16's acceptance conditions turned
 * on: which evidence state beats which, that nothing is excluded for its
 * level, that a stated preference still moves the list, and that everything
 * outside G is untouched. A repair that keeps the properties and changes the
 * parameters should still pass.
 */
import { describe, it, expect } from 'vitest';
import { coachRecruitability } from './layers/recruitability.js';
import { athleticPlausibility, plausibilityFromDelta } from './layers/athleticPlausibility.js';
import { pursuitPriority } from './layers/pursuit.js';
import { scoreable, unscoreable, notApplicable, GRADE, REASON, isScoreable } from './types.js';
import {
  CORE_FLOOR, BEHAVIOUR_WEIGHTS, positionalSupport,
  POSITIONAL_PRIOR, POSITIONAL_ZERO_PENALTY,
  COMPATIBILITY_AT_LEVEL, COMPATIBILITY_DECAY, COMPATIBILITY_RISE,
} from './recruitingRules.js';
import {
  levelFactor, levelAlignment, LEVEL_ANCHOR_TAU, LEVEL_ANCHOR_DEFAULT_PRIORITY,
  PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate,
} from './pursuitRules.js';

const SPORT = 'mens-soccer';
const A = athleticPlausibility({ rating: 8, soccerScore: 73.38, sport: SPORT });
const MEASURED = (v) => scoreable({ value: v, grade: GRADE.MEASURED, coverage: 1, basis: {} });
const UNKNOWN = unscoreable({ reason: REASON.NO_MINUTES_HISTORY });
const MARKET = MEASURED(0.5);

const R = (positional, market = MARKET) => coachRecruitability({ athletic: A, positional, market });

// ---------------------------------------------------------------- 1, 3, 4
describe('1. positive positional beats unknown beats measured zero, all else equal', () => {
  const zero = R(MEASURED(0));
  const unknown = R(UNKNOWN);
  const small = R(MEASURED(0.174));   // the smallest positive the 2028 quantisation produces
  const large = R(MEASURED(1));

  it('holds on the value', () => {
    expect(zero.value).toBeLessThan(unknown.value);
    expect(unknown.value).toBeLessThan(small.value);
    expect(small.value).toBeLessThan(large.value);
  });

  it('holds on the formula for every positive value, not just the ones sampled', () => {
    for (let p = 1e-9; p <= 1; p += 0.01) {
      expect(positionalSupport(p), `p=${p}`).toBeGreaterThan(positionalSupport(null));
    }
    expect(positionalSupport(0)).toBeLessThan(positionalSupport(null));
  });

  it('3. unknown does not become a measured zero', () => {
    expect(positionalSupport(null)).not.toBeCloseTo(positionalSupport(0), 6);
    expect(unknown.basis.positionalEvidence).toBe('UNKNOWN');
    expect(zero.basis.positionalEvidence).toBe('NONE_DETECTED');
    expect(small.basis.positionalEvidence).toBe('DETECTED');
    // and the unknown one still reports itself as unmeasured
    expect(unknown.basis.positionalPriorUsed).toBe(true);
    expect(zero.basis.positionalPriorUsed).toBe(false);
    expect(unknown.coverage).toBeLessThan(zero.coverage);
    expect(unknown.grade).toBe(GRADE.PARTIAL);
  });

  it('4. positive positional evidence still meaningfully increases recruitability', () => {
    // The full positional range must be worth more than half the behavioural
    // range it owns - it is the leading signal and must stay one.
    const span = large.value - zero.value;
    expect(span).toBeGreaterThan(A.value * (1 - CORE_FLOOR) * BEHAVIOUR_WEIGHTS.positional * 0.5);
    // and each step up is strictly better than the last
    let prev = -1;
    for (const p of [0, 0.174, 0.35, 0.5, 0.75, 1]) {
      const v = R(MEASURED(p)).value;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

// ---------------------------------------------------------------------- 2
describe('2. a measured zero does not make a programme structurally ineligible', () => {
  it('still scores, and reaches a usable recruitability', () => {
    const zero = R(MEASURED(0));
    expect(isScoreable(zero)).toBe(true);
    // The A7.13-A7.15 pathology: support could not exceed 0.25 and R could
    // not exceed A x 0.5125, which put every such programme past rank 129.
    expect(zero.value).toBeGreaterThan(A.value * (CORE_FLOOR + ((1 - CORE_FLOOR) * 0.25)));
  });

  it('clears the recruitability gate, so pursuit is not suppressed by it', () => {
    const zero = R(MEASURED(0));
    expect(tailGate(zero.value, PURSUIT_GATES.recruitability)).toBe(1);
  });

  it('the evidence floor still refuses when NOTHING behavioural is known', () => {
    // A7.18 gives an unknown positional a prior. It does not invent a layer:
    // with no behavioural signal at all there is still no answer.
    const none = coachRecruitability({ athletic: A, positional: UNKNOWN, market: UNKNOWN });
    expect(isScoreable(none)).toBe(false);
  });

  it('NOT_APPLICABLE is not given the prior, because it is a different statement', () => {
    const na = coachRecruitability({ athletic: A, positional: notApplicable({ reason: REASON.NOT_APPLICABLE }), market: MARKET });
    expect(na.basis.positionalEvidence).toBe('NOT_APPLICABLE');
    expect(na.basis.positionalContribution).toBe(0);
  });
});

// -------------------------------------------------------------- 5, 6, 7
describe('the competitive-level anchor', () => {
  const far = -0.40;   // a programme far from the athlete in percentile space

  it('5. priority 5 anchors harder than priority 1', () => {
    expect(levelFactor(far, 5).factor).toBeLessThan(levelFactor(far, 1).factor);
    let prev = 2;
    for (const p of [1, 2, 3, 4, 5]) {
      const f = levelFactor(far, p).factor;
      expect(f).toBeLessThan(prev);
      prev = f;
    }
  });

  it('6. the anchor never reaches zero, at any priority or any distance', () => {
    for (const p of [1, 2, 3, 4, 5]) {
      for (const d of [-5, -1, -0.5, -0.2, 0, 0.2, 1, 5]) {
        expect(levelFactor(d, p).factor, `p=${p} d=${d}`).toBeGreaterThan(0);
      }
      // the floor it approaches is 1 - tau, which is strictly positive
      expect(levelFactor(-1e6, p).factor).toBeCloseTo(1 - LEVEL_ANCHOR_TAU[p], 12);
    }
  });

  it('7. a low level priority permits substantial level deviation', () => {
    // At priority 1 a programme 40 percentile points away keeps 90% of its
    // priority, so anything else about it can still carry it.
    expect(levelFactor(far, 1).factor).toBeGreaterThan(0.85);
  });

  it('is a no-op when there is no delta to anchor against', () => {
    expect(levelFactor(null, 5).factor).toBe(1);
    expect(levelAlignment(null)).toBeNull();
  });

  it('treats an unanswered priority as a scoring fallback and says so', () => {
    const f = levelFactor(far, null);
    expect(f.priorityUsed).toBe(LEVEL_ANCHOR_DEFAULT_PRIORITY);
    expect(f.defaulted).toBe(true);
    // 0 is a finite number and must NOT be read as a stated priority
    expect(levelFactor(far, undefined).defaulted).toBe(true);
    expect(levelFactor(far, '').defaulted).toBe(true);
    expect(levelFactor(far, 3).defaulted).toBe(false);
  });

  it('is applied after the gates, and never changes what a gate cost', () => {
    // `scoreable` freezes its result, so the delta goes in at construction.
    const rec = scoreable({ value: 0.6, grade: GRADE.MEASURED, coverage: 1, basis: { athleticDelta: far } });
    const fin = MEASURED(0.4); const opp = MEASURED(0.5);
    const anchored = pursuitPriority({ recruitability: rec, financial: fin, opportunity: opp, competitiveLevelPriority: 5 });
    const plain = pursuitPriority({ recruitability: rec, financial: fin, opportunity: opp, levelAnchor: false });
    expect(anchored.basis.recruitabilityGate).toBe(plain.basis.recruitabilityGate);
    expect(anchored.basis.financialGate).toBe(plain.basis.financialGate);
    expect(anchored.basis.base).toBe(plain.basis.base);
    expect(anchored.value).toBeCloseTo(plain.value * levelFactor(far, 5).factor, 12);
  });
});

// --------------------------------------------------------------- 9, 10, 11
describe('what A7.18 was not allowed to touch', () => {
  it('10. the athletic compatibility curve is unchanged', () => {
    expect(COMPATIBILITY_AT_LEVEL).toBe(0.80);
    expect(COMPATIBILITY_DECAY).toBe(0.08);
    expect(COMPATIBILITY_RISE).toBe(0.08);
    // the shape, pinned at the points A7.7.13 chose it on
    expect(plausibilityFromDelta(0)).toBeCloseTo(0.80, 12);
    expect(plausibilityFromDelta(-0.05)).toBeCloseTo(0.80 * Math.exp(-0.05 / 0.08), 12);
    expect(plausibilityFromDelta(0.05)).toBeCloseTo(0.80 + (0.20 * (1 - Math.exp(-0.05 / 0.08))), 12);
  });

  it('9. the pursuit weights and both gates are unchanged', () => {
    expect(PURSUIT_WEIGHTS).toEqual({ recruitability: 0.50, financial: 0.20, opportunity: 0.30 });
    expect(PURSUIT_GATES.recruitability).toEqual({ floor: 0.05, threshold: 0.25 });
    expect(PURSUIT_GATES.financial).toEqual({ floor: 0.30, threshold: 0.50 });
  });

  it('phi and the behavioural weights are unchanged', () => {
    expect(CORE_FLOOR).toBe(0.35);
    expect(BEHAVIOUR_WEIGHTS).toEqual({ positional: 0.75, market: 0.25 });
  });

  it('the market arm still fills its own slice and nothing expands into it', () => {
    // A7.7.4's property, which A7.18 keeps: an unknown market costs its slice.
    const withMarket = R(MEASURED(0.5), MEASURED(1));
    const without = R(MEASURED(0.5), UNKNOWN);
    expect(withMarket.value - without.value)
      .toBeCloseTo(A.value * (1 - CORE_FLOOR) * BEHAVIOUR_WEIGHTS.market * 1, 12);
    expect(without.coverage).toBeCloseTo(BEHAVIOUR_WEIGHTS.positional, 12);
  });

  it('the declared parameters are the ones A7.16 accepted', () => {
    expect(POSITIONAL_PRIOR).toBe(0.45);
    expect(POSITIONAL_ZERO_PENALTY).toBe(0.35);
    expect(LEVEL_ANCHOR_TAU).toEqual({ 1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40, 5: 0.50 });
  });
});

// -------------------------------------------------------------------- 12
describe('12. LIMITED_DATA stays distinct from negative evidence', () => {
  it('a programme we cannot evaluate is refused, not scored badly', () => {
    const noLevel = coachRecruitability({
      athletic: unscoreable({ reason: REASON.NO_PROGRAMME_LEVEL }),
      positional: MEASURED(0.5), market: MARKET,
    });
    expect(isScoreable(noLevel)).toBe(false);
    expect(noLevel.reason).toBe(REASON.NO_PROGRAMME_LEVEL);
    expect(noLevel).not.toHaveProperty('value');
  });

  it('pursuit refuses rather than scoring when a layer is missing', () => {
    const p = pursuitPriority({
      recruitability: MEASURED(0.6), financial: unscoreable({ reason: REASON.NO_COST_BASIS }),
      opportunity: MEASURED(0.5), competitiveLevelPriority: 5,
    });
    expect(isScoreable(p)).toBe(false);
    expect(p).not.toHaveProperty('value');
  });

  it('an unknown positional is partial evidence, not absent evidence, and not a zero', () => {
    const unknown = R(UNKNOWN);
    expect(isScoreable(unknown)).toBe(true);
    expect(unknown.grade).toBe(GRADE.PARTIAL);
    expect(unknown.basis.positionalEvidence).toBe('UNKNOWN');
    expect(unknown.basis.signals.find((s) => s.key === 'positionalOpportunity').value).toBeNull();
  });
});
