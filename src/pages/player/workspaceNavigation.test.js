// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import PlayerWorkspace, { MORE_VIEWS, PRIMARY_TABS } from './PlayerWorkspace.jsx';
import DecisionTab from './DecisionTab.jsx';
import MatchmakingResultCard, { decisionEvidenceHref } from '@/components/matchmaking/MatchmakingResultCard.jsx';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import { runView } from '@/lib/matchmakingV2View';
import { persistedRun } from '@/lib/__fixtures__/matchmakingV2Run.js';

/**
 * PLAYER NAVIGATION — Phase 3 (docs/IMMEDIATE_CHANGES_ROADMAP.md).
 *
 *   - The primary bar is exactly Profile, Analysis & Matching, Coach
 *     Engagement, Campaign, Reports.
 *   - Program Philosophy, Evidence and Decision Evidence are one click away
 *     under "More views", keep their routes, and keep every deep link.
 *   - A V2 match card opens Decision Evidence for its own programme, even one
 *     the previous engine's list never held; a V1 card's link is unchanged.
 */
let container; let root; let calls;
const ok = (payload) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => payload, text: async () => JSON.stringify(payload) });
const PLAYER = { id: 'athlete-1', full_name: 'Jordan Smith', position: 'CB', sport: 'mens-soccer', recruiting_class_year: 2028 };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  calls = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path: String(path), body });
    if (String(path).includes('/api/entities/players/athlete-1')) return ok(PLAYER);
    if (String(path).includes('/programmes')) return ok({ programmes: [] });
    return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, { programme: { resolved: false }, evidence: [], facts: [] }])));
  }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel) => container.querySelector(sel);

function Where() { return createElement('p', { 'data-testid': 'where' }, useLocation().pathname + useLocation().search); }

async function mountWorkspace(path) {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(PlayerWorkspace) },
          ...['profile', 'matching', 'engagement', 'campaign', 'reports', 'philosophy', 'evidence', 'decision']
            .map((seg) => createElement(Route, { key: seg, path: seg, element: createElement(Where) }))))));
  });
  await flush();
}

