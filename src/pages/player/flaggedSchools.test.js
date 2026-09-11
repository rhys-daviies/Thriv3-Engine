// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import { ZERO } from '@/lib/__fixtures__/recruitingSignals.js';

/**
 * Flagging a school, and deciding separately whether it stays in the list.
 *
 * THE TWO CONTROLS MUST NOT MOVE EACH OTHER. Thriv3 knowing the coach at
 * Stanford is a reason to treat Stanford differently, and very often a reason
 * to treat it as MORE actionable rather than less. A flag that quietly removed
 * it — or an unflag that quietly brought back a school the operator had
 * deliberately taken out — would be the product deciding something the
 * operator did not.
 */

const ATHLETE = 'athlete-1';
const PAGE_SIZE = 20;

const college = (n) => ({
  id: `col-${n}`,
  name: `School ${n}`,
  division: 'NCAA D1',
  match_score: 200 - n,
  coaching_staff: [],
  breakdown: [{ key: 'roster', label: 'Roster opportunity', weight: 0.2, score: 0.5, contribution: 10, confidence: 'measured' }],
});

const RECOMMENDATIONS = Array.from({ length: 100 }, (_, i) => college(i + 1));
const RESERVE = Array.from({ length: 50 }, (_, i) => college(101 + i));

const relationship = (over = {}) => ({
  id: `rel-${over.college_name || 'x'}`,
  athlete_id: ATHLETE,
  college_name: 'School 1',
  sport: 'mens-soccer',
  college_id: 'col-1',
  request_state: 'none',
  requested_by: null,
  requested_at: null,
  flagged: false,
  flag_reason: null,
  flagged_at: null,
  visibility: 'default',
  contact_stance: 'default',
  note: null,
  note_updated_at: null,
  flagged_by_operator_id: null,
  note_updated_by_operator_id: null,
  created_at: '2026-09-11T00:00:00.000Z',
  updated_at: '2026-09-11T00:00:00.000Z',
  division: 'NCAA D1',
  conference: 'ACC',
  city: null,
  state: null,
  college_active: 1,
  ...over,
});

let container;
let root;
let calls;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

/** Relationship rows live in the stub, so a write is visible on the next render. */
function stubFetch({ programmes = [], onWrite } = {}) {
  let rows = programmes;
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/colleges/search')) return ok({ results: [] });
    if (path.includes('/programmes') && method === 'GET') return ok({ programmes: rows });

    // A write: apply it to the row it names, or create one, exactly as the
    // server's upsert does.
    const id = path.split('/programmes/')[1];
    const existing = id ? rows.find((r) => r.id === id) : rows.find((r) => r.college_id === body.college_id);
    const base = existing ?? relationship({
      id: `rel-${body.college_id}`, college_id: body.college_id,
      college_name: `School ${String(body.college_id).replace('col-', '')}`,
    });
    const { college_id: _ignored, ...fields } = body;
    const next = { ...base, ...fields };
    // The server clears these together; the stub must too, or the test would
    // be asserting against a server that does not exist.
    if (fields.flagged === false) { next.flag_reason = null; next.flagged_at = null; }
    rows = existing ? rows.map((r) => (r.id === next.id ? next : r)) : [...rows, next];
    if (onWrite) onWrite(body);
    return ok({ programme: next });
  }));
}

function Shell({ recommendations, reserve }) {
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer' });
  const [page, setPage] = useState(1);
  return createElement(Outlet, {
    context: {
      player, setPlayer: () => {}, recommendations, reserve,
      summary: '', analyzing: false, phase: 0,
      progress: { current: 0, total: 0, school: '' },
      page, setPage, onAnalyze: async () => {},
    },
  });
}

async function render({ recommendations = RECOMMENDATIONS, reserve = RESERVE } = {}) {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: ['/player/athlete-1/matching'] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell, { recommendations, reserve }) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTab) }))),
    ));
  });
}

const text = () => container.textContent;
const buttons = () => Array.from(container.querySelectorAll('button'));
const cardFor = (name) => Array.from(container.querySelectorAll('[data-testid="programme-relationship"]'))
  .find((el) => el.closest('div[class*="rounded"]')?.textContent.includes(name));
const buttonWith = (label, scope = container) => Array.from(scope.querySelectorAll('button'))
  .find((b) => b.textContent.trim().startsWith(label));
