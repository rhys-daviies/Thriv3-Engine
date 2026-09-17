import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { campaignsRouter } from './campaigns.js';
import { materialiseNextContactAttempt } from '../lib/pursuitPolicy.js';
import { attemptForCoach, transitionContactAttempt } from '../lib/contactAttempts.js';
import { createOutreach } from '../lib/outreach.js';
import { recordDraft, confirmSend } from '../lib/outreachSend.js';
import { suppress } from '../lib/suppressions.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * F10b-4 — THE PROGRAMME MESSAGE API.
 *
 * Route tests over real HTTP against the real router, because every property
 * here is a boundary property: what a request is allowed to say, what a refusal
 * looks like from outside, what leaves the building, and what the database looks
 * like afterwards.
 *
 * ---------------------------------------------------------------------------
 * THE TWO DISTINCTIONS THE API MUST NOT BLUR.
 *
 * A MESSAGE IS CONTENT, NOT DELIVERY. Generating writes what a campaign intends
 * to say. Nothing is drafted into a mailbox, queued, scheduled or sent, and
 * reviewing approves words rather than a send.
 *
 * READING HISTORY IS NOT ACTIONABILITY. A message written under a campaign that
 * has since closed stays readable and stays exactly as it was written, while
 * generating a NEW one refuses. The two facts are allowed to disagree, and the
 * historical-read block asserts that they do.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-msgapi';
const OPERATOR = 'op-msgapi';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let baseUrl;
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

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const generate = (pc, coachId, body) => api('POST', `/api/programme-campaigns/${pc}/coaches/${coachId}/message`, body);
const read = (id) => api('GET', `/api/programme-messages/${id}`);
const edit = (id, body) => api('PATCH', `/api/programme-messages/${id}`, body);
const review = (id, body) => api('POST', `/api/programme-messages/${id}/review`, body);

/* -------------------------------------------------------------------------- */

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(id, randomUUID().slice(0, 10));
}

function operator(id = OPERATOR) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(id, `${id}@thriv3.test`);
  return id;
}

function makeCollege() {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', 'ACC')
  `).run(randomUUID(), COLLEGE, SPORT);
}

function makeCampaign() {
  db.prepare(`UPDATE campaigns SET state='closed', closed_at='x', close_reason='completed'
    WHERE athlete_id = ? AND state='active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)
  `).run(id, ATHLETE);
  return id;
}

function makeProgramme(campaignId) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(id, campaignId, COLLEGE, SPORT, ++seq);
  return id;
}

function makeCoach({ name = 'Danny Frid', email } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, 'x', ?, ?, ?, 'NCAA D1', ?, 'Head Coach')
  `).run(id, name, email ?? `c${++seq}@duke.edu`, COLLEGE, SPORT);
  return id;
}

function giveCompatriotHistory() {
  for (const [name, season] of [['Hayden Aish', '2024'], ['Jack Kelly', '2023']]) {
    db.prepare(`
      INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played,
        games_played)
      VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', ?, ?, 'DEFENSE', 'International', 'New Zealand',
        'Junior', 900, 18)
    `).run(randomUUID(), COLLEGE, SPORT, season, name);
  }
}

function stance(value) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
      visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?, 'x', 'x')
  `).run(randomUUID(), ATHLETE, COLLEGE, value);
}

function sendUnder(pc, coachId, at = '2026-09-01T09:00:00.000Z') {
  const o = createOutreach({ athleteId: ATHLETE, coachId, programmeCampaignId: pc });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: COLLEGE, sport: SPORT,
    programmeCampaignId: pc, evidence: null, body: `b${++seq}`, subject: 's',
  });
  confirmSend(o.id, at, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

const messages = () => db.prepare('SELECT * FROM programme_messages').all();

/** Every table the API must not touch. */
const WATCHED = Object.freeze([
  'programme_contact_attempts', 'outreach', 'outreach_send', 'outreach_evidence',
  'outbound_send_attempt', 'campaigns', 'programme_campaigns', 'athlete_programmes',
  'suppressions', 'campaign_first_touch_approvals', 'connected_mailboxes',
  'coaches', 'players', 'colleges',
]);

function snapshot({ withMessages = false } = {}) {
  const out = {};
  for (const t of WATCHED) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  if (withMessages) out.programme_messages = messages();
  return JSON.parse(JSON.stringify(out));
}

beforeEach(() => {
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM coaches; DELETE FROM colleges;
           DELETE FROM roster_players; DELETE FROM suppressions;
           DELETE FROM operator_users; DELETE FROM players;`);
  insertAthlete(ATHLETE);
  operator();
  makeCollege();
  seq = 0;
});

