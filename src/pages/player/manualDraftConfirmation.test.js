// @vitest-environment jsdom
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import EmailComposer from '@/components/EmailComposer';
import { ZERO } from '@/lib/__fixtures__/recruitingSignals.js';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import {
  MARK_AS_SENT, MARK_AS_SENT_HINT, DISCARD_DRAFT, AWAITING_CONFIRMATION,
  MANUAL_ONLY_BADGE, NO_CONTACT_RECORDED,
} from '@/lib/outreachLabels';

/**
 * F7b — THRIV3 DRAFTS, A PERSON SENDS, A PERSON SAYS SO.
 *
 * ===========================================================================
 * TWO PROPERTIES, ON SCREEN.
 *
 *   SPECIFIC SEARCH CANNOT ASK THRIV3 TO SEND. The control is absent — not
 *   disabled — and the payload always carries `send: false`. The server refuses
 *   `send: true` regardless, so this is the courtesy rather than the guarantee.
 *
 *   THE CONFIRMATION IS AN ASSERTION, AND IT IS VISIBLE. Outlook hands back no
 *   message id, so nothing can be observed. What makes that workable is that
 *   "Mark as sent" sits on the screen the operator is already looking at,
 *   rather than in a terminal command they will never run.
 * ===========================================================================
 */

const ATHLETE = 'athlete-1';
const SPORT = 'mens-soccer';

const RECOMMENDATIONS = [
  { name: 'Duke', division: 'NCAA D1', match_score: 88, coaching_staff: [] },
  { name: 'Stanford', division: 'NCAA D1', match_score: 84, coaching_staff: [] },
];

const relationship = (over = {}) => ({
  id: 'rel-1',
  athlete_id: ATHLETE,
  college_name: 'Stanford',
  sport: SPORT,
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
  city: null,
  state: null,
  college_active: 1,
  ...over,
});

const draft = (over = {}) => ({
  send_id: 'send-1',
  outreach_id: 'o-1',
  college_name: 'Stanford',
  sport: SPORT,
  coach_id: 'coach-1',
  coach_name: 'Ada Vela',
  position_title: 'Head Coach',
  subject: 'Subject',
  drafted_at: '2026-09-12T00:00:00.000Z',
  state: 'DRAFT',
  origin: 'manual',
  ...over,
});

const engagement = () => ({
  profile_visits: 0, last_visit_at: null, best_coverage_pct: 0,
  reply_recorded: false, reply_recorded_at: null,
});

const summary = (over = {}) => ({
  college_name: 'Stanford', sport: SPORT, contacted: true,
  has_confirmed_send: true, draft_only: false, confirmed_send_count: 1, coach_count: 1,
  last_confirmed_send_at: '2026-09-13T00:00:00.000Z', last_drafted_at: null, revoked_count: 0,
  origins: ['manual'], engagement: engagement(),
  last_activity_at: '2026-09-13T00:00:00.000Z', last_activity_kind: 'confirmed_send',
  coaches: [{
    coach_id: 'coach-1', coach_name: 'Ada Vela', position_title: 'Head Coach',
    has_confirmed_send: true, confirmed_send_count: 1,
    last_confirmed_send_at: '2026-09-13T00:00:00.000Z', last_drafted_at: null,
    revoked_at: null, origins: ['manual'], engagement: engagement(),
  }],
  ...over,
});

let container;
let root;
let calls;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});
const failed = (status, payload) => ({
  ok: false, status, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

/**
 * The server, as a function. `stage` lets a test describe the world BEFORE a
 * confirmation and AFTER it, so a refetch can be observed rather than assumed.
 */
function stubFetch({ programmes = [], contact = [], drafts = [], after = null } = {}) {
  let phase = { contact, drafts };
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/pending-manual-drafts')) return ok({ drafts: phase.drafts });
    if (path.includes('/contact-intelligence')) return ok({ programmes: phase.contact });
    if (path.includes('/colleges/search')) return ok({ results: [] });
    if (path.includes('/confirm-sent') || path.includes('/discard')) {
      if (after) phase = after;
      return ok({ send: { state: 'ACCEPTED' } });
    }
    if (path.includes('/programmes') && method === 'GET') return ok({ programmes });
    if (path.includes('/programmes')) return ok({ programme: programmes[0] });
    return failed(404, { error: `unstubbed ${method} ${path}` });
  }));
}

