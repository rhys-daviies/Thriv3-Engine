/**
 * WHERE EACH SPECIFIC SCHOOL SITS IN THE PERSISTED RUN — A10 §D.
 *
 * ===========================================================================
 * THIS IS A LOOKUP, NOT A MATCHER.
 *
 * Specific Schools is the consultant's list. It is not a second ranking and it
 * does not score anything: every number it shows was produced by the run that
 * is already on screen, and this module's whole job is to find the row the run
 * already wrote for a programme the consultant already asked about.
 *
 * NOTHING HERE RECOMPUTES. There is no call to the engine, no fallback to a
 * live evaluation and no derived score. If the run does not hold a programme,
 * the answer is "the run does not hold it" — see `UNMATCHED` below.
 * ===========================================================================
 *
 * READ OFF THE RUN THAT IS ALREADY LOADED, which is why this takes a run
 * rather than a player id and makes no request of its own. The panel hydrates
 * one run for Top 100 and Full Universe; Specific Schools is a third view of
 * that same array, so ninety-nine specific schools cost ninety-nine Map
 * lookups and zero requests. A per-row `GET …/matchmaking/programme` would be
 * the N+1 that grows with exactly the athletes who have the longest lists.
 */

/**
 * A SPECIFIC SCHOOL THE RUN DOES NOT CONTAIN.
 *
 * Returned as a real answer rather than `null` so a caller cannot quietly drop
 * the row. The three ways to get here are different facts and §N requires that
 * none of them be silently discarded:
 *
 *   - the programme is in the registry but outside this athlete's pool
 *   - the relationship names a sport this run is not about
 *   - the stored `college_name` no longer matches the run's name for it
 *
 * All three render through `MatchmakingProgrammeStanding`, which already says
 * "not part of this athlete's evaluated universe" rather than inventing a
 * rank or a zero for it.
 */
export const UNMATCHED = Object.freeze({ programme: null });

/** Exact identity, the way the rest of the product keys a programme. */
const keyFor = (name, sport) => `${name ?? ''}\u001F${sport ?? ''}`;

/**
 * Index a persisted run for lookup by (college name, sport).
 *
 * IDENTITY IS EXACT AND DELIBERATELY SO. `college_name` is required to equal
 * `colleges.name` everywhere in this schema, and a fuzzy match here would
 * convert a real identity defect — a renamed programme, a stored name that
 * drifted — into a confident wrong answer attached to somebody else's rank.
 * A miss is reported as a miss; see UNMATCHED.
 */
export function standingsIndex(run) {
  const byKey = new Map();
  const sport = run?.sport ?? null;
  for (const p of run?.programmes ?? []) {
    byKey.set(keyFor(p?.name, sport), p);
  }

  /**
   * The run's own count of ranked programmes, written in the same transaction
   * as the rows. Never the length of the array, which includes the unranked
   * tail and would print a denominator the run never claimed.
   */
  const rankedCount = run?.counts?.ranked ?? null;

  return {
    rankedCount,
    size: byKey.size,
    /**
     * The standing for one relationship row, in the shape
     * `MatchmakingProgrammeStanding` already consumes.
     */
    for(collegeName, programmeSport = sport) {
      const programme = byKey.get(keyFor(collegeName, programmeSport));
      if (!programme) return UNMATCHED;
      return { programme, rankedCount };
    },
  };
}

/** No run on screen means no standing to show — not an empty one. */
export const NO_RUN = Object.freeze({
  rankedCount: null,
  size: 0,
  for: () => null,
});

export function standingsFor(run) {
  return run ? standingsIndex(run) : NO_RUN;
}
