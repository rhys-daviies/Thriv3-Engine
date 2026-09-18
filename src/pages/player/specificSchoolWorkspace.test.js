// @vitest-environment jsdom
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import { ZERO } from '@/lib/__fixtures__/recruitingSignals.js';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import {
  CREATE_EMAIL_DRAFT, RECOMMENDATION_OUTREACH,
  NO_CONTACT_RECORDED, MANUAL_ONLY_BADGE, CAMPAIGN_MAY_CONTACT, DO_NOT_CONTACT_BADGE,
  AWAITING_CONFIRMATION, MARK_AS_SENT, DISCARD_DRAFT, ALREADY_IN_TOUCH,
  PENDING_UNAVAILABLE_NOTICE, EXISTING_RELATIONSHIP, ALREADY_IN_TOUCH_FLAG_REASON,
  draftAge, contactStateShort,
} from '@/lib/outreachLabels';

/**
 * F8b — THE SPECIFIC SCHOOL WORKSPACE.
 *
 * ===========================================================================
 * THREE PROPERTIES, IN PRIORITY ORDER.
 *
 *   AN OUTSTANDING ACTION IS VISIBLE TO THE PERSON WHO CREATED IT. F7b built
 *   the confirmation and then never showed it in the session that produced the
 *   draft, because closing the composer refetched nothing. That is the
 *   forgotten-confirmation failure arriving through the front door.
 *
 *   UNKNOWN IS STILL NOT NONE. A pending read that failed must never render as
 *   a workspace with nothing outstanding, and a compact row is a smaller
 *   surface rather than a licence to assert an absence nobody established.
 *
 *   NOTHING IS RANKED, INFERRED OR SCORED. Only a pending draft promotes a
 *   school, because it is the only state here that names an action by a
 *   person. A reply is a fact; a policy is not a priority; coach order is the
 *   payload's and stays that way.
 * ===========================================================================
 */

const ATHLETE = 'athlete-1';
const SPORT = 'mens-soccer';

const STAFF = [{ name: 'Ada Vela', email: 'ada@x.test', title: 'Head Coach' }];
const RECOMMENDATIONS = [
  { name: 'Duke', division: 'NCAA D1', match_score: 88, coaching_staff: STAFF },
  { name: 'Stanford', division: 'NCAA D1', match_score: 84, coaching_staff: STAFF },
];

