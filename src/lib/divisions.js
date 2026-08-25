export const STARTER_MINUTES_THRESHOLD = 600;

/**
 * roster_players now holds more than one season (2024 was imported
 * separately for a cross-season retention analysis) — every read the app
 * does against it must pin this or it silently mixes two years' rosters
 * into one list / one match run.
 */
export const CURRENT_ROSTER_SEASON = '2025';

// Lives in shared/ because the server normalises the same strings and the
// test ordering inside it is a rule rather than a preference. Re-exported here
// so client imports are unchanged.
export { normalizeDivision, DIVISIONS } from '@shared/divisions.js';

export const POSITION_PILL_VARIANT = {
  GOALKEEPER: 'amber',
  DEFENSE: 'blue',
  MIDFIELD: 'purple',
  FORWARD: 'green',
};
