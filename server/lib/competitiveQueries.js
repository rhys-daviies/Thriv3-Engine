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
 * `national_ranking`, `rating`, `recent_win_pct`, `prior_win_pct`, every
 * postseason or conference-champion column, and — since Phase 12B.1 —
 * `colleges.division`. The first five are a current snapshot built from these
 * same four seasons, so consuming them here would feed the record back into
 * itself; the postseason columns are the ones Phase 12A found unreliable; and
 * `colleges.division` is the CURRENT division, which is not the division a 2022
 * season was played in. `programme_seasons` is the only table read for
 * anything a figure depends on.
 */
import db from '../db/client.js';
import { competitiveHistory, SEASONS, MIN_POOL } from '../../shared/competitiveHistory.js';
import { winPercentage } from '../../shared/competitiveHistory.js';

const RECHECK_MINUTES = 10;

const selectHistory = db.prepare(
  `SELECT season, wins, draws, losses, matches_played, confidence, source, source_record_name,
          historical_division
     FROM programme_seasons WHERE college_id = ? ORDER BY season`,
);
/**
 * `division` is selected for the LABEL on the returned college row and for
 * nothing else — no figure in this layer may depend on it. The benchmark reads
 * `programme_seasons.historical_division`, which is the division that season
 * was actually played in.
 */
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
/**
 * Every readable season's rate, grouped by sport, THAT SEASON'S division, and
 * season.
 *
 * Keyed on `programme_seasons.historical_division` and never on
 * `colleges.division`. A season whose own division is not on file contributes
 * to no pool AND receives no percentile — it cannot be placed in a comparison
 * set, and putting it in the wrong one is how Mercyhurst's D2 season came to be
 * ranked against 213 D1 programmes. Today that is every season, so every pool
 * is empty and every benchmark refuses; Phase 12C is what changes it.
 *
 * A ROSTER_CONTRADICTED row is left out of the pool as well as out of the
 * programme's own history: a record the programme's own roster disagrees with
 * should not be setting the median other programmes are measured against.
 */
export function buildCompetitivePools() {
  const started = Date.now();
  const rows = db.prepare(
    `SELECT sport, historical_division, season, wins, draws, matches_played
       FROM programme_seasons
      WHERE confidence != 'ROSTER_CONTRADICTED' AND historical_division IS NOT NULL`).all();
  const bySeason = new Map();
  for (const r of rows) {
    if (!bySeason.has(r.season)) bySeason.set(r.season, {});
    const g = bySeason.get(r.season);
    (g[r.historical_division] ??= {
      rates: [],
      scope: `${r.historical_division} ${r.sport === 'mens-soccer' ? 'men’s' : 'women’s'}`,
    }).rates.push(winPercentage(r.wins, r.draws, r.matches_played));
  }
  // Grouped by sport at the top so one programme's four seasons read one map.
  const byKey = new Map();
  for (const sport of ['mens-soccer', 'womens-soccer']) {
    const perSeason = {};
    for (const season of SEASONS) {
      const divisions = {};
      for (const r of rows) {
        if (r.sport !== sport || r.season !== season) continue;
        (divisions[r.historical_division] ??= {
          rates: [],
          scope: `${r.historical_division} ${sport === 'mens-soccer' ? 'men’s' : 'women’s'}`,
        }).rates.push(winPercentage(r.wins, r.draws, r.matches_played));
      }
      if (Object.keys(divisions).length) perSeason[season] = divisions;
    }
    byKey.set(sport, perSeason);
  }
  return {
    byKey,
    seasons: SEASONS,
    minPool: MIN_POOL,
    // Seasons that could be placed in a division at all. Zero until 12C.
    observations: rows.length,
    placeableSeasons: rows.length,
    unplaceableSeasons: db.prepare(
      `SELECT COUNT(*) n FROM programme_seasons
        WHERE confidence != 'ROSTER_CONTRADICTED' AND historical_division IS NULL`).get().n,
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
    placeableSeasons: cache.value.placeableSeasons,
    unplaceableSeasons: cache.value.unplaceableSeasons,
    minutesSinceChecked: Math.round((Date.now() - cache.checkedAt) / 60_000),
    stale: fingerprint() !== cache.value.fingerprint,
  } : null;
}

export function programmeSeasonRows(collegeId) {
  return selectHistory.all(collegeId)
    .map((r) => ({ ...r, matchesPlayed: r.matches_played, historicalDivision: r.historical_division }));
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
  // Keyed on sport alone: the division comes from each season's own row.
  const pools = competitivePools().byKey.get(col.sport) ?? null;
  return {
    college: { id: col.id, name: col.name, sport: col.sport, division: col.division },
    ...competitiveHistory({ rows, pools, coachAttribution }),
  };
}
