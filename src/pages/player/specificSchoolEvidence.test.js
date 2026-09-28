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
  PROGRAMME_EVIDENCE_NONE, PROGRAMME_EVIDENCE_FAILED, PROGRAMME_EVIDENCE_RETRY,
  PROGRAMME_EVIDENCE_HEADING, PROGRAMME_EVIDENCE_ALSO_KNOWN, PROGRAMME_EVIDENCE_LOADING,
} from '@/lib/outreachLabels';

/**
 * F9b — WHAT THRIV3 KNOWS ABOUT A PROGRAMME, ON THE WORKSPACE.
 *
 * ===========================================================================
 * THREE PROPERTIES.
 *
 *   THE PAGE'S LOAD BUDGET DOES NOT MOVE. Evidence is expensive per programme,
 *   so it is asked for when a row is opened and never before. A school nobody
 *   opens costs nothing; opening one costs exactly one read; opening it again
 *   costs nothing.
 *
 *   UNKNOWN IS NOT NONE, AND HERE THERE ARE FOUR STATES RATHER THAN TWO.
 *   "Not asked", "asking", "nothing to say" and "could not find out" are four
 *   different facts and only the third is about the school.
 *
 *   THE BROWSER CANNOT MANUFACTURE A CLAIM. Every sentence on screen is the
 *   server's `text`, printed verbatim. No strength, no percentage, no score,
 *   no ranking, no recommendation — none of which the evidence engine
 *   produces, and none of which this surface may invent.
 * ===========================================================================
 */

const ATHLETE = 'athlete-1';
const SPORT = 'mens-soccer';

