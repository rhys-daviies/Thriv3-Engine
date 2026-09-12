// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import CampaignTab, { GROUP } from './CampaignTab.jsx';
import db from '../../../server/db/client.js';
import { campaignsRouter } from '../../../server/routes/campaigns.js';
import { recordDraft, acceptSend, openSendFor } from '../../../server/lib/outreachSend.js';
import { createOutreach } from '../../../server/lib/outreach.js';
import { suppress } from '../../../server/lib/suppressions.js';
import { ACCEPTED_SOURCE } from '../../../shared/outreachMessageState.js';

/**
 * F9c — THE WHOLE OF F9, AS ONE SYSTEM.
 *
 * The real React tab, the real API client, the real Express router, the real
 * pursuit policy, the real materialiser and the real database. Only jsdom
 * stands in for a browser, and nothing about the final state is faked at
 * component level.
 *
 * ---------------------------------------------------------------------------
 * THE BOUNDARY THIS SUITE EXISTS TO DEFEND.
 *
 *   PREPARED ≠ DRAFTED   no body exists
 *   PREPARED ≠ QUEUED    nothing is waiting to go
 *   PREPARED ≠ SCHEDULED no time was chosen
 *   PREPARED ≠ SENT      no message happened
 *
 * A prepared attempt is one row recording that a campaign INTENDS to write to
 * the coach the server named. Section 2 proves that against every table in the
 * outreach model rather than against a sentence.
 * ---------------------------------------------------------------------------
 *
 * AND THE SECOND CLAIM: hiding the button is not the safety boundary. Section 6
 * asserts the READ and the WRITE separately for every refusal, and section 7
 * mutates the world underneath an open page and presses the stale control.
 */

const ATHLETE = 'a-f9c';
const OPERATOR = 'op-f9c';
const NOW = '2026-09-01T00:00:00.000Z';

let baseUrl;
let container;
let root;
let calls;
let seq = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
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

/* -------------------------------------------------------------------------- */
/* The world                                                                    */
/* -------------------------------------------------------------------------- */

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, ?, ?, 'F9c Athlete', 'MIDFIELD', 'mens-soccer')
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

function programme(campaignId, { id = 'pc-1', college = 'Duke', tier = 'A', state = 'queued' } = {}) {
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, tier_set_at, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, ?, 'AUTO', ?, ?, ?, ?)
  `).run(id, campaignId, college, ++seq, tier, NOW, state, NOW, NOW);
  return id;
}

function stance(value, { college = 'Duke' } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
      visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?, ?, ?)
  `).run(randomUUID(), ATHLETE, college, value, NOW, NOW);
}

/**
 * A REAL ACCEPTED MESSAGE, through the real write path and the authoritative
 * acceptance seam. Never a raw INSERT: F9b-1's invariant lives inside
 * `transitionSend`, and a fixture that wrote the row directly would not exercise
 * it.
 */
function sendUnder(coachId, { programmeCampaignId = null, at = '2026-08-20T11:00:00.000Z' } = {}) {
  const o = createOutreach({ athleteId: ATHLETE, coachId, programmeCampaignId });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: 'Duke', sport: 'mens-soccer',
    programmeCampaignId, evidence: null, body: `b${++seq}`, subject: 's',
  });
  acceptSend(openSendFor(o.id).id, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED, at });
  return o.id;
}

const attempts = () => db.prepare('SELECT * FROM programme_contact_attempts ORDER BY created_at, id').all();
const rows = (table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

/**
 * EVERY TABLE PREPARATION COULD PLAUSIBLY TOUCH, snapshotted whole rather than
 * counted — a count would miss an UPDATE that changed a value without changing
 * the number of rows.
 */
const WATCHED = Object.freeze([
  'outreach', 'outreach_send', 'outbound_send_attempt', 'campaigns', 'programme_campaigns',
  'athlete_programmes', 'suppressions', 'campaign_first_touch_approvals', 'coaches', 'players',
  'outreach_send_event', 'engagement_rollup', 'tracking_events',
]);

function snapshot() {
  const out = {};
  for (const t of WATCHED) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  out.programme_contact_attempts = attempts();
  return JSON.parse(JSON.stringify(out));
}

/* -------------------------------------------------------------------------- */
/* The browser side                                                             */
/* -------------------------------------------------------------------------- */

function wireFetch() {
  calls = [];
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (path, opts = {}) => {
    calls.push({ path: String(path), method: opts.method || 'GET', body: opts.body ?? null });
    return real(`${baseUrl}${path}`, opts);
  });
}

