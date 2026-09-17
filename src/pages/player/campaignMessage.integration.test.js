// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import CampaignTab from './CampaignTab.jsx';
import db from '../../../server/db/client.js';
import { campaignsRouter } from '../../../server/routes/campaigns.js';
import { evidenceSentences, MESSAGE_COPY } from '@/lib/campaignLabels';

/**
 * F10b-5 — THE WHOLE CHAIN, WITH NOTHING PRETENDED.
 *
 * The real React components, the real API client, the real Express router, the
 * real generation gate, the real composer, the real persistence and the real
 * database. Only jsdom stands in for a browser.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR.
 *
 * The component suite proves the screen renders what a stubbed server says.
 * This proves the server says it — that pressing Generate writes ONE row whose
 * subject, body, recipient, step and evidence the client never sent; that
 * editing changes the operator's copy and NOT the generated one; that reviewing
 * stamps an operator the request never named; and that the campaign behind the
 * screen reports all of it because the plan was recomputed.
 * ---------------------------------------------------------------------------
 *
 * AND THAT NOTHING WAS SENT. No outreach, no send row, no attempt row beyond
 * the one intent, no budget consumed.
 */

const ATHLETE = 'a-msg-e2e';
const OPERATOR = 'op-msg-e2e';
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
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
      nationality, recruiting_class_year, gpa)
    VALUES (?, ?, ?, 'Msg Athlete', 'DEFENSE', 'mens-soccer', 'New Zealand', 2027, 3.8)
  `).run(id, NOW, NOW);
}

/**
 * EVIDENCE THE ENGINE CAN ACTUALLY LICENCE FOR A STRANGER.
 *
 * A compatriot on the programme's own roster history is the cleanest licensed
 * hook there is: it is a record of who this programme has recruited, which is
 * one of the few things an unsolicited email may state without qualification.
 * Seeded so the review panel is tested against real sentences rather than
 * against an empty snapshot that would pass every assertion vacuously.
 */
function evidenceFor(college = 'Duke') {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D1', 'ACC')
  `).run(randomUUID(), NOW, NOW, college);
  for (const [name, season] of [['Hayden Aish', 2024], ['Jack Kelly', 2023]]) {
    db.prepare(`
      INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played,
        games_played)
      VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D1', ?, ?, 'DEFENSE', 'International',
        'New Zealand', 'Junior', 900, 18)
    `).run(randomUUID(), NOW, NOW, college, String(season), name);
  }
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

const messages = () => db.prepare('SELECT * FROM programme_messages').all();
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
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer', full_name: 'Msg Athlete' });
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
const el = (id) => container.querySelector(`[data-testid="${id}"]`);
const buttons = () => Array.from(container.querySelectorAll('button'));
const named = (re) => buttons()
  .find((b) => re.test(b.textContent) || re.test(b.getAttribute('aria-label') ?? ''));

const click = async (target) => {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  for (let i = 0; i < 3; i += 1) await settle();
};

