# L7ZV — turnover cohort validation

Study only. No threshold changed, no code changed, no acquisition, no product
data touched.

**Result: the 75% rule is empirically well-founded, and Virginia is not a case
against it. Virginia's low aged share is a measurement artefact — the programme
changed its class-label vocabulary between seasons — not evidence that its page
is current or stale. Recommended: Option D, and no threshold change.**

---

## Measurement contract

Every number below comes from the production path: `lib.parse_any` →
`run._players` (staff filtered) → `run.returners_aged` against
`state.classes25()`. No browser anchors, no ad-hoc DOM counting.

The positive cohort is read from the durable acquisition state
(`_state/state2026.json`), which stores each accepted programme's
**production-parsed rows with class labels** — so the cohort is measured on
exactly what the pipeline wrote, without refetching.

---

## Cohorts, and why they are defensible

### Positive — n = 1,966

**The circularity problem and how it is avoided.** The aged test only runs when
turnover ≥ `TURNOVER_MAX` (0.85):

```python
if ov is not None and ov >= gate and (CURRENT or ok_season is not True):
    aged_ok, why = aged_into_season(...)
```

So every programme accepted with turnover **below** 0.85 was accepted *without
the aged test ever being applied*. Their aged share is therefore **uncensored** —
an unbiased sample of how legitimate current-season pages behave.

- 2,060 programmes `done` for 2026; 2,035 carry a recorded overlap
- 2,026 have overlap < 0.85 (uncensored)
- **1,966** also clear `RETURNER_COMPARABLE_MIN` = 4 and are measurable

Excluded: the 9 accepted with overlap ≥ 0.85, which are censored at ≥ 0.75 by
construction and are reported separately below.

### Negative — n = 9

Pages whose **own title, as measured now**, names a season other than 2026 —
the source contradicts the request. 13 candidates from durable state; 2 dropped
because nothing parsed, and **2 dropped because the page now names 2026**
(Huston-Tillotson, Oakwood M): the historical failure and a fresh fetch are
different observations, and labelling those negative would have been wrong.

### Residual — n = 5

The current TURNOVER_REFUSED NCAA residuals, Virginia among them, measured as
one row each with no special-casing.

---

## Distributions

| | positive (n=1,966) | negative (n=9) |
| --- | --- | --- |
| min | 0.000 | 0.000 |
| p10 | **0.850** | 0.000 |
| p25 | 0.938 | 0.000 |
| **median** | **1.000** | **0.000** |
| p75 | 1.000 | 0.000 |
| p90 | 1.000 | 0.000 |
| max | 1.000 | 1.000 |
| mean | 0.947 | 0.111 |

Comparable returners, positives: min 4, median 17, max 43 — Virginia's 28 is
mid-range, so small-sample instability does not apply.

The two distributions are essentially bimodal at 1 and 0. **8 of 9 negatives
score exactly 0.000**: when last season's squad is served back, its labels come
back with it.

---

## Threshold table

| threshold | positives refused | negatives accepted |
| --- | --- | --- |
| 0.50 | 28 | **1** |
| 0.60 | 36 | **1** |
| 0.70 | 57 | **1** |
| 0.71 | 60 | **1** |
| **0.75** | **78** | **1** |
| 0.80 | 118 | **1** |
| 0.90 | 324 | **1** |

**False positives are constant at 1 across the entire range.** That one is
Montevallo, which scores 1.000 and therefore passes *every* threshold — so
lowering the bar would admit **zero** additional stale pages in this cohort.
Raising it would admit none fewer.

Two caveats that matter more than the table:

- The positive "refusals" are hypothetical. Those pages have turnover < 0.85 and
  are accepted by the other branch regardless; the aged test never sees them.
- 9 negatives is a small cohort, and it does not contain the historical
  "40 of 46 stale 2026 pages" that motivated the gate. Absence of false
  positives here is weak evidence about a threshold's safety in general.

---

## The finding that actually settles it

The aged test only governs **high-overlap** pages. So the population that
matters is legitimate pages with overlap ≥ 0.85 — and there are nine:

| overlap | aged | share |
| --- | --- | --- |
| 0.86 | 16/18 | 0.889 |
| 0.85 | 21/23 | 0.913 |
| 0.90 | 25/26 | 0.962 |
| 0.85–0.92 | 22/22 … 23/23 | **1.000** ×6 |

**Minimum 0.889.** Every legitimate high-overlap page comfortably clears 0.75.

And of the 78 positives below 0.75, **77 have overlap < 0.75 and not one has
overlap ≥ 0.85**:

| overlap band | positives below 0.75 |
| --- | --- |
| < 0.40 | 21 |
| 0.40–0.60 | 36 |
| 0.60–0.75 | 20 |
| 0.75–0.85 | 1 |
| **≥ 0.85** | **0** |

So across 1,975 legitimate measurements, **a low aged share and a high overlap
never co-occur**. Low aged shares belong to heavily-turned-over squads, where
few returners remain and labels are noisy — the opposite of Virginia's shape.

That is the empirical case for the gate, and it is strong.

---

## Virginia

| | |
| --- | --- |
| aged share | 20/28 = **0.7143** |
| positive percentile | **3.05th** — 60 of 1,966 legitimate pages score lower |
| negatives at or above | 1 of 9 (Montevallo, 1.000) |
| nearest positives within ±0.045 | 36, incl. Cal Poly M 0.684, New Haven M 0.684, Hawaii Hilo W 0.688, Utah Valley W 0.688, West Florida M 0.706 |
| parser | `roster-card` — n=12 positives, median 1.000, only 1 below 0.75, so no parser effect excuses it |

