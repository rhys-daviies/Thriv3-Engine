/**
 * INITIAL ACADEMIC ELIGIBILITY — may an ENTERING athlete compete at all?
 *
 * RULES AS DATA, and nothing else. This file evaluates no athlete's academic
 * record, because Thriv3 does not hold the quantities the rules turn on.
 *
 * ---------------------------------------------------------------------------
 * THREE QUESTIONS THAT SHARE THE WORD "ACADEMIC" AND NOTHING ELSE.
 *
 *   INITIAL ELIGIBILITY      may an entering athlete COMPETE?          <- here
 *                            athlete x governing association
 *
 *   CONTINUING ELIGIBILITY   may a current roster player REMAIN?
 *                            shared/eligibility.js, untouched by this file
 *
 *   INSTITUTIONAL ADMISSIONS will this UNIVERSITY admit this athlete?
 *                            a different dimension again; A7.27-A7.30
 *
 * They are decided by different authorities, vary with different things, and
 * fail differently. A7.30 found the product collapsing the first two into the
 * third: a 1.0 GPA at a 90%-acceptance university read as NO CONCERN, because
 * the only signal that existed was an admissions signal. Keeping them apart is
 * the entire purpose of this module.
 *
 * ---------------------------------------------------------------------------
 * WHY NOTHING HERE READS A GPA OR A TEST SCORE.
 *
 * `assessInitialEligibility` takes an association, a division and whether the
 * athlete is international. IT DOES NOT TAKE A GPA, A SAT OR AN ACT, and that
 * is a guarantee rather than an omission: there is nothing here to misuse.
 *
 *   - NCAA DI and DII are assessed on a CORE-COURSE GPA computed over
 *     NCAA-approved courses from that school's approved list. Thriv3 holds a
 *     transcript GPA. THEY ARE DIFFERENT QUANTITIES and substituting one for
 *     the other would manufacture a verdict.
 *   - Standardized test scores were REMOVED from NCAA initial eligibility
 *     (DI Proposal 2022-34, effective 2023-08-01). Reading `sat_score` here
 *     would apply a rule that no longer exists.
 *   - The 16-course inventory, the subject distribution and the DI 10/7
 *     completion timing are not inputs Thriv3 has at all.
 *
 * So every NCAA DI and DII assessment resolves to NOT_ESTABLISHED by
 * CONSTRUCTION, not by calculation. That is the honest answer and it is
 * stable until a verified core-course record exists.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE. Every rule carries its source, section, effective date and
 * verification date, following shared/eligibility.js: "A rule with no source
 * is not a rule." The specification is docs/validation/A7.32-eligibility-rules.md
 * and this file does not exceed it.
 */

/**
 * What Thriv3 may conclude. There is deliberately NO "VERIFIED_ELIGIBLE".
 *
 * Thriv3 certifies eligibility for no association, in no division, ever. The
 * authorities are the NCAA Eligibility Center, the NAIA Eligibility Center
 * (PlayNAIA), and for NCAA Division III domestic athletes the institution
 * itself. A state claiming otherwise would be false in every case, so it does
 * not exist to be selected by mistake.
 */
export const INITIAL_ELIGIBILITY_RESULT = Object.freeze({
  /**
   * No governing-body academic standard applies. Today this is reached by
   * exactly one path: a DOMESTIC NCAA Division III athlete, because Division
   * III sets no national academic standard.
   *
   * IT DOES NOT MEAN admitted, academically cleared, or eligible. It means
   * this dimension has no question to answer, and the institutional
   * admissions dimension still does.
   */
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  /**
   * A rule is on file and verified, and Thriv3 lacks the inputs it turns on.
   * THE COMMON CASE, and the default for every NCAA DI and DII athlete.
   */
  NOT_ESTABLISHED: 'NOT_ESTABLISHED',
  /**
   * Available evidence is materially inconsistent with a verified standard.
   *
   * DEFINED BUT NOT REACHABLE IN THIS PHASE, on purpose. The only candidate
   * inference - "overall GPA far below the core-course threshold" - compares
   * two different quantities, and A7.33 forbids slipping it in unpreregistered.
   * It is in the vocabulary so the contract is complete and so that a future
   * phase adds a path to it rather than a new state.
   */
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  /**
   * Inputs present, none conflicting with a verified standard.
   *
   * NOT REACHABLE IN THIS PHASE, because no input is present for any rule.
   * NOTE THE SEMANTICS: this describes THRIV3'S SEARCH, not the athlete's
   * status. It does not mean officially eligible and must never be rendered
   * as "cleared".
   */
  NO_ISSUE_IDENTIFIED: 'NO_ISSUE_IDENTIFIED',
  /**
   * Thriv3 holds no verified rule for this association, or the rule it holds
   * has gone stale. Distinct from NOT_ESTABLISHED on purpose: this says WE DO
   * NOT KNOW THE RULE, that one says WE DO NOT HAVE THE ATHLETE'S INPUTS.
   * Collapsing them would hide which problem is ours to fix.
   */
  RULE_UNVERIFIED: 'RULE_UNVERIFIED',
});

