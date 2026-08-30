/**
 * The database half of the lifecycle layer.
 *
 * Two costs, the same shape as `philosophyQueries` and for the same reason. A
 * single programme's continuity and development are a few indexed lookups over
 * one school's rows and are computed on demand. The cross-programme movement
 * pass has to read every roster row for five seasons — a quarter of a million
 * of them — so it is built once per sport, per process, and rechecked against
 * a cheap fingerprint rather than rebuilt.
 *
 * better-sqlite3 is synchronous, so that build blocks the server while it
 * runs. That is the argument for caching it and never computing it per
 * request; it is also why the build drops its roster rows on the way out and
 * keeps only the findings.
 */
import db from '../db/client.js';
import {
  buildLifecyclePool, LIFECYCLE_SEASONS, LAST_SEASON, LAST_MEASURED_SEASON,
} from '../../shared/lifecycle/pool.js';

const SEASON_LIST = LIFECYCLE_SEASONS.map(() => '?').join(',');

/**
 * Every field the matching may read, and no more.
 *
 * `hometown` is load-bearing — it is the signal that separates a MATCH_A from
 * a MATCH_B — and `prior_programme` confirms rather than carries: it exists
 * only on 2026 rows.
 */
const LIFECYCLE_COLUMNS = `id, college_name, sport, division, season, player_name,
  class_year_label, position, minutes_played, games_played, games_started,
  estimated_graduation_year, nationality, hometown, country, eligibility_end_year,
  prior_programme`;

const selectAll = db.prepare(
  `SELECT ${LIFECYCLE_COLUMNS} FROM roster_players
    WHERE sport = ? AND season IN (${SEASON_LIST})`,
);

const selectOne = db.prepare(
  `SELECT ${LIFECYCLE_COLUMNS} FROM roster_players
    WHERE college_name = ? AND sport = ? AND season IN (${SEASON_LIST})`,
);

const selectColleges = db.prepare(
  'SELECT name, sport, division, soccer_score, academic_rating, national_ranking FROM colleges WHERE sport = ?',
);

const fingerprintStmt = db.prepare(
  `SELECT COUNT(*) rows, MAX(updated_date) at FROM roster_players WHERE season IN (${SEASON_LIST})`,
);
const fingerprint = () => {
  const f = fingerprintStmt.get(...LIFECYCLE_SEASONS);
  return `${f.rows}|${f.at ?? ''}`;
};

/** One programme's rows across the lifecycle window. Season is TEXT-normalised. */
export function lifecycleRows(school, sport) {
  return selectOne.all(school, sport, ...LIFECYCLE_SEASONS)
    .map((r) => ({ ...r, season: String(r.season) }));
}

const RECHECK_MINUTES = Number(process.env.THRIV3_PHILOSOPHY_RECHECK_MINUTES || 15);
const cache = new Map();

export function buildPool(sport) {
  const rows = selectAll.all(sport, ...LIFECYCLE_SEASONS)
    .map((r) => ({ ...r, season: String(r.season) }));
  const colleges = selectColleges.all(sport);
  return {
    ...buildLifecyclePool(rows, colleges, { sport }),
    builtAt: new Date().toISOString(),
    fingerprint: fingerprint(),
  };
}

/** The cached pool, rebuilt when the roster underneath it has changed. */
export function lifecyclePool(sport) {
  const hit = cache.get(sport);
  if (hit) {
    if (Date.now() - hit.checkedAt < RECHECK_MINUTES * 60_000) return hit.value;
    if (fingerprint() === hit.value.fingerprint) {
      hit.checkedAt = Date.now();
      return hit.value;
    }
  }
  const value = buildPool(sport);
  cache.set(sport, { value, checkedAt: Date.now() });
  return value;
}

export function invalidateLifecyclePool() {
  const cleared = [...cache.keys()];
  cache.clear();
  return cleared;
}

export { LIFECYCLE_SEASONS, LAST_SEASON, LAST_MEASURED_SEASON };
