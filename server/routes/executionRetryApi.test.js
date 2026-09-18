import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';

/**
 * D5.0 — A SEND THAT PROVABLY NEVER HAPPENED, AND THE ONE WAY TO TRY AGAIN.
 *
 * ===========================================================================
 * WHAT THIS FILE IS FOR.
 *
 * D4.9 proved the application path end to end with a fake provider. This
 * proves the fourth outcome and everything that follows from it, over the same
 * real router and real sockets:
 *
 *   send → transport refuses before submitting → FAILED, capacity released
 *        → explicit retry → every safety rule re-asked → a NEW reservation
 *        → accepted, and paid for exactly once
 *
 * THE TWO THINGS MOST WORTH BREAKING, and therefore most tested:
 *
 *   1  an AMBIGUOUS send being treated as a proven non-send. It may be in the
 *      coach's inbox. It must never be retried, never release capacity, and
 *      never be mistaken for the case below.
 *   2  a retry skipping a safety rule because "it passed this morning". The
 *      campaign, the stance, the cap, the clock and the mailbox are all re-
 *      established, because the world moves between a refusal and a retry.
 *
 * NOTHING HERE SENDS AN EMAIL. `fakeTransport` opens no socket to anybody, and
 * there is no Gmail, Graph, credential or token anywhere in this slice.
 * ===========================================================================
 */

const { transportBehaviour } = vi.hoisted(() => ({
  transportBehaviour: { current: null, calls: [], sendEnabled: true },
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

/**
 * D5.2 — THIS TEST DEPLOYMENT DECLARES ITSELF SEND-ENABLED, EXPLICITLY.
 *
 * The real `providerCapability` reads `THRIV3_GOOGLE_SEND_ENABLED`, which is
 * absent here as it is absent on any machine that has not deliberately switched
 * real email on. Without this, every test below would refuse with 503
 * PROVIDER_SEND_DISABLED before reaching the engine — passing, and proving
 * nothing about the engine.
 *
 * So the switch is declared on, in the open, through the same object that
 * controls the fake transport. Flipping `sendEnabled` to false falls back to
 * the REAL authority, which is how the disabled-deployment tests prove the
 * production behaviour rather than a mock of it.
 */
vi.mock('../lib/providerCapability.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    providerCapability(provider, config) {
      if (!transportBehaviour.sendEnabled) return real.providerCapability(provider, config);
      return Object.freeze({
        provider, implemented: true, configured: true, sendEnabled: true, refusal: null,
      });
    },
  };
});


const { campaignsRouter } = await import('./campaigns.js');
const { materialiseNextContactAttempt } = await import('../lib/pursuitPolicy.js');
const { reviewProgrammeMessage, programmeMessage } = await import('../lib/programmeMessages.js');
const { generateProgrammeMessage } = await import('../lib/programmeMessageGeneration.js');
const { sendById, sendEvents } = await import('../lib/outreachSend.js');
const { TRANSPORT_OUTCOME } = await import('../lib/outboundTransport.js');
const {
  OUTBOUND_ATTEMPT_DISPOSITION, athleteUsage, mailboxUsage,
} = await import('../lib/outboundBudget.js');
const { createConnectedMailbox, storeMailboxCredential, revokeMailbox } = await import('../lib/connectedMailboxes.js');
const { suppress } = await import('../lib/suppressions.js');
const { closeCampaign } = await import('../lib/campaigns.js');
const { SEND_EVENT_TYPE, MESSAGE_STATE } = await import('../../shared/outreachMessageState.js');

const ATHLETE = 'a-d50api';
const OTHER_ATHLETE = 'a-d50api-2';
const OPERATOR = 'op-d50api';
const OTHER_OPERATOR = 'op-d50api-2';
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
const retry = (sendId, body) => api('POST', `/api/outreach-sends/${sendId}/retry`, body);

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
  return {
    c, pc, coaches, head: coaches[0], messageId: row.id, bodyHash: row.body_hash,
    mailboxId: mailboxFor({ athleteId }),
  };
}

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const rows = (t) => db.prepare(`SELECT * FROM ${t}`).all();
const ledger = () => db.prepare('SELECT * FROM outbound_send_attempt ORDER BY attempted_at, id').all();
const types = (id) => sendEvents(id).map((e) => e.type);

