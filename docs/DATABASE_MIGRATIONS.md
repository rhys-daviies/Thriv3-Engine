# Database migrations — explicit, authorised, audited (DI-08, hardened in DI-09A)

## The rule

**Opening a database never migrates it.** Importing `server/db/client.js`, directly or through any
route, entity or library, does not run `schema.sql` or `migrate()` against a database file. A file
database is migrated only by `npm run db:migrate` with an approval, or — in production — by
`npm run db:deploy`, the start command's separate step before the server, against a plan id committed
in `server/db/MIGRATION_APPROVALS.json` (below). The server process itself never migrates (DI-09A).

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
| `node server/index.js` | a file | The same check, but stricter: it refuses unless an authorised run has recorded **this code version** against the database, the schema has not been changed out of band since the latest recorded run, and no run was left unfinished. It never migrates. `THRIV3_MIGRATION_APPROVAL` is ignored (with a warning) since DI-09A. |
| `npm run db:migrate` | `--db <file>` | The migrating operation. |
| `npm run db:deploy` | `RECRUITMATCH_DB` | Production's start step, run before the server: exit 0 at once (no lock, no write) when the server may start; otherwise migrates only a plan listed in `server/db/MIGRATION_APPROVALS.json`, else exits non-zero so the server never starts. Never creates, never adopts. |

## How "pending" is decided, without writing

1. **Rehearsal (the authority).** Every `CREATE` in the database's `sqlite_master` is replayed into
   a private `:memory:` database, with no rows. The code's full migration then runs against that
   copy. If the copy's schema changes, migrations are pending, and the diff (`+ table representatives`,
   `~ table players`, …) is exactly what the real run will do. This takes milliseconds even on the
   400 MB dev corpus.
2. **Fast path and audit key.** The code manifest (`v2`, DI-09A) is sha256 of `schema.sql` and
   `migrate.js` **after normalisation** (`server/db/codeIdentity.js`): comments and insignificant
   whitespace are removed; string, template and regex literals are kept verbatim. A comment edit is
   not new migration code; any change to a statement, a SQL string or the order of steps is. A lexing
   doubt falls back to the raw bytes (stricter, never looser), and the test suite proves with esbuild
   that normalising the real `migrate.js` removes nothing but comments and whitespace. Every
   authorised run records the manifest in `schema_migrations`, with the schema fingerprint it left
   behind. If both still match, the database is `CURRENT` and no rehearsal is needed.

