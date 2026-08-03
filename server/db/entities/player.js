import { createEntity } from './base.js';

const columns = [
  'full_name', 'email', 'phone', 'graduation_year', 'high_school', 'city', 'state',
  'position', 'secondary_position', 'preferred_divisions', 'football_ability',
  'academic_importance', 'gpa', 'sat_score', 'act_score', 'height_inches', 'weight_lbs',
  'forty_yard_dash', 'preferred_conferences', 'budget_range', 'highlights_url',
  'additional_notes', 'email_subject', 'email_template', 'recommendations', 'status', 'sport',
];

const jsonFields = ['preferred_divisions', 'preferred_conferences'];

export const Player = createEntity('players', columns, jsonFields);
