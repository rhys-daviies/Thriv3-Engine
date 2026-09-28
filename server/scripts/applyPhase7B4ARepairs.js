#!/usr/bin/env node
/**
 * PHASE 7B.4A — TIER-1 NAIA exception closure: apply ONLY independently-proven factual
 * repairs on a NON-PRODUCTION DB, in ONE all-or-nothing transaction. Same guard model as the
 * 7B.1/7B.3 appliers, plus two new guarded ops the exception cases required:
 *   CORRECT_NAME   fix a stored full_name/role when authoritative evidence proves the row's
 *                  email belongs to a differently-named current person (expected-old-name guard).
 *   DOMAIN_REPAIR  register/alias an athletics domain to a UNITID with one-to-one proof
 *                  (expected-old status guard; never overwrites a different existing unitid).
 * CORRECT_EMAIL here also promotes a confirmed-published address to email_status='verified'
 * (only with email_source_url + email_seen evidence). Does NOT modify G6 or STRICT_CORROB_SCOPE;
 * eligibility derives naturally from the live strict path. email_confirmed_at NEVER touched.
 *
 *   node server/scripts/applyPhase7B4ARepairs.js --db <path> [--current f] [--email f]
 *     [--stale f] [--evidence f] [--name f] [--domain f]   # dry-run; add --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
const SOURCE = 'phase7b4a_naia_tier1_exception';
if (!dbArg) { console.error('Give --db.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing /data.'); process.exit(2); }
const HELD_UNITIDS = new Set([231165, 498562, 498571, 179308, 195544, 151111]);
const norm = (s) => String(s || '').trim().toLowerCase();
const realEmail = (e) => !!(e && e.includes('@') && e.toUpperCase() !== 'N/A' && !e.includes('@redacted.invalid'));
const readFx = (n) => { const p = arg(n); if (!p || !fs.existsSync(path.resolve(p))) return []; const j = assertUnredacted(JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')), p); return (j.entries || j).filter((e) => e.auto_apply_safe === true); };

const current = readFx('current'); const emailFx = readFx('email'); const stale = readFx('stale'); const evidence = readFx('evidence'); const nameFx = readFx('name'); const domainFx = readFx('domain');
const db = new Database(dbArg, { fileMustExist: true });
const cols = new Set(db.prepare('PRAGMA table_info(coaches)').all().map((c) => c.name));
for (const c of ['currentness_status', 'email_seen_on_source_at', 'email_seen_on_source_url']) if (!cols.has(c)) { console.error(`coaches.${c} missing.`); db.close(); process.exit(2); }
const byIdentity = db.prepare('SELECT id FROM coaches WHERE lower(email)=? AND school=? AND sport=?');
const byEmail = db.prepare('SELECT id, school, sport FROM coaches WHERE lower(email)=?');
const progActive = db.prepare('SELECT unitid, active FROM colleges WHERE name=? AND sport=?');
const getCoach = db.prepare('SELECT id, full_name, email, school, sport, currentness_status, position_title FROM coaches WHERE id=?');
const getDomain = db.prepare('SELECT domain, unitid, status FROM athletics_domains WHERE lower(domain)=?');
const problems = [];
const insPlan = []; let insAlready = 0;
const emailPlan = []; const stalePlan = []; let staleAlready = 0;
const evPlan = []; const namePlan = []; const domainPlan = [];

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
  if (e.expected_old_email != null && norm(row.email) !== norm(e.expected_old_email)) { problems.push(`${tag}: expected-old email mismatch (have ${row.email})`); continue; }
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
  if (e.expected_old_email != null && norm(row.email) !== norm(e.expected_old_email)) { problems.push(`${tag}: expected-old email mismatch (have ${row.email})`); continue; }
  evPlan.push({ e, row });
}
for (const e of nameFx) {
  const tag = `NAME ${e.coach_id}`;
  const row = getCoach.get(e.coach_id);
  if (!row) { problems.push(`${tag}: ABSENT`); continue; }
  if (!e.new_name || !e.new_name.trim() || e.new_name.includes('withheld')) { problems.push(`${tag}: new_name invalid`); continue; }
  if (e.expected_old_name == null || norm(row.full_name) !== norm(e.expected_old_name)) { problems.push(`${tag}: expected-old name mismatch (have ${row.full_name})`); continue; }
  if (!e.evidence_url) { problems.push(`${tag}: requires evidence_url`); continue; }
  namePlan.push({ e, row });
}
for (const e of domainFx) {
  const tag = `DOMAIN ${e.domain}`;
  if (!e.domain || e.unitid == null) { problems.push(`${tag}: domain+unitid required`); continue; }
  if (!e.evidence_url) { problems.push(`${tag}: requires evidence_url`); continue; }
  if (!['VERIFIED', 'VERIFIED_ALIAS'].includes(e.new_status)) { problems.push(`${tag}: new_status must be VERIFIED/VERIFIED_ALIAS`); continue; }
  const existing = getDomain.get(norm(e.domain));
  // never overwrite a mapping that already points at a DIFFERENT unitid
  if (existing && existing.unitid != null && Number(existing.unitid) !== Number(e.unitid)) { problems.push(`${tag}: already maps to unitid ${existing.unitid} (one-to-one guard)`); continue; }
  if (existing && existing.status === e.new_status && Number(existing.unitid) === Number(e.unitid)) { continue; /* already correct */ }
  if (e.expected_old_status != null) {
    const have = existing ? existing.status : 'ABSENT';
    if (have !== e.expected_old_status) { problems.push(`${tag}: expected-old status mismatch (have ${have})`); continue; }
  }
  domainPlan.push({ e, existing });
}

