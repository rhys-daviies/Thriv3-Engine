// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useMatchingSummary, matchingSummaryForCollege } from './useMatchingSummary';
import { PROGRAMME_NAMES } from './__fixtures__/programmeNames.js';

/**
 * The recruiting-signal hook.
 *
 * Two properties carry this suite. Programme names must reach the server
 * exactly as written — the composer hook once keyed on a joined string whose
 * separator was an invisible NUL, and 1,698 of the 2,401 active programmes
 * contain a space, so this is the failure with the widest blast radius in the
 * codebase. And a resolved programme with no signals must arrive as a
 * SUCCESSFUL answer: it is 79% of real pairs, the card omits the panel for it,
 * and confusing it with a failure would omit the panel for the wrong reason.
 */

let container;
let root;
let bodies;

const probe = { latest: null };
const Probe = ({ playerId, names }) => {
  probe.latest = useMatchingSummary(playerId, names);
  return null;
};

async function mount(playerId, names) {
  await act(async () => { root.render(createElement(Probe, { playerId, names })); });
  return probe.latest;
}

/** A fetch that records the request and answers with a signal-free payload. */
function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push({ path, ...body });
    return handler ? handler(path, body) : ok(Object.fromEntries(
      (body.collegeNames ?? []).map((n) => [n, { programme: { resolved: true }, facts: [], hasEvidence: false }]),
    ));
  }));
}

const ok = (payload) => ({
  ok: true, headers: { get: () => 'application/json' }, json: async () => payload,
});

const asked = () => bodies.flatMap((b) => b.collegeNames);

beforeEach(() => {
  bodies = [];
  probe.latest = null;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe('it asks the matching-summary endpoint, and only that one', () => {
  it('posts to the right path with the athlete in it', async () => {
    stubFetch();
    await mount('athlete-1', ['Jacksonville']);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].path).toBe('/api/players/athlete-1/matching-summary');
    expect(bodies[0].collegeNames).toEqual(['Jacksonville']);
  });

  it('never falls back to another evidence endpoint', async () => {
    stubFetch(() => { throw new Error('boom'); });
    await mount('athlete-1', ['Jacksonville']);
    // Serving the operator or composer payload here would put unlicensed
    // evidence on a match card with nothing to say it had happened.
    expect(bodies.every((b) => b.path.endsWith('/matching-summary'))).toBe(true);
  });

  it('sends no score, weight or criterion', async () => {
    stubFetch();
    await mount('athlete-1', ['Jacksonville']);
    expect(Object.keys(bodies[0]).sort()).toEqual(['collegeNames', 'path']);
  });

  it('takes only an athlete and a list of names', () => {
    // A score cannot be passed to a hook that has nowhere to put one.
    expect(useMatchingSummary).toHaveLength(2);
  });
});

describe('programme names reach the server exactly', () => {
  it('sends a multi-word name whole', async () => {
    stubFetch();
    await mount('a', ['Sacred Heart']);
    expect(asked()).toEqual(['Sacred Heart']);
    expect(asked()).not.toContain('Sacred');
  });

  it('preserves every punctuation class that really occurs', async () => {
    const real = ['St. Thomas', 'Ozarks (AR)', 'Davis & Elkins', "Mount St. Mary's",
      'Carson-Newman', 'Embry–Riddle Aeronautical', "King's (PA)", 'Jacksonville'];
    stubFetch();
    await mount('a', real);
    expect(asked()).toEqual(real);
  });

  it('sends all 2,401 real names, each exactly once and in order', async () => {
    stubFetch();
    await mount('a', PROGRAMME_NAMES);
    expect(asked()).toEqual(PROGRAMME_NAMES);
    expect(bodies).toHaveLength(Math.ceil(PROGRAMME_NAMES.length / 40));
    // No name split by any separator: every one arrives whole.
    const sent = new Set(asked());
    for (const name of PROGRAMME_NAMES) expect(sent.has(name)).toBe(true);
  });

  it('trims and normalises nothing', async () => {
    const odd = ['  Padded  Name  ', 'Tab\tSeparated'];
    stubFetch();
    await mount('a', odd);
    expect(asked()).toEqual(odd);
  });
});

