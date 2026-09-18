// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import EmailComposer from './EmailComposer.jsx';
import {
  EVIDENCE_USED_BEFORE, EVIDENCE_IN_OPEN_DRAFT, EVIDENCE_HISTORY_UNAVAILABLE,
  evidenceUsedBefore, evidenceInOpenDraft,
} from '@/lib/outreachLabels';

/**
 * F9e — WHAT THIS COACH HAS ALREADY BEEN PUT, IN THE COMPOSER.
 *
 * ===========================================================================
 * MEMORY AND VISIBILITY. NOT POLICY.
 *
 *   NOTHING IS REMOVED, REORDERED OR DISABLED. The same findings are offered
 *   in the same order whether or not anything has been said before, and a
 *   marked claim stays fully selectable. Campaign hard-excludes because nobody
 *   is watching; here somebody is, and the only thing they lacked was the
 *   fact.
 *
 *   THE WORDING STOPS WHERE THE DATA STOPS. Thriv3 knows what it put in the
 *   body it handed to Outlook and that a person afterwards said they sent it.
 *   It does not know what left Outlook, so nothing here may say "already
 *   sent", "received" or "read".
 *
 *   UNKNOWN IS NOT NONE. A failed history lookup leaves every line unmarked,
 *   which looks exactly like a coach nothing has been said to. One notice
 *   separates them, and composition continues either way.
 * ===========================================================================
 */

const PLAYER = {
  id: 'athlete-1', full_name: 'Nikau Brennan', sport: 'mens-soccer',
  position: 'Midfielder', recruiting_class_year: 2027,
};

/** Canonical coaches, as the relationship route supplies them: with ids. */
const COACHES = [
  { coach_id: 'coach-1', name: 'Head Person', email: 'head@stanford.test', title: 'Head Coach' },
  { coach_id: 'coach-2', name: 'Assistant Person', email: 'asst@stanford.test', title: 'Assistant Coach' },
];

/** A match-card staff list, as the matching blob supplies it: no ids. */
const RANKED_STAFF = [
  { name: 'Head Person', email: 'head@stanford.test', title: 'Head Coach' },
];

const college = (staff = COACHES) => ({
  id: 'col-stanford', name: 'Stanford', sport: 'mens-soccer',
  division: 'NCAA D1', conference: 'ACC', coaching_staff: staff,
});

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
  previouslyUsed: null,
  order: 0,
  slot: 'HOOK',
  ...over,
});

const wire = (over = {}) => ({
  paragraph: 'p',
  structure: 'PATHWAY',
  structureLabel: 'Pathway',
  structureSource: 'ENGINE',
  structureOptions: [{ key: 'PATHWAY', label: 'Pathway' }],
  maxEvidence: 4,
  programme: { name: 'Stanford' },
  selected: [finding()],
  available: [],
  internal: [],
  otherKnown: [],
  composition: { blocks: [], slots: {} },
  ...over,
});

let container;
let root;
let calls;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

function stubFetch({ evidence = wire() } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });
    if (path.includes('/evidence')) {
      const names = body?.collegeNames ?? [];
      const answer = typeof evidence === 'function' ? evidence(body) : evidence;
      return ok(Object.fromEntries(names.map((n) => [n, answer])));
    }
    return ok({});
  }));
}

async function mount(props = {}) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(EmailComposer, {
      open: true,
      onOpenChange: () => {},
      player: PLAYER,
      college: college(),
      ...props,
    })));
  });
}

const evidenceCalls = () => calls.filter((c) => c.path.includes('/evidence'));
const lastCoachIds = () => evidenceCalls().at(-1)?.body?.coachIds ?? null;
const priorUse = () => Array.from(document.body.querySelectorAll('[data-testid="prior-use"]'));
const panelText = () => document.body.textContent;
const checkboxFor = (email) => Array.from(document.body.querySelectorAll('[role="checkbox"]'))
  .find((el) => el.closest('label')?.textContent?.includes(email));

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
/*  THE REQUEST                                                               */
/* ========================================================================== */

