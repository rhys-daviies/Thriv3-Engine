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
     */
    question: 'How important is playing at the highest competitive level possible?',
    anchors: Object.freeze({
      1: 'Not important - the right programme matters more to me than the level',
      2: 'Slightly important',
      3: 'Somewhat important',
      4: 'Very important',
      5: 'The most important thing to me',
    }),
    helper: 'We work out which levels are realistic for you. This is about what you want.',
    /** What it must never be read as. */
    notAnAbilityRating: 'This is what the athlete WANTS. Their ability stays the operator-assessed 1-10 rating.',
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
    question: 'How important is getting onto the field early in your college career?',
    anchors: Object.freeze({
      1: 'Not important - I am happy to work my way in over a few years',
      2: 'Slightly important',
      3: 'Somewhat important',
      4: 'Very important',
      5: 'The most important thing to me',
    }),
    helper: 'We work out where the playing time actually is. This is about what you want.',
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
