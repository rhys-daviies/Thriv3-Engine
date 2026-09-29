#!/usr/bin/env node
/**
 * PHASE 7D — canonical identity invariant. PERMANENT validator.
 *
 * HARD invariants (any violation fails, exit 1):
 *   H1  every ACTIVE programme row (colleges) resolves to exactly one existing athletics entity;
 *   H2  every entity satisfies the identifier semantics (server/lib/athleticsEntity.js#entityProblems):
 *       federal_unitid is a real six-digit IPEDS UNITID or NULL — never synthetic, never a
 *       College Navigator location code; campuses/branches carry a parent + label;
 *   H3  a federal UNITID is owned by at most one entity (as its own federal_unitid);
 *   H4  colleges.unitid, when set, is six digits and agrees with its entity (its federal_unitid or,
 *       for an explicitly modeled campus/branch, its parent_unitid) — unless the entity is a
 *       documented KNOWN_WRONG_UNITID;
 *   H5  two entities share a UNITID only through an explicit, proven parent_unitid relationship;
 *   H6  an (entity, sport) has at most one active programme row, except rows documented in
 *       shared/athleticsEntityExceptions.json with a reason;
 *   H7  an entity-owned domain references a real entity, agrees with it on UNITID, and is never a
 *       shared-platform root;
 *   H8  a SINGLE entity whose federal_unitid appears on no colleges row must carry researched
 *       provenance (not the default rule).
 * DOCUMENTED (reported, not failed): allowlisted duplicates; stale allowlist entries.
 * An unmigrated database (no athletics_entities rows) reports MODEL_ABSENT and exits 0.
 *
 *   node server/scripts/validateAthleticsEntityIdentity.js --db <path> [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { entityProblems, isFederalUnitid } from '../lib/athleticsEntity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED_ROOT = /(^|\.)(prestosports\.com|sidearmsports\.com|wixsite\.com|squarespace\.com|weebly\.com|godaddysites\.com)$/i;
export const EXCEPTIONS_PATH = path.resolve(__dirname, '../../shared/athleticsEntityExceptions.json');

export function loadExceptions(p = EXCEPTIONS_PATH) {
  if (!fs.existsSync(p)) return { duplicate_programmes: [], known_wrong_unitid_entities: [] };
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { duplicate_programmes: j.duplicate_programmes || [], known_wrong_unitid_entities: j.known_wrong_unitid_entities || [] };
}

export function validateEntityIdentity(db, { allowlist, knownWrongUnitid } = {}) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const collCols = new Set(db.prepare('PRAGMA table_info(colleges)').all().map((c) => c.name));
  if (!has('athletics_entities') || !collCols.has('athletics_entity_id') || !db.prepare('SELECT 1 FROM athletics_entities LIMIT 1').get()) {
    return { status: 'MODEL_ABSENT', hard: [], documented: [], warnings: [], counts: {} };
  }
  const ex = loadExceptions();
  const allow = allowlist ?? ex.duplicate_programmes;
  const wrongU = new Set(knownWrongUnitid ?? ex.known_wrong_unitid_entities);
  const hard = []; const documented = []; const warnings = [];
  const ents = db.prepare('SELECT * FROM athletics_entities').all();
  const byId = new Map(ents.map((e) => [e.athletics_entity_id, e]));
  const rows = db.prepare('SELECT id, name, sport, division, unitid, active, athletics_entity_id FROM colleges').all();

  for (const e of ents) for (const p of entityProblems(e)) hard.push(`H2 ${e.athletics_entity_id}: ${p}`);
  const fed = new Map();
  for (const e of ents) if (e.federal_unitid != null) { if (fed.has(e.federal_unitid)) hard.push(`H3 UNITID ${e.federal_unitid} owned by ${fed.get(e.federal_unitid)} and ${e.athletics_entity_id}`); else fed.set(e.federal_unitid, e.athletics_entity_id); }

  for (const r of rows) {
    const e = r.athletics_entity_id ? byId.get(r.athletics_entity_id) : null;
    if (r.active === 1 && !r.athletics_entity_id) { hard.push(`H1 active programme without entity: ${r.name} [${r.sport}]`); continue; }
    if (r.athletics_entity_id && !e) { hard.push(`H1 ${r.name} [${r.sport}] references missing entity ${r.athletics_entity_id}`); continue; }
    if (r.unitid != null && !isFederalUnitid(r.unitid)) hard.push(`H4 ${r.name} [${r.sport}] colleges.unitid ${r.unitid} is not a six-digit UNITID`);
    if (e && r.unitid != null && Number(r.unitid) !== Number(e.federal_unitid) && Number(r.unitid) !== Number(e.parent_unitid)) {
      if (wrongU.has(e.athletics_entity_id)) documented.push(`KNOWN_WRONG_UNITID ${r.name} [${r.sport}] ${r.unitid} (${e.athletics_entity_id})`);
      else hard.push(`H4 ${r.name} [${r.sport}] colleges.unitid ${r.unitid} disagrees with entity ${e.athletics_entity_id} (federal ${e.federal_unitid}, parent ${e.parent_unitid})`);
    }
  }
  // H5: every UNITID whose rows span >1 entity must be explained by federal owner + parent links
  const entsByUnitid = new Map();
  for (const r of rows) { if (r.unitid == null || !r.athletics_entity_id) continue; const s = entsByUnitid.get(r.unitid) || new Set(); s.add(r.athletics_entity_id); entsByUnitid.set(r.unitid, s); }
  for (const [u, s] of entsByUnitid) {
    if (s.size < 2) continue;
    for (const id of s) { const e = byId.get(id); if (!e || wrongU.has(id)) continue; const ok = Number(e.federal_unitid) === Number(u) || (Number(e.parent_unitid) === Number(u) && ['SYSTEM_CAMPUS', 'BRANCH_CAMPUS'].includes(e.entity_kind)); if (!ok) hard.push(`H5 UNITID ${u} shared by ${[...s].join(', ')} without a proven parent link for ${id}`); }
  }
  // H6 duplicate programmes
  const allowKey = new Map(allow.map((a) => [a.college_ids.slice().sort().join(','), a]));
  const byES = new Map();
  for (const r of rows) { if (r.active !== 1 || !r.athletics_entity_id) continue; const k = `${r.athletics_entity_id}|${r.sport}`; (byES.get(k) || byES.set(k, []).get(k)).push(r); }
  const seenAllow = new Set();
  for (const [k, list] of byES) {
    if (list.length < 2) continue;
    const ids = list.map((x) => x.id).sort().join(',');
    const a = allowKey.get(ids);
    if (a) { documented.push(`${a.class} ${k}: ${list.map((x) => x.name).join(' | ')}`); seenAllow.add(ids); }
    else hard.push(`H6 duplicate active programme ${k}: ${list.map((x) => `${x.name} [${x.division}]`).join(' | ')}`);
  }
  for (const a of allow) { const ids = a.college_ids.slice().sort().join(','); if (!seenAllow.has(ids)) warnings.push(`stale allowlist entry (no longer a duplicate): ${a.key}`); }
  // H7 domains
  const domCols = new Set(has('athletics_domains') ? db.prepare('PRAGMA table_info(athletics_domains)').all().map((c) => c.name) : []);
  if (domCols.has('athletics_entity_id')) {
    for (const d of db.prepare('SELECT domain, unitid, status, athletics_entity_id FROM athletics_domains WHERE athletics_entity_id IS NOT NULL').all()) {
      const e = byId.get(d.athletics_entity_id);
      if (!e) { hard.push(`H7 domain ${d.domain} -> missing entity ${d.athletics_entity_id}`); continue; }
      if (SHARED_ROOT.test(d.domain)) hard.push(`H7 shared-platform root ${d.domain} owned by an entity`);
      if (d.unitid != null && Number(d.unitid) !== Number(e.federal_unitid) && Number(d.unitid) !== Number(e.parent_unitid)) hard.push(`H7 domain ${d.domain} unitid ${d.unitid} disagrees with entity ${e.athletics_entity_id}`);
    }
  }
  // H8
  const rowUnitids = new Set(rows.filter((r) => r.unitid != null).map((r) => Number(r.unitid)));
  for (const e of ents) if (e.entity_kind === 'SINGLE' && !rowUnitids.has(Number(e.federal_unitid)) && /^default/.test(e.provenance || '')) hard.push(`H8 ${e.athletics_entity_id} federal_unitid ${e.federal_unitid} is on no colleges row and has only default provenance`);

  const activeRows = rows.filter((r) => r.active === 1);
  const counts = {
    entities: ents.length,
    by_kind: ents.reduce((a, e) => { a[e.entity_kind] = (a[e.entity_kind] || 0) + 1; return a; }, {}),
    active_programme_rows: activeRows.length,
    active_rows_with_entity: activeRows.filter((r) => r.athletics_entity_id).length,
    distinct_active_programmes: new Set(activeRows.map((r) => `${r.athletics_entity_id}|${r.sport}`)).size,
    entities_without_federal_unitid: ents.filter((e) => e.federal_unitid == null).length,
    modeled_shared_unitids: [...entsByUnitid.values()].filter((s) => s.size > 1).length,
  };
  return { status: hard.length ? 'FAIL' : 'PASS', hard, documented, warnings, counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--db'); const dbPath = i > -1 ? process.argv[i + 1] : null;
  if (!dbPath) { console.error('Give --db.'); process.exit(2); }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const r = validateEntityIdentity(db); db.close();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`athletics-entity identity: ${r.status}`); console.log(JSON.stringify(r.counts));
    r.hard.forEach((h) => console.log('  HARD', h)); r.documented.forEach((d) => console.log('  DOC ', d)); r.warnings.forEach((w) => console.log('  WARN', w));
  }
  process.exit(r.status === 'FAIL' ? 1 : 0);
}
