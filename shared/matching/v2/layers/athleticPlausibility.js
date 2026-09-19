/**
 * Would a coach at this programme consider an athlete at this level at all?
 *
 * ONE SIGNAL, and the only place athletic ability enters V2. It is not a
 * component of recruitability - it is the CEILING on it, applied in
 * recruitability.js, so that no amount of roster need makes a clearly
 * under-level athlete a plausible recruit.
 *
 * -- WHY NOT V1's GAUSSIAN --------------------------------------------------
 *
 * V1 scores athletic fit as a bell curve around the programme's level, which
 * says a coach becomes LESS interested as an athlete gets better once they
 * pass the programme's own standard. That is a statement about the athlete's
 * preferences wearing the coach's name: a Division III coach does not turn
 * down a Division I player. The curve here is monotone and saturating, so
 * being stronger never reduces a coach's interest.
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
 *   A = 1 / (1 + exp(-(delta - delta0) / s))
 *
 * Structural form here; delta0 and s live in recruitingRules.js as declared
 * heuristics.
 */
import { GRADE, REASON, scoreable, unscoreable } from '../types.js';
import { abilityToPercentile, percentileOf, abilityToProgrammeScore } from '../calibration/abilityScale.js';
import { PLAUSIBILITY_SLOPE, PLAUSIBILITY_MIDPOINT } from '../recruitingRules.js';

/** The structural form, separated from its parameters so both can be tested alone. */
export function plausibilityFromDelta(delta, { slope = PLAUSIBILITY_SLOPE, midpoint = PLAUSIBILITY_MIDPOINT } = {}) {
  return 1 / (1 + Math.exp(-(delta - midpoint) / slope));
}

/**
 * @param {object} p
 * @param {number|null} p.rating        the 1-10 operator judgement
 * @param {number|null} p.soccerScore   the programme's strength
 * @param {string} p.sport
 */
export function athleticPlausibility({ rating, soccerScore, sport, slope, midpoint }) {
  if (rating === null || rating === undefined || !Number.isFinite(Number(rating))) {
    return unscoreable({ reason: REASON.NO_ATHLETE_LEVEL, missing: ['athleteRating'], available: [] });
  }
  if (soccerScore === null || soccerScore === undefined || !Number.isFinite(Number(soccerScore))) {
    return unscoreable({ reason: REASON.NO_PROGRAMME_LEVEL, missing: ['soccerScore'], available: ['athleteRating'] });
  }

  const athletePercentile = abilityToPercentile(Number(rating), sport);
  const programmePercentile = percentileOf(Number(soccerScore), sport);
  const delta = athletePercentile - programmePercentile;
  const value = plausibilityFromDelta(delta, { slope, midpoint });

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
      slope: slope ?? PLAUSIBILITY_SLOPE,
      midpoint: midpoint ?? PLAUSIBILITY_MIDPOINT,
      form: 'logistic in percentile space',
    },
  });
}
