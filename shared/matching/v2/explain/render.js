/**
 * Operator prose.
 *
 * A RENDERING, not the contract. Every sentence here is generated from a code
 * and its evidence, and the structured object remains the thing tests assert
 * against - so this file can be rewritten in another register, or into another
 * language, without a single assertion about the model changing.
 *
 * OPERATOR REGISTER. These sentences assume a reader who knows what coverage,
 * a gate and a denominator are. See CLIENT_UNSAFE below for what must not
 * simply be forwarded to a family.
 */
import {
  REASON_CODE, LAYER, FORBIDDEN_LANGUAGE,
  componentLabel, layerLabel, refusalPhrase,
} from './vocabulary.js';
import { MOVEMENT_CODE } from './movement.js';

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
/**
 * A budget band whose top is open renders as "$40,000 or more", not
 * "$40,000-$Infinity". The top band states a floor and no ceiling, and the
 * first render of it printed a currency symbol in front of infinity.
 */
const range = ([lo, hi]) => {
  if (!Number.isFinite(hi)) return `${money(lo)} or more`;
  return lo === hi ? money(lo) : `${money(lo)}-${money(hi)}`;
};
const pct = (n) => `${Math.round(n * 100)}%`;
const pts = (n) => `${Math.round(n * 100)} percentile points`;

/** How a RATE's denominator reads: how many comparable cases stand behind it. */
const SAMPLE = {
  NONE: 'with no history on file',
  ANECDOTAL: 'though on very few comparable cases',
  LIMITED: 'across a limited history',
  SUBSTANTIAL: 'across a substantial history',
  EXTENSIVE: 'across an extensive history',
};

/**
 * How a PROGRAMME-OWN measurement's denominator reads.
 *
 * Separate wording, because the quantity is different: a playing share rests
 * on that programme's own seasons, of which there are at most four on file,
 * and "very few comparable cases" wrongly suggests we looked for comparable
 * programmes and found almost none.
 */
const SEASONS = {
  NONE: 'with no seasons on file',
  ANECDOTAL: 'from only its own recent seasons',
  LIMITED: 'from its own recent seasons',
  SUBSTANTIAL: 'across many seasons',
  EXTENSIVE: 'across many seasons',
};

