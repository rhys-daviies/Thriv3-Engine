# L7ZH — fail-closed season evidence gate

**Three executable lines, one truth-table cell, nothing deleted.** A roster can
no longer be stored under a season that nothing established.

No product data moved. No acquisition ran. No historical repair. Manifest V4
`7d256f519c130dd6` and all six baselines unchanged.

Starting SHA `b17b22f` (L7ZG).

---

## The blocker

`season_ok` is three-valued and only `False` was ever a refusal:

```python
if re.search(rf'\b{season}\b|...', t): return True
for other in (season-2, season-1, nxt, season+2, season+3):
    if re.search(...): return False
return None                                  # names no season at all
```

A page that names no season cannot *contradict* the request, so the request
stood. That was never acceptance on evidence — it was acceptance on the
**absence of a contradiction**. What actually did the work was the turnover
gate below it, showing the squad was not last season's.

And that gate is guarded:

```python
if ov is not None and ov >= gate and (...):
```

`overlap` returns `None` when there is no reference roster. So in the
intersection — **an untitled page AND no prior season** — the season branch did
not fire, the sport guard did not fire, the turnover block was skipped, the
player-count bound needs `cnt25 >= 15` which a first-ever acquisition does not
have, and `evaluate` fell through to `return True` with an empty note.

L7ZG measured what that produced: a row stored under the requested season whose
recorded note was the empty string — an honest summary of what had been
checked.

**Decision owner:** `run.evaluate` in `tools/roster_pipeline/run.py`. Every
stage of the hardened runner — `run.py direct`, `variants.py`, `selector.py`,
`browse.py` — calls it before `run.build`, and `diagnose_cohort.py` calls it
too, so the diagnostic inherits any change automatically.

---

## Truth table

Nine cells, captured by running the real `evaluate` before and after. The
before/after JSON was diffed cell by cell.

| # | `season_ok` | `overlap` | before | after |
|---|---|---|---|---|
| 1 | TRUE | None | ACCEPT | **ACCEPT** |
| 2 | TRUE | low | ACCEPT | **ACCEPT** |
| 3 | TRUE | high | REFUSE *(turnover; needs aged returners)* | **REFUSE** |
| 4 | FALSE | None | REFUSE | **REFUSE** |
| 5 | FALSE | low | REFUSE | **REFUSE** |
| 6 | FALSE | high | REFUSE | **REFUSE** |
| **7** | **NONE** | **None** | **ACCEPT** *(empty note)* | **REFUSE** ← |
| 8 | NONE | low | ACCEPT | **ACCEPT** |
| 9 | NONE | high | REFUSE *(turnover)* | **REFUSE** |

```
cells byte-identical : 8 of 9
cells changed        : 1
   7. season_ok NONE / overlap None
     before: {"accepted": true,  "note": ""}
     after : {"accepted": false, "note": "season unproven: the page names no season
                                          and there is no 2025 roster to measure
                                          turnover against"}
```

Eight cells identical **including their note strings**. Cell 3's admission
logic, cell 9's turnover wording, cells 4–6's season refusal — all byte-for-byte
unchanged.

---

## Refusal semantics

A new reason was needed. The three existing classes all assert a fact that has
**not** been established here:

| class | asserts | true here? |
|---|---|---|
| `PAGE_PRIOR_SEASON` | the page named an earlier season | **no** — it named none |
| `TURNOVER_REFUSED` | the squad repeated the reference | **no** — there was no reference |
| `WRONG_ROSTER_CONTEXT` | the page is another squad | no |

Reusing any of them would send an operator to the wrong question. The note is:

```
season unproven: the page names no season and there is no 2025 roster to
measure turnover against
```

It states exactly the two absences, names neither a wrong season nor a repeated
squad, and matches none of the existing `classify()` patterns.

---

## Implementation

Placed after the sport guard — so a wrong-sport page still gets the more
specific truth — and before the turnover block, which is skipped anyway when
`ov is None`.

```diff
     said = lib.sport_contradicted(title, k.split('||')[-1])
     if said:
         return False, 'page is not this programme\'s roster (title=%r)' % said
+    if ok_season is None and ov is None:
+        return False, ('season unproven: the page names no season and there is no %d '
+                       'roster to measure turnover against' % state.REF)
     gate = TURNOVER_MAX if CURRENT else 0.93
```

**Three executable lines. Nothing deleted, nothing reordered.** Untouched:
candidate generation, parsers, domain and source authority, `season_ok`'s
three-valued contract, `overlap`, the 0.85 threshold, `aged_into_season`, the
player floor, the 2.6× bound, sheet writing, the importer, provenance and
Evidence.

