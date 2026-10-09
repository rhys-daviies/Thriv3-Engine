/**
 * Shared inputs for the correction-engine regression tests (DI-03D, DI-03F). Not used by production code.
 *
 * SIGNING. Approvals are SSHSIG-signed envelopes (approvalValidator.js). This kit signs with keys
 * derived from a public seed string, so their private halves are public knowledge BY DESIGN:
 *   - REHEARSAL is the enrolled `data-integrity-rehearsal` reviewer, scope DISPOSABLE only
 *     (shared/correctionReviewers.json). Anyone may sign a rehearsal of a disposable copy with it;
 *     it can never authorise the shared or production database.
 *   - testKey(label) keys are enrolled nowhere; tests that need a SHARED_DEV / PRODUCTION reviewer
 *     mock the registry (vi.mock) to enrol them for that test only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { APPROVAL_NAMESPACE, ENVELOPE_KIND, APPROVAL_KINDS, bodyBytes, bodyHash } from './approvalValidator.js';
import { loadRegistry } from './officialEvidence.js';
import { signedData } from './sshSignature.js';

const str = (b) => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b); const l = Buffer.alloc(4); l.writeUInt32BE(x.length); return Buffer.concat([l, x]); };

/** An ed25519 key derived from a seed string. -> { privateKey, pk, blob, publicLine } */
export function testKey(label) {
  const seed = crypto.createHash('sha256').update(`thriv3 correction test key: ${label}`).digest();
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const pk = Buffer.from(crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url');
  const blob = Buffer.concat([str('ssh-ed25519'), str(pk)]);
  return { label, privateKey, pk, blob, publicLine: `ssh-ed25519 ${blob.toString('base64')} ${label}` };
}
/** A simulated FIDO (sk-ssh-ed25519) key: `userPresent` false forges a signature made without a touch. */
/** NOTE: a simulated sk key is a SOFTWARE key in sk clothing — exactly what attestation exists to reject (DI-04). */
export function testSkKey(label, application = 'ssh:thriv3-reviewer') {
  const k = testKey(label);
  const blob = Buffer.concat([str('sk-ssh-ed25519@openssh.com'), str(k.pk), str(application)]);
  return { ...k, sk: true, application, blob, publicLine: `sk-ssh-ed25519@openssh.com ${blob.toString('base64')} ${label}` };
}
const armor = (raw) => `-----BEGIN SSH SIGNATURE-----\n${raw.toString('base64').match(/.{1,70}/g).join('\n')}\n-----END SSH SIGNATURE-----\n`;

/** An OpenSSH SSHSIG signature (what `ssh-keygen -Y sign` produces) over `message`. */
export function sshSign(message, key, { namespace = APPROVAL_NAMESPACE, hashAlg = 'sha512', userPresent = true, userVerified = true } = {}) {
  const data = signedData(Buffer.isBuffer(message) ? message : Buffer.from(String(message)), namespace, hashAlg);
  let sigBlob;
  if (key.sk) {
    const flags = (userPresent ? 1 : 0) | (userVerified ? 4 : 0); /* 0x04: user verification (PIN/biometric), DI-04 */ const counter = 7; const c = Buffer.alloc(4); c.writeUInt32BE(counter);
    const skData = Buffer.concat([crypto.createHash('sha256').update(key.application).digest(), Buffer.from([flags]), c, crypto.createHash('sha256').update(data).digest()]);
    sigBlob = Buffer.concat([str('sk-ssh-ed25519@openssh.com'), str(crypto.sign(null, skData, key.privateKey)), Buffer.from([flags]), c]);
  } else sigBlob = Buffer.concat([str('ssh-ed25519'), str(crypto.sign(null, data, key.privateKey))]);
  const v = Buffer.alloc(4); v.writeUInt32BE(1);
  return armor(Buffer.concat([Buffer.from('SSHSIG'), v, str(key.blob), str(namespace), str(Buffer.alloc(0)), str(hashAlg), str(sigBlob)]));
}

export const REHEARSAL = Object.freeze({ reviewer_id: 'data-integrity-rehearsal', key: testKey('data-integrity-rehearsal (DISPOSABLE only)') });

/** Sign `body` (canonical bytes) by each { reviewer_id, key } -> a SIGNED_CORRECTION_APPROVAL envelope. */
export function signEnvelope(body, signers = [REHEARSAL]) {
  return { kind: ENVELOPE_KIND, version: 1, body, signatures: signers.map((s) => ({ reviewer_id: s.reviewer_id, signature: sshSign(bodyBytes(body), s.key) })) };
}

/** approved_at / expires_at valid at `now` (ISO), expiring 7 days later. */
export function approvalDates(now) {
  const d = new Date(now);
  return { approved_at: d.toISOString().slice(0, 10), expires_at: new Date(d.getTime() + 7 * 86_400_000).toISOString().slice(0, 10) };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'correction-kit-'));
