import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';
import {
  encryptMailboxCredential, decryptMailboxCredential,
  credentialEnvelope, readCredentialEnvelope,
} from './mailboxCrypto.js';

/**
 * CONNECTED MAILBOXES — the identity, and the credential kept apart from it.
 *
 * The whole of this module's job is to make one thing true: a mailbox can be
 * read, listed, updated and revoked without the refresh token ever leaving the
 * database. Everything else here follows from that.
 *
 * ---------------------------------------------------------------------------
 * TWO READ PATHS, AND ONLY ONE OF THEM TOUCHES THE CREDENTIAL.
 *
 * `mailbox`, `mailboxesForOperator` and `mailboxesForAthlete` return the PUBLIC
 * PROJECTION — a fixed list of columns from `connected_mailboxes`, which does
 * not contain a ciphertext, an IV, a tag or a key because that table does not
 * have those columns. There is no filter to forget and no field to accidentally
 * spread: the secret is in a different table, and these functions do not join
 * to it.
 *
 * `mailboxCredential` is the other path. It is the only function that reads
 * `connected_mailbox_credentials`, it decrypts and returns a token in memory,
 * and it exists for a provider layer that does not yet exist. No route reaches
 * it, and a test asserts that no route imports it.
 * ---------------------------------------------------------------------------
 *
 * OWNERSHIP IS A PARAMETER, NOT AN ASSUMPTION. Every read takes the operator
 * whose request it is and scopes on it. Go-live has one operator; "there is
 * only one user" is a fact about today's rows rather than an authorisation
 * rule, and a service layer resting on it is one signup away from being wrong.
 *
 * NOTHING HERE CONNECTS A MAILBOX TO A PROVIDER. There is no OAuth in this
 * build. `createConnectedMailbox` takes an identity somebody else verified, and
 * in D3 that somebody is the OAuth callback reading an ID token.
 */

export const MAILBOX_PROVIDER = Object.freeze({ GOOGLE: 'GOOGLE', MICROSOFT: 'MICROSOFT' });

export const MAILBOX_STATUS = Object.freeze({
  /** A verified provider identity and a stored credential. Not a claim that
   *  the next provider call will succeed — nothing here can know that. */
  CONNECTED: 'CONNECTED',
  /** The provider refused the credential. A person must reconnect it. */
  NEEDS_RECONSENT: 'NEEDS_RECONSENT',
  /** Withdrawn, here or at the provider. The credential has been destroyed. */
  REVOKED: 'REVOKED',
  /** Repeated transient provider failures. Waiting may fix it. */
  UNHEALTHY_TEMPORARY: 'UNHEALTHY_TEMPORARY',
});

/**
 * The columns that may leave this module.
 *
 * Written out rather than `SELECT *` so that a column added to the table later
 * — and the obvious candidate is something provider-shaped — does not become
 * part of every response by default. Adding a field to a response should be a
 * decision.
 */
const PUBLIC_COLUMNS = `
  id, operator_user_id, athlete_id, provider, provider_account_id,
  email_address, display_name, status, scopes,
  connected_at, last_verified_at, revoked_at, created_at, updated_at
`;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Addresses are compared and stored lowercase; a mailbox is not two mailboxes. */
const normaliseEmail = (email) => String(email ?? '').trim().toLowerCase();

/** Scopes travel as JSON and come back as an array, never as a stored string. */
const parseScopes = (raw) => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
};

const project = (row) => (row ? { ...row, scopes: parseScopes(row.scopes) } : null);

/* -------------------------------------------------------------------------- */
/* Reads — none of these can reach a credential                                */
/* -------------------------------------------------------------------------- */

/**
 * One mailbox, if it belongs to this operator.
 *
 * Returns null rather than throwing for a mailbox owned by somebody else, and
 * the same null for one that does not exist — a caller who guessed an id
 * learns nothing about whether it is real.
 */
export function mailbox(id, { operatorUserId } = {}) {
  if (!id || !operatorUserId) return null;
  return project(db.prepare(`
    SELECT ${PUBLIC_COLUMNS} FROM connected_mailboxes
    WHERE id = ? AND operator_user_id = ?
  `).get(id, operatorUserId));
}

/** Every mailbox this operator holds, oldest first. */
export function mailboxesForOperator(operatorUserId) {
  if (!operatorUserId) return [];
  return db.prepare(`
    SELECT ${PUBLIC_COLUMNS} FROM connected_mailboxes
    WHERE operator_user_id = ? ORDER BY created_at, id
  `).all(operatorUserId).map(project);
}

