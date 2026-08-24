#!/usr/bin/env node
/**
 * Merges a coaching-contacts CSV into existing GraduatingSenior.coaching_staff
 * records WITHOUT wiping coaches that are already there — unlike
 * coachingImportApply (which fully replaces coaching_staff), this only adds
 * CSV coaches whose (normalized) name isn't already present at that school.
 *
 * Usage:
 *   node server/scripts/mergeCoachingContacts.js <csv-path> [--apply] [--sport=<slug>]
 *
 * --sport defaults to "mens-soccer"; pass "womens-soccer" for women's files.
 * Without --apply, runs as a dry run and prints what would change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseAndGroupCoachingCsv, matchSchoolName } from '../lib/coachingImport.js';
import { College } from '../db/entities/college.js';
import { GraduatingSenior } from '../db/entities/graduatingSenior.js';

const sportFlag = process.argv.find((a) => a.startsWith('--sport='));
const SPORT = sportFlag ? sportFlag.split('=')[1] : 'mens-soccer';
const MIN_CONFIDENCE = 0.7;

function seasonSortKey(season) {
  const match = String(season || '').match(/\d{4}/);
  return match ? Number(match[0]) : -Infinity;
}

function findMostRecentRecord(collegeName) {
  const records = GraduatingSenior.filter({ college_name: collegeName, sport: SPORT });
  if (records.length === 0) return null;
  return [...records].sort((a, b) => seasonSortKey(b.season) - seasonSortKey(a.season))[0];
}

function normalizeName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const [csvPath, ...flags] = process.argv.slice(2);
  const apply = flags.includes('--apply');
  if (!csvPath) {
    console.error('Usage: node server/scripts/mergeCoachingContacts.js <csv-path> [--apply]');
    process.exit(1);
  }

  const csvText = fs.readFileSync(path.resolve(csvPath), 'utf-8');
  const existingCollegeNames = College.filter({ sport: SPORT }).map((c) => c.name);
  const { bySchool, droppedNoEmail } = parseAndGroupCoachingCsv(csvText);

  const updated = [];
  const created = [];
  const unchanged = [];
  const unmatched = [];
  let totalCoachesAdded = 0;

  for (const [schoolName, entry] of bySchool.entries()) {
    const match = matchSchoolName(schoolName, existingCollegeNames);
    if (!match.matched_college || match.confidence < MIN_CONFIDENCE) {
      unmatched.push({ school_name: schoolName, best_guess: match.matched_college, confidence: match.confidence });
      continue;
    }

    const targetCollegeName = match.matched_college;
    const existingRecord = findMostRecentRecord(targetCollegeName);

    if (!existingRecord) {
      created.push({ school_name: schoolName, college_name: targetCollegeName, coaches: entry.imported });
      totalCoachesAdded += entry.imported.length;
      if (apply) {
        GraduatingSenior.create({
          college_name: targetCollegeName,
          season: '2025-2026',
          coaching_staff: entry.imported,
          players: [],
          position_data: [],
          all_graduating_senior_names: [],
          total_graduating_seniors: null,
          sport: SPORT,
        });
      }
      continue;
    }

    const existingStaff = existingRecord.coaching_staff || [];
    const existingNames = new Set(existingStaff.map((c) => normalizeName(c.name)));
    const newCoaches = entry.imported.filter((c) => !existingNames.has(normalizeName(c.name)));

    if (newCoaches.length === 0) {
      unchanged.push({ school_name: schoolName, college_name: targetCollegeName });
      continue;
    }

    updated.push({
      school_name: schoolName,
      college_name: targetCollegeName,
      season: existingRecord.season,
      coaches_added: newCoaches,
    });
    totalCoachesAdded += newCoaches.length;

    if (apply) {
      GraduatingSenior.update(existingRecord.id, { coaching_staff: [...existingStaff, ...newCoaches] });
    }
  }

  console.log(`\n${apply ? 'APPLIED' : 'DRY RUN'} — ${bySchool.size} schools in CSV, ${droppedNoEmail} coach rows dropped (no email)\n`);

  console.log(`Schools with NEW coaches added (${updated.length}):`);
  for (const u of updated) {
    console.log(`  "${u.school_name}" -> "${u.college_name}" (season ${u.season}): +${u.coaches_added.length} — ${u.coaches_added.map((c) => c.name).join(', ')}`);
  }

  console.log(`\nNew stub records created for schools not yet in DB (${created.length}):`);
  for (const c of created) {
    console.log(`  "${c.school_name}" -> "${c.college_name}": ${c.coaches.length} coach(es)`);
  }

  console.log(`\nSchools already up to date, no changes (${unchanged.length}):`);
  console.log(`  ${unchanged.map((u) => u.school_name).join(', ')}`);

  console.log(`\nUnmatched / low-confidence schools — skipped, need manual review (${unmatched.length}):`);
  for (const u of unmatched) {
    console.log(`  "${u.school_name}" (best guess: "${u.best_guess}", ${(u.confidence * 100).toFixed(1)}%)`);
  }

  console.log(`\nTotal coaches ${apply ? 'added' : 'that would be added'}: ${totalCoachesAdded}`);
  if (!apply) console.log('\nRe-run with --apply to write these changes.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
