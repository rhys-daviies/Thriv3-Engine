import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';

/**
 * D4.9 — THE WHOLE APPLICATION PATH, OVER HTTP, WITH A FAKE PROVIDER.
 *
 * ===========================================================================
 * WHAT THIS FILE IS FOR.
 *
 * Every slice from D4.4 to D4.8 was proved at the library boundary. None of it
 * had ever been reached through a request. This drives the real router over a
 * real socket and asserts the DURABLE rows afterwards:
 *
 *   review → POST → claim → freeze → fake provider → result → reconciliation
 *
 * THE TRANSPORT IS MOCKED AT ITS OWN MODULE, which is the only seam that
 * exists: `productionTransport()` returns null in this build, so the route
 * refuses every real request with 503. A test replaces that one function; the
 * orchestrator, the route and every authority underneath are the real ones.
 *
 * NOTHING HERE SENDS AN EMAIL. `fakeTransport` opens no socket to anybody.
 * ===========================================================================
 */

const { transportBehaviour } = vi.hoisted(() => ({
  transportBehaviour: { current: null, calls: [], reconcileThrows: false },
}));

vi.mock('../lib/productionTransport.js', async () => {
  const { fakeTransport } = await import('../lib/outboundTransport.js');
  return {
    productionTransport() {
      if (!transportBehaviour.current) return null;
      const inner = fakeTransport(transportBehaviour.current);
      return {
        ...inner,
        async send(request) {
          transportBehaviour.calls.push({ ...request });
          return inner.send(request);
        },
      };
    },
  };
});

/** The reconciliation-failure case needs the same partial-mock trick. */
vi.mock('../lib/contactAttempts.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    reconcileProgrammeContactAttempt(...args) {
      if (transportBehaviour.reconcileThrows) {
        const err = new Error('the attempt could not be reconciled');
        err.code = 'TEST_RECONCILE_EXPLODED';
        throw err;
      }
      return real.reconcileProgrammeContactAttempt(...args);
    },
  };
});

const { campaignsRouter } = await import('./campaigns.js');
const { materialiseNextContactAttempt } = await import('../lib/pursuitPolicy.js');
const { attemptForCoach } = await import('../lib/contactAttempts.js');
const { reviewProgrammeMessage, programmeMessage, editProgrammeMessage } = await import('../lib/programmeMessages.js');
const { generateProgrammeMessage } = await import('../lib/programmeMessageGeneration.js');
const { sendById, sendEvents } = await import('../lib/outreachSend.js');
const { TRANSPORT_OUTCOME } = await import('../lib/outboundTransport.js');
const { createConnectedMailbox, storeMailboxCredential } = await import('../lib/connectedMailboxes.js');
const { suppress } = await import('../lib/suppressions.js');

const ATHLETE = 'a-execapi';
const OTHER_ATHLETE = 'a-execapi-2';
const OPERATOR = 'op-execapi';
const OTHER_OPERATOR = 'op-execapi-2';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let baseUrl;
let currentOperator = OPERATOR;
let seq = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (currentOperator) req.operator = { id: currentOperator, email: `${currentOperator}@t.test` };
    next();
  });
  /** Stands in for `requireOperator`, which guards every real /api route. */
  app.use('/api', (req, res, next) => {
    if (!req.operator) return res.status(401).json({ error: 'Sign in required.' });
    return next();
  });
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
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
};

const send = (id, body) => api('POST', `/api/programme-messages/${id}/send`, body);
const readiness = (id, q = '') => api('GET', `/api/programme-messages/${id}/execution-readiness${q}`);

