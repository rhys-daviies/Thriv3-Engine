/**
 * Coach Recruitability: would this programme recruit an athlete like this one?
 *
 *   1.0  the athlete is clearly at or above the level this programme signs,
 *        AND the behavioural evidence supports it - a starting place opening
 *        that this programme's history says becomes a newcomer's, and a
 *        recruiting market this athlete belongs to.
 *   0.5  a plausible approach on partial behavioural support.
 *   0.0  approached as the athlete falls below the level the programme
 *        recruits at. No amount of behaviour lifts it, because plausibility
 *        multiplies rather than adds.
 *
 * INDEPENDENT OF, and unable to read: budget, financial viability, the
 * athlete's own location preference, intended major, academics and every
 * stated preference. Programme quality enters exactly once, as the
 * programme's LEVEL inside athletic plausibility, and never as prestige.
 *
 * -- THE COMBINATION: R-C, BASELINE PLUS MODIFIERS -------------------------
 *
 *   R = A x ( phi + (1 - phi) x SUM over KNOWN signals of w_s x v_s )
 *
 * with the behavioural weights summing to 1, so the maximum is exactly A and
 * plausibility remains a true ceiling.
 *
 * AN UNKNOWN SIGNAL CONTRIBUTES NOTHING AND ITS WEIGHT IS NOT REDISTRIBUTED.
 * That single property is why this form was chosen over the three
 * alternatives A7.7.3 measured. Renormalising over the signals that happen to
 * exist lets a surviving strong signal absorb a missing weak one's weight, so
 * two otherwise identical programmes - one with MEASURED LOW positional
 * demand, one with UNKNOWN - came out 0.529 against 0.870, and the programme
 * we knew less about ranked higher. Under this form it is 0.529 against
 * 0.506: missing evidence costs a little and is never rewarded.
 *
 * Three earlier structures were rejected before that:
 *
 *   min(A, core) makes whichever signal is larger completely irrelevant, so a
 *   change in the better-evidenced signal moves nothing until it crosses the
 *   other - a cliff exactly where the ranking is decided.
 *
 *   A gated-additive form inside recruitability rebuilds, one level down, the
 *   gating that pursuit priority already applies to recruitability as a whole.
 *
 *   A coverage-renormalised core - what this layer used until A7.7.4 - is the
 *   fairness failure described above.
 *
 * -- THE EVIDENCE FLOOR ----------------------------------------------------
 *
 * At least one behavioural signal must be KNOWN. Athletic plausibility alone
 * is not a recruitability score: for 228 junior colleges we can say an athlete
 * is plainly good enough and nothing whatever about whether the programme
 * would take one, and V1 answered anyway on a neutral prior and gave a
 * developmental athlete 17 of the top 100 on the strength of it.
 */
import { GRADE, REASON, scoreable, unscoreable, isScoreable, isNotApplicable } from '../types.js';
import { CORE_FLOOR, BEHAVIOUR_WEIGHTS } from '../recruitingRules.js';

/**
 * @param {object} p
 * @param {object} p.athletic      result from athleticPlausibility
 * @param {object} p.positional    result from positionalOpportunity
 * @param {object} p.market       result from recruitingMarket
 */
export function coachRecruitability({
  athletic, positional, market,
  phi = CORE_FLOOR, weights = BEHAVIOUR_WEIGHTS,
}) {
  // REQUIRED. Without a level for either side there is no question to answer:
  // "would they recruit this athlete" is about the athlete, and an answer
  // built only from roster arithmetic would be about the vacancy.
  if (!isScoreable(athletic)) {
    return unscoreable({
      reason: athletic.reason,
      missing: ['athleticPlausibility', ...(isScoreable(positional) ? [] : ['positionalOpportunity'])],
      available: isScoreable(positional) ? ['positionalOpportunity'] : [],
      coverage: 0,
      detail: { requiredMissing: 'athleticPlausibility' },
    });
  }

  const signals = [
    { key: 'positionalOpportunity', weight: weights.positional, result: positional },
    { key: 'recruitingMarket', weight: weights.market, result: market },
  ];
  const known = signals.filter((s) => isScoreable(s.result));

  /**
   * THE EVIDENCE FLOOR. Not a coverage number - a requirement that at least
   * one behavioural signal was actually measured.
   */
  if (!known.length) {
    const missing = signals.filter((s) => !isScoreable(s.result));
    const notApplicableOnly = missing.every((s) => isNotApplicable(s.result));
    return unscoreable({
      reason: missing.find((s) => !isNotApplicable(s.result))?.result.reason ?? positional.reason,
      missing: missing.map((s) => s.key),
      available: ['athleticPlausibility'],
      coverage: 0,
      detail: {
        athleticPlausibility: athletic.value,
        athleticDelta: athletic.basis.delta,
        note: 'athletic plausibility alone cannot answer whether a programme would recruit this athlete',
        allBehaviouralSignalsNotApplicable: notApplicableOnly,
      },
    });
  }

  /**
   * Each known signal fills its own slice of the behavioural range. An
   * unknown one leaves its slice empty; nothing else expands into it.
   */
  const support = known.reduce((sum, s) => sum + (s.weight * s.result.value), 0);
  const value = athletic.value * (phi + ((1 - phi) * support));

  /**
   * Coverage is the behavioural weight that was actually measured, kept
   * SEPARATE from the value. Two programmes at R = 0.70 are distinguishable
   * by how much of the question was answered to get there.
   */
  const coverage = known.reduce((sum, s) => sum + s.weight, 0);
  const allMeasured = known.every((s) => s.result.grade === GRADE.MEASURED);

  return scoreable({
    value,
    grade: (athletic.grade === GRADE.MEASURED && allMeasured && coverage >= 1 - 1e-9)
      ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage,
    basis: {
      athleticPlausibility: athletic.value,
      athleticDelta: athletic.basis.delta,
      athleticBasis: athletic.basis,
      phi,
      weights: { ...weights },
      support,
      /** What the ceiling cost: the gap between full behavioural support and this. */
      ceilingLoss: (phi + (1 - phi)) - (phi + ((1 - phi) * support)),
      signals: signals.map((s) => ({
        key: s.key,
        weight: s.weight,
        state: isScoreable(s.result) ? s.result.grade
          : isNotApplicable(s.result) ? 'NOT_APPLICABLE' : 'UNSCOREABLE',
        value: isScoreable(s.result) ? s.result.value : null,
        reason: isScoreable(s.result) ? null : (s.result.reason ?? null),
      })),
      positional: isScoreable(positional) ? positional.basis : null,
      positionalState: isScoreable(positional) ? positional.grade : (positional.reason ?? 'UNKNOWN'),
      market: isScoreable(market) ? market.basis : null,
      marketState: isScoreable(market) ? market.grade
        : isNotApplicable(market) ? 'NOT_APPLICABLE' : (market.reason ?? 'UNKNOWN'),
      // Kept so every existing reader of `core` keeps working; it is the
      // behavioural support renormalised over what was measured, and it is
      // NOT what the value is built from.
      core: coverage > 0 ? support / coverage : 0,
    },
  });
}

/** The four states a recruitability refusal can carry, for report grouping. */
export const RECRUITABILITY_REFUSALS = Object.freeze([
  REASON.NO_ATHLETE_LEVEL,
  REASON.NO_PROGRAMME_LEVEL,
  REASON.NO_ROSTER_ON_FILE,
  REASON.NO_ELIGIBILITY_RULE,
  REASON.NO_CLASS_LABELS,
  REASON.BELOW_COVERAGE_FLOOR,
]);