describe('a programme with no signals is a successful answer', () => {
  it('returns the entry rather than dropping it', async () => {
    stubFetch();
    const state = await mount('a', ['Quiet College']);
    expect(state.failed).toBe(false);
    expect(state.loading).toBe(false);
    // The common case — 79% of real pairs — and the card omits its panel for
    // it. Treating it as missing would omit the panel for the wrong reason.
    expect(state.data['Quiet College'])
      .toEqual({ programme: { resolved: true }, facts: [], hasEvidence: false });
  });

  it('is not the same as an unresolved programme', async () => {
    stubFetch(() => ok({
      Quiet: { programme: { resolved: true }, facts: [], hasEvidence: false },
      Unknown: { programme: { resolved: false }, facts: [], hasEvidence: false },
    }));
    const state = await mount('a', ['Quiet', 'Unknown']);
    expect(state.data.Quiet.programme.resolved).toBe(true);
    expect(state.data.Unknown.programme.resolved).toBe(false);
  });

  it('is not the same as a failure', async () => {
    stubFetch(() => ({ ok: false, status: 500, text: async () => 'boom' }));
    const state = await mount('a', ['Quiet']);
    expect(state.failed).toBe(true);
    // Null, not an empty object: a caller must not read a failed request as
    // "no programme has a signal".
    expect(state.data).toBeNull();
  });
});

describe('loading, batching and staleness', () => {
  it('reports loading before the response arrives', async () => {
    let release;
    stubFetch(() => new Promise((r) => { release = () => r(ok({})); }));
    await act(async () => { root.render(createElement(Probe, { playerId: 'a', names: ['X'] })); });
    expect(probe.latest.loading).toBe(true);
    await act(async () => { release(); });
    expect(probe.latest.loading).toBe(false);
  });

  it('batches in forties', async () => {
    stubFetch();
    const many = Array.from({ length: 95 }, (_, i) => `Multi Word Programme ${i}`);
    await mount('a', many);
    expect(bodies.map((b) => b.collegeNames.length)).toEqual([40, 40, 15]);
    expect(asked()).toEqual(many);
  });

  it('makes no request without an athlete or without names', async () => {
    stubFetch();
    expect((await mount(null, ['X'])).data).toBeNull();
    expect((await mount('a', [])).failed).toBe(false);
    expect(bodies).toHaveLength(0);
  });

  it('does not refetch for an equal list in a new array', async () => {
    stubFetch();
    await mount('a', ['Sacred Heart', 'Duke']);
    await mount('a', ['Sacred Heart', 'Duke']);
    expect(bodies).toHaveLength(1);
  });

  it('ignores a response that lands after the programmes changed', async () => {
    const resolvers = [];
    stubFetch(() => new Promise((r) => resolvers.push(r)));
    await act(async () => { root.render(createElement(Probe, { playerId: 'a', names: ['First'] })); });
    await act(async () => { root.render(createElement(Probe, { playerId: 'a', names: ['Second'] })); });
    // The first request lands last; its answer belongs to a question nobody
    // is asking any more.
    await act(async () => {
      resolvers[1](ok({ Second: { programme: { resolved: true }, facts: [], hasEvidence: false } }));
      resolvers[0](ok({ First: { programme: { resolved: true }, facts: [], hasEvidence: false } }));
    });
    expect(Object.keys(probe.latest.data)).toEqual(['Second']);
  });

  it('ignores a response that lands after the athlete changed', async () => {
    const resolvers = [];
    stubFetch(() => new Promise((r) => resolvers.push(r)));
    await act(async () => { root.render(createElement(Probe, { playerId: 'one', names: ['X'] })); });
    await act(async () => { root.render(createElement(Probe, { playerId: 'two', names: ['X'] })); });
    await act(async () => {
      resolvers[1](ok({ X: { programme: { resolved: true }, facts: [{ kind: 'B' }], hasEvidence: true } }));
      resolvers[0](ok({ X: { programme: { resolved: true }, facts: [{ kind: 'A' }], hasEvidence: true } }));
    });
    expect(probe.latest.data.X.facts[0].kind).toBe('B');
  });
});

describe('reading one programme out of a batch', () => {
  it('returns the entry for a programme that answered', () => {
    const entry = { programme: { resolved: true }, facts: [], hasEvidence: false };
    expect(matchingSummaryForCollege({ Duke: entry }, 'Duke')).toBe(entry);
  });

  it('returns null for one the server could not read', () => {
    // `unavailable` is a failure, not an answer. Letting it through would show
    // an empty panel indistinguishable from a programme with no signals.
    expect(matchingSummaryForCollege({ X: { unavailable: 'boom' } }, 'X')).toBeNull();
  });

  it('returns null for a programme not in the batch', () => {
    expect(matchingSummaryForCollege({}, 'X')).toBeNull();
    expect(matchingSummaryForCollege(null, 'X')).toBeNull();
  });
});
