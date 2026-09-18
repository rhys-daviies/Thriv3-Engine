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
 *
 * ---------------------------------------------------------------------------
 * TWO MODES, AND WHY THE SECOND ONE EXISTS.
 *
 * BROAD (unchanged, and still the only thing `npm run import-rosters` does):
 * each file replaces its whole `(sport, division, season)` slice. That is
 * correct for a full re-import and catastrophic for a targeted one -- a sheet
 * holding six programmes would delete the other three hundred in its file.
 *
 * SCOPED (L7X): the caller names exact `(programme, season)` pairs and nothing
 * outside them is read or written. L7W repaired six programmes' 2025 squads
 * and could not put them in the database, because reconciling six would have
 * rewritten roughly two thousand programme-seasons. The scope is the whole
 * point: `changed_keys ⊆ R`, with BOTH dimensions required. A programme key
 * alone would take 2025 and 2026 together; a season alone would take
 * everything.
 *
 * The two modes share one record builder and one diff. Scoped mode never falls
 * back to broad: an unusable scope is an error, never a wider import.
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
function arg(name, fallback, argv = process.argv) {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
}

export const DEFAULT_SEASON = '2025';

export function defaultDir(season) {
  return path.resolve(__dirname, `../seed/data/rosters_${season}`);
}

/** The ten sheets a season is spread across, and the division each asserts. */
export function sheetSpecs(season) {
  return [
    { file: `ncaa_d1_mens_soccer_${season}_rosters.csv`, sport: 'mens-soccer', division: 'NCAA D1' },
    { file: `ncaa_d2_mens_soccer_${season}_rosters.csv`, sport: 'mens-soccer', division: 'NCAA D2' },
    { file: `ncaa_d3_mens_soccer_${season}_rosters.csv`, sport: 'mens-soccer', division: 'NCAA D3' },
    { file: `naia_mens_soccer_${season}_rosters.csv`, sport: 'mens-soccer', division: 'NAIA' },
    { file: `ncaa_d1_womens_soccer_${season}_rosters.csv`, sport: 'womens-soccer', division: 'NCAA D1' },
    { file: `ncaa_d2_womens_soccer_${season}_rosters.csv`, sport: 'womens-soccer', division: 'NCAA D2' },
    { file: `ncaa_d3_womens_soccer_${season}_rosters.csv`, sport: 'womens-soccer', division: 'NCAA D3' },
    { file: `naia_womens_soccer_${season}_rosters.csv`, sport: 'womens-soccer', division: 'NAIA' },
    // USCAA. The roster CSVs carry no division column — a row's division is the
    // file it sits in — so a school filed under ncaa_d3_* is asserted to be NCAA
    // D3 by its location alone. Penn State Schuylkill is not: it plays the PSUAC
    // and contested the 2025 USCAA Division II national championship.
    { file: `uscaa_mens_soccer_${season}_rosters.csv`, sport: 'mens-soccer', division: 'USCAA' },
    { file: `uscaa_womens_soccer_${season}_rosters.csv`, sport: 'womens-soccer', division: 'USCAA' },
  ];
}

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

/**
 * One sheet, read into roster_players rows. PURE: no database access, no
 * writes, no console output.
 *
 * Extracted from `importFile` so the broad path, the scoped path and the
 * dry-run all build records the same way. A second reader would be a second
 * set of rules about what a roster row means, and the diff a dry-run prints
 * would stop describing the import it is previewing.
 */
export function recordsFromFile({ file, sport, division }, { season, dir }) {
  const SEASON = String(season);
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) {
    return { skipped: true, records: [], renamed: new Map(), rejected: [],
      unnamed: [], impossibleGrad: [], gradYearDisagreements: [] };
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
        /*
         * L7Z acquisition provenance, TRANSPORTED AND NEVER DERIVED.
         *
         * A sheet written before these columns existed has no such keys, so
         * they arrive `undefined` and the row stores NULL. That is the correct
         * reading: the fact was not recorded. Nothing here falls back to the
         * season being imported, to the clock, or to the URL's shape -- each of
         * which would manufacture exactly the false confidence L7W had to spend
         * a stage undoing.
         */
        source_page_season: (row['Source Page Season'] || '').trim() || undefined,
        source_fetched_at: (row['Source Fetched At'] || '').trim() || undefined,
        source_parser: (row['Source Parser'] || '').trim() || undefined,
      };
    })
    .filter(Boolean);

  return { skipped: false, records, renamed, rejected, unnamed, impossibleGrad,
    gradYearDisagreements };
}