const SENTENCE = {
  [REASON_CODE.POOL_MOSTLY_OUT_OF_REACH]: (e) =>
    `Across this athlete's whole pool the typical pursuit priority is only ${e.poolMedianPriority} — most programmes here are out of reach, so rank says more about the shortlist than about any one school.`,
  [REASON_CODE.ABSOLUTE_PRIORITY_LOW]: (e) =>
    `Ranked ${e.rank === null ? '—' : `#${e.rank}`}, but the absolute pursuit priority is low (${e.priority}). This is among the least unreachable options rather than a strong one.`,
  [REASON_CODE.ABSOLUTE_PRIORITY_MODEST]: (e) =>
    `Ranked ${e.rank === null ? '—' : `#${e.rank}`} with a modest absolute priority (${e.priority}) — worth an approach, not a leading one.`,

  [REASON_CODE.ATHLETIC_AT_OR_ABOVE_LEVEL]: (e) =>
    `The athlete's assessed level sits at or above this programme's, so they are within the standard it recruits at.`,
  [REASON_CODE.ATHLETIC_MODEST_REACH]: (e) =>
    `A modest reach: the programme sits about ${pts(e.levelGap)} above the athlete's assessed level.`,
  [REASON_CODE.ATHLETIC_SUBSTANTIAL_REACH]: (e) =>
    `A substantial reach: the programme sits about ${pts(e.levelGap)} above the athlete's assessed level.`,
  [REASON_CODE.ATHLETIC_BEYOND_RANGE]: (e) =>
    `Well beyond the athlete's assessed range — about ${pts(e.levelGap)} above it — which is what holds this back.`,
  [REASON_CODE.POSITION_OPENING_MEASURED]: (e) =>
    `Roster evidence shows ${e.vacatedStarters} starting ${e.position.toLowerCase()} place${e.vacatedStarters === 1 ? '' : 's'} opening for the entry year, against ${e.typicalStarters} typically held.`,
  [REASON_CODE.POSITION_NO_OPENING_MEASURED]: (e) =>
    `Roster evidence shows no starting ${e.position.toLowerCase()} place opening for the entry year.`,
  [REASON_CODE.POSITION_FILL_HISTORY]: (e) =>
    `When a place like this opens, a newcomer has taken it ${pct(e.rate)} of the time (${e.hits} of ${e.trials}, ${e.level} level), ${SAMPLE[e.strength]}.`,
  [REASON_CODE.POSITION_ARRIVALS_COMMITTED]: (e) =>
    `${e.arrivals} recruit${e.arrivals === 1 ? ' has' : 's have'} already arrived at this position for the entry class, which reduces the remaining room${e.capped ? ' (capped, so it demotes rather than removes)' : ''}.`,
  [REASON_CODE.POSITION_ARRIVALS_NOT_YET_KNOWN]: (e) =>
    `Recruiting for this entry year has not been recorded yet — arrivals data runs to ${e.horizon} — so committed recruits are unknown rather than absent.`,
  [REASON_CODE.INTERNATIONAL_HISTORY]: (e) =>
    `${pct(e.share)} of this programme's recorded arrivals came from overseas (${e.count} of ${e.total}, ${e.level} level), ${SAMPLE[e.strength]}.`,
  [REASON_CODE.INTERNATIONAL_NO_HISTORY]: (e) =>
    `No overseas arrivals are recorded for this programme (0 of ${e.total}), which makes an international approach harder.`,

  [REASON_CODE.COST_WITHIN_BUDGET]: (e) =>
    `The applicable cost of ${range(e.cost)} sits inside the stated budget of ${range(e.budget)}.`,
  [REASON_CODE.FUNDING_GAP]: (e) =>
    `A funding gap of ${range(e.gap)} remains after the stated budget of ${range(e.budget)} against a cost of ${range(e.cost)}.`,
  [REASON_CODE.RESIDENCY_IN_STATE]: () => `Priced at the in-state rate.`,
  [REASON_CODE.RESIDENCY_OUT_OF_STATE]: (e) =>
    `Priced as a non-resident${e.international ? ' (international athletes are non-residents everywhere)' : ''}, adding roughly ${money(e.premium)}.`,
  [REASON_CODE.RESIDENCY_UNKNOWN]: (e) =>
    `No home state is on file, so the cost could be anywhere in ${range(e.cost)} depending on residency.`,
  [REASON_CODE.AID_KNOWN_NONE]: (e) =>
    `${e.rule} does not permit athletic scholarships, so any award here would be need-based or academic.`,
  [REASON_CODE.AID_PERMITTED_AMOUNT_UNKNOWN]: (e) =>
    `Athletic aid is permitted under ${e.rule}, but Thriv3 holds no evidence of what this athlete would be offered.`,
  [REASON_CODE.AID_POLICY_UNKNOWN]: () =>
    `Thriv3 has no verified athletic-aid rule for this programme. That is not the same as knowing there is none.`,
  [REASON_CODE.INTERNATIONAL_COST_UNDERSTATED]: () =>
    `Net price is measured on domestically aided students, so the real cost to an international athlete is higher by an unknown amount.`,

  [REASON_CODE.PLAYING_SHARE_WIDE]: (e) =>
    `This programme spreads its minutes at the position more widely than the typical one (${e.share} against a median of ${e.median}), measured ${e.level === 'programme' ? SEASONS[e.strength] : `at ${e.level} level`}.`,
  [REASON_CODE.PLAYING_SHARE_NARROW]: (e) =>
    `Minutes at this position are concentrated on fewer players than typical (${e.share} against a median of ${e.median}), measured ${e.level === 'programme' ? SEASONS[e.strength] : `at ${e.level} level`}.`,
  [REASON_CODE.TRAJECTORY_IMPROVING]: (e) =>
    `The programme's win rate has risen from ${pct(e.prior)} to ${pct(e.recent)}.`,
  [REASON_CODE.TRAJECTORY_DECLINING]: (e) =>
    `The programme's win rate has fallen from ${pct(e.prior)} to ${pct(e.recent)}.`,
  [REASON_CODE.MAJOR_OFFERED]: (e) => `Offers ${e.family}, which covers the stated intended major.`,
  [REASON_CODE.MAJOR_NOT_OFFERED]: (e) => `${e.family} is not among this institution's notable majors.`,
  [REASON_CODE.LEVEL_PREFERENCE_MET]: () =>
    `The athlete marked competitive level as a priority, and this programme is at or above the standard they are aiming at.`,
  [REASON_CODE.LEVEL_PREFERENCE_BELOW]: (e) =>
    `The athlete marked competitive level as a priority, and this programme sits about ${pts(e.levelGapBelow)} below the standard they are aiming at.`,
  [REASON_CODE.PLAYING_PREFERENCE_WEIGHTED]: () =>
    `Early playing time is a stated priority, so the minutes evidence carries more weight here.`,
  [REASON_CODE.LOCATION_NOT_COLLECTED]: () =>
    `No location preference has been collected, so geography is not scored either way.`,

  /**
   * Named, not enumerated. `positionalOpportunity` and `playingOpportunity`
   * are different quantities owned by different layers, and printing both by
   * their identifiers put an apparent contradiction on the page.
   */
  [REASON_CODE.LAYER_UNSCOREABLE]: (e) => {
    const missing = (e.missing ?? []).map(componentLabel);
    const why = refusalPhrase(e.reason);
    const what = missing.length ? `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing` : 'the evidence is missing';
    return `${layerLabel(e.layer)} could not be scored — ${what}${why ? `, and ${why}` : ''}.`;
  },
  [REASON_CODE.LIMITED_DATA_MISSING_LAYERS]: (e) =>
    `Insufficient evidence to rank: ${(e.missing ?? []).map(layerLabel).join(' and ')} could not be scored${(e.available ?? []).length ? `, though ${e.available.map(layerLabel).join(' and ')} could be` : ''}.`,
  [REASON_CODE.INELIGIBLE_RULE]: (e) =>
    `Excluded by a rule${e.rule ? `: ${e.rule}` : ''}. This is not a judgement about the programme.`,
  [REASON_CODE.SUPPRESSED_BY_OPERATOR]: () =>
    `Removed by an operator decision. Thriv3 has not scored it against this athlete.`,
};

