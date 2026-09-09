import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import {
  GOOGLE_SCOPES, GOOGLE_ISSUERS, authorizationUrl, exchangeCodeForIdentity,
} from './googleMailboxOAuth.js';

/**
 * D3 — the Google boundary, with Google mocked.
 *
 * No test here reaches the network. What is under test is the part that
 * decides who authorised a mailbox, and every case is a way of being told
 * something false: a token for another audience, from another issuer, without
 * a subject, with an unverified address, or without the durable credential the
 * whole flow exists to obtain.
 */

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const config = {
  googleClientId: CLIENT_ID,
  googleClientSecret: 'test-secret',
  appOrigins: ['https://app.example.test'],
};

/** A stand-in for OAuth2Client, so nothing leaves the process. */
function fakeClient({ tokens = {}, payload = {}, tokenError = null, verifyError = null } = {}) {
  return {
    getToken: vi.fn(async () => {
      if (tokenError) throw tokenError;
      return { tokens: { id_token: 'header.body.sig', refresh_token: 'rt-durable', scope: GOOGLE_SCOPES.join(' '), ...tokens } };
    }),
    verifyIdToken: vi.fn(async () => {
      if (verifyError) throw verifyError;
      return {
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: CLIENT_ID,
          sub: '1098765',
          email: 'athlete@gmail.com',
          email_verified: true,
          ...payload,
        }),
      };
    }),
  };
}

const exchange = (opts = {}) => exchangeCodeForIdentity({
  code: 'auth-code', codeVerifier: 'verifier', config, client: fakeClient(opts),
});

// ---------------------------------------------------------------------------

describe('the scopes', () => {
  it('asks for identity and send, and nothing else', () => {
    expect([...GOOGLE_SCOPES]).toEqual([
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/gmail.send',
    ]);
  });

  it('asks for nothing that can read, change or reach beyond the mailbox', () => {
    const forbidden = [
      /gmail\.readonly/, /gmail\.modify/, /mail\.google\.com/, /gmail\.compose/,
      /gmail\.labels/, /gmail\.metadata/, /contacts/, /drive/, /calendar/, /profile/,
    ];
    for (const scope of GOOGLE_SCOPES) {
      for (const bad of forbidden) expect(scope, scope).not.toMatch(bad);
    }
  });
});

describe('the authorization URL', () => {
  const url = () => new URL(authorizationUrl({ state: 'st', codeChallenge: 'ch', config }));

  it('asks for a durable credential with S256 PKCE', () => {
    const q = url().searchParams;
    // offline + consent: Google withholds a refresh token on re-authorisation
    // unless consent is asked for again, and the refresh token is the point.
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('code_challenge')).toBe('ch');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toBe('st');
  });

  it('sends the redirect URI this server derived, not one it was given', () => {
    expect(url().searchParams.get('redirect_uri'))
      .toBe('https://app.example.test/api/mailbox-consent/google/callback');
  });

  it('never carries a secret', () => {
    const raw = authorizationUrl({ state: 'st', codeChallenge: 'ch', config });
    expect(raw).not.toContain('test-secret');
    expect(raw).not.toContain('verifier');
  });
});

// ---------------------------------------------------------------------------

