#!/usr/bin/env node
/**
 * PHASE 4B (Part A) — apply the externally-proven Phase 4A currency repairs.
 *
 *   node server/scripts/applyCoachCurrencyRepairs.js --db <path> \
 *       --fixture docs/validation/integrity-audit/phase4b_repair_fixture.json      # dry-run
 *   ... --apply                                                                     # write
 *
 * Applies ONLY proven facts:
 *   - currentness stamps: CURRENT / PROVEN_STALE (with checked_at + source_url +
 *     reason). PROVEN_STALE is what makes reconciliation fail outreach closed;
 *     UNKNOWN rows are never touched. Historical coach identity is preserved —
 *     nothing is deleted to mark someone stale.
 *   - email_updates: one changed official address (old -> new), precondition old.
 *   - source_updates: one corrected source URL (old -> new).
 *   - deletes: wrong-sport duplicate rows whose correct record already exists.
 *
 * ONE TRANSACTION, all-or-nothing. Idempotent. Refuses /data. Never edits
 * email_status/eligibility to encode employment; currentness lives in its own
 * columns.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db <target>.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing to target the production /data volume.'); process.exit(2); }
const fx = JSON.parse(fs.readFileSync(path.resolve(arg('fixture')), 'utf8'));
assertUnredacted(fx, path.resolve(arg('fixture')));

const db = new Database(dbArg, { fileMustExist: true });
const get = db.prepare('SELECT id, full_name, email, school, sport, email_source_url, currentness_status FROM coaches WHERE id=?');
const setCur = db.prepare('UPDATE coaches SET currentness_status=@status, currentness_checked_at=@checked_at, currentness_source_url=@source_url, currentness_reason=@reason WHERE id=@coach_id');
const setEmail = db.prepare('UPDATE coaches SET email=@new WHERE id=@id AND email=@old');
const setSource = db.prepare('UPDATE coaches SET email_source_url=@new WHERE id=@id AND email_source_url=@old');
const del = db.prepare('DELETE FROM coaches WHERE id=@id AND school=@school AND sport=@sport');

const problems = [];
const curPlan = []; let curAlready = 0;
for (const c of fx.currentness) {
  const row = get.get(c.coach_id);
  if (!row) { problems.push(`currentness ${c.expect_name}: ABSENT`); continue; }
  if (c.expect_name && row.full_name !== c.expect_name) { problems.push(`currentness ${c.coach_id}: name "${row.full_name}" != "${c.expect_name}"`); continue; }
  if (row.currentness_status === c.status) { curAlready++; continue; } // idempotent
  curPlan.push(c);
}
const emailPlan = []; let emailAlready = 0;
for (const e of fx.email_updates) {
  const row = get.get(e.coach_id);
  if (!row) { problems.push(`email ${e.expect_name}: ABSENT`); continue; }
  if (row.email === e.new_email) { emailAlready++; continue; }
  if (row.email !== e.old_email) { problems.push(`email ${e.expect_name}: current "${row.email}" != old "${e.old_email}"`); continue; }
  emailPlan.push(e);
}
const srcPlan = []; let srcAlready = 0;
for (const s of fx.source_updates) {
  const row = get.get(s.coach_id);
  if (!row) { problems.push(`source ${s.expect_name}: ABSENT`); continue; }
  if (row.email_source_url === s.new_source_url) { srcAlready++; continue; }
  if (row.email_source_url !== s.old_source_url) { problems.push(`source ${s.expect_name}: current != old`); continue; }
  srcPlan.push(s);
}
const delPlan = []; let delAlready = 0;
for (const d of fx.deletes) {
  const row = get.get(d.coach_id);
  if (!row) { delAlready++; continue; } // already deleted
  if (row.school !== d.redundant_school || row.sport !== d.redundant_sport) { problems.push(`delete ${d.name}: row drift`); continue; }
  if (!get.get(d.retained_coach_id)) { problems.push(`delete ${d.name}: retained record ${d.retained_coach_id} MISSING`); continue; }
  delPlan.push(d);
}

console.log(`currentness: ${fx.currentness.length} fixture | ${curPlan.length} to set | ${curAlready} already`);
console.log(`email:  ${fx.email_updates.length} | ${emailPlan.length} to update | ${emailAlready} already`);
console.log(`source: ${fx.source_updates.length} | ${srcPlan.length} to update | ${srcAlready} already`);
console.log(`delete: ${fx.deletes.length} | ${delPlan.length} to delete | ${delAlready} already`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

let cur = 0, em = 0, sr = 0, dl = 0;
try {
  db.exec('BEGIN');
  for (const c of curPlan) { if (setCur.run(c).changes !== 1) throw new Error(`currentness ${c.expect_name}`); cur++; }
  for (const e of emailPlan) { if (setEmail.run({ id: e.coach_id, new: e.new_email, old: e.old_email }).changes !== 1) throw new Error(`email ${e.expect_name}`); em++; }
  for (const s of srcPlan) { if (setSource.run({ id: s.coach_id, new: s.new_source_url, old: s.old_source_url }).changes !== 1) throw new Error(`source ${s.expect_name}`); sr++; }
  for (const d of delPlan) { if (del.run({ id: d.coach_id, school: d.redundant_school, sport: d.redundant_sport }).changes !== 1) throw new Error(`delete ${d.name}`); dl++; }
  db.exec('COMMIT');
  console.log(`\nAPPLIED — currentness ${cur}, email ${em}, source ${sr}, deletes ${dl}, in one transaction.`);
} catch (e) {
  try { db.exec('ROLLBACK'); } catch { /* */ }
  console.error('\nROLLED BACK:', e.message); db.close(); process.exit(1);
}
db.close();
