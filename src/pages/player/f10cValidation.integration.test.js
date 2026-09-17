// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import CampaignTab, { groupFor, GROUP } from './CampaignTab.jsx';
import db from '../../../server/db/client.js';
import { campaignsRouter } from '../../../server/routes/campaigns.js';
import { campaignExecutionPlan } from '../../../server/lib/campaignExecution.js';
import { materialiseNextContactAttempt } from '../../../server/lib/pursuitPolicy.js';
import { generateProgrammeMessage } from '../../../server/lib/programmeMessageGeneration.js';
import { reviewProgrammeMessage } from '../../../server/lib/programmeMessages.js';
import { createOutreach } from '../../../server/lib/outreach.js';
import { recordDraft, confirmSend } from '../../../server/lib/outreachSend.js';
import { ACCEPTED_SOURCE } from '../../../shared/outreachMessageState.js';
import { utcToday } from '../../../server/lib/time.js';
import { MESSAGE_COPY, evidenceSentences } from '@/lib/campaignLabels';

/**
 * F10c — THE WHOLE F10 SYSTEM, THROUGH THE SCREEN AN OPERATOR ACTUALLY USES.
 *
 * ===========================================================================
 * NOTHING IS STUBBED EXCEPT THE BROWSER.
 *
 * Real components, real API client, real Express router, real generation gate,
 * real composer, real evidence engine, real persistence, real SQLite. The
 * server-side suite proves the model; this proves the screen and the model are
 * the same system — including the one flow no earlier slice drove end to end:
 * the FOLLOW-UP.
 * ===========================================================================
 */

const ATHLETE = 'a-f10c-ui';
const OPERATOR = 'op-f10c-ui';
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
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
      nationality, recruiting_class_year, gpa)
    VALUES (?, ?, ?, 'Marcus Reyes', 'DEFENSE', 'mens-soccer', 'New Zealand', 2027, 3.8)
  `).run(id, NOW, NOW);
}

function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, ?)
  `).run(id, `${id}@thriv3.test`, NOW);
}

function coach({ school, email, name = `Coach ${school}` }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title,
      email_status)
    VALUES (?, ?, ?, ?, ?, 'NCAA D1', 'mens-soccer', 'Head Coach', 'verified')
  `).run(id, NOW, name, email, school);
  return id;
}

function campaign({ id = 'camp-1', state = 'active' } = {}) {
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2026-08-01', ?, ?, ?, 4)
  `).run(id, ATHLETE, state, NOW, NOW, NOW);
  return id;
}

function programme(campaignId, { id, college, rank }) {
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, tier_set_at, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, ?, 'A', 'AUTO', ?, 'queued', ?, ?)
  `).run(id, campaignId, college, rank, 90 - rank, NOW, NOW, NOW);
  return id;
}

/** Roster history the engine can licence: a compatriot on file. */
function evidenceFor(college) {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D1', 'ACC')
  `).run(randomUUID(), NOW, NOW, college);
  for (const [name, season] of [['Hayden Aish', '2024'], ['Jack Kelly', '2023']]) {
    db.prepare(`
      INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played,
        games_played)
      VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D1', ?, ?, 'DEFENSE', 'International',
        'New Zealand', 'Junior', 900, 18)
    `).run(randomUUID(), NOW, NOW, college, season, name);
  }
}

