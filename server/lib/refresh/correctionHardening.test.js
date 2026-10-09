import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

/**
 * PHASE DI-03F — regressions for every DI-03E finding, with VALID, fully populated inputs: each attack
 * carries a well-formed signed approval, an evidence store, a holds file and exact sendability sets, so
 * it can only fail on the control it targets.
 *
 * To exercise SHARED_DEV and PRODUCTION corrections end to end, THIS FILE ONLY enrols test reviewers
 * (vi.mock of reviewerRegistry.js) and treats the synthetic test sources as PRODUCTION-scoped (vi.mock
 * of sourceRegistry.js). The committed registries are unchanged: the rehearsal reviewer is still
 * DISPOSABLE-only and TEST_ONLY sources are still refused for runtime databases
 * (domainOwnershipCorrection.test.js proves both against the real files).
 */
vi.mock('./reviewerRegistry.js', async () => {
  const crypto = await import('node:crypto');
  const str = (b) => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b); const l = Buffer.alloc(4); l.writeUInt32BE(x.length); return Buffer.concat([l, x]); };
  const pk = (label) => { const seed = crypto.createHash('sha256').update(`thriv3 correction test key: ${label}`).digest(); const k = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' }); return Buffer.from(crypto.createPublicKey(k).export({ format: 'jwk' }).x, 'base64url'); };
  const ed = (label) => `ssh-ed25519 ${Buffer.concat([str('ssh-ed25519'), str(pk(label))]).toString('base64')} ${label}`;
  const sk = (label) => `sk-ssh-ed25519@openssh.com ${Buffer.concat([str('sk-ssh-ed25519@openssh.com'), str(pk(label)), str('ssh:')]).toString('base64')} ${label}`;
  const real = JSON.parse((await import('node:fs')).readFileSync((await import('node:path')).resolve(import.meta.dirname, '../../../shared/correctionReviewers.json'), 'utf8'));
  const reg = { ...real, reviewers: [...real.reviewers,
    { reviewer_id: 'test-reviewer-a', name: 'Test Reviewer A', scopes: ['DISPOSABLE', 'SHARED_DEV', 'PRODUCTION'], keys: [ed('reviewer-a')] },
    { reviewer_id: 'test-reviewer-b', name: 'Test Reviewer B', scopes: ['DISPOSABLE', 'SHARED_DEV', 'PRODUCTION'], keys: [sk('reviewer-b')] },
    { reviewer_id: 'test-dev-only', name: 'Test Dev Only', scopes: ['SHARED_DEV'], keys: [ed('dev-only')] }] };
  let extra = []; // DI-03H: reviewers a single test adds (and removes) to exercise the registry's key-uniqueness rule
  return { REVIEWERS_PATH: '(test registry)', readReviewerRegistry: () => ({ ...reg, reviewers: [...reg.reviewers, ...extra] }), __setExtraReviewers: (x) => { extra = x; } };
});
vi.mock('./sourceRegistry.js', async () => {
  const real = JSON.parse((await import('node:fs')).readFileSync((await import('node:path')).resolve(import.meta.dirname, '../../../shared/officialSourceRegistry.json'), 'utf8'));
  const reg = { ...real, sources: real.sources.filter((s) => s.scope === 'TEST_ONLY').map((s) => ({ ...s, scope: 'PRODUCTION' })) };
  return { REGISTRY_PATH: '(test registry)', readSourceRegistry: () => reg };
});

const { fixtureHash } = await import('./protectedCorrection.js');
const { DOMAIN_OWNERSHIP_KIND } = await import('./domainOwnershipCorrection.js');
const { COACH_INSTITUTION_KIND } = await import('./coachCorrection.js');
const { runCompositeCorrection, revertComposite, idSetHash, validateComposite, manifestEntryProblems } = await import('./compositeCorrection.js');
const { measureInProcess } = await import('./integrityMeasure.js');
const { evidenceStore } = await import('./officialEvidence.js');
const { verifyApproval, APPROVAL_KINDS } = await import('./approvalValidator.js');
const { correctionTarget, classifyDatabase, runtimeSignals, createDisposableCopy, markNewDisposable, MARKER_TABLE } = await import('./correctionTarget.js');
const { releaseProofProblems, releasedHeldDomains } = await import('./holdRelease.js');
const { loadRefreshContext } = await import('./context.js');
const { createIdentityResolver } = await import('./identityResolver.js');
const { manifestSha } = await import('./correctionLedger.js');
const { runMonitor } = await import('../../scripts/integrityMonitor.js');
const { holdsFile, sha256, signEnvelope, compositeBody, revertBody, testKey, testSkKey, REHEARSAL, MEMORY_TARGET } = await import('./correctionTestKit.js');
const { world, U, E, NAME, H } = await import('./domainOwnershipCorrection.world.js');

