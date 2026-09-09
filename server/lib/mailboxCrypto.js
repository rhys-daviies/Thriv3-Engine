import crypto from 'node:crypto';
import { resolveConfig, mailboxKeyFor, MAILBOX_KEY_VERSION } from './runtimeConfig.js';

/**
 * THE ONE PLACE A MAILBOX CREDENTIAL IS ENCRYPTED OR DECRYPTED.
 *
 * A refresh token is not like the other secrets this application holds. A
 * session secret signs cookies we issued; a sync secret authenticates our own
 * edge. A refresh token lets the bearer send mail as somebody else, from an
 * address a coach trusts, until the athlete revokes it — and they will not
 * think to. It is the most dangerous thing in the database, and it is the only
 * thing in the database that is encrypted.
 *
 * ---------------------------------------------------------------------------
 * AES-256-GCM, AND THE AAD IS THE PART THAT IS EASY TO LEAVE OUT.
 *
 * GCM authenticates the ciphertext, so tampering is detected. What it does not
 * do on its own is stop a ciphertext being MOVED: without additional data
 * bound into the tag, the encrypted credential for one mailbox decrypts
 * perfectly well when pasted into another mailbox's row. Somebody with write
 * access to the database — a restored backup, a bad migration, an attacker who
 * got as far as SQL — could point their own mailbox record at an athlete's
 * credential and send as them.
 *
 * So the mailbox id and the key version are bound in as AAD. A ciphertext
 * decrypts in the row it was written for and nowhere else, and the failure is
 * an authentication error rather than a plausible wrong answer.
 * ---------------------------------------------------------------------------
 *
 * NOTHING HERE IS LOGGED. Not the plaintext, not the ciphertext, not the IV,
 * not the tag, not the key. The errors below name what failed and never what
 * it contained — a decryption error carrying the ciphertext is the ciphertext
 * in the log file.
 */

const ALGORITHM = 'aes-256-gcm';

/** 96 bits, which is GCM's specified nonce size and the only one worth using. */
const IV_BYTES = 12;

/** AES-256. Enforced at config time and again here, because a 16-byte key
 *  would silently give AES-128 under a constant named for 256. */
export const KEY_BYTES = 32;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * What a ciphertext is bound to.
 *
 * The version travels in the AAD as well as in its own column, so a row whose
 * `key_version` was edited fails authentication rather than being decrypted
 * with the wrong key and returning bytes.
 */
const aadFor = (mailboxId, keyVersion) => Buffer.from(`${mailboxId}|v${keyVersion}`, 'utf8');

/**
 * The key for a version.
 *
 * ONE VERSION IS SUPPORTED AND AN UNKNOWN ONE IS AN ERROR, deliberately. The
 * column and this lookup exist so that adding a second key later is a config
 * change rather than a schema migration and a re-encryption of every row —
 * that is the whole of what "key versioning" needs to mean now. What it must
 * not do is guess: a credential written under a key we no longer hold has to
 * announce itself, because the alternative is a mailbox that silently stops
 * working with no explanation anybody can act on.
 */
function keyFor(keyVersion, config = resolveConfig()) {
  if (keyVersion !== MAILBOX_KEY_VERSION) {
    throw fail(
      'MAILBOX_KEY_VERSION_UNKNOWN',
      `This credential was encrypted under mailbox key version ${keyVersion} and this process `
      + `holds version ${MAILBOX_KEY_VERSION}. It cannot be decrypted here. Restore the earlier `
      + 'key, or reconnect the mailbox.',
    );
  }
  const key = mailboxKeyFor(config);
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw fail('MAILBOX_KEY_INVALID', `The mailbox key must be ${KEY_BYTES} bytes.`);
  }
  return key;
}

/**
 * Encrypt one credential for one mailbox.
 *
 * @param {string} args.mailboxId  bound into the tag; a ciphertext is not portable.
 * @param {string} args.plaintext  the credential envelope, as a string. This
 *   module does not know or care what is in it — see `credentialEnvelope`.
 * @returns {{ciphertext, iv, authTag, keyVersion}} base64, ready for the row.
 */
