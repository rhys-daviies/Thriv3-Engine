import { College } from '../db/entities/college.js';
import { buildCoachingImportReport } from '../lib/coachingImport.js';

/**
 * Dry-run: parses the coaching-contacts CSV, fuzzy-matches each school
 * against existing College records, and returns the full report. Writes
 * nothing to the database — review this before calling apply.
 */
export async function coachingImportPreview({ csv_text, sport = 'mens-soccer' }) {
  if (!csv_text) throw new Error('csv_text is required');
  const existingCollegeNames = College.filter({ sport }).map((c) => c.name);
  return buildCoachingImportReport(csv_text, existingCollegeNames);
}
