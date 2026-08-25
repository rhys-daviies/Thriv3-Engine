/**
 * Shared plumbing for the two places an athlete's priorities can be ranked:
 * the intake form (moveable tokens) and the matching tab (a detailed list).
 *
 * The two look nothing alike on purpose — one is a quick pass while building a
 * player file, the other is a considered adjustment with weights and coupling
 * notes in view. Only the presentation differs; ordering, labels and the
 * weight arithmetic all live here so they cannot drift apart.
 */

import { CRITERIA, CRITERION_KEYS, resolveWeights } from '@shared/matching/weights.js';

/** The criterion in the language an operator sitting with a family would use. */
export const CRITERION_BLURB = {
  athletic: 'Whether the squad is the right standard — and whether they would play.',
  roster: 'Whether a place opens at their position the year they would arrive.',
  academic: 'How strong the academics are, and whether they would get in.',
  affordability: 'What the family would pay after a realistic scholarship offer.',
  programQuality: 'How good the program is, and whether it is rising or falling.',
  geography: 'How far from home, and whether in-state rates apply.',
};

/** Two or three words, for a token that has to stay narrow. */
export const CRITERION_SHORT = {
  athletic: 'Playing level',
  roster: 'Spot opening',
  academic: 'Academics',
  affordability: 'Cost',
  programQuality: 'Program strength',
  geography: 'Near home',
};

export const CRITERION_LABEL = Object.fromEntries(CRITERIA.map((c) => [c.key, c.label]));

/**
 * The location criterion means two different things, so it cannot have one
 * label.
 *
 * For a domestic athlete it is distance from home and in-state tuition. For an
 * international one distance is meaningless — everywhere is far — and it
 * measures instead whether the programme recruits internationally at all and
 * whether their countrymen are already there. Showing "Near home" to an
 * overseas athlete describes something the model is not doing, and an operator
 * ranking it would be ranking the wrong thing.
 */
export function criterionCopy(origin) {
  if (origin !== 'International') return { short: CRITERION_SHORT, blurb: CRITERION_BLURB, label: CRITERION_LABEL };
  return {
    short: { ...CRITERION_SHORT, geography: 'International fit' },
    blurb: {
      ...CRITERION_BLURB,
      geography: 'Whether the program already recruits overseas, and whether players from their country are there.',
    },
    label: { ...CRITERION_LABEL, geography: 'International fit' },
  };
}

/**
 * A stored ranking, or null.
 *
 * Accepts the array the entity layer returns and the JSON string it is stored
 * as, because both reach the UI depending on the route. A ranking that no
 * longer covers every criterion we score is discarded rather than partially
 * applied — weighting whatever happened to survive is worse than falling back
 * to the defaults.
 */
export function readRanking(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(parsed) || parsed.length !== CRITERION_KEYS.length) return null;
  if (!CRITERION_KEYS.every((k) => parsed.includes(k))) return null;
  return parsed;
}

/** Order the criteria by the weight they currently carry, best first. */
export function rankingFromWeights(weights) {
  return [...CRITERION_KEYS].sort((a, b) => (weights[b] || 0) - (weights[a] || 0));
}

/** Where an athlete's priorities sit before anybody ranks them explicitly. */
export function defaultRanking(academicImportance) {
  return rankingFromWeights(resolveWeights({ academicImportance }));
}

/** Reorder, returning the original list unchanged for an out-of-range move. */
export function moveItem(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Which criteria a coupling pushed above the weight their rank alone would
 * give them.
 *
 * Needed because a coupling can leave the list looking wrong: rank a criterion
 * second and a coupling can still put the third above it. That is correct —
 * the athlete's circumstances really did outrank their stated order — but an
 * ordered list whose numbers disagree with its percentages reads as a bug
 * unless the boosted rows say so themselves.
 */
export function boostedCriteria({ academicImportance, ranking, couplings }) {
  const withCouplings = resolveWeights({ academicImportance, ranking, couplings });
  const without = resolveWeights({ academicImportance, ranking });
  // A shared normaliser means raising one weight lowers every other share, so
  // compare against a tolerance rather than testing for any increase at all.
  return new Set(CRITERION_KEYS.filter((k) => withCouplings[k] > without[k] + 0.005));
}

export { CRITERIA, CRITERION_KEYS, resolveWeights };