function stance(value, college) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
      visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?, ?, ?)
  `).run(randomUUID(), ATHLETE, college, value, NOW, NOW);
}

/**
 * THE AUTHORITATIVE CAMPAIGN SEND TRANSITION — the real server seam, and the
 * only thing in this build that advances a campaign's history. `transitionSend`
 * is what moves the contact attempt to step 2; nothing here fakes a step.
 */
function acceptCampaignSend(pc, coachId, college, at = '2026-09-02T09:00:00.000Z') {
  const o = createOutreach({ athleteId: ATHLETE, coachId, programmeCampaignId: pc });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: college, sport: 'mens-soccer',
    programmeCampaignId: pc, evidence: null, body: `sent-${++seq}`, subject: 's',
  });
  confirmSend(o.id, at, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

const messages = () => db.prepare('SELECT * FROM programme_messages ORDER BY step').all();
const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
const attempts = () => db.prepare('SELECT * FROM programme_contact_attempts').all();

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
  const [player] = useState({ id: ATHLETE, sport: 'mens-soccer', full_name: 'Marcus Reyes' });
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

/**
 * A FRESH MOUNT, because the campaign tab has no reload control of its own.
 *
 * Where a test moves the SERVER on between two looks — an accepted send, a
 * stance change — re-rendering the same root would not re-read the plan, and
 * the second look would be at the first look's data. This is what an operator
 * reopening the tab does.
 */
async function remount() {
  await act(async () => { root.unmount(); });
  container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await render();
}

const text = () => container.textContent;
const el = (id) => container.querySelector(`[data-testid="${id}"]`);
const all = (sel) => Array.from(container.querySelectorAll(sel));
const named = (re) => all('button')
  .find((b) => re.test(b.textContent) || re.test(b.getAttribute('aria-label') ?? ''));
const card = (pc) => container.querySelector(`[data-programme="${pc}"]`);
const cardButton = (pc, re) => Array.from(card(pc)?.querySelectorAll('button') ?? [])
  .find((b) => re.test(b.textContent) || re.test(b.getAttribute('aria-label') ?? ''));
const section = (key) => container.querySelector(`[aria-labelledby="campaign-${key}"]`);

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

/**
 * SCOPED TO THE CARD, BOTH TIMES.
 *
 * A campaign with three generatable programmes has three identical "Generate
 * message" buttons, so a container-wide search finds the FIRST one — which is
 * a different school's. Confirming inside the card that was opened is also what
 * an operator does.
 */
const generateOn = async (pc) => {
  await click(cardButton(pc, /^Generate message$/));
  await click(cardButton(pc, /^Generate message$/));
};
const review = async () => {
  await click(el('message-review'));
  await click(named(/^Mark as reviewed$/));
};

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM programme_contact_attempts; DELETE FROM outbound_send_attempt;
           DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM colleges; DELETE FROM roster_players;
           DELETE FROM players; DELETE FROM coaches; DELETE FROM operator_users;
           DELETE FROM suppressions;`);
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

/** One programme, prepared, with real licensable evidence. */
function prepared({ id, college, rank }) {
  const c = db.prepare("SELECT id FROM campaigns WHERE athlete_id = ? AND state = 'active'")
    .get(ATHLETE)?.id ?? campaign();
  const pc = programme(c, { id, college, rank });
  const coachId = coach({ school: college, email: `head@${college.toLowerCase().replace(/\W/g, '')}.edu` });
  evidenceFor(college);
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  return { c, pc, coachId, college };
}

/* ========================================================================== */
/* §3 — one campaign, four truthful states                                     */
/* ========================================================================== */

describe('§3 four states of one campaign, on one real plan', () => {
  function fourWay() {
    const c = campaign();
    const a = prepared({ id: 'pc-a', college: 'Alpha', rank: 1 });
    const b = prepared({ id: 'pc-b', college: 'Bravo', rank: 2 });
    const cc = prepared({ id: 'pc-c', college: 'Charlie', rank: 3 });
    const d = prepared({ id: 'pc-d', college: 'Delta', rank: 4 });

    // B: generated, unreviewed.
    generateProgrammeMessage({ programmeCampaignId: b.pc, coachId: b.coachId });
    // C: reviewed.
    const cm = generateProgrammeMessage({ programmeCampaignId: cc.pc, coachId: cc.coachId });
    reviewProgrammeMessage(cm.message.id, { operatorId: OPERATOR });
    // D: reviewed, then blocked by live safety.
    const dm = generateProgrammeMessage({ programmeCampaignId: d.pc, coachId: d.coachId });
    reviewProgrammeMessage(dm.message.id, { operatorId: OPERATOR });
    stance('do_not_contact', 'Delta');

    return { c, a, b, cc, d };
  }

  it('shows exactly the truthful next step on each card', async () => {
    fourWay();
    await render();

    // A — prepared, nothing written.
    expect(cardButton('pc-a', /^Generate message$/)).toBeTruthy();
    expect(card('pc-a').querySelector('[data-testid="message-marker"]')).toBeNull();

    // B — written, not read by anybody.
    expect(card('pc-b').querySelector('[data-testid="message-status"]').textContent)
      .toMatch(/Generated/);
    expect(cardButton('pc-b', /^Review message$/)).toBeTruthy();
    expect(cardButton('pc-b', /^Generate message$/)).toBeFalsy();

    // C — read.
    expect(card('pc-c').querySelector('[data-testid="message-status"]').textContent)
      .toMatch(/Reviewed/);
    expect(cardButton('pc-c', /^View message$/)).toBeTruthy();

    // D — read, AND the campaign may not write to it.
    expect(card('pc-d').querySelector('[data-testid="message-status"]').textContent)
      .toMatch(/Reviewed/);
    expect(cardButton('pc-d', /^View message$/)).toBeTruthy();
    expect(card('pc-d').textContent).toMatch(/Do not contact/i);
  });

  /**
   * THE ASSERTION THE WHOLE SLICE TURNS ON. A reviewed message on a programme
   * nobody may write to must not read as a thing about to happen.
   */
  it('never presents the blocked reviewed programme as sendable', async () => {
    const { d } = fourWay();
    await render();

    const blocked = card('pc-d');
    expect(blocked.textContent).not.toMatch(
      /ready to send|approved to send|will be sent|queued|scheduled|sending|sent\b/i,
    );
    expect(cardButton('pc-d', /send|queue|schedule|dispatch|approve|authoris/i)).toBeFalsy();
    // And the plan agrees: reviewed changed no live answer.
    const entry = campaignExecutionPlan(d.c).programmes
      .find((p) => p.programmeCampaignId === 'pc-d');
    expect(entry.executableNow).toBe(false);
    expect(entry.currentMessage.state).toBe('reviewed');
    expect(count('outreach_send')).toBe(0);
  });
});

