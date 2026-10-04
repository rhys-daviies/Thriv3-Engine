#!/usr/bin/env node
/**
 * PHASE 7C — NAIA tail fresh-evidence recovery applier (reuses the 7B.5C guard model). Applies ONLY independently-observed
 * authoritative coach repairs on a NON-PRODUCTION DB in ONE all-or-nothing transaction. Same guard
 * model as the 7B.3/7B.4A appliers. This phase does NOT mutate athletics_domains at all (no
 * DOMAIN_REPAIR op exists here — domain ownership was frozen by 7B.5B).
 *
 * Ops (each from its own fixture; every entry must carry auto_apply_safe:true and pass its guards):
 *   INSERT_CURRENT  (--current)  current staff member absent from coaches; email_seen + CURRENT required
 *   CORRECT_EMAIL   (--email)    same current person, exact current published email differs (-> verified)
 *   MARK_STALE      (--stale)    proven departed / wrong-sport / wrong-association row
 *   ADD_EVIDENCE    (--evidence) existing current-correct coach gains CURRENT + email_seen evidence
 *   CORRECT_NAME    (--name)     same-person identity correction (expected-old-name guard)
 *   REASSIGN        (--reassign) independently-proven never-correct filing -> correct school/sport
 *
 * Optional --targets <file> restricts every INSERT/edit to the frozen unitid|sport set (outside-target
 * guard). email_confirmed_at is NEVER touched. Does not change STRICT_CORROB_SCOPE.
 *
 *   node server/scripts/applyPhase7B5CCoachRepairs.js --db <path> [--current f] [--email f]
 *     [--stale f] [--evidence f] [--name f] [--reassign f] [--targets f]   # dry-run; add --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
const SOURCE = 'phase7c_naia_tail';
if (!dbArg) { console.error('Give --db.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing /data.'); process.exit(2); }
const norm = (s) => String(s || '').trim().toLowerCase();
const realEmail = (e) => !!(e && e.includes('@') && e.toUpperCase() !== 'N/A' && !e.includes('@redacted.invalid'));
const isGeneric = (e) => /^(soccer|msoc|wsoc|athletics|info|sports?info|sid|coach|wsoccer|msoccer|office|admin)@/i.test(String(e || ''));
const readFx = (n) => { const p = arg(n); if (!p || !fs.existsSync(path.resolve(p))) return []; const j = assertUnredacted(JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')), p); return (j.entries || j).filter((e) => e.auto_apply_safe === true); };

// optional outside-target guard
let TARGETS = null;
{ const p = arg('targets'); if (p && fs.existsSync(path.resolve(p))) { const j = JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')); TARGETS = new Set((j.keys || j).map((k) => String(k))); } }

const current = readFx('current'); const emailFx = readFx('email'); const stale = readFx('stale'); const evidence = readFx('evidence'); const nameFx = readFx('name'); const reassign = readFx('reassign');
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
const evPlan = []; const namePlan = []; const reassignPlan = [];
const inTarget = (unitid, sport) => !TARGETS || TARGETS.has(`${unitid}|${sport}`);

for (const e of current) {
  const tag = `INSERT ${e.canonical_programme}/${e.sport}`;
  if (!realEmail(e.email)) { problems.push(`${tag}: no real email`); continue; }
  if (isGeneric(e.email)) { problems.push(`${tag}: generic email not allowed`); continue; }
  if (norm(e.email_status) !== 'verified') { problems.push(`${tag}: email_status must be verified`); continue; }
  if (!e.email_seen_on_source_url) { problems.push(`${tag}: missing email_seen_on_source_url`); continue; }
  if (e.unitid == null) { problems.push(`${tag}: unitid required`); continue; }
  if (!inTarget(e.unitid, e.sport)) { problems.push(`${tag}: outside target set`); continue; }
  const prog = progActive.get(e.canonical_programme, e.sport);
  if (!prog || prog.active !== 1 || Number(prog.unitid) !== Number(e.unitid)) { problems.push(`${tag}: programme not active/unitid mismatch`); continue; }
  // source domain must be VERIFIED/VERIFIED_ALIAS to this unitid (strict corroboration precondition)
  const sd = e.email_source_domain ? getDomain.get(norm(e.email_source_domain)) : null;
  if (e.email_source_domain && (!sd || !['VERIFIED', 'VERIFIED_ALIAS'].includes(sd.status) || Number(sd.unitid) !== Number(e.unitid))) { problems.push(`${tag}: source domain ${e.email_source_domain} not verified to unitid`); continue; }
  if (byIdentity.get(norm(e.email), e.canonical_programme, e.sport)) { insAlready++; continue; }
  // Compare institutions by UNITID, not by school-name string (the same school can be spelled two
  // ways across its men's/women's rows, e.g. "William Penn" vs "William Penn University").
  const rowUnitid = (r) => progActive.get(r.school, r.sport)?.unitid;
  const rows = byEmail.all(norm(e.email));
  const otherInstitution = rows.filter((r) => { const u = rowUnitid(r); return u == null || Number(u) !== Number(e.unitid); });
  if (otherInstitution.length) { problems.push(`${tag}: email on another institution ${[...new Set(otherInstitution.map((r) => r.school))].join(',')}`); continue; }
  const sameInstOtherSport = rows.filter((r) => { const u = rowUnitid(r); return Number(u) === Number(e.unitid) && r.sport !== e.sport; });
  if (sameInstOtherSport.length && e.dedup_class !== 'EXISTING_DUAL_ROLE') { problems.push(`${tag}: same-institution other-sport not marked dual-role`); continue; }
  insPlan.push(e);
}
for (const e of emailFx) {
  const tag = `EMAIL ${e.coach_id}`;
  const row = getCoach.get(e.coach_id);
  if (!row) { problems.push(`${tag}: ABSENT`); continue; }
  if (!realEmail(e.new_email)) { problems.push(`${tag}: new email not real`); continue; }
  if (isGeneric(e.new_email)) { problems.push(`${tag}: generic email not allowed`); continue; }
  if (!e.email_source_url || !e.email_seen_on_source_url) { problems.push(`${tag}: requires source + email_seen evidence`); continue; }
  if (e.expected_old_email != null && norm(row.email) !== norm(e.expected_old_email)) { problems.push(`${tag}: expected-old email mismatch`); continue; }
  if (!inTarget(e.unitid, row.sport)) { problems.push(`${tag}: outside target set`); continue; }
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
  if (isGeneric(row.email)) { problems.push(`${tag}: existing email is generic`); continue; }
  if (e.expected_old_email != null && norm(row.email) !== norm(e.expected_old_email)) { problems.push(`${tag}: expected-old email mismatch`); continue; }
  if (!inTarget(e.unitid, row.sport)) { problems.push(`${tag}: outside target set`); continue; }
  // source domain must be VERIFIED/VERIFIED_ALIAS to this unitid
  const sd = e.email_source_domain ? getDomain.get(norm(e.email_source_domain)) : null;
  if (e.email_source_domain && (!sd || !['VERIFIED', 'VERIFIED_ALIAS'].includes(sd.status) || Number(sd.unitid) !== Number(e.unitid))) { problems.push(`${tag}: source domain not verified to unitid`); continue; }
  evPlan.push({ e, row });
}
for (const e of nameFx) {
  const tag = `NAME ${e.coach_id}`;
  const row = getCoach.get(e.coach_id);
  if (!row) { problems.push(`${tag}: ABSENT`); continue; }
  if (!e.new_name || !e.new_name.trim() || e.new_name.includes('withheld')) { problems.push(`${tag}: new_name invalid`); continue; }
  if (e.expected_old_name == null || norm(row.full_name) !== norm(e.expected_old_name)) { problems.push(`${tag}: expected-old name mismatch`); continue; }
  if (!e.evidence_url) { problems.push(`${tag}: requires evidence_url`); continue; }
  namePlan.push({ e, row });
}
for (const e of reassign) {
  const tag = `REASSIGN ${e.coach_id}`;
  const row = getCoach.get(e.coach_id);
  if (!row) { problems.push(`${tag}: ABSENT`); continue; }
  if (e.expected_old_school == null || row.school !== e.expected_old_school) { problems.push(`${tag}: expected-old school mismatch`); continue; }
  if (!e.new_school || !e.evidence_url) { problems.push(`${tag}: requires new_school + evidence_url`); continue; }
  reassignPlan.push({ e, row });
}

console.log('PHASE 7C fresh-evidence plan');
console.log(`  insert ${insPlan.length} (+${insAlready}) | email ${emailPlan.length} | stale ${stalePlan.length} (+${staleAlready}) | evidence ${evPlan.length} | name ${namePlan.length} | reassign ${reassignPlan.length}`);
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
const doReassign = db.prepare(`UPDATE coaches SET school=@new_school, sport=COALESCE(@new_sport, sport), currentness_reason=@reason WHERE id=@id AND school=@expold`);
let nIns = 0, nEmail = 0, nStale = 0, nEv = 0, nName = 0, nReassign = 0;
const bt = (r) => `[7C] ${r}`.slice(0, 240);
try {
  db.exec('BEGIN');
  const now = new Date().toISOString();
  for (const e of insPlan) { ins.run({ id: randomUUID(), created_at: now, full_name: e.name, email: e.email, school: e.canonical_programme, division: e.division || 'NAIA', sport: e.sport, position_title: e.role || null, source: SOURCE, email_source_url: e.email_source_url, checked_at: e.currentness_checked_at || '2026-09-28', currentness_source_url: e.currentness_source_url || e.email_source_url, reason: bt(e.evidence_rationale || 'current staff confirmed on authoritative page'), seen_at: e.email_seen_on_source_at || '2026-09-28', seen_url: e.email_seen_on_source_url }); nIns++; }
  for (const { e, row } of emailPlan) { if (updEmail.run({ id: e.coach_id, email: e.new_email, src: e.email_source_url, checked_at: e.currentness_checked_at || '2026-09-28', csrc: e.currentness_source_url || e.email_source_url, reason: bt(e.evidence_rationale || 'authoritative email correction (verified)'), seen_at: e.email_seen_on_source_at || '2026-09-28', seen_url: e.email_seen_on_source_url, expold: norm(row.email) }).changes !== 1) throw new Error(`email ${e.coach_id}`); nEmail++; }
  for (const { e } of stalePlan) { markStale.run({ id: e.coach_id, checked_at: e.currentness_checked_at || '2026-09-28', csrc: e.currentness_source_url || null, reason: bt(e.evidence_rationale || 'coach proven departed/wrong-sport/wrong-association') }); nStale++; }
  for (const { e } of evPlan) { addEv.run({ id: e.coach_id, checked_at: e.currentness_checked_at || '2026-09-28', csrc: e.currentness_source_url || e.email_seen_on_source_url, reason: bt(e.evidence_rationale || 'current staff + email observed on authoritative page'), seen_at: e.email_seen_on_source_at || '2026-09-28', seen_url: e.email_seen_on_source_url }); nEv++; }
  for (const { e, row } of namePlan) { if (updName.run({ id: e.coach_id, name: e.new_name, role: e.new_role || null, reason: bt(e.evidence_rationale || 'authoritative identity correction'), expold: norm(row.full_name) }).changes !== 1) throw new Error(`name ${e.coach_id}`); nName++; }
  for (const { e } of reassignPlan) { if (doReassign.run({ id: e.coach_id, new_school: e.new_school, new_sport: e.new_sport || null, reason: bt(e.evidence_rationale || 'never-correct filing reassigned'), expold: e.expected_old_school }).changes !== 1) throw new Error(`reassign ${e.coach_id}`); nReassign++; }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED — insert ${nIns}, email ${nEmail}, stale ${nStale}, evidence ${nEv}, name ${nName}, reassign ${nReassign}. integrity ${integ}. source=${SOURCE}`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
