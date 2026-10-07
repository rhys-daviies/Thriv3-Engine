/**
 * SOURCE AUTHORITY — Phase 7E. Which kind of source may establish which fact.
 *
 * A gatherer DECLARES what it fetched (`source_kind`); this module decides what that
 * declaration is worth. The declaration is only a claim: an "official staff directory"
 * on a host that no athletics entity owns is not official, a current-season claim read
 * off an archived page is history, and a search result is discovery however it is
 * labelled. The effective tier is therefore computed, never copied from the input.
 *
 *   TIER A  authoritative current     the entity's own athletics/institution pages, the
 *                                     governing body's membership directory, NCES/IPEDS
 *   TIER B  authoritative supporting  conference site, institutional announcement, the
 *                                     entity's official schedule
 *   TIER C  historical                archived official page, prior-season official page,
 *                                     Wayback
 *   TIER D  discovery only            search results, aggregators, third-party recruiting
 *                                     sites, inferred patterns — and anything unverifiable
 *
 * Tier D never directly promotes identity, a current coach, email_seen, CURRENT, or
 * domain ownership (FIELD_AUTHORITY below; enforced again by the promotion engine).
 */
import { hostOf } from '../athleticsEntity.js';

export const TIERS = Object.freeze({ A: 'A', B: 'B', C: 'C', D: 'D' });

/** Declared source kinds -> the best tier they can ever earn. */
export const SOURCE_KINDS = Object.freeze({
  OFFICIAL_ATHLETICS_PROGRAMME_PAGE: 'A',
  OFFICIAL_STAFF_DIRECTORY: 'A',
  OFFICIAL_INSTITUTION_DIRECTORY: 'A',
  OFFICIAL_ROSTER: 'A',
  OFFICIAL_MEMBERSHIP: 'A',          // NCAA / NAIA / NJCAA / USCAA membership directory
  FEDERAL_REGISTRY: 'A',             // NCES College Navigator / IPEDS
  CONFERENCE_SITE: 'B',
  INSTITUTIONAL_ANNOUNCEMENT: 'B',
  OFFICIAL_SCHEDULE: 'B',
  ARCHIVED_OFFICIAL: 'C',
  PRIOR_SEASON_OFFICIAL: 'C',
  WAYBACK: 'C',
  SEARCH_RESULT: 'D',
  AGGREGATOR: 'D',
  THIRD_PARTY_RECRUITING: 'D',
  INFERRED_PATTERN: 'D',
});

/** Kinds whose authority comes from being ON THE ENTITY'S OWN HOST. */
const ENTITY_HOSTED = new Set(['OFFICIAL_ATHLETICS_PROGRAMME_PAGE', 'OFFICIAL_STAFF_DIRECTORY',
  'OFFICIAL_INSTITUTION_DIRECTORY', 'OFFICIAL_ROSTER', 'INSTITUTIONAL_ANNOUNCEMENT', 'OFFICIAL_SCHEDULE']);

/** Governing-body and federal hosts (membership / identity authorities, not entity-owned). */
export const AUTHORITY_HOSTS = Object.freeze({
  OFFICIAL_MEMBERSHIP: ['ncaa.org', 'ncaa.com', 'naia.org', 'njcaa.org', 'theuscaa.com', 'uscaa.org', 'thenccaa.org'],
  FEDERAL_REGISTRY: ['nces.ed.gov', 'collegescorecard.ed.gov'],
});

const hostMatches = (host, roots) => roots.some((r) => host === r || host.endsWith(`.${r}`));

/**
 * FIELD AUTHORITY — the tiers that may ESTABLISH each field. "Establish" means: be the
 * evidence a promotion writes. Lower tiers may still be staged, shown and reviewed.
 */
export const FIELD_AUTHORITY = Object.freeze({
  entity_identity: ['A'],            // which athletics entity a record belongs to
  federal_unitid: ['A'],             // and only FEDERAL_REGISTRY (see mayEstablish)
  domain_ownership: ['A'],           // host -> entity (with the full ownership chain)
  coach_current: ['A'],              // this person is on the staff NOW (CURRENT)
  email_seen: ['A'],                 // this exact address is published NOW
  coach_role: ['A'],
  coach_history: ['A', 'C'],         // coach_seasons for a past season
  roster_current: ['A'],
  roster_history: ['A', 'C'],
  division: ['A', 'B+B'],            // governing body, or two independent tier-B sources
  conference: ['A', 'B'],
  programme_status: ['A', 'B'],      // discontinued / new programme
});

