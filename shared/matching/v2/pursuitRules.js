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

/**
 * -- A7.18: THE COMPETITIVE-LEVEL ANCHOR -----------------------------------
 *
 * Why this sits in Pursuit rather than in Opportunity, where a level
 * preference already lives.
 *
 * A7.14 ran the same elite athlete twice, once saying competitive level was
 * extremely important and once saying nothing in particular, and measured
 * that Recruitability came out BIT-IDENTICAL: the preference moves only
 * `athleticOutcome`, which is one component of Opportunity, which carries
 * 0.30 of the base against Recruitability's 0.50. Its effective authority
 * over the final priority is 0.123 at the strongest statement an athlete can
 * make and 0.056 at the neutral one, against positional evidence's 0.244. The
 * preference was not being ignored; it was being outvoted roughly two to one,
 * and four to one for the athlete who states nothing.
 *
 * So the athlete's own level statement gets authority OUTSIDE the layer that
 * cannot hear it. A7.16 measured the alternative - the same anchor placed
 * inside Opportunity - and it failed: 79% of the balanced athlete's top
 * hundred still sat more than fifteen strength points below them, because
 * 0.30 of the base cannot outvote 0.50 however the 0.30 is spent.
 *
 * -- IT IS AN ANCHOR AND NOT A BAND ----------------------------------------
 *
 * tau never reaches 1, so `levelFactor` is strictly positive for every
 * programme at every stated priority. NOTHING IS EXCLUDED FOR ITS LEVEL. A
 * tight budget or a strong playing-time preference still lifts far-below
 * programmes into the first hundred, which A7.16 measured: the financially
 * constrained athlete keeps fourteen programmes more than thirty strength
 * points below them, and the playing-first athlete keeps fifty-six.
 */
export const LEVEL_ANCHOR_SIGMA = 0.18;

/**
 * How much of the anchor each stated priority turns on.
 *
 * HEURISTIC, and deliberately linear. The athlete said 1 to 5; there is no
 * evidence that would justify a curve between those points, and inventing one
 * would claim a precision the five-point question does not have.
 */
export const LEVEL_ANCHOR_TAU = Object.freeze({ 1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40, 5: 0.50 });

/**
 * What an athlete who has not answered gets.
 *
 * A7.12.1 established that NULL and 3 are different objects and must not be
 * conflated in stored data or in explanation. This is a SCORING fallback and
 * nothing else: the athlete record keeps its NULL, the basis records that the
 * fallback was used, and the explanation may not describe an unanswered
 * question as a moderate answer.
 */
export const LEVEL_ANCHOR_DEFAULT_PRIORITY = 3;

/**
 * Alignment between the athlete's estimated level and the programme's, as a
 * Gaussian in the same percentile-space delta athletic plausibility uses.
 *
 * Symmetric, which is a DECLARED SIMPLIFICATION rather than a finding. A7.17
 * established that being above the athlete and being below them are not the
 * same situation, and that the reach side is an open question: for a rating-9
 * athlete the entire above-level population spans four percentile points,
 * because the axis compresses savagely at the top. An asymmetric variant was
 * measured there and did not improve matters. The axis itself is the open
 * problem and it is not this phase's to solve.
 */
export function levelAlignment(delta, { sigma = LEVEL_ANCHOR_SIGMA } = {}) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  return Math.exp(-((delta / sigma) ** 2));
}

/**
 * The multiplier itself. Returns 1 - a no-op - when there is no delta to
 * anchor against, so a programme is never penalised for evidence we lack.
 */
export function levelFactor(delta, priority, opts = {}) {
  const align = levelAlignment(delta, opts);
  if (align === null) return { factor: 1, align: null, tau: null, priorityUsed: null, defaulted: false };
  // `Number(null)` is 0 and 0 is finite, so the empty cases are excluded by
  // name before the numeric check - an unanswered question must not become a
  // priority of zero.
  const stated = (priority === null || priority === undefined || priority === ''
    || !Number.isFinite(Number(priority))) ? null : Number(priority);
  const defaulted = stated === null;
  const used = defaulted ? LEVEL_ANCHOR_DEFAULT_PRIORITY : stated;
  const tau = (opts.tau ?? LEVEL_ANCHOR_TAU)[used] ?? LEVEL_ANCHOR_TAU[LEVEL_ANCHOR_DEFAULT_PRIORITY];
  return { factor: 1 - (tau * (1 - align)), align, tau, priorityUsed: used, defaulted };
}
