// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import { ZERO } from '@/lib/__fixtures__/recruitingSignals.js';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';

/**
 * "Can you contact Stanford?"
 *
 * A specific request is a RELATIONSHIP, not a recommendation. The properties
 * these tests hold are mostly about what does NOT happen when one is made:
 * the ranked list is not touched, no rank is invented, no campaign is
 * disturbed, and a school that was already flagged keeps its flag.
 *
 * The other half is that nothing here resolves a name to a school on its own.
 * Every add carries a `college_id` the server's own search returned, and the
 * assertion that no request body ever contains a `college_name` is the one
 * that would catch a future "helpful" shortcut.
 */

const ATHLETE = 'athlete-1';

const RECOMMENDATIONS = [
  { name: 'Duke', division: 'NCAA D1', match_score: 88, coaching_staff: [] },
  { name: 'Stanford', division: 'NCAA D1', match_score: 84, coaching_staff: [] },
  { name: 'Elon', division: 'NCAA D1', match_score: 80, coaching_staff: [] },
];

const STANFORD_ROW = {
  id: 'col-stanford', name: 'Stanford', sport: 'mens-soccer',
  division: 'NCAA D1', conference: 'ACC', city: 'Stanford', state: 'CA', matched_on: 'name',
};

const relationship = (over = {}) => ({
  id: 'rel-1',
  athlete_id: ATHLETE,
  college_name: 'Stanford',
  sport: 'mens-soccer',
  college_id: 'col-stanford',
  request_state: 'requested',
  requested_by: 'operator',
  requested_at: '2026-09-11T00:00:00.000Z',
  flagged: false,
  flag_reason: null,
  flagged_at: null,
  visibility: 'default',
  contact_stance: 'default',
  note: null,
  note_updated_at: null,
  created_at: '2026-09-11T00:00:00.000Z',
  updated_at: '2026-09-11T00:00:00.000Z',
  division: 'NCAA D1',
  conference: 'ACC',
  city: 'Stanford',
  state: 'CA',
  college_active: 1,
  ...over,
});

let container;
let root;
let calls;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => payload,
  text: async () => JSON.stringify(payload),
});
const fail = (status, payload) => ({
  ok: false, status, headers: { get: () => 'application/json' }, json: async () => payload,
  text: async () => JSON.stringify(payload),
});

/**
 * @param {object} routes  per-concern handlers; anything unhandled 404s loudly
 *   rather than resolving to an empty success that a test would misread.
 */
function stubFetch({ programmes = [], search = [], onUpsert, onPatch } = {}) {
  let current = programmes;
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/colleges/search')) {
      return ok({ query: '', sport: 'mens-soccer', limits: {}, results: search });
    }
    if (path.includes('/programmes') && method === 'GET') {
      return ok({ programmes: current });
    }
    if (path.includes('/programmes') && method === 'POST') {
      const res = onUpsert ? onUpsert(body) : ok({ programme: relationship() });
      if (res.ok) current = [relationship()];
      return res;
    }
    if (path.includes('/programmes') && method === 'PATCH') {
      const res = onPatch ? onPatch(body) : ok({ programme: relationship({ request_state: 'withdrawn' }) });
      return res;
    }
    return fail(404, { error: `unstubbed ${method} ${path}` });
  }));
}

/**
 * Stands in for PlayerWorkspace, and CALLS THE SAME HOOK IT DOES.
 *
 * The relationship state and the derived actionable list are produced in the
 * workspace now, not in the tab. A harness that assembled its own version of
 * that context could pass while the real one was broken, so it calls the
 * production hook and publishes what comes back.
 */
function Shell({ recommendations, reserve = [] }) {
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer' });
  const workspace = useActionableRecommendations({
    playerId: player.id, recommendations, reserve,
  });
  return createElement(Outlet, {
    context: {
      player,
      setPlayer: () => {},
      recommendations,
      reserve,
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

async function render(recommendations = RECOMMENDATIONS) {
  await act(async () => {
    root.render(createElement(
      MemoryRouter,
      { initialEntries: ['/player/athlete-1/matching'] },
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { path: '/player/:id', element: createElement(Shell, { recommendations }) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTab) }),
        ),
      ),
    ));
  });
}

const text = () => container.textContent;
const buttons = () => Array.from(container.querySelectorAll('button'));
/** Relationship writes only. `/matching-summary` is also a POST and is not one. */
const relationshipCalls = (method) => calls.filter(
  (c) => c.method === method && c.path.includes('/programmes'),
);
const buttonWith = (label) => buttons().find((b) => b.textContent.trim().startsWith(label));
const tab = (label) => Array.from(container.querySelectorAll('[role="tab"]'))
  .find((t) => t.textContent.includes(label));

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