function Shell() {
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer', full_name: 'F9c Athlete' });
  return createElement(Outlet, { context: { player } });
}

async function settle(max = 40) {
  for (let i = 0; i < max; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    if (!container.querySelector('[data-testid="campaign-loading"]')) return;
  }
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
const el = (testid) => container.querySelector(`[data-testid="${testid}"]`);
const card = (pc) => container.querySelector(`[data-programme="${pc}"]`);
const preparePosts = () => calls.filter((c) => c.path.includes('/contact-attempts'));
const planReads = () => calls.filter((c) => c.path.includes('/execution-plan')).length;
const listReads = () => calls.filter((c) => /\/players\/[^/]+\/campaigns$/.test(c.path)).length;

const click = async (target) => {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

const prepareButton = () => buttons().find((b) => b.textContent === 'Prepare next attempt');
const confirmPrepare = () => buttons().find((b) => b.textContent === 'Confirm preparation');

/** Press Prepare, then Confirm, and let the POST and the reload settle. */
async function prepare({ mutate = null } = {}) {
  await click(prepareButton());
  // The TOCTOU hook: the world changes while the confirmation is on screen.
  if (mutate) mutate();
  await click(confirmPrepare());
  for (let i = 0; i < 3; i += 1) await settle();
}

/** The F8 approval control, unchanged and not bypassed. */
async function approve() {
  await click(buttons().find((b) => /Approve first touch|Review again/.test(b.textContent)));
  await click(buttons().find((b) => b.textContent.includes('Confirm approval')));
  for (let i = 0; i < 3; i += 1) await settle();
}

/** The plan the server would send right now, read outside the component. */
async function serverPlan(campaignId = 'camp-1') {
  const res = await fetch(`/api/campaigns/${campaignId}/execution-plan`);
  return res.json();
}

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM campaign_first_touch_approvals; DELETE FROM programme_contact_attempts;
           DELETE FROM outbound_send_attempt; DELETE FROM outreach_evidence;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send; DELETE FROM outreach;
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

/** An active campaign, one queued programme, one reachable head coach. */
function ready() {
  const c = campaign();
  const pc = programme(c);
  const head = coach({ email: 'head@duke.edu' });
  return { c, pc, head };
}

/* ========================================================================== */
/* 1 — the happy path, end to end                                              */
/* ========================================================================== */

describe('1. campaign plan to prepared card, through the real system', () => {
  it('records one intent for the coach and step the server chose', async () => {
    const { pc, head } = ready();

    await render();

    // ---- the plan says it is preparable, and the control is there ----
    const before = await serverPlan();
    expect(before.programmes[0].preparableNow).toBe(true);
    expect(before.programmes[0].currentAttempt.id).toBeNull();
    expect(prepareButton()).toBeTruthy();
    expect(el('attempt-prepared')).toBeNull();

    // ---- inline confirmation, before anything is posted ----
    await click(prepareButton());
    expect(text()).toMatch(/Prepare this attempt for John Smith at Duke\?/);
    expect(text()).toMatch(/Nothing will be sent/);
    expect(preparePosts()).toHaveLength(0);

    await click(confirmPrepare());
    for (let i = 0; i < 3; i += 1) await settle();

    // ---- exactly one durable row, with the SERVER's coach and step ----
    const written = attempts();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      programme_campaign_id: pc,
      coach_id: head,
      state: 'planned',
      step: 1,
      outreach_id: null,
      next_action_at: null,
      state_reason: null,
    });
    // The client sent a programme campaign id and nothing else.
    expect(preparePosts()).toHaveLength(1);
    expect(preparePosts()[0].body).toBeNull();

    // ---- the fresh plan, not the client, decides what the card says ----
    const after = await serverPlan();
    expect(after.programmes[0].currentAttempt).toMatchObject({
      id: written[0].id, state: 'planned', storedStep: 1, createdAt: written[0].created_at,
    });
    expect(after.programmes[0].preparableNow).toBe(false);

    expect(prepareButton()).toBeFalsy();
    expect(el('attempt-prepared')).toBeTruthy();
    expect(text()).toMatch(/Attempt prepared/);
  });
});

