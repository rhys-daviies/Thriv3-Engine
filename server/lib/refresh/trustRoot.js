/**
 * TRUST ROOT FOR RUNTIME CORRECTIONS — Phase DI-04 (DI-03G MAJOR-C), hardened DI-07 (DI-06 MINOR-1/2/3).
 *
 * WHY. The reviewer registry, the pinned attestation roots, the environment and source registries and the
 * verifier code all live in the working copy, and anything with write access to the checkout (an agent
 * included) could edit them to enrol its own key. Before a correction or revert touches a SHARED_DEV or
 * PRODUCTION database — and before verifyApproval issues a grant for one — the code and data that decide
 * the outcome must be byte-identical to the protected branch as it is RIGHT NOW on GitHub.
 *
 * WHAT IS COMPARED (DI-07, MINOR-2).
 *   - PROTECTED_FILES: the registries and data files the engine reads, plus the core verifier modules;
 *   - the transitive static IMPORT CLOSURE of CORRECTION_ENTRY_POINTS (importClosure.js), computed at check
 *     time, so every local module the correction code loads is covered without a hand-kept list;
 *   - package.json and package-lock.json;
 *   - the npm packages the closure loads must resolve to <repo>/node_modules (no shadowing node_modules
 *     directory nearer the importing file) at the version package-lock.json pins, recursively through their
 *     runtime dependencies. File-level integrity of node_modules is NOT checked (native builds differ per
 *     platform): see the residual risks in docs/CORRECTION_REVIEWER_SECURITY.md §5;
 *   - the process must not have been started with code preloaded (--import / --require / --loader in
 *     NODE_OPTIONS or execArgv) or with an inspector enabled.
 *
 * HOW (DI-07, MINOR-1). The protected branch is fetched from the PINNED URL (never a configured remote
 * name) into a brand-new temporary bare repository, with a scrubbed environment: nothing inherited (no
 * GIT_*, proxy or TLS variables), GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL=/dev/null,
 * GIT_NO_REPLACE_OBJECTS=1 and --no-replace-objects, GIT_TERMINAL_PROMPT=0, a fixed PATH and a git binary
 * from a fixed system location. Only the tree is fetched (--depth=1 --filter=blob:none). Each local file is
 * then hashed AS A GIT BLOB in this process and compared with the blob id the fetched tree records. The
 * checkout's own .git — its config (url.insteadOf, pushurl, remotes), hooks, fsmonitor, alternates, replace
 * refs, FETCH_HEAD — is never consulted, so none of it can redirect the fetch or substitute content. The
 * checkout need not even be a git repository.
 *
 * WHAT THIS DOES NOT DO. It is enforced by code running in the same account, so it raises the bar rather
 * than closing it: whoever can run code as this user can run a different verifier. It catches tampering with
 * the checkout; it does not make a compromised machine trustworthy. See docs/CORRECTION_REVIEWER_SECURITY.md
 * §5 and docs/CORRECTION_GOVERNANCE_SEPARATION.md for the independent verifier that does.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importClosure } from './importClosure.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** The protected repository, fetched by explicit URL — never through a configured remote. */
