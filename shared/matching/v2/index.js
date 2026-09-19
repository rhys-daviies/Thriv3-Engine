/**
 * The public surface of Matchmaking V2.
 *
 * Nothing outside this directory imports a V2 module by path; it imports this.
 * The rule is enforced by importGraph.test.js, in both directions - V2 may not
 * reach into frozen V1 scoring, and the rest of the repository may not reach
 * into V2 until there is something to adopt.
 *
 * At A7.1 there is no scorer. What exists is the contract, the coverage
 * algebra and the ability calibration that every later layer is built on.
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
