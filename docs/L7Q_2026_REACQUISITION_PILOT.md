# L7Q — can the pipeline advance what it already knows?

L7P left one number that mattered and a long list that did not: **138 NCAA
programmes hold a 2025 roster and no 2026 one**. They are not a discovery
problem. Every one of them carries a source the pipeline fetched a roster from
last season. So the question is narrow, and until this stage it was unasked:

> does the architecture that acquired these programmes in 2025 advance them to
> 2026 on its own?

L7Q asks it of twenty of them, and the answer is **yes for most, and the
remainder are four different problems rather than one**.

Result: **13 of 20 resolved (65%)**, current-season coverage **1,607 → 1,620**,
the cohort **138 → 125**, one generalisable defect found and fixed, three more
found and reported.

---

## Containment

Started at `7e9b938` with nothing intervening. `programme_status` held exactly
the approved six rows, `roster_gap_reviews` seven, the manifest read
`449e965af3cbaaa6` under V3 and all six behavioural baselines PASSed. The
acquisition state (`ee68457a…`) and target worklist (`3aac3298…`) matched the
digests L7P recorded, byte for byte.

## Coverage before

| | |
|---|---|
| raw active 2026 registry rows | 1,755 |
| known duplicate programme rows | 7 |
| legitimate active programme identities | **1,748** |
| holding a 2026 roster | 1,607 |
| missing a 2026 roster | 141 |
| identity-level current-season coverage | **91.9%** |
| historical (any season) | 1,745 — *not a 2026 number* |

1,607 + 7 + 141 = 1,755. The identity denominator is 1,748, never 1,755.

## The cohort, derived rather than listed

`server/scripts/reacquisitionCohort.js`. A programme belongs iff it is active
for the season, is a legitimate non-duplicate identity, holds **no** roster for
2026, holds one for **2025 specifically**, and carries a source the planner
agrees is an existing candidate. 138 programmes qualify.

The fourth clause is the one that earns its place. It is *"a roster for the
season before"*, not *"a roster in some season"* — and it is what removes the
three never-fetched programmes:

```
NEVER_FETCHED   Bryn Athyn / mens-soccer
NEVER_FETCHED   Bryn Athyn College of the New Church / womens-soccer
NEVER_FETCHED   New Jersey City University / womens-soccer
```

**Exactly the three unresolved cases, excluded by a fact about rosters and not
by their names.** They carry open identity and status questions, and a
re-acquisition pilot must not answer one by quietly attempting it. Because the
exclusion is structural, no later stage can lose it by renaming something.

### Audit of the 138

| | |
|---|---|
| division | D1 18 · D2 10 · **D3 110** |
| gender | M 58 · W 80 |
| 2025 players | min 9, median 30, max 58, total 4,114 |
| distinct source hosts | 109 |
| archived 2025 source | 10 |
| trusted host today | 106 / 138 |

Source shape — the form season advancement has to transform:

| count | shape |
|---|---|
| 104 | `/sports/<slug>/roster/<year>` |
| 20 | `/sports/<slug>/roster` |
| 11 | `/sports/<slug>/<year>-<yy>/roster` |
| 2 | `/roster.aspx?rp_id=<n>` |
| 1 | `/sport/<slug>/roster` |

Provider (`athletics_domains.platform`): SIDEARM 118 · PRESTO 3 · NUXT 3 ·
unrecorded 14. **The cohort is one platform with a tail**, which is why twenty
can be representative at all.

## Sampling

`shared/roster/reacquisitionPilot.js`, algorithm `L7Q/stratified-roundrobin/v1`.

A sample invites exactly one kind of dishonesty — picking the twenty most likely
to work — so selection is a pure function of the dataset and the digest proves
it. Two decisions, deliberately separate:

**Allocation.** Largest remainder over the cohort's own (division × gender)
proportions, with a floor of one seat per non-empty stratum. The floor is the
only judgement in the file and it is declared rather than hidden: pure
proportional allocation gives D1 men 0.43 of a seat and therefore none, and a
pilot that cannot speak about D1 men answers a smaller question than the one
asked. Seats: D1 M 1 · D1 W 3 · D2 M 2 · D2 W 1 · D3 M 6 · D3 W 7. **D3 stays
the largest group by construction.**

**Order.** Round-robin across (source shape × provider) groups so a stratum
cannot spend every seat on its dominant platform; within a group, ascending
`sha256(key)`, which is derived from the programme's identity and correlates
with nothing about how promising its website looks.

