import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { campaignsRouter } from './campaigns.js';
import { createOutreach } from '../lib/outreach.js';
import { recordDraft, acceptSend, openSendFor } from '../lib/outreachSend.js';
import { suppress } from '../lib/suppressions.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * F9b-2 — POST /api/programme-campaigns/:id/contact-attempts.
 *
 * A route test rather than a library test, over real HTTP against the real
 * router, because every property here is a BOUNDARY property: what the request
 * is allowed to say, what a refusal looks like from outside, what leaves the
 * building, and what the database looks like afterwards.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THINGS THIS ENDPOINT MUST NEVER BLUR.
 *
 * `created: false` means THE ROW WAS ALREADY THERE, which is a success and a
 * 200. A refusal is a 4xx with a code. If a refusal ever came back as
 * `200 {created: false, attempt: null}` a client reading the flag alone would
 * record a preparation that never happened.
 *
 * And preparing is not sending. Nothing here composes a message, touches a
 * mailbox, reserves budget or calls a transport — the last test in this file
 * checks that against the tables rather than trusting the sentence.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-prep-api';
let baseUrl;
let seq = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', campaignsRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const prepare = (pc, body) => api('POST', `/api/programme-campaigns/${pc}/contact-attempts`, body);

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function coach({ email, school = 'Duke' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', 'mens-soccer', 'Head Coach')
  `).run(id, `Coach ${++seq}`, email ?? `c${seq}@duke.edu`, school);
  return id;
}

function makeCampaign({ state = 'active' } = {}) {
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2026-09-01', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)
  `).run(id, ATHLETE, state);
  return id;
}

function makeProgramme(campaignId, { state = 'queued' } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, state, created_at, updated_at)
    VALUES (?, ?, 'Duke', 'mens-soccer', ?, 82, 'A', ?, '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, ++seq, state);
  return id;
}

function relationship(stance) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
      flagged, visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, 'Duke', 'mens-soccer', 'none', 0, 'default', ?,
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), ATHLETE, stance);
}

/** Contact by hand, before the campaign existed — the first-touch trigger. */
function manualHistory(coachId) {
  const o = createOutreach({ athleteId: ATHLETE, coachId });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: 'Duke', sport: 'mens-soccer',
    evidence: null, body: `m${++seq}`, subject: 's',
  });
  acceptSend(openSendFor(o.id).id, {
    source: ACCEPTED_SOURCE.OPERATOR_ASSERTED, at: '2026-08-20T11:00:00.000Z',
  });
}

const attemptCount = () => db.prepare('SELECT COUNT(*) n FROM programme_contact_attempts').get().n;
const count = (table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

/** A fresh scene: an active campaign, one programme, one reachable head coach. */
function scene(campaignOpts = {}, programmeOpts = {}) {
  const c = makeCampaign(campaignOpts);
  const pc = makeProgramme(c, programmeOpts);
  const head = coach({});
  return { c, pc, head };
}

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM engagement_rollup; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM campaign_first_touch_approvals;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM athlete_programmes;
           DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE);
  seq = 0;
});

/* -------------------------------------------------------------------------- */

