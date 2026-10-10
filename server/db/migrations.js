/**
 * EXPLICIT, AUTHORISED, AUDITED MIGRATIONS — DI-08.
 *
 * Until DI-08, importing `db/client.js` WAS the migration: it opened the file, ran schema.sql and
 * migrate(), and nothing asked anyone. On 2026-10-10 a measurement script imported
 * `lib/recipientSelection.js`, which imports the client, and the live dev database silently gained
 * Phase 2/3's table and four columns (DI-08/P1/HOLDS.md, INCIDENT). The guard client.js had then
 * only caught `node -e`; a script file walked straight past it, as it had in D2 and D3.1.
 *
 * So migrating is now an operation, not a side effect. This module holds the three pieces:
 *
 *   schemaState(db)        WHETHER a database is behind this code — decided without writing it
 *   applyMigrations(db)    schema.sql + migrate(), transactional wherever SQLite allows
 *   migrateDatabase(opts)  the authorised operation: exclusive, approved, backed up, verified,
 *                          audited — what `npm run db:migrate` and an approved server start call
 *
 * HOW "BEHIND" IS DECIDED, AND WHY THIS WAY.
 *
 * The obvious detector is a version number, but migrate.js has none: it is ~1,900 lines of
 * idempotent, guarded steps, and retrofitting ids onto them would be a rewrite of the thing whose
 * safety is in question. A whole-file hash alone has the opposite problem — a comment edit to
 * migrate.js would read as "pending" for ever.
 *
 * So the authority is a REHEARSAL. The database's own schema (every CREATE in sqlite_master,
 * verbatim) is replayed into a private `:memory:` database — no rows, so it costs milliseconds even
 * for the 400 MB dev corpus — and the code's full migration is run against THAT. If the rehearsal's
 * schema comes out different, something is pending, and the difference is exactly what the real
 * migration will do. It is the code itself answering, so it cannot drift from the code.
 *
 * A hash of the code (schema.sql + migrate.js) is the FAST PATH and the AUDIT KEY, not the
 * authority: every authorised run records it with the schema fingerprint it left behind, and a
 * database whose fingerprint and code hash both match its latest record skips the rehearsal.
 *
 * WHAT A REHEARSAL CANNOT SEE: data. A new backfill with no schema change rehearses as nothing
 * pending, because the rehearsal has no rows. That is why the SERVER asks for more than "schema
 * current" — it wants this code version recorded by an authorised run (or recorded once before, so
 * a code rollback still boots) — see `serverMayStart`. A script that writes rows into an
 * UNRECORDED database is tolerated; it is no worse than before DI-08, and it never migrates.
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrateInTransaction, migrateOutsideTransaction } from './migrate.js';
import { refuseDisposableDatabase } from './disposableMarker.js';
import { WITNESS_TABLES } from '../lib/dbSnapshot.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(HERE, 'schema.sql');
const MIGRATE_FILE = path.join(HERE, 'migrate.js');
const CHECKOUT = path.resolve(HERE, '../..');

/** The audit table. Never part of the fingerprint: recording a migration is not a schema change. */
export const MIGRATIONS_TABLE = 'schema_migrations';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sha256File = (file) => {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
};

export function readSchemaSql() {
  return fs.readFileSync(SCHEMA_FILE, 'utf8');
}

/** What this checkout's migration code is, by content. */
export function codeManifest() {
  const schemaSha = sha256(fs.readFileSync(SCHEMA_FILE));
  const migrateSha = sha256(fs.readFileSync(MIGRATE_FILE));
  return { schemaSha, migrateSha, manifest: sha256(`schema.sql ${schemaSha}\nmigrate.js ${migrateSha}\n`) };
}

/** The commit the code came from, and whether the two migration files differ from it. Best effort. */
export function codeCommit() {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: CHECKOUT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    let dirty = null;
    try {
      execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'server/db/schema.sql', 'server/db/migrate.js'], { cwd: CHECKOUT, stdio: 'ignore' });
      dirty = false;
    } catch { dirty = true; }
    return { commit, dirty };
  } catch {
    return { commit: process.env.RENDER_GIT_COMMIT || null, dirty: null };
  }
}

/* ------------------------------------------------------------------------ fingerprint */

const OBJECTS_SQL = `SELECT type, name, tbl_name, sql FROM sqlite_master
  WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND tbl_name <> '${MIGRATIONS_TABLE}'`;

