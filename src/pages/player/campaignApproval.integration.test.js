// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import CampaignTab, { GROUP } from './CampaignTab.jsx';
import db from '../../../server/db/client.js';
import { campaignsRouter } from '../../../server/routes/campaigns.js';
import { suppress } from '../../../server/lib/suppressions.js';
import { MESSAGE_STATE } from '../../../shared/outreachMessageState.js';

/**
 * F8c — THE WHOLE PATH, WITH NOTHING PRETENDED.
 *
 * Every other campaign test stubs one side or the other: the component tests
 * fake the server's answers, and the server tests call the endpoint directly.
 * This one wires them together — the real React component, the real API client,
 * the real Express router, the real approval module and the real database — so
 * the only thing standing in for a browser is jsdom.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR.
 *
 * F8 made a claim that no component test can check on its own: that the screen
 * only renders and records server truth. Proving it needs the truth to be real —
 * a row actually written, a plan actually recomputed from it, and the card
 * moving because the server said so rather than because the client assumed it.
 *
 * So the interesting assertions here are the ones that span the boundary: the
 * approval row holds facts the client never sent, and a programme lands in
 * Ready, Waiting, Not contactable or back in Needs your review purely on what
 * the recomputed plan says.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-e2e';
const OPERATOR = 'op-e2e';
const NOW = '2026-09-01T00:00:00.000Z';

let baseUrl;
let container;
let root;
let calls;
let seq = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // `requireOperator` guards every /api route in the real server; this stands
  // in for the session it would have resolved.
  app.use((req, _res, next) => { req.operator = { id: OPERATOR, email: 'op@thriv3.test' }; next(); });
  app.use('/api', campaignsRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

afterAll(() => {});

/* -------------------------------------------------------------------------- */
/* The world                                                                    */
/* -------------------------------------------------------------------------- */

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, ?, ?, 'E2E Athlete', 'MIDFIELD', 'mens-soccer')
  `).run(id, NOW, NOW);
}

function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, ?)
  `).run(id, `${id}@thriv3.test`, NOW);
}

function coach({ school = 'Duke', email, name = 'John Smith', title = 'Head Coach' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title,
      email_status)
    VALUES (?, ?, ?, ?, ?, 'NCAA D1', 'mens-soccer', ?, 'verified')
  `).run(id, NOW, name, email ?? `c${++seq}@duke.edu`, school, title);
  return id;
}

function campaign({ id = 'camp-1', state = 'active' } = {}) {
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2026-09-01', ?, ?, ?, 1)
  `).run(id, ATHLETE, state, NOW, NOW, NOW);
  return id;
}

function programme(campaignId, { id = 'pc-1', college = 'Duke' } = {}) {
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, tier_set_at, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, 'A', 'AUTO', ?, 'queued', ?, ?)
  `).run(id, campaignId, college, ++seq, NOW, NOW, NOW);
  return id;
}

/** An accepted send on file, which is what makes a first touch reviewable. */
function confirmedSend(coachId, at = '2026-08-20T11:00:00.000Z', origin = 'manual') {
  const existing = db.prepare('SELECT id FROM outreach WHERE athlete_id = ? AND coach_id = ?')
    .get(ATHLETE, coachId);
  const outreachId = existing?.id ?? randomUUID();
  if (!existing) {
    db.prepare(`
      INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, sent_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(outreachId, ATHLETE, coachId, randomUUID(), NOW, at);
  }
  db.prepare(`
    INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id,
      college_name, sport, origin, policy_version, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Duke', 'mens-soccer', ?, 'LEGACY_UNKNOWN', ?, ?)
  `).run(randomUUID(), outreachId, ++seq, NOW, at, ATHLETE, coachId, origin,
    MESSAGE_STATE.ACCEPTED, NOW);
  return outreachId;
}

