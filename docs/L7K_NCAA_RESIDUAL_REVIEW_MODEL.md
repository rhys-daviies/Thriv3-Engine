# L7K — three layers, kept apart

```
RAW ATTEMPT       what a stage literally saw      _state/state<S>.json   pipeline
MACHINE DIAGNOSIS failure_class · candidate state  derived, reproducible  pipeline
OPERATOR          what a person concluded          roster_gap_reviews     human
```

**No roster acquired. No dataset, registry, sheet or pipeline state touched.
Zero review records written.** Manifest unchanged, six baselines PASS
unrepinned, P6 unchanged.

---

## 1. Nothing already owned this

Searched for every concept that could already carry a machine failure, an
operator review, a programme status, a suppression or a disposition:

| owner | what it is | why not |
|---|---|---|
| `_state/state<S>.json` | L7J's durable acquisition state | the **machine's** layer, and the thing a reset exists to manage |
| `_targets.csv` `Status`/`Notes` | rewritten every run by `write_out.py` from state | L7J demoted it to a projection; it is not an authority |
| `conference_membership_quarantine` | 1,330 rows, machine quarantine of unresolvable members | machine output, other domain, no operator field |
| `suppressions` | 0 rows, outreach email suppression | wrong domain entirely |
| `colleges.active` | registry truth about whether a programme is fielded | Phase 10 forbids touching it, and rightly |
| `athlete_programmes.flagged_by_operator_id`, `note_updated_by_operator_id` | the house shape for an operator decision | right shape, wrong grain — athlete×programme in the matching product |
| `rosterSourceAudit.js` | whether an existing roster URL may be cited | asks whether a source is linkable, not whether one exists |

The five residual labels appear **nowhere in code** — only in stage documents and
in L7J's comment listing them as deliberately excluded. So one new owner is
justified, and it is the only one added.

## 2. The five labels were not one vocabulary

Sorted by **who can establish them**, they fall into three piles:

**`NO_HOST` is a machine fact.** `hostsForInstitution` returns
`NO_TRUSTED_HOST` or it does not, and three of the ten current gaps are in that
state right now. Nothing human is involved. Storing it as a disposition would be
a person re-asserting a query result, which goes stale the moment the ledger
changes — the exact failure L7J spent a stage fixing. It is reported live from
the planner.

**`MANUAL_REVIEW` is a review status, not a conclusion.** "This needs a person"
is precisely what the absence of a review means. As a stored value it is a row
saying "this row is not filled in yet". It is derived from whether a record
exists.

**The other three are genuine dispositions.** Each states a condition a person
established by looking at something the pipeline cannot interpret.

### A condition is not an instruction

`SITE_TEMPORARILY_UNAVAILABLE` is a claim about the future and needs a date, or
it is a permanent block with a friendly name. `PROGRAMME_STATUS_QUESTION` needs a
person to settle it, not another fetch. And **Northwood is the case that settles
the argument**: it was `SOURCE_NOT_AVAILABLE` for two stages, and L7I then
acquired it at candidate one. The disposition had been *correct* — no source had
been established — and reading it as "stop asking" would have been wrong.

So the condition and the action are separate fields. That is what stops a label
becoming a blacklist, which is the direction a residual queue drifts in.

| disposition | may carry | why |
|---|---|---|
| `SOURCE_NOT_AVAILABLE` | `RETRY_ACQUISITION`, `NONE` | a better generator may reach it — see Northwood |
| `PROGRAMME_STATUS_QUESTION` | `CONFIRM_PROGRAMME_STATUS`, `NONE` | a person decides; retrying skips them |
| `SITE_TEMPORARILY_UNAVAILABLE` | `RETRY_AFTER` **only** | temporary without a date is permanent |

`validateReview` refuses every other pair, with a reason rather than a rejection.

**Chosen model: disposition + next_action, with review status derived.** Of the
four options, one enum cannot hold a retry date; three stored fields would make
`review_status` restate whether a row exists. This is the smallest model that is
still true.

## 3. Semantics, locked

**`NO_HOST` vs `SOURCE_NOT_AVAILABLE`.** `NO_HOST` means no sufficiently trusted
athletics fetch authority — `candidateState: NO_TRUSTED_HOST`, 0 candidates,
established by query. `SOURCE_NOT_AVAILABLE` means a trusted host exists and no
current roster source was established on it. This matches the architecture: the
planner already reports exactly this distinction, which is why the machine keeps
the first and the operator keeps the second.

**`PROGRAMME_STATUS_QUESTION` is a question, deliberately.** It covers all of
"may not be fielded", "may start in a future season" and "the registry may be
ahead of the field", and it does not choose between them. Wisconsin-Oshkosh's own
navigation reads "Soccer (Coming in 2027)", which is *evidence*, not a decision.
**Registry truth stays in `colleges`; this table may never mark a programme
inactive.** Resolving the question is a separate, deliberate act by whoever owns
the registry.

**`SITE_TEMPORARILY_UNAVAILABLE` requires evidence that the SITE is failing**,
not that our search did — the difference from `SOURCE_NOT_AVAILABLE`. It requires
`RETRY_AFTER` with a date; the queue holds it until that date and releases it
automatically afterwards. A temporary condition cannot become permanent by
default because nothing can express that.

**`MANUAL_REVIEW` is gone as a disposition**, and is the derived `UNREVIEWED`
state. It cannot become a catch-all for "the machine failed" because it cannot
be written at all.

**Retry eligibility.** Unreviewed is **eligible** — a gap nobody has looked at is
one the pipeline should keep trying, and the alternative turns an unreviewed
queue into a quiet blocklist. Only `CONFIRM_PROGRAMME_STATUS`, a future
`RETRY_AFTER` date, and an explicit `NONE` hold a programme back.

