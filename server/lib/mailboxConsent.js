import crypto from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';
import { resolveConfig, sessionSecretFor } from './runtimeConfig.js';
import { encryptMailboxCredential, decryptMailboxCredential } from './mailboxCrypto.js';

/**
 * PERMISSION TO CONNECT ONE MAILBOX, AND THE TRIP TO GOOGLE THAT SPENDS IT.
 *
 * The product model says the athlete authorises their own mailbox and never
 * gets a Thriv3 account. Those look contradictory only if access is assumed to
 * mean a session. This is a CAPABILITY: one unguessable token that authorises
 * exactly one action for exactly one athlete at exactly one provider, and
 * reaches nothing else in the application.
 *
 * ---------------------------------------------------------------------------
 * TWO OBJECTS, AND THE SEPARATION IS THE SECURITY.
 *
 *   THE GRANT        long-lived enough to email, single-use, revocable. It
 *                    survives a refresh, a cancelled Google screen and a failed
 *                    exchange, because none of those is the athlete having
 *                    connected anything.
 *   THE TRANSACTION  one redirect to Google and back. Its own random state, its
 *                    own PKCE verifier, consumed by the callback on ANY outcome.
 *
 * The shortcut this avoids is using the consent token as OAuth `state`. It
 * would work, and it would put a live bearer capability through Google's
 * servers, the browser history, the Referer of every link on the callback page
 * and any log in between. `state` is a nonce meaning "this callback belongs to
 * that redirect"; the grant is a capability. Conflating them makes the
 * capability as exposed as the nonce.
 * ---------------------------------------------------------------------------
 *
 * NEITHER SECRET IS STORED. Both are held as HMAC-SHA256 under the session
 * secret — the same treatment `operator_sessions` gives a session token — so a
 * database dump contains no usable link and no forgeable callback. Rotating
 * THRIV3_SESSION_SECRET invalidates every outstanding grant and transaction,
 * which is the lever you want at 2am.
 */

/**
 * Thirty minutes.
 *
 * Long enough for an operator to paste the link into an email and the athlete
 * to act on it; short enough that a link sitting in a forwarded thread a week
 * later is already dead. The repo's nearest convention is the operator session
 * at twelve idle hours, which is a working day and the wrong shape for a
 * one-action capability handed to somebody outside the organisation.
 */
export const CONSENT_TTL_MINUTES = 30;

/**
 * Ten minutes for one redirect to Google and back.
 *
 * It bounds the window in which a stolen `state` is worth anything. A consent
 * screen takes a minute; ten is generous for somebody who has to find a
 * password manager first.
 */
export const OAUTH_TRANSACTION_TTL_MINUTES = 10;

/** 256 bits, url-safe. Not guessable, and not a database identifier. */
const TOKEN_BYTES = 32;
const newSecret = () => crypto.randomBytes(TOKEN_BYTES).toString('base64url');

/**
 * The stored form of a bearer secret.
 *
 * HMAC rather than a bare SHA-256, and keyed on the session secret: a plain
 * digest of a 256-bit random token is not brute-forceable either, but a keyed
 * one means a leaked database cannot be checked against candidate tokens at
 * all, and gives rotation the power to invalidate everything at once.
 */
const digest = (secret) => crypto
  .createHmac('sha256', sessionSecretFor(resolveConfig()))
  .update(String(secret)).digest('hex');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const minutesFrom = (at, minutes) => new Date(Date.parse(at) + minutes * 60_000).toISOString();

/* -------------------------------------------------------------------------- */
/* The grant                                                                   */
/* -------------------------------------------------------------------------- */

const GRANT_COLUMNS = `
  id, operator_user_id, athlete_id, provider, expires_at,
  consumed_at, revoked_at, connected_mailbox_id, created_at, updated_at
`;

/**
 * Issue one.
 *
 * THE RAW TOKEN IS RETURNED ONCE AND NEVER AGAIN. The operator has to be able
 * to send the link, so this is the only moment it exists outside a browser —
 * and `grant()` below, which every later read uses, cannot express it because
 * the column does not hold it.
 */
export function createConsentGrant({
  operatorUserId, athleteId, provider = 'GOOGLE', at = utcNow(),
  ttlMinutes = CONSENT_TTL_MINUTES,
} = {}) {
  if (!operatorUserId) throw fail('OPERATOR_REQUIRED', 'A consent link is issued by an operator.');
  if (!athleteId) throw fail('ATHLETE_REQUIRED', 'A consent link is for one athlete.');
  if (provider !== 'GOOGLE' && provider !== 'MICROSOFT') {
    throw fail('UNKNOWN_PROVIDER', `Unknown mailbox provider "${provider}".`);
  }
  if (!db.prepare('SELECT 1 FROM players WHERE id = ?').get(athleteId)) {
    throw fail('ATHLETE_NOT_FOUND', `No athlete ${athleteId}.`);
  }

  const token = newSecret();
  const row = {
    id: crypto.randomUUID(),
    operator_user_id: operatorUserId,
    athlete_id: athleteId,
    provider,
    token_hmac: digest(token),
    expires_at: minutesFrom(at, ttlMinutes),
    consumed_at: null,
    revoked_at: null,
    connected_mailbox_id: null,
    created_at: at,
    updated_at: at,
  };
  db.prepare(`
    INSERT INTO mailbox_consent_grants (id, operator_user_id, athlete_id, provider, token_hmac,
      expires_at, consumed_at, revoked_at, connected_mailbox_id, created_at, updated_at)
    VALUES (@id, @operator_user_id, @athlete_id, @provider, @token_hmac,
      @expires_at, @consumed_at, @revoked_at, @connected_mailbox_id, @created_at, @updated_at)
  `).run(row);

  return { grant: grant(row.id), token };
}