describe('the primary bar', () => {
  it('is exactly the five Phase 3 tabs, in order', async () => {
    expect(PRIMARY_TABS).toEqual(['Profile', 'Analysis & Matching', 'Coach Engagement', 'Campaign', 'Reports']);
    await mountWorkspace('/player/athlete-1/profile');
    const tabs = [...q('nav[aria-label="Player workspace"]').querySelectorAll('a')].map((a) => a.textContent);
    expect(tabs).toEqual(PRIMARY_TABS);
  });

  it('"More views" opens the three secondary views, each at its own route', async () => {
    await mountWorkspace('/player/athlete-1/profile');
    expect(q('[data-testid="more-views-menu"]')).toBeNull();
    await act(async () => { q('[data-testid="more-views-button"]').click(); });
    const links = [...q('[data-testid="more-views-menu"]').querySelectorAll('a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual(
      MORE_VIEWS.map((v) => [v.label, `/player/athlete-1/${v.segment}`]),
    );
    await act(async () => { links[1].click(); });
    expect(q('[data-testid="where"]').textContent).toBe('/player/athlete-1/evidence');
    // Following a link closes the menu, and the button names where the operator is.
    expect(q('[data-testid="more-views-menu"]')).toBeNull();
    expect(q('[data-testid="more-views-button"]').textContent).toBe('More views: Evidence');
  });

  it('closes on Escape', async () => {
    await mountWorkspace('/player/athlete-1/profile');
    await act(async () => { q('[data-testid="more-views-button"]').click(); });
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(q('[data-testid="more-views-menu"]')).toBeNull();
  });

  it.each(['philosophy', 'evidence', 'decision'])('the old deep link /player/:id/%s still opens its page', async (seg) => {
    await mountWorkspace(`/player/athlete-1/${seg}?college=Duke`);
    expect(q('[data-testid="where"]').textContent).toBe(`/player/athlete-1/${seg}?college=Duke`);
  });

  it('the app still routes all three pages', () => {
    const app = fs.readFileSync('src/App.jsx', 'utf8');
    for (const seg of ['philosophy', 'evidence', 'decision']) expect(app).toContain(`path="${seg}"`);
  });
});

describe('Decision Evidence from a V2 match card', () => {
  const programme = { programmeId: 'p9', name: "Mount St. Mary's", division: 'NCAA D1', status: 'RANKED', rank: 3, band: 'PRIORITY' };

  it('the card links to its own programme, name encoded whole', async () => {
    expect(decisionEvidenceHref('athlete-1', programme))
      .toBe("/player/athlete-1/decision?college=Mount+St.+Mary%27s&source=v2&division=NCAA+D1");
    const card = runView(persistedRun()).programmes[0];
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/player/athlete-1/matching'] },
        createElement(Routes, null, createElement(Route, { path: '/player/:id/matching', element: createElement(MatchmakingResultCard, { programme: card }) }))));
    });
    // Closed: the link appears with the rest of the detail, when the card is opened.
    expect(q('[data-testid="view-full-evidence"]')).toBeNull();
    const toggle = [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-expanded') === 'false');
    await act(async () => { toggle.click(); });
    expect(q('[data-testid="view-full-evidence"]').getAttribute('href')).toBe(decisionEvidenceHref('athlete-1', card));
    expect(new URLSearchParams(q('[data-testid="view-full-evidence"]').getAttribute('href').split('?')[1]).get('college')).toBe(card.name);
  });

  function Shell({ recommendations }) {
    const [player] = useState({ id: 'athlete-1', sport: 'mens-soccer', full_name: 'Jordan Smith' });
    const workspace = useActionableRecommendations({ playerId: player.id, recommendations, reserve: [] });
    return createElement(Outlet, { context: { player, recommendations, reserve: [], ...workspace, reload: () => {} } });
  }
  const mountDecision = async (search, recommendations) => {
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: [`/player/athlete-1/decision${search}`] },
        createElement(Routes, null, createElement(Route, { path: '/player/:id', element: createElement(Shell, { recommendations }) },
          createElement(Route, { path: 'decision', element: createElement(DecisionTab) })))));
    });
    await flush(); await flush();
  };
  const asked = () => [...calls].reverse().find((c) => c.path.includes('/operator-evidence'))?.body?.collegeNames ?? null;

  it('opens a programme the previous engine\'s list never held, and assesses exactly it', async () => {
    const v1 = [{ id: 'c1', name: 'Alpha', division: 'NCAA D1' }];
    await mountDecision('?college=Mount+St.+Mary%27s&source=v2&division=NCAA+D1', v1);
    expect(q('[data-testid="decision-direct"]').textContent).toContain("Mount St. Mary's");
    expect(asked()).toEqual(["Mount St. Mary's"]);
  });

  it('works for an athlete with no previous-engine analysis at all', async () => {
    await mountDecision('?college=Duke&source=v2', null);
    expect(q('[data-testid="decision-direct"]').textContent).toContain('Duke');
    expect(container.textContent).not.toContain('Run the analysis on the Matching tab first');
  });

  it('a V1 card link (no source) behaves exactly as before: a filter over the list', async () => {
    const v1 = [{ id: 'c1', name: 'Alpha', division: 'NCAA D1' }];
    await mountDecision('?college=Duke', v1);
    expect(q('[data-testid="decision-direct"]')).toBeNull();
    expect(container.textContent).toContain('No programme in this analysis matches');
  });

  it('a V2 link to a programme that IS in the list uses the list, unchanged', async () => {
    const v1 = [{ id: 'c1', name: 'Alpha', division: 'NCAA D1' }, { id: 'c2', name: 'Bravo', division: 'NCAA D2' }];
    await mountDecision('?college=Alpha&source=v2', v1);
    expect(q('[data-testid="decision-direct"]')).toBeNull();
    expect(asked()).toEqual(['Alpha']);
  });
});