Read on the aged share alone, Virginia is in the legitimate tail but not outside
it. Read on the **combination** — overlap 1.00 with aged 0.714 — it is a shape
no legitimate page in the cohort exhibits.

### Why its returners "did not age"

All eight have one cause:

| player | 2025 label | 2026 label |
| --- | --- | --- |
| Reese Mattern | Junior | 3rd Year |
| Gio Canali | Redshirt Sophomore | 3rd Year |
| Faith Broering | Graduate Student | 5th Year |
| Kyndal Shuler, Hollis Mefford, Kyra Koopman, Mackenzie Mize, Natalie Cohen | Freshman ×5 | 1st Year ×5 |

**Virginia changed its class vocabulary between seasons.** Measured:

```
2025 reference : 28 of 28 NOMINAL   (Junior, Sophomore, Freshman, Redshirt Freshman)
2026 live page : 28 of 28 ORDINAL   (4th Year, 3rd Year, 2nd Year, 1st Year)
```

The comparator maps both vocabularies to a graduation year, and for most players
the mapping lands correctly — Safradin Junior→4th Year, Bradley Sophomore→3rd
Year, Hardeman Freshman→2nd Year all register as aged. **20 of 28 advance
correctly, which a stale page cannot do**: a re-served squad carries last
season's labels unchanged, which is why every clean negative scores 0.000.

The 8 that do not are where the two vocabularies disagree by construction —
redshirt eligibility class versus year of enrolment (a redshirt sophomore is a
3rd year; five freshmen who redshirted remain 1st years of eligibility while
advancing a year of enrolment).

> ## ⚠ MECHANISM RETRACTED BY L7ZW
>
> The claim that the vocabulary change depresses the score is **wrong**.
> `CLSBASE` in `lib.py` already maps both vocabularies to one base — Freshman
> and "1st Year" both resolve to 2029, Junior and "3rd Year" both to 2027 — and
> a correct cross-vocabulary step (Sophomore → 3rd Year) registers as AGED.
>
> Measured across the corpus: 24 programmes changed NOMINAL → ORDINAL and their
> aged share is **not** depressed (median 0.944, mean 0.908, 22 of 24 at or
> above 0.75; James Madison 0.917, Washington 0.933, Old Dominion 0.923).
>
> Virginia's 8 failures are **not** vocabulary artefacts: six are players listed
> at the identical resolved level a season later (FR→FR, JR→JR), one redshirt
> and one graduate case. Whether the page is current remains unproven, and the
> refusal stands. See `docs/L7ZW_CLASS_VOCABULARY_SEMANTICS.md`.

The 20 correctly-advancing returners remain a fact, and a wholly stale page
cannot produce them; but the mechanism asserted here was not the right one.

---

## Options

| | verdict |
| --- | --- |
| **A** — keep 0.75, Virginia unresolved | **safe and defensible.** The threshold sits below the 10th percentile of legitimate pages and below every legitimate high-overlap observation |
| **B** — lower `RETURNER_AGED_MIN` globally | **reject.** It would not be justified by this evidence: Virginia's problem is not that the bar is too high, it is that the comparison is invalid. Lowering it weakens the gate for every programme to fix one measurement artefact |
| **C** — second decision path on a proven cohort pattern | not supported. The "pattern" here is one programme; a cohort of one is not a pattern |
| **D** — fix a measurement condition the study proved | **recommended for a future stage.** A cross-season class-vocabulary change is detectable, cheaply and generally: the reference is 100% nominal and the live page 100% ordinal |
| **E** — other | none found |

### Recommendation

**Change nothing now. Option A holds; Option D is the future work.**

The honest statement of the defect: when the two seasons express class in
different vocabularies, `returners_aged` measures partly the vocabulary and
partly the progression, and its output is no longer a clean second opinion. The
right response is to *detect that condition* — not to lower a threshold that the
data shows is well placed.

Any such rule needs its own cohort evidence: how many programmes change
vocabulary between seasons, and does the condition ever co-occur with a genuinely
stale page. This study does not answer that, and one programme must not become
a general rule.

---

## Safety priority and foundation consequence

Avoiding stale acceptance outranks coverage, and nothing here changes that
ordering. A 98.7% foundation with sound season attribution is worth more than
100% with one page admitted on a rule built for it.

**Virginia does not block the NCAA foundation.** It is a bounded, understood,
documented ambiguity with a named cause and a named future fix. Of the other 15
residuals, none is currently recoverable with the existing safe architecture:
5 page-prior-season (the 2026 page is not published at the route), 2 soft-404
legacy routes, 3 with no trusted host or candidate, 1 connection error, and the
4 remaining turnover refusals — of which Miami (1/31 aged) and Frostburg (0/30)
match the stale signature exactly.

---

## Data immunity

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `2d694ab74f831491` | `2d694ab74f831491` |
| arrivals freshness | FRESH | FRESH |
| Manifest V6 | `cc28ee6accdb84ed` | `cc28ee6accdb84ed` |

No thresholds, no production code, no acquisition, no repin. All measurement ran
in a copied pipeline; study artefacts stayed in session scratch and are not
committed.
