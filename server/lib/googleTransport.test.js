import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  googleTransport, GMAIL_SEND_URL, GOOGLE_USERINFO_URL, TRANSPORT_REASON,
} from './googleTransport.js';
import { TRANSPORT_OUTCOME, attemptSend } from './outboundTransport.js';
import {
  createConnectedMailbox, storeMailboxCredential, mailboxCredential,
} from './connectedMailboxes.js';
import { decodeBase64url, unfoldCrlf } from './rfc822.js';

/**
 * D5.1 — THE GMAIL ADAPTER, ENTIRELY MOCKED.
 *
 * ===========================================================================
 * NO GMAIL REQUEST HAS EVER BEEN ISSUED BY THIS CODE, AND THIS FILE IS HOW
 * THAT IS KEPT TRUE WHILE STILL PROVING THE ADAPTER WORKS.
 *
 * `fetchImpl` is injected in every test. It is a recording function that
 * returns whatever the test wants and opens no socket. `accessTokenFor` is
 * injected too, so no token endpoint is contacted either. The REAL parts under
 * test are: the ordering, the encoding, the credential boundary, the identity
 * comparisons, the outcome classification and the one-POST guarantee.
 *
 * `productionTransport()` still returns null, so none of this is reachable
 * from the application at all — asserted in section I.
 * ===========================================================================
 *
 * THE TWO PROPERTIES MOST WORTH BREAKING, and therefore most tested:
 *
 *   1  A SECOND GMAIL POST. Every outcome class asserts the call count,
 *      including the 401 and 403 cases where google-auth-library's own client
 *      would replay a request — which is exactly why the send is a bare fetch.
 *   2  A REFUSAL MISREAD AS AN AMBIGUITY, or the reverse. Everything before the
 *      POST is REFUSED_BEFORE_TRANSPORT because no request existed; everything
 *      after it that we cannot read is UNKNOWN.
 */

const OPERATOR = 'op-d51';
const OTHER_OPERATOR = 'op-d51-2';
const ATHLETE = 'a-d51';
const ACCOUNT = 'google-sub-12345';
const FROM = 'athlete@example.com';
const TO = 'coach@duke.edu';
const SUBJECT = 'Defender, class of 2027';
const BODY = 'Hi Coach,\n\nI watched the game.\n\nMarcus';

let mailboxId;
let calls;

