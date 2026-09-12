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
import { MESSAGE_STATE } from '../../../shared/outreachMessageState.js';

/**
 * F9b-3 — PREPARING AN ATTEMPT, WITH NOTHING PRETENDED.
 *
 * The real React component, the real API client, the real Express router, the
 * real preparation decision and the real database. Only jsdom stands in for a
 * browser.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR.
 *
 * The component suite proves the card renders what a stubbed server says. This
 * proves the server says it — that pressing the button writes ONE row of the
 * right shape, that the card changes because the recomputed plan changed, and
 * that nothing else in the database moved.
 *
 * The assertions worth having are the ones that span the boundary: the row
 * holds a coach and a step the client never sent, and a refusal the client
 * could not have predicted comes back as an operator sentence.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-prep-e2e';
const OPERATOR = 'op-prep-e2e';
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

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, ?, ?, 'Prep Athlete', 'MIDFIELD', 'mens-soccer')
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

function stance(value, { college = 'Duke' } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
      visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?, ?, ?)
  `).run(randomUUID(), ATHLETE, college, value, NOW, NOW);
}

/** An accepted send on file, which is what makes a first touch reviewable. */
function confirmedSend(coachId, at = '2026-08-20T11:00:00.000Z') {
  const outreachId = randomUUID();
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, sent_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(outreachId, ATHLETE, coachId, randomUUID(), NOW, at);
  db.prepare(`
    INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id,
      college_name, sport, origin, policy_version, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Duke', 'mens-soccer', 'manual', 'LEGACY_UNKNOWN', ?, ?)
  `).run(randomUUID(), outreachId, ++seq, NOW, at, ATHLETE, coachId,
    MESSAGE_STATE.ACCEPTED, NOW);
  return outreachId;
}

const attempts = () => db.prepare('SELECT * FROM programme_contact_attempts').all();
const rows = (table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

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
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer', full_name: 'Prep Athlete' });
  return createElement(Outlet, { context: { player } });
}

/** Real sockets, not microtasks — drain turns until the skeleton is gone. */
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
const preparePosts = () => calls.filter((c) => c.path.includes('/contact-attempts'));

const click = async (target) => {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

const prepareButton = () => buttons().find((b) => b.textContent === 'Prepare next attempt');

/** Press Prepare, then Confirm, and let the POST and the reload settle. */
async function prepare() {
  await click(prepareButton());
  await click(buttons().find((b) => b.textContent === 'Confirm preparation'));
  // The POST, then the campaign list, then the plan — three round trips.
  for (let i = 0; i < 3; i += 1) await settle();
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

/* -------------------------------------------------------------------------- */

describe('an attempt prepared in the browser is a row in the database', () => {
  function ready() {
    const c = campaign();
    const pc = programme(c);
    const head = coach({ email: 'h@duke.edu' });
    return { c, pc, head };
  }

  it('writes one attempt, for the coach and step the SERVER chose', async () => {
    const { pc, head } = ready();
    await render();
    expect(attempts()).toHaveLength(0);

    await prepare();

    const written = attempts();
    expect(written).toHaveLength(1);
    /*
      The client sent a programme campaign id and nothing else. The coach, the
      step and the state are the server's — which is the property the whole
      request shape exists to guarantee.
    */
    expect(written[0]).toMatchObject({
      programme_campaign_id: pc, coach_id: head, step: 1, state: 'planned', outreach_id: null,
    });
    expect(preparePosts()).toHaveLength(1);
    expect(preparePosts()[0].body).toBeNull();
  });

  it('the card shows prepared because the RECOMPUTED plan says so', async () => {
    ready();
    await render();
    expect(prepareButton()).toBeTruthy();
    expect(el('attempt-prepared')).toBeNull();

    await prepare();

    expect(el('attempt-prepared')).toBeTruthy();
    expect(text()).toMatch(/Attempt prepared/);
    expect(prepareButton()).toBeFalsy();
    // And the notice says what was recorded without claiming a message.
    expect(text()).toMatch(/Nothing has been sent/);
  });

  it('writes nothing else — no message, no relationship, no capacity', async () => {
    const { c, pc } = ready();
    const campaignBefore = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(c);
    const programmeBefore = db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc);

    await render();
    await prepare();

    expect(rows('outreach')).toBe(0);
    expect(rows('outreach_send')).toBe(0);
    expect(rows('outbound_send_attempt')).toBe(0);
    expect(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(c)).toEqual(campaignBefore);
    expect(db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc))
      .toEqual(programmeBefore);
  });

  it('pressing it twice across a reload leaves one row', async () => {
    ready();
    await render();
    await prepare();
    expect(attempts()).toHaveLength(1);
    const first = attempts()[0];

    // The button is gone, so drive the second call the way a retry would.
    await act(async () => {
      await fetch(`/api/programme-campaigns/pc-1/contact-attempts`, { method: 'POST' });
    });

    expect(attempts()).toHaveLength(1);
    expect(attempts()[0]).toEqual(first);
  });

  it('keeps the programme in Ready — there is no Prepared group', async () => {
    ready();
    await render();
    expect(section(GROUP.READY)).toBeTruthy();

    await prepare();

    expect(section(GROUP.READY)).toBeTruthy();
    expect(section(GROUP.READY).textContent).toMatch(/Attempt prepared/);
    expect(container.querySelector('[aria-labelledby="campaign-prepared"]')).toBeNull();
  });
});

