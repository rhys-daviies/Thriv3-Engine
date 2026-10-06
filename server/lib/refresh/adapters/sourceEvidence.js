/**
 * SOURCE EVIDENCE — Phase 8C.3C. What a fetched roster page PROVES about its own sport and season.
 *
 * Pure functions over (url, html | title). Neither function is told what was REQUESTED: a gather
 * asked for "2026 women's soccer" is not evidence that the page it got is either. The gate
 * (adapterSafety.refusePage) compares the proven answer with the request.
 *
 *   sportEvidence  -> SPORT_CONFIRMED | SPORT_CONTRADICTED | SPORT_UNRESOLVED
 *   seasonEvidence -> SEASON_CONFIRMED | SEASON_CONTRADICTION | SEASON_UNRESOLVED
 *
 * Only a CONFIRMED result may progress automatically. UNRESOLVED is held; a contradiction is
 * refused (sport) or held for a person (season). Every result carries the signals it used.
 *
 * SPORT. Absence of evidence for another sport is not evidence for soccer: a page is confirmed
 * only when something on it positively names the requested soccer programme (sex included) and
 * nothing names another sport or the other sex. Signals, in what the adapters can observe:
 *   URL_SPORT_SLOT   the platform's sport slot — /sports/<slot>/ (Presto, Sidearm) or
 *                    roster.aspx?path=<slot>. ANY value other than this programme's soccer code is
 *                    another sport: the slot is positive identification, not a blacklist.
 *   URL_PATH         a sport word in any other path segment (/athletics/womens-soccer/roster/)
 *   TITLE            the page's <title>
 *   PAGE_HEADING     the page's <h1> (only when HTML is supplied)
 * "Soccer" without a sex is compatible with either programme but confirms neither.
 *
 * SEASON. The requested season is never evidence. Classes:
 *   TITLE_EXPLICIT         the <title> names the season ("2026 Men's Soccer Roster", "2026-27 ...")
 *   PROVIDER_METADATA      structured provider markup — the Presto season selector's SELECTED option
 *   PAGE_CONTENT_EXPLICIT  the page's own <h1> names the season
 *   URL_EXPLICIT           a URL season token from an architecture where the token is authoritative.
 *                          NONE IS TODAY: measured hosts serve another season at a Presto season path
 *                          (johnsonroyals.com 2024-25 at the 2023-24 path; Angelina "Roster 2027" at
 *                          /2026-27/). The token is therefore recorded as URL_TOKEN — it corroborates
 *                          and can CONTRADICT, but it never confirms on its own.
 *   MULTI_SIGNAL           two or more confirming signals of different classes agree
 *   UNRESOLVED             nothing confirming
 * Any two signals naming different seasons (including a URL token) is SEASON_CONTRADICTION — the
 * gate never picks one. A malformed year ("2026-28") is recorded and contributes nothing.
 */
export const SPORT_STATUS = Object.freeze({ CONFIRMED: 'SPORT_CONFIRMED', CONTRADICTED: 'SPORT_CONTRADICTED', UNRESOLVED: 'SPORT_UNRESOLVED' });
export const SEASON_STATUS = Object.freeze({ CONFIRMED: 'SEASON_CONFIRMED', CONTRADICTION: 'SEASON_CONTRADICTION', UNRESOLVED: 'SEASON_UNRESOLVED' });
export const SEASON_CLASS = Object.freeze({ TITLE: 'TITLE_EXPLICIT', URL: 'URL_EXPLICIT', PROVIDER: 'PROVIDER_METADATA', CONTENT: 'PAGE_CONTENT_EXPLICIT', MULTI: 'MULTI_SIGNAL', UNRESOLVED: 'UNRESOLVED' });
/** Architectures whose URL season token is authoritative on its own. Empty by measurement (see above). */
export const AUTHORITATIVE_URL_SEASON = Object.freeze(new Set());

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&#039;|&rsquo;|&#8217;/g, "'").replace(/[‘’]/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;|–/g, '-').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const titleOf = (html) => decode((String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
/** Page <h1>s, excluding the site-logo / site-title headings themes wrap the brand in. */
const headingsOf = (html) => [...String(html || '').matchAll(/<h1([^>]*)>([\s\S]*?)<\/h1>/gi)].filter((m) => !/site-(title|logo)|logo/i.test(m[1])).map((m) => decode(m[2])).filter(Boolean);
const pathOf = (url) => { try { return new URL(url).pathname.toLowerCase(); } catch { return String(url || '').toLowerCase().replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0]; } };
const queryOf = (url) => { try { return new URL(url).searchParams; } catch { return new URLSearchParams(String(url || '').split('?')[1] || ''); } };

/* ------------------------------------------------------------------ SPORT */
const SOCCER_SLOT = { msoc: 'mens-soccer', 'mens-soccer': 'mens-soccer', 'm-soccer': 'mens-soccer', msoccer: 'mens-soccer', 'men-soccer': 'mens-soccer',
  wsoc: 'womens-soccer', 'womens-soccer': 'womens-soccer', 'w-soccer': 'womens-soccer', wsoccer: 'womens-soccer', 'women-soccer': 'womens-soccer', soccer: 'soccer' };
