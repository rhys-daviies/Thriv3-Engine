/**
 * PRESTOSPORTS PARSERS — Phase 8A. Pure functions over page HTML; no fetching, no writing.
 *
 * PrestoSports hosts most NJCAA region sites and many college athletics sites. URLs follow
 *   /sports/<msoc|wsoc>/<YYYY-YY>/[<div>/]{teams|standings|roster|coaches|schedule}
 * and a fall season "2026-27" is the 2026 fall season.
 */
import { parseRosterTableStrict, STRUCTURE } from './rosterStructure.js';

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&#039;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;/g, '-').replace(/\s+/g, ' ').trim();
const stripTags = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' '));

export const PRESTO_SPORT = Object.freeze({ msoc: 'mens-soccer', wsoc: 'womens-soccer' });
export const SPORT_PRESTO = Object.freeze({ 'mens-soccer': 'msoc', 'womens-soccer': 'wsoc' });

/** Fall season a Presto season token names: "2026-27" -> 2026. */
export function seasonFromToken(tok) {
  const m = String(tok || '').match(/^(20\d\d)-\d\d$/); return m ? Number(m[1]) : null;
}
/** 'div2' | 'D2' | 'DivII' -> 'D2' (null when absent). */
export function divisionToken(tok) {
  if (!tok) return null;
  const roman = String(tok).match(/^(?:div|d)(I{1,3})$/i); if (roman) return `D${roman[1].length}`;
  const n = String(tok).match(/([123])$/); return n ? `D${n[1]}` : null;
}
/** Parse a Presto sport URL path. */
export function prestoPath(url) {
  const m = String(url || '').match(/\/sports\/(msoc|wsoc|mens-soccer|womens-soccer)\/(?:(D[123]|div[123])\/)?(20\d\d-\d\d)(?:\/((?:div|d)(?:[123]|I{1,3})))?\/?([a-z_-]*)/i);
  if (!m) return null;
  const code = m[1].toLowerCase();
  return { sport: PRESTO_SPORT[code] || code, season: seasonFromToken(m[3]), season_token: m[3], division: divisionToken(m[2] || m[4]), page: m[5] || null };
}
/** The season a page's TITLE names, independent of the URL. A raw reader for listings — the roster
 *  acquisition gate decides with sourceEvidence.seasonEvidence (Phase 8C.3C), never with this alone. */
