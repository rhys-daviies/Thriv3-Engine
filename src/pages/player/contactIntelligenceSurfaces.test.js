// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import { RELATIONSHIP_OUTREACH } from '@/lib/outreachLabels';
import { ZERO } from '@/lib/__fixtures__/recruitingSignals.js';

/**
 * EXISTING-CONTACT INTELLIGENCE ON THE SURFACES THAT ALREADY SHOW PROGRAMMES.
 *
 * Two properties carry the weight. THE REQUEST COUNT IS BOUNDED — one call per
 * athlete however many cards are on screen, because a per-card endpoint would
 * make the count a function of how the page paginates. And SHOWING HISTORY
 * CREATES NOTHING — a recommendation nobody has flagged can display that it
 * was emailed last week without a relationship row being written to say so.
 */

const ATHLETE = 'athlete-1';

const college = (n, name) => ({
  id: `col-${n}`, name, division: 'NCAA D1', match_score: 200 - n,
  coaching_staff: [{ name: 'A Coach', title: 'Head Coach', email: `a@${name.toLowerCase()}.test` }],
  breakdown: [{ key: 'roster', label: 'Roster opportunity', weight: 0.2, score: 0.5, contribution: 10, confidence: 'measured' }],
});

/** Thirty, so a per-card request pattern would be obvious in the call log. */
const NAMES = Array.from({ length: 30 }, (_, i) => `Programme${i + 1}`);
const RECOMMENDATIONS = NAMES.map((n, i) => college(i + 1, n));

const summary = (over = {}) => ({
  college_name: 'Programme1',
  sport: 'mens-soccer',
  contacted: true,
  has_confirmed_send: true,
  draft_only: false,
  confirmed_send_count: 2,
  coach_count: 1,
  last_confirmed_send_at: '2026-09-04T11:00:00.000Z',
  last_drafted_at: '2026-09-04T10:00:00.000Z',
  revoked_count: 0,
  origins: ['manual'],
  engagement: {
    profile_visits: 3,
    last_visit_at: '2026-09-06T09:00:00.000Z',
    best_coverage_pct: 74,
    reply_recorded: false,
    reply_recorded_at: null,
  },
  last_activity_at: '2026-09-06T09:00:00.000Z',
  last_activity_kind: 'profile_visit',
  coaches: [],
  ...over,
});

const relationship = (over = {}) => ({
  id: 'rel-1', athlete_id: ATHLETE, college_name: 'Programme1', sport: 'mens-soccer',
  college_id: 'col-1', request_state: 'none', flagged: false, flag_reason: null,
  visibility: 'default', contact_stance: 'default', note: null,
  division: 'NCAA D1', conference: 'ACC', ...over,
});

let container;
let root;
let calls;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

function stubFetch({ programmes = [], intelligence = [] } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (path.includes('/contact-intelligence')) return ok({ programmes: intelligence });
    if (/\/programmes\/[^/]+\/outreach/.test(path)) {
      return ok({
        relationship: programmes[0] ?? relationship(),
        college: { id: 'col-1', name: 'Programme1', sport: 'mens-soccer', division: 'NCAA D1' },
        coaches: [{ coach_id: 'coach-1', name: 'A Coach', email: 'a@p1.test', title: 'Head Coach', email_status: null }],
        contact: { allowed: true, stance: 'default', reason: null },
        priorContact: [],
        contactIntelligence: intelligence[0] ?? null,
      });
    }
    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/colleges/search')) return ok({ results: [] });
    if (path.includes('/programmes')) return ok({ programmes });
    if (path.includes('/evidence')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, { sentences: [], offers: [] }])));
    }
    if (path.includes('/coaches/email-status')) return ok({});
    return ok({});
  }));
}

