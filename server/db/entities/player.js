import { createEntity } from './base.js';

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
  'archived_at',
];

const jsonFields = ['preferred_divisions', 'preferred_conferences', 'video_chapters', 'sport_attributes'];

export const Player = createEntity('players', columns, jsonFields);