/* ========================================================================== */
/* §4 — grouping and rank are untouched by content state                       */
/* ========================================================================== */

describe('§4 a message changes no group and no order', () => {
  it('keeps message state out of grouping entirely', async () => {
    const c = campaign();
    const a = prepared({ id: 'pc-a', college: 'Alpha', rank: 1 });   // ready, unwritten
    const b = prepared({ id: 'pc-b', college: 'Bravo', rank: 2 });   // ready, written
    const w = prepared({ id: 'pc-w', college: 'Whisky', rank: 3 });  // waiting, reviewed
    const x = prepared({ id: 'pc-x', college: 'Xray', rank: 4 });    // blocked, reviewed

    generateProgrammeMessage({ programmeCampaignId: b.pc, coachId: b.coachId });

    /*
      Whisky: a follow-up that is not due yet.

      DATED FROM TODAY, not from a fixed day. The route derives `onDate` from
      the clock, so a hard-coded send date makes this test pass or fail
      depending on when it is run — which is how a suite starts lying.
    */
    acceptCampaignSend(w.pc, w.coachId, 'Whisky', `${utcToday()}T09:00:00.000Z`);
    const wm = generateProgrammeMessage({ programmeCampaignId: w.pc, coachId: w.coachId });
    reviewProgrammeMessage(wm.message.id, { operatorId: OPERATOR });

    const xm = generateProgrammeMessage({ programmeCampaignId: x.pc, coachId: x.coachId });
    reviewProgrammeMessage(xm.message.id, { operatorId: OPERATOR });
    stance('do_not_contact', 'Xray');

    // The same plan the route computes: no `onDate`, so the clock decides.
    const plan = campaignExecutionPlan(c);
    const by = Object.fromEntries(plan.programmes.map((p) => [p.programmeCampaignId, p]));

    // The four groups, decided by campaign policy and nothing else.
    expect(groupFor(by['pc-a'])).toBe(GROUP.READY);
    expect(groupFor(by['pc-b'])).toBe(GROUP.READY);
    expect(groupFor(by['pc-w'])).toBe(GROUP.WAITING);
    expect(groupFor(by['pc-x'])).toBe(GROUP.BLOCKED);

    /*
      AND THE CONTENT STATE IS INVISIBLE TO `groupFor`. Proven by construction
      rather than by inspection: the same programme with `currentMessage`
      emptied lands in the same group.
    */
    for (const p of plan.programmes) {
      const without = { ...p, currentMessage: { id: null, state: null, generatedAt: null } };
      expect(groupFor(without), p.programmeCampaignId).toBe(groupFor(p));
    }

    await render();
    expect(section(GROUP.READY)).toBeTruthy();
    expect(section(GROUP.WAITING)).toBeTruthy();
    expect(section(GROUP.BLOCKED)).toBeTruthy();
    // No group was invented for a message.
    for (const key of Object.values(GROUP)) {
      const heading = container.querySelector(`#campaign-${key}`);
      if (heading) expect(heading.textContent).not.toMatch(/generated|reviewed|message/i);
    }
  });

  it('does not reorder a group when a message is generated or reviewed', async () => {
    const c = campaign();
    prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
    const two = prepared({ id: 'pc-2', college: 'Bravo', rank: 2 });
    prepared({ id: 'pc-3', college: 'Charlie', rank: 3 });

    await render();
    const order = () => all('[data-testid="campaign-programme"]').map((e) => e.dataset.programme);
    const before = order();
    expect(before).toEqual(['pc-1', 'pc-2', 'pc-3']);

    // Generate on the MIDDLE card, through the real UI.
    await generateOn('pc-2');
    await click(el('message-back'));
    expect(order()).toEqual(before);

    await click(cardButton('pc-2', /^Review message$/));
    await review();
    await click(el('message-back'));
    expect(order()).toEqual(before);
    expect(two.pc).toBe('pc-2');
  });
});

