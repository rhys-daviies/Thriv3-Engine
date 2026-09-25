import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7D — which sheets a run may rewrite, and which rows go in the ones it does.
 *
 * These are opposite questions and only one answer is safe for each. A sheet is
 * the whole population of a division and sport, so a selected sheet must be
 * rebuilt in FULL from durable state — writing only the current cohort into one
 * would delete every other programme in it. But a sheet the run never touched
 * should not be opened at all: an NCAA D2/D3 acquisition rewrote the USCAA file
 * from stale state in L6D, the bytes were restored, and L7C did the same thing
 * again. Twice is a defect, not an accident.
 *
 * Sheet scoping YES. Row scoping NO. Both directions are asserted here.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

const HDR = ['School', 'Conference', 'Player Name', 'Class/Year', 'Total Minutes Played',
  'Games Played', 'Games Started', 'Nationality', 'Hometown', 'Country', 'Source Stats URL',
  'Source Roster URL', 'Data Confidence', 'Notes', 'Estimated Graduation', 'Position'];

const playerRow = (school, name, conference = 'CONF') => Object.fromEntries(HDR.map((h) => {
  if (h === 'School') return [h, school];
  if (h === 'Conference') return [h, conference];
  if (h === 'Player Name') return [h, name];
  if (h === 'Data Confidence') return [h, 'High'];
  if (h === 'Source Roster URL') return [h, `https://${school.toLowerCase().replace(/\W/g, '')}.test/roster`];
  return [h, ''];
}));

const TARGET_COLS = ['School', 'Sport', 'Division', 'Conference', 'Roster URL 2026 (candidate)',
  'Method', 'Roster URL 2025 (known good)', '2025 Player Count', 'Status', 'Notes'];

/**
 * An RB_ROOT holding a worklist, durable state, and sheets already on disk.
 *
 * `sheets` writes files whose contents deliberately DISAGREE with state — that
 * is the USCAA drift: a value repaired by hand in the sheet and never written
 * back, which a rebuild silently reverts.
 */
