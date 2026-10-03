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
  /**
   * A7.35 MOVED NAIA OUT OF THIS LIST by reading the bylaw. NJCAA and USCAA
   * were not researched that phase and are unchanged, which is the point of
   * asserting them here: closing one gap must not quietly close the others.
   */
  it.each(['NJCAA', 'USCAA'])('%s is RULE_UNVERIFIED', (division) => {
    expect(at(division).result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });

  it('NAIA is no longer among them, and left only by verification', () => {
    expect(UNVERIFIED_ASSOCIATIONS.some((a) => a.association === 'NAIA')).toBe(false);
    const naia = INITIAL_ELIGIBILITY_RULES.find((r) => r.association === 'NAIA');
    expect(naia.verificationStatus).toBe(VERIFICATION_STATUS.VERIFIED);
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

  it('and the two modules answer DIFFERENTLY about NAIA without either being wrong', () => {
    /**
     * A7.33 wrote this test on the observation that NAIA continuing
     * eligibility was ruled while NAIA initial eligibility was not. A7.35
     * verified the initial rule, so BOTH are now sourced - and the answers
     * still differ, which is a stronger demonstration than the original.
     * Continuing eligibility resolves to a model; initial eligibility
     * resolves to NOT_ESTABLISHED, because knowing a rule and holding an
     * athlete's evidence for it are different things. A reader who expected
     * one answer for "NAIA eligibility" is the reader this separation exists
     * for.
     */
    expect(eligibilityRuleFor({ division: 'NAIA', season: 2026 }).model).toBe(ELIGIBILITY_MODEL.FOUR_SEASONS);
    expect(at('NAIA').result).toBe(INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED);
  });

  it('continuing eligibility is byte-for-byte unaffected by the A7.35 rule landing', () => {
    // The NAIA record was added to the OTHER module; this one must not notice.
    expect(eligibilityRuleFor({ division: 'NAIA', season: 2026 }).model).toBe(ELIGIBILITY_MODEL.FOUR_SEASONS);
    expect(UNRULED_DIVISIONS).toEqual(['NJCAA', 'USCAA']);
  });
});

/**
 * =============================================================================
 * A7.35 — the NAIA rule, verified from the 2026-2027 Official Handbook.
 *
 * The suite's job here is NOT to re-assert the numbers. It is to hold the line
 * between the two facts A7.35 established separately: THE RULE IS KNOWN and
 * THE ATHLETE'S EVIDENCE IS ABSENT. Every plausible future mistake collapses
 * those - reading `players.gpa` as the bylaw's GPA, converting ACT to SAT the
 * way admissions does, inventing a class rank, or converting an international
 * grade the NAIA says it converts itself. Each one has a test below.
 * =============================================================================
 */
describe('M. the NAIA rule is sourced, and sourced is not the same as evaluable', () => {
  const naia = () => INITIAL_ELIGIBILITY_RULES.find((r) => r.association === 'NAIA');

  it('carries the bylaw down to the item, the page and the file it was read from', () => {
    const r = naia();
    expect(r.sourceSection).toMatch(/Article V, Section C, Item 2/);
    expect(r.sourcePage).toBe(70);
    expect(r.sourceUrl).toMatch(/2026_Official_Handbook\.pdf$/);
    // The digest is what makes "we read this document" checkable later.
    expect(r.sourceDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.verificationStatus).toBe(VERIFICATION_STATUS.VERIFIED);
  });

  it('represents the effective period by EDITION, and invents no commencement date', () => {
    const r = naia();
    expect(r.edition).toMatch(/41st edition/);
    expect(r.editionEffectiveFor).toBe('2026-2027');
    expect(r.lastRevised).toBe(2021);
    expect(r.amendedInCurrentEdition).toBe(false);
    /**
     * NULL IS THE ASSERTION. The operative text states no commencement date for
     * Item 2, so encoding one would be the invention this phase forbids. The
     * one date the bylaw does give lives on the option it governs.
     */
    expect(r.effectiveFrom).toBeNull();
    expect(r.effectiveTo).toBeNull();
    const test = r.facts.twoOfThree.options.find((o) => o.id === 'standardizedTest');
    expect(test.effectiveFrom).toBe('2019-05-01');
  });

  it('states the required inputs explicitly, including the one Thriv3 has no field for', () => {
    expect(naia().requires).toContain('highSchoolClassRank');
    expect(naia().requires).toContain('finalOverallHighSchoolGpaOn4Scale');
    expect(naia().whyNotEvaluable).toMatch(/CLASS RANK HAS NO FIELD IN THRIV3/);
  });

  it('encodes TWO of three, not one of three - the A7.32 conflict, settled', () => {
    const t = naia().facts.twoOfThree;
    expect(t.required).toBe(2);
    expect(t.of).toBe(3);
    expect(t.options.map((o) => o.id).sort())
      .toEqual(['classRank', 'overallHighSchoolGpa', 'standardizedTest']);
  });

  it('records the 2.300 standalone pathway as standing ALONE', () => {
    const p = naia().facts.standaloneGpaPathway;
    expect(p.minimumGpa).toBe(2.300);
    expect(p.scale).toBe(4.000);
    // Overall, not core-course. The structural difference from the NCAA.
    expect(naia().facts.coreCourseRequirement).toBe(false);
  });

  it('corrects A7.32 on the SAT sections - the bylaw, not the stale interpretation page', () => {
    const test = naia().facts.twoOfThree.options.find((o) => o.id === 'standardizedTest');
    expect(test.satSections).toMatch(/Evidence-Based Reading and Writing/);
    expect(test.satSections).not.toMatch(/Critical Reading/);
    expect(test.minimumSat).toBe(970);
    expect(test.minimumAct).toBe(18);
    expect(test.superScoresAccepted).toBe(false);
    expect(test.singleSittingRequired).toBe(true);
  });
});

describe('N. a verified NAIA rule still returns NOT_ESTABLISHED, and says why', () => {
  it('is NOT_ESTABLISHED, not RULE_UNVERIFIED and never a clearance', () => {
    const r = at('NAIA');
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED);
    expect(r.rule.evaluable).toBe(false);
    expect(r.thriv3Certifies).toBe(false);
    expect(r.certifyingAuthority).toBe('NAIA Eligibility Center (PlayNAIA)');
  });

  it('gives a reason that is TRUE OF THE NAIA, not the NCAA sentence', () => {
    const r = at('NAIA');
    /**
     * THE BUG THIS CATCHES, recorded because it was live until A7.35: the
     * shared reason claimed "standardized test scores are not part of this
     * standard". For the NAIA that is simply false - a test is one of the
     * three. A wrong explanation of a right answer is still wrong.
     */
    expect(r.reason).not.toMatch(/not part of this standard/);
    expect(r.reason).not.toMatch(/core-course/);
    expect(r.reason).toMatch(/CLASS RANK HAS NO FIELD IN THRIV3/);
  });

  it('and the NCAA reason is untouched by that change', () => {
    expect(at('NCAA D1').reason).toMatch(/transcript GPA is not a core-course GPA/);
    expect(at('NCAA D2').reason).toMatch(/transcript GPA is not a core-course GPA/);
  });
});

