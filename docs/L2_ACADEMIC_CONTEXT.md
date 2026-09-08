# L2 — athlete academic context

Audit and design only. No Evidence kind, permission, matching rule, copy,
policy or datum changed; all six baselines are byte-identical and the corpus is
unmoved at 1,755 / 2,987.

**Headline: collection already exists and works. The opportunity is real and
larger than L1 said. But two bounded normalisation defects reach coach-facing
copy, and one of them is the form's own placeholder.**

---

## The path, end to end

`PublicProfileFields.jsx` (free-text input, Academics section)
→ `PlayerFormSteps.jsx` form state
→ API → `players.intended_major` (TEXT, nullable)
→ `normaliseEvidenceAthlete` reads it as `intendedMajor`
→ `majorLabelFor()` in `shared/academicMajors.js` maps free text to a CIP family
→ `ACADEMIC_FIT` checks that label against `colleges.notable_majors`
→ two-vocabulary copy.

No dead or duplicate paths. `shared/academicMajors.js` is a single mapping
shared by the matcher **and** by `importNotableMajors.js`, which builds the
programme side — so athlete labels and programme labels cannot drift apart.
`operatorEvidence.js` deliberately omits the column.

## Collection experience — already good

Free text, optional, in Edit Profile → Public profile → Academics, with helper
copy naming what it unlocks ("worth filling in even though it is optional") and
worked examples. The Evidence tab carries **two** notices: one when the field is
blank, and one when the value does not resolve — the second added because
"Undeclared" previously looked identical to a working value. Clearable, single
value, no provenance or last-updated stamp.

**A previous stage already verified and improved this.** The L1 recommendation
to "build collection" is therefore wrong: there is nothing to build.

## Data profile

4 athletes · 2 populated (both "exercise science") · 2 missing · no malformed or
duplicate values. Programme side: **98.0% of men's and 98.5% of women's
programmes carry `notable_majors`.** The programme half is essentially complete.

Family coverage among programmes with data: Business 93.1%, Psychology 82.1%,
Biology 73.9%, Health Professions 73.7%, Education 59.2%, Computer Science
56.7%, Political Science 51.8%, Art & Design 49.9%, Kinesiology 46.2%,
Communications 40.9%, Criminal Justice 36.7%, Engineering 35.3%, English 15.4%,
Mathematics 6.9%.

## Matching semantics

14 CIP families keyed to College Scorecard PCIP codes. `SYNONYMS` maps free-text
phrases to a family, **longest phrase first**, matched by `String.includes`.
Returns the family label or null. Not exact-string, not fuzzy — an explicit
alias list over a family taxonomy.

## Normalisation stress test

**Correct (13):** Computer Science, comp sci, Business, Business Administration,
Finance, Exercise Science → Kinesiology, Kinesiology, Biology, Nursing → Health
Professions, Engineering, Mechanical Engineering, Psychology, Political Science,
Communications.

**Intentionally no match (correct):** Undecided, Undeclared, General Studies.
The Evidence tab warns on exactly these.

**False negatives:** `CS`, `Economics`, `Data Science`, `Sports Medicine`, and —
most importantly — **`Sport Science` and `Sports Science`**.

**Overmatch, and it renders:**

> "Shaan is looking to study **Martial Arts**, and Art & Design is among the
> programmes you list"
> "Shaan is looking to study **Liberal Arts**, and Art & Design is among the
> programmes you list"

`['art', 'Art & Design']` matches as a substring of "mart**ial art**s" and
"liber**al art**s". The sentence is not false — the programme does list Art &
Design — but the implied connection is wrong, and it reaches a coach.

**The placeholder defect.** The form's own placeholder is `"Sport Science"`, and
`majorLabelFor('Sport Science')` returns **null**. `seedEngagement.js` uses the
same value. An athlete who follows the example Thriv3 puts in front of them gets
no academic angle at all, and the Evidence tab then tells the operator the value
"doesn't match a major we can check against". The helper copy's three examples
("business", "comp sci", "exercise science") all work; the placeholder above
them does not.

## Two-vocabulary safety — holds

| athlete said | rendered |
|---|---|
| nursing | "…study Nursing, and Health Professions is among the programmes you list" |
| exercise science | "…study Exercise Science, and Kinesiology is among the programmes you list" |
| computer science | "…study Computer Science, which you offer" (collapse branch) |
| pre-med | "…study Pre-Med, and Biology is among the programmes you list" |