/** Every schema object, verbatim, keyed `type name`. */
function schemaObjects(db) {
  const out = new Map();
  for (const r of db.prepare(`${OBJECTS_SQL} ORDER BY type, name`).all()) out.set(`${r.type} ${r.name}`, r);
  return out;
}

/**
 * sha256 over every CREATE statement in sqlite_master, sorted — tables, columns (an ADD COLUMN
 * rewrites the table's stored SQL), indexes, triggers, views, CHECKs and foreign keys all included.
 * Internal sqlite_* objects and the audit table are excluded. An empty database fingerprints as
 * sha256 of nothing.
 */
export function schemaFingerprint(db) {
  const objects = schemaObjects(db);
  const h = crypto.createHash('sha256');
  for (const r of objects.values()) h.update(`${JSON.stringify([r.type, r.name, r.tbl_name, r.sql])}\n`);
  return { fingerprint: h.digest('hex'), objects: objects.size };
}

function diffObjects(before, after) {
  const changes = [];
  for (const [k, r] of after) {
    if (!before.has(k)) changes.push(`+ ${k}`);
    else if (before.get(k).sql !== r.sql) changes.push(`~ ${k}`);
  }
  for (const k of before.keys()) if (!after.has(k)) changes.push(`- ${k}`);
  return changes.sort((a, b) => a.slice(2).localeCompare(b.slice(2)));
}

/* -------------------------------------------------------------------------- applying */

/**
 * schema.sql + migrate(), as atomically as SQLite allows.
 *
 *   1. ONE IMMEDIATE TRANSACTION: schema.sql and every step of `migrateInTransaction`. A failure
 *      anywhere in it — a CREATE, an ADD COLUMN, a backfill, a guarded rebuild — rolls ALL of it
 *      back; the nested rebuilds' own transactions become SAVEPOINTs inside it.
 *   2. OUTSIDE IT, by necessity, one step: `migrateOutsideTransaction` — the Phase 1D recipient
 *      rebuild, which needs foreign keys OFF and so refuses to run inside a transaction. It runs in
 *      its own guarded transaction (count + digest + foreign_key_check verified, rolled back whole on
 *      a mismatch). If it fails, step 1 has already committed; the database is then at a coherent
 *      intermediate schema that the next authorised run completes — or the backup restores.
 *
 * Also outside any transaction, and done by the caller first: `journal_mode` and `foreign_keys`
 * (pragmas SQLite will not change inside one).
 *
 * Errors carry `migrationPhase` ('TRANSACTIONAL' | 'OUTSIDE_TRANSACTION') so the operator is told
 * which of those two states the database is in.
 */
export function applyMigrations(db) {
  const schema = readSchemaSql();
  try {
    db.transaction(() => {
      db.exec(schema);
      migrateInTransaction(db);
    }).immediate();
  } catch (e) {
    e.migrationPhase = 'TRANSACTIONAL';
    throw e;
  }
  try {
    migrateOutsideTransaction(db);
  } catch (e) {
    e.migrationPhase = 'OUTSIDE_TRANSACTION';
    throw e;
  }
}

/* ------------------------------------------------------------------------- rehearsal */

const REPLAY_ORDER = { table: 0, index: 1, view: 2, trigger: 3 };

/**
 * Run the code's migration against a SCHEMA-ONLY copy of `db` in memory. Writes nothing to `db`
 * (it only reads sqlite_master), so it is safe on a read-only handle and on the live database.
 */
export function rehearse(db) {
  const before = schemaObjects(db);
  const clone = new Database(':memory:');
  try {
    const rows = db.prepare(`${OBJECTS_SQL} AND sql IS NOT NULL ORDER BY rowid`).all()
      .sort((a, b) => (REPLAY_ORDER[a.type] ?? 9) - (REPLAY_ORDER[b.type] ?? 9));
    for (const r of rows) clone.exec(r.sql);
    // The replay must reproduce the schema exactly, or the rehearsal is of a different database.
    const replayed = schemaFingerprint(clone).fingerprint;
    if (replayed !== schemaFingerprint(db).fingerprint) {
      return { error: 'the schema could not be reproduced exactly for a rehearsal', changes: [] };
    }
    clone.pragma('foreign_keys = ON');
    try {
      applyMigrations(clone);
    } catch (e) {
      return { error: `the migration fails on a schema-only rehearsal: ${e.message}`, changes: [] };
    }
    return { error: null, expectedAfter: schemaFingerprint(clone).fingerprint, changes: diffObjects(before, schemaObjects(clone)) };
  } finally {
    clone.close();
  }
}

