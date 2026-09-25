# L7F — acquiring from hosts L7E verified

L7E verified athletics identities for ten programmes that had none. This stage
ran the acquisition pipeline against the eight of those whose generated
candidate had reached a roster page, and **seven resolved and were imported**.

The whole path ran end to end with no manual repair:

```
trusted athletics identity → generated candidate → normal stages → gates → roster → Evidence → email
```

**+152 roster rows. NCAA coverage 1,736 → 1,743. One new personalised email,
reviewed GOOD.** USCAA, NAIA and every unrelated NCAA sheet byte-identical.

---

## 1. The eight, derived

Not taken from the brief. The 18 remaining gaps were run through the L7B planner
and bounded verification; the eight are exactly those whose candidate returned
`200_ROSTER`. Digest `fea1e2fd56bfb1fd`.

| programme | div | unitid | trusted host | authority | verified candidate |
|---|---|---:|---|---|---|
| Southwest Minnesota State M | D2 | 175078 | smsumustangs.com | TRUSTED | `/sports/msoc/roster/season/2026` |
| Tuskegee W | D2 | 102377 | goldentigersports.com | TRUSTED | `/sports/womens-soccer/roster/2026` |
| Wayne State (MI) W | D2 | 172644 | wsuathletics.com | TRUSTED | `/sports/womens-soccer/roster/2026` |
| Eureka College W | D3 | 144971 | eurekareddevils.com | TRUSTED | `/sports/wsoc/2026-27/roster?view=table` |
| Lasell W | D3 | 166391 | laserpride.lasell.edu | TRUSTED | `/sports/wsoc/2026-27/roster?view=table` |
| Mitchell W | D3 | 129774 | mitchellathletics.com | TRUSTED | `/sports/wsoc/2026-27/roster?view=table` |
| Saint Mary's College (IN) W | D3 | 152390 | belles.saintmarys.edu | TRUSTED | `/sports/wsoc/roster/2026` |
| Wesleyan (GA) W | D3 | 141325 | wesleyanathletics.com | TRUSTED | `/sports/wsoc/roster/2026` |

Every host's ledger `unitid` equals the programme's, and every one is TRUSTED
under **STRICT** — the production profile, not merely the discovery one.

**Zero overlap with every excluded cohort**, each excluded by a recorded verdict
rather than by a list: Anna Maria ×2 `403`, Bryn Athyn ×2 and Wisconsin-Oshkosh
`REDIRECT_TO_ROSTER`, Northwood `OTHER`, Wisconsin-La Crosse `SOFT_404`, NJCU ×2
and Trinity Washington `NO_TRUSTED_HOST`.

## 2. The path, proved before the run

`_registry_candidates.csv` was regenerated from `rosterCandidatePlan --csv` and
`build_targets.py` re-run. All eight then carried:

```
Method = "generated from a verified athletics host"
Roster URL 2025 (known good) = ""      ← nothing to take precedence
```

Target membership unchanged at 2,165 rows, 0 added, 0 removed. No candidate was
promoted to the known-good column before validation, and no identity anywhere in
the chain came from a name.

## 3. Run

```bash
node server/scripts/dbSnapshot.js --label pre-l7f     # VACUUM INTO, integrity ok
npm run roster:acquire -- 2026 2025 --keys /tmp/l7f-eight.txt
```

```
TO ATTEMPT 8      excluded by scope 231
  D2 m 1 · D2 w 2 · D3 w 5      0 NAIA · 0 USCAA · 0 other NCAA
write set: ncaa_d2_mens · ncaa_d2_womens · ncaa_d3_womens        USCAA: NO · NAIA: NO
```

| result | n | programmes |
|---|---:|---|
| `RESOLVED` | **7** | Tuskegee (21) · Wayne State MI (33) · Eureka (14) · Lasell (26) · Mitchell (16) · Saint Mary's IN (24) · Wesleyan GA (18) |
| `ACQUISITION_FAILED` | 1 | Southwest Minnesota State M |
| everything else | 0 | |

**All seven resolved at the `variants` stage** — the generated candidate needed
only the pipeline's own ladder, no browser. State changed for 7 keys, every one
inside the eight.

### Why SMSU failed, exactly

