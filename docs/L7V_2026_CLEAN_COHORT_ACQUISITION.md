# L7V — eighty-one, and the boring stage it was supposed to be

**81 of 81 resolved. 2,438 rows imported. Coverage 1,644 → 1,725 of 1,748
identities — 94.0% → 98.7%.** No engineering change of any kind: the diff of the
acquisition architecture against `043c627` is empty.

The remaining historical-only cohort is **20**, and `WOULD_RESOLVE_NOW` is now
**0**. What is left is four named problems with twenty exact keys.

---

## Containment

Started at `043c627`, nothing intervening, tree clean. `programme_status` 6,
`roster_gap_reviews` 7, coverage 1,644 / 104 / 101 / 3, manifest
`6e68f353df74ff3d` under V3, six baselines PASS. Hashed before: `_targets.csv`,
`_state`, all six stage files, all ten roster sheets, and content digests over
`roster_players`, `athletics_domains`, `colleges` and `programme_status`.

## Deriving the cohort again, from nothing saved

The historical-only cohort re-derives structurally to **101**, the three
never-fetched programmes excluded by the "roster for the season before" clause.

Diagnostic V2 (`L7U/ladder-walk-evaluate/v2`) over those 101 reproduced L7U
exactly:

```
 81  WOULD_RESOLVE_NOW      digest 75605adf5ef677b9
 11  TURNOVER_REFUSED       digest 1fbd12eabf277e07
  6  PAGE_PRIOR_SEASON      digest e0950f6677785802
  2  PARSE_ZERO             digest 19e4f9e63f61c61c
  1  SITE_UNREACHABLE       digest 2869d299087060e6
cache  {'fresh': 134, 'fetch-failed': 5}
```

Every page was a **fresh** cache hit — L7U had fetched them inside the six-hour
window — so the freshness contract did its job in both directions: it refused
23-day-old bodies in L7U and it stopped this run from re-requesting 134 pages
half an hour later.

### The clean cohort

**81 programmes, digest `75605adf5ef677b9`.** Zero overlap with every other
diagnostic class, zero never-fetched, zero `NOT_ACTIVE`/`FUTURE`, zero registry
duplicates, zero already holding a 2026 roster, zero carrying an operator
review. The named exclusions:

| | class |
|---|---|
| Oklahoma State W | `TURNOVER_REFUSED` |
| Drexel W | `TURNOVER_REFUSED` |
| Boston University W | `TURNOVER_REFUSED` |
| Boston University **M** | not in the 101 at all — it already holds a 2026 roster |
| George Mason M | `PARSE_ZERO` |
| Bradley M | `PARSE_ZERO` |

| | |
|---|---|
| division | D3 79 · D2 2 |
| gender | M 35 · W 46 |
| provider | SIDEARM 76 · PRESTO 1 · unrecorded 4 |
| parser | `sidearm-html` 76 · `table` 5 |
| source shape | `roster/<year>` 75 · `<span>/roster` 5 · `roster` 1 |
| candidate rung | **rung 0 for all 81** |
| hosts | 63 distinct, 66/81 trusted |
| predicted players | min 11, median 31, max 54, total 2,439 |

### Validation before the run

Nine checks, each passing 81/81: the accepted host is the programme's own 2025
host · the candidate came from that host's ladder · sport and gender not
contradicted · the page names 2026 · at most one roster container · player floor
· turnover/currentness satisfied · a parser accepted it · no manual
intervention. `WOULD_RESOLVE_NOW` was tested against what it claims to mean, not
taken on trust.

## The run

```
TO ATTEMPT                81
run_scope == TO ATTEMPT == diagnostic clean cohort   :  True
other historical-only 0   other NCAA 0   never-fetched 0   non-NCAA 0
```

Stale-stage precheck on a temp copy first: 76 records seen, **76 refused, 0
in-scope, 0 changed keys, 0 out-of-scope changes.** None of the 81 appears in
the accumulated stage files at all.

`./run_season_current.sh 2026 2025 --keys <81>` — no manual URLs, no source or
parser override, no hand repair, no code change, no cache deletion, no forced
refresh.

**81 resolved, 0 failed.** 70 at `direct`, 11 at `variants`. 76 read by
`sidearm-html`, 5 by `table`. 2,438 players; overlap min 15%, median 60%, max
83% — **every one below the 85% gate**, so not one needed the graduation-year
admission to get through.