describe('a refusal the client could not have predicted', () => {
  it('shows the operator a sentence and no row is written', async () => {
    const c = campaign();
    programme(c);
    coach({ email: 'h@duke.edu' });
    await render();
    expect(prepareButton()).toBeTruthy();

    // The world changes underneath the open page.
    stance('manual_only');

    await prepare();

    expect(attempts()).toHaveLength(0);
    expect(el('campaign-notice')).toBeTruthy();
    expect(el('campaign-notice').textContent).toMatch(/worked by hand/i);
    expect(text()).not.toMatch(/RELATIONSHIP_MANUAL_ONLY/);
    // Reloaded, and the server has regrouped it.
    expect(section(GROUP.BLOCKED)).toBeTruthy();
  });

  it('sends a first touch back for review rather than preparing it', async () => {
    const c = campaign();
    programme(c);
    const head = coach({ email: 'h@duke.edu' });
    await render();
    expect(prepareButton()).toBeTruthy();

    // A confirmed send appears for this coach while the page is open.
    confirmedSend(head);

    await prepare();

    expect(attempts()).toHaveLength(0);
    expect(el('campaign-notice').textContent).toMatch(/needs reviewing/i);
    expect(section(GROUP.REVIEW)).toBeTruthy();
  });
});

describe('preparation follows the server, not the section', () => {
  /**
   * THE CRITICAL CROSS-BOUNDARY CASE. A follow-up whose four policy days have
   * not passed cannot be sent today and can be prepared today. The server says
   * `executableNow: false` and `preparableNow: true` for the same programme, and
   * the card is in Waiting with the control on it.
   */
  it('offers it on a Waiting card whose follow-up is not due yet', async () => {
    const c = campaign();
    const pc = programme(c);
    const head = coach({ email: 'h@duke.edu' });
    // One accepted campaign message, today — the follow-up is four days out.
    const outreachId = randomUUID();
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, sent_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(outreachId, ATHLETE, head, randomUUID(), NOW, at);
    db.prepare(`
      INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id,
        coach_id, college_name, sport, programme_campaign_id, origin, policy_version, state,
        created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, 'Duke', 'mens-soccer', ?, 'campaign', 'LEGACY_UNKNOWN', ?, ?)
    `).run(randomUUID(), outreachId, NOW, at, ATHLETE, head, pc, MESSAGE_STATE.ACCEPTED, NOW);

    await render();

    expect(section(GROUP.WAITING)).toBeTruthy();
    expect(section(GROUP.WAITING).textContent).toMatch(/Follow-up due/);
    const button = prepareButton();
    expect(button).toBeTruthy();
    expect(section(GROUP.WAITING).contains(button)).toBe(true);

    await prepare();

    // Prepared at the step the SERVER derived — 2, not 1. F9b-1's invariant
    // reaching the screen.
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0].step).toBe(2);
    expect(section(GROUP.WAITING).textContent).toMatch(/Attempt prepared/);
  });

  it('does not offer it on a programme the campaign may not write to', async () => {
    const c = campaign();
    programme(c);
    coach({ email: 'h@duke.edu' });
    stance('do_not_contact');

    await render();

    expect(section(GROUP.BLOCKED)).toBeTruthy();
    expect(prepareButton()).toBeFalsy();
  });
});