describe('who the composer says this email is for', () => {
  it('sends the canonical coach ids of the currently selected recipients', async () => {
    stubFetch({});
    await mount();

    expect(lastCoachIds()).toEqual(['coach-1', 'coach-2']);
  });

  /**
   * THE TOP 100 PATH IS UNCHANGED. A match card's staff comes from the
   * matching blob and carries no `coach_id`, so no ids are sent, no history is
   * returned, and the ranked and bulk composers behave exactly as before.
   */
  it('sends none where the staff carries no canonical ids', async () => {
    stubFetch({});
    await mount({ college: college(RANKED_STAFF) });

    expect(evidenceCalls().length).toBeGreaterThan(0);
    expect(lastCoachIds()).toBeNull();
  });

  it('asks again when the recipients change', async () => {
    stubFetch({});
    await mount();
    const before = evidenceCalls().length;

    const box = checkboxFor('asst@stanford.test');
    expect(box).toBeTruthy();
    await click(box);

    expect(evidenceCalls().length).toBeGreaterThan(before);
    expect(lastCoachIds()).toEqual(['coach-1']);
  });

  /**
   * History is a union across the recipients and does not depend on their
   * order, so a key that moved when the order did would ask the same question
   * twice. The composer derives ids from a Set, so this is a real risk.
   */
  it('does not ask again when the same recipients arrive in a different order', async () => {
    stubFetch({});
    await mount();
    const before = evidenceCalls().length;

    // Deselect and reselect: the same set, rebuilt in a different order.
    await click(checkboxFor('head@stanford.test'));
    const afterDeselect = evidenceCalls().length;
    await click(checkboxFor('head@stanford.test'));

    expect(afterDeselect).toBeGreaterThan(before);
    // Back to the same set — the canonical key is unchanged, so the only new
    // request is the one the deselection caused.
    expect(lastCoachIds()).toEqual(['coach-1', 'coach-2']);
    expect(evidenceCalls().length).toBe(afterDeselect + 1);
  });
});

/* ========================================================================== */
/*  THE MARKER                                                                */
/* ========================================================================== */

describe('what the marker says', () => {
  const used = (over = {}) => wire({
    selected: [finding({
      previouslyUsed: {
        source: 'CONFIRMED', coachCount: 1, origins: ['manual'], at: '2026-09-07T09:00:00.000Z',
      },
    })],
    history: { status: 'READY', coachCount: 1 },
    ...over,
  });

  it('marks a confirmed prior use', async () => {
    stubFetch({ evidence: used() });
    await mount();

    expect(priorUse()).toHaveLength(1);
    expect(priorUse()[0].textContent).toContain(EVIDENCE_USED_BEFORE);
    expect(priorUse()[0].textContent).toContain('by hand');
  });

  /**
   * THE TRUTH BOUNDARY, ASSERTED AS A STRING TEST. Between Thriv3 handing the
   * body to Outlook and the operator saying they sent it, the draft is
   * editable in a mail client this build cannot see.
   */
  it('never claims the coach received or read anything', async () => {
    stubFetch({ evidence: used() });
    await mount();

    const text = priorUse()[0].textContent;
    expect(text).not.toMatch(/already sent/i);
    expect(text).not.toMatch(/received/i);
    expect(text).not.toMatch(/\bread\b/i);
    expect(text).not.toMatch(/delivered|opened|seen by/i);
    // It says what it can: a draft, and a confirmation.
    expect(text).toContain('draft');
    expect(text).toContain('confirmed as sent');
  });

  it('says the same thing about a campaign message, with its origin named', async () => {
    stubFetch({
      evidence: used({
        selected: [finding({
          previouslyUsed: {
            source: 'CONFIRMED', coachCount: 1, origins: ['campaign'], at: null,
          },
        })],
      }),
    });
    await mount();

    expect(priorUse()[0].textContent).toContain(EVIDENCE_USED_BEFORE);
    expect(priorUse()[0].textContent).toContain('by a campaign');
  });

  /** A body in a window is not a message, and never shares wording with one. */
  it('describes an open draft in different words, and not as confirmed', async () => {
    stubFetch({
      evidence: used({
        selected: [finding({
          previouslyUsed: { source: 'OPEN', coachCount: 1, origins: ['manual'], at: null },
        })],
      }),
    });
    await mount();

    const text = priorUse()[0].textContent;
    expect(text).toContain(EVIDENCE_IN_OPEN_DRAFT);
    expect(text).not.toContain('confirmed as sent');
    expect(EVIDENCE_IN_OPEN_DRAFT).not.toBe(EVIDENCE_USED_BEFORE);
  });

  it('counts the selected coaches rather than naming them', async () => {
    stubFetch({
      evidence: used({
        selected: [finding({
          previouslyUsed: { source: 'CONFIRMED', coachCount: 2, origins: ['manual'], at: null },
        })],
      }),
    });
    await mount();

    expect(priorUse()[0].textContent).toContain(evidenceUsedBefore(2));
    expect(priorUse()[0].textContent).toContain('2 selected coaches');
    // Coach identity is the composer's, and this payload adds no second copy.
    expect(priorUse()[0].textContent).not.toContain('Head Person');
  });

  it('marks nothing where nothing has been said', async () => {
    stubFetch({ evidence: wire({ history: { status: 'READY', coachCount: 1 } }) });
    await mount();

    expect(priorUse()).toHaveLength(0);
    expect(panelText()).not.toContain('Used in a draft');
  });

  it('names an origin only where one was recorded', async () => {
    stubFetch({
      evidence: used({
        selected: [finding({
          previouslyUsed: { source: 'CONFIRMED', coachCount: 1, origins: [null], at: null },
        })],
      }),
    });
    await mount();

    const text = priorUse()[0].textContent;
    expect(text).toContain(EVIDENCE_USED_BEFORE);
    expect(text).not.toContain('(');
  });
});

