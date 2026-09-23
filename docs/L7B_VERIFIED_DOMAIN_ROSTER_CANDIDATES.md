# L7B — verified domain to roster candidate

L6D attempted 34 active NCAA programmes and made no request against any of them.
Every acquiring stage transforms a URL the pipeline already holds; these had
none, and the state file recorded `variants: none` thirty-four times. L7 found
the cause was not missing domains — most of the 34 sit on an athletics host the
ledger has verified — but that nothing inverted **institution → host → URL**.

This stage builds that inverse, and stops there. **No domain was backfilled, no
roster acquired, no production behaviour changed.** All six baselines are
byte-identical and nothing was repinned.

**21 of the 34 now have candidates. 14 of those reach a roster page under bounded
verification.** Before L7B the number was zero, for all of them.

---

## 1. One owner for the ledger

`shared/evidence/domainAuthority.js`. The trust predicate used to be the same
SQL copied into `evidenceQueries.js` and `rosterSourceAudit.js`, and L7B needed a
third reading. Both callers now ask the module and pass a profile.

### Classes

| class | meaning |
|---|---|
| `TRUSTED` | strong identity, athletics property, uncontested. Authority. |
| `QUARANTINED` | identity strong but the match is a short base name. Never authority; kept visible for the repair queue. |
| `INSUFFICIENT_IDENTITY` | no unitid, no verification, weak confidence, or not an athletics property. |
| `CONFLICTED` | some claimant was wrong about this host. Directional — see below. |

### Profiles

| | `STRICT` | `DISCOVERY` |
|---|---|---|
| who reads it | production source verification | candidate generation |
| conflicted row for its own unitid | no | **yes** |
| athletics-evidenced `INSTITUTION_SITE` | no | **yes** |
| `BASE_ONLY` | yes (unchanged) | **no** |
| trusted hosts | **917** — identical to the predicate it replaced | **923** |

`STRICT` reproduces the previous filter exactly, host for host. That is checked,
not asserted: the baselines pass unmoved.

## 2. `WRONG_INSTITUTION` is directional

The status records that a **claimant** said this host was theirs and the page
disagreed. It does not say the host is unidentifiable — its `unitid` is still
whoever the page named, established the same way a VERIFIED row's is. Across all
57 such rows, none lists its own unitid among `wrong_mappings`; by construction
none can.

The old reading discarded the row entirely, taking the true owner with the false
claimant:

```
uwlathletics.com   unitid 240329   "University of Wisconsin La Crosse Athletics"
wrong_mappings     [{ key: "Wisconsin-Stevens Point", claimantUnitid: 240480 }]
```

So a conflicted row is authority **for its own unitid** and refused for every
claimant `wrong_mappings` names — strictly narrower than trusting it outright. A
genuine cross-institution mismatch still cannot be resolved in the claimant's
favour: `njcugothicknights.com` self-identifies as Kean and stays refused for New
Jersey City, `saintmaryssports.com` is Saint Mary's of Minnesota's and stays
refused for Saint Mary's (IN). Both directions are tested.

## 3. `role` is coarse; the hostname is finer

Thirteen VERIFIED, CERTAIN, WHOLE_NAME rows sit on hosts named
`athletics.carlow.edu`, `avilaathletics.com`, `athletics.elms.edu` and were
excluded as `INSTITUTION_SITE`. The label is assigned by hostname shape, and an
athletics property on the institution's own domain fails that test while being
exactly what the label is a proxy for.

The evidence has to be the **hostname**, and the obvious alternative does not
work: `evidence_text` on these rows reads "Carlow University", "Elms College" —
it establishes *whose* the host is, which is the ledger's whole job, and says
nothing about *what* it is. A rule keyed on it would admit nothing.

Identity still has to be VERIFIED, strongly confident and WHOLE_NAME, so this
widens **what** a host may be and never **how** its owner is established. 14
hosts are promoted. `clemson.edu`, `uakron.edu`, `smsu.edu` and `goucher.edu`
are not among them, and there is a test for each.

## 4. `BASE_ONLY` quarantine

