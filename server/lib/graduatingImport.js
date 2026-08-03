import { parseCsvToObjects } from './csv.js';
import { normalizePosition, buildPositionData } from './positions.js';

function normalizeConfidence(raw) {
  if (!raw) return 'medium';
  const s = String(raw).trim().toLowerCase();
  if (['high', 'medium', 'low'].includes(s)) return s;
  const n = parseFloat(s);
  if (!Number.isNaN(n)) {
    if (n >= 80) return 'high';
    if (n >= 60) return 'medium';
    return 'low';
  }
  return 'medium';
}

/**
 * Groups raw importGraduatingCSV rows (one row per player, Section 10 schema)
 * into GraduatingSenior-ready records, one per college. Shared by the
 * importGraduatingCSV route and the local seed script so both exercise the
 * exact same normalization logic.
 */
export function groupCsvRowsIntoRecords(rows, sport) {
  const bySchool = new Map();

  for (const row of rows) {
    const collegeName = (row.college_name || '').trim();
    if (!collegeName) continue;
    const season = (row.season || '2025').trim();
    const key = `${collegeName}::${season}`;

    if (!bySchool.has(key)) {
      bySchool.set(key, {
        college_name: collegeName,
        season,
        confirmed_division: (row.confirmed_division || '').trim() || undefined,
        data_confidence: normalizeConfidence(row.data_confidence),
        official_roster_url: (row.official_roster_url || '').trim() || undefined,
        notes: (row.notes || '').trim() || undefined,
        explicit_total: row.total_graduating_seniors ? Number(row.total_graduating_seniors) : undefined,
        players: [],
      });
    }

    const school = bySchool.get(key);
    const playerName = (row.player_name || '').trim();
    if (playerName) {
      school.players.push({
        name: playerName,
        position: normalizePosition(row.player_position),
        minutes_played: row.player_minutes_played ? Number(row.player_minutes_played) || 0 : 0,
      });
    }
  }

  const records = [];
  for (const school of bySchool.values()) {
    const allNames = school.players.map((p) => p.name);
    records.push({
      college_name: school.college_name,
      season: school.season,
      confirmed_division: school.confirmed_division,
      official_roster_url: school.official_roster_url,
      notes: school.notes,
      data_confidence: school.data_confidence,
      total_graduating_seniors: school.explicit_total ?? allNames.length,
      all_graduating_senior_names: allNames,
      players: school.players,
      position_data: buildPositionData(school.players),
      sport: sport || 'mens-soccer',
    });
  }
  return records;
}

export function parseGraduatingCsvText(text, sport) {
  const rows = parseCsvToObjects(text);
  return groupCsvRowsIntoRecords(rows, sport);
}
