/**
 * The V2 athlete-preference intake contract.
 *
 * -- WHY THESE ARE NEW FIELDS AND NOT AN EXTENSION OF criterion_ranking ----
 *
 * The legacy ranking cannot carry these two concepts, because two of its six
 * tokens are each ALREADY ambiguous across exactly the boundary this task
 * exists to draw. In the athlete's own words, as the form shows them:
 *
 *   athletic  "Playing level" - "Whether the squad is the right standard,
 *             AND WHETHER THEY WOULD PLAY."
 *   roster    "Spot opening" - "Whether a place opens at their position the
 *             year they would arrive."
 *
 * `athletic` spans competitive level and playing time in one token: an athlete
 * ranking it first has told us they care about one of the two things we are
 * trying to tell apart, and not which. `roster` spans a RECRUITING opening,
 * which Coach Recruitability owns, and a playing pathway, which Opportunity
 * owns. Neither migrates cleanly, so neither is migrated: the legacy ranking
 * keeps its existing, coarser effect on component weights, and an explicit
 * field wins wherever one is present.
 *
 * -- TWO FIELDS, NOT ONE SLIDER -------------------------------------------
 *
 * A single level-versus-playing-time slider cannot express two real athletes.
 * One wants BOTH - the strongest level they can reach AND a route into the
 * team - which is a demanding but coherent position that narrows their list
 * rather than sliding along it. The other cares much about NEITHER, and is
 * choosing on academics, cost or home. A slider forces both into the middle,
 * and a midpoint is a preference nobody stated.
 *
 * -- MISSING MEANS UNDECLARED ---------------------------------------------
 *
 * Never a midpoint, never a default. An athlete nobody asked scores exactly as
 * they did before these fields existed.
 */

/** The value every unasked athlete has, and the only one that means "we do not know". */
export const UNDECLARED = null;

/**
 * The scale both preferences use.
 *
 * 1-5, because an athlete can say "not at all", "not much", "somewhat", "a
 * lot" and "more than anything" and be understood, and because three points
 * cannot separate "a lot" from "the whole reason I am doing this".
 */
export const PRIORITY_SCALE = Object.freeze({ min: 1, max: 5, neutral: 3 });

/**
 * One ladder, shared by all three questions.
 *
 * A7.12.1. Each field used to carry its own wording for 1 and 5, which read
 * well one question at a time and badly as a column of three: an athlete
 * comparing "the right programme matters more to me than the level" against
 * "Not important" cannot tell whether the two scales mean the same thing.
 * They do, so they now say the same words, and the difference between the
 * questions lives in the questions.
 */
export const ANCHORS = Object.freeze({
  1: 'Not important',
  2: 'Slightly important',
  3: 'Moderately important',
  4: 'Very important',
  5: 'Extremely important',
});

/**
 * The fields, as they should be stored.
 *
 * Both nullable INTEGER, both defaulting to NULL, and NULL is UNDECLARED.
 * Existing athlete records take the default and are not backfilled: nobody
 * asked them, so nothing may be recorded as their answer.
 */
export const PREFERENCE_FIELDS = Object.freeze({
  competitive_level_priority: {
    type: 'INTEGER',
    nullable: true,
    default: null,
    allowed: [1, 2, 3, 4, 5],
    missingMeans: 'UNDECLARED',
    /**
     * REVISED. The first wording asked about "the strongest level you can
     * realistically REACH", which invites the athlete to assess their own
     * ability - and ability is not theirs to state here. It is the operator's
     * 1-10 rating, and what is realistic is Coach Recruitability's answer, not
     * a thing to ask a seventeen-year-old to estimate about themselves.
     *
     * The athlete states the PREFERENCE. Thriv3 decides what is reachable.
     *
     * A7.12.1 set the shipped wording. "Realistic" here is a promise about
     * what THRIV3 will do with the answer - it will not offer a level the
     * athlete cannot reach - and the helper says so explicitly, because on
     * its own the word could still be read as an invitation to self-assess.
     */
    question: 'How important is competing at the highest realistic college level to you?',
    anchors: ANCHORS,
    helper: 'This helps Thriv3 balance programme level against other realistic recruiting '
      + 'opportunities. It does not mean a particular NCAA division will automatically rank higher.',
    /** What it must never be read as. */
    notAnAbilityRating: 'This is what the athlete WANTS. Their ability stays the operator-assessed 1-10 rating.',
  },
  /**
   * A7.7.5. Added because the first real human review found academics were
   * not underweighted but ABSENT, and because the athlete's own grades are
   * not a statement of what they want: a 4.0 may be someone aiming at a
   * strong institution, or someone intending to use those grades as leverage
   * somewhere less selective. Only they can say which.
   */
  academic_strength_priority: {
    type: 'INTEGER',
    nullable: true,
    default: null,
    allowed: [1, 2, 3, 4, 5],
    missingMeans: 'UNDECLARED',
    question: 'How important is attending a college with a strong academic profile?',
    anchors: ANCHORS,
    helper: 'This reflects how much you value the overall academic strength of the college. '
      + 'Your grades and test scores are considered separately and do not determine this preference.',
    notAnAbilityRating: 'This is what the athlete WANTS. It is never inferred from GPA, SAT, ACT or intended major.',
  },
  playing_opportunity_priority: {
    type: 'INTEGER',
    nullable: true,
    default: null,
    allowed: [1, 2, 3, 4, 5],
    missingMeans: 'UNDECLARED',
    /**
     * Deliberately about WANTING to play early, not about predicting that they
     * will. The prediction is the layer's job, and asking an athlete to make
     * it would be the same mistake as asking them to rate their own level.
     */
    question: 'How important is having a clearer path to playing time?',
    anchors: ANCHORS,
    helper: 'This helps Thriv3 understand how much you value a clearer route to competing for '
      + 'minutes. It does not predict or guarantee playing time.',
    notAnAbilityRating: 'This is what the athlete WANTS, not a claim about how quickly they would play.',
  },
});