console.log('PHASE 7B.4A exception-closure plan');
console.log(`  inserts: ${insPlan.length} (+${insAlready}) | email: ${emailPlan.length} | stale: ${stalePlan.length} (+${staleAlready}) | evidence: ${evPlan.length} | name: ${namePlan.length} | domain: ${domainPlan.length}`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const ins = db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title,
  email_status, email_source_url, source, currentness_status, currentness_checked_at, currentness_source_url, currentness_reason,
  email_seen_on_source_at, email_seen_on_source_url)
  VALUES (@id,@created_at,@full_name,@email,@school,@division,@sport,@position_title,'verified',@email_source_url,@source,
  'CURRENT',@checked_at,@currentness_source_url,@reason,@seen_at,@seen_url)`);
const updEmail = db.prepare(`UPDATE coaches SET email=@email, email_status='verified', email_source_url=@src, currentness_status='CURRENT', currentness_checked_at=@checked_at,
  currentness_source_url=@csrc, currentness_reason=@reason, email_seen_on_source_at=@seen_at, email_seen_on_source_url=@seen_url WHERE id=@id AND lower(email)=@expold`);
const markStale = db.prepare(`UPDATE coaches SET currentness_status='PROVEN_STALE', currentness_checked_at=@checked_at, currentness_source_url=@csrc, currentness_reason=@reason WHERE id=@id`);
const addEv = db.prepare(`UPDATE coaches SET currentness_status='CURRENT', currentness_checked_at=@checked_at, currentness_source_url=@csrc, currentness_reason=@reason, email_seen_on_source_at=@seen_at, email_seen_on_source_url=@seen_url WHERE id=@id`);
const updName = db.prepare(`UPDATE coaches SET full_name=@name, position_title=COALESCE(@role, position_title), currentness_reason=@reason WHERE id=@id AND lower(full_name)=@expold`);
const upsDomainUpd = db.prepare(`UPDATE athletics_domains SET unitid=@unitid, status=@status, notes=@notes WHERE lower(domain)=@domain`);
const upsDomainIns = db.prepare(`INSERT INTO athletics_domains (domain, unitid, status, notes) VALUES (@domain,@unitid,@status,@notes)`);
let nIns = 0, nEmail = 0, nStale = 0, nEv = 0, nName = 0, nDomain = 0;
const bt = (r) => `[7B.4A] ${r}`.slice(0, 240);
try {
  db.exec('BEGIN');
  const now = new Date().toISOString();
  for (const e of insPlan) { ins.run({ id: randomUUID(), created_at: now, full_name: e.name, email: e.email, school: e.canonical_programme, division: e.division || 'NAIA', sport: e.sport, position_title: e.role || null, source: SOURCE, email_source_url: e.email_source_url || e.source_url, checked_at: e.currentness_checked_at || '2026-09-28', currentness_source_url: e.currentness_source_url || e.source_url, reason: bt(e.evidence_rationale || 'current staff confirmed on authoritative page'), seen_at: e.email_seen_on_source_at || '2026-09-28', seen_url: e.email_seen_on_source_url }); nIns++; }
  for (const { e, row } of emailPlan) { if (updEmail.run({ id: e.coach_id, email: e.new_email, src: e.email_source_url, checked_at: e.currentness_checked_at || '2026-09-28', csrc: e.currentness_source_url || e.email_source_url, reason: bt(e.evidence_rationale || 'authoritative email correction (promoted to verified)'), seen_at: e.email_seen_on_source_at || '2026-09-28', seen_url: e.email_seen_on_source_url, expold: norm(row.email) }).changes !== 1) throw new Error(`email ${e.coach_id}`); nEmail++; }
  for (const { e } of stalePlan) { markStale.run({ id: e.coach_id, checked_at: e.currentness_checked_at || '2026-09-28', csrc: e.currentness_source_url || null, reason: bt(e.evidence_rationale || 'coach proven departed/defunct programme') }); nStale++; }
  for (const { e } of evPlan) { addEv.run({ id: e.coach_id, checked_at: e.currentness_checked_at || '2026-09-28', csrc: e.currentness_source_url || e.email_seen_on_source_url, reason: bt(e.evidence_rationale || 'current staff + email observed on authoritative page'), seen_at: e.email_seen_on_source_at || '2026-09-28', seen_url: e.email_seen_on_source_url }); nEv++; }
  for (const { e, row } of namePlan) { if (updName.run({ id: e.coach_id, name: e.new_name, role: e.new_role || null, reason: bt(e.evidence_rationale || 'authoritative identity correction'), expold: norm(row.full_name) }).changes !== 1) throw new Error(`name ${e.coach_id}`); nName++; }
  for (const { e } of domainPlan) { const params = { domain: norm(e.domain), unitid: e.unitid, status: e.new_status, notes: bt(e.evidence_rationale || 'domain repair (one-to-one proven)') }; if (getDomain.get(norm(e.domain))) upsDomainUpd.run(params); else upsDomainIns.run(params); nDomain++; }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED — inserts ${nIns}, email ${nEmail}, stale ${nStale}, evidence ${nEv}, name ${nName}, domain ${nDomain}. integrity ${integ}.`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
