import { describe, it, expect } from 'vitest';
import { combine, component } from './coverage.js';
import { GRADE, REASON, scoreable, unscoreable, notApplicable } from './types.js';

const measured = (v) => scoreable({ value: v, grade: GRADE.MEASURED });
const partial = (v) => scoreable({ value: v, grade: GRADE.PARTIAL });
const absent = (reason = REASON.NO_ROSTER_ON_FILE) => unscoreable({ reason });

describe('A. a measured zero at full coverage', () => {
  const r = combine([
    component('openings', 0.7, measured(0)),
    component('international', 0.3, measured(0)),
  ], { floor: 0.6 });

  it('survives as a value, not as an absence', () => {
    expect(r.ok).toBe(true);
    expect(r.value).toBe(0);
  });

  it('is fully covered and fully measured', () => {
    expect(r.coverage).toBe(1);
    expect(r.grade).toBe(GRADE.MEASURED);
  });
});

describe('B. a missing component', () => {
  const r = combine([
    component('openings', 0.7, measured(0.8)),
    component('international', 0.3, absent()),
  ], { floor: 0.6 });

  it('reduces coverage by that component weight', () => {
    expect(r.coverage).toBeCloseTo(0.7, 10);
  });

  it('renormalises the value over what was scored, not over everything', () => {
    // 0.8 alone, NOT 0.8 x 0.7 - an unmeasured component is not a zero.
    expect(r.value).toBeCloseTo(0.8, 10);
  });

  it('names what is missing and why', () => {
    expect(r.basis.missing).toEqual([{ key: 'international', reason: REASON.NO_ROSTER_ON_FILE }]);
  });
});

describe('C. a NOT_APPLICABLE component', () => {
  const r = combine([
    component('openings', 0.7, measured(0.8)),
    component('international', 0.3, notApplicable({ why: 'domestic athlete' })),
  ], { floor: 0.6 });

  it('leaves the denominator instead of counting as a gap', () => {
    expect(r.coverage).toBe(1);
  });

  it('lets the remaining component carry the whole layer', () => {
    expect(r.value).toBeCloseTo(0.8, 10);
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('is recorded, so the explanation can say it did not apply', () => {
    expect(r.basis.notApplicable).toEqual(['international']);
  });

  it('is measurably different from the same component being missing', () => {
    const asMissing = combine([
      component('openings', 0.7, measured(0.8)),
      component('international', 0.3, absent()),
    ], { floor: 0.6 });
    expect(r.value).toBe(asMissing.value);
    expect(r.coverage).not.toBe(asMissing.coverage);
  });
});

describe('D. a required component missing', () => {
  const r = combine([
    component('costBasis', 1.0, absent(REASON.NO_COST_BASIS), { required: true }),
    component('trajectory', 0.2, measured(0.9)),
  ], { floor: 0 });

  it('makes the layer unscoreable whatever the floor says', () => {
    expect(r.ok).toBe(false);
  });

  it('reports the component own reason, not a generic one', () => {
    expect(r.reason).toBe(REASON.NO_COST_BASIS);
    expect(r.detail.requiredMissing).toBe('costBasis');
  });

  it('still reports how far it got', () => {
    expect(r.coverage).toBeCloseTo(0.2 / 1.2, 10);
    expect(r.available).toEqual(['trajectory']);
  });

  it('refuses a component that is both required and not applicable', () => {
    expect(() => combine([
      component('costBasis', 1, notApplicable(), { required: true }),
    ], { floor: 0 })).toThrow(/required but reported NOT_APPLICABLE/);
  });
});

describe('E. partial evidence', () => {
  it('downgrades the layer grade when any scored component is PARTIAL', () => {
    const r = combine([
      component('a', 0.5, measured(0.6)),
      component('b', 0.5, partial(0.4)),
    ], { floor: 0.5 });
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.value).toBeCloseTo(0.5, 10);
  });

  it('keeps MEASURED only when every scored component is measured', () => {
    const r = combine([
      component('a', 0.5, measured(0.6)),
      component('b', 0.5, measured(0.4)),
    ], { floor: 0.5 });
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('does not let a MISSING component downgrade the grade of what was measured', () => {
    const r = combine([
      component('a', 0.8, measured(0.6)),
      component('b', 0.2, absent()),
    ], { floor: 0.5 });
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.coverage).toBeCloseTo(0.8, 10);
  });
});

describe('F. weight renormalisation', () => {
  it('weights the survivors in proportion to each other', () => {
    const r = combine([
      component('a', 0.6, measured(1)),
      component('b', 0.3, measured(0)),
      component('c', 0.1, absent()),
    ], { floor: 0.5 });
    // 0.6/0.9 of the way to 1, not 0.6/1.0.
    expect(r.value).toBeCloseTo(0.6 / 0.9, 10);
    expect(r.coverage).toBeCloseTo(0.9, 10);
  });

  it('reports the share each component actually took', () => {
    const r = combine([
      component('a', 0.6, measured(1)),
      component('b', 0.3, measured(0)),
      component('c', 0.1, absent()),
    ], { floor: 0.5 });
    expect(r.basis.components.a.share).toBeCloseTo(2 / 3, 10);
    expect(r.basis.components.b.share).toBeCloseTo(1 / 3, 10);
  });

  it('does not depend on the weights summing to one', () => {
    const scaled = combine([
      component('a', 6, measured(1)),
      component('b', 3, measured(0)),
      component('c', 1, absent()),
    ], { floor: 0.5 });
    expect(scaled.value).toBeCloseTo(0.6 / 0.9, 10);
    expect(scaled.coverage).toBeCloseTo(0.9, 10);
  });
});

describe('G. below the coverage floor', () => {
  const r = combine([
    component('a', 0.7, absent()),
    component('b', 0.3, measured(0.9)),
  ], { floor: 0.6 });

  it('is unscoreable, and says so by that name', () => {
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.BELOW_COVERAGE_FLOOR);
  });

  it('reports the coverage it reached and the floor it failed', () => {
    expect(r.coverage).toBeCloseTo(0.3, 10);
    expect(r.detail.floor).toBe(0.6);
  });

  it('carries no value, however much was measured', () => {
    expect('value' in r).toBe(false);
  });

  it('passes at exactly the floor - the floor is a minimum, not a gap', () => {
    const at = combine([
      component('a', 0.4, absent()),
      component('b', 0.6, measured(0.9)),
    ], { floor: 0.6 });
    expect(at.ok).toBe(true);
    expect(at.coverage).toBeCloseTo(0.6, 10);
  });
});

describe('H. no applicable components', () => {
  const r = combine([
    component('a', 0.5, notApplicable()),
    component('b', 0.5, notApplicable()),
  ], { floor: 0.5 });

  it('is NOT_APPLICABLE, not missing data', () => {
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NOT_APPLICABLE);
  });

  it('propagates, so a parent removes it from ITS denominator too', () => {
    const parent = combine([
      component('inner', 0.5, r),
      component('other', 0.5, measured(0.4)),
    ], { floor: 0.5 });
    expect(parent.ok).toBe(true);
    expect(parent.coverage).toBe(1);
    expect(parent.value).toBeCloseTo(0.4, 10);
  });
});

