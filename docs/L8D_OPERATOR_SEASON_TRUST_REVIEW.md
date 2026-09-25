# L8D — The operator review surface for historical season trust

Thirteen programme-seasons carry a machine finding and no human decision. L8C
proved the governed write path works; this builds the screen a person actually
decides on, and stops there.

**Claude decided none of the 13. No canonical disposition was written at any
point in this stage.**

Branch off merged main `0a9af7f`.

---

## The 13, derived rather than listed

Queried structurally — `diagnosis IS NOT NULL AND disposition IS NULL` — not
copied from any earlier document. **Count: 13.** All are season **2025**, all
diagnosed `SEASON_IDENTITY_UNPROVEN`.

| # | programme | sport | rows | source URL | page season | adjacent seasons |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Dalton State College | M | 26 | yes | **UNKNOWN** | 2026 · 11/26 shared |
| 2 | Soka University of America | M | 23 | yes | **UNKNOWN** | 2026 · 17/23 shared |
| 3 | William Woods | M | 38 | yes | **UNKNOWN** | 2026 · 24/38 shared |
| 4 | Abraham Baldwin Agricultural College | W | 30 | yes | **UNKNOWN** | none |
| 5 | Bethel College (Kansas) | W | 29 | yes | **UNKNOWN** | 2026 · 13/29 shared |
| 6 | College of Saint Mary | W | 35 | yes | **UNKNOWN** | none |
| 7 | Concordia University Nebraska | W | 26 | yes | **UNKNOWN** | none |
| 8 | Dalton State College | W | 22 | yes | **UNKNOWN** | 2026 · 11/22 shared |
| 9 | North American University | W | 21 | **none** | **UNKNOWN** | none |
| 10 | Soka University of America | W | 27 | yes | **UNKNOWN** | 2026 · 18/27 shared |
| 11 | Virginia | W | 28 | yes | **UNKNOWN** | none |
| 12 | William Woods University | W | 33 | yes | **UNKNOWN** | 2026 · 20/33 shared |
| 13 | Wyoming | W | 23 | yes | **UNKNOWN** | 2026 · **0/23** shared |

The two records that are NOT in this set are the grandfathered RETAINs —
Eastern New Mexico and San Francisco State, both `PROBABLE_DUPLICATE_CAPTURE`,
both with no reviewer recorded. They are left exactly as they are.

## Where the evidence runs out

**Page season, fetch time and parser are UNKNOWN for all 13.** Those columns
were added by L7Z and nothing backfills them, so a record diagnosed before they
existed has no answer. This is the substance of the diagnosis rather than a gap
in the display: `SEASON_IDENTITY_UNPROVEN` says *nothing establishes which
season these rows represent*, and that is still true.

Weakest first, stated so the checkpoint is honest rather than tidy:

- **North American University (W)** — no source URL, no adjacent season, no
  page season. Row count and the diagnosis text are the whole of it. The stored
  evidence does not support a defensible decision either way without looking
  outside the database.
- **Abraham Baldwin, College of Saint Mary, Concordia Nebraska, Virginia (all
  W)** — a URL and a row count, and no neighbouring season to compare against.
- **Wyoming (W)** — holds 2022, 2025 and 2026, and shares **0 of 23** names with
  2026. That is a fact, not a verdict: complete turnover and a mislabelled
  season look the same here.
- **The seven with a 2026 neighbour** — partial overlap from 11/26 to 24/38.
  More to work with, still not proof of which season the 2025 rows are.

No new roster acquisition was run, and no web research was used to fill any of
this in.

---

## The screen

`/colleges/season-trust`, linked from the College DB page beside NCAA roster
gaps. It extends the existing operator workflow rather than adding a second
Evidence-admin application, and it follows `RosterGaps.jsx` — the machine's
finding and the human's conclusion are separate, differently-styled blocks, the
machine's half read-only.

**Queue.** Defaults to **Unresolved**; filters are Unresolved / All / Reviewed.
Each row states the programme, sport, season, diagnosis, row count and division,
with a badge that distinguishes the four states the read model already carries:

| badge | attribution | review state |
| --- | --- | --- |
| Unresolved | `NOT_REVIEWED` | `PENDING_REVIEW` |
| Retained | `ATTRIBUTED` | `DISPOSITIONED` |
| Retained · no reviewer recorded | `LEGACY_UNATTRIBUTED` | `DISPOSITIONED` |
| Excluded | `ATTRIBUTED` | `DISPOSITIONED`, excluded |

**Case detail.** Programme, sport, season, division, rows held, whether Evidence
reads it today; the machine diagnosis and its evidence text, marked read-only
and labelled *"evidence for your review, not a recommendation"*; provenance
(source page, distinct pages, declared season, fetch time, parser); adjacent
seasons with shared-name counts; and the full review history including reviewer,
timestamp, reason, next action and any previous disposition.

**Missing values render as `UNKNOWN`** in italic — never blank, never "none",
never omitted. Where page-season is absent the screen says so in words: *"UNKNOWN
here means not recorded — it does not mean the page declared nothing."*

## The decision

Exactly the two governed choices. No third was invented.

> **Keep this programme-season available to Evidence** — `RETAIN`
> The rows stay in use. Nothing is rebuilt and no other programme is affected.

