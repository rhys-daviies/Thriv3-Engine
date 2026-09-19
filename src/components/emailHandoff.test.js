// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import EmailComposer from './EmailComposer.jsx';
import { openInEmail, copyEmail, HANDOFF_RESULT } from '@/lib/emailHandoff';
import {
  OPEN_IN_EMAIL, COPY_EMAIL, HANDOFF_READY, HANDOFF_NOT_SENT_YET,
  HANDOFF_CLIPBOARD_FAILED, HANDOFF_PLAIN_ONLY, HANDOFF_OPENED, HANDOFF_RETRY,
} from '@/lib/outreachLabels';

/**
 * HANDING A PREPARED EMAIL TO THE OPERATOR'S OWN MAIL APP — R2B.
 *
 * ===========================================================================
 * THE CLIENT IS A COURIER, AND MOST OF THIS FILE IS A LIST OF THINGS IT
 * CANNOT DO.
 *
 *   IT COMPOSES NOTHING. Recipient, subject, body, HTML and URL all arrive
 *   finished from the server, which built them beside the persisted DRAFT and
 *   checked them against its digest. The moment this layer can produce a
 *   value the server did not, Thriv3 can report one email while a coach reads
 *   another.
 *
 *   THE BODY IS NEVER IN THE URL. A real Thriv3 email makes a 2,007-character
 *   mailto and the safe ceiling is two thousand; what truncates is the END of
 *   the body, where the compliance footer lives.
 *
 *   NOTHING OPENS BY ITSELF. One coach, one click — because each body carries
 *   that coach's own tracking token, and because three mailto navigations
 *   from one gesture is what popup blockers exist to stop.
 *
 *   NOTHING CLAIMS A SEND. A compose window appearing is the most convincing
 *   false signal in this workflow, and the wording assertions below are what
 *   stop it quietly undermining the F7b confirmation.
 * ===========================================================================
 */

const HANDOFF = {
  sendId: 'send-1',
  coachId: 'coach-1',
  to: 'head@stanford.test',
  subject: 'Nikau Brennan — 2027 midfielder',
  body: 'Hi Coach,\n\nSee https://thriv3.test/p/ab.html?ref=tokA\n\nBest',
  bodyHtml: '<div><p>Hi Coach,</p></div>',
  mailtoUrl: 'mailto:head@stanford.test?subject=Nikau%20Brennan%20%E2%80%94%202027%20midfielder',
};

const SECOND = {
  ...HANDOFF,
  sendId: 'send-2',
  coachId: 'coach-2',
  to: 'asst@stanford.test',
  body: 'Hi Assistant,\n\nSee https://thriv3.test/p/ab.html?ref=tokB\n\nBest',
  mailtoUrl: 'mailto:asst@stanford.test?subject=Nikau%20Brennan',
};

/* -------------------------------------------------------------------------- */
/* Doubles                                                                     */
/* -------------------------------------------------------------------------- */

let written;
let navigated;

/**
 * A clipboard that can be made to behave like each of the three browsers this
 * has to survive: one that takes HTML, one that takes only text, and one that
 * refuses.
 */
function stubClipboard({ rich = true, plain = true, present = true } = {}) {
  written = [];
  if (!present) {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    vi.stubGlobal('ClipboardItem', undefined);
    return;
  }
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: vi.fn(async (items) => {
        if (!rich) throw new Error('NotAllowedError');
        written.push({ kind: 'rich', items });
      }),
      writeText: vi.fn(async (text) => {
        if (!plain) throw new Error('NotAllowedError');
        written.push({ kind: 'plain', text });
      }),
      // Present so that a test would catch this file ever calling it.
      readText: vi.fn(async () => 'SHOULD NEVER BE READ'),
    },
  });
  vi.stubGlobal('ClipboardItem', rich
    ? class { constructor(map) { this.map = map; Object.assign(this, map); } }
    : undefined);
  if (rich) globalThis.ClipboardItem.supports = () => true;
}

/** jsdom refuses a real navigation, so the assignment is captured instead. */
function stubLocation() {
  navigated = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get href() { return navigated.at(-1) ?? ''; },
      set href(v) { navigated.push(v); },
    },
  });
}

const richFlavours = () => {
  const item = written.find((w) => w.kind === 'rich')?.items?.[0];
  return item ? Object.keys(item.map ?? {}) : [];
};

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

