# K4 — adversarial validation, and what Stage K should do next

Validation only. No production code, data, policy, taxonomy or baseline was
changed; all six baselines are byte-identical to K3C.2 and the full suite is
green. Every number below is reproducible from the commands named.

---

## The three hard questions

### 1. The 150-pair shift was never K3C's

Corpus metrics measured in clean worktrees at each commit:

| commit | | personalised | generic | REL | sentences | held |
|---|---|---:|---:|---:|---:|---:|
| `bb1248a` | H18 | 1,905 | 2,837 | 838 | 3,163 | 232 |
| `64195cb` | **K3A** | **1,755** | **2,987** | **536** | **2,842** | **221** |
| `9ff49a0` | K3B | 1,755 | 2,987 | 536 | 2,842 | 221 |
| `c438279` | K3C.1 | 1,755 | 2,987 | 536 | 2,842 | 221 |
| `20af7c2` | K3C.2 | 1,755 | 2,987 | 536 | 2,842 | 221 |

**1,905 / 2,837 is H18's figure, not K3A's.** The corpus has been 1,755 / 2,987
since well before K3A, and K3B, K3C.1 and K3C.2 changed it by nothing at all.

Bisecting every commit between H18 and K3A puts the entire move at **one
commit — `1c89bf2`, J3, "Stop opening emails with a stretch"** — and a second
much smaller one at `87c681e` (J4: sentences 2,861 → 2,842, held 232 → 221).

Pair-level diff across `1c89bf2`: **exactly 150 pairs lost personalisation, 0
gained.**

| lost kind | pairs | classification |
|---|---:|---|
| `HISTORICAL_SAME_REGION` | 144 | **LICENSING CHANGE** — J3 denied this kind outright |
| `ARRIVAL_SAME_REGION_POSITION` | 6 | **QUALIFICATION CHANGE** — J3's recency window |

All 150 are men's (the three New Zealanders); none are women's. J3's brief said
in terms: *"Quality > coverage. A drop in personalised-email percentage is
acceptable."*

**Verdict: A — an approved pre-K3C Evidence change**, compounded by **D — a
reporting error in the K3A report**, which quoted H18's personalisation counts
beside HEAD's sentence and held counts. Two runs, one table. The defect was in
my reporting, not in the engine, and nothing was repinned or patched to make it
go away.

### 2. Generated-then-denied is the existing architecture, not new noise

| | generates `POSITION_INTAKE_HISTORY` | renders it |
|---|---:|---:|
| men's, pre-P4 | **2,052** | 0 |
| women's, pre-P4 | 0 | 0 |
| men's, P4 | 2,052 | 0 |
| women's, P4 | **941** | 0 |

Men's soccer has generated this kind for 2,052 pairs and rendered it zero times
since long before P4. That is *generate the truth, licence the claim later*
working as designed — the registry refuses it with `NOT_LICENSED: "not permitted
in an outbound email"`. P4 made women's **consistent with men's**; it did not
broaden a gate.

Against the decision test: no operator noise beyond what men's has always
shown, and the operator surface exists precisely to show what the engine knows
including what it refused; one-time baseline movement, not churn; negligible
cost; the observability is labelled, not misleading; no duplicate authority;
and no conceptual violation — generation is not a claim.

**Verdict: architecturally correct. Keep, and documented here.**

### 3. The regional weak tail is real, measured, and not EUROPE-specific

Every region driven through the production path, top source country as the
athlete's own:

| region | countries | clauses | unique country pairs |
|---|---:|---:|---:|
| AFRICA | 56 | 64 | **22** |
| CARIBBEAN | 28 | 52 | 13 |
| ASIA | 32 | 49 | 13 |
| OCEANIA | 19 | 44 | **1** |
| EUROPE | 50 | 39 | 18 |
| LATIN_AMERICA | 20 | 37 | 13 |
| MIDDLE_EAST | 14 | 31 | 9 |
| UK_IRELAND | 5 | 11 | **1** |
| NORTH_AMERICA | 3 | 0 | 0 |

**AFRICA is broader than EUROPE**, by both country count and distinct
relationships. The framing "EUROPE is the problem" was too narrow.

**Strong:** OCEANIA collapses to Australia↔New Zealand (44 of 44 clauses) and
UK_IRELAND to United Kingdom↔Ireland (11 of 11). One relationship each, and
both are genuinely one recruiting world.

**Weak tail:** Spain→Sweden ×20, Spain→Norway ×11, Spain→Denmark ×6;
Japan→India ×9, Japan→Malaysia ×5; Ghana→Morocco ×4. Iberia to Scandinavia,
East Asia to South Asia, West Africa to North Africa. The sentences are true and
hedged — "the same part of the world", never a claim of proximity — but they
are thin, and they take the hook slot.

