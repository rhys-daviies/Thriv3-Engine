// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import CampaignTab, { groupFor, GROUP } from './CampaignTab.jsx';
import { BLOCKER_COPY, blockerCopy } from '@/lib/campaignLabels';
import { campaigns } from '@/api/client';

/**
 * F8b — THE CAMPAIGN AN OPERATOR CAN FINALLY SEE.
 *
 * The architecture has been able to answer "what would this campaign do next
 * and what is stopping it" since B6, and no screen has ever asked. This is the
 * screen, and this checkpoint is READ-ONLY on purpose: whether the server's
 * answers are legible has to be settled before the page is allowed to act on
 * them.
 *
 * ---------------------------------------------------------------------------
 * THE TWO FIELDS THAT LOOK LIKE THE ANSWER AND ARE NOT.
 *
 *   `priorityActions` is the order actions should be CONSIDERED in and
 *   includes programmes that are not executable — F8a found a manual-only
 *   programme sitting at priority 1 with executableNow false. Rendered as a
 *   ready list it would put a school the campaign may not write to at the top.
 *
 *   `operatorReviewRequired` is true for a first-touch review AND for nobody
 *   reachable, a step disagreement, unresolved timing and an unconfigured
 *   mailbox. The review UI keys on `firstTouchReview.required` alone.
 *
 * Both have a test below that fails if the screen ever starts believing them.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-campaign-ui';

let container;
let root;

/** A programme entry in the shape the execution plan actually returns. */
const programme = (over = {}) => ({
  programmeCampaignId: `pc-${over.collegeName ?? 'x'}`,
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
  currentAttempt: { id: null, state: null, storedStep: null },
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
  operatorReviewRequired: false,
  blockers: [],
  policyEligibleOn: null,
  nextActionAt: null,
  candidates: { eligible: 1, beyondDepth: 0, ineligible: 0 },
  ...over,
});

/** A programme held for first-touch review, with history behind it. */
const heldForReview = (over = {}) => programme({
  collegeName: 'Duke',
  executableNow: false,
  operatorReviewRequired: true,
  firstTouchReview: {
    required: true,
    reason: 'PRIOR_CONFIRMED_CONTACT',
    approval: { status: 'none', approvedAt: null, approvedByOperatorId: null },
  },
  blockers: [{ source: 'OPERATOR', code: 'PRIOR_CONFIRMED_CONTACT' }],
  currentCoach: {
    ...programme().currentCoach,
    priorContact: {
      hasConfirmedSend: true,
      confirmedSendCount: 2,
      firstConfirmedSendAt: '2026-08-10T11:00:00.000Z',
      lastConfirmedSendAt: '2026-08-20T11:00:00.000Z',
      origins: ['manual'],
    },
  },
  ...over,
});

const CAMPAIGN = {
  id: 'camp-1', athlete_id: ATHLETE, sport: 'mens-soccer', label: null, state: 'active',
  starts_on: '2026-09-01', outreach_ends_on: null, ends_on: null, programme_count: 1,
};

const plan = (programmes, over = {}) => ({
  campaign: {
    id: 'camp-1', athleteId: ATHLETE, sport: 'mens-soccer', state: 'active',
    startsOn: '2026-09-01', outreachEndsOn: null, endsOn: null, onDate: '2026-09-15',
  },
  summary: {
    programmeCount: programmes.length,
    executableNowCount: programmes.filter((p) => p.executableNow).length,
    operatorReviewRequiredCount: programmes.filter((p) => p.operatorReviewRequired).length,
    budget: {
      sendingIdentity: 'send@thriv3.test', athleteUsed: 0, athleteLimit: 10,
      athleteRemaining: 10, mailboxUsed: 0, mailboxLimit: 25, mailboxRemaining: 25,
    },
    simulation: {},
  },
  programmes,
  priorityActions: [],
  ...over,
});

let calls;

function stubApi({ campaignList = [CAMPAIGN], executionPlan = plan([programme()]), fail = null } = {}) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ?? null });
    if (fail && String(path).includes(fail)) {
      return {
        ok: false, status: 500, headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ error: 'boom' }),
      };
    }
    const payload = String(path).includes('/execution-plan')
      ? executionPlan
      : { campaigns: campaignList };
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
const cards = () => Array.from(container.querySelectorAll('[data-testid="campaign-programme"]'));
const section = (key) => container.querySelector(`[aria-labelledby="campaign-${key}"]`);
const buttons = () => Array.from(container.querySelectorAll('button'));
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

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
/* Grouping — one programme, one group                                          */
/* -------------------------------------------------------------------------- */

