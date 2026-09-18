import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';

/**
 * D5.2 — A DEPLOYMENT THAT CANNOT SEND, PROVEN THROUGH THE REAL ROUTES.
 *
 * ===========================================================================
 * THE SLICE WIRES A REAL GMAIL ADAPTER. THIS FILE PROVES THAT WIRING IT
 * CHANGED NOTHING ABOUT WHAT CAN LEAVE.
 *
 * Every test here runs against the REAL `providerCapability` — no mock, no
 * injected switch — so it sees exactly what a freshly deployed server sees: a
 * Google adapter that exists, a deployment that has not enabled sending, and
 * therefore nothing that can reach a coach.
 *
 * WHAT MUST NOT HAPPEN, and is asserted every time:
 *
 *   no outreach_send row          nothing was claimed
 *   no outbound_send_attempt row  no capacity was spent
 *   no credential read            the refresh token stayed encrypted
 *   no token endpoint contacted   no access token was ever minted
 *   no UserInfo request           Google was not asked anything
 *   no Gmail request              obviously, and provably
 *
 * The spies below make the last four checkable rather than assumed: `fetch` is
 * replaced for the duration, so ANY outbound HTTP from any layer would be
 * recorded, and `mailboxCredential` is watched at its own module.
 * ===========================================================================
 */

const { spy } = vi.hoisted(() => ({ spy: { credentialReads: 0 } }));

/** Watch the one function that can decrypt a refresh token. */
vi.mock('../lib/connectedMailboxes.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    mailboxCredential(...args) {
      spy.credentialReads += 1;
      return real.mailboxCredential(...args);
    },
  };
});

const { campaignsRouter } = await import('./campaigns.js');
const { materialiseNextContactAttempt } = await import('../lib/pursuitPolicy.js');
const { reviewProgrammeMessage, programmeMessage } = await import('../lib/programmeMessages.js');
const { generateProgrammeMessage } = await import('../lib/programmeMessageGeneration.js');
const { createConnectedMailbox, storeMailboxCredential, markMailboxNeedsReconsent, mailbox, MAILBOX_STATUS } = await import('../lib/connectedMailboxes.js');
const { providerCapability } = await import('../lib/providerCapability.js');
const { MESSAGE_STATE, SEND_EVENT_TYPE } = await import('../../shared/outreachMessageState.js');
const { OUTBOUND_ATTEMPT_DISPOSITION } = await import('../lib/outboundBudget.js');

const ATHLETE = 'a-d52http';
const OPERATOR = 'op-d52http';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let baseUrl;
let currentOperator = OPERATOR;
let seq = 0;
let outboundCalls;
let realFetch;

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
  realFetch = globalThis.fetch;
});

/**
 * EVERY OUTBOUND REQUEST IS RECORDED, AND ONES TO OUR OWN TEST SERVER PASS
 * THROUGH. Anything else — a token endpoint, UserInfo, Gmail — is recorded and
 * then refused, so a leak shows up as a failed assertion rather than as a real
 * network call.
 */
function watchFetch() {
  outboundCalls = [];
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith(baseUrl)) return realFetch(url, init);
    outboundCalls.push(href);
    throw new Error(`refused outbound request in test: ${href}`);
  };
}

const api = async (method, url, body) => {
  const res = await realFetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
};

const send = (id, body) => api('POST', `/api/programme-messages/${id}/send`, body);
const retry = (sendId) => api('POST', `/api/outreach-sends/${sendId}/retry`);
const readiness = (id, q = '') => api('GET', `/api/programme-messages/${id}/execution-readiness${q}`);

/* -------------------------------------------------------------------------- */

