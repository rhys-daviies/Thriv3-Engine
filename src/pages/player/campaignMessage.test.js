// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import CampaignTab from './CampaignTab.jsx';
import {
  MESSAGE_COPY, messageStateLabel, evidenceSentences, generationError, messageLoadError,
  blockerCopy,
} from '@/lib/campaignLabels';

/**
 * F10b-5 — WRITING THE EMAIL, READING IT, AND SAYING SO.
 *
 * ---------------------------------------------------------------------------
 * GENERATED IS NOT SENT, AND REVIEWED IS NOT SEND-APPROVED.
 *
 * Everything this suite asserts about copy is asserted because the alternative
 * wording would claim something that did not happen. Generating writes a
 * subject and a body into a row; reviewing records that a named person read
 * those exact words. No mailbox is touched, nothing is queued, scheduled or
 * dispatched, and there is no control anywhere on this page that makes an email
 * happen.
 * ---------------------------------------------------------------------------
 *
 * THE OTHER PROPERTY IS COST. A campaign holds a hundred programmes, and a
 * screen that discovered messages by asking per card — or that reloaded the
 * whole plan to open one email — would pay for the campaign every time somebody
 * looked at one message. The request counts are pinned.
 */

const ATHLETE = 'a-message-ui';

/** Repo-relative: `import.meta.url` is not a file URL under jsdom. */
const SRC = {
  tab: path.resolve(process.cwd(), 'src/pages/player/CampaignTab.jsx'),
  card: path.resolve(process.cwd(), 'src/components/CampaignProgrammeCard.jsx'),
  detail: path.resolve(process.cwd(), 'src/components/CampaignMessageDetail.jsx'),
  labels: path.resolve(process.cwd(), 'src/lib/campaignLabels.js'),
};

