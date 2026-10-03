// @vitest-environment jsdom
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTabSwitch from '@/pages/player/MatchingTabSwitch.jsx';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import { persistedRun } from '@/lib/__fixtures__/matchmakingV2Run.js';
import { FORBIDDEN_MAJOR_PHRASES } from '@/lib/matchmakingV2View';
import {
  NOT_IN_TOP_100, CREATE_EMAIL_DRAFT, MANUAL_ONLY_BADGE,
  ALLOW_CAMPAIGN_OUTREACH, ALREADY_IN_TOUCH,
} from '@/lib/outreachLabels';

/**
 * A10 — SPECIFIC SCHOOLS UNDER V2, AND THE PAGE THEY LIVE ON.
 *
 * ===========================================================================
 * THE PROPERTY THIS FILE EXISTS FOR: A CONSULTANT'S DECISION SURVIVES THE
 * ENGINE IT WAS MADE UNDER.
 *
 * Ninety-nine schools were put on this athlete's list under V1. Switching the
 * ranking engine is not a reason for any of them to disappear, change state,
 * need re-adding, or acquire a rank nobody computed for them. Every test below
 * is a different way that could go wrong.
 *
 * NO PII. Every programme is an institution and every coach is invented. The
 * athlete is "Test Athlete". This file is scanned by `npm run scan:committed-pii`
 * like every other.
 * ===========================================================================
 */

const ATHLETE = 'player-1';
const SPORT = 'mens-soccer';

const PLAYER = {
  id: ATHLETE,
  full_name: 'Test Athlete',
  sport: SPORT,
  intended_major: 'Exercise Science',
  competitive_level_priority: 4,
  playing_opportunity_priority: 5,
  academic_strength_priority: 2,
  max_annual_contribution_usd: 20000,
  contribution_state: 'MAX_ANNUAL',
};

const rel = (name, over = {}) => ({
  id: `rel-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  athlete_id: ATHLETE,
  college_name: name,
  sport: SPORT,
  college_id: `col-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
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
  conference: 'Test Conference',
  city: 'Testville',
  state: 'TS',
  college_active: 1,
  ...over,
});

/**
 * THE PRESERVATION FIXTURE — §C, §N. NINETY-NINE SPECIFIC SCHOOLS.
 *
 * ===========================================================================
 * THE SHAPE OF THE PRODUCTION CASE, WITHOUT THE PRODUCTION DATA.
 *
 * The production preservation baseline is 100 rows in `athlete_programmes`
 * for the athlete this stands in for — 99 when this fixture was written, plus
 * one added by the production Specific Search smoke test, which is that
 * workflow working rather than drift.
 *
 * The fixture stays at 99 deliberately. What it has to reproduce is the SCALE,
 * because the ways a list silently loses a member are off-by-one filters, a
 * de-duplicating Map keyed on something non-unique, and a view that drops what
 * it cannot enrich — none of which reproduce at three rows and none of which
 * care whether the number is 99 or 100. Pinning the fixture to whatever
 * production currently holds would make an unrelated add a failing test.
 *
 * FIVE OF THEM ARE IN THE RUN and ninety-four are not, which is the realistic
 * proportion: a consultant's list is mostly schools a family named, and a
 * family names schools without consulting a ranking. The ninety-four are the
 * §N case — "no programme is silently dropped because it is outside Top 100 /
 * LIMITED_DATA / unsupported / not in the run at all".
 * ===========================================================================
 */
const IN_RUN = [
  rel('Lindenwood'), //                    ranked #1,   PRIORITY_OUTREACH
  // ranked #100 — and carrying the stance that stops the automated campaign,
  // so the control that REVERSES it has a row to render on.
  rel('Catawba', { division: 'NCAA D2', contact_stance: 'manual_only' }),
  rel('Millikin', { division: 'NCAA D3' }), // ranked #101, BROADER_UNIVERSE — outside Top 100
  rel('Trinity Christian', { division: 'NAIA' }), // SUPPORTED_LIMITED_DATA
  rel('Garden City Community', { division: 'NJCAA' }), // UNSUPPORTED_ASSOCIATION
];

