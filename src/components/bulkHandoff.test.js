// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import BulkEmailComposer from './BulkEmailComposer.jsx';
import {
  OPEN_IN_EMAIL, COPY_EMAIL, HANDOFF_NOT_SENT_YET, HANDOFF_RETRY,
  EMAILS_PREPARED, PREPARE_EMAILS,
} from '@/lib/outreachLabels';

/**
 * THE BULK COMPOSER GETS THE SAME HANDOFF — R2C.1.
 *
 * ===========================================================================
 * THIS IS A COMPATIBILITY FIX, NOT A FEATURE.
 *
 * R2B made `/api/outreach/send` prepare manual DRAFTs on any platform. This
 * screen posts to that endpoint exactly as the other composer does, so it
 * started receiving handoffs immediately — and ignored them. On Render it
 * recorded correct DRAFT rows, told the operator they were "waiting in
 * Outlook", and offered no way to open one. The emails were right, recorded,
 * and unreachable.
 *
 * Two properties are being asserted here and they pull in opposite
 * directions:
 *
 *   THE PREPARED EMAILS MUST BE REACHABLE — one row per coach, both actions.
 *
 *   NOTHING MAY HAPPEN ON ITS OWN. Twenty programmes is twenty tracking
 *   tokens and twenty different emails. Opening them in a loop would be
 *   popup-blocked and would leave the operator with twenty compose windows
 *   and one clipboard.
 * ===========================================================================
 */

const PLAYER = {
  id: 'athlete-1', full_name: 'Nikau Brennan', sport: 'mens-soccer',
  position: 'Midfielder', recruiting_class_year: 2027,
};

const COLLEGES = [
  {
    id: 'c1', name: 'Stanford', division: 'NCAA D1', match_score: 91,
    coaching_staff: [{ name: 'Head One', email: 'one@stanford.test', title: 'Head Coach' }],
  },
  {
    id: 'c2', name: 'Duke', division: 'NCAA D1', match_score: 88,
    coaching_staff: [{ name: 'Head Two', email: 'two@duke.test', title: 'Head Coach' }],
  },
];

const handoffFor = (n, email) => ({
  sendId: `send-${n}`,
  coachId: `coach-${n}`,
  to: email,
  subject: `Nikau Brennan — ${n}`,
  body: `Hi Coach,\n\nSee https://thriv3.test/p/ab.html?ref=tok${n}\n\nBest`,
  bodyHtml: `<div><p>Hi Coach ${n}</p></div>`,
  mailtoUrl: `mailto:${email}?subject=Nikau%20Brennan`,
});

/* -------------------------------------------------------------------------- */
/* Doubles                                                                     */
/* -------------------------------------------------------------------------- */

let written;
let navigated;
let posted;

function stubClipboard({ rich = true } = {}) {
  written = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: vi.fn(async (items) => {
        if (!rich) throw new Error('NotAllowedError');
        written.push({ kind: 'rich', items });
      }),
      writeText: vi.fn(async (text) => { written.push({ kind: 'plain', text }); }),
      readText: vi.fn(async () => 'SHOULD NEVER BE READ'),
    },
  });
  vi.stubGlobal('ClipboardItem', rich
    ? class { constructor(map) { this.map = map; } }
    : undefined);
  if (rich) globalThis.ClipboardItem.supports = () => true;
}

function stubLocation() {
  navigated = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { get href() { return navigated.at(-1) ?? ''; }, set href(v) { navigated.push(v); } },
  });
}

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

/**
 * One `/outreach/send` response per programme, in call order.
 *
 * `withHandoff: false` is the macOS shape: the AppleScript already opened a
 * window and the route returns `handoff: null`.
 */
