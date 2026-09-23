# L7ZK — operator trust review boundary

**The door is built. It is locked, and the key does not exist yet.**

From L7ZK every new human disposition must carry an authenticated operator
identity. This application has no authentication. So the read route ships, the
write route ships **disabled**, and the prerequisite is named in the refusal
rather than buried in a document.

Zero real dispositions. The fifteen trust records are byte-identical
(`6f63446776597c5a` before and after). No Evidence, pool, manifest or baseline
movement.

Starting SHA `72d8315` (L7ZJ).

---

## Authentication trace

Traced, not assumed. The answer is that there is none.

| question | finding |
|---|---|
| auth library in `package.json` | **none** — no passport, jwt, express-session, cookie, bcrypt |
| middleware in `server/index.js` | `cors()` and `express.json()`, nothing else |
| any `req.user` / `req.operator` / session | **none anywhere in `server/`** |
| `Bearer` usages | two, neither an operator: the public-profile `?ref=` token (*"Never encodes identity"*) and `SYNC_SECRET` for service-to-service edge sync |
| `operator_users` / `operator_sessions` | exist in the working DB with **0 rows**, created by **no code in this repository** |
| `rosterGaps.js` write behaviour | writes `operatorId: null`, and says why: *"This API has no authentication… putting a placeholder in `reviewed_by_operator_id` would make the column lie in a way that is worse than its being empty."* |

L7L reached this conclusion for roster gaps in exactly the same terms. L7ZK
reaches it again for a field that is materially more dangerous.

## Auth decision

Phase 3's third branch applies: **read proceeds, write must not be enabled.**

`operatorFromRequest(req)` is the single address for the prerequisite — one
function, so when sign-in arrives the change is one function and not a search.
It reads `req.operator.id` and nothing else. It never consults the body or a
header, because an identity a caller can set is not an identity.

---

## Reviewer contract

For every **new** disposition:

| field | owner | required |
|---|---|---|
| `reviewed_by_operator_id` | **server**, from the authenticated context | yes — refusal without it |
| `reviewed_at` | **server**, from its own clock | yes |
| `disposition_evidence` | client | yes |
| `disposition` | client | `RETAIN` or `EXCLUDE_FROM_EVIDENCE` |
| `next_action` | client | optional |
| `expected_disposition` | client | yes — see concurrency |

A decision timestamped by whoever submitted it is a decision whose audit trail
is whatever they wanted it to be, which is why the clock is server-owned too.

### Legacy unattributed

The two RETAIN rows L7ZJ wrote carry a null reviewer. They are **grandfathered,
readable, and never rewritten**. The wire reports
`attribution: "LEGACY_UNATTRIBUTED"` rather than leaving a null to be read as
*attributed to nobody* — that is a fact about the record, not a gap in it, and
rendering it as an empty reviewer would invite someone to "fix" it by
backfilling an identity that was never there.

| state | meaning |
|---|---|
| `NOT_REVIEWED` | no disposition |
| `LEGACY_UNATTRIBUTED` | a decision predating the attribution rule |
| `ATTRIBUTED` | a decision with an authenticated reviewer |

---

## Canonical write owner

`server/lib/seasonTrustReview.js` — `recordDisposition()` is now the only path
that can set `roster_season_trust.disposition`.

**Every path audited:**

| path | before | after |
|---|---|---|
| `recordSeasonTrust.js` (machine) | wrote `RETAIN` with a null reviewer | **cannot write a disposition at all** |
| `seasonTrustReview.recordDisposition` | did not exist | canonical owner; refuses without an operator id |
| `ENTITIES` pass-through in `server/index.js` | not exposed | still not exposed; the router is purpose-built for the same reason `rosterGaps` is |
| direct SQL in tests | fixtures only | unchanged |

### Machine / human separation is architectural, not documented

L7ZJ held the separation by restraint — the recorder simply did not contain the
word `EXCLUDE_FROM_EVIDENCE`. L7ZK makes it structural:

- it imports **no disposition vocabulary**
- its `INSERT` names **only diagnosis columns**, so setting a disposition would
  require adding one, which is a visible act rather than a typo