Nothing in either step reads a player count, a trusted-host flag, a recorded
failure reason or a candidate count. The tests assert this by decorating every
row with all four and requiring the same twenty back.

```
cohort fingerprint  10ec47d4b202a683
selection digest    db726c84bfa19295
```

The pilot spans 4 source shapes, 4 provider families and 19 distinct hosts.

## Dry plan

```
TO ATTEMPT             20
other historical-only NCAA attempted    0
never-fetched NCAA attempted            0
other NCAA attempted                    0
non-NCAA attempted                      0
excluded by scope     210  (left eligible for a future run)
```

The attempt set was proved *identical* to the pilot key set, not merely the same
size. Of the 210 excluded, 135 are NCAA: 118 remaining cohort, 3 never-fetched,
and 14 that are not current-season gaps at all — 6 excluded from the 2026
universe by `programme_status`, 7 registry duplicates whose twin holds the
roster, and Penn State Brandywine W, which already carries 2026 data under a
different acquisition route. Nothing unexplained.

## Existing source advancement

For **19 of 20**, the 2026 candidate already on the worklist is exactly what the
current `swap()` produces from the 2025 known-good URL. Existing season
advancement is coherent; none of the twenty needed discovery.

The exception is **George Mason**, whose 2025 source is
`/roster.aspx?rp_id=9088`. `swap()` has no branch for a query string, so it
falls through to appending a segment and produces
`/roster.aspx?rp_id=9088/2026` — a 404 by construction. Six of its eight ladder
rungs are malformed the same way.

Five more recorded `fetch 404` against URLs like
`/sports/msoc/2025-26/roster/2026` — a candidate form that **no longer exists**;
the worklist now holds `/sports/msoc/2026-27/roster`. L7J's finding again: a
durable failure reason froze at the attempt that produced it and is not a
classification of the programme.

## Predictions, recorded before the first request

15 `LIKELY_EXISTING_PATH`, 3 `UNCERTAIN`, 1 `LIKELY_PARSER_GAP` (Widener),
1 `LIKELY_CANDIDATE_GAP` (George Mason).

Outcome: 10 of the 15 confident predictions held. Widener, predicted a parser
gap, resolved through the browser stage. George Mason failed as predicted though
under a different class. Both `UNCERTAIN` turnover cases failed and the third
resolved. **The reasoning was better about publication timing than about
parsers**, and the two it got wrong were both cases where the page is fine and
the read of it is not.

## First pass

`./run_season_current.sh 2026 2025 --keys <pilot>` — the normal versioned
pipeline, no manual URL injection, no source, parser or domain bypass, and no
hand repairs. **12 of 20 resolved.**

| stage | resolved |
|---|---|
| selector | 4 |
| browser | 8 |

Eight failed. `verify_gate` demoted nothing, in or out of scope.

## Failure taxonomy

Analysis only. None of these is added to the operator disposition vocabulary and
none is persisted.

| group | n | programmes |
|---|---|---|
| `GATE_CANNOT_SEE_RETURNERS` | 3 | Bentley W, Vanderbilt W, Murray State W |
| `PARSER_GAP` | 2 | Iowa W, George Mason M |
| `KNOWN_SOURCE_URL_ADVANCEMENT_GAP` | 1 | George Mason M *(also parser)* |
| `SOURCE_SEASON_NOT_PUBLISHED` | 1 | Frostburg State M |
| `SITE_FAILURE` | 2 | University of Valley Forge W, Worcester State W |

Machine classes: `PARSER_FLOOR` 4, `TURNOVER_REFUSED` 2, `UNCLASSIFIED` 2.

### Publication: what the official source actually serves

Fetched and parsed with the pipeline's own `lib.parse_any`, read-only:

| programme | http | title | parsed |
|---|---|---|---|
| Frostburg State M | 200 | *2026* Men's Soccer Roster | 31 |
| Bentley W | 200 | *2026* Women's Soccer Roster | 30 |
| Murray State W | 200 | *2026* Women's Soccer Roster | 28 |
| Vanderbilt W | 200 | Soccer *2026-27* | 26 |
| Worcester State W | 200 | *2026* … Women's Soccer Roster | 32 |
| George Mason M | 200 | *2026* Men's Soccer Roster | 0 |
| Iowa W | 200 | Women's Soccer *2026-27* | 0 |
| Valley Forge W | — | DNS does not resolve | — |