async function type(value) {
  const input = container.querySelector('input[aria-label="Search for a school by name"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // The search is debounced, so nothing has been asked for yet.
  await act(async () => { vi.advanceTimersByTime(400); });
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('B1 — the primary control', () => {
  it('is Specific Search, and it is the entry point on that row', async () => {
    stubFetch();
    await render();

    const primary = buttonWith('Specific Search');
    expect(primary).toBeTruthy();

    // The row that used to carry the priorities control now carries this one.
    // The tablist is its sibling.
    const row = primary.parentElement;
    expect(row.querySelector('[role="tablist"]')).toBeTruthy();
  });

  it('shows NO Match priorities control anywhere in the tab', async () => {
    stubFetch();
    await render();

    // Not demoted, not hidden behind a disclosure — gone. The agreed direction
    // is that Specific Search is the entry point here, and the priorities panel
    // additionally crashes on render (see the characterisation test below), so
    // exposing a control for it would be exposing a broken one.
    expect(buttonWith('Match priorities')).toBeUndefined();
    expect(buttonWith('Hide priorities')).toBeUndefined();
    expect(text()).not.toContain('Match priorities');
    expect(text()).not.toContain('priorities');

    // And in the Specific Schools view too, not just this one.
    await click(tab('Specific Schools'));
    expect(text()).not.toContain('priorities');
  });

  /**
   * THE COMPONENT IS NOT RENDERED HERE, AND THAT IS NOT AN OVERSIGHT.
   *
   * `CriteriaRanking` throws on its first render on `main` today — `previewing`
   * is read inside a useMemo at src/components/CriteriaRanking.jsx:38 and
   * declared with `const` nine lines below it, so every render hits the
   * temporal dead zone. Introduced in a139ab0; nothing renders the component in
   * a test, which is why it went unnoticed.
   *
   * This PR neither caused it nor fixes it, and deliberately does not expose a
   * control that would hit it. What the assertions below hold is the thing this
   * PR IS responsible for: the file, the import, the handler and the render are
   * all still here, so relocating priorities later is moving one block rather
   * than rebuilding a feature out of git history.
   */
  it('has NOT deleted CriteriaRanking — file, import, handler and render all remain', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = process.cwd();
    const source = fs.readFileSync(path.join(root, 'src/pages/player/MatchingTab.jsx'), 'utf8');
    expect(source).toContain("import CriteriaRanking from '@/components/CriteriaRanking'");
    expect(source).toContain('<CriteriaRanking');
    expect(source).toContain('onApply={applyRanking}');
    expect(source).toContain('criterion_ranking: ranking');
    // And the component is still on disk, unmodified by this slice.
    expect(fs.existsSync(path.join(root, 'src/components/CriteriaRanking.jsx'))).toBe(true);
  });
});

describe('B4 — two views, kept apart', () => {
  it('shows Recommended Matches first, exactly as before', async () => {
    stubFetch();
    await render();

    expect(tab('Recommended Matches').getAttribute('aria-selected')).toBe('true');
    expect(text()).toContain('Duke');
    expect(text()).toContain('Message all head coaches');
  });

  it('lists only requested relationships under Specific Schools', async () => {
    stubFetch({
      programmes: [
        relationship({ id: 'rel-1', college_name: 'Stanford', request_state: 'requested' }),
        relationship({ id: 'rel-2', college_name: 'Yale', college_id: 'col-yale', request_state: 'withdrawn' }),
        relationship({ id: 'rel-3', college_name: 'Brown', college_id: 'col-brown', request_state: 'none', flagged: true }),
      ],
    });
    await render();
    await click(tab('Specific Schools'));

    const rows = container.querySelectorAll('[data-testid="specific-school-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Stanford');
    // A withdrawn request and a merely-flagged relationship are both real rows
    // and neither is a specific request.
    expect(text()).not.toContain('Yale');
    expect(text()).not.toContain('Brown');
  });

  it('counts the specific schools on its own tab', async () => {
    stubFetch({ programmes: [relationship(), relationship({ id: 'rel-2', college_name: 'Yale', college_id: 'col-yale' })] });
    await render();
    expect(tab('Specific Schools').textContent).toContain('(2)');
  });

  it('marks each one a Specific Request', async () => {
    stubFetch({ programmes: [relationship()] });
    await render();
    await click(tab('Specific Schools'));
    expect(text()).toContain('Specific Request');
  });

  it('shows a natural rank as supplemental information, and invents none', async () => {
    stubFetch({
      programmes: [
        relationship(),                                                       // Stanford, ranked #2
        relationship({ id: 'rel-2', college_name: 'Gonzaga', college_id: 'col-gonzaga' }),
      ],
    });
    await render();
    await click(tab('Specific Schools'));

    // Stanford is #2 in the recommendations above, read off the array.
    expect(text()).toContain('#2');
    // Gonzaga is not ranked at all, and gets no placeholder rank.
    const rows = Array.from(container.querySelectorAll('[data-testid="specific-school-row"]'));
    const gonzaga = rows.find((r) => r.textContent.includes('Gonzaga'));
    expect(gonzaga.textContent).not.toMatch(/#\d/);
  });

  it('says so when the relationship list could not be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      calls.push({ path, method: opts.method || 'GET' });
      if (path.includes('/programmes')) return fail(500, { error: 'boom' });
      return ok({});
    }));
    await render();
    await click(tab('Specific Schools'));
    // An empty list and a list that failed to load look identical otherwise.
    expect(text()).toContain('could not be loaded');
  });
});

