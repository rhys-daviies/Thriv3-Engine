# Database migrations — explicit, authorised, audited (DI-08)

## The rule

**Opening a database never migrates it.** Importing `server/db/client.js`, directly or through any
route, entity or library, does not run `schema.sql` or `migrate()` against a database file. A file
database is migrated only by `npm run db:migrate` with an approval, or by a server start carrying an
explicit approval (production, below).

Why: on 2026-10-10 a measurement script imported `server/lib/recipientSelection.js`, which imports
`db/client.js`. The client migrated the live dev database on import, adding Phase 2/3's table and
four columns with nobody's say-so (`integrity_artifacts/data_governance/DI-08/P1/HOLDS.md`,
INCIDENT). The only guard then caught `node -e`; script files bypassed it, as they had in D2 and D3.1.

## What each kind of process does

| Process | Database | Behaviour |
|---|---|---|
| Tests (vitest) | `:memory:` | schema + migrate on import, as before. The database is fresh and private to the process, so there is nothing to approve. |
| `RECRUITMATCH_DB_READONLY=1` | a copy | Unchanged: opened read-only and `query_only`, with no schema work. The copy must already be on the code's schema. |
| Any script or library import | a file | Opened read-write, with no DDL and no journal-mode switch. Then **checked**: refuses if migrations are pending or the file has no schema. A missing file is refused, not created. Scripts may still write **rows** (integrity:promote, the apply* tools), but not schema. |
| `node server/index.js` | a file | The same check, but stricter: it refuses unless an authorised run has recorded **this code version** against the database. It never migrates implicitly. |
| `npm run db:migrate` | `--db <file>` | The only migrating operation. |

## How "pending" is decided, without writing

1. **Rehearsal (the authority).** Every `CREATE` in the database's `sqlite_master` is replayed into
   a private `:memory:` database, with no rows. The code's full migration then runs against that
   copy. If the copy's schema changes, migrations are pending, and the diff (`+ table representatives`,
   `~ table players`, …) is exactly what the real run will do. This takes milliseconds even on the
   400 MB dev corpus.
2. **Fast path and audit key.** The code manifest is sha256 of `schema.sql` and `migrate.js`. Every
   authorised run records it in `schema_migrations`, together with the schema fingerprint it left
   behind. If both still match, the database is `CURRENT` and no rehearsal is needed.

States: `CURRENT`, `UNRECORDED` (nothing pending, but this code version is not the latest
recorded), `PENDING`, `EMPTY`.

- **Scripts** accept `CURRENT` or `UNRECORDED`.
- **The server** accepts `CURRENT`, or `UNRECORDED` when this code version appears anywhere in the
  database's recorded history. The second case is a code rollback to a version that was migrated
  before.

**The rehearsal cannot see data.** A new backfill that comes with no schema change rehearses as
"nothing pending". That is why the server insists on a recorded code version. It is also why, after
pulling code that changes `migrate.js` or `schema.sql`, the dev server refuses until you run
`db:migrate` once. That run is a recorded, backed-up no-op when nothing has changed.

**Why not per-migration ids?**
- `migrate.js` is about 1,900 lines of idempotent, guarded steps with no ids. Numbering them would
  rewrite the very code whose safety is in question.
- A whole-file hash used *alone* would flag a comment edit as pending forever.
- The rehearsal asks the code itself, so it cannot drift from it. The cost of a whole-file manifest
  is one explicit, cheap `db:migrate` run after any edit to the migration code. That run takes only
  as long as the backup.

## Commands

```bash
npm run db:status  -- --db <file>                               # read-only: state, fingerprint, pending diff
npm run db:migrate -- --db <file>                               # the plan + the fingerprint to approve; changes nothing (exit 2)
npm run db:migrate -- --db <file> --approve <fingerprint>       # apply
npm run db:migrate -- --db <file> --adopt --approve <fp>        # UNRECORDED only: record, run nothing
npm run db:migrate -- --db <file> --create --approve <empty-fp> # initialise a new file
```

Flags:
- `--db` is mandatory. There is no default, so the working database and `/data` are never reached by
  omission.
- `--approve` takes the database's current schema fingerprint, or a prefix of at least 16 hex
  characters. That binds the approval to the exact state you rehearsed. A stale approval, or one for
  a different state, matches nothing.
- `--backup <file>` overrides where the backup goes. The default is
  `<db>.snapshot-PRE_MIGRATION-<stamp>`, beside the database.
- `--operator <name>` sets who is recorded. The default is `THRIV3_OPERATOR`, then the OS user.

An approved run does the following:
1. Takes an **exclusive lock**, and refuses if any other process has the database open.
2. Checks for the DI-03H disposable marker.
3. Takes a **byte-exact backup**:
   - after a `TRUNCATE` checkpoint, under the lock;
   - sha256 verified equal to the database;
   - opened, `integrity_check` run, witness rows counted;
   - made read-only.

   It is byte-exact rather than `VACUUM INTO`, so a rollback restores the very sha256 every DI
   baseline records.
