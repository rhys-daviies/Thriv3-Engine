export const STARTER_MINUTES_THRESHOLD = 600;

const GK_LABELS = new Set(['GK', 'G', 'GOALKEEPER', 'GOALIE']);
const DEF_LABELS = new Set(['D', 'DEF', 'DEFENSE', 'DEFENDER', 'CB', 'RB', 'LB', 'FB', 'WB', 'RWB', 'LWB', 'SW']);
const MID_LABELS = new Set(['M', 'MID', 'MIDFIELD', 'MIDFIELDER', 'CM', 'DM', 'AM', 'CDM', 'CAM', 'RM', 'LM']);
const FWD_LABELS = new Set(['F', 'FWD', 'FORWARD', 'ST', 'STRIKER', 'W', 'WING', 'WINGER', 'RW', 'LW', 'CF']);

/**
 * Classifies a raw roster position label into GOALKEEPER/DEFENSE/MIDFIELD/FORWARD/UNKNOWN.
 * For dual labels ("M/F", "D/M"), uses the LEFT side per Section 9 step 3.
 */
export function normalizePosition(rawLabel) {
  if (!rawLabel) return 'UNKNOWN';
  const first = String(rawLabel).split(/[/,]/)[0].trim().toUpperCase();

  if (['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'].includes(first)) return first;
  if (GK_LABELS.has(first)) return 'GOALKEEPER';
  if (DEF_LABELS.has(first)) return 'DEFENSE';
  if (MID_LABELS.has(first)) return 'MIDFIELD';
  if (FWD_LABELS.has(first)) return 'FORWARD';
  return 'UNKNOWN';
}

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