/* ========================================================================== */
/* §5 — the step-1 flow                                                        */
/* ========================================================================== */

describe('§5 step 1, end to end through the screen', () => {
  it('generate → open → edit → review → back', async () => {
    const { pc, coachId } = prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
    await render();

    await generateOn(pc);
    const [written] = messages();
    expect(written.step).toBe(1);
    expect(written.coach_id).toBe(coachId);
    expect(written.recipient_email).toBe('head@alpha.edu');
    expect(el('message-subject').value).toBe(written.subject);
    expect(el('message-body').value).toBe(written.body);

    // The evidence the panel shows is the evidence the row holds.
    const snapshot = JSON.parse(written.evidence_snapshot);
    const sentences = evidenceSentences(snapshot);
    expect(sentences.length).toBeGreaterThan(0);
    for (const s of sentences) {
      expect(el('message-evidence').textContent).toContain(s.text);
      expect(written.generated_body).toContain(s.text);
    }

    await type(el('message-subject'), 'An operator’s subject');
    await type(el('message-body'), 'An operator’s body.');
    await click(el('message-save'));

    const edited = messages()[0];
    expect(edited.subject).toBe('An operator’s subject');
    expect(edited.generated_subject).toBe(written.generated_subject);
    expect(edited.generated_body).toBe(written.generated_body);
    expect(edited.generated_body_hash).toBe(written.generated_body_hash);
    expect(edited.evidence_snapshot).toBe(written.evidence_snapshot);

    await review();
    const reviewed = messages()[0];
    expect(reviewed.state).toBe('reviewed');
    expect(reviewed.reviewed_by_operator_id).toBe(OPERATOR);
    expect(reviewed.reviewed_at).toBeTruthy();

    await click(el('message-back'));
    expect(card(pc).querySelector('[data-testid="message-status"]').textContent).toMatch(/Reviewed/);

    // And not one execution record was written by any of it.
    expect(count('outreach')).toBe(0);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(count('connected_mailboxes')).toBe(0);
  });
});

/* ========================================================================== */
/* §6 / §7 — the follow-up, driven through the screen                          */
/* ========================================================================== */