const A = { reviewer_id: 'test-reviewer-a', key: testKey('reviewer-a') };
const B = { reviewer_id: 'test-reviewer-b', key: testSkKey('reviewer-b') };
const DEV = { reviewer_id: 'test-dev-only', key: testKey('dev-only') };
const NOW = '2026-10-09T00:00:00Z'; const now = new Date(NOW);
const FIX = path.resolve(import.meta.dirname, '__fixtures__/di03d');
const tmp = (p = 'di03f-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ENV0 = { NODE_ENV: process.env.NODE_ENV, RENDER: process.env.RENDER, RECRUITMATCH_DB: process.env.RECRUITMATCH_DB };
afterEach(() => { for (const [k, v] of Object.entries(ENV0)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

// ---------- the DI-03 C1-shaped world's evidence and fixtures (same shape as domainOwnershipCorrection.test.js)
const STORE_DIR = tmp('di03f-evidence-');
const put = (bytes) => { const h = sha256(bytes); fs.writeFileSync(path.join(STORE_DIR, h), bytes); return h; };
put(fs.readFileSync(path.join(FIX, 'ipeds_test.csv'))); put(fs.readFileSync(path.join(FIX, 'ncaa_test.json')));
evidenceStore(STORE_DIR);
const html = (title, body = '') => `<!doctype html><html><head><title>${title}</title><meta property="og:site_name" content="${title}"></head><body>${body}</body></html>`;
const fetchRec = (url, finalUrl, page) => ({ url, final_url: finalUrl, http_status: 200, retrieved_at: NOW, sha256: put(Buffer.from(page)) });
const PAGES = {
  [H.HELD]: html('Home | St. Example University | San Antonio, Texas', 'One Camino Santa Example, San Antonio, Texas'),
  [H.RATTLER]: html('St. Example University Athletics - Official Athletics Website', 'San Antonio, TX 78228'),
};
const domOf = (db, d) => db.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(d);
const coachOf = (db, id) => db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
const seal = (fx) => { const { fixture_hash, ...rest } = fx; return { ...rest, fixture_hash: fixtureHash(rest) }; }; // eslint-disable-line no-unused-vars
const act = (db, host, owner, prev, orgId, status) => ({ action_id: `DO-${host}`, approval_id: 'AP-D', host, owner: { unitid: U[owner], entity: E[owner] }, previous_owner: { unitid: U[prev] },
  rows: [{ domain: host, operation: 'REASSIGN_OWNER', expected_old: { ...domOf(db, host) }, proposed: { status } }],
  evidence: { official: [{ source_id: 'TEST_IPEDS_DI03D' }, { source_id: 'TEST_NCAA_DI03D', org_id: orgId }], host_to_institution: fetchRec(`https://${host}/`, `https://${host}/`, PAGES[host]) }, reason: 'authenticated owner', blast_radius: 'one host' });
const release = (a) => ({ release_id: 'REL-STMARYTX', domain: H.HELD, hold_recorded: '2026-09-28', stored_unitid: U.CA, disputed_between: [U.CA, U.TX], released_to_unitid: U.TX, approval_id: 'AP-D',
  reason: 'Self-identification and the IPEDS WEBADDR both establish the San Antonio institution (228149) as owner.',
  evidence: { self_identification_sha256: a.evidence.host_to_institution.sha256, official_source_ids: ['TEST_IPEDS_DI03D', 'TEST_NCAA_DI03D'] }, applies_to_action: `DO-${H.HELD}` });
function c1(db) {
  const acts = [act(db, H.HELD, 'TX', 'CA', 1346, 'VERIFIED_ALIAS'), act(db, H.RATTLER, 'TX', 'CA', 1346, 'VERIFIED')];
  const D = seal({ kind: DOMAIN_OWNERSHIP_KIND, phase: 't', created_at: 't', approvals: [{ approval_id: 'AP-D', basis: 'test', hosts: acts.map((a) => a.host) }], hold_releases: [release(acts[0])], corrections: acts });
  const C = seal({ kind: COACH_INSTITUTION_KIND, phase: 't', created_at: 't', actions: [
    { action_id: 'CI-tx', coach_id: 'k-tx-misfiled', coach: 'Tex Misfiled', expected_old: { school: NAME.CA, division: 'NCAA D1', sport: 'mens-soccer', email: coachOf(db, 'k-tx-misfiled').email, email_status: 'verified' }, proposed: { school: NAME.TX, division: 'NCAA D2' }, evidence: 'current staff page', reason: 'filed at the similarly named institution' }] });
  return [{ stage_id: 'S1-domains', type: DOMAIN_OWNERSHIP_KIND, fixture: D }, { stage_id: 'S2-relabel', type: COACH_INSTITUTION_KIND, fixture: C }];
}
const SENDABLE = ['k-tx-head', 'k-tx-misfiled'];
const ELIG = { 'S1-domains': ['k-tx-head', 'k-tx-misfiled'] };
const targetOf = (db) => { const c = classifyDatabase(db); return { class: c.class, identity: c.identity }; };
const approveFor = (db, stages, holdsSha, signers = [A], opts = {}) => signEnvelope(compositeBody({ baselineHash: idSetHash(measureInProcess(db).eligible_ids), stages, added: ELIG, sendable: SENDABLE, holdsSha, now: NOW, target: targetOf(db), ...opts }), signers);

/** A SHARED_DEV database: the C1 world written into <tmp>/server/data, with the holds file its "application" enforces. */
function sharedDev({ held = SENDABLE } = {}) {
  const root = tmp('di03f-checkout-'); const data = path.join(root, 'server/data');
  fs.mkdirSync(path.join(data, 'seeds'), { recursive: true });
  const file = path.join(data, 'recruitmatch.sqlite'); const mem = world(); mem.exec(`VACUUM INTO '${file}'`); mem.close();
  const holds = holdsFile(held, 'PENDING_SEND_TIME_VERIFICATION', path.join(data, 'seeds/coach_activation_holds.json'));
  return { root, file, holds, db: new Database(file) };
}
const run = (db, stages, env, opts = {}) => runCompositeCorrection(db, stages, env, { apply: true, now: NOW, evidenceDir: STORE_DIR, ...opts });
const errOf = (f) => { try { f(); } catch (e) { return `${e.message}\n${(e.problems || []).join('\n')}`; } return 'NO ERROR'; };

describe('MAJOR-1 — positive environment classification (production can never pass as a scratch copy)', () => {
  it("Render's database path, and anything on its /data volume, is PRODUCTION from the path alone", () => {
    expect(runtimeSignals('/data/recruitmatch.sqlite').map((s) => s.class)).toContain('PRODUCTION');
    expect(runtimeSignals('/data/backups/old.sqlite').map((s) => s.class)).toContain('PRODUCTION');
    expect(runtimeSignals('/srv/data/recruitmatch.sqlite').filter((s) => s.class === 'PRODUCTION')).toEqual([]);
  });
  it('a production process classifies every file database PRODUCTION — a marked scratch copy refuses, and only :memory: is disposable', () => {
    const d = tmp(); const f = path.join(d, 'scratch.sqlite'); const db = new Database(f); markNewDisposable(db);
    process.env.NODE_ENV = 'production';
    expect(classifyDatabase(db).class).toBe('UNKNOWN');
    expect(errOf(() => correctionTarget(db, { activationHoldsFile: holdsFile(SENDABLE).file }))).toMatch(/not identified.*production process/s);
    expect(classifyDatabase(new Database(':memory:')).class).toBe('DISPOSABLE');
    db.close();
  });
  it('PRODUCTION is corrected only from inside the production service, against its own code holds; scratch holds, the rehearsal reviewer and one signer are refused', () => {
    const { db, file, holds } = sharedDev();
    process.env.RENDER = 'true';
    process.env.RECRUITMATCH_DB = '/data/recruitmatch.sqlite';
    expect(errOf(() => correctionTarget(db))).toMatch(/only from inside the production service/);
    process.env.RECRUITMATCH_DB = file;
    const t = correctionTarget(db);
    expect([t.class, t.identity]).toEqual(['PRODUCTION', 'production:/data/recruitmatch.sqlite']);
    expect(t.holdsFile).toMatch(/server\/data\/seeds\/coach_activation_holds\.json$/);
    expect(errOf(() => correctionTarget(db, { activationHoldsFile: holds.file }))).toMatch(/no other holds file can stand in/);
    const stages = c1(db);
    expect(errOf(() => run(db, stages, approveFor(db, stages, t.holdsSha256, [REHEARSAL])))).toMatch(/may not authorise a PRODUCTION database/);
    expect(errOf(() => run(db, stages, approveFor(db, stages, t.holdsSha256, [A])))).toMatch(/PRODUCTION needs 2 distinct authenticated reviewer/);
    expect(errOf(() => run(db, stages, approveFor(db, stages, t.holdsSha256, [A, A])))).toMatch(/signed more than once/);
    // two authenticated reviewers clear authentication; the run then stops on the next control (the code's real holds do not hold these coaches)
    expect(errOf(() => run(db, stages, approveFor(db, stages, t.holdsSha256, [A, B])))).toMatch(/without an activation hold/);
    db.close();
  });
  it('unidentified databases refuse: an unmarked scratch file (the prod-shaped path of DI-03E prod-a), a cp of a marked copy, a hard link', () => {
    const d = tmp(); fs.mkdirSync(path.join(d, 'data'));
    const prodShaped = path.join(d, 'data/recruitmatch.sqlite'); const mem = world(); mem.exec(`VACUUM INTO '${prodShaped}'`);
    const db1 = new Database(prodShaped);
    expect(errOf(() => correctionTarget(db1, { activationHoldsFile: holdsFile(SENDABLE).file }))).toMatch(/not an identified database/);
    const marked = path.join(d, 'marked.sqlite'); createDisposableCopy(Database, prodShaped, marked);
    fs.copyFileSync(marked, path.join(d, 'cp.sqlite'));
    expect(classifyDatabase(new Database(path.join(d, 'cp.sqlite'))).why.join(' ')).toMatch(/belongs to another file/);
    fs.linkSync(marked, path.join(d, 'hard.sqlite'));
    expect(classifyDatabase(new Database(path.join(d, 'hard.sqlite'))).why.join(' ')).toMatch(/hard links/);
    db1.close();
  });
  it('a real database can never be downgraded in place: no copy into server/data, no in-place mark of a non-empty file, a smuggled marker refuses', () => {
    const { db, file, root } = sharedDev();
    expect(errOf(() => createDisposableCopy(Database, file, path.join(root, 'server/data/copy.sqlite')))).toMatch(/runtime location/);
    expect(errOf(() => markNewDisposable(db))).toMatch(/runtime location/);
    const d = tmp(); const f = path.join(d, 'full.sqlite'); const mem = world(); mem.exec(`VACUUM INTO '${f}'`);
    expect(errOf(() => markNewDisposable(new Database(f)))).toMatch(/only a brand-new empty database/);
    db.exec(`CREATE TABLE ${MARKER_TABLE} (marker_id TEXT, file_dev TEXT, file_ino TEXT, source TEXT, created_at TEXT)`);
    const st = fs.statSync(file, { bigint: true });
    db.prepare(`INSERT INTO ${MARKER_TABLE} VALUES ('smuggled', ?, ?, 'x', 't')`).run(String(st.dev), String(st.ino));
    expect(classifyDatabase(db).why.join(' ')).toMatch(/must never be marked disposable/);
    db.close();
  });
  it('a symlink to a shared database is the shared database: scratch holds and the rehearsal reviewer are refused', () => {
    const { file, holds } = sharedDev();
    const link = path.join(tmp(), 'innocent.sqlite'); fs.symlinkSync(file, link);
    const db = new Database(link);
    expect(classifyDatabase(db).class).toBe('SHARED_DEV');
    expect(errOf(() => correctionTarget(db, { activationHoldsFile: holdsFile(SENDABLE).file }))).toMatch(/no other holds file can stand in/);
    const stages = c1(db);
    expect(errOf(() => run(db, stages, approveFor(db, stages, holds.sha256, [REHEARSAL])))).toMatch(/may not authorise a SHARED_DEV database/);
    db.close();
  });
  it('the CLI through a symlink to a shared database refuses (DI-03E: the old /data regex was bypassed this way)', () => {
    const { file, holds } = sharedDev(); const db = new Database(file); const stages = c1(db);
    const dir = tmp(); const link = path.join(dir, 'link.sqlite'); fs.symlinkSync(file, link);
    const env = approveFor(db, stages, holds.sha256, [REHEARSAL]); db.close();
    stages.forEach((s, i) => fs.writeFileSync(path.join(dir, `f${i}.json`), JSON.stringify(s.fixture)));
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ stages: stages.map((s, i) => ({ stage_id: s.stage_id, type: s.type, fixture: `f${i}.json` })) }));
    fs.writeFileSync(path.join(dir, 'approval.json'), JSON.stringify(env));
    const scratchHolds = holdsFile(SENDABLE).file;
    let out = ''; let code = 0;
    try { execFileSync(process.execPath, [path.resolve(import.meta.dirname, '../../scripts/applyCompositeCorrection.js'), '--db', link, '--plan', path.join(dir, 'plan.json'), '--approval', path.join(dir, 'approval.json'), '--activation-holds', scratchHolds, '--evidence-dir', STORE_DIR, '--apply', '--manifest-out', path.join(dir, 'm.json')], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, RECRUITMATCH_DB: ':memory:', NODE_ENV: 'test' } }); } catch (e) { code = e.status; out = `${e.stdout}${e.stderr}`; }
    expect(code).toBe(1);
    expect(out).toMatch(/SHARED_DEV.*no other holds file can stand in/s);
    expect(fs.existsSync(path.join(dir, 'm.json'))).toBe(false);
  });
  it('an approval for one database never authorises another (a disposable approval on the shared database)', () => {
    const { db, holds } = sharedDev(); const stages = c1(db);
    const env = signEnvelope(compositeBody({ baselineHash: idSetHash(measureInProcess(db).eligible_ids), stages, added: ELIG, sendable: SENDABLE, holdsSha: holds.sha256, now: NOW, target: MEMORY_TARGET }), [A]);
    expect(errOf(() => run(db, stages, env))).toMatch(/not this database/);
    db.close();
  });
});