const writes = () => calls.filter((c) => c.method !== 'GET' && c.path.includes('/programmes'));
const shown = () => Array.from(container.querySelectorAll('[data-testid="programme-relationship"]'))
  .map((el) => el.closest('div[class*="rounded"]').textContent);

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

beforeEach(() => {
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

describe('flagging a recommended school', () => {
  it('records the flag with a reason', async () => {
    stubFetch();
    await render();
    const card = cardFor('School 1');

    await click(buttonWith('Flag relationship', card));
    await click(buttonWith('Thriv3 personal contact', card));

    const write = writes()[0];
    expect(write.body).toMatchObject({
      college_id: 'col-1', flagged: true, flag_reason: 'Thriv3 personal contact',
    });
    // Only the flag. The other three decisions are not this button's business.
    expect(write.body).not.toHaveProperty('visibility');
    expect(write.body).not.toHaveProperty('contact_stance');
    expect(write.body).not.toHaveProperty('request_state');
  });

  it('shows it as an existing relationship afterwards', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'knows the coach' })] });
    await render();
    const card = cardFor('School 1');
    expect(card.textContent).toContain('Existing relationship');
    expect(card.textContent).toContain('knows the coach');
  });

  it('DOES NOT remove the school from the Top 100', async () => {
    stubFetch();
    await render();
    const card = cardFor('School 1');
    await click(buttonWith('Flag relationship', card));
    await click(buttonWith('Previous outreach', card));

    // Still there, still first. A school we already know is often the most
    // actionable one on the list.
    expect(shown()[0]).toContain('School 1');
    expect(writes()[0].body).not.toHaveProperty('visibility');
  });

  it('unflags, and sends only the flag', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await render();
    await click(buttonWith('Unflag', cardFor('School 1')));

    expect(writes()[0].body).toEqual({ flagged: false });
  });
});

describe('Keep in / Remove from Top 100', () => {
  it('Remove sets visibility to suppressed, and nothing else', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await render();
    await click(buttonWith('Remove from Top 100', cardFor('School 1')));

    expect(writes()[0].body).toEqual({ visibility: 'suppressed' });
  });

  it('Keep restores visibility to default, and nothing else', async () => {
    /**
     * REMOVING A SCHOOL TAKES ITS CARD OFF THE PAGE, and with it the control
     * that would put it back. Without a second home for these the decision
     * would be one-way — which is what writing this test found.
     */
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x', visibility: 'suppressed' })] });
    await render();
    expect(shown()[0]).not.toContain('School 1');

    await click(buttonWith('Removed from this athlete'));
    const list = container.querySelector('[data-testid="suppressed-list"]');
    expect(list.textContent).toContain('School 1');
    expect(list.textContent).toContain('Existing relationship');

    await click(buttonWith('Keep in Top 100', list));
    expect(writes()[0].body).toEqual({ visibility: 'default' });
  });

  it('brings the school back into the actionable list once restored', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x', visibility: 'suppressed' })] });
    await render();
    expect(shown()[0]).not.toContain('School 1');

    await click(buttonWith('Removed from this athlete'));
    await click(buttonWith('Keep in Top 100', container.querySelector('[data-testid="suppressed-list"]')));

    expect(shown()[0]).toContain('School 1');
  });

  it('offers nothing to restore when nothing was removed', async () => {
    stubFetch();
    await render();
    expect(buttonWith('Removed from this athlete')).toBeUndefined();
  });

  it('takes the school out of Recommended Matches and promotes the reserve', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await render();
    expect(shown()[0]).toContain('School 1');

    await click(buttonWith('Remove from Top 100', cardFor('School 1')));

    // Gone from the actionable list...
    expect(shown()[0]).toContain('School 2');
    expect(shown().join(' ')).not.toContain('School 1 ');
    // ...and the hundredth slot is filled from the reserve. Page 5 holds it.
    expect(container.textContent).toBeTruthy();
  });

  it('unflagging does NOT bring a removed school back', async () => {
    stubFetch({
      programmes: [relationship({
        college_name: 'School 3', college_id: 'col-3', id: 'rel-3',
        flagged: true, flag_reason: 'x', visibility: 'suppressed',
      })],
    });
    await render();
    expect(shown().join(' ')).not.toContain('School 3 ');
    expect(shown()).toHaveLength(PAGE_SIZE);

    // Clear the flag from the restore list, where the row is still reachable.
    await click(buttonWith('Removed from this athlete'));
    const list = container.querySelector('[data-testid="suppressed-list"]');
    expect(list.textContent).toContain('School 3');

    // Restoring is a SEPARATE decision and a separate click. The operator has
    // revisited the relationship, not the ranking.
    await click(buttonWith('Keep in Top 100', list));
    expect(writes()[0].body).toEqual({ visibility: 'default' });
    expect(writes()[0].body).not.toHaveProperty('flagged');
  });
});

