import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7ZF — telling "not published yet" apart from "we did not look properly".
 *
 * Seven NCAA programmes sat in PAGE_PRIOR_SEASON: the best page the ladder
 * reached names an earlier season than the one asked for. That class does not
 * say whether the season we want EXISTS, and the two readings need completely
 * different responses — one is a site that has not published yet and must be
 * left alone, the other is a source we are failing to reach and would justify
 * pipeline work.
 *
 * WHAT MADE THEM LOOK IDENTICAL. Every one of the seven served the SAME page
 * for `/roster/2026`, `/roster/2026-27` and the bare `/roster`. A SIDEARM site
 * answers an unknown season with its current roster rather than a 404, so four
 * rungs of the ladder agreed with each other about a season none of them had
 * been given. Four confident readings of one page is not four pieces of
 * evidence.
 *
 * WHAT SEPARATED THEM. The page's own season menu — an enumeration, published
 * by the site, of the seasons it holds. All seven topped out below the season
 * asked for, which is the site stating the roster does not exist rather than us
 * failing to find it.
 *
 * WHY THE FIXTURES ARE THE PROOF. Every one of those pages will roll forward
 * when its season is published, so a finding demonstrated against the live web
 * stops being demonstrable within months. These reproductions are synthetic and
 * network-free, and they will still fail if `season_ok`, the sport guard or the
 * menu reader is weakened.
 *
 * NOT A SEASON-INFERENCE RULE. Nothing here lets a page be read as 2026
 * because the calendar says so, because the URL says so, or because the site
 * has run out of newer seasons. The menu answers "does the site claim to have
 * it", never "what season is this page".
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

/**
 * Ask the production code the three questions a PAGE_PRIOR_SEASON diagnosis
 * rests on, over one page. `run.evaluate` and `lib.season_ok` are the gates
 * themselves; `seasons_offered` is the diagnostic's menu reader.
 */
