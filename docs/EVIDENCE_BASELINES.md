# Evidence behavioural baselines

    npm run evidence:baseline              the table
    npm run evidence:baseline -- --json    the same, for CI
    npm run evidence:baseline -- --update  rewrite the expectations, explicitly

Six fingerprints over every athlete–programme pair, plus a fingerprint of the
data they were taken over. Committed to `server/scripts/__baselines__/evidence.json`
and checked by `server/lib/evidenceBaseline.test.js`.

Stages F to H each proved their changes safe by hashing the outbound corpus
before and after, and not one of those hashes lived in the repository — the
harness was written in a scratchpad and the constant was quoted in a brief. By
H17 neither could be reproduced. This is the replacement.

## What each baseline protects

| baseline | covers | moves when |
|---|---|---|
| `OUTBOUND_DECISION` | roles, dispositions, alternatives, supersession, prefer state, personalisation flag | selection policy, qualification, the hook ladder, dedupe |
| `COACH_COMPOSITION` | structure, placement, rendered sentences, slot tokens | copy wording, flow choice, the body cap, slot assignment |
| `EMAIL_BODY` | the coach-facing text before transport | any of the above, plus the template and its blocks |
| `OPERATOR_WIRE` | the payload `/evidence` hands the panel | anything an operator reads about the decision |
| `LOG_PAYLOAD` | `primary_kind`, `hook_kind`, structure, `has_personalisation`, the ordered selected set | what we record about an email we sent |
| `OPERATOR_EVIDENCE` | the inspection payload, including `sourceUrl` | provenance and the athletics-domain registry |

They are layered, and **which subset moved localises the change before anyone
opens a diff**:

- all six — a selection or qualification change
- everything but `OUTBOUND_DECISION` — wording, placement or structure
- `EMAIL_BODY` and `OPERATOR_WIRE` only — a template block
- `OPERATOR_EVIDENCE` only — provenance; no coach-facing output moved

## The corpus

Every athlete against every programme **in that athlete's own sport** — the
union of the per-sport products, not their cross product, because an athlete is
only ever matched within their sport. 4,742 pairs today: 3 men's-soccer
athletes × 1,169 programmes, and 1 women's-soccer athlete × 1,235.

All pairs, never a sample. The rare states are the ones worth protecting —
`CURRENT_SAME_COUNTRY` renders 22 times in the whole corpus — and any sampling
rule that is not "everything" is a rule about which regressions we accept
missing.

Ordering is stated by the queries (`ORDER BY id`, `ORDER BY name`), never
inherited from the database.

## The dataset fingerprint

**A hash without a dataset identity is a number, not a baseline.** The corpus
earlier stages used was 3,498 pairs: three athletes against 1,166 programmes.
There are 1,169 now, so the same definition yields 3,507 — nine pairs of silent
drift, and every hash taken over it quietly incomparable.

So the manifest fingerprints every table the evidence path reads — `players`,
`colleges`, `roster_players`, `coaches`, `athletics_domains`,
`recruiting_arrivals` and `coach_seasons` — by row count and by an
order-independent digest over **all** of their columns. (It fingerprinted five
tables by a named projection until D3.3 measured what that missed; see *Manifest
V2 → V3* below.) It is checked **first**. When it has moved, the product lines
are reported `UNCOMPARABLE`, not `FAIL`:

    DATASET CHANGED — the rows moved, so the product hashes cannot be
    compared to ones taken over different rows.

A roster import is not a regression, and reporting it as six is how people learn
to repin without reading.

## The dataset the suite actually reads — D3.2

Until D3.2 the answer was `server/data/recruitmatch.sqlite`: the operator's
working database. The manifest was pinned; its **input** was not. So the full
repository suite went red — six baselines and three report hashes at once —
because a second development session on the same machine acquired sixteen
programmes and put 463 `roster_players` rows in. Nothing had touched the
evidence path.

The manifest was doing its job. It reported `DATASET CHANGED`, correctly. The
defect was that the dataset was allowed to change under a test run at all.

**The input is now a snapshot.**

    npm run baseline:dataset -- --from <a database that still has the dataset>
    npm run baseline:dataset -- --check

`server/data/baseline/recruitmatch-baseline.sqlite` is a copy of the dataset the
committed hashes were taken over. It is verified on creation — the command
computes the copy's manifest and **refuses** a source whose digest is not the
one in `evidence.json`, naming the tables that moved — and then left read-only.
`server/data/` is gitignored and the file is 210MB, so it is materialised
locally rather than committed, and `evidenceBaseline.test.js` and
`reports.test.js` **skip loudly** when it is absent rather than falling back to
the working database. Falling back is the bug.

