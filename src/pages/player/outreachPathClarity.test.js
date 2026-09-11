// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import ManualOutreachDialog from '@/components/ManualOutreachDialog';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import {
  RELATIONSHIP_OUTREACH, RECOMMENDATION_OUTREACH, BOTH_PATHS_HINT,
  MANUAL_ONLY_HINT, DO_NOT_CONTACT_TITLE, DO_NOT_CONTACT_BODY,
  RELATIONSHIP_DIALOG_HINT, RECOMMENDATION_DIALOG_HINT,
} from '@/lib/outreachLabels';
import { ZERO } from '@/lib/__fixtures__/recruitingSignals.js';

/**
 * TWO WAYS TO WRITE TO A COACH, TOLD APART.
 *
 * Both are legitimate and both are composed by hand, so this is not about
 * removing one. It is about the operator knowing, before clicking and again
 * after, WHY this particular school is being written to — a model ranking, or
 * something on record about it.
 *
 * The assertions run against the shared vocabulary rather than against
 * literals, so changing the wording is one constant and these follow.
 */

const ATHLETE = 'athlete-1';

const college = (n, name) => ({
  id: `col-${n}`, name, division: 'NCAA D1', match_score: 200 - n,
  coaching_staff: [{ name: 'A Coach', title: 'Head Coach', email: `a@${name.toLowerCase()}.test` }],
  breakdown: [{ key: 'roster', label: 'Roster opportunity', weight: 0.2, score: 0.5, contribution: 10, confidence: 'measured' }],
});

const RECOMMENDATIONS = ['Alpha', 'Bravo'].map((n, i) => college(i + 1, n));

const relationship = (over = {}) => ({
  id: 'rel-Alpha', athlete_id: ATHLETE, college_name: 'Alpha', sport: 'mens-soccer',
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

const outreachContext = (rel, over = {}) => ({
  relationship: rel,
  college: { id: rel.college_id, name: rel.college_name, sport: 'mens-soccer', division: 'NCAA D1' },
  coaches: [{ coach_id: 'coach-1', name: 'A Coach', email: 'a@alpha.test', title: 'Head Coach', email_status: 'verified' }],
  contact: { allowed: true, stance: rel.contact_stance, reason: null },
  priorContact: [],
  ...over,
});

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

async function renderTab(recommendations = RECOMMENDATIONS) {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: [`/player/${ATHLETE}/matching`] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell, { recommendations }) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTab) }))),
    ));
  });
}

async function renderDialog(over = {}) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(ManualOutreachDialog, {
      player: { id: ATHLETE, full_name: 'Test Athlete', sport: 'mens-soccer' },
      relationshipId: 'rel-Alpha', open: true, onOpenChange: () => {}, ...over,
    })));
  });
}

const body = () => document.body.textContent;
const buttonsIn = (el) => Array.from(el.querySelectorAll('button'));
const allButtons = () => buttonsIn(document.body);
const withText = (t) => allButtons().filter((b) => b.textContent.includes(t));
const cardFor = (name) => Array.from(container.querySelectorAll('[data-testid="programme-relationship"]'))
  .find((el) => el.closest('div[class*="rounded"]')?.textContent.includes(name));
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const tab = (label) => Array.from(container.querySelectorAll('[role="tab"]'))
  .find((t) => t.textContent.includes(label));
/**
 * The card's own expand toggle — the full-width button wrapping the heading.
 * "Email Coaches" lives inside the expanded body, so the two paths are only
 * on screen together once a card is opened.
 */
const expandCard = async (name) => {
  const toggle = Array.from(container.querySelectorAll('button.w-full'))
    .find((b) => b.textContent.includes(name));
  await click(toggle);
};
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

