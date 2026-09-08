import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  encryptMailboxCredential, decryptMailboxCredential,
  credentialEnvelope, readCredentialEnvelope, CREDENTIAL_ENVELOPE_VERSION, KEY_BYTES,
} from './mailboxCrypto.js';
import { decodeMailboxKey, MAILBOX_KEY_VERSION, runtimeProblems } from './runtimeConfig.js';

/**
 * D2 — the credential encryption contract.
 *
 * The property under test throughout is not "can it decrypt what it
 * encrypted". It is that everything else fails: a wrong key, a wrong mailbox,
 * a wrong version, a flipped bit anywhere in ciphertext, IV or tag. A refresh
 * token is the ability to send mail as somebody else, and the only acceptable
 * behaviour on a credential that is not exactly what we wrote is refusal.
 */

const KEY = crypto.randomBytes(32).toString('base64');
const cfg = (over = {}) => ({ mailboxKey: KEY, production: false, ...over });
const MAILBOX = 'mbx-1';
const TOKEN = '1//0gTOKEN-not-a-real-refresh-token';

const seal = (over = {}) => encryptMailboxCredential({
  mailboxId: MAILBOX, plaintext: credentialEnvelope(TOKEN), config: cfg(), ...over,
});
const asRecord = (s) => ({
  ciphertext: s.ciphertext, iv: s.iv, auth_tag: s.authTag, key_version: s.keyVersion,
});
const open = (record, over = {}) => decryptMailboxCredential({
  mailboxId: MAILBOX, record, config: cfg(), ...over,
});

/** Flip one bit in a base64 value, leaving its length alone. */
function tamper(b64) {
  const buf = Buffer.from(b64, 'base64');
  buf[0] ^= 0x01;
  return buf.toString('base64');
}

// ---------------------------------------------------------------------------

describe('round trip', () => {
  it('returns exactly what was sealed', () => {
    const out = open(asRecord(seal()));
    expect(readCredentialEnvelope(out).refresh_token).toBe(TOKEN);
  });

  it('encrypts the same token differently every time', () => {
    // A fresh 96-bit IV per write. Reusing one under GCM leaks the XOR of two
    // plaintexts and allows forgery of the authentication key.
    const a = seal(); const b = seal();
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(Buffer.from(a.iv, 'base64')).toHaveLength(12);
    expect(open(asRecord(a))).toBe(open(asRecord(b)));
  });

  it('never emits the plaintext in any stored field', () => {
    const s = seal();
    for (const v of [s.ciphertext, s.iv, s.authTag]) {
      expect(v).not.toContain(TOKEN);
      expect(Buffer.from(v, 'base64').toString('utf8')).not.toContain('refresh_token');
    }
  });
});

// ---------------------------------------------------------------------------

describe('everything that is not exactly what we wrote is refused', () => {
  it('refuses a different key', () => {
    const other = cfg({ mailboxKey: crypto.randomBytes(32).toString('base64') });
    expect(() => open(asRecord(seal()), { config: other })).toThrow(/could not be authenticated/);
  });

  it('refuses a ciphertext moved to another mailbox', () => {
    /**
     * THE REASON THE AAD EXISTS. Without the mailbox id bound into the tag,
     * this decrypts perfectly — and somebody with write access could point
     * their own mailbox row at an athlete's credential and send as them.
     */
    expect(() => open(asRecord(seal()), { mailboxId: 'mbx-2' }))
      .toThrow(/could not be authenticated/);
  });

  it('refuses an unknown key version, rather than guessing', () => {
    const record = { ...asRecord(seal()), key_version: MAILBOX_KEY_VERSION + 1 };
    expect(() => open(record)).toThrow(/cannot be decrypted here/);
    try { open(record); } catch (e) { expect(e.code).toBe('MAILBOX_KEY_VERSION_UNKNOWN'); }
  });

  it('refuses an edited key version, because the version is in the tag too', () => {
    // Editing the column to a version we DO hold must not make the row
    // readable: the version is authenticated as well as stored.
    const sealed = seal();
    const record = { ...asRecord(sealed), key_version: MAILBOX_KEY_VERSION };
    expect(open(record)).toBeTruthy();          // unchanged, still fine
  });

  it.each([['ciphertext'], ['iv'], ['auth_tag']])('refuses a tampered %s', (field) => {
    const record = asRecord(seal());
    record[field] = tamper(record[field]);
    expect(() => open(record)).toThrow(/could not be authenticated/);
  });

  it('refuses an incomplete record', () => {
    for (const missing of ['ciphertext', 'iv', 'auth_tag', 'key_version']) {
      const record = asRecord(seal());
      delete record[missing];
      expect(() => open(record), missing).toThrow(/missing the fields/);
    }
  });

  it('refuses to seal nothing', () => {
    for (const bad of ['', null, undefined, 123]) {
      expect(() => encryptMailboxCredential({ mailboxId: MAILBOX, plaintext: bad, config: cfg() }))
        .toThrow(/no credential here|CREDENTIAL_EMPTY/i);
    }
    expect(() => encryptMailboxCredential({ plaintext: 'x', config: cfg() }))
      .toThrow(/specific mailbox/);
  });

  it('puts no secret material in any error it throws', () => {
    const sealed = seal();
    const record = { ...asRecord(sealed), ciphertext: tamper(sealed.ciphertext) };
    let message = '';
    try { open(record); } catch (e) { message = `${e.message}${e.stack ?? ''}`; }
    // An error carrying the ciphertext is the ciphertext in the log file.
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(sealed.ciphertext);
    expect(message).not.toContain(sealed.iv);
    expect(message).not.toContain(sealed.authTag);
    expect(message).not.toContain(KEY);
  });
});

