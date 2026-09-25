# L7R — a roster that was in the page all along

L7Q left two programmes serving a page titled 2026 that `parse_any` read as
zero players. This stage asked why, and the answer was not one thing.

**George Mason and Iowa are two unrelated defects that happen to produce the
same number.** One is a parser that does not exist; the other is a parser that
does, looking for the wrong words. And George Mason has a second blocker
underneath the first that L7R is not allowed to touch.

Result: **one parser family added**, 4 cohort programmes now readable, **2
directly unlocked**, the validation set behaving correctly at 1 resolved and 6
correctly refused — and **bulk acquisition blocked**, because the unscoped
`absorb` defect fired again, this time on a programme that had already
succeeded.

---

## Containment

Started at `6990b62`, nothing intervening, tree clean. `programme_status` 6
rows, `roster_gap_reviews` 7, coverage 1,620 / 128 / 125 / 3, manifest
`884d06a7bb3e17ac` under V3 with all six baselines PASS. Because the unscoped
`absorb` is known, the hashes were recorded before anything ran:
`_targets.csv` `ad7018a8…`, `state2026.json` `b95162e3…`, and all ten roster
sheets.

## The validation set, derived rather than retyped

The seven are the L7Q pilot members that are still 2026 gaps. To prove that is
what they are, the L7Q cohort was rebuilt from the pre-L7Q snapshot and
re-sampled — reproducing **cohort `10ec47d4b202a683`, digest
`db726c84bfa19295`** and the same twenty keys. Intersecting those twenty with
today's gap queue returns exactly seven, and the other thirteen are gone from
the queue because they now hold a 2026 roster.

## George Mason

`https://gomason.com/sports/mens-soccer/roster/2026` — 200, 649 KB, titled
*2026 Men's Soccer Roster - George Mason University Athletics*. **28 players,
present in the raw HTML.**

Sidearm, rendered by Vue. The roster is hydration data:

```js
new Vue({ el: '#vue-rosters', data: () => ({
  roster: {
    title: "2026 Men's Soccer Roster",
    season: { id: 164, title: "2026" },
    sport:  { title: "Men's Soccer", gender: "m", sport_name_slug: "mens-soccer" },
    players: [ { first_name, last_name, hometown, highschool, position_short,
                 position_long, academic_year_short, jersey_number, rp_hide, … } ]
  } }) })
```

The object **states its own season, sport and gender** — better roster context
than any title regex. A thin JSON-LD `ItemList` of 28 `Person` entries sits
alongside it carrying only name and gender.

**Root cause, two layers:**

1. **No parser reads Sidearm's Vue hydration.** The page has one `<table>` and
   one `sidearm-roster-player` string, both in templates, so every HTML parser
   correctly finds nothing.
2. **The pipeline cannot reach that URL.** Its 2025 known-good is
   `/roster.aspx?rp_id=9088`, so its whole ladder is legacy shapes. Walking all
   eight rungs today:

   | rung | result |
   |---|---|
   | `/roster.aspx/2026`, `/season/2026`, `/2026-27` | 200, body under the size floor |
   | `/roster.aspx` | **301 → `/sports/roster`**, titled *General* — all sports, no sport |
   | `?rp_id=9088/2026`, `/season/2026`, `/2026-27`, `?rp_id=9088` | 0 parsed |

   `/sports/mens-soccer/roster` is **not in the ladder at all.**

Layer 2 is the query-string advancement debt, carried forward and out of scope.
So **a parser fix alone cannot resolve George Mason**, and it must not: accepting
a roster from a page titled *General*, which establishes no sport, would break
the acceptance contract. Its own women's programme proves the point — same host,
a modern 2025 source, a working candidate, and not in the cohort at all.

## Iowa

`https://hawkeyesports.com/sports/wsoc/roster` — 200, 1.38 MB, titled *Women's
Soccer 2026-27*. **28 players, present in the raw HTML.** (`/roster/2026` is a
soft 404 that answers 200; the bare rung is rung 3 of Iowa's ladder, so the
pipeline does reach this page.)

