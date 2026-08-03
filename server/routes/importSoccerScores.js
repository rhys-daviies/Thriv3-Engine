import { College } from '../db/entities/college.js';
import { loadCollegeRankings } from '../lib/seedData.js';
import { matchSchoolName } from '../lib/schoolMatch.js';

/**
 * Sets soccer_score (0-100) on College records from the real RPI-derived
 * rankings sheet — the local equivalent of Section 12's hardcoded RANKINGS
 * array, sourced from the user's own soccer_score.py output instead of a
 * transcribed array. Matches existing records via the documented cascade
 * (exact -> normalized -> alias -> fuzzy); creates the record if no existing
 * College matches, so every division ends up populated even on a from-scratch
 * run.
 */
export async function importSoccerScores({ sport = 'mens-soccer' } = {}) {
  const rankings = loadCollegeRankings();
  const existing = College.filter({ sport });
  const existingNames = existing.map((c) => c.name);

  let updated = 0;
  const notMatched = [];

  for (const row of rankings) {
    const matchedName = matchSchoolName(row.name, existingNames);
    const { created } = College.upsert(
      { name: matchedName || row.name, sport },
      {
        division: row.division,
        conference: row.conference,
        soccer_score: row.soccer_score,
        national_ranking: row.national_ranking || undefined,
        sport,
      }
    );
    if (!matchedName) notMatched.push(row.name);
    if (!created) updated++;
  }

  return {
    success: true,
    total: rankings.length,
    updated,
    not_matched: notMatched.length,
    not_matched_sample: notMatched.slice(0, 10),
  };
}
