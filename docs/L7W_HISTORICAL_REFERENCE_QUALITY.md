# L7W — the gate was right; the reference was the union of two seasons

L7V left eleven programmes refused by the turnover gate and one finding about
them: not one of their 2025 references is season-pinned. L7W asked whether a
trustworthy 2025 reference could be established, and what happens to the
comparison when it is.

**Six of the eleven now have a season-specific 2025 reference, and all six were
acquired. Every one passes the existing gate on name overlap alone — 41% to
77%, all comfortably below 0.85 — so not one needed the graduation-year
admission, and no gate was touched.** The other five divide into four whose
sites have never named a season on any page, live or archived, and Frostburg
State, which is a different problem entirely and stays refused.

Coverage **1,725 → 1,731 of 1,748 — 98.7% → 99.0%**, and `TURNOVER_REFUSED`
falls from eleven to five.

The mechanism turned out to be arithmetic rather than judgement. The old
reference was **the union of the 2025 and 2026 squads**, so the 2026 roster was
a subset of it, and

    overlap = |2026 ∩ reference| / |2026|

was **1.00 by construction**. The gate was not mismeasuring a real turnover; it
was being handed a reference that made turnover unmeasurable — and it said so,
in those words, for a year.

---

## Containment

Started at `c5a4518`, nothing intervening, tree clean. `programme_status` 6,
`roster_gap_reviews` 7, coverage 1,748 / 1,725 / 23 / 20 / 3 = 98.7%, manifest
`2895861d5587a5c2` under V3, six baselines PASS, P6. Hashed before: `_targets.csv`,
`state2026.json`, all six stage files, all ten 2026 roster sheets, and content
digests over `roster_players`, `athletics_domains`, `colleges` and
`programme_status`.

## Re-deriving the eleven

Diagnostic V2 (`L7U/ladder-walk-evaluate/v2`) over the structurally derived
historical-only cohort — now **20**, the 81 acquired in L7V having left it —
reproduces L7V exactly:

```
 11  TURNOVER_REFUSED     digest 1fbd12eabf277e07
  6  PAGE_PRIOR_SEASON    digest e0950f6677785802
  2  PARSE_ZERO           digest 19e4f9e63f61c61c
  1  SITE_UNREACHABLE     digest 2869d299087060e6
```

The eleven derived from the walk are **set-identical** to the eleven the brief
names, proved by set equality rather than assumed from the names.

## The acceptance contract

`tools/roster_pipeline/reference_quality.py`, contract
`L7W/historical-reference/v1`. Eight clauses, and the point of the module is how
little of it is new: seven delegate to the authority that already owns the
question.

| | clause | who answers it |
|---|---|---|
| 1 | correct institution | the host that served this programme's own accepted rosters, seen through any archive wrapper |
| 2 | correct sport | `lib.sport_contradicted` |
| 3 | correct gender | `lib.sport_contradicted` — the sport key carries it |
| 4 | **2025 season identity, established by the page** | `lib.season_ok(title, season=2025)`, strictly `True` |
| 5 | roster context | `lib._nuxt_player_lists` — at most one container; not a bio URL |
| 6 | sufficient player rows | `run.evaluate`'s own floor of 5 and its 2.6× upper bound |
| 7 | source provenance | first-party host; not a schedule, not a bio, not an aggregator |
| 8 | no mixed-season ambiguity | the rows came from **one** page |

### The inference the contract refuses to make

**Rows stored under `season=2025` are not evidence that the page they were read
from represented 2025.** That inference is how the eleven got their references:
in the autumn of 2025 a bare roster URL *did* serve the 2025 squad, so the
pipeline recorded the bare URL and the season label together and the two became
indistinguishable. A year later the same URL serves 2026 and the provenance
cannot say which squad the rows describe. Clause 4 therefore asks the page, and
never the database.

### 2025 vs 2025-26

