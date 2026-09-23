/**
 * L7ZG — did a stored season ever get its season from anything but the page?
 *
 *   RECRUITMATCH_DB=/path/to/a/COPY.sqlite node server/scripts/seasonIntegrityAudit.js
 *
 * L7ZF found two programmes whose stored 2025 squad is the same players as
 * their stored 2024 squad, both captured from a bare `/roster` route — the one
 * candidate shape whose meaning is "whatever the site serves now" rather than
 * "the season asked for". Those rows sit inside the 2022–2025 window Evidence
 * reads. Two examples are an anecdote; this is the measurement.
 *
 * READ-ONLY. It runs SELECTs and nothing else. There is no write path and no
 * flag that opens one, because the question this answers is whether a repair
 * is warranted at all — and an audit that could repair is an audit nobody can
 * point at production.
 *
 * ---------------------------------------------------------------------------
 * HIGH OVERLAP IS A DETECTOR, NOT A VERDICT, and the distinction is the whole
 * design. A real programme can return 90% of its squad; L7Q exists because
 * eight of them do. What makes a stored season doubtful is not that it
 * resembles its neighbour but that NOTHING SURVIVING SAYS WHICH SEASON THE
 * PAGE WAS. So every classification below needs two independent signals: a
 * resemblance, and an absence of season evidence. Neither alone decides.
 */
import { SEASONS } from '../../shared/philosophy.js';

const line = (s = '') => console.log(s);
const head = (s) => { line(); line(`=== ${s} ===`); };
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');

/** The pipeline's own name key, so overlap here means overlap there. */
export const nameKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * What a source URL asserts about its own season, by shape alone.
 *
 * Shape only — this says nothing about whether the page was truthful. An
 * explicit season path can still have served a fallback, which is exactly what
 * the seven PAGE_PRIOR_SEASON programmes demonstrated in L7ZF. It narrows the
 * question from "is this row right" to "did anything ever claim a season".
 *
 * Order is load-bearing. An archive URL contains a timestamp that looks like a
 * season path, and a player-bio URL sits under `/roster/` exactly as a season
 * does, so both are asked about before the generic shapes.
 */
export function routeClass(url) {
  const u = String(url ?? '').trim();
  if (!u) return 'E_UNKNOWN_OR_MISSING';
  if (/web\.archive\.org/i.test(u)) return 'B_EXPLICIT_SEASON_QUERY_OR_ARCHIVE';
  if (/[?&](season|year)=/i.test(u)) return 'B_EXPLICIT_SEASON_QUERY_OR_ARCHIVE';
  const path = u.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  // `/roster/<slug>` or `/roster/<slug>/<id>` — one athlete, not a squad.
  const bio = /\/roster\/([a-z0-9][a-z0-9\-.]*)(?:\/\d+)?$/i.exec(path);
  if (bio && !/^(?:20\d\d(?:-\d\d)?|season)$/i.test(bio[1])) return 'D_PLAYER_BIO_OR_NON_ROSTER';
  if (/\/20\d\d(?:-\d\d)?(?:\/|$)/.test(path)) return 'A_EXPLICIT_SEASON_PATH';
  if (/-20\d\d$/.test(path)) return 'A_EXPLICIT_SEASON_PATH';
  if (/\/roster$/i.test(path)) return 'C_BARE_CURRENT_ROUTE';
  return 'F_OTHER';
}

/** The season an A-class path spells, or null. */
export function seasonInUrl(url) {
  const path = String(url ?? '').replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
  const m = /\/(20\d\d)(?:-\d\d)?(?:\/|$)/.exec(path) || /-(20\d\d)$/.exec(path);
  return m ? m[1] : null;
}

const CLASSES = ['A_EXPLICIT_SEASON_PATH', 'B_EXPLICIT_SEASON_QUERY_OR_ARCHIVE',
  'C_BARE_CURRENT_ROUTE', 'D_PLAYER_BIO_OR_NON_ROSTER', 'E_UNKNOWN_OR_MISSING', 'F_OTHER'];

/* -------------------------------------------------------------------------- */
/* The report                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Everything below runs only when this file is the entry point.
 *
 * L7X found the same defect in the roster importer: work at module scope means
 * importing the module DOES the work. Its tests could not reach the pure parts
 * without running a full import, and a stray import ran one. The helpers above
 * are exported for tests; opening the database is part of the job, not part of
 * loading the file.
 */
