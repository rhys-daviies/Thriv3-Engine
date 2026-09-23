import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7R — a roster that is in the page, in a vocabulary no parser knew.
 *
 * Iowa, New Mexico and both Notre Dame programmes serve a Nuxt payload whose
 * player objects are named in snake_case: a paginated `{players, meta}`
 * container whose entries point at a person node with `first_name`,
 * `last_name` and `hometown`, plus `class_level` and `player_position` as nodes
 * of their own. `parse_nuxt` was written against a camelCase vocabulary, its
 * key signature never matched, no HTML parser found a table or a card, and a
 * page listing 28 players read as zero.
 *
 * WHAT THESE TESTS ARE FOR. A reader that finds names in a blob is the easiest
 * thing in the world to write and the last thing this pipeline needs, so most of
 * what follows are refusals: a page with no roster container, a staff block, an
 * empty hydration shell, two rosters at once, a squad under the floor, and last
 * season inside a current shell. The one positive case then has to survive all
 * of them.
 *
 * The fixtures are built here rather than captured, because the real pages are
 * over a megabyte and the encoding — a flat array where every value may be an
 * index into the same array — is exactly what the tests need to vary.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

/**
 * Build a Nuxt flat payload the way the real one is encoded.
 *
 * Every value is pushed into one array and referred to by index, which is the
 * property that made the original defect subtle: a real number is an entry too,
 * so a resolver that follows integers recursively will follow a height and land
 * on somebody else's photo caption.
 */
function payload(players, {
  container = 'players', containers = 1, emptyList = false, staffOnly = false,
} = {}) {
  const flat = [];
  const put = (v) => { flat.push(v); return flat.length - 1; };
  put(null);   // index 0 is never a roster; keeps the indices honest

  const entryFor = (p) => {
    const person = {};
    if (p.full !== undefined) person.full_name = put(p.full);
    if (p.first !== undefined) person.first_name = put(p.first);
    if (p.last !== undefined) person.last_name = put(p.last);
    if (p.home !== undefined) person.hometown = put(p.home);
    if (p.gender !== undefined) person.gender = put(p.gender);
    // A REAL NUMBER, stored as an entry like everything else. If the resolver
    // follows it, it lands on whatever happens to sit at that index.
    if (p.heightInches !== undefined) person.height_inches = put(p.heightInches);
    const entry = { player: put(person) };
    if (p.pos !== undefined) {
      entry.player_position = put({ id: put(5), name: put(p.pos), abbreviation: put(p.posShort ?? p.pos) });
    }
    if (p.cls !== undefined) {
      entry.class_level = put({ id: put(1), name: put(p.cls), order: put(80),
        abbreviation: p.clsShort === undefined ? put(null) : put(p.clsShort) });
    }
    if (p.state !== undefined) entry.publication_state = put(p.state);
    if (p.hide !== undefined) entry.hide = p.hide;   // a literal bool, as the payload writes it
    return put(entry);
  };

  const refs = players.map(entryFor);
  const list = put(emptyList ? [] : refs);
  const meta = put({ current_page: put(1), total: put(players.length) });
  if (staffOnly) put({ 'roster-713-staff-members-list-page-1': list, meta });
  else for (let i = 0; i < containers; i += 1) put({ [container]: list, meta });
  return flat;
}

const page = (flat, title = "Women's Soccer 2026-27 - Test State Athletics") =>
  `<!doctype html><html><head><title>${title}</title></head><body>`
  + '<div id="__nuxt"></div>'
  + `<script type="application/json" data-nuxt-data="nuxt-app" data-ssr="true" id="__NUXT_DATA__">${JSON.stringify(flat)}</script>`
  + '</body></html>';

/** The real shape, in the site's own words: ordinal class, short position. */
const SQUAD = [
  { first: 'Berit', last: 'Parten', full: 'Berit Parten', home: 'St. Paul, Minn.', gender: 'female', pos: 'F', cls: '3rd', state: 'published', heightInches: 7 },
  { first: 'Abby', last: 'Warner', full: 'Abby Warner', home: 'Pella, Iowa', gender: 'female', pos: 'F', cls: '3rd', state: 'published', heightInches: 4 },
  { first: 'Lexy', last: 'Griffin', full: 'Lexy Griffin', home: 'Panama City, Fla.', gender: 'female', pos: 'D', cls: '2nd', state: 'published', heightInches: 2 },
  { first: 'Millie', last: 'Greer', full: 'Millie Greer', home: 'Scottsdale, Ariz.', gender: 'female', pos: 'D', cls: '1st', state: 'published', heightInches: 9 },
  { first: 'Caroline', last: 'Ready', full: 'Caroline Ready', home: 'Carrollton, Texas', gender: 'female', pos: 'GK', cls: '4th', state: 'published', heightInches: 1 },
  { first: 'Sara', last: 'Batchadji', full: 'Sara Batchadji', home: 'Lubeck, Germany', gender: 'female', pos: 'M', cls: '5th', state: 'published', heightInches: 5 },
];

