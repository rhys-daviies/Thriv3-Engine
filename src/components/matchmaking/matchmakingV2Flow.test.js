// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import MatchmakingV2Panel from './MatchmakingV2Panel';
import { persistedRun, PLAYER } from '@/lib/__fixtures__/matchmakingV2Run.js';

/**
 * THE PERSISTED-FIRST FLOW — §C, §E, §P.
 *
 * Every case here is a thing the screen must do differently from the others.
 * The one property that recurs and matters most: RESULTS ALREADY ON SCREEN
 * SURVIVE whatever happens next. A refresh that is slow, a refresh that fails,
 * a contribution that is unanswered — none of them may take away a run the
 * server still holds and the consultant may be mid-conversation about.
 */

let container;
let root;
let calls;

const json = (payload, { status = 200, ok = true } = {}) => ({
  ok,
  status,
  headers: { get: () => 'application/json' },
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

/** The server's refusal shape: `{ error, code }` with a real status. */
const refusal = (status, code, error = 'refused') => json({ error, code }, { status, ok: false });

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts) => {
    const method = opts?.method ?? 'GET';
    calls.push({ path, method });
    const res = await handler(path, method);
    if (res) return res;
    throw new Error(`unstubbed ${method} ${path}`);
  }));
}

function mount(ui) {
  act(() => { root.render(createElement(MemoryRouter, null, ui)); });
}

const panel = (player = PLAYER) => createElement(MatchmakingV2Panel, { player });

const text = () => container.textContent;
const find = (sel) => container.querySelector(sel);
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

