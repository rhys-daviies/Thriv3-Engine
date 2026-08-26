// Re-exported from the matcher's constants so this view and the match card
// can never again disagree about what a starter is.
export { STARTER_MINUTES as STARTER_MINUTES_THRESHOLD } from '@shared/matching/constants.js';
export { PROJECTED_STARTER_MINUTES } from '@shared/matching/constants.js';

/**
 * roster_players holds five seasons (2022-2026) — every read the app does
 * against it must pin this or it silently mixes years into one list / one
 * match run.
 *
 * 2026 is the season to email coaches about: it is the squad they actually
 * have, and its graduating cohort is the one leaving next. Two caveats come
 * with it, and both are visible in the UI rather than assumed away:
 *
 *  - It is incomplete. 1,529 of 1,722 school-sports were acquirable in August
 *    2026; the rest had not published a roster yet, overwhelmingly D3. Those
 *    programmes are absent rather than back-filled from 2025, because a 2025
 *    row belongs to a different graduating cohort and would land in the wrong
 *    year bucket.
 *  - It has no minutes. The season has not been played, so minutes_played is
 *    NULL — unknown, not zero — and nothing can say who clears
 *    STARTER_MINUTES_THRESHOLD yet. Treat a null as "unknown", never as a
 *    non-starter.
 */
export const CURRENT_ROSTER_SEASON = '2026';

/**
 * True while the pinned season is still being played, so minutes are absent by
 * design rather than missing. Callers use it to label unknown playing time
 * instead of rendering it as zero.
 */
export const ROSTER_SEASON_IN_PROGRESS = true;

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