const relationship = (over = {}) => ({
  id: 'rel-stanford',
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
  city: 'Stanford',
  state: 'CA',
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

const engagement = (over = {}) => ({
  profile_visits: 0, last_visit_at: null, best_coverage_pct: 0,
  reply_recorded: false, reply_recorded_at: null, ...over,
});

const coach = (over = {}) => ({
  coach_id: 'coach-1', coach_name: 'Ada Vela', position_title: 'Head Coach',
  has_confirmed_send: true, confirmed_send_count: 1,
  last_confirmed_send_at: '2026-09-13T00:00:00.000Z', last_drafted_at: null,
  revoked_at: null, origins: ['manual'], engagement: engagement(), ...over,
});

const summary = (over = {}) => ({
  college_name: 'Stanford', sport: SPORT, contacted: true,
  has_confirmed_send: true, draft_only: false, confirmed_send_count: 1, coach_count: 1,
  last_confirmed_send_at: '2026-09-13T00:00:00.000Z', last_drafted_at: null, revoked_count: 0,
  origins: ['manual'], engagement: engagement(),
  last_activity_at: '2026-09-13T00:00:00.000Z', last_activity_kind: 'confirmed_send',
  coaches: [coach()],
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
 * The server, as a function.
 *
 * `after` lets a test describe the world BEFORE an action and AFTER it, so a
 * refetch can be OBSERVED rather than assumed — which is the whole point of
 * the first two tests in this file.
 */
function stubFetch({
  programmes = [], contact = [], drafts = [], after = null,
  pendingStatus = 200, actionStatus = 200, actionBody = null,
} = {}) {
  let phase = { contact, drafts };
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/pending-manual-drafts')) {
      return pendingStatus === 200
        ? ok({ drafts: phase.drafts })
        : failed(pendingStatus, { error: 'pending unavailable' });
    }
    if (path.includes('/contact-intelligence')) return ok({ programmes: phase.contact });
    if (path.includes('/colleges/search')) return ok({ results: [] });
    if (path.includes('/confirm-sent') || path.includes('/discard')) {
      if (actionStatus !== 200) return failed(actionStatus, actionBody ?? { error: 'nope' });
      if (after) phase = after;
      return ok({ send: { state: 'ACCEPTED' } });
    }
    if (path.includes('/outreach') && method === 'GET') {
      /*
        The dialog has opened. `after` describes the world the operator
        returns to — a draft now exists — exactly as it does when they compose
        one inside it. What the test then observes is whether CLOSING the
        dialog makes the page ask again.
      */
      if (after) phase = after;
      return ok({
        relationship: programmes[0],
        college: { id: 'col-stanford', name: 'Stanford' },
        coaches: [],
        contact: { allowed: true },
        priorContact: [],
        contactIntelligence: null,
      });
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
const rows = () => Array.from(container.querySelectorAll('[data-testid="specific-school-row"]'));
const row = (name = 'Stanford') => rows().find((r) => r.textContent.includes(name));
const names = () => rows().map((r) => r.querySelector('[data-testid="school-name"]').textContent);
const buttonIn = (scope, label) => Array.from(scope.querySelectorAll('button'))
  .find((b) => b.textContent.trim().startsWith(label));

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
async function type(input, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function open(opts) {
  stubFetch(opts);
  await render();
  await click(tab('Specific Schools'));
}
async function expand(name = 'Stanford') {
  await click(buttonIn(row(name), 'Details'));
}
async function openExpanded(opts, name = 'Stanford') {
  await open(opts);
  await expand(name);
}

const pathCalls = (fragment) => calls.filter((c) => c.path.includes(fragment));
/**
 * Every write to a relationship, and ONLY those. `/matching-summary` is also a
 * POST, so filtering on the method alone picks up the page's own read and
 * makes a write assertion pass or fail for the wrong reason.
 */
const relationshipWrites = () => calls
  .filter((c) => (c.method === 'PATCH' || c.method === 'POST')
    && /\/players\/[^/]+\/programmes/.test(c.path))
  .map((c) => c.body);

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
/*  1. CORRECTNESS                                                            */
/* ========================================================================== */

describe('the draft the operator just made', () => {
  /**
   * THE BUG F8a FOUND, AND THE REASON PHASE 1 CAME FIRST.
   *
   * Thriv3 opens the draft, the operator sends it in Outlook and comes back —
   * and before F8b the row they came back to showed no pending draft and no
   * "Drafted" badge, because `usePendingManualDrafts` had not been asked
   * again. The obligation appeared on the next page load, to somebody who by
   * then had no reason to look for it.
   */
  it('appears without a reload once the composer closes', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      drafts: [],
      after: {
        drafts: [draft()],
        contact: [summary({
          has_confirmed_send: false, draft_only: true, confirmed_send_count: 0,
          last_confirmed_send_at: null, last_drafted_at: '2026-09-12T00:00:00.000Z',
          last_activity_kind: 'draft', last_activity_at: '2026-09-12T00:00:00.000Z',
          coaches: [coach({ has_confirmed_send: false, confirmed_send_count: 0, last_confirmed_send_at: null })],
        })],
      },
    });

    // Nothing outstanding yet.
    expect(row().textContent).not.toContain(AWAITING_CONFIRMATION);

    await click(buttonIn(row(), CREATE_EMAIL_DRAFT));
    // The composer's own close. The world moved while it was open.
    await act(async () => {
      const closer = Array.from(document.body.querySelectorAll('button'))
        .find((b) => b.textContent.trim() === 'Close');
      closer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(row().textContent).toContain(AWAITING_CONFIRMATION);
    expect(buttonIn(row(), MARK_AS_SENT)).toBeTruthy();
    expect(buttonIn(row(), DISCARD_DRAFT)).toBeTruthy();
  });

  /**
   * BOTH BOUNDED READS, because a confirmation changes what is pending AND
   * what the history says, and a screen showing one without the other would be
   * disagreeing with itself about whether a coach was written to.
   */
  it('refreshes the contact state at the same moment', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      drafts: [],
      after: {
        drafts: [draft()],
        contact: [summary({
          has_confirmed_send: false, draft_only: true, confirmed_send_count: 0,
          last_confirmed_send_at: null, last_drafted_at: '2026-09-12T00:00:00.000Z',
          last_activity_kind: 'draft', last_activity_at: '2026-09-12T00:00:00.000Z',
          coaches: [coach({ has_confirmed_send: false, confirmed_send_count: 0, last_confirmed_send_at: null })],
        })],
      },
    });

    expect(row().textContent).toContain(NO_CONTACT_RECORDED);

    await click(buttonIn(row(), CREATE_EMAIL_DRAFT));
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((b) => b.textContent.trim() === 'Close')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(row().querySelector('[data-testid="contact-state"]').textContent).toBe('Drafted');
    expect(row().textContent).not.toContain(NO_CONTACT_RECORDED);
  });
});

describe('a pending read that failed', () => {
  /**
   * THE WORST FALSE STATEMENT THIS SCREEN CAN MAKE.
   *
   * An empty pending map renders as a workspace with nothing outstanding,
   * which is exactly the screen an operator reads before concluding they owe
   * nobody a confirmation. `usePendingManualDrafts` has always computed
   * `failed` for this; until F8b the only caller dropped it.
   */
  it('says so, and offers a retry', async () => {
    await open({ programmes: [relationship()], contact: [], pendingStatus: 500 });

    const notice = container.querySelector('[data-testid="pending-unavailable"]');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain(PENDING_UNAVAILABLE_NOTICE);

    const before = pathCalls('/pending-manual-drafts').length;
    await click(buttonIn(notice, 'Try again'));
    expect(pathCalls('/pending-manual-drafts').length).toBeGreaterThan(before);
  });

  it('never presents the workspace as having nothing outstanding', async () => {
    await open({ programmes: [relationship()], contact: [], pendingStatus: 500 });

    // No section claiming zero, no tab count claiming zero, and no row
    // claiming its drafts are accounted for.
    expect(container.querySelector('[data-testid="awaiting-section"]')).toBeNull();
    expect(container.querySelector('[data-testid="tab-awaiting"]')).toBeNull();
    expect(container.textContent).not.toContain('0 awaiting');
    expect(container.textContent).not.toContain('Awaiting your confirmation (0)');
    // And the page says which of the two situations it is in.
    expect(container.querySelector('[data-testid="pending-unavailable"]')).toBeTruthy();
  });
});

describe('a confirmation that did not save', () => {
  /**
   * NOTHING IS REMOVED BEFORE THE SERVER AGREES. On this screen the pending
   * row IS the outstanding obligation; taking it away on a failed request
   * would tell the operator the one thing that must never be told falsely
   * here — that a message is accounted for when it is not.
   */
  it('is visible, and leaves the draft exactly where it was', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      drafts: [draft()],
      actionStatus: 409,
      actionBody: { code: 'NOT_AWAITING_CONFIRMATION', error: 'That message is not awaiting confirmation.' },
    });

    await click(buttonIn(row(), MARK_AS_SENT));

    const error = row().querySelector('[data-testid="draft-action-error"]');
    expect(error).toBeTruthy();
    expect(error.textContent).toContain('not awaiting confirmation');
    // Still pending, still offering both answers.
    expect(row().textContent).toContain(AWAITING_CONFIRMATION);
    expect(buttonIn(row(), MARK_AS_SENT)).toBeTruthy();
    expect(buttonIn(row(), DISCARD_DRAFT)).toBeTruthy();
  });

  it('is visible for a discard too, and changes nothing', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      drafts: [draft()],
      actionStatus: 500,
      actionBody: { error: 'server exploded' },
    });

    await click(buttonIn(row(), DISCARD_DRAFT));

    expect(row().querySelector('[data-testid="draft-action-error"]')).toBeTruthy();
    expect(row().textContent).toContain(AWAITING_CONFIRMATION);
  });

  it('clears the pending row and both bounded reads on success', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      drafts: [draft()],
      after: { drafts: [], contact: [summary()] },
    });

    const pendingBefore = pathCalls('/pending-manual-drafts').length;
    const contactBefore = pathCalls('/contact-intelligence').length;
    await click(buttonIn(row(), MARK_AS_SENT));

    expect(row().textContent).not.toContain(AWAITING_CONFIRMATION);
    expect(row().querySelector('[data-testid="draft-action-error"]')).toBeNull();
    expect(pathCalls('/pending-manual-drafts').length).toBeGreaterThan(pendingBefore);
    expect(pathCalls('/contact-intelligence').length).toBeGreaterThan(contactBefore);
  });
});

