import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  providerCapability, providerImplemented, PROVIDER_REFUSAL,
} from './providerCapability.js';
import { productionTransport } from './productionTransport.js';
import { googleTransport, TRANSPORT_REASON, GOOGLE_USERINFO_URL } from './googleTransport.js';
import { TRANSPORT_OUTCOME } from './outboundTransport.js';
import { createConnectedMailbox, storeMailboxCredential } from './connectedMailboxes.js';

/**
 * D5.2 — WHAT THIS DEPLOYMENT IS ACTUALLY ALLOWED TO DO.
 *
 * ===========================================================================
 * THE SLICE WIRES A REAL SENDER, SO THESE TESTS ARE ABOUT WHAT STOPS IT.
 *
 * Until D5.1 the guarantee was that `productionTransport()` returned null, and
 * nothing else was needed. D5.2 makes it return a real Google adapter under the
 * right conditions, which means every proof that no email can leave now has to
 * be a proof about behaviour rather than about absence.
 *
 * Three gates, tested separately, because they answer three different
 * questions and fail for three different people:
 *
 *   implemented   the BUILD has no adapter — permanent, nobody can configure
 *                 it away.
 *   configured    the DEPLOYMENT is not set up — an operator task.
 *   sendEnabled   a human has not switched real email on — a decision.
 *
 * And the last one is tested twice over: once here, and once as a kill switch
 * inside the adapter that holds even if every other check is bypassed.
 * ===========================================================================
 */

/** A deployment that has everything Google needs. `origin` drives the redirect. */
const CONFIGURED = Object.freeze({
  googleClientId: 'client-id.apps.googleusercontent.com',
  googleClientSecret: 'secret',
  appOrigins: ['https://thriv3.example'],
  mailboxKey: 'a'.repeat(44),
  googleSendEnabled: false,
});
const enabled = (over = {}) => ({ ...CONFIGURED, googleSendEnabled: true, ...over });

/* ========================================================================== */