describe('MAJOR-2 — reviewer identity is a key, not a name', () => {
  const t = (cls) => ({ class: cls, identity: cls === 'PRODUCTION' ? 'production:/data/recruitmatch.sqlite' : 'shared-dev:/x/server/data/db.sqlite' });
  const v = (signers, cls) => verifyApproval(signEnvelope(compositeBody({ baselineHash: 'x', stages: [], holdsSha: 'a'.repeat(64), now: NOW, target: t(cls) }), signers), { kind: APPROVAL_KINDS.COMPOSITE, target: t(cls), now }).problems.join('\n');
  it('an enrolled reviewer signs SHARED_DEV; production needs two distinct reviewers', () => {
    expect(v([A], 'SHARED_DEV')).toBe('');
    expect(v([DEV], 'SHARED_DEV')).toBe('');
    expect(v([A], 'PRODUCTION')).toMatch(/needs 2/);
    expect(v([A, B], 'PRODUCTION')).toBe('');
    expect(v([A, DEV], 'PRODUCTION')).toMatch(/test-dev-only may not authorise a PRODUCTION/);
  });
  it('the real reviewer id typed by someone else, with any key, is refused', () => {
    expect(v([{ reviewer_id: 'rhys-davies', key: testKey('agent-typed') }], 'SHARED_DEV')).toMatch(/rhys-davies has no enrolled signing key/);
    expect(v([{ reviewer_id: 'test-reviewer-a', key: testKey('agent-typed') }], 'SHARED_DEV')).toMatch(/not enrolled for this reviewer/);
  });
  it('a hardware-key signature made without user presence (no touch) is refused', () => {
    expect(v([A, B], 'PRODUCTION')).toBe(''); // B signs with a (simulated) FIDO key, touch present
    const body = compositeBody({ baselineHash: 'x', stages: [], holdsSha: 'a'.repeat(64), now: NOW, target: t('PRODUCTION') });
    const env = signEnvelope(body, [A, B]);
    const noTouch = { ...env, signatures: [env.signatures[0], { reviewer_id: 'test-reviewer-b', signature: signNoTouch(body) }] };
    expect(verifyApproval(noTouch, { kind: APPROVAL_KINDS.COMPOSITE, target: t('PRODUCTION'), now }).problems.join('\n')).toMatch(/without user presence/);
  });
});
const { sshSign: kitSign } = await import('./correctionTestKit.js');
const { bodyBytes } = await import('./approvalValidator.js');
function signNoTouch(body) { return kitSign(bodyBytes(body), B.key, { userPresent: false }); }

