export const STARTER_MINUTES_THRESHOLD = 600;

/**
 * Division normalization using regex word boundaries — "Division II" must
 * never match a "Division I" check (Section 15 decision #5).
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

export const POSITION_PILL_VARIANT = {
  GOALKEEPER: 'amber',
  DEFENSE: 'blue',
  MIDFIELD: 'purple',
  FORWARD: 'green',
};