Each run works on a disposable copy: opening a database through
`server/db/client.js` runs `schema.sql` and `migrate()`, which are writes, and a
fixture that changes when you read it is not a fixture. The snapshot is created
with SQLite's own backup API for the reason `server/scripts/backup.js` records —
a file copy of a live WAL database can be missing its most recent transactions.

Proven, not assumed: with 5,000 roster rows deleted from the working database
and every athlete renamed, both suites return identical results.

### Why the EMAIL_BODY pin was unreproducible, and what was done — D3.3

D3.2 found that on the recovered dataset — the one whose manifest digest is
exactly the `5bbca905…` recorded in `evidence.json` — five of the six baselines
reproduced their committed digests and `EMAIL_BODY` did not. Running the CLI
**at `20af7c22`, the commit that recorded the pin**, gave the same disagreement.
D3.3 found out why.

**The manifest was not an identity for the data.** Instrumenting every prepared
statement of a full `buildBaselines` walk shows it reads **seven** tables. V2
fingerprinted five:

| table | statements per walk | in V2 |
|---|---|---|
| `roster_players` | 4,750 | yes |
| **`recruiting_arrivals`** | **4,742** — one per pair | **no** |
| **`coach_seasons`** | **3,963** | **no** |
| `colleges`, `players`, `athletics_domains`, `coaches` | 15 | yes |

Measured consequences, all with the V2 dataset digest reading **UNCHANGED**:

- changing 181 `recruiting_arrivals` rows moves `EMAIL_BODY`
- emptying either omitted table moves **all six** baselines
- nulling the `roster_players` columns V2 did not name — `position`,
  `nationality`, `hometown`, `country`, `class_year_label`, the minutes — moves
  all six

So the projections were too narrow as well as incomplete. And **column
materiality cannot be predicted by name**: `roster_row_id` looks like a join key
and is inert; `built_at` and `imported_at` look like provenance timestamps and
move all six hashes. Every hand-picked projection is a guess, and a guess that
errs by omitting is silent.

That is the whole explanation of the historical pin. It was taken over rows the
manifest could not see, so the digest recorded beside it did not identify the
data that produced it, and no later run could reproduce or diagnose it.

## Manifest V2 → V3: every column of every table the walk reads

V3 fingerprints all seven tables, **all columns**, and nothing else.
`programme_seasons`, `conference_seasons`, `institution_aliases` and the
outreach tables were all plausible and the instrumented walk touches none of
them; fingerprinting those would report CHANGED for data no baseline can see,
which is the same defect pointing the other way.

**Ordering cannot change a digest.** Each row is hashed alone, the row hashes
are sorted, and the table hash is taken over the sorted list — so a fingerprint
is a property of the *set* of rows. There is no `ORDER BY` to get right, and a
VACUUM, a rebuild or a different query plan cannot move it. Column names are
sorted for the same reason: physical column order is not data. Each component
carries `rows` and `columns` beside its digest so a DATASET CHANGED report names
what moved.

**Why the false-positive argument no longer applies.** V2 stayed narrow because
a manifest that cries CHANGED constantly teaches people to repin without
reading — and it was reading the working database, which moved daily. D3.2 made
the input an immutable pinned snapshot. A maximally sensitive manifest over a
fixture that only changes when somebody deliberately re-pins it produces no
noise at all: it speaks exactly once, when the dataset really is a different
dataset.

`server/lib/datasetManifest.test.js` holds the implication in both directions on
throwaway databases — every one of the seven moves the digest and is named by
its own component, four tables the walk never reads do not, and reinserting the
same rows in a different order does not.

One genuine non-determinism, found while writing those tests and worth knowing:
`migrate()` backfills `players.public_slug` with a **random** slug for any
athlete without one, so a database seeded without slugs is a different database
each time it is opened. The canonical fixture's four athletes are all slugged,
so nothing backfills there.

## The D3.3 provenance reset

Not an ordinary repin. `evidence.json` carries a `provenance` block recording
it, and `--update` now carries that block forward rather than overwriting it.

Before resetting anything, the question that mattered was asked directly: **does
D3 change any baseline when both sides see the same complete dataset?** The
generator was run on byte-identical copies of the canonical fixture at pre-D3
`main` (`ecb171c3`) and at the D3 branch head. All six baselines, `stats` and
`invariants` came back identical. D3 did not move outbound email copy.

The reset then moved exactly one number:

| baseline | before | after |
|---|---|---|
| OUTBOUND_DECISION | `11d52d4d…` | unchanged |
| COACH_COMPOSITION | `e664ac1f…` | unchanged |
| **EMAIL_BODY** | **`a756b5a0…`** | **`54a718f9…`** |
| OPERATOR_WIRE | `e9379455…` | unchanged |
| LOG_PAYLOAD | `d4a41935…` | unchanged |
| OPERATOR_EVIDENCE | `c7641714…` | unchanged |

