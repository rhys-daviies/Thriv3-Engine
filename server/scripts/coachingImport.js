#!/usr/bin/env node
/**
 * Reusable coaching-contacts import CLI.
 *
 * Usage:
 *   node server/scripts/coachingImport.js preview <csv-path> [--sport=mens-soccer] [--out=report.json]
 *   node server/scripts/coachingImport.js apply <csv-path> [--overrides=overrides.json] [--sport=mens-soccer]
 *
 * Requires the API server to be running (npm run dev / npm run dev:server) —
 * this script is a thin client over POST /api/coaching-import/preview and
 * /apply, so re-running it against a new CSV next season is just pointing it
 * at the new file.
 */
import fs from 'node:fs';
import path from 'node:path';

const API_BASE = process.env.API_BASE || 'http://localhost:8787';

function parseArgs(argv) {
  const [command, csvPath, ...rest] = argv;
  const flags = {};
  for (const arg of rest) {
    const match = arg.match(/^--([a-zA-Z_]+)=(.*)$/);
    if (match) flags[match[1]] = match[2];
  }
  return { command, csvPath, flags };
}

function printPreviewReport(report) {
  console.log(`\n${report.total_schools} schools, ${report.total_coaches_to_import} coaches to import, ${report.total_coaches_dropped_no_email} dropped (no email).\n`);
  console.log('Sorted lowest-confidence first — review these before running apply:\n');
  for (const school of report.schools) {
    const conf = (school.confidence * 100).toFixed(1);
    const flag = school.confidence < 0.85 ? '  ⚠ LOW CONFIDENCE' : '';
    console.log(`[${conf}%]${flag} "${school.school_name}" -> "${school.matched_college}"`);
    console.log(`         importing ${school.coaches_to_import.length} coach(es)${school.coaches_dropped_no_email.length ? `, dropping ${school.coaches_dropped_no_email.length} (no email)` : ''}`);
  }
}

function printApplySummary(summary) {
  console.log(`\nUpdated ${summary.schools_updated.length} existing school(s):`);
  for (const s of summary.schools_updated) {
    console.log(`  "${s.school_name}" -> "${s.college_name}" (season ${s.season}): ${s.coaches} coach(es)`);
  }

  console.log(`\nCreated ${summary.stub_records_created.length} stub GraduatingSenior record(s):`);
  for (const s of summary.stub_records_created) {
    console.log(`  "${s.school_name}" -> "${s.college_name}" (season ${s.season}): ${s.coaches} coach(es)`);
  }

  if (summary.schools_skipped_low_confidence.length > 0) {
    console.log(`\n⚠ Skipped ${summary.schools_skipped_low_confidence.length} school(s) — low confidence, no override supplied:`);
    for (const s of summary.schools_skipped_low_confidence) {
      console.log(`  "${s.school_name}" (best guess: "${s.best_guess}", ${(s.confidence * 100).toFixed(1)}%) — add to --overrides to force`);
    }
  }

  console.log(`\nTotal: ${summary.coaches_imported} coaches imported, ${summary.coaches_skipped_no_email} skipped (no email).`);
}

async function main() {
  const { command, csvPath, flags } = parseArgs(process.argv.slice(2));
  if (!command || !csvPath) {
    console.error('Usage: node server/scripts/coachingImport.js <preview|apply> <csv-path> [--sport=mens-soccer] [--out=report.json] [--overrides=overrides.json]');
    process.exit(1);
  }

  const csv_text = fs.readFileSync(path.resolve(csvPath), 'utf-8');
  const sport = flags.sport || 'mens-soccer';

  if (command === 'preview') {
    const res = await fetch(`${API_BASE}/api/coaching-import/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv_text, sport }),
    });
    if (!res.ok) throw new Error(`Preview failed: ${res.status} ${await res.text()}`);
    const report = await res.json();
    printPreviewReport(report);
    if (flags.out) {
      fs.writeFileSync(path.resolve(flags.out), JSON.stringify(report, null, 2));
      console.log(`\nFull report written to ${flags.out}`);
    }
    return;
  }

  if (command === 'apply') {
    const overrides = flags.overrides
      ? JSON.parse(fs.readFileSync(path.resolve(flags.overrides), 'utf-8'))
      : {};
    const body = { csv_text, sport, overrides };
    if (flags.min_confidence) body.min_confidence = Number(flags.min_confidence);

    const res = await fetch(`${API_BASE}/api/coaching-import/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Apply failed: ${res.status} ${await res.text()}`);
    const summary = await res.json();
    printApplySummary(summary);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