The candidate written to the worklist was
`smsumustangs.com/sports/msoc/2026-27/roster`, which **404s**. The roster is at
`/sports/msoc/roster/season/2026`, which returns 200 with 82 player markers —
L7E's bounded verification found it there, as candidate **ten** of the ladder.

Two things combined:

* The host is genuinely **PrestoSports** (its pages name `prestosports` and it
  is `.aspx`-backed), so the ledger's `platform` is *correct*. But this Presto
  product uses the `roster/season/<year>` shape, which the catalogue attributes
  to NUXT and SIDEARM. Platform-first ordering therefore put a 404 first.
* **Only the first candidate reaches the pipeline.** The generator produces an
  ordered ladder of 24 containing the working URL; `_registry_candidates.csv`
  carries one, and `variants.ladder` expands *that* URL — it cannot cross to a
  different shape family. L7B's reasoning that "the pipeline's own ladder
  expands a candidate" holds within a family and not across one.

No URL was substituted by hand, and the ledger was not relabelled to force a
pass: the platform value is right, so the "correct a demonstrable L7E mistake"
allowance does not apply. Widening `ROSTER_SEASON_YEAR` to include PRESTO on the
evidence of one host would reorder candidates for all 69 PRESTO hosts, which is
not a change to make from a single observation. **Handed to the next stage.**

## 4. Resolved sources

Every programme: one source URL, `high` confidence, current season, institution
and sport confirmed by the host's own `og:site_name` at verification time.

| programme | rows | name | position | class | nationality | hometown |
|---|---:|---:|---:|---:|---:|---:|
| Tuskegee W | 21 | 21 | 21 | 21 | 21 | 21 |
| Wayne State (MI) W | 33 | 33 | 33 | 33 | 33 | 33 |
| Eureka College W | 14 | 14 | 14 | 14 | 14 | 14 |
| Lasell W | 26 | 26 | 26 | 26 | 25 | 25 |
| Mitchell W | 16 | 16 | 16 | 16 | 16 | 16 |
| Saint Mary's (IN) W | 24 | 24 | 24 | 24 | 24 | 24 |
| Wesleyan (GA) W | 18 | 18 | 18 | 18 | 18 | 18 |

One Lasell player carries no hometown and was left empty rather than filled in.
Two international players across the seven; nothing was inferred, and no hometown
became a nationality.

## 5. Sheets and import

| sheet | before → after |
|---|---|
| ncaa_d2_womens | 7,540 → 7,594 |
| ncaa_d3_womens | 9,600 → 9,698 |
| ncaa_d2_mens (in the write set) | 6,977 → 6,977, byte-identical |
| d1 m/w, d3 mens, naia m/w, **uscaa m/w** | **byte-identical** |

**Rows added 152 · changed 0 · removed 0.** Seven programmes gained, none lost.
No manual restore was needed; the L7D sheet-scope contract held on its own for
the second stage running.

Imported after confirming the snapshot opens independently: `roster_players`
277,208 → **277,360**.

## 6. Coverage

| | before → after |
|---|---|
| D1 men / women | 213 / 349, unchanged |
| D2 men | 202, unchanged |
| D2 women | 256 → **258** |
| D3 men | 313, unchanged |
| D3 women | 403 → **408** |
| **NCAA total** | **1,736 → 1,743** |

Legitimate active gaps **18 → 11**, separate from the 7 duplicate registry rows
and 2 inactive rows, which are untouched.

### The residual roadmap

| | n | |
|---|---:|---|
| `TRUSTED_HOST_SITE_TEMPORARILY_UNAVAILABLE` | 2 | Anna Maria M+W — site in maintenance |
| `CLIENT_RENDER_FAILURE` | 2 | Northwood W, Wisconsin-Oshkosh M |
| `SOURCE_NOT_AVAILABLE` | 2 | Bryn Athyn M+W — host serves a 2024 roster |
| `PROGRAMME_STATUS_QUESTION` | 2 | New Jersey City M+W — absorbed by Kean |
| `MANUAL_CANDIDATE_REVIEW` | 1 | Wisconsin-La Crosse M |
| `NO_TRUSTED_HOST` | 1 | Trinity Washington W — 403 to every route |
| `ACQUISITION_FAILED` | 1 | Southwest Minnesota State M — see §3 |

