import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7ZH — a season may not be assigned on the absence of a contradiction.
 *
 * `season_ok` is three-valued and only `False` was ever a refusal. A page that
 * names no season cannot contradict the request, so the request stood — and
 * what actually did the work was the turnover gate below it, showing the squad
 * was not last season's.
 *
 * `overlap` returns `None` when there is no reference roster, and that gate is
 * guarded by `if ov is not None`. So in the intersection — an untitled page AND
 * no prior season — nothing was asked and the row was accepted. L7ZG measured
 * what that produced: a row stored under the requested season whose recorded
 * note was the empty string, an honest summary of what had been checked.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT THESE TESTS DEFEND. A roster may be accepted for season S only
 * if at least one independent path establishes S:
 *
 *   A. the page itself names S                            (season_ok is True)
 *   B. it does not, AND a reference roster exists, AND the existing turnover
 *      semantics permit the new squad
 *
 * There is no third path. `evaluate` is the only function that could create
 * one, and the property test at the bottom asserts it over the whole matrix
 * rather than over the cases someone remembered to list.
 *
 * WHAT L7ZH DID NOT CHANGE, and these pin: the 0.85 threshold, `season_ok`'s
 * three values, every behaviour when the page names a season right or wrong,
 * and — the one most at risk of over-correction — acceptance of an untitled
 * page whose squad HAS turned over. `run_season_current.sh` says in its own
 * header that a current page need not name its season if it shows a turned-over
 * squad. That substitute proof is untouched.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

const SQUAD = ['Ada Rivers', 'Bree Thorne', 'Cleo Vance', 'Dana Fox', 'Eve Marsh',
  'Fay Quill', 'Gia Holt', 'Hana Reed', 'Iris Poole', 'Jo Nash'];
const OTHER = ['Zed Alder', 'Yan Birch', 'Xu Cedar', 'Wren Dale', 'Vik Elm',
  'Uma Fern', 'Tam Gale', 'Sia Hale', 'Rio Ives', 'Pax Jain'];
/** Half the reference returns: 50%, comfortably under the 0.85 gate. */
const HALF = [...SQUAD.slice(0, 5), ...OTHER.slice(0, 5)];

const TITLED_OK = "2026 Women's Soccer Roster - Fixture College";
const TITLED_BAD = "2025 Women's Soccer Roster - Fixture College";
const TITLED_OLDER = "2024 Women's Soccer Roster - Fixture College";
const UNTITLED = 'Roster - Fixture College';

/**
 * Run the REAL `run.evaluate`, and the real `build` when it accepts.
 *
 * Deliberately not a reimplementation: a gate re-expressed in the test is a
 * gate the test cannot catch drifting.
 */
