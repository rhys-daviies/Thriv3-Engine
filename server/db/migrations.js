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
 * A hash of the code (schema.sql + migrate.js, normalised to what executes — DI-09A) is the FAST
 * PATH and the AUDIT KEY, not the authority: every authorised run records it with the schema
 * fingerprint it left behind, and a database whose fingerprint and code hash both match its latest
 * record skips the rehearsal.
 *
 * DI-09A HARDENING (stacked on PR #92): approvals name a PLAN (kind + schema before + code + predicted
 * after), not a fingerprint; adoption proves itself with a rolled-back dry run and a structural
 * comparison; the audit row commits inside the migration transaction (APPLYING → COMPLETE/FAILED);
 * drift after a recorded run and unfinished runs keep the server down; production migrates in a
 * separate `db:deploy` step against approvals committed in MIGRATION_APPROVALS.json.
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
import { normalisedSource } from './codeIdentity.js';
import { structuralDifferences } from './schemaConformance.js';

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

/**
 * What this checkout's migration code is — by what EXECUTES (DI-09A).
 *
 * `manifest` hashes schema.sql and migrate.js after normalisation (codeIdentity.js): comments and
 * insignificant whitespace removed, string/template/regex literals kept verbatim. A comment edit no
 * longer reads as new migration code; any change to a statement, a SQL string or the order of steps
 * still does. The raw file hashes are kept beside it for the audit row.
 *
 * Version-tagged (`v2`) so a DI-08 byte-hash manifest can never collide with one of these.
 */
export function codeManifest() {
  const schemaRaw = fs.readFileSync(SCHEMA_FILE);
  const migrateRaw = fs.readFileSync(MIGRATE_FILE);
  const schemaNorm = normalisedSource('sql', schemaRaw.toString('utf8'));
  const migrateNorm = normalisedSource('js', migrateRaw.toString('utf8'));
  const schemaExec = sha256(schemaNorm.text);
  const migrateExec = sha256(migrateNorm.text);
  return {
    schemaSha: sha256(schemaRaw),
    migrateSha: sha256(migrateRaw),
    schemaExec,
    migrateExec,
    normalised: schemaNorm.normalised && migrateNorm.normalised,
    manifest: sha256(`thriv3-migration-code v2\nschema.sql ${schemaExec}\nmigrate.js ${migrateExec}\n`),
  };
}

/**
 * The commit the code came from, and whether the migration files differ from it. Best effort.
 *
 * RENDER_GIT_COMMIT wins when set: it is what Render built. Otherwise git — but only when the
 * repository git finds IS this checkout (a code tree copied without .git inside some other repository
 * would otherwise report that repository's HEAD).
 */
export function codeCommit() {
  if (process.env.RENDER_GIT_COMMIT) return { commit: process.env.RENDER_GIT_COMMIT, dirty: null };
  try {
    const git = (args, stdio = ['ignore', 'pipe', 'ignore']) => execFileSync('git', args, { cwd: CHECKOUT, stdio }).toString().trim();
    const top = git(['rev-parse', '--show-toplevel']);
    if (fs.realpathSync(top) !== fs.realpathSync(CHECKOUT)) return { commit: null, dirty: null };
    const commit = git(['rev-parse', 'HEAD']);
    let dirty = null;
    try {
      execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'server/db/schema.sql', 'server/db/migrate.js', 'server/db/migrations.js'], { cwd: CHECKOUT, stdio: 'ignore' });
      dirty = false;
    } catch { dirty = true; }
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
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

/** A record a later run may rely on. Rows written before DI-09A have no status: they were complete. */
const complete = (r) => (r.status ?? 'COMPLETE') === 'COMPLETE';

/**
 * Where this database stands against this code, without writing anything:
 *
 *   CURRENT     the latest COMPLETE authorised run recorded this code and the schema is what it left
 *   UNRECORDED  nothing is pending — the rehearsal changes nothing — but no authorised run has
 *               recorded this code version as the latest (a database from before DI-08, a code
 *               edit that changed no schema, or a schema edited out of band since)
 *   PENDING     the rehearsal changes the schema: migrations are waiting
 *   EMPTY       no schema at all: a new database, which an authorised run initialises
 *
 * Two flags qualify it (DI-09A):
 *
 *   drifted      a COMPLETE run is recorded, and the schema is no longer what that run left —
 *                something changed it out of band since (manual DDL, another branch's code, a
 *                pre-DI-08 process). The server will not start on a drifted database.
 *   interrupted  the newest record is APPLYING or FAILED: an authorised run did not finish. The
 *                schema may be at a committed intermediate state; the server will not start.
 */