**2026 published: 7. 2025 only: 0. Inaccessible: 1. Unknown: 0.** Not one
failure is "the season is not published yet". That was the hypothesis the
recorded reasons supported — 78 of the 138 said *page season is not 2026* — and
it is now false for the pilot, three weeks after those attempts. **Failing to
acquire a published roster is a different problem from a roster that does not
exist**, and the pilot's value is mostly in having established which one this is.

### Programme-status review candidates

**None.** University of Valley Forge is the only candidate and it is not one:
`uvfpatriots.com` does not resolve, but `valleyforge.edu` returns 200 and still
links to `uvfpatriots.com` as its athletics site. The institution is open and
points at a host that is down. That is a site failure, possibly a host
migration — not evidence of discontinuation, and not a status question. Nothing
was written to `programme_status` or `roster_gap_reviews`.

---

## The one fix: a gate that could not tell two things apart

The turnover gate refuses a live page repeating ≥85% of last season's names, and
its own refusal message admits what it cannot do:

> *either last season served back, or a 2026 page listing only returners*

Both are in that bucket, and the pilot put them side by side:

| | overlap | returners a year older |
|---|---|---|
| **Bentley W** — page names 2026, 4 new players | 87% | **26 of 26** |
| **Frostburg State M** — page names 2026 | 97% | **0 of 30** |

Frostburg's page is titled *2026 Men's Soccer Roster* and serves last season's
squad with every class label unchanged. Bentley's is a roster. There is no
reading of the name overlap that separates them, and the evidence that does was
in the column the gate was discarding.

**The invariant.** A returning player's **graduation year** is the same fact in
both seasons, while the label implying it must change: `So.` in 2025 and `Jr.`
in 2026 both mean 2029. A page served back keeps the label, and the implied year
slips by one. `lib.grad_for_season` already computes this and already handles
every label dialect in the corpus — `Jr.`, `Junior`, `R-Fr.`, `Graduate
Student`, `'29` — so the discriminator is a use of existing authority rather
than a new one.

**Calibration, not tuning.** Measured across the **1,872** independently
accepted 2026 rosters that have four or more comparable returners:

```
0.9–1.0  1558  ████████████████████████████████████████
0.8–0.9   199  █████
0.7–0.8    58  █
below      57
median 1.00   mean 0.95   95.8% at or above 0.75
```

The served-back page scores 0.00. The threshold sits in the empty middle rather
than beside either cluster.

**The contract** (`run.returners_aged` / `run.aged_into_season`): a page the name
gate would refuse is admitted only when it **also** names the season **and** at
least 3 of its returners, and at least 75% of the comparable ones, are exactly
one year older. Two independent readings of the same page must agree; either
alone is self-declared metadata or a coincidence. A label that cannot age — an
explicit `'29` — counts as no evidence in either direction.

**Two safety properties, both structural rather than argued:**

1. **The fix can only turn a refusal into an acceptance.** The predicate is
   reached solely on the branch that currently returns `False`, so no roster
   that passes today can change. `verify_gate` re-measured all 1,923 accepted
   rosters afterwards and demoted the same zero.
2. **The admission does not skip the later refusals.** It sets a flag and falls
   through to the implausible-count check rather than returning. Those two can
   never both fire — a page repeating 85% of an N-player squad cannot also be
   2.6N long — and the point is that the structure is right instead of something
   a reader has to reason about.

**And it is asked in both places it must be.** `verify_gate.py` exists because a
stage file is a cache that outlives the code that filled it. If the gate learned
to admit a page and that pass did not, the very next run would demote exactly
the rosters the gate had just admitted — and the demotion would look like the
stale-cache bug the file was written to catch. It calls the same function, and a
test asserts it is the same function and not a copy.

13 permanent tests, all refusals-first, network-free and sheet-free. The second
pass covered only the five failures the gate could affect; the twelve successes
were not re-run.

**Result: Bentley resolved, at the `direct` stage** — the earliest and cheapest,
which is what a gate fix should produce. Frostburg stayed refused, correctly.
Murray State (23% aged) and Vanderbilt (52%) stayed refused, conservatively:
Murray State's 2025 reference was itself captured from a Wayback snapshot of a
**player bio page**, and several of its returners appear to advance two years,
which is a contaminated reference rather than a gate failure. **The measurement
is only as good as the season it is compared against**, and for those two it is
not good enough to admit a page on.

## Output scope

| | |
|---|---|
| NAIA and USCAA sheets | **byte-identical** |
| D1 men / D1 women | 0 schools changed |
| D2 men / D2 women | Monroe (NY) · Bentley |
| D3 men | Greenville, La Roche, MCLA, Mount Union, Wesleyan (CT), Westfield State |
| D3 women | Albertus Magnus, Caltech, Lake Forest, MCLA, Widener |