// Words that name another sport in free text (titles, headings, generic path segments). Used ONLY for
// text; the platform sport slot needs no list — any non-soccer slot value is another sport.
const OTHER_SPORT_WORD = /\b(baseball|softball|basketball|volleyball|football|lacrosse|tennis|golf|track|cross[ -]country|wrestling|swimming|diving|bowling|e-?sports|cheer(?:leading)?|dance|rodeo|hockey|rugby|water polo|rowing|equestrian|archery|triathlon|beach volleyball|bsb|sball|[mw]bkb|[mw]?vball|fball)\b/i;
/** Values seen in the /sports/ position that are site pages, not sports. */
const NOT_A_SLOT = new Set(['roster', 'rosters', 'schedule', 'schedules', 'coaches', 'staff', 'news', 'archives', 'index', 'landing']);
/** Soccer + sex named in free text: 'mens-soccer' | 'womens-soccer' | 'soccer' | null. */
function soccerInText(t) {
  const s = String(t || '');
  if (!/\bsoccer\b|\b[mw]soc\b/i.test(s)) return null;
  const women = /\b(women'?s?|womens|wsoc|lady|ladies|girls)\b/i.test(s); const men = /\b(men'?s?|mens|msoc|boys)\b/i.test(s);
  if (women && !men) return 'womens-soccer';
  if (men && !women) return 'mens-soccer';
  return 'soccer';
}
function textSignal(kind, text) {
  if (!text) return null;
  const soccer = soccerInText(text); const other = (text.match(OTHER_SPORT_WORD) || [])[1];
  if (other && !soccer) return { kind, value: text.slice(0, 120), sport: `other:${other.toLowerCase()}` };
  if (other && soccer) return { kind, value: text.slice(0, 120), sport: `conflict:${soccer}+${other.toLowerCase()}` };
  return soccer ? { kind, value: text.slice(0, 120), sport: soccer } : null;
}
export function sportSignals({ url = '', html = null, title = null } = {}) {
  const out = []; const p = pathOf(url);
  const raw = (p.match(/\/sports\/([^/]+)/) || [])[1] || (/roster\.aspx/.test(p) ? queryOf(url).get('path') : null);
  const slot = raw && !NOT_A_SLOT.has(raw.toLowerCase()) ? raw : null; // /sports/roster is a site-wide page, not a sport
  if (slot) out.push({ kind: 'URL_SPORT_SLOT', value: slot, sport: SOCCER_SLOT[slot.toLowerCase()] || `other:${slot.toLowerCase()}` });
  else {
    for (const seg of p.split('/').filter(Boolean)) {
      if (SOCCER_SLOT[seg]) { out.push({ kind: 'URL_PATH', value: seg, sport: SOCCER_SLOT[seg] }); continue; }
      const s = textSignal('URL_PATH', seg.replace(/[-_]/g, ' ')); if (s && !s.sport.startsWith('soccer')) out.push({ ...s, value: seg });
    }
  }
  const t = title ?? titleOf(html); const ts = textSignal('TITLE', t); if (ts) out.push(ts);
  if (html) for (const h of headingsOf(html)) { const hs = textSignal('PAGE_HEADING', h); if (hs) out.push(hs); }
  return out;
}
/** Does this page prove it belongs to `sport` ('mens-soccer' | 'womens-soccer')? */
export function sportEvidence({ url = '', html = null, title = null, sport }) {
  const signals = sportSignals({ url, html, title });
  const otherSex = sport === 'mens-soccer' ? 'womens-soccer' : 'mens-soccer';
  const against = signals.filter((s) => s.sport === otherSex || s.sport.startsWith('other:') || s.sport.startsWith('conflict:'));
  if (against.length) return { status: SPORT_STATUS.CONTRADICTED, sport_observed: against[0].sport.replace(/^other:/, ''), signals, detail: against.map((s) => `${s.kind} "${s.value}" names ${s.sport.replace(/^other:/, '')}`).join('; ') };
  const exact = signals.filter((s) => s.sport === sport);
  if (exact.length) return { status: SPORT_STATUS.CONFIRMED, sport_observed: sport, signals, detail: exact.map((s) => `${s.kind} "${s.value}"`).join('; ') };
  return { status: SPORT_STATUS.UNRESOLVED, sport_observed: signals.some((s) => s.sport === 'soccer') ? 'soccer (sex not established)' : null, signals,
    detail: signals.length ? `only sex-neutral soccer evidence (${signals.map((s) => s.kind).join(', ')})` : 'no sport evidence on the page or in its URL' };
}

