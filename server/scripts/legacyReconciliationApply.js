#!/usr/bin/env node
/**
 * LEGACY CONTACT RECONCILIATION — APPLY (Phase 1G-E). The ONLY writer of `legacy_contact_reconciliation`.
 *
 * It writes ledger entries and nothing else. A legacy generic coaches row is never converted,
 * rewritten or deleted; no outreach, send, tracking, engagement, attempt, approval, message,
 * observation, suppression or programme contact is touched — the transaction proves it and rolls
 * back if any of those tables moved.
 *
 * Gates, all inside ONE immediate transaction:
 *   1. the plan is re-derived on the same connection (legacyReconciliationReport.js, rule LCR-2)
 *      and its hash must equal the hash the operator approved (--plan-hash) — no drift between the
 *      reviewed dry run and the write;
 *   2. every legacy generic row is accounted for exactly once;
 *   3. the run id is new — or already applied with exactly these entries (idempotent no-op);
 *   4. after inserting, the ledger grew by exactly the planned entries and every protected table's
 *      content hash is unchanged.
 * The ledger is append-only (triggers): an applied run is undone only by a later run that decides
 * differently, or by restoring the pre-apply checkpoint.
 *
 *   dry run (default; read-only):  node server/scripts/legacyReconciliationApply.js --db <path> --run-id <id> [--manifest-out <file>]
 *   apply:                         ... --apply --plan-hash <sha256 from the dry run>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { planLegacyReconciliation, LCR_RULE_VERSION } from './legacyReconciliationReport.js';

/** Tables a reconciliation must never change: history, safety decisions, and the entities themselves. */
export const PROTECTED_TABLES = Object.freeze([
  'coaches', 'programme_contacts', 'outreach', 'outreach_send', 'outreach_send_event', 'tracking_events', 'engagement_rollup',
  'outreach_evidence', 'suppressions', 'programme_contact_attempts', 'campaign_first_touch_approvals', 'programme_messages',
  'recruiting_observations', 'athlete_programmes',
]);
const has = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

/** sha256 over every row of each protected table, in rowid order. */
export function protectedFingerprint(db) {
  const out = {};
  for (const t of PROTECTED_TABLES) {
    if (!has(db, t)) { out[t] = 'ABSENT'; continue; }
    const h = crypto.createHash('sha256'); let n = 0;
    for (const r of db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).raw().iterate()) { h.update(JSON.stringify(r)).update('\n'); n += 1; }
    out[t] = `${n}:${h.digest('hex').slice(0, 16)}`;
  }
  return out;
}

const ENTRY_COLS = ['entry_id', 'run_id', 'coach_id', 'disposition', 'programme_contact_id', 'cohort', 'reason', 'evidence_json', 'rule_version', 'recorded_at'];
const fail = (code, message) => Object.assign(new Error(message), { code });

/** What a later apply would insert — the reviewable manifest. Read-only. */
export function dryRunManifest(db, { runId, now = new Date() } = {}) {
  const plan = planLegacyReconciliation(db, { runId, now });
  const existing = has(db, 'legacy_contact_reconciliation') ? db.prepare('SELECT COUNT(*) FROM legacy_contact_reconciliation').pluck().get() : null;
  return {
    kind: 'LEGACY_RECONCILIATION_DRY_RUN', rule_version: LCR_RULE_VERSION, run_id: runId, plan_hash: plan.summary.plan_hash,
    would_insert: plan.entries.length, table: 'legacy_contact_reconciliation', ledger_rows_now: existing,
    summary: plan.summary,
    inserts: plan.entries.map((e) => ({ entry_id: e.entry_id, coach_id: e.coach_id, disposition: e.disposition, programme_contact_id: e.programme_contact_id, cohort: e.cohort, match: JSON.parse(e.evidence_json).match.class, reason: e.reason })),
    protected_tables_unchanged: PROTECTED_TABLES, protected_fingerprint: protectedFingerprint(db), writes: 0,
  };
}

