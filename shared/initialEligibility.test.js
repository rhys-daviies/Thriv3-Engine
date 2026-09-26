/**
 * A7.33 — the safe foundation, held to what A7.32 actually sourced.
 *
 * The suite's real job is the pair of ISOLATION properties: institutional
 * admissions evidence must not move an eligibility result, and eligibility
 * evidence must not move an admissions one. A7.30 found the product
 * collapsing them, and a test that only checked the happy states would not
 * have noticed.
 */
import { describe, it, expect } from 'vitest';
import {
  INITIAL_ELIGIBILITY_RESULT, VERIFICATION_STATUS, STALENESS, SOURCE_STATUS,
  INITIAL_ELIGIBILITY_RULES, UNVERIFIED_ASSOCIATIONS,
  assessInitialEligibility, initialEligibilityForAthlete, ruleStaleness, academicYearStart,
} from './initialEligibility.js';
import { eligibilityRuleFor, ELIGIBILITY_MODEL, UNRULED_DIVISIONS } from './eligibility.js';

const NOW = '2026-09-26';
const at = (division, extra = {}) => assessInitialEligibility({ division, asOf: NOW, ...extra });

describe('A. NCAA Division I resolves conservatively and reads no test score', () => {
  it('is NOT_ESTABLISHED for an ordinary domestic athlete', () => {
    expect(at('NCAA D1').result).toBe(INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED);
  });

  it('names the inputs it lacks rather than implying the rule is doubtful', () => {
    const r = at('NCAA D1');
    expect(r.rule.verificationStatus).toBe(VERIFICATION_STATUS.VERIFIED);
    expect(r.rule.evaluable).toBe(false);
    expect(r.rule.requires).toContain('coreCourseGpa');
    expect(r.reason).toMatch(/transcript GPA is not a core-course GPA/);
  });

  it('encodes the verified facts and NOT a test-score requirement', () => {
    const f = at('NCAA D1').rule.facts;
    expect(f.coreCourses).toBe(16);
    expect(f.coreCourseGpaMinimum).toBe(2.300);
    expect(f.standardizedTestRequired).toBe(false);
    expect(f.timingRule).toMatch(/10\/7/);
  });
});

describe('B. NCAA Division II is sourced separately and does not inherit Division I', () => {
  it('is NOT_ESTABLISHED for an ordinary domestic athlete', () => {
    expect(at('NCAA D2').result).toBe(INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED);
  });

  it('carries its own GPA minimum and its own subject distribution', () => {
    const d1 = at('NCAA D1').rule.facts;
    const d2 = at('NCAA D2').rule.facts;
    expect(d2.coreCourseGpaMinimum).toBe(2.200);
    expect(d2.coreCourseGpaMinimum).not.toBe(d1.coreCourseGpaMinimum);
    expect(d2.distribution).not.toEqual(d1.distribution);
    expect(d2.distribution.english).toBe(3);
  });

  it('has NO 10/7 timing rule, because the Division II source does not state one', () => {
    // The specific "DII = DI" assumption A7.32 was told to test rather than presume.
    expect(at('NCAA D2').rule.facts.timingRule).toBeNull();
  });
});

describe('C and D. Division III is two rules wearing one name', () => {
  it('domestic: NOT_APPLICABLE, because there is no national standard', () => {
    const r = at('NCAA D3');
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.NOT_APPLICABLE);
    expect(r.certifyingAuthority).toBe('The institution');
  });

  it('domestic: says explicitly that this is NOT admission or clearance', () => {
    expect(at('NCAA D3').reason).toMatch(/not a statement that the athlete is admitted or academically cleared/);
  });

  it('international: NOT_APPLICABLE would be wrong — the Eligibility Center certifies them', () => {
    const r = at('NCAA D3', { isInternational: true });
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED);
    expect(r.result).not.toBe(INITIAL_ELIGIBILITY_RESULT.NOT_APPLICABLE);
    expect(r.certifyingAuthority).toBe('NCAA Eligibility Center');
  });
});