describe('B2/B3 — searching and adding', () => {
  it('searches the canonical programme registry, sport-scoped', async () => {
    stubFetch({ search: [STANFORD_ROW] });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Stanford');

    const search = calls.filter((c) => c.path.includes('/colleges/search'));
    expect(search).toHaveLength(1);
    expect(search[0].path).toContain('sport=mens-soccer');
    expect(search[0].path).toContain('q=Stanford');
    // No web search, no model, no other lookup of any kind.
    expect(calls.some((c) => /google|bing|anthropic|openai|csv-agent/i.test(c.path))).toBe(false);
  });

  it('shows compact canonical fields for each candidate', async () => {
    stubFetch({ search: [STANFORD_ROW] });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Stanford');

    const panel = container.querySelector('[data-testid="specific-search"]');
    expect(panel.textContent).toContain('Stanford');
    expect(panel.textContent).toContain('NCAA D1');
    expect(panel.textContent).toContain('ACC');
    expect(panel.textContent).toContain('Stanford, CA');
  });

  it('adds by canonical college identity and never by name', async () => {
    stubFetch({ search: [STANFORD_ROW] });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Stanford');
    await click(buttonWith('Add to Specific Schools'));

    const post = relationshipCalls('POST')[0];
    expect(post.body.college_id).toBe('col-stanford');
    expect(post.body.request_state).toBe('requested');
    expect(post.body.requested_by).toBe('operator');
    // THE GUARANTEE. A school name must never be a thing this client stores.
    expect(post.body).not.toHaveProperty('college_name');
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain('college_name');
  });

  it('does not create a second row when the button is clicked twice', async () => {
    stubFetch({ search: [STANFORD_ROW] });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Stanford');
    await click(buttonWith('Add to Specific Schools'));

    // After the first add the row says "Added" and there is no button to press
    // again. The database's UNIQUE constraint is the real guarantee; this is
    // the screen not inviting the mistake.
    expect(container.querySelector('[data-testid="specific-search"]').textContent).toContain('Added');
    expect(buttonWith('Add to Specific Schools')).toBeUndefined();
    expect(relationshipCalls('POST')).toHaveLength(1);
  });

  it('shows a school that is already flagged as flagged, before adding it', async () => {
    stubFetch({
      search: [STANFORD_ROW],
      programmes: [relationship({ request_state: 'none', flagged: true, flag_reason: 'sister plays there' })],
    });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Stanford');

    // The add below lands on THAT row. An operator who cannot see it is one
    // who thinks they are creating something.
    expect(container.querySelector('[data-testid="specific-search"]').textContent).toContain('Flagged');
  });

  it('keeps the flag when a flagged relationship becomes a specific request', async () => {
    const flagged = relationship({ request_state: 'none', flagged: true, flag_reason: 'sister plays there' });
    stubFetch({
      search: [STANFORD_ROW],
      programmes: [flagged],
      // The server upserts onto the same row: same id, flag intact.
      onUpsert: () => ok({ programme: { ...flagged, request_state: 'requested', requested_by: 'operator' } }),
    });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Stanford');
    await click(buttonWith('Add to Specific Schools'));
    await click(tab('Specific Schools'));

    const rows = container.querySelectorAll('[data-testid="specific-school-row"]');
    expect(rows).toHaveLength(1);              // the SAME row, not a second one
    expect(rows[0].textContent).toContain('Specific Request');
    expect(rows[0].textContent).toContain('Flagged');
  });
});

