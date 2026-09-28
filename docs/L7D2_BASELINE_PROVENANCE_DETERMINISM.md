# L7D2 — a behavioural baseline hashes what is true, not when we looked

L7D imported 85 roster rows and moved `OPERATOR_WIRE` and `LOG_PAYLOAD` for
**3,584 pairs**. Every one differed in `rosterUpdatedAt` and in nothing else,
because the import re-stamps `updated_date` on all 1,926 programmes whether or
not a single player changed.

That makes two of the six surfaces unable to be stable across any data refresh —
which is exactly the property they exist to have. This stage fixed it without
touching runtime, data, or Evidence meaning.

**Dataset unchanged. P6 unchanged. Four of six pins held byte-for-byte. Two
moved as a baseline-definition change, and are repinned with the account below.**

---

## 1. What `rosterUpdatedAt` is

| | |
|---|---|
| **source** | `roster_players.updated_date` — the scrape/import stamp on each row |
| **read owner** | `shared/evidence/generate.js:203` — `rosterUpdatedAt ?? latestUpdate(squadRows)`, the newest `updated_date` across a programme's squad |
| **projection owner** | `shared/evidence/index.js:268` — put on the context as `ctx.rosterUpdatedAt` |
| **wire owner** | `toWire` → `programme.rosterUpdatedAt` |
| **log owner** | `evidenceLogPayload` → `payload.programme.rosterUpdatedAt` |
| **baseline serializer** | `server/lib/evidenceBaseline.js` — `canonical()`, now `projectBehavioural()` |

**Semantically it is a data-observation timestamp: when we last read the page.**
It is not a statement about the squad.

It is **not decorative**, and that is the whole difficulty. It is the input to
`rosterFreshness({ updatedAt, now, seasonBehind })`, which derives
`{ state, ageDays, reason }`; `applyFreshness` then reads **`freshness.state`**
to suppress a `CURRENT` claim outright when stale and to downgrade a `PROJECTED`
one. So the raw instant reaches behaviour — but only through those three derived
values, and never directly. Nothing anywhere reads the ISO string itself to
decide anything.

## 2. The L7D movement, reproduced independently

Enumerating every ISO-timestamp-valued field across all six surfaces on the real
corpus found **exactly one field, in exactly two places**:

```
  290  OPERATOR_WIRE     :: programme.rosterUpdatedAt
  290  LOG_PAYLOAD       :: payload.programme.rosterUpdatedAt
```

None in `OPERATOR_EVIDENCE`, none in `EMAIL_BODY`, none anywhere else. That
matches L7D's report precisely: those two surfaces moved and the other four did
not, and **no non-timestamp difference was found in the affected pairs**.

## 3. Behavioural significance, measured

Three mutations on a WAL-consistent copy of the live database. No production
data was touched.

| mutation | surfaces moved | personalised |
|---|---|---|
| **`updated_date` +37 seconds** on all 58,270 rows | **OPERATOR_WIRE, LOG_PAYLOAD only** | 1,758 → 1,758 |
| **one player added**, timestamps untouched | COACH_COMPOSITION, EMAIL_BODY, OPERATOR_WIRE, LOG_PAYLOAD, OPERATOR_EVIDENCE | 1,758 → 1,758 |
| **`updated_date` −400 days** (CURRENT → STALE) | **all six** | 1,758 → **1,284** |

So, on real data:

| does the raw instant alone affect… | |
|---|---|
| outbound decision | **NO** |
| Evidence generation | **NO** |
| Evidence qualification | **NO** |
| Evidence selection | **NO** |
| email body | **NO** |
| coach composition | **NO** |
| operator claim truth | **NO** |
| `sourceUrl` eligibility | **NO** |
| held / deduped behaviour | **NO** |
| freshness **qualification outcome** | **YES — and it stays hashed** |

A 37-second shift cannot change `Math.floor((now − then) / DAY)`. A 400-day
shift changes it, changes `state`, and suppresses 474 personalisations. Both
directions are exactly what a baseline should say.

## 4. What H18 baselines are for

The implementation answers this, not an opinion. `canonical()` normalises
`undefined` to `null` *"so a field that stops being set moves the hash rather
than vanishing from the serialization"* — a rule about behavioural meaning, not
about bytes. K3A had already established the principle in the same place: it
threaded a fixed `now` precisely because `ageDays` and its `reason` *"changed
value once a day, at the instant a programme's roster aged past a whole-day
boundary, with no code and no data having moved. A harness that cannot say what
time it is cannot hash a clock-dependent payload."*

**Answer: B — behaviourally meaningful canonical content.** L7D2 is K3A's other
half. K3A pinned `now`; this pins the other operand of the same subtraction.

## 5. Options

| | correctness | regression sensitivity | runtime impact | auditability | H18 intent | K3A consistency |
|---|---|---|---|---|---|---|
| **A** keep it in the hash | honest but useless — two surfaces can never pass a refresh | **destroyed** for those two: every refresh is a false positive | none | poor — the account is "it always moves" | contradicts it | contradicts it |
| **B** canonicalise in the baseline projection | derived freshness stays hashed in full | preserved, proven both directions | **none** | good — one named field, one documented reason | matches | matches |
| **C** fixed baseline clock | already done by K3A, and does not help: the *input* moved, not the clock | unchanged | none | fine | already the case | it **is** K3A |
| **D** manifest-owned observation time | the manifest already fingerprints `roster_freshness`, so this is half true — but the field is still in the payload and still moves it | no improvement on its own | none | confusing: two owners for one value | partial | neutral |