---

## Safe unknown-season acceptance is preserved

The over-correction this had to avoid. `run_season_current.sh` says in its own
header that a current page *need not name its season; it must instead show a
turned-over squad*. That substitute proof is intact:

| fixture | `season_ok` | `overlap` | result |
|---|---|---|---|
| untitled, disjoint reference | NONE | 0% | **ACCEPTED** |
| untitled, half the squad returns | NONE | 50% | **ACCEPTED** |
| untitled, squad repeats | NONE | 100% | REFUSED *(turnover, unchanged wording)* |
| untitled, no reference | NONE | None | **REFUSED** *(new)* |

**One** of the two evidence paths must succeed, not both.

---

## Pipeline safety matrix

L7ZG's five probes, re-run:

| probe | result |
|---|---|
| bare route serving prior season | **REFUSED** — `page season is not 2026` |
| explicit wrong season | **REFUSED** — same |
| untitled roster (turned-over squad) | **ACCEPTED** — by design, path B |
| redirect to current (names prior season) | **REFUSED** — same |
| unknown season, **no reference** | **REFUSED** — `season unproven:` ← was ACCEPT |

Plus two from L7ZG's own set: wrong season named with no reference —
**REFUSED** (the season guard needs no reference); untitled page repeating the
reference — **REFUSED** (turnover).

**No unsafe no-evidence path remains.**

---

## The acceptance invariant

Expressed as a property against the real `evaluate`, over the product of both
evidence dimensions (4 title shapes × 4 reference shapes = 16 cases), not over
a list anyone remembered:

> A roster is accepted for season S only if **A.** `season_ok is True`, or
> **B.** `season_ok is None` **and** `overlap is not None` **and** existing
> turnover semantics permit.

```
unexplained acceptances : []          (must be empty)
accepted via path A     : > 0         (both paths must actually fire,
accepted via path B     : > 0          or the property passes vacuously)
```

**Third acceptance path: NO.** A future change that accepts anything else fails
here without a new test being written for it.

---

## Diagnostic integration

`diagnose_cohort.classify()` gained `SEASON_IDENTITY_UNPROVEN`, asked **before**
the season and turnover classes so it cannot be absorbed by either. The
docstring now names it beside the two it must not become. Operators can now
distinguish:

| | |
|---|---|
| `PAGE_PRIOR_SEASON` | the page proves an older season |
| `TURNOVER_REFUSED` | the squad proves a repeat |
| `SEASON_IDENTITY_UNPROVEN` | **neither was established** |

No UI work was required — the diagnostic propagates reasons generically.

---

## `verify_gate` relationship

**Not the same evaluator.** `verify_gate.py` imports `run.TURNOVER_MAX` and
`run.aged_into_season` and re-implements the turnover test directly; it never
calls `run.evaluate`. So it does **not** inherit the new gate.

That is structurally correct rather than a gap: `verify_gate` re-measures rows
**already stored**, working from squads rather than pages. It has no title to
ask `season_ok` about, so the new rule has nothing to apply to. The seam worth
recording is that it shares the *threshold* but not the *evaluator*, so a
future change to `evaluate`'s refusal set is not automatically reflected there.
Not redesigned — L7ZG carried that debt forward and this stage does too.

Two further acceptance seams exist **outside** the hardened runner:
`biolinks.py` / `biolinks2.py` and `fix_ncu.py` call `run.build` without
`run.evaluate`. None is invoked by `run_season_current.sh`, whose four stages
all evaluate first.

---

## Provenance

L7Z's contract holds on both accepting paths, which is the subtler half:

| fixture | accepted via | `Source Page Season` |
|---|---|---|
| titled 2026, no reference | path A | **`2026`** |
| untitled, turnover evidence | path B | **`''`** — empty, not fabricated |
| untitled, no reference | *refused* | **no row exists** |

A row accepted on turnover evidence still records an **empty** page season,
because the page did not name one. Acceptance and provenance answer different
questions, and the row must not claim the page said something it did not.

On refusal, `run.build` is never reached, so no sheet row and no `source_*`
value is created.

---

## Legacy exposure — `LEGACY_SEASON_IDENTITY_UNPROVEN`

Re-derived structurally rather than carried from L7ZG's report, and the figure
needed correcting: **L7ZG's 21 was NCAA-only**. Across all associations:

| | |
|---|---|
| programme-seasons with no prior season on file | 2,157 |
| of those, in 2022 — the earliest season held, where nothing earlier *can* exist | 1,710 *(excluded)* |
| **candidate cohort** | **447** |

