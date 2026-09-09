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

So the manifest fingerprints the five tables the evidence path reads —
`players`, `colleges`, `roster_players`, `coaches`, `athletics_domains` — by row
count and by a digest of their identifying columns in a stated order. It is
checked **first**. When it has moved, the product lines are reported
`UNCOMPARABLE`, not `FAIL`:

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

### The EMAIL_BODY pin does not reproduce, and was not repinned

D3.2 found this and deliberately left it. On the recovered dataset — the one
whose manifest digest is exactly the `5bbca905…` recorded in `evidence.json` —
five of the six baselines reproduce their committed digests exactly.
`EMAIL_BODY` does not: it yields `54a718f9…` against a pin of `a756b5a0…`.

That is **not** a code regression, and the test that establishes it is worth
keeping in mind: running the baseline CLI *at `20af7c22`, the commit that
recorded `a756b5a0`*, against a dataset carrying the manifest digest recorded
beside it, also yields `54a718f9…`. The pin cannot be reproduced by the code
that wrote it, on the dataset it says it was written against. No database on
this machine reproduces it.

So `EMAIL_BODY` depends on an input the manifest does not fingerprint, and that
input's state at pin time is not recoverable. The manifest covers five tables
plus roster freshness; the evidence path also reads `programme_seasons`,
`coach_seasons`, `conference_seasons`, `institution_aliases` and the outreach
tables, none of which are in it. Widening the manifest moves the dataset digest
and makes every pin `UNCOMPARABLE` at once, which is the deliberate decision
this document already says it is — and repinning `EMAIL_BODY` to whatever the
current code emits would bless an unexplained change, which is exactly what
this file exists to prevent.

**It is therefore still failing, on purpose, and is a pre-existing defect older
than D3.** It needs a product decision: widen the manifest to cover the inputs
that actually feed the body, then repin every baseline together against a
snapshot taken at that moment.

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

### Known gap: the manifest does not cover `updated_date`

The manifest fingerprints `roster_players` by `(college_name, sport, season,
player_name)`. `rosterUpdatedAt` comes from `updated_date`, which is **not** in
it. A re-scrape that rewrites timestamps without changing a single roster row
would move `OPERATOR_WIRE`, `LOG_PAYLOAD` and `OPERATOR_EVIDENCE` while the
dataset line still read `UNCHANGED` — the same misdiagnosis as the clock
defect, arriving from data instead. Not closed here: widening the manifest
changes the dataset digest and makes every pin `UNCOMPARABLE` at once, which is
a decision to take deliberately rather than as a side effect.

## Manifest V1 → V2: roster freshness

The manifest carries a `version`. It changed once, at K3C, and the two
definitions are not comparable.

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
