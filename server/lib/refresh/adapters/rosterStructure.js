/**
 * ROSTER STRUCTURE VALIDATION — Phase 8B.1. Parsers FAIL CLOSED.
 *
 * Phase 8A's pilot showed that markup variation is a live corruption risk. A responsive
 * Presto table printed a mobile-only cell and hidden "No.:" labels, which shifted every
 * column one place right. Parsed naively, every player's name read "No.:". So:
 *   - columns are mapped by HEADER MEANING, never by position;
 *   - a roster table must carry a name column plus at least one supporting roster column
 *     (number / position / class / height / hometown);
 *   - any row whose width does not match the header row, or any "name" that is a label,
 *     a number or blank, makes the WHOLE page PARSER_STRUCTURE_UNKNOWN (never a partial
 *     set of fabricated observations);
 *   - a page carrying roster markup the parser does not understand (a card theme, an
 *     unrecognised table) is PARSER_STRUCTURE_UNKNOWN, not "zero players";
 *   - a recognised roster table with no rows is an EMPTY roster: a ZERO refusal, and never
 *     evidence that anyone left.
 * Pure functions: no fetching, no writing.
 */
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: '-', mdash: '-', hellip: '...',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', yacute: 'ý', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù', acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', ntilde: 'ñ', Ntilde: 'Ñ', ccedil: 'ç', Ccedil: 'Ç',
  atilde: 'ã', otilde: 'õ', aring: 'å', oslash: 'ø', aelig: 'æ', szlig: 'ß' };
/** Decode every numeric entity and the named ones rosters actually print (accented names). */
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in NAMED ? NAMED[n] : m))
    .replace(/\s+/g, ' ').trim();
}
const LABEL_SPAN = /<span[^>]*class="[^"]*\b(?:label|sr-only|visually-hidden)\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi;
// print-only duplicates (`d-none d-print-block`, measured on Presto list views) and `inert` copies repeat
// the visible text; they never count as cell text
const PRINT_ONLY = /<(div|span)\b[^>]*class="[^"]*\bd-none\b[^"]*\bd-print-(?:block|inline|inline-block|flex|table-cell)\b[^"]*"[^>]*>[\s\S]*?<\/\1>|<(div|span)\b[^>]*\binert\b[^>]*>[\s\S]*?<\/\3>/gi;
const cellText = (h) => decodeEntities(String(h).replace(PRINT_ONLY, ' ').replace(LABEL_SPAN, ' ').replace(/<[^>]+>/g, ' '));

export const STRUCTURE = Object.freeze({ OK: 'OK', EMPTY: 'EMPTY_ROSTER', UNKNOWN: 'PARSER_STRUCTURE_UNKNOWN', NONE: 'NO_ROSTER_MARKUP' });