/** One grant, by id. Never carries the token. */
export function grant(id) {
  return db.prepare(`SELECT ${GRANT_COLUMNS} FROM mailbox_consent_grants WHERE id = ?`).get(id) ?? null;
}

/**
 * WHY THIS TOKEN CANNOT BE USED, OR THE GRANT IT NAMES.
 *
 * One function, so the public consent page and the OAuth start cannot disagree
 * about whether a link is live. Returns a REASON rather than throwing, because
 * the athlete has to be told something useful and the difference between
 * "expired" and "already used" is worth saying.
 *
 * Every failure looks the same from outside in one respect: nothing here
 * reveals whether a token was ever valid. An unknown token and a revoked one
 * both come back NOT_FOUND.
 */
export const CONSENT_REFUSAL = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  EXPIRED: 'EXPIRED',
  ALREADY_USED: 'ALREADY_USED',
  REVOKED: 'REVOKED',
});

export function resolveConsentToken(token, { at = utcNow() } = {}) {
  if (typeof token !== 'string' || !token) {
    return { ok: false, reason: CONSENT_REFUSAL.NOT_FOUND, grant: null };
  }
  const row = db.prepare(
    `SELECT ${GRANT_COLUMNS} FROM mailbox_consent_grants WHERE token_hmac = ?`,
  ).get(digest(token));
  if (!row) return { ok: false, reason: CONSENT_REFUSAL.NOT_FOUND, grant: null };
  if (row.revoked_at) return { ok: false, reason: CONSENT_REFUSAL.REVOKED, grant: row };
  if (row.consumed_at) return { ok: false, reason: CONSENT_REFUSAL.ALREADY_USED, grant: row };
  if (at >= row.expires_at) return { ok: false, reason: CONSENT_REFUSAL.EXPIRED, grant: row };
  return { ok: true, reason: null, grant: row };
}

/** Every grant issued for one athlete, for the operator's own view. */
export function grantsForAthlete(athleteId, { operatorUserId } = {}) {
  if (!athleteId || !operatorUserId) return [];
  return db.prepare(`
    SELECT ${GRANT_COLUMNS} FROM mailbox_consent_grants
    WHERE athlete_id = ? AND operator_user_id = ? ORDER BY created_at DESC, id
  `).all(athleteId, operatorUserId);
}

/**
 * Withdraw an unused link.
 *
 * DISTINCT FROM REVOKING A MAILBOX, and deliberately so: this cancels a
 * permission that was never exercised, while `revokeMailbox` destroys a
 * credential that exists. Revoking a link the athlete never opened must not
 * disconnect a mailbox they connected last week.
 */
export function revokeConsentGrant(id, { operatorUserId, at = utcNow() } = {}) {
  const row = db.prepare(
    `SELECT ${GRANT_COLUMNS} FROM mailbox_consent_grants WHERE id = ? AND operator_user_id = ?`,
  ).get(id, operatorUserId);
  if (!row) throw fail('CONSENT_GRANT_NOT_FOUND', `No consent grant ${id}.`);
  if (row.consumed_at) {
    throw fail('CONSENT_ALREADY_USED',
      'This link has already connected a mailbox. Revoking the link would not disconnect it — '
      + 'revoke the mailbox instead.');
  }
  db.prepare('UPDATE mailbox_consent_grants SET revoked_at = ?, updated_at = ? WHERE id = ?')
    .run(at, at, id);
  return grant(id);
}

/**
 * Spend the grant. Called ONLY after a mailbox actually exists.
 *
 * NOT when the page is opened, NOT when Google is visited, NOT when an
 * exchange fails. A link that died because somebody refreshed the page is a
 * support conversation, and the athlete cannot issue themselves another.
 */
export function consumeConsentGrant(id, { mailboxId, at = utcNow() } = {}) {
  const changed = db.prepare(`
    UPDATE mailbox_consent_grants
    SET consumed_at = ?, connected_mailbox_id = ?, updated_at = ?
    WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL
  `).run(at, mailboxId, at, id).changes;
  if (!changed) {
    // Unreachable through the callback, which holds a live transaction. Fails
    // closed rather than reporting a success nobody achieved.
    throw fail('CONSENT_NOT_CONSUMABLE', 'This consent link is no longer live.');
  }
  return grant(id);
}

