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
import { persistedRun, PROGRAMMES } from '@/lib/__fixtures__/matchmakingV2Run.js';
import { NOT_ESTABLISHED } from './GraduatingPlayers';
import { SHOW_DETAIL, HIDE_DETAIL } from './MatchmakingExplanation';

/**
 * A11.2 — THE RECOMMENDATION CARD, AS A CONSULTANT READS IT.
 *
 * ===========================================================================
 * BUILT FROM THE FIRST REAL PRODUCTION CARD, WITHOUT THE ATHLETE.
 *
 * A11.2 §8 asks for a fixture equivalent to the production recommendation that
 * prompted this phase, and the shape is reproduced exactly: Pursuit 77 over
 * 65 / 100 / 83, partial evidence, an NCAA D3 programme already on the
 * athlete's Specific Schools and already written to, with athletic alignment,
 * cost inside the contribution, one defensive opening, an international
 * recruiting record, the D3 athletic-scholarship limitation and a positive
 * academic reading.
 *
 * NO ATHLETE IDENTITY. The numbers and the reason codes are the production
 * shape; the institution, the names and the athlete are invented. Nothing here
 * encodes who the real recommendation was for.
 *
 * -- WHAT THIS FILE IS ACTUALLY DEFENDING -----------------------------------
 *
 *   THE TEN-SECOND READ. Scores, then the snapshot, then three sentences.
 *   The full three-layer evidence is behind one disclosure, so the default
 *   card is scannable and the investigation is one click away — §6.
 *
 *   THE CAVEATS SURVIVE THE SUMMARISING. A shorter card that quietly dropped
 *   "this association does not permit athletic scholarships" would be a worse
 *   card, not a tidier one. The financial caveats are asserted in the DEFAULT
 *   view, not merely somewhere on the page — §2.
 *
 *   PLAIN IS NOT VAGUER. The decimal-heavy engine prose is absent from the
 *   default view and present, verbatim, inside detailed reasoning — §2, §5.
 * ===========================================================================
 */

const ATHLETE = 'player-1';
const SPORT = 'mens-soccer';
const ENTRY_YEAR = 2027;
const SCHOOL = 'Lindenwood';

const PLAYER = {
  id: ATHLETE,
  full_name: 'Test Athlete',
  sport: SPORT,
  position: 'DEFENSE',
  recruiting_class_year: ENTRY_YEAR,
  intended_major: 'Exercise Science',
  competitive_level_priority: 4,
  playing_opportunity_priority: 5,
  academic_strength_priority: 5,
  max_annual_contribution_usd: 30000,
  contribution_state: 'STATED',
};

/**
 * THE PRODUCTION SCORES. Pursuit 77 from 65 / 100 / 83, partial evidence.
 *
 * `programmeView` multiplies by 100 and rounds, so these are the 0-1 values
 * that produce the integers on the observed card.
 */
const PRODUCTION_CARD = {
  programmeId: 'pid-ranked-1',
  name: SCHOOL,
  division: 'NCAA D3',
  status: 'RANKED',
  universe: 'SUPPORTED',
  recruitability: { state: 'SCOREABLE', value: 0.65, grade: 'PARTIAL', coverage: 0.82 },
  financial: { state: 'SCOREABLE', value: 1, grade: 'PARTIAL', coverage: 0.9 },
  opportunity: { state: 'SCOREABLE', value: 0.83, grade: 'MEASURED', coverage: 1 },
  rank: 1,
  band: 'PRIORITY_OUTREACH',
  pursuit: 0.77,
  pursuitGrade: 'PARTIAL',
};

const run = () => persistedRun({
  playerId: ATHLETE,
  sport: SPORT,
  programmes: [PRODUCTION_CARD, ...PROGRAMMES.filter((p) => p.name !== SCHOOL)],
});

/** Already a Specific School, and already written to. */
const relationship = {
  id: 'rel-1',
  athlete_id: ATHLETE,
  college_name: SCHOOL,
  sport: SPORT,
  college_id: 'col-1',
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
  division: 'NCAA D3',
  conference: 'Invented Athletic Conference',
  college_active: 1,
};

