import fs from 'node:fs';
import { College } from '../db/entities/college.js';
import { GraduatingSenior } from '../db/entities/graduatingSenior.js';
import { loadCollegeRankings, loadAcademicScores, loadD1Schools, graduatingCsvPath, GRADUATING_CSV_FILES } from '../lib/seedData.js';
import { matchSchoolName, rankToRating } from '../lib/schoolMatch.js';
import { groupCsvRowsIntoRecords } from '../lib/graduatingImport.js';
import { parseCsvToObjects } from '../lib/csv.js';

const SPORT = 'mens-soccer';

function seedColleges() {
  console.log('Seeding colleges from real rankings + academic-score data...');
  const rankings = loadCollegeRankings();
  const academicScores = loadAcademicScores();
  const d1Schools = loadD1Schools();

  const academicByDivision = {};
  for (const row of academicScores) {
    (academicByDivision[row.division] ||= []).push(row);
  }

  let created = 0;
  for (const school of rankings) {
    const candidates = (academicByDivision[school.division] || []).map((a) => a.name);
    const matchedName = matchSchoolName(school.name, candidates);
    const academicRow = matchedName ? academicByDivision[school.division].find((a) => a.name === matchedName) : null;

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
    if (wasCreated) created++;
  }
  console.log(`  colleges from rankings_output.csv: ${rankings.length} rows -> ${created} new`);

  // Cross-check the authoritative D1 sheet (213 schools) against the FULL
  // college set (any division) — a school may already exist under a
  // different division from the separate rankings file, in which case the
  // D1 sheet (authoritative per Section 15) corrects it in place rather than
  // colliding with the (name, sport) unique constraint.
  let d1Added = 0;
  let d1Corrected = 0;
  for (const school of d1Schools) {
    const allExistingNames = College.filter({ sport: SPORT }).map((c) => c.name);
    const matched = matchSchoolName(school.name, allExistingNames);

    const candidates = (academicByDivision['NCAA D1'] || []).map((a) => a.name);
    const matchedAcademicName = matchSchoolName(school.name, candidates);
    const academicRow = matchedAcademicName ? academicByDivision['NCAA D1'].find((a) => a.name === matchedAcademicName) : null;

    const { created: wasCreated } = College.upsert(
      { name: matched || school.name, sport: SPORT },
      {
        division: 'NCAA D1',
        conference: school.conference,
        national_ranking: school.rpi_rank || undefined,
        academic_rating: academicRow ? academicRow.academic_score : rankToRating(school.rpi_rank, d1Schools.length),
        sport: SPORT,
      }
    );
    if (wasCreated) d1Added++;
    else if (matched) d1Corrected++;
  }
  console.log(`  D1 sheet cross-check: ${d1Added} new schools added, ${d1Corrected} existing corrected to NCAA D1`);
}

async function seedGraduatingRosters() {
  console.log('Seeding real 2025 graduating-senior rosters...');
  let totalSchools = 0;
  let totalPlayers = 0;
  for (const filename of GRADUATING_CSV_FILES) {
    const text = fs.readFileSync(graduatingCsvPath(filename), 'utf-8');
    const rows = parseCsvToObjects(text);
    const records = groupCsvRowsIntoRecords(rows, SPORT);
    for (const record of records) {
      GraduatingSenior.upsert({ college_name: record.college_name, season: record.season, sport: SPORT }, record);
      totalPlayers += record.players.length;
    }
    totalSchools += records.length;
    console.log(`  ${filename}: ${records.length} schools, ${records.reduce((n, r) => n + r.players.length, 0)} players`);
  }
  console.log(`  total: ${totalSchools} school records, ${totalPlayers} players`);
}

async function main() {
  seedColleges();
  await seedGraduatingRosters();
  console.log('Seed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