/* ========================================================================== */
/*  The clipboard, one layer at a time                                        */
/* ========================================================================== */

describe('copying the email', () => {
  it('writes HTML and plain text together when the browser allows it', async () => {
    stubClipboard({ rich: true });
    const result = await copyEmail(HANDOFF);

    expect(result.status).toBe(HANDOFF_RESULT.RICH);
    /**
     * BOTH FLAVOURS, AND text/plain IS NOT REDUNDANT. A mail composer takes
     * the HTML — which is how the anchors and paragraph spacing survive — but
     * a plain-text composer or a notes app takes the other, and without it
     * they paste nothing at all.
     */
    // Sorted: a ClipboardItem is a map and the browser does not care about
    // key order, so asserting it would be pinning an implementation detail.
    expect(richFlavours().sort()).toEqual(['text/html', 'text/plain']);
  });

  it('falls back to plain text when HTML is refused', async () => {
    stubClipboard({ rich: false, plain: true });
    const result = await copyEmail(HANDOFF);

    expect(result.status).toBe(HANDOFF_RESULT.PLAIN);
    expect(written).toEqual([{ kind: 'plain', text: HANDOFF.body }]);
  });

  it('reports a total refusal rather than throwing', async () => {
    stubClipboard({ rich: false, plain: false });
    const result = await copyEmail(HANDOFF);

    // A status, not an exception: the caller has a perfectly good answer for
    // this (show the body) and an exception would turn a recoverable state
    // into a broken screen.
    expect(result.status).toBe(HANDOFF_RESULT.MANUAL);
  });

  it('reports a browser with no clipboard at all', async () => {
    stubClipboard({ present: false });
    expect((await copyEmail(HANDOFF)).status).toBe(HANDOFF_RESULT.MANUAL);
  });

  /** It writes. It never reads. */
  it('never reads the clipboard', async () => {
    stubClipboard({ rich: true });
    await copyEmail(HANDOFF);
    await openInEmail(HANDOFF);
    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
  });

  it('copies exactly what the server supplied, byte for byte', async () => {
    stubClipboard({ rich: false, plain: true });
    await copyEmail(HANDOFF);
    expect(written[0].text).toBe(HANDOFF.body);
    expect(written[0].text).not.toContain('undefined');
  });
});

/* ========================================================================== */
/*  Opening                                                                   */
/* ========================================================================== */

describe('opening the mail app', () => {
  it('copies first, then navigates to the server’s URL', async () => {
    stubClipboard({ rich: true });
    const result = await openInEmail(HANDOFF);

    expect(result.status).toBe(HANDOFF_RESULT.RICH);
    expect(result.opened).toBe(true);
    // Verbatim. Not rebuilt, not appended to.
    expect(navigated).toEqual([HANDOFF.mailtoUrl]);
  });

  /** THE REASON THE WHOLE DESIGN EXISTS. */
  it('puts no body in the URL', async () => {
    stubClipboard({ rich: true });
    await openInEmail(HANDOFF);

    expect(navigated[0]).not.toContain('body=');
    expect(navigated[0]).not.toContain('tokA');
    expect(navigated[0]).not.toContain('Best');
  });

  it('carries a recipient and a subject and no other parameter', async () => {
    stubClipboard({ rich: true });
    await openInEmail(HANDOFF);

    const url = new URL(navigated[0]);
    expect(url.protocol).toBe('mailto:');
    expect([...new URLSearchParams(url.search).keys()]).toEqual(['subject']);
    for (const header of ['cc=', 'bcc=', 'from=', 'reply-to=']) {
      expect(navigated[0].toLowerCase()).not.toContain(header);
    }
  });

  /**
   * IT OPENS EVEN WHEN THE COPY FAILED. The operator still wants the compose
   * window with the address and subject in it; the UI tells them the body did
   * not copy and shows it. Refusing to open would take away the half that
   * worked.
   */
  it('still opens when the clipboard refused', async () => {
    stubClipboard({ rich: false, plain: false });
    const result = await openInEmail(HANDOFF);

    expect(result.status).toBe(HANDOFF_RESULT.MANUAL);
    expect(result.opened).toBe(true);
    expect(navigated).toEqual([HANDOFF.mailtoUrl]);
  });

  it('navigates nowhere when there is no URL to navigate to', async () => {
    stubClipboard({ rich: true });
    const result = await openInEmail({ ...HANDOFF, mailtoUrl: null });
    expect(result.opened).toBe(false);
    expect(navigated).toEqual([]);
  });
});