`lib.season_ok` already owned this and needed no change. **The first year of an
academic-year span is the Fall season.** A page naming `2025`, `2025-26`,
`2025-2026` or `25-26` establishes the Fall 2025 soccer roster; a page naming
`2024-25` does not, because its Fall is 2024. A page naming a different year is
a positive rejection rather than a maybe, and a page naming no year at all
establishes nothing — which is the finding for Arkansas, Miami (FL) and
Vanderbilt, whose roster pages have never carried a season in their titles.

No institution-specific exceptions anywhere: Frostburg's own page claims 2026
and is refused for it, on the same rule that accepts Boston University's 2025.

### What clause 8 is, after being wrong once

L7V read mixed class dialects — `Sr.` beside `Senior` — as rows assembled across
seasons, and named five programmes. **It is right about four and wrong about
Iowa.** Iowa's single archived page renders `So.`, `Jr.` and `RS Fr.` beside
`Graduate Student` and `Redshirt Freshman` in one payload, because the site
publishes a short form for some class levels and only a long form for others.
Refusing that page would have refused a good reference for being transcribed
faithfully.

So vocabulary mixing is reported and never decisive. What actually proves rows
were assembled across page states is **how many pages they came from**, and the
four bio-capture references carry ten, fourteen, fifteen and twenty-two distinct
source URLs each, captured between September and February and filed together
under one season label.

## The old references, audited

Zero of eleven are trustworthy.