13 programme rows, every one a pilot key. Import added **424 rows** — exactly
the sum of the 13 rosters — changed 0 and removed 0. Against the pre-pilot
snapshot, the content digest of every **non-pilot** 2026 row is identical, and
no non-2026 season moved (218,938 both sides). `colleges` 2,404, inactive 3,
`athletics_domains` 2,723, `programme_status` 6, `roster_gap_reviews` 7 — all
unchanged.

### One out-of-scope write, and it is a defect worth naming

`_targets.csv` changed for one non-pilot programme: **Southwest Minnesota State
M**. Its `Status` did not move, it holds no rows in any sheet, and no roster
output changed. What changed is its bounded attempt-history string.

The cause is real and generalisable: **`state.absorb()` is not run-scoped.** It
merges every entry in a stage file, and the stage files still carry Northwood W,
SMSU M and Trinity Washington W from L7I and L7N. L7J made the merge *policy*
correct; it did not make the *input selection* scoped. Northwood and Trinity
were protected by L7J's `done → failed` KEEP rule; SMSU, being failed already,
had its August attempt re-recorded.

Not fixed here — the stage allows one fix and it is spent, and bundling
unrelated fixes is what L7Q is structured to prevent. Reported below.

## Evidence and email

| | |
|---|---|
| pairs affected | **27** |
| generic → personalised | **2** |
| supplemented | 0 |
| rendered sentences | 2,846 → 2,848 |
| held claims | 221, unchanged |

27 is exactly the arithmetic: 7 men's pilot programmes × 3 men's athletes + 6
women's × 1 women's athlete. Every moved pair is a pilot programme; there is no
unexplained movement.

The two newly personalised emails, both `STRUCTURED` / `PLAYER_FIRST`:

- *QA Fixture (women's soccer) → MCLA*: "one midfielder is listed to graduate in
  2027 — Lauren Kimball". Verified: exactly one, MIDFIELD, Graduate, 2027.
- *Shaan Anad → Westfield State*: "one forward is listed to graduate in 2027 —
  Nicholas Parakilas". Verified: exactly one, FORWARD, Gr., 2027.

Both name a real player, at the athlete's own position, with the correct
graduation year, and the counting claim is exactly true.

**GOOD 2 · ACCEPTABLE 0 · WEAK 0 · BAD 0.** P6 unchanged; no copy policy touched.

## Manifest

Predicted before repinning: V3 holds; `roster_players` and `roster_freshness`
move; `players`, `colleges`, `coaches`, `athletics_domains` and
`programme_status` cannot, because nothing wrote to them. All confirmed.

```
449e965af3cbaaa6  ->  884d06a7bb3e17ac   (V3)

roster_players     277,834 rows   (+424)
roster_freshness     1,948 rows   (+13)
programme_status         6 rows   unchanged
```

All six behavioural digests moved and were repinned after the 27 moved pairs
were enumerated and attributed. Six PASS afterwards.

## Coverage after

| | before | after |
|---|---|---|
| active identity denominator | 1,748 | **1,748** |
| holding a 2026 roster | 1,607 | **1,620** |
| missing a 2026 roster | 141 | **128** |
| identity-level coverage | 91.9% | **92.7%** |
| historical (any season) | 1,745 | **1,745** |
| historical-only cohort | 138 | **125** |
| never-fetched | 3 | **3** |

The denominator did not move, because no status change was approved and none was
made. **The historical figure could not move and the current-season figure had
to** — the clearest possible statement of why L7P split them: the pilot
re-acquired 13 programmes the dataset already knew.

Resolution: **13 / 20 = 65%** (12 first pass, +1 after the fix).

| | resolved |
|---|---|
| D1 | 0 / 4 |
| D2 | 2 / 3 |
| D3 | 11 / 13 |
| men | 7 / 9 |
| women | 6 / 11 |
| SIDEARM | 8 / 11 |
| PRESTO | 2 / 2 |
| unrecorded platform | 3 / 6 |
| NUXT | 0 / 1 |

**D1 resolved nothing and D2/D3 resolved 13 of 16.** With four D1 programmes the
subgroup is too small to carry a rate, but the *mechanism* is not a small-sample
artefact: all four D1 failures are the same two problems — a page that parses to
zero on a large client-rendered site, and a high-overlap squad whose reference
season is untrustworthy — and neither appears in D2 or D3 at all.

## Gap queue now

**128 rows**, and they are not one kind of thing:

| | n |
|---|---|
| historical-only acquisition gaps | 125 |
| never-fetched | 3 |
| carrying an operator review | **0** |
| unresolved identity/status cases | 3 (the never-fetched) |

The season-aware queue is larger than the old nine because it correctly treats a
programme carried by a 2025 roster as a 2026 gap. **None of the 128 is a
programme-status question.** All seven recorded reviews are out of the queue: six
because `programme_status` removes their programme from the 2026 universe, and
Trinity Washington because L7N acquired it and it holds 13 rows.

## Scale decision: **B — fix one dominant defect, then scale**

Not A, and the reason is measurable. The pilot's failures are not a tail: they
are **4 distinct causes in 7 programmes**, and two of them have large cohort
populations.

Scaling now would spend a full run of 118 programmes to rediscover the same four
problems at scale. Fixing the dominant one first is worth roughly 30 programmes
of the cohort on its own.

| defect | pilot | cohort population | verdict |
|---|---|---|---|
| **parser returns 0 on a client-rendered page** | 2 | 8 recorded (`too few parsed` 6, `client-side` 2), plus an unknown share of the 78 whose recorded reason predates this measurement | **fix next** |
| turnover gate vs returners | 3 | ~35 recorded | **fixed in L7Q**; 1 of 3 recovered, 2 blocked by reference quality |
| contaminated 2025 reference (bio-page / archive source) | 2 | 10 archived sources | quantify before it is called a defect |
| legacy `roster.aspx?rp_id` shape has no advancement | 1 | 2 | small, bounded, real |
| site down | 2 | unknown, transient | retry, not engineering |

**Recommended next stage: the parser gap.** George Mason and Iowa both serve a
page titled 2026 that `parse_any` reads as zero players, and the browser stage
does not rescue either. It is the largest remaining cause, it is squarely an
architecture defect, and it is measurable the same way this stage measured the
gate — against pages that are known to exist.

Worcester State should simply be re-attempted: its page now parses 32 players at
65% overlap, which passes every gate. That is not engineering work.

## Defects found and NOT fixed, carried forward

1. **`state.absorb()` is not run-scoped** — a scoped run re-records stale
   attempts for programmes outside its scope. One diagnostic string moved here;
   the blast radius is larger on a run whose stage files are older.
2. **`parse_any` returns zero on some large client-rendered pages**, and the
   browser stage does not recover them. The dominant remaining cause.
3. **`swap()` and `variants.ladder()` have no branch for a query-string source**
   (`/roster.aspx?rp_id=<n>`), so they append a path segment inside the query.
4. **`build_targets.py` regenerates `_targets.csv` on import**, with no
   `if __name__ == '__main__'` guard — the same class of defect L7P met in
   JavaScript. It cost nothing here, for a good reason (below), but a diagnostic
   should not be able to rewrite the worklist.
5. **A 2025 reference captured from a bio page or an archive snapshot cannot be
   trusted for turnover measurement.** Murray State is the worked example. The
   gate compares against it regardless.

Known debt untouched as instructed: the seven registry duplicates, Mississippi
Christian, the Trinity advisory verifier, the `verify_gate` demotion API, the
`verified:true` authority cleanup.

## Unexpected findings

**The recorded reasons were wrong about the whole cohort, in a way that inverted
the stage's expected conclusion.** 78 of 138 said *page season is not 2026*,
which reads as "the sources have not published yet" and predicts that simply
waiting resolves most of them. Seven of the eight pilot failures now serve a page
titled 2026. Publication was never the constraint; reading the published page is.

**An accidental regeneration proved L7J.** Importing `build_targets.py` for a
diagnostic executed it and rewrote `_targets.csv` — and the file came back
**byte-identical**, 2,165 Status and 2,165 Notes carried forward with 0 targets
reset. The defect L7J was written to fix fired under the exact conditions that
used to destroy operational state, and destroyed nothing.

**L7J's merge precedence was load-bearing twice more.** Absorbing pass-1 stage
files during pass 2 reported `kept-success: 14` and `kept-success: 10` — the
`done → failed` KEEP rule protecting the twelve resolved programmes from their
own stale failure records. Attempt histories stayed bounded (7–9 for the pilot;
SMSU sat at `TRIED_MAX` = 12 and did not grow).

**A roster page can name the season and still be last season's**, at 97%
overlap, with every class label unchanged. The gate's comment had said this was
possible since it was written; Frostburg State is the first measured instance.
