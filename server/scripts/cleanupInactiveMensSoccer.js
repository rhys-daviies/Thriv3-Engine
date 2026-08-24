#!/usr/bin/env node
/**
 * Deletes mens-soccer colleges rows for programs an authoritative Aug-20
 * audit (Recruitmatch/Thriv3/Soccer Records/removed_inactive_2025.json)
 * confirmed are inactive -- closed, discontinued, or no longer sponsoring
 * the sport -- verified against NCAA/conference registries. That audit
 * already dropped these schools from the canonical soccer_records.csv;
 * this just syncs the live colleges table to match.
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import { College } from '../db/entities/college.js';

const APPLY = process.argv.includes('--apply');

const INACTIVE_NAMES = [
  'Concordia Irvine',
  'Inter American (PR)',
  'Montana State Billings',
  'Cazenovia',
  'Clarks Summit',
  'Eastern Nazarene',
  'Fontbonne',
  'Wells',
  'Wesley',
  'Cardinal Stritch',
  'Huntington',
  'Trinity International',
  'Hillsdale Baptist',
  'William Jessup',
];

function main() {
  let found = 0;
  for (const name of INACTIVE_NAMES) {
    const rows = College.filter({ sport: 'mens-soccer', name });
    for (const r of rows) {
      found++;
      console.log(`${APPLY ? 'deleting' : 'would delete'}: ${name} (${r.division}, score=${r.soccer_score})`);
      if (APPLY) College.delete(r.id);
    }
  }
  console.log(`\n${found} rows ${APPLY ? 'deleted' : 'would be deleted'}.`);
  if (!APPLY) console.log('Dry run only -- re-run with --apply to write these to the database.');
}

main();
