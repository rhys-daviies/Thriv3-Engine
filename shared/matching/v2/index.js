/**
 * The public surface of Matchmaking V2.
 *
 * Nothing outside this directory imports a V2 module by path; it imports this.
 * The rule is enforced by importGraph.test.js, in both directions - V2 may not
 * reach into frozen V1 scoring, and the rest of the repository may not reach
 * into V2 until there is something to adopt.
 *
 * A7.1 built the contract, the coverage algebra and the ability calibration.
 * A7.2 added Financial Viability, A7.3 Coach Recruitability, A7.4 Athlete
 * Opportunity / Fit, and A7.5 the Pursuit Priority that combines them and the
 * ranked / limited-data pipeline. Nothing is adopted: V1 still serves every
 * recommendation, and the pipeline runs only from the diagnostic scripts.
 */
export {
  GRADE, REASON, RANKING_STATE,
  scoreable, unscoreable, notApplicable,
  isScoreable, isNotApplicable, isRankingState, assertResult,
  ContractError,
} from './types.js';

export { combine, component } from './coverage.js';

export {
  CALIBRATION_ID, CALIBRATION, CALIBRATED_SPORTS,
  abilityToPercentile, abilityToProgrammeScore, percentileOf,
  abilityLevel, abilityDelta, checkDistribution, dominantDivisions,
} from './calibration/abilityScale.js';

export { AID_POLICY_STATUS, aidAssumption, assertMayClaimNoAthleticAid } from './aidPolicy.js';

export {
  BUDGET_INTERVALS, LEGACY_BUDGET_INTERVALS, UNDECLARED_BUDGET, budgetInterval,
  CONTROL, ATHLETIC_AID_RULES, UNRULED_AID_DIVISIONS, NO_ATHLETIC_AID_CONFERENCES,
  CONTRIBUTION_ANCHOR, HALF_VIABILITY_RELATIVE_GAP,
} from './financialRules.js';

export {
  COST_BASIS, financialViability, applicableCost, fundingGap,
  viabilityFromRelativeGap, athleticAidRule,
} from './layers/financial.js';

export {
  POSITIONS, NORMS_ID, NORMS_DIGEST, NORMS,
  typicalStarters, typicalStartersEvidence, fillPropensity,
  PLAUSIBILITY_SLOPE, PLAUSIBILITY_MIDPOINT, CORE_FLOOR,
  ARRIVAL_CLAIM_WEIGHT, MAX_CLAIM_SHARE,
  CORE_WEIGHTS, RECRUITABILITY_COVERAGE_FLOOR,
} from './recruitingRules.js';

export { athleticPlausibility, plausibilityFromDelta } from './layers/athleticPlausibility.js';
export { positionalOpportunity } from './layers/positionalOpportunity.js';
export { internationalPropensity, INTERNATIONAL_SATURATION, MIN_ARRIVALS_FOR_PROGRAMME_RATE } from './layers/recruitingBehaviour.js';
export { coachRecruitability, RECRUITABILITY_REFUSALS } from './layers/recruitability.js';

export {
  PLAYING_NORMS_ID, PLAYING_NORMS_DIGEST, PLAYING_NORMS,
  playingShareFor, playingScale, TRAJECTORY_SATURATION,
  VALUE_WEIGHTS, PREFERENCE_WEIGHTS, PRIORITY_LIFT, PRIORITY_MAP,
  FOREIGN_PRIORITIES, OPPORTUNITY_COVERAGE_FLOOR,
} from './opportunityRules.js';

export {
  playingOpportunity, programmeTrajectory, majorFit, locationFit, athleticOutcome,
} from './layers/opportunityComponents.js';

export { athleteOpportunity, priorityWeights } from './layers/opportunity.js';

export { PURSUIT_WEIGHTS, PURSUIT_GATES, TOP_N, smoothstep, tailGate } from './pursuitRules.js';
export { pursuitPriority } from './layers/pursuit.js';
export { rankPool } from './pipeline.js';