## 7. Evidence

**1 canonical pair affected. 1 generic → personalised. 0 supplemented. 4,741
unchanged.** Corpus 1,758 → **1,759** personalised, 2,845 → 2,846 sentences, 221
held claims unchanged.

The pair is `qa-fixture-womens-soccer-0001 | Saint Mary's College (IN)`, which
gained **`POSITION_GRADUATION`** in the RELEVANCE slot:

> I was having a look through your program and noticed **one midfielder is
> listed to graduate in 2027 — Ava Slater**.

Checked against the imported roster: Ava Slater, `MIDFIELD`, class label `Gr.`,
estimated graduation **2027** — and she is the **only** 2027 graduate on the
roster, so "one midfielder" is exact rather than merely true. The athlete is a
midfielder in the 2027 class, so the positional and year relevance both hold.
Programme identity correct, present tense correct for a current roster, no
country claim made, one evidence sentence.

**GOOD 1 · ACCEPTABLE 0 · WEAK 0 · BAD 0.**

### Data depth

All seven are **`CURRENT_ONLY`** — the 2026 season and nothing else. That is why
one personalisation appeared rather than seven: the arrival, historical and
turnover families need more than one season, and only the current-roster
families can fire. Nothing was inferred from a single year.

## 8. Baselines

Manifest `860c7b439677ac86` → `fe23cac71c83ec0e`, **UNCOMPARABLE**
(`roster_players` and `roster_freshness` both moved). All six repinned.

Measured against the pre-L7F snapshot, **using `projectBehavioural` — what the
baselines actually hash since L7D2**:

| surface | pairs moved |
|---|---:|
| `OUTBOUND_DECISION` · `OPERATOR_WIRE` · `LOG_PAYLOAD` · `OPERATOR_EVIDENCE` | **7** each |
| `EMAIL_BODY` | **1** |
| `COACH_COMPOSITION` | moved, same seven programmes |

**Every moved pair is one of the seven imported programmes.** Nothing else in
the corpus moved at all.

This is L7D2 paying for itself, visibly. Measured with the *old* unprojected
serialisation, `OPERATOR_WIRE` and `LOG_PAYLOAD` show **3,591** changed pairs —
3,584 of them differing only in `rosterUpdatedAt`, exactly the noise L7D2
removed. Under the projection the same import reads as 7. A stale measuring
script produced the 3,591 figure mid-stage and was corrected rather than
reported.

**L7E's four pairs re-confirmed**: Eureka men's still carries
`eurekareddevils.com/sports/msoc/2026-27/…` and SMSU women's still carries
`smsumustangs.com/sports/womens-soccer/roster` as their operator `sourceUrl`.
Established in L7E, unchanged here, and not counted as L7F behaviour.

**P6 unchanged.** New data producing existing kinds is not a semantic change.

## 9. Invariants

* target universe **2,165** before and after
* state changed for **7 keys, all inside the eight**
* SMSU remains `failed`, in the universe, and retryable
* every excluded programme is untouched and still eligible

## 10. Debt

**Only the first candidate reaches the pipeline** — the finding above. The
generator ranks 24 and the worklist carries one, so a first guess on the wrong
shape family is fatal even when the right URL is ranked tenth. This is the next
stage's most valuable target.

**The shape catalogue's provider attribution is incomplete.** `ROSTER_SEASON_YEAR`
is attributed to NUXT and SIDEARM; PrestoSports' `.aspx` product uses it too.
Worth re-measuring across the corpus rather than patching from one host.

**Tests pinned to a moving world.** Three assertions expired this stage: an
absolute `roster_players` count, a `20 < cohort < 60` range, and a list of
programmes named as "still a gap" that acquisition had just resolved. All three
were mine, all three are now computed rather than named. The lesson had already
been written into one of those very files and I wrote the next one anyway.

**Carried forward unchanged:** `BASE_ONLY` in the strict profile — now exactly
the seven known-wrong rows after L7E repaired Regis, so excluding the class costs
nothing; and `verified: true` as a caller-supplied boolean, with no new caller
introduced here.

## 11. Next cohort

The eleven above. The cheapest wins are the single-candidate bottleneck (SMSU,
and insurance for everything after it) and Anna Maria's two, which need only
their site to come back.
