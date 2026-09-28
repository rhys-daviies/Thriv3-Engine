# L7U — a page has an age, and a roster has an owner

Two corrections to L7T, both to the machinery that decides what to believe
about a page. No roster was acquired, no product data moved, coverage and the
manifest are untouched.

The remaining cohort re-derives to **81** clean programmes — not by relaxing
anything, but because Oklahoma State and Drexel are no longer counted as wins.

---

## Containment

Started at `3f14da9`, nothing intervening, tree clean. `programme_status` 6,
`roster_gap_reviews` 7, coverage 1,644 / 104 / 101 / 3, manifest
`6e68f353df74ff3d` under V3, six baselines PASS. Hashed before: `_targets.csv`,
`_state`, all ten roster sheets, all six stage files, and a content digest over
all 278,584 `roster_players` rows.

## Defect A — a cache with no age

`lib.fetch` is the only HTTP cache in the pipeline. It stored a body at
`~/Library/Caches/recruitmatch-rb/pages/<sha1(url)>.html`, with **no metadata at
all** — no fetch time, no status, no headers — and reused it whenever the file
existed and cleared the size floor. Forever.

So acquisition and diagnosis had *identical* semantics, and both were "any age
is fine". The browser stages (`selector.py`, `browse.py`) never shared it —
they drive Playwright and always render live — so HTTP reads were cached
indefinitely while browser reads were always fresh. The JS candidate verifier
has its own `fetch` and no cache.

L7T found what that costs. Every page it was about to acquire from had been
cached 23 days earlier, and the staleness was not academic:

| | cached | live |
|---|---|---|
| Augustana (IL) M | 28 players | **46** |
| Wisconsin-Stevens Point M | 29 | **47** |
| Carleton M | 17 | **32** |
| Virginia Wesleyan M | 13 | **30** |

And the same stale bodies made the cohort diagnostic classify **83** programmes
as "still serving last season" when their sites had published weeks earlier.

### The contract

| state | meaning |
|---|---|
| **FRESH** | inside the TTL — reuse, no request |
| **STALE** | outside it, or age unknown — revalidate before deciding anything |
| **MISS** | nothing usable on disk — fetch |

**TTL: six hours.** The boundary that matters is *this run* versus *another
day*. Within a run the same URL is asked for repeatedly — the direct stage, then
the variants ladder, then a diagnostic — and refetching each time is waste and
unkind to the host; six hours covers a full bulk run over two thousand
programmes plus a restart, and one test pins that five reads cost one request.
Across days a current-season page is a different page: rosters are published and
topped up through August and September, which is exactly the window L7T read
across. One hour would refetch thousands of pages mid-run. Twenty-four would
have let L7T's defect through at a smaller scale, which is not a fix. The TTL was
not chosen to make L7T's numbers work — it is chosen to be shorter than the
interval over which a roster page changes meaning.

**Fail closed.** If a body is stale and revalidation fails, `fetch` answers
exactly as a miss whose fetch failed: no body. The stale copy stays on disk and
stays unused. A caller deciding whether a page is the current season must not be
handed a three-week-old copy dressed as an answer — it sees no body, reports the
source unreachable, and that is true. This is the rule that makes
`PAGE_PRIOR_SEASON` impossible to reach from an old page plus a network failure.

**Metadata: a sidecar.** `<sha1>.json` holding `{url, fetched_at}`. An entry
with no sidecar is **STALE, never FRESH** — entries written before this policy
have no recorded age, and the safe reading of "age unknown" is "revalidate";
the other reading is the defect. Nothing is deleted for it and no cache was
wiped; entries simply refresh on next use. A timestamp in the future is also
stale: a clock that disagrees with the one that wrote the entry is a reason to
check, not to trust. An unreadable sidecar likewise.

**One exemption, and it is a property of the source.** A Wayback URL names a
capture timestamp, so its content cannot change; expiring it would add network
dependence and a failure mode in exchange for nothing. That is the whole
current-season/backfill distinction — not a per-caller TTL, and not a mode. Live
pages expire; captures do not.

**Clock.** `lib._now()` is the single seam. Tests replace it; nothing sleeps or
depends on wall time.

**Observability.** `CACHE_STATS` counts `fresh`, `immutable`,
`stale-refetched`, `miss-fetched`, `stale-refetch-failed` and `fetch-failed`, and
the diagnostic prints them. Freshness is auditable rather than assumed — which
is precisely what L7T shipped without.

13 tests, each against a temp cache and a local one-shot server: reuse inside
the window, reuse exactly at the edge, refetch one second past it, revalidation
replacing body and timestamp, **a stale body never served when revalidation
fails**, legacy entries, future timestamps, unreadable sidecars, the size floor,
the capture exemption, `use_cache=False`, and one request for five reads.

## Defect B — a roster with the wrong owner

