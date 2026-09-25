/**
 * Whether a page that answered may be CALLED a roster, and how sure that is.
 *
 * This is the advisory verifier. It decides nothing that reaches an operator or
 * a database row — production acquisition runs its own gates over whatever it
 * fetches, and those remain authoritative. What this decides is where a stage
 * points its effort, and it has now pointed three of them at the wrong thing.
 *
 * ---------------------------------------------------------------------------
 * THREE STAGES MISLED, AND THE SAME SHAPE EACH TIME.
 *
 * L7E called Southwest Minnesota State READY on HTTP 200, the right host and 82
 * roster markers. The page was `Sonya Smith - Women's Soccer - SMSU Athletics`,
 * a women's bio at a men's-soccer path.
 *
 * L7F called Endicott's shapes ready on markers its navigation carries on every
 * page it serves.
 *
 * L7H was handed Wisconsin-Oshkosh as REDIRECT_TO_ROSTER. The page is real, the
 * host is right, the path names the sport asked for, and its title is
 * `2027 Men's Soccer Roster` — a programme that does not begin until next year,
 * served as an empty shell with nine table rows, none of them a person. The
 * site's own navigation says "Soccer (Coming in 2027)".
 *
 * In all three the verifier was reading the SITE and reporting on the PROGRAMME.
 * A 200 proves a server answered. A host proves ownership. Roster markup proves
 * the site has a roster feature. None of them is evidence about the squad, the
 * sport or the year that was asked for, and the production gates — not the
 * verifier — are what caught each one.
 *
 * ---------------------------------------------------------------------------
 * SO READY IS NOW A CLAIM ABOUT THE PROGRAMME.
 *
 *   READY    institution, sport AND a usable current roster are all evidenced
 *            by the page's own content.
 *   UNKNOWN  the host, path and status are plausible and the programme-specific
 *            evidence is missing or insufficient. Not a refusal — a page that
 *            renders its squad with script looks exactly like this, and
 *            `browse.py` exists for it.
 *   REFUSED  the page's own content contradicts what was asked: another
 *            institution, another sport, another season, or a known non-page.
 *
 * The asymmetry is deliberate. UNKNOWN costs an attempt that may succeed;
 * a wrong READY costs a stage. Absent evidence is never a reason to say READY
 * and never, on its own, a reason to refuse.
 *
 * It does not re-implement acquisition. It reads a title and counts entries.
 * Everything that decides whether a roster may be BELIEVED — the turnover gate,
 * the parser, source verification, provenance — still runs downstream on a page
 * this file has never been asked about.
 */

import { canonicalHost } from '../evidence/registryIntegrity.js';

/** How sure the page's own content makes us about the programme asked for. */
export const READINESS = Object.freeze({
  READY: 'READY',
  UNKNOWN: 'UNKNOWN',
  REFUSED: 'REFUSED',
});

/** The squad floor production applies. Fewer entries than this is not a roster. */
export const MIN_ROSTER_ENTRIES = 5;

const SPORT_WORDS = {
  'mens-soccer': { own: /\bmen'?s soccer\b/i, other: /\bwomen'?s soccer\b/i },
  'womens-soccer': { own: /\bwomen'?s soccer\b/i, other: /\bmen'?s soccer\b/i },
};

/** A 200 that is really a "not found" — the failure mode L6's audit named. */
const SOFT_404 = /page not found|404|cannot be found|no longer available/i;

/** `&#39;` and `&apos;` are how a title spells an apostrophe; nothing else is decoded. */
const decode = (s) => String(s ?? '').replace(/&#39;|&apos;|&rsquo;|&#8217;/g, "'").replace(/&amp;/g, '&');

/** The page's own headline for itself: og:title if it has one, else <title>. */
export function pageTitle(html) {
  const og = html.match(/<meta[^>]+(?:property|name)="og:title"[^>]*content="([^"]*)"/i)?.[1];
  const t = og ?? html.match(/<title[^>]*>([^<]{0,200})/i)?.[1] ?? '';
  return decode(t).replace(/\s+/g, ' ').trim();
}