/** Send once and have the transport prove it never submitted anything. */
async function refusedSend(fixture = null) {
  const f = fixture ?? reviewed();
  transportBehaviour.current = {
    outcome: TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT,
    reason: 'PRE_TRANSPORT_CONFIGURATION',
  };
  const res = await send(f.messageId, { bodyHash: f.bodyHash, connectedMailboxId: f.mailboxId });
  return { ...f, res, sendId: res.body.executionId };
}

beforeEach(() => {
  transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
  transportBehaviour.calls = [];
  transportBehaviour.sendEnabled = true;
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
/* A — the fourth outcome, over HTTP                                           */
/* ========================================================================== */

describe('A. a transport that proves it never submitted', () => {
  it('records FAILED with a TRANSPORT_REFUSED event and releases the capacity', async () => {
    const f = await refusedSend();

    /**
     * 200, NOT A 5xx. The request succeeded and the answer is durable truth.
     * A 5xx would invite a proxy or a client to retry automatically, and the
     * only retry this system permits is one somebody asked for.
     */
    expect(f.res.status).toBe(200);
    expect(f.res.body.state).toBe(MESSAGE_STATE.FAILED);
    expect(f.res.body.transportOutcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(f.res.body.retryable).toBe(true);

    const row = sendById(f.sendId);
    expect(row.state).toBe(MESSAGE_STATE.FAILED);

    /* The event is its own type, not a rejection. */
    expect(types(f.sendId)).toEqual([SEND_EVENT_TYPE.TRANSPORT_REFUSED]);
    const [event] = sendEvents(f.sendId);
    expect(event.source).toBe('PROVIDER_TRANSPORT');
    expect(event.payload.reason).toBe('PRE_TRANSPORT_CONFIGURATION');

    /* One ledger row, still on file, and no longer counting. */
    const book = ledger();
    expect(book).toHaveLength(1);
    expect(book[0].disposition).toBe(OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);
    expect(athleteUsage(ATHLETE)).toBe(0);
  });

  it('writes no provider metadata, because there was no provider interaction', async () => {
    const f = await refusedSend();
    const row = sendById(f.sendId);
    expect(row.provider_message_id).toBeNull();
    expect(row.provider_thread_id).toBeNull();
    expect(row.provider_accepted_at).toBeNull();
    expect(row.internet_message_id).toBeNull();
    expect(row.accepted_source).toBeNull();
    expect(row.sent_at).toBeNull();
    expect(f.res.body.providerMessageId).toBeNull();
    expect(f.res.body.acceptedAt).toBeNull();
  });

  it('advances no campaign step and starts no follow-up clock', async () => {
    const f = await refusedSend();
    const [attempt] = rows('programme_contact_attempts');
    /* Still step 1, still the planned/active attempt it was — nothing moved. */
    expect(attempt.step).toBe(1);
    expect(f.res.body.attempt).toBeNull();
    /* And no ACCEPTED row exists to anchor a four-day wait on. */
    expect(rows('outreach_send').filter((r) => r.state === MESSAGE_STATE.ACCEPTED)).toHaveLength(0);
  });

  it('is not a rejection, and a rejection is not it', async () => {
    const f = reviewed();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.REJECTED };
    const res = await send(f.messageId, { bodyHash: f.bodyHash, connectedMailboxId: f.mailboxId });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe(MESSAGE_STATE.FAILED);              // the same state
    expect(res.body.retryable).toBe(false);                          // and not retryable
    expect(types(res.body.executionId)).toEqual([SEND_EVENT_TYPE.TRANSPORT_REJECTED]);
    /* The provider was reached and answered, so the capacity was spent. */
    expect(ledger()[0].disposition).toBe(OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);
    expect(athleteUsage(ATHLETE)).toBe(1);
  });

  it('settles an ambiguous send as consumed, never released', async () => {
    const f = reviewed();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.UNKNOWN };
    const res = await send(f.messageId, { bodyHash: f.bodyHash, connectedMailboxId: f.mailboxId });

    expect(res.body.state).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(res.body.retryable).toBe(false);
    expect(ledger()[0].disposition).toBe(OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);
    expect(athleteUsage(ATHLETE)).toBe(1);
    expect(mailboxUsage(rows('connected_mailboxes')[0].email_address)).toBe(1);
  });

  it('settles an acceptance as consumed, in the same transaction as the acceptance', async () => {
    const f = reviewed();
    const res = await send(f.messageId, { bodyHash: f.bodyHash, connectedMailboxId: f.mailboxId });

    expect(res.body.state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(res.body.retryable).toBe(false);
    expect(ledger()[0].disposition).toBe(OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);
    /* And the acceptance is durable with its bookkeeping, as D4.8 established. */
    expect(res.body.attempt.reconciled).toBe(true);
    expect(athleteUsage(ATHLETE)).toBe(1);
  });
});

/* ========================================================================== */
/* B — who may be retried                                                      */
/* ========================================================================== */

describe('B. eligibility', () => {
  it('permits a FAILED execution whose every attempt is a proven non-send', async () => {
    const f = await refusedSend();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    const res = await retry(f.sendId);
    expect(res.status).toBe(200);
    expect(res.body.reattempt).toBe(true);
  });

  it('refuses an ambiguous send, permanently and by name', async () => {
    const f = reviewed();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.UNKNOWN };
    const first = await send(f.messageId, {
      bodyHash: f.bodyHash, connectedMailboxId: f.mailboxId,
    });

    const res = await retry(first.body.executionId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/do not know whether the provider accepted/i);
    /* Nothing moved, nothing spent. */
    expect(sendById(first.body.executionId).state).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(ledger()).toHaveLength(1);
    expect(transportBehaviour.calls).toHaveLength(1);
  });

  it('refuses a provider rejection — FAILED is not enough on its own', async () => {
    const f = reviewed();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.REJECTED };
    const first = await send(f.messageId, {
      bodyHash: f.bodyHash, connectedMailboxId: f.mailboxId,
    });
    expect(sendById(first.body.executionId).state).toBe(MESSAGE_STATE.FAILED);

    const res = await retry(first.body.executionId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/nothing on file proves it never reached a provider/i);
    expect(ledger()).toHaveLength(1);
    expect(transportBehaviour.calls).toHaveLength(1);
  });

  it('refuses an accepted send', async () => {
    const f = reviewed();
    const first = await send(f.messageId, {
      bodyHash: f.bodyHash, connectedMailboxId: f.mailboxId,
    });
    const res = await retry(first.body.executionId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/ACCEPTED/);
  });

  it('refuses an execution that does not exist', async () => {
    const res = await retry(randomUUID());
    expect(res.status).toBe(404);
  });

  it('refuses a legacy send that never went through a campaign execution', async () => {
    const f = await refusedSend();
    /* Strip the composition pointer, as every manual and historical row has. */
    db.prepare('UPDATE outreach_send SET programme_message_id = NULL WHERE id = ?').run(f.sendId);
    const res = await retry(f.sendId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not made through a campaign execution/i);
  });

  it('refuses when the refusal event is missing, even if the ledger looks right', async () => {
    const f = await refusedSend();
    /**
     * TWO INDEPENDENT RECORDS MUST AGREE. Either alone would be enough on a
     * correct system; requiring both means one wrong write cannot license a
     * resend of a message that may have gone.
     */
    db.prepare('DELETE FROM outreach_send_event WHERE outreach_send_id = ?').run(f.sendId);
    const res = await retry(f.sendId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/nothing on file proves/i);
  });

  it('refuses while any attempt is still unsettled', async () => {
    const f = await refusedSend();
    /* A round that never reported back — a crashed process. Fail closed. */
    db.prepare('UPDATE outbound_send_attempt SET disposition = ? WHERE outreach_send_id = ?')
      .run(OUTBOUND_ATTEMPT_DISPOSITION.RESERVED, f.sendId);
    const res = await retry(f.sendId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/nothing on file proves/i);
  });

  it('leaves MESSAGE_ALREADY_EXECUTED exactly as it was', async () => {
    const f = await refusedSend();
    /* The ordinary send path still refuses a second execution of the message. */
    const again = await send(f.messageId, {
      bodyHash: f.bodyHash, connectedMailboxId: f.mailboxId,
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already been executed/i);
    expect(count('outreach_send')).toBe(1);
  });
});

/* ========================================================================== */
/* C — the world is re-examined                                                */
/* ========================================================================== */

describe('C. today’s rules, not this morning’s', () => {
  const blocked = async (mutate) => {
    const f = await refusedSend();
    const before = ledger().length;
    transportBehaviour.calls = [];
    mutate(f);
    const res = await retry(f.sendId);
    return { f, res, before };
  };

  it('re-checks suppression', async () => {
    const { res, before } = await blocked((f) => {
      const coach = db.prepare('SELECT email FROM coaches WHERE id = ?').get(f.head);
      suppress({ email: coach.email, reason: 'unsubscribed', source: 'manual' });
    });
    expect(res.status).toBe(422);
    expect(ledger()).toHaveLength(before);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('re-checks the campaign being open', async () => {
    const { res, before } = await blocked((f) => closeCampaign(f.c, { reason: 'operator' }));
    expect(res.status).toBe(422);
    expect(ledger()).toHaveLength(before);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('re-checks the contact stance', async () => {
    const { res } = await blocked(() => {
      db.prepare(`
        INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
          flagged, visibility, contact_stance, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'none', 0, 'default', 'do_not_contact', 'x', 'x')
      `).run(randomUUID(), ATHLETE, COLLEGE, SPORT);
    });
    expect(res.status).toBe(422);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('re-checks that the coach’s address has not moved', async () => {
    const { res } = await blocked((f) => {
      db.prepare('UPDATE coaches SET email = ? WHERE id = ?')
        .run(`moved${randomUUID().slice(0, 6)}@duke.edu`, f.head);
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/address has changed/i);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('re-checks the mailbox', async () => {
    const { res } = await blocked((f) => {
      revokeMailbox(f.mailboxId, { operatorUserId: OPERATOR });
    });
    expect(res.status).toBe(422);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('re-checks the budget, and a refusal spends nothing new', async () => {
    const f = await refusedSend();
    const before = ledger().length;
    transportBehaviour.calls = [];
    /**
     * Fill the mailbox's day with rows that DO count, so the released one
     * cannot pay for the retry.
     */
    const identity = rows('connected_mailboxes')[0].email_address.trim().toLowerCase();
    for (let i = 0; i < 60; i += 1) {
      db.prepare(`
        INSERT INTO outbound_send_attempt
          (id, outreach_id, athlete_id, sending_identity, transport, attempted_at, created_at,
           disposition)
        VALUES (?, NULL, ?, ?, 'PROVIDER_API', ?, ?, ?)
      `).run(randomUUID(), ATHLETE, identity, new Date().toISOString(),
        new Date().toISOString(), OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);
    }

    const res = await retry(f.sendId);
    expect(res.status).toBe(422);
    expect(transportBehaviour.calls).toHaveLength(0);
    /* The reclaim rolled back: no new reservation for this message. */
    expect(ledger().filter((r) => r.outreach_send_id === f.sendId)).toHaveLength(before);
    expect(sendById(f.sendId).state).toBe(MESSAGE_STATE.FAILED);
  });

  it('refuses a caller from another operator without naming the message', async () => {
    const f = await refusedSend();
    currentOperator = OTHER_OPERATOR;
    const res = await retry(f.sendId);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No connected mailbox of that id belongs to this operator/i);
    expect(transportBehaviour.calls).toHaveLength(1);   // only the original send
  });

  it('refuses an unauthenticated caller', async () => {
    const f = await refusedSend();
    currentOperator = null;
    const res = await retry(f.sendId);
    expect(res.status).toBe(401);
  });
});

/* ========================================================================== */
/* D — what a retry may not change                                             */
/* ========================================================================== */

describe('D. the same execution, not a new one', () => {
  it('sends the frozen bytes again, regenerating nothing', async () => {
    const f = await refusedSend();
    const frozen = sendById(f.sendId);
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    transportBehaviour.calls = [];

    /* Move every mutable input the wire body is built from. */
    db.prepare('UPDATE players SET full_name = ?, public_slug = ? WHERE id = ?')
      .run('Someone Else Entirely', 'a-different-slug', ATHLETE);

    await retry(f.sendId);

    const [request] = transportBehaviour.calls;
    expect(request.body).toBe(frozen.body);
    expect(request.subject).toBe(frozen.subject);
    expect(request.to).toBe(frozen.recipient_email ?? request.to);
    expect(request.idempotencyKey).toBe(f.sendId);

    /* And the row's own frozen fields are untouched by the re-attempt. */
    const after = sendById(f.sendId);
    expect(after.body).toBe(frozen.body);
    expect(after.wire_body_sha256).toBe(frozen.wire_body_sha256);
    expect(after.body_hash).toBe(frozen.body_hash);
    expect(after.subject).toBe(frozen.subject);
  });

  it('reuses the same outreach_send row and creates no second one', async () => {
    const f = await refusedSend();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    const res = await retry(f.sendId);

    expect(res.body.executionId).toBe(f.sendId);
    expect(count('outreach_send')).toBe(1);
    expect(sendById(f.sendId).sequence).toBe(1);
  });

  it('keeps the frozen mailbox and refuses a substitute', async () => {
    const f = await refusedSend();
    const other = mailboxFor();
    /**
     * The endpoint accepts no body at all, so a caller cannot even offer one —
     * and the authority underneath refuses a mismatch if anything ever did.
     */
    const res = await retry(f.sendId, { connectedMailboxId: other });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown field/i);
    expect(sendById(f.sendId).connected_mailbox_id).toBe(f.mailboxId);
  });

  it('accepts no caller content of any kind', async () => {
    const f = await refusedSend();
    for (const field of ['recipient', 'to', 'subject', 'body', 'bodyHash', 'provider',
      'athleteId', 'campaignId', 'coachId', 'step', 'sequence', 'outcome', 'operatorUserId',
      'disposition', 'state']) {
      const res = await retry(f.sendId, { [field]: 'x' });
      expect(res.status, field).toBe(400);
    }
    expect(transportBehaviour.calls).toHaveLength(1);
  });

  it('takes no query parameters', async () => {
    const f = await refusedSend();
    const res = await api('POST', `/api/outreach-sends/${f.sendId}/retry?force=1`);
    expect(res.status).toBe(400);
  });
});

/* ========================================================================== */
/* E — the arithmetic across attempts                                          */
/* ========================================================================== */

describe('E. paying for it exactly once', () => {
  it('leaves three ledger rows for two refusals and an acceptance, one consuming', async () => {
    const f = await refusedSend();
    expect(athleteUsage(ATHLETE)).toBe(0);

    /* Second attempt: refused again. */
    transportBehaviour.current = {
      outcome: TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT, reason: 'PRE_TRANSPORT_CONFIGURATION',
    };
    const second = await retry(f.sendId);
    expect(second.status).toBe(200);
    expect(second.body.retryable).toBe(true);
    expect(athleteUsage(ATHLETE)).toBe(0);

    /* Third: it works. */
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    const third = await retry(f.sendId);
    expect(third.status).toBe(200);
    expect(third.body.state).toBe(MESSAGE_STATE.ACCEPTED);

    const book = ledger().filter((r) => r.outreach_send_id === f.sendId);
    expect(book).toHaveLength(3);
    expect(book.map((r) => r.disposition)).toEqual([
      OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT,
      OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT,
      OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS,
    ]);
    /* Three attempts on the record; one day of capacity spent. */
    expect(athleteUsage(ATHLETE)).toBe(1);
    expect(count('outreach_send')).toBe(1);
    expect(transportBehaviour.calls).toHaveLength(3);
  });

  it('accumulates the events, so the whole history is readable', async () => {
    const f = await refusedSend();
    transportBehaviour.current = {
      outcome: TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT, reason: 'PRE_TRANSPORT_CONFIGURATION',
    };
    await retry(f.sendId);
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    await retry(f.sendId);

    expect(types(f.sendId)).toEqual([
      SEND_EVENT_TYPE.TRANSPORT_REFUSED,
      SEND_EVENT_TYPE.TRANSPORT_REFUSED,
      SEND_EVENT_TYPE.ACCEPTED,
    ]);
  });

  it('reconciles the campaign step only when the retry is accepted', async () => {
    const f = await refusedSend();
    expect(rows('programme_contact_attempts')[0].step).toBe(1);

    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    const res = await retry(f.sendId);
    expect(res.body.attempt.reconciled).toBe(true);
    expect(rows('programme_contact_attempts')[0].step).toBe(2);
  });

  it('a retry that comes back UNKNOWN is then unretryable for ever', async () => {
    const f = await refusedSend();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.UNKNOWN };
    const second = await retry(f.sendId);
    expect(second.body.state).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(second.body.retryable).toBe(false);

    const third = await retry(f.sendId);
    expect(third.status).toBe(409);
    /* And the ambiguous attempt kept its capacity. */
    expect(athleteUsage(ATHLETE)).toBe(1);
  });
});

/* ========================================================================== */
/* F — two callers at once                                                     */
/* ========================================================================== */

describe('F. concurrency', () => {
  it('gives exactly one winner, one reservation and one transport call', async () => {
    const f = await refusedSend();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    transportBehaviour.calls = [];

    const [a, b] = await Promise.all([retry(f.sendId), retry(f.sendId)]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([200, 409]);
    expect(transportBehaviour.calls).toHaveLength(1);
    expect(count('outreach_send')).toBe(1);
    expect(ledger().filter((r) => r.outreach_send_id === f.sendId)).toHaveLength(2);

    /* The loser is told what happened, in words, with no SQLite in them. */
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toBeTruthy();
    expect(JSON.stringify(loser.body)).not.toMatch(/SQLITE|sqlite|constraint|UNIQUE/);
  });

  it('never lets a simultaneous send and retry both reach the provider', async () => {
    const f = await refusedSend();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    transportBehaviour.calls = [];

    const [sendRes, retryRes] = await Promise.all([
      send(f.messageId, { bodyHash: f.bodyHash, connectedMailboxId: f.mailboxId }),
      retry(f.sendId),
    ]);

    /* The ordinary path is refused outright — the message is already executed. */
    expect(sendRes.status).toBe(409);
    expect(retryRes.status).toBe(200);
    expect(transportBehaviour.calls).toHaveLength(1);
    expect(count('outreach_send')).toBe(1);
  });
});

/* ========================================================================== */
/* G — the boundary                                                            */
/* ========================================================================== */

describe('G. what the retry endpoint returns', () => {
  it('returns durable truth and no secrets', async () => {
    const f = await refusedSend();
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    const res = await retry(f.sendId);

    const body = JSON.stringify(res.body);
    for (const secret of ['refresh', 'ciphertext', 'auth_tag', 'key_version', 'access_token',
      'provider_account_id', 'rt-', 'sqlite', 'stack']) {
      expect(body.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    expect(res.body.executionId).toBe(f.sendId);
    expect(res.body.state).toBe(sendById(f.sendId).state);
    expect(res.body.reattempt).toBe(true);
    expect(res.body.priorAttempts).toBe(1);
  });

  it('refuses when no transport is configured, before reclaiming anything', async () => {
    const f = await refusedSend();
    const state = sendById(f.sendId);
    const before = ledger().length;

    transportBehaviour.current = null;                       // productionTransport() → null
    const res = await retry(f.sendId);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/No outbound transport is configured/i);
    /* Nothing reclaimed, nothing spent — the row is exactly as it was. */
    expect(sendById(f.sendId).state).toBe(state.state);
    expect(sendById(f.sendId).claim_run_id).toBe(state.claim_run_id);
    expect(ledger()).toHaveLength(before);
  });

  it('handles a malformed body the ordinary way', async () => {
    const f = await refusedSend();
    const res = await api('POST', `/api/outreach-sends/${f.sendId}/retry`, '{not json');
    /**
     * The production app mounts its own error handler above this router; this
     * harness deliberately does not, so express answers a body-parser failure
     * itself. What matters here is the same thing D4.9 asserts: nothing of ours
     * leaks through it.
     */
    expect([400, 500]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/SQLITE|refresh|ciphertext|auth_tag/i);
  });
});
