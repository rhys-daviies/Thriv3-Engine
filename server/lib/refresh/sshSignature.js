/**
 * SSH SIGNATURE VERIFICATION — Phase DI-03F. A correction approval is authenticated by an OpenSSH
 * signature (PROTOCOL.sshsig: `ssh-keygen -Y sign -n <namespace> -f <key> <file>`) made with a key
 * enrolled for that reviewer in shared/correctionReviewers.json. A typed reviewer name proves nothing;
 * possession of the enrolled private key does.
 *
 * Supported keys: ssh-ed25519 and sk-ssh-ed25519@openssh.com (a FIDO hardware key — the signature also
 * proves a touch, which an agent or script running under the reviewer's account cannot produce).
 * Verification is pure Node crypto: no ssh-keygen needed at verify time.
 */
import crypto from 'node:crypto';

const MAGIC = Buffer.from('SSHSIG');
const SK_ED25519 = 'sk-ssh-ed25519@openssh.com';
const ED25519 = 'ssh-ed25519';
export const SUPPORTED_KEY_TYPES = Object.freeze([ED25519, SK_ED25519]);
const SK_USER_PRESENT = 0x01;
const SK_USER_VERIFIED = 0x04;
export const SK_KEY_TYPE = SK_ED25519;

/** SSH wire-format reader. */
function reader(buf) {
  let o = 0;
  const need = (n) => { if (o + n > buf.length) throw new Error('truncated SSH structure'); };
  return {
    u8() { need(1); return buf[o++]; },
    u32() { need(4); const v = buf.readUInt32BE(o); o += 4; return v; },
    bytes(n) { need(n); const b = buf.subarray(o, o + n); o += n; return b; },
    string() { return this.bytes(this.u32()); },
    done() { return o === buf.length; },
  };
}
const str = (b) => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b); const l = Buffer.alloc(4); l.writeUInt32BE(x.length); return Buffer.concat([l, x]); };

/** Parse an OpenSSH public key line ("ssh-ed25519 AAAA... comment") -> { type, blob, pk, application }. */
export function parsePublicKey(line) {
  const parts = String(line ?? '').trim().split(/\s+/);
  if (parts.length < 2) throw new Error('not an OpenSSH public key line');
  const blob = Buffer.from(parts[1], 'base64');
  const k = parsePublicKeyBlob(blob);
  if (k.type !== parts[0]) throw new Error(`public key type ${parts[0]} does not match its blob (${k.type})`);
  return k;
}

// ---- Ed25519 point validation (DI-07, DI-06 MINOR-4) -------------------------------------------------
// OpenSSL accepts the identity point as a public key and R = identity, S = 0 as a signature by it for ANY
// message, and a point has more than one 32-byte encoding when y >= p. So a key is accepted only if its
// encoding is canonical, it decodes to a curve point, and it is not of small order; a signature only if
// S < L and R is a canonical encoding of a point that is not of small order.
const P = 2n ** 255n - 19n;
/** The prime order of the Ed25519 base point. */
export const ED25519_L = 2n ** 252n + 27742317777372353535851937790883648493n;
const mod = (a) => { const r = a % P; return r < 0n ? r + P : r; };
const pow = (b, e) => { let r = 1n; let x = mod(b); let k = e; while (k > 0n) { if (k & 1n) r = mod(r * x); x = mod(x * x); k >>= 1n; } return r; };
const inv = (a) => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);
const le = (buf) => { let v = 0n; for (let i = buf.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(buf[i]); return v; };
/** Decode a 32-byte Ed25519 point (RFC 8032 §5.1.3, strict). -> [x, y] or a reason string. */
function decodePoint(enc) {
  if (!Buffer.isBuffer(enc) || enc.length !== 32) return 'not 32 bytes';
  const sign = enc[31] >> 7; const yb = Buffer.from(enc); yb[31] &= 0x7f;
  const y = le(yb);
  if (y >= P) return 'non-canonical encoding (y >= p)';
  const u = mod(y * y - 1n); const v = mod(D * y * y + 1n);
  let x = mod(u * pow(v, 3n) * pow(u * pow(v, 7n), (P - 5n) / 8n));
  if (mod(v * x * x) !== u) { if (mod(v * x * x) === mod(-u)) x = mod(x * SQRT_M1); else return 'not a point on the curve'; }
  if (x === 0n && sign === 1) return 'non-canonical encoding (x = 0 with the sign bit set)';
  if (Number(x & 1n) !== sign) x = mod(-x);
  return [x, y];
}
const add = ([x1, y1], [x2, y2]) => { const t = mod(D * x1 * x2 * y1 * y2); return [mod((x1 * y2 + y1 * x2) * inv(1n + t)), mod((y1 * y2 + x1 * x2) * inv(1n - t))]; };
/** Problem with an encoded Ed25519 point as a key or R value, or null. */
export function ed25519PointProblem(enc) {
  const pt = decodePoint(enc);
  if (typeof pt === 'string') return pt;
  let q = pt; for (let i = 0; i < 3; i++) q = add(q, q); // [8]P
  if (q[0] === 0n && q[1] === 1n) return 'small-order point (one of the 8 torsion points, including the identity)';
  return null;
}
/** Problem with a raw 64-byte Ed25519 signature R || S, or null. */
export function ed25519SignatureProblem(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 64) return 'an Ed25519 signature must be 64 bytes';
  if (le(raw.subarray(32)) >= ED25519_L) return 'non-canonical signature (S >= L)';
  const r = ed25519PointProblem(raw.subarray(0, 32));
  return r ? `invalid signature R: ${r}` : null;
}