/* ----------------------------------------------------------------------------- state */

function hasMigrationsTable(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(MIGRATIONS_TABLE);
}

/** The authorised runs recorded in this database, newest first. */
export function migrationRecords(db) {
  if (!hasMigrationsTable(db)) return [];
  return db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE} ORDER BY id DESC`).all();
}

/**
 * Where this database stands against this code, without writing anything:
 *
 *   CURRENT     the latest authorised run recorded this code and the schema is what it left
 *   UNRECORDED  nothing is pending — the rehearsal changes nothing — but no authorised run has
 *               recorded this code version as the latest (a database from before DI-08, a code
 *               edit that changed no schema, or a schema edited out of band since)
 *   PENDING     the rehearsal changes the schema: migrations are waiting
 *   EMPTY       no schema at all: a new database, which an authorised run initialises
 */
export function schemaState(db) {
  const code = codeManifest();
  const { fingerprint, objects } = schemaFingerprint(db);
  const records = migrationRecords(db);
  const latest = records[0] ?? null;
  const base = { fingerprint, objects, code, latest, knownCode: records.some((r) => r.code_manifest === code.manifest) };
  if (latest && latest.code_manifest === code.manifest && latest.schema_after === fingerprint) {
    return { ...base, state: 'CURRENT', changes: [], expectedAfter: fingerprint };
  }
  const r = rehearse(db);
  if (r.error) return { ...base, state: objects ? 'PENDING' : 'EMPTY', changes: [], error: r.error };
  if (r.expectedAfter === fingerprint) return { ...base, state: 'UNRECORDED', changes: [], expectedAfter: fingerprint };
  return { ...base, state: objects ? 'PENDING' : 'EMPTY', changes: r.changes, expectedAfter: r.expectedAfter };
}

/**
 * The server wants the code it runs to have been migrated onto this database by an authorised run —
 * now (CURRENT), or at some point in this database's recorded history with nothing pending since,
 * which is what a code ROLLBACK to a previously-deployed version looks like.
 */
export function serverMayStart(state) {
  return state.state === 'CURRENT' || (state.state === 'UNRECORDED' && state.knownCode);
}

/* ------------------------------------------------------------------------- messages */

const MIGRATE_CMD = (dbPath) => `npm run db:migrate -- --db ${dbPath}`;

export class SchemaNotCurrentError extends Error {
  constructor(message, state) {
    super(message);
    this.name = 'SchemaNotCurrentError';
    this.code = 'SCHEMA_NOT_CURRENT';
    Object.defineProperty(this, 'state', { value: state, enumerable: false }); // in the message already; keep the stack readable
  }
}

export function describeState(state) {
  const lines = [`  schema fingerprint  ${state.fingerprint}  (${state.objects} objects)`,
    `  code manifest       ${state.code.manifest}`,
    `  state               ${state.state}`];
  if (state.latest) lines.push(`  last recorded run   #${state.latest.id} ${state.latest.kind} ${state.latest.finished_at} by ${state.latest.operator}`
    + ` (code ${state.latest.code_commit ?? 'unknown'})`);
  else lines.push('  last recorded run   none — no authorised migration has been recorded in this database');
  if (state.error) lines.push(`  rehearsal           ${state.error}`);
  if (state.changes?.length) {
    lines.push(`  pending changes     ${state.changes.length}`);
    for (const c of state.changes.slice(0, 40)) lines.push(`      ${c}`);
    if (state.changes.length > 40) lines.push(`      … ${state.changes.length - 40} more`);
  }
  return lines.join('\n');
}

/** The refusal every non-migrating opener gives. Names the command. */
export function refusal(dbPath, state, { server = false } = {}) {
  const why = {
    PENDING: 'its schema is behind this code — migrations are pending',
    EMPTY: 'it has no schema — it has never been initialised',
    UNRECORDED: 'no authorised migration has recorded this code version against it (nothing schema-level is pending, but data steps in migrate() may be)',
  }[state.state] ?? state.state;
  return new SchemaNotCurrentError(
    `Refusing to ${server ? 'start the server on' : 'use'} ${dbPath}: ${why}.\n`
    + `${describeState(state)}\n\n`
    + '  Opening the database never migrates it (DI-08). Migrate it explicitly — rehearse on a copy first:\n\n'
    + `      ${MIGRATE_CMD(dbPath)}                  # shows the plan and the fingerprint to approve\n`
    + `      ${MIGRATE_CMD(dbPath)} --approve ${state.fingerprint}\n`
    + (state.state === 'UNRECORDED' ? `      ${MIGRATE_CMD(dbPath)} --adopt --approve ${state.fingerprint}   # record only, run nothing\n` : '')
    + (state.state === 'EMPTY' && state.objects === 0 ? '      (add --create if the file does not exist yet)\n' : '')
    + '\n  See docs/DATABASE_MIGRATIONS.md.',
    state,
  );
}

