/**
 * The database half of Competitive History.
 *
 * Two costs, and they are nothing like the philosophy pools. A programme's own
 * history is at most four rows on the primary key. The division-and-season
 * benchmark needs every readable row in the table — 8,685 of them, three orders
 * of magnitude smaller than the roster scan the philosophy pool does — so it is
 * built once per process and rechecked against a cheap fingerprint, the same
 * shape `philosophyQueries` uses, rather than being rebuilt per request.
 *
 * WHAT THIS MODULE WILL NOT READ, and a test enforces it: `soccer_score`,
 * `national_ranking`, `rating`, `recent_win_pct`, `prior_win_pct`, and every
 * postseason or conference-champion column. The first five are a current
 * snapshot built from these same four seasons, so consuming them here would
 * feed the record back into itself; the rest are the columns Phase 12A found
 * unreliable. Only `programme_seasons` and the division on `colleges` are read.
 */
import db from '../db/client.js';
import { competitiveHistory, SEASONS, MIN_POOL } from '../../shared/competitiveHistory.js';
import { winPercentage } from '../../shared/competitiveHistory.js';

const RECHECK_MINUTES = 10;

const selectHistory = db.prepare(
  `SELECT season, wins, draws, losses, matches_played, confidence, source, source_record_name
     FROM programme_seasons WHERE college_id = ? ORDER BY season`,
);
const selectCollege = db.prepare('SELECT id, name, sport, division FROM colleges WHERE id = ?');

/** Cheap and total: the loader replaces the table, so a count and a stamp settle it. */
const fingerprintStmt = db.prepare('SELECT COUNT(*) rows, MAX(imported_at) at FROM programme_seasons');
const fingerprint = () => {
  const f = fingerprintStmt.get();
  return `${f.rows}|${f.at ?? ''}`;
};

let cache = null;

/**
 * Every readable season's rate, grouped by sport, division and season.
 *
 * A ROSTER_CONTRADICTED row is left out of the pool as well as out of the
 * programme's own history: a record the programme's own roster disagrees with
 * should not be setting the median that other programmes are measured against.
 */
export function buildCompetitivePools() {
  const started = Date.now();
  const rows = db.prepare(
    `SELECT p.sport, c.division, p.season, p.wins, p.draws, p.matches_played
       FROM programme_seasons p JOIN colleges c ON c.id = p.college_id
      WHERE p.confidence != 'ROSTER_CONTRADICTED'`).all();
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.sport}|${r.division}`;
    if (!byKey.has(key)) byKey.set(key, {});
    const g = byKey.get(key);
    (g[r.season] ??= { rates: [], scope: `${r.division} ${r.sport === 'mens-soccer' ? 'men’s' : 'women’s'}` })
      .rates.push(winPercentage(r.wins, r.draws, r.matches_played));
  }
  return {
    byKey,
    seasons: SEASONS,
    minPool: MIN_POOL,
    observations: rows.length,
    groups: byKey.size,
    builtAt: new Date().toISOString(),
    buildMs: Date.now() - started,
    fingerprint: fingerprint(),
  };
}

export function competitivePools() {
  if (cache) {
    const age = Date.now() - cache.checkedAt;
    if (age < RECHECK_MINUTES * 60_000) return cache.value;
    if (fingerprint() === cache.value.fingerprint) { cache.checkedAt = Date.now(); return cache.value; }
  }
  const value = buildCompetitivePools();
  cache = { value, checkedAt: Date.now() };
  return value;
}

export function invalidateCompetitivePools() { const had = Boolean(cache); cache = null; return had; }

export function competitivePoolStatus() {
  return cache ? {
    builtAt: cache.value.builtAt, buildMs: cache.value.buildMs,
    observations: cache.value.observations, groups: cache.value.groups,
    minutesSinceChecked: Math.round((Date.now() - cache.checkedAt) / 60_000),
    stale: fingerprint() !== cache.value.fingerprint,
  } : null;
}

export function programmeSeasonRows(collegeId) {
  return selectHistory.all(collegeId).map((r) => ({ ...r, matchesPlayed: r.matches_played }));
}

/**
 * One programme's competitive history, benchmarked against its own division
 * and season.
 *
 * `coachAttribution` is passed in rather than built here, so this module never
 * duplicates the attribution model's inputs — the caller already holds it.
 */
export function competitiveHistoryFor(collegeId, { coachAttribution = null } = {}) {
  const col = selectCollege.get(collegeId);
  if (!col) return null;
  const rows = programmeSeasonRows(collegeId);
  const pools = competitivePools().byKey.get(`${col.sport}|${col.division}`) ?? null;
  return {
    college: { id: col.id, name: col.name, sport: col.sport, division: col.division },
    ...competitiveHistory({ rows, pools, coachAttribution }),
  };
}
