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
  ALREADY_IN_TOUCH, ALLOW_CAMPAIGN_OUTREACH, ALREADY_IN_TOUCH_FLAG_REASON,
  MANUAL_ONLY_BADGE, MANUAL_ONLY_HINT, RELATIONSHIP_OUTREACH,
} from '@/lib/outreachLabels';

/**
 * F5b — THE THIRD DECISION, ON SCREEN.
 *
 * ===========================================================================
 * "WE'VE ALREADY BEEN IN TOUCH" IS TWO DECISIONS, AND THE OPERATOR MAKES BOTH.
 *
 * It says a thing about the world — we have spoken to this school — and it
 * sets a contact policy: the automated campaign should leave it alone. The
 * button performs TWO EXPLICIT WRITES, and that separation is not ceremony.
 * `establishManualOnly` on the server changes contact policy and nothing else,
 * so a confirmed send never silently flags a school; this button flags because
 * a person said to, and the two states stay independently readable and
 * independently reversible afterwards.
 * ===========================================================================
 *
 * The reverse is called "Allow campaign outreach" and emphatically NOT "not
 * previously contacted". History does not un-happen, and an operator changing
 * a policy must not be made to assert something false to do it.
 */

const ATHLETE = 'athlete-1';

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
  id: 'rel-1',
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

/** Rows live in the stub, so a write is visible on the next render. */
function stubFetch({ programmes = [] } = {}) {
  let rows = programmes;
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/contact-intelligence')) return ok({ programmes: [] });
    if (path.includes('/colleges/search')) return ok({ results: [] });
    if (path.includes('/programmes') && method === 'GET') return ok({ programmes: rows });

    const id = path.split('/programmes/')[1];
    const existing = id ? rows.find((r) => r.id === id) : rows.find((r) => r.college_id === body.college_id);
    const base = existing ?? relationship({
      id: `rel-${body.college_id}`, college_id: body.college_id,
      college_name: `School ${String(body.college_id).replace('col-', '')}`,
    });
    const { college_id: _ignored, ...fields } = body;
    const next = { ...base, ...fields };
    if (fields.flagged === false) { next.flag_reason = null; next.flagged_at = null; }
    if (fields.flagged === true) { next.flagged_at = '2026-09-18T00:00:00.000Z'; }
    rows = existing ? rows.map((r) => (r.id === next.id ? next : r)) : [...rows, next];
    return ok({ programme: next });
  }));
}

