// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import { ZERO } from '@/lib/__fixtures__/recruitingSignals.js';
import { RELATIONSHIP_OUTREACH } from '@/lib/outreachLabels';

/**
 * ONE ATHLETE + ONE PROGRAMME RELATIONSHIP → ONE MANUAL OUTREACH CAPABILITY.
 *
 * The same workflow, reachable from wherever an operator is already looking at
 * a relationship. Two properties carry the weight:
 *
 *   IT NEEDS A RELATIONSHIP. A ranked school nobody has said anything about
 *   has no row to scope the workflow to, and opening it would have to invent
 *   one as a side effect of a click. Those cards keep the ordinary composer.
 *
 *   THERE IS ONE DIALOG. Every surface routes to the workspace's single
 *   instance rather than mounting its own, which is what stops a page of
 *   twenty cards from being a page of twenty dialogs.
 */

const ATHLETE = 'athlete-1';
const PAGE_SIZE = 20;

const college = (n, name) => ({
  id: `col-${n}`, name, division: 'NCAA D1', match_score: 200 - n, coaching_staff: [],
  breakdown: [{ key: 'roster', label: 'Roster opportunity', weight: 0.2, score: 0.5, contribution: 10, confidence: 'measured' }],
});

const RECOMMENDATIONS = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((n, i) => college(i + 1, n));
const RESERVE = [college(101, 'Foxtrot')];

const relationship = (over = {}) => ({
  id: `rel-${over.college_name ?? 'Alpha'}`,
  athlete_id: ATHLETE,
  college_name: 'Alpha',
  sport: 'mens-soccer',
  college_id: 'col-1',
  request_state: 'none',
  flagged: false,
  flag_reason: null,
  visibility: 'default',
  contact_stance: 'default',
  note: null,
  division: 'NCAA D1',
  conference: 'ACC',
  ...over,
});

let container;
let root;
let calls;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

/** The dialog's own context fetch, so opening it can be observed end to end. */
function outreachContext(rel, over = {}) {
  return {
    relationship: rel,
    college: { id: rel.college_id, name: rel.college_name, sport: 'mens-soccer', division: 'NCAA D1' },
    coaches: [{ coach_id: 'coach-1', name: 'A Coach', email: 'a@alpha.test', title: 'Head Coach', email_status: 'verified' }],
    contact: { allowed: true, stance: rel.contact_stance, reason: null },
    priorContact: [],
    ...over,
  };
}

function stubFetch({ programmes = [], context = null } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (/\/programmes\/[^/]+\/outreach/.test(path)) {
      return ok(context ?? outreachContext(programmes[0] ?? relationship()));
    }
    if (path.includes('/matching-summary')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
    }
    if (path.includes('/colleges/search')) return ok({ results: [] });
    if (path.includes('/programmes') && method !== 'GET') {
      // A relationship write answers with the updated row, as the real route
      // does — the hook absorbs it in place.
      const id = path.split('/programmes/')[1];
      const base = programmes.find((r) => r.id === id) ?? programmes[0] ?? relationship();
      return ok({ programme: { ...base, ...body } });
    }
    if (path.includes('/programmes')) return ok({ programmes });
    if (path.includes('/evidence')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, { sentences: [], offers: [] }])));
    }
    if (path.includes('/coaches/email-status')) return ok({});
    return ok({});
  }));
}

function Shell({ recommendations, reserve }) {
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer', full_name: 'Test Athlete' });
  const [page, setPage] = useState(1);
  const workspace = useActionableRecommendations({ playerId: player.id, recommendations, reserve });
  return createElement(Outlet, {
    context: {
      player, setPlayer: () => {}, recommendations, reserve, summary: '',
      ...workspace, analyzing: false, phase: 0,
      progress: { current: 0, total: 0, school: '' },
      page, setPage, onAnalyze: async () => {},
    },
  });
}

async function render({ recommendations = RECOMMENDATIONS, reserve = RESERVE } = {}) {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: [`/player/${ATHLETE}/matching`] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell, { recommendations, reserve }) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTab) }))),
    ));
  });
}

/** The dialog portals out of the mount node, so both are searched. */
const everywhere = () => `${container.textContent} ${document.body.textContent}`;
const buttonsIn = (el) => Array.from(el.querySelectorAll('button'));
/**
 * `container` is inside `document.body`, so searching both double-counts every
 * button. The body alone covers the page and the portalled dialog.
 */
