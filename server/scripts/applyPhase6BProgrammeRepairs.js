#!/usr/bin/env node
/**
 * PHASE 6B — apply proven-safe programme-universe structural repairs to a
 * NON-PRODUCTION DB, in ONE all-or-nothing transaction. Mutates ONLY the
 * `colleges` table, and only its `active` / `division` / `conference` / `unitid`
 * columns. NEVER deletes a row (discontinued/duplicate rows are retired with
 * active=0 so history and all name/id references are preserved).
 *
 *   node server/scripts/applyPhase6BProgrammeRepairs.js --db <path> \
 *     --status   docs/validation/integrity-audit/phase6b_programme_status_fixture.json \
 *     --division docs/validation/integrity-audit/phase6b_division_fixture.json \
 *     --unitid   docs/validation/integrity-audit/phase6b_unitid_fixture.json \
 *     --dup      docs/validation/integrity-audit/phase6b_duplicate_migration_fixture.json  # dry-run
 *   ... --apply
 *
 * Every entry is precondition-checked against expected OLD values before the
 * transaction opens; any drift aborts with nothing written. Idempotent.
 * SAFETY: refuses a /data path. Only entries with auto_apply_safe !== false are applied.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing /data.'); process.exit(2); }
const readEntries = (p) => { if (!p || !fs.existsSync(path.resolve(p))) return []; const j = JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
assertUnredacted(j, path.resolve(p)); return (j.entries || j).filter((e) => e.auto_apply_safe !== false); };

const statusFx = readEntries(arg('status'));
const divFx = readEntries(arg('division'));
const uniFx = readEntries(arg('unitid'));
const dupFx = readEntries(arg('dup'));

const db = new Database(dbArg, { fileMustExist: true });
const get = db.prepare('SELECT id, name, sport, division, conference, unitid, active FROM colleges WHERE id=?');
const problems = [];

const statusPlan = []; let statusAlready = 0;
for (const e of [...statusFx, ...dupFx]) { // both retire via active
  const row = get.get(e.programme_id);
  if (!row) { problems.push(`status ${e.programme_id}: ABSENT`); continue; }
  if (e.expect_name && row.name !== e.expect_name) { problems.push(`status ${e.programme_id}: name "${row.name}" != "${e.expect_name}"`); continue; }
  const newActive = e.new_active != null ? e.new_active : 0;
  if (row.active === newActive) { statusAlready++; continue; }
  if (e.expect_active != null && row.active !== e.expect_active) { problems.push(`status ${e.programme_id}: active ${row.active} != expected ${e.expect_active}`); continue; }
  statusPlan.push({ id: e.programme_id, active: newActive });
}
const divPlan = []; let divAlready = 0;
for (const e of divFx) {
  const row = get.get(e.programme_id);
  if (!row) { problems.push(`division ${e.programme_id}: ABSENT`); continue; }
  if (e.expect_name && row.name !== e.expect_name) { problems.push(`division ${e.programme_id}: name drift`); continue; }
  if (row.division === e.new_division && (e.new_conference == null || row.conference === e.new_conference)) { divAlready++; continue; }
  if (e.expect_division != null && row.division !== e.expect_division) { problems.push(`division ${e.programme_id}: "${row.division}" != expected "${e.expect_division}"`); continue; }
  divPlan.push({ id: e.programme_id, division: e.new_division, conference: e.new_conference != null ? e.new_conference : row.conference });
}
const uniPlan = []; let uniAlready = 0;
for (const e of uniFx) {
  const row = get.get(e.programme_id);
  if (!row) { problems.push(`unitid ${e.programme_id}: ABSENT`); continue; }
  if (e.expect_name && row.name !== e.expect_name) { problems.push(`unitid ${e.programme_id}: name drift`); continue; }
  if (row.unitid === e.new_unitid) { uniAlready++; continue; }
  const expOld = e.expect_unitid === undefined ? row.unitid : e.expect_unitid;
  if (row.unitid !== expOld && !(row.unitid == null && expOld == null)) { problems.push(`unitid ${e.programme_id}: ${row.unitid} != expected ${expOld}`); continue; }
  uniPlan.push({ id: e.programme_id, unitid: e.new_unitid });
}

console.log('PHASE 6B programme-repair plan');
console.log(`  status/retire (active) : ${statusPlan.length} to set | ${statusAlready} already  (fixtures ${statusFx.length}+${dupFx.length})`);
console.log(`  division corrections   : ${divPlan.length} to set | ${divAlready} already  (fixture ${divFx.length})`);
console.log(`  unitid corrections     : ${uniPlan.length} to set | ${uniAlready} already  (fixture ${uniFx.length})`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const uActive = db.prepare('UPDATE colleges SET active=@active, updated_date=datetime(\'now\') WHERE id=@id');
const uDiv = db.prepare('UPDATE colleges SET division=@division, conference=@conference, updated_date=datetime(\'now\') WHERE id=@id');
const uUni = db.prepare('UPDATE colleges SET unitid=@unitid, updated_date=datetime(\'now\') WHERE id=@id');
let s = 0, d = 0, u = 0;
try {
  db.exec('BEGIN');
  for (const p of statusPlan) { if (uActive.run(p).changes !== 1) throw new Error(`status ${p.id}`); s++; }
  for (const p of divPlan) { if (uDiv.run(p).changes !== 1) throw new Error(`division ${p.id}`); d++; }
  for (const p of uniPlan) { if (uUni.run(p).changes !== 1) throw new Error(`unitid ${p.id}`); u++; }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity_check failed: ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED in one transaction — status/retire ${s}, division ${d}, unitid ${u}. integrity ${integ}.`);
} catch (err) {
  try { db.exec('ROLLBACK'); } catch { /* */ }
  console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1);
}
db.close();
