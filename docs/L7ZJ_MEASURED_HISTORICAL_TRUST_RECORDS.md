# L7ZJ — measured historical trust records

**Fifteen records written. Zero pairs of Evidence moved.**

L7ZG measured two probable duplicate captures, L7ZH thirteen seasons whose
identity nothing surviving can establish, and L7ZI built somewhere to put that
knowledge. This writes it down — and nothing else. No exclusion, no roster
mutation, no repair, no acquisition.

Starting SHA `8d8275b` (L7ZI).

---

## The cohort was derived, not listed

Fifteen names typed from a document is a hand-picked cohort wearing a number,
and a name that has drifted out of its condition would be carried forward
forever. Both cohorts are re-derived by the rule their own audit stated,
against the database as it is now.

| | |
|---|---|
| `PROBABLE_DUPLICATE_CAPTURE` | **2** |
| `SEASON_IDENTITY_UNPROVEN` | **13** |
| total | **15** |
| cohort digest | `606625d4f0d04996` |
| plan digest | `6b7c4447ff377480` |

The recorder refuses structurally if the shape it finds is not the shape it was
told to expect — a run finding three duplicates would be finding something new,
and a stage told to record two must not quietly record three.

### The two probable duplicate captures

| | Eastern New Mexico M 2025 | San Francisco State M 2025 |
|---|---|---|
| division | NCAA D2 | NCAA D2 |
| rows | 32 | 30 |
| overlap with stored 2024 | **100.0%** | **93.3%** |
| identical name set | **YES** | no |
| route | bare `/roster` | bare `/roster` |
| page-season provenance | none | none |
| Evidence-exposed | yes | yes |
| repair source | none — the site serves 2024 at every season route, and the archive holds no capture in the season window | same |

### The thirteen unproven

All 2025, all Evidence-exposed, all with no prior season to measure turnover
against **and** a route that asserts no season — the same intersection L7ZH's
ingestion gate now fails closed on, found in data that predates it.

| association | programmes |
|---|---|
| **NCAA D1 (2)** | Virginia W · Wyoming W |
| NAIA (11) | Abraham Baldwin Agricultural W · Bethel College (Kansas) W · College of Saint Mary W · Concordia University Nebraska W · Dalton State M+W · North American University W · Soka University of America M+W · William Woods M+W |

---

## What each record says

### Diagnosis evidence — measurements, not class names

A diagnosis that only names its own class tells a reviewer nothing. Each record
carries the facts that produced it:

> **Eastern New Mexico M 2025** — *"Stored 2025 squad is an identical 32-name
> set to the stored 2024 squad. Captured from the bare current roster route,
> which serves whatever the site shows today, and no page-season provenance
> survives, so nothing establishes which season these rows represent. Two
> independent signals: the resemblance and the absence of season evidence."*

> **Abraham Baldwin Agricultural W 2025** — *"No 2024 roster exists for this
> programme, so turnover evidence could not be measured, and the recorded
> source is the bare current roster route... Nothing establishes which season
> these rows represent; **this is not a finding that they are wrong**."*

### The human disposition boundary

Applied to **exactly two** records, and the wording was the careful part:

> *"Probable duplicate capture identified. No trustworthy repair source is
> currently available: the official site serves the earlier season at every
> season route, and the web archive holds no capture of this roster within the
> season window. Operator decision is to retain the existing rows pending a
> better source or a later disposition. **This does not assert that the stored
> season is correct.**"*

It never says verified, confirmed or resolved, and the diagnosis is **preserved
rather than cleared** by the decision. Retaining a season nobody can vouch for
is a different statement from verifying it, and a record that blurred them
would be worse than none.

`next_action`: *"Re-examine if a dated archive capture or first-party source
for this season appears."*

### The thirteen get no disposition at all

`disposition`, `disposition_evidence`, `reviewed_at` and
`reviewed_by_operator_id` are all **NULL**. Marking them RETAIN would empty a
queue and would be a decision disguised as tidiness; excluding them because
provenance is absent would convict on one signal. Both are refused by writing
nothing in the human half.

---

## Reviewer identity — the one judgment call

`reviewed_by_operator_id` is **NULL** on both RETAIN records, and that is this
system's answer rather than a missing one:

- `operator_users` holds **0 rows**; there is no identity to resolve to.
- **All seven** existing human dispositions in `roster_gap_reviews` — every
  operator decision the product has ever recorded — carry NULL here.
