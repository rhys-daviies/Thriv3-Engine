/**
 * The V2 result contract.
 *
 * WHY THIS FILE EXISTS. V1's defect is not that it scores badly; it is that it
 * cannot say "I do not know". Every criterion returns a number, so a programme
 * we hold nothing about returns 0.5 and outranks a programme we measured at
 * zero. The fix is not a better default. It is a SHAPE that makes "no value"
 * unrepresentable as a value.
 *
 * So there are exactly two shapes, discriminated by `ok`:
 *
 *   SCOREABLE    { ok: true,  value, grade, coverage, basis }
 *   UNSCOREABLE  { ok: false, reason, missing, available, coverage }
 *
 * An unscoreable result has NO numeric score, and the constructors below
 * refuse to build one that does. Nothing reads `.value` without branching on
 * `ok`, and `isScoreable` exists so that branch is one token.
 *
 * WHAT IS DELIBERATELY ABSENT: a neutral fallback, a null that means a number,
 * NaN, and the ASSUMED grade. ASSUMED was V1's way of scoring a guess and
 * presenting it beside a measurement; in V2 a guess is not a score.
 */

/** How good the evidence behind a number is. There is no third grade. */
export const GRADE = Object.freeze({
  /** Every input this component needs was present and measured. */
  MEASURED: 'MEASURED',
  /** Scored from a weaker proxy, or from data known to be incomplete. */
  PARTIAL: 'PARTIAL',
});

const GRADES = new Set(Object.values(GRADE));

/**
 * Why a component or layer produced no number.
 *
 * NOT_APPLICABLE is deliberately not in the same family as the rest. The others
 * all mean "we could not measure this"; NOT_APPLICABLE means "there is nothing
 * here to measure". Coverage treats them differently on purpose - see
 * coverage.js - because conflating them penalises a domestic athlete for not
 * being international.
 */
export const REASON = Object.freeze({
  NO_ROSTER_ON_FILE: 'NO_ROSTER_ON_FILE',
  NO_ELIGIBILITY_RULE: 'NO_ELIGIBILITY_RULE',
  NO_CLASS_LABELS: 'NO_CLASS_LABELS',
  NO_PROGRAMME_LEVEL: 'NO_PROGRAMME_LEVEL',
  NO_ATHLETE_LEVEL: 'NO_ATHLETE_LEVEL',
  NO_COST_BASIS: 'NO_COST_BASIS',
  NO_FAMILY_CONTRIBUTION: 'NO_FAMILY_CONTRIBUTION',
  NO_AID_RULE: 'NO_AID_RULE',
  NO_MINUTES_HISTORY: 'NO_MINUTES_HISTORY',
  NO_ACADEMIC_PROFILE: 'NO_ACADEMIC_PROFILE',
  NO_LOCATION: 'NO_LOCATION',
  NO_STATED_PREFERENCE: 'NO_STATED_PREFERENCE',
  /**
   * A7.12.1. The ATHLETE said what they want to study and THIS PROGRAMME has
   * no major list to check it against. Distinct from NO_STATED_PREFERENCE,
   * which names the athlete's side: reporting a programme-side gap as the
   * athlete having stated nothing sends whoever reads it to ask the athlete a
   * question they already answered.
   */
  NO_PROGRAMME_MAJOR_EVIDENCE: 'NO_PROGRAMME_MAJOR_EVIDENCE',
  /**
   * A8.2. The institution HAS a notable-majors list and the athlete's family
   * is not on it - which is not evidence the major is unavailable.
   *
   * `colleges.notable_majors` is built from College Scorecard PCIP COMPLETION
   * SHARES, so it names an institution's largest fields of study, not its
   * catalogue: a mean of 7.55 of the 14 families, and 321 of 349 Division I
   * women's programmes omit Mathematics - Penn State, Ohio State, Wisconsin
   * and Texas A&M among them, all of which grant mathematics degrees.
   *
   * Separate from NO_PROGRAMME_MAJOR_EVIDENCE because the data situations
   * differ and an explanation should be able to say which: there, no list is
   * recorded at all; here, a list exists and does not settle the question.
   * The epistemic state is the same, which is why both refuse.
   */
  MAJOR_NOT_IN_PARTIAL_EVIDENCE: 'MAJOR_NOT_IN_PARTIAL_EVIDENCE',
  NO_WIN_RATES: 'NO_WIN_RATES',
  /**
   * A7.44. The roster IS on file and its POSITIONS could not be read - either
   * at all, or in enough of the group for a positional claim to stand.
   *
   * A NEW WORD BECAUSE THE EXISTING ONES WERE UNTRUE, not because the
   * vocabulary wanted enriching. NO_ROSTER_ON_FILE said Thriv3 holds no roster
   * for a programme whose roster it holds and has read; NO_CLASS_LABELS blamed
   * the class years of a roster whose class years may be perfect. Both sent
   * whoever read them to look for data that is already there.
   */
  NO_READABLE_POSITIONS: 'NO_READABLE_POSITIONS',
  /**
   * A7.48. The roster IS on file, it WAS read, and it records nobody at this
   * position.
   *
   * SPLIT OUT OF NO_ROSTER_ON_FILE BECAUSE THAT WORD WAS FALSE HERE. A
   * programme with fourteen listed players and no goalkeeper was being
   * explained as one Thriv3 holds no roster for, which sends a reader to
   * acquire data that is already present and describes the programme wrongly.
   *
   * IT IS NOT NEGATIVE EVIDENCE AND MUST NOT BE READ AS ANY. A7.44 ruled that
   * this state is a genuine MEASUREMENT - the roster reads completely and the
   * position is empty - and deliberately left it refusing rather than scoring
   * it, because scoring it is a separate question that moves rankings. What
   * A7.48 adds is only that it can now be told apart from an absent roster and
   * from an unreadable one.
   */
  NO_PLAYERS_AT_POSITION: 'NO_PLAYERS_AT_POSITION',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  BELOW_COVERAGE_FLOOR: 'BELOW_COVERAGE_FLOOR',
});