Nuxt, not Sidearm. No Vue instantiation, no tables, no cards. One
`<script id="__NUXT_DATA__">` holding a flat array in which every value may be
an index into the same array. It declares exactly one roster container,
`{players, meta}`, and its entries point at a person node:

```
entry  { player → …, class_level → {name, abbreviation, order},
         player_position → {name, abbreviation},
         jersey_number_label, publication_state }
player { first_name, last_name, full_name, gender, hometown, high_school, slug, … }
```

**Root cause: `parse_nuxt` exists and its key signature is camelCase.** It
matches dicts carrying `firstName`/`lastName`; this vocabulary is snake_case
and nested. `PKEYS <= set(entry)` was never true, `parse_nuxt` returned nothing,
no HTML parser found a table or a card, and 28 players read as zero.

Four other D1 sites serve the camelCase form and parse today — Boston
University, Drexel, Murray State, Oklahoma State — which is precisely why the
gap was invisible: the provider was already "supported".

## Same family? No.

| | George Mason | Iowa |
|---|---|---|
| provider | Sidearm | Nuxt |
| rendering | Vue, `#vue-rosters` | Nuxt SSR + hydration payload |
| data location | `new Vue({data:()=>({roster:{…}})})` | `<script id="__NUXT_DATA__">` |
| encoding | plain nested JSON | flat array, values as indices |
| roster context | declared: season, sport, gender | not declared; page title only |
| JSON-LD | yes, name + gender only | one block, no roster |
| failure | no parser exists | parser exists, wrong vocabulary |
| also blocked by | unreachable URL (out of scope) | — |

Nothing is shared, so nothing was forced into one abstraction.

## Scope: one family, chosen on the prevalence measurement

Phase 7 exists to gate this, and it did. Every one of the 125 remaining cohort
programmes was fetched and classified, then the blocked ones re-fetched at the
bare rung their ladder already offers:

| structure | blocked programmes at a **reachable** URL |
|---|---|
| **Nuxt, snake_case** | **4** — Iowa W, New Mexico W, Notre Dame M, Notre Dame W |
| Sidearm Vue | **0** |

Sidearm Vue appears in the cohort only at George Mason and Bradley, both behind
the same unreachable `roster.aspx` rung. A Sidearm-Vue parser would therefore
unlock nothing in L7R and could be validated only by a fixture. It is fully
documented above so the next stage can build it **together with** the candidate
fix it depends on, which is the only order in which it can be proved.

Both families were also checked for regression surface: of the 102 cohort pages
the shipped parsers already read, **zero** carry either structure.

## The fix

`lib.parse_nuxt_roster`, alongside the `parse_nuxt` it extends — Phase 6's
preference for an existing provider parser over a new generic heuristic, and the
provider identity here is unambiguous.

**Anchored on the container, not on a name shape.** It walks the declared
`players` list and nothing else. A staff directory, a schedule, a news index and
an opponent list have no such container — and the staff block on these very
pages sits in one of its own, `roster-713-staff-members-list-page-1`. Two
containers means two rosters and no way to tell from the payload which sport is
wanted, so it refuses rather than guesses.

**One reference level, and only to a string.** The existing `_scal` recurses
until it finds a string, which is right for the payloads it was written for and
wrong here: this vocabulary stores real numbers as entries too, so following one
lands on an unrelated string. Iowa's `height_inches` resolved to a photo's alt
text and its `id` to a different player's slug — values that look perfectly
plausible and belong to somebody else. `_nstr` resolves exactly one level, so a
number can never be mistaken for a pointer. A fixture pins this with heights
chosen to point at real entries, so a recursing resolver would silently succeed
with the wrong data.

### Acceptance contract

A Nuxt payload yields a roster only when all of the following hold. Everything
downstream is unchanged.