/**
 * Read a stored preference.
 *
 * Returns null for absence and for anything outside the scale. A value we
 * cannot place is UNDECLARED rather than clamped: clamping a 7 to a 5 would
 * record an answer nobody gave.
 */
export function readPriority(value) {
  if (value === null || value === undefined || value === '') return UNDECLARED;
  const n = Number(value);
  if (!Number.isInteger(n)) return UNDECLARED;
  if (n < PRIORITY_SCALE.min || n > PRIORITY_SCALE.max) return UNDECLARED;
  return n;
}

/** True when the athlete actually answered. */
export const isDeclared = (value) => readPriority(value) !== UNDECLARED;

/**
 * How strongly a declared priority is felt, on 0 to 1.
 *
 * 1 means "not at all" maps to 0 and "more than anything" maps to 1, so a
 * component's SHAPE can be scaled by how much the athlete cares without the
 * scale itself carrying an opinion.
 */
export function priorityStrength(value) {
  const n = readPriority(value);
  return n === UNDECLARED ? null : (n - PRIORITY_SCALE.min) / (PRIORITY_SCALE.max - PRIORITY_SCALE.min);
}

/** The three column names, in the order the form asks them. */
export const PREFERENCE_FIELD_NAMES = Object.freeze([
  'competitive_level_priority',
  'playing_opportunity_priority',
  'academic_strength_priority',
]);

/**
 * Normalise one submitted answer, or say why it cannot be stored.
 *
 * SEPARATE FROM `readPriority` ON PURPOSE. `readPriority` is what a SCORER
 * uses, and it answers "did this athlete declare something I can act on" -
 * so anything it cannot place becomes UNDECLARED and the layer carries on
 * without a preference. That is right at scoring time and wrong at the
 * write boundary: silently storing a 7 as "no answer" loses the fact that
 * somebody sent a 7, and the athlete would see an unanswered question they
 * believe they answered.
 *
 * A write REFUSES instead, the way `contributionPairError` does. The two
 * behaviours are not in tension because they answer different questions;
 * they are kept in one file so that nobody has to guess which is which.
 *
 * A numeric STRING is normalised rather than refused, matching what the
 * player entity already does with `max_annual_contribution_usd`: JSON bodies
 * and form controls both send "4", and the column's own CHECK would accept
 * it anyway. Nothing else is coerced.
 *
 * @returns {{ ok: true, value: number|null } | { ok: false, error: string }}
 */
export function normalisePriority(field, value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: `${field} must be a whole number from ${PRIORITY_SCALE.min} to ${PRIORITY_SCALE.max}, or null for unanswered` };
  }
  if (n < PRIORITY_SCALE.min || n > PRIORITY_SCALE.max) {
    return { ok: false, error: `${field} must be from ${PRIORITY_SCALE.min} to ${PRIORITY_SCALE.max}, got ${n}` };
  }
  return { ok: true, value: n };
}

/**
 * Check a whole patch. Returns the first error, or null.
 *
 * Only fields actually PRESENT are checked, so a patch that says nothing
 * about preferences says nothing about them - the same omitted-versus-null
 * distinction the contribution pair keeps.
 */
export function priorityFieldErrors(data) {
  if (!data) return null;
  for (const field of PREFERENCE_FIELD_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const r = normalisePriority(field, data[field]);
    if (!r.ok) return r.error;
  }
  return null;
}

/**
 * THE ANTI-INFERENCE GUARD, stated as data so a test can assert it.
 *
 * Every field named here is one somebody could plausibly derive a preference
 * from, and none of them may be. A preference is a thing the athlete said.
 */
export const MAY_NOT_INFER_FROM = Object.freeze([
  'football_ability', 'soccer_score', 'gpa', 'sat_score', 'act_score',
  'intended_major', 'criterion_ranking', 'budget_range',
  'max_annual_contribution_usd', 'contribution_state',
  'preferred_divisions', 'preferred_conferences', 'recommendations', 'origin',
]);
