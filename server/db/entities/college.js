import { createEntity } from './base.js';

const columns = [
  'name', 'location', 'division', 'conference', 'rating', 'academic_rating',
  'soccer_score', 'national_ranking', 'website_domain', 'sport',
];

export const College = createEntity('colleges', columns, []);
