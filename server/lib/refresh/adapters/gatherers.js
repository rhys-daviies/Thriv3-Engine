/**
 * STAGING-COMPATIBLE GATHERERS — Phase 8A. The first production adapters.
 *
 *   DISCOVERY  where the authoritative sources are (governing-body / region listings, member
 *              athletics hosts) — see discovery helpers below
 *   PROGRAMME  governing-body / region listing -> PROGRAMME pages + a membership listing
 *   ROSTER     an entity-owned official roster page -> one ROSTER page (or a REFUSAL)
 *   STAFF      an entity-owned official staff page  -> one COACH page (or a REFUSAL)
 *
 * ADAPTERS WRITE NOTHING. They return the staging input contract consumed by
 * `npm run integrity:refresh` (server/lib/refresh/staging.js), which resolves identity,
 * classifies and writes ONLY the staging tables. Promotion is a separate, explicit, gated step
 * — and in Phase 8A no coach or roster observation is promoted.
 *
 * Output contract (every page): source_url, source host (derived), fetched_at, observed_season,
 * source_kind (the tier is computed at staging), institution_label (raw institution name),
 * raw_programme, sport, athletics_entity_id (candidate, when known), parser_version,
 * adapter_version, adapter_evidence; staging adds the deterministic observation id,
 * resolution method, confidence and classification. Roster records carry raw player name,
 * position, class/year, roster season, and nationality ONLY where printed; staff records carry
 * raw name, role, and an email ONLY when printed on the page (email_origin PUBLISHED_ON_SOURCE).
 */
import { fetchPage } from './fetchPage.js';
import { parseRosterTable, parseStaffTable, pageSeason, SPORT_PRESTO, pageTitle } from './presto.js';
import { detectPlatform, parseSidearmRosterStrict, parseSidearmStaff } from './sidearm.js';
import { parseRosterTableStrict, STRUCTURE, prestoListViewHref, prestoCardNames, crossCheckCards } from './rosterStructure.js';
import { refusePage, REFUSAL } from './adapterSafety.js';
import { nameKey, coreKey, wordsContained } from './institutionNames.js';

