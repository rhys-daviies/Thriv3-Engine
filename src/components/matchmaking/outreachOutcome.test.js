// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import OutreachOutcomePanel from './OutreachOutcomePanel';
import SelectionsOverviewPanel from './SelectionsOverviewPanel';
import {
  outcomeStateView, selectionView, observationView, confidenceNote,
  attributeSummary, kindLabel, NO_OBSERVATION, FORBIDDEN_ABSENCE_PHRASES,
  selectionRowView, outreachProgress, OUTREACH_PROGRESS,
} from '@/lib/outreachOutcomeView';

/**
 * THE OPERATOR SURFACE — A9.6 §U.
 *
 * The property that matters most is negative, exactly as it was in A9.5: an
 * axis with NO observation must never acquire a sentence claiming one. "No
 * reply yet" and "Not interested" are different claims about the world, and
 * only one of them has any evidence behind it.
 */

let container;
let root;
let calls;

const json = (payload, { status = 200, ok = true } = {}) => ({
  ok, status, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

const VOCABULARY = {
  categories: {
    ATHLETE_OUTCOME: 'ATHLETE_OUTCOME',
    PROGRAMME_INTEREST: 'PROGRAMME_INTEREST',
    RECRUITING_INTELLIGENCE: 'RECRUITING_INTELLIGENCE',
  },
  kinds: [
    { kind: 'POSITIVE_REPLY', category: 'PROGRAMME_INTEREST', required: [], optional: [] },
    { kind: 'POSITION_FILLED', category: 'RECRUITING_INTELLIGENCE', required: ['position'], optional: ['recruitingClassYear'] },
    { kind: 'COMMITTED', category: 'ATHLETE_OUTCOME', required: [], optional: [] },
  ],
};

const PLAYER = { id: 'player-1', full_name: 'Test Athlete' };

const SELECTION = {
  id: 'sel-1',
  collegeName: 'Lindenwood',
  sport: 'mens-soccer',
  status: 'RANKED',
  rank: 4,
  band: 'Priority outreach',
  source: 'TOP_100',
  selectedAt: '2026-09-01T10:00:00.000Z',
  runWasStale: false,
};

const EMPTY_STATE = {
  programmeInterest: null, recruitingNeed: null, athleteOutcome: null,
  observationCount: 0, effectiveCount: 0,
};

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts) => {
    const method = opts?.method ?? 'GET';
    calls.push({ path: String(path), method, body: opts?.body ? JSON.parse(opts.body) : null });
    const res = await handler(String(path), method);
    if (res) return res;
    throw new Error(`unstubbed ${method} ${path}`);
  }));
}

const mount = (ui) => act(() => { root.render(ui); });
const text = () => container.textContent;
const find = (sel) => container.querySelector(sel);
const all = (sel) => [...container.querySelectorAll(sel)];
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

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
});

/* ------------------------------------------------------------------ */
/* U1-U6. The view model, without a browser                           */
/* ------------------------------------------------------------------ */