function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(id, `${id}@thriv3.test`);
}
function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?)
  `).run(id, randomUUID().slice(0, 10));
}

/** A recording fetch. Returns queued responses; opens nothing. */
function fetchStub(plan) {
  return async (url, init) => {
    calls.push({ url, method: init?.method, init });
    const step = typeof plan === 'function' ? plan(url, calls.length) : plan;
    const entry = url === GOOGLE_USERINFO_URL ? (step.identity ?? step) : (step.send ?? step);
    if (entry instanceof Error) throw entry;
    if (typeof entry === 'function') return entry();
    return {
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      json: async () => {
        if (entry.jsonThrows) throw new Error('unreadable');
        return entry.body ?? {};
      },
    };
  };
}

const netError = (code) => Object.assign(new Error('boom'), { code });

const okIdentity = { status: 200, body: { sub: ACCOUNT, email: FROM } };
const okSend = { status: 200, body: { id: 'gmail-msg-1', threadId: 'gmail-thread-1' } };

const request = (over = {}) => ({
  mailboxId,
  from: FROM,
  to: TO,
  subject: SUBJECT,
  body: BODY,
  providerAccountId: ACCOUNT,
  operatorUserId: OPERATOR,
  threadRef: null,
  idempotencyKey: 'send-1',
  ...over,
});

/** The adapter with everything injected; production constructs none of this. */
const adapter = (over = {}) => googleTransport({
  fetchImpl: fetchStub({ identity: okIdentity, send: okSend }),
  accessTokenFor: async () => ({ token: 'at-1', refreshToken: 'rt-1' }),
  date: new Date('2026-09-18T09:00:00.000Z'),
  ...over,
});

const gmailPosts = () => calls.filter((c) => c.url === GMAIL_SEND_URL);

beforeEach(() => {
  calls = [];
  db.exec(`DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM operator_users; DELETE FROM players;`);
  operator(OPERATOR);
  operator(OTHER_OPERATOR);
  athlete(ATHLETE);
  const box = createConnectedMailbox({
    operatorUserId: OPERATOR, athleteId: ATHLETE, provider: 'GOOGLE',
    providerAccountId: ACCOUNT, emailAddress: FROM,
  });
  mailboxId = box.id;
  storeMailboxCredential(mailboxId, { refreshToken: 'rt-1', operatorUserId: OPERATOR });
});

/* ========================================================================== */
/* A — the happy path                                                          */
/* ========================================================================== */

describe('A. an accepted message', () => {
  it('verifies identity, then POSTs once, and reports the provider ids', async () => {
    const out = await adapter().send(request());

    expect(out.outcome).toBe(TRANSPORT_OUTCOME.ACCEPTED);
    expect(out.provider).toBe('GOOGLE');
    expect(out.providerMessageId).toBe('gmail-msg-1');
    expect(out.providerThreadId).toBe('gmail-thread-1');
    expect(out.httpStatus).toBe(200);
    expect(typeof out.durationMs).toBe('number');

    /* Identity first, send second, and nothing else. */
    expect(calls.map((c) => c.url)).toEqual([GOOGLE_USERINFO_URL, GMAIL_SEND_URL]);
    expect(calls[0].method).toBe('GET');
    expect(calls[1].method).toBe('POST');
  });

  it('sends the frozen bytes, recoverable from the raw field', async () => {
    await adapter().send(request());
    const sent = JSON.parse(gmailPosts()[0].init.body);
    const message = decodeBase64url(sent.raw);

    expect(message).toContain(`From: ${FROM}`);
    expect(message).toContain(`To: ${TO}`);
    expect(message).toContain(`Subject: ${SUBJECT}`);
    const payload = message.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const text = Buffer.from(payload.replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(unfoldCrlf(text)).toBe(BODY);
  });

  it('sends no Message-ID and requests no thread', async () => {
    await adapter().send(request());
    const sent = JSON.parse(gmailPosts()[0].init.body);
    expect(Object.keys(sent)).toEqual(['raw']);          // no threadId in the request
    expect(decodeBase64url(sent.raw)).not.toMatch(/Message-ID/i);
    const out = await adapter().send(request());
    expect(out.internetMessageId).toBeNull();
  });

  it('returns no acceptedAt — executionResult owns the durable clock', async () => {
    const out = await adapter().send(request());
    expect(out.acceptedAt).toBeUndefined();
    expect(out.sentAt).toBeUndefined();
  });

  it('drives through attemptSend like any other transport', async () => {
    const out = await attemptSend(adapter(), request());
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.ACCEPTED);
  });
});

/* ========================================================================== */
/* B — the ordering, which is the safety property                              */
/* ========================================================================== */

describe('B. nothing is decrypted for a message that cannot be encoded', () => {
  it('refuses an injected header before reading the credential', async () => {
    const decrypt = vi.fn();
    const out = await googleTransport({
      fetchImpl: fetchStub({}),
      accessTokenFor: decrypt,
    }).send(request({ subject: 'Hi\r\nBcc: them@evil.test' }));

    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.MESSAGE_UNBUILDABLE);
    expect(decrypt).not.toHaveBeenCalled();          // the token stayed at rest
    expect(calls).toHaveLength(0);                    // and nothing was contacted
  });

  it('refuses a malformed recipient before reading the credential', async () => {
    const decrypt = vi.fn();
    const out = await googleTransport({ fetchImpl: fetchStub({}), accessTokenFor: decrypt })
      .send(request({ to: 'a@b.com, evil@x.com' }));
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(decrypt).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('refuses an incomplete request before anything at all', async () => {
    for (const missing of ['mailboxId', 'from', 'to', 'subject', 'body',
      'providerAccountId', 'operatorUserId']) {
      const decrypt = vi.fn();
      const out = await googleTransport({ fetchImpl: fetchStub({}), accessTokenFor: decrypt })
        .send(request({ [missing]: null }));
      expect(out.outcome, missing).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
      expect(out.reason, missing).toBe(TRANSPORT_REASON.REQUEST_INCOMPLETE);
      expect(decrypt).not.toHaveBeenCalled();
    }
    expect(calls).toHaveLength(0);
  });

  it('reads the credential before verifying identity, and identity before sending', async () => {
    const order = [];
    const out = await googleTransport({
      accessTokenFor: async () => { order.push('credential'); return { token: 'at-1' }; },
      fetchImpl: async (url, init) => {
        order.push(url === GOOGLE_USERINFO_URL ? 'identity' : 'send');
        calls.push({ url, method: init?.method, init });
        const e = url === GOOGLE_USERINFO_URL ? okIdentity : okSend;
        return { ok: true, status: e.status, json: async () => e.body };
      },
    }).send(request());

    expect(out.outcome).toBe(TRANSPORT_OUTCOME.ACCEPTED);
    expect(order).toEqual(['credential', 'identity', 'send']);
  });
});

/* ========================================================================== */
/* C — the credential boundary                                                 */
/* ========================================================================== */

describe('C. credentials', () => {
  it('refuses when the mailbox holds no credential', async () => {
    db.prepare('DELETE FROM connected_mailbox_credentials WHERE mailbox_id = ?').run(mailboxId);
    const out = await adapter().send(request());
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.CREDENTIAL_MISSING);
    expect(calls).toHaveLength(0);
  });

  it('refuses when the operator does not hold the mailbox', async () => {
    const out = await adapter().send(request({ operatorUserId: OTHER_OPERATOR }));
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(calls).toHaveLength(0);
  });

  it('treats a refused token exchange as a pre-transport refusal', async () => {
    const out = await adapter({
      accessTokenFor: async () => {
        const err = new Error('invalid_grant');
        err.code = TRANSPORT_REASON.MAILBOX_AUTH_FAILED;
        err.transportReason = TRANSPORT_REASON.MAILBOX_AUTH_FAILED;
        throw err;
      },
    }).send(request());

    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.MAILBOX_AUTH_FAILED);
    expect(calls).toHaveLength(0);
  });

  it('keeps the stored refresh token when Google issues no replacement', async () => {
    /**
     * THE MISTAKE THIS PREVENTS: reading an absent `refresh_token` as "the old
     * one is gone" and clearing a credential that is still perfectly good.
     * Google's web-server flow documents a replacement at INITIAL
     * authorisation, not at refresh, so absent is the normal case.
     */
    await adapter({ accessTokenFor: async (rt) => ({ token: 'at-1', refreshToken: rt }) })
      .send(request());
    expect(mailboxCredential(mailboxId, { operatorUserId: OPERATOR }).refreshToken).toBe('rt-1');
  });

  it('persists a replacement refresh token through the credential authority', async () => {
    await adapter({ accessTokenFor: async () => ({ token: 'at-1', refreshToken: 'rt-2-rotated' }) })
      .send(request());
    expect(mailboxCredential(mailboxId, { operatorUserId: OPERATOR }).refreshToken)
      .toBe('rt-2-rotated');
    /* And it went through storeMailboxCredential, so it is encrypted at rest. */
    const row = db.prepare(
      'SELECT ciphertext FROM connected_mailbox_credentials WHERE mailbox_id = ?',
    ).get(mailboxId);
    expect(row.ciphertext).not.toContain('rt-2-rotated');
  });

  it('refuses to send when a replacement cannot be stored', async () => {
    /**
     * THE FAILURE THIS PREVENTS: Google rotates, we send successfully, the
     * write fails afterwards, and the credential on file is one Google has
     * already invalidated — a silently dead mailbox. Refusing costs one
     * message that can be explicitly retried.
     */
    const out = await adapter({
      accessTokenFor: async () => ({ token: 'at-1', refreshToken: 'rt-2-rotated' }),
      persistRefreshToken: () => { throw Object.assign(new Error('disk'), { code: 'EIO' }); },
    }).send(request());

    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.CREDENTIAL_NOT_PERSISTED);
    expect(gmailPosts()).toHaveLength(0);
  });

  it('never stores an access token anywhere', async () => {
    await adapter().send(request());
    const cols = db.prepare('PRAGMA table_info(connected_mailbox_credentials)').all()
      .map((c) => c.name);
    expect(cols).not.toContain('access_token');
    const dump = JSON.stringify(db.prepare('SELECT * FROM connected_mailbox_credentials').all());
    expect(dump).not.toContain('at-1');
  });

  it('lets no token or raw provider error into the result', async () => {
    const out = await adapter({
      accessTokenFor: async () => {
        /* A gaxios-shaped error: its config carries the secret and the token. */
        const err = new Error('unauthorized_client');
        err.code = 'invalid_grant';
        err.config = { data: 'refresh_token=rt-1&client_secret=SHHH' };
        throw err;
      },
    }).send(request());

    const text = JSON.stringify(out);
    for (const secret of ['rt-1', 'SHHH', 'client_secret', 'refresh_token', 'at-1']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
  });
});

/* ========================================================================== */
/* D — identity                                                                */
/* ========================================================================== */

describe('D. the account holding the credential', () => {
  const identityCase = (identity) => adapter({
    fetchImpl: fetchStub({ identity, send: okSend }),
  }).send(request());

  it('proceeds when sub and email both agree', async () => {
    const out = await identityCase(okIdentity);
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.ACCEPTED);
  });

  it('refuses when the sub is a different account', async () => {
    const out = await identityCase({ status: 200, body: { sub: 'somebody-else', email: FROM } });
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.IDENTITY_MISMATCH);
    expect(gmailPosts()).toHaveLength(0);
  });

  it('refuses when the address has drifted', async () => {
    const out = await identityCase({
      status: 200, body: { sub: ACCOUNT, email: 'renamed@example.com' },
    });
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.IDENTITY_MISMATCH);
    expect(gmailPosts()).toHaveLength(0);
  });

  it('compares the address case- and whitespace-insensitively', async () => {
    const out = await identityCase({
      status: 200, body: { sub: ACCOUNT, email: `  ${FROM.toUpperCase()}  ` },
    });
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.ACCEPTED);
  });

  it('refuses when UserInfo cannot be reached, read or believed', async () => {
    const cases = [
      { status: 500, body: {} },
      { status: 401, body: {} },
      { status: 200, jsonThrows: true },
      { status: 200, body: { sub: '', email: '' } },
      { status: 200, body: {} },
    ];
    for (const identity of cases) {
      calls = [];
      const out = await identityCase(identity);
      expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
      expect(out.reason).toBe(TRANSPORT_REASON.IDENTITY_UNVERIFIABLE);
      expect(gmailPosts()).toHaveLength(0);
    }
  });

  it('refuses — not UNKNOWN — when UserInfo times out', async () => {
    /**
     * AN AMBIGUOUS IDENTITY CHECK IS NOT AN AMBIGUOUS SEND. This is a separate
     * GET that happens BEFORE the Gmail POST; however it fails, no message
     * submission had been attempted, so nothing can exist at the other end.
     * Confusing the two would mark a message unresolved — and therefore
     * permanently unretryable — over a failed identity lookup.
     */
    const out = await adapter({
      fetchImpl: fetchStub({ identity: netError('TimeoutError'), send: okSend }),
    }).send(request());

    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.IDENTITY_UNVERIFIABLE);
    expect(gmailPosts()).toHaveLength(0);
  });

  it('repairs nothing in the database on any identity failure', async () => {
    const before = db.prepare('SELECT * FROM connected_mailboxes WHERE id = ?').get(mailboxId);
    await identityCase({ status: 200, body: { sub: ACCOUNT, email: 'renamed@example.com' } });
    const after = db.prepare('SELECT * FROM connected_mailboxes WHERE id = ?').get(mailboxId);
    expect(after).toEqual(before);
    /* Status in particular: a transport does not decide a mailbox is broken. */
    expect(after.status).toBe('CONNECTED');
  });

  it('names no third-party account in the refusal it returns', async () => {
    const out = await identityCase({
      status: 200, body: { sub: 'other-persons-google-id', email: 'other@example.com' },
    });
    expect(JSON.stringify(out)).not.toContain('other-persons-google-id');
    expect(JSON.stringify(out)).not.toContain('other@example.com');
  });
});

/* ========================================================================== */
/* E — classifying what Gmail said                                             */
/* ========================================================================== */

describe('E. outcomes', () => {
  const sendWith = (send) => adapter({ fetchImpl: fetchStub({ identity: okIdentity, send }) })
    .send(request());

  it('2xx with an id is ACCEPTED', async () => {
    for (const status of [200, 201]) {
      calls = [];
      const out = await sendWith({ status, body: { id: 'm', threadId: 't' } });
      expect(out.outcome).toBe(TRANSPORT_OUTCOME.ACCEPTED);
      expect(gmailPosts()).toHaveLength(1);
    }
  });

  it('2xx without a usable id is UNKNOWN, not ACCEPTED', async () => {
    for (const body of [{}, { id: '' }, { threadId: 't' }]) {
      calls = [];
      const out = await sendWith({ status: 200, body });
      expect(out.outcome).toBe(TRANSPORT_OUTCOME.UNKNOWN);
      expect(out.reason).toBe(TRANSPORT_REASON.RESPONSE_UNREADABLE);
      expect(gmailPosts()).toHaveLength(1);
    }
  });

  it('every documented 4xx is REJECTED, and each is one POST', async () => {
    for (const status of [400, 401, 403, 404, 429]) {
      calls = [];
      const out = await sendWith({
        status, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } },
      });
      expect(out.outcome, String(status)).toBe(TRANSPORT_OUTCOME.REJECTED);
      expect(out.reason).toBe(TRANSPORT_REASON.PROVIDER_REFUSED);
      expect(out.httpStatus).toBe(status);
      /**
       * 401 AND 403 ARE THE ONES THAT MATTER HERE. `OAuth2Client.requestAsync`
       * replays its request after exactly these two. The send is a bare fetch,
       * so there is no replay to suppress — proven by the count.
       */
      expect(gmailPosts(), String(status)).toHaveLength(1);
    }
  });

  it('every 5xx is UNKNOWN, and is not retried', async () => {
    for (const status of [500, 502, 503, 504]) {
      calls = [];
      const out = await sendWith({ status, body: {} });
      expect(out.outcome, String(status)).toBe(TRANSPORT_OUTCOME.UNKNOWN);
      expect(out.reason).toBe(TRANSPORT_REASON.PROVIDER_SERVER_ERROR);
      expect(gmailPosts()).toHaveLength(1);
    }
  });

  it('an unmodelled status is UNKNOWN', async () => {
    for (const status of [301, 302, 100]) {
      calls = [];
      const out = await sendWith({ status, body: {} });
      expect(out.outcome, String(status)).toBe(TRANSPORT_OUTCOME.UNKNOWN);
      expect(gmailPosts()).toHaveLength(1);
    }
  });

  it('a reset, a timeout or an abort is UNKNOWN — bytes may have gone out', async () => {
    for (const code of ['ECONNRESET', 'TimeoutError', 'AbortError', 'EPIPE', 'ETIMEDOUT']) {
      calls = [];
      const out = await sendWith(netError(code));
      expect(out.outcome, code).toBe(TRANSPORT_OUTCOME.UNKNOWN);
      expect(gmailPosts()).toHaveLength(1);
    }
  });

  it('only a provably-unestablished connection is a refusal', async () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']) {
      calls = [];
      const out = await sendWith(netError(code));
      expect(out.outcome, code).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
      expect(out.reason).toBe(TRANSPORT_REASON.PROVIDER_UNREACHABLE);
    }
  });

  it('treats an unreadable 2xx body as UNKNOWN rather than throwing', async () => {
    const out = await sendWith({ status: 200, jsonThrows: true });
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.UNKNOWN);
  });
});

/* ========================================================================== */
/* F — one POST, structurally                                                  */
/* ========================================================================== */

describe('F. exactly one Gmail submission per invocation', () => {
  it('never issues a second POST for any outcome class', async () => {
    const outcomes = [
      { status: 200, body: { id: 'm' } },
      { status: 400, body: {} }, { status: 401, body: {} }, { status: 403, body: {} },
      { status: 429, body: {} }, { status: 500, body: {} },
      netError('ECONNRESET'), netError('TimeoutError'),
    ];
    for (const send of outcomes) {
      calls = [];
      await adapter({ fetchImpl: fetchStub({ identity: okIdentity, send }) }).send(request());
      expect(gmailPosts()).toHaveLength(1);
    }
  });

  it('routes the send through a bare fetch, never through the OAuth client', () => {
    /**
     * THE STRUCTURAL GUARANTEE, ASSERTED ON THE SOURCE. `OAuth2Client` appears
     * exactly once — in the token exchange — and the send is `fetchImpl`.
     * Routing the send through the client would make its 401/403 replay and
     * gaxios's `retryConfig` reachable, and neither is suppressible from here.
     */
    const src = fs.readFileSync(new URL('./googleTransport.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect((code.match(/new OAuth2Client/g) ?? [])).toHaveLength(1);
    expect(code).not.toMatch(/client\.(request|requestAsync)\s*\(/);
    expect(code).not.toMatch(/retryConfig|retry\s*:/);
    /* The IMPORT form, not the word: GMAIL_SEND_URL legitimately contains the
       hostname `gmail.googleapis.com`. */
    expect(code).not.toMatch(/from '(googleapis|nodemailer)'/);
    expect(code).not.toMatch(/require\('(googleapis|nodemailer)'\)/);
    /* One POST in the whole file. */
    expect((code.match(/method:\s*'POST'/g) ?? [])).toHaveLength(1);
  });

  it('sets no stored access_token on the client, so no replay branch exists', () => {
    const src = fs.readFileSync(new URL('./googleTransport.js', import.meta.url), 'utf8');
    expect(src).toMatch(/setCredentials\(\{\s*refresh_token: refreshToken\s*\}\)/);
    expect(src).not.toMatch(/setCredentials\([^)]*access_token/);
  });
});

/* ========================================================================== */
/* G — what leaves the adapter                                                 */
/* ========================================================================== */

describe('G. the result contract', () => {
  it('carries only provider-neutral facts', async () => {
    const out = await adapter().send(request());
    expect(Object.keys(out).sort()).toEqual([
      'durationMs', 'httpStatus', 'internetMessageId', 'outcome',
      'provider', 'providerMessageId', 'providerThreadId',
    ]);
  });

  it('never carries the body, the MIME or Google’s own message', async () => {
    const out = await adapter({
      fetchImpl: fetchStub({
        identity: okIdentity,
        send: { status: 400, body: { error: { message: `Invalid To header: ${TO} / ${BODY}`, errors: [{ reason: 'invalidArgument' }] } } },
      }),
    }).send(request());

    const text = JSON.stringify(out);
    expect(text).not.toContain(BODY);
    expect(text).not.toContain('Invalid To header');
    expect(text).not.toMatch(/MIME-Version|Content-Transfer/);
    /* The machine-readable reason is kept, because it is actionable and carries
       no content. */
    expect(out.providerCode).toBe('invalidArgument');
  });

  it('uses main’s vocabulary, not a parallel one', async () => {
    const src = fs.readFileSync(new URL('./googleTransport.js', import.meta.url), 'utf8');
    expect(src).toMatch(/import \{ TRANSPORT_OUTCOME \} from '\.\/outboundTransport\.js'/);
    /**
     * Asserted on CODE, not on the file: the module header explains at length
     * that F11's `AMBIGUOUS` was NOT brought across, and a guard that trips on
     * its own explanation is not a guard.
     */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/AMBIGUOUS/);
    expect(code).not.toMatch(/TRANSPORT_OUTCOME\s*=\s*Object\.freeze/);
    expect(code).not.toMatch(/transportSnapshot/);
  });

  it('reports a duration that is a number and nothing more', async () => {
    const out = await adapter().send(request());
    expect(Number.isFinite(out.durationMs)).toBe(true);
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });
});

/* ========================================================================== */
/* H — production isolation                                                    */
/* ========================================================================== */

describe('H. unreachable from the product', () => {
  it('productionTransport still returns null and imports nothing', async () => {
    const { productionTransport } = await import('./productionTransport.js');
    expect(productionTransport()).toBeNull();

    const src = fs.readFileSync(new URL('./productionTransport.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/googleTransport|rfc822|google-auth/);
  });

  it('no module on the application send path imports the Google adapter', () => {
    for (const rel of ['./executeProgrammeMessage.js', './executionClaim.js',
      './executionResult.js', './executionRetry.js', './executionReadiness.js',
      './outboundTransport.js', '../routes/campaigns.js']) {
      const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, rel).not.toMatch(/googleTransport|google-auth-library/);
    }
  });

  it('no route module imports the credential authority', () => {
    const dir = new URL('../routes/', import.meta.url);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.includes('.test.'))) {
      const src = fs.readFileSync(new URL(file, dir), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/mailboxCredential|mailboxCrypto|decryptMailboxCredential/);
    }
  });
});