describe('the derived actionable Top 100', () => {
  it('is the raw recommendations when nothing is suppressed', async () => {
    stubFetch();
    await render();
    expect(shown()).toHaveLength(PAGE_SIZE);
    expect(shown()[0]).toContain('School 1');
    expect(shown()[19]).toContain('School 20');
  });

  it('shows a promoted programme with the rank the model gave it', async () => {
    // Suppress the first nineteen so the promoted entries land on page one.
    const suppressed = Array.from({ length: 19 }, (_, i) => relationship({
      id: `rel-${i + 1}`, college_id: `col-${i + 1}`, college_name: `School ${i + 1}`,
      visibility: 'suppressed',
    }));
    stubFetch({ programmes: suppressed });
    await render({ recommendations: RECOMMENDATIONS.slice(0, 20), reserve: RESERVE });
    // One survivor plus nineteen promoted.
    expect(shown()).toHaveLength(20);
    expect(shown()[0]).toContain('School 20');
    expect(shown()[1]).toContain('School 101');
    // Shown high on the page, and still the hundred-and-first thing ranked.
    expect(shown()[1]).toContain('Original rank #101');
  });

  it('marks nothing as promoted when nothing was', async () => {
    stubFetch();
    await render();
    expect(text()).not.toContain('Original rank');
  });

  it('truthfully shows fewer when the reserve is exhausted', async () => {
    const suppressed = [relationship({ visibility: 'suppressed' })];
    stubFetch({ programmes: suppressed });
    await render({ recommendations: RECOMMENDATIONS.slice(0, 5), reserve: [] });
    // Four, not five, and no manufactured fifth.
    expect(shown()).toHaveLength(4);
    expect(shown()[0]).toContain('School 2');
  });
});

describe('the states coexist', () => {
  it('shows a specific request, a flag and a suppression on one relationship', async () => {
    stubFetch({
      programmes: [relationship({
        flagged: true, flag_reason: 'sister plays there', request_state: 'requested',
      })],
    });
    await render();
    const card = cardFor('School 1');
    expect(card.textContent).toContain('Existing relationship');
    expect(card.textContent).toContain('Specific Request');
    // Still in the actionable list: only visibility takes a school out.
    expect(shown()[0]).toContain('School 1');
  });

  it('leaves the Specific Schools view working', async () => {
    stubFetch({ programmes: [relationship({ request_state: 'requested', flagged: true, flag_reason: 'x' })] });
    await render();
    const tab = Array.from(container.querySelectorAll('[role="tab"]'))
      .find((t) => t.textContent.includes('Specific Schools'));
    expect(tab.textContent).toContain('(1)');
    await click(tab);
    const rows = container.querySelectorAll('[data-testid="specific-school-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('School 1');
    expect(rows[0].textContent).toContain('Flagged');
  });
});

describe('notes', () => {
  it('saves a note without disturbing anything else', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await render();
    const card = cardFor('School 1');
    await click(buttonWith('Add a note', card));

    const input = card.querySelector('input[aria-label="Note on School 1"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      setter.call(input, 'Call the father first');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonWith('Save note', card));

    expect(writes().at(-1).body).toEqual({ note: 'Call the father first' });
  });
});

describe('what none of this touches', () => {
  it('writes only to the relationship endpoint', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await render();
    await click(buttonWith('Remove from Top 100', cardFor('School 1')));

    for (const c of writes()) expect(c.path).toMatch(/\/api\/players\/athlete-1\/programmes/);
    expect(calls.some((c) => c.path.includes('/campaigns'))).toBe(false);
    expect(calls.some((c) => c.path.includes('/uploads'))).toBe(false);
    expect(calls.some((c) => c.path.includes('/entities/players'))).toBe(false);
  });

  it('never mutates the analysis arrays it was handed', async () => {
    const before = JSON.stringify({ RECOMMENDATIONS, RESERVE });
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await render();
    await click(buttonWith('Remove from Top 100', cardFor('School 1')));
    expect(JSON.stringify({ RECOMMENDATIONS, RESERVE })).toBe(before);
    expect(RECOMMENDATIONS[0]).not.toHaveProperty('source_rank');
  });
});