describe('MAJOR-3 — a hold release takes effect only where the database proves the authenticated, committed correction', () => {
  const REL = (r) => ({ release_id: 'REL-STMARYTX', domain: H.HELD, released_to_unitid: U.TX, ledger_id: r.manifest.ledger_id, manifest_sha256: r.manifest_sha256 });
  it('genuine: a SHARED_DEV correction signed by an enrolled reviewer is proven in that database only, and only until it is reverted', () => {
    const { db, file, holds } = sharedDev(); const stages = c1(db);
    const before = path.join(tmp(), 'before.sqlite'); createDisposableCopy(Database, file, before);
    const r = run(db, stages, approveFor(db, stages, holds.sha256));
    expect(r.manifest.target.class).toBe('SHARED_DEV');
    expect(releaseProofProblems(db, REL(r))).toEqual([]);
    const released = releasedHeldDomains(db, { releases: [REL(r)] });
    expect([...released]).toEqual([H.HELD]);
    expect(loadRefreshContext(db).resolver.ownerOfHost(H.HELD).status).toBe('HELD'); // no code-level release shipped: still held
    const ctx = loadRefreshContext(db);
    const withRelease = createIdentityResolver({ entities: ctx.entities, colleges: ctx.colleges, domains: ctx.domains, aliases: ctx.aliases, rowLinks: ctx.rowLinks, locations: ctx.locations, releasedHolds: released });
    expect(withRelease.ownerOfHost(H.HELD).entity).toBe(E.TX); // a proven release lifts it, in this database
    // the same release in a database that never received the correction: not proven
    const pre = new Database(before);
    expect(releaseProofProblems(pre, REL(r)).join('\n')).toMatch(/never committed here/);
    // after a governed revert the proof is gone
    revertComposite(db, r.manifest, signEnvelope(revertBody({ manifest: r.manifest, manifestSha256: r.manifest_sha256, noLonger: SENDABLE, holdsSha: holds.sha256, now: NOW, target: targetOf(db) }), [A]), { apply: true, now: NOW });
    expect(releaseProofProblems(db, REL(r)).join('\n')).toMatch(/is REVERTED/);
    db.close(); pre.close();
  });
  it('fabricated proofs refuse: wrong manifest hash, a release the approval does not list, a tampered ledger approval, a moved row', () => {
    const { db, holds } = sharedDev(); const stages = c1(db);
    const r = run(db, stages, approveFor(db, stages, holds.sha256));
    expect(releaseProofProblems(db, { ...REL(r), manifest_sha256: 'f'.repeat(64) }).join('\n')).toMatch(/manifest hash does not match/);
    expect(releaseProofProblems(db, { ...REL(r), release_id: 'REL-OTHER' }).join('\n')).toMatch(/does not list release REL-OTHER/);
    const row = db.prepare('SELECT approval_json FROM correction_ledger WHERE ledger_id = ?').get(r.manifest.ledger_id);
    const env = JSON.parse(row.approval_json); env.body.basis = 'rewritten after the fact';
    db.prepare('UPDATE correction_ledger SET approval_json = ? WHERE ledger_id = ?').run(JSON.stringify(env), r.manifest.ledger_id);
    expect(releaseProofProblems(db, REL(r)).join('\n')).toMatch(/does not verify/);
    db.prepare('UPDATE correction_ledger SET approval_json = ? WHERE ledger_id = ?').run(row.approval_json, r.manifest.ledger_id);
    db.prepare('UPDATE athletics_domains SET unitid = ? WHERE domain = ?').run(U.CA, H.HELD);
    expect(releaseProofProblems(db, REL(r)).join('\n')).toMatch(/no longer names 228149/);
    db.close();
  });
  it('a release whose approval id differs from the signed approval never reaches a commit (C-3)', () => {
    const { db, holds } = sharedDev(); const stages = c1(db);
    const D = stages[0].fixture; const bad = seal({ ...D, hold_releases: [{ ...D.hold_releases[0], approval_id: 'AP-OTHER' }] });
    const st = [{ ...stages[0], fixture: bad }, stages[1]];
    expect(validateComposite(st, approveFor(db, st, holds.sha256).body).join('\n')).toMatch(/approval AP-OTHER is not the signed approval AP-D/);
    db.close();
  });
});

