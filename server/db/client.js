import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

// RECRUITMATCH_DB lets tests point at ':memory:' or a throwaway file rather
// than the working database.
const dbPath = process.env.RECRUITMATCH_DB || path.join(dataDir, 'recruitmatch.sqlite');

/**
 * NO DEFAULT DATABASE FOR A `node -e` ONE-LINER — D3.2.
 *
 * Importing this module is not a read. It opens the database, runs
 * `schema.sql` and runs `migrate()` — three writes — so the casual check
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
 */
if (!process.env.RECRUITMATCH_DB && process.argv[1] === undefined) {
  throw new Error(
    'Refusing to open the default database from an inline `node -e` / REPL session.\n'
    + `  Importing this module runs schema.sql and migrate() against ${dbPath}.\n`
    + '  Say which database you mean:\n\n'
    + '      RECRUITMATCH_DB=:memory: node -e "import(...)"\n\n'
    + '  Use an explicit path only when you intend to migrate that file.',
  );
}
const db = new Database(dbPath);
if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);
migrate(db);

export default db;
