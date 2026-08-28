#!/usr/bin/env node
/**
 * Creates a `colleges` row for each programme that has roster data and no
 * registry entry.
 *
 *   node server/scripts/seedRosterGapColleges.js            # dry run
 *   node server/scripts/seedRosterGapColleges.js --apply
 *
 * Every join in the product is `roster_players.college_name = colleges.name`,
 * so these programmes were invisible to matching, philosophy and engagement
 * alike. `rosterSchoolAliases.js` fixed the ones that were the same school
 * spelled two ways; these are the remainder, which genuinely had no row.
 *
 * WHAT IS COPIED AND WHAT IS NOT. Institutional facts — academic rating, and
 * everything `loadMatchingInputs.js` later joins on UNITID — belong to the
 * university, so where the other sport already holds a row for the same
 * institution they are copied from it verbatim. Sport-specific facts are NOT:
 * `soccer_score`, `national_ranking` and the win rates describe a programme,
 * and copying a women's score onto a men's row would be a confident wrong
 * number of exactly the kind this codebase keeps finding. Those come from
 * `rankings_v6_*.csv`, rebuilt after the four missing men's records rows were
 * researched and added to `soccer_records.csv`.
 *
 * Run `loadMatchingInputs.js --apply` afterwards to fill unitid, city, state,
 * latitude, cost, admissions and the win rates from their own sources.
 *
 *   --division USCAA   seed EVERY programme in that division that has roster
 *                      rows, a v6 score and no registry row, instead of the
 *                      hand-listed SEED above. Written for the USCAA build,
 *                      where 18 programmes arrived at once and listing them by
 *                      hand would have been transcription with no check on it.
 *                      The per-row guards are identical either way.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { parseCsvToObjects } from '../lib/csv.js';

const APPLY = process.argv.includes('--apply');
const RANKINGS = '/Users/rhysdavies/Documents/Recruitmatch/scoring';

/**
 * The programmes to create, and the name each is scored under.
 *
 * `scoredAs` exists because the records file and the roster file do not always
 * agree on a school's name: the roster writes "Calumet College of St. Joseph"
 * where soccer_records.csv writes "Calumet College". Stating the join here
 * beats a fuzzy match that could attach another school's record.
 *
 * Penn State Schuylkill was deliberately absent from this list when it was
 * written: our files filed it under NCAA D3, but it plays the PSUAC and
 * contested the 2025 USCAA Division II national championship, so seeding it as
 * D3 would have offered an athlete a division the school does not compete in.
 * That was fixed upstream instead — USCAA is a division now, and Schuylkill
 * arrives through `--division USCAA` under the right one.
 */
const SEED = [
  { name: 'Shawnee State', sport: 'womens-soccer', division: 'NCAA D2',
    conference: 'Mountain East Conference', scoredAs: 'Shawnee State' },
  { name: 'Brewton-Parker Christian University', sport: 'mens-soccer', division: 'NAIA',
    conference: 'Southern States Athletic Conference' },
  { name: 'Indiana University East', sport: 'mens-soccer', division: 'NAIA',
    conference: 'River States Conference' },
  { name: 'Johnson University', sport: 'mens-soccer', division: 'NAIA',
    conference: 'Appalachian Athletic Conference' },
  { name: 'Graceland University', sport: 'mens-soccer', division: 'NAIA',
    conference: 'Heart of America Athletic Conference' },
  { name: 'Calumet College of St. Joseph', sport: 'mens-soccer', division: 'NAIA',
    conference: 'Chicagoland Collegiate Athletic Conference', scoredAs: 'Calumet College' },
  { name: 'Bay Path University', sport: 'womens-soccer', division: 'NCAA D3',
    conference: 'New England Collegiate Conference' },
];

const rankings = (sport) => {
  const file = sport === 'mens-soccer' ? 'rankings_v6_men.csv' : 'rankings_v6_women.csv';
  const map = new Map();
  for (const r of parseCsvToObjects(fs.readFileSync(path.join(RANKINGS, file), 'utf-8'))) {
    if (r.name) map.set(r.name, { score: Number(r.score), rank: Number(r.rank) });
  }
  return map;
};

