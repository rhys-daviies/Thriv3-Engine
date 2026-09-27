#!/usr/bin/env node
/**
 * PHASE 6C.2 — reassign mis-filed EXISTING coach rows to their correct canonical
 * programme (identity-integrity recovery), on a NON-PRODUCTION DB, in ONE
 * all-or-nothing transaction. NO new coach rows; NO deletions. Only reassigns a
 * row's school/sport/division and refreshes its authoritative evidence when proven.
 *
 *   node server/scripts/applyPhase6C2Recovery.js --db <path> \
 *     --recovery docs/validation/integrity-audit/phase6c2_existing_coach_recovery_fixture.json  # dry-run
 *   ... --apply
 *
 * Applies ONLY entries with auto_apply_safe===true (NEVER_CORRECT mis-files whose
 * every identity/history/target check passed). Guards: /data refusal; expected-OLD
 * values (school, sport, email) must match; target programme must exist+active and
 * NOT be a held duplicate/campus-collision/IU-Columbus/null-unitid; the reassignment
 * must not collide with an existing (email, school, sport); one transaction; integrity
 * check; rollback; idempotent. email_confirmed_at never touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing /data.'); process.exit(2); }
const j = JSON.parse(fs.readFileSync(path.resolve(arg('recovery')), 'utf8'));
const entries = (j.entries || j).filter((e) => e.auto_apply_safe === true);
const norm = (s) => String(s || '').trim().toLowerCase();
// held identities that must never be a reassignment target
const HELD_UNITIDS = new Set([231165, 498562, 498571, 179308, 195544, 151111]); // campus-collisions + IU Columbus

const db = new Database(dbArg, { fileMustExist: true });
const get = db.prepare('SELECT id, full_name, email, school, sport, division FROM coaches WHERE id=?');
const prog = db.prepare('SELECT unitid, active FROM colleges WHERE name=? AND sport=?');
const collide = db.prepare('SELECT id FROM coaches WHERE lower(email)=? AND school=? AND sport=? AND id!=?');
const problems = [];
const plan = []; let already = 0;
for (const e of entries) {
  const row = get.get(e.coach_id);
  if (!row) { problems.push(`${e.coach_id}: ABSENT`); continue; }
  // idempotent: already at target
  if (row.school === e.proposed_school && row.sport === e.proposed_sport) { already++; continue; }
  // expected-old guards
  if (e.expected_old_school != null && row.school !== e.expected_old_school) { problems.push(`${e.coach_id}: old school "${row.school}" != "${e.expected_old_school}"`); continue; }
  if (e.expected_old_sport != null && row.sport !== e.expected_old_sport) { problems.push(`${e.coach_id}: old sport mismatch`); continue; }
  if (e.expected_old_email != null && norm(row.email) !== norm(e.expected_old_email)) { problems.push(`${e.coach_id}: old email mismatch`); continue; }
  // target programme exists + active + not held
  const p = prog.get(e.proposed_school, e.proposed_sport);
  if (!p) { problems.push(`${e.coach_id}: target ${e.proposed_school}/${e.proposed_sport} not found`); continue; }
  if (p.active !== 1) { problems.push(`${e.coach_id}: target not active`); continue; }
  if (e.proposed_unitid != null && Number(p.unitid) !== Number(e.proposed_unitid)) { problems.push(`${e.coach_id}: target unitid ${p.unitid} != fixture ${e.proposed_unitid}`); continue; }
  if (p.unitid == null || HELD_UNITIDS.has(Number(p.unitid))) { problems.push(`${e.coach_id}: target unitid held/ambiguous (${p.unitid})`); continue; }
  // collision guard
  const newEmail = e.proposed_email || row.email;
  if (collide.get(norm(newEmail), e.proposed_school, e.proposed_sport, e.coach_id)) { problems.push(`${e.coach_id}: would collide with existing (email,school,sport) at target`); continue; }
  plan.push({ e, row, division: e.proposed_division || row.division, newEmail });
}

console.log('PHASE 6C.2 recovery plan');
console.log(`  reassign existing rows: ${plan.length} to move | ${already} already  (safe entries ${entries.length})`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const upd = db.prepare(`UPDATE coaches SET school=@school, sport=@sport, division=@division, email=@email,
  email_source_url=@email_source_url, currentness_status='CURRENT', currentness_checked_at=@checked_at,
  currentness_source_url=@currentness_source_url, currentness_reason=@reason,
  email_seen_on_source_at=@seen_at, email_seen_on_source_url=@seen_url
  WHERE id=@id AND school=@expold_school AND sport=@expold_sport`);
let moved = 0;
try {
  db.exec('BEGIN');
  for (const { e, row, division, newEmail } of plan) {
    const r = upd.run({ id: e.coach_id, school: e.proposed_school, sport: e.proposed_sport, division,
      email: newEmail, email_source_url: e.email_source_url || e.current_source_url || row.email,
      checked_at: e.currentness_checked_at || '2026-09-27', currentness_source_url: e.current_source_url || e.email_source_url,
      reason: (e.evidence_rationale || 'mis-filed record reassigned to canonical programme (NEVER_CORRECT)').slice(0, 240),
      seen_at: e.email_seen_on_source_at || '2026-09-27', seen_url: e.email_source_url || e.current_source_url,
      expold_school: row.school, expold_sport: row.sport });
    if (r.changes !== 1) throw new Error(`reassign ${e.coach_id}`);
    moved++;
  }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED — reassigned ${moved}. integrity ${integ}.`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