function Shell({ recommendations }) {
  const [player] = useState({ id: ATHLETE, sport: SPORT });
  const [page, setPage] = useState(1);
  const workspace = useActionableRecommendations({
    playerId: player.id, recommendations, reserve: [],
  });
  return createElement(Outlet, {
    context: {
      player, setPlayer: () => {}, recommendations, reserve: [], summary: '',
      ...workspace, analyzing: false, phase: 0,
      progress: { current: 0, total: 0, school: '' },
      page, setPage, onAnalyze: async () => {},
    },
  });
}

async function render() {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: ['/player/athlete-1/matching'] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell, { recommendations: RECOMMENDATIONS }) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTab) }))),
    ));
  });
}

const tab = (label) => Array.from(container.querySelectorAll('[role="tab"]'))
  .find((t) => t.textContent.includes(label));
const buttonWith = (label, scope = container) => Array.from(scope.querySelectorAll('button'))
  .find((b) => b.textContent.trim().startsWith(label));
const rowEl = () => container.querySelector('[data-testid="specific-school-row"]');
async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

async function open(opts) {
  stubFetch(opts);
  await render();
  await click(tab('Specific Schools'));
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

/* ========================================================================== */

describe('the composer on this surface cannot ask Thriv3 to send', () => {
  const composer = (props = {}) => createElement(EmailComposer, {
    open: true,
    onOpenChange: () => {},
    player: { id: ATHLETE, full_name: 'A Athlete', sport: SPORT },
    college: { name: 'Stanford', division: 'NCAA D1', coaching_staff: [{ name: 'Ada Vela', email: 'ada@stanford.test', title: 'Head Coach' }] },
    ...props,
  });

  async function mount(props) {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, composer(props)));
    });
  }

  it('offers no Send immediately control when the surface disallows it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({})));
    await mount({ allowImmediateSend: false });

    expect(document.body.textContent).not.toContain('Send immediately');
    expect(buttonWith('Open', document.body)).toBeTruthy();
    expect(buttonWith('Send ', document.body)).toBeFalsy();
  });

  /**
   * THE DEFAULT PROTECTS THE OTHER TWO SURFACES. This component is shared with
   * the Top 100 match cards and the bulk composer, and neither asked to lose a
   * capability — so the prop defaults to true and they are unchanged.
   */
  it('keeps the control for every consumer that has not opted out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({})));
    await mount({});

    expect(document.body.textContent).toContain('Send immediately');
  });
});

describe('a draft waiting for a person', () => {
  it('says so, and offers both honest answers', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      drafts: [draft()],
    });

    const row = rowEl();
    expect(row.textContent).toContain(AWAITING_CONFIRMATION);
    expect(row.textContent).toContain('Ada Vela');
    expect(buttonWith(MARK_AS_SENT, row)).toBeTruthy();
    expect(buttonWith(DISCARD_DRAFT, row)).toBeTruthy();
  });

  /**
   * NEVER "verified", "detected" or "delivered". Thriv3 has no evidence a send
   * happened — this records what the operator says.
   */
  it('words the action as an assertion', async () => {
    await open({ programmes: [relationship()], contact: [], drafts: [draft()] });

    expect(rowEl().textContent).toContain(MARK_AS_SENT_HINT);
    expect(MARK_AS_SENT_HINT).toMatch(/Confirm that you sent this email from Outlook/);
    expect(rowEl().textContent).not.toMatch(/verified|detected|delivered/i);
  });

  it('shows nothing pending where nothing is pending', async () => {
    await open({ programmes: [relationship()], contact: [], drafts: [] });

    expect(container.querySelector('[data-testid="pending-drafts"]')).toBeNull();
    expect(rowEl().textContent).toContain(NO_CONTACT_RECORDED);
  });
});

