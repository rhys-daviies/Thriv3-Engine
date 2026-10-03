/**
 * The 1-10 operator rating, on a scale that means something.
 *
 * WHAT IS REPLACED. V1 computed `level = football_ability * 10` and compared it
 * to `soccer_score` directly. Because the programme distribution is not
 * uniform, that map is badly wrong at both ends: ratings 1 and 2 sit below
 * 0.7% of programmes, and 8, 9 and 10 are all crushed into the top 6% where
 * they cannot discriminate between a mid-table Division I side and a national
 * champion. The slider is NOT the problem - an operator's eye is the best
 * signal we have - the LINEAR MAP is.
 *
 * WHAT REPLACES IT. Each integer rating is declared to mean a percentile of the
 * programme distribution, and the corresponding `soccer_score` is derived from
 * the live data at generation time and PINNED. The comparison axis is the
 * percentile, not the score:
 *
 *   delta = abilityToPercentile(rating, sport) - percentileOf(soccerScore, sport)
 *
 * WHY PINNED. If the scale were recomputed at request time, importing a block
 * of junior-college programmes would change what "rating 6" means, silently,
 * for every athlete. The data file carries a digest of the distribution it was
 * built from; `npm run calibrate:ability -- --check` reports drift and REFUSES
 * to rewrite. Changing what a rating means is a decision, not an event.
 *
 * NOT COMPARABLE ACROSS SPORTS. There are 349 women's Division I programmes and
 * 213 men's, so Division I sits at a different place in each distribution. A
 * women's 6 already touches Division I at 25%; a men's 6 does not touch it at
 * all. The tables are per sport, and a rating is only meaningful alongside its
 * sport.
 */
import table from './abilityScale.data.json' with { type: 'json' };

export const CALIBRATION_ID = table.calibrationId;
export const CALIBRATION = Object.freeze({
  calibrationId: table.calibrationId,
  createdAt: table.createdAt,
  quantileMethod: table.quantileMethod,
  percentileTargets: Object.freeze([...table.percentileTargets]),
  sports: Object.freeze(Object.fromEntries(Object.entries(table.sports).map(([sport, s]) => [sport, Object.freeze({
    sport,
    programmes: s.programmes,
    min: s.min,
    max: s.max,
    sourceDistributionDigest: s.sourceDistributionDigest,
    divisionCounts: Object.freeze({ ...s.divisionCounts }),
    ratings: Object.freeze(s.ratings.map((r) => Object.freeze({ ...r, divisionMix: Object.freeze({ ...r.divisionMix }) }))),
  })]))),
});

export const CALIBRATED_SPORTS = Object.freeze(Object.keys(table.sports));

function sportTable(sport) {
  const s = table.sports[sport];
  if (!s) {
    throw new Error(
      `abilityScale: no calibration for sport ${JSON.stringify(sport)}. `
      + `A rating has no meaning without one - calibrated: ${CALIBRATED_SPORTS.join(', ')}`,
    );
  }
  return s;
}

function checkRating(rating) {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) {
    throw new Error(`abilityScale: rating must be a finite number, got ${JSON.stringify(rating)}`);
  }
  if (rating < 1 || rating > 10) {
    // Not clamped. A rating outside 1-10 is an intake defect, and silently
    // pulling it to a boundary would hide it.
    throw new Error(`abilityScale: rating must be within [1,10], got ${rating}`);
  }
}

/**
 * Where a rating claims the athlete sits in the programme distribution.
 *
 * Decimal ratings interpolate linearly between the two declared integer
 * targets. The intake is currently integer-only; interpolation is here so that
 * a finer slider later does not require a new scale.
 *
 * @returns {number} a percentile as a fraction, within (0,1)
 */
export function abilityToPercentile(rating, sport) {
  checkRating(rating);
  const { ratings } = sportTable(sport);
  const lo = Math.floor(rating);
  const hi = Math.ceil(rating);
  const pLo = ratings[lo - 1].percentile;
  if (lo === hi) return pLo / 100;
  const pHi = ratings[hi - 1].percentile;
  return (pLo + (pHi - pLo) * (rating - lo)) / 100;
}

