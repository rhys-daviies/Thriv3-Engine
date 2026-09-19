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

  /*
   * WHY lstat AND NOT `configured !== real`. On macOS /var is itself a symlink
   * to /private/var, so a RECRUITMATCH_DB under a temp directory resolves to a
   * different string with no symlink of ours involved — and the first version
   * of this blamed a symlink that did not exist. A diagnostic whose entire job
   * is accurate attribution must not guess at its own cause.
   */
  let isLink = false;
  try { isLink = fs.lstatSync(configured).isSymbolicLink(); } catch { /* absent */ }

  return {
    configuredPath: configured,
    realPath: real,
    shared: true,
    reason: isLink
      ? 'server/data/recruitmatch.sqlite is a symlink to a database outside this checkout'
      : 'the configured database path resolves outside this checkout',
  };
}

/* ------------------------------------------------------------------------- *
 * L7ZM — corpus CATEGORY, corpus MOVEMENT, and the canonical write contract.
 * ------------------------------------------------------------------------- */

/**
 * The four kinds of corpus a process can be attached to.
 *
 * The discriminator is REACHABILITY, not a filename and not a guess about
 * importance: can another checkout of this repository reach these bytes? That
 * is the property that actually caused L7ZL's misattribution, it is cheap to
 * compute, and it is true independent of who believes what about the file.
 *
 * `WORKTREE_LOCAL` deliberately covers the MAIN checkout's own database, which
 * is also the canonical one. That is not a bug in the taxonomy. Canonical data
 * operations are supposed to happen in the checkout that owns the file, with no
 * friction; what needs announcing is a SIDE checkout reaching across into it.
 */
export const EPHEMERAL_TEST = 'EPHEMERAL_TEST';
export const STAGE_SNAPSHOT = 'STAGE_SNAPSHOT';
export const CANONICAL_SHARED = 'CANONICAL_SHARED';
export const WORKTREE_LOCAL = 'WORKTREE_LOCAL';

/**
 * A snapshot is DECLARED, never inferred from a filename alone.
 *
 * `THRIV3_CORPUS=snapshot` is how a measurement says "I am deliberately reading
 * a frozen copy". Guessing from the path would let an ordinary database be
 * mistaken for a snapshot by naming coincidence, and the whole point of this
 * module is to stop identity being inferred from appearances.
 */
export function corpusCategory(identity, env = process.env) {
  if (identity.realPath === ':memory:') return EPHEMERAL_TEST;
  if (env.THRIV3_CORPUS === 'snapshot') return STAGE_SNAPSHOT;
  return identity.shared ? CANONICAL_SHARED : WORKTREE_LOCAL;
}

/** `{ ...identity, category }` — the whole answer in one call. */
export function corpus(configuredPath, { root = checkoutRoot, env = process.env } = {}) {
  const identity = corpusIdentity(configuredPath, root);
  return { ...identity, category: corpusCategory(identity, env) };
}

/**
 * A constant-time token that changes whenever ANY write reaches this database.
 *
 * `data_version` moves when another connection commits; `total_changes()`
 * counts this connection's own rows, which `data_version` is documented not to
 * cover. Together they see every write from anywhere.
 *
 * DELIBERATELY SEPARATE from `recruitingMaterialisation`'s identical primitive.
 * The two answer different questions — "did my corpus move underneath me" and
 * "does this derived table still match its inputs" — and collapsing them into
 * one shared helper would make a future change to either silently retune the
 * other. Two lines of SQLite is a cheaper price than that coupling.
 */
export function corpusChangeToken(db) {
  const local = db.prepare('SELECT total_changes() AS n').pluck().get();
  return `${db.pragma('data_version', { simple: true })}:${local}`;
}

/** Raised when a maintenance script would write a corpus other trees share. */
export class CanonicalWriteRefused extends Error {
  constructor(script, identity) {
    super(`${script} would write a SHARED canonical corpus:\n  ${identity.realPath}\n`
      + `  ${identity.reason}.\n`
      + 'Other checkouts and sessions read these rows, and a surprise change there costs\n'
      + 'someone else a day of misattribution. Re-run with --canonical to say you mean it,\n'
      + 'or set RECRUITMATCH_DB to a copy.');
    this.name = 'CanonicalWriteRefused';
    this.code = 'CANONICAL_WRITE_REFUSED';
    this.realPath = identity.realPath;
  }
}

/**
 * The canonical write contract, for MAINTENANCE SCRIPTS ONLY.
 *
 * ONE mechanism, one flag, applied to the scripts the L7ZM audit found capable
 * of large product-data writes. It asks for an acknowledgement in exactly the
 * case that hurt — a side checkout writing bytes another checkout owns — and is
 * silent everywhere else:
 *
 *   EPHEMERAL_TEST     tests write freely; a flag there would be pure noise
 *   WORKTREE_LOCAL     including the main checkout, where canonical operations
 *                      BELONG. No friction on the workflow that is supposed to
 *                      happen.
 *   STAGE_SNAPSHOT     a declared throwaway; writing it harms nobody
 *   CANONICAL_SHARED   acknowledge with --canonical, or point RECRUITMATCH_DB
 *                      somewhere else
 *
 * THE SERVER NEVER CALLS THIS. Operator and application writes go through
 * routes, which must never depend on a CLI flag; the guard lives at script
 * entry points, not in `client.js`, precisely so normal product writes are
 * untouched.
 */
export function assertCanonicalWrite({
  script, argv = process.argv, path: p, env = process.env, root = checkoutRoot,
} = {}) {
  const c = corpus(p, { root, env });
  if (c.category !== CANONICAL_SHARED) return c;
  if (argv.includes('--canonical')) return c;
  throw new CanonicalWriteRefused(script ?? 'this script', c);
}

/**
 * The header line a report prints about its own corpus, or null when there is
 * nothing a reader needs to know.
 *
 * It takes a CATEGORY, not just `shared`. The first version keyed off `shared`
 * alone and shouted SHARED CORPUS at a deliberately frozen stage snapshot,
 * which is both wrong and the kind of noise that trains people to skip the
 * banner — the opposite of the point. A snapshot gets its own line, because
 * "this measurement is stable AND canonical may have moved since" is exactly
 * the pair of facts a stage needs to be able to state at once.
 */
export function sharedCorpusNotice(identity) {
  const category = identity?.category ?? (identity?.shared ? CANONICAL_SHARED : WORKTREE_LOCAL);
  if (category === STAGE_SNAPSHOT) {
    return `STAGE SNAPSHOT — ${identity.realPath}\n`
      + '             A frozen copy, declared with THRIV3_CORPUS=snapshot. These numbers\n'
      + '             are stable and reproducible for THIS corpus; canonical may have\n'
      + '             moved since it was taken. Both can be true at once.';
  }
  if (category !== CANONICAL_SHARED) return null;
  return `SHARED CORPUS — ${identity.realPath}\n`
    + `             ${identity.reason}.\n`
    + '             Other checkouts and sessions can write these rows, so a moved\n'
    + '             digest is not on its own evidence of a local defect. Establish\n'
    + '             what else touched the file first.';
}