describe('error states', () => {
  it('asks for more characters before it asks the server anything', async () => {
    stubFetch({ search: [STANFORD_ROW] });
    await render();
    await click(buttonWith('Specific Search'));
    await type('S');

    expect(container.querySelector('[data-testid="specific-search"]').textContent)
      .toContain('at least 2 characters');
    expect(calls.filter((c) => c.path.includes('/colleges/search'))).toHaveLength(0);
  });

  it('says a school is not in the registry rather than offering a near miss', async () => {
    stubFetch({ search: [] });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Hogwarts');

    const panel = container.querySelector('[data-testid="specific-search"]');
    expect(panel.textContent).toMatch(/No active .*programme in the registry matches/);
    expect(panel.textContent).toContain('Nothing is added on a guess');
    expect(buttonWith('Add to Specific Schools')).toBeUndefined();
  });

  it('reports an inactive programme in the server’s own terms', async () => {
    stubFetch({
      search: [STANFORD_ROW],
      onUpsert: () => fail(422, { error: 'Stanford is not an active mens-soccer programme...', code: 'COLLEGE_INACTIVE' }),
    });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Stanford');
    await click(buttonWith('Add to Specific Schools'));

    expect(container.querySelector('[data-testid="specific-search"]').textContent)
      .toContain('not currently active');
  });

  it('reports a backend failure rather than looking like nothing happened', async () => {
    stubFetch({
      search: [STANFORD_ROW],
      onUpsert: () => fail(500, { error: 'Unexpected error.' }),
    });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Stanford');
    await click(buttonWith('Add to Specific Schools'));

    expect(container.querySelector('[data-testid="specific-search"]').textContent)
      .toContain('Unexpected error.');
  });
});

describe('removing a specific school', () => {
  it('withdraws the request and sends nothing else', async () => {
    stubFetch({ programmes: [relationship()] });
    await render();
    await click(tab('Specific Schools'));
    await click(buttonWith('Remove'));

    const patch = relationshipCalls('PATCH')[0];
    expect(patch.body).toEqual({ request_state: 'withdrawn' });
    // Only the request state. The flag, the note, the contact stance and the
    // visibility are not this button's business and are not named.
    expect(patch.body).not.toHaveProperty('flagged');
    expect(patch.body).not.toHaveProperty('contact_stance');
    expect(patch.body).not.toHaveProperty('visibility');
    expect(patch.body).not.toHaveProperty('note');
  });

  it('never deletes the relationship row', async () => {
    stubFetch({ programmes: [relationship()] });
    await render();
    await click(tab('Specific Schools'));
    await click(buttonWith('Remove'));

    // The row carries a flag, a note and a contact stance that have nothing to
    // do with the request. A DELETE would take all of them with it.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('drops it out of the list while the relationship survives', async () => {
    const flagged = relationship({ flagged: true, flag_reason: 'sister plays there' });
    stubFetch({
      programmes: [flagged],
      onPatch: () => ok({ programme: { ...flagged, request_state: 'withdrawn' } }),
    });
    await render();
    await click(tab('Specific Schools'));
    await click(buttonWith('Remove'));

    expect(container.querySelectorAll('[data-testid="specific-school-row"]')).toHaveLength(0);
    expect(text()).toContain('No specific schools yet');
    // Still one row in the hook's state, still flagged — it is simply no
    // longer a request.
    expect(tab('Specific Schools').textContent).not.toContain('(1)');
  });
});

describe('what a specific request must never touch', () => {
  it('leaves the ranked recommendations exactly as they were', async () => {
    stubFetch({ search: [STANFORD_ROW] });
    await render();
    const before = JSON.stringify(RECOMMENDATIONS);

    await click(buttonWith('Specific Search'));
    await type('Stanford');
    await click(buttonWith('Add to Specific Schools'));

    // Not appended, not reordered, not re-scored. Nothing writes to the stored
    // analysis from this screen.
    expect(JSON.stringify(RECOMMENDATIONS)).toBe(before);
    expect(RECOMMENDATIONS).toHaveLength(3);
  });

  it('writes to no analysis, reserve or campaign endpoint', async () => {
    stubFetch({ search: [STANFORD_ROW] });
    await render();
    await click(buttonWith('Specific Search'));
    await type('Stanford');
    await click(buttonWith('Add to Specific Schools'));
    await click(tab('Specific Schools'));
    await click(buttonWith('Remove'));

    /**
     * `/matching-summary` is excluded because it is not a write: it is the
     * existing recruiting-signals READ, which happens to be a POST because it
     * carries a list of programme names too long for a query string. It
     * predates this PR and is untouched by it.
     */
    const writes = calls.filter((c) => c.method !== 'GET' && !c.path.includes('/matching-summary'));
    expect(writes.length).toBeGreaterThan(0);
    for (const c of writes) {
      expect(c.path, `${c.method} ${c.path} must not be a campaign or analysis write`)
        .toMatch(/\/api\/players\/athlete-1\/programmes/);
    }
    // Named explicitly, because these are the things this PR promised not to
    // disturb.
    expect(calls.some((c) => c.path.includes('/campaigns'))).toBe(false);
    expect(calls.some((c) => c.path.includes('/uploads'))).toBe(false);
    expect(calls.some((c) => c.path.includes('/entities/players'))).toBe(false);
    expect(JSON.stringify(calls)).not.toContain('reserve');
    expect(JSON.stringify(calls)).not.toContain('recommendations');
  });
});
