import { TOP_RANKS, readReserve } from './reserve.js';

/**
 * THE ACTIONABLE TOP 100 — DERIVED, NEVER STORED.
 *
 * An athlete's stored analysis is the model's answer and stays the model's
 * answer: `recommendations` is ranks 1-100 and `reserve` is 101-150, in one
 * unbroken order, and NOTHING HERE WRITES TO EITHER. What an operator decides
 * about a particular school for a particular athlete lives in
 * `athlete_programmes`, and this is where the two meet — at read time, every
 * time, so that un-suppressing a school is a single row update rather than a
 * re-analysis.
 *
 * ---------------------------------------------------------------------------
 * ONLY `visibility = 'suppressed'` REMOVES A PROGRAMME. Not `flagged`, not
 * `contact_stance`, not a withdrawn request. Those are three other decisions
 * about the same school and each has its own column for exactly this reason:
 * a coach the athlete already knows is often the MOST actionable school on the
 * list, and a flag that quietly hid it would be the opposite of what the
 * operator asked for.
 * ---------------------------------------------------------------------------
 *
 * WHAT COMES BACK IS A COPY. Each entry is the analysis entry plus two fields
 * this function is the only author of:
 *
 *   source_rank  where the MODEL put it — 1-150 across the two arrays. This is
 *                the rank that is never renumbered. A promoted programme keeps
 *                101 here however high it is displayed.
 *   promoted     true when it came out of the reserve.
 *
 * The position in the returned array is the ACTIONABLE position, which is a
 * different quantity and is deliberately not written onto the entry: whoever
 * needs it already has the index, and a second rank-shaped field on the object
 * is how the two get confused.
 */

/**
 * The programmes an athlete's operator has taken out of the actionable list.
 *
 * Keyed on `college_name`, which is what the analysis entries carry as `name`
 * and what every join in this product uses. Sport is not compared: an
 * athlete's relationships and their analysis are both in the athlete's own
 * sport, so scoping again here would only invent a way for the two to
 * disagree.
 */
export function suppressedProgrammeNames(relationships) {
  const names = new Set();
  for (const r of relationships || []) {
    if (r && r.visibility === 'suppressed' && r.college_name) names.add(r.college_name);
  }
  return names;
}

/** A copy carrying where the model put it. Never the original object. */
function withSourceRank(entry, rank, promoted) {
  return { ...entry, source_rank: rank, promoted };
}

/**
 * @param {object} params
 * @param {Array}  params.recommendations  ranks 1-100, array order IS the ranking
 * @param {Array}  [params.reserve]        ranks 101-150; may be absent on old analyses
 * @param {Array}  [params.relationships]  athlete_programmes rows
 * @param {Set}    [params.suppressed]     pre-computed names, instead of `relationships`
 * @returns {{
 *   programmes: Array, suppressedCount: number, suppressedNames: string[],
 *   promoted: Array<{name: string, source_rank: number}>,
 *   target: number, exhausted: boolean, shortfall: number
 * }}
 */
export function visibleTop100({
  recommendations, reserve, relationships, suppressed,
} = {}) {
  const ranked = Array.isArray(recommendations) ? recommendations : [];
  const tail = Array.isArray(reserve) ? reserve : readReserve({ reserve });
  const hidden = suppressed instanceof Set ? suppressed : suppressedProgrammeNames(relationships);

  /**
   * HOW MANY THIS ATHLETE WOULD HAVE SEEN ANYWAY, which is not always 100.
   *
   * A pool narrowed by division and conference filters legitimately produces
   * 40 recommendations, and 40 is the right answer for that athlete. Topping
   * up to 100 from the reserve when nothing was suppressed would silently
   * change what every un-suppressed athlete sees — the reserve is a
   * REPLACEMENT for something removed, never an extension of the list.
   */
  const target = Math.min(ranked.length, TOP_RANKS);

  const programmes = [];
  const suppressedNames = [];

  ranked.forEach((entry, i) => {
    if (entry && hidden.has(entry.name)) {
      suppressedNames.push(entry.name);
      return;
    }
    programmes.push(withSourceRank(entry, i + 1, false));
  });

  /**
   * PROMOTION IS ONE-FOR-ONE AND IN ORIGINAL RANK ORDER. A suppressed reserve
   * entry is skipped and costs nothing — it was never in the hundred, so
   * removing it does not create a hole to fill.
   */
  const promoted = [];
  for (let j = 0; j < tail.length && programmes.length < target; j += 1) {
    const entry = tail[j];
    if (!entry) continue;
    const rank = TOP_RANKS + 1 + j;
    if (hidden.has(entry.name)) {
      suppressedNames.push(entry.name);
      continue;
    }
    programmes.push(withSourceRank(entry, rank, true));
    promoted.push({ name: entry.name, source_rank: rank });
  }

  /**
   * THE SHORTFALL IS REPORTED, NOT PADDED. When suppression outruns the
   * reserve the honest answer is a shorter list; manufacturing a programme to
   * reach a round number would put a school in front of a coach because a
   * counter wanted one.
   */
  const shortfall = target - programmes.length;

  return {
    programmes,
    suppressedCount: suppressedNames.length,
    suppressedNames,
    promoted,
    target,
    exhausted: shortfall > 0,
    shortfall,
  };
}
