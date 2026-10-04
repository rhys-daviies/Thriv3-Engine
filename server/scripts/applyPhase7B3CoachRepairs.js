#!/usr/bin/env node
/**
 * PHASE 7B.3 — TIER-1 NAIA authoritative revalidation rollout: apply ONLY factual
 * data repairs, on a NON-PRODUCTION DB, in ONE all-or-nothing transaction. Identical
 * guard model to the 7B.1 pilot applier (which it deliberately mirrors), differing only
 * in the provenance `source` tag ('phase7b3_naia_tier1') and the `--batch` label recorded
 * in currentness_reason. Does NOT modify the global eligibility (G6) rule and does NOT
 * fabricate coach_seasons rows. Eligibility, if any, derives naturally from the live pipeline.
 *
 *   node server/scripts/applyPhase7B3CoachRepairs.js --db <path> --batch A \
 *     --current  <INSERT fixture>  --email <UPDATE_EMAIL fixture> \
 *     --stale    <MARK_STALE fixture> --evidence <ADD_EVIDENCE fixture>   # dry-run; add --apply
 *
 * Fixtures are the RAW (unredacted) copies in server/data/generated/audit-fixtures/.
 * assertUnredacted refuses a redacted published copy at the door. Ops:
 *   INSERT       new current coach (real published personal email, email_status=verified,
 *                canonical active programme, email_seen + currentness evidence)
 *   UPDATE_EMAIL correct an existing coach's email (expected-old email must match; requires
 *                email_source_url + email_seen_on_source_url; refreshes currentness)
 *   MARK_STALE   proven-departed/wrong-sport/wrong-institution -> currentness='PROVEN_STALE'
 *   ADD_EVIDENCE existing current coach -> populate email_seen + currentness=CURRENT (no email change)
 * Guards: /data refusal; assertUnredacted; email_status must be 'verified'; real email;
 * canonical active unitid not held; duplicate-person/email prevention; expected-old-value;
 * one txn; integrity check; rollback; idempotent. email_confirmed_at NEVER touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
const batch = arg('batch') || '?';
const SOURCE = 'phase7b3_naia_tier1';
if (!dbArg) { console.error('Give --db.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing /data.'); process.exit(2); }
const HELD_UNITIDS = new Set([231165, 498562, 498571, 179308, 195544, 151111]);
const norm = (s) => String(s || '').trim().toLowerCase();
const realEmail = (e) => !!(e && e.includes('@') && e.toUpperCase() !== 'N/A' && !e.includes('@redacted.invalid'));
const readFx = (n) => { const p = arg(n); if (!p || !fs.existsSync(path.resolve(p))) return []; const j = assertUnredacted(JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')), p); return (j.entries || j).filter((e) => e.auto_apply_safe === true); };

const current = readFx('current'); const emailFx = readFx('email'); const stale = readFx('stale'); const evidence = readFx('evidence');
const db = new Database(dbArg, { fileMustExist: true });
const cols = new Set(db.prepare('PRAGMA table_info(coaches)').all().map((c) => c.name));
for (const c of ['currentness_status', 'email_seen_on_source_at', 'email_seen_on_source_url']) if (!cols.has(c)) { console.error(`coaches.${c} missing — migrate first.`); db.close(); process.exit(2); }
const byIdentity = db.prepare('SELECT id FROM coaches WHERE lower(email)=? AND school=? AND sport=?');
const byEmail = db.prepare('SELECT id, school, sport FROM coaches WHERE lower(email)=?');
const progActive = db.prepare('SELECT unitid, active FROM colleges WHERE name=? AND sport=?');
const getCoach = db.prepare('SELECT id, full_name, email, school, sport, currentness_status FROM coaches WHERE id=?');
const problems = [];
const insPlan = []; let insAlready = 0;
const emailPlan = []; let emailAlready = 0;
const stalePlan = []; let staleAlready = 0;
const evPlan = []; let evAlready = 0;

for (const e of current) {
  const tag = `INSERT ${e.name}@${e.canonical_programme}/${e.sport}`;
  if (!realEmail(e.email)) { problems.push(`${tag}: no real email`); continue; }
  if (norm(e.email_status) !== 'verified') { problems.push(`${tag}: email_status must be verified`); continue; }
  if (!e.email_seen_on_source_url) { problems.push(`${tag}: missing email_seen_on_source_url`); continue; }
  if (e.unitid == null || HELD_UNITIDS.has(Number(e.unitid))) { problems.push(`${tag}: bad/held unitid`); continue; }
  const prog = progActive.get(e.canonical_programme, e.sport);
  if (!prog || prog.active !== 1 || Number(prog.unitid) !== Number(e.unitid)) { problems.push(`${tag}: programme not active/unitid mismatch`); continue; }
  if (byIdentity.get(norm(e.email), e.canonical_programme, e.sport)) { insAlready++; continue; }
  const other = byEmail.all(norm(e.email)).filter((r) => r.school !== e.canonical_programme);
  if (other.length) { problems.push(`${tag}: email on another institution ${other.map((r) => r.school).join(',')}`); continue; }
  const sameOtherSport = byEmail.all(norm(e.email)).filter((r) => r.school === e.canonical_programme && r.sport !== e.sport);
  if (sameOtherSport.length && e.dedup_class !== 'EXISTING_DUAL_ROLE') { problems.push(`${tag}: same-school other-sport not marked dual-role`); continue; }
  insPlan.push(e);
}
for (const e of emailFx) {
  const tag = `EMAIL ${e.coach_id}`;
  const row = getCoach.get(e.coach_id);
  if (!row) { problems.push(`${tag}: ABSENT`); continue; }
  if (!realEmail(e.new_email)) { problems.push(`${tag}: new email not real`); continue; }
  if (!e.email_source_url || !e.email_seen_on_source_url) { problems.push(`${tag}: requires source + email_seen evidence`); continue; }
  if (norm(row.email) === norm(e.new_email)) { emailAlready++; continue; }
  if (e.expected_old_email != null && norm(row.email) !== norm(e.expected_old_email)) { problems.push(`${tag}: expected-old email mismatch`); continue; }
  const collide = byEmail.all(norm(e.new_email)).filter((r) => r.id !== e.coach_id && r.school === row.school && r.sport === row.sport);
  if (collide.length) { problems.push(`${tag}: new email collides at same programme`); continue; }
  emailPlan.push({ e, row });
}
for (const e of stale) {
  const tag = `STALE ${e.coach_id}`;
  const row = getCoach.get(e.coach_id);
  if (!row) { problems.push(`${tag}: ABSENT`); continue; }
  if (e.expected_old_school != null && row.school !== e.expected_old_school) { problems.push(`${tag}: expected-old school mismatch`); continue; }
  if (row.currentness_status === 'PROVEN_STALE') { staleAlready++; continue; }
  stalePlan.push({ e, row });
}
for (const e of evidence) {
  const tag = `EVIDENCE ${e.coach_id}`;
  const row = getCoach.get(e.coach_id);
  if (!row) { problems.push(`${tag}: ABSENT`); continue; }
  if (!e.email_seen_on_source_url) { problems.push(`${tag}: requires email_seen_on_source_url`); continue; }
  if (e.expected_old_email != null && norm(row.email) !== norm(e.expected_old_email)) { problems.push(`${tag}: expected-old email mismatch`); continue; }
  evPlan.push({ e, row });
}

console.log(`PHASE 7B.3 coach-repair plan (batch ${batch})`);
console.log(`  inserts: ${insPlan.length} (+${insAlready} already) | email: ${emailPlan.length} (+${emailAlready}) | stale: ${stalePlan.length} (+${staleAlready}) | evidence: ${evPlan.length}`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const ins = db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title,
  email_status, email_source_url, source, currentness_status, currentness_checked_at, currentness_source_url, currentness_reason,
  email_seen_on_source_at, email_seen_on_source_url)
  VALUES (@id,@created_at,@full_name,@email,@school,@division,@sport,@position_title,'verified',@email_source_url,@source,
  'CURRENT',@checked_at,@currentness_source_url,@reason,@seen_at,@seen_url)`);
const updEmail = db.prepare(`UPDATE coaches SET email=@email, email_source_url=@src, currentness_status='CURRENT', currentness_checked_at=@checked_at,
  currentness_source_url=@csrc, currentness_reason=@reason, email_seen_on_source_at=@seen_at, email_seen_on_source_url=@seen_url WHERE id=@id AND lower(email)=@expold`);
const markStale = db.prepare(`UPDATE coaches SET currentness_status='PROVEN_STALE', currentness_checked_at=@checked_at, currentness_source_url=@csrc, currentness_reason=@reason WHERE id=@id`);
const addEv = db.prepare(`UPDATE coaches SET currentness_status='CURRENT', currentness_checked_at=@checked_at, currentness_source_url=@csrc, currentness_reason=@reason, email_seen_on_source_at=@seen_at, email_seen_on_source_url=@seen_url WHERE id=@id`);
let nIns = 0, nEmail = 0, nStale = 0, nEv = 0;
const bt = (r) => `[7B.3/${batch}] ${r}`.slice(0, 240);
try {
  db.exec('BEGIN');
  const now = new Date().toISOString();
  for (const e of insPlan) { ins.run({ id: randomUUID(), created_at: now, full_name: e.name, email: e.email, school: e.canonical_programme, division: e.division || 'NAIA', sport: e.sport, position_title: e.role || null, source: SOURCE, email_source_url: e.email_source_url || e.source_url, checked_at: e.currentness_checked_at || '2026-09-28', currentness_source_url: e.currentness_source_url || e.source_url, reason: bt(e.evidence_rationale || 'current staff confirmed on authoritative page'), seen_at: e.email_seen_on_source_at || '2026-09-28', seen_url: e.email_seen_on_source_url }); nIns++; }
  for (const { e, row } of emailPlan) { if (updEmail.run({ id: e.coach_id, email: e.new_email, src: e.email_source_url, checked_at: e.currentness_checked_at || '2026-09-28', csrc: e.currentness_source_url || e.email_source_url, reason: bt(e.evidence_rationale || 'authoritative email correction'), seen_at: e.email_seen_on_source_at || '2026-09-28', seen_url: e.email_seen_on_source_url, expold: norm(row.email) }).changes !== 1) throw new Error(`email ${e.coach_id}`); nEmail++; }
  for (const { e } of stalePlan) { markStale.run({ id: e.coach_id, checked_at: e.currentness_checked_at || '2026-09-28', csrc: e.currentness_source_url || null, reason: bt(e.evidence_rationale || 'coach proven departed') }); nStale++; }
  for (const { e } of evPlan) { addEv.run({ id: e.coach_id, checked_at: e.currentness_checked_at || '2026-09-28', csrc: e.currentness_source_url || e.email_seen_on_source_url, reason: bt(e.evidence_rationale || 'current staff + email observed on authoritative page'), seen_at: e.email_seen_on_source_at || '2026-09-28', seen_url: e.email_seen_on_source_url }); nEv++; }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED (batch ${batch}) — inserts ${nIns}, email ${nEmail}, stale ${nStale}, evidence ${nEv}. integrity ${integ}.`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
