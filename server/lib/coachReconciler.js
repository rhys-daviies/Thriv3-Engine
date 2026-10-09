/**
 * COACH RECONCILIATION — the outreach-eligibility engine, as a library (Phase 8D.3C).
 *
 * Extracted VERBATIM from server/scripts/reconcileCoaches.js so the same rules can be evaluated
 * in-process on any connection — including one holding an uncommitted transaction, which is how
 * the composite correction writer measures eligibility between its stages without letting any
 * other process observe an intermediate state. There is exactly one eligibility engine: the CLI
 * calls this function and writes its rows to `coaches_reconciled`; nothing here writes.
 *
 * `scope` is the strict-authoritative activation scope (the CLI passes STRICT_CORROB_SCOPE,
 * default 'NAIA'): a comma list of divisions, 'ALL', or 'OFF'.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResolver, registrableDomain, emailDomain, DECISION } from './institutionResolver.js';
import { normalizeForMatch } from './coachingImport.js';
import { isHeldDomain } from '../../shared/heldDomainAdjudications.js';
import { releasedHeldDomains } from './refresh/holdRelease.js';
import { buildEntityIndex, hostOf } from './athleticsEntity.js';
import { qualifyingAbsence, ABSENCE_REASON } from './emailPublication.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Reconcile every coach on `db`. Read-only. Returns one coaches_reconciled-shaped row per coach. */
export function reconcileCoachRows(db, { scope = 'NAIA' } = {}) {
  const all = (s) => db.prepare(s).all();
  // Defensive column selection: minimal test fixtures may omit newer columns, so
  // alias any absent one rather than failing the query.
  const hasCols = (tbl) => new Set(db.prepare(`PRAGMA table_info(${tbl})`).all().map((c) => c.name));
  const collCols = hasCols('colleges');
  const colleges = all(`SELECT ${collCols.has('id') ? 'id' : 'NULL AS id'}, name, sport, unitid, state, division, ${collCols.has('active') ? 'active' : '1 AS active'}, ${collCols.has('athletics_entity_id') ? 'athletics_entity_id' : 'NULL AS athletics_entity_id'} FROM colleges`);
  const domCols = hasCols('athletics_domains');
  const domains = all(`SELECT domain, unitid, status, ${domCols.has('athletics_entity_id') ? 'athletics_entity_id' : 'NULL AS athletics_entity_id'} FROM athletics_domains`);
  const aliases = all('SELECT alias_key, unitid, alias_type FROM institution_aliases');
  const coachCols = hasCols('coaches');
  const coachSel = ['id', 'full_name', 'email', 'school', 'sport', 'position_title', 'email_status', 'email_source_url', 'currentness_status', 'currentness_source_url', 'email_seen_on_source_at', 'email_seen_on_source_url']
    .map((c) => (coachCols.has(c) ? c : `NULL AS ${c}`)).join(', ');
  const coaches = all(`SELECT ${coachSel} FROM coaches`);
  // PHASE 8D.3D — positive email absence (server/lib/emailPublication.js). No table, or no rows: inert.
  const absenceByCoach = new Map();
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coach_email_absence_observations'").get()) {
    for (const o of all('SELECT * FROM coach_email_absence_observations')) (absenceByCoach.get(o.coach_id) || absenceByCoach.set(o.coach_id, []).get(o.coach_id)).push(o);
  }

  // PHASE 7B.2 — strict authoritative corroboration activation scope. The evidence model
  // is division-agnostic, but activation is gated conservatively (default NAIA-only) so no
  // NCAA behaviour can change. `STRICT_CORROB_SCOPE`: comma list of divisions, 'ALL', or
  // 'OFF' (disables the alternative path entirely — the pre-7B.2 behaviour).
  const STRICT_SCOPE_RAW = scope;
  const STRICT_OFF = STRICT_SCOPE_RAW === 'OFF';
  const STRICT_ALL = STRICT_SCOPE_RAW === 'ALL';
  const STRICT_DIVS = new Set(STRICT_SCOPE_RAW.split(',').map((s) => s.trim()));
  const inStrictScope = (division) => !STRICT_OFF && (STRICT_ALL || STRICT_DIVS.has(division));

  // duplicate-UNITID canonical map (identity canonicalisation, no physical merge)
  const dupMap = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/validation/generated/duplicate_unitid_canonical_map.json'), 'utf8'));
  const canonByDupName = new Map(dupMap.map((d) => [`${d.duplicate_name}|${d.sport}`, d.canonical_name]));
  const collByNS = new Map(colleges.map((c) => [`${c.name}|${c.sport}`, c]));
  const canonName = (name, sport) => canonByDupName.get(`${name}|${sport}`) || name;

  // coach_seasons identity corroboration: (school,sport) -> Set(normname)
  const nn = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const csBySchool = new Map();
  for (const r of all("SELECT school, sport, coach_name FROM coach_seasons WHERE trim(coalesce(coach_name,'')) != ''")) {
    const k = `${r.school}|${r.sport}`; if (!csBySchool.has(k)) csBySchool.set(k, new Set()); csBySchool.get(k).add(nn(r.coach_name));
  }
  // Domains INDEPENDENTLY scraped by coach_seasons (from each school's own site).
  // This is the only registry-corruption-immune trust signal: athletics_domains
  // is systematically wrong for ambiguous names (e.g. every "Columbia" email/site
  // domain -> Columbia University 190150), so a REASSIGN or KEEP is only trusted
  // for OUTREACH when coach_seasons corroborates it — by coach identity, or by a
  // source domain coach_seasons actually scraped.
  const csTrustedDomains = new Set();
  for (const r of all("SELECT source_url FROM coach_seasons WHERE source_url LIKE 'http%'")) {
    const d = registrableDomain(r.source_url); if (d) csTrustedDomains.add(d);
  }
  const csHas = (school, sport, name) => csBySchool.get(`${school}|${sport}`)?.has(nn(name)) || false;
  const domByName = new Map(domains.map((d) => [String(d.domain).toLowerCase(), d]));
  // held-domain releases proven in THIS database (refresh/holdRelease.js); none -> every hold stands
  const releasedHolds = releasedHeldDomains(db);
  const isHeld = (d) => isHeldDomain(d, releasedHolds);
  const resolver = createResolver({ colleges, domains, aliases, releasedHolds });
  const uni = (name, sport) => collByNS.get(`${name}|${sport}`)?.unitid ?? null;
  const nameByUnitid = new Map();
  for (const c of colleges) if (c.unitid != null) nameByUnitid.set(`${c.unitid}|${c.sport}`, canonName(c.name, c.sport));

  // ---- PHASE 7D athletics-entity identity (additive) ----
  // With no `athletics_entities` rows this is inert and every coach takes the legacy
  // UNITID path exactly as before. When populated, programmes inside the strict
  // activation scope (default NAIA) resolve by athletics entity instead of UNITID, so
  // a branch campus, a non-Title-IV school, or one of several campuses sharing a
  // UNITID is its own identity. Outside the scope (NCAA) nothing changes.
  const hasEntityTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='athletics_entities'").get();
  const entities = hasEntityTable ? all('SELECT * FROM athletics_entities') : [];
  const ENTITY_MODEL = entities.length > 0 && colleges.some((c) => c.athletics_entity_id);
  const eidx = buildEntityIndex({ entities, colleges, domains });
  // hosts coach_seasons itself scraped, at full-host granularity: a branch on a
  // subdomain (gilbert.parkathletics.com) is not corroborated by a scrape of the
  // parent's parkathletics.com.
  const csTrustedHosts = new Set();
  for (const r of all("SELECT source_url FROM coach_seasons WHERE source_url LIKE 'http%'")) { const h = hostOf(r.source_url); if (h) csTrustedHosts.add(h); }
  const activeByUS = new Map();
  for (const c of colleges) { if (c.unitid == null || c.active !== 1) continue; const k = `${c.unitid}|${c.sport}`; if (!activeByUS.has(k)) activeByUS.set(k, []); activeByUS.get(k).push(c); }
  const collByNameSport = (name, sport) => (name ? collByNS.get(`${name}|${sport}`) : null);
  const collById = new Map(colleges.filter((c) => c.id).map((c) => [c.id, c]));

  /** Canonical programme (colleges.id) for a legacy-path result. KEEP stays on its own row. */
  function legacyCanonicalCollegeId(co, r) {
    const own = collByNS.get(`${co.school}|${co.sport}`);
    // resolved to its own institution (including a null==null KEEP on a no-UNITID row): stays on its row
    if (own && r.canonical_unitid === r.legacy_unitid && r.classification !== 'REVIEW') return own.id ?? null;
    if (r.canonical_unitid == null) return null;
    const at = activeByUS.get(`${r.canonical_unitid}|${co.sport}`) || [];
    if (at.length === 1) return at[0].id ?? null;
    return collByNameSport(r.canonical_school, co.sport)?.id ?? null;
  }

  function reconcile(co) {
    const progRow = collByNS.get(`${co.school}|${co.sport}`);
    const useEntity = ENTITY_MODEL && progRow?.athletics_entity_id && inStrictScope(progRow.division);
    let r;
    if (useEntity) r = reconcileEntity(co, progRow);
    else {
      const l = reconcileLegacy(co);
      const ccid = legacyCanonicalCollegeId(co, l);
      const crow = ccid ? collById.get(ccid) : null;
      r = { ...l, canonical_college_id: ccid, canonical_entity_id: crow?.athletics_entity_id ?? null };
    }
    return requireActiveCanonical(r);
  }

  /**
   * Phase 7E: a coach is never outreach-eligible at a programme that does not exist NOW.
   * The canonical programme row must be present and active — a superseded division row
   * (Shawnee State's NAIA row after its 2026 move to NCAA D2), a retired phantom row or a
   * deactivated programme keeps its coaches as history, never as current contacts. Uniform
   * over both paths; on the pre-7E corpus it changes nothing (0 eligible coaches sat on an
   * inactive canonical row). A registry without row ids is left exactly as before.
   */
  function requireActiveCanonical(r) {
    if (r.outreach_eligibility !== 'YES') return r;
    const c = r.canonical_college_id ? collById.get(r.canonical_college_id) : null;
    if (!c || (c.active === 1 && c.sport === r.sport)) return r; // unknown row (legacy/id-less registry): unchanged
    return { ...r, outreach_eligibility: 'NO', ineligible_reason: 'canonical programme inactive (superseded/retired/discontinued)' };
  }

  /**
   * Entity-path reconciliation. Same evidence order, same eligibility rules and the
   * same strict-authoritative conditions as the legacy path, with ONE identity key
   * swapped: athletics entity for UNITID. Two extra protections follow from it:
   *   - an email/site domain that proves only the PARENT institution (ben.edu for
   *     Benedictine Mesa, park.edu for Park Gilbert) cannot move a branch coach into
   *     the parent's programme — it is parent-only evidence, never a reassignment;
   *   - an entity-owned host (gilbert.parkathletics.com) is read at full-host
   *     granularity, before the registrable domain it shares with its parent.
   */
  function reconcileEntity(co, progRow) {
    const curEntity = progRow.athletics_entity_id;
    const curUnitid = progRow.unitid ?? null;
    const host = hostOf(co.email_source_url);
    const sdom = registrableDomain(co.email_source_url);
    const edom = emailDomain(co.email);
    const trusted = (d) => d && ['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status);
    const read = (key, kind) => {
      if (!key) return null;
      if (kind === 'SOURCE' && host && !isHeld(host)) { const he = eidx.entityForHost(host); if (he) return { entity: he, viaHost: true, method: 'SOURCE_HOST_ENTITY', note: `${host}→${he}` }; }
      if (isHeld(key) || !domByName.has(key)) return null;
      const d = domByName.get(key);
      if (trusted(d)) {
        if (d.athletics_entity_id) return { entity: d.athletics_entity_id, method: `${kind}_DOMAIN_ENTITY`, note: `${key}→${d.athletics_entity_id}` };
        if (d.unitid == null) return null;
        if (eidx.isParentOnly(curEntity, d.unitid)) return { parentOnly: true, method: `${kind}_DOMAIN_PARENT_ONLY`, note: `${key}→${d.unitid} is the parent of ${curEntity}; cannot identify a campus` };
        const e = eidx.entityForUnitid(d.unitid);
        if (e) return { entity: e, method: kind === 'SOURCE' ? 'SOURCE_DOMAIN' : 'EMAIL_DOMAIN', note: `${key}→${d.unitid}→${e}` };
        return { unmodeled: true, method: `${kind}_DOMAIN_NO_ENTITY`, note: `${key}→${d.unitid}: no athletics entity owns this UNITID` };
      }
      if (kind === 'SOURCE' && ['WRONG_INSTITUTION', 'AMBIGUOUS'].includes(d.status)) return { contradiction: true, method: `DOMAIN_${d.status}`, note: `${key} ${d.status}` };
      return null;
    };
    const src = read(sdom, 'SOURCE');
    let ev = src && (src.entity || src.contradiction) ? src : null;
    const em = ev ? null : read(edom, 'EMAIL');
    if (!ev && em?.entity) ev = em;
    const parentOnly = !!(src?.parentOnly || em?.parentOnly);
    let evEntity = ev?.entity ?? null;
    let method = ev?.method ?? (parentOnly ? 'PARENT_ONLY_EVIDENCE' : (src?.method || em?.method || null));
    let evNote = ev?.note ?? (src?.note || em?.note || '');
    const nameAt = (ent) => (ent === curEntity ? progRow.name : eidx.programmeFor(ent, co.sport)?.name) ?? null;
    const idAtCurrent = csHas(co.school, co.sport, co.full_name);
    const idAtEvidence = evEntity != null && csHas(nameAt(evEntity), co.sport, co.full_name);

    let cls, inst;
    if (evEntity != null) {
      if (evEntity === curEntity) { cls = 'KEEP'; inst = DECISION.RESOLVED; }
      else if (eidx.programmeFor(evEntity, co.sport)) { cls = 'REASSIGN'; inst = DECISION.RESOLVED; }
      else { cls = 'REVIEW'; inst = DECISION.REVIEW; method = `${method}_NO_TARGET_PROGRAMME`; }
    } else if (ev?.contradiction) {
      cls = 'REVIEW'; inst = DECISION.REVIEW;
    } else if (idAtCurrent) {
      cls = 'KEEP'; inst = DECISION.RESOLVED; method = 'COACH_SEASONS'; evNote = 'identity corroborated at current school'; evEntity = curEntity;
    } else {
      cls = 'WITHHOLD'; inst = DECISION.WITHHOLD; method = method || 'NONE';
    }
    const resolvedEntity = cls === 'REVIEW' ? null : (evEntity ?? curEntity);
    const resProg = resolvedEntity == null ? null : (resolvedEntity === curEntity ? progRow : eidx.programmeFor(resolvedEntity, co.sport));
    const resEnt = resolvedEntity ? eidx.byId.get(resolvedEntity) : null;
    const resolvedUnitid = resEnt ? (resEnt.federal_unitid ?? null) : null;
    const resolvedName = resProg ? resProg.name : null;
    const identityStatus = (evEntity != null && (idAtEvidence || idAtCurrent)) || idAtCurrent ? 'VERIFIED' : 'UNVERIFIED';
    const emailStatus = (co.email_status || 'unknown');
    const hasRealEmail = co.email && co.email.includes('@') && co.email.toUpperCase() !== 'N/A';
    const isTeam = !co.full_name || !co.full_name.trim();
    const provenStale = co.currentness_status === 'PROVEN_STALE';
    const emailAbsent = !!qualifyingAbsence(absenceByCoach.get(co.id), co, progRow);

    // the entity named by the SOURCE page itself (never the email domain)
    const srcEntity = src?.entity ?? null;
    const srcScrapedByCoachSeasons = src?.viaHost ? csTrustedHosts.has(host) : (!!sdom && csTrustedDomains.has(sdom));
    const sourceDomainTrusted = srcEntity != null && srcScrapedByCoachSeasons && srcEntity === resolvedEntity;
    let corroborationMethod = null;
    if (sourceDomainTrusted) corroborationMethod = 'COACH_SEASONS_SOURCE_DOMAIN';
    else if (idAtEvidence || idAtCurrent) corroborationMethod = 'COACH_SEASONS_IDENTITY';
    const strictDomainOk = srcEntity != null && srcEntity === resolvedEntity;
    const strictAuthoritative = !corroborationMethod
      && inStrictScope(progRow.division)
      && inst === DECISION.RESOLVED
      && cls === 'KEEP'
      && resolvedEntity != null && resolvedEntity === curEntity
      && progRow.active === 1
      && co.currentness_status === 'CURRENT'
      && !!co.currentness_source_url
      && strictDomainOk
      && !!co.email_seen_on_source_at
      && !!co.email_seen_on_source_url
      && emailStatus === 'verified'
      && hasRealEmail && !isTeam
      && !provenStale;
    if (strictAuthoritative) corroborationMethod = 'STRICT_AUTHORITATIVE_CURRENT';

    const corroborated = corroborationMethod != null;
    const eligible = inst === DECISION.RESOLVED && emailStatus === 'verified' && hasRealEmail && !isTeam
      && ['KEEP', 'REASSIGN'].includes(cls) && corroborated && !provenStale && !emailAbsent && !!resProg;
    let ineligibleReason = '';
    if (!eligible) {
      if (provenStale) ineligibleReason = 'coach proven no longer current (PROVEN_STALE)';
      else if (emailAbsent) ineligibleReason = ABSENCE_REASON;
      else if (!hasRealEmail || isTeam) ineligibleReason = 'no per-person address';
      else if (emailStatus !== 'verified') ineligibleReason = `email ${emailStatus}`;
      else if (inst !== DECISION.RESOLVED) ineligibleReason = parentOnly && inst === DECISION.WITHHOLD ? 'institution WITHHOLD (parent-only evidence; campus not proven)' : `institution ${inst}`;
      else if (!corroborated) ineligibleReason = `${cls} not corroborated (coach_seasons or strict-authoritative)`;
      else ineligibleReason = cls;
    }
    return {
      coach_id: co.id, coach_name: co.full_name, email: co.email, title: co.position_title, sport: co.sport,
      legacy_school: co.school, legacy_unitid: curUnitid,
      canonical_unitid: resolvedUnitid, canonical_school: resolvedName,
      source_url: co.email_source_url, source_domain: sdom, email_domain: edom,
      classification: cls, institution_resolution_status: inst,
      coach_identity_status: identityStatus, email_verification_status: emailStatus,
      outreach_eligibility: eligible ? 'YES' : 'NO', ineligible_reason: ineligibleReason,
      resolution_method: method || 'NONE', corroboration_method: corroborationMethod || 'NONE', evidence: evNote,
      reassigned: cls === 'REASSIGN' ? 1 : 0,
      canonicalized: resolvedName && resolvedName !== co.school ? 1 : 0,
      canonical_college_id: resProg?.id ?? null, canonical_entity_id: resolvedEntity,
    };
  }

  function reconcileLegacy(co) {
    const curUnitid = uni(co.school, co.sport);
    const sdom = registrableDomain(co.email_source_url);
    const edom = emailDomain(co.email);
    // authoritative institution evidence: source-url domain first
    let evUnitid = null, method = null, evNote = '';
    if (sdom && domByName.has(sdom)) {
      const d = domByName.get(sdom);
      if (!isHeld(sdom) && ['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status) && d.unitid != null) { evUnitid = d.unitid; method = 'SOURCE_DOMAIN'; evNote = `${sdom}→${d.unitid}`; }
      else if (['WRONG_INSTITUTION', 'AMBIGUOUS'].includes(d.status)) { method = `DOMAIN_${d.status}`; evNote = `${sdom} ${d.status}`; }
    }
    if (evUnitid == null && !method && edom && domByName.has(edom)) {
      const d = domByName.get(edom);
      if (!isHeld(edom) && ['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status) && d.unitid != null) { evUnitid = d.unitid; method = 'EMAIL_DOMAIN'; evNote = `${edom}→${d.unitid} (email)`; }
    }
    const idAtCurrent = csHas(co.school, co.sport, co.full_name);
    const idAtEvidence = evUnitid != null && csHas(nameByUnitid.get(`${evUnitid}|${co.sport}`), co.sport, co.full_name);

    let cls, inst; // classification + institution_resolution_status
    if (evUnitid != null) {
      if (curUnitid != null && evUnitid === curUnitid) { cls = 'KEEP'; inst = DECISION.RESOLVED; }
      else { cls = 'REASSIGN'; inst = DECISION.RESOLVED; }
    } else if (method === 'DOMAIN_WRONG_INSTITUTION' || method === 'DOMAIN_AMBIGUOUS') {
      cls = 'REVIEW'; inst = DECISION.REVIEW;
    } else if (idAtCurrent) { // no domain evidence but identity corroborated by independent coach_seasons
      cls = 'KEEP'; inst = DECISION.RESOLVED; method = 'COACH_SEASONS'; evNote = 'identity corroborated at current school';
      evUnitid = curUnitid;
    } else {
      cls = 'WITHHOLD'; inst = DECISION.WITHHOLD; method = method || 'NONE';
    }

    // For REVIEW cases where the source domain affirmatively points AWAY from the
    // current school (WRONG_INSTITUTION/AMBIGUOUS) we do not claim the legacy
    // institution — the canonical is unknown pending review.
    const domainSaysElsewhere = method === 'DOMAIN_WRONG_INSTITUTION' || method === 'DOMAIN_AMBIGUOUS';
    const resolvedUnitid = evUnitid ?? (domainSaysElsewhere ? null : curUnitid);
    const resolvedName = resolvedUnitid != null ? (nameByUnitid.get(`${resolvedUnitid}|${co.sport}`) || co.school) : null;
    const identityStatus = (evUnitid != null && (idAtEvidence || idAtCurrent)) || idAtCurrent ? 'VERIFIED' : 'UNVERIFIED';
    const emailStatus = (co.email_status || 'unknown');
    const hasRealEmail = co.email && co.email.includes('@') && co.email.toUpperCase() !== 'N/A';
    const isTeam = !co.full_name || !co.full_name.trim();

    // OUTREACH ELIGIBILITY — conservative and registry-corruption-immune.
    // Requires: institution RESOLVED to a canonical UNITID, email meets the
    // approved 'verified' standard, a real per-person address, actionable class,
    // AND the institution is corroborated by the INDEPENDENT coach_seasons scrape
    // (coach identity at the resolved school, or a source domain coach_seasons
    // itself scraped that resolves to the same UNITID). This is what blocks the
    // Columbia-College->Columbia-University false positive: columbiacougars.com is
    // a wrong VERIFIED_ALIAS never seen in coach_seasons, so it cannot make a
    // coach eligible. Inferred/generic emails are never upgraded.
    const sourceDomainTrusted = sdom && csTrustedDomains.has(sdom)
      && ['VERIFIED', 'VERIFIED_ALIAS'].includes(domByName.get(sdom)?.status)
      && domByName.get(sdom)?.unitid === resolvedUnitid;
    // Currentness fails outreach CLOSED only when a coach is PROVEN_STALE. UNKNOWN
    // (the default for every un-checked row) never disqualifies here.
    const provenStale = co.currentness_status === 'PROVEN_STALE';
    const emailAbsent = !!qualifyingAbsence(absenceByCoach.get(co.id), co, collByNS.get(`${co.school}|${co.sport}`));

    // ---- Corroboration as an explicit, auditable method (Phase 7B.2) ----
    // Existing registry-corruption-immune paths (coach_seasons) are preserved EXACTLY.
    let corroborationMethod = null;
    if (sourceDomainTrusted) corroborationMethod = 'COACH_SEASONS_SOURCE_DOMAIN';
    else if (idAtEvidence || idAtCurrent) corroborationMethod = 'COACH_SEASONS_IDENTITY';

    // STRICT_AUTHORITATIVE_CURRENT — an alternative independent corroboration proven in
    // Phase 7B.1. It never fires for a coach the coach_seasons paths already corroborate,
    // and it is gated by activation scope (default NAIA-only) so NCAA behaviour cannot change.
    // Every one of these must hold — positive evidence never overrides a contradiction.
    const progRow = collByNS.get(`${co.school}|${co.sport}`);
    const strictDomainOk = !!sdom && domByName.has(sdom) && !isHeld(sdom)
      && ['VERIFIED', 'VERIFIED_ALIAS'].includes(domByName.get(sdom)?.status)
      && domByName.get(sdom)?.unitid != null && domByName.get(sdom)?.unitid === resolvedUnitid;
    const strictAuthoritative = !corroborationMethod
      && inStrictScope(progRow?.division)               // activation scope (contradiction gate: division)
      && inst === DECISION.RESOLVED                       // (1) resolver RESOLVED, (15) no unresolved ambiguity
      && cls === 'KEEP'                                   // (2) canonical == programme (no REASSIGN/REVIEW)
      && resolvedUnitid != null && resolvedUnitid === curUnitid
      && progRow?.active === 1                            // (3) programme active
      && !!curUnitid                                      // (4) sport-scoped programme exists (reconcile is per-sport)
      && co.currentness_status === 'CURRENT'             // (5) currentness CURRENT
      && !!co.currentness_source_url                     // (6) authoritative currentness source present
      && strictDomainOk                                  // (7)(10) source domain independently trusted for same UNITID
      && !!co.email_seen_on_source_at                    // (9) observation timestamp
      && !!co.email_seen_on_source_url                   // (8)(10) observation URL
      && emailStatus === 'verified'                       // (12) verified + (11) personal/consumer (generic/inferred excluded)
      && hasRealEmail && !isTeam                          // real per-person address
      && !provenStale;                                   // (13) not proven stale (contradiction gate: departed)
    if (strictAuthoritative) corroborationMethod = 'STRICT_AUTHORITATIVE_CURRENT';

    const corroborated = corroborationMethod != null;
    const eligible = inst === DECISION.RESOLVED && emailStatus === 'verified' && hasRealEmail && !isTeam
      && ['KEEP', 'REASSIGN'].includes(cls) && corroborated && !provenStale && !emailAbsent;
    let ineligibleReason = '';
    if (!eligible) {
      if (provenStale) ineligibleReason = 'coach proven no longer current (PROVEN_STALE)';
      else if (emailAbsent) ineligibleReason = ABSENCE_REASON;
      else if (!hasRealEmail || isTeam) ineligibleReason = 'no per-person address';
      else if (emailStatus !== 'verified') ineligibleReason = `email ${emailStatus}`;
      else if (inst !== DECISION.RESOLVED) ineligibleReason = `institution ${inst}`;
      else if (!corroborated) ineligibleReason = `${cls} not corroborated (coach_seasons or strict-authoritative)`;
      else ineligibleReason = cls;
    }

    return {
      coach_id: co.id, coach_name: co.full_name, email: co.email, title: co.position_title, sport: co.sport,
      legacy_school: co.school, legacy_unitid: curUnitid,
      canonical_unitid: resolvedUnitid, canonical_school: resolvedName,
      source_url: co.email_source_url, source_domain: sdom, email_domain: edom,
      classification: cls, institution_resolution_status: inst,
      coach_identity_status: identityStatus, email_verification_status: emailStatus,
      outreach_eligibility: eligible ? 'YES' : 'NO', ineligible_reason: ineligibleReason,
      resolution_method: method || 'NONE', corroboration_method: corroborationMethod || 'NONE', evidence: evNote,
      reassigned: cls === 'REASSIGN' ? 1 : 0,
      canonicalized: resolvedName && resolvedName !== co.school ? 1 : 0,
    };
  }

  return coaches.map(reconcile);
}