describe('every programme lands in exactly one group', () => {
  it('sends a first-touch review to Needs your review', () => {
    expect(groupFor(heldForReview())).toBe(GROUP.REVIEW);
  });

  it('sends an executable programme to Ready', () => {
    expect(groupFor(programme())).toBe(GROUP.READY);
  });

  it('sends an exhausted programme to Complete', () => {
    expect(groupFor(programme({
      executableNow: false, exhausted: true, nextAction: 'NO_FURTHER_COLD_OUTREACH',
    }))).toBe(GROUP.COMPLETE);
  });

  it('sends a PROHIBITION to Not contactable', () => {
    expect(groupFor(programme({
      executableNow: false,
      safety: { evaluated: true, allowed: false, reason: 'RELATIONSHIP_DO_NOT_CONTACT', kind: 'PROHIBITION' },
      blockers: [{ source: 'SAFETY', code: 'RELATIONSHIP_DO_NOT_CONTACT' }],
    }))).toBe(GROUP.BLOCKED);
  });

  it('sends a TIMING refusal to Waiting', () => {
    expect(groupFor(programme({
      executableNow: false,
      safety: { evaluated: true, allowed: false, reason: 'CAMPAIGN_NOT_STARTED', kind: 'TIMING' },
      blockers: [{ source: 'SAFETY', code: 'CAMPAIGN_NOT_STARTED' }],
    }))).toBe(GROUP.WAITING);
  });

  it('sends a follow-up that is not due yet to Waiting', () => {
    expect(groupFor(programme({
      executableNow: false, nextAction: 'FOLLOW_UP', derivedStep: 2,
      blockers: [{ source: 'TIMING', code: 'FOLLOW_UP_NOT_YET_DUE' }],
      policyEligibleOn: '2026-09-24',
    }))).toBe(GROUP.WAITING);
  });

  it('sends a programme blocked only by campaign-wide capacity to Waiting', () => {
    /**
     * Nothing is wrong with this school. One setting is unset, and when it is
     * set the programme is executable — which is waiting, not a decision about
     * this programme. Without this rule an unconfigured mailbox turned every
     * ready programme into an apparent demand for attention.
     */
    expect(groupFor(programme({
      executableNow: false,
      budget: { evaluated: true, allowed: false, reason: 'MAILBOX_LIMIT_REQUIRED' },
      operatorReviewRequired: true,
      blockers: [{ source: 'BUDGET', code: 'MAILBOX_LIMIT_REQUIRED' }],
    }))).toBe(GROUP.WAITING);
  });

  it('still sends one blocked by capacity AND something local to that something', () => {
    // The campaign-wide blocker is not the only one, so it does not decide.
    expect(groupFor(programme({
      executableNow: false,
      safety: { evaluated: true, allowed: false, reason: 'RELATIONSHIP_DO_NOT_CONTACT', kind: 'PROHIBITION' },
      blockers: [
        { source: 'SAFETY', code: 'RELATIONSHIP_DO_NOT_CONTACT' },
        { source: 'BUDGET', code: 'MAILBOX_LIMIT_REQUIRED' },
      ],
    }))).toBe(GROUP.BLOCKED);
  });

  it('sends everything else to Needs a decision', () => {
    expect(groupFor(programme({
      executableNow: false, currentCoach: null, nextAction: 'AWAITING_OPERATOR',
      blockers: [{ source: 'OPERATOR', code: 'RESPONSE_OBSERVED' }],
    }))).toBe(GROUP.DECISION);
  });

  it('puts a reviewable programme in the review group and nowhere else', async () => {
    /**
     * THE PRECEDENCE, END TO END. A programme can be held for review AND
     * blocked AND waiting at once; it appears once, in the group an operator
     * would act on first.
     */
    stubApi({
      executionPlan: plan([
        heldForReview(),
        programme({ collegeName: 'Stanford', programmeCampaignId: 'pc-stanford' }),
        programme({
          collegeName: 'UCLA', programmeCampaignId: 'pc-ucla', executableNow: false,
          safety: { evaluated: true, allowed: false, reason: 'RELATIONSHIP_MANUAL_ONLY', kind: 'PROHIBITION' },
          blockers: [{ source: 'SAFETY', code: 'RELATIONSHIP_MANUAL_ONLY' }],
        }),
      ]),
    });
    await render();

    expect(cards()).toHaveLength(3);
    expect(section(GROUP.REVIEW).textContent).toContain('Duke');
    expect(section(GROUP.READY).textContent).toContain('Stanford');
    expect(section(GROUP.BLOCKED).textContent).toContain('UCLA');
    // Duke appears once across the whole page.
    expect(text().split('Duke').length - 1).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The two misleading fields                                                    */
/* -------------------------------------------------------------------------- */

describe('the screen does not believe the fields that look like the answer', () => {
  it('does not treat operatorReviewRequired as a first-touch review', async () => {
    stubApi({
      executionPlan: plan([programme({
        collegeName: 'UNC',
        executableNow: false,
        // True for nobody reachable, step drift, unresolved timing and an
        // unconfigured mailbox — none of which an operator approves.
        operatorReviewRequired: true,
        currentCoach: null,
        nextAction: 'NO_FURTHER_COLD_OUTREACH',
        policyReason: 'NO_ELIGIBLE_COACHES',
        exhausted: true,
        blockers: [{ source: 'POLICY', code: 'NO_ELIGIBLE_COACHES' }],
      })]),
    });
    await render();

    expect(section(GROUP.REVIEW)).toBeNull();
    expect(container.querySelector('[data-testid="first-touch-review"]')).toBeNull();
    expect(text()).toContain('No reachable staff on file');
  });

  it('does not use priorityActions as the ready list', async () => {
    stubApi({
      executionPlan: plan(
        [programme({
          collegeName: 'UCLA', executableNow: false,
          safety: { evaluated: true, allowed: false, reason: 'RELATIONSHIP_MANUAL_ONLY', kind: 'PROHIBITION' },
          blockers: [{ source: 'SAFETY', code: 'RELATIONSHIP_MANUAL_ONLY' }],
        })],
        {
          // Exactly what the server returns: a prohibited programme at the top
          // of the consideration order, not executable.
          priorityActions: [{
            priority: 1, programmeCampaignId: 'pc-UCLA', collegeName: 'UCLA',
            executableNow: false, blockers: [{ source: 'SAFETY', code: 'RELATIONSHIP_MANUAL_ONLY' }],
          }],
        },
      ),
    });
    await render();

    expect(section(GROUP.READY)).toBeNull();
    expect(section(GROUP.BLOCKED).textContent).toContain('UCLA');
  });
});

/* -------------------------------------------------------------------------- */
/* Prior contact                                                                */
/* -------------------------------------------------------------------------- */

describe('prior contact is shown as what it is', () => {
  it('reads hasConfirmedSend, not the count', async () => {
    /**
     * THE LEGACY SHAPE. A relationship older than the per-message table is a
     * confirmed send with a count of zero, and a screen testing `count > 0`
     * would hide exactly the coaches with the longest history.
     */
    stubApi({
      executionPlan: plan([heldForReview({
        currentCoach: {
          ...programme().currentCoach,
          priorContact: {
            hasConfirmedSend: true,
            confirmedSendCount: 0,
            firstConfirmedSendAt: '2025-04-02T11:00:00.000Z',
            lastConfirmedSendAt: '2025-04-02T11:00:00.000Z',
            origins: [],
          },
        },
      })]),
    });
    await render();

    expect(text()).toContain('already had confirmed outreach');
    expect(text()).toMatch(/number of messages was not recorded/i);
    expect(text()).not.toMatch(/0 confirmed sends/);
  });

  it('counts and dates a normal history', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();
    expect(text()).toContain('2 confirmed sends on file');
    // The viewer's locale decides the order, so the parts are what matter.
    expect(text()).toMatch(/Last confirmed contact (20 Aug|Aug 20)/);
    expect(text()).toMatch(/First confirmed contact (10 Aug|Aug 10)/);
  });

  it('names each route, and calls an unrecorded origin what it is', async () => {
    stubApi({
      executionPlan: plan([heldForReview({
        currentCoach: {
          ...programme().currentCoach,
          priorContact: {
            hasConfirmedSend: true, confirmedSendCount: 3,
            firstConfirmedSendAt: '2026-08-01T11:00:00.000Z',
            lastConfirmedSendAt: '2026-08-20T11:00:00.000Z',
            origins: ['campaign', 'manual', null],
          },
        },
      })]),
    });
    await render();

    expect(text()).toContain('Campaign outreach');
    expect(text()).toContain('Relationship or manual outreach');
    expect(text()).toContain('origin not recorded');
    // Never the machine word.
    expect(text()).not.toMatch(/\bnull\b/);
  });

  it('claims nothing about what the coach did with any of it', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();
    for (const claim of [/opened/i, /has read/i, /read receipt/i, /marked as read/i,
      /delivered/i, /clicked/i, /bounced/i, /replied/i]) {
      expect(text(), String(claim)).not.toMatch(claim);
    }
  });

  it('shows a stale approval as needing review again', async () => {
    stubApi({
      executionPlan: plan([heldForReview({
        firstTouchReview: {
          required: true,
          reason: 'PRIOR_CONFIRMED_CONTACT',
          approval: {
            status: 'stale', approvedAt: '2026-09-12T09:00:00.000Z',
            approvedByOperatorId: 'op-1',
          },
        },
      })]),
    });
    await render();

    expect(container.querySelector('[data-testid="stale-approval"]')).toBeTruthy();
    expect(text()).toMatch(/contact recorded since/i);
    expect(text()).toMatch(/out of date because further confirmed contact/i);
    // Whose decision it was is not printed — an operator id is not a name.
    expect(text()).not.toContain('op-1');
  });
});

/* -------------------------------------------------------------------------- */
/* Blocker wording                                                              */
/* -------------------------------------------------------------------------- */

describe('each refusal is said in its own words', () => {
  const withBlocker = (code, kind = 'PROHIBITION') => plan([programme({
    collegeName: 'Somewhere',
    executableNow: false,
    safety: { evaluated: true, allowed: false, reason: code, kind },
    blockers: [{ source: 'SAFETY', code }],
  })]);

  it('states manual-only neutrally, as a route rather than a fault', async () => {
    stubApi({ executionPlan: withBlocker('RELATIONSHIP_MANUAL_ONLY') });
    await render();
    expect(text()).toContain('Manual outreach only');
    expect(text()).toMatch(/a person still can/i);
    // Not an error, and nothing offering to fix it.
    expect(text()).not.toMatch(/error|failed|problem/i);
  });

  it('states do-not-contact as the prohibition it is', async () => {
    stubApi({ executionPlan: withBlocker('RELATIONSHIP_DO_NOT_CONTACT') });
    await render();
    expect(text()).toContain('Do not contact');
    expect(text()).toMatch(/No outreach goes to it by any route/i);
  });

  it('states suppression as the address opting out of everything', async () => {
    stubApi({ executionPlan: withBlocker('SUPPRESSED') });
    await render();
    expect(text()).toContain('Address opted out');
    expect(text()).toMatch(/every athlete and every campaign/i);
  });

  it('states revocation in terms of the tracking link', async () => {
    stubApi({ executionPlan: withBlocker('OUTREACH_REVOKED') });
    await render();
    expect(text()).toContain('Outreach revoked');
    expect(text()).toMatch(/tracking link no longer resolves/i);
  });

  it('dates a follow-up that is not due yet', async () => {
    stubApi({
      executionPlan: plan([programme({
        executableNow: false, nextAction: 'FOLLOW_UP', derivedStep: 2,
        blockers: [{ source: 'TIMING', code: 'FOLLOW_UP_NOT_YET_DUE' }],
        policyEligibleOn: '2026-09-24',
      })]),
    });
    await render();
    expect(text()).toMatch(/Follow-up due (24 Sep|Sep 24)/);
  });

  it('gives a code nobody has written copy for a safe generic line', async () => {
    stubApi({ executionPlan: withBlocker('SOME_FUTURE_REFUSAL') });
    await render();
    expect(text()).toContain('Not available for outreach');
    // The raw machine vocabulary never reaches an operator.
    expect(text()).not.toContain('SOME_FUTURE_REFUSAL');
  });
});

/* -------------------------------------------------------------------------- */
/* Campaign-wide capacity                                                       */
/* -------------------------------------------------------------------------- */

describe('a campaign-wide problem is said once', () => {
  it('does not turn one unset setting into sixty demands for attention', async () => {
    const blocked = (name) => programme({
      collegeName: name, programmeCampaignId: `pc-${name}`, executableNow: false,
      operatorReviewRequired: true,
      blockers: [{ source: 'BUDGET', code: 'MAILBOX_LIMIT_REQUIRED' }],
    });
    stubApi({ executionPlan: plan([blocked('Duke'), blocked('Stanford')]) });
    await render();

    // Waiting for a setting, not a decision about these schools.
    expect(section(GROUP.WAITING).textContent).toContain('Duke');
    expect(section(GROUP.DECISION)).toBeNull();
  });

  it('hoists an unconfigured mailbox limit into one banner', async () => {
    /**
     * F8a's finding: with THRIV3_MAILBOX_DAILY_OUTBOUND unset, EVERY programme
     * carries this blocker. Printed per card it is a hundred identical warnings
     * burying whatever is actually about the school.
     */
    const blocked = (name) => programme({
      collegeName: name, programmeCampaignId: `pc-${name}`, executableNow: false,
      budget: { evaluated: true, allowed: false, reason: 'MAILBOX_LIMIT_REQUIRED' },
      operatorReviewRequired: true,
      blockers: [{ source: 'BUDGET', code: 'MAILBOX_LIMIT_REQUIRED' }],
    });
    stubApi({ executionPlan: plan([blocked('Duke'), blocked('Stanford'), blocked('UCLA')]) });
    await render();

    const banners = container.querySelectorAll('[data-testid="campaign-banner"]');
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain('Sending not configured');
    // Once on the page, not once per card.
    expect(text().split('Sending not configured').length - 1).toBe(1);
    expect(text()).toMatch(/not a problem with these programmes/i);
  });

  it('shows no banner when capacity is configured', async () => {
    stubApi({ executionPlan: plan([programme()]) });
    await render();
    expect(container.querySelector('[data-testid="campaign-banner"]')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Summary, states and search                                                   */
/* -------------------------------------------------------------------------- */

describe('the header counts what the sections show', () => {
  it('counts each group from the programmes it renders', async () => {
    stubApi({
      executionPlan: plan([
        heldForReview(),
        programme({ collegeName: 'Stanford', programmeCampaignId: 'pc-s' }),
        programme({ collegeName: 'Yale', programmeCampaignId: 'pc-y' }),
        programme({
          collegeName: 'UCLA', programmeCampaignId: 'pc-u', executableNow: false,
          safety: { evaluated: true, allowed: false, reason: 'RELATIONSHIP_MANUAL_ONLY', kind: 'PROHIBITION' },
          blockers: [{ source: 'SAFETY', code: 'RELATIONSHIP_MANUAL_ONLY' }],
        }),
      ]),
    });
    await render();

    expect(container.querySelector('[data-testid="count-review"]').textContent).toMatch(/1\s*need your review/);
    expect(container.querySelector('[data-testid="count-ready"]').textContent).toMatch(/2\s*ready/);
    expect(container.querySelector('[data-testid="count-blocked"]').textContent).toMatch(/1\s*not contactable/);
    expect(text()).toContain('4 programmes');
    expect(text()).toContain('Active');
  });

  it('filters by school or coach without asking the server again', async () => {
    stubApi({
      executionPlan: plan([
        programme({ collegeName: 'Stanford', programmeCampaignId: 'pc-s' }),
        programme({ collegeName: 'Yale', programmeCampaignId: 'pc-y' }),
      ]),
    });
    await render();
    const before = calls.length;

    const input = container.querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        .set.call(input, 'yale');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(cards()).toHaveLength(1);
    expect(text()).toContain('Yale');
    expect(calls.length).toBe(before);
  });
});

describe('loading, empty and failure', () => {
  it('shows skeletons rather than an empty state while loading', async () => {
    let resolve;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { resolve = r; })));
    await act(async () => {
      root.render(createElement(
        MemoryRouter, { initialEntries: [`/player/${ATHLETE}/campaign`] },
        createElement(Routes, null,
          createElement(Route, { path: '/player/:id', element: createElement(Shell) },
            createElement(Route, { path: 'campaign', element: createElement(CampaignTab) }))),
      ));
    });

    expect(container.querySelector('[data-testid="campaign-loading"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="campaign-empty"]')).toBeNull();
    expect(resolve).toBeTruthy();
  });

  it('says no campaign is running, and what does exist', async () => {
    stubApi({
      campaignList: [
        { ...CAMPAIGN, id: 'c-draft', state: 'draft' },
        { ...CAMPAIGN, id: 'c-closed', state: 'closed' },
      ],
    });
    await render();

    const empty = container.querySelector('[data-testid="campaign-empty"]');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No campaign is running');
    // Named rather than selected: choosing between drafts is not this screen's.
    expect(empty.textContent).toMatch(/1 draft campaign is waiting/);
    expect(empty.textContent).toMatch(/1 campaign has been closed/);
    // And no plan was fetched for a campaign that is not running.
    expect(calls.some((c) => c.path.includes('/execution-plan'))).toBe(false);
  });

  it('says nothing at all when the plan cannot be read, and retries', async () => {
    stubApi({ fail: '/execution-plan' });
    await render();

    expect(text()).toContain('could not be loaded');
    expect(cards()).toHaveLength(0);
    const retry = buttons().find((b) => b.textContent.includes('Try again'));
    expect(retry).toBeTruthy();

    const before = calls.filter((c) => c.path.includes('/execution-plan')).length;
    await click(retry);
    expect(calls.filter((c) => c.path.includes('/execution-plan')).length).toBe(before + 1);
  });

  it('does not call a campaign with no programmes a success', async () => {
    stubApi({ executionPlan: plan([]) });
    await render();
    expect(container.querySelector('[data-testid="campaign-no-programmes"]')).toBeTruthy();
    expect(text()).toContain('This campaign contains no programmes');
  });
});

/* -------------------------------------------------------------------------- */
/* Read-only                                                                    */
/* -------------------------------------------------------------------------- */

describe('the page can review, and cannot send', () => {
  it('offers no control that would make a message happen', async () => {
    stubApi({
      executionPlan: plan([
        heldForReview(),
        programme({ collegeName: 'Stanford', programmeCampaignId: 'pc-s' }),
      ]),
    });
    await render();

    /**
     * APPROVING IS NOT SENDING, and this is the list that keeps the difference.
     * Recording that a person reviewed prior contact clears one hold; every
     * stance, suppression and lifecycle rule is evaluated afterwards, and there
     * is still nothing anywhere on this page that makes an email happen.
     */
    const labels = buttons().map((b) => b.textContent).join(' | ');
    for (const forbidden of [/\bsend\b/i, /execute/i, /prepare/i, /materialise/i, /\bstart\b/i,
      /\bstop\b/i, /complete campaign/i, /remove/i, /\bedit\b/i, /change tier/i, /bulk/i]) {
      expect(labels, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('reads without writing until somebody presses something', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The client primitive                                                         */
/* -------------------------------------------------------------------------- */

describe('the approval primitive, established before it is used', () => {
  it('posts to the coach’s approval path with no body at all', async () => {
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      seen.push({ path, opts });
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        json: async () => ({ approval: {}, firstTouchReview: {} }),
        text: async () => '{}',
      };
    }));

    await campaigns.approveFirstTouch('pc-1', 'coach-1');

    expect(seen[0].path).toBe('/api/programme-campaigns/pc-1/coaches/coach-1/first-touch-approval');
    expect(seen[0].opts.method).toBe('POST');
    /**
     * NO BODY, EVER. The operator, the history snapshot and the timestamp are
     * all derived server-side — a snapshot a caller could write would be an
     * approval that never goes stale.
     */
    expect(seen[0].opts.body).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Vocabulary exhaustiveness                                                    */
/* -------------------------------------------------------------------------- */

describe('every code the server can send has words', () => {
  it('covers the whole known blocker vocabulary', () => {
    /**
     * The list the server can actually produce, read off `BLOCKER_CODE`,
     * `CONTACT_REFUSAL` and `PURSUIT_REASON`. A code added there without copy
     * here would reach an operator as the generic line — safe, but uninformative
     * — so this is what keeps that rare.
     */
    const serverCodes = [
      'PRIOR_CONFIRMED_CONTACT', 'RELATIONSHIP_DO_NOT_CONTACT', 'RELATIONSHIP_MANUAL_ONLY',
      'SUPPRESSED', 'OUTREACH_REVOKED', 'PROGRAMME_STOPPED', 'PROGRAMME_COMPLETED',
      'CAMPAIGN_NOT_ACTIVE', 'CAMPAIGN_NOT_STARTED', 'CAMPAIGN_OUTREACH_WINDOW_CLOSED',
      'FOLLOW_UP_NOT_YET_DUE', 'UNRESOLVED_FOLLOW_UP_TIMING', 'CONTACT_ATTEMPT_STEP_DRIFT',
      'ATHLETE_DAILY_BUDGET_WOULD_BE_EXCEEDED', 'MAILBOX_DAILY_BUDGET_WOULD_BE_EXCEEDED',
      'MAILBOX_LIMIT_REQUIRED', 'SENDING_IDENTITY_REQUIRED', 'RESPONSE_OBSERVED',
      'NO_ELIGIBLE_COACHES', 'ALL_COACHES_EXHAUSTED', 'TIER_DEPTH_REACHED',
      'PROGRAMME_CAMPAIGN_NOT_FOUND', 'CAMPAIGN_ATHLETE_MISMATCH', 'CAMPAIGN_PROGRAMME_MISMATCH',
    ];
    for (const code of serverCodes) {
      expect(BLOCKER_COPY, code).toHaveProperty(code);
    }
  });

  it('never shows a raw code, whatever it is handed', () => {
    for (const code of ['SOMETHING_NEW', '', null, undefined]) {
      const copy = blockerCopy(code);
      expect(copy.label).toBeTruthy();
      expect(copy.label).not.toMatch(/^[A-Z_]+$/);
      expect(copy.description).toBeTruthy();
    }
  });

  it('says nothing this build has not earned', () => {
    const all = JSON.stringify(BLOCKER_COPY);
    for (const claim of [/\bopened\b/i, /\bclicked\b/i, /\bdelivered\b/i, /\bbounced\b/i]) {
      expect(all, String(claim)).not.toMatch(claim);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Approving a first touch                                                      */
/* -------------------------------------------------------------------------- */

describe('recording that a person has looked', () => {
  const approveButton = () => buttons().find((b) => /Approve first touch|Review again/.test(b.textContent));
  const confirmButton = () => buttons().find((b) => b.textContent.includes('Confirm approval'));
  const approvalCalls = () => calls.filter((c) => c.path.includes('first-touch-approval'));

  it('offers approval where the server says a review is required', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();
    expect(approveButton()).toBeTruthy();
    expect(approveButton().textContent).toBe('Approve first touch');
  });

  it('offers Review again where the earlier approval has gone stale', async () => {
    stubApi({
      executionPlan: plan([heldForReview({
        firstTouchReview: {
          required: true, reason: 'PRIOR_CONFIRMED_CONTACT',
          approval: { status: 'stale', approvedAt: '2026-09-12T09:00:00.000Z', approvedByOperatorId: 'op-1' },
        },
      })]),
    });
    await render();
    expect(approveButton().textContent).toBe('Review again');
    expect(text()).toMatch(/out of date because further confirmed contact/i);
  });

  it('offers nothing on a programme the server is not holding', async () => {
    stubApi({
      executionPlan: plan([programme({ collegeName: 'Stanford', programmeCampaignId: 'pc-s' })]),
    });
    await render();
    expect(approveButton()).toBeUndefined();
  });

  it('offers nothing where the plan names no coach to approve', async () => {
    // The identifiers must be the plan's own; nothing is reconstructed from a
    // school name, so a review with no current coach has no control.
    stubApi({ executionPlan: plan([heldForReview({ currentCoach: null })]) });
    await render();
    expect(approveButton()).toBeUndefined();
  });

  it('says the scope out loud before it is a decision', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();
    await click(approveButton());

    // Named, so a click on the wrong card is caught before it is on the record.
    expect(text()).toMatch(/Approve the campaign’s first outreach to/);
    expect(text()).toContain('John Smith at Duke');
    expect(confirmButton()).toBeTruthy();
    // And nothing has been sent yet.
    expect(approvalCalls()).toHaveLength(0);
  });

  it('lets the operator back out', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();
    await click(approveButton());
    await click(buttons().find((b) => b.textContent === 'Cancel'));

    expect(confirmButton()).toBeUndefined();
    expect(approveButton()).toBeTruthy();
    expect(approvalCalls()).toHaveLength(0);
  });

  it('posts the plan’s own identifiers, with no body at all', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();
    await click(approveButton());
    await click(confirmButton());

    expect(approvalCalls()).toHaveLength(1);
    expect(approvalCalls()[0].path)
      .toBe('/api/programme-campaigns/pc-Duke/coaches/coach-1/first-touch-approval');
    expect(approvalCalls()[0].method).toBe('POST');
    /**
     * The operator, the history snapshot and the timestamp are the server's to
     * derive. A snapshot a caller could write would be an approval that never
     * goes stale.
     */
    expect(approvalCalls()[0].body).toBeNull();
  });

  it('shows a pending state and cannot be submitted twice', async () => {
    /**
     * The request is held open, because pending is transient BY DESIGN: it ends
     * when the fresh plan arrives, not when the POST returns, so a resolved
     * request would have replaced it before an assertion could see it.
     */
    let release;
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      calls.push({ path, method: opts.method || 'GET', body: opts.body ?? null });
      if (String(path).includes('first-touch-approval')) {
        return new Promise((r) => { release = () => r({
          ok: true, status: 200, headers: { get: () => 'application/json' },
          json: async () => ({}), text: async () => '{}',
        }); });
      }
      const payload = String(path).includes('/execution-plan')
        ? plan([heldForReview()]) : { campaigns: [CAMPAIGN] };
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        json: async () => payload, text: async () => JSON.stringify(payload),
      };
    }));
    await render();
    await click(approveButton());
    const confirm = confirmButton();
    await click(confirm);
    await click(confirm);

    expect(approvalCalls()).toHaveLength(1);
    expect(container.querySelector('[data-testid="approval-pending"]')).toBeTruthy();
    expect(confirmButton()).toBeUndefined();
    expect(release).toBeTruthy();
  });

  it('asks the server again rather than moving the card itself', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();
    const before = calls.filter((c) => c.path.includes('/execution-plan')).length;

    await click(approveButton());
    await click(confirmButton());

    // Nothing is assumed about what the approval did: the next plan decides.
    expect(calls.filter((c) => c.path.includes('/execution-plan')).length).toBe(before + 1);
  });
});

describe('the plan that comes back decides what happens next', () => {
  /** Approve, with the second execution-plan read returning `after`. */
  async function approveThen(after) {
    let planned = 0;
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      calls.push({ path, method: opts.method || 'GET', body: opts.body ?? null });
      let payload = { campaigns: [CAMPAIGN] };
      if (String(path).includes('/execution-plan')) {
        planned += 1;
        payload = planned === 1 ? plan([heldForReview()]) : after;
      }
      if (String(path).includes('first-touch-approval')) payload = { approval: {}, firstTouchReview: {} };
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        json: async () => payload, text: async () => JSON.stringify(payload),
      };
    }));
    await render();
    await click(buttons().find((b) => /Approve first touch/.test(b.textContent)));
    await click(buttons().find((b) => b.textContent.includes('Confirm approval')));
  }

  it('lands in Ready when nothing else is in the way', async () => {
    await approveThen(plan([programme({ collegeName: 'Duke', programmeCampaignId: 'pc-Duke' })]));
    expect(section(GROUP.READY).textContent).toContain('Duke');
    expect(section(GROUP.REVIEW)).toBeNull();
  });

  it('lands in Waiting when the mailbox limit is still unset', async () => {
    /**
     * APPROVAL CLEARS ONE HOLD. The campaign still cannot send, and the screen
     * says so in the one place that is true — the banner — rather than pretending
     * the approval finished the job.
     */
    await approveThen(plan([programme({
      collegeName: 'Duke', programmeCampaignId: 'pc-Duke', executableNow: false,
      blockers: [{ source: 'BUDGET', code: 'MAILBOX_LIMIT_REQUIRED' }],
    })]));
    expect(section(GROUP.WAITING).textContent).toContain('Duke');
    expect(container.querySelector('[data-testid="campaign-banner"]')).toBeTruthy();
  });

  it('lands in Not contactable when a stance has been set since', async () => {
    await approveThen(plan([programme({
      collegeName: 'Duke', programmeCampaignId: 'pc-Duke', executableNow: false,
      safety: { evaluated: true, allowed: false, reason: 'RELATIONSHIP_DO_NOT_CONTACT', kind: 'PROHIBITION' },
      blockers: [{ source: 'SAFETY', code: 'RELATIONSHIP_DO_NOT_CONTACT' }],
    })]));
    expect(section(GROUP.BLOCKED).textContent).toContain('Duke');
    expect(text()).toContain('Do not contact');
  });

  it('stays in Needs your review when the approval is already stale', async () => {
    // Contact was recorded between the approval and the reload, so the review
    // the operator gave no longer describes what is on file.
    await approveThen(plan([heldForReview({
      firstTouchReview: {
        required: true, reason: 'PRIOR_CONFIRMED_CONTACT',
        approval: { status: 'stale', approvedAt: '2026-09-15T09:00:00.000Z', approvedByOperatorId: 'op-1' },
      },
    })]));
    expect(section(GROUP.REVIEW).textContent).toContain('Duke');
    expect(buttons().find((b) => b.textContent === 'Review again')).toBeTruthy();
  });
});

describe('a failed approval does not cost the operator the page', () => {
  async function failWith({ status = 500, code = undefined, error = 'boom' } = {}) {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      calls.push({ path, method: opts.method || 'GET', body: opts.body ?? null });
      if (String(path).includes('first-touch-approval')) {
        return {
          ok: false, status, headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ error, code }),
        };
      }
      const payload = String(path).includes('/execution-plan')
        ? plan([heldForReview(), programme({ collegeName: 'Stanford', programmeCampaignId: 'pc-s' })])
        : { campaigns: [CAMPAIGN] };
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        json: async () => payload, text: async () => JSON.stringify(payload),
      };
    }));
    await render();
    await click(buttons().find((b) => /Approve first touch/.test(b.textContent)));
    await click(buttons().find((b) => b.textContent.includes('Confirm approval')));
  }

  it('keeps the plan and says so on the card that tried', async () => {
    await failWith();

    /**
     * A FAILED WRITE IS NOT A FAILED READ. The plan on screen is still the one
     * the server sent and is still true, so replacing the page with the
     * load-failure state would throw away something correct.
     */
    expect(cards()).toHaveLength(2);
    expect(text()).not.toContain('could not be loaded');
    const inline = container.querySelector('[data-testid="approval-error"]');
    expect(inline).toBeTruthy();
    expect(inline.textContent).toContain('Approval could not be recorded');
    // On the card that tried, and not on the other one.
    expect(inline.closest('[data-testid="campaign-programme"]').textContent).toContain('Duke');
  });

  it('lets the operator try again', async () => {
    await failWith();
    const before = calls.filter((c) => c.path.includes('first-touch-approval')).length;

    await click(buttons().find((b) => /Approve first touch/.test(b.textContent)));
    await click(buttons().find((b) => b.textContent.includes('Confirm approval')));
    expect(calls.filter((c) => c.path.includes('first-touch-approval')).length).toBe(before + 1);
  });

  it('reads the plan again when the server says there is nothing to approve', async () => {
    // Not a refusal: somebody else has changed something, and the honest answer
    // is to go and look rather than argue with it.
    await failWith({ status: 422, code: 'NO_REVIEW_REQUIRED' });
    expect(calls.filter((c) => c.path.includes('/execution-plan')).length).toBe(2);
    // At the page, because the reload may take the card that tried away.
    expect(container.querySelector('[data-testid="campaign-notice"]').textContent)
      .toMatch(/no longer a first-touch review/i);
    expect(container.querySelector('[data-testid="approval-error"]')).toBeNull();
  });

  it('reads the plan again when the campaign has moved to another coach', async () => {
    await failWith({ status: 422, code: 'COACH_NOT_IN_PURSUIT' });
    expect(calls.filter((c) => c.path.includes('/execution-plan')).length).toBe(2);
    expect(container.querySelector('[data-testid="campaign-notice"]').textContent)
      .toMatch(/no longer approaching that coach/i);
  });

  it('re-resolves the campaign when it has gone', async () => {
    await failWith({ status: 404, error: 'No campaign' });
    // Back through the hook, which resolves the current campaign again — and
    // would report none if the active one had closed.
    expect(calls.filter((c) => c.path.includes('/campaigns')).length).toBeGreaterThan(1);
    expect(container.querySelector('[data-testid="campaign-notice"]').textContent)
      .toMatch(/could not be found/i);
  });

  it('never shows the operator a raw server code', async () => {
    await failWith({ status: 422, code: 'NO_REVIEW_REQUIRED' });
    expect(container.querySelector('[data-testid="campaign-notice"]').textContent)
      .not.toMatch(/[A-Z]{4,}_[A-Z_]+/);
    // And the plain failure keeps its own inline wording, with no code either.
    await failWith();
    expect(container.querySelector('[data-testid="approval-error"]').textContent)
      .not.toMatch(/[A-Z]{4,}_[A-Z_]+/);
  });
});

