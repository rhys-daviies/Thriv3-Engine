#!/usr/bin/env node
/**
 * Loads the rebuilt academic ratings into `colleges`.
 *
 * The ratings come from tools/academic/build_academic_scores.py, which derives
 * them from College Scorecard rather than from a ranking — see
 * data/university-individualisation/academic/README.md. This script only moves
 * numbers; it computes nothing, so re-running it after a weighting change is
 * the whole update path.
 *
 * Matching is exact on (name, sport) and nothing else. That is deliberate.
 * Every corruption this column has suffered came from a matcher that was
 * willing to guess — Central Arkansas onto Kansas, Dominguez Hills onto
 * Bakersfield, Northwestern University onto Northwestern State. `colleges`
 * has a UNIQUE index on (name, sport), the CSV carries the same names, and a
 * row that does not match exactly is reported rather than resolved.
 *
 *   node server/scripts/loadAcademicRatings.js            # report
 *   node server/scripts/loadAcademicRatings.js --apply    # write
 *
 * Backs the database up before writing. Touches only academic_rating and
 * academic_rating_source, and only on NCAA D1/D2/D3 rows — NAIA and NJCAA are
 * out of scope for this collection and keep whatever they had.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvToObjects } from '../lib/csv.js';
import db from '../db/client.js';

const apply = process.argv.includes('--apply');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.resolve(__dirname, '../../data/university-individualisation/academic/academic_ratings_final.csv');
const SOURCE = 'scorecard-v1';
const IN_SCOPE = ['NCAA D1', 'NCAA D2', 'NCAA D3'];

const rows = parseCsvToObjects(fs.readFileSync(CSV, 'utf-8'));
if (rows.length < 1000) throw new Error(`only ${rows.length} rows in ${CSV} — expected ~1,336`);

// One CSV row can cover both sports at a school; the DB holds one row each.
const wanted = new Map();
for (const r of rows) {
  const rating = Number(r.academic_rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    throw new Error(`rating out of range for ${r.School}: ${r.academic_rating}`);
  }
  for (const s of String(r.Sports || '').split('+')) {
    const sport = `${s.trim()}-soccer`;
    if (s.trim()) wanted.set(`${r.School}|${sport}`, { rating, row: r, sport });
  }
}

const existing = db.prepare(
  `SELECT id, name, sport, division, active, academic_rating, academic_rating_source
     FROM colleges WHERE division IN (${IN_SCOPE.map(() => '?').join(',')})`
).all(...IN_SCOPE);

const byKey = new Map(existing.map((c) => [`${c.name}|${c.sport}`, c]));

const changes = [];
const unchanged = [];
const noDbRow = [];
for (const [key, want] of wanted) {
  const col = byKey.get(key);
  if (!col) { noDbRow.push(key); continue; }
  const before = col.academic_rating;
  if (before !== null && Math.abs(before - want.rating) < 0.05 && col.academic_rating_source === SOURCE) {
    unchanged.push(key);
  } else {
    changes.push({ id: col.id, key, before, after: want.rating, wasSource: col.academic_rating_source });
  }
}
const notCovered = existing.filter((c) => !wanted.has(`${c.name}|${c.sport}`));

console.log(`${rows.length} CSV rows -> ${wanted.size} (name, sport) pairs`);
console.log(`${existing.length} NCAA D1/D2/D3 rows in the database\n`);
console.log(`  ${changes.length} to write`);
console.log(`  ${unchanged.length} already correct`);
console.log(`  ${noDbRow.length} CSV pairs with no database row`);
console.log(`  ${notCovered.length} database rows this collection does not cover`);

if (noDbRow.length) console.log(`\nno database row: ${noDbRow.slice(0, 10).join(', ')}`);
if (notCovered.length) {
  console.log('\nnot covered (left exactly as they are):');
  for (const c of notCovered) {
    console.log(`  ${c.name} [${c.sport.replace('-soccer', '')}] ${c.division} active=${c.active ?? '?'} rating=${c.academic_rating} source=${c.academic_rating_source}`);
  }
}

const moved = changes.filter((c) => c.before !== null).sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
console.log(`\n${changes.filter((c) => c.before === null).length} rows gain a first rating`);
console.log(`largest moves among the ${moved.length} that already had one:`);
for (const c of moved.slice(0, 12)) {
  console.log(`  ${c.key.replace('|', ' [').replace('-soccer', '')}]`.padEnd(44) + ` ${String(c.before).padStart(5)} -> ${String(c.after).padStart(4)}  (was ${c.wasSource || 'unsourced'})`);
}

if (!apply) {
  console.log('\nReport only. Re-run with --apply to write.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dbPath = path.resolve(__dirname, '../data/recruitmatch.sqlite');
const backup = `${dbPath}.pre-academic-${stamp}`;
fs.copyFileSync(dbPath, backup);

const update = db.prepare(
  'UPDATE colleges SET academic_rating = ?, academic_rating_source = ?, updated_date = ? WHERE id = ?'
);
const now = new Date().toISOString();
const run = db.transaction((list) => {
  for (const c of list) update.run(c.after, SOURCE, now, c.id);
});
run(changes);

const after = db.prepare(
  `SELECT count(*) AS n, sum(academic_rating IS NULL) AS unrated
     FROM colleges WHERE division IN (${IN_SCOPE.map(() => '?').join(',')})`
).get(...IN_SCOPE);
console.log(`\nwrote ${changes.length} rows (backup: ${path.basename(backup)})`);
console.log(`NCAA rows now: ${after.n}, still unrated: ${after.unrated}`);