/** How well sourced a rule record is. Mirrors the A7.32 register exactly. */
export const VERIFICATION_STATUS = Object.freeze({
  /** Read from a primary source that was retrieved and quoted. */
  VERIFIED: 'VERIFIED',
  /** Substance consistent across association-controlled sources; primary text not retrieved. */
  PARTIAL: 'PARTIAL',
  /** No primary source obtained. */
  UNVERIFIED: 'UNVERIFIED',
});

/** Why a rule is no longer treated as current. */
export const STALENESS = Object.freeze({
  CURRENT: 'CURRENT',
  /** Verified more than MAX_RULE_AGE_MONTHS ago. */
  STALE_AGE: 'STALE_AGE',
  /** Past its effective_to, or verified before the current academic year began. */
  STALE_CYCLE: 'STALE_CYCLE',
  /** Its cited source no longer resolves. */
  STALE_SOURCE: 'STALE_SOURCE',
});

/** Whether the cited source still resolves. Set by maintenance, never at runtime. */
export const SOURCE_STATUS = Object.freeze({
  REACHABLE: 'REACHABLE',
  UNREACHABLE: 'UNREACHABLE',
  UNCHECKED: 'UNCHECKED',
});

/**
 * Eligibility legislation moves on an annual cycle, so a rule verified more
 * than a year ago is not a verified rule. HEURISTIC, and deliberately shorter
 * than "until someone notices".
 */
export const MAX_RULE_AGE_MONTHS = 12;

/**
 * The NCAA academic year boundary, used by the CYCLE trigger. August 1 is the
 * date DI Proposal 2022-34 itself takes effect from, so it is the boundary the
 * legislation uses rather than one invented here.
 */
export const ACADEMIC_YEAR_START = Object.freeze({ month: 8, day: 1 });

/**
 * THE VERIFIED RULES. Source: docs/validation/A7.32-eligibility-rules.md,
 * verified 2026-09-26. Nothing is encoded that A7.32 did not retrieve.
 *
 * `evaluable: false` on every record is the load-bearing field. It states that
 * Thriv3 cannot assess the rule from data it holds - not that the rule is
 * doubtful. The rules below are well sourced; the INPUTS are missing.
 */
