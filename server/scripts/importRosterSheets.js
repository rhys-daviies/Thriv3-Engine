import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvToObjects } from '../lib/csv.js';
import { normalizePosition } from '../lib/positions.js';
import { readClassYear } from '../lib/classYear.js';
import { RosterPlayer } from '../db/entities/rosterPlayer.js';

/**
 * One-off (re-runnable) import of the 2025 full-roster CSVs into
 * roster_players — the rebuild that replaced the old "graduating seniors
 * only, no position" model. Each file covers one sport+division; every
 * rostered player gets a row tagged with their own estimated_graduation_year,
 * not just current seniors. See memory/graduating-db-rebuild.md for the
 * decisions behind this shape.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../seed/data/rosters_2025');
const SEASON = '2025';

const FILES = [
  { file: 'ncaa_d1_mens_soccer_2025_rosters.csv', sport: 'mens-soccer', division: 'NCAA D1' },
  { file: 'ncaa_d2_mens_soccer_2025_rosters.csv', sport: 'mens-soccer', division: 'NCAA D2' },
  { file: 'ncaa_d3_mens_soccer_2025_rosters.csv', sport: 'mens-soccer', division: 'NCAA D3' },
  { file: 'naia_mens_soccer_2025_rosters.csv', sport: 'mens-soccer', division: 'NAIA' },
  { file: 'ncaa_d1_womens_soccer_2025_rosters.csv', sport: 'womens-soccer', division: 'NCAA D1' },
  { file: 'ncaa_d2_womens_soccer_2025_rosters.csv', sport: 'womens-soccer', division: 'NCAA D2' },
  { file: 'ncaa_d3_womens_soccer_2025_rosters.csv', sport: 'womens-soccer', division: 'NCAA D3' },
  { file: 'naia_womens_soccer_2025_rosters.csv', sport: 'womens-soccer', division: 'NAIA' },
];

function normalizeConfidence(raw) {
  const s = (raw || '').trim().toLowerCase();
  return ['high', 'medium', 'low'].includes(s) ? s : 'medium';
}

function toIntOrNull(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isNaN(n) ? null : n;
}

function importFile({ file, sport, division }) {
  const filePath = path.join(DATA_DIR, file);
  const text = fs.readFileSync(filePath, 'utf-8');
  const rows = parseCsvToObjects(text);
  const rejected = [];

  const records = rows
    .map((row) => {
      const college_name = (row['School'] || '').trim();
      const player_name = (row['Player Name'] || '').trim();
      if (!college_name || !player_name) return null;

      // Refuse a class-year cell that is not a class year. Texas Tech's roster
      // has a Club column where the class belongs, so fifteen players imported
      // as "FC Dallas" or "Real Colorado" and one — "Solar" — was given a
      // graduation year of 2029. Keeping the raw value in notes means the
      // rejection is auditable rather than a silent blank.
      const rawClass = (row['Class/Year'] || '').trim();
      const read = readClassYear(rawClass, { season: SEASON });
      if (!read.recognised) rejected.push({ college_name, player_name, rawClass });

      const csvGradYear = toIntOrNull(row['Estimated Graduation']);
      const noteParts = [(row['Notes'] || '').trim()];
      if (!read.recognised) noteParts.push(`class-year cell rejected: ${JSON.stringify(rawClass)}`);

      return {
        college_name,
        sport,
        division,
        season: SEASON,
        conference: (row['Conference'] || '').trim() || undefined,
        player_name,
        class_year_label: (read.recognised ? rawClass : '') || undefined,
        position: normalizePosition(row['Position']),
        minutes_played: toIntOrNull(row['Total Minutes Played']) ?? 0,
        games_played: toIntOrNull(row['Games Played']),
        games_started: toIntOrNull(row['Games Started']),
        // The sheet wins where it has an answer — it saw the page. Deriving
        // is the fallback for a roster that carried a class but no year, and
        // a rejected cell yields neither.
        estimated_graduation_year: read.recognised ? (csvGradYear ?? read.graduationYear) : null,
        nationality: (row['Nationality'] || '').trim() || undefined,
        hometown: (row['Hometown'] || '').trim() || undefined,
        country: (row['Country'] || '').trim() || undefined,
        source_stats_url: (row['Source Stats URL'] || '').trim() || undefined,
        source_roster_url: (row['Source Roster URL'] || '').trim() || undefined,
        data_confidence: normalizeConfidence(row['Data Confidence']),
        notes: noteParts.filter(Boolean).join('; ') || undefined,
      };
    })
    .filter(Boolean);

  // Re-runnable: wipe this exact (sport, division, season) slice before
  // reinserting, so re-running against an updated CSV never duplicates rows.
  RosterPlayer.deleteWhere({ sport, division, season: SEASON });
  RosterPlayer.bulkCreate(records);

  const withPosition = records.filter((r) => r.position !== 'UNKNOWN').length;
  const withGradYear = records.filter((r) => r.estimated_graduation_year != null).length;
  console.log(
    `  ${file}: ${records.length} players (${withPosition} with position, ${withGradYear} with estimated graduation)`
  );

  // Loud on purpose. A misread column is invisible in the totals above — the
  // rows still import, they just carry a club name where a class should be.
  if (rejected.length) {
    const bySchool = {};
    for (const r of rejected) bySchool[r.college_name] = (bySchool[r.college_name] || 0) + 1;
    console.log(`    !! ${rejected.length} class-year cell(s) rejected as not a class year:`);
    for (const [school, count] of Object.entries(bySchool).sort((a, b) => b[1] - a[1])) {
      const sample = rejected.find((r) => r.college_name === school).rawClass;
      console.log(`       ${school}: ${count} (e.g. ${JSON.stringify(sample)})`);
    }
    console.log('       Likely the wrong column was scraped. Check the roster page before trusting this school.');
  }
  return { count: records.length, rejected: rejected.length };
}

function run() {
  console.log('Importing 2025 roster sheets into roster_players...');
  let total = 0;
  let rejected = 0;
  for (const spec of FILES) {
    const result = importFile(spec);
    total += result.count;
    rejected += result.rejected;
  }
  console.log(`Done. ${total} total roster players imported across ${FILES.length} files.`);
  if (rejected) {
    console.log(`${rejected} class-year cell(s) were rejected — see the per-file detail above.`);
  }
}

run();
