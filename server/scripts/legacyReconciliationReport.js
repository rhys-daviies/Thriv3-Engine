#!/usr/bin/env node
/**
 * LEGACY CONTACT RECONCILIATION — Phase 1G-B (B5), rule LCR-2 (Phase 1G-E). Deterministic planner +
 * READ-ONLY dry-run report. The only writer is legacyReconciliationApply.js (append-only, gated).
 *
 * For every legacy generic coaches row (email_status 'generic'), decide how it WOULD be accounted
 * for in the append-only `legacy_contact_reconciliation` ledger (schema.sql), and say why:
 *
 *   RETAINED_REFERENCED  any historical reference (outreach, sends, attempts, approvals, messages,
 *                        observations, tracking/engagement via its outreach) — kept forever, history
 *                        stays attributed to it; names its verified replacement when one exists
 *   SUPERSEDED           an EXACT match: a VERIFIED programme contact for the same athletics entity,
 *                        the same sport and the same address (compared explicitly), passing the
 *                        programme-contact floor NOW, and nothing ambiguous about it (LCR-2)
 *   INVALID              the row is wrong: another institution's mail domain, or no programme
 *   BLOCKED              a rule stands in the way (department inbox, camp/academy, address that
 *                        does not name the sport, unproven mail domain, a named coach holds it)
 *   UNRESOLVED           re-acquirable, but no verified replacement yet — or AMBIGUOUS (LCR-2): the
 *                        programme holds a verified contact at a DIFFERENT address, or the address is
 *                        verified for a different programme. Ambiguity is never resolved by a rule.
 *
 * Every entry's evidence carries `match.class` (EXACT | AMBIGUOUS_* | UNMATCHED); an EXACT match
 * records the contact's own provenance (page, observation time, source batch, role).
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

export const LCR_RULE_VERSION = 'LCR-2';
export const MATCH = Object.freeze({ EXACT: 'EXACT', AMBIGUOUS_PROGRAMME_ADDRESS: 'AMBIGUOUS_PROGRAMME_HAS_DIFFERENT_ADDRESS', AMBIGUOUS_ADDRESS_ELSEWHERE: 'AMBIGUOUS_ADDRESS_VERIFIED_FOR_OTHER_PROGRAMME', EXACT_FAILS_FLOOR: 'EXACT_ADDRESS_FAILS_FLOOR', UNMATCHED: 'UNMATCHED' });
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
const lc = (s) => String(s ?? '').trim().toLowerCase();

/**
 * How a legacy row relates to the VERIFIED programme contacts — compared explicitly, never inferred
 * from an id. EXACT needs the same athletics entity, sport and address, one such contact, no other
 * verified contact at the programme, and the address verified for no other programme.
 */
