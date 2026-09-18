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
  NO_CONTACT_RECORDED, MANUAL_ONLY_BADGE, CONTACT_UNAVAILABLE_NOTICE,
  ORIGIN_SHORT, ORIGIN_UNRECORDED_SHORT, videoWatched, moreCoaches,
} from '@/lib/outreachLabels';

/**
 * F6b — WHAT A SPECIFIC SCHOOL ROW ACTUALLY TELLS AN OPERATOR.
 *
 * ===========================================================================
 * THE ONE ASSERTION THAT COULD BE FALSE.
 *
 * Every other fact on this row describes something that happened, and the
 * worst a bug could do is fail to show it. "No contact recorded" describes an
 * ABSENCE, and an absence is false the moment it is claimed before the answer
 * has arrived — while the athlete-level history is loading, the map is empty
 * for exactly the same reason it is empty for a school nobody has written to.
 *
 * So the first block below is not a rendering test. It is the test that the
 * sentence is withheld in all three states where the answer is unknown, and
 * most of what follows exists to keep it that way.
 * ===========================================================================
 *
 * The rest is presentation over data that already reaches the client: F6a
 * established there is no missing backend truth here, only facts that were
 * being fetched and then dropped on the floor.
 */

const ATHLETE = 'athlete-1';
const SPORT = 'mens-soccer';

const RECOMMENDATIONS = [
  { name: 'Duke', division: 'NCAA D1', match_score: 88, coaching_staff: [] },
  { name: 'Stanford', division: 'NCAA D1', match_score: 84, coaching_staff: [] },
  { name: 'Elon', division: 'NCAA D1', match_score: 80, coaching_staff: [] },
];

/** A specific request, which is what this list shows. */
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
  city: 'Stanford',
  state: 'CA',
  college_active: 1,
  ...over,
});

const engagement = (over = {}) => ({
  profile_visits: 0,
  last_visit_at: null,
  best_coverage_pct: 0,
  reply_recorded: false,
  reply_recorded_at: null,
  ...over,
});

const coach = (over = {}) => ({
  coach_id: 'coach-1',
  coach_name: 'Ada Vela',
  position_title: 'Head Coach',
  has_confirmed_send: true,
  confirmed_send_count: 1,
  last_confirmed_send_at: '2026-09-12T00:00:00.000Z',
  last_drafted_at: null,
  revoked_at: null,
  origins: ['manual'],
  engagement: engagement(),
  ...over,
});

/** The shape `contactIntelligenceForAthlete` returns per programme. */
const summary = (over = {}) => ({
  college_name: 'Stanford',
  sport: SPORT,
  contacted: true,
  has_confirmed_send: true,
  draft_only: false,
  confirmed_send_count: 1,
  coach_count: 1,
  last_confirmed_send_at: '2026-09-12T00:00:00.000Z',
  last_drafted_at: null,
  revoked_count: 0,
  origins: ['manual'],
  engagement: engagement(),
  last_activity_at: '2026-09-12T00:00:00.000Z',
  last_activity_kind: 'confirmed_send',
  coaches: [coach()],
  ...over,
});

let container;
let root;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});
const fail = (status, payload) => ({
  ok: false, status, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

/**
 * @param contact  `[summary]` to serve, 'fail' to reject the request, or
 *   'pending' to leave it in flight — the three states the no-history sentence
 *   has to tell apart.
 */
function stubFetch({ programmes = [], contact = [] } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;

    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/contact-intelligence')) {
      if (contact === 'fail') return fail(500, { error: 'boom' });
      if (contact === 'pending') return new Promise(() => {});
      return ok({ programmes: contact });
    }
    if (path.includes('/colleges/search')) return ok({ results: [] });
    if (path.includes('/programmes') && method === 'GET') return ok({ programmes });
    if (path.includes('/programmes')) return ok({ programme: programmes[0] });
    return fail(404, { error: `unstubbed ${method} ${path}` });
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

async function render(recommendations = RECOMMENDATIONS) {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: ['/player/athlete-1/matching'] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell, { recommendations }) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTab) }))),
    ));
  });
}

const tab = (label) => Array.from(container.querySelectorAll('[role="tab"]'))
  .find((t) => t.textContent.includes(label));
async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
const rows = () => Array.from(container.querySelectorAll('[data-testid="specific-school-row"]'));
const row = (name = 'Stanford') => rows().find((r) => r.textContent.includes(name));

/** Render, then switch to the Specific Schools view. */
async function open(opts) {
  stubFetch(opts);
  await render();
  await click(tab('Specific Schools'));
}

