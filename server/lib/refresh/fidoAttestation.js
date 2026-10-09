/**
 * FIDO ATTESTATION FOR REVIEWER KEYS — Phase DI-04 (DI-03G MAJOR-C, DI-03I N1), hardened DI-07 (DI-06 MINOR-5/6, INFO-1).
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
 *   1. the attestation certificate chains to a certificate PINNED in shared/fidoAttestationRoots.json
 *      (ships EMPTY — a human pins a vendor CA after verifying its fingerprint out of band; until then no key
 *      can be enrolled for a runtime scope: fail closed). DI-07 (MINOR-6): the chain may pass through up to
 *      MAX_INTERMEDIATES intermediate CAs. OpenSSH's attestation carries only the leaf, so intermediates come
 *      from the registry entry's `attestation_chain` (PEM strings, nearest the leaf first) — untrusted input,
 *      each link verified: signature, issuer/subject names, CA:TRUE + pathLen + keyCertSign on every CA,
 *      the leaf not a CA, no repeats, and EVERY certificate including the pinned anchor within validity now;
 *   2. the attestation signature verifies over authData || clientDataHash (clientDataHash = SHA-256 of
 *      the enrolment challenge; a 32-byte challenge used directly as the hash is also accepted, as older
 *      libfido2 builds did);
 *   3. authData's rpIdHash is SHA-256 of the key's application string, which must be REVIEWER_APPLICATION;
 *      the user-present, user-verified and attested-credential flags are set; and the credential public key
 *      (COSE OKP / EdDSA / Ed25519) is EXACTLY the enrolled key.
 *   DI-07 (MINOR-5): every structure is parsed with hard bounds — the attestation is at most
 *   MAX_ATTESTATION_BYTES, CBOR lengths can never exceed the bytes remaining, nesting is bounded, indefinite
 *   lengths, tags, floats and duplicate map keys are refused, and the attestation, its CBOR authData and the
 *   authData itself must be consumed EXACTLY (no trailing bytes). A malformed attestation is a problem string,
 *   never a crash.
 * Only "packed" (FIDO2) attestation is supported: Ed25519 is not available on U2F-only devices.
 *
 * LIMIT, STATED PLAINLY: this has been exercised against synthetic attestations built with a test CA
 * (fidoAttestation.test.js), not against a physical authenticator — the first real enrolment must be
 * checked with `node server/scripts/correctionApproval.js enrolment` before its PR is reviewed.
 */
import crypto from 'node:crypto';
import { attestationRoots } from './attestationRoots.js';

/** The application string every reviewer key must be created with (ssh-keygen -O application=...). */
export const REVIEWER_APPLICATION = 'ssh:thriv3-reviewer';
export const MAX_ATTESTATION_BYTES = 16 * 1024;
export const MAX_INTERMEDIATES = 3;
const MAX_CERT_BYTES = 8 * 1024;
const CBOR_MAX_DEPTH = 6;
const CBOR_MAX_ITEMS = 64;
const FLAG_UP = 0x01; const FLAG_UV = 0x04; const FLAG_AT = 0x40; const FLAG_ED = 0x80;