/* -------------------------------------------------------------------------- */
/* The OAuth transaction                                                       */
/* -------------------------------------------------------------------------- */

/**
 * PKCE, S256.
 *
 * Used even though this is a confidential client with a secret, because the
 * two defend different things: the secret proves the exchange came from our
 * server, and the verifier proves it came from the same browser session that
 * started the redirect. An authorization code intercepted at the redirect —
 * through a browser extension, a shared machine, a logged URL — is useless
 * without the verifier, and the client secret does nothing about that.
 */
function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Begin one redirect to the provider.
 *
 * Returns the `state` and `codeChallenge` the caller needs to build the
 * authorization URL. THE VERIFIER IS NOT RETURNED — it is encrypted into the
 * row with the transaction id as AAD and read back only by the callback, so
 * nothing that reaches a browser has ever held it.
 */
export function beginOAuthTransaction(grantId, {
  provider = 'GOOGLE', at = utcNow(), ttlMinutes = OAUTH_TRANSACTION_TTL_MINUTES,
} = {}) {
  const g = grant(grantId);
  if (!g) throw fail('CONSENT_GRANT_NOT_FOUND', `No consent grant ${grantId}.`);
  if (g.provider !== provider) {
    throw fail('PROVIDER_MISMATCH',
      `This consent link is for ${g.provider} and cannot authorise ${provider}.`);
  }

  const id = crypto.randomUUID();
  const state = newSecret();
  const { verifier, challenge } = pkcePair();
  const sealed = encryptMailboxCredential({ mailboxId: id, plaintext: verifier });

  db.prepare(`
    INSERT INTO mailbox_oauth_transactions (id, consent_grant_id, state_hmac,
      verifier_ciphertext, verifier_iv, verifier_auth_tag, verifier_key_version,
      provider, expires_at, consumed_at, created_at)
    VALUES (@id, @consent_grant_id, @state_hmac, @ciphertext, @iv, @auth_tag, @key_version,
      @provider, @expires_at, NULL, @created_at)
  `).run({
    id,
    consent_grant_id: grantId,
    state_hmac: digest(state),
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    auth_tag: sealed.authTag,
    key_version: sealed.keyVersion,
    provider,
    expires_at: minutesFrom(at, ttlMinutes),
    created_at: at,
  });

  return { transactionId: id, state, codeChallenge: challenge };
}

export const OAUTH_REFUSAL = Object.freeze({
  STATE_UNKNOWN: 'STATE_UNKNOWN',
  EXPIRED: 'EXPIRED',
  ALREADY_USED: 'ALREADY_USED',
  PROVIDER_MISMATCH: 'PROVIDER_MISMATCH',
});

/**
 * CLAIM the transaction this callback belongs to, exactly once.
 *
 * The consume is a CONDITIONAL UPDATE returning a row count, so two callbacks
 * arriving together — a double-click, a retried request, a replay — cannot both
 * proceed: the second changes no rows and is refused. The same guarded-write
 * shape B5's ledger uses, for the same reason.
 *
 * It consumes on ANY outcome. A callback that arrives with an error, or whose
 * exchange then fails, has still spent its state — the alternative is a nonce
 * that can be presented twice, which is not a nonce.
 */
export function claimOAuthTransaction(state, { provider = 'GOOGLE', at = utcNow() } = {}) {
  if (typeof state !== 'string' || !state) {
    return { ok: false, reason: OAUTH_REFUSAL.STATE_UNKNOWN, transaction: null, grant: null };
  }
  const row = db.prepare(
    'SELECT * FROM mailbox_oauth_transactions WHERE state_hmac = ?',
  ).get(digest(state));
  if (!row) return { ok: false, reason: OAUTH_REFUSAL.STATE_UNKNOWN, transaction: null, grant: null };

  const claimed = db.prepare(
    'UPDATE mailbox_oauth_transactions SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
  ).run(at, row.id).changes;
  if (!claimed) {
    return { ok: false, reason: OAUTH_REFUSAL.ALREADY_USED, transaction: row, grant: null };
  }
  if (row.provider !== provider) {
    return { ok: false, reason: OAUTH_REFUSAL.PROVIDER_MISMATCH, transaction: row, grant: null };
  }
  if (at >= row.expires_at) {
    return { ok: false, reason: OAUTH_REFUSAL.EXPIRED, transaction: row, grant: null };
  }

  return {
    ok: true,
    reason: null,
    transaction: row,
    grant: grant(row.consent_grant_id),
    /** Read here and nowhere else, and never returned to a browser. */
    codeVerifier: decryptMailboxCredential({
      mailboxId: row.id,
      record: {
        ciphertext: row.verifier_ciphertext,
        iv: row.verifier_iv,
        auth_tag: row.verifier_auth_tag,
        key_version: row.verifier_key_version,
      },
    }),
  };
}
