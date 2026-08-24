#!/usr/bin/env node
/**
 * Backfills the college columns the Phase 1.2 matching model needs.
 *
 * Three of the deck's six criteria could not be scored at all before this
 * ran: `location` was empty on every one of the 2,374 college rows, there was
 * no cost figure anywhere in the database, and nothing recorded whether a
 * programme was rising or falling. This joins that in from stores that
 * already exist — no new collection.
 *
 *   geography + cost + admissions  Scorecard, joined on UNITID through the
 *                                  two academic crosswalks
 *   trajectory                     soccer_records.csv / _women.csv, four
 *                                  seasons of W/L/D per programme
 *
 * Dry run by default. `--apply` backs the database up first, then writes.
 *
 *   node server/scripts/loadMatchingInputs.js
 *   node server/scripts/loadMatchingInputs.js --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import db from '../db/client.js';
import { parseCsvToObjects } from '../lib/csv.js';

const APPLY = process.argv.includes('--apply');
const RAW = path.join(os.homedir(), 'Documents/Thriv3/University individualisation/_raw');
const RECORDS = path.join(os.homedir(), 'Documents/Thriv3/Soccer Records');

const SPORT_RECORDS = {
  'mens-soccer': 'soccer_records.csv',
  'womens-soccer': 'soccer_records_women.csv',
};

const readCsv = (filePath) => parseCsvToObjects(fs.readFileSync(filePath, 'utf-8'));

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// UNITID lookup, from both crosswalks
// ---------------------------------------------------------------------------

/**
 * UNITID is a property of the institution, not of the programme, so the two
 * crosswalks are merged into one school -> unitid map. A school appearing in
 * both with *different* ids is a genuine identity defect and is reported
 * rather than silently resolved — that is the failure mode that put Cal State
 * Dominguez Hills' data on Cal State Bakersfield.
 */
function buildUnitidMap(report) {
  const map = new Map();
  const conflicts = [];
  const add = (school, unitid, source) => {
    const id = num(unitid);
    if (!school || id === null) return;
    const existing = map.get(school);
    if (existing && existing.unitid !== id) {
      conflicts.push({ school, a: existing, b: { unitid: id, source } });
      return;
    }
    if (!existing) map.set(school, { unitid: id, source });
  };

  for (const r of readCsv(path.join(RAW, 'academic_crosswalk.csv'))) add(r.school, r.unitid, 'ncaa-crosswalk');
  for (const r of readCsv(path.join(RAW, 'academic_crosswalk_naia_njcaa.csv'))) add(r.school, r.unitid, 'naia-njcaa-crosswalk');

  report.unitidConflicts = conflicts;
  return map;
}

// ---------------------------------------------------------------------------
// Scorecard rows, keyed on UNITID
// ---------------------------------------------------------------------------