export const INITIAL_ELIGIBILITY_RULES = Object.freeze([
  Object.freeze({
    association: 'NCAA',
    division: 'NCAA D1',
    ruleType: 'CORE_COURSE_GPA',
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    evaluable: false,
    requires: Object.freeze(['coreCourseGpa', 'coreCourseInventory', 'coreCourseCompletionDates', 'proofOfGraduation']),
    facts: Object.freeze({
      coreCourses: 16,
      coreCourseGpaMinimum: 2.300,
      standardizedTestRequired: false,
      timingRule: '10/7 — ten core courses, seven in English, math or science, completed before the start of the seventh semester',
      distribution: Object.freeze({
        english: 4, math: 3, science: 2, additionalEnglishMathScience: 1, socialScience: 2, additionalCore: 4,
      }),
      graduation: 'Final transcript and proof of graduation required.',
      certifyingAuthority: 'NCAA Eligibility Center',
    }),
    effectiveFrom: '2023-08-01',
    effectiveTo: null,
    source: 'NCAA Division I initial-eligibility requirements; NCAA Legislative Services Database Proposal 2022-34 '
      + '("Academic Eligibility — Freshman Academic Requirements — Elimination of Test-Score Requirements"), Adopted Final.',
    sourceSection: 'Bylaw 14.3.1.1; minimum core GPA at Bylaw 14.3.1.1.3.',
    sourceUrl: 'https://www.ncaa.org/eligibility-center/initial-eligibility-requirements/division-i/',
    sourceStatus: SOURCE_STATUS.REACHABLE,
    sourceCheckedAt: '2026-09-26',
    verifiedAt: '2026-09-26',
    /**
     * Recorded because A7.32 could not retrieve it, and an unrecorded gap is
     * how a missing category becomes an assumed absence.
     */
    caveats: Object.freeze([
      'Whether a Division I "academic redshirt" category still exists after Proposal 2022-34, and at what '
      + 'threshold, was NOT ESTABLISHED. The practice / athletics-aid / competition distinction is unverified.',
    ]),
  }),
  Object.freeze({
    association: 'NCAA',
    division: 'NCAA D2',
    ruleType: 'CORE_COURSE_GPA',
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    evaluable: false,
    requires: Object.freeze(['coreCourseGpa', 'coreCourseInventory', 'proofOfGraduation']),
    facts: Object.freeze({
      coreCourses: 16,
      coreCourseGpaMinimum: 2.200,
      standardizedTestRequired: false,
      /**
       * NULL, NOT INHERITED. The Division I 10/7 rule is not stated on the
       * Division II requirements page. A search summary encountered during
       * A7.32 asserted that it applies; the primary page does not say so and
       * the summary was discarded. Copying DI here would be exactly the
       * "DII = DI" assumption A7.32 was told to test rather than presume.
       */
      timingRule: null,
      distribution: Object.freeze({
        english: 3, math: 2, science: 2, additionalEnglishMathScience: 3, socialScience: 2, additionalCore: 4,
      }),
      graduation: 'Final official transcript with proof of graduation required.',
      certifyingAuthority: 'NCAA Eligibility Center',
    }),
    effectiveFrom: '2023-08-01',
    effectiveTo: null,
    source: 'NCAA Division II initial-eligibility requirements. Test-score removal adopted for Division II on the '
      + 'same cycle as Division I Proposal 2022-34.',
    sourceSection: 'Division II initial-eligibility requirements page.',
    sourceUrl: 'https://www.ncaa.org/eligibility-center/initial-eligibility-requirements/division-ii/',
    sourceStatus: SOURCE_STATUS.REACHABLE,
    sourceCheckedAt: '2026-09-26',
    verifiedAt: '2026-09-26',
    caveats: Object.freeze([
      'Whether a Division II "partial qualifier" category still exists, and its thresholds, was NOT ESTABLISHED.',
      'The Division I 10/7 timing rule is NOT stated for Division II and must not be applied by analogy.',
    ]),
  }),
  Object.freeze({
    association: 'NCAA',
    division: 'NCAA D3',
    ruleType: 'NO_NATIONAL_STANDARD',
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    /**
     * THE ONE EVALUABLE RULE IN THIS FILE, and it is evaluable precisely
     * because it needs no athlete academic input: the answer is a property of
     * the division, not of the athlete.
     */
    evaluable: true,
    requires: Object.freeze([]),
    facts: Object.freeze({
      nationalAcademicStandard: false,
      quote: 'Division III schools set their own academic standards on campus, but the Eligibility Center '
        + 'certifies the athletics eligibility of Division III international student-athletes.',
      /**
       * The asymmetry that makes this rule two rules. A domestic DIII athlete
       * has no national standard to meet. An INTERNATIONAL DIII athlete is
       * certified by the Eligibility Center - so the dimension applies, and
       * Thriv3 holds none of what that certification consumes.
       */
      internationalCertifiedByEligibilityCenter: true,
      certifyingAuthority: 'The institution (domestic); NCAA Eligibility Center (international)',
    }),
    effectiveFrom: null,
    effectiveTo: null,
    source: 'NCAA initial-eligibility requirements, Division III statement.',
    sourceSection: 'NCAA initial-eligibility requirements overview.',
    sourceUrl: 'https://www.ncaa.org/eligibility-center/initial-eligibility-requirements/',
    sourceStatus: SOURCE_STATUS.REACHABLE,
    sourceCheckedAt: '2026-09-26',
    verifiedAt: '2026-09-26',
    caveats: Object.freeze([]),
  }),
]);