Five of six re-pinned to the digests they already held, which is the strongest
available evidence that the canonical dataset is the pin-era dataset and that
nothing else moved under cover of the reset.

## Getting the canonical fixture

`server/data/baseline/recruitmatch-baseline.sqlite` is 209MB (48MB gzipped) and
`server/data/` is gitignored, so it is **not in the repository and is not
reproducible from it**. Today it is materialised on a machine that already has a
database carrying the dataset:

    npm run baseline:dataset -- --from <database>   # verifies, then pins
    npm run baseline:dataset -- --check             # confirms what is pinned

The command refuses a source whose manifest digest is not the recorded one, so
"is this the right dataset?" has a mechanical answer rather than a judgement.
Any candidate database can be tested against the recorded digest without
trusting its filename or its date.

**CI cannot reproduce this fixture today, and the suites skip loudly there
rather than pretending.** Closing that needs a decision this stage did not
take: publish the gzipped snapshot as a release or object-store artefact,
keyed by its dataset digest, and have `baseline:dataset` fetch and verify it.
48MB is comfortable for a release asset and far too large for git. Until then,
the baselines are a local gate, and a green CI run does not mean they passed.

## What is normalised away

Exactly one thing: the **profile URL**, fixed to `https://baseline.invalid/p/FIXED`,
because it is per-send and per-environment. Everything else is content and is
hashed as it is — the compliance footer, the greeting, the signoff, every
evidence sentence. No timestamps, ids or machine paths enter any input.

## Rendered vs recorded

The command also checks, on the same walk, that **what we record is what the
coach read**. A hash cannot see this failure: the log and the body can both be
perfectly stable while describing different emails, which is what the legacy
`primary` field did for 701 of them.

All eight counts must be zero — a kind recorded as displayed with no sentence, a
sentence in no block the template carries, `has_personalisation` true with no
evidence sentence, a `primary_kind` or `hook_kind` that was not rendered, a
congratulation recorded as the reason for writing.

**A held claim is not a contradiction.** The composer caps the body at one
gathered clause; the rest are recorded `displayed: false` and counted separately
(232 today).

`has_personalisation` means *an athlete-specific sentence appeared in the
composition*. Recognition does not count: congratulating a programme on its
conference title is a courtesy any sender could pay and says nothing about
whether this athlete belongs there. `outreachEvidenceFor` owns that rule; the
baseline only checks nothing downstream disagrees with it.

## When a baseline moves

**A moved baseline is not a failing test to fix by updating the hash.**

1. **Read which subset moved.** The table above usually names the layer.
2. **Check the dataset line first.** `CHANGED` means the data moved, not the code.
3. **Get the semantic diff.** Re-run the surface that moved on a pairing it
   covers — `npm run evidence -- --athlete "…" --college "…"`, `npm run outreach-qa`,
   `npm run recruiting:evidence` — and read the actual before/after text.
4. **Say what changed and why**, in the commit message, in product terms.
5. **Then** `npm run evidence:baseline -- --update`, which prints exactly what
   it is about to repin.

Nothing else writes the expectations file. A plain run and a test run are
read-only, and that is itself asserted.

## Baselines that live elsewhere, and why

- **`npm run panel-baseline`** — the operator panel's rendered HTML, hashed as
  visible text. A genuinely different boundary from `OPERATOR_WIRE`: the wire
  can be correct and the component still render it wrongly, which is how the
  panel spent H1 offering swaps the send path would refuse. It renders React
  from fixture wire objects rather than live data, so it stays its own command.
- **`npm run test:reports`** — three report commands, hashed whole. They protect
  the CLI output an operator reads, which no product baseline covers. Not
  duplicated here.
- **`npm run backtest`** — the matching model. It consumes a different engine
  with its own tuning cycle, and coupling it would mean an evidence baseline
  failing because someone adjusted a weight. Kept separate deliberately.

## The clock, and the two stages that lost to it

`buildBaselines` reads the corpus at a fixed instant, `BASELINE_NOW`, not at
the wall clock. That constant is the fix for a defect the baseline system was
born with, and it is worth knowing about before anyone is tempted to remove it.

`rosterUpdatedAt` — the newest `updated_date` on a programme's squad rows —
feeds `rosterFreshness(updatedAt, now)`, which returns `ageDays` and a `reason`
with that number written into it. `toWire`, `evidenceLogPayload` and
`wireOperatorEvidence` each copy the whole `programme` block, so **three of the
six baselines had a day counter inside the bytes being hashed**.
`OUTBOUND_DECISION`, `COACH_COMPOSITION` and `EMAIL_BODY` project a named field
list that never included it, which is the only reason they stayed stable and
the reason the split looked mysterious rather than obvious.