/* ---------------------------------------------------------------- the authorised run */

export class MigrationRefused extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MigrationRefused';
    this.code = 'MIGRATION_REFUSED';
    for (const [k, v] of Object.entries(details)) Object.defineProperty(this, k, { value: v, enumerable: false });
  }
}

const APPROVAL_MIN = 16;
/** The fingerprint of a database with no schema at all: what `--create` approves. */
export const EMPTY_FINGERPRINT = sha256('');
function approves(approval, fingerprint) {
  const a = String(approval ?? '').trim().toLowerCase();
  return a.length >= APPROVAL_MIN && /^[0-9a-f]+$/.test(a) && fingerprint.startsWith(a);
}

export function rollbackInstructions(dbPath, backup) {
  if (!backup) return 'ROLLBACK: there was no database before this run (it was created), so rollback is deleting the file.';
  const q = (s) => `'${s.replace(/'/g, "'\\''")}'`;
  return [
    'ROLLBACK — only if this migration must be undone:',
    `  1. Stop every process using the database (server, scripts). Check: lsof ${q(dbPath)}`,
    `  2. cp ${q(backup.path)} ${q(`${dbPath}.restore-tmp`)} && mv ${q(`${dbPath}.restore-tmp`)} ${q(dbPath)}`,
    `  3. rm -f ${q(`${dbPath}-wal`)} ${q(`${dbPath}-shm`)}        (with nothing running)`,
    `  4. shasum -a 256 ${q(dbPath)}   → must print ${backup.sha256}`,
    '  The backup is a byte-exact copy of the database as it was immediately before this run.',
  ].join('\n');
}