/* ========================================================================== */
/* 2 — write footprint                                                         */
/* ========================================================================== */

describe('2. preparation writes one row and touches nothing else', () => {
  it('leaves every other watched table byte-identical', async () => {
    ready();
    await render();

    const before = snapshot();
    await prepare();
    const after = snapshot();

    // Exactly one insert, into the one table F9 intends to write.
    expect(before.programme_contact_attempts).toHaveLength(0);
    expect(after.programme_contact_attempts).toHaveLength(1);

    for (const table of WATCHED) {
      expect(after[table], `${table} changed during preparation`).toEqual(before[table]);
    }
  });

  /**
   * The stance is set BEFORE the snapshot, so the only thing that could move
   * between the two is the refusal itself. Setting it mid-confirmation — which
   * section 7 does — would write to `athlete_programmes` and the comparison
   * would be measuring the test's own fixture.
   */
  it('a refusal writes nothing at all', async () => {
    ready();
    stance('do_not_contact');
    await render();

    const before = snapshot();
    const res = await fetch('/api/programme-campaigns/pc-1/contact-attempts', { method: 'POST' });
    expect(res.status).toBe(422);
    const after = snapshot();

    expect(after).toEqual(before);
    expect(attempts()).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 3 — semantic purity                                                         */
/* ========================================================================== */

describe('3. prepared is not drafted, queued, scheduled or sent', () => {
  it('nothing about a message exists afterwards', async () => {
    ready();
    await render();
    await prepare();

    // No message happened, and none is waiting to.
    expect(rows('outreach_send')).toBe(0);
    // No relationship, so no permanent tracking token was minted.
    expect(rows('outreach')).toBe(0);
    // No sending capacity was consumed or reserved.
    expect(rows('outbound_send_attempt')).toBe(0);

    const row = attempts()[0];
    // No content, no recipient frozen, no sender frozen, no time chosen.
    expect(Object.keys(row).sort()).toEqual([
      'coach_id', 'created_at', 'id', 'next_action_at', 'outreach_id',
      'programme_campaign_id', 'state', 'state_changed_at', 'state_reason', 'step', 'updated_at',
    ]);
    expect(row.next_action_at).toBeNull();
    expect(row.outreach_id).toBeNull();
    expect(row.state).toBe('planned');

    // The campaign-local sequence did not move: preparing is not a message.
    const plan = await serverPlan();
    expect(plan.programmes[0].derivedStep).toBe(1);
    expect(plan.programmes[0].nextAction).toBe('INITIAL_OUTREACH');
    expect(plan.programmes[0].stepConsistent).toBe(true);
  });

  it('says nothing on screen that implies a message happened', async () => {
    ready();
    await render();
    await prepare();

    const page = text();
    for (const forbidden of [
      /ready to send/i, /\bqueued\b/i, /\bscheduled\b/i, /\bdrafted\b/i,
      /email prepared/i, /message prepared/i, /\bdelivered\b/i, /\bopened\b/i,
    ]) {
      expect(page, String(forbidden)).not.toMatch(forbidden);
    }
    expect(page).toMatch(/Nothing has been sent/);
  });
});

/* ========================================================================== */
/* 4 — the step invariant, through the real seam                               */
/* ========================================================================== */

describe('4. an operator cannot manufacture step drift', () => {
  it('prepare, confirm a campaign send, and the follow-up is not blocked', async () => {
    const { pc, head } = ready();
    await render();
    await prepare();
    expect(attempts()[0].step).toBe(1);

    // A campaign-attributed message is confirmed through the authoritative
    // seam — the same transition B6 counts.
    sendUnder(head, { programmeCampaignId: pc, at: '2026-09-10T09:00:00.000Z' });

    // The stored step moved WITH the derived one, at the acceptance.
    expect(attempts()[0].step).toBe(2);

    const plan = await serverPlan();
    const entry = plan.programmes[0];
    expect(entry.derivedStep).toBe(2);
    expect(entry.currentAttempt.storedStep).toBe(2);
    expect(entry.stepConsistent).toBe(true);
    expect(entry.nextAction).toBe('FOLLOW_UP');
    expect(entry.blockers.some((b) => b.code === 'CONTACT_ATTEMPT_STEP_DRIFT')).toBe(false);
  });

  it('preparing a follow-up from scratch starts at the derived step', async () => {
    const { pc, head } = ready();
    // A campaign message was confirmed before anything was ever prepared —
    // which is every message this build has sent.
    sendUnder(head, { programmeCampaignId: pc, at: '2026-09-01T09:00:00.000Z' });
    expect(attempts()).toHaveLength(0);

    await render();
    expect(prepareButton()).toBeTruthy();
    await prepare();

    expect(attempts()[0].step).toBe(2);
    const entry = (await serverPlan()).programmes[0];
    expect(entry.stepConsistent).toBe(true);
    expect(entry.blockers.some((b) => b.code === 'CONTACT_ATTEMPT_STEP_DRIFT')).toBe(false);
  });

  it('no sequence of the operator actions F9 offers produces drift', async () => {
    const { pc, head } = ready();
    await render();

    // Prepare, send, re-render, prepare again (refused as already prepared),
    // send again — the full run of what the screen can do.
    await prepare();
    sendUnder(head, { programmeCampaignId: pc, at: '2026-09-05T09:00:00.000Z' });
    await act(async () => { await fetch(`/api/programme-campaigns/${pc}/contact-attempts`, { method: 'POST' }); });
    sendUnder(head, { programmeCampaignId: pc, at: '2026-09-12T09:00:00.000Z' });

    expect(attempts()).toHaveLength(1);
    expect(attempts()[0].step).toBe(3);
    const entry = (await serverPlan()).programmes[0];
    // Two messages spend the coach's allowance; the programme is finished
    // rather than drifted.
    expect(entry.stepConsistent).toBe(true);
    expect(entry.blockers.some((b) => b.code === 'CONTACT_ATTEMPT_STEP_DRIFT')).toBe(false);
  });
});

/* ========================================================================== */
/* 5 — first-touch review                                                      */
/* ========================================================================== */

describe('5. a first touch is reviewed before it can be prepared', () => {
  it('holds, clears on the real approval, then prepares', async () => {
    const { pc, head } = ready();
    sendUnder(head, { at: '2026-08-20T11:00:00.000Z' });

    await render();

    // ---- held ----
    expect(section(GROUP.REVIEW)).toBeTruthy();
    expect((await serverPlan()).programmes[0].preparableNow).toBe(false);
    expect(prepareButton()).toBeFalsy();

    // ---- cleared, through the F8 control and the real route ----
    await approve();
    expect(db.prepare('SELECT COUNT(*) n FROM campaign_first_touch_approvals').get().n).toBe(1);
    expect((await serverPlan()).programmes[0].preparableNow).toBe(true);
    expect(prepareButton()).toBeTruthy();

    // ---- prepared ----
    await prepare();
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0]).toMatchObject({ programme_campaign_id: pc, coach_id: head, step: 1 });
  });

  it('a stale approval refuses again, and writes no second attempt', async () => {
    const { head } = ready();
    sendUnder(head, { at: '2026-08-20T11:00:00.000Z' });
    await render();
    await approve();
    expect((await serverPlan()).programmes[0].preparableNow).toBe(true);

    // Something further was sent by hand since the review was given.
    sendUnder(head, { at: '2026-09-15T11:00:00.000Z' });

    const plan = await serverPlan();
    expect(plan.programmes[0].firstTouchReview.approval.status).toBe('stale');
    expect(plan.programmes[0].preparableNow).toBe(false);

    // And the write refuses too, not merely the read.
    const res = await fetch('/api/programme-campaigns/pc-1/contact-attempts', { method: 'POST' });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED');
    expect(attempts()).toHaveLength(0);
  });
});

/* ========================================================================== */
/* 6 — the safety matrix: READ and WRITE                                       */
/* ========================================================================== */

describe('6. hiding the button is not the safety boundary', () => {
  const MATRIX = [
    ['manual_only', 'RELATIONSHIP_MANUAL_ONLY', () => stance('manual_only')],
    ['do_not_contact', 'RELATIONSHIP_DO_NOT_CONTACT', () => stance('do_not_contact')],
    ['global suppression', 'NO_ELIGIBLE_COACH', () => suppress({ email: 'head@duke.edu' })],
    ['revoked outreach', 'OUTREACH_REVOKED', ({ head }) => {
      const o = createOutreach({ athleteId: ATHLETE, coachId: head });
      db.prepare('UPDATE outreach SET revoked_at = ? WHERE id = ?').run(NOW, o.id);
    }],
    ['stopped programme', 'PROGRAMME_STOPPED', () => {
      db.prepare("UPDATE programme_campaigns SET state = 'stopped' WHERE id = 'pc-1'").run();
    }],
    ['completed programme', 'PROGRAMME_COMPLETED', () => {
      db.prepare("UPDATE programme_campaigns SET state = 'completed' WHERE id = 'pc-1'").run();
    }],
    ['closed campaign', 'CAMPAIGN_NOT_ACTIVE', () => {
      db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = ?, close_reason = 'completed'
        WHERE id = 'camp-1'`).run(NOW);
    }],
  ];

  for (const [name, code, apply] of MATRIX) {
    it(`${name}: the plan refuses to offer it AND the endpoint refuses to do it`, async () => {
      const scene = ready();
      apply(scene);

      // ---- READ ----
      const plan = await serverPlan();
      // A closed campaign is no longer the current one, so the tab shows the
      // no-campaign state; the plan is still addressable and still refuses.
      expect(plan.programmes[0].preparableNow).toBe(false);

      await render();
      expect(prepareButton()).toBeFalsy();

      // ---- WRITE ----
      const res = await fetch('/api/programme-campaigns/pc-1/contact-attempts', { method: 'POST' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await res.json()).code).toBe(code);
      expect(attempts()).toHaveLength(0);
    });
  }
});

/* ========================================================================== */
/* 7 — TOCTOU: the stale browser is never the authority                        */
/* ========================================================================== */

describe('7. the world changes while the confirmation is on screen', () => {
  const CASES = [
    ['do_not_contact', /set to do-not-contact/i, GROUP.BLOCKED, () => stance('do_not_contact')],
    ['manual_only', /worked by hand/i, GROUP.BLOCKED, () => stance('manual_only')],
    ['global suppression', /nobody at this programme/i, null,
      () => suppress({ email: 'head@duke.edu' })],
    ['stopped programme', /stopped for this campaign/i, GROUP.BLOCKED, () => {
      db.prepare("UPDATE programme_campaigns SET state = 'stopped' WHERE id = 'pc-1'").run();
    }],
    ['closed campaign', /campaign is not active/i, null, () => {
      db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = ?, close_reason = 'completed'
        WHERE id = 'camp-1'`).run(NOW);
    }],
    ['first touch becomes required', /needs reviewing/i, GROUP.REVIEW, ({ head }) => {
      sendUnder(head, { at: '2026-08-25T11:00:00.000Z' });
    }],
  ];

  for (const [name, expected, group, mutate] of CASES) {
    it(`${name}: refused, no row, and the fresh plan takes over`, async () => {
      const scene = ready();
      await render();
      expect(prepareButton()).toBeTruthy();

      await prepare({ mutate: () => mutate(scene) });

      // The server refused. Nothing was written.
      expect(attempts()).toHaveLength(0);
      // The operator is told, in words, without a raw code.
      expect(el('campaign-notice')).toBeTruthy();
      expect(el('campaign-notice').textContent).toMatch(expected);
      expect(text()).not.toMatch(/_[A-Z]{2,}/);
      // And the page reloaded, so what is on screen is the server's again.
      if (group) expect(section(group)).toBeTruthy();
      expect(prepareButton()).toBeFalsy();
    });
  }

  it('a stale approval going stale mid-confirmation is refused too', async () => {
    const { head } = ready();
    sendUnder(head, { at: '2026-08-20T11:00:00.000Z' });
    await render();
    await approve();
    expect(prepareButton()).toBeTruthy();

    await prepare({ mutate: () => sendUnder(head, { at: '2026-09-16T11:00:00.000Z' }) });

    expect(attempts()).toHaveLength(0);
    expect(el('campaign-notice').textContent).toMatch(/needs reviewing/i);
    expect(section(GROUP.REVIEW)).toBeTruthy();
  });
});

/* ========================================================================== */
/* 8 — idempotent retry                                                        */
/* ========================================================================== */

describe('8. a lost response is safe to retry', () => {
  it('replaying the POST returns the same row, unrestamped', async () => {
    ready();
    await render();
    await prepare();

    const first = attempts()[0];
    expect(first).toBeTruthy();

    // The client behaves as though it never saw the answer.
    const replay = await fetch('/api/programme-campaigns/pc-1/contact-attempts', { method: 'POST' });
    const body = await replay.json();

    expect(replay.status).toBe(200);
    expect(body.created).toBe(false);
    expect(body.attempt.id).toBe(first.id);
    expect(body.attempt.createdAt).toBe(first.created_at);

    const after = attempts();
    expect(after).toHaveLength(1);
    // Not one field moved — a replay must not restamp a real decision.
    expect(after[0]).toEqual(first);
    expect(rows('outreach')).toBe(0);
    expect(rows('outreach_send')).toBe(0);
    expect(rows('outbound_send_attempt')).toBe(0);
  });

  it('the reloaded page still reads as prepared', async () => {
    ready();
    await render();
    await prepare();
    await act(async () => {
      await fetch('/api/programme-campaigns/pc-1/contact-attempts', { method: 'POST' });
    });

    // Close the page and open it again, which is what a reload really is.
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await render();

    expect(el('attempt-prepared')).toBeTruthy();
    expect(prepareButton()).toBeFalsy();
    expect(attempts()).toHaveLength(1);
  });
});

/* ========================================================================== */
/* 13 — campaign lifecycle                                                     */
/* ========================================================================== */

describe('13. the current campaign is still the active one', () => {
  it('a campaign closing under an open page leaves no stale Prepare control', async () => {
    ready();
    await render();
    expect(prepareButton()).toBeTruthy();

    await prepare({
      mutate: () => db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = ?,
        close_reason = 'completed' WHERE id = 'camp-1'`).run(NOW),
    });

    expect(attempts()).toHaveLength(0);
    expect(el('campaign-empty')).toBeTruthy();
    expect(text()).toMatch(/No campaign is running/);
    expect(prepareButton()).toBeFalsy();

    /**
     * AND THE OPERATOR IS STILL TOLD WHAT HAPPENED TO THEIR CLICK — F9c.
     *
     * The notice used to be rendered only alongside a plan, so this reload
     * dropped it and left somebody who had just pressed Confirm looking at an
     * empty page with no account of whether anything was recorded.
     */
    expect(el('campaign-notice')).toBeTruthy();
    expect(el('campaign-notice').textContent).toMatch(/campaign is not active/i);
    expect(document.activeElement).toBe(el('campaign-notice'));
  });

  it('another active campaign becomes current, with its own preparability', async () => {
    ready();
    db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = ?, close_reason = 'completed'
      WHERE id = 'camp-1'`).run(NOW);
    const second = campaign({ id: 'camp-2' });
    programme(second, { id: 'pc-2', college: 'Duke' });

    await render();

    expect(el('campaign-empty')).toBeNull();
    expect(card('pc-2')).toBeTruthy();
    expect(card('pc-1')).toBeNull();
    expect(prepareButton()).toBeTruthy();

    await prepare();
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0].programme_campaign_id).toBe('pc-2');
  });

  it('a draft campaign is never made current, however preparable it is', async () => {
    const draft = campaign({ id: 'camp-draft', state: 'draft' });
    programme(draft, { id: 'pc-draft' });
    coach({ email: 'head@duke.edu' });

    // The server would prepare it — that is F6b, and it is deliberate.
    const res = await fetch('/api/campaigns/camp-draft/execution-plan');
    expect((await res.json()).programmes[0].preparableNow).toBe(true);

    await render();

    // The screen still does not select it.
    expect(el('campaign-empty')).toBeTruthy();
    expect(text()).toMatch(/1 draft campaign is waiting/);
    expect(prepareButton()).toBeFalsy();
  });
});