/** Ninety-four the run has never heard of. Named, not generated from indices,
 *  so a failure names a school rather than a number. */
const NOT_IN_RUN = Array.from({ length: 94 }, (_, i) => rel(`Requested College ${String(i + 1).padStart(2, '0')}`));

const NINETY_NINE = [...IN_RUN, ...NOT_IN_RUN];

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});
const failed = (status, payload) => ({
  ok: false, status, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

let container;
let root;
let calls;

/** Any path that could cause a message to leave the building. */
const SEND_PATHS = [
  '/send', '/execute', '/dispatch', '/campaigns', '/messages', '/outbound',
];

function stubFetch({
  programmes = NINETY_NINE,
  run = persistedRun({ playerId: ATHLETE }),
  runStatus = 200,
  searchResults = [],
  standing = null,
  onUpsert = null,
} = {}) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (path.includes('/matchmaking/runs/current')) {
      return runStatus === 200
        ? ok(run)
        : failed(runStatus, { error: 'no run', code: 'RUN_NOT_FOUND' });
    }
    if (path.includes('/matchmaking/programme')) return ok(standing ?? { programme: null, rankedCount: run?.counts?.ranked ?? null });
    if (path.includes('/selections/overview')) return ok({ selections: [] });
    if (path.includes('/matchmaking/selections')) return ok({ selections: [] });
    if (path.includes('/colleges/search')) return ok({ results: searchResults });
    if (path.includes('/pending-manual-drafts')) return ok({ drafts: [] });
    if (path.includes('/contact-intelligence')) return ok({ programmes: [] });
    if (path.includes('/matching-summary')) return ok({});
    /*
      The composer generates its evidence on open. A POST, but a READ in every
      sense that matters here: it creates no draft, no outreach row and no
      send. V1 does exactly the same thing from exactly the same component.
    */
    if (path.includes('/evidence')) return ok({ evidence: { facts: [], signals: [] } });
    /*
      BEFORE the `/programmes` branch, deliberately. The composer's context is
      `/players/:id/programmes/:relId/outreach`, which contains BOTH — and
      matching `/programmes` first answers the dialog with a list of
      relationships instead of a contact decision.
    */
    if (path.includes('/outreach')) {
      return ok({
        relationship: programmes[0],
        college: { id: programmes[0]?.college_id, name: programmes[0]?.college_name },
        coaches: [], contact: { allowed: true }, priorContact: [], contactIntelligence: null,
      });
    }
    if (path.includes('/programmes') && method === 'GET') return ok({ programmes });
    if (path.includes('/programmes')) {
      if (onUpsert) onUpsert(body);
      return ok({ programme: { ...rel(body?.college_id ?? 'Added'), ...body } });
    }
    return failed(404, { error: `unstubbed ${method} ${path}` });
  }));
}

function Shell() {
  const [player] = useState(PLAYER);
  const workspace = useActionableRecommendations({
    playerId: player.id, recommendations: [], reserve: [],
  });
  return createElement(Outlet, {
    context: {
      player,
      setPlayer: () => {},
      recommendations: [],
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

async function render(search = '') {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: [`/player/${ATHLETE}/matching${search}`] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTabSwitch) }))),
    ));
  });
}

const text = () => container.textContent;
const find = (sel) => container.querySelector(sel);
const all = (sel) => Array.from(container.querySelectorAll(sel));
const tabs = () => all('[data-testid="matchmaking-tabs"] [role="tab"]');
const tab = (label) => tabs().find((t) => t.textContent.includes(label));
const rows = () => all('[data-testid="specific-school-row"]');
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