const GATE_SENTENCE = {
  [REASON_CODE.GATE_RECRUITABILITY]: (g) =>
    `This would otherwise rank higher: the coach-recruitability evidence is weak enough to reduce its priority by ${g.loss} (${pct(g.lossShare)}). It remains on the list.`,
  [REASON_CODE.GATE_FINANCIAL]: (g) =>
    `Still worth considering, but the funding position reduces its priority by ${g.loss} (${pct(g.lossShare)}). It is demoted, not removed.`,
};

const CHECK_SENTENCE = {
  VERIFY_AID_POLICY: 'Verify this programme\'s athletic-aid rule.',
  ASK_COACH_AID_AVAILABILITY: 'Ask the coach what aid is realistically available for this class.',
  CONFIRM_ATHLETE_HOME_STATE: 'Confirm the athlete\'s home state so residency pricing can be applied.',
  CONFIRM_INTERNATIONAL_COST: 'Confirm the total cost quoted to international students.',
  CHECK_COMMITTED_RECRUITS: 'Check whether the programme has already committed recruits at this position.',
  VERIFY_DEPARTURES_AT_POSITION: 'Verify the departures at this position against the current roster.',
  COLLECT_LOCATION_PREFERENCE: 'Ask the athlete whether location matters to them.',
  VERIFY_ROSTER_CLASS_YEARS: 'Verify class years on this roster — part of it could not be read.',
  OBTAIN_ROSTER_AND_ELIGIBILITY: 'Obtain a current roster with class years, and an eligibility rule for this association.',
  OBTAIN_MINUTES_HISTORY: 'Obtain minutes history for this programme.',
  OBTAIN_COST_DATA: 'Obtain cost data for this institution.',
};

