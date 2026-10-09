import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * DI-07 — regression tests for the DI-06 Part A findings MINOR-3 (unmocked trust root at grant issuance), MINOR-4
 * (degenerate Ed25519 keys and signatures), MINOR-5 (malformed attestations), MINOR-6 (attestation chains) and
 * INFO-1 (attestation flags and application). Each FAILS against b66253a and passes on the hardened code.
 * The registry and pinned roots are mocked per test; the trust root is NOT mocked here: under the test runner it
 * cannot reach GitHub, so it fails closed exactly as an unreachable or tampered checkout would.
 */
const state = vi.hoisted(() => ({ reviewers: [], roots: [] }));
vi.mock('./reviewerRegistry.js', () => ({ REVIEWERS_PATH: '(test registry)', readReviewerRegistry: () => ({ kind: 'CORRECTION_REVIEWERS', version: 3, policy: { min_distinct_signers: { DISPOSABLE: 1, SHARED_DEV: 1, PRODUCTION: 2 } }, reviewers: state.reviewers }) }));
vi.mock('./attestationRoots.js', () => ({ attestationRoots: () => state.roots }));

const { verifyApproval, loadReviewers, APPROVAL_KINDS, APPROVAL_NAMESPACE, bodyBytes } = await import('./approvalValidator.js');
const { parsePublicKey, verifySshSignature } = await import('./sshSignature.js');
const { attestationProblems } = await import('./fidoAttestation.js');
const { applyDomainOwnershipInTransaction } = await import('./domainOwnershipCorrection.js');
const { classifyDatabase } = await import('./correctionTarget.js');
const kit = await import('./correctionTestKit.js');
const { testKey, testSkKey, testAttestationCa, testAttestation, signEnvelope, compositeBody, sshSign, coseEd25519, hasOpenssl } = kit;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = '2026-10-10T00:00:00Z'; const now = new Date(NOW);
const DISP = { class: 'DISPOSABLE', identity: 'disposable:memory' };
const RT = ['DISPOSABLE', 'SHARED_DEV', 'PRODUCTION'];
const APP = 'ssh:thriv3-reviewer';
const str = (b) => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b); const l = Buffer.alloc(4); l.writeUInt32BE(x.length); return Buffer.concat([l, x]); };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const armor = (raw) => `-----BEGIN SSH SIGNATURE-----\n${raw.toString('base64').match(/.{1,70}/g).join('\n')}\n-----END SSH SIGNATURE-----\n`;
const sshLine = (type, pk, extra = Buffer.alloc(0)) => `${type} ${Buffer.concat([str(type), str(pk), extra]).toString('base64')} c`;
const cborHead = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
const refused = (f) => { try { f(); return null; } catch (e) { return e.message; } };

afterEach(() => { state.reviewers = []; state.roots = []; });

