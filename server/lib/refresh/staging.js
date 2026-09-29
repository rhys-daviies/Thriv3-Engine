/**
 * STAGING — Phase 7E. DISCOVER -> NORMALIZE -> RESOLVE -> VERIFY OWNERSHIP -> COMPARE ->
 * CLASSIFY -> STAGE. Nothing in this module writes a canonical table: `stageRefresh`
 * computes, `writeStagedBatch` writes ONLY refresh_batches / refresh_observations.
 *
 * Gathered input (one JSON document, produced by any gatherer/parser):
 *   { season, scope, parser_version, gathered_at,
 *     pages: [ COACH | ROSTER | PROGRAMME | DOMAIN page objects — see changeClassifier.js ],
 *     membership_listings: [ { division, sport, season, source_url, members:[{institution_label, athletics_entity_id?, unitid?}] } ] }
 */
import crypto from 'node:crypto';
import { loadRefreshContext, frozenSeasons, tableExists } from './context.js';
import { classifyPage, classifyMembershipListing, CLASSIFICATIONS } from './changeClassifier.js';

export const sha256 = (s) => crypto.createHash('sha256').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');
/** Stable JSON: object keys sorted, so a hash never depends on insertion order. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export const STAGING_TABLES = Object.freeze(['refresh_batches', 'refresh_observations']);
export const OBS_COLUMNS = ['observation_id', 'batch_id', 'dataset', 'source_url', 'source_host', 'source_kind', 'source_tier', 'fetched_at',
  'observed_season', 'parser_version', 'raw_name', 'normalized_name', 'raw_json', 'candidate_entity_id', 'candidate_college_id',
  'resolution_method', 'resolution_decision', 'confidence', 'evidence_json', 'target_table', 'target_key', 'classification',
  'proposed_action', 'proposed_json', 'expected_old_json', 'requires_review', 'review_status', 'review_note', 'promoted_at'];

function loadHeld(db, ctx, input) {
  const sports = new Set((input.pages || []).map((p) => p.sport).filter(Boolean));
  const coaches = tableExists(db, 'coaches') ? db.prepare('SELECT * FROM coaches').all() : [];
  let roster = [];
  if (tableExists(db, 'roster_players') && (input.pages || []).some((p) => p.dataset === 'ROSTER')) {
    const min = Math.min(...input.pages.filter((p) => p.dataset === 'ROSTER').map((p) => Number(p.observed_season))) - 1;
    roster = db.prepare('SELECT id, college_name, sport, season, player_name, class_year_label, position, nationality, hometown FROM roster_players WHERE CAST(season AS INTEGER) >= ?').all(min).filter((r) => sports.has(r.sport));
  }
  return { ...ctx, coaches, roster };
}

/**
 * Pure computation of a batch: returns { batch, observations, summary }. Deterministic for a
 * given database state + input (ids and hashes derive from content, not from the clock).
 */
export function stageRefresh(db, input, { now = new Date() } = {}) {
  if (!Number.isInteger(Number(input.season))) throw new Error('input.season (integer fall-season year) is required');
  const season = Number(input.season); const scope = input.scope || '*';
  const ctx = loadHeld(db, loadRefreshContext(db), input);
  const frozen = frozenSeasons(ctx, scope);
  const input_hash = sha256(stableJson(input));
  const batch_id = `RB-${season}-${scope}-${input_hash.slice(0, 12)}`;
  const staged = [];
  for (const page of input.pages || []) {
    const raw = stableJson(page);
    for (const o of classifyPage(page, ctx, { season, now, frozen })) staged.push({ ...o, raw_json: raw });
  }
  for (const listing of input.membership_listings || []) for (const o of classifyMembershipListing(listing, ctx)) staged.push({ ...o, raw_json: stableJson(listing) });
  const idCount = new Map();
  const observations = staged.map((o) => {
    const k = `${o.dataset}|${o.target_key}|${o.source_url}|${o.classification}`;
    const n = (idCount.get(k) || 0) + 1; idCount.set(k, n);
    const observation_id = `RO-${sha256(`${batch_id}|${k}|${n}`).slice(0, 24)}`;
    return { observation_id, batch_id, review_status: null, review_note: null, promoted_at: null, ...o,
      requires_review: o.requires_review ? 1 : 0,
      evidence_json: o.evidence_json == null ? null : stableJson(o.evidence_json),
      proposed_json: o.proposed_json == null ? null : stableJson(o.proposed_json),
      expected_old_json: o.expected_old_json == null ? null : stableJson(o.expected_old_json) };
  });
  observations.sort((a, b) => a.observation_id.localeCompare(b.observation_id));
  const batch_hash = batchHash(observations);
  const summary = summarize(observations);
  return { batch: { batch_id, season, scope, datasets: [...new Set(observations.map((o) => o.dataset))].sort(), status: 'STAGED', input_hash, batch_hash, parser_version: input.parser_version || null, created_at: (input.gathered_at || now.toISOString()), notes: null }, observations, summary };
}