/** The `soccer_score` a rating corresponds to. Reporting only - never the comparison axis. */
export function abilityToProgrammeScore(rating, sport) {
  checkRating(rating);
  const { ratings } = sportTable(sport);
  const lo = Math.floor(rating);
  const hi = Math.ceil(rating);
  const sLo = ratings[lo - 1].soccerScore;
  if (lo === hi) return sLo;
  const sHi = ratings[hi - 1].soccerScore;
  return sLo + (sHi - sLo) * (rating - lo);
}

/**
 * Where a programme sits in its own sport's distribution.
 *
 * Mid-rank for ties, so that the map is strictly increasing over distinct
 * scores and two programmes on the same score get the same percentile rather
 * than an order decided by the sort.
 *
 * @returns {number} a percentile as a fraction, within (0,1)
 */
export function percentileOf(soccerScore, sport) {
  if (typeof soccerScore !== 'number' || !Number.isFinite(soccerScore)) {
    throw new Error(`abilityScale: soccerScore must be a finite number, got ${JSON.stringify(soccerScore)}`);
  }
  const { distribution } = sportTable(sport);
  const n = distribution.length;
  // Binary search rather than a scan. This is called once per programme per
  // athlete - 1,166 times for a men's list - and a linear scan makes that
  // quadratic in the pool for no reason. The distribution is pinned ascending,
  // so the bounds are the two ends of the run of equal scores.
  const below = lowerBound(distribution, soccerScore);
  const atOrBelow = upperBound(distribution, soccerScore);
  return (below + atOrBelow) / (2 * n);
}

/** First index whose value is >= target, i.e. the count of values strictly below it. */
function lowerBound(sorted, target) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** First index whose value is > target, i.e. the count of values at or below it. */
function upperBound(sorted, target) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * The full reading for an athlete rating, in one object.
 *
 * `programmeStrengthPercentile` is the canonical V2 comparison axis;
 * `approximateProgrammeScore` is for display and for arguing with the table,
 * and nothing should compute on it.
 */
export function abilityLevel(rating, sport) {
  const { ratings, programmes } = sportTable(sport);
  const percentile = abilityToPercentile(rating, sport);
  const nearest = ratings[Math.round(rating) - 1];
  return Object.freeze({
    rating,
    sport,
    programmeStrengthPercentile: percentile,
    approximateProgrammeScore: abilityToProgrammeScore(rating, sport),
    divisionMix: nearest.divisionMix,
    calibrationId: CALIBRATION_ID,
    programmesInScale: programmes,
  });
}

/**
 * The gap between what a rating claims and where a programme sits.
 *
 * Positive means the athlete is rated above the programme's level. Bounded by
 * (-1, 1) because both terms are percentiles of the same distribution, which is
 * the property that makes a Division III gap and a Division I gap the same
 * quantity - and the reason the scale is pooled per sport rather than computed
 * within a division.
 */
export function abilityDelta({ rating, soccerScore, sport }) {
  return abilityToPercentile(rating, sport) - percentileOf(soccerScore, sport);
}

/**
 * Has the live distribution moved away from the one the scale was built on?
 *
 * Takes the scores rather than reading a database, so that it can be called
 * from a script, a test or a health check without any of them owning a
 * connection. Returns a report; it never rewrites anything.
 */
export function checkDistribution(sport, liveScores, { digestOf }) {
  const pinned = sportTable(sport);
  const sorted = [...liveScores].sort((a, b) => a - b).map((s) => Number(s.toFixed(2)));
  const digest = digestOf(sorted);
  return {
    sport,
    matches: digest === pinned.sourceDistributionDigest,
    pinnedDigest: pinned.sourceDistributionDigest,
    liveDigest: digest,
    pinnedProgrammes: pinned.programmes,
    liveProgrammes: sorted.length,
  };
}

/** The dominant division at each rating - the thing invariant 3 watches. */
export function dominantDivisions(sport) {
  return sportTable(sport).ratings.map((r) => ({
    rating: r.rating,
    division: Object.entries(r.divisionMix).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    share: Object.entries(r.divisionMix).sort((a, b) => b[1] - a[1])[0]?.[1] ?? null,
  }));
}