async function openSpecific(opts) {
  stubFetch(opts);
  await render();
  await click(tab('Specific Schools'));
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe('A10 §I. the required information architecture', () => {
  it('I1. the four primary sections appear in exactly the required order', async () => {
    stubFetch();
    await render();

    /**
     * Asserted by DOCUMENT POSITION, not by index into a list of children.
     * The sections are not siblings at one depth and must not be required to
     * be: what the brief fixes is the order a consultant reads them in.
     */
    /**
     * UPDATED BY A11 §3. `why-ranked` moved BELOW the results: it is important
     * explanatory material and it is secondary to the recommendations, and
     * standing between the operator and the list meant scrolling past it every
     * time. The four leading sections are otherwise unchanged, and the full
     * A11 order — including that the explanation now follows the tabs — is
     * asserted in matchExplanationUi.test.js.
     */
    const order = ['run-bar', 'active-preferences', 'matchmaking-tabs']
      .map((id) => find(`[data-testid="${id}"]`));

    expect(order.every(Boolean), 'all four sections render').toBe(true);

    for (let i = 0; i < order.length - 1; i += 1) {
      const position = order[i].compareDocumentPosition(order[i + 1]);
      // eslint-disable-next-line no-bitwise
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING, `${i} precedes ${i + 1}`).toBeTruthy();
    }
  });

  it('I2. nothing interposes between the four sections', async () => {
    stubFetch();
    await render();

    /**
     * THE CARD THIS CLAUSE WAS WRITTEN ABOUT.
     *
     * "No programme has been selected for outreach yet" sat between the run
     * and the ranking, so the first thing the page said about a 1,205-school
     * analysis was that nothing had been chosen from it. It still renders —
     * it is true and it is useful — but after the list, not instead of it.
     */
    const empty = find('[data-testid="selections-empty"]');
    const tabStrip = find('[data-testid="matchmaking-tabs"]');
    expect(empty, 'the selections card still renders').toBeTruthy();

    const position = tabStrip.compareDocumentPosition(empty);
    // eslint-disable-next-line no-bitwise
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING, 'it is below the tabs').toBeTruthy();
  });

  it('I3. the floating Specific Search control is gone from above the ranking', async () => {
    stubFetch();
    await render();

    const tabStrip = find('[data-testid="matchmaking-tabs"]');
    const searchControls = all('button, input')
      .filter((el) => /specific search/i.test(el.textContent || el.getAttribute('placeholder') || ''));

    for (const el of searchControls) {
      const position = tabStrip.compareDocumentPosition(el);
      // eslint-disable-next-line no-bitwise
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING, 'any search control is below the tabs').toBeTruthy();
    }
  });
});

describe('A10 §M. the three tabs', () => {
  it('M1. exactly three, named and ordered as required', async () => {
    stubFetch();
    await render();
    /** The third tab carries a count, so compare by prefix rather than equality. */
    const labels = ['Top 100', 'Full Universe', 'Specific Schools'];
    expect(tabs()).toHaveLength(3);
    tabs().forEach((t, i) => {
      expect(t.textContent.trim().startsWith(labels[i]), `tab ${i} is ${labels[i]}`).toBe(true);
    });
  });

  it('M2. Top 100 is the rank<=100 prefix of the persisted order', async () => {
    stubFetch();
    await render();
    // #101 and #102 are in the fixture and must not appear under Top 100.
    expect(text()).toContain('Lindenwood');
    expect(text()).not.toContain('Millikin');
  });

  it('M3. Full Universe shows ranked, limited-data and unsupported alike', async () => {
    stubFetch();
    await render();
    await click(tab('Full Universe'));
    const shown = text();
    expect(shown).toContain('Millikin'); //            ranked, outside Top 100
    expect(shown).toContain('Trinity Christian'); //   SUPPORTED_LIMITED_DATA
    expect(shown).toContain('Garden City Community'); // UNSUPPORTED_ASSOCIATION
  });

  it('M4. switching tabs recomputes nothing and asks the server nothing', async () => {
    stubFetch();
    await render();

    const before = calls.length;
    await click(tab('Full Universe'));
    await click(tab('Specific Schools'));
    await click(tab('Top 100'));

    /**
     * The three views are three readings of one array that is already in
     * memory. A request here would mean a tab click can produce a different
     * answer from the one the operator was just shown.
     */
    const after = calls.slice(before);

    /**
     * UPDATED BY A11 §11, AND THE PROPERTY IS UNCHANGED.
     *
     * What must never happen on a tab switch is a RECOMPUTATION — a new run,
     * or a re-read of the run that could answer differently from the list
     * already on screen. That is still asserted below.
     *
     * What A11 added is a bounded read of programme CONTEXT (ratings, cost,
     * departures) for the twenty cards on the visible page. It computes no
     * score and cannot change a rank; it is the one request that replaces the
     * per-card N+1. Excluded by path rather than by loosening the assertion,
     * so any OTHER matchmaking call still fails this test.
     */
    const recomputes = after.filter((c) => (
      c.path.includes('/matchmaking') && !c.path.includes('/matchmaking/context')
    ));
    expect(recomputes, JSON.stringify(after)).toEqual([]);
    expect(after.filter((c) => c.method !== 'GET'), 'no writes').toEqual([]);
  });
});

