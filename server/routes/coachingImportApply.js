import db from '../db/client.js';
import { College } from '../db/entities/college.js';
import { GraduatingSenior } from '../db/entities/graduatingSenior.js';
import {
  parseAndGroupCoachingCsv, buildInstitutionIndex, resolveCoachInstitution,
} from '../lib/coachingImport.js';

/** Reads the institution index (VERIFIED athletics hosts + college academic domains). */
function loadInstitutionIndex() {
  const domains = db.prepare('SELECT domain, unitid, status FROM athletics_domains').all();
  const colleges = db.prepare('SELECT name, unitid, website_domain FROM colleges').all();
  return buildInstitutionIndex({ domains, colleges });
}

/** A representative (source_url, email) for a school group — first coach with real evidence. */
function groupEvidence(imported) {
  const withSrc = imported.find((c) => c.source_url);
  const withEmail = imported.find((c) => c.email && c.email.includes('@'));
  return { sourceUrl: withSrc?.source_url || null, email: withEmail?.email || null };
}

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
  const existingCollegeSet = new Set(existingCollegeNames);
  const institutionIndex = loadInstitutionIndex();
  const { bySchool, droppedNoEmail } = parseAndGroupCoachingCsv(csv_text);

  const summary = {
    schools_updated: [],
    stub_records_created: [],
    schools_skipped_low_confidence: [],
    schools_flagged_institution_conflict: [],
    coaches_imported: 0,
    coaches_skipped_no_email: droppedNoEmail,
  };

  for (const [schoolName, entry] of bySchool.entries()) {
    const override = overrides[schoolName];
    let targetCollegeName = override;
    let confidence = override ? 1 : 0;

    if (!targetCollegeName) {
      // Corroboration rule: strong source/email domain evidence outranks the
      // fuzzy name match and blocks a wrong same-name filing (Phase 3A / 3B).
      const { sourceUrl, email } = groupEvidence(entry.imported);
      const res = resolveCoachInstitution({ scrapedName: schoolName, sourceUrl, email, candidateNames: existingCollegeNames, institutionIndex });

      if (res.decision === 'REVIEW_INSTITUTION_CONFLICT') {
        summary.schools_flagged_institution_conflict.push({
          school_name: schoolName, proposed_by_name: res.proposedCanonical, proposed_unitid: res.proposedUnitid,
          domain_institution: res.domainInstitution, source_domain: res.sourceDomain, email_domain: res.emailDomain,
          competing_unitids: res.competingUnitids, domain_signal: res.domainSignal,
        });
        continue; // never file at the name-matched wrong institution
      }
      if (res.decision === 'RESOLVED' && res.basis !== 'NAME_MATCH') {
        // strong domain evidence: file at the domain institution IF we track it for this sport
        if (res.matched_college && existingCollegeSet.has(res.matched_college)) {
          targetCollegeName = res.matched_college; confidence = res.confidence;
        } else {
          // domain resolves to an institution whose programme is absent for this sport -> do not guess
          summary.schools_flagged_institution_conflict.push({
            school_name: schoolName, proposed_by_name: res.proposedCanonical, proposed_unitid: res.proposedUnitid,
            domain_institution: res.matched_college, source_domain: res.sourceDomain, email_domain: res.emailDomain,
            competing_unitids: [res.proposedUnitid, res.unitid], domain_signal: res.basis,
            note: 'domain institution not in college set for this sport',
          });
          continue;
        }
      } else {
        targetCollegeName = res.matched_college; confidence = res.confidence;
      }
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
