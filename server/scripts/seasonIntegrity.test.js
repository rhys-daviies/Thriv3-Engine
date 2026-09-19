import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { routeClass, seasonInUrl, nameKey } from './seasonIntegrityAudit.js';

/**
 * L7ZG — what a stored season rests on.
 *
 * L7ZF found two programmes whose stored 2025 squad is the same players as
 * their stored 2024 squad, both captured from a bare `/roster` route. The
 * audit beside this file measured the population; these pin the reasoning it
 * used, because the reasoning is the part that can be got wrong quietly.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO DEFEND: neither signal decides alone.
 *
 * A high overlap is a DETECTOR. A programme can return 90% of its squad, and
 * L7Q exists because eight of them do — calling those corrupt would delete
 * real seasons. A recorded URL naming another season is likewise a reason to
 * doubt the URL, not automatically the label: the first draft of the audit
 * called every such disagreement a definite mismatch and reported five, all
 * Clemson, all wrong. Clemson's stored seasons decay normally against each
 * other, two of them are anchored to DATED Wayback captures, and two share one
 * URL while holding squads that overlap 57% — which indicts the URL record
 * rather than the season.
 *
 * So a case is only called probable when a resemblance and an absence of
 * season evidence appear together, and only called definite when the rows
 * additionally LOOK like the season the other evidence names.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE = path.resolve(HERE, '../../tools/roster_pipeline');
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

/* -------------------------------------------------------------------------- */
/* Route shape — what a recorded URL claims about its own season               */
/* -------------------------------------------------------------------------- */

describe('L7ZG — the audit does nothing when imported', () => {
  it('exports its helpers without opening a database or printing a report', async () => {
    /*
     * L7X found this exact defect in the roster importer: work at module scope
     * means importing the module DOES the work, so its pure parts could not be
     * tested and a stray import ran a full job. This file imports the audit at
     * the top; if the report were at module scope it would already have run
     * against whatever database the test environment happened to name.
     */
    const m = await import('./seasonIntegrityAudit.js');
    expect(typeof m.main).toBe('function');
    expect(Object.keys(m).sort()).toEqual(['main', 'nameKey', 'routeClass', 'seasonInUrl']);
  });
});

