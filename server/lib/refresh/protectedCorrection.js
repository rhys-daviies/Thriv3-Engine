/**
 * PROTECTED SOURCE CORRECTION — Phase 8C.5D. The one path that may reverse a previously
 * DECIDED athletics_domains ownership row.
 *
 * WHY A SEPARATE PATH. `applyPhase8AUniverse` registers hosts only where no decision exists, and
 * refuses any row already VERIFIED / VERIFIED_ALIAS / WRONG_INSTITUTION ("ownership change is a
 * protected action"). That refusal is right and stays. But some decided rows are provably wrong:
 * `verifyAthleticsDomains.js` (2026-09-01) stored WRONG_INSTITUTION for a whole host whenever ANY
 * mapping-file claim was refuted, even when the host's own self-identification named the row's
 * stored UNITID and another claim agreed with it (`athletics.csi.edu`: right for College of
 * Southern Idaho, refuted only for Eastern Wyoming). Reversing such a row is an adjudication, so it
 * gets its own, narrow, explicit mechanism rather than a widened registration tool.
 *
 * WHAT MAKES IT NARROW.
 *   - Only a fixture of kind PROTECTED_SOURCE_CORRECTION, hash-checked by the caller.
 *   - Every action names an approval record that lists that exact host. No approval, no write.
 *   - `expected_old` is the COMPLETE stored row (every column). Any difference refuses.
 *   - Only the transitions in ALLOWED_TRANSITIONS. Today: WRONG_INSTITUTION -> VERIFIED.
 *   - The true owner must be the row's own stored UNITID, held by exactly one SINGLE entity
 *     whose federal_unitid is that UNITID and which no campus hangs off (no parent leakage).
 *   - The refuted claimants named by the fixture must equal the row's wrong_mappings exactly, and
 *     are preserved: wrong_mappings, claimed_keys, claimed_unitids and every evidence column stay
 *     byte-identical. The owner may never be one of them.
 *   - Only status, athletics_entity_id, ownership_class and notes (provenance appended) change.
 *   - All actions in one transaction, preconditions re-read inside it, a caller postcheck (identity
 *     validator, ownership round trip) runs before COMMIT; any failure rolls everything back.
 *   - The manifest is in the promotion revert format, so revertManifest restores the exact row.
 */
import crypto from 'node:crypto';
import { normHost, hostOwnershipDisagreements } from './identityResolver.js';
import { loadRefreshContext } from './context.js';
import { isHeldDomain } from '../../../shared/heldDomainAdjudications.js';

export const PROTECTED_CORRECTION_KIND = 'PROTECTED_SOURCE_CORRECTION';
export const ALLOWED_TRANSITIONS = Object.freeze([
  Object.freeze({ from_status: 'WRONG_INSTITUTION', to_status: 'VERIFIED', from_ownership_class: null, to_ownership_class: 'ENTITY_OWNED' }),
]);
/** The only columns a correction may change. Everything else is evidence and must survive. */
export const MUTABLE_FIELDS = Object.freeze(['status', 'athletics_entity_id', 'ownership_class', 'notes']);
const REQUIRED = ['action_id', 'approval_id', 'host', 'true_entity', 'unitid', 'transition', 'wrong_claimants', 'expected_old', 'evidence', 'original_adjudication', 'reason', 'blast_radius'];

const same = (a, b) => (a ?? null) === (b ?? null);
const parseJson = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return undefined; } };
const claimantKey = (m) => `${m?.key}|${m?.claimantUnitid}`;

