/**
 * FIDO ATTESTATION FOR REVIEWER KEYS — Phase DI-04 (DI-03G MAJOR-C, DI-03I N1).
 *
 * WHY. An sk-ssh-ed25519 public key line proves nothing about hardware: anyone holding a software
 * Ed25519 key can wrap it in the sk format and set the user-presence / user-verification flags on every
 * signature (DI-03I N1 forged exactly that). What proves the private key lives in an authenticator that
 * refuses to sign without a touch and a PIN is the AUTHENTICATOR'S ATTESTATION, produced once at key
 * creation:
 *
 *   ssh-keygen -t ed25519-sk -O verify-required -O application=ssh:thriv3-reviewer \
 *              -O challenge=<challenge file> -O write-attestation=<attestation file> -f <key>
 *
 * The attestation (OpenSSH "ssh-sk-attest-v01") carries the authenticator's attestation certificate, its
 * signature over the FIDO2 authenticator data + the challenge's client-data hash, and that authenticator
 * data, which contains the credential's own public key. This module checks, with no network:
 *   1. the attestation certificate is issued by a vendor certificate PINNED in
 *      shared/fidoAttestationRoots.json (ships EMPTY — a human pins a vendor root after verifying its
 *      fingerprint out of band; until then no key can be enrolled for a runtime scope: fail closed);
 *   2. the certificate is within its validity period;
 *   3. the attestation signature verifies over authData || clientDataHash (clientDataHash = SHA-256 of
 *      the enrolment challenge; a 32-byte challenge used directly as the hash is also accepted, as older
 *      libfido2 builds did);
 *   4. authData's rpIdHash is SHA-256 of the key's application string, the attested-credential flag is
 *      set, and the credential public key (COSE OKP / EdDSA / Ed25519) is EXACTLY the enrolled key.
 * Only "packed" (FIDO2) attestation is supported: Ed25519 is not available on U2F-only devices.
 *
 * LIMIT, STATED PLAINLY: this has been exercised against synthetic attestations built with a test CA
 * (fidoAttestation.test.js), not against a physical authenticator — the first real enrolment must be
 * checked with `node server/scripts/correctionApproval.js verify-enrolment` before its PR is reviewed.
 */
import crypto from 'node:crypto';
import { attestationRoots } from './attestationRoots.js';

// ---- minimal CBOR (RFC 8949) reader: what authData / COSE keys use -----------------------------
function cbor(buf, o = 0) {
  const ib = buf[o++]; const major = ib >> 5; let ai = ib & 31; let n;
  if (ai < 24) n = ai;
  else if (ai === 24) { n = buf[o]; o += 1; } else if (ai === 25) { n = buf.readUInt16BE(o); o += 2; } else if (ai === 26) { n = buf.readUInt32BE(o); o += 4; } else if (ai === 27) { n = Number(buf.readBigUInt64BE(o)); o += 8; } else throw new Error('indefinite or reserved CBOR length');
  if (major === 0) return [n, o];
  if (major === 1) return [-1 - n, o];
  if (major === 2) return [buf.subarray(o, o + n), o + n];
  if (major === 3) return [buf.subarray(o, o + n).toString('utf8'), o + n];
  if (major === 4) { const a = []; for (let i = 0; i < n; i++) { let v; [v, o] = cbor(buf, o); a.push(v); } return [a, o]; }
  if (major === 5) { const m = new Map(); for (let i = 0; i < n; i++) { let k; let v; [k, o] = cbor(buf, o); [v, o] = cbor(buf, o); m.set(k, v); } return [m, o]; }
  throw new Error(`unsupported CBOR major type ${major}`);
}

function sshReader(buf) {
  let o = 0;
  const need = (n) => { if (o + n > buf.length) throw new Error('truncated attestation'); };
  return { u32() { need(4); const v = buf.readUInt32BE(o); o += 4; return v; }, string() { const n = this.u32(); need(n); const b = buf.subarray(o, o + n); o += n; return Buffer.from(b); }, done: () => o === buf.length };
}

