import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7Q — the second question the turnover gate could not ask.
 *
 * The name gate refuses a live page that repeats 85% of last season's squad,
 * and its own message says why that is not enough: "either last season served
 * back, or a 2026 page listing only returners". Both are in the bucket. Of the
 * twenty programmes L7Q re-attempted, Bentley's 2026 page repeats 87% and every
 * one of its 26 returners is a year older; Frostburg State's repeats 97% and
 * not one of its 30 has moved. The first is a roster. The second is last year's.
 *
 * The evidence separating them is the class column, read through the fact that
 * a returning player's GRADUATION year does not change while the label implying
 * it must: So. in 2025 and Jr. in 2026 both mean 2029.
 *
 * WHAT THESE TESTS ARE FOR. The admission is a hole in a gate that exists to
 * keep stale data out, so the tests that matter are the refusals — a page that
 * does not name its season, a squad whose labels never moved, a roster with too
 * few returners to say anything, and labels that cannot age at all. Everything
 * is network-free and sheet-free: the reference roster is injected.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

const KEY = 'Test College||womens-soccer';

/**
 * Run `run.evaluate` against an injected 2025 reference, so the gate is
 * measured and nothing on disk is read.
 *
 * `ref` and `live` are [name, class] pairs.
 */
function evaluate({ ref, live, title, season = 2026 }) {
  const code = `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '${season}'
os.environ['RB_REF'] = '${season - 1}'
os.environ['RB_CURRENT'] = '1'
import re, collections
import run, state
arg = json.loads(sys.stdin.read())
KEY = arg['key']
norm = lambda s: re.sub(r'[^a-z]', '', (s or '').lower())
run.N25 = {KEY: {norm(n) for n, _ in arg['ref']}}
run.CLS25 = {KEY: {norm(n): c for n, c in arg['ref']}}
recs = [{'name': n, 'cls': c, 'pos': 'Forward', 'home': 'Boston, Mass.'} for n, c in arg['live']]
ok, note = run.evaluate(recs, arg['title'], KEY, len(arg['ref']), 'https://example.test/roster')
aged, moved = run.returners_aged([(r['name'], r['cls']) for r in recs], KEY)
print(json.dumps({'ok': ok, 'note': note, 'overlap': run.overlap(recs, KEY),
                  'aged': aged, 'moved': moved}))
`;
  return JSON.parse(execFileSync(python, ['-c', code], {
    input: JSON.stringify({ key: KEY, ref, live, title }), encoding: 'utf8',
  }));
}

/** Twelve returners, so the sample is never the reason a case passes or fails. */
const SQUAD = ['Ada Lovelace', 'Grace Hopper', 'Karen Sparck', 'Radia Perlman', 'Barbara Liskov',
  'Sophie Wilson', 'Jean Bartik', 'Kathleen Booth', 'Mary Keller', 'Evelyn Boyd',
  'Thelma Estrin', 'Erna Schneider'];
const NEXT = { 'Fr.': 'So.', 'So.': 'Jr.', 'Jr.': 'Sr.', 'Sr.': 'Gr.' };
const cycle = (i) => ['Fr.', 'So.', 'Jr.', 'Sr.'][i % 4];
const ref2025 = SQUAD.map((n, i) => [n, cycle(i)]);
/** The same squad a year older: what a genuine 2026 page shows. */
const aged2026 = ref2025.map(([n, c]) => [n, NEXT[c]]);