L7 measured 1,221 comparisons against the host each institution's own rosters
were fetched from. 1,211 agreed, and **every one of the ten disagreements was
`identity_strength = 'BASE_ONLY'`**. Eight such rows are in the trusted set:

| row | classification |
|---|---|
| `uconnhuskies.com`, `umassathletics.com`, `gocobbers.com`, `www.gosuffolkrams.com`, `tommiesports.com`, `redstormsports.com`, `westminstergriffins.com` | **KNOWN_WRONG** — 7 |
| `regisrangers.com` → Regis (CO) | **SAFE_ONLY_IF_STRONGER_EVIDENCE_EXISTS** — 1 |
| | REQUIRES_REVIEW — 0 |

None is repaired here; there is no stronger ledger record that resolves any of
them deterministically, and no fuzzy-name correction was used.

**`DISCOVERY` refuses all eight.** A wrong operator link is one bad click; a
wrong candidate is a whole roster imported against the wrong programme, and
these targets have no prior squad for the turnover gate to catch it with.

**`STRICT` still admits them, and L7B measured the alternative rather than
assuming it.** Excluding them from production moves `OPERATOR_EVIDENCE` by
exactly **four pairs across two programmes, both Regis (CO)** — the one
base-name row the evidence supports. The seven wrong ones cost nothing to
exclude because `registryIntegrity` already quarantines all seven downstream as
`INSTITUTION_MISMATCH`. So the choice is between keeping a class that is 87.5%
wrong but wholly contained, and dropping it at the cost of a real regression on
its one correct member. **That is a product decision, not an architecture one,
and L7B does not take it.** The measurement is here for whoever does.

## 5. Inverse lookup

`hostsForInstitution(rows, unitid)` → one of `OK` / `AMBIGUOUS` / `NO_TRUSTED_HOST`
/ `NO_UNITID`, never a silent first row. Several hosts is not by itself wrong — a
merged institution carries one per predecessor campus — so `AMBIGUOUS` is an
answer, not a failure. Where the institution's **own** roster usage settles a
multi-host case to exactly one, that one is returned, corroborated by observation
rather than preference. `www.` collapses; a subdomain does not.

Across 1,761 active NCAA programmes, DISCOVERY profile with usage:

| | n |
|---|---:|
| exactly one trusted host | **1,391** |
| several, nothing distinguishes them | **24** |
| no host this profile will stand behind | **343** |
| no unitid on the programme row | **3** |

The host belongs to the **institution**, so a men's and a women's programme share
one row. Nothing requires a duplicate per programme — sport only chooses the path.

## 6. URL shape catalogue

Derived from all 1,582 distinct 2026 NCAA roster sources. **Eight shapes, and
they cover 100%** — 1,444 of them, **91.3%**, in one family.

| shape | observed | providers |
|---|---:|---|
| `/sports/<SLUG>/roster/<YEAR>` | 1,444 | SIDEARM |
| `/sports/<SLUG>/<SPAN>/roster?view=table` | 71 | PRESTO |
| `/sports/<SLUG>/roster/season/<YEAR>` | 23 | NUXT, SIDEARM |
| `/sports/<SLUG>/<SPAN>/roster` | 16 | PRESTO |
| `/sports/<SLUG>/roster/season/<YEAR>?view=table` | 14 | NUXT |
| `/sports/<SLUG>/roster` | 7 | SIDEARM, NUXT |
| `/sports/<SLUG>/roster/<SPAN>` | 4 | SIDEARM |
| `/sports/<SLUG>/roster/<YEAR>?view=table` | 3 | SIDEARM |

Sport segments: `mens-soccer` 617 · `msoc` 49 · `m-soccer` 1 ·
`womens-soccer` 857 · `wsoc` 53 · `w-soccer` 1.

**The bare `soccer` slug is catalogued and not generated.** Four corpus URLs use
it, all at D1 schools fielding a women's programme and no men's. A school with
both would answer "the soccer roster" with no way to know which — and these
targets have no prior squad, so the turnover gate could not catch a wrong-gender
page. 0.25% of observed sources is not worth an identity risk.