- Both validators (`gapReview.js`, `seasonTrust.js`) decline to require it, and
  the schema says it "records who, when anyone knows".

Accountability rests on `disposition_evidence` and `reviewed_at`, which are
required and present. Inventing an id would attribute a decision to a person
who does not exist — which the brief explicitly forbids and which would be
strictly worse than recording that nobody was signed in.

**Flagged because the brief's stop condition could be read strictly.** If the
intent was that no RETAIN should exist until an authenticated operator does,
the two RETAIN records should be reduced to diagnosis-only; that is a one-line
change and moves no Evidence either way.

---

## Write plan and transaction

| | |
|---|---|
| existing trust rows | 0 |
| planned inserts | **15** |
| planned updates | **0** |
| planned deletes | **0** |
| validation failures | **0** |
| result | `APPLIED 15 inserted, one transaction` |

The plan digest excludes timestamps deliberately — `diagnosed_at` differs on
every run, and a plan digest that could never match another is the opposite of
what a plan digest is for. It fingerprints the **decision**: which
programme-seasons, which diagnoses, which dispositions, and the evidence for
each. Two runs an hour apart agree.

### Post-write validation

| | |
|---|---|
| records | **15** |
| `PROBABLE_DUPLICATE_CAPTURE` | 2 |
| `SEASON_IDENTITY_UNPROVEN` | 13 |
| `RETAIN` | 2 |
| `EXCLUDE_FROM_EVIDENCE` | **0** |
| `DEFINITE_MISMATCH` | **0** |
| `isExcluded` true | **0** |
| validator failures | **0** |
| unexpected extra records | **0** |

---

## Evidence immunity

All 4,742 canonical athlete-programme pairs, eight surfaces, before and after:

| surface | before | after | lines differing |
|---|---|---|---|
| OUTBOUND_DECISION | `0d93fc79453bcce1` | `0d93fc79453bcce1` | **0** |
| COACH_COMPOSITION | `1e39bc09d7a581db` | `1e39bc09d7a581db` | **0** |
| EMAIL_BODY | `58a207ff6531e8fc` | `58a207ff6531e8fc` | **0** |
| OPERATOR_WIRE | `7c9fdb35baf5f017` | `7c9fdb35baf5f017` | **0** |
| LOG_PAYLOAD | `7b8ff50ddd8efb70` | `7b8ff50ddd8efb70` | **0** |
| OPERATOR_EVIDENCE | `51f95645e24c2bb3` | `51f95645e24c2bb3` | **0** |
| MATCHING_SUMMARY | `1d8f005b82bfc903` | `1d8f005b82bfc903` | **0** |
| OUTREACH | `17b18b8e7be8e6b1` | `17b18b8e7be8e6b1` | **0** |

**0 of 4,742 pairs changed.** Exactly as L7ZI's design predicted: a diagnosis
does not act, and RETAIN is indistinguishable from absence.

## Pool immunity

| | before | after |
|---|---|---|
| men's rank-1 `n` / p25 / median / p75 | 770 / 901 / 1118 / 1289 | **identical** |
| women's rank-1 `n` / p25 / median / p75 | 1,045 / 998 / 1200 / 1375 | **identical** |
| all ranks 2–6, both sports | — | **identical** |

## Materialised arrivals

| | |
|---|---|
| `recruiting_arrivals` rows | 87,449 → **87,449** |
| digest | `f572e7c4d60a9a1f` → **`f572e7c4d60a9a1f`** |
| rebuild required | **NO** |

The L7ZI seam is real but dormant: it needs an `EXCLUDE_FROM_EVIDENCE`
disposition to bite, and none exists. Not rebuilt merely for cleanliness.

---

## Manifest

| | |
|---|---|
| version | V5 → **V5** (definition unchanged) |
| digest | `322995fd7be5a673` → **`48ff9511e307817c`** |
| components moved | **1** — `roster_season_trust`, 0 rows `4f53cda18c2baa0c` → 15 rows `5391be738f856a22` |
| players, colleges, roster_players, coaches, athletics_domains, programme_status, roster_freshness, roster_measurements | **unchanged** |
| repin | **YES**, manifest only |

The pin diff is the new component's row count and digest plus the manifest
digest. Every behavioural line reads `X -> X`.

## Baselines

All six **byte-identical**, PASS after the repin. **No behavioural repin.** P6
unchanged.

---