### Oklahoma State: somebody else's squad

The ladder walked past Oklahoma State's own soccer roster — refused at 90%
overlap — and accepted a rung the site answered with **"2026-27 Cowgirl
Equestrian Roster"**: 90 athletes, no positions, **1%** name overlap. It passed
*because* the athletes are unrelated. An unrelated roster reads as total
turnover, and the turnover gate guards only the high-overlap direction.

**Production already owns this question**, in `sportContradicted` in
`rosterCandidatePlan.js`, whose docstring records the L7E incident it was written
for. But it guards **candidate discovery**, which never runs for a programme
that already holds a source — and the acquisition path's gate, `run.evaluate`,
had no sport check at all. The JS rule would not have caught this one either: it
refuses a title naming the *other gender's soccer* programme, and equestrian is
neither.

So the rule now lives on the path that decides acquisition, widened to the case
it missed. `lib.sport_contradicted(title, sport)` refuses a title that names the
other gender's soccer programme, or a different sport entirely, while naming
neither soccer nor the requested programme. `run.evaluate` calls it **before
turnover**, because turnover is a statement *about* a squad and is meaningless
until the squad is known to be this programme's. No signature changed: the sport
was already in the key.

`rosterContext.test.js` pins the two implementations to the same fixtures so
they cannot drift, and records that the Python side is deliberately wider.

**No minimum-overlap rule was added, and one test exists to keep it that way.**
A real roster may turn over almost completely. The fixture pair is the point: the
equestrian page and a genuine Oklahoma State soccer page with the *same* 0%
overlap, same season, same player count — the first refused, the second
accepted. A rule keyed on overlap would refuse both.

### Drexel: two rosters on one page

The accepted rung's payload declared **two** non-empty `players` containers,
24 and 24, so the read was two seasons at once and the 50% overlap looked like
ordinary turnover.

`parse_nuxt_roster` — added in L7R — already refuses a multi-container payload,
because nothing in the payload says which container belongs to the programme
asked for. The older camelCase `parse_nuxt` had no such rule. It does now: the
same rule, for the same reason, **not merged and not the largest taken**. One
test asserts both readers refuse the identical payload, so neither can be the
loose one.

### Why the fixtures are the proof

Both live pages have already changed since L7T measured them — Oklahoma State's
rung now answers with a 2016-17 equestrian *bio*, Drexel's with a 2013 player
page. A defect demonstrated against the live web stops being demonstrable the
moment a site edits a page, so both reproductions are synthetic and
network-free, and will fail if either gate is removed.

## Diagnostic V2

`L7R/ladder-walk-evaluate/v1` → **`L7U/ladder-walk-evaluate/v2`**. The version
moved because the semantics did: two new classes, and the walk now records how
many roster containers each rung declared.

```
WOULD_RESOLVE_NOW  PAGE_PRIOR_SEASON  TURNOVER_REFUSED  THIN_PARSE
PARSE_ZERO  SITE_UNREACHABLE  WRONG_ROSTER_CONTEXT  AMBIGUOUS_ROSTER
IMPLAUSIBLE_COUNT  OTHER
```

Neither new class is fixed by a rule of the diagnostic's own. `run.evaluate` now
asks whose roster a page is and `parse_nuxt` now refuses an ambiguous payload,
so the diagnostic **inherits both from the acquisition path it is supposed to be
predicting**. What v2 adds is the ability to *say* which of the two happened
instead of reporting `PARSE_ZERO` — which is how L7T came to believe the parser
was at fault for two pages that parsed perfectly well.

`WOULD_RESOLVE_NOW` now means what its name claims: the production pipeline
would accept this programme now. It never meant "a parser returned enough
names", and after L7U it cannot be read that way by accident. These remain
machine diagnostics; nothing persists them, and they are not the operator
disposition vocabulary.

18 fixtures cover both reproductions, the no-minimum-overlap guarantee, a title
naming no sport at all, prior season, parse zero, thin parse, turnover, soft
404, the single-container acceptance, and the assertion that the diagnostic sets
`WOULD_RESOLVE_NOW` in exactly one place — on the production gate's own `ok`.

## The 101, re-derived

Fresh semantics, V2 classification:

| class | L7T (stale cache, v1) | **L7U (fresh, v2)** |
|---|---|---|
| **WOULD_RESOLVE_NOW** | 83 | **81** |
| TURNOVER_REFUSED | 8 | **11** |
| PAGE_PRIOR_SEASON | 7 | **6** |
| THIN_PARSE | 0 | 0 |
| PARSE_ZERO | 2 | 2 |
| SITE_UNREACHABLE | 1 | 1 |
| WRONG_ROSTER_CONTEXT | — | 0 |
| AMBIGUOUS_ROSTER | — | 0 |
| OTHER | 0 | 0 |