describe('the approval control is reachable and named', () => {
  it('names the coach and the school for a screen reader', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();

    const label = buttons()
      .find((b) => /Approve first touch/.test(b.textContent))
      .getAttribute('aria-label');
    expect(label).toBe('Approve first touch: John Smith at Duke');
  });

  it('announces a failure as an alert, on the panel that tried', async () => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      calls.push({ path, method: opts.method || 'GET', body: opts.body ?? null });
      if (String(path).includes('first-touch-approval')) {
        return { ok: false, status: 500, headers: { get: () => 'application/json' },
          text: async () => '{}' };
      }
      const payload = String(path).includes('/execution-plan')
        ? plan([heldForReview()]) : { campaigns: [CAMPAIGN] };
      return { ok: true, status: 200, headers: { get: () => 'application/json' },
        json: async () => payload, text: async () => JSON.stringify(payload) };
    }));
    await render();
    await click(buttons().find((b) => /Approve first touch/.test(b.textContent)));
    await click(buttons().find((b) => b.textContent.includes('Confirm approval')));

    expect(container.querySelector('[data-testid="approval-error"]').getAttribute('role'))
      .toBe('alert');
  });

  it('is a real button, so it is keyboard reachable', async () => {
    stubApi({ executionPlan: plan([heldForReview()]) });
    await render();
    const approve = buttons().find((b) => /Approve first touch/.test(b.textContent));
    expect(approve.tagName).toBe('BUTTON');
    expect(approve.disabled).toBe(false);
  });
});
