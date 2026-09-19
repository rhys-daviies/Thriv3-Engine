/**
 * Pursuit Priority: the weights and gates, and what each one means.
 *
 * Everything here is HEURISTIC. Nothing in this file is calibrated, because
 * the data that would calibrate it - whether a coach replied, whether an offer
 * followed - does not exist yet. It is NOT calibrated against where athletes
 * historically enrolled: that measures who recruited and offered first as much
 * as fit, and A7.1 recorded the number that settles it - roster opportunity at
 * the school an athlete chose is no higher than at a programme drawn at random.
 */

/**
 * How much each layer contributes to the additive base.
 *
 * Recruitability leads because the product's scarce resource is a coach's
 * attention, and a programme that would not have the athlete cannot repay any
 * of it. Financial sits second because it decides whether an offer could be
 * accepted. Opportunity is third and smallest: it is the layer with the least
 * athlete evidence behind it today, and weighting it higher would be weighting
 * an absence.
 *
 * Chosen from the sensitivity grid rather than inherited: across the region
 * 0.45-0.65 / 0.20-0.35 / 0.15-0.30 the top hundred is stable and the
 * division mix barely moves, so this is a defensible point inside a flat
 * region rather than a peak.
 */
export const PURSUIT_WEIGHTS = Object.freeze({ recruitability: 0.55, financial: 0.25, opportunity: 0.20 });

/**
 * The gates, as (floor, threshold) pairs.
 *
 * A gate CONSTRAINS A TAIL. It is 1 above its threshold and falls smoothly to
 * its floor at zero, so a layer stops mattering as a gate once it is merely
 * adequate and the weighted term carries it from there. The first version
 * multiplied by the layer across its whole range, which scaled everything down
 * and counted recruitability twice - it appeared in the base AND in the gate,
 * and the result correlated with recruitability at 0.98 while opportunity
 * correlated at 0.18. The other two layers had become decoration.
 *
 * RECRUITABILITY: floor 0.05, threshold 0.25.
 *   Below a quarter, the case collapses - at recruitability 0 only a twentieth
 *   of the base survives, so no amount of money or fit rescues a programme
 *   that would not have the athlete. At or above a quarter the gate is fully
 *   open. 0.25 is about the tenth percentile of the live recruitability
 *   distribution, so it constrains the tail and not the body.
 *
 * FINANCIAL: floor 0.30, threshold 0.50.
 *   Deliberately a higher floor. Severe financial mismatch must STRONGLY
 *   DEMOTE and must not delete - an exceptional programme is still worth an
 *   approach when a scholarship is exactly what would make it reachable, and
 *   0.30 is what keeps it on the list. Financial viability 0.50 is the point
 *   at which a family must find half their stated contribution again, which is
 *   where the layer itself says the case is evenly balanced.
 *
 * OPPORTUNITY IS NOT GATED AT ALL. A coach who wants the athlete makes a
 * programme worth pursuing even where the athlete-side case is mediocre, and
 * the athlete-side evidence is the thinnest we hold - gating on it would let
 * the layer we know least about delete programmes.
 */
export const PURSUIT_GATES = Object.freeze({
  recruitability: { floor: 0.05, threshold: 0.25 },
  financial: { floor: 0.30, threshold: 0.50 },
});

/** How many programmes the actionable list may carry. An OUTPUT LIMIT, not a threshold. */
export const TOP_N = 100;

/**
 * Smoothstep, so the gate has no kink where it reaches its threshold.
 *
 * A linear ramp would satisfy every monotonicity requirement and still put a
 * discontinuity in the derivative exactly where most programmes sit, which is
 * the kind of edge a ranking notices.
 */
export function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - (2 * x));
}

/**
 * A tail gate: `floor` at zero, rising smoothly to 1 at `threshold` and staying
 * there.
 */
export function tailGate(value, { floor, threshold }) {
  return floor + ((1 - floor) * smoothstep(Math.max(0, value) / threshold));
}