/** This athlete's mailboxes, still scoped to the operator asking. */
export function mailboxesForAthlete(athleteId, { operatorUserId } = {}) {
  if (!athleteId || !operatorUserId) return [];
  return db.prepare(`
    SELECT ${PUBLIC_COLUMNS} FROM connected_mailboxes
    WHERE athlete_id = ? AND operator_user_id = ? ORDER BY created_at, id
  `).all(athleteId, operatorUserId).map(project);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Record a mailbox whose identity somebody else has verified.
 *
 * THE TRUSTED SERVICE LAYER, AND DELIBERATELY NOT AN ENDPOINT. In D3 the
 * caller is the OAuth callback, holding an ID token it has validated. There is
 * no HTTP route to this function in D2 and there should not be one: a create
 * endpoint before OAuth exists would let an operator type an address into a
 * record whose whole purpose is to say "a provider told us this", and a status
 * of CONNECTED would then be a claim nothing had checked.
 *
 * @param {string} args.providerAccountId  the provider's immutable subject.
 *   NOT the email address: an address can be reassigned inside an
 *   organisation, and two accounts can present the same one.
 */
export function createConnectedMailbox({
  operatorUserId, athleteId = null, provider, providerAccountId,
  emailAddress, displayName = null, scopes = [], at = utcNow(),
} = {}) {
  if (!operatorUserId) throw fail('OPERATOR_REQUIRED', 'A mailbox is operated by somebody.');
  if (!MAILBOX_PROVIDER[provider]) {
    throw fail('UNKNOWN_PROVIDER', `Unknown mailbox provider "${provider}".`);
  }
  if (!providerAccountId) {
    throw fail('PROVIDER_ACCOUNT_REQUIRED',
      'A connected mailbox is identified by the account id the provider issued, not by its address.');
  }
  const email = normaliseEmail(emailAddress);
  if (!email) throw fail('EMAIL_REQUIRED', 'A verified mailbox has a verified address.');

  const existing = db.prepare(
    'SELECT id FROM connected_mailboxes WHERE provider = ? AND provider_account_id = ?',
  ).get(provider, providerAccountId);
  if (existing) {
    /**
     * One real inbox, one row. A second would budget the same mailbox's daily
     * sending twice under B5 and split its reputation history — the failure is
     * in the world, not in the table, which is why this is refused rather than
     * deduplicated silently.
     */
    throw fail('MAILBOX_ALREADY_CONNECTED',
      'This provider account is already connected. Reconnecting an existing mailbox updates it '
      + 'rather than adding a second record for one inbox.');
  }

  const row = {
    id: randomUUID(),
    operator_user_id: operatorUserId,
    athlete_id: athleteId,
    provider,
    provider_account_id: providerAccountId,
    email_address: email,
    display_name: displayName,
    /**
     * NEEDS_RECONSENT until a credential is stored, never CONNECTED on
     * creation. A mailbox with an identity and no token cannot send, and a
     * status is a statement about what is true rather than about what was
     * intended.
     */
    status: MAILBOX_STATUS.NEEDS_RECONSENT,
    scopes: JSON.stringify(Array.isArray(scopes) ? scopes : []),
    connected_at: at,
    last_verified_at: null,
    revoked_at: null,
    created_at: at,
    updated_at: at,
  };
  db.prepare(`
    INSERT INTO connected_mailboxes (
      id, operator_user_id, athlete_id, provider, provider_account_id,
      email_address, display_name, status, scopes,
      connected_at, last_verified_at, revoked_at, created_at, updated_at
    ) VALUES (
      @id, @operator_user_id, @athlete_id, @provider, @provider_account_id,
      @email_address, @display_name, @status, @scopes,
      @connected_at, @last_verified_at, @revoked_at, @created_at, @updated_at
    )
  `).run(row);
  return mailbox(row.id, { operatorUserId });
}

/** The fields an operator may change. Identity is not among them. */
const UPDATABLE = Object.freeze(['athlete_id', 'display_name', 'status', 'last_verified_at']);

/**
 * Change what may be changed.
 *
 * `provider`, `provider_account_id` and `email_address` are absent on purpose:
 * they are the provider's answer, not ours, and the way to change them is to
 * reconnect the mailbox. An operator who could edit the address could point a
 * verified-looking record at any inbox they liked.
 */
export function updateMailbox(id, changes = {}, { operatorUserId, at = utcNow() } = {}) {
  const current = mailbox(id, { operatorUserId });
  if (!current) throw fail('MAILBOX_NOT_FOUND', `No mailbox ${id}.`);

  const offered = Object.keys(changes);
  const refused = offered.filter((k) => !UPDATABLE.includes(k));
  if (refused.length) {
    throw fail('MAILBOX_FIELD_IMMUTABLE',
      `Cannot change ${refused.join(', ')} on a connected mailbox. The provider's identity is not `
      + 'ours to edit; reconnect the mailbox instead.');
  }
  if (changes.status && !MAILBOX_STATUS[changes.status]) {
    throw fail('UNKNOWN_MAILBOX_STATUS', `Unknown mailbox status "${changes.status}".`);
  }
  if (!offered.length) return current;

  const sets = offered.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE connected_mailboxes SET ${sets}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...changes, id, updated_at: at });
  return mailbox(id, { operatorUserId });
}

