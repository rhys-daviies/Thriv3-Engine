# Report delivery — the operator surface

Phase 13J. How a Thriv3 operator turns the frozen report into a file they can
send, and what the system remembers about having done it.

The report itself is frozen on main and nothing here touches it. Read
`report-release.md` first for what the document is; this is the workflow
around it.

## The workflow

`/player/:id/reports` — a tab on the existing player workspace.

```
ATHLETE     Rhys Davies · Defender · entering 2027 · Men's soccer
PROGRAMME   [ search ]  →  Mercyhurst · Men's soccer · NCAA D1 · PA

            [ Generate report ]

GENERATED   Thriv3_Rhys_Davies_Mercyhurst_Mens_Soccer.pdf
            Athlete × programme · 31 pages · 3 Sep 2026, 07:32

            [ Download PDF ]

PREVIOUS REPORTS
  Mercyhurst   Athlete × programme   3 Sep 07:33   Generated  679e5cd82695  [Download]
  Mercyhurst   Athlete × programme   3 Sep 07:32   Generated  679e5cd82695  [Download]
```

It is a tab rather than its own screen because the athlete is already chosen
and displayed above the tabs. A second athlete picker would be a second chance
to send the wrong person's report, and report history is naturally per athlete.

The programme picker is **scoped to the athlete's own sport**, so the pairing
guard never has to fire on something the screen offered. Division, conference
and state are shown because two programmes share a name — Mercyhurst men's and
Mercyhurst women's are different rows.

Generation is one explicit action. Selecting a programme does not generate
anything, and the button is disabled while a generation is in flight.

## Architecture

```
ReportsTab.jsx  →  /api/reports  →  reportDelivery.js
                                        │
                                        ├─ programReportModel()      ┐ the frozen
                                        ├─ renderProgramReport()     │ path, called
                                        └─ reportFilename()          ┘ as-is
                                        │
                                        ├─ server/reports/<id>.pdf   (artefact)
                                        └─ generated_reports         (history row)
```

**Delivery consumes the report; it does not reproduce it.** No composition, no
section list, no wording and no page geometry lives in this subsystem. Both
`npm test` and `npm run verify:baseline` render the same pair through the
existing endpoint's path and through the delivery service and compare the page
count, the extracted text and every content stream.

The two `report.pdf` endpoints are unchanged and remain the direct, unrecorded
path — but **since 13K nothing in the UI reaches them.** The Program Philosophy
tab's "Report this programme" button now navigates here with the programme
preselected, so there is one way an operator produces a client PDF and it is
always recorded. The endpoints stay for regression tests and internal use; an
invariant checks that no client surface calls them.

The difference delivery makes is that it persists an artefact, which is the
difference between "I looked at a report" and "this is the document we sent".

### API

```
GET  /api/reports/athletes?q=            the athletes an operator may generate for
GET  /api/reports/programmes?q=&sport=   the programmes, scoped to a sport
GET  /api/reports/programmes/:id         one programme, same rules as the picker
GET  /api/reports?athleteId=&collegeId=  history, newest first
POST /api/reports {athleteId?, collegeId}  generate one report
GET  /api/reports/:id/download           the artefact, resolved server-side
```

## Storage: immutable artefacts, not regenerate-on-download

Two designs were considered.

**A — store the bytes.** Every generation writes a PDF to disk. History points
at it. Downloading returns exactly what was produced.

**B — store the record and regenerate on download.** No files. A download
re-renders from the current database.

**A was chosen.** 13I proved the renderer is deterministic *given fixed data* —
and the data is not fixed. Rosters are re-imported, minutes are projected
forward, coaches get resolved. Under B, a report a family received in March
would silently become a different document in June while claiming to be the
same file, which is the one thing §15 of the brief said not to do. Storage cost
is the argument for B and it is weak: 73–100 KB a report, so ten thousand
reports is under a gigabyte.

So an artefact is written once and never modified. **Regenerate creates a new
id, a new file and a new row**; nothing is overwritten and nothing is deleted.

### Where the files live

`server/reports/`, gitignored, created on demand — the same shape as the
existing `server/uploads/`. `THRIV3_REPORT_STORE` moves it for a deployment
that mounts a volume elsewhere.

The directory is **never served statically**. `GET /api/reports/:id/download`
is the only way out of it, and it resolves the path server-side.

### The artefact key is not the filename

The display name is canonical, so it repeats: two generations of one pair are
both `Thriv3_Rhys_Davies_Mercyhurst_Mens_Soccer.pdf`. On disk they are
`<generation-id>.pdf` — 24 hex characters from `randomBytes` — so a
regeneration cannot land on its predecessor, and the download route cannot be
steered by a crafted name. The downloaded file still arrives under the
canonical name, from the server's `Content-Disposition`.

## The history record

`generated_reports`, one row per generation, written once. Created by
`schema.sql`; `content_sha256` is added by `migrate.js` because `CREATE TABLE
IF NOT EXISTS` cannot add a column to a table already in the field.