beforeEach(() => {
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

describe('unknown is not none', () => {
  it('says so when the history loaded and the programme is genuinely absent', async () => {
    await open({ programmes: [relationship()], contact: [] });

    expect(row().textContent).toContain(NO_CONTACT_RECORDED);
  });

  /**
   * THE REQUEST FAILED. The page carries one notice explaining that, and every
   * card renders nothing at all — a per-card claim would be twenty programmes
   * looking individually broken because one request failed, and worse, twenty
   * assertions of an absence nobody established.
   */
  it('says NOTHING when the request failed', async () => {
    await open({ programmes: [relationship()], contact: 'fail' });

    expect(row().textContent).not.toContain(NO_CONTACT_RECORDED);
    expect(container.textContent).toContain(CONTACT_UNAVAILABLE_NOTICE);
  });

  /**
   * THE REQUEST IS STILL IN FLIGHT, and `!failed` is not the same test as
   * `ready`. During LOADING the map is empty for exactly the reason it is
   * empty for a school nobody has written to, and the two must not look alike.
   */
  it('says NOTHING while the request is still in flight', async () => {
    await open({ programmes: [relationship()], contact: 'pending' });

    expect(row()).toBeTruthy();
    expect(row().textContent).not.toContain(NO_CONTACT_RECORDED);
    expect(container.textContent).not.toContain(CONTACT_UNAVAILABLE_NOTICE);
  });

  it('never says it on a ranked card, where silence already reads as nothing yet', async () => {
    stubFetch({ programmes: [], contact: [] });
    await render();

    // Recommended view: ninety cards saying the same non-fact would be noise.
    expect(container.textContent).not.toContain(NO_CONTACT_RECORDED);
  });
});

describe('manual_only with nothing on file', () => {
  /**
   * THE STATE F5b CREATED, AND THE REASON THIS SLICE EXISTS.
   *
   * "We've already been in touch" establishes CURRENT CONTACT POLICY without
   * fabricating a send — contact that happened outside Thriv3 leaves no row
   * here. So the two facts sit side by side and neither implies the other: the
   * policy is the operator's, the history is the database's.
   */
  it('shows the policy and the absence together', async () => {
    await open({
      programmes: [relationship({
        contact_stance: 'manual_only', flagged: true,
        flag_reason: 'Already in contact with this school',
      })],
      contact: [],
    });

    const text = row().textContent;
    expect(text).toContain(MANUAL_ONLY_BADGE);
    expect(text).toContain(NO_CONTACT_RECORDED);
  });

  it('implies no send — no date, no count, no coach, no channel', async () => {
    await open({
      programmes: [relationship({ contact_stance: 'manual_only' })],
      contact: [],
    });

    expect(row().textContent).not.toMatch(/Sent|Drafted|Profile visit|Reply recorded/);
    /**
     * Asserted against the SUMMARY element rather than the whole row: the
     * policy badge legitimately reads "Manual outreach only", and a row-wide
     * search for "Manual" would match the very thing that is allowed to be
     * there. What must be absent is a CHANNEL, which only appears where a
     * message exists.
     */
    expect(row().querySelector('[data-testid="contact-summary"]').textContent)
      .toBe(NO_CONTACT_RECORDED);
    expect(container.querySelector('[data-testid="contacted-coaches"]')).toBeNull();
  });
});

describe('a draft is still not a send', () => {
  it('reads as drafted, never as contacted', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({
        has_confirmed_send: false, draft_only: true, confirmed_send_count: 0,
        last_confirmed_send_at: null, last_drafted_at: '2026-09-12T00:00:00.000Z',
        last_activity_kind: 'draft', last_activity_at: '2026-09-12T00:00:00.000Z',
        coaches: [coach({ has_confirmed_send: false, confirmed_send_count: 0, last_confirmed_send_at: null })],
      })],
    });

    const text = row().textContent;
    expect(text).toContain('Drafted');
    expect(text).not.toContain('Sent ');
    expect(text).not.toContain(NO_CONTACT_RECORDED);
  });

  it('lists no contacted coach for a draft nobody confirmed', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({
        has_confirmed_send: false, draft_only: true,
        coaches: [coach({ has_confirmed_send: false })],
      })],
    });

    expect(container.querySelector('[data-testid="contacted-coaches"]')).toBeNull();
  });
});

