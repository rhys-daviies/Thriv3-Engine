import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { attestationProblems, parseAttestation } from './fidoAttestation.js';
import { parsePublicKey } from './sshSignature.js';
import { testKey, testSkKey, testAttestationCa, testAttestation, hasOpenssl } from './correctionTestKit.js';
import { attestationRoots } from './attestationRoots.js';

/**
 * DI-04 — FIDO attestation of reviewer keys, against attestations built in the authenticator's format with
 * a synthetic CA (openssl). A real authenticator's first enrolment must also be checked with
 * `correctionApproval.js verify-enrolment` (docs/CORRECTION_REVIEWER_SECURITY.md).
 */
describe.skipIf(!hasOpenssl())('FIDO attestation of a reviewer key', () => {
  const ca = testAttestationCa('DI-04 Test Root'); const other = testAttestationCa('Some Other Vendor');
  const key = testSkKey('reviewer-hw'); const parsed = parsePublicKey(key.publicLine);
  const ok = testAttestation(key, ca);
  const check = (att, o = {}) => attestationProblems(parsed, { ...att, roots: [ca.caCert], ...o }).join('\n');
  it('accepts an attestation from a pinned vendor root that certifies exactly this key', () => {
    expect(check(ok)).toBe('');
    expect(parseAttestation(Buffer.from(ok.attestation, 'base64')).certDer.length).toBeGreaterThan(100);
  });
  it('fails closed with no pinned root, and refuses a root that did not issue the certificate', () => {
    expect(check(ok, { roots: [] })).toMatch(/no FIDO attestation root is pinned/);
    expect(check(ok, { roots: [other.caCert] })).toMatch(/not issued by a pinned FIDO attestation root/);
  });
  it('refuses another key\'s attestation, another application, a different challenge, and an expired certificate', () => {
    expect(check(testAttestation(key, ca, { credentialPk: testSkKey('someone-else').pk }))).toMatch(/not the enrolled key/);
    expect(check(testAttestation(key, ca, { application: 'ssh:other' }))).toMatch(/another application/);
    expect(check({ ...ok, challenge: crypto.randomBytes(32).toString('base64') })).toMatch(/does not verify over the authenticator data and the enrolment challenge/);
    expect(check(testAttestation(key, ca, { signChallenge: Buffer.from('not the challenge') }))).toMatch(/does not verify/);
    expect(check(ok, { now: new Date('2099-01-01') })).toMatch(/not valid now/);
  });
  it('a software key in sk clothing cannot be attested by its own self-made certificate chain unless that chain is pinned', () => {
    const selfMade = testAttestationCa('Attacker Self-Signed');
    expect(check(testAttestation(key, selfMade))).toMatch(/not issued by a pinned/);
  });
  it('refuses a software key, a missing attestation, and garbage', () => {
    expect(attestationProblems(parsePublicKey(testKey('soft').publicLine), { ...ok, roots: [ca.caCert] }).join()).toMatch(/only a hardware/);
    expect(check({})).toMatch(/must carry the key's attestation/);
    expect(check({ attestation: Buffer.from('nonsense').toString('base64'), challenge: ok.challenge })).toMatch(/attestation unreadable/);
  });
});

describe('the pinned attestation roots', () => {
  it('ship empty: no runtime reviewer key can be enrolled until a human pins a verified vendor root', () => {
    expect(attestationRoots()).toEqual([]);
  });
});
