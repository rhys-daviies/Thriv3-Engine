/**
 * INTEGRITY MEASUREMENT — Phase 7E (the Phase 7D harness made permanent).
 *
 * Reconciles a TEMP COPY of a database (never the input) with the production reconciler and
 * measures what the promotion gate and the monitor need:
 *   - eligible coaches, by TRUTHFUL division (canonical_college_id -> colleges.division) and by
 *     the frozen legacy key (unitid,sport last-row-wins — kept only for continuity with
 *     baselines; see memory "ncaa-gate-hash-contaminated")
 *   - logical programme universe per division (athletics entity + sport)
 *   - NAIA coverage (covered logical programmes / universe) and strict-path evidence
 *   - integrity counters (source-domain conflicts, wrong institution/sport, stale, inferred,
 *     duplicate identity, canonical round-trip)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { hostOf } from '../athleticsEntity.js';
import { reconcileCoachRows } from '../coachReconciler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const REC = path.join(ROOT, 'server/scripts/reconcileCoaches.js');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nn = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
export const DIVISIONS = Object.freeze(['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA', 'USCAA', 'NCCAA']);

/** Consistent copy of a live database (WAL-safe): VACUUM INTO from a read-only handle. */
export function copyDatabase(src, dst) {
  const s = new Database(src, { readonly: true, fileMustExist: true });
  try { s.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`); } finally { s.close(); }
  return dst;
}

export function reconcileCopy(src, { scope = 'NAIA' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm7e-'));
  const db = path.join(tmp, 'r.sqlite');
  // a failed copy (a full disk, a locked file) must not leave a 250 MB orphan behind: the
  // rm7e-* directories found in Phase 8B.1A were exactly that
  try {
    copyDatabase(src, db);
    execFileSync(process.execPath, [REC, '--db', db, '--csv', path.join(tmp, 'o.csv')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STRICT_CORROB_SCOPE: scope }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) { fs.rmSync(tmp, { recursive: true, force: true }); throw err; }
  return { tmp, db };
}

export function measureDatabase(src, opts = {}) {
  const { tmp, db: rdb } = reconcileCopy(src, opts);
  try {
    const db = new Database(rdb, { readonly: true });
    const rc = db.prepare('SELECT * FROM coaches_reconciled').all();
    try { return measureReconciled(db, rc); } finally { db.close(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * The same measurement on an OPEN connection, without copying or writing anything: the reconciler
 * runs in-process (server/lib/coachReconciler.js, the engine the CLI uses) and every table is read
 * through `db`. On a connection holding an uncommitted transaction this measures the uncommitted
 * state, which no other connection can see — the composite correction writer's per-stage gate.
 */
export function measureInProcess(db, { scope = 'NAIA' } = {}) {
  return measureReconciled(db, reconcileCoachRows(db, { scope }));
}

/** Measure reconciled rows `rc` against the tables of `db`. Read-only; does not close `db`. */
export function measureReconciled(db, rc) {
  const coll = db.prepare('SELECT id, name, sport, unitid, division, active, athletics_entity_id FROM colleges').all();
  const byId = new Map(coll.map((c) => [c.id, c])); const byNS = new Map(coll.map((c) => [`${c.name}|${c.sport}`, c]));
  const divByUS = new Map(coll.map((c) => [`${c.unitid}|${c.sport}`, c.division]));
  const raw = db.prepare('SELECT id, full_name, school, sport, email, email_status, currentness_status, currentness_checked_at, currentness_source_url, email_seen_on_source_at, email_seen_on_source_url FROM coaches').all();
  const rawById = new Map(raw.map((c) => [c.id, c]));
  const doms = db.prepare('SELECT domain, unitid, status FROM athletics_domains').all(); const domBy = new Map(doms.map((d) => [d.domain.toLowerCase(), d]));
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const links = has('programme_row_links') ? db.prepare('SELECT * FROM programme_row_links').all() : [];
  const linked = new Set(links.map((l) => l.college_id));
  const pkey = (c) => `${c.athletics_entity_id || `ROW:${c.id}`}|${c.sport}`;
  const elig = rc.filter((r) => r.outreach_eligibility === 'YES');
  const truthDiv = (r) => byId.get(r.canonical_college_id)?.division || 'UNKNOWN';
  const legacyDiv = (r) => divByUS.get(`${r.canonical_unitid}|${r.sport}`) || divByUS.get(`${r.legacy_unitid}|${r.sport}`) || 'UNKNOWN';
  const ids = (f) => elig.filter(f).map((r) => r.coach_id).sort();
  const membership = {}; const universe = {};
  for (const d of DIVISIONS) {
    const m = ids((r) => truthDiv(r) === d);
    membership[d] = { eligible: m.length, hash: sha(m.join(',')), ids: m };
    const act = coll.filter((c) => c.division === d && c.active === 1 && !linked.has(c.id));
    const u = [...new Set(act.map(pkey))].sort();
    universe[d] = { rows: coll.filter((c) => c.division === d && c.active === 1).length, logical: u.length, hash: sha(u.join(',')), keys: u };
  }
  const ncaaT = ids((r) => truthDiv(r).startsWith('NCAA')); const ncaaL = ids((r) => legacyDiv(r).startsWith('NCAA'));
  const naiaUniverse = new Set(universe.NAIA.keys);
  const coveredRows = new Set(elig.filter((r) => truthDiv(r) === 'NAIA').map((r) => r.canonical_college_id).filter((id) => byId.get(id)?.active === 1));
  const covered = new Set([...coveredRows].map((id) => pkey(byId.get(id))).filter((k) => naiaUniverse.has(k)));
  const strict = elig.filter((r) => r.corroboration_method === 'STRICT_AUTHORITATIVE_CURRENT');
  const complete = strict.every((r) => { const c = rawById.get(r.coach_id); return c && c.currentness_status === 'CURRENT' && c.currentness_source_url && c.email_seen_on_source_at && c.email_seen_on_source_url && c.email_status === 'verified'; });
  const ownRow = (r) => byNS.get(`${r.legacy_school}|${r.sport}`);
  const integrity = {
    source_domain_conflicts: elig.filter((r) => { const d = r.source_domain && domBy.get(r.source_domain); return d && d.unitid != null && r.canonical_unitid != null && Number(d.unitid) !== Number(r.canonical_unitid); }).length,
    wrong_institution_eligible: strict.filter((r) => r.canonical_college_id !== ownRow(r)?.id).length,
    wrong_sport_eligible: elig.filter((r) => { const c = byId.get(r.canonical_college_id); return !c || c.active !== 1 || c.sport !== r.sport; }).length,
    stale_eligible: elig.filter((r) => rawById.get(r.coach_id)?.currentness_status === 'PROVEN_STALE').length,
    inferred_eligible: elig.filter((r) => rawById.get(r.coach_id)?.email_status !== 'verified').length,
    duplicate_identity: (() => { const m = new Map(); for (const r of elig) { const c = byId.get(r.canonical_college_id); const k = `${c ? pkey(c) : r.canonical_college_id}|${nn(rawById.get(r.coach_id)?.full_name)}`; m.set(k, (m.get(k) || 0) + 1); } return [...m.values()].filter((n) => n > 1).length; })(),
    canonical_round_trip: elig.filter((r) => { const c = byId.get(r.canonical_college_id); if (!c) return true; return r.canonical_entity_id != null && c.athletics_entity_id !== r.canonical_entity_id; }).length,
  };
  const emailSeenHost = Object.fromEntries(elig.map((r) => [r.coach_id, hostOf(rawById.get(r.coach_id)?.email_seen_on_source_url)]));
  return {
    eligible: elig.length, eligible_ids: elig.map((r) => r.coach_id).sort(),
    membership, universe,
    ncaa_truthful_hash: sha(ncaaT.join(',')), ncaa_truthful: ncaaT, ncaa_legacy_hash: sha(ncaaL.join(',')), ncaa_legacy: ncaaL,
    naia: { logical: naiaUniverse.size, active_rows: universe.NAIA.rows, covered: covered.size, covered_keys: [...covered].sort(), uncovered_keys: [...naiaUniverse].filter((k) => !covered.has(k)).sort(), eligible: membership.NAIA.eligible, strict_path: strict.filter((r) => truthDiv(r) === 'NAIA').length, strict_evidence_complete: complete },
    integrity,
    canon: Object.fromEntries(rc.map((r) => [r.coach_id, r.canonical_college_id])),
    eligible_detail: Object.fromEntries(elig.map((r) => [r.coach_id, { college_id: r.canonical_college_id, entity: r.canonical_entity_id, email_seen_host: emailSeenHost[r.coach_id] }])),
  };
}

/** Compact form for reports (drops id lists). */
export function stripMeasure(m) {
  const { eligible_ids, ncaa_truthful, ncaa_legacy, canon, eligible_detail, ...rest } = m;
  return { ...rest,
    membership: Object.fromEntries(Object.entries(m.membership).map(([d, v]) => [d, { eligible: v.eligible, hash: v.hash }])),
    universe: Object.fromEntries(Object.entries(m.universe).map(([d, v]) => [d, { rows: v.rows, logical: v.logical, hash: v.hash }])),
    naia: { ...m.naia, covered_keys: undefined, uncovered_keys: m.naia.uncovered_keys } };
}
