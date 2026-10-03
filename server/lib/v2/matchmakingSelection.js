import crypto from 'node:crypto';
import {
  currentRun, runById, programmeResult, runStaleness,
} from './matchmakingRuns.js';
import { STATUS, serviceError } from './matchmakingService.js';
/**
 * FROM THE ENGINE, not from the service that happens to import it.
 *
 * The first version of this took `TOP_N` off `matchmakingService.js`, which
 * imports it without re-exporting — so it was `undefined`, and
 * `rank <= undefined` is `rank <= NULL` in SQLite, which matches NOTHING and
 * raises nothing. The Top 100 query silently returned zero rows. A constant
 * with one home is read from that home.
 */
import { TOP_N } from '../../../shared/matching/v2/pursuitRules.js';

/**
 * SPECIFIC SEARCH AND OUTREACH SELECTION, OVER THE PERSISTED RUN — A9.5.
 *
 * ===========================================================================
 * THERE IS ONE MATCHMAKING MODEL, AND NOTHING HERE IS A SECOND ONE.
 *
 * Every function in this module READS a persisted run. None of them computes,
 * scores, ranks, falls back to a live evaluation, or resolves a programme by
 * anything other than the identity the run already stored. "Where does
 * Stanford sit for this athlete" is a lookup into an answer that already
 * exists; if that answer does not exist, the honest response is to say so and
 * offer to generate one, not to quietly rank a single school.
 *
 * That is not a style preference. A rank is a POSITION IN A POPULATION — #431
 * of 824 means nothing except relative to the other 823 — so scoring one
 * programme on its own would produce a number with no denominator, and any
 * number this surface showed would be a different claim from the one the
 * Matchmaking tab shows for the same school.
 * ===========================================================================
 */

/** Which run a lookup reads, and whether it still describes today. */
export function resolveRun(db, player, { runId = null } = {}) {
  const row = runId ? runById(db, runId) : currentRun(db, player.id);
  if (!row) {
    throw serviceError('RUN_NOT_FOUND',
      'No matchmaking run has been persisted for this athlete.');
  }
  /**
   * A run id from a request is checked against the athlete it is being read
   * for. Without this, any operator could read any athlete's run by id through
   * a route scoped to a different player - and worse, could record a selection
   * attributing one athlete's reasoning to another.
   */
  if (row.player_id !== player.id) {
    throw serviceError('RUN_PLAYER_MISMATCH',
      'That matchmaking run belongs to a different athlete.');
  }
  return { row, staleness: runStaleness(db, player, row) };
}

/**
 * One programme's standing inside a persisted run.
 *
 * Returns `null` when the programme is not in the run at all, which is a real
 * answer and not an error: the pool is built per sport from active colleges,
 * so a programme can be in the registry and legitimately outside this
 * athlete's evaluated universe.
 */
export function lookupProgramme(db, player, { collegeName, sport, runId = null } = {}) {
  if (!collegeName) throw serviceError('PROGRAMME_REQUIRED', 'A programme name is required.');
  const { row, staleness } = resolveRun(db, player, { runId });
  const programme = programmeResult(db, row.id, {
    collegeName,
    sport: sport || row.sport,
  });
  return {
    runId: row.id,
    computedAt: row.computed_at,
    staleness,
    poolSize: row.pool_size,
    rankedCount: row.ranked_count,
    programme,
  };
}

/**
 * The first 100 ranked programmes of a run — §L.
 *
 * `rank <= TOP_N` against the stored rank, never `LIMIT 100` over the table:
 * the two agree today and stop agreeing the moment anything changes how the
 * unranked tail sorts. The status filter is redundant beside a rank test (only
 * RANKED rows carry one) and is written anyway, because this list feeds
 * outreach and "no LIMITED_DATA, no unsupported" is a requirement rather than
 * an incidental property of the ordering.
 */
export function topSelectionCandidates(db, runRow, { limit = TOP_N } = {}) {
  return db.prepare(`
    SELECT college_name, sport, college_id, status, rank, pursuit
      FROM matchmaking_programme_results
     WHERE run_id = ? AND status = ? AND rank IS NOT NULL AND rank <= ?
     ORDER BY rank`).all(runRow.id, STATUS.RANKED, limit);
}

// ---------------------------------------------------------------------------
// Recording a selection
// ---------------------------------------------------------------------------

