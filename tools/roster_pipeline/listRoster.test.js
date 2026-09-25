import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7N — a roster written as headings, on a site with no athletics platform.
 *
 * Trinity Washington's athletics site is an ordinary WordPress build. Its
 * roster is a heading per player and three short headings of fields, and every
 * parser in `lib.py` returned zero on it — correctly, because none of them had
 * a shape for it.
 *
 * The danger in adding one is obvious: "a heading followed by short strings"
 * also describes a staff directory, a news index and most footers. So the tests
 * that matter here are the refusals. The fixture is the real page reduced to
 * its heading structure; everything is network-free.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

const fixture = (n) => fs.readFileSync(path.join(HERE, '__fixtures__', n), 'utf8');

function parse(html, fn = 'parse_list_roster') {
  return JSON.parse(execFileSync(python, ['-c', `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ.setdefault('RB_SEASON', '2026')
os.environ.setdefault('RB_REF', '2025')
os.environ.setdefault('RB_CURRENT', '1')
import lib
print(json.dumps(lib.${fn}(sys.stdin.read())))
`], { input: html, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

/** A page built the way Trinity's is: h3 name, h4 fields. */
const page = ({ title = 'Soccer Roster 2026 – Trinity Tigers Athletics', entries = [] } = {}) =>
  `<!doctype html><html><head><title>${title}</title></head><body>`
  + entries.map(([name, ...fields]) => `<h3>${name}</h3>${fields.map((f) => `<h4>${f}</h4>`).join('')}`).join('')
  + '</body></html>';

/* Digit-free, because a name that carries a digit is not a name — see the
 * refusal test below, which is the contract these fixtures have to respect. */
const NAMES = ['Ana Ruiz', 'Beth Cole', 'Cara Nunez', 'Dana Park', 'Elle Voss', 'Fay Odum',
  'Gia Marsh', 'Hana Reid', 'Iris Blake', 'Jill Moray'];
const squad = (n) => NAMES.slice(0, n).map((nm) => [nm, 'Defense', 'Junior', 'Springfield, IL']);

d('the list-shaped roster parser', () => {
  const trinity = fixture('trinity_list_roster_2026.html');

  it('1/2. reads Trinity\'s real 2026 roster', () => {
    const r = parse(trinity);
    expect(r).not.toBe(null);
    expect(r).toHaveLength(13);
  });

  it('10. extracts the names as written, including a typographic apostrophe', () => {
    const names = parse(trinity).map((p) => p.name);
    expect(names).toContain('Alemia Tolentino');
    expect(names).toContain('Miriam Mendoza Pinzon');
    expect(names).toContain('Na’Kiya Butler');
  });

  it('rejects the page builder\'s unfilled template rows', () => {
    // The real page carries seventeen entries and fifteen players: two are
    // placeholders literally named "Player Name" with the cells reading
    // "Position", "Class", "Hometown". Shipping two people called Player Name
    // is exactly what a parser that trusted the shape would have done.
    expect(trinity).toContain('Player Name');
    expect(parse(trinity).map((p) => p.name)).not.toContain('Player Name');
  });

  it('12. leaves a field the site marks unknown empty rather than inventing one', () => {
    // Two real players carry the author's own "Position ?" / "Class ?".
    expect(trinity).toMatch(/Position \?/);
    for (const p of parse(trinity)) {
      expect(p.pos).not.toMatch(/\?/);
      expect(p.cls).not.toMatch(/\?/);
      expect(p.home).not.toMatch(/\?/);
    }
  });

  it('11. infers no nationality — it reads a hometown and stops', () => {
    const r = parse(trinity);
    expect(Object.keys(r[0]).sort()).toEqual(['cls', 'home', 'name', 'pos']);
    expect(r.find((p) => p.name === 'Alemia Tolentino').home).toBe('DMV');
  });

  it('reads position and class into their own fields', () => {
    const p = parse(trinity).find((x) => x.name === 'Zinn Kurose');
    expect(p).toEqual({ name: 'Zinn Kurose', pos: 'GK', cls: 'Freshman', home: 'Hawaii' });
  });
});

d('what the list parser refuses', () => {
  it('8. a page that names no season', () => {
    expect(parse(page({ title: 'Soccer Roster – Trinity Tigers Athletics', entries: squad(8) }))).toBe(null);
  });

  it('a page that never calls itself a roster', () => {
    expect(parse(page({ title: 'Coaching Staff 2026 – Tigers', entries: squad(8) }))).toBe(null);
  });

  it('3. a navigation list — headings with nothing under them', () => {
    const nav = '<!doctype html><html><head><title>Soccer Roster 2026</title></head><body>'
      + ['Basketball', 'Soccer', 'Tennis', 'Volleyball', 'Team Home', 'Roster', 'Schedule']
        .map((t) => `<h3>${t}</h3>`).join('')
      + '</body></html>';
    expect(parse(nav)).toBe(null);
  });

  it('4. a staff list', () => {
    const staff = page({ entries: [
      ['Emilee Kirk', 'Athletic Director', 'Staff', 'Washington, DC'],
      ['Jordan Reed', 'Head Coach', 'Staff', 'Washington, DC'],
      ['Alex Rivera', 'Assistant Coach', 'Staff', 'Washington, DC'],
      ['Sam Doyle', 'Sports Information', 'Staff', 'Washington, DC'],
      ['Casey Lin', 'Athletic Trainer', 'Staff', 'Washington, DC'],
      ['Robin Vale', 'Equipment Manager', 'Staff', 'Washington, DC'],
    ] });
    // The caller's five-row floor is not the defence being tested: these six
    // entries carry job titles where a squad carries positions, and the staff
    // filter in `_players` removes what survives. What matters here is that
    // nothing is mistaken for a position or a class year.
    for (const p of parse(staff) ?? []) {
      expect(p.pos).toBe('');
      expect(p.cls).toBe('');
    }
  });

  it('5. a schedule of opponents', () => {
    const sched = '<!doctype html><html><head><title>Soccer Schedule 2026</title></head><body>'
      + ['Bard College', 'Mount Saint Mary', 'Bucks County', 'Suffolk County']
        .map((t) => `<h3>${t}</h3><h4>Away</h4><h4>1:00 PM</h4>`).join('')
      + '</body></html>';
    // The page never calls itself a roster.
    expect(parse(sched)).toBe(null);
  });

  it('9. an empty styled list on an otherwise valid roster page', () => {
    expect(parse(page({ entries: [] }))).toBe(null);
  });

  it('a heading that is a section title rather than a person', () => {
    const mixed = page({ entries: [...squad(6), ['Fall 2026', 'Defense', 'Junior'], ['Soccer Roster', 'Defense', 'Junior']] });
    const names = parse(mixed).map((p) => p.name);
    expect(names).not.toContain('Fall 2026');
    expect(names).not.toContain('Soccer Roster');
    expect(names).toHaveLength(6);
  });

  it('a heading carrying a digit, which no person\'s name does here', () => {
    const numbered = page({ entries: [...squad(6), ['Squad 2026 List', 'Defense', 'Junior']] });
    expect(parse(numbered).map((p) => p.name)).not.toContain('Squad 2026 List');
  });
});

d('the other parser families are unchanged', () => {
  it('14. Presto flip-cards still read as presto-card, not as a list', () => {
    const html = fixture('presto_cards_womens.html');
    const [recs, , name] = JSON.parse(execFileSync(python, ['-c', `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ.setdefault('RB_SEASON', '2026')
os.environ.setdefault('RB_REF', '2025')
os.environ.setdefault('RB_CURRENT', '1')
import lib
r, t, n = lib.parse_any(sys.stdin.read())
print(json.dumps([r, t, n]))
`], { input: html, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
    expect(name).toBe('presto-card');
    expect(recs.length).toBeGreaterThan(5);
  });

  it('13. parse_any prefers the richest read and only falls to the list shape', () => {
    // A table roster still reads as a table even though the page would also
    // satisfy the list parser's page-level gate.
    const table = '<!doctype html><html><head><title>Soccer Roster 2026</title></head><body>'
      + '<table><tr><th>No.</th><th>Name</th><th>Pos.</th><th>Cl.</th><th>Hometown</th></tr>'
      + squad(7).map(([n, p, c, h], i) => `<tr><td>${i + 1}</td><td>${n}</td><td>${p}</td><td>${c}</td><td>${h}</td></tr>`).join('')
      + '</table></body></html>';
    const [, , name] = JSON.parse(execFileSync(python, ['-c', `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ.setdefault('RB_SEASON', '2026')
import lib
r, t, n = lib.parse_any(sys.stdin.read())
print(json.dumps([r, t, n]))
`], { input: table, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
    expect(name).toBe('table');
  });
});