1. `__NUXT_DATA__` exists and parses.
2. **Exactly one** node declares a non-empty `players` list.
3. Each entry resolves, one level, to a dict.
4. An entry is skipped unless `publication_state` is absent or `published`.
5. An entry with a truthy `hide` is skipped.
6. A name must come from an explicit name field; a row without one is dropped.
7. Position and class come only from their own nodes; absent stays empty.
8. References resolve one level and only to strings.

It asserts no season and no institution of its own. The host in the URL remains
the institution gate and the page title remains the season gate — proved by
fixture: the same payload under a *2025-26* title is refused with `page season
is not 2026`. The ≥5 player floor, the turnover gate and the implausible-count
check all still apply.

### Placement

Registered **last** in `parse_any`'s ranking loop. The winner is decided by a
strict `>`, so a reader placed last can only take a page no other parser read as
well or better. Vanderbilt and Virginia carry this same payload and are already
read by `table` at 26 and by `roster-card` at 38; being last is what guarantees
they keep the owner they have.

### Fields

Extracted, because the page states them: **name, position, class/year,
hometown**. Passed through in the page's own words — Iowa's `1st`–`5th`, Notre
Dame's `Freshman`/`Fifth Year` — because `grad_for_season` already resolves both
dialects correctly, and a translation would be a second opinion nobody asked for.

Deliberately **not** taken: nationality and country (never inferred from a
hometown — the pipeline derives those later, for every parser alike), height,
weight, jersey number, major, biography, and graduation year, which is derived
downstream from the class label rather than asserted here.

### Tests and regression

18 network-free fixtures, mostly refusals: no roster container, a staff block, a
schedule, an empty hydration shell, two rosters at once, a squad under the floor,
last season in a current shell, an unpublished player, a hidden player, a
nameless row, a number not followed as a pointer, nothing inferred from a
hometown, and the camelCase vocabulary left to the parser that owns it.

Across all 125 cohort pages, with the fix in place:

| | |
|---|---|
| parser ownership changed | **2** — Notre Dame M and W, from a `table` read of **1** player to 28 and 30 |
| player count changed under the same owner | 0 |
| newly readable (≥5) | 2 |
| previously readable, now refused | **0** |

All 170 pipeline tests pass, including the Presto, Trinity list-roster,
multi-candidate, state-integrity and turnover fixtures.

## The seven

Classified from current evidence before the run, then run through the normal
architecture with no manual URLs, no bypasses, no hand repairs, no candidate
changes and no turnover-rule changes.

| programme | expected | actual | why |
|---|---|---|---|
| Worcester State W | RESOLVE | **RESOLVED** | `variants`, `table`, 32 players, 66% overlap, 20/21 aged |
| Iowa W | REFUSE | REFUSED | **parser fixed, 0 → 28**; turnover gate refuses at 100% overlap, 15/28 aged |
| George Mason M | REFUSE | REFUSED | correct URL not in its ladder; the reachable one is sport-less |
| Murray State W | REFUSE | REFUSED | 100% overlap, 6/26 aged; bio-page reference |
| Vanderbilt W | REFUSE | REFUSED | 96% overlap, 13/25 aged; keeps its `table` owner |
| Frostburg State M | REFUSE | REFUSED | 97% overlap, **0/30 aged** — genuinely last season |
| Valley Forge W | REFUSE | REFUSED | `uvfpatriots.com` still does not resolve |

**1 resolved, 6 refused, and every refusal is the pipeline being right.** No gate
was weakened to improve that ratio.

### Iowa is the interesting one

The parser gap is genuinely fixed — the bare rung now reads 28 players with
names, positions, classes and hometowns — and Iowa is now blocked by something
else. Its 2025 reference is in two dialects at once:

```
Sophomore   -> 3rd   AGED      Sr.     -> 4th   moved
Junior      -> 4th   AGED      Jr.     -> 3rd   moved
Freshman    -> 2nd   AGED      Fr.     -> 1st   moved
Redshirt Fr -> 3rd   AGED      RS Jr.  -> 4th   moved
```

Seventeen long-form rows aged correctly. Eleven short-form rows sit **exactly
one season behind** — their 2026 ordinal equals their 2025 class. Iowa's
candidate has always been the bare "now" page, so its 2025 row set was
assembled from that page across time and 11 of its 28 rows carry 2026-era
labels. 15 of 28 aged is below the 0.75 threshold and the gate refuses.

That is the carried **untrustworthy historical reference** debt, and the refusal
is correct: the comparison, not the page, is what cannot be trusted.

Also worth recording: the durable reason stored against Iowa names rung 0,
`/roster/2026 -> too few players parsed (0)`, because that was the *last* rung
tried. The informative refusal happened at rung 3. L7J froze reasons at the
first attempt; this is the same effect one level down, at the rung.

## Containment after the run

**Roster output: exactly one programme changed.** Nine of the ten sheets are
byte-identical; `ncaa_d3_womens` differs by Worcester State alone. Import added
**32 rows**, changed 0, removed 0. Against the pre-run snapshot, the content
digest of every non-Worcester-State 2026 row is identical, no closed season
moved (218,938 both sides), and `colleges`, `programme_status`,
`roster_gap_reviews` and `athletics_domains` are unchanged.

`_targets.csv`: 7 rows changed, **all seven within scope.**

### The absorb defect fired again — on a success this time

One programme outside the seven changed state: **`Bentley||womens-soccer`**,
in one field.

```
status  done          SAME        url     …/roster/2026   SAME
n       30            SAME        parser  sidearm-html    SAME
rows    30 entries    byte-identical
tried   3 -> 6 entries            DIFFERS
```

The three appended entries are L7Q's pre-fix turnover refusals, re-merged from
stage files by `state.absorb()`, which takes a whole file with no reference to
run scope. No roster output moved and no product surface moved.

**But this is a worse signal than L7Q's, and it is the readiness answer.** In
L7Q the leak hit SMSU, already failed. Here it re-presented *failure records for
a programme that had succeeded*, and the only thing standing between that and a
demoted roster was the `done → failed` KEEP rule L7J installed. On a bulk run
over 124 programmes, against stage files from several stages, that is a
correctness risk and not a cosmetic one.

Not restored. There is no established safe procedure for hand-editing the state
file, and doing so would both hide the defect and desynchronise the file from
what `absorb` actually did.

## Coverage

| | before | after |
|---|---|---|
| active identity denominator | 1,748 | **1,748** |
| holding a 2026 roster | 1,620 | **1,621** |
| missing a 2026 roster | 128 | **127** |
| identity-level coverage | 92.7% | **92.7%** |
| historical-only cohort | 125 | **124** |
| never-fetched | 3 | **3** |

## What now blocks the remaining 124

Every one walked through its real ladder with the real parsers and the real gate:

| mechanism | n | division | gender |
|---|---|---|---|
| **PAGE_PRIOR_SEASON** | **83** | D3 77 · D2 5 · D1 1 | M 37 · W 46 |
| **WOULD_RESOLVE_NOW** | **25** | D3 15 · D1 8 · D2 2 | M 10 · W 15 |
| TURNOVER_REFUSED | 9 | D1 7 · D2 1 · D3 1 | W 8 · M 1 |
| THIN_PARSE (1–4 players) | 5 | D3 5 | W 4 · M 1 |
| PARSE_ZERO | 2 | D1 2 | M 2 |

**25 would resolve on a plain re-run today** — including both Notre Dame
programmes, read by the new family. The dominant remainder, 83, is sites still
serving the prior season at the URLs the ladder reaches: a publication-and-
candidate question, not a parsing one.

