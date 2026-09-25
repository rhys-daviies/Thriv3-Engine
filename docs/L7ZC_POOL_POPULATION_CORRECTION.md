# L7ZC — Pool population correction

**One executable line changed.** `PROGRAMME_POOL_BENCHMARK` told every operator
a pool size it had not been ranked within. `comparison.poolSize` is now the
population the claim's own quantiles were taken from.

No dataset moved. No pool member, quantile, threshold, band, measurement,
permission or coach-facing byte moved. Manifest stays V4 `3854e1ec19d88c23`.

Starting SHA `e2859f9` (L7ZB).

---

## The defect

`comparison.basis` on every pool-benchmark claim reads:

> `mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025`

`comparison.poolSize` beside it did not count programmes with a readable
freshman ladder. It counted programmes with **any** historical row, before
readability had been considered at all.

| | reported | actually used | overstated by |
|---|---|---|---|
| men's soccer, rank 1 | **920** | **770** | 150 |
| women's soccer, rank 1 | **1,202** | **1,045** | 157 |

Across the canonical corpus of 4,742 athlete-programme pairs:

| | |
|---|---|
| pool-benchmark claims | 3,355 |
| claims with a mismatched `poolSize` | **3,355** (all of them) |
| minimum overstatement | 150 |
| maximum overstatement | 157 |
| median overstatement | 150 |

Every claim was wrong, and only two distinct wrong values existed, because
every claim in the corpus is a rank-1 claim: 2,310 men's (920→770) and 1,045
women's (1,202→1,045).

The basis string was already correct. That is why this survived: the sentence
named the right cohort and the number beside it counted a different one, so
nothing looked internally inconsistent unless you went to the code.

### What it was, concretely

The claim already carried the right number, one field away. From a live
OPERATOR_EVIDENCE payload before the fix:

```json
"facts": { "pool": { "n": 770, "p25": 901, "median": 1118, "p75": 1289 } },
"qualification": { "comparison": { "poolSize": 920, "band": "p25-to-median" } }
```

`770` and `920` in the same claim, describing the same comparison.

---

## Ownership, proven from code

### Where `poolSize` was constructed

One site, and only one. `shared/evidence/philosophyEvidence.js`, in
`programmePoolBenchmark`:

```js
poolSize: Number.isInteger(bench.programmes) ? bench.programmes : null,
```

`comparison` is produced in exactly one place in the whole repository
(`grep -rn "comparison: {"` returns one non-test hit) and exactly one kind
declares `requiresComparison: true`. The defect had one owner.

### Where the broader count came from

`server/lib/philosophyQueries.js`, `buildPoolBenchmarks`:

```js
const byProg = new Map();
for (const r of roster) { /* every row in SEASONS for this sport */ }
...
programmes: byProg.size,
```

`byProg` is keyed on `college_name` and filled from a query filtered on sport
and season only. Every programme with a row is in it. Nothing about
readability has happened yet.

### Where `data.pool.n` comes from, and why it *is* the quantile population

Same function, a few lines later:

```js
for (const rows of byProg.values()) {
  const ph = programmePhilosophy({ rows, coachRows: [] });
  if (ph.freshman) {                       // <- THE READABILITY FILTER
    for (const r of ph.ladder) {
      if (!ladders.has(r.rank)) ladders.set(r.rank, []);
      ladders.get(r.rank).push(r.median);
    }
  }
}
...
ladderByRank: [...ladders.entries()].sort(...).map(([rank, values]) => {
  const s = values.sort((a, b) => a - b);
  return { rank, n: s.length, p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75) };
}),
```

`n` is `s.length`. `p25`, `median` and `p75` are `quantile(s, …)`. **The same
array, on the same line.** This is not an argument that the two agree — they
cannot disagree, because there is one array and `n` is its length.

A programme reaches `ladders` only inside `if (ph.freshman)`, and
`freshmanProfile` returns a profile only where a season's freshman intake is at
least `MIN_MEASURED_SHARE` (0.5) measured. So the difference between 1,202 and
1,045 is precisely the programmes whose freshman ladder could not be read.

`programmePoolBenchmark` selects its rank from that same structure:

```js
const poolRank1 = (bench.ladderByRank ?? []).find((r) => r.rank === top.rank) ?? null;
if (!poolRank1) return null;
...
band: bandOf(top.median, poolRank1),
```

The band is `poolRank1`'s quantiles. So `poolRank1.n` is the population of the
exact comparison this claim reports, and nothing else in scope is.

---

## The semantic contract

Written into `validateComparison` in `shared/evidence/kinds.js`, where
`poolSize` is enforced, so the next kind to carry a comparison reads it.