export function pageSeason(html) {
  const t = (String(html).match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const range = t.match(/\b(20\d\d)-(\d\d)\b/); if (range) return Number(range[1]);
  const single = t.match(/\b(20\d\d)\b/); return single ? Number(single[1]) : null;
}
export function pageTitle(html) { return decode((String(html).match(/<title>([^<]*)<\/title>/i) || [])[1] || ''); }
/** Sport a page's own title names (Men's / Women's Soccer), or null. A raw reader: null is NOT "soccer" —
 *  the acquisition gate decides with sourceEvidence.sportEvidence (Phase 8C.3C). */
export function pageSportFromTitle(html) {
  const t = pageTitle(html);
  if (/women'?s soccer|wsoc/i.test(t)) return 'womens-soccer';
  if (/men'?s soccer|msoc/i.test(t)) return 'mens-soccer';
  return null;
}

/**
 * Team links on a Presto teams/standings page for one sport+season. Returns
 * [{ slug, name, href, division }] deduplicated by slug; the name is the longest non-empty
 * anchor text / image alt seen for that slug.
 */
export function parseTeamLinks(html, { sportCode, seasonToken }) {
  const re = new RegExp(`<a[^>]+href="([^"]*/sports/${sportCode}/(?:(?:D[123]|div[123])/)?${seasonToken}(?:/(?:div|d)(?:[123]|I{1,3}))?/teams/([a-z0-9-]+))(?:[?#][^"]*)?"[^>]*>([\\s\\S]*?)</a>`, 'gi');
  const by = new Map();
  let m;
  while ((m = re.exec(html))) {
    const [, href, slug, inner] = m;
    const txt = stripTags(inner); const alt = decode((inner.match(/alt="([^"]*)"/i) || [])[1] || ''); const title = decode((m[0].match(/title="([^"]*)"/i) || [])[1] || '');
    const name = [txt, alt, title].filter((x) => x && !/^(logo|image)$/i.test(x)).sort((a, b) => b.length - a.length)[0] || '';
    const division = divisionToken((href.match(/\/((?:div|d)(?:[123]|I{1,3}))\//i) || [])[1]);
    const cur = by.get(slug);
    if (!cur) by.set(slug, { slug, name, href, division });
    else if (name.length > cur.name.length) cur.name = name;
  }
  return [...by.values()];
}

/** Outbound links from a page grouped by host (member athletics sites a region links to). */
export function outboundHosts(html, selfHost) {
  const hosts = new Map();
  for (const m of String(html).matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let h; try { h = new URL(m[1]).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
    if (!h || h === selfHost || /prestosports|presto-sport|facebook|twitter|x\.com|instagram|youtube|google|apple|tiktok|flickr|bootstrapcdn|cloudflare|jsdelivr|unpkg|njcaa\.org|tfrrs|clippd|claytarget/i.test(h)) continue;
    const label = stripTags(m[2]) || decode((m[2].match(/alt="([^"]*)"/i) || [])[1] || '');
    (hosts.get(h) || hosts.set(h, { host: h, labels: new Set(), urls: new Set() }).get(h)).labels.add(label);
    hosts.get(h).urls.add(m[1]);
  }
  return [...hosts.values()].map((x) => ({ host: x.host, labels: [...x.labels].filter(Boolean), urls: [...x.urls].slice(0, 3) }));
}

/** Generic HTML table -> rows keyed by normalised header. */
export function parseTables(html) {
  const out = [];
  for (const t of String(html).matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const tbl = t[0];
    const headRow = (tbl.match(/<thead[\s\S]*?<\/thead>/i) || [tbl.match(/<tr[\s\S]*?<\/tr>/i)?.[0] || ''])[0];
    const headers = [...headRow.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((h) => stripTags(h[1]).toLowerCase().replace(/[^a-z./ ]/g, '').trim());
    if (!headers.length) continue;
    const body = tbl.replace(headRow, '');
    const rows = [];
    for (const r of body.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      // Responsive Presto rosters (measured, Phase 8A pilot) print a MOBILE-ONLY duplicate cell
      // (`d-md-none`, e.g. the jersey badge) ahead of the desktop columns, and a hidden
      // "No.:"/"Pos.:" label span inside each cell. Unhandled, every column shifts one right and
      // player_name reads "No.:". Mobile-only cells are dropped when the row is wider than the
      // header; label spans never count as cell text.
      let cells = [...r[0].matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map((c) => ({ attrs: c[1], html: c[2], text: stripTags(c[2].replace(/<span[^>]*class="[^"]*\blabel\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ')) }));
      if (cells.length > headers.length) cells = cells.filter((c) => !/class="[^"]*\bd-md-none\b/.test(c.attrs));
      cells = cells.map(({ text, html }) => ({ text, html }));
      if (!cells.length) continue;
      const row = {}; headers.forEach((h, i) => { if (cells[i]) row[h || `col${i}`] = cells[i]; });
      rows.push(row);
    }
    out.push({ headers, rows });
  }
  return out;
}

const col = (row, ...keys) => { for (const k of Object.keys(row)) if (keys.some((x) => (x instanceof RegExp ? x.test(k) : k === x))) return row[k]; return null; };

/**
 * Roster players from a Presto (or generic tabular) roster page. FAIL-CLOSED since Phase 8B.1:
 * the semantic, structure-validated parser (rosterStructure.js) decides, and anything it cannot
 * validate yields NO records here. Use parseRosterTableStrict for the reason.
 */
export function parseRosterTable(html) {
  const { records, structure } = parseRosterTableStrict(html);
  return structure.code === STRUCTURE.OK ? records : [];
}

/** Staff from a Presto coaches page: name, title, and ONLY a printed mailto address. */
export function parseStaffTable(html) {
  const people = [];
  for (const t of parseTables(html)) {
    if (!t.headers.some((h) => /^name$/.test(h)) || !t.headers.some((h) => /title|position/.test(h))) continue;
    for (const r of t.rows) {
      const n = col(r, 'name')?.text; if (!n) continue;
      const cellHtml = Object.values(r).map((c) => c.html).join(' ');
      const mail = (cellHtml.match(/mailto:([^"'?\s>]+)/i) || [])[1] || null;
      people.push({ full_name: n, role: col(r, /title|position/)?.text || null, email: mail ? decodeURIComponent(mail).toLowerCase() : null, email_origin: mail ? 'PUBLISHED_ON_SOURCE' : 'NONE' });
    }
  }
  if (!people.length) people.push(...parseStaffCards(html));
  return people;
}

/**
 * The PrestoSports card theme (no table): each coach is a `.card` whose `.card-title` links to
 * /sports/<code>/coaches/<slug>; the first `.card-text` is the role; an email is taken ONLY from a
 * mailto inside that same card.
 */
export function parseStaffCards(html) {
  const people = [];
  const strip = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
  const starts = [...String(html).matchAll(/<div[^>]+class="[^"]*\bcard\b[^"]*"/gi)].map((m) => m.index);
  for (let i = 0; i < starts.length; i++) {
    const card = html.slice(starts[i], starts[i + 1] ?? starts[i] + 4000);
    const t = card.match(/class="[^"]*card-title[^"]*"[^>]*>\s*<a[^>]+href="[^"]*\/coaches\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i);
    if (!t) continue;
    const name = strip(t[1]); if (!name) continue;
    const role = (card.match(/class="[^"]*card-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || [])[1];
    const mail = (card.match(/mailto:([^"'?\s>]+)/i) || [])[1] || null;
    people.push({ full_name: name, role: role && !/mailto|fa-(envelope|phone)/i.test(role) ? strip(role) : null, email: mail ? decodeURIComponent(mail).toLowerCase() : null, email_origin: mail ? 'PUBLISHED_ON_SOURCE' : 'NONE' });
  }
  return people;
}
