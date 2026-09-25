import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sportContradicted } from '../../server/scripts/rosterCandidatePlan.js';

/**
 * L7U — whose roster is this, and is there only one of it?
 *
 * L7T was about to import two rosters that pass every production gate and are
 * not the programme's squad:
 *
 *   Oklahoma State W  the ladder walked past its own soccer roster (refused at
 *                     90% overlap) and accepted a page the site answers with
 *                     "2026-27 Cowgirl Equestrian Roster" — 90 athletes, no
 *                     positions, 1% name overlap. It passed BECAUSE the
 *                     athletes are unrelated: an unrelated roster reads as
 *                     total turnover.
 *   Drexel W          the accepted page's payload declared two non-empty
 *                     `players` containers, 24 and 24, so the read was two
 *                     seasons at once and the 50% overlap looked ordinary.
 *
 * WHY THE FIXTURES ARE THE PROOF. Both live pages have already changed since
 * L7T measured them — Oklahoma State's now answers with a 2016-17 equestrian
 * bio. A defect demonstrated against the live web stops being demonstrable the
 * moment a site edits a page, so the reproductions here are synthetic and
 * network-free, and they will still fail if either gate is removed.
 *
 * NOT A MINIMUM-OVERLAP RULE. A real roster may turn over almost completely.
 * Low overlap is how the defect became visible, not what is wrong with the
 * page: what is wrong is that the page is not this programme's roster, and in
 * both cases the page says so itself. Test 6 pins that distinction.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

/** Run `run.evaluate` over one page, with an injected reference squad. */
function evaluate({ html, key, ref = [], cnt = 30 }) {
  const code = `
import sys, os, json, re, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '2026'; os.environ['RB_REF'] = '2025'; os.environ['RB_CURRENT'] = '1'
import lib, run
arg = json.loads(sys.stdin.read())
norm = lambda s: re.sub(r'[^a-z]', '', (s or '').lower())
run.N25 = {arg['key']: {norm(n) for n in arg['ref']}}
run.CLS25 = {arg['key']: {}}
recs, title, parser = lib.parse_any(arg['html'])
ok, note = run.evaluate(recs, title, arg['key'], arg['cnt'], 'https://example.test/roster')
print(json.dumps({'parser': parser, 'n': len(recs or []), 'title': title, 'ok': ok, 'note': note,
                  'containers': len(lib._nuxt_player_lists(lib._nuxt(arg['html']) or [])),
                  'contradicted': lib.sport_contradicted(title, arg['key'].split('||')[-1])}))
`;
  return JSON.parse(execFileSync(python, ['-c', code], {
    input: JSON.stringify({ html, key, ref, cnt }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}

/* -------------------------------------------------------------------------- */
/* page builders                                                               */
/* -------------------------------------------------------------------------- */

/** A Sidearm-style table roster, which `parse_tables` reads. */
const tablePage = (title, players) =>
  `<!doctype html><html><head><title>${title}</title></head><body><table>`
  + '<thead><tr><th>#</th><th>Name</th><th>Pos.</th><th>Academic Year</th><th>Hometown</th></tr></thead><tbody>'
  + players.map(([n, pos, cls], i) => `<tr><td>${i + 1}</td><td>${n}</td><td>${pos}</td>`
    + `<td>${cls}</td><td>Somewhere, ST</td></tr>`).join('')
  + '</tbody></table></body></html>';

/** A Nuxt payload with `containers` non-empty roster lists. */
function nuxtPage(title, groups) {
  const flat = [];
  const put = (v) => { flat.push(v); return flat.length - 1; };
  put(null);
  for (const players of groups) {
    const refs = players.map(([n, pos, cls]) => {
      const [first, ...rest] = n.split(' ');
      const person = { first_name: put(first), last_name: put(rest.join(' ')),
        full_name: put(n), hometown: put('Somewhere, ST'), gender: put('female') };
      const entry = { player: put(person), publication_state: put('published'),
        player_position: put({ id: put(5), name: put(pos), abbreviation: put(pos) }),
        class_level: put({ id: put(1), name: put(cls), abbreviation: put(null) }) };
      return put(entry);
    });
    const list = put(refs);
    put({ players: list, meta: put({ total: put(players.length) }) });
  }
  return `<!doctype html><html><head><title>${title}</title></head><body><div id="__nuxt"></div>`
    + `<script type="application/json" data-nuxt-data="nuxt-app" data-ssr="true" id="__NUXT_DATA__">${JSON.stringify(flat)}</script>`
    + '</body></html>';
}

const NAMES = ['Ada Lovelace', 'Grace Hopper', 'Radia Perlman', 'Barbara Liskov', 'Sophie Wilson',
  'Jean Bartik', 'Kathleen Booth', 'Mary Keller', 'Evelyn Boyd', 'Thelma Estrin'];
const POS = ['Forward', 'Midfielder', 'Defender', 'Goalkeeper'];
const squad = (names, cls = 'Sophomore') => names.map((n, i) => [n, POS[i % 4], cls]);

/** The 2026 squad, and last season's, sharing nobody. */
const SQUAD_2026 = squad(NAMES);
const REF_2025 = ['Old One', 'Old Two', 'Old Three', 'Old Four', 'Old Five',
  'Old Six', 'Old Seven', 'Old Eight'];

/* -------------------------------------------------------------------------- */

d('Oklahoma State: a page that is somebody else\'s roster', () => {
  /** The reproduction: right host, right URL, real squad, wrong sport. */
  const EQUESTRIAN = tablePage('2026-27 Cowgirl Equestrian Roster',
    squad([...NAMES, 'Piper Anderson', 'Jenna Bach', 'Sky Bandini', 'Sheridan Baringer',
      'Tyris Bowdle', 'Kyrah Bowker', 'Allie Stein', 'Emma Verplank']));

  it('1. the equestrian page carries a real squad and names 2026', () => {
    const r = evaluate({ html: EQUESTRIAN, key: 'Oklahoma State||womens-soccer', ref: REF_2025 });
    expect(r.n).toBeGreaterThanOrEqual(18);            // a genuine roster, well over the floor
    expect(r.title).toMatch(/2026-27/);                // and it names the target season
  });

  it('2. and is refused, because the page says it is not this programme', () => {
    const r = evaluate({ html: EQUESTRIAN, key: 'Oklahoma State||womens-soccer', ref: REF_2025 });
    expect(r.contradicted).toMatch(/Equestrian/i);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/page is not this programme's roster/);
  });

  it('3. the refusal is asked BEFORE turnover, not after it', () => {
    // The equestrian squad shares no names with the soccer reference, so the
    // turnover gate is not merely quiet here — it positively approves. The
    // context question has to come first or it never gets asked.
    const r = evaluate({ html: EQUESTRIAN, key: 'Oklahoma State||womens-soccer', ref: REF_2025 });
    expect(r.note).not.toMatch(/repeats/);
    expect(r.note).not.toMatch(/overlap/);
  });

  it('4. the other gender\'s soccer roster is refused too', () => {
    const r = evaluate({ html: tablePage("Sonya Smith - Women's Soccer - SMSU Athletics", SQUAD_2026),
      key: 'Southwest Minnesota State||mens-soccer', ref: REF_2025 });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/page is not this programme's roster/);
  });

  it('5. a men\'s rowing page cannot satisfy a women\'s soccer programme', () => {
    /*
     * Boston University's best rung serves "2025-26 Men's Rowing Roster", and
     * live it is refused on the SEASON — the season gate is asked first, so the
     * context gate never speaks. Titled with the target season instead, the
     * context gate is the only thing standing between this page and an import,
     * which is the case worth pinning.
     */
    const priorSeason = evaluate({ html: tablePage("2025-26 Men's Rowing Roster", SQUAD_2026),
      key: 'Boston University||womens-soccer', ref: REF_2025 });
    expect(priorSeason.ok).toBe(false);
    expect(priorSeason.note).toMatch(/page season is not 2026/);

    const targetSeason = evaluate({ html: tablePage("2026-27 Men's Rowing Roster", SQUAD_2026),
      key: 'Boston University||womens-soccer', ref: REF_2025 });
    expect(targetSeason.ok).toBe(false);
    expect(targetSeason.note).toMatch(/page is not this programme's roster/);
  });

  it('6. NO minimum-overlap rule: the right sport with near-total turnover is accepted', () => {
    /*
     * THE TEST THAT KEEPS THE FIX HONEST. Same 0% overlap as the equestrian
     * page, same season, same player count — and this one is the programme's
     * own roster, so it must resolve. A rule keyed on overlap would refuse both.
     */
    const r = evaluate({ html: tablePage("2026 Women's Soccer Roster - Oklahoma State", SQUAD_2026),
      key: 'Oklahoma State||womens-soccer', ref: REF_2025 });
    expect(r.contradicted).toBe(null);
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/name overlap 0%/);
  });

  it('7. a title that names no sport at all is not refused on that basis', () => {
    // Many roster pages are titled "2026 Roster" and nothing more. Absence of
    // evidence is not a contradiction.
    const r = evaluate({ html: tablePage('2026 Roster', SQUAD_2026),
      key: 'Tufts University||womens-soccer', ref: REF_2025 });
    expect(r.contradicted).toBe(null);
    expect(r.ok).toBe(true);
  });
});

d('Drexel: a page carrying more than one roster', () => {
  const TWO = nuxtPage("2026 Women's Soccer Roster",
    [squad(NAMES.slice(0, 6), 'Sophomore'), squad(['Christine Stevenson', 'Alyssa Findlay',
      'Maddy Moyer', 'Jess Sarkisian', 'Annie Clapp', 'Ava Kiwak'], 'Junior')]);
  const ONE = nuxtPage("2026 Women's Soccer Roster", [squad(NAMES.slice(0, 8))]);

  it('8. the two-container payload is refused, not merged and not narrowed', () => {
    const r = evaluate({ html: TWO, key: 'Drexel||womens-soccer', ref: REF_2025 });
    expect(r.containers).toBe(2);
    expect(r.n).toBe(0);                 // neither 12 (merged) nor 6 (a pick)
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/too few players parsed \(0\)/);
  });

  it('9. one unambiguous container is read normally', () => {
    const r = evaluate({ html: ONE, key: 'Drexel||womens-soccer', ref: REF_2025 });
    expect(r.containers).toBe(1);
    expect(r.n).toBe(8);
    expect(r.ok).toBe(true);
  });

  it('10. the rule is the one parse_nuxt_roster already applied', () => {
    // Both readers refuse the same payload, so neither can be the loose one.
    const code = `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '2026'
import lib
h = sys.stdin.read()
camel, _ = lib.parse_nuxt(h)
print(json.dumps({'camel': len(camel or []), 'anchored': len(lib.parse_nuxt_roster(h) or [])}))
`;
    const r = JSON.parse(execFileSync(python, ['-c', code], { input: TWO, encoding: 'utf8' }));
    expect(r.camel).toBe(0);
    expect(r.anchored).toBe(0);
  });
});

d('the rest of the classification still holds', () => {
  it('11. a prior-season page is refused on the season, as before', () => {
    const r = evaluate({ html: tablePage("2025 Women's Soccer Roster", SQUAD_2026),
      key: 'Tufts University||womens-soccer', ref: REF_2025 });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/page season is not 2026/);
  });

  it('12. a page with nothing to parse is refused on the floor', () => {
    const r = evaluate({ html: '<!doctype html><title>2026 Roster</title><p>coming soon</p>',
      key: 'Tufts University||womens-soccer', ref: REF_2025 });
    expect(r.n).toBe(0);
    expect(r.note).toMatch(/too few players parsed \(0\)/);
  });

  it('13. a thin parse is refused on the floor', () => {
    const r = evaluate({ html: tablePage('2026 Roster', squad(NAMES.slice(0, 3))),
      key: 'Tufts University||womens-soccer', ref: REF_2025 });
    expect(r.n).toBeLessThan(5);
    expect(r.note).toMatch(/too few players parsed/);
  });

  it('14. last season served back is still refused on turnover', () => {
    const same = squad(REF_2025);
    const r = evaluate({ html: tablePage("2026 Women's Soccer Roster", same),
      key: 'Tufts University||womens-soccer', ref: REF_2025 });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/repeats 100%/);
  });

  it('15. a soft 404 answering 200 cannot resolve', () => {
    const r = evaluate({ html: '<!doctype html><title>404 - Page not found</title><body>404</body>',
      key: 'Tufts University||womens-soccer', ref: REF_2025 });
    expect(r.ok).toBe(false);
  });

  it('16. the diagnostic asks the production gate rather than its own', () => {
    // `diagnose_cohort` calls `run.evaluate`; there is no second accept path.
    const src = execFileSync('grep', ['-c', 'run.evaluate', path.join(HERE, 'diagnose_cohort.py')],
      { encoding: 'utf8' });
    expect(Number(src.trim())).toBeGreaterThanOrEqual(1);
    const own = execFileSync('grep', ['-c', "mechanism='WOULD_RESOLVE_NOW'", path.join(HERE, 'diagnose_cohort.py')],
      { encoding: 'utf8' });
    expect(Number(own.trim())).toBe(1);   // set in exactly one place, on `ok`
  });
});

describe('the two implementations of "whose roster is this" agree', () => {
  it('17. sportContradictedParity: JS and Python answer the same on every fixture', () => {
    /*
     * `sportContradicted` in rosterCandidatePlan.js owns this question for
     * candidate discovery; `lib.sport_contradicted` owns it for the acquisition
     * gate. Two implementations are a drift risk, so they are pinned together.
     * The Python side is deliberately WIDER — it also refuses a title naming a
     * different sport, which is the case the JS one missed and Oklahoma State
     * exploited — so parity is asserted where both have an opinion.
     */
    const cases = [
      ["2026 Women's Soccer Roster - Bentley University", 'womens-soccer', false],
      ["Sonya Smith - Women's Soccer - SMSU Athletics", 'mens-soccer', true],
      ["Men's Soccer 2026-27 - Notre Dame Fighting Irish", 'mens-soccer', false],
      ["2026 Men's Soccer Roster", 'womens-soccer', true],
      ['2026 Roster', 'mens-soccer', false],
      ["Women&#x27;s Soccer 2026-27 - Iowa", 'womens-soccer', false],
    ];
    if (!python) return;
    const code = `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '2026'
import lib
print(json.dumps([bool(lib.sport_contradicted(t, s)) for t, s in json.loads(sys.stdin.read())]))
`;
    const pyOut = JSON.parse(execFileSync(python, ['-c', code],
      { input: JSON.stringify(cases.map(([t, s]) => [t, s])), encoding: 'utf8' }));
    cases.forEach(([title, sport, expected], i) => {
      expect(Boolean(sportContradicted(`<title>${title}</title>`, sport))).toBe(expected);
      expect(pyOut[i]).toBe(expected);
    });
  });

  it('18. and the Python side additionally refuses a different sport entirely', () => {
    // The gap: equestrian is neither men's nor women's soccer, so the JS rule
    // has no opinion. Recorded rather than hidden.
    expect(sportContradicted('<title>2026-27 Cowgirl Equestrian Roster</title>', 'womens-soccer')).toBe(null);
    if (!python) return;
    const code = `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '2026'
import lib
print(json.dumps(bool(lib.sport_contradicted('2026-27 Cowgirl Equestrian Roster', 'womens-soccer'))))
`;
    expect(JSON.parse(execFileSync(python, ['-c', code], { encoding: 'utf8' }))).toBe(true);
  });
});