describe('A9.6 §U. absence is never rendered as a negative', () => {
  it('U1. an empty projection reads as "no observation", never as a refusal', () => {
    const v = outcomeStateView(EMPTY_STATE);
    expect(v.programmeInterest.label).toBe(NO_OBSERVATION.programmeInterest);
    expect(v.recruitingNeed.label).toBe(NO_OBSERVATION.recruitingNeed);
    expect(v.athleteOutcome.label).toBe(NO_OBSERVATION.athleteOutcome);
    expect(v.programmeInterest.observed).toBe(false);
  });

  it('U2. no empty-state phrase is one of the banned negatives', () => {
    for (const phrase of Object.values(NO_OBSERVATION)) {
      for (const banned of FORBIDDEN_ABSENCE_PHRASES) {
        expect(phrase.toLowerCase()).not.toContain(banned);
      }
    }
  });

  it('U3. an observed negative IS allowed to say so', () => {
    const v = outcomeStateView({
      ...EMPTY_STATE,
      programmeInterest: { kind: 'DECLINED_ATHLETE', attributes: null, observed_at: '2026-09-02T00:00:00Z', review_state: 'CONFIRMED', classifier_method: 'MANUAL', id: 'o1' },
      observationCount: 1, effectiveCount: 1,
    });
    expect(v.programmeInterest.observed).toBe(true);
    expect(v.programmeInterest.label).toBe('Declined the athlete');
  });

  it('U4. a rank always travels with its denominator', () => {
    expect(selectionView(SELECTION, { universeSize: 828 }).rankLabel).toBe('#4 of 828');
  });

  it('U5. an unranked selection says so in words, never as a zero or a last place', () => {
    const v = selectionView({ ...SELECTION, rank: null, band: null, status: 'UNSUPPORTED_ASSOCIATION' }, { universeSize: 828 });
    expect(v.ranked).toBe(false);
    expect(v.rankLabel).toMatch(/not ranked/i);
    expect(v.rankLabel).not.toMatch(/#0|\b0\b|last/i);
  });

  it('U6. an unreviewed machine classification is marked as one', () => {
    expect(confidenceNote({ classifier_method: 'AI_ASSISTED', review_state: 'UNREVIEWED' }))
      .toMatch(/not yet reviewed/i);
    expect(confidenceNote({ classifier_method: 'MANUAL', review_state: 'CONFIRMED' })).toBeNull();
  });

  it('U7. attributes render only what is present', () => {
    expect(attributeSummary({ position: 'GOALKEEPER' })).toBe('goalkeeper');
    expect(attributeSummary({ position: 'MIDFIELD', recruitingClassYear: 2027 }))
      .toBe('midfielder · class of 2027');
    expect(attributeSummary(null)).toBe('');
    // An absent class year is absent — never "this year".
    expect(attributeSummary({ position: 'FORWARD' })).not.toMatch(/class/);
  });

  it('U8. a superseded observation is counted, not hidden', () => {
    const v = outcomeStateView({ ...EMPTY_STATE, observationCount: 4, effectiveCount: 2 });
    expect(v.supersededCount).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* U9-U14. The surface                                                */
/* ------------------------------------------------------------------ */

describe('A9.6 §U. the operator surface verifies the data path', () => {
  const stubWith = (state, observations = []) => stubFetch((path, method) => {
    if (path.includes('/observations/vocabulary')) return json(VOCABULARY);
    if (path.includes('/observations') && method === 'GET') return json({ observations, state });
    if (path.includes('/observations') && method === 'POST') return json({ changed: true, observation: {} }, { status: 201 });
    return null;
  });

  it('U9. the selection\'s frozen rank is shown, with its denominator', async () => {
    stubWith(EMPTY_STATE);
    mount(createElement(OutreachOutcomePanel, { player: PLAYER, selection: SELECTION, universeSize: 828 }));
    await flush();
    expect(find('[data-testid="outcome-rank"]').textContent).toBe('#4 of 828');
    expect(text()).toContain('Lindenwood');
  });

  /**
   * SCOPED TO THE AXES, AND THE FIRST VERSION OF THIS TEST WAS NOT.
   *
   * Banning the phrases across the whole panel failed, correctly: "Position
   * filled" appears in the list of kinds an operator may RECORD, where it is
   * not a claim about this programme but an option. The rule was always about
   * what the three axes ASSERT when nothing has been observed, and asserting
   * it over the whole subtree would have made the vocabulary unrenderable.
   */
  it('U10. a programme with no observations shows three honest empty axes', async () => {
    stubWith(EMPTY_STATE);
    mount(createElement(OutreachOutcomePanel, { player: PLAYER, selection: SELECTION }));
    await flush();

    const axes = ['axis-programme', 'axis-need', 'axis-athlete']
      .map((id) => find(`[data-testid="${id}"]`));
    expect(axes.every(Boolean)).toBe(true);

    for (const axis of axes) {
      const body = axis.textContent.toLowerCase();
      for (const banned of FORBIDDEN_ABSENCE_PHRASES) expect(body).not.toContain(banned);
    }
    expect(find('[data-testid="axis-programme"]').textContent)
      .toContain(NO_OBSERVATION.programmeInterest);
    expect(find('[data-testid="axis-need"]').textContent)
      .toContain(NO_OBSERVATION.recruitingNeed);
  });

  it('U11. the kind list comes from the server, not from a copy in the client', async () => {
    stubWith(EMPTY_STATE);
    mount(createElement(OutreachOutcomePanel, { player: PLAYER, selection: SELECTION }));
    await flush();
    const options = all('#observation-kind option').map((o) => o.value).filter(Boolean);
    expect(options).toEqual(['POSITIVE_REPLY', 'POSITION_FILLED', 'COMMITTED']);
    expect(calls.some((c) => c.path.includes('/observations/vocabulary'))).toBe(true);
  });

  it('U12. recording posts the selection id, so the observation keeps its provenance', async () => {
    stubWith(EMPTY_STATE);
    mount(createElement(OutreachOutcomePanel, { player: PLAYER, selection: SELECTION }));
    await flush();

    const select = find('#observation-kind');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    act(() => { setter.call(select, 'POSITIVE_REPLY'); select.dispatchEvent(new Event('change', { bubbles: true })); });

    const button = all('button').find((b) => b.textContent.includes('Record'));
    click(button);
    await flush();

    const post = calls.find((c) => c.method === 'POST');
    expect(post.body.matchmakingSelectionId).toBe('sel-1');
    expect(post.body.collegeName).toBe('Lindenwood');
    expect(post.body.sport).toBe('mens-soccer');
    expect(post.body.classifierMethod).toBe('MANUAL');
  });

  it('U13. this surface never asks the server to compute a ranking', async () => {
    stubWith(EMPTY_STATE);
    mount(createElement(OutreachOutcomePanel, { player: PLAYER, selection: SELECTION, universeSize: 828 }));
    await flush();
    for (const c of calls) {
      expect(c.path).not.toMatch(/\/matchmaking($|\?)/);
      if (c.method === 'POST') expect(c.path).toContain('/observations');
    }
  });

  it('U14. a stale-run selection says so rather than hiding it', async () => {
    stubWith(EMPTY_STATE);
    mount(createElement(OutreachOutcomePanel, {
      player: PLAYER, selection: { ...SELECTION, runWasStale: true },
    }));
    await flush();
    expect(find('[data-testid="outcome-stale"]')).not.toBeNull();
  });

  it('U15. an unreviewed machine classification offers Confirm and Reject', async () => {
    stubWith(
      { ...EMPTY_STATE, observationCount: 1, effectiveCount: 1 },
      [{
        id: 'obs-1', kind: 'NEGATIVE_REPLY', attributes: null, category: 'PROGRAMME_INTEREST',
        observed_at: '2026-09-05T00:00:00.000Z', note: null,
        classifier_method: 'AI_ASSISTED', review_state: 'UNREVIEWED', correction: null,
      }],
    );
    mount(createElement(OutreachOutcomePanel, { player: PLAYER, selection: SELECTION }));
    await flush();
    const labels = all('button').map((b) => b.textContent);
    expect(labels.some((l) => l.includes('Confirm'))).toBe(true);
    expect(labels.some((l) => l.includes('Reject'))).toBe(true);
    expect(text()).toMatch(/not yet reviewed/i);
  });

  it('U16. a manual observation is not offered a review control', async () => {
    stubWith(
      { ...EMPTY_STATE, observationCount: 1, effectiveCount: 1 },
      [{
        id: 'obs-2', kind: 'POSITIVE_REPLY', attributes: null, category: 'PROGRAMME_INTEREST',
        observed_at: '2026-09-05T00:00:00.000Z', note: null,
        classifier_method: 'MANUAL', review_state: 'CONFIRMED', correction: null,
      }],
    );
    mount(createElement(OutreachOutcomePanel, { player: PLAYER, selection: SELECTION }));
    await flush();
    const labels = all('button').map((b) => b.textContent);
    expect(labels.some((l) => l.includes('Confirm'))).toBe(false);
  });

  it('U17. a kind needing a position asks for one before it can be recorded', async () => {
    stubWith(EMPTY_STATE);
    mount(createElement(OutreachOutcomePanel, { player: PLAYER, selection: SELECTION }));
    await flush();

    const select = find('#observation-kind');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    act(() => { setter.call(select, 'POSITION_FILLED'); select.dispatchEvent(new Event('change', { bubbles: true })); });

    expect(find('[aria-label="Position"]')).not.toBeNull();
    const button = all('button').find((b) => b.textContent.includes('Record'));
    expect(button.disabled).toBe(true);
  });
});

describe('A9.6 §Z. the labels themselves carry no engine vocabulary', () => {
  it('Z9. no observation label mentions a rank, a pursuit or an evidence grade', () => {
    const kinds = VOCABULARY.kinds.map((k) => k.kind)
      .concat(['NEGATIVE_REPLY', 'ROSTER_COMPLETE', 'ATHLETE_WITHDREW', 'FINANCIAL_OFFER']);
    for (const k of kinds) {
      const label = kindLabel(k).toLowerCase();
      for (const word of ['rank', 'pursuit', 'recruitability', 'measured', 'partial', 'score', '#']) {
        expect(label).not.toContain(word);
      }
    }
  });

  it('Z10. an observation view never invents a correction it was not given', () => {
    const v = observationView({
      id: 'x', kind: 'POSITIVE_REPLY', attributes: null, observed_at: '2026-01-01T00:00:00Z',
      classifier_method: 'MANUAL', review_state: 'CONFIRMED', correction: null,
    });
    expect(v.isCorrection).toBe(false);
    expect(v.correction).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* §K. The selections surface                                         */
/* ------------------------------------------------------------------ */

describe('A9.7 §K. the selections overview', () => {
  const ROW = {
    selectionId: 'sel-1',
    collegeName: 'Lindenwood',
    sport: 'mens-soccer',
    status: 'RANKED',
    rank: 4,
    band: 'Priority outreach',
    source: 'TOP_100',
    runId: 'run-a',
    runComputedAt: '2026-09-01T10:00:00.000Z',
    runWasStale: false,
    selectedAt: '2026-09-01T10:05:00.000Z',
    outreach: { messages: 0, accepted: 0, coaches: 0, lastSentAt: null },
    reply: { replies: 0, lastReplyAt: null },
    latest: { programmeInterest: null, recruitingNeed: null, athleteOutcome: null },
  };

  const stubOverview = (selections) => stubFetch((path) => {
    if (path.includes('/selections/overview')) return json({ playerId: PLAYER.id, selections });
    return null;
  });

  it('K9. a sent-but-unanswered pursuit says "awaiting a reply", never "no interest"', () => {
    const v = selectionRowView({
      ...ROW,
      outreach: { messages: 1, accepted: 1, coaches: 1, lastSentAt: 'x' },
    });
    expect(v.progress).toBe(OUTREACH_PROGRESS.SENT);
    for (const banned of FORBIDDEN_ABSENCE_PHRASES) {
      expect(v.progress.toLowerCase()).not.toContain(banned);
    }
  });

  it('K10. the four progress states are distinct and none is a judgement', () => {
    const at = (outreach, reply) => outreachProgress({ outreach, reply });
    expect(at({ messages: 0, accepted: 0 }, { replies: 0 })).toBe(OUTREACH_PROGRESS.NOT_CONTACTED);
    expect(at({ messages: 1, accepted: 0 }, { replies: 0 })).toBe(OUTREACH_PROGRESS.DRAFTED);
    expect(at({ messages: 1, accepted: 1 }, { replies: 0 })).toBe(OUTREACH_PROGRESS.SENT);
    expect(at({ messages: 1, accepted: 1 }, { replies: 1 })).toBe(OUTREACH_PROGRESS.REPLIED);
    const all = Object.values(OUTREACH_PROGRESS);
    expect(new Set(all).size).toBe(4);
    for (const label of all) {
      for (const banned of FORBIDDEN_ABSENCE_PHRASES) {
        expect(label.toLowerCase()).not.toContain(banned);
      }
    }
  });

  it('K11. the row shows the selection\'s frozen rank with its denominator', async () => {
    stubOverview([ROW]);
    mount(createElement(SelectionsOverviewPanel, { player: PLAYER, universeSize: 828 }));
    await flush();
    expect(find('[data-testid="selection-rank"]').textContent).toBe('#4 of 828');
    expect(text()).toContain('Lindenwood');
    expect(find('[data-testid="selection-progress"]').textContent)
      .toBe(OUTREACH_PROGRESS.NOT_CONTACTED);
  });

  it('K12. an axis with nothing reviewed renders nothing at all', async () => {
    stubOverview([ROW]);
    mount(createElement(SelectionsOverviewPanel, { player: PLAYER }));
    await flush();
    expect(find('[data-testid="selection-latest"]')).toBeNull();
    const body = text().toLowerCase();
    for (const banned of FORBIDDEN_ABSENCE_PHRASES) expect(body).not.toContain(banned);
  });

  it('K13. a reviewed reading is shown as a label, in plain words', async () => {
    stubOverview([{
      ...ROW,
      outreach: { messages: 1, accepted: 1, coaches: 1, lastSentAt: 'x' },
      reply: { replies: 1, lastReplyAt: 'y' },
      latest: {
        programmeInterest: { kind: 'REQUESTED_FILM' },
        recruitingNeed: null,
        athleteOutcome: null,
      },
    }]);
    mount(createElement(SelectionsOverviewPanel, { player: PLAYER }));
    await flush();
    expect(find('[data-testid="selection-latest"]').textContent).toContain('Asked for film');
    expect(find('[data-testid="selection-progress"]').textContent).toBe(OUTREACH_PROGRESS.REPLIED);
  });

  it('K14. an athlete with no selections is told so, and nothing is implied', async () => {
    stubOverview([]);
    mount(createElement(SelectionsOverviewPanel, { player: PLAYER }));
    await flush();
    expect(find('[data-testid="selections-empty"]')).not.toBeNull();
    // Phase 5 (#14): it no longer promises selecting from the ranked list (cards cannot select).
    expect(text()).toMatch(/nothing is sent by recording it/i);
  });

  it('K15. this surface asks the server to compute nothing', async () => {
    stubOverview([ROW]);
    mount(createElement(SelectionsOverviewPanel, { player: PLAYER }));
    await flush();
    for (const c of calls) {
      expect(c.method).toBe('GET');
      expect(c.path).not.toMatch(/\/matchmaking($|\?)/);
    }
  });
});