**Recommended and implemented: B.** C is not an alternative — it is already in
place and is why this was the *remaining* half. D is complementary and already
holds: the dataset manifest carries `roster_freshness` as a table digest, so a
re-scrape is still visible as a **dataset** change even though it is no longer a
**behavioural** one. That is the contract in Phase 7, and it now reads cleanly:

* **a refresh that changes zero roster facts** → manifest moves, all six
  behavioural surfaces hold
* **a refresh that adds, removes or changes a player** → manifest moves and the
  behavioural surfaces move
* **elapsed time that changes a freshness outcome** → all six move

## 6. The fix

`server/lib/evidenceBaseline.js`:

```js
export const NON_BEHAVIOURAL_FIELDS = Object.freeze(['rosterUpdatedAt']);
export function projectBehavioural(value) { /* canonical(), minus those keys */ }
export function nonBehaviouralSites(value, surface) { /* where they were found */ }
```

Applied at **all six** push sites, not the two that carry the field today, so a
payload that starts reporting when it was scraped cannot quietly reintroduce the
problem. `nonBehaviouralSites` keeps that honest by reporting where the field
actually appears, and a test asserts the set is exactly the two known paths — if
a third surface gains one, that test fails and somebody has to decide whether it
is provenance or behaviour, rather than the projection silently absorbing it.

**Runtime is untouched.** `toWire` and `evidenceLogPayload` still emit the real
ISO instant; the panel and the logs still tell the truth about when we looked.
The projection runs in the baseline harness alone, and there is a test asserting
the runtime value is a real timestamp rather than a placeholder.

## 7. Tests

16 permanent, network-free except one DB section:

* the raw instant is dropped and `rosterAgeDays`, `state`, `reason` are kept
* two stamps 37 seconds apart, off a day boundary, hash identically — and
  `canonical` did **not** have that property, which is the defect
* crossing `FRESH_DAYS` (CURRENT → ACCEPTABLE) **moves** the hash
* crossing `ACCEPTABLE_DAYS` (→ STALE) **moves** the hash
* changed roster content with an unchanged instant **moves** the hash
* a missing instant still reports `UNKNOWN`, never "assume fresh"
* the field set is exactly `['rosterUpdatedAt']`
* nested and array members are otherwise untouched; a payload without the field
  projects **identically to `canonical`** — which is why four pins held
* runtime `OPERATOR_WIRE` and `LOG_PAYLOAD` still carry it, at those two paths
  and nowhere else, across 300 real pairs
* `BASELINE_NOW` is still pinned at `2026-09-06T00:00:00Z`

A note on one of them: the first attempt used stamps exactly 3 days before
`BASELINE_NOW`, and +37 seconds legitimately moved `ageDays` from 3 to 2 —
`ageInDays` floors. That is a real one-day change in a value the operator is
shown, so the *test* was wrong, not the code. It now sits half past the
boundary, and the boundary-crossing case has its own test.

## 8. Result

| surface | result | reason |
|---|---|---|
| `OUTBOUND_DECISION` | **PASS**, pin held | never carried the field |
| `COACH_COMPOSITION` | **PASS**, pin held | never carried the field |
| `EMAIL_BODY` | **PASS**, pin held | never carried the field |
| `OPERATOR_EVIDENCE` | **PASS**, pin held | never carried the field |
| `OPERATOR_WIRE` | **BASELINE_DEFINITION_CHANGE** | `acff8995399ef10f` → `9945c004b4371bfd` |
| `LOG_PAYLOAD` | **BASELINE_DEFINITION_CHANGE** | `f53b31360d3da2a8` → `48f46bb9173ac6f8` |

**This is not a product regression.** The corpus is unchanged at 1,758
personalised / 2,984 generic, 2,845 rendered sentences, 221 held claims. Nothing
about what is generated, selected, rendered, held or sent is different; the two
hashes are computed over a projection that no longer includes an observation
instant. Four pins holding byte-for-byte is the evidence for that: the
projection is a no-op wherever the field is absent.

Dataset manifest `a54be838875e8fef` — **UNCHANGED**. No data was touched.

## 9. Going forward

A roster import that re-reads the same squads and finds them unchanged will now
leave all six baselines passing while moving the dataset manifest. An import
that changes a squad will move the behavioural surfaces too. The two are
separable, which they were not before this stage.

---

## Remaining baseline debt

**`rosterAgeDays` is still a whole-day step function of `BASELINE_NOW`.** It is
correctly hashed — it is a derived qualification value — but it means advancing
`BASELINE_NOW` will move surfaces for reasons that are about the clock rather
than the data. K3A froze the clock so this cannot happen accidentally; whoever
advances it deliberately should expect it.

**No other observation instants exist in the six surfaces today.** That was
measured, not assumed, and `nonBehaviouralSites` plus its test is the standing
guard.

**Untouched from earlier stages:** 13 no-host programmes (L7E), 2
client-render, 2 source-not-available, 1 manual review, the `BASE_ONLY`
strict-policy decision, the `verified: true` caller assertion, 2026 roster sheets
not being repository seed data, and the USCAA state-vs-sheet value question.
