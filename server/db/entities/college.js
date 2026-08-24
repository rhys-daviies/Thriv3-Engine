import { createEntity } from './base.js';

const columns = [
  'name', 'location', 'division', 'conference', 'rating', 'academic_rating',
  'soccer_score', 'national_ranking', 'website_domain', 'sport', 'active',
  'nickname', 'nickname_plural', 'mascot', 'primary_color', 'secondary_color', 'logo_url',
  'identity_source', 'identity_notes',
  'conference_champion_2025', 'conference_champion_name', 'conference_champion_source', 'conference_champion_notes',
  // Matching model inputs, backfilled by loadMatchingInputs.js. Without these
  // on the wire the client scores geography and affordability at their neutral
  // prior for every programme, which looks like the criteria working.
  'unitid', 'city', 'state', 'latitude', 'longitude', 'control',
  'net_price', 'tuition_in_state', 'tuition_out_state',
  'sat_avg', 'admit_rate', 'recent_win_pct', 'prior_win_pct',
  'academic_rating_source', 'matching_data_source',
];

export const College = createEntity('colleges', columns, []);
