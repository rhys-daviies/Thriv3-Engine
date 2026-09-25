# L7L — a front door for the ten

```
College DB ──→ NCAA Roster Gaps ──→ [ PROGRAMME | MACHINE FINDINGS | OPERATOR REVIEW ]
                                            read-only ↑        ↑ the only thing a person authors
```

**Zero reviews written. reviewed 0, unreviewed 10.** No roster acquired, no
dataset, registry, sheet or pipeline state touched. Manifest unchanged, six
baselines PASS unrepinned, P6 unchanged.

---

## 1. Where it lives, and why there

**`/colleges/roster-gaps`, reached by one link on the College DB page.** One
entry point, and not a sixth navigation item.

The nav carries five top-level domains — Home, Sports, Players, College DB,
Graduating DB. A roster gap is not a domain; it is **college data that is
incomplete**, which is what College DB already owns. And the queue is ten rows
that end when they have been reviewed, which does not earn permanent chrome in
a header every page renders.

Everything reuses what is there: the `rounded-xl border` table from
`Colleges.jsx`, `Button` pill filters, `Badge` for division, the Radix `Dialog`
from `components/ui`, and the `useState` error block from `PhilosophyRow.jsx`.
No new UI primitives and no second visual language.

## 2. The API

`server/routes/rosterGaps.js`, mounted at `/api` beside `campaignsRouter` and
for the same stated reason: `roster_gap_reviews` must not be reachable through
the unvalidated `ENTITIES` pass-through, where a client could store a
disposition the vocabulary refuses.

| | |
|---|---|
| `GET /api/roster-gaps` | the queue, the summary and the vocabulary |
| `POST /api/roster-gaps/review` | create or update one review |
| `GET /api/roster-gaps/review` | one review, by school and sport |

**The three layers survive the wire.** L7K's finding was that a machine
observation and a human conclusion had been travelling as one vocabulary, and a
response that flattened them into a single `status` would undo that at the last
possible moment. So each row sends named groups — `machine`, `operator` — and
there is deliberately **no top-level `status` field** for a caller to reach for.
A test asserts its absence.

**Allow-lists refuse, they do not ignore.** An unknown field is a 400 naming it,
following `campaigns.js`: a client that believes it just set `active: 0` and got
a 200 has been told something false.

**A key outside the queue is a 404.** Reviewing a programme that already holds a
roster would leave a conclusion asserting something about a gap that closed —
the test uses Northwood, which L7I acquired.

## 3. What the screen shows

**Queue** — programme, division, what the machine knows, review state, next
action. Human wording with the exact enum kept alongside it (`title` attribute,
and spelled out in the detail view), so nobody has to read `SOURCE_NOT_AVAILABLE`
to work and nobody loses the exact value. Filters: **All / Unreviewed /
Reviewed** — three, for ten rows.

**Summary** — open gaps, reviewed, unreviewed, retry eligible, and the sentence
that carries the duplicate adjustment rather than hiding it:

> 1744 of 1754 legitimate programmes hold a roster (7 duplicate registry rows excluded)

**Detail** — a `Dialog` with three headed sections that never merge:

- **Programme** — school, sport, division, programme key, unitid.
- **Machine findings — read only** — source-planner state, candidates, approved
  fetch hosts, last acquisition, stage, `failure_class`, the raw recorded
  reason, attempts, retry eligibility. Where the live planner contradicts a
  recorded reason, an amber note says so rather than presenting it as current:
  *"the recorded reason says there was nothing to try, and the planner offers 24
  candidates today."*
- **Operator review** — the only editable part.

## 4. Validation, owned once

`shared/roster/gapReview.js` owns the vocabulary and the allowed pairings. The
server enforces it through `recordReview`; the queue response **carries the same
vocabulary to the browser**, so the form offers only what the server would
accept. One contract, two readers, and **the server is still the authority** —
the browser copy prevents offering a refusal, it does not grant anything.

| | |
|---|---|
| `SOURCE_NOT_AVAILABLE` | `RETRY_ACQUISITION` or `NONE` |
| `PROGRAMME_STATUS_QUESTION` | `CONFIRM_PROGRAMME_STATUS` or `NONE` — never an automatic retry, which would skip the person who is supposed to decide |
| `SITE_TEMPORARILY_UNAVAILABLE` | `RETRY_AFTER` **only**, and a date is required |

Changing the condition clears an action that no longer applies, so a stale
selection cannot be submitted as a pairing the server would refuse.

**Evidence** is required, trimmed, and capped at **400 characters** — long
enough for a real observation, short enough that nobody pastes a page into it.

**Temporary release is derived, not scheduled.** `retryEligible` compares
`retryAfter` to the current time on every read, so a date that has passed
releases the programme with no background job. Tested at a fixed clock from both
sides.

