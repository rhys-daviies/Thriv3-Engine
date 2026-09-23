# L7ZW — cross-season class-vocabulary semantics

Study only. Nothing implemented, nothing acquired, no product data touched.

**Result: there is no general cross-season class-vocabulary measurement problem.
The resolver already unifies the vocabularies, and the corpus confirms it. The
premise this stage was approved on came from my L7ZV write-up and was wrong.**

---

## The contract, read as executable behaviour

`lib.grad()` resolves a raw label to a graduation year through `CLSBASE`, and
that table already carries **both** vocabularies in the same rows:

```python
(r'\bsen(ior)?\b|^sr\b|\b4th\b|fourth',            'SR'),
(r'\bjun(ior)?\b|^jr\b|\b3rd\b|third',             'JR'),
(r'\bsoph|^so\b|\b2nd\b|second',                   'SO'),
(r'\bfresh|^fr\b|first[\s-]*year|^1st|first',      'FR'),
(r'\b5th\b|fifth|\b5\s*year',                      'GR'),
```

Measured:

| label | resolves to | | label | resolves to |
| --- | --- | --- | --- | --- |
| Freshman | 2029 | | 1st Year | **2029** |
| Sophomore | 2028 | | 2nd Year | **2028** |
| Junior | 2027 | | 3rd Year | **2027** |
| Senior | 2026 | | 4th Year | **2026** |
| Graduate Student | 2025 | | 5th Year | **2025** |

And a correct cross-vocabulary step is scored correctly:

```
Freshman (2025)  -> 2nd Year (2026)   AGED
Sophomore (2025) -> 3rd Year (2026)   AGED
Junior (2025)    -> 4th Year (2026)   AGED
```

There is no incompatibility to fix. `VOCABULARY_INCOMPARABLE` is an empty
category, by construction.

---

## Vocabulary in the corpus

121 distinct raw labels across the production-parsed 2026 rows. Dominant are the
nominal abbreviations — `Fr.` 14,490, `So.` 13,409, `Jr.` 12,746, `Sr.` 10,839,
`Gr.` 1,139, `Fy.` 1,112.

Study families (descriptive, never written to product data):

| family | 2026 rows |
| --- | --- |
| NOMINAL | 57,054 |
| REDSHIRT | 1,539 |
| OTHER_RESOLVED | 1,471 |
| ORDINAL | 1,382 |
| BLANK | 749 |
| MIXED_LABEL | 59 |
| UNKNOWN | 3 |

### Cross-season transitions — 2,035 programme-seasons

| transition | n |
| --- | --- |
| NOMINAL → NOMINAL | 1,951 |
| **NOMINAL → ORDINAL** | **24** |
| NOMINAL → (none parsed) | 18 |
| EXPLICIT_YEAR → none | 10 |
| none → NOMINAL | 9 |
| ORDINAL → ORDINAL | 5 |
| others | ≤5 each |

**Same family 1,961; changed 74.** Vocabulary change is rare but recurring —
1.2% of programmes for the nominal→ordinal case. It is not Virginia-only.

---

## The falsifiable test, and its answer

If vocabulary change depressed the aged score, the changed cohort would sit
lower. It does not:

| cohort | n | min | p10 | p25 | median | mean | below 0.75 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| same vocabulary | 1,929 | 0.000 | 0.850 | 0.938 | **1.000** | 0.947 | 76 (3.9%) |
| vocabulary **changed** | 37 | 0.579 | 0.882 | 0.917 | **1.000** | 0.937 | 2 (5.4%) |
| **NOMINAL → ORDINAL** | 24 | 0.579 | 0.769 | 0.889 | **0.944** | 0.908 | 2 (8.3%) |

Twenty-two of the twenty-four nominal→ordinal programmes score at or above 0.75,
eleven at or above 0.90 — James Madison 0.917, Washington 0.933, Old Dominion
0.923, Iowa 0.882, North Dakota State 0.882. The two below (Thomas Jefferson
0.579, Troy 0.625) have overlap 0.53 and 0.44, which is the low-overlap noise
pattern L7ZV already established and nothing to do with vocabulary.

**Cross-vocabulary transition does not materially depress the measurement.**

---

## Governed population

Nine observations have overlap ≥ 0.85 — the only ones the aged test actually
decides. **All nine are NOMINAL → NOMINAL**, minimum 0.889. No vocabulary-changed
programme reaches the governed population at all, except Virginia, which is
refused.

So the governed population contains **zero** cases where a vocabulary change
could have caused a refusal.

---

## Virginia, reproduced through the same machinery

28 comparable, 20 aged, 8 failed — reproduced with no institution-specific code.
Classified by **resolved level**, not by vocabulary:

| player | 2025 | 2026 | level | classification |
| --- | --- | --- | --- | --- |
| Kyndal Shuler, Hollis Mefford, Kyra Koopman, Mackenzie Mize, Natalie Cohen | Freshman ×5 | 1st Year ×5 | FR→FR | VALID_NON_PROGRESSION |
| Reese Mattern | Junior | 3rd Year | JR→JR | VALID_NON_PROGRESSION |
| Gio Canali | Redshirt Sophomore | 3rd Year | JR→JR | REDSHIRT_SEMANTICS |
| Faith Broering | Graduate Student | 5th Year | GR→GR | GRADUATE_SEMANTICS |

| category | count |
| --- | --- |
| VALID_NON_PROGRESSION | **6** |
| REDSHIRT_SEMANTICS | 1 |
| GRADUATE_SEMANTICS | 1 |
| **VOCABULARY_INCOMPARABLE** | **0** |
| PARSER/NORMALIZATION_DEFECT | 0 |
| ACTUAL_STALE_SIGNAL | 0 established |

Six of Virginia's returners are listed at **the identical class level a season
later**. That is not a vocabulary artefact; it is the measurement working. Five
freshmen remaining first-years is a plausible redshirt cohort at a programme of
that size — but plausible is not proven, and the gate asks for proof.

**My L7ZV mechanism was wrong and is retracted in place.**

---

## Stale cohort

Of the nine clean negatives, seven resolve to a URL and were measured:

| programme | transition | aged |
| --- | --- | --- |
| CUNY York, SCAD, Lourdes, Oakwood W, Trinity Christian M+W | NOMINAL → NOMINAL | **0 / 16–47** |
| Montevallo | NOMINAL → NOMINAL | 22 / 22 |

**No vocabulary change occurs on any stale page in the cohort.** With n = 7 that
is a weak safety claim and is stated as such — absence in seven observations is
not evidence of impossibility.

### Montevallo

NOMINAL→NOMINAL, every one of 22 returners advanced a full class, yet the title
reads "2025-26". A page one year ahead of our stored 2025 reference is what a
**mislabelled reference season** looks like: the reference would then hold the
2024-25 squad. That is consistent and unproven; the alternative — a correctly
labelled 2025-26 page against a correct 2025 reference — cannot produce 22/22
advancement. Left unresolved, not mutated.

---

## Counterfactual

Phase 16 asks what happens if `VOCABULARY_INCOMPARABLE` pairs are excluded from
the denominator, or counted as aged.

**The category is empty, so both counterfactuals are identities.** Virginia
stays at 20/28 = 0.714 under A, B and C alike. No positive is recovered and no
negative is made to look current, because there is nothing to reclassify.

---

## Options

| | verdict |
| --- | --- |
| **A** — no change | **recommended.** The measurement is correct; there is nothing to correct |
| **B** — exclude incomparable pairs from the denominator | **moot** — zero such pairs exist; the change would be a no-op dressed as a fix |
| **C** — map proven cross-vocabulary transitions | **already implemented** in `CLSBASE`, and verified working |
| **D** — treat vocabulary change as corroborating currency | **reject.** 24 programmes changed vocabulary while scoring normally, so it carries no discriminating signal, and presentation can change without the season changing |
| **E** — other bounded design | none found |

### Recommendation

**Option A. Implement nothing.** The class-year comparator is behaving
correctly, across both vocabularies, at corpus scale.

---

## Sample size and generality

| | |
| --- | --- |
| programmes with a vocabulary change | 74 of 2,035 (37 measurable, 24 nominal→ordinal) |
| seasons | one transition, 2025 → 2026 |
| players affected | 1,382 ordinal rows out of ~62,000 |
| governed high-overlap observations with a vocabulary change | **0** |
| known-positive aged refusals explained by vocabulary | **0** |

Rare but recurring, and **irrelevant to the gate** — which is the useful finding.

---

## Impact and foundation

No residual is resolved by this study, and none would be by any of options B–E.
Virginia remains refused on evidence rather than on a measurement defect, which
is a better position than it held after L7ZV: it is now understood rather than
merely bounded.

**FOUNDATION_COMPLETE_WITH_BOUNDED_RESIDUALS** — 1,732 of 1,755 (98.7%), with
all 16 residuals classified, none currently recoverable under the existing safe
architecture, and no unexplained recoverable programme remaining.

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

No thresholds, no `classYear` change, no production behaviour, no repin.

---

## A note on method

This is the third stage premise of mine to fail under measurement — newcomer
counts (L7ZS), the planner defect (L7ZT), and now the vocabulary mechanism. All
three followed the same shape: a plausible explanation asserted from a partial
reading, then carried into an approved brief.

The measurement rule caught this one before any code was written, and the useful
discipline was specific: **read the resolver's table before theorising about what
it cannot resolve.** `CLSBASE` answers the whole question in five lines.