describe('A10 §E, §N. the ninety-nine are preserved', () => {
  it('N1. all 99 specific schools render — none dropped for any reason', async () => {
    await openSpecific();
    expect(rows()).toHaveLength(99);
  });

  it('N2. every programme identity is preserved exactly', async () => {
    await openSpecific();
    const rendered = new Set(
      all('[data-testid="school-name"]').map((n) => n.textContent),
    );
    for (const r of NINETY_NINE) {
      expect(rendered.has(r.college_name), `${r.college_name} is on screen`).toBe(true);
    }
  });

  it('N3. a school outside the Top 100 is kept, and keeps its real rank', async () => {
    await openSpecific();
    const millikin = rows().find((r) => r.textContent.includes('Millikin'));
    expect(millikin, 'Millikin is still listed').toBeTruthy();

    await click(buttonIn(millikin, 'Details'));
    // #101 is what the run says. Not "not in Top 100", not a blank, not a zero.
    expect(millikin.textContent).toContain('#101');
  });

  it('N4. LIMITED_DATA and UNSUPPORTED schools are kept and truthfully stated', async () => {
    await openSpecific();

    const trinity = rows().find((r) => r.textContent.includes('Trinity Christian'));
    await click(buttonIn(trinity, 'Details'));
    expect(trinity.textContent).toContain('Not enough evidence to rank');
    expect(trinity.textContent).toContain('not a judgement about the programme');

    const garden = rows().find((r) => r.textContent.includes('Garden City Community'));
    await click(buttonIn(garden, 'Details'));
    expect(garden.textContent).toContain('Association not modelled');
  });

  it('N5. a school the run does not contain is SURFACED, never silently dropped', async () => {
    await openSpecific();
    const outside = rows().find((r) => r.textContent.includes('Requested College 01'));
    expect(outside, 'it is still in the list').toBeTruthy();

    await click(buttonIn(outside, 'Details'));
    expect(find('[data-testid="standing-outside-pool"]'), 'its absence is stated').toBeTruthy();
    expect(outside.textContent).toContain('not part of this athlete');
  });

  it('N5b. the standing renders the run\'s OWN numbers, not a re-derived copy', async () => {
    await openSpecific();
    const lindenwood = rows().find((r) => r.textContent.includes('Lindenwood'));
    await click(buttonIn(lindenwood, 'Details'));
    const standing = lindenwood.querySelector('[data-testid="specific-school-standing"]').textContent;

    /**
     * THE DOUBLE-VIEW REGRESSION, PINNED BY ITS NUMBERS.
     *
     * `useMatchmakingV2` stores `runView(payload)`, so the panel's programmes
     * are already mapped. Mapping them a second time converts a pursuit of 67
     * into "6700" and reshapes every layer so three measured ones report as
     * "Not established". Neither throws and both look like plausible data,
     * which is exactly why this asserts the rendered numbers rather than that
     * something rendered. Found in the browser, not by the earlier tests here,
     * which asserted only rank, band and status — all of which survive the bug.
     */
    expect(standing).toMatch(/Pursuit 6[0-9] /);
    expect(standing).not.toMatch(/Pursuit \d{3,}/);
    expect(standing, 'the three layers are scored, not refused').not.toContain('Not established');
    expect(standing).toContain('Coach recruitability');
  });

  it('N6. no specific school is ever given a rank the run did not produce', async () => {
    await openSpecific();
    for (const name of ['Requested College 01', 'Trinity Christian', 'Garden City Community']) {
      const r = rows().find((x) => x.textContent.includes(name));
      await click(buttonIn(r, 'Details'));
      expect(r.textContent, `${name} has no invented rank`).not.toMatch(/#\d+/);
    }
  });
});

describe('A10 §G. Remove from Top 100 is operational, not a rewrite', () => {
  it('G1. a suppressed school keeps its run rank and is still listed', async () => {
    await openSpecific({
      programmes: NINETY_NINE.map((r) => (
        r.college_name === 'Lindenwood' ? { ...r, visibility: 'suppressed' } : r
      )),
    });

    const lindenwood = rows().find((r) => r.textContent.includes('Lindenwood'));
    expect(lindenwood, 'still on the consultant list').toBeTruthy();
    expect(lindenwood.textContent).toContain(NOT_IN_TOP_100);

    await click(buttonIn(lindenwood, 'Details'));
    /**
     * THE WHOLE POINT. The operator excluded it from the outreach set. The
     * run still says #1, because the run is a historical fact about what
     * Thriv3 computed and an operator decision is not a correction to it.
     */
    expect(lindenwood.textContent).toContain('#1');
  });

  it('G2. the control writes visibility only — it never touches a run', async () => {
    await openSpecific();
    const lindenwood = rows().find((r) => r.textContent.includes('Lindenwood'));
    await click(buttonIn(lindenwood, 'Details'));

    const control = Array.from(lindenwood.querySelectorAll('button'))
      .find((b) => /top 100/i.test(b.textContent));
    expect(control, 'a reversible control exists').toBeTruthy();

    const before = calls.length;
    await click(control);
    const written = calls.slice(before).filter((c) => c.method !== 'GET');

    expect(written.length, 'exactly one write').toBe(1);
    expect(written[0].path, 'to the relationship, not the run').toContain('/programmes/');
    expect(written[0].path).not.toContain('/matchmaking');
    expect(Object.keys(written[0].body)).toEqual(['visibility']);
  });
});

describe('A10 §H. Specific Search lives inside Specific Schools', () => {
  const CANDIDATE = { id: 'col-new', name: 'Newly Requested College', division: 'NCAA D2' };

  it('H1. the search control is inside the Specific Schools tab', async () => {
    await openSpecific();
    const panel = find('[data-testid="tab-specific-schools"]');
    expect(panel.querySelector('input'), 'a search input is here').toBeTruthy();
  });

  it('H2. a searched programme can be added, and that is one upsert', async () => {
    const upserts = [];
    await openSpecific({ searchResults: [CANDIDATE], onUpsert: (b) => upserts.push(b) });

    await type(find('[data-testid="tab-specific-schools"] input'), 'Newly');
    await act(async () => { await new Promise((r) => { setTimeout(r, 300); }); });

    const pick = Array.from(container.querySelectorAll('li'))
      .find((li) => li.textContent.includes('Newly Requested College'))
      ?.querySelector('button');
    await click(pick);

    const add = find('[data-testid="add-to-specific-schools"]');
    expect(add, 'the add control is offered').toBeTruthy();
    await click(add);

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      college_id: 'col-new', request_state: 'requested', requested_by: 'operator',
    });
  });

  it('H3. a programme already on the list offers no duplicate add', async () => {
    await openSpecific({
      searchResults: [{ id: 'col-lindenwood', name: 'Lindenwood', division: 'NCAA D2' }],
    });

    await type(find('[data-testid="tab-specific-schools"] input'), 'Linden');
    await act(async () => { await new Promise((r) => { setTimeout(r, 300); }); });

    const pick = Array.from(container.querySelectorAll('li'))
      .find((li) => li.textContent.includes('Lindenwood')
        && !li.matches('[data-testid="specific-school-row"]'))
      ?.querySelector('button');
    await click(pick);

    expect(find('[data-testid="already-on-list"]'), 'it says so').toBeTruthy();
    expect(find('[data-testid="add-to-specific-schools"]'), 'and offers no second add').toBeFalsy();
  });
});