describe('value and coverage stay separate', () => {
  it('two layers with the same value and different coverage have the same value', () => {
    const full = combine([component('a', 1, measured(0.7)), component('b', 1, measured(0.7))], { floor: 0 });
    const half = combine([component('a', 1, measured(0.7)), component('b', 1, absent())], { floor: 0 });
    expect(full.value).toBeCloseTo(half.value, 10);
    expect(full.coverage).toBe(1);
    expect(half.coverage).toBe(0.5);
  });
});

describe('the machinery has no product opinions', () => {
  it('requires the caller to state a floor rather than defaulting to one', () => {
    expect(() => combine([component('a', 1, measured(0.5))])).toThrow(/floor must be stated/);
    expect(() => combine([component('a', 1, measured(0.5))], { floor: null })).toThrow(/floor must be stated/);
  });

  it('accepts a floor of zero, which is a decision like any other', () => {
    expect(combine([component('a', 1, measured(0.5))], { floor: 0 }).ok).toBe(true);
  });

  it('rejects duplicate keys, empty lists and bad weights', () => {
    expect(() => combine([component('a', 1, measured(1)), component('a', 1, measured(0))], { floor: 0 })).toThrow(/duplicate/);
    expect(() => combine([], { floor: 0 })).toThrow(/at least one component/);
    expect(() => combine([component('a', -1, measured(1))], { floor: 0 })).toThrow(/non-negative weight/);
  });

  it('rejects a component whose result is not a contract result', () => {
    expect(() => combine([{ key: 'a', weight: 1, result: 0.5 }], { floor: 0 })).toThrow(/component a/);
  });

  it('refuses when every applicable component carries zero weight', () => {
    expect(() => combine([component('a', 0, measured(0.5))], { floor: 0 })).toThrow(/zero total weight/);
  });
});
