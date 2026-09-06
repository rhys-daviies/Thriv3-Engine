# J2 — why POSITION_INTAKE_HISTORY stays OUTREACH DENIED

J1 recommended it as the strongest candidate to investigate: 640 generic pairs,
all HIGH confidence, athlete-specific by position, current window. Every one of
those facts is true. **The claim it supports is still not worth making**, and the
number that decided it is the one J1 did not measure.

## The count is the base rate

    intake count at the athlete's position group, 2,052 pairs
      min 1   p25 11   median 15   p75 19   max 60
      count >= 10 :  1,759  (86%)
      count <= 3  :      9  (0.4%)

A four-year window on a coarse position group (DEFENSE, FORWARD) counts roughly
four arrivals a year. **Every programme's answer is "about a dozen."** Medians
by division: D3 11, D1 12, D2 14. The claim does not distinguish the programme
being written to from any other programme in the country.

This is what separates it from the licensed arrival hooks.
`ARRIVAL_SAME_COUNTRY_POSITION` is informative because it is a conjunction of
two rare properties — *this country* and *this position*. Intake history keeps
the universal half and drops the rare one. What is left is arithmetic on squad
size (correlation with squad size 0.49; count/squadSize median 0.39, p25 0.29,
p75 0.48).

## Every threshold the brief proposed is inert

    policy                                eligible   generic→pers
    A  any HIGH-confidence intake             2,052            640
    B  n >= 2                                 2,051            640
    C  most recent <= 2 seasons                2,052            640
    D  n >= 2 AND recent <= 2                  2,051            640
    E  fully coach-attributed                  1,094            327
    F  n>=2 + recent + coach-attributed        1,093            327

The substance gate (n≥2) rejects **one pair of 2,052**. The recency gate rejects
**none** — 89% have a 2026 arrival. A threshold that admits 99.95% of candidates
is not a quality gate; it is a formality. Only coach attribution filters
anything (958 pairs), and it filters on data completeness, not on whether the
claim is worth making.

What the strict gate actually admits:

    Akron               FORWARD  10 forwards since 2023
    Alabama Huntsville  FORWARD  12 forwards since 2023
    Albany              FORWARD  12 forwards since 2023
    Albion              FORWARD  11 forwards since 2023
    Albright            FORWARD  11 forwards since 2023

Uniform. A coach reading any of these learns their own recruiting volume.

## Every candidate wording fails or says nothing

| form | example | verdict |
|---|---|---|
| A whole window | "the programme has taken 14 defenders since 2023" | the base rate, and closest to a tendency claim |
| B most recent | "2 defenders came into the programme in 2026" | their own class, read back |
| C freshman only | "2 defenders joined as first-years in 2026" | same, narrower |
| D named | "2026 brought in Corbin Engleman and Gunnar Guest, also a defender" | the tie to the athlete is "you sign defenders and mine is one" — true of every pairing |
| E per-intake | "defenders have come in in each of the last 4 intakes" | **a tendency claim in plain words** |

Banned vocabulary confirmed: *recruit, target, look for, typically, regularly,
often, history, pattern, tendency, need, room, opportunity, replace.* But the
wording was never the binding constraint — form B is unimpeachably factual and
still tells the coach nothing.

## The provenance will not support the stronger wording anyway

- **Entry types are mixed.** Of 31,666 supporting arrivals: 20,259 FRESHMAN,
  11,090 EXPERIENCED, 317 UNKNOWN. 1,878 of 2,052 pairs are mixed; only 159 are
  all-freshman. "Recruiting classes" and "recruited" are unsupportable.
- **Coach attribution is partial.** 25,255 ATTRIBUTED, 3,286 INHERITED, 3,125
  UNKNOWN. Only 1,094 of 2,052 pairs are fully attributed. "Since you arrived"
  is safe on barely half.

## It manufactures the exact inference we forbid

**514 of the 814 emails that render POSITION_GRADUATION today (63%) also hold
intake evidence.** Licensing it would put these two sentences in one email:

> the programme has taken 14 forwards since 2023
> …forwards are listed to graduate in 2027

Entering and leaving, at the athlete's position, in the same paragraph. No
wording rule prevents the reader completing it as *"so you'll need another"* —
and we would have assembled that conclusion for them out of two true sentences.
This is the false-corroboration failure the dedupe group was built to stop,
occurring across groups where no rule currently looks.

## Implementation gate

| # | criterion | result |
|---|---|---|
| 1 | claim is factual | **PASS** |
| 2 | wording implies no need/preference/tendency | PARTIAL — forms A and E fail; B/C/D are clean |
| 3 | sufficiently recent | **PASS** — 89% have a 2026 arrival |
| 4 | sufficiently substantial | **FAIL** — substantial to the point of meaninglessness; the gate is inert |
| 5 | coach usefulness above generic personalisation | **FAIL** — it reads a coach's own recruiting volume back at them |
| 6 | no false narrative with POSITION_GRADUATION | **FAIL** — 63% overlap |
| 7 | role clearly justified | not reachable |
| 8 | contract can fail closed | PASS (technically) |

**Three failures. POSITION_INTAKE_HISTORY remains OUTREACH DENIED.** No
permission, role, contract, copy or ordering change was made. All six baselines
PASS with the dataset UNCHANGED.

## What this tells J3

The 640 pairs are real and the gap is real — they are exactly the athletes with
no international connection to the programme (326 for one athlete, 157 each for
two others). J1 was right that this is where the coverage lives. It was wrong
about the instrument.

The lesson generalises: **coverage came from dropping the rare half of a
conjunction, and the value went with it.** A candidate that appears on 59% of
generic pairs (POSITION_GROUP_SIZE) or 26% (this one) is suspicious *because* of
its coverage — a fact that is true of nearly every programme cannot be a reason
for writing to one.

The next candidate should be judged by variance before coverage: if the answer
is the same for most programmes, it is not a reason.