/* ========================================================================== */
/*  2. OUTSTANDING ACTIONS                                                    */
/* ========================================================================== */

describe('what is awaiting a person', () => {
  const THREE = [
    relationship({ id: 'r-zurich', college_name: 'Zurich', college_id: 'c-z' }),
    relationship({ id: 'r-akron', college_name: 'Akron', college_id: 'c-a' }),
    relationship({ id: 'r-marist', college_name: 'Marist', college_id: 'c-m' }),
  ];

  it('gathers the programmes with pending drafts into their own section', async () => {
    await open({
      programmes: THREE,
      contact: [],
      drafts: [draft({ send_id: 's-z', college_name: 'Zurich' })],
    });

    const section = container.querySelector('[data-testid="awaiting-section"]');
    expect(section).toBeTruthy();
    expect(section.textContent).toContain('Awaiting your confirmation (1)');
    expect(section.textContent).toContain('Zurich');
    expect(section.textContent).not.toContain('Akron');
  });

  /**
   * OLDEST FIRST, because a draft from last week is the one most likely to
   * have been forgotten. The AGE orders the section; nothing else does.
   */
  it('puts the oldest waiting draft first', async () => {
    await open({
      programmes: THREE,
      contact: [],
      drafts: [
        draft({ send_id: 's-z', college_name: 'Zurich', drafted_at: '2026-09-15T00:00:00.000Z' }),
        draft({ send_id: 's-a', college_name: 'Akron', drafted_at: '2026-09-02T00:00:00.000Z' }),
      ],
    });

    const section = container.querySelector('[data-testid="awaiting-section"]');
    const order = Array.from(section.querySelectorAll('[data-testid="specific-school-row"]'))
      .map((r) => r.querySelector('[data-testid="school-name"]').textContent);
    expect(order).toEqual(['Akron', 'Zurich']);
  });

  it('leaves everything else alphabetical below it', async () => {
    await open({
      programmes: THREE,
      contact: [],
      drafts: [draft({ send_id: 's-z', college_name: 'Zurich' })],
    });

    // Zurich is promoted; the untouched two keep plain alphabetical order.
    expect(names()).toEqual(['Zurich', 'Akron', 'Marist']);
  });

  /**
   * NOTHING ELSE PROMOTES A SCHOOL. A reply is a fact and not a task; a
   * contact policy is a rule and not a priority. Sorting by either would turn
   * this list into a work queue nobody asked it to be, using judgement that
   * belongs to Email Intelligence.
   */
  it('does not promote a reply, a stance or a suppression', async () => {
    await open({
      programmes: [
        relationship({ id: 'r-z', college_name: 'Zurich', college_id: 'c-z', contact_stance: 'do_not_contact' }),
        relationship({ id: 'r-a', college_name: 'Akron', college_id: 'c-a', visibility: 'suppressed' }),
        relationship({ id: 'r-m', college_name: 'Marist', college_id: 'c-m', contact_stance: 'manual_only' }),
      ],
      contact: [summary({
        college_name: 'Zurich',
        engagement: engagement({ reply_recorded: true, reply_recorded_at: '2026-09-14T00:00:00.000Z' }),
      })],
      drafts: [],
    });

    expect(container.querySelector('[data-testid="awaiting-section"]')).toBeNull();
    expect(names()).toEqual(['Akron', 'Marist', 'Zurich']);
  });

  it('orders identically across renders', async () => {
    await open({
      programmes: THREE,
      contact: [],
      drafts: [
        draft({ send_id: 's-z', college_name: 'Zurich', drafted_at: '2026-09-15T00:00:00.000Z' }),
        draft({ send_id: 's-a', college_name: 'Akron', drafted_at: '2026-09-02T00:00:00.000Z' }),
      ],
    });

    const first = names();
    // Switching away and back re-renders the whole view from the same data.
    await click(tab('Recommended Matches'));
    await click(tab('Specific Schools'));
    expect(names()).toEqual(first);
    expect(first).toEqual(['Akron', 'Zurich', 'Marist']);
  });

  /** Ties are broken by name, so two drafts made in the same second cannot flip. */
  it('breaks a tie deterministically by name', async () => {
    await open({
      programmes: THREE,
      contact: [],
      drafts: [
        draft({ send_id: 's-z', college_name: 'Zurich', drafted_at: '2026-09-02T00:00:00.000Z' }),
        draft({ send_id: 's-m', college_name: 'Marist', drafted_at: '2026-09-02T00:00:00.000Z' }),
      ],
    });

    expect(names()).toEqual(['Marist', 'Zurich', 'Akron']);
  });
});