| breakdown | |
|---|---|
| by season | 2023: 2 · 2024: 15 · 2025: 405 · 2026: 25 |
| by route | A explicit path 418 · B query/archive 16 · **C bare 11** · E unknown 1 · F other 1 |
| by association | NAIA 381 · NCAA D3 24 · NCAA D1 13 · NCAA D2 9 · USCAA 20 |
| by sport | men's 205 · women's 242 |
| inside the 2022–2025 Evidence window | 422 |
| outside it (2026) | 25 |

The 405 in 2025 and 381 in NAIA are largely the from-scratch NAIA build, where
no prior season existed **by construction** — that is a first acquisition, not a
defect.

### The genuinely evidence-free subset

Missing a reference is only **one** leg. The cohort where *both* legs are absent
by surviving record — no prior season **and** a route that asserts no season —
is **13**, all 2025:

| division | programmes |
|---|---|
| NAIA (11) | Abraham Baldwin Agricultural · Bethel College (Kansas) W · College of Saint Mary W · Concordia University Nebraska W · Dalton State M+W · North American University W · Soka University of America M+W · William Woods M+W |
| **NCAA D1 (2)** | **Virginia W · Wyoming W** |

**Evidence-exposed: 2** — Virginia W 2025 and Wyoming W 2025, both inside the
2022–2025 window, both readable by the philosophy family
(`PROGRAMME_POOL_BENCHMARK`, `FRESHMAN_MINUTES_LADDER`,
`PROGRAMME_DEVELOPMENT_PATTERN`, `ATHLETE_COHORT_LADDER`,
`POSITION_INTAKE_HISTORY`, `POSITION_GROUP_SIZE`, `INTERNATIONAL_ROSTER`).

**Not called corrupt, and not mutated.** Route shape is not page evidence —
L7ZG proved that when ENMU and SFSU served one page for every season route — so
418 explicit-path rows are *unmeasured*, not *clean*, and the 13 are
*unproven*, not *wrong*. L7ZG measured 0 of 206,282 historical rows carrying
`source_page_season`, so which of them actually lacked page evidence is
unknowable from surviving data. They are labelled
`LEGACY_SEASON_IDENTITY_UNPROVEN` and left for a later disposition stage.

---

## Current NCAA residual exposure

None. Re-running the diagnostic over the 16 residuals after the change:

```
16 diagnosed  (L7U/ladder-walk-evaluate/v2)
     7  PAGE_PRIOR_SEASON      digest 2222ebc2c3d4e466
     5  TURNOVER_REFUSED       digest f30707b66167d2c1
     2  PARSE_ZERO             digest 19e4f9e63f61c61c
     2  SITE_UNREACHABLE       digest ffcf612e911b4103
```

All four class digests **byte-identical** to before, and **zero**
`SEASON_IDENTITY_UNPROVEN`. L7ZH changes future ingestion, not the current
residual picture — the residuals' pages all name a season, so they were never
in the closed intersection.

---

## Containment

| artifact | before | after |
|---|---|---|
| `roster_players` | 281,159 `9281abaf1826f897` | **identical** |
| `programme_status` | 6 `4e84caabfc568577` | **identical** |
| `colleges` | 2,404 `b558769138b04ee3` | **identical** |
| `athletics_domains` | 2,723 `3a3d9871d7b3cc88` | **identical** |
| `roster_gap_reviews` | 7 `0ff82ba6889a11df` | **identical** |
| sheets / state / targets / stage files | `a00a9e3052679779` / `c65b4bcc6245a5ab` / `369a9f40cbd274cc` / `c65b4bcc6245a5ab` | **identical** |

Coverage 1,748 / 1,732 / 16 / 13 / 3 · **99.1%**. Manifest V4
`7d256f519c130dd6`, no repin. Six baselines PASS, no repin. P6 unchanged.

---

## Remaining historical disposition debt

Carried, not owned by this stage:

1. **Eastern New Mexico M 2025 and San Francisco State M 2025** —
   `PROBABLE_DUPLICATE_CAPTURE`, no trustworthy repair source, operator decision
   to leave them as documented legacy integrity debt.
2. **The 13 `LEGACY_SEASON_IDENTITY_UNPROVEN` programme-seasons**, 2 of them
   NCAA and Evidence-exposed.
3. **The wider 447-row cohort** whose turnover leg was unavailable, most of it a
   legitimate first acquisition.
4. **`verify_gate`'s scope and evaluator seams**, carried since L7ZG.

None of these was mutated. A principled quarantine/disposition mechanism is a
later stage's design problem, and it now has a measured population to design
against.
