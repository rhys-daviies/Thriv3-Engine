import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7S — a run may only change the state of programmes it ran.
 *
 * ---------------------------------------------------------------------------
 * NO PROGRAMME OUTSIDE THE EXPLICIT RUN KEY SET MAY HAVE DURABLE ACQUISITION
 * STATE CHANGED BY THAT RUN'S STAGE ABSORPTION.
 * ---------------------------------------------------------------------------
 *
 * Stage files are resumable, so they accumulate across every run that has ever
 * written them. `absorb` used to take a glob and merge every key it found, and
 * twice that was caught: L7Q moved Southwest Minnesota State's history from
 * outside a twenty-programme pilot, and L7R moved Bentley's from outside a
 * seven-programme run. Bentley was `done` and the stale records were refusals,
 * so the only thing between that and a demoted roster was L7J's precedence.
 *
 * WHAT THESE TESTS ARE FOR. The reproductions come first, because a
 * containment fix that cannot demonstrate the leak it closes is a claim rather
 * than a fix. The same function proves both halves: given a scope that contains
 * the stale key it behaves exactly as the old code did, and given the run's real
 * scope it refuses. The difference is input selection and nothing else, which
 * is the whole thesis of the stage.
 *
 * Everything is network-free and runs against a temporary RB_ROOT. `state.py`
 * is imported directly; `build_targets.py` is invoked only as a subprocess with
 * an explicit fixture root, because importing it rewrites the worklist it is
 * pointed at — carried debt, and the reason nothing here imports it.
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

const TARGET_HDR = 'School,Sport,Division,Conference,Roster URL 2026 (candidate),'
  + 'Generated Candidates,Method,Roster URL 2025 (known good),2025 Player Count,Status,Notes';

/**
 * A fixture root holding a `_targets.csv` we control, so `attempt_targets()`
 * and therefore `run_scope()` answer from the fixture and never from the
 * working worklist.
 */
function fixture(programmes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l7s-'));
  const dir = path.join(root, '2026 Roster Sheets');
  fs.mkdirSync(path.join(dir, '_state'), { recursive: true });
  fs.mkdirSync(path.join(root, '2025 Roster Sheets'), { recursive: true });
  fs.writeFileSync(path.join(root, '2025 Roster Sheets', 'ncaa_d2_mens_soccer_2025_rosters.csv'), SHEET);
  const rows = programmes.map(([school, sport, division = 'NCAA D1']) =>
    `${school},${sport},${division},CONF,https://x.test/r/2026,,year-swap (direct),https://x.test/r/2025,20,todo,`);
  fs.writeFileSync(path.join(dir, '_targets.csv'), [TARGET_HDR, ...rows].join('\n'));
  return root;
}

const env = (root) => ({
  ...process.env, RB_ROOT: root, RB_SEASON: '2026', RB_REF: '2025', RB_CURRENT: '1',
  PYTHONDONTWRITEBYTECODE: '1', RB_KEYS: '', RB_DIVISIONS: '',
});