function Shell({ recommendations }) {
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer', full_name: 'Test Athlete' });
  const [page, setPage] = useState(1);
  const workspace = useActionableRecommendations({ playerId: player.id, recommendations, reserve: [] });
  return createElement(Outlet, {
    context: {
      player, setPlayer: () => {}, recommendations, reserve: [], summary: '',
      ...workspace, analyzing: false, phase: 0,
      progress: { current: 0, total: 0, school: '' },
      page, setPage, onAnalyze: async () => {},
    },
  });
}

async function render(recommendations = RECOMMENDATIONS) {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: [`/player/${ATHLETE}/matching`] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell, { recommendations }) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTab) }))),
    ));
  });
}

const body = () => document.body.textContent;
const summaries = () => Array.from(container.querySelectorAll('[data-testid="contact-summary"]'));
const intelCalls = () => calls.filter((c) => c.path.includes('/contact-intelligence'));
const buttonsIn = (el) => Array.from(el.querySelectorAll('button'));
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const tab = (label) => Array.from(container.querySelectorAll('[role="tab"]'))
  .find((t) => t.textContent.includes(label));

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

describe('THE REQUEST COUNT IS BOUNDED', () => {
  it('asks once for the whole athlete, not once per card', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();

    // Twenty cards on screen out of thirty programmes. Exactly one request.
    expect(summaries().length).toBeGreaterThan(0);
    expect(intelCalls()).toHaveLength(1);
    expect(intelCalls()[0].path).toBe(`/api/players/${ATHLETE}/contact-intelligence`);
  });

  it('does not ask again when the page changes', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();
    const pager = buttonsIn(container).find((b) => b.textContent.trim() === '2');
    if (pager) await click(pager);
    // The count must not be a function of how the page paginates.
    expect(intelCalls()).toHaveLength(1);
  });

  it('does not ask again when the view changes', async () => {
    stubFetch({ programmes: [relationship({ request_state: 'requested' })], intelligence: [summary()] });
    await render();
    await click(tab('Specific Schools'));
    expect(intelCalls()).toHaveLength(1);
  });
});

describe('showing history creates nothing', () => {
  it('renders prior contact on a card with NO relationship', async () => {
    stubFetch({ programmes: [], intelligence: [summary()] });
    await render();

    // The point of D: a recommendation nobody has flagged still shows it was
    // emailed, and no row is written to say so.
    expect(summaries().length).toBe(1);
    expect(body()).toMatch(/Sent 2x/);
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/programmes'))).toBe(false);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('renders nothing at all for a programme with no history', async () => {
    stubFetch({ intelligence: [] });
    await render();
    // A map miss is the answer. "Not contacted" on twenty cards would be
    // twenty assertions of the same non-fact.
    expect(summaries()).toHaveLength(0);
  });
});

describe('what it says, and what it refuses to say', () => {
  it('reports a confirmed send and a profile visit as different facts', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();
    expect(body()).toMatch(/Sent 2x/);
    expect(body()).toMatch(/Opened profile 3x/);
  });

  it('never says opened or clicked about an email', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();
    // There is no pixel and no email click tracking in this product.
    const shown = summaries().map((s) => s.textContent).join(' ');
    expect(shown).not.toMatch(/email opened|opened email|clicked link|click/i);
  });

  it('says drafted, not sent, when nothing was confirmed', async () => {
    stubFetch({
      intelligence: [summary({
        has_confirmed_send: false, draft_only: true, confirmed_send_count: 0,
        last_confirmed_send_at: null, last_activity_kind: 'draft',
        engagement: { profile_visits: 0, last_visit_at: null, best_coverage_pct: 0, reply_recorded: false, reply_recorded_at: null },
      })],
    });
    await render();
    const shown = summaries()[0].textContent;
    expect(shown).toMatch(/Drafted/);
    expect(shown).not.toMatch(/Sent/);
  });

  it('claims no reply unless one was recorded', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();
    expect(summaries()[0].textContent).not.toMatch(/Reply/);
  });

  it('shows a recorded reply when there is one', async () => {
    stubFetch({
      intelligence: [summary({
        last_activity_kind: 'reply',
        engagement: { profile_visits: 1, last_visit_at: '2026-09-06T09:00:00.000Z', best_coverage_pct: 40, reply_recorded: true, reply_recorded_at: '2026-09-08T12:00:00.000Z' },
      })],
    });
    await render();
    expect(summaries()[0].textContent).toMatch(/Reply recorded/);
  });

  it('reports a revoked link without hiding the send', async () => {
    stubFetch({ intelligence: [summary({ revoked_count: 1 })] });
    await render();
    const shown = summaries()[0].textContent;
    expect(shown).toMatch(/Link revoked/);
    expect(shown).toMatch(/Sent/);
  });
});