export async function main() {
  // Imported HERE, not at module scope: opening the working database is part
  // of running the report, not part of loading the file.
  const { default: db } = await import('../db/client.js');
  /* -------------------------------------------------------------------------- */
  /* Phase 3 — the universe                                                      */
  /* -------------------------------------------------------------------------- */

  /*
   * Structurally valid identities only: a roster row whose `college_name` does
   * not equal a `colleges.name` for its sport is invisible to every join in the
   * product, so it is not a programme-season anyone can consume. Restricted to
   * NCAA because that is the population this roadmap has been completing.
   */
  const rows = db.prepare(`
    SELECT r.college_name, r.sport, r.season, r.division, r.player_name,
           r.source_roster_url, r.source_page_season, r.source_fetched_at, r.source_parser,
           r.data_confidence, r.notes
    FROM roster_players r
    JOIN colleges c ON c.name = r.college_name AND c.sport = r.sport
    WHERE r.season IN (${SEASONS.map(() => '?').join(',')})
      AND c.division LIKE 'NCAA %'
  `).all(...SEASONS);

  const ps = new Map();     // programme-season -> record
  for (const r of rows) {
    const k = `${r.college_name}||${r.sport}||${r.season}`;
    if (!ps.has(k)) {
      ps.set(k, { college_name: r.college_name, sport: r.sport, season: String(r.season),
        division: r.division, names: new Set(), urls: new Map(), rows: 0,
        pageSeason: 0, fetchedAt: 0, parser: 0 });
    }
    const g = ps.get(k);
    g.rows += 1;
    g.names.add(nameKey(r.player_name));
    const u = (r.source_roster_url ?? '').trim();
    g.urls.set(u, (g.urls.get(u) ?? 0) + 1);
    if (r.source_page_season) g.pageSeason += 1;
    if (r.source_fetched_at) g.fetchedAt += 1;
    if (r.source_parser) g.parser += 1;
  }
  /* One URL per programme-season: the one most of its rows carry. */
  for (const g of ps.values()) {
    g.url = [...g.urls.entries()].sort((a, b) => b[1] - a[1])[0][0];
    g.route = routeClass(g.url);
    g.urlSeason = seasonInUrl(g.url);
  }

  head('PHASE 3 — AUDIT UNIVERSE (NCAA, 2022-2025, structurally valid identities)');
  {
    const programmes = new Set([...ps.values()].map((g) => `${g.college_name}||${g.sport}`));
    line(`  programme-seasons ${ps.size}   programmes ${programmes.size}   rows ${rows.length}`);
    const by = (f) => {
      const c = new Map();
      for (const g of ps.values()) c.set(f(g), (c.get(f(g)) ?? 0) + 1);
      return [...c.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([k, n]) => `${k}:${n}`).join('  ');
    };
    line(`  by season    ${by((g) => g.season)}`);
    line(`  by sport     ${by((g) => g.sport)}`);
    line(`  by division  ${by((g) => g.division ?? '(none)')}`);
  }

  /* -------------------------------------------------------------------------- */
  /* Phase 4 — source route inventory                                            */
  /* -------------------------------------------------------------------------- */

  head('PHASE 4 — SOURCE ROUTE INVENTORY (shape only; A/B are not thereby trusted)');
  {
    const byClass = new Map(CLASSES.map((c) => [c, { ps: 0, rows: 0 }]));
    for (const g of ps.values()) {
      const b = byClass.get(g.route);
      b.ps += 1; b.rows += g.rows;
    }
    for (const c of CLASSES) {
      const b = byClass.get(c);
      line(`  ${c.padEnd(38)} programme-seasons ${String(b.ps).padStart(5)}  rows ${String(b.rows).padStart(7)}`);
    }
    line();
    line('  bare-current route by season:');
    for (const s of SEASONS) {
      const n = [...ps.values()].filter((g) => g.season === String(s) && g.route === 'C_BARE_CURRENT_ROUTE').length;
      const t = [...ps.values()].filter((g) => g.season === String(s)).length;
      line(`     ${s}  ${String(n).padStart(4)} of ${String(t).padStart(4)}  ${pct(n, t)}`);
    }
    line();
    /*
     * An A-class URL naming a season OTHER than the one the row is stored under.
     * The URL is not proof of the page, but a disagreement between the two things
     * we do have recorded is worth counting on its own.
     */
    const disagree = [...ps.values()].filter((g) => g.urlSeason && g.urlSeason !== g.season);
    line(`  A/B-class URL whose season differs from the stored season: ${disagree.length}`);
    for (const g of disagree.slice(0, 20)) {
      line(`     ${g.college_name}||${g.sport} stored ${g.season}  url says ${g.urlSeason}  ${g.url}`);
    }
    if (disagree.length > 20) line(`     ... and ${disagree.length - 20} more`);
    line('  A disagreement here indicts the URL as readily as the season. See the');
    line('  classification section, where it is corroborated before it is believed.');
  }

  /* -------------------------------------------------------------------------- */
  /* Phase 5 — provenance availability                                           */
  /* -------------------------------------------------------------------------- */

  head('PHASE 5 — L7Z PROVENANCE AVAILABILITY (never backfilled, by design)');
  {
    let withSeason = 0; let withFetched = 0; let withParser = 0; let total = 0;
    for (const g of ps.values()) {
      total += g.rows; withSeason += g.pageSeason; withFetched += g.fetchedAt; withParser += g.parser;
    }
    line(`  rows ${total}`);
    line(`    source_page_season known ${withSeason}  unknown ${total - withSeason}`);
    line(`    source_fetched_at  known ${withFetched}  unknown ${total - withFetched}`);
    line(`    source_parser      known ${withParser}  unknown ${total - withParser}`);
    line();
    line('  by season   (known / rows)');
    for (const s of SEASONS) {
      const g = [...ps.values()].filter((x) => x.season === String(s));
      const r = g.reduce((a, x) => a + x.rows, 0);
      const k = g.reduce((a, x) => a + x.pageSeason, 0);
      line(`     ${s}  ${String(k).padStart(6)} / ${String(r).padStart(6)}   ${pct(k, r)}`);
    }
    line();
    line('  => no historical row can be asked what season its page claimed.');
    line('     That is L7Z working as specified (unknown stays unknown) and it is');
    line('     also the reason this audit cannot settle a case from provenance alone.');
  }

  /* -------------------------------------------------------------------------- */
  /* Phase 6/7 — consecutive-season overlap                                      */
  /* -------------------------------------------------------------------------- */

  const pairs = [];
  {
    const byProg = new Map();
    for (const g of ps.values()) {
      const k = `${g.college_name}||${g.sport}`;
      if (!byProg.has(k)) byProg.set(k, new Map());
      byProg.get(k).set(g.season, g);
    }
    const ORDER = SEASONS.map(String);
    for (const [prog, seasons] of byProg) {
      for (let i = 0; i < ORDER.length - 1; i += 1) {
        const a = seasons.get(ORDER[i]); const b = seasons.get(ORDER[i + 1]);
        if (!a || !b) continue;
        const inter = [...b.names].filter((n) => a.names.has(n)).length;
        const union = new Set([...a.names, ...b.names]).size;
        pairs.push({
          prog, from: ORDER[i], to: ORDER[i + 1], a, b,
          inter, prevN: a.names.size, nextN: b.names.size,
          // Directional, and `forward` is the one the turnover gate uses: how
          // much of the NEW squad is the OLD one.
          forward: b.names.size ? inter / b.names.size : 0,
          backward: a.names.size ? inter / a.names.size : 0,
          jaccard: union ? inter / union : 0,
          identical: a.names.size === b.names.size && inter === a.names.size,
          sameUrl: a.url === b.url && a.url !== '',
          bothBare: a.route === 'C_BARE_CURRENT_ROUTE' && b.route === 'C_BARE_CURRENT_ROUTE',
          toBare: b.route === 'C_BARE_CURRENT_ROUTE',
          bothExplicitDistinct: a.route === 'A_EXPLICIT_SEASON_PATH'
            && b.route === 'A_EXPLICIT_SEASON_PATH' && a.url !== b.url,
        });
      }
    }
  }

  const GATE = 0.85;   // the existing turnover threshold, used as a DIAGNOSTIC

  head('PHASE 6/7 — CONSECUTIVE-SEASON OVERLAP (0.85 as a detector, not a verdict)');
  {
    line(`  adjacent season pairs ${pairs.length}`);
    const band = (lo, hi) => pairs.filter((p) => p.forward >= lo && p.forward < hi).length;
    line(`    forward overlap  <0.50            ${band(0, 0.5)}`);
    line(`    forward overlap  0.50 - <0.70     ${band(0.5, 0.7)}`);
    line(`    forward overlap  0.70 - <0.85     ${band(0.7, 0.85)}`);
    line(`    forward overlap  >=0.85           ${pairs.filter((p) => p.forward >= GATE).length}`);
    line(`    exact player-set equality         ${pairs.filter((p) => p.identical).length}`);
    line();
    const hot = pairs.filter((p) => p.forward >= GATE);
    const tally = (f) => {
      const c = new Map();
      for (const p of hot) c.set(f(p), (c.get(f(p)) ?? 0) + 1);
      return [...c.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}:${n}`).join('  ');
    };
    line(`  >=0.85 by transition   ${tally((p) => `${p.from}->${p.to}`)}`);
    line(`  >=0.85 by division     ${tally((p) => p.b.division ?? '(none)')}`);
    line(`  >=0.85 by sport        ${tally((p) => p.b.sport)}`);
    line(`  >=0.85 by route of the LATER season   ${tally((p) => p.b.route)}`);
  }

  /* -------------------------------------------------------------------------- */
  /* Phase 8 — source reuse                                                      */
  /* -------------------------------------------------------------------------- */

  head('PHASE 8 — SOURCE REUSE ACROSS THE PAIR');
  {
    const hot = pairs.filter((p) => p.forward >= GATE);
    line(`  of ${hot.length} pairs at or above ${GATE}:`);
    line(`    both seasons from DISTINCT explicit season URLs   ${hot.filter((p) => p.bothExplicitDistinct).length}`);
    line(`    both seasons from the SAME bare current route     ${hot.filter((p) => p.bothBare && p.sameUrl).length}`);
    line(`    both seasons from the SAME exact URL (any shape)  ${hot.filter((p) => p.sameUrl).length}`);
    line(`    later season from a bare current route            ${hot.filter((p) => p.toBare).length}`);
    line(`    either season missing a source URL                ${hot.filter((p) => !p.a.url || !p.b.url).length}`);
    line();
    line('  The same split across ALL pairs, for a baseline:');
    line(`    both DISTINCT explicit season URLs                ${pairs.filter((p) => p.bothExplicitDistinct).length}`);
    line(`    SAME exact URL                                    ${pairs.filter((p) => p.sameUrl).length}`);
    line(`    later season bare                                 ${pairs.filter((p) => p.toBare).length}`);
  }

  /* -------------------------------------------------------------------------- */
  /* Phase 9/12 — classification                                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * Two independent signals, never one.
   *
   * `resembles` is the detector: the later season is largely or entirely the
   * earlier one. `unproven` is the absence: nothing surviving asserts which
   * season the page was — no L7Z provenance, and a route that makes no season
   * claim of its own.
   *
   * A pair needs BOTH to be called probable. A pair with resemblance and two
   * distinct official season URLs is a programme that kept its squad, which is
   * an ordinary thing for a programme to do.
   */
  function classifyPair(p, resemblesUrlSeason) {
    const provenance = p.b.pageSeason > 0;
    const routeAsserts = p.b.route === 'A_EXPLICIT_SEASON_PATH'
      || p.b.route === 'B_EXPLICIT_SEASON_QUERY_OR_ARCHIVE';
    const urlDisagrees = Boolean(p.b.urlSeason && p.b.urlSeason !== p.b.season);

    /*
     * E NEEDS TWO SIGNALS TOO, and this is where the first draft of this file
     * was wrong. It called every URL/season disagreement a definite mismatch and
     * reported five, all Clemson. They are not mismatches:
     *
     *   - Clemson's stored seasons decay normally against each other (55-76%
     *     adjacent, falling with distance), which is what real consecutive
     *     squads look like and not what a shifted chain looks like.
     *   - Two of Clemson men's stored seasons came from DATED Wayback captures
     *     (2024-10-07 and 2025-11-27). An archive timestamp is the one piece of
     *     season evidence a site cannot retroactively change, and both anchor
     *     exactly where they are stored.
     *   - Clemson women's 2024 and 2025 carry the SAME `season/2025` URL while
     *     holding squads that overlap only 57%. One of those URL records must
     *     be wrong, which is direct evidence that the URL is the unreliable
     *     field here rather than the label.
     *
     * So a recorded URL naming another season is a reason to doubt the URL, not
     * automatically the season. E now also requires the rows to LOOK like the
     * season the URL names — measured against that programme's own stored rows
     * for that season. Without the corroboration it is C: unproven, not wrong.
     */
    if (urlDisagrees && resemblesUrlSeason) return 'E_DEFINITE_MISMATCH';
    if (urlDisagrees) return 'C_SEASON_IDENTITY_UNPROVEN';
    if (p.forward < GATE) {
      // Not a resemblance case at all. Still worth separating the rows whose
      // season nothing asserts, because that is a different question.
      return (provenance || routeAsserts) ? 'A_VERIFIED_DISTINCT' : 'C_SEASON_IDENTITY_UNPROVEN';
    }
    if (provenance || routeAsserts) return 'B_HIGH_OVERLAP_BUT_PLAUSIBLE';
    if (!p.b.url) return 'F_UNRESOLVABLE_LEGACY';
    return 'D_PROBABLE_DUPLICATE_CAPTURE';
  }

  /**
   * Does the later season's squad look like the programme's OWN rows for the
   * season its URL names? The corroboration E requires.
   *
   * Null when there is nothing to compare against — a programme with no stored
   * rows for that season cannot corroborate or refute, and null must not read as
   * agreement.
   */
  function resemblance(p, byProgSeason) {
    if (!p.b.urlSeason || p.b.urlSeason === p.b.season) return null;
    const other = byProgSeason.get(`${p.prog}||${p.b.urlSeason}`);
    if (!other || !other.names.size) return null;
    const inter = [...p.b.names].filter((n) => other.names.has(n)).length;
    return p.b.names.size ? inter / p.b.names.size : 0;
  }

  head('PHASE 9/12 — CLASSIFICATION OF ADJACENT PAIRS');
  {
    const byProgSeason = new Map([...ps.entries()]);
    const c = new Map();
    for (const p of pairs) {
      p.resembles = resemblance(p, byProgSeason);
      p.klass = classifyPair(p, p.resembles !== null && p.resembles >= GATE);
      c.set(p.klass, (c.get(p.klass) ?? 0) + 1);
    }
    for (const k of ['A_VERIFIED_DISTINCT', 'B_HIGH_OVERLAP_BUT_PLAUSIBLE',
      'C_SEASON_IDENTITY_UNPROVEN', 'D_PROBABLE_DUPLICATE_CAPTURE',
      'E_DEFINITE_MISMATCH', 'F_UNRESOLVABLE_LEGACY']) {
      line(`  ${k.padEnd(34)} ${String(c.get(k) ?? 0).padStart(5)}`);
    }
    line();
    const strong = pairs.filter((p) => p.klass === 'D_PROBABLE_DUPLICATE_CAPTURE'
      || p.klass === 'E_DEFINITE_MISMATCH');
    line(`  STRONG CANDIDATES (D + E): ${strong.length}`);
    line();
    if (strong.length) {
      line('  programme                                          sport          pair       fwd   ident  corrob  route(later)         url(later)');
      for (const p of strong.sort((x, y) => y.forward - x.forward || x.prog.localeCompare(y.prog))) {
        const [school, sport] = p.prog.split('||');
        line(`  ${school.slice(0, 48).padEnd(50)} ${sport.padEnd(14)} ${p.from}->${p.to}  `
          + `${(p.forward * 100).toFixed(0).padStart(4)}%  ${p.identical ? 'YES' : ' no'}   `
          + `${(p.resembles === null ? '  —  ' : `${(p.resembles * 100).toFixed(0)}%`).padStart(5)}  `
          + `${p.b.route.replace(/^._/, '').slice(0, 18).padEnd(20)} ${p.b.url}`);
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Phase 14/15 — exposure                                                      */
  /* -------------------------------------------------------------------------- */

  head('PHASE 14/15 — WHAT A SUSPECT SEASON REACHES');
  {
    const strong = pairs.filter((p) => p.klass === 'D_PROBABLE_DUPLICATE_CAPTURE'
      || p.klass === 'E_DEFINITE_MISMATCH');
    const suspect = new Set(strong.map((p) => `${p.prog}||${p.to}`));
    line(`  suspect programme-seasons ${suspect.size}`);
    const inPool = [...suspect].filter((k) => SEASONS.map(String).includes(k.split('||')[2]));
    line(`  inside the 2022-2025 pool window ${inPool.length} of ${suspect.size}`);
    const progs = new Set([...suspect].map((k) => k.split('||').slice(0, 2).join('||')));
    line(`  distinct programmes ${progs.size}`);
    for (const k of [...suspect].sort()) line(`     ${k}`);
  }

  line();
  line('  Read-only. Nothing was written.');
  line();
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