function evaluate(cases) {
  const code = `
import sys, os, json, re, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '2026'; os.environ['RB_REF'] = '2025'; os.environ['RB_CURRENT'] = '1'
import lib, run
POS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward']
K = 'Fixture College||womens-soccer'
norm = lambda s: re.sub(r'[^a-z]', '', (s or '').lower())
TARGET = {'School': 'Fixture College', 'Sport': 'womens-soccer', 'Division': 'NCAA D3',
          'Conference': 'Test', '2025 Player Count': '0',
          'Roster URL 2025 (known good)': '', '_cand': '', 'Method': 'year-swap (direct)'}
out = []
for a in json.loads(sys.stdin.read()):
    run.N25 = {K: {norm(n) for n in a['ref']}} if a['ref'] else {}
    run.CLS25 = {K: {}} if a['ref'] else {}
    rows = ''.join('<tr><td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>X, ST</td></tr>'
                   % (i + 1, n, POS[i % 4], ['Fr.', 'So.', 'Jr.', 'Sr.'][i % 4])
                   for i, n in enumerate(a['players']))
    html = ('<!doctype html><html><head><title>%s</title></head><body><table><thead><tr>'
            '<th>#</th><th>Name</th><th>Pos.</th><th>Academic Year</th><th>Hometown</th></tr>'
            '</thead><tbody>%s</tbody></table></body></html>' % (a['title'], rows))
    recs, t, parser = lib.parse_any(html)
    ov = run.overlap(recs, K)
    ok, note = run.evaluate(recs, t, K, a.get('cnt25', 0), 'https://example.test/roster')
    built = None
    if ok:
        b = run.build(recs, TARGET, 'https://example.test/roster', 'High', note,
                      parser=parser, title=t)
        built = {'rows': len(b),
                 'pageSeason': sorted({(x.get('Source Page Season') or '') for x in b}),
                 'parser': sorted({(x.get('Source Parser') or '') for x in b}),
                 'url': sorted({(x.get('Source Roster URL') or '') for x in b})}
    out.append({'seasonOk': lib.season_ok(t), 'overlap': ov, 'accepted': ok,
                'note': note, 'built': built})
print(json.dumps(out))
`;
  return JSON.parse(execFileSync(python, ['-c', code], {
    input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}
const one = (c) => evaluate([c])[0];

/* -------------------------------------------------------------------------- */

d('L7ZH — the case that was open', () => {
  it('refuses an untitled page when there is no reference roster', () => {
    /*
     * THE BLOCKER, inverted. L7ZG wrote this expectation against the behaviour
     * of the day — accepted, with an empty note — and said it would flip when
     * the hole was closed. This is that flip.
     *
     * A first-ever acquisition from a page that names no season has produced no
     * season evidence of any kind. It is not a wrong season and not a repeated
     * squad; it is an unproven one, and it belongs in the residual queue.
     */
    const r = one({ title: UNTITLED, players: SQUAD, ref: [] });
    expect(r.seasonOk).toBeNull();
    expect(r.overlap).toBeNull();
    expect(r.accepted).toBe(false);
    expect(r.note).toMatch(/^season unproven:/);
  });

  it('builds nothing at all when it refuses, so no provenance is persisted', () => {
    // `build` is only reached after acceptance, so a refusal produces no sheet
    // row and therefore no `source_*` value to be wrong about later.
    const r = one({ title: UNTITLED, players: SQUAD, ref: [] });
    expect(r.accepted).toBe(false);
    expect(r.built).toBeNull();
  });

  it('says what was actually missing, and not something it did not measure', () => {
    /*
     * The refusal must not borrow a neighbour's words. "Page season is not
     * 2026" claims the page named another season; "roster repeats N%" claims a
     * squad was compared. Neither happened here, and a diagnosis that says
     * either would send an operator to the wrong question.
     */
    const r = one({ title: UNTITLED, players: SQUAD, ref: [] });
    expect(r.note).toContain('names no season');
    expect(r.note).toContain('no 2025 roster to measure turnover against');
    expect(r.note).not.toMatch(/page season is not/);
    expect(r.note).not.toMatch(/repeats \d+% of the/);
    expect(r.note).not.toMatch(/too few players parsed/);
  });
});

d('L7ZH — the case that must stay open', () => {
  it('ACCEPTS an untitled page whose squad turned over', () => {
    /*
     * THE OVER-CORRECTION THIS GUARDS AGAINST. The whole point of the change is
     * that ONE of the two evidence paths must succeed, not both. An untitled
     * page with independent turnover evidence still has path B, and refusing it
     * would break the current-season acquisition the runner is built around.
     */
    const r = one({ title: UNTITLED, players: SQUAD, ref: OTHER });
    expect(r.seasonOk).toBeNull();
    expect(r.overlap).toBe(0);
    expect(r.accepted).toBe(true);
  });

  it('ACCEPTS an untitled page with partial, sub-threshold turnover', () => {
    // Not only the 0% case. Half the squad returning is ordinary and is still
    // evidence of a different season, because it is under the gate.
    const r = one({ title: UNTITLED, players: HALF, ref: SQUAD });
    expect(r.overlap).toBeGreaterThan(0);
    expect(r.overlap).toBeLessThan(0.85);
    expect(r.accepted).toBe(true);
  });

  it('REFUSES an untitled page that repeats the reference squad, as before', () => {
    // Unchanged behaviour and unchanged wording: this is the turnover gate, and
    // L7ZH did not touch it.
    const r = one({ title: UNTITLED, players: SQUAD, ref: SQUAD });
    expect(r.accepted).toBe(false);
    expect(r.note).toMatch(/repeats 100% of the 2025 squad \(gate 85%\)/);
    expect(r.note).not.toMatch(/^season unproven:/);
  });
});

d('L7ZH — explicit-season behaviour is untouched', () => {
  it('accepts a page naming the requested season, even with no reference', () => {
    /*
     * Path A on its own. This is the cell most easily broken by a careless
     * fail-closed rule: it has no turnover evidence either, and it does not
     * need any, because the page said so itself.
     */
    const r = one({ title: TITLED_OK, players: SQUAD, ref: [] });
    expect(r.seasonOk).toBe(true);
    expect(r.overlap).toBeNull();
    expect(r.accepted).toBe(true);
    expect(r.built.pageSeason).toEqual(['2026']);
  });

  it('accepts a page naming the requested season with low overlap', () => {
    const r = one({ title: TITLED_OK, players: SQUAD, ref: OTHER });
    expect(r.accepted).toBe(true);
  });

  it('refuses a page naming the requested season that serves the old squad', () => {
    // The L7T finding: a site flips its label before it swaps its content. In
    // CURRENT mode the turnover gate applies even to a correctly titled page.
    const r = one({ title: TITLED_OK, players: SQUAD, ref: SQUAD });
    expect(r.accepted).toBe(false);
    expect(r.note).toMatch(/despite the page naming 2026/);
  });

  it('refuses a page naming another season, at every overlap', () => {
    const none = one({ title: TITLED_BAD, players: SQUAD, ref: [] });
    const low = one({ title: TITLED_BAD, players: SQUAD, ref: OTHER });
    const high = one({ title: TITLED_BAD, players: SQUAD, ref: SQUAD });
    for (const r of [none, low, high]) {
      expect(r.seasonOk).toBe(false);
      expect(r.accepted).toBe(false);
      expect(r.note).toMatch(/page season is not 2026/);
    }
  });

  it('refuses a page redirected to a still-older season', () => {
    const r = one({ title: TITLED_OLDER, players: SQUAD, ref: OTHER });
    expect(r.accepted).toBe(false);
    expect(r.note).toMatch(/page season is not 2026/);
  });
});

d('L7ZH — provenance is unaffected', () => {
  it('records the page season only when the page named one', () => {
    /*
     * L7Z's contract, still holding on both accepting paths. Path B is accepted
     * on turnover evidence and STILL records an empty page season, because the
     * page did not name one — the acceptance and the provenance answer
     * different questions, and the row must not claim the page said something
     * it did not.
     */
    const [byTitle, byTurnover] = evaluate([
      { title: TITLED_OK, players: SQUAD, ref: [] },
      { title: UNTITLED, players: SQUAD, ref: OTHER },
    ]);
    expect(byTitle.built.pageSeason).toEqual(['2026']);
    expect(byTurnover.built.pageSeason).toEqual(['']);
    expect(byTurnover.built.parser).toEqual(byTitle.built.parser);
    expect(byTurnover.built.url).toEqual(byTitle.built.url);
  });
});

/* -------------------------------------------------------------------------- */
/* The invariant                                                               */
/* -------------------------------------------------------------------------- */

d('L7ZH — there is no third acceptance path', () => {
  it('every acceptance is explained by path A or path B, across the matrix', () => {
    /*
     * PHASE 18. Asserted over the product of both evidence dimensions rather
     * than over the cases anyone listed, and against the real `evaluate` — a
     * property expressed against a copy of the logic proves only that the copy
     * agrees with itself.
     *
     *   A. season_ok is True
     *   B. season_ok is None AND overlap is not None AND turnover permits
     *
     * A future change that accepts anything else fails here without needing a
     * new test written for it, which is the point.
     */
    const titles = [
      ['TRUE', TITLED_OK], ['FALSE', TITLED_BAD], ['FALSE_OLDER', TITLED_OLDER],
      ['NONE', UNTITLED],
    ];
    const refs = [['none', []], ['disjoint', OTHER], ['half', SQUAD], ['identical', SQUAD]];
    const cases = [];
    const labels = [];
    for (const [tl, title] of titles) {
      for (const [rl, ref] of refs) {
        const players = rl === 'half' ? HALF : SQUAD;
        cases.push({ title, players, ref });
        labels.push(`${tl}/${rl}`);
      }
    }
    const results = evaluate(cases);
    expect(results).toHaveLength(16);

    const unexplained = [];
    let viaA = 0; let viaB = 0;
    results.forEach((r, i) => {
      if (!r.accepted) return;
      if (r.seasonOk === true) { viaA += 1; return; }
      if (r.seasonOk === null && r.overlap !== null) { viaB += 1; return; }
      unexplained.push(`${labels[i]} accepted with seasonOk=${r.seasonOk} overlap=${r.overlap}`);
    });

    expect(unexplained).toEqual([]);
    // Both paths must actually be exercised, or the invariant passes vacuously
    // on a matrix that never reached them.
    expect(viaA).toBeGreaterThan(0);
    expect(viaB).toBeGreaterThan(0);
  });

  it('and no acceptance survives with both evidence dimensions absent', () => {
    // The same statement from the other side, which is the one that was false
    // before L7ZH.
    const results = evaluate([
      { title: UNTITLED, players: SQUAD, ref: [] },
      { title: UNTITLED, players: OTHER, ref: [] },
      { title: 'Women’s Soccer - Fixture College', players: SQUAD, ref: [] },
    ]);
    for (const r of results) {
      expect(r.seasonOk).toBeNull();
      expect(r.overlap).toBeNull();
      expect(r.accepted).toBe(false);
    }
  });
});