function parsePublicKeyBlob(blob) {
  const r = reader(blob);
  const type = r.string().toString();
  if (!SUPPORTED_KEY_TYPES.includes(type)) throw new Error(`unsupported key type ${type} (supported: ${SUPPORTED_KEY_TYPES.join(', ')})`);
  const pk = Buffer.from(r.string());
  if (pk.length !== 32) throw new Error('ed25519 public key must be 32 bytes');
  const bad = ed25519PointProblem(pk);
  if (bad) throw new Error(`ed25519 public key refused: ${bad}`);
  const application = type === SK_ED25519 ? r.string().toString() : null;
  if (!r.done()) throw new Error('trailing bytes in public key');
  return { type, blob: Buffer.from(blob), pk, application };
}

/**
 * The KEY's identity, independent of how it is encoded (DI-04, DI-03I N1): every supported type is an
 * Ed25519 key, so one 32-byte public key is one key — whether enrolled as ssh-ed25519, or wrapped as
 * sk-ssh-ed25519 under any application string. Duplicate detection and two-person counting use this,
 * never the encoded blob or its fingerprint.
 */
export const keyIdentity = (k) => `ed25519:${crypto.createHash('sha256').update(k.pk).digest('hex')}`;

/** SHA256 fingerprint as ssh-keygen prints it. */
export const fingerprint = (blob) => `SHA256:${crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;

const ed25519Key = (pk) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pk.toString('base64url') }, format: 'jwk' });

/** Parse an armored SSH SIGNATURE. */
export function parseSignature(armored) {
  const m = String(armored ?? '').match(/-----BEGIN SSH SIGNATURE-----([\s\S]*?)-----END SSH SIGNATURE-----/);
  if (!m) throw new Error('not an armored SSH SIGNATURE');
  const raw = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  const r = reader(raw);
  if (!r.bytes(6).equals(MAGIC)) throw new Error('bad SSHSIG preamble');
  const version = r.u32(); if (version !== 1) throw new Error(`unsupported SSHSIG version ${version}`);
  const publicKey = Buffer.from(r.string());
  const namespace = r.string().toString();
  const reserved = Buffer.from(r.string());
  const hashAlg = r.string().toString();
  const sigBlob = Buffer.from(r.string());
  if (!r.done()) throw new Error('trailing bytes in SSHSIG');
  return { publicKey, namespace, reserved, hashAlg, sigBlob };
}

/** The bytes an SSHSIG signs over (before the key-type-specific wrapping). */
export function signedData(message, namespace, hashAlg = 'sha512', reserved = Buffer.alloc(0)) {
  if (!['sha256', 'sha512'].includes(hashAlg)) throw new Error(`unsupported hash ${hashAlg}`);
  const h = crypto.createHash(hashAlg).update(message).digest();
  return Buffer.concat([MAGIC, str(namespace), str(reserved), str(hashAlg), str(h)]);
}

/**
 * Verify `armored` over `message` (Buffer|string) for `namespace` against the allowed public key lines.
 * -> { ok, problems[], key: { type, fingerprint, identity, application, flags } | null }. Never throws.
 * `requireHardware`: the key must be sk-ssh-ed25519 and the signature must carry BOTH the user-presence
 * and the user-verification flag (a touch AND a PIN/biometric — a key made with `-O verify-required`).
 * Note the flags are only as trustworthy as the key's provenance: a software key can set any flag, so a
 * runtime-scope key must also carry verified FIDO attestation (fidoAttestation.js) at enrolment.
 */
export function verifySshSignature(message, armored, { namespace, allowedKeys = [], requireHardware = false } = {}) {
  const problems = [];
  let sig;
  try { sig = parseSignature(armored); } catch (e) { return { ok: false, problems: [e.message], key: null }; }
  let key;
  try { key = parsePublicKeyBlob(sig.publicKey); } catch (e) { return { ok: false, problems: [e.message], key: null }; }
  const fp = fingerprint(key.blob);
  const info = { type: key.type, fingerprint: fp, identity: keyIdentity(key), application: key.application, flags: null };
  if (requireHardware && key.type !== SK_ED25519) problems.push(`a ${key.type} software key cannot sign this approval — a hardware (sk-ssh-ed25519) key is required`);
  if (sig.namespace !== namespace) problems.push(`signature namespace "${sig.namespace}" is not "${namespace}"`);
  if (sig.reserved.length) problems.push('signature reserved field must be empty');
  const allowed = [];
  for (const line of allowedKeys) { try { allowed.push(parsePublicKey(line)); } catch { /* an unparseable enrolled key never matches */ } }
  if (!allowed.some((k) => k.blob.equals(key.blob))) problems.push(`signing key ${fp} is not enrolled for this reviewer`);
  try {
    const data = signedData(Buffer.isBuffer(message) ? message : Buffer.from(String(message)), sig.namespace, sig.hashAlg, sig.reserved);
    const r = reader(sig.sigBlob);
    const sigType = r.string().toString();
    const raw = Buffer.from(r.string());
    if (sigType !== key.type) problems.push(`signature type ${sigType} does not match key type ${key.type}`);
    const sigBad = ed25519SignatureProblem(raw);
    if (sigBad) problems.push(`signature refused: ${sigBad}`);
    let ok;
    if (key.type === SK_ED25519) {
      const flags = r.u8(); const counter = r.u32();
      if (!r.done()) throw new Error('trailing bytes in sk signature');
      info.flags = { userPresent: !!(flags & SK_USER_PRESENT), userVerified: !!(flags & SK_USER_VERIFIED), counter };
      if (!(flags & SK_USER_PRESENT)) problems.push('hardware-key signature was made without user presence');
      if (requireHardware && !(flags & SK_USER_VERIFIED)) problems.push('hardware-key signature was made without user verification (PIN/biometric) — enrol a key made with -O verify-required');
      const c = Buffer.alloc(4); c.writeUInt32BE(counter);
      const skData = Buffer.concat([crypto.createHash('sha256').update(key.application).digest(), Buffer.from([flags]), c, crypto.createHash('sha256').update(data).digest()]);
      ok = !sigBad && crypto.verify(null, skData, ed25519Key(key.pk), raw);
    } else {
      if (!r.done()) throw new Error('trailing bytes in signature');
      ok = !sigBad && crypto.verify(null, data, ed25519Key(key.pk), raw);
    }
    if (!ok) problems.push(`signature by ${fp} does not verify over this approval`);
  } catch (e) { problems.push(`signature unreadable: ${e.message}`); }
  return { ok: problems.length === 0, problems, key: info };
}