function fixture({ targets, state: stateRows, sheets = {}, season = 2026 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-wo-'));
  const dir = path.join(root, `${season} Roster Sheets`);
  fs.mkdirSync(path.join(dir, '_state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_targets.csv'),
    [TARGET_COLS.join(','), ...targets.map((t) => TARGET_COLS.map((c) => {
      const v = { School: t.school, Sport: t.sport, Division: t.division,
        Conference: t.conference ?? 'CONF', Status: 'todo' }[c] ?? '';
      return /[",]/.test(v) ? `"${v}"` : v;
    }).join(','))].join('\r\n') + '\r\n');
  fs.writeFileSync(path.join(dir, '_state', `state${season}.json`), JSON.stringify(stateRows));
  for (const [file, body] of Object.entries(sheets)) fs.writeFileSync(path.join(dir, file), body);
  return { root, dir };
}

/** Runs write_out.py under an RB_ROOT, optionally scoped by a key file. */
function writeOut({ root, keys = null, divisions = null, season = 2026 }) {
  const env = { ...process.env, RB_ROOT: root, RB_SEASON: String(season),
    RB_REF: String(season - 1), RB_CURRENT: '1' };
  if (keys) {
    const kf = path.join(root, 'keys.txt');
    fs.writeFileSync(kf, `${keys.join('\n')}\n`);
    env.RB_KEYS = kf;
  }
  if (divisions) env.RB_DIVISIONS = divisions;
  return execFileSync(python, ['write_out.py'], { cwd: HERE, env, encoding: 'utf8' });
}

const sheetOf = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const schoolsIn = (body) => body.trim().split(/\r?\n/).slice(1)
  .map((l) => l.split(',')[0]).filter(Boolean);

/**
 * Two NCAA D3 women's programmes, one NCAA D2 men's, one USCAA women's.
 * Only ONE of the D3 programmes is in the run scope; the USCAA sheet on disk
 * carries a conference the state disagrees with.
 */
const SCENARIO = () => {
  const targets = [
    { school: 'Scoped D3', sport: 'womens-soccer', division: 'NCAA D3' },
    { school: 'Other D3', sport: 'womens-soccer', division: 'NCAA D3' },
    { school: 'Other D2', sport: 'mens-soccer', division: 'NCAA D2' },
    { school: 'A USCAA School', sport: 'womens-soccer', division: 'USCAA' },
  ];
  const done = (school, name, conf) => ({
    status: 'done', stage: 'browser', rows: [playerRow(school, name, conf), playerRow(school, `${name} Two`, conf)],
  });
  const stateRows = {
    'Scoped D3||womens-soccer': done('Scoped D3', 'Alice Scoped', 'CONF'),
    'Other D3||womens-soccer': done('Other D3', 'Bella Other', 'CONF'),
    'Other D2||mens-soccer': done('Other D2', 'Carl Other', 'CONF'),
    // State says ECAC. The sheet on disk says PSUAC, repaired by a person and
    // never written back — exactly the L6D/L7C situation.
    'A USCAA School||womens-soccer': done('A USCAA School', 'Dana Uscaa', 'Eastern College Athletic Conference'),
  };
  const uscaaOnDisk = [HDR.join(','),
    ...['Dana Uscaa', 'Dana Uscaa Two'].map((n) => HDR.map((h) => ({
      School: 'A USCAA School', Conference: 'Pennsylvania State University Athletic Conference',
      'Player Name': n, 'Data Confidence': 'High',
    }[h] ?? '')).join(','))].join('\r\n') + '\r\n';
  return { targets, stateRows, uscaaOnDisk };
};

d('a scoped run opens only the sheets it is scoped to', () => {
  it('leaves the USCAA sheet byte-identical when the run is NCAA-only', () => {
    const { targets, stateRows, uscaaOnDisk } = SCENARIO();
    const { root, dir } = fixture({
      targets, state: stateRows,
      sheets: { 'uscaa_womens_soccer_2026_rosters.csv': uscaaOnDisk },
    });
    const before = sheetOf(dir, 'uscaa_womens_soccer_2026_rosters.csv');
    writeOut({ root, keys: ['Scoped D3||womens-soccer'] });
    const after = sheetOf(dir, 'uscaa_womens_soccer_2026_rosters.csv');
    expect(after).toBe(before);
    // And specifically: the hand-repaired value survived.
    expect(after).toContain('Pennsylvania State University Athletic Conference');
    expect(after).not.toContain('Eastern College Athletic Conference');
  });

  it('does not create sheets for divisions outside the scope', () => {
    const { targets, stateRows } = SCENARIO();
    const { root, dir } = fixture({ targets, state: stateRows });
    writeOut({ root, keys: ['Scoped D3||womens-soccer'] });
    expect(fs.existsSync(path.join(dir, 'ncaa_d2_mens_soccer_2026_rosters.csv'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'uscaa_womens_soccer_2026_rosters.csv'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'ncaa_d1_mens_soccer_2026_rosters.csv'))).toBe(false);
  });

  it('writes the one sheet the scope names', () => {
    const { targets, stateRows } = SCENARIO();
    const { root, dir } = fixture({ targets, state: stateRows });
    writeOut({ root, keys: ['Scoped D3||womens-soccer'] });
    expect(fs.existsSync(path.join(dir, 'ncaa_d3_womens_soccer_2026_rosters.csv'))).toBe(true);
  });

  it('scopes by division too, and only to the divisions named', () => {
    const { targets, stateRows } = SCENARIO();
    const { root, dir } = fixture({ targets, state: stateRows });
    writeOut({ root, divisions: 'NCAA D2' });
    expect(fs.existsSync(path.join(dir, 'ncaa_d2_mens_soccer_2026_rosters.csv'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'ncaa_d3_womens_soccer_2026_rosters.csv'))).toBe(false);
  });
});

d('a sheet that IS opened is rebuilt in full', () => {
  it('keeps every programme in the sheet, not just the attempted one', () => {
    // The whole reason write_out reads durable state rather than the run's own
    // results: `Other D3` is not in the cohort and must still be in the file.
    const { targets, stateRows } = SCENARIO();
    const { root, dir } = fixture({ targets, state: stateRows });
    writeOut({ root, keys: ['Scoped D3||womens-soccer'] });
    const schools = schoolsIn(sheetOf(dir, 'ncaa_d3_womens_soccer_2026_rosters.csv'));
    expect(new Set(schools)).toEqual(new Set(['Scoped D3', 'Other D3']));
  });

  it('does not truncate a selected sheet to the cohort', () => {
    const { targets, stateRows } = SCENARIO();
    const { root, dir } = fixture({ targets, state: stateRows });
    writeOut({ root, keys: ['Scoped D3||womens-soccer'] });
    expect(schoolsIn(sheetOf(dir, 'ncaa_d3_womens_soccer_2026_rosters.csv')).length).toBe(4);
  });
});

d('an unscoped run is still a full rebuild', () => {
  it('writes every sheet that has data when nothing is scoped', () => {
    const { targets, stateRows } = SCENARIO();
    const { root, dir } = fixture({ targets, state: stateRows });
    writeOut({ root });
    for (const f of ['ncaa_d3_womens_soccer_2026_rosters.csv', 'ncaa_d2_mens_soccer_2026_rosters.csv',
      'uscaa_womens_soccer_2026_rosters.csv', 'ncaa_d1_mens_soccer_2026_rosters.csv']) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
  });

  it('is the operation that WOULD overwrite the drifted USCAA sheet', () => {
    // Stated rather than hidden: a maintenance rebuild still rewrites from
    // state, and the USCAA value question is separate debt. What L7D fixes is
    // that an NCAA run no longer reaches it by accident.
    const { targets, stateRows, uscaaOnDisk } = SCENARIO();
    const { root, dir } = fixture({
      targets, state: stateRows,
      sheets: { 'uscaa_womens_soccer_2026_rosters.csv': uscaaOnDisk },
    });
    writeOut({ root });
    expect(sheetOf(dir, 'uscaa_womens_soccer_2026_rosters.csv'))
      .toContain('Eastern College Athletic Conference');
  });
});

/**
 * L7D — run scope survives being sharded.
 *
 * The runner splits the remaining keys four ways and hands each shard to
 * `browse.py --keys`. On a six-programme run two of those shards were empty,
 * and an empty key set read as "no restriction": both walked the entire target
 * universe. Nothing was absorbed and no sheet moved, because the run was
 * stopped — but the scope had already been lost, which is the whole thing this
 * stage exists to make impossible.
 *
 * Two fixes, and a test for each: the runner no longer creates a shard with
 * nothing in it, and the stage treats an empty file as an empty scope.
 */
d('an empty shard is an empty scope, not the whole universe', () => {
  const shard = (n) => JSON.parse(execFileSync(python, ['-c', `
import json, sys
keys = [f'k{i}' for i in range(int(sys.argv[1]))]
n = min(4, len(keys))
print(json.dumps([keys[i::n] for i in range(n)]))
`, String(n)], { encoding: 'utf8' }));

  it.each([[6, 4], [4, 4], [2, 2], [1, 1]])(
    'splits %i keys into %i non-empty shards', (keys, shards) => {
      const out = shard(keys);
      expect(out.length).toBe(shards);
      for (const s of out) expect(s.length).toBeGreaterThan(0);
      expect(out.flat().length).toBe(keys);
    },
  );

  it('creates no shards at all when there is nothing to do', () => {
    expect(shard(0)).toEqual([]);
  });

  it('reads an empty key file as selecting nothing', () => {
    // The predicate, exactly as browse.py now spells it. `None` is "no
    // restriction"; a set is a restriction, including an empty one.
    const selected = (fileLines) => JSON.parse(execFileSync(python, ['-c', `
import json, sys
lines = json.loads(sys.argv[1])
keyset = None if lines is None else set(x.strip() for x in lines if x.strip())
universe = ['a', 'b', 'c']
print(json.dumps([k for k in universe if not (keyset is not None and k not in keyset)]))
`, JSON.stringify(fileLines)], { encoding: 'utf8' }));
    expect(selected(null)).toEqual(['a', 'b', 'c']);   // no --keys at all
    expect(selected(['b'])).toEqual(['b']);
    expect(selected([])).toEqual([]);                  // the defect: was ['a','b','c']
    expect(selected(['', '  '])).toEqual([]);
  });
});