/** sha256 of the fixture body, excluding phase/created_at/fixture_hash (the repo-wide fixture convention). */
export function fixtureHash(fx) {
  const { phase, created_at, fixture_hash, ...body } = fx; // eslint-disable-line no-unused-vars
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Check every action against the live database. Returns { plan, problems }. Never writes.
 * A non-empty `problems` means nothing may be applied — the fixture is all-or-nothing.
 */
export function planProtectedCorrections(db, fx) {
  const problems = []; const plan = [];
  if (fx?.kind !== PROTECTED_CORRECTION_KIND) return { plan, problems: [`fixture kind must be ${PROTECTED_CORRECTION_KIND} (got ${fx?.kind ?? 'none'})`] };
  const actions = Array.isArray(fx.corrections) ? fx.corrections : [];
  if (!actions.length) problems.push('fixture has no corrections');
  const approvals = new Map((Array.isArray(fx.approvals) ? fx.approvals : []).map((a) => [a.approval_id, a]));
  const cols = db.prepare('PRAGMA table_info(athletics_domains)').all().map((c) => c.name);
  const seen = new Set();
  for (const a of actions) {
    const label = a?.action_id || a?.host || '?';
    const missing = REQUIRED.filter((k) => a?.[k] == null || a[k] === '');
    if (missing.length) { problems.push(`${label}: missing ${missing.join(', ')}`); continue; }
    const host = normHost(a.host);
    if (seen.has(host)) { problems.push(`${label}: ${host} appears twice`); continue; }
    seen.add(host);
    const ap = approvals.get(a.approval_id);
    if (!ap || !ap.approved_by || !ap.approved_at || !ap.basis || !(ap.hosts || []).map(normHost).includes(host)) { problems.push(`${label}: no approval record ${a.approval_id} covering ${host}`); continue; }
    if (isHeldDomain(host)) { problems.push(`${label}: ${host} is under external adjudication (heldDomainAdjudications)`); continue; }
    if (!a.evidence.institution_to_host || !a.evidence.host_to_institution) { problems.push(`${label}: evidence needs both institution_to_host and host_to_institution`); continue; }
    if (!a.original_adjudication.why_wrong) { problems.push(`${label}: original_adjudication.why_wrong is required`); continue; }
    const t = ALLOWED_TRANSITIONS.find((x) => Object.keys(x).every((k) => same(x[k], a.transition[k])));
    if (!t) { problems.push(`${label}: transition ${JSON.stringify(a.transition)} is not an allowed protected correction`); continue; }
    const row = db.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(host);
    if (!row) { problems.push(`${label}: ${host} has no athletics_domains row`); continue; }
    if (db.prepare('SELECT 1 FROM athletics_domains WHERE domain = ?').get(`www.${host}`)) { problems.push(`${label}: www.${host} has its own row — twin rows are not corrected here`); continue; }
    const exp = a.expected_old;
    const absent = cols.filter((c) => !(c in exp));
    if (absent.length) { problems.push(`${label}: expected_old must be the complete row (missing ${absent.join(', ')})`); continue; }
    const diff = cols.filter((c) => !same(row[c], exp[c]));
    if (diff.length) { problems.push(`${label}: expected-old mismatch on ${diff.join(', ')}`); continue; }
    if (row.status !== t.from_status || !same(row.ownership_class, t.from_ownership_class) || row.athletics_entity_id != null) { problems.push(`${label}: row is ${row.status}/${row.ownership_class ?? 'null'}/${row.athletics_entity_id ?? 'no entity'}, not the transition's starting state`); continue; }
    if (row.unitid == null || Number(a.unitid) !== Number(row.unitid)) { problems.push(`${label}: UNITID ${a.unitid} is not the row's stored owner ${row.unitid}`); continue; }
    const ent = db.prepare('SELECT * FROM athletics_entities WHERE athletics_entity_id = ?').get(a.true_entity);
    if (!ent) { problems.push(`${label}: entity ${a.true_entity} does not exist`); continue; }
    if (ent.entity_kind !== 'SINGLE' || Number(ent.federal_unitid) !== Number(row.unitid)) { problems.push(`${label}: entity ${a.true_entity} (${ent.entity_kind}, UNITID ${ent.federal_unitid}) is not the SINGLE entity of UNITID ${row.unitid}`); continue; }
    const owners = db.prepare('SELECT athletics_entity_id FROM athletics_entities WHERE federal_unitid = ? OR parent_unitid = ?').all(row.unitid, row.unitid).map((x) => x.athletics_entity_id);
    if (owners.length !== 1) { problems.push(`${label}: UNITID ${row.unitid} carries ${owners.length} entities (${owners.join(', ')}) — parent/campus ownership is not decided here`); continue; }
    const stored = parseJson(row.wrong_mappings);
    if (!Array.isArray(stored) || !stored.length) { problems.push(`${label}: row has no wrong_mappings — there is no refuted claimant to preserve, so this is not a reversal`); continue; }
    const want = Array.isArray(a.wrong_claimants) ? a.wrong_claimants : [];
    if (want.map(claimantKey).sort().join(',') !== stored.map(claimantKey).sort().join(',')) { problems.push(`${label}: wrong_claimants ${JSON.stringify(want)} must equal the stored refusals ${row.wrong_mappings}`); continue; }
    if (stored.some((m) => Number(m.claimantUnitid) === Number(row.unitid))) { problems.push(`${label}: the owner UNITID is itself a refuted claimant`); continue; }
    const other = db.prepare('SELECT domain FROM athletics_domains WHERE athletics_entity_id IS NOT NULL AND athletics_entity_id <> ? AND domain = ?').get(a.true_entity, host);
    if (other) { problems.push(`${label}: ${host} already names another entity`); continue; }
    plan.push({ action: a, host, row, transition: t });
  }
  return { plan, problems };
}

/** The exact row a correction produces. Only MUTABLE_FIELDS differ from `row`. */
export function correctedRow(item, { now, fixture_hash }) {
  const { action: a, row, transition: t } = item;
  const note = `PROTECTED_CORRECTION ${a.action_id} @ ${now} (fixture ${String(fixture_hash).slice(0, 12)}, approval ${a.approval_id}): ${t.from_status} -> ${t.to_status} for ${a.true_entity}; `
    + `original: ${a.original_adjudication.tool || 'unknown tool'} ${a.original_adjudication.timestamp || ''}; why wrong: ${a.original_adjudication.why_wrong}; `
    + `refused claimants kept in wrong_mappings: ${JSON.parse(row.wrong_mappings).map((m) => `${m.key} (${m.claimantUnitid})`).join(', ')}`;
  return { ...row, status: t.to_status, athletics_entity_id: a.true_entity, ownership_class: t.to_ownership_class, notes: (row.notes ? `${row.notes} | ${note}` : note).slice(0, 2000) };
}

/**
 * Apply (or dry-run) a planned fixture atomically. `postcheck(db)` runs inside the transaction
 * after the writes and must throw to refuse; a refusal rolls back every action.
 * Returns { applied, manifest, before, after }. With apply=false nothing is written.
 */
export function applyProtectedCorrections(db, fx, { apply = false, now = new Date().toISOString(), postcheck = null } = {}) {
  const fixture_hash = fixtureHash(fx);
  const { plan, problems } = planProtectedCorrections(db, fx);
  if (problems.length) throw Object.assign(new Error(`protected correction refused: ${problems.length} problem(s)`), { problems });
  const before = plan.map((p) => p.row); const after = plan.map((p) => correctedRow(p, { now, fixture_hash }));
  if (!apply) return { applied: 0, manifest: null, before, after, dryRun: true };
  const manifest = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    // Re-read inside the transaction: nothing may have moved between plan and write.
    const again = planProtectedCorrections(db, fx);
    if (again.problems.length) throw Object.assign(new Error('preconditions changed before write'), { problems: again.problems });
    plan.forEach((p, i) => {
      const nu = after[i];
      const set = Object.fromEntries(MUTABLE_FIELDS.map((k) => [k, nu[k]]));
      const res = db.prepare(`UPDATE athletics_domains SET ${MUTABLE_FIELDS.map((k) => `${k}=@${k}`).join(', ')} WHERE domain=@__domain AND status=@__status AND athletics_entity_id IS NULL`).run({ ...set, __domain: p.host, __status: p.row.status });
      if (res.changes !== 1) throw new Error(`${p.action.action_id}: row changed during the write`);
      manifest.push({ observation_id: p.action.action_id, action: 'PROTECTED_SOURCE_CORRECTION', entries: [{ kind: 'UPDATE', table: 'athletics_domains', key: { domain: p.host }, old: Object.fromEntries(MUTABLE_FIELDS.map((k) => [k, p.row[k] ?? null])), new: set }] });
    });
    for (const p of plan) {
      const cur = db.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(p.host);
      const changed = Object.keys(cur).filter((k) => !same(cur[k], p.row[k]));
      if (changed.some((k) => !MUTABLE_FIELDS.includes(k))) throw new Error(`${p.host}: a non-mutable field changed (${changed.join(', ')})`);
    }
    if (postcheck) postcheck(db, plan);
    const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw new Error(`integrity ${integ}`);
    db.exec('COMMIT');
  } catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } throw err; }
  return { applied: plan.length, manifest: { phase: 'PROTECTED_SOURCE_CORRECTION', fixture_hash, applied_at: now, before, manifest }, before, after };
}