So those three pins were correct when written and wrong the next morning:

| pinned at | commit | failed by |
|---|---|---|
| H18, the commit that introduced the system | `bb1248a` | the following day |
| J8 closeout | `5ac8107` | about two hours later, when Akron's roster crossed nine days old to ten |

Both eras were **reproduced exactly** by re-running that same code with the
clock frozen to the commit's own timestamp. That is what proved it. The
smallest semantic diff between the two clocks is two leaf names — `ageDays` and
`rosterAgeDays` — changing by one, and nothing else in ~180 to ~640 leaves.

### Why a fixed clock rather than deleting the fields

Freshness is not decoration. `state` decides whether `CURRENT` evidence is
suppressed at all, and `seasonIsBehind` flips every programme's context in
January. Stripping the fields would blind the baseline to a real product
change. Pinning the clock keeps all of it under the hash and makes the whole
thing a pure function of code and data — the same argument, and the same shape,
as `FIXED_PROFILE_URL`.

Moving `BASELINE_NOW` moves every baseline, deliberately. It is a statement
about which day the corpus is read on.

### The guard

`evidenceBaseline.test.js` builds the corpus at two instants a year apart and
requires all six digests to be identical. **A hash comparison cannot catch this
class of defect on its own**: every run inside one day agrees with every other,
so five runs, a fresh process and a clean worktree all reproduce the same wrong
answer. Only two different clocks separate a behavioural fingerprint from a
clock reading. If that test fails, a new environmental value has entered a
payload, and repinning would restart the decay rather than fix it.

### Closed in V3: the manifest does not cover `updated_date`

**This gap is closed.** It read, correctly for V1 and V2:

> The manifest fingerprints `roster_players` by `(college_name, sport, season,
> player_name)`. `rosterUpdatedAt` comes from `updated_date`, which is **not** in
> it. A re-scrape that rewrites timestamps without changing a single roster row
> would move `OPERATOR_WIRE`, `LOG_PAYLOAD` and `OPERATOR_EVIDENCE` while the
> dataset line still read `UNCHANGED`.

V3 fingerprints every column of `roster_players`, `updated_date` included, so a
timestamp-only re-scrape now moves the dataset digest before it moves a
behavioural hash. The stated reason for leaving it open — that widening the
manifest makes every pin `UNCOMPARABLE` at once — was still true, and D3.3 paid
that cost deliberately once, in the provenance reset above.

The same reasoning is what condemned the projections generally: this gap was
known and named for one column, and D3.3 found the identical shape across
`position`, `nationality`, `hometown`, `country` and two whole tables.

## Manifest V1 → V2: roster freshness

The manifest carries a `version`. **The current definition is V3, above.** V2 is
kept here because a pin from either older definition must stay nameable.

**V1** fingerprinted five tables by their identifying columns. **V2** adds a
sixth component, `roster_freshness`.

K3A found the gap: `rosterUpdatedAt` reads `updated_date`, which V1 never
looked at. A re-scrape that only rewrote timestamps would move
`OPERATOR_WIRE`, `LOG_PAYLOAD` and `OPERATOR_EVIDENCE` while the dataset line
still read `UNCHANGED` — exactly the misdiagnosis the manifest exists to
prevent, arriving from data instead of the clock.

`roster_freshness` is `MAX(updated_date)` per `(college_name, sport)` **in
`SQUAD_SEASON` only** — 1,910 rows, digest `80ab2d600fdb4462`. That is the unit
production reads: `buildProgrammeContext` calls `latestUpdate(squadRows)`, and
`squadRows` filters to the current season. Deliberately not every row's raw
timestamp: there are ~11,800 distinct values in the table, so a full-timestamp
digest would flap on any partial re-scrape, and a manifest that reports
`CHANGED` constantly teaches people to repin without reading it. The narrow
definition is also the honest one — a historical season's timestamp reaches no
email, and moving the digest for it would claim a dependency that is not there.
Both directions are tested.

| | digest |
|---|---|
| V1 combined | `7f19b7d8b75608c2` |
| V2 combined | `5bbca9054b7752d5` |

**A V1 pin now reports `DEFINITION_CHANGED`, and every product line reads
`UNCOMPARABLE` rather than `FAIL`.** That is not a baseline failure and must
not be described as one: a digest computed under V1 answers a different
question, so it is not a wrong answer to V2's, it is an answer to something
else. The transition is a one-time explicit repin.

**The transition moved no behavioural hash.** All six were byte-identical
across it — proof that the manifest change is comparability only and touches no
product behaviour.
