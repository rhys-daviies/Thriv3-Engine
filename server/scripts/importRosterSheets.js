import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvToObjects } from '../lib/csv.js';
import { normalizePosition } from '../lib/positions.js';
import { readClassYear } from '../../shared/classYear.js';
import { isPlausibleName, cleanRosterName } from '../lib/rosterName.js';
import { registrySchoolName } from '../lib/rosterSchoolAliases.js';
import db from '../db/client.js';
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

/**
 * Season and source directory are arguments, not constants.
 *
 *   npm run import-rosters                 # 2025, from server/seed/data/rosters_2025
 *   npm run import-rosters -- --season 2024
 *   npm run import-rosters -- --season 2024 --dir "/path/to/2024 Roster Sheets"
 *
 * They were hardcoded, which is how 52,417 acquired 2024 rows sat on disk
 * doing nothing. NAIA files are imported when present and skipped when not —
 * the 2024 acquisition was scoped to D1-D3, and a missing file is a fact
 * about scope rather than an error.
 */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SEASON = String(arg('season', '2025'));
const DATA_DIR = path.resolve(arg('dir', path.resolve(__dirname, `../seed/data/rosters_${SEASON}`)));

const FILES = [
  { file: `ncaa_d1_mens_soccer_${SEASON}_rosters.csv`, sport: 'mens-soccer', division: 'NCAA D1' },
  { file: `ncaa_d2_mens_soccer_${SEASON}_rosters.csv`, sport: 'mens-soccer', division: 'NCAA D2' },
  { file: `ncaa_d3_mens_soccer_${SEASON}_rosters.csv`, sport: 'mens-soccer', division: 'NCAA D3' },
  { file: `naia_mens_soccer_${SEASON}_rosters.csv`, sport: 'mens-soccer', division: 'NAIA' },
  { file: `ncaa_d1_womens_soccer_${SEASON}_rosters.csv`, sport: 'womens-soccer', division: 'NCAA D1' },
  { file: `ncaa_d2_womens_soccer_${SEASON}_rosters.csv`, sport: 'womens-soccer', division: 'NCAA D2' },
  { file: `ncaa_d3_womens_soccer_${SEASON}_rosters.csv`, sport: 'womens-soccer', division: 'NCAA D3' },
  { file: `naia_womens_soccer_${SEASON}_rosters.csv`, sport: 'womens-soccer', division: 'NAIA' },
  // USCAA. The roster CSVs carry no division column — a row's division is the
  // file it sits in — so a school filed under ncaa_d3_* is asserted to be NCAA
  // D3 by its location alone. Penn State Schuylkill is not: it plays the PSUAC
  // and contested the 2025 USCAA Division II national championship.
  { file: `uscaa_mens_soccer_${SEASON}_rosters.csv`, sport: 'mens-soccer', division: 'USCAA' },
  { file: `uscaa_womens_soccer_${SEASON}_rosters.csv`, sport: 'womens-soccer', division: 'USCAA' },
];

function normalizeConfidence(raw) {
  const s = (raw || '').trim().toLowerCase();
  return ['high', 'medium', 'low'].includes(s) ? s : 'medium';
}

