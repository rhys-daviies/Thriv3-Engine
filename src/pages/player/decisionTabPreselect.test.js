// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import DecisionTab from './DecisionTab.jsx';
import { PAGE_FIXTURES } from '@/lib/__fixtures__/pageFixtures.js';

/**
 * Arriving at Decision Evidence from one card's "View full evidence".
 *
 * The card can only send a programme NAME, because a name is the only key the
 * whole evidence system is indexed by — the endpoints take names, the batches
 * come back keyed by name, and every lookup is an exact match. So the link
 * carries the name through the URL, and the risk is entirely in the round
 * trip: `Mount St. Mary's`, `Davis & Elkins` and `Ozarks (AR)` have to survive
 * encoding, the router, and a filter box, unchanged.
 *
 * PRESELECTION ONLY. The param seeds the filter this page already had rather
 * than becoming a second source of truth for it, so an unknown name is a
 * search that finds nothing — not a crash, and not a special error state
 * somebody has to maintain.
 */

const RECOMMENDATIONS = [
  { name: 'Penn State Harrisburg', division: 'NCAA D3', conference: 'CAC' },
  { name: "Mount St. Mary's", division: 'NCAA D1', conference: 'MAAC' },
  { name: 'Davis & Elkins', division: 'NCAA D2', conference: 'MEC' },
  { name: 'Ozarks (AR)', division: 'NCAA D3', conference: 'ASC' },
  { name: 'Sacred Heart', division: 'NCAA D1', conference: 'NEC' },
];

let container;
let root;
let setPlayerIdOutside;

/**
 * A real operator-evidence payload for a programme with nothing to say.
 *
 * The page's own semantics are defended by `decisionEvidencePage.test.js`;
 * this suite is about which programmes are on screen, so every one of them
 * renders the same quiet body — and a real one, because a hand-made shape
 * would only prove the page tolerates a shape nothing sends.
 */
const EMPTY = PAGE_FIXTURES.Bethesda;

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (path, opts) => {
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => Object.fromEntries((body.collegeNames ?? []).map((n) => [n, EMPTY])),
    };
  }));
}

function Shell() {
  const [playerId, setPlayerId] = useState('athlete-1');
  setPlayerIdOutside = setPlayerId;
  return createElement(Outlet, {
    context: { player: { id: playerId, sport: 'mens-soccer' }, recommendations: RECOMMENDATIONS },
  });
}

async function visit(search = '') {
  // Unmount first. `MemoryRouter` reads `initialEntries` on mount only, so
  // re-rendering into a live root would keep the previous URL and every
  // assertion below would be made against the wrong one.
  await act(async () => { root.render(null); });
  await act(async () => {
    root.render(createElement(
      MemoryRouter,
      { initialEntries: [`/player/athlete-1/decision${search}`] },
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { path: '/player/:id', element: createElement(Shell) },
          createElement(Route, { path: 'decision', element: createElement(DecisionTab) }),
        ),
      ),
    ));
  });
}

const filter = () => container.querySelector('input');
const headings = () => [...container.querySelectorAll('h3')].map((h) => h.textContent);
const flat = () => container.textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  stubFetch();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('the link preselects one programme', () => {
  it('shows every programme when no college is named', async () => {
    await visit();
    expect(headings()).toEqual(RECOMMENDATIONS.map((r) => r.name));
    expect(filter().value).toBe('');
  });

  it('narrows to the named programme on direct navigation', async () => {
    await visit('?college=Penn%20State%20Harrisburg');
    expect(headings()).toEqual(['Penn State Harrisburg']);
  });

  it('puts the name in the filter box, so the operator can see and undo it', async () => {
    // A page that filtered invisibly would look like an analysis that had
    // matched one programme.
    await visit('?college=Penn%20State%20Harrisburg');
    expect(filter().value).toBe('Penn State Harrisburg');
  });

  it('round-trips every punctuation class that really occurs', async () => {
    for (const name of ["Mount St. Mary's", 'Davis & Elkins', 'Ozarks (AR)']) {
      await visit(`?college=${encodeURIComponent(name)}`);
      expect(filter().value).toBe(name);
      expect(headings()).toEqual([name]);
    }
  });

  it('behaves the same on a refresh as on a first arrival', async () => {
    // Nothing about the preselection lives in navigation state, so reloading
    // the URL reproduces it exactly.
    await visit('?college=Sacred%20Heart');
    const first = headings();
    await visit('?college=Sacred%20Heart');
    expect(headings()).toEqual(first);
  });
});

describe('it does not fight the filter it seeds', () => {
  it('lets the operator type over it', async () => {
    await visit('?college=Penn%20State%20Harrisburg');
    await act(async () => {
      const input = filter();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Sacred');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(headings()).toEqual(['Sacred Heart']);
  });

  it('lets the operator clear it back to the full list', async () => {
    await visit('?college=Penn%20State%20Harrisburg');
    await act(async () => {
      const input = filter();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(headings()).toEqual(RECOMMENDATIONS.map((r) => r.name));
  });

  it('does not rewrite the URL as the operator types', async () => {
    // Two-way synchronisation would push a history entry per keystroke, and
    // the back button would walk backwards through a search box.
    await visit('?college=Penn%20State%20Harrisburg');
    const before = window.location.search;
    await act(async () => {
      const input = filter();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Ozarks');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(window.location.search).toBe(before);
  });
});

describe('the cases that must not break the page', () => {
  it('says a name it does not hold matched nothing, and does not crash', async () => {
    await visit('?college=Not%20A%20Programme');
    expect(headings()).toEqual([]);
    expect(flat()).toContain('No programme in this analysis matches');
    // The page itself is still there.
    expect(flat()).toContain('Decision Evidence');
    expect(filter()).toBeTruthy();
  });

  it('survives an empty college param', async () => {
    await visit('?college=');
    expect(headings()).toEqual(RECOMMENDATIONS.map((r) => r.name));
  });

  it('drops a college that belonged to the previous athlete', async () => {
    // The URL still says `?college=Penn State Harrisburg`, but it says it
    // under `/player/athlete-1`. Once the loaded athlete is someone else that
    // param is the previous athlete's, and left in place it would filter the
    // new one's list down to a programme they were never matched against.
    await visit('?college=Penn%20State%20Harrisburg');
    expect(filter().value).toBe('Penn State Harrisburg');
    await act(async () => { setPlayerIdOutside('athlete-2'); });
    expect(filter().value).toBe('');
    expect(headings()).toEqual(RECOMMENDATIONS.map((r) => r.name));
  });
});