describe('§6 step 2, through the screen, with nothing faked', () => {
  it('advances on a real accepted send and writes the follow-up', async () => {
    const { c, pc, coachId } = prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
    await render();

    // ---- step 1, written and read ------------------------------------------
    await generateOn(pc);
    await review();
    await click(el('message-back'));

    const first = messages()[0];
    expect(first.step).toBe(1);
    expect(first.state).toBe('reviewed');
    const firstFrozen = { ...first };

    /*
      ---- THE AUTHORITATIVE TRANSITION -------------------------------------
      A real accepted campaign send through `confirmSend`, which is the only
      thing in this build that advances a campaign's history. The attempt's
      step is moved by `transitionSend` — F9b-1's writer — and nothing here
      asserts a step of its own.
    */
    acceptCampaignSend(pc, coachId, 'Alpha', '2026-09-02T09:00:00.000Z');
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0].step).toBe(2);

    const advanced = campaignExecutionPlan(c).programmes[0];
    expect(advanced.derivedStep).toBe(2);
    expect(advanced.nextAction).toBe('FOLLOW_UP');
    // The step-1 message is history: it is not the current one any more.
    expect(advanced.currentMessage).toEqual({ id: null, state: null, generatedAt: null });

    // ---- the screen agrees, and offers to write the follow-up --------------
    await remount();
    expect(card(pc).querySelector('[data-testid="message-marker"]')).toBeNull();
    expect(cardButton(pc, /^Generate message$/)).toBeTruthy();

    await generateOn(pc);

    // ---- one attempt, two messages ----------------------------------------
    const rows = messages();
    expect(rows).toHaveLength(2);
    const [one, two] = rows;
    expect(one).toEqual(firstFrozen);
    expect(two.step).toBe(2);
    expect(two.programme_contact_attempt_id).toBe(one.programme_contact_attempt_id);
    expect(two.id).not.toBe(one.id);
    expect(two.state).toBe('generated');

    // ---- the screen opened the STEP-2 content ------------------------------
    expect(el('message-body').value).toBe(two.body);
    expect(el('message-detail').textContent).toMatch(/Step 2/);
    expect(el('message-body').value).not.toBe(one.body);

    // ---- and it can be reviewed like any other -----------------------------
    await review();
    expect(messages()[1].state).toBe('reviewed');
    expect(messages()[0]).toEqual(firstFrozen);

    await click(el('message-back'));
    const plan = campaignExecutionPlan(c).programmes[0];
    expect(plan.currentMessage.id).toBe(two.id);
    expect(plan.currentMessage.state).toBe('reviewed');
  });

  /**
   * §7 — AND THE FOLLOW-UP IS ACTUALLY A FOLLOW-UP.
   *
   * The dangerous failure is not a crash: it is a second message composed as
   * though it were a first, which reads to a coach as an athlete who has
   * forgotten they already wrote.
   */
  it('composes the follow-up with the follow-up sequence, not the opening one', async () => {
    const { pc, coachId } = prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
    await render();
    await generateOn(pc);
    await click(el('message-back'));

    acceptCampaignSend(pc, coachId, 'Alpha', '2026-09-02T09:00:00.000Z');
    await remount();
    await generateOn(pc);

    const [one, two] = messages();
    const snap2 = JSON.parse(two.evidence_snapshot);
    const snap1 = JSON.parse(one.evidence_snapshot);

    // The sequence record says which message of the campaign this is.
    expect(snap2.sequence?.step ?? snap2.sequence?.sequence_step).toBe(2);
    expect(snap1.sequence?.step ?? snap1.sequence?.sequence_step).toBe(1);

    // The structure is the follow-up one, taken from the sequence.
    expect(two.structure).toBe('FOLLOW_UP');
    expect(two.structure).not.toBe(one.structure);
    expect(snap2.structureSource ?? snap2.structure_source).toBe('SEQUENCE');

    // The policy versions are recorded on both and are the current ones.
    expect(two.policy_version).toBe(one.policy_version);
    expect(two.sequence_policy_version).toBe(one.sequence_policy_version);

    // And the bodies are genuinely different messages.
    expect(two.generated_body).not.toBe(one.generated_body);
    expect(two.generated_body_hash).not.toBe(one.generated_body_hash);

    // Whatever the follow-up claims, it claims it in its own body.
    for (const r of snap2.rendered ?? []) expect(two.generated_body).toContain(r.text);
  });
});

/* ========================================================================== */
/* §17 — the world moves between the button and the server                     */
/* ========================================================================== */

