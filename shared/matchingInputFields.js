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

/** Read only by the previous engine (V1's criterion weights). */
export const PREVIOUS_ENGINE_ONLY_FIELDS = Object.freeze(['match_weights']);

const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
function norm(field, v) {
  if (empty(v)) return null;
  if (MATCHING_UNORDERED_LIST_FIELDS.includes(field) && Array.isArray(v)) return JSON.stringify([...v].map(String).sort());
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim();
}

/** The matching inputs that differ between two versions of an athlete, by field name. */
export function changedMatchingInputs(before = {}, after = {}) {
  const fields = [...MATCHING_INPUT_FIELDS_V1, ...MATCHING_UNORDERED_LIST_FIELDS, ...PREVIOUS_ENGINE_ONLY_FIELDS];
  return fields.filter((f) => Object.prototype.hasOwnProperty.call(after, f) && norm(f, before[f]) !== norm(f, after[f]));
}
