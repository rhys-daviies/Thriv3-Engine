/**
 * Recruiting Market Match: does this programme recruit athletes from markets
 * like this athlete's?
 *
 * ONE COMPONENT, ONE MEANING, two arms. An international athlete is matched
 * against the programme's international recruiting history; a domestic athlete
 * against its geographic footprint. A7.7.3 measured the two as essentially
 * independent (r = -0.06), which is what makes them arms of one question
 * rather than two components that would double-count a single behaviour.
 *
 * -- WHAT THIS IS NOT ------------------------------------------------------
 *
 * NOT the old Geography criterion. V1 scored distance from home and treated
 * closer as better, which is a preference nobody was asked for. This is the
 * PROGRAMME's demonstrated behaviour, and it says nothing about where the
 * athlete wants to go - that remains Opportunity/Fit's `locationFit`, which is
 * NOT_APPLICABLE until somebody asks.
 *
 * NOT a prediction that this athlete will be recruited. It is the rate at
 * which the programme has recruited from this market before, shrunk toward its
 * division, and nothing more.
 *
 * -- WHY FAR + NATIONAL IS POSITIVE EVIDENCE -------------------------------
 *
 * The naive reading - near is good, far is bad - would penalise a distant
 * athlete at a programme that recruits nationally, which is precisely the
 * programme most likely to take them. So the domestic arm reads the
 * programme's near-share AS A DESCRIPTION OF ITS FOOTPRINT and matches the
 * athlete to it: a near athlete is evidenced by a local footprint, a far
 * athlete by a broad one. A programme that splits evenly returns 0.5 to both,
 * which is the honest answer for a programme with no clear footprint.
 */
import { GRADE, REASON, scoreable, unscoreable, notApplicable } from '../types.js';
import {
  MARKET_MIN_ARRIVALS, MARKET_PSEUDO_COUNT, NEAR_BAND_KM,
} from '../recruitingRules.js';
import { INTERNATIONAL_SATURATION } from './recruitingBehaviour.js';

/**
 * Empirical shrinkage toward the division baseline.
 *
 * A programme with three observations must not produce an extreme conclusion.
 * The pseudo-count is how many arrivals at the division rate the programme is
 * treated as also having, so a programme needs a recruiting class of its own
 * before its own behaviour dominates its division's.
 */
export function shrinkToBaseline(hits, trials, baseline, pseudoCount = MARKET_PSEUDO_COUNT) {
  const d = trials + pseudoCount;
  if (d <= 0) return baseline;
  return (hits + (pseudoCount * baseline)) / d;
}

/**
 * @param {object} p
 * @param {boolean} p.isInternational        the ATHLETE's origin
 * @param {number|null} p.distanceKm         athlete home to programme, domestic only
 * @param {object|null} p.programme          { arrivals, international, domesticWithGeo, near }
 * @param {object|null} p.division           the same counts pooled over the division
 */