| column | why |
|---|---|
| `id` | the generation, and the artefact key |
| `report_type` | `athlete` or `programme` |
| `athlete_id`, `college_id`, `sport` | what was asked for |
| `athlete_name`, `college_name` | denormalised, so history reads correctly after a rename |
| `filename` | the canonical name, from `reportFilename` |
| `artifact_path` | relative to the store root, never absolute |
| `page_count`, `byte_size` | what was produced |
| `sha256` | the file as stored — integrity |
| `content_sha256` | the ink — the only hash that can identify a duplicate |
| `engine_sha` | which frozen engine produced it |
| `generated_by`, `generated_by_email` | which operator produced it — 13K, internal only |
| `status`, `error` | `generated` or `failed`, and the operator's sentence |
| `generated_at` | when |

Reversible: dropping `content_sha256`, `generated_by` and `generated_by_email`
restores the pre-migration shape, and the whole table can be dropped without touching
anything the report reads.

### Two hashes, because they answer different questions

The concurrency test found this. A hash of the **whole file** cannot detect a
duplicate: every PDF embeds its own creation timestamp and an `/ID` derived
from it, so two simultaneous generations of identical data are two different
files. A hash of the **content streams** can, because 13I proved those are
byte-identical across repeated generation from unchanged data.

So both are stored, and the twelve-character **fingerprint an operator sees is
the content hash** — otherwise the screen would say "different" about two
identical readings. Neither hash is ever shown as a client identifier.

## Atomicity

```
render → write the artefact → insert a `generated` row
```

In that order, so a success row cannot describe a file that is not there. A
failure at any earlier step removes a partial file and records a `failed` row
with the operator-facing reason instead. If the history write itself fails, the
original cause is reported *and* the fact that the attempt could not be
recorded — silence would be worse. A test makes the store unwritable and checks
that exactly one `failed` row lands, with no artefact path and no hash.

## Failure states

Every one of these is a sentence on the screen, never a stack trace. The
technical cause is logged server-side.

| | operator sees |
|---|---|
| athlete or programme missing | "That athlete is not on file." |
| wrong sport | "Rhys Davies plays men's soccer and Mercyhurst is a women's soccer programme." |
| store unwritable / full | "The report store could not be written to." / "There is no space left…" |
| history write failed | the cause, plus "The attempt could not be recorded either." |
| artefact missing from the store | "The report was recorded but its file is missing from the store. Regenerate it." |
| bad report reference | "That report reference is not valid." |

## Access

**Phase 13K put authentication in front of all of this.** Every `/api` route
requires an operator session, including the four delivery routes and the
artefact download; an artefact id is not a capability. See `hosting.md` for the
boundary, the account model and the session design.

What 13J established and 13K kept: the API still binds `127.0.0.1` by default,
so a process reachable from the network remains a decision somebody wrote down
rather than an accident. What changed is that being reachable is now safe,
because the application refuses unauthenticated requests instead of relying on
the bind address to do it.

Delivery gained one column pair from that: `generated_by` and
`generated_by_email` record which operator produced an artefact. It is
attribution, not authorisation — every operator has the same reach in V1 — and
it is never drawn in the PDF, never in its metadata, and never shown on a
client-facing surface. Rows written before there were accounts carry null,
which the screen shows as no attribution rather than as an error.

The operator column appears in the history table only when the history holds
more than one operator. With one, it is the same name on every row.

## Retention

**Nothing is deleted automatically in V1.** A generated report may be a client
record and must not vanish. A future policy needs a product decision rather
than a default; the shape it would take is a `retained_until` column and an
explicit operator action, never a cron that removes files.

## The future send flow

V1 stops at `GENERATE → DOWNLOAD`. The insertion point for a send is
**between the history row and the operator's download**:

```
GENERATE  →  REVIEW  →  SEND
   │           │          └─ a new `sent_reports` row referencing generated_reports.id,
   │           │             plus whatever the outreach subsystem already records
   │           └─ the operator opens the artefact and approves it
   └─ unchanged
```

A send must reference **an existing artefact id**, never re-generate. That is
the whole reason the artefact is immutable: "which document did we send" has to
have one answer. Nothing in 13J sends anything, and the outreach subsystem is
not touched.

## Deployment

### Locally, today

Nothing new is required. `npm run dev` starts the API and the client;
`CLIENT_PORT` and `API_PORT` move both halves so a second checkout can run
alongside the first. The store directory is created on demand. Report
generation stays read-only against every intelligence table — delivery writes
only to `generated_reports` and its own store.

### Hosted

Answered in `hosting.md` — the runtime contract, the recommended host, the
persistent paths, backups and the runbooks. The short version: one Node
process, one instance, one volume holding the database, the artefact store and
the upload directory; authentication in the application rather than in the bind
address; and not Cloudflare Workers, which have no filesystem and no native
modules.

## Performance

| | |
|---|---|
| athlete list | 10 ms |
| programme search | 14 ms |
| history | 1 ms |
| generate, cold (first of a sport) | 4.9 s |
| generate, warm | 67–73 ms |
| download | 2 ms |

The cold cost is the benchmark pool, not the delivery layer. The UI shows
"Building the document. The first report after a restart takes a few seconds"
rather than a fake progress bar, and the button is disabled throughout.

## QA fixture exclusion

`selectableAthletes` excludes archived records, which keeps
`qa-fixture-womens-soccer-0001` out of the picker, out of generation through
the UI and out of any other athlete's history. It is archived, unpublished and
has no public slug; 13I added an invariant holding all three, and 13J adds one
checking it is not offered to an operator. Tests may still address it
explicitly by id.
