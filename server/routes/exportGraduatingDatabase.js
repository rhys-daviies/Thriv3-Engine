import { GraduatingSenior } from '../db/entities/graduatingSenior.js';
import { buildCsv } from '../lib/csv.js';

const COLUMNS = [
  'college_name', 'season', 'confirmed_division', 'data_confidence', 'total_graduating_seniors',
  'player_name', 'player_position', 'player_minutes_played', 'official_roster_url', 'notes',
];

/**
 * Exports all GraduatingSenior records as CSV, one row per player (a school
 * with zero players still gets a single row with empty player fields).
 */
export function exportGraduatingDatabaseCsv({ season, sport = 'mens-soccer' } = {}) {
  const query = { sport };
  if (season) query.season = season;
  const records = GraduatingSenior.filter(query);

  const rows = [];
  for (const r of records) {
    const base = {
      college_name: r.college_name,
      season: r.season,
      confirmed_division: r.confirmed_division || '',
      data_confidence: r.data_confidence || '',
      total_graduating_seniors: r.total_graduating_seniors ?? 0,
      official_roster_url: r.official_roster_url || '',
      notes: r.notes || '',
    };
    const players = r.players || [];
    if (players.length === 0) {
      rows.push({ ...base, player_name: '', player_position: '', player_minutes_played: '' });
    } else {
      for (const p of players) {
        rows.push({ ...base, player_name: p.name, player_position: p.position, player_minutes_played: p.minutes_played ?? '' });
      }
    }
  }

  return buildCsv(rows, COLUMNS);
}
