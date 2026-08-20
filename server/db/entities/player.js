import { createEntity } from './base.js';
import db from '../client.js';
import { extractVideoId } from '../../../shared/youtube.js';
import { generateSlug, generateUnique } from '../../lib/tokens.js';

const columns = [
  'full_name', 'email', 'phone', 'graduation_year', 'high_school', 'city', 'state',
  'position', 'secondary_position', 'preferred_divisions', 'football_ability',
  'academic_importance', 'gpa', 'sat_score', 'act_score', 'height_inches', 'weight_lbs',
  'forty_yard_dash', 'preferred_conferences', 'budget_range', 'highlights_url',
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
];

const jsonFields = ['preferred_divisions', 'preferred_conferences', 'video_chapters', 'sport_attributes'];

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
  create: (data) => base.create(withSlug(deriveVideoId(data))),
  update: (id, data) => base.update(id, deriveVideoId(data)),
};