function read({ html, key = 'Fixture College||womens-soccer', ref = [], cnt = 20 }) {
  const code = `
import sys, os, json, re, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '2026'; os.environ['RB_REF'] = '2025'; os.environ['RB_CURRENT'] = '1'
import lib, run, diagnose_cohort as dc
arg = json.loads(sys.stdin.read())
norm = lambda s: re.sub(r'[^a-z]', '', (s or '').lower())
run.N25 = {arg['key']: {norm(n) for n in arg['ref']}}
run.CLS25 = {arg['key']: {}}
recs, title, parser = lib.parse_any(arg['html'])
ok, note = run.evaluate(recs, title, arg['key'], arg['cnt'], 'https://example.test/roster')
offered = dc.seasons_offered(arg['html'])
print(json.dumps({
  'parser': parser, 'n': len(recs or []), 'title': title, 'ok': ok, 'note': note,
  'seasonOk': lib.season_ok(title),
  'contradicted': lib.sport_contradicted(title, arg['key'].split('||')[-1]),
  'mechanism': None if ok else dc.classify(note, True, len(recs or []), False),
  'seasonsOffered': offered,
  'seasonsMaxOffered': offered[-1] if offered else None,
  'seasonAskedPublished': (str(lib.SEASON) in offered
                           or f'{lib.SEASON}-{str(lib.SEASON + 1)[-2:]}' in offered),
}))
`;
  return JSON.parse(execFileSync(python, ['-c', code], {
    input: JSON.stringify({ html, key, ref, cnt }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}

/* -------------------------------------------------------------------------- */
/* page builders                                                               */
/* -------------------------------------------------------------------------- */

const NAMES = ['Ada Rivers', 'Bree Thorne', 'Cleo Vance', 'Dana Fox', 'Eve Marsh', 'Fay Quill',
  'Gia Holt', 'Hana Reed', 'Iris Poole', 'Jo Nash', 'Kit Lyle', 'Lena Frost',
  'Mia Crane', 'Nia Booth', 'Opal Dean', 'Pia Grove'];
const POS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
const CLS = ['Fr.', 'So.', 'Jr.', 'Sr.'];

/** A Sidearm-style table roster. `seasons` is the page's own season menu. */
function rosterPage(title, { n = 16, seasons = [], names = NAMES } = {}) {
  const rows = names.slice(0, n).map((name, i) =>
    `<tr><td>${i + 1}</td><td>${name}</td><td>${POS[i % 4]}</td>`
    + `<td>${CLS[i % 4]}</td><td>Somewhere, ST</td></tr>`).join('');
  // The menu exactly as a SIDEARM roster page publishes it: one route per
  // season it holds. Absent on a site that offers no history at all.
  const menu = seasons.length
    ? `<nav class="season-select">${seasons.map((s) =>
      `<a href="/sports/womens-soccer/roster/${s}">${s}</a>`).join('')}</nav>`
    : '';
  return `<!doctype html><html><head><title>${title}</title></head><body>${menu}<table>`
    + '<thead><tr><th>#</th><th>Name</th><th>Pos.</th><th>Academic Year</th><th>Hometown</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></body></html>`;
}

/** A single athlete's bio page, which is what `/roster/season/2026` often serves. */
const bioPage = (title) =>
  `<!doctype html><html><head><title>${title}</title></head><body>`
  + '<h1>Player Bio</h1><p>Hometown: Somewhere, ST</p></body></html>';

const YEARS = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

/* -------------------------------------------------------------------------- */

d('L7ZF — the four rungs that agree because they are one page', () => {
  it('a year-swap that resolves is accepted, and says 2026 itself', () => {
    /*
     * The A case. The site published the season asked for: the page names it,
     * the menu holds it, the squad turned over. Nothing about the URL is doing
     * the work — `season_ok` reads the TITLE.
     */
    const r = read({
      html: rosterPage("2026 Women's Soccer Roster - Fixture College",
        { n: 16, seasons: [...YEARS(2019, 2025), '2026'] }),
      ref: ['Zed Alder', 'Yan Birch'],
    });
    expect(r.seasonOk).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.mechanism).toBeNull();
    expect(r.seasonsMaxOffered).toBe('2026');
    expect(r.seasonAskedPublished).toBe(true);
  });

  it('the academic-span form counts as the season asked for', () => {
    // A site may publish either `2026` or `2026-27` and neither spelling is the
    // pipeline's to choose. The menu reader accepts both; it does not infer.
    const r = read({
      html: rosterPage("2026-27 Women's Soccer Roster - Fixture College",
        { n: 16, seasons: [...YEARS(2019, 2024), '2025-26', '2026-27'] }),
      ref: ['Zed Alder'],
    });
    expect(r.seasonOk).toBe(true);
    expect(r.seasonsMaxOffered).toBe('2026-27');
    expect(r.seasonAskedPublished).toBe(true);
  });

  it('a prior season genuinely remains: refused, and the menu says why', () => {
    /*
     * The C case, and the one that must NOT be forced. The page is a perfectly
     * good 2025 roster. It is refused for naming 2025, and the menu — topping
     * out at 2025 — is the site confirming that 2026 does not exist rather
     * than us having missed it.
     */
    const r = read({
      html: rosterPage("2025 Women's Soccer Roster - Fixture College",
        { n: 16, seasons: YEARS(2011, 2025) }),
    });
    expect(r.ok).toBe(false);
    expect(r.mechanism).toBe('PAGE_PRIOR_SEASON');
    expect(r.seasonsMaxOffered).toBe('2025');
    expect(r.seasonAskedPublished).toBe(false);
  });

  it('a URL saying 2026 over a page saying 2025 is still refused', () => {
    /*
     * THE WHOLE REASON THE SEVEN LOOKED ALIKE. The fixture is fetched as
     * `/roster/2026`; the platform answers with its current roster and the
     * title says 2025. `season_ok` reads the title, so the URL buys nothing —
     * and the menu, which also lacks 2026, agrees with the title rather than
     * with the address we typed.
     */
    const r = read({
      html: rosterPage("2025 Women's Soccer Roster - Fixture College",
        { n: 16, seasons: YEARS(2016, 2025) }),
    });
    expect(r.seasonOk).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.mechanism).toBe('PAGE_PRIOR_SEASON');
    expect(r.seasonAskedPublished).toBe(false);
  });

  it('a site two seasons stale is still only PAGE_PRIOR_SEASON', () => {
    /*
     * Three of the seven were on 2024, not 2025. That is a bigger gap and the
     * same class: the diagnosis names the refusal, and how far behind the site
     * has fallen is a separate question the menu answers rather than the class.
     */
    const r = read({
      html: rosterPage("2024 Women's Soccer Roster - Fixture College",
        { n: 16, seasons: YEARS(2011, 2024) }),
    });
    expect(r.mechanism).toBe('PAGE_PRIOR_SEASON');
    expect(r.seasonsMaxOffered).toBe('2024');
    expect(r.seasonAskedPublished).toBe(false);
  });

  it('the B case is visible: the site HOLDS the season we could not reach', () => {
    /*
     * The finding this reader exists to make possible. The page served is 2025
     * — so the class is still PAGE_PRIOR_SEASON — but the menu lists 2026,
     * which means the roster is published at a route the ladder did not offer.
     * That is a pipeline gap, not an unpublished season, and it is the only
     * shape that would justify candidate-architecture work.
     *
     * None of the seven looked like this. The assertion is what "none of them"
     * was measured against, and it fails the moment a real B target appears.
     */
    const r = read({
      html: rosterPage("2025 Women's Soccer Roster - Fixture College",
        { n: 16, seasons: [...YEARS(2016, 2025), '2026'] }),
    });
    expect(r.mechanism).toBe('PAGE_PRIOR_SEASON');
    expect(r.seasonAskedPublished).toBe(true);   // <- C and B differ HERE
    expect(r.seasonsMaxOffered).toBe('2026');
  });

  it('no menu at all leaves the question open rather than answered', () => {
    // Absence of evidence. A page with no season navigation cannot say whether
    // the season exists, and the reader reports that as "not published" being
    // UNKNOWN rather than confirmed — `seasonsMaxOffered` is null, not 2025.
    const r = read({ html: rosterPage("2025 Women's Soccer Roster - Fixture College", { n: 16 }) });
    expect(r.mechanism).toBe('PAGE_PRIOR_SEASON');
    expect(r.seasonsOffered).toEqual([]);
    expect(r.seasonsMaxOffered).toBeNull();
    expect(r.seasonAskedPublished).toBe(false);
  });
});

d('L7ZF — the refusals that are not about the season', () => {
  it('a player bio is not a roster, whatever season it names', () => {
    /*
     * `/roster/season/2026` served a single athlete's bio on five of the seven
     * sites — one of them a tennis player, one a golfer from 2010-11. The
     * player floor refuses it before any season question is reached, which is
     * why it must never be read as "the 2026 roster has one player".
     */
    const r = read({ html: bioPage("Nicol Kaczorek - 2024 - Women's Tennis - Fixture College") });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/too few players parsed/);
    expect(r.mechanism).not.toBe('PAGE_PRIOR_SEASON');
  });

  it('another sport is refused before the season is considered', () => {
    /*
     * Order matters, and L7U fixed it: whose roster this is comes first.
     * A 2026 page that is the wrong squad must not be accepted for naming the
     * right season — the season is the least of what is wrong with it.
     */
    const r = read({
      html: rosterPage("2026 Women's Volleyball Roster - Fixture College",
        { n: 16, seasons: [...YEARS(2019, 2025), '2026'] }),
      ref: ['Zed Alder'],
    });
    expect(r.contradicted).toBeTruthy();
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/not this programme/);
  });

  it('a season that cannot be read at all is not a prior season', () => {
    /*
     * The D shape. `season_ok` returns None — neither True nor False — when the
     * title names no season, and the gate must not turn "unknown" into either
     * answer. The page is refused, and NOT as PAGE_PRIOR_SEASON, because
     * nothing established that it is a prior season.
     */
    const r = read({
      html: rosterPage('Roster - Fixture College', { n: 16, seasons: YEARS(2016, 2025) }),
      ref: NAMES.slice(0, 15),          // high overlap, so the turnover gate answers
    });
    expect(r.seasonOk).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.mechanism).not.toBe('PAGE_PRIOR_SEASON');
  });

  it('an unmaintained site is a status question, not a roster answer', () => {
    /*
     * The E shape, and the limit of what this file can decide. Two programmes'
     * whole athletics site had published nothing for any sport since 2024-25,
     * and we hold no roster for them in any season. The page still refuses for
     * the ordinary reason and the class is unchanged — whether the programme is
     * still sponsored is an operator decision, and nothing here writes one.
     */
    const r = read({
      html: rosterPage("2024 Women's Soccer Roster - Fixture College",
        { n: 16, seasons: YEARS(2011, 2024) }),
    });
    expect(r.mechanism).toBe('PAGE_PRIOR_SEASON');
    // The evidence an operator would weigh, reported and not acted on.
    expect(r.seasonsMaxOffered).toBe('2024');
    expect(r.seasonAskedPublished).toBe(false);
  });
});

