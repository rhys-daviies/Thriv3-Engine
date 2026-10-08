#!/usr/bin/env node
/**
 * LEGACY CONTACT RECONCILIATION — Phase 1G-B (B5). Deterministic planner + READ-ONLY dry-run report.
 *
 * For every legacy generic coaches row (email_status 'generic'), decide how it WOULD be accounted
 * for in the append-only `legacy_contact_reconciliation` ledger (schema.sql), and say why:
 *
 *   RETAINED_REFERENCED  any historical reference (outreach, sends, attempts, approvals, messages,
 *                        observations, tracking/engagement via its outreach) — kept forever, history
 *                        stays attributed to it; names its verified replacement when one exists
 *   SUPERSEDED           a VERIFIED programme contact for the same programme and exact address
 *                        exists and passes the programme-contact floor NOW
 *   INVALID              the row is wrong: another institution's mail domain, or no programme
 *   BLOCKED              a rule stands in the way (department inbox, camp/academy, address that
 *                        does not name the sport, unproven mail domain, a named coach holds it)
 *   UNRESOLVED           re-acquirable, but no verified replacement yet
 *
 * Writes NOTHING to any database: the database is opened read-only with query_only. The report
 * goes to --out-dir (outside git: it carries addresses). The planner is pure over the handle.
 *
 *   node server/scripts/legacyReconciliationReport.js --db <path> --run-id <id> [--out-dir <dir>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildLeadQueue, QUEUE } from './programmeContactLeads.js';
import { buildProgrammeContactContext, programmeContactProblems, PC_INELIGIBLE } from '../lib/programmeContactEligibility.js';
import { stableJson } from '../lib/refresh/staging.js';

export const LCR_RULE_VERSION = 'LCR-1';
export const DISPOSITION = Object.freeze({ SUPERSEDED: 'SUPERSEDED', RETAINED_REFERENCED: 'RETAINED_REFERENCED', BLOCKED: 'BLOCKED', INVALID: 'INVALID', UNRESOLVED: 'UNRESOLVED' });
const REF_TABLES = ['outreach', 'outreach_send', 'programme_contact_attempts', 'campaign_first_touch_approvals', 'programme_messages', 'recruiting_observations'];
const has = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const hasCol = (db, t, c) => has(db, t) && db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);

/** Every historical reference to one coaches row. */
function referencesOf(db, coachId) {
  const refs = {};
  for (const t of REF_TABLES) if (hasCol(db, t, 'coach_id')) refs[t] = db.prepare(`SELECT COUNT(*) FROM ${t} WHERE coach_id = ?`).pluck().get(coachId);
  const ids = hasCol(db, 'outreach', 'coach_id') ? db.prepare('SELECT id FROM outreach WHERE coach_id = ?').pluck().all(coachId) : [];
  const via = (t) => (ids.length && hasCol(db, t, 'outreach_id') ? db.prepare(`SELECT COUNT(*) FROM ${t} WHERE outreach_id IN (${ids.map(() => '?').join(',')})`).pluck().get(...ids) : 0);
  refs.tracking_events = via('tracking_events'); refs.engagement_rollup = via('engagement_rollup'); refs.outreach_evidence = via('outreach_evidence');
  return refs;
}
const entryId = (runId, coachId, disposition, pc) => `LCR-${crypto.createHash('sha256').update(`${runId}|${coachId}|${disposition}|${pc ?? ''}`).digest('hex').slice(0, 24)}`;

