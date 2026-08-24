import { createEntity } from './base.js';

const columns = [
  'name', 'location', 'division', 'conference', 'rating', 'academic_rating',
  'soccer_score', 'national_ranking', 'website_domain', 'sport', 'active',
  'nickname', 'nickname_plural', 'mascot', 'primary_color', 'secondary_color', 'logo_url',
  'identity_source', 'identity_notes',
  'conference_champion_2025', 'conference_champion_name', 'conference_champion_source', 'conference_champion_notes',
];

export const College = createEntity('colleges', columns, []);
