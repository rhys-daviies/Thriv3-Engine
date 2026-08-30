/**
 * The database half of the programme-philosophy reports.
 *
 * Two very different costs live here. One programme is ~15 ms end to end, so
 * the per-school half is computed on demand and never cached. The pool-wide
 * benchmarks a programme is *compared against* need every roster row for four
 * seasons — 218,586 of them, about 1.7 s — so they are built once per process
 * and rechecked against a cheap fingerprint rather than rebuilt.
 *
 * better-sqlite3 is synchronous, so that 1.7 s blocks the whole server
 * including the tracking collector mounted at `/api` ahead of `express.json`.
 * That is the argument for caching it and for never computing it per request.
 */
import db from '../db/client.js';
import { programmePhilosophy, playerFit, SEASONS, SQUAD_SEASON, vacancyObservations } from '../../shared/philosophy.js';
import { ladderByRank } from '../../shared/freshmanMinutes.js';
import { POSITIONS } from '../../shared/positions.js';

const SEASON_LIST = SEASONS.map(() => '?').join(',');

const ROSTER_COLUMNS = `college_name, sport, season, player_name, position, minutes_played,
  games_played, games_started, class_year_label, nationality, country, hometown,
  estimated_graduation_year, eligibility_end_year, projected_minutes, prior_programme`;

const selectRoster = db.prepare(
  `SELECT ${ROSTER_COLUMNS} FROM roster_players
   WHERE college_name = ? AND sport = ? AND season IN (${SEASON_LIST})`,
);
// `reason` is not optional: a season the scraper could not read and a season
// the page said was vacant are opposite claims, and tenureFor needs the reason
// to keep them apart.
const selectCoachSeasons = db.prepare(
  'SELECT season, coach_name, coach_title, reason FROM coach_seasons WHERE school = ? AND sport = ? ORDER BY season',
);
const selectCollege = db.prepare(
  'SELECT id, name, sport, division, conference, city, state, soccer_score, logo_url, primary_color FROM colleges WHERE id = ?',
);
const selectCollegeByName = db.prepare(
  'SELECT id, name, sport, division, conference, city, state, soccer_score, logo_url, primary_color FROM colleges WHERE name = ? AND sport = ?',
);

/** Season is TEXT on the roster and INTEGER on coach_seasons; normalise here. */
export function programmeRows(school, sport) {
  return selectRoster.all(school, sport, ...SEASONS)
    .map((r) => ({ ...r, season: String(r.season) }));
}

/**
 * The squad on campus for the season being recruited into.
 *
 * Loaded separately from the measured window: it carries no minutes at all, so
 * anything that ranks or averages must never see it. What it does carry, and
 * nothing else does, is eligibility_end_year, projected_minutes and
 * prior_programme.
 */
const selectSquad = db.prepare(
  `SELECT ${ROSTER_COLUMNS} FROM roster_players
   WHERE college_name = ? AND sport = ? AND season = ?`,
);

export function squadRows(school, sport) {
  return selectSquad.all(school, sport, SQUAD_SEASON)
    .map((r) => ({ ...r, season: String(r.season) }));
}

export function programmeCoachRows(school, sport) {
  return selectCoachSeasons.all(school, sport)
    .map((r) => ({ ...r, coach_name: r.coach_name || '', reason: r.reason || '' }));
}

export function college(collegeId) {
  return selectCollege.get(collegeId) ?? null;
}

export function collegeByName(name, sport) {
  return selectCollegeByName.get(name, sport) ?? null;
}

/**
 * One programme, resolved from the college row rather than from whatever name
 * a stored analysis happens to carry — the identity scripts have renamed
 * schools since some of those blobs were written, and `colleges` is unique on
 * (name, sport) so the row alone settles the sport too.
 */
export function philosophyFor(collegeId) {
  const col = college(collegeId);
  if (!col) return null;
  const rows = programmeRows(col.name, col.sport);
  const coachRows = programmeCoachRows(col.name, col.sport);
  const squad = squadRows(col.name, col.sport);
  return { college: col, philosophy: programmePhilosophy({ rows, coachRows }), rows, squad };
}