| programme | rows | source URLs | known-good reference | also |
|---|---|---|---|---|
| Arkansas W | 27 | 1 | bare current | |
| Boston University W | 34 | **15** | player-bio capture | 4 rows with no source; mixed dialects |
| Drexel W | 31 | **14** | player-bio capture | 1 row with no source; mixed dialects |
| Frostburg State M | 41 | 1 | bare current | 10 rows with no source |
| Iowa W | 28 | 1 | bare current | mixed dialects (the site's own) |
| Miami (FL) W | 31 | 1 | bare current | |
| Murray State W | 36 | **22** | player-bio capture | mixed dialects |
| New Mexico W | 29 | 1 | bare current | |
| Oklahoma State W | 39 | **10** | player-bio capture | mixed dialects |
| Vanderbilt W | 26 | 1 | bare current | |
| Virginia W | 28 | 1 | bare current | |

Row-level, across all 353 rows: **276 from a bare "now" URL, 56 from player
bios, 15 with no source at all, and 3 from a season-pinned URL** — Oklahoma
State's, three rows that were the first clue that `/roster/2025` exists.

## Discovery

`tools/roster_pipeline/discover_reference.py`, `L7W/reference-discovery/v1`.
Read-only. It owns no policy either: the candidate ladder is `variants.ladder`
run with `RB_CURRENT` unset — which is why **the bare URL is never offered**,
since a backfill has always required a page to name its season — and archive
lookup is `lib.cdx`, whose default window is already the target season's own
August-to-February.

Every first-party live candidate is tried before any capture, because a live
season-pinned page is the institution publishing its own history and a capture
is a copy of it.

## Where a repaired reference lives

**The historical roster record already owns this, and nothing is bolted onto the
gate.** The 2025 roster sheet carries one row per player with the programme, the
sport, the season by virtue of the file it sits in, the `Source Roster URL` and
the parser's note — and it is exactly what `state.names25()` and
`state.classes25()` read when the gate asks what last season's squad was. The
worklist's `Roster URL 2025 (known good)` and `2025 Player Count` are that same
record's summary view.

So the repair rewrites those rows, for those programmes, and the acquisition run
then picks the repair up by reading the sheet it always reads. No override is
passed to any command, and no second notion of a "turnover reference URL"
exists.

Three consequences, all deliberate:

* **Performance columns are carried forward by player name.** Minutes, games
  played, games started and the stats URL come from a different pipeline, and a
  provenance repair has no business discarding them.
* **The splice is line-exact.** A full rewrite through `csv.writer` is not
  byte-stable — it re-quotes fields the original left bare — so every programme
  in the file would report as changed and "what did this stage touch?" would
  become unanswerable. One line per row holds in every sheet and each line
  begins with its own School field, so only the repaired programme's lines move.
* **The database is not re-imported.** `importRosterSheets.js` has no key
  scoping; re-importing 2025 to follow the sheet would rewrite two thousand
  programmes to fix five. The divergence is real, it is confined to these
  programmes' closed-season rows, and it is recorded as debt below rather than
  resolved here.

## Architecture change

**None to the acquisition path.** The diff of `lib.py`, `run.py`, `state.py`,
`variants.py`, `selector.py`, `browse.py`, `verify_gate.py`, `build_targets.py`,
`write_out.py`, `plan.py` and the `shared/` and `server/lib/` roster modules
against `c5a4518` is empty. The ladder already generated `/roster/2025`,
`/roster/season/2025` and `/roster/2025-26`; `lib.season_ok` already read both
`2025` and `2025-26`; `lib.cdx` already defaulted to the season's own window;
`run.evaluate` already demanded that a backfill page name its season. L7W added
three files that read those and write nothing to the pipeline:

* `reference_quality.py` — the contract
* `discover_reference.py` — the ordered search
* `repair_reference.py` — the scoped write to the historical record

No institution names appear in any of them. No threshold moved.

## The wider corpus — 641 of 2,123

Measured over every programme holding an accepted 2025 roster, under the same
contract, before anything was changed:

| | programmes | |
|---|---|---|
| every row from one season-pinned first-party URL | **1,482** | 69.8% |
| every row from a bare "now" URL | 284 | 13.4% |
| some row with no source URL at all | 211 | 9.9% |
| some row from a player bio | 84 | 4.0% |
| rows from several pages, none pinned | 62 | 2.9% |
| **untrustworthy under the contract** | **641** | **30.2%** |

Row-level, over 64,739 rows: 83.3% season-pinned, 14.8% bare/current, 1.3% with
no source, 0.7% from a player bio.

And it is not spread evenly:

| division | untrusted | of | |
|---|---|---|---|
| NCAA D1 | 370 | 563 | **65.7%** |
| NCAA D3 | 166 | 702 | 23.6% |
| NCAA D2 | 92 | 455 | 20.2% |
| NAIA | 13 | 382 | 3.4% |
| USCAA | 0 | 21 | 0% |

That concentration is the eleven's origin story: ten of them are D1, and D1 is
where two thirds of the historical corpus rests on a URL that cannot say which
season it served. **This is reported and not repaired.** Current-2026 coverage
and historical provenance quality are separate concerns, and a stage that
rewrote 641 closed-season rosters while claiming to acquire eleven would be
neither.

## What discovery found

| programme | result | reference |
|---|---|---|
| Boston University W | **TRUSTED_SEASON_PINNED** | `goterriers.com/sports/womens-soccer/roster/2025` — "2025 Women's Soccer Roster" |
| Drexel W | **TRUSTED_SEASON_PINNED** | `drexeldragons.com/sports/womens-soccer/roster/2025` — "2025 Women's Soccer Roster" |
| Murray State W | **TRUSTED_SEASON_PINNED** | `goracers.com/sports/womens-soccer/roster/2025` — "2025 Women's Soccer Roster" |
| Oklahoma State W | **TRUSTED_SEASON_PINNED** | `okstate.com/sports/womens-soccer/roster/2025` — "2025 Cowgirl Soccer Roster" |
| Iowa W | **TRUSTED_ARCHIVED** | capture `20250908070127` of `hawkeyesports.com/sports/wsoc/roster` — "Women's Soccer 2025-26" |
| New Mexico W | **TRUSTED_ARCHIVED** | capture `20250910191227` of `golobos.com/sports/wsoc/roster` — "Women's Soccer 2025-26" |
| Arkansas W | AMBIGUOUS | `/roster/2025` serves 200 and 28 players under the title "Roster \| Arkansas Razorbacks" — the site has never put a season in that title, live or in five captures |
| Miami (FL) W | UNTRUSTED_BARE_CURRENT | every pin 404s; five captures, all titled "Soccer – University of Miami Athletics" |
| Vanderbilt W | UNTRUSTED_BARE_CURRENT | every pin 404s; two captures, neither naming a season |
| Virginia W | UNAVAILABLE | every pin 404s and the index holds no Fall-2025 capture — six queries across two URLs, zero each time, while Arkansas's and Iowa's answered in the same session |
| Frostburg State M | AMBIGUOUS → **CURRENT_PAGE_STALE** | see the control below |

Oklahoma State's `/roster/2025` was not a guess. Three of its stored 2025 rows already carried that
URL, which is what said the form existed on these hosts at all — and the ladder was already
generating it.

**Why the archive index needed its own vocabulary.** `lib.cdx` returns `[]` both when the index has
nothing and when it swallows a 429 after three tries, and Iowa came back UNAVAILABLE on one run and
TRUSTED_ARCHIVED on the next with three captures that were there the whole time. Discovery now
records the capture count per lookup and reports `ARCHIVE_INDEX_UNANSWERED` rather than letting a
failed lookup be read as an absent page. Virginia is the one programme where that distinction had to
be settled by hand, and six consecutive empty answers settled it.

## Old reference against repaired reference

Measured by substituting one reference for the other and asking `run.evaluate` the same question
twice. Nothing else changed.

| programme | 2026 page | old n | old overlap | old aged | new n | new overlap | new aged | verdict |
|---|---|---|---|---|---|---|---|---|
| Boston University W | 26 | 34 | 100% | 9/26 · 35% | 28 | **77%** | 19/20 · 95% | PASS |
| Drexel W | 24 | 31 | 100% | 7/24 · 29% | 25 | **71%** | 17/17 · 100% | PASS |
| Iowa W | 28 | 28 | 100% | 15/28 · 54% | 30 | **61%** | 22/25 · 88% | PASS |
| Murray State W | 26 | 36 | 100% | 6/26 · 23% | 26 | **58%** | 14/15 · 93% | PASS |
| New Mexico W | 29 | 29 | 100% | 20/29 · 69% | 27 | **72%** | 20/21 · 95% | PASS |
| Oklahoma State W | 29 | 39 | 90% | 4/26 · 15% | 25 | **41%** | 12/12 · 100% | PASS |

**Every one passes on overlap alone.** The graduation-year admission is never reached, because the
gate is never tripped — which is the whole point: a repaired reference did not need a second opinion
to rescue it.

### Why the old comparison refused

The old reference is **the union of the 2025 and 2026 squads**:

| programme | 2026 ⊆ old reference? | old names outside (repaired 2025 ∪ 2026) |
|---|---|---|
| Boston University W | yes — and old 34 is *exactly* \|28 ∪ 26\| | 0 |
| Drexel W | yes | 0 |
| Iowa W | yes | 0 |
| Murray State W | yes | 1 |
| New Mexico W | yes | 0 |
| Oklahoma State W | all but 3 — signings the old capture predates | 0 |

Overlap is `|2026 ∩ reference| / |2026|`, so a reference containing the whole 2026 squad scores
**1.00 whatever the squads did**. Five of the six scored exactly that. The gate was not
mismeasuring turnover; it was being handed a reference against which turnover cannot be measured,
and it said so — *"either last season served back, or a 2026 page listing only returners"* — for a
year.

Iowa is the sharpest case. Its stored 2025 reference names **exactly the 28 players on the 2026
page** and none of the 2025-only players the archived 2025-26 capture lists. Whatever produced those
rows, they are not the 2025 squad.

The class labels tell the same story from the other side: the repaired references speak **one**
dialect where four of the old ones spoke two, and the aged fraction moves from 15–69% to 88–100%
because the labels are now genuinely last season's.

## Frostburg State — the control

Treated separately and deliberately, because it is the one programme where the current page rather
than the reference could be at fault. Three findings, none of which needed a repair:

* `frostburgsports.com/sports/mens-soccer/roster/2025` and `/roster/2026` return **the same page**,
  titled "2026 Men's Soccer Roster". The site publishes one roster document and relabels it.
* **30 of its 31 names are in the stored 2025 squad, and 29 of those 30 class labels are
  byte-identical to it.**
* The single label that changed runs **backwards**: Gabe Jones from `Gr.` to `Sr.`, a year younger,
  which no real player does.

So there is no 2025-versus-2026 comparison to repair: only one squad has been published. **0 of 30
returners aged**, the only one of the eleven to score zero, and exactly what L7Q built the
graduation-year rule to detect. Frostburg stays refused, and no repair was invented for its current
page.

## The repair

Scoped to the six, applied through `repair_reference.py`:

| programme | reference type | 2025 rows | performance rows carried | stats rows dropped | confidence |
|---|---|---|---|---|---|
| Boston University W | season-pinned | 34 → 28 | 28 | 6 | High |
| Drexel W | season-pinned | 31 → 25 | 24 | 7 | High |
| Iowa W | archived | 28 → 30 | 17 | 11 | Medium |
| Murray State W | season-pinned | 36 → 26 | 24 | 12 | High |
| New Mexico W | archived | 29 → 27 | 21 | 8 | Medium |
| Oklahoma State W | season-pinned | 39 → 25 | 25 | 14 | High |

A live season-pinned page is read at **High** confidence and a capture at **Medium**, which is the
distinction `variants.py` already draws in the same words.

**Containment, checked rather than asserted.** One 2025 sheet changed; the other nine are
byte-identical. Inside it, **9,676 lines belonging to 343 other programmes are byte-identical** and
only the six programmes' own lines moved. `_targets.csv` changed in **exactly 6 rows and exactly 2
columns** — `Roster URL 2025 (known good)` and `2025 Player Count` — out of 2,165 rows.

## The run

```
TO ATTEMPT                                              6
run_scope == attempt_targets == WOULD_RESOLVE_NOW    True   digest bab364479ea1c2fe
other historical-only 0   PAGE_PRIOR_SEASON 0   PARSE_ZERO 0
SITE_UNREACHABLE 0        never-fetched 0       non-NCAA 0
```

The scope was **re-derived structurally** after the repair — Diagnostic V2 over the same twenty
keys — rather than taken from the comparison above. It came back as exactly the six with a
trustworthy reference: `WOULD_RESOLVE_NOW` is a subset of the repaired set and the repaired set is a
subset of it. `TURNOVER_REFUSED` fell 11 → 5, and the five are precisely the five without a
reference. The three untouched classes kept their digests to the character.

Stale-stage precheck on a temporary state copy first: **87 records seen, 78 refused as
out-of-scope, 0 out-of-scope durable changes.**

`./run_season_current.sh 2026 2025 --keys <6>` — no manual URL, no source or parser override, no
hand repair, no code change, no cache deletion. The repaired reference reached the run the only way
it could: `state.names25()` read the sheet it always reads.

**6 resolved, 0 failed**, all at the `variants` stage. Absorb refused **38, 20 and 20**
out-of-scope records at its three calls. `verify_gate` re-measured 2,034 accepted rosters against
the gate in force and kept eight high-overlap ones on the graduation-year rule, all from earlier
stages; **0 were left at or above the gate.**

## Containment after

| | |
|---|---|
| 2026 sheets changed | **1** of 10 |
| programmes changed in it | exactly the six |
| durable state keys changed | **6**, all in scope; 0 out-of-scope, 0 created, 0 removed |
| max `tried` | 12 = `TRIED_MAX` |
| stage files byte-identical | 5 of 6; `state_variants_2026.json` 40 → 44, the 38 out-of-scope records retained untouched |
| manifest tables moved | `roster_players` +162, `roster_freshness` +6 — and no other |
| `players`, `colleges`, `coaches`, `athletics_domains`, `programme_status` | unchanged |
| database programme-seasons changed | **6**, all 2026, all from 0 rows |
| rows added / changed / removed | **+162 / 0 / 0** |
| closed-season database rows touched | **0** |

## Coverage

**1,725 → 1,731 of 1,748 — 98.7% → 99.0%.** Missing 23 → 17, historical-only 20 → 14,
never-fetched 3. `historicallyRostered` stayed at 1,745, as it has through every acquisition stage
since L7Q: these six were programmes the dataset already knew from 2025.

## Evidence and email

12 pairs touch the six programmes. **2 moved, both generic → personalised**, both for the
women's-soccer fixture athlete:

* Boston University — *"one midfielder is listed to graduate in 2027 — Gianna Savella"*
* New Mexico — *"one midfielder is listed to graduate in 2027 — Kennedy Brown"*

Both verified against the imported rows exactly: Boston University has precisely one midfielder with
an estimated graduation of 2027 and she is Gianna Savella; New Mexico has precisely one and she is
Kennedy Brown — and its one 2027 forward, Presley Devey, is correctly not claimed as a midfielder.

**GOOD 2, ACCEPTABLE 0, WEAK 0, BAD 0.** Corpus: 4,742 pairs unchanged, personalised 1,776 → 1,778,
rendered sentences 2,863 → 2,865, held claims 221 unchanged, structures unchanged. No repaired
historical row produced any Evidence: a provenance repair on a closed season cannot, because
Evidence reads the current season.

## The residual, re-diagnosed

Diagnostic V2 over the 14 historical-only programmes after the import:

```
 0  WOULD_RESOLVE_NOW
 6  PAGE_PRIOR_SEASON    digest e0950f6677785802
 5  TURNOVER_REFUSED     digest f30707b66167d2c1
 2  PARSE_ZERO           digest 19e4f9e63f61c61c
 1  SITE_UNREACHABLE     digest 2869d299087060e6
```

**All four digests are identical to the post-repair, pre-run reading** — proof that the run consumed
exactly the six and moved nothing else.

`TURNOVER_REFUSED` is now **five**: Arkansas W, Miami (FL) W, Vanderbilt W, Virginia W and
Frostburg State M. These are no longer a cohort with one shared problem; they are five programmes
with two distinguishable ones. Four are unverifiable — their sites never name a season and no
capture does either — and Frostburg has published only one squad. **We now know which of the
eleven were reference artifacts and which are real, which is what the stage set out to establish.**

## The loop that could not exit

**L7W broke `reacquisitionCohort.js` by succeeding, and this is the correction to
an earlier reading of the same symptom.** The script and its test both hung; the
first explanation offered was contention, and that was wrong.

`allocate` seats each stratum at its own row count and hands the overflow back
to whichever stratum has room. When the requested size exceeds the cohort total,
**nowhere has room**: `seats.get(s) < sizes.get(s)` is false for every stratum,
`overflow` never decrements, and the loop spins forever at 100% of a core.

```js
for (let i = 0; overflow > 0; i += 1) {
  const s = roomy[i % roomy.length];
  if (seats.get(s) < sizes.get(s)) { ... overflow -= 1; }   // never true
}
```

It was reachable from the day it was written and nothing reached it. L7Q sampled
138. L7V left the cohort at **exactly 20** — `size === total`, the last value
that still terminates. L7W acquired six of those twenty, took it to **14**, and
crossed the boundary. So a stage that improved coverage disabled the tool that
measures coverage, and every "the cohort script is slow" observation during this
stage was this loop: with the clamp in place the same invocation completes in
**3.4 seconds**.

The fix is two lines of intent and one of defence: a pilot cannot seat more
programmes than exist, so `size` is clamped to the cohort total; `pilotSample`
reports the clamped value rather than claiming twenty while returning fourteen;
and the overflow loop now stops if a whole pass places nothing, because a loop
whose exit depends on an invariant should not be the thing that proves it. Four
regression tests, each with a real 2-second timeout — a non-terminating loop is
not a wrong answer, and a test that only checked the answer would have passed
against the broken version by never getting one.

## Cache

The six-hour TTL is unchanged and no cache entry was deleted to force an outcome. It was visible
doing all three of its jobs in one stage:

| where | behaviour |
|---|---|
| pre-run Diagnostic V2 | `{'fresh': 53, 'fetch-failed': 5}` — pages fetched inside the window, reused |
| reference discovery | `{'fresh': 8, 'immutable': 14}` — live pins from cache, **captures served under the `web.archive.org` immutable exemption** |
| post-repair Diagnostic V2 | `{'fresh': 42, 'fetch-failed': 5}` |

The immutable exemption is what made archive discovery affordable: a capture at a fixed timestamp
cannot change, so re-reading Iowa's and New Mexico's 2025 pages across three discovery runs cost one
request each.

## Remaining debt

**1. The wider provenance problem — 641 programmes.** Reported above and deliberately untouched.
A later stage should decide whether to harden it, and the answer is not obviously yes: a historical
reference only matters where it is being measured against something, and 1,731 of 1,748 programmes
now hold a current roster and will not be re-measured. The 641 matter for *next* season's
acquisition, and the cheapest fix is at the point of capture — record the season-pinned URL at
acquisition time rather than the bare one — not a retrospective re-scrape of a closed season.

**2. The sheet-to-database divergence for six programmes.** The repaired 2025 rows live in the
roster sheet and were deliberately not imported: `importRosterSheets.js` has no key scoping, and
re-importing 2025 would rewrite two thousand programmes' closed-season rows to fix six. So for
Boston University, Drexel, Iowa, Murray State, New Mexico and Oklahoma State, the 2025 sheet now
holds a better squad than the 2025 database rows do. The database rows are the same data they always
were — this stage made them no worse — but the two artifacts disagree and something should
eventually reconcile them. The prerequisite is a key-scoped importer, which is a small, separable
change.

**3. Five programmes with no trustworthy 2025 reference.** Arkansas, Miami (FL) and Vanderbilt
publish roster pages that have never named a season, live or archived; Virginia has neither a
season-pinned URL nor a capture. For these four the *stored* references are not obviously wrong —
they carry one source URL each and plausible counts — they are merely unverifiable, and the gate
correctly declines to trust an unverifiable comparison. Arkansas has a second, independent
obstacle: its 2026 page does not name its season either, so the graduation-year admission cannot be
reached even with a perfect reference.

**4. Frostburg State.** One published squad, relabelled. Nothing to acquire until the site posts a
2026 roster.

**5. Untouched and still owed**, all deliberately out of scope here: the six
`PAGE_PRIOR_SEASON` programmes (a later re-run, nothing more), Bradley and George Mason (the
Sidearm Vue parser and query-string candidate advancement, which have to land together), Valley
Forge, the three never-fetched programmes, the registry duplicates, and Mississippi Christian.

## What this stage did not do

No threshold moved. `TURNOVER_MAX` is 0.85, `RETURNER_AGED_MIN` 0.75, `RETURNER_AGED_COUNT` 3,
`RETURNER_COMPARABLE_MIN` 4, `TRIED_MAX` 12, `CACHE_TTL_SECONDS` six hours — all as they were at
`c5a4518`. No manual "trusted" flag exists. No player bio was accepted. No third-party source became
authoritative. No institution name appears in any of the three new modules. `programme_status` is
unchanged at 6 rows and P6 is unchanged. And the acquisition architecture's diff against `c5a4518`
is empty: the only pipeline-adjacent files that moved are two coverage measurements in tests.
