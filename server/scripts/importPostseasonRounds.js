#!/usr/bin/env node
/**
 * Imports each school's 2025 postseason round reached (appearance, r32, r16,
 * quarter, semi, final, champion) from the canonical soccer_records CSVs
 * into colleges.postseason_2025_round, for the "made the Sweet 16 this past
 * season" email token. Most programs never reach the postseason, so a low
 * fill rate is expected, not a bug.
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import fs from 'node:fs';
import { College } from '../db/entities/college.js';
import { parseCsv } from '../lib/csv.js';

const APPLY = process.argv.includes('--apply');

const SOURCES = [
  { sport: 'mens-soccer', path: '/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records.csv' },
  { sport: 'womens-soccer', path: '/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records_women.csv' },
];

function loadRounds(path) {
  const text = fs.readFileSync(path, 'utf-8');
  const [header, ...rows] = parseCsv(text).filter((r) => r.length > 1);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const byName = new Map();
  for (const r of rows) {
    const round = (r[idx['2025_ps']] || '').trim().toLowerCase();
    if (round) byName.set(r[idx.name], round);
  }
  return byName;
}

function main() {
  let totalSet = 0;
  let totalUnchanged = 0;
  const notFound = [];

  for (const { sport, path } of SOURCES) {
    const roundsByName = loadRounds(path);
    let set = 0;
    for (const [name, round] of roundsByName) {
      const rows = College.filter({ sport, name });
      if (!rows.length) { notFound.push(`${sport}: ${name} (${round})`); continue; }
      for (const r of rows) {
        if (r.postseason_2025_round === round) { totalUnchanged++; continue; }
        set++;
        if (APPLY) College.update(r.id, { postseason_2025_round: round });
      }
    }
    console.log(`${sport}: ${roundsByName.size} schools with a 2025 postseason round, ${set} ${APPLY ? 'set' : 'would set'}`);
    totalSet += set;
  }

  console.log(`\nTotal ${APPLY ? 'set' : 'would set'}: ${totalSet}, already correct: ${totalUnchanged}, no colleges row found: ${notFound.length}`);
  if (notFound.length) {
    console.log('\nNo colleges row found for:');
    notFound.forEach((n) => console.log(' ', n));
  }
  if (!APPLY) console.log('\nDry run only -- re-run with --apply to write these to the database.');
}

main();