export function recruitingMarket({
  isInternational, distanceKm = null, programme = null, division = null,
  minArrivals = MARKET_MIN_ARRIVALS, pseudoCount = MARKET_PSEUDO_COUNT,
  nearBandKm = NEAR_BAND_KM, saturation = INTERNATIONAL_SATURATION,
}) {
  /**
   * BELOW THE EVIDENCE THRESHOLD IS UNKNOWN, NOT THE DIVISION RATE.
   *
   * A programme we have seen recruit four times has not demonstrated a
   * footprint, and substituting its division's would report the division's
   * behaviour under the programme's name. Shrinkage handles the middle;
   * this handles the bottom.
   */
  if (!programme || !Number.isFinite(programme.arrivals) || programme.arrivals < minArrivals) {
    return unscoreable({
      reason: REASON.NO_ROSTER_ON_FILE,
      missing: ['recruitingHistory'],
      available: [],
      coverage: 0,
      detail: { arrivals: programme?.arrivals ?? 0, minArrivals },
    });
  }

  if (isInternational) {
    if (!division || !division.arrivals) {
      return unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['divisionBaseline'], available: ['recruitingHistory'] });
    }
    const baseline = division.international / division.arrivals;
    const share = shrinkToBaseline(programme.international, programme.arrivals, baseline, pseudoCount);
    return scoreable({
      value: Math.min(1, share / saturation),
      grade: GRADE.MEASURED,
      coverage: 1,
      basis: {
        arm: 'INTERNATIONAL',
        internationalArrivalShare: share,
        rawShare: programme.international / programme.arrivals,
        internationalArrivals: programme.international,
        totalArrivals: programme.arrivals,
        divisionBaseline: baseline,
        saturation, pseudoCount, minArrivals,
      },
    });
  }

  /**
   * A domestic athlete whose home we cannot place is NOT_APPLICABLE rather
   * than unscoreable: the programme's footprint is known, and it is the
   * athlete's side of the comparison that is missing, so there is no question
   * to answer rather than an answer we failed to find.
   */
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm)) {
    return notApplicable({ why: 'no usable home location for this athlete', arm: 'DOMESTIC' });
  }
  if (!programme.domesticWithGeo || !division?.domesticWithGeo) {
    return unscoreable({
      reason: REASON.NO_LOCATION,
      missing: ['recruitOrigins'],
      available: ['recruitingHistory'],
      detail: { domesticWithGeo: programme.domesticWithGeo ?? 0 },
    });
  }
  const baseline = division.near / division.domesticWithGeo;
  const nearShare = shrinkToBaseline(programme.near, programme.domesticWithGeo, baseline, pseudoCount);
  const athleteIsNear = distanceKm <= nearBandKm;
  return scoreable({
    // Near athlete matched to a local footprint; far athlete to a broad one.
    value: athleteIsNear ? nearShare : 1 - nearShare,
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: {
      arm: 'DOMESTIC',
      athleteDistanceKm: Math.round(distanceKm),
      athleteIsNear,
      nearShare,
      rawNearShare: programme.near / programme.domesticWithGeo,
      nearArrivals: programme.near,
      domesticArrivalsPlaced: programme.domesticWithGeo,
      divisionBaseline: baseline,
      nearBandKm, pseudoCount, minArrivals,
      footprint: nearShare >= 0.6 ? 'LOCAL' : nearShare <= 0.35 ? 'NATIONAL' : 'REGIONAL',
    },
  });
}

/**
 * The international under-utilisation CAVEAT. Not a score, and never
 * subtracted from one.
 *
 * A7.7.3 measured international arrival share against roster share at 0.963
 * and minutes share against starter share at 0.971, so utilisation carries
 * almost no information the arrival signal does not already hold - for 96% of
 * programmes. The remaining 27 of 757 are a real pattern worth telling an
 * operator about, and the only honest way to carry them is as a statement of
 * what was observed, attached to nothing.
 *
 * Thresholds are deliberately demanding: a programme must carry a substantial
 * international roster AND enough minutes evidence for the comparison to mean
 * anything, before anything is said at all.
 */
export const UTILISATION_CAVEAT = Object.freeze({
  minRosterRows: 15,
  minInternationalRosterShare: 0.20,
  utilisationRatio: 0.60,
});

export function internationalUtilisationCaveat({
  rosterRows, internationalRows, totalMinutes, internationalMinutes,
  rule = UTILISATION_CAVEAT,
}) {
  if (!Number.isFinite(rosterRows) || rosterRows < rule.minRosterRows) return null;
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  const rosterShare = internationalRows / rosterRows;
  if (rosterShare < rule.minInternationalRosterShare) return null;
  const minutesShare = internationalMinutes / totalMinutes;
  if (minutesShare >= rosterShare * rule.utilisationRatio) return null;
  return {
    rosterShare, minutesShare, rosterRows, internationalRows,
    ratio: rosterShare > 0 ? minutesShare / rosterShare : null,
  };
}