/**
 * Associations with no rule on file, NAMED rather than left to a default, so
 * the absence is a decision on the page rather than a silence.
 *
 * NAIA is listed here despite A7.32 assembling a probable standard from
 * association-controlled sources. PARTIAL IS NOT VERIFIED: the bylaw page
 * returned 404 and two NAIA sources gave conflicting readings of whether the
 * traditional test is one-of-three or two-of-three. Encoding the probable
 * version would be exactly the reconstruction this architecture forbids.
 */
export const UNVERIFIED_ASSOCIATIONS = Object.freeze([
  Object.freeze({
    association: 'NAIA',
    verificationStatus: VERIFICATION_STATUS.PARTIAL,
    why: 'The NAIA Bylaws Article V, Section C page returned HTTP 404 and two NAIA-controlled sources gave '
      + 'conflicting readings of the traditional criteria. A probable standard exists in the A7.32 register and '
      + 'is deliberately NOT encoded.',
    missing: Object.freeze(['bylaw text of Article V, Section C, Item 2 from the current Official Handbook']),
    certifyingAuthority: 'NAIA Eligibility Center (PlayNAIA)',
  }),
  Object.freeze({
    association: 'NJCAA',
    verificationStatus: VERIFICATION_STATUS.UNVERIFIED,
    why: 'NJCAA eligibility pages returned HTTP 403. Only 2019-20 and 2020-21 editions surfaced, which are too '
      + 'old to encode.',
    missing: Object.freeze([
      'whether a high-school diploma or equivalency is required for initial eligibility',
      'any incoming GPA or test standard',
      'international student requirements',
      'the current handbook edition and its effective date',
    ]),
    certifyingAuthority: null,
  }),
  Object.freeze({
    association: 'USCAA',
    verificationStatus: VERIFICATION_STATUS.UNVERIFIED,
    /**
     * The naming hazard, recorded so nobody repeats it. `uscaa.org` is the
     * United States CORPORATE Athletics Association and its published rules
     * concern employee payroll status. The collegiate body is the United
     * States COLLEGIATE Athletic Association at theuscaa.com.
     */
    why: 'The collegiate USCAA eligibility page (theuscaa.com) returned HTTP 403. Note that uscaa.org is a '
      + 'DIFFERENT ORGANISATION - the United States Corporate Athletics Association - whose rules must never be '
      + 'encoded here.',
    missing: Object.freeze(['initial academic eligibility requirements from theuscaa.com']),
    certifyingAuthority: null,
  }),
]);

const monthsBetween = (fromIso, toIso) => {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return ((b.getUTCFullYear() - a.getUTCFullYear()) * 12) + (b.getUTCMonth() - a.getUTCMonth())
    + ((b.getUTCDate() >= a.getUTCDate()) ? 0 : -1);
};

/** The most recent academic-year boundary on or before `asOf`. */
export function academicYearStart(asOf) {
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const boundary = Date.UTC(y, ACADEMIC_YEAR_START.month - 1, ACADEMIC_YEAR_START.day);
  return new Date(d.getTime() >= boundary ? boundary : Date.UTC(y - 1, ACADEMIC_YEAR_START.month - 1, ACADEMIC_YEAR_START.day))
    .toISOString().slice(0, 10);
}

/**
 * The three A7.32 staleness triggers, in the order that makes the reason most
 * useful to a maintainer: a vanished source is a different problem from an old
 * verification, and should be reported as itself.
 *
 * NO NETWORK ACCESS. `sourceStatus` is stored metadata set by a separate
 * maintenance process; evaluation consumes it. An eligibility assessment must
 * never depend on an HTTP request.
 */
export function ruleStaleness(rule, { asOf, maxAgeMonths = MAX_RULE_AGE_MONTHS } = {}) {
  if (!rule) return STALENESS.STALE_SOURCE;
  if (rule.sourceStatus === SOURCE_STATUS.UNREACHABLE) return STALENESS.STALE_SOURCE;
  if (rule.effectiveTo && asOf && rule.effectiveTo < String(asOf).slice(0, 10)) return STALENESS.STALE_CYCLE;
  if (asOf && rule.verifiedAt) {
    const age = monthsBetween(rule.verifiedAt, asOf);
    if (age !== null && age >= maxAgeMonths) return STALENESS.STALE_AGE;
    const boundary = academicYearStart(asOf);
    if (boundary && rule.verifiedAt < boundary) return STALENESS.STALE_CYCLE;
  }
  return STALENESS.CURRENT;
}

