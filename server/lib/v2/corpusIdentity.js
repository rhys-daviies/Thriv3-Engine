/**
 * WHICH DATA V2 ACTUALLY READS, AS AN IDENTITY.
 *
 * A9.1 moved this out of `server/scripts/a8CorpusGuard.js` without changing a
 * line of the computation, so the validation guard and the production service
 * share one definition of "the corpus". The script keeps its CLI and re-exports
 * from here; every digest it has ever printed still reproduces.
 *
 * -- WHAT CONTRIBUTES, AND WHAT DELIBERATELY DOES NOT ----------------------
 *
 * Exactly the three tables `buildPoolContext` reads, and only the columns it
 * selects:
 *
 *   colleges            every column, for active programmes of the sport
 *   roster_players      the columns named in ROSTER_COLUMNS, for the season
 *   recruiting_arrivals programme, sport, arrival_season, canonical_position,
 *                       is_international
 *
 * `coaches`, `athletics_domains`, `programme_membership_periods` and the
 * `refresh_*` ledger are NOT included, because V2 does not read them. Phase 7B
 * writes coach data continuously, and a cache that invalidated on a coach edit
 * would rebuild a 939ms context for data no layer can see.
 *
 * The identity is taken TWICE, split by universe, for the reason A8.0 found:
 * 7B's staged work lands in NJCAA and USCAA, and a single whole-corpus digest
 * would report a scoring-relevant change every time two-year data arrived when
 * not one supported cell had moved.
 */
import crypto from 'node:crypto';
import { universeOf, UNIVERSE } from './validationUniverse.js';
import { ROSTER_COLUMNS } from './poolContext.js';
import { corpusRevisionToken } from '../../db/corpusIdentity.js';

export const GUARD_SEASON = '2026';

const SPORTS = Object.freeze(['mens-soccer', 'womens-soccer']);

/**
 * The columns `buildPoolContext` actually selects from `roster_players`,
 * read off that constant rather than copied, so a column added to the pool
 * context cannot be left out of the thing that guards it.
 */
const rosterCols = ROSTER_COLUMNS.split(',').map((s) => s.trim()).filter(Boolean);

function hashRows(rows) {
  const h = crypto.createHash('sha256');
  for (const r of rows) h.update(JSON.stringify(r));
  return h.digest('hex');
}