// ---- bounded CBOR (RFC 8949) reader: what authData / COSE keys use ----------------------------------
/** Decode one CBOR item at `o`. -> [value, next offset]. Throws on anything outside the strict subset. */
function cborItem(buf, o, depth) {
  if (depth > CBOR_MAX_DEPTH) throw new Error('CBOR nesting too deep');
  if (o >= buf.length) throw new Error('truncated CBOR');
  const ib = buf[o++]; const major = ib >> 5; const ai = ib & 31;
  let n;
  const need = (k) => { if (o + k > buf.length) throw new Error('truncated CBOR'); };
  if (ai < 24) n = ai;
  else if (ai === 24) { need(1); n = buf[o]; o += 1; } else if (ai === 25) { need(2); n = buf.readUInt16BE(o); o += 2; } else if (ai === 26) { need(4); n = buf.readUInt32BE(o); o += 4; } else if (ai === 27) {
    need(8); const big = buf.readBigUInt64BE(o); o += 8;
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR length or integer too large');
    n = Number(big);
  } else throw new Error('indefinite-length or reserved CBOR item refused');
  const remaining = buf.length - o;
  if (major === 0) return [n, o];
  if (major === 1) return [-1 - n, o];
  if (major === 2) { if (n > remaining) throw new Error('CBOR byte string longer than its input'); return [Buffer.from(buf.subarray(o, o + n)), o + n]; }
  if (major === 3) {
    if (n > remaining) throw new Error('CBOR text string longer than its input');
    let s; try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(o, o + n)); } catch { throw new Error('CBOR text string is not UTF-8'); }
    return [s, o + n];
  }
  if (major === 4) {
    if (n > CBOR_MAX_ITEMS || n > remaining) throw new Error('CBOR array longer than its input');
    const a = []; for (let i = 0; i < n; i++) { let v; [v, o] = cborItem(buf, o, depth + 1); a.push(v); }
    return [a, o];
  }
  if (major === 5) {
    if (n > CBOR_MAX_ITEMS || n * 2 > remaining) throw new Error('CBOR map longer than its input');
    const m = new Map();
    for (let i = 0; i < n; i++) {
      let k; let v; [k, o] = cborItem(buf, o, depth + 1);
      if (typeof k !== 'number' && typeof k !== 'string') throw new Error('CBOR map key must be an integer or text');
      if (m.has(k)) throw new Error(`duplicate CBOR map key ${k}`);
      [v, o] = cborItem(buf, o, depth + 1); m.set(k, v);
    }
    return [m, o];
  }
  throw new Error(`unsupported CBOR major type ${major}`);
}
/** Decode `buf` from `o`; `exact` requires the item to end exactly at buf.length. -> [value, next offset] */
export function cborDecode(buf, o = 0, { exact = true } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length > MAX_ATTESTATION_BYTES) throw new Error('CBOR input missing or too large');
  const [v, end] = cborItem(buf, o, 0);
  if (exact && end !== buf.length) throw new Error(`trailing bytes after CBOR item (${buf.length - end})`);
  return [v, end];
}

function sshReader(buf) {
  let o = 0;
  const need = (n) => { if (n > buf.length - o) throw new Error('truncated attestation'); };
  return { u32() { need(4); const v = buf.readUInt32BE(o); o += 4; return v; }, string() { const n = this.u32(); need(n); const b = buf.subarray(o, o + n); o += n; return Buffer.from(b); }, done: () => o === buf.length };
}

/** Parse an OpenSSH sk attestation blob. -> { certDer, signature, authData } */
export function parseAttestation(blob) {
  if (!Buffer.isBuffer(blob) || blob.length > MAX_ATTESTATION_BYTES) throw new Error(`attestation larger than ${MAX_ATTESTATION_BYTES} bytes`);
  const r = sshReader(blob);
  const ver = r.string().toString();
  if (ver !== 'ssh-sk-attest-v01') throw new Error(`unsupported attestation format ${ver.slice(0, 40)} (need ssh-sk-attest-v01)`);
  const certDer = r.string(); const signature = r.string(); const authDataCbor = r.string();
  r.u32(); r.string(); // reserved flags, reserved string
  if (!r.done()) throw new Error('trailing bytes in attestation');
  const [authData] = cborDecode(authDataCbor, 0, { exact: true });
  if (!Buffer.isBuffer(authData)) throw new Error('authenticator data is not a CBOR byte string');
  return { certDer, signature, authData };
}