describe('A10 §F, §O. every V1 control survives, and none of them sends', () => {
  it('F1. the V1 operator controls are all present on a row', async () => {
    await openSpecific();
    const row = rows().find((r) => r.textContent.includes('Lindenwood'));

    expect(buttonIn(row, CREATE_EMAIL_DRAFT), 'Create Email Draft').toBeTruthy();
    expect(buttonIn(row, 'Details'), 'Details').toBeTruthy();

    await click(buttonIn(row, 'Details'));
    const labels = Array.from(row.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels.some((l) => l.includes('Top 100')), 'Top 100 visibility control').toBe(true);
    expect(labels.some((l) => l.trim() === 'Remove'), 'Remove').toBe(true);
    expect(labels.some((l) => l.includes(ALREADY_IN_TOUCH)), 'the stance control').toBe(true);

    /**
     * MANUAL OUTREACH ONLY / ALLOW CAMPAIGN OUTREACH are two states of one
     * control, so the row that proves the second is the one already in that
     * state. Catawba carries `manual_only` in the fixture for this reason.
     */
    const manualOnly = rows().find((r) => r.textContent.includes('Catawba'));
    expect(manualOnly.textContent, MANUAL_ONLY_BADGE).toContain(MANUAL_ONLY_BADGE);
    await click(buttonIn(manualOnly, 'Details'));
    const manualLabels = Array.from(manualOnly.querySelectorAll('button')).map((b) => b.textContent);
    expect(
      manualLabels.some((l) => l.includes(ALLOW_CAMPAIGN_OUTREACH)),
      ALLOW_CAMPAIGN_OUTREACH,
    ).toBe(true);
  });

  it('F2. removal withdraws the request and does not delete the row', async () => {
    await openSpecific();
    const row = rows().find((r) => r.textContent.includes('Lindenwood'));
    await click(buttonIn(row, 'Details'));
    /** EXACTLY "Remove" — "Remove from Top 100" is a different control. */
    const remove = Array.from(row.querySelectorAll('button'))
      .find((b) => b.textContent.trim() === 'Remove');

    const before = calls.length;
    await click(remove);
    const written = calls.slice(before).filter((c) => c.method !== 'GET');

    expect(written.some((c) => c.method === 'DELETE'), 'nothing is deleted').toBe(false);
    expect(written[0].body).toMatchObject({ request_state: 'withdrawn' });
  });

  it('O1. NOTHING in this whole surface ever posts to a send path', async () => {
    await openSpecific({ searchResults: [{ id: 'col-new', name: 'Newly Requested College' }] });

    const row = rows().find((r) => r.textContent.includes('Lindenwood'));
    await click(buttonIn(row, CREATE_EMAIL_DRAFT));
    await click(tab('Top 100'));
    await click(tab('Specific Schools'));

    const sends = calls.filter((c) => (
      c.method !== 'GET' && SEND_PATHS.some((p) => c.path.includes(p))
    ));
    expect(sends, JSON.stringify(sends)).toEqual([]);
  });

  it('O2. Create Email Draft opens the composer and creates no draft or send', async () => {
    await openSpecific();
    const row = rows().find((r) => r.textContent.includes('Lindenwood'));

    const before = calls.length;
    await click(buttonIn(row, CREATE_EMAIL_DRAFT));
    const written = calls.slice(before).filter((c) => c.method !== 'GET');

    /**
     * THE PROPERTY IS "NOTHING LEAVES", NOT "NOTHING IS POSTED".
     *
     * Opening the composer posts once, to `/evidence`, which generates the
     * evidence it displays — a read with a body. It is V1's own behaviour from
     * V1's own component and asserting it away would be asserting a change
     * this phase did not make.
     *
     * What must NOT happen is a draft, an outreach row or a send coming into
     * existence because somebody opened a composer.
     */
    expect(
      written.map((w) => `${w.method} ${w.path}`),
      'the only write is the evidence read',
    ).toEqual([`POST /api/players/${ATHLETE}/evidence`]);
  });
});

