import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7D — the flip-card roster markup, read without a browser.
 *
 * L7C attempted four programmes on this markup and imported none. The pages
 * render, their titles name the right sport and season, and every parser
 * returned zero — so they were recorded as CLIENT_RENDER_FAILURE, which was
 * half right. A browser is genuinely required (an AWS WAF returns nothing at
 * all to a plain fetch) but the rendered DOM was readable the whole time.
 *
 * The fixtures are the real rendered cards, captured once with images and
 * inline styles stripped. Everything here is network-free.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

const FIXTURES = path.join(HERE, '__fixtures__');
const fixture = (n) => fs.readFileSync(path.join(FIXTURES, n), 'utf8');

/** Runs one expression against lib.py and returns its JSON. */
function inLib(body, { html = null, season = 2026 } = {}) {
  const src = `
import sys, os, json
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ.setdefault('RB_SEASON', '${season}')
os.environ.setdefault('RB_REF', '${season - 1}')
os.environ.setdefault('RB_CURRENT', '1')
import lib
html = sys.stdin.read()
${body}
`;
  return JSON.parse(execFileSync(python, ['-c', src], {
    input: html ?? '', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}

const parse = (html, season = 2026) => inLib(
  'recs, title, par = lib.parse_any(html)\n'
  + 'print(json.dumps({"recs": recs or [], "title": title, "parser": par}))',
  { html, season },
);

d('the flip-card roster reads as records', () => {
  it.each([
    ['presto_cards_mens.html', "Carlow University", "Men's Soccer"],
    ['presto_cards_womens.html', 'Goucher College', "Women's Soccer"],
  ])('%s', (file, institution, sport) => {
    const r = parse(fixture(file));
    expect(r.parser).toBe('presto-card');
    expect(r.recs.length).toBe(7);
    // The title is what identifies the page, and the caller checks it. Both
    // halves matter: a right-season page for the wrong programme is worse than
    // no page, because it would be believed.
    expect(r.title).toContain(institution);
    expect(r.title).toContain(sport);
  });

  it('fills every field the card actually carries', () => {
    for (const rec of parse(fixture('presto_cards_mens.html')).recs) {
      expect(rec.name, 'name').toMatch(/[A-Za-z]{2}/);
      expect(rec.name.length).toBeLessThanOrEqual(60);
      expect(rec.pos, `pos for ${rec.name}`).not.toBe('');
      expect(rec.cls, `cls for ${rec.name}`).not.toBe('');
    }
  });

  it('reads fields by their label, not their place in a row', () => {
    // The visible front of a card is "Austin | Fabry | 0 | GK | Fr | 5-11".
    // Reading that would mean deciding the fourth token is a position — true
    // here, and a silent mis-column the first time a site drops the number.
    const byName = Object.fromEntries(parse(fixture('presto_cards_mens.html')).recs
      .map((r) => [r.name, r]));
    expect(byName['Austin Fabry']).toMatchObject({ pos: 'GK', cls: 'Fr', home: 'Pittsburgh, Pa.' });
  });

  it('keeps an international hometown as a hometown', () => {
    // `home` is a hometown string and nothing else. Nationality is derived from
    // it downstream by `geo()`, exactly as for every other parser — this one
    // has no opinion, and must not acquire one.
    const recs = parse(fixture('presto_cards_mens.html')).recs;
    const abroad = recs.filter((r) => /Nigeria|Ireland/.test(r.home));
    expect(abroad.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(Object.keys(r).sort()).toEqual(['cls', 'home', 'name', 'pos']);
      expect(r).not.toHaveProperty('nat');
      expect(r).not.toHaveProperty('country');
    }
  });
});

d('what it refuses', () => {
  const card = (inner) => `<!doctype html><html><head><title>2026 Men's Soccer Roster - Test</title>`
    + `</head><body><div class="player-card-wrapper">${inner}</div></body></html>`;
  const named = (first, last, bio) => card(
    `<span class="firstname">${first}</span><span class="lastname">${last}</span>`
    + `<div class="bio-data"><ul>${bio}</ul></div>`,
  );

  it('skips a card with a name and nothing else', () => {
    // A promo tile or a staff headshot carries a name. Requiring a position or
    // a class is the same guard the other card parsers use.
    expect(parse(named('Promo', 'Tile', '')).recs).toEqual([]);
  });

  it('skips a card with no name elements at all', () => {
    expect(parse(card('<div class="bio-data"><ul><li><span>Position:</span> GK</li></ul></div>')).recs)
      .toEqual([]);
  });

  it('returns nothing at all for a page with no cards', () => {
    const r = parse('<!doctype html><html><head><title>Not a roster</title></head><body><p>x</p></body></html>');
    expect(r.recs).toEqual([]);
    expect(r.parser).toBe('none');
  });

  it('gives a single-player bio page too few rows to ship', () => {
    // A bio page is one card. The browser stage refuses anything under five
    // rows, so the parser does not need to recognise a bio — it needs to not
    // manufacture a squad from one.
    const one = parse(named('Solo', 'Player', '<li><span>Position:</span> GK</li>')).recs;
    expect(one.length).toBe(1);
    expect(one.length).toBeLessThan(5);
  });

  it('counts one player once, however many times the card is nested', () => {
    const dup = named('Austin', 'Fabry', '<li><span>Position:</span> GK</li>')
      .replace('</body>', '<div class="player-card-wrapper">'
        + '<span class="firstname">Austin</span><span class="lastname">Fabry</span>'
        + '<div class="bio-data"><ul><li><span>Position:</span> GK</li></ul></div></div></body>');
    expect(parse(dup).recs.length).toBe(1);
  });
});

d('the season on the page is still the season being asked for', () => {
  const seasonOk = (title, season) => inLib(
    `print(json.dumps(lib.season_ok(${JSON.stringify(title)}, season=${season})))`, { season },
  );

  it('accepts the fixture pages for 2026', () => {
    for (const f of ['presto_cards_mens.html', 'presto_cards_womens.html']) {
      expect(seasonOk(parse(fixture(f)).title, 2026)).toBe(true);
    }
  });

  it('rejects the stale-season page L7C actually met', () => {
    // brynathynathletics.com serves "2024 Men's Soccer Roster" at the 2026
    // path. Reading its cards would be worse than reading nothing.
    expect(seasonOk("2024 Men's Soccer Roster - Bryn Athyn College", 2026)).toBe(false);
  });

  it('rejects a page that has moved on to the next season', () => {
    // uwoshkoshtitans.com answered with "2027 Men's Soccer Roster".
    expect(seasonOk("2027 Men's Soccer Roster - University of Wisconsin–Oshkosh", 2026)).toBe(false);
  });
});