/* ========================================================================== */
/*  In the composer                                                           */
/* ========================================================================== */

const PLAYER = {
  id: 'athlete-1', full_name: 'Nikau Brennan', sport: 'mens-soccer',
  position: 'Midfielder', recruiting_class_year: 2027,
};
const COACHES = [
  { coach_id: 'coach-1', name: 'Head Person', email: 'head@stanford.test', title: 'Head Coach' },
  { coach_id: 'coach-2', name: 'Assistant Person', email: 'asst@stanford.test', title: 'Assistant Coach' },
];
const college = () => ({
  id: 'col-stanford', name: 'Stanford', sport: 'mens-soccer',
  division: 'NCAA D1', conference: 'ACC', coaching_staff: COACHES,
});

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    if (path.includes('/evidence')) {
      const names = JSON.parse(opts.body || '{}').collegeNames ?? [];
      return ok(Object.fromEntries(names.map((n) => [n, { selected: [], available: [] }])));
    }
    return ok({});
  }));
}

async function mount(onSend) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(EmailComposer, {
      open: true, onOpenChange: () => {}, player: PLAYER, college: college(),
      allowImmediateSend: false, onSend,
    })));
  });
}

const text = () => document.body.textContent;
const buttons = () => Array.from(document.body.querySelectorAll('button'));
const buttonsLabelled = (label) => buttons().filter((b) => b.textContent.trim() === label);
const rows = () => Array.from(document.body.querySelectorAll('[data-testid="handoff-row"]'));
const composeButton = () => buttons().find((b) => /^Prepare \d|Working/.test(b.textContent.trim()));

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

/** Prepares both coaches and returns with the handoff section rendered. */
async function prepare(handoffs = [HANDOFF, SECOND]) {
  stubFetch();
  await mount(async () => ({
    reachable: true,
    from: { requested: null, actual: null, mismatch: false },
    results: [
      { email: 'head@stanford.test', name: 'Head Person', status: 'drafted', handoff: handoffs[0] ?? null },
      { email: 'asst@stanford.test', name: 'Assistant Person', status: 'drafted', handoff: handoffs[1] ?? null },
    ],
  }));
  await click(composeButton());
}

describe('the composer after preparing', () => {
  it('shows one row per prepared coach, each with both actions', async () => {
    stubClipboard({ rich: true });
    await prepare();

    expect(rows()).toHaveLength(2);
    expect(buttonsLabelled(OPEN_IN_EMAIL)).toHaveLength(2);
    expect(buttonsLabelled(COPY_EMAIL)).toHaveLength(2);
    expect(text()).toContain('head@stanford.test');
    expect(text()).toContain('asst@stanford.test');
  });

  /**
   * NOTHING HAPPENS UNTIL SOMEBODY CLICKS. Not one window, not two — zero.
   * Three mailto navigations from one gesture would be popup-blocked, and
   * would leave the operator with three compose windows and no idea which
   * clipboard contents belong to which.
   */
  it('opens nothing by itself', async () => {
    stubClipboard({ rich: true });
    await prepare();
    expect(navigated).toEqual([]);
    expect(written).toEqual([]);
  });

  it('opens only the coach whose button was pressed', async () => {
    stubClipboard({ rich: true });
    await prepare();
    await click(buttonsLabelled(OPEN_IN_EMAIL)[0]);

    expect(navigated).toEqual([HANDOFF.mailtoUrl]);
    expect(navigated[0]).toContain('head@stanford.test');
    expect(navigated[0]).not.toContain('asst@stanford.test');
  });

  it('gives each coach their own body, never the other’s', async () => {
    stubClipboard({ rich: false, plain: true });
    await prepare();

    await click(buttonsLabelled(OPEN_IN_EMAIL)[1]);
    expect(written.at(-1).text).toBe(SECOND.body);
    expect(written.at(-1).text).toContain('tokB');
    expect(written.at(-1).text).not.toContain('tokA');
  });

  it('copies without opening anything when Copy email is used', async () => {
    stubClipboard({ rich: true });
    await prepare();
    await click(buttonsLabelled(COPY_EMAIL)[0]);

    expect(written).toHaveLength(1);
    expect(navigated).toEqual([]);
  });

  it('offers the row again after it has been opened', async () => {
    stubClipboard({ rich: true });
    await prepare();
    await click(buttonsLabelled(OPEN_IN_EMAIL)[0]);

    expect(text()).toContain(HANDOFF_OPENED);
    expect(buttonsLabelled(HANDOFF_RETRY)).toHaveLength(1);
    await click(buttonsLabelled(HANDOFF_RETRY)[0]);
    expect(navigated).toHaveLength(2);
  });

  it('shows no row for a coach who was not prepared', async () => {
    stubClipboard({ rich: true });
    await prepare([HANDOFF, null]);

    expect(rows()).toHaveLength(1);
    expect(buttonsLabelled(OPEN_IN_EMAIL)).toHaveLength(1);
  });

  it('shows no handoff section at all on the macOS path', async () => {
    stubClipboard({ rich: true });
    await prepare([null, null]);

    expect(document.body.querySelector('[data-testid="handoff-section"]')).toBeNull();
    expect(rows()).toHaveLength(0);
  });
});