function stubFetch({ withHandoff = true, failSecond = false } = {}) {
  posted = [];
  let n = 0;
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(path).includes('/outreach/send')) {
      posted.push(body);
      n += 1;
      const coach = body.coaches[0];
      if (failSecond && n === 2) {
        return ok({
          reachable: true,
          results: [{ email: coach.email, name: coach.name, status: 'suppressed', handoff: null }],
        });
      }
      return ok({
        reachable: true,
        from: { requested: null, actual: null, mismatch: false },
        results: [{
          email: coach.email, name: coach.name, status: 'drafted',
          handoff: withHandoff ? handoffFor(n, coach.email) : null,
        }],
      });
    }
    if (String(path).includes('/evidence')) {
      const names = body?.collegeNames ?? [];
      return ok(Object.fromEntries(names.map((c) => [c, { selected: [], available: [] }])));
    }
    return ok({});
  }));
}

/* -------------------------------------------------------------------------- */

let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  stubLocation();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const text = () => document.body.textContent;
const buttons = () => Array.from(document.body.querySelectorAll('button'));
const labelled = (l) => buttons().filter((b) => b.textContent.trim() === l);
const rows = () => Array.from(document.body.querySelectorAll('[data-testid="handoff-row"]'));
const section = () => document.body.querySelector('[data-testid="handoff-section"]');

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

/** Mount, select both programmes, and run the preparation. */
async function prepare(opts = {}) {
  stubFetch(opts);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(BulkEmailComposer, {
      player: PLAYER, colleges: COLLEGES, open: true, onOpenChange: () => {},
    })));
  });
  const go = buttons().find((b) => b.textContent.trim().startsWith('Prepare'));
  expect(go, 'the primary action').toBeTruthy();
  await click(go);
  // The run is a sequential await loop; let it drain.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/* ========================================================================== */
/*  Hosted                                                                    */
/* ========================================================================== */