describe('the tab', () => {
  it('keeps the school count and adds the pending count', async () => {
    await open({
      programmes: [
        relationship(),
        relationship({ id: 'r2', college_name: 'Akron', college_id: 'c-a', city: 'Akron', state: 'OH' }),
      ],
      contact: [],
      drafts: [draft()],
    });

    const t = tab('Specific Schools');
    expect(t.textContent).toContain('(2)');
    expect(t.querySelector('[data-testid="tab-awaiting"]').textContent).toContain('1 awaiting');
  });

  /** A standing reminder of an obligation nobody has is one nobody reads. */
  it('says nothing about awaiting when nothing is', async () => {
    await open({ programmes: [relationship()], contact: [], drafts: [] });

    const t = tab('Specific Schools');
    expect(t.textContent).toContain('(1)');
    expect(t.querySelector('[data-testid="tab-awaiting"]')).toBeNull();
    expect(t.textContent).not.toContain('awaiting');
  });
});

describe('how long a draft has been waiting', () => {
  it('is stated on the pending row', async () => {
    const at = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    await open({
      programmes: [relationship()], contact: [], drafts: [draft({ drafted_at: at })],
    });

    expect(row().querySelector('[data-testid="pending-drafts"]').textContent)
      .toContain('Drafted 4 days ago');
  });

  /**
   * AGE, NOT URGENCY. The wording at nine days is as flat as at nine minutes.
   * Thriv3 does not know whether the message was sent, so it cannot know that
   * anything is wrong — and an interface that escalates about a fact it has
   * not established teaches operators to dismiss it.
   */
  it('never escalates, whatever the age', () => {
    const now = Date.parse('2026-09-18T12:00:00.000Z');
    expect(draftAge('2026-09-18T11:59:30.000Z', now)).toBe('Drafted just now');
    expect(draftAge('2026-09-18T11:30:00.000Z', now)).toBe('Drafted 30 min ago');
    expect(draftAge('2026-09-18T09:00:00.000Z', now)).toBe('Drafted 3 hours ago');
    expect(draftAge('2026-09-17T09:00:00.000Z', now)).toBe('Drafted yesterday');
    expect(draftAge('2026-09-09T12:00:00.000Z', now)).toBe('Drafted 9 days ago');
    for (const iso of ['2026-09-18T11:30:00.000Z', '2026-09-09T12:00:00.000Z', '2026-06-01T12:00:00.000Z']) {
      expect(draftAge(iso, now)).not.toMatch(/overdue|urgent|still|!|late|chase/i);
    }
    // No timestamp is not a guess.
    expect(draftAge(null, now)).toBeNull();
  });
});