/** Apply one reviewed plan. Throws (and writes nothing) on any gate failure. */
export function applyLegacyReconciliation(db, { runId, expectedPlanHash, now = new Date() } = {}) {
  if (!runId) throw fail('RUN_ID_REQUIRED', 'a run id is required');
  if (!/^[0-9a-f]{64}$/.test(expectedPlanHash || '')) throw fail('PLAN_HASH_REQUIRED', 'the approved plan hash (from the dry run) is required');
  if (!has(db, 'legacy_contact_reconciliation')) throw fail('LEDGER_ABSENT', 'legacy_contact_reconciliation does not exist on this database');
  return db.transaction(() => {
    const plan = planLegacyReconciliation(db, { runId, now });
    if (plan.summary.plan_hash !== expectedPlanHash) throw fail('PLAN_DRIFT', `the plan changed since it was approved (${expectedPlanHash.slice(0, 12)} -> ${plan.summary.plan_hash.slice(0, 12)})`);
    const cov = plan.summary.coverage;
    if (cov.accounted !== cov.generic_rows || cov.missing.length || cov.duplicated) throw fail('COVERAGE_INCOMPLETE', `every legacy row must be accounted for exactly once (${JSON.stringify(cov)})`);
    const already = db.prepare('SELECT entry_id FROM legacy_contact_reconciliation WHERE run_id = ? ORDER BY entry_id').pluck().all(runId);
    if (already.length) {
      const planned = plan.entries.map((e) => e.entry_id).sort();
      if (JSON.stringify(already) === JSON.stringify(planned)) return { status: 'ALREADY_APPLIED', run_id: runId, plan_hash: plan.summary.plan_hash, inserted: 0 };
      throw fail('RUN_ID_USED', `run ${runId} already holds a different set of entries`);
    }
    const before = protectedFingerprint(db);
    const ledgerBefore = db.prepare('SELECT COUNT(*) FROM legacy_contact_reconciliation').pluck().get();
    const ins = db.prepare(`INSERT INTO legacy_contact_reconciliation (${ENTRY_COLS.join(', ')}) VALUES (${ENTRY_COLS.map((c) => `@${c}`).join(', ')})`);
    for (const e of plan.entries) ins.run(e);
    const ledgerAfter = db.prepare('SELECT COUNT(*) FROM legacy_contact_reconciliation').pluck().get();
    if (ledgerAfter - ledgerBefore !== plan.entries.length) throw fail('LEDGER_COUNT', `expected +${plan.entries.length} ledger rows, saw +${ledgerAfter - ledgerBefore}`);
    const after = protectedFingerprint(db);
    const moved = PROTECTED_TABLES.filter((t) => before[t] !== after[t]);
    if (moved.length) throw fail('PROTECTED_TABLE_CHANGED', `a reconciliation must change nothing but the ledger (moved: ${moved.join(', ')})`);
    return { status: 'APPLIED', run_id: runId, rule_version: LCR_RULE_VERSION, plan_hash: plan.summary.plan_hash, inserted: plan.entries.length, ledger_before: ledgerBefore, ledger_after: ledgerAfter, by_disposition: plan.summary.by_disposition, by_match: plan.summary.by_match, protected_fingerprint: after };
  }).immediate();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
  const dbPath = arg('db'); const runId = arg('run-id');
  if (!dbPath || !runId) { console.error('usage: legacyReconciliationApply --db <path> --run-id <id> [--manifest-out <file>] [--apply --plan-hash <sha256>]'); process.exit(2); }
  if (/^\/data\//.test(path.resolve(dbPath))) { console.error('Refusing a production /data path.'); process.exit(2); }
  const apply = argv.includes('--apply');
  const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
  if (!apply) db.pragma('query_only = ON');
  let out;
  try {
    out = apply ? applyLegacyReconciliation(db, { runId, expectedPlanHash: arg('plan-hash') }) : dryRunManifest(db, { runId });
  } catch (err) { console.error(`REFUSED ${err.code || ''}: ${err.message}`); process.exitCode = 1; } finally { db.close(); }
  if (out) {
    if (arg('manifest-out')) fs.writeFileSync(path.resolve(arg('manifest-out')), `${JSON.stringify(out, null, 1)}\n`);
    console.log(apply
      ? `${out.status} run ${out.run_id} · +${out.inserted} ledger entries · plan ${out.plan_hash.slice(0, 12)}`
      : `DRY RUN ${out.run_id} · would insert ${out.would_insert} · ${JSON.stringify(out.summary.by_disposition)} · match ${JSON.stringify(out.summary.by_match)} · plan_hash ${out.plan_hash} · nothing written`);
  }
}