## 4. Storage, and why it is safe

`roster_gap_reviews`, keyed `(season, school, sport)`, in the database.

**The separation from the pipeline is physical, not promised.** The acquisition
pipeline is Python over CSV and JSON under `~/Documents/Thriv3` and holds no
database connection at all, so `build_targets.py --reset-state` has no path to a
review. A test asserts that no pipeline source mentions the table, the database
file or `sqlite3`. That is a stronger guarantee than a rule someone must
remember, and it is the reason this is not another file next to `_state/`.

A review is season-scoped: a conclusion about 2026 says nothing about 2027, so
next season's queue starts empty rather than inheriting.

**Audit trail:** `evidence` (a sentence about what was seen — never a payload),
`reviewed_at`, `reviewed_by_operator_id`, and a **bounded history of exactly one
step**: `previous_disposition` and `previous_reviewed_at`. That answers "has this
changed, and from what", which is the question actually asked of a ten-row queue.
A history table would be an event log for ten rows.

**Withdrawal is deliberate.** A successful acquisition does not clear a review,
because acquiring Northwood did not disprove its disposition — L7I changed the
generator, not the fact. Clearing one is an operator act that must record why.

**Machine suggestions: rejected, explicitly.** The queue already shows
`candidateState` and `failure_class` beside the operator column. A
`machine_suggestion` field would be a third name for evidence already on screen,
and its only distinctive power would be to make a machine guess look like a human
conclusion — which is the boundary this stage exists to draw.

## 5. Bootstrap: nothing written

**Zero review records created, and no stage-document label assigned.**

Of the options, the safest is not "create `UNREVIEWED` rows" but **create no rows
at all**: unreviewed is the absence of a record, so placeholder rows would add
nothing a `LEFT JOIN` does not already say, while making the table's row count
stop meaning "decisions taken".

The five labels in L7F–L7I were real conclusions about the world at the time. But
L7J proved the machine state behind them froze at the first attempt, and L7I
proved one of them (Northwood) had already stopped being true. Writing them in
now would assert as current a set of judgements nobody has re-made — the
fabrication the brief forbids. They stay in the stage documents as history.

## 6. The queue

`npm run roster-gaps` (`--json` for a caller). Read-only; a test asserts the
database file does not change size and that no review exists after running it.

```
  division  g  school                                 candidates  recorded            review
  NCAA D2   M  Southwest Minnesota State               24      variants (stale)    UNREVIEWED
  NCAA D3   M  New Jersey City                          0      variants            UNREVIEWED
  …
  NCAA programmes            1761
  with roster data           1744
  registry duplicates        7  (a registry job, not an acquisition one)
  legitimate active gaps     10
  reconciles                 yes  (1744 + 7 + 10 = 1761)
  reviewed / unreviewed      0 / 10
  retry eligible / held      10 / 0
  candidate state            {"NEW_VERIFIED_HOST_CANDIDATES":7,"NO_TRUSTED_HOST":3}
  recorded failure class     {"none":10}
  operator disposition       {"none":10}
```

Three groups of fields per row, never merged into one `status`: the machine's
live view (`candidateState`, `candidates`, `fetchHosts`), the machine's recorded
view (`lastStatus`, `lastStage`, `lastFailureClass`, `lastError`, `lastAttempts`)
and the operator's (`reviewStatus`, `disposition`, `nextAction`, `retryAfter`,
`reviewedAt`, `reviewEvidence`), plus derived `retryEligible`.

**Two things the queue found on its first run.** The counts did not reconcile
until the seven registry duplicates were separated from the ten gaps — they are
why 1,744 and 1,751 could both be called "programmes with a roster" in the same
week. And it independently reproduces L7J's staleness result: **7 of 10 recorded
reasons say nothing was there to try while the planner offers 24 candidates
today**, flagged per row and counted in the summary, so nobody reads a frozen
reason as a classification.

## 7. No product coupling

Operator review is operational metadata. Three tests hold the line: no source in
`shared/evidence`, `server/lib`, `server/routes`, `src/lib` or `shared/roster`
imports the review modules or queries the table; the review modules import
nothing from Evidence, matching, outreach, campaigns or email; and no pipeline
source can reach the table. **Evidence, matching, outreach, email composition and
programme inclusion are untouched, and P6 is unchanged.**

## 8. Verified unchanged

| | |
|---|---|
| `roster_players` | 277,397 · `athletics_domains` 2,722 · `colleges` 2,404 |
| `roster_gap_reviews` | **0 rows** |
| `_targets.csv` | `8091e7c0313ea913`, identical to L7J |
| `_state/state2026.json` | `ec7de3bd11c52d27`, identical to L7J |
| ten roster sheets | all identical |
| manifest | `194fcf38877e6686`, **UNCHANGED** |
| six baselines | **PASS, unrepinned** |

## 9. Debt

**Nothing writes a review yet.** `recordReview` is exercised only by tests; there
is no CLI or operator surface. That is deliberate — the stage was asked for the
model, and a review written through a test harness is not a review. The next
stage should give it the smallest possible front door.

**`operator_users` is not created by `schema.sql`.** Found here: a `REFERENCES
operator_users(id)` clause made a database built from `schema.sql` alone unable to
accept a review at all, because the auth tables are created elsewhere. The column
is now unconstrained and records who when anyone knows. Whoever owns the auth
path should decide where those tables are declared.

**The queue reads the pipeline state file by path.** `RB_ROOT` plus a filename,
with a silent fallback to `{}` when it is absent — which is correct for a report
but means a mistyped root reads as "no attempts recorded" rather than as an
error. Worth a louder signal if anything starts depending on it.