const MOVEMENT_SENTENCE = {
  [MOVEMENT_CODE.ATTRIB_RECRUITABLE]: () => 'the athlete is realistically recruitable here',
  [MOVEMENT_CODE.ATTRIB_POSITION_OPENING]: (e) => `a measured opening at ${e.position.toLowerCase()}`,
  [MOVEMENT_CODE.ATTRIB_PLAYING_PATHWAY]: () => 'a wide playing pathway',
  [MOVEMENT_CODE.ATTRIB_AFFORDABLE]: () => 'the cost sits inside the stated budget',
  [MOVEMENT_CODE.ATTRIB_LEVEL_PREFERENCE]: () => 'it meets the competitive level the athlete asked for',
  [MOVEMENT_CODE.ATTRIB_ATHLETIC_REACH]: (e) => `the athlete is about ${pts(e.levelGap)} below its level`,
  [MOVEMENT_CODE.ATTRIB_RECRUITABILITY_GATE]: (e) => `weak recruitability evidence cost it ${Number(e.loss).toFixed(3)}`,
  [MOVEMENT_CODE.ATTRIB_FINANCIAL_GATE]: (e) => `the funding position cost it ${Number(e.loss).toFixed(3)}`,
  [MOVEMENT_CODE.ATTRIB_NO_OPENING]: (e) => `no starting place opening at ${e.position.toLowerCase()}`,
  [MOVEMENT_CODE.ATTRIB_EVIDENCE_WITHHELD]: (e) =>
    `Thriv3 will not score ${(e.missing ?? []).join(' or ')} without evidence, where V1 filled the gap with an assumption`,
};

export function renderReason(reason) {
  const fn = SENTENCE[reason.code];
  return fn ? fn(reason.evidence ?? {}) : null;
}

export function renderGate(gate) {
  const fn = GATE_SENTENCE[gate.code];
  return fn ? fn(gate) : null;
}

export function renderCheck(check) {
  return CHECK_SENTENCE[check.code] ?? null;
}

export function renderMovement(movement) {
  const parts = movement.attributions.map((a) => {
    const fn = MOVEMENT_SENTENCE[a.code];
    return fn ? fn(a.evidence ?? {}) : null;
  }).filter(Boolean);
  if (movement.direction === MOVEMENT_CODE.NOW_LIMITED_DATA) {
    return `No longer ranked${movement.v1Rank ? ` (V1 #${movement.v1Rank})` : ''}: ${parts.join('; ')}.`;
  }
  if (movement.direction === MOVEMENT_CODE.NEW_TO_LIST) return 'New to the ranked list.';
  if (movement.direction === MOVEMENT_CODE.HELD) return `Broadly unchanged (V1 #${movement.v1Rank} → V2 #${movement.v2Rank}).`;
  const verb = movement.direction === MOVEMENT_CODE.ROSE ? 'Rose' : 'Fell';
  return `${verb} from V1 #${movement.v1Rank} to V2 #${movement.v2Rank}${parts.length ? `: ${parts.join('; ')}` : ''}.`;
}

/** The whole explanation, as an operator would read it. */
export function renderExplanation(explanation) {
  const lines = explanation.reasons.map(renderReason).filter(Boolean);
  const gates = explanation.gateEffects.map(renderGate).filter(Boolean);
  const checks = explanation.nextChecks.map(renderCheck).filter(Boolean);
  return { lines, gates, checks };
}

/**
 * Fields and phrasings that must NOT be forwarded to a family unchanged.
 *
 * Not because they are wrong - they are the most precise things here - but
 * because they are written for a reader who knows what they mean. A gate loss
 * of 0.147 is an instruction to an operator and a bewilderment to a parent;
 * "no verified athletic-aid rule" sounds like a warning about the school
 * rather than about our own records; and a rank presented without the
 * absolute-strength caveat is exactly the misreading this module exists to
 * prevent. A7.6 builds the operator register only.
 */
export const CLIENT_UNSAFE = Object.freeze({
  fields: ['gateEffects', 'evidenceQuality', 'standing.poolMedianPriority', 'standing.priority', 'layerSummary.weights'],
  codes: [REASON_CODE.AID_POLICY_UNKNOWN, REASON_CODE.ABSOLUTE_PRIORITY_LOW, REASON_CODE.POOL_MOSTLY_OUT_OF_REACH],
  reason: 'These are model-internal or need framing a family has not been given. A client register must be designed, not derived by deletion.',
});

export { FORBIDDEN_LANGUAGE, LAYER, componentLabel, layerLabel, refusalPhrase };