/* -------------------------------------------------------------------------- */

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(id, randomUUID().slice(0, 10));
}
function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(id, `${id}@thriv3.test`);
}
function college() {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', 'ACC')
  `).run(randomUUID(), COLLEGE, SPORT);
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
function mailboxFor({ athleteId = ATHLETE, operatorId = OPERATOR } = {}) {
  const box = createConnectedMailbox({
    operatorUserId: operatorId, athleteId, provider: 'GOOGLE',
    providerAccountId: randomUUID(), emailAddress: `mb${++seq}@example.com`,
  });
  storeMailboxCredential(box.id, { refreshToken: `rt-${seq}`, operatorUserId: operatorId });
  return box.id;
}

/** A reviewed message with a usable mailbox — the state a send starts from. */
function reviewed({ athleteId = ATHLETE } = {}) {
  const c = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)
  `).run(c, athleteId);
  const pc = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(pc, c, COLLEGE, SPORT, ++seq);
  const coaches = [0, 1].map((i) => {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
      VALUES (?, 'x', ?, ?, ?, 'NCAA D1', ?, ?)
    `).run(id, `Coach ${++seq}`, `k${seq}@duke.edu`, COLLEGE, SPORT,
      i === 0 ? 'Head Coach' : 'Assistant Coach');
    return id;
  });
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0] });
  reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
  const row = programmeMessage(message.id);
  return { c, pc, coaches, head: coaches[0], messageId: row.id, bodyHash: row.body_hash };
}

/** Prepared and composed, deliberately NOT approved. */
function generatedNotReviewed() {
  const c = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)
  `).run(c, ATHLETE);
  const pc = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(pc, c, COLLEGE, SPORT, ++seq);
  const coachId = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, 'x', 'Coach U', ?, ?, 'NCAA D1', ?, 'Head Coach')
  `).run(coachId, `unrev${++seq}@duke.edu`, COLLEGE, SPORT);
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId });
  return { pc, coachId, messageId: message.id };
}

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const rows = (t) => db.prepare(`SELECT * FROM ${t}`).all();

beforeEach(() => {
  transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
  transportBehaviour.calls = [];
  transportBehaviour.reconcileThrows = false;
  currentOperator = OPERATOR;
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes;
           DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM coaches; DELETE FROM colleges; DELETE FROM roster_players;
           DELETE FROM suppressions; DELETE FROM operator_users; DELETE FROM players;`);
  athlete(ATHLETE);
  athlete(OTHER_ATHLETE);
  operator(OPERATOR);
  operator(OTHER_OPERATOR);
  college();
  seq = 0;
});

/* ========================================================================== */
/* THE WHOLE PATH                                                              */
/* ========================================================================== */

describe('POST /api/programme-messages/:id/send — accepted', () => {
  it('claims, freezes, sends the frozen bytes and returns durable truth', async () => {
    const { pc, head, messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();

    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxId });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('ACCEPTED');
    expect(res.body.executionId).toBeTruthy();
    expect(res.body.provider).toBe('GOOGLE');
    expect(res.body.providerMessageId).toBe(`fake-msg-${res.body.executionId}`);
    expect(res.body.acceptedSource).toBe('PROVIDER_ACCEPTED');

    /* The response is the DATABASE, not the transport's own answer. */
    const row = sendById(res.body.executionId);
    expect(row.state).toBe('ACCEPTED');
    expect(row.provider_message_id).toBe(res.body.providerMessageId);
    expect(row.accepted_source).toBe('PROVIDER_ACCEPTED');

    /* The transport got the frozen bytes, not a regenerated body. */
    expect(transportBehaviour.calls).toHaveLength(1);
    expect(transportBehaviour.calls[0].body).toBe(row.body);
    expect(transportBehaviour.calls[0].subject).toBe(row.subject);
    expect(transportBehaviour.calls[0].idempotencyKey).toBe(row.id);
    expect(transportBehaviour.calls[0].to).toBe(programmeMessage(messageId).recipient_email);

    /* One ledger row, one event, and the attempt reconciled. */
    expect(count('outbound_send_attempt')).toBe(1);
    expect(sendEvents(row.id)).toHaveLength(1);
    expect(attemptForCoach(pc, head)).toMatchObject({ state: 'active', step: 2 });
    expect(res.body.attempt).toMatchObject({ reconciled: true, step: 2, state: 'active' });
  });

  it('never regenerates the wire content after the claim', async () => {
    const { messageId, bodyHash } = reviewed();
    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() });
    const row = sendById(res.body.executionId);

    /* The footer and the tracked link are in the frozen body the transport got. */
    expect(transportBehaviour.calls[0].body).toContain('?ref=');
    expect(transportBehaviour.calls[0].body).toContain("If you'd rather not hear from us");
    expect(transportBehaviour.calls[0].body).toBe(row.body);
    /* And the approved composition is untouched. */
    expect(programmeMessage(messageId).body).toContain('{{player_profile_url}}');
  });
});

