import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { rosterCandidatesForVerifiedHost, MAX_ATTEMPTED_CANDIDATES } from '../../shared/roster/rosterCandidates.js';

/**
 * L7G — a ranked list of hypotheses, walked in order, each facing every gate.
 *
 * L7F acquired seven of eight programmes and lost Southwest Minnesota State to
 * an architecture rather than to the web. The generator ranked 24 candidates and
 * the roster was the tenth; the worklist carried one; `variants.ladder` expands
 * a URL into its season-bearing forms and cannot cross into another shape
 * family. So candidate one 404ing was the end of it.
 *
 * The distinction this file holds is the one that mattered:
 *
 *   LADDER    the same page, addressed differently
 *   CANDIDATE a different hypothesis about where the roster lives
 *
 * Measured across 1,605 known NCAA roster URLs, 92.1% win at candidate one and
 * 7.9% do not — 127 programmes that a single-candidate design cannot reach.
 * Everything below is network-free.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

/** `attempt_urls` on one worklist row, as ordered pairs. */
function attemptUrls(row, { season = 2026 } = {}) {
  const src = `
import sys, os, json
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ.setdefault('RB_SEASON', '${season}')
os.environ.setdefault('RB_REF', '${season - 1}')
os.environ.setdefault('RB_CURRENT', '1')
import variants
row = json.loads(sys.stdin.read())
print(json.dumps(variants.attempt_urls(row)))
`;
  return JSON.parse(execFileSync(python, ['-c', src], { input: JSON.stringify(row), encoding: 'utf8' }));
}

const summarise = (tried) => JSON.parse(execFileSync(python, ['-c', `
import sys, os, json
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ.setdefault('RB_SEASON', '2026'); os.environ.setdefault('RB_REF', '2025')
import variants
print(json.dumps(variants.summarise(json.loads(sys.stdin.read()))))
`], { input: JSON.stringify(tried), encoding: 'utf8' }));

/** The real SMSU ranking, which is the regression fixture. */
const SMSU = rosterCandidatesForVerifiedHost({
  host: 'smsumustangs.com', sport: 'mens-soccer', season: 2026, verified: true, platform: 'PRESTO',
}).candidates.map((c) => c.url);
const WORKING = 'https://smsumustangs.com/sports/msoc/roster/season/2026';

const row = (o = {}) => ({
  School: 'Southwest Minnesota State', Sport: 'mens-soccer',
  'Roster URL 2026 (candidate)': SMSU[0], _cand: SMSU[0],
  'Generated Candidates': SMSU.join('|'),
  'Roster URL 2025 (known good)': '', '2025 Player Count': '0',
  Method: 'generated from a verified athletics host', ...o,
});

describe('the catalogue still contains the URL that was lost', () => {
  it('ranks Southwest Minnesota State\'s roster tenth', () => {
    expect(SMSU.length).toBe(24);
    expect(SMSU.indexOf(WORKING) + 1).toBe(10);
  });

  it('bounds attempts at the observed maximum winning ordinal', () => {
    // Sixteen, because sixteen is the highest ordinal that has ever won across
    // 1,601 reproduced URLs. Not a guess and not the whole catalogue.
    expect(MAX_ATTEMPTED_CANDIDATES).toBe(16);
    expect(SMSU.indexOf(WORKING) + 1).toBeLessThanOrEqual(MAX_ATTEMPTED_CANDIDATES);
  });
});

