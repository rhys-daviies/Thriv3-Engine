import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifySshSignature, parsePublicKey, fingerprint } from './sshSignature.js';
import { testKey, testSkKey, sshSign } from './correctionTestKit.js';
import { APPROVAL_NAMESPACE } from './approvalValidator.js';

/** DI-03F — the approval signature verifier, against our own signer and against real `ssh-keygen -Y sign`. */
const MSG = Buffer.from('{"approval_id":"AP-1","basis":"reviewed"}');
let sshKeygen = false;
try { execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' }); sshKeygen = true; } catch (e) { sshKeygen = e.status != null; }

describe('SSHSIG verification', () => {
  const k = testKey('sig-test'); const sk = testSkKey('sig-test-sk');
  it('verifies ed25519 and sk-ed25519 (with touch) signatures over the exact bytes', () => {
    expect(verifySshSignature(MSG, sshSign(MSG, k), { namespace: APPROVAL_NAMESPACE, allowedKeys: [k.publicLine] }).ok).toBe(true);
    expect(verifySshSignature(MSG, sshSign(MSG, sk), { namespace: APPROVAL_NAMESPACE, allowedKeys: [sk.publicLine] }).ok).toBe(true);
    expect(verifySshSignature(MSG, sshSign(MSG, k, { hashAlg: 'sha256' }), { namespace: APPROVAL_NAMESPACE, allowedKeys: [k.publicLine] }).ok).toBe(true);
  });
  it('refuses another message, another namespace, an unenrolled key, no touch, and garbage', () => {
    const p = (m, sig, o = {}) => verifySshSignature(m, sig, { namespace: APPROVAL_NAMESPACE, allowedKeys: [k.publicLine, sk.publicLine], ...o }).problems.join('\n');
    expect(p(Buffer.from(`${MSG} `), sshSign(MSG, k))).toMatch(/does not verify/);
    expect(p(MSG, sshSign(MSG, k, { namespace: 'git' }))).toMatch(/namespace "git"/);
    expect(p(MSG, sshSign(MSG, testKey('other')))).toMatch(/not enrolled/);
    expect(p(MSG, sshSign(MSG, sk, { userPresent: false }))).toMatch(/without user presence/);
    expect(p(MSG, 'not a signature')).toMatch(/not an armored/);
    expect(p(MSG, '-----BEGIN SSH SIGNATURE-----\nU1NIU0lH\n-----END SSH SIGNATURE-----')).toMatch(/truncated/);
  });
  it('parses enrolled public keys and refuses unsupported key types', () => {
    expect(fingerprint(parsePublicKey(k.publicLine).blob)).toMatch(/^SHA256:/);
    expect(() => parsePublicKey('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ== x')).toThrow(/unsupported key type ssh-rsa/);
  });
  it.skipIf(!sshKeygen)('interoperates with real `ssh-keygen -Y sign` (the reviewer\'s actual tool)', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'di03f-sshkeygen-'));
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'throwaway', '-f', path.join(d, 'k')]);
    fs.writeFileSync(path.join(d, 'body.txt'), MSG);
    execFileSync('ssh-keygen', ['-Y', 'sign', '-n', APPROVAL_NAMESPACE, '-f', path.join(d, 'k'), path.join(d, 'body.txt')], { stdio: 'ignore' });
    const sig = fs.readFileSync(path.join(d, 'body.txt.sig'), 'utf8'); const pub = fs.readFileSync(path.join(d, 'k.pub'), 'utf8');
    expect(verifySshSignature(MSG, sig, { namespace: APPROVAL_NAMESPACE, allowedKeys: [pub] }).ok).toBe(true);
    expect(verifySshSignature(Buffer.from('tampered'), sig, { namespace: APPROVAL_NAMESPACE, allowedKeys: [pub] }).ok).toBe(false);
    fs.rmSync(d, { recursive: true, force: true });
  });
});