export const SELECTION_SOURCE = Object.freeze({
  TOP_100: 'TOP_100',
  SPECIFIC_SEARCH: 'SPECIFIC_SEARCH',
  FULL_UNIVERSE: 'FULL_UNIVERSE',
});

/**
 * Record that a programme was chosen for outreach out of a specific run.
 *
 * ===========================================================================
 * AN ARBITRARY (runId, school) PAIR IS REFUSED — §K.
 *
 * This table exists to be read later, by analysis nobody is writing yet, to
 * answer what Thriv3 believed when a programme was pursued. A single row
 * pairing a run with a programme that was never in it would not look wrong; it
 * would look like a selection, and it would corrupt the answer silently and
 * permanently. There is no repair for that afterwards, because nothing
 * downstream can tell a fabricated pair from a real one.
 *
 * So four things are established before anything is written:
 *
 *   1. the run exists
 *   2. the run belongs to THIS athlete
 *   3. the programme is IN that run
 *   4. the identity stored is the RUN'S spelling, not the caller's
 *
 * (4) matters as much as the others. A caller passing "Lindenwood University"
 * for a run holding "Lindenwood" would otherwise write a row that never joins
 * back. The lookup is the authority and its row is what gets copied.
 * ===========================================================================
 *
 * The status, rank and band come from the run. Nothing is defaulted: an
 * unranked programme is recorded with a NULL rank, because §M forbids
 * inventing one to make a row look like a ranked selection.
 */
export function recordSelection(db, player, {
  collegeName, sport = null, runId = null, source = SELECTION_SOURCE.SPECIFIC_SEARCH,
  now = new Date().toISOString(), id = crypto.randomUUID(),
} = {}) {
  if (!Object.values(SELECTION_SOURCE).includes(source)) {
    throw serviceError('SELECTION_SOURCE_INVALID', `Unknown selection source: ${source}`);
  }
  const { row, staleness } = resolveRun(db, player, { runId });
  const programme = programmeResult(db, row.id, {
    collegeName,
    sport: sport || row.sport,
  });
  if (!programme) {
    throw serviceError('PROGRAMME_NOT_IN_RUN',
      `${collegeName} is not a programme in that matchmaking run.`);
  }
  /**
   * A TOP_100 claim is checked rather than trusted. The source is written by a
   * caller and read later as a fact about which surface was used; a selection
   * labelled TOP_100 carrying rank 431 would make the first "do Top 100
   * selections out-perform searched ones" comparison meaningless.
   */
  if (source === SELECTION_SOURCE.TOP_100
    && !(programme.status === STATUS.RANKED && programme.rank <= TOP_N)) {
    throw serviceError('SELECTION_SOURCE_INVALID',
      `${collegeName} is not in the Top ${TOP_N} of that run.`);
  }

  db.prepare(`
    INSERT INTO matchmaking_selections (
      id, player_id, matchmaking_run_id, college_name, sport, college_id,
      status, rank, band, pursuit, source, run_was_stale, selected_at
    ) VALUES (
      @id, @player_id, @matchmaking_run_id, @college_name, @sport, @college_id,
      @status, @rank, @band, @pursuit, @source, @run_was_stale, @selected_at
    )`).run({
    id,
    player_id: player.id,
    matchmaking_run_id: row.id,
    /** The RUN'S spelling of the identity, never the caller's. */
    college_name: programme.name,
    sport: sport || row.sport,
    college_id: programme.programmeId ?? null,
    status: programme.status,
    rank: programme.rank ?? null,
    band: programme.band ?? null,
    pursuit: programme.pursuit ?? null,
    source,
    run_was_stale: staleness.current ? 0 : 1,
    selected_at: now,
  });

  return { id, runId: row.id, programme, runWasStale: !staleness.current };
}

/** This athlete's selection history, newest first. Append-only, so this is complete. */
export function selectionsFor(db, playerId, { limit = 200 } = {}) {
  return db.prepare(`
    SELECT * FROM matchmaking_selections
     WHERE player_id = ?
     ORDER BY selected_at DESC, id
     LIMIT ?`).all(playerId, limit);
}

/** Every selection made out of one run — the A9.6 attribution read. */
export function selectionsForRun(db, runId) {
  return db.prepare(`
    SELECT * FROM matchmaking_selections
     WHERE matchmaking_run_id = ?
     ORDER BY selected_at, id`).all(runId);
}