export const TRUSTED_URL = 'https://github.com/rhys-daviies/Thriv3-Engine.git';
export const TRUSTED_BRANCH = 'main';
/** Data and registry files the engine reads, and the core verifier modules (the closure covers the rest). */
export const PROTECTED_FILES = Object.freeze([
  'shared/correctionReviewers.json', 'shared/fidoAttestationRoots.json', 'shared/databaseEnvironments.json',
  'shared/officialSourceRegistry.json', 'shared/heldDomainAdjudications.js',
  'server/db/client.js', 'server/db/disposableMarker.js',
  'server/lib/canonicalCoachEligibility.js', 'server/lib/coachEligibility.js', 'server/lib/coachRowFloor.js',
  ...['approvalValidator', 'sshSignature', 'fidoAttestation', 'attestationRoots', 'reviewerRegistry', 'sourceRegistry', 'trustRoot', 'importClosure',
    'correctionTarget', 'correctionLedger', 'holdRelease', 'compositeCorrection', 'domainOwnershipCorrection', 'officialEvidence',
    'sendability', 'coachCorrection', 'protectedCorrection', 'promotion'].map((m) => `server/lib/refresh/${m}.js`),
  'server/scripts/applyCompositeCorrection.js', 'server/scripts/correctionApproval.js',
]);
/** Where correction code starts: every module they statically import, transitively, is protected. */
export const CORRECTION_ENTRY_POINTS = Object.freeze([
  'server/scripts/applyCompositeCorrection.js', 'server/scripts/correctionApproval.js',
  'server/lib/refresh/compositeCorrection.js', 'server/lib/refresh/approvalValidator.js', 'server/lib/refresh/holdRelease.js',
  'server/lib/refresh/domainOwnershipCorrection.js', 'server/lib/refresh/trustRoot.js', 'server/db/client.js',
]);
export const DEPENDENCY_MANIFESTS = Object.freeze(['package.json', 'package-lock.json']);

// ---- git, hermetically ------------------------------------------------------------------------------
const GIT_LOCATIONS = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', '/bin/git'];
export function gitBinary() {
  const g = GIT_LOCATIONS.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (!g) throw new Error(`no git binary in ${GIT_LOCATIONS.join(', ')}`);
  return g;
}
/**
 * The ONLY environment a trust-root git process sees: nothing is inherited. HOME is the private temp
 * directory, so no ~/.gitconfig, credential helper or ~/.ssh is read.
 */
export function sanitizedGitEnv(home) {
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin', HOME: home, TMPDIR: home, LANG: 'C', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/usr/bin/false', SSH_ASKPASS: '/usr/bin/false', GIT_ALLOW_PROTOCOL: 'https:file',
  };
}
const HARDENING = ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never',
  '-c', 'protocol.https.allow=always', '-c', 'protocol.file.allow=always', '-c', 'credential.helper=', '-c', 'http.followRedirects=false'];

/**
 * Fetch `branch` of `url` (tree only) into a fresh temporary bare repository.
 * -> { commit, url, branch, fetched_at, entries: Map(path -> { mode, type, oid }) }. Throws on any failure.
 */