/* ========================================================================== */
/*  WHAT MUST NOT MOVE                                                        */
/* ========================================================================== */

describe('history annotates and decides nothing', () => {
  const two = [
    finding(),
    finding({
      kind: 'POSITION_GRADUATION', tier: 'SIGNAL', confidence: 'MEDIUM', order: 1,
      slot: 'RELEVANCE', text: 'Two defenders graduate in 2026.',
    }),
  ];

  /**
   * The panel with the marker ELEMENTS removed, so the comparison is exact
   * rather than a string subtraction that could hide a real difference.
   */
  const render = async (marks) => {
    calls = [];
    stubFetch({
      evidence: wire({
        selected: two.map((f, i) => ({ ...f, previouslyUsed: marks[i] ?? null })),
        history: { status: 'READY', coachCount: 1 },
      }),
    });
    await mount();
    const full = panelText();
    for (const el of Array.from(document.body.querySelectorAll('[data-testid="prior-use"]'))) {
      el.remove();
    }
    const withoutMarkers = panelText();
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    return { full, withoutMarkers };
  };

  /**
   * THE CENTRAL INVARIANT ON THIS SIDE. Everything the panel prints about the
   * evidence — the kinds, their order, tiers, confidence and sentences — is
   * identical whether or not anything has been said before. Only the marker
   * lines differ.
   */
  it('shows the same findings, in the same order, marked or not', async () => {
    const plain = await render([null, null]);
    const marked = await render([
      { source: 'CONFIRMED', coachCount: 1, origins: ['manual'], at: null }, null,
    ]);

    // Identical once the annotation itself is taken away.
    expect(marked.withoutMarkers).toBe(plain.withoutMarkers);
    // And the annotation really was there, so this is not passing vacuously.
    expect(marked.full).toContain(EVIDENCE_USED_BEFORE);
    expect(plain.full).not.toContain(EVIDENCE_USED_BEFORE);

    // The marked claim is still there, still a FACT, still first.
    expect(marked.full.indexOf('Three New Zealanders'))
      .toBeLessThan(marked.full.indexOf('Two defenders'));
    expect(marked.full).toContain('FACT');
    expect(marked.full).toContain('SIGNAL');
  });

  it('leaves a marked claim fully selectable', async () => {
    stubFetch({
      evidence: wire({
        selected: [],
        available: [{
          ...finding(),
          selected: false,
          role: 'HOOK',
          previouslyUsed: {
            source: 'CONFIRMED', coachCount: 1, origins: ['manual'], at: null,
          },
        }],
        history: { status: 'READY', coachCount: 1 },
      }),
    });
    await mount();

    expect(priorUse()).toHaveLength(1);
    // Nothing disabled because of history.
    const disabled = Array.from(document.body.querySelectorAll('[data-testid="prior-use"]'))
      .map((el) => el.closest('div'))
      .flatMap((row) => Array.from(row?.querySelectorAll('button') ?? []))
      .filter((b) => b.disabled);
    expect(disabled).toHaveLength(0);
  });

  /**
   * NO SEQUENCE POLICY. A second or third manual email is composed by exactly
   * the code that composes the first: no step, no ceiling, no follow-up shape.
   */
  it('does not turn a later message into a follow-up', async () => {
    stubFetch({
      evidence: wire({
        selected: [finding({
          previouslyUsed: { source: 'CONFIRMED', coachCount: 1, origins: ['manual'], at: null },
        })],
        history: { status: 'READY', coachCount: 1 },
      }),
    });
    await mount();

    const text = panelText();
    expect(text).toContain('Pathway');
    expect(text).not.toContain('Follow-up');
    expect(text).not.toMatch(/step 2|sequence/i);
  });

  it('still composes when every claim has been used before', async () => {
    stubFetch({
      evidence: wire({
        selected: two.map((f) => ({
          ...f,
          previouslyUsed: { source: 'CONFIRMED', coachCount: 1, origins: ['manual'], at: null },
        })),
        history: { status: 'READY', coachCount: 1 },
      }),
    });
    await mount();

    // Nothing withheld, nothing emptied — both claims on offer, both marked.
    expect(priorUse()).toHaveLength(2);
    expect(panelText()).toContain('Three New Zealanders');
    expect(panelText()).toContain('Two defenders');
  });
});