describe('marking it sent', () => {
  const confirmedWorld = {
    contact: [summary()],
    drafts: [],
  };

  it('posts the exact message id to the confirmation route', async () => {
    await open({
      programmes: [relationship()], contact: [], drafts: [draft()], after: confirmedWorld,
    });

    await click(buttonWith(MARK_AS_SENT, rowEl()));

    const post = calls.find((c) => c.path.includes('/confirm-sent'));
    expect(post.method).toBe('POST');
    expect(post.path).toContain('/programmes/rel-1/outreach/send-1/confirm-sent');
  });

  it('refetches, so the row and its history agree afterwards', async () => {
    await open({
      programmes: [relationship({ contact_stance: 'manual_only' })],
      contact: [], drafts: [draft()], after: confirmedWorld,
    });

    await click(buttonWith(MARK_AS_SENT, rowEl()));

    const row = rowEl();
    // The pending action is gone and the history has taken its place.
    expect(container.querySelector('[data-testid="pending-drafts"]')).toBeNull();
    expect(row.textContent).toContain('Sent');
    expect(row.textContent).not.toContain(NO_CONTACT_RECORDED);
  });

  it('shows the coach as contacted and the school as manual-only', async () => {
    await open({
      programmes: [relationship({ contact_stance: 'manual_only' })],
      contact: [], drafts: [draft()], after: confirmedWorld,
    });

    await click(buttonWith(MARK_AS_SENT, rowEl()));

    const row = rowEl();
    expect(row.textContent).toContain(MANUAL_ONLY_BADGE);
    expect(container.querySelector('[data-testid="contacted-coaches"]').textContent)
      .toContain('Ada Vela');
  });
});

describe('discarding it', () => {
  it('posts to the discard route with the same message id', async () => {
    await open({
      programmes: [relationship()], contact: [], drafts: [draft()],
      after: { contact: [], drafts: [] },
    });

    await click(buttonWith(DISCARD_DRAFT, rowEl()));

    const post = calls.find((c) => c.path.includes('/discard'));
    expect(post.method).toBe('POST');
    expect(post.path).toContain('/outreach/send-1/discard');
  });

  /**
   * A DISCARDED DRAFT IS NOT CONTACT. The pending action goes and the row
   * returns to saying nothing was ever recorded — which is the truth.
   */
  it('loses the pending action and is not shown as contacted', async () => {
    await open({
      programmes: [relationship()], contact: [], drafts: [draft()],
      after: { contact: [], drafts: [] },
    });

    await click(buttonWith(DISCARD_DRAFT, rowEl()));

    const row = rowEl();
    expect(container.querySelector('[data-testid="pending-drafts"]')).toBeNull();
    expect(row.textContent).toContain(NO_CONTACT_RECORDED);
    expect(row.textContent).not.toContain('Sent');
    expect(container.querySelector('[data-testid="contacted-coaches"]')).toBeNull();
  });
});

describe('the page stays bounded', () => {
  it('asks once for the pending drafts, whatever the list length', async () => {
    await open({
      programmes: [
        relationship(),
        relationship({ id: 'rel-2', college_name: 'Duke', college_id: 'col-duke' }),
        relationship({ id: 'rel-3', college_name: 'Elon', college_id: 'col-elon' }),
      ],
      contact: [],
      drafts: [draft(), draft({ send_id: 'send-2', college_name: 'Duke' })],
    });

    expect(container.querySelectorAll('[data-testid="specific-school-row"]')).toHaveLength(3);
    expect(calls.filter((c) => c.path.includes('/pending-manual-drafts'))).toHaveLength(1);
    expect(calls.filter((c) => c.path.includes('/contact-intelligence'))).toHaveLength(1);
  });

  it('puts each draft on its own programme', async () => {
    await open({
      programmes: [
        relationship(),
        relationship({ id: 'rel-2', college_name: 'Duke', college_id: 'col-duke' }),
      ],
      contact: [],
      drafts: [draft({ send_id: 'send-2', college_name: 'Duke', coach_name: 'Bo Ruiz' })],
    });

    const rows = Array.from(container.querySelectorAll('[data-testid="specific-school-row"]'));
    const duke = rows.find((r) => r.textContent.includes('Duke'));
    const stanford = rows.find((r) => r.textContent.includes('Stanford'));
    expect(duke.textContent).toContain('Bo Ruiz');
    expect(stanford.textContent).not.toContain(AWAITING_CONFIRMATION);
  });
});

describe('Outlook, and only Outlook', () => {
  it('names no other mail client anywhere in this workflow copy', async () => {
    await open({ programmes: [relationship()], contact: [], drafts: [draft()] });

    const text = container.textContent;
    expect(text).not.toMatch(/Apple Mail|Gmail|Outlook\/Mail/);
    expect(MARK_AS_SENT_HINT).toContain('Outlook');
  });
});
