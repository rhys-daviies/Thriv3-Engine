# L7C — acquisition from verified-host candidates

L7B built the missing inverse — institution → verified athletics host →
deterministic roster candidate — and proved it planned. This ran it.

**12 of the 20 attempted programmes resolved, 378 roster rows imported, and
every one of the 12 travelled the full architectural path**: trusted domain
authority → generated candidate → the ordinary acquisition chain with every gate
in force → resolved source. Nothing was hand-typed and no identity was guessed.

Three canonical pairs became personalised. All three emails check out.

Getting there took two corrective rounds, and both defects were in the L7B
integration rather than in the pipeline. They are the most useful thing this
stage produced.

---

## 1. Cohort

The original 34 reproduce exactly — digest `e4ca69df42411123`, identical to
L6D's. The planner still returns 21 with candidates and 13 without.

The 20 were **derived, not declared**: `--verify --cohort-out` classifies each
of the 21 by what its generated candidate actually reached, and writes the key
file. Membership reconciles with L7B exactly — same 20, same excluded
Wisconsin-La Crosse, same 13 without a host.

The direct/browse split moved: **16 DIRECT_READY / 4 BROWSE_REQUIRED**, against
L7B's 14/6. Carlow and Goucher men's answered statically this time and their
women's counterparts did not. Same programmes, different day; the classification
is a property of one HTTP attempt and the cohort is what matters.

Key file `b39b4848150d1a32`, 20 lines.

## 2. Run plan

```bash
node server/scripts/rosterTargetUniverse.js --gap-keys --out /tmp/l7c-34.txt
node server/scripts/rosterCandidatePlan.js --keys /tmp/l7c-34.txt --verify \
  --cohort-out /tmp/l7c-20.txt --class-out /tmp/l7c-class.csv
node server/scripts/rosterCandidatePlan.js --csv --out "<season>/_registry_candidates.csv"
python3 tools/roster_pipeline/build_targets.py 2026
npm run roster:acquire -- 2026 2025 --keys /tmp/l7c-20.txt
```

```
TO ATTEMPT 20     excluded by scope 235 (left eligible)
  D2 m 1 · D2 w 3 · D3 m 4 · D3 w 12
  excluded: NAIA 55 · NCAA D1 18 · NCAA D2 14 · NCAA D3 128 · USCAA 20
```

**0 non-NCAA, 0 other-NCAA, 0 no-host, 0 problematic.** Asserted directly:
attempt-set == cohort, and none of the 14 excluded original-34 appears in it.
Target universe 2,165 before and after.

`_targets.csv` gained 26 candidate cells and nothing else — membership identical,
and **the known-good column stayed empty on every one**, so a generated URL can
never later be mistaken for a page we fetched.

## 3. Two defects in L7B's integration

### a. A generated candidate was skipping normalisation

The first run resolved 10 of 20. Five of the ten failures were Presto hosts, and
the ladder had been asked to fetch:

```
https://athletics.carlow.edu/sports/mens-soccer/2026-27/roster?view=table/2026-27
```

`variants.ladder` appends a season to a path, and with a query string in the way
its `^(.*?/roster)(?:/.*)?$` match fails, so `base` became the whole URL —
query included. Every other candidate in the system passes through
`build_targets.swap()` first, which strips `?view=table` and normalises the
season. The generated one did not, because L7B inserted it after that call.

Fixed: `swap(CANDIDATES[k], SEASON)`. **A candidate that skips the normalisation
everything else gets is not in the normal path, whatever the diagram says** —
which is exactly what stop condition 4 is about.

### b. A generated method read as a human repair

The rebuild after that fix changed nothing. `repairs()` carries forward any
candidate whose `Method` this file did not write, so that a rebuild cannot
revert a hand-repaired URL — and L7B's new method string was not in
`GENERATED_METHODS`. The first run's own output was being read back as somebody's
manual work and preserved over the correction.

Fixed by adding it to the set. A method the file writes belongs there, always.

### c. What the failures then taught the catalogue

With both fixed, the Presto candidates were still wrong in one respect. L7B
ordered SHAPES by provider but left the sport segment on global frequency, so a
Presto host got the Presto shape with SIDEARM's long segment. Measured against
the corpus:

| provider | short segment (`msoc`/`wsoc`) | long (`mens-soccer`) |
|---|---:|---:|
| PRESTO | **37** | **0** |
| SIDEARM | 12 | 1,439 |
| NUXT | 1 | 19 |

So the segment is a property of the provider on the same evidence as the shape,
and the ordering is now platform-aware in both. Elms and Endicott resolved on the
re-run at `/sports/wsoc/2026-27/roster`; five failed attempts were what it took
to see it.

## 4. Results

| | attempted | resolved | failed |
|---|---:|---:|---:|
| DIRECT_READY | 16 | 11 | 5 |
| BROWSE_REQUIRED | 4 | 1 | 3 |
| **total** | **20** | **12** | **8** |

| classification | n | programmes |
|---|---:|---|
| `RESOLVED` | **12** | Pace M · Azusa Pacific W · Glenville State W · College of Saint Benedict W · Elms W · Endicott College W · Norwich W · Rivier W · Simmons W · St. Catherine University W · UMass Boston W · UMass Dartmouth W |
| `CLIENT_RENDER_FAILURE` | **6** | Carlow M+W · Goucher M+W · Northwood W · Wisconsin-Oshkosh M |
| `SOFT_404` | **2** | Bryn Athyn M+W |
| `NO_SOURCE_FOUND` · `TURNOVER_REJECTED` · `SOURCE_PARSE_FAILURE` · `IDENTITY_MISMATCH` · `NETWORK_FAILURE` · `OTHER` | 0 | — |

**Bryn Athyn is a correct refusal, not a miss.** `brynathynathletics.com` serves
its soccer pages titled *"2024 Men's Soccer Roster"*; the season gate read the
title and refused. The site has not published a 2026 roster at those paths.

**The six client-render failures reached the browser stage and rendered.** They
are not routing failures: `browse.py` fetched each, and the parser found no
players. Fetched directly, `athletics.carlow.edu/sports/msoc/2026-27/roster?view=table`
returns 200 with the right `og:site_name` and **zero `<tr>` elements** — the squad
arrives by script after load. Whether the `?view=table` query (which `swap` strips)
is what makes these render a table is a concrete, testable question for L7D. It
was not chased here: the architecture was already proven and an acquisition stage
is the wrong place to optimise a success rate.

### Browser stage

| | result |
|---|---|
| stage reached | **YES**, all 8 remaining |
| render succeeded | YES — pages returned |
| roster identified | **NO** for 6 · N/A for the 2 refused on season |
| parser succeeded | NO — 0 players from a client-rendered DOM |

## 5. Resolved sources

All 12: confidence `high`, one source URL each, on the trusted host.

| programme | div | host | provider | final path | rows |
|---|---|---|---|---|---:|
| Pace M | D2 | paceuathletics.com | SIDEARM | `/sports/mens-soccer/roster/2026` | 71 |
| Azusa Pacific W | D2 | athletics.apu.edu | SIDEARM | `/sports/womens-soccer/roster/2026` | 27 |
| Glenville State W | D2 | gstatepioneers.com | SIDEARM | `/sports/womens-soccer/roster/2026` | 28 |
| College of Saint Benedict W | D3 | gobennies.com | SIDEARM | `/sports/womens-soccer/roster/2026` | 28 |
| Elms W | D3 | athletics.elms.edu | PRESTO | `/sports/wsoc/2026-27/roster` | 29 |
| Endicott College W | D3 | ecgulls.com | PRESTO | `/sports/wsoc/2026-27/roster` | 33 |
| Norwich W | D3 | norwichathletics.com | SIDEARM | `/sports/womens-soccer/roster/2026` | 27 |
| Rivier W | D3 | rivierathletics.com | SIDEARM | `/sports/womens-soccer/roster/2026` | 37 |
| Simmons W | D3 | athletics.simmons.edu | SIDEARM | `/sports/womens-soccer/roster/2026` | 24 |
| St. Catherine University W | D3 | stkatesathletics.com | SIDEARM | `/sports/womens-soccer/roster/2026` | 26 |
| UMass Boston W | D3 | beaconsathletics.com | SIDEARM | `/sports/womens-soccer/roster/2026` | 26 |
| UMass Dartmouth W | D3 | corsairathletics.com | SIDEARM | `/sports/womens-soccer/roster/2026` | 22 |

