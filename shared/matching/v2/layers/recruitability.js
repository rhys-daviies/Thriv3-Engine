/**
 * Coach Recruitability: would this programme recruit this athlete?
 *
 *   1.0  the athlete is clearly at or above the level this programme signs,
 *        AND starting places at their position are opening that this
 *        programme's history says become a newcomer's.
 *   0.5  a plausible approach. Either at-level with modest opportunity, or a
 *        modest reach where the position is genuinely opening.
 *   0.0  approached as the athlete falls below the level the programme
 *        recruits at. No amount of roster need lifts it, because the ceiling
 *        multiplies rather than adds.
 *
 * INDEPENDENT OF, and unable to read: budget, financial viability, geography,
 * intended major, academics, and the athlete's own preferences. Programme
 * quality enters exactly once, as the programme's LEVEL inside athletic
 * plausibility, and never as prestige.
 *
 * -- THE COMBINATION --------------------------------------------------------
 *
 *   R = A x (phi + (1 - phi) x core)
 *
 * Three structures were considered.
 *
 *   min(A, core) makes whichever signal is larger completely irrelevant, so a
 *   change in the better-evidenced signal moves nothing until it crosses the
 *   other - a cliff exactly where the ranking is decided.
 *
 *   A gated-additive form inside recruitability rebuilds, one level down, the
 *   gating that pursuit priority already applies to recruitability as a whole,
 *   so the same demotion is applied twice.
 *
 *   The product is smooth and monotone in both arguments, makes A a genuine
 *   CEILING - core = 1 gives exactly A, and no core can exceed it - and gives
 *   phi a plain meaning: the share of plausibility that survives when nothing
 *   else favours the athlete. Chosen.
 *
 * Athletic ability enters ONCE, as A. It is not also a core component, not a
 * weight, and not a tie-break.
 */
import { GRADE, REASON, scoreable, unscoreable, isScoreable, isNotApplicable } from '../types.js';
import { combine, component } from '../coverage.js';
import { CORE_FLOOR, CORE_WEIGHTS, RECRUITABILITY_COVERAGE_FLOOR } from '../recruitingRules.js';

/**
 * @param {object} p
 * @param {object} p.athletic      result from athleticPlausibility
 * @param {object} p.positional    result from positionalOpportunity
 * @param {object} p.international result from internationalPropensity
 */
export function coachRecruitability({
  athletic, positional, international,
  phi = CORE_FLOOR, weights = CORE_WEIGHTS, floor = RECRUITABILITY_COVERAGE_FLOOR,
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

  const core = combine([
    component('positionalOpportunity', weights.positionalOpportunity, positional),
    component('internationalPropensity', weights.internationalPropensity, international),
  ], { floor });

  if (!isScoreable(core)) {
    /**
     * Athletic plausibility alone is NOT a recruitability score.
     *
     * This is the NJCAA case and it is the point of the whole layer. We hold
     * no roster and no arrivals for 228 men's junior colleges, so we can say
     * an athlete is plainly good enough for them and nothing whatever about
     * whether they would take one. V1 answered anyway, on a neutral prior, and
     * gave a developmental athlete 17 of the top 100 on the strength of it.
     */
    return unscoreable({
      reason: core.reason,
      missing: [...core.missing],
      available: ['athleticPlausibility', ...core.available],
      coverage: core.coverage,
      detail: {
        athleticPlausibility: athletic.value,
        athleticDelta: athletic.basis.delta,
        note: 'athletic plausibility alone cannot answer whether a programme would recruit this athlete',
        ...(core.detail ?? {}),
      },
    });
  }

  const value = athletic.value * (phi + ((1 - phi) * core.value));

  return scoreable({
    value,
    grade: (athletic.grade === GRADE.MEASURED && core.grade === GRADE.MEASURED)
      ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage: core.coverage,
    basis: {
      athleticPlausibility: athletic.value,
      athleticDelta: athletic.basis.delta,
      athleticBasis: athletic.basis,
      core: core.value,
      coreBasis: core.basis,
      phi,
      // What the ceiling actually cost. The difference between a programme
      // that wants the athlete and one that would merely have room.
      ceilingLoss: (phi + ((1 - phi) * core.value)) - value,
      positional: isScoreable(positional) ? positional.basis : null,
      international: isScoreable(international) ? international.basis : null,
      internationalApplicable: !isNotApplicable(international),
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