- it imports nothing from `seasonTrustReview.js`
- `recordDisposition` refuses without an operator id, and a machine job has no
  authenticated context to supply one

All four are asserted by test, two of them by reading the file's own source.

**Consequence, stated plainly:** run against a fresh database, the recorder now
produces the two duplicates' *diagnoses alone*. A person would have to decide
again. That is the governance rule working, not a regression — and the existing
rows are untouched.

---

## GET route

`GET /api/roster-season-trust` — no auth required (reading a measurement is not
a decision).

Three layers kept apart on the wire, the L7K lesson surviving to the last
possible moment: `machine`, `operator` and `effect`, with **no top-level
`status`** for a caller to reach for.

| group | fields |
|---|---|
| `identity` | college_name, sport, season |
| `programme` | + association, division, row_count |
| `machine` | diagnosis, diagnosis_evidence, diagnosed_at |
| `operator` | disposition, disposition_evidence, reviewed_at, reviewed_by_operator_id, **attribution**, next_action, previous_disposition, previous_reviewed_at |
| `effect` | evidence_exposed, excluded_from_evidence, review_state |

Plus a `write` block on **every read**:

```json
"write": {
  "enabled": false,
  "reason": "no authenticated operator identity exists in this application; …",
  "exclude_additionally_blocked": "EXCLUDE_FROM_EVIDENCE is not available yet: …"
}
```

So a client learns the door is shut by reading, not by failing — and a future
UI can render it locked rather than offering a control that always errors.

### Filters and ordering

`diagnosis` · `disposition` · `reviewState` · `association` · `exposedOnly`.
An unknown filter is a **400 naming it**, following `campaigns.js`; an invalid
value is a 400 too.

**Ordering is L7ZJ's and filtering never reorders** — Evidence exposure, then
NCAA, then programme identity. A reviewer working down the queue across
sittings sees the same sequence whether or not they narrowed it.

### Supporting evidence, not recomputed heuristics

The frontend is given facts and computes nothing. For a
`PROBABLE_DUPLICATE_CAPTURE` the record already states the overlap, the route
shape and the absence of a repair source; for a `SEASON_IDENTITY_UNPROVEN` it
states which prior season is missing, the route shape, and — in the evidence
text itself — that *"this is not a finding that they are wrong."*

---

## Write route

`POST /api/roster-season-trust/disposition`, body-keyed rather than
path-keyed: college names contain spaces, apostrophes and parentheses, and
encoding `Saint Mary's College (IN)` into a path segment is a class of bug with
no upside.

| | fields |
|---|---|
| **allowed** | college_name, sport, season, disposition, disposition_evidence, next_action, expected_disposition |
| **refused by name** | reviewed_by_operator_id, reviewed_at, diagnosis, diagnosis_evidence, diagnosed_at, previous_disposition, previous_reviewed_at |
| **unknown** | 400, naming the field |

**A spoof is refused, never silently dropped.** Ignoring a caller-supplied
reviewer would return 200 to a client that believes it attributed the decision
to someone else — the governance rule failing invisibly at the one point it
exists for.

**Identity is judged before the payload.** A malformed body from an
unauthenticated caller still gets 503, because a 400 listing payload problems
would help someone form a better request for an action they may not take.

It **acts on an existing record and will not author one**. A missing trust
record is a 400, not an insert: a diagnosis is a measurement, and this endpoint
has measured nothing.

---

## The exclusion consequence

`EXCLUDE_FROM_EVIDENCE` is blocked for a **second, independent reason**, and it
would still be blocked the day sign-in arrives.

`recruiting_arrivals` is materialised from `roster_players`.
`buildRecruitingHistory.js` is its only writer and it **deletes a sport's rows
and rebuilds them wholesale**. An exclusion is honoured immediately by every
roster read, so the moment one is written the derived arrivals hold rows the
product may no longer read — an inconsistency, not a delay.

None of the three safe strategies exists today:

| strategy | why not |
|---|---|
| **A** synchronous rebuild | ~87,000 rows, whole-sport delete-and-rebuild. Not a bounded HTTP operation. |
| **B** staleness flag gating reads | no such flag exists, and building one is its own stage |
| **C** existing invalidation | `philosophyQueries` has a fingerprint-checked cache for the pool; `recruitingPatterns.js` has **no equivalent** |