/* ========================================================================== */
/* 14 — currentAttempt edge cases                                              */
/* ========================================================================== */

describe('14. currentAttempt is about the current coach, and nobody else', () => {
  it('a stopped attempt for a previous coach is not the new coach’s', async () => {
    const c = campaign();
    const pc = programme(c);
    const head = coach({ email: 'head@duke.edu' });
    const assistant = coach({ email: 'asst@duke.edu', name: 'Ann Lee', title: 'Assistant Coach' });

    await render();
    await prepare();
    const first = attempts()[0];
    expect(first.coach_id).toBe(head);

    // The pursuit of the head coach is stopped, so policy moves to the
    // assistant. The stopped row stays on file.
    db.prepare(`UPDATE programme_contact_attempts SET state = 'stopped', state_reason = 'operator',
      state_changed_at = ? WHERE id = ?`).run(NOW, first.id);

    const plan = await serverPlan();
    const entry = plan.programmes[0];
    expect(entry.currentCoach.id).toBe(assistant);
    // NOT the stopped attempt, and not claimed for the new coach.
    expect(entry.currentAttempt.id).toBeNull();
    expect(entry.preparableNow).toBe(true);

    // Close and reopen, so nothing is carried in component state.
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await render();

    expect(el('attempt-prepared')).toBeNull();
    expect(text()).toMatch(/Ann Lee/);
    expect(prepareButton()).toBeTruthy();

    await prepare();
    // Two rows, two coaches, one campaign — and the new one is its own.
    const all = attempts();
    expect(all).toHaveLength(2);
    expect(all.find((a) => a.coach_id === assistant).step).toBe(1);
    expect(all.find((a) => a.coach_id === head).state).toBe('stopped');
  });

  it('renders no attempt history — only the current coach’s', async () => {
    const c = campaign();
    const pc = programme(c);
    const head = coach({ email: 'head@duke.edu' });
    coach({ email: 'asst@duke.edu', name: 'Ann Lee', title: 'Assistant Coach' });

    await render();
    await prepare();
    db.prepare(`UPDATE programme_contact_attempts SET state = 'stopped', state_reason = 'operator',
      state_changed_at = ?`).run(NOW);

    const entry = (await serverPlan()).programmes[0];
    // The plan entry carries one attempt slot and no list.
    expect(Object.keys(entry.currentAttempt).sort())
      .toEqual(['createdAt', 'id', 'state', 'storedStep']);
    expect(entry.attempts).toBeUndefined();
  });
});

