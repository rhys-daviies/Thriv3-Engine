// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import CampaignTab, { groupFor, GROUP } from './CampaignTab.jsx';
import { preparationError, preparedLabel, PREPARE_COPY } from '@/lib/campaignLabels';

/**
 * F9b-3 — THE FIRST CONTROL THAT RECORDS CAMPAIGN INTENT.
 *
 * ---------------------------------------------------------------------------
 * PREPARING IS NOT SENDING, AND THIS SUITE EXISTS TO KEEP THAT TRUE.
 *
 * A prepared attempt is one row saying the campaign INTENDS to write to the
 * coach the server named. No message is composed, no mailbox is touched, no
 * capacity is reserved, nothing is queued or scheduled. Every piece of copy
 * asserted below is asserted because the alternative wording would claim
 * something that did not happen.
 * ---------------------------------------------------------------------------
 *
 * THE CRITICAL TEST IS THE SECOND ONE. `preparableNow` and `executableNow`
 * answer different questions and disagree in both directions, so gating the
 * control on executability would hide it on exactly the programmes preparation
 * exists for — a follow-up not due yet, a campaign whose mailbox limit is
 * unset, a day whose budget is spent.
 */

const ATHLETE = 'a-prepare-ui';

/**
 * Repo-relative, because `import.meta.url` is not a file URL under jsdom —
 * the same reason `workspaceContext.test.js` resolves its sources this way.
 */
const SRC = {
  tab: path.resolve(process.cwd(), 'src/pages/player/CampaignTab.jsx'),
  card: path.resolve(process.cwd(), 'src/components/CampaignProgrammeCard.jsx'),
};

let container;
let root;
let calls;

const programme = (over = {}) => ({
  programmeCampaignId: 'pc-duke',
  collegeName: 'Duke',
  sport: 'mens-soccer',
  rank: 1,
  tier: 'A',
  tierSource: 'AUTO',
  programmeState: 'queued',
  policyVersion: 'PP1',
  coachDepth: 3,
  currentCoach: {
    id: 'coach-1',
    name: 'John Smith',
    role: 'head',
    email: 'john@duke.edu',
    emailStatus: 'verified',
    order: 1,
    priorContact: {
      hasConfirmedSend: false,
      confirmedSendCount: 0,
      firstConfirmedSendAt: null,
      lastConfirmedSendAt: null,
      origins: [],
    },
  },
  currentAttempt: { id: null, state: null, storedStep: null, createdAt: null },
  derivedStep: 1,
  stepConsistent: true,
  nextAction: 'INITIAL_OUTREACH',
  actionClass: 'FIRST_CONTACT',
  policyReason: 'FIRST_CONTACT',
  exhausted: false,
  safety: { evaluated: true, allowed: true, reason: null, kind: null },
  budget: { evaluated: true, allowed: true, reason: null },
  firstTouchReview: {
    required: false,
    reason: null,
    approval: { status: 'none', approvedAt: null, approvedByOperatorId: null },
  },
  executableNow: true,
  preparableNow: true,
  operatorReviewRequired: false,
  blockers: [],
  policyEligibleOn: null,
  nextActionAt: null,
  candidates: { eligible: 1, beyondDepth: 0, ineligible: 0 },
  ...over,
});

/** Prepared: an attempt is on file for the coach the plan names. */
const prepared = (over = {}) => programme({
  // The server says a NEW one cannot be prepared, because one already is.
  preparableNow: false,
  currentAttempt: {
    id: 'att-1', state: 'planned', storedStep: 1, createdAt: '2026-09-12T10:30:00.000Z',
  },
  ...over,
});

/** Waiting on a day, and preparable — the case executableNow would hide. */
const waitingButPreparable = (over = {}) => programme({
  executableNow: false,
  preparableNow: true,
  nextAction: 'FOLLOW_UP',
  derivedStep: 2,
  blockers: [{ source: 'TIMING', code: 'FOLLOW_UP_NOT_YET_DUE' }],
  policyEligibleOn: '2026-09-23',
  ...over,
});

