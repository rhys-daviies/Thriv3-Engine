import { canonicalPosition } from '../../shared/positions.js';

/**
 * What counts as a starter *in the Graduating Database view*.
 *
 * Deliberately not `STARTER_MINUTES` from shared/matching/pool.js, which is
 * 900 and decides roster opportunity. Two different questions — "did this
 * player feature" versus "is this a place in the XI opening up" — so two
 * numbers, but they are easy to mistake for each other and have been.
 */
export const STARTER_MINUTES_THRESHOLD = 600;

/**
 * Classifies a raw roster position label into GOALKEEPER/DEFENSE/MIDFIELD/FORWARD/UNKNOWN.
 * For dual labels ("M/F", "D/M"), uses the LEFT side per Section 9 step 3.
 *
 * The label sets moved to shared/positions.js so the roster import and the
 * matcher cannot drift apart on what a position is called.
 */
export const normalizePosition = canonicalPosition;

/**
 * Groups a flat players[] array ({name, position, minutes_played}) into the
 * pre-grouped position_data[] shape the matching algorithm reads:
 * {position, graduating_senior_names[], graduating_starter_names[]}.
 */
export function buildPositionData(players) {
  const groups = {};
  for (const p of players) {
    const pos = normalizePosition(p.position);
    if (!groups[pos]) groups[pos] = { position: pos, graduating_senior_names: [], graduating_starter_names: [] };
    groups[pos].graduating_senior_names.push(p.name);
    const minutes = Number(p.minutes_played) || 0;
    if (minutes >= STARTER_MINUTES_THRESHOLD) {
      groups[pos].graduating_starter_names.push(p.name);
    }
  }
  return Object.values(groups);
}

/**
 * Division normalization using regex word boundaries so "Division II" never
 * matches a "Division I" check (Section 15 decision #5).
 */
export function normalizeDivision(raw) {
  if (!raw) return 'Other';
  const s = String(raw).toUpperCase();
  if (/\bD\s*3\b/.test(s) || /\bDIVISION\s+III\b/.test(s)) return 'NCAA D3';
  if (/\bD\s*2\b/.test(s) || /\bDIVISION\s+II\b/.test(s)) return 'NCAA D2';
  if (/\bD\s*1\b/.test(s) || /\bDIVISION\s+I\b/.test(s)) return 'NCAA D1';
  if (/\bNAIA\b/.test(s)) return 'NAIA';
  if (/\bNJCAA\b/.test(s)) return 'NJCAA';
  return 'Other';
}
