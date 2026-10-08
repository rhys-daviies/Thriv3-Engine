import fs from 'node:fs';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { defaultDbPath, checkoutRoot } from './db/corpusIdentity.js';

/**
 * NO TEST OPENS THE WORKING DATABASE — Phase 1.5.
 *
 * Importing `server/db/client.js` runs schema.sql, migrate() and sets WAL mode,
 * so a suite that only meant to READ `server/data/recruitmatch.sqlite` through a
 * child process was writing it: a full run moved its hash. Suites now read a
 * private copy (`workingCorpusCopy` in server/testCorpus.js). This is the
 * backstop for the next one that forgets.
 *
 * It wraps better-sqlite3 so that opening the working database, or backing up
 * INTO it, throws before SQLite is reached. Installed by vitest.config.js in two
 * places and nowhere else:
 *
 *   setupFiles     the test workers themselves
 *   NODE_OPTIONS   `--import` of this file, inherited by every Node child a
 *                  test spawns with `{ ...process.env }` — which is how the
 *                  writes actually happened
 *
 * Test infrastructure only: the server, the scripts and Render never load it,
 * so the operator's own use of the working database is untouched.
 */

const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

/** Absolute, symlinks resolved, case folded where the filesystem ignores case. */
function canonical(p) {
  let abs = path.resolve(p);
  // Follow symlinks by hand first. realpath cannot resolve one whose target
  // does not exist yet — the working database in a clean checkout, CI or a
  // worktree — and opening through it would create the file at the target.
  for (let hops = 0; hops < 40; hops += 1) {
    let st;
    try { st = fs.lstatSync(abs); } catch { break; }
    if (!st.isSymbolicLink()) break;
    abs = path.resolve(path.dirname(abs), fs.readlinkSync(abs));
  }
  let real;
  try { real = fs.realpathSync.native(abs); } catch {
    // Not there (yet): resolve the directory, which is where a symlink would be.
    try { real = path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs)); } catch { real = abs; }
  }
  return CASE_INSENSITIVE ? real.toLowerCase() : real;
}

/**
 * Whether `filename` is the working database, however it is spelled: relative,
 * through `..`, through a symlink, in another case, or as a hard link to it.
 * A path that does not exist yet still counts — creating a fresh database at
 * the working path is the failure L8B-4 measured.
 */
export function isWorkingDatabase(filename, working = defaultDbPath) {
  if (typeof filename !== 'string') return false; // a Buffer is a serialized in-memory database
  const f = filename.trim();
  if (!f || f === ':memory:') return false;
  if (canonical(f) === canonical(working)) return true;
  try {
    const a = fs.statSync(f);
    const b = fs.statSync(working);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

export class WorkingDatabaseInTest extends Error {
  constructor(verb, filename) {
    super(`Refusing to ${verb} the working database from a test: ${filename}\n`
      + '  Tests read a private copy instead: workingCorpusCopy() in server/testCorpus.js.');
    this.name = 'WorkingDatabaseInTest';
    this.code = 'WORKING_DB_IN_TEST';
  }
}

const refuse = (verb, filename) => {
  if (isWorkingDatabase(filename)) throw new WorkingDatabaseInTest(verb, filename);
};

const GUARDED = Symbol.for('thriv3.testDbGuard');
const require = createRequire(path.join(checkoutRoot, 'package.json'));
const Real = require('better-sqlite3');

/**
 * The wrapped constructor, created once per process even if this file is
 * evaluated twice (the --import preload and a vitest setupFile are separate
 * module instances when both apply).
 */
const Database = Real[GUARDED] ?? (() => {
  function GuardedDatabase(filename, options) {
    refuse('open', filename);
    return new Real(filename, options);
  }
  Object.setPrototypeOf(GuardedDatabase, Real);
  GuardedDatabase.prototype = Real.prototype;

  const backup = Real.prototype.backup;
  Real.prototype.backup = function guardedBackup(destination, options) {
    refuse('back up into', destination);
    return backup.call(this, destination, options);
  };

  Real[GUARDED] = GuardedDatabase;
  // `require('better-sqlite3')` returns this cache entry's exports.
  require.cache[require.resolve('better-sqlite3')].exports = GuardedDatabase;

  /**
   * `import Database from 'better-sqlite3'` does NOT read that cache entry, so
   * ESM — which is every caller in this repository — is redirected here by a
   * resolve hook instead, and gets the default export below. Synchronous hooks
   * so they apply in-thread, before any test or child imports the driver.
   */
  if (typeof registerHooks !== 'function') {
    throw new Error('The test database guard needs module.registerHooks (Node 22.15+ / 23.5+). '
      + `This is Node ${process.version}.`);
  }
  // Matched on the RESOLVED url, not the specifier: vitest imports externals
  // by absolute file URL rather than by package name.
  const self = import.meta.url;
  const driver = pathToFileURL(require.resolve('better-sqlite3')).href;
  registerHooks({
    resolve(specifier, context, next) {
      const result = next(specifier, context);
      if (result.url === driver && context.parentURL !== self && context.conditions?.includes('import')) {
        return { url: self, format: 'module', shortCircuit: true };
      }
      return result;
    },
  });
  return GuardedDatabase;
})();

export default Database;