4. Records `foreign_key_check`.
5. Runs `schema.sql` + `migrate()`:
   - **one IMMEDIATE transaction** for `schema.sql` and every step SQLite allows in one;
   - then the Phase 1D recipient rebuild in its own existing guarded transaction.
6. Verifies:
   - `integrity_check` is `ok`;
   - no **new** `foreign_key_check` violations;
   - the schema fingerprint equals the rehearsal's prediction.
7. Writes one `schema_migrations` row with:
   - kind and operator;
   - start and finish times;
   - the approval;
   - code commit and dirty flag;
   - the code manifest and both file hashes;
   - schema fingerprints before and after;
   - the change list and rows written;
   - backup path and sha;
   - integrity and foreign-key counts.
8. Prints rollback instructions.

### What runs outside the main transaction, and why

| Step | Why it can't be in the transaction | Its own protection |
|---|---|---|
| `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON` | SQLite won't change either inside a transaction | Set before it starts |
| `extendOutreachRecipients` (Phase 1D rebuild of 5 recipient tables) | Needs `foreign_keys = OFF`, which SQLite ignores inside a transaction | One guarded transaction: count, digest and `foreign_key_check` verified; rolled back whole on mismatch |

If the main transaction fails, **nothing** changed. If only the 1D step fails, the main transaction
has committed and the database sits at a coherent intermediate schema. The error says which case
you're in; restore the backup, or fix the problem and re-run.

A failed run writes nothing to `schema_migrations`.

## Operator procedure (dev or production)

1. **Preconditions.**
   - Stop the server and every script using the database (`lsof <db>` shows nothing).
   - Check out the code you intend to run, with a clean `git status`.
   - Record the database's sha256.
2. **Plan.** Run `npm run db:migrate -- --db <db>`. Read the pending diff and note the fingerprint.
3. **Rehearse on a copy.**
   - Run `npm run backup -- <dir>`, or `cp` the file while nothing has it open.
   - Run `npm run db:migrate -- --db <copy> --approve <fp>`.
   - Check the result:
     - `db:status` says `CURRENT`;
     - `rows_written` is what you expect;
     - for a careful change, diff per-table content hashes between the copy and the original.
4. **Apply.** Run `npm run db:migrate -- --db <db> --approve <fp> --operator <you>`.
5. **Verify.**
   - `npm run db:status -- --db <db>` says `CURRENT`.
   - Record the new sha256 and fingerprint as the new baseline in the DI artefacts.
6. **Rollback** (only if needed). Follow the printed instructions:
   1. Stop everything.
   2. `cp backup → <db>.restore-tmp && mv` it over the database.
   3. Remove any stale `-wal`/`-shm`.
   4. Check the sha256 equals the backup's.

**Adopting a pre-DI-08 database.** A database that is already fully migrated, such as the dev
database at main `257b58d`, is `UNRECORDED`. Scripts work against it as it is. The server refuses
until you run `npm run db:migrate -- --db <db> --adopt --approve <fp>`, which records it and runs
nothing.

## Production (Render)

`startCommand` is `node server/index.js`. A pre-deploy command can't help here, because Render
doesn't mount the persistent disk for it. So a deploy that carries pending migrations, or that is
the first deploy of this change, **refuses to start** unless the service has:

```
THRIV3_MIGRATION_APPROVAL=<the production database's current schema fingerprint>
```

**How the approval works.**
- Only the server entry point reads it. Every other process ignores it.
- The server then runs the same authorised operation as `db:migrate`, before it opens its own handle:
  - it takes an exclusive lock;
  - it writes the byte-exact backup beside the database, on `/data`;
  - it records `operator = THRIV3_OPERATOR` or `server-startup`.
- An approval that doesn't match refuses the start.
- A stale value left in place is harmless: it can never match a different state.

**Getting the fingerprint without the new code on the host.**
1. Take the usual pre-deploy backup and download `database.sqlite`.
2. Run `npm run db:status -- --db <downloaded copy>` locally with the code being deployed.
3. Rehearse `db:migrate` on that copy.
4. Set the approval value in the Render dashboard.
5. Deploy.
6. Afterwards, remove the variable.

**Render has to stop the old instance before the new one starts** (a service with a disk doesn't
overlap them), so a refused start is downtime until the approval is set or the deploy is rolled back.
**Plan migrations as maintenance windows.**

## Tests

`server/db/explicitMigrations.test.js` covers:
- an import that refuses and writes nothing (the incident's own import);
- an up-to-date database that opens with its sha256 and mtime unchanged;
- server refusal, and the approved server start;
- `db:migrate` refusal, apply, backup, audit row and unchanged rows;
- an injected failing step rolling the transaction back;
- read-only mode;
- `:memory:`;
- adopt;
- a code rollback.

Test helpers that need a file database create it with
`migrateDatabase({ dbPath, create: true, approve: EMPTY_FINGERPRINT })`. They don't rely on an
import to build it.