/**
 * The same programme, read for one athlete, from rows already in hand.
 *
 * The loading half is separated from the reading half because a caller that
 * already holds `found` must not pay for it twice: one report used to run
 * philosophyFor three times over — three roster queries, three squad queries
 * and three full runs of programmePhilosophy — for one document.
 */
export function fitFrom(found, athlete) {
  if (!found) return null;
  return { ...found, fit: playerFit(found.philosophy, athlete, found.rows) };
}

/** The same programme, read for one athlete. */
export function fitFor(collegeId, athlete) {
  return fitFrom(philosophyFor(collegeId), athlete);
}

// ---------------------------------------------------------------------------
// Pool benchmarks
// ---------------------------------------------------------------------------

const RECHECK_MINUTES = Number(process.env.THRIV3_PHILOSOPHY_RECHECK_MINUTES || 15);
const BINS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1.01];

const cache = new Map();     // sport -> { built, promiseless value }
const building = new Map();  // sport -> the in-flight build, shared by every caller

const fingerprintStmt = db.prepare(
  `SELECT COUNT(*) rows, MAX(updated_date) at FROM roster_players WHERE season IN (${SEASON_LIST})`,
);
const fingerprint = () => {
  const f = fingerprintStmt.get(...SEASONS);
  return `${f.rows}|${f.at ?? ''}`;
};

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const pct = (v) => (v == null ? null : Math.round(v * 1000) / 10);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * Everything a report compares one programme against.
 *
 * Returns `sufficient: false` with nulls rather than zeros when there is not
 * enough on file — every `:memory:` test database is in that state, and a
 * zero-length bar is indistinguishable from "this programme plays no
 * freshmen", which is the exact defect the readability guard exists to avoid.
 */
export function buildPoolBenchmarks(sport) {
  const started = Date.now();
  const roster = db.prepare(
    `SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport = ? AND season IN (${SEASON_LIST})`,
  ).all(sport, ...SEASONS).map((r) => ({ ...r, season: String(r.season) }));

  const empty = {
    sufficient: false, sport, seasons: SEASONS, programmes: 0, observations: 0,
    reason: 'no roster seasons on file for this sport',
    ladderByRank: null, dials: null, fillMix: null, vacancy: null, byPosition: null,
    builtAt: new Date().toISOString(), buildMs: Date.now() - started,
    fingerprint: fingerprint(),
  };
  if (!roster.length) return empty;

  const byProg = new Map();
  for (const r of roster) {
    if (!byProg.has(r.college_name)) byProg.set(r.college_name, []);
    byProg.get(r.college_name).push(r);
  }

  const ladders = new Map();   // rank -> medians across programmes
  const obs = [];
  for (const rows of byProg.values()) {
    const ph = programmePhilosophy({ rows, coachRows: [] });
    if (ph.freshman) {
      for (const r of ph.ladder) {
        if (!ladders.has(r.rank)) ladders.set(r.rank, []);
        ladders.get(r.rank).push(r.median);
      }
    }
    obs.push(...vacancyObservations(rows));
  }
  const readable = obs.filter((o) => o.freshmenReadable);
  if (!readable.length) return { ...empty, programmes: byProg.size, reason: 'no readable position-seasons' };

  const dialSeries = {
    freshman: readable.map((o) => o.freshShare).sort((a, b) => a - b),
    newcomer: readable.map((o) => o.newcomerShare).sort((a, b) => a - b),
    returning: readable.map((o) => o.returningShare).sort((a, b) => a - b),
  };

  const band = (i) => readable.filter(
    (o) => o.vacatedStarterShare >= BINS[i] && o.vacatedStarterShare < BINS[i + 1],
  );
  const gone = readable.filter((o) => o.departedStarters > 0);
  const stayed = readable.filter((o) => o.departedStarters === 0);
  const withFreshStarter = (list) => (list.length
    ? Math.round(1000 * list.filter((o) => o.freshStarters > 0).length / list.length) / 10 : null);

  return {
    sufficient: true, sport, seasons: SEASONS,
    programmes: byProg.size,
    observations: obs.length,
    readable: readable.length,
    ladderByRank: [...ladders.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, values]) => {
        const s = values.sort((a, b) => a - b);
        return { rank, n: s.length, p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75) };
      }),
    dials: Object.fromEntries(Object.entries(dialSeries).map(([k, s]) => [k, {
      p25: pct(quantile(s, 0.25)), median: pct(quantile(s, 0.5)), p75: pct(quantile(s, 0.75)),
    }])),
    fillMix: BINS.slice(0, -1).map((_, i) => {
      const sub = band(i);
      if (!sub.length) return null;
      return {
        band: `${Math.round(BINS[i] * 100)}–${Math.round(BINS[i + 1] * 100)}%`,
        n: sub.length,
        returning: pct(mean(sub.map((o) => o.returningShare))),
        freshman: pct(mean(sub.map((o) => o.freshShare))),
        newcomer: pct(mean(sub.map((o) => o.newcomerShare))),
      };
    }).filter(Boolean),
    vacancy: {
      starterDeparted: { n: gone.length, pctWithAFreshStarter: withFreshStarter(gone) },
      noStarterDeparted: { n: stayed.length, pctWithAFreshStarter: withFreshStarter(stayed) },
    },
    byPosition: POSITIONS.map((pos) => {
      const at = readable.filter((o) => o.pos === pos);
      return {
        pos, n: at.length,
        pctFreshStarter_gone: withFreshStarter(at.filter((o) => o.departedStarters > 0)),
        pctFreshStarter_stay: withFreshStarter(at.filter((o) => o.departedStarters === 0)),
      };
    }),
    builtAt: new Date().toISOString(),
    buildMs: Date.now() - started,
    fingerprint: fingerprint(),
  };
}

