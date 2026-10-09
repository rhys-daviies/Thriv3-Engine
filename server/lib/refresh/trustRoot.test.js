import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import * as trustRoot from './trustRoot.js';

const { protectedFileProblems, PROTECTED_FILES, assertTrustedRuntimeState } = trustRoot;

/**
 * DI-04 / DI-07 — unauthorised registry / verifier changes. A runtime correction requires every protected file,
 * and every module in the correction code's import closure, to equal the protected branch as freshly fetched.
 * Exercised against local repositories standing in for GitHub: the URL (DI-07) or the remote pattern (DI-04)
 * is the only parameter changed; the engine's own call fixes it to the real repository.
 *
 * The DI-07 attack tests (MINOR-1, MINOR-2) pass parameters for both interfaces, so the same file can be run
 * against b66253a — where they FAIL, each attack passing the old check — and against the hardened code, where
 * each attack is refused.
 */
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' };
for (const k of Object.keys(ENV)) if (k.startsWith('GIT_') && !k.startsWith('GIT_AUTHOR') && !k.startsWith('GIT_COMMITTER')) delete ENV[k];
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: ENV }).toString().trim();
const FILES = ['shared/correctionReviewers.json', 'server/lib/refresh/approvalValidator.js'];
const ENTRY = 'server/lib/refresh/approvalValidator.js';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A bare "GitHub" and a checkout of it. `extra` adds files to the first commit. */
function world(extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'di07-trust-'));
  const remote = path.join(d, 'github.git'); sh(d, 'init', '-q', '--bare', '-b', 'main', remote);
  const work = path.join(d, 'checkout'); sh(d, 'clone', '-q', remote, work);
  const content = { [FILES[0]]: `${FILES[0]} v1\n`, [FILES[1]]: '// verifier\nexport const v = 1;\n', ...extra };
  for (const [f, c] of Object.entries(content)) { fs.mkdirSync(path.join(work, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(work, f), c); }
  sh(work, 'checkout', '-q', '-b', 'main'); sh(work, 'add', '-A'); sh(work, 'commit', '-qm', 'v1'); sh(work, 'push', '-q', 'origin', 'main');
  // both interfaces: DI-07 fetches `url` into a scratch repository; DI-04 fetched the `origin` remote matching `remotePattern`
  const check = (o = {}) => protectedFileProblems({ repoRoot: work, files: FILES, url: `file://${remote}`, remotePattern: new RegExp(`^${esc(remote)}$`), entryPoints: [ENTRY], manifests: [], checkDependencies: false, ...o }).problems.join('\n');
  return { d, remote, work, check };
}
const evil = 'ATTACKER registry\n';
/** Write a loose object named `oid` holding other content (git does not re-hash an object when it reads it). */
function forgeLoose(objectsDir, oid, content) {
  const dir = path.join(objectsDir, oid.slice(0, 2)); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, oid.slice(2)); if (fs.existsSync(f)) fs.chmodSync(f, 0o644);
  fs.writeFileSync(f, zlib.deflateSync(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(content)}\0`), Buffer.from(content)])));
}

describe('DI-04 trust root: protected files must equal the protected branch as fetched now', () => {
  it('a checkout identical to the protected branch passes', () => { expect(world().check()).toBe(''); });
  it('an UNAUTHORISED working-copy change to the reviewer registry is refused (an agent enrolling its own key)', () => {
    const w = world(); fs.writeFileSync(path.join(w.work, FILES[0]), '{"agent":"enrolled its own key"}\n');
    expect(w.check()).toMatch(/shared\/correctionReviewers.json differs from the protected main/);
  });
  it('a local commit that was never pushed / reviewed is refused', () => {
    const w = world(); fs.writeFileSync(path.join(w.work, FILES[1]), 'patched verifier\n'); sh(w.work, 'commit', '-qam', 'local only');
    expect(w.check()).toMatch(/approvalValidator.js differs/);
  });
  it('a forged local origin/main does not help: the protected branch is fetched fresh', () => {
    const w = world(); fs.writeFileSync(path.join(w.work, FILES[0]), 'forged\n'); sh(w.work, 'commit', '-qam', 'forged');
    sh(w.work, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    expect(w.check()).toMatch(/correctionReviewers.json differs/);
  });
  it('a checkout behind the protected branch (the registry changed upstream) is refused', () => {
    const w = world(); const other = path.join(w.d, 'other'); sh(w.d, 'clone', '-q', w.remote, other);
    fs.writeFileSync(path.join(other, FILES[0]), 'v2 reviewed upstream\n'); sh(other, 'commit', '-qam', 'v2'); sh(other, 'push', '-q', 'origin', 'main');
    expect(w.check()).toMatch(/differs from the protected main/);
  });
  it('an unreachable protected repository and a protected file missing upstream fail closed; a symlinked protected file is refused', () => {
    const w = world(); fs.rmSync(w.remote, { recursive: true, force: true });
    expect(w.check({ remotePattern: /.*/ })).toMatch(/cannot fetch main/);
    const w2 = world(); expect(w2.check({ files: [...FILES, 'shared/notThere.json'] })).toMatch(/notThere.json is not on the protected main/);
    const w3 = world(); const alt = path.join(w3.d, 'alt.json'); fs.writeFileSync(alt, evil);
    fs.rmSync(path.join(w3.work, FILES[0])); fs.symlinkSync(alt, path.join(w3.work, FILES[0]));
    expect(w3.check()).toMatch(/not a regular file|differs/);
  });
  it('the engine pins the real repository, protects the registries and verifier code, and never gates disposable rehearsals', () => {
    expect(trustRoot.TRUSTED_URL).toBe('https://github.com/rhys-daviies/Thriv3-Engine.git');
    for (const f of ['shared/correctionReviewers.json', 'shared/fidoAttestationRoots.json', 'server/lib/refresh/approvalValidator.js', 'server/lib/refresh/sshSignature.js', 'server/lib/refresh/fidoAttestation.js', 'server/lib/refresh/trustRoot.js', 'server/lib/refresh/importClosure.js']) expect(PROTECTED_FILES).toContain(f);
    expect(assertTrustedRuntimeState('DISPOSABLE')).toEqual([]);
  });
});

describe('DI-07 MINOR-1: the trusted content cannot be substituted through the checkout\'s git state or the environment', () => {
  it('git replace of the trusted blob (DI-06 case B) no longer makes a modified registry look trusted', () => {
    const w = world(); fs.writeFileSync(path.join(w.work, FILES[0]), evil);
    const forged = sh(w.work, 'hash-object', '-w', FILES[0]); const good = sh(w.work, 'rev-parse', `HEAD:${FILES[0]}`);
    sh(w.work, 'replace', good, forged);
    expect(w.check()).toMatch(/correctionReviewers.json differs from the protected main/);
  });
  it('a forged loose object under the trusted blob id, in the checkout\'s own object store, is not trusted', () => {
    const w = world(); const good = sh(w.work, 'rev-parse', `HEAD:${FILES[0]}`);
    forgeLoose(path.join(w.work, '.git', 'objects'), good, evil); fs.writeFileSync(path.join(w.work, FILES[0]), evil);
    expect(w.check()).toMatch(/correctionReviewers.json differs/);
  });
  it('.git/objects/info/alternates pointing at forged objects is not consulted', () => {
    const w = world(); const good = sh(w.work, 'rev-parse', `HEAD:${FILES[0]}`);
    const alt = path.join(w.d, 'alt-objects'); forgeLoose(alt, good, evil);
    fs.rmSync(path.join(w.work, '.git', 'objects', good.slice(0, 2), good.slice(2)), { force: true });
    fs.mkdirSync(path.join(w.work, '.git', 'objects', 'info'), { recursive: true });
    fs.writeFileSync(path.join(w.work, '.git', 'objects', 'info', 'alternates'), `${alt}\n`);
    fs.writeFileSync(path.join(w.work, FILES[0]), evil);
    expect(w.check()).toMatch(/correctionReviewers.json differs/);
  });
  it('GIT_DIR / GIT_OBJECT_DIRECTORY / GIT_ALTERNATE_OBJECT_DIRECTORIES in the environment are not inherited', () => {
    const run = (vars) => {
      const w = world(); const set = vars(w); fs.writeFileSync(path.join(w.work, FILES[0]), evil);
      const saved = {}; for (const [k, v] of Object.entries(set)) { saved[k] = process.env[k]; process.env[k] = v; }
      try { return w.check(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    };
    // a primary object directory holding a forged blob under the trusted id, the real objects as an alternate
    expect(run((w) => {
      const o = path.join(w.d, 'evil-objects'); forgeLoose(o, sh(w.work, 'rev-parse', `HEAD:${FILES[0]}`), evil);
      return { GIT_OBJECT_DIRECTORY: o, GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(w.work, '.git', 'objects') };
    })).toMatch(/correctionReviewers.json differs/);
    // a whole other git directory, whose origin is the protected repository, carrying a replace ref
    expect(run((w) => {
      const g = path.join(w.d, 'evil.git'); sh(w.d, 'clone', '-q', '--bare', w.remote, g);
      const good = sh(g, 'rev-parse', `main:${FILES[0]}`);
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: g, input: evil, env: { ...ENV, GIT_DIR: g } }).toString().trim();
      sh(g, 'replace', good, blob); sh(g, 'config', 'remote.origin.url', w.remote);
      return { GIT_DIR: g, GIT_WORK_TREE: w.work };
    })).toMatch(/correctionReviewers.json differs/);
  });
  it('url.insteadOf in the checkout\'s config, or injected through GIT_CONFIG_*, cannot redirect the fetch to an attacker repository', () => {
    const w = world(); const atk = path.join(w.d, 'attacker.git'); sh(w.d, 'clone', '-q', '--bare', w.remote, atk);
    const t = path.join(w.d, 'atkwork'); sh(w.d, 'clone', '-q', atk, t); fs.writeFileSync(path.join(t, FILES[0]), evil); sh(t, 'commit', '-qam', 'evil'); sh(t, 'push', '-q', 'origin', 'main');
    fs.writeFileSync(path.join(w.work, FILES[0]), evil);
    sh(w.work, 'config', `url.${atk}.insteadOf`, w.remote); sh(w.work, 'config', `url.file://${atk}.insteadOf`, `file://${w.remote}`);
    expect(w.check()).toMatch(/correctionReviewers.json differs|not the protected repository/);
    sh(w.work, 'config', '--remove-section', `url.${atk}`); sh(w.work, 'config', '--remove-section', `url.file://${atk}`);
    Object.assign(process.env, { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: `url.${atk}.insteadOf`, GIT_CONFIG_VALUE_0: w.remote, GIT_CONFIG_KEY_1: `url.file://${atk}.insteadOf`, GIT_CONFIG_VALUE_1: `file://${w.remote}` });
    try { expect(w.check()).toMatch(/correctionReviewers.json differs|not the protected repository/); } finally { for (const k of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1']) delete process.env[k]; }
  });
  it('the checkout\'s hooks and fsmonitor never execute during the check', () => {
    const w = world(); const mark = path.join(w.d, 'executed');
    for (const h of ['reference-transaction', 'post-checkout', 'post-merge', 'pre-auto-gc']) { const f = path.join(w.work, '.git', 'hooks', h); fs.writeFileSync(f, `#!/bin/sh\necho ${h} >> ${mark}\n`); fs.chmodSync(f, 0o755); }
    const fsm = path.join(w.d, 'fsmonitor.sh'); fs.writeFileSync(fsm, `#!/bin/sh\necho fsmonitor >> ${mark}\n`); fs.chmodSync(fsm, 0o755); sh(w.work, 'config', 'core.fsmonitor', fsm);
    expect(w.check()).toBe('');
    expect(fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8') : '').toBe('');
  });
  it('the git subprocess environment is built from nothing (no inherited GIT_*, proxy or TLS variables)', () => {
    expect(typeof trustRoot.sanitizedGitEnv).toBe('function');
    const env = trustRoot.sanitizedGitEnv('/tmp/x');
    expect(Object.keys(env).filter((k) => k.startsWith('GIT_')).sort()).toEqual(['GIT_ALLOW_PROTOCOL', 'GIT_ASKPASS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_NO_REPLACE_OBJECTS', 'GIT_TERMINAL_PROMPT']);
    expect(env).toMatchObject({ GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', HOME: '/tmp/x' });
    for (const k of ['HTTPS_PROXY', 'https_proxy', 'SSL_CERT_FILE', 'CURL_CA_BUNDLE', 'GIT_SSL_NO_VERIFY', 'GIT_SSH_COMMAND']) expect(env[k]).toBeUndefined();
  });
});

describe('DI-07 MINOR-2: the whole import closure of the correction code is protected', () => {
  const extra = {
    [ENTRY]: "import { helper } from './helper.js';\nexport const v = helper();\n",
    'server/lib/refresh/helper.js': "import { deep } from '../deep.js';\nexport const helper = () => deep;\n",
    'server/lib/deep.js': 'export const deep = 1; // not in any hand-kept list\n',
  };
  it('an edit to a module the entry point imports transitively — listed nowhere — is refused (DI-06: 36 such modules)', () => {
    const w = world(extra); expect(w.check()).toBe('');
    fs.writeFileSync(path.join(w.work, 'server/lib/deep.js'), "import crypto from 'node:crypto'; crypto.verify = () => true; export const deep = 1;\n");
    expect(w.check()).toMatch(/server\/lib\/deep.js differs from the protected main/);
  });
  it('a new local module imported by a closure file is refused (the importer differs, and the new module is not on main)', () => {
    const w = world(extra);
    fs.writeFileSync(path.join(w.work, 'server/lib/refresh/helper.js'), "import './patch.js';\nimport { deep } from '../deep.js';\nexport const helper = () => deep;\n");
    fs.writeFileSync(path.join(w.work, 'server/lib/refresh/patch.js'), 'globalThis.patched = true;\n');
    expect(w.check()).toMatch(/helper.js differs/);
  });
  it('a closure module on main that loads code the closure cannot follow fails closed', () => {
    const w = world({ [ENTRY]: "const m = 'x'; await import(m); export const v = 1;\n" });
    expect(w.check()).toMatch(/non-literal/);
    const w2 = world({ [ENTRY]: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); require('./x.cjs');\n" });
    expect(w2.check()).toMatch(/CommonJS/);
  });
  it('package.json and package-lock.json are protected; a shadowing node_modules or a version other than the lock\'s is refused', () => {
    const lock = { name: 'x', lockfileVersion: 3, packages: { '': {}, 'node_modules/dep': { version: '1.0.0', dependencies: { sub: '^2' } }, 'node_modules/sub': { version: '2.0.0' } } };
    const w = world({ [ENTRY]: "import d from 'dep';\nexport const v = d;\n", 'package.json': '{"name":"x"}\n', 'package-lock.json': `${JSON.stringify(lock)}\n`, '.gitignore': 'node_modules/\n' });
    const ck = (o = {}) => w.check({ manifests: ['package.json', 'package-lock.json'], checkDependencies: true, ...o });
    const pkg = (name, version, root = w.work) => { fs.mkdirSync(path.join(root, 'node_modules', name), { recursive: true }); fs.writeFileSync(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version })); };
    pkg('dep', '1.0.0'); pkg('sub', '2.0.0');
    expect(ck()).toBe('');
    fs.writeFileSync(path.join(w.work, 'package.json'), '{"name":"x","scripts":{"postinstall":"evil"}}\n');
    expect(ck()).toMatch(/package.json differs/);
    sh(w.work, 'checkout', '--', 'package.json');
    pkg('sub', '2.0.1'); expect(ck()).toMatch(/node_modules\/sub is 2.0.1; package-lock.json pins 2.0.0/);
    pkg('sub', '2.0.0'); pkg('dep', '6.6.6', path.join(w.work, 'server'));
    expect(ck()).toMatch(/server\/node_modules exists/);
  });
  it('the engine\'s closure covers the modules DI-06 found unprotected, and a preloaded process is refused', async () => {
    expect(trustRoot.CORRECTION_ENTRY_POINTS).toEqual(expect.arrayContaining(['server/scripts/applyCompositeCorrection.js', 'server/scripts/correctionApproval.js', 'server/db/client.js']));
    const repo = trustRoot.REPO_ROOT;
    const { importClosure } = await import('./importClosure.js');
    const c = importClosure(trustRoot.CORRECTION_ENTRY_POINTS, (f) => { try { return fs.readFileSync(path.join(repo, f), 'utf8'); } catch { return null; } });
    expect(c.problems).toEqual([]);
    expect(c.files.length).toBeGreaterThan(60);
    expect(c.packages).toEqual(expect.arrayContaining(['better-sqlite3', 'fastest-levenshtein']));
    for (const f of ['server/lib/refresh/integrityMeasure.js', 'server/lib/refresh/context.js', 'server/lib/refresh/identityResolver.js', 'server/scripts/validateAthleticsEntityIdentity.js', 'server/lib/csv.js', 'shared/lifecycle/lifecycle.js', 'shared/performanceSource.js']) expect(c.files, f).toContain(f);
    expect(trustRoot.DEPENDENCY_MANIFESTS).toEqual(['package.json', 'package-lock.json']);
    expect(trustRoot.preloadProblems({ execArgv: [], nodeOptions: '--import=/tmp/evil.mjs' }).join()).toMatch(/preloads code/);
    expect(trustRoot.preloadProblems({ execArgv: ['--require', '/tmp/evil.cjs'], nodeOptions: '' }).join()).toMatch(/clean process/);
    expect(trustRoot.preloadProblems({ execArgv: ['--inspect=0'], nodeOptions: '' }).join()).toMatch(/clean process/);
    expect(trustRoot.preloadProblems({ execArgv: [], nodeOptions: '--max-old-space-size=4096' })).toEqual([]);
  });
  it('under the test runner the trust root never reaches GitHub: it fails closed', () => {
    expect(assertTrustedRuntimeState('SHARED_DEV').join()).toMatch(/trust root/);
  });
});
