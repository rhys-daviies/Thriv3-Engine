/**
 * ATHLETICS ENTITY IDENTITY — Phase 7D.
 *
 * Three identifiers, three meanings. Keeping them apart is the whole point:
 *
 *   federal_unitid        The entity's OWN official IPEDS UNITID: exactly six digits, issued by NCES.
 *                         NULL when the entity is not itself a federal reporting institution (a
 *                         branch/campus of one, a non-Title-IV school, a foreign school). NEVER a
 *                         synthetic value, NEVER an NCES Global Locator campus code (e.g. 15111102 is
 *                         parent 151111 + suffix 02 — a locator id, not a UNITID), NEVER a guess.
 *                         Unique across entities: one IPEDS institution owns at most one entity that
 *                         carries its UNITID as federal_unitid.
 *
 *   parent_unitid         The IPEDS UNITID of the federal institution a branch/campus entity is
 *                         reported under (IU Columbus -> 151111, Park University Gilbert -> 178721).
 *                         This is the ONLY way two athletics entities share one federal UNITID, and it
 *                         is only ever set when the relationship has been explicitly proven.
 *
 *   athletics_entity_id   Internal, stable, opaque identifier for the actual athletics institution /
 *                         campus that recruits. Two entities can sit under one federal UNITID. It is
 *                         never used as, or copied into, a federal UNITID field.
 *
 * Programme identity = athletics_entity_id + sport (materialised as one active `colleges` row, whose
 * `colleges.id` is the programme id). `colleges.unitid` keeps its legacy meaning and is never
 * rewritten by the entity layer; the invariant is only that it agrees with the entity
 * (colleges.unitid ∈ {entity.federal_unitid, entity.parent_unitid, NULL}).
 */

export const ENTITY_KINDS = Object.freeze(['SINGLE', 'SYSTEM_CAMPUS', 'BRANCH_CAMPUS', 'NON_TITLE_IV', 'FOREIGN', 'UNRESOLVED_FEDERAL']);
const CAMPUS_KINDS = new Set(['SYSTEM_CAMPUS', 'BRANCH_CAMPUS']);

/** A value is a plausible IPEDS UNITID only if it is an integer of exactly six digits. */
export function isFederalUnitid(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return /^[1-9]\d{5}$/.test(s);
}

/** Deterministic entity id for an institution whose UNITID hosts exactly one athletics entity. */
export function singleEntityId(unitid) {
  if (!isFederalUnitid(unitid)) throw new Error(`singleEntityId: not a federal UNITID: ${unitid}`);
  return `AE-U${unitid}`;
}

/** Entity ids for modeled exceptions (campuses, branches, non-Title-IV, foreign). */
export function exceptionEntityId(slug) {
  const s = String(slug || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!s) throw new Error('exceptionEntityId: empty slug');
  return `AE-X-${s}`;
}

/** Full lowercase host of a URL (Wayback-aware), without a leading www. */
export function hostOf(url) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  let host;
  const wb = url.match(/\/(https?):\/\/([^/]+)/);
  if (/web\.archive\.org/i.test(url) && wb) host = wb[2];
  else { try { host = new URL(url).hostname; } catch { return null; } }
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Validate one entity row against the identifier semantics above. Returns a list of problems
 * (empty = valid). Pure: used by the applier's guards and by the permanent validator.
 */
export function entityProblems(e) {
  const p = [];
  if (!e || !e.athletics_entity_id) { p.push('missing athletics_entity_id'); return p; }
  if (!ENTITY_KINDS.includes(e.entity_kind)) p.push(`bad entity_kind ${e.entity_kind}`);
  if (e.federal_unitid != null && !isFederalUnitid(e.federal_unitid)) p.push(`federal_unitid ${e.federal_unitid} is not a 6-digit IPEDS UNITID`);
  if (e.parent_unitid != null && !isFederalUnitid(e.parent_unitid)) p.push(`parent_unitid ${e.parent_unitid} is not a 6-digit IPEDS UNITID`);
  if (CAMPUS_KINDS.has(e.entity_kind)) {
    if (e.parent_unitid == null) p.push('campus/branch entity requires parent_unitid');
    if (e.federal_unitid != null) p.push('campus/branch entity must not claim its parent\'s UNITID as its own federal_unitid');
    if (!e.campus_label) p.push('campus/branch entity requires campus_label');
  }
  if (e.entity_kind === 'SINGLE' && e.federal_unitid == null) p.push('SINGLE entity requires federal_unitid');
  if (['NON_TITLE_IV', 'FOREIGN'].includes(e.entity_kind) && e.federal_unitid != null) p.push(`${e.entity_kind} entity cannot carry a federal_unitid`);
  if (/^AE-U/.test(e.athletics_entity_id) && String(e.athletics_entity_id) !== `AE-U${e.federal_unitid}`) p.push('AE-U id must match its federal_unitid');
  if (!e.provenance) p.push('missing provenance');
  return p;
}

/**
 * Build an in-memory entity index from plain rows. Nothing here reads a database, so the
 * reconciler, the validator and tests share one resolution rule.
 *
 *   entities: [{athletics_entity_id, federal_unitid, parent_unitid, entity_kind, ...}]
 *   colleges: [{id, name, sport, division, unitid, active, athletics_entity_id}]
 *   domains:  [{domain, unitid, status, athletics_entity_id}]
 */
export function buildEntityIndex({ entities = [], colleges = [], domains = [] }) {
  const byId = new Map(entities.map((e) => [e.athletics_entity_id, e]));
  const byFederal = new Map();
  for (const e of entities) if (e.federal_unitid != null) byFederal.set(Number(e.federal_unitid), e.athletics_entity_id);
  const collEntity = new Map(colleges.map((c) => [`${c.name}|${c.sport}`, c.athletics_entity_id || null]));
  const programmes = new Map(); // entity|sport -> [active rows]
  for (const c of colleges) {
    if (!c.athletics_entity_id || c.active !== 1) continue;
    const k = `${c.athletics_entity_id}|${c.sport}`;
    if (!programmes.has(k)) programmes.set(k, []);
    programmes.get(k).push(c);
  }
  const trusted = (d) => ['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status);
  const hostEntity = new Map();
  for (const d of domains) if (d.athletics_entity_id && trusted(d)) hostEntity.set(String(d.domain).toLowerCase(), d.athletics_entity_id);
  return {
    byId,
    /** entity that owns a UNITID as its own federal id (null for systems modeled only as campuses). */
    entityForUnitid: (u) => (u == null ? null : byFederal.get(Number(u)) || null),
    entityOfProgramme: (name, sport) => collEntity.get(`${name}|${sport}`) || null,
    /** the single active programme row for entity+sport, or null if none/ambiguous. */
    programmeFor: (entityId, sport) => { const r = programmes.get(`${entityId}|${sport}`) || []; return r.length === 1 ? r[0] : null; },
    programmeCount: (entityId, sport) => (programmes.get(`${entityId}|${sport}`) || []).length,
    /** entity explicitly owning this exact host (host-level rows only; never a shared root). */
    entityForHost: (host) => (host ? hostEntity.get(String(host).toLowerCase()) || null : null),
    /** true if evidence naming federal unitid u is only the PARENT of entity e (so it cannot pick a campus). */
    isParentOnly: (entityId, u) => { const e = byId.get(entityId); return !!(e && u != null && e.parent_unitid != null && Number(e.parent_unitid) === Number(u)); },
  };
}
