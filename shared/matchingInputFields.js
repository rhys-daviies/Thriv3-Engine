/**
 * THE ATHLETE FIELDS MATCHING READS — one list, shared.
 *
 * `server/lib/v2/matchmakingRuns.js` snapshots exactly these into every run to
 * decide when a run is outdated. Phase 5 (#5) also uses them in the browser to
 * decide whether a profile save changes anything matching reads: an edit to
 * the representative, the bio or a contact window does not, and must not wipe
 * the previous engine's analysis as if it did. One list, so the two can never
 * disagree about what "a matching input" is.
 */

/** Scalar inputs (Matcher V2 and the previous engine). */
export const MATCHING_INPUT_FIELDS_V1 = Object.freeze([
  'sport',
  'football_ability',
  'position',
  'recruiting_class_year',
  'budget_range',
  'contribution_state',
  'max_annual_contribution_usd',
  'state',
  'origin',
  'nationality',
  'gpa',
  'sat_score',
  'act_score',
  'academic_minimum',
  'intended_major',
  'competitive_level_priority',
  'playing_opportunity_priority',
  'academic_strength_priority',
  'criterion_ranking',
  'recruit_type',
]);

/**
 * Lists whose ORDER means nothing. Snapshotted sorted, and an empty list as
 * NULL, so ticking two regions in a different order - or an entity layer that
 * writes '[]' where the column held NULL - is not reported as the operator
 * having changed the athlete.
 */
export const MATCHING_UNORDERED_LIST_FIELDS = Object.freeze([
  'preferred_states', 'preferred_regions', 'preferred_divisions', 'preferred_conferences', 'preferred_institution_types',
]);

/**
 * PHASE 5 (#5 check): THE PREVIOUS ENGINE READS A DIFFERENT SET.
 *
 * Its analysis is invalidated by its OWN inputs, not by Matcher V2's. These are
 * exactly the fields `normaliseAthlete` (shared/matching/pool.js) and
 * `analyze` (src/lib/playerAnalysis.js) read, and a test pins the list to what
 * `normaliseAthlete` actually touches. Differences from V2, both directions:
 *
 *   V1 only   match_weights                     (its criterion weights)
 *   V2 only   intended_major, the three *_priority fields, recruit_type,
 *             preferred_states / _regions / _institution_types
 *   carried, not scored by V1: contribution_state, max_annual_contribution_usd
 *             (normaliseAthlete passes them through for V2 Financial; V1
 *             scores affordability from budget_range alone - so changing them
 *             does not make a V1 analysis wrong)
 */
export const PREVIOUS_ENGINE_INPUT_FIELDS = Object.freeze([
  'sport', 'football_ability', 'position', 'recruiting_class_year',
  'gpa', 'sat_score', 'act_score', 'budget_range', 'state', 'academic_minimum',
  'origin', 'nationality', 'preferred_divisions', 'preferred_conferences',
  'match_weights', 'criterion_ranking',
]);

/** Read by normaliseAthlete but never scored by the previous engine (see above). */
export const PREVIOUS_ENGINE_CARRIED_ONLY = Object.freeze(['contribution_state', 'max_annual_contribution_usd']);

/** Matcher V2's run-staleness inputs: exactly what matchmakingRuns.js snapshots. */
export const MATCHER_V2_INPUT_FIELDS = Object.freeze([...MATCHING_INPUT_FIELDS_V1, ...MATCHING_UNORDERED_LIST_FIELDS]);

const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
function norm(field, v) {
  if (empty(v)) return null;
  if (MATCHING_UNORDERED_LIST_FIELDS.includes(field) && Array.isArray(v)) return JSON.stringify([...v].map(String).sort());
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim();
}

function normFor(field, v) {
  // criterion_ranking's ORDER is the ranking, so it is compared as written, not sorted.
  if (field === 'criterion_ranking') return empty(v) ? null : JSON.stringify(v);
  return norm(field, v);
}

/** Which of `fields` differ between two versions of an athlete (only fields present in `after`). */
export function changedFields(fields, before = {}, after = {}) {
  return fields.filter((f) => Object.prototype.hasOwnProperty.call(after, f) && normFor(f, before[f]) !== normFor(f, after[f]));
}

/** The previous engine's inputs that changed: whether its stored analysis is now wrong. */
export const changedPreviousEngineInputs = (before, after) => changedFields(PREVIOUS_ENGINE_INPUT_FIELDS, before, after);

/** Matcher V2's inputs that changed: whether a V2 run is now outdated. */
export const changedMatcherV2Inputs = (before, after) => changedFields(MATCHER_V2_INPUT_FIELDS, before, after);