d('L7ZF — the reader cannot be used to infer a season', () => {
  it('a menu listing 2026 does not make a 2025 page into a 2026 page', () => {
    /*
     * THE RULE THAT KEEPS THIS SAFE. The menu says what the site HOLDS. It
     * never says what the page in hand IS. A B target's page is still refused;
     * all the menu buys is knowing the roster is somewhere we have not looked.
     */
    const r = read({
      html: rosterPage("2025 Women's Soccer Roster - Fixture College",
        { n: 16, seasons: [...YEARS(2016, 2025), '2026'] }),
    });
    expect(r.seasonAskedPublished).toBe(true);
    expect(r.seasonOk).toBe(false);            // the page is still 2025
    expect(r.ok).toBe(false);                  // and is still refused
  });

  it('running out of newer seasons is not evidence of the current one', () => {
    // A site whose newest season is 2025 says nothing about 2026 except that it
    // does not have it. `seasonOk` stays false and the page stays refused.
    const r = read({
      html: rosterPage("2025 Women's Soccer Roster - Fixture College",
        { n: 16, seasons: YEARS(2011, 2025) }),
    });
    expect(r.seasonAskedPublished).toBe(false);
    expect(r.seasonOk).toBe(false);
    expect(r.ok).toBe(false);
  });
});