describe('DI-07 MINOR-3 (unmocked) — verifyApproval issues no runtime grant without the trust root; the writer has nothing to accept', () => {
  it.skipIf(!hasOpenssl())('DI-06 grant bypass: an attested reviewer\'s valid SHARED_DEV approval gets no grant while the trust root fails', () => {
    const ca = testAttestationCa('DI-07 bypass'); const alice = testSkKey('alice');
    state.roots = [ca.caCert]; state.reviewers = [{ reviewer_id: 'alice', name: 'Alice', scopes: RT, keys: [{ key: alice.publicLine, ...testAttestation(alice, ca) }] }];
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'di07-gb-')); const f = path.join(d, 'server', 'data', 'recruitmatch.sqlite'); fs.mkdirSync(path.dirname(f), { recursive: true });
    const db = new Database(f); const c = classifyDatabase(db); const target = { class: c.class, identity: c.identity };
    expect(c.class).toBe('SHARED_DEV');
    const fx = { kind: 'DOMAIN_OWNERSHIP_CORRECTION', actions: [] };
    const env = signEnvelope(compositeBody({ baselineHash: 'x', stages: [], over: { stages: [{ stage_id: 's1', type: 'DOMAIN_OWNERSHIP_CORRECTION', fixture_hash: 'n/a' }] }, holdsSha: 'a'.repeat(64), now: new Date().toISOString(), target }), [{ reviewer_id: 'alice', key: alice }]);
    const { problems, grant } = verifyApproval(env, { kind: APPROVAL_KINDS.COMPOSITE, target });
    expect(problems.join('\n')).toMatch(/trust root/);
    expect(grant).toBeNull();
    db.exec('BEGIN');
    try { expect(refused(() => applyDomainOwnershipInTransaction(db, fx, { grant, ledger_id: 'CC-bypass' }))).toMatch(/grant/); } finally { db.exec('ROLLBACK'); db.close(); }
    // the same approval for a DISPOSABLE target is not gated (rehearsals)
    expect(verifyApproval(signEnvelope(compositeBody({ baselineHash: 'x', stages: [], holdsSha: 'a'.repeat(64), now: NOW, target: DISP }), [{ reviewer_id: 'alice', key: alice }]), { kind: APPROVAL_KINDS.COMPOSITE, target: DISP, now }).problems).toEqual([]);
  });
});