describe('MAJOR-5 — revert is a governed write', () => {
  const committed = () => { const s = sharedDev(); const stages = c1(s.db); const r = run(s.db, stages, approveFor(s.db, stages, s.holds.sha256)); return { ...s, r }; };
  const rv = (db, r, holds, opts = {}, signers = [A]) => signEnvelope(revertBody({ manifest: r.manifest, manifestSha256: r.manifest_sha256, noLonger: SENDABLE, holdsSha: holds.sha256, now: NOW, target: targetOf(db), ...opts }), signers);
  it('no approval, a typed approval, the rehearsal reviewer on a shared database, or an approval for another manifest: refused', () => {
    const { db, r, holds } = committed();
    expect(errOf(() => revertComposite(db, r.manifest, undefined, { apply: true, now: NOW }))).toMatch(/revert refused[\s\S]*approval: missing/);
    expect(errOf(() => revertComposite(db, r.manifest, { reviewer_id: 'rhys-davies', approved_by: 'Rhys Davies' }, { apply: true, now: NOW }))).toMatch(/envelope/);
    expect(errOf(() => revertComposite(db, r.manifest, rv(db, r, holds, {}, [REHEARSAL]), { apply: true, now: NOW }))).toMatch(/may not authorise a SHARED_DEV/);
    expect(errOf(() => revertComposite(db, r.manifest, rv(db, r, holds, { manifestSha256: 'f'.repeat(64) }), { apply: true, now: NOW }))).toMatch(/revert approval is for ledger/);
    db.close();
  });
  it('a hand-written, edited or foreign manifest has no ledger row and is refused (DI-03E C-1)', () => {
    const { db, r, holds } = committed();
    const hand = { phase: 'COMPOSITE_CORRECTION', ledger_id: 'CC-handwritten', baseline: r.manifest.baseline, manifest: [{ observation_id: 'x', entries: [{ kind: 'UPDATE', table: 'athletics_domains', key: { domain: H.HELD }, old: { unitid: U.TX }, new: { unitid: U.CA } }] }] };
    expect(errOf(() => revertComposite(db, hand, rv(db, { manifest: hand, manifest_sha256: manifestSha(hand) }, holds), { apply: true, now: NOW }))).toMatch(/not a correction this database committed/);
    const edited = { ...r.manifest, manifest: [{ ...r.manifest.manifest[0], entries: [{ ...r.manifest.manifest[0].entries[0], old: { ...r.manifest.manifest[0].entries[0].old, unitid: 999999 } }] }, ...r.manifest.manifest.slice(1)] };
    expect(errOf(() => revertComposite(db, edited, rv(db, { manifest: edited, manifest_sha256: manifestSha(edited) }, holds), { apply: true, now: NOW }))).toMatch(/not byte-for-byte the one the ledger recorded/);
    db.close();
  });
  it('manifest entries are checked against an allow-list and the live schema (empty new, other tables, injected identifiers)', () => {
    const { db } = sharedDev();
    const m = (e) => manifestEntryProblems(db, [{ observation_id: 'x', entries: [e] }]).join('\n');
    expect(m({ kind: 'UPDATE', table: 'athletics_domains', key: { domain: H.HELD }, old: { unitid: U.TX }, new: {} })).toMatch(/empty "new"/);
    expect(m({ kind: 'UPDATE', table: 'operator_users', key: { id: 'u' }, old: { active: 1 }, new: { active: 0 } })).toMatch(/not a revertible correction write/);
    expect(m({ kind: 'DELETE', table: 'coaches', key: { id: 'k' }, new: { id: 'k' } })).toMatch(/not a revertible correction write/);
    expect(m({ kind: 'UPDATE', table: 'coaches', key: { id: 'k' }, old: { 'school=1--': 'x' }, new: { 'school=1--': 'y' } })).toMatch(/real columns/);
    expect(m({ kind: 'UPDATE', table: 'coaches', key: { id: 'k' }, old: { school: 'x', division: 'y' }, new: { school: 'z' } })).toMatch(/exactly the columns/);
    db.close();
  });
  it('sendability is re-evaluated: a wrong no-longer-sendable set is refused; the approved revert is exact and recorded', () => {
    const { db, r, holds, file } = committed();
    expect(errOf(() => revertComposite(db, r.manifest, rv(db, r, holds, { noLonger: [] }), { apply: true, now: NOW }))).toMatch(/no-longer-sendable coaches are not the approved set/);
    const v = revertComposite(db, r.manifest, rv(db, r, holds), { apply: true, now: NOW });
    expect(v.sendability.no_longer_sendable_coaches).toEqual(SENDABLE);
    expect(db.prepare("SELECT status FROM correction_ledger WHERE kind='COMPOSITE_CORRECTION'").get().status).toBe('REVERTED');
    expect(errOf(() => revertComposite(db, r.manifest, rv(db, r, holds, { approval_id: 'RV-2' }), { apply: true, now: NOW }))).toMatch(/already REVERTED/);
    void file; db.close();
  });
  it('stale: a corrected row changed since the commit refuses the revert and changes nothing', () => {
    const { db, r, holds } = committed();
    db.prepare("UPDATE coaches SET school = 'Other College' WHERE id = 'k-tx-misfiled'").run();
    const snap = JSON.stringify(db.prepare('SELECT * FROM coaches ORDER BY id').all());
    expect(errOf(() => revertComposite(db, r.manifest, rv(db, r, holds), { apply: true, now: NOW }))).toMatch(/revert refused/);
    expect(JSON.stringify(db.prepare('SELECT * FROM coaches ORDER BY id').all())).toBe(snap);
    db.close();
  });
});