d('a generated row walks its ranking', () => {
  const urls = attemptUrls(row());

  it('offers the working URL, which one candidate alone never could', () => {
    expect(urls.map(([, u]) => u)).toContain(WORKING);
  });

  it('keeps the generator\'s order', () => {
    const ordinals = urls.map(([o]) => o);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(ordinals[0]).toBe(1);
  });

  it('attributes every URL to the candidate it came from', () => {
    for (const [ordinal, u] of urls) {
      expect(ordinal).toBeGreaterThanOrEqual(1);
      expect(ordinal).toBeLessThanOrEqual(MAX_ATTEMPTED_CANDIDATES);
      expect(u).toMatch(/^https:\/\/smsumustangs\.com\//);
    }
  });

  it('stops at the bound rather than walking the whole catalogue', () => {
    expect(Math.max(...urls.map(([o]) => o))).toBeLessThanOrEqual(MAX_ATTEMPTED_CANDIDATES);
  });

  it('asks for nothing twice', () => {
    const seen = urls.map(([, u]) => u);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('never leaves the one verified host', () => {
    // Every candidate is generated for a host whose identity was established
    // before any URL existed, so progression cannot wander to another
    // institution. Cross-programme leakage is impossible by construction, and
    // this is the assertion that keeps it so.
    for (const [, u] of urls) expect(new URL(u).hostname).toBe('smsumustangs.com');
  });
});

d('what a generated row does NOT change', () => {
  it('leaves a known-good row on its own single ladder', () => {
    const known = row({
      'Generated Candidates': '',
      _cand: 'https://example.test/sports/mens-soccer/roster/2026',
      Method: 'year-swap (direct)',
    });
    const urls = attemptUrls(known);
    expect(urls.every(([o]) => o === 0)).toBe(true);
    for (const [, u] of urls) expect(u).toMatch(/^https:\/\/example\.test\//);
  });

  it('leaves a hand-repaired row alone', () => {
    // `repairs()` carries a manual URL forward under its own Method, and a
    // manual row carries no generated list — so it walks its own ladder, as it
    // always has. L7C established that separation; L7G must not blur it.
    const manual = row({ 'Generated Candidates': '', _cand: 'https://hand.test/roster', Method: 'hand-repaired after a soft 404' });
    const urls = attemptUrls(manual);
    expect(urls.every(([o]) => o === 0)).toBe(true);
    expect(urls.some(([, u]) => u.startsWith('https://hand.test/'))).toBe(true);
  });

  it('generates nothing for a row with no candidates at all', () => {
    expect(attemptUrls(row({ 'Generated Candidates': '', _cand: '', 'Roster URL 2025 (known good)': '' })))
      .toEqual([]);
  });
});

d('which failures move on, and which are remembered', () => {
  it('reports a content failure ahead of any number of wrong guesses', () => {
    // The defect this replaces: `tried[-1]` reported whichever 404 came last,
    // so "the site served last season's squad" read as "nothing answered".
    const [err, kept] = summarise([
      'https://a.test/1 -> 2025 name overlap 100%',
      'https://a.test/2 -> fetch 404',
      'https://a.test/3 -> fetch 404',
    ]);
    expect(err).toContain('2025 name overlap 100%');
    expect(err).toContain('2 route failures');
    expect(kept[0]).toContain('overlap');
  });

  it('reports a parse failure rather than a later 404', () => {
    const [err] = summarise(['https://a.test/1 -> only 2 rows', 'https://a.test/2 -> fetch 404']);
    expect(err).toContain('only 2 rows');
  });

  it('says plainly when nothing was ever served', () => {
    const [err] = summarise(['https://a.test/1 -> fetch 404', 'https://a.test/2 -> fetch 403']);
    expect(err).toContain('fetch 404');
    expect(err).toContain('more route failures');
  });

  it('says so when there was nothing to try', () => {
    expect(summarise([])[0]).toBe('no candidate');
  });
});

d('the worklist carries the ranking', () => {
  const HDR = ['School', 'Conference', 'Player Name', 'Class/Year', 'Total Minutes Played',
    'Games Played', 'Games Started', 'Nationality', 'Hometown', 'Country', 'Source Stats URL',
    'Source Roster URL', 'Data Confidence', 'Notes', 'Estimated Graduation', 'Position'];

  function build({ registry, candidates, season = 2026 }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-mc-'));
    const dir = path.join(root, `${season} Roster Sheets`);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(root, `${season - 1} Roster Sheets`), { recursive: true });
    fs.writeFileSync(path.join(root, `${season - 1} Roster Sheets`, `ncaa_d2_mens_soccer_${season - 1}_rosters.csv`),
      `${HDR.join(',')}\n`);
    fs.writeFileSync(path.join(dir, '_registry_universe.csv'),
      ['School,Sport,Division,Conference,Unitid', ...registry].join('\r\n') + '\r\n');
    if (candidates) {
      fs.writeFileSync(path.join(dir, '_registry_candidates.csv'),
        ['School,Sport,Host,Platform,Candidate,Candidates', ...candidates].join('\r\n') + '\r\n');
    }
    execFileSync(python, ['build_targets.py', String(season)],
      { cwd: HERE, env: { ...process.env, RB_ROOT: root }, encoding: 'utf8' });
    const out = fs.readFileSync(path.join(dir, '_targets.csv'), 'utf8');
    const [head, ...rest] = out.trim().split(/\r?\n/);
    const cols = head.split(',');
    return rest.map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(',')[i]])));
  }

  const REG = ['Lost Programme,mens-soccer,NCAA D2,CONF,1'];

  it('survives worklist construction with its order intact', () => {
    // Season-bearing, as the generator actually emits them, so `swap` is a
    // no-op and the order is the only thing under test.
    const list = ['https://h.test/sports/msoc/roster/2026',
      'https://h.test/sports/msoc/roster/season/2026',
      'https://h.test/sports/mens-soccer/roster/2026'];
    const rows = build({
      registry: REG,
      candidates: [`Lost Programme,mens-soccer,h.test,PRESTO,${list[0]},${list.join('|')}`],
    });
    const r = rows.find((x) => x.School === 'Lost Programme');
    expect(r['Generated Candidates'].split('|')).toEqual(list);
    expect(r['Roster URL 2026 (candidate)']).toBe(list[0]);
    expect(r.Method).toBe('generated from a verified athletics host');
  });

  it('normalises a year-less candidate exactly as it normalises the first', () => {
    const rows = build({
      registry: REG,
      candidates: ['Lost Programme,mens-soccer,h.test,PRESTO,https://h.test/a/roster,https://h.test/a/roster|https://h.test/b/roster'],
    });
    const r = rows.find((x) => x.School === 'Lost Programme');
    // `swap` appends the season to a year-less path, for the first candidate
    // and for every other one. A candidate that skipped it would not be in the
    // normal path, whatever the diagram says.
    expect(r['Generated Candidates'].split('|'))
      .toEqual(['https://h.test/a/roster/2026', 'https://h.test/b/roster/2026']);
    expect(r['Roster URL 2026 (candidate)']).toBe('https://h.test/a/roster/2026');
  });

  it('normalises every candidate the same way it normalises the first', () => {
    // L7C's lesson: a raw Presto candidate kept `?view=table` and the ladder
    // appended a season to the QUERY. A candidate that skips the normalisation
    // everything else gets is not in the normal path.
    const rows = build({
      registry: REG,
      candidates: ['Lost Programme,mens-soccer,h.test,PRESTO,https://h.test/a/roster?view=table,https://h.test/a/roster?view=table|https://h.test/b/roster?view=table'],
    });
    const r = rows.find((x) => x.School === 'Lost Programme');
    expect(r['Generated Candidates']).not.toContain('view=table');
  });

  it('leaves the known-good column empty, whatever the ranking holds', () => {
    const rows = build({
      registry: REG,
      candidates: ['Lost Programme,mens-soccer,h.test,PRESTO,https://h.test/a/roster,https://h.test/a/roster|https://h.test/b/roster'],
    });
    // A hypothesis is not an observation, however many of them there are.
    expect(rows.find((x) => x.School === 'Lost Programme')['Roster URL 2025 (known good)']).toBe('');
  });

  it('carries no ranking for a programme that has none', () => {
    const rows = build({ registry: REG, candidates: null });
    const r = rows.find((x) => x.School === 'Lost Programme');
    expect(r['Generated Candidates']).toBe('');
    expect(r.Method).toBe('no later URL on record — discover from scratch');
  });

  it('keeps a generated method generated, so a rebuild can replace it', () => {
    // If `repairs()` read this as human authority it would be frozen, and a
    // corrected generator could never replace it. L7C lost a rebuild to that.
    const src = fs.readFileSync(path.join(HERE, 'build_targets.py'), 'utf8');
    const methods = src.slice(src.indexOf('GENERATED_METHODS'), src.indexOf('def repairs'));
    expect(methods).toContain('generated from a verified athletics host');
  });
});
