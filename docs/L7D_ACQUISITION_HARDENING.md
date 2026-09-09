# L7D — acquisition hardening

Three defects came out of L7C and this stage closed them. Then it re-attempted
the six programmes the first one was blocking.

**Four of the six resolved. 85 roster rows imported. The USCAA sheet stayed
byte-identical without anyone restoring it.** A fourth defect surfaced during
the live run and stopped it: an empty shard file was disabling run scoping
entirely, and two browser shards walked the whole target universe before the run
was killed. Nothing was absorbed and no sheet moved, but the scope had been lost.

---

## 1. The six, reproduced

Derived from L7C's own browser stage files — the programmes whose recorded
failure was `too few players parsed`, which is what separates them from a stale
season or a redirect.

| programme | div | host | provider | candidate |
|---|---|---|---|---|
| Carlow M | D3 | athletics.carlow.edu | PRESTO | `/sports/msoc/2026-27/roster` |
| Carlow University W | D3 | athletics.carlow.edu | PRESTO | `/sports/wsoc/2026-27/roster` |
| Goucher M | D3 | athletics.goucher.edu | PRESTO | `/sports/msoc/2026-27/roster` |
| Goucher College W | D3 | athletics.goucher.edu | PRESTO | `/sports/wsoc/2026-27/roster` |
| Northwood W | D2 | gonorthwood.com | PRESTO | `/sports/wsoc/2026-27/roster` |
| Wisconsin-Oshkosh M | D3 | uwoshkoshtitans.com | SIDEARM | `/sports/mens-soccer/roster/2026` |

Digest `521214c1c947859c`, 6 lines.

## 2. Root cause — three problems wearing one label

Rendering each page and reading the DOM showed the six were not one failure.

**Four are a parser gap (Carlow M+W, Goucher M+W).** The pages render, the
titles name the right institution, sport and season — *"2026 Men's Soccer Roster
- Carlow University"* — and the roster is right there in the DOM as flip cards.
`parse_roster_cards` wants a `card__title-link`; `EXTRA_JS` in `browse.py` wants
an `a[href*="/roster/"]`, and these pages carry neither: the bio link is
`/bios/`. Every card was found and every card was skipped for want of a name.

**One is a redirect (Northwood W).** `gonorthwood.com/sports/wsoc/2026-27/roster`
lands on `/landing/index` with the site's own title. There is no roster at that
path to parse.

**One has moved on (Wisconsin-Oshkosh M).** The site answers with
*"2027 Men's Soccer Roster"* and two rows. It has published next season and not
this one.

A browser is genuinely required for all of them — an AWS WAF returns **zero
bytes** to a plain fetch of `athletics.carlow.edu` — so `CLIENT_RENDER_FAILURE`
was a fair label. It was just not the whole story for four of the six.

## 3. The extraction

`lib.parse_presto_cards`, registered in `parse_any` beside the other parsers. It
reads the most structured thing on the page, which is the back of each card:

```html
<span class="firstname">Austin</span><span class="lastname">Fabry</span>
...
<li><span class="fw-bold">Position:</span> GK</li>
<li><span class="fw-bold">Class:</span> Fr</li>
<li><span class="fw-bold">Hometown:</span> Pittsburgh, Pa.</li>
```

**Fields are taken by their label, never by position.** The visible front of a
card reads `Austin | Fabry | 0 | GK | Fr | 5-11`, and reading that would mean
deciding the fourth token is a position — true here, and a silent mis-column the
first time a site drops the jersey number.

**Provider-specific: yes, and bounded.** It is one function selected by markup
(`[class*="player-card-wrapper"]` with a `bio-data` list), sitting in the same
list as `parse_sidearm_html`, `parse_tables` and `parse_roster_cards`. No
provider condition is scattered anywhere else, and `parse_any` still keeps
whichever parser yields the most players.

**Nationality is not set.** The parser fills `home` and has no opinion about
nationality; `geo()` derives it downstream from the hometown exactly as it does
for every other parser. The record keys are asserted to be `{name, cls, pos,
home}` and nothing else.

Every gate is untouched: the ≥5-row floor, `run.evaluate`, the turnover gate,
the season check, source verification.

### Fixtures

Two captured pages, images and inline styles stripped, ~20 KB each, in
`tools/roster_pipeline/__fixtures__`. 13 network-free tests cover extraction,
label-keyed reading, institution and sport in the title, an international
hometown staying a hometown, furniture with a name and nothing else, a page with
no cards, a one-card bio page falling under the row floor, duplicate nesting
counted once, and the two real stale-season titles being refused (`2024` at Bryn
Athyn, `2027` at Wisconsin-Oshkosh).

## 4. Sheet-write authority

`write_out.py` rebuilt all ten sheets from durable state on every run, which is
how an NCAA acquisition rewrote the USCAA file twice — L6D found it, L7C
repeated it, and both times the bytes were restored by hand.

