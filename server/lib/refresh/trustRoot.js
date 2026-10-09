/**
 * TRUST ROOT FOR RUNTIME CORRECTIONS — Phase DI-04 (DI-03G MAJOR-C).
 *
 * WHY. The reviewer registry, the pinned attestation roots, the environment and source registries and the
 * verifier code all live in the working copy, and anything with write access to the checkout (an agent
 * included) could edit them to enrol its own key. Before a correction or revert touches a SHARED_DEV or
 * PRODUCTION database, every PROTECTED file must be byte-identical to the same file on the protected
 * branch as it is RIGHT NOW on GitHub: the engine fetches `main` from the pinned repository URL and
 * compares. A local edit, an unpushed commit, a stale or forged local `origin/main`, a repointed remote,
 * or an unreachable GitHub all refuse (fail closed). Disposable rehearsals are not gated.
 *
 * WHAT THIS DOES NOT DO. It is enforced by code running in the same checkout, so it raises the bar rather
 * than closing it: someone who can rewrite this module can remove the check. What makes `main` itself
 * trustworthy is GitHub configuration a human must set (branch protection, CODEOWNERS review by a person
 * other than the author, no bypass for admins or automation) — see docs/CORRECTION_REVIEWER_SECURITY.md.
 * What makes a signature trustworthy even on a compromised machine is the attested hardware key with
 * touch + PIN (fidoAttestation.js): no file edit can produce that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const TRUSTED_REMOTE = /^(https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)rhys-daviies\/Thriv3-Engine(\.git)?$/;
export const TRUSTED_BRANCH = 'main';
/** Files whose working-copy content must equal the protected branch before a runtime correction. */
export const PROTECTED_FILES = Object.freeze([
  'shared/correctionReviewers.json', 'shared/fidoAttestationRoots.json', 'shared/databaseEnvironments.json',
  'shared/officialSourceRegistry.json', 'shared/heldDomainAdjudications.js',
  'server/db/client.js', 'server/db/disposableMarker.js',
  'server/lib/canonicalCoachEligibility.js', 'server/lib/coachEligibility.js', 'server/lib/coachRowFloor.js',
  ...['approvalValidator', 'sshSignature', 'fidoAttestation', 'attestationRoots', 'reviewerRegistry', 'sourceRegistry', 'trustRoot',
    'correctionTarget', 'correctionLedger', 'holdRelease', 'compositeCorrection', 'domainOwnershipCorrection', 'officialEvidence',
    'sendability', 'coachCorrection', 'protectedCorrection', 'promotion'].map((m) => `server/lib/refresh/${m}.js`),
  'server/scripts/applyCompositeCorrection.js', 'server/scripts/correctionApproval.js',
]);

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

/**
 * Compare `files` in `repoRoot` with the protected branch freshly fetched from `remote`.
 * -> { problems[], trusted_commit }. Exported with parameters for its own tests (temporary repositories);
 * the engine only ever calls assertTrustedRuntimeState(), which fixes them.
 */
export function protectedFileProblems({ repoRoot, remote = 'origin', branch = TRUSTED_BRANCH, files = PROTECTED_FILES, remotePattern = TRUSTED_REMOTE } = {}) {
  const p = [];
  let url;
  try { url = git(repoRoot, ['remote', 'get-url', remote]).toString().trim(); } catch { return { problems: [`${repoRoot} has no git remote "${remote}" — the trust root cannot be established (fail closed)`], trusted_commit: null }; }
  if (!remotePattern.test(url)) return { problems: [`remote "${remote}" points at ${url}, not the protected repository — refusing`], trusted_commit: null };
  let commit;
  try {
    git(repoRoot, ['fetch', '--quiet', '--no-tags', remote, `refs/heads/${branch}`]);
    commit = git(repoRoot, ['rev-parse', 'FETCH_HEAD^{commit}']).toString().trim();
  } catch (e) { return { problems: [`cannot fetch ${branch} from ${url} (${String(e.stderr || e.message).trim().split('\n')[0]}) — the trust root cannot be established (fail closed)`], trusted_commit: null }; }
  for (const f of files) {
    let trusted;
    try { trusted = git(repoRoot, ['show', `${commit}:${f}`]); } catch { p.push(`${f} is not on the protected ${branch} (${commit.slice(0, 12)})`); continue; }
    let local;
    try { local = fs.readFileSync(path.join(repoRoot, f)); } catch { p.push(`${f} is missing from the working copy`); continue; }
    if (!local.equals(trusted)) p.push(`${f} differs from the protected ${branch} (${commit.slice(0, 12)}) — a local change to a protected file never authorises a runtime correction`);
  }
  return { problems: p, trusted_commit: commit };
}

/** The engine's gate: [] for DISPOSABLE targets; for SHARED_DEV / PRODUCTION the protected-file check. */
export function assertTrustedRuntimeState(targetClass) {
  if (targetClass === 'DISPOSABLE') return [];
  return protectedFileProblems({ repoRoot: REPO_ROOT }).problems.map((x) => `trust root: ${x}`);
}