let n = 0;
/**
 * A well-formed activation-holds file holding `ids`. -> { file, sha256 }
 * An empty holds list is unreadable by design (fail closed), so "no holds" holds a sentinel.
 */
export function holdsFile(ids, hold = 'PENDING_SEND_TIME_VERIFICATION', file = null) {
  const f = file || path.join(dir, `holds-${++n}.json`);
  const list = ids.length ? ids.map((coach_id) => ({ coach_id, hold })) : [{ coach_id: '__nobody__', hold }];
  const body = JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', version: 't', counts: { [hold]: list.length }, holds: list });
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return { file: f, sha256: crypto.createHash('sha256').update(body).digest('hex') };
}
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const tempDir = (prefix = 'correction-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** The target every in-memory test database classifies as. */
export const MEMORY_TARGET = Object.freeze({ class: 'DISPOSABLE', identity: 'disposable:memory' });

/** The evidence the domain stages of `stages` cite (registry sha per cited source; every page sha). */
export function domainEvidence(stages) {
  const reg = new Map(loadRegistry().map((e) => [e.source_id, e.sha256]));
  const src = new Map(); const pages = new Set();
  for (const s of stages) {
    if (s.type !== 'DOMAIN_OWNERSHIP_CORRECTION') continue;
    for (const a of s.fixture?.corrections || []) {
      const e = a.evidence || {};
      for (const o of e.official || []) if (reg.has(o.source_id)) src.set(o.source_id, { source_id: o.source_id, sha256: reg.get(o.source_id) });
      if (e.host_to_institution?.sha256) pages.add(e.host_to_institution.sha256);
      if (e.equivalence) for (const x of [e.equivalence.bare?.sha256, e.equivalence.www?.sha256]) if (x) pages.add(x);
    }
  }
  return { official_sources: [...src.values()], pages: [...pages] };
}

/** A COMPOSITE_CORRECTION_APPROVAL body for `stages` (sign it with signEnvelope). */
export function compositeBody({ baselineHash, stages, approval_id = 'AP-D', added = {}, removed = {}, sendable = [], noLonger = [], contactsNoLonger = [], newContacts = [], holdsSha, target = MEMORY_TARGET, now, basis = 'reviewed test approval', resolutions = null, over = {} }) {
  const domain = stages.some((s) => s.type === 'DOMAIN_OWNERSHIP_CORRECTION');
  const releases = stages.flatMap((s) => s.fixture?.hold_releases || []);
  return {
    kind: APPROVAL_KINDS.COMPOSITE, approval_id, target: { ...target }, basis, ...approvalDates(now),
    baseline: { eligible_ids_hash: baselineHash },
    stages: stages.map((s) => ({ stage_id: s.stage_id, type: s.type, group: s.group ?? null, fixture_hash: s.fixture.fixture_hash, eligibility: { added: added[s.stage_id] || [], removed: removed[s.stage_id] || [] } })),
    sendability: { newly_sendable_coaches: sendable, no_longer_sendable_coaches: noLonger, newly_sendable_contacts: newContacts, no_longer_sendable_contacts: contactsNoLonger, activation_holds_sha256: holdsSha },
    ...(domain ? { evidence: domainEvidence(stages) } : {}),
    ...(releases.length ? { hold_releases: releases.map((r) => ({ release_id: r.release_id, domain: r.domain, released_to_unitid: r.released_to_unitid, release_sha256: bodyHash(r) })) } : {}),
    ...(resolutions ? { contradiction_resolutions: resolutions } : {}),
    ...over,
  };
}

/** A COMPOSITE_REVERT_APPROVAL body for a committed manifest. */
export function revertBody({ manifest, manifestSha256, approval_id = 'RV-1', sendable = [], noLonger = [], contactsNoLonger = [], holdsSha, target = MEMORY_TARGET, now, basis = 'reviewed test revert', over = {} }) {
  return { kind: APPROVAL_KINDS.REVERT, approval_id, target: { ...target }, basis, ...approvalDates(now), ledger_id: manifest.ledger_id, manifest_sha256: manifestSha256,
    sendability: { newly_sendable_coaches: sendable, no_longer_sendable_coaches: noLonger, newly_sendable_contacts: [], no_longer_sendable_contacts: contactsNoLonger, activation_holds_sha256: holdsSha }, ...over };
}

// ---- FIDO attestation fixtures (DI-04) -----------------------------------------------------------------------
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const cborHead = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.concat([Buffer.from([(major << 5) | 25]), Buffer.from([n >> 8, n & 255])]));
const cborBytes = (b) => Buffer.concat([cborHead(2, b.length), b]);
/** COSE_Key for an Ed25519 public key: { 1: 1 (OKP), 3: -8 (EdDSA), -1: 6 (Ed25519), -2: x }. */
export const coseEd25519 = (pk) => Buffer.concat([Buffer.from([0xa4, 0x01, 0x01, 0x03, 0x27, 0x20, 0x06, 0x21]), cborBytes(pk)]);