/**
 * The cached benchmarks, rebuilt when the roster underneath them has changed.
 *
 * The importers are separate CLI processes, so nothing can push an
 * invalidation into a running server — the fingerprint is how a re-import
 * becomes visible here. It is only re-taken every RECHECK_MINUTES, so the cost
 * on the request path amortises to nothing.
 *
 * Concurrent callers share one build. Returning early to the second caller
 * would hand it no answer at all, which is the difference between this and the
 * `skipped` that syncScheduler returns.
 */
export function poolBenchmarks(sport) {
  const hit = cache.get(sport);
  if (hit) {
    const age = Date.now() - hit.checkedAt;
    if (age < RECHECK_MINUTES * 60_000) return hit.value;
    if (fingerprint() === hit.value.fingerprint) {
      hit.checkedAt = Date.now();
      return hit.value;
    }
  }
  if (building.has(sport)) return building.get(sport);
  const value = buildPoolBenchmarks(sport);
  cache.set(sport, { value, checkedAt: Date.now() });
  building.delete(sport);
  return value;
}

export function poolStatus() {
  return {
    recheckMinutes: RECHECK_MINUTES,
    sports: [...cache.entries()].map(([sport, { value, checkedAt }]) => ({
      sport,
      sufficient: value.sufficient,
      builtAt: value.builtAt,
      buildMs: value.buildMs,
      programmes: value.programmes,
      observations: value.observations,
      minutesSinceChecked: Math.round((Date.now() - checkedAt) / 60_000),
      stale: fingerprint() !== value.fingerprint,
    })),
  };
}

export function invalidatePoolBenchmarks() {
  const cleared = [...cache.keys()];
  cache.clear();
  building.clear();
  return cleared;
}

/**
 * Where one programme's figure sits in the pool, as a percentile.
 *
 * Null rather than 50 when the pool is not readable — a made-up midpoint is
 * the worst possible answer here, because it looks like a measurement.
 */
export function percentileOfLadderTop(benchmarks, minutes) {
  if (!benchmarks?.sufficient || minutes == null) return null;
  const rank1 = benchmarks.ladderByRank.find((r) => r.rank === 1);
  if (!rank1) return null;
  if (minutes <= rank1.p25) return 25;
  if (minutes <= rank1.median) return 50;
  if (minutes <= rank1.p75) return 75;
  return 90;
}

/** The pool's fill mix for the band a programme's own vacancy rate falls in. */
export function poolMixForBand(benchmarks, vacatedStarterShare) {
  if (!benchmarks?.sufficient || vacatedStarterShare == null) return null;
  const i = BINS.findIndex((b, k) => vacatedStarterShare >= b && vacatedStarterShare < BINS[k + 1]);
  return benchmarks.fillMix[i] ?? null;
}

export { ladderByRank };
