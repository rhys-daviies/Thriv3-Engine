import { College } from '../db/entities/college.js';
import { GraduatingSenior } from '../db/entities/graduatingSenior.js';
import { parseAndGroupCoachingCsv, matchSchoolName } from '../lib/coachingImport.js';

const DEFAULT_STUB_SEASON = '2025-2026';

// Below this confidence, a school is skipped unless the caller supplied an
// explicit override for it — refusing to silently overwrite coaching_staff
// on what might be the wrong school.
const MIN_CONFIDENCE_WITHOUT_OVERRIDE = 0.7;

function seasonSortKey(season) {
  const match = String(season || '').match(/\d{4}/);
  return match ? Number(match[0]) : -Infinity;
}

/** Picks the most recently-seasoned GraduatingSenior record for a college, if any. */
function findMostRecentRecord(collegeName, sport) {
  const records = GraduatingSenior.filter({ college_name: collegeName, sport });
  if (records.length === 0) return null;
  return [...records].sort((a, b) => seasonSortKey(b.season) - seasonSortKey(a.season))[0];
}

/**
 * Applies a coaching-contacts CSV: for each school (matched automatically or
 * via the override map), replaces the coaching_staff array on the most
 * recent GraduatingSenior record for that college — creating a bare stub
 * record if none exists yet, so buildGraduatingDatabase can fill in roster
 * fields later without conflict. This is a full replace, not a merge: the
 * latest CSV always wins for coaching_staff.
 */
export async function coachingImportApply({ csv_text, sport = 'mens-soccer', overrides = {}, min_confidence = MIN_CONFIDENCE_WITHOUT_OVERRIDE }) {
  if (!csv_text) throw new Error('csv_text is required');

  const existingCollegeNames = College.filter({ sport }).map((c) => c.name);
  const { bySchool, droppedNoEmail } = parseAndGroupCoachingCsv(csv_text);

  const summary = {
    schools_updated: [],
    stub_records_created: [],
    schools_skipped_low_confidence: [],
    coaches_imported: 0,
    coaches_skipped_no_email: droppedNoEmail,
  };

  for (const [schoolName, entry] of bySchool.entries()) {
    const override = overrides[schoolName];
    let targetCollegeName = override;
    let confidence = override ? 1 : 0;

    if (!targetCollegeName) {
      const match = matchSchoolName(schoolName, existingCollegeNames);
      targetCollegeName = match.matched_college;
      confidence = match.confidence;
    }

    if (!targetCollegeName || confidence < min_confidence) {
      summary.schools_skipped_low_confidence.push({
        school_name: schoolName,
        best_guess: targetCollegeName,
        confidence: Math.round(confidence * 1000) / 1000,
      });
      continue;
    }

    const existing = findMostRecentRecord(targetCollegeName, sport);

    if (existing) {
      GraduatingSenior.update(existing.id, { coaching_staff: entry.imported });
      summary.schools_updated.push({ school_name: schoolName, college_name: targetCollegeName, season: existing.season, coaches: entry.imported.length });
    } else {
      GraduatingSenior.create({
        college_name: targetCollegeName,
        season: DEFAULT_STUB_SEASON,
        coaching_staff: entry.imported,
        players: [],
        position_data: [],
        all_graduating_senior_names: [],
        total_graduating_seniors: null,
        sport,
      });
      summary.stub_records_created.push({ school_name: schoolName, college_name: targetCollegeName, season: DEFAULT_STUB_SEASON, coaches: entry.imported.length });
    }

    summary.coaches_imported += entry.imported.length;
  }

  return summary;
}