The athlete's own words are never replaced by the programme's taxonomy label,
and the collapse branch fires only when they are genuinely the same word.

## Is +839 real?

**L1's figure reproduces exactly** — Shaan +327, QA Fixture +512 — and it used
"exercise science" → Kinesiology, which sits at **46.2%** programme coverage,
**below the median family**. It is a conservative estimate, not an upper bound.

Across 13 realistic majors:

| | Shaan (1,169 pairs) | QA Fixture (1,235 pairs) | combined |
|---|---:|---:|---:|
| LOW (Mathematics) | +58 | +75 | **+133** |
| MEDIAN (Political Science / Communications band) | +378 | +574 | **+952** |
| HIGH (Business) | +771 | +955 | **+1,726** |
| L1's estimate | +327 | +512 | +839 |

**And the gain is the useful kind.** Of Shaan's 327 newly personalised pairs,
**327 have ACADEMIC_FIT as the sole relationship angle** — every one is a
genuine generic → personalised conversion, not an extra sentence on an email
that was already personal. A further 76 supplement an existing hook.

One caution worth recording: those 327 emails all carry the *same* clause. The
angle converts generic to personalised, but it does not diversify — a single
athlete's academic hook is one sentence repeated across hundreds of programmes.

## Recommendations

**Undecided / broad intent — option A.** Missing or undecided produces no
ACADEMIC_FIT, which is what happens today and is correct. No multi-interest
model: one primary field, and family-level matching only where the taxonomy
already supports it. Nothing to build.

**Storage — already correct.** The raw text the athlete typed is persisted and
rendered; the canonical family is derived at read time by `majorLabelFor` and
never written back. The athlete's language is not overwritten. Reuse as-is.

**Existing athletes — operator backfill plus the existing prompt.** Two
athletes, two fields. **Bulk inference is rejected** and no inference path
should be built: nothing in GPA, SAT, ACT, position, sport or school history
may imply a field of study.

**Validation states:** VALID (resolves to a family) · UNDECIDED (recognised
non-answer — "undecided", "undeclared", "general studies" — currently
indistinguishable from unsupported) · UNSUPPORTED (real subject, no family:
History, Physics, Law) · MISSING (null/blank). Today the last three collapse
into one null. That is safe — all four produce no claim — but the Evidence tab
cannot tell an athlete who answered honestly from one who typed nonsense.

## Options

| | value | risk | complexity | migration | Evidence impact | UX impact |
|---|---|---|---|---|---|---|
| **A** no change | none | leaves the overmatch and the placeholder in place | none | none | none | none |
| **B** collection only | **none — it already exists** | — | — | — | — | — |
| **C** bounded normalisation fixes + backfill | high | low | low | none | matching only, no semantics | one placeholder string |
| **D** major model redesign | low | medium | high | schema | large | large |

**Recommended: C.** B is void because L1 misread the situation: collection is
built, verified and well-signposted. What is not right is a placeholder that
does not resolve, an `art` alias that overmatches two common phrases, and a
handful of missing synonyms.

## Policy version

**No bump.** P5 stands. Fixing an alias list and a placeholder changes which
free-text strings resolve to a family; it does not change what ACADEMIC_FIT
asserts, how it qualifies, how it is selected, or how it reads. Adding
`economics` or removing the `art` substring is the same class of change as
adding a country alias, which has never bumped a version. Should L3 instead
propose changing family-matching semantics, that would need P6 — and it should
not.

## L3 gate — option C

**L3 = bounded normalisation fixes + operator backfill.** Specifically:

1. Fix the `art` overmatch so "liberal arts" and "martial arts" stop resolving
   to Art & Design.
2. Add the missing synonyms the test exposed: `sport science`, `sports science`,
   `economics`, `data science`, `sports medicine`, and `cs` as a guarded
   whole-token match.
3. Change the form placeholder to a value that actually resolves.
4. Distinguish UNDECIDED from UNSUPPORTED in the Evidence-tab notice.
5. Operator backfill of the two athletes — entered, never inferred.

Not in scope: multi-interest, schema change, family-matching semantics, any
Evidence kind, any policy bump.