const contacted = {
  college_name: SCHOOL,
  sport: SPORT,
  contacted: true,
  has_confirmed_send: true,
  draft_only: false,
  confirmed_send_count: 1,
  coach_count: 1,
  revoked_count: 0,
  origins: ['manual'],
  engagement: {
    profile_visits: 0, last_visit_at: null, best_coverage_pct: 0,
    reply_recorded: false, reply_recorded_at: null,
  },
  coaches: [],
};

const ctx = (name, over = {}) => ({
  collegeName: name,
  sport: SPORT,
  division: 'NCAA D3',
  conference: 'Invented Athletic Conference',
  programStrength: { percentile: 0.3, topPercent: 70, division: 'NCAA D3', cohortSize: 316 },
  academicRating: 4.1,
  netPrice: 28400,
  rosterOnFile: true,
  eligibilityRuled: true,
  departures: {
    GOALKEEPER: { state: 'MEASURED', openings: 0, vacatedStarters: 0, eligibleToRemain: 3, positionRows: 3, unreadable: 0 },
    DEFENSE: { state: 'MEASURED', openings: 1, vacatedStarters: 1, eligibleToRemain: 8, positionRows: 9, unreadable: 0 },
    MIDFIELD: { state: 'MEASURED', openings: 2, vacatedStarters: 0, eligibleToRemain: 7, positionRows: 9, unreadable: 0 },
    FORWARD: { state: 'MEASURED', openings: 0, vacatedStarters: 0, eligibleToRemain: 5, positionRows: 5, unreadable: 0 },
  },
  departingPlayers: {
    GOALKEEPER: [],
    DEFENSE: [{ name: 'Invented Defender', classYear: 'Sr.', starter: true, starterKnown: true }],
    MIDFIELD: [
      { name: 'Invented Midfielder', classYear: 'Sr.', starter: false, starterKnown: true },
      { name: 'Invented Reserve', classYear: 'Gr.', starter: false, starterKnown: true },
    ],
    FORWARD: [],
  },
  ...over,
});

/**
 * The reasons the production card carried, with the evidence `render.js`
 * actually reads. `PLAYING_SHARE_NARROW` is the decimal-heavy sentence §2
 * names by example, and it is here so its absence from the default view is a
 * measured absence rather than an assumption.
 */
const REASONS = [
  {
    code: 'ATHLETIC_AT_OR_ABOVE_LEVEL',
    layer: 'recruitability',
    polarity: 'strength',
    band: 2,
    sub: 0,
    listLevel: false,
    evidence: {
      athletePercentile: 0.64, programmePercentile: 0.608, levelGap: 0.032, rating: 6,
    },
  },
  {
    code: 'COST_WITHIN_BUDGET',
    layer: 'financial',
    polarity: 'strength',
    band: 2,
    sub: 0,
    listLevel: false,
    evidence: { stated: 30000, cost: [28400, 28400], budget: [0, 30000] },
  },
  {
    code: 'POSITION_OPENING_MEASURED',
    layer: 'opportunity',
    polarity: 'strength',
    band: 2,
    sub: 0,
    listLevel: false,
    evidence: { vacatedStarters: 1, typicalStarters: 4, position: 'DEFENSE' },
  },
  {
    code: 'MARKET_INTERNATIONAL_HISTORY',
    layer: 'recruitability',
    polarity: 'strength',
    band: 3,
    sub: 0,
    listLevel: false,
    evidence: { share: 0.31, count: 9, total: 29 },
  },
  {
    code: 'ACADEMIC_PREFERENCE_STRONG',
    layer: 'opportunity',
    polarity: 'strength',
    band: 3,
    sub: 0,
    listLevel: false,
    evidence: { percentile: 0.78 },
  },
  /** The caveat ranking would bury, and §2 says must not be buried. */
  {
    code: 'AID_KNOWN_NONE',
    layer: 'financial',
    polarity: 'context',
    band: 4,
    sub: 0,
    listLevel: false,
    evidence: { rule: 'NCAA Division III' },
  },
  {
    code: 'INTERNATIONAL_COST_UNDERSTATED',
    layer: 'financial',
    polarity: 'context',
    band: 4,
    sub: 1,
    listLevel: false,
    evidence: {},
  },
  /** "0.5276 against a median of 0.5635" — the prose §2 asks us not to lead with. */
  {
    code: 'PLAYING_SHARE_NARROW',
    layer: 'opportunity',
    polarity: 'concern',
    band: 3,
    sub: 0,
    listLevel: false,
    evidence: {
      share: 0.5276, median: 0.5635, level: 'programme', strength: 'LIMITED',
    },
  },
];

