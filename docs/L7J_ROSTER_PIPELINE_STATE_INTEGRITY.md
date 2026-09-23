# L7J — acquisition state that tells the truth twice

```
stage files ──→ absorb ──┐
run.py _drive ───────────┼──→ state.merge_attempt ──→ _state/state<S>.json
verify_gate (direct) ────┘                                    │
                                                    write_out projects
                                                              ↓
                                          _targets.csv  Status · Notes
```

**No roster acquired, no dataset touched, no live operational state written.**
Manifest unchanged, six baselines PASS unrepinned, P6 unchanged.

---

## 1. Who owns what

The whole confusion is one sentence long: **`_state/state<S>.json` is the only
durable, authoritative, non-derived operational state.** Everything in
`_targets.csv` is either an input or a projection of it.

| field | created by | updated by | durable | authoritative | derived | regeneration overwrote it |
|---|---|---|---|---|---|---|
| state `status`, `stage`, `url`, `parser`, `n`, `rows` | stages | `merge_attempt` | **yes** | **yes** | no | never — `build_targets` cannot see it |
| state `err`, `tried` | stages | `merge_attempt` | yes | yes | no | never |
| `Status` | `build_targets` (`todo`) | **`write_out.py`, every row, from state** | file | **no** | **yes** | **yes, destructively** |
| `Notes` | `build_targets` (`''`) | **`write_out.py`, every row, from state** | file | no | yes | **yes, destructively** |
| `Roster URL <S> (candidate)` | `build_targets` | generator, or a human repair | file | yes | partly | preserved iff `Method ∉ GENERATED_METHODS` |
| `Method` | `build_targets` | human repair | file | yes | no | preserved by `repairs()` |
| `Generated Candidates` | `build_targets` | `build_targets` | file | no | yes | regenerated — correct |
| `Roster URL <REF> (known good)`, `<REF> Player Count` | `scan(REF)` | `build_targets` | file | no | yes | regenerated from the reference sheets |
| `School`/`Sport`/`Division`/`Conference` | registry + scan | `build_targets` | file | no | yes | regenerated — correct |

`write_out.py` rewrites `Status` and `Notes` for **every** row of the worklist
from durable state at the end of a run. Neither column has ever held operator
text, which is what makes Phase 13's question easy to answer and Defect B's
damage recoverable — on a day when the state file happens to survive.

## 2. Defect A — the first failure won forever

The runner's merge was four lines of heredoc inside `run_season_current.sh`:

```python
if   v['status']=='done' and main.get(k,{}).get('status')!='done': main[k]=v
elif v['status']!='done' and k not in main:                        main[k]=v
```

Read as a table, **three of its four cases are wrong**:

| | old behaviour | |
|---|---|---|
| `failed → failed` | **skipped** — `k not in main` is false | the defect |
| `done → done` | **skipped** — a refresh is discarded | a second freeze, previously unreported |
| `done → failed` | skipped | the one case it got right, by accident |
| `failed → done` | replace | correct |

Reproduced network-free, with the merge verbatim:

```
attempt 1  variants  "no candidate"                  → durable: no candidate
attempt 2  browser   "page season is not 2026"       → durable: no candidate   FROZEN
attempt 3  browser   done                            → durable: done
attempt 4  variants  "fetch 503"                     → durable: done           (correct)

start      done  url=https://old.test/r
refresh    done  url=https://new.test/r              → durable: old.test       IGNORED
```

Exact cause: **`k not in main`** on the `elif`, and
**`main.get(k,{}).get('status') != 'done'`** on the `if`.

### It is not a cosmetic staleness

All ten remaining NCAA gaps report `stage: variants`, `err: no candidate` from
L6D. Measured read-only against today's planner:

| | |
|---|---:|
| gaps whose durable reason is `no candidate` | **10 of 10** |
| gaps the planner offers 24 generated candidates for **right now** | **7 of 10** |