describe('F12 — corrected rows carry the new decision; the monitor flags trusted-but-unestablished rows', () => {
  it('a SHARED_DEV correction writes CORROBORATED / DOMAIN_OWNERSHIP_CORRECTION / commit time and keeps every evidence column', () => {
    const { db, holds, file } = sharedDev(); const before = domOf(db, H.RATTLER); const stages = c1(db);
    const r = run(db, stages, approveFor(db, stages, holds.sha256));
    const after = domOf(db, H.RATTLER);
    expect([after.confidence, after.verification_method, after.checked_at]).toEqual(['CORROBORATED', 'DOMAIN_OWNERSHIP_CORRECTION', NOW]);
    for (const c of ['evidence_kind', 'evidence_text', 'identity_method', 'identity_strength', 'platform', 'http_status', 'final_url', 'claimed_keys', 'claimed_unitids']) expect(after[c]).toEqual(before[c]);
    expect(after.notes).toContain(`ledger ${r.manifest.ledger_id}`);
    db.close();
    const ok = runMonitor(file, { now, reconcile: false }).checks.find((c) => c.id === 'trusted_status_unestablished_confidence');
    expect(ok.severity).toBe('OK');
    const w = new Database(file); w.prepare("UPDATE athletics_domains SET confidence = 'NONE' WHERE domain = ?").run(H.RATTLER); w.close();
    const bad = runMonitor(file, { now, reconcile: false }).checks.find((c) => c.id === 'trusted_status_unestablished_confidence');
    expect([bad.severity, bad.count]).toEqual(['HARD', 1]);
  });
});

