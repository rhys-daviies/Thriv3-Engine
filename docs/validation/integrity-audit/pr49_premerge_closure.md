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

---

# Final closure — approved decisions

Two decisions were approved after the audit above: **purge the historical PII from the
branch**, and **hold `stmarytx.edu` rather than repair it**.

## A. The PII purge was much larger than the two named files

The closure named `coach_contact_ledger.csv` and `coaches_reconciled.csv`. Sweeping every
blob in every commit of the PR — classifying an address as real by membership in the
`coaches` table — found the same disclosure in **51 more artifacts**: the Phase 4/5/6/7
evidence ledgers, the currency waves, and the applier fixtures. They were never the
headline. They are the same data spread thinner, and the only reason they were found is
that the sweep looked past the two files that had been named.

**53 paths were purged from all 19 commits** and the branch force-pushed.

### What replaced them, and why it is not a hash

An address that resolves to a coach row becomes `coach-<uuid>@redacted.invalid`; a name
becomes `[name withheld — coach <uuid>]`. The row id is already throughout these files,
resolves to a person only inside the database, and keeps the audit trail **linkable** — the
same coach reads as the same token in every artifact, so "this is the row Phase 4B repaired
and Phase 6C.2 later recovered" survives redaction.

A salted digest was the obvious alternative and is worse. To stay linkable the salt must be
committed, and a committed salt over `firstname.lastname` at ~1,200 known athletics domains
is enumerable in minutes. It would have looked like protection while being reversible.

### The first pass was not enough, and the reason matters

Keying redaction on membership in `coaches` left **117 real addresses** in place, including
a personal Gmail. "Is it in our table?" is a fact about our import coverage, not about
whether a mailbox belongs to a person. Under `docs/validation/` no mailbox now survives: one
that resolves to a coach becomes its id, and one that does not keeps its **domain** and
loses its local part, which answers every question the integrity checks ask of an address.
`committedEvidencePrivacy.test.js` asserts this with no allow-list, because an allow-list is
where the next one would hide.

### The quiet failure this created, and the guard for it

Twelve of the redacted artifacts are **applier inputs**, and two of them insert
`coaches.full_name` and `coaches.email` verbatim. Re-running one against its published copy
would have written `coach-<uuid>@redacted.invalid` into the database as an address —
silently, and looking entirely successful, because it is a well-formed address at a domain
that does not exist. The redaction that made the repository safe to publish would have made
the database wrong. `assertUnredacted` refuses at the door of all eleven appliers and names
the untracked local path holding the real file.

### What a branch rewrite cannot reach

- **GitHub still serves the pre-rewrite commits by SHA.** The original ledger is retrievable
  from `raw.githubusercontent.com` at the old commit, HTTP 200, all 6,347 addresses. Force-
  pushing makes objects unreachable from refs; it does not delete them, and the PR keeps
  them alive. Permanent removal requires a GitHub Support request.
- **`data/university-individualisation/{mens,womens}_soccer_universities.csv` are on `main`**
  and carry ~1,919 of the same addresses. They were never in this PR and rewriting this
  branch cannot touch them.

## B. `stmarytx.edu` is held, and the hold has teeth

Stored `VERIFIED_ALIAS` at 123554 (Saint Mary's, CA) while its own `claimed_unitids` are
`[123554, 228149]`. It is **multi-claim**, which is why the single-claim ownership check
never surfaced it through the whole audit — it sat in the ambiguous-multi-claim warning
bucket. Five coach rows are filed at 123554 through this domain and two at 228149.

It is **not repaired**. The domain name is suggestive; Phase 2A is what happens when
suggestive is treated as evidence, and Phase 2B had to revert all 27 of its results.

A hold keeps the row exactly as it is and **suspends its authority**. `institutionResolver`,
`coachingImport`, `reconcileCoaches` and `importInstitutionAliases` no longer accept a held
domain as institution evidence, so it can no longer resolve an institution or make a coach
outreach-eligible on its own. The validator names it and **asserts the suspension is in
force** — a held domain still being trusted is a CRITICAL failure, so the hold cannot decay
into documentation. Tests pin that it does not spread: unheld domains resolve normally, and
both disputed institutions still resolve by their own names.

Register: `shared/heldDomainAdjudications.js`. Follow-up: `held_domain_followup.json`.

## Verification

| check | result |
|---|---|
| purged paths in any commit of the branch | 0 |
| unredacted real-PII blobs reachable from the branch | 0 |
| unredacted mailboxes under `docs/validation/` | 0 |
| executable path that can apply the superseded 188-row fixture | none |
| scripts able to target `/data` | none |
| production mutation performed by merging | none |
| `stmarytx.edu` conferring institution evidence | no |
| `validate:institution-integrity` | CRITICAL failures: 0 |
| new test failures vs `origin/main` | 0 |