describe('DI-07 MINOR-4 — small-order and non-canonical Ed25519 keys and non-canonical signatures are refused', () => {
  const identity = Buffer.alloc(32); identity[0] = 1;
  const identityNc = Buffer.alloc(32, 0xff); identityNc[0] = 0xee; identityNc[31] = 0x7f; // y = 1 + p
  const SMALL_ORDER = ['0100000000000000000000000000000000000000000000000000000000000000', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    '0000000000000000000000000000000000000000000000000000000000000080', '0000000000000000000000000000000000000000000000000000000000000000',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05', '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85'];
  const forge = (pk, body) => armor(Buffer.concat([Buffer.from('SSHSIG'), u32(1), str(Buffer.concat([str('ssh-ed25519'), str(pk)])), str(APPROVAL_NAMESPACE), str(''), str('sha512'), str(Buffer.concat([str('ssh-ed25519'), str(Buffer.concat([identity, Buffer.alloc(32)]))]))]));
  it('DI-06 vector: the identity key with R = identity, S = 0 gives no approval without a private key', () => {
    state.reviewers = [{ reviewer_id: 'x', name: 'X', scopes: ['DISPOSABLE'], keys: [sshLine('ssh-ed25519', identity)] }];
    const b = compositeBody({ baselineHash: 'x', stages: [], holdsSha: 'a'.repeat(64), now: NOW, target: DISP });
    const out = verifyApproval({ kind: 'SIGNED_CORRECTION_APPROVAL', version: 1, body: b, signatures: [{ reviewer_id: 'x', signature: forge(identity, b) }] }, { kind: APPROVAL_KINDS.COMPOSITE, target: DISP, now });
    expect(out.grant).toBeNull();
    expect(out.problems.join('\n')).toMatch(/small-order|no enrolled signing key|refused/);
    // and at signature verification, even if such a key were listed as allowed
    const v = verifySshSignature(bodyBytes(b), forge(identity, b), { namespace: APPROVAL_NAMESPACE, allowedKeys: [sshLine('ssh-ed25519', identity)] });
    expect(v.ok).toBe(false); expect(v.problems.join()).toMatch(/small-order/);
  });
  it('all 8 small-order points and a non-canonical encoding (y >= p) are refused as keys, at registry load and when parsed', () => {
    for (const h of SMALL_ORDER) expect(refused(() => parsePublicKey(sshLine('ssh-ed25519', Buffer.from(h, 'hex')))), h).toMatch(/small-order/);
    expect(refused(() => parsePublicKey(sshLine('ssh-ed25519', identityNc)))).toMatch(/non-canonical/);
    expect(refused(() => parsePublicKey(sshLine('sk-ssh-ed25519@openssh.com', identity, str(APP))))).toMatch(/small-order/);
    state.reviewers = [{ reviewer_id: 'x', name: 'X', scopes: ['DISPOSABLE'], keys: [sshLine('ssh-ed25519', identity)] }, { reviewer_id: 'y', name: 'Y', scopes: ['DISPOSABLE'], keys: [sshLine('ssh-ed25519', identityNc)] }];
    const reg = loadReviewers();
    for (const r of reg.reviewers) expect(r.keys, r.reviewer_id).toEqual([]);
  });
  it('a signature with S >= L, or with a small-order R, is refused even when the key is good', () => {
    const k = testKey('canonical-s'); const m = Buffer.from('message');
    const good = sshSign(m, k);
    expect(verifySshSignature(m, good, { namespace: APPROVAL_NAMESPACE, allowedKeys: [k.publicLine] }).ok).toBe(true);
    const raw = Buffer.from(good.replace(/-----[A-Z ]+-----|\s/g, ''), 'base64');
    const sigAt = raw.length - 64; const L = 2n ** 252n + 27742317777372353535851937790883648493n;
    const le = (b) => b.reduceRight((n, x) => (n << 8n) | BigInt(x), 0n);
    const toLe = (v) => { const b = Buffer.alloc(32); for (let i = 0; i < 32; i++) { b[i] = Number(v & 255n); v >>= 8n; } return b; };
    const s = le(raw.subarray(sigAt + 32));
    const mall = Buffer.from(raw); toLe(s + L).copy(mall, sigAt + 32);
    expect(verifySshSignature(m, armor(mall), { namespace: APPROVAL_NAMESPACE, allowedKeys: [k.publicLine] }).problems.join()).toMatch(/S >= L/);
    const smallR = Buffer.from(raw); identity.copy(smallR, sigAt);
    expect(verifySshSignature(m, armor(smallR), { namespace: APPROVAL_NAMESPACE, allowedKeys: [k.publicLine] }).problems.join()).toMatch(/R: small-order|does not verify/);
  });
  it('ordinary keys are unaffected (no false refusals over many random keys)', () => {
    for (let i = 0; i < 64; i++) { const { publicKey } = crypto.generateKeyPairSync('ed25519'); const pk = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'); expect(refused(() => parsePublicKey(sshLine('ssh-ed25519', pk)))).toBeNull(); }
  });
});

/** An attestation blob with chosen authData CBOR (the attestation signature is irrelevant to the parser). */
const attWith = (authCbor, certDer = Buffer.from('cert')) => Buffer.concat([str('ssh-sk-attest-v01'), str(certDer), str(Buffer.from('sig')), str(authCbor), u32(0), str('')]).toString('base64');
const authData = ({ app = APP, flags = 0x45, cose = coseEd25519(crypto.randomBytes(32)), tail = Buffer.alloc(0) } = {}) => Buffer.concat([crypto.createHash('sha256').update(app).digest(), Buffer.from([flags]), u32(0), Buffer.alloc(16), Buffer.from([0, 16]), crypto.randomBytes(16), cose, tail]);
const bstr = (b) => Buffer.concat([cborHead(2, b.length), b]);

describe('DI-07 MINOR-5 — malformed attestations are refused as problems, never a crash', () => {
  it('the DI-06 72-byte OOM vector is refused cleanly in a memory-capped child process', () => {
    const script = `
      import crypto from 'node:crypto';
      const { attestationProblems } = await import(${JSON.stringify(path.join(HERE, 'fidoAttestation.js'))});
      const { parsePublicKey } = await import(${JSON.stringify(path.join(HERE, 'sshSignature.js'))});
      const str = (b) => { const x = Buffer.from(b); const l = Buffer.alloc(4); l.writeUInt32BE(x.length); return Buffer.concat([l, x]); };
      const { publicKey } = crypto.generateKeyPairSync('ed25519'); const pk = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
      const key = parsePublicKey('sk-ssh-ed25519@openssh.com ' + Buffer.concat([str('sk-ssh-ed25519@openssh.com'), str(pk), str('ssh:thriv3-reviewer')]).toString('base64'));
      const authData = Buffer.concat([crypto.randomBytes(32), Buffer.from([0x41]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, 0]), Buffer.from([0x9a, 0x0f, 0xff, 0xff, 0xff])]);
      const authCbor = Buffer.concat([Buffer.from([0x58, authData.length]), authData]);
      const att = Buffer.concat([str('ssh-sk-attest-v01'), str(Buffer.from('cert')), str(Buffer.from('sig')), str(authCbor), Buffer.alloc(4), str('')]);
      const p = attestationProblems(key, { attestation: att.toString('base64'), challenge: 'AA==', roots: [{}] });
      console.log(JSON.stringify({ bytes: authCbor.length, problems: p }));`;
    const r = spawnSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, NODE_OPTIONS: '' } });
    expect(r.status, r.stderr.slice(-400)).toBe(0);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    expect(out.bytes).toBeLessThanOrEqual(72); // the authData CBOR DI-06 used
    expect(out.problems.join()).toMatch(/attestation unreadable: CBOR array longer than its input/);
  });
  it('indefinite lengths, a byte string longer than its input, deep nesting, an oversized attestation, duplicate COSE keys, and trailing bytes are each refused', () => {
    const k = parsePublicKey(testSkKey('alice').publicLine);
    const p = (attestation) => attestationProblems(k, { attestation, challenge: 'AA==', roots: [{}] }).join('\n');
    expect(p(attWith(Buffer.from([0x5f, 0x41, 0x00, 0xff])))).toMatch(/indefinite/);
    expect(p(attWith(Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff, 0x00])))).toMatch(/longer than its input/);
    expect(p(attWith(bstr(authData({ cose: Buffer.concat([Buffer.alloc(40, 0x81), Buffer.from([0])]) }))))).toMatch(/nesting too deep/);
    expect(p(Buffer.alloc(20_000).toString('base64'))).toMatch(/larger than 16384 bytes/);
    const evil = crypto.randomBytes(32); const pk = k.pk;
    const dupCose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x01, 0x03, 0x27, 0x20, 0x06, 0x21, 0x58, 32]), evil, Buffer.from([0x21, 0x58, 32]), pk]);
    expect(p(attWith(bstr(authData({ cose: dupCose }))))).toMatch(/duplicate CBOR map key -2/);
    expect(p(attWith(bstr(authData({ cose: coseEd25519(pk), tail: Buffer.from('junk') }))))).toMatch(/trailing bytes in authenticator data/);
    expect(p(attWith(Buffer.concat([bstr(authData({ cose: coseEd25519(pk) })), Buffer.from([0])])))).toMatch(/trailing bytes after CBOR item/);
    expect(p(attWith(bstr(Buffer.concat([authData({ cose: coseEd25519(pk) }).subarray(0, 55), Buffer.from([0xff, 0xff])]))))).toMatch(/credential id longer|unreadable/);
  });
  it.skipIf(!hasOpenssl())('a genuine (synthetic) attestation is still accepted', () => {
    const ca = testAttestationCa('DI-07 ok'); const key = testSkKey('alice');
    expect(attestationProblems(parsePublicKey(key.publicLine), { ...testAttestation(key, ca), roots: [ca.caCert] })).toEqual([]);
  });
});

