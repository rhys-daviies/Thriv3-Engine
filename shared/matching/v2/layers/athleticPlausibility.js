/**
 * ATHLETIC RECRUITING COMPATIBILITY.
 *
 * On athletic level alone, how compatible is this athlete with the level this
 * programme recruits at?
 *
 * ONE SIGNAL, and the only place athletic ability enters V2. It is not a
 * component of recruitability - it is the CEILING on it, applied in
 * recruitability.js, so that no amount of roster need makes a clearly
 * under-level athlete a compatible recruit.
 *
 * NOT A PROBABILITY. It does not estimate how often a coach would reply, how
 * likely an offer is, or anything else we could only learn from real outreach
 * responses. It is a declared heuristic compatibility factor, and the
 * constants behind it say so in `recruitingRules.js`.
 *
 * -- WHY NOT V1's GAUSSIAN --------------------------------------------------
 *
 * V1 scores athletic fit as a bell curve around the programme's level, which
 * says a coach becomes LESS interested as an athlete gets better once they
 * pass the programme's own standard. That is a statement about the athlete's
 * preferences wearing the coach's name: a Division III coach does not turn
 * down a Division I player. The curve here is monotone and saturating, so
 * being stronger never reduces compatibility. An athlete who does not WANT a
 * weaker programme is answered in Athlete Opportunity, not here.
 *
 * -- THE AXIS ---------------------------------------------------------------
 *
 * Both sides are percentiles of the same programme-strength distribution, from
 * the A7.1 calibration:
 *
 *   delta = abilityToPercentile(rating, sport) - percentileOf(soccer_score, sport)
 *
 * so delta is "how much of the pool sits between this athlete and this
 * programme", signed. Percentiles rather than raw scores because a ten-point
 * gap means something different at 40 than at 90, and because the calibrated
 * rating is only defined on that axis.
 *
 * -- THE FORM ---------------------------------------------------------------
 *
 * Asymmetric about the athlete's own level, because the axis is asymmetric:
 * it compresses severely at the top, where "at level" and "a genuine reach"
 * are a few percentile points apart. See `recruitingRules.js` for the
 * measurement and for why this is compensation rather than a finding.
 *
 *   delta <  0   A = a0 x exp(delta / decay)
 *   delta >= 0   A = a0 + (1 - a0) x (1 - exp(-delta / rise))
 *
 * Continuous at zero, where it equals a0; monotone non-decreasing throughout;
 * bounded by (0, 1). Structural form here; a0, decay and rise live in
 * recruitingRules.js as declared heuristics.
 */
import { GRADE, REASON, scoreable, unscoreable } from '../types.js';
import { abilityToPercentile, percentileOf, abilityToProgrammeScore } from '../calibration/abilityScale.js';
import { COMPATIBILITY_AT_LEVEL, COMPATIBILITY_DECAY, COMPATIBILITY_RISE } from '../recruitingRules.js';

/** The structural form, separated from its parameters so both can be tested alone. */
export function plausibilityFromDelta(delta, {
  atLevel = COMPATIBILITY_AT_LEVEL,
  decay = COMPATIBILITY_DECAY,
  rise = COMPATIBILITY_RISE,
} = {}) {
  return delta < 0
    ? atLevel * Math.exp(delta / decay)
    : atLevel + ((1 - atLevel) * (1 - Math.exp(-delta / rise)));
}

/**
 * @param {object} p
 * @param {number|null} p.rating        the 1-10 operator judgement
 * @param {number|null} p.soccerScore   the programme's strength
 * @param {string} p.sport
 */
export function athleticPlausibility({ rating, soccerScore, sport, atLevel, decay, rise }) {
  if (rating === null || rating === undefined || !Number.isFinite(Number(rating))) {
    return unscoreable({ reason: REASON.NO_ATHLETE_LEVEL, missing: ['athleteRating'], available: [] });
  }
  if (soccerScore === null || soccerScore === undefined || !Number.isFinite(Number(soccerScore))) {
    return unscoreable({ reason: REASON.NO_PROGRAMME_LEVEL, missing: ['soccerScore'], available: ['athleteRating'] });
  }

  const athletePercentile = abilityToPercentile(Number(rating), sport);
  const programmePercentile = percentileOf(Number(soccerScore), sport);
  const delta = athletePercentile - programmePercentile;
  const value = plausibilityFromDelta(delta, { atLevel, decay, rise });

  return scoreable({
    value,
    // Both inputs are measurements: an operator's rating of an athlete they
    // watched, and a programme score built from results. Neither is a proxy.
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: {
      rating: Number(rating),
      athletePercentile,
      approximateAthleteScore: abilityToProgrammeScore(Number(rating), sport),
      soccerScore: Number(soccerScore),
      programmePercentile,
      delta,
      atLevel: atLevel ?? COMPATIBILITY_AT_LEVEL,
      decay: decay ?? COMPATIBILITY_DECAY,
      rise: rise ?? COMPATIBILITY_RISE,
      form: 'asymmetric exponential in percentile space',
    },
  });
}