## Operator read model

**Gap documented, no UI built.** Nothing in `server/routes`, `server/scripts`
or `src` exposed `roster_season_trust` before this stage — there is no API path
and no screen.

`server/scripts/seasonTrustQueue.js` is a read-only read model proving the
records are usable in an operator form. It writes nothing and has no
disposition path, deliberately: recording what was measured and deciding what
to do about it are different acts, and the second needs a person.

Every field a reviewer needs is present: programme, sport, season, diagnosis,
diagnosis evidence, diagnosed_at, disposition, disposition evidence,
reviewed_at, reviewer, next_action, previous disposition — plus row count,
division, association, whether the season is Evidence-exposed, whether it is
currently excluded, and its review state.

**The remaining gap is an HTTP route and a screen.** Both are a later stage's
work, and neither is needed to hold the fifteen findings.

---

## The review queue

Ordered by **facts only** — Evidence exposure, then NCAA before other
associations, then programme identity. Total and deterministic, so two runs
produce the same queue.

**Nothing ranks one finding above another.** A score would be this file
inventing an opinion the audits never formed, and a reviewer would reasonably
read it as one. The order is a reading order.

| # | exposed | assoc | programme | sport | rows |
|---|---|---|---|---|---|
| 1 | yes | **NCAA** | Virginia | womens-soccer | 28 |
| 2 | yes | **NCAA** | Wyoming | womens-soccer | 23 |
| 3 | yes | NAIA | Abraham Baldwin Agricultural College | womens-soccer | 30 |
| 4 | yes | NAIA | Bethel College (Kansas) | womens-soccer | 29 |
| 5 | yes | NAIA | College of Saint Mary | womens-soccer | 35 |
| 6 | yes | NAIA | Concordia University Nebraska | womens-soccer | 26 |
| 7 | yes | NAIA | Dalton State College | mens-soccer | 26 |
| 8 | yes | NAIA | Dalton State College | womens-soccer | 22 |
| 9 | yes | NAIA | North American University | womens-soccer | 21 |
| 10 | yes | NAIA | Soka University of America | mens-soccer | 23 |
| 11 | yes | NAIA | Soka University of America | womens-soccer | 27 |
| 12 | yes | NAIA | William Woods | mens-soccer | 38 |
| 13 | yes | NAIA | William Woods University | womens-soccer | 33 |

Virginia W and Wyoming W lead because they are the two NCAA records inside the
window Evidence reads — a factual position, not a severity judgement.

---

## ENMU and SFSU, as they now stand

| | |
|---|---|
| machine | `PROBABLE_DUPLICATE_CAPTURE` |
| human | `RETAIN` |
| in Evidence | **yes, unchanged** |

Thriv3 now knows the season is suspicious and continues to use it, and both
halves of that are written down. That is the state L7ZI was built to make
expressible, and it is deliberate: there is no trustworthy repair source, the
measured cost of exclusion is three canonical pairs and one minute of men's
rank-1 median, and removing rows nobody can replace is not warranted by either.

---

## Containment

| artifact | before | after |
|---|---|---|
| `roster_players` | 281,159 `9281abaf1826f897` | **identical** |
| `programme_status` | 6 `4e84caabfc568577` | **identical** |
| `colleges` | 2,404 `b558769138b04ee3` | **identical** |
| `athletics_domains` | 2,723 `3a3d9871d7b3cc88` | **identical** |
| `roster_gap_reviews` | 7 `0ff82ba6889a11df` | **identical** |
| sheets / state / targets / stage files | `a00a9e3052679779` / `c65b4bcc6245a5ab` / `369a9f40cbd274cc` / `c65b4bcc6245a5ab` | **identical** |
| **`roster_season_trust`** | 0 rows | **15 rows** |

Coverage 1,748 / 1,732 / 16 / 13 / 3 · **99.1%**.

---

## Remaining decisions

1. **The thirteen unproven seasons** — measured, queued, undecided. Virginia W
   and Wyoming W first, being NCAA and Evidence-exposed.
2. **ENMU and SFSU** — retained and flagged; revisit if a dated archive capture
   or first-party source appears.
3. **The reviewer-identity question** — whether a RETAIN may stand with no
   authenticated operator, or whether the two should be reduced to
   diagnosis-only until one exists.
4. **An operator route and screen** for the queue.
5. **`verify_gate`'s scope and evaluator seams**, carried since L7ZG.
