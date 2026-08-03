const STRIP_WORDS = new Set(['university', 'college', 'state', 'of', 'the', 'at']);

export function normalizeSchoolName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w && !STRIP_WORDS.has(w))
    .join(' ')
    .trim();
}

// A handful of well-known aliases where the common short name diverges enough
// from the official name that normalization alone won't bridge them.
export const SCHOOL_ALIAS_MAP = {
  uconn: 'connecticut',
  ucf: 'central florida',
  fiu: 'florida international',
  fau: 'florida atlantic',
  smu: 'southern methodist',
  ucla: 'california los angeles',
  usc: 'southern california',
  unc: 'north carolina',
  vcu: 'virginia commonwealth',
  utep: 'texas el paso',
  utsa: 'texas san antonio',
  vmi: 'virginia military institute',
  byu: 'brigham young',
};

/**
 * Matches a target school name against a list of candidate names using the
 * cascade documented for importSoccerScores: exact lowercase -> normalized
 * (strip generic words) -> alias map -> fuzzy includes.
 */
export function matchSchoolName(target, candidateNames) {
  const targetLower = String(target || '').toLowerCase().trim();
  const byLower = new Map(candidateNames.map((c) => [c.toLowerCase().trim(), c]));

  if (byLower.has(targetLower)) return byLower.get(targetLower);

  const targetNorm = normalizeSchoolName(target);
  const byNorm = new Map(candidateNames.map((c) => [normalizeSchoolName(c), c]));
  if (byNorm.has(targetNorm)) return byNorm.get(targetNorm);

  const alias = SCHOOL_ALIAS_MAP[targetLower];
  if (alias) {
    const aliasNorm = normalizeSchoolName(alias);
    if (byNorm.has(aliasNorm)) return byNorm.get(aliasNorm);
  }

  for (const c of candidateNames) {
    const cLower = c.toLowerCase().trim();
    if (cLower.includes(targetLower) || targetLower.includes(cLower)) return c;
  }

  return null;
}

/** RPI-rank-to-1–10-rating conversion used when a school has no other academic/quality signal. */
export function rankToRating(rank, total) {
  if (!rank || !total || total <= 1) return 5;
  return 10 - ((rank - 1) / (total - 1)) * 9;
}
