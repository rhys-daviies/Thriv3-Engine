# Phase 7D — Institution Identity Model + Structural Cleanup APPLIED (shared dev)

The remaining NAIA problem was institution identity representation, not coach acquisition. Phase 7D
proved that UNITID-only identity fails, built the minimum additive athletics-entity model, applied it
and the proven structural repairs to shared dev, recovered all eight NAIA identity residuals, and left
a permanent invariant. Production untouched; `STRICT_CORROB_SCOPE=NAIA` unchanged; no merge/deploy.

## Part 0 — checkpoint
Pushed `5b16e43` (fast-forward; local==remote; 15 ahead / 0 behind main; privacy clean; tracked-clean).

## Part A — whole-DB structural anomaly ledger (read-only)
20 duplicate `(unitid, sport)` keys (14 within-division, 6 cross-division); 13 null-UNITID rows (11 active);
7 federal UNITIDs hosting more than one athletics entity (IU Indy/IU Columbus; Commonwealth ×3; PennWest ×3;
Vermont State ×3; St. Joseph's NY ×2; Park/Park Gilbert; Benedictine/Benedictine Mesa); 3 branch campuses;
3 non-Title-IV/foreign; wrong federal UNITIDs (SF-IL men's row on Peoria nursing 148575; East Central NJCAA
on 207041; Penn State Brandywine missing its own 214731); 1 active/inactive duplicate (Harper).

## Parts B/C — semantics, and proof the additive model is required
`federal_unitid` = the entity's own six-digit IPEDS UNITID or NULL (never synthetic, never a College Navigator
location code such as 15111102 or 14570703); `parent_unitid` = the reporting parent, the only sanctioned
sharing; `athletics_entity_id` = internal stable id; programme = entity + sport (one `colleges` row).
`colleges.id` already distinguished programme rows, but the reconciler, `athletics_domains`,
`institution_aliases` and every coverage/division measure keyed on UNITID. Measured failures:
33 coaches silently canonicalised onto another campus's row (14 eligible); 15 branch coaches resolved into
the parent's programme (5 across divisions, e.g. Benedictine Mesa NAIA -> Benedictine NCAA D3); 42 programmes
on 19 shared coverage keys; the frozen NCAA gate hash (6d2df77f) itself mis-divisions coaches on shared/null
keys; runtime outreach (keyed on `canonical_school`) routed 5 NAIA coaches to NCAA D2 / NJCAA rows.

## Part D — ground truth (NCES/IPEDS + official hosts)
IU Columbus: no own UNITID, parent 151111, `iuccrimsonpride.com`, NAIA River States. Park Gilbert: parent
178721, `gilbert.parkathletics.com`, NAIA GSAC. Benedictine Mesa: parent 145619 (Lisle, NCAA D3),
`benuredhawks.com`, NAIA GSAC, active. Stanton: non-Title-IV (WSCUC/BPPE), no UNITID, NAIA Cal Pac, M+W.
SF-IL: 148584 = USF Joliet; 148575 = Peoria nursing college, no athletics. Calumet: one men's programme
(150172). SCAD: NAIA Savannah only; no NCAA D3 SCAD soccer. Shawnee State: NAIA 2025-26 -> NCAA D2 2026-27.
Spartanburg Methodist: NAIA since 2024-25.

## Part E — name drift
76 NAIA drift unitids (75 active, as Phase 7C, + Siena Heights with an inactive men's row): 32 harmless
display drift, 22 campus qualifier missing, 21 canonical rename/historical name, 1 true duplicate. Only
Calumet is integrity-relevant (18 roster rows under the duplicate spelling). No renames applied.

## Parts F/G/H — model, simulation, apply
Additive: `athletics_entities` (schema.sql), `colleges.athletics_entity_id` + `athletics_domains.athletics_entity_id`
(migrate.js). 1,482 entities (1,460 SINGLE, 11 SYSTEM_CAMPUS, 3 BRANCH_CAMPUS, 2 NON_TITLE_IV, 1 FOREIGN,
5 UNRESOLVED_FEDERAL); all 2,409 rows assigned. Reconciler: entity path only inside the strict scope when the
model is populated; proven inert without it (0 diffs across 6,486 rows). Structural repairs: SF-IL men's row
148575 -> 148584 with Joliet's institution-level Scorecard fields; alias + `gofightingsaints.com` -> 148584;
stale Spartanburg NJCAA row deactivated; 4 entity-owned hosts. Calumet resolved at the identity layer (physical
merge deferred: `importProgrammeSeasons` matches exact `sport|name` and would undo it). 16 simulation gates
PASS; live == simulated on every metric; reversal manifests kept.

## Parts I/J/K — residuals
All 8 NAIA identity residuals recovered (IU Columbus M/W, Park Gilbert M/W, Benedictine Mesa M/W, Stanton W,
SF-IL W): 18 current staff re-observed on each entity's own host, 2 SF-IL coaches reassigned from the IN
programme. Oakland City (gomightyoaks.com 404s everywhere, residential Chrome included) and Jarvis (host
does not resolve; new interim coach named but no address) stay AUTHORITATIVE_SOURCE_BLOCKED. The 8
no-email holds were not re-researched.

## Parts L/M/N — regression, invariant, closure
NCAA truthful membership unchanged; legacy hash still 6d2df77f; NAIA covered no regression; no coach
silently moved; no roster/record/outreach row moved; all integrity metrics 0 (duplicate identity 1 = baseline).
Permanent `validateAthleticsEntityIdentity.js` (H1–H8) PASS with 12 documented exceptions
(`shared/athleticsEntityExceptions.json`). NAIA: 383 logical programmes, **372 covered (97.13%)**,
8 no-email holds, 3 blocked-source holds, 0 identity holds — **100% explained**. Shawnee State M/W covered
but flagged CROSS_DIVISION_TRANSITION.

## Part O — NJCAA/USCAA readiness
Every row resolves to an entity; model is safe. Prerequisites before integrity work: 3 UNRESOLVED_FEDERAL
NJCAA entities, East Central wrong UNITID, STLCC consolidation, Central Penn division label; NJCAA universe
contains men's soccer only; both divisions have zero coach and coach_seasons rows.
