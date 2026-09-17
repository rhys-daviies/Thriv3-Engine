import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  createConsentGrant, resolveConsentToken, revokeConsentGrant, consumeConsentGrant,
  beginOAuthTransaction, claimOAuthTransaction, grant, grantsForAthlete,
  CONSENT_REFUSAL, OAUTH_REFUSAL, CONSENT_TTL_MINUTES, OAUTH_TRANSACTION_TTL_MINUTES,
} from './mailboxConsent.js';

/**
 * D3 — the consent capability and the OAuth transaction that spends it.
 *
 * The property under test is that possession of the token authorises exactly
 * one action for exactly one athlete at exactly one provider, and that neither
 * secret can be recovered from the database.
 */

const OP = 'op-1';
const OTHER_OP = 'op-2';
const ATHLETE = 'a-consent';
const OTHER_ATHLETE = 'a-other';
let seq = 0;

const op = (id, email) => db.prepare(
  "INSERT INTO operator_users (id,email,password_hash,active,created_at) VALUES (?,?,'h',1,'x')",
).run(id, email);
const athlete = (id) => db.prepare(
  "INSERT INTO players (id,created_date,updated_date,full_name,position,sport,public_slug) "
  + "VALUES (?,'x','x','Consent Athlete','MIDFIELD','mens-soccer',?)",
).run(id, randomUUID().slice(0, 10));

const issue = (over = {}) => createConsentGrant({
  operatorUserId: OP, athleteId: ATHLETE, provider: 'GOOGLE', ...over,
});
const minutesLater = (n) => new Date(Date.now() + n * 60_000).toISOString();

/** A real mailbox row: the grant's connected_mailbox_id is a foreign key. */
function mailboxRow(id = `mbx-${++seq}`) {
  db.prepare(`INSERT INTO connected_mailboxes (id, operator_user_id, athlete_id, provider,
    provider_account_id, email_address, status, connected_at, created_at, updated_at)
    VALUES (?, ?, ?, 'GOOGLE', ?, 'a@b.com', 'CONNECTED', 'x', 'x', 'x')`)
    .run(id, OP, ATHLETE, `sub-${id}`);
  return id;
}

beforeEach(() => {
  db.exec(`DELETE FROM mailbox_oauth_transactions; DELETE FROM mailbox_consent_grants;
           DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM operator_sessions; DELETE FROM operator_users; DELETE FROM players;`);
  op(OP, 'op1@t.test'); op(OTHER_OP, 'op2@t.test');
  athlete(ATHLETE); athlete(OTHER_ATHLETE);
  seq = 0;
});

// ---------------------------------------------------------------------------

describe('the token is a capability, not a record', () => {
  it('is high-entropy and url-safe', () => {
    const { token } = issue();
    // 256 bits, base64url — safe in a URL without escaping, and not guessable.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const seen = new Set(Array.from({ length: 50 }, () => issue().token));
    expect(seen.size).toBe(50);
  });

  it('is never stored, in any column', () => {
    const { token, grant: g } = issue();
    const row = db.prepare('SELECT * FROM mailbox_consent_grants WHERE id = ?').get(g.id);
    expect(JSON.stringify(row)).not.toContain(token);
    // Only the HMAC, exactly as operator_sessions stores a session token — so a
    // database dump contains no usable link.
    expect(row.token_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hmac).not.toBe(token);
  });

  it('is not recoverable from a plain digest of itself', () => {
    // Keyed, not bare: a leaked database cannot be checked against candidates,
    // and rotating the session secret kills every outstanding link at once.
    const { token, grant: g } = issue();
    const row = db.prepare('SELECT token_hmac FROM mailbox_consent_grants WHERE id = ?').get(g.id);
    const bare = createHmac('sha256', '').update(token).digest('hex');
    expect(row.token_hmac).not.toBe(bare);
  });

  it('never appears in a read of the grant', () => {
    const { token, grant: g } = issue();
    for (const shape of [grant(g.id), ...grantsForAthlete(ATHLETE, { operatorUserId: OP })]) {
      expect(JSON.stringify(shape)).not.toContain(token);
      expect(shape).not.toHaveProperty('token_hmac');
    }
  });
});

// ---------------------------------------------------------------------------

