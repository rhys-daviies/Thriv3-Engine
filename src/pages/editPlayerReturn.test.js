// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import EditPlayer from './EditPlayer';

/**
 * THE CONTRIBUTION BLOCKER'S WAY BACK — A9.4 §H, §M.
 *
 * A9.3 routed a 409 to Edit Profile and stopped there: saving landed the
 * operator on the Profile tab, several clicks from the screen they were sent
 * from and from the button that would actually produce a ranking.
 *
 * The two properties that matter are opposites, and both are asserted:
 * the save RETURNS to Matchmaking, and the save does NOT rank.
 */

let container;
let root;
let requests;

const json = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

/**
 * A COMPLETE athlete, because the form refuses to submit an incomplete one.
 * `preferred_divisions` in particular is part of `step1Valid`, and without it
 * `handleSubmit` returns to step 0 and never calls `onSubmit` — a test that
 * would have "passed" by asserting no navigation happened.
 */
const PLAYER = {
  id: 'p1',
  full_name: 'Test Athlete',
  sport: 'mens-soccer',
  position: 'Midfielder',
  preferred_divisions: ['NCAA D1'],
  football_ability: 6,
  recruiting_class_year: 2028,
  contribution_state: 'STATED',
  max_annual_contribution_usd: 25000,
};

function Here() {
  const loc = useLocation();
  return createElement('output', { 'data-testid': 'here' }, loc.pathname + loc.search);
}

async function mountAt(entry) {
  await act(async () => {
    root.render(createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id/edit', element: createElement(EditPlayer) }),
        createElement(Route, { path: '/player/:id', element: createElement(Here) }),
        createElement(Route, { path: '/player/:id/matching', element: createElement(Here) })),
    ));
  });
}

const submit = async () => {
  const form = container.querySelector('form');
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  /**
   * The edit form mounts Radix selects, which observe their trigger. jsdom has
   * no ResizeObserver; the same stub campaignMessage.test.js uses.
   */
  class FakeResizeObserver {
    observe() {}

    unobserve() {}

    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (path, opts) => {
    requests.push({ path: String(path), method: opts?.method ?? 'GET' });
    if (String(path).includes('/api/entities/players/p1')) return json(PLAYER);
    if (String(path).includes('/colleges')) return json([]);
    return json({});
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const where = () => container.querySelector('[data-testid="here"]')?.textContent ?? null;

describe('A9.4 §H. editing an input returns where it was asked for', () => {
  it('H1. ?return=matching lands the save back on Matchmaking', async () => {
    await mountAt('/player/p1/edit?return=matching');
    await submit();
    expect(where()).toBe('/player/p1/matching');
  });

  it('H2. without the parameter, nothing about the old behaviour changes', async () => {
    await mountAt('/player/p1/edit');
    await submit();
    expect(where()).toBe('/player/p1');
  });

  it('H3. an unrecognised return target is NOT followed', async () => {
    /**
     * `?return=` arrives in a URL, and a URL is something anyone can hand an
     * operator. Resolving it into `navigate()` would be an open redirect in a
     * product that holds athlete records, so the allow-list has one entry and
     * everything else falls back to where this has always gone.
     */
    for (const bad of ['https://evil.test', '../../admin', 'campaign', '']) {
      /**
       * A FRESH ROOT PER CASE. `MemoryRouter` reads `initialEntries` once, so
       * re-rendering one into the same root keeps the FIRST entry and every
       * later case would silently re-test the first. The same trap caught
       * A9.3's rollback test.
       */
      act(() => root.unmount());
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);

      await mountAt(`/player/p1/edit?return=${encodeURIComponent(bad)}`);
      await submit();
      expect(where(), bad).toBe('/player/p1');
    }
  });

  it('H4. SAVING NEVER POSTS A MATCHMAKING RUN — §M', async () => {
    await mountAt('/player/p1/edit?return=matching');
    await submit();

    const matchmaking = requests.filter((r) => r.path.includes('/matchmaking'));
    expect(matchmaking).toEqual([]);
    /** The save itself happened, so this is not passing on a no-op. */
    expect(requests.some((r) => r.method === 'PUT' || r.method === 'PATCH' || r.method === 'POST')).toBe(true);
  });
});
