// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import { RELATIONSHIP_OUTREACH, CONTACT_UNAVAILABLE_NOTICE } from '@/lib/outreachLabels';
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
const occurrences = (haystack, needle) => haystack.split(needle).length - 1;
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
    expect(body()).toMatch(/Profile visit recorded 3x/);
  });

  it('never claims an email was opened or a link clicked', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();
    // There is no pixel and no email click tracking in this product.
    const shown = summaries().map((s) => s.textContent).join(' ');
    expect(shown).not.toMatch(/email opened|opened email|clicked link|click/i);
  });

  it('never says the COACH opened or viewed anything', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();
    const shown = document.body.textContent;
    /**
     * The token proves the page was visited through this outreach link. It
     * does not prove who was holding the link — a coach forwards a promising
     * recruit to an assistant and the visit is still attributed to the
     * addressee. Naming the person would be an inference stated as certainty.
     */
    expect(shown).not.toMatch(/opened profile/i);
    expect(shown).not.toMatch(/coach (opened|viewed|read)/i);
    expect(shown).not.toMatch(/\bviewed\b/i);
  });

  it('says the passive thing that is true, and explains the ambiguity', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();
    const visit = summaries()[0].querySelector('[title]');
    expect(summaries()[0].textContent).toMatch(/Profile visit recorded/);
    expect(document.body.innerHTML).toMatch(/qualified visit to the athlete profile was recorded/i);
    expect(document.body.innerHTML).toMatch(/may have been forwarded/i);
    expect(visit).toBeTruthy();
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
    expect(body()).toMatch(/Profile visit recorded/);
  });
});

describe('UNKNOWN IS NOT NONE', () => {
  /**
   * A programme with no history renders nothing, and so does every programme
   * when the request fails. Same empty card, two opposite meanings — and on a
   * failed load, "nothing here" is the one conclusion the data does not
   * support.
   *
   * The difference is carried ONCE, by a page-level notice, because one
   * athlete-level request answers for every card: its failure is a fact about
   * the page, not about any school on it. Marking each card would assert
   * twenty separate programme-level failures. So these tests fix both halves —
   * the page says the state is unknown, and no card either repeats that or
   * quietly implies the opposite.
   */
  let failing;

  function stubFailing() {
    failing = 0;
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
      if (path.includes('/contact-intelligence')) {
        failing += 1;
        return { ok: false, status: 500, headers: { get: () => 'application/json' }, text: async () => '{}' };
      }
      if (path.includes('/programmes')) return ok({ programmes: [] });
      if (path.includes('/matching-summary')) {
        return ok(Object.fromEntries(((opts.body ? JSON.parse(opts.body).collegeNames : []) ?? []).map((n) => [n, ZERO])));
      }
      if (path.includes('/evidence')) return ok({});
      return ok({});
    }));
  }

  it('says the history is unknown exactly once, at the page', async () => {
    stubFailing();
    await render();

    const notices = Array.from(container.querySelectorAll('[role="status"]'))
      .filter((n) => n.textContent.includes('Contact history unavailable'));
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent).toContain(CONTACT_UNAVAILABLE_NOTICE);
  });

  it('does not repeat the failure on the cards', async () => {
    stubFailing();
    await render();

    // Thirty programmes, one sentence. Said per card it would read as thirty
    // separate programme-level failures rather than one request that failed.
    expect(occurrences(body(), 'Contact history unavailable')).toBe(1);
    expect(container.querySelectorAll('[data-testid="contact-unavailable"]')).toHaveLength(0);
  });

  it('withholds contact intelligence from every card while it is unknown', async () => {
    stubFailing();
    await render();

    // Nothing rendered, and nothing fabricated to fill the gap.
    expect(summaries()).toHaveLength(0);
    expect(body()).not.toMatch(/Sent 2x/);
    expect(body()).not.toMatch(/Profile visit recorded/);
  });

  it('never tells an operator a programme has not been contacted', async () => {
    stubFailing();
    await render();

    // The failure mode this whole describe exists to prevent: a card that
    // looks clean because the answer never arrived.
    for (const claim of [/never contacted/i, /not contacted/i, /no prior (contact|outreach)/i,
      /no contact history/i, /zero outreach/i, /not yet (contacted|emailed)/i]) {
      expect(body()).not.toMatch(claim);
    }
  });

  it('is visually distinct from a programme with no prior contact', async () => {
    stubFetch({ intelligence: [] });
    await render();
    // Loaded successfully, nothing to report: no summary, and no notice either
    // — an empty map after a good request is an answer, not an absence of one.
    expect(summaries()).toHaveLength(0);
    expect(body()).not.toContain('Contact history unavailable');
    expect(buttonsIn(container).filter((b) => b.textContent.includes('Try again'))).toHaveLength(0);
  });

  it('still shows history when the request succeeds', async () => {
    stubFetch({ intelligence: [summary()] });
    await render();
    // The other half of the rule: withholding is for the unknown state only.
    expect(summaries()).toHaveLength(1);
    expect(body()).toMatch(/Sent 2x/);
    expect(body()).not.toContain('Contact history unavailable');
  });

  it('offers one retry, not one per card', async () => {
    stubFailing();
    await render();
    const retries = buttonsIn(container).filter((b) => b.textContent.includes('Try again'));
    // The request is athlete-level; a control per card would be thirty ways to
    // make the same call.
    expect(retries).toHaveLength(1);
  });

  it('retries with exactly one more request', async () => {
    stubFailing();
    await render();
    expect(intelCalls()).toHaveLength(1);
    await click(buttonsIn(container).find((b) => b.textContent.includes('Try again')));
    expect(intelCalls()).toHaveLength(2);
    expect(failing).toBe(2);
  });

  it('does not block the rest of the page', async () => {
    stubFailing();
    await render();
    // The ranked cards, the tabs and the actions are all still there. Contact
    // intelligence is supplemental: losing it must cost the operator that one
    // fact and nothing else on the screen.
    expect(container.querySelectorAll('[data-testid="programme-relationship"]').length).toBeGreaterThan(0);
    expect(body()).toContain('Programme1');
    expect(body()).toContain('Programme20');
    expect(tab('Specific Schools')).toBeTruthy();
    expect(buttonsIn(container).some((b) => b.textContent.includes(RELATIONSHIP_OUTREACH)
      || b.textContent.includes('Flag'))).toBe(true);
  });

  it('creates no relationship rows', async () => {
    stubFailing();
    await render();
    expect(calls.some((c) => c.method !== 'GET' && c.path.includes('/programmes'))).toBe(false);
  });
});

