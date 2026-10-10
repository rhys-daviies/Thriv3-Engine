import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDbPath } from './corpusIdentity.js';
import { refuseDisposableDatabase } from './disposableMarker.js';
import { applyMigrations, schemaState, serverMayStart, refusal, migrateDatabase } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

// RECRUITMATCH_DB lets tests point at ':memory:' or a throwaway file rather
// than the working database.
export const dbPath = resolveDbPath();

/**
 * NO DEFAULT DATABASE FOR A `node -e` ONE-LINER — D3.2.
 *
 * Importing this module is not a read. Until DI-08 it opened the database, ran
 * `schema.sql` and ran `migrate()` — three writes — so the casual check
 *
 *     node -e "import('./server/lib/whatever.js').then(...)"
 *
 * silently opens and migrates the OPERATOR'S WORKING DATABASE. That happened
 * twice, in D2 and again in D3.1, both times while verifying that a new module
 * merely imports cleanly. Nothing was lost either time — `CREATE TABLE IF NOT
 * EXISTS` and an idempotent migration — but "it was harmless twice" is not a
 * property of the next one, and a stray import that runs migrations against
 * production data is exactly the accident that has no undo.
 *
 * The signal is precise: `process.argv[1]` is the entry script, and it is
 * `undefined` only for `-e`, `--eval`, `-p` and the REPL. A real script, an npm
 * script, a vitest worker and `node server/index.js` all set it, so normal
 * startup and the whole test suite are untouched — and the suite additionally
 * sets RECRUITMATCH_DB to ':memory:', which satisfies this guard on its own.
 *
 * It refuses rather than defaults. A one-liner that genuinely wants a database
 * says which one, and the message says how.
 *
 * Reconciled with the corpus resolver: the predicate is the TRIMMED value,
 * which is what `resolveDbPath` actually acts on. `RECRUITMATCH_DB="  "`
 * otherwise reads as "a database was chosen" here while the resolver falls
 * through to the default — the exact case this guard exists to refuse.
 */
if (!(process.env.RECRUITMATCH_DB ?? '').trim() && process.argv[1] === undefined) {
  throw new Error(
    'Refusing to open the default database from an inline `node -e` / REPL session.\n'
    + `  Importing this module opens ${dbPath} read-write (it no longer migrates it — DI-08 — but a module may still write rows).\n`
    + '  Say which database you mean:\n\n'
    + '      RECRUITMATCH_DB=:memory: node -e "import(...)"\n\n'
    + '  Use an explicit path only when you intend to use that file.',
  );
}
/**
 * READ-ONLY MODE — for measuring a COPY (deployment readiness §4), never for serving.
 *
 * RECRUITMATCH_DB_READONLY=1 opens RECRUITMATCH_DB with SQLITE_OPEN_READONLY and
 * then does none of the normal start-up: no journal-mode switch, no schema.sql,
 * no migrate(). It sets query_only as well. So the file cannot be migrated or
 * written by anything in the process, including a module that writes at import
 * time: SQLite refuses the write. It only ever narrows what the default does, and
 * it needs an explicit file path, so it cannot quietly apply to the working
 * database by default or to a throwaway in-memory one.
 *
 * The copy must already be on the code's schema. Nothing here checks that, because
 * checking would need the migration this mode exists to prevent; callers check
 * first (server/scripts/measureCoachEligibility.js).
 */
export const readOnly = /^(1|true|yes)$/i.test(String(process.env.RECRUITMATCH_DB_READONLY ?? '').trim());
if (readOnly && (!(process.env.RECRUITMATCH_DB ?? '').trim() || dbPath === ':memory:')) {
  throw new Error('RECRUITMATCH_DB_READONLY needs RECRUITMATCH_DB to name a database file (a copy).');
}