**The rule: run scope decides which COMPLETE sheets are opened. Nothing decides
which rows go in a sheet that is opened.**

```python
def sheet_scope():
    scoped = state.attempt_targets()
    if len(scoped) == len(state.targets()):
        return None                       # unscoped maintenance rebuild: all sheets
    return {(r['Division'], r['Sport']) for r in scoped}
```

Sheet identity is `(Division, Sport)` — the key `FILES` already used — derived
from the attempt cohort. No association is named anywhere, so the rule
generalises; there is no "skip USCAA".

Row scoping is **not** used and must not be: a sheet is the whole population of
a division and sport, and filtering it to the cohort would delete every other
programme in it. `write_out.py` also moved onto `season_dir()`, so it honours
`RB_ROOT` like the rest of the seam.

On this run the write set was three sheets:

```
WRITE  ncaa_d2_womens · ncaa_d3_mens · ncaa_d3_womens
SKIP   ncaa_d1_mens · ncaa_d1_womens · ncaa_d2_mens · naia_mens · naia_womens
SKIP   uscaa_mens · uscaa_womens          USCAA in write set: False
```

**14 tests**, including the exact drift: a USCAA sheet on disk carrying
`Pennsylvania State University Athletic Conference` while state says
`Eastern College Athletic Conference`, an NCAA-only run, and the file asserted
byte-identical afterwards. Reverting the guard fails three of them.

The unscoped full rebuild is also tested, and it is stated plainly that it
*would* still overwrite the drifted USCAA sheet. L7D stops an NCAA run reaching
it by accident; it does not decide which conference value is right.

## 5. The defect the live run found

The runner shards remaining keys four ways and hands each shard to
`browse.py --keys`. On a six-programme run, two of those shards are empty — and
`browse.py` read the scope as:

```python
if keyset and k not in keyset: continue      # empty set is falsy
```

An empty key file therefore meant **no restriction**, and both empty shards
began working through the entire universe. It was caught in the logs (CUNY
Medgar Evers, Cal Lutheran, Caltech, Carleton…) and the run was killed.

Damage: none. `absorb` had not run for the browser stage, all ten sheets were
byte-identical to the pre-run backup, and durable state held exactly the four
in-scope programmes the variants stage had resolved. The contaminated stage
files — 40 out-of-scope entries each — were deleted rather than left for a later
`absorb` to find, which is the hazard a stage file always is.

Two fixes: `keyset` is now `None` for "no restriction" and a set otherwise
(including empty), and the runner creates `min(4, len(keys))` shards so an empty
one is never made. Both are tested.

## 6. The SQLite snapshot

`PRAGMA journal_mode` is `wal`, and the WAL held 22 MB. A committed transaction
lives there until a checkpoint, and a checkpoint cannot run while any connection
holds a read — so `fs.copyFileSync(db, backup)` copies the last **checkpointed**
state and silently drops everything since. L7C's pre-import backup was taken
that way; it still carried `players.email_template` values a migration had
already cleared, which made a before/after comparison appear to show 2,338
emails changing when the real number was three.

**Five call sites in this repository were doing exactly that** —
`loadMatchingInputs`, `promoteCoaches`, `loadAcademicRatings`,
`refreshGraduationYears`, `migrateEmailTemplates`. All five now call
`snapshotDatabase`.

`server/lib/dbSnapshot.js` uses `VACUUM INTO`, which runs inside a read
transaction and writes one standalone file — no `-wal` or `-shm` to remember. It
verifies the copy with `integrity_check` and a row-count witness across five
tables, and refuses to overwrite an existing rollback point.

```bash
node server/scripts/dbSnapshot.js --label pre-l7d
```

**7 tests.** Rows committed with a reader open are in the snapshot and the live
database moving on afterwards does not touch it. The old method is included as a
control: with nothing checkpointed the plain copy has no schema at all, because
`CREATE TABLE` is a committed transaction like any other. That assertion is
written as "no better than", not "strictly worse", so a future SQLite that
checkpoints more eagerly does not make the suite lie.

## 7. The run

```bash
node server/scripts/dbSnapshot.js --label pre-l7d
npm run roster:acquire -- 2026 2025 --keys /tmp/l7d-six.txt
```

```
TO ATTEMPT 6      excluded by scope 237
  D2 w 1 · D3 m 3 · D3 w 2        0 NAIA · 0 USCAA · 0 other NCAA
```

| result | n | programmes |
|---|---:|---|
| `RESOLVED` | **4** | Carlow M (23) · Carlow University W (15) · Goucher M (31) · Goucher College W (16) |
| `CLIENT_RENDER_FAILURE` | **2** | Northwood W · Wisconsin-Oshkosh M |
| everything else | 0 | — |

All four resolved at the **variants** stage, over plain HTTP — the new parser
was the whole fix for them, and no browser was needed. Northwood still lands on
its own landing page and Wisconsin-Oshkosh still serves 2027.

## 8. Output and import