/**
 * Is openssl available (the attestation CA fixtures need it)? Under CI (CI=true) a missing openssl is an ERROR,
 * not a skip (DI-07, DI-06 MINOR-7): the security suites must never go green by silently not running.
 */
export function hasOpenssl() {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch {
    if (process.env.CI === 'true') throw new Error('openssl is not available under CI — the attestation security suites cannot run, and they must not be skipped');
    return false;
  }
}

/**
 * A synthetic attestation CA and attestation certificate (EC P-256), made with openssl in a temp dir.
 * -> { caPem, caCert (X509Certificate), leafDer, leafKey (KeyObject) }
 */
export function testAttestationCa(label = 'Test FIDO Root', { days = 3650 } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'di04-ca-'));
  const o = (args) => execFileSync('openssl', args, { cwd: d, stdio: 'pipe' });
  o(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'ca.key']);
  o(['req', '-x509', '-new', '-key', 'ca.key', '-subj', `/CN=${label}`, '-days', String(days), '-out', 'ca.pem']);
  o(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'att.key']);
  o(['req', '-new', '-key', 'att.key', '-subj', `/CN=${label} attestation`, '-out', 'att.csr']);
  o(['x509', '-req', '-in', 'att.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', String(days), '-outform', 'DER', '-out', 'att.der']);
  const caPem = fs.readFileSync(path.join(d, 'ca.pem'), 'utf8');
  const out = { caPem, caCert: new crypto.X509Certificate(caPem), leafDer: fs.readFileSync(path.join(d, 'att.der')), leafKey: crypto.createPrivateKey(fs.readFileSync(path.join(d, 'att.key'))) };
  fs.rmSync(d, { recursive: true, force: true });
  return out;
}

/**
 * An OpenSSH ssh-sk-attest-v01 attestation for `skKey` (testSkKey), signed by `ca`'s attestation key over
 * authData || SHA-256(challenge). Overrides forge specific defects. -> { attestation, challenge } (base64)
 */