/**
 * How many roster ENTRIES the page actually carries.
 *
 * TWO SIGNALS, BOTH CALIBRATED, AND NO CLASS-NAME COUNTING.
 *
 * Counting markup is the habit that produced every false READY, and it fails
 * here too if you let it: `sidearm-roster-player` appears three times in
 * Wisconsin-Oshkosh's empty shell — once on the container that holds no
 * players, twice inside a jQuery selector in an inline script — and not once in
 * Adrian's real roster of twenty-seven. A substring is not a person.
 *
 * So an entry is one of two things the corpus actually expresses a player with:
 *
 *   a bio link carrying a numeric id — `/roster/monica-arndt/30949`, which is
 *   how Sidearm and Nuxt name a squad member, and which site navigation
 *   (`/roster/coaches`) cannot accidentally look like; or
 *
 *   a table row of four or more non-empty cells — number, name, position,
 *   class, height, hometown — which is how Presto renders one, and which the
 *   one-cell `Statistic` rows a navigation table is built from cannot reach.
 *
 * The maximum rather than the sum, because a page expresses its squad one way.
 * Measured: Adrian 27, Northwood 38, Wisconsin-Oshkosh's shell 0.
 */
export function rosterEntries(html) {
  const bios = new Set(
    [...String(html).matchAll(/href="([^"]*\/roster\/[a-z][a-z0-9-]*\/\d+)"/gi)].map((m) => m[1]),
  ).size;
  let rows = 0;
  for (const [, body] of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...body.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (cells.length >= 4) rows += 1;
  }
  return Math.max(bios, rows);
}

/**
 * What season the page says it is, read from its own headline.
 *
 * `2026`, `2026-27` and `2026-2027` are the three spellings the corpus uses.
 * A title naming no year at all is not a refusal — plenty of live roster pages
 * omit it — it is simply no evidence, and no evidence cannot reach READY.
 */
export function titleSeason(title, season) {
  const years = [...String(title).matchAll(/\b(20\d\d)(?:\s*[-–/]\s*\d{2,4})?\b/g)];
  if (!years.length) return { stated: false, matches: false, said: null };
  const want = Number(season);
  // A span names its season by its FIRST year: `2026-27` is season 2026, which
  // is the same convention the candidate catalogue generates paths under.
  const matches = years.some(([, y]) => Number(y) === want);
  return { stated: true, matches, said: years.map((m) => m[0]).join(', ') };
}

/**
 * The verdict, from the page's own content and nothing else.
 *
 * `identityHost` is the institution the candidate was generated for. It is
 * passed rather than inferred because whose host it is was established by the
 * ledger long before this page was fetched, and re-deciding it here from a
 * title would be a second, weaker answer to a settled question.
 */
export function classifyReadiness({
  html = '', finalUrl = null, slug = null, sport = null, season = null,
  identityHost = null, status = 200,
} = {}) {
  const no = (reason) => ({ readiness: READINESS.REFUSED, reason, entries: 0, title: null });
  const maybe = (reason, extra) => ({ readiness: READINESS.UNKNOWN, reason, ...extra });

  if (status === 404) return no('the host says there is no such page');
  if (status === 403) return maybe('blocked before any page was served', { entries: 0, title: null });
  if (status !== 200) return maybe(`HTTP ${status}`, { entries: 0, title: null });

  // Whose page did we end up on? A redirect that leaves the institution is not
  // a roster for this programme however well-formed it looks.
  if (finalUrl && identityHost) {
    let landedHost = null;
    try { landedHost = canonicalHost(new URL(finalUrl).hostname); } catch { landedHost = null; }
    if (landedHost && landedHost !== canonicalHost(identityHost)) {
      return no(`redirected to another institution's host — ${landedHost}`);
    }
  }
  // Did we end up on the programme we asked for, or somewhere else on the site?
  if (finalUrl && slug) {
    let path = null;
    try { path = new URL(finalUrl).pathname; } catch { path = null; }
    if (path && !path.includes(`/sports/${slug}/`) && !path.endsWith(`/sports/${slug}`)) {
      return no(`redirected off the programme — ${path}`);
    }
  }

  const title = pageTitle(html);
  const entries = rosterEntries(html);

  if (SOFT_404.test(String(html).slice(0, 4000)) && !entries) {
    return no('a "not found" page answering with 200');
  }

  const words = SPORT_WORDS[sport];
  if (words) {
    if (words.other.test(title) && !words.own.test(title)) {
      return no(`the page names another programme — ${JSON.stringify(title.slice(0, 70))}`);
    }
    if (!words.own.test(title)) {
      return maybe('the page does not name the sport that was asked for', { entries, title });
    }
  }

  if (season != null) {
    const s = titleSeason(title, season);
    if (s.stated && !s.matches) {
      return no(`the page is season ${s.said}, not ${season}`);
    }
    if (!s.stated) return maybe('the page states no season', { entries, title });
  }

  if (entries < MIN_ROSTER_ENTRIES) {
    return maybe(
      `roster-shaped but carries ${entries} entr${entries === 1 ? 'y' : 'ies'}`,
      { entries, title },
    );
  }

  return { readiness: READINESS.READY, reason: null, entries, title };
}
