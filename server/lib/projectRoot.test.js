import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectRoot, projectRoot, requireProjectPath } from './projectRoot.js';
import { checkoutRoot } from '../db/corpusIdentity.js';

/**
 * Every layout below is built under a temporary directory, so none of this
 * depends on where the real repository happens to live.
 */
let tmp;
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-project-root-'))); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** `<root>/app` as a main checkout, with the project data beside it. */
const layout = (root) => {
  const app = path.join(root, 'app');
  fs.mkdirSync(path.join(app, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'individualisation'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scoring'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scoring', 'rankings_v6_men.csv'), 'rank\n');
  return app;
};

describe('resolveProjectRoot', () => {
  it('is the parent of a main checkout', () => {
    const app = layout(path.join(tmp, 'Recruitmatch'));
    expect(resolveProjectRoot({ checkout: app, env: {} }))
      .toEqual({ root: path.join(tmp, 'Recruitmatch'), source: 'parent of this checkout' });
  });

  it("is the MAIN checkout's parent for a linked worktree, wherever the worktree lives", () => {
    const app = layout(path.join(tmp, 'Recruitmatch'));
    const elsewhere = path.join(tmp, 'scratch', 'feature-x');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(path.join(elsewhere, '.git'), `gitdir: ${path.join(app, '.git', 'worktrees', 'feature-x')}\n`);
    expect(resolveProjectRoot({ checkout: elsewhere, env: {} }))
      .toEqual({ root: path.join(tmp, 'Recruitmatch'), source: 'main checkout of this worktree' });
  });

  it('follows a relative gitdir', () => {
    const app = layout(path.join(tmp, 'Recruitmatch'));
    const sibling = path.join(tmp, 'Recruitmatch', 'app-main');
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, '.git'), 'gitdir: ../app/.git/worktrees/app-main\n');
    expect(resolveProjectRoot({ checkout: sibling, env: {} }).root).toBe(path.dirname(app));
  });

  it('falls back to the parent when the .git file is not a worktree pointer', () => {
    const odd = path.join(tmp, 'proj', 'checkout');
    fs.mkdirSync(odd, { recursive: true });
    fs.writeFileSync(path.join(odd, '.git'), 'gitdir: /somewhere/modules/sub\n');
    expect(resolveProjectRoot({ checkout: odd, env: {} }).root).toBe(path.join(tmp, 'proj'));
  });

  it('obeys THRIV3_PROJECT_ROOT, trimmed and made absolute', () => {
    const app = layout(path.join(tmp, 'Recruitmatch'));
    const r = resolveProjectRoot({ checkout: app, env: { THRIV3_PROJECT_ROOT: `  ${path.join(tmp, 'other')}  ` } });
    expect(r).toEqual({ root: path.join(tmp, 'other'), source: 'THRIV3_PROJECT_ROOT' });
    expect(resolveProjectRoot({ checkout: app, env: { THRIV3_PROJECT_ROOT: '   ' } }).source).toBe('parent of this checkout');
  });

  it('works in directories whose names contain spaces', () => {
    const root = path.join(tmp, 'My Projects', 'Thriv3 Engine');
    const app = layout(root);
    expect(resolveProjectRoot({ checkout: app, env: {} }).root).toBe(root);
    expect(requireProjectPath(['scoring', 'rankings_v6_men.csv'], { checkout: app, env: {} }))
      .toBe(path.join(root, 'scoring', 'rankings_v6_men.csv'));
  });

  it('follows the project to a location outside Documents', () => {
    const moved = path.join(tmp, 'Developer', 'Thriv3-Engine');
    const app = layout(moved);
    expect(requireProjectPath(['individualisation'], { checkout: app, env: {} })).toBe(path.join(moved, 'individualisation'));
    expect(requireProjectPath(['scoring'], { checkout: app, env: {} })).toBe(path.join(moved, 'scoring'));
    expect(requireProjectPath(['individualisation'], { checkout: app, env: {} })).not.toContain('Documents');
  });
});

describe('requireProjectPath', () => {
  it('returns the individualisation and scoring paths that exist', () => {
    const app = layout(path.join(tmp, 'Recruitmatch'));
    const opts = { checkout: app, env: {} };
    expect(requireProjectPath(['individualisation'], opts)).toBe(path.join(tmp, 'Recruitmatch', 'individualisation'));
    expect(requireProjectPath(['scoring', 'rankings_v6_men.csv'], opts))
      .toBe(path.join(tmp, 'Recruitmatch', 'scoring', 'rankings_v6_men.csv'));
  });

  it('refuses a missing path, says where it looked and how to override, and creates nothing', () => {
    const app = layout(path.join(tmp, 'Recruitmatch'));
    fs.rmSync(path.join(tmp, 'Recruitmatch', 'individualisation'), { recursive: true });
    let message = '';
    try { requireProjectPath(['individualisation'], { checkout: app, env: {} }); } catch (e) { message = e.message; }
    expect(message).toContain(path.join(tmp, 'Recruitmatch', 'individualisation'));
    expect(message).toContain('parent of this checkout');
    expect(message).toContain('THRIV3_PROJECT_ROOT');
    expect(fs.existsSync(path.join(tmp, 'Recruitmatch', 'individualisation'))).toBe(false);
  });
});

describe('this repository', () => {
  it('resolves the project root from where the code is, not from a hard-coded home', () => {
    const { root, source } = resolveProjectRoot({ env: {} });
    const dotGit = path.join(checkoutRoot, '.git');
    if (fs.lstatSync(dotGit).isDirectory()) {
      expect(source).toBe('parent of this checkout');
      expect(root).toBe(path.dirname(checkoutRoot));
    } else {
      expect(source).toBe('main checkout of this worktree');
    }
    expect(projectRoot({ env: { THRIV3_PROJECT_ROOT: tmp } })).toBe(tmp);
  });
});
