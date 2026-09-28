/**
 * A rollback copy of the database that is actually a copy of the database.
 *
 * The obvious thing does not work here. This database runs in WAL mode, so a
 * committed transaction lives in `recruitmatch.sqlite-wal` until a checkpoint
 * folds it into the main file — and a checkpoint cannot run while any
 * connection still holds a read. `fs.copyFileSync(dbPath, backup)` copies the
 * main file alone, which means it copies the last CHECKPOINTED state and
 * silently drops everything committed since.
 *
 * That is not hypothetical. L7C took a pre-import backup that way with 22 MB
 * sitting in the WAL. The copy still carried `players.email_template` values a
 * later migration had already cleared, so a before/after comparison against it
 * appeared to show 2,338 emails changing when the real number was three. The
 * backup was also, quietly, not a rollback point at all.
 *
 * `VACUUM INTO` is SQLite's own answer: it runs inside a read transaction, so
 * it sees one consistent snapshot including the WAL, and it writes a single
 * standalone file with no sidecars to remember. The alternative — copying
 * `-wal` and `-shm` alongside — works only if all three are captured at the
 * same instant and nobody has to remember which files those are.
 *
 *   node server/scripts/dbSnapshot.js --out /tmp/pre-import.sqlite
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/** Rows a snapshot is checked against. Cheap, and enough to catch a truncation. */
export const WITNESS_TABLES = Object.freeze([
  'players', 'colleges', 'roster_players', 'coaches', 'athletics_domains',
]);

function counts(db) {
  const out = {};
  for (const t of WITNESS_TABLES) {
    try { out[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; }
    catch { out[t] = null; }   // a schema without the table is information, not a crash
  }
  return out;
}

/**
 * Write a standalone, internally consistent snapshot of `source` to `dest`.
 *
 * Returns what it wrote and what it verified, so a caller can print an account
 * rather than trusting that the file appeared. `dest` must not exist —
 * overwriting a rollback point is never what anyone meant.
 */
export function snapshotDatabase(source, dest, { overwrite = false } = {}) {
  if (!fs.existsSync(source)) throw new Error(`no database at ${source}`);
  if (fs.existsSync(dest) && !overwrite) throw new Error(`refusing to overwrite ${dest}`);
  if (fs.existsSync(dest)) fs.rmSync(dest);
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });

  const db = new Database(source, { readonly: true });
  let live;
  try {
    live = counts(db);
    /*
     * VACUUM INTO holds a read transaction for the duration, so the file it
     * writes is one consistent point in time even if the live database is
     * being written to while it runs. Parameter binding is not available to
     * VACUUM, so the path is quoted the way SQLite quotes string literals.
     */
    db.exec(`VACUUM INTO '${String(dest).replace(/'/g, "''")}'`);
  } finally { db.close(); }

  const copy = new Database(dest, { readonly: true });
  let taken;
  let integrity;
  try {
    integrity = copy.pragma('integrity_check', { simple: true });
    taken = counts(copy);
  } finally { copy.close(); }

  const mismatched = WITNESS_TABLES.filter((t) => live[t] !== taken[t]);
  return {
    source,
    dest,
    bytes: fs.statSync(dest).size,
    integrity,
    live,
    taken,
    mismatched,
    ok: integrity === 'ok' && mismatched.length === 0,
  };
}

/**
 * Where a snapshot of `dbPath` should go for a named operation.
 *
 * Beside the database and stamped, so two runs on the same day do not collide
 * and nobody has to invent a filename under time pressure.
 */
export function snapshotPathFor(dbPath, label, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${dbPath}.snapshot-${label}-${stamp}`;
}