describe('POST send — rejected and unknown', () => {
  it('returns 200 with FAILED for a definite provider refusal', async () => {
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.REJECTED };
    const { pc, head, messageId, bodyHash } = reviewed();

    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('FAILED');
    expect(sendById(res.body.executionId).state).toBe('FAILED');
    expect(sendEvents(res.body.executionId)[0].type).toBe('TRANSPORT_REJECTED');
    expect(count('outbound_send_attempt')).toBe(1);
    expect(attemptForCoach(pc, head)).toMatchObject({ state: 'planned', step: 1 });
  });

  /**
   * 200, NOT 5xx, AND THIS IS THE MOST IMPORTANT STATUS IN THE FILE. A 5xx for
   * an ambiguous send invites a client, a proxy or a service worker to retry
   * the one thing that must never be retried.
   */
  it('returns 200 with UNKNOWN_PROVIDER_RESULT for an ambiguous one', async () => {
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.UNKNOWN };
    const { messageId, bodyHash } = reviewed();

    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('UNKNOWN_PROVIDER_RESULT');
    expect(res.status).not.toBeGreaterThanOrEqual(500);
    expect(sendEvents(res.body.executionId)[0].type).toBe('TRANSPORT_UNKNOWN');
  });

  it('treats a thrown transport as unknown, not as a failure', async () => {
    transportBehaviour.current = { outcome: 'THROW' };
    const { messageId, bodyHash } = reviewed();

    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('UNKNOWN_PROVIDER_RESULT');
  });
});

/* ========================================================================== */
/* NO TRANSPORT                                                                */
/* ========================================================================== */

describe('when no transport is configured', () => {
  it('refuses with 503 before claiming anything or spending capacity', async () => {
    transportBehaviour.current = null;
    const { messageId, bodyHash } = reviewed();

    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('TRANSPORT_NOT_CONFIGURED');
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
  });

  /** The shipped module really does refuse — the mock is the exception here. */
  it('is what the shipped module actually does', async () => {
    const { productionTransport } = await import('../lib/productionTransport.js');
    // The mock replaces it for this file; assert the real source instead.
    const src = (await import('node:fs')).readFileSync(
      new URL('../lib/productionTransport.js', import.meta.url), 'utf8',
    );
    expect(src).toMatch(/return null;/);
    /* It may DISCUSS the fake; it may not IMPORT one. */
    expect(src).not.toMatch(/^import/m);
    expect(typeof productionTransport).toBe('function');
  });
});

/* ========================================================================== */
/* STALE REVIEW                                                                */
/* ========================================================================== */