describe('what the grant is bound to', () => {
  it('names one athlete, one operator and one provider', () => {
    const { grant: g } = issue();
    expect(g).toMatchObject({ athlete_id: ATHLETE, operator_user_id: OP, provider: 'GOOGLE' });
  });

  it('will not authorise a provider it was not issued for', () => {
    const { grant: g } = issue({ provider: 'GOOGLE' });
    // A future Microsoft flow cannot inherit consent given for Google.
    expect(() => beginOAuthTransaction(g.id, { provider: 'MICROSOFT' }))
      .toThrow(/cannot authorise MICROSOFT/);
  });

  it('refuses an athlete that does not exist', () => {
    expect(() => issue({ athleteId: 'nobody' })).toThrow(/No athlete/);
    expect(() => issue({ athleteId: null })).toThrow(/for one athlete/);
    expect(() => issue({ operatorUserId: null })).toThrow(/issued by an operator/);
  });

  it('expires', () => {
    const { token, grant: g } = issue();
    expect(Date.parse(g.expires_at) - Date.parse(g.created_at)).toBe(CONSENT_TTL_MINUTES * 60_000);
    expect(resolveConsentToken(token).ok).toBe(true);
    expect(resolveConsentToken(token, { at: minutesLater(CONSENT_TTL_MINUTES + 1) }))
      .toMatchObject({ ok: false, reason: CONSENT_REFUSAL.EXPIRED });
  });

  it('tells an unknown token and a revoked one apart from nothing', () => {
    // Neither reveals whether a token was ever valid.
    expect(resolveConsentToken('not-a-real-token'))
      .toMatchObject({ ok: false, reason: CONSENT_REFUSAL.NOT_FOUND, grant: null });
    for (const bad of ['', null, undefined, 123]) {
      expect(resolveConsentToken(bad).reason).toBe(CONSENT_REFUSAL.NOT_FOUND);
    }
  });

  it('is revocable by its operator and nobody else', () => {
    const { token, grant: g } = issue();
    expect(() => revokeConsentGrant(g.id, { operatorUserId: OTHER_OP }))
      .toThrow(/No consent grant/);
    revokeConsentGrant(g.id, { operatorUserId: OP });
    expect(resolveConsentToken(token)).toMatchObject({ ok: false, reason: CONSENT_REFUSAL.REVOKED });
  });
});

// ---------------------------------------------------------------------------

describe('when the grant is spent', () => {
  it('is not spent by being looked at', () => {
    const { token, grant: g } = issue();
    // A link that died because somebody refreshed the page is a support
    // conversation, and the athlete cannot issue themselves another.
    for (let i = 0; i < 5; i += 1) expect(resolveConsentToken(token).ok).toBe(true);
    expect(grant(g.id).consumed_at).toBeNull();
  });

  it('is not spent by starting, cancelling or failing an authorisation', () => {
    const { token, grant: g } = issue();
    beginOAuthTransaction(g.id);                       // athlete pressed Connect
    expect(resolveConsentToken(token).ok).toBe(true);

    const second = beginOAuthTransaction(g.id);        // came back and tried again
    claimOAuthTransaction(second.state);               // callback arrived, exchange failed
    expect(resolveConsentToken(token).ok).toBe(true);
    expect(grant(g.id).consumed_at).toBeNull();
  });

  it('is spent only when a mailbox exists, and then once', () => {
    const { token, grant: g } = issue();
    consumeConsentGrant(g.id, { mailboxId: mailboxRow() });

    expect(resolveConsentToken(token)).toMatchObject({ ok: false, reason: CONSENT_REFUSAL.ALREADY_USED });
    expect(grant(g.id).connected_mailbox_id).toBeTruthy();
    expect(() => consumeConsentGrant(g.id, { mailboxId: mailboxRow() })).toThrow(/no longer live/);
  });

  it('cannot be revoked after it connected something', () => {
    const { grant: g } = issue();
    consumeConsentGrant(g.id, { mailboxId: mailboxRow() });
    // Revoking a link must not disconnect a mailbox — those are different acts
    // on different objects.
    expect(() => revokeConsentGrant(g.id, { operatorUserId: OP }))
      .toThrow(/revoke the mailbox instead/);
  });
});

// ---------------------------------------------------------------------------