/* ========================================================================== */
/*  3. THE COLLAPSED GLANCE                                                   */
/* ========================================================================== */

describe('the collapsed row', () => {
  it('stays compact — no badge wall, no stack of context lines', async () => {
    await open({
      programmes: [relationship({
        flagged: true, flag_reason: 'Her father is an alum', note: 'Visited in March',
        visibility: 'suppressed', contact_stance: 'manual_only',
      })],
      contact: [summary({
        confirmed_send_count: 3, origins: ['manual', 'campaign', null], revoked_count: 2,
        engagement: engagement({
          profile_visits: 4, best_coverage_pct: 80,
          reply_recorded: true, reply_recorded_at: '2026-09-14T00:00:00.000Z',
        }),
      })],
    });

    // Before F8b this exact row carried eleven badges across two strips.
    expect(row().querySelectorAll('span[class*="rounded-full"]').length).toBeLessThanOrEqual(4);
    // The context that made it ten lines tall is in the expansion now.
    expect(row().textContent).not.toContain('Her father is an alum');
    expect(row().textContent).not.toContain('Visited in March');
    expect(row().textContent).not.toContain('Also ranked');
  });

  it('answers what, which policy and what happened', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({ confirmed_send_count: 3 })],
    });

    const text = row().textContent;
    expect(text).toContain('Stanford');
    expect(text).toContain('NCAA D1');
    expect(text).toContain(CAMPAIGN_MAY_CONTACT);
    expect(row().querySelector('[data-testid="contact-state"]').textContent).toBe('Sent ×3');
  });
});

describe('UNKNOWN IS NOT NONE, in the compressed form too', () => {
  it('says "No contact recorded" once the history has arrived', async () => {
    await open({ programmes: [relationship()], contact: [] });
    expect(row().querySelector('[data-testid="contact-state"]').textContent)
      .toBe(NO_CONTACT_RECORDED);
  });

  /**
   * THE ONE FALSE STATEMENT THE COMPRESSION COULD HAVE MADE. A failed
   * athlete-level read empties the map for exactly the same reason a programme
   * nobody has written to is absent from it.
   */
  it('withholds it entirely when the history could not be loaded', async () => {
    stubFetch({ programmes: [relationship()] });
    // Contact intelligence alone fails; everything else answers.
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ path, method, body });
      if (path.includes('/matching-summary')) {
        return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
      }
      if (path.includes('/contact-intelligence')) return failed(500, { error: 'no' });
      if (path.includes('/pending-manual-drafts')) return ok({ drafts: [] });
      if (path.includes('/programmes') && method === 'GET') return ok({ programmes: [relationship()] });
      return failed(404, { error: path });
    }));
    await render();
    await click(tab('Specific Schools'));

    expect(row().querySelector('[data-testid="contact-state"]')).toBeNull();
    expect(row().textContent).not.toContain(NO_CONTACT_RECORDED);
  });

  /** The helper itself refuses to answer until the answer is known. */
  it('is refused by the formatter before the read settles', () => {
    expect(contactStateShort(undefined, false)).toBeNull();
    expect(contactStateShort(undefined, true)).toBe(NO_CONTACT_RECORDED);
  });
});

describe('contact policy is stated, never inferred from an absence', () => {
  const stanceRow = async (contact_stance) => {
    await open({ programmes: [relationship({ contact_stance })], contact: [] });
    return row().textContent;
  };

  it('names the permissive state out loud', async () => {
    const text = await stanceRow('default');
    expect(text).toContain(CAMPAIGN_MAY_CONTACT);
    expect(text).not.toContain(MANUAL_ONLY_BADGE);
    expect(text).not.toContain(DO_NOT_CONTACT_BADGE);
  });

  it('names manual_only and only manual_only', async () => {
    const text = await stanceRow('manual_only');
    expect(text).toContain(MANUAL_ONLY_BADGE);
    expect(text).not.toContain(CAMPAIGN_MAY_CONTACT);
    expect(text).not.toContain(DO_NOT_CONTACT_BADGE);
    // Both halves, still. The badge alone reads as a closure.
    expect(text).toContain('You can still contact it manually');
  });

  it('names do_not_contact and only do_not_contact', async () => {
    const text = await stanceRow('do_not_contact');
    expect(text).toContain(DO_NOT_CONTACT_BADGE);
    expect(text).not.toContain(CAMPAIGN_MAY_CONTACT);
    expect(text).not.toContain(MANUAL_ONLY_BADGE);
  });
});

