/**
 * The controlled vocabulary explanations are built from.
 *
 * CODES ARE CANONICAL, PROSE IS A RENDERING. Everything here is a code plus
 * the evidence that justified it; render.js turns codes into sentences and is
 * replaceable without touching a single test of what the model found.
 */

/** Which layer a reason belongs to. Every reason carries one, and it is enforced. */
export const LAYER = Object.freeze({
  RECRUITABILITY: 'recruitability',
  FINANCIAL: 'financial',
  OPPORTUNITY: 'opportunity',
  PURSUIT: 'pursuit',
  PIPELINE: 'pipeline',
});

export const POLARITY = Object.freeze({
  STRENGTH: 'strength',
  CONCERN: 'concern',
  UNKNOWN: 'unknown',
  CONTEXT: 'context',
});

/**
 * Where a reason sits in the ordering.
 *
 * ABSOLUTE_CONTEXT comes FIRST, before constraints, and that is a change from
 * the proposed order. When almost every programme in the pool is out of reach,
 * that fact reframes everything printed below it - a reader who meets "ranked
 * eighteenth" before "and almost nothing here is reachable" has already formed
 * the wrong impression.
 */
export const BAND = Object.freeze({
  ABSOLUTE_CONTEXT: 0,
  MAJOR_CONSTRAINT: 1,
  STRONGEST_POSITIVE: 2,
  PREFERENCE_EFFECT: 3,
  SECONDARY_EVIDENCE: 4,
  UNKNOWN: 5,
});

export const REASON_CODE = Object.freeze({
  // Standing and absolute strength
  ABSOLUTE_PRIORITY_LOW: 'ABSOLUTE_PRIORITY_LOW',
  ABSOLUTE_PRIORITY_MODEST: 'ABSOLUTE_PRIORITY_MODEST',
  POOL_MOSTLY_OUT_OF_REACH: 'POOL_MOSTLY_OUT_OF_REACH',

  // Recruitability
  ATHLETIC_AT_OR_ABOVE_LEVEL: 'ATHLETIC_AT_OR_ABOVE_LEVEL',
  ATHLETIC_MODEST_REACH: 'ATHLETIC_MODEST_REACH',
  ATHLETIC_SUBSTANTIAL_REACH: 'ATHLETIC_SUBSTANTIAL_REACH',
  ATHLETIC_BEYOND_RANGE: 'ATHLETIC_BEYOND_RANGE',
  POSITION_OPENING_MEASURED: 'POSITION_OPENING_MEASURED',
  POSITION_NO_OPENING_MEASURED: 'POSITION_NO_OPENING_MEASURED',
  POSITION_FILL_HISTORY: 'POSITION_FILL_HISTORY',
  POSITION_ARRIVALS_COMMITTED: 'POSITION_ARRIVALS_COMMITTED',
  POSITION_ARRIVALS_NOT_YET_KNOWN: 'POSITION_ARRIVALS_NOT_YET_KNOWN',
  INTERNATIONAL_HISTORY: 'INTERNATIONAL_HISTORY',
  INTERNATIONAL_NO_HISTORY: 'INTERNATIONAL_NO_HISTORY',

  // Financial
  COST_WITHIN_BUDGET: 'COST_WITHIN_BUDGET',
  FUNDING_GAP: 'FUNDING_GAP',
  RESIDENCY_IN_STATE: 'RESIDENCY_IN_STATE',
  RESIDENCY_OUT_OF_STATE: 'RESIDENCY_OUT_OF_STATE',
  RESIDENCY_UNKNOWN: 'RESIDENCY_UNKNOWN',
  AID_KNOWN_NONE: 'AID_KNOWN_NONE',
  AID_PERMITTED_AMOUNT_UNKNOWN: 'AID_PERMITTED_AMOUNT_UNKNOWN',
  AID_POLICY_UNKNOWN: 'AID_POLICY_UNKNOWN',
  INTERNATIONAL_COST_UNDERSTATED: 'INTERNATIONAL_COST_UNDERSTATED',

  // Opportunity
  PLAYING_SHARE_WIDE: 'PLAYING_SHARE_WIDE',
  PLAYING_SHARE_NARROW: 'PLAYING_SHARE_NARROW',
  TRAJECTORY_IMPROVING: 'TRAJECTORY_IMPROVING',
  TRAJECTORY_DECLINING: 'TRAJECTORY_DECLINING',
  MAJOR_OFFERED: 'MAJOR_OFFERED',
  MAJOR_NOT_OFFERED: 'MAJOR_NOT_OFFERED',
  LEVEL_PREFERENCE_MET: 'LEVEL_PREFERENCE_MET',
  LEVEL_PREFERENCE_BELOW: 'LEVEL_PREFERENCE_BELOW',
  PLAYING_PREFERENCE_WEIGHTED: 'PLAYING_PREFERENCE_WEIGHTED',
  LOCATION_NOT_COLLECTED: 'LOCATION_NOT_COLLECTED',

  // Gates
  GATE_RECRUITABILITY: 'GATE_RECRUITABILITY',
  GATE_FINANCIAL: 'GATE_FINANCIAL',

  // Pipeline states
  LIMITED_DATA_MISSING_LAYERS: 'LIMITED_DATA_MISSING_LAYERS',
  /**
   * A LAYER that could not be scored, as distinct from the RANKING that could
   * not be produced. Both were LIMITED_DATA_MISSING_LAYERS at first and a
   * limited-data programme then said "insufficient evidence to rank" twice -
   * once about itself and once about one of its components.
   */
  LAYER_UNSCOREABLE: 'LAYER_UNSCOREABLE',
  LIMITED_DATA_AVAILABLE: 'LIMITED_DATA_AVAILABLE',
  INELIGIBLE_RULE: 'INELIGIBLE_RULE',
  SUPPRESSED_BY_OPERATOR: 'SUPPRESSED_BY_OPERATOR',
});

