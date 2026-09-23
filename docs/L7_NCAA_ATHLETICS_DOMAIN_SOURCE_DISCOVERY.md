# L7 — NCAA athletics domain and source discovery

L6D left 34 NCAA programmes unacquirable because the pipeline had no roster URL
for them and no way to find one. This stage asked whether `athletics_domains`
can supply that starting point.

**It can, and the reason is not the one the roadmap expected.** The blocker was
never domain *coverage*. Fifteen of the 34 already had a verified athletics
domain, and thirteen of those serve their roster at the first URL you would try.
What stands between the table and the pipeline is a missing four-line step, plus
three narrow defects in how the ledger's own status is read.

**Recommendation: B — BACKFILL_PLUS_SMALL_DISCOVERY_STAGE.**

Audit only. No data written, P6 unchanged, manifest unchanged, all six baselines
byte-identical.

---

## 1. What `athletics_domains` is

**A host-identity ledger, not a school-to-domain map.** The primary key is
`domain`, and `unitid` records *who the host said it was* when it was fetched —
from its own `og:site_name` or page title. The table answers "whose site is
this?", which is the verification direction. Discovery needs the inverse, and
the inverse is only sound where the forward assignment is.

2,717 rows, all `checked_at = 2026-09-01T09:28:40.920Z`. One batch.

| distinguish it from | which is |
|---|---|
| institution academic domain | `role = 'INSTITUTION_SITE'` here, or `colleges.website_domain` (empty for all 34) |
| programme roster URL | `roster_players.source_roster_url` — per programme-season |
| roster page host | the host of that URL, which this table exists to *judge* |
| CMS/provider host | the `platform` column: SIDEARM, PRESTO, NUXT |

### Owner

**Nothing in this repository writes it.** Every reference is a read. The two
scripts with `athletics_domain` in their names — `tools/soccer/build.py` and
`repair_athletics_domain.py` — write the individualisation CSVs from a
*different* artefact, `athletics_domains.json`, and never touch the table.

Consumers:

| reader | what it does |
|---|---|
| `evidenceQueries.verifiedDomains()` | builds the trust map production uses |
| `sourceVerification.verifyRosterSource` | condition 3 and 4 of five |
| `registryIntegrity` | the fifth check — refuses a host the assigned institution's own rosters never use |
| `rosterSourceAudit` | the operator-facing repair queue |
| `evidenceBaseline` | **fingerprints it into the dataset manifest** |

A table with no owner, five readers and a behavioural surface downstream is
where a quiet widening of the trust filter would go unnoticed, so
`server/scripts/athleticsDomainAuthority.test.js` now pins the filter and the
findings below.

### The trust filter is the trust model

```sql
status IN ('VERIFIED','VERIFIED_ALIAS') AND role = 'ATHLETICS_SITE'
  AND confidence IN ('CERTAIN','CORROBORATED') AND unitid IS NOT NULL
```

942 rows pass, covering 893 institutions.

## 2. Coverage, reproduced

Measured as "the programme's `unitid` has at least one trusted athletics host".
The old ~54% / ~48% figures do not reproduce.

| division | sport | programmes | domain | % |
|---|---|---:|---:|---:|
| NCAA D1 | men | 213 | 161 | 75.6 |
| NCAA D1 | women | 349 | 261 | 74.8 |
| NCAA D2 | men | 203 | 154 | 75.9 |
| NCAA D2 | women | 260 | 194 | 74.6 |
| NCAA D3 | men | 318 | 251 | 78.9 |
| NCAA D3 | women | 418 | 316 | 75.6 |
| **NCAA total** | | **1,761** | **1,337** | **75.9** |

Institution level: **771 of 1,029 distinct unitids, 74.9%**. The two figures are
close because one athletics host serves both a men's and a women's programme.
1,338 distinct school names sit on those 1,029 unitids — the naming-variant
spread that makes `unitid` the only safe join.

## 3. Quality — measured against an independent signal

Not sampled. Every active NCAA programme with both a 2026 roster source and a
trusted host for its `unitid`: **1,221 comparisons.**

| | n |
|---|---:|
| roster host matches a trusted host of the same institution | **1,211** |
| roster host trusted but assigned to a **different** institution | 10 |
| roster host not in the trusted set at all (coverage, not error) | 353 |