describe('O. no athlete academic field reaches the NAIA answer', () => {
  /**
   * The NAIA is the one association where `players.gpa` and `players.sat_score`
   * LOOK like the right quantities - overall GPA, an SAT - so this is where an
   * inference would actually be tempting. Hence the widest fixtures in the
   * file, including a class_rank that does not exist in the schema and a
   * perfect record that would clear every published threshold.
   */
  const clears = {
    origin: 'USA', gpa: 4.0, sat_score: 1600, act_score: 36, class_rank: 1, class_size: 400,
  };
  const fails = {
    origin: 'USA', gpa: 0.4, sat_score: 400, act_score: 1, class_rank: 400, class_size: 400,
  };
  const borderline = { origin: 'USA', gpa: 2.300, sat_score: 970, act_score: 18 };

  it.each([['clears', clears], ['fails', fails], ['borderline', borderline]])(
    'an athlete who %s every published NAIA threshold gets the identical answer', (_label, athlete) => {
      const base = initialEligibilityForAthlete({ athlete: clears, division: 'NAIA', asOf: NOW });
      const other = initialEligibilityForAthlete({ athlete, division: 'NAIA', asOf: NOW });
      expect(other.result).toBe(base.result);
      expect(other.reason).toBe(base.reason);
    },
  );

  it('exactly at 2.300 it does NOT report eligible - the standalone pathway is not applied', () => {
    const r = initialEligibilityForAthlete({ athlete: borderline, division: 'NAIA', asOf: NOW });
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED);
    expect(r.result).not.toBe(INITIAL_ELIGIBILITY_RESULT.NO_ISSUE_IDENTIFIED);
  });

  it('no ACT-to-SAT conversion happens, the way admissions does it', () => {
    // Admissions converts an ACT to an SAT equivalent. The NAIA does not, and
    // a converted score is a score the athlete never sat.
    const actOnly = { origin: 'USA', gpa: null, sat_score: null, act_score: 36 };
    const neither = { origin: 'USA', gpa: null, sat_score: null, act_score: null };
    const a = initialEligibilityForAthlete({ athlete: actOnly, division: 'NAIA', asOf: NOW });
    const b = initialEligibilityForAthlete({ athlete: neither, division: 'NAIA', asOf: NOW });
    expect(a.reason).toBe(b.reason);
  });

  it('the assessor takes no GPA, SAT or ACT parameter at all', () => {
    // The guarantee is structural: there is nothing to pass in, so nothing to
    // misuse. Extra properties are inert rather than merely unused.
    const direct = assessInitialEligibility({
      division: 'NAIA', asOf: NOW, gpa: 4.0, sat_score: 1600, act_score: 36, classRank: 1,
    });
    expect(direct.reason).toBe(at('NAIA').reason);
    expect(direct.result).toBe(INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED);
  });
});

