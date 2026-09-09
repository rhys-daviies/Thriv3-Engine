import { OAuth2Client } from 'google-auth-library';
import { resolveConfig, googleRedirectUri, googleOAuthConfigured } from './runtimeConfig.js';

/**
 * THE GOOGLE BOUNDARY, AND NOTHING ELSE.
 *
 * Everything Google-specific lives here: the authorization URL, the token
 * exchange, and the verification of the identity that comes back. Nothing
 * above this file knows what a `sub` is or which endpoint issues one, and
 * nothing in this file knows what a campaign, an athlete or a consent grant is.
 *
 * ---------------------------------------------------------------------------
 * THE SIGNATURE CHECK IS NOT HAND-ROLLED, AND THAT IS THE DEPENDENCY DECISION.
 *
 * An ID token is a JWT signed by a key from Google's JWKS, which rotates. To
 * verify one correctly you must fetch the right key set, pick the key by `kid`,
 * validate the signature, then check issuer, audience and expiry — and the
 * failure mode of getting any of it subtly wrong is accepting a token somebody
 * else minted. It is exactly the code that should not be written twice, and
 * `google-auth-library` is Google's own implementation of it.
 *
 * The rest of the flow — the URL, the exchange — is plain HTTP that the same
 * client already does correctly, so it is used for those too rather than
 * carrying a dependency for one function and hand-writing the neighbours.
 * ---------------------------------------------------------------------------
 *
 * NOTHING HERE IS LOGGED. Not the authorization code, not the tokens, not the
 * ID token. The errors below name what failed and never what it contained.
 */

export const GOOGLE_ISSUERS = Object.freeze(['https://accounts.google.com', 'accounts.google.com']);

/**
 * THE SCOPES, AND WHY EACH ONE.
 *
 *   openid   asks for an ID token at all. Without it there is no signed
 *            identity and we would be trusting whatever the browser said.
 *   email    the verified address, which becomes the mailbox's identity and
 *            eventually B5's sending identity. `email_verified` comes with it.
 *   gmail.send  send-only. It cannot read a message, list a thread, change a
 *            label or touch a draft — the narrowest thing Google offers that
 *            can put an email in a coach's inbox.
 *
 * `profile` is NOT requested. It would give a display name, which is a nicety,
 * and asking a recruit for their Google profile to store a nicety is the wrong
 * trade on a consent screen they are reading carefully.
 *
 * gmail.send IS requested now, in a slice that sends nothing. Google presents
 * scopes at consent, so requesting it in D5 instead would mean asking the same
 * athlete a second time for a permission the first screen could have covered —
 * and a second consent request reads like something went wrong. It is
 * least-privilege for the flow as a whole rather than for this slice alone.
 *
 * gmail.send is a RESTRICTED scope: publishing this app to external users will
 * require Google's verification and, for restricted scopes, a security
 * assessment. See docs/google-oauth.md — that is a project-setup obligation,
 * not a code one, and it is why it is written down.
 */
export const GOOGLE_SCOPES = Object.freeze([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.send',
]);

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function clientFor(config = resolveConfig()) {
  if (!googleOAuthConfigured(config)) {
    throw fail('GOOGLE_OAUTH_NOT_CONFIGURED',
      'Google mailbox connection is not configured on this server.');
  }
  return new OAuth2Client({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: googleRedirectUri(config),
  });
}

/**
 * Where to send the athlete.
 *
 * `access_type: offline` with `prompt: consent` because the durable refresh
 * token is the entire point: Google returns one on first authorisation and
 * then withholds it on later ones unless consent is asked for again. An
 * athlete reconnecting a mailbox they connected before would otherwise arrive
 * back here with an access token that expires in an hour and nothing to renew
 * it with — see `MISSING_REFRESH_TOKEN` below, which is the failure this
 * avoids rather than papers over.
 */
export function authorizationUrl({ state, codeChallenge, config = resolveConfig() }) {
  return clientFor(config).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...GOOGLE_SCOPES],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    include_granted_scopes: true,
  });
}

/**
 * Exchange the code, and establish who authorised it.
 *
 * IDENTITY COMES FROM THE SIGNED TOKEN, NEVER FROM ANYTHING WE WERE TOLD. Not
 * the address on the consent link, not a query parameter, not what the athlete
 * typed into Google's own form — the `sub` and `email` claims of a token whose
 * signature, issuer, audience and expiry have been checked. An attacker who
 * completes this flow proves control of the Google account they are handing us
 * and cannot make it look like a different one.
 *
 * @returns {{providerAccountId, email, emailVerified, refreshToken, scopes}}
 */
export async function exchangeCodeForIdentity({
  code, codeVerifier, config = resolveConfig(), client = null,
} = {}) {
  if (!code) throw fail('MISSING_CODE', 'Google did not return an authorization code.');
  const oauth = client ?? clientFor(config);

  let tokens;
  try {
    ({ tokens } = await oauth.getToken({ code, codeVerifier }));
  } catch (err) {
    // The original is discarded: a token-exchange error can carry the code and
    // the client secret in its request context.
    throw fail('TOKEN_EXCHANGE_FAILED',
      `Google refused the authorization exchange (${err?.code ?? 'no code'}).`);
  }

  if (!tokens?.id_token) {
    throw fail('MISSING_ID_TOKEN', 'Google returned no identity token, so the mailbox owner cannot be established.');
  }

  let payload;
  try {
    const ticket = await oauth.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw fail('ID_TOKEN_INVALID', 'Google\'s identity token could not be verified.');
  }

  /**
   * The library checks signature, audience and expiry. The issuer is checked
   * HERE as well, explicitly, because it is the one claim whose correct value
   * is a fact about Google rather than about our configuration, and asserting
   * it costs one line.
   */
  if (!GOOGLE_ISSUERS.includes(payload?.iss)) {
    throw fail('ID_TOKEN_INVALID', 'Google\'s identity token could not be verified.');
  }
  if (!payload?.sub) {
    throw fail('MISSING_SUBJECT', 'Google\'s identity token names no account.');
  }
  if (!payload?.email) {
    throw fail('MISSING_EMAIL', 'Google did not release an email address for this account.');
  }
  /**
   * An UNVERIFIED address is refused, not stored with a caveat. It would become
   * the mailbox's identity and, later, the address a coach sees a message come
   * from; Google saying it has not confirmed the account owns it is exactly the
   * case where we must not.
   */
  if (payload.email_verified !== true) {
    throw fail('EMAIL_UNVERIFIED',
      'Google has not verified this address for the account, so it cannot be used to send.');
  }

  /**
   * NO REFRESH TOKEN MEANS NO CONNECTION.
   *
   * Google withholds one when the user has authorised before and consent was
   * not re-requested. An access token lasts an hour and is deliberately never
   * stored, so a mailbox recorded without a refresh token would be CONNECTED
   * and unable to send — the "fake healthy" state D2's status vocabulary was
   * chosen to avoid. Refused, and the athlete is asked to try again.
   */
  if (!tokens.refresh_token) {
    throw fail('MISSING_REFRESH_TOKEN',
      'Google did not return a durable credential for this mailbox. This usually means the '
      + 'account has authorised before; disconnect it in your Google account settings and try again.');
  }

  return {
    providerAccountId: String(payload.sub),
    email: String(payload.email),
    emailVerified: true,
    displayName: null,
    refreshToken: tokens.refresh_token,
    scopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : [],
  };
}