function stance(value, { college = 'Duke' } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
      visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?, ?, ?)
  `).run(randomUUID(), ATHLETE, college, value, NOW, NOW);
}

const approvals = () => db.prepare('SELECT * FROM campaign_first_touch_approvals').all();

/* -------------------------------------------------------------------------- */
/* The browser side                                                             */
/* -------------------------------------------------------------------------- */

/**
 * REAL REQUESTS, to the real router. The component and the API client are
 * untouched; only the base URL is supplied, because jsdom has no origin the
 * Express app is listening on.
 */
function wireFetch() {
  calls = [];
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (path, opts = {}) => {
    calls.push({ path: String(path), method: opts.method || 'GET', body: opts.body ?? null });
    return real(`${baseUrl}${path}`, opts);
  });
}

function Shell() {
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer', full_name: 'E2E Athlete' });
  return createElement(Outlet, { context: { player } });
}

/**
 * WAIT FOR REAL NETWORK, not for a microtask.
 *
 * The other campaign tests resolve stubbed promises and settle in one turn.
 * These go over a socket to an Express app and back, twice in sequence, so the
 * component is genuinely still loading after a tick. This drains turns until
 * the skeleton is gone rather than guessing a delay.
 */
async function settle(max = 40) {
  for (let i = 0; i < max; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    if (!container.querySelector('[data-testid="campaign-loading"]')) return;
  }
}

/** Close the page and open it again, which is what a reload really is. */
async function remount() {
  act(() => root.unmount());
  container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await render();
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
  await settle();
}

const text = () => container.textContent;
const buttons = () => Array.from(container.querySelectorAll('button'));
const section = (key) => container.querySelector(`[aria-labelledby="campaign-${key}"]`);
const planReads = () => calls.filter((c) => c.path.includes('/execution-plan')).length;
const listReads = () => calls.filter((c) => /\/players\/[^/]+\/campaigns$/.test(c.path)).length;
const approvalPosts = () => calls.filter((c) => c.path.includes('first-touch-approval'));

const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

/** Press Approve, then Confirm, and let the POST and the reload settle. */
async function approveFirstTouch() {
  await click(buttons().find((b) => /Approve first touch|Review again/.test(b.textContent)));
  await click(buttons().find((b) => b.textContent.includes('Confirm approval')));
  // The POST, then the list, then the plan — three round trips in sequence.
  for (let i = 0; i < 3; i += 1) await settle();
}

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM campaign_first_touch_approvals; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM players; DELETE FROM coaches;
           DELETE FROM operator_users; DELETE FROM suppressions;`);
  athlete(ATHLETE);
  operator(OPERATOR);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  wireFetch();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* The path, end to end                                                         */
/* -------------------------------------------------------------------------- */

