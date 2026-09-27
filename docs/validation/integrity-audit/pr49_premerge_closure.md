# PR #49 — pre-merge safety closure

`fix/institution-identity-integrity` → `main`. Read-only audit of every executable
data-mutation path in the final tree, then the narrowest changes that make the branch
safe to merge. **No production data was touched, before or by this closure.**

## 1. What the audit found

### 1.1 A stale production migration whose guard would not have stopped it

`server/scripts/applyReconciledToProduction.js` was the only executable in the tree that
targeted `/data/recruitmatch.sqlite`. It applied
`docs/validation/generated/athletics_domains_repairs_final.json` — 188 `athletics_domains`
decisions — and its pre-invariants pinned production's 6,347-row `coaches` baseline and a
`723c2bc4…` fingerprint.

**Those invariants would have passed.** They were designed to catch drift, and production
is untouched, so it still matches the baseline exactly. The guard was aimed at the wrong
failure: not "has production moved?" but "have the decisions moved?".

### 1.2 The 188-row fixture, adjudicated against the final evidence state

187 of the 188 rest on Thriv3's own data — `"coach_seasons scrape maps <domain> -> UNITID
<n>"`. Measured row-by-row against the shared dev registry after Phases 2D, 3B, 3D, 4F, 5B,
6B and 6C.1–6C.4:

| verdict | rows | what applying it would do |
|---|---:|---|
| still valid | 5 | no-op |
| **superseded** | **180** | promote INSUFFICIENT_EVIDENCE → VERIFIED_ALIAS on internal-scrape evidence |
| **contradicted** | **2** | downgrade `huntingdonhawks.com` and `simpsonathletics.com` from the VERIFIED that Phase 6C.4 proved with external evidence |
| unknown | 1 | repoint `stmarytx.edu` across institutions; never externally adjudicated |

The 180 are the decisive figure. `server/scripts/flagUnverifiedAthleticsDomains.js` — added
by *this same PR* as Phase 6C.4 prevention — exists to flag an INSUFFICIENT_EVIDENCE domain
for **explicit human verification**, and `server/scripts/verifyAthleticsDomains.js` was
changed in this PR so a page self-identification can no longer VERIFY an institution that no
claim agrees with. The fixture does automatically, in bulk, the exact thing both guards were
written to prevent. Phase 6C.4 moved **five** domains, each with evidence URLs, a written
rationale and a declared blast radius; this fixture moves 188 with none of that.

So the branch carried both the corrected Phase-2D/6C.4 semantics and an executable relic of
the Phase-3A/3B assumptions they replaced.

### 1.3 Three apply scripts with no production refusal at all

`applyConferenceChampions2025.js`, `applyConferenceChampions2025Women.js` and
`applyUscaaDivision.js` resolve their target through `db/client.js`, so they write whatever
`RECRUITMATCH_DB` points at — which on the Render host is `/data`. Two had no guard;
`applyUscaaDivision` called `assertCanonicalWrite`, **which is not a production guard** — it
refuses the shared *dev* corpus and `--canonical` waives it. None of the three is part of
this PR's work; they were found by auditing the whole tree rather than the one script named
in the review.

An inline check is not enough for this family: importing `db/client.js` opens the resolved
file and runs `schema.sql` + `migrate()` during module evaluation, so a `/data` test written
in the script body fires *after* production has been opened and migrated.

### 1.4 6,347 people's names and email addresses, in a public repository

`docs/validation/generated/coach_contact_ledger.csv` and `coaches_reconciled.csv` carried
`coach_name` and `email` for every coach in the dataset, 44 of them at consumer providers.
`github.com/rhys-daviies/Thriv3-Engine` is **public** (an unauthenticated API read returns
200). Merging would have placed a harvestable contact list for every college soccer coach in
the dataset onto `main`. Nothing in the audit trail needs the addresses: every decision is
reproducible from the decision columns plus `coach_id`, and `coach_id` resolves to a person
only inside the database.

### 1.5 A validator that could never go green

`validate:institution-integrity` counted all four domain-ownership disagreements on the
shared dev DB as CRITICAL — including `pct.edu` and `wvu.edu`, where Phase 2C proved the
**existing stamp correct and Phase 2A wrong**. The guardrail for the entire
institution-identity architecture reported `CRITICAL failures: 4` on the state the project
had deliberately chosen.

## 2. What was changed

| change | effect |
|---|---|
| **removed** `applyReconciledToProduction.js` + its test | no executable in the tree targets `/data` |
| **removed** `repairAthleticsDomains.js` | no executable reads the superseded fixture |
| `athletics_domains_repairs_final.json` → `athletics_domains_repairs_phase3b_SUPERSEDED.json` | all 188 decisions retained verbatim, wrapped in an object with the adjudication; **structurally non-iterable**, so a naive `for…of` applier throws instead of applying |
| `PHASE_3C_MIGRATION_PLAN.md` | banner: retired, never executed, scripts gone. Its own step-7 ABORT GATE — *"do not apply a stale reconstruction"* — is the reason |
| new `server/db/refuseProductionVolume.js` | refuses `/data` **before** the database is opened; imported first by the three scripts above |
| `applyDomainCorrections.js` | docstring no longer advertises the disproven Phase-2A set as its input |
| CSVs → `server/data/generated/` (gitignored) | raw ledgers generated locally, never committed |
| new `server/scripts/redactGeneratedLedgers.js` + redacted pair | every row kept, keyed by `coach_id`; name, email, title and source URL dropped; retained free text tested against every name and address in the file |
| `reconcileCoaches.js` | default output no longer lands in the committed evidence directory |
| `validateInstitutionIntegrity.js` | CRITICAL now means an ownership disagreement **nobody has looked at**; adjudicated ones read CLOSED or as a named HELD warning |

### The validator's relief, and its limits

Relief is read from `phase2c_ground_truth.json`, never hard-coded, and requires all three
of: the artifact names the domain, the verdict has at least one evidence URL, and the
current stamp is still one of the two UNITIDs the adjudication was written about. That last
condition is the anti-suppression clause — if the stamp has moved to a third value the
adjudication no longer describes the row, relief is refused, and it returns to CRITICAL.
Result on shared dev: **2 closed, 2 held-and-named, 0 unadjudicated, exit 0.**

## 3. Open items — recorded, deliberately not repaired

- **`stmarytx.edu`** is stamped 123554 (Saint Mary's) while the fixture proposed 228149
  (St. Mary's TX) and the Phase-2 ledger README already listed it as a known error. It was
  never externally adjudicated in 2C/2D/6C.4. Repairing it needs external verification, which
  is a research phase, not a merge blocker.
- **`njcu.edu`** — held pending the Kean–NJCU merger policy call (Phase 2D).
- **`floridasports.com`** — externally verified to belong to *no* institution; the unmap is
  a human decision (Phase 2D).
- **The 180 INSUFFICIENT_EVIDENCE domains** remain unmapped. That is the correct state:
  `flagUnverifiedAthleticsDomains.js` surfaces them for verification.
- **History.** Removing the CSVs in a commit does not remove them from the commits already
  pushed to the public remote (`af9a21d`, `83630f6`). Purging them needs a branch history
  rewrite and a force-push — an outward-facing action, held for an explicit decision.

## 4. Production status

**Production has never been written by any of this work, and merging this PR writes
nothing.** `render.yaml` points the running app at `/data/recruitmatch.sqlite`, which is
correct — the app serves from production. What must not exist is a *script* that writes it,
and after this closure none does. Every repair described in the audit trail was applied to
the shared **development** database at `server/data/recruitmatch.sqlite`.