describe('A. implemented — a property of the build', () => {
  it('knows Google has an adapter', () => {
    expect(providerImplemented('GOOGLE')).toBe(true);
    expect(providerCapability('GOOGLE', CONFIGURED).implemented).toBe(true);
  });

  it('refuses Microsoft, permanently', () => {
    const cap = providerCapability('MICROSOFT', enabled());
    expect(cap.implemented).toBe(false);
    expect(cap.sendEnabled).toBe(false);
    expect(cap.refusal).toBe(PROVIDER_REFUSAL.MAILBOX_PROVIDER_UNSUPPORTED);
    /* No configuration makes it go away — that is what "build" means. */
    expect(providerImplemented('MICROSOFT')).toBe(false);
  });

  it('refuses anything that is not a provider', () => {
    for (const p of ['gmail', 'google', 'GOOGLE ', '', null, undefined, 0, {}]) {
      const cap = providerCapability(p, enabled());
      expect(cap.implemented, String(p)).toBe(false);
      expect(cap.refusal).toBe(PROVIDER_REFUSAL.MAILBOX_PROVIDER_UNSUPPORTED);
    }
  });

  it('does not infer support from a file existing', () => {
    /**
     * THE FALSE SIGNAL THIS SLICE EXISTS TO AVOID. `googleTransport.js` landing
     * in the repository made Google IMPLEMENTED; it did not make Google usable,
     * and a registry that discovered its members by trying to import them would
     * have announced a send path the moment the file appeared.
     */
    const src = fs.readFileSync(new URL('./providerCapability.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/await import|require\(|readdir|existsSync/);
  });
});

/* ========================================================================== */

describe('B. configured — a property of the deployment', () => {
  it('is not configured without an OAuth client', () => {
    for (const missing of ['googleClientId', 'googleClientSecret']) {
      const cap = providerCapability('GOOGLE', { ...enabled(), [missing]: null });
      expect(cap.implemented, missing).toBe(true);
      expect(cap.configured, missing).toBe(false);
      expect(cap.refusal).toBe(PROVIDER_REFUSAL.PROVIDER_NOT_CONFIGURED);
    }
  });

  it('is not configured without an origin to derive a redirect from', () => {
    const cap = providerCapability('GOOGLE', { ...enabled(), appOrigins: [] });
    expect(cap.configured).toBe(false);
    expect(cap.refusal).toBe(PROVIDER_REFUSAL.PROVIDER_NOT_CONFIGURED);
  });

  it('is not configured without the mailbox key', () => {
    /* Without it a stored credential cannot be decrypted — a send would fail at
       the most expensive possible moment instead of the cheapest. */
    const cap = providerCapability('GOOGLE', { ...enabled(), mailboxKey: null });
    expect(cap.configured).toBe(false);
    expect(cap.sendEnabled).toBe(false);
  });

  it('is configured when all of it is present', () => {
    expect(providerCapability('GOOGLE', CONFIGURED).configured).toBe(true);
  });
});

/* ========================================================================== */

describe('C. sendEnabled — a decision somebody made', () => {
  it('is off when the flag is absent', () => {
    const cap = providerCapability('GOOGLE', CONFIGURED);
    expect(cap.configured).toBe(true);
    expect(cap.sendEnabled).toBe(false);
    expect(cap.refusal).toBe(PROVIDER_REFUSAL.PROVIDER_SEND_DISABLED);
  });

  it('is off for every value that is not an explicit yes', () => {
    /**
     * `bool()` returns true only for 1, true, yes or on. Everything else —
     * including a typo, a stray quote and the word "FALSE" — resolves to false
     * BEFORE it reaches here, so there is no string that accidentally enables
     * sending.
     */
    for (const value of [false, undefined, null, 0, '', 'false', 'FALSE', 'no', '0', 'maybe',
      'TRUE', 1, 'true']) {
      const cap = providerCapability('GOOGLE', { ...CONFIGURED, googleSendEnabled: value });
      expect(cap.sendEnabled, JSON.stringify(value)).toBe(false);
    }
  });

  it('is on only for a real boolean true', () => {
    expect(providerCapability('GOOGLE', enabled()).sendEnabled).toBe(true);
    expect(providerCapability('GOOGLE', enabled()).refusal).toBeNull();
  });

  it('cannot be switched on for a deployment that is not configured', () => {
    const cap = providerCapability('GOOGLE', { ...enabled(), googleClientId: null });
    expect(cap.sendEnabled).toBe(false);
    expect(cap.refusal).toBe(PROVIDER_REFUSAL.PROVIDER_NOT_CONFIGURED);
  });

  it('reports the narrowest cause first', () => {
    /* An operator should be told the thing they can act on, not the last thing
       in a list. */
    expect(providerCapability('MICROSOFT', { ...enabled(), googleClientId: null }).refusal)
      .toBe(PROVIDER_REFUSAL.MAILBOX_PROVIDER_UNSUPPORTED);
    expect(providerCapability('GOOGLE', { ...enabled(), googleClientId: null }).refusal)
      .toBe(PROVIDER_REFUSAL.PROVIDER_NOT_CONFIGURED);
    expect(providerCapability('GOOGLE', CONFIGURED).refusal)
      .toBe(PROVIDER_REFUSAL.PROVIDER_SEND_DISABLED);
  });

  it('reads configuration and touches nothing else', () => {
    const src = fs.readFileSync(new URL('./providerCapability.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['db.prepare', 'fetch(', 'mailboxCredential', 'outreach_send']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

/* ========================================================================== */

describe('D. the registry', () => {
  it('returns nothing on this machine, for every provider', () => {
    /**
     * THE HEADLINE GUARANTEE OF D5.2, asserted against the REAL environment.
     * Sending is not enabled here, so the registry hands back nothing however
     * it is asked.
     */
    for (const provider of [undefined, null, 'GOOGLE', 'MICROSOFT', 'NONSENSE']) {
      expect(productionTransport({ provider }), String(provider)).toBeNull();
    }
    expect(productionTransport()).toBeNull();
  });

  it('never takes a provider from anything but its argument', () => {
    const src = fs.readFileSync(new URL('./productionTransport.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    /* No request, no body, no env read — the provider comes from the durable
       mailbox row, upstream. */
    expect(code).not.toMatch(/process\.env|req\.|request\.|body\./);
  });

  it('reaches no fake', () => {
    const src = fs.readFileSync(new URL('./productionTransport.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/fakeTransport/);
  });
});

/* ========================================================================== */

describe('E. the kill switch inside the adapter', () => {
  const ATHLETE = 'a-d52kill';
  const OPERATOR = 'op-d52kill';
  const ACCOUNT = 'sub-d52';
  const FROM = 'athlete@example.com';
  let mailboxId;
  let calls;

  const request = () => ({
    mailboxId, from: FROM, to: 'coach@duke.edu', subject: 'Hello',
    body: 'Hi Coach,\n\nMarcus', providerAccountId: ACCOUNT, operatorUserId: OPERATOR,
    idempotencyKey: 'send-1', threadRef: null,
  });

  beforeEach(() => {
    calls = [];
    db.exec(`DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
             DELETE FROM operator_users; DELETE FROM players;`);
    db.prepare(`
      INSERT INTO operator_users (id, email, password_hash, active, created_at)
      VALUES (?, ?, 'scrypt$fake', 1, 'x')
    `).run(OPERATOR, `${OPERATOR}@thriv3.test`);
    db.prepare(`
      INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
      VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?)
    `).run(ATHLETE, randomUUID().slice(0, 10));
    const box = createConnectedMailbox({
      operatorUserId: OPERATOR, athleteId: ATHLETE, provider: 'GOOGLE',
      providerAccountId: ACCOUNT, emailAddress: FROM,
    });
    mailboxId = box.id;
    storeMailboxCredential(mailboxId, { refreshToken: 'rt-1', operatorUserId: OPERATOR });
  });

  const adapter = (over = {}) => googleTransport({
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method });
      /* UserInfo and the send answer different shapes; one stub, keyed on URL. */
      const body = url === GOOGLE_USERINFO_URL
        ? { sub: ACCOUNT, email: FROM }
        : { id: 'm', threadId: 't' };
      return { ok: true, status: 200, json: async () => body };
    },
    accessTokenFor: async () => ({ token: 'at-1', refreshToken: 'rt-1' }),
    ...over,
  });

  it('defaults to the real authority, which on this machine is off', async () => {
    /**
     * OMITTING `sendEnabled` MEANS THE REAL ANSWER, NEVER A PERMISSIVE ONE. A
     * caller who forgets gets whatever the deployment actually says — and any
     * deployment that has not explicitly enabled sending says no.
     */
    const out = await adapter().send(request());
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.SEND_DISABLED);
    expect(calls).toHaveLength(0);
  });

  it('contacts nothing at all while disabled — not even to read a credential', async () => {
    const decrypt = async () => { throw new Error('the credential must not be read'); };
    const out = await adapter({ sendEnabled: () => false, accessTokenFor: decrypt })
      .send(request());

    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.SEND_DISABLED);
    /* No token endpoint, no UserInfo, no Gmail. */
    expect(calls).toHaveLength(0);
  });

  it('is REFUSED_BEFORE_TRANSPORT, never UNKNOWN, and never a throw', async () => {
    /**
     * THE ACCOUNTING REASON. If this is somehow reached after a claim, the
     * outcome settles D5.0's reservation to REFUSED_BEFORE_TRANSPORT and the
     * athlete's capacity is RELEASED rather than spent on a send that provably
     * never happened. UNKNOWN would consume it and make the message
     * permanently unretryable; a throw would strand it SENDING until recovery
     * called it unknown — a lie about a send nobody made.
     */
    const out = await adapter({ sendEnabled: () => false }).send(request());
    expect(out.outcome).not.toBe(TRANSPORT_OUTCOME.UNKNOWN);
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.provider).toBe('GOOGLE');
  });

  it('checks again immediately before the request, not only on entry', async () => {
    /**
     * Between the entry check and the POST this function awaits three times.
     * A deployment switched off during that window must not have a message
     * leave anyway — so the gate is asked once more as the last statement
     * before `fetch`.
     */
    let allowed = true;
    const out = await adapter({ sendEnabled: () => allowed, accessTokenFor: async () => {
      allowed = false;                       // switched off mid-flight
      return { token: 'at-1', refreshToken: 'rt-1' };
    } }).send(request());

    expect(out.outcome).toBe(TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT);
    expect(out.reason).toBe(TRANSPORT_REASON.SEND_DISABLED);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('asks the gate in two places, and the last one is before the fetch', () => {
    const src = fs.readFileSync(new URL('./googleTransport.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect((code.match(/if \(!sendEnabled\(\)\) return sendDisabled\(\);/g) ?? [])).toHaveLength(2);
    /* The second one sits between the identity check and the POST. */
    const afterGate = code.slice(code.lastIndexOf('if (!sendEnabled())'));
    expect(afterGate).toMatch(/method:\s*'POST'/);
    expect(afterGate.indexOf('startedAt')).toBeGreaterThan(0);
  });

  it('permits exactly one POST when a deployment has enabled sending', async () => {
    const out = await adapter({ sendEnabled: () => true }).send(request());
    expect(out.outcome).toBe(TRANSPORT_OUTCOME.ACCEPTED);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});