/**
 * Everything the import says out loud about one sheet. Unchanged text; it just
 * takes what `recordsFromFile` found instead of closing over it.
 */
function reportFile({ file, sport }, { records, renamed, rejected, unnamed,
  impossibleGrad, gradYearDisagreements }, season) {
  const SEASON = String(season);
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

/** BROAD: replace each sheet's whole (sport, division, season) slice. */
function importFileBroad(spec, { season, dir }) {
  const found = recordsFromFile(spec, { season, dir });
  if (found.skipped) {
    console.log(`  ${spec.file}: not present, skipped`);
    return { count: 0, rejected: 0, skipped: true };
  }
  // Re-runnable: wipe this exact (sport, division, season) slice before
  // reinserting, so re-running against an updated CSV never duplicates rows.
  RosterPlayer.deleteWhere({ sport: spec.sport, division: spec.division, season: String(season) });
  RosterPlayer.bulkCreate(found.records);
  return reportFile(spec, found, season);
}

export function runBroad({ season = DEFAULT_SEASON, dir = null } = {}) {
  const d = dir ?? defaultDir(season);
  console.log(`Importing ${season} roster sheets into roster_players from ${d}`);
  let total = 0;
  let rejected = 0;
  let loaded = 0;
  for (const spec of sheetSpecs(season)) {
    const result = importFileBroad(spec, { season, dir: d });
    total += result.count;
    rejected += result.rejected;
    if (!result.skipped) loaded += 1;
  }
  console.log(`Done. ${total} ${season} roster players imported across ${loaded} file(s).`);
  if (rejected) {
    console.log(`${rejected} class-year cell(s) were rejected — see the per-file detail above.`);
  }
  return { total, rejected, loaded };
}

/* ========================================================================== *
 * L7X — SCOPED IMPORT                                                        *
 * ========================================================================== */

/**
 * The canonical scoped-import identity: a programme AND a season.
 *
 * `School||sport||season`, the programme half being exactly the key the
 * acquisition pipeline already uses (`state.key`, `School||Sport`) with the
 * season appended. Deliberately not a school-only key and deliberately not a
 * season-only one:
 *
 *   Rutgers||mens-soccer||2025   Rutgers||womens-soccer||2025
 *   Rutgers||mens-soccer||2026
 *
 * are three distinct scopes, and no scope may address more than one of them.
 * Carried as a structured `{ college_name, sport, season }` everywhere inside
 * the importer; the string form exists only for the CLI and for map keys,
 * because a concatenated key is a thing that can be built wrong silently.
 */
export const SCOPE_SPORTS = Object.freeze(['mens-soccer', 'womens-soccer']);

/** The seasons a sheet directory can exist for. A typo must not be a scope. */
export const SCOPE_SEASON_RE = /^(19|20)\d{2}$/;

export function scopeKey({ college_name, sport, season }) {
  return `${college_name}||${sport}||${season}`;
}

/**
 * Parse one scope line. Throws rather than guessing — every failure mode the
 * L7X contract names is an error here, not a narrower or wider import.
 */
export function parseScopeEntry(raw) {
  const line = String(raw ?? '').trim();
  if (!line) throw new Error('empty scope entry');
  const parts = line.split('||');
  if (parts.length !== 3) {
    throw new Error(`malformed scope entry ${JSON.stringify(line)}: `
      + 'expected exactly School||sport||season');
  }
  const [college_name, sport, season] = parts.map((x) => x.trim());
  if (!college_name) throw new Error(`malformed scope entry ${JSON.stringify(line)}: no school`);
  if (!SCOPE_SPORTS.includes(sport)) {
    throw new Error(`malformed scope entry ${JSON.stringify(line)}: `
      + `sport must be one of ${SCOPE_SPORTS.join(', ')}`);
  }
  if (!season) throw new Error(`scope entry ${JSON.stringify(line)} has no season`);
  if (!SCOPE_SEASON_RE.test(season)) {
    throw new Error(`scope entry ${JSON.stringify(line)}: unsupported season ${JSON.stringify(season)}`);
  }
  return { college_name, sport, season };
}

/**
 * A scope file or a list of entries, deduped.
 *
 * A repeated entry is the same instruction twice, so it dedupes rather than
 * erroring — but two entries that differ only in whitespace must not become
 * two scopes, which is why parsing normalises before the key is built.
 */
export function parseScope(lines) {
  const out = new Map();
  let duplicates = 0;
  for (const raw of lines) {
    const line = String(raw ?? '').trim();
    if (!line || line.startsWith('#')) continue;
    const e = parseScopeEntry(line);
    const k = scopeKey(e);
    if (out.has(k)) { duplicates += 1; continue; }
    out.set(k, e);
  }
  return { scope: out, duplicates };
}

export function loadScopeFile(file) {
  if (!fs.existsSync(file)) throw new Error(`scope file not found: ${file}`);
  return parseScope(fs.readFileSync(file, 'utf-8').split('\n'));
}

/**
 * Every programme-season the season's sheets hold, keyed canonically.
 *
 * Built by reading all ten sheets once and grouping the records — so a scope
 * entry is matched against the school name AFTER alias resolution, which is
 * the same name the database column holds. Matching before resolution would
 * silently miss every aliased programme.
 *
 * `divisions` is a set on purpose. One programme-season appearing in two
 * sheets means two divisions claim it, and the importer cannot choose; that is
 * the ambiguity the contract stops on.
 */
export function indexSheets({ season, dir }) {
  const byKey = new Map();
  const missingFiles = [];
  for (const spec of sheetSpecs(season)) {
    const found = recordsFromFile(spec, { season, dir });
    if (found.skipped) { missingFiles.push(spec.file); continue; }
    for (const r of found.records) {
      const k = scopeKey({ college_name: r.college_name, sport: r.sport, season: String(season) });
      if (!byKey.has(k)) {
        byKey.set(k, { college_name: r.college_name, sport: r.sport, season: String(season),
          divisions: new Set(), files: new Set(), records: [] });
      }
      const g = byKey.get(k);
      g.divisions.add(r.division);
      g.files.add(spec.file);
      g.records.push(r);
    }
  }
  return { byKey, missingFiles };
}

/** The importer-owned fields. What a scoped import may move, and nothing else. */
export const OWNED_FIELDS = Object.freeze([
  'conference', 'class_year_label', 'position', 'minutes_played', 'games_played',
  'games_started', 'estimated_graduation_year', 'eligibility_end_year', 'nationality',
  'hometown', 'country', 'source_stats_url', 'source_roster_url', 'data_confidence',
  'notes', 'division',
  'source_page_season', 'source_fetched_at', 'source_parser',
]);

const norm = (v) => (v === undefined || v === null || v === '' ? null : v);

function ownedOf(row) {
  const o = {};
  for (const f of OWNED_FIELDS) o[f] = norm(row[f]);
  return o;
}

function sameOwned(a, b) {
  for (const f of OWNED_FIELDS) if (norm(a[f]) !== norm(b[f])) return false;
  return true;
}

/**
 * The plan for one explicit scope. THE ONLY selection and diff logic there is:
 * the dry-run prints this and the live import executes this, so a preview
 * cannot describe an import that would not happen.
 */
export function planScopedImport({ season, dir, scope }) {
  if (scope == null) {
    throw new Error('scoped import requires an explicit scope. Omitting it is not a '
      + 'shorthand for every programme in the season -- use runBroad() for that.');
  }
  const wanted = scope instanceof Map ? scope : parseScope(scope).scope;
  for (const [, e] of wanted) {
    if (String(e.season) !== String(season)) {
      throw new Error(`scope entry ${scopeKey(e)} is not in season ${season}`);
    }
  }
  const { byKey, missingFiles } = wanted.size ? indexSheets({ season, dir })
    : { byKey: new Map(), missingFiles: [] };

  const entries = [];
  const missing = [];
  const ambiguous = [];
  for (const [k, e] of [...wanted].sort(([a], [b]) => a.localeCompare(b))) {
    const g = byKey.get(k);
    if (!g) { missing.push(k); continue; }
    if (g.divisions.size > 1) {
      ambiguous.push({ key: k, divisions: [...g.divisions].sort(), files: [...g.files].sort() });
      continue;
    }
    const existing = db.prepare(
      'SELECT * FROM roster_players WHERE college_name = ? AND sport = ? AND season = ?',
    ).all(e.college_name, e.sport, e.season);

    const sheetBy = new Map(g.records.map((r) => [r.player_name, r]));
    const dbBy = new Map(existing.map((r) => [r.player_name, r]));
    const insert = [];
    const update = [];
    const unchanged = [];
    for (const [name, r] of sheetBy) {
      const was = dbBy.get(name);
      if (!was) { insert.push(name); continue; }
      (sameOwned(r, was) ? unchanged : update).push(name);
    }
    const remove = [...dbBy.keys()].filter((n) => !sheetBy.has(n));

    const provenance = [];
    for (const [name, r] of sheetBy) {
      const was = dbBy.get(name);
      if (was && norm(was.source_roster_url) !== norm(r.source_roster_url)) {
        provenance.push({ player: name, from: was.source_roster_url, to: r.source_roster_url });
      }
    }
    entries.push({
      key: k, ...e, division: [...g.divisions][0], files: [...g.files].sort(),
      sheetRows: g.records.length, dbRows: existing.length,
      insert, update, remove, unchanged, provenance, records: g.records,
    });
  }
  return { season: String(season), dir, requested: wanted.size, entries, missing, ambiguous, missingFiles };
}

/**
 * Execute a plan, or report it.
 *
 * ONE TRANSACTION for the whole scope. The existing broad path commits each
 * sheet as it goes -- ten independent transactions, so a failure on the eighth
 * leaves seven imported -- and for a targeted reconciliation that is the wrong
 * shape: six repaired programmes are one decision, and three of six is a state
 * nobody asked for. `better-sqlite3` rolls the whole thing back if the
 * function throws.
 *
 * Validation happens BEFORE the transaction opens: a missing or ambiguous
 * scope entry is a reason not to start, not something to discover halfway.
 */
export function importScoped({ season = DEFAULT_SEASON, dir = null, scope,
  dryRun = false, allowMissing = false } = {}) {
  const d = dir ?? defaultDir(season);
  const plan = planScopedImport({ season, dir: d, scope });

  if (plan.ambiguous.length) {
    const first = plan.ambiguous[0];
    throw new Error(`scope entry ${first.key} is ambiguous: divisions `
      + `${first.divisions.join(', ')} across ${first.files.join(', ')}. `
      + 'The importer cannot choose which sheet owns the programme.');
  }
  if (plan.missing.length && !allowMissing) {
    throw new Error(`${plan.missing.length} scope entry/entries absent from the ${season} `
      + `sheets: ${plan.missing.slice(0, 5).join(', ')}. Nothing was written.`);
  }
  if (dryRun) return { ...plan, applied: false };

  const apply = db.transaction(() => {
    let deleted = 0;
    let inserted = 0;
    for (const e of plan.entries) {
      // Scoped delete: (college_name, sport, season) and NOTHING else. Division
      // is deliberately absent -- a programme that changed division would
      // otherwise leave its old rows behind, outside every future scope.
      deleted += RosterPlayer.deleteWhere({
        college_name: e.college_name, sport: e.sport, season: e.season,
      }).deleted;
      RosterPlayer.bulkCreate(e.records);
      inserted += e.records.length;
    }
    return { deleted, inserted };
  });
  const counts = apply();
  return { ...plan, applied: true, ...counts };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * BROAD unless a scope is named, and there is no third possibility.
 *
 *   npm run import-rosters                              # broad, 2025
 *   npm run import-rosters -- --season 2026             # broad, 2026
 *   npm run import-rosters -- --season 2025 --scope f   # scoped
 *   ... --key 'Iowa||womens-soccer||2025'               # scoped, repeatable
 *   ... --scope f --dry-run                             # scoped, no mutation
 *
 * `--scope` or `--key` selects scoped mode, and once selected it cannot widen:
 * an unreadable file, a malformed key or an absent programme all throw. A
 * scope that parses to nothing writes nothing -- which is the correct reading
 * of "import these zero programmes", and the reason empty is not an error.
 */
export function main(argv = process.argv) {
  const season = String(arg('season', DEFAULT_SEASON, argv));
  const dir = path.resolve(arg('dir', defaultDir(season), argv));
  const dryRun = argv.includes('--dry-run');

  /*
   * MODE IS CHOSEN BY THE PRESENCE OF THE FLAG, NOT BY ITS VALUE.
   *
   * `arg()` falls back when the value is missing, so reading the scope with it
   * would turn `--scope` with an empty or absent value into a BROAD import of
   * the whole season -- a scoped request silently widening, which is the one
   * thing this stage exists to make impossible. Presence and value are read
   * separately so an unusable value is an error rather than a wider run.
   */
  const wantsScope = argv.includes('--scope') || argv.includes('--key');
  const scopeAt = argv.indexOf('--scope');
  const scopeFile = scopeAt > -1 ? argv[scopeAt + 1] : null;
  const keys = argv.reduce((acc, a, i) => (a === '--key' ? [...acc, argv[i + 1]] : acc), []);

  if (!wantsScope) {
    if (dryRun) throw new Error('--dry-run is only available for scoped imports. '
      + 'Name a --scope file or --key entries.');
    return runBroad({ season, dir });
  }
  if (scopeAt > -1 && argv.includes('--key')) {
    throw new Error('pass --scope or --key, not both: two scope sources is two answers '
      + 'to "what may this import touch".');
  }
  if (scopeAt > -1 && (!scopeFile || scopeFile.startsWith('--'))) {
    throw new Error('--scope needs a file. It is not a shorthand for the whole season.');
  }
  if (argv.includes('--key') && keys.some((k) => !k || k.startsWith('--'))) {
    throw new Error('--key needs a School||sport||season value.');
  }
  const parsed = scopeAt > -1 ? loadScopeFile(scopeFile) : parseScope(keys);
  const r = importScoped({ season, dir, scope: parsed.scope, dryRun,
    allowMissing: argv.includes('--allow-missing') });

  console.log(`\n${dryRun ? 'DRY RUN' : 'SCOPED IMPORT'} — season ${season}, `
    + `${r.requested} scope entr${r.requested === 1 ? 'y' : 'ies'}`
    + `${parsed.duplicates ? ` (${parsed.duplicates} duplicate(s) deduped)` : ''}`);
  console.log(`  from ${dir}`);
  if (r.missingFiles.length) console.log(`  sheets absent: ${r.missingFiles.length}`);
  console.log(`  matched ${r.entries.length}, missing ${r.missing.length}, ambiguous ${r.ambiguous.length}\n`);
  console.log('  programme-season                                  div    sheet   db  +ins  ~upd  -del   =same  prov');
  for (const e of r.entries) {
    console.log(`  ${e.key.padEnd(48).slice(0, 48)} ${String(e.division).padEnd(7)}`
      + `${String(e.sheetRows).padStart(5)}${String(e.dbRows).padStart(5)}`
      + `${String(e.insert.length).padStart(6)}${String(e.update.length).padStart(6)}`
      + `${String(e.remove.length).padStart(6)}${String(e.unchanged.length).padStart(8)}`
      + `${String(e.provenance.length).padStart(6)}`);
  }
  for (const k of r.missing) console.log(`  MISSING FROM SHEETS  ${k}`);
  const t = (f) => r.entries.reduce((n, e) => n + e[f].length, 0);
  console.log(`\n  totals   sheet rows ${r.entries.reduce((n, e) => n + e.sheetRows, 0)}`
    + `   db rows ${r.entries.reduce((n, e) => n + e.dbRows, 0)}`
    + `   +${t('insert')} ~${t('update')} -${t('remove')} =${t('unchanged')}`
    + `   provenance changes ${t('provenance')}`);
  if (r.applied) console.log(`  APPLIED  ${r.deleted} row(s) deleted, ${r.inserted} inserted, one transaction`);
  else console.log('  nothing was written.');
  return r;
}

/*
 * RUN ONLY WHEN RUN.
 *
 * This file used to call `run()` at module scope, so `import`ing it executed a
 * full import of whatever season the ambient argv named. That is why the
 * importer has never had a test: there was no way to load it without it
 * writing to the database first. Same defect L7Q found in `build_targets.py`,
 * in a file that deletes rows.
 */
if (import.meta.url === `file://${process.argv[1]}`) main();