/* ========================================================================== */
/*  WHEN THE QUESTION CANNOT BE ANSWERED                                      */
/* ========================================================================== */

describe('unknown history is not no history', () => {
  it('says the check failed, once, at the panel', async () => {
    stubFetch({
      evidence: wire({ history: { status: 'FAILED', coachCount: 2 } }),
    });
    await mount();

    const notice = document.body.querySelector('[data-testid="history-unavailable"]');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toBe(EVIDENCE_HISTORY_UNAVAILABLE);
    expect(document.body.querySelectorAll('[data-testid="history-unavailable"]')).toHaveLength(1);
  });

  it('composes normally regardless — the evidence is unaffected', async () => {
    stubFetch({
      evidence: wire({ history: { status: 'FAILED', coachCount: 1 } }),
    });
    await mount();

    expect(panelText()).toContain('Three New Zealanders');
    expect(panelText()).toContain('FACT');
    // Not the plain-template fallback: that is for a failed EVIDENCE lookup.
    expect(panelText()).not.toContain('this draft is the plain template');
    expect(priorUse()).toHaveLength(0);
  });

  it('says nothing about history when nobody asked', async () => {
    stubFetch({ evidence: wire() });
    await mount({ college: college(RANKED_STAFF) });

    expect(document.body.querySelector('[data-testid="history-unavailable"]')).toBeNull();
    expect(panelText()).not.toContain(EVIDENCE_HISTORY_UNAVAILABLE);
    expect(priorUse()).toHaveLength(0);
  });

  /** The two sentences describe different situations and never co-occur. */
  it('keeps the failure notice and the markers mutually exclusive', async () => {
    stubFetch({
      evidence: wire({
        selected: [finding({
          previouslyUsed: { source: 'CONFIRMED', coachCount: 1, origins: ['manual'], at: null },
        })],
        history: { status: 'READY', coachCount: 1 },
      }),
    });
    await mount();

    expect(priorUse()).toHaveLength(1);
    expect(document.body.querySelector('[data-testid="history-unavailable"]')).toBeNull();
  });
});

describe('the wording is fixed in one place', () => {
  it('states the ceiling, and the open-draft sentence never borrows it', () => {
    expect(EVIDENCE_USED_BEFORE).toBe('Used in a draft confirmed as sent to this coach');
    expect(evidenceUsedBefore(1)).toBe(EVIDENCE_USED_BEFORE);
    expect(evidenceUsedBefore(3)).toContain('3 selected coaches');
    expect(evidenceInOpenDraft(1)).toBe(EVIDENCE_IN_OPEN_DRAFT);
    for (const s of [EVIDENCE_USED_BEFORE, EVIDENCE_IN_OPEN_DRAFT, evidenceUsedBefore(2), evidenceInOpenDraft(2)]) {
      expect(s).not.toMatch(/already sent|received|\bread\b|delivered|opened/i);
    }
  });
});