function explanation(reasons = REASONS) {
  const layerReasons = { recruitability: [], financial: [], opportunity: [] };
  for (const r of reasons) if (layerReasons[r.layer]) layerReasons[r.layer].push(r);
  return {
    subject: {
      id: 'pid-ranked-1', name: SCHOOL, division: 'NCAA D3', rankingState: 'RANKED',
    },
    standing: { rank: 1, outOf: 828, poolSize: 1205 },
    reasons,
    layerReasons,
    nextChecks: [],
  };
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

function stubFetch({ contexts = ctx, programmeExplanation = explanation() } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    if (path.includes('/matchmaking/runs/current')) return ok(run());
    if (path.includes('/matchmaking/context')) {
      const url = new URL(path, 'http://x');
      const names = String(url.searchParams.get('names') ?? '').split('\u001F').filter(Boolean);
      return ok({
        entryYear: ENTRY_YEAR,
        sport: SPORT,
        programmes: names.map((n) => contexts(n)).filter(Boolean),
      });
    }
    if (path.includes('/matchmaking/programme')) {
      return ok({ programme: { name: SCHOOL, explanation: programmeExplanation }, rankedCount: 828 });
    }
    if (path.includes('/selections/overview')) return ok({ selections: [] });
    if (path.includes('/matchmaking/selections')) return ok({ selections: [] });
    if (path.includes('/colleges/search')) return ok({ results: [] });
    if (path.includes('/pending-manual-drafts')) return ok({ drafts: [] });
    if (path.includes('/contact-intelligence')) return ok({ programmes: [contacted] });
    if (path.includes('/matching-summary')) return ok({});
    if (path.includes('/evidence')) return ok({ evidence: { facts: [], signals: [] } });
    if (path.includes('/outreach')) {
      return ok({
        relationship, college: {}, coaches: [],
        contact: { allowed: true }, priorContact: [], contactIntelligence: null,
      });
    }
    if (path.includes('/programmes') && method === 'GET') return ok({ programmes: [relationship] });
    if (path.includes('/programmes')) return ok({ programme: relationship });
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

async function render() {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: [`/player/${ATHLETE}/matching`] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTabSwitch) }))),
    ));
  });
  await act(async () => { await new Promise((r) => { setTimeout(r, 20); }); });
}

const all = (sel) => Array.from(container.querySelectorAll(sel));
const cards = () => all('[data-testid^="programme-"]').filter((n) => n.dataset.testid.startsWith('programme-RANKED')
  || n.dataset.testid.startsWith('programme-SUPPORTED')
  || n.dataset.testid.startsWith('programme-UNSUPPORTED'));
const cardFor = (name) => cards().find((c) => c.textContent.includes(name));
const buttonIn = (scope, label) => Array.from(scope.querySelectorAll('button'))
  .find((b) => b.textContent.trim().startsWith(label));

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise((r) => { setTimeout(r, 20); }); });
}

async function expand(name = SCHOOL) {
  if (!cards().length) await render();
  const card = cardFor(name);
  await click(card.querySelector('[aria-expanded]'));
  return cardFor(name);
}

