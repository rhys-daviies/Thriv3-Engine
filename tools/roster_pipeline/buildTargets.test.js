import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L6C — that the worklist generator still behaves, without touching the network.
 *
 * Live acquisition is an operational command. What CI can and must check is the
 * rule L6B established: the REGISTRY decides who is considered, and prior roster
 * success only suggests where to look. These run against fixture sheets in a
 * temporary RB_ROOT, so they neither read nor write a real season.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

const SHEET = 'School,Conference,Player Name,Class/Year,Total Minutes Played,Games Played,'
  + 'Games Started,Nationality,Hometown,Country,Source Stats URL,Source Roster URL,'
  + 'Data Confidence,Notes,Estimated Graduation,Position';
const row = (school, conf, url) => `${school},${conf},A Player,Fr.,,,,,,,,${url},high,,2029,DEFENSE`;

/** A throwaway RB_ROOT holding one prior season and an empty target season. */
function fixture({ prior = [], registry = null, candidates = null, season = 2026 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-'));
  fs.mkdirSync(path.join(root, `${season} Roster Sheets`), { recursive: true });
  const prev = path.join(root, `${season - 1} Roster Sheets`);
  fs.mkdirSync(prev, { recursive: true });
  const byFile = new Map();
  for (const p of prior) {
    const f = `ncaa_${p.div}_${p.gender}_soccer_${season - 1}_rosters.csv`;
    if (!byFile.has(f)) byFile.set(f, [SHEET]);
    byFile.get(f).push(row(p.school, p.conf ?? 'CONF', p.url ?? ''));
  }
  for (const [f, lines] of byFile) fs.writeFileSync(path.join(prev, f), lines.join('\n'));
  if (candidates) {
    fs.writeFileSync(path.join(root, `${season} Roster Sheets`, '_registry_candidates.csv'),
      ['School,Sport,Host,Platform,Candidate',
        ...candidates.map((c) => `${c.school},${c.sport},${c.host ?? ''},${c.platform ?? ''},${c.candidate}`),
      ].join('\r\n') + '\r\n');
  }
  if (registry) {
    fs.writeFileSync(path.join(root, `${season} Roster Sheets`, '_registry_universe.csv'),
      ['School,Sport,Division,Conference,Unitid',
        ...registry.map((r) => `${r.school},${r.sport},${r.division},${r.conference ?? ''},${r.unitid ?? ''}`),
      ].join('\r\n') + '\r\n');
  }
  return root;
}

function run(root, season = 2026) {
  execFileSync(python, ['build_targets.py', String(season)],
    { cwd: HERE, env: { ...process.env, RB_ROOT: root }, encoding: 'utf8' });
  const out = fs.readFileSync(path.join(root, `${season} Roster Sheets`, '_targets.csv'), 'utf8');
  const [head, ...rest] = out.trim().split(/\r?\n/);
  const cols = head.split(',');
  return rest.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}

d('the registry decides membership', () => {
  it('admits an active programme that has never had a roster', () => {
    const root = fixture({
      prior: [{ school: 'Has Roster', div: 'd3', gender: 'womens', url: 'https://x.test/2025' }],
      registry: [
        { school: 'Has Roster', sport: 'womens-soccer', division: 'NCAA D3' },
        { school: 'Never Fetched', sport: 'womens-soccer', division: 'NCAA D3' },
      ],
    });
    const rows = run(root);
    const names = rows.map((r) => r.School);
    expect(names).toContain('Never Fetched');
    expect(names).toContain('Has Roster');
  });

  it('gives a history-less programme a discovery method, not an exclusion', () => {
    const root = fixture({
      prior: [{ school: 'Has Roster', div: 'd3', gender: 'womens', url: 'https://x.test/2025' }],
      registry: [{ school: 'Never Fetched', sport: 'womens-soccer', division: 'NCAA D3' }],
    });
    const r = run(root).find((x) => x.School === 'Never Fetched');
    expect(r.Method).toMatch(/discover from scratch/);
    expect(r['Roster URL 2026 (candidate)']).toBe('');
  });

  it('still reuses a known-good URL where one exists', () => {
    const root = fixture({
      prior: [{ school: 'Has Roster', div: 'd3', gender: 'womens', url: 'https://x.test/2025' }],
      registry: [{ school: 'Has Roster', sport: 'womens-soccer', division: 'NCAA D3' }],
    });
    const r = run(root).find((x) => x.School === 'Has Roster');
    expect(r['Roster URL 2026 (candidate)']).toBe('https://x.test/2026');
    expect(r.Method).toBe('year-swap (direct)');
  });

  it('behaves exactly as before when no registry file is present', () => {
    const prior = [{ school: 'Only In Sheet', div: 'd3', gender: 'mens', url: 'https://y.test/2025' }];
    const withReg = run(fixture({ prior, registry: [] })).map((r) => r.School);
    const without = run(fixture({ prior })).map((r) => r.School);
    expect(withReg).toEqual(without);
    expect(without).toEqual(['Only In Sheet']);
  });
});

d('scope stays isolated', () => {
  it('does not let a men\'s sheet entry satisfy a women\'s programme', () => {
    // The L4 defect. Same school, two genders, one of them never fetched.
    const root = fixture({
      prior: [{ school: 'Both Genders', div: 'd3', gender: 'mens', url: 'https://z.test/2025' }],
      registry: [
        { school: 'Both Genders', sport: 'mens-soccer', division: 'NCAA D3' },
        { school: 'Both Genders', sport: 'womens-soccer', division: 'NCAA D3' },
      ],
    });
    const rows = run(root).filter((r) => r.School === 'Both Genders');
    expect(rows).toHaveLength(2);
    const w = rows.find((r) => r.Sport === 'womens-soccer');
    const m = rows.find((r) => r.Sport === 'mens-soccer');
    expect(w.Method).toMatch(/discover from scratch/);
    expect(m['Roster URL 2026 (candidate)']).toBe('https://z.test/2026');
  });

  it('carries the registry division for a programme with no sheet history', () => {
    const root = fixture({
      prior: [{ school: 'Anchor', div: 'd3', gender: 'mens', url: 'https://a.test/2025' }],
      registry: [{ school: 'D2 Only', sport: 'mens-soccer', division: 'NCAA D2', conference: 'NSIC' }],
    });
    const r = run(root).find((x) => x.School === 'D2 Only');
    expect(r.Division).toBe('NCAA D2');
    expect(r.Conference).toBe('NSIC');
  });
});

/* -------------------------------------------------------------------------- */
/* L6D-PRE — run scope is not membership                                       */
/* -------------------------------------------------------------------------- */

/**
 * The distinction the whole stage exists to hold.
 *
 *   `targets()`         who exists and is eligible — unchanged by any filter
 *   `attempt_targets()` who THIS run tries — narrowed by RB_KEYS/RB_DIVISIONS
 *
 * An excluded target is not attempted, and nothing else: not marked, not
 * written to state, not removed from the worklist. L6D was stopped because the
 * runner had no way to say this, and would have reached 75 programmes in
 * associations the stage deferred.
 */
d('run scope', () => {
  const REG = [
    { school: 'D2 Gap', sport: 'mens-soccer', division: 'NCAA D2' },
    { school: 'D3 Gap', sport: 'womens-soccer', division: 'NCAA D3' },
    { school: 'D3 Other', sport: 'mens-soccer', division: 'NCAA D3' },
    { school: 'Naia One', sport: 'mens-soccer', division: 'NAIA' },
  ];
  const PRIOR = [{ school: 'Anchor', div: 'd3', gender: 'mens', url: 'https://a.test/2025' }];

  /** Read `attempt_targets()` through the real state module, no network. */
  const attempt = (root, env = {}) => JSON.parse(execFileSync(python, ['-c', [
    'import sys, json, os',
    'sys.path.insert(0, ".")',
    'import state',
    'print(json.dumps({"universe": [state.key(r) for r in state.targets()],',
    '                  "attempt":  [state.key(r) for r in state.attempt_targets()]}))',
  ].join('\n')], {
    cwd: HERE,
    env: { ...process.env, RB_ROOT: root, RB_SEASON: '2026', RB_REF: '2025', RB_CURRENT: '1', ...env },
    encoding: 'utf8',
  }));

  const rootWith = () => {
    const root = fixture({ prior: PRIOR, registry: REG });
    execFileSync(python, ['build_targets.py', '2026'],
      { cwd: HERE, env: { ...process.env, RB_ROOT: root }, encoding: 'utf8' });
    return root;
  };

  it('attempts everything when no filter is set', () => {
    const root = rootWith();
    const { universe, attempt: a } = attempt(root);
    expect(a).toEqual(universe);
    expect(a.length).toBe(5); // 4 registry + Anchor from the sheet
  });

  it('--keys narrows the attempt set only', () => {
    const root = rootWith();
    const keys = path.join(root, 'keys.txt');
    fs.writeFileSync(keys, 'D2 Gap||mens-soccer\nD3 Gap||womens-soccer\n');
    const { universe, attempt: a } = attempt(root, { RB_KEYS: keys });
    expect(a).toEqual(['D2 Gap||mens-soccer', 'D3 Gap||womens-soccer']);
    // Membership is untouched — the excluded three are still eligible.
    expect(universe.length).toBe(5);
  });

  it('--divisions narrows the attempt set only', () => {
    const root = rootWith();
    const { universe, attempt: a } = attempt(root, { RB_DIVISIONS: 'NCAA D2,NCAA D3' });
    expect(a).not.toContain('Naia One||mens-soccer');
    expect(a).toHaveLength(4);
    expect(universe).toContain('Naia One||mens-soccer');
  });

  it('intersects when both are given', () => {
    const root = rootWith();
    const keys = path.join(root, 'keys.txt');
    // One in-division key and one out-of-division key: only the first survives.
    fs.writeFileSync(keys, 'D2 Gap||mens-soccer\nNaia One||mens-soccer\n');
    const { attempt: a } = attempt(root, { RB_KEYS: keys, RB_DIVISIONS: 'NCAA D2,NCAA D3' });
    expect(a).toEqual(['D2 Gap||mens-soccer']);
  });

  it('leaves the target universe byte-identical under any filter', () => {
    const root = rootWith();
    const before = fs.readFileSync(path.join(root, '2026 Roster Sheets', '_targets.csv'), 'utf8');
    const keys = path.join(root, 'keys.txt');
    fs.writeFileSync(keys, 'D2 Gap||mens-soccer\n');
    attempt(root, { RB_KEYS: keys, RB_DIVISIONS: 'NCAA D2' });
    expect(fs.readFileSync(path.join(root, '2026 Roster Sheets', '_targets.csv'), 'utf8')).toBe(before);
  });

  it('writes no state for an excluded target', () => {
    // Exclusion is silence. A target left out must not be recorded as skipped,
    // or the next run would read it as attempted.
    const root = rootWith();
    const keys = path.join(root, 'keys.txt');
    fs.writeFileSync(keys, 'D2 Gap||mens-soccer\n');
    attempt(root, { RB_KEYS: keys });
    const stateDir = path.join(root, '2026 Roster Sheets', '_state');
    const files = fs.existsSync(stateDir) ? fs.readdirSync(stateDir) : [];
    for (const f of files) {
      const st = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8'));
      expect(Object.keys(st)).not.toContain('D3 Gap||womens-soccer');
    }
  });

  it('keeps a previously failed target retryable when it is out of scope', () => {
    const root = rootWith();
    const stateDir = path.join(root, '2026 Roster Sheets', '_state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'state2026.json'),
      JSON.stringify({ 'D3 Other||mens-soccer': { status: 'failed', why: 'earlier run' } }));
    const keys = path.join(root, 'keys.txt');
    fs.writeFileSync(keys, 'D2 Gap||mens-soccer\n');
    const { universe } = attempt(root, { RB_KEYS: keys });
    expect(universe).toContain('D3 Other||mens-soccer');
    const st = JSON.parse(fs.readFileSync(path.join(stateDir, 'state2026.json'), 'utf8'));
    expect(st['D3 Other||mens-soccer'].status).toBe('failed');
  });

  it('isolates state entirely under RB_ROOT', () => {
    const root = rootWith();
    attempt(root);
    expect(fs.existsSync(path.join(root, '2026 Roster Sheets'))).toBe(true);
  });
});

/**
 * L6D — that the versioned pipeline can actually run from the repository.
 *
 * L6C copied 38 source files under version control and declared the repo the
 * code authority. It was not: `lib.py` loads `geo25.json` from its own
 * directory at import time, and L6C's blanket `*.json` ignore had left that
 * file behind in the external copy. Every module in the acquisition path
 * imports `lib`, so the whole pipeline raised FileNotFoundError on the first
 * command L6D ran. Nothing in the test suite noticed, because no test had ever
 * imported the acquisition modules — only the worklist generator.
 *
 * These do that. They are the cheapest possible statement of "the code in this
 * repository is the code that runs", and they need no network and no season.
 */
d('versioned pipeline is self-sufficient', () => {
  const STAGES = ['state', 'lib', 'run', 'variants', 'selector', 'browse',
    'verify_gate', 'write_out', 'plan', 'paths'];

  it('ships the geography table lib.py loads at import time', () => {
    const geo = path.join(HERE, 'geo25.json');
    expect(fs.existsSync(geo)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(geo, 'utf8'));
    // The two lookups `lib.geo()` indexes. This table is what turns a hometown
    // into a nationality, so an empty one would silently call everyone American.
    expect(Object.keys(parsed.exact).length).toBeGreaterThan(0);
    expect(Object.keys(parsed.tail).length).toBeGreaterThan(0);
  });

  it.each(STAGES)('imports %s with nothing but the repository present', (mod) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-import-'));
    // RB_ROOT at an empty directory: if a module reaches for the operator's
    // home for anything it needs at import time, this fails.
    execFileSync(python, ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(HERE)}); import ${mod}`],
      { env: { ...process.env, RB_ROOT: root, RB_SEASON: '2026', RB_REF: '2025', RB_CURRENT: '1' },
        stdio: 'pipe' });
  });
});

/**
 * L7B — a generated candidate is a suggestion, and an observation outranks it.
 *
 * The worklist gained a second optional input: `_registry_candidates.csv`, a
 * first URL for a programme with no history, generated from an athletics host
 * the ledger has verified. The risk it introduces is not a bad URL — every gate
 * still runs on whatever answers — but a good URL in the wrong column, or a
 * generated guess quietly displacing a page we actually fetched last season.
 */
d('a generated candidate never outranks a known-good URL', () => {
  const REG = [
    { school: 'Has Roster', sport: 'womens-soccer', division: 'NCAA D3' },
    { school: 'Never Fetched', sport: 'womens-soccer', division: 'NCAA D3' },
  ];
  const CAND = [
    { school: 'Has Roster', sport: 'womens-soccer', host: 'wrong.test', candidate: 'https://wrong.test/sports/womens-soccer/roster/2026' },
    { school: 'Never Fetched', sport: 'womens-soccer', host: 'good.test', candidate: 'https://good.test/sports/womens-soccer/roster/2026' },
  ];
  const both = () => fixture({
    prior: [{ school: 'Has Roster', div: 'd3', gender: 'womens', url: 'https://known.test/sports/womens-soccer/roster/2025' }],
    registry: REG, candidates: CAND,
  });

  it('uses the prior season\'s URL where there is one', () => {
    const row = run(both()).find((r) => r.School === 'Has Roster');
    expect(row['Roster URL 2026 (candidate)']).toContain('known.test');
    expect(row['Roster URL 2026 (candidate)']).not.toContain('wrong.test');
  });

  it('uses the generated candidate only where there is no history', () => {
    const row = run(both()).find((r) => r.School === 'Never Fetched');
    expect(row['Roster URL 2026 (candidate)']).toBe('https://good.test/sports/womens-soccer/roster/2026');
    expect(row.Method).toBe('generated from a verified athletics host');
  });

  it('never records a generated candidate as a known-good URL', () => {
    // The known-good column is a record of a page that was actually fetched.
    // Writing a suggestion into it would make it indistinguishable later from
    // an observation, which is the provenance failure this guards.
    const row = run(both()).find((r) => r.School === 'Never Fetched');
    expect(row['Roster URL 2025 (known good)']).toBe('');
  });

  it('leaves a programme with no candidate exactly as it was', () => {
    const root = fixture({ registry: REG, candidates: [CAND[1]] });
    const row = run(root).find((r) => r.School === 'Has Roster');
    expect(row['Roster URL 2026 (candidate)']).toBe('');
    expect(row.Method).toBe('no later URL on record — discover from scratch');
  });

  it('behaves exactly as before when the candidates file is absent', () => {
    const withOut = run(fixture({ registry: REG }));
    const rows = withOut.filter((r) => REG.some((x) => x.school === r.School));
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r['Roster URL 2026 (candidate)']).toBe('');
  });

  it('hands the candidate to the normal flow rather than marking it resolved', () => {
    // A generated URL enters as a CANDIDATE. Status stays todo, so every stage
    // — direct, variants, selector, browse, the turnover gate — still runs.
    const row = run(both()).find((r) => r.School === 'Never Fetched');
    expect(row.Status).toBe('todo');
    expect(row['2025 Player Count']).toBe('0');
  });
});