function py(root, code, extraEnv = {}) {
  return execFileSync(python, ['-c', `import sys; sys.path.insert(0, '.')\nimport json, state\n${code}`],
    { cwd: HERE, env: { ...env(root), ...extraEnv }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Absorb `stage` into `durable` under `scope`, and return the whole state
 * before and after plus what the merge counted.
 */
function absorb(root, { durable, stage, scope, pattern = 'stage.json' }) {
  const files = Array.isArray(stage) ? stage : [stage];
  const paths = files.map((obj, i) => {
    const p = path.join(root, files.length === 1 ? 'stage.json' : `stage_${i}.json`);
    fs.writeFileSync(p, JSON.stringify(obj));
    return p;
  });
  const glob = files.length === 1 ? paths[0] : path.join(root, 'stage_*.json');
  // The payloads go through json.loads rather than into the source: a JSON
  // `null` is not a Python literal, and injecting it produced a NameError that
  // looked like a state bug.
  const out = py(root, `
state.save(json.loads(${JSON.stringify(JSON.stringify(durable))}))
before = state.load()
c = state.absorb(${JSON.stringify(glob)}, ${scope === null ? 'None' : `json.loads(${JSON.stringify(JSON.stringify(scope))})`})
print(json.dumps({'counts': dict(c), 'before': before, 'after': state.load()}))
`);
  return JSON.parse(out.trim().split('\n').pop());
}

const failed = (stage, err, extra = {}) => ({ status: 'failed', stage, err, ...extra });
const done = (url, extra = {}) => ({ status: 'done', stage: 'direct', url, parser: 'sidearm-html', n: 20, rows: [], ...extra });

const ALPHA = 'Alpha||mens-soccer';
const OUTSIDE = 'Outside||womens-soccer';
const PROGS = [['Alpha', 'mens-soccer'], ['Outside', 'womens-soccer'],
  ['Beta', 'mens-soccer'], ['Beta', 'womens-soccer']];

/* -------------------------------------------------------------------------- */
/* The two leaks, reproduced and then blocked                                  */
/* -------------------------------------------------------------------------- */

d('the leaks that L7S closes', () => {
  /**
   * L7R. Bentley was `done` and outside the seven-programme run. Three stale
   * refusal records for it sat in the accumulated stage files, and absorb fed
   * every one of them to the merge.
   */
  const bentleyCase = (scope) => {
    const root = fixture([['Bentley', 'womens-soccer'], ['Iowa', 'womens-soccer']]);
    const r = absorb(root, {
      durable: {
        'Bentley||womens-soccer': done('https://bentleyfalcons.com/sports/womens-soccer/roster/2026',
          { tried: ['direct: a', 'variants: b', 'browser: c'] }),
        'Iowa||womens-soccer': failed('browser', 'too few players parsed (0)'),
      },
      stage: {
        'Bentley||womens-soccer': failed('variants', 'roster repeats 87% of the 2025 squad (gate 85%)'),
        'Iowa||womens-soccer': failed('variants', 'too few players parsed (0)'),
      },
      scope,
    });
    fs.rmSync(root, { recursive: true, force: true });
    return r;
  };

  it('21a. reproduces the L7R Bentley leak when the stale key is in scope', () => {
    // Exactly what the unscoped code did: every key in the file was in scope.
    const r = bentleyCase(['Bentley||womens-soccer', 'Iowa||womens-soccer']);
    const b = r.after['Bentley||womens-soccer'];
    expect(r.counts['kept-success']).toBe(1);
    expect(b.status).toBe('done');                  // L7J's precedence saved it
    expect(b.tried).toHaveLength(4);                // and the history still moved
    expect(b.tried.at(-1)).toMatch(/repeats 87%/);
    expect(b).not.toEqual(r.before['Bentley||womens-soccer']);
  });

  it('21b. and blocks it when the run scope is the run that actually ran', () => {
    const r = bentleyCase(['Iowa||womens-soccer']);
    expect(r.counts['out-of-scope']).toBe(1);
    expect(r.counts['kept-success']).toBeUndefined();
    expect(r.after['Bentley||womens-soccer']).toEqual(r.before['Bentley||womens-soccer']);
    expect(r.after['Bentley||womens-soccer'].tried).toHaveLength(3);
    // and the key that WAS in the run still moves
    expect(r.after['Iowa||womens-soccer']).not.toEqual(r.before['Iowa||womens-soccer']);
  });

  /**
   * L7Q. SMSU was already `failed`, so the leak was cosmetic: it was
   * rediagnosed with attempts it had already made, and its Notes column moved.
   * The fix has to stop this too — a metadata leak is still a run writing
   * outside itself.
   */
  const smsuCase = (scope) => {
    const root = fixture([['Southwest Minnesota State', 'mens-soccer'], ['Monroe (NY)', 'mens-soccer']]);
    const r = absorb(root, {
      durable: {
        'Southwest Minnesota State||mens-soccer': failed('browser', 'too few players parsed (0)',
          { failure_class: 'PARSER_FLOOR', tried: ['variants: none', 'browser: too few players parsed (0)'] }),
        'Monroe (NY)||mens-soccer': failed('direct', 'page season is not 2026'),
      },
      stage: {
        'Southwest Minnesota State||mens-soccer': failed('variants', 'too few players parsed (0)'),
        'Monroe (NY)||mens-soccer': done('https://monroeexpress.com/sports/mens-soccer/roster/2026'),
      },
      scope,
    });
    fs.rmSync(root, { recursive: true, force: true });
    return r;
  };

  it('22a. reproduces the L7Q SMSU metadata leak when the stale key is in scope', () => {
    const r = smsuCase(['Southwest Minnesota State||mens-soccer', 'Monroe (NY)||mens-soccer']);
    const s = r.after['Southwest Minnesota State||mens-soccer'];
    expect(r.counts.rediagnosed).toBe(1);
    expect(s.status).toBe('failed');                 // status did not move
    expect(s.stage).toBe('variants');                // but the record did
    expect(s.tried).toHaveLength(3);
    expect(s).not.toEqual(r.before['Southwest Minnesota State||mens-soccer']);
  });

  it('22b. and blocks it, because a cosmetic leak is still a leak', () => {
    const r = smsuCase(['Monroe (NY)||mens-soccer']);
    expect(r.counts['out-of-scope']).toBe(1);
    expect(r.counts.rediagnosed).toBeUndefined();
    expect(r.after['Southwest Minnesota State||mens-soccer'])
      .toEqual(r.before['Southwest Minnesota State||mens-soccer']);
    expect(r.after['Monroe (NY)||mens-soccer'].status).toBe('done');
  });
});

/* -------------------------------------------------------------------------- */
/* In scope: L7J's precedence, untouched                                       */
/* -------------------------------------------------------------------------- */

d('an in-scope key keeps exactly the semantics L7J gave it', () => {
  const one = (durable, stage, scope = [ALPHA]) => {
    const root = fixture(PROGS);
    const r = absorb(root, { durable, stage, scope });
    fs.rmSync(root, { recursive: true, force: true });
    return r;
  };

  it('1. failed -> failed rediagnoses, carrying the history forward', () => {
    // `_tried` appends the incoming attempt to whatever the previous record
    // held, so a previous record with no history yields exactly one line.
    const r = one({ [ALPHA]: failed('direct', 'old reason') }, { [ALPHA]: failed('variants', 'new reason') });
    expect(r.counts.rediagnosed).toBe(1);
    expect(r.after[ALPHA].err).toBe('new reason');
    expect(r.after[ALPHA].tried).toEqual(['variants: new reason']);

    const carried = one({ [ALPHA]: failed('direct', 'old reason', { tried: ['direct: old reason'] }) },
      { [ALPHA]: failed('variants', 'new reason') });
    expect(carried.after[ALPHA].tried).toEqual(['direct: old reason', 'variants: new reason']);
  });

  it('2. failed -> done resolves', () => {
    const r = one({ [ALPHA]: failed('direct', 'old reason') }, { [ALPHA]: done('https://a.test/r') });
    expect(r.counts.resolved).toBe(1);
    expect(r.after[ALPHA].status).toBe('done');
    expect(r.after[ALPHA].url).toBe('https://a.test/r');
  });

  it('3. done -> failed KEEPS the success and records the attempt', () => {
    const r = one({ [ALPHA]: done('https://a.test/r', { tried: ['direct: x'] }) },
      { [ALPHA]: failed('browser', 'fetch 404') });
    expect(r.counts['kept-success']).toBe(1);
    expect(r.after[ALPHA].status).toBe('done');
    expect(r.after[ALPHA].url).toBe('https://a.test/r');
    expect(r.after[ALPHA].tried).toHaveLength(2);
  });

  it('4. done -> done replaces with the newer read', () => {
    const r = one({ [ALPHA]: done('https://a.test/old') }, { [ALPHA]: done('https://a.test/new') });
    expect(r.counts.refreshed).toBe(1);
    expect(r.after[ALPHA].url).toBe('https://a.test/new');
  });

  it('15. an in-scope key absent from state is recorded', () => {
    const r = one({}, { [ALPHA]: failed('direct', 'fetch 404') });
    expect(r.counts.recorded).toBe(1);
    expect(r.after[ALPHA].failure_class).toBeTruthy();
  });

  it('16. the attempt history is still bounded at TRIED_MAX', () => {
    const root = fixture(PROGS);
    const out = py(root, `
state.save({'${ALPHA}': {'status': 'failed', 'stage': 'direct', 'err': 'first'}})
import os
for i in range(30):
    f = os.path.join(${JSON.stringify(root)}, 'st.json')
    json.dump({'${ALPHA}': {'status': 'failed', 'stage': 'variants', 'err': 'attempt %d' % i}},
              open(f, 'w'))
    state.absorb(f, {'${ALPHA}'})
e = state.load()['${ALPHA}']
print(json.dumps({'tried': len(e['tried']), 'max': state.TRIED_MAX, 'last': e['tried'][-1]}))
`);
    fs.rmSync(root, { recursive: true, force: true });
    const r = JSON.parse(out.trim().split('\n').pop());
    expect(r.tried).toBe(r.max);
    expect(r.tried).toBe(12);
    expect(r.last).toMatch(/attempt 29/);
  });

  it('20. two stage files with records for one in-scope key apply in file order', () => {
    const root = fixture(PROGS);
    const r = absorb(root, {
      durable: { [ALPHA]: failed('direct', 'old') },
      stage: [{ [ALPHA]: done('https://a.test/first') }, { [ALPHA]: failed('browser', 'later failure') }],
      scope: [ALPHA],
    });
    fs.rmSync(root, { recursive: true, force: true });
    // resolved by stage_0, then stage_1's failure is kept as history only
    expect(r.counts.resolved).toBe(1);
    expect(r.counts['kept-success']).toBe(1);
    expect(r.after[ALPHA].status).toBe('done');
    expect(r.after[ALPHA].url).toBe('https://a.test/first');
  });
});

/* -------------------------------------------------------------------------- */
/* Out of scope: nothing at all                                                */
/* -------------------------------------------------------------------------- */

d('an out-of-scope key is not touched, in any field', () => {
  const leak = (stale, scope = [ALPHA]) => {
    const root = fixture(PROGS);
    const r = absorb(root, {
      durable: { [ALPHA]: failed('direct', 'in scope'), [OUTSIDE]: stale.durable },
      stage: { [ALPHA]: failed('variants', 'in scope again'), [OUTSIDE]: stale.incoming },
      scope,
    });
    fs.rmSync(root, { recursive: true, force: true });
    return r;
  };

  it('5. an out-of-scope failed record is ignored', () => {
    const r = leak({ durable: failed('direct', 'original'), incoming: failed('browser', 'stale') });
    expect(r.counts['out-of-scope']).toBe(1);
    expect(r.after[OUTSIDE]).toEqual(r.before[OUTSIDE]);
  });

  it('6. an out-of-scope done record is ignored', () => {
    const r = leak({ durable: failed('direct', 'original'), incoming: done('https://stale.test/r') });
    expect(r.counts['out-of-scope']).toBe(1);
    expect(r.after[OUTSIDE].status).toBe('failed');
    expect(r.after[OUTSIDE]).toEqual(r.before[OUTSIDE]);
  });

  it('7/9/10. tried, failure_class, parser, url and n all stay put', () => {
    const r = leak({
      durable: done('https://real.test/r', { parser: 'sidearm-html', n: 27, tried: ['direct: x'], failure_class: null }),
      incoming: failed('browser', 'stale refusal', { parser: 'table', n: 3, tried: ['browser: stale'] }),
    });
    const a = r.after[OUTSIDE];
    expect(a).toEqual(r.before[OUTSIDE]);
    expect(a.tried).toEqual(['direct: x']);
    expect(a.parser).toBe('sidearm-html');
    expect(a.n).toBe(27);
    expect(a.url).toBe('https://real.test/r');
    expect(a.failure_class).toBe(null);
  });

  it('8. the fields the Notes column is written from do not move either', () => {
    // `Notes` lives in _targets.csv and write_out renders it from `err` and
    // `tried`. L7Q's leak was visible there and nowhere else, so those two
    // fields are the ones that have to hold.
    const r = leak({
      durable: failed('browser', 'original reason', { tried: ['variants: none'] }),
      incoming: failed('variants', 'a different reason', { tried: ['variants: something else'] }),
    });
    expect(r.after[OUTSIDE].err).toBe('original reason');
    expect(r.after[OUTSIDE].tried).toEqual(['variants: none']);
  });

  it('14. an out-of-scope key absent from state is not created', () => {
    const root = fixture(PROGS);
    const r = absorb(root, {
      durable: { [ALPHA]: failed('direct', 'in scope') },
      stage: { [ALPHA]: failed('variants', 'again'), [OUTSIDE]: done('https://new.test/r') },
      scope: [ALPHA],
    });
    fs.rmSync(root, { recursive: true, force: true });
    expect(Object.keys(r.after).sort()).toEqual([ALPHA]);
    expect(r.after[OUTSIDE]).toBeUndefined();
  });

  it('11. a stale file of 100 unrelated keys changes none of them', () => {
    const root = fixture(PROGS);
    const durable = { [ALPHA]: failed('direct', 'in scope') };
    const stage = { [ALPHA]: failed('variants', 'in scope again') };
    for (let i = 0; i < 100; i += 1) {
      const k = `Stale ${i}||${i % 2 ? 'mens-soccer' : 'womens-soccer'}`;
      durable[k] = i % 3 === 0 ? done(`https://s${i}.test/r`, { tried: [`direct: ${i}`] })
        : failed('browser', `reason ${i}`, { tried: [`browser: ${i}`] });
      stage[k] = i % 2 === 0 ? done(`https://stale${i}.test/r`) : failed('variants', `stale ${i}`);
    }
    const r = absorb(root, { durable, stage, scope: [ALPHA] });
    fs.rmSync(root, { recursive: true, force: true });
    expect(r.counts['out-of-scope']).toBe(100);
    const moved = Object.keys(r.before).filter((k) => JSON.stringify(r.before[k]) !== JSON.stringify(r.after[k]));
    expect(moved).toEqual([ALPHA]);
  });

  it('12. a file mixing current and stale records changes only the current ones', () => {
    const root = fixture([['A', 'mens-soccer'], ['B', 'mens-soccer'], ['C', 'mens-soccer'], ['D', 'mens-soccer']]);
    const r = absorb(root, {
      durable: {
        'A||mens-soccer': failed('direct', 'a'), 'B||mens-soccer': failed('direct', 'b'),
        'C||mens-soccer': failed('direct', 'c'), 'D||mens-soccer': done('https://d.test/r'),
      },
      stage: {
        'A||mens-soccer': done('https://a.test/r'), 'B||mens-soccer': failed('variants', 'b2'),
        'C||mens-soccer': done('https://c.test/r'), 'D||mens-soccer': failed('variants', 'd2'),
      },
      scope: ['A||mens-soccer', 'B||mens-soccer'],
    });
    fs.rmSync(root, { recursive: true, force: true });
    expect(r.counts['out-of-scope']).toBe(2);
    const moved = Object.keys(r.before).filter((k) => JSON.stringify(r.before[k]) !== JSON.stringify(r.after[k]));
    expect(moved.sort()).toEqual(['A||mens-soccer', 'B||mens-soccer']);
  });
});

/* -------------------------------------------------------------------------- */
/* Exact keys, and the two degenerate scopes                                   */
/* -------------------------------------------------------------------------- */

d('scope is matched on the exact key and nothing looser', () => {
  it('17/18/19. a school in scope for one sport is not in scope for the other', () => {
    const root = fixture(PROGS);
    const r = absorb(root, {
      durable: {
        'Beta||mens-soccer': failed('direct', 'm original'),
        'Beta||womens-soccer': failed('direct', 'w original'),
      },
      stage: {
        'Beta||mens-soccer': done('https://beta.test/m'),
        'Beta||womens-soccer': done('https://beta.test/w'),
      },
      scope: ['Beta||mens-soccer'],
    });
    fs.rmSync(root, { recursive: true, force: true });
    expect(r.counts['out-of-scope']).toBe(1);
    expect(r.after['Beta||mens-soccer'].status).toBe('done');
    expect(r.after['Beta||womens-soccer']).toEqual(r.before['Beta||womens-soccer']);
  });

  it('17b. a scope entry that is only a school name matches nothing', () => {
    const root = fixture(PROGS);
    const r = absorb(root, {
      durable: { [ALPHA]: failed('direct', 'original') },
      stage: { [ALPHA]: done('https://a.test/r') },
      scope: ['Alpha', 'mens-soccer', 'Alpha||', '||mens-soccer'],
    });
    fs.rmSync(root, { recursive: true, force: true });
    expect(r.counts['out-of-scope']).toBe(1);
    expect(r.after[ALPHA]).toEqual(r.before[ALPHA]);
  });

  it('13. an empty scope absorbs nothing and leaves the file untouched', () => {
    const root = fixture(PROGS);
    const stagePath = path.join(root, 'stage.json');
    fs.writeFileSync(stagePath, JSON.stringify({ [ALPHA]: done('https://a.test/r'), [OUTSIDE]: failed('b', 'x') }));
    const out = py(root, `
import os
state.save({'${ALPHA}': {'status': 'failed', 'stage': 'direct', 'err': 'original'}})
p = state.STATE
raw_before = open(p, encoding='utf-8').read()
mt_before = os.stat(p).st_mtime_ns
c = state.absorb(${JSON.stringify(stagePath)}, set())
print(json.dumps({'counts': dict(c), 'bytes_equal': raw_before == open(p, encoding='utf-8').read(),
                  'untouched': mt_before == os.stat(p).st_mtime_ns}))
`);
    fs.rmSync(root, { recursive: true, force: true });
    const r = JSON.parse(out.trim().split('\n').pop());
    expect(r.counts['out-of-scope']).toBe(2);
    expect(Object.keys(r.counts)).toEqual(['out-of-scope']);
    expect(r.bytes_equal).toBe(true);
    expect(r.untouched).toBe(true);
  });

  it('a missing scope fails closed rather than meaning "all of them"', () => {
    const root = fixture(PROGS);
    let threw = '';
    try {
      py(root, `
state.save({'${ALPHA}': {'status': 'failed', 'stage': 'direct', 'err': 'original'}})
state.absorb('nothing.json', None)
`);
    } catch (e) { threw = String(e.stderr ?? e.message); }
    fs.rmSync(root, { recursive: true, force: true });
    expect(threw).toMatch(/TypeError/);
    expect(threw).toMatch(/explicit run scope/);
  });
});

/* -------------------------------------------------------------------------- */
/* The invariant itself                                                        */
/* -------------------------------------------------------------------------- */

d('the central guarantee, over arbitrary inputs', () => {
  it('property: for every key not in scope, the durable record is deep-equal after', () => {
    const root = fixture(PROGS);
    const out = py(root, `
import json, random, os
random.seed(20260918)
STATUSES = ['done', 'failed']
def rec(i, st):
    if st == 'done':
        return {'status': 'done', 'stage': random.choice(['direct','variants','selector','browser']),
                'url': 'https://h%d.test/r' % i, 'parser': random.choice(['sidearm-html','table','nuxt-roster']),
                'n': random.randint(5, 40), 'rows': [], 'tried': ['direct: %d' % i]}
    return {'status': 'failed', 'stage': random.choice(['direct','variants','browser']),
            'err': 'reason %d' % i, 'failure_class': random.choice(['PARSER_FLOOR','TURNOVER_REFUSED', None]),
            'tried': ['variants: %d' % i, 'browser: %d' % i]}

violations = []
for trial in range(200):
    keys = ['P%d||%s' % (i, random.choice(['mens-soccer','womens-soccer'])) for i in range(random.randint(1, 40))]
    keys = list(dict.fromkeys(keys))
    durable = {k: rec(i, random.choice(STATUSES)) for i, k in enumerate(keys) if random.random() < 0.8}
    stage   = {k: rec(i + 1000, random.choice(STATUSES)) for i, k in enumerate(keys) if random.random() < 0.8}
    # a few stage keys that exist nowhere else
    for j in range(random.randint(0, 5)):
        stage['Ghost%d||mens-soccer' % j] = rec(9000 + j, random.choice(STATUSES))
    scope = {k for k in keys if random.random() < 0.5}

    state.save(durable)
    before = json.loads(json.dumps(state.load()))
    f = os.path.join(${JSON.stringify(root)}, 'prop.json')
    json.dump(stage, open(f, 'w'))
    state.absorb(f, scope)
    after = state.load()

    for k in set(before) | set(after):
        if k in scope: continue
        if before.get(k) != after.get(k):
            violations.append({'trial': trial, 'key': k})
print(json.dumps({'trials': 200, 'violations': violations[:10], 'count': len(violations)}))
`);
    fs.rmSync(root, { recursive: true, force: true });
    const r = JSON.parse(out.trim().split('\n').pop());
    expect(r.trials).toBe(200);
    expect(r.violations).toEqual([]);
    expect(r.count).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The scope the production runner actually supplies                           */
/* -------------------------------------------------------------------------- */

d('run_scope is the set the runner already proves as TO ATTEMPT', () => {
  it('equals attempt_targets, narrowed by RB_KEYS exactly as plan.py narrows it', () => {
    const root = fixture([['Alpha', 'mens-soccer'], ['Outside', 'womens-soccer'],
      ['Beta', 'mens-soccer', 'NCAA D3']]);
    const keysFile = path.join(root, 'keys.txt');
    fs.writeFileSync(keysFile, `${ALPHA}\nBeta||mens-soccer\n`);
    const out = py(root, `
scope = state.run_scope()
attempt = {state.key(r) for r in state.attempt_targets()}
print(json.dumps({'scope': sorted(scope), 'attempt': sorted(attempt), 'same': scope == attempt}))
`, { RB_KEYS: keysFile });
    fs.rmSync(root, { recursive: true, force: true });
    const r = JSON.parse(out.trim().split('\n').pop());
    expect(r.same).toBe(true);
    expect(r.scope).toEqual([ALPHA, 'Beta||mens-soccer']);
    expect(r.scope).not.toContain(OUTSIDE);
  });

  it('with no RB_KEYS it is the whole target universe, and still not the stage file', () => {
    const root = fixture(PROGS);
    const stagePath = path.join(root, 'stage.json');
    fs.writeFileSync(stagePath, JSON.stringify({
      [ALPHA]: done('https://a.test/r'),
      'Never A Target||mens-soccer': done('https://ghost.test/r'),
    }));
    const out = py(root, `
state.save({})
scope = state.run_scope()
c = state.absorb(${JSON.stringify(stagePath)}, scope)
print(json.dumps({'scope': len(scope), 'counts': dict(c), 'keys': sorted(state.load())}))
`);
    fs.rmSync(root, { recursive: true, force: true });
    const r = JSON.parse(out.trim().split('\n').pop());
    expect(r.scope).toBe(4);
    expect(r.counts['out-of-scope']).toBe(1);   // the key that is not a target
    expect(r.keys).toEqual([ALPHA]);
  });
});
