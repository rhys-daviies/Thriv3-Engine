# L6D-PRE — acquisition run scoping and state path ownership

**No live acquisition. No source fetched, no sheet written, no roster row
imported, no dataset row altered.** State is untouched at 1,910 `done` /
194 `failed`. P6 unchanged, manifest `5bbca9054b7752d5` unchanged, six baselines
byte-identical, corpus 1,755 / 2,987, full suite 3,637 passing.

---

## The distinction this stage exists to hold

| | |
|---|---|
| **`state.targets()`** — TARGET MEMBERSHIP | who exists and is eligible. Registry-derived since L6B. **No filter touches it.** |
| **`state.attempt_targets()`** — RUN SCOPE | which eligible targets *this run* tries. Narrowed by `RB_KEYS` / `RB_DIVISIONS`. |

A target excluded from a run is **not attempted, and nothing else**: not marked
done, not marked failed, not written to state, not removed from
`_targets.csv`. Next run it is eligible exactly as before.

## Stage trace, and where the filter goes

The current-season runner drives seven stages as separate processes:

| stage | key source | scoped? |
|---|---|---|
| `run.py direct` | `state.targets()` → **`attempt_targets()`** | yes |
| `variants.py` | `state.targets()` → **`attempt_targets()`** | yes |
| `selector.py` | `--keys rem$S.txt` | yes, via `remaining()` |
| `browse.py` (4 shards) | `--keys shb$S_i.txt`, sharded from `rem$S.txt` | yes, via `remaining()` |
| `verify_gate.py` | state | **no — must see everything** |
| `write_out.py` | `state.targets()` | **no — see below** |

`remaining()` in the runner now computes `attempt_targets() − done`, so the two
`--keys`-driven stages inherit the scope without a second mechanism.

**`write_out.py` is deliberately not scoped.** It rebuilds each sheet in full
from state, so filtering it would emit sheets containing only the attempted
programmes and truncate the other 2,100. That would have been a silent
destruction of unrelated data — the reason the filter is a separate function
rather than a change to `targets()`.

No stage is skipped or reordered. Turnover gating, soft-404 handling, source
validation and confidence assignment are untouched.

## Filter contract

Set by environment, because the stages are separate processes and an exported
variable cannot be dropped by one that forgot to forward a flag:

- **`RB_KEYS`** — a file of `School||Sport` lines
- **`RB_DIVISIONS`** — a comma list matching the `Division` column verbatim
- both set → **intersection**; both empty → the full universe, i.e. previous
  behaviour exactly

The runner exposes them as `--keys` and `--divisions` and prints the plan
before doing anything when either is set.

## Key identity

`state.key(r)` = `School + '||' + Sport`, the format the pipeline already uses.
Not a second identity scheme, and not fuzzy.

**Verified unique: 2,165 rows, 2,165 distinct keys, zero collisions.** Men's and
women's are separate keys by construction; the same school in two divisions
would also be distinct, and no such case exists today. Division is carried on
the row, so `--divisions` filters without needing to be part of the key.

## The 34, derived not declared

`npm run roster-targets -- --gap-keys` recomputes the cohort from the registry:
active NCAA programmes with no roster, minus duplicate rows whose twin already
holds one. **34 keys.** It is a run argument, never membership, and it is
regenerated rather than pasted into source — so it cannot drift from the
registry.