const CAMPAIGN = {
  id: 'camp-1', athlete_id: ATHLETE, sport: 'mens-soccer', label: null, state: 'active',
  starts_on: '2026-09-01', outreach_ends_on: null, ends_on: null, programme_count: 1,
};

const plan = (programmes) => ({
  campaign: {
    id: 'camp-1', athleteId: ATHLETE, sport: 'mens-soccer', state: 'active',
    startsOn: '2026-09-01', outreachEndsOn: null, endsOn: null, onDate: '2026-09-15',
  },
  summary: {
    programmeCount: programmes.length,
    executableNowCount: programmes.filter((p) => p.executableNow).length,
    operatorReviewRequiredCount: 0,
    budget: {
      sendingIdentity: 'send@thriv3.test', athleteUsed: 0, athleteLimit: 10,
      athleteRemaining: 10, mailboxUsed: 0, mailboxLimit: 25, mailboxRemaining: 25,
    },
    simulation: {},
  },
  programmes,
  priorityActions: [],
});

/**
 * `plans` is a QUEUE: the first load takes the first entry and each reload takes
 * the next, so a test can say what the server looks like after a preparation
 * without the component being told anything about it.
 */
function stubApi({ plans = [plan([programme()])], prepareResponse = null } = {}) {
  calls = [];
  const queue = [...plans];
  let current = queue.shift();

  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ path: String(path), method, body: opts.body ?? null });

    if (String(path).includes('/contact-attempts')) {
      const r = prepareResponse ?? { status: 201, body: { created: true, attempt: { id: 'att-1' } } };
      if (r.throws) throw r.throws;
      if (r.status >= 400) {
        return {
          ok: false,
          status: r.status,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify(r.body),
        };
      }
      return {
        ok: true,
        status: r.status,
        headers: { get: () => 'application/json' },
        json: async () => r.body,
        text: async () => JSON.stringify(r.body),
      };
    }

    if (String(path).includes('/execution-plan')) {
      const payload = current;
      if (queue.length) current = queue.shift();
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        json: async () => payload, text: async () => JSON.stringify(payload),
      };
    }

    const payload = { campaigns: [CAMPAIGN] };
    return {
      ok: true, status: 200, headers: { get: () => 'application/json' },
      json: async () => payload, text: async () => JSON.stringify(payload),
    };
  }));
}

function Shell() {
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer', full_name: 'Test Athlete' });
  return createElement(Outlet, { context: { player } });
}

async function render() {
  await act(async () => {
    root.render(createElement(
      MemoryRouter, { initialEntries: [`/player/${ATHLETE}/campaign`] },
      createElement(Routes, null,
        createElement(Route, { path: '/player/:id', element: createElement(Shell) },
          createElement(Route, { path: 'campaign', element: createElement(CampaignTab) }))),
    ));
  });
}

const text = () => container.textContent;
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const buttonNamed = (re) => Array.from(container.querySelectorAll('button'))
  .find((b) => re.test(b.textContent) || re.test(b.getAttribute('aria-label') ?? ''));
const prepareButton = () => buttonNamed(/^Prepare next attempt$/);
const confirmButton = () => buttonNamed(/^Confirm preparation$/);
const cancelButton = () => Array.from(container.querySelectorAll('button'))
  .find((b) => b.textContent === 'Cancel');