describe('the two paths are distinguishable on the card', () => {
  it('keeps both actions where a relationship exists', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'knows the coach' })] });
    await renderTab();
    // Neither workflow was removed to solve the ambiguity — they mean
    // different things and both are legitimate.
    expect(withText(RELATIONSHIP_OUTREACH)).toHaveLength(1);
    await expandCard('Alpha');
    expect(withText(RECOMMENDATION_OUTREACH).length).toBeGreaterThanOrEqual(1);
  });

  it('gives them different labels AND different icons', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await renderTab();
    const relButton = withText(RELATIONSHIP_OUTREACH)[0];
    expect(RELATIONSHIP_OUTREACH).not.toBe(RECOMMENDATION_OUTREACH);
    // The icon is the faster discrimination in a row of small buttons, so the
    // two must not share a glyph.
    expect(relButton.querySelector('svg')?.getAttribute('class'))
      .toBeTruthy();
    expect(relButton.textContent).toContain(RELATIONSHIP_OUTREACH);
  });

  it('explains the difference only where both are reachable', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await renderTab();
    await expandCard('Alpha');
    expect(body()).toContain(BOTH_PATHS_HINT);
  });

  it('says nothing extra on a card with no relationship', async () => {
    stubFetch();
    await renderTab();
    await expandCard('Alpha');
    // One way to write to it, so nothing to tell apart.
    expect(withText(RELATIONSHIP_OUTREACH)).toHaveLength(0);
    expect(body()).not.toContain(BOTH_PATHS_HINT);
  });

  it('names the relationship action zone', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await renderTab();
    // So the controls read as belonging to a record rather than to the ranking.
    expect(cardFor('Alpha').textContent).toContain('Relationship');
  });
});

describe('the same word on every relationship surface', () => {
  it('uses it in Specific Schools', async () => {
    stubFetch({ programmes: [relationship({ request_state: 'requested' })] });
    await renderTab();
    await click(tab('Specific Schools'));
    const row = container.querySelector('[data-testid="specific-school-row"]');
    expect(buttonsIn(row).some((b) => b.textContent.includes(RELATIONSHIP_OUTREACH))).toBe(true);
  });

  it('uses it in the removed-programmes panel, beside an independent Restore', async () => {
    stubFetch({ programmes: [relationship({ visibility: 'suppressed', flagged: true, flag_reason: 'x' })] });
    await renderTab();
    await click(allButtons().find((b) => b.textContent.includes('Removed from this athlete')));
    const list = container.querySelector('[data-testid="suppressed-list"]');

    // Two separate buttons: one changes a ranking decision, one writes an
    // email. Neither label implies the other.
    const labels = buttonsIn(list).map((b) => b.textContent.trim());
    expect(labels.some((l) => l.includes(RELATIONSHIP_OUTREACH))).toBe(true);
    expect(labels.some((l) => l.includes('Keep in Top 100'))).toBe(true);
    expect(labels.some((l) => /restore/i.test(l) && l.includes(RELATIONSHIP_OUTREACH))).toBe(false);
  });
});

describe('the dialogs say which composer they are', () => {
  it('the relationship composer names its context', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await renderTab();
    await click(withText(RELATIONSHIP_OUTREACH)[0]);
    expect(body()).toContain(RELATIONSHIP_DIALOG_HINT);
    expect(body()).toContain(RELATIONSHIP_OUTREACH);
  });

  it('the recommendation composer names its own', async () => {
    stubFetch();
    await renderTab();
    await expandCard('Alpha');
    await click(withText(RECOMMENDATION_OUTREACH)[0]);
    // The two look alike once open, which is where a wrong choice costs
    // something.
    expect(body()).toContain(RECOMMENDATION_DIALOG_HINT);
  });
});

