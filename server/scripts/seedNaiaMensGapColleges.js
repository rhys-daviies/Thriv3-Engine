#!/usr/bin/env node
/**
 * Adds the 114 NAIA men's-soccer schools that had roster data but no
 * colleges row (previously the "NAIA men's soccer gap") -- the schools are
 * listed in the scratch file naia_new_rows.csv, whose W-L-D records were
 * researched from scratch and appended to the canonical soccer_records.csv,
 * then scored by scoring/soccer_score_v6.py alongside the rest of men's
 * soccer. This ONLY inserts those specific new schools (matched by name) --
 * it does not touch any existing mens-soccer colleges row.
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import fs from 'node:fs';
import { parseCsv } from '../lib/csv.js';
import { College } from '../db/entities/college.js';
import { loadAcademicScores } from '../lib/seedData.js';
import { matchSchoolName } from '../lib/schoolMatch.js';

const SPORT = 'mens-soccer';
const RANKINGS_PATH = '/Users/rhysdavies/Documents/Recruitmatch/scoring/rankings_v6_men.csv';
const NEW_ROWS_PATH =
  '/private/tmp/claude-501/-Users-rhysdavies-Documents-Recruitmatch-app/1e1a3c6c-a178-4361-afa1-5cda2c84e616/scratchpad/naia_new_rows.csv';

const APPLY = process.argv.includes('--apply');

function loadCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const [header, ...rows] = parseCsv(text).filter((r) => r.length > 1);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return { rows, idx };
}

function main() {
  const { rows: newRows, idx: newIdx } = loadCsv(NEW_ROWS_PATH);
  const newNames = new Set(newRows.map((r) => r[newIdx.name]));

  const { rows: rankRows, idx: rankIdx } = loadCsv(RANKINGS_PATH);
  const rankings = rankRows
    .filter((r) => newNames.has(r[rankIdx.name]))
    .map((r) => ({
      name: r[rankIdx.name],
      division: 'NAIA',
      conference: r[rankIdx.conference],
      soccer_score: Number(r[rankIdx.score]),
      national_ranking: Number(r[rankIdx.rank]),
    }));

  console.log(`${newNames.size} schools in naia_new_rows.csv, ${rankings.length} found in rankings_v6_men.csv${APPLY ? '' : ' (dry run)'}.`);
  const missingFromRankings = [...newNames].filter((n) => !rankings.some((r) => r.name === n));
  if (missingFromRankings.length) {
    console.log('Missing from rankings output (unexpected):', missingFromRankings);
  }

  const academicScores = loadAcademicScores().filter((a) => a.division === 'NAIA');
  const academicNames = academicScores.map((a) => a.name);

  let created = 0;
  let updated = 0;
  let academicMatched = 0;
  let academicMissing = 0;

  for (const school of rankings) {
    const matchedName = matchSchoolName(school.name, academicNames);
    const academicRow = matchedName ? academicScores.find((a) => a.name === matchedName) : null;
    if (academicRow) academicMatched++; else academicMissing++;

    if (!APPLY) continue;
    const { created: wasCreated } = College.upsert(
      { name: school.name, sport: SPORT },
      {
        division: school.division,
        conference: school.conference,
        soccer_score: school.soccer_score,
        national_ranking: school.national_ranking || undefined,
        academic_rating: academicRow ? academicRow.academic_score : undefined,
        sport: SPORT,
      }
    );
    if (wasCreated) created++; else updated++;
  }

  console.log(`Academic rating matched: ${academicMatched}, missing (left null): ${academicMissing}`);
  if (APPLY) console.log(`\nDone. ${created} created, ${updated} updated.`);
  else console.log('\nDry run only -- re-run with --apply to write these to the database.');
}

main();
