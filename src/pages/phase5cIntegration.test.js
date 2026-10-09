// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import * as workspace from './player/PlayerWorkspace.jsx';
import DecisionTab from './player/DecisionTab.jsx';
import EvidenceTab from './player/EvidenceTab.jsx';
import EditPlayer from './EditPlayer.jsx';
import ProgrammeWorkspace from './ProgrammeWorkspace.jsx';
import CoachTable from '@/components/engagement/CoachTable.jsx';
import CoachDetail from '@/components/engagement/CoachDetail.jsx';
import SelectionsOverviewPanel from '@/components/matchmaking/SelectionsOverviewPanel.jsx';
import { Failure } from '@/components/matchmaking/MatchmakingV2Panel.jsx';
import { MM2_ERROR } from '@/lib/useMatchmakingV2';

/**
 * REMAINING INTEGRATION CORRECTIONS, ON SCREEN — Phase 5, PR C.
 *
 *   #6  Decision Evidence / Evidence say what they are, with the way to V2.
 *   #9  "Mark responded" takes the day the reply arrived; clearing asks first.
 *   #12 Recovery paths: the contribution step, the edit link on an incomplete
 *       profile, the header Edit button's return, and "Back to athlete".
 *   #14 Copy: selections empty state, an inbox is not "this coach".
 */
let container; let root;
const ok = (payload) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => payload, text: async () => JSON.stringify(payload) });
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel) => container.querySelector(sel);
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
function Where() { const l = useLocation(); return createElement('p', { 'data-testid': 'where' }, l.pathname + l.search); }

describe('#6 the previous-engine views say what they are', () => {
  const mount = async (Tab, recommendations) => {
    vi.spyOn(workspace, 'usePlayerWorkspace').mockReturnValue({
      player: { id: 'p1', sport: 'mens-soccer' }, actionableRecommendations: recommendations, actionableStatus: 'READY', reload: () => {},
    });
    vi.stubGlobal('fetch', vi.fn(async () => ok({})));
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/player/p1/decision'] },
        createElement(Routes, null, createElement(Route, { path: '/player/:id/decision', element: createElement(Tab) }))));
    });
    await flush();
  };

  it.each([['Decision Evidence', DecisionTab], ['Evidence', EvidenceTab]])('%s with no previous-engine analysis: no impossible instruction, a link to V2', async (_, Tab) => {
    await mount(Tab, null);
    expect(container.textContent).not.toContain('Run the analysis on the Matching tab first');
    expect(q('[data-testid="previous-engine-notice"]').textContent).toContain('previous matching engine');
    expect(q('[data-testid="previous-engine-notice"]').textContent).toContain('View full evidence');
    expect(q('[data-testid="previous-engine-notice-link"]').getAttribute('href')).toBe('/player/p1/matching');
  });

  it.each([['Decision Evidence', DecisionTab], ['Evidence', EvidenceTab]])('%s with an empty list: no filters V2 does not have', async (_, Tab) => {
    await mount(Tab, []);
    expect(container.textContent).not.toMatch(/Widen the division or conference/);
    expect(q('[data-testid="previous-engine-notice"]').textContent).toContain('matched no programmes');
  });
});

describe('#9 recording and clearing a reply', () => {
  const ROW = { outreach_id: 'o1', coach_name: 'Vera Verified', recipient_kind: 'COACH', school: 'S', engagement_score: 0, tier: 'cold', qualified_visits: 0, best_coverage_pct: 0, total_rewinds: 0, sent_at: '2026-10-01T00:00:00.000Z' };
  const mount = async (row, onToggleResponded) => {
    await act(async () => { root.render(createElement(CoachTable, { coaches: [row], onSelect: () => {}, onToggleResponded, busyId: null })); });
  };

  it('"Mark responded" asks for the day (default today, never the future) and sends it', async () => {
    const onToggle = vi.fn();
    await mount(ROW, onToggle);
    await click(q('[data-testid="responded-button"]'));
    const input = q('[data-testid="responded-date"]');
    expect(input.value).toBe(new Date().toISOString().slice(0, 10));
    expect(input.getAttribute('max')).toBe(new Date().toISOString().slice(0, 10));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-10-03');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(q('[data-testid="responded-save"]'));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ outreach_id: 'o1' }), { responded: true, respondedAt: '2026-10-03' });
  });

  it('"Responded" does not clear on one click: it asks, and "Keep" changes nothing', async () => {
    const onToggle = vi.fn();
    await mount({ ...ROW, responded_at: '2026-10-03T12:00:00.000Z' }, onToggle);
    await click(q('[data-testid="responded-button"]'));
    expect(onToggle).not.toHaveBeenCalled();
    expect(q('[data-testid="responded-clear-confirm"]').textContent).toContain('Clear the reply recorded');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Keep'));
    expect(onToggle).not.toHaveBeenCalled();
    await click(q('[data-testid="responded-button"]'));
    await click(q('[data-testid="responded-clear"]'));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ outreach_id: 'o1' }), { responded: false });
  });

  it('the Engagement tab passes the date to the server and shows its refusal', () => {
    const tab = fs.readFileSync('src/pages/player/EngagementTab.jsx', 'utf8');
    expect(tab).toContain('engagement.setResponded(coach.outreach_id, responded, respondedAt)');
    expect(tab).toContain('data-testid="responded-error"');
  });
});

