/**
 * Does this programme recruit athletes like this one?
 *
 * -- ONE INTERNATIONAL SIGNAL, NOT TWO --------------------------------------
 *
 * A programme's international ROSTER SHARE and its international ARRIVAL
 * PROPENSITY correlate at r = 0.941. They are the same fact measured twice,
 * and scoring both would double the weight of the only signal an overseas
 * athlete has.
 *
 * Arrival propensity is the one kept, because it is the closer statement about
 * BEHAVIOUR: a roster share is the accumulated result of years of decisions,
 * including a previous coach's, while an arrival is a decision this programme
 * made in a season we can date. Roster share is carried as context.
 *
 * -- SAME-COUNTRY HISTORY IS NOT SCORED -------------------------------------
 *
 * It was a candidate and does not survive. It is a strict subset of
 * international propensity, so it is correlated with the thing it would sit
 * beside; and it is sparse - most programmes have signed nobody from any
 * given country, so for most athletes it is zero for reasons that say nothing
 * about the coach. A programme that has signed three New Zealanders is worth
 * SAYING in an approach, which is what the evidence engine is for. It is not
 * worth a second score.
 *
 * -- NOT APPLICABLE IS NOT A ZERO -------------------------------------------
 *
 * For a domestic athlete there is no international question to ask, so this
 * returns NOT_APPLICABLE and leaves the coverage denominator rather than
 * scoring zero. A domestic athlete must not be penalised for not being
 * foreign.
 */
import { GRADE, REASON, scoreable, unscoreable, notApplicable } from '../types.js';

/**
 * Where the curve saturates: the share of a programme's intake that is
 * international, above which an overseas recruit is plainly routine there.
 *
 * HEURISTIC. Men's college soccer averages about 30% international arrivals
 * and women's about 10%, but the spread is what matters - a programme that
 * has signed nobody from abroad is a materially harder sell, and one signing
 * a third of its class from abroad has the paperwork, the clearinghouse
 * experience and the network already.
 */
export const INTERNATIONAL_SATURATION = 0.3;

/** Arrivals a programme needs on file before its own rate is preferred to its division's. */
export const MIN_ARRIVALS_FOR_PROGRAMME_RATE = 8;

/**
 * @param {object} p
 * @param {boolean} p.isInternational        is the athlete recruited from abroad
 * @param {object|null} p.programmeArrivals  { total, international }
 * @param {object|null} p.divisionArrivals   { total, international } fallback
 * @param {number|null} p.internationalRosterShare  CONTEXT ONLY
 * @param {number|null} p.sameCountryPlayers        CONTEXT ONLY
 */
export function internationalPropensity({
  isInternational, programmeArrivals, divisionArrivals,
  internationalRosterShare = null, sameCountryPlayers = null,
  saturation = INTERNATIONAL_SATURATION,
}) {
  if (!isInternational) return notApplicable({ why: 'the athlete is not recruited from abroad' });

  const useProgramme = programmeArrivals && programmeArrivals.total >= MIN_ARRIVALS_FOR_PROGRAMME_RATE;
  const source = useProgramme ? programmeArrivals : divisionArrivals;
  if (!source || !source.total) {
    return unscoreable({
      reason: REASON.NO_ROSTER_ON_FILE,
      missing: ['internationalArrivalHistory'],
      available: internationalRosterShare === null ? [] : ['internationalRosterShare'],
    });
  }

  const share = source.international / source.total;
  const value = Math.min(1, share / saturation);

  return scoreable({
    value,
    // A programme's own arrivals are a measurement of its behaviour. Its
    // division's are a proxy for it, and are graded as one.
    grade: useProgramme ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage: 1,
    basis: {
      internationalArrivalShare: share,
      internationalArrivals: source.international,
      totalArrivals: source.total,
      level: useProgramme ? 'programme' : 'division',
      saturation,
      contextOnly: {
        // Correlated with the scored share at r = 0.941. Shown, never added.
        internationalRosterShare,
        // Worth saying in an approach, not worth a second score.
        sameCountryPlayers,
      },
    },
  });
}