function toIntOrNull(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Imported schools with no row in `colleges` for that sport.
 *
 * Returns nothing when the registry is empty — a test database importing
 * rosters before any college exists is not reporting 1,900 orphans.
 */
function orphanSchools(records, sport) {
  const known = new Set(
    db.prepare('SELECT name FROM colleges WHERE sport = ?').all(sport).map((r) => r.name),
  );
  if (!known.size) return [];
  const counts = new Map();
  for (const r of records) {
    if (known.has(r.college_name)) continue;
    counts.set(r.college_name, (counts.get(r.college_name) || 0) + 1);
  }
  return [...counts].map(([name, rows]) => ({ name, rows })).sort((a, b) => b.rows - a.rows);
}

function importFile({ file, sport, division }) {
  const filePath = path.join(DATA_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.log(`  ${file}: not present, skipped`);
    return { count: 0, rejected: 0, skipped: true };
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  const rows = parseCsvToObjects(text);
  const rejected = [];
  // The sheet's precomputed graduation year against ours. Silence here is the
  // signal that the two agree; a large count means one of them has drifted.
  const gradYearDisagreements = [];
  const unnamed = [];
  const impossibleGrad = [];

  const renamed = new Map();
  const records = rows
    .map((row) => {
      // The roster sources write a school's full official name and the men's
      // registry writes a terse one, so a school can be spelled two ways and
      // therefore be invisible to every join in the product. Resolved to the
      // registry's spelling HERE rather than in each consumer: the join is
      // `college_name = colleges.name` in matching, philosophy and engagement
      // alike, and an alias applied in one of them is a bug in the other two.
      const rawSchool = (row['School'] || '').trim();
      const college_name = registrySchoolName(rawSchool, { sport, division });
      if (college_name !== rawSchool) renamed.set(rawSchool, college_name);
      const player_name = cleanRosterName(row['Player Name']);
      if (!college_name || !player_name) return null;

      // A name that is not a name. The 2024 scrape read the jersey column for
      // four D1 women's programmes and produced 120 players called "Jersey
      // Number 9" — which imported cleanly, because the class-year guard only
      // ever looked at the class column. Left alone they inflate turnover
      // enormously: Akron's women showed 60 departures from a 25-player squad,
      // because none of the placeholders can match a real name next season.
      if (!isPlausibleName(player_name)) {
        unnamed.push({ college_name, player_name });
        return null;
      }

      // Refuse a class-year cell that is not a class year. Texas Tech's roster
      // has a Club column where the class belongs, so fifteen players imported
      // as "FC Dallas" or "Real Colorado" and one — "Solar" — was given a
      // graduation year of 2029. Keeping the raw value in notes means the
      // rejection is auditable rather than a silent blank.
      const rawClass = (row['Class/Year'] || '').trim();
      const read = readClassYear(rawClass, { season: SEASON });
      if (!read.recognised) rejected.push({ college_name, player_name, rawClass });

      // A player on this season's roster has not graduated yet, so a
      // graduation year at or before the season is impossible whatever the
      // sheet says. 66 rows carried one -- 63 from a cross-season inference
      // that propagated an old value onto a player still enrolled, 3 printed
      // by the site itself. Rejected here rather than trusted, because the
      // Graduating Database groups by this column and an impossible year
      // creates a phantom cohort ("2 schools graduating in 2024").
      const csvGradYear = toIntOrNull(row['Estimated Graduation']);
      const seasonInt = parseInt(SEASON, 10);
      // Applied to whichever value wins below, not just to the sheet's: the
      // class column itself can print an impossible year. Massachusetts College
      // of Liberal Arts prints the season year there ("2022" on the 2022
      // roster), which the explicit-year path reads through untouched.
      const rejectIfGraduated = (yr) => {
        if (yr != null && yr <= seasonInt) {
          impossibleGrad.push({ college_name, player_name, year: yr });
          return null;
        }
        return yr;
      };
      if (read.recognised && read.graduationYear != null && csvGradYear != null && csvGradYear !== read.graduationYear) {
        gradYearDisagreements.push({ college_name, player_name, rawClass, sheet: csvGradYear, derived: read.graduationYear });
      }
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
        // NULL, not 0, when the cell is empty. A season in progress has no
        // minutes yet, and collapsing that to zero makes every player read as a
        // non-starter rather than as unknown -- which is exactly the wrong
        // signal for the roster-opportunity half of matching. 46,028 of the 2026
        // rows and 3,429 of the 2025 rows are absent, not zero.
        minutes_played: toIntOrNull(row['Total Minutes Played']),
        games_played: toIntOrNull(row['Games Played']),
        games_started: toIntOrNull(row['Games Started']),
        // Derived wins over the sheet's own "Estimated Graduation" column.
        // That column was not read off the page — it was computed by the same
        // helper during the scrape, back when YEARS_TO_GRADUATE was one year
        // too high, so it carries no independent information and re-importing
        // from it would silently restore a bug that took 109,886 rows to undo.
        // The sheet is still the fallback for a row whose class cell we could
        // not read; a rejected cell yields neither.
        estimated_graduation_year: read.recognised ? rejectIfGraduated(read.graduationYear ?? csvGradYear) : null,
        // Only ever derived. The sheet has no column for it, and it must not be
        // guessed from the academic year: without a class label there is no way
        // to tell a senior (one more year of eligibility) from a graduate (none).
        eligibility_end_year: read.recognised ? (read.eligibilityEndYear ?? null) : null,
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
  if (renamed.size) {
    console.log(`    ${renamed.size} school name(s) resolved to the registry's spelling, e.g. ${
      [...renamed].slice(0, 3).map(([f, t]) => `${JSON.stringify(f)} -> ${JSON.stringify(t)}`).join(', ')}`);
  }
  // A school the registry does not hold is a school no feature can read, and
  // it is silent: the rows import, the totals look right, and the programme
  // simply never appears. Say so on every import rather than discovering it
  // later from a coverage count.
  const orphans = orphanSchools(records, sport);
  if (orphans.length) {
    console.log(`    !! ${orphans.length} school(s) have no colleges row, so ${
      orphans.reduce((n, o) => n + o.rows, 0)} row(s) are invisible to every join:`);
    for (const o of orphans.slice(0, 8)) console.log(`       ${o.name} (${o.rows} players)`);
    if (orphans.length > 8) console.log(`       ...and ${orphans.length - 8} more`);
  }

  // Loud on purpose. A misread column is invisible in the totals above — the
  // rows still import, they just carry a club name where a class should be.
  if (unnamed.length) {
    const bySchool = {};
    for (const u of unnamed) bySchool[u.college_name] = (bySchool[u.college_name] || 0) + 1;
    console.log(`    !! ${unnamed.length} row(s) dropped — the name column is not a name:`);
    for (const [school, count] of Object.entries(bySchool).sort((a, b) => b[1] - a[1])) {
      const sample = unnamed.find((u) => u.college_name === school).player_name;
      console.log(`       ${school}: ${count} (e.g. ${JSON.stringify(sample)})`);
    }
    console.log('       That school has no usable roster for this season — re-scrape before trusting its turnover.');
  }
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
  if (impossibleGrad.length) {
    console.log(`    !! ${impossibleGrad.length} row(s) dropped a graduation year at or before the ${SEASON} season`);
    console.log(`       (a rostered player has not graduated yet) e.g. ${impossibleGrad.slice(0, 3)
      .map((r) => `${r.college_name}/${r.player_name} -> ${r.year}`).join(', ')}`);
  }
  if (gradYearDisagreements.length) {
    const share = Math.round((100 * gradYearDisagreements.length) / (records.length || 1));
    console.log(`    !! ${gradYearDisagreements.length} row(s) (${share}%) where the sheet's Estimated Graduation`);
    console.log(`       disagrees with the class label. The derived year was used.`);
    for (const d of gradYearDisagreements.slice(0, 5)) {
      console.log(`       ${d.college_name} / ${d.player_name}: ${JSON.stringify(d.rawClass)} -> derived ${d.derived}, sheet says ${d.sheet}`);
    }
    // Near-total disagreement means the two are on different conventions, not
    // that individual rows are odd — which is exactly what happened when
    // YEARS_TO_GRADUATE was off by one. A handful is ordinary scrape noise.
    if (share > 20) console.log('       That is most of the file: check classYear.js against a roster that prints an explicit year.');
  }
  return { count: records.length, rejected: rejected.length, unnamed: unnamed.length, gradYearDisagreements: gradYearDisagreements.length };
}

function run() {
  console.log(`Importing ${SEASON} roster sheets into roster_players from ${DATA_DIR}`);
  let total = 0;
  let rejected = 0;
  let loaded = 0;
  for (const spec of FILES) {
    const result = importFile(spec);
    total += result.count;
    rejected += result.rejected;
    if (!result.skipped) loaded += 1;
  }
  console.log(`Done. ${total} ${SEASON} roster players imported across ${loaded} file(s).`);
  if (rejected) {
    console.log(`${rejected} class-year cell(s) were rejected — see the per-file detail above.`);
  }
}

run();
