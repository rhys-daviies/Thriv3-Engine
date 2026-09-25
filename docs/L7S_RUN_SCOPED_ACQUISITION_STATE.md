# L7S — a run may only change what it ran

> ## NO PROGRAMME OUTSIDE THE EXPLICIT RUN KEY SET MAY HAVE DURABLE ACQUISITION STATE CHANGED BY THAT RUN'S STAGE ABSORPTION.

That is the whole stage. No rosters were acquired, no roster data moved, and no
live state file changed.

---

## Root cause: resumability makes stage files permanent

`variants.py`, `selector.py` and `browse.py` each begin by loading their own
`--out` file before adding to it:

```python
st = json.load(open(a.out, encoding='utf-8')) if os.path.exists(a.out) else {}
```

That is deliberate and load-bearing — an interrupted stage restarts without
refetching. The consequence is that stage files **accumulate indefinitely**.
The six 2026 files hold 70 records across 23 distinct programmes, and their
provenance spans four stages:

| still in the stage files | from |
|---|---|
| Northwood W | L7I |
| Trinity Washington W | L7N |
| Southwest Minnesota State M, and all 13 L7Q resolves | L7Q |
| the seven L7R validation keys | L7R |

`absorb` took a glob and merged every key it found in it:

```python
for f in sorted(glob.glob(pattern)):
    for k, v in json.load(open(f, encoding='utf-8')).items():
        counts[merge_attempt(main, k, v)] += 1
```

**The merge policy was never the problem.** `merge_attempt` is centralised and
correct. What was wrong was the input selection: a seven-programme run fed it
records belonging to twenty-three programmes.

### Why it looked harmless once and dangerous the next time

A re-merge is *idempotent* for any key whose stale record already produces the
record it currently holds. In today's counterfactual, 16 of the 23 keys are in
exactly that state, so the leak sits latent and invisible — until a key's stale
record differs from its durable one, and then it fires.

That is precisely the difference between the two observations.

## Bentley — the dangerous form (L7R)

Bentley was `done`, holding 30 players from `bentleyfalcons.com`, and it was
**not** one of the seven programmes L7R ran. Three stale refusal records for it
sat in the accumulated stage files. Reproduced in a fixture:

```
durable   Bentley  done, url …/roster/2026, parser sidearm-html, n 30, tried [3]
stage     Bentley  failed, "roster repeats 87% of the 2025 squad (gate 85%)"
scope     the stale key included (what the unscoped code effectively did)
          -> kept-success, status stays done, tried 3 -> 4, record CHANGED
scope     Iowa only (the run that actually ran)
          -> out-of-scope 1, Bentley deep-equal, Iowa still moves
```

`status` survived only because `merge_attempt` keeps a success over an incoming
failure. **That precedence rule is correct and is unchanged here — but it is not
a containment mechanism.** Relying on it means every future lapse in stage-file
hygiene gets one free attempt at demoting a season's work.

## Southwest Minnesota State — the cosmetic form (L7Q)

SMSU was already `failed` and was not in the twenty-programme pilot. The
re-merge rediagnosed it with attempts it had already made: `status` unchanged,
`stage`, `err` and `tried` moved, and the visible symptom was its `Notes` column
in `_targets.csv`. Reproduced the same way, and blocked the same way.

The fix had to stop both. A metadata leak is still a run writing outside itself,
and it is the same defect one lucky precedence rule away from the other.

## Scope authority: one definition, already owned

`state.run_scope()` returns `{key(r) for r in attempt_targets()}` — and nothing
new decides what "this run" means.

`attempt_targets()` is `_targets.csv` narrowed by `RB_KEYS` and `RB_DIVISIONS`.
It is what `plan.py` prints as **TO ATTEMPT**, and what `run.py`,
`variants.py` and `write_out.py` already work from. A second notion of scope
built inside `state.py` is how two subtly different answers to one question get
shipped, so there isn't one.

