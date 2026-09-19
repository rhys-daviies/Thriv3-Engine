/**
 * Athlete Opportunity / Fit: how attractive and useful is this opportunity to
 * THIS athlete?
 *
 *   1.0  a programme that shares the minutes at their position as widely as
 *        almost any, is improving, and matches every preference they stated.
 *   0.5  an ordinary opportunity: the minutes are shared about as widely as
 *        the typical programme at that position, the programme is holding
 *        steady, and nothing they told us points either way.
 *   0.0  approached where the minutes concentrate on a handful of players,
 *        the programme is falling away, and what they asked for is absent.
 *
 * It is not "would the coach have me" and not "can I pay for it". A programme
 * can be an excellent opportunity the athlete cannot reach, or a poor one
 * they could walk into, and the separation is structural: the scorer takes an
 * athlete, a college and a roster fact, and there is no argument through which
 * a recruitability or financial result could be passed in.
 *
 * -- VALUE AND PREFERENCE, SEPARATELY -------------------------------------
 *
 * Objective components are scored for everyone. Preference components are
 * scored only where the athlete declared something, and are NOT_APPLICABLE
 * otherwise - leaving the denominator rather than defaulting. Both subtotals
 * are reported, so a reader can see "a good opportunity, and we know nothing
 * about whether they want it" as distinct from "a good opportunity they asked
 * for".
 *
 * -- WHAT ATHLETE PRIORITIES MAY DO ---------------------------------------
 *
 * A stated priority ranking may move the WEIGHT of the one component it maps
 * onto, and nothing else. Two of the six V1 criteria survive into this layer;
 * `athletic` and `affordability` are refused by name, because a preference
 * that could reach Coach Recruitability would let an athlete's wishes change
 * whether a coach wants them.
 */
import { GRADE, scoreable, unscoreable, isScoreable, isNotApplicable } from '../types.js';
import { combine, component } from '../coverage.js';
import {
  VALUE_WEIGHTS, PREFERENCE_WEIGHTS, PRIORITY_MAP, PRIORITY_LIFT,
  FOREIGN_PRIORITIES, OPPORTUNITY_COVERAGE_FLOOR,
} from '../opportunityRules.js';

/**
 * Turn a stated ranking into weight multipliers, for the two components it is
 * allowed to touch.
 *
 * Throws on a priority belonging to another layer rather than ignoring it: a
 * silent drop is how a cross-layer leak survives a code review.
 */
export function priorityWeights(ranking, { lift = PRIORITY_LIFT } = {}) {
  if (!Array.isArray(ranking) || ranking.length === 0) return { multipliers: {}, applied: false, ranking: null };
  const multipliers = {};
  const ignored = [];
  ranking.forEach((key, index) => {
    if (key in FOREIGN_PRIORITIES) { ignored.push({ key, ownedBy: FOREIGN_PRIORITIES[key] }); return; }
    const target = PRIORITY_MAP[key];
    if (!target) { ignored.push({ key, ownedBy: 'no V2 Opportunity component' }); return; }
    // First in the list lifts, last in the list cuts, linear between.
    const position = ranking.length === 1 ? 0 : index / (ranking.length - 1);
    multipliers[target] = 1 + (lift * (1 - (2 * position)));
  });
  return { multipliers, applied: Object.keys(multipliers).length > 0, ranking: [...ranking], ignored };
}

/**
 * @param {object} p
 * @param {object} p.playing    result from playingOpportunity
 * @param {object} p.trajectory result from programmeTrajectory
 * @param {object} p.major      result from majorFit
 * @param {object} p.location   result from locationFit
 * @param {object} p.outcome    result from athleticOutcome
 * @param {Array|null} p.priorityRanking  the athlete's stated ordering
 */
export function athleteOpportunity({
  playing, trajectory, major, location, outcome,
  priorityRanking = null, floor = OPPORTUNITY_COVERAGE_FLOOR,
  valueWeights = VALUE_WEIGHTS, preferenceWeights = PREFERENCE_WEIGHTS, lift,
}) {
  const priorities = priorityWeights(priorityRanking, lift === undefined ? {} : { lift });
  const w = (key, base) => base * (priorities.multipliers[key] ?? 1);

  const components = [
    /**
     * REQUIRED. A win-rate change on its own is not an answer to whether an
     * opportunity is worth having, and a layer that scored a programme we hold
     * no minutes for would be describing the league, not the chance to play.
     */
    component('playingOpportunity', w('playingOpportunity', valueWeights.playingOpportunity), playing, { required: true }),
    component('programmeTrajectory', w('programmeTrajectory', valueWeights.programmeTrajectory), trajectory),
    component('majorFit', w('majorFit', preferenceWeights.majorFit), major),
    component('locationFit', w('locationFit', preferenceWeights.locationFit), location),
    component('athleticOutcome', w('athleticOutcome', preferenceWeights.athleticOutcome), outcome),
  ];

  const combined = combine(components, { floor });

  /**
   * The two subtotals, reported beside the single value rather than instead of
   * it. Absent here, a reader cannot tell a good opportunity nobody asked for
   * from a good opportunity somebody did.
   */
  const objective = [playing, trajectory].filter(isScoreable);
  const preference = [major, location, outcome];
  const declared = preference.filter((r) => !isNotApplicable(r));
  const scoredPreference = preference.filter(isScoreable);

  const summary = {
    objectiveScored: objective.length,
    objectiveValue: objective.length
      ? objective.reduce((s, r) => s + r.value, 0) / objective.length : null,
    preferencesDeclared: declared.length,
    preferenceValue: scoredPreference.length
      ? scoredPreference.reduce((s, r) => s + r.value, 0) / scoredPreference.length : null,
    // The honest headline when nothing was asked: we can describe the
    // opportunity and we cannot say whether this athlete wants it.
    preferenceKnown: declared.length > 0,
    notApplicable: [
      ...(isNotApplicable(major) ? ['majorFit'] : []),
      ...(isNotApplicable(location) ? ['locationFit'] : []),
      ...(isNotApplicable(outcome) ? ['athleticOutcome'] : []),
    ],
    priorities: {
      applied: priorities.applied,
      multipliers: priorities.multipliers,
      ignored: priorities.ignored ?? [],
      ranking: priorities.ranking,
    },
  };

  if (!isScoreable(combined)) {
    return unscoreable({
      reason: combined.reason,
      missing: [...combined.missing],
      available: [...combined.available],
      coverage: combined.coverage,
      detail: { ...summary, ...(combined.detail ?? {}) },
    });
  }

  return scoreable({
    value: combined.value,
    grade: combined.grade === GRADE.MEASURED ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage: combined.coverage,
    basis: {
      ...combined.basis,
      ...summary,
      playing: isScoreable(playing) ? playing.basis : null,
      trajectory: isScoreable(trajectory) ? trajectory.basis : null,
      major: isScoreable(major) ? major.basis : null,
      location: isScoreable(location) ? location.basis : null,
    },
  });
}