/** Parse an OpenSSH sk attestation blob. -> { certDer, signature, authData } */
export function parseAttestation(blob) {
  const r = sshReader(blob);
  const ver = r.string().toString();
  if (ver !== 'ssh-sk-attest-v01') throw new Error(`unsupported attestation format ${ver} (need ssh-sk-attest-v01)`);
  const certDer = r.string(); const signature = r.string(); const authDataCbor = r.string();
  r.u32(); r.string(); // reserved flags, reserved string
  if (!r.done()) throw new Error('trailing bytes in attestation');
  const [authData] = cbor(authDataCbor, 0);
  if (!Buffer.isBuffer(authData)) throw new Error('authenticator data is not a CBOR byte string');
  return { certDer, signature, authData };
}

/** Parse FIDO2 authenticator data. -> { rpIdHash, flags, counter, aaguid, credentialId, coseKey } */
export function parseAuthData(a) {
  if (a.length < 37) throw new Error('authenticator data too short');
  const out = { rpIdHash: a.subarray(0, 32), flags: a[32], counter: a.readUInt32BE(33) };
  if (!(out.flags & 0x40)) throw new Error('authenticator data carries no attested credential (AT flag clear)');
  let o = 37;
  out.aaguid = a.subarray(o, o + 16).toString('hex'); o += 16;
  const idLen = a.readUInt16BE(o); o += 2;
  out.credentialId = a.subarray(o, o + idLen); o += idLen;
  [out.coseKey] = cbor(a, o);
  return out;
}

/**
 * Problems with one enrolled key's attestation ([] = attested by a pinned vendor certificate).
 * `key`: the parsed enrolled public key (sshSignature.parsePublicKey) — must be sk-ssh-ed25519.
 */
export function attestationProblems(key, { attestation, challenge, now = new Date(), roots = attestationRoots() } = {}) {
  const p = [];
  if (key?.type !== 'sk-ssh-ed25519@openssh.com') return ['only a hardware (sk-ssh-ed25519) key can be attested'];
  if (!attestation || !challenge) return ['enrolment must carry the key\'s attestation and enrolment challenge (ssh-keygen -O write-attestation, -O challenge)'];
  if (!roots.length) return ['no FIDO attestation root is pinned (shared/fidoAttestationRoots.json is empty) — a human must pin a verified vendor root before any runtime key can be enrolled'];
  let att; let ad;
  try { att = parseAttestation(Buffer.from(attestation, 'base64')); ad = parseAuthData(att.authData); } catch (e) { return [`attestation unreadable: ${e.message}`]; }
  let cert;
  try { cert = new crypto.X509Certificate(att.certDer); } catch (e) { return [`attestation certificate unreadable: ${e.message}`]; }
  const issuer = roots.find((r) => { try { return cert.checkIssued(r) && cert.verify(r.publicKey); } catch { return false; } });
  if (!issuer) p.push(`attestation certificate (${cert.subject.replace(/\n/g, ', ')}) is not issued by a pinned FIDO attestation root`);
  const t = now.getTime();
  if (t < Date.parse(cert.validFrom) || t > Date.parse(cert.validTo)) p.push(`attestation certificate is not valid now (${cert.validFrom} – ${cert.validTo})`);
  const ch = Buffer.from(challenge, 'base64');
  const hashes = [crypto.createHash('sha256').update(ch).digest(), ...(ch.length === 32 ? [ch] : [])];
  const signedBy = (h) => { try { return crypto.verify('sha256', Buffer.concat([att.authData, h]), cert.publicKey, att.signature); } catch { return false; } };
  if (!hashes.some(signedBy)) p.push('attestation signature does not verify over the authenticator data and the enrolment challenge');
  if (!ad.rpIdHash.equals(crypto.createHash('sha256').update(key.application).digest())) p.push(`attested credential is for another application than ${key.application}`);
  const ck = ad.coseKey;
  const okp = ck instanceof Map && ck.get(1) === 1 && ck.get(3) === -8 && ck.get(-1) === 6 && Buffer.isBuffer(ck.get(-2));
  if (!okp) p.push('attested credential is not an Ed25519 (COSE OKP / EdDSA) key');
  else if (!ck.get(-2).equals(key.pk)) p.push('attested credential public key is not the enrolled key');
  return p;
}