/* ========================================================================== */
/*  4. THE EXPANSION                                                          */
/* ========================================================================== */

describe('the operator note', () => {
  it('can be written from this workspace, where before it could not', async () => {
    await openExpanded({ programmes: [relationship()], contact: [] });

    await click(buttonIn(row(), 'Add a note'));
    await type(row().querySelector('input'), 'Called the assistant on Tuesday');
    await click(buttonIn(row(), 'Save note'));

    expect(relationshipWrites()).toEqual([{ note: 'Called the assistant on Tuesday' }]);
  });
});

describe('why this school matters', () => {
  /**
   * `flag_reason` IS WRITTEN THROUGH THE EXISTING FLAG MUTATION, TRUTHFULLY.
   * A reason without a flag would be a sentence about a relationship the row
   * does not claim to have. No second storage mechanism, no new column.
   */
  it('can be recorded, and travels with the flag it belongs to', async () => {
    await openExpanded({ programmes: [relationship()], contact: [] });

    await click(buttonIn(row(), 'Add a reason'));
    await type(row().querySelector('input'), 'Her father is an alum');
    await click(buttonIn(row(), 'Save reason'));

    expect(relationshipWrites()).toEqual([{ flagged: true, flag_reason: 'Her father is an alum' }]);
  });

  it('is kept apart from the note, which is a different job', async () => {
    await openExpanded({
      programmes: [relationship({
        flagged: true, flag_reason: 'Her father is an alum', note: 'Visited in March',
      })],
      contact: [],
    });

    const reason = row().querySelector('[data-testid="flag-reason-field"]');
    const note = row().querySelector('[data-testid="note-field"]');
    expect(reason.textContent).toContain('Her father is an alum');
    expect(reason.textContent).not.toContain('Visited in March');
    expect(note.textContent).toContain('Visited in March');
    expect(note.textContent).not.toContain('Her father is an alum');
  });

  /**
   * F5b's RULE SURVIVES. "We've already been in touch" installs its generic
   * reason only where none exists — "Her father is an alum" is context
   * somebody took the trouble to record and is strictly more informative.
   */
  it('is never overwritten by the existing-contact control', async () => {
    await openExpanded({
      programmes: [relationship({ flagged: true, flag_reason: 'Her father is an alum' })],
      contact: [],
    });

    await click(buttonIn(row(), ALREADY_IN_TOUCH));

    const writes = relationshipWrites();
    expect(writes.some((w) => w.contact_stance === 'manual_only')).toBe(true);
    expect(writes.some((w) => w.flag_reason === ALREADY_IN_TOUCH_FLAG_REASON)).toBe(false);
  });
});

describe('the Top 100 decision', () => {
  it('can be made from here', async () => {
    await openExpanded({ programmes: [relationship()], contact: [] });

    await click(buttonIn(row(), 'Remove from Top 100'));
    expect(relationshipWrites()).toEqual([{ visibility: 'suppressed' }]);
  });

  it('can be reversed from here', async () => {
    await openExpanded({ programmes: [relationship({ visibility: 'suppressed' })], contact: [] });

    await click(buttonIn(row(), 'Keep in Top 100'));
    expect(relationshipWrites()).toEqual([{ visibility: 'default' }]);
  });

  /**
   * TWO INDEPENDENT CONCEPTS. A school taken out of the ranked hundred is very
   * often the one somebody asked for by name; it stays in this list, keeps its
   * drafting control, and says why it is absent from the other view.
   */
  it('does not take the school out of Specific Schools', async () => {
    await open({ programmes: [relationship({ visibility: 'suppressed' })], contact: [] });

    expect(rows()).toHaveLength(1);
    expect(row().textContent).toContain('Not in Top 100');
    expect(buttonIn(row(), CREATE_EMAIL_DRAFT)).toBeTruthy();
  });
});

describe('the destructive control', () => {
  it('lives in the expansion, not on the scanned row', async () => {
    await open({ programmes: [relationship()], contact: [] });
    expect(buttonIn(row(), 'Remove')).toBeFalsy();

    await expand();
    expect(buttonIn(row(), 'Remove')).toBeTruthy();
  });
});

/* ========================================================================== */
/*  5. COACHES, ENGAGEMENT, WORDING                                           */
/* ========================================================================== */

