/**
 * One place that knows what a V2 pool run needs from the database.
 *
 * Every diagnostic used to build this object itself, which meant a new
 * evidence input had to be added to six SELECTs by hand - and when
 * A7.7.2 added the appearance columns, the first script to run against the
 * repaired database reported MIT as unrankable because its own query was
 * stale. One builder, one query, one place to change.
 */
import { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } from './rosterEvidence.js';
import { buildMarketIndex, stateCentroids, utilisationCounts } from './recruitingMarketEvidence.js';
import { buildRosterIndex } from '../../../shared/matching/pool.js';

export const ROSTER_COLUMNS = `
  college_name, player_name, position, minutes_played, projected_minutes,
  games_played, games_started, projected_games_started, projected_games_played,
  estimated_graduation_year, eligibility_end_year, country, nationality, hometown,
  season, division, class_year_label`;

export function buildPoolContext({ db, sport, season = '2026', nearBandKm }) {
  const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
  const roster = db.prepare(
    `SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport = ? AND season = ?`,
  ).all(sport, season);
  const arrivals = db.prepare(
    'SELECT programme, sport, arrival_season, canonical_position, is_international FROM recruiting_arrivals WHERE sport = ?',
  ).all(sport);
  /** Arrivals joined to the recruit's own roster row, for their home town. */
  const marketRows = db.prepare(`
    SELECT a.programme, a.is_international, r.hometown, c.division, c.latitude, c.longitude
      FROM recruiting_arrivals a
      JOIN roster_players r ON r.id = a.roster_row_id
      JOIN colleges c ON c.name = a.programme AND c.sport = a.sport AND c.active = 1
     WHERE a.sport = ?`).all(sport);

  const centroids = stateCentroids(colleges);
  return {
    colleges,
    roster,
    rosterProgrammes: new Set(roster.map((r) => r.college_name)),
    rosterIndex: buildPositionIndex(roster),
    v1RosterIndex: buildRosterIndex(roster),
    arrivalIndex: buildArrivalIndex(arrivals),
    divisionArrivals: divisionArrivalRates(arrivals, new Map(colleges.map((c) => [c.name, c]))),
    arrivalsHorizon: arrivals.reduce((m, r) => Math.max(m, Number(r.arrival_season) || 0), 0),
    centroids,
    marketIndex: buildMarketIndex(marketRows, { centroids, nearBandKm }),
    utilisation: utilisationCounts(roster),
    marketRows,
  };
}
