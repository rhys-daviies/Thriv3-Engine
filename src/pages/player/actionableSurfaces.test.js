// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import DecisionTab from './DecisionTab.jsx';
import EvidenceTab from './EvidenceTab.jsx';
import PhilosophyTab from './PhilosophyTab.jsx';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import { ZERO } from '@/lib/__fixtures__/recruitingSignals.js';

/**
 * FOUR SURFACES, ONE ANSWER.
 *
 * Matching, Decision, Evidence and Philosophy all claim to show this athlete's
 * current recommendations. Before this correction each read the raw analysis
 * independently, so a school removed on the Matching tab carried on appearing
 * on the other three — which is worse than not having the control, because the
 * operator would believe the decision had been made.
 *
 * These tests assert on WHAT EACH TAB ASKS THE SERVER FOR as well as on what
 * it renders. The request body is the set of programmes the tab is actually
 * operating over; a school absent from the screen but present in the request
 * would still be one this product is doing work about.
 */

/**
 * A DIFFERENT ATHLETE PER TEST.
 *
 * PhilosophyTab memoises summaries in a module-level Map keyed on
 * `playerId|ids`, deliberately — two renders of the same page share one
 * request. Across tests in one file that cache is shared too, so a second test
 * asking about the same schools for the same athlete makes no request at all
 * and an assertion about what it asked for silently measures nothing.
 */
let ATHLETE;
let athleteSeq = 0;

/**
 * Names chosen so none is a substring of another. `School 1` inside
 * `School 101` made every "is it absent" assertion pass for the wrong reason.
 */
const college = (n, label) => ({
  id: `col-${n}`,
  name: label,
  division: 'NCAA D1',
  match_score: 200 - n,
  coaching_staff: [],
  breakdown: [{ key: 'roster', label: 'Roster opportunity', weight: 0.2, score: 0.5, contribution: 10, confidence: 'measured' }],
});

const RECOMMENDATIONS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((n, i) => college(i + 1, n));
const RESERVE = ['Foxtrot', 'Golf', 'Hotel'].map((n, i) => college(101 + i, n));

const NAME_BY_ID = new Map([...RECOMMENDATIONS, ...RESERVE].map((c) => [c.id, c.name]));

const relationship = (over = {}) => ({
  id: `rel-${over.college_name ?? 'Alpha'}`,
  athlete_id: ATHLETE,
  college_name: 'Alpha',
  sport: 'mens-soccer',
  college_id: 'col-1',
  request_state: 'none',
  flagged: false,
  flag_reason: null,
  visibility: 'default',
  contact_stance: 'default',
  note: null,
  ...over,
});

let container;
let root;
let calls;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

/**
 * Holds the relationship request open until the test chooses to answer it.
 *
 * The gap between the analysis arriving and the relationship rows arriving is
 * the entire subject of the block at the foot of this file, so it has to be a
 * gap a test controls rather than one it races.
 */
function stubFetchDeferred({ fail = false } = {}) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method: opts.method || 'GET', body });
    if (path.includes('/programmes')) {
      const programmes = await gate;
      if (fail) return { ok: false, status: 500, headers: { get: () => 'application/json' }, text: async () => '{}' };
      return ok({ programmes });
    }
    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/philosophy/summaries')) {
      return ok({
        summaries: Object.fromEntries((body?.collegeIds ?? [])
          .map((id) => [id, { college_id: id, college_name: NAME_BY_ID.get(id) ?? id, resolved: false }])),
      });
    }
    return ok(Object.fromEntries((body?.collegeNames ?? [])
      .map((n) => [n, { programme: { resolved: false }, evidence: [], facts: [] }])));
  }));
  return { settle: async (programmes = []) => { release(programmes); await act(async () => {}); } };
}

function stubFetch(programmes = []) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method: opts.method || 'GET', body });
    if (path.includes('/programmes')) return ok({ programmes });
    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/philosophy/summaries')) {
      return ok({
        summaries: Object.fromEntries((body?.collegeIds ?? [])
          .map((id) => [id, { college_id: id, college_name: NAME_BY_ID.get(id) ?? id, resolved: false }])),
      });
    }
    // operator-evidence and evidence both answer keyed by college name.
    return ok(Object.fromEntries((body?.collegeNames ?? [])
      .map((n) => [n, { programme: { resolved: false }, evidence: [], facts: [] }])));
  }));
}

/** Stands in for PlayerWorkspace, calling the same hook it does. */
function Shell({ recommendations, reserve }) {
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer', full_name: 'Test Athlete' });
  const [page, setPage] = useState(1);
  const workspace = useActionableRecommendations({ playerId: player.id, recommendations, reserve });
  return createElement(Outlet, {
    context: {
      player, setPlayer: () => {}, recommendations, reserve, summary: '',
      ...workspace, analyzing: false, phase: 0,
      progress: { current: 0, total: 0, school: '' },
      page, setPage, onAnalyze: async () => {},
    },
  });
}

const SEGMENTS = {
  matching: MatchingTab, decision: DecisionTab, evidence: EvidenceTab, philosophy: PhilosophyTab,
};