/** A prepared, generatable pursuit. */
function prepared() {
  const c = makeCampaign();
  const pc = makeProgramme(c);
  const coach = makeCoach();
  giveCompatriotHistory();
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  return { c, pc, coach, attempt: attemptForCoach(pc, coach) };
}

/** The key set every endpoint must return. */
const RESOURCE_KEYS = [
  'body', 'bodyHash', 'bodySource', 'coachId', 'evidence', 'generatedAt', 'generatedBody',
  'generatedBodyHash', 'generatedSubject', 'id', 'policyVersion', 'programmeContactAttemptId',
  'recipientEmail', 'reviewedAt', 'reviewedByOperatorId', 'sequencePolicyVersion', 'state',
  'step', 'structure', 'subject', 'updatedAt',
].sort();

/* ========================================================================== */
/* Generate                                                                    */
/* ========================================================================== */

describe('POST .../coaches/:coachId/message', () => {
  it('writes one message and returns 201 with the resource', async () => {
    const { pc, coach, attempt } = prepared();

    const { status, body } = await generate(pc, coach);

    expect(status).toBe(201);
    expect(Object.keys(body).sort()).toEqual(RESOURCE_KEYS);
    expect(body).toMatchObject({
      programmeContactAttemptId: attempt.id,
      step: 1,
      coachId: coach,
      state: 'generated',
      reviewedByOperatorId: null,
      reviewedAt: null,
    });
    expect(body.subject).toBe(body.generatedSubject);
    expect(body.body).toBe(body.generatedBody);
    expect(messages()).toHaveLength(1);
  });

  it('carries the evidence, parsed, so "why was this written" needs no second call', async () => {
    const { pc, coach } = prepared();
    const { body } = await generate(pc, coach);

    expect(typeof body.evidence).toBe('object');
    expect(Array.isArray(body.evidence.rendered)).toBe(true);
    expect(body.evidence.rendered.length).toBeGreaterThan(0);
    for (const r of body.evidence.rendered) {
      expect(Object.keys(r).sort()).toEqual(['kind', 'order', 'role', 'slot', 'text']);
      expect(body.generatedBody).toContain(r.text);
    }
  });

  it('freezes the server-resolved recipient, and exposes no sender', async () => {
    const { pc, coach } = prepared();
    const email = db.prepare('SELECT email FROM coaches WHERE id = ?').get(coach).email;

    const { body } = await generate(pc, coach);

    expect(body.recipientEmail).toBe(email);
    for (const absent of ['senderEmail', 'senderDisplayName', 'replyTo', 'connectedMailboxId',
      'sentAt', 'scheduledAt', 'queuedAt']) {
      expect(body[absent], absent).toBeUndefined();
    }
  });

  it('is idempotent: a replay is 200 with the same id and generatedAt', async () => {
    const { pc, coach } = prepared();
    const first = await generate(pc, coach);

    const replay = await generate(pc, coach);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(messages()).toHaveLength(1);
  });

  it('refuses a body with anything in it, and a query parameter', async () => {
    const { pc, coach } = prepared();

    for (const payload of [
      { subject: 'mine' }, { body: 'mine' }, { step: 2 }, { recipientEmail: 'x@y.z' },
      { evidence: {} }, { athleteId: 'other' },
    ]) {
      const res = await generate(pc, coach, payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect(res.body.error).toMatch(/Unknown field/);
    }
    const q = await api('POST', `/api/programme-campaigns/${pc}/coaches/${coach}/message?on_date=2026-01-01`);
    expect(q.status).toBe(400);
    expect(q.body.error).toMatch(/Unknown query parameter/);
    expect(messages()).toHaveLength(0);
  });

  const REFUSALS = [
    ['no prepared attempt', 422, 'CONTACT_ATTEMPT_REQUIRED', () => {
      const c = makeCampaign(); const pc = makeProgramme(c); const coach = makeCoach();
      giveCompatriotHistory();
      return [pc, coach];
    }],
    ['stopped attempt', 422, 'CONTACT_ATTEMPT_NOT_PLANNED', () => {
      const s = prepared();
      transitionContactAttempt(s.attempt.id, 'stopped', { reason: 'operator' });
      return [s.pc, s.coach];
    }],
    ['step drift', 422, 'CONTACT_ATTEMPT_STEP_DRIFT', () => {
      const s = prepared();
      db.prepare('UPDATE programme_contact_attempts SET step = 3 WHERE id = ?').run(s.attempt.id);
      return [s.pc, s.coach];
    }],
    ['manual only', 422, 'RELATIONSHIP_MANUAL_ONLY', () => {
      const s = prepared(); stance('manual_only'); return [s.pc, s.coach];
    }],
    ['do not contact', 422, 'RELATIONSHIP_DO_NOT_CONTACT', () => {
      const s = prepared(); stance('do_not_contact'); return [s.pc, s.coach];
    }],
    ['suppressed', 422, 'NO_ELIGIBLE_COACH', () => {
      const s = prepared();
      suppress({ email: db.prepare('SELECT email FROM coaches WHERE id = ?').get(s.coach).email });
      return [s.pc, s.coach];
    }],
    ['stopped programme', 422, 'PROGRAMME_STOPPED', () => {
      const s = prepared();
      db.prepare("UPDATE programme_campaigns SET state='stopped' WHERE id = ?").run(s.pc);
      return [s.pc, s.coach];
    }],
    ['completed programme', 422, 'PROGRAMME_COMPLETED', () => {
      const s = prepared();
      db.prepare("UPDATE programme_campaigns SET state='completed' WHERE id = ?").run(s.pc);
      return [s.pc, s.coach];
    }],
    ['closed campaign', 422, 'CAMPAIGN_NOT_ACTIVE', () => {
      const s = prepared();
      db.prepare(`UPDATE campaigns SET state='closed', closed_at='x', close_reason='completed'
        WHERE id = ?`).run(s.c);
      return [s.pc, s.coach];
    }],
    ['unknown programme campaign', 404, 'PROGRAMME_CAMPAIGN_NOT_FOUND', () => {
      const s = prepared();
      return ['pc-nope', s.coach];
    }],
    ['unknown coach', 422, 'CONTACT_ATTEMPT_REQUIRED', () => {
      const s = prepared();
      return [s.pc, 'coach-nope'];
    }],
  ];

  for (const [name, status, code, build] of REFUSALS) {
    it(`refuses ${name} with ${code}, and writes nothing`, async () => {
      const [pc, coach] = build();
      const before = snapshot({ withMessages: true });

      const res = await generate(pc, coach);

      expect(res.status, name).toBe(status);
      expect(res.body.code, name).toBe(code);
      expect(res.body.error).toEqual(expect.any(String));
      expect(res.body.id).toBeUndefined();
      expect(snapshot({ withMessages: true })).toEqual(before);
    });
  }

  it('refuses after a safety change, and the existing message is untouched', async () => {
    const { pc, coach } = prepared();
    const first = await generate(pc, coach);

    stance('do_not_contact');

    const res = await generate(pc, coach);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect((await read(first.body.id)).body).toEqual(first.body);
    expect(messages()).toHaveLength(1);
  });

  it('never exposes a stack trace', async () => {
    const { pc, coach } = prepared();
    stance('do_not_contact');
    const res = await generate(pc, coach);
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|\.js:\d+:\d+/);
  });
});

