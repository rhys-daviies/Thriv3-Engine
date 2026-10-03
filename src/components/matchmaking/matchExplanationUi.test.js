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
import { NOT_ESTABLISHED } from './GraduatingPlayers';

/**
 * A11 — MATCH EXPLANATION AND OUTREACH INTELLIGENCE.
 *
 * ===========================================================================
 * THE TWO PROPERTIES THIS FILE EXISTS FOR.
 *
 *   NOTHING IS CLAIMED THAT THE EVIDENCE DOES NOT CARRY. Every sentence on
 *   screen is the engine's own, built from the basis a scorer recorded. A run
 *   with no stored explanation says so; a layer with no reasons says so; a
 *   rating that was never established prints an em dash.
 *
 *   A ZERO IS NOT A SILENCE. "No goalkeepers are leaving" and "we cannot read
 *   this roster" are different facts and the screen must never render the
 *   second as the first. That is the single most consequential assertion here.
 *
 * NO PII: institutions, invented players, "Test Athlete".
 * ===========================================================================
 */

const ATHLETE = 'player-1';
const SPORT = 'mens-soccer';
const ENTRY_YEAR = 2027;

const PLAYER = {
  id: ATHLETE,
  full_name: 'Test Athlete',
  sport: SPORT,
  position: 'MIDFIELD',
  recruiting_class_year: ENTRY_YEAR,
  intended_major: 'Exercise Science',
  competitive_level_priority: 4,
  playing_opportunity_priority: 5,
  academic_strength_priority: 2,
  max_annual_contribution_usd: 20000,
  contribution_state: 'STATED',
};

const rel = (name, over = {}) => ({
  id: `rel-${name}`,
  athlete_id: ATHLETE,
  college_name: name,
  sport: SPORT,
  college_id: `col-${name}`,
  request_state: 'requested',
  requested_by: 'operator',
  requested_at: '2026-09-11T00:00:00.000Z',
  flagged: false,
  flag_reason: null,
  visibility: 'default',
  contact_stance: 'default',
  note: null,
  created_at: '2026-09-11T00:00:00.000Z',
  updated_at: '2026-09-11T00:00:00.000Z',
  division: 'NCAA D1',
  conference: 'Test Conference',
  city: 'Testville',
  state: 'TS',
  college_active: 1,
  ...over,
});

/** A contact-intelligence summary: this programme has been written to. */
const contacted = (name) => ({
  college_name: name,
  sport: SPORT,
  contacted: true,
  has_confirmed_send: true,
  draft_only: false,
  confirmed_send_count: 1,
  coach_count: 1,
  revoked_count: 0,
  origins: ['manual'],
  engagement: {
    profile_visits: 2, last_visit_at: '2026-10-01T00:00:00.000Z',
    best_coverage_pct: 0, reply_recorded: false, reply_recorded_at: null,
  },
  coaches: [],
});

/** Programme context, in the server's shape. */
const ctx = (name, over = {}) => ({
  collegeName: name,
  sport: SPORT,
  division: 'NCAA D1',
  conference: 'Test Conference',
  programRating: 7.4,
  academicRating: 4.8,
  netPrice: 19638,
  rosterOnFile: true,
  eligibilityRuled: true,
  departures: {
    GOALKEEPER: { state: 'MEASURED', openings: 1, vacatedStarters: 1, eligibleToRemain: 2, positionRows: 3, unreadable: 0 },
    DEFENSE: { state: 'MEASURED', openings: 2, vacatedStarters: 1, eligibleToRemain: 9, positionRows: 12, unreadable: 0 },
    MIDFIELD: { state: 'MEASURED', openings: 0, vacatedStarters: 0, eligibleToRemain: 6, positionRows: 6, unreadable: 0 },
    FORWARD: { state: 'MEASURED', openings: 1, vacatedStarters: 1, eligibleToRemain: 5, positionRows: 7, unreadable: 0 },
  },
  departingPlayers: {
    GOALKEEPER: [{ name: 'Invented Keeper', classYear: 'Sr.', starter: true, starterKnown: true }],
    DEFENSE: [
      { name: 'Invented Defender', classYear: 'Sr.', starter: true, starterKnown: true },
      { name: 'Invented Squad Player', classYear: 'Sr.', starter: false, starterKnown: true },
    ],
    MIDFIELD: [],
    FORWARD: [{ name: 'Invented Forward', classYear: 'Gr.', starter: true, starterKnown: true }],
  },
  ...over,
});