No school is hardcoded anywhere.

## 7. Generator and ordering

`shared/roster/rosterCandidates.js` —
`rosterCandidatesForVerifiedHost({ host, sport, season, verified, platform })`.

`verified` is a required argument, not a default: the point of the file is that
it never runs on an academic domain, a BASE_ONLY match, or a name someone
searched for. With no host, or an uncatalogued sport, it returns **no candidates
and a reason**.

Ordering is **shape-major**: every slug for the commonest shape, then the next.
The shape is a property of the site's software and the slug a naming preference
within it, so the dominant shape on a second-choice slug beats a rare shape on
the first. Where the ledger recorded the host's `platform`, that provider's
shapes move to the front — a stable partition, so it is the same list in a better
order and identical when the platform is unknown. Endicott's roster is the fifth
candidate by raw frequency and the first once its host is known to be PRESTO.

No score, no heuristics, no crawling.

**Provider is a path convention, never an identity.** A host is not assumed to
run PRESTO because its name resembles another PRESTO site; `platform` is read
from the ledger row for that host, and a provider-shaped route stays a candidate
until it is fetched and the gates accept it.

## 8. Pipeline integration

`rosterCandidatePlan.js --csv` writes `_registry_candidates.csv`, which
`build_targets.py` reads **alongside** the membership export — a separate file
because that one answers *who counts* and must stay free of URLs. Absent file
means the previous behaviour exactly.

Precedence, as it now reads in `build_targets.py`:

```python
u = e['roster']                       # a prior season's page, if there is one
cand, meth = swap(u, SEASON), method(u)
if not cand and k in CANDIDATES:      # only where there was nothing to transform
    cand, meth = CANDIDATES[k], 'generated from a verified athletics host'
if k in KEPT: cand, meth = KEPT[k]    # a manual repair still wins over both
```

An observation always beats a suggestion. `u` stays empty for a registry-only
programme, so a generated candidate **never reaches the known-good column** and
cannot later be mistaken for a page we actually fetched. Status stays `todo`:
the candidate enters `direct → variants → selector → browse` as any other would,
and the soft-404 check, turnover gate, parsing, source validation and confidence
grade all still decide. Seven tests hold this, including the absent-file case.

**A verified host is not a verified roster page.** Those are different claims and
only the first is established when a candidate is generated.

## 9. The 34

```
EXISTING_CANDIDATE  0     NEW_VERIFIED_HOST_CANDIDATES  21
AMBIGUOUS_HOST      0     NO_TRUSTED_HOST               13
```

The 21 gain candidates from three sources: 15 from hosts already trusted under
the old reading, plus Wisconsin-La Crosse (the `WRONG_INSTITUTION` correction)
and Carlow M+W, Goucher M+W, Elms (the `INSTITUTION_SITE` correction).

### Bounded verification

One request per candidate until a programme answers, at most eight, sequential
with a pause. No parsing into data, no state, no sheet, no import.

| verdict | n |
|---|---:|
| `200_ROSTER` | **10** |
| `REDIRECT_TO_ROSTER` | **4** |
| `OTHER` — 200, reachable, no roster markup in the static HTML | 6 |
| `SOFT_404` | 1 |
| `403` · `404` | 0 · 0 |
| `NO_TRUSTED_HOST` (not attempted) | 13 |

Every reachable page was checked against `og:site_name` and named the right
institution: "Pace University Athletics", "College of Saint Benedict Athletics",
"Rivier University", "Endicott Athletics and Recreation".

The six `OTHER` are client-rendered PRESTO pages that return 200 with the roster
loaded by script — Northwood, Carlow M+W, Goucher M+W, Elms. `browse.py` drives
Playwright Chromium and is the instrument for exactly these; this verifier is
static and says so rather than guessing.

### Phase 16 result

| | n |
|---|---:|
| `READY_FOR_ACQUISITION` | **14** |
| `HOST_TRUSTED_BUT_NO_VALID_CANDIDATE` | **7** |
| `NO_TRUSTED_HOST` | **13** |
| `AMBIGUOUS_HOST` | **0** |