describe('§17 a confirmation is not a promise the server already made', () => {
  const RACES = [
    { name: 'do not contact', apply: () => stance('do_not_contact', 'Alpha'), notice: /do-not-contact/i },
    { name: 'the campaign closing', apply: (c) => db.prepare("UPDATE campaigns SET state = 'closed', closed_at = ?, close_reason = 'completed' WHERE id = ?").run(NOW, c), notice: /Reloading/ },
    {
      name: 'a suppression',
      apply: () => db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES ('head@alpha.edu', 'unsubscribed', 'manual', ?)").run(NOW),
      notice: /Reloading/,
    },
  ];

  for (const race of RACES) {
    it(`refuses and tells the truth when ${race.name} lands first`, async () => {
      const { c, pc } = prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
      await render();

      // The control is on screen and valid.
      await click(cardButton(pc, /^Generate message$/));
      expect(named(/^Generate message$/)).toBeTruthy();

      // The world moves before Confirm reaches the server.
      race.apply(c);
      const before = calls.length;
      await click(named(/^Generate message$/));
      const campaignReads = calls.slice(before)
        .filter((x) => x.method === 'GET' && !x.path.includes('/programme-messages/'));

      // Nothing was written, and nothing optimistic is on screen.
      expect(count('programme_messages')).toBe(0);
      expect(el('message-detail')).toBeNull();
      expect(el('campaign-notice')).toBeTruthy();
      expect(el('campaign-notice').textContent).toMatch(race.notice);
      expect(el('campaign-notice').textContent).not.toMatch(/undefined|\[object/);
      /*
        AND THE CAMPAIGN WAS RE-READ.

        Counted as reads of the CAMPAIGN, not of the execution plan, and ONE is
        the right number for the closing case: a campaign that has just closed
        has no plan to fetch, so the reload lists the campaigns, finds none
        active, and the page becomes the empty state. That is the truthful
        answer, and it is exactly why F9c moved the notice out of the Ready
        branch and into every terminal state — otherwise the sentence explaining
        the operator's click would vanish in the same moment it became true.
      */
      expect(campaignReads.length).toBeGreaterThanOrEqual(1);
      expect(el('campaign-notice')).toBeTruthy();
    });
  }
});

/* ========================================================================== */
/* §18 — reviewing after safety changes                                        */
/* ========================================================================== */

describe('§18 content review is not execution approval', () => {
  it('reviews a message whose programme became unreachable, and says both things', async () => {
    const { c, pc } = prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
    await render();
    await generateOn(pc);
    await click(el('message-back'));

    stance('do_not_contact', 'Alpha');

    await click(cardButton(pc, /^Review message$/));
    await review();

    // 1. THE REVIEW SUCCEEDED.
    expect(messages()[0].state).toBe('reviewed');
    expect(messages()[0].reviewed_by_operator_id).toBe(OPERATOR);

    await click(el('message-back'));

    // 2. THE CAMPAIGN IS STILL BLOCKED, and says so on the same card.
    expect(card(pc).textContent).toMatch(/Reviewed/);
    expect(card(pc).textContent).toMatch(/Do not contact/i);

    // 3. AND NOTHING IMPLIES THE ONE CANCELS THE OTHER.
    expect(card(pc).textContent).not.toMatch(/ready to send|approved|will be sent|queued/i);
    const entry = campaignExecutionPlan(c).programmes[0];
    expect(entry.executableNow).toBe(false);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
  });
});

/* ========================================================================== */
/* §21 — what the screen costs                                                 */
/* ========================================================================== */

describe('§21 the request budget, pinned against a real server', () => {
  const since = (n) => calls.slice(n);
  const plans = (list) => list.filter((x) => x.path.includes('/execution-plan'));
  const gets = (list) => list.filter((x) => x.method === 'GET' && x.path.includes('/programme-messages/'));

  it('costs exactly what it should, at every step', async () => {
    const { pc } = prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });

    // ---- initial load: the campaign list and the plan. Nothing per card. ----
    await render();
    expect(plans(calls)).toHaveLength(1);
    expect(gets(calls)).toHaveLength(0);

    // ---- generate: one POST, one reload, and NO read (the POST returned it) -
    let n = calls.length;
    await generateOn(pc);
    expect(since(n).filter((x) => /\/coaches\/[^/]+\/message$/.test(x.path))).toHaveLength(1);
    expect(plans(since(n))).toHaveLength(1);
    expect(gets(since(n))).toHaveLength(0);

    // ---- save: one PATCH, and no plan reload -------------------------------
    n = calls.length;
    await type(el('message-body'), 'Rewritten.');
    await click(el('message-save'));
    expect(since(n).filter((x) => x.method === 'PATCH')).toHaveLength(1);
    expect(plans(since(n))).toHaveLength(0);

    // ---- review: one POST, one reload --------------------------------------
    n = calls.length;
    await review();
    expect(since(n).filter((x) => x.path.endsWith('/review'))).toHaveLength(1);
    expect(plans(since(n))).toHaveLength(1);

    // ---- back: nothing ------------------------------------------------------
    n = calls.length;
    await click(el('message-back'));
    expect(since(n)).toHaveLength(0);

    // ---- open an existing message: one GET, no reload ----------------------
    n = calls.length;
    await click(cardButton(pc, /^View message$/));
    expect(gets(since(n))).toHaveLength(1);
    expect(plans(since(n))).toHaveLength(0);

    // ---- searching and filtering: nothing ----------------------------------
    await click(el('message-back'));
    n = calls.length;
    const search = container.querySelector('input[aria-label^="Search programmes"]');
    await type(search, 'Alpha');
    await type(search, 'Nowhere');
    expect(since(n)).toHaveLength(0);
  });

  it('does not poll', async () => {
    prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
    await render();
    const before = calls.length;
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    }
    expect(calls.length).toBe(before);
  });
});

