import { randomBytes } from 'node:crypto';
import { OUTREACH_TOKEN_LENGTH, PUBLIC_SLUG_LENGTH } from './config.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CEILING = 256 - (256 % ALPHABET.length); // reject above this to avoid modulo bias

function randomString(length) {
  const out = [];
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= CEILING) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** Opaque 32-char bearer token. Encodes nothing — not email, name, nor an id. */
export function generateToken() {
  return randomString(OUTREACH_TOKEN_LENGTH);
}

/** Random 10-char public filename slug, reused across regenerations. */
export function generateSlug() {
  return randomString(PUBLIC_SLUG_LENGTH);
}

/**
 * Draws from `make` until `exists` says the value is free. Collisions are
 * vanishingly unlikely at 62^32, but an unchecked insert would fail loudly
 * later rather than here.
 */
export function generateUnique(make, exists, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const candidate = make();
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`Could not generate a unique value after ${attempts} attempts`);
}