const preparePosts = () => calls.filter((c) => c.path.includes('/contact-attempts'));
const planLoads = () => calls.filter((c) => c.path.includes('/execution-plan'));
const el = (testid) => container.querySelector(`[data-testid="${testid}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Visibility                                                                   */
/* -------------------------------------------------------------------------- */

describe('when the Prepare control is offered', () => {
  it('1. shows it when the server says preparable and no attempt exists', async () => {
    stubApi({ plans: [plan([programme()])] });
    await render();

    const button = prepareButton();
    expect(button).toBeTruthy();
    // Named in full, because a screen reader hears it without the card.
    expect(button.getAttribute('aria-label')).toBe('Prepare next attempt: John Smith at Duke');
  });

  /**
   * 2. THE CRITICAL ONE.
   *
   * A follow-up that is not due until the 23rd cannot be SENT today and can
   * perfectly well be PREPARED today — preparation is intent. Gating the
   * control on `executableNow` would have hidden it here, which is the whole
   * reason F9b-2 added a second field rather than reusing the first.
   */
  it('2. shows it where executableNow is false but preparableNow is true', async () => {
    stubApi({ plans: [plan([waitingButPreparable()])] });
    await render();

    expect(groupFor(waitingButPreparable())).toBe(GROUP.WAITING);
    expect(prepareButton()).toBeTruthy();
  });

  it('2. shows it where only a campaign-wide budget blocker stops execution', async () => {
    const p = programme({
      executableNow: false,
      preparableNow: true,
      budget: { evaluated: true, allowed: false, reason: 'MAILBOX_LIMIT_REQUIRED' },
      blockers: [{ source: 'BUDGET', code: 'MAILBOX_LIMIT_REQUIRED' }],
    });
    stubApi({ plans: [plan([p])] });
    await render();

    expect(groupFor(p)).toBe(GROUP.WAITING);
    expect(prepareButton()).toBeTruthy();
  });

  it('3. hides it where executableNow is true but preparableNow is false', async () => {
    stubApi({ plans: [plan([programme({ preparableNow: false })])] });
    await render();

    expect(prepareButton()).toBeFalsy();
    expect(el('prepare-attempt')).toBeNull();
  });

  it('hides it on a programme the campaign may not write to', async () => {
    stubApi({
      plans: [plan([programme({
        executableNow: false,
        preparableNow: false,
        safety: { evaluated: true, allowed: false, reason: 'RELATIONSHIP_DO_NOT_CONTACT', kind: 'PROHIBITION' },
        blockers: [{ source: 'SAFETY', code: 'RELATIONSHIP_DO_NOT_CONTACT' }],
      })])],
    });
    await render();

    expect(prepareButton()).toBeFalsy();
    expect(text()).toMatch(/Do not contact/);
  });
});

/* -------------------------------------------------------------------------- */
/* Prepared state                                                               */
/* -------------------------------------------------------------------------- */

describe('when an attempt is already prepared', () => {
  it('4. shows the prepared marker and no Prepare button', async () => {
    stubApi({ plans: [plan([prepared()])] });
    await render();

    expect(el('attempt-prepared')).toBeTruthy();
    expect(text()).toMatch(/Attempt prepared/);
    expect(prepareButton()).toBeFalsy();
  });

  it('5. dates it from createdAt', async () => {
    stubApi({ plans: [plan([prepared()])] });
    await render();

    expect(el('attempt-prepared').textContent).toMatch(/Prepared\s/);
    // Locale-agnostic: the day and the month, in whichever order this runtime
    // puts them.
    expect(el('attempt-prepared').textContent).toMatch(/12/);
    expect(el('attempt-prepared').textContent).toMatch(/Sep/);
  });

  it('6. shows the marker without a date when createdAt is missing', async () => {
    stubApi({
      plans: [plan([prepared({
        currentAttempt: { id: 'att-1', state: 'planned', storedStep: 1, createdAt: null },
      })])],
    });
    await render();

    expect(text()).toMatch(/Attempt prepared/);
    // No fabricated date, and no dangling separator.
    expect(el('attempt-prepared').textContent).not.toMatch(/Prepared\s*$/);
    expect(el('attempt-prepared').textContent.trim()).toBe('Attempt prepared');
  });

  it('7. falls back to neutral copy for an attempt state this build cannot mean', async () => {
    for (const state of ['active', 'stopped', 'waiting', 'completed', null]) {
      expect(preparedLabel({ id: 'att-1', state, createdAt: null }).label)
        .toBe('Attempt recorded');
    }
    expect(preparedLabel({ id: 'att-1', state: 'planned', createdAt: null }).label)
      .toBe('Attempt prepared');
    // No attempt, no marker.
    expect(preparedLabel({ id: null, state: null, createdAt: null })).toBeNull();
  });

  /**
   * THE WORDS THAT WOULD BE LIES. Every one of these claims something a
   * prepared attempt does not say, and an operator who read any of them would
   * think outreach had started.
   */
  it('never says sent, queued, scheduled or drafted', async () => {
    stubApi({ plans: [plan([prepared()])] });
    await render();

    const page = text();
    for (const forbidden of [
      /ready to send/i, /\bqueued\b/i, /\bscheduled\b/i, /\bdrafted\b/i,
      /email prepared/i, /message prepared/i, /\bsent\b(?!\s*(a|any))/i,
    ]) {
      expect(page, String(forbidden)).not.toMatch(forbidden);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Interaction                                                                  */
/* -------------------------------------------------------------------------- */

describe('preparing an attempt', () => {
  it('8. asks for confirmation before posting anything', async () => {
    stubApi({ plans: [plan([programme()])] });
    await render();

    await click(prepareButton());

    expect(text()).toMatch(/Prepare this attempt for John Smith at Duke\?/);
    expect(text()).toMatch(/Records the campaign’s next contact intent\. Nothing will be sent\./);
    expect(confirmButton()).toBeTruthy();
    expect(preparePosts()).toHaveLength(0);
  });

  it('8. focuses the confirm control so a keyboard user is not dropped', async () => {
    stubApi({ plans: [plan([programme()])] });
    await render();

    await click(prepareButton());
    expect(document.activeElement).toBe(confirmButton());
  });

  it('9. Cancel returns to idle, restores focus, and posts nothing', async () => {
    stubApi({ plans: [plan([programme()])] });
    await render();

    await click(prepareButton());
    await click(cancelButton());

    expect(prepareButton()).toBeTruthy();
    expect(document.activeElement).toBe(prepareButton());
    expect(preparePosts()).toHaveLength(0);
  });

  it('10. Confirm posts exactly once, to the right URL, with no body', async () => {
    stubApi({ plans: [plan([programme()]), plan([prepared()])] });
    await render();

    await click(prepareButton());
    await click(confirmButton());

    const posts = preparePosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('/api/programme-campaigns/pc-duke/contact-attempts');
    expect(posts[0].method).toBe('POST');
    expect(posts[0].body).toBeNull();
  });

  it('11. a second interaction while pending starts no second request', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    stubApi({ plans: [plan([programme()]), plan([prepared()])] });
    const inner = globalThis.fetch;
    /*
      COUNTED HERE, not from `calls`: the gate holds the request before the
      inner stub records it, so a request that has been STARTED and not yet
      answered would otherwise be invisible — which is exactly the one this
      test is about.
    */
    const started = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).includes('/contact-attempts')) { started.push(url); await gate; }
      return inner(url, opts);
    }));

    await render();
    await click(prepareButton());
    const confirm = confirmButton();
    await click(confirm);

    // In flight: the confirm control is gone, and the card says so.
    expect(el('prepare-pending')).toBeTruthy();
    expect(el('prepare-pending').getAttribute('role')).toBe('status');
    expect(confirmButton()).toBeFalsy();

    // Clicking the detached control again reaches the same guarded callback.
    await click(confirm);
    expect(started).toHaveLength(1);

    await act(async () => { release(); await Promise.resolve(); });
  });

  it('12. renders nothing as prepared until the server says so', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    stubApi({ plans: [plan([programme()]), plan([prepared()])] });
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).includes('/contact-attempts')) await gate;
      return inner(url, opts);
    }));

    await render();
    await click(prepareButton());
    await click(confirmButton());

    // Mid-flight the card has NOT claimed an attempt exists.
    expect(el('attempt-prepared')).toBeNull();
    expect(text()).not.toMatch(/Attempt prepared/);

    await act(async () => { release(); await Promise.resolve(); });
  });

  it('13. reloads on success and lets the fresh plan drive the card', async () => {
    stubApi({ plans: [plan([programme()]), plan([prepared()])] });
    await render();
    const before = planLoads().length;

    await click(prepareButton());
    await click(confirmButton());

    expect(planLoads().length).toBe(before + 1);
    // The card is prepared because the SERVER said so on reload, not because
    // the click assumed it.
    expect(el('attempt-prepared')).toBeTruthy();
    expect(prepareButton()).toBeFalsy();
    expect(text()).toMatch(/Attempt prepared for John Smith at Duke\. Nothing has been sent\./);
  });

  it('14. treats an idempotent 200 exactly as it treats a 201', async () => {
    stubApi({
      plans: [plan([programme()]), plan([prepared()])],
      prepareResponse: { status: 200, body: { created: false, attempt: { id: 'att-1' } } },
    });
    await render();
    const before = planLoads().length;

    await click(prepareButton());
    await click(confirmButton());

    expect(planLoads().length).toBe(before + 1);
    expect(el('attempt-prepared')).toBeTruthy();
    expect(el('prepare-error')).toBeNull();
  });

  it('gives the page notice focus, since the control that was pressed is gone', async () => {
    stubApi({ plans: [plan([programme()]), plan([prepared()])] });
    await render();

    await click(prepareButton());
    await click(confirmButton());

    expect(document.activeElement).toBe(el('campaign-notice'));
  });
});

/* -------------------------------------------------------------------------- */
/* Errors                                                                       */
/* -------------------------------------------------------------------------- */

describe('when preparing is refused', () => {
  const refusalCases = [
    ['15.', 'NO_ELIGIBLE_COACH', /nobody at this programme the campaign can approach/i],
    ['16.', 'NO_ACTION_TO_PREPARE', /no next message to prepare/i],
    ['17.', 'CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED', /needs reviewing before the campaign can pursue/i],
    ['18.', 'RELATIONSHIP_MANUAL_ONLY', /worked by hand/i],
    ['19.', 'RELATIONSHIP_DO_NOT_CONTACT', /set to do-not-contact/i],
    ['20.', 'CAMPAIGN_NOT_ACTIVE', /campaign is not active/i],
  ];

  for (const [n, code, expected] of refusalCases) {
    it(`${n} ${code} shows a page notice and reloads`, async () => {
      stubApi({
        plans: [plan([programme()]), plan([programme({ preparableNow: false })])],
        prepareResponse: { status: 422, body: { error: 'refused', code } },
      });
      await render();
      const before = planLoads().length;

      await click(prepareButton());
      await click(confirmButton());

      expect(el('campaign-notice')).toBeTruthy();
      expect(el('campaign-notice').textContent).toMatch(expected);
      expect(el('campaign-notice').textContent).toMatch(/Reloading the campaign/);
      expect(planLoads().length).toBe(before + 1);
      // Nothing is claimed to have been prepared.
      expect(el('attempt-prepared')).toBeNull();
    });
  }

  /**
   * 20. CAMPAIGN_NOT_ACTIVE COVERS A DRAFT AND A CLOSED CAMPAIGN, and telling
   * an operator to activate a campaign that has closed for good would be wrong
   * advice. The shared line says only what is true of both.
   */
  it('20. never tells the operator to activate the campaign', async () => {
    expect(preparationError({ code: 'CAMPAIGN_NOT_ACTIVE', status: 422 }).message)
      .not.toMatch(/activate/i);
  });

  it('404 is treated as the plan having moved on', () => {
    const copy = preparationError({ status: 404 });
    expect(copy.refresh).toBe(true);
    expect(copy.message).toMatch(/no longer part of the campaign/i);
  });

  it('21. a network failure keeps the plan and shows a retryable inline error', async () => {
    stubApi({
      plans: [plan([programme()])],
      prepareResponse: { throws: new TypeError('Failed to fetch') },
    });
    await render();
    const before = planLoads().length;

    await click(prepareButton());
    await click(confirmButton());

    // The plan on screen was the server's and is still true, so it stays.
    expect(planLoads().length).toBe(before);
    expect(text()).toMatch(/Duke/);
    expect(el('campaign-notice')).toBeNull();

    const alert = el('prepare-error');
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toMatch(/could not be prepared\. Try again\./);
    // And the control that can try again is back, with focus on it.
    expect(prepareButton()).toBeTruthy();
    expect(document.activeElement).toBe(prepareButton());
  });

  it('22. an unknown 500 behaves the same way', async () => {
    stubApi({
      plans: [plan([programme()])],
      prepareResponse: { status: 500, body: { error: 'Unexpected error.' } },
    });
    await render();
    const before = planLoads().length;

    await click(prepareButton());
    await click(confirmButton());

    expect(planLoads().length).toBe(before);
    expect(el('prepare-error')).toBeTruthy();
    expect(el('campaign-notice')).toBeNull();
    expect(prepareButton()).toBeTruthy();
  });

  it('a retry after a failure is allowed, because the endpoint is idempotent', async () => {
    let fail = true;
    stubApi({ plans: [plan([programme()]), plan([prepared()])] });
    const inner = globalThis.fetch;
    const started = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).includes('/contact-attempts')) {
        started.push(url);
        if (fail) { fail = false; throw new TypeError('Failed to fetch'); }
      }
      return inner(url, opts);
    }));

    await render();
    await click(prepareButton());
    await click(confirmButton());
    expect(el('prepare-error')).toBeTruthy();

    await click(prepareButton());
    await click(confirmButton());

    expect(started).toHaveLength(2);
    expect(el('attempt-prepared')).toBeTruthy();
  });

  it('the raw server code is never shown to an operator', async () => {
    stubApi({
      plans: [plan([programme()]), plan([programme({ preparableNow: false })])],
      prepareResponse: {
        status: 422,
        body: { error: 'refused', code: 'RELATIONSHIP_MANUAL_ONLY' },
      },
    });
    await render();

    await click(prepareButton());
    await click(confirmButton());

    expect(text()).not.toMatch(/RELATIONSHIP_MANUAL_ONLY/);
    expect(text()).not.toMatch(/_[A-Z]{2,}/);
  });
});

/* -------------------------------------------------------------------------- */
/* Grouping is untouched                                                        */
/* -------------------------------------------------------------------------- */

describe('preparation changes no grouping', () => {
  it('a prepared Ready programme stays Ready', () => {
    expect(groupFor(prepared())).toBe(GROUP.READY);
  });

  it('a preparable Waiting programme stays Waiting', () => {
    expect(groupFor(waitingButPreparable())).toBe(GROUP.WAITING);
  });

  it('an attempt existing changes nothing about the group', () => {
    for (const base of [
      programme(),
      programme({ executableNow: false, exhausted: true, nextAction: 'NO_FURTHER_COLD_OUTREACH' }),
      waitingButPreparable(),
      programme({
        executableNow: false,
        safety: { evaluated: true, allowed: false, reason: 'PROGRAMME_STOPPED', kind: 'PROHIBITION' },
        blockers: [{ source: 'SAFETY', code: 'PROGRAMME_STOPPED' }],
      }),
    ]) {
      const withAttempt = {
        ...base,
        preparableNow: false,
        currentAttempt: { id: 'att-9', state: 'planned', storedStep: 1, createdAt: null },
      };
      expect(groupFor(withAttempt)).toBe(groupFor(base));
    }
  });

  it('there is no PREPARED group', () => {
    expect(Object.values(GROUP)).not.toContain('prepared');
    expect(Object.keys(GROUP)).not.toContain('PREPARED');
    expect(Object.keys(GROUP).sort()).toEqual([
      'BLOCKED', 'COMPLETE', 'DECISION', 'READY', 'REVIEW', 'WAITING',
    ]);
  });

  it('groupFor reads no preparation field at all', () => {
    const src = fs.readFileSync(SRC.tab, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const body = src.slice(src.indexOf('export function groupFor'), src.indexOf('const SECTIONS'));
    expect(body).not.toMatch(/preparableNow|currentAttempt/);
  });

  it('a prepared programme keeps its place in snapshot rank order', async () => {
    const one = prepared({ programmeCampaignId: 'pc-1', collegeName: 'Alpha', rank: 1 });
    const two = programme({ programmeCampaignId: 'pc-2', collegeName: 'Bravo', rank: 2 });
    stubApi({ plans: [plan([one, two])] });
    await render();

    const names = Array.from(container.querySelectorAll('[data-testid="campaign-programme"]'))
      .map((c) => c.textContent);
    expect(names[0]).toMatch(/Alpha/);
    expect(names[1]).toMatch(/Bravo/);
  });
});

/* -------------------------------------------------------------------------- */
/* No-send guard                                                                */
/* -------------------------------------------------------------------------- */

describe('nothing on this page sends anything', () => {
  /**
   * THE PRODUCTION SOURCE, WITH ITS PROSE REMOVED.
   *
   * Matched against code rather than comments, because this slice's comments
   * say "sent", "send" and "queued" repeatedly — they are what keep the
   * distinction legible, and a guard that tripped on them would push the
   * explanation out of the file.
   */
  const codeOf = (file) => fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  /**
   * F10b-5 ADDED A THIRD FILE TO THIS PAGE. The message detail view renders an
   * email and two controls, and it is inside the guard from the day it exists
   * rather than after somebody notices it is not.
   */
  const SOURCES = [SRC.tab, SRC.card, path.resolve(process.cwd(), 'src/components/CampaignMessageDetail.jsx')];

  it('calls nothing on the client that sends, executes, runs or queues', () => {
    /*
      ACROSS BOTH FILES, not each: the card takes its two actions as callbacks
      and makes no client call of its own, which is the arrangement that keeps
      the write in one place.
    */
    const clientCalls = SOURCES.flatMap((file) => (
      [...codeOf(file).matchAll(/\b(?:campaigns|outreach)\.(\w+)\(/g)].map((m) => m[1])
    ));

    for (const name of clientCalls) {
      expect(name, name).not.toMatch(/send|execute|run|process|queue|schedule|dispatch/i);
    }
    /*
      AND THE ONLY SIX THIS PAGE MAY MAKE AT ALL.

      Four arrived with F10b-5 and every one of them is about CONTENT: write
      the words, read them, change them, record that a person read them. None
      of them delivers anything, and the set is pinned by name so a seventh
      cannot be added without this assertion being read and changed.
    */
    expect(new Set(clientCalls)).toEqual(new Set([
      'approveFirstTouch', 'prepareNextAttempt',
      'generateMessage', 'message', 'editMessage', 'reviewMessage',
    ]));
  });

  it('imports no sending client and no transport', () => {
    for (const file of SOURCES) {
      const code = codeOf(file);
      expect(code).not.toMatch(/from '@\/api\/outreach/);
      expect(code).not.toMatch(/\boutreach\s*\./);
    }
  });

  it('offers no bulk preparation anywhere', () => {
    for (const file of SOURCES) {
      const code = codeOf(file);
      expect(code).not.toMatch(/prepareAll|prepareReady|prepareCampaign|bulkPrepare/i);
      // No multi-select machinery either.
      expect(code).not.toMatch(/selectedProgrammes|checkedProgrammes|type="checkbox"/i);
    }
  });

  it('the operator-facing vocabulary says what a prepared attempt is', () => {
    expect(PREPARE_COPY.explain).toMatch(/Nothing will be sent/);
    for (const value of Object.values(PREPARE_COPY)) {
      expect(value).not.toMatch(/ready to send|queued|scheduled|drafted/i);
    }
  });
});