/** The engine's explanation shape, with real reason codes. */
const explanation = (over = {}) => ({
  subject: { id: 'pid-ranked-1', name: 'Lindenwood', division: 'NCAA D1', rankingState: 'RANKED' },
  standing: { rank: 1, outOf: 828, poolSize: 1205 },
  reasons: [
    {
      code: 'ATHLETIC_AT_OR_ABOVE_LEVEL',
      layer: 'recruitability',
      polarity: 'strength',
      band: 2,
      sub: 0,
      listLevel: false,
      evidence: {
        athletePercentile: 0.64, programmePercentile: 0.608, levelGap: 0.032,
        plausibility: 0.867, rating: 6,
      },
    },
    {
      code: 'COST_WITHIN_BUDGET',
      layer: 'financial',
      polarity: 'strength',
      band: 2,
      sub: 0,
      listLevel: false,
      /** The field names `render.js` actually reads: see its COST_WITHIN_BUDGET. */
      /**
       * The shapes `render.js` actually reads: `cost` and `budget` are RANGES,
       * not scalars. A scalar makes the renderer throw, which `reasonSentence`
       * catches and turns into silence — correct degradation, and the reason
       * this fixture is built from the renderer's own contract.
       */
      evidence: { stated: 20000, cost: [19638, 19638], budget: [0, 20000] },
    },
    {
      code: 'POSITION_OPENING_MEASURED',
      layer: 'opportunity',
      polarity: 'strength',
      band: 2,
      sub: 0,
      listLevel: false,
      evidence: { vacatedStarters: 1, typicalStarters: 4, position: 'MIDFIELD' },
    },
  ],
  layerReasons: {
    recruitability: [],
    financial: [],
    opportunity: [],
  },
  nextChecks: [],
  ...over,
});

/** `layerReasons` as the server regroups it, from each reason's own layer. */
function regrouped(e) {
  const layerReasons = { recruitability: [], financial: [], opportunity: [] };
  for (const r of e.reasons) if (layerReasons[r.layer]) layerReasons[r.layer].push(r);
  return { ...e, layerReasons };
}

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

function stubFetch({
  run = persistedRun({ playerId: ATHLETE, sport: SPORT }),
  programmes = [],
  contact = [],
  contexts = null,
  programmeExplanation = regrouped(explanation()),
} = {}) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });

    if (path.includes('/matchmaking/runs/current')) return ok(run);
    if (path.includes('/matchmaking/context')) {
      const url = new URL(path, 'http://x');
      const names = String(url.searchParams.get('names') ?? '').split('\u001F').filter(Boolean);
      return ok({
        entryYear: ENTRY_YEAR,
        sport: SPORT,
        programmes: names.map((n) => (contexts ? contexts(n) : ctx(n))).filter(Boolean),
      });
    }
    if (path.includes('/matchmaking/programme')) {
      return ok({ programme: { name: 'x', explanation: programmeExplanation }, rankedCount: 828 });
    }
    if (path.includes('/selections/overview')) return ok({ selections: [] });
    if (path.includes('/matchmaking/selections')) return ok({ selections: [] });
    if (path.includes('/colleges/search')) return ok({ results: [] });
    if (path.includes('/pending-manual-drafts')) return ok({ drafts: [] });
    if (path.includes('/contact-intelligence')) return ok({ programmes: contact });
    if (path.includes('/matching-summary')) return ok({});
    if (path.includes('/evidence')) return ok({ evidence: { facts: [], signals: [] } });
    if (path.includes('/outreach')) {
      return ok({
        relationship: programmes[0], college: {}, coaches: [],
        contact: { allowed: true }, priorContact: [], contactIntelligence: null,
      });
    }
    if (path.includes('/programmes') && method === 'GET') return ok({ programmes });
    if (path.includes('/programmes')) return ok({ programme: programmes[0] });
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
      player, setPlayer: () => {}, recommendations: [], reserve: [], summary: '',
      ...workspace, analyzing: false, phase: 0,
      progress: { current: 0, total: 0, school: '' },
      page: 1, setPage: () => {}, onAnalyze: async () => {},
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
  // let the bounded context read settle
  await act(async () => { await new Promise((r) => { setTimeout(r, 20); }); });
}