| sheet | before → after |
|---|---|
| ncaa_d3_mens | 8,465 → 8,519 |
| ncaa_d3_womens | 9,569 → 9,600 |
| ncaa_d2_womens (in the write set) | 7,540 → 7,540, byte-identical |
| d1 m/w, d2 mens, naia m/w, **uscaa m/w** | **byte-identical** |

**Rows added 85 · changed 0 · removed 0.** Four programmes gained, none lost.
**No manual restore was needed** — the first NCAA run in three stages that left
USCAA alone on its own.

Imported after confirming the snapshot opens independently: `roster_players`
277,123 → **277,208**. Coverage: name 85/85, position 85/85, class 85/85,
hometown 84/85 — one Goucher card carries none, and it was left empty rather
than filled in.

## 9. Coverage

| | before → after |
|---|---|
| D1 men / women | 213 / 349, unchanged |
| D2 men / women | 202 / 256, unchanged |
| D3 men | 311 → **313** |
| D3 women | 401 → **403** |
| **NCAA total** | **1,732 → 1,736** |

Legitimate active gaps 22 → **18**:

| | n |
|---|---:|
| `NO_TRUSTED_HOST` | 13 |
| `CLIENT_RENDER_FAILURE` | 2 — Northwood W, Wisconsin-Oshkosh M |
| `SOURCE_NOT_AVAILABLE` | 2 — Bryn Athyn M+W, site serves a 2024 roster |
| `MANUAL_CANDIDATE_REVIEW` | 1 — Wisconsin-La Crosse M |

## 10. Evidence impact

**0 canonical pairs affected. 0 generic → personalised. 0 supplemented. 0 BAD
emails, because there are no new emails to review.** Corpus unchanged at 1,758
personalised / 2,984 generic, 2,845 rendered sentences, 221 held.

That is the correct result and was checked rather than assumed. All eight corpus
pairs at the four new programmes select nothing, before and after. Carlow's men's
squad has two midfielders graduating 2027 and the men's fixtures are a forward
and two defenders; Carlow's women's squad has one forward graduating 2027 and
the women's fixture is a midfielder; Goucher has no 2027 graduates at all.
Nothing matched, so nothing fired.

### What moved, and why

| surface | pairs changed | cause |
|---|---:|---|
| `OUTBOUND_DECISION` | **8** | the four new programmes now have roster facts, so kinds appear in `dispositions` — every one `NOT_LICENSED`, i.e. considered and refused |
| `OPERATOR_EVIDENCE` | **8** | the same eight pairs; `ROSTER_OPPORTUNITY` and `RECRUITMENT_PATHWAY` populated for the operator panel |
| `OPERATOR_WIRE` | 3,584 | **`rosterUpdatedAt` only** |
| `LOG_PAYLOAD` | 3,584 | **`rosterUpdatedAt` only** |
| `COACH_COMPOSITION` | 0 | digest unchanged |
| `EMAIL_BODY` | 0 | digest unchanged |

Manifest `54d834dcc8df2001` → `a54be838875e8fef`, **UNCOMPARABLE**;
`roster_players` and `roster_freshness` both moved. All six repinned on the
account above — every difference is either the four new programmes' own pairs or
a provenance timestamp, and no email body changed anywhere.

**P6 unchanged.** New data producing existing kinds is not a semantic change.

### L7C repin audit

L7C repinned all six after +378 rows and +3 personalisations. L7D's
surface-by-surface measurement corroborates the mechanism: `EMAIL_BODY` moves
only when a body changes (3 pairs in L7C, 0 here, and its digest is unchanged
across L7D), while `OPERATOR_WIRE` and `LOG_PAYLOAD` move on any import at all.
Nothing unexplained was hidden in that update. **Accepted; not reopened.**

## 11. Invariants

* target universe 2,165 before and after, membership identical
* the aborted run changed state for **4 keys, all in the six**
* the two remaining failures are still in the universe and still eligible
* all ten sheets were byte-identical to the pre-run backup after the abort

---

## Debt carried forward

**A baseline that moves on every import.** `OPERATOR_WIRE` and `LOG_PAYLOAD`
embed `rosterUpdatedAt`, a wall-clock scrape time the import re-stamps on all
1,926 programmes whether or not their data changed. Those two surfaces can
therefore never be stable across an import, and 3,584 pairs "moved" here with no
behavioural difference at all. Worth deciding whether a provenance timestamp
belongs inside a behavioural hash.

**Still open from earlier stages:** 13 no-host programmes (L7E domain
discovery); Bryn Athyn M+W source-not-available; Wisconsin-La Crosse manual
review; the `BASE_ONLY` strict-policy decision; the `verified: true` caller
assertion; 2026 roster sheets not being repository seed data.

**The USCAA value itself.** L7D stops an NCAA run touching that sheet. It does
not decide whether PSUAC or ECAC is right, and the state-vs-sheet authority
question — a hand repair never written back to state — is unresolved.
