# Reconciling canonical product data into production

Production's database was populated **once, by hand**, before most of these
tables existed. `schema.sql` then created them empty on the next boot, so the
deployed application has been reading a `programme_status` with no rows and
treating six deliberately-excluded programmes as eligible destinations.

This is the mechanism that fixes that without destroying the deployed
application's own data.

---

## Why the whole database is never copied up

**The local corpus has zero `operator_users` and zero `operator_sessions`.**
Copying it over `/data/recruitmatch.sqlite` deletes the operator account and
locks the operator out of their own application. It would also discard every
player created through the UI, every generated report, campaign, message,
mailbox connection, send record, send snapshot and suppression — none of which
exist locally — and would push the externally-added `projected_games_*`
columns into production as a side effect.

A backup makes that recoverable. It does not make it correct.

## The ownership boundary

| class | examples | reconciled? |
| --- | --- | --- |
| **CANONICAL_PRODUCT** | `programme_status`, the machine half of `roster_season_trust` | **yes, by this tool** |
| **DERIVED** | `recruiting_arrivals`, `recruiting_arrivals_build` | **never shipped — rebuilt in production** |
| **PRODUCTION_OWNED** | players, campaigns, messages, outreach, sends, mailboxes, reports, suppressions, tracking | **never a target** |
| **AUTH** | `operator_users`, `operator_sessions` | **never a target, under any flag** |

**Auth and operational tables are never canonical-import targets.** Not by
policy — the importer can only write the tables named in `DATASETS`, and a test
asserts that list contains none of them.

### `roster_season_trust` straddles the line

One row holds a machine measurement and a human decision about it. The machine
half is canonical; the human half belongs to whoever made it, on whichever
database they made it on.

The importer writes exactly `season, college_name, sport, diagnosis,
diagnosis_evidence, diagnosed_at` — which is not a judgement call but the
literal column list in `recordSeasonTrust.js`'s INSERT, asserted equal by test
so it cannot drift from the writer. `disposition`, `disposition_evidence`,
`reviewed_at`, `reviewed_by_operator_id`, `next_action`,
`previous_disposition` and `previous_reviewed_at` are never written, and an
artefact carrying one is refused.

### `programme_status` is authoritative in full

It has **no write route at all**, so nothing in production can own a row in it.
Reconciliation is therefore a full replacement: upsert every artefact row and
remove any production row the artefact does not contain, so production ends up
matching the canonical dataset exactly. Removals are listed individually in the
dry run.

### Derived data is rebuilt, never shipped

Shipping `recruiting_arrivals` would ship a freshness digest computed over
**somebody else's source rows** — the precise lie the materialisation stamp
exists to prevent. Production rebuilds from its own reconciled roster instead.

---

## The artefact

`npm run canonical:export -- --out <dir>` writes one JSON file:

```
format     thriv3.canonical-product   version 1
createdAt  <the only non-deterministic field>
source     { manifestVersion: V7, corpusDigest: … }   which corpus it came from
datasets   per dataset: table, mode, key, columns, rows, digest, data
digest     over the datasets and the source identity — never over createdAt
```

Two exports of an unchanged corpus produce the **same digest**, so "has the
canonical data moved" is answerable without reading either file.

## Running it

### 1. Export, locally

```
npm run canonical:export -- --out ~/thriv3-artefacts
```

Record the artefact digest and the file sha256 it prints.

### 2. Back up production — before anything else

```
npm run backup -- /path/off/the/volume
npm run backup -- --verify /path/off/the/volume/thriv3-…
```

A backup on the disk it protects is not a backup. The importer reads this
backup's own `manifest.json` and refuses unless `integrityCheck` is `ok`.

### 3. Stop the service

SQLite in WAL mode with one writer: stop the web service before writing, so the
import is not racing the application.

### 4. Dry run — the default

```
npm run canonical:reconcile -- --artefact <file>
```

Writes nothing. Reports, per dataset: inserted, updated, unchanged, removed
(with each removed identity), resulting row count, and **every human decision
it is preserving, named**. Read this before going further.

### 5. Apply

```
npm run canonical:reconcile -- --artefact <file> --apply \
  --target /data/recruitmatch.sqlite \
  --backup-verified /path/to/backup
```

`--target` must name the database actually being written; both sides are
resolved through `realpath` before comparison, because `/var` is a symlink to
`/private/var` on macOS and a string comparison would pass or fail for the
wrong reason. One transaction across both datasets: all or nothing.

### 6. Rebuild the derived data

```
npm run build:recruiting -- --canonical
```

**`--canonical` is required**, and not a formality: `/data/recruitmatch.sqlite`
is outside the checkout, so the L7ZM guard classifies it as a shared canonical
corpus and refuses to write it unacknowledged. Without the flag this step
fails with `CanonicalWriteRefused` and the reconciliation looks half-finished.

### 7. Verify

- `programme_status` = 6, and the six programmes read inactive for 2026
- the trust queue lists the machine diagnoses, with **no reviewer and no
  disposition** on any row the artefact created
- both sports `FRESH`, `generation` present, input digest matching
- the operator account still exists and sign-in still works
- players, campaigns, messages, reports and sends are unchanged

### 8. Restart the service.

## Rollback

Restore the backup from step 2 — `npm run backup -- --restore <backup> --into
<dir>` — and put it back at `/data/recruitmatch.sqlite`. Derived data can
always be rebuilt afterwards, so nothing about the rebuild needs undoing
separately.

---

## What this first version deliberately does not do

**`roster_gap_reviews` is not imported.** Those seven rows are human decisions
made on the local corpus with no reviewer recorded. They are not required for
matching or Evidence correctness, and importing them would silently promote
unattributed local decisions into production as though someone had made them
there.

**The two local `RETAIN` decisions do not travel.** They are human dispositions,
and human state is not canonical. After reconciliation production holds **15
machine-diagnosed rows with no decision on any of them** — so the production
review queue shows **15 unresolved, not 13**. Two of those are seasons already
decided locally; deciding them again in production is a deliberate act, and
this time it would carry a reviewer. Importing them instead would be a separate,
explicitly approved change.

**No `projected_games_*` columns travel.** They are not in the schema, not in
any dataset, and not touched.