/* -------------------------------------------------------------------------- */
/* The credential — the only code that touches it                              */
/* -------------------------------------------------------------------------- */

/**
 * Store or replace this mailbox's refresh token.
 *
 * ONE ROW, REPLACED IN PLACE. The primary key on `mailbox_id` makes that a
 * database guarantee rather than a convention, so a rotation cannot leave the
 * previous ciphertext behind for somebody to find later.
 *
 * The mailbox becomes CONNECTED here and nowhere else: a stored credential is
 * the difference between an identity we recorded and a mailbox we can use.
 */
export function storeMailboxCredential(id, { refreshToken, operatorUserId, at = utcNow() } = {}) {
  const current = mailbox(id, { operatorUserId });
  if (!current) throw fail('MAILBOX_NOT_FOUND', `No mailbox ${id}.`);

  const sealed = encryptMailboxCredential({
    mailboxId: id, plaintext: credentialEnvelope(refreshToken),
  });

  db.transaction(() => {
    db.prepare(`
      INSERT INTO connected_mailbox_credentials
        (mailbox_id, ciphertext, iv, auth_tag, key_version, rotated_at, created_at, updated_at)
      VALUES (@mailbox_id, @ciphertext, @iv, @auth_tag, @key_version, @at, @at, @at)
      ON CONFLICT(mailbox_id) DO UPDATE SET
        ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag,
        key_version = excluded.key_version, rotated_at = excluded.rotated_at,
        updated_at = excluded.updated_at
    `).run({
      mailbox_id: id,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      auth_tag: sealed.authTag,
      key_version: sealed.keyVersion,
      at,
    });
    db.prepare(`
      UPDATE connected_mailboxes
      SET status = ?, revoked_at = NULL, updated_at = ? WHERE id = ?
    `).run(MAILBOX_STATUS.CONNECTED, at, id);
  })();

  return mailbox(id, { operatorUserId });
}

/**
 * The refresh token, in memory, for a provider layer that does not exist yet.
 *
 * THE ONLY FUNCTION THAT READS THE CREDENTIAL TABLE, and the only one that
 * returns a secret. It is server-internal by construction: nothing exports a
 * route to it, and a test asserts no route module imports it.
 *
 * Returns null when there is no credential — a mailbox that was revoked, or one
 * whose identity was recorded before a token arrived. Throws only when a
 * credential exists and cannot be authenticated, which is a real problem
 * somebody has to know about.
 */
export function mailboxCredential(id, { operatorUserId } = {}) {
  const current = mailbox(id, { operatorUserId });
  if (!current) throw fail('MAILBOX_NOT_FOUND', `No mailbox ${id}.`);

  const record = db.prepare(
    'SELECT ciphertext, iv, auth_tag, key_version FROM connected_mailbox_credentials WHERE mailbox_id = ?',
  ).get(id);
  if (!record) return null;

  const envelope = readCredentialEnvelope(
    decryptMailboxCredential({ mailboxId: id, record }),
  );
  return { refreshToken: envelope.refresh_token, keyVersion: record.key_version };
}

/**
 * Withdraw a mailbox: keep the record, destroy the credential.
 *
 * THE ROW SURVIVES AND THE SECRET DOES NOT, and each half is deliberate.
 *
 * The credential is deleted rather than marked, because a revoked token that
 * still exists is a revoked token somebody can still use — and the athlete's
 * withdrawal has to mean the thing they think it means.
 *
 * The mailbox row stays because messages were sent through it. Nothing yet
 * points at a mailbox from `outreach_send` — that attribution belongs with the
 * transport in a later phase — but deleting the identity now would guarantee
 * that when it does, the history it refers to is already gone.
 */
export function revokeMailbox(id, { operatorUserId, at = utcNow() } = {}) {
  const current = mailbox(id, { operatorUserId });
  if (!current) throw fail('MAILBOX_NOT_FOUND', `No mailbox ${id}.`);

  db.transaction(() => {
    db.prepare('DELETE FROM connected_mailbox_credentials WHERE mailbox_id = ?').run(id);
    db.prepare(`
      UPDATE connected_mailboxes SET status = ?, revoked_at = ?, updated_at = ? WHERE id = ?
    `).run(MAILBOX_STATUS.REVOKED, at, at, id);
  })();

  return mailbox(id, { operatorUserId });
}

/** Whether a credential exists, without reading or decrypting it. */
export function hasStoredCredential(id) {
  return Boolean(db.prepare(
    'SELECT 1 FROM connected_mailbox_credentials WHERE mailbox_id = ?',
  ).get(id));
}