export function encryptMailboxCredential({ mailboxId, plaintext, config = resolveConfig() } = {}) {
  if (typeof mailboxId !== 'string' || !mailboxId) {
    throw fail('MAILBOX_ID_REQUIRED', 'A credential is encrypted for a specific mailbox.');
  }
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw fail('CREDENTIAL_EMPTY', 'There is no credential here to encrypt.');
  }

  const keyVersion = MAILBOX_KEY_VERSION;
  const key = keyFor(keyVersion, config);
  /**
   * A FRESH RANDOM IV PER RECORD, and never a counter.
   *
   * Reusing a nonce under GCM does not merely weaken it; it leaks the XOR of
   * two plaintexts and, worse, allows forgery of the authentication key. Twelve
   * random bytes per write is the standard answer and the reason two
   * encryptions of one token look nothing alike.
   */
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aadFor(mailboxId, keyVersion));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  };
}

/**
 * Decrypt one credential, or refuse.
 *
 * EVERY FAILURE IS THE SAME KIND OF FAILURE. A wrong key, a moved ciphertext,
 * a flipped bit and an edited tag all arrive here as one authentication error,
 * because GCM cannot tell them apart and neither should the message: a caller
 * that could distinguish "wrong key" from "tampered" has an oracle.
 */
export function decryptMailboxCredential({ mailboxId, record, config = resolveConfig() } = {}) {
  if (typeof mailboxId !== 'string' || !mailboxId) {
    throw fail('MAILBOX_ID_REQUIRED', 'A credential is decrypted for a specific mailbox.');
  }
  const { ciphertext, iv, auth_tag: authTag, key_version: keyVersion } = record ?? {};
  if (!ciphertext || !iv || !authTag || keyVersion === undefined || keyVersion === null) {
    throw fail('CREDENTIAL_RECORD_INCOMPLETE', 'This credential record is missing the fields needed to decrypt it.');
  }

  const key = keyFor(keyVersion, config);
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAAD(aadFor(mailboxId, keyVersion));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    /**
     * The original error is DISCARDED, not wrapped. Node's GCM errors are
     * terse, but an error object carrying the buffers it failed on is those
     * buffers in whatever log catches it.
     */
    throw fail(
      'CREDENTIAL_UNREADABLE',
      'This mailbox credential could not be authenticated. It was written under a different key, '
      + 'for a different mailbox, or it has been altered. The mailbox must be reconnected.',
    );
  }
}

/**
 * THE ENVELOPE, AND WHY THERE IS ONE.
 *
 * The token could be encrypted as a bare string. A one-field JSON object costs
 * a few bytes and buys the thing a bare string cannot: room to add a field
 * later without a schema migration and without a way to tell old records from
 * new ones. When Microsoft needs a tenant id stored beside the token, or a
 * provider issues a paired secret, `version` is how a reader knows which shape
 * it is holding.
 *
 * IT IS PROVIDER-NEUTRAL ON PURPOSE. There is no `expires_in`, no `scope`, no
 * `token_type`, no tenant — D2 does not know what Google or Microsoft return
 * and must not guess. The provider layer in D4 owns parsing an OAuth response;
 * this owns keeping one opaque secret safe.
 */
export const CREDENTIAL_ENVELOPE_VERSION = 1;

export function credentialEnvelope(refreshToken) {
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw fail('REFRESH_TOKEN_REQUIRED', 'A mailbox credential needs a refresh token to hold.');
  }
  return JSON.stringify({ version: CREDENTIAL_ENVELOPE_VERSION, refresh_token: refreshToken });
}

export function readCredentialEnvelope(plaintext) {
  let parsed;
  try { parsed = JSON.parse(plaintext); } catch {
    throw fail('CREDENTIAL_ENVELOPE_UNREADABLE', 'The decrypted credential is not a credential envelope.');
  }
  if (parsed?.version !== CREDENTIAL_ENVELOPE_VERSION) {
    throw fail(
      'CREDENTIAL_ENVELOPE_VERSION_UNKNOWN',
      `This credential envelope is version ${parsed?.version}; this build reads version `
      + `${CREDENTIAL_ENVELOPE_VERSION}.`,
    );
  }
  return parsed;
}
