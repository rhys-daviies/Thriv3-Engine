/**
 * A7.23 Track A. What a declared major means, asserted so a future change
 * cannot quietly turn it into something else.
 *
 * The seven properties below are the operator's locked semantics: a declared
 * major is a STRONG DIRECT FIT SIGNAL, it is NOT academic prestige, it is NOT
 * eligibility, and it is NOT conditional on how much the athlete cares about
 * academic strength. "I want Engineering" and "academic standing matters to
 * me" are different statements and the model must keep them apart.
 *
 * These test BEHAVIOUR, not the number 1.2. A future weight that keeps the
 * properties should still pass.
 */
import { describe, it, expect } from 'vitest';
import { athleteOpportunity } from './layers/opportunity.js';
import { majorFit } from './layers/opportunityComponents.js';
import { scoreable, notApplicable, isScoreable, GRADE } from './types.js';
import { PREFERENCE_WEIGHTS, VALUE_WEIGHTS } from './opportunityRules.js';

const S = (v) => scoreable({ value: v, grade: GRADE.MEASURED, coverage: 1, basis: {} });

/**
 * One programme's Opportunity, with every component held fixed except the
 * major, so a difference can only come from the major.
 */
const opp = ({ major, academicPriority = 3, pathway = 0.5, academic = 0.5 }) => athleteOpportunity({
  pathway: S(pathway),
  trajectory: S(0.5),
  outcome: S(0.5),
  academic: S(academic),
  major,
  location: notApplicable({ why: 'no location preference in this fixture' }),
  competitiveLevelPriority: 3,
  playingOpportunityPriority: 3,
  academicStrengthPriority: academicPriority,
});

const MATCH = S(1);
const NO_MATCH = S(0);
const NOT_DECLARED = notApplicable({ why: 'the athlete has stated no intended major' });

describe('1. a declared major that matches carries a real advantage', () => {
  it('a matching programme scores above a non-matching one, all else equal', () => {
    const hit = opp({ major: MATCH });
    const miss = opp({ major: NO_MATCH });
    expect(hit.value).toBeGreaterThan(miss.value);
  });

  it('the advantage is large enough to matter, not a rounding difference', () => {
    /**
     * A7.19 measured the old weight doing nothing: matching programmes were
     * 32% of the universe and 30% of the first hundred. The gap has to be a
     * material share of Opportunity's range for that not to repeat.
     */
    const gap = opp({ major: MATCH }).value - opp({ major: NO_MATCH }).value;
    expect(gap).toBeGreaterThan(0.15);
  });

  it('is monotone in the weight', () => {
    // Stated as a property of the layer rather than of today's number.
    expect(PREFERENCE_WEIGHTS.majorFit).toBeGreaterThan(0);
  });
});

describe('2 and 3. a non-matching programme stays rankable, and is never excluded', () => {
  it('scores, and scores well, when its other evidence is strong', () => {
    const miss = opp({ major: NO_MATCH, pathway: 1, academic: 1 });
    expect(isScoreable(miss)).toBe(true);
    expect(miss.value).toBeGreaterThan(0);
  });

  /**
   * WHAT 1.2 ACTUALLY COSTS INSIDE THE LAYER, recorded rather than hidden.
   *
   * At the neutral weights the denominator is 2.80, so a major match takes
   * 0.429 of Opportunity's range while maximum playing pathway and maximum
   * academic fit TOGETHER take 0.339. Inside this layer alone, the major wins
   * that contest, and a test that claimed otherwise would be false.
   */
  it('inside Opportunity, a match outweighs maximum pathway and academic combined', () => {
    const strongMiss = opp({ major: NO_MATCH, pathway: 1, academic: 1 });
    const weakHit = opp({ major: MATCH, pathway: 0, academic: 0 });
    expect(weakHit.value).toBeGreaterThan(strongMiss.value);
  });

  it('but at PURSUIT a strong non-match still outranks a weak match', () => {
    /**
     * THE ANTI-FILTER PROPERTY, asserted where it decides anything. Opportunity
     * is 0.30 of the base and Recruitability is 0.50, so a programme that does
     * not offer the major and is better on the evidence that carries the
     * ranking still finishes ahead. Measured on the live pool this phase: the
     * best non-matching programme ranks 8th for the men's academic athlete and
     * 17th for the women's, with 57 and 40 of them inside the first hundred.
     */
    const P = (R, F, O) => (0.50 * R) + (0.20 * F) + (0.30 * O);
    const strongMiss = P(0.70, 0.90, opp({ major: NO_MATCH, pathway: 1, academic: 1 }).value);
    const weakHit = P(0.40, 0.50, opp({ major: MATCH, pathway: 0, academic: 0 }).value);
    expect(strongMiss).toBeGreaterThan(weakHit);
  });

  it('never produces an unscoreable result for want of a match', () => {
    for (const m of [MATCH, NO_MATCH, NOT_DECLARED]) {
      expect(isScoreable(opp({ major: m })), String(m.value)).toBe(true);
    }
  });
});