describe('P. international handling follows the sourced rule and converts nothing', () => {
  it('applies the SAME criteria, because NOTE 3 says it does', () => {
    const naia = INITIAL_ELIGIBILITY_RULES.find((r) => r.association === 'NAIA');
    expect(naia.facts.internationalSameCriteria).toBe(true);
    // Same result as a domestic athlete - the criteria do not change.
    expect(at('NAIA', { isInternational: true }).result)
      .toBe(at('NAIA', { isInternational: false }).result);
  });

  it('but says the NAIA determines the GPA, rather than Thriv3 converting one', () => {
    const r = at('NAIA', { isInternational: true });
    expect(r.reason).toMatch(/NAIA determines high-school graduation and GPA/);
    expect(r.reason).toMatch(/must not substitute a home-country grade/);
    // The domestic reason must NOT carry the international sentence.
    expect(at('NAIA').reason).not.toMatch(/InCred/);
  });

  it('records that the country-by-country guidelines were NOT retrieved', () => {
    const naia = INITIAL_ELIGIBILITY_RULES.find((r) => r.association === 'NAIA');
    expect(naia.caveats.some((c) => /country conversion is encoded/.test(c))).toBe(true);
    // No country name may appear anywhere in the rule record.
    const text = JSON.stringify(naia);
    for (const country of ['New Zealand', 'Australia', 'NZCEA', 'NCEA', 'A-Level', 'Abitur']) {
      expect(text, country).not.toContain(country);
    }
  });

  it('an international athlete\'s own grade still moves nothing', () => {
    const strong = initialEligibilityForAthlete({
      athlete: { origin: 'International', gpa: 4.0, sat_score: 1600 }, division: 'NAIA', asOf: NOW,
    });
    const weak = initialEligibilityForAthlete({
      athlete: { origin: 'International', gpa: 0.5, sat_score: 400 }, division: 'NAIA', asOf: NOW,
    });
    expect(strong.result).toBe(weak.result);
    expect(strong.reason).toBe(weak.reason);
  });
});

describe('Q. the NAIA rule degrades exactly like every other rule', () => {
  it('goes RULE_UNVERIFIED once it is out of cycle, rather than staying applied', () => {
    const r = assessInitialEligibility({ division: 'NAIA', asOf: '2027-09-01' });
    expect(r.staleness).toBe(STALENESS.STALE_CYCLE);
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });

  it('goes RULE_UNVERIFIED when the handbook PDF stops resolving', () => {
    const gone = INITIAL_ELIGIBILITY_RULES.map((r) => (r.association === 'NAIA'
      ? { ...r, sourceStatus: SOURCE_STATUS.UNREACHABLE } : r));
    const r = assessInitialEligibility({ division: 'NAIA', asOf: NOW, rules: gone });
    expect(r.staleness).toBe(STALENESS.STALE_SOURCE);
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED);
  });

  it('a stale NAIA rule does not drag the NCAA rules down with it', () => {
    const gone = INITIAL_ELIGIBILITY_RULES.map((r) => (r.association === 'NAIA'
      ? { ...r, sourceStatus: SOURCE_STATUS.UNREACHABLE } : r));
    expect(assessInitialEligibility({ division: 'NCAA D1', asOf: NOW, rules: gone }).result)
      .toBe(INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED);
    expect(assessInitialEligibility({ division: 'NCAA D3', asOf: NOW, rules: gone }).result)
      .toBe(INITIAL_ELIGIBILITY_RESULT.NOT_APPLICABLE);
  });
});

describe('R. NCAA behaviour is unchanged by A7.35', () => {
  it.each([
    ['NCAA D1', INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED],
    ['NCAA D2', INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED],
    ['NCAA D3', INITIAL_ELIGIBILITY_RESULT.NOT_APPLICABLE],
  ])('%s still resolves to %s', (division, expected) => {
    expect(at(division).result).toBe(expected);
  });

  it('no NCAA rule gained a test-score requirement from its NAIA neighbour', () => {
    for (const r of INITIAL_ELIGIBILITY_RULES.filter((x) => x.association === 'NCAA')) {
      if (r.ruleType === 'NO_NATIONAL_STANDARD') continue;
      expect(r.facts.standardizedTestRequired, r.division).toBe(false);
      expect(r.facts.standardizedTestRole, r.division).toBeUndefined();
      expect(r.facts.coreCourses, r.division).toBe(16);
    }
  });

  it('and no NAIA fact leaked a core-course concept', () => {
    const naia = INITIAL_ELIGIBILITY_RULES.find((r) => r.association === 'NAIA');
    expect(naia.facts.coreCourses).toBeUndefined();
    expect(naia.facts.coreCourseRequirement).toBe(false);
  });

  it('VERIFIED_ELIGIBLE still does not exist anywhere in the contract', () => {
    expect(Object.keys(INITIAL_ELIGIBILITY_RESULT)).not.toContain('VERIFIED_ELIGIBLE');
    expect(Object.values(INITIAL_ELIGIBILITY_RESULT)).not.toContain('VERIFIED_ELIGIBLE');
  });
});
