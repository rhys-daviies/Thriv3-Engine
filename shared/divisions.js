/**
 * Division names, normalised.
 *
 * Shared because both sides need it and the ordering below is a rule, not a
 * preference: the D3 test has to run before D2 and D2 before D1, or
 * "Division II" matches the "Division I" check and a school lands a division
 * too high. Duplicating that anywhere is how it eventually gets reordered.
 */

/** The canonical spelling of every division, as `colleges.division` stores it. */
export const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];

/**
 * Normalises any spelling to the canonical one, or 'Other'.
 *
 * Word boundaries throughout — "Division II" must never satisfy a
 * "Division I" test (Section 15 decision #5).
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