Cache during diagnosis: **124 stale refetches, 6 fresh hits, 4 misses, 5 fetch
failures.** Three programmes changed class, and all three are the point:

```
Oklahoma State W   WOULD_RESOLVE_NOW  ->  TURNOVER_REFUSED
Drexel W           WOULD_RESOLVE_NOW  ->  TURNOVER_REFUSED
Boston University W  PAGE_PRIOR_SEASON -> TURNOVER_REFUSED
```

Oklahoma State and Drexel land on `TURNOVER_REFUSED` rather than
`WRONG_ROSTER_CONTEXT`/`AMBIGUOUS_ROSTER` because their *best readable* rung is
now their own soccer page, refused on turnover at 90% and 100%. The rungs that
fooled L7T now read zero: both declare two containers and the parser refuses
them. That is the honest classification — their real page is the problem, and it
is a reference-quality problem, not a parser one.

**`WRONG_ROSTER_CONTEXT` and `AMBIGUOUS_ROSTER` are 0 in the live cohort**, and
that is worth stating plainly rather than presenting empty classes as success:
the two programmes that would have populated them now refuse one rung earlier,
on ambiguity. Both classes are exercised by fixtures, not by the current web.

## The clean cohort

**81 programmes, digest `75605adf5ef677b9`**, algorithm
`L7U/ladder-walk-evaluate/v2`.

| | |
|---|---|
| division | D3 79 · D2 2 |
| gender | M 35 · W 46 |
| provider | SIDEARM 76 · PRESTO 1 · unrecorded 4 |
| parser | `sidearm-html` 76 · `table` 5 |
| source shape | `roster/<year>` 75 · `<span>/roster` 5 · `roster` 1 |
| candidate rung | **rung 0 for all 81** |
| distinct hosts | 63 |
| trusted host | 66 / 81 |
| players read | min 11, median 31, max 54, total **2,439** |

Disjoint from everything it should be: 0 overlap with the other five classes, 0
never-fetched, 0 `NOT_ACTIVE`/`FUTURE`, 0 registry duplicates, 0 already holding
a 2026 roster, 0 carrying an operator review, and neither Oklahoma State nor
Drexel present. **Not run.**

## The residual classes

**`PAGE_PRIOR_SEASON` (6)** — every one has a candidate whose path names 2026,
and every one serves an older season at it: Medgar Evers and York show 2025,
Montevallo 2025-26, SCAD 2025, and **Eastern New Mexico and San Francisco State
show 2024**. None lacks a 2026 candidate. D3 3 · D2 3; M 3 · W 3; all SIDEARM.

**`TURNOVER_REFUSED` (11)** — D1 10, ten of them women's: Arkansas, Boston
University, Drexel, Iowa, Miami (FL), Murray State, New Mexico, Oklahoma State,
Vanderbilt, Virginia, plus Frostburg State in D2. Only Frostburg is a genuine
served-back page; the rest are the historical-reference-quality debt.

**`PARSE_ZERO` (2)** — Bradley and George Mason, behind `roster.aspx`.
**`SITE_UNREACHABLE` (1)** — University of Valley Forge, host still unresolvable.

## Nothing product-side moved

`_targets.csv`, `_state/state2026.json`, all ten roster sheets and all six
stage-result files are **byte-identical**. `roster_players` 278,584 rows with an
identical content digest (`cb1a00b0…`). `programme_status` 6,
`roster_gap_reviews` 7, `colleges` 2,404 (3 inactive), `athletics_domains`
2,723. Coverage 1,748 / 1,644 / 104 / 101 / 3 at 94.0%. Manifest
`6e68f353df74ff3d` UNCHANGED, six baselines PASS, no repin, P6 unchanged.

## Remaining debt

Untouched: the Sidearm Vue parser and the George Mason / Bradley candidate
ladder; query-string source advancement; historical reference quality (the
Iowa-type mixed reference, now the largest residual class);
`build_targets.py` rewriting the worklist on import; the Trinity advisory
verifier; the `verify_gate` named-demotion API; the `verified:true` authority
cleanup; the seven registry duplicates; Mississippi Christian; the three
never-fetched programmes.

## Next stage

**Acquire the 81.** All 81 resolve at the first candidate rung on their own
hosts, the diagnostic that says so now shares the acquisition gates rather than
approximating them, freshness is bounded and auditable, and run-scope
containment was proven in production by L7T. 2,439 players, which would take
current-season coverage to roughly 98.6% of the active identity denominator.

After that the eleven `TURNOVER_REFUSED` are the substantial remainder, and they
are one problem wearing one name: the 2025 reference those programmes are
measured against is untrustworthy — bio-page captures, bare "now" pages read
across time, and Iowa's two-dialect row set. That is a reference-quality stage,
not a gate stage, and it should not be attempted by loosening the turnover gate.
