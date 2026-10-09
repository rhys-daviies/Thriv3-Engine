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

function parsePublicKeyBlob(blob) {
  const r = reader(blob);
  const type = r.string().toString();
  if (!SUPPORTED_KEY_TYPES.includes(type)) throw new Error(`unsupported key type ${type} (supported: ${SUPPORTED_KEY_TYPES.join(', ')})`);
  const pk = Buffer.from(r.string());
  if (pk.length !== 32) throw new Error('ed25519 public key must be 32 bytes');
  const application = type === SK_ED25519 ? r.string().toString() : null;
  if (!r.done()) throw new Error('trailing bytes in public key');
  return { type, blob: Buffer.from(blob), pk, application };
}

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
 * -> { ok, problems[], key: { type, fingerprint } | null }. Never throws.
 */
export function verifySshSignature(message, armored, { namespace, allowedKeys = [] } = {}) {
  const problems = [];
  let sig;
  try { sig = parseSignature(armored); } catch (e) { return { ok: false, problems: [e.message], key: null }; }
  let key;
  try { key = parsePublicKeyBlob(sig.publicKey); } catch (e) { return { ok: false, problems: [e.message], key: null }; }
  const fp = fingerprint(key.blob);
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
    let ok;
    if (key.type === SK_ED25519) {
      const flags = r.u8(); const counter = r.u32();
      if (!r.done()) throw new Error('trailing bytes in sk signature');
      if (!(flags & SK_USER_PRESENT)) problems.push('hardware-key signature was made without user presence');
      const c = Buffer.alloc(4); c.writeUInt32BE(counter);
      const skData = Buffer.concat([crypto.createHash('sha256').update(key.application).digest(), Buffer.from([flags]), c, crypto.createHash('sha256').update(data).digest()]);
      ok = crypto.verify(null, skData, ed25519Key(key.pk), raw);
    } else {
      if (!r.done()) throw new Error('trailing bytes in signature');
      ok = crypto.verify(null, data, ed25519Key(key.pk), raw);
    }
    if (!ok) problems.push(`signature by ${fp} does not verify over this approval`);
  } catch (e) { problems.push(`signature unreadable: ${e.message}`); }
  return { ok: problems.length === 0, problems, key: { type: key.type, fingerprint: fp } };
}
