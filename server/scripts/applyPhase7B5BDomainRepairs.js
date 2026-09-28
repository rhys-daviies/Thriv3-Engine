#!/usr/bin/env node
/**
 * PHASE 7B.5B — NAIA Tier-2 SAFE DOMAIN REPAIR applier.
 *
 * Applies ONLY the 62 independently-verified one-to-one athletics-domain repairs frozen in 7B.5A
 * (61 AUTO_SAFE_CORRECTION + 1 SAFE_ALIAS_ADDITION) to a NON-PRODUCTION DB, in ONE all-or-nothing
 * transaction. This is a DOMAIN-REPAIR-ONLY phase: it never touches coaches / evidence / currentness
 * / email_seen, never changes STRICT_CORROB_SCOPE, and never alters NCAA/NJCAA/USCAA semantics.
 * Eligibility is left to derive naturally from the live strict path (and 7B.5A proved a domain repair
 * alone unlocks nothing, because the Tier-2 coaches still lack fresh evidence).
 *
 * Guards (all-or-nothing; any failure aborts and rolls back):
 *   - refuses a production /data/ path and refuses production-volume fixtures (> MAX_REPAIRS);
 *   - requires --apply (dry-run otherwise) and an exact --fixture-hash match (fixture identity);
 *   - refuses any HELD domain (collision / shared / no-repair) even if present in the fixture;
 *   - expected-old status guard, expected-old unitid guard;
 *   - one-to-one ownership guard: never overwrites a domain already mapped to a DIFFERENT unitid;
 *   - INSERT populates every NOT NULL column (status, claimed_keys, claimed_unitids,
 *     verification_method, confidence, checked_at) — schema constraints are NOT weakened;
 *   - new_status restricted to VERIFIED / VERIFIED_ALIAS; ownership is recorded as independent
 *     one-to-one verification, NOT page self-identification;
 *   - idempotent: a repair already at its target (status,unitid) is a NOOP;
 *   - PRAGMA integrity_check + post-commit postcondition verification of every repair.
 *
 *   node server/scripts/applyPhase7B5BDomainRepairs.js --db <path> --fixture <path> \
 *     --fixture-hash <sha256> [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
const fixtureArg = arg('fixture');
const hashArg = arg('fixture-hash');
const SOURCE = 'phase7b5b_naia_tier2_domain_repair';
const VERIFICATION_METHOD = 'PHASE7B5A_INDEPENDENT_ONE_TO_ONE';
const CONFIDENCE = 'HIGH';
const MAX_REPAIRS = 100; // production-volume guard: the frozen set is 62
const ALLOWED_STATUS = new Set(['VERIFIED', 'VERIFIED_ALIAS']);
// Domains 7B.5A explicitly HELD (collision / shared-platform / no-repair). Never repaired here even
// if they somehow appear in a fixture. Belt-and-braces beyond the fixture's own exclusion.
const HELD_DOMAINS = new Set([
  'johnsonroyals.com', 'sfuathletics.com', 'iuccrimsonpride.com', 'prestosports.com',
  'lsugoldeneagles.com', 'lsuagenerals.com', 'gounionbulldogs.com', 'parkathletics.com',
]);

const norm = (s) => String(s || '').trim().toLowerCase();
function fail(msg) { console.error(msg); process.exit(2); }

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

// fixture identity: sha256 over the canonical entries array (same payload the builder hashed)
const computedHash = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
if (computedHash !== hashArg) fail(`Fixture hash mismatch.\n  expected ${hashArg}\n  computed ${computedHash}`);

const db = new Database(dbArg, { fileMustExist: true });
const getDomain = db.prepare('SELECT domain, unitid, status, claimed_keys, claimed_unitids, verification_method, confidence, role FROM athletics_domains WHERE lower(domain)=?');

const updatePlan = []; const insertPlan = []; let noop = 0; const problems = [];
for (const e of entries) {
  const tag = `REPAIR ${e.domain}`;
  const dom = norm(e.domain);
  if (!dom) { problems.push(`${tag}: missing domain`); continue; }
  if (HELD_DOMAINS.has(dom)) { problems.push(`${tag}: HELD domain (collision/shared/no-repair) refused`); continue; }
  if (e.unitid == null) { problems.push(`${tag}: unitid required`); continue; }
  if (!ALLOWED_STATUS.has(e.new_status)) { problems.push(`${tag}: new_status must be VERIFIED/VERIFIED_ALIAS`); continue; }

  const existing = getDomain.get(dom);
  const haveStatus = existing ? existing.status : 'ABSENT';

  // one-to-one ownership guard: never overwrite a domain already mapped to a DIFFERENT unitid
  if (existing && existing.unitid != null && Number(existing.unitid) !== Number(e.unitid)) {
    problems.push(`${tag}: already maps to unitid ${existing.unitid} != ${e.unitid} (one-to-one guard)`); continue;
  }
  // idempotence: already at the target state
  if (existing && existing.status === e.new_status && Number(existing.unitid) === Number(e.unitid)) { noop++; continue; }

  // expected-old status guard
  const expOldStatus = e.expected_old_status ?? null;
  if (expOldStatus != null && haveStatus !== expOldStatus) { problems.push(`${tag}: expected-old status ${expOldStatus} != have ${haveStatus}`); continue; }
  // expected-old unitid guard (null means "was unmapped"; ABSENT rows are inserts)
  if (e.op !== 'INSERT' && expOldStatus !== 'ABSENT') {
    const expOldUnitid = e.expected_old_unitid ?? null;
    const haveUnitid = existing ? existing.unitid : null;
    const okUnitid = expOldUnitid == null ? haveUnitid == null : Number(haveUnitid) === Number(expOldUnitid);
    if (!okUnitid) { problems.push(`${tag}: expected-old unitid ${expOldUnitid} != have ${haveUnitid}`); continue; }
  }

  if (expOldStatus === 'ABSENT' || e.op === 'INSERT') {
    if (existing) { problems.push(`${tag}: expected ABSENT but row exists (status ${haveStatus})`); continue; }
    if (!Array.isArray(e.claimed_keys) || e.claimed_keys.length === 0) { problems.push(`${tag}: INSERT requires claimed_keys`); continue; }
    if (!Array.isArray(e.claimed_unitids) || e.claimed_unitids.length === 0) { problems.push(`${tag}: INSERT requires claimed_unitids`); continue; }
    insertPlan.push(e);
  } else {
    updatePlan.push({ e, existing });
  }
}

console.log('PHASE 7B.5B — safe domain-repair plan');
console.log(`  fixture_hash ok: ${computedHash.slice(0, 12)}… | entries ${entries.length} | UPDATE ${updatePlan.length} | INSERT ${insertPlan.length} | NOOP ${noop} | REJECT ${problems.length}`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const bt = (r) => `[7B.5B] ${r}`.slice(0, 240);
const now = new Date().toISOString();
const updStmt = db.prepare(`UPDATE athletics_domains
  SET unitid=@unitid, status=@status, verification_method=@vm, confidence=@conf, checked_at=@checked_at, notes=@notes
  WHERE lower(domain)=@domain`);
const insStmt = db.prepare(`INSERT INTO athletics_domains
  (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at, notes)
  VALUES (@domain,@unitid,@status,@role,@claimed_keys,@claimed_unitids,@vm,@conf,@checked_at,@notes)`);

let nUpd = 0, nIns = 0;
try {
  db.exec('BEGIN');
  for (const { e } of updatePlan) {
    const c = updStmt.run({ domain: norm(e.domain), unitid: e.unitid, status: e.new_status, vm: VERIFICATION_METHOD, conf: CONFIDENCE, checked_at: now, notes: bt(e.reason || 'domain repair (one-to-one proven)') });
    if (c.changes !== 1) throw new Error(`update changed ${c.changes} rows for ${e.domain}`);
    nUpd++;
  }
  for (const e of insertPlan) {
    insStmt.run({ domain: norm(e.domain), unitid: e.unitid, status: e.new_status, role: e.role || null, claimed_keys: JSON.stringify(e.claimed_keys), claimed_unitids: JSON.stringify(e.claimed_unitids), vm: VERIFICATION_METHOD, conf: CONFIDENCE, checked_at: now, notes: bt(e.reason || 'domain repair (one-to-one proven)') });
    nIns++;
  }
  // postcondition: every planned repair now at its target (status, unitid)
  for (const e of entries) {
    if (HELD_DOMAINS.has(norm(e.domain))) continue;
    const r = getDomain.get(norm(e.domain));
    if (!r || r.status !== e.new_status || Number(r.unitid) !== Number(e.unitid)) {
      throw new Error(`postcondition failed for ${e.domain}: have ${r ? r.status + '/' + r.unitid : 'ABSENT'}`);
    }
  }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED — UPDATE ${nUpd}, INSERT ${nIns}, NOOP ${noop}, REJECT 0. integrity ${integ}. source=${SOURCE}`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