const RECOMMENDATIONS = [
  { name: 'Duke', division: 'NCAA D1', match_score: 88, coaching_staff: [] },
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

/**
 * One wire finding, shaped exactly as `toWire` in server/routes/evidence.js
 * emits it — including `strength`, which the server really does send and which
 * nothing on this surface may render.
 */
const finding = (over = {}) => ({
  kind: 'HISTORICAL_SAME_COUNTRY',
  tier: 'FACT',
  category: 'international',
  confidence: 'HIGH',
  strength: 82,
  season: '2025',
  source: 'roster',
  downgraded: null,
  text: 'Three New Zealanders have come through the programme since 2022.',
  order: 0,
  slot: 'HOOK',
  ...over,
});

const wire = (over = {}) => ({
  structure: 'PATHWAY',
  structureLabel: 'Pathway',
  structureSource: 'ENGINE',
  maxEvidence: 4,
  programme: { name: 'Stanford' },
  selected: [finding()],
  available: [],
  internal: [],
  otherKnown: [],
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
 * `evidence` is a map from college name to wire object, so a test can give
 * Stanford findings and Duke nothing. `evidenceStatus` fails the whole request;
 * a `{ unavailable }` entry fails one programme inside a good response — two
 * different failures the UI must treat the same way and never as emptiness.
 */
function stubFetch({
  programmes = [], contact = [], drafts = [], evidence = {}, evidenceStatus = 200,
  evidenceThen = null,
} = {}) {
  let evidenceNow = evidence;
  let evidenceStatusNow = evidenceStatus;
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/evidence')) {
      if (evidenceStatusNow !== 200) {
        // A later attempt may succeed — that is what Retry is for.
        if (evidenceThen) { evidenceNow = evidenceThen; evidenceStatusNow = 200; }
        return failed(500, { error: 'evidence unavailable' });
      }
      const names = body?.collegeNames ?? [];
      return ok(Object.fromEntries(names.map((n) => [n, evidenceNow[n] ?? wire()])));
    }
    if (path.includes('/pending-manual-drafts')) return ok({ drafts });
    if (path.includes('/contact-intelligence')) return ok({ programmes: contact });
    if (path.includes('/colleges/search')) return ok({ results: [] });
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
const row = (name = 'Stanford') => rows()
  .find((r) => r.querySelector('[data-testid="school-name"]').textContent === name);
const buttonIn = (scope, label) => Array.from(scope.querySelectorAll('button'))
  .find((b) => b.textContent.trim().startsWith(label));
const section = (name = 'Stanford') => row(name).querySelector('[data-testid="programme-evidence"]');
const findings = (name = 'Stanford') => Array.from(
  row(name).querySelectorAll('[data-testid="evidence-finding"]'),
);

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
async function open(opts) {
  stubFetch(opts);
  await render();
  await click(tab('Specific Schools'));
}
async function toggle(name = 'Stanford') {
  await click(buttonIn(row(name), 'Details') ?? buttonIn(row(name), 'Hide details'));
}
async function expand(name = 'Stanford') {
  await click(buttonIn(row(name), 'Details'));
}

const evidenceCalls = () => calls.filter((c) => c.path.includes('/evidence'));
const namesAsked = () => evidenceCalls().flatMap((c) => c.body?.collegeNames ?? []);

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
/*  1. THE REQUEST BUDGET                                                     */
/* ========================================================================== */

describe('evidence is asked for only when somebody opens a school', () => {
  const THREE = [
    relationship({ id: 'r-a', college_name: 'Akron', college_id: 'c-a', city: 'Akron', state: 'OH' }),
    relationship({ id: 'r-m', college_name: 'Marist', college_id: 'c-m', city: 'Poughkeepsie', state: 'NY' }),
    relationship(),
  ];

  /**
   * THE WHOLE REASON THIS IS LAZY. Per programme the server reads five seasons
   * of roster rows, the results, coach tenure, recruiting patterns and pool
   * benchmarks, then computes the programme's philosophy and this athlete's
   * fit inside it. Thirty specific schools on page load would be thirty of
   * those, for rows nobody opened.
   */
  it('asks for nothing on load, however many schools there are', async () => {
    await open({ programmes: THREE, contact: [] });

    expect(rows()).toHaveLength(3);
    expect(evidenceCalls()).toHaveLength(0);
    expect(container.querySelector('[data-testid="programme-evidence"]')).toBeNull();
  });

  it('asks for exactly the school that was opened', async () => {
    await open({ programmes: THREE, contact: [] });
    await expand('Stanford');

    expect(evidenceCalls()).toHaveLength(1);
    expect(namesAsked()).toEqual(['Stanford']);
  });

  /** Open, close, open again is one request. The row outlives its own detail. */
  it('does not ask twice for the same school', async () => {
    await open({ programmes: THREE, contact: [] });
    await expand('Stanford');
    await toggle('Stanford');           // closed
    await toggle('Stanford');           // open again

    expect(evidenceCalls()).toHaveLength(1);
    expect(section('Stanford')).toBeTruthy();
  });

  it('asks once more for a second school, and not again for the first', async () => {
    await open({ programmes: THREE, contact: [] });
    await expand('Stanford');
    await expand('Akron');

    expect(evidenceCalls()).toHaveLength(2);
    expect(namesAsked()).toEqual(['Stanford', 'Akron']);
  });

  /**
   * THE PAGE'S OWN BUDGET IS UNCHANGED. Three athlete-level reads on load, and
   * expanding a row adds an evidence read and nothing else — no second
   * programmes fetch, no contact-intelligence or pending refetch.
   */
  it('leaves the three athlete-level reads exactly as they were', async () => {
    await open({ programmes: THREE, contact: [] });

    const budget = () => ({
      programmes: calls.filter((c) => /\/players\/[^/]+\/programmes($|\?)/.test(c.path)).length,
      contact: calls.filter((c) => c.path.includes('/contact-intelligence')).length,
      pending: calls.filter((c) => c.path.includes('/pending-manual-drafts')).length,
    });
    expect(budget()).toEqual({ programmes: 1, contact: 1, pending: 1 });

    await expand('Stanford');
    await expand('Akron');
    expect(budget()).toEqual({ programmes: 1, contact: 1, pending: 1 });
    expect(evidenceCalls()).toHaveLength(2);
  });
});

/* ========================================================================== */
/*  2. THE FOUR STATES                                                        */
/* ========================================================================== */

describe('unknown is not none', () => {
  it('claims nothing at all before anybody asks', async () => {
    await open({ programmes: [relationship()], contact: [] });

    const text = container.textContent;
    expect(text).not.toContain(PROGRAMME_EVIDENCE_NONE);
    expect(text).not.toContain(PROGRAMME_EVIDENCE_FAILED);
    expect(text).not.toContain(PROGRAMME_EVIDENCE_HEADING);
  });

  /**
   * While the answer is in flight the map is empty for exactly the same reason
   * it is empty for a programme with nothing to say. Only a settled READY may
   * license the sentence.
   */
  it('claims nothing while the answer is still coming', async () => {
    let release;
    const pending = new Promise((r) => { release = r; });
    stubFetch({ programmes: [relationship()], contact: [] });
    const realFetch = global.fetch;
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      if (path.includes('/evidence')) {
        calls.push({ path, method: 'POST', body: JSON.parse(opts.body) });
        await pending;
        return ok({ Stanford: wire() });
      }
      return realFetch(path, opts);
    }));
    await render();
    await click(tab('Specific Schools'));
    await expand('Stanford');

    expect(section().textContent).toContain(PROGRAMME_EVIDENCE_LOADING);
    expect(section().textContent).not.toContain(PROGRAMME_EVIDENCE_NONE);
    expect(section().textContent).not.toContain(PROGRAMME_EVIDENCE_FAILED);

    await act(async () => { release(); });
  });

  it('says so plainly when the answer really is nothing', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: { Stanford: wire({ selected: [], available: [] }) },
    });
    await expand();

    expect(section().textContent).toContain(PROGRAMME_EVIDENCE_NONE);
    expect(section().textContent).not.toContain(PROGRAMME_EVIDENCE_FAILED);
    expect(findings()).toHaveLength(0);
  });

  it('says something different when it could not find out', async () => {
    await open({ programmes: [relationship()], contact: [], evidenceStatus: 500 });
    await expand();

    expect(section().textContent).toContain(PROGRAMME_EVIDENCE_FAILED);
    expect(section().textContent).not.toContain(PROGRAMME_EVIDENCE_NONE);
  });

  /**
   * ONE UNREADABLE PROGRAMME INSIDE A GOOD RESPONSE. The route answers per
   * programme rather than failing a batch, and `{ unavailable }` is a fact
   * about the request, not about the school.
   */
  it('treats an unavailable programme as a failure, never as emptiness', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: { Stanford: { unavailable: 'roster could not be read' } },
    });
    await expand();

    expect(section().textContent).toContain(PROGRAMME_EVIDENCE_FAILED);
    expect(section().textContent).toContain('roster could not be read');
    expect(section().textContent).not.toContain(PROGRAMME_EVIDENCE_NONE);
  });

  it('never shows the two answers together', async () => {
    for (const opts of [
      { evidence: { Stanford: wire({ selected: [], available: [] }) } },
      { evidenceStatus: 500 },
      { evidence: { Stanford: { unavailable: 'no' } } },
    ]) {
      calls = [];
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await open({ programmes: [relationship()], contact: [], ...opts });
      await expand();

      const text = section().textContent;
      const both = text.includes(PROGRAMME_EVIDENCE_NONE)
        && text.includes(PROGRAMME_EVIDENCE_FAILED);
      expect(both).toBe(false);
      act(() => root.unmount());
    }
  });

  it('retries after a failure and shows the answer', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      evidenceStatus: 500,
      evidenceThen: { Stanford: wire() },
    });
    await expand();
    expect(section().textContent).toContain(PROGRAMME_EVIDENCE_FAILED);

    await click(buttonIn(section(), PROGRAMME_EVIDENCE_RETRY));

    expect(section().textContent).not.toContain(PROGRAMME_EVIDENCE_FAILED);
    expect(findings()).toHaveLength(1);
    expect(evidenceCalls()).toHaveLength(2);
  });
});

