# Identity handoff — 1G-PRE WRONG_INSTITUTION repair

**From:** Programme Contacts (Roadmap Phase 1), branch `feat/programme-contacts-1b`
**To:** Data Integrity Audit workstream
**Date:** 2026-10-08

> **NOT APPLIED.** The correction is committed as tooling and a fixture. It has **not** been applied to
> the shared development database or to any other database. The dev DB is unchanged:
> file sha256 `bcc6caa2…`, corpus revision 1072117, 4,157 eligible coaches, ids hash `2883fc01`.

## 1. What was approved

**Defect.** The domain verifier (`verifyAthleticsDomains.js`, 2026-09-01) set a host's status with
`wrong.length ? WRONG_INSTITUTION : …`. Refuting *one* foreign claimant condemned a host whose own
page names its stored owner and where a claim agrees. This is the same defect Phase 8C.5D fixed by hand
for three hosts. 49 rows carry WRONG_INSTITUTION; **38** are approved for correction.

**Rule R1–R5.** The rule lives in `server/lib/refresh/wrongInstitutionRepair.js`. A row may be reversed only if all of these hold:

- **R1 — owner:** the row stores an owner UNITID and at least one refuted claimant, and the owner is not itself refuted.
- **R2 — self-identification:**
  - the page's own name (og:site_name or title) is CERTAIN, a whole name, and on its athletics site;
  - that name is a federal registry (IPEDS) name of the owner;
  - it is not an IPEDS name of any refuted claimant.
- **R3 — agreeing claim:** at least one mapping claim agrees with the owner.
- **R4 — boundaries:**
  - the owner's UNITID maps to exactly one SINGLE entity, with no campus hanging off it;
  - the host has no www twin row, is not held, and is not a shared platform root.
- **R5 — fresh corroboration:**
  - the owner's own institution site links to the host;
  - no refuted claimant's site links to it;
  - no verified staff member on the host uses a refuted claimant's mail domain.

**Mechanism.** The correction runs only through the existing protected-correction path (`protectedCorrection.js`):

- It keeps the stored UNITID, `wrong_mappings`, claims and every evidence column byte-identical.
- It changes only `status`, `athletics_entity_id`, `ownership_class` and `notes`.
- It makes no change to resolver or verifier logic.

| Item | Value |
|---|---|
| Commit | `28c628d` — Add protected WRONG_INSTITUTION repair for 38 verified athletics hosts (1G-PRE) |
| Fixture | `docs/validation/integrity-audit/phase1gpre_protected_correction_fixture.json` |
| Fixture hash | `6355a18886f7bdf49a9d269375e2a68e1e777591d52a28236a6164fd0049d344` |
| Inputs (committed) | `phase1gpre_registry_slice.json`, `phase1gpre_link_evidence.json`, `phase1gpre_approval.json` (approval `APPROVAL-1GPRE-CLASS-B-38`) |
| Builder | `server/scripts/buildWrongInstitutionRepair.js` (read-only, deterministic) |
| Applier | `server/scripts/applyProtectedSourceCorrection.js` |
| Tests | `wrongInstitutionRepair.test.js` (14), `reconcileCoaches.wrongInstitutionRepair.test.js` (7) |
| Artefacts (outside git) | `~/Developer/Thriv3-Engine/integrity_artifacts/phase1gpre/` (+ `rehearsal/`) |

### The 38 hosts (each moves from WRONG_INSTITUTION to VERIFIED, owned by `AE-U<unitid>`)

alfredstateathletics.com, athletics.carthage.edu, athletics.concordia.edu, athletics.middlebury.edu,
athletics.stolaf.edu, bantamsports.com, battlingbishops.com, blcvikings.com, catawbaathletics.com,
drewrangers.com, gocolumbialions.com, godustdevils.com, goeasterneagles.com, goeulions.com,
gohighlanders.com, gojacks.com, gomatadors.com, gopresidents.com, gostatesmen.com, goxavier.com,
gseagles.com, guhoyas.com, illinoiscollegeathletics.com, lcpioneers.com, lmulions.com,
lynchburgsports.com, mercyathletics.com, mlcknights.com, nguathletics.com, providence.jwuathletics.com,
saintmaryssports.com, southwesternpirates.com, swarthmoreathletics.com, thielathletics.com,
uncwsports.com, uwaathletics.com, uwlathletics.com, wlcsports.com

## 2. Expected effect (rehearsed on a consistent copy)

**Changed:**

- 38 `athletics_domains` rows change, and no other table.
- 76 host-ownership answers change (bare + www). 38 entities gain one host each; none lose one.
- **Eligible coaches go from 4,157 to 4,291 (+134, 0 lost).** Eligible-ids hash `99be2103`; NCAA truthful hash `4ba22112`. By division: D1 +45, D2 +29, D3 +60.
- All 134 are sourced on a corrected host and land at that host's own institution. None lands at a look-alike school.
- 6 programme-contact leads move from "find the page first" to "fetch now".