> **Stop Evidence from using this programme-season** — `EXCLUDE_FROM_EVIDENCE`
> The rows are removed from every Evidence read. This also changes the input the
> recruiting patterns were derived from, so that sport's derived data becomes
> STALE and will refuse to serve until it is rebuilt. The rebuild is a separate,
> explicit action on this screen.

**Neither is pre-selected** — the radio group starts empty. **A reason is
required**, typed by the operator, and nothing is pre-filled: *"Stored with your
decision. Nothing is written here for you."* The submit control stays disabled
until a choice and a reason exist. Where `exclusionBlockedReason` applies, the
server's own sentence is shown and EXCLUDE cannot be submitted.

## The write

`POST /api/roster-season-trust/disposition` — the L8C path, unchanged. No second
writer was added. The screen sends `expected_disposition` set to what it drew,
so a decision taken against a stale reading is refused. Reviewer and timestamp
are the server's; sending either is a 400.

401, 403, 409 and 400 all surface as **"Not saved: …"** — a failed write is
never rendered as a saved decision.

## Stale materialisation, made visible

An EXCLUDE stales the derived recruiting data. **Nothing is rebuilt as a side
effect of the decision**, and that is deliberate: the decision rewrites one row,
the rebuild rewrites ~88,000, and an operator is entitled to see those as two
acts. Proven by test — the generation does not move on a disposition write.

The queue reports `materialisation` per sport on every read, so after an
exclusion the screen shows an amber banner naming the affected sport and
offering **Rebuild** explicitly.

`POST /api/roster-season-trust/rebuild` takes a **sport and nothing else** — no
table, no query, no script name, no flags. An unknown field or an unknown sport
is a 400; it is not a general maintenance endpoint. It runs the **same
`buildSport`** the CLI runs, which is why that function was exported rather than
reimplemented: a second rebuild would be a second definition of "fresh".
`recordBuild` runs inside its own transaction, so rows and stamp land together.

`assertCanonicalWrite` deliberately does **not** move into the route.
`corpusIdentity.js` says it plainly — *"THE SERVER NEVER CALLS THIS… the guard
lives at script entry points, not in client.js"* — so it now sits at
`buildRecruitingHistory.js`'s entry point, where it runs once before any work
instead of once per sport. The script body is guarded by
`import.meta.url === process.argv[1]`, so importing it never rebuilds anything.

Proven after rebuild: generation increments, input digest matches, state FRESH,
the exclusion survives, the untouched programme is untouched, and Evidence is
servable again.

## RETAIN costs nothing

Stored with reviewer and reason; Evidence unchanged; the effective input digest
is byte-identical; the materialisation stays FRESH at the same generation. **No
rebuild is owed and none is offered.**

## Legacy decisions

The two existing RETAINs have no reviewer and keep none. They render as
*"Retained · no reviewer recorded"* / `LEGACY_UNATTRIBUTED`, which is a fact
about those records rather than a gap in them. **Nothing is rewritten and no
reviewer identity is fabricated.**

## Canonical immunity

| | before | after |
| --- | --- | --- |
| trust | 15 / 2 RETAIN / 13 NULL / 0 EXCLUDE | **unchanged** |
| unresolved | 13 | **13** |
| rows with a reviewer | 0 | **0** |
| `programme_status` (P6) | 6 | **unchanged** |
| arrivals | 88,879, generation 1, FRESH | **unchanged** |
| NCAA | 1,755 / 1,732 / 16 / 98.7% | **unchanged** |
| `roster_players` columns | 33 | **33** |
| roster-gap reviews | 7, none attributed | **unchanged** |

`projected_games_started`, `projected_games_played` and
`projected_games_season` were **not touched**. Canonical's mtime is unchanged
throughout. No roster acquisition ran.

On the pinned corpus `8bb808b66db9ee3b`: all six baselines **PASS, no repins**,
`EMAIL_BODY` and `COACH_COMPOSITION` unchanged, closure **10 = 10**.

**326 files, 8,294 tests, 0 failed.** Build clean. One earlier run showed two
failures: a wire key-set guard that correctly caught the new `review_evidence`
sibling — updated with its reason — and `campaignSchema.test.js` timing out at
5s under parallel load, which passes 25/25 isolated.

---

## The checkpoint

**This is where L8D stops.** The mechanism is built and tested; the decisions
are Rhys's.

To review: sign in, open **College DB → Historical season trust**, or go
straight to `/colleges/season-trust`. The queue opens on the 13 unresolved
cases.

For each one: read the machine finding, the provenance and the adjacent-season
context, choose RETAIN or EXCLUDE, and type why.

- **RETAIN** keeps the programme-season available to Evidence. Nothing else
  happens.
- **EXCLUDE_FROM_EVIDENCE** removes it from every Evidence read and stales that
  sport's derived recruiting data. The screen will then offer an explicit
  rebuild; until it runs, Evidence that depends on recruiting patterns refuses
  to serve rather than serving something stale.

## Closeout after the decisions

Once Rhys has decided, the governance completion gate re-derives the unresolved
count, confirms every new decision carries a reviewer and a reason, confirms the
materialisation is FRESH for both sports, re-runs the pinned-corpus acceptance
and re-checks canonical. Any behavioural movement then is **expected** and must
be attributed to the specific exclusions that caused it — an exclusion changes
what Evidence may read, so `EMAIL_BODY` moving is a consequence of a decision
rather than a regression, and the two must not be confused.
