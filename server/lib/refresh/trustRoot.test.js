import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { protectedFileProblems, PROTECTED_FILES, TRUSTED_REMOTE, assertTrustedRuntimeState } from './trustRoot.js';

/**
 * DI-04 — unauthorised registry / verifier changes. A runtime correction requires every protected file to equal
 * the protected branch as freshly fetched. Exercised against local repositories standing in for GitHub (the
 * remote pattern is the only parameter changed; the engine's own call fixes it to the real repository).
 */
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' } }).toString();
const FILES = ['shared/correctionReviewers.json', 'server/lib/refresh/approvalValidator.js'];
function world() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'di04-trust-'));
  const remote = path.join(d, 'github.git'); sh(d, 'init', '-q', '--bare', '-b', 'main', remote);
  const work = path.join(d, 'checkout'); sh(d, 'clone', '-q', remote, work);
  for (const f of FILES) { fs.mkdirSync(path.join(work, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(work, f), `${f} v1\n`); }
  sh(work, 'checkout', '-q', '-b', 'main'); sh(work, 'add', '-A'); sh(work, 'commit', '-qm', 'v1'); sh(work, 'push', '-q', 'origin', 'main');
  const check = (o = {}) => protectedFileProblems({ repoRoot: work, files: FILES, remotePattern: new RegExp(`^${remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), ...o }).problems.join('\n');
  return { d, remote, work, check };
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
  it('a remote repointed elsewhere, an unreachable remote, a missing remote, and a protected file missing upstream all fail closed', () => {
    const w = world();
    sh(w.work, 'remote', 'set-url', 'origin', path.join(w.d, 'attacker.git'));
    expect(w.check()).toMatch(/not the protected repository/);
    expect(w.check({ remotePattern: /.*/ })).toMatch(/cannot fetch main/);
    sh(w.work, 'remote', 'remove', 'origin');
    expect(w.check()).toMatch(/has no git remote/);
    const w2 = world(); expect(w2.check({ files: [...FILES, 'shared/notThere.json'] })).toMatch(/notThere.json is not on the protected main/);
  });
  it('the engine pins the real repository, protects the registries and verifier code, and never gates disposable rehearsals', () => {
    expect(TRUSTED_REMOTE.test('https://github.com/rhys-daviies/Thriv3-Engine.git')).toBe(true);
    expect(TRUSTED_REMOTE.test('https://github.com/attacker/Thriv3-Engine.git')).toBe(false);
    for (const f of ['shared/correctionReviewers.json', 'shared/fidoAttestationRoots.json', 'server/lib/refresh/approvalValidator.js', 'server/lib/refresh/sshSignature.js', 'server/lib/refresh/fidoAttestation.js', 'server/lib/refresh/trustRoot.js']) expect(PROTECTED_FILES).toContain(f);
    expect(assertTrustedRuntimeState('DISPOSABLE')).toEqual([]);
  });
});