const text = () => container.textContent;
const find = (sel) => container.querySelector(sel);
const all = (sel) => Array.from(container.querySelectorAll(sel));
const cards = () => all('[data-testid^="programme-"]');
const cardFor = (name) => cards().find((c) => c.textContent.includes(name));
const buttonIn = (scope, label) => Array.from(scope.querySelectorAll('button'))
  .find((b) => b.textContent.trim().startsWith(label));

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise((r) => { setTimeout(r, 20); }); });
}

/** Open a card by expanding its disclosure header, rendering first if needed. */
async function expand(name) {
  if (!cards().length) await render();
  const card = cardFor(name);
  const toggle = card.querySelector('[aria-expanded]') ?? card.querySelector('button');
  await click(toggle);
  return cardFor(name);
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

describe('A11 §3. the page order', () => {
  it('O1. Generated < Preferences < Tabs < Results < Why ranked', async () => {
    stubFetch();
    await render();

    const ids = ['run-bar', 'active-preferences', 'matchmaking-tabs', 'why-ranked'];
    const nodes = ids.map((id) => find(`[data-testid="${id}"]`));
    expect(nodes.every(Boolean), ids.join(', ')).toBe(true);

    for (let i = 0; i < nodes.length - 1; i += 1) {
      // eslint-disable-next-line no-bitwise
      expect(
        nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${ids[i]} precedes ${ids[i + 1]}`,
      ).toBeTruthy();
    }
  });

  it('O2. the results sit between the tabs and the explanation box', async () => {
    stubFetch();
    await render();
    const panel = find('[role="tabpanel"]');
    const why = find('[data-testid="why-ranked"]');
    // eslint-disable-next-line no-bitwise
    expect(panel.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('A11 §4, §10. relationship chips on ranked cards', () => {
  it('C1. a programme with outreach history shows it on its Top 100 card', async () => {
    stubFetch({ programmes: [rel('Lindenwood')], contact: [contacted('Lindenwood')] });
    await render();

    const card = cardFor('Lindenwood');
    expect(card.querySelector('[data-testid="status-chip-REQUESTED"]'), 'specific school').toBeTruthy();
    expect(card.querySelector('[data-testid="status-chip-CONTACT_STATE"]').textContent).toBe('Sent');
    expect(card.querySelector('[data-testid="status-chip-ENGAGEMENT"]').textContent).toBe('Profile visit');
  });

  it('C2. a programme with NO relationship row shows no chips at all', async () => {
    stubFetch({ programmes: [], contact: [] });
    await render();
    const card = cardFor('Catawba');
    expect(card, 'the card renders').toBeTruthy();
    expect(card.querySelectorAll('[data-testid^="status-chip-"]'), 'no invented chips').toHaveLength(0);
  });

  it('C3. the SAME state renders in Top 100 and in Specific Schools', async () => {
    stubFetch({
      programmes: [rel('Lindenwood', { contact_stance: 'manual_only' })],
      contact: [contacted('Lindenwood')],
    });
    await render();

    const top = cardFor('Lindenwood').textContent;
    expect(top).toContain('Manual outreach only');
    expect(top).toContain('Sent');

    const tab = all('[data-testid="matchmaking-tabs"] [role="tab"]')
      .find((t) => t.textContent.includes('Specific Schools'));
    await click(tab);

    const row = all('[data-testid="specific-school-row"]')
      .find((r) => r.textContent.includes('Lindenwood'));
    expect(row.textContent, 'the same two facts, same words').toContain('Manual outreach only');
    expect(row.textContent).toContain('Sent');
  });

  it('C4. the chip join is by canonical identity, not the display name alone', async () => {
    /**
     * The relationship is a WOMEN'S programme of the same name. The run is
     * men's. A display-name join would attach the other sport's history to
     * this card; the key carries the sport precisely so it cannot.
     */
    stubFetch({
      programmes: [rel('Lindenwood', { sport: 'womens-soccer' })],
      contact: [{ ...contacted('Lindenwood'), sport: 'womens-soccer' }],
    });
    await render();
    const card = cardFor('Lindenwood');
    expect(card.querySelector('[data-testid="status-chip-CONTACT_STATE"]'), 'no cross-sport leak').toBeFalsy();
  });
});

describe('A11 §5. the expanded card', () => {
  it('E1. the three layer readings come before the programme context', async () => {
    stubFetch();
    const card = await expand('Lindenwood');

    const layers = card.textContent.indexOf('Coach recruitability');
    const context = card.querySelector('[data-testid="programme-context"]');
    expect(layers).toBeGreaterThan(-1);
    expect(context, 'context renders').toBeTruthy();

    const layerNode = Array.from(card.querySelectorAll('*'))
      .find((n) => n.textContent.trim() === 'Coach recruitability');
    // eslint-disable-next-line no-bitwise
    expect(layerNode.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('E2. ratings render over 10 from the real values', async () => {
    stubFetch();
    const card = await expand('Lindenwood');
    expect(card.querySelector('[data-testid="program-rating"]').textContent).toBe('7.4/10');
    expect(card.querySelector('[data-testid="academic-rating"]').textContent).toBe('4.8/10');
  });

  it('E3. an unestablished rating is an em dash, NEVER a zero', async () => {
    stubFetch({ contexts: (n) => ctx(n, { programRating: null, academicRating: null }) });
    const card = await expand('Lindenwood');
    expect(card.querySelector('[data-testid="program-rating"]').textContent).toBe('—');
    expect(card.querySelector('[data-testid="academic-rating"]').textContent).toBe('—');
    expect(card.querySelector('[data-testid="program-rating"]').textContent).not.toContain('0');
  });
});

describe('A11 §6. graduating players — a zero is not a silence', () => {
  it('G1. measured counts render per position, with the scored starters named', async () => {
    stubFetch();
    const card = await expand('Lindenwood');
    const panel = card.querySelector('[data-testid="graduating-players"]');

    expect(panel.querySelector('[data-testid="graduating-GOALKEEPER"]').textContent).toContain('1');
    expect(panel.querySelector('[data-testid="graduating-DEFENSE"]').textContent).toContain('2');
    expect(panel.querySelector('[data-testid="graduating-DEFENSE"]').textContent).toContain('1 starting');
  });

  it('G2. an EVIDENCED zero renders as 0, and says nothing about evidence', async () => {
    stubFetch();
    const card = await expand('Lindenwood');
    const mid = card.querySelector('[data-testid="graduating-MIDFIELD"]');
    expect(mid.textContent).toContain('0');
    expect(mid.textContent, 'a measured zero is not "not established"').not.toContain(NOT_ESTABLISHED);
  });

  it('G3. NO ROSTER renders "Not established" and never 0 — the critical case', async () => {
    stubFetch({
      contexts: (n) => ctx(n, {
        rosterOnFile: false,
        departures: Object.fromEntries(['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'].map((p) => [p, {
          state: 'NO_ROSTER', openings: 0, vacatedStarters: 0, eligibleToRemain: 0, positionRows: 0, unreadable: 0,
        }])),
        departingPlayers: null,
      }),
    });
    const card = await expand('Lindenwood');
    const panel = card.querySelector('[data-testid="graduating-players"]');

    for (const pos of ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD']) {
      const cell = panel.querySelector(`[data-testid="graduating-${pos}"]`);
      expect(cell.textContent, pos).toContain(NOT_ESTABLISHED);
      expect(cell.textContent.replace(NOT_ESTABLISHED, ''), `${pos} shows no zero`).not.toMatch(/\d/);
    }
    expect(panel.querySelector('[data-testid="graduating-state-NO_ROSTER"]').textContent)
      .toContain('holds no roster');
  });

  it('G4. no eligibility rule is stated as OUR gap, not the programme\'s', async () => {
    stubFetch({
      contexts: (n) => ctx(n, {
        eligibilityRuled: false,
        departures: Object.fromEntries(['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'].map((p) => [p, {
          state: 'NO_ELIGIBILITY_RULE', openings: 0, vacatedStarters: 0, eligibleToRemain: 0, positionRows: 4, unreadable: 0,
        }])),
        departingPlayers: null,
      }),
    });
    const card = await expand('Lindenwood');
    const note = card.querySelector('[data-testid="graduating-state-NO_ELIGIBILITY_RULE"]').textContent;
    expect(note).toContain('Thriv3 holds no eligibility rule');
    expect(card.textContent).toContain(NOT_ESTABLISHED);
  });

  it('G5. insufficient readable rows is distinguished from a measured zero', async () => {
    stubFetch({
      contexts: (n) => ctx(n, {
        departures: {
          ...ctx(n).departures,
          MIDFIELD: {
            state: 'INSUFFICIENT_EVIDENCE', openings: 0, vacatedStarters: 0,
            eligibleToRemain: 0, positionRows: 8, unreadable: 7,
          },
        },
      }),
    });
    const card = await expand('Lindenwood');
    expect(card.querySelector('[data-testid="graduating-MIDFIELD"]').textContent).toContain(NOT_ESTABLISHED);
    expect(card.querySelector('[data-testid="graduating-state-INSUFFICIENT_EVIDENCE"]')).toBeTruthy();
  });

  it('G6. names are behind a second disclosure, not in the default card', async () => {
    stubFetch();
    const card = await expand('Lindenwood');
    expect(card.textContent, 'not shown by default').not.toContain('Invented Keeper');

    await click(card.querySelector('[data-testid="view-graduating-players"]'));
    const open = cardFor('Lindenwood');
    expect(open.querySelector('[data-testid="graduating-names"]')).toBeTruthy();
    expect(open.textContent).toContain('Invented Keeper');
    expect(open.textContent, 'which ones counted').toContain('started');
  });
});

describe('A11 §7, §8. the explanation', () => {
  it('X1. the overall explanation is the engine\'s sentences, not ours', async () => {
    stubFetch();
    const card = await expand('Lindenwood');
    const overall = card.querySelector('[data-testid="explanation-overall-reasons"]');
    expect(overall, 'rendered').toBeTruthy();
    const codes = Array.from(overall.querySelectorAll('[data-reason]')).map((n) => n.dataset.reason);
    expect(codes).toContain('ATHLETIC_AT_OR_ABOVE_LEVEL');
    expect(overall.textContent.length).toBeGreaterThan(20);
  });

  it('X2. each layer answers for itself, from its own reasons', async () => {
    stubFetch();
    const card = await expand('Lindenwood');
    for (const layer of ['recruitability', 'financial', 'opportunity']) {
      const node = card.querySelector(`[data-testid="explanation-layer-${layer}"]`);
      expect(node, layer).toBeTruthy();
      expect(node.textContent.trim().length, `${layer} says something`).toBeGreaterThan(10);
    }
    expect(card.querySelector('[data-testid="explanation-reasons-financial"]').textContent)
      .toMatch(/cost|price|contribut|budget/i);
  });

  it('X3. a run with no stored explanation SAYS SO, and invents nothing', async () => {
    stubFetch({ programmeExplanation: null });
    const card = await expand('Lindenwood');
    expect(card.querySelector('[data-testid="explanation-absent"]').textContent)
      .toContain('before Thriv3 began recording explanations');
    expect(card.querySelector('[data-testid="explanation-overall"]'), 'no fabricated summary').toBeFalsy();
  });

  it('X4. the prohibited claims never appear', async () => {
    stubFetch();
    const card = await expand('Lindenwood');
    await click(card.querySelector('[data-testid="view-graduating-players"]'));

    const rendered = text().toLowerCase();
    for (const banned of [
      'guaranteed', 'the coach wants', 'the coach needs', 'will offer', 'will receive',
      'expect a scholarship', 'you are good enough', 'chance of', '% chance', 'odds of',
      'does not offer', 'doesn’t offer',
    ]) {
      expect(rendered, `"${banned}"`).not.toContain(banned);
    }
  });

  it('X5. no weights or formulas are exposed', async () => {
    stubFetch();
    const card = await expand('Lindenwood');
    const body = card.textContent;
    expect(body).not.toMatch(/\bweight/i);
    expect(body).not.toMatch(/0\.5\b|0\.2\b|0\.3\b/);
  });
});

describe('A11 §13. regressions that must not come back', () => {
  it('R1. Pursuit 90 renders as 90, never 9000', async () => {
    stubFetch();
    await render();
    const card = cardFor('Lindenwood');

    /**
     * READ THE NUMBER, DO NOT PATTERN-MATCH AROUND IT.
     *
     * The first version of this asserted `not.toMatch(/\b\d{4,}\b/)` and
     * survived the mutation it was written for: the card renders
     * "Pursuit6700Partial evidence", where a letter sits either side of the
     * digits, so there is no word boundary and `\b` can never match. Found by
     * mutating `programmeView` to apply `scoreOutOf100` twice and watching
     * this test pass anyway.
     *
     * Pursuit is a score out of 100. Anything above it is a double mapping.
     */
    const pursuit = Number(/Pursuit\s*(\d+)/.exec(card.textContent)?.[1]);
    expect(Number.isFinite(pursuit), card.textContent).toBe(true);
    expect(pursuit).toBeLessThanOrEqual(100);
    expect(pursuit).toBe(67);
  });

  it('R2. measured layers never render as "Not established" on a ranked card', async () => {
    stubFetch();
    const card = await expand('Lindenwood');
    const layers = card.querySelector('.grid');
    expect(layers.textContent).not.toContain('Not established');
  });

  it('R3. expanding a card WRITES NOTHING', async () => {
    stubFetch({ programmes: [rel('Lindenwood')], contact: [contacted('Lindenwood')] });
    await render();
    const before = calls.length;
    await expand('Lindenwood');
    const after = calls.slice(before);

    expect(after.filter((c) => c.method !== 'GET'), JSON.stringify(after)).toEqual([]);
    for (const c of after) {
      expect(c.path, 'no selection, campaign, send or observation').not.toMatch(
        /selections|campaigns|observations|\/send|confirm-sent/,
      );
    }
  });

  it('R4. the context read is ONE request for the page, not one per card', async () => {
    stubFetch();
    await render();
    const contextCalls = calls.filter((c) => c.path.includes('/matchmaking/context'));
    expect(contextCalls, 'exactly one').toHaveLength(1);

    const names = new URL(contextCalls[0].path, 'http://x').searchParams.get('names').split('\u001F');
    expect(names.length, 'the whole visible page in one call').toBeGreaterThan(1);
  });

  it('R5. the explanation is fetched only when a card is opened', async () => {
    stubFetch();
    await render();
    expect(calls.filter((c) => c.path.includes('/matchmaking/programme')), 'none up front').toHaveLength(0);
    await expand('Lindenwood');
    expect(calls.filter((c) => c.path.includes('/matchmaking/programme')), 'one on expand').toHaveLength(1);
  });
});
