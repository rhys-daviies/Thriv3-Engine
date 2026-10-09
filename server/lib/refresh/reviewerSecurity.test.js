import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

/**
 * DI-04 — reviewer security (DI-03G MAJOR-C, DI-03I N1). Spoofing, duplicate identities, replay and registry
 * rules, with REAL attestation verification: this file pins a synthetic attestation CA through the
 * attestationRoots mock and enrols reviewers through the reviewerRegistry mock. The committed registry
 * and roots are untouched (and checked as committed at the end).
 */
const state = vi.hoisted(() => ({ reviewers: [], roots: [], version: 3 }));
vi.mock('./reviewerRegistry.js', () => ({ REVIEWERS_PATH: '(test registry)', readReviewerRegistry: () => ({ kind: 'CORRECTION_REVIEWERS', version: state.version, policy: { min_distinct_signers: { DISPOSABLE: 1, SHARED_DEV: 1, PRODUCTION: 2 } }, reviewers: state.reviewers }) }));
vi.mock('./attestationRoots.js', () => ({ attestationRoots: () => state.roots }));
// DI-07: verifyApproval now enforces the trust root itself (trustRoot.test.js proves it against local repositories);
// here it passes, so these tests isolate the reviewer and key rules
vi.mock('./trustRoot.js', () => ({ trustedRuntimeState: (cls) => ({ problems: [], trusted_commit: cls === 'DISPOSABLE' ? null : 'c0ffee0000000000000000000000000000000000' }), recheckTrustedCommit: () => [] }));

const { verifyApproval, loadReviewers, APPROVAL_KINDS, REHEARSAL_KEY_LINE, bodyBytes } = await import('./approvalValidator.js');
const { testKey, testSkKey, testAttestationCa, testAttestation, hasOpenssl, signEnvelope, compositeBody, sshSign, REHEARSAL } = await import('./correctionTestKit.js');

const NOW = '2026-10-10T00:00:00Z'; const now = new Date(NOW);
const SD = { class: 'SHARED_DEV', identity: 'shared-dev:/x/server/data/recruitmatch.sqlite' };
const PROD = { class: 'PRODUCTION', identity: 'production:/data/recruitmatch.sqlite' };
const body = (target) => compositeBody({ baselineHash: 'x', stages: [], holdsSha: 'a'.repeat(64), now: NOW, target });
const verify = (env, target) => verifyApproval(env, { kind: APPROVAL_KINDS.COMPOSITE, target, now }).problems.join('\n');
const enrolled = (k, ca, o = {}) => ({ key: k.publicLine, ...testAttestation(k, ca, o) });
const RT = ['DISPOSABLE', 'SHARED_DEV', 'PRODUCTION'];

