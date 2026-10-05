import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { defaultDbPath } from './db/corpusIdentity.js';

/**
 * PER-RUN SCRATCH DIRECTORIES FOR THE TEST SUITE — the vitest globalSetup.
 *
 * vitest.config.js points THRIV3_BUILD_DIR, THRIV3_UPLOADS_DIR and
 * THRIV3_TEST_DB_DIR (the database copies, below) at a run directory of their
 * own under node_modules/.tmp. The first two used to share one
 * directory per kind, and generated pages carry random slugs, so it only ever
 * grew: about 800 pages a full run, 64,000 pages and 1.5 GB by October.
 *
 * Each run now removes its own directory when it ends, pass or fail. A run that
 * was killed before teardown leaves one behind, and the next run sweeps it once
 * the process that owned it is gone.
 *
 * ONE DIRECTORY PER RUN, NOT ONE DIRECTORY CLEARED AT START. The worktrees reach
 * this node_modules through symlinks, so two runs can be live at once; clearing
 * a shared directory would delete pages a concurrent run is still reading.
 *
 * Test infrastructure only. Nothing at runtime imports this module.
 */

export const SCRATCH_KINDS = Object.freeze(['thriv3-test-build', 'thriv3-test-uploads', 'thriv3-test-db']);

/** The run's read-only copy of the working database, inside THRIV3_TEST_DB_DIR. */
export const WORKING_COPY = 'working.sqlite';
const RUN_NAME = /^run-(\d+)-\d+$/;

export const runDirName = (pid = process.pid, now = Date.now()) => `run-${pid}-${now}`;

/**
 * The directory, resolved, if it is a run directory this module may delete —
 * `…/node_modules/.tmp/<kind>/run-<pid>-<ms>` — and a throw for anything else.
 * Everything that removes a path goes through here first.
 */
export function assertRunDir(dir) {
  if (typeof dir !== 'string' || !dir.trim()) throw new Error(`Refusing an empty test scratch path: ${dir}`);
  const abs = path.resolve(dir);
  const kind = path.dirname(abs);
  const tmp = path.dirname(kind);
  const ok = RUN_NAME.test(path.basename(abs))
    && SCRATCH_KINDS.includes(path.basename(kind))
    && path.basename(tmp) === '.tmp'
    && path.basename(path.dirname(tmp)) === 'node_modules';
  if (!ok) {
    throw new Error(`Refusing to treat ${dir} as test scratch: expected node_modules/.tmp/<${SCRATCH_KINDS.join('|')}>/run-<pid>-<ms>`);
  }
  return abs;
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
};

/** Removes run directories under `kindDir` whose owning process has exited. */
export function sweepAbandoned(kindDir) {
  let names;
  try { names = fs.readdirSync(kindDir); } catch { return []; }
  const removed = [];
  for (const name of names) {
    const m = RUN_NAME.exec(name);
    if (!m || alive(Number(m[1]))) continue;
    const dir = assertRunDir(path.join(kindDir, name));
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

/**
 * A copy-on-write clone where the filesystem has one (`cp -c` on APFS: free
 * until written), else an ordinary copy. Node's own copyFile does not clone on
 * macOS — measured: a full 320 MB copy where `cp -c` used 4 KB.
 */
export function cloneFile(source, dest) {
  if (process.platform === 'darwin') {
    try { execFileSync('/bin/cp', ['-c', source, dest], { stdio: 'ignore' }); return; } catch { /* not APFS */ }
  }
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_FICLONE);
}

/**
 * THE ONE READ OF THE WORKING DATABASE IN A TEST RUN — Phase 1.5.
 *
 * A byte copy, taken here in the vitest main process before any worker starts,
 * because a copy cannot run SQL against its source: nothing about the working
 * file changes. Every suite that wants realistic data clones THIS file
 * (`workingCorpusCopy`), and the guard in testDbGuard.js refuses the original.
 *
 * A non-empty -wal is copied with it and folded into the COPY, so the copy is
 * a single self-contained file. Then it is made read-only: suites mutate their
 * own clones, never the run's source.
 *
 * Absent or bare working database: no copy, and the suites skip as they always
 * have when there was no database to read.
 */
export function takeWorkingCopy(dbDir, working = defaultDbPath) {
  let size = 0;
  try { size = fs.statSync(working).size; } catch { return null; }
  if (size < 1_000_000) return null;

  const dest = path.join(assertRunDir(dbDir), WORKING_COPY);
  cloneFile(working, dest);
  const wal = `${working}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
    cloneFile(wal, `${dest}-wal`);
    const db = new Database(dest);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  }
  for (const suffix of ['-wal', '-shm']) fs.rmSync(dest + suffix, { force: true });
  fs.chmodSync(dest, 0o444);
  return dest;
}

/** `working` is for this module's own tests, which must not read the real one. */
export default function setup({ config }, { working = defaultDbPath } = {}) {
  const dirs = [config.env.THRIV3_BUILD_DIR, config.env.THRIV3_UPLOADS_DIR, config.env.THRIV3_TEST_DB_DIR]
    .map(assertRunDir);
  for (const dir of dirs) sweepAbandoned(path.dirname(dir));
  const dbDir = dirs[2];
  fs.mkdirSync(dbDir, { recursive: true });
  takeWorkingCopy(dbDir, working);
  return () => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  };
}