/**
 * Evidence quality, in the language an operator reads.
 *
 * The prose is deliberately vaguer than the data. The structured explanation
 * keeps the exact denominator - 413 of 815 openings, 108 programme-seasons -
 * and the sentence says "across 815 comparable openings", so a reader who
 * wants the number has it and a reader who does not is not drowned in it.
 */
export const EVIDENCE = Object.freeze({
  MEASURED: 'MEASURED',
  PARTIAL: 'PARTIAL',
  UNSCOREABLE: 'UNSCOREABLE',
});

/**
 * How much history sits behind a rate.
 *
 * Derived from the denominator rather than from the grade, because a rate of
 * 1-from-1 and a rate of 413-from-815 are both MEASURED and must not sound
 * alike. HEURISTIC thresholds.
 */
export function sampleStrength(trials) {
  if (!Number.isFinite(trials) || trials <= 0) return 'NONE';
  if (trials < 10) return 'ANECDOTAL';
  if (trials < 50) return 'LIMITED';
  if (trials < 300) return 'SUBSTANTIAL';
  return 'EXTENSIVE';
}

/**
 * Qualitative bands for the three layers, anchored on SEMANTICS rather than on
 * five equal fifths.
 *
 * Recruitability: 0.25 is the gate threshold - the point below which the model
 *   says the case collapses. 0.35 is phi, what an at-level athlete with no
 *   opening retains.
 * Financial: 0.30 is the gate floor and 0.50 is where the layer itself says a
 *   family must find half their stated contribution again.
 * Opportunity: 0.35 is the coverage floor; 0.5 is the measured midpoint of a
 *   programme sharing its minutes typically.
 *
 * HEURISTIC above those anchors.
 */
export const LAYER_BANDS = Object.freeze({
  recruitability: [[0.60, 'STRONG'], [0.40, 'GOOD'], [0.25, 'MIXED'], [0.10, 'WEAK'], [0, 'VERY_WEAK']],
  financial: [[0.85, 'STRONG'], [0.60, 'GOOD'], [0.50, 'MIXED'], [0.30, 'WEAK'], [0, 'VERY_WEAK']],
  opportunity: [[0.70, 'STRONG'], [0.50, 'GOOD'], [0.35, 'MIXED'], [0.20, 'WEAK'], [0, 'VERY_WEAK']],
});

export function bandFor(layer, value) {
  const bands = LAYER_BANDS[layer];
  if (!bands || !Number.isFinite(value)) return null;
  for (const [floor, label] of bands) if (value >= floor) return label;
  return bands[bands.length - 1][1];
}

/**
 * Pursuit Priority gets NO qualitative band, deliberately.
 *
 * A band would claim an absolute meaning the number does not have across
 * athletes: 0.55 is an ordinary programme for a strong recruit and unreachable
 * for a developmental one, and for that second athlete two thirds of the pool
 * legitimately sits below 0.05. Labelling those "very weak" would describe the
 * athlete, not the programme. What is reported instead is the rank, the raw
 * value, where it sits in this athlete's own pool, and - when the whole pool is
 * out of reach - a warning that says so.
 */
export const PURSUIT_HAS_NO_BAND = true;

/**
 * Absolute-strength thresholds.
 *
 * HEURISTIC. Below LOW a programme is barely worth an approach whatever its
 * rank; a pool whose median sits below POOL_LOW is one where rank is nearly
 * meaningless on its own.
 */
export const ABSOLUTE = Object.freeze({ LOW: 0.10, MODEST: 0.25, POOL_LOW_MEDIAN: 0.10 });

/**
 * Words an explanation may never contain.
 *
 * Probability language because the scores are not probabilities; causal claims
 * about what a coach needs or wants because nothing measured establishes them;
 * and any promise of money, because no per-athlete award evidence exists
 * anywhere in this system.
 */
export const FORBIDDEN_LANGUAGE = Object.freeze([
  'probability', 'chance of', '% chance', 'likely to be offered', 'guaranteed',
  'will receive', 'will offer', 'expect a scholarship', 'the coach needs',
  'the coach wants', 'you are good enough', 'odds of',
]);
