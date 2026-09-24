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
  COMPATIBILITY_AT_LEVEL, COMPATIBILITY_DECAY, COMPATIBILITY_RISE, CORE_FLOOR,
  ARRIVAL_CLAIM_WEIGHT, MAX_CLAIM_SHARE,
  CORE_WEIGHTS, RECRUITABILITY_COVERAGE_FLOOR,
  MARKET_MIN_ARRIVALS, MARKET_PSEUDO_COUNT, NEAR_BAND_KM, BEHAVIOUR_WEIGHTS,
} from './recruitingRules.js';

export { athleticPlausibility, plausibilityFromDelta } from './layers/athleticPlausibility.js';
export { positionalOpportunity } from './layers/positionalOpportunity.js';
/**
 * `internationalPropensity` is deliberately NOT re-exported: A7.7.4 replaced
 * it with Recruiting Market Match and nothing may wire it back into a score.
 * The constant is still shared, because market match's international arm uses
 * the same saturation point.
 */
export { INTERNATIONAL_SATURATION } from './layers/recruitingBehaviour.js';
export {
  recruitingMarket, shrinkToBaseline,
  internationalUtilisationCaveat, UTILISATION_CAVEAT,
} from './layers/recruitingMarket.js';
export { coachRecruitability, RECRUITABILITY_REFUSALS } from './layers/recruitability.js';

export {
  PLAYING_NORMS_ID, PLAYING_NORMS_DIGEST, PLAYING_NORMS,
  playingShareFor, playingScale, TRAJECTORY_SATURATION,
  VALUE_WEIGHTS, PREFERENCE_WEIGHTS, PRIORITY_LIFT, PRIORITY_MAP,
  FOREIGN_PRIORITIES, OPPORTUNITY_COVERAGE_FLOOR,
  COMPETITIVE_LEVEL_SPAN, AMBITION_LIFT,
} from './opportunityRules.js';

export {
  squadRotation, returningCompetition, playingPathway, returningPressure, competitionFromPressure, programmeTrajectory, majorFit, locationFit, athleticOutcome,
  academicStrengthFit,
} from './layers/opportunityComponents.js';

export { athleteOpportunity, priorityWeights, ambitionMultiplier } from './layers/opportunity.js';

export {
  UNDECLARED, PRIORITY_SCALE, PREFERENCE_FIELDS,
  readPriority, isDeclared, priorityStrength,
} from './athletePreferences.js';

export { PURSUIT_WEIGHTS, PURSUIT_GATES, TOP_N, WEIGHTING_ARCHITECTURE, smoothstep, tailGate } from './pursuitRules.js';
export { pursuitPriority } from './layers/pursuit.js';
export { rankPool } from './pipeline.js';

export {
  LAYER, POLARITY, BAND, REASON_CODE, EVIDENCE, LAYER_BANDS,
  bandFor, sampleStrength, ABSOLUTE, FORBIDDEN_LANGUAGE, PURSUIT_HAS_NO_BAND,
  COMPONENT_LABEL, LAYER_LABEL, REFUSAL_PHRASE,
  componentLabel, layerLabel, refusalPhrase,
} from './explain/vocabulary.js';
export { explainProgramme, strengths, concerns, unknowns } from './explain/explain.js';
export { explainMovement, largestMovers, MOVEMENT_CODE, MATERIAL_MOVE } from './explain/movement.js';
export {
  renderReason, renderGate, renderCheck, renderMovement, renderExplanation, CLIENT_UNSAFE,
} from './explain/render.js';

/**
 * A7.7 validation. NOT part of the model: a vocabulary, a sampler and a
 * packet format for putting V2 in front of a human before anything is adopted.
 * Nothing here is read by any scorer, and no model parameter may be fitted to
 * what it collects.
 */
export {
  CLASSIFICATION, CLASSIFICATION_ORDER, PURSUE_SET, classificationRank, isPursue,
  REASON_TAG, TAG_IMPLICATES, EXPLANATION_REVIEW,
  DISAGREEMENT, DISAGREEMENT_MEANING, VALIDATION_QUESTIONS,
  ADOPTION_BLOCKERS, TOLERABLE_DISAGREEMENT, assertReview,
  REASON_TAG_ORDER, normaliseReasonTag, normaliseReasonTags,
} from './validation/rubric.js';
export {
  REQUIRED_INPUTS, NOT_COLLECTED, PROFILES,
  buildValidationAthlete, preferenceProfileOf,
} from './validation/athleteInput.js';
export { STRATUM, stratifiedSample, blindKey } from './validation/sample.js';
export { PACK_FORMAT, buildPack, programmeFacts } from './validation/pack.js';
export { renderPack, renderViewA } from './validation/renderPack.js';
export { rowAgreement, kendallTauB, agreementFor, aggregateAgreement } from './validation/agreement.js';