describe('preparing a contact attempt', () => {
  it('creates one attempt and returns 201 with a small body', async () => {
    const { pc, head } = scene();

    const { status, body } = await prepare(pc);

    expect(status).toBe(201);
    expect(body.created).toBe(true);
    expect(body.attempt).toEqual({
      id: expect.any(String),
      programmeCampaignId: pc,
      coachId: head,
      state: 'planned',
      step: 1,
      createdAt: expect.any(String),
    });
    expect(attemptCount()).toBe(1);
  });

  /** Not the plan, not the coach's history, not the blockers. Six fields. */
  it('returns no pursuit plan and nothing beyond the attempt', async () => {
    const { pc } = scene();
    const { body } = await prepare(pc);

    expect(Object.keys(body).sort()).toEqual(['attempt', 'created']);
    expect(body.plan).toBeUndefined();
    expect(body.preparation).toBeUndefined();
  });

  /**
   * RETRY SAFETY, WHICH IS WHY THIS IS A 200 AND NOT A 409. The attempt is keyed
   * on (programme campaign, coach) and the SERVER picks the coach, so a request
   * replayed after a dropped connection cannot land anywhere else.
   */
  it('is idempotent: a replay is 200 with the same attempt and created false', async () => {
    const { pc } = scene();
    const first = await prepare(pc);

    const second = await prepare(pc);
    const third = await prepare(pc);

    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.attempt).toEqual(first.body.attempt);
    expect(third.body.attempt.id).toBe(first.body.attempt.id);
    expect(attemptCount()).toBe(1);
  });

  it('prepares under a DRAFT campaign, which may not send', async () => {
    const { pc } = scene({ state: 'draft' });
    const { status, body } = await prepare(pc);
    expect(status).toBe(201);
    expect(body.created).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('what the request may say', () => {
  it('refuses a body with anything in it', async () => {
    const { pc } = scene();

    for (const body of [
      { coachId: 'someone' }, { step: 5 }, { action: 'INITIAL_OUTREACH' },
      { athleteId: 'other' }, { sendingIdentity: 'x@y.test' }, { onDate: '2026-01-01' },
      { operatorId: 'op-1' }, { subject: 'hi' }, { body: 'hello' },
    ]) {
      const res = await prepare(pc, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toMatch(/Unknown field/);
    }
    expect(attemptCount()).toBe(0);
  });

  it('accepts no body at all, and an empty object', async () => {
    const { pc } = scene();
    expect((await prepare(pc)).status).toBe(201);

    const { pc: other } = scene();
    expect((await prepare(other, {})).status).toBe(201);
  });

  it('refuses unexpected query parameters', async () => {
    const { pc } = scene();
    const res = await api('POST', `/api/programme-campaigns/${pc}/contact-attempts?on_date=2026-09-20`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown query parameter/);
    expect(attemptCount()).toBe(0);
  });

  it('404s an unknown programme campaign, writing nothing', async () => {
    const res = await prepare('pc-does-not-exist');
    expect(res.status).toBe(404);
    expect(attemptCount()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('refusals are explicit, and never a 200', () => {
  const refusals = [
    ['first-touch review required', 'CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED',
      ({ head }) => manualHistory(head)],
    ['manual only', 'RELATIONSHIP_MANUAL_ONLY', () => relationship('manual_only')],
    ['do not contact', 'RELATIONSHIP_DO_NOT_CONTACT', () => relationship('do_not_contact')],
    ['revoked relationship', 'OUTREACH_REVOKED', ({ head }) => {
      const o = createOutreach({ athleteId: ATHLETE, coachId: head });
      db.prepare('UPDATE outreach SET revoked_at = ? WHERE id = ?')
        .run('2026-09-05T00:00:00.000Z', o.id);
    }],
  ];

  for (const [name, code, setup] of refusals) {
    it(`refuses ${name} with ${code}`, async () => {
      const s = scene();
      setup(s);

      const { status, body } = await prepare(s.pc);

      expect(status).toBe(422);
      expect(body.code).toBe(code);
      expect(body.error).toEqual(expect.any(String));
      expect(body.created).toBeUndefined();
      expect(attemptCount()).toBe(0);
    });
  }

  it('refuses a closed campaign with CAMPAIGN_NOT_ACTIVE', async () => {
    const { pc } = scene({ state: 'closed' });
    const { status, body } = await prepare(pc);
    expect(status).toBe(422);
    expect(body.code).toBe('CAMPAIGN_NOT_ACTIVE');
    expect(attemptCount()).toBe(0);
  });

  it('refuses a stopped programme with PROGRAMME_STOPPED', async () => {
    const { pc } = scene({}, { state: 'stopped' });
    const { status, body } = await prepare(pc);
    expect(status).toBe(422);
    expect(body.code).toBe('PROGRAMME_STOPPED');
  });

  it('refuses a completed programme with PROGRAMME_COMPLETED', async () => {
    const { pc } = scene({}, { state: 'completed' });
    const { status, body } = await prepare(pc);
    expect(status).toBe(422);
    expect(body.code).toBe('PROGRAMME_COMPLETED');
  });

  /**
   * A SUPPRESSED ADDRESS ARRIVES AS AN ABSENCE. The plan drops it from the
   * candidates, so what the endpoint has to report is a programme with nobody
   * to write to — which had no code at all before F9b-2.
   */
  it('refuses a wholly suppressed staff with NO_ELIGIBLE_COACH', async () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({ email: 'only@duke.edu' });
    suppress({ email: 'only@duke.edu' });

    const { status, body } = await prepare(pc);
    expect(status).toBe(422);
    expect(body.code).toBe('NO_ELIGIBLE_COACH');
    expect(attemptCount()).toBe(0);
  });

  it('refuses a programme with no staff at all with NO_ELIGIBLE_COACH', async () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);

    const { status, body } = await prepare(pc);
    expect(status).toBe(422);
    expect(body.code).toBe('NO_ELIGIBLE_COACH');
  });

  it('refuses a programme awaiting a person with NO_ACTION_TO_PREPARE', async () => {
    const { pc, head } = scene();
    const o = createOutreach({ athleteId: ATHLETE, coachId: head, programmeCampaignId: pc });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: head, collegeName: 'Duke',
      sport: 'mens-soccer', programmeCampaignId: pc, evidence: null, body: 'b', subject: 's',
    });
    acceptSend(openSendFor(o.id).id, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
    db.prepare(`INSERT INTO engagement_rollup (outreach_id, responded_at, updated_at)
      VALUES (?, '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z')`).run(o.id);

    const { status, body } = await prepare(pc);
    expect(status).toBe(422);
    expect(body.code).toBe('NO_ACTION_TO_PREPARE');
    expect(attemptCount()).toBe(0);
  });

  it('never answers a refusal with 200 or a null attempt', async () => {
    const cases = [
      () => { const s = scene(); manualHistory(s.head); return s.pc; },
      () => { const s = scene(); relationship('do_not_contact'); return s.pc; },
      () => scene({ state: 'closed' }).pc,
      () => makeProgramme(makeCampaign()),
    ];

    for (const build of cases) {
      db.exec(`DELETE FROM programme_contact_attempts; DELETE FROM outreach_send;
               DELETE FROM outreach; DELETE FROM programme_campaigns; DELETE FROM campaigns;
               DELETE FROM coaches; DELETE FROM athlete_programmes;`);
      const pc = build();
      const { status, body } = await prepare(pc);

      expect(status).toBeGreaterThanOrEqual(400);
      expect(body.attempt).toBeUndefined();
      expect(body.code).toEqual(expect.any(String));
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('preparing writes an intent and nothing else', () => {
  it('touches no message, relationship, budget or campaign state', async () => {
    const { c, pc } = scene();
    const campaignBefore = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(c);
    const programmeBefore = db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc);

    const { status } = await prepare(pc);
    expect(status).toBe(201);

    // No message was composed, no token minted, no capacity spent.
    expect(count('outreach')).toBe(0);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);

    // No lifecycle moved.
    expect(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(c)).toEqual(campaignBefore);
    expect(db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc))
      .toEqual(programmeBefore);

    // And the one row it did write is a plan, not a contact.
    const row = db.prepare('SELECT * FROM programme_contact_attempts').get();
    expect(row.state).toBe('planned');
    expect(row.outreach_id).toBeNull();
    expect(row.next_action_at).toBeNull();
  });

  /**
   * PREPARING IS NOT ATTRIBUTABLE TO A PERSON, and the schema says so by having
   * nowhere to put one. The server chose the coach, the step and the timing from
   * policy; the operator only asked. The first-touch approval remains the
   * attributable human decision, and it has its own table for exactly that.
   */
  it('records no operator on the attempt', async () => {
    const { pc } = scene();
    await prepare(pc);

    const row = db.prepare('SELECT * FROM programme_contact_attempts').get();
    expect(Object.keys(row)).not.toContain('created_by_operator_id');
    expect(Object.keys(row).some((k) => /operator|created_by/i.test(k))).toBe(false);
  });

  it('does not accept a coach or step from the client even when one is offered', async () => {
    const { pc, head } = scene();
    const other = coach({ email: 'assistant@duke.edu' });

    // Refused outright rather than ignored — but prove the write is the
    // server's choice either way.
    expect((await prepare(pc, { coachId: other, step: 7 })).status).toBe(400);
    expect((await prepare(pc)).status).toBe(201);

    const row = db.prepare('SELECT * FROM programme_contact_attempts').get();
    expect(row.coach_id).toBe(head);
    expect(row.step).toBe(1);
  });

  it('the route source reads no coach, step or action from the request', () => {
    const code = fs.readFileSync(new URL('./campaigns.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const route = code.slice(code.indexOf("'/programme-campaigns/:programmeCampaignId/contact-attempts'"));
    const handler = route.slice(0, route.indexOf('\n);'));

    /**
     * READS, not the word. An earlier version of this matched the vocabulary
     * anywhere in the handler and caught the endpoint's own error copy — which
     * names the coach and the step precisely to say it does not take them.
     * What matters is whether a VALUE is taken from the request.
     */
    expect(handler).toMatch(/req\.params\.programmeCampaignId/);
    // Nothing is read out of the body. It is handed whole to the allow-list.
    expect(handler).not.toMatch(/req\.body\s*[.[]/);
    expect(handler).toMatch(/readBody\(req\.body, \[\]/);
    // The query is only enumerated to refuse it; no parameter is read by name.
    expect(handler).not.toMatch(/req\.query\s*[.[]/);
    // And no other route param is consulted.
    expect(handler.match(/req\.params\.\w+/g)).toEqual(['req.params.programmeCampaignId']);
  });
});