let container;
let root;
let calls;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

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
      hasConfirmedSend: false, confirmedSendCount: 0,
      firstConfirmedSendAt: null, lastConfirmedSendAt: null, origins: [],
    },
  },
  currentAttempt: { id: null, state: null, storedStep: null, createdAt: null },
  currentMessage: { id: null, state: null, generatedAt: null },
  derivedStep: 1,
  stepConsistent: true,
  nextAction: 'INITIAL_OUTREACH',
  actionClass: 'FIRST_CONTACT',
  policyReason: 'FIRST_CONTACT',
  exhausted: false,
  safety: { evaluated: true, allowed: true, reason: null, kind: null },
  budget: { evaluated: true, allowed: true, reason: null },
  firstTouchReview: {
    required: false, reason: null,
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

/** An intent is on file and nothing has been written. The Generate state. */
const prepared = (over = {}) => programme({
  preparableNow: false,
  currentAttempt: {
    id: 'att-1', state: 'planned', storedStep: 1, createdAt: '2026-09-12T10:30:00.000Z',
  },
  ...over,
});

const written = (state = 'generated', over = {}) => prepared({
  currentMessage: { id: 'msg-1', state, generatedAt: '2026-09-12T11:00:00.000Z' },
  ...over,
});

const BODY = 'Dear John,\n\nI am a 2027 midfielder and Duke is my first choice.\n\nRhys';

const EVIDENCE = {
  rendered: [
    { order: 2, slot: 'RELEVANCE', role: 'RELEVANCE', kind: 'ROSTER_GAP', text: 'You graduate two midfielders this year.' },
    { order: 1, slot: 'HOOK', role: 'HOOK', kind: 'RESULT', text: 'Your run to the ACC semi-final was the reason I wrote.' },
  ],
  /** Licensed, and deliberately NOT said in the email. Never a justification. */
  held: ['NATIONALITY_MATCH', 'COACH_TENURE'],
  structure: 'INITIAL',
  structureSource: 'ENGINE',
  templateVariant: null,
  hasPersonalisation: true,
  primaryKind: 'RESULT',
  primaryRole: 'HOOK',
  hookKind: 'RESULT',
  renderedKinds: 'RESULT,ROSTER_GAP',
  renderedRoles: 'HOOK,RELEVANCE',
  renderedCount: 2,
  operatorSelected: false,
  engineSelected: ['RESULT'],
  sequence: { step: 1, policy: 'ESP1' },
};

const message = (over = {}) => ({
  id: 'msg-1',
  programmeContactAttemptId: 'att-1',
  step: 1,
  coachId: 'coach-1',
  recipientEmail: 'john.smith.a.very.long.address@athletics.duke.edu',
  generatedSubject: 'Duke — 2027 midfielder',
  generatedBody: BODY,
  subject: 'Duke — 2027 midfielder',
  body: BODY,
  generatedBodyHash: 'hash-generated',
  bodyHash: 'hash-generated',
  bodySource: 'STRUCTURED',
  structure: 'INITIAL',
  policyVersion: 'PP1',
  sequencePolicyVersion: 'ESP1',
  state: 'generated',
  generatedAt: '2026-09-12T11:00:00.000Z',
  updatedAt: '2026-09-12T11:00:00.000Z',
  reviewedByOperatorId: null,
  reviewedAt: null,
  evidence: EVIDENCE,
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

/* -------------------------------------------------------------------------- */

const ok = (body, status = 200) => ({
  ok: true, status, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});
const bad = (status, body) => ({
  ok: false, status, headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(body),
});

/**
 * `plans` is a QUEUE — the first load takes the first entry and each reload the
 * next — so a test says what the server looks like AFTER an action without the
 * component ever being told.
 */
function stubApi({
  plans = [plan([prepared()])],
  generate = null,
  read = null,
  edit = null,
  review = null,
} = {}) {
  calls = [];
  const queue = [...plans];
  let current = queue.shift();

  vi.stubGlobal('fetch', vi.fn(async (p, opts = {}) => {
    const url = String(p);
    const method = opts.method || 'GET';
    calls.push({ path: url, method, body: opts.body ?? null });

    if (/\/coaches\/[^/]+\/message$/.test(url)) {
      const r = generate ?? { status: 201, body: message() };
      if (r.throws) throw r.throws;
      return r.status >= 400 ? bad(r.status, r.body) : ok(r.body, r.status);
    }
    if (/\/programme-messages\/[^/]+\/review$/.test(url)) {
      const r = review ?? {
        status: 200,
        body: message({
          state: 'reviewed', reviewedByOperatorId: 'op-1',
          reviewedAt: '2026-09-15T09:00:00.000Z',
        }),
      };
      if (r.throws) throw r.throws;
      return r.status >= 400 ? bad(r.status, r.body) : ok(r.body, r.status);
    }
    if (/\/programme-messages\//.test(url) && method === 'PATCH') {
      const r = edit ?? { status: 200, body: null };
      if (r.throws) throw r.throws;
      if (r.status >= 400) return bad(r.status, r.body);
      // Default: the server applies the patch and hands back the stored row.
      const patch = JSON.parse(opts.body ?? '{}');
      return ok(r.body ?? message({ ...patch, bodyHash: 'hash-edited' }), r.status);
    }
    if (/\/programme-messages\//.test(url)) {
      const r = read ?? { status: 200, body: message() };
      if (r.throws) throw r.throws;
      return r.status >= 400 ? bad(r.status, r.body) : ok(r.body, r.status);
    }
    if (url.includes('/execution-plan')) {
      const payload = current;
      if (queue.length) current = queue.shift();
      return ok(payload);
    }
    return ok({ campaigns: [CAMPAIGN] });
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
  await act(async () => {});
}

const text = () => container.textContent;
const el = (id) => container.querySelector(`[data-testid="${id}"]`);
const all = (sel) => Array.from(container.querySelectorAll(sel));
const buttonNamed = (re) => all('button')
  .find((b) => re.test(b.textContent) || re.test(b.getAttribute('aria-label') ?? ''));
const click = async (target) => {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
};
const type = async (input, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const generateButton = () => buttonNamed(/^Generate message$/);
const openButton = () => el('open-message');
const planLoads = () => calls.filter((c) => c.path.includes('/execution-plan'));
const generatePosts = () => calls.filter((c) => /\/coaches\/[^/]+\/message$/.test(c.path));
const messageGets = () => calls.filter(
  (c) => c.method === 'GET' && c.path.includes('/programme-messages/'),
);
const patches = () => calls.filter((c) => c.method === 'PATCH');
const reviewPosts = () => calls.filter((c) => c.path.endsWith('/review'));

/** Press Generate and confirm. */
async function generate() {
  await click(generateButton());
  await click(buttonNamed(/^Generate message$/));
}

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
/* A–B — which control a card offers                                           */
/* -------------------------------------------------------------------------- */

describe('the card offers exactly one next step', () => {
  it('A — offers Prepare and NOT Generate when nothing is prepared', async () => {
    stubApi({ plans: [plan([programme()])] });
    await render();

    expect(buttonNamed(/^Prepare next attempt$/)).toBeTruthy();
    expect(generateButton()).toBeFalsy();
    expect(el('generate-message')).toBeNull();
    /*
      THE ORDER IS THE PRODUCT'S. Nothing may be written for a coach the
      campaign has not recorded an intent to contact, and offering Generate here
      would let the screen skip the step that decides WHO the message is for.
    */
  });

  it('B — offers Generate once an attempt exists and no message does', async () => {
    stubApi();
    await render();

    expect(generateButton()).toBeTruthy();
    expect(buttonNamed(/^Prepare next attempt$/)).toBeFalsy();
    expect(el('message-marker')).toBeNull();
  });

  it('G — offers Review message once one is generated, and no Generate', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();

    expect(openButton().textContent).toBe(MESSAGE_COPY.open);
    expect(generateButton()).toBeFalsy();
    expect(el('message-status').textContent).toMatch(/Generated/);
  });

  it('H — offers View message once one is reviewed', async () => {
    stubApi({ plans: [plan([written('reviewed')])] });
    await render();

    expect(openButton().textContent).toBe(MESSAGE_COPY.openReviewed);
    expect(el('message-status').textContent).toMatch(/Reviewed/);
    expect(generateButton()).toBeFalsy();
  });

  /**
   * A CONTENT STATE IS NOT A PERMISSION, and this is the card assertion for it.
   * "Reviewed" must not read as "ready to go" beside a programme the campaign
   * is forbidden to write to.
   */
  it('Z — still shows a reviewed message on a programme that is now blocked', async () => {
    stubApi({
      plans: [plan([written('reviewed', {
        executableNow: false,
        preparableNow: false,
        safety: {
          evaluated: true, allowed: false, reason: 'RELATIONSHIP_DO_NOT_CONTACT',
          kind: 'PROHIBITION',
        },
        blockers: [{ source: 'SAFETY', code: 'RELATIONSHIP_DO_NOT_CONTACT' }],
      })])],
    });
    await render();

    expect(openButton()).toBeTruthy();
    expect(text()).toMatch(/Do not contact/i);
    // The state says what it is, and never that anything may happen next.
    expect(text()).not.toMatch(/ready to send|approved to send|will be sent/i);
  });
});

/* -------------------------------------------------------------------------- */
/* C–F — generating                                                            */
/* -------------------------------------------------------------------------- */

describe('generating a message', () => {
  it('C — names the coach and says out loud that nothing will be sent', async () => {
    stubApi();
    await render();
    await click(generateButton());

    expect(text()).toMatch(/Generate the message for/);
    expect(text()).toMatch(/John Smith at Duke/);
    expect(text()).toMatch(/Nothing will be sent/);
    // Not written until confirmed.
    expect(generatePosts()).toHaveLength(0);
    expect(buttonNamed(/^Cancel$/)).toBeTruthy();
  });

  it('C — cancelling writes nothing and returns the control', async () => {
    stubApi();
    await render();
    await click(generateButton());
    await click(buttonNamed(/^Cancel$/));

    expect(generatePosts()).toHaveLength(0);
    expect(generateButton()).toBeTruthy();
    expect(document.activeElement).toBe(generateButton());
  });

  it('D — announces the pending state while the request is in flight', async () => {
    let release;
    const held = new Promise((r) => { release = r; });
    stubApi({ generate: { throws: null } });
    // Re-stub with a request that does not resolve until told to.
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (p, opts = {}) => {
      if (/\/coaches\/[^/]+\/message$/.test(String(p))) {
        calls.push({ path: String(p), method: 'POST', body: opts.body ?? null });
        await held;
        return ok(message(), 201);
      }
      return base(p, opts);
    });

    await render();
    await click(generateButton());
    await click(buttonNamed(/^Generate message$/));

    const pending = el('generate-pending');
    expect(pending).toBeTruthy();
    expect(pending.textContent).toBe(MESSAGE_COPY.generatePending);
    expect(pending.getAttribute('role')).toBe('status');

    await act(async () => { release(); });
    await act(async () => {});
  });

  it('E — a success opens the detail view on the SERVER’s resource', async () => {
    stubApi({ plans: [plan([prepared()]), plan([written('generated')])] });
    await render();
    await generate();

    expect(el('message-detail')).toBeTruthy();
    expect(el('message-subject').value).toBe('Duke — 2027 midfielder');
    expect(el('message-body').value).toBe(BODY);
    expect(el('message-recipient').textContent)
      .toBe('john.smith.a.very.long.address@athletics.duke.edu');
    // The request carried no content at all.
    expect(generatePosts()).toHaveLength(1);
    expect(generatePosts()[0].body).toBeNull();
    expect(generatePosts()[0].method).toBe('POST');
    // One POST, one plan reload, and NO extra read: the POST returned the thing.
    expect(messageGets()).toHaveLength(0);
    expect(planLoads()).toHaveLength(2);
  });

  it('E — the campaign list is replaced, not stacked behind a dialog', async () => {
    stubApi({ plans: [plan([prepared()]), plan([written('generated')])] });
    await render();
    await generate();

    expect(el('campaign-programme')).toBeNull();
    expect(el('campaign-summary')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('F — a refusal the server owns goes to the page and reloads the plan', async () => {
    stubApi({
      plans: [plan([prepared()]), plan([programme()])],
      generate: { status: 422, body: { error: 'gone', code: 'COACH_NO_LONGER_CURRENT' } },
    });
    await render();
    await generate();

    expect(el('campaign-notice').textContent).toMatch(/different coach/);
    expect(el('message-detail')).toBeNull();
    expect(planLoads()).toHaveLength(2);
    // The plan on screen was never thrown away for a failed write.
    expect(el('campaign-summary')).toBeTruthy();
  });

  it('F — a dropped connection is retryable on the control that tried', async () => {
    stubApi({ generate: { throws: new TypeError('Failed to fetch') } });
    await render();
    await generate();

    expect(el('generate-error')).toBeTruthy();
    expect(el('generate-error').getAttribute('role')).toBe('alert');
    expect(el('campaign-notice')).toBeNull();
    // Nothing was reloaded: the plan is still the server's and still true.
    expect(planLoads()).toHaveLength(1);
    expect(generateButton()).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* I–K — opening one                                                           */
/* -------------------------------------------------------------------------- */

describe('opening a message that already exists', () => {
  it('I — reads it by id, and does NOT reload the campaign to do it', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());

    expect(messageGets()).toHaveLength(1);
    expect(messageGets()[0].path).toBe('/api/programme-messages/msg-1');
    expect(messageGets()[0].body).toBeNull();
    expect(planLoads()).toHaveLength(1);
    expect(el('message-detail')).toBeTruthy();
  });

  it('J — shows a bounded loading state while it arrives', async () => {
    let release;
    const held = new Promise((r) => { release = r; });
    stubApi({ plans: [plan([written('generated')])] });
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (p, opts = {}) => {
      if (/\/programme-messages\//.test(String(p))) {
        calls.push({ path: String(p), method: opts.method || 'GET', body: null });
        await held;
        return ok(message());
      }
      return base(p, opts);
    });

    await render();
    await click(openButton());

    expect(el('message-loading')).toBeTruthy();
    expect(el('message-loading').getAttribute('role')).toBe('status');
    expect(el('message-back')).toBeTruthy();

    await act(async () => { release(); });
    await act(async () => {});
    expect(el('message-detail')).toBeTruthy();
  });

  it('K — a dropped read is retryable inside the detail view', async () => {
    stubApi({
      plans: [plan([written('generated')])],
      read: { throws: new TypeError('Failed to fetch') },
    });
    await render();
    await click(openButton());

    expect(el('message-failed')).toBeTruthy();
    expect(el('message-failed').getAttribute('role')).toBe('alert');
    // The campaign was not destroyed to report a failed read.
    expect(planLoads()).toHaveLength(1);
    expect(buttonNamed(/^Try again$/)).toBeTruthy();
  });

  it('K — a message that is gone returns to the campaign and says so', async () => {
    stubApi({
      plans: [plan([written('generated')]), plan([prepared()])],
      read: { status: 404, body: { error: 'no message' } },
    });
    await render();
    await click(openButton());

    expect(el('message-detail')).toBeNull();
    expect(el('campaign-notice').textContent).toMatch(/no longer on file/);
    expect(planLoads()).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* L–P — editing                                                               */
/* -------------------------------------------------------------------------- */

describe('editing the words', () => {
  async function open() {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());
  }

  it('L/M/N — holds the draft locally and writes nothing per keystroke', async () => {
    await open();
    await type(el('message-subject'), 'Duke — a better subject');
    await type(el('message-body'), 'Rewritten.');

    expect(el('message-subject').value).toBe('Duke — a better subject');
    expect(el('message-body').value).toBe('Rewritten.');
    /*
      NOT A PATCH PER CHARACTER. Every keystroke would be a write and an
      `updated_at` on a row whose whole purpose is recording what a person
      approved.
    */
    expect(patches()).toHaveLength(0);
    expect(el('message-save').disabled).toBe(false);
  });

  it('N — Save is unavailable until something actually changed', async () => {
    await open();
    expect(el('message-save').disabled).toBe(true);

    await type(el('message-subject'), 'changed');
    expect(el('message-save').disabled).toBe(false);

    // Typed back: not dirty, because dirty is computed against the server's copy.
    await type(el('message-subject'), 'Duke — 2027 midfielder');
    expect(el('message-save').disabled).toBe(true);
  });

  it('O — sends ONLY the changed allowed fields, and reloads no campaign', async () => {
    await open();
    await type(el('message-body'), 'Rewritten body.');
    await click(el('message-save'));

    expect(patches()).toHaveLength(1);
    expect(JSON.parse(patches()[0].body)).toEqual({ body: 'Rewritten body.' });
    expect(patches()[0].path).toBe('/api/programme-messages/msg-1');
    /*
      NO PLAN RELOAD. An edit changes the subject and body of a message that is
      already `generated`; the programme's state, blockers, step and
      `currentMessage.state` are all exactly what they were.
    */
    expect(planLoads()).toHaveLength(1);
    expect(el('message-saved')).toBeTruthy();
    expect(el('message-save').disabled).toBe(true);
  });

  it('O — a subject-only change sends only a subject', async () => {
    await open();
    await type(el('message-subject'), 'New subject');
    await click(el('message-save'));

    expect(JSON.parse(patches()[0].body)).toEqual({ subject: 'New subject' });
  });

  it('O — never sends generated content, evidence, recipient or state', async () => {
    await open();
    await type(el('message-subject'), 'New subject');
    await type(el('message-body'), 'New body');
    await click(el('message-save'));

    const sent = JSON.parse(patches()[0].body);
    expect(Object.keys(sent).sort()).toEqual(['body', 'subject']);
    for (const forbidden of ['generatedSubject', 'generatedBody', 'evidence', 'recipientEmail',
      'state', 'step', 'coachId', 'bodyHash', 'reviewedByOperatorId']) {
      expect(sent, forbidden).not.toHaveProperty(forbidden);
    }
  });

  it('P — Review is unavailable while there are unsaved changes, and says why', async () => {
    await open();
    expect(el('message-review').disabled).toBe(false);

    await type(el('message-body'), 'Unsaved.');

    expect(el('message-review').disabled).toBe(true);
    expect(el('message-review-dirty').textContent).toBe(MESSAGE_COPY.reviewDirty);
    /*
      THE OPERATOR MUST KNOW WHAT THEY ARE REVIEWING. Recording a review against
      the server's stale copy would say a person approved words they had just
      replaced; saving silently on their behalf would record an approval of a
      draft they had not finished.
    */
    expect(reviewPosts()).toHaveLength(0);
  });

  it('P — and becomes available again once the change is saved', async () => {
    await open();
    await type(el('message-body'), 'Rewritten body.');
    await click(el('message-save'));

    expect(el('message-review').disabled).toBe(false);
    expect(el('message-review-dirty')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Q–T — reviewing                                                             */
/* -------------------------------------------------------------------------- */

describe('reviewing', () => {
  async function open(plans = [plan([written('generated')]), plan([written('reviewed')])]) {
    stubApi({ plans });
    await render();
    await click(openButton());
  }

  it('Q — confirms in review vocabulary, never approval or send vocabulary', async () => {
    await open();
    await click(el('message-review'));

    const confirm = el('message-review-confirm');
    expect(confirm.textContent).toMatch(/Review this message\?/);
    expect(confirm.textContent).toBe(
      `Review this message?${MESSAGE_COPY.reviewExplain}${MESSAGE_COPY.cancel}${MESSAGE_COPY.reviewConfirm}`,
    );
    expect(confirm.textContent).toMatch(/does not send, queue or schedule/);
    expect(confirm.textContent).not.toMatch(/\bApprove\b|Authorise|Ready to send/);
    expect(reviewPosts()).toHaveLength(0);
  });

  it('R — announces the pending state, then S — records and reloads the plan', async () => {
    await open();
    await click(el('message-review'));
    await click(buttonNamed(/^Mark as reviewed$/));

    expect(reviewPosts()).toHaveLength(1);
    // The reviewer is the server's. The request names nobody.
    expect(reviewPosts()[0].body).toBeNull();
    expect(reviewPosts()[0].method).toBe('POST');
    /*
      AND THE PLAN IS RELOADED — unlike a save. `currentMessage.state` genuinely
      changed, so the card behind this screen is now wrong until it is read
      again.
    */
    expect(planLoads()).toHaveLength(2);
  });

  it('S — the detail stays open and becomes the reviewed view', async () => {
    await open();
    await click(el('message-review'));
    await click(buttonNamed(/^Mark as reviewed$/));

    expect(el('message-detail')).toBeTruthy();
    expect(el('message-state').textContent).toBe(messageStateLabel('reviewed'));
    expect(el('message-reviewed-note').textContent).toMatch(/Reviewed/);
    // The id, because that is genuinely all we hold. No invented display name.
    expect(el('message-reviewed-note').textContent).toMatch(/op-1/);
  });

  it('T — a reviewed message is read-only, with no way back', async () => {
    await open();
    await click(el('message-review'));
    await click(buttonNamed(/^Mark as reviewed$/));

    expect(el('message-subject')).toBeNull();
    expect(el('message-body')).toBeNull();
    expect(el('message-subject-readonly').textContent).toBe('Duke — 2027 midfielder');
    expect(el('message-body-readonly').textContent).toBe(BODY);
    expect(el('message-save')).toBeNull();
    expect(el('message-review')).toBeNull();
    // No unreview, no reopen, no regenerate, and certainly no send.
    expect(buttonNamed(/unreview|reopen|regenerate|edit|send/i)).toBeFalsy();
  });

  it('X — says the words were edited before the review, where they were', async () => {
    stubApi({
      plans: [plan([written('reviewed')])],
      read: {
        status: 200,
        body: message({
          state: 'reviewed',
          subject: 'An operator’s subject',
          body: 'An operator’s body.',
          bodyHash: 'hash-edited',
          reviewedByOperatorId: 'op-1',
          reviewedAt: '2026-09-15T09:00:00.000Z',
        }),
      },
    });
    await render();
    await click(openButton());

    expect(el('message-reviewed-note').textContent).toMatch(MESSAGE_COPY.editedBeforeReview);
  });

  it('X — and does not say it where they were not', async () => {
    stubApi({
      plans: [plan([written('reviewed')])],
      read: {
        status: 200,
        body: message({
          state: 'reviewed', reviewedByOperatorId: 'op-1',
          reviewedAt: '2026-09-15T09:00:00.000Z',
        }),
      },
    });
    await render();
    await click(openButton());

    expect(el('message-reviewed-note').textContent).not.toMatch(MESSAGE_COPY.editedBeforeReview);
  });
});

/* -------------------------------------------------------------------------- */
/* U–W — why this was written                                                  */
/* -------------------------------------------------------------------------- */

describe('why this was written', () => {
  it('U — shows the sentences the email actually made, in the order it made them', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());

    const panel = el('message-evidence');
    expect(panel.textContent).toMatch(MESSAGE_COPY.evidenceHeading);
    const items = Array.from(panel.querySelectorAll('li')).map((li) => li.textContent);
    expect(items).toHaveLength(2);
    // `order`, not array order — the snapshot is not required to arrive sorted.
    expect(items[0]).toMatch(/ACC semi-final/);
    expect(items[1]).toMatch(/graduate two midfielders/);
    // A readable list, never the stored JSON.
    expect(panel.textContent).not.toMatch(/[{}[\]]|renderedKinds|"kind"/);
  });

  it('V — says truthfully when a message had no evidence behind it', async () => {
    stubApi({
      plans: [plan([written('generated')])],
      read: { status: 200, body: message({ evidence: { ...EVIDENCE, rendered: [] } }) },
    });
    await render();
    await click(openButton());

    expect(el('message-evidence-none').textContent).toBe(MESSAGE_COPY.evidenceNone);
    expect(text()).toMatch(/generic outreach template/);
  });

  it('V — and survives a message with no snapshot at all', async () => {
    stubApi({
      plans: [plan([written('generated')])],
      read: { status: 200, body: message({ evidence: null }) },
    });
    await render();
    await click(openButton());

    expect(el('message-evidence-none')).toBeTruthy();
  });

  /**
   * W — THE ASSERTION THIS PANEL EXISTS TO SURVIVE.
   *
   * `held` is a list of evidence KINDS the body cap licensed and deliberately
   * withheld — claims this email does NOT make. Showing them under "Why this
   * was written" would offer an operator a justification the coach will never
   * read.
   */
  it('W — never presents held evidence as something the email said', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());

    expect(text()).not.toMatch(/NATIONALITY_MATCH|COACH_TENURE/);
    const panel = el('message-evidence');
    expect(panel.querySelectorAll('li')).toHaveLength(EVIDENCE.rendered.length);
    // The helper itself reads `rendered` and nothing else.
    expect(evidenceSentences(EVIDENCE).map((s) => s.text))
      .toEqual([EVIDENCE.rendered[1].text, EVIDENCE.rendered[0].text]);
    expect(evidenceSentences({ held: ['X'], rendered: [] })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Y — leaving                                                                 */
/* -------------------------------------------------------------------------- */

describe('going back', () => {
  it('Y — returns straight to the campaign when nothing is unsaved', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());
    await click(el('message-back'));

    expect(el('message-detail')).toBeNull();
    expect(el('campaign-programme')).toBeTruthy();
    // Leaving reads nothing. The campaign was never unloaded.
    expect(planLoads()).toHaveLength(1);
  });

  it('Y — asks before discarding unsaved work, and can be cancelled', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());
    await type(el('message-body'), 'Half-written.');
    await click(el('message-back'));

    expect(el('message-discard').textContent).toMatch(MESSAGE_COPY.discard);
    expect(el('message-detail')).toBeTruthy();

    await click(buttonNamed(new RegExp(`^${MESSAGE_COPY.keepEditing}$`)));
    expect(el('message-discard')).toBeNull();
    expect(el('message-body').value).toBe('Half-written.');
  });

  it('Y — and discards only when the operator says so', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());
    await type(el('message-body'), 'Half-written.');
    await click(el('message-back'));
    await click(el('message-discard-confirm'));

    expect(el('message-detail')).toBeNull();
    expect(el('campaign-programme')).toBeTruthy();
    // Discarded means discarded. Nothing was written on the way out.
    expect(patches()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* AA–AC — what this page does not do                                          */
/* -------------------------------------------------------------------------- */

describe('nothing on this page sends, queues or schedules anything', () => {
  const codeOf = (file) => fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('AA — offers no send, queue, schedule or approve control anywhere', async () => {
    stubApi({ plans: [plan([written('generated')]), plan([written('reviewed')])] });
    await render();
    await click(openButton());

    const labels = () => all('button')
      .map((b) => `${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).join(' | ');
    expect(labels()).not.toMatch(/send|queue|schedule|dispatch|approve|authoris|execute/i);

    await click(el('message-review'));
    await click(buttonNamed(/^Mark as reviewed$/));
    expect(labels()).not.toMatch(/send|queue|schedule|dispatch|approve|authoris|execute/i);
  });

  it('AA — the detail view imports no transport, no mailbox and no model', () => {
    const code = codeOf(SRC.detail);
    expect(code).not.toMatch(/from '@\/api\/outreach/);
    expect(code).not.toMatch(/outlook|gmail|graph|smtp|oauth|mailbox|transport/i);
    expect(code).not.toMatch(/anthropic|openai|\bllm\b/i);
    // It composes nothing: every field it renders came off the resource.
    expect(code).not.toMatch(/composeProgrammeMessage|createProgrammeMessage|buildSendSnapshot/);
  });

  /**
   * THE VOCABULARY GUARD. Every string an operator can read on this screen,
   * checked against the words that would claim delivery.
   */
  it('AA — no copy in the message vocabulary implies delivery', () => {
    /*
      THE TWO DENIALS ARE THE EXCEPTION, and they are the only one. Both say the
      words out loud in order to refuse them, which is the opposite of claiming
      them — every other string is checked against the whole vocabulary.
    */
    const DENIALS = new Set([MESSAGE_COPY.generateExplain, MESSAGE_COPY.reviewExplain]);
    const strings = Object.values(MESSAGE_COPY)
      .filter((v) => typeof v === 'string' && !DENIALS.has(v));
    for (const s of strings) {
      expect(s, s).not.toMatch(/\bsend\b|\bsent\b|queue|schedule|dispatch|outbox|deliver/i);
    }
    expect(MESSAGE_COPY.generateExplain).toMatch(/Nothing will be sent/);
    expect(MESSAGE_COPY.reviewExplain).toMatch(/does not send, queue or schedule/);
    // And nothing anywhere calls a written message ready.
    for (const s of strings) expect(s, s).not.toMatch(/\bready\b/i);
  });

  it('AB — searching and filtering the campaign costs no request', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    const before = calls.length;

    const search = container.querySelector('input[aria-label^="Search programmes"]');
    await type(search, 'Duke');
    await type(search, 'Nowhere');

    expect(calls.length).toBe(before);
    expect(text()).toMatch(/No programme matches/);
  });

  it('AC — does not poll', async () => {
    vi.useFakeTimers();
    try {
      stubApi({ plans: [plan([written('generated')])] });
      await render();
      const before = calls.length;
      await act(async () => { vi.advanceTimersByTime(600_000); });
      expect(calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* AD–AE — usable on a phone, and with a keyboard                              */
/* -------------------------------------------------------------------------- */

describe('the screen is usable without a mouse or a wide window', () => {
  it('AD — wraps a long body and a long address rather than overflowing', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());

    // An address is one long unbreakable token; `break-word` is not enough.
    expect(el('message-recipient').className).toMatch(/break-all/);
    expect(el('message-heading').className).toMatch(/break-words/);
    const body = el('message-body');
    expect(body.className).toMatch(/min-h-/);
    expect(body.tagName).toBe('TEXTAREA');

    const code = fs.readFileSync(SRC.detail, 'utf8');
    // Nothing forces a width the phone has not got.
    expect(code).not.toMatch(/min-w-\[|w-\[\d{3,}px\]|overflow-x-scroll/);
  });

  /**
   * AD — FOUND BY LOOKING AT THE REAL SCREEN, on a real nine-paragraph email.
   *
   * A fixed-height textarea gave the message its own scrollbar inside a page
   * that also scrolls, so the operator read the thing they were reviewing
   * through a letterbox and a wheel over the field moved the wrong one.
   */
  it('AD — grows the body field to the whole email rather than scrolling it', async () => {
    stubApi({
      plans: [plan([written('generated')])],
      read: { status: 200, body: message({ body: Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.`).join('\n\n') }) },
    });
    await render();
    await click(openButton());

    const field = el('message-body');
    expect(field.className).toMatch(/overflow-hidden/);
    // jsdom reports no layout, so the assertion is that the height was SET from
    // the content rather than left to a fixed row count.
    expect(field.style.height).toBeTruthy();
    expect(field.className).not.toMatch(/overflow-y-(auto|scroll)/);
  });

  it('AD — explains the one token in the body that is not a word', async () => {
    stubApi({
      plans: [plan([written('generated')])],
      read: { status: 200, body: message({ body: `Hi,\n\nProfile:\n${MESSAGE_COPY.profileToken}\n\nRhys` }) },
    });
    await render();
    await click(openButton());

    expect(el('message-token-note').textContent).toBe(MESSAGE_COPY.profileTokenNote);
    // The token is NOT substituted: the field is editable and saved verbatim,
    // so a display-only swap would be written back as one coach's link.
    expect(el('message-body').value).toContain(MESSAGE_COPY.profileToken);
  });

  it('AD — and says nothing about a token a message does not carry', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());

    expect(el('message-token-note')).toBeNull();
  });

  it('AD — names the coach’s role in the product’s own words, as the card does', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());

    // The card says "Head coach"; this screen printed the stored `head`.
    expect(text()).toMatch(/Head Coach/);
    expect(el('message-detail').textContent).not.toMatch(/· head\b/);
  });

  it('AD — a reviewed body keeps its line breaks and still wraps', async () => {
    stubApi({
      plans: [plan([written('reviewed')])],
      read: {
        status: 200,
        body: message({ state: 'reviewed', reviewedByOperatorId: 'op-1', reviewedAt: '2026-09-15T09:00:00.000Z' }),
      },
    });
    await render();
    await click(openButton());

    expect(el('message-body-readonly').className).toMatch(/whitespace-pre-wrap/);
    expect(el('message-body-readonly').className).toMatch(/break-words/);
  });

  it('AE — the Generate control names the coach and the school to a screen reader', async () => {
    stubApi();
    await render();

    expect(generateButton().getAttribute('aria-label'))
      .toBe('Generate message: John Smith at Duke');
    await click(generateButton());
    expect(buttonNamed(/^Generate message$/).getAttribute('aria-label'))
      .toBe('Generate message: John Smith at Duke');
    expect(document.activeElement).toBe(buttonNamed(/^Generate message$/));
  });

  it('AE — the open control names what it opens, and which state it is in', async () => {
    stubApi({ plans: [plan([written('reviewed')])] });
    await render();
    expect(openButton().getAttribute('aria-label')).toBe('View message: John Smith at Duke');
  });

  it('AE — focus lands on the detail heading when a message opens', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());

    expect(document.activeElement).toBe(el('message-heading'));
    expect(el('message-heading').tagName).toBe('H2');
  });

  it('AE — focus moves to the recorded review', async () => {
    stubApi({ plans: [plan([written('generated')]), plan([written('reviewed')])] });
    await render();
    await click(openButton());
    await click(el('message-review'));
    expect(document.activeElement).toBe(buttonNamed(/^Mark as reviewed$/));

    await click(buttonNamed(/^Mark as reviewed$/));
    expect(document.activeElement).toBe(el('message-reviewed-note'));
    expect(el('message-reviewed-note').getAttribute('role')).toBe('status');
  });

  it('AE — and returns to the card that opened the message', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());
    await click(el('message-back'));

    expect(document.activeElement).toBe(el('open-message'));
  });

  it('AE — both fields carry a real label, not a placeholder', async () => {
    stubApi({ plans: [plan([written('generated')])] });
    await render();
    await click(openButton());

    for (const id of ['message-subject', 'message-body']) {
      const field = container.querySelector(`#${id}`);
      expect(field, id).toBeTruthy();
      expect(container.querySelector(`label[for="${id}"]`), id).toBeTruthy();
      expect(field.getAttribute('placeholder'), id).toBeNull();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The copy translators                                                        */
/* -------------------------------------------------------------------------- */

describe('every refusal the generation gate can raise has words', () => {
  const CODES = [
    'CONTACT_ATTEMPT_REQUIRED', 'CONTACT_ATTEMPT_NOT_PLANNED', 'COACH_NO_LONGER_CURRENT',
    'CONTACT_ATTEMPT_STEP_DRIFT', 'NO_ACTION_TO_PREPARE', 'RELATIONSHIP_MANUAL_ONLY',
    'RELATIONSHIP_DO_NOT_CONTACT', 'NO_ELIGIBLE_COACH', 'OUTREACH_REVOKED',
    'PROGRAMME_STOPPED', 'PROGRAMME_COMPLETED', 'CAMPAIGN_NOT_ACTIVE',
    'CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED',
  ];

  it('translates all thirteen, and asks for a fresh plan for every one', () => {
    for (const code of CODES) {
      const copy = generationError({ status: 422, code });
      expect(copy.message, code).toBeTruthy();
      /*
        EVERY ONE OF THESE MEANS THE SERVER HAS MOVED ON. There is no refusal in
        this set an operator can fix by pressing the button again, so the plan
        is re-read and left to decide what the card should say.
      */
      expect(copy.refresh, code).toBe(true);
      expect(copy.message, code).not.toMatch(/undefined|\[object/);
    }
  });

  it('does not reload for a failure the server has no opinion about', () => {
    const copy = generationError(new TypeError('Failed to fetch'));
    expect(copy.refresh).toBe(false);
    expect(copy.message).toMatch(/Try again/);
  });

  it('reuses the card’s own words for a decision somebody already took', () => {
    /*
      THE SAME SENTENCE, NOT A SECOND ONE. An operator who has read a
      prohibition on a card meets exactly those words when generation is refused
      for it — two copies of one explanation are two things that can drift.
    */
    for (const code of ['RELATIONSHIP_MANUAL_ONLY', 'RELATIONSHIP_DO_NOT_CONTACT',
      'PROGRAMME_STOPPED', 'CAMPAIGN_NOT_ACTIVE', 'OUTREACH_REVOKED']) {
      expect(generationError({ status: 422, code }).message, code)
        .toBe(`${blockerCopy(code).description} Reloading the campaign.`);
    }
  });

  it('sends an operator back to the campaign when a message is gone', () => {
    expect(messageLoadError({ status: 404 }).gone).toBe(true);
    expect(messageLoadError({ status: 500 }).gone).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe('the copy never promises a policy nobody has decided', () => {
  it('describes THIS operator reviewing THIS message, not a universal rule', () => {
    const strings = Object.values(MESSAGE_COPY).filter((v) => typeof v === 'string');
    for (const s of strings) {
      /*
        THE FUTURE AUTOMATION BOUNDARY. "Every email must be reviewed before it
        goes" is a policy nobody has decided, and copy that asserted it would
        make a later automated campaign look like a broken promise this screen
        invented. What is true today is that this transition is the one this
        screen offers.
      */
      expect(s, s).not.toMatch(/\bevery\b|\ball messages\b|\balways\b|\bmust be reviewed\b/i);
      expect(s, s).not.toMatch(/before it can be sent|before sending/i);
    }
    expect(MESSAGE_COPY.reviewExplain).toMatch(/you have reviewed/i);
  });

  it('keeps generated and reviewed as statements about words', () => {
    expect(messageStateLabel('generated')).toBe('Generated');
    expect(messageStateLabel('reviewed')).toBe('Reviewed');
    // A state this build has no meaning for gets a neutral marker, not an invented one.
    expect(messageStateLabel('something_else')).toBe('Written');
    expect(messageStateLabel(null)).toBeNull();
  });
});