The **2 remaining PARSE_ZERO are Bradley and George Mason**, both the Sidearm
Vue structure behind the same unreachable `roster.aspx` rung. The next parser
problem and the carried candidate debt are the same problem.

### Parser impact

The new family reads **4** of the 124 and directly unlocks **2** (Notre Dame M
and W). Iowa and New Mexico became readable and are now turnover-refused, which
moves them out of the parser bucket and into the reference-quality one. This is
an architecture-coverage figure, not a claim that all four will resolve.

## Evidence and email

| | |
|---|---|
| pairs affected | **1** — *QA Fixture (women's soccer) → Worcester State University* |
| generic → personalised | **0** |
| supplemented | 0 |
| rendered sentences | 2,848 unchanged |
| held claims | 221 unchanged |
| newly personalised emails | **0** |

**GOOD 0 · ACCEPTABLE 0 · WEAK 0 · BAD 0.** Nothing to review, and nothing
blocking. P6 unchanged, no copy policy touched.

The surface split is worth keeping. Four baselines moved and two did not:

```
OUTBOUND_DECISION   284b9c2d -> 6d3866f2   moved
OPERATOR_WIRE       68211b09 -> 3ffc6fd9   moved
LOG_PAYLOAD         a7d1ade7 -> 04a42a7c   moved
OPERATOR_EVIDENCE   73c466ce -> 3d3787b9   moved
COACH_COMPOSITION   e9b3cd34 -> e9b3cd34   UNCHANGED
EMAIL_BODY          7564828a -> 7564828a   UNCHANGED
```

Worcester State gained a 2026 squad, so its programme context changed and every
surface carrying that block moved. Nothing qualified as a claim, so the email
text and the coach composition are byte-identical — a per-pair diff confirms
**zero** email bodies changed across all 4,741 pairs. Evidence *considered and
declined* is exactly what these surfaces are separated to show.

## Manifest

```
884d06a7bb3e17ac  ->  e2695737104c00b4   (V3)

roster_players     277,866 rows   (+32)
roster_freshness     1,949 rows   (+1)
players, colleges, coaches, athletics_domains, programme_status   unchanged
```

Predicted before repinning and confirmed, including which five tables could not
move. Repinned after attributing the single moved pair. Six PASS afterwards.

## Bulk readiness: **NOT_READY_FOR_BULK**

| criterion | verdict |
|---|---|
| 1. parser gap fixed safely | **yes** — one family, 18 fixtures, 0 regressions, 0 previously-accepted rosters lost |
| 2. validation programmes behave correctly | **yes** — 1 resolved, 6 correctly refused, no gate weakened |
| 3. no broad parser regression | **yes** — 2 ownership changes, both from an unusable 1-player read |
| 4. remaining dominant failures understood | **yes** — 83 / 25 / 9 / 5 / 2, each with a mechanism |
| 5. `state.absorb` the only material containment blocker | **it is a blocker, and it fired** |

Four of five are met. The fifth is not, and Phase 24 is explicit that this alone
withholds bulk. It is the right call on its own evidence: on a scoped
seven-programme run, `absorb` re-presented stale failure records for a resolved
programme, and only L7J's merge precedence prevented a demotion.

**Next stage: scope `absorb` to the run (L7S).** It is small — the merge policy
is already correct and centralised, so only the input selection needs a scope —
and it is the single thing standing between here and a 124-programme run in
which 25 would resolve immediately.

After that, in order of measured value: the 83 prior-season pages (a candidate
and publication question), then the Sidearm Vue parser **together with**
query-string candidate advancement, since Bradley and George Mason need both and
neither can be validated without the other.

## Debt carried forward, untouched

`state.absorb` scope · query-string source advancement ·
`build_targets.py` rewriting the worklist on import · untrustworthy bio-page and
bare-page historical references · the seven registry duplicates ·
Mississippi Christian · the Trinity advisory verifier · the `verify_gate`
demotion API · the `verified:true` authority cleanup.