The ten disagreements collapse to seven hosts, and **every one is
`identity_strength = 'BASE_ONLY'`** — a host matched on a short base name:

| host | assigned to | actually |
|---|---|---|
| `uconnhuskies.com` | Connecticut College | UConn |
| `umassathletics.com` | Massachusetts Maritime | UMass Amherst |
| `gocobbers.com` | The Citadel | Concordia-Moorhead |
| `www.gosuffolkrams.com` | The Citadel | Suffolk |
| `tommiesports.com` | St Thomas (TX) | St. Thomas (MN) |
| `redstormsports.com` | Saint John Fisher | St. John's |
| `westminstergriffins.com` | Westminster (MO) | Westminster (UT) |

There are only **eight** BASE_ONLY rows in the trusted set and seven are wrong.
The other **934 are WHOLE_NAME and produced no observed error at all.**

| classification | n |
|---|---:|
| CORRECT_CANONICAL / CORRECT_REDIRECT (corroborated by the institution's own roster) | 1,211 |
| OTHER_WRONG (BASE_ONLY name collision) | 7 hosts / 10 programmes |
| UNVERIFIABLE by this audit's tooling (CDN 403) | 6 hosts |
| STALE_BUT_RELATED · ACADEMIC_DOMAIN_WRONG · THIRD_PARTY_WRONG | 0 observed |

**Observed error rate: 10/1,221 = 0.82% on the production filter; 0 of 1,211
WHOLE_NAME corroborations; 7 of 8 BASE_ONLY.** `identity_strength` is the whole
story, and it is already a column.

**None of the sixteen hosts serving the 34 is BASE_ONLY.** All sixteen are
WHOLE_NAME with `og:site_name` evidence.

Production is not currently exposed to the seven: `registryIntegrity` and the
`unitid` comparison quarantine all of them as `INSTITUTION_MISMATCH`. The fifth
check is doing exactly what it was added for.

## 4. Two recoverable defects, and one that is correct

**a. `WRONG_INSTITUTION` means "a school claimed this wrongly", not "this host
is wrong."** The row's own `unitid` is still the true owner, established the
same way a VERIFIED row's is — **no row lists its own unitid among the bad
claimants, 0 of 57.** `uwlathletics.com` carries `unitid` 240329 (UW-La Crosse)
and evidence "University of Wisconsin La Crosse Athletics", and is rejected
outright because *Wisconsin-Stevens Point* also claimed it. L7 fetched it:

```
uwlathletics.com/sports/mens-soccer/roster/season/2026 → 200
og:site_name = "University of Wisconsin La Crosse Athletics"
```

49 of the 57 belong to an active NCAA soccer institution. Not all are
recoverable — `njcugothicknights.com` redirects to `keanathletics.com` and
self-identifies as Kean, so New Jersey City's rejection is correct, and
`saintmaryssports.com` really is Saint Mary's of Minnesota's. The status is a
per-row question that a per-claimant reading answers.

**b. `role` excludes athletics sites hosted on the institution's own domain.**
Thirteen VERIFIED/CERTAIN/WHOLE_NAME rows are labelled `INSTITUTION_SITE` while
naming athletics in their own evidence — `athletics.carlow.edu`,
`athletics.goucher.edu`, `athletics.elms.edu`, `laserpride.lasell.edu`,
`avilaathletics.com`, `doaneathletics.com` and seven more. Five of the 34 sit
behind exactly this.

**c. `www.` collapsing is correct.** Ten excluded rows share a canonical host
with a trusted twin. Nine are the same site under two spellings with `unitid`
null on the excluded side; the tenth agrees. **No canonical host maps to two
different institutions** — asserted, and the collapse never moves an identity.

Also observed: `smsumustangs.com` self-identifies as "SMSU Athletics" and was
recorded `INSUFFICIENT_EVIDENCE` because an abbreviation cannot match a whole
name. It serves Southwest Minnesota State's men's roster. Abbreviation-only
self-identification is a third, smaller class.

## 5. The 34

**DOMAIN_PRESENT 15 · DOMAIN_MISSING 19.** All 34 carry a `unitid`; none has a
`website_domain`. The men's and women's rows of one institution often differ in
name — "Carlow" and "Carlow University", "Goucher" and "Goucher College" — and
share a unitid, which is why identity is anchored there.

### Live verification

Bounded HTTP verification only. No roster was parsed, imported or written.

| classification | n |
|---|---:|
| `VERIFIED_DOMAIN_AND_ROSTER` | **15** |
| `OTHER` — domain known, host CDN-blocks the audit's client at its **root** | 11 |
| `NO_OFFICIAL_DOMAIN_FOUND` | 8 |
| `VERIFIED_DOMAIN_NO_ROSTER` · `DOMAIN_AMBIGUOUS` · `PROGRAMME_STATUS_QUESTION` | 0 |

**Verified, roster reachable (15).** Thirteen answered `/sports/<sport>/roster`
at the first attempt, each with `og:site_name` naming the right institution:
Pace M, Wisconsin-Oshkosh M, Bryn Athyn M+W, Azusa Pacific W, Glenville State W,
College of Saint Benedict W, Norwich W, Rivier W, Simmons W, St. Catherine W,
UMass Boston W, UMass Dartmouth W. Two more came from the defects above:
Wisconsin-La Crosse M via the falsely-rejected `uwlathletics.com`, and Southwest
Minnesota State M via `smsumustangs.com` at
`/sports/mens-soccer/roster/season/2026`.

**Blocked at the root, not the path (11).** Northwood W and Endicott W (both
PRESTO, both trusted), Anna Maria M+W, Elms W, Mitchell W, Carlow M+W, Goucher
M+W, Lasell W. Every one returns **403 at `/`**, so nothing about the roster path
is disproved — and `www.gonorthwood.com/sports/msoc/2026-27/roster?view=table`
is already in the corpus for Northwood's *men's* programme, on the same host.
This is a limit of the audit's client, not a finding about the sites:
`browse.py` drives Playwright Chromium with
`--disable-blink-features=AutomationControlled`, which is the instrument that
got past these before.

**No official domain established (8).** Tuskegee W, Wayne State (MI) W, New
Jersey City M+W, Trinity Washington W, Wesleyan (GA) W, Eureka College W, Saint
Mary's College (IN) W. Five institutions have no ledger row at all; NJCU's
recorded host now belongs to Kean; Saint Mary's (IN) has only Saint Mary's of
Minnesota's host; Eureka has only its academic domain.

## 6. Provenance contract

The schema already holds more than a discovery step needs:

| requirement | column | present |
|---|---|---|
| institution identity | `unitid` | ✔ |
| domain | `domain` (PK) | ✔ |
| discovery source | `claimed_keys`, `claimed_unitids` | ✔ |
| verification source | `evidence_kind`, `evidence_text`, `final_url` | ✔ |
| verification date | `checked_at` | ✔ |
| confidence | `confidence`, `identity_strength` | ✔ |
| canonical/redirect | `status` VERIFIED vs VERIFIED_ALIAS, `final_url` | ✔ |
| verified vs guessed | `status` + `confidence` + `identity_strength` | ✔ |

**Schema sufficient: YES.** A guessed domain cannot masquerade as a verified one
— `INSUFFICIENT_EVIDENCE`/`NONE` is already a distinct, excluded state. What is
missing is not a column but a `checked_at` per row: one batch timestamp means
the table cannot express partial refresh. That is the only schema note, and it
does not block.

## 7. Domain → roster

`variants.ladder(cand, url25)` is a URL *transformer*: with both inputs empty it
returns an empty list, which is exactly what L6D recorded 34 times as
`err: "no candidate"`. There is no stage that turns a host into a first URL.

The gap is small, because the target space is not arbitrary. Across **1,582
distinct NCAA roster sources in the 2026 corpus, 100% sit under
`/sports/<sport-slug>/…roster…`**, in nine shapes:

| shape | n |
|---|---:|
| `/sports/<SPORT>/roster/<SEASON>` | 1,447 |
| `/sports/<SPORT>/<SEASON>/roster?view=table` | 71 |
| `/sports/<SPORT>/roster/season/<SEASON>` | 20 |
| `/sports/<SPORT>/<SEASON>/roster` | 16 |
| `/sports/<SPORT>/roster/season/2026?view=table` | 14 |
| `/sports/<SPORT>/roster` | 7 |
| remaining three shapes | 7 |

`/sports/<SPORT>/roster*` alone covers 92.9%.

### Provider clusters

| platform | shape | deterministic |
|---|---|---|
| SIDEARM | `/sports/{mens,womens}-soccer/roster[/<season>]` | yes — 13 of 13 probed answered first try |
| PRESTO | `/sports/{msoc,wsoc}/<season>-<yy>/roster[?view=table]` | yes — corroborated by 37 corpus URLs |
| NUXT | season-bearing, same `/sports/` root | yes |

**The missing stage is a candidate generator, not a crawler:** given a verified
host and a sport, emit this ordered ladder and hand it to the existing `direct`
stage. Every gate downstream — soft-404, turnover, source validation, confidence
— is untouched and still decides.

## 8. Options

| | accuracy | identity risk | automation | repeatable | maintenance | provenance | cost |
|---|---|---|---|---|---|---|---|
| **A** existing internal source | high where present | none — already unitid-anchored | full | yes | none | full | ~0 |
| **B** institution → athletics property | high | low — verify `og:site_name` against registry, the method already in use | full | yes | low | full | low |
| **C** conference directories | medium | medium — directories name schools, not unitids | partial | fragile | per-conference | weak | medium |
| **D** search-assisted | medium | **high** — name-only matching is how BASE_ONLY produced seven errors | partial | no | high | weak unless re-verified | medium |
| **E** manual curated tail | highest | none | none | no | per-season | full if recorded | high for 34, unbounded later |
| **F** hybrid: A for the recoverable rows, B for the rest, E for the residue | high | low | mostly | yes | low | full | low |

**A is not empty** — it is where most of the answer already is: 15 of the 34 are
unblocked by rows already present, and 49 more institutions sit behind the
`WRONG_INSTITUTION` reading alone.

### Trusted discovery inputs, ranked

1. `unitid` — the only identity that survives naming variants. 1,338 names, 1,029 unitids.
2. `athletics_domains.unitid` + `evidence_text` — page self-identification, the method that produced 1,211 corroborations.
3. `roster_players.source_roster_url` — an independent host observation; the signal this audit measured against.
4. `colleges.city`/`state` — disambiguates same-name institutions (Westminster UT/MO, St Thomas MN/TX).
5. `conference` — a filter, never an identity.
6. school name — **candidate generation only, never proof.** Seven errors say so.

## 9. Product impact

**Operational acquisition.** This is the real one: 34 programmes cannot be
acquired at all. Domain coverage is the input, and 15 of 34 already have it.

**Operator provenance.** 1,404 of 1,910 programme-seasons can offer a roster
link (men's 611/826, women's 793/1,084 — 73.5%). The 506 that cannot break down
as **477 UNVERIFIED_HOST**, 21 INSTITUTION_MISMATCH, 8 UNKNOWN_INSTITUTION. Only
the first is a domain-coverage problem; the second is registry repair.

**Evidence semantics: none.** No Evidence kind is generated, selected, held or
worded differently by a domain. A domain decides whether a claim already being
made carries a checkable link.

### A correction this stage owes

`evidenceProvenance.js` carried H11's measurement as present tense: "`sourceUrl`
is null on every one of 10,206 live objects". **It is not, under P6.** L7
measured the canonical corpus directly:

```
4,742 pairs · 48,871 objects carrying the field
6,936 with a URL · 2,602 of 4,742 pairs (54.9%) show at least one
```

The kinds added since H11 rest on the current season, which one page can prove.
The comment is corrected; the behaviour it describes is unchanged.

## 10. Predicted movement — do not repin

`athletics_domains(domain, unitid, status, role, confidence)` is a **manifest
input**. Any backfill moves the dataset digest, and the corpus definition with
it.

| surface | prediction |
|---|---|
| dataset manifest | **MOVES** — five fingerprinted columns |
| `OPERATOR_EVIDENCE` | **MOVES** — the only surface carrying `sourceUrl` |
| `OUTBOUND_DECISION` · `COACH_COMPOSITION` · `EMAIL_BODY` · `OPERATOR_WIRE` · `LOG_PAYLOAD` | **STILL** |

Traced, not assumed: `sourceUrl` reaches `operatorFacts.js` → `operatorEvidence`
→ the provenance drawer, and appears in no wire or log payload.

**Scale.** Trusting the 477 UNVERIFIED_HOST programme-seasons would touch up to
**881 canonical pairs**, ~18.6% of the corpus. The 21 mismatches account for 41
more and are not a domain job.

A backfill is therefore a `DEFINITION_CHANGED` event: OPERATOR_EVIDENCE must be
re-derived and re-pinned deliberately, with the movement explained, and the other
five must be shown not to have moved. Nothing was repinned here.

## 11. Recommendation — B

**BACKFILL_PLUS_SMALL_DISCOVERY_STAGE.**

Not A: verified domains are necessary but a host alone still cannot become a
candidate URL. Not C or D as primary: both re-introduce name-based identity,
which is the one failure mode measured in this data. Not E: 15 of 34 need no
human at all, and a manual mapping would have to be re-made every season. Not E
the verdict *DO_NOT_USE* either — at 0 observed errors in 1,211 WHOLE_NAME
corroborations the ledger is the most reliable identity artefact in the
repository.

### Next stage, exactly

1. **Read the ledger correctly, write nothing.** Widen `verifiedDomains()` to
   admit a `WRONG_INSTITUTION` row *for its own `unitid`* when that unitid is
   not among `wrong_mappings` claimants, and admit `role='INSTITUTION_SITE'`
   rows whose evidence names athletics. Both are read-path changes; both move
   OPERATOR_EVIDENCE and neither moves the manifest.
2. **A deterministic candidate generator.** `host + sport → ordered ladder`, the
   nine shapes above, feeding the existing `direct` stage. No crawling, no
   search, no new gate, nothing weakened.
3. **Then, and only then, a bounded domain backfill** for institutions with no
   row, verified by page self-identification against registry `unitid`, city and
   state — never by name.

### Backfill sizing, for when step 3 runs

| band | n | what |
|---|---:|---|
| `HIGH_CONFIDENCE_AUTO` | 0 | nothing is auto-writable before the provenance step above |
| `HUMAN_REVIEW` | 8 | the institutions with no established athletics host |
| `DO_NOT_WRITE` | 7 | the BASE_ONLY rows — repair, do not extend |

### The 34 after step 1 and 2

| | n |
|---|---:|
| `READY_FOR_ROSTER_ACQUISITION` | **15** proven, **11 more** probable once a real browser runs the ladder |
| `DOMAIN_BLOCKED` | **8** |
| `ROSTER_SOURCE_BLOCKED` | 0 established |

None is resolved until acquisition actually succeeds.

## 12. Completion bar

Not a percentage. L5's ≥75% is already met (75.9%) while 34 programmes remain
unacquirable, which is the proof that the metric was measuring the wrong thing.

1. **Every active NCAA programme the pipeline must acquire has a verified
   athletics identity anchored on `unitid`.** Today 15 of 34. Target 34 of 34.
2. **No trusted host is assigned to an institution its own rosters contradict.**
   Today 7 outstanding, all quarantined. Target 0 stored, not merely 0 offered.
3. **Every roster source a programme actually uses is either trusted or has a
   recorded reason.** Today 1,404 linkable and 506 with reasons; no unclassified.
4. **Identity is never established by name alone.** Structural, permanent.

Coverage percentage is a by-product of 1 and 3, not a target.

---

## Future debt, recorded not solved

**USCAA state-vs-sheet disagreement (from L6D).** The pipeline's state holds
`Eastern College Athletic Conference` for Penn State Schuylkill women's soccer;
the sheet had been repaired out-of-band to `Pennsylvania State University
Athletic Conference`, which the registry agrees with. `write_out.py` rebuilds
from state and silently reverted it. L6D restored the sheet. **The general
defect — a sheet-level correction that is never written back to state is undone
by any later run — is unaddressed.** USCAA is out of scope; this is a note about
authority, not about USCAA.

**One batch timestamp.** `checked_at` is identical on all 2,717 rows, so the
table cannot express a partial refresh.

**No owner.** No script in this repository writes `athletics_domains`.