Strictly, `run_scope()` is TO ATTEMPT **plus** any member of the declared scope
that is already `done` — `plan.py` subtracts those to report remaining work.
That difference is deliberate and is the safer direction: a programme resolved
by an early stage becomes `done` mid-run, and a later stage's absorb must still
be able to merge its own fresh record for it. Excluding done keys would make the
scope depend on *when in the run it was asked*, which is the kind of moving
definition this function exists to prevent. For a run whose `RB_KEYS` are all
failed — every run in L7Q, L7R and L7S's simulations — the two sets are
identical, and a test asserts that equality.

## The contract

```python
absorb(pattern, scope)
```

| | |
|---|---|
| `scope` | **required**, a set of exact `School\|\|Sport` keys |
| `scope=None` | **raises `TypeError`** — fails closed. The one reading it must never have is "all of them", because that reading *is* the defect |
| `scope=set()` | absorbs nothing **and writes nothing** — the state file is byte-identical and its mtime is untouched |
| out-of-scope record | skipped whole: not transformed, not recorded, not counted as an attempt, counted only as `out-of-scope` so a run can see the containment working |
| out-of-scope key absent from state | not created |
| key matching | exact string equality on the full key. Never a school or sport prefix |
| in-scope behaviour | `merge_attempt` alone, entirely unchanged |
| merge precedence | **unchanged** |
| durable state format | **unchanged** |
| `TRIED_MAX` | **unchanged** at 12 |

A run now reports its own containment:

```
absorbed from st_sel_2026.json  {'rediagnosed': 4}   scope 7 key(s), 15 out-of-scope record(s) refused
```

## Caller inventory

| caller | classification | action |
|---|---|---|
| `run_season_current.sh` — production, current season, 3 absorb calls | must become run-scoped | **scoped** |
| `run_season.sh` — backfill runner, 4 absorb calls | must become run-scoped | **scoped** |
| `resume26.sh` — inlined one-case merge, unscoped | must become run-scoped | **routed through scoped `absorb`** |
| `browser_pass.sh` — inlined two-case merge, the exact policy L7J calls wrong in three of four cases, unscoped | must become run-scoped | **routed through scoped `absorb`** |
| `run.py::_drive` | already key-scoped — works only from `attempt_targets()` and calls `merge_attempt` per row | untouched |
| `write_out.py` | already scoped — `sheet_scope()` from `attempt_targets()` | untouched |
| `verify_gate.py` | **not stage absorption** — see below | untouched, debt carried |
| `merge.py`, `run23_ladder.sh`, `run23_tail.sh` | dormant technical debt | untouched, debt carried |

Routing the two shell scripts is the same substitution L7J made for the
production runner, applied to the scripts it missed: one merge owner, one run
scope, two duplicated policies deleted.

### verify_gate is a different defect, and it is not this one

It **can** change an out-of-run key's status, so it was checked against the
Phase 7 test — can it leak *through the same defect*? No:

- its input is `state.load()`, the programme's **own shipped rows**, never
  another run's stale stage record;
- it re-measures those rows against the gate in force now, which is the whole
  reason the file exists;
- `if not demoted: return 0` — with nothing to demote it returns before any
  write, so neither state nor stage files are touched. It demoted 0 in L7Q,
  0 in L7R, and it *kept* Bentley;
- its only stage-file interaction **removes** records it has demoted, so the
  next absorb cannot resurrect them. It never absorbs one.

Its debt is the named-demotion API — it writes `failed` directly rather than
through `merge_attempt`. That is carried forward unchanged, as instructed.

### The three dormant merges

`merge.py` reads eight `state_*.json` files; none exists. `run23_ladder.sh` and
`run23_tail.sh` hardcode `RB_SEASON=2023` and read `st23_*` /
`state_variants_2023.json`; none exists. All three also predate L7J, so
converting them would mean changing merge precedence in untestable code for
seasons with no inputs — two things this stage is explicitly not for. Carried
forward, with the evidence that they cannot fire.

## Proof

### The invariant, over arbitrary inputs

