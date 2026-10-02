/**
 * =============================================================================
 * A8.2 — THE majorFit TRUTH TABLE.
 *
 * The defect: absence from `colleges.notable_majors` was scored as a MEASURED
 * 0 at full coverage, under a comment saying nothing was inferred. The field
 * is built from College Scorecard PCIP COMPLETION SHARES and names an
 * institution's largest fields of study - a mean of 7.55 of 14 families. 321
 * of 349 Division I women's programmes omit Mathematics, including Penn State,
 * Ohio State, Wisconsin and Texas A&M, all of which grant mathematics degrees.
 *
 * Every row below states value, state, coverage, reason and what a reader is
 * told, because a repair that fixed the number and left the sentence saying
 * "they do not offer it" would not have fixed anything.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { majorFit } from './opportunityComponents.js';
import { REASON, GRADE, isScoreable, isNotApplicable } from '../types.js';
import { refusalPhrase } from '../explain/vocabulary.js';

const KIN = '["Business","Kinesiology","Biology"]';
/** A real shape: a large university that omits Mathematics from its list. */
const BIG_PUBLIC = '["Business","Engineering","Computer Science","Biology","Psychology","Communications","Health Professions","Education","Political Science"]';

describe('A8.2 majorFit truth table', () => {
  it('T1. no intended major - NOT_APPLICABLE, never a non-match', () => {
    for (const v of [null, undefined, '', '   ']) {
      const r = majorFit({ intendedMajor: v, notableMajors: KIN });
      expect(isNotApplicable(r), JSON.stringify(v)).toBe(true);
      expect(isScoreable(r)).toBe(false);
      expect(r.value ?? null).toBe(null);
    }
  });

  it('T2. positive match - a measurement, and it stays one', () => {
    const r = majorFit({ intendedMajor: 'kinesiology', notableMajors: KIN });
    expect(isScoreable(r)).toBe(true);
    expect(r.value).toBe(1);
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.coverage).toBe(1);
    expect(r.basis.matched).toBe(true);
  });

  it('T3. absent from a PARTIAL list - refuses, and is never a zero', () => {
    const r = majorFit({ intendedMajor: 'mathematics', notableMajors: BIG_PUBLIC });
    expect(isScoreable(r)).toBe(false);
    expect(isNotApplicable(r)).toBe(false);
    expect(r.reason).toBe(REASON.MAJOR_NOT_IN_PARTIAL_EVIDENCE);
    /** The defect, stated as an assertion: there must be no value at all. */
    expect(r.value ?? null).toBe(null);
    expect(r.grade ?? null).toBe(null);
    expect(r.available).toContain('notableMajors');
  });

  it('T4. no programme evidence - refuses, with its own reason', () => {
    for (const v of ['[]', [], null, undefined]) {
      const r = majorFit({ intendedMajor: 'biology', notableMajors: v });
      expect(isScoreable(r), JSON.stringify(v)).toBe(false);
      expect(r.reason).toBe(REASON.NO_PROGRAMME_MAJOR_EVIDENCE);
      expect(r.value ?? null).toBe(null);
    }
  });

  it('T5. an empty list and a partial list are the same unknown, told apart', () => {
    const empty = majorFit({ intendedMajor: 'mathematics', notableMajors: '[]' });
    const partial = majorFit({ intendedMajor: 'mathematics', notableMajors: BIG_PUBLIC });
    expect(isScoreable(empty)).toBe(isScoreable(partial));
    expect(empty.value ?? null).toBe(partial.value ?? null);
    /** Same state, different reason - one has no list, one has an unhelpful list. */
    expect(empty.reason).not.toBe(partial.reason);
  });

  it('T6. a synonym matches the family it names', () => {
    for (const phrase of ['exercise science', 'Exercise Science', 'sports medicine', 'athletic training']) {
      const r = majorFit({ intendedMajor: phrase, notableMajors: KIN });
      expect(isScoreable(r), phrase).toBe(true);
      expect(r.value).toBe(1);
    }
  });

  it('T7. an unplaceable or undecided athlete major - NOT_APPLICABLE, not a non-match', () => {
    for (const v of ['undecided', 'underwater basket weaving', 'not sure yet']) {
      const r = majorFit({ intendedMajor: v, notableMajors: KIN });
      expect(isNotApplicable(r), v).toBe(true);
      expect(r.value ?? null).toBe(null);
    }
  });

  it('T8. malformed programme evidence refuses rather than parsing to a non-match', () => {
    for (const v of ['not json', '{"a":1}', '42', 'null']) {
      const r = majorFit({ intendedMajor: 'biology', notableMajors: v });
      expect(isScoreable(r), v).toBe(false);
      expect(r.value ?? null).toBe(null);
      expect(r.reason).toBe(REASON.NO_PROGRAMME_MAJOR_EVIDENCE);
    }
  });

  it('T9. NO value of majorFit is ever 0 - the defect, as a standing assertion', () => {
    const cases = [
      [null, KIN], ['kinesiology', KIN], ['mathematics', BIG_PUBLIC], ['biology', '[]'],
      ['exercise science', KIN], ['undecided', KIN], ['biology', 'not json'],
      ['english', BIG_PUBLIC], ['art & design', BIG_PUBLIC],
    ];
    for (const [a, p] of cases) {
      const r = majorFit({ intendedMajor: a, notableMajors: p });
      expect(r.value ?? null, `${a} / ${p}`).not.toBe(0);
    }
  });

  it('T10. the sentence does not say the institution lacks the major', () => {
    const text = refusalPhrase(REASON.MAJOR_NOT_IN_PARTIAL_EVIDENCE);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    /** It must describe the list, not make a claim about the catalogue. */
    for (const forbidden of ['does not offer', 'not offered', 'no such major', 'lacks']) {
      expect(text.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    expect(text.toLowerCase()).toContain('not established');
  });

  it('T11. there is no authoritative-negative branch, because no such evidence exists', () => {
    /**
     * Guards the §C finding. If a genuine catalogue is ever imported, a
     * negative branch becomes legitimate - and this test should be the thing
     * that fails and sends the next person to the preregistration.
     */
    const r = majorFit({ intendedMajor: 'mathematics', notableMajors: BIG_PUBLIC });
    expect(r.reason).not.toBe('MAJOR_NOT_OFFERED');
    expect(r.value ?? null).toBe(null);
  });
});