> **`poolSize` means: the number of programmes that contributed a usable
> observation to the exact comparison this claim reports.**
>
> It does **not** mean programmes with any historical rows, programmes
> considered before readability filtering, every programme in the sport, or the
> active NCAA universe.

The rule a future kind needs from it: `poolSize` is not metadata about the
dataset, it is part of the claim. It comes from the same array as the
statistic. A broader count may be worth carrying, but it belongs in `data`
under a name that says which population it counts.

---

## The cohort, documented

Written into the `PROGRAMME_POOL_BENCHMARK` entry in the kind registry — the
nearest canonical semantic owner — as measured by L7ZA and unchanged here:

| | |
|---|---|
| sport | isolated |
| gender | isolated, carried by sport identity; no separate axis |
| seasons | historical only (2022–2025); never the squad season |
| membership | programmes whose freshman ladder `programmePhilosophy` could read |
| division | **POOLED** — a D3 programme is ranked against D1 |
| association | **POOLED** — NCAA, NAIA, NJCAA, USCAA together |
| weighting | one median per programme per rank; equal programme weight |
| self-inclusion | yes; L7ZA measured leave-one-out band impact at 0 of 1,045 |

Deliberately **no count** in the production semantics. The population is
whatever the roster data supports on the day; a number written into the
definition would be stale at the next import. `comparison.poolSize` reports it
per claim, which is the whole point of this stage.

---

## Implementation

```diff
       statistic: `ladder-rank-${top.rank}-median-minutes`,
-      poolSize: Number.isInteger(bench.programmes) ? bench.programmes : null,
+      poolSize: Number.isInteger(poolRank1.n) ? poolRank1.n : null,
```

One executable line. Everything else in the diff is the contract above, the
cohort above, and tests.

**The broader count is not lost.** `data.poolProgrammes` already carried
`bench.programmes` and still does, under a name that says what it counts. This
stage moved a number out of a field whose contract is the comparison
population; it deleted nothing.

Not changed: the basis statistic, the percentile (still deliberately null), the
band, the pool thresholds, the measurement, the claim kind, `decisionClass`,
specificity, confidence, strength, role, permission.

---

## Fixtures

`server/lib/poolPopulation.test.js` — 17 tests on a fixture built so that
having rows and being readable are different things.

| | |
|---|---|
| women's programmes with historical rows | **5** |
| of those, with a readable freshman ladder | **3** |
| `bench.programmes` | 5 |
| `ladderByRank[1].n` | 3 |
| `comparison.poolSize` reported | **3** |
| `data.poolProgrammes` | 5 |

The two excluded programmes have rank-1 minutes of **2,400** — higher than
every readable programme — so if either entered the pool it would move `p75`
off its pinned value of 1,800 and the test would say so.

Quantiles are pinned independently: `[p25, median, p75] = [600, 1200, 1800]`,
the three readable programmes' medians. A change to the quantile function or
the cohort fails there rather than shifting underneath the `poolSize`
assertions.

### Quantiles byte-identical before and after

Proven by construction rather than inspection: take the claim, substitute the
pre-L7ZC value back into `poolSize` alone, and walk both objects for every
differing JSON path.

```
differing paths === ['$.comparison.poolSize']
```

If the correction had reached the measurement, the band or a threshold, that
walk would name it.

### Multiple pools (Phase 8)

Men's is deliberately a different ratio — 4 programmes with rows, 2 readable —
so no claim can pass by reporting the other sport's number or a shared
constant:

| | rows | readable | reported |
|---|---|---|---|
| women's | 5 | 3 | 3 |
| men's | 4 | 2 | 2 |

### Programmes that never entered the quantiles (Phase 9)

Four distinct causes, each tested, each excluded from `poolSize`, none of their
rules touched:

| fixture | cause | `poolSize` effect |
|---|---|---|
| `WUNREAD` | full intake, 2 of 8 measured — below `MIN_MEASURED_SHARE` | none |
| `WNOMINUTES` | full intake, no minutes at all | none |
| `WNOFRESH` | no first-year rows — no intake to read | none |
| `WCURRENT` | rows only in the squad season | none (not even in `programmes`) |

The mechanism is pinned rather than the outcome: making `WUNREAD`'s intake
majority-measured inside a rolled-back transaction puts it in the pool and the
reported `poolSize` rises by exactly one. That is the proof the exclusion was
about the data and not about the programme — and that L7ZC relaxed no
readability rule.

### Test updated rather than added

`server/lib/poolBenchmarkSemantics.test.js` had a test titled *"poolSize counts
programmes with ANY rows, not the values the quantiles used"*, pinning the
defect as current behaviour with "not endorsed" written beside it. Its
assertions never touched `poolSize` (that fixture makes every programme
readable, so the two counts agree at 13), so it did not fail. It is retitled to
what it actually measures — that these are two quantities and not one — and
points at the new file for the corrected behaviour. A test whose title asserts
a fixed defect is worse than no test.

