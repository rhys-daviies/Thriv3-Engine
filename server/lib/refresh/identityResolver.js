/**
 * PERMANENT IDENTITY HIERARCHY — Phase 7E. Every refresh observation resolves here.
 *
 * Order (first answer wins; later answers can only CONTRADICT, never override):
 *   1 known athletics_entity_id
 *   2 authoritative athletics host / domain   (host-level entity row, then the registrable
 *                                              domain — but a domain whose UNITID is the
 *                                              PARENT of campus entities can only narrow)
 *   3 canonical institution alias tied to an entity (alias.athletics_entity_id, or its
 *     UNITID when that UNITID hosts exactly one entity)
 *   4 federal UNITID, where truthful (same parent rule)
 *   5 parent relationship, where required     (parent-level evidence + an exact programme
 *                                              name inside that parent's entities)
 *   6 exact canonical programme identity       (exact colleges.name for the sport, incl.
 *                                              linked alternate spellings) — NAME ONLY
 *   7 guarded/manual review                    (constrained fuzzy -> CANDIDATES only)
 *
 * Names alone never establish cross-institution identity: a name-only resolution is
 * flagged `name_only`, and when a stronger step points somewhere else the result is a
 * CONTRADICTION, not a quiet preference. Fuzzy matching never resolves anything.
 * Pure: `createIdentityResolver(context)` takes plain rows (see refresh/context.js).
 */
import { buildEntityIndex, hostOf } from '../athleticsEntity.js';
import { registrableDomain } from '../institutionResolver.js';
import { normaliseInstitution } from '../../../shared/institutionIdentity.js';
import { isHeldDomain } from '../../../shared/heldDomainAdjudications.js';
import { matchSchoolName } from '../coachingImport.js';

export const RESOLUTION = Object.freeze({ RESOLVED: 'RESOLVED', REVIEW: 'REVIEW', WITHHOLD: 'WITHHOLD' });
export const SHARED_PLATFORM_ROOT = /(^|\.)(prestosports\.com|sidearmsports\.com|sidearmstats\.com|wixsite\.com|squarespace\.com|weebly\.com|godaddysites\.com|wordpress\.com|leaguelineup\.com)$/i;
const TRUSTED = new Set(['VERIFIED', 'VERIFIED_ALIAS']);
/** Canonical host key: lower case, no trailing dot, no leading "www.". */
export const normHost = (h) => String(h || '').trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
const CONF = { KNOWN_ENTITY: 1, AUTHORITATIVE_HOST: 0.99, AUTHORITATIVE_DOMAIN: 0.97, ALIAS_ENTITY: 0.95, FEDERAL_UNITID: 0.95, PARENT_PLUS_EXACT_NAME: 0.85, EXACT_PROGRAMME_NAME: 0.8 };