export function planLegacyReconciliation(db, { runId, now = new Date(), federalIndex } = {}) {
  if (!runId) throw new Error('planLegacyReconciliation: runId is required');
  const { leads, digest: leadDigest } = buildLeadQueue(db);
  const pcCtx = buildProgrammeContactContext(db, federalIndex !== undefined ? { federalIndex } : {});
  const contacts = has(db, 'programme_contacts') ? db.prepare("SELECT * FROM programme_contacts WHERE status = 'VERIFIED'").all() : [];
  const byId = new Map(contacts.map((c) => [c.contact_id, c]));
  const recordedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const entries = leads.map((l) => {
    const refs = referencesOf(db, l.legacy.coach_id);
    const referenced = Object.values(refs).some((n) => n > 0);
    const candidate = l.target.expected_contact_id ? byId.get(l.target.expected_contact_id) : null;
    const problems = candidate ? programmeContactProblems(candidate, pcCtx, { now }) : null;
    const replacement = candidate && problems.length === 0 ? candidate : null;
    let disposition; let reason;
    if (referenced) { disposition = DISPOSITION.RETAINED_REFERENCED; reason = `historical references (${Object.entries(refs).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(', ')}): kept; history stays attributed to this row`; }
    else if (replacement) { disposition = DISPOSITION.SUPERSEDED; reason = 'a VERIFIED programme contact for the same programme and address passes the floor now'; }
    else if (l.queue_status === QUEUE.BLOCKED_PROGRAMME_ABSENT || l.checks.address_domain === PC_INELIGIBLE.ADDRESS_DOMAIN_OTHER_ENTITY) { disposition = DISPOSITION.INVALID; reason = l.queue_status === QUEUE.BLOCKED_PROGRAMME_ABSENT ? 'no programme row' : 'the address belongs to another institution\'s mail domain'; }
    else if (l.queue_status.startsWith('BLOCKED')) { disposition = DISPOSITION.BLOCKED; reason = l.queue_status; }
    else { disposition = DISPOSITION.UNRESOLVED; reason = candidate ? `a held contact exists but fails the floor now (${problems.join(', ')})` : 'no verified programme contact yet'; }
    const pc = disposition === DISPOSITION.SUPERSEDED || (disposition === DISPOSITION.RETAINED_REFERENCED && replacement) ? replacement.contact_id : null;
    return {
      entry_id: entryId(runId, l.legacy.coach_id, disposition, pc), run_id: runId, coach_id: l.legacy.coach_id, disposition, programme_contact_id: pc,
      cohort: l.queue_status, reason, rule_version: LCR_RULE_VERSION, recorded_at: recordedAt,
      evidence_json: stableJson({ lead_id: l.lead_id, expected_contact_id: l.target.expected_contact_id, address_domain: l.checks.address_domain, references: refs, candidate_problems: problems ?? null }),
    };
  }).sort((a, b) => a.coach_id.localeCompare(b.coach_id));
  const generic = db.prepare("SELECT id FROM coaches WHERE email_status = 'generic'").pluck().all();
  const accounted = new Set(entries.map((e) => e.coach_id));
  const coverage = { generic_rows: generic.length, accounted: generic.filter((id) => accounted.has(id)).length, missing: generic.filter((id) => !accounted.has(id)), duplicated: entries.length - accounted.size };
  const count = (f) => entries.reduce((m, e) => { const k = f(e); m[k] = (m[k] || 0) + 1; return m; }, {});
  const summary = { run_id: runId, rule_version: LCR_RULE_VERSION, lead_digest: leadDigest, entries: entries.length, by_disposition: count((e) => e.disposition), by_cohort: count((e) => `${e.disposition}/${e.cohort}`), coverage, writes: 0 };
  const plan_hash = crypto.createHash('sha256').update(stableJson(entries.map(({ recorded_at, ...e }) => e))).digest('hex'); // eslint-disable-line no-unused-vars
  return { entries, summary: { ...summary, plan_hash } };
}

/** The ledger's own coverage check (report mode): every generic row has an entry in the newest run that names it. */
export function ledgerCoverage(db) {
  if (!has(db, 'legacy_contact_reconciliation')) return { ledger: 'ABSENT', generic_rows: null, accounted: null };
  const generic = db.prepare("SELECT id FROM coaches WHERE email_status = 'generic'").pluck().all();
  const seen = new Set(db.prepare('SELECT DISTINCT coach_id FROM legacy_contact_reconciliation').pluck().all());
  return { ledger: 'PRESENT', generic_rows: generic.length, accounted: generic.filter((id) => seen.has(id)).length, entries: db.prepare('SELECT COUNT(*) FROM legacy_contact_reconciliation').pluck().get() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
  if (!arg('db') || !arg('run-id')) { console.error('usage: legacyReconciliationReport --db <path> --run-id <id> [--out-dir <dir>] [--json]'); process.exit(2); }
  const db = new Database(arg('db'), { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  let plan; let ledger;
  try { plan = planLegacyReconciliation(db, { runId: arg('run-id') }); ledger = ledgerCoverage(db); } finally { db.close(); }
  if (arg('out-dir')) {
    fs.mkdirSync(path.resolve(arg('out-dir')), { recursive: true });
    fs.writeFileSync(path.join(path.resolve(arg('out-dir')), 'legacy_reconciliation_dry_run.json'), `${JSON.stringify({ summary: plan.summary, ledger, entries: plan.entries }, null, 1)}\n`);
  }
  if (argv.includes('--json')) console.log(JSON.stringify({ ...plan.summary, ledger }, null, 1));
  else console.log(`DRY RUN ${plan.summary.entries} entries · ${JSON.stringify(plan.summary.by_disposition)} · coverage ${plan.summary.coverage.accounted}/${plan.summary.coverage.generic_rows} · ledger ${ledger.ledger} · nothing written`);
}
