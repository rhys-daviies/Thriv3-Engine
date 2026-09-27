#!/usr/bin/env node
/**
 * PHASE 6C.4 — DOMAIN CORROBORATION CLOSURE. Correct proven `athletics_domains`
 * registry rows so authoritative coach evidence can corroborate naturally through the
 * REAL eligibility pipeline. NON-PRODUCTION DB only, ONE all-or-nothing transaction.
 *
 * Modifies ONLY athletics_domains rows. NEVER mutates coaches (institution/sport/name/
 * email) or colleges (programme structure). Eligibility is NOT set here — it must derive
 * naturally from corrected evidence when reconcileCoaches re-runs.
 *
 *   node server/scripts/applyPhase6C4DomainRepairs.js --db <path> \
 *     --fixture docs/validation/integrity-audit/phase6c4_domain_corroboration_fixture.json   # dry-run
 *   ... --apply
 *
 * Applies ONLY entries with auto_apply_safe===true. Guards: /data refusal; expected-OLD
 * status (and unitid when given) must match the current row [idempotent skip if already
 * at proposed]; proposed_unitid must be a real colleges institution; a proven domain that
 * is ABSENT is inserted only when allow_insert===true; one transaction; integrity check;
 * rollback; idempotent. SHARED_PLATFORM / ambiguous cases must stay auto_apply_safe:false.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing /data.'); process.exit(2); }
const fxPath = arg('fixture');
const j = fxPath && fs.existsSync(path.resolve(fxPath)) ? JSON.parse(fs.readFileSync(path.resolve(fxPath), 'utf8')) : { entries: [] };
const entries = (j.entries || j).filter((e) => e.auto_apply_safe === true);

const db = new Database(dbArg, { fileMustExist: true });
const getDom = db.prepare('SELECT domain, unitid, status FROM athletics_domains WHERE domain=?');
const unitidExists = db.prepare('SELECT COUNT(*) n FROM colleges WHERE unitid=?');
const problems = []; const plan = []; let already = 0;

for (const e of entries) {
  const tag = e.domain;
  if (!e.domain || e.proposed_unitid == null || !e.proposed_status) { problems.push(`${tag}: incomplete entry`); continue; }
  if (unitidExists.get(e.proposed_unitid).n === 0) { problems.push(`${tag}: proposed_unitid ${e.proposed_unitid} not a colleges institution`); continue; }
  const row = getDom.get(e.domain);
  if (!row) {
    if (e.allow_insert !== true) { problems.push(`${tag}: absent and allow_insert!=true`); continue; }
    plan.push({ e, op: 'insert' });
    continue;
  }
  // idempotent
  if (row.status === e.proposed_status && Number(row.unitid) === Number(e.proposed_unitid)) { already++; continue; }
  // expected-old guards
  if (e.expected_status != null && row.status !== e.expected_status) { problems.push(`${tag}: old status "${row.status}" != "${e.expected_status}"`); continue; }
  if (e.expected_unitid !== undefined && !(e.expected_unitid === null ? row.unitid == null : Number(row.unitid) === Number(e.expected_unitid))) { problems.push(`${tag}: old unitid ${row.unitid} != ${e.expected_unitid}`); continue; }
  plan.push({ e, op: 'update' });
}

console.log('PHASE 6C.4 domain-repair plan');
console.log(`  update/insert: ${plan.length} | ${already} already  (safe entries ${entries.length})`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const cols = new Set(db.prepare('PRAGMA table_info(athletics_domains)').all().map((c) => c.name));
const upd = db.prepare(`UPDATE athletics_domains SET unitid=@unitid, status=@status${cols.has('wrong_mappings') ? ', wrong_mappings=NULL' : ''}${cols.has('notes') ? ', notes=@notes' : ''}${cols.has('checked_at') ? ', checked_at=@checked_at' : ''} WHERE domain=@domain AND status=@expold_status`);
const insCols = ['domain', 'unitid', 'status'].concat(cols.has('notes') ? ['notes'] : [], cols.has('checked_at') ? ['checked_at'] : []);
const ins = db.prepare(`INSERT INTO athletics_domains (${insCols.join(',')}) VALUES (${insCols.map((c) => '@' + c).join(',')})`);
let updated = 0, inserted = 0;
try {
  db.exec('BEGIN');
  for (const { e, op } of plan) {
    const notes = (e.evidence_rationale || 'Phase 6C.4 proven domain correction').slice(0, 300);
    const checked_at = e.checked_at || '2026-09-28';
    if (op === 'insert') {
      const params = { domain: e.domain, unitid: e.proposed_unitid, status: e.proposed_status, notes, checked_at };
      ins.run(params); inserted++;
    } else {
      const row = getDom.get(e.domain);
      const r = upd.run({ domain: e.domain, unitid: e.proposed_unitid, status: e.proposed_status, notes, checked_at, expold_status: row.status });
      if (r.changes !== 1) throw new Error(`update ${e.domain}`);
      updated++;
    }
  }
  const integ = db.pragma('integrity_check', { simple: true });
  if (integ !== 'ok') throw new Error('integrity ' + integ);
  db.exec('COMMIT');
  console.log(`\nAPPLIED — updated ${updated}, inserted ${inserted}. integrity ${integ}.`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