export function matchLegacyRow(lead, contacts) {
  const entity = lead.programme?.athletics_entity_id ?? null; const sport = lead.programme?.sport ?? lead.legacy.sport; const email = lc(lead.legacy.email);
  const atProgramme = entity ? contacts.filter((c) => c.athletics_entity_id === entity && c.sport === sport) : [];
  const exact = atProgramme.filter((c) => lc(c.email) === email);
  const elsewhere = contacts.filter((c) => lc(c.email) === email && !(c.athletics_entity_id === entity && c.sport === sport));
  if (elsewhere.length) return { class: MATCH.AMBIGUOUS_ADDRESS_ELSEWHERE, contact: null, others: elsewhere.map((c) => c.contact_id) };
  if (exact.length === 1 && atProgramme.length === 1) return { class: MATCH.EXACT, contact: exact[0], others: [] };
  if (atProgramme.length) return { class: MATCH.AMBIGUOUS_PROGRAMME_ADDRESS, contact: null, others: atProgramme.map((c) => c.contact_id) };
  return { class: MATCH.UNMATCHED, contact: null, others: [] };
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
    const m = matchLegacyRow(l, contacts);
    const candidate = m.contact || (l.target.expected_contact_id ? byId.get(l.target.expected_contact_id) : null);
    const problems = candidate ? programmeContactProblems(candidate, pcCtx, { now }) : null;
    // a replacement is named ONLY for an exact, unambiguous match that passes the floor now
    const replacement = m.class === MATCH.EXACT && problems.length === 0 ? m.contact : null;
    const matchClass = m.class === MATCH.EXACT && !replacement ? MATCH.EXACT_FAILS_FLOOR : m.class;
    const ambiguous = matchClass.startsWith('AMBIGUOUS');
    let disposition; let reason;
    if (referenced) { disposition = DISPOSITION.RETAINED_REFERENCED; reason = `historical references (${Object.entries(refs).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(', ')}): kept; history stays attributed to this row`; }
    else if (replacement) { disposition = DISPOSITION.SUPERSEDED; reason = 'EXACT: a VERIFIED programme contact for the same entity, sport and address passes the floor now'; }
    else if (l.queue_status === QUEUE.BLOCKED_PROGRAMME_ABSENT || l.checks.address_domain === PC_INELIGIBLE.ADDRESS_DOMAIN_OTHER_ENTITY) { disposition = DISPOSITION.INVALID; reason = l.queue_status === QUEUE.BLOCKED_PROGRAMME_ABSENT ? 'no programme row' : 'the address belongs to another institution\'s mail domain'; }
    else if (l.queue_status.startsWith('BLOCKED')) { disposition = DISPOSITION.BLOCKED; reason = l.queue_status; }
    else if (ambiguous) { disposition = DISPOSITION.UNRESOLVED; reason = `${matchClass}: left for a person to decide (${m.others.join(', ')})`; }
    else { disposition = DISPOSITION.UNRESOLVED; reason = candidate ? `a held contact exists but fails the floor now (${problems.join(', ')})` : 'no verified programme contact yet'; }
    const pc = disposition === DISPOSITION.SUPERSEDED || (disposition === DISPOSITION.RETAINED_REFERENCED && replacement) ? replacement.contact_id : null;
    return {
      entry_id: entryId(runId, l.legacy.coach_id, disposition, pc), run_id: runId, coach_id: l.legacy.coach_id, disposition, programme_contact_id: pc,
      cohort: l.queue_status, reason, rule_version: LCR_RULE_VERSION, recorded_at: recordedAt,
      evidence_json: stableJson({
        lead_id: l.lead_id, expected_contact_id: l.target.expected_contact_id, address_domain: l.checks.address_domain, references: refs, candidate_problems: problems ?? null,
        match: {
          class: matchClass, others: m.others,
          legacy: { coach_id: l.legacy.coach_id, school: l.legacy.school, sport: l.legacy.sport, address: lc(l.legacy.email), email_status: l.legacy.email_status, athletics_entity_id: l.programme?.athletics_entity_id ?? null },
          contact: replacement ? { contact_id: replacement.contact_id, athletics_entity_id: replacement.athletics_entity_id, sport: replacement.sport, address: lc(replacement.email), status: replacement.status, contact_role: replacement.contact_role, observed_on_url: replacement.observed_on_url, observed_at: replacement.observed_at, source: replacement.source, source_kind: replacement.source_kind } : null,
          same_entity: !!replacement, same_sport: !!replacement, same_address: !!replacement,
        },
      }),
    };
  }).sort((a, b) => a.coach_id.localeCompare(b.coach_id));
  const generic = db.prepare("SELECT id FROM coaches WHERE email_status = 'generic'").pluck().all();
  const accounted = new Set(entries.map((e) => e.coach_id));
  const coverage = { generic_rows: generic.length, accounted: generic.filter((id) => accounted.has(id)).length, missing: generic.filter((id) => !accounted.has(id)), duplicated: entries.length - accounted.size };
  const count = (f) => entries.reduce((m, e) => { const k = f(e); m[k] = (m[k] || 0) + 1; return m; }, {});
  const replaced = new Map(); for (const e of entries) if (e.programme_contact_id) replaced.set(e.programme_contact_id, [...(replaced.get(e.programme_contact_id) || []), e.coach_id]);
  const summary = {
    run_id: runId, rule_version: LCR_RULE_VERSION, lead_digest: leadDigest, entries: entries.length, by_disposition: count((e) => e.disposition), by_cohort: count((e) => `${e.disposition}/${e.cohort}`),
    by_match: count((e) => JSON.parse(e.evidence_json).match.class), verified_contacts: contacts.length, contacts_named: replaced.size,
    contacts_without_legacy_row: contacts.filter((c) => !replaced.has(c.contact_id)).map((c) => c.contact_id).sort(),
    contacts_naming_several_rows: [...replaced].filter(([, v]) => v.length > 1).map(([c, v]) => ({ contact_id: c, coach_ids: v.sort() })),
    coverage, writes: 0,
  };
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
