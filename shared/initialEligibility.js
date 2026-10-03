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
 * A7.35 — AND WHY THE NAIA, WHICH *DOES* USE AN OVERALL GPA AND *DOES* USE
 * TEST SCORES, STILL READS NEITHER.
 *
 * The NAIA is the harder case and the reason this paragraph exists. Unlike the
 * NCAA it has NO core-course requirement: Article V, Section C, Item 2 turns on
 * the OVERALL high-school GPA, and a standardized test is one of its three
 * alternatives. The obvious move is therefore available in a way it never was
 * for the NCAA - `players.gpa` is an overall GPA, `players.sat_score` is an SAT
 * - and it is still WRONG, for reasons that are about the QUANTITY and not
 * about the rule:
 *
 *   - The bylaw's GPA is the FINAL overall GPA on a 4.000 scale as it stands on
 *     the final transcript AFTER graduation, with published tie-breaks for
 *     multiple GPAs, multiple high schools and preparatory-school attendance.
 *     `players.gpa` is a number an athlete types into a box, commonly years
 *     before that transcript exists. Same name, different quantity.
 *   - The test criterion is not a score, it is a score WITH PROVENANCE: a
 *     single sitting, on a national, international or official state testing
 *     date, no "super scores", taken before the term of first participation.
 *     Thriv3 holds a bare integer and no sitting at all. It also converts ACT
 *     to an SAT equivalent for ADMISSIONS, which the NAIA does not do here -
 *     reading that converted number would invent a score the athlete has not.
 *   - CLASS RANK, one of the three, HAS NO FIELD ANYWHERE IN THRIV3. Two of the
 *     three can therefore never be counted, so the two-of-three pathway is
 *     unreachable by construction rather than by choice.
 *   - For an INTERNATIONAL athlete the NAIA states that it determines the GPA
 *     itself, by converting the athlete's academic records to a U.S. 4.000
 *     scale. The required number is one the NAIA produces; nothing Thriv3 holds
 *     can stand in for it, and constructing one here would be precisely the
 *     country conversion table A7.32 and A7.35 both forbid.
 *
 * THE RULE IS VERIFIED AND THE EVIDENCE IS ABSENT, and those are different
 * facts. RULE_UNVERIFIED would now be false; NOT_ESTABLISHED is true.
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
    /**
     * WHY THE RULE CANNOT BE EVALUATED, carried per rule rather than written
     * once in `assessInitialEligibility`. A7.35 added the NAIA, for which the
     * old shared sentence would have been FALSE in both halves: the NAIA has
     * no core-course GPA to contrast with, and standardized tests ARE part of
     * its standard. A reason that is true of one association is not a reason.
     */
    whyNotEvaluable: 'Thriv3 holds none of these. A transcript GPA is not a core-course GPA, and standardized test scores are not part of this standard.',
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
    whyNotEvaluable: 'Thriv3 holds none of these. A transcript GPA is not a core-course GPA, and standardized test scores are not part of this standard.',
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
  /**
   * ===========================================================================
   * NAIA — A7.35. VERIFIED FROM THE BYLAW ITSELF, not from a summary of it.
   *
   * A7.32 left this PARTIAL because the bylaw page 404'd and two readings of
   * the "traditional" criteria disagreed - one said two-of-three, one said
   * one-of-three. A7.35 retrieved the operative handbook and the disagreement
   * turned out NOT TO EXIST IN NAIA MATERIAL. Article V, Section C, Item 2 says
   * "two of the three"; the NAIA interpretations page says "the 'traditional'
   * 2/3 options"; the NAIA's own international guide says "meet two of the
   * following three criteria". All three agree. BOTH conflicting readings were
   * produced by summarisers standing between us and the text, which is the
   * whole argument for "a rule with no source is not a rule".
   *
   * TWO PLACES WHERE A7.32's PARTIAL RECORD WAS WRONG, and would have shipped:
   *   1. It described the SAT criterion as "Critical Reading + Math", the
   *      pre-2016 section names. The bylaw says EVIDENCE-BASED READING AND
   *      WRITING and Math for tests taken from May 2019. The NAIA
   *      interpretations page still carries the old wording; the bylaw governs.
   *   2. It recorded the 2.300 pathway as dating from May 2022. The handbook's
   *      own history line for this bylaw ends at 2021 and no effective date for
   *      the pathway is stated in the operative text, so none is encoded here.
   *
   * WHAT MAKES THE NAIA STRUCTURALLY DIFFERENT FROM THE NCAA: there is NO core
   * course requirement. The GPA is the overall high-school GPA, and a
   * standardized test is still live here - the NCAA removed tests entirely in
   * 2023, the NAIA did not. Any code that treats "initial eligibility" as one
   * shape across associations is already wrong.
   * ===========================================================================
   */
  Object.freeze({
    association: 'NAIA',
    division: 'NAIA',
    ruleType: 'OVERALL_HS_GPA_OR_TWO_OF_THREE',
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    /**
     * VERIFIED RULE, ABSENT EVIDENCE. `evaluable: false` here is a statement
     * about Thriv3's inputs and NOT about the quality of the source - this is
     * the best-sourced record in the file.
     */
    evaluable: false,
    requires: Object.freeze([
      'finalOverallHighSchoolGpaOn4Scale',
      'highSchoolClassRank',
      'standardizedTestScoreWithSittingProvenance',
      'proofOfHighSchoolGraduation',
      'naiaEligibilityCenterDetermination',
    ]),
    whyNotEvaluable: 'The GPA is the FINAL overall high-school GPA on a 4.000 scale as it stands on the final '
      + 'transcript after graduation; Thriv3 holds a self-reported number entered at any point in an athlete\'s '
      + 'school career. The test criterion requires a single approved sitting with no super-scoring, and Thriv3 '
      + 'holds a bare integer with no sitting. CLASS RANK HAS NO FIELD IN THRIV3 AT ALL, so two of the three can '
      + 'never be counted. Only the NAIA Eligibility Center determines this.',
    facts: Object.freeze({
      /** The NAIA has no core-course concept. Recorded explicitly so nobody infers one from the NCAA records. */
      coreCourseRequirement: false,
      /**
       * Pathway A, and it stands alone: this GPA alone makes an entering
       * freshman eligible, with no test and no class rank.
       */
      standaloneGpaPathway: Object.freeze({ minimumGpa: 2.300, scale: 4.000, basis: 'overall high school GPA' }),
      /** Pathway B. TWO of these three, verified against the bylaw text. */
      twoOfThree: Object.freeze({
        required: 2,
        of: 3,
        options: Object.freeze([
          Object.freeze({
            id: 'standardizedTest',
            minimumAct: 18,
            minimumSat: 970,
            satSections: 'Evidence-Based Reading and Writing, and Math',
            effectiveFrom: '2019-05-01',
            superScoresAccepted: false,
            singleSittingRequired: true,
            sittingTypes: 'national, international or official state assessment testing date',
            timing: 'must be taken before the beginning of the term in which the student initially participates',
          }),
          Object.freeze({ id: 'overallHighSchoolGpa', minimumGpa: 2.000, scale: 4.000 }),
          Object.freeze({
            id: 'classRank',
            requirement: 'rank in the upper half of the graduating class, as it appears on the final high school '
              + 'transcript after the date of graduation',
          }),
        ]),
      }),
      /**
       * NOT the same field as NCAA `standardizedTestRequired`, and the pair is
       * spelled out because a single boolean cannot say this. NO athlete is
       * OBLIGED to sit a test - 2.300 alone, or GPA plus class rank, both
       * suffice - and a test can still be one of the two that decides it.
       */
      standardizedTestRequired: false,
      standardizedTestRole: 'ONE OF THE THREE ALTERNATIVES IN THE TWO-OF-THREE PATHWAY',
      graduation: 'An entering freshman must be a graduate of an accredited high school, or be accepted as a '
        + 'regular student in good standing as defined by the enrolling institution (Item 1).',
      /**
       * International athletes matter disproportionately to Thriv3, so this is
       * recorded as its own set of facts rather than as a footnote. The bylaw
       * applies the SAME criteria - and then says the NAIA itself determines
       * the two quantities those criteria consume.
       */
      internationalSameCriteria: true,
      internationalGpaDeterminedBy: 'NAIA Eligibility Center, by converting the athlete\'s academic records to a '
        + 'U.S. 4.000 scale',
      internationalNote: 'An international entering freshman meets the SAME criteria (Items 1 and 2), but the NAIA '
        + 'determines high-school graduation and GPA from its own published international academic guidelines and '
        + 'requires an InCred evaluation of the athlete\'s records. Thriv3 must not substitute a home-country '
        + 'grade for the figure the NAIA produces.',
      certifyingAuthority: 'NAIA Eligibility Center (PlayNAIA)',
      /** Section C preamble: a first-time NAIA participant needs a determination BEFORE competing. */
      determinationRequiredBeforeCompetition: true,
    }),
    /**
     * NOT STATED IN THE OPERATIVE TEXT, so not invented. The handbook records
     * "Freshman Eligibility Bylaw Most Recent History: Revised in 2011, 2012,
     * 2013, 2016, 2017, 2018, 2019, 2021" and gives the edition rather than a
     * commencement date for Item 2. The one date the bylaw does state - the
     * May 2019 test-score change - is recorded on the option it governs.
     */
    effectiveFrom: null,
    effectiveTo: null,
    edition: '2026-2027 NAIA Official & Policy Handbook, 41st edition, August 2026',
    editionEffectiveFor: '2026-2027',
    lastRevised: 2021,
    /**
     * Checked, and it is the reason this record can be dated: the April 2026
     * annual business meeting amended Article I Section H, Article V Section B
     * Item 20 and Article I Section N. NONE of them touch Article V Section C.
     */
    amendedInCurrentEdition: false,
    source: 'NAIA Official & Policy Handbook 2026-2027 (41st edition, August 2026), Bylaws Article V, Section C, '
      + 'Item 2, pages 70-73, retrieved as PDF and read directly. Corroborated by the NAIA Eligibility Center '
      + '"Guide for the International Student-Athlete" and by interpretations.naia.org.',
    sourceSection: 'Bylaws Article V, Section C, Item 2 (Items 2a test score p. 71, 2b GPA pp. 71-72, '
      + '2c class rank p. 72, NOTE 3 International Students p. 73).',
    sourceUrl: 'https://www.naia.org/wp-content/uploads/2026/07/2026_Official_Handbook.pdf',
    sourcePage: 70,
    sourceDigestSha256: 'b4e4d7822a26ef501d1567a4acab61d8bd2556328e5d7d95a7022d496d73dee2',
    sourceStatus: SOURCE_STATUS.REACHABLE,
    sourceCheckedAt: '2026-09-27',
    verifiedAt: '2026-09-27',
    caveats: Object.freeze([
      'The NAIA international academic guidelines are a SEPARATE country-by-country publication that the bylaw '
      + 'defers to. Its contents were NOT retrieved, and no country conversion is encoded here.',
      'The NAIA international guide states that home-schooled, "Private User" (England and British-patterned '
      + 'systems), distance-education and international GED students may not use the class-rank criterion. '
      + 'WHICH COUNTRIES THAT COVERS IS NOT ESTABLISHED and must not be inferred from a country name.',
      'Item 2b carries an early-determination EXCEPTION for U.S. high-school students at six semesters '
      + '(3.000 GPA plus test) and seven semesters (2.500 GPA plus test). Recorded, not encoded, because Thriv3 '
      + 'holds neither a semester count nor a qualifying test.',
    ]),
  }),
]);

