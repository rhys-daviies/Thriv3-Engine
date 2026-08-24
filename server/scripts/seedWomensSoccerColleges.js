#!/usr/bin/env node
/**
 * Phase 2 of the women's-soccer buildout: seeds colleges (sport =
 * 'womens-soccer') from Recruitmatch/scoring/rankings_v6_women.csv -- the
 * already-validated cross-division ranking algorithm (v6, see memory
 * scoring-algorithm-v6) that was computed for women's soccer at the same
 * time as men's, but never imported into this app. Mirrors exactly how
 * server/seed/seedFromLocalData.js seeds the men's colleges from
 * colleges_rankings.json, reusing the same academic-score matching and
 * fuzzy name-matching helpers, so the two sports end up structured the
 * same way.
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import fs from 'node:fs';
import { parseCsv } from '../lib/csv.js';
import { College } from '../db/entities/college.js';
import { loadAcademicScores } from '../lib/seedData.js';
import { matchSchoolName, rankToRating } from '../lib/schoolMatch.js';

const SPORT = 'womens-soccer';
const RANKINGS_PATH = '/Users/rhysdavies/Documents/Recruitmatch/scoring/rankings_v6_women.csv';

// v6's CSVs use bare division codes; our schema spells NCAA divisions out.
const DIVISION_MAP = { D1: 'NCAA D1', D2: 'NCAA D2', D3: 'NCAA D3', NAIA: 'NAIA' };

const APPLY = process.argv.includes('--apply');

function loadRankings() {
  const text = fs.readFileSync(RANKINGS_PATH, 'utf-8');
  const [header, ...rows] = parseCsv(text).filter((r) => r.length > 1);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return rows.map((r) => ({
    name: r[idx.name],
    division: DIVISION_MAP[r[idx.division]] || r[idx.division],
    conference: r[idx.conference],
    soccer_score: Number(r[idx.score]),
    national_ranking: Number(r[idx.rank]),
  }));
}

function main() {
  const rankings = loadRankings();
  const academicScores = loadAcademicScores();
  const academicByDivision = {};
  for (const row of academicScores) {
    (academicByDivision[row.division] ||= []).push(row);
  }

  console.log(`${rankings.length} women's soccer schools in rankings_v6_women.csv${APPLY ? '' : ' (dry run)'}.`);

  const byDivision = {};
  let created = 0;
  let updated = 0;
  let academicMatched = 0;
  let academicMissing = 0;

  for (const school of rankings) {
    byDivision[school.division] = (byDivision[school.division] || 0) + 1;

    const candidates = (academicByDivision[school.division] || []).map((a) => a.name);
    const matchedName = matchSchoolName(school.name, candidates);
    const academicRow = matchedName ? academicByDivision[school.division].find((a) => a.name === matchedName) : null;
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

  console.log('By division:', byDivision);
  console.log(`Academic rating matched: ${academicMatched}, missing (left null): ${academicMissing}`);
  if (APPLY) console.log(`\nDone. ${created} created, ${updated} updated.`);
  else console.log('\nDry run only -- re-run with --apply to write these to the database.');
}

main();
