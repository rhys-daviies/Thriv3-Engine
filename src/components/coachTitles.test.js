// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import EmailComposer from './EmailComposer.jsx';

/**
 * WHICH COACH AM I WRITING TO — THE TITLE ON THE RECIPIENT ROW.
 *
 * ===========================================================================
 * THIS IS A RENDERING FIX, AND THE TESTS SAY SO BY WHAT THEY DO NOT ASSERT.
 *
 * The title was already present everywhere it needed to be. `coaches
 * .position_title` is populated for all 6,347 rows on file; the programme
 * route maps it to `title`; this component already posts it back with the
 * send and already hands it to `pickBestContact` to seed the greeting. The
 * only thing missing was a line of markup.
 *
 * So nothing here asserts on the database, the route, or the payload — those
 * were never broken. What is asserted is the part that was: the operator can
 * see, on the row where they choose ONE coach, which one is the head coach.
 *
 * AND THE PART THAT MATTERS MORE: no title is ever invented. 446 distinct
 * free-text values are on file, from "Head Coach" to "Women's Soccer (Team
 * Email)", none of them normalised. A default would be a fabricated fact
 * about a real person on the screen where somebody decides whether to email
 * them.
 * ===========================================================================
 */

const PLAYER = {
  id: 'athlete-1', full_name: 'Nikau Brennan', sport: 'mens-soccer',
  position: 'Midfielder', recruiting_class_year: 2027,
};

/** Titles exactly as the registry holds them — free text, not an enum. */
const COACHES = [
  { coach_id: 'coach-1', name: 'Graham Winkworth', email: 'head@stanford.test', title: 'Head Coach' },
  { coach_id: 'coach-2', name: 'Assistant Person', email: 'asst@stanford.test', title: "Assistant Men's Soccer Coach" },
  { coach_id: 'coach-3', name: 'Keeper Person', email: 'gk@stanford.test', title: 'Goalkeeper Coach' },
];

const college = (staff = COACHES) => ({
  id: 'col-stanford', name: 'Stanford', sport: 'mens-soccer',
  division: 'NCAA D1', conference: 'ACC', coaching_staff: staff,
});

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

let sent;

function stubFetch() {
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(path).includes('/evidence')) {
      const names = body?.collegeNames ?? [];
      return ok(Object.fromEntries(names.map((n) => [n, { selected: [], available: [] }])));
    }
    if (String(path).includes('/outreach')) {
      sent.push(body);
      return ok({
        reachable: true,
        from: { requested: null, actual: null, mismatch: false },
        results: (body.coaches ?? []).map((c) => ({
          email: c.email, name: c.name, status: 'drafted', handoff: null,
        })),
      });
    }
    return ok({});
  }));
}

let container;
let root;

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
});

async function mount(staff = COACHES, props = {}) {
  stubFetch();
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(EmailComposer, {
      open: true, onOpenChange: () => {}, player: PLAYER, college: college(staff),
      allowImmediateSend: false, ...props,
    })));
  });
}

const text = () => document.body.textContent;
const titles = () => Array.from(document.body.querySelectorAll('[data-testid="coach-title"]'))
  .map((el) => el.textContent.trim());
const rowFor = (email) => Array.from(document.body.querySelectorAll('label'))
  .find((l) => l.textContent.includes(email));
const checkboxes = () => Array.from(document.body.querySelectorAll('[role="checkbox"]'));
const buttons = () => Array.from(document.body.querySelectorAll('button'));

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

/* ========================================================================== */
/*  What the operator can now see                                             */
/* ========================================================================== */

describe('the recipient row', () => {
  it('shows each coach’s title beside their name', async () => {
    await mount();

    expect(titles()).toEqual(['Head Coach', "Assistant Men's Soccer Coach", 'Goalkeeper Coach']);
  });

  /**
   * THE WHOLE POINT, AS ONE ASSERTION. Manual outreach goes to ONE coach, and
   * the row has to make the head coach distinguishable from the graduate
   * assistant without opening anything.
   */
  it('puts the right title with the right coach', async () => {
    await mount();

    expect(rowFor('head@stanford.test').textContent).toContain('Graham Winkworth');
    expect(rowFor('head@stanford.test').textContent).toContain('Head Coach');
    expect(rowFor('gk@stanford.test').textContent).toContain('Goalkeeper Coach');
    // And no bleed between rows.
    expect(rowFor('gk@stanford.test').textContent).not.toContain('Head Coach');
  });

  it('keeps the name and the address as they were', async () => {
    await mount();
    const row = rowFor('head@stanford.test').textContent;

    expect(row).toContain('Graham Winkworth');
    expect(row).toContain('head@stanford.test');
  });

  /** Free text, rendered verbatim. 446 distinct values are on file and none
   *  of them is normalised, so anything that reshaped one would be wrong. */
  it('renders the registry’s own wording, unchanged', async () => {
    await mount([
      { coach_id: 'c1', name: 'A', email: 'a@x.test', title: "Women's Soccer (Team Email)" },
      { coach_id: 'c2', name: 'B', email: 'b@x.test', title: 'Assistant Coach/Recruiting Coordinator' },
      { coach_id: 'c3', name: 'C', email: 'c@x.test', title: 'Graduate Assistant' },
    ]);

    expect(titles()).toEqual([
      "Women's Soccer (Team Email)",
      'Assistant Coach/Recruiting Coordinator',
      'Graduate Assistant',
    ]);
  });
});