// -2: responsive Presto roster tables (mobile-only cells / hidden labels) parsed correctly (Phase 8A pilot)
// -3: structure-validated, fail-closed roster parsing (PARSER_STRUCTURE_UNKNOWN) — Phase 8B.1
export const ADAPTER_VERSION = 'p8b1-gatherers-3';
const seasonToken = (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

/* ------------------------------------------------------------ DISCOVERY helpers */
/** Initials of a name's words ("Chandler-Gilbert Community College" -> "cgcc"). */
export function acronymOf(name) {
  return nameKey(name).split(' ').filter((w) => w && !['of', 'the', 'and', 'at'].includes(w)).map((w) => w[0]).join('');
}
/** A member-link label with its "Athletic Link" / nickname decoration removed. */
export function cleanLabel(label) {
  return String(label || '').replace(/\b(athletics?|athletic link|link|website|sports)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}
/**
 * Does a region's member-link label name this institution (closed name rules, no scores)?
 * Includes an ACRONYM rule ("PVCC" = Paradise Valley Community College); the caller must
 * require the match to be UNIQUE among the region's programmes (GCC is Glendale or GateWay).
 */
export function labelNamesInstitution(label, names) {
  const l = cleanLabel(label);
  if (!l) return false;
  return names.filter(Boolean).some((n) => nameKey(l) === nameKey(n) || coreKey(l) === coreKey(n)
    || (coreKey(l).length > 3 && (wordsContained(l, n) || wordsContained(n, l)))
    || (/^[A-Z]{2,6}$/.test(l) && l.toLowerCase() === acronymOf(n)));
}
/** Does a page's self-identification (og:site_name / title) carry every distinguishing word of a name? */
export function pageNamesInstitution(text, names) {
  const words = new Set(nameKey(text).split(' '));
  return names.filter(Boolean).some((n) => { const ck = coreKey(n).split(' ').filter((w) => w.length > 2); return ck.length > 0 && ck.every((w) => words.has(w)); });
}

/* ------------------------------------------------------------ PROGRAMME adapter */
/**
 * listing entries: { association, sport, official_name, season, source_kind, evidence_urls[],
 *                    tier, athletics_entity_id?, unitid?, division?, region? }
 * -> { pages: PROGRAMME pages, membership_listings: [...] } in the staging input contract.
 * Only CURRENT-season entries become programme observations; prior-season entries are
 * returned separately as history (never as current membership).
 */
export function programmeAdapter(entries, { season, conferenceOf = (e) => (e.region ? `NJCAA Region ${e.region}` : null) } = {}) {
  const pages = []; const history = [];
  for (const e of entries) {
    const page = {
      dataset: 'PROGRAMME', institution_label: e.official_name, raw_programme: `${e.official_name} ${e.sport}`, sport: e.sport,
      athletics_entity_id: e.athletics_entity_id || undefined, unitid: e.unitid || undefined, season,
      division: e.association, conference: conferenceOf(e), membership_status: 'ACTIVE',
      sources: (e.evidence_urls || []).slice(0, 2).map((url) => ({ url, kind: e.source_kind })),
      parser_version: 'presto-team-links-1', adapter_version: ADAPTER_VERSION, adapter_evidence: { tier: e.tier, listing_season: e.season, region: e.region ?? null },
    };
    if (Number(e.season) >= Number(season)) pages.push(page); else history.push(page);
  }
  return { pages, history };
}

/* ------------------------------------------------------------ ROSTER / STAFF adapters */
function rosterUrl(host, platform, sport, season) {
  return platform === 'SIDEARM' ? `https://${host}/sports/${sport}/roster/${season}` : `https://${host}/sports/${SPORT_PRESTO[sport]}/${seasonToken(season)}/roster`;
}
function staffUrl(host, platform, sport) {
  return platform === 'SIDEARM' ? `https://${host}/sports/${sport}/coaches` : `https://${host}/sports/${SPORT_PRESTO[sport]}/coaches`;
}

/**
 * One programme's roster. target: { athletics_entity_id, institution_label, sport, host, platform?, season, prior_count? }
 * ctx.ownsHost(host, entity) — identityResolver.hostOwnedBy (host ownership from the DB).
 * Returns { page } (staging ROSTER page) or { refusal }.
 */
export async function rosterAdapter(target, { ownsHost, ownsSource, fetch = fetchPage, url } = {}) {
  const u = url || rosterUrl(target.host, target.platform, target.sport, target.season);
  const p = await fetch(u);
  const platform = target.platform || detectPlatform(p.body);
  // structure-validated parse (fail closed): an unrecognised layout is a refusal, never records
  let parsed = p.block ? { records: [], structure: { code: STRUCTURE.NONE } } : (platform === 'SIDEARM' ? parseSidearmRosterStrict(p.body) : parseRosterTableStrict(p.body));
  // Presto player-card theme: follow the page's OWN declared list view, parse it strictly, cross-check the cards
  let listView = null;
  if (!p.block && platform === 'PRESTO' && parsed.structure.code === STRUCTURE.UNKNOWN && prestoListViewHref(p.body)) {
    const href = new URL(prestoListViewHref(p.body), p.final_url || u).href;
    const lp = await fetch(href);
    if (!lp.block && (lp.final_host || lp.host) === (p.final_host || p.host)) { parsed = crossCheckCards(parseRosterTableStrict(lp.body), prestoCardNames(p.body)); listView = { url: lp.final_url || href, sha256: lp.sha256 }; }
  }
  const players = parsed.structure.code === STRUCTURE.OK ? parsed.records : [];
  const pre = refusePage(p, { kind: 'ROSTER', sport: target.sport, season: target.season, entityOwnsHost: ownsHost ? (h) => ownsHost(h, target.athletics_entity_id) : null, entityOwnsUrl: ownsSource ? (u) => ownsSource(u, target.athletics_entity_id, target.sport) : null }, players, target.prior_count ? { count: target.prior_count } : null);
  // an unreadable layout is named as such: it outranks "zero records" / "count collapse", which it causes
  const refusal = parsed.structure.code === STRUCTURE.UNKNOWN && (!pre || [REFUSAL.ZERO, REFUSAL.COLLAPSE].includes(pre.code)) ? { code: REFUSAL.STRUCTURE, detail: parsed.structure.detail } : pre;
  const meta = { source_url: p.final_url || u, fetched_at: p.fetched_at, http: p.status, platform, title: p.block ? null : pageTitle(p.body).slice(0, 120), sha256: p.sha256 };
  if (refusal) return { refusal: { ...refusal, target: { entity: target.athletics_entity_id, sport: target.sport }, ...meta } };
  return { page: {
    dataset: 'ROSTER', source_kind: 'OFFICIAL_ROSTER', source_url: meta.source_url, fetched_at: meta.fetched_at, page_season: pageSeason(p.body) ?? target.season,
    observed_season: target.season, institution_label: target.institution_label, raw_programme: `${target.institution_label} ${target.sport}`, sport: target.sport,
    athletics_entity_id: target.athletics_entity_id, source_complete: true, parser_version: platform === 'SIDEARM' ? 'sidearm-roster-2' : listView ? 'presto-cards-listview-1' : `${platform.toLowerCase()}-roster-3`, adapter_version: ADAPTER_VERSION,
    adapter_evidence: { platform, title: meta.title, sha256: meta.sha256, records: players.length, ...(listView ? { list_view: listView, parse: 'presto card theme -> declared list view, cross-checked against the cards' } : {}) },
    players: players.map((r) => ({ player_name: r.player_name, position: r.position || null, class_year_label: r.class_year_label || null, hometown: r.hometown || null, ...(r.nationality ? { nationality: r.nationality } : {}) })),
  } };
}

/** One programme's staff page (coach observations are staged, never promoted, in 8A). */
export async function staffAdapter(target, { ownsHost, ownsSource, fetch = fetchPage, url } = {}) {
  const u = url || staffUrl(target.host, target.platform, target.sport);
  const p = await fetch(u);
  const platform = target.platform || detectPlatform(p.body);
  const people = p.block ? [] : (platform === 'SIDEARM' ? parseSidearmStaff(p.body) : parseStaffTable(p.body));
  const refusal = refusePage(p, { kind: 'COACH', sport: target.sport, season: null, entityOwnsHost: ownsHost ? (h) => ownsHost(h, target.athletics_entity_id) : null, entityOwnsUrl: ownsSource ? (u) => ownsSource(u, target.athletics_entity_id, target.sport) : null }, people, target.prior_count ? { count: target.prior_count } : null);
  const meta = { source_url: p.final_url || u, fetched_at: p.fetched_at, http: p.status, platform, title: p.block ? null : pageTitle(p.body).slice(0, 120), sha256: p.sha256 };
  if (refusal) return { refusal: { ...refusal, target: { entity: target.athletics_entity_id, sport: target.sport }, ...meta } };
  return { page: {
    dataset: 'COACH', source_kind: 'OFFICIAL_STAFF_DIRECTORY', source_url: meta.source_url, fetched_at: meta.fetched_at, observed_season: target.season,
    institution_label: target.institution_label, raw_programme: `${target.institution_label} ${target.sport}`, sport: target.sport, athletics_entity_id: target.athletics_entity_id,
    source_complete: true, parser_version: `${platform.toLowerCase()}-staff-1`, adapter_version: ADAPTER_VERSION, adapter_evidence: { platform, title: meta.title, sha256: meta.sha256, records: people.length },
    people: people.map((x) => ({ full_name: x.full_name, role: x.role, email: x.email_origin === 'PUBLISHED_ON_SOURCE' ? x.email : null, email_origin: x.email_origin })),
  } };
}