describe('a hosted run, where the server prepared the emails', () => {
  it('shows one handoff row per prepared coach', async () => {
    stubClipboard();
    await prepare();

    expect(posted).toHaveLength(2);
    expect(rows()).toHaveLength(2);
    expect(labelled(OPEN_IN_EMAIL)).toHaveLength(2);
    expect(labelled(COPY_EMAIL)).toHaveLength(2);
    expect(text()).toContain('one@stanford.test');
    expect(text()).toContain('two@duke.test');
  });

  /**
   * THE HALF OF THIS SLICE THAT IS ABOUT RESTRAINT. Twenty programmes would
   * be twenty mailto navigations from one gesture; the browser would block
   * most of them and the operator would have one clipboard for twenty
   * windows. There is deliberately no "Open all".
   */
  it('opens nothing and copies nothing by itself', async () => {
    stubClipboard();
    await prepare();

    expect(navigated).toEqual([]);
    expect(written).toEqual([]);
    expect(buttons().some((b) => /open all/i.test(b.textContent))).toBe(false);
  });

  it('opens only the coach whose row was clicked', async () => {
    stubClipboard();
    await prepare();
    await click(labelled(OPEN_IN_EMAIL)[0]);

    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toContain('one@stanford.test');
    expect(navigated[0]).not.toContain('two@duke.test');
  });

  it('gives each coach their own body and their own tracking token', async () => {
    stubClipboard({ rich: false });
    await prepare();

    await click(labelled(OPEN_IN_EMAIL)[1]);
    const copied = written.at(-1).text;
    expect(copied).toContain('tok2');
    expect(copied).not.toContain('tok1');
  });

  it('uses the shared handoff implementation for Copy email too', async () => {
    stubClipboard();
    await prepare();
    await click(labelled(COPY_EMAIL)[0]);

    // Rich clipboard, no navigation — the same ladder as the other composer.
    expect(written).toHaveLength(1);
    expect(written[0].kind).toBe('rich');
    expect(navigated).toEqual([]);
  });

  it('leaves the other rows alone while one is working', async () => {
    stubClipboard();
    await prepare();
    await click(labelled(OPEN_IN_EMAIL)[0]);

    // The second row's actions are still offered after the first completes,
    // and the first becomes a retry rather than disappearing.
    expect(labelled(HANDOFF_RETRY)).toHaveLength(1);
    expect(labelled(OPEN_IN_EMAIL)).toHaveLength(1);
    expect(labelled(COPY_EMAIL)).toHaveLength(2);
  });

  it('can open the same coach again', async () => {
    stubClipboard();
    await prepare();
    await click(labelled(OPEN_IN_EMAIL)[0]);
    await click(labelled(HANDOFF_RETRY)[0]);

    expect(navigated).toHaveLength(2);
    expect(navigated[0]).toBe(navigated[1]);
  });

  it('never puts a body in the URL', async () => {
    stubClipboard();
    await prepare();
    await click(labelled(OPEN_IN_EMAIL)[0]);

    expect(navigated[0]).not.toContain('body=');
    expect(navigated[0]).not.toContain('tok1');
  });

  it('never reads the clipboard', async () => {
    stubClipboard();
    await prepare();
    await click(labelled(OPEN_IN_EMAIL)[0]);
    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/*  macOS                                                                     */
/* ========================================================================== */

describe('a local macOS run, where the AppleScript already opened the windows', () => {
  /**
   * `handoff: null` is a legitimate result shape, not a failure. The row must
   * simply not appear — a control wired to nothing would be worse than none,
   * and a clipboard copy beside an already-open compose window would be two
   * competing versions of one email.
   */
  it('renders no handoff controls at all', async () => {
    stubClipboard();
    await prepare({ withHandoff: false });

    expect(posted).toHaveLength(2);
    expect(section()).toBeNull();
    expect(rows()).toHaveLength(0);
    expect(labelled(OPEN_IN_EMAIL)).toHaveLength(0);
  });

  /** But it still says what happened, and still refuses to claim a send. */
  it('still reports the count, without naming a place they are not', async () => {
    stubClipboard();
    await prepare({ withHandoff: false });

    expect(text()).toContain(EMAILS_PREPARED(2));
    expect(text()).not.toContain('waiting in Outlook');
  });
});

/* ========================================================================== */
/*  Refused coaches                                                           */
/* ========================================================================== */

describe('a run where one coach was refused', () => {
  it('offers a handoff for the prepared one and none for the refused one', async () => {
    stubClipboard();
    await prepare({ failSecond: true });

    expect(rows()).toHaveLength(1);
    expect(text()).toContain('one@stanford.test');
    // The refusal is still reported on its own row, as it always was.
    expect(text()).toContain('opted out');
  });

  it('does not make a refused coach look prepared', async () => {
    stubClipboard();
    await prepare({ failSecond: true });

    const rowText = rows()[0].textContent;
    expect(rowText).toContain('one@stanford.test');
    expect(rowText).not.toContain('two@duke.test');
  });
});

/* ========================================================================== */
/*  What it says                                                              */
/* ========================================================================== */

describe('the wording', () => {
  it('claims nothing about Outlook, a send, or a delivery', async () => {
    stubClipboard();
    await prepare();
    await click(labelled(OPEN_IN_EMAIL)[0]);

    const body = text();
    for (const forbidden of [
      'waiting in Outlook', 'drafts in Outlook', 'draft open in Outlook',
      'Outlook draft', 'leave Outlook alone', 'email sent', 'delivery confirmed',
      'delivered', 'Open in Outlook',
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it('says plainly that nothing has been sent', async () => {
    stubClipboard();
    await prepare();
    expect(text()).toContain(HANDOFF_NOT_SENT_YET);
  });

  /**
   * ONCE, NOT TWICE. The prepared-count banner and the handoff section both
   * carry "nothing has been sent"; showing both would read as two different
   * facts about the same run.
   */
  it('does not say it twice', async () => {
    stubClipboard();
    await prepare();

    expect(text()).not.toContain(EMAILS_PREPARED(2));
    expect(text().split(HANDOFF_NOT_SENT_YET).length - 1).toBe(1);
  });

  it('names no mail application on any button', async () => {
    stubClipboard();
    await prepare();
    for (const b of buttons()) {
      expect(b.textContent, b.textContent).not.toMatch(/Outlook|Gmail|Apple Mail/);
    }
  });

  it('calls the primary action preparing rather than opening', async () => {
    stubClipboard();
    stubFetch();
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(BulkEmailComposer, {
        player: PLAYER, colleges: COLLEGES, open: true, onOpenChange: () => {},
      })));
    });
    expect(labelled(PREPARE_EMAILS(2))).toHaveLength(1);
  });
});