**Coverage: name 378/378, position 378/378, class year 378/378, nationality
378/378, hometown 378/378.** Nothing was inferred. `country` is populated only
where `nationality` is `International` — 30 of 195 in a spot check — so hometown
did not become nationality anywhere.

Identity: every host was verified by the ledger before a candidate existed, and
each final page's `og:site_name` named the right institution. Sport and gender
identity come from the segment, and the bare `soccer` segment is still never
generated.

## 6. Output safety

| sheet | rows before → after |
|---|---|
| ncaa_d2_mens | 6,906 → 6,977 |
| ncaa_d2_womens | 7,485 → 7,540 |
| ncaa_d3_womens | 9,317 → 9,569 |
| d1 m/w, d3 m, naia m/w, uscaa m | byte-identical |

**Rows added 378 · removed 0 · changed 0.** Programmes 1,910 → 1,922. No
unrelated programme disappeared.

**The USCAA drift recurred, exactly as L6D predicted.** `write_out.py` rebuilt
Penn State Schuylkill's 19 rows from state and again replaced the human-repaired
`Pennsylvania State University Athletic Conference` with the state's
`Eastern College Athletic Conference`. Pre-run bytes restored; state untouched;
USCAA out of scope. **This is now twice.** The general defect — a sheet-level
correction never written back to state is undone by any later run — remains
unaddressed and is the clearest piece of pipeline debt outstanding.

## 7. Import

Validated on a copy first, then applied with a backup. Only NCAA D2/D3 moved;
NAIA and USCAA row counts unchanged.

`roster_players` **276,745 → 277,123 (+378)**; 2026 rows **57,807 → 58,185**.
12 programmes imported. The seven duplicate registry rows were not touched.

## 8. Coverage

| | with roster before → after |
|---|---|
| D1 men | 213 → 213 |
| D1 women | 349 → 349 |
| D2 men | 201 → 202 |
| D2 women | 254 → 256 |
| D3 men | 311 → 311 |
| D3 women | 392 → 401 |
| **NCAA total** | **1,720 → 1,732** |

Gaps 41 → **29**, of which **22 legitimate active** and 7 duplicate registry rows.
The 2 inactive rows are outside the universe.

| remaining legitimate gap | n |
|---|---:|
| `NO_TRUSTED_HOST` | 13 |
| `ACQUISITION_FAILED` (has a host and a candidate) | 8 |
| `MANUAL_CANDIDATE_REVIEW` (Wisconsin-La Crosse) | 1 |

## 9. Evidence impact

**3 canonical pairs affected, all generic → personalised. 0 supplemented,
0 regressions, 2,984 still generic.**

All three are the single women's-soccer athlete in the corpus against three of
the newly acquired programmes, and all three gained one kind:

| pair | before → after |
|---|---|
| Azusa Pacific University | `POSTSEASON_RESULT` → `POSITION_GRADUATION` + `POSTSEASON_RESULT` |
| Glenville State | (none) → `POSITION_GRADUATION` |
| Rivier | (none) → `POSITION_GRADUATION` |

Rendered sentences 2,842 → 2,845; held claims 221, unchanged. Eleven of the
twelve acquisitions are women's programmes and the corpus holds one women's
athlete, so this is the ceiling the fixture allows, not a weak result.

Breakdown: women 3, men 0 · D2 2, D3 1 · DIRECT_READY-sourced 3,
BROWSE_REQUIRED-sourced 0.

### Email review

| | n |
|---|---:|
| GOOD | **3** |
| ACCEPTABLE · WEAK · **BAD** | 0 · 0 · **0** |

Each claim was checked against the acquired rows:

> "one midfielder is listed to graduate in 2027 — Julia Galdamez"

Azusa Pacific has exactly one midfielder graduating 2027, and she is Julia
Galdamez. Glenville State: one, Marcelle Stoller. Rivier: one, Reese Hatin. The
counts are exact, not "at least". Institution, sport, position and graduation
semantics are all correct; present tense is used about a current roster; copy
density is one relevance sentence, plus one pre-existing recognition line at
Azusa Pacific. No country claim is made in any of the three, and Marcelle
Stoller's `International`/`Brazil` is stored separately from her Rio de Janeiro
hometown.

