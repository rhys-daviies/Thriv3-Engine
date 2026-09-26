#!/usr/bin/env node
/**
 * PHASE 4F — apply the proven eligible-coach integrity closure to a NON-PRODUCTION
 * database, in ONE all-or-nothing transaction.
 *
 *   node server/scripts/applyPhase4FClosure.js --db <path> \
 *     --fixture   docs/validation/integrity-audit/phase4e_consolidated_fixture.json \
 *     --promotion docs/validation/integrity-audit/phase4f_promotion_input.json      # dry-run
 *   ... --apply                                                                       # write
 *
 * What it does, and the guarantees:
 *   D  89 proven defects (75 PROVEN_STALE + 12 MOVED + 2 WRONG_SPORT) -> currentness
 *      PROVEN_STALE with checked_at/source_url/reason. Identity/history preserved
 *      (NOTHING is deleted). MOVED/WRONG_SPORT carry the move/sport evidence in the
 *      reason: the fixture has no proven-safe reassignment target, so the old
 *      association is marked non-current rather than inventing a new current record.
 *   E  10 deterministic email corrections. Expected-old-value guard: the update
 *      only fires WHERE the stored address equals the pre-image read at plan time;
 *      a row already holding the new address is a no-op (idempotent).
 *   F  NAME_CORRECTION is NEVER applied here (coach_seasons name-join risk). Count 0.
 *   G  CURRENT promotions from external page evidence. Never promotes a defect,
 *      never overwrites PROVEN_STALE, never promotes RECENT/UNKNOWN (the promotion
 *      input already excludes them). Idempotent (skips rows already CURRENT).
 *   H  email_seen_on_source_* populated ONLY where the DB address exactly equals the
 *      address proven on the current page. Never touches email_confirmed_at.
 *
 * SAFETY: refuses a /data path. Every change is precondition-checked before the
 * transaction opens; any drift aborts with nothing written. Idempotent: re-running
 * makes no further change. Mutates only the `coaches` table.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db <target>.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing to target the production /data volume.'); process.exit(2); }

const fx = JSON.parse(fs.readFileSync(path.resolve(arg('fixture')), 'utf8'));
const promo = JSON.parse(fs.readFileSync(path.resolve(arg('promotion')), 'utf8'));
const norm = (s) => String(s || '').trim().toLowerCase();

const db = new Database(dbArg, { fileMustExist: true });
const cols = new Set(db.prepare('PRAGMA table_info(coaches)').all().map((c) => c.name));
for (const c of ['currentness_status', 'currentness_checked_at', 'currentness_source_url', 'currentness_reason', 'email_seen_on_source_at', 'email_seen_on_source_url']) {
  if (!cols.has(c)) { console.error(`Column coaches.${c} is missing — run the migration first.`); db.close(); process.exit(2); }
}
const get = db.prepare('SELECT id, full_name, email, school, sport, currentness_status, currentness_source_url, email_seen_on_source_url FROM coaches WHERE id=?');

const defectIds = new Set([...fx.PROVEN_STALE, ...fx.MOVED, ...fx.WRONG_SPORT].map((e) => e.coach_id));
const problems = [];

// ---- D: 89 defects -> PROVEN_STALE ----
const stalePlan = []; let staleAlready = 0;
function planStale(e, kind) {
  const row = get.get(e.coach_id);
  if (!row) { problems.push(`${kind} ${e.coach_id}: ABSENT`); return; }
  const reason = kind === 'MOVED'
    ? `MOVED from ${e.from || row.school}${e.new_email ? ` (new: ${e.new_email})` : ''} — old association no longer current`
    : kind === 'WRONG_SPORT'
      ? `WRONG_SPORT — coach not on this sport's current staff (${e.evidence_url})`
      : `PROVEN_STALE (${e.reason || 'STALE'})${e.evidence_type ? ` — ${e.evidence_type}` : ''}`;
  const src = e.evidence_url || row.currentness_source_url || null;
  if (row.currentness_status === 'PROVEN_STALE' && row.currentness_source_url === src) { staleAlready++; return; } // idempotent
  stalePlan.push({ coach_id: e.coach_id, checked_at: e.checked_at || '2026-09-26', source_url: src, reason });
}
fx.PROVEN_STALE.forEach((e) => planStale(e, 'PROVEN_STALE'));
fx.MOVED.forEach((e) => planStale(e, 'MOVED'));
fx.WRONG_SPORT.forEach((e) => planStale(e, 'WRONG_SPORT'));

// ---- E: 10 email corrections (expected-old-value guard) ----
const emailPlan = []; let emailAlready = 0;
for (const e of fx.EMAIL_CORRECTION) {
  const row = get.get(e.coach_id);
  if (!row) { problems.push(`email ${e.coach_id}: ABSENT`); continue; }
  if (!e.new_email || !e.new_email.includes('@')) { problems.push(`email ${e.coach_id}: bad new_email`); continue; }
  if (norm(row.email) === norm(e.new_email)) { emailAlready++; continue; } // idempotent
  if (!row.email || !row.email.includes('@')) { problems.push(`email ${e.coach_id}: stored address not a real email ("${row.email}")`); continue; }
  emailPlan.push({ coach_id: e.coach_id, old_email: row.email, new_email: e.new_email });
}

// ---- G: CURRENT promotions ----
const curPlan = []; let curAlready = 0, curBlockedStale = 0;
for (const p of promo.current_promotions) {
  if (defectIds.has(p.coach_id)) { curBlockedStale++; continue; } // never promote a defect
  const row = get.get(p.coach_id);
  if (!row) { problems.push(`promote ${p.coach_id}: ABSENT`); continue; }
  if (row.currentness_status === 'PROVEN_STALE') { curBlockedStale++; continue; } // never flip stale -> current
  if (row.currentness_status === 'CURRENT' && row.currentness_source_url === p.source_url) { curAlready++; continue; } // idempotent
  curPlan.push({ coach_id: p.coach_id, checked_at: p.checked_at, source_url: p.source_url, reason: String(p.reason || 'CURRENT_CONFIRMED').slice(0, 240) });
}

// ---- H: email_seen_on_source (exact-match guard) ----
const emailNewById = new Map(emailPlan.map((e) => [e.coach_id, e.new_email])); // post-correction address
const seenPlan = []; let seenAlready = 0, seenSkipMismatch = 0;
for (const s of promo.email_seen) {
  const row = get.get(s.coach_id);
  if (!row) { problems.push(`seen ${s.coach_id}: ABSENT`); continue; }
  const effectiveEmail = emailNewById.get(s.coach_id) || row.email; // account for a correction applied in this same txn
  if (norm(effectiveEmail) !== norm(s.stored_email)) { seenSkipMismatch++; continue; } // exact-match only
  if (row.email_seen_on_source_url === s.seen_url) { seenAlready++; continue; } // idempotent
  seenPlan.push({ coach_id: s.coach_id, seen_at: s.seen_at, seen_url: s.seen_url });
}

console.log('PHASE 4F closure plan');
console.log(`  D  defects->PROVEN_STALE : ${stalePlan.length} to set | ${staleAlready} already  (fixture 89)`);
console.log(`  E  email corrections     : ${emailPlan.length} to update | ${emailAlready} already  (fixture ${fx.EMAIL_CORRECTION.length})`);
console.log(`  F  name corrections      : 0 (guarded, never applied)  (fixture ${fx.NAME_CORRECTION.length})`);
console.log(`  G  CURRENT promotions    : ${curPlan.length} to set | ${curAlready} already | ${curBlockedStale} blocked(defect/stale)  (input ${promo.current_promotions.length})`);
console.log(`  H  email_seen populated  : ${seenPlan.length} to set | ${seenAlready} already | ${seenSkipMismatch} skipped(not exact match)  (input ${promo.email_seen.length})`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const setStale = db.prepare("UPDATE coaches SET currentness_status='PROVEN_STALE', currentness_checked_at=@checked_at, currentness_source_url=@source_url, currentness_reason=@reason WHERE id=@coach_id");
const setEmail = db.prepare('UPDATE coaches SET email=@new_email WHERE id=@coach_id AND email=@old_email');
const setCurrent = db.prepare("UPDATE coaches SET currentness_status='CURRENT', currentness_checked_at=@checked_at, currentness_source_url=@source_url, currentness_reason=@reason WHERE id=@coach_id AND currentness_status IS NOT 'PROVEN_STALE'");
const setSeen = db.prepare('UPDATE coaches SET email_seen_on_source_at=@seen_at, email_seen_on_source_url=@seen_url WHERE id=@coach_id');

let d = 0, e = 0, g = 0, h = 0;
try {
  db.exec('BEGIN');
  for (const p of stalePlan) { if (setStale.run(p).changes !== 1) throw new Error(`stale ${p.coach_id}`); d++; }
  for (const p of emailPlan) { if (setEmail.run(p).changes !== 1) throw new Error(`email ${p.coach_id}`); e++; }
  for (const p of curPlan) { if (setCurrent.run(p).changes !== 1) throw new Error(`current ${p.coach_id}`); g++; }
  for (const p of seenPlan) { if (setSeen.run(p).changes !== 1) throw new Error(`seen ${p.coach_id}`); h++; }
  db.exec('COMMIT');
  console.log(`\nAPPLIED in one transaction — stale ${d}, email ${e}, current ${g}, seen ${h}.`);
} catch (err) {
  try { db.exec('ROLLBACK'); } catch { /* */ }
  console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1);
}
db.close();
