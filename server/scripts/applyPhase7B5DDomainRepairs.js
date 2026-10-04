#!/usr/bin/env node
/**
 * PHASE 7B.5D — adjudicated Tier-2 collision/hold DOMAIN repair applier. Same guard model as 7B.5B,
 * but for domains that were individually adjudicated in 7B.5D (the 7B.5B applier deliberately refuses
 * these as HELD; here each entry must carry a proven one-to-one adjudication to be eligible).
 *
 * Guards (all-or-nothing transaction):
 *   - refuses a production /data path and production-volume fixtures;
 *   - requires --apply and an exact --fixture-hash;
 *   - REFUSES shared-platform roots (prestosports.com, sidearmsports.com, *.wixsite.com, …) — a shared
 *     root is never mapped to one UNITID;
 *   - requires collision_class ∈ {ONE_TO_ONE_CORRECTION_PROVEN, DISTINCT_DOMAINS_RESOLVED};
 *   - expected-old status guard + expected-old UNITID guard;
 *   - one-to-one ownership guard: never overwrites a domain currently mapped to a DIFFERENT unitid;
 *   - INSERT populates every NOT NULL column; schema not weakened;
 *   - new_status ∈ {VERIFIED, VERIFIED_ALIAS}; ownership recorded as adjudicated (not self-id);
 *   - idempotent NOOP; integrity_check; post-commit postcondition verification.
 *
 *   node server/scripts/applyPhase7B5DDomainRepairs.js --db <path> --fixture <path> --fixture-hash <h> [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db'); const fixtureArg = arg('fixture'); const hashArg = arg('fixture-hash');
const VERIFICATION_METHOD = 'PHASE7B5D_ADJUDICATED_ONE_TO_ONE';
const CONFIDENCE = 'HIGH';
const MAX_REPAIRS = 60;
const ALLOWED_STATUS = new Set(['VERIFIED', 'VERIFIED_ALIAS']);
const ALLOWED_CLASS = new Set(['ONE_TO_ONE_CORRECTION_PROVEN', 'DISTINCT_DOMAINS_RESOLVED']);
const SHARED_ROOT = /(^|\.)(prestosports\.com|sidearmsports\.com|wixsite\.com|squarespace\.com|weebly\.com|godaddysites\.com)$/i;
const norm = (s) => String(s || '').trim().toLowerCase();
const fail = (m) => { console.error(m); process.exit(2); };

if (!dbArg) fail('Give --db.');
if (!fixtureArg) fail('Give --fixture.');
if (!hashArg) fail('Give --fixture-hash.');
if (/^\/data\//.test(path.resolve(dbArg))) fail('Refusing production /data path.');
if (!fs.existsSync(path.resolve(fixtureArg))) fail(`Fixture not found: ${fixtureArg}`);
const raw = JSON.parse(fs.readFileSync(path.resolve(fixtureArg), 'utf8'));
assertUnredacted(raw, fixtureArg);
const entries = raw.entries || raw;
if (!Array.isArray(entries)) fail('Fixture has no entries[].');
if (entries.length > MAX_REPAIRS) fail(`Refusing production volume: ${entries.length} > ${MAX_REPAIRS}.`);
const computedHash = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
if (computedHash !== hashArg) fail(`Fixture hash mismatch.\n  expected ${hashArg}\n  computed ${computedHash}`);

const db = new Database(dbArg, { fileMustExist: true });
const getDomain = db.prepare('SELECT domain, unitid, status FROM athletics_domains WHERE lower(domain)=?');
const updatePlan = []; const insertPlan = []; let noop = 0; const problems = [];
for (const e of entries) {
  const tag = `REPAIR ${e.domain}`;
  const dom = norm(e.domain);
  if (!dom) { problems.push(`${tag}: missing domain`); continue; }
  if (SHARED_ROOT.test(dom)) { problems.push(`${tag}: shared-platform root refused (never mapped to one UNITID)`); continue; }
  if (!ALLOWED_CLASS.has(e.collision_class)) { problems.push(`${tag}: collision_class ${e.collision_class} not a proven one-to-one`); continue; }
  if (e.unitid == null) { problems.push(`${tag}: unitid required`); continue; }
  if (!ALLOWED_STATUS.has(e.new_status)) { problems.push(`${tag}: new_status must be VERIFIED/VERIFIED_ALIAS`); continue; }
  if (!e.evidence_url) { problems.push(`${tag}: requires evidence_url`); continue; }
  const existing = getDomain.get(dom);
  const haveStatus = existing ? existing.status : 'ABSENT';
  if (existing && existing.unitid != null && Number(existing.unitid) !== Number(e.unitid)) { problems.push(`${tag}: already maps to unitid ${existing.unitid} != ${e.unitid} (one-to-one guard)`); continue; }
  if (existing && existing.status === e.new_status && Number(existing.unitid) === Number(e.unitid)) { noop++; continue; }
  const expOldStatus = e.expected_old_status ?? null;
  if (expOldStatus != null && haveStatus !== expOldStatus) { problems.push(`${tag}: expected-old status ${expOldStatus} != have ${haveStatus}`); continue; }
  if (e.op === 'INSERT' || expOldStatus === 'ABSENT') {
    if (existing) { problems.push(`${tag}: expected ABSENT but row exists (${haveStatus})`); continue; }
    if (!Array.isArray(e.claimed_keys) || !e.claimed_keys.length) { problems.push(`${tag}: INSERT requires claimed_keys`); continue; }
    if (!Array.isArray(e.claimed_unitids) || !e.claimed_unitids.length) { problems.push(`${tag}: INSERT requires claimed_unitids`); continue; }
    insertPlan.push(e);
  } else {
    const expOldUnitid = e.expected_old_unitid ?? null;
    const haveU = existing ? existing.unitid : null;
    const okU = expOldUnitid == null ? haveU == null : Number(haveU) === Number(expOldUnitid);
    if (!okU) { problems.push(`${tag}: expected-old unitid ${expOldUnitid} != have ${haveU}`); continue; }
    updatePlan.push({ e, existing });
  }
}

console.log('PHASE 7B.5D — adjudicated domain-repair plan');
console.log(`  fixture_hash ok: ${computedHash.slice(0, 12)}… | entries ${entries.length} | UPDATE ${updatePlan.length} | INSERT ${insertPlan.length} | NOOP ${noop} | REJECT ${problems.length}`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const bt = (r) => `[7B.5D] ${r}`.slice(0, 240);
const now = new Date().toISOString();
const updStmt = db.prepare('UPDATE athletics_domains SET unitid=@unitid, status=@status, verification_method=@vm, confidence=@conf, checked_at=@checked_at, notes=@notes WHERE lower(domain)=@domain');
const insStmt = db.prepare('INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at, notes) VALUES (@domain,@unitid,@status,@role,@claimed_keys,@claimed_unitids,@vm,@conf,@checked_at,@notes)');
let nUpd = 0, nIns = 0;
try {
  db.exec('BEGIN');
  for (const { e } of updatePlan) { const c = updStmt.run({ domain: norm(e.domain), unitid: e.unitid, status: e.new_status, vm: VERIFICATION_METHOD, conf: CONFIDENCE, checked_at: now, notes: bt(`${e.collision_class}: ${e.reason || 'adjudicated one-to-one'}`) }); if (c.changes !== 1) throw new Error(`update changed ${c.changes} for ${e.domain}`); nUpd++; }
  for (const e of insertPlan) { insStmt.run({ domain: norm(e.domain), unitid: e.unitid, status: e.new_status, role: e.role || null, claimed_keys: JSON.stringify(e.claimed_keys), claimed_unitids: JSON.stringify(e.claimed_unitids), vm: VERIFICATION_METHOD, conf: CONFIDENCE, checked_at: now, notes: bt(`${e.collision_class}: ${e.reason || 'adjudicated one-to-one'}`) }); nIns++; }
  for (const e of entries) { if (SHARED_ROOT.test(norm(e.domain)) || !ALLOWED_CLASS.has(e.collision_class)) continue; const r = getDomain.get(norm(e.domain)); if (!r || r.status !== e.new_status || Number(r.unitid) !== Number(e.unitid)) throw new Error(`postcondition failed for ${e.domain}`); }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED — UPDATE ${nUpd}, INSERT ${nIns}, NOOP ${noop}, REJECT 0. integrity ${integ}.`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