/** Run the shipped parsers and the gate over one page. Nothing touches a network. */
function read(html, { season = 2026, ref = 2025 } = {}) {
  const code = `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '${season}'
os.environ['RB_REF'] = '${ref}'
os.environ['RB_CURRENT'] = '1'
import lib, run
html = sys.stdin.read()
recs, title, parser = lib.parse_any(html)
snake = lib.parse_nuxt_roster(html)
camel, _ = lib.parse_nuxt(html)
run.N25 = {}
ok, note = run.evaluate(recs, title, 'Test State||womens-soccer', 20, 'https://example.test/roster')
print(json.dumps({
  'parser': parser, 'n': len(recs or []), 'title': title,
  'snake': snake, 'snake_n': len(snake or []), 'camel_n': len(camel or []),
  'rows': recs or [], 'players': run._players(recs), 'ok': ok, 'note': note,
}))
`;
  return JSON.parse(execFileSync(python, ['-c', code], {
    input: html, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}

d('a snake_case Nuxt roster is read, and only when it is a roster', () => {
  it('1/2/3. accepts the current roster, with every player and every name', () => {
    const r = read(page(payload(SQUAD)));
    expect(r.parser).toBe('nuxt-roster');
    expect(r.snake_n).toBe(6);
    expect(r.n).toBe(6);
    expect(r.rows.map((x) => x.name)).toEqual([
      'Berit Parten', 'Abby Warner', 'Lexy Griffin', 'Millie Greer', 'Caroline Ready', 'Sara Batchadji']);
    expect(r.ok).toBe(true);
  });

  it('4. takes the position the page states, in the page\'s own words', () => {
    const r = read(page(payload(SQUAD)));
    expect(r.rows.map((x) => x.pos)).toEqual(['F', 'F', 'D', 'D', 'GK', 'M']);
    // and the pipeline's own normaliser resolves them downstream
    expect(r.players.map((x) => x.pos)).toEqual(
      ['Forward', 'Forward', 'Defender', 'Defender', 'Goalkeeper', 'Midfielder']);
  });

  it('5. takes the class the page states, and the existing authority resolves it', () => {
    const r = read(page(payload(SQUAD)));
    expect(r.rows.map((x) => x.cls)).toEqual(['3rd', '3rd', '2nd', '1st', '4th', '5th']);
  });

  it('6. leaves a field the page does not state empty, rather than guessing', () => {
    const thin = [{ first: 'No', last: 'Fields', home: 'Ames, Iowa', state: 'published' },
      ...SQUAD.slice(1)];
    const r = read(page(payload(thin)));
    expect(r.rows[0]).toEqual({ name: 'No Fields', cls: '', pos: '', home: 'Ames, Iowa' });
  });

  it('7. does not follow a number as if it were a pointer', () => {
    /*
     * THE SUBTLE ONE. Every value is an index, so a resolver that recurses
     * through integers will read `height_inches: 7` as "go to entry 7" and
     * return whatever string lives there. That is how Iowa's height became a
     * photo caption and its id became another player's slug. The heights above
     * are small integers chosen to point at real entries, so a recursing
     * resolver would silently succeed with the wrong data.
     */
    const r = read(page(payload(SQUAD)));
    for (const row of r.rows) {
      expect(Object.keys(row).sort()).toEqual(['cls', 'home', 'name', 'pos']);
      expect(row.home).toMatch(/, /);
      expect(row.cls).toMatch(/^[1-5](st|nd|rd|th)$/);
    }
  });

  it('8. reads the full name when the page gives one, and builds it when it does not', () => {
    const split = [{ first: 'Split', last: 'Only', home: 'A, B', pos: 'M', cls: '1st', state: 'published' }];
    expect(read(page(payload([...split, ...SQUAD.slice(1)]))).rows[0].name).toBe('Split Only');
  });
});

d('the refusals are the point', () => {
  const nav = '<!doctype html><html><head><title>2026 Athletics</title></head><body>'
    + '<nav><a href="/sports/wsoc">Women\'s Soccer</a><a href="/sports/msoc">Men\'s Soccer</a></nav>'
    + '<script type="application/json" id="__NUXT_DATA__">[{"items":[1,2]},"Women\'s Soccer","Men\'s Soccer"]</script>'
    + '</body></html>';

  it('9. refuses a page with no roster container at all', () => {
    const r = read(nav);
    expect(r.snake).toBe(null);
    expect(r.n).toBe(0);
    expect(r.ok).toBe(false);
  });

  it('10. refuses a staff block, because it is not in a players container', () => {
    const r = read(page(payload(SQUAD, { staffOnly: true })));
    expect(r.snake).toBe(null);
    expect(r.ok).toBe(false);
  });

  it('11. refuses a schedule, which has no person nodes to offer', () => {
    const sched = page([null, 'Iowa', 'Drake', { games: [1, 2] }], 'Women\'s Soccer Schedule 2026-27');
    expect(read(sched).snake).toBe(null);
  });

  it('12. refuses an empty hydration shell', () => {
    const r = read(page(payload(SQUAD, { emptyList: true })));
    expect(r.snake).toBe(null);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/too few players parsed \(0\)/);
  });

  it('13. refuses two rosters at once, rather than guessing which sport is wanted', () => {
    /*
     * A signature-free parser is handed HTML and nothing else — no sport, no
     * institution. So the one sport mistake it could make is picking a list on
     * a page that carries more than one, and the safe answer is to decline.
     */
    const r = read(page(payload(SQUAD, { containers: 2 })));
    expect(r.snake).toBe(null);
    expect(r.ok).toBe(false);
  });

  it('14. refuses last season inside a current shell', () => {
    const r = read(page(payload(SQUAD), "Women's Soccer 2025-26 - Test State Athletics"));
    expect(r.snake_n).toBe(6);          // the parser still reads what is there
    expect(r.ok).toBe(false);           // and the season gate still refuses it
    expect(r.note).toMatch(/page season is not 2026/);
  });

  it('15. preserves the minimum player floor', () => {
    const r = read(page(payload(SQUAD.slice(0, 4))));
    expect(r.snake_n).toBe(4);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/too few players parsed \(4\)/);
  });

  it('16. skips a player the site has not published, and one it hides', () => {
    const mixed = [
      { ...SQUAD[0], state: 'draft' },
      { ...SQUAD[1], hide: true },
      ...SQUAD.slice(2),
    ];
    const r = read(page(payload(mixed)));
    expect(r.snake_n).toBe(4);
    expect(r.rows.map((x) => x.name)).not.toContain('Berit Parten');
    expect(r.rows.map((x) => x.name)).not.toContain('Abby Warner');
  });

  it('17. drops a row with no resolvable name instead of inventing one', () => {
    const r = read(page(payload([{ home: 'Nowhere, XX', pos: 'M', cls: '1st', state: 'published' }, ...SQUAD])));
    expect(r.snake_n).toBe(6);
    expect(r.rows.every((x) => x.name.trim().length > 0)).toBe(true);
  });
});

d('nothing is inferred, and nothing else changes', () => {
  it('18. does not infer nationality, or any field, from a hometown', () => {
    // "Lubeck, Germany" is a hometown and stays one. The pipeline derives
    // nationality later, in `run.build`, for every parser alike — a parser that
    // decided it here would be a second opinion nobody asked for.
    const r = read(page(payload(SQUAD)));
    const germany = r.rows.find((x) => x.home === 'Lubeck, Germany');
    expect(germany).toBeTruthy();
    expect(Object.keys(germany)).not.toContain('nationality');
    expect(Object.keys(germany)).not.toContain('country');
  });

  it('19. states no institution and no season of its own', () => {
    // The host in the URL is the institution gate and the title is the season
    // gate. A parser that claimed either would be claiming evidence it does not
    // have — the page's own words are returned unchanged.
    const r = read(page(payload(SQUAD)));
    expect(r.title).toBe("Women's Soccer 2026-27 - Test State Athletics");
    for (const row of r.rows) expect(Object.keys(row).sort()).toEqual(['cls', 'home', 'name', 'pos']);
  });

  it('20. leaves the camelCase Nuxt vocabulary to the parser that already owns it', () => {
    const flat = [null, 'Ada', 'Lovelace', 'Boston, Mass.', 'Fr.', 'Midfielder'];
    const camel = [];
    for (let i = 0; i < 6; i += 1) {
      flat.push(`Player${i}`);
      camel.push({ firstName: flat.length - 1, lastName: 2, hometown: 3, academicYearShort: 4, positionLong: 5 });
    }
    for (const c of camel) flat.push(c);
    const r = read(page(flat));
    expect(r.camel_n).toBe(6);
    expect(r.parser).toBe('nuxt');    // not nuxt-roster
    expect(r.snake).toBe(null);
  });
});