const RECORD_DDL = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('MIGRATE', 'ADOPT', 'CREATE')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  operator TEXT NOT NULL,
  approval TEXT NOT NULL,
  code_commit TEXT,
  code_dirty INTEGER,
  code_manifest TEXT NOT NULL,
  schema_sql_sha256 TEXT NOT NULL,
  migrate_js_sha256 TEXT NOT NULL,
  schema_before TEXT NOT NULL,
  schema_after TEXT NOT NULL,
  changes TEXT NOT NULL,
  rows_written INTEGER NOT NULL,
  backup_path TEXT,
  backup_sha256 TEXT,
  integrity_check TEXT NOT NULL,
  foreign_key_violations_before INTEGER NOT NULL,
  foreign_key_violations_after INTEGER NOT NULL
)`;

/** Take the exclusive lock, or say who has the database. */
function lockExclusively(db, dbPath) {
  db.pragma('locking_mode = EXCLUSIVE');
  try {
    db.exec('BEGIN EXCLUSIVE');
    db.exec('COMMIT');
  } catch (e) {
    if (e.code === 'SQLITE_BUSY' || e.code === 'SQLITE_LOCKED') {
      throw new MigrationRefused(`Refusing to migrate ${dbPath}: another process has it open (SQLITE_BUSY). `
        + 'Stop the server and every script using it, then run again.');
    }
    throw e;
  }
}

/**
 * A byte-exact copy, verified. Taken while THIS connection holds the exclusive lock and after a
 * TRUNCATE checkpoint has folded the WAL into the main file — so, unlike the 13J `cp`, the main
 * file is the whole database and nothing can write it mid-copy. Byte-exact rather than VACUUM INTO
 * (lib/dbSnapshot.js) or the backup API (scripts/backup.js) because a rollback must bring back the
 * very sha256 every DI baseline records; those two produce an equivalent database with different
 * bytes. Then opened and checked like theirs: integrity_check, and the same witness counts.
 */
function backupExact(db, dbPath, dest) {
  const ck = db.pragma('wal_checkpoint(TRUNCATE)')[0];
  if (ck && ck.busy) throw new MigrationRefused(`Refusing to migrate ${dbPath}: the WAL could not be checkpointed (busy).`);
  const wal = `${dbPath}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) throw new MigrationRefused(`Refusing to migrate ${dbPath}: its WAL still holds frames after a checkpoint.`);
  if (fs.existsSync(dest)) throw new MigrationRefused(`Refusing to overwrite an existing backup at ${dest}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const sourceSha = sha256File(dbPath);
  fs.copyFileSync(dbPath, dest, fs.constants.COPYFILE_EXCL);
  const backupSha = sha256File(dest);
  if (backupSha !== sourceSha) throw new MigrationRefused(`The backup at ${dest} does not match the database byte for byte.`);
  const counts = (h) => Object.fromEntries(WITNESS_TABLES.map((t) => {
    try { return [t, h.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]; } catch { return [t, null]; }
  }));
  const live = counts(db);
  const copy = new Database(dest, { readonly: true });
  let integrity; let taken;
  try {
    integrity = copy.pragma('integrity_check', { simple: true });
    taken = counts(copy);
  } finally { copy.close(); }
  for (const s of ['-wal', '-shm']) fs.rmSync(`${dest}${s}`, { force: true });
  const mismatched = WITNESS_TABLES.filter((t) => live[t] !== taken[t]);
  if (integrity !== 'ok' || mismatched.length) {
    throw new MigrationRefused(`The backup at ${dest} failed verification (integrity_check ${integrity}; count mismatch: ${mismatched.join(', ') || 'none'}).`);
  }
  fs.chmodSync(dest, 0o444);
  return { path: dest, sha256: backupSha, integrity, counts: taken };
}

export function defaultBackupPath(dbPath, now = new Date()) {
  return `${dbPath}.snapshot-PRE_MIGRATION-${now.toISOString().replace(/[:.]/g, '-')}`;
}

/**
 * THE AUTHORISED MIGRATION. Synchronous, so the server can run it before it opens its own handle.
 *
 *   dbPath     an explicit file — never ':memory:', never implied
 *   approve    the database's CURRENT schema fingerprint (or a ≥16-hex prefix of it), as printed by
 *              a plan run. It binds the approval to the exact state that was rehearsed: a stale
 *              approval, or one meant for a different database state, matches nothing
 *   adopt      record this code version against a database that needs nothing, running nothing
 *   create     initialise a file that does not exist yet
 *   backupPath where the byte-exact pre-migration copy goes (default beside the database)
 *   operator   who; defaults to the OS user
 *
 * Without a matching approval it changes nothing and throws MigrationRefused carrying the plan.
 * Returns { applied, kind, before, after, backup, record, changes, rowsWritten }.
 */
export function migrateDatabase({
  dbPath, approve, adopt = false, create = false, backupPath, operator, now = () => new Date(), log = () => {},
} = {}) {
  if (!dbPath || String(dbPath).trim() === ':memory:') throw new MigrationRefused('An authorised migration needs an explicit database file (--db <path>).');
  const file = path.resolve(String(dbPath).trim());
  const exists = fs.existsSync(file);
  if (!exists && !create) throw new MigrationRefused(`No database at ${file}. Pass --create to initialise a new one.`);
  if (exists && create) throw new MigrationRefused(`--create was given, but ${file} already exists.`);
  if (adopt && create) throw new MigrationRefused('--adopt records an existing database; it cannot create one.');
  if (create && !approves(approve, EMPTY_FINGERPRINT)) {
    // Refused before the file is opened, so an unapproved --create leaves nothing behind.
    const empty = new Database(':memory:');
    let state;
    try { state = schemaState(empty); } finally { empty.close(); }
    throw new MigrationRefused(`Not approved: ${file} would be created and initialised:\n${describeState(state)}\n\n`
      + `  To create it, pass --create --approve ${EMPTY_FINGERPRINT}`, { state, approvalRequired: true });
  }

  const db = new Database(file, { fileMustExist: exists, timeout: 0 });
  let closed = false;
  try {
    lockExclusively(db, file);
    try { refuseDisposableDatabase(db, file); } catch (e) { closed = true; throw e; }
    const state = schemaState(db);
    if (state.state === 'CURRENT') {
      log(`Nothing to do: ${file} is CURRENT for this code (recorded run #${state.latest.id}).`);
      return { applied: false, state };
    }
    if (adopt && state.state !== 'UNRECORDED') {
      throw new MigrationRefused(`Refusing to adopt ${file}: it is ${state.state}, not merely unrecorded — migrations are pending, so run without --adopt.\n${describeState(state)}`, { state });
    }
    if (state.error) {
      throw new MigrationRefused(`Refusing to migrate ${file}: ${state.error}.\n${describeState(state)}`, { state });
    }
    if (!approves(approve, state.fingerprint)) {
      throw new MigrationRefused(
        `${approve ? 'The approval does not match' : 'Not approved'}: ${file} would be ${adopt ? 'adopted' : 'migrated'} from this state:\n`
        + `${describeState(state)}\n\n`
        + `  To apply, rehearse on a copy, then pass --approve ${state.fingerprint}`,
        { state, approvalRequired: true },
      );
    }

    const startedAt = now().toISOString();
    const kind = create ? 'CREATE' : adopt ? 'ADOPT' : 'MIGRATE';
    const backup = exists ? backupExact(db, file, backupPath ? path.resolve(backupPath) : defaultBackupPath(file, now())) : null;
    if (backup) log(`Backup ${backup.path}\n  sha256 ${backup.sha256}  integrity_check ${backup.integrity}`);

    const fkBefore = db.pragma('foreign_key_check');
    let rowsWritten = 0;
    if (!adopt) {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      const c0 = db.prepare('SELECT total_changes() n').get().n;
      try {
        applyMigrations(db);
      } catch (e) {
        const partial = e.migrationPhase === 'OUTSIDE_TRANSACTION';
        throw new MigrationRefused(
          `MIGRATION FAILED (${e.migrationPhase ?? 'unknown phase'}): ${e.message}\n`
          + (partial
            ? '  schema.sql and the transactional steps COMMITTED; the outside-transaction step rolled itself back.\n'
              + '  The database is at a coherent intermediate schema. Restore the backup, or fix and re-run.\n'
            : '  The transaction rolled back: the database is unchanged.\n')
          + rollbackInstructions(file, backup),
          { cause: e, backup, partial, failed: true },
        );
      }
      rowsWritten = db.prepare('SELECT total_changes() n').get().n - c0;
    }

    const integrity = db.pragma('integrity_check', { simple: true });
    const fkAfter = db.pragma('foreign_key_check');
    const seen = new Set(fkBefore.map((v) => JSON.stringify(v)));
    const newViolations = fkAfter.filter((v) => !seen.has(JSON.stringify(v)));
    const after = schemaFingerprint(db).fingerprint;
    const problems = [];
    if (integrity !== 'ok') problems.push(`integrity_check: ${integrity}`);
    if (newViolations.length) problems.push(`${newViolations.length} new foreign_key_check violation(s)`);
    if (after !== state.expectedAfter) problems.push(`schema fingerprint ${after} is not the rehearsed ${state.expectedAfter}`);
    if (problems.length) {
      throw new MigrationRefused(`MIGRATION VERIFICATION FAILED after commit: ${problems.join('; ')}.\n${rollbackInstructions(file, backup)}`, { backup, failed: true });
    }

    const { commit, dirty } = codeCommit();
    const record = {
      kind,
      started_at: startedAt,
      finished_at: now().toISOString(),
      operator: operator || process.env.THRIV3_OPERATOR || os.userInfo().username,
      approval: String(approve).trim().toLowerCase(),
      code_commit: commit,
      code_dirty: dirty === null ? null : Number(dirty),
      code_manifest: state.code.manifest,
      schema_sql_sha256: state.code.schemaSha,
      migrate_js_sha256: state.code.migrateSha,
      schema_before: state.fingerprint,
      schema_after: after,
      changes: JSON.stringify(state.changes),
      rows_written: rowsWritten,
      backup_path: backup?.path ?? null,
      backup_sha256: backup?.sha256 ?? null,
      integrity_check: integrity,
      foreign_key_violations_before: fkBefore.length,
      foreign_key_violations_after: fkAfter.length,
    };
    db.transaction(() => {
      db.exec(RECORD_DDL);
      const cols = Object.keys(record);
      record.id = Number(db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(record).lastInsertRowid);
    }).immediate();
    log(`${kind} recorded as ${MIGRATIONS_TABLE} #${record.id}: ${state.fingerprint.slice(0, 16)}… → ${after.slice(0, 16)}…`
      + ` (${state.changes.length} schema change(s), ${rowsWritten} row(s) written)`);
    log(rollbackInstructions(file, backup));
    return { applied: true, kind, before: state.fingerprint, after, backup, record, changes: state.changes, rowsWritten, state };
  } finally {
    if (!closed) { try { db.close(); } catch { /* closed */ } }
  }
}
