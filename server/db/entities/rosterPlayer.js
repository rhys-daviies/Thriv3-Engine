import { createEntity } from './base.js';

const columns = [
  'college_name', 'sport', 'division', 'season', 'conference', 'player_name',
  'class_year_label', 'position', 'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'nationality', 'hometown', 'country',
  'projected_minutes', 'projected_minutes_season',
  'source_stats_url', 'source_roster_url', 'data_confidence', 'notes',
];

export const RosterPlayer = createEntity('roster_players', columns, []);
