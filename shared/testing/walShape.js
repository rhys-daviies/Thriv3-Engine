import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/**
 * THE SHAPE THAT EXPOSED "A DRY RUN IS NOT OBSERVATIONAL" — and the fingerprint that can see it.
 *
 * A writable connection that is the LAST to close a WAL-mode database checkpoints it: the -wal file is folded into
 * the main file and deleted. No row moves, so a logical hash cannot see it; only the files can. Reproducing it
 * needs a database in WAL mode with frames sitting in the -wal file and NO connection open — which SQLite never
 * leaves behind on its own, so it is built here by copying the main and -wal files while a writer is still open.
 *
 * Test-only (better-sqlite3 + files). Not imported by anything at runtime.
 */

/** A WAL-mode copy of `src` at `out`: frames in `out-wal`, no connection open to it. Returns `out`. */
export function walShapedCopy(src, out) {
  const w = new Database(src);
  try {
    w.pragma('journal_mode = WAL');
    w.pragma('wal_autocheckpoint = 0');
    w.exec('CREATE TABLE IF NOT EXISTS wal_marker (x INTEGER)');
    w.prepare('INSERT INTO wal_marker VALUES (?)').run(1);        // the frames that must survive a dry run
    fs.copyFileSync(src, out);
    fs.copyFileSync(`${src}-wal`, `${out}-wal`);                  // copied while the writer is still open: main + WAL, no shm
  } finally { w.close(); }
  return out;
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * What a reader may NOT change: the main file and the -wal file, byte for byte.
 *
 * `-shm` is deliberately not compared. SQLite may create or refresh that wal-index for any reader of a WAL
 * database; it is a rebuildable cache of where pages sit in the WAL and holds no data.
 */
export function physicalState(dbFile) {
  const wal = `${dbFile}-wal`;
  return {
    main: sha(dbFile), mainBytes: fs.statSync(dbFile).size,
    wal: fs.existsSync(wal) ? sha(wal) : null, walBytes: fs.existsSync(wal) ? fs.statSync(wal).size : null,
  };
}