describe.skipIf(!hasOpenssl())('DI-07 INFO-1 — attestation flags and the application string', () => {
  let ca; beforeAll(() => { ca = testAttestationCa('DI-07 info'); });
  it('UP and UV must be set in the attestation authenticator data; the application must be ssh:thriv3-reviewer', () => {
    const key = testSkKey('alice'); const k = parsePublicKey(key.publicLine);
    expect(attestationProblems(k, { ...testAttestation(key, ca, { flags: 0x41 }), roots: [ca.caCert] }).join()).toMatch(/user-verified/);
    expect(attestationProblems(k, { ...testAttestation(key, ca, { flags: 0x44 }), roots: [ca.caCert] }).join()).toMatch(/user-present/);
    const web = testSkKey('alice', 'example.com');
    expect(attestationProblems(parsePublicKey(web.publicLine), { ...testAttestation(web, ca), roots: [ca.caCert] }).join()).toMatch(/application=ssh:thriv3-reviewer/);
    const other = testSkKey('alice', 'ssh:');
    expect(attestationProblems(parsePublicKey(other.publicLine), { ...testAttestation(other, ca), roots: [ca.caCert] }).join()).toMatch(/application=ssh:thriv3-reviewer/);
  });
});

describe.skipIf(!hasOpenssl())('DI-07 MINOR-6 — attestation chains: root -> intermediates -> leaf, strictly validated', () => {
  const key = testSkKey('chain-reviewer'); const k = parsePublicKey(key.publicLine);
  const later = new Date(Date.now() + 30 * 86_400_000); const earlier = new Date(Date.now() - 30 * 86_400_000);
  const check = (ch, o = {}) => attestationProblems(k, { ...testAttestation(key, ch), attestation_chain: ch.intermediates.map((x) => x.pem), roots: [ch.root], ...o }).join('\n');
  let one; let two;
  beforeAll(() => { one = kit.testCertChain(); two = kit.testCertChain({ intermediates: [{}, {}] }); });
  it('a leaf issued by an intermediate under a pinned root is ACCEPTED with the intermediate supplied (DI-06: refused outright)', () => {
    expect(check(one)).toBe('');
    expect(check(two)).toBe('');
    expect(check(one, { attestation_chain: null })).toMatch(/not issued by a pinned FIDO attestation root/);
  });
  it('wrong order, an unrelated intermediate, a repeated certificate and the root inside the chain are refused', () => {
    expect(check(two, { attestation_chain: [two.intermediates[1].pem, two.intermediates[0].pem] })).toMatch(/out of order or unrelated/);
    const other = kit.testCertChain();
    expect(check(one, { attestation_chain: [other.intermediates[0].pem] })).toMatch(/out of order or unrelated/);
    expect(check(one, { attestation_chain: [one.intermediates[0].pem, one.intermediates[0].pem] })).toMatch(/repeats a certificate/);
    expect(check(one, { attestation_chain: [one.intermediates[0].pem, one.rootPem] })).toMatch(/must not contain the pinned anchor/);
  });
  it('an intermediate that is not a CA, or lacks keyCertSign, or a pathLen the chain exceeds, is refused; a CA leaf is refused', () => {
    expect(check(kit.testCertChain({ intermediates: [{ ca: false }] }))).toMatch(/is not a CA/);
    expect(check(kit.testCertChain({ intermediates: [{ keyCertSign: false }] }))).toMatch(/lacks keyCertSign|not issued/);
    expect(check(kit.testCertChain({ root: { pathlen: 0 } }))).toMatch(/allows 0 intermediate/);
    expect(check(kit.testCertChain({ intermediates: [{ pathlen: 0 }, {}] }))).toMatch(/allows 0 intermediate/);
    expect(check(kit.testCertChain({ leaf: { ca: true } }))).toMatch(/leaf must not be a CA/);
  });
  it('an expired (or not yet valid) intermediate, leaf or pinned ROOT is refused (DI-06: an expired root verified)', () => {
    expect(check(kit.testCertChain({ intermediates: [{ days: 1 }] }), { now: later })).toMatch(/intermediate 1 .* is not valid now/);
    const shortRoot = kit.testCertChain({ root: { days: 1 }, intermediates: [] });
    expect(check(shortRoot, { now: later })).toMatch(/pinned anchor .* is not valid now/);
    expect(check(one, { now: earlier })).toMatch(/not valid now/);
  });
  it('a chain deeper than the maximum is refused', () => {
    const deep = kit.testCertChain({ intermediates: [{}, {}, {}, {}] });
    expect(check(deep)).toMatch(/at most 3 are allowed/);
  });
});