describe('#12 recovery paths', () => {
  it('"Add the family contribution" opens the form on the contribution step', async () => {
    const stored = { id: 'p1', full_name: 'Jordan', position: 'CB', sport: 'mens-soccer', recruiting_class_year: 2028, preferred_divisions: ['NCAA D1'], origin: 'USA', state: 'CA' };
    vi.stubGlobal('fetch', vi.fn(async (path) => ok(String(path).includes('/colleges') ? [] : stored)));
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/player/p1/edit?return=matching&step=contribution'] },
        createElement(Routes, null, createElement(Route, { path: '/player/:id/edit', element: createElement(EditPlayer) }))));
    });
    await flush(); await flush();
    expect(q('[role="radiogroup"][aria-label="Family contribution"]')).not.toBeNull();
    const panel = fs.readFileSync('src/components/matchmaking/MatchmakingV2Panel.jsx', 'utf8');
    expect(panel).toContain('/edit?return=matching&step=contribution');
  });

  it('an unknown step, or an invalid first step, opens step 1', async () => {
    const stored = { id: 'p1', full_name: '', position: 'CB', sport: 'mens-soccer', preferred_divisions: [] };
    vi.stubGlobal('fetch', vi.fn(async (path) => ok(String(path).includes('/colleges') ? [] : stored)));
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/player/p1/edit?step=contribution'] },
        createElement(Routes, null, createElement(Route, { path: '/player/:id/edit', element: createElement(EditPlayer) }))));
    });
    await flush(); await flush();
    expect(q('[role="radiogroup"][aria-label="Family contribution"]')).toBeNull();
  });

  it('an incomplete profile names what is missing and links straight to editing it', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(Failure, {
        error: { kind: MM2_ERROR.PROFILE_INVALID, message: 'cannot be ranked until these are recorded: position' }, playerId: 'p1', onRetry: () => {},
      })));
    });
    expect(container.textContent).toContain('cannot be ranked until these are recorded');
    expect(q('[data-testid="profile-invalid-edit"]').getAttribute('href')).toBe('/player/p1/edit?return=matching');
  });

  it('the header Edit button, from the matching tab, comes back to it', () => {
    const src = fs.readFileSync('src/pages/player/PlayerWorkspace.jsx', 'utf8');
    expect(src).toContain("navigate(`/player/${id}/edit${location.pathname.endsWith('/matching') ? '?return=matching' : ''}`)");
  });

  it('a programme opened from an athlete\'s card offers "Back to athlete"; opened directly, it does not', async () => {
    const DETAIL = {
      classYear: 2027, classYears: [2027], rosterSeason: 2026,
      overview: { id: 'p-duke', name: 'Duke', sport: 'mens-soccer', division: 'NCAA D1', active: 1, siblings: [] },
      roster: { assessed: true, eligibility: {}, departures: null, players: [], evidence: { rows: 0 } },
    };
    vi.stubGlobal('fetch', vi.fn(async () => ok(DETAIL)));
    const mount = async (path) => {
      await act(async () => {
        root.render(createElement(MemoryRouter, { key: path, initialEntries: [path] },
          createElement(Routes, null, createElement(Route, { path: '/programmes/:id', element: createElement('div', null, createElement(ProgrammeWorkspace), createElement(Where)) }))));
      });
      await flush();
    };
    await mount('/programmes/p-duke?classYear=2027&from=athlete-9');
    expect(q('[data-testid="back-to-athlete"]').getAttribute('href')).toBe('/player/athlete-9/matching');
    // switching section keeps it
    await click(q('[data-testid="section-roster"]'));
    expect(q('[data-testid="where"]').textContent).toContain('from=athlete-9');
    await mount('/programmes/p-duke?classYear=2027');
    expect(q('[data-testid="back-to-athlete"]')).toBeNull();
  });
});

describe('#14 copy that matches the product', () => {
  it('the selections empty state no longer promises selecting from the ranked list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ selections: [] })));
    await act(async () => { root.render(createElement(SelectionsOverviewPanel, { player: { id: 'p1' } })); });
    await flush();
    expect(q('[data-testid="selections-empty"]').textContent).not.toContain('from the ranked list');
    expect(q('[data-testid="selections-empty"]').textContent).toContain('Specific Search');
  });

  it('a programme inbox with no visits is not called "this coach"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path) => ok(String(path).includes('/opt-out') ? { optedOut: false } : [])));
    await act(async () => {
      root.render(createElement(CoachDetail, {
        coach: { outreach_id: 'o1', recipient_kind: 'PROGRAMME_INBOX', recipient_label: "Duke Men's Soccer", school: 'Duke', engagement_score: 0, tier: 'cold' },
        onBack: () => {},
      }));
    });
    await flush();
    expect(container.textContent).toContain('This programme inbox has not had a qualified visit yet.');
    expect(container.textContent).not.toContain('This coach has not');
  });

  it('the stale "nothing can be sent to an inbox" comments are corrected', () => {
    for (const f of ['server/lib/programmeContacts.js', 'server/routes/programmeContacts.js', 'src/pages/programme/ContactsSection.jsx']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toContain('no delivery boundary sends to an inbox yet');
      expect(src).not.toContain('nothing here can be selected or sent to yet');
    }
  });
});