/** Parse FIDO2 authenticator data, consuming it exactly. -> { rpIdHash, flags, counter, aaguid, credentialId, coseKey, extensions } */
export function parseAuthData(a) {
  if (!Buffer.isBuffer(a) || a.length < 37 + 18) throw new Error('authenticator data too short');
  const out = { rpIdHash: a.subarray(0, 32), flags: a[32], counter: a.readUInt32BE(33) };
  if (!(out.flags & FLAG_AT)) throw new Error('authenticator data carries no attested credential (AT flag clear)');
  let o = 37;
  out.aaguid = a.subarray(o, o + 16).toString('hex'); o += 16;
  const idLen = a.readUInt16BE(o); o += 2;
  if (idLen > a.length - o) throw new Error('credential id longer than the authenticator data');
  out.credentialId = a.subarray(o, o + idLen); o += idLen;
  [out.coseKey, o] = cborDecode(a, o, { exact: false });
  out.extensions = null;
  if (out.flags & FLAG_ED) { [out.extensions, o] = cborDecode(a, o, { exact: false }); if (!(out.extensions instanceof Map)) throw new Error('authenticator data extensions are not a CBOR map'); }
  if (o !== a.length) throw new Error(`trailing bytes in authenticator data (${a.length - o})`);
  return out;
}

// ---- X.509 chain (DI-07, MINOR-6) ---------------------------------------------------------------------
/** Minimal DER TLV reader with bounds. */
function der(buf, o = 0) {
  if (o + 2 > buf.length) throw new Error('truncated DER');
  const tag = buf[o]; if ((tag & 0x1f) === 0x1f) throw new Error('high-tag-number DER refused');
  let len = buf[o + 1]; let h = 2;
  if (len & 0x80) { const k = len & 0x7f; if (k < 1 || k > 4 || o + 2 + k > buf.length) throw new Error('bad DER length'); len = 0; for (let i = 0; i < k; i++) len = len * 256 + buf[o + 2 + i]; h += k; }
  if (o + h + len > buf.length) throw new Error('DER value longer than its input');
  return { tag, start: o + h, end: o + h + len, next: o + h + len };
}
const children = (buf, t) => { const out = []; let o = t.start; while (o < t.end) { const c = der(buf, o); out.push(c); o = c.next; } if (o !== t.end) throw new Error('DER overrun'); return out; };
const OID_BASIC_CONSTRAINTS = '551d13'; const OID_KEY_USAGE = '551d0f';
/** -> { basicConstraints, ca, pathLen (null = absent), keyUsage: null | { keyCertSign } } from a certificate's extensions. */
export function certificateConstraints(x509) {
  const b = x509.raw; const cert = der(b, 0); const [tbs] = children(b, cert);
  const out = { basicConstraints: false, ca: false, pathLen: null, keyUsage: null };
  for (const f of children(b, tbs)) {
    if (f.tag !== 0xa3) continue;
    const [seq] = children(b, f);
    for (const ext of children(b, seq)) {
      const parts = children(b, ext); const oid = b.subarray(parts[0].start, parts[0].end).toString('hex');
      const val = parts[parts.length - 1]; // extnValue OCTET STRING
      if (oid === OID_BASIC_CONSTRAINTS) {
        out.basicConstraints = true;
        const [bc] = children(b, val);
        for (const c of children(b, bc)) {
          if (c.tag === 0x01) out.ca = b[c.start] !== 0;
          else if (c.tag === 0x02) { if (c.end - c.start > 2) throw new Error('pathLen too large'); out.pathLen = b.subarray(c.start, c.end).reduce((n, x) => n * 256 + x, 0); }
        }
      } else if (oid === OID_KEY_USAGE) {
        const [bits] = children(b, val); // BIT STRING: unused-bits byte, then bits (bit 0 = MSB of the first byte)
        const first = bits.end - bits.start > 1 ? b[bits.start + 1] : 0;
        out.keyUsage = { keyCertSign: !!(first & 0x04) };
      }
    }
  }
  return out;
}
const validAt = (c, t) => t >= Date.parse(c.validFrom) && t <= Date.parse(c.validTo);
const label = (c) => c.subject.replace(/\n/g, ', ');
const issues = (child, parent) => { try { return child.issuer === parent.subject && child.checkIssued(parent) && child.verify(parent.publicKey); } catch { return false; } };