export function createIdentityResolver({ entities = [], colleges = [], domains = [], aliases = [], rowLinks = [], locations = [], releasedHolds = null } = {}) {
  // held-domain releases proven in the database these rows came from (holdRelease.js); none -> every hold stands
  const isHeld = (h) => isHeldDomain(h, releasedHolds);
  const eidx = buildEntityIndex({ entities, colleges, domains });
  const linkOf = new Map(rowLinks.map((l) => [l.college_id, l]));
  const collById = new Map(colleges.map((c) => [c.id, c]));
  const campusesOf = new Map(); // parent unitid -> [campus entity ids]
  for (const e of entities) if (e.parent_unitid != null) (campusesOf.get(Number(e.parent_unitid)) || campusesOf.set(Number(e.parent_unitid), []).get(Number(e.parent_unitid))).push(e.athletics_entity_id);
  const aliasBy = new Map();
  for (const a of aliases) { const k = `${a.alias_key}|${a.conference_scope || '*'}`; (aliasBy.get(k) || aliasBy.set(k, []).get(k)).push(a); }
  const byNameSport = new Map();
  for (const c of colleges) if (c.active === 1 || linkOf.has(c.id)) byNameSport.set(`${c.name}|${c.sport}`, c);
  const namesBySport = new Map();
  for (const c of colleges) if (c.active === 1) (namesBySport.get(c.sport) || namesBySport.set(c.sport, []).get(c.sport)).push(c.name);

  /** UNITID -> {entity} when it names exactly one entity, or {parentOnly:[candidates]} when campuses hang off it. */
  function unitidEntity(u) {
    if (u == null) return null;
    const owner = eidx.entityForUnitid(u);
    const campuses = campusesOf.get(Number(u)) || [];
    if (!campuses.length) return owner ? { entity: owner } : null;
    return { parentOnly: [...new Set([owner, ...campuses].filter(Boolean))] };
  }

  /**
   * Entity a trusted domain row names. Campus athletics hosts are modeled as host-level
   * rows, so an ATHLETICS_SITE registered under a parent UNITID belongs to the parent's own
   * entity (parkathletics.com -> Park University); an INSTITUTION_SITE shared by the parent
   * and its campuses (park.edu, ben.edu) is parent-only evidence and cannot pick one.
   */
  function domainEntity(d) {
    if (d.athletics_entity_id) return { entity: d.athletics_entity_id };
    const ue = unitidEntity(d.unitid);
    if (ue?.parentOnly && d.role === 'ATHLETICS_SITE' && eidx.entityForUnitid(d.unitid)) return { entity: eidx.entityForUnitid(d.unitid) };
    return ue;
  }

  /** The programme row that carries entity+sport: the single active row, else the single non-linked one. */
  function programmeRow(entityId, sport) {
    const rows = colleges.filter((c) => c.athletics_entity_id === entityId && c.sport === sport && c.active === 1);
    if (rows.length === 1) return { row: rows[0] };
    if (!rows.length) {
      const any = colleges.find((c) => c.athletics_entity_id === entityId && c.sport === sport && linkOf.has(c.id));
      if (any) { const canon = collById.get(linkOf.get(any.id).canonical_college_id); if (canon?.active === 1) return { row: canon }; }
      return { row: null, reason: 'NO_ACTIVE_PROGRAMME' };
    }
    const carriers = rows.filter((r) => !linkOf.has(r.id));
    if (carriers.length === 1) return { row: carriers[0] };
    return { row: null, reason: 'AMBIGUOUS_PROGRAMME', candidates: rows.map((r) => r.id) };
  }

  /** The canonical programme row for a colleges row (follows one row link). */
  function canonicalRow(collegeId) {
    const l = linkOf.get(collegeId);
    return collById.get(l ? l.canonical_college_id : collegeId) || null;
  }

  function resolve(obs = {}) {
    const { sport } = obs;
    const evidence = []; let first = null; let parentOnly = null;
    const take = (method, entity, detail) => { evidence.push({ method, entity, detail }); if (!first && entity) first = { method, entity }; };
    const contradictions = [];

    // 1 known entity
    if (obs.athletics_entity_id) {
      if (eidx.byId.has(obs.athletics_entity_id)) take('KNOWN_ENTITY', obs.athletics_entity_id, 'caller-supplied athletics_entity_id');
      else contradictions.push(`unknown athletics_entity_id ${obs.athletics_entity_id}`);
    }
    // 2 authoritative host / domain
    const host = hostOf(obs.source_url);
    if (host && !SHARED_PLATFORM_ROOT.test(host)) {
      const o = ownerOfHost(host);
      if (o.entity) take(o.via === 'EXACT_HOST' ? 'AUTHORITATIVE_HOST' : 'AUTHORITATIVE_DOMAIN', o.entity, `${o.via === 'EXACT_HOST' ? 'host' : 'registrable domain of'} ${host} owned by ${o.entity}`);
      else if (o.parentOnly) { parentOnly = parentOnly || o.parentOnly; evidence.push({ method: 'PARENT_ONLY_DOMAIN', entity: null, detail: `${host} -> parent UNITID: ${o.parentOnly.join(', ')}` }); }
      else if (['WRONG_INSTITUTION', 'AMBIGUOUS', 'HELD', 'CONFLICTING_TWINS'].includes(o.status)) contradictions.push(`source host ${host}: ${o.reason}`);
    } else if (host) evidence.push({ method: 'SHARED_PLATFORM', entity: null, detail: `${host} is a shared hosting root, not an institution` });
    // 3 alias tied to an entity
    const key = normaliseInstitution(obs.raw_name);
    if (key) {
      const hits = [...(aliasBy.get(`${key}|${obs.conference_scope || '*'}`) || []), ...(obs.conference_scope ? aliasBy.get(`${key}|*`) || [] : [])];
      const ents = new Set(); let po = null;
      for (const a of hits) { if (a.athletics_entity_id) ents.add(a.athletics_entity_id); else { const ue = unitidEntity(a.unitid); if (ue?.entity) ents.add(ue.entity); else if (ue?.parentOnly) po = ue.parentOnly; } }
      if (ents.size === 1) take('ALIAS_ENTITY', [...ents][0], `alias "${key}"`);
      else if (ents.size > 1) contradictions.push(`alias "${key}" names ${ents.size} entities`);
      else if (po) { parentOnly = parentOnly || po; evidence.push({ method: 'PARENT_ONLY_ALIAS', entity: null, detail: `alias "${key}" -> parent UNITID` }); }
    }
    // 4 federal UNITID
    if (obs.unitid != null) {
      const ue = unitidEntity(obs.unitid);
      if (ue?.entity) take('FEDERAL_UNITID', ue.entity, `UNITID ${obs.unitid}`);
      else if (ue?.parentOnly) { parentOnly = parentOnly || ue.parentOnly; evidence.push({ method: 'PARENT_ONLY_UNITID', entity: null, detail: `UNITID ${obs.unitid} is the parent of ${ue.parentOnly.join(', ')}` }); }
    }
    // 6 exact canonical programme name (computed now so it can confirm or contradict)
    const exact = obs.raw_name ? byNameSport.get(`${obs.raw_name}|${sport}`) : null;
    const exactEntity = exact?.athletics_entity_id || null;
    // 5 parent relationship: parent-level evidence narrows to its entities; an exact name inside that set picks one
    if (!first && parentOnly) {
      if (exactEntity && parentOnly.includes(exactEntity)) take('PARENT_PLUS_EXACT_NAME', exactEntity, `parent evidence + exact programme name "${obs.raw_name}"`);
      else contradictions.push(`parent-level evidence cannot choose among ${parentOnly.join(', ')}`);
    }
    if (exactEntity) {
      if (!first) take('EXACT_PROGRAMME_NAME', exactEntity, `exact programme name "${obs.raw_name}"`);
      else if (exactEntity !== first.entity) contradictions.push(`name "${obs.raw_name}" is ${exactEntity}'s programme but ${first.method} says ${first.entity}`);
    }
    // any two strong answers disagreeing
    for (const ev of evidence) if (ev.entity && first && ev.entity !== first.entity && ev.method !== 'EXACT_PROGRAMME_NAME') contradictions.push(`${ev.method} says ${ev.entity}, ${first.method} says ${first.entity}`);

    const base = { host, evidence, name_only: first?.method === 'EXACT_PROGRAMME_NAME' };
    if (contradictions.length) return { ...base, decision: RESOLUTION.REVIEW, entity_id: first?.entity || null, college_id: null, method: 'CONTRADICTION', confidence: 0.2, contradictions: [...new Set(contradictions)], candidates: [] };
    if (!first) {
      // 7 constrained fuzzy: candidates only
      const m = obs.raw_name ? matchSchoolName(obs.raw_name, namesBySport.get(sport) || []) : null;
      const candidates = m?.matched_college ? [{ name: m.matched_college, confidence: m.confidence, entity: byNameSport.get(`${m.matched_college}|${sport}`)?.athletics_entity_id || null }] : [];
      return { ...base, decision: candidates.length ? RESOLUTION.REVIEW : RESOLUTION.WITHHOLD, entity_id: null, college_id: null, method: candidates.length ? 'FUZZY_CANDIDATE_ONLY' : 'NONE', confidence: Math.min(0.6, m?.confidence || 0), contradictions: [], candidates };
    }
    const prog = sport ? programmeRow(first.entity, sport) : { row: null, reason: 'NO_SPORT' };
    return { ...base, decision: RESOLUTION.RESOLVED, entity_id: first.entity, college_id: prog.row?.id || null, programme_reason: prog.row ? null : prog.reason, programme_candidates: prog.candidates || [], method: first.method, confidence: CONF[first.method] ?? 0.5, contradictions: [], candidates: [] };
  }

  /**
   * THE host-ownership primitive (Phase 8C.2C). Every ownership answer — hostOwnedBy,
   * entityHosts, sourceOwnedBy and the host step of resolve() — derives from this one
   * function, so they cannot disagree about the same host.
   *
   *   1 normalise: lower case, no trailing dot, no leading "www." — but the rows of BOTH
   *     spellings are kept, so a "www." row and its bare twin are judged together
   *   2 the exact host's own rows decide first (gilbert.parkathletics.com is Park
   *     Gilbert's, never Park's): held, untrusted, or a "www." twin that contradicts
   *     the canonical bare record -> nobody (see judgeRows)
   *   3 only when the exact host has no row of its own does its registrable domain
   *     decide, under the same rules
   *
   * Returns { entity, parentOnly, via, status, reason }: `entity` is set only when one
   * trusted record names exactly one entity. Shared platform roots are owned by nobody.
   */
  const domRows = new Map();
  for (const d of domains) { const k = normHost(d.domain); if (k) (domRows.get(k) || domRows.set(k, []).get(k)).push(d); }
  /** A row's own verdict: who it names when trusted, else the decision it records. */
  const verdictOf = (d) => {
    if (!TRUSTED.has(d.status)) return `UNTRUSTED:${d.status}`;
    const de = domainEntity(d);
    return de?.entity ? `ENTITY:${de.entity}` : de?.parentOnly ? `PARENT:${de.parentOnly.join(',')}` : 'UNRESOLVED';
  };
  /** Statuses that record no claim about the host at all (we could not tell), as opposed to a contrary decision. */
  const NO_CLAIM = new Set(['UNTRUSTED:INSUFFICIENT_EVIDENCE', 'UNTRUSTED:UNREACHABLE']);
  /**
   * Judge the rows of one normalised host. The bare-host row is the canonical record (every
   * writer and every lookup uses bare hosts); a "www." row may only corroborate it:
   *   bare trusted   + www row with no claim                -> the bare row decides
   *   bare trusted   + www row naming anything else         -> CONFLICTING_TWINS (nobody)
   *   bare untrusted + a trusted www row                    -> CONFLICTING_TWINS (nobody):
   *                    an alias spelling never overrides the canonical decision
   *   only a www row                                        -> it is the record
   * Normalisation therefore never turns two disagreeing records into an approval.
   */
  function judgeRows(key, rows, via) {
    const none = (status, reason) => ({ entity: null, parentOnly: null, via, status, reason });
    if (isHeld(key)) return none('HELD', `${key} is held for adjudication`);
    const bare = rows.find((d) => !/^www\./i.test(String(d.domain).trim()));
    const twins = rows.filter((d) => d !== bare);
    const conflict = () => none('CONFLICTING_TWINS', `${rows.map((d) => `${d.domain} ${d.status}`).join(' vs ')} disagree`);
    let v;
    if (!bare) {
      if (new Set(twins.map(verdictOf)).size > 1) return conflict();
      v = verdictOf(twins[0]);
    } else {
      v = verdictOf(bare);
      const others = twins.map(verdictOf);
      if (v.startsWith('UNTRUSTED:') ? others.some((o) => !o.startsWith('UNTRUSTED:')) : others.some((o) => o !== v && !NO_CLAIM.has(o))) return conflict();
    }
    const rec = bare || twins[0];
    if (v.startsWith('UNTRUSTED:')) return none(v.slice(10), `${rec.domain} is ${v.slice(10)}`);
    if (v.startsWith('ENTITY:')) return { entity: v.slice(7), parentOnly: null, via, status: rec.status, reason: null };
    if (v.startsWith('PARENT:')) return { entity: null, parentOnly: v.slice(7).split(','), via, status: rec.status, reason: 'parent UNITID — cannot pick a campus' };
    return none('UNRESOLVED', `${rec.domain} names no entity`);
  }
  const ownerMemo = new Map();
  function ownerOfHost(host) {
    const h = normHost(host);
    if (!ownerMemo.has(h)) ownerMemo.set(h, decideOwner(h));
    return ownerMemo.get(h);
  }
  function decideOwner(h) {
    if (!h) return { entity: null, parentOnly: null, via: null, status: 'NO_HOST', reason: 'no host' };
    if (SHARED_PLATFORM_ROOT.test(h)) return { entity: null, parentOnly: null, via: null, status: 'SHARED_PLATFORM', reason: `${h} is a shared hosting root` };
    if (domRows.has(h)) return judgeRows(h, domRows.get(h), 'EXACT_HOST');
    if (isHeld(h)) return { entity: null, parentOnly: null, via: 'EXACT_HOST', status: 'HELD', reason: `${h} is held for adjudication` };
    const rd = registrableDomain(`https://${h}/`);
    if (rd && rd !== h && domRows.has(rd)) return judgeRows(rd, domRows.get(rd), 'REGISTRABLE_DOMAIN');
    if (rd && rd !== h && isHeld(rd)) return { entity: null, parentOnly: null, via: 'REGISTRABLE_DOMAIN', status: 'HELD', reason: `${rd} is held for adjudication` };
    return { entity: null, parentOnly: null, via: null, status: 'NO_RECORD', reason: `no record for ${h}` };
  }

  /** Hosts (normalised) an entity owns, by ownerOfHost — the same answer hostOwnedBy gives. */
  let hostsByEntity = null;
  function entityHosts(entityId) {
    if (!hostsByEntity) {
      hostsByEntity = new Map();
      for (const k of domRows.keys()) { const e = ownerOfHost(k).entity; if (e) (hostsByEntity.get(e) || hostsByEntity.set(e, new Set()).get(e)).add(k); }
    }
    return new Set(hostsByEntity.get(entityId) || []);
  }

  /** Does this entity own this host? Exactly ownerOfHost(host).entity === entityId. */
  function hostOwnedBy(host, entityId) {
    return !!entityId && ownerOfHost(host).entity === entityId;
  }

  /**
   * Is this URL an official source of this entity (Phase 8B.1)? True if the entity owns the
   * HOST (hostOwnedBy), or if a VERIFIED athletics_source_locations row scopes it: same exact
   * host, path under the prefix on a segment boundary ("/athletics" covers "/athletics/msoc/..."
   * but never "/athleticsfoo" or "/admissions"), and the sport, when the location names one.
   * A location never makes the rest of its host proof of anything.
   *
   * SOURCE ownership is not HOST ownership (Phase 8C.7D). hostOwnedBy answers "which entity owns
   * this whole host?"; this answers "is this exact URL an official source of this entity for this
   * sport?". Every refresh layer (gatherer, classifier) asks this one question.
   *
   * A location only speaks for a host the registry has made no decision about: it never overrides a
   * host that belongs to another entity (or only to a parent), or one that is held, contested,
   * refuted or ambiguous. Those hosts answer through hostOwnedBy alone.
   */
  const LOCATION_HOST_OPEN = new Set(['NO_RECORD', 'INSUFFICIENT_EVIDENCE', 'UNREACHABLE']);
  const locBy = new Map();
  for (const l of locations) if (l.status === 'VERIFIED' && !SHARED_PLATFORM_ROOT.test(l.host)) (locBy.get(l.host) || locBy.set(l.host, []).get(l.host)).push(l);
  function sourceOwnedBy(url, entityId, { sport = null } = {}) {
    let u; try { u = new URL(url); } catch { return false; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (hostOwnedBy(host, entityId)) return true;
    const owner = ownerOfHost(host);
    if (owner.entity || owner.parentOnly || !LOCATION_HOST_OPEN.has(owner.status)) return false;
    const pathLower = u.pathname.toLowerCase();
    return (locBy.get(host) || []).some((l) => l.athletics_entity_id === entityId && (!l.sport || !sport || l.sport === sport)
      && (pathLower === l.path_prefix.toLowerCase() || pathLower.startsWith(`${l.path_prefix.toLowerCase().replace(/\/$/, '')}/`)));
  }
  function entityLocations(entityId) { return locations.filter((l) => l.athletics_entity_id === entityId && l.status === 'VERIFIED'); }

  return { resolve, programmeRow, canonicalRow, ownerOfHost, entityHosts, hostOwnedBy, sourceOwnedBy, entityLocations, unitidEntity, isHeld, index: eidx };
}

/**
 * HOST-OWNERSHIP INVARIANT (Phase 8C.2C). For every entity a trusted or held athletics_domains
 * row could name (its athletics_entity_id, the entity owning its UNITID, and the campuses under
 * that UNITID) and every host entityHosts reports, the two canonical ownership APIs must agree:
 *   entityHosts(entity).has(host)  <=>  hostOwnedBy(host, entity)
 * Returns the disagreeing "entity host" pairs; the monitor fails HARD on any. Pure.
 */
export function hostOwnershipDisagreements({ resolver, domains = [], entities = [] }) {
  const campuses = new Map();
  for (const e of entities) if (e.parent_unitid != null) (campuses.get(Number(e.parent_unitid)) || campuses.set(Number(e.parent_unitid), []).get(Number(e.parent_unitid))).push(e.athletics_entity_id);
  const pairs = new Set();
  for (const d of domains) {
    if (!TRUSTED.has(d.status) && !(resolver.isHeld ? resolver.isHeld(d.domain) : isHeldDomain(d.domain))) continue;
    for (const e of [d.athletics_entity_id, resolver.index.entityForUnitid(d.unitid), ...(campuses.get(Number(d.unitid)) || [])]) if (e) pairs.add(`${e}\t${normHost(d.domain)}`);
  }
  for (const e of entities) for (const h of resolver.entityHosts(e.athletics_entity_id)) pairs.add(`${e.athletics_entity_id}\t${h}`);
  const out = [];
  for (const p of pairs) {
    const [e, h] = p.split('\t');
    const listed = resolver.entityHosts(e).has(h); const owned = resolver.hostOwnedBy(h, e);
    if (listed !== owned) out.push(`${h} ${e} (entityHosts ${listed}, hostOwnedBy ${owned})`);
  }
  return out.sort();
}