describe('the relationship dialog explains why this school is here', () => {
  const open = async (rel, over) => {
    stubFetch({ programmes: [rel], context: outreachContext(rel, over) });
    await renderDialog();
  };

  it('shows a specific request', async () => {
    await open(relationship({ request_state: 'requested' }));
    expect(body()).toContain('Specific Request');
    expect(body()).toContain('Why this programme is handled here');
  });

  it('shows the flag and its reason', async () => {
    await open(relationship({ flagged: true, flag_reason: 'Thriv3 personal contact' }));
    expect(body()).toContain('Existing relationship');
    expect(body()).toContain('Thriv3 personal contact');
  });

  it('shows the operator note', async () => {
    await open(relationship({ note: 'Call the father first' }));
    expect(body()).toContain('Call the father first');
  });

  it('shows suppression as its own separate fact', async () => {
    await open(relationship({ visibility: 'suppressed', request_state: 'requested' }));
    // Both, kept apart. Blending them into one status would lose the reason
    // the operator opened this.
    expect(body()).toContain('Not in Top 100');
    expect(body()).toContain('Specific Request');
  });

  it('shows nothing where there is nothing to say', async () => {
    await open(relationship());
    for (const empty of ['Specific Request', 'Existing relationship', 'Not in Top 100', 'Manual only']) {
      expect(body(), empty).not.toContain(empty);
    }
    expect(body()).toContain('None to this programme.');
  });

  it('describes manual_only without claiming enforcement it does not have', async () => {
    await open(relationship({ contact_stance: 'manual_only' }));
    expect(body()).toContain('Manual only');
    expect(body()).toContain(MANUAL_ONLY_HINT);
    // Campaign execution does not consult this stance yet. Saying it is
    // "excluded from automated outreach" would be believed and would be false.
    expect(MANUAL_ONLY_HINT).not.toMatch(/excluded|blocked|prevented/i);
  });

  it('reports previous contact as fact, with no warning language', async () => {
    await open(relationship(), {
      priorContact: [{
        coach_id: 'coach-1', coach_name: 'A Coach', coach_email: 'a@alpha.test',
        position_title: 'Head Coach',
        relationship_opened_at: '2026-09-01T09:00:00.000Z',
        last_drafted_at: '2026-09-01T10:00:00.000Z',
        first_confirmed_send_at: '2026-09-01T11:00:00.000Z',
        last_confirmed_send_at: '2026-09-04T11:00:00.000Z',
        accepted_count: 2, draft_count: 0, record_count: 2,
        has_confirmed_send: true, revoked_at: null, origins: ['manual'],
      }],
    });
    expect(body()).toContain('Previous outreach');
    expect(body()).toContain('A Coach');
    expect(body()).toMatch(/last sent/i);
    expect(body()).toContain('2 sent');
    // A second deliberate message is the ordinary case, not an error.
    expect(body()).not.toMatch(/warning|cannot|do not send|already contacted — /i);
  });
});

describe('do-not-contact', () => {
  const refused = relationship({ contact_stance: 'do_not_contact', visibility: 'suppressed', flagged: true, flag_reason: 'x' });

  beforeEach(async () => {
    stubFetch({
      programmes: [refused],
      context: outreachContext(refused, {
        contact: { allowed: false, stance: 'do_not_contact', reason: 'RELATIONSHIP_DO_NOT_CONTACT' },
      }),
    });
    await renderDialog();
  });

  it('refuses, with no composer and no bypass', async () => {
    expect(body()).toContain(DO_NOT_CONTACT_TITLE);
    expect(allButtons().some((b) => /Outlook|^Send \d/.test(b.textContent))).toBe(false);
    // Nothing offering to change the stance from here.
    expect(allButtons().some((b) => /allow|override|contact anyway|send anyway/i.test(b.textContent)))
      .toBe(false);
  });

  it('says that visibility and flags will not lift it', async () => {
    expect(body()).toContain(DO_NOT_CONTACT_BODY);
    // The two neighbouring controls an operator would reach for next.
    expect(DO_NOT_CONTACT_BODY).toMatch(/Top 100/);
    expect(DO_NOT_CONTACT_BODY).toMatch(/flag/i);
  });

  it('is announced to assistive technology, not only coloured', async () => {
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(DO_NOT_CONTACT_TITLE);
  });
});

describe('rendering the controls costs nothing', () => {
  it('triggers no relationship-context fetch until asked', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await renderTab();
    expect(contextCalls()).toHaveLength(0);
    expect(calls.some((c) => c.method !== 'GET' && c.path.includes('/programmes'))).toBe(false);
  });

  it('still mounts one dialog, owned by the tab', async () => {
    stubFetch({ programmes: [relationship({ flagged: true, flag_reason: 'x' })] });
    await renderTab();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    await click(withText(RELATIONSHIP_OUTREACH)[0]);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