describe('the OAuth transaction', () => {
  it('has its own random state, and stores only its digest', () => {
    const { grant: g } = issue();
    const { state, transactionId } = beginOAuthTransaction(g.id);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = db.prepare('SELECT * FROM mailbox_oauth_transactions WHERE id = ?').get(transactionId);
    expect(JSON.stringify(row)).not.toContain(state);
    expect(row.state_hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is not the consent token', () => {
    /**
     * The shortcut this avoids: using the consent token as state would put a
     * live bearer capability through Google's servers, the browser history and
     * the Referer of every link on the callback page.
     */
    const { token, grant: g } = issue();
    const { state } = beginOAuthTransaction(g.id);
    expect(state).not.toBe(token);
    expect(claimOAuthTransaction(token).ok).toBe(false);
  });

  it('keeps the PKCE verifier server-side and encrypted', () => {
    const { grant: g } = issue();
    const started = beginOAuthTransaction(g.id);
    // Only the challenge is returned; the verifier is not in the result at all.
    expect(started).toHaveProperty('codeChallenge');
    expect(started).not.toHaveProperty('codeVerifier');
    expect(started).not.toHaveProperty('verifier');

    const row = db.prepare('SELECT * FROM mailbox_oauth_transactions WHERE id = ?').get(started.transactionId);
    const claimed = claimOAuthTransaction(started.state);
    // S256: the stored challenge is the hash of the verifier the callback reads.
    const expected = require('node:crypto').createHash('sha256')
      .update(claimed.codeVerifier).digest('base64url');
    expect(started.codeChallenge).toBe(expected);
    // And the verifier is not sitting in the row in the clear.
    expect(JSON.stringify(row)).not.toContain(claimed.codeVerifier);
  });

  it('is single-use, whatever the outcome', () => {
    const { grant: g } = issue();
    const { state } = beginOAuthTransaction(g.id);
    expect(claimOAuthTransaction(state).ok).toBe(true);
    // A nonce that survives its own callback can be presented twice.
    expect(claimOAuthTransaction(state)).toMatchObject({ ok: false, reason: OAUTH_REFUSAL.ALREADY_USED });
    expect(claimOAuthTransaction(state)).toMatchObject({ ok: false, reason: OAUTH_REFUSAL.ALREADY_USED });
  });

  it('expires, and refuses a state it never minted', () => {
    const { grant: g } = issue();
    const { state } = beginOAuthTransaction(g.id);
    expect(claimOAuthTransaction(state, { at: minutesLater(OAUTH_TRANSACTION_TTL_MINUTES + 1) }))
      .toMatchObject({ ok: false, reason: OAUTH_REFUSAL.EXPIRED });
    for (const bad of ['forged', '', null]) {
      expect(claimOAuthTransaction(bad).reason).toBe(OAUTH_REFUSAL.STATE_UNKNOWN);
    }
  });

  it('refuses a callback claiming the wrong provider', () => {
    const { grant: g } = issue();
    const { state } = beginOAuthTransaction(g.id, { provider: 'GOOGLE' });
    expect(claimOAuthTransaction(state, { provider: 'MICROSOFT' }))
      .toMatchObject({ ok: false, reason: OAUTH_REFUSAL.PROVIDER_MISMATCH });
  });

  it('carries the athlete and operator from the grant, not from the callback', () => {
    const { grant: g } = issue();
    const { state } = beginOAuthTransaction(g.id);
    const claimed = claimOAuthTransaction(state);
    // Nothing the browser sends can substitute either.
    expect(claimed.grant).toMatchObject({ athlete_id: ATHLETE, operator_user_id: OP });
  });

  it('lets only one of two concurrent callbacks proceed', () => {
    const { grant: g } = issue();
    const { state } = beginOAuthTransaction(g.id);
    const results = [claimOAuthTransaction(state), claimOAuthTransaction(state)];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('dies with its grant', () => {
    const { grant: g } = issue();
    beginOAuthTransaction(g.id);
    db.prepare('DELETE FROM mailbox_consent_grants WHERE id = ?').run(g.id);
    expect(db.prepare('SELECT COUNT(*) n FROM mailbox_oauth_transactions').get().n).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('what the consent layer cannot do', () => {
  it('issues no session and knows nothing about one', () => {
    const src = fs.readFileSync(new URL('./mailboxConsent.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // There is no code path from a consent grant to an operator session.
    expect(code).not.toMatch(/createSession|operator_sessions|SESSION_COOKIE|res\.cookie/);
  });

  it('reaches no provider', () => {
    const src = fs.readFileSync(new URL('./mailboxConsent.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/googleapis|google-auth|fetch\(|https:\/\//);
  });
});