describe('the coaches we actually wrote to', () => {
  const THREE_COACHES = summary({
    coach_count: 3,
    coaches: [
      coach({ coach_id: 'c1', coach_name: 'Zoe Adler', position_title: 'Head Coach' }),
      coach({ coach_id: 'c2', coach_name: 'Ada Vela', position_title: 'Assistant Coach' }),
      coach({ coach_id: 'c3', coach_name: 'Ben Oduya', position_title: 'Goalkeeping Coach' }),
    ],
  });

  it('names every one of them in the expansion, not only behind "+N more"', async () => {
    await openExpanded({ programmes: [relationship()], contact: [THREE_COACHES] });

    const detail = row().querySelector('[data-testid="contacted-coach-detail"]');
    expect(detail.textContent).toContain('Zoe Adler');
    expect(detail.textContent).toContain('Ada Vela');
    expect(detail.textContent).toContain('Ben Oduya');
  });

  /**
   * THE PAYLOAD'S ORDER, AND NOTHING RE-SORTS IT — including alphabetically,
   * which F8a proposed and F8b deliberately reversed. A sort order an operator
   * can name is a claim about which coach matters, even when the claim is
   * "none". That judgement belongs to Email Intelligence.
   */
  it('preserves the order it was given, collapsed and expanded alike', async () => {
    await open({ programmes: [relationship()], contact: [THREE_COACHES] });

    const collapsed = container.querySelector('[data-testid="contacted-coaches"]').textContent;
    expect(collapsed.indexOf('Zoe Adler')).toBeLessThan(collapsed.indexOf('Ada Vela'));

    await expand();
    const detail = row().querySelector('[data-testid="contacted-coach-detail"]').textContent;
    expect(detail.indexOf('Zoe Adler')).toBeLessThan(detail.indexOf('Ada Vela'));
    expect(detail.indexOf('Ada Vela')).toBeLessThan(detail.indexOf('Ben Oduya'));
  });

  it('ranks nobody and recommends nobody', async () => {
    await openExpanded({ programmes: [relationship()], contact: [THREE_COACHES] });

    const detail = row().querySelector('[data-testid="contacted-coach-detail"]').textContent;
    expect(detail).not.toMatch(/best|top|priority|recommend|most likely|try |score|rank/i);
    // No numbering either — an ordered list is an ordering claim.
    expect(row().querySelector('[data-testid="contacted-coach-detail"] ol')).toBeNull();
  });
});

describe('engagement', () => {
  it('shows one badge at the glance and the detail in the expansion', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({
        engagement: engagement({
          profile_visits: 3, last_visit_at: '2026-09-14T00:00:00.000Z',
          best_coverage_pct: 74, reply_recorded: true, reply_recorded_at: '2026-09-15T00:00:00.000Z',
        }),
      })],
    });

    // Strongest thing on file, and only that.
    expect(row().textContent).toContain('Reply recorded');
    expect(row().textContent).not.toContain('of the video');
    expect(row().textContent).not.toContain('Profile visit recorded 3x');

    await expand();
    const detail = row().querySelector('[data-testid="engagement-detail"]').textContent;
    expect(detail).toContain('Profile visit recorded 3x');
    expect(detail).toContain('Watched 74% of the video');
    expect(detail).toContain('Reply recorded');
  });

  it('falls back to a visit where there is no reply, and to nothing where there is neither', async () => {
    await open({
      programmes: [
        relationship(),
        relationship({ id: 'r2', college_name: 'Akron', college_id: 'c-a', city: 'Akron', state: 'OH' }),
      ],
      contact: [
        summary({ engagement: engagement({ profile_visits: 1 }) }),
        summary({ college_name: 'Akron' }),
      ],
    });

    expect(row('Stanford').textContent).toContain('Profile visit');
    expect(row('Akron').textContent).not.toContain('Profile visit');
  });

  it('claims no open, click, delivery or bounce anywhere', async () => {
    await openExpanded({
      programmes: [relationship()],
      contact: [summary({
        engagement: engagement({ profile_visits: 2, best_coverage_pct: 90, reply_recorded: true }),
      })],
    });

    expect(row().textContent).not.toMatch(/opened|clicked|delivered|bounced|verified/i);
  });
});