/**
 * Ownership postcheck (run inside the transaction): every corrected host — bare and www — is owned
 * by its true entity through EXACT_HOST and by no other entity; every refuted claimant's entity
 * owns nothing there; the resolver reports 0 host-ownership disagreements. Throws to refuse.
 */
export function ownershipPostcheck(db, plan) {
  const ctx = loadRefreshContext(db); const r = ctx.resolver;
  const ents = [...new Set(ctx.entities.map((e) => e.athletics_entity_id))];
  const bad = [];
  for (const p of plan) {
    const e = p.action.true_entity;
    for (const h of [p.host, `www.${p.host}`]) {
      const o = r.ownerOfHost(h);
      if (o.entity !== e || o.via !== 'EXACT_HOST') bad.push(`${h} -> ${o.entity ?? o.status} (${o.via ?? o.reason}), expected ${e}`);
      const others = ents.filter((x) => x !== e && r.hostOwnedBy(h, x));
      if (others.length) bad.push(`${h} also owned by ${others.join(', ')}`);
    }
    for (const m of JSON.parse(p.row.wrong_mappings)) {
      const claimant = ctx.entities.filter((x) => Number(x.federal_unitid) === Number(m.claimantUnitid)).map((x) => x.athletics_entity_id);
      for (const c of claimant) if (r.hostOwnedBy(p.host, c)) bad.push(`refuted claimant ${m.key} (${c}) owns ${p.host}`);
    }
  }
  const dis = hostOwnershipDisagreements({ resolver: r, domains: ctx.domains, entities: ents });
  if ((dis.length ?? dis) !== 0) bad.push(`host ownership disagreements: ${dis.length ?? dis}`);
  if (bad.length) throw Object.assign(new Error(`ownership postcheck failed: ${bad.length}`), { problems: bad });
  return true;
}
