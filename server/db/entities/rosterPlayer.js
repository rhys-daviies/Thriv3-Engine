import { createEntity } from './base.js';

const columns = [
  'college_name', 'sport', 'division', 'season', 'conference', 'player_name',
  'class_year_label', 'position', 'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'nationality', 'hometown', 'country',
  'projected_minutes', 'projected_minutes_season', 'prior_programme',
  'source_stats_url', 'source_roster_url', 'data_confidence', 'notes',
  // L7Z acquisition provenance. See ROSTER_PLAYER_COLUMNS in server/db/migrate.js.
  'source_page_season', 'source_fetched_at', 'source_parser',
];

export const RosterPlayer = createEntity('roster_players', columns, []);
