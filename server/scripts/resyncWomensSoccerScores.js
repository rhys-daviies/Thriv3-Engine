#!/usr/bin/env node
/**
 * Re-applies scoring/rankings_v6_women.csv soccer_score to every
 * womens-soccer colleges row (D1, D2, D3, NAIA), after filling in real
 * 2022-2025 records for 29 schools that had blank placeholder rows in the
 * canonical soccer_records_women.csv (see scratchpad/womens_new_rows.csv
 * and apply_womens_gap_updates.py for how those were researched/applied).
 *
 * national_ranking is intentionally left untouched -- for D1 it is sourced
 * from a real external RPI ranking (d1_schools.json), not this recompute.
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import fs from 'node:fs';
import { College } from '../db/entities/college.js';
import { parseCsv } from '../lib/csv.js';

const RANKINGS_PATH = '/Users/rhysdavies/Documents/Recruitmatch/scoring/rankings_v6_women.csv';
const DIVISION_MAP = { D1: 'NCAA D1', D2: 'NCAA D2', D3: 'NCAA D3', NAIA: 'NAIA' };
const APPLY = process.argv.includes('--apply');

function loadRankings() {
  const text = fs.readFileSync(RANKINGS_PATH, 'utf-8');
  const [header, ...rows] = parseCsv(text).filter((r) => r.length > 1);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const byKey = new Map();
  for (const r of rows) {
    const division = DIVISION_MAP[r[idx.division]] || r[idx.division];
    byKey.set(`${division}|||${r[idx.name]}`, Number(r[idx.score]));
  }
  return byKey;
}

function main() {
  const rankByKey = loadRankings();
  const divisions = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA'];
  let totalChanged = 0;
  let totalUnchanged = 0;
  const notFound = [];

  for (const division of divisions) {
    const rows = College.filter({ sport: 'womens-soccer', division });
    let changed = 0;
    for (const c of rows) {
      const rv = rankByKey.get(`${division}|||${c.name}`);
      if (rv == null) {
        notFound.push(`${division}: ${c.name} (current score=${c.soccer_score})`);
        continue;
      }
      // A recompute of exactly 0 means the CSV has no usable record for this
      // school. Never let that "no data" sentinel clobber an existing real
      // score sourced from elsewhere -- only apply it to rows already at 0.
      if (rv === 0 && c.soccer_score) {
        notFound.push(`${division}: ${c.name} (keeping existing score=${c.soccer_score}, recompute has no data)`);
        continue;
      }
      const diff = Math.abs(rv - (c.soccer_score ?? -1));
      if (diff > 0.01) {
        changed++;
        if (APPLY) College.update(c.id, { soccer_score: rv });
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