describe('E, F, G. unverified associations are named, never guessed', () => {
  it.each(['NAIA', 'NJCAA', 'USCAA'])('%s is RULE_UNVERIFIED', (division) => {
    expect(at(division).result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });

  it('NAIA records that a PROBABLE standard exists and is deliberately not encoded', () => {
    const naia = UNVERIFIED_ASSOCIATIONS.find((a) => a.association === 'NAIA');
    expect(naia.verificationStatus).toBe(VERIFICATION_STATUS.PARTIAL);
    expect(naia.why).toMatch(/404/);
    // PARTIAL is not VERIFIED, and no NAIA rule may be in the rule table.
    expect(INITIAL_ELIGIBILITY_RULES.some((r) => r.association === 'NAIA')).toBe(false);
  });

  it('USCAA records the naming hazard, so nobody encodes the corporate body', () => {
    const u = UNVERIFIED_ASSOCIATIONS.find((a) => a.association === 'USCAA');
    expect(u.why).toMatch(/Corporate Athletics Association/);
  });

  it('an unrecognised division is RULE_UNVERIFIED, never an NCAA default', () => {
    expect(at('NCAA D4').result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
    expect(at(null).result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });
});

describe('H and I. a stale rule degrades and is not applied', () => {
  it('AGE: a rule verified more than a year ago stops being current', () => {
    const r = assessInitialEligibility({ division: 'NCAA D1', asOf: '2027-10-01' });
    expect(r.staleness).toBe(STALENESS.STALE_AGE);
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });

  it('CYCLE: a rule verified before the current academic year began stops being current', () => {
    expect(academicYearStart('2027-09-01')).toBe('2027-08-01');
    const r = assessInitialEligibility({ division: 'NCAA D1', asOf: '2027-08-15' });
    expect(r.staleness).toBe(STALENESS.STALE_CYCLE);
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });

  it('SOURCE: an unreachable source makes the rule unverified, whatever its age', () => {
    const gone = INITIAL_ELIGIBILITY_RULES.map((r) => (r.division === 'NCAA D1'
      ? { ...r, sourceStatus: SOURCE_STATUS.UNREACHABLE } : r));
    const r = assessInitialEligibility({ division: 'NCAA D1', asOf: NOW, rules: gone });
    expect(r.staleness).toBe(STALENESS.STALE_SOURCE);
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });

  it('a stale Division III rule does NOT keep returning NOT_APPLICABLE', () => {
    // The dangerous case: the one evaluable rule silently surviving expiry.
    const r = assessInitialEligibility({ division: 'NCAA D3', asOf: '2028-01-01' });
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });

  it('every rule on file is CURRENT as at its verification date', () => {
    for (const rule of INITIAL_ELIGIBILITY_RULES) {
      expect(ruleStaleness(rule, { asOf: NOW }), rule.division).toBe(STALENESS.CURRENT);
    }
  });
});

describe('J and K. admissions and test evidence cannot move an eligibility result', () => {
  /** Two athletes differing in every academic and admissions-relevant field. */
  const strong = { origin: 'USA', gpa: 4.0, sat_score: 1600, act_score: 36, academic_minimum: 4 };
  const weak = { origin: 'USA', gpa: 1.0, sat_score: 400, act_score: 1, academic_minimum: null };

  it.each(['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA', 'USCAA'])(
    '%s returns the same result for a 4.0/1600 and a 1.0/400 athlete', (division) => {
      const a = initialEligibilityForAthlete({ athlete: strong, division, asOf: NOW });
      const b = initialEligibilityForAthlete({ athlete: weak, division, asOf: NOW });
      expect(a.result).toBe(b.result);
      expect(a.reason).toBe(b.reason);
    },
  );

  it('SAT specifically changes nothing at Division I or II', () => {
    for (const division of ['NCAA D1', 'NCAA D2']) {
      const scores = [null, 400, 1000, 1600].map((sat) => initialEligibilityForAthlete({
        athlete: { origin: 'USA', sat_score: sat }, division, asOf: NOW,
      }).result);
      expect(new Set(scores).size, division).toBe(1);
    }
  });

  it('the only athlete field read is origin', () => {
    const domestic = initialEligibilityForAthlete({ athlete: { origin: 'USA' }, division: 'NCAA D3', asOf: NOW });
    const intl = initialEligibilityForAthlete({ athlete: { origin: 'International' }, division: 'NCAA D3', asOf: NOW });
    expect(domestic.result).not.toBe(intl.result);
  });
});

describe('the result contract itself', () => {
  it('has no VERIFIED_ELIGIBLE state, in any spelling', () => {
    const values = Object.values(INITIAL_ELIGIBILITY_RESULT);
    expect(values).not.toContain('VERIFIED_ELIGIBLE');
    expect(values.some((v) => /ELIGIBLE/.test(v))).toBe(false);
  });

  it('never claims Thriv3 certifies anything, and always names who does where one is known', () => {
    for (const division of ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA']) {
      const r = at(division);
      expect(r.thriv3Certifies, division).toBe(false);
      expect(r.certifyingAuthority, division).toBeTruthy();
    }
  });

  it('reaches neither REVIEW_REQUIRED nor NO_ISSUE_IDENTIFIED in this phase, by construction', () => {
    const reachable = new Set();
    for (const division of ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA', 'USCAA', 'NCAA D4']) {
      for (const isInternational of [true, false]) {
        reachable.add(assessInitialEligibility({ division, isInternational, asOf: NOW }).result);
      }
    }
    expect(reachable.has(INITIAL_ELIGIBILITY_RESULT.REVIEW_REQUIRED)).toBe(false);
    expect(reachable.has(INITIAL_ELIGIBILITY_RESULT.NO_ISSUE_IDENTIFIED)).toBe(false);
    expect([...reachable].sort()).toEqual(['NOT_APPLICABLE', 'NOT_ESTABLISHED', 'RULE_UNVERIFIED']);
  });

  it('every encoded rule carries a source, a section and a verification date', () => {
    for (const r of INITIAL_ELIGIBILITY_RULES) {
      expect(r.source, r.division).toBeTruthy();
      expect(r.sourceSection, r.division).toBeTruthy();
      expect(r.verifiedAt, r.division).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.verificationStatus, r.division).toBe(VERIFICATION_STATUS.VERIFIED);
    }
  });
});

describe('L. continuing eligibility is a different module and is untouched', () => {
  it('still answers its own question for every division it rules', () => {
    expect(eligibilityRuleFor({ division: 'NCAA D1', season: 2026 }).model)
      .toBe(ELIGIBILITY_MODEL.NCAA_AGE_BASED_5Y);
    expect(eligibilityRuleFor({ division: 'NCAA D3', season: 2026 }).model)
      .toBe(ELIGIBILITY_MODEL.FOUR_SEASONS);
    expect(eligibilityRuleFor({ division: 'NAIA', season: 2026 }).model)
      .toBe(ELIGIBILITY_MODEL.FOUR_SEASONS);
  });

  it('still refuses the associations it has no rule for', () => {
    expect(UNRULED_DIVISIONS).toEqual(['NJCAA', 'USCAA']);
    expect(eligibilityRuleFor({ division: 'NJCAA', season: 2026 }).model).toBe(ELIGIBILITY_MODEL.UNKNOWN);
  });

  it('and the two modules disagree about NAIA WITHOUT either being wrong', () => {
    /**
     * The clearest demonstration that these are different questions: NAIA
     * continuing eligibility is ruled and sourced, while NAIA INITIAL
     * eligibility is not. A reader who expected one answer for "NAIA
     * eligibility" is the reader this separation exists for.
     */
    expect(eligibilityRuleFor({ division: 'NAIA', season: 2026 }).model).toBe(ELIGIBILITY_MODEL.FOUR_SEASONS);
    expect(at('NAIA').result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });
});
