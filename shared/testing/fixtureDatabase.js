/**
 * Resolve the DATABASE a suite means when it says "the real one".
 *
 * -- THE DEFECT THIS EXISTS TO FIX ----------------------------------------
 *
 * Several suites drive a real command in a subprocess against a populated
 * database. They resolved it as `<repoRoot>/server/data/recruitmatch.sqlite`
 * and gated themselves on `fs.existsSync(thatPath)`.
 *
 * Both halves are wrong in a git worktree. The path ignores
 * `RECRUITMATCH_DB`, which is how every other part of this codebase is told
 * where the database is; and the gate asks whether a FILE EXISTS rather than
 * whether it holds anything, so a 741 KB worktree stub with zero `colleges`
 * rows passed the gate and the suite then ran against an empty database and
 * failed four assertions. The stub silently became authoritative.
 *
 * -- WHY A SEPARATE ENV VAR AND NOT JUST RECRUITMATCH_DB ------------------
 *
 * `vitest.config.js` sets `RECRUITMATCH_DB=':memory:'` for every test worker
 * ON PURPOSE, so that a suite which opens the database in-process can never
 * touch the working one. That is correct and is not changed here. It also
 * means `RECRUITMATCH_DB` inside a worker is never the answer to "where is
 * the populated database" - it is the answer to "where must you NOT write".
 *
 * So the order is: `RECRUITMATCH_TEST_DB` first, because it is the one
 * variable that can only mean this; then `RECRUITMATCH_DB` when it names a
 * real file rather than `:memory:`, so a caller outside vitest still works;
 * then the repository default.
 *
 * -- SKIPPING IS A DECISION, NOT A FALLBACK -------------------------------
 *
 * `usable` is false unless every table the suite named actually has rows.
 * A suite that finds it false must skip and SAY SO. It must not fall back to
 * a weaker assertion: a test that passes against an empty database is worse
 * than one that skips, because it reports a guarantee nobody checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { workingCorpusCopy } from '../../server/testCorpus.js';

const require = createRequire(import.meta.url);

/**
 * @param {object} opts
 * @param {string} opts.root        repository root
 * @param {string[]} [opts.requires] tables that must contain at least one row
 * @returns {{path:string, source:string, usable:boolean, why:string|null}}
 */
export function resolveFixtureDatabase({ root, requires = [] }) {
  const explicit = process.env.RECRUITMATCH_TEST_DB;
  const configured = process.env.RECRUITMATCH_DB;

  // The default is a private copy of the working database, never the file
  // itself: these suites spawn children that import client.js, which migrates
  // whatever it opens (Phase 1.5). The working path is only the answer outside
  // a test run, where the guard that refuses it is not installed.
  const [dbPath, source] = explicit
    ? [explicit, 'RECRUITMATCH_TEST_DB']
    : (configured && configured !== ':memory:')
      ? [configured, 'RECRUITMATCH_DB']
      : [workingCorpusCopy('fixture') ?? path.join(root, 'server/data/recruitmatch.sqlite'), 'working-database copy'];

  if (!fs.existsSync(dbPath)) {
    return { path: dbPath, source, usable: false, why: `no database file at ${dbPath}` };
  }

  // A file is not a dataset. Ask the tables the caller actually needs.
  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    for (const table of requires) {
      const row = db.prepare(`select count(*) as n from ${table}`).get();
      if (!row || row.n === 0) {
        return { path: dbPath, source, usable: false, why: `${dbPath} has no rows in "${table}"` };
      }
    }
  } catch (e) {
    return { path: dbPath, source, usable: false, why: `${dbPath} is not readable: ${e.message}` };
  } finally {
    try { db?.close(); } catch { /* closing a read-only handle cannot fail meaningfully */ }
  }

  return { path: dbPath, source, usable: true, why: null };
}

/** The message a skipping suite prints, so a skip is never silent. */
export function fixtureSkipNotice(file, resolved) {
  return `\n  ${file} SKIPPED — ${resolved.why}.\n`
    + `  Resolved from: ${resolved.source}.\n`
    + '  These suites drive a real command against a populated database. Point\n'
    + '  RECRUITMATCH_TEST_DB at one to run them:\n\n'
    + '      RECRUITMATCH_TEST_DB=/path/to/recruitmatch.sqlite npx vitest run\n';
}