describe('the wording of the two actions that are not the same action', () => {
  it('names the drafting action for what it produces', async () => {
    await open({ programmes: [relationship()], contact: [] });

    expect(buttonIn(row(), CREATE_EMAIL_DRAFT)).toBeTruthy();
    expect(row().textContent).not.toContain('Relationship Outreach');
    expect(CREATE_EMAIL_DRAFT).toBe('Create email draft');
  });

  /**
   * ONE CONSTANT, AND AFTER F8c ONE NAME FOR IT.
   *
   * F8b kept `RELATIONSHIP_OUTREACH` as an alias because the dialog that
   * imported it was off-limits to that slice; F8c removed the alias and
   * renamed every call site. Asserted against the SOURCE rather than by
   * comparing two exported values, because the failure this guards against is
   * a surface reaching for the old identifier or hard-coding the old wording —
   * neither of which a value comparison can see.
   */
  it('names the action identically on every surface that offers it', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = process.cwd();
    const surfaces = [
      'src/components/SpecificSchools.jsx',        // the workspace row
      'src/components/ProgrammeRelationship.jsx',  // the match-card footer
      'src/components/SuppressedProgrammes.jsx',   // removed from the Top 100
      'src/components/ManualOutreachDialog.jsx',   // the dialog it opens
    ];
    for (const f of surfaces) {
      const source = fs.readFileSync(path.join(root, f), 'utf8');
      expect(source).toContain('CREATE_EMAIL_DRAFT');
      expect(source).not.toContain('RELATIONSHIP_OUTREACH');
      expect(source).not.toContain('Relationship Outreach');
    }
    // The alias is gone, and the two actions are still different actions.
    const labels = fs.readFileSync(path.join(root, 'src/lib/outreachLabels.js'), 'utf8');
    expect(labels).not.toContain('export const RELATIONSHIP_OUTREACH');
    expect(RECOMMENDATION_OUTREACH).not.toBe(CREATE_EMAIL_DRAFT);
  });

  /**
   * THE TOP 100 CARD CARRIES BOTH, AND THEY MUST STAY TELLABLE APART: one
   * composes from a ranking and can send; the other composes from what is on
   * record and cannot.
   */
  it('keeps the match card able to distinguish the two', async () => {
    await open({ programmes: [relationship()], contact: [] });
    await click(tab('Recommended Matches'));
    // "Email Coaches" lives in the expanded body of the card; the relationship
    // footer carrying the renamed action is beneath it either way.
    const stanfordCard = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Stanford'));
    await click(stanfordCard);

    const text = container.textContent;
    expect(text).toContain(RECOMMENDATION_OUTREACH);
    expect(text).toContain(CREATE_EMAIL_DRAFT);
    // Two different actions, two different names, on one card.
    expect(RECOMMENDATION_OUTREACH).toBe('Email Coaches');
  });

  /**
   * "We've already been in touch" ASSERTS A RELATIONSHIP; "Mark as sent"
   * ASSERTS THAT ONE DRAFTED MESSAGE LEFT THE MACHINE. They are one row apart
   * and must never read as each other.
   */
  it('keeps the relationship assertion distinct from the message assertion', async () => {
    await openExpanded({ programmes: [relationship()], contact: [], drafts: [draft()] });

    const inTouch = buttonIn(row(), ALREADY_IN_TOUCH);
    expect(inTouch).toBeTruthy();
    expect(inTouch.getAttribute('title')).toContain('stops automated Campaign outreach');
    expect(inTouch.textContent).not.toContain(MARK_AS_SENT);
    // And the explanation is readable without a hover.
    expect(row().querySelector('[data-testid="already-in-touch-hint"]').textContent)
      .toContain('Manual outreach is still allowed');

    const markSent = buttonIn(row(), MARK_AS_SENT);
    expect(markSent).toBeTruthy();
    expect(markSent.getAttribute('title')).toBe('Confirm that you sent this email from Outlook.');
  });
});

describe('the relationship fact has one name', () => {
  it('reads the same here as on every other surface', async () => {
    await openExpanded({
      programmes: [relationship({ flagged: true, flag_reason: 'Her father is an alum' })],
      contact: [],
    });

    expect(row().textContent).toContain(EXISTING_RELATIONSHIP);
    expect(row().textContent).not.toContain('Flagged');
  });
});

/* ========================================================================== */
/*  6. THE REQUEST BUDGET                                                     */
/* ========================================================================== */

describe('the page asks the same three questions however many schools there are', () => {
  it('adds no request per card, and none for expanding one', async () => {
    await open({
      programmes: [
        relationship({ id: 'r1', college_name: 'Akron', college_id: 'c-a' }),
        relationship({ id: 'r2', college_name: 'Marist', college_id: 'c-m' }),
        relationship({ id: 'r3', college_name: 'Zurich', college_id: 'c-z' }),
      ],
      contact: [],
      drafts: [draft({ college_name: 'Zurich' })],
    });

    expect(rows()).toHaveLength(3);
    expect(pathCalls('/contact-intelligence')).toHaveLength(1);
    expect(pathCalls('/pending-manual-drafts')).toHaveLength(1);
    expect(calls.filter((c) => /\/players\/[^/]+\/programmes($|\?)/.test(c.path))).toHaveLength(1);

    const before = calls.length;
    await expand('Akron');
    await expand('Marist');
    expect(calls.length).toBe(before);
  });
});
