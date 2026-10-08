import { createEntity } from './base.js';
import db from '../client.js';
import { extractVideoId } from '../../../shared/youtube.js';
import { generateSlug, generateUnique } from '../../lib/tokens.js';
import { contributionPairError } from '../../../shared/matching/v2/financialRules.js';
import { PREFERENCE_FIELD_NAMES, normalisePriority } from '../../../shared/matching/v2/athletePreferences.js';
import { isKnownPosition, hasSecondaryPosition } from '../../../shared/positions.js';
import { preferenceListError } from '../../../shared/recruitmentPreferences.js';

const columns = [
  'full_name', 'email', 'phone', 'graduation_year', 'recruiting_class_year', 'match_weights', 'criterion_ranking', 'origin', 'academic_minimum', 'high_school', 'city', 'state',
  'position', 'secondary_position', 'preferred_divisions', 'football_ability',
  'academic_importance', 'gpa', 'sat_score', 'act_score', 'height_inches', 'weight_lbs',
  'forty_yard_dash', 'preferred_conferences', 'budget_range',
  'max_annual_contribution_usd', 'contribution_state',
  'competitive_level_priority', 'playing_opportunity_priority', 'academic_strength_priority',
  'highlights_url',
  'additional_notes', 'email_subject', 'email_template', 'recommendations', 'status', 'sport',

  // Public profile page (see server/db/migrate.js)
  'video_id', 'video_chapters', 'evaluation', 'public_slug',

  // Universal athlete fields — sport-independent, so real columns
  'height_cm', 'weight_kg', 'nationality', 'commitment_status', 'club_name',
  'ncaa_eligibility_id', 'intended_major', 'guardian_name', 'guardian_email',
  'club_coach_name', 'club_coach_email', 'time_zone', 'best_contact_window',

  // Sport-varying metrics, described by server/lib/sportProfiles.js
  'sport_attributes',

  // Lifecycle
  'archived_at', 'published_at',

  // Recruitment preferences (shared/recruitmentPreferences.js)
  'preferred_states', 'preferred_regions', 'preferred_institution_types',
];

const jsonFields = [
  'preferred_divisions', 'preferred_conferences', 'video_chapters', 'sport_attributes', 'criterion_ranking',
  'preferred_states', 'preferred_regions', 'preferred_institution_types',
];

const base = createEntity('players', columns, jsonFields);

/**
 * video_id is derived, never entered. Keeping it in step with highlights_url
 * on every write means the export and the email link cannot drift from the
 * reel the athlete actually has — a stale id would publish someone else's
 * video, or none.
 */
function deriveVideoId(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'highlights_url')) return data;
  return { ...data, video_id: extractVideoId(data.highlights_url) };
}

/**
 * Refuse an impossible contribution answer rather than repairing it.
 *
 * A numeric maximum beside NOT_A_CONSTRAINT is two different answers to one
 * question. Coercing either way would put a budget in the record that nobody
 * stated, which is the exact failure the field was added to prevent - so the
 * write fails and the caller is told which pair is wrong.
 *
 * An UPDATE is checked against the row it would produce, not against the
 * patch alone: sending only `contribution_state` must not be able to leave a
 * stale maximum stranded beside a state that forbids one.
 */
function checkContribution(data, existing = null) {
  if (!data) return data;
  const has = (k) => Object.prototype.hasOwnProperty.call(data, k);
  if (!has('contribution_state') && !has('max_annual_contribution_usd')) return data;
  const merged = {
    contributionState: has('contribution_state') ? data.contribution_state : (existing?.contribution_state ?? null),
    maxAnnualContributionUsd: has('max_annual_contribution_usd')
      ? data.max_annual_contribution_usd : (existing?.max_annual_contribution_usd ?? null),
  };
  // SQLite hands back integers; a JSON body may send a numeric string.
  if (typeof merged.maxAnnualContributionUsd === 'string' && merged.maxAnnualContributionUsd.trim() !== '') {
    const n = Number(merged.maxAnnualContributionUsd);
    if (!Number.isFinite(n)) throw new Error('max_annual_contribution_usd must be a finite number');
    merged.maxAnnualContributionUsd = n;
  }
  if (merged.maxAnnualContributionUsd === '') merged.maxAnnualContributionUsd = null;
  const err = contributionPairError(merged);
  if (err) throw new Error(err);
  return data;
}