/* ========================================================================== */
/* 15 — request counts                                                         */
/* ========================================================================== */

describe('15. the page asks for what it needs and nothing more', () => {
  it('opens with one campaign list and one plan, and does not poll', async () => {
    ready();
    await render();

    expect(listReads()).toBe(1);
    expect(planReads()).toBe(1);

    const at = calls.length;
    // Sit idle for a while.
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
    expect(calls.length).toBe(at);
  });

  it('spends one POST and one reload on a successful preparation', async () => {
    ready();
    await render();
    const before = { list: listReads(), plan: planReads() };

    await prepare();

    expect(preparePosts()).toHaveLength(1);
    expect(listReads()).toBe(before.list + 1);
    expect(planReads()).toBe(before.plan + 1);
  });

  it('spends the same on a refusal', async () => {
    ready();
    await render();
    const before = { list: listReads(), plan: planReads() };

    await prepare({ mutate: () => stance('do_not_contact') });

    expect(preparePosts()).toHaveLength(1);
    expect(listReads()).toBe(before.list + 1);
    expect(planReads()).toBe(before.plan + 1);
  });

  it('filters with no network at all', async () => {
    const c = campaign();
    programme(c, { id: 'pc-1', college: 'Duke' });
    coach({ email: 'head@duke.edu' });
    await render();

    const at = calls.length;
    const input = container.querySelector('input');
    await act(async () => {
      input.value = 'duke';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.value = 'nothing';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(calls.length).toBe(at);
  });
});