200 randomised trials: 1–40 keys per trial, random `done`/`failed` records on
both sides, a few stage keys that exist nowhere else, a random half in scope.
For every key not in scope, the durable record is deep-equal afterwards.

**0 violations.**

### The adversarial matrix — 25 tests

Both leaks reproduced and blocked; all four in-scope precedence cases unchanged
(`failed→failed` rediagnoses and carries history, `failed→done` resolves,
`done→failed` keeps the success and records the attempt, `done→done` replaces);
`tried` still bounded at `TRIED_MAX` after 30 absorptions; out-of-scope
`status`, `rows`, `url`, `parser`, `n`, `err`, `failure_class` and `tried` all
hold; a stale file of **100** unrelated keys changes none of them; a mixed file
changes only the current keys; an out-of-scope key is never created; exact-key
isolation, including a men's and a women's programme at the same institution and
a scope entry that is only a school name; empty scope writes nothing; missing
scope raises.

### Simulations, on copies of the real state and the real accumulated stage files

70 stage records, 23 distinct keys, `RB_ROOT` pointed at a temporary tree.

| scope | records seen | in-scope merged | out-of-scope refused | changed keys | **out-of-scope changed** |
|---|---|---|---|---|---|
| **7** (L7R validation set) | 70 | 28 | 42 | 6 | **0** |
| **25** (`WOULD_RESOLVE_NOW`) | 70 | 0 | 70 | 0 | **0** |
| **124** (full remaining cohort) | 70 | 25 | 45 | 6 | **0** |

Bentley, SMSU, Trinity Washington and Northwood: **unchanged in all three.**

The 25-key row is worth reading twice. None of the twenty-five programmes a
future run would target appears in the current stage files at all, so that run
absorbs **nothing stale** — 70 records seen, 70 refused, zero state change.

### The counterfactual

The same function, the same stage files, the same 2,138-key state — handed the
scope the old code effectively used, every key present in the files:

```
distinct keys in the stage files   23
merge outcomes                     rediagnosed 28, kept-success 27, refreshed 15
state keys changed                 7
OUTSIDE the seven                  1   Bentley||womens-soccer
```

Exactly the leak L7R observed, reproduced deterministically. Same merge policy,
different input selection.

## Live-state immutability

| | |
|---|---|
| `_state/state2026.json` | **byte-identical** |
| `_targets.csv` | **byte-identical** |
| all six stage-result files | **byte-identical** |
| all ten roster sheets | **byte-identical** |
| `roster_players` | 277,866 → 277,866 |
| `programme_status` / `roster_gap_reviews` | 6 / 7, unchanged |
| manifest | `e2695737104c00b4`, UNCHANGED (V3) |
| baselines | six PASS, no repin |

Coverage unmoved: denominator **1,748**, rostered **1,621**, missing **127**,
historical-only **124**, never-fetched **3**.

**Bentley's `tried` history still has its six entries.** It was not cleaned up.
The leak happened, and the record of it happening is worth more than a tidy
file — a fix that erases its own evidence cannot be audited later.

## Remaining acquisition debt

Untouched, as instructed: the George Mason candidate ladder, query-string source
advancement and the Sidearm Vue parser (which belong together in one later
stage); `build_targets.py` rewriting the worklist on import — nothing here
imports it, and the tests invoke it only as a subprocess against a fixture root;
untrustworthy bio-page and bare-page historical references; the `verify_gate`
named-demotion API; the `verified:true` authority cleanup; the seven registry
duplicates; Mississippi Christian; the three never-fetched programmes.

## What this unblocks

L7R withheld bulk acquisition on one criterion: `state.absorb` could mutate
out-of-scope programme state. That criterion is now met, and the 124-key
simulation is the precondition L7T needs.

**Next stage: the 25 `WOULD_RESOLVE_NOW` programmes.** They are the cohort's
free win — each already resolves against its own live page with the shipped
parsers and gates — and the simulation shows a run over them absorbs nothing
stale. After that, the 83 `PAGE_PRIOR_SEASON` programmes, which are a candidate
and publication question rather than a parsing one.