L7S's containment was visible at every absorb: *29, 22 and 25 out-of-scope
records refused*. L7Q's graduation-year rule kept eight high-overlap rosters
that the name gate alone would have demoted, all eight acquired in earlier
stages.

### Every success validated again, on the acquired data

The same nine checks, re-run against what the pipeline actually stored:
**81/81 on all nine, 0 failures.** The diagnostic predicted nothing production
then failed to enforce.

### No failures to analyse

Nothing failed, so the failure taxonomy is empty and no programme-status signal
arose. Recorded because "no failures" is a result, not an absence of one: the
diagnostic's claim about these 81 was correct in every case, and the live web
had not moved under it in the half hour between diagnosis and acquisition.

## Containment after

**State.** 112 keys changed since the last pre-run copy: 7 L7R's, 23 L7T's,
**81 L7V's**, and one remainder — Bentley's `tried` at 3 → 6, which is **L7R's
leak**, still at the value L7T and L7U both recorded. L7V's out-of-scope changed
keys: **0**. SMSU `failed`/12, Trinity `done`/0, Northwood `done`/0 — untouched.
Max `tried` across all 2,138 keys is 12, exactly `TRIED_MAX`. No key created.

**Stage files.** Five of six byte-identical; `state_variants_2026.json` grew
29 → 40 records (+11, all L7V keys). Every pre-existing record retained.

**Roster output.** NAIA, USCAA and both D1 sheets byte-identical. Exactly **81**
programmes differ in the database against the pre-run snapshot, and the set is
**identical to the clean cohort**; every one went from 0 rows, so nothing was
rewritten. The content digest of every non-cohort 2026 row is identical, no
closed season moved (218,938 both sides), and `colleges` 2,404 (3 inactive),
`programme_status` 6, `roster_gap_reviews` 7, `athletics_domains` 2,723 are
unchanged.

**Import.** 81 programmes, **+2,438 rows**, 0 changed, 0 removed.

## Coverage

| | before | after |
|---|---|---|
| active identity denominator | 1,748 | **1,748** |
| holding a 2026 roster | 1,644 | **1,725** |
| missing a 2026 roster | 104 | **23** |
| identity-level coverage | 94.0% | **98.7%** |
| historical-only cohort | 101 | **20** |
| never-fetched | 3 | **3** |

Exactly the Phase 18 projection, derived rather than aimed at.

## What is left: twenty keys, four problems

`WOULD_RESOLVE_NOW` is **0**. The residual digests are unchanged from before the
run, which is the proof that the run consumed the clean cohort and touched
nothing else.

### TURNOVER_REFUSED (11) — one problem wearing one name

| programme | overlap |
|---|---|
| Arkansas W | 89% |
| Boston University W · Drexel W · Iowa W · Miami (FL) W · Murray State W · New Mexico W · Virginia W | 100% |
| Frostburg State M | 97% |
| Oklahoma State W | 90% |
| Vanderbilt W | 96% |

Ten of the eleven are D1 women's. And the reference-quality profile explains
them in one line: **every one of the eleven has a bare "now" reference URL.
None is season-pinned.**

| | |
|---|---|
| reference is a **player bio** capture | 4 — Boston University, Drexel, Murray State, Oklahoma State |
| reference rows hold **mixed class dialects** | 5 — Boston University, Drexel, Iowa, Murray State, Oklahoma State |
| reference is a bare roster page | 7 — Arkansas, Frostburg, Iowa, Miami, New Mexico, Vanderbilt, Virginia |
| season-pinned reference | **0** |

A bare page serves whatever the site calls "now", so a 2025 row set assembled
from one across time is part 2025 and part 2026. Iowa is the worked example
found in L7R — 18 long-form rows and 10 short-form, one season apart — and it is
now shown to be five of the eleven. Frostburg State is the only one whose live
page is genuinely last season's squad served back; for the other ten the page is
fine and the thing it is being compared against is not.

**This is not a gate problem and must not be approached by loosening the gate.**
The turnover gate is refusing a comparison it cannot trust, which is correct.

### PAGE_PRIOR_SEASON (6)

CUNY Medgar Evers W (2025) · CUNY York W (2025) · Eastern New Mexico M
(**2024**) · Montevallo W (2025-26) · San Francisco State M (**2024**) · SCAD M
(2025). All six have a candidate whose path names 2026; none lacks one. The
sites simply have not published.

