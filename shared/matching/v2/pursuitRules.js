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
 * of it. It holds exactly half the weight, which is unambiguous dominance:
 * across the whole grid tested, no candidate let opportunity or finance rescue
 * a programme the athlete could not reach.
 *
 * Opportunity carries 0.30 rather than A7.5's 0.20 because at 0.20 the
 * athlete's own stated goals barely reached the list. Two athletes identical
 * in ability, money and options but opposite in what they want shared 71% of
 * their top hundred at 0.20 and 55% at 0.30 - the difference between
 * collecting a preference and collecting it for nothing. It is not raised
 * further because at 0.35 the developmental fixture's top ten begins to drift
 * upward in programme strength and its weakest recruitability falls from 0.35
 * to 0.28: opportunity starting to rescue, which is the thing the gate exists
 * to prevent.
 *
 * Financial drops to 0.20 and stays fully material, which was measured rather
 * than assumed: the same rating-9 athlete on a $40k budget and on a $5-10k
 * budget still shares under half their top hundred, the financial gate still
 * fires on 87% of the low-budget list, and no programme with viability below
 * 0.30 survives into it at any weight tested.
 *
 * A FLAT REGION, NOT A FITTED POINT. Holding opportunity at 0.30 and moving
 * recruitability between 0.475 and 0.525 leaves 95% of the top hundred
 * unchanged. The sensitive axis is opportunity itself, which is why the
 * argument above is about that number and not the other two.
 *
 * HEURISTIC. Nothing here is calibrated, and none of it was chosen by
 * resemblance to V1, by destination recall, or by how any division's share
 * came out.
 */
export const PURSUIT_WEIGHTS = Object.freeze({ recruitability: 0.50, financial: 0.20, opportunity: 0.30 });

/**
 * WHY ONE GLOBAL WEIGHTING RATHER THAN ONE PER DECLARATION STATE.
 *
 * A conditional scheme was built and measured: keep opportunity at 0.20 for
 * athletes who have declared nothing, raise it to 0.30 for those who have. It
 * ties exactly on the thing it was meant to win - the divergence between a
 * level-first and a playing-first athlete is 0.549 either way, because that
 * comparison only ever runs at the declared weights - and its advantage is
 * that an undeclared athlete's list cannot move at all.
 *
 * It was rejected on two grounds. The undeclared movement it avoids is small
 * and turns out to be sensible: 13 of 100 change, and the programmes arriving
 * share their minutes far more widely (0.74 against 0.55) and are improving
 * rather than flat, at a slight cost in recruitability. That is precisely what
 * weighting opportunity more should do, and refusing it would be refusing the
 * change on its merits.
 *
 * And declaration state is ALREADY handled, once, in the right place: the
 * Opportunity layer drops athleticOutcome to NOT_APPLICABLE when nobody has
 * asked, so an undeclared athlete's opportunity score is built only from
 * measured evidence. Handling it a second time here would put the same fact in
 * two places and make every explanation say which weighting it was under.
 */
export const WEIGHTING_ARCHITECTURE = 'global';

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