describe('A PROGRAMME IS A COLLEGE AND A SPORT', () => {
  /**
   * One institution fields a men's and a women's programme: different staff,
   * different outreach, different history. The server groups on both columns
   * and can legitimately return both for one athlete — a coach at the women's
   * programme may have been written to about a men's athlete, and the athlete
   * may switch sports. Keyed on the college name alone the second entry
   * overwrites the first, and the surviving one is then rendered under the
   * other programme's name: not a missing fact but a WRONG one, about the
   * single question this feature exists to answer.
   */
  const mens = () => summary({ college_name: 'Programme1', sport: 'mens-soccer' });
  const womens = () => summary({
    college_name: 'Programme1',
    sport: 'womens-soccer',
    has_confirmed_send: false,
    draft_only: true,
    confirmed_send_count: 0,
    last_confirmed_send_at: null,
    last_drafted_at: '2026-01-01T10:00:00.000Z',
    engagement: {
      profile_visits: 0, last_visit_at: null, best_coverage_pct: 0,
      reply_recorded: false, reply_recorded_at: null,
    },
    last_activity_at: '2026-01-01T10:00:00.000Z',
    last_activity_kind: 'draft',
  });

  it('does not let one sport overwrite the other in the index', async () => {
    // The women's entry arrives SECOND, which is the order that breaks a
    // name-keyed Map: last write wins and the men's history disappears.
    stubFetch({ intelligence: [mens(), womens()] });
    await render();

    const card = summaries()[0];
    expect(card.textContent).toContain('Sent 2x');
    expect(card.textContent).not.toContain('Drafted');
  });

  it('shows the recommendation card only its own sport', async () => {
    stubFetch({ intelligence: [womens(), mens()] });
    await render();

    // These recommendations were scouted for the athlete's sport, so the card
    // is a men's programme however the payload happens to be ordered.
    expect(summaries()[0].textContent).toContain('Sent 2x');
    expect(body()).not.toContain('Drafted');
  });

  it('cannot leak one sport\u2019s history onto the other\u2019s row', async () => {
    stubFetch({
      programmes: [relationship({ request_state: 'requested', sport: 'womens-soccer' })],
      intelligence: [mens(), womens()],
    });
    await render();
    await click(tab('Specific Schools'));

    // A women's-soccer request at the same college reads the women's entry:
    // one draft and nothing sent, NOT the men's two confirmed sends.
    const row = container.querySelector('[data-testid="specific-school-row"]');
    expect(row.textContent).toContain('Drafted');
    expect(row.textContent).not.toContain('Sent 2x');
    expect(row.textContent).not.toContain('Profile visit recorded');
  });

  it('reports nothing for a sport with no history of its own', async () => {
    stubFetch({
      programmes: [relationship({ request_state: 'requested', sport: 'womens-soccer' })],
      intelligence: [mens()],
    });
    await render();
    await click(tab('Specific Schools'));

    // The men's programme has history and the women's has none. A miss is the
    // answer for the women's row; borrowing the men's summary would be the
    // exact confident-wrong claim this key prevents.
    const row = container.querySelector('[data-testid="specific-school-row"]');
    expect(row.querySelector('[data-testid="contact-summary"]')).toBeNull();
    expect(row.textContent).not.toContain('Sent 2x');
  });

  it('leaves ordinary single-sport behaviour alone', async () => {
    stubFetch({ intelligence: [mens()] });
    await render();
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0].textContent).toContain('Sent 2x');
    expect(summaries()[0].textContent).toContain('Profile visit recorded 3x');
  });
});