export function testAttestation(skKey, ca, { challenge = crypto.randomBytes(32), application = skKey.application, credentialPk = skKey.pk, signChallenge = challenge, flags = 0x45, cose = null, tail = Buffer.alloc(0) } = {}) {
  // flags 0x45 = UP | UV | AT (a key made with -O verify-required)
  const authData = Buffer.concat([crypto.createHash('sha256').update(application).digest(), Buffer.from([flags]), u32(0), Buffer.alloc(16), Buffer.from([0, 16]), crypto.randomBytes(16), cose ?? coseEd25519(credentialPk), tail]);
  const sig = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(signChallenge).digest()]), ca.leafKey);
  const blob = Buffer.concat([str('ssh-sk-attest-v01'), str(ca.leafDer), str(sig), str(cborBytes(authData)), u32(0), str('')]);
  return { attestation: blob.toString('base64'), challenge: Buffer.from(challenge).toString('base64') };
}

/**
 * A certificate chain made with openssl (DI-07): root -> intermediates -> leaf. Each spec may override
 * { days, ca (basicConstraints CA:TRUE), pathlen, keyCertSign }. Validity can only be made SHORT here (openssl
 * 3.0 on CI cannot backdate), so expiry is tested by evaluating at a later `now`.
 * -> { root (X509Certificate), rootPem, intermediates: [{ cert, pem }] nearest the leaf first, leafDer, leafKey }
 */
export function testCertChain({ root = {}, intermediates = [{}], leaf = {} } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'di07-chain-'));
  const o = (args) => execFileSync('openssl', args, { cwd: d, stdio: 'pipe' });
  const ext = (name, { ca = true, pathlen = null, keyCertSign = true } = {}) => {
    const lines = [`basicConstraints=critical,CA:${ca ? 'TRUE' : 'FALSE'}${ca && pathlen != null ? `,pathlen:${pathlen}` : ''}`];
    lines.push(`keyUsage=critical,${ca ? (keyCertSign ? 'keyCertSign,cRLSign' : 'digitalSignature') : 'digitalSignature'}`);
    lines.push('subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid');
    fs.writeFileSync(path.join(d, `${name}.ext`), `${lines.join('\n')}\n`);
    return `${name}.ext`;
  };
  const key = (n) => o(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${n}.key`]);
  key('root');
  fs.writeFileSync(path.join(d, 'root.cnf'), `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=${root.cn ?? 'DI-07 Test Root'}\n[v3]\nbasicConstraints=critical,CA:TRUE${root.pathlen != null ? `,pathlen:${root.pathlen}` : ''}\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n`);
  o(['req', '-x509', '-new', '-key', 'root.key', '-config', 'root.cnf', '-days', String(root.days ?? 3650), '-out', 'root.pem']);
  let issuer = 'root'; const chain = [];
  intermediates.forEach((spec, i) => {
    const n = `int${i}`; key(n);
    o(['req', '-new', '-key', `${n}.key`, '-subj', `/CN=${spec.cn ?? `DI-07 Test Intermediate ${i + 1}`}`, '-out', `${n}.csr`]);
    o(['x509', '-req', '-in', `${n}.csr`, '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-days', String(spec.days ?? 3650), '-extfile', ext(n, spec), '-out', `${n}.pem`]);
    chain.unshift({ cert: new crypto.X509Certificate(fs.readFileSync(path.join(d, `${n}.pem`))), pem: fs.readFileSync(path.join(d, `${n}.pem`), 'utf8') });
    issuer = n;
  });
  key('leaf');
  o(['req', '-new', '-key', 'leaf.key', '-subj', `/CN=${leaf.cn ?? 'DI-07 Test Attestation'}`, '-out', 'leaf.csr']);
  o(['x509', '-req', '-in', 'leaf.csr', '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-days', String(leaf.days ?? 3650), '-extfile', ext('leaf', { ca: !!leaf.ca }), '-outform', 'DER', '-out', 'leaf.der']);
  const rootPem = fs.readFileSync(path.join(d, 'root.pem'), 'utf8');
  const out = { root: new crypto.X509Certificate(rootPem), rootPem, intermediates: chain, leafDer: fs.readFileSync(path.join(d, 'leaf.der')), leafKey: crypto.createPrivateKey(fs.readFileSync(path.join(d, 'leaf.key'))) };
  fs.rmSync(d, { recursive: true, force: true });
  return out;
}