/* ========================================================================== */
/*  3. WHAT IS RENDERED, AND WHAT MAY NOT BE                                  */
/* ========================================================================== */

describe('the claim is the server’s sentence', () => {
  it('prints a FACT with its tier and its text', async () => {
    await open({ programmes: [relationship()], contact: [] });
    await expand();

    const text = findings()[0].textContent;
    expect(text).toContain('FACT');
    expect(text).toContain('Three New Zealanders have come through the programme since 2022.');
  });

  /**
   * A SIGNAL IS NOT PROMOTED, AND NOT RENAMED. The registry's word, and the
   * already-hedged sentence the tier-aware renderer produced, printed exactly.
   */
  it('prints a SIGNAL as a SIGNAL, hedged exactly as it arrived', async () => {
    const hedged = 'You may have as many as two midfield places opening in 2026.';
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: {
        Stanford: wire({
          selected: [finding({
            kind: 'POSITION_GRADUATION', tier: 'SIGNAL', confidence: 'MEDIUM', text: hedged,
          })],
        }),
      },
    });
    await expand();

    const text = findings()[0].textContent;
    expect(text).toContain('SIGNAL');
    expect(text).toContain(hedged);
    expect(text).not.toContain('FACT');
    // Never dressed up as something the engine did not say.
    expect(section().textContent).not.toMatch(/insight|prediction|forecast|likely/i);
  });

  it('renders no sentence the payload did not carry', async () => {
    const texts = [
      'Three New Zealanders have come through the programme since 2022.',
      'Two defenders graduate in 2026.',
    ];
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: {
        Stanford: wire({
          selected: [
            finding({ text: texts[0] }),
            finding({ kind: 'POSITION_GRADUATION', text: texts[1] }),
          ],
        }),
      },
    });
    await expand();

    for (const f of findings()) {
      const body = Array.from(f.querySelectorAll('p')).map((p) => p.textContent);
      // Every paragraph in a finding is either the server's text or a
      // freshness reason the server supplied. Nothing else is printable.
      for (const line of body) expect(texts).toContain(line);
    }
  });

  /**
   * `strength` IS ON THE WIRE AND MUST NOT REACH THE SCREEN — as a number, as
   * a percentage, or as a bar that reads like a ranking. It is an internal
   * 0-100 priority, and this surface ranks nothing.
   */
  it('never exposes the internal strength, in any form', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: {
        Stanford: wire({ selected: [finding({ strength: 82, confidence: 'HIGH' })] }),
      },
    });
    await expand();

    const text = section().textContent;
    expect(text).not.toContain('82');
    expect(text).not.toMatch(/\d+\s?%/);
    expect(text).not.toMatch(/\d+\s?\/\s?100/);
    // And no bar smuggled in under a different name.
    expect(section().querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  });

  it('invents no ranking, fit, interest or recommendation', async () => {
    await open({ programmes: [relationship()], contact: [] });
    await expand();

    expect(section().textContent).not.toMatch(
      /best coach|recommended|prefers|likely to reply|reply likelihood|high interest|strong interest|strong fit|good fit|engagement score|next action/i,
    );
  });

  it('presents no engagement fact as programme evidence', async () => {
    await open({
      programmes: [relationship()],
      contact: [{
        college_name: 'Stanford',
        sport: SPORT,
        contacted: true,
        has_confirmed_send: true,
        draft_only: false,
        confirmed_send_count: 1,
        coach_count: 1,
        last_confirmed_send_at: '2026-09-13T00:00:00.000Z',
        last_drafted_at: null,
        revoked_count: 0,
        origins: ['manual'],
        engagement: {
          profile_visits: 3,
          last_visit_at: '2026-09-14T00:00:00.000Z',
          best_coverage_pct: 74,
          reply_recorded: true,
          reply_recorded_at: '2026-09-15T00:00:00.000Z',
        },
        last_activity_at: '2026-09-15T00:00:00.000Z',
        last_activity_kind: 'reply',
        coaches: [],
      }],
    });
    await expand();

    // The engagement facts are on the row, in the contact sections — and not
    // inside the evidence section, which is about the programme rather than
    // about what a coach did.
    expect(row().textContent).toContain('Reply recorded');
    const ev = section().textContent;
    expect(ev).not.toContain('Reply recorded');
    expect(ev).not.toContain('Profile visit');
    expect(ev).not.toContain('of the video');
  });
});