describe('A10 §J, §L. the run bar, and the explanation', () => {
  it('J1. Generated and Refresh Matches are both present at the top', async () => {
    stubFetch();
    await render();
    const bar = find('[data-testid="run-bar"]');
    expect(bar.textContent).toMatch(/generated/i);
    expect(buttonIn(bar, 'Refresh'), 'Refresh Matches').toBeTruthy();
  });

  it('J2. a stale run says so in the run bar, and still shows its results', async () => {
    stubFetch({
      run: persistedRun({
        playerId: ATHLETE,
        staleness: { current: false, reasons: ['INPUTS_CHANGED'] },
      }),
    });
    await render();
    expect(find('[data-testid="run-currency"]').textContent).toMatch(/outdated|out of date/i);
    expect(text(), 'the results are still shown').toContain('Lindenwood');
  });

  it('J3. with no run at all, the page offers to generate one and shows no tabs', async () => {
    stubFetch({ runStatus: 404 });
    await render();
    expect(find('[data-testid="no-run"]'), 'the empty state').toBeTruthy();
    expect(tabs(), 'no tab strip over nothing').toEqual([]);
  });

  it('L1. the explanation names the three layers without exposing any weight', async () => {
    stubFetch();
    await render();
    const why = find('[data-testid="why-ranked"]').textContent;

    expect(why).toContain('Coach recruitability');
    expect(why).toContain('Financial viability');
    expect(why).toContain('Athlete opportunity');

    /**
     * THE FROZEN WEIGHTS ARE 0.5 / 0.2 / 0.3 AND THIS SCREEN MAY NOT PRINT
     * THEM. A weight on a page reads as a setting, and that is a change to a
     * frozen scoring file — see docs/validation/V2-FREEZE.md.
     */
    expect(why).not.toMatch(/\b0\.5\b|\b0\.2\b|\b0\.3\b|\b50%|\b20%|\b30%/);
    expect(why).not.toMatch(/weight/i);
  });

  it('L2. the explanation never implies that unranked means unsuitable', async () => {
    stubFetch();
    await render();
    const why = find('[data-testid="why-ranked"]').textContent.toLowerCase();
    for (const banned of ['poor fit', 'bad fit', 'weak programme', 'not suitable', 'lower quality']) {
      expect(why, `"${banned}"`).not.toContain(banned);
    }
    expect(why).toContain('gap in thriv3');
  });

  it('L3. no surface in this page can produce the banned absent-major wording', async () => {
    await openSpecific();
    // Expand everything that could carry a refusal phrase.
    for (const name of ['Trinity Christian', 'Garden City Community', 'Lindenwood']) {
      const r = rows().find((x) => x.textContent.includes(name));
      if (r) await click(buttonIn(r, 'Details'));
    }
    const rendered = text().toLowerCase();
    for (const banned of FORBIDDEN_MAJOR_PHRASES) {
      expect(rendered, `"${banned}" rendered`).not.toContain(banned.toLowerCase());
    }
  });
});

