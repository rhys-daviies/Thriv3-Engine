import { createEntity } from './base.js';

const columns = [
  'college_name', 'season', 'official_roster_url', 'confirmed_division',
  'total_graduating_seniors', 'all_graduating_senior_names', 'players', 'position_data',
  'coaching_staff', 'data_confidence', 'notes', 'sport',
];

const jsonFields = ['all_graduating_senior_names', 'players', 'position_data', 'coaching_staff'];

export const GraduatingSenior = createEntity('graduating_seniors', columns, jsonFields);
