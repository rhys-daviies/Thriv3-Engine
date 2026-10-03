// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTabSwitch from './MatchingTabSwitch';
import { matchmakingVersion, MATCHING_V1, MATCHING_V2 } from '@/lib/matchmakingVersion';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import { persistedRun } from '@/lib/__fixtures__/matchmakingV2Run.js';

/**
 * V1 MUST STILL BE REACHABLE, AND V2 MUST BE THE DEFAULT — §T.
 *
 * The rollback is the point of the switch. During internal rollout a
 * consultant on a call has to be able to get the old screen back without a
 * deploy, and an operator watching has to be able to reproduce what they saw.
 */

let container;
let root;

const RECOMMENDATIONS = [{
  name: 'Fixture College',
  division: 'NCAA D2',
  match_score: 71,
  breakdown: [],
  coaching_staff: [],
}];

/** Stands in for PlayerWorkspace, exactly as the V1 suites do. */
function Shell() {
  const workspace = useActionableRecommendations({
    playerId: 'player-1', recommendations: RECOMMENDATIONS, reserve: [],
  });
  return createElement(Outlet, {
    context: {
      player: { id: 'player-1', sport: 'mens-soccer', full_name: 'Test Athlete' },
      setPlayer: () => {},
      recommendations: RECOMMENDATIONS,
      reserve: [],
      summary: '',
      ...workspace,
      analyzing: false,
      phase: 0,
      progress: { current: 0, total: 0, school: '' },
      page: 1,
      setPage: () => {},
      onAnalyze: async () => {},
    },
  });
}

async function mountAt(entry) {
  await act(async () => {
    root.render(createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTabSwitch) }))),
    ));
  });
}

const text = () => container.textContent;
const find = (sel) => container.querySelector(sel);

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async (path) => {
    if (path.includes('/matchmaking/runs/current')) {
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        json: async () => persistedRun(),
      };
    }
    return {
      ok: true, status: 200, headers: { get: () => 'application/json' },
      json: async () => ({ programmes: [] }),
    };
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Matching engine switch', () => {
  it('T1. the default is V2', () => {
    expect(matchmakingVersion(new URLSearchParams(''), {})).toBe(MATCHING_V2);
    expect(matchmakingVersion(null, {})).toBe(MATCHING_V2);
  });

  it('T2. ?matching=v1 selects V1, and beats a build pinned to v2', () => {
    expect(matchmakingVersion(new URLSearchParams('matching=v1'), {})).toBe(MATCHING_V1);
    expect(matchmakingVersion(new URLSearchParams('matching=v1'), { VITE_MATCHMAKING_ENGINE: 'v2' }))
      .toBe(MATCHING_V1);
  });

  it('T3. a build can default to V1, and one person can still reach V2', () => {
    expect(matchmakingVersion(new URLSearchParams(''), { VITE_MATCHMAKING_ENGINE: 'v1' }))
      .toBe(MATCHING_V1);
    expect(matchmakingVersion(new URLSearchParams('matching=v2'), { VITE_MATCHMAKING_ENGINE: 'v1' }))
      .toBe(MATCHING_V2);
  });

  it('T4. an unrecognised value falls through to the default rather than blanking the screen', () => {
    for (const bad of ['V3', 'two', '', '  ', 'true']) {
      expect(matchmakingVersion(new URLSearchParams(`matching=${bad}`), {})).toBe(MATCHING_V2);
    }
    /** Case and padding are tolerated on the real spellings. */
    expect(matchmakingVersion(new URLSearchParams('matching=V1'), {})).toBe(MATCHING_V1);
  });

  it('T5. the route renders V2 by default', async () => {
    await mountAt('/player/player-1/matching');
    expect(find('[data-testid="run-bar"]')).toBeTruthy();
    expect(text()).toContain('Lindenwood');
    /** And not the V1 tab. */
    expect(text()).not.toContain('Recommended Matches');
  });

  it('T6. ?matching=v1 renders the V1 tab, intact', async () => {
    await mountAt('/player/player-1/matching?matching=v1');

    /** V1's own view bar, from the untouched component. */
    expect(text()).toContain('Recommended Matches');
    expect(text()).toContain('Specific Schools');
    expect(find('[data-testid="v1-fallback-notice"]')).toBeTruthy();
    /** V2 is not mounted beside it. */
    expect(find('[data-testid="run-bar"]')).toBeNull();
  });

  /**
   * ONE MOUNT PER TEST, and the first draft of this did not have that.
   *
   * `MemoryRouter` reads `initialEntries` once; rendering a second one into
   * the SAME root keeps the first entry, so the "now check V2" half of a
   * combined test was still looking at the V1 screen. It failed loudly rather
   * than passing for the wrong reason, which is the only reason it was caught.
   */
  it('T7. the V1 screen offers the route back to V2', async () => {
    await mountAt('/player/player-1/matching?matching=v1');
    const toV2 = [...container.querySelectorAll('a')]
      .find((a) => a.textContent.includes('Matcher V2'));
    expect(toV2.getAttribute('href')).toContain('matching=v2');
  });

  it('T7b. the V2 screen keeps a route to the V1 relationship workflow', async () => {
    /**
     * A9.5 moved SEARCH onto the persisted run, so this link is no longer
     * about finding a school. What is still only on the V1 tab is the
     * relationship work around a requested one — flag, note, contact stance,
     * manual outreach — and the route to it stays.
     */
    await mountAt('/player/player-1/matching');
    const toV1 = [...container.querySelectorAll('a')]
      .find((a) => a.textContent.includes('Requested schools'));
    expect(toV1.getAttribute('href')).toContain('matching=v1');
  });

  it('T8. V2 never calls the V1 analysis path', async () => {
    await mountAt('/player/player-1/matching');
    const paths = global.fetch.mock.calls.map(([p]) => String(p));
    expect(paths.some((p) => p.includes('/matchmaking/runs/current'))).toBe(true);
    expect(paths.some((p) => p.includes('/matching-summary'))).toBe(false);
    expect(paths.some((p) => p.includes('UploadFile'))).toBe(false);
  });
});
