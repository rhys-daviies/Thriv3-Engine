#!/usr/bin/env node
/**
 * One-off (re-runnable) backfill of colleges.nickname_plural for rows that
 * already have a nickname from an earlier populateSchoolIdentity.js run but
 * predate the nickname_plural column. Pure local heuristic, no network --
 * see server/lib/nicknameGrammar.js.
 *
 * Usage:
 *   node server/scripts/backfillNicknamePlural.js [--apply]
 */
import { College } from '../db/entities/college.js';
import { isPluralNickname } from '../lib/nicknameGrammar.js';

const APPLY = process.argv.includes('--apply');

function main() {
  const rows = College.list().filter((c) => c.nickname && c.nickname_plural == null);
  console.log(`${rows.length} rows have a nickname but no nickname_plural flag yet${APPLY ? '' : ' (dry run)'}.`);

  let plural = 0;
  let singular = 0;
  for (const row of rows) {
    const isPlural = isPluralNickname(row.nickname);
    if (isPlural) plural++; else singular++;
    console.log(`${isPlural ? 'plural  ' : 'singular'}  ${row.name}: ${row.nickname}`);
    if (APPLY) College.update(row.id, { nickname_plural: isPlural ? 1 : 0 });
  }

  console.log(`\nDone. ${plural} plural, ${singular} singular, out of ${rows.length}.`);
  if (!APPLY) console.log('Dry run only -- re-run with --apply to write these to the database.');
}

main();
