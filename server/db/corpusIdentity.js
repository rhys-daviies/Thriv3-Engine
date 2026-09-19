import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * L7ZL-C — WHICH database this process is actually reading, and whether anyone
 * else can write it.
 *
 * L7ZL spent most of a stage treating an unexplained 39,430-row change to
 * `roster_players` as a defect in its own code. It was not. This checkout's
 * `server/data/recruitmatch.sqlite` is a SYMLINK to the main checkout's copy,
 * and twenty-one worktrees resolve to that one file. Another session ran
 * `projectRosterMinutes.js` against it, which is an entirely ordinary thing for
 * that session to do.
 *
 * The failure was not the write. The failure was that nothing in the toolchain
 * ever said the corpus was shared, so every containment hash in this roadmap
 * read as a statement about THIS branch's work when it was really a statement
 * about a file several other branches were also using. A stable hash meant
 * nothing had happened anywhere; a moved hash looked like a local defect.
 *
 * So this reports identity, not policy. It refuses nothing and changes no
 * behaviour — a shared corpus is the normal arrangement here and may well stay
 * that way. What it removes is the silence: a measurement taken against a file
 * other processes can write says so on its face, and the next person to see a
 * digest move has the first candidate in front of them instead of a day of
 * bisecting their own tests.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The checkout this module belongs to — the tree a reader assumes they are in. */
export const checkoutRoot = path.resolve(HERE, '../..');

/**
 * `{ configuredPath, realPath, shared, reason }` for a database path.
 *
 * `shared` is true when the bytes live outside this checkout, whether that is a
 * symlink out of `server/data` or a RECRUITMATCH_DB pointing elsewhere. The
 * question is deliberately "can this file be reached from another tree", not
 * "is another process writing it now" — the second cannot be answered
 * reliably, and the first is the one that explains a surprising digest.
 */
export function corpusIdentity(configuredPath, root = checkoutRoot) {
  if (!configuredPath || configuredPath === ':memory:') {
    return { configuredPath: ':memory:', realPath: ':memory:', shared: false, reason: null };
  }
  const configured = path.resolve(configuredPath);
  /* realpathSync resolves the symlink; a missing file is simply not shared. */
  let real = configured;
  try { real = fs.realpathSync(configured); } catch { /* not created yet */ }

  const inside = real === root || real.startsWith(`${root}${path.sep}`);
  if (inside) return { configuredPath: configured, realPath: real, shared: false, reason: null };

  return {
    configuredPath: configured,
    realPath: real,
    shared: true,
    reason: configured === real
      ? 'RECRUITMATCH_DB points outside this checkout'
      : 'server/data/recruitmatch.sqlite is a symlink to a database outside this checkout',
  };
}

/** One line for a report header, or null when the corpus is this checkout's own. */
export function sharedCorpusNotice(identity) {
  if (!identity?.shared) return null;
  return `SHARED CORPUS — ${identity.realPath}\n`
    + `             ${identity.reason}.\n`
    + '             Other checkouts and sessions can write these rows, so a moved\n'
    + '             digest is not on its own evidence of a local defect. Establish\n'
    + '             what else touched the file first.';
}