/**
 * Effective tier of one fetched source.
 *   ctx.ownsSource(url): true iff this exact URL is an official source of the RESOLVED entity for
 *                       the page's sport (identityResolver.sourceOwnedBy: an owned host, or a
 *                       VERIFIED path-scoped location). Preferred: it is the question the
 *                       gatherer asked, so the two layers cannot disagree (Phase 8C.7D)
 *   ctx.ownsHost(host): host ownership only (identityResolver.hostOwnedBy — host-level rows
 *                       first, so a campus subdomain is never its parent's); used when no
 *                       ownsSource is given. ctx.entityHosts (exact-match Set) is the last fallback
 *   ctx.conferenceHosts: Set of known conference hosts
 *   ctx.currentSeason: the refresh season
 * Returns { tier, kind, reasons[] }. Downgrades are explicit and explain themselves.
 */
export function classifySource({ url, kind, observedSeason, pageSeason } = {}, ctx = {}) {
  const reasons = [];
  const declared = SOURCE_KINDS[kind];
  if (!declared) return { tier: 'D', kind, reasons: [`unknown source kind ${kind}`] };
  const host = hostOf(url);
  if (!host) return { tier: 'D', kind, reasons: ['no parseable https host'] };
  if (!/^https:\/\//i.test(url)) reasons.push('not https');
  let tier = declared;
  const archived = /web\.archive\.org/i.test(url);
  if (archived && tier !== 'D') { tier = 'C'; reasons.push('archived copy (Wayback) is history, never current'); }
  if (!archived && ENTITY_HOSTED.has(kind)) {
    if (typeof ctx.ownsSource === 'function') {
      if (!ctx.ownsSource(url)) { tier = 'D'; reasons.push(`${url} is not inside a source owned by the resolved athletics entity`); }
    } else {
      const owned = typeof ctx.ownsHost === 'function' ? ctx.ownsHost(host) : !!(ctx.entityHosts && ctx.entityHosts.has(host));
      if (!owned) { tier = 'D'; reasons.push(`host ${host} is not owned by the resolved athletics entity`); }
    }
  }
  if (kind === 'OFFICIAL_MEMBERSHIP' && !hostMatches(host, AUTHORITY_HOSTS.OFFICIAL_MEMBERSHIP)) { tier = 'D'; reasons.push(`${host} is not a governing-body host`); }
  if (kind === 'FEDERAL_REGISTRY' && !hostMatches(host, AUTHORITY_HOSTS.FEDERAL_REGISTRY)) { tier = 'D'; reasons.push(`${host} is not a federal registry host`); }
  if (kind === 'CONFERENCE_SITE' && !(ctx.conferenceHosts && ctx.conferenceHosts.has(host))) { tier = 'D'; reasons.push(`${host} is not a known conference host`); }
  const season = pageSeason ?? observedSeason;
  if (tier === 'A' && ctx.currentSeason != null && season != null && Number(season) < Number(ctx.currentSeason)) {
    tier = 'C'; reasons.push(`page is for season ${season}, not the current ${ctx.currentSeason}`);
  }
  return { tier, kind, host, reasons };
}

/**
 * May a source of this tier (and kind) establish this field? `sources` may be one
 * classified source or several (division accepts two independent tier-B sources).
 */
export function mayEstablish(field, sources) {
  const list = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
  const allowed = FIELD_AUTHORITY[field];
  if (!allowed) return { ok: false, reason: `unknown field ${field}` };
  if (field === 'federal_unitid') {
    return list.some((s) => s.tier === 'A' && s.kind === 'FEDERAL_REGISTRY')
      ? { ok: true } : { ok: false, reason: 'a federal UNITID is established only by the federal registry (NCES)' };
  }
  if (list.some((s) => allowed.includes(s.tier))) return { ok: true };
  if (allowed.includes('B+B')) {
    const hosts = new Set(list.filter((s) => s.tier === 'B').map((s) => s.host));
    if (hosts.size >= 2) return { ok: true };
  }
  const best = list.map((s) => s.tier).sort()[0] || 'none';
  return { ok: false, reason: `${field} needs tier ${allowed.join(' or ')}; best source is ${best}` };
}

/** The five things tier D can never promote, stated once for tests and the operator doc. */
export const TIER_D_NEVER = Object.freeze(['entity_identity', 'coach_current', 'email_seen', 'domain_ownership', 'federal_unitid']);