/** Hash of what promotion would act on: ids, classifications, actions and payloads. Reviews excluded. */
export function batchHash(observations) {
  return sha256(observations.map((o) => stableJson([o.observation_id, o.classification, o.proposed_action, o.proposed_json, o.expected_old_json, o.requires_review])).join('\n'));
}
export function summarize(observations) {
  const by = {};
  for (const o of observations) { by[o.dataset] = by[o.dataset] || Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])); by[o.dataset][o.classification]++; }
  return { total: observations.length, by_dataset: by, requires_review: observations.filter((o) => o.requires_review).length };
}

/** Write a staged batch to the STAGING tables only. Idempotent (same batch id -> refused unless identical). */
export function writeStagedBatch(db, { batch, observations }) {
  for (const t of STAGING_TABLES) if (!tableExists(db, t)) throw new Error(`staging table ${t} missing — run the schema/migration first`);
  const existing = db.prepare('SELECT batch_hash, status FROM refresh_batches WHERE batch_id=?').get(batch.batch_id);
  if (existing) { if (existing.batch_hash === batch.batch_hash) return { written: 0, unchanged: true }; throw new Error(`batch ${batch.batch_id} already staged with a different hash`); }
  const ins = db.prepare(`INSERT INTO refresh_observations (${OBS_COLUMNS.join(',')}) VALUES (${OBS_COLUMNS.map((c) => `@${c}`).join(',')})`);
  db.transaction(() => {
    db.prepare(`INSERT INTO refresh_batches (batch_id, season, scope, datasets, status, input_hash, batch_hash, parser_version, created_at, notes)
      VALUES (@batch_id, @season, @scope, @datasets, @status, @input_hash, @batch_hash, @parser_version, @created_at, @notes)`).run({ ...batch, datasets: JSON.stringify(batch.datasets) });
    for (const o of observations) ins.run(Object.fromEntries(OBS_COLUMNS.map((c) => [c, o[c] ?? null])));
  })();
  return { written: observations.length, unchanged: false };
}

export function loadStagedBatch(db, batchId) {
  const batch = db.prepare('SELECT * FROM refresh_batches WHERE batch_id=?').get(batchId);
  if (!batch) return null;
  const observations = db.prepare('SELECT * FROM refresh_observations WHERE batch_id=? ORDER BY observation_id').all(batchId);
  return { batch: { ...batch, datasets: JSON.parse(batch.datasets) }, observations };
}

/** Apply operator review decisions ({observation_id: 'APPROVED'|'REJECTED', note?}) to STAGING only. */
export function recordReviews(db, batchId, decisions) {
  const up = db.prepare('UPDATE refresh_observations SET review_status=@s, review_note=@n WHERE observation_id=@id AND batch_id=@b AND promoted_at IS NULL');
  let n = 0;
  db.transaction(() => { for (const d of decisions) n += up.run({ s: d.decision, n: d.note || null, id: d.observation_id, b: batchId }).changes; })();
  return n;
}