describe('a review approved in the browser is a row in the database', () => {
  /** A campaign holding its first touch to a coach this athlete has written to. */
  function held() {
    const c = campaign();
    const pc = programme(c);
    const head = coach({ email: 'h@duke.edu' });
    confirmedSend(head);
    return { c, pc, head };
  }

  it('holds the first touch until a person records a review', async () => {
    held();
    await render();

    expect(section(GROUP.REVIEW)).toBeTruthy();
    expect(section(GROUP.REVIEW).textContent).toContain('Duke');
    expect(text()).toContain('This athlete has already had confirmed outreach to this coach.');
    expect(approvals()).toEqual([]);
  });

  it('writes the row, with facts the browser never sent', async () => {
    const { pc, head } = held();
    await render();
    await approveFirstTouch();

    /**
     * THE ASSERTION F8 EXISTS FOR. The request carried two route ids and no
     * body; everything else on this row was derived by the server from the
     * pursuit plan and the session. A snapshot a caller could write would be an
     * approval that never goes stale.
     */
    expect(approvalPosts()).toHaveLength(1);
    expect(approvalPosts()[0].body).toBeNull();
    expect(approvals()).toHaveLength(1);
    expect(approvals()[0]).toMatchObject({
      programme_campaign_id: pc,
      coach_id: head,
      approved_by_operator_id: OPERATOR,
      reviewed_confirmed_send_count: 1,
      reviewed_last_confirmed_send_at: '2026-08-20T11:00:00.000Z',
    });
    expect(approvals()[0].approved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('lands in Ready when the recomputed plan says nothing else is in the way', async () => {
    held();
    await render();
    await approveFirstTouch();

    expect(section(GROUP.READY).textContent).toContain('Duke');
    expect(section(GROUP.REVIEW)).toBeNull();
  });

  it('lands in Not contactable when a stance was set in the meantime', async () => {
    held();
    await render();
    // Somebody sets do-not-contact between the page loading and the approval.
    stance('do_not_contact');
    await approveFirstTouch();

    /**
     * APPROVAL CLEARS ONE HOLD. The row is written — a person did review the
     * history — and the programme is still refused, by a rule the approval
     * never had any bearing on.
     */
    expect(approvals()).toHaveLength(1);
    expect(section(GROUP.BLOCKED).textContent).toContain('Duke');
    expect(text()).toContain('Do not contact');
    expect(section(GROUP.READY)).toBeNull();
  });

  it('lands in Not contactable when the address opted out in the meantime', async () => {
    held();
    await render();
    suppress({ email: 'h@duke.edu' });
    await approveFirstTouch();

    // The suppressed coach is removed from the candidate list entirely, so the
    // programme has nobody to pursue rather than somebody it may not write to.
    expect(text()).toContain('No reachable staff on file');
    expect(section(GROUP.READY)).toBeNull();
  });

  it('returns to Needs your review when contact is recorded after the approval', async () => {
    const { head } = held();
    await render();
    await approveFirstTouch();
    expect(section(GROUP.READY)).toBeTruthy();

    // A second confirmed send. The sentence the operator agreed to is no longer
    // true of what is on file.
    confirmedSend(head, '2026-09-10T11:00:00.000Z');
    await remount();

    expect(section(GROUP.REVIEW).textContent).toContain('Duke');
    expect(text()).toMatch(/out of date because further confirmed contact/i);
    expect(buttons().find((b) => b.textContent === 'Review again')).toBeTruthy();
  });

  it('keeps the approval current across a fresh page load', async () => {
    held();
    await render();
    await approveFirstTouch();

    // Reopen: a new mount, a new plan, the same row. Nothing about the history
    // changed, so the review it describes still describes it.
    await remount();

    expect(approvals()).toHaveLength(1);
    expect(section(GROUP.REVIEW)).toBeNull();
    expect(section(GROUP.READY).textContent).toContain('Duke');
  });
});

/* -------------------------------------------------------------------------- */
/* The campaign moves under the page                                            */
/* -------------------------------------------------------------------------- */

describe('the page re-resolves rather than believing what it last saw', () => {
  it('stops treating a closed campaign as current', async () => {
    const c = campaign();
    programme(c);
    const head = coach({ email: 'h@duke.edu' });
    confirmedSend(head);
    await render();
    expect(section(GROUP.REVIEW)).toBeTruthy();

    /**
     * THE LIFECYCLE CASE F7 LEFT OPEN. The campaign closes while the page is
     * open; the plan on screen describes a campaign that is no longer running.
     * A reload must go back through the campaign list rather than re-reading a
     * plan for a campaign nothing would send from.
     */
    db.prepare("UPDATE campaigns SET state = 'closed', closed_at = ?, close_reason = 'completed' WHERE id = ?")
      .run('2026-09-16T00:00:00.000Z', c);
    await approveFirstTouch();

    expect(container.querySelector('[data-testid="campaign-empty"]')).toBeTruthy();
    expect(text()).toContain('No campaign is running');
    expect(text()).toMatch(/1 campaign has been closed/);
    expect(section(GROUP.REVIEW)).toBeNull();
  });

  it('picks up a different campaign that has since become the active one', async () => {
    const first = campaign({ id: 'camp-1' });
    programme(first, { id: 'pc-1', college: 'Duke' });
    const head = coach({ email: 'h@duke.edu' });
    confirmedSend(head);
    await render();
    expect(text()).toContain('Duke');

    // The first closes and a second is activated — the partial unique index
    // allows exactly one active campaign, so "current" moves rather than forks.
    db.prepare("UPDATE campaigns SET state = 'closed', closed_at = ?, close_reason = 'completed' WHERE id = ?")
      .run('2026-09-16T00:00:00.000Z', first);
    const second = campaign({ id: 'camp-2' });
    programme(second, { id: 'pc-2', college: 'Elon' });
    coach({ school: 'Elon', email: 'h@elon.edu', name: 'Sarah Jones' });

    await approveFirstTouch();

    // The programmes on screen are the new campaign's. Duke survives only in
    // the notice, which is reporting what was just recorded.
    expect(section(GROUP.READY).textContent).toContain('Elon');
    const programmes = Array.from(container.querySelectorAll('[data-testid="campaign-programme"]'))
      .map((el) => el.textContent).join(' ');
    expect(programmes).toContain('Elon');
    expect(programmes).not.toContain('Duke');
  });

  it('reloads when the campaign has moved on to another coach', async () => {
    const c = campaign();
    const pc = programme(c);
    const head = coach({ name: 'Aa Head', email: 'h@duke.edu' });
    confirmedSend(head);
    await render();
    expect(section(GROUP.REVIEW)).toBeTruthy();

    /**
     * The head coach's allowance is spent between the page loading and the
     * approval, so the campaign is now approaching somebody else and the
     * approval names a coach it is not holding.
     */
    db.prepare(`
      INSERT INTO coaches (id, created_at, full_name, email, school, division, sport,
        position_title, email_status)
      VALUES (?, ?, 'Bb Assistant', 'a@duke.edu', 'Duke', 'NCAA D1', 'mens-soccer',
        'Assistant Coach', 'verified')
    `).run(randomUUID(), NOW);
    for (const at of ['2026-09-02T11:00:00.000Z', '2026-09-03T11:00:00.000Z']) {
      db.prepare(`
        INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id,
          coach_id, college_name, sport, programme_campaign_id, origin, policy_version, state,
          created_at)
        VALUES (?, (SELECT id FROM outreach WHERE coach_id = ?), ?, ?, ?, ?, ?, 'Duke',
          'mens-soccer', ?, 'campaign', 'LEGACY_UNKNOWN', ?, ?)
      `).run(randomUUID(), head, ++seq, NOW, at, ATHLETE, head, pc, MESSAGE_STATE.ACCEPTED, NOW);
    }

    await approveFirstTouch();

    /**
     * THE CONTRACT, AS IT ACTUALLY IS. The head coach is still one of the
     * coaches this campaign may approach — within tier depth — so the server
     * does not call this COACH_NOT_IN_PURSUIT. It says there is no review to
     * approve, because the campaign is no longer making its first approach to
     * that person. Both answers refresh, and the operator reads a sentence
     * either way; the distinction matters only to whoever reads the code.
     */
    const notice = container.querySelector('[data-testid="campaign-notice"]');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toMatch(/no longer a first-touch review/i);
    expect(approvals()).toEqual([]);
    // And the fresh plan is what is on screen: the campaign has moved on.
    expect(text()).toContain('Bb Assistant');
  });

  it('does not rewrite an approval somebody else already recorded', async () => {
    const c = campaign();
    programme(c);
    const head = coach({ email: 'h@duke.edu' });
    confirmedSend(head);
    await render();

    // Approved through another route between the page loading and this click.
    // The colleague is a real operator row — the approval references one.
    operator('op-somebody-else');
    db.prepare(`
      INSERT INTO campaign_first_touch_approvals (id, programme_campaign_id, coach_id,
        approved_by_operator_id, approved_at, reviewed_confirmed_send_count,
        reviewed_last_confirmed_send_at)
      VALUES (?, 'pc-1', ?, 'op-somebody-else', ?, 1, '2026-08-20T11:00:00.000Z')
    `).run(randomUUID(), head, NOW);

    await approveFirstTouch();

    /**
     * NOT AN ERROR AND NOT A REWRITE. What this operator asked for is already
     * true, so F6d returns the standing decision unchanged — a second click
     * must not reattribute a colleague's review to whoever pressed the button.
     */
    expect(approvals()).toHaveLength(1);
    expect(approvals()[0]).toMatchObject({
      approved_by_operator_id: 'op-somebody-else', approved_at: NOW,
    });
    // Reported as what it is — a review is on file — without claiming this
    // operator's click is what put it there.
    expect(container.querySelector('[data-testid="campaign-notice"]').textContent)
      .toMatch(/Review recorded/);
    expect(section(GROUP.READY).textContent).toContain('Duke');
  });

  it('reloads when the review has gone because the history has', async () => {
    const c = campaign();
    programme(c);
    const head = coach({ email: 'h@duke.edu' });
    confirmedSend(head);
    await render();
    expect(section(GROUP.REVIEW)).toBeTruthy();

    // The history the review was about is removed between the page loading and
    // the click, so there is nothing left to approve.
    db.exec('DELETE FROM outreach_send; DELETE FROM outreach;');
    await approveFirstTouch();

    const notice = container.querySelector('[data-testid="campaign-notice"]');
    expect(notice.textContent).toMatch(/no longer a first-touch review/i);
    expect(approvals()).toEqual([]);
    expect(section(GROUP.READY).textContent).toContain('Duke');
  });
});

/* -------------------------------------------------------------------------- */
/* What it costs                                                                */
/* -------------------------------------------------------------------------- */

describe('the plan is expensive, so it is asked for deliberately', () => {
  it('reads the list once and the plan once on open', async () => {
    const c = campaign();
    programme(c);
    coach({ email: 'h@duke.edu' });
    await render();

    expect(listReads()).toBe(1);
    expect(planReads()).toBe(1);
  });

  it('asks for nothing at all when no campaign is running', async () => {
    campaign({ state: 'draft' });
    await render();

    // A plan for a campaign nothing would send from is a hundred programmes of
    // computation nobody asked for.
    expect(listReads()).toBe(1);
    expect(planReads()).toBe(0);
  });

  it('costs one resolution cycle for an approval, and no more', async () => {
    const c = campaign();
    programme(c);
    const head = coach({ email: 'h@duke.edu' });
    confirmedSend(head);
    await render();
    const before = { list: listReads(), plan: planReads() };

    await approveFirstTouch();

    expect(approvalPosts()).toHaveLength(1);
    expect(listReads()).toBe(before.list + 1);
    expect(planReads()).toBe(before.plan + 1);
  });

  it('does not read anything while searching', async () => {
    const c = campaign();
    programme(c);
    coach({ email: 'h@duke.edu' });
    await render();
    const before = calls.length;

    const input = container.querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        .set.call(input, 'duke');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(calls.length).toBe(before);
  });

  it('does not poll', async () => {
    const c = campaign();
    programme(c);
    coach({ email: 'h@duke.edu' });
    await render();
    const before = calls.length;

    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(calls.length).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* Read failure is not the same as write failure                                */
/* -------------------------------------------------------------------------- */

describe('a plan that could not be read is not shown at all', () => {
  it('shows nothing rather than part of a plan', async () => {
    const c = campaign();
    programme(c);
    coach({ email: 'h@duke.edu' });

    // The campaign list answers; the plan does not.
    const real = globalThis.fetch;
    calls = [];
    vi.stubGlobal('fetch', async (path, opts = {}) => {
      calls.push({ path: String(path), method: opts.method || 'GET', body: opts.body ?? null });
      if (String(path).includes('/execution-plan')) {
        return new Response('{"error":"boom"}', {
          status: 500, headers: { 'content-type': 'application/json' },
        });
      }
      return real(`${baseUrl}${path}`, opts);
    });

    await render();

    expect(text()).toContain('could not be loaded');
    expect(container.querySelectorAll('[data-testid="campaign-programme"]')).toHaveLength(0);
    expect(buttons().find((b) => b.textContent === 'Try again')).toBeTruthy();
    expect(c).toBeTruthy();
  });

  it('keeps a good plan on screen when only the write fails', async () => {
    const c = campaign();
    programme(c);
    const head = coach({ email: 'h@duke.edu' });
    confirmedSend(head);
    await render();

    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (path, opts = {}) => {
      calls.push({ path: String(path), method: opts.method || 'GET', body: opts.body ?? null });
      if (String(path).includes('first-touch-approval')) {
        return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return real(`${baseUrl}${path}`, opts);
    });

    await approveFirstTouch();

    // A failed write is not a failed read: the plan is still the one the server
    // sent, and is still true.
    expect(text()).not.toContain('could not be loaded');
    expect(container.querySelectorAll('[data-testid="campaign-programme"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="approval-error"]').textContent)
      .toContain('Approval could not be recorded');
    expect(approvals()).toEqual([]);
    expect(c).toBeTruthy();
  });
});