describe('A10 §P, §S. rollback, and what the page costs', () => {
  it('P1. ?matching=v1 still renders the V1 tab, with the same 99 records', async () => {
    stubFetch();
    await render('?matching=v1');

    expect(find('[data-testid="v1-fallback-notice"]'), 'this is V1').toBeTruthy();
    expect(find('[data-testid="matchmaking-tabs"]'), 'and not the V2 tab strip').toBeFalsy();

    const v1Tab = Array.from(container.querySelectorAll('[role="tab"]'))
      .find((b) => b.textContent.includes('Specific Schools'));
    await click(v1Tab);
    expect(rows(), 'the same ninety-nine rows').toHaveLength(99);
  });

  it('S1. ninety-nine rows cost ZERO per-programme standing requests', async () => {
    await openSpecific();

    /**
     * The N+1 this is here to prevent. Each row's standing is a Map lookup
     * into the run the panel already loaded; a `GET …/matchmaking/programme`
     * per row would be ninety-nine requests that grow with exactly the
     * athletes who have the longest lists.
     */
    const perProgramme = calls.filter((c) => c.path.includes('/matchmaking/programme'));
    expect(perProgramme, JSON.stringify(perProgramme)).toEqual([]);
  });

  it('S2. the run is fetched once, not once per tab', async () => {
    stubFetch();
    await render();
    await click(tab('Full Universe'));
    await click(tab('Specific Schools'));
    await click(tab('Top 100'));

    const runFetches = calls.filter((c) => c.path.includes('/matchmaking/runs/current'));
    expect(runFetches).toHaveLength(1);
  });
});