const type = async (input, value) => {
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** Prepare, then Generate — the two confirmations the product requires. */
async function prepare() {
  await click(named(/^Prepare next attempt$/));
  await click(named(/^Confirm preparation$/));
}
async function generate() {
  await click(named(/^Generate message$/));
  await click(named(/^Generate message$/));
}
async function review() {
  await click(el('message-review'));
  await click(named(/^Mark as reviewed$/));
}

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM programme_contact_attempts; DELETE FROM outbound_send_attempt;
           DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM players; DELETE FROM coaches;
           DELETE FROM colleges; DELETE FROM roster_players;
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

function ready() {
  const c = campaign();
  const pc = programme(c);
  const head = coach({ email: 'head@duke.edu' });
  evidenceFor();
  return { c, pc, head };
}

/* -------------------------------------------------------------------------- */

describe('a message written in the browser is a row in the database', () => {
  it('prepare → generate → edit → review, end to end', async () => {
    const { pc, head } = ready();
    await render();

    // ---- prepare: an intent, and no words ----------------------------------
    await prepare();
    expect(rows('programme_messages')).toBe(0);
    expect(named(/^Generate message$/)).toBeTruthy();

    // ---- generate: the server writes the words ------------------------------
    await generate();

    const written = messages();
    expect(written).toHaveLength(1);
    /*
      THE CLIENT SENT TWO IDENTIFIERS AND NO CONTENT. The subject, the body, the
      recipient, the step, the structure and the evidence are all the server's —
      which is the property the request shape exists to guarantee.
    */
    expect(written[0]).toMatchObject({
      coach_id: head, step: 1, state: 'generated', recipient_email: 'head@duke.edu',
    });
    expect(written[0].generated_body).toBeTruthy();
    expect(written[0].subject).toBe(written[0].generated_subject);
    expect(written[0].body_hash).toBe(written[0].generated_body_hash);
    const post = calls.find((c) => /\/coaches\/[^/]+\/message$/.test(c.path));
    expect(post.body).toBeNull();

    // ---- the detail view shows exactly what was stored ----------------------
    expect(el('message-detail')).toBeTruthy();
    expect(el('message-subject').value).toBe(written[0].subject);
    expect(el('message-body').value).toBe(written[0].body);
    expect(el('message-recipient').textContent).toBe('head@duke.edu');
    expect(el('message-state').textContent).toBe('Generated');

    // ---- edit: the operator's copy moves, the generated one does not --------
    await type(el('message-subject'), 'A subject an operator chose');
    await type(el('message-body'), 'A body an operator wrote.');
    await click(el('message-save'));

    const edited = messages()[0];
    expect(edited.subject).toBe('A subject an operator chose');
    expect(edited.body).toBe('A body an operator wrote.');
    /*
      THE GENERATED ORIGINAL IS A RECORD AND MUST NOT MOVE. What Thriv3 wrote
      and what a person sent are two different facts, and losing the first makes
      every later comparison between them impossible.
    */
    expect(edited.generated_subject).toBe(written[0].generated_subject);
    expect(edited.generated_body).toBe(written[0].generated_body);
    expect(edited.generated_body_hash).toBe(written[0].generated_body_hash);
    expect(edited.body_hash).not.toBe(edited.generated_body_hash);
    expect(edited.recipient_email).toBe('head@duke.edu');
    expect(edited.step).toBe(1);
    expect(edited.evidence_snapshot).toBe(written[0].evidence_snapshot);
    expect(edited.state).toBe('generated');

    // ---- review: an operator the request never named ------------------------
    await review();

    const reviewed = messages()[0];
    expect(reviewed.state).toBe('reviewed');
    expect(reviewed.reviewed_by_operator_id).toBe(OPERATOR);
    expect(reviewed.reviewed_at).toBeTruthy();
    expect(reviewed.subject).toBe('A subject an operator chose');
    const reviewPost = calls.find((c) => c.path.endsWith('/review'));
    expect(reviewPost.body).toBeNull();

    // ---- read-only, and the campaign behind it agrees -----------------------
    expect(el('message-subject')).toBeNull();
    expect(el('message-body-readonly').textContent).toBe('A body an operator wrote.');
    expect(el('message-reviewed-note').textContent).toMatch(MESSAGE_COPY.editedBeforeReview);

    await click(el('message-back'));
    expect(el('message-status').textContent).toMatch(/Reviewed/);
    expect(named(/^Generate message$/)).toBeFalsy();
    expect(el('open-message').textContent).toBe(MESSAGE_COPY.openReviewed);

    // ---- and nothing was sent ----------------------------------------------
    expect(rows('outreach')).toBe(0);
    expect(rows('outreach_send')).toBe(0);
    expect(rows('outbound_send_attempt')).toBe(0);
    expect(rows('programme_contact_attempts')).toBe(1);
    expect(rows('programme_messages')).toBe(1);
    expect(text()).not.toMatch(/\bsent\b|queued|scheduled/i);

    // eslint-disable-next-line no-console
    void pc;
  });

  /**
   * THE PANEL THE SLICE EXISTS FOR, checked against the snapshot the composer
   * actually froze rather than against a fixture.
   */
  it('shows the real evidence snapshot, and never the held claims', async () => {
    ready();
    await render();
    await prepare();
    await generate();

    const row = messages()[0];
    const snapshot = JSON.parse(row.evidence_snapshot);
    const sentences = evidenceSentences(snapshot);
    const panel = el('message-evidence');

    // Real licensed evidence, not an empty snapshot passing vacuously.
    expect(sentences.length).toBeGreaterThan(0);
    expect(panel.textContent).toMatch(MESSAGE_COPY.evidenceHeading);
    expect(panel.querySelectorAll('li')).toHaveLength(sentences.length);
    for (const s of sentences) {
      expect(panel.textContent).toContain(s.text);
      // EVERY SENTENCE IT CREDITS IS ONE THE EMAIL ACTUALLY MAKES. A "why this
      // was written" that cited a claim absent from the body would be the
      // screen explaining a different email.
      expect(row.generated_body).toContain(s.text);
    }
    expect(el('message-evidence-none')).toBeNull();

    /*
      HELD IS NOT JUSTIFICATION. `held[]` is a list of evidence KINDS the body
      cap licensed and deliberately withheld — claims this email does NOT make.
    */
    for (const kind of snapshot.held ?? []) {
      expect(panel.textContent, kind).not.toContain(kind);
    }
    expect(panel.textContent).not.toMatch(/[{[]"|renderedKinds/);
  });

  it('opens an existing message with ONE read, and no campaign reload', async () => {
    ready();
    await render();
    await prepare();
    await generate();
    await click(el('message-back'));

    const before = calls.length;
    await click(el('open-message'));

    const since = calls.slice(before);
    expect(since.filter((c) => c.method === 'GET' && c.path.includes('/programme-messages/')))
      .toHaveLength(1);
    expect(since.filter((c) => c.path.includes('/execution-plan'))).toHaveLength(0);
    expect(el('message-body').value).toBe(messages()[0].body);
  });

  /**
   * READING AND REVIEWING HISTORY IS NOT ACTIONABILITY — the backend decided
   * this in F10b-4 and the screen must not recreate the policy or contradict it.
   */
  it('still reviews a message after the programme becomes do-not-contact', async () => {
    ready();
    await render();
    await prepare();
    await generate();
    await click(el('message-back'));

    stance('do_not_contact');
    await click(el('open-message'));
    await review();

    expect(messages()[0].state).toBe('reviewed');
    expect(messages()[0].reviewed_by_operator_id).toBe(OPERATOR);

    await click(el('message-back'));
    // The card says both things at once, and neither contradicts the other.
    expect(text()).toMatch(/Reviewed/);
    expect(text()).toMatch(/Do not contact/i);
    expect(text()).not.toMatch(/ready to send|will be sent|approved to send/i);
    expect(rows('outreach_send')).toBe(0);
  });

  it('refuses to write for a programme the campaign may not approach, in words', async () => {
    ready();
    await render();
    await prepare();

    // The server moves on between the page being drawn and the button pressed.
    stance('do_not_contact');
    await generate();

    expect(el('message-detail')).toBeNull();
    expect(el('campaign-notice')).toBeTruthy();
    expect(el('campaign-notice').textContent).toMatch(/Reloading the campaign/);
    expect(rows('programme_messages')).toBe(0);
  });

  it('is idempotent: generating twice returns the same row', async () => {
    ready();
    await render();
    await prepare();
    await generate();
    const first = messages()[0];

    await click(el('message-back'));
    // The card no longer offers Generate — the plan says a message exists.
    expect(named(/^Generate message$/)).toBeFalsy();
    expect(el('open-message')).toBeTruthy();

    // But the endpoint behind it is safe to call again, which is what makes a
    // dropped response recoverable rather than duplicating an email.
    const again = await fetch(`/api/programme-campaigns/pc-1/coaches/${first.coach_id}/message`, {
      method: 'POST',
    });
    expect(again.status).toBe(200);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toEqual(first);
  });

  /**
   * THE READ MODEL, PROVED ACROSS THE WHOLE STACK. The card changes because the
   * RECOMPUTED plan changed, never because this screen assumed anything.
   */
  it('the card reports currentMessage from the server, not from the click', async () => {
    ready();
    await render();
    expect(el('message-marker')).toBeNull();

    await prepare();
    expect(el('message-marker')).toBeNull();
    expect(el('attempt-prepared')).toBeTruthy();

    await generate();
    await click(el('message-back'));
    expect(el('message-status').textContent).toMatch(/Generated/);
    expect(el('open-message').textContent).toBe(MESSAGE_COPY.open);
  });
});