const REASONS = new Set(Object.values(REASON));

/**
 * What a programme is, in the list.
 *
 * INELIGIBLE and SUPPRESSED are separate states, not one. They have different
 * provenance - a rule against a person - different reversibility, and different
 * treatment in the interface: a suppressed programme is one the operator
 * removed and can restore, and folding it into a rule outcome loses that.
 */
export const RANKING_STATE = Object.freeze({
  /** Every gating layer scoreable; carries a pursuit priority. */
  RANKED: 'RANKED',
  /** Eligible and partly evaluated. Shown, ordered by what is known, NEVER given a priority. */
  LIMITED_DATA: 'LIMITED_DATA',
  /** Failed a rule - division, conference, academic floor. */
  INELIGIBLE: 'INELIGIBLE',
  /** An operator decision recorded in athlete_programmes. */
  SUPPRESSED: 'SUPPRESSED',
});

const RANKING_STATES = new Set(Object.values(RANKING_STATE));

class ContractError extends Error {
  constructor(message) {
    super(`V2 result contract: ${message}`);
    this.name = 'ContractError';
  }
}

function assertUnit(name, n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new ContractError(`${name} must be a finite number, got ${JSON.stringify(n)}`);
  }
  if (n < 0 || n > 1) {
    throw new ContractError(`${name} must be within [0,1], got ${n}`);
  }
}

/**
 * A component or layer that produced a number.
 *
 * `basis` is the evidence: the inputs, counts and rule names the number came
 * from. It is data, never prose - explanation is rendered from it elsewhere,
 * so that the engine cannot quietly become the copywriter.
 */
export function scoreable({ value, grade, coverage = 1, basis = {} }) {
  assertUnit('value', value);
  assertUnit('coverage', coverage);
  if (!GRADES.has(grade)) {
    // Named explicitly because ASSUMED is the one that must never come back.
    throw new ContractError(
      `grade must be MEASURED or PARTIAL, got ${JSON.stringify(grade)}`
      + (grade === 'ASSUMED' ? ' - ASSUMED is abolished in V2; an assumption is not a score' : ''),
    );
  }
  if (basis === null || typeof basis !== 'object' || Array.isArray(basis)) {
    throw new ContractError('basis must be an object');
  }
  return Object.freeze({ ok: true, value, grade, coverage, basis: Object.freeze({ ...basis }) });
}

/**
 * A component or layer that produced no number.
 *
 * `coverage` defaults to 0 because an unscoreable result covers nothing. It is
 * accepted as an argument for the one case that is not zero: a LAYER that was
 * evaluable in part but fell below its floor still reports how far it got.
 */
export function unscoreable({ reason, missing = [], available = [], coverage = 0, detail = null }) {
  if (!REASONS.has(reason)) {
    throw new ContractError(`reason must be one of REASON, got ${JSON.stringify(reason)}`);
  }
  assertUnit('coverage', coverage);
  if (!Array.isArray(missing) || !Array.isArray(available)) {
    throw new ContractError('missing and available must be arrays');
  }
  const r = { ok: false, reason, missing: Object.freeze([...missing]), available: Object.freeze([...available]), coverage };
  if (detail !== null) r.detail = Object.freeze(typeof detail === 'object' ? { ...detail } : detail);
  return Object.freeze(r);
}

/**
 * There is nothing here to measure.
 *
 * Distinct from every "we could not measure it" reason, and the distinction is
 * load-bearing: coverage removes this from the denominator instead of counting
 * it as a gap.
 */
export function notApplicable(detail = null) {
  return unscoreable({ reason: REASON.NOT_APPLICABLE, coverage: 0, detail });
}

export function isScoreable(r) {
  return r !== null && typeof r === 'object' && r.ok === true;
}

export function isNotApplicable(r) {
  return r !== null && typeof r === 'object' && r.ok === false && r.reason === REASON.NOT_APPLICABLE;
}

export function isRankingState(s) {
  return RANKING_STATES.has(s);
}

/**
 * Runtime guard for anything crossing a module boundary.
 *
 * JavaScript will not enforce the shape for us, and the failure this contract
 * exists to prevent - a number appearing where "unknown" was meant - is exactly
 * the kind that stays silent. Cheap enough to run on every result.
 */
export function assertResult(r, where = 'result') {
  if (r === null || typeof r !== 'object') {
    throw new ContractError(`${where} must be an object, got ${JSON.stringify(r)}`);
  }
  if (r.ok === true) {
    assertUnit(`${where}.value`, r.value);
    assertUnit(`${where}.coverage`, r.coverage);
    if (!GRADES.has(r.grade)) throw new ContractError(`${where}.grade is ${JSON.stringify(r.grade)}`);
    return r;
  }
  if (r.ok === false) {
    if (!REASONS.has(r.reason)) throw new ContractError(`${where}.reason is ${JSON.stringify(r.reason)}`);
    assertUnit(`${where}.coverage`, r.coverage);
    // The rule the whole contract rests on: an unscoreable result carries no
    // number. A 0 smuggled in here is a claim, and it is the wrong claim.
    if ('value' in r || 'score' in r) {
      throw new ContractError(`${where} is unscoreable but carries a numeric score - that is a claim, not an absence`);
    }
    return r;
  }
  throw new ContractError(`${where}.ok must be true or false, got ${JSON.stringify(r.ok)}`);
}

export { ContractError };
