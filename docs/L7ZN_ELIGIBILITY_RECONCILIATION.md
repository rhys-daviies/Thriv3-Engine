# L7ZN — eligibility reconciliation

L7ZM blocked the baseline repin on the belief that the canonical corpus was
produced by code this branch does not have — specifically `shared/eligibility.js`,
300 lines introduced by commit `754a70c` in another checkout.

**The audit disproves that premise.** `projectRosterMinutes.js` does not import
`shared/eligibility.js`, and this branch already reproduces the canonical
projection **exactly**. The repin was blocked by a true fact about the commit
and a false inference about the data.

**Result: EXACT_REPRODUCTION, and the repin is performed.**

---

## Foreign commit audit — read-only

`754a70c` *"Eligibility is a rule, and the rule depends on the association"*,
parent `256cfd0`, 16 files, +847 / −289. Read from the shared object database;
the foreign worktree was never touched.

Its branch has since moved five commits on to `09d241d` *"Specify how Matchmaking
V2 is to be built"*, which is why merging the branch was never an option.

The commit is one coherent **matching-model** feature:

| file | role |
| --- | --- |
| `shared/eligibility.js` | **new**, 300 lines, rules-as-data, **zero imports** |
| `shared/classYear.js` | reads class labels, uses the offset tables |
| `shared/matching/pool.js` | applies eligibility instead of a graduation-year heuristic |
| 6 call sites | all add the same three columns — `season, division, class_year_label` — which only the new `pool.js` needs |
| `projectRosterMinutes.js` | **atomicity only** — bundled, unrelated to eligibility |
| tests | `pool.test.js`, `projectRosterMinutes.test.js` |

The six "other changed files" are a single mechanical widening:

```diff
-  SELECT college_name, player_name, position, minutes_played, …
+  SELECT college_name, player_name, position, minutes_played, …, season, division, class_year_label
```

---

## Eligibility semantics, for the record

Pure, standalone, no database access, no side effects. Exports:
`ELIGIBILITY_MODEL`, `SEASONS_REMAINING_AFTER`, `ADVANCE_ONE_CLASS`,
`ELIGIBILITY_RULES`, `UNRULED_DIVISIONS`, `eligibilityRuleFor`, `AVAILABILITY`,
`ELIGIBILITY_BASIS`, `eligibilityCeiling`, `openingSeason`, `availabilityAtEntry`.

- Two models: `NCAA_AGE_BASED_5Y` (D1 and D2 from season 2026) and
  `FOUR_SEASONS` (D3, NAIA, and every pre-2026 season). `UNKNOWN` for anything
  else — an unrecognised division never falls back to the NCAA default.
- Remaining-seasons tables by class; `GRADUATE` is 0 under both. A redshirt
  advances one class.
- `NJCAA` and `USCAA` are named as unruled rather than defaulted.
- It models the **ceiling** (may a player still be here) and explicitly refuses
  to model **retention** (will they) — no probability anywhere.
- Every rule carries a source and a verification date; D3's note warns that the
  five-year model is a 2027 *proposal*, not legislation.

It is good work. It is also **not required to read the current corpus**, because
the corpus contains nothing eligibility-derived.

---

## The projection diff — atomicity, and nothing else

```
HEAD:server/scripts/projectRosterMinutes.js  vs  754a70c:…
```

The SQL is **byte-identical**. Unchanged: selection cohort
(`season = @season AND minutes_played IS NULL AND EXISTS(prior-season match)`),
source season, `MAX(p.minutes_played)` derivation, `projected_minutes_season = @source`,
the prior-programme name normalisation and its uniqueness rule. **There is no
eligibility filtering in either version.**

The only change wraps the three write units in one transaction, so a process
dying mid-rebuild can no longer leave every 2026 row with a NULL projection —
a silently degraded matcher rather than a crash.

---

## Reproduction — EXACT

Ran this branch's projection on a disposable copy of the pre-mutation snapshot,
compared against the canonical stage snapshot:

| | |
| --- | --- |
| rows joined on `id` | 281,159 |
| **mismatched rows** | **0** |
| `prior_programme` differs | 0 |
| `projected_minutes` differs | 0 |
| `projected_minutes_season` differs | 0 |
| affected cohort | 39,430 both sides |
| NULL pattern | identical (250,140 / 242,948 / 250,140) |
| season / sport / division distributions | identical |

Re-verified **after** porting the atomicity wrapper: still 0 mismatches. The
port changes durability, not output. The foreign test file passes against it
unmodified, 5/5 — including *"cannot commit the cleared state when the rebuild
is interrupted"*.

---

## Import strategy

| option | verdict |
| --- | --- |
| A — cherry-pick `754a70c` whole | **rejected** — imports the matching-model change, which would move baselines again for reasons this stage has not audited |
| B — cherry-pick then prune | **rejected** — same content, more ways to get it wrong |
| C — port the minimal complete unit | **chosen** |
| D — merge/rebase the branch | **rejected** — its head is five commits into Matchmaking V2 |

**Ported:** the atomicity wrapper in `projectRosterMinutes.js`, and
`projectRosterMinutes.test.js` verbatim.

**Deliberately not ported:** `shared/eligibility.js`, `shared/classYear.js`,
`shared/matching/pool.js` and the six widened SELECTs. They are a matching-model
change, not a prerequisite for reading this corpus, and importing them would be
an unaudited behavioural change. They deserve their own stage.

---

## Where the baseline movement came from

Measured two corpora differing in **only** the three projection columns: the
canonical stage snapshot, and a copy of it with those columns cleared.

```
BEFORE (projection cleared)   →  digests identical to the committed pins, all six
AFTER  (canonical)            →  digests identical to the canonical measurement
```

Clearing the projection **exactly restores every pinned baseline**. The movement
is therefore wholly attributable to those three columns and to nothing else.