/**
 * Problems with the chain leaf -> intermediates[0] -> ... -> a pinned anchor, at instant `t` ([] = valid).
 * Strict: the given order only, every link verified, every CA constraint enforced, every certificate in date.
 */
export function chainProblems(leaf, intermediates, roots, t) {
  const p = [];
  if (intermediates.length > MAX_INTERMEDIATES) return [`attestation chain has ${intermediates.length} intermediates; at most ${MAX_INTERMEDIATES} are allowed`];
  const chain = [leaf, ...intermediates];
  const fps = new Set();
  for (const c of chain) { if (fps.has(c.fingerprint256)) return ['attestation chain repeats a certificate (cycle)']; fps.add(c.fingerprint256); }
  for (const r of roots) if (fps.has(r.fingerprint256)) return ['attestation chain must not contain the pinned anchor itself'];
  let lc; try { lc = certificateConstraints(leaf); } catch (e) { return [`attestation certificate unreadable: ${e.message}`]; }
  if (lc.ca) p.push('the attestation certificate is a CA certificate — a leaf must not be a CA');
  if (!validAt(leaf, t)) p.push(`attestation certificate is not valid now (${leaf.validFrom} – ${leaf.validTo})`);
  intermediates.forEach((c, i) => {
    let k; try { k = certificateConstraints(c); } catch (e) { p.push(`intermediate ${i + 1} unreadable: ${e.message}`); return; }
    if (c.issuer === c.subject) p.push(`intermediate ${i + 1} (${label(c)}) is self-issued — only a pinned anchor may be`);
    if (!k.ca) p.push(`intermediate ${i + 1} (${label(c)}) is not a CA (basicConstraints CA:TRUE required)`);
    if (k.pathLen != null && i > k.pathLen) p.push(`intermediate ${i + 1} (${label(c)}) allows ${k.pathLen} intermediate(s) below it; the chain has ${i}`);
    if (k.keyUsage && !k.keyUsage.keyCertSign) p.push(`intermediate ${i + 1} (${label(c)}) keyUsage lacks keyCertSign`);
    if (!validAt(c, t)) p.push(`intermediate ${i + 1} (${label(c)}) is not valid now (${c.validFrom} – ${c.validTo})`);
  });
  for (let i = 0; i < intermediates.length; i++) if (!issues(chain[i], chain[i + 1])) p.push(`${i === 0 ? 'the attestation certificate' : `intermediate ${i}`} (${label(chain[i])}) is not issued by intermediate ${i + 1} (${label(chain[i + 1])}) — chain out of order or unrelated`);
  const top = chain[chain.length - 1];
  const anchor = roots.find((r) => issues(top, r));
  if (!anchor) { p.push(`attestation certificate chain (${label(top)}) is not issued by a pinned FIDO attestation root`); return p; }
  let ak; try { ak = certificateConstraints(anchor); } catch (e) { return [...p, `pinned anchor unreadable: ${e.message}`]; }
  if (ak.basicConstraints && !ak.ca) p.push(`pinned anchor (${label(anchor)}) is not a CA`);
  if (ak.pathLen != null && intermediates.length > ak.pathLen) p.push(`pinned anchor (${label(anchor)}) allows ${ak.pathLen} intermediate(s); the chain has ${intermediates.length}`);
  if (ak.keyUsage && !ak.keyUsage.keyCertSign) p.push(`pinned anchor (${label(anchor)}) keyUsage lacks keyCertSign`);
  if (!validAt(anchor, t)) p.push(`pinned anchor (${label(anchor)}) is not valid now (${anchor.validFrom} – ${anchor.validTo})`);
  return p;
}

/** Parse `attestation_chain` (array of PEM strings, nearest the leaf first). -> X509Certificate[] (throws). */
export function parseChain(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error('attestation_chain must be an array of PEM certificates');
  if (list.length > MAX_INTERMEDIATES) throw new Error(`attestation chain has ${list.length} intermediates; at most ${MAX_INTERMEDIATES} are allowed`);
  return list.map((pem, i) => {
    if (typeof pem !== 'string' || pem.length > MAX_CERT_BYTES * 2) throw new Error(`attestation_chain[${i}] is not a PEM certificate`);
    try { return new crypto.X509Certificate(pem); } catch (e) { throw new Error(`attestation_chain[${i}] unreadable: ${e.message}`); }
  });
}