/* ========================================================================== */
/* §13 — the profile token                                                     */
/* ========================================================================== */

describe('§13 the one token F10 deliberately does not resolve', () => {
  it('keeps it through edit and review, explains it, and mints nothing', async () => {
    const { pc } = prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
    await render();
    await generateOn(pc);

    const written = messages()[0];
    expect(written.generated_body).toContain(MESSAGE_COPY.profileToken);
    // The note is shown BECAUSE the token is there.
    expect(el('message-token-note').textContent).toBe(MESSAGE_COPY.profileTokenNote);

    // Editing something else does not disturb it.
    await type(el('message-subject'), 'Changed subject');
    await click(el('message-save'));
    expect(messages()[0].body).toContain(MESSAGE_COPY.profileToken);
    expect(el('message-body').value).toContain(MESSAGE_COPY.profileToken);

    await review();
    expect(messages()[0].body).toContain(MESSAGE_COPY.profileToken);
    expect(el('message-body-readonly').textContent).toContain(MESSAGE_COPY.profileToken);

    /*
      AND NO TRACKING TOKEN WAS MINTED. The per-recipient link belongs to an
      `outreach` row that only a send creates, which is exactly why the token
      survives: F10 has no recipient-specific URL to put there and must not
      invent a permanent one.
    */
    expect(count('outreach')).toBe(0);
    expect(count('tracking_events')).toBe(0);
    expect(messages()[0].body).not.toMatch(/https?:\/\/\S*\/t\/|token=/i);
  });
});

/* ========================================================================== */
/* §26 — the vocabulary, on a rendered screen                                  */
/* ========================================================================== */

describe('§26 nothing on this screen claims delivery', () => {
  it('says nothing about sending at any stage of the real flow', async () => {
    const { pc } = prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
    await render();

    const FORBIDDEN = /approved to send|ready to send|will send|will be sent|queued|scheduled|dispatch|delivered|in your outbox/i;
    const controls = () => all('button')
      .map((b) => `${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).join(' | ');

    expect(text()).not.toMatch(FORBIDDEN);
    expect(controls()).not.toMatch(/send|queue|schedule|dispatch|approve|authoris|execute/i);

    await click(cardButton(pc, /^Generate message$/));
    // The one place the word appears is a denial.
    expect(text()).toMatch(/Nothing will be sent/);
    expect(controls()).not.toMatch(/send|queue|schedule|dispatch|approve|authoris/i);

    await click(named(/^Generate message$/));
    expect(text()).not.toMatch(FORBIDDEN);
    expect(controls()).not.toMatch(/send|queue|schedule|dispatch|approve|authoris/i);

    await click(el('message-review'));
    expect(text()).toMatch(/does not send, queue or schedule/);
    await click(named(/^Mark as reviewed$/));

    expect(text()).not.toMatch(FORBIDDEN);
    expect(controls()).not.toMatch(/send|queue|schedule|dispatch|approve|authoris|execute/i);
  });

  /**
   * AND NO COPY PROMISES A POLICY NOBODY HAS DECIDED. "Every email must be
   * reviewed before it goes" is an automation rule that does not exist, and
   * asserting it here would make a later automated campaign look like a broken
   * promise this screen invented.
   */
  it('describes this operator reviewing this message, never a universal rule', async () => {
    const { pc } = prepared({ id: 'pc-1', college: 'Alpha', rank: 1 });
    await render();
    await generateOn(pc);
    await click(el('message-review'));

    expect(text()).not.toMatch(/every message|all messages|must be reviewed|before sending/i);
    expect(text()).toMatch(/you have reviewed/i);
  });
});
