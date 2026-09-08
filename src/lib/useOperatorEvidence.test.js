// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useOperatorEvidence, operatorEvidenceForCollege } from './useOperatorEvidence';
import { FIXTURES } from './__fixtures__/operatorEvidence.js';

/**
 * The operator hook's request behaviour.
 *
 * Driven through a real React root rather than a testing library, which is not
 * a dependency here. `act` flushes the effect and its promise, which is all
 * these need — there is no interaction to simulate.
 *
 * What is being defended is mostly about what the hook must NOT do: call the
 * composer endpoint, fetch with nothing to fetch for, or leave a caller with
 * an empty object it could read as "no programme has anything to say".
 */

let container;
let root;
const calls = [];

/** Renders the hook and exposes its latest return value. */
function useProbe({ playerId, names }) {
  const state = useOperatorEvidence(playerId, names);
  probe.latest = state;
  return null;
}
const probe = { latest: null };

async function mount(playerId, names) {
  await act(async () => {
    root.render(createElement(useProbe, { playerId, names }));
  });
  return probe.latest;
}

beforeEach(() => {
  calls.length = 0;
  probe.latest = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  global.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

/** A fetch that records what it was asked for and answers with fixtures. */
function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) });
    return handler(path, options);
  }));
}

const ok = (payload) => ({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => payload,
});

describe('it asks the operator endpoint, and only that one', () => {
  it('posts to /operator-evidence with the athlete in the path', async () => {
    stubFetch(() => ok({ Jacksonville: FIXTURES.Jacksonville }));
    await mount('athlete-1', ['Jacksonville']);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/players/athlete-1/operator-evidence');
    expect(calls[0].body).toEqual({ collegeNames: ['Jacksonville'] });
  });

  it('sends the programme names in the body, as the composer hook does', async () => {
    stubFetch(() => ok({}));
    await mount('athlete-1', ['Jacksonville', 'Hamilton']);
    expect(calls[0].body.collegeNames).toEqual(['Jacksonville', 'Hamilton']);
  });

  it('never falls back to the composer endpoint on failure', async () => {
    stubFetch(() => { throw new Error('boom'); });
    await mount('athlete-1', ['Jacksonville']);

    // Quietly serving the other endpoint's payload would mean the decision
    // screen was reading the email's evidence and could not say which.
    expect(calls.every((c) => c.path.endsWith('/operator-evidence'))).toBe(true);
    expect(calls.some((c) => c.path.endsWith('/evidence'))).toBe(false);
  });
});

describe('it does not fetch without something to fetch for', () => {
  it('makes no request with no athlete', async () => {
    stubFetch(() => ok({}));
    const state = await mount(null, ['Jacksonville']);
    expect(calls).toHaveLength(0);
    expect(state.loading).toBe(false);
    expect(state.data).toBeNull();
  });

  it('makes no request with no programmes', async () => {
    stubFetch(() => ok({}));
    const state = await mount('athlete-1', []);
    // An empty list is a 400 from the server, and would show as a failure
    // rather than as "nothing was asked for".
    expect(calls).toHaveLength(0);
    expect(state.failed).toBe(false);
  });
});

describe('loading, success and failure are three different states', () => {
  it('reports loading before the response arrives', async () => {
    let release;
    stubFetch(() => new Promise((resolve) => { release = () => resolve(ok({})); }));
    await act(async () => {
      root.render(createElement(useProbe, { playerId: 'a', names: ['Jacksonville'] }));
    });
    expect(probe.latest.loading).toBe(true);
    expect(probe.latest.data).toBeNull();
    await act(async () => { release(); });
    expect(probe.latest.loading).toBe(false);
  });

  it('hands back the structured payload untouched', async () => {
    stubFetch(() => ok({ Jacksonville: FIXTURES.Jacksonville }));
    const state = await mount('a', ['Jacksonville']);
    // No interpretation, no reshaping — the read model as the server built it.
    expect(state.data.Jacksonville).toEqual(FIXTURES.Jacksonville);
    expect(state.failed).toBe(false);
  });

  it('leaves data null on a server error rather than empty', async () => {
    stubFetch(() => ({ ok: false, status: 500, text: async () => 'boom' }));
    const state = await mount('a', ['Jacksonville']);
    expect(state.failed).toBe(true);
    // Null, not {}. An empty object would read as "no programme has anything
    // to say" and would render as a finding.
    expect(state.data).toBeNull();
  });

  it('ignores a response that arrives after the inputs changed', async () => {
    const resolvers = [];
    stubFetch(() => new Promise((resolve) => resolvers.push(resolve)));

    await act(async () => {
      root.render(createElement(useProbe, { playerId: 'a', names: ['Jacksonville'] }));
    });
    await act(async () => {
      root.render(createElement(useProbe, { playerId: 'a', names: ['Hamilton'] }));
    });
    // The first request lands last. Its result belongs to a question nobody
    // is asking any more.
    await act(async () => {
      resolvers[1](ok({ Hamilton: FIXTURES['Hamilton (Ryan)'] }));
      resolvers[0](ok({ Jacksonville: FIXTURES.Jacksonville }));
    });
    expect(Object.keys(probe.latest.data)).toEqual(['Hamilton']);
  });
});

describe('reading one programme out of a batch', () => {
  it('returns the model for a programme that answered', () => {
    const data = { Jacksonville: FIXTURES.Jacksonville };
    expect(operatorEvidenceForCollege(data, 'Jacksonville')).toBe(FIXTURES.Jacksonville);
  });

  it('returns null for a programme the server could not read', () => {
    // `unavailable` is a failure, not an answer, and must not reach the zero
    // state — which is a statement about what we found.
    expect(operatorEvidenceForCollege({ X: { unavailable: 'boom' } }, 'X')).toBeNull();
  });

  it('returns null for a programme not in the batch', () => {
    expect(operatorEvidenceForCollege({}, 'X')).toBeNull();
    expect(operatorEvidenceForCollege(null, 'X')).toBeNull();
  });
});