function seedStatics() {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(ATHLETE, randomUUID().slice(0, 10));
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(OPERATOR, `${OPERATOR}@thriv3.test`);
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

function mailboxFor({ provider = 'GOOGLE' } = {}) {
  const box = createConnectedMailbox({
    operatorUserId: OPERATOR, athleteId: ATHLETE, provider,
    providerAccountId: `sub-${++seq}`, emailAddress: `mb${seq}@example.com`,
  });
  storeMailboxCredential(box.id, { refreshToken: `rt-${seq}`, operatorUserId: OPERATOR });
  return box.id;
}

function reviewed() {
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
    VALUES (?, 'x', ?, ?, ?, 'NCAA D1', ?, 'Head Coach')
  `).run(coachId, `Coach ${++seq}`, `k${seq}@duke.edu`, COLLEGE, SPORT);
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId });
  reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
  const row = programmeMessage(message.id);
  return { messageId: row.id, bodyHash: row.body_hash, coachId };
}

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

beforeEach(() => {
  currentOperator = OPERATOR;
  spy.credentialReads = 0;
  watchFetch();
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
  seedStatics();
  seq = 0;
});

/* ========================================================================== */
/* A — the deployment this build ships as                                      */
/* ========================================================================== */

describe('A. this deployment cannot send', () => {
  it('reports Google as implemented, unconfigured and not send-enabled', () => {
    const cap = providerCapability('GOOGLE');
    expect(cap.implemented).toBe(true);
    expect(cap.sendEnabled).toBe(false);
    expect(cap.refusal).toBeTruthy();
  });
});

/* ========================================================================== */
/* B — the send endpoint stops before everything                               */
/* ========================================================================== */

describe('B. POST .../send while sending is not enabled', () => {
  it('refuses 503 and creates no execution, no reservation, no anything', async () => {
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();

    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxId });

    expect(res.status).toBe(503);
    expect(['PROVIDER_SEND_DISABLED', 'PROVIDER_NOT_CONFIGURED']).toContain(res.body.code);

    /* Nothing was claimed. */
    expect(count('outreach_send')).toBe(0);
    expect(count('outreach_send_event')).toBe(0);
    /* Nothing was spent. */
    expect(count('outbound_send_attempt')).toBe(0);
    /* No relationship or tracking token was minted either. */
    expect(count('outreach')).toBe(0);
    /* No credential was read, and nothing was asked of anybody. */
    expect(spy.credentialReads).toBe(0);
    expect(outboundCalls).toEqual([]);
  });

  it('answers the caller’s own precondition first, and still claims nothing', async () => {
    /**
     * THE ORDER IS D4.9's AND D5.2 DOES NOT CHANGE IT: the stale-review check
     * is about the CALLER'S request and runs first; the capability gate is
     * about the SERVER and runs second. Both are before the claim, so either
     * way nothing is claimed and nothing is spent — which is the property that
     * matters. A 409 here is the honest answer: that request was stale whether
     * or not the server could send.
     */
    const { messageId } = reviewed();
    const res = await send(messageId, {
      bodyHash: 'not-the-hash', connectedMailboxId: mailboxFor(),
    });
    expect(res.status).toBe(409);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(spy.credentialReads).toBe(0);
    expect(outboundCalls).toEqual([]);
  });

  it('leaks no configuration detail in the refusal', async () => {
    const { messageId, bodyHash } = reviewed();
    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxFor() });
    const text = JSON.stringify(res.body);
    for (const secret of ['client_id', 'clientId', 'apps.googleusercontent', 'secret',
      'THRIV3_', 'redirect', 'rt-', 'refresh']) {
      expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
  });

  it('refuses a Microsoft mailbox for a different, permanent reason', async () => {
    const { messageId, bodyHash } = reviewed();
    const res = await send(messageId, {
      bodyHash, connectedMailboxId: mailboxFor({ provider: 'MICROSOFT' }),
    });
    /**
     * 422, NOT 503 — the refusal is permanent, so it must not read as "come
     * back later". See the note beside STATUS_BY_CODE.
     */
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAILBOX_PROVIDER_UNSUPPORTED');
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(spy.credentialReads).toBe(0);
  });

  it('still lets the claim answer for a mailbox that is not the caller’s', async () => {
    /* The configuration gate must not swallow an authorisation answer. */
    const { messageId, bodyHash } = reviewed();
    const res = await send(messageId, { bodyHash, connectedMailboxId: randomUUID() });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No connected mailbox of that id belongs to this operator/i);
  });
});

/* ========================================================================== */
/* C — the retry endpoint stops before everything                              */
/* ========================================================================== */

describe('C. POST .../retry while sending is not enabled', () => {
  /** A FAILED execution with proven-non-send evidence, written directly. */
  function refusedExecution() {
    const { messageId, coachId } = reviewed();
    const mailboxId = mailboxFor();
    const outreachId = randomUUID();
    db.prepare(`
      INSERT INTO outreach (id, created_at, athlete_id, coach_id, token)
      VALUES (?, 'x', ?, ?, ?)
    `).run(outreachId, ATHLETE, coachId, randomUUID());
    const sendId = randomUUID();
    db.prepare(`
      INSERT INTO outreach_send (id, outreach_id, sequence, athlete_id, coach_id, policy_version,
        created_at, state, programme_message_id, connected_mailbox_id, sending_identity, provider,
        subject, body, wire_body_sha256, body_hash)
      VALUES (?, ?, 1, ?, ?, 'v1', 'x', ?, ?, ?, ?, 'GOOGLE', 's', 'b', 'w', 'h')
    `).run(sendId, outreachId, ATHLETE, coachId, MESSAGE_STATE.FAILED, messageId, mailboxId,
      'mb@example.com');
    db.prepare(`
      INSERT INTO outbound_send_attempt (id, outreach_id, athlete_id, sending_identity, transport,
        attempted_at, created_at, outreach_send_id, disposition)
      VALUES (?, ?, ?, 'mb@example.com', 'PROVIDER_API', 'x', 'x', ?, ?)
    `).run(randomUUID(), outreachId, ATHLETE, sendId,
      OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);
    db.prepare(`
      INSERT INTO outreach_send_event (id, outreach_send_id, type, source, observed_at, created_at)
      VALUES (?, ?, ?, 'PROVIDER_TRANSPORT', 'x', 'x')
    `).run(randomUUID(), sendId, SEND_EVENT_TYPE.TRANSPORT_REFUSED);
    return { sendId };
  }

  it('refuses 503 and leaves the execution exactly as it was', async () => {
    const { sendId } = refusedExecution();
    const before = db.prepare('SELECT * FROM outreach_send WHERE id = ?').get(sendId);
    const ledgerBefore = count('outbound_send_attempt');

    const res = await retry(sendId);

    expect(res.status).toBe(503);
    expect(['PROVIDER_SEND_DISABLED', 'PROVIDER_NOT_CONFIGURED']).toContain(res.body.code);

    const after = db.prepare('SELECT * FROM outreach_send WHERE id = ?').get(sendId);
    /* Still FAILED — no FAILED -> QUEUED transition happened. */
    expect(after.state).toBe(MESSAGE_STATE.FAILED);
    expect(after.claim_run_id).toBe(before.claim_run_id);
    expect(after.claimed_at).toBe(before.claimed_at);
    /* No new reservation, no credential activity, no outbound request. */
    expect(count('outbound_send_attempt')).toBe(ledgerBefore);
    expect(spy.credentialReads).toBe(0);
    expect(outboundCalls).toEqual([]);
  });

  it('adds no event to the execution history', async () => {
    const { sendId } = refusedExecution();
    const before = count('outreach_send_event');
    await retry(sendId);
    expect(count('outreach_send_event')).toBe(before);
  });

  it('still answers 404 for an execution that does not exist', async () => {
    const res = await retry(randomUUID());
    expect(res.status).toBe(404);
  });
});

/* ========================================================================== */
/* D — readiness tells the truth                                               */
/* ========================================================================== */

describe('D. readiness', () => {
  it('blocks, names the server-side cause, and stays advisory', async () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const res = await readiness(messageId, `?connectedMailboxId=${mailboxId}`);

    expect(res.status).toBe(200);
    expect(res.body.readyNow).toBe(false);
    expect(res.body.blockers.map((b) => b.code))
      .toEqual(expect.arrayContaining([expect.stringMatching(/PROVIDER_(SEND_DISABLED|NOT_CONFIGURED)/)]));
    expect(res.body.advisory).toBe(true);
    expect(res.body.claimRechecksEverything).toBe(true);
    expect(res.body.providerCapability.sendEnabled).toBe(false);
  });

  it('names an unsupported provider as its own blocker', async () => {
    const { messageId } = reviewed();
    const res = await readiness(messageId,
      `?connectedMailboxId=${mailboxFor({ provider: 'MICROSOFT' })}`);
    expect(res.body.blockers.map((b) => b.code)).toContain('MAILBOX_PROVIDER_UNSUPPORTED');
  });

  it('reports a mailbox that needs reconsent', async () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    markMailboxNeedsReconsent(mailboxId, { reason: 'INVALID_GRANT', operatorUserId: OPERATOR });

    const res = await readiness(messageId, `?connectedMailboxId=${mailboxId}`);
    const codes = res.body.blockers.map((b) => b.code);
    expect(codes).toContain('MAILBOX_NEEDS_RECONSENT');
    expect(codes).toContain('MAILBOX_NOT_CONNECTED');
  });

  it('exposes no configuration secret', async () => {
    const { messageId } = reviewed();
    const res = await readiness(messageId, `?connectedMailboxId=${mailboxFor()}`);
    const text = JSON.stringify(res.body);
    for (const secret of ['client', 'secret', 'redirect', 'rt-', 'refresh', 'token', 'THRIV3_']) {
      expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
  });

  it('writes nothing and spends nothing', async () => {
    const { messageId } = reviewed();
    await readiness(messageId, `?connectedMailboxId=${mailboxFor()}`);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(spy.credentialReads).toBe(0);
  });
});

/* ========================================================================== */
/* E — needing reconsent                                                       */
/* ========================================================================== */

describe('E. markMailboxNeedsReconsent', () => {
  it('moves a CONNECTED mailbox and keeps its credential', () => {
    const id = mailboxFor();
    const out = markMailboxNeedsReconsent(id, {
      reason: 'INVALID_GRANT', operatorUserId: OPERATOR,
    });
    expect(out.changed).toBe(true);
    expect(mailbox(id, { operatorUserId: OPERATOR }).status)
      .toBe(MAILBOX_STATUS.NEEDS_RECONSENT);
    /**
     * THE CREDENTIAL ROW SURVIVES. `revokeMailbox` destroys it because the
     * athlete withdrew consent; this is the different event where the provider
     * stopped honouring a token we still hold, and keeping the row lets a
     * reconnect overwrite it through the existing authority.
     */
    expect(db.prepare('SELECT 1 FROM connected_mailbox_credentials WHERE mailbox_id = ?')
      .get(id)).toBeTruthy();
  });

  it('is idempotent', () => {
    const id = mailboxFor();
    markMailboxNeedsReconsent(id, { reason: 'INVALID_GRANT', operatorUserId: OPERATOR });
    const again = markMailboxNeedsReconsent(id, {
      reason: 'INVALID_GRANT', operatorUserId: OPERATOR,
    });
    expect(again.changed).toBe(false);
  });

  it('leaves a revoked mailbox alone', () => {
    const id = mailboxFor();
    db.prepare('UPDATE connected_mailboxes SET status = ? WHERE id = ?')
      .run(MAILBOX_STATUS.REVOKED, id);
    const out = markMailboxNeedsReconsent(id, {
      reason: 'INVALID_GRANT', operatorUserId: OPERATOR,
    });
    expect(out.changed).toBe(false);
    expect(mailbox(id, { operatorUserId: OPERATOR }).status).toBe(MAILBOX_STATUS.REVOKED);
  });

  it('is scoped to the operator who holds the mailbox', () => {
    const id = mailboxFor();
    expect(() => markMailboxNeedsReconsent(id, {
      reason: 'INVALID_GRANT', operatorUserId: 'somebody-else',
    })).toThrow(/MAILBOX_NOT_FOUND|No mailbox/);
  });

  it('demands a short, whitespace-free, secret-free reason', () => {
    const id = mailboxFor();
    for (const reason of ['', '   ', null, undefined, 'because the token rt-1 died', 'x'.repeat(65)]) {
      expect(() => markMailboxNeedsReconsent(id, { reason, operatorUserId: OPERATOR }))
        .toThrow(/must say why|MAILBOX_RECONSENT_REASON_REQUIRED/);
    }
  });

  it('is restored to CONNECTED by an ordinary reconnect, through the existing authority', () => {
    const id = mailboxFor();
    markMailboxNeedsReconsent(id, { reason: 'INVALID_GRANT', operatorUserId: OPERATOR });
    /* No new return path: storeMailboxCredential already does this. */
    storeMailboxCredential(id, { refreshToken: 'rt-new', operatorUserId: OPERATOR });
    expect(mailbox(id, { operatorUserId: OPERATOR }).status).toBe(MAILBOX_STATUS.CONNECTED);
  });

  it('is not called by the transport', async () => {
    /**
     * A TRANSPORT REPORTS A PROVIDER FACT. Deciding a mailbox is
     * administratively broken blocks every future claim for that athlete, and
     * one failed request must not make that decision as a side effect.
     */
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../lib/googleTransport.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/markMailboxNeedsReconsent|updateMailbox|revokeMailbox/);
  });

  it('blocks a claim once set', async () => {
    const { messageId, bodyHash } = reviewed();
    const mailboxId = mailboxFor();
    markMailboxNeedsReconsent(mailboxId, { reason: 'INVALID_GRANT', operatorUserId: OPERATOR });
    const res = await send(messageId, { bodyHash, connectedMailboxId: mailboxId });
    /* 503 here because the configuration gate is first; the claim's own
       MAILBOX_NOT_CONNECTED gate is proved in executionClaim.test.js. */
    expect(res.status).toBe(503);
    expect(count('outreach_send')).toBe(0);
  });
});
