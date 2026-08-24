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
 * academic_rating_source.
 *
 * Two files, because they were collected separately and mean slightly
 * different things. The NCAA file is keyed on (School, Sports); the NAIA and
 * NJCAA file is keyed on (School, division), since those rows carry no sport
 * split in the source. Junior colleges arrive labelled `scorecard-njcaa-v1`
 * rather than `scorecard-v1`: their outcome leg is a two-year completion rate
 * standing in for a six-year one, which is a real substitution and should
 * stay visible in the column rather than only in a commit message.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvToObjects } from '../lib/csv.js';
import db from '../db/client.js';

const apply = process.argv.includes('--apply');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../../data/university-individualisation/academic');
const CSV = path.join(DATA, 'academic_ratings_final.csv');
const CSV_OTHER = path.join(DATA, 'academic_ratings_naia_njcaa.csv');
const SOURCE = 'scorecard-v1';
const IN_SCOPE = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];

const rows = parseCsvToObjects(fs.readFileSync(CSV, 'utf-8'));
if (rows.length < 1000) throw new Error(`only ${rows.length} rows in ${CSV} — expected ~1,336`);

// One CSV row can cover both sports at a school; the DB holds one row each.
const wanted = new Map();
const check = (r, rating) => {
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    throw new Error(`rating out of range for ${r.School}: ${r.academic_rating}`);
  }
};
for (const r of rows) {
  const rating = Number(r.academic_rating);
  check(r, rating);
  for (const s of String(r.Sports || '').split('+')) {
    const sport = `${s.trim()}-soccer`;
    if (s.trim()) wanted.set(`${r.School}|${sport}`, { rating, source: SOURCE });
  }
}

// NAIA and NJCAA: one row per school name, applied to whichever sports that
// name is carried under.
const other = parseCsvToObjects(fs.readFileSync(CSV_OTHER, 'utf-8'));
if (other.length < 400) throw new Error(`only ${other.length} rows in ${CSV_OTHER} — expected ~507`);
const sportsFor = new Map();
for (const c of db.prepare("SELECT name, sport, division FROM colleges WHERE division IN ('NAIA','NJCAA')").all()) {
  const k = `${c.name}|${c.division}`;
  if (!sportsFor.has(k)) sportsFor.set(k, []);
  sportsFor.get(k).push(c.sport);
}
for (const r of other) {
  const rating = Number(r.academic_rating);
  check(r, rating);
  for (const sport of sportsFor.get(`${r.School}|${r.division}`) || []) {
    wanted.set(`${r.School}|${sport}`, { rating, source: r.source || SOURCE });
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
  if (before !== null && Math.abs(before - want.rating) < 0.05 && col.academic_rating_source === want.source) {
    unchanged.push(key);
  } else {
    changes.push({ id: col.id, key, before, after: want.rating, source: want.source, wasSource: col.academic_rating_source });
  }
}
const notCovered = existing.filter((c) => !wanted.has(`${c.name}|${c.sport}`));

console.log(`${rows.length} NCAA + ${other.length} NAIA/NJCAA CSV rows -> ${wanted.size} (name, sport) pairs`);
console.log(`${existing.length} rows in the database across ${IN_SCOPE.join(', ')}\n`);
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
  for (const c of list) update.run(c.after, c.source, now, c.id);
});
run(changes);

const after = db.prepare(
  `SELECT count(*) AS n, sum(academic_rating IS NULL) AS unrated
     FROM colleges WHERE division IN (${IN_SCOPE.map(() => '?').join(',')})`
).get(...IN_SCOPE);
console.log(`\nwrote ${changes.length} rows (backup: ${path.basename(backup)})`);
console.log(`rows in scope now: ${after.n}, still unrated: ${after.unrated}`);