`shared/evidence/philosophyEvidence.test.js` DID fail, correctly: its fixture
already carried `programmes: 920` beside a rank-1 pool of 900, so it caught the
change at the one line that mattered. Now expects 900, and additionally asserts
`poolSize === data.pool.n`, `poolSize !== bench.programmes`, and
`data.poolProgrammes === 920`.

---

## Canonical diff

Every canonical athlete-programme pair, structured Evidence before and after,
walked for differing JSON paths.

**Claim level** — 3,355 claims:

```
changed JSON paths
  3355  $.comparison.poolSize
value transitions
  2310  920 -> 770
  1045  1202 -> 1045
```

**One path. Two transitions. Nothing else.**

| | |
|---|---|
| pairs affected | 3,355 of 4,742 |
| claims affected | 3,355 |
| fields changed | `comparison.poolSize`, and nothing else |
| measurement changes | 0 |
| quantile changes | 0 |
| threshold changes | 0 |
| band changes | 0 |
| qualification changes | 0 |
| ranking changes | 0 |
| decision-class changes | 0 |

---

## Surface impact

Measured, not inferred from the permission table. Each of the six baseline
surfaces was serialized for all 4,742 pairs before and after, plus
MATCHING_SUMMARY and OUTREACH built the same way.

| surface | lines differing | changed path |
|---|---|---|
| OPERATOR_EVIDENCE | **2,742** | `$.sections.DEVELOPMENT.[].qualification.comparison.poolSize` |
| OPERATOR_WIRE | 0 | — |
| LOG_PAYLOAD | 0 | — |
| MATCHING_SUMMARY | 0 (`1d8f005b82bfc903` both sides) | — |
| OUTREACH | 0 (`7d8b458065e345f0` both sides) | — |
| OUTBOUND_DECISION | 0 | — |
| COACH_COMPOSITION | 0 | — |
| EMAIL_BODY | 0 | — |

**One surface. One JSON path within it. Two value transitions** (1,878 at
920→770, 864 at 1,202→1,045).

### Two things worth naming

**OPERATOR_WIRE and LOG_PAYLOAD do not carry `comparison`.** They were expected
to move and did not. `operatorFacts.js` is the only projection that copies
`comparison.poolSize`, and it feeds OPERATOR_EVIDENCE alone. The prediction was
wrong in the safe direction, and it was measured rather than assumed.

**OUTREACH names the kind 3,355 times and still does not move.** Its result
object records `PROGRAMME_POOL_BENCHMARK` as refused — the kind is not in
`LICENSED_KINDS` — but records the refusal without the comparison. So the
OUTREACH digest is byte-identical on both sides despite mentioning the kind in
every affected pair. Worth stating because "the surface mentions the kind" and
"the surface carries the defect" are different questions, and only the second
one matters.

### Why 2,742 moved and not 3,355

The 613 claims that exist but do not reach OPERATOR_EVIDENCE are exactly the
LOW-confidence ones, withheld by the kind's `minConfidence: MEDIUM` under
`OPERATOR_EVIDENCE: QUALIFIED`:

```
claim in ev.all: 3355   reaches OPERATOR_EVIDENCE: 2742   withheld: 613
   613  HELD   conf=LOW
  2612  SHOWN  conf=HIGH
   130  SHOWN  conf=MEDIUM
```

Unchanged behaviour, the same gate on both sides. Measured because a 613-claim
gap between the claim count and the surface count is exactly the kind of thing
that should not be left as an assumption.

---

## Copy

Two sites print `poolSize`, and both now print the corrected number through the
template they already had. `src/lib/poolPopulationCopy.test.js` pins both.

**`src/lib/developmentEvidenceCopy.js`** — development panel detail:

```
- ... Compared against mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025. 920 programmes in the pool.
+ ... Compared against mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025. 770 programmes in the pool.
```

**`src/lib/evidenceProvenance.js`** — provenance drawer row:

```
- Pool size    920 programmes
+ Pool size    770 programmes
```

Same sentence, same label, same row order, one integer. The tests assert this
by substitution — `now.detail.replace('770 programmes', '920 programmes') ===
was.detail` — so rewording either site fails them. No wording was changed.

---

## Manifest

| | |
|---|---|
| before | V4 `3854e1ec19d88c23` |
| after | V4 `3854e1ec19d88c23` |
| repinned | **NO** |

L7ZC is code and semantics. No dataset row moved, so the dataset line correctly
reports `UNCHANGED` and the manifest is untouched.

---

## Baseline attribution