export function fetchTrustedTree({ url = TRUSTED_URL, branch = TRUSTED_BRANCH } = {}) {
  // a test never reaches GitHub: it mocks this module or passes a local file:// repository (fails closed otherwise)
  if (process.env.VITEST && url === TRUSTED_URL) throw new Error('the trust root does not fetch GitHub under the test runner (fail closed)');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-trust-'));
  const gitDir = path.join(home, 'trusted.git');
  const git = gitBinary(); const env = sanitizedGitEnv(home);
  const run = (args) => execFileSync(git, [...HARDENING, ...args], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  try {
    run(['init', '--quiet', '--bare', '--template=', gitDir]);
    run(['--git-dir', gitDir, 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--depth=1', '--filter=blob:none', url, `+refs/heads/${branch}:refs/trusted/${branch}`]);
    const commit = run(['--git-dir', gitDir, 'rev-parse', '--verify', `refs/trusted/${branch}^{commit}`]).toString().trim();
    const entries = new Map();
    for (const rec of run(['--git-dir', gitDir, 'ls-tree', '-r', '-z', '--full-tree', commit]).toString().split('\0')) {
      if (!rec) continue;
      const tab = rec.indexOf('\t'); const [mode, type, oid] = rec.slice(0, tab).split(' ');
      entries.set(rec.slice(tab + 1), { mode, type, oid });
    }
    return { commit, url, branch, fetched_at: Date.now(), entries };
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

/** The git blob id of `buf` (sha1, or sha256 for a sha256 repository) — `git hash-object --no-filters`. */
export function gitBlobOid(buf, algo = 'sha1') {
  return crypto.createHash(algo).update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

const readRegular = (repoRoot, f) => {
  const st = fs.lstatSync(path.join(repoRoot, f));
  if (!st.isFile()) throw new Error(`${f} is not a regular file in the working copy (symlink or special file) — refused`);
  return fs.readFileSync(path.join(repoRoot, f));
};

/**
 * Packages the closure loads: no shadowing node_modules between an importing file and the repository root,
 * and the installed version equals package-lock.json (recursively through runtime dependencies).
 */
export function dependencyProblems({ repoRoot, packages, closureFiles }) {
  const p = [];
  const dirs = new Set();
  for (const f of closureFiles) { let d = path.posix.dirname(f); while (d && d !== '.') { dirs.add(d); d = path.posix.dirname(d); } }
  for (const d of [...dirs].sort()) if (fs.existsSync(path.join(repoRoot, d, 'node_modules'))) p.push(`${d}/node_modules exists — it would shadow the repository's pinned packages for the correction code`);
  let lock;
  try { lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')); } catch (e) { return [...p, `package-lock.json unreadable (${e.message})`]; }
  const seen = new Set(); const queue = [...packages];
  while (queue.length) {
    const name = queue.shift(); if (seen.has(name)) continue; seen.add(name);
    const want = lock?.packages?.[`node_modules/${name}`];
    if (!want?.version) { p.push(`${name} is loaded by the correction code but is not pinned in package-lock.json`); continue; }
    let have;
    try { have = JSON.parse(fs.readFileSync(path.join(repoRoot, 'node_modules', name, 'package.json'), 'utf8')).version; } catch { p.push(`${name} is not installed in node_modules`); continue; }
    if (have !== want.version) p.push(`node_modules/${name} is ${have}; package-lock.json pins ${want.version}`);
    for (const dep of Object.keys(want.dependencies || {})) queue.push(dep);
  }
  return p;
}

const PRELOAD = /(^|\s)(--require|-r|--import|--loader|--experimental-loader|--experimental-policy|--inspect|--inspect-brk|--inspect-wait|--inspect-port)(=|\s|$)/;
/** Code preloaded into this process, or a debugger able to inject it, defeats every in-process check. */
export function preloadProblems({ execArgv = process.execArgv, nodeOptions = process.env.NODE_OPTIONS } = {}) {
  const p = [];
  if (PRELOAD.test(` ${String(nodeOptions ?? '')} `)) p.push(`NODE_OPTIONS (${nodeOptions}) preloads code or enables the inspector — a runtime correction must run in a clean process`);
  const argv = (execArgv || []).join(' ');
  if (PRELOAD.test(` ${argv} `)) p.push(`node was started with "${argv}" — a runtime correction must run in a clean process`);
  return p;
}

/**
 * Compare the correction code and data in `repoRoot` with a trusted tree (fetched now unless `tree` is given).
 * -> { problems[], trusted_commit, files: string[] (every file proven identical) }. Exported with parameters
 * for its own tests (temporary repositories, file:// URLs); the engine only calls trustedRuntimeState().
 */
export function protectedFileProblems({ repoRoot, url = TRUSTED_URL, branch = TRUSTED_BRANCH, files = PROTECTED_FILES, entryPoints = CORRECTION_ENTRY_POINTS, manifests = DEPENDENCY_MANIFESTS, checkDependencies = true, tree = null } = {}) {
  let t = tree;
  if (!t) {
    try { t = fetchTrustedTree({ url, branch }); } catch (e) { return { problems: [`cannot fetch ${branch} from ${url} (${String(e.stderr || e.message).trim().split('\n')[0]}) — the trust root cannot be established (fail closed)`], trusted_commit: null, files: [] }; }
  }
  const p = []; const short = t.commit.slice(0, 12);
  const algo = t.commit.length === 64 ? 'sha256' : 'sha1';
  const verified = new Map(); const failed = new Set();
  const check = (f) => {
    if (verified.has(f)) return true;
    if (failed.has(f)) return false;
    failed.add(f);
    const e = t.entries.get(f);
    if (!e || e.type !== 'blob') { p.push(`${f} is not on the protected ${branch} (${short})`); return false; }
    if (e.mode !== '100644' && e.mode !== '100755') { p.push(`${f} is not a regular file on the protected ${branch} (mode ${e.mode})`); return false; }
    let local;
    try { local = readRegular(repoRoot, f); } catch (err) { p.push(err.code === 'ENOENT' ? `${f} is missing from the working copy` : err.message); return false; }
    if (gitBlobOid(local, algo) !== e.oid) { p.push(`${f} differs from the protected ${branch} (${short}) — a local change to correction code or data never authorises a runtime correction`); return false; }
    failed.delete(f); verified.set(f, local); return true;
  };
  for (const f of [...files, ...manifests]) check(f);
  // the closure is followed only through files proven identical to main, so it is main's own closure
  const closure = importClosure(entryPoints, (f) => (check(f) ? verified.get(f).toString('utf8') : null));
  p.push(...closure.problems.filter((x) => !/cannot be read$/.test(x)).map((x) => `import closure: ${x}`));
  if (checkDependencies && closure.packages.length) p.push(...dependencyProblems({ repoRoot, packages: closure.packages, closureFiles: closure.files }));
  return { problems: p, trusted_commit: t.commit, files: [...verified.keys()].sort() };
}

// ---- the engine's gate --------------------------------------------------------------------------------
const TREES = new Map(); // commit -> fetched tree: re-checks against a grant's commit need no network
let latest = null;
const remember = (t) => { TREES.set(t.commit, t); if (TREES.size > 8) TREES.delete(TREES.keys().next().value); latest = t; return t; };

/**
 * -> { problems[], trusted_commit }. [] for DISPOSABLE. For SHARED_DEV / PRODUCTION the protected branch is
 * fetched NOW (or, with maxAgeMs > 0 — read-only callers such as hold-release proofs — a tree fetched at most
 * that long ago is reused; the local files are always re-hashed), every protected and closure file is
 * compared, and a preloaded process is refused.
 */
export function trustedRuntimeState(targetClass, { maxAgeMs = 0 } = {}) {
  if (targetClass === 'DISPOSABLE') return { problems: [], trusted_commit: null };
  let tree = maxAgeMs > 0 && latest && Date.now() - latest.fetched_at <= maxAgeMs ? latest : null;
  if (!tree) {
    try { tree = remember(fetchTrustedTree()); } catch (e) {
      return { problems: [`trust root: cannot fetch ${TRUSTED_BRANCH} from ${TRUSTED_URL} (${String(e.stderr || e.message).trim().split('\n')[0]}) — the trust root cannot be established (fail closed)`], trusted_commit: null };
    }
  }
  const r = protectedFileProblems({ repoRoot: REPO_ROOT, tree });
  return { problems: [...r.problems, ...preloadProblems()].map((x) => `trust root: ${x}`), trusted_commit: r.trusted_commit };
}
/** Problems only (the DI-04 interface). */
export const assertTrustedRuntimeState = (targetClass) => trustedRuntimeState(targetClass).problems;

/**
 * Re-check the working copy against the tree a grant was issued under, without the network. Writers call this
 * immediately before writing, so a file changed between verification and write is still refused.
 */
export function recheckTrustedCommit(commit) {
  const tree = commit ? TREES.get(commit) : null;
  if (!tree) return [`trust root: the grant's trusted commit ${String(commit).slice(0, 12)} was not verified in this process — refused`];
  const r = protectedFileProblems({ repoRoot: REPO_ROOT, tree });
  return [...r.problems, ...preloadProblems()].map((x) => `trust root: ${x}`);
}