const manualButtons = () => buttonsIn(document.body)
  .filter((b) => b.textContent.includes(RELATIONSHIP_OUTREACH));
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const cardFor = (name) => Array.from(container.querySelectorAll('[data-testid="programme-relationship"]'))
  .find((el) => el.closest('div[class*="rounded"]')?.textContent.includes(name));
const tab = (label) => Array.from(container.querySelectorAll('[role="tab"]'))
  .find((t) => t.textContent.includes(label));
const contextCalls = () => calls.filter((c) => /\/programmes\/[^/]+\/outreach/.test(c.path));

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

describe('a ranked programme WITHOUT a relationship', () => {
  it('offers no relationship-scoped outreach action', async () => {
    stubFetch();
    await render();
    // Four cards, no relationships, no manual outreach anywhere.
    expect(container.querySelectorAll('[data-testid="programme-relationship"]')).toHaveLength(4);
    expect(manualButtons()).toHaveLength(0);
  });

  it('keeps its ordinary composer path', async () => {
    stubFetch();
    await render();
    // The card's own "Email Coaches" button is what a school nobody has said
    // anything about uses. This slice does not take it away.
    expect(everywhere()).toContain('Message all head coaches');
  });

  it('creates no relationship row as a side effect of rendering', async () => {
    stubFetch();
    await render();
    // Nothing was written. A relationship is something an operator records,
    // not something a screen produces by being looked at.
    expect(calls.filter((c) => c.method === 'POST' && c.path.includes('/programmes'))).toHaveLength(0);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});

describe('a ranked programme WITH a relationship', () => {
  for (const [label, rel] of [
    ['flagged', relationship({ flagged: true, flag_reason: 'knows the coach' })],
    ['specifically requested', relationship({ request_state: 'requested' })],
    ['manual_only', relationship({ contact_stance: 'manual_only' })],
    ['do_not_contact', relationship({ contact_stance: 'do_not_contact' })],
  ]) {
    it(`offers relationship outreach when it is ${label}`, async () => {
      stubFetch({ programmes: [rel] });
      await render();
      const card = cardFor('Alpha');
      expect(buttonsIn(card).some((b) => b.textContent.includes(RELATIONSHIP_OUTREACH))).toBe(true);
    });
  }

  it('opens the dialog against that relationship’s own id', async () => {
    const rel = relationship({ flagged: true, flag_reason: 'knows the coach' });
    stubFetch({ programmes: [rel] });
    await render();
    await click(buttonsIn(cardFor('Alpha')).find((b) => b.textContent.includes(RELATIONSHIP_OUTREACH)));

    expect(contextCalls()).toHaveLength(1);
    expect(contextCalls()[0].path).toBe(`/api/players/${ATHLETE}/programmes/rel-Alpha/outreach`);
  });

  it('offers it on exactly the card that has the relationship', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await render();
    expect(manualButtons()).toHaveLength(1);
    expect(buttonsIn(cardFor('Bravo')).some((b) => b.textContent.includes(RELATIONSHIP_OUTREACH))).toBe(false);
  });

  it('matches the relationship by college id, not by name alone', async () => {
    // Same name, different programme. Only the id tells them apart.
    const rel = relationship({ college_id: 'col-2', college_name: 'Bravo', id: 'rel-Bravo', flagged: true, flag_reason: 'x' });
    stubFetch({ programmes: [rel] });
    await render();
    await click(buttonsIn(cardFor('Bravo')).find((b) => b.textContent.includes(RELATIONSHIP_OUTREACH)));
    expect(contextCalls()[0].path).toContain('rel-Bravo');
  });
});

describe('the do-not-contact relationship', () => {
  it('opens the dialog, which explains the block and offers no composer', async () => {
    const rel = relationship({ contact_stance: 'do_not_contact', flagged: true, flag_reason: 'x' });
    stubFetch({
      programmes: [rel],
      context: outreachContext(rel, {
        contact: { allowed: false, stance: 'do_not_contact', reason: 'RELATIONSHIP_DO_NOT_CONTACT' },
      }),
    });
    await render();
    await click(buttonsIn(cardFor('Alpha')).find((b) => b.textContent.includes(RELATIONSHIP_OUTREACH)));

    /**
     * The button is not the rule. It opens, the server's own decision is what
     * the dialog renders, and `sendOutreach` refuses regardless of what any
     * screen chose to show.
     */
    expect(document.body.textContent).toMatch(/do-not-contact/i);
    expect(buttonsIn(document.body).some((b) => /Outlook|^Send \d/.test(b.textContent))).toBe(false);
  });
});

describe('the removed-programmes panel', () => {
  const suppressed = relationship({ visibility: 'suppressed', flagged: true, flag_reason: 'x' });

  it('offers relationship outreach beside Keep in Top 100', async () => {
    stubFetch({ programmes: [suppressed] });
    await render();
    await click([...buttonsIn(container)].find((b) => b.textContent.includes('Removed from this athlete')));

    const list = container.querySelector('[data-testid="suppressed-list"]');
    // Suppressed from the Top 100 is a ranking decision. It says nothing about
    // whether anyone may write to them.
    expect(buttonsIn(list).some((b) => b.textContent.includes(RELATIONSHIP_OUTREACH))).toBe(true);
    expect(buttonsIn(list).some((b) => b.textContent.includes('Keep in Top 100'))).toBe(true);
  });

  it('opens the dialog for the suppressed relationship', async () => {
    stubFetch({ programmes: [suppressed] });
    await render();
    await click([...buttonsIn(container)].find((b) => b.textContent.includes('Removed from this athlete')));
    const list = container.querySelector('[data-testid="suppressed-list"]');
    await click(buttonsIn(list).find((b) => b.textContent.includes(RELATIONSHIP_OUTREACH)));

    expect(contextCalls()[0].path).toContain('rel-Alpha');
  });

  it('leaves Restore working, and independent', async () => {
    stubFetch({ programmes: [suppressed] });
    await render();
    await click([...buttonsIn(container)].find((b) => b.textContent.includes('Removed from this athlete')));
    const list = container.querySelector('[data-testid="suppressed-list"]');
    await click(buttonsIn(list).find((b) => b.textContent.includes('Keep in Top 100')));

    // A visibility change, and nothing to do with communication.
    const write = calls.find((c) => c.method === 'PATCH');
    expect(write.body).toEqual({ visibility: 'default' });
    expect(contextCalls()).toHaveLength(0);
  });
});

describe('Specific Schools is unchanged', () => {
  it('still offers relationship outreach on every row', async () => {
    stubFetch({ programmes: [relationship({ request_state: 'requested' })] });
    await render();
    await click(tab('Specific Schools'));

    const row = container.querySelector('[data-testid="specific-school-row"]');
    expect(buttonsIn(row).some((b) => b.textContent.includes(RELATIONSHIP_OUTREACH))).toBe(true);
    expect(buttonsIn(row).some((b) => b.textContent.includes('Remove'))).toBe(true);
  });

  it('still opens against the relationship id', async () => {
    stubFetch({ programmes: [relationship({ request_state: 'requested' })] });
    await render();
    await click(tab('Specific Schools'));
    const row = container.querySelector('[data-testid="specific-school-row"]');
    await click(buttonsIn(row).find((b) => b.textContent.includes(RELATIONSHIP_OUTREACH)));
    expect(contextCalls()[0].path).toBe(`/api/players/${ATHLETE}/programmes/rel-Alpha/outreach`);
  });
});

describe('one dialog, owned by the tab', () => {
  it('mounts a single instance however many surfaces offer the action', async () => {
    const rels = [
      relationship({ id: 'rel-Alpha', college_id: 'col-1', college_name: 'Alpha', flagged: true, flag_reason: 'x' }),
      relationship({ id: 'rel-Bravo', college_id: 'col-2', college_name: 'Bravo', request_state: 'requested' }),
      relationship({ id: 'rel-Charlie', college_id: 'col-3', college_name: 'Charlie', visibility: 'suppressed', flagged: true, flag_reason: 'y' }),
    ];
    stubFetch({ programmes: rels });
    await render();

    // Three relationship surfaces offering the action...
    expect(manualButtons().length).toBeGreaterThanOrEqual(2);
    // ...and nothing open until one is pressed.
    expect(contextCalls()).toHaveLength(0);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);

    await click(buttonsIn(cardFor('Alpha')).find((b) => b.textContent.includes(RELATIONSHIP_OUTREACH)));
    // Exactly one dialog, and exactly one context fetch.
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(contextCalls()).toHaveLength(1);
  });

  it('never fetches a relationship context until an operator asks', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await render();
    // Rendering the action is not performing it.
    expect(contextCalls()).toHaveLength(0);
  });
});