describe('contact history and relationship state stay separate', () => {
  it('does not flag a programme that was merely contacted', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();
    // A sent email is not a relationship, and nothing here creates one.
    expect(body()).not.toContain('Existing relationship');
    expect(calls.some((c) => c.method !== 'GET' && c.path.includes('/programmes'))).toBe(false);
  });

  it('shows a flag on a programme nobody has contacted', async () => {
    stubFetch({
      programmes: [relationship({ flagged: true, flag_reason: 'knows the coach' })],
      intelligence: [],
    });
    await render();
    // Flagged without outreach is a perfectly ordinary state.
    expect(body()).toContain('Existing relationship');
    expect(summaries()).toHaveLength(0);
  });

  it('shows both when both are true, as separate signals', async () => {
    stubFetch({
      programmes: [relationship({ flagged: true, flag_reason: 'knows the coach' })],
      intelligence: [summary()],
    });
    await render();
    expect(body()).toContain('Existing relationship');
    expect(summaries()).toHaveLength(1);
    expect(body()).toMatch(/Sent 2x/);
  });
});

describe('the relationship surfaces show it too', () => {
  it('appears on a Specific Schools row', async () => {
    stubFetch({
      programmes: [relationship({ request_state: 'requested' })],
      intelligence: [summary()],
    });
    await render();
    await click(tab('Specific Schools'));
    const row = container.querySelector('[data-testid="specific-school-row"]');
    expect(row.querySelector('[data-testid="contact-summary"]')).toBeTruthy();
  });

  it('appears in the removed-programmes panel', async () => {
    stubFetch({
      programmes: [relationship({ visibility: 'suppressed', flagged: true, flag_reason: 'x' })],
      intelligence: [summary()],
    });
    await render();
    await click(buttonsIn(container).find((b) => b.textContent.includes('Removed from this athlete')));
    const list = container.querySelector('[data-testid="suppressed-list"]');
    expect(list.querySelector('[data-testid="contact-summary"]')).toBeTruthy();
  });

  it('reaches the relationship dialog without a second athlete-level fetch', async () => {
    stubFetch({
      programmes: [relationship({ flagged: true, flag_reason: 'x' })],
      intelligence: [summary()],
    });
    await render();
    await click(buttonsIn(document.body).find((b) => b.textContent.includes(RELATIONSHIP_OUTREACH)));

    // The dialog's own payload carries the summary for its one programme, so
    // opening it costs one relationship request and no second athlete sweep.
    expect(intelCalls()).toHaveLength(1);
    expect(body()).toMatch(/Opened profile/);
  });
});

describe('a failed intelligence load', () => {
  it('degrades to showing no history rather than wrong history', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      calls.push({ path, method: opts.method || 'GET' });
      if (path.includes('/contact-intelligence')) {
        return { ok: false, status: 500, headers: { get: () => 'application/json' }, text: async () => '{}' };
      }
      if (path.includes('/programmes')) return ok({ programmes: [] });
      if (path.includes('/matching-summary')) return ok({});
      return ok({});
    }));
    await render();
    // The safe direction for a summary nobody should act on blindly.
    expect(summaries()).toHaveLength(0);
    expect(body()).not.toMatch(/Sent 2x/);
  });
});
