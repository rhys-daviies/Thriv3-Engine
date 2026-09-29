#!/usr/bin/env node
/**
 * PHASE 7D — athletics-entity identity model + proven structural repairs. NON-PRODUCTION only.
 *
 * One all-or-nothing transaction, dry-run unless --apply, bound to an exact --fixture-hash:
 *   1. schema: `athletics_entities` (DDL read from server/db/schema.sql — one source) and the two
 *      additive `athletics_entity_id` columns (server/db/migrate.js#ensureAthleticsEntityColumns);
 *   2. entities: inserted after every one passes server/lib/athleticsEntity.js#entityProblems
 *      (six-digit federal UNITIDs only, campuses need a parent + label, no synthetic ids);
 *   3. assignments: colleges.athletics_entity_id for EVERY row, expected-old guarded;
 *   4. structural repairs, each expected-old guarded (federal-UNITID correction, alias/domain
 *      UNITID correction, stale-row deactivation);
 *   5. domain ownership: entity-owned hosts (never a shared-platform root);
 *   6. postcondition: the permanent validator reports zero hard violations.
 * colleges.unitid is never rewritten except by an explicit, proven CORRECT_FEDERAL_UNITID repair.
 * Writes a reversal manifest; --revert <manifest> undoes the data changes (the additive schema stays).
 *
 *   node server/scripts/applyPhase7DIdentityModel.js --db <path> --fixture <f> --fixture-hash <h> [--apply] [--manifest-out <f>]
 *   node server/scripts/applyPhase7DIdentityModel.js --db <path> --revert <manifest> [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';
import { entityProblems } from '../lib/athleticsEntity.js';
import { ensureAthleticsEntityColumns } from '../db/migrate.js';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
const fail = (m) => { console.error(m); process.exit(2); };
const SHARED_ROOT = /(^|\.)(prestosports\.com|sidearmsports\.com|wixsite\.com|squarespace\.com|weebly\.com|godaddysites\.com)$/i;
const VM = 'PHASE7D_ENTITY_ADJUDICATED';
if (!dbArg) fail('Give --db.');
if (/^\/data\//.test(path.resolve(dbArg))) fail('Refusing production /data path.');

export function entitySchemaDdl() {
  const sql = fs.readFileSync(path.resolve(__dirname, '../db/schema.sql'), 'utf8');
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS athletics_entities');
  const endMarker = 'CREATE INDEX IF NOT EXISTS idx_athletics_entities_parent ON athletics_entities(parent_unitid);';
  const end = sql.indexOf(endMarker);
  if (start < 0 || end < 0) throw new Error('athletics_entities DDL not found in schema.sql');
  return sql.slice(start, end + endMarker.length);
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const bt = (r) => `[7D] ${r}`.slice(0, 480);

const db = new Database(dbArg, { fileMustExist: true });
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

// ---------------------------------------------------------------- revert
const revertArg = arg('revert');
if (revertArg) {
  const man = JSON.parse(fs.readFileSync(path.resolve(revertArg), 'utf8'));
  console.log(`PHASE 7D revert plan: ${man.ops.length} recorded operations`);
  if (!apply) { console.log('DRY RUN — re-run with --apply to revert.'); db.close(); process.exit(0); }
  try {
    db.exec('BEGIN');
    for (const o of [...man.ops].reverse()) {
      if (o.kind === 'domain_insert') db.prepare('DELETE FROM athletics_domains WHERE lower(domain)=?').run(o.domain);
      else if (o.kind === 'domain_update') db.prepare('UPDATE athletics_domains SET status=@status, unitid=@unitid, athletics_entity_id=@athletics_entity_id, verification_method=@verification_method, confidence=@confidence, checked_at=@checked_at, notes=@notes WHERE lower(domain)=@domain').run({ ...o.old, domain: o.domain });
      else if (o.kind === 'college_update') { const cols = Object.keys(o.old); db.prepare(`UPDATE colleges SET ${cols.map((c) => `${c}=@${c}`).join(', ')} WHERE id=@__id`).run({ ...o.old, __id: o.college_id }); }
      else if (o.kind === 'alias_update') db.prepare('UPDATE institution_aliases SET unitid=@unitid WHERE alias_key=@alias_key AND unitid=@now').run({ unitid: o.old.unitid, alias_key: o.alias_key, now: o.new.unitid });
      else if (o.kind === 'assign') db.prepare('UPDATE colleges SET athletics_entity_id=@old WHERE id=@id').run({ old: o.old, id: o.college_id });
      else if (o.kind === 'entity_insert') db.prepare('DELETE FROM athletics_entities WHERE athletics_entity_id=?').run(o.athletics_entity_id);
    }
    const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw new Error('integrity ' + integ);
    db.exec('COMMIT'); console.log(`REVERTED ${man.ops.length} operations. integrity ${integ}.`);
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('ROLLED BACK:', e.message); db.close(); process.exit(1); }
  db.close(); process.exit(0);
}

// ---------------------------------------------------------------- apply
const fixtureArg = arg('fixture'); const hashArg = arg('fixture-hash');
if (!fixtureArg || !hashArg) fail('Give --fixture and --fixture-hash.');
const fx = JSON.parse(fs.readFileSync(path.resolve(fixtureArg), 'utf8'));
assertUnredacted(fx, fixtureArg);
const computed = crypto.createHash('sha256').update(JSON.stringify({ entities: fx.entities, assignments: fx.assignments, repairs: fx.repairs, domain_ownership: fx.domain_ownership })).digest('hex');
if (computed !== hashArg) fail(`Fixture hash mismatch.\n  expected ${hashArg}\n  computed ${computed}`);

const problems = [];
for (const e of fx.entities) for (const p of entityProblems(e)) problems.push(`ENTITY ${e.athletics_entity_id}: ${p}`);
for (const d of fx.domain_ownership) if (SHARED_ROOT.test(d.domain)) problems.push(`DOMAIN ${d.domain}: shared-platform root refused`);
const entityIds = new Set(fx.entities.map((e) => e.athletics_entity_id));
for (const a of fx.assignments) if (!entityIds.has(a.athletics_entity_id)) problems.push(`ASSIGN ${a.college_id}: unknown entity ${a.athletics_entity_id}`);

// read-only precondition pass (schema may not exist yet)
const collCols = new Set(db.prepare('PRAGMA table_info(colleges)').all().map((c) => c.name));
const domCols = new Set(hasTable('athletics_domains') ? db.prepare('PRAGMA table_info(athletics_domains)').all().map((c) => c.name) : []);
const getCollege = db.prepare('SELECT * FROM colleges WHERE id=?');
let assignPlan = 0, assignNoop = 0;
for (const a of fx.assignments) {
  const row = getCollege.get(a.college_id);
  if (!row) { problems.push(`ASSIGN ${a.college_id}: college ABSENT`); continue; }
  const cur = collCols.has('athletics_entity_id') ? row.athletics_entity_id : null;
  if (cur === a.athletics_entity_id) { assignNoop++; continue; }
  if (!same(cur, a.expected_old)) { problems.push(`ASSIGN ${a.college_id}: expected-old ${a.expected_old} != have ${cur}`); continue; }
  assignPlan++;
}
const repairPlan = []; let repairNoop = 0;
for (const r of fx.repairs) {
  const tag = `REPAIR ${r.op}`;
  if (r.op === 'CORRECT_FEDERAL_UNITID') {
    const row = getCollege.get(r.college_id);
    if (!row) { problems.push(`${tag}: ABSENT`); continue; }
    if (row.unitid === r.set.unitid && Object.keys(r.set).every((k) => same(row[k], r.set[k]))) { repairNoop++; continue; }
    if (row.name !== r.expected.name || row.sport !== r.expected.sport || row.unitid !== r.expected.unitid) { problems.push(`${tag}: expected-old row mismatch`); continue; }
    for (const [k, v] of Object.entries(r.expected_old_fields || {})) if (!same(row[k], v)) problems.push(`${tag}: expected-old ${k} mismatch`);
    repairPlan.push(r);
  } else if (r.op === 'CORRECT_ALIAS_UNITID') {
    const row = db.prepare('SELECT alias_key, unitid FROM institution_aliases WHERE alias_key=?').all(r.alias_key);
    if (row.length !== 1) { problems.push(`${tag}: alias ${r.alias_key} rows=${row.length}`); continue; }
    if (row[0].unitid === r.set.unitid) { repairNoop++; continue; }
    if (row[0].unitid !== r.expected.unitid) { problems.push(`${tag}: expected-old unitid mismatch`); continue; }
    repairPlan.push(r);
  } else if (r.op === 'CORRECT_DOMAIN_UNITID') {
    const row = db.prepare('SELECT * FROM athletics_domains WHERE lower(domain)=?').get(r.domain);
    if (!row) { problems.push(`${tag}: ${r.domain} ABSENT`); continue; }
    if (row.unitid === r.set.unitid) { repairNoop++; continue; }
    if (row.unitid !== r.expected.unitid || row.status !== r.expected.status) { problems.push(`${tag}: ${r.domain} expected-old mismatch`); continue; }
    repairPlan.push(r);
  } else if (r.op === 'DEACTIVATE_STALE_ROW') {
    const row = getCollege.get(r.college_id);
    if (!row) { problems.push(`${tag}: ABSENT`); continue; }
    if (row.active === 0) { repairNoop++; continue; }
    const n = db.prepare('SELECT COUNT(*) c FROM coaches WHERE school=? AND sport=?').get(row.name, row.sport).c;
    if (row.name !== r.expected.name || row.division !== r.expected.division || row.active !== r.expected.active || n !== r.expected.coach_rows) { problems.push(`${tag}: expected-old mismatch (coaches=${n})`); continue; }
    repairPlan.push(r);
  } else problems.push(`${tag}: unknown op`);
}
const domPlan = []; let domNoop = 0;
for (const d of fx.domain_ownership) {
  const row = hasTable('athletics_domains') ? db.prepare('SELECT * FROM athletics_domains WHERE lower(domain)=?').get(d.domain) : null;
  const curEnt = row && domCols.has('athletics_entity_id') ? row.athletics_entity_id : null;
  if (row && curEnt === d.set.athletics_entity_id && row.status === d.set.status) { domNoop++; continue; }
  if (d.op === 'INSERT') { if (row) { problems.push(`DOMAIN ${d.domain}: expected ABSENT`); continue; } }
  else if (!row || row.status !== d.expected.status || !same(row.unitid, d.expected.unitid)) { problems.push(`DOMAIN ${d.domain}: expected-old mismatch`); continue; }
  if (!entityIds.has(d.set.athletics_entity_id)) { problems.push(`DOMAIN ${d.domain}: unknown entity`); continue; }
  domPlan.push({ d, row });
}

console.log('PHASE 7D identity-model plan');
console.log(`  fixture_hash ok ${computed.slice(0, 12)}… | entities ${fx.entities.length} | assign ${assignPlan} (+${assignNoop} noop) | repairs ${repairPlan.length} (+${repairNoop} noop) | domains ${domPlan.length} (+${domNoop} noop)`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const ops = [];
const now = new Date().toISOString();
try {
  db.exec('BEGIN');
  db.exec(entitySchemaDdl());
  ensureAthleticsEntityColumns(db);
  const insEnt = db.prepare('INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, parent_unitid, campus_label, entity_kind, provenance, notes, created_at) VALUES (@athletics_entity_id,@display_name,@federal_unitid,@parent_unitid,@campus_label,@entity_kind,@provenance,@notes,@created_at)');
  const getEnt = db.prepare('SELECT * FROM athletics_entities WHERE athletics_entity_id=?');
  for (const e of fx.entities) {
    const ex = getEnt.get(e.athletics_entity_id);
    if (ex) { if (!['federal_unitid', 'parent_unitid', 'entity_kind'].every((k) => same(ex[k], e[k]))) throw new Error(`entity ${e.athletics_entity_id} exists with different identity`); continue; }
    insEnt.run(e); ops.push({ kind: 'entity_insert', athletics_entity_id: e.athletics_entity_id });
  }
  const upA = db.prepare('UPDATE colleges SET athletics_entity_id=@e WHERE id=@id AND athletics_entity_id IS @old');
  for (const a of fx.assignments) {
    const cur = getCollege.get(a.college_id).athletics_entity_id;
    if (cur === a.athletics_entity_id) continue;
    if (upA.run({ e: a.athletics_entity_id, id: a.college_id, old: a.expected_old }).changes !== 1) throw new Error(`assign ${a.college_id}`);
    ops.push({ kind: 'assign', college_id: a.college_id, old: a.expected_old, new: a.athletics_entity_id });
  }
  for (const r of repairPlan) {
    if (r.op === 'CORRECT_FEDERAL_UNITID' || r.op === 'DEACTIVATE_STALE_ROW') {
      const row = getCollege.get(r.college_id);
      const set = { ...r.set }; if (r.op === 'DEACTIVATE_STALE_ROW' || r.op === 'CORRECT_FEDERAL_UNITID') set.identity_notes = `${row.identity_notes ? row.identity_notes + ' | ' : ''}${bt(r.provenance)}`;
      const old = Object.fromEntries(Object.keys(set).map((k) => [k, row[k]]));
      const cols = Object.keys(set);
      if (db.prepare(`UPDATE colleges SET ${cols.map((c) => `${c}=@${c}`).join(', ')} WHERE id=@__id`).run({ ...set, __id: r.college_id }).changes !== 1) throw new Error(`${r.op} ${r.college_id}`);
      ops.push({ kind: 'college_update', op: r.op, college_id: r.college_id, old, new: set });
    } else if (r.op === 'CORRECT_ALIAS_UNITID') {
      if (db.prepare('UPDATE institution_aliases SET unitid=@n WHERE alias_key=@k AND unitid=@o').run({ n: r.set.unitid, k: r.alias_key, o: r.expected.unitid }).changes !== 1) throw new Error(`alias ${r.alias_key}`);
      ops.push({ kind: 'alias_update', alias_key: r.alias_key, old: { unitid: r.expected.unitid }, new: { unitid: r.set.unitid } });
    } else if (r.op === 'CORRECT_DOMAIN_UNITID') {
      const row = db.prepare('SELECT * FROM athletics_domains WHERE lower(domain)=?').get(r.domain);
      const old = { status: row.status, unitid: row.unitid, athletics_entity_id: row.athletics_entity_id ?? null, verification_method: row.verification_method, confidence: row.confidence, checked_at: row.checked_at, notes: row.notes };
      db.prepare('UPDATE athletics_domains SET unitid=@u, verification_method=@vm, checked_at=@t, notes=@n WHERE lower(domain)=@d').run({ u: r.set.unitid, vm: VM, t: now, n: bt(r.provenance), d: r.domain });
      ops.push({ kind: 'domain_update', domain: r.domain, old, new: { unitid: r.set.unitid } });
    }
  }
  for (const { d, row } of domPlan) {
    if (d.op === 'INSERT') {
      db.prepare('INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at, notes, athletics_entity_id) VALUES (@domain,@unitid,@status,@role,@ck,@cu,@vm,@conf,@t,@n,@e)')
        .run({ domain: d.domain, unitid: d.set.unitid, status: d.set.status, role: d.set.role || null, ck: JSON.stringify(d.set.claimed_keys || []), cu: JSON.stringify(d.set.claimed_unitids || []), vm: VM, conf: 'HIGH', t: now, n: bt(d.provenance), e: d.set.athletics_entity_id });
      ops.push({ kind: 'domain_insert', domain: d.domain });
    } else {
      const old = { status: row.status, unitid: row.unitid, athletics_entity_id: row.athletics_entity_id ?? null, verification_method: row.verification_method, confidence: row.confidence, checked_at: row.checked_at, notes: row.notes };
      db.prepare('UPDATE athletics_domains SET status=@s, unitid=@u, athletics_entity_id=@e, verification_method=@vm, confidence=@c, checked_at=@t, notes=@n WHERE lower(domain)=@d').run({ s: d.set.status, u: d.set.unitid, e: d.set.athletics_entity_id, vm: VM, c: 'HIGH', t: now, n: bt(d.provenance), d: d.domain });
      ops.push({ kind: 'domain_update', domain: d.domain, old, new: d.set });
    }
  }
  const v = validateEntityIdentity(db, { allowlist: fx.duplicate_programme_allowlist, knownWrongUnitid: fx.entities.filter((e) => /KNOWN_WRONG_UNITID/.test(e.notes || '')).map((e) => e.athletics_entity_id) });
  if (v.hard.length) throw new Error(`validator hard violations:\n  ${v.hard.slice(0, 20).join('\n  ')}`);
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  const manOut = arg('manifest-out');
  if (manOut) fs.writeFileSync(path.resolve(manOut), JSON.stringify({ phase: '7D', applied_at: now, fixture_hash: computed, ops }, null, 2));
  console.log(`\nAPPLIED — entities +${ops.filter((o) => o.kind === 'entity_insert').length}, assignments ${ops.filter((o) => o.kind === 'assign').length}, college repairs ${ops.filter((o) => o.kind === 'college_update').length}, alias ${ops.filter((o) => o.kind === 'alias_update').length}, domains ${ops.filter((o) => o.kind.startsWith('domain')).length}. validator hard 0 (documented ${v.documented.length}). integrity ${integ}.${manOut ? ` manifest ${manOut}` : ''}`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
