/**
 * Resolving one school's name onto another source's spelling of it.
 *
 * This matcher has now corrupted three separate columns, so its rules are
 * worth stating plainly. `athletics_domain` published Belmont Abbey's domain
 * for Belmont and Northern Michigan's for Michigan; the identity mappings
 * resolved Amherst to UMass Amherst; and academic ratings gave Kansas the
 * score of Central Arkansas, USC the score of USC Upstate, and Purdue the
 * score of Purdue Fort Wayne — every one of them a flagship programme.
 *
 * Two rules were at fault, and both looked reasonable:
 *
 *   "state" was a strip word, so "Georgia" and "Georgia State" normalised to
 *   the same string. They are different universities. So are Ohio and Ohio
 *   State, Missouri and Missouri State, Oregon and Oregon State.
 *
 *   The last resort was a bare substring test, and a flagship university's
 *   short name is a prefix of some satellite campus almost by construction.
 *   "USC" is inside "USC Upstate"; "Purdue" is inside "Purdue Fort Wayne".
 *
 * The principle that replaces them: extra words are only ignorable when they
 * carry no institutional identity. "College" and "University" are decoration.
 * "State", "Eastern", "Fort Wayne", "Upstate", "Christian", "Tech" are the
 * whole point of the name. When in doubt this returns null, because every one
 * of the failures above would have been a visible gap instead of a confident
 * wrong answer.
 *
 * One case stays undecidable and is worth knowing about. "Adrian" plus
 * "College" is one school; "Cornell" plus "College" is two. Bridging generic
 * words is not optional — the coach files write "Adrian College" where the
 * records file writes "Adrian" — so a lone "Cornell" against a candidate list
 * holding only "Cornell College" still resolves wrongly. What protects against
 * it is the exact-match stage: a source naming both spellings is never at
 * risk, which is why Cornell (9.8, Ivy) and Cornell College (6.6, D3) are both
 * correctly rated. Give a source file both names rather than relying on this.
 */

/**
 * Words that never distinguish two institutions, so a candidate may carry
 * them and still be the same school. Note what is NOT here: "state".
 */
const GENERIC_WORDS = new Set(['university', 'college', 'of', 'the', 'at', 'univ']);

export function normalizeSchoolName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w && !GENERIC_WORDS.has(w))
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

const tokens = (name) => normalizeSchoolName(name).split(' ').filter(Boolean);

/**
 * Candidates that are this school under a longer or shorter spelling.
 *
 * Containment has to run in both directions — the coach files write "Adrian
 * College" where the records file writes "Adrian" — but every extra word must
 * be generic. That is what separates "Adrian"/"Adrian College", which is one
 * school, from "Cornell"/"Cornell College", which is two.
 */
function sameSchoolCandidates(target, candidateNames) {
  const mine = tokens(target);
  if (!mine.length) return [];

  const out = [];
  for (const candidate of candidateNames) {
    const theirs = tokens(candidate);
    if (!theirs.length) continue;

    const [shorter, longer] = mine.length <= theirs.length ? [mine, theirs] : [theirs, mine];
    if (!shorter.every((t) => longer.includes(t))) continue;

    const extra = longer.filter((t) => !shorter.includes(t));
    if (extra.length === 0) out.push({ candidate, extra: 0 });
    // Every surviving extra word is already non-generic, because
    // normalizeSchoolName removed the generic ones. So any extra at all means
    // a different institution.
  }
  return out;
}

/**
 * Matches a target school name against a list of candidate names.
 *
 * Cascade: exact lowercase, then normalised exact, then the alias map, then
 * generic-word-only containment. Returns null rather than guessing — a tie is
 * refused for the same reason, since a confident wrong answer here lands in an
 * athlete's recommendations.
 */
export function matchSchoolName(target, candidateNames) {
  const targetLower = String(target || '').toLowerCase().trim();
  if (!targetLower) return null;

  const byLower = new Map(candidateNames.map((c) => [c.toLowerCase().trim(), c]));
  if (byLower.has(targetLower)) return byLower.get(targetLower);

  const targetNorm = normalizeSchoolName(target);
  const byNorm = new Map();
  for (const c of candidateNames) {
    const key = normalizeSchoolName(c);
    // First spelling wins, but a normalised collision between two DIFFERENT
    // candidates means the key cannot identify a school on its own.
    if (byNorm.has(key)) byNorm.set(key, null);
    else byNorm.set(key, c);
  }
  if (targetNorm && byNorm.get(targetNorm)) return byNorm.get(targetNorm);

  const alias = SCHOOL_ALIAS_MAP[targetLower];
  if (alias) {
    const aliasNorm = normalizeSchoolName(alias);
    if (byNorm.get(aliasNorm)) return byNorm.get(aliasNorm);
  }

  const candidates = sameSchoolCandidates(target, candidateNames);
  if (candidates.length === 1) return candidates[0].candidate;

  return null;
}

/** RPI-rank-to-1–10-rating conversion used when a school has no other academic/quality signal. */
export function rankToRating(rank, total) {
  if (!rank || !total || total <= 1) return 5;
  return 10 - ((rank - 1) / (total - 1)) * 9;
}