/**
 * Normalise the three 1-5 preferences, or refuse the write.
 *
 * REFUSES RATHER THAN CLAMPING, for the same reason the contribution pair
 * does: a 7 clamped to a 5 is an answer the athlete did not give, and a 7
 * dropped to NULL is a question they would be asked again having already
 * answered it. Both are worse than a failed save with a message.
 *
 * It normalises exactly one thing - a numeric string to an integer - because
 * the surrounding stack already does: an HTML select and a JSON body both
 * send "4", and the column's own CHECK would take it either way. Leaving the
 * two to disagree about that is how a value passes the entity and fails at
 * SQLite with no message a person can act on.
 *
 * ONLY FIELDS PRESENT IN THE PATCH ARE TOUCHED. An update that says nothing
 * about preferences says nothing about them; unlike the contribution pair
 * these three are independent of each other, so there is no combination to
 * check against the row the patch would produce.
 */
function checkPriorities(data) {
  if (!data) return data;
  let out = data;
  for (const field of PREFERENCE_FIELD_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const r = normalisePriority(field, data[field]);
    if (!r.ok) throw new Error(r.error);
    if (r.value !== data[field]) {
      if (out === data) out = { ...data };
      out[field] = r.value;
    }
  }
  return out;
}

/**
 * Refuse a position the matcher cannot place, and a malformed preference list.
 *
 * Positions are free text in the schema, and an unrecognised one does not
 * fail anywhere loud: `canonicalPosition` reads it as UNKNOWN, positional
 * opportunity goes unscoreable and the athlete's whole ranking quietly loses
 * its most important layer. So a written position must resolve to one of the
 * four groups. A secondary position may also be the 'None' sentinel or blank.
 *
 * Only fields in the patch are checked, so a legacy row holding a value this
 * rule would now refuse can still be edited elsewhere without being rewritten.
 */
function checkPositionsAndPreferences(data) {
  if (!data) return data;
  const has = (k) => Object.prototype.hasOwnProperty.call(data, k);
  if (has('position') && !isKnownPosition(data.position)) {
    throw new Error(`position "${data.position ?? ''}" is not a position the matcher can place`);
  }
  if (has('secondary_position') && hasSecondaryPosition(data.secondary_position) && !isKnownPosition(data.secondary_position)) {
    throw new Error(`secondary_position "${data.secondary_position}" is not a position the matcher can place`);
  }
  const listError = preferenceListError(data);
  if (listError) throw new Error(listError);
  return data;
}

const slugTaken = (candidate) => !!db.prepare('SELECT 1 FROM players WHERE public_slug = ?').get(candidate);

/**
 * Every athlete needs a public_slug before a page can be generated for them.
 * The migration backfills existing rows, but a player created afterwards would
 * have had none — so adding an athlete, giving them chapters and trying to
 * publish would fail at the last step. Assign it at creation instead.
 */
function withSlug(data) {
  if (data?.public_slug) return data;
  return { ...data, public_slug: generateUnique(generateSlug, slugTaken) };
}

export const Player = {
  ...base,
  create: (data) => base.create(withSlug(deriveVideoId(checkPriorities(checkContribution(checkPositionsAndPreferences(data)))))),
  update: (id, data) => base.update(id, deriveVideoId(checkPriorities(checkContribution(checkPositionsAndPreferences(data), base.get(id))))),

  /**
   * The athletes currently being represented.
   *
   * A SEPARATE METHOD RATHER THAN A FILTER INSIDE `list`. Deleting an athlete
   * archives them, and the operator's Players screen must stop showing them —
   * but the row itself is deliberately kept, and the model layer has to go on
   * being able to reach it. Everything that legitimately needs an archived
   * athlete reads one by id: the publish gate, the permanence validator, the
   * public page handler, engagement attribution. Narrowing `list` for all of
   * them to suit one screen would hide the record from the very code whose job
   * is to reason about it.
   *
   * So the screen asks for what the screen means, and nothing else changes.
   */
  listActive(sort, limit) {
    return base.filter({ archived_at: null }, sort, limit);
  },
};
