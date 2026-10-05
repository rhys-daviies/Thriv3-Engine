import fs from 'node:fs';
import path from 'node:path';
import { checkoutRoot } from '../db/corpusIdentity.js';

/**
 * THE PROJECT ROOT — the directory that holds this repository's main checkout
 * alongside the working data that lives beside it rather than in git
 * (`individualisation/`, `scoring/`, `athletics_domains.json`). It is one level
 * ABOVE the repository: not `checkoutRoot`, which is the checkout itself.
 *
 * Maintenance scripts used to name that directory outright, as
 * `/Users/<someone>/Documents/Recruitmatch`, so they only worked on one
 * machine and only while the project stayed in Documents. This derives it from
 * where the code is instead.
 *
 *   1. THRIV3_PROJECT_ROOT, when set — an explicit override.
 *   2. A linked worktree (`.git` is a file naming `<main>/.git/worktrees/<n>`)
 *      answers with the MAIN checkout's parent, so every worktree of the
 *      repository — including ones created outside the project directory —
 *      agrees on one root.
 *   3. Otherwise, the parent of this checkout.
 *
 * Resolving touches nothing; `requireProjectPath` only reports. Neither creates
 * a directory, because a missing data directory means the project is laid out
 * differently from what the script assumes, and writing into a fresh empty one
 * would hide that.
 *
 * Maintenance tooling only. Nothing the server runs at request time uses it.
 */

/** `{ root, source }` — where the project root is, and how that was decided. */
export function resolveProjectRoot({ env = process.env, checkout = checkoutRoot } = {}) {
  const override = (env.THRIV3_PROJECT_ROOT ?? '').trim();
  if (override) return { root: path.resolve(override), source: 'THRIV3_PROJECT_ROOT' };

  let gitFile = null;
  try {
    const dotGit = path.join(checkout, '.git');
    if (fs.lstatSync(dotGit).isFile()) gitFile = fs.readFileSync(dotGit, 'utf8');
  } catch { /* no .git at all: not a checkout, fall through */ }

  const linked = gitFile?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
  const main = linked && path.resolve(checkout, linked).match(/^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/)?.[1];
  if (main) return { root: path.dirname(main), source: 'main checkout of this worktree' };

  return { root: path.dirname(checkout), source: 'parent of this checkout' };
}

export function projectRoot(options) {
  return resolveProjectRoot(options).root;
}

/** A path under the project root. Resolves only; checks nothing. */
export function projectPath(...parts) {
  return path.join(projectRoot(), ...parts);
}

/**
 * A path under the project root that must already exist — the file a script is
 * about to read, or the directory it is about to write into.
 */
export function requireProjectPath(parts, options) {
  const { root, source } = resolveProjectRoot(options);
  const target = path.join(root, ...parts);
  if (!fs.existsSync(target)) {
    throw new Error(`Expected ${target} — not found.\n`
      + `  Project root ${root} (${source}).\n`
      + '  Set THRIV3_PROJECT_ROOT to the directory that holds individualisation/ and scoring/ '
      + 'if the project is laid out differently.');
  }
  return target;
}
