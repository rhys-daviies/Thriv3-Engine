import { describe, it, expect } from 'vitest';
import {
  GRADE, REASON, RANKING_STATE,
  scoreable, unscoreable, notApplicable,
  isScoreable, isNotApplicable, isRankingState, assertResult,
} from './types.js';

describe('the scoreable shape', () => {
  it('carries a value, a grade, a coverage and a basis', () => {
    const r = scoreable({ value: 0.4, grade: GRADE.MEASURED, coverage: 1, basis: { openings: 2 } });
    expect(r).toMatchObject({ ok: true, value: 0.4, grade: GRADE.MEASURED, coverage: 1 });
    expect(r.basis.openings).toBe(2);
  });

  it('accepts a measured zero - it is a finding, not an absence', () => {
    const r = scoreable({ value: 0, grade: GRADE.MEASURED });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(0);
    expect(isScoreable(r)).toBe(true);
  });

  it('refuses a value that is not finite', () => {
    expect(() => scoreable({ value: NaN, grade: GRADE.MEASURED })).toThrow(/finite/);
    expect(() => scoreable({ value: Infinity, grade: GRADE.MEASURED })).toThrow(/finite/);
    expect(() => scoreable({ value: null, grade: GRADE.MEASURED })).toThrow(/finite/);
    expect(() => scoreable({ value: undefined, grade: GRADE.MEASURED })).toThrow(/finite/);
  });

  it('refuses a value outside 0-1', () => {
    expect(() => scoreable({ value: 1.2, grade: GRADE.MEASURED })).toThrow(/\[0,1\]/);
    expect(() => scoreable({ value: -0.01, grade: GRADE.MEASURED })).toThrow(/\[0,1\]/);
  });

  it('refuses a coverage outside 0-1', () => {
    expect(() => scoreable({ value: 0.5, grade: GRADE.MEASURED, coverage: 1.5 })).toThrow(/coverage/);
    expect(() => scoreable({ value: 0.5, grade: GRADE.MEASURED, coverage: -1 })).toThrow(/coverage/);
  });

  it('refuses ASSUMED by name, because that is the grade that must not come back', () => {
    expect(() => scoreable({ value: 0.5, grade: 'ASSUMED' })).toThrow(/ASSUMED is abolished/);
  });

  it('refuses any grade outside MEASURED and PARTIAL', () => {
    expect(() => scoreable({ value: 0.5, grade: 'GUESS' })).toThrow(/MEASURED or PARTIAL/);
    expect(() => scoreable({ value: 0.5, grade: undefined })).toThrow(/MEASURED or PARTIAL/);
    expect(Object.keys(GRADE)).toEqual(['MEASURED', 'PARTIAL']);
  });

  it('is frozen, so a consumer cannot edit a result in place', () => {
    const r = scoreable({ value: 0.4, grade: GRADE.PARTIAL });
    expect(() => { r.value = 0.9; }).toThrow();
  });
});

describe('the unscoreable shape', () => {
  it('carries a reason and no number', () => {
    const r = unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['positionalOpportunity'] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_ROSTER_ON_FILE);
    expect('value' in r).toBe(false);
    expect(isScoreable(r)).toBe(false);
  });

  it('covers nothing by default', () => {
    expect(unscoreable({ reason: REASON.NO_COST_BASIS }).coverage).toBe(0);
  });

  it('may report partial coverage, for a layer that got some way and stopped', () => {
    const r = unscoreable({ reason: REASON.BELOW_COVERAGE_FLOOR, coverage: 0.3, available: ['academicFit'] });
    expect(r.coverage).toBe(0.3);
    expect(r.available).toEqual(['academicFit']);
  });

  it('refuses a reason outside the vocabulary', () => {
    expect(() => unscoreable({ reason: 'DUNNO' })).toThrow(/one of REASON/);
  });

  it('assertResult rejects an unscoreable result that smuggled a number in', () => {
    expect(() => assertResult({ ok: false, reason: REASON.NO_COST_BASIS, coverage: 0, value: 0 }))
      .toThrow(/that is a claim, not an absence/);
    expect(() => assertResult({ ok: false, reason: REASON.NO_COST_BASIS, coverage: 0, score: 50 }))
      .toThrow(/that is a claim, not an absence/);
  });

  it('assertResult rejects anything that is neither shape', () => {
    expect(() => assertResult(null)).toThrow();
    expect(() => assertResult(0.5)).toThrow();
    expect(() => assertResult({ value: 0.5 })).toThrow(/ok must be true or false/);
  });

  it('assertResult passes both good shapes through unchanged', () => {
    const s = scoreable({ value: 0.2, grade: GRADE.MEASURED });
    const u = unscoreable({ reason: REASON.NO_AID_RULE });
    expect(assertResult(s)).toBe(s);
    expect(assertResult(u)).toBe(u);
  });
});

describe('NOT_APPLICABLE', () => {
  it('is an unscoreable result with its own reason', () => {
    const r = notApplicable({ why: 'domestic athlete' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NOT_APPLICABLE);
    expect(isNotApplicable(r)).toBe(true);
  });

  it('is not confused with any other absence', () => {
    expect(isNotApplicable(unscoreable({ reason: REASON.NO_ROSTER_ON_FILE }))).toBe(false);
    expect(isNotApplicable(scoreable({ value: 0, grade: GRADE.MEASURED }))).toBe(false);
  });
});

describe('ranking states', () => {
  it('keeps INELIGIBLE and SUPPRESSED apart - rule against person', () => {
    expect(RANKING_STATE.INELIGIBLE).not.toBe(RANKING_STATE.SUPPRESSED);
    expect(Object.keys(RANKING_STATE).sort())
      .toEqual(['INELIGIBLE', 'LIMITED_DATA', 'RANKED', 'SUPPRESSED']);
  });

  it('recognises its own vocabulary and nothing else', () => {
    expect(isRankingState('RANKED')).toBe(true);
    expect(isRankingState('UNSCOREABLE')).toBe(false);
  });
});
