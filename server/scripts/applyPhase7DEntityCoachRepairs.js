#!/usr/bin/env node
/**
 * PHASE 7D — entity-aware coach evidence applier (NON-PRODUCTION only). Runs AFTER
 * applyPhase7DIdentityModel.js. Same guard model as the 7B.5C/7C appliers with one new rule:
 *
 *   EVIDENCE MUST COME FROM THE COACH'S OWN ATHLETICS ENTITY. The host of the page the
 *   address was seen on must resolve (host-level row first, then registrable domain) to the
 *   same athletics entity as the coach's programme. A parent-institution page (park.edu for
 *   Park University Gilbert) or a sibling campus's site can never prove a branch coach.
 *
 * Ops (one fixture, each entry auto_apply_safe:true):
 *   REASSIGN  never-correct filing -> the programme the evidence host belongs to (expected-old school)
 *   EVIDENCE  existing coach, email UNCHANGED (expected-old guard), re-observed on the live official
 *             page: currentness CURRENT + currentness source + email_seen. Never upgrades an
 *             inferred/generic address; email_confirmed_at is never touched.
 * One transaction; reassign first, then evidence; integrity_check; --manifest-out for revert.
 *
 *   node server/scripts/applyPhase7DEntityCoachRepairs.js --db <path> --fixture <f> [--apply] [--manifest-out <f>]
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';
import { buildEntityIndex, hostOf } from '../lib/athleticsEntity.js';
import { registrableDomain } from '../lib/institutionResolver.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db'); const fxArg = arg('fixture');
const fail = (m) => { console.error(m); process.exit(2); };
if (!dbArg || !fxArg) fail('Give --db and --fixture.');
if (/^\/data\//.test(path.resolve(dbArg))) fail('Refusing production /data path.');
const norm = (s) => String(s || '').trim().toLowerCase();
const isGeneric = (e) => /^(soccer|msoc|wsoc|athletics|info|sports?info|sid|coach|wsoccer|msoccer|office|admin|menssoccer|womenssoccer)@/i.test(String(e || ''));
const fx = JSON.parse(fs.readFileSync(path.resolve(fxArg), 'utf8'));
assertUnredacted(fx, fxArg);
const entries = (fx.entries || []).filter((e) => e.auto_apply_safe === true);

const db = new Database(dbArg, { fileMustExist: true });
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='athletics_entities'").get()) fail('athletics_entities absent — run applyPhase7DIdentityModel.js first.');
const colleges = db.prepare('SELECT id, name, sport, division, unitid, active, athletics_entity_id FROM colleges').all();
const domains = db.prepare('SELECT domain, unitid, status, athletics_entity_id FROM athletics_domains').all();
const entities = db.prepare('SELECT * FROM athletics_entities').all();
const eidx = buildEntityIndex({ entities, colleges, domains });
const domByName = new Map(domains.map((d) => [String(d.domain).toLowerCase(), d]));
const byNS = new Map(colleges.map((c) => [`${c.name}|${c.sport}`, c]));
const trusted = (d) => d && ['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status);
/** athletics entity a page URL belongs to: entity-owned host first, then the registrable domain. */
function entityOfUrl(url) {
  const h = hostOf(url); if (!h) return null;
  const he = eidx.entityForHost(h); if (he) return he;
  const d = domByName.get(registrableDomain(url));
  if (!trusted(d)) return null;
  return d.athletics_entity_id || eidx.entityForUnitid(d.unitid);
}
const getCoach = db.prepare('SELECT * FROM coaches WHERE id=?');
const problems = []; const reassignPlan = []; const evPlan = []; let noop = 0;
for (const e of entries) {
  const tag = `${e.op} ${String(e.coach_id).slice(0, 8)}`;
  const row = getCoach.get(e.coach_id);
  if (!row) { problems.push(`${tag}: ABSENT`); continue; }
  const school = e.op === 'REASSIGN' ? e.new_school : (e.expected_school ?? row.school);
  if (e.op === 'REASSIGN') {
    if (row.school === e.new_school) { noop++; continue; }
    if (row.school !== e.expected_old_school) { problems.push(`${tag}: expected-old school mismatch`); continue; }
    const prog = byNS.get(`${e.new_school}|${row.sport}`);
    if (!prog || prog.active !== 1) { problems.push(`${tag}: target programme not active`); continue; }
    if (!e.evidence_url || entityOfUrl(e.evidence_url) !== prog.athletics_entity_id) { problems.push(`${tag}: evidence host is not the target programme's athletics entity`); continue; }
    reassignPlan.push({ e, row });
    continue;
  }
  if (e.op !== 'EVIDENCE') { problems.push(`${tag}: unknown op`); continue; }
  if (norm(row.email) !== norm(e.expected_old_email)) { problems.push(`${tag}: expected-old email mismatch`); continue; }
  if (row.email_status !== 'verified') { problems.push(`${tag}: stored email is ${row.email_status}, not verified — EVIDENCE never upgrades an address`); continue; }
  if (isGeneric(row.email)) { problems.push(`${tag}: generic address`); continue; }
  if (!/^https:\/\//.test(e.email_seen_on_source_url || '') || !/^https:\/\//.test(e.currentness_source_url || '')) { problems.push(`${tag}: requires https currentness + email_seen URLs`); continue; }
  const prog = byNS.get(`${school}|${row.sport}`);
  if (!prog || prog.active !== 1 || !prog.athletics_entity_id) { problems.push(`${tag}: programme ${school} not active/entity-less`); continue; }
  for (const u of [e.email_seen_on_source_url, e.currentness_source_url, e.email_source_url].filter(Boolean)) {
    const ent = entityOfUrl(u);
    if (ent !== prog.athletics_entity_id) problems.push(`${tag}: ${hostOf(u)} belongs to ${ent || 'no entity'}, not ${prog.athletics_entity_id}`);
  }
  if (row.currentness_status === 'CURRENT' && row.email_seen_on_source_url === e.email_seen_on_source_url && row.currentness_source_url === e.currentness_source_url) { noop++; continue; }
  evPlan.push({ e, row });
}
console.log('PHASE 7D entity coach plan');
console.log(`  reassign ${reassignPlan.length} | evidence ${evPlan.length} | noop ${noop}`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }
const ops = []; const bt = (r) => `[7D] ${r}`.slice(0, 240);
try {
  db.exec('BEGIN');
  for (const { e, row } of reassignPlan) {
    if (db.prepare('UPDATE coaches SET school=@s, currentness_reason=@r WHERE id=@id AND school=@old').run({ s: e.new_school, r: bt(e.evidence_rationale || 'never-correct filing reassigned to the evidence entity'), id: row.id, old: e.expected_old_school }).changes !== 1) throw new Error(`reassign ${row.id}`);
    ops.push({ kind: 'reassign', coach_id: row.id, old: { school: row.school, currentness_reason: row.currentness_reason } });
  }
  const up = db.prepare(`UPDATE coaches SET currentness_status='CURRENT', currentness_checked_at=@t, currentness_source_url=@cs, currentness_reason=@r,
    email_seen_on_source_at=@sa, email_seen_on_source_url=@su, email_source_url=COALESCE(@es, email_source_url) WHERE id=@id AND lower(email)=@em`);
  for (const { e, row } of evPlan) {
    const old = Object.fromEntries(['currentness_status', 'currentness_checked_at', 'currentness_source_url', 'currentness_reason', 'email_seen_on_source_at', 'email_seen_on_source_url', 'email_source_url'].map((k) => [k, row[k]]));
    if (up.run({ t: e.checked_at, cs: e.currentness_source_url, r: bt(e.evidence_rationale || 'current staff + exact address re-observed on the entity’s official page'), sa: e.checked_at, su: e.email_seen_on_source_url, es: e.email_source_url || null, id: row.id, em: norm(row.email) }).changes !== 1) throw new Error(`evidence ${row.id}`);
    ops.push({ kind: 'evidence', coach_id: row.id, old });
  }
  const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  const mo = arg('manifest-out'); if (mo) fs.writeFileSync(path.resolve(mo), JSON.stringify({ phase: '7D-coach', ops }, null, 2));
  console.log(`\nAPPLIED — reassign ${reassignPlan.length}, evidence ${evPlan.length}. integrity ${integ}.`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