Nothing is counted ready on a probability. The 6 client-rendered are *probable*
and are not in the 14.

### A defect the verifier caught in itself

The first verification pass reported Wisconsin-La Crosse as resolved at
`uwlathletics.com/sports/mens-track-and-field/roster/gary-trkula/4182` — a
different sport, and a player rather than a squad. It carried roster markup and
passed a naive "did we land on a roster" test. Two fixes: the landing path must
still name the slug that was asked for, and must not end in a player segment
(with `2026`, `2026-27` and `season` excluded, since a season is not a person).
Under the corrected rule La Crosse is `SOFT_404` — the site answers every soccer
path with a redirect elsewhere. Four other programmes were caught the same way.

A second pass at full speed drew rate limits that read as 404s and would have
supported a confident false conclusion. The verifier now pauses between requests.

## 10. Broader NCAA simulation

Structural, not fetched. 1,761 active programmes:

| | n |
|---|---:|
| already hold a roster source — generator not used | **1,720** |
| would be offered candidates from a verified host | **26** |
| several hosts, ambiguous | **0** |
| no host this profile will stand behind | **15** |

The 26 exceeds the 21 because the gap set includes the seven duplicate registry
rows, some of which have hosts. Those are a registry-integrity job and untouched.

## 11. Impact

**Domain authority behaviour:** unchanged in production. `STRICT` reproduces the
previous filter host for host.

**Candidate generation:** new, and used by nothing yet — `_registry_candidates.csv`
is not written into any season directory by this stage.

**Operator `sourceUrl`:** unchanged. Verified by the baselines.

**Evidence semantics:** none. No kind is generated, selected, held or worded
differently. Candidate discovery is not an Evidence-policy change.

| surface | result |
|---|---|
| dataset manifest | `5bbca9054b7752d5` **unchanged** — no data written |
| OUTBOUND_DECISION · COACH_COMPOSITION · EMAIL_BODY · OPERATOR_WIRE · LOG_PAYLOAD · OPERATOR_EVIDENCE | **all PASS**, nothing repinned |
| P6 | unchanged |

## 12. Residual cohort for L7C

| band | n | what it needs |
|---|---:|---|
| `READY_FOR_ACQUISITION` | 14 | a bounded acquisition run on the generated candidates |
| client-rendered, host trusted | 6 | the same run — `browse.py` is already the stage for it |
| `SOFT_404` (Wisconsin-La Crosse) | 1 | manual source review; the host answers soccer paths with a redirect |
| `NO_TRUSTED_HOST` | 13 | bounded domain discovery — the backfill L7B deliberately did not do |

The 13: Southwest Minnesota State M, Tuskegee W, Wayne State (MI) W, Anna Maria
M+W, New Jersey City M+W, Eureka College W, Lasell W, Mitchell W, Saint Mary's
College (IN) W, Trinity Washington W, Wesleyan (GA) W.

Two of them are close. `smsumustangs.com` serves Southwest Minnesota State's
men's roster and is recorded `INSUFFICIENT_EVIDENCE` only because its
`og:site_name` reads "SMSU Athletics" — an abbreviation cannot match a whole
name. `goamcats.com` and `www.mitchellathletics.com` are the same shape of
problem. Resolving them needs a verification step that can accept an
abbreviation anchored on registry city and state, which is a discovery stage's
job and not this one's.

---

## Debt carried, not solved

**USCAA state-vs-sheet authority (from L6D).** Pipeline state holds
`Eastern College Athletic Conference` for Penn State Schuylkill women's soccer
while the sheet had been repaired out-of-band to the value the registry agrees
with. `write_out.py` rebuilds from state and reverted it. The general defect — a
sheet-level correction never written back to state is undone by any later run —
is unaddressed. USCAA is out of scope; this is about authority, not USCAA.

**One batch timestamp.** All 2,717 ledger rows share `checked_at`, so the table
cannot express a partial refresh.

**No owner.** No script in this repository writes `athletics_domains`.