/**
 * Problems with one enrolled key's attestation ([] = attested via a pinned vendor certificate). Never throws.
 * `key`: the parsed enrolled public key (sshSignature.parsePublicKey) — must be sk-ssh-ed25519.
 */
export function attestationProblems(key, { attestation, challenge, attestation_chain = null, now = new Date(), roots = attestationRoots() } = {}) {
  try {
    const p = [];
    if (key?.type !== 'sk-ssh-ed25519@openssh.com') return ['only a hardware (sk-ssh-ed25519) key can be attested'];
    if (!attestation || !challenge) return ['enrolment must carry the key\'s attestation and enrolment challenge (ssh-keygen -O write-attestation, -O challenge)'];
    if (!roots.length) return ['no FIDO attestation root is pinned (shared/fidoAttestationRoots.json is empty) — a human must pin a verified vendor root before any runtime key can be enrolled'];
    if (typeof attestation !== 'string' || attestation.length > Math.ceil(MAX_ATTESTATION_BYTES / 3) * 4 + 4) return [`attestation larger than ${MAX_ATTESTATION_BYTES} bytes`];
    if (typeof challenge !== 'string' || challenge.length > 1024) return ['enrolment challenge malformed'];
    if (key.application !== REVIEWER_APPLICATION) p.push(`key application is "${key.application}"; a reviewer key must be created with -O application=${REVIEWER_APPLICATION}`);
    let att; let ad;
    try { att = parseAttestation(Buffer.from(attestation, 'base64')); ad = parseAuthData(att.authData); } catch (e) { return [...p, `attestation unreadable: ${e.message}`]; }
    if (att.certDer.length > MAX_CERT_BYTES) return [...p, 'attestation certificate too large'];
    let cert; let chain;
    try { cert = new crypto.X509Certificate(att.certDer); } catch (e) { return [...p, `attestation certificate unreadable: ${e.message}`]; }
    try { chain = parseChain(attestation_chain); } catch (e) { return [...p, e.message]; }
    p.push(...chainProblems(cert, chain, roots, asTime(now)));
    const ch = Buffer.from(challenge, 'base64');
    const hashes = [crypto.createHash('sha256').update(ch).digest(), ...(ch.length === 32 ? [ch] : [])];
    const signedBy = (h) => { try { return crypto.verify('sha256', Buffer.concat([att.authData, h]), cert.publicKey, att.signature); } catch { return false; } };
    if (!hashes.some(signedBy)) p.push('attestation signature does not verify over the authenticator data and the enrolment challenge');
    if (!ad.rpIdHash.equals(crypto.createHash('sha256').update(String(key.application)).digest())) p.push(`attested credential is for another application than ${key.application}`);
    if (!(ad.flags & FLAG_UP)) p.push('attestation authenticator data lacks the user-present flag');
    if (!(ad.flags & FLAG_UV)) p.push('attestation authenticator data lacks the user-verified flag — create the key with -O verify-required');
    const ck = ad.coseKey;
    const okp = ck instanceof Map && ck.get(1) === 1 && ck.get(3) === -8 && ck.get(-1) === 6 && Buffer.isBuffer(ck.get(-2));
    if (!okp) p.push('attested credential is not an Ed25519 (COSE OKP / EdDSA) key');
    else if (!ck.get(-2).equals(key.pk)) p.push('attested credential public key is not the enrolled key');
    return p;
  } catch (e) { return [`attestation refused: ${e.message}`]; }
}
const asTime = (now) => { const t = (now instanceof Date ? now : new Date(now)).getTime(); if (Number.isNaN(t)) throw new Error('invalid `now`'); return t; };