| baseline | pairs changed | old → new |
| --- | --- | --- |
| OUTBOUND_DECISION | 2,941 / 4,742 | `584ee4030bac43af` → `e1bb8f2f4032c63b` |
| OPERATOR_WIRE | 3,456 / 4,742 | `fe7cc83f81db23d1` → `daf48688908e2cc8` |
| LOG_PAYLOAD | 3,468 / 4,742 | `6927bca2da9d7ecf` → `009192626440119e` |
| OPERATOR_EVIDENCE | 3,468 / 4,742 | `51f95645e24c2bb3` → `72cbb26eb24896e1` |
| **EMAIL_BODY** | **0 / 4,742** | unchanged |
| **COACH_COMPOSITION** | **0 / 4,742** | unchanged |

### Operator-facing — why they moved

- **LOG_PAYLOAD**: the dominant changed fields are
  `payload.internal[].data.ladder[].{median,low,high,band,agreement,seasonsWithThisMany}`.
  Projected minutes enlarge the readable-ladder population, so the programme
  benchmark bands move. Expected, and exactly the population L7ZC corrected.
- **OPERATOR_WIRE**: `internal[].{kind,strength,tier,source,season}` — the
  internal evidence list gained entries.
- **OPERATOR_EVIDENCE**: `sections.RECRUITMENT_PATHWAY[].facts.countries[]`
  (29,170 positions), `squadSize`, and section `kind`/`qualification` — again
  list growth and the re-indexing it causes.

### Outbound decision — the one that matters

`OUTBOUND_DECISION` moved while both coach-facing surfaces held, so the question
is whether outbound behaviour changed. It did not:

```
pairs compared                     4742
pairs whose SELECTED set changed      0
newly SELECTED kinds                 {}
no-longer SELECTED kinds             {}
disposition transitions              none
```

**Not one claim changed its disposition, and not one pair changed which claim it
selects.** The digest moved because two new claim kinds enter the list and shift
every later position:

| new claim kind | pairs | enabled by |
| --- | --- | --- |
| `TRANSFER_BEHAVIOUR` | 2,895 | `prior_programme` — we now know where a player was last season |
| `POSITION_GRADUATION_STARTERS` | 340 | `projected_minutes` — starter status becomes derivable |

Both arrive `NOT_LICENSED` for outbound. This is metadata movement, not a
behavioural change.

---

## Coach-facing review

`EMAIL_BODY` and `COACH_COMPOSITION` changed on **zero pairs** — not merely the
same digest, but no pair different. Combined with zero SELECTED-set changes and
zero disposition transitions, no new projection or eligibility fact reached coach
copy. P6 licensing held: both new claim kinds are `NOT_LICENSED`.

**No unsafe coach-facing regression.**

---

## Manifest

`a433a7c149fe1628` on the stage snapshot, matching live. Version **V5**,
definition unchanged — no V6, and no corpus filesystem identity in it. Movement
remains isolated to `roster_measurements`; `roster_players` identity is
unchanged.

---

## Repin decision — PERFORMED

| # | criterion | |
| --- | --- | --- |
| 1 | movement deliberate | ✓ attributed in L7ZL-C |
| 2 | interpreting code on this branch | ✓ the corpus holds nothing eligibility-derived; the projection reproduces without it |
| 3 | projection reproducible | ✓ EXACT — 0 of 281,159 |
| 4 | movement fully attributed | ✓ clearing the projection restores every pin exactly |
| 5 | no unsafe coach-facing regression | ✓ 0 pairs, 0 SELECTED changes |
| 6 | corpus stable through reconciliation | ✓ all four hashes identical to Phase 1 |
| 7 | manifest movement understood | ✓ `roster_measurements` only |
| 8 | P6 unchanged | ✓ `P6` |

Repinned: Manifest V5 `48ff9511e307817c` → `a433a7c149fe1628`, and the four
moved baselines. The two held baselines were rewritten with identical digests.

Three **report** pins moved for the same reason and were repinned with the same
proof — on the projection-cleared corpus all three match their old pins exactly:

| report | old → new |
| --- | --- |
| `evidenceReport` | `9807e1e467664ede` → `8105bf98447a9cfe` |
| `outreachQA` | `26bea874dc995b83` → `b764de7381c41e1c` |
| `recruitingEvidenceReport` | `2b9292abd1199d47` → `922e6a0813a1b113` |

A first attempt to attribute these looked like a contradiction — clearing the
projection appeared not to restore them. That experiment was invalid:
`reports.test.js` hardcodes `DB` and overrides `RECRUITMATCH_DB`, so it can only
ever read canonical. Replicating its subprocess with a chosen corpus gave the
exact match above. The hardcoded corpus is itself an instance of the L7ZM bypass
class.

### Postcheck

All six baselines **PASS** against live canonical, manifest UNCHANGED, exit 0 —
and the same on a freshly taken snapshot. `reports.test.js` 19/19 against live.

---

## No product data changed

| table | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `recruiting_arrivals` | `1cff960c09a9693c` | `1cff960c09a9693c` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |

Trust unchanged at 15 rows / 2 RETAIN / 13 NULL / **0 EXCLUDE**.
`recruiting_arrivals` remains **LEGACY_UNVERIFIED**, 0 build records, no
production rebuild. Every projection run in this stage was on a disposable copy.

---

## Remaining governance debt, carried forward untouched

From L7ZM, deliberately not addressed here:

- 9 Python tools bypass the JavaScript resolver entirely
- 3 hardcode the absolute canonical path
- `tools/soccer/fix_scores.py` hardcodes canonical **and writes**
- and now: `reports.test.js` hardcodes its corpus, so it cannot be pointed at a
  snapshot — the same class, in the test suite
