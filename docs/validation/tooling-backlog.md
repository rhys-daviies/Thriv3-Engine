# Validation-tooling backlog

Defects in the **instrument**, not in the model. Nothing here changes
production scoring, ranking behaviour or any weight. Each entry was found
during a human validation review and deliberately left unrepaired so that the
review it was found in stays reproducible.

---

## 1. `UNRECRUITABLE_IN_TOP_25` is mis-specified

**Found:** Fixture C triage (A7.7.7), confirmed from the opposite direction in
Fixture A (A7.7.9).

The flag counts `WOULD_NOT_PURSUE` classifications inside V2 ranks 1–25, but
its stated evidence path is *"tagged athlete below level or weak roster
opportunity"*. In both reviews the count fired while the athlete was **above**
the level of every programme counted — 5 of 5 in Fixture C, 15 of 15 in
Fixture A. The count and the cause do not describe the same thing, so the
flag cannot discriminate the V1 pathology it exists to catch from an operator
simply preferring stronger programmes.

**Repair:** make the trigger read the reason tags it names, or restate the
measure. Until then the flag is recorded as MIS_SPECIFIED in both reviews and
carries no adoption authority.

---

## 2. Two rating scales in one blind row

**Found:** Fixture A blind review (A7.7.8), at programme 2.

A rendered View A row shows both:

- `Programme strength 57.6` — a **0–100** scale
- `Academics: rating 2.1` — a **0–10** scale

The reviewer stated a threshold as *"anything under 8.0 programme rating is
would-not-pursue"*, which is unreadable without asking which scale is meant:
on the 0–100 scale it excludes nothing at all, and on the 0–10 reading it
excludes 36 of 42 programmes. The review had to stop and disambiguate, and
the answer decided 86% of the classifications.

**Repair:** render the two on one scale, or label each with its range in the
row. **Do not change production scoring** — programme strength is 0–100
throughout the model and the academic rating is 0–10; this is a presentation
defect in `renderPack.js`, not a scoring one.

---

## 3. The blind pack is eliciting one threshold per review

**Found:** across Fixture C (A7.7.7) and Fixture A (A7.7.9).

| pack | rows classified by a stated rule |
|---|---|
| `pack-C-ACADEMIC_FIRST-v2` | 19 of 43 — **44%** |
| `pack-A-FULLY_DECLARED_LEVEL-v2` | 36 of 42 — **86%** |

In both reviews the reviewer stated a single-dimension cut within the first
few rows and then applied it mechanically. The instrument is measuring the
distance between two one-dimensional rules rather than whether the ordering
is useful, and rank correlation against such a review is close to
uninterpretable — Fixture A returned Kendall tau-b of −0.43 for a model that
the same review agrees with on realism, budget and limited data.

**Repair:** controlled counterfactual trade-off pairs, designed around
explicit athlete preferences, in place of another full 40-row pack. **Do not
redesign the pack format yet** — the packs remain the record of what was
reviewed.

---

## 4. Open-ended top budget band

**Found:** Fixture A View B (A7.7.9). Recorded as INPUT_GAP rather than a
model defect.

The intake's highest budget band is `$40k+/yr`, which states a floor and no
ceiling. `financialViability` correctly refuses to invent one and reports the
**pessimistic end** of the viability range, so a programme costing more than
$40,000 is scored as partly unaffordable for an athlete who may have no
ceiling at all. On Fixture A this cost Penn State 0.412 and Vermont 0.224 of
financial viability while Princeton, at a published $62,688 tuition, scored
1.000 on a $6,128 net price.

The arithmetic is right and the conservatism is the safe direction. The gap
is that we never asked the question that would resolve it.

**Repair:** intake, not model — either a stated ceiling above the top band or
an explicit "no ceiling" answer.