So for seven programmes the recorded reason is not stale, it is **false**, and
that can be shown without a single request. Three stages have re-derived
residual classifications live because of it.

Meanwhile `run.py::_drive` overwrote on every attempt and accumulated a `tried`
line. **Two writers, two policies, and the one that froze lived in a shell
heredoc where no test could reach it.**

## 3. The state model

Compared: (A) latest overwrites, (B) append-only history with derived latest,
(C) current state plus bounded history, (D) something smaller.

**Chosen: C, and it is what the file was already reaching for.** The entry
already holds current fields and a `tried` list; what it lacked was a merge that
maintained either across processes. B would mean an event log for an operational
question, and the brief is right that this is not outcomes analytics.

```
absent → anything   record
failed → failed     REPLACE   newest diagnosis is the truthful one
failed → done       REPLACE   an acquisition supersedes a refusal
done   → done       REPLACE   a newer successful read is a better one
done   → failed     KEEP      the success stands; the attempt joins `tried`
```

The last is the asymmetry that matters. **A stage file is a cache.** A failure
in one is not evidence that a roster we hold is bad; it is evidence that one
attempt did not land. Demoting on that is how a season's work disappears.

Demotion is a real operation and belongs to whoever can judge it.
`verify_gate.py` re-measures shipped rows against the gate in force *now*,
writes `failed` **directly**, and purges the stage files so the next absorb
cannot resurrect what it demoted. That path is deliberately untouched — it is
the one caller entitled to demote, and it earns that by re-measuring rather than
by trusting provenance.

**History bound: 12.** The fix makes `tried` grow where it previously could not
— across 2,138 live entries the longest is **2**, because a failure never merged
into an existing key at all. A current-season run has four acquiring stages, so
twelve is three full runs: enough to see what a programme keeps refusing to do,
and a ceiling rather than a place for a log to accumulate.

## 4. Failure taxonomy

96 distinct reason strings in live state. They collapse into six shapes:

| class | what the stage wrote |
|---|---|
| `NO_CANDIDATE` | `no candidate`, no trusted host |
| `ROUTE_FAILURE` | `… -> fetch 404`, `unreachable` |
| `SEASON_MISMATCH` | `page season is not 2026 (title="2027 …")` |
| `TURNOVER_REFUSED` | `roster repeats 100% of the 2025 squad (gate 85%)` |
| `PARSER_FLOOR` | `too few players parsed (0)`, `only 3 usable rows` |
| `CONTENT_UNREADABLE` | `renders client-side`, `nothing parsed` |

**Both are stored, and only one is authoritative.** The raw `err` string stays
exactly as the stage produced it and is the evidence; `failure_class` is an index
over it so a residual can be counted without re-running an acquisition.

**These are engine outcomes and deliberately NOT the operator's vocabulary.**
`SOURCE_NOT_AVAILABLE`, `PROGRAMME_STATUS_QUESTION`,
`SITE_TEMPORARILY_UNAVAILABLE`, `MANUAL_REVIEW` and `NO_HOST` are product
judgements made by a person who looked at a site. "Soccer (Coming in 2027)" in a
navigation menu is what makes Wisconsin-Oshkosh a programme-status question, and
no engine said that. The engine can report that a page named the wrong season;
only a person can report that the programme does not exist yet. Collapsing the
two would let the pipeline manufacture a diagnosis it never established — which
is the failure mode this whole stage exists to stop.

## 5. Defect B — regeneration was a reset

`build_targets.py` emitted, for every row it wrote:

```python
'Status': 'todo', 'Notes': ''
```

with nothing reading what was already there. Reproduced on an isolated fixture:

```
before   Alpha  done    Notes="High via direct; 27 players; …"
         Beta   failed  Notes="unresolved. tried: …"
         Gamma  failed  Notes="unresolved. tried: …"   Method="manual repair — operator"
after    Alpha  todo    Notes=""
         Beta   todo    Notes=""
         Gamma  todo    Notes=""                       Method="manual repair — operator"
```