function Shell({ recommendations, reserve }) {
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer' });
  const [page, setPage] = useState(1);
  const workspace = useActionableRecommendations({
    playerId: player.id, recommendations, reserve,
  });
  return createElement(Outlet, {
    context: {
      player, setPlayer: () => {}, recommendations, reserve,
      summary: '', ...workspace, analyzing: false, phase: 0,
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

/* ========================================================================== */

describe('marking a school as already contacted', () => {
  it('sets the contact stance, and sends nothing else with it', async () => {
    stubFetch({ programmes: [relationship()] });
    await render();

    await click(buttonWith(ALREADY_IN_TOUCH, cardFor('School 1')));

    const stanceWrite = writes().find((w) => 'contact_stance' in (w.body ?? {}));
    expect(stanceWrite.body).toEqual({ contact_stance: 'manual_only' });
    // Named individually, because a stance change that quietly carried one of
    // these is exactly the collapse the three columns exist to prevent.
    for (const field of ['visibility', 'flagged', 'flag_reason', 'note', 'request_state']) {
      expect(stanceWrite.body, field).not.toHaveProperty(field);
    }
  });

  it('flags it as a SECOND, separate write when nothing had been recorded', async () => {
    stubFetch({ programmes: [relationship()] });
    await render();

    await click(buttonWith(ALREADY_IN_TOUCH, cardFor('School 1')));

    const [first, second] = writes();
    expect(first.body).toEqual({ contact_stance: 'manual_only' });
    expect(second.body).toEqual({ flagged: true, flag_reason: ALREADY_IN_TOUCH_FLAG_REASON });
    expect(second.body).not.toHaveProperty('contact_stance');
  });

  /**
   * THE STANCE GOES FIRST, and it is the half with a consequence outside
   * Thriv3 — it is what stops a campaign emailing a coach somebody has already
   * spoken to. If only one of the two writes lands, that is the one to have.
   */
  it('writes the stance before the flag', async () => {
    stubFetch({ programmes: [relationship()] });
    await render();

    await click(buttonWith(ALREADY_IN_TOUCH, cardFor('School 1')));

    expect(writes().map((w) => Object.keys(w.body).sort().join(',')))
      .toEqual(['contact_stance', 'flag_reason,flagged']);
  });

  /**
   * "Trains with the assistant's club side" is context somebody took the
   * trouble to record, and is strictly more informative than the generic
   * sentence this button would otherwise install in its place.
   */
  it('preserves an existing flag reason rather than overwriting it', async () => {
    stubFetch({
      programmes: [relationship({ flagged: true, flag_reason: 'Her father is an alum' })],
    });
    await render();

    await click(buttonWith(ALREADY_IN_TOUCH, cardFor('School 1')));

    expect(writes()).toHaveLength(1);
    expect(writes()[0].body).toEqual({ contact_stance: 'manual_only' });
    expect(cardFor('School 1').textContent).toContain('Her father is an alum');
  });

  it('works on a school nothing had been recorded about, through the upsert', async () => {
    stubFetch({ programmes: [] });
    await render();

    await click(buttonWith(ALREADY_IN_TOUCH, cardFor('School 2')));

    expect(writes()[0].body).toEqual({ college_id: 'col-2', contact_stance: 'manual_only' });
  });
});

describe('what the operator then sees', () => {
  it('says the school is manual-only, and says what that does and does not mean', async () => {
    stubFetch({ programmes: [relationship({ contact_stance: 'manual_only' })] });
    await render();

    const card = cardFor('School 1');
    expect(card.textContent).toContain(MANUAL_ONLY_BADGE);
    expect(card.textContent).toContain(MANUAL_ONLY_HINT);
    // Both halves, because only one of them is a restriction.
    expect(MANUAL_ONLY_HINT).toMatch(/won't be contacted by the automated campaign/);
    expect(MANUAL_ONLY_HINT).toMatch(/still contact it manually/);
  });

  it('keeps the school in the actionable list', async () => {
    stubFetch({ programmes: [relationship({ contact_stance: 'manual_only' })] });
    await render();

    expect(shown().some((t) => t.includes('School 1'))).toBe(true);
  });

  it('keeps manual outreach available', async () => {
    stubFetch({ programmes: [relationship({ contact_stance: 'manual_only' })] });
    await render();

    expect(buttonWith(RELATIONSHIP_OUTREACH, cardFor('School 1'))).toBeTruthy();
  });

  it('offers the way back, and it is not phrased as a claim about history', async () => {
    stubFetch({ programmes: [relationship({ contact_stance: 'manual_only' })] });
    await render();

    expect(buttonWith(ALLOW_CAMPAIGN_OUTREACH, cardFor('School 1'))).toBeTruthy();
    expect(buttonWith(ALREADY_IN_TOUCH, cardFor('School 1'))).toBeUndefined();
    expect(ALLOW_CAMPAIGN_OUTREACH.toLowerCase()).not.toContain('contacted');
  });
});

describe('allowing campaign outreach again', () => {
  it('changes the stance and nothing else', async () => {
    stubFetch({
      /**
       * Visibility stays `default` here on purpose: a suppressed school is not
       * on the actionable list, so the card under test would not be rendered
       * at all. That it survives suppression is asserted server-side, where
       * the column is what matters rather than which panel draws it.
       */
      programmes: [relationship({
        contact_stance: 'manual_only', flagged: true, flag_reason: 'Previous outreach',
        note: 'Spoke in July.',
      })],
    });
    await render();

    await click(buttonWith(ALLOW_CAMPAIGN_OUTREACH, cardFor('School 1')));

    expect(writes()).toHaveLength(1);
    expect(writes()[0].body).toEqual({ contact_stance: 'default' });
  });

  it('leaves the flag and the note on screen afterwards', async () => {
    stubFetch({
      programmes: [relationship({
        contact_stance: 'manual_only', flagged: true, flag_reason: 'Previous outreach',
      })],
    });
    await render();

    await click(buttonWith(ALLOW_CAMPAIGN_OUTREACH, cardFor('School 1')));

    const card = cardFor('School 1');
    expect(card.textContent).toContain('Previous outreach');
    expect(card.textContent).not.toContain(MANUAL_ONLY_BADGE);
    expect(buttonWith(ALREADY_IN_TOUCH, card)).toBeTruthy();
  });
});

describe('do_not_contact is stronger, and stays out of reach', () => {
  /**
   * NOT DISABLED — ABSENT. A greyed-out "allow campaign outreach" beside a
   * do-not-contact badge reads as "this is how you would lift it", and it is
   * not: that is a different rule with its own workflow, and the server
   * refuses to downgrade it whatever a screen offers.
   */
  it('offers neither contact-policy control', async () => {
    stubFetch({ programmes: [relationship({ contact_stance: 'do_not_contact' })] });
    await render();

    const card = cardFor('School 1');
    expect(card.textContent).toContain('Do not contact');
    expect(buttonWith(ALREADY_IN_TOUCH, card)).toBeUndefined();
    expect(buttonWith(ALLOW_CAMPAIGN_OUTREACH, card)).toBeUndefined();
  });

  it('cannot be reached by any write this screen can make', async () => {
    stubFetch({ programmes: [relationship()] });
    await render();

    await click(buttonWith(ALREADY_IN_TOUCH, cardFor('School 1')));

    expect(writes().some((w) => w.body?.contact_stance === 'do_not_contact')).toBe(false);
  });
});

describe('the other two decisions are untouched by this one', () => {
  it('flagging does not set a contact stance', async () => {
    stubFetch({ programmes: [] });
    await render();

    const card = cardFor('School 1');
    await click(buttonWith('Flag relationship', card));
    await click(buttonWith('Thriv3 personal contact', card));

    expect(writes()[0].body).not.toHaveProperty('contact_stance');
  });

  it('unflagging does not clear one', async () => {
    stubFetch({
      programmes: [relationship({
        contact_stance: 'manual_only', flagged: true, flag_reason: 'Previous outreach',
      })],
    });
    await render();

    await click(buttonWith('Unflag', cardFor('School 1')));

    expect(writes()[0].body).toEqual({ flagged: false });
    expect(cardFor('School 1').textContent).toContain(MANUAL_ONLY_BADGE);
  });

  it('removing a school from the Top 100 does not change its stance', async () => {
    // Flagged, because the Top 100 control is only offered once there is a
    // relationship an operator has actually said something about.
    stubFetch({
      programmes: [relationship({
        contact_stance: 'manual_only', flagged: true, flag_reason: 'Previous outreach',
      })],
    });
    await render();

    await click(buttonWith('Remove from Top 100', cardFor('School 1')));

    expect(writes()[0].body).toEqual({ visibility: 'suppressed' });
  });
});
