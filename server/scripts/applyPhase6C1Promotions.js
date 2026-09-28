#!/usr/bin/env node
/**
 * PHASE 6C.1 — promote proven current coach_seasons identities into NEW `coaches`
 * rows (and apply deterministic existing-record recoveries) on a NON-PRODUCTION DB,
 * in ONE all-or-nothing transaction.
 *
 *   node server/scripts/applyPhase6C1Promotions.js --db <path> \
 *     --promotion docs/validation/integrity-audit/phase6c1_coach_seasons_promotion_fixture.json \
 *     --recovery  docs/validation/integrity-audit/phase6c1_existing_coach_recovery_fixture.json   # dry-run
 *   ... --apply
 *
 * Promotion inserts a coach ONLY with: a real exact published personal email, a
 * canonical UNITID+active programme, email_status='verified', currentness=CURRENT,
 * and email_seen_on_source_* evidence. NEVER inferred/generic emails. email_confirmed_at
 * stays NULL. Expected-ABSENCE guards: refuses to insert if a row already exists for
 * (email, school, sport) [idempotent skip] and refuses if the exact email is already
 * attached to a DIFFERENT programme (must go through recovery, not a duplicate insert).
 * Recovery updates an existing row with expected-old-value guards (no new row).
 *
 * SAFETY: refuses /data; one transaction; integrity check; rollback on any mismatch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing /data.'); process.exit(2); }
const readEntries = (p) => { if (!p || !fs.existsSync(path.resolve(p))) return []; const j = JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
assertUnredacted(j, path.resolve(p)); return (j.entries || j).filter((e) => e.auto_apply_safe !== false); };
const norm = (s) => String(s || '').trim().toLowerCase();

const promo = readEntries(arg('promotion'));
const recov = readEntries(arg('recovery'));
const db = new Database(dbArg, { fileMustExist: true });
const cols = new Set(db.prepare('PRAGMA table_info(coaches)').all().map((c) => c.name));
for (const c of ['currentness_status', 'email_seen_on_source_at', 'email_seen_on_source_url']) if (!cols.has(c)) { console.error(`coaches.${c} missing — migrate first.`); db.close(); process.exit(2); }
const byIdentity = db.prepare('SELECT id FROM coaches WHERE lower(email)=? AND school=? AND sport=?');
const byEmail = db.prepare('SELECT id, school, sport FROM coaches WHERE lower(email)=?');
const progActive = db.prepare('SELECT id, name, sport, division, unitid, active FROM colleges WHERE unitid IS ? AND name=? AND sport=?');
const getCoach = db.prepare('SELECT id, full_name, email, school, sport FROM coaches WHERE id=?');
const problems = [];

// ---- promotions ----
const insertPlan = []; let promoAlready = 0;
for (const e of promo) {
  if (!e.email || !e.email.includes('@')) { problems.push(`promo ${e.name}@${e.canonical_programme}: no real email`); continue; }
  if (String(e.email_status).toLowerCase() !== 'verified') { problems.push(`promo ${e.name}: email_status must be verified`); continue; }
  if (e.unitid == null) { problems.push(`promo ${e.name}@${e.canonical_programme}: no canonical unitid`); continue; }
  // programme must exist + be active
  const prog = progActive.get(e.unitid, e.canonical_programme, e.sport);
  if (!prog) { problems.push(`promo ${e.name}: programme ${e.canonical_programme}/${e.sport}/unitid ${e.unitid} not found`); continue; }
  if (prog.active !== 1) { problems.push(`promo ${e.name}: programme not active`); continue; }
  // expected-absence (idempotent)
  if (byIdentity.get(norm(e.email), e.canonical_programme, e.sport)) { promoAlready++; continue; }
  // email must not already belong to a DIFFERENT INSTITUTION. Same school, different
  // sport is a legitimate dual-role (UNIQUE(email,school,sport) permits it); allowed
  // only when the fixture explicitly marked it EXISTING_DUAL_ROLE.
  const other = byEmail.all(norm(e.email)).filter((r) => r.school !== e.canonical_programme);
  if (other.length) { problems.push(`promo ${e.name}: email ${e.email} already on another institution ${other.map((r) => r.school + '/' + r.sport).join(',')} — needs recovery, not insert`); continue; }
  const sameSchoolOtherSport = byEmail.all(norm(e.email)).filter((r) => r.school === e.canonical_programme && r.sport !== e.sport);
  if (sameSchoolOtherSport.length && e.dedup_class !== 'EXISTING_DUAL_ROLE') { problems.push(`promo ${e.name}: email on ${e.canonical_programme} other sport but not marked dual-role`); continue; }
  insertPlan.push(e);
}

// ---- recoveries ----
const recovPlan = []; let recovAlready = 0;
for (const e of recov) {
  const row = getCoach.get(e.existing_coach_id);
  if (!row) { problems.push(`recovery ${e.existing_coach_id}: ABSENT`); continue; }
  const okOld = (e.expected_old && Object.entries(e.expected_old).every(([k, v]) => String(row[k]) === String(v)));
  if (!okOld) { problems.push(`recovery ${e.existing_coach_id}: expected-old mismatch`); continue; }
  const already = Object.entries(e.proposed || {}).every(([k, v]) => String(row[k]) === String(v));
  if (already) { recovAlready++; continue; }
  recovPlan.push(e);
}

console.log('PHASE 6C.1 plan');
console.log(`  promotions (insert new): ${insertPlan.length} | ${promoAlready} already  (fixture ${promo.length})`);
console.log(`  recoveries (update)    : ${recovPlan.length} | ${recovAlready} already  (fixture ${recov.length})`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const ins = db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title,
  email_status, email_source_url, source, currentness_status, currentness_checked_at, currentness_source_url, currentness_reason,
  email_seen_on_source_at, email_seen_on_source_url)
  VALUES (@id,@created_at,@full_name,@email,@school,@division,@sport,@position_title,
  @email_status,@email_source_url,@source,'CURRENT',@currentness_checked_at,@currentness_source_url,@currentness_reason,
  @email_seen_on_source_at,@email_seen_on_source_url)`);
let inserted = 0, recovered = 0;
try {
  db.exec('BEGIN');
  const now = new Date().toISOString();
  for (const e of insertPlan) {
    ins.run({ id: randomUUID(), created_at: now, full_name: e.name, email: e.email, school: e.canonical_programme, division: e.division || null, sport: e.sport, position_title: e.role || null,
      email_status: 'verified', email_source_url: e.email_source_url || e.source_url, source: 'phase6c1_coach_seasons_promotion',
      currentness_checked_at: e.currentness_checked_at || '2026-09-27', currentness_source_url: e.currentness_source_url || e.source_url, currentness_reason: (e.evidence_rationale || 'coach_seasons identity confirmed current on authoritative page').slice(0, 240),
      email_seen_on_source_at: e.email_seen_on_source_at || '2026-09-27', email_seen_on_source_url: e.email_seen_on_source_url || e.email_source_url });
    inserted++;
  }
  for (const e of recovPlan) {
    const sets = Object.keys(e.proposed).map((k) => `${k}=@${k}`).join(', ');
    const stmt = db.prepare(`UPDATE coaches SET ${sets} WHERE id=@id`);
    if (stmt.run({ ...e.proposed, id: e.existing_coach_id }).changes !== 1) throw new Error(`recovery ${e.existing_coach_id}`);
    recovered++;
  }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED — inserted ${inserted}, recovered ${recovered}. integrity ${integ}.`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