describe.skipIf(!hasOpenssl())('DI-04 reviewer security', () => {
  let ca; const alice = testSkKey('alice-hw'); const bob = testSkKey('bob-hw');
  beforeAll(() => { ca = testAttestationCa('DI-04 Reviewer Root'); });
  afterEach(() => { state.reviewers = []; state.roots = []; state.version = 3; });
  const pin = () => { state.roots = [ca.caCert]; };

  describe('hardware-backed approval (MAJOR-C)', () => {
    it('an attested hardware key, signing with touch AND PIN/biometric, approves SHARED_DEV', () => {
      pin(); state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [enrolled(alice, ca)] }];
      expect(verify(signEnvelope(body(SD), [{ reviewer_id: 'alice', key: alice }]), SD)).toBe('');
    });
    it('a signature with touch but WITHOUT user verification is refused; without touch is refused', () => {
      pin(); state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [enrolled(alice, ca)] }];
      const b = body(SD); const sig = (o) => ({ kind: 'SIGNED_CORRECTION_APPROVAL', version: 1, body: b, signatures: [{ reviewer_id: 'alice', signature: sshSign(bodyBytes(b), alice, o) }] });
      expect(verify(sig({ userVerified: false }), SD)).toMatch(/without user verification/);
      expect(verify(sig({ userPresent: false }), SD)).toMatch(/without user presence/);
    });
    it('SPOOFING: an sk-format key whose attestation is missing, self-made or for another key is not enrolled for a runtime scope', () => {
      pin();
      const mallory = testSkKey('mallory-software-in-sk-clothing'); const selfCa = testAttestationCa('Mallory Root');
      for (const keys of [[mallory.publicLine], [{ key: mallory.publicLine }], [enrolled(mallory, selfCa)], [{ key: mallory.publicLine, ...testAttestation(alice, ca) }]]) {
        state.reviewers = [{ reviewer_id: 'mallory', name: 'Mallory', scopes: RT, keys }];
        const r = loadReviewers();
        expect(r.reviewers.find((x) => x.reviewer_id === 'mallory').scopes).toEqual(['DISPOSABLE']);
        expect(verify(signEnvelope(body(SD), [{ reviewer_id: 'mallory', key: mallory }]), SD)).toMatch(/may not authorise a SHARED_DEV database .*enrolment refused/s);
      }
    });
    it('SPOOFING: a software (ssh-ed25519) key can never hold a runtime scope, and cannot sign a runtime approval', () => {
      pin(); const soft = testKey('soft-reviewer');
      state.reviewers = [{ reviewer_id: 'soft', name: 'Soft', scopes: RT, keys: [soft.publicLine] }];
      expect(loadReviewers().enrolment.soft.join()).toMatch(/only a hardware/);
      expect(verify(signEnvelope(body(SD), [{ reviewer_id: 'soft', key: soft }]), SD)).toMatch(/enrolment refused/);
    });
    it('with NO pinned root (as committed) even a genuine hardware enrolment cannot hold a runtime scope — fail closed', () => {
      state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [enrolled(alice, ca)] }];
      expect(loadReviewers().enrolment.alice.join()).toMatch(/no FIDO attestation root is pinned/);
      expect(verify(signEnvelope(body(SD), [{ reviewer_id: 'alice', key: alice }]), SD)).toMatch(/enrolment refused/);
    });
    it('SPOOFING: presenting another reviewer\'s signature, or signing under another id, is refused', () => {
      pin(); state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [enrolled(alice, ca)] }, { reviewer_id: 'bob', name: 'Bob', scopes: RT, keys: [enrolled(bob, ca)] }];
      const env = signEnvelope(body(PROD), [{ reviewer_id: 'alice', key: alice }, { reviewer_id: 'bob', key: alice }]);
      expect(verify(env, PROD)).toMatch(/signature by bob: signing key .* is not enrolled for this reviewer/);
    });
  });

  describe('duplicate identities (N1): one raw key is one person in every encoding', () => {
    it('the same key enrolled as ssh-ed25519 and as an sk-ssh-ed25519 wrapper refuses the whole registry', () => {
      pin();
      const softSame = { publicLine: `ssh-ed25519 ${Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 32]), alice.pk]).toString('base64')} same-key-software` };
      state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [enrolled(alice, ca)] }, { reviewer_id: 'alice-laptop', name: 'Alice Laptop', scopes: ['DISPOSABLE'], keys: [softSame.publicLine] }];
      expect(loadReviewers().problem).toMatch(/one key is one person; registry refused/);
      expect(verify(signEnvelope(body(SD), [{ reviewer_id: 'alice', key: alice }]), SD)).toMatch(/registry refused/);
    });
    it('two sk wrappers of one key that differ only in their application string refuse the registry (DI-03I N1)', () => {
      pin(); const alice2 = testSkKey('alice-hw', 'ssh:other-app');
      expect(alice2.pk.equals(alice.pk)).toBe(true);
      state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [enrolled(alice, ca)] }, { reviewer_id: 'alice-2', name: 'Alice Two', scopes: RT, keys: [enrolled(alice2, ca)] }];
      expect(loadReviewers().problem).toMatch(/one key is one person/);
    });
    it('PRODUCTION needs two DISTINCT attested keys; two distinct ones pass', () => {
      pin(); state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [enrolled(alice, ca)] }, { reviewer_id: 'bob', name: 'Bob', scopes: RT, keys: [enrolled(bob, ca)] }];
      expect(verify(signEnvelope(body(PROD), [{ reviewer_id: 'alice', key: alice }]), PROD)).toMatch(/needs 2 distinct authenticated reviewer key/);
      expect(verify(signEnvelope(body(PROD), [{ reviewer_id: 'alice', key: alice }, { reviewer_id: 'bob', key: bob }]), PROD)).toBe('');
    });
    it('the public-seed rehearsal key in ANY runtime scope refuses the whole registry, whatever id it is under', () => {
      pin();
      state.reviewers = [{ reviewer_id: 'sneaky', name: 'Sneaky', scopes: ['DISPOSABLE', 'SHARED_DEV'], keys: [REHEARSAL_KEY_LINE] }];
      expect(loadReviewers().problem).toMatch(/rehearsal key .* may only ever authorise DISPOSABLE/);
      state.reviewers = [{ reviewer_id: 'data-integrity-rehearsal', name: 'Rehearsal', scopes: ['DISPOSABLE'], keys: [REHEARSAL.key.publicLine] }];
      expect(loadReviewers().problem).toBeUndefined();
    });
    it('a duplicate reviewer id, and a registry of an older version, are refused', () => {
      pin(); state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [enrolled(alice, ca)] }, { reviewer_id: 'alice', name: 'Alice', scopes: ['DISPOSABLE'], keys: [] }];
      expect(loadReviewers().problem).toMatch(/enrolled more than once/);
      state.version = 2; state.reviewers = [];
      expect(loadReviewers().problem).toMatch(/not version 3/);
    });
  });

  describe('replay', () => {
    it('an approval for one database is refused on another, after expiry, and once edited', () => {
      pin(); state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [enrolled(alice, ca)] }];
      const env = signEnvelope(body(SD), [{ reviewer_id: 'alice', key: alice }]);
      expect(verify(env, { class: 'SHARED_DEV', identity: 'shared-dev:/other/server/data/recruitmatch.sqlite' })).toMatch(/not this database/);
      expect(verifyApproval(env, { kind: APPROVAL_KINDS.COMPOSITE, target: SD, now: new Date('2026-12-01') }).problems.join()).toMatch(/expired/);
      expect(verify({ ...env, body: { ...env.body, approval_id: 'AP-REPLAY' } }, SD)).toMatch(/does not verify/);
      // single use per database and refusal after a revert are proved end to end in correctionHardening.test.js
    });
  });
});

describe('the committed registry', () => {
  it('enrols no runtime key (the mocks above never touch the real file)', async () => {
    const real = JSON.parse((await import('node:fs')).readFileSync((await import('node:path')).resolve(import.meta.dirname, '../../../shared/correctionReviewers.json'), 'utf8'));
    expect(real.version).toBe(3);
    for (const r of real.reviewers) if (r.scopes.some((s) => s !== 'DISPOSABLE')) expect(r.keys).toEqual([]);
  });
});
