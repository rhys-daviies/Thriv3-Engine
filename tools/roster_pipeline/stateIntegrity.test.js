import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7J — that durable acquisition state tells the truth across repeated runs.
 *
 * Two defects, both measured on the real pipeline before anything was changed.
 *
 * DEFECT A. The runner's `absorb` merged a failure only when the key was
 * absent, so the FIRST failure a programme ever recorded won forever. All ten
 * remaining NCAA gaps still report L6D's `variants / no candidate` — and seven
 * of the ten are offered twenty-four generated candidates by today's planner,
 * so the recorded reason is not merely stale, it is false.
 *
 * DEFECT B. `build_targets.py` emitted `Status: todo, Notes: ''` for every row
 * it wrote. Run mid-season that is a reset wearing a regeneration's name: 1,933
 * `done` and 207 `failed` rows lost their status in one command.
 *
 * Every test here runs against a throwaway RB_ROOT and touches no network and
 * no real season.
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
const prow = (school, url) => `${school},CONF,A Player,Fr.,,,,,,,,${url},high,,2029,DEFENSE`;

function fixture(schools = ['Alpha', 'Beta', 'Gamma'], season = 2026) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l7j-'));
  fs.mkdirSync(path.join(root, `${season} Roster Sheets`), { recursive: true });
  const prev = path.join(root, `${season - 1} Roster Sheets`);
  fs.mkdirSync(prev, { recursive: true });
  fs.writeFileSync(path.join(prev, `ncaa_d2_mens_soccer_${season - 1}_rosters.csv`),
    [SHEET, ...schools.map((s) => prow(s, `https://${s.toLowerCase()}.test/sports/mens-soccer/roster/${season - 1}`))]
      .join('\n'));
  return root;
}

const env = (root) => ({
  ...process.env, RB_ROOT: root, RB_SEASON: '2026', RB_REF: '2025', PYTHONDONTWRITEBYTECODE: '1',
});

/** Run a snippet against `state.py` inside a fixture root. */
function py(root, code) {
  return execFileSync(python, ['-c', `import sys; sys.path.insert(0, '.')\nimport json, state\n${code}`],
    { cwd: HERE, env: env(root), encoding: 'utf8' });
}

const build = (root, args = []) => execFileSync(python, ['build_targets.py', '2026', ...args],
  { cwd: HERE, env: env(root), encoding: 'utf8' });

const targetsPath = (root) => path.join(root, '2026 Roster Sheets', '_targets.csv');

function readTargets(root) {
  const lines = fs.readFileSync(targetsPath(root), 'utf8').trim().split(/\r?\n/);
  const hdr = lines[0].split(',');
  return lines.slice(1).map((l) => {
    // fixture rows carry no quoted commas
    const cells = l.split(',');
    return Object.fromEntries(hdr.map((h, i) => [h, cells[i] ?? '']));
  });
}

function writeTargets(root, rows) {
  const hdr = Object.keys(rows[0]);
  fs.writeFileSync(targetsPath(root),
    [hdr.join(','), ...rows.map((r) => hdr.map((h) => r[h] ?? '').join(','))].join('\r\n') + '\r\n');
}

/* ========================================================================== */
/* Defect A — failure state                                                   */
/* ========================================================================== */