describe('freshness is the engine’s verdict, not the browser’s', () => {
  it('shows the downgrade reason the payload supplied', async () => {
    const reason = 'roster last read 214 days ago';
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: {
        Stanford: wire({
          selected: [finding({ downgraded: { from: 'HIGH', reason } })],
        }),
      },
    });
    await expand();

    expect(row().querySelector('[data-testid="evidence-freshness"]').textContent).toBe(reason);
  });

  /** No date arithmetic here, so an old-looking season cannot invent a warning. */
  it('shows no freshness warning where the payload downgraded nothing', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: {
        Stanford: wire({ selected: [finding({ season: '2019', downgraded: null })] }),
      },
    });
    await expand();

    expect(row().querySelector('[data-testid="evidence-freshness"]')).toBeNull();
    expect(section().textContent).not.toMatch(/stale|out of date|old/i);
  });
});

describe('also known', () => {
  it('lists what the engine has and did not lead with, kept secondary', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: {
        Stanford: wire({
          selected: [finding()],
          available: [
            { ...finding({ kind: 'ACADEMIC_FIT', text: 'They teach your intended major.' }), selected: false },
            { ...finding(), selected: true },
          ],
        }),
      },
    });
    await expand();

    const also = row().querySelector('[data-testid="evidence-also-known"]');
    expect(also.textContent).toContain(PROGRAMME_EVIDENCE_ALSO_KNOWN);
    expect(also.textContent).toContain('They teach your intended major.');
    // The selected finding is not repeated down here.
    expect(also.textContent).not.toContain('Three New Zealanders');
  });

  it('is absent when everything available was selected', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: {
        Stanford: wire({ available: [{ ...finding(), selected: true }] }),
      },
    });
    await expand();

    expect(row().querySelector('[data-testid="evidence-also-known"]')).toBeNull();
  });
});

