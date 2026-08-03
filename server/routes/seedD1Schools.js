import { College } from '../db/entities/college.js';
import { loadD1Schools, loadAcademicScores } from '../lib/seedData.js';
import { matchSchoolName, rankToRating } from '../lib/schoolMatch.js';

/**
 * Bulk-creates all 213 D1 College records. Section 12/16 describe this as
 * seeding from a hardcoded D1_SCHOOLS array with LLM-sourced academic ratings;
 * here the "hardcoded array" is the real 213-school RPI sheet bundled in
 * server/seed/data, and academic ratings are joined from the real bundled
 * academic-scores sheet (falling back to rankToRating from RPI rank for any
 * school missing an academic-score row), so no LLM call is required.
 */
export async function seedD1Schools({ sport = 'mens-soccer' } = {}) {
  const d1Schools = loadD1Schools();
  const academicScores = loadAcademicScores().filter((a) => a.division === 'NCAA D1');
  const academicNames = academicScores.map((a) => a.name);
  const total = d1Schools.length;

  let created = 0;
  for (const school of d1Schools) {
    const matchedName = matchSchoolName(school.name, academicNames);
    const academicRow = matchedName ? academicScores.find((a) => a.name === matchedName) : null;
    const academic_rating = academicRow ? academicRow.academic_score : rankToRating(school.rpi_rank, total);

    const { created: wasCreated } = College.upsert(
      { name: school.name, sport },
      {
        division: 'NCAA D1',
        conference: school.conference,
        national_ranking: school.rpi_rank || undefined,
        academic_rating,
        sport,
      }
    );
    if (wasCreated) created++;
  }

  return { success: true, created, total };
}