Predicted before running: internal operator surfaces move, coach-facing
surfaces do not.

| | |
|---|---|
| surfaces moved | OPERATOR_EVIDENCE only |
| before | `6eaf3165211bb658` |
| after | `eb1dda78195fca4f` |
| behavioural repin | **YES** — one line in `__baselines__/evidence.json` |
| manifest repin | NO |
| P6 | unchanged |

Attribution: all 2,742 differing lines differ at
`$.sections.DEVELOPMENT.[].qualification.comparison.poolSize` and at no other
path. No unrelated field moved. Corpus statistics are identical on both sides
— 1,778 personalised, 2,964 generic, 2,865 rendered sentences, 221 held claims,
RELATIONSHIP_FIRST 536, PLAYER_FIRST 4,206 — and the rendered/recorded
invariant reports no contradictions.

### Email safety

| | |
|---|---|
| EMAIL_BODY changes | **0** |
| COACH_COMPOSITION changes | **0** |
| OUTBOUND_DECISION changes | **0** |

All three digests byte-identical. No email QA required: no coach-facing byte
moved. `PROGRAMME_POOL_BENCHMARK` is `OUTREACH: DENIED` — a peer percentile,
grading a programme to its own face — and the measurement confirms the
permission was doing its job.

---

## Audit regression

`server/scripts/poolBenchmarkAudit.js` gained one read-only section. L7ZA
printed `programmes` and `ladder n` side by side and left the reader to notice
that the claim reported the first while being ranked within the second. That
made the defect visible only to someone who already knew to look. The new
section asks the question directly:

```
=== CLAIMED POPULATION vs POOL USED (L7ZC regression) ===
  mens-soccer    rank 1  reported 770   used 770   (any-rows 920)    x2310
  womens-soccer  rank 1  reported 1045  used 1045  (any-rows 1202)   x1045
  claims 3355   disagreeing 0
  => every claim reports the population its own quantiles were taken from.
```

No counts are asserted — both populations are data-dependent — and the
any-rows figure stays visible beside them so the two quantities remain
distinguishable. The rest of the audit is unchanged and reproduces L7ZA exactly:
1,202/1,045 women's, 920/770 men's, the same boundary sensitivities, the same
thresholds, the same season window, the same self-inclusion note, the same
cache behaviour.

---

## No data movement

| | before | after |
|---|---|---|
| `roster_players` | 281,148 rows `6f4eb48734bc6a3e` | identical |
| `programme_status` | 6 rows `4e84caabfc568577` | identical |
| `colleges` | 2,404 rows `b558769138b04ee3` | identical |
| `athletics_domains` | 2,723 rows `3a3d9871d7b3cc88` | identical |
| sheets | 30 files `f677654dc6ed254d` | identical |
| state | `f36e54d13a07c556` | identical |
| targets | `3acf78f6c9741101` | identical |
| stage files | `f36e54d13a07c556` | identical |

Coverage unmoved: **1,748 identities · 1,731 rostered · 17 missing · 14
historical-only · 3 never-fetched · 99.0%**.

---

## Deliberately unchanged

Pool behaviour L7ZA locked and L7ZC did not touch:

- pool construction, pool members, the quantile algorithm
  (`sorted[min(len-1, floor(q*len))]`, nearest-rank, no interpolation)
- the bands and the `median <= p25|median|p75` test
- **division pooling** and **association pooling** — the two most surprising
  lines in the cohort, both intentional
- **self-inclusion** — a programme is in its own pool; leave-one-out band
  impact measured at 0 of 1,045
- the 2022–2025 season window and the exclusion of 2026
- cache behaviour, including that the invalidation fingerprint has no sport
  filter (shares work, cannot move a value)
- Evidence permission, ranking, role, outreach licensing, email
- the readability rules that decide pool membership — `MIN_MEASURED_SHARE`,
  `MIN_COHORT_PLAYERS`, `MIN_COHORT_SEASONS` — exercised by the fixtures, not
  relaxed by them

Not implemented, per the brief: leave-one-out, division-specific or
association-specific pools, snapshot or periodic pools, new thresholds,
quantiles, ranking or Evidence kinds.

---

## Still open

**`comparison.percentile` is still null on every claim**, and that remains
correct rather than convenient. `buildPoolBenchmarks` keeps p25/median/p75 per
rank and discards the samples they came from, so the only ranking available is
which quartile a programme falls in. Writing that into a field called
`percentile` would report a bucket as a position — a programme just above p75
and the best in the country would both read as 90. An exact percentile needs
`buildPoolBenchmarks` to keep its samples, which is a change to the Philosophy
calculation and was out of scope here. L7ZC corrected what the claim says about
its population; it did not add a ranking the pool cannot support.