/** The same institution's row in the other sport, if it has one. */
const otherSport = (s) => (s === 'mens-soccer' ? 'womens-soccer' : 'mens-soccer');

/** Every programme in a division with rosters and no registry row. */
function orphansOf(division) {
  return db.prepare(`
    SELECT DISTINCT r.college_name AS name, r.sport, r.division, r.conference
    FROM roster_players r
    WHERE r.division = ?
      AND NOT EXISTS (SELECT 1 FROM colleges c WHERE c.name = r.college_name AND c.sport = r.sport)
    ORDER BY r.sport, r.college_name`).all(division)
    .map((r) => ({ name: r.name, sport: r.sport, division: r.division, conference: r.conference }));
}

function main() {
  const ranks = { 'mens-soccer': rankings('mens-soccer'), 'womens-soccer': rankings('womens-soccer') };
  const divIdx = process.argv.indexOf('--division');
  const seedList = divIdx > -1 ? orphansOf(process.argv[divIdx + 1]) : SEED;
  const existing = db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?');
  const counterpart = db.prepare('SELECT * FROM colleges WHERE name = ? AND sport = ?');
  const rosterRows = db.prepare(
    'SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ?',
  );

  const planned = [];
  const refused = [];
  for (const s of seedList) {
    if (existing.get(s.name, s.sport)) { refused.push(`${s.name}: already has a row`); continue; }
    const rows = rosterRows.get(s.name, s.sport).n;
    // A row nothing points at is worse than no row: it would appear in match
    // results with no squad behind it.
    if (!rows) { refused.push(`${s.name}: no roster rows point at this name`); continue; }
    const rank = ranks[s.sport].get(s.scoredAs || s.name);
    if (!rank || !Number.isFinite(rank.score)) {
      refused.push(`${s.name}: no v6 score under ${JSON.stringify(s.scoredAs || s.name)}`);
      continue;
    }
    const twin = counterpart.get(s.name, otherSport(s.sport));
    planned.push({ ...s, rows, ...rank, twin });
  }

  console.log(`${planned.length} row(s) to create${APPLY ? '' : ' (dry run)'}`);
  for (const p of planned) {
    console.log(`  ${p.name} [${p.division} ${p.sport}]`);
    console.log(`     ${p.rows} roster rows | soccer_score ${p.score} rank ${p.rank}`
      + ` | academic ${p.twin?.academic_rating ?? 'NONE'}`
      + ` | institutional data ${p.twin ? `copied from the ${otherSport(p.sport)} row` : 'NOT AVAILABLE'}`);
  }
  if (refused.length) {
    console.log('\nrefused:');
    for (const r of refused) console.log(`  ${r}`);
  }
  if (!APPLY) { console.log('\nPass --apply to write.'); return; }

  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO colleges
    (id, created_date, updated_date, name, sport, division, conference,
     soccer_score, national_ranking, academic_rating, academic_rating_source,
     unitid, city, state, latitude, longitude, net_price, control, active, notable_majors)
    VALUES (@id, @now, @now, @name, @sport, @division, @conference,
     @soccer_score, @national_ranking, @academic_rating, @academic_rating_source,
     @unitid, @city, @state, @latitude, @longitude, @net_price, @control, 1, '[]')`);

  const run = db.transaction((items) => {
    for (const p of items) {
      const t = p.twin;
      insert.run({
        id: randomUUID(), now,
        name: p.name, sport: p.sport, division: p.division, conference: p.conference,
        soccer_score: p.score, national_ranking: p.rank,
        academic_rating: t?.academic_rating ?? null,
        // Says where the number came from, and says so when there is none.
        academic_rating_source: t?.academic_rating != null
          ? (t.academic_rating_source || 'copied from the other sport')
          : 'no College Scorecard match for this institution',
        unitid: t?.unitid ?? null, city: t?.city ?? null, state: t?.state ?? null,
        latitude: t?.latitude ?? null, longitude: t?.longitude ?? null,
        net_price: t?.net_price ?? null, control: t?.control ?? null,
      });
    }
  });
  run(planned);
  console.log(`\nCreated ${planned.length} college row(s).`);
  console.log('Next: node server/scripts/loadMatchingInputs.js --apply');
}

main();