d('a high-overlap page is admitted only when its returners aged', () => {
  it('1. admits a 2026 page whose whole returning squad is a year older', () => {
    const r = evaluate({ ref: ref2025, live: aged2026, title: "2026 Women's Soccer Roster" });
    expect(r.overlap).toBe(1);
    expect(r.aged).toBe(12);
    expect(r.moved).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/12 of 12 returners are exactly one year older/);
  });

  it('2. refuses last season served back, where no label moved', () => {
    const r = evaluate({ ref: ref2025, live: ref2025, title: "2026 Women's Soccer Roster" });
    expect(r.aged).toBe(0);
    expect(r.moved).toBe(12);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/repeats 100%/);
    expect(r.note).toMatch(/0 of 12 returners are a year older/);
  });

  it('3. refuses an aged squad on a page that does not name the season', () => {
    const r = evaluate({ ref: ref2025, live: aged2026, title: "Women's Soccer Roster" });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/title does not name the season/);
  });

  it('4. refuses a page naming the WRONG season before the class data is read', () => {
    const r = evaluate({ ref: ref2025, live: aged2026, title: "2025 Women's Soccer Roster" });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/page season is not 2026/);
  });

  it('5. refuses when too few returners are comparable to say anything', () => {
    // Three returners aged and the rest are new names: the overlap is low
    // enough that the gate never fires, and if it did, three is under the floor.
    const ref = ref2025.slice(0, 3);
    const live = [...aged2026.slice(0, 3), ['Nnedi Okorafor', 'Fr.'], ['Ursula Guin', 'Fr.']];
    const r = evaluate({ ref, live, title: "2026 Women's Soccer Roster" });
    expect(r.aged).toBe(3);
    expect(r.moved).toBe(0);
    // Overlap 3/5 = 60%, below the 85% gate, so the page is judged on its own.
    expect(r.overlap).toBeCloseTo(0.6, 5);
    expect(r.ok).toBe(true);
    expect(r.note).not.toMatch(/returners/);
  });

  it('6. refuses a mostly-unmoved squad: a quarter ageing is not evidence', () => {
    const live = ref2025.map(([n, c], i) => [n, i < 3 ? NEXT[c] : c]);
    const r = evaluate({ ref: ref2025, live, title: "2026 Women's Soccer Roster" });
    expect(r.aged).toBe(3);
    expect(r.moved).toBe(9);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/3 of 12 returners are a year older/);
  });

  it('7. admits at three quarters aged, and refuses just below it', () => {
    const at = ref2025.map(([n, c], i) => [n, i < 9 ? NEXT[c] : c]);      // 9/12 = 0.75
    const below = ref2025.map(([n, c], i) => [n, i < 8 ? NEXT[c] : c]);   // 8/12 = 0.67
    expect(evaluate({ ref: ref2025, live: at, title: '2026 Roster' }).ok).toBe(true);
    expect(evaluate({ ref: ref2025, live: below, title: '2026 Roster' }).ok).toBe(false);
  });

  it('8. treats an explicit class-of label as no evidence, because it cannot age', () => {
    // "'29" means 2029 in every season, so an unchanged value proves nothing —
    // and a page that repeats the whole squad with no ageing evidence stays out.
    const ref = SQUAD.map((n) => [n, "'29"]);
    const r = evaluate({ ref, live: ref, title: "2026 Women's Soccer Roster" });
    expect(r.aged).toBe(0);
    expect(r.moved).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/too few comparable returners \(0\)/);
  });

  it('9. counts a redshirt that stayed redshirted as not aged', () => {
    // R-Fr. sits with So.; an unchanged R-Fr. a season later implies a year
    // later, so it reads as moved — the same as any label that did not change.
    const ref = SQUAD.map((n) => [n, 'R-Fr.']);
    const r = evaluate({ ref, live: ref, title: '2026 Roster' });
    expect(r.aged).toBe(0);
    expect(r.moved).toBe(12);
    expect(r.ok).toBe(false);
  });

  it('10. leaves a page below the gate alone, admitted on its own terms', () => {
    const live = [...aged2026.slice(0, 4), ...['A Nother', 'B Second', 'C Third', 'D Fourth',
      'E Fifth', 'F Sixth', 'G Seventh', 'H Eighth'].map((n) => [n, 'Fr.'])];
    const r = evaluate({ ref: ref2025, live, title: "2026 Women's Soccer Roster" });
    expect(r.overlap).toBeLessThan(0.85);
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/name overlap 33%/);
  });

  it('11. leaves the later refusals in force; an admission removes one, not all', () => {
    // The implausible-count check sits AFTER the gate, so the admission must
    // fall through to it rather than return. The two cannot both fire — a page
    // repeating 85% of an N-player squad cannot also be 2.6N long — which is
    // exactly why the structure has to be right instead of reasoned about.
    const ref = [...ref2025, ...['M One', 'N Two', 'O Three', 'P Four'].map((n) => [n, 'Fr.'])];
    const live = [...ref.map(([n, c]) => [n, NEXT[c] ?? c]),
      ...Array.from({ length: 30 }, (_, i) => [`New Arrival ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i % 26]}${i}`, 'Fr.'])];
    const r = evaluate({ ref, live, title: '2026 Roster' });
    expect(r.overlap).toBeLessThan(0.85);
    expect(live.length).toBeGreaterThan(2.6 * ref.length);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/implausible player count/);
  });

  it('11b. records the admission in the note the roster ships with', () => {
    const r = evaluate({ ref: ref2025, live: aged2026, title: '2026 Roster' });
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/2025 name overlap 100%/);
    expect(r.note).toMatch(/admitted because the page names 2026/);
  });
});

d('the admission cannot be undone by the next run', () => {
  it('12/13. verify_gate consults the same predicate and keeps an aged roster', () => {
    const out = execFileSync(python, ['-c', `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '2026'; os.environ['RB_REF'] = '2025'; os.environ['RB_CURRENT'] = '1'
import re, run, verify_gate
arg = json.loads(sys.stdin.read())
norm = lambda s: re.sub(r'[^a-z]', '', (s or '').lower())
run.CLS25 = {arg['key']: {norm(n): c for n, c in arg['ref']}}
aged_rows  = [{'Player Name': n, 'Class/Year': c} for n, c in arg['aged']]
stale_rows = [{'Player Name': n, 'Class/Year': c} for n, c in arg['ref']]
print(json.dumps({
  'aged_kept':  run.aged_into_season([(r['Player Name'], r['Class/Year']) for r in aged_rows],  arg['key'])[0],
  'stale_kept': run.aged_into_season([(r['Player Name'], r['Class/Year']) for r in stale_rows], arg['key'])[0],
  'reads_run':  'run.aged_into_season' in open(verify_gate.__file__).read(),
}))
`], { input: JSON.stringify({ key: KEY, ref: ref2025, aged: aged2026 }), encoding: 'utf8' });
    const r = JSON.parse(out);
    expect(r.aged_kept).toBe(true);    // the roster the gate admitted survives
    expect(r.stale_kept).toBe(false);  // last season served back is still demoted
    expect(r.reads_run).toBe(true);    // and it is the same function, not a copy
  });
});