/**
 * Associations with no rule on file, NAMED rather than left to a default, so
 * the absence is a decision on the page rather than a silence.
 *
 * A7.35 REMOVED NAIA FROM THIS LIST. It sat here through A7.33 because A7.32
 * could only assemble a probable standard, and PARTIAL is not VERIFIED. A7.35
 * retrieved the operative bylaw and the rule is now in the table above. The
 * list shrinking is the only way this architecture is supposed to shrink: by
 * someone reading the primary source, never by someone deciding the gap had
 * been open long enough.
 *
 * NJCAA and USCAA remain, and A7.35 did not research them by instruction.
 */
export const UNVERIFIED_ASSOCIATIONS = Object.freeze([
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

  /**
   * A7.35. The reason comes from the RULE, not from this function. It used to
   * end with a sentence about core-course GPAs and absent test scores, which
   * was true of the NCAA and false of the NAIA in both halves. A shared
   * explanation across associations that do not share a standard is a bug
   * waiting for its second association, and this was it.
   *
   * `internationalNote` is appended the same way - by data, so that adding an
   * association never means adding a branch named after one.
   */
  const note = (isInternational && rule.facts.internationalNote) ? ` ${rule.facts.internationalNote}` : '';
  return {
    ...base,
    rule,
    staleness,
    result: INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED,
    certifyingAuthority: rule.facts.certifyingAuthority ?? null,
    reason: `${division} initial eligibility is assessed on ${rule.requires.join(', ')}. `
      + `${rule.whyNotEvaluable}${note}`,
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