L7I's live measurement, the same mechanism at scale: **1,933 `done` and 207
`failed` rows lost their status and every `Notes` cell was blanked**, in one
command that announced none of it. Manual repairs survived, because `repairs()`
already protected `Method` and the candidate URL.

The damage was recoverable that day only because `write_out.py` derives both
columns from durable state, which this file never touches. **That is luck about
which artefact happened to be authoritative, not a safety property**, and it
stops being true the moment the state file is the thing that is missing.

### The regeneration contract

Target-universe regeneration and operational-state reset are separate
operations, and only one of them is destructive.

**Default — preserve.** `Status` and `Notes` carry forward per key.
**New key** → `todo` / `''`.
**Removed key** → dropped from the worklist and named in the output, with its
durable state in `_state/` explicitly untouched. `build_targets.py` has never
written the state file and does not start now, so a key leaving the universe
loses its place in the worklist and none of its history.

Every run now says what it did:

```
operational state carried forward: 3 Status, 3 Notes
0 new target(s) initialised as todo
1 target(s) left the registry universe and are no longer listed;
their durable state in _state/ is untouched: Beta||mens-soccer
```

**Explicit reset — `--reset-state`.** A real pre-season operation, so it stays
available, and it reports what it destroyed:

```
--reset-state: every Status set to todo and every Notes cleared.
3 rows held operational state before this run and no longer do.
Durable acquisition state in _state/ is NOT touched; re-run write_out.py to
rebuild these columns from it.
```

A reset is of **operational state**. An operator's repair is not that, so
`Method` and a repaired candidate URL survive `--reset-state` exactly as they
survive a normal rebuild.

## 6. Migration — required, and deliberately not performed

**No.** The frozen rows are left exactly as they are.

The true current reason for those ten cannot be derived without attempting them,
and L7J acquires nothing. What *can* be shown deterministically is that the
recorded reason is wrong for seven — but "this is false" is not "this is the
answer", and writing a guess into durable state would be the fabrication the
brief forbids and the defect in a new costume.

The fixed merge rediagnoses each key on its next real attempt, which is when a
truthful reason first exists. Until then the measurement in §2 is the record, and
**durable failure reasons must not be read as a residual classification** — which
was already true before this stage and is now written down.

## 7. Verified unchanged

| | |
|---|---|
| `roster_players` | 277,397 |
| `athletics_domains` | 2,722 · `colleges` 2,404 |
| `_targets.csv` | 2,165 rows, 1,606 NCAA done, Northwood W done |
| `_state/state2026.json` | 2,138 entries, 1,934 done, no `failure_class` written |
| ten roster sheets | unchanged |
| manifest | `194fcf38877e6686`, **UNCHANGED** |
| six baselines | **PASS, unrepinned** · P6 unchanged |

`build_targets.py` ran only against `/tmp` fixtures and vitest's `mkdtemp`
roots. Nothing in `~/Documents/Thriv3` was written by this stage.

## 8. Debt

**`verify_gate.py` writes state directly** rather than through `merge_attempt`.
That is correct today — it is the one caller entitled to demote a success — but
it means two writers again, and the second one is the dangerous kind. A later
stage should give it an explicit `demote()` entry point so the entitlement is
named in code rather than held by convention.

**`run.py::_drive` was overwriting a `done` with a `failed` outright**, and only
the `todo` filter upstream kept it from demoting a good roster. It now goes
through `merge_attempt`, so the protection is in the write rather than in a
filter someone could change — but the filters remain, and the redundancy is
worth keeping.

**The residual vocabulary has no home.** `SOURCE_NOT_AVAILABLE` and its four
siblings exist only in stage documents. Nothing stores them, so every stage that
wants them re-derives them by hand. Giving them an operator-owned column is the
obvious next step and was out of scope here.