describe('L7ZG — source route classification', () => {
  it('separates a season-bearing path from a bare current route', () => {
    /*
     * The distinction the whole audit turns on. `/roster/2025` asserts a
     * season; `/roster` asserts only "whatever the site serves now", which is
     * a different fact and becomes a different season every August.
     */
    expect(routeClass('https://x.com/sports/mens-soccer/roster/2025')).toBe('A_EXPLICIT_SEASON_PATH');
    expect(routeClass('https://x.com/sports/mens-soccer/roster/2025-26')).toBe('A_EXPLICIT_SEASON_PATH');
    expect(routeClass('https://x.com/sports/mens-soccer/roster')).toBe('C_BARE_CURRENT_ROUTE');
    expect(routeClass('https://x.com/sports/mens-soccer/roster/')).toBe('C_BARE_CURRENT_ROUTE');
  });

  it('reads an archive capture as season-bearing, not as a 2024 path', () => {
    // A Wayback URL contains a timestamp that matches the season-path shape,
    // and it is asked about FIRST. The timestamp is also the strongest season
    // evidence in the dataset: a site cannot revise when it was captured.
    const u = 'https://web.archive.org/web/20241007161208id_/https://x.com/sports/mens-soccer/roster/';
    expect(routeClass(u)).toBe('B_EXPLICIT_SEASON_QUERY_OR_ARCHIVE');
  });

  it('reads a season query as season-bearing', () => {
    expect(routeClass('https://x.com/sports/w-soccer/roster/season/2025?view=table'))
      .toBe('A_EXPLICIT_SEASON_PATH');
    expect(routeClass('https://x.com/roster?season=2025'))
      .toBe('B_EXPLICIT_SEASON_QUERY_OR_ARCHIVE');
  });

  it('does not mistake a player bio for a season', () => {
    /*
     * `/roster/<slug>` and `/roster/<year>` are the same shape. L7W needed the
     * same distinction for archived references and got it wrong first: every
     * season-pinned page classified as a bio. The slug is what separates them.
     */
    expect(routeClass('https://x.com/sports/mens-soccer/roster/jo-nash')).toBe('D_PLAYER_BIO_OR_NON_ROSTER');
    expect(routeClass('https://x.com/sports/mens-soccer/roster/jo-nash/1234')).toBe('D_PLAYER_BIO_OR_NON_ROSTER');
    expect(routeClass('https://x.com/sports/mens-soccer/roster/2025')).toBe('A_EXPLICIT_SEASON_PATH');
  });

  it('treats a missing URL as unknown rather than as anything else', () => {
    expect(routeClass(null)).toBe('E_UNKNOWN_OR_MISSING');
    expect(routeClass('')).toBe('E_UNKNOWN_OR_MISSING');
    expect(routeClass('   ')).toBe('E_UNKNOWN_OR_MISSING');
  });

  it('extracts the season a path spells, and nothing from one that spells none', () => {
    expect(seasonInUrl('https://x.com/sports/m-soccer/roster/2023')).toBe('2023');
    expect(seasonInUrl('https://x.com/sports/m-soccer/roster/season/2024?view=table')).toBe('2024');
    expect(seasonInUrl('https://x.com/sports/m-soccer/soccer-roster-2022')).toBe('2022');
    expect(seasonInUrl('https://x.com/sports/m-soccer/roster')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The detector, and why it is only a detector                                 */
/* -------------------------------------------------------------------------- */

/** The audit's overlap, reproduced over two squads. */
function overlap(prev, next) {
  const a = new Set(prev.map(nameKey));
  const b = new Set(next.map(nameKey));
  const inter = [...b].filter((n) => a.has(n)).length;
  return { forward: b.size ? inter / b.size : 0, identical: a.size === b.size && inter === a.size };
}

const SQUAD = ['Ada Rivers', 'Bree Thorne', 'Cleo Vance', 'Dana Fox', 'Eve Marsh', 'Fay Quill',
  'Gia Holt', 'Hana Reed', 'Iris Poole', 'Jo Nash'];

describe('L7ZG — high overlap detects, it does not convict', () => {
  it('a programme that keeps 90% of its squad is an ordinary programme', () => {
    /*
     * Eight real programmes sit at 85-92% and every one was kept by L7Q's
     * graduation-year rule. If overlap alone decided, this audit would call
     * them corrupt — which is why the classifier needs a second signal.
     */
    const next = [...SQUAD.slice(0, 9), 'New Arrival'];
    const o = overlap(SQUAD, next);
    expect(o.forward).toBeGreaterThanOrEqual(0.85);
    expect(o.identical).toBe(false);
  });

  it('an exact duplicate player set is the strongest form of the detector', () => {
    const o = overlap(SQUAD, [...SQUAD]);
    expect(o.forward).toBe(1);
    expect(o.identical).toBe(true);
  });

  it('name normalisation matches the pipeline, so overlap means the same thing', () => {
    // The gate's own key: letters only, lowercased. Punctuation and case must
    // not make one squad look like two.
    expect(nameKey("D'Andre O'Neill-Smith")).toBe('dandreoneillsmith');
    expect(overlap(["D'Andre O'Neill"], ['DAndre ONeill']).identical).toBe(true);
  });

  it('a normal season decays: adjacent high, distant low', () => {
    /*
     * The shape that cleared Clemson. A shifted or duplicated chain does not
     * decay; it repeats. Pinned because "the overlaps looked normal" is a
     * finding, and a finding stated only in prose is a finding nobody can
     * re-run.
     */
    const y1 = SQUAD;
    const y2 = [...SQUAD.slice(3), 'P', 'Q', 'R'];
    const y3 = [...SQUAD.slice(7), 'P', 'Q', 'R', 'S', 'T', 'U'];
    expect(overlap(y1, y2).forward).toBeGreaterThan(overlap(y1, y3).forward);
  });
});

describe('L7ZG — two signals, never one', () => {
  /*
   * The classifier reproduced at fixture scale. `resembles` is the detector,
   * `asserts` is whether anything surviving claims the season.
   */
  const classify = ({ forward, route, pageSeason, urlSeason, storedSeason, resemblesUrlSeason }) => {
    const asserts = pageSeason || route === 'A_EXPLICIT_SEASON_PATH'
      || route === 'B_EXPLICIT_SEASON_QUERY_OR_ARCHIVE';
    const urlDisagrees = Boolean(urlSeason && urlSeason !== storedSeason);
    if (urlDisagrees && resemblesUrlSeason) return 'E_DEFINITE_MISMATCH';
    if (urlDisagrees) return 'C_SEASON_IDENTITY_UNPROVEN';
    if (forward < 0.85) return asserts ? 'A_VERIFIED_DISTINCT' : 'C_SEASON_IDENTITY_UNPROVEN';
    return asserts ? 'B_HIGH_OVERLAP_BUT_PLAUSIBLE' : 'D_PROBABLE_DUPLICATE_CAPTURE';
  };

  it('high overlap from two DISTINCT explicit season URLs is plausible, not probable', () => {
    expect(classify({ forward: 0.92, route: 'A_EXPLICIT_SEASON_PATH', storedSeason: '2024' }))
      .toBe('B_HIGH_OVERLAP_BUT_PLAUSIBLE');
  });

  it('high overlap from a bare current route with no provenance is probable', () => {
    // The ENMU/SFSU shape: the squad repeats AND nothing says which season.
    expect(classify({ forward: 1.0, route: 'C_BARE_CURRENT_ROUTE', storedSeason: '2025' }))
      .toBe('D_PROBABLE_DUPLICATE_CAPTURE');
  });

  it('a bare route WITHOUT high overlap is unproven, not probable', () => {
    // Absence of evidence is its own class. 82 programme-seasons are here and
    // not one of them is being called wrong.
    expect(classify({ forward: 0.55, route: 'C_BARE_CURRENT_ROUTE', storedSeason: '2025' }))
      .toBe('C_SEASON_IDENTITY_UNPROVEN');
  });

  it('a URL naming another season is unproven until the rows corroborate it', () => {
    /*
     * THE CLEMSON CORRECTION. Same inputs, one difference: whether the stored
     * rows actually look like the season the URL names. Without that, a URL
     * disagreement indicts the URL.
     */
    const base = { forward: 0.63, route: 'A_EXPLICIT_SEASON_PATH', urlSeason: '2025', storedSeason: '2024' };
    expect(classify({ ...base, resemblesUrlSeason: false })).toBe('C_SEASON_IDENTITY_UNPROVEN');
    expect(classify({ ...base, resemblesUrlSeason: true })).toBe('E_DEFINITE_MISMATCH');
  });

  it('surviving L7Z provenance settles the season on its own', () => {
    // A row that recorded what the page said needs no inference at all.
    expect(classify({ forward: 0.95, route: 'C_BARE_CURRENT_ROUTE', pageSeason: true, storedSeason: '2026' }))
      .toBe('B_HIGH_OVERLAP_BUT_PLAUSIBLE');
  });

  it('legacy rows have no provenance, which is the audit\'s binding constraint', () => {
    // Measured at 0 of 206,282 historical rows. L7Z was deliberately not
    // backfilled, so "what did the page say" is unanswerable for every one of
    // them and the audit can never be settled from provenance alone.
    expect(classify({ forward: 1.0, route: 'C_BARE_CURRENT_ROUTE', pageSeason: false, storedSeason: '2025' }))
      .toBe('D_PROBABLE_DUPLICATE_CAPTURE');
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 19 — can the hardened pipeline still do this?                         */
/* -------------------------------------------------------------------------- */

/** Ask `run.evaluate` about one page, for season 2026, in CURRENT mode. */
function evaluate({ title, players, ref }) {
  const code = `
import sys, os, json, re, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(PIPELINE)})
os.environ['RB_SEASON'] = '2026'; os.environ['RB_REF'] = '2025'; os.environ['RB_CURRENT'] = '1'
import lib, run
a = json.loads(sys.stdin.read())
norm = lambda s: re.sub(r'[^a-z]', '', (s or '').lower())
K = 'Fixture College||womens-soccer'
run.N25 = {K: {norm(n) for n in a['ref']}} if a['ref'] else {}
run.CLS25 = {K: {}} if a['ref'] else {}
POS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward']; CLS = ['Fr.', 'So.', 'Jr.', 'Sr.']
rows = ''.join('<tr><td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>X, ST</td></tr>'
               % (i + 1, n, POS[i % 4], CLS[i % 4]) for i, n in enumerate(a['players']))
html = ('<!doctype html><html><head><title>%s</title></head><body><table><thead><tr>'
        '<th>#</th><th>Name</th><th>Pos.</th><th>Academic Year</th><th>Hometown</th></tr></thead>'
        '<tbody>%s</tbody></table></body></html>' % (a['title'], rows))
recs, t, parser = lib.parse_any(html)
ok, note = run.evaluate(recs, t, K, len(a['ref']), 'https://example.test/roster')
print(json.dumps({'seasonOk': lib.season_ok(t), 'accepted': ok, 'note': note}))
`;
  return JSON.parse(execFileSync(python, ['-c', code], {
    input: JSON.stringify({ title, players, ref }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}

const OTHER = ['Zed Alder', 'Yan Birch', 'Xu Cedar'];

d('L7ZG — what the hardened pipeline refuses today', () => {
  it('refuses a bare route serving the PRIOR season', () => {
    // The ENMU/SFSU shape as it stands today: their page names 2024 and every
    // route serves it. Asked for 2026, the gate says no.
    const r = evaluate({ title: "2025 Women's Soccer Roster - X", players: SQUAD, ref: OTHER });
    expect(r.seasonOk).toBe(false);
    expect(r.accepted).toBe(false);
    expect(r.note).toMatch(/page season is not 2026/);
  });

  it('refuses an explicitly wrong season', () => {
    const r = evaluate({ title: "2024 Women's Soccer Roster - X", players: SQUAD, ref: OTHER });
    expect(r.accepted).toBe(false);
  });

  it('refuses a wrong season even with NO reference squad to compare against', () => {
    // The season guard does not depend on the turnover gate having anything to
    // work with. Worth pinning separately: it is the half that still holds in
    // the gap below.
    const r = evaluate({ title: "2024 Women's Soccer Roster - X", players: SQUAD, ref: [] });
    expect(r.accepted).toBe(false);
    expect(r.note).toMatch(/page season is not 2026/);
  });

  it('refuses an untitled page that repeats the reference squad', () => {
    const r = evaluate({ title: 'Roster - X', players: SQUAD, ref: SQUAD });
    expect(r.seasonOk).toBeNull();
    expect(r.accepted).toBe(false);
    expect(r.note).toMatch(/repeats 100% of the 2025 squad/);
  });

  it('ACCEPTS an untitled page whose squad turned over — by design', () => {
    /*
     * Not a defect. `run_season_current.sh` says so in its own header: in
     * CURRENT mode a page need not name its season, it must instead show a
     * turned-over squad. Turnover is the substitute proof, and this pins that
     * the substitute is doing the work.
     */
    const r = evaluate({ title: 'Roster - X', players: SQUAD, ref: OTHER });
    expect(r.seasonOk).toBeNull();
    expect(r.accepted).toBe(true);
  });

  it('ACCEPTS an untitled page when there is no reference at all — THE GAP', () => {
    /*
     * THE ONE HOLE THIS AUDIT FOUND IN THE CURRENT PIPELINE, and the reason
     * L7ZG reports a blocker rather than a clean bill.
     *
     * `overlap` returns None when the programme has no prior-season squad on
     * file, and `evaluate` guards the turnover test with `if ov is not None`.
     * So a first-ever acquisition of a programme, from a page that names no
     * season, is accepted on NO season evidence whatsoever — the note it
     * records is the empty string, which is the honest summary of what was
     * checked.
     *
     * Narrow: it needs an untitled page AND no prior season. 21 historical
     * programme-seasons outside 2022 were first appearances. Recorded here so
     * the fix, when it comes, has a failing test to satisfy — this expectation
     * is written against CURRENT behaviour and inverts the day it is closed.
     */
    const r = evaluate({ title: 'Roster - X', players: SQUAD, ref: [] });
    expect(r.seasonOk).toBeNull();
    expect(r.accepted).toBe(true);
    expect(r.note).toBe('');
  });
});