describe('which part of the product wrote to them', () => {
  it('names a manual send', async () => {
    await open({ programmes: [relationship()], contact: [summary({ origins: ['manual'] })] });
    expect(row().textContent).toContain(ORIGIN_SHORT.manual);
  });

  it('names a campaign send', async () => {
    await open({ programmes: [relationship()], contact: [summary({ origins: ['campaign'] })] });
    expect(row().textContent).toContain(ORIGIN_SHORT.campaign);
  });

  /**
   * BOTH, NEVER ONE. `origins` is a set across the relationship's messages, so
   * a coach reached by a campaign in March and by hand in June carries both —
   * and both are true. Collapsing would be choosing which half to hide.
   */
  it('names both where both happened', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({ origins: ['campaign', 'manual'] })],
    });

    const text = row().textContent;
    expect(text).toContain(ORIGIN_SHORT.manual);
    expect(text).toContain(ORIGIN_SHORT.campaign);
  });

  /**
   * NULL IS RENDERED AND NEVER GUESSED. It is the honest record for a message
   * written before the origin column existed, and inferring `manual` from it
   * would manufacture the provenance the column was added to protect.
   */
  it('says the origin was not recorded rather than inventing one', async () => {
    await open({ programmes: [relationship()], contact: [summary({ origins: [null] })] });

    const text = row().textContent;
    expect(text).toContain(ORIGIN_UNRECORDED_SHORT);
    expect(text).not.toContain(ORIGIN_SHORT.manual);
    expect(text).not.toContain(ORIGIN_SHORT.campaign);
  });

  it('carries a recorded origin alongside an unrecorded one', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({ origins: ['manual', null] })],
    });

    const text = row().textContent;
    expect(text).toContain(ORIGIN_SHORT.manual);
    expect(text).toContain(ORIGIN_UNRECORDED_SHORT);
  });
});

describe('engagement', () => {
  it('reports how far through the video anyone got', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({ engagement: engagement({ best_coverage_pct: 74 }) })],
    });

    expect(row().textContent).toContain(videoWatched(74));
  });

  it('says nothing at zero, where there is no number to give', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({ engagement: engagement({ best_coverage_pct: 0, profile_visits: 1 }) })],
    });

    const text = row().textContent;
    expect(text).toContain('Profile visit recorded');
    expect(text).not.toContain('of the video');
  });

  it('keeps profile visits and recorded replies exactly as they were', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({
        engagement: engagement({ profile_visits: 3, reply_recorded: true, reply_recorded_at: '2026-09-14T00:00:00.000Z' }),
      })],
    });

    const text = row().textContent;
    expect(text).toContain('Profile visit recorded 3x');
    expect(text).toContain('Reply recorded');
  });

  it('claims no email open, click, delivery or bounce, because none exist', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({ engagement: engagement({ profile_visits: 2, best_coverage_pct: 90, reply_recorded: true }) })],
    });

    expect(row().textContent).not.toMatch(/opened|clicked|delivered|bounced/i);
  });

  it('still reports a revoked link', async () => {
    await open({ programmes: [relationship()], contact: [summary({ revoked_count: 1 })] });
    expect(row().textContent).toContain('Link revoked');
  });

  it('still reports a repeated send with its count', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({ confirmed_send_count: 3 })],
    });
    expect(row().textContent).toContain('Sent 3x');
  });
});

describe('why this school is here', () => {
  it('shows the flag reason the operator was required to give', async () => {
    await open({
      programmes: [relationship({ flagged: true, flag_reason: 'Her father is an alum' })],
      contact: [],
    });

    expect(row().textContent).toContain('Her father is an alum');
  });

  it('shows the note', async () => {
    await open({
      programmes: [relationship({ note: 'Spoke to the assistant in July.' })],
      contact: [],
    });

    expect(row().textContent).toContain('Spoke to the assistant in July.');
  });

  it('creates no placeholder for either when there is nothing to say', async () => {
    await open({ programmes: [relationship()], contact: [] });

    const text = row().textContent;
    expect(text).not.toContain('Note:');
    expect(text).not.toMatch(/Reason/);
  });

  it('does not show a stale reason on an unflagged relationship', async () => {
    // The server clears reason and flag together; this asserts the row does not
    // resurrect one if a payload ever disagreed.
    await open({
      programmes: [relationship({ flagged: false, flag_reason: 'Left over' })],
      contact: [],
    });

    expect(row().textContent).not.toContain('Left over');
  });
});

describe('a school taken out of the Top 100', () => {
  it('says so, and stays in the list', async () => {
    await open({
      programmes: [relationship({ visibility: 'suppressed' })],
      contact: [],
    });

    expect(rows()).toHaveLength(1);
    expect(row().textContent).toContain('Not in Top 100');
  });

  it('keeps its manual outreach control, because ranking is not a contact decision', async () => {
    await open({
      programmes: [relationship({ visibility: 'suppressed' })],
      contact: [],
    });

    const actions = Array.from(row().querySelectorAll('button')).map((b) => b.textContent);
    expect(actions.some((t) => t.includes('Relationship Outreach'))).toBe(true);
  });
});

