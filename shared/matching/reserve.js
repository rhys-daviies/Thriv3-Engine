/**
 * THE RANKED TAIL BELOW THE TOP 100, AND THE ONLY RULES ABOUT IT.
 *
 * A match analysis has always persisted exactly the first hundred ranked
 * programmes and thrown the rest away (`results.slice(0, 100)` in
 * src/lib/playerAnalysis.js). That was fine while the hundred was final. It
 * stops being fine the moment an operator can suppress a programme from an
 * athlete's actionable list: removing one from a list of exactly a hundred
 * leaves ninety-nine, and there is nothing on disk to promote in its place.
 *
 * So an analysis now also persists a RESERVE — the next fifty, ranks 101-150,
 * in rank order. Nothing consumes it yet. This module exists so that when
 * something does, the rules it obeys are written down in one place rather
 * than rediscovered at three call sites.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE RESERVE IS NOT.
 *
 * It is NOT part of the Top 100 and it is NOT campaign material. A campaign
 * tiers ranks 1-100 and `tierForRank` has no band above that (see
 * MAX_PROGRAMMES in server/lib/campaigns.js); a reserve programme handed to a
 * campaign would need a tier no rule chose. `freezeRecommendations` reads
 * `analysis.recommendations` and nothing else, which is why adding this key to
 * the blob is invisible to every existing campaign guard — deliberately so.
 *
 * It is also NOT a second ranking. ARRAY ORDER IS THE RANKING, here exactly as
 * in `recommendations`: reserve[0] is rank 101, reserve[1] is rank 102. The two
 * arrays are one ranked list stored in two pieces and must never be sorted
 * independently of each other.
 * ---------------------------------------------------------------------------
 */

/** Ranks 1-100. The actionable list, and the most a campaign can freeze. */
export const TOP_RANKS = 100;

/**
 * Ranks 101-150. Fifty, not "as many as we have".
 *
 * A bound rather than the whole tail because the tail is the other 1,800
 * programmes in the pool: an analysis blob is uploaded and re-read on every
 * workspace load, and persisting the pool would multiply that payload by
 * twenty to serve a feature that promotes a handful of rows. Fifty is the
 * headroom a future suppression feature may spend, stated as a number so the
 * moment it runs out is detectable rather than silent.
 */
export const RESERVE_RANKS = 50;

/**
 * Split a ranked result list into what is persisted where.
 *
 * Takes the ranked output as-is and slices it. An athlete whose eligibility
 * filters leave fewer than 150 programmes gets whatever exists — a short
 * reserve, or none — because a short reserve is the truth and padding it would
 * put programmes in the list that were never ranked.
 */
export function splitRanked(results) {
  const list = Array.isArray(results) ? results : [];
  return {
    top: list.slice(0, TOP_RANKS),
    reserve: list.slice(TOP_RANKS, TOP_RANKS + RESERVE_RANKS),
  };
}

/**
 * The reserve of a stored analysis, for blobs written before there was one.
 *
 * Ninety-eight analyses exist on disk with no `reserve` key at all, and a
 * profile edit nulls `players.recommendations` rather than rewriting it, so
 * they are not going to acquire one. Missing reads as EMPTY, never as an
 * error: an old analysis has no reserve, which is a fact about it and not a
 * fault. What must not happen is an old analysis being treated as though it
 * had fifty programmes in hand — see `suppressionHeadroom`.
 */
export function readReserve(analysis) {
  if (!analysis || typeof analysis !== 'object') return [];
  return Array.isArray(analysis.reserve) ? analysis.reserve : [];
}

/** The rank a reserve entry holds in the single ranked list. */
export function reserveRank(index) {
  return TOP_RANKS + 1 + index;
}

/**
 * How many suppressions this analysis can absorb and still yield a full 100.
 *
 * ONE PROMOTION PER SUPPRESSION, so the headroom is simply how many programmes
 * are held in reserve. An analysis written before the reserve existed scores
 * zero, which is correct and is the whole point: the alternative is a Top 99
 * that nobody was told about.
 *
 * A CAVEAT FOR WHOEVER BUILDS THE DERIVATION. Suppressing a programme that is
 * itself in the reserve costs no promotion — it was never in the hundred. This
 * function does not know which programmes are being suppressed and so cannot
 * make that distinction; it answers the conservative question ("could fifty
 * arbitrary suppressions be absorbed"), and a caller that knows the set should
 * count only the suppressions that land in `recommendations`.
 */
export function suppressionHeadroom(analysis) {
  return readReserve(analysis).length;
}

/**
 * Refuse a suppression that would silently shorten the list.
 *
 * Throws rather than returning false, and carries a `code` like every other
 * domain failure in this codebase, so a route can map it to a status without
 * matching on message text.
 */
export function assertSuppressionCapacity(analysis, suppressedCount) {
  const headroom = suppressionHeadroom(analysis);
  if (suppressedCount > headroom) {
    const err = new Error(
      `Suppressing ${suppressedCount} programme(s) needs ${suppressedCount} replacement(s) from reserve, `
      + `and this analysis holds ${headroom}. Re-run the match analysis rather than publishing a list of `
      + `${TOP_RANKS - (suppressedCount - headroom)}.`,
    );
    err.code = 'RESERVE_EXHAUSTED';
    throw err;
  }
  return headroom - suppressedCount;
}