export function schemaState(db) {
  const code = codeManifest();
  const { fingerprint, objects } = schemaFingerprint(db);
  const records = migrationRecords(db);
  const done = records.filter(complete);
  const latest = done[0] ?? null;
  const interrupted = !!records[0] && !complete(records[0]);
  const drifted = !!latest && latest.schema_after !== fingerprint;
  const base = {
    fingerprint, objects, code, latest, interrupted, drifted, newest: records[0] ?? null,
    knownCode: done.some((r) => r.code_manifest === code.manifest),
  };
  if (latest && !interrupted && latest.code_manifest === code.manifest && latest.schema_after === fingerprint) {
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
 *
 * DI-09A: "nothing since" is now checked, not assumed. A rollback leaves the schema exactly where the
 * latest COMPLETE run put it; out-of-band DDL does not. And an interrupted run never starts.
 */
export function serverMayStart(state) {
  if (state.interrupted) return false;
  return state.state === 'CURRENT' || (state.state === 'UNRECORDED' && state.knownCode && !state.drifted);
}

/**
 * THE PLAN AN APPROVAL NAMES — DI-09A.
 *
 * DI-08 approved the database's current schema fingerprint. That binds the approval to the database's
 * state but not to the CODE: an operator who rehearsed release A on a copy, and then deployed release B
 * (another PR merged in between), approved B's migration without ever seeing it. The plan id binds all
 * four: what is done (kind), to which state (schema before), by which code (manifest), with what
 * predicted result (schema after). Anything else is a different plan and needs its own approval.
 */
export function planFor(state, kind) {
  return sha256(JSON.stringify(['thriv3-migration-plan v1', kind, state.fingerprint, state.code.manifest, state.expectedAfter ?? null]));
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
  if (state.interrupted) lines.push(`  INTERRUPTED         run #${state.newest.id} is ${state.newest.status}: an authorised migration did not finish — see its row and backup ${state.newest.backup_path ?? '(none)'}`);
  if (state.drifted) lines.push(`  DRIFTED             the schema is not what run #${state.latest.id} left (${state.latest.schema_after.slice(0, 16)}…): it was changed out of band since`);
  if (state.error) lines.push(`  rehearsal           ${state.error}`);
  if (state.changes?.length) {
    lines.push(`  pending changes     ${state.changes.length}`);
    for (const c of state.changes.slice(0, 40)) lines.push(`      ${c}`);
    if (state.changes.length > 40) lines.push(`      … ${state.changes.length - 40} more`);
  }
  if (state.state !== 'CURRENT' && !state.error) {
    lines.push(`  plan to approve     MIGRATE ${planFor(state, 'MIGRATE')}`);
    if (state.state === 'UNRECORDED') lines.push(`                      ADOPT   ${planFor(state, 'ADOPT')}   (record only; verified first)`);
  }
  return lines.join('\n');
}

/** The refusal every non-migrating opener gives. Names the command. */
export function refusal(dbPath, state, { server = false } = {}) {
  const why = {
    PENDING: 'its schema is behind this code — migrations are pending',
    EMPTY: 'it has no schema — it has never been initialised',
    UNRECORDED: state.drifted
      ? 'its schema was changed out of band since the last authorised migration recorded it'
      : 'no authorised migration has recorded this code version against it (nothing schema-level is pending, but data steps in migrate() may be)',
  }[state.state] ?? state.state;
  const why2 = state.interrupted ? `an authorised migration (run #${state.newest.id}) did not finish; ${why}` : why;
  return new SchemaNotCurrentError(
    `Refusing to ${server ? 'start the server on' : 'use'} ${dbPath}: ${why2}.\n`
    + `${describeState(state)}\n\n`
    + '  Opening the database never migrates it (DI-08). Migrate it explicitly — rehearse on a copy first:\n\n'
    + `      ${MIGRATE_CMD(dbPath)}                  # shows the plan and the plan id to approve\n`
    + `      ${MIGRATE_CMD(dbPath)} --approve ${planFor(state, 'MIGRATE')}\n`
    + (state.state === 'UNRECORDED' ? `      ${MIGRATE_CMD(dbPath)} --adopt --approve ${planFor(state, 'ADOPT')}   # record only, after verification\n` : '')
    + (server ? '  In production the start command runs `npm run db:deploy` first, which applies a plan only if\n'
      + '  server/db/MIGRATION_APPROVALS.json names it.\n' : '')
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
/** The fingerprint of a database with no schema at all. `--create` accepts it as well as the plan id: there is no data to protect. */
export const EMPTY_FINGERPRINT = sha256('');
function approves(approval, plan) {
  const a = String(approval ?? '').trim().toLowerCase();
  return a.length >= APPROVAL_MIN && /^[0-9a-f]+$/.test(a) && plan.startsWith(a);
}

export function rollbackInstructions(dbPath, backup) {
  if (!backup) return 'ROLLBACK: there was no database before this run (it was created), so rollback is deleting the file.';
  const q = (s) => `'${s.replace(/'/g, "'\\''")}'`;
  return [
    'ROLLBACK — only if this migration must be undone:',
    `  1. Stop every process using the database (server, scripts). Check: lsof ${q(dbPath)}`,
    // The backup is read-only (0444) and `cp` copies that mode: without the chmod the restored database
    // refuses every write ("attempt to write a readonly database") — DI-09A.
    `  2. cp ${q(backup.path)} ${q(`${dbPath}.restore-tmp`)} && chmod 0644 ${q(`${dbPath}.restore-tmp`)} && mv ${q(`${dbPath}.restore-tmp`)} ${q(dbPath)}`,
    `  3. rm -f ${q(`${dbPath}-wal`)} ${q(`${dbPath}-shm`)}        (with nothing running)`,
    `  4. shasum -a 256 ${q(dbPath)}   → must print ${backup.sha256}`,
    '  The backup is a byte-exact copy of the database as it was immediately before this run.',
  ].join('\n');
}

/**
 * The audit table. DI-09A adds `status`, `plan` and `verification`:
 *
 *   status        APPLYING is written INSIDE the migration transaction, so the schema change and the
 *                 record of it commit together; COMPLETE once every step and the verification pass;
 *                 FAILED when a step after the commit, or the verification, fails. A crash between
 *                 the commit and the end therefore leaves an APPLYING row — never an unrecorded change
 *   plan          the plan id that was approved (planFor)
 *   verification  JSON: what was checked — the structural comparison with the code's schema, and for
 *                 ADOPT the dry run's row count
 */
const RECORD_DDL = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('MIGRATE', 'ADOPT', 'CREATE')),
  status TEXT NOT NULL DEFAULT 'COMPLETE' CHECK (status IN ('APPLYING', 'COMPLETE', 'FAILED')),
  plan TEXT,
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
  foreign_key_violations_after INTEGER NOT NULL,
  verification TEXT,
  error TEXT
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

/** Free bytes on the filesystem holding `dir`, or null where statfs is unavailable. */
function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; }
}

/**
 * A byte-exact copy, verified. Taken while THIS connection holds the exclusive lock and after a
 * TRUNCATE checkpoint has folded the WAL into the main file — so, unlike the 13J `cp`, the main
 * file is the whole database and nothing can write it mid-copy. Byte-exact rather than VACUUM INTO
 * (lib/dbSnapshot.js) or the backup API (scripts/backup.js) because a rollback must bring back the
 * very sha256 every DI baseline records; those two produce an equivalent database with different
 * bytes. Then opened and checked like theirs: integrity_check, and the same witness counts.
 *
 * DI-09A: refuses BEFORE copying when the destination's filesystem cannot hold the copy plus the
 * room the migration itself needs (a 5 GB Render disk holds the database, its uploads and reports,
 * and every earlier backup left beside it); a copy that fails part-way is removed rather than left
 * to fill the disk.
 */
function backupExact(db, dbPath, dest) {
  const ck = db.pragma('wal_checkpoint(TRUNCATE)')[0];
  if (ck && ck.busy) throw new MigrationRefused(`Refusing to migrate ${dbPath}: the WAL could not be checkpointed (busy).`);
  const wal = `${dbPath}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) throw new MigrationRefused(`Refusing to migrate ${dbPath}: its WAL still holds frames after a checkpoint.`);
  if (fs.existsSync(dest)) throw new MigrationRefused(`Refusing to overwrite an existing backup at ${dest}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const size = fs.statSync(dbPath).size;
  const need = Math.ceil(size * 1.25) + 64 * 1024 * 1024; // the copy, plus headroom for the WAL the migration writes
  const free = freeBytes(path.dirname(dest));
  if (free !== null && free < need) {
    throw new MigrationRefused(`Refusing to migrate ${dbPath}: ${path.dirname(dest)} has ${free} bytes free; the backup and the migration need about ${need}. `
      + 'Free space (move older PRE_MIGRATION backups off the volume) or pass --backup <path> on another filesystem.');
  }
  const sourceSha = sha256File(dbPath);
  try {
    fs.copyFileSync(dbPath, dest, fs.constants.COPYFILE_EXCL);
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw new MigrationRefused(`Refusing to migrate ${dbPath}: the backup copy to ${dest} failed (${e.code ?? e.message}); the partial copy was removed.`);
  }
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

/** The schema this code builds on an empty database: the reference adoption is compared with. */
function referenceSchema() {
  const ref = new Database(':memory:');
  ref.pragma('foreign_keys = ON');
  applyMigrations(ref);
  return ref;
}

/** Structural differences between `db` and what this code builds. */
export function conformance(db) {
  const ref = referenceSchema();
  try { return structuralDifferences(ref, db, MIGRATIONS_TABLE); } finally { ref.close(); }
}

const DRY_RUN = Symbol('dry-run rollback');

/**
 * ADOPTION PROVES WHAT IT RECORDS — DI-09A.
 *
 * DI-08's `--adopt` recorded any database the rehearsal found nothing pending for. A rehearsal has no
 * rows and only sees what the migration's guards look for, so adoption could certify (a) a database
 * whose pending DATA backfill would never then run, and (b) a schema that differs from the code's in
 * ways the migration does not check. Adoption now verifies both before it records anything:
 *
 *   1. DRY RUN on the real database, under the exclusive lock: schema.sql and every migration step in
 *      ONE transaction that is always rolled back. Any row it would write, or any schema change, means
 *      the database is not merely unrecorded: refuse, and say to MIGRATE instead.
 *   2. STRUCTURE: compare with the schema this code builds on an empty database (schemaConformance.js).
 *      Any extra, missing or different object is refused — unless the operator accepts THAT EXACT set
 *      of differences by its digest (`--accept-drift <digest>`), and then the differences are written
 *      into the audit row, so the record says what was adopted rather than implying a clean schema.
 */
function verifyAdoption(db, file, state, acceptDrift) {
  let dryRows = null; let dryFingerprint = null;
  db.pragma('foreign_keys = ON'); // as a real migration runs
  const c0 = db.prepare('SELECT total_changes() n').get().n;
  try {
    db.transaction(() => {
      db.exec(readSchemaSql());
      migrateInTransaction(db);
      migrateOutsideTransaction(db); // with nothing pending its rebuild is skipped; it throws inside a transaction otherwise
      dryRows = db.prepare('SELECT total_changes() n').get().n - c0;
      dryFingerprint = schemaFingerprint(db).fingerprint;
      throw DRY_RUN;
    }).immediate();
  } catch (e) {
    if (e !== DRY_RUN) {
      throw new MigrationRefused(`Refusing to adopt ${file}: the dry run of this code's migration failed (${e.message}). Run without --adopt after rehearsing on a copy.`, { state });
    }
  }
  if (schemaFingerprint(db).fingerprint !== state.fingerprint) throw new Error('verifyAdoption: the dry run did not roll back');
  if (dryRows !== 0 || dryFingerprint !== state.fingerprint) {
    throw new MigrationRefused(`Refusing to adopt ${file}: this code's migration is not a no-op on it — the dry run would write ${dryRows} row(s)`
      + `${dryFingerprint !== state.fingerprint ? ' and change the schema' : ''} (a data step is pending). Run the migration instead of adopting:\n`
      + `      npm run db:migrate -- --db ${file} --approve ${planFor(state, 'MIGRATE')}`, { state });
  }
  const structure = conformance(db);
  if (structure.differences.length && !approves(acceptDrift, structure.digest)) {
    throw new MigrationRefused(`Refusing to adopt ${file}: its schema differs from the schema this code builds, in ${structure.differences.length} way(s)`
      + ' the migration does not repair:\n'
      + structure.differences.slice(0, 60).map((l) => `      ${l}`).join('\n')
      + (structure.differences.length > 60 ? `\n      … ${structure.differences.length - 60} more` : '')
      + `\n\n  Adopting would record this database as CURRENT and hide these. Repair them, or accept exactly these differences:\n`
      + `      --accept-drift ${structure.digest}\n  (they are then written into the audit row).`, { state, structure, approvalRequired: true });
  }
  return { dryRunRowChanges: dryRows, dryRunSchemaUnchanged: true, structure, acceptedDrift: structure.differences.length ? structure.digest : null };
}

/**
 * THE AUTHORISED MIGRATION. Synchronous.
 *
 *   dbPath      an explicit file — never ':memory:', never implied
 *   approve     the PLAN ID (or a ≥16-hex prefix of it) printed by a plan run: planFor(state, kind),
 *               which binds the kind, the database's current schema, this code and the predicted
 *               result (DI-09A). `--create` also accepts EMPTY_FINGERPRINT
 *   adopt       record this code version against a database that needs nothing — verified first by a
 *               rolled-back dry run and a structural comparison (verifyAdoption)
 *   acceptDrift with adopt: the digest of the structural differences the operator accepts
 *   create      initialise a file that does not exist yet
 *   backupPath  where the byte-exact pre-migration copy goes (default beside the database)
 *   operator    who; defaults to the OS user
 *
 * Without a matching approval it changes nothing and throws MigrationRefused carrying the plan.
 * Returns { applied, kind, before, after, backup, record, changes, rowsWritten }.
 */
export function migrateDatabase({
  dbPath, approve, adopt = false, create = false, acceptDrift, backupPath, operator, now = () => new Date(), log = () => {},
} = {}) {
  if (!dbPath || String(dbPath).trim() === ':memory:') throw new MigrationRefused('An authorised migration needs an explicit database file (--db <path>).');
  const file = path.resolve(String(dbPath).trim());
  const exists = fs.existsSync(file);
  if (!exists && !create) throw new MigrationRefused(`No database at ${file}. Pass --create to initialise a new one.`);
  if (exists && create) throw new MigrationRefused(`--create was given, but ${file} already exists.`);
  if (adopt && create) throw new MigrationRefused('--adopt records an existing database; it cannot create one.');
  if (create) {
    const empty = new Database(':memory:');
    let state;
    try { state = schemaState(empty); } finally { empty.close(); }
    if (!approves(approve, planFor(state, 'CREATE')) && !approves(approve, EMPTY_FINGERPRINT)) {
      // Refused before the file is opened, so an unapproved --create leaves nothing behind.
      throw new MigrationRefused(`Not approved: ${file} would be created and initialised:\n${describeState(state)}\n\n`
        + `  To create it, pass --create --approve ${planFor(state, 'CREATE')}`, { state, approvalRequired: true });
    }
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
    const kind = create ? 'CREATE' : adopt ? 'ADOPT' : 'MIGRATE';
    const plan = planFor(state, kind);
    if (!create && !approves(approve, plan)) {
      throw new MigrationRefused(
        `${approve ? 'The approval does not match this plan' : 'Not approved'}: ${file} would be ${adopt ? 'adopted' : 'migrated'} from this state:\n`
        + `${describeState(state)}\n\n`
        + '  An approval names a PLAN — kind, current schema, this code and the predicted result — not just the database.\n'
        + `  To apply, rehearse on a copy, then pass --approve ${plan}`,
        { state, approvalRequired: true, plan },
      );
    }

    const verification = adopt ? verifyAdoption(db, file, state, acceptDrift) : null;

    const startedAt = now().toISOString();
    const backup = exists ? backupExact(db, file, backupPath ? path.resolve(backupPath) : defaultBackupPath(file, now())) : null;
    if (backup) log(`Backup ${backup.path}\n  sha256 ${backup.sha256}  integrity_check ${backup.integrity}`);

    const { commit, dirty } = codeCommit();
    const record = {
      kind,
      status: 'APPLYING',
      plan,
      started_at: startedAt,
      finished_at: '',
      operator: operator || process.env.THRIV3_OPERATOR || os.userInfo().username,
      approval: String(approve).trim().toLowerCase(),
      code_commit: commit,
      code_dirty: dirty === null ? null : Number(dirty),
      code_manifest: state.code.manifest,
      schema_sql_sha256: state.code.schemaSha,
      migrate_js_sha256: state.code.migrateSha,
      schema_before: state.fingerprint,
      schema_after: '',
      changes: JSON.stringify(state.changes),
      rows_written: 0,
      backup_path: backup?.path ?? null,
      backup_sha256: backup?.sha256 ?? null,
      integrity_check: '',
      foreign_key_violations_before: 0,
      foreign_key_violations_after: 0,
      verification: verification ? JSON.stringify(verification) : null,
      error: null,
    };
    const insert = () => {
      db.exec(RECORD_DDL);
      const cols = Object.keys(record).filter((k) => k !== 'id');
      record.id = Number(db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(record).lastInsertRowid);
    };
    const finish = (fields) => {
      Object.assign(record, fields);
      const cols = Object.keys(fields);
      db.prepare(`UPDATE ${MIGRATIONS_TABLE} SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...fields, id: record.id });
    };

    const fkBefore = db.pragma('foreign_key_check');
    record.foreign_key_violations_before = fkBefore.length;
    let rowsWritten = 0;
    if (!adopt) {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      const c0 = db.prepare('SELECT total_changes() n').get().n;
      try {
        // The APPLYING row commits WITH the schema change (DI-09A), so no crash can leave one without the other.
        db.transaction(() => {
          db.exec(readSchemaSql());
          migrateInTransaction(db);
          insert();
        }).immediate();
      } catch (e) {
        writeFailureReport(backup, { phase: 'TRANSACTIONAL', error: e.message, plan, file });
        throw new MigrationRefused(
          `MIGRATION FAILED (TRANSACTIONAL): ${e.message}\n`
          + '  The transaction rolled back: the database is unchanged.\n'
          + rollbackInstructions(file, backup),
          { cause: e, backup, partial: false, failed: true },
        );
      }
      try {
        migrateOutsideTransaction(db);
      } catch (e) {
        finish({ status: 'FAILED', finished_at: now().toISOString(), error: `OUTSIDE_TRANSACTION: ${e.message}`, schema_after: schemaFingerprint(db).fingerprint });
        writeFailureReport(backup, { phase: 'OUTSIDE_TRANSACTION', error: e.message, plan, file });
        throw new MigrationRefused(
          `MIGRATION FAILED (OUTSIDE_TRANSACTION): ${e.message}\n`
          + '  schema.sql and the transactional steps COMMITTED (recorded as FAILED run #' + record.id + '); the outside-transaction step rolled itself back.\n'
          + '  The database is at a coherent intermediate schema. Restore the backup, or fix and re-run.\n'
          + rollbackInstructions(file, backup),
          { cause: e, backup, partial: true, failed: true },
        );
      }
      // Minus the audit row itself.
      rowsWritten = db.prepare('SELECT total_changes() n').get().n - c0 - 1;
    } else {
      db.transaction(insert).immediate();
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
    const structure = verification?.structure ?? conformance(db);
    const verified = { ...(verification ?? {}), structure };
    const common = {
      finished_at: now().toISOString(), schema_after: after, rows_written: rowsWritten, integrity_check: integrity,
      foreign_key_violations_after: fkAfter.length, verification: JSON.stringify(verified),
    };
    if (problems.length) {
      finish({ ...common, status: 'FAILED', error: `VERIFICATION: ${problems.join('; ')}` });
      writeFailureReport(backup, { phase: 'VERIFICATION', error: problems.join('; '), plan, file });
      throw new MigrationRefused(`MIGRATION VERIFICATION FAILED after commit (recorded as FAILED run #${record.id}): ${problems.join('; ')}.\n${rollbackInstructions(file, backup)}`, { backup, failed: true });
    }
    db.transaction(() => finish({ ...common, status: 'COMPLETE' })).immediate();
    log(`${kind} recorded as ${MIGRATIONS_TABLE} #${record.id}: ${state.fingerprint.slice(0, 16)}… → ${after.slice(0, 16)}…`
      + ` (${state.changes.length} schema change(s), ${rowsWritten} row(s) written)`);
    if (structure.differences.length) {
      log(`NOTE: the schema differs from what this code builds on an empty database in ${structure.differences.length} way(s) (digest ${structure.digest.slice(0, 16)}…);`
        + ' recorded in the audit row\'s `verification`.');
    }
    log(rollbackInstructions(file, backup));
    return { applied: true, kind, before: state.fingerprint, after, backup, record, changes: state.changes, rowsWritten, state, verification: verified };
  } finally {
    if (!closed) { try { db.close(); } catch { /* closed */ } }
  }
}

/** A failed run that rolled back leaves no row (the database is unchanged); it leaves this beside its backup. */
function writeFailureReport(backup, report) {
  if (!backup) return;
  try {
    fs.writeFileSync(`${backup.path}.FAILED.json`, `${JSON.stringify({ ...report, at: new Date().toISOString(), backup: backup.path, backup_sha256: backup.sha256 }, null, 2)}\n`, { flag: 'wx' });
  } catch { /* best effort: the error is thrown to the operator regardless */ }
}

/* ------------------------------------------------------------------- the deploy gate */

/** Where production approvals live: in the repository, reviewed like code, deployed with it. */
export const APPROVALS_FILE = path.join(HERE, 'MIGRATION_APPROVALS.json');

/**
 * Read the committed approvals. Every entry must name a full 64-hex plan id; anything else refuses the
 * whole file rather than being skipped (a malformed approval file is not "no approvals").
 */
export function readApprovals(file = APPROVALS_FILE) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(data?.approvals) ? data.approvals : null;
  if (!list) throw new MigrationRefused(`${file}: expected { "approvals": [ … ] }`);
  for (const [i, a] of list.entries()) {
    if (!a || !/^[0-9a-f]{64}$/.test(String(a.plan ?? ''))) throw new MigrationRefused(`${file}: approvals[${i}].plan must be a full 64-hex plan id`);
    if (!a.approved_by || !a.approved_at) throw new MigrationRefused(`${file}: approvals[${i}] needs approved_by and approved_at`);
  }
  return list;
}

/**
 * THE PRODUCTION PATH — DI-09A. Run by the start command BEFORE the server, as its own process:
 *
 *     node server/scripts/migrateDb.js --deploy && node server/index.js
 *
 *   - the database the server may start on as it is: exit 0 without taking any lock or writing;
 *   - otherwise, a MIGRATE plan named in MIGRATION_APPROVALS.json: the full authorised migration;
 *   - otherwise: refuse, printing the plan id to approve. The server is never started.
 *
 * It never adopts and never creates: those are operator decisions taken by hand, not by a boot.
 */
export function deployGate({ dbPath, approvalsFile = APPROVALS_FILE, log = () => {}, now } = {}) {
  if (!dbPath || String(dbPath).trim() === ':memory:') throw new MigrationRefused('db:deploy needs RECRUITMATCH_DB (or --db) to name the database file.');
  const file = path.resolve(String(dbPath).trim());
  if (!fs.existsSync(file)) throw new MigrationRefused(`db:deploy: no database at ${file}. It never creates one; initialise it by hand (npm run db:migrate -- --db ${file} --create).`);
  const ro = new Database(file, { readonly: true, fileMustExist: true });
  let state;
  try { state = schemaState(ro); } finally { ro.close(); }
  if (serverMayStart(state)) {
    log(`db:deploy: ${file} is ${state.state}${state.state === 'UNRECORDED' ? ' (a recorded code rollback)' : ''}; nothing to migrate.`);
    return { migrated: false, state };
  }
  const plan = state.error ? null : planFor(state, 'MIGRATE');
  const approval = plan && readApprovals(approvalsFile).find((a) => a.plan === plan);
  if (!approval) {
    throw new MigrationRefused(`db:deploy: refusing to start — ${file} needs an authorised migration and no committed approval names this plan.\n`
      + `${describeState(state)}\n\n`
      + (plan ? `  Rehearse on a downloaded backup with this release, then add to ${path.relative(CHECKOUT, approvalsFile)}:\n`
        + `      { "plan": "${plan}", "approved_by": "<who>", "approved_at": "<when>", "note": "<release>" }\n` : '')
      + '  See docs/DATABASE_MIGRATIONS.md.', { state, plan, approvalRequired: true });
  }
  log(`db:deploy: applying plan ${plan} (approved by ${approval.approved_by} at ${approval.approved_at}).`);
  const r = migrateDatabase({ dbPath: file, approve: plan, operator: `deploy (${approval.approved_by})`, log, ...(now ? { now } : {}) });
  return { migrated: r.applied, state, result: r };
}