describe('who authorised this mailbox', () => {
  it('is the signed token\'s subject and verified address', async () => {
    const identity = await exchange();
    expect(identity).toMatchObject({
      providerAccountId: '1098765',
      email: 'athlete@gmail.com',
      emailVerified: true,
      refreshToken: 'rt-durable',
    });
    expect(identity.scopes).toContain('https://www.googleapis.com/auth/gmail.send');
  });

  it('verifies the token against our own client id', async () => {
    const client = fakeClient();
    await exchangeCodeForIdentity({ code: 'c', codeVerifier: 'v', config, client });
    // Audience is checked, and against the configured client rather than
    // whatever the token claims about itself.
    expect(client.verifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ audience: CLIENT_ID }),
    );
  });

  it('refuses a token the library will not verify', async () => {
    // A wrong audience, a bad signature and an expired token all arrive here
    // as one refusal: the library raises, and this cannot tell them apart.
    await expect(exchange({ verifyError: new Error('Wrong recipient') }))
      .rejects.toThrow(/could not be verified/);
  });

  it.each([
    ['a foreign issuer', { iss: 'https://accounts.evil.test' }],
    ['no issuer', { iss: undefined }],
  ])('refuses %s', async (_label, payload) => {
    await expect(exchange({ payload })).rejects.toThrow(/could not be verified/);
  });

  it('accepts both issuer spellings Google uses', async () => {
    for (const iss of GOOGLE_ISSUERS) {
      await expect(exchange({ payload: { iss } })).resolves.toMatchObject({ providerAccountId: '1098765' });
    }
  });

  it('refuses a token with no subject', async () => {
    await expect(exchange({ payload: { sub: undefined } })).rejects.toThrow(/names no account/);
  });

  it('refuses a token with no email', async () => {
    await expect(exchange({ payload: { email: undefined } })).rejects.toThrow(/did not release an email/);
  });

  it('refuses an unverified address rather than storing it with a caveat', async () => {
    /**
     * It would become the mailbox's identity and the address a coach sees a
     * message come from. Google saying it has not confirmed the account owns
     * it is exactly the case where we must not.
     */
    for (const email_verified of [false, undefined, 'true']) {
      await expect(exchange({ payload: { email_verified } }))
        .rejects.toThrow(/has not verified this address/);
    }
  });

  it('trusts nothing but the token for identity', () => {
    const src = fs.readFileSync(new URL('./googleMailboxOAuth.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // No query parameter, no request body, no consent-link field can name the
    // account: the only source of `sub` and `email` is the verified payload.
    expect(code).not.toMatch(/req\.|query|body\.|grant\./);
    expect(code).toMatch(/payload\.sub/);
    expect(code).toMatch(/payload\.email/);
  });
});

// ---------------------------------------------------------------------------

describe('the durable credential', () => {
  it('refuses to proceed without a refresh token', async () => {
    /**
     * An access token lasts an hour and is deliberately never stored, so a
     * mailbox recorded without a refresh token would be CONNECTED and unable
     * to send — the "fake healthy" state D2's vocabulary was chosen to avoid.
     */
    await expect(exchange({ tokens: { refresh_token: undefined } }))
      .rejects.toThrow(/did not give Thriv3 a lasting|did not return a durable credential/);
  });

  it('refuses when Google returns no identity token at all', async () => {
    await expect(exchange({ tokens: { id_token: undefined } }))
      .rejects.toThrow(/no identity token/);
  });

  it('refuses when the exchange itself fails', async () => {
    const err = new Error('invalid_grant');
    err.code = 'invalid_grant';
    await expect(exchange({ tokenError: err })).rejects.toThrow(/refused the authorization exchange/);
  });

  it('returns no access token to its caller', async () => {
    const identity = await exchange({ tokens: { access_token: 'at-short-lived' } });
    // Access tokens are minutes-lived and memory-only; nothing above this
    // boundary is even offered one.
    expect(JSON.stringify(identity)).not.toContain('at-short-lived');
    expect(identity).not.toHaveProperty('accessToken');
    expect(identity).not.toHaveProperty('idToken');
  });
});

// ---------------------------------------------------------------------------

describe('nothing secret escapes in an error', () => {
  const SECRETS = ['auth-code', 'verifier', 'rt-durable', 'test-secret', 'header.body.sig'];

  it.each([
    ['exchange failure', { tokenError: Object.assign(new Error('boom auth-code verifier'), { code: 'x' }) }],
    ['verify failure', { verifyError: new Error('bad token header.body.sig') }],
    ['no refresh token', { tokens: { refresh_token: undefined } }],
    ['unverified email', { payload: { email_verified: false } }],
  ])('on %s', async (_label, opts) => {
    let text = '';
    try { await exchange(opts); } catch (e) { text = `${e.message}${e.stack ?? ''}`; }
    expect(text).toBeTruthy();
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
  });

  it('discards the original error rather than wrapping it', () => {
    const src = fs.readFileSync(new URL('./googleMailboxOAuth.js', import.meta.url), 'utf8');
    // A token-exchange error can carry the code and the client secret in its
    // request context, so it is not attached as a cause.
    expect(src).not.toMatch(/cause:\s*err|\{\s*cause/);
  });
});
