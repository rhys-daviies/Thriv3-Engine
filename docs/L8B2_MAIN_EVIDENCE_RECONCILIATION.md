# L8B-2 — reconciliation: foundations landed, merge not landed

**Result: DECISION REQUIRED. Everything the brief ordered *before* the merge is
built, validated and committed. The merge itself is not landed.**

The brief's ordering rule was explicit: capture and identify the acceptance
corpus, implement V7, and preserve pre-merge behaviour **before** merged code
can define its own expected outputs. That ordering is now satisfied — and it is
the part that could not be done after the fact.

---

## What landed

| | |
| --- | --- |
| Manifest **V7-A** | implemented, `fc6c8ee` |
| dependency-closure detector | `npm run closure` |
| pinned acceptance corpus | 202MB, `VACUUM INTO`, integrity ok |
| **corpus identity** | **`8bb808b66db9ee3b`** |
| pre-merge acceptance outputs | captured on that corpus |
| manifest repin | V6 `cc28ee6accdb84ed` → V7 `8bb808b66db9ee3b` |
| behavioural movement | **none** — all six digests rewrote to themselves |
| canonical product data | **untouched** |

---

## Manifest V7-A

main's `tableFingerprint` verbatim: column names from `PRAGMA table_info`
**sorted**, each row hashed alone, **row hashes sorted**. The digest is a
property of the set of rows — no `ORDER BY` to get right — and a new column
moves it with no registration step.

The ten tables are a **measurement**, from instrumenting `buildBaselines` at the
statement level:

```
  18979  roster_players                 4743  recruiting_arrivals_build
  18973  roster_season_trust            4743  recruiting_arrivals
   8738  coach_seasons                     2  players / athletics_domains
   4748  colleges                          1  coaches / programme_status

  closure 10 table(s)   manifest 10 table(s)
  Manifest V7 registers exactly what the walk reads.
```

`outreach`, `outreach_send` and `outreach_evidence` appear only when hooking
`prepare`; they are prepared at import and never executed, so they are not
product identity for these outputs.

`roster_measurements` is gone — the same bytes twice under every-column hashing.
`roster_freshness` stays as a diagnostic, as main keeps it.

The V6 tests that asserted inertness are **inverted, not deleted**: provenance
churn now moves the manifest, which is accepted because acceptance runs on a
corpus where nothing writes.

---

## Acceptance corpus

Captured through the existing L7ZM `VACUUM INTO` helper, never `cp` on a live
WAL database. Snapshot V7 digest **equals** live V7 digest, so the capture is
faithful.

**Immutability is enforced by the digest, not the filesystem.** I set the file
to 444 and it could not be opened at all: `client.js` runs `schema.sql` and
`migrate()` on every open, so a read-only corpus throws *"attempt to write a
readonly database"*. The 444 file is kept as an untouched archive and runs work
from copies — which is what the contract specified anyway, identity by digest
and never by path.

### Guards

| case | result |
| --- | --- |
| correct snapshot | `UNCHANGED`, ok |
| **same bytes, different filename** | `UNCHANGED`, ok — identity is the digest, not the path |
| mutated snapshot | `CHANGED`, not ok |
| **missing snapshot** | **REFUSED, exit 2, no file created** |
| live canonical | passes only because it currently *is* the pinned identity |

The missing-corpus case was a real gap found here: `client.js` creates the
database when the path does not exist, so a typo produced an empty corpus and
the runner reported `dataset CHANGED` — "the data moved" when the truth was
"there is no data". It never fell back to live and never reported PASS, but a
comparison against nothing is not a comparison.

`server/scripts/acceptanceCorpusGuard.js` refuses first. It is **its own
module** because ES imports evaluate in source order and `client.js` opens the
file during its own evaluation — a check written as a statement in the runner
runs after the database has already been created.

---

## Pre-merge acceptance outputs

On corpus `8bb808b66db9ee3b`, 4,742 pairs, 1,778 personalised, 2,867 sentences,
221 held:

| baseline | digest |
| --- | --- |
| OUTBOUND_DECISION | `cf1e79680f56a228` |
| COACH_COMPOSITION | `5e6fb62e12c3a022` |
| EMAIL_BODY | `54a05ec90e8937fd` |
| OPERATOR_WIRE | `8d502959c8730700` |
| LOG_PAYLOAD | `37544f2608cd1b14` |
| OPERATOR_EVIDENCE | `7ca0e350298cd34f` |

These are the acceptance outputs the merge must be measured against. They are
committed, so merged code cannot define its own "before".

---

## What is NOT done

The merge. Phases 9 through 34 remain: schema union, `index.js` middleware
ordering, auth preservation proof, ephemeral trust-integration proof, post-merge
closure re-measurement, the post-merge behavioural diff on this same corpus,
email review, behavioural repin, report pins, and landing.

L8B established the shape — 10 conflicts, 23 hunks, six resolutions already
decided — and implementing V7 has changed one of them: `evidenceBaseline.js` now
differs from main more textually and **less semantically**, because both sides
now use the same `tableFingerprint`. The resolution there becomes "main's
structure, V7's ten-table list".

I stopped rather than rush a 209-commit integration whose acceptance evidence
depends on careful attribution of every moved pair. The foundation is the part
that had to come first, and it is done.

---

## Canonical immunity

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `2d694ab74f831491` | `2d694ab74f831491` |
| arrivals freshness | FRESH | FRESH |

Trust 15 / 2 RETAIN / 13 NULL / **0 EXCLUDE**. P6 unchanged. `origin/main` still
`9a18d78` — the pin did not move. Full suite **180 files / 4,488 tests green**,
build clean.

---

## L8B-3 scope

1. Merge `engagement-tracking` into a worktree off pinned `9a18d78`, replaying
   the six known resolutions and taking "main's structure, V7's table list" for
   `evidenceBaseline.js`.
2. Schema union; prove fresh-DB and existing-DB migration.
3. Auth unchanged; `req.operator` reaches `recordDisposition` on an ephemeral DB.
4. Re-run `npm run closure` — if merged main code makes the six outputs read a
   new table, **stop**.
5. Post-merge baselines on **this same corpus**, diff against the digests above,
   attribute every moved pair, review any changed email.
6. Repin behaviourally only after attribution. Land locally.