/**
 * IMPORTING THIS MODULE NEVER MIGRATES A DATABASE FILE — DI-08.
 *
 * Until DI-08 the lines below ran `db.exec(schema.sql)` and `migrate(db)` on every import. The
 * `node -e` guard above caught one way in; a script file was another, and on 2026-10-10 a
 * measurement script that imported lib/recipientSelection.js applied Phase 2/3's pending migrations
 * to the live dev database with nobody's say-so (DI-08/P1/HOLDS.md, INCIDENT). Every transitive
 * importer — a route, an entity, a library a script borrows — was the same open door.
 *
 * Now there are exactly three cases, and only one of them changes a schema:
 *
 *   ':memory:'   schema.sql + migrate(), as before. It is the test suite's database: created empty
 *                by this process, private to it, gone when it exits. There is no one else's data to
 *                change and no state to approve, so making it explicit would be ceremony.
 *
 *   READ-ONLY    unchanged: SQLITE_OPEN_READONLY + query_only, no schema work. The copy must
 *                already be on the code's schema; that is still the caller's check.
 *
 *   a FILE       opened, with NO DDL and NO journal-mode switch, and then CHECKED — by a rehearsal
 *                on a schema-only copy in memory (db/migrations.js), which writes nothing. Behind
 *                (PENDING/EMPTY): refuse, naming `npm run db:migrate`. Rows may still be written by
 *                the scripts that exist to write them (integrity:promote, the apply* tools); the
 *                schema may not be changed by them. A missing file is not created.
 *
 * THE SERVER asks for more than "nothing pending": the code it runs must have been recorded by an
 * authorised run (`serverMayStart`), because a rehearsal has no rows and so cannot see a pending
 * data backfill — and before DI-08 every boot ran those. It never migrates implicitly. It migrates
 * only when THRIV3_MIGRATION_APPROVAL names the database's exact current schema fingerprint — the
 * production path, where a pre-deploy step has no access to the disk — and then through the same
 * authorised operation `npm run db:migrate` runs: exclusive lock, byte-exact backup, one
 * transaction, integrity + foreign-key verification, an audit row. A stale approval matches no
 * other state, and the variable is ignored by every process that is not the server entry point.
 */
const memory = dbPath === ':memory:';
const serverEntry = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(path.resolve(__dirname, '../index.js')); }
  catch { return false; }
})();
const approval = (process.env.THRIV3_MIGRATION_APPROVAL ?? '').trim();
if (!memory && !readOnly && serverEntry && approval && fs.existsSync(dbPath)) {
  // Throws (and so refuses to start) on a mismatched approval, a busy database or any failure.
  migrateDatabase({
    dbPath, approve: approval, operator: process.env.THRIV3_OPERATOR || 'server-startup',
    log: (line) => console.log(`[db:migrate] ${line}`),
  });
}
if (!memory && !readOnly && !fs.existsSync(dbPath)) {
  throw new Error(`No database at ${dbPath}. Opening never creates one (DI-08).\n`
    + `  Initialise it explicitly: npm run db:migrate -- --db ${dbPath} --create\n  See docs/DATABASE_MIGRATIONS.md.`);
}

const db = readOnly
  ? new Database(dbPath, { readonly: true, fileMustExist: true })
  : new Database(dbPath, { fileMustExist: !memory });
// DI-03H (DI-03G MAJOR-A): a correction rehearsal copy is never served or measured as an application database.
// Checked first in every mode — before any schema check or migration, and before any caller can read application data.
refuseDisposableDatabase(db, dbPath);
if (readOnly) {
  db.pragma('query_only = ON');
} else {
  db.pragma('foreign_keys = ON');
  if (memory) {
    applyMigrations(db);
  } else {
    const state = schemaState(db);
    const ok = serverEntry ? serverMayStart(state) : state.state === 'CURRENT' || state.state === 'UNRECORDED';
    if (!ok) {
      db.close();
      throw refusal(dbPath, state, { server: serverEntry });
    }
  }
}

export default db;