function buildScorecardMap() {
  const rows = readCsv(path.join(RAW, 'matching_raw_scorecard.csv'));
  const map = new Map();
  for (const r of rows) {
    const id = num(r.unitid);
    if (id === null) continue;
    const control = num(r.control);
    // Public and private institutions report net price in different columns,
    // and exactly one of them is populated. Reading only NPT4_PUB would have
    // left every private school without a price.
    const netPrice = control === 1 ? num(r.net_price_pub) : num(r.net_price_priv);
    map.set(id, {
      name: r.name,
      city: r.city || null,
      state: (r.state || '').toUpperCase() || null,
      latitude: num(r.latitude),
      longitude: num(r.longitude),
      control,
      netPrice: netPrice ?? num(r.net_price_pub) ?? num(r.net_price_priv),
      tuitionIn: num(r.tuition_in_state),
      tuitionOut: num(r.tuition_out_state),
      satAvg: num(r.sat_avg),
      admitRate: num(r.admit_rate),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Trajectory, from four seasons of results
// ---------------------------------------------------------------------------

/**
 * Points rate over a set of seasons: (3W + D) / 3G.
 *
 * Win percentage alone is wrong for soccer, where a draw is a third of the
 * competitive information in the table. A side that draws half its fixtures
 * is not equivalent to one that loses them.
 */
function pointsRate(row, seasons) {
  let w = 0, l = 0, d = 0;
  for (const s of seasons) {
    w += num(row[`${s}_W`]) ?? 0;
    l += num(row[`${s}_L`]) ?? 0;
    d += num(row[`${s}_D`]) ?? 0;
  }
  const games = w + l + d;
  if (games < 10) return null; // too few fixtures for a rate to mean anything
  return (3 * w + d) / (3 * games);
}

function buildRecordMap(sport) {
  const file = SPORT_RECORDS[sport];
  const full = path.join(RECORDS, file);
  if (!fs.existsSync(full)) return new Map();
  const map = new Map();
  for (const r of readCsv(full)) {
    if (!r.name) continue;
    map.set(r.name, {
      recent: pointsRate(r, ['2024', '2025']),
      prior: pointsRate(r, ['2022', '2023']),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Mechanical identity check
// ---------------------------------------------------------------------------

/**
 * Several school names carry a disambiguating state in parentheses — "Anderson
 * (SC)", "Marian (WI)". Those are free assertions about what state the row is
 * in, so the loaded state has to agree with them. A mismatch means the UNITID
 * join landed on a different institution, which is exactly the class of defect
 * that has bitten this data three times now.
 */
const STATE_HINT = /\(([A-Z]{2})\)\s*$/;

function stateHintMismatches(pending) {
  const bad = [];
  for (const p of pending) {
    const m = STATE_HINT.exec(p.name);
    if (!m || !p.values.state) continue;
    if (m[1] !== p.values.state) bad.push({ name: p.name, sport: p.sport, hint: m[1], loaded: p.values.state, unitid: p.unitid });
  }
  return bad;
}

// ---------------------------------------------------------------------------

function main() {
  const report = {};
  const unitids = buildUnitidMap(report);
  const scorecard = buildScorecardMap();
  const records = { 'mens-soccer': buildRecordMap('mens-soccer'), 'womens-soccer': buildRecordMap('womens-soccer') };

  const colleges = db.prepare('SELECT id, name, sport, division, conference FROM colleges').all();
  const pending = [];
  const misses = { noUnitid: [], noScorecard: [], noRecord: [] };

  for (const c of colleges) {
    const cross = unitids.get(c.name);
    const sc = cross ? scorecard.get(cross.unitid) : null;
    const rec = records[c.sport]?.get(c.name) || null;

    if (!cross) misses.noUnitid.push(`${c.name} [${c.sport}]`);
    else if (!sc) misses.noScorecard.push(`${c.name} [${c.sport}] unitid=${cross.unitid}`);
    if (!rec) misses.noRecord.push(`${c.name} [${c.sport}]`);
    if (!sc && !rec) continue;

    pending.push({
      id: c.id,
      name: c.name,
      sport: c.sport,
      unitid: cross?.unitid ?? null,
      values: {
        unitid: cross?.unitid ?? null,
        city: sc?.city ?? null,
        state: sc?.state ?? null,
        latitude: sc?.latitude ?? null,
        longitude: sc?.longitude ?? null,
        control: sc?.control ?? null,
        net_price: sc?.netPrice ?? null,
        tuition_in_state: sc?.tuitionIn ?? null,
        tuition_out_state: sc?.tuitionOut ?? null,
        sat_avg: sc?.satAvg ?? null,
        admit_rate: sc?.admitRate ?? null,
        recent_win_pct: rec?.recent ?? null,
        prior_win_pct: rec?.prior ?? null,
        matching_data_source: [sc ? 'scorecard' : null, rec ? 'soccer-records' : null].filter(Boolean).join('+'),
      },
    });
  }

  const mismatches = stateHintMismatches(pending);

  // ---- report ----
  const total = colleges.length;
  const filled = (field) => pending.filter((p) => p.values[field] !== null).length;
  console.log(`\ncolleges: ${total}   joined: ${pending.length}`);
  console.log(`  unitid conflicts across crosswalks: ${report.unitidConflicts.length}`);
  console.log(`  state-hint mismatches: ${mismatches.length}`);
  console.log(`\n  ${'column'.padEnd(22)} ${'filled'.padStart(6)}  ${'of all colleges'.padStart(15)}`);
  for (const f of ['unitid', 'city', 'state', 'latitude', 'net_price', 'tuition_in_state', 'sat_avg', 'admit_rate', 'recent_win_pct', 'prior_win_pct']) {
    const n = filled(f);
    console.log(`  ${f.padEnd(22)} ${String(n).padStart(6)}  ${String(Math.round((100 * n) / total) + '%').padStart(15)}`);
  }
  console.log(`\n  no unitid: ${misses.noUnitid.length}  no scorecard row: ${misses.noScorecard.length}  no season record: ${misses.noRecord.length}`);
  for (const label of ['noUnitid', 'noScorecard']) {
    if (misses[label].length) console.log(`    ${label}: ${misses[label].slice(0, 12).join('; ')}${misses[label].length > 12 ? ` … +${misses[label].length - 12}` : ''}`);
  }

  if (report.unitidConflicts.length) {
    console.log('\n  UNITID CONFLICTS — not written:');
    for (const c of report.unitidConflicts.slice(0, 20)) console.log(`    ${c.school}: ${c.a.unitid} (${c.a.source}) vs ${c.b.unitid} (${c.b.source})`);
  }
  if (mismatches.length) {
    console.log('\n  STATE-HINT MISMATCHES — the join landed on the wrong institution:');
    for (const m of mismatches.slice(0, 30)) console.log(`    ${m.name} [${m.sport}] expects ${m.hint}, Scorecard says ${m.loaded} (unitid ${m.unitid})`);
  }

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.\n');
    return;
  }

  // A mismatch means the identity join is wrong somewhere; writing anyway
  // would put one school's cost and coordinates on another.
  if (mismatches.length) {
    console.error('\nrefusing to apply: resolve the state-hint mismatches first.\n');
    process.exit(1);
  }

  const dbPath = db.name;
  const backup = `${dbPath}.pre-matching-inputs-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, backup);
  console.log(`\nbacked up -> ${path.basename(backup)}`);

  const cols = Object.keys(pending[0].values);
  const stmt = db.prepare(`UPDATE colleges SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_date = @updated_date WHERE id = @id`);
  const run = db.transaction((rows) => {
    for (const p of rows) stmt.run({ ...p.values, id: p.id, updated_date: new Date().toISOString() });
  });
  run(pending);
  console.log(`updated ${pending.length} college rows.\n`);
}

main();