/** A header's meaning, or null. Semantic only — the column's POSITION never decides. */
export function headerRole(h) {
  const t = String(h || '').toLowerCase().replace(/[^a-z#/ .]/g, '').trim();
  if (/^(name|player|full name|player name|athlete)$/.test(t)) return 'name';
  if (/^(no\.?|#|number|jersey|num\.?)$/.test(t)) return 'number';
  if (/^(pos\.?|position)$/.test(t)) return 'position';
  if (/^(cl\.?|class|yr\.?|year|academic year|elig\.?|eligibility|grade)$/.test(t)) return 'class';
  if (/^(ht\.?|height)$/.test(t)) return 'height';
  if (/^(wt\.?|weight)$/.test(t)) return 'weight';
  if (/hometown|high school|previous school|last school|home town/.test(t)) return 'hometown';
  if (/^(nationality|country|nation)$/.test(t)) return 'nationality';
  if (/^(major|b\/t|bats|throws)$/.test(t)) return 'other';
  return null;
}
const LABEL_NAME = /^(no|#|name|player|pos|position|cl|class|yr|year|ht|wt|hometown|high school)\.?:?$/i;
/** Why a parsed "name" cannot be a person's name (null = plausible). */
export function implausibleName(n) {
  const s = String(n || '').trim();
  if (!s) return 'blank';
  if (LABEL_NAME.test(s) || /:$/.test(s)) return 'label';
  if (!/\p{L}.*\p{L}/u.test(s)) return 'no letters';
  if (/^\d+$/.test(s.replace(/\s/g, ''))) return 'number';
  if (s.length > 60) return 'too long';
  { const w = s.split(/\s+/); const h = w.length / 2; if (w.length >= 4 && w.length % 2 === 0 && w.slice(0, h).join(' ').toLowerCase() === w.slice(h).join(' ').toLowerCase()) return 'duplicated'; }
  if (/\b(head coach|assistant coach|goalkeeper coach|director of|athletic trainer)\b/i.test(s)) return 'staff title';
  return null;
}

function tablesOf(html) {
  const out = [];
  for (const t of String(html).matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const tbl = t[0];
    const headRow = (tbl.match(/<thead[\s\S]*?<\/thead>/i) || [tbl.match(/<tr[\s\S]*?<\/tr>/i)?.[0] || ''])[0];
    const headCells = [...headRow.matchAll(/<th([^>]*)>([\s\S]*?)<\/th>|<td([^>]*)>([\s\S]*?)<\/td>/gi)].map((m) => ({ attrs: m[1] ?? m[3] ?? '', text: cellText(m[2] ?? m[4] ?? '') }));
    // a thead with grouped header rows: use its LAST row as the column header row
    const lastHead = [...headRow.matchAll(/<tr[\s\S]*?<\/tr>/gi)].pop()?.[0];
    const hc = lastHead ? [...lastHead.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map((m) => ({ attrs: m[1], text: cellText(m[2]) })) : headCells;
    const headers = hc.filter((c) => !/aria-hidden="true"/.test(c.attrs)).map((c) => c.text);
    const body = tbl.replace(headRow, '');
    const rows = [...body.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map((c) => ({ attrs: c[1], html: c[2], text: cellText(c[2]) }))).filter((cells) => cells.length);
    out.push({ headers, rows });
  }
  return out;
}

/**
 * Tabular roster (Presto table themes, Sidearm table view, custom tables).
 * -> { records, structure: { code, detail } }
 */
export function parseRosterTableStrict(html) {
  const tables = tablesOf(html);
  const roleSets = tables.map((t) => t.headers.map(headerRole));
  const idx = roleSets.findIndex((roles) => roles.includes('name') && roles.some((r) => ['number', 'position', 'class', 'height', 'hometown'].includes(r)));
  const rosterish = /class="[^"]*\b(roster|sidearm-roster|s-person-card|player-card|roster-card)\b/i.test(String(html));
  if (idx < 0) {
    if (tables.some((t, i) => roleSets[i].includes('name')) || rosterish) return { records: [], structure: { code: STRUCTURE.UNKNOWN, detail: 'roster markup present but no table with a name column and a supporting roster column' } };
    return { records: [], structure: { code: STRUCTURE.NONE, detail: 'no roster markup on the page' } };
  }
  const { headers, rows } = tables[idx]; const roles = roleSets[idx];
  if (roles.filter((r) => r === 'name').length !== 1) return { records: [], structure: { code: STRUCTURE.UNKNOWN, detail: 'more than one name column' } };
  const records = []; const problems = [];
  for (const [i, raw] of rows.entries()) {
    // responsive duplicates: mobile-only cells appear only when the row is wider than the header
    let cells = raw.length > headers.length ? raw.filter((c) => !/class="[^"]*\bd-(?:sm|md|lg)-none\b/.test(c.attrs)) : raw;
    if (cells.length === 1 && /colspan/i.test(cells[0].attrs)) continue; // a group/section heading row
    if (cells.length !== headers.length) { problems.push(`row ${i + 1}: ${cells.length} cells for ${headers.length} headers`); continue; }
    const get = (role) => { const k = roles.indexOf(role); return k < 0 ? null : (cells[k].text || null); };
    const name = (get('name') || '').replace(/\s+#?\d+$/, '').trim();
    const why = implausibleName(name);
    if (why) { problems.push(`row ${i + 1}: name is ${why}`); continue; }
    records.push({ player_name: name, position: get('position'), class_year_label: get('class'), hometown: get('hometown'), nationality: get('nationality') });
  }
  if (problems.length) return { records: [], structure: { code: STRUCTURE.UNKNOWN, detail: `${problems.length} row(s) failed structural validation — ${problems.slice(0, 3).join('; ')}` } };
  if (!records.length) return { records: [], structure: { code: STRUCTURE.EMPTY, detail: 'recognised roster table with no player rows' } };
  return { records, structure: { code: STRUCTURE.OK, detail: `table columns: ${headers.map((h, k) => `${h}=${roles[k] || '-'}`).join(', ')}` } };
}

/** Validate records a non-tabular parser produced (Sidearm list/card markup). */
export function validateRecords(records, { markupSeen }) {
  if (!records.length) return markupSeen ? { code: STRUCTURE.UNKNOWN, detail: 'roster markup present but no player could be read' } : { code: STRUCTURE.NONE, detail: 'no roster markup on the page' };
  const bad = records.map((r, i) => [i, implausibleName(r.player_name)]).filter(([, w]) => w);
  if (bad.length) return { code: STRUCTURE.UNKNOWN, detail: `${bad.length} record(s) with an implausible name (${bad.slice(0, 3).map(([i, w]) => `#${i + 1} ${w}`).join(', ')})` };
  return { code: STRUCTURE.OK, detail: `${records.length} records` };
}

/**
 * PRESTO PLAYER-CARD THEME (Phase 8B.1 Part J). Measured on 11 NJCAA rosters: the default view
 * renders `.player-card` headshot cards and no table, and the page itself declares a list view
 * (`<a class="roster-view" data-view="list" href="...?view=list">`) that renders the standard
 * roster table. The adapter follows THAT declared link and reads the table with the validated
 * semantic parser; the cards are used only as a cross-check (count and names must agree).
 * Card fields (position, class) are never read positionally.
 */
export function prestoListViewHref(html) {
  const m = String(html || '').match(/<a\b[^>]*class="[^"]*\broster-view\b[^"]*"[^>]*data-view="list"[^>]*href="([^"]+)"|<a\b[^>]*data-view="list"[^>]*class="[^"]*\broster-view\b[^"]*"[^>]*href="([^"]+)"/i);
  return m ? decodeEntities(m[1] || m[2]) : null;
}
/** Names printed on the player cards (first + last name spans), for cross-checking only. */
export function prestoCardNames(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/class="[^"]*\bplayer-card-wrapper\b[\s\S]*?class="[^"]*\bfirstname\b[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?class="[^"]*\blastname\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)) {
    out.push(decodeEntities(`${m[1].replace(/<[^>]+>/g, ' ')} ${m[2].replace(/<[^>]+>/g, ' ')}`));
  }
  return out;
}
/** Cross-check a list-view table parse against the card view it came from. */
export function crossCheckCards(listParse, cardNames) {
  if (listParse.structure.code !== STRUCTURE.OK) return listParse;
  if (!cardNames.length) return listParse;
  // order-insensitive letters (cards print first + last; a list may print "Last, First"): a cross-check, never an identity
  const key = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '').split('').sort().join('');
  const listed = new Set(listParse.records.map((r) => key(r.player_name)));
  const missing = cardNames.filter((n) => !listed.has(key(n)));
  if (cardNames.length !== listParse.records.length || missing.length) return { records: [], structure: { code: STRUCTURE.UNKNOWN, detail: `list view (${listParse.records.length}) disagrees with the card view (${cardNames.length}); ${missing.length} card name(s) not in the list` } };
  return { records: listParse.records, structure: { code: STRUCTURE.OK, detail: `${listParse.structure.detail}; cross-checked against ${cardNames.length} player cards` } };
}
