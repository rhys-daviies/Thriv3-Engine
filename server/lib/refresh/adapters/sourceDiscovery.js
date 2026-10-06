/**
 * SOURCE DISCOVERY — Phase 8B.1. Pure helpers for finding a programme's official roster source.
 * No fetching, no writing: the recovery crawler (and any future gatherer) supplies pages.
 *
 * Search order (Part I): verified athletics host (navigation first, platform URL families as a
 * fallback) -> institution athletics PATH on the institution's own host -> a separate athletics
 * host the institution site links to, accepted only through the ownership chain. Search-result
 * snippets are never evidence.
 */
import { pageTitle, SPORT_PRESTO } from './presto.js';
import { sportEvidence, seasonEvidence, SPORT_STATUS, SEASON_STATUS } from './sourceEvidence.js';
import { detectPlatform, parseSidearmRosterStrict } from './sidearm.js';
import { parseRosterTableStrict, STRUCTURE, prestoListViewHref } from './rosterStructure.js';

export const SOURCE_STATUS = Object.freeze({
  CURRENT: 'CURRENT_ROSTER_FOUND', PRIOR: 'PRIOR_ROSTER_ONLY', UNPARSED: 'ROSTER_PAGE_UNPARSED', SEASON_UNKNOWN: 'ROSTER_SEASON_UNKNOWN',
  SPORT_UNRESOLVED: 'SPORT_UNRESOLVED', SEASON_CONTRADICTION: 'SEASON_CONTRADICTION', NO_ROSTER: 'PROGRAMME_CURRENT_NO_ROSTER', BLOCKED: 'BLOCKED', UNAVAILABLE: 'SOURCE_UNAVAILABLE', NOT_FOUND: 'NOT_FOUND', NOT_SEARCHED: 'NOT_SEARCHED',
});
/** Best-first ranking used to pick one status per programme. */
export const STATUS_RANK = Object.freeze({ NOT_SEARCHED: 0.5, NOT_FOUND: 1, SOURCE_UNAVAILABLE: 2, BLOCKED: 3, SPORT_UNRESOLVED: 4, PROGRAMME_CURRENT_NO_ROSTER: 5, SEASON_CONTRADICTION: 6.5, PRIOR_ROSTER_ONLY: 6, ROSTER_SEASON_UNKNOWN: 7, ROSTER_PAGE_UNPARSED: 8, CURRENT_ROSTER_FOUND: 9 });

/** A fetch block reason -> discovery status. A 404 is NOT_FOUND, never "unavailable". */
export function blockStatus(block) {
  if (block === 'BOT_CHALLENGE' || block === 'HTTP_403' || block === 'HTTP_429') return SOURCE_STATUS.BLOCKED;
  if (/^HTTP_4|ERROR_PAGE|EMPTY_BODY/.test(block || '')) return SOURCE_STATUS.NOT_FOUND;
  return SOURCE_STATUS.UNAVAILABLE;
}

