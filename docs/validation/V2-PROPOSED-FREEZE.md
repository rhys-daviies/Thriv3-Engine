# Matchmaking V2 — PROPOSED acceptance freeze record

**PROPOSED, not adopted.** V2 is wired to no route, worker or client surface;
V1 continues to serve every production recommendation. Nothing here authorises
a merge or an integration.

Created by A8.3 on the verdict `V2_ACCEPTANCE_READY`.

## Identity

| | |
|---|---|
| engine HEAD | `449dd0c3f4b5d5705bf1af9e481135425dd54053` |
| branch | `feature/matchmaking-v2` |
| SUPPORTED corpus digest | `adf924962496cfa1fad1eefd97333edc09994c210d8c072e9e14d3d90e2d240c` |
| A8.3 acceptance artifact | `579c3b8a9b039029cbde002bf89340198055c22758534ed8150aafffdeea47c3` |
| V1 comparison baseline | `711af51da9b16e4037ef990a6c1175a3cb70a2f8` |
| season | 2026 |

Candidate G identity, by file digest:

| file | sha256 (first 16) |
|---|---|
| `shared/matching/v2/layers/recruitability.js` | `c863bd735f7337cd` |
| `shared/matching/v2/pursuitRules.js` | `8a09d6c3f94400a4` |
| `shared/matching/v2/opportunityRules.js` | `27b97499dcc103b2` |

## Frozen weights and gates

```
PURSUIT_WEIGHTS            recruitability 0.5 · financial 0.2 · opportunity 0.3
                           all three REQUIRED
VALUE_WEIGHTS              playingPathway 0.65 (required) · programmeTrajectory 0.35
PREFERENCE_WEIGHTS         majorFit 1.2 · locationFit 0.3 · athleticOutcome 0.3
                           academicStrengthFit 0.3
PURSUIT_GATES              recruitability { floor 0.05, threshold 0.25 }
                           financial      { floor 0.30, threshold 0.50 }
OPPORTUNITY_COVERAGE_FLOOR 0.35
COMPETITIVE_LEVEL_SPAN     0.35
TRAJECTORY_SATURATION      0.30
MEASURED_HORIZON_DEPTH     1
ZERO_CLAIM_READABLE_SHARE  0.5
TOP_N                      100   (an output limit, not a threshold)
GRADE                      MEASURED | PARTIAL   (ASSUMED abolished)
```

## Preference authority

Preferences move **weight shares only**. They never create, alter or remove
evidence, and never reach a layer they have no authority over. Measured across
three profiles on ten athletes: Recruitability changed in **0** cells and
Financial in **0** cells.

Only two of the six Opportunity components answer to the athlete.
`athleticOutcome` belongs to competitive-level priority and
`academicStrengthFit` to academic priority; `athletic` remains Coach
Recruitability's and is not reachable by a stated preference.

## Evidence contracts

**UNKNOWN ≠ ZERO. UNSCOREABLE ≠ BAD. PARTIAL ≠ MEASURED. NOT_APPLICABLE ≠
NON_MATCH.**

Layer coverage is derived from **weights**, never from component coverage, so a
component's own coverage never restrains its contribution. Only refusals move
rankings; the coverage floor is the one place coverage changes an outcome.

### majorFit — positive-only

| input | result |
|---|---|
| no / undecided / unplaceable major | NOT_APPLICABLE |
| major named in `notable_majors` | value 1, MEASURED, coverage 1 |
| major absent from a list that exists | **UNSCOREABLE `MAJOR_NOT_IN_PARTIAL_EVIDENCE`** |
| no list, or malformed | UNSCOREABLE `NO_PROGRAMME_MAJOR_EVIDENCE` |
| authoritative negative | **not implemented — no such evidence is held** |

`colleges.notable_majors` is built from College Scorecard PCIP **completion
shares** and names a mean of 7.55 of 14 families. It is positive-only evidence.
If an exhaustive catalogue is ever imported, a negative branch becomes
legitimate and test T11 is written to fail and say so.

### Playing Pathway

Competition 0.60 / rotation 0.40 inside the pathway. `playingPathway` is
`required` within Opportunity, so a programme with no minutes history refuses
rather than being scored on rotation alone (A7.45 Policy B). Returning
competition refuses with `NO_PLAYERS_AT_POSITION` when a roster is on file and
records nobody at the position, and with `NO_ROSTER_ON_FILE` when none is held.
A position that cannot be read never becomes a zero.

### Financial contribution

Three states: `STATED` (with an amount), `NOT_A_CONSTRAINT`,
`NEEDS_CONFIRMATION`. No aid is ever assumed. `NOT_A_CONSTRAINT` is the absence
of a limit — viability 1 — and not a large invented budget. An unanswered
contribution refuses with `NO_FAMILY_CONTRIBUTION` and is never scored 0;
because Financial is required in Pursuit, such an athlete receives no ranking
at all.

### Eligibility

Rules as data in `shared/eligibility.js`, each with a source and a verification
date. A division with no rule is `UNKNOWN` and is never defaulted to the NCAA
model.

## Universe

**SUPPORTED — 2,146 programmes.** NCAA D1 (213 m / 349 w), NCAA D2 (202 / 260),
NCAA D3 (317 / 423), NAIA (185 / 197). Support is *derived*: a division is
supported exactly when an eligibility rule is on file for it.

**UNSUPPORTED — 481 programmes.** NJCAA 410, USCAA 46, CCCAA 19, NWAC 4,
NCCAA 2. All LIMITED_DATA, unranked and unscored, for an absent eligibility
rule. This is an admission about Thriv3's evidence, not a judgement about those
programmes.

## Known source gaps inside the supported universe

93–144 programmes per athlete are LIMITED_DATA from missing evidence rather
than missing rules: no roster or position data (Opportunity), no arrivals
(Recruitability), no cost basis (Financial). 90 four-year programmes hold no
2026 roster. For a declared major, 539 cells cannot be settled by the major
evidence held.

Rankability runs 86.4–89.9% of the supported universe. **100% is not the
goal** — a programme with no roster on file should be LIMITED_DATA.

## Product integration requirements

1. Resolved family contribution before any ranking is presented.
2. Truthful state for unsupported associations.
3. LIMITED_DATA presented as "not enough evidence", never "bad match".
4. Full universe retained; Top 100 is the operational slice.
5. Bands, not adjacent ranks — #100 vs #101 is not a defensible difference.
6. Major evidence is positive-only; an unknown must not render as a negative.
7. A declared major visibly reshapes the list and must be removable.

## Provenance

| phase | commit | what it established |
|---|---|---|
| A8.0 | `1755c1c` | baseline `78db6413…`; preregistered S0–S15; proved 7B's staged writes inert on the supported universe |
| A8.0B | `7c255a0` | extension `77f9b5c2…`; closed the majorFit, contribution and horizon coverage gaps |
| A8.1 | `05b4732` | full tournament; found the majorFit false-negative; corrected a tie-artifact in its own instrument |
| A8.2 | `beaa532` · `a72a0f9` · `449dd0c` | evidence audit, bounded repair, validation |
| A8.3 | this phase | acceptance rerun; artifact `579c3b8a…` |

Those artifacts are immutable. A8.3 does not supersede them; they are the
record of how the one defect was found and fixed.