/* ========================================================================== */
/*  What it says                                                              */
/* ========================================================================== */

describe('the wording', () => {
  it('tells the operator to paste, before they go looking for the body', async () => {
    stubClipboard({ rich: true });
    await prepare();
    await click(buttonsLabelled(OPEN_IN_EMAIL)[0]);
    expect(text()).toContain(HANDOFF_READY);
  });

  /**
   * THE SENTENCE THAT KEEPS THE CONFIRMATION HONEST. A compose window opening
   * feels finished and is not: nothing has been pasted, read or sent.
   */
  it('says plainly that nothing has been sent', async () => {
    stubClipboard({ rich: true });
    await prepare();
    expect(text()).toContain(HANDOFF_NOT_SENT_YET);
  });

  it('claims no send and names no mail application', async () => {
    stubClipboard({ rich: true });
    await prepare();
    await click(buttonsLabelled(OPEN_IN_EMAIL)[0]);

    const body = text();
    for (const forbidden of [
      'draft open in Outlook', 'Outlook draft', 'draft created in Outlook',
      'email sent', 'provider draft', 'delivery confirmed', 'delivered',
      'Open in Outlook',
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it('names no mail application on its buttons either', async () => {
    stubClipboard({ rich: true });
    await prepare();
    for (const b of buttons()) {
      expect(b.textContent, b.textContent).not.toMatch(/Outlook|Gmail|Apple Mail/);
    }
  });

  it('warns when only plain text could be copied', async () => {
    stubClipboard({ rich: false, plain: true });
    await prepare();
    await click(buttonsLabelled(OPEN_IN_EMAIL)[0]);
    expect(text()).toContain(HANDOFF_PLAIN_ONLY);
  });
});

/* ========================================================================== */
/*  When the clipboard will not take it                                       */
/* ========================================================================== */

describe('a browser that refuses the clipboard', () => {
  it('shows the authoritative body for the operator to copy by hand', async () => {
    stubClipboard({ rich: false, plain: false });
    await prepare();
    await click(buttonsLabelled(OPEN_IN_EMAIL)[0]);

    expect(text()).toContain(HANDOFF_CLIPBOARD_FAILED);
    const manual = document.body.querySelector('[data-testid="handoff-manual-body"]');
    expect(manual).toBeTruthy();
    // The server's body, and only for that coach.
    expect(manual.value).toBe(HANDOFF.body);
  });

  /**
   * READ-ONLY, because this is the text the DRAFT row holds. An operator
   * editing it here would be editing a copy that no longer matches the
   * record; editing belongs in the composer above, before the draft is
   * prepared.
   */
  it('does not let the operator edit the copy on screen', async () => {
    stubClipboard({ rich: false, plain: false });
    await prepare();
    await click(buttonsLabelled(OPEN_IN_EMAIL)[0]);

    expect(document.body.querySelector('[data-testid="handoff-manual-body"]').readOnly).toBe(true);
  });

  it('shows nothing to copy by hand while the clipboard is working', async () => {
    stubClipboard({ rich: true });
    await prepare();
    await click(buttonsLabelled(OPEN_IN_EMAIL)[0]);

    expect(document.body.querySelector('[data-testid="handoff-manual-body"]')).toBeNull();
    expect(text()).not.toContain(HANDOFF_CLIPBOARD_FAILED);
  });
});