/* ========================================================================== */
/* Read                                                                        */
/* ========================================================================== */

describe('GET /api/programme-messages/:messageId', () => {
  it('returns the canonical resource, with evidence, and writes nothing', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    const before = snapshot({ withMessages: true });

    const { status, body } = await read(created.body.id);

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(RESOURCE_KEYS);
    expect(body).toEqual(created.body);
    expect(body.evidence.rendered.length).toBeGreaterThan(0);
    expect(snapshot({ withMessages: true })).toEqual(before);
  });

  it('404s an unknown id', async () => {
    const res = await read('nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No programme message/);
  });

  /**
   * AN ID IS NOT AUTHORITY. The row is reachable only through an attempt, a
   * programme campaign and a campaign, and a message whose chain does not
   * resolve is not returned on the strength of its id.
   */
  it('404s a message whose ownership chain does not resolve', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    expect((await read(created.body.id)).status).toBe(200);

    // Break the chain without deleting the message, by detaching the attempt
    // from any campaign the joins can reach.
    db.prepare('PRAGMA foreign_keys = OFF').run();
    db.prepare('DELETE FROM programme_campaigns WHERE id = ?').run(pc);
    try {
      expect((await read(created.body.id)).status).toBe(404);
    } finally {
      db.prepare('PRAGMA foreign_keys = ON').run();
    }
  });

  it('refuses a query parameter', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    const res = await api('GET', `/api/programme-messages/${created.body.id}?expand=all`);
    expect(res.status).toBe(400);
  });

  /**
   * READING HISTORY IS NOT ACTIONABILITY. Each of these makes generating a NEW
   * message refuse, and none of them touches what was already written.
   */
  const HISTORICAL = [
    ['do not contact', 'RELATIONSHIP_DO_NOT_CONTACT', () => stance('do_not_contact')],
    ['closed campaign', 'CAMPAIGN_NOT_ACTIVE', ({ c }) => {
      db.prepare(`UPDATE campaigns SET state='closed', closed_at='x', close_reason='completed'
        WHERE id = ?`).run(c);
    }],
    ['global suppression', 'NO_ELIGIBLE_COACH', ({ coach }) => {
      suppress({ email: db.prepare('SELECT email FROM coaches WHERE id = ?').get(coach).email });
    }],
  ];

  for (const [name, code, apply] of HISTORICAL) {
    it(`stays readable after ${name}, unchanged and with zero writes`, async () => {
      const scene = prepared();
      const created = await generate(scene.pc, scene.coach);

      apply(scene);
      const before = snapshot({ withMessages: true });

      // Generating anew refuses...
      const refused = await generate(scene.pc, scene.coach);
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe(code);

      // ...and the message is still exactly what was written.
      const { status, body } = await read(created.body.id);
      expect(status).toBe(200);
      expect(body).toEqual(created.body);
      expect(body.evidence).toEqual(created.body.evidence);
      expect(snapshot({ withMessages: true })).toEqual(before);
    });
  }
});