describe('the reviewed-composition precondition', () => {
  it('accepts the hash the client was shown', async () => {
    const { messageId, bodyHash } = reviewed();
    expect((await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() })).status).toBe(200);
  });

  it('refuses a stale hash with 409, before claim, budget or transport', async () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();

    const res = await send(messageId, { bodyHash: 'whatever-the-client-had', connectedMailboxId: mailboxId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MESSAGE_REVIEW_CHANGED');
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  /** The real staleness: edited and re-reviewed through the legitimate path. */
  it('refuses a hash that was current before a legitimate edit', async () => {
    const c = `camp-${++seq}`;
    db.prepare(`
      INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
        snapshot_taken_at, programme_count)
      VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)
    `).run(c, ATHLETE);
    const pc = `pc-${++seq}`;
    db.prepare(`
      INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
        tier, tier_source, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 82, 'A', 'AUTO', 'queued', 'x', 'x')
    `).run(pc, c, COLLEGE, SPORT);
    const coachId = randomUUID();
    db.prepare(`
      INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
      VALUES (?, 'x', 'Coach E', ?, ?, 'NCAA D1', ?, 'Head Coach')
    `).run(coachId, `edit${++seq}@duke.edu`, COLLEGE, SPORT);
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId });

    const staleHash = programmeMessage(message.id).body_hash;
    editProgrammeMessage(message.id, { body: 'Different approved words. {{player_profile_url}}' });
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
    expect(programmeMessage(message.id).body_hash).not.toBe(staleHash);

    const res = await send(message.id, { bodyHash: staleHash, connectedMailboxId: mailboxFor() });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MESSAGE_REVIEW_CHANGED');
    expect(count('outreach_send')).toBe(0);
  });

  it('refuses a message nobody has approved', async () => {
    const { messageId } = generatedNotReviewed();
    const res = await send(messageId, {
      bodyHash: programmeMessage(messageId).body_hash, connectedMailboxId: mailboxFor(),
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MESSAGE_NOT_REVIEWED');
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(transportBehaviour.calls).toHaveLength(0);
  });
});

/* ========================================================================== */
/* REPLAY AND CONCURRENCY                                                      */
/* ========================================================================== */

describe('sending the same message twice', () => {
  it('executes once and names the conflict on the second request', async () => {
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();

    const first = await send(messageId, { bodyHash, connectedMailboxId: mailboxId });
    const second = await send(messageId, { bodyHash, connectedMailboxId: mailboxId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('MESSAGE_ALREADY_EXECUTED');
    /* Never a database error used as an API contract. */
    expect(JSON.stringify(second.body)).not.toMatch(/SQLITE|constraint/i);

    expect(count('outreach_send')).toBe(1);
    expect(count('outbound_send_attempt')).toBe(1);
    expect(transportBehaviour.calls).toHaveLength(1);
    expect(sendEvents(first.body.executionId)).toHaveLength(1);
  });

  /**
   * TWO REQUESTS IN FLIGHT AT ONCE, over real sockets. The harness can prove
   * this because the router is bound to a port and `fetch` is concurrent; the
   * database invariant does the work and the application translates it.
   */
  it('lets exactly one of two simultaneous requests through', async () => {
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();

    const [a, b] = await Promise.all([
      send(messageId, { bodyHash, connectedMailboxId: mailboxId }),
      send(messageId, { bodyHash, connectedMailboxId: mailboxId }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect(['MESSAGE_ALREADY_EXECUTED', 'SEND_CLAIM_LOST']).toContain(loser.body.code);
    expect(JSON.stringify(loser.body)).not.toMatch(/SQLITE|constraint/i);

    /* One of everything. */
    expect(count('outreach_send')).toBe(1);
    expect(count('outbound_send_attempt')).toBe(1);
    expect(transportBehaviour.calls).toHaveLength(1);
    expect(sendEvents(winner.body.executionId)).toHaveLength(1);
  });
});

/* ========================================================================== */
/* FOLLOW-UP                                                                   */
/* ========================================================================== */

describe('the follow-up, over HTTP', () => {
  async function afterFirstSend() {
    const ctx = reviewed();
    const mailboxId = mailboxFor();
    const first = await send(ctx.messageId, { bodyHash: ctx.bodyHash, connectedMailboxId: mailboxId });
    expect(first.status).toBe(200);
    const { message: m2 } = generateProgrammeMessage({
      programmeCampaignId: ctx.pc, coachId: ctx.head,
    });
    reviewProgrammeMessage(m2.id, { operatorId: OPERATOR });
    return { ...ctx, mailboxId, followUpId: m2.id, followUpHash: programmeMessage(m2.id).body_hash };
  }

  it('activates the attempt at step 2 after the first acceptance', async () => {
    const { pc, head } = await afterFirstSend();
    expect(attemptForCoach(pc, head)).toMatchObject({ state: 'active', step: 2 });
  });

  it('refuses a premature follow-up with 422, spending nothing', async () => {
    const { followUpId, followUpHash, mailboxId } = await afterFirstSend();
    const ledgerBefore = count('outbound_send_attempt');
    const callsBefore = transportBehaviour.calls.length;

    const res = await send(followUpId, { bodyHash: followUpHash, connectedMailboxId: mailboxId });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FOLLOW_UP_NOT_DUE');
    expect(count('outbound_send_attempt')).toBe(ledgerBefore);
    expect(transportBehaviour.calls).toHaveLength(callsBefore);
    expect(db.prepare("SELECT COUNT(*) n FROM outreach_send WHERE state='SENDING'").get().n).toBe(0);
  });

  /**
   * THE ELIGIBLE CASE. The clock runs from the accepted send's `sent_at`, which
   * is today here, so the fourth day is reached by moving that timestamp back
   * rather than by waiting — the same thing the timing tests do at the library
   * boundary, and the only way an HTTP test can reach it.
   */
  it('executes the follow-up once the fourth day is reached', async () => {
    const { followUpId, followUpHash, mailboxId } = await afterFirstSend();
    db.prepare("UPDATE outreach_send SET sent_at = '2026-01-01T09:00:00.000Z' WHERE state='ACCEPTED'").run();

    const res = await send(followUpId, { bodyHash: followUpHash, connectedMailboxId: mailboxId });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('ACCEPTED');
    expect(transportBehaviour.calls).toHaveLength(2);
    expect(count('outbound_send_attempt')).toBe(2);
  });
});

/* ========================================================================== */
/* UNKNOWN BLOCKS EVERYTHING AFTER IT                                          */
/* ========================================================================== */

describe('after an unresolved send', () => {
  it('blocks the next request for that coach with a named refusal', async () => {
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.UNKNOWN };
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();

    const first = await send(messageId, { bodyHash, connectedMailboxId: mailboxId });
    expect(first.body.state).toBe('UNKNOWN_PROVIDER_RESULT');

    const again = await send(messageId, { bodyHash, connectedMailboxId: mailboxId });

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('MESSAGE_ALREADY_EXECUTED');
    expect(transportBehaviour.calls).toHaveLength(1);
    expect(count('outbound_send_attempt')).toBe(1);
  });
});

/* ========================================================================== */
/* BOOKKEEPING FAILURE                                                         */
/* ========================================================================== */

describe('when reconciliation fails after acceptance', () => {
  /**
   * PROVIDER TRUTH IS PRIMARY. The email went; the campaign's step did not
   * move. The response must say the first thing, and must not be a 5xx — a
   * retry-inducing status here is how a coach gets a second copy.
   */
  it('still returns 200 ACCEPTED and reports the bookkeeping failure', async () => {
    transportBehaviour.reconcileThrows = true;
    const { messageId, bodyHash } = reviewed();

    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('ACCEPTED');
    expect(res.body.attempt).toMatchObject({
      reconciled: false, reason: 'THREW', error: 'TEST_RECONCILE_EXPLODED',
    });

    const row = sendById(res.body.executionId);
    expect(row.state).toBe('ACCEPTED');
    expect(row.provider_message_id).toBeTruthy();
    expect(sendEvents(row.id)).toHaveLength(1);
  });
});

/* ========================================================================== */
/* WHAT A CALLER MAY SAY                                                       */
/* ========================================================================== */

describe('the request body carries no execution authority', () => {
  const FORBIDDEN = [
    ['recipient', { recipientEmail: 'attacker@example.com' }],
    ['subject', { subject: 'Something nobody approved' }],
    ['body', { body: 'Words nobody read.' }],
    ['provider', { provider: 'MICROSOFT' }],
    ['athlete', { athlete_id: OTHER_ATHLETE }],
    ['campaign', { campaign_id: 'some-other-campaign' }],
    ['coach', { coachId: 'some-other-coach' }],
    ['step', { step: 9 }],
    ['sequence', { sequence: 9 }],
    ['the outcome', { state: 'ACCEPTED' }],
    ['the operator', { operatorId: OTHER_OPERATOR }],
  ];

  for (const [what, extra] of FORBIDDEN) {
    it(`refuses a request that tries to set ${what}`, async () => {
      const { messageId, bodyHash } = reviewed();
      const mailboxId = mailboxFor();

      const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxId, ...extra });

      /* Refused by name, never silently ignored. */
      expect(res.status).toBe(400);
      expect(count('outreach_send')).toBe(0);
      expect(transportBehaviour.calls).toHaveLength(0);
    });
  }

  it('requires both fields it does accept', async () => {
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();
    expect((await send(messageId, { connectedMailboxId: mailboxId })).status).toBe(400);
    expect((await send(messageId, { bodyHash })).status).toBe(400);
    expect((await send(messageId, {})).status).toBe(400);
  });

  it('takes the mailbox from the caller and still validates it itself', async () => {
    const { messageId, bodyHash } = reviewed();
    /* Another athlete's mailbox, owned by the same operator. */
    const wrongAthlete = mailboxFor({ athleteId: OTHER_ATHLETE });

    const res = await send(messageId, { bodyHash, connectedMailboxId: wrongAthlete });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAILBOX_ATHLETE_MISMATCH');
    expect(count('outbound_send_attempt')).toBe(0);
  });

  it('refuses another operator\'s mailbox', async () => {
    const { messageId, bodyHash } = reviewed();
    const theirs = mailboxFor({ operatorId: OTHER_OPERATOR });

    const res = await send(messageId, { bodyHash, connectedMailboxId: theirs });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAILBOX_NOT_FOUND');
  });

  it('refuses a mailbox id that is not one', async () => {
    const { messageId, bodyHash } = reviewed();
    const res = await send(messageId, { bodyHash, connectedMailboxId: 'x'.repeat(500) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAILBOX_NOT_FOUND');
  });
});

/* ========================================================================== */
/* AUTH, SHAPE AND WHAT LEAVES                                                 */
/* ========================================================================== */

describe('the boundary', () => {
  it('refuses an unauthenticated send', async () => {
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();
    currentOperator = null;
    try {
      const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxId });
      expect(res.status).toBe(401);
    } finally { currentOperator = OPERATOR; }
    expect(count('outreach_send')).toBe(0);
  });

  it('answers 404 for a message that does not exist', async () => {
    const res = await send(randomUUID(), { bodyHash: 'x', connectedMailboxId: mailboxFor() });
    expect(res.status).toBe(404);
  });

  it('handles malformed JSON without leaking anything', async () => {
    const { messageId } = reviewed();
    const res = await api('POST', `/api/programme-messages/${messageId}/send`, '{not json');
    expect([400, 500]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/SQLITE|refresh|ciphertext/i);
  });

  it('refuses a body that is not an object', async () => {
    const { messageId } = reviewed();
    expect((await api('POST', `/api/programme-messages/${messageId}/send`, [1, 2])).status).toBe(400);
  });

  it('refuses unknown query parameters', async () => {
    const { messageId, bodyHash } = reviewed();
    const res = await api('POST', `/api/programme-messages/${messageId}/send?force=1`,
      { bodyHash, connectedMailboxId: mailboxFor() });
    expect(res.status).toBe(400);
  });

  /** Nothing secret, and no provider or internal detail, ever leaves. */
  it('returns no credential, token or internal detail', async () => {
    const { messageId, bodyHash } = reviewed();
    const ok = await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() });
    const stale = await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() });

    for (const res of [ok, stale]) {
      const json = JSON.stringify(res.body).toLowerCase();
      for (const secret of ['refresh', 'ciphertext', 'auth_tag', 'key_version',
        'access_token', 'provider_account_id', 'sqlite', 'stack']) {
        expect(json, secret).not.toContain(secret);
      }
    }
    /* Nor the evidence payload or the body itself. */
    /**
     * D5.0 adds `transportOutcome` and `retryable`. Neither is a secret and
     * neither is derived from one: the first is the provider-neutral outcome
     * word the transport already returned, the second a boolean computed from
     * it. They are here because FAILED alone cannot tell a caller whether the
     * provider refused the message or was never reached — see the note on the
     * orchestrator's return. Every negative assertion above is unchanged and
     * still passes.
     */
    expect(Object.keys(ok.body).sort()).toEqual([
      'acceptedAt', 'acceptedSource', 'attempt', 'executionId', 'programmeMessageId',
      'provider', 'providerMessageId', 'providerThreadId', 'retryable', 'sentAt',
      'sequence', 'state', 'step', 'transportOutcome',
    ]);
  });

  /** No provider module is reachable from the execution route. */
  it('imports no real transport anywhere on the path', async () => {
    const fs = await import('node:fs');
    for (const rel of ['../lib/executeProgrammeMessage.js', '../lib/executionReadiness.js',
      '../lib/productionTransport.js', './campaigns.js']) {
      const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, rel).not.toMatch(/googleapis|google-auth|OAuth2Client|nodemailer|smtp/i);
      expect(src, rel).not.toMatch(/googleTransport|rfc822|transportSnapshot|composeInOutlook/);
      expect(src, rel).not.toMatch(/mailboxCredential|mailboxCrypto|decrypt/);
    }
  });
});