/** The rule on file for a division, or null. Never a guess, never a default. */
export function initialEligibilityRuleFor({ division }) {
  return INITIAL_ELIGIBILITY_RULES.find((r) => r.division === division) ?? null;
}

/** The recorded reason an association has no rule, or null. */
export function unverifiedAssociationFor({ association, division }) {
  const key = association ?? String(division ?? '').split(' ')[0];
  return UNVERIFIED_ASSOCIATIONS.find((a) => a.association === key) ?? null;
}

/**
 * Assess initial academic eligibility.
 *
 * NOTE WHAT IS NOT A PARAMETER: no GPA, no SAT, no ACT, no transcript. See the
 * file header. The only athlete property read is whether they are
 * international, because that is what decides whether the NCAA Eligibility
 * Center certifies a Division III athlete.
 *
 * @param {object} args
 * @param {string} args.division        e.g. 'NCAA D1'
 * @param {boolean} [args.isInternational]
 * @param {string} args.asOf            ISO date the assessment is made on
 * @returns {{result: string, reason: string, rule: object|null, staleness: string|null,
 *            certifyingAuthority: string|null, thriv3Certifies: false}}
 */
export function assessInitialEligibility({ division, isInternational = false, asOf, rules = INITIAL_ELIGIBILITY_RULES } = {}) {
  const base = { rule: null, staleness: null, certifyingAuthority: null, thriv3Certifies: false };
  const rule = rules.find((r) => r.division === division) ?? null;

  if (!rule) {
    const gap = unverifiedAssociationFor({ division });
    return {
      ...base,
      result: INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED,
      certifyingAuthority: gap?.certifyingAuthority ?? null,
      reason: gap
        ? `No verified initial-eligibility rule is on file for ${gap.association}. ${gap.why}`
        : 'Unrecognised division; no initial-eligibility rule on file.',
    };
  }

  const staleness = ruleStaleness(rule, { asOf });
  if (staleness !== STALENESS.CURRENT) {
    /**
     * A STALE RULE IS NOT APPLIED. It degrades, rather than continuing to be
     * evaluated as current, because silent application of an expired rule is
     * how the removed NCAA sliding scale would still be in production.
     */
    return {
      ...base,
      rule,
      staleness,
      result: INITIAL_ELIGIBILITY_RESULT.RULE_UNVERIFIED,
      certifyingAuthority: rule.facts.certifyingAuthority ?? null,
      reason: `The rule on file for ${division} is ${staleness} and must be re-verified before it is applied.`,
    };
  }

  if (rule.ruleType === 'NO_NATIONAL_STANDARD') {
    if (isInternational && rule.facts.internationalCertifiedByEligibilityCenter) {
      return {
        ...base,
        rule,
        staleness,
        result: INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED,
        certifyingAuthority: 'NCAA Eligibility Center',
        reason: 'Division III sets no national academic standard, but the NCAA Eligibility Center certifies '
          + 'Division III international student-athletes. Thriv3 holds none of the records that certification '
          + 'consumes.',
      };
    }
    return {
      ...base,
      rule,
      staleness,
      result: INITIAL_ELIGIBILITY_RESULT.NOT_APPLICABLE,
      certifyingAuthority: 'The institution',
      reason: 'Division III schools set their own academic standards; there is no NCAA-wide initial academic '
        + 'standard to assess. This is not a statement that the athlete is admitted or academically cleared.',
    };
  }

  return {
    ...base,
    rule,
    staleness,
    result: INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED,
    certifyingAuthority: rule.facts.certifyingAuthority ?? null,
    reason: `${division} initial eligibility is assessed on ${rule.requires.join(', ')}. Thriv3 holds none of these. `
      + 'A transcript GPA is not a core-course GPA, and standardized test scores are not part of this standard.',
  };
}

/**
 * The athlete-shaped caller, kept deliberately thin so that WHICH ATHLETE
 * FIELDS ARE READ is visible in one place and testable. Origin only. A future
 * reader adding `athlete.gpa` here has to do it on purpose, in the open.
 */
export function initialEligibilityForAthlete({ athlete, division, asOf }) {
  return assessInitialEligibility({
    division,
    isInternational: athlete?.origin === 'International',
    asOf,
  });
}