/* ========================================================================== */
/* Edit                                                                        */
/* ========================================================================== */

describe('PATCH /api/programme-messages/:messageId', () => {
  it('changes the words, and nothing that was generated', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);

    const { status, body } = await edit(created.body.id, {
      subject: 'A better subject', body: 'A better body.',
    });

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(RESOURCE_KEYS);
    expect(body.subject).toBe('A better subject');
    expect(body.body).toBe('A better body.');
    // Provenance is untouched, and the hashes now differ.
    expect(body.generatedSubject).toBe(created.body.generatedSubject);
    expect(body.generatedBody).toBe(created.body.generatedBody);
    expect(body.generatedBodyHash).toBe(created.body.generatedBodyHash);
    expect(body.bodyHash).not.toBe(body.generatedBodyHash);
    // And so are the recipient, the step and the evidence.
    expect(body.recipientEmail).toBe(created.body.recipientEmail);
    expect(body.step).toBe(created.body.step);
    expect(body.evidence).toEqual(created.body.evidence);
  });

  it('accepts one field on its own', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);

    const only = await edit(created.body.id, { subject: 'Just the subject' });
    expect(only.status).toBe(200);
    expect(only.body.subject).toBe('Just the subject');
    expect(only.body.body).toBe(created.body.body);
  });

  it('refuses any field outside subject and body', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);

    for (const payload of [
      { recipientEmail: 'x@y.z' }, { coachId: 'other' }, { step: 2 }, { state: 'reviewed' },
      { evidence: {} }, { generatedBody: 'rewritten' }, { policyVersion: 'P1' },
      { reviewedByOperatorId: 'somebody' }, { generatedAt: 'x' },
      { subject: 'ok', recipientEmail: 'x@y.z' },
    ]) {
      const res = await edit(created.body.id, payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect(res.body.error).toMatch(/Unknown field/);
    }
    expect((await read(created.body.id)).body).toEqual(created.body);
  });

  it('refuses an empty patch and a query parameter', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);

    const empty = await edit(created.body.id, {});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/Name what to change/);

    const q = await api('PATCH', `/api/programme-messages/${created.body.id}?force=1`, { subject: 'x' });
    expect(q.status).toBe(400);
  });

  it('404s an unknown message', async () => {
    expect((await edit('nope', { subject: 'x' })).status).toBe(404);
  });

  /**
   * EDITING IS CONTENT WORK, NOT EXECUTION. A message whose programme has since
   * become do-not-contact may still be tidied up — and doing so makes it no
   * more sendable than it was.
   */
  it('still edits after the campaign safety has changed', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    stance('do_not_contact');

    const res = await edit(created.body.id, { body: 'Tidied up.' });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Tidied up.');
    // And generating something new is still refused.
    expect((await generate(pc, coach)).status).toBe(422);
  });

  it('refuses to edit approved words', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    await review(created.body.id);

    const res = await edit(created.body.id, { body: 'Changed my mind.' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MESSAGE_NOT_EDITABLE');
    expect((await read(created.body.id)).body.body).toBe(created.body.body);
  });

  it('touches only programme_messages', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    const before = snapshot();

    await edit(created.body.id, { subject: 'New', body: 'New.' });

    expect(snapshot()).toEqual(before);
  });
});

