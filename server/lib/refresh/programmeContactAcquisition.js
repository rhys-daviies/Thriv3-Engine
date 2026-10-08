/**
 * PROGRAMME CONTACT BATCH ACQUISITION — Phase 1G-D. Pure planning and outcome logic.
 *
 * This module adds NO new evidence rule, gate or writer. A batch acquisition is the existing
 * integrity pipeline run many times, deterministically:
 *
 *   plan     scripts/programmeContactPlan.js (a lead is only a staff-page URL on an owned host)
 *   gather   adapters/gatherers.js programmeContactAdapter (host-only; adapterSafety refusals)
 *   stage    refresh/staging.js stageRefresh + writeStagedBatch (staging tables only)
 *   judge    changeClassifier (slot rules) + programmeContactEligibility (the floor)
 *   promote  scripts/integrityPromote.js — the ONLY writer, its 14 gates, its manifests
 *
 * What lives here: splitting a plan into stable batches, excluding programmes that already hold
 * a VERIFIED contact (idempotency), and turning each target's evidence into ONE outcome a report,
 * an operator dashboard or an acquisition agent can act on.
 */
import crypto from 'node:crypto';
import { stableJson } from './staging.js';

export const ACQ_VERSION = 'pc-acq-1';

/** One outcome per planned target (or per lead the plan could not use). */
export const OUTCOME = Object.freeze({
  VERIFIED: 'VERIFIED',                         // staged NEW_RECORD and its batch passed every gate
  ALREADY_HELD: 'ALREADY_HELD',                 // the programme already holds a VERIFIED contact: not re-acquired
  REJECTED: 'REJECTED',                         // the page was read; its address failed the slot rules or the floor
  REFUSED_AT_SOURCE: 'REFUSED_AT_SOURCE',       // the gatherer refused the page (blocked, wrong sport, foreign host, nothing published)
  GATE_FAILED: 'GATE_FAILED',                   // staged as NEW_RECORD but its batch failed a promotion gate
  NOT_PLANNED: 'NOT_PLANNED',                   // no owned staff page to read (the lead's page host is not owned now)
  UNRESOLVED: 'UNRESOLVED',                     // not yet attempted, or the attempt did not finish (resume)
});

const key = (e, s) => `${e}|${s}`;
const short = (s, n = 12) => String(s).slice(0, n);

/**
 * Split a programmeContactPlan into deterministic batches.
 *   plan:  { plan_hash, targets[], skipped[] }    held: Set of "entity|sport" already VERIFIED
 * Batch ids depend only on the plan hash, the batch size and the batch's position, so a resumed
 * run addresses the same batches.
 */
export function batchPlan(plan, { batchSize = 10, held = new Set() } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  const alreadyHeld = []; const todo = [];
  for (const t of plan.targets) (held.has(key(t.athletics_entity_id, t.sport)) ? alreadyHeld : todo).push(t);
  const batches = [];
  for (let i = 0; i < todo.length; i += batchSize) {
    const targets = todo.slice(i, i + batchSize);
    const no = batches.length + 1;
    batches.push({ batch_no: no, batch_key: `ACQ-${short(plan.plan_hash)}-S${batchSize}-B${String(no).padStart(3, '0')}`, targets });
  }
  const run_id = `ACQ-${short(crypto.createHash('sha256').update(stableJson({ plan: plan.plan_hash, batchSize, held: [...held].sort() })).digest('hex'))}`;
  return { run_id, plan_hash: plan.plan_hash, batch_size: batchSize, batches, already_held: alreadyHeld, skipped: plan.skipped };
}

/** The staging scope of one acquisition batch (refresh_batches.scope). */
export const batchScope = (b) => b.batch_key;

/**
 * One target's outcome from what happened to it.
 *   gathered:  { page } | { refusal } | undefined
 *   observations: refresh_observations rows staged from that page (may be empty)
 *   gate:      { pass } of its batch's promotion dry run, or undefined when not yet run
 */
export function outcomeOf({ gathered, observations = [], gate }) {
  if (!gathered) return { outcome: OUTCOME.UNRESOLVED, reason: 'not gathered yet' };
  if (gathered.refusal) return { outcome: OUTCOME.REFUSED_AT_SOURCE, reason: gathered.refusal.code, detail: gathered.refusal.detail };
  const created = observations.filter((o) => o.proposed_action === 'CREATE_PROGRAMME_CONTACT');
  if (!created.length) {
    const why = observations.map((o) => { let w = []; try { w = JSON.parse(o.evidence_json || '{}').why || []; } catch { /* none */ } return `${o.classification}: ${w.join('; ')}`; });
    return { outcome: OUTCOME.REJECTED, reason: observations[0]?.classification || 'NO_OBSERVATION', detail: why.join(' | ').slice(0, 400) };
  }
  if (gate === undefined) return { outcome: OUTCOME.UNRESOLVED, reason: 'staged; promotion dry run not run yet' };
  if (!gate.pass) return { outcome: OUTCOME.GATE_FAILED, reason: 'batch failed a promotion gate', detail: (gate.failed || []).join(', ') };
  return { outcome: OUTCOME.VERIFIED, reason: created.length > 1 ? `${created.length} qualifying addresses` : 'qualifying address' };
}

/**
 * Data Integrity dependency of a skipped lead: its staff page sits on a host that a pending,
 * approved-but-unapplied identity correction would make owned (the 1G-PRE fixture hosts).
 */
export function pendingCorrectionFor(lead, correctionHosts) {
  const u = lead?.legacy?.email_source_url || lead?.target?.page_to_fetch || null;
  let h = null; try { h = u ? new URL(u.replace(/^https?:\/\/web\.archive\.org\/web\/\d+\//, '')).hostname.toLowerCase().replace(/^www\./, '') : null; } catch { h = null; }
  return h && correctionHosts.has(h) ? { host: h, correction: 'PENDING_1GPRE_WRONG_INSTITUTION_REPAIR' } : null;
}

/**
 * A report's content hash, over everything but timestamps and apply-time record ids (promotion ids
 * are minted per apply) — deterministic when the source evidence is unchanged.
 */
export function reportDigest(report) {
  const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !/(_at|_utc|^generated|^started|^finished|duration|^promotion_id$)/.test(k)).map(([k, x]) => [k, strip(x)])) : v);
  return crypto.createHash('sha256').update(stableJson(strip(report))).digest('hex');
}