/* ------------------------------------------------------------------ SEASON */
/** Seasons a piece of text names: [{ season, token }] plus [{ malformed }]. "2026-27" / "2026-2027" -> 2026. */
export function seasonsInText(text) {
  const t = String(text || ''); const found = []; const malformed = [];
  const ranges = [...t.matchAll(/\b(20\d\d)\s*[-/]\s*(20\d\d|\d\d)\b/g)];
  let rest = t;
  for (const m of ranges) {
    const y = Number(m[1]); const end = m[2].length === 4 ? Number(m[2]) : 2000 + Number(m[2]);
    if (end === y + 1) found.push({ season: y, token: m[0] }); else malformed.push(m[0]);
    rest = rest.replace(m[0], ' ');
  }
  for (const m of rest.matchAll(/\b(20\d\d)\b/g)) found.push({ season: Number(m[1]), token: m[0] });
  return { found, malformed };
}
function urlSeasonTokens(url) {
  const out = []; const p = pathOf(url);
  const presto = p.match(/\/sports\/[^/]+\/(?:[a-z0-9]+\/)?(20\d\d-\d\d)(?:\/|$)/);
  if (presto) { const { found, malformed } = seasonsInText(presto[1]); found.forEach((f) => out.push({ kind: 'URL_TOKEN', architecture: 'PRESTO_SEASON_PATH', value: presto[1], season: f.season })); malformed.forEach((v) => out.push({ kind: 'URL_TOKEN', architecture: 'PRESTO_SEASON_PATH', value: v, malformed: true })); }
  const sidearm = p.match(/\/roster\/(20\d\d(?:-\d\d)?)(?:\/|$)/);
  if (sidearm) { const { found } = seasonsInText(sidearm[1]); found.forEach((f) => out.push({ kind: 'URL_TOKEN', architecture: 'SIDEARM_ROSTER_PATH', value: sidearm[1], season: f.season })); }
  for (const [k, v] of queryOf(url)) if (/season|year/i.test(k)) for (const f of seasonsInText(String(v).replace(/[_]/g, ' ')).found) out.push({ kind: 'URL_TOKEN', architecture: 'QUERY_PARAM', value: `${k}=${v}`, season: f.season });
  return out;
}
/** Presto's season selector: <select id="season-selector"> with the current season's option SELECTED. */
function providerSeason(html) {
  const sel = String(html || '').match(/<select[^>]*(?:season-selector|season-filter)[^>]*>([\s\S]*?)<\/select>/i);
  if (!sel) return null;
  const opt = sel[1].match(/<option[^>]*\bselected\b[^>]*>([^<]*)/i);
  return opt ? decode(opt[1]) : null;
}
export function seasonSignals({ url = '', html = null, title = null } = {}) {
  const out = [];
  const push = (kind, value, cls) => { const { found, malformed } = seasonsInText(value); found.forEach((f) => out.push({ kind, class: cls, value: String(value).slice(0, 120), season: f.season, token: f.token })); malformed.forEach((m) => out.push({ kind, class: cls, value: String(value).slice(0, 120), malformed: m })); };
  const t = title ?? titleOf(html); if (t) push('TITLE', t, SEASON_CLASS.TITLE);
  if (html) {
    const pm = providerSeason(html); if (pm) push('PROVIDER_SEASON_SELECTOR', pm, SEASON_CLASS.PROVIDER);
    for (const h of headingsOf(html)) push('PAGE_HEADING', h, SEASON_CLASS.CONTENT);
  }
  for (const u of urlSeasonTokens(url)) out.push({ ...u, class: AUTHORITATIVE_URL_SEASON.has(u.architecture) ? SEASON_CLASS.URL : null });
  return out;
}
/** What season does this page prove? Never told the requested season. */
export function seasonEvidence({ url = '', html = null, title = null } = {}) {
  const signals = seasonSignals({ url, html, title });
  const named = signals.filter((s) => s.season != null);
  const seasons = [...new Set(named.map((s) => s.season))];
  if (seasons.length > 1) return { status: SEASON_STATUS.CONTRADICTION, season: null, evidence_class: null, signals, detail: named.map((s) => `${s.kind} ${s.token || s.value} -> ${s.season}`).join(' vs ') };
  const confirming = named.filter((s) => s.class);
  if (!confirming.length) {
    return { status: SEASON_STATUS.UNRESOLVED, season: null, evidence_class: SEASON_CLASS.UNRESOLVED, signals,
      detail: named.length ? `only a non-authoritative URL season token (${named.map((s) => s.value).join(', ')}) — corroborates, never confirms` : signals.some((s) => s.malformed) ? `malformed season (${signals.filter((s) => s.malformed).map((s) => s.malformed).join(', ')})` : 'no season named by the title, provider metadata or page heading' };
  }
  const classes = [...new Set(confirming.map((s) => s.class))];
  return { status: SEASON_STATUS.CONFIRMED, season: seasons[0], evidence_class: classes.length > 1 ? SEASON_CLASS.MULTI : classes[0], signals,
    detail: confirming.map((s) => `${s.class} "${s.token}"`).concat(named.filter((s) => !s.class).map((s) => `corroborated by ${s.kind} ${s.value}`)).join('; ') };
}