/** Document order: does `a` come before `b`? */
const before = (a, b) => {
  // eslint-disable-next-line no-bitwise
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
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

describe('A11.2 §1, §3. the card hierarchy', () => {
  it('H1. header, then the three scores, then the snapshot, then why', async () => {
    stubFetch();
    const card = await expand();

    const node = (t) => Array.from(card.querySelectorAll('*')).find((n) => n.textContent.trim() === t);
    const scores = node('Coach recruitability');
    const snapshot = card.querySelector('[data-testid="programme-snapshot"]');
    const why = card.querySelector('[data-testid="explanation-overall"]');

    expect(scores, 'the three primary scores render').toBeTruthy();
    expect(snapshot, 'the snapshot renders').toBeTruthy();
    expect(why, 'the concise explanation renders').toBeTruthy();

    before(scores, snapshot);
    before(snapshot, why);
  });

  it('H2. the three primary V2 scores are all present and all numeric', async () => {
    stubFetch();
    const card = await expand();
    const body = card.textContent;
    for (const label of ['Coach recruitability', 'Financial viability', 'Athlete opportunity']) {
      expect(body, label).toContain(label);
    }
    /** Pursuit 77 over 65 / 100 / 83 — the observed production card. */
    expect(body).toContain('77');
    expect(body).toContain('65');
    expect(body).toContain('83');
  });

  it('H3. the snapshot carries strength, rating and departures by position', async () => {
    stubFetch();
    const card = await expand();
    const snap = card.querySelector('[data-testid="programme-snapshot"]');

    expect(snap.querySelector('[data-testid="program-strength"]').textContent)
      .toContain('Top 70%');
    expect(snap.querySelector('[data-testid="program-strength"]').textContent, 'names its division')
      .toContain('NCAA D3');
    expect(snap.querySelector('[data-testid="program-strength"]').textContent, 'never the national /10')
      .not.toContain('/10');
    expect(snap.querySelector('[data-testid="academic-rating"]').textContent).toBe('4.1/10');

    /** GK 0 · DEF 1 · MID 2 · FWD 0, in §3's labels and §3's order. */
    const labels = Array.from(snap.querySelectorAll('[data-testid^="graduating-"] dt'))
      .map((n) => n.textContent);
    expect(labels).toEqual(['GK', 'DEF', 'MID', 'FWD']);
    expect(snap.querySelector('[data-testid="graduating-GOALKEEPER"]').textContent).toContain('0');
    expect(snap.querySelector('[data-testid="graduating-DEFENSE"]').textContent).toContain('1');
    expect(snap.querySelector('[data-testid="graduating-MIDFIELD"]').textContent).toContain('2');
  });

  it('H4. conference and net price are on the same row, not dropped', async () => {
    stubFetch();
    const card = await expand();
    const snap = card.querySelector('[data-testid="programme-snapshot"]');
    /**
     * §1C names three things. These two shipped in A11, are factual, and are
     * what a consultant reaches for next — deleting information to tidy a
     * layout is not a presentation refinement, so the merge gate asserts they
     * are still here rather than leaving it to a screenshot.
     */
    expect(snap.textContent).toContain('Conference');
    expect(snap.textContent).toContain('Invented Athletic Conference');
    expect(snap.textContent).toContain('Net price');
    expect(snap.textContent).toContain('$28,400');
  });

  it('H5. an absent conference or net price is an em dash, never a zero', async () => {
    stubFetch({ contexts: (n) => ctx(n, { conference: null, netPrice: null }) });
    const card = await expand();
    const snap = card.querySelector('[data-testid="programme-snapshot"]');
    expect(snap.textContent, 'no invented $0').not.toContain('$0');
    expect(snap.textContent).toContain('—');
  });
});

describe('A11.2 §1D, §1E, §6. one summary open, one investigation closed', () => {
  it('D1. detailed reasoning is COLLAPSED on a freshly expanded card', async () => {
    stubFetch();
    const card = await expand();

    expect(card.querySelector('[data-testid="explanation-layers"]'), 'not rendered').toBeNull();
    const toggle = buttonIn(card, SHOW_DETAIL);
    expect(toggle, 'the control is there').toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('D2. the concise summary stays short — §1D asks for 1-3 statements', async () => {
    stubFetch();
    const card = await expand();
    const rows = card.querySelectorAll('[data-testid="explanation-overall-reasons"] [data-reason]');
    /**
     * Three ranked reasons plus the financial caveats §2 requires. The bound
     * that matters is that it is a handful of sentences, not fourteen.
     */
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.length, 'a summary, not the whole evidence set').toBeLessThanOrEqual(6);
    expect(rows.length).toBeLessThan(REASONS.length);
  });

  it('D3. the evidence appears after interaction, and is not deleted', async () => {
    stubFetch();
    let card = await expand();
    await click(buttonIn(card, SHOW_DETAIL));
    card = cardFor(SCHOOL);

    expect(card.querySelector('[data-testid="explanation-layers"]')).toBeTruthy();
    for (const layer of ['recruitability', 'financial', 'opportunity']) {
      const node = card.querySelector(`[data-testid="explanation-layer-${layer}"]`);
      expect(node, layer).toBeTruthy();
      expect(node.textContent.trim().length, `${layer} says something`).toBeGreaterThan(10);
    }
    expect(buttonIn(card, HIDE_DETAIL), 'the control inverts').toBeTruthy();
  });

  it('D4. opening detailed reasoning makes NO further request', async () => {
    stubFetch();
    const card = await expand();
    const callsBefore = global.fetch.mock.calls.length;
    await click(buttonIn(card, SHOW_DETAIL));
    expect(global.fetch.mock.calls.length, 'already in memory').toBe(callsBefore);
  });

  it('D5. the control is a real button with a correct aria-expanded state', async () => {
    stubFetch();
    let card = await expand();
    let toggle = buttonIn(card, SHOW_DETAIL);

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type'), 'never submits a form').toBe('button');
    expect(toggle.getAttribute('aria-controls'), 'names its body').toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await click(toggle);
    card = cardFor(SCHOOL);
    toggle = buttonIn(card, HIDE_DETAIL);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    /** The body it names is the one that appeared. */
    expect(card.querySelector(`#${CSS.escape(toggle.getAttribute('aria-controls'))}`)).toBeTruthy();
  });
});

describe('A11.2 §2. plain language, without losing the claim', () => {
  it('P1. decimal-heavy engine prose is ABSENT from the default view', async () => {
    stubFetch();
    const card = await expand();
    const body = card.textContent;

    expect(body, 'the share-against-median figures').not.toContain('0.5276');
    expect(body).not.toContain('0.5635');
    expect(body, 'no raw four-decimal values anywhere by default').not.toMatch(/\d\.\d{3,}/);
    expect(body).not.toMatch(/percentile point/i);
  });

  it('P2. the same finding IS stated, in words', async () => {
    stubFetch();
    const card = await expand();
    const summary = card.querySelector('[data-testid="explanation-overall-reasons"]').textContent;
    /**
     * The narrow-share reason is a concern and ranks below the three
     * strengths, so it is not expected in the summary — what must hold is
     * that where a plain wording was used it still carries the finding. The
     * opening and the cost do appear, and neither carries a raw decimal.
     */
    expect(summary).toMatch(/opening|place/i);
    expect(summary).toMatch(/cost|contribution/i);
  });

  it('P3. the exact figures survive INSIDE detailed reasoning', async () => {
    stubFetch();
    let card = await expand();
    await click(buttonIn(card, SHOW_DETAIL));
    card = cardFor(SCHOOL);

    const detail = card.querySelector('[data-testid="explanation-layers"]').textContent;
    expect(detail, 'the engine\'s own sentence, figures and all').toContain('0.5276');
    expect(detail).toContain('0.5635');
  });

  it('P3b. no rendered sentence contains a hole where evidence should be', async () => {
    stubFetch();
    let card = await expand();
    await click(buttonIn(card, SHOW_DETAIL));
    card = cardFor(SCHOOL);
    /**
     * Found in the browser: a fixture carrying an unrecognised evidence value
     * rendered "measured undefined", and every assertion still passed because
     * each one looked for something that WAS there. A sentence with a hole in
     * it is a defect whether the hole came from a fixture or from a scorer.
     */
    expect(card.textContent).not.toContain('undefined');
    expect(card.textContent).not.toContain('NaN');
    expect(card.textContent).not.toContain('[object Object]');
  });

  it('P4. FINANCIAL CAVEATS survive into the default view — the critical one', async () => {
    stubFetch();
    const card = await expand();
    const summary = card.querySelector('[data-testid="explanation-overall-reasons"]');
    const codes = Array.from(summary.querySelectorAll('[data-reason]')).map((n) => n.dataset.reason);

    expect(codes, 'D3 cannot award athletic money').toContain('AID_KNOWN_NONE');
    expect(codes, 'net price understates the international cost').toContain('INTERNATIONAL_COST_UNDERSTATED');
    expect(summary.textContent).toMatch(/does not permit athletic scholarships/i);
    expect(summary.textContent).toMatch(/international/i);
  });

  it('P5. a plain sentence never reads more confidently than the engine\'s', async () => {
    stubFetch();
    const card = await expand();
    const body = card.textContent;
    /** The claims A11 §7 forbids outright, re-asserted against the new prose. */
    expect(body).not.toMatch(/guarantee|guaranteed|will start|certain to|assured/i);
    expect(body).not.toMatch(/wants? (the|this) athlete/i);
    expect(body).not.toMatch(/\bscholarship (is )?available\b/i);
  });
});

describe('A11.2 §7. status chips, unchanged', () => {
  it('S1. the production chips all render, and no empty ones', async () => {
    stubFetch();
    await render();
    const card = cardFor(SCHOOL);
    const body = card.textContent;

    expect(body).toContain('NCAA D3');
    expect(body).toContain('Priority outreach');
    expect(body).toContain('Specific school');
    expect(body).toContain('Sent');
    expect(body, 'the default stance is not a chip').not.toContain('Campaign may contact');
    expect(body).not.toContain('No contact recorded');
  });
});

describe('A11.2 §4. View players', () => {
  it('V1. names are not shown by default, and appear on request', async () => {
    stubFetch();
    let card = await expand();
    expect(card.textContent, 'no names by default').not.toContain('Invented Defender');

    await click(card.querySelector('[data-testid="view-graduating-players"]'));
    card = cardFor(SCHOOL);
    expect(card.querySelector('[data-testid="graduating-names"]')).toBeTruthy();
    expect(card.textContent).toContain('Invented Defender');
  });

  it('V2. NO action is rendered when no identities are available — §4', async () => {
    stubFetch({
      contexts: (n) => ctx(n, { departingPlayers: null }),
    });
    const card = await expand();
    expect(
      card.querySelector('[data-testid="view-graduating-players"]'),
      'no fake or disabled control',
    ).toBeNull();
    /** The counts are still there; only the names are not. */
    expect(card.querySelector('[data-testid="graduating-DEFENSE"]').textContent).toContain('1');
  });

  it('V3. unknown departures stay "Not established", never 0 — §3', async () => {
    stubFetch({
      contexts: (n) => ctx(n, {
        rosterOnFile: false,
        departures: Object.fromEntries(['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'].map((p) => [p, {
          state: 'NO_ROSTER', openings: 0, vacatedStarters: 0, eligibleToRemain: 0, positionRows: 0, unreadable: 0,
        }])),
        departingPlayers: null,
      }),
    });
    const card = await expand();
    for (const pos of ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD']) {
      const cell = card.querySelector(`[data-testid="graduating-${pos}"]`);
      expect(cell.textContent, pos).toContain(NOT_ESTABLISHED);
      expect(cell.textContent.replace(NOT_ESTABLISHED, ''), `${pos} shows no digit`).not.toMatch(/\d/);
    }
  });
});

describe('A11.2 §9. responsiveness', () => {
  /**
   * jsdom computes no layout, so this asserts the CLASS CONTRACT that
   * produces the behaviour rather than pretending to measure pixels: the
   * snapshot is two columns before `sm` and four after, and the departures
   * row wraps rather than forcing four columns at 375px. A browser check
   * covers what this cannot.
   */
  it('W1. the snapshot stacks two-up on a phone and four-up from sm', async () => {
    stubFetch();
    const card = await expand();
    const grid = card.querySelector('[data-testid="programme-context"]');
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('sm:grid-cols-4');
  });

  it('W2. the departures row wraps instead of overflowing', async () => {
    stubFetch();
    const card = await expand();
    const row = card.querySelector('[data-testid="graduating-players"] dl');
    expect(row.className).toContain('flex-wrap');
  });

  it('W3. Program Strength is never clipped — it would lose its division', async () => {
    stubFetch();
    const card = await expand();
    const strength = card.querySelector('[data-testid="program-strength"]');
    /**
     * Found in the browser at 375px, where this read "Top 70% in NCAA…".
     * A percentile without the division it is relative to is the national
     * /10 problem again, which is the whole reason A11.1 replaced it.
     */
    expect(strength.className, 'wraps rather than truncating').not.toContain('truncate');
    expect(strength.textContent).toContain('NCAA D3');
  });

  it('W4. nothing on the card asks for a fixed width', async () => {
    stubFetch();
    const card = await expand();
    const fixed = Array.from(card.querySelectorAll('*'))
      .filter((n) => /\bw-\[\d|\bmin-w-\[\d/.test(n.className?.baseVal ?? n.className ?? ''));
    expect(fixed.map((n) => n.className), 'no hard pixel widths to overflow 375px').toEqual([]);
  });
});
