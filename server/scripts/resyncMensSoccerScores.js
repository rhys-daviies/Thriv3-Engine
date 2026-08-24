#!/usr/bin/env node
/**
 * Re-applies scoring/rankings_v6_men.csv to every mens-soccer colleges row
 * (D1, D2, D3, NAIA -- NJCAA is not yet built). The canonical
 * soccer_records.csv has had substantial fixes applied to it (see
 * Thriv3/Soccer Records/removed_inactive_2025.json, preexisting_duplicates.json)
 * that were never synced back to the live colleges table, so many rows carry
 * stale or placeholder scores. This brings every row's soccer_score and
 * national_ranking in line with the current, corrected rankings output.
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import fs from 'node:fs';
import { College } from '../db/entities/college.js';
import { parseCsv } from '../lib/csv.js';

const RANKINGS_PATH = '/Users/rhysdavies/Documents/Recruitmatch/scoring/rankings_v6_men.csv';
const DIVISION_MAP = { D1: 'NCAA D1', D2: 'NCAA D2', D3: 'NCAA D3', NAIA: 'NAIA' };
const APPLY = process.argv.includes('--apply');

function loadRankings() {
  const text = fs.readFileSync(RANKINGS_PATH, 'utf-8');
  const [header, ...rows] = parseCsv(text).filter((r) => r.length > 1);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const byKey = new Map();
  for (const r of rows) {
    const division = DIVISION_MAP[r[idx.division]] || r[idx.division];
    byKey.set(`${division}|||${r[idx.name]}`, { score: Number(r[idx.score]), rank: Number(r[idx.rank]) });
  }
  return byKey;
}

function main() {
  const rankByKey = loadRankings();
  const divisions = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];
  let totalChanged = 0;
  let totalUnchanged = 0;
  const notFound = [];

  for (const division of divisions) {
    const rows = College.filter({ sport: 'mens-soccer', division });
    let changed = 0;
    for (const c of rows) {
      const rv = rankByKey.get(`${division}|||${c.name}`);
      if (!rv) {
        notFound.push(`${division}: ${c.name} (current score=${c.soccer_score})`);
        continue;
      }
      // A recompute of exactly 0 means the CSV has no usable record for this
      // school. Never let that "no data" sentinel clobber an existing real
      // score sourced from elsewhere -- only apply it to rows that are
      // already 0 or null (i.e. already known to have no data).
      if (rv.score === 0 && c.soccer_score) {
        notFound.push(`${division}: ${c.name} (keeping existing score=${c.soccer_score}, recompute has no data)`);
        continue;
      }
      const diff = Math.abs(rv.score - (c.soccer_score ?? -1));
      if (diff > 0.01) {
        changed++;
        // national_ranking is sourced separately (real RPI rank for D1 via
        // d1_schools.json) -- only soccer_score belongs to this recompute.
        if (APPLY) College.update(c.id, { soccer_score: rv.score });
      } else {
        totalUnchanged++;
      }
    }
    console.log(`${division}: ${rows.length} rows, ${changed} ${APPLY ? 'updated' : 'would update'}`);
    totalChanged += changed;
  }

  console.log(`\nTotal ${APPLY ? 'updated' : 'would update'}: ${totalChanged}, already correct: ${totalUnchanged}, no rankings data (left as-is): ${notFound.length}`);
  if (notFound.length) {
    console.log('\nNo rankings data for (left untouched):');
    notFound.forEach((n) => console.log(' ', n));
  }
  if (!APPLY) console.log('\nDry run only -- re-run with --apply to write these to the database.');
}

main();
