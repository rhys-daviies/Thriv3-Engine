import { GraduatingSenior } from '../db/entities/graduatingSenior.js';
import { parseGraduatingCsvText } from '../lib/graduatingImport.js';

/**
 * Fetches a CSV from a URL, parses/groups it, and upserts one GraduatingSenior
 * record per school. Section 10 / 12: the bulk-import alternative to running
 * buildGraduatingDatabase one school at a time.
 */
export async function importGraduatingCSV({ csv_url, csv_text, sport = 'mens-soccer' }) {
  let text = csv_text;
  if (!text) {
    if (!csv_url) throw new Error('csv_url or csv_text is required');
    const res = await fetch(csv_url);
    if (!res.ok) throw new Error(`Failed to fetch CSV: ${res.status}`);
    text = await res.text();
  }

  const records = parseGraduatingCsvText(text, sport);
  let totalPlayers = 0;
  for (const record of records) {
    totalPlayers += record.players.length;
    GraduatingSenior.upsert({ college_name: record.college_name, season: record.season, sport }, record);
  }

  return {
    status: 'imported',
    totalSchools: records.length,
    totalPlayers,
    sample: records.slice(0, 3).map((r) => ({ college_name: r.college_name, players: r.players.length })),
  };
}
