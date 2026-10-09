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
export function testSkKey(label, application = 'ssh:') {
  const k = testKey(label);
  const blob = Buffer.concat([str('sk-ssh-ed25519@openssh.com'), str(k.pk), str(application)]);
  return { ...k, sk: true, application, blob, publicLine: `sk-ssh-ed25519@openssh.com ${blob.toString('base64')} ${label}` };
}
const armor = (raw) => `-----BEGIN SSH SIGNATURE-----\n${raw.toString('base64').match(/.{1,70}/g).join('\n')}\n-----END SSH SIGNATURE-----\n`;

/** An OpenSSH SSHSIG signature (what `ssh-keygen -Y sign` produces) over `message`. */
export function sshSign(message, key, { namespace = APPROVAL_NAMESPACE, hashAlg = 'sha512', userPresent = true } = {}) {
  const data = signedData(Buffer.isBuffer(message) ? message : Buffer.from(String(message)), namespace, hashAlg);
  let sigBlob;
  if (key.sk) {
    const flags = userPresent ? 1 : 0; const counter = 7; const c = Buffer.alloc(4); c.writeUInt32BE(counter);
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
