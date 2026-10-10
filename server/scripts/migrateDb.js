#!/usr/bin/env node
/**
 * THE ONLY WAY A DATABASE FILE IS MIGRATED — DI-08. See docs/DATABASE_MIGRATIONS.md.
 *
 *   npm run db:status  -- --db <path>                          where it stands; read-only
 *   npm run db:migrate -- --db <path>                          the plan and the fingerprint to approve; changes nothing
 *   npm run db:migrate -- --db <path>                          the plan and the PLAN ID to approve; changes nothing
 *   npm run db:migrate -- --db <path> --approve <plan>         apply: lock, back up, migrate, verify, record
 *   npm run db:migrate -- --db <path> --adopt --approve <plan> [--accept-drift <digest>]
 *                                                              record a database that needs nothing, after a
 *                                                              rolled-back dry run and a structural comparison
 *   npm run db:migrate -- --db <path> --create --approve <plan>  initialise a new file
 *   npm run db:deploy                                          THE PRODUCTION START STEP (DI-09A): database from
 *                                                              RECRUITMATCH_DB; migrates only a plan named in
 *                                                              server/db/MIGRATION_APPROVALS.json; exit 0 = start
 *
 *   --backup <file>    where the byte-exact pre-migration copy goes (default: beside the database)
 *   --operator <name>  recorded in schema_migrations (default: THRIV3_OPERATOR, else the OS user)
 *   --approvals <file> with --deploy: the approvals file (default server/db/MIGRATION_APPROVALS.json)
 *
 * There is NO default database: `--db` is always explicit, so this cannot reach the working
 * database (or /data) by omission. It does not import db/client.js — it opens the file itself.
 *
 * Exit codes: 0 done or nothing to do, 2 not applied (approval needed / refused), 1 failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { schemaState, describeState, migrateDatabase, deployGate, MigrationRefused } from '../db/migrations.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? null;
};

// --deploy alone may take the database from RECRUITMATCH_DB: it is the start command's step, and the
// service's environment is where the deployed database is named. Nothing else ever does.
const dbArg = value('db') ?? (flag('deploy') ? (process.env.RECRUITMATCH_DB ?? '').trim() || null : null);
if (!dbArg || dbArg.startsWith('--') || dbArg === ':memory:') {
  console.error('db:migrate needs an explicit database: --db <path>. There is no default, on purpose.');
  process.exit(2);
}
const dbPath = path.resolve(dbArg);

function status() {
  if (!fs.existsSync(dbPath)) {
    console.log(`${dbPath}: no such file. Initialise with --create --approve <fingerprint of an empty database>.`);
    return 2;
  }
  // A read-only open of a WAL database leaves an empty -wal/-shm beside it; remove the ones this created.
  const sidecars = ['-wal', '-shm'].map((x) => `${dbPath}${x}`).filter((f) => !fs.existsSync(f));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const state = schemaState(db);
    console.log(`${dbPath}\n${describeState(state)}`);
    if (state.state === 'CURRENT') return 0;
    console.log(`\n  To apply: rehearse on a copy, then pass the plan id above:\n      npm run db:migrate -- --db ${dbPath} ${state.state === 'UNRECORDED' ? '[--adopt] ' : ''}--approve <plan>`);
    return flag('status') ? 0 : 2;
  } finally {
    db.close();
    if (!fs.existsSync(`${dbPath}-wal`) || fs.statSync(`${dbPath}-wal`).size === 0) for (const f of sidecars) fs.rmSync(f, { force: true });
  }
}

function deploy() {
  try {
    deployGate({ dbPath, approvalsFile: value('approvals') ? path.resolve(value('approvals')) : undefined, log: (line) => console.log(line) });
    return 0;
  } catch (e) {
    console.error(e instanceof MigrationRefused ? e.message : (e.stack || e.message));
    return e instanceof MigrationRefused && !e.failed ? 2 : 1;
  }
}

function main() {
  if (flag('deploy')) return deploy();
  const approve = value('approve');
  if (flag('status') || (!approve && !flag('create'))) return status();
  try {
    const r = migrateDatabase({
      dbPath,
      approve,
      adopt: flag('adopt'),
      acceptDrift: value('accept-drift'),
      create: flag('create'),
      backupPath: value('backup'),
      operator: value('operator'),
      log: (line) => console.log(line),
    });
    return r.applied || r.state?.state === 'CURRENT' ? 0 : 2;
  } catch (e) {
    if (e instanceof MigrationRefused) {
      console.error(e.message);
      return e.failed ? 1 : 2;
    }
    console.error(e.stack || e.message);
    return 1;
  }
}

process.exitCode = main();