/* ========================================================================== */
/*  What it must never do                                                     */
/* ========================================================================== */

describe('a coach with no recorded title', () => {
  /**
   * NO LINE, NOT A PLACEHOLDER. A fabricated role on the screen where
   * somebody decides whether to email a real person is worse than a gap.
   */
  it('shows nothing rather than guessing one', async () => {
    await mount([
      { coach_id: 'c1', name: 'Titled Person', email: 'titled@x.test', title: 'Head Coach' },
      { coach_id: 'c2', name: 'Untitled Person', email: 'untitled@x.test', title: null },
      { coach_id: 'c3', name: 'Blank Person', email: 'blank@x.test', title: '' },
    ]);

    // Only the one that has a title draws a title.
    expect(titles()).toEqual(['Head Coach']);

    for (const forbidden of ['Unknown', 'unknown', 'No title', 'N/A', 'Coach —', 'Staff', '—']) {
      expect(rowFor('untitled@x.test').textContent, forbidden).not.toContain(forbidden);
      expect(rowFor('blank@x.test').textContent, forbidden).not.toContain(forbidden);
    }
  });

  it('still lists the coach, with their name and address intact', async () => {
    await mount([{ coach_id: 'c2', name: 'Untitled Person', email: 'untitled@x.test', title: null }]);

    expect(text()).toContain('Untitled Person');
    expect(text()).toContain('untitled@x.test');
    expect(titles()).toEqual([]);
  });

  it('survives a coach record with no title key at all', async () => {
    await mount([{ coach_id: 'c9', name: 'Sparse Person', email: 'sparse@x.test' }]);

    expect(text()).toContain('Sparse Person');
    expect(titles()).toEqual([]);
  });
});

/* ========================================================================== */
/*  Nothing else moved                                                        */
/* ========================================================================== */

describe('the rest of the composer', () => {
  it('still selects every coach by default and lets one be deselected', async () => {
    await mount();
    expect(checkboxes()).toHaveLength(3);

    await click(checkboxes()[1]);
    const go = buttons().find((b) => /^Prepare \d/.test(b.textContent.trim()));
    await click(go);

    // Two remain selected, and the deselected one is not written to.
    expect(sent).toHaveLength(1);
    expect(sent[0].coaches.map((c) => c.email).sort())
      .toEqual(['gk@stanford.test', 'head@stanford.test']);
  });

  /**
   * THE DRAFT STILL TARGETS THE COACH THE OPERATOR PICKED — the only
   * behavioural risk in a change that touches the recipient row.
   */
  it('sends to exactly the coach whose row was left ticked', async () => {
    await mount();

    await click(checkboxes()[0]);
    await click(checkboxes()[2]);
    await click(buttons().find((b) => /^Prepare \d/.test(b.textContent.trim())));

    expect(sent[0].coaches).toHaveLength(1);
    expect(sent[0].coaches[0].email).toBe('asst@stanford.test');
    // And the title still travels with the payload, as it always did.
    expect(sent[0].coaches[0].title).toBe("Assistant Men's Soccer Coach");
  });

  it('still shows the per-coach outcome after preparing', async () => {
    await mount();
    await click(buttons().find((b) => /^Prepare \d/.test(b.textContent.trim())));

    expect(rowFor('head@stanford.test').textContent).toContain('prepared');
    // The title is still there afterwards — the status did not replace it.
    expect(rowFor('head@stanford.test').textContent).toContain('Head Coach');
  });

  it('greets the head coach, which has always read the title', async () => {
    await mount();
    await click(buttons().find((b) => /^Prepare \d/.test(b.textContent.trim())));

    expect(sent[0].greetingName).toBe('Graham Winkworth');
  });
});