beforeEach(() => {
  /** React's own flag for `act`; without it updates are not guaranteed to flush. */
  global.IS_REACT_ACT_ENVIRONMENT = true;
  calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Matchmaking V2 — persisted-first flow', () => {
  it('F1. no persisted run shows an intentional empty state, and never generates on its own', async () => {
    stubFetch(async (path) => (path.includes('/runs/current')
      ? refusal(404, 'RUN_NOT_FOUND', 'No matchmaking run has been persisted for this athlete.')
      : null));

    await act(async () => { mount(panel()); });

    expect(find('[data-testid="no-run"]')).toBeTruthy();
    expect(text()).toContain('No matches generated yet');
    /**
     * THE WHOLE PRODUCT DECISION IN ONE ASSERTION. Loading the tab reads, and
     * stops. A POST here would turn opening a page into a historical record.
     */
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('F2. Generate posts a new run and shows it', async () => {
    stubFetch(async (path, method) => {
      if (method === 'POST') return json({ runId: 'run-new', ...persistedRun({ runId: 'run-new' }) }, { status: 201 });
      return refusal(404, 'RUN_NOT_FOUND');
    });

    await act(async () => { mount(panel()); });
    await act(async () => { click(find('[data-testid="no-run"] button')); });

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(find('[data-testid="run-bar"]')).toBeTruthy();
    expect(text()).toContain('Lindenwood');
    /** A run just computed is current by construction — no second request. */
    expect(find('[data-testid="run-currency"]').textContent).toBe('Current');
  });

  it('F3. a current persisted run renders without any recomputation', async () => {
    stubFetch(async (path) => (path.includes('/runs/current') ? json(persistedRun()) : null));

    await act(async () => { mount(panel()); });

    expect(find('[data-testid="run-currency"]').textContent).toBe('Current');
    expect(find('[data-testid="stale-reasons"]')).toBeNull();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(text()).toContain('Lindenwood');
  });

  it('F4. a STALE run keeps the screen, and says in words what moved', async () => {
    stubFetch(async (path) => (path.includes('/runs/current')
      ? json(persistedRun({
        staleness: { current: false, reasons: ['PLAYER_INPUT_CHANGED', 'CORPUS_CHANGED'] },
      }))
      : null));

    await act(async () => { mount(panel()); });

    /** The results are STILL THERE. Stale is not hidden — §C. */
    expect(text()).toContain('Lindenwood');
    expect(find('[data-testid="run-currency"]').textContent).toBe('Outdated');

    const reasons = find('[data-testid="stale-reasons"]').textContent;
    expect(reasons).toContain('profile changed');
    expect(reasons).toContain('recruiting data has been updated');
    /** No hash, digest or SHA in the operator-facing sentence — §O. */
    expect(reasons).not.toMatch(/[0-9a-f]{16,}/);
  });

  it('F5. all three stale reasons can hold at once', async () => {
    stubFetch(async (path) => (path.includes('/runs/current')
      ? json(persistedRun({
        staleness: {
          current: false,
          reasons: ['PLAYER_INPUT_CHANGED', 'CORPUS_CHANGED', 'ENGINE_CHANGED'],
        },
      }))
      : null));

    await act(async () => { mount(panel()); });
    expect(find('[data-testid="stale-reasons"]').children).toHaveLength(3);
    expect(text()).toContain('matcher has been updated');
  });

  it('F6. Refresh creates a NEW run and switches to it; the old one is never mutated', async () => {
    stubFetch(async (path, method) => {
      if (method === 'POST') {
        return json({
          runId: 'run-0002',
          ...persistedRun({ runId: 'run-0002', computedAt: '2026-10-04T09:00:00.000Z' }),
        }, { status: 201 });
      }
      return json(persistedRun({ staleness: { current: false, reasons: ['CORPUS_CHANGED'] } }));
    });

    await act(async () => { mount(panel()); });
    expect(find('[data-testid="run-currency"]').textContent).toBe('Outdated');

    await act(async () => { click(find('[data-testid="run-bar"] button')); });

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(find('[data-testid="run-currency"]').textContent).toBe('Current');
    /** One POST, one GET. Nothing issued a PUT or a PATCH at any point. */
    expect(calls.every((c) => c.method === 'GET' || c.method === 'POST')).toBe(true);
  });

  it('F7. the previous results stay on screen WHILE a refresh computes', async () => {
    let releasePost;
    const pending = new Promise((resolve) => { releasePost = resolve; });

    stubFetch(async (path, method) => {
      if (method === 'POST') { await pending; return json({ runId: 'run-0002', ...persistedRun() }, { status: 201 }); }
      return json(persistedRun({ staleness: { current: false, reasons: ['CORPUS_CHANGED'] } }));
    });

    await act(async () => { mount(panel()); });
    await act(async () => { click(find('[data-testid="run-bar"] button')); });

    /**
     * MID-FLIGHT. This is the assertion §P exists for: a refresh must not
     * blank a ranked list for the seconds it takes to compute a new one.
     */
    expect(text()).toContain('Lindenwood');
    expect(text()).toContain('Refreshing matches');
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();

    await act(async () => { releasePost(); await pending; });
    expect(text()).toContain('Lindenwood');
  });

  /* ------------------------------------------------------------------ */
  /* Contribution — §E                                                  */
  /* ------------------------------------------------------------------ */

  it('F8. a 409 is a blocking state with a route out, not a server error', async () => {
    stubFetch(async (path, method) => {
      if (method === 'POST') {
        return refusal(409, 'CONTRIBUTION_UNRESOLVED',
          'Matchmaking needs a resolved family contribution before it can rank.');
      }
      return refusal(404, 'RUN_NOT_FOUND');
    });

    await act(async () => { mount(panel()); });
    await act(async () => { click(find('[data-testid="no-run"] button')); });

    const blocked = find('[data-testid="contribution-blocked"]');
    expect(blocked).toBeTruthy();
    expect(blocked.textContent).toContain('annual contribution');
    /** Not an error surface, and no ranking was invented in its place. */
    expect(find('[data-testid="failure-SERVER"]')).toBeNull();
    expect(text()).not.toContain('$0');
    expect(text()).not.toContain('Lindenwood');

    /** A route to where the question is actually answered. */
    const cta = blocked.querySelector('a');
    /** §H: and it carries the return, so the save comes back to this screen. */
    // Phase 5 (#12): and it opens the form on the contribution step, where the question is.
    expect(cta.getAttribute('href')).toBe('/player/player-1/edit?return=matching&step=contribution');
  });

  it('F9. a 409 on REFRESH does not destroy the run already on screen', async () => {
    stubFetch(async (path, method) => {
      if (method === 'POST') return refusal(409, 'CONTRIBUTION_UNRESOLVED');
      return json(persistedRun({ staleness: { current: false, reasons: ['PLAYER_INPUT_CHANGED'] } }));
    });

    await act(async () => { mount(panel()); });
    await act(async () => { click(find('[data-testid="run-bar"] button')); });

    expect(find('[data-testid="contribution-blocked"]')).toBeTruthy();
    /** And the historical run is still rendered beneath it. */
    expect(text()).toContain('Lindenwood');
    expect(find('[data-testid="run-bar"]')).toBeTruthy();
  });

  /* ------------------------------------------------------------------ */
  /* The other failures, told apart — §P                                */
  /* ------------------------------------------------------------------ */

  it('F10. a 422 says the profile is not ready and offers no pointless retry', async () => {
    stubFetch(async () => refusal(422, 'ATHLETE_PROFILE_INCOMPLETE', 'Missing: football_ability'));

    await act(async () => { mount(panel()); });

    const el = find('[data-testid="failure-PROFILE_INVALID"]');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Missing: football_ability');
    expect(el.querySelector('button')).toBeNull();
  });

  it('F11. a 500 is reported as ours, with a retry, and is not confused with a dropped connection', async () => {
    stubFetch(async () => json({ error: 'Unexpected error.' }, { status: 500, ok: false }));

    await act(async () => { mount(panel()); });

    expect(find('[data-testid="failure-SERVER"]')).toBeTruthy();
    expect(find('[data-testid="failure-NETWORK"]')).toBeNull();
    expect(find('[data-testid="failure-SERVER"] button')).toBeTruthy();
  });

  it('F12. a network failure is its own state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    await act(async () => { mount(panel()); });

    expect(find('[data-testid="failure-NETWORK"]')).toBeTruthy();
    expect(find('[data-testid="failure-SERVER"]')).toBeNull();
  });

  it('F13. a missing athlete is not read as "no matches yet"', async () => {
    /**
     * Both are 404s and they mean opposite things: one offers a Generate
     * button, the other must not. Branching on the status instead of the
     * server's `code` is how that goes wrong.
     */
    stubFetch(async () => refusal(404, 'PLAYER_NOT_FOUND', 'Unknown player: player-1'));

    await act(async () => { mount(panel()); });

    expect(find('[data-testid="failure-PLAYER_NOT_FOUND"]')).toBeTruthy();
    expect(find('[data-testid="no-run"]')).toBeNull();
  });

  it('F14. loading is announced, not a bare spinner', async () => {
    stubFetch(() => new Promise(() => {}));
    await act(async () => { mount(panel()); });

    const status = find('[role="status"]');
    expect(status).toBeTruthy();
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Loading');
  });
});