const GENDER = { 'mens-soccer': /\b(men'?s|mens|msoc|m-soccer|boys)\b/i, 'womens-soccer': /\b(women'?s|womens|wsoc|w-soccer|girls|lady)\b/i };
/** Does a link (href + text) point at THIS sport's pages (and not the other sex's)? */
export function isSportLink({ href = '', text = '' }, sport) {
  const t = `${href} ${text}`; const other = sport === 'mens-soccer' ? 'womens-soccer' : 'mens-soccer';
  return /soccer|msoc|wsoc/i.test(t) && GENDER[sport].test(t) && !GENDER[other].test(t);
}
/** A sport-specific roster link — never a site-wide "all rosters"/general or coaches page. */
export function isRosterLink({ href = '', text = '' }) {
  return /roster/i.test(`${href} ${text}`) && !/path=general|all-rosters|coach|staff/i.test(href);
}
/** Athletics path scopes linked from an institution home page on its OWN host ("/athletics", "/sports"). */
export function athleticsScopes(linksOnHome, institutionHost) {
  const norm = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
  const scopes = new Set();
  for (const l of linksOnHome) {
    let u; try { u = new URL(l.href); } catch { continue; }
    if (norm(u.hostname) !== norm(institutionHost) || /intramural|esports|recreation|fitness|club/i.test(`${l.href} ${l.text}`)) continue;
    const seg = u.pathname.split('/').filter(Boolean)[0];
    if (seg && /athlet|sport/i.test(seg)) scopes.add(`/${seg}`);
  }
  return [...scopes];
}
/** Platform URL families (measured forms), most specific first. */
export function platformRosterUrls(base, platform, sport, { institutionPath = false } = {}) {
  const code = SPORT_PRESTO[sport];
  if (platform === 'SIDEARM') return [`${base}/sports/${sport}/roster`, `${base}/roster.aspx?path=${code}`];
  if (platform === 'PRESTO') return [`${base}/sports/${code}/2026-27/roster`];
  return institutionPath ? [] : [`${base}/sports/${code}/2026-27/roster`];
}
/**
 * Judge one fetched page as a roster source for (sport, season). Structure-validated (fail closed).
 * Phase 8C.3C: sport and season come from the page's own evidence (sourceEvidence.js). A page whose
 * sport is contradicted is WRONG_SPORT_PAGE; one that never names this sport is SPORT_UNRESOLVED,
 * whatever roster markup it carries (a "roster" link to /sports/bsb/ is a baseball page, and a generic
 * /roster names no sport). A page that proves no season is ROSTER_SEASON_UNKNOWN — never CURRENT.
 */
export function judgeRosterPage(page, sport, { season = 2026, minPlayers = 5 } = {}) {
  if (page.block) return { status: blockStatus(page.block), http: page.status, block: page.block };
  const url = page.final_url || page.url;
  const sp = sportEvidence({ url, html: page.body, sport });
  const sportOut = { sport_status: sp.status, sport_detail: sp.detail };
  if (sp.status === SPORT_STATUS.CONTRADICTED) return { status: 'WRONG_SPORT_PAGE', ...sportOut };
  const platform = detectPlatform(page.body);
  const r = platform === 'SIDEARM' ? parseSidearmRosterStrict(page.body) : parseRosterTableStrict(page.body);
  const n = r.structure.code === STRUCTURE.OK ? r.records.length : 0;
  const se = seasonEvidence({ url, html: page.body }); const ps = se.status === SEASON_STATUS.CONFIRMED ? se.season : null;
  const seasonOut = { page_season: ps, season_status: se.status, season_class: se.evidence_class, season_detail: se.detail };
  if (sp.status !== SPORT_STATUS.CONFIRMED) return { status: SOURCE_STATUS.SPORT_UNRESOLVED, players: n, platform, structure: r.structure.code, ...sportOut, ...seasonOut };
  if (n >= minPlayers) {
    const status = se.status === SEASON_STATUS.CONTRADICTION ? SOURCE_STATUS.SEASON_CONTRADICTION : ps == null ? SOURCE_STATUS.SEASON_UNKNOWN : ps === season ? SOURCE_STATUS.CURRENT : ps < season ? SOURCE_STATUS.PRIOR : SOURCE_STATUS.SEASON_CONTRADICTION;
    return { status, players: n, platform, structure: r.structure.code, ...sportOut, ...seasonOut };
  }
  if (r.structure.code === STRUCTURE.UNKNOWN && /roster/i.test(pageTitle(page.body))) return { status: SOURCE_STATUS.UNPARSED, players: 0, platform, structure: r.structure.code, structure_detail: r.structure.detail, list_view: prestoListViewHref(page.body), ...sportOut, ...seasonOut };
  return { status: 'NO_ROSTER_ON_PAGE', players: n, platform, structure: r.structure.code, ...sportOut, ...seasonOut };
}