## 10. History depth

All 12 are **CURRENT_ONLY** — 2026 and no prior season. Arrival, transfer and
historical families are therefore impossible from this data, and only
current-roster families are available. That is exactly what appeared:
`POSITION_GRADUATION` and nothing else. A second season for these programmes
would unlock the arrival family; a single roster year cannot.

## 11. Architecture proof

For each of the 12, four conditions were asserted mechanically:

1. the host came from `domainAuthority` under the DISCOVERY profile — `hostsForInstitution` returns `OK`;
2. `_targets.csv` Method is `generated from a verified athletics host`;
3. the known-good column is empty — no promotion before validation;
4. the final `source_roster_url` host is one the authority returned.

**All four hold for all 12.** No manual URL insertion, no fuzzy school-name
matching, no unverified-domain trust, no known-good promotion.

## 12. Manifest and baselines

| | |
|---|---|
| before | `5bbca9054b7752d5` |
| after | `54d834dcc8df2001` |
| verdict | **UNCOMPARABLE** — `roster_players` and `roster_freshness` both moved |

All six surfaces moved and all six were repinned, deliberately: the dataset
gained 378 rows across 12 programmes, three pairs gained one Evidence kind each,
no pair lost one, and the rendered/recorded invariant reports no contradictions.
`athletics_domains` was not written — 2,717 rows, one `checked_at`, unchanged.

**P6 unchanged.** New data producing existing kinds is not a semantic change.

Three pinned report digests moved with it and were repinned on the same account;
every structural assertion in those reports still passes.

### A measurement error worth recording

The pre-import database backup was taken with `cp` of the `.sqlite` file alone.
SQLite is in WAL mode here and the WAL held 22 MB, so the copy is the last
*checkpointed* state and not the live one — it still carries
`players.email_template` values that a later migration had cleared. A before/after
comparison against it appeared to show **2,338 pairs changing email body with
identical Evidence**, which was entirely an artefact of that stale snapshot.

The trustworthy measurement is the baseline system's own, taken live on the real
database before and after: 1,755 → 1,758 personalised, which is the +3 above.

**Consequence: that backup file is not a usable rollback point.** A database
backup in this repository must copy `-wal` and `-shm` alongside the main file,
or run `VACUUM INTO`.

## 13. Invariants

* target universe **2,165 before and after**, membership identical
* all 8 failures remain in the universe and eligible
* the 14 excluded original-34 were not written to state by this run
* the 22 remaining gaps still reproduce from `--gap-keys`
* `verify_gate` re-measured 1,910 done rosters and demoted 0

## 14. L7D

| band | n | what it needs |
|---|---:|---|
| `ACQUISITION_RETRY` — client-rendered | 6 | why a rendered Presto/Sidearm page yields no rows; the `?view=table` question |
| `SOURCE_NOT_AVAILABLE` — Bryn Athyn M+W | 2 | the site publishes a 2024 roster; nothing to acquire until it updates |
| `MANUAL_CANDIDATE_REVIEW` — Wisconsin-La Crosse | 1 | every soccer path redirects elsewhere |
| `NO_TRUSTED_HOST` | 13 | bounded domain discovery, still not done |

---

## Debt recorded, not solved

**USCAA state-vs-sheet authority.** Second occurrence. See §6.

**`BASE_ONLY` strict policy.** L7B measured 7 wrong of 8; `STRICT` still admits
them and `registryIntegrity` contains all seven. Dropping them costs Regis (CO)
a correct operator link. Unchanged here, deliberately.

**`rosterCandidatesForVerifiedHost({ verified: true })`** still takes a caller's
boolean rather than an authority-produced capability object. Not refactored:
correctness did not require it this stage.

**2026 roster sheets are not repository seed data.** `rosters_2024` and
`rosters_2025` are committed under `server/seed/data`; 2026 is not, and lives
only in the operator's directory. Adding a season mid-acquisition is a decision
for whoever owns the seed corpus, not a side effect of an acquisition run.

**Database backups must include the WAL.** See §12.
