# V2 evidence architecture — frozen decisions

What the V2 matching engine is allowed to claim, and from what. Each rule below
was measured before it was adopted; the phase report beside it carries the
numbers. **These are frozen.** A later phase may supersede one on new evidence,
and must say so explicitly rather than drift.

| phase | status | report |
|---|---|---|
| A7.44 — unreadable positional evidence | **FROZEN** | [A7.44-report.md](A7.44-report.md) |
| A7.45 / Policy B — Playing Pathway refusal | **FROZEN** | [A7.45-report.md](A7.45-report.md) |
| A7.46 — caller contract | enforced in tests | `server/scripts/v2CallerContract.test.js` |

---

## A7.44 — unreadable positional evidence cannot become evidence of absence

1. **Programme-level position unreadability propagates.** A roster row Thriv3
   cannot place at any position is missing from *every* position bucket at that
   programme, so the doubt belongs to all of them. It is counted at the
   programme (`positionUnreadable`), kept apart from rows that *were* placed and
   whose class year could not be read (`classUnreadable`), and apart again from
   rows carrying no position at all (`positionMissing`). The three are never
   summed; `unreadable` remains their union for the diagnostics that read it.

2. **A measured zero stays distinct from an unknown.** A programme whose roster
   reads completely and holds nobody at a position has made a measurement. A
   programme that lists players it cannot place has not. Before A7.44 both
   reported `NO_ROSTER_ON_FILE`; they now carry different reasons, and
   `NO_READABLE_POSITIONS` exists because the older words were untrue — the
   roster *is* on file and its class years may be perfect.

3. **The threshold is borrowed, not minted.** `POSITION_READABLE_SHARE_FLOOR` is
   A7.37's `ZERO_CLAIM_READABLE_SHARE`; a test asserts they are the same number
   so neither can be retuned alone.

4. **No value moves.** Unplaceable players are never distributed across the four
   positions. Grade, coverage and explanation carry the doubt.

Measured: 1,695 unreadable rows over 328 of 2,060 programmes; 270 cells
scoreable → UNSCOREABLE, 87 MEASURED → PARTIAL, 107 refusal reasons corrected,
**0 numeric changes among still-scoreable cells**.

---

## A7.45 / Policy B — rotation alone cannot answer Playing Pathway

Rotation is **good evidence of a real thing**: a split-half stable measurement
(r = 0.43–0.61 within position) of how widely a programme shares minutes. It is
still computed, still explained, and travels on the refusal below. It simply
answers a different question from the one the pathway is asked.

| input | Playing Pathway |
|---|---|
| competition **and** rotation | `0.60 × competition + 0.40 × rotation`, coverage 1 |
| competition only | **scoreable, PARTIAL**, coverage 0.6 |
| rotation only | **UNSCOREABLE** — competition's reason, rotation kept in `detail` |
| neither | **UNSCOREABLE** — rotation's reason (A7.37's choice, preserved) |

The asymmetry is deliberate: competition answers the pathway's question — who
will hold this position when the athlete arrives — and rotation does not, so
losing rotation costs context while losing competition costs the subject.
Measured independence: **r = +0.174** across 7,837 cells.

### Downstream, and this is the load-bearing part

- **Opportunity requires Playing Pathway.** `coverage.combine` short-circuits at
  the missing required component, so the layer refuses outright.
- **No renormalisation.** The vacated 0.65 share is not redistributed. With a
  strong `majorFit` present the layer still refuses; `majorFit` cannot inherit
  the pathway's authority.
- **Missing evidence never becomes a zero.** No value is produced at all.
- **Pursuit requires all three layers**, so it refuses too and the programme
  becomes LIMITED_DATA rather than being ranked on two layers.

### Coverage is descriptive metadata, not a score multiplier

This is the finding that decided the phase and it holds engine-wide. A layer's
coverage is derived from component **weights**; a component's own coverage never
restrains its contribution anywhere. A component reporting coverage 1.00, 0.50,
0.17 or 0.01 contributes identically. That is `coverage.js` rule 1 working as
designed — value and coverage are never combined — and it means **a future
design that wants a restraint must use `required`, a refusal, or a floor, never
coverage.** A7.37 described the old fallback as restrained "with reduced
coverage" when the architecture guarantees coverage cannot restrain anything.

### Policy C — REJECTED

Keeping rotation at its original 0.40 weight without renormalising was tested
and rejected. It treats the unmeasured competition contribution as a zero,
capping a fallback cell at 0.400 however strong the programme — the defect
`coverage.js` names in its own header, *"the neutral-prior defect wearing the
opposite sign"*. It converts missing evidence into a low score, and displaced
further than either alternative (max 698 places against Policy A's 508 and
Policy B's 60).

Policy B was selected on evidence semantics, **not** ranking stability: it is
measurably less stable than the policy it replaces.

---

## A7.46 — the caller contract

The engine can only refuse what it is shown. Two diagnostics assembled their own
pool context, drifted from `poolContext.js`, and stopped running entirely when
the appearance columns arrived; one also held `rosterIndex` and never passed it,
which before Policy B would have scored every programme on rotation alone.

- Build a pool context with **`buildPoolContext`**. Do not hand-roll one.
- A direct `evaluateOpportunity` caller passes **`rosterIndex`, `entryYear` and
  `rosterSeason`**. Without the first there is no positional competition;
  without the second the eligibility rule cannot be read; without the third
  A7.37 cannot grade horizon depth and a PARTIAL cell reports as MEASURED.
- `rosterIndex` is **not** a runtime requirement. The function cannot tell a
  caller that forgot it from one that means it, and after Policy B a caller that
  omits it already fails loudly: every programme refuses.

Enforced mechanically by `server/scripts/v2CallerContract.test.js`.