### PARSE_ZERO (2)

Bradley M and George Mason M, both behind `roster.aspx`, both needing the
Sidearm Vue parser *and* query-string candidate advancement together.

### SITE_UNREACHABLE (1)

University of Valley Forge W — `uvfpatriots.com` still does not resolve.

## Evidence and email

| | |
|---|---|
| pairs affected | **151** — exactly 35 men's programmes × 3 men's athletes + 46 women's × 1 |
| on a programme outside the cohort | **0** |
| generic → personalised | **9** |
| supplemented | 0 |
| rendered sentences | 2,854 → 2,863 |
| held claims | 221, unchanged |
| email bodies changed | 9 |

Every claim verified against the rows actually imported:

| pair | claim | in the data |
|---|---|---|
| QA Fixture → The Sage Colleges | one midfielder, 2027 — Lydia Reimer | exactly 1 |
| Rhys Davies / Ryan Billings → New York University | one defender, 2027 — Tim Brdaric | exactly 1 |
| Rhys Davies / Ryan Billings → Widener | **two** defenders, 2027 — Mason Baylis and Ricky Venegas Banuelos | exactly 2 |
| Shaan Anad → Albertus Magnus | one forward, 2027 — Kalonji Cowan | exactly 1 |
| Shaan Anad → Johns Hopkins | **two** forwards, 2027 — Giulian Laudisa and Dylan Ellis | exactly 2 |
| Shaan Anad → New York University | one forward, 2027 — Giulio Potenti | exactly 1 |
| Shaan Anad → SUNY Cortland | one forward, 2027 — Diego Rivera | exactly 1 |

Both plural claims name both players and the count is right.

**GOOD 9 · ACCEPTABLE 0 · WEAK 0 · BAD 0.** P6 unchanged, no copy policy touched.

## Manifest and baselines

Predicted before comparison and confirmed, including which five tables could not
move:

```
6e68f353df74ff3d  ->  2895861d5587a5c2   (V3)

roster_players     281,022 rows   (+2,438)
roster_freshness     2,053 rows   (+81)
players, colleges, coaches, athletics_domains, programme_status   unchanged
```

All six behavioural surfaces moved, EMAIL_BODY and COACH_COMPOSITION included —
legitimate here because the movement is data-driven, attributed to 151 pairs all
on cohort programmes with none outside, and the nine new emails pass QA.
Repinned after attribution; six PASS afterwards.

## Cache audit

Of the 81 accepted pages: **81 served from cache inside the TTL, 0 fetched
during the run, 0 without a sidecar.** Worst cache age at run time **0.46
hours**. Pages older than the TTL used authoritatively: **0**.

That is the contract behaving as designed in both directions on the same day:
the diagnostic fetched fresh bodies minutes earlier, and the acquisition run
reused them instead of re-requesting 81 hosts — one request per URL per run
window, which is exactly why six hours and not one.

## No engineering movement

The diff against `043c627` across `lib.py`, `run.py`, `state.py`, `variants.py`,
`selector.py`, `browse.py`, `verify_gate.py`, `build_targets.py`,
`diagnose_cohort.py`, `shared/`, `server/lib/` and `rosterCandidatePlan.js` is
**empty**. Fetch semantics, diagnostic semantics, parser, candidate, turnover,
roster-context, state absorb, programme-status, Evidence policy and email policy
are all untouched. The only committed changes are the repinned baseline and two
coverage measurements that an acquisition stage is expected to move.

4,138 tests pass across 161 files; build clean.

## Next stage

**Reference quality for the eleven.** It is now the whole remaining problem
worth engineering: ten of the eleven turnover refusals are pages that are
perfectly fine being measured against a 2025 row set that was read from a page
serving "now" — four of them from a player bio, five of them internally mixed
across two seasons. The stage should re-establish a season-pinned 2025 reference
for those programmes (archive captures at a known date, or the site's own
season-pinned URL) and then re-measure. It must not touch the 0.85 gate or the
graduation-year rule.

Then, separately and smaller: the six `PAGE_PRIOR_SEASON` are a waiting game
with a re-run, and Bradley plus George Mason need the Sidearm Vue parser and
query-string candidate advancement in one stage, because neither can be
validated without the other.