**Unchanged:**

- NAIA (370/381), NJCAA, USCAA, the programme universe, rosters, outreach and `programme_contacts`.
- Identity validator H1–H12: PASS (0 hard, 0 soft). Ownership disagreements: 0.
- Integrity counters: all 0.

## 3. Coach records the Integrity workstream must handle (none were modified)

### 3a. Six coaches whose institution mapping changes (all verified correct)

The import filed each of these under a look-alike school. Both their staff page and their mail domain
belong to the destination, so the new mapping is correct. None has any outreach history.

| coach_id | Coach | Filed under | Maps to | Result |
|---|---|---|---|---|
| `9baa311e…` | Austin Farwell | Trinity (TX) | Trinity (CT) `AE-U130590` | eligible, listed today |
| `a1e6dfd7…` | Jess Shanahan | Westminster College (PA) | Eastern University `AE-U212133` | eligible, listed today |
| `bdbf815d…` | Carli Sitkowski | Westminster College (PA) | Eastern University `AE-U212133` | eligible, listed today |
| `912fe4df…` | Nick Rizzo | Saint Mary's (CA) | Saint Mary's Univ. of Minnesota `AE-U174817` | eligible, **departed** (see 3b) |
| `c6c17682…` | Alberto Centeno | Saint Mary's (CA) | Saint Mary's (MN) `AE-U174817` | eligible, **departed** (see 3b) |
| `bf26fbf7…` | Devan Pilarski | Southwestern (KS) | Southwestern (TX) `AE-U228343` | stays ineligible (see 3c) |

The `school` labels themselves are still wrong. Correcting them is a separate coach-record task.

### 3b. Four coaches needing a currentness or email correction — do this before or with the apply

On 2026-10-08, 130 of the 134 newly eligible coaches were listed on their official page with the exact address. These four were not:

| coach_id | Coach | Institution | Finding |
|---|---|---|---|
| `912fe4df-4c1c-4206-ba5d-fcb6fa1eb8d5` | Nick Rizzo | Saint Mary's (MN) W | Not on staff (page lists Averi Cash, Weston Joyner) |
| `c6c17682-5c03-432e-97c3-357bb24746e4` | Alberto Centeno | Saint Mary's (MN) M | Not on staff (page lists Leo Barbosa, Alvaro Capra) |
| `10988e1f-0508-47ad-8098-16003d95d767` | Gerardo Hidalgo | UC Riverside W | Not on staff (gohighlanders.com women's coaches page) |
| `647c575f-b199-4669-9dff-3542cd607029` | Abbey Brosnihan | Georgia Southern W | Still on staff; published address is now the `-sw` variant (`ab74932-sw@`), not the stored one |

If these are corrected first, the post-apply count will be **4,288**, not 4,291. The Brosnihan fix is an address
change, not a removal, so she stays eligible.

### 3c. Pilarski — incorrect stale classification

`bf26fbf7-5bbe-4cf6-9140-b7ff9d2ae9a7` is `PROVEN_STALE`. He *is* listed on Southwestern University (TX)'s
current men's page with his stored address. He was presumably judged stale against the school he was filed under
(Southwestern KS). He stays ineligible, which is safe, but the classification is wrong.

### 3d. Ndlovu — historical misattributed send

- **Coach:** Methembe Ndlovu `6fd01d98-ac0b-4756-baf7-9f1543780ae3` (Trinity CT) received outreach `4e1cc6a4-f5c9-4246-8e90-84c6954e6c95`.
- **The send:** sent 2026-08-27, state ACCEPTED.
- **The defect:** it is recorded with `match_id = 'Trinity (TX)'`, which predates this repair.
- **No action was taken.** Whether to annotate the record is the workstream's decision. Do not rewrite it silently.

## 4. Records deliberately NOT corrected

### 4a. Four genuinely misowned athletics hosts, plus `ucwv.edu`

These rows store the **wrong** institution. Each is shown three independent ways: the page names the
refuted claimant, the claimant's own site links the host, and the host's staff use the claimant's mail domain.
WRONG_INSTITUTION is currently protecting them: their 23 coaches are ineligible both before and after the repair. Fixing them means an **ownership reassignment**, which is a separate adjudication.

| Host | Stored as | Actually |
|---|---|---|
| rattlerathletics.com | Saint Mary's College of California (123554) | St. Mary's University, TX (228149) |
| ucgoldeneagles.com | College of Charleston (217819) | University of Charleston, WV (237312) |
| autrojans.com | Anderson University, IN (150066) | Anderson University, SC (217633) |
| unweagles.com | Northwestern University (147767) | University of Northwestern–St Paul (174491) |
| **ucwv.edu** | VERIFIED_ALIAS for College of Charleston (217819) | University of Charleston, WV's own domain. This is a **live misattribution**, not currently making anyone eligible. |

Related: `stmarytx.edu` is already HELD in `shared/heldDomainAdjudications.js` (stored 123554, disputed with 228149).

### 4b. Seven unresolved boundary records (left WRONG_INSTITUTION; need individual review)

| Host | Why kept |
|---|---|
| ncurams.com | The federal registry gives "North Central University" as an alias of North Central College (IL) too. The ownership link and staff mail support North Central Univ. (MN). |
| benueagles.com | Benedictine University has a campus entity (Mesa) on the same UNITID |
| iuindyjags.com | IU Indianapolis has a campus entity (Columbus); "IU Indy" is not an IPEDS name |
| cuwfalcons.com | Bare row WRONG_INSTITUTION vs `www.` row VERIFIED (conflicting twins) |
| njcugothicknights.com | No claim agrees (Kean ↔ NJCU merger; Kean Jersey City campus) |
| cornerstone.sidearmsports.com | Shared platform root; no claim agrees |
| buhuskies.com | Bloomsburg on the Commonwealth University parent UNITID (3 campuses); no claim agrees |

### 4c. Also noted

- **Weak canonical check:** `selfIdentifies()` in `changeClassifier.js` compares normalised short names and ties on 8 legitimate hosts (e.g. "georgetown" vs Georgetown College). The normal refresh `ASSIGN_DOMAIN` path inherits this weakness.
- **Verifier can't overwrite fixes today:** `verifyAthleticsDomains.js` cannot rewrite the managed DB without `--legacy-write-ack`. A guard against it downgrading decided rows is optional.

## 5. Application, verification and rollback

**Pre-conditions**

1. **Writers:** no other writer on the DB (`lsof`, no dev server, no vitest against it).
2. **Fingerprint:** it must still be `bcc6caa2…` / rev 1072117 / 4,157 / `2883fc01`. If anything has drifted, re-run the builder: it must still produce hash `6355a188…`. Any `expected_old` mismatch refuses the whole fixture.
3. **Checkpoint:** take `PRE_PHASE_1GPRE` with `dbSnapshot.js` plus `.checkpoint.json`, and restore-test it.
4. **Coach correction:** decide the 3b coach correction; apply it first, or immediately after.

**Apply**

```bash
node server/scripts/buildWrongInstitutionRepair.js --db server/data/recruitmatch.sqlite --registry docs/validation/integrity-audit/phase1gpre_registry_slice.json --evidence docs/validation/integrity-audit/phase1gpre_link_evidence.json --approval docs/validation/integrity-audit/phase1gpre_approval.json --json
```

```bash
node server/scripts/applyProtectedSourceCorrection.js --db server/data/recruitmatch.sqlite --fixture docs/validation/integrity-audit/phase1gpre_protected_correction_fixture.json --fixture-hash 6355a18886f7bdf49a9d269375e2a68e1e777591d52a28236a6164fd0049d344
```

The first command is a read-only re-check (it must print the same fixture hash). The second is a dry run.
Then repeat the second with `--apply --manifest-out <path outside git>/phase1gpre_manifest.json`.
Inside one transaction the applier runs:

- the identity validator (must PASS);
- the ownership postcheck: each true owner owns the bare and www host via EXACT_HOST, refuted claimants own nothing, and there are 0 disagreements;
- `integrity_check`.

Any failure rolls the whole transaction back.

**Verify (must match the rehearsal)**

- Exactly 38 `athletics_domains` rows changed, WRONG_INSTITUTION → VERIFIED, and only `status`/`athletics_entity_id`/`ownership_class`/`notes`.
- Every other table and schema object is byte-identical. Corpus revision is unchanged.
- Integrity measure (`integrityMeasure.measureDatabase`):
  - 4,291 eligible, ids hash `99be2103`, NCAA hash `4ba22112` (or the 3b-adjusted values);
  - NAIA 370/381; all integrity counters 0.
- `validateAthleticsEntityIdentity`: PASS. `foreign_key_check`: 0. `integrity_check`: ok.
- `programme_contacts` still 0. Outreach tables and the 10 recipient-agreement triggers are unchanged.
- Spot checks:
  - the six named hosts resolve to their owner;
  - pct.edu, Pitt, Penn State, bloomu.edu, stmarytx.edu and the 11 kept hosts are unchanged.

**Rollback**

- **Primary:** run the applier with `--revert <manifest> --apply`. Rehearsed: it restores the base exactly.
- **Backstop:** restore the `PRE_PHASE_1GPRE` checkpoint.