/* ========================================================================== */
/*  4. IDENTITY AND BOUNDARIES                                                */
/* ========================================================================== */

describe('evidence is keyed on the programme, not on a rank', () => {
  /**
   * The endpoint resolves a programme from the registry by name, so a school
   * nobody ranked answers exactly as a ranked one does. This is the case that
   * matters most on this surface: a specific request is very often for a
   * school the model never put in the Top 100.
   */
  it('loads for a specific school outside the Top 100', async () => {
    await open({
      programmes: [relationship({ visibility: 'suppressed' })],
      contact: [],
    });
    await expand();

    expect(namesAsked()).toEqual(['Stanford']);
    expect(findings()).toHaveLength(1);
    // Stanford is not in RECOMMENDATIONS at all, and nothing asked for a rank.
    expect(RECOMMENDATIONS.some((r) => r.name === 'Stanford')).toBe(false);
    expect(row().textContent).toContain('Not in Top 100');
  });

  it('sends the programme name and nothing derived from a recommendation', async () => {
    await open({ programmes: [relationship()], contact: [] });
    await expand();

    const body = evidenceCalls()[0].body;
    expect(body.collegeNames).toEqual(['Stanford']);
    // No preferences: the workspace is not choosing an angle.
    expect(body.prefer ?? null).toBeNull();
    expect(body.preferStructure ?? null).toBeNull();
    expect(JSON.stringify(body)).not.toContain('rank');
  });
});

describe('the workspace is not the composer', () => {
  it('offers no selection, reordering, structure or send control', async () => {
    await open({ programmes: [relationship()], contact: [] });
    await expand();

    const labels = Array.from(section().querySelectorAll('button')).map((b) => b.textContent.trim());
    // Retry is the only button this section may ever own.
    for (const label of labels) expect(label).toBe(PROGRAMME_EVIDENCE_RETRY);
    expect(section().querySelectorAll('select')).toHaveLength(0);
    expect(section().querySelectorAll('input')).toHaveLength(0);
    expect(section().querySelectorAll('textarea')).toHaveLength(0);
  });

  /**
   * The structure answers "how will THIS email be built", which is the
   * composer's question. The workspace answers "what do we know".
   */
  it('does not show the email structure', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: { Stanford: wire({ structureLabel: 'Pathway' }) },
    });
    await expand();

    expect(section().textContent).not.toContain('Pathway');
  });

  it('exposes no raw evidence data object', async () => {
    await open({
      programmes: [relationship()],
      contact: [],
      evidence: {
        Stanford: wire({ selected: [{ ...finding(), data: { secret: 'internal' } }] }),
      },
    });
    await expand();

    expect(section().textContent).not.toContain('secret');
    expect(section().textContent).not.toContain('internal');
    expect(section().textContent).not.toContain('[object Object]');
  });
});