```
Pace||mens-soccer                          Elms||womens-soccer
Southwest Minnesota State||mens-soccer     Endicott College||womens-soccer
Azusa Pacific University||womens-soccer    Eureka College||womens-soccer
Glenville State||womens-soccer             Goucher College||womens-soccer
Northwood||womens-soccer                   Lasell||womens-soccer
Tuskegee||womens-soccer                    Mitchell||womens-soccer
Wayne State (MI)||womens-soccer            New Jersey City University||womens-soccer
Anna Maria||mens-soccer                    Norwich||womens-soccer
Bryn Athyn||mens-soccer                    Rivier||womens-soccer
Carlow||mens-soccer                        Saint Mary's College (IN)||womens-soccer
Goucher||mens-soccer                       Simmons||womens-soccer
New Jersey City||mens-soccer               St. Catherine University||womens-soccer
Wisconsin-La Crosse||mens-soccer           Trinity Washington University||womens-soccer
Wisconsin-Oshkosh||mens-soccer             UMass Boston||womens-soccer
Anna Maria College||womens-soccer          UMass Dartmouth||womens-soccer
Bryn Athyn College of the New Church||womens-soccer   Wesleyan (GA)||womens-soccer
Carlow University||womens-soccer
College of Saint Benedict||womens-soccer
```

## Dry run

`plan.py` reports scope without a network call. Unfiltered it reproduces the
blocked figure exactly — 255 to attempt. Scoped:

```
  target universe        2165   (membership — unchanged by scope)
  already done           1910
  eligible this season    255
  TO ATTEMPT               34
  excluded by scope       221  (left eligible for a future run)

  attempt set by division x sport:
        2  NCAA D2  mens-soccer        7  NCAA D3  mens-soccer
        5  NCAA D2  womens-soccer     20  NCAA D3  womens-soccer
  excluded by division:
       55  NAIA     18  NCAA D1     11  NCAA D2     117  NCAA D3     20  USCAA

  previously failed and being retried: 0
  never attempted before: 34
```

**Exactly 34. Zero NAIA, zero USCAA, zero other NCAA retry targets.**

## State paths

| | before | after |
|---|---|---|
| targets | `~/Documents/Thriv3/<S> Roster Sheets/_targets.csv` | `season_dir(S)/_targets.csv` |
| reference | `~/Documents/Thriv3/<REF> Roster Sheets` | `season_dir(REF)` |
| durable state | `~/Documents/Thriv3/<S> Roster Sheets/_state` | `season_dir(S)/_state` |

`season_dir()` honours `RB_ROOT`, defaulting to `~/Documents/Thriv3`. **Unset,
every path resolves to exactly the previous location** — verified. Set, a run is
fully isolated, which is what the tests use.

Only these three sites moved. The remaining files' path handling is untouched;
this is the scope L6D needs and not a filesystem refactor.

## Cache decision — A, stays an OS cache

`~/Library/Caches/recruitmatch-rb` remains where it is. It is an
**optimisation, never a correctness authority**: every gate that decides whether
a page is a real current-season roster — turnover, soft-404, season addressing —
runs on the fetched content regardless of where it came from, and a cold cache
changes run time and nothing else. Making it `RB_ROOT`-relative would put an
11,000-page fetch store inside a data directory and invite it into a backup or a
commit. Not committed, not versioned.

## External copy

**STATE_MIGRATION_REQUIRED**, improved from `STILL_RUNTIME_REQUIRED`.

Code authority is the repo and `RB_ROOT` can now isolate a run completely. What
still lives outside is *data*: `~/Documents/Thriv3/<season> Roster Sheets/` holds
the worklist, the durable state (1,910 done / 194 failed) and the produced
sheets. `~/Documents/Thriv3/_roster_pipeline` is now a stale code copy — nothing
invokes it — but it must not be deleted while its sibling directories hold the
only record of work already done.

Archiving the code copy is safe once someone confirms nothing points at it.
Moving the state is a separate, deliberate migration. Nothing was deleted.

## The L6D command

```bash
node server/scripts/rosterTargetUniverse.js --gap-keys --out /tmp/l6d-keys.txt
npm run roster:acquire -- 2026 2025 --keys /tmp/l6d-keys.txt --divisions 'NCAA D2,NCAA D3'
```

The runner prints the plan before its first request. **If that plan does not say
`TO ATTEMPT 34`, stop.** The `--divisions` guard is redundant against a key file
that already contains only NCAA D2/D3 rows, and it is there precisely so that a
mistake in the key file cannot reach a deferred association.