## 5. Reviewer identity: not invented

**This API has no authentication.** `server/index.js` mounts `cors()` and
`express.json()` and nothing else; there is no session middleware, no
`requireOperator`, and although `operator_users` and `operator_sessions` exist as
tables, no server code in this repository reads them.

So there is no identity to attribute, and a placeholder in
`reviewed_by_operator_id` would make the column lie in a way that is worse than
its being empty. **It stays null** — the same choice `athlete_programmes` already
records for its operator note, which its schema calls "MUTABLE AND UNATTRIBUTED,
on purpose."

The route uses the same protection as every other operator route, which is the
deployment's. No separate auth model was introduced, and none was invented.

## 6. What a review cannot do

Saving one writes a single row in `roster_gap_reviews` and nothing else. Tests
fingerprint `roster_players`, `athletics_domains`, `colleges` row counts, the
count of `colleges.active = 0`, and a digest of every `(name, sport, active)`
triple, then save the disposition that is *about* registry truth —
`PROGRAMME_STATUS_QUESTION` — and assert the fingerprint is byte-identical.

The route imports nothing matching Evidence, matching, outreach, campaigns,
email or philosophy; it calls no file write, no `child_process`, and cannot reach
`_state/state<S>.json`.

L7K's coupling test caught L7L's own route on the first full run — it scans
`server/routes` for anything importing the review modules, and the front door
does exactly that. The fix was to **name the four files that ARE the feature**
(the vocabulary, the store, the read model, the route) rather than loosen the
pattern, so adding a fifth is a deliberate edit to that line instead of
something a regex quietly starts allowing. **A programme-status question records doubt. Deciding it
is a separate act by whoever owns the registry.**

**`NO_TRUSTED_HOST` is shown in the machine section and is never offered as a
disposition**, and nothing converts it into `SOURCE_NOT_AVAILABLE`. An operator
may still review such a programme using a real human disposition if they have
grounds.

**Unreviewed stays the absence of a record.** No placeholder rows.

## 7. Accounting

| | |
|---|---:|
| registry rows | 1,761 |
| duplicate registry rows | 7 |
| legitimate universe | **1,754** |
| rostered | **1,744** |
| open gaps | **10** |
| reviewed / unreviewed | **0 / 10** |

Asserted by test: `ncaaWithRoster + registryDuplicates + legitimateGaps ===
ncaaTotal`, and `1744 + 10 === 1754`.

## 8. Verified unchanged

`roster_players` 277,397 · `athletics_domains` 2,722 · `colleges` 2,404 ·
`roster_gap_reviews` **0 → 0** · all ten roster sheets identical · `_targets.csv`
and `_state/state2026.json` identical to L7J · manifest `194fcf38877e6686`
unchanged · six baselines PASS unrepinned · P6 unchanged.

Every test writes to a `VACUUM INTO` copy of the database in a temporary
directory. **The live database was never written by this stage.**

## 9. Debt

**No review has ever been made through this door.** The ten are still unreviewed,
deliberately — L7L builds the front door and reviewing is a separate act that
needs a person who has looked at the sites. That is the next stage, and it is
the first one in this sequence that is not an engineering task.

**Reviews cannot be withdrawn through the API.** `withdrawReview` exists in the
library with its own rules and is exercised by L7K's tests, but no route exposes
it, because nothing has yet been reviewed to withdraw. It should get one when the
first review needs changing after an acquisition succeeds.

**The API test builds its own small database rather than copying the live one.**
Two attempts came first and both were wrong. Snapshotting 209MB inside every
test got the run killed. Snapshotting it once still broke three existing suites
with "database is locked" — they take an online `.backup()` of the same file to
check their migrations, and an online backup reads page by page and restarts
when something else disturbs the source, so a fourth concurrent copy is one too
many. Proved by stashing: without this stage's changes those three passed in
parallel; with them they failed.

The copy was also unnecessary. What the ROUTE must get right is validation, the
allow-list, history, retry semantics and what it must not touch — none of which
needs 1,761 real programmes. So it runs against a three-programme fixture (one
rostered, one gap on a trusted host, one gap with no host), and the assertions
that ARE about the real registry moved to `rosterGapQueue.test.js`, which reads
the live database without copying it. Each assertion now sits where its evidence
is, all five live-database suites pass in parallel, and the file runs in seconds.

Two schema traps surfaced while building that fixture, both the same shape as
L7K's `operator_users`: `colleges.unitid` is added by `migrate.js` and is not in
`schema.sql`, and `athletics_domains` is created by the domain-discovery import
and by neither. A database built from `schema.sql` alone has neither.

**There is no authentication to attribute a review to.** Recorded here rather
than worked around. Until the operator app has a sign-in, every review is
unattributed, which is honest but means a queue worked by two people cannot say
who concluded what.