describe('who we contacted', () => {
  const contacted = () => container.querySelector('[data-testid="contacted-coaches"]');

  it('names one coach with their title', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({ coaches: [coach({ coach_name: 'Ada Vela', position_title: 'Head Coach' })] })],
    });

    expect(contacted().textContent).toContain('Ada Vela');
    expect(contacted().textContent).toContain('Head Coach');
  });

  it('names two', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({
        coach_count: 2,
        coaches: [
          coach({ coach_id: 'c1', coach_name: 'Ada Vela' }),
          coach({ coach_id: 'c2', coach_name: 'Ben Oduya', position_title: 'Assistant Coach' }),
        ],
      })],
    });

    const text = contacted().textContent;
    expect(text).toContain('Ada Vela');
    expect(text).toContain('Ben Oduya');
    expect(text).not.toContain('more');
  });

  it('collapses the remainder past two, so the row stays scannable', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({
        coach_count: 4,
        coaches: [
          coach({ coach_id: 'c1', coach_name: 'Ada Vela' }),
          coach({ coach_id: 'c2', coach_name: 'Ben Oduya' }),
          coach({ coach_id: 'c3', coach_name: 'Cal Reyes' }),
          coach({ coach_id: 'c4', coach_name: 'Dae Kim' }),
        ],
      })],
    });

    const text = contacted().textContent;
    expect(text).toContain('Ada Vela');
    expect(text).toContain('Ben Oduya');
    expect(text).not.toContain('Cal Reyes');
    expect(text).toContain(moreCoaches(2));
  });

  it('omits a coach with no title rather than inventing one', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({ coaches: [coach({ coach_name: 'Ada Vela', position_title: null })] })],
    });

    expect(contacted().textContent).toContain('Ada Vela');
    expect(contacted().textContent).not.toContain('—');
  });

  it('shows only confirmed coaches, never one carrying a draft', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({
        coach_count: 2,
        coaches: [
          coach({ coach_id: 'c1', coach_name: 'Ada Vela', has_confirmed_send: true }),
          coach({ coach_id: 'c2', coach_name: 'Ben Oduya', has_confirmed_send: false }),
        ],
      })],
    });

    expect(contacted().textContent).toContain('Ada Vela');
    expect(contacted().textContent).not.toContain('Ben Oduya');
  });

  /** No ranking, no recommendation — the shared layer's order, untouched. */
  it('preserves the order it was given', async () => {
    await open({
      programmes: [relationship()],
      contact: [summary({
        coaches: [
          coach({ coach_id: 'c1', coach_name: 'Zoe Adler' }),
          coach({ coach_id: 'c2', coach_name: 'Ada Vela' }),
        ],
      })],
    });

    const text = contacted().textContent;
    expect(text.indexOf('Zoe Adler')).toBeLessThan(text.indexOf('Ada Vela'));
  });
});

describe('what the row still does', () => {
  it('keeps the existing actions', async () => {
    await open({ programmes: [relationship()], contact: [] });

    const actions = Array.from(row().querySelectorAll('button')).map((b) => b.textContent.trim());
    expect(actions.some((t) => t.startsWith('Relationship Outreach'))).toBe(true);
    expect(actions.some((t) => t.startsWith('We’ve already been in touch')
      || t.startsWith('We\'ve already been in touch'))).toBe(true);
    expect(actions.some((t) => t.startsWith('Remove'))).toBe(true);
  });

  it('still shows the rank where the programme is genuinely ranked', async () => {
    await open({ programmes: [relationship()], contact: [] });
    expect(row().textContent).toContain('Also ranked');
  });

  it('asks for the athlete history once, not once per school', async () => {
    await open({
      programmes: [
        relationship(),
        relationship({ id: 'rel-2', college_name: 'Duke', college_id: 'col-duke' }),
        relationship({ id: 'rel-3', college_name: 'Elon', college_id: 'col-elon' }),
      ],
      contact: [],
    });

    expect(rows()).toHaveLength(3);
    const calls = globalThis.fetch.mock.calls.map(([path]) => path);
    expect(calls.filter((p) => p.includes('/contact-intelligence'))).toHaveLength(1);
    expect(calls.filter((p) => p.includes('/programmes') && !p.includes('contact'))).toHaveLength(1);
  });
});