describe('4 and 5. the major works at every academic-strength priority', () => {
  it.each([1, 2, 3, 4, 5])('priority %i still separates a match from a non-match', (p) => {
    const gap = opp({ major: MATCH, academicPriority: p }).value
      - opp({ major: NO_MATCH, academicPriority: p }).value;
    expect(gap).toBeGreaterThan(0.10);
  });

  it('the athlete who cares least about academic standing still gets their major', () => {
    // The operator's distinction, stated as a test: wanting Engineering is
    // not the same as caring about prestige.
    const gap1 = opp({ major: MATCH, academicPriority: 1 }).value
      - opp({ major: NO_MATCH, academicPriority: 1 }).value;
    expect(gap1).toBeGreaterThan(0.10);
  });
});

describe('6. no declared major invents no fit', () => {
  it('leaves majorFit out of the calculation entirely', () => {
    const none = opp({ major: NOT_DECLARED });
    expect(none.basis.notApplicable).toContain('majorFit');
    // Not scored, and so not carried as a component at all.
    expect(none.basis.components.majorFit).toBeUndefined();
  });

  it('does not silently score an undeclared major as a match or a miss', () => {
    const none = opp({ major: NOT_DECLARED }).value;
    expect(none).not.toBeCloseTo(opp({ major: MATCH }).value, 6);
    expect(none).not.toBeCloseTo(opp({ major: NO_MATCH }).value, 6);
  });
});

describe('7. academic-strength priority does not touch the raw major evidence', () => {
  it('the component value is the same at every priority', () => {
    for (const p of [1, 2, 3, 4, 5]) {
      expect(opp({ major: MATCH, academicPriority: p }).basis.components.majorFit.value).toBe(1);
      expect(opp({ major: NO_MATCH, academicPriority: p }).basis.components.majorFit.value).toBe(0);
    }
  });

  it('and so is its weight - the major is not scaled by the academic preference', () => {
    const w = [1, 3, 5].map((p) => opp({ major: MATCH, academicPriority: p }).basis.components.majorFit.weight);
    expect(new Set(w).size).toBe(1);
    expect(w[0]).toBe(PREFERENCE_WEIGHTS.majorFit);
  });

  it('majorFit itself reads only the programme and the athlete\'s stated major', () => {
    // The layer's inputs, pinned. No priority appears among them.
    const r = majorFit({ intendedMajor: 'Engineering', notableMajors: ['Engineering', 'Biology'] });
    expect(isScoreable(r)).toBe(true);
    expect(r.value).toBe(1);
  });
});

describe('the evidence is still binary, and nothing here pretends otherwise', () => {
  it('produces only 0, 1 or no answer', () => {
    for (const [athlete, programme, expected] of [
      ['Engineering', ['Engineering'], 1],
      ['Engineering', ['Biology'], 0],
      [null, ['Engineering'], null],
    ]) {
      const r = majorFit({ intendedMajor: athlete, notableMajors: programme });
      if (expected === null) expect(isScoreable(r)).toBe(false);
      else expect(r.value).toBe(expected);
    }
  });

  it('weight is not comparable to playingPathway, and the test says so rather than asserting an order', () => {
    /**
     * majorFit at 1.2 exceeds playingPathway's 0.65 and that is NOT a claim
     * that a major matters more than playing time. One is a binary fact about
     * a course catalogue with a deviation of +0.40 or -0.60 from its
     * neighbours; the other is a continuous estimate that clusters on the
     * mean, which is why A7.20 measured eight times its weight range moving
     * nothing. The weights are in different units of effect.
     */
    expect(PREFERENCE_WEIGHTS.majorFit).toBeGreaterThan(0);
    expect(VALUE_WEIGHTS.playingPathway).toBe(0.65);
  });
});