async function render(segment, { recommendations = RECOMMENDATIONS, reserve = RESERVE } = {}) {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: [`/player/${ATHLETE}/${segment}`] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell, { recommendations, reserve }) },
          createElement(Route, { path: segment, element: createElement(SEGMENTS[segment]) }))),
    ));
  });
}

const text = () => container.textContent;

/**
 * The programmes a tab is operating over ONCE IT HAS SETTLED — the last
 * request it made, not every request it ever made.
 *
 * The distinction is not bookkeeping. The analysis and the relationship rows
 * arrive independently, so a tab's first render happens before the workspace
 * knows what this athlete's operator has suppressed, and it asks about the raw
 * list. The screen corrects itself the moment the relationships land. What is
 * asserted here is the state the operator actually sees and works in; the
 * transient is real and is written up rather than hidden.
 */
function asked() {
  const last = [...calls].reverse().find((c) => c.body?.collegeNames || c.body?.collegeIds);
  if (!last) return [];
  const named = last.body.collegeNames ?? [];
  const byId = (last.body.collegeIds ?? []).map((id) => NAME_BY_ID.get(id) ?? id);
  return [...new Set([...named, ...byId])];
}

beforeEach(() => {
  ATHLETE = `athlete-${++athleteSeq}`;
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

// ---------------------------------------------------------------------------

describe('with nothing suppressed, every surface is what it was', () => {
  for (const segment of ['matching', 'decision', 'evidence', 'philosophy']) {
    it(`${segment} shows all five recommendations`, async () => {
      stubFetch();
      await render(segment);
      for (const n of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) expect(text()).toContain(n);
      // And not one reserve programme: the reserve replaces, it never extends.
      for (const n of ['Foxtrot', 'Golf', 'Hotel']) expect(text()).not.toContain(n);
      expect(asked().sort()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    });
  }
});

describe('a suppressed rank-1 programme', () => {
  const suppressed = [relationship({ visibility: 'suppressed' })];

  for (const segment of ['matching', 'decision', 'evidence', 'philosophy']) {
    it(`is absent from ${segment}, on screen and in what it asks for`, async () => {
      stubFetch(suppressed);
      await render(segment);

      expect(text()).not.toContain('Alpha');
      expect(asked()).not.toContain('Alpha');
      // The rest are still there.
      for (const n of ['Bravo', 'Charlie', 'Delta', 'Echo']) expect(text()).toContain(n);
    });

    it(`promotes the reserve into ${segment} in the removed programme's place`, async () => {
      stubFetch(suppressed);
      await render(segment);

      // The next programme the model ranked takes the slot, and the tab
      // operates on it exactly as it would on any other.
      expect(text()).toContain('Foxtrot');
      expect(asked()).toContain('Foxtrot');
      expect(asked().sort()).toEqual(['Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']);
      expect(text()).not.toContain('Golf');
    });
  }
});

describe('a flagged but visible school', () => {
  const flagged = [relationship({ flagged: true, flag_reason: 'knows the coach' })];

  for (const segment of ['matching', 'decision', 'evidence', 'philosophy']) {
    it(`is still present in ${segment}`, async () => {
      stubFetch(flagged);
      await render(segment);
      // Only `visibility` takes a school out. A coach we already know is often
      // the most actionable school on the list.
      expect(text()).toContain('Alpha');
      expect(asked()).toContain('Alpha');
      expect(text()).not.toContain('Foxtrot');
    });
  }
});

describe('a specifically-requested school that has been suppressed', () => {
  const both = [relationship({ request_state: 'requested', visibility: 'suppressed' })];

  it('is absent from the actionable surfaces', async () => {
    for (const segment of ['decision', 'evidence', 'philosophy']) {
      calls = [];
      stubFetch(both);
      await render(segment);
      expect(text(), segment).not.toContain('Alpha');
    }
  });

  it('is still visible in Specific Schools, which claims nothing about being actionable', async () => {
    stubFetch(both);
    await render('matching');
    expect(text()).not.toContain('Alpha');

    const tab = Array.from(container.querySelectorAll('[role="tab"]'))
      .find((t) => t.textContent.includes('Specific Schools'));
    await act(async () => { tab.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const rows = container.querySelectorAll('[data-testid="specific-school-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Alpha');
  });

  it('is still reachable from the restore panel', async () => {
    stubFetch(both);
    await render('matching');
    const show = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Removed from this athlete'));
    await act(async () => { show.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-testid="suppressed-list"]').textContent).toContain('Alpha');
  });
});

describe('the raw analysis is never touched by any surface', () => {
  for (const segment of ['matching', 'decision', 'evidence', 'philosophy']) {
    it(`${segment} leaves recommendations and reserve exactly as they were`, async () => {
      const before = JSON.stringify({ RECOMMENDATIONS, RESERVE });
      stubFetch([relationship({ visibility: 'suppressed' })]);
      await render(segment);

      expect(JSON.stringify({ RECOMMENDATIONS, RESERVE })).toBe(before);
      expect(RECOMMENDATIONS[0]).not.toHaveProperty('source_rank');
      expect(RESERVE[0]).not.toHaveProperty('promoted');
      // Nothing wrote anywhere near the analysis.
      expect(calls.some((c) => c.path.includes('/uploads'))).toBe(false);
      expect(calls.some((c) => c.path.includes('/campaigns'))).toBe(false);
    });
  }
});

describe('an athlete who has never been analysed', () => {
  /**
   * `visibleTop100` answers `[]` for a null input, so passing it through
   * unconditionally would turn "no analysis has been run" into "the analysis
   * matched nothing" on every tab. They say different things and both are
   * shown to the operator.
   */
  for (const segment of ['decision', 'evidence', 'philosophy']) {
    it(`${segment} still says to run the analysis first`, async () => {
      stubFetch();
      await render(segment, { recommendations: null, reserve: [] });
      expect(text()).toMatch(/Run the analysis|No matches yet/i);
      expect(text()).not.toMatch(/matched no programmes/i);
    });
  }
});


// ---------------------------------------------------------------------------

describe('while the relationship state is still loading', () => {
  const suppressed = [relationship({ visibility: 'suppressed' })];

  for (const segment of ['matching', 'decision', 'evidence', 'philosophy']) {
    it(`${segment} shows a loading state instead of the raw list`, async () => {
      const gate = stubFetchDeferred();
      await render(segment);

      // THE PAINT THIS WHOLE CHANGE IS ABOUT. The analysis is here and the
      // operator's decisions are not, so nothing ranked is drawn.
      expect(text()).toContain('Loading this athlete');
      for (const n of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) {
        expect(text(), `${n} must not be drawn yet`).not.toContain(n);
      }
      // And nothing has been asked about any of them either.
      expect(asked()).toEqual([]);

      await gate.settle(suppressed);
      expect(text()).not.toContain('Loading this athlete');
    });

    it(`${segment} never shows the suppressed school, before or after`, async () => {
      const gate = stubFetchDeferred();
      await render(segment);
      expect(text()).not.toContain('Alpha');

      await gate.settle(suppressed);
      // Still absent, and now the derived list is on screen.
      expect(text()).not.toContain('Alpha');
      expect(text()).toContain('Bravo');
    });

    it(`${segment} shows the promoted reserve programme only once derivation is ready`, async () => {
      const gate = stubFetchDeferred();
      await render(segment);
      expect(text()).not.toContain('Foxtrot');

      await gate.settle(suppressed);
      expect(text()).toContain('Foxtrot');
      expect(asked()).toContain('Foxtrot');
    });
  }

  it('leaves the raw analysis untouched throughout', async () => {
    const before = JSON.stringify({ RECOMMENDATIONS, RESERVE });
    const gate = stubFetchDeferred();
    await render('matching');
    expect(JSON.stringify({ RECOMMENDATIONS, RESERVE })).toBe(before);
    await gate.settle(suppressed);
    expect(JSON.stringify({ RECOMMENDATIONS, RESERVE })).toBe(before);
  });
});

describe('when the relationship request fails', () => {
  for (const segment of ['matching', 'decision', 'evidence', 'philosophy']) {
    it(`${segment} says so rather than falling back to the raw list`, async () => {
      const gate = stubFetchDeferred({ fail: true });
      await render(segment);
      await gate.settle();

      /**
       * NOT A DEGRADED ANSWER. A list assembled without the operator's
       * decisions is the one specific list this feature exists to stop
       * showing, so a failure shows nothing ranked and says why.
       */
      expect(text()).toContain('could not be loaded');
      for (const n of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']) {
        expect(text(), `${n} must not appear on a failed load`).not.toContain(n);
      }
      expect(asked()).toEqual([]);
    });
  }

  it('offers the existing retry path', async () => {
    const gate = stubFetchDeferred({ fail: true });
    await render('decision');
    await gate.settle();
    const retry = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Try again'));
    expect(retry).toBeTruthy();
  });
});

describe('an analysis that genuinely matched nothing', () => {
  it('says so, rather than loading forever', async () => {
    // EMPTY is a fourth state and not a variation on loading: everything is
    // known, and the answer is that there is nothing.
    stubFetch([]);
    await render('decision', { recommendations: [], reserve: [] });
    expect(text()).not.toContain('Loading this athlete');
    expect(text()).toMatch(/matched no programmes|Run the analysis/i);
  });

  it('says so when every programme has been suppressed', async () => {
    const all = RECOMMENDATIONS.map((c) => relationship({
      id: `rel-${c.name}`, college_id: c.id, college_name: c.name, visibility: 'suppressed',
    }));
    stubFetch([...all, ...RESERVE.map((c) => relationship({
      id: `rel-${c.name}`, college_id: c.id, college_name: c.name, visibility: 'suppressed',
    }))]);
    await render('decision');
    expect(text()).not.toContain('Loading this athlete');
    expect(text()).toMatch(/matched no programmes/i);
  });
});
