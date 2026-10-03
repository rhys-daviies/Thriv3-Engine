import { describe, it, expect } from 'vitest';
import { academicStrengthFit } from './opportunityComponents.js';
import { athleteOpportunity } from './opportunity.js';
import { isScoreable, isNotApplicable, scoreable, notApplicable, GRADE, REASON } from '../types.js';
import { PREFERENCE_WEIGHTS } from '../opportunityRules.js';

const fit = (priority, percentile) => academicStrengthFit({
  academicStrengthPriority: priority, academicPercentile: percentile,
});

describe('academic strength is a PREFERENCE, not a quality term', () => {
  it('is flat at priority 1, so a stronger institution is worth no more', () => {
    expect(fit(1, 0.99).value).toBeCloseTo(fit(1, 0.01).value, 12);
    expect(fit(1, 0.99).value).toBe(1);
    expect(fit(1, 0.5).basis.inert).toBe(true);
  });

  it('tilts moderately at priority 3', () => {
    const spread = fit(3, 0.9).value - fit(3, 0.1).value;
    expect(spread).toBeGreaterThan(0.2);
    expect(spread).toBeLessThan(0.7);
  });

  it('is the percentile itself at priority 5', () => {
    expect(fit(5, 0.9).value).toBeCloseTo(0.9, 12);
    expect(fit(5, 0.1).value).toBeCloseTo(0.1, 12);
  });

  it('is NOT_APPLICABLE when undeclared, which is not priority 1', () => {
    // Priority 1 is a stated answer that reorders nothing. UNDECLARED is the
    // absence of an answer and leaves the coverage denominator entirely.
    const undeclared = fit(null, 0.9);
    expect(isNotApplicable(undeclared)).toBe(true);
    expect(isScoreable(fit(1, 0.9))).toBe(true);
  });

  it('refuses rather than averaging when the institution has no rating', () => {
    const r = fit(5, null);
    expect(isScoreable(r)).toBe(false);
    expect(r.reason).toBe(REASON.NO_ACADEMIC_PROFILE);
    expect('value' in r).toBe(false);
  });

  it('reads one input and never the athlete\'s own record', () => {
    const text = JSON.stringify(fit(5, 0.8).basis).toLowerCase();
    for (const forbidden of ['gpa', 'sat', 'act', 'admit', 'netprice', 'tuition', 'major']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('is monotone in the percentile at every declared priority above 1', () => {
    for (const p of [2, 3, 4, 5]) {
      expect(fit(p, 0.8).value).toBeGreaterThan(fit(p, 0.2).value);
    }
  });
});

/* ---------------------------------------------------------------- */

const S = (v) => scoreable({ value: v, grade: GRADE.MEASURED, coverage: 1, basis: {} });
const opp = ({ academicPriority = null, academicPercentile = 0.9, playingValue = 0.5 } = {}) =>
  athleteOpportunity({
    pathway: S(playingValue),
    trajectory: S(0.5),
    major: notApplicable({ why: 'not collected' }),
    location: notApplicable({ why: 'not collected' }),
    outcome: notApplicable({ why: 'undeclared' }),
    academic: academicStrengthFit({ academicStrengthPriority: academicPriority, academicPercentile }),
    academicStrengthPriority: academicPriority,
  });

describe('inside Opportunity/Fit', () => {
  it('a strong-academic institution beats a weak one when the athlete cares', () => {
    const strong = opp({ academicPriority: 5, academicPercentile: 0.95 });
    const weak = opp({ academicPriority: 5, academicPercentile: 0.05 });
    expect(strong.value).toBeGreaterThan(weak.value);
  });

  it('and does not when they do not', () => {
    const strong = opp({ academicPriority: 1, academicPercentile: 0.95 });
    const weak = opp({ academicPriority: 1, academicPercentile: 0.05 });
    expect(strong.value).toBeCloseTo(weak.value, 12);
  });

  it('changes nothing at all when undeclared', () => {
    const a = opp({ academicPriority: null, academicPercentile: 0.95 });
    const b = opp({ academicPriority: null, academicPercentile: 0.05 });
    expect(a.value).toBeCloseTo(b.value, 12);
    expect(a.basis.notApplicable).toContain('academicStrengthFit');
  });

  it('stays scoreable when the rating is missing, on its other components', () => {
    const r = athleteOpportunity({
      pathway: S(0.6), trajectory: S(0.5),
      major: notApplicable({ why: 'x' }), location: notApplicable({ why: 'x' }),
      outcome: notApplicable({ why: 'x' }),
      academic: academicStrengthFit({ academicStrengthPriority: 5, academicPercentile: null }),
      academicStrengthPriority: 5,
    });
    expect(isScoreable(r)).toBe(true);
    // The coverage algebra names it among the missing components; the exact
    // key shape belongs to combine(), so assert the fact rather than the spelling.
    expect(JSON.stringify(r.basis.missing)).toContain('academicStrengthFit');
  });

  it('cannot outweigh the objective half on its own', () => {
    // The component carries one preference weight among several; a perfect
    // academic match must not beat a programme that is better on playing
    // opportunity by a wide margin.
    const academicOnly = opp({ academicPriority: 5, academicPercentile: 1, playingValue: 0.1 });
    const playingOnly = opp({ academicPriority: 5, academicPercentile: 0, playingValue: 0.95 });
    expect(playingOnly.value).toBeGreaterThan(academicOnly.value);
  });

  it('carries the same weight as competitive-level ambition, deliberately', () => {
    expect(PREFERENCE_WEIGHTS.academicStrengthFit).toBe(PREFERENCE_WEIGHTS.athleticOutcome);
  });
});

describe('major fit stays independent', () => {
  const withMajor = (matched, academicPriority) => athleteOpportunity({
    pathway: S(0.5), trajectory: S(0.5),
    major: S(matched ? 1 : 0), location: notApplicable({ why: 'x' }), outcome: notApplicable({ why: 'x' }),
    academic: academicStrengthFit({ academicStrengthPriority: academicPriority, academicPercentile: 0.9 }),
    academicStrengthPriority: academicPriority,
  });

  it('an undecided-major athlete can still value academic strength', () => {
    const r = athleteOpportunity({
      pathway: S(0.5), trajectory: S(0.5),
      major: notApplicable({ why: 'no intended major' }),
      location: notApplicable({ why: 'x' }), outcome: notApplicable({ why: 'x' }),
      academic: academicStrengthFit({ academicStrengthPriority: 5, academicPercentile: 0.9 }),
      academicStrengthPriority: 5,
    });
    expect(isScoreable(r)).toBe(true);
    expect(r.basis.academic.academicPercentile).toBe(0.9);
  });

  it('a declared-major athlete can be indifferent to academic strength', () => {
    const a = withMajor(true, 1);
    const b = withMajor(false, 1);
    expect(a.value).toBeGreaterThan(b.value);
  });

  it('the two move independently', () => {
    const strongAcademicWeakMajor = withMajor(false, 5);
    const weakAcademicStrongMajor = withMajor(true, 1);
    expect(strongAcademicWeakMajor.value).not.toBe(weakAcademicStrongMajor.value);
  });
});
