#!/usr/bin/env node
/**
 * PHASE 3B — apply the externally-verified coach institution-filing repairs from
 * the Phase 3A ground-truth audit (docs/validation/integrity-audit).
 *
 *   node server/scripts/applyCoachInstitutionRepairs.js --db <path> \
 *       --reassign docs/validation/integrity-audit/phase3b_reassign_fixture.json \
 *       --dedupe   docs/validation/integrity-audit/phase3b_duplicate_fixture.json          # dry-run
 *   ... --apply                                                                            # write
 *
 * Every coach in these fixtures was proven filed under the WRONG institution: a
 * same/near-name collision at acquisition. The authoritative source domain +
 * the coach's own email domain resolve to the TRUE institution. This corrects
 * ONLY the institution filing field (`coaches.school`) for 112 reassignments,
 * and DELETES 6 redundant duplicate rows whose correct copy already exists.
 *
 * ONE TRANSACTION, all-or-nothing. Exact old-value preconditions per row. Never
 * touches coach name, email, email_status, source URL, sport or role. Refuses
 * the production /data path. The 9 HUMAN_REVIEW records are not in these
 * fixtures and are never touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db <target>.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) {
  console.error('Refusing to target the production /data volume.'); process.exit(2);
}
const reassign = JSON.parse(fs.readFileSync(path.resolve(arg('reassign')), 'utf8'));
assertUnredacted(reassign, path.resolve(arg('reassign')));
const dedupe = JSON.parse(fs.readFileSync(path.resolve(arg('dedupe')), 'utf8'));
assertUnredacted(dedupe, path.resolve(arg('dedupe')));

const db = new Database(dbArg, { fileMustExist: true });
const coachById = db.prepare('SELECT id, full_name, email, school, sport FROM coaches WHERE id = ?');
const collUnitid = db.prepare('SELECT unitid FROM colleges WHERE name = ? AND sport = ?');
const existsRow = db.prepare('SELECT id FROM coaches WHERE id = ?');
const updSchool = db.prepare('UPDATE coaches SET school = @correct WHERE id = @id AND school = @old AND sport = @sport');
const delRow = db.prepare('DELETE FROM coaches WHERE id = @id AND school = @school AND email = @email AND sport = @sport');

const problems = [];

// ---- reassignment preconditions ----
const reassignPlan = [];
for (const r of reassign) {
  const cur = coachById.get(r.coach_id);
  if (!cur) { problems.push(`reassign ${r.coach_id}: ABSENT`); continue; }
  if (cur.school !== r.old_school) { problems.push(`reassign ${r.coach_name}: school "${cur.school}" != expected "${r.old_school}"`); continue; }
  if (cur.sport !== r.sport) { problems.push(`reassign ${r.coach_name}: sport drift`); continue; }
  const oldU = collUnitid.get(r.old_school, r.sport);
  if (!oldU || Number(oldU.unitid) !== Number(r.old_unitid)) { problems.push(`reassign ${r.coach_name}: old (${r.old_school}) unitid != ${r.old_unitid}`); continue; }
  const newU = collUnitid.get(r.correct_school, r.sport);
  if (!newU || Number(newU.unitid) !== Number(r.correct_unitid)) { problems.push(`reassign ${r.coach_name}: correct programme (${r.correct_school},${r.sport}) missing/≠${r.correct_unitid}`); continue; }
  reassignPlan.push(r);
}

// ---- dedupe preconditions ----
const dedupePlan = [];
for (const d of dedupe) {
  const red = coachById.get(d.redundant_coach_id);
  const can = coachById.get(d.canonical_coach_id);
  if (!red) { problems.push(`dedupe ${d.name}: redundant ABSENT`); continue; }
  if (!can) { problems.push(`dedupe ${d.name}: canonical ABSENT`); continue; }
  if (red.email !== d.email || can.email !== d.email) { problems.push(`dedupe ${d.name}: email mismatch`); continue; }
  if (red.sport !== d.sport || can.sport !== d.sport) { problems.push(`dedupe ${d.name}: sport mismatch`); continue; }
  if (red.school !== d.redundant_school) { problems.push(`dedupe ${d.name}: redundant school "${red.school}" != "${d.redundant_school}"`); continue; }
  if (can.school !== d.canonical_school) { problems.push(`dedupe ${d.name}: canonical school "${can.school}" != "${d.canonical_school}"`); continue; }
  dedupePlan.push(d);
}

console.log(`reassign: ${reassign.length} fixture | ${reassignPlan.length} pass preconditions`);
console.log(`dedupe:   ${dedupe.length} fixture | ${dedupePlan.length} pass preconditions`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). No rows changed.`); db.close(); process.exit(1); }

if (!apply) {
  console.log(`\nDRY RUN — would reassign ${reassignPlan.length} and delete ${dedupePlan.length}. Re-run with --apply.`);
  db.close(); process.exit(0);
}

let reassigned = 0; let deleted = 0;
try {
  db.exec('BEGIN');
  for (const r of reassignPlan) {
    const res = updSchool.run({ id: r.coach_id, correct: r.correct_school, old: r.old_school, sport: r.sport });
    if (res.changes !== 1) throw new Error(`reassign ${r.coach_name}: expected 1 changed, got ${res.changes}`);
    reassigned += 1;
  }
  for (const d of dedupePlan) {
    const res = delRow.run({ id: d.redundant_coach_id, school: d.redundant_school, email: d.email, sport: d.sport });
    if (res.changes !== 1) throw new Error(`dedupe ${d.name}: expected 1 deleted, got ${res.changes}`);
    deleted += 1;
  }
  db.exec('COMMIT');
  console.log(`\nAPPLIED — reassigned ${reassigned} coaches, deleted ${deleted} duplicates, in one transaction.`);
} catch (e) {
  try { db.exec('ROLLBACK'); } catch { /* nothing */ }
  console.error('\nROLLED BACK ENTIRE REPAIR SET:', e.message);
  db.close(); process.exit(1);
}
db.close();