export function corpusDigests(db, { season = GUARD_SEASON } = {}) {
  const out = {};
  for (const universe of [UNIVERSE.SUPPORTED, UNIVERSE.UNSUPPORTED]) {
    const colleges = []; const roster = []; const arrivals = [];
    for (const sport of SPORTS) {
      const all = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1 ORDER BY id').all(sport);
      const keep = new Set();
      for (const c of all) {
        if (universeOf({ division: c.division, season: Number(season) }) !== universe) continue;
        keep.add(c.name);
        colleges.push(c);
      }
      const rr = db.prepare(
        `SELECT ${rosterCols.join(', ')} FROM roster_players WHERE sport = ? AND season = ?
          ORDER BY college_name, player_name, position`,
      ).all(sport, season);
      for (const r of rr) if (keep.has(r.college_name)) roster.push(r);
      const ar = db.prepare(
        `SELECT programme, sport, arrival_season, canonical_position, is_international
           FROM recruiting_arrivals WHERE sport = ? ORDER BY programme, arrival_season, canonical_position`,
      ).all(sport);
      for (const a of ar) if (keep.has(a.programme)) arrivals.push(a);
    }
    out[universe] = {
      digest: hashRows([...colleges, ...roster, ...arrivals]),
      colleges: colleges.length,
      rosterRows: roster.length,
      arrivals: arrivals.length,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// The change-token cache — A9.4
// ---------------------------------------------------------------------------

/**
 * `corpusDigests` IS THE IDENTITY. THIS IS THE ONLY THING ALLOWED TO SKIP IT.
 *
 * ===========================================================================
 * WHY: ASKING COST 150x MORE THAN ANSWERING.
 *
 * A9.3 shipped the persisted-first Matchmaking screen, which reads the current
 * run and its staleness on every load. Measured against the live corpus:
 *
 *   currentRun  (find the row)                    0.050 ms
 *   readRun     (1,205 rows -> 570KB payload)     5.705 ms
 *   runStaleness                                890 ms
 *     of which corpusDigests                   1,281 ms cold, ~890 ms warm
 *   corpusChangeToken                             0.007 ms
 *
 * Serving the answer was 5.7 ms; deciding whether it was still fresh was 890
 * ms, recomputed from scratch on every single request. `corpusDigests` reads
 * every college, roster row and arrival for both sports, twice - once per
 * universe - and hashes them.
 *
 * -- THE ARCHITECTURE IS A9.1'S, NOT A NEW ONE -----------------------------
 *
 * `poolContextFor` hit this exact wall and solved it with a two-level cache:
 * SQLite's own change token gates the expensive identity. A9.4 lifts that
 * gate to here so there is ONE implementation of it rather than a second,
 * independently-invalidating copy inside `runStaleness` - and so the service
 * and the staleness check share a recomputation when the token does move.
 *
 * -- WHY THE TOKEN IS SAFE, AND IN WHICH DIRECTION IT IS WRONG -------------
 *
 * `corpusChangeToken` is `data_version` (moves when ANOTHER connection
 * commits) plus `total_changes()` (this connection's own rows, which
 * data_version is documented not to cover). Together they see every ordinary
 * write from anywhere.
 *
 * It is a CHANGE DETECTOR, never an identity, and it is deliberately
 * over-sensitive: a 7B coach write moves it although no V2 cell changed. That
 * is the right direction to be wrong in - it costs one recomputation, never a
 * stale answer. The reverse, a relevant write the token misses, is the failure
 * that would report a moved corpus as unchanged, and the only way to reach it
 * is schema-level DDL, which does not increment `total_changes()`. A migration
 * that rewrote these tables in place without a restart would defeat this, and
 * it defeats `poolContextFor`'s cache identically; both are bounded by process
 * lifetime.
 *
 * `total_changes()` resets when a connection is opened, which is exactly why
 * the cache is keyed on the CONNECTION rather than only on the season. A new
 * `Database` is a new WeakMap key with no entry, so a token from another
 * connection can never be compared against this one's - and a process holding
 * two databases, which every multi-corpus test does, cannot be served the
 * other one's digest. That class of bug does not need anyone to remember a
 * reset call.
 *
 * WHAT THIS DOES NOT CHANGE: the digest definition, the two-universe split,
 * the season, or the fact that corpus identity is GLOBAL over both sports.
 * A men's-soccer run is stale when women's roster data moves, exactly as
 * before. This returns `corpusDigests`' own object and nothing else.
 */
let digestCache = new WeakMap();

/** Recomputations and hits, for the benchmarks and the invalidation tests. */
const stats = { recomputations: 0, hits: 0 };

export function corpusDigestCacheStats() { return { ...stats }; }

/**
 * Forget everything. Tests only - the cache is correct without it, and a
 * product path that needed it would be a product path with a stale answer.
 */
export function clearCorpusDigestCache() {
  digestCache = new WeakMap();
  stats.recomputations = 0;
  stats.hits = 0;
}

/** `corpusDigests`, skipped when nothing has been written since it last ran. */
export function cachedCorpusDigests(db, { season = GUARD_SEASON } = {}) {
  const token = corpusRevisionToken(db);
  let bySeason = digestCache.get(db);
  if (!bySeason) {
    bySeason = new Map();
    digestCache.set(db, bySeason);
  }
  const hit = bySeason.get(season);
  if (hit && hit.changeToken === token) {
    stats.hits += 1;
    return hit.digests;
  }
  const digests = corpusDigests(db, { season });
  /**
   * Stamped only after the computation returns. An entry written first and
   * filled afterwards would, on a throw, leave a token claiming a digest that
   * was never taken - which reads exactly like a correct cache hit.
   */
  bySeason.set(season, { changeToken: token, digests });
  stats.recomputations += 1;
  return digests;
}