States: `CURRENT`, `UNRECORDED` (nothing pending, but this code version is not the latest
recorded), `PENDING`, `EMPTY`. Two flags (DI-09A):
- `drifted` — a run is recorded, but the schema is no longer what the latest one left: it was changed
  out of band (manual DDL, another branch's code, a pre-DI-08 process).
- `interrupted` — the newest audit row is `APPLYING` or `FAILED`: a run did not finish.

- **Scripts** accept `CURRENT` or `UNRECORDED`.
- **The server** accepts `CURRENT`, or `UNRECORDED` when this code version appears in the database's
  recorded history **and** the schema is exactly what the latest recorded run left (`!drifted`) —
  a code rollback. Never when `interrupted`.

**The rehearsal cannot see data.** A new backfill that comes with no schema change rehearses as
"nothing pending". That is why the server insists on a recorded code version. It is also why, after
pulling code that changes what `migrate.js` or `schema.sql` *executes*, the dev server refuses until
you run `db:migrate` once. That run is a recorded, backed-up no-op when nothing has changed.

**Why not per-migration ids?**
- `migrate.js` is about 1,900 lines of idempotent, guarded steps with no ids. Numbering them would
  rewrite the very code whose safety is in question.
- A whole-file hash used *alone* would flag a comment edit as pending forever.
- The rehearsal asks the code itself, so it cannot drift from it. The cost of a whole-file manifest
  is one explicit, cheap `db:migrate` run after any edit to the migration code. That run takes only
  as long as the backup.

## Commands

```bash
npm run db:status  -- --db <file>                               # read-only: state, fingerprint, pending diff, plan ids
npm run db:migrate -- --db <file>                               # the plan + the plan id to approve; changes nothing (exit 2)
npm run db:migrate -- --db <file> --approve <plan>              # apply
npm run db:migrate -- --db <file> --adopt --approve <plan>      # UNRECORDED only: verify, then record; runs nothing
        [--accept-drift <digest>]                               #   …accepting exactly the listed structural differences
npm run db:migrate -- --db <file> --create --approve <plan>     # initialise a new file (the empty fingerprint is also accepted)
npm run db:deploy                                               # production start step (RECRUITMATCH_DB; MIGRATION_APPROVALS.json)
```

Flags:
- `--db` is mandatory. There is no default, so the working database and `/data` are never reached by
  omission.
- `--approve` takes the **plan id** that `db:status` / a plan run prints, or a prefix of at least 16
  hex characters. The plan id is sha256 of the kind (`MIGRATE`/`ADOPT`/`CREATE`), the database's
  current schema fingerprint, this code's manifest, and the rehearsal's predicted result. DI-08
  approved the fingerprint alone, which bound the approval to the database but not to the code: a
  plan rehearsed with release A also approved release B's unreviewed migration (DI-09A, F1). A stale
  approval, one for another state, other code, or another kind, matches nothing.
- `--accept-drift <digest>` (with `--adopt`): see *Adopting* below.
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
7. Writes one `schema_migrations` row — **inside the main transaction** as `APPLYING` (DI-09A), so
   the schema change and its record commit together and a crash can never leave an unrecorded
   change; it becomes `COMPLETE` after verification, or `FAILED` (with `error`) if the outside step
   or the verification fails. The row has:
   - kind and operator;
   - start and finish times;
   - the approval;
   - code commit and dirty flag;
   - the code manifest and both file hashes;
   - schema fingerprints before and after;
   - the change list and rows written;
   - backup path and sha;
   - integrity and foreign-key counts;
   - `plan` and `verification` (JSON: the structural comparison with the code's own schema, and for
     ADOPT the dry run).
8. Prints rollback instructions.

Before the backup it checks the destination has room for it plus headroom for the migration's WAL,
and refuses otherwise; a copy that fails part-way is removed (DI-09A).

### What runs outside the main transaction, and why

| Step | Why it can't be in the transaction | Its own protection |
|---|---|---|
| `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON` | SQLite won't change either inside a transaction | Set before it starts |
| `extendOutreachRecipients` (Phase 1D rebuild of 5 recipient tables) | Needs `foreign_keys = OFF`, which SQLite ignores inside a transaction | One guarded transaction: count, digest and `foreign_key_check` verified; rolled back whole on mismatch |

If the main transaction fails, **nothing** changed. If only the 1D step fails, the main transaction
has committed and the database sits at a coherent intermediate schema. The error says which case
you're in; restore the backup, or fix the problem and re-run.

A run that fails inside the main transaction writes nothing to `schema_migrations` (the database is
unchanged); it leaves `<backup>.FAILED.json` beside its backup. A run that fails after the commit
leaves a `FAILED` row, and the server refuses (`interrupted`) until a run completes or the backup is
restored.

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
   2. `cp backup → <db>.restore-tmp && chmod 0644` it `&& mv` it over the database. (The backup is
      0444 and `cp` copies the mode; without the chmod the restored database refuses every write —
      DI-09A F7.)
   3. Remove any stale `-wal`/`-shm`.
   4. Check the sha256 equals the backup's.

**Adopting a pre-DI-08 database.** A database that is already fully migrated is `UNRECORDED`.
Scripts work against it as it is. The server refuses until an authorised run records it. Prefer
**MIGRATE** (`--approve <MIGRATE plan>`): `migrate()` is idempotent, so on a current database it
writes nothing — on the dev database (3c3d1d6d) it wrote 0 rows and changed no schema — and if a data
step *is* pending, it runs it. `--adopt` records without running anything, and since DI-09A it
first proves that is safe:

1. **Dry run.** Under the exclusive lock, `schema.sql` and every migration step run in one transaction
   that is always rolled back. Any row written or schema changed → refused: a data step is pending,
   so MIGRATE instead.
2. **Structure.** The database is compared with the schema this code builds on an empty database
   (`server/db/schemaConformance.js`: column sets with types, NOT NULL, defaults and keys; foreign
   keys with their actions; CHECK clauses; normalised index/trigger/view definitions). Any extra,
   missing or different object → refused, listing the differences and their digest. To adopt anyway,
   pass `--accept-drift <digest>`: exactly that set is accepted and written into the audit row.

The rehearsal alone cannot see either: the dev database at 3c3d1d6d rehearses as `UNRECORDED` but
carries five structural differences from unmerged email-agent branches (two extra `outreach_send`
columns plus `recipient_email`, a NOT NULL/ON DELETE difference on `outbound_send_attempt`, a
different append-only trigger, an extra trigger and an extra index).

## Production (Render)

**The server never migrates; a separate step before it does (DI-09A).** `render.yaml`:

```
startCommand: if [ -f server/scripts/migrateDb.js ]; then node server/scripts/migrateDb.js --deploy || exit 1; fi; exec node server/index.js
```

(The `if` keeps a dashboard rollback to a pre-DI-08 commit bootable; such a commit migrates itself
on boot, as it always did. Any commit with the script runs the gate, and a refusal never starts the
server.)

`db:deploy` reads `RECRUITMATCH_DB` (`/data/recruitmatch.sqlite`):
- If the server may start on the database as it is (`CURRENT`, or a recorded code rollback), it exits
  0 at once — no lock, no write — and the server starts. Most deploys take this path.
- If a migration is pending, it computes the MIGRATE plan id and looks it up in the committed
  `server/db/MIGRATION_APPROVALS.json`. Found: the full authorised migration (exclusive lock — the old
  instance is already stopped — byte-exact backup on `/data`, one transaction, verification, a
  `COMPLETE` row with `operator = deploy (<approved_by>)`), then exit 0. Not found: it prints the
  plan id and exits non-zero, and `&&` never starts the server.
- It never creates and never adopts a database.

Why not DI-08's `THRIV3_MIGRATION_APPROVAL`: the value was the schema fingerprint, so it approved
whatever migration the deployed code carried (F1); it outlived the deploy, and while set it made
every restart take an exclusive lock, so a Render shell holding the database turned a routine
restart into a refused start (F9); and an environment variable leaves no reviewed record. An entry
in `MIGRATION_APPROVALS.json` is reviewed in the release PR, names one plan (this code, this starting
schema, this result), is inert once applied, and is in git history for good.

Why not `preDeployCommand`: Render runs it on a separate instance without the persistent disk
(Render's documented limitation for disk-backed services as of this writing — re-verify), so it
cannot reach `/data`.

**Release procedure for a migrating deploy.**
1. Take the usual pre-deploy backup of `/data` and download `database.sqlite`.
2. On the release commit: `npm run db:status -- --db <downloaded copy>` — read the pending diff and
   the MIGRATE plan id.
3. Rehearse on that copy: `npm run db:migrate -- --db <copy> --approve <plan>`; check `CURRENT`,
   `rows_written`, the `verification` JSON, and the application against the migrated copy.
4. Add `{ "plan": "<plan>", "approved_by": "<you>", "approved_at": "<date>", "note": "<release>" }`
   to `server/db/MIGRATION_APPROVALS.json` **in the release PR**. Any further merge that changes the
   migration code or the production schema changes the plan id, and the deploy refuses — re-run 2–4.
5. Deploy. Watch the log for `db:deploy: applying plan …` and `MIGRATE recorded as … #n`.
6. Verify: `npm run db:status -- --db /data/recruitmatch.sqlite` in the Render shell says `CURRENT`.
7. Move the `PRE_MIGRATION` backup off the 5 GB volume once the release is accepted.

**Render stops the old instance before the new one starts** (a service with a disk does not overlap
them), so the migration runs inside the deploy's downtime; on the 400 MB dev corpus the whole run,
backup included, takes about 5 s. A refused start is downtime until the approval is committed or the
deploy is rolled back, which is why step 2 runs before the deploy, not after.

**Rollback.** Redeploying an earlier release that this database has been migrated by boots through
`db:deploy` without a new approval (`UNRECORDED`, known code, not drifted), provided the newer
migration was additive. A pre-DI-08 release still migrates itself on boot. To undo a migration,
restore the backup (procedure above) with the service stopped.

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
- a code rollback;
- `db:deploy` (startable database, unapproved plan, other-plan approvals, approved plan, malformed file).

`server/db/migrationHardening.test.js` covers the DI-09A findings: adoption's dry run and structural
check, drift after a recorded run, the in-transaction `APPLYING` record and interrupted runs, the
normalised manifest (including an esbuild equivalence proof on the real `migrate.js`), the writable
rollback and the free-space check.

Test helpers that need a file database create it with
`migrateDatabase({ dbPath, create: true, approve: EMPTY_FINGERPRINT })`. They don't rely on an
import to build it.