// =====================================================================================================
// DI-03H — the three merge-blocking DI-03G findings (MAJOR-A, -B, -D), with complete valid inputs.
// =====================================================================================================
const { __setExtraReviewers } = await import('./reviewerRegistry.js');
const { carriesDisposableMarker } = await import('../../db/disposableMarker.js');
const { databaseIdentity, ensureDatabaseIdentity } = await import('./correctionLedger.js');
const CLIENT = path.resolve(import.meta.dirname, '../../db/client.js');
/** Import db/client.js in a fresh process with RECRUITMATCH_DB=file. -> { code, out } */
function serve(file) {
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(CLIENT)}); m.default.prepare('SELECT count(*) AS n FROM coaches').get(); console.log('SERVED');`],
      { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, RECRUITMATCH_DB: file, NODE_ENV: 'test' } });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; }
}

describe('DI-03H MAJOR-A — a disposable correction copy is never served', () => {
  const marked = () => { const { file } = sharedDev(); const dest = path.join(tmp('di03h-a-'), 'copy.sqlite'); createDisposableCopy(Database, file, dest); return dest; };
  it('db/client.js refuses a marked copy before reading, changing journal mode, running schema.sql or migrating — by path and through a symlink', () => {
    const f = marked(); const before = sha256(fs.readFileSync(f));
    const r = serve(f);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/Refusing to serve .*disposable correction marker/s);
    expect(r.out).not.toMatch(/SERVED/);
    expect(sha256(fs.readFileSync(f))).toBe(before); // nothing written: no migration, no WAL switch
    expect(fs.existsSync(`${f}-wal`) || fs.existsSync(`${f}-shm`)).toBe(false);
    const link = path.join(tmp('di03h-a-link-'), 'app.sqlite'); fs.symlinkSync(f, link);
    expect(serve(link).out).toMatch(/Refusing to serve/);
  });
  it('genuine databases are unaffected: a shared-dev-shaped database and :memory: are served normally', () => {
    const { file, db } = sharedDev(); db.close();
    expect(carriesDisposableMarker(new Database(file, { readonly: true }))).toBe(false);
    expect(serve(file)).toMatchObject({ code: 0 });
    expect(serve(':memory:')).toMatchObject({ code: 0 });
  });
  it('the engine refuses a marked copy that shows signs of being served by ANY process (WAL mode or WAL side files) — DI-03G probe S1', () => {
    const f = marked();
    expect(classifyDatabase(new Database(f)).class).toBe('DISPOSABLE');
    const server = new Database(f); server.pragma('journal_mode = WAL'); server.prepare('SELECT count(*) FROM coaches').get(); // another process "serving" it
    const db = new Database(f);
    const c = classifyDatabase(db);
    expect(c.class).toBe('UNKNOWN');
    expect(c.why.join(' ')).toMatch(/signs of being served/);
    expect(errOf(() => correctionTarget(db, { activationHoldsFile: holdsFile(SENDABLE).file }))).toMatch(/not identified.*served/s);
    server.close(); db.close();
    expect(classifyDatabase(new Database(f)).class).toBe('UNKNOWN'); // WAL mode persists in the header: once served, never disposable again
  });
});

describe('DI-03H MAJOR-B — production independence is counted by key, not by reviewer id', () => {
  const t = { class: 'PRODUCTION', identity: 'production:/data/recruitmatch.sqlite' };
  const body = () => compositeBody({ baselineHash: 'x', stages: [], holdsSha: 'a'.repeat(64), now: NOW, target: t });
  const verify = (env) => verifyApproval(env, { kind: APPROVAL_KINDS.COMPOSITE, target: t, now }).problems.join('\n');
  afterEach(() => __setExtraReviewers([]));
  it('one key enrolled under two reviewer ids refuses the WHOLE registry — even a genuinely distinct pair cannot approve while it stands', () => {
    __setExtraReviewers([{ reviewer_id: 'alice-laptop', name: 'Alice (laptop)', scopes: ['PRODUCTION'], keys: [A.key.publicLine] }]);
    expect(verify(signEnvelope(body(), [A, { reviewer_id: 'alice-laptop', key: A.key }]))).toMatch(/enrolled under both test-reviewer-a and alice-laptop.*registry refused/);
    expect(verify(signEnvelope(body(), [A, B]))).toMatch(/registry refused/);
  });
  it('the same key re-encoded (different comment) is still the same key', () => {
    __setExtraReviewers([{ reviewer_id: 'alice-2', name: 'Alice Two', scopes: ['PRODUCTION'], keys: [`${A.key.publicLine.split(' ').slice(0, 2).join(' ')} another-comment`] }]);
    expect(verify(signEnvelope(body(), [A, B]))).toMatch(/one key is one person/);
  });
  it('two genuinely distinct enrolled keys pass; binding to the exact database is preserved', () => {
    expect(verify(signEnvelope(body(), [A, B]))).toBe('');
    const other = { class: 'SHARED_DEV', identity: 'shared-dev:/x/server/data/db.sqlite' };
    expect(verifyApproval(signEnvelope(body(), [A, B]), { kind: APPROVAL_KINDS.COMPOSITE, target: other, now }).problems.join('\n')).toMatch(/not this database/);
  });
  let sshKeygen = false; try { execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' }); sshKeygen = true; } catch (e) { sshKeygen = e.status != null; }
  it.skipIf(!sshKeygen)('real `ssh-keygen -Y sign` signatures: DI-03G probe B9 (alice + alice-laptop, one key) is refused; alice + bob (two keys) passes', () => {
    const d = tmp('di03h-b-'); const envNoAgent = { ...process.env }; delete envNoAgent.SSH_AUTH_SOCK;
    for (const k of ['alice', 'bob']) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `${k}-throwaway`, '-f', path.join(d, k)], { env: envNoAgent });
    const pub = (k) => fs.readFileSync(path.join(d, `${k}.pub`), 'utf8').trim();
    const b = body(); fs.writeFileSync(path.join(d, 'body.txt'), bodyBytes(b));
    const sign = (k) => { execFileSync('ssh-keygen', ['-q', '-Y', 'sign', '-n', 'thriv3-correction-approval@v1', '-f', path.join(d, k), path.join(d, 'body.txt')], { env: envNoAgent, stdio: 'ignore' }); const s = fs.readFileSync(path.join(d, 'body.txt.sig'), 'utf8'); fs.rmSync(path.join(d, 'body.txt.sig')); return s; };
    const sa = sign('alice'); const sb = sign('bob');
    const env = (sigs) => ({ kind: 'SIGNED_CORRECTION_APPROVAL', version: 1, body: b, signatures: sigs });
    __setExtraReviewers([{ reviewer_id: 'alice', name: 'Alice', scopes: ['PRODUCTION'], keys: [pub('alice')] }, { reviewer_id: 'alice-laptop', name: 'Alice Laptop', scopes: ['PRODUCTION'], keys: [pub('alice')] }]);
    expect(verify(env([{ reviewer_id: 'alice', signature: sa }, { reviewer_id: 'alice-laptop', signature: sa }]))).toMatch(/one key is one person/);
    __setExtraReviewers([{ reviewer_id: 'alice', name: 'Alice', scopes: ['PRODUCTION'], keys: [pub('alice')] }, { reviewer_id: 'bob', name: 'Bob', scopes: ['PRODUCTION'], keys: [pub('bob')] }]);
    expect(verify(env([{ reviewer_id: 'alice', signature: sa }, { reviewer_id: 'bob', signature: sb }]))).toBe('');
    expect(verify(env([{ reviewer_id: 'alice', signature: sa }, { reviewer_id: 'bob', signature: sa }]))).toMatch(/not enrolled for this reviewer/);
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('DI-03H MAJOR-D — a ledger row proves a release only in the database it was committed to', () => {
  const REL = (r) => ({ release_id: 'REL-STMARYTX', domain: H.HELD, released_to_unitid: U.TX, ledger_id: r.manifest.ledger_id, manifest_sha256: r.manifest_sha256 });
  const committedDev = () => { const s = sharedDev(); const stages = c1(s.db); const r = run(s.db, stages, approveFor(s.db, stages, s.holds.sha256)); return { ...s, r }; };
  const transplant = (from, to, r, { identity = false } = {}) => {
    const row = from.prepare('SELECT * FROM correction_ledger WHERE ledger_id = ?').get(r.manifest.ledger_id);
    to.exec(from.prepare("SELECT sql FROM sqlite_master WHERE name='correction_ledger'").get().sql);
    to.prepare(`INSERT INTO correction_ledger (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    if (identity) { const id = from.prepare('SELECT * FROM correction_database_identity').get(); to.exec(from.prepare("SELECT sql FROM sqlite_master WHERE name='correction_database_identity'").get().sql); to.prepare('INSERT INTO correction_database_identity VALUES (?,?,?,?)').run(...Object.values(id)); }
    const d = from.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(H.HELD);
    to.prepare(`UPDATE athletics_domains SET ${Object.keys(d).filter((k) => k !== 'domain').map((k) => `${k}=@${k}`).join(', ')} WHERE domain=@domain`).run(d);
  };
  it('the genuine release is still proven where it committed; the database carries a minted identity the ledger names', () => {
    const { db, r } = committedDev();
    expect(releaseProofProblems(db, REL(r))).toEqual([]);
    const id = databaseIdentity(db);
    expect([id.minted_class, id.minted_identity, r.manifest.database_id]).toEqual(['SHARED_DEV', targetOf(db).identity, id.database_id]);
    db.close();
  });
  it('DI-03G P02: ledger row (+ identity row) + domain row transplanted into ANOTHER shared-dev database by DB writes alone — refused', () => {
    const a = committedDev(); const b = sharedDev();
    transplant(a.db, b.db, a.r);
    expect(releaseProofProblems(b.db, REL(a.r)).join('\n')).toMatch(/proves nothing outside the database it was committed to/);
    const c = sharedDev(); transplant(a.db, c.db, a.r, { identity: true });
    expect(releaseProofProblems(c.db, REL(a.r)).join('\n')).toMatch(/proves nothing outside the database it was committed to/);
    a.db.close(); b.db.close(); c.db.close();
  });
  it('DI-03G P03: the same transplant into the PRE-COMMIT disposable copy — refused', () => {
    const s = sharedDev(); const pre = path.join(tmp('di03h-d-'), 'pre.sqlite'); createDisposableCopy(Database, s.file, pre);
    const stages = c1(s.db); const r = run(s.db, stages, approveFor(s.db, stages, s.holds.sha256));
    const p = new Database(pre); transplant(s.db, p, r, { identity: true });
    expect(releaseProofProblems(p, REL(r)).join('\n')).toMatch(/this database is disposable:/);
    s.db.close(); p.close();
  });
  it('a disposable copy of a CORRECTED database never inherits its identity: nothing proven there, and a rehearsal on it mints its own', () => {
    const { db, file, r } = committedDev(); db.close();
    const copy = path.join(tmp('di03h-d-'), 'after.sqlite'); createDisposableCopy(Database, file, copy);
    const c = new Database(copy);
    expect(databaseIdentity(c)).toBeNull();
    expect(releaseProofProblems(c, REL(r)).join('\n')).toMatch(/committed to shared-dev:.*this database is disposable:.*identity is absent/s);
    c.close();
  });
  it('a raw `cp` of a corrected database into another checkout is another database: no proof, and a new correction there refuses to mix ledgers', () => {
    const a = committedDev(); a.db.close();
    const b = sharedDev(); b.db.close(); fs.copyFileSync(a.file, b.file);
    const bd = new Database(b.file);
    expect(releaseProofProblems(bd, REL(a.r)).join('\n')).toMatch(/proves nothing outside the database it was committed to/);
    bd.exec('BEGIN'); try { expect(() => ensureDatabaseIdentity(bd, targetOf(bd), NOW)).toThrow(/copy of another database; refusing to mix their ledgers/); } finally { bd.exec('ROLLBACK'); }
    const rv = signEnvelope(revertBody({ manifest: a.r.manifest, manifestSha256: a.r.manifest_sha256, noLonger: SENDABLE, holdsSha: b.holds.sha256, now: NOW, target: targetOf(bd) }), [A]);
    expect(errOf(() => revertComposite(bd, a.r.manifest, rv, { apply: true, now: NOW }))).toMatch(/was committed to shared-dev:.*not this database/s);
    bd.close();
  });
  it('DI-03G P07: after a governed revert, flipping the status back and restoring the row by DB writes does not resurrect the release', () => {
    const { db, r, holds } = committedDev();
    revertComposite(db, r.manifest, signEnvelope(revertBody({ manifest: r.manifest, manifestSha256: r.manifest_sha256, noLonger: SENDABLE, holdsSha: holds.sha256, now: NOW, target: targetOf(db) }), [A]), { apply: true, now: NOW });
    db.prepare("UPDATE correction_ledger SET status = 'COMMITTED', reverted_by = NULL WHERE ledger_id = ?").run(r.manifest.ledger_id);
    db.prepare('UPDATE athletics_domains SET unitid = ? WHERE domain = ?').run(U.TX, H.HELD);
    expect(releaseProofProblems(db, REL(r)).join('\n')).toMatch(/has been reverted \(CR-/);
    db.close();
  });
});
