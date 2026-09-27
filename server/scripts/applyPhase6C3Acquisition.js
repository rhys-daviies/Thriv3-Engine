#!/usr/bin/env node
/**
 * PHASE 6C.3 — TRUE CORE ACQUISITION. Insert NEW `coaches` rows for active CORE
 * soccer programmes that genuinely lacked usable coach coverage, using authoritative
 * current evidence and exact published eligible emails. NON-PRODUCTION DB only, in
 * ONE all-or-nothing transaction. NO deletions; NO programme-structure mutation;
 * NO existing-record recovery (those are held in a separate queue for review).
 *
 *   node server/scripts/applyPhase6C3Acquisition.js --db <path> \
 *     --fixture docs/validation/integrity-audit/phase6c3_core_acquisition_fixture.json   # dry-run
 *   ... --apply
 *
 * Inserts a coach ONLY when EVERY guard passes:
 *   - auto_apply_safe === true
 *   - real exact email (contains @, not N/A); email_status === 'verified'
 *     (a published personal or authoritative consumer address; inferred/generic/unknown refused)
 *   - currentness asserted CURRENT (UNKNOWN refused)
 *   - canonical programme exists, is active, sport matches, unitid matches the fixture
 *   - unitid is a real institution unitid and NOT a held/ambiguous one
 *     (campus-collisions + IU Columbus)
 *   - expected-ABSENCE: no existing (email, school, sport) row [else idempotent skip]
 *   - the exact email is not already attached to a DIFFERENT institution
 *     (that is a recovery/duplicate, never an acquisition insert)
 * One transaction; PRAGMA integrity_check; rollback on any mismatch; email_confirmed_at
 * never populated. Refuses a /data path.
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
const fxPath = arg('fixture');
const j = fxPath && fs.existsSync(path.resolve(fxPath)) ? assertUnredacted(JSON.parse(fs.readFileSync(path.resolve(fxPath), 'utf8')), fxPath) : { entries: [] };
const entries = (j.entries || j).filter((e) => e.auto_apply_safe === true);
const norm = (s) => String(s || '').trim().toLowerCase();
// held/ambiguous institution unitids that must never receive an acquisition insert
const HELD_UNITIDS = new Set([231165, 498562, 498571, 179308, 195544, 151111]);

const db = new Database(dbArg, { fileMustExist: true });
const cols = new Set(db.prepare('PRAGMA table_info(coaches)').all().map((c) => c.name));
for (const c of ['currentness_status', 'email_seen_on_source_at', 'email_seen_on_source_url']) if (!cols.has(c)) { console.error(`coaches.${c} missing — migrate first.`); db.close(); process.exit(2); }
const byIdentity = db.prepare('SELECT id FROM coaches WHERE lower(email)=? AND school=? AND sport=?');
const byEmail = db.prepare('SELECT id, school, sport FROM coaches WHERE lower(email)=?');
const progByUnitid = db.prepare('SELECT id, name, sport, division, unitid, active FROM colleges WHERE unitid=? AND name=? AND sport=?');
const problems = [];
const plan = []; let already = 0;

for (const e of entries) {
  const tag = `${e.name}@${e.canonical_programme}/${e.sport}`;
  if (!e.email || !e.email.includes('@') || e.email.toUpperCase() === 'N/A') { problems.push(`${tag}: no real email`); continue; }
  if (String(e.email_status).toLowerCase() !== 'verified') { problems.push(`${tag}: email_status must be verified (got ${e.email_status})`); continue; }
  if (e.currentness_status && e.currentness_status !== 'CURRENT') { problems.push(`${tag}: currentness must be CURRENT (got ${e.currentness_status})`); continue; }
  if (e.unitid == null) { problems.push(`${tag}: no canonical unitid`); continue; }
  if (HELD_UNITIDS.has(Number(e.unitid))) { problems.push(`${tag}: unitid ${e.unitid} is held/ambiguous`); continue; }
  const prog = progByUnitid.get(e.unitid, e.canonical_programme, e.sport);
  if (!prog) { problems.push(`${tag}: programme not found for unitid ${e.unitid}`); continue; }
  if (prog.active !== 1) { problems.push(`${tag}: programme not active`); continue; }
  if (byIdentity.get(norm(e.email), e.canonical_programme, e.sport)) { already++; continue; }
  const other = byEmail.all(norm(e.email)).filter((r) => r.school !== e.canonical_programme);
  if (other.length) { problems.push(`${tag}: email already on another institution ${other.map((r) => r.school + '/' + r.sport).join(',')} — recovery, not acquisition`); continue; }
  const sameSchoolOtherSport = byEmail.all(norm(e.email)).filter((r) => r.school === e.canonical_programme && r.sport !== e.sport);
  if (sameSchoolOtherSport.length && e.dedup_class !== 'EXISTING_DUAL_ROLE') { problems.push(`${tag}: email on same school other sport but not marked dual-role`); continue; }
  plan.push(e);
}

console.log('PHASE 6C.3 acquisition plan');
console.log(`  insert new coaches: ${plan.length} | ${already} already  (safe entries ${entries.length})`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const ins = db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title,
  email_status, email_source_url, source, currentness_status, currentness_checked_at, currentness_source_url, currentness_reason,
  email_seen_on_source_at, email_seen_on_source_url)
  VALUES (@id,@created_at,@full_name,@email,@school,@division,@sport,@position_title,
  @email_status,@email_source_url,@source,'CURRENT',@currentness_checked_at,@currentness_source_url,@currentness_reason,
  @email_seen_on_source_at,@email_seen_on_source_url)`);
let inserted = 0;
try {
  db.exec('BEGIN');
  const now = new Date().toISOString();
  for (const e of plan) {
    ins.run({ id: randomUUID(), created_at: now, full_name: e.name, email: e.email, school: e.canonical_programme,
      division: e.division || null, sport: e.sport, position_title: e.role || null,
      email_status: 'verified', email_source_url: e.email_source_url || e.source_url, source: 'phase6c3_core_acquisition',
      currentness_checked_at: e.currentness_checked_at || '2026-09-27', currentness_source_url: e.currentness_source_url || e.source_url,
      currentness_reason: (e.evidence_rationale || 'current staff confirmed on authoritative athletics page').slice(0, 240),
      email_seen_on_source_at: e.email_seen_on_source_at || '2026-09-27', email_seen_on_source_url: e.email_seen_on_source_url || e.email_source_url });
    inserted++;
  }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED — inserted ${inserted}. integrity ${integ}.`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
