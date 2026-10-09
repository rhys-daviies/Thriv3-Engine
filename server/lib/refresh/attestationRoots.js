/**
 * The pinned FIDO attestation roots, shared/fidoAttestationRoots.json (DI-04). One reader, no override
 * parameter: fidoAttestation.js verifies reviewer keys against this file only. (Tests replace this module
 * with vi.mock to pin a synthetic test CA.) The file ships with NO roots: a human pins a vendor root (e.g.
 * the authenticator vendor's FIDO attestation root, whose fingerprint they verify out of band) in a
 * reviewed PR before any key can be enrolled for a shared-development or production scope.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOTS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/fidoAttestationRoots.json');
/** -> X509Certificate[] whose SHA-256 fingerprints match the pinned values (anything else is dropped). */
export function attestationRoots() {
  try {
    const j = JSON.parse(fs.readFileSync(ROOTS_PATH, 'utf8'));
    if (j?.kind !== 'FIDO_ATTESTATION_ROOTS' || !Array.isArray(j.roots)) return [];
    return j.roots.flatMap((r) => {
      try { const c = new crypto.X509Certificate(r.pem); return c.fingerprint256 === String(r.sha256_fingerprint).toUpperCase() ? [c] : []; } catch { return []; }
    });
  } catch { return []; }
}