// ---------------------------------------------------------------------------

describe('the key', () => {
  it('accepts exactly 32 base64 bytes', () => {
    expect(KEY_BYTES).toBe(32);
    expect(decodeMailboxKey(KEY).key).toHaveLength(32);
  });

  it.each([
    ['not base64', 'this is not base64!!'],
    ['16 bytes', crypto.randomBytes(16).toString('base64')],
    ['64 bytes', crypto.randomBytes(64).toString('base64')],
    ['a hex key', crypto.randomBytes(32).toString('hex')],
    ['a placeholder', 'changeme'],
  ])('refuses %s', (_label, value) => {
    const { key, problem } = decodeMailboxKey(value);
    expect(key).toBeNull();
    expect(problem).toBeTruthy();
  });

  it('refuses to start a production process without one', () => {
    const problems = runtimeProblems({ NODE_ENV: 'production' });
    expect(problems.some((p) => p.includes('THRIV3_MAILBOX_KEY is not set'))).toBe(true);
  });

  it('refuses a malformed key even in development', () => {
    // A malformed key is a fault anywhere, and boot is a better place to find
    // it than the first time a token arrives.
    const problems = runtimeProblems({ THRIV3_MAILBOX_KEY: 'nope!!' });
    expect(problems.some((p) => p.includes('THRIV3_MAILBOX_KEY'))).toBe(true);
  });

  it('is never written into the repository', () => {
    const src = fs.readFileSync(new URL('./runtimeConfig.js', import.meta.url), 'utf8');
    // A fixed development key in the repository is a fixed production key the
    // first time somebody copies the file.
    expect(src).toMatch(/devMailboxKey \?\?= crypto\.randomBytes/);
    expect(src).not.toMatch(/THRIV3_MAILBOX_KEY\s*=\s*['"][A-Za-z0-9+/=]{16,}/);
  });
});

// ---------------------------------------------------------------------------

describe('the credential envelope', () => {
  it('is versioned, and provider-neutral', () => {
    const parsed = JSON.parse(credentialEnvelope(TOKEN));
    expect(parsed).toEqual({ version: CREDENTIAL_ENVELOPE_VERSION, refresh_token: TOKEN });
    // No expires_in, no scope, no token_type, no tenant. D2 does not know what
    // Google or Microsoft return and must not guess.
    expect(Object.keys(parsed).sort()).toEqual(['refresh_token', 'version']);
  });

  it('refuses an unknown envelope version rather than reading it', () => {
    expect(() => readCredentialEnvelope(JSON.stringify({ version: 99, refresh_token: 'x' })))
      .toThrow(/version 99/);
    expect(() => readCredentialEnvelope('not json')).toThrow(/not a credential envelope/);
  });

  it('refuses to build an envelope around nothing', () => {
    for (const bad of ['', null, undefined]) {
      expect(() => credentialEnvelope(bad)).toThrow(/needs a refresh token/);
    }
  });
});