Per Phase 11, the write stays closed. The reason travels with the refusal —
`exclusionBlockedReason()` — rather than living only here.

---

## Fixture results

25 route/store tests plus the existing suites. Every write is against the
in-memory fixture `vitest.config.js` provides; production was never touched.

| scenario | result |
|---|---|
| **RETAIN, authenticated** | **accepted**; reviewer `op-1` from context, `reviewed_at` from the server clock, diagnosis untouched, `attribution: ATTRIBUTED` |
| **EXCLUDE, authenticated** | **REFUSED** — `exclusionBlockedReason()`, the materialisation prerequisite |
| RETAIN, unauthenticated | **503**, prerequisite named, nothing written |
| EXCLUDE, unauthenticated | **503**, nothing written |
| reviewer spoof (`reviewed_by_operator_id`) | **400**, naming the field |
| `reviewed_at` spoof | **400**, naming the field |
| `diagnosis` from the wire | **400** |
| unknown field | **400**, naming it |
| missing evidence | refused |
| unknown disposition | refused |
| unknown programme-season | refused, and nothing inserted |
| malformed body, unauthenticated | **503**, not 400 |

### History

`none → RETAIN → RETAIN (by a second operator)` preserves
`previous_disposition` and `previous_reviewed_at` — bounded history exactly as
`roster_gap_reviews` keeps it, answering *"has this changed, and from what"*
without becoming an event log.

### Concurrency

Optimistic, in the shape the data already supports rather than a new version
column. The caller states `expected_disposition` — what it believed the current
value to be — and a mismatch is a **409**, not an update. Omitting it entirely
is refused: an operator decision made without reading first is precisely the
case this is for.

Two operators, same queue: A decides, B's stale decision is refused, and A's
reviewer survives.

---

## Real-corpus immunity

Nothing real was written, so nothing real moved.

| | before | after |
|---|---|---|
| `roster_season_trust` | 15 rows, digest `6f63446776597c5a` | **identical** |
| 2 × `PROBABLE_DUPLICATE_CAPTURE` + `RETAIN`, reviewer null | ENMU, SFSU | **identical, untouched** |
| 13 × `SEASON_IDENTITY_UNPROVEN`, no disposition | — | **identical, none reviewed** |
| `EXCLUDE_FROM_EVIDENCE` | 0 | **0** |
| `roster_players` / `colleges` / `athletics_domains` / `programme_status` / `roster_gap_reviews` | — | **identical** |
| sheets / state / targets / stage files | — | **identical** |
| `recruiting_arrivals` | 87,449 | **87,449** |
| manifest | V5 `48ff9511e307817c` | **unchanged, no repin** |
| six behavioural baselines | — | **all PASS, no repin** |
| P6 | — | unchanged |

Coverage 1,748 / 1,732 / 16 / 13 / 3 · **99.1%**.

---

## UI decision — not built

The pattern exists (`src/pages/RosterGaps.jsx`, 385 lines, consuming the
roster-gaps API), so a read-only screen would be *trivial* by the brief's test.
It was still declined.

**The binding constraint is authentication, not visibility.** A screen would
display thirteen records nobody can act on, and the records are already
readable two ways: `server/scripts/seasonTrustQueue.js` for an operator at a
terminal, and the JSON API for anything else. Building a view now would add
display without adding capability, and the brief is explicit that backend
governance is the priority.

A read-only screen becomes worth building when the write path opens — and then
it should be built once, with the control, rather than twice.

---

## Remaining prerequisites

1. **Operator sign-in**, exposing the reviewer on the request context. One
   function — `operatorFromRequest` — stands between it and a working write
   path. Until it exists, no new disposition of any kind can be recorded.
2. **A materialisation strategy for `recruiting_arrivals`**, without which
   `EXCLUDE_FROM_EVIDENCE` stays closed even once sign-in lands.
3. **The thirteen unproven seasons**, still measured and undecided.
4. **An operator screen**, once the write path opens.
5. **`verify_gate`'s scope and evaluator seams**, carried since L7ZG.