/* ========================================================================== */
/* READINESS — advisory, and it writes nothing                                 */
/* ========================================================================== */

describe('GET execution-readiness', () => {
  it('reports ready when everything is in place, minus the transport', async () => {
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();

    const res = await readiness(messageId, `?connectedMailboxId=${mailboxId}`);

    expect(res.status).toBe(200);
    expect(res.body.reviewed).toBe(true);
    expect(res.body.bodyHash).toBe(bodyHash);
    expect(res.body.connectedMailboxId).toBe(mailboxId);
    expect(res.body.plannedAction).toBe('INITIAL_OUTREACH');
    expect(res.body.advisory).toBe(true);
    expect(res.body.claimRechecksEverything).toBe(true);
    /* A transport is mocked in for this file, so nothing at all is blocking. */
    expect(res.body.blockers).toEqual([]);
    expect(res.body.readyNow).toBe(true);
  });

  /**
   * AND IT TELLS THE TRUTH ABOUT THIS BUILD when the transport is what it
   * really is. `readyNow` must be false while nothing can send, or a screen
   * would offer a button that always 503s.
   */
  it('reports the missing transport as a blocker when there is none', async () => {
    transportBehaviour.current = null;
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();

    const res = await readiness(messageId, `?connectedMailboxId=${mailboxId}`);

    expect(res.body.blockers.map((b) => b.code)).toEqual(['TRANSPORT_NOT_CONFIGURED']);
    expect(res.body.readyNow).toBe(false);
  });

  it('writes nothing and spends nothing, however many times it is asked', async () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const TABLES = ['outreach', 'outreach_send', 'outbound_send_attempt',
      'programme_messages', 'programme_contact_attempts', 'outreach_send_event'];
    const before = Object.fromEntries(TABLES.map((t) => [t, JSON.stringify(rows(t))]));

    for (let i = 0; i < 3; i += 1) await readiness(messageId, `?connectedMailboxId=${mailboxId}`);

    for (const t of TABLES) expect(JSON.stringify(rows(t)), t).toBe(before[t]);
  });

  it('names a missing mailbox rather than choosing one', async () => {
    const { messageId } = reviewed();
    mailboxFor();
    const res = await readiness(messageId);
    expect(res.body.blockers.map((b) => b.code)).toContain('MAILBOX_REQUIRED');
    expect(res.body.connectedMailboxId).toBe(null);
  });

  it('reports the follow-up date rather than only refusing', async () => {
    const ctx = reviewed();
    const mailboxId = mailboxFor();
    await send(ctx.messageId, { bodyHash: ctx.bodyHash, connectedMailboxId: mailboxId });
    const { message: m2 } = generateProgrammeMessage({
      programmeCampaignId: ctx.pc, coachId: ctx.head,
    });
    reviewProgrammeMessage(m2.id, { operatorId: OPERATOR });

    const res = await readiness(m2.id, `?connectedMailboxId=${mailboxId}`);
    const blocker = res.body.blockers.find((b) => b.code === 'FOLLOW_UP_NOT_DUE');

    expect(blocker).toBeTruthy();
    expect(blocker.nextEligibleOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.followUpEligibleOn).toBe(blocker.nextEligibleOn);
  });

  it('reports an unresolved relationship and an already-executed message', async () => {
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.UNKNOWN };
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();
    await send(messageId, { bodyHash, connectedMailboxId: mailboxId });

    const res = await readiness(messageId, `?connectedMailboxId=${mailboxId}`);
    const codes = res.body.blockers.map((b) => b.code);

    expect(codes).toContain('MESSAGE_ALREADY_EXECUTED');
    expect(codes).toContain('RELATIONSHIP_HAS_UNRESOLVED_SEND');
    expect(res.body.readyNow).toBe(false);
  });

  it('reports every mailbox problem it finds', async () => {
    const { messageId } = reviewed();
    const theirs = mailboxFor({ operatorId: OTHER_OPERATOR });
    expect((await readiness(messageId, `?connectedMailboxId=${theirs}`)).body.blockers
      .map((b) => b.code)).toContain('MAILBOX_NOT_FOUND');

    const wrongAthlete = mailboxFor({ athleteId: OTHER_ATHLETE });
    expect((await readiness(messageId, `?connectedMailboxId=${wrongAthlete}`)).body.blockers
      .map((b) => b.code)).toContain('MAILBOX_ATHLETE_MISMATCH');
  });

  it('refuses unknown query parameters and an unknown message', async () => {
    const { messageId } = reviewed();
    expect((await readiness(messageId, '?force=1')).status).toBe(400);
    expect((await readiness(randomUUID())).status).toBe(404);
  });

  /** A readiness answer is not permission: the claim asks everything again. */
  it('does not let a ready answer skip the claim\'s own checks', async () => {
    const fs = await import('node:fs');
    /**
     * IMPORTS, not prose: both files DISCUSS the advisory layers at length,
     * explaining why they are not on this path. What must not exist is a
     * dependency.
     */
    const importsOf = (rel) => (fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
      .match(/^import[\s\S]*?from\s*'[^']+';/gm) ?? []).join('\n');

    expect(importsOf('../lib/executionClaim.js'))
      .not.toMatch(/executionReadiness|executionDecision|executionResolution/);
    expect(importsOf('../lib/executeProgrammeMessage.js')).not.toMatch(/executionReadiness/);

    /* And a stale ready answer still cannot send a suppressed message. */
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();
    const ready = await readiness(messageId, `?connectedMailboxId=${mailboxId}`);
    expect(ready.body.readyNow).toBe(true);

    /* Through the real authority, not raw SQL. */
    suppress({ email: programmeMessage(messageId).recipient_email, reason: 'unsubscribed' });

    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxId });
    expect(res.status).toBe(422);
    expect(count('outbound_send_attempt')).toBe(0);
  });
});