d('an attempt merged into durable state', () => {
  const K = 'Alpha||mens-soccer';
  /** Apply a sequence of attempts through `merge_attempt` and return the entry. */
  const sequence = (attempts) => {
    const root = fixture();
    const out = py(root, `
st = {}
for a in ${JSON.stringify(JSON.stringify(attempts))} and json.loads(${JSON.stringify(JSON.stringify(attempts))}):
    state.merge_attempt(st, ${JSON.stringify(K)}, a)
print(json.dumps(st.get(${JSON.stringify(K)}, {})))
`);
    fs.rmSync(root, { recursive: true, force: true });
    return JSON.parse(out.trim().split('\n').pop());
  };
  const fail = (stage, err) => ({ status: 'failed', stage, err });
  const ok = (stage, url) => ({ status: 'done', stage, url, n: 37, rows: [{ 'Player Name': 'A' }] });

  it('1. a newer failure replaces a stale diagnosis', () => {
    const e = sequence([fail('variants', 'no candidate'), fail('browser', 'page season is not 2026')]);
    expect(e.status).toBe('failed');
    expect(e.stage).toBe('browser');
    expect(e.err).toBe('page season is not 2026');
    expect(e.failure_class).toBe('SEASON_MISMATCH');
  });

  it('1b. and keeps the earlier attempt as history rather than losing it', () => {
    const e = sequence([fail('variants', 'no candidate'), fail('browser', 'page season is not 2026')]);
    expect(e.tried).toEqual(['variants: no candidate', 'browser: page season is not 2026']);
  });

  it('2. a success supersedes a prior failure', () => {
    const e = sequence([fail('variants', 'no candidate'), ok('browser', 'https://a.test/r')]);
    expect(e.status).toBe('done');
    expect(e.url).toBe('https://a.test/r');
  });

  it('3. a later failure does NOT demote a roster we already hold', () => {
    const e = sequence([ok('direct', 'https://a.test/r'), fail('variants', 'fetch 503')]);
    expect(e.status).toBe('done');
    expect(e.url).toBe('https://a.test/r');
    // still recorded, so the attempt is not invisible
    expect(e.tried).toEqual(['variants: fetch 503']);
  });

  it('4. a deliberate refresh success replaces the older success', () => {
    const e = sequence([ok('direct', 'https://old.test/r'), ok('browser', 'https://new.test/r')]);
    expect(e.status).toBe('done');
    expect(e.url).toBe('https://new.test/r');
  });

  it('5. a failed candidate followed by a later candidate success resolves', () => {
    const e = sequence([
      fail('direct', 'https://a.test/x -> fetch 404'),
      fail('variants', 'https://a.test/y -> fetch 404'),
      ok('browser', 'https://a.test/z'),
    ]);
    expect(e.status).toBe('done');
    expect(e.url).toBe('https://a.test/z');
  });

  it('6. merging one key leaves every other key untouched', () => {
    const root = fixture();
    const out = py(root, `
st = {'Other||mens-soccer': {'status': 'done', 'stage': 'direct', 'url': 'https://other.test/r'}}
before = json.dumps(st['Other||mens-soccer'], sort_keys=True)
state.merge_attempt(st, 'Alpha||mens-soccer', {'status': 'failed', 'stage': 'browser', 'err': 'fetch 404'})
print(before == json.dumps(st['Other||mens-soccer'], sort_keys=True))
print(sorted(st))
`);
    fs.rmSync(root, { recursive: true, force: true });
    expect(out).toContain('True');
    expect(out).toContain("'Alpha||mens-soccer', 'Other||mens-soccer'");
  });

  it('7. absorbing an empty stage file changes nothing', () => {
    // L7S made the run scope a required argument, so this passes one. The
    // scoping itself is covered in runScopedAbsorb.test.js; what this still
    // asserts is that an empty FILE is a no-op.
    const root = fixture();
    const f = path.join(root, 'empty.json');
    fs.writeFileSync(f, '{}');
    const out = py(root, `
state.save({'Alpha||mens-soccer': {'status': 'done', 'stage': 'direct', 'url': 'https://a.test/r'}})
before = json.dumps(state.load(), sort_keys=True)
c = state.absorb(${JSON.stringify(f)}, {'Alpha||mens-soccer'})
print(json.dumps(dict(c)))
print(before == json.dumps(state.load(), sort_keys=True))
`);
    fs.rmSync(root, { recursive: true, force: true });
    expect(out).toContain('{}');
    expect(out).toContain('True');
  });

  it('18. the same attempts in the same order produce the same state', () => {
    const seq = [fail('direct', 'fetch 404'), fail('variants', 'no candidate'), ok('browser', 'https://a.test/r')];
    expect(JSON.stringify(sequence(seq))).toBe(JSON.stringify(sequence(seq)));
  });

  it('bounds the attempt history rather than letting it accumulate', () => {
    const many = Array.from({ length: 30 }, (_, i) => fail('variants', `attempt ${i}`));
    const e = sequence(many);
    expect(e.tried).toHaveLength(12);
    expect(e.tried.at(-1)).toBe('variants: attempt 29');
    expect(e.tried[0]).toBe('variants: attempt 18');
  });

  it('classifies a failure without inventing the operator\'s vocabulary', () => {
    const root = fixture();
    const out = py(root, `
for e in ['no candidate', 'https://a.test/x -> fetch 404', 'page season is not 2026 (title="2027 ...")',
          'roster repeats 100% of the 2025 squad (gate 85%)', 'too few players parsed (0)',
          'roster renders client-side; extractor reaches 2 of ~30 rows', 'something new']:
    print(state.classify_failure(e))
`);
    fs.rmSync(root, { recursive: true, force: true });
    expect(out.trim().split('\n')).toEqual([
      'NO_CANDIDATE', 'ROUTE_FAILURE', 'SEASON_MISMATCH', 'TURNOVER_REFUSED',
      'PARSER_FLOOR', 'CONTENT_UNREADABLE', 'UNCLASSIFIED',
    ]);
  });
});