/* ========================================================================== */
/* Review                                                                      */
/* ========================================================================== */

describe('POST /api/programme-messages/:messageId/review', () => {
  it('records the authenticated operator, and returns the resource', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);

    const { status, body } = await review(created.body.id);

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(RESOURCE_KEYS);
    expect(body.state).toBe('reviewed');
    expect(body.reviewedByOperatorId).toBe(OPERATOR);
    expect(body.reviewedAt).toEqual(expect.any(String));
    // Content is untouched by approving it.
    expect(body.subject).toBe(created.body.subject);
    expect(body.body).toBe(created.body.body);
  });

  /**
   * THE REVIEWER IS THE SESSION'S, NEVER A FIELD — and a request naming its own
   * is REFUSED rather than ignored. A client that believed it had attributed a
   * review to somebody else and got a 200 has been told something false.
   */
  it('refuses a request that names its own reviewer', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);

    for (const payload of [
      { operatorId: 'somebody-else' }, { reviewedBy: 'somebody-else' },
      { reviewedAt: '1999-01-01T00:00:00.000Z' }, { reviewedByOperatorId: 'somebody-else' },
    ]) {
      const res = await review(created.body.id, payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect(res.body.error).toMatch(/Unknown field/);
    }
    expect((await read(created.body.id)).body.state).toBe('generated');
  });

  it('is idempotent: a replay keeps the first reviewer and time', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    const first = await review(created.body.id);

    const replay = await review(created.body.id);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.body.reviewedAt).toBe(first.body.reviewedAt);
    expect(replay.body.reviewedByOperatorId).toBe(first.body.reviewedByOperatorId);
  });

  it('refuses a query parameter, and 404s an unknown message', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    expect((await api('POST', `/api/programme-messages/${created.body.id}/review?force=1`)).status)
      .toBe(400);
    expect((await review('nope')).status).toBe(404);
  });

  /**
   * REVIEW IS NOT SEND-APPROVAL, so it does not ask a live safety question —
   * the content being approved is durable, and a campaign that closed after it
   * was written does not make the words somebody read any less approved.
   */
  it('still reviews after the campaign safety has changed', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    stance('do_not_contact');

    const res = await review(created.body.id);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('reviewed');
    // And it did not make the campaign actionable.
    expect((await generate(pc, coach)).status).toBe(422);
  });

  it('touches only programme_messages', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    const before = snapshot();

    await review(created.body.id);

    expect(snapshot()).toEqual(before);
  });
});

/* ========================================================================== */
/* Parity, footprint and the negative properties                               */
/* ========================================================================== */

describe('one resource, four endpoints', () => {
  it('every endpoint returns the same key set', async () => {
    const { pc, coach } = prepared();
    const created = await generate(pc, coach);
    const fetched = await read(created.body.id);
    const edited = await edit(created.body.id, { subject: 'New' });
    const reviewed = await review(created.body.id);

    for (const [name, res] of [
      ['generate', created], ['read', fetched], ['edit', edited], ['review', reviewed],
    ]) {
      expect(res.status, name).toBeLessThan(300);
      expect(Object.keys(res.body).sort(), name).toEqual(RESOURCE_KEYS);
    }
    // The values differ where they should and nowhere else.
    expect(edited.body.subject).toBe('New');
    expect(reviewed.body.state).toBe('reviewed');
    expect(reviewed.body.generatedBody).toBe(created.body.generatedBody);
  });

  it('a step-2 message generates through the same route', async () => {
    const { pc, coach } = prepared();
    await generate(pc, coach);
    sendUnder(pc, coach);

    const { status, body } = await generate(pc, coach);
    expect(status).toBe(201);
    expect(body.step).toBe(2);
    expect(messages().map((m) => m.step).sort()).toEqual([1, 2]);
  });

  it('generation writes only programme_messages', async () => {
    const { pc, coach } = prepared();
    const before = snapshot();

    await generate(pc, coach);

    expect(snapshot()).toEqual(before);
    expect(messages()).toHaveLength(1);
  });
});
