#!/usr/bin/env node
/**
 * Imports colleges.notable_majors from
 * scratchpad/notable_majors.csv (see extract_notable_majors.py, which
 * derives it from College Scorecard's per-institution PCIP fields), joined
 * on colleges.unitid -- the same key already used for academic_rating, with
 * 99.5% coverage on colleges.
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import fs from 'node:fs';
import { College } from '../db/entities/college.js';
import { parseCsv } from '../lib/csv.js';

const APPLY = process.argv.includes('--apply');
const SRC_PATH = '/private/tmp/claude-501/-Users-rhysdavies-Documents-Recruitmatch-app/1e1a3c6c-a178-4361-afa1-5cda2c84e616/scratchpad/notable_majors.csv';

function loadByUnitid() {
  const text = fs.readFileSync(SRC_PATH, 'utf-8');
  const [header, ...rows] = parseCsv(text).filter((r) => r.length > 1);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const byUnitid = new Map();
  for (const r of rows) byUnitid.set(r[idx.unitid], r[idx.notable_majors]);
  return byUnitid;
}

function main() {
  const majorsByUnitid = loadByUnitid();
  const colleges = College.filter({});

  let set = 0;
  let unchanged = 0;
  let noUnitid = 0;
  let noMajorsForUnitid = 0;

  for (const c of colleges) {
    if (!c.unitid) { noUnitid++; continue; }
    const majorsJson = majorsByUnitid.get(String(c.unitid));
    if (!majorsJson) { noMajorsForUnitid++; continue; }
    const majors = JSON.parse(majorsJson);
    const current = JSON.stringify(c.notable_majors || []);
    if (current === majorsJson) { unchanged++; continue; }
    set++;
    if (APPLY) College.update(c.id, { notable_majors: majors });
  }

  console.log(`Total colleges: ${colleges.length}`);
  console.log(`${set} ${APPLY ? 'set' : 'would set'}, already correct: ${unchanged}, no unitid: ${noUnitid}, unitid has no notable majors: ${noMajorsForUnitid}`);
  if (!APPLY) console.log('\nDry run only -- re-run with --apply to write these to the database.');
}

main();