/* ========================================================================== */
/* Defect B — target regeneration                                             */
/* ========================================================================== */

d('regenerating the worklist', () => {
  /** A fixture whose worklist already carries a season's operational state. */
  function seeded() {
    const root = fixture();
    build(root);
    const rows = readTargets(root);
    const by = Object.fromEntries(rows.map((r) => [r.School, r]));
    by.Alpha.Status = 'done';
    by.Alpha.Notes = 'High via direct; 27 players; parser=sidearm-html';
    by.Beta.Status = 'failed';
    by.Beta.Notes = 'unresolved. tried: browser: page season is not 2026';
    by.Gamma.Status = 'failed';
    by.Gamma.Notes = 'unresolved. tried: direct: fetch 404';
    by.Gamma.Method = 'manual repair — operator';
    by.Gamma['Roster URL 2026 (candidate)'] = 'https://gamma.test/sports/msoc/2026-27/roster';
    writeTargets(root, rows);
    return root;
  }

  it('8. preserves a done status', () => {
    const root = seeded(); build(root);
    expect(readTargets(root).find((r) => r.School === 'Alpha').Status).toBe('done');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('9. preserves a failed status', () => {
    const root = seeded(); build(root);
    const rows = readTargets(root);
    expect(rows.find((r) => r.School === 'Beta').Status).toBe('failed');
    expect(rows.find((r) => r.School === 'Gamma').Status).toBe('failed');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('10. preserves the Notes cell', () => {
    const root = seeded(); build(root);
    const rows = readTargets(root);
    expect(rows.find((r) => r.School === 'Alpha').Notes).toContain('27 players');
    expect(rows.find((r) => r.School === 'Beta').Notes).toContain('page season is not 2026');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('11. preserves the known-good URL from the reference season', () => {
    const root = seeded(); build(root);
    expect(readTargets(root).find((r) => r.School === 'Alpha')['Roster URL 2025 (known good)'])
      .toBe('https://alpha.test/sports/mens-soccer/roster/2025');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('12. preserves a manual repair — L7C\'s lesson, still green', () => {
    const root = seeded(); build(root);
    const g = readTargets(root).find((r) => r.School === 'Gamma');
    expect(g.Method).toBe('manual repair — operator');
    expect(g['Roster URL 2026 (candidate)']).toBe('https://gamma.test/sports/msoc/2026-27/roster');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('13. leaves a generated candidate generated, and regenerates it', () => {
    const root = seeded(); build(root);
    const a = readTargets(root).find((r) => r.School === 'Alpha');
    expect(a.Method).toBe('year-swap (direct)');
    expect(a['Roster URL 2026 (candidate)']).toBe('https://alpha.test/sports/mens-soccer/roster/2026');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('14. initialises a target it has never seen', () => {
    const root = seeded();
    const prev = path.join(root, '2025 Roster Sheets', 'ncaa_d2_mens_soccer_2025_rosters.csv');
    fs.appendFileSync(prev, '\n' + prow('Delta', 'https://delta.test/sports/mens-soccer/roster/2025'));
    build(root);
    const delta = readTargets(root).find((r) => r.School === 'Delta');
    expect(delta.Status).toBe('todo');
    expect(delta.Notes).toBe('');
    expect(readTargets(root).find((r) => r.School === 'Alpha').Status).toBe('done');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('15. drops a target that left the universe, and says its state is untouched', () => {
    const root = seeded();
    const prev = path.join(root, '2025 Roster Sheets', 'ncaa_d2_mens_soccer_2025_rosters.csv');
    fs.writeFileSync(prev, fs.readFileSync(prev, 'utf8').split('\n').filter((l) => !l.startsWith('Beta,')).join('\n'));
    const out = build(root);
    expect(readTargets(root).map((r) => r.School)).not.toContain('Beta');
    expect(out).toMatch(/left the registry universe/);
    expect(out).toMatch(/Beta\|\|mens-soccer/);
    expect(out).toMatch(/durable state in _state\/ is untouched/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('16. --reset-state clears exactly Status and Notes, and says so', () => {
    const root = seeded();
    const out = build(root, ['--reset-state']);
    const rows = readTargets(root);
    expect(rows.every((r) => r.Status === 'todo')).toBe(true);
    expect(rows.every((r) => r.Notes === '')).toBe(true);
    expect(out).toMatch(/every Status set to todo and every Notes cleared/);
    expect(out).toMatch(/3 rows held operational state/);
    // A reset is of OPERATIONAL state. An operator's repair is not that.
    const g = rows.find((r) => r.School === 'Gamma');
    expect(g.Method).toBe('manual repair — operator');
    expect(g['Roster URL 2026 (candidate)']).toBe('https://gamma.test/sports/msoc/2026-27/roster');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('17. a normal regeneration never resets implicitly', () => {
    const root = seeded();
    const out = build(root);
    expect(out).not.toMatch(/reset/i);
    expect(out).toMatch(/operational state carried forward: 3 Status, 3 Notes/);
    expect(readTargets(root).some((r) => r.Status === 'todo')).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('16b. --reset-state does not touch durable acquisition state', () => {
    const root = seeded();
    const before = py(root, `
state.save({'Alpha||mens-soccer': {'status': 'done', 'stage': 'direct', 'url': 'https://a.test/r'}})
print(json.dumps(state.load(), sort_keys=True))`).trim();
    build(root, ['--reset-state']);
    const after = py(root, 'print(json.dumps(state.load(), sort_keys=True))').trim();
    expect(after).toBe(before);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('19. regeneration cannot move state between programmes', () => {
    const root = seeded(); build(root);
    const rows = readTargets(root);
    expect(rows.find((r) => r.School === 'Alpha').Notes).toContain('27 players');
    expect(rows.find((r) => r.School === 'Beta').Notes).not.toContain('27 players');
    expect(rows.find((r) => r.School === 'Gamma').Notes).not.toContain('27 players');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

/* ========================================================================== */
/* Scope — L7D and L7G invariants                                             */
/* ========================================================================== */

d('a scoped run', () => {
  it('20a. attempts only the keys in RB_KEYS', () => {
    const root = fixture();
    build(root);
    const keys = path.join(root, 'keys.txt');
    fs.writeFileSync(keys, 'Alpha||mens-soccer\n');
    const out = execFileSync(python, ['-c',
      "import sys; sys.path.insert(0,'.')\nimport state\nprint([state.key(r) for r in state.attempt_targets()])"],
    { cwd: HERE, env: { ...env(root), RB_KEYS: keys }, encoding: 'utf8' });
    expect(out.trim()).toBe("['Alpha||mens-soccer']");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('20b. an empty key file is an empty scope, not the whole universe', () => {
    const root = fixture();
    build(root);
    const keys = path.join(root, 'empty.txt');
    fs.writeFileSync(keys, '');
    const out = execFileSync(python, ['-c',
      "import sys; sys.path.insert(0,'.')\nimport state\nprint(len(state.attempt_targets()), len(state.targets()))"],
    { cwd: HERE, env: { ...env(root), RB_KEYS: keys }, encoding: 'utf8' });
    // L7D's fix, and the assertion is the whole point of it: an empty key file
    // is an EMPTY scope, not an absent one. It read as "no restriction" once,
    // and a six-programme run whose shards were half empty walked the entire
    // universe. Only an unset RB_KEYS means the whole worklist.
    expect(out.trim()).toBe('0 3');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('20c. an unmatched scope attempts nothing at all', () => {
    const root = fixture();
    build(root);
    const keys = path.join(root, 'none.txt');
    fs.writeFileSync(keys, 'Nobody||mens-soccer\n');
    const out = execFileSync(python, ['-c',
      "import sys; sys.path.insert(0,'.')\nimport state\nprint(len(state.attempt_targets()))"],
    { cwd: HERE, env: { ...env(root), RB_KEYS: keys }, encoding: 'utf8' });
    expect(out.trim()).toBe('0');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