A representative one, to a Spanish defender:

> "I saw the programme has taken seven defenders from the same part of the world
> most recently in 2026, including Denmark and Germany."

Withheld, that email opens PLAYER_FIRST and reads as an honest introduction.
The hook is not adding relevance here; it is adding the impression that
something was looked up.

**The exposure today is zero.** All four production athletes are New Zealand or
United States, and **all 59 regional clauses shipping in the canonical corpus
are OCEANIA** — the strongest case in the taxonomy. The weak tail is entirely
latent and materialises on the first European, Asian or African athlete.

**Bucket verdict: ACCEPTABLE_WITH_WEAK_TAIL.** Not `NOT_CREDIBLE` — nothing is
false or misleading — and not `GOOD`.

---

## What survived the attack

- **61 women's scenarios** across NZ/OCEANIA, Ireland/UK_IRELAND,
  Norway/EUROPE, Japan/ASIA, Nigeria/AFRICA, Brazil/LATIN_AMERICA,
  Canada/NORTH_AMERICA and a secondary-position persona, over five relationship
  shapes: **0 stale-region leaks, 0 own-country leaks, 0 absence-language
  emails**, and every persona produced claims.
- **181 regional clauses** at scale: **0 span/count violations** — the class of
  bug K3C caught mid-implementation is gone — **0 missing articles** across 9
  article-country clauses, correct singular/plural throughout.
- **Presence/absence separation holds.** Women's `countryAbsence` still reports
  `reportable: false` with reason `UNVALIDATED`; `INTERNATIONAL_SHARE`,
  `INTERNATIONAL_ROSTER` and `POSITION_INTAKE_HISTORY` remain DENIED for every
  sport; a missing row produces silence, never "nobody from X".
- **`POSITION_FLOW_HOLD` fires on the women's side** (3 of 4 candidate
  programmes, correct reason), goalkeeper and secondary-position personas
  normalise and render correctly, and the two-vocabulary academic rule holds.
- **Saved-template attack**: 7 of 7 — evidence paragraph resolves, unknown
  tokens stay literal, retired tokens fail validation, withheld evidence yields
  nothing, and **a template cannot reconstruct refused evidence**.
- **Manifest V2 is correctly scoped**: moves on a new current-season max, moves
  for a different sport, and does **not** move for a historical season, a
  non-max row, or added roster membership at the same max — where
  `roster_players` moves instead. The two components divide the work exactly.
- **All six baselines still bite** their own layer, one mutation each.
- **58 stratified real emails**: 35 GOOD, 23 ACCEPTABLE, **0 WEAK, 0 BAD**, no
  mechanical defects of any kind.

## Data debt

`"Untied States"` — one row, `roster_players`, Stanton University, women's
2025. **CURRENTLY QUARANTINED**: zero rows in `recruiting_arrivals`,
`regionOf()` returns null so it cannot enter a regional claim, and no athlete's
country string will ever match it. Production decides internationality from
`nationality === 'International'`, which this row does not carry. Worth noting
that K3B's own measurement used a looser "not US" test that would have counted
it — applied identically to both sports, so the conclusion stands.

## Decision

**K3D REQUIRED**, narrowly, and **not urgently**. Nothing found here is false,
misleading or incorrect; K3C's work is sound and the safety net is trustworthy.
The single open item is that the large regional buckets produce weak hooks for
athletes the roster does not yet contain — which is exactly the kind of defect
Stage K existed to find before it shipped, and exactly the kind that should not
be fixed inside a validation stage.

### K3D scope

Sub-cluster the large regional buckets so `ARRIVAL_SAME_REGION_POSITION` claims
a relationship a reader would recognise.

**In scope:** a sub-region layer beneath AFRICA (56), EUROPE (50), ASIA (32) and
CARIBBEAN (28) — for example Nordics, Iberia, Balkans, DACH; East / South /
South-East Asia; West / North / East / Southern Africa. Qualification reads the
sub-cluster where one exists and the region otherwise. OCEANIA (19),
UK_IRELAND (5), LATIN_AMERICA (20), MIDDLE_EAST (14) and NORTH_AMERICA (3) are
already tight and should be left alone.

**Out of scope:** copy wording, the article helper, licensing, the manifest,
the policy version, and any change to what counts as recent.

**Expected effect:** fewer regional clauses, each stronger. Coverage will fall
and that is the intended trade, as it was at J3. The 59 clauses shipping today
are all OCEANIA and must be **unchanged** by the work — that is the regression
test to write first.
