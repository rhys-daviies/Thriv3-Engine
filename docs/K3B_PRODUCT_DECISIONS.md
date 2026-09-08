# K3B — product decisions from generalisation validation

Design only. No production code, permissions, qualification, copy, grammar,
manifest, policy version or data changed by this document. Every number below
was measured against the live database at `64195cb`; the commands are named so
they can be re-run rather than believed.

---

## 1. REGIONAL_SPORT_BLACKOUT

### What the licence actually says

Two gates, both introduced together in `864155e` (*Add recruiting-history
evidence engine…*), the same commit that built the engine:

- `RECRUITING_EVIDENCE_SPORTS = ['mens-soccer']` — `shared/evidence/generate.js`
- `countryDataStatus()` returns `LICENSED` only for men's — `shared/recruiting/patterns.js`

The stated reason, quoted from the code:

> men's only. 9.7% of women's arrivals carry a nationality flag against 29.1%
> of men's, and roster data cannot separate under-recording from a smaller
> international share.

**Precautionary, not permanent.** `countryDataStatus` carries a
`validationNeeded` list of three hand-checks — a gate written to be re-opened
once someone did the work. This document is that work.

### The measurement

| | men's | women's |
|---|---:|---:|
| DIRECT arrivals | 43,162 | 44,287 |
| programmes | 884 | **1,164** |
| seasons | 2023–2026 | 2023–2026 |
| position recorded | 96.5% | **97.1%** |
| `entry_type` recorded | 100% | 100% |
| `prior_programme` recorded | 15.0% | 14.3% |
| country recorded | 29.1% | 9.7% |

**The last row is not a coverage metric.** `country` is populated only for
international arrivals — `country_pct` and `intl_pct` are the same number in
both sports, by construction. Every metric that *does* measure completeness is
equal or better on the women's side.

### Can real absence be told from missing observation?

Three tests, weakest first.

**1. Roster share vs arrival share.** Rosters, 2026: men's 29.3% international,
women's 9.5%. Arrivals: men's 29.1%, women's 9.7%. Both sports agree to within
0.2 points. *Weak evidence* — arrivals are derived from roster transitions, so
this only proves the arrival pipeline is faithful.

**2. Hometown vs country.** `hometown` is free text scraped from the roster
page and is not what `country` is read from, so a foreign hometown with an
empty `country` is a recording failure. Season 2026, all rows with a hometown,
tail token matched against US state names in full / AP / two-letter forms:

| | men's | women's |
|---|---:|---:|
| rows with hometown | 26,428 | 30,185 |
| non-US tail, `country` empty | 789 | 709 |
| **as % of roster** | **2.99%** | **2.35%** |

**Women's under-recording is lower than men's.** The top-20 empty-`country`
tails are US states in *both* sports — no foreign country appears in either.
The residuals are overwhelmingly US spelling variants (`Hawai'i`, `Tex.`,
`Wisc.`, `Penn.`), and the only genuine foreign tails in either list
(`ENG`×13, `England`×8) are on the **men's** side.

**3. The one that settles it.** `recruiting_arrivals.country` is a direct copy
of `roster_players.country` — `const country = r.country || null;`
(`shared/recruiting/arrivals.js:491`). Joined on `roster_row_id` across all
87,449 DIRECT arrivals in both sports: **12,560 + 4,298 matching, zero
divergent.**

So the arrival path and the roster path read *the same bytes*.

### The finding that reframes the question

Women's soccer **already sends country-identity claims in cold outreach,
today**. Forty women's programmes with an Irish roster player were run through
the real evidence path; **40 of 40 rendered a country claim**:

> "Amanda McQuillan came through the programme from Ireland back in 2022"
> "five players from Ireland have come through the programme since 2022"
> "Heather Payne came through the programme from Ireland back in 2022"

`HISTORICAL_SAME_COUNTRY` and `CURRENT_SAME_COUNTRY` are `ALLOWED` for every
sport and read `roster_players.country`. `ARRIVAL_SAME_COUNTRY_POSITION` and
`ARRIVAL_SAME_REGION_POSITION` are blocked for women and read
`recruiting_arrivals.country` — *the copy of the same column*.

**The same field is trusted on one path and distrusted on the other.** The
blocking rationale applies identically to both, or to neither. It cannot apply
to exactly one.

Two further facts sharpen it:

- `INTERNATIONAL_SHARE` — the one kind whose truth genuinely depends on
  completeness, because it states a proportion — is `DENIED` for every sport
  already. The completeness argument is doing its real work elsewhere.
- The `UNVALIDATED` status is *also* consumed by `countryAbsence()` in
  `patterns.js`, which blocks "nobody from X" claims. That is where the stated
  rationale belongs, and it is enforced there independently. Applying the same
  status a second time at the presence layer blocks claims the argument was
  never about.

Under-recording cannot make a presence claim false. If the roster says Sweden,
they took a Swede. It can only make the *count* an undercount — which is the
conservative direction.

### Options

| | truth safety | coverage | explainability | determinism | maintenance | false-personalisation | generic-email cost |
|---|---|---|---|---|---|---|---|
| **A** keep closed | no change | 0 | simple, but inconsistent with claims already sent | high | none | none | ~50% of athletes lose every relationship hook |
| **B** open all four kinds | presence claims safe; `POSITION_INTAKE_HISTORY` is `DENIED` anyway so only 3 kinds move | 632 women's programmes have a recent international arrival, 424 have ≥2 | consistent with the roster-sourced kinds already allowed | high | none | low | removes the blackout |
| **C** per-programme completeness gate | highest in theory | unknown until built | **poor** — "why did this programme get one and that one not" is unanswerable to an operator | high | ongoing threshold tuning | low | partial |
| **D** open only demonstrably reliable claim types | same as B in practice | same as B | best — the rule states *why* | high | none | low | removes the blackout |

**C is rejected on explainability.** A programme-level gate makes coverage
depend on a hidden threshold, and the operator surface has no vocabulary for it.

### Recommendation — **D**, expressed as a rule, not a sport list

Licence recruiting-pattern Evidence by **what the claim asserts**, not by which
sport it is about:

- **presence claims** (a count of ≥1 observed arrival, naming countries seen)
  are licensed wherever the underlying field is populated — which is already
  the standard applied to `HISTORICAL_SAME_COUNTRY`
- **absence and proportion claims** stay gated on completeness, unchanged,
  which is what `countryAbsence` and `INTERNATIONAL_SHARE`'s denial already do

In practice this opens `ARRIVAL_SAME_COUNTRY_POSITION`,
`ARRIVAL_SAME_REGION_POSITION` and `COACH_ARRIVAL_SAME_COUNTRY` for women's
soccer. `POSITION_INTAKE_HISTORY` is `DENIED` for all sports and does not move.

**This differs from the stated governance preference**, which was to keep the
licence closed unless absence could be distinguished from missingness. The
reason to depart is that the preference assumes the gate protects against a
risk it does not: these are presence claims, the completeness gate for absence
is separate and stays shut, and the product already sends the same claim shape
from the same column to the same coaches on the women's side. **Keeping it
closed is not the conservative option — it is an inconsistent one.**

If that reasoning is not accepted, **A** is the fallback and costs nothing but
coverage. The decision is Rhys's.

---

## 2. Displayed season

`recentSeasons` qualifies on `Math.max(...years)`; `when()` prints
`years[0]`, the oldest. **86 of 132** rendered clauses print a start year older
than the season that qualified them. Montevallo prints *"since 2023"*; it
qualified on **2026**.

The claim's meaning, from the qualification rule that admits it: *this
programme has recruited from the athlete's part of the world **recently***.
Recency is the entire reason the evidence is allowed. The copy must not hide it.

| | truth | recency | natural | multi-season | future seasons | determinism |
|---|---|---|---|---|---|---|
| **A** newest qualifying season | true | states it | "…two defenders from Sweden and Norway in 2026" | loses the span | fine | yes |
| **B** "recently", no year | true, vaguer | states it | weakest — a coach can't check it | n/a | fine | yes |
| **C** bounded span | true | states it | "…across 2025–26" | keeps it | fine | yes |
| **D** keep oldest | technically true | **hides it** | misleading | — | worsens over time | yes |

**Recommendation: C, degrading to A when the span is one season.** Print the
range from oldest to newest qualifying season — "in 2026" for one, "across
2025–26" for several. It keeps the depth the multi-season data earns while
making the newest season visible, which is the fact the rule actually gates on.
`spanOf` in `generate.js` already produces exactly this shape.

---

## 3. Country-list density

Confirmed distribution across 132 rendered clauses: **1**:42, **2**:41,
**3**:20, **4**:20, **5**:8, **7**:1 — 68% name ≥2, 22% name ≥4.

> "the programme has taken four defenders from Austria, Belgium, Greece and
> Portugal since 2025 — the same part of the world"

The graduation copy already settled the general question: `NAMES_IN_FULL = 3`,
`NAMES_WHEN_TRUNCATED = 2`, then `", including …"`. The regional claim is not a
special case — if anything the argument for compression is *stronger*, because
a graduating cohort's names are individually meaningful to the coach whereas a
country list is evidence for a single point about one part of the world.

**Recommendation: B, aligned to the existing constants.** Name up to 3; at 4+
say the count and name 2 — "four defenders from across Europe, including
Austria and Portugal". This reuses the numbers already ratified rather than
inventing a second convention. Option D (count only) is rejected: country
identity is part of the relationship being claimed, and dropping every name
makes the clause unfalsifiable to the reader.

---

## 4. Country articles

**No article authority exists anywhere in the repository.** The nearest
authority is `canonicalCountry()` + `ALIASES` in `shared/recruiting/regions.js`,
which already owns display normalisation — it is what turns
`"Korea, Republic of"` into `"South Korea"`.

Affected countries in the live dataset (DIRECT international arrivals):

| country | arrivals |
|---|---:|
| United Kingdom | 2,142 |
| Netherlands | 369 |
| Dominican Republic | 71 |
| United Arab Emirates | 31 |
| Bahamas | 28 |
| Democratic Republic of the Congo | 18 |
| Philippines | 8 |
| Gambia | 3 |

(`Korea, Republic of`, 83, is already handled by `ALIASES` and needs no
article.) 2,670 arrival rows, dominated by one country.

**Recommendation:** one sibling export beside `canonicalCountry` — a
`countryPhrase(country)` returning the display name with its article — and a
frozen set of the ~10 countries that take one. Not a regional-Evidence
dictionary: any surface naming a country should use it.

---

## 5. Dataset manifest gap

The manifest's stated purpose, from `evidenceBaseline.js`, is to make a moved
hash say *which* of code or data moved — "DATASET CHANGED is a different
message from a product regression and must never be reported as one." That is
a claim about **all behavioural data inputs**, so `updated_date` belongs: it
feeds `rosterUpdatedAt`, which is printed in three payloads and drives
`freshness`.

Simulated, read-only:

| variant | roster_players digest | dataset digest |
|---|---|---|
| current | `16a5f3ca4414f6a9` | `7f19b7d8b75608c2` |
| + full `updated_date` | `159136432f6d8fb3` | `65b2c5e73ad73443` |
| + `DATE(updated_date)` | `6eb327887965cb7e` | — |
| **separate per-programme `MAX(updated_date)`** | unchanged | new entry |

Adding it makes `dataset: CHANGED`, and `compareBaselines` then reports **all
six lines UNCOMPARABLE** at once. The expected hashes themselves do not move
and **production behaviour does not move** — only the comparability verdict,
until the manifest is repinned once.

Full-timestamp inclusion has a real cost: **11,856 distinct `updated_date`
values**, so the manifest would flap on every partial re-scrape, and a tripwire
that cries CHANGED constantly trains people to repin without reading.

**Recommendation:** add a **sixth manifest entry**, `roster_freshness` =
`MAX(updated_date)` per `(college_name, sport)` — **2,122 rows**, digest
`7e4ee229137e31ee`, currently one scrape day. That is *exactly* what
`rosterUpdatedAt` reads: no more, no less. It leaves the existing
`roster_players` digest untouched so that line keeps its meaning, and it moves
the dataset digest exactly once, as a documented transition with the manifest
gaining a `version` field so an old pin is recognisably old rather than wrong.

---

## 6. Saved-template coverage

Precisely stated: the constant **is** covered structurally —
`templateMigration.test.js` asserts it contains `{{evidence_paragraph}}` and
that migration is idempotent; `stageJCloseout.test.js` imports it. What is
missing is a **behavioural tripwire on the rendered output** of the
saved-template path. That is why a K3A mutation of the signature line moved no
baseline: no corpus athlete holds a saved template, and the structured path
wins for all 4,742 pairs.

| | isolation | bites | cost |
|---|---|---|---|
| **A** synthetic fixture unit test | clean | yes | small |
| **B** separate validation corpus | clean | yes | a second corpus to maintain |
| **C** extend baseline generator | **breaks K2/K3A isolation** — the pair count and every pin move | yes | high |
| **D** saved template on a real athlete | **contaminates production data** | yes | unacceptable |

**Recommendation: A.** A fixture athlete with a saved template, rendered
through `emailBodyFor`, asserted on content. C is rejected because 4,742 is a
ratified invariant; D is rejected outright.

---

## 7. Policy version

`OUTREACH_POLICY_VERSION = 'P3'`. Under I2's bump rule — licensing,
qualification, selection, dedupe, copy semantics, structure semantics:

| decision | layer | bump? |
|---|---|---|
| 1. open women's presence claims | **licensing** | **yes** |
| 2. displayed season | **copy semantics** | **yes** |
| 3. country-list compression | **copy semantics** | **yes** |
| 4. country articles | copy *rendering*, not semantics — the claim is unchanged | no on its own |
| 5. manifest entry | harness, not policy | no |
| 6. template fixture | test, not policy | no |

**Proposal: one bump, P3 → P4**, covering decisions 1–3 (and 4 travelling with
them). Not three bumps: they would ship together and a version per edit makes
the field a changelog instead of a boundary. Not zero: a licence change plus
two copy-semantic changes is exactly what the rule names.

---

## 8. Interaction review

- **Compression × regional meaning.** Compressing to "including X and Y" keeps
  ≥2 named countries in every clause, so the relationship claim stays checkable
  by the reader. No coupling.
- **Women's licence × copy fixes.** If the licence stays closed (option A),
  decisions 2, 3 and 4 affect **men's soccer only** and women's athletes see no
  change from K3B at all. Worth stating plainly: under option A, K3B improves
  emails for half the population and leaves the other half exactly as K2 found
  them.
- **Displayed season × qualification.** Changing what is *printed* does not
  touch `recentSeasons`, which reads the facts. `POSITION_FLOW_HOLD` keys on
  kinds, not on season text, so it is unaffected. Verified by reading, not
  assumed: the hold's membership is a literal list of kind names.
- **Manifest × baselines.** The one-time UNCOMPARABLE is the whole cost, and it
  is why the transition wants its own commit rather than riding along with a
  copy change — otherwise a copy regression would be invisible in the same run
  that repins the dataset.
- **Order.** Manifest first (safety net), then copy (2/3/4 together with the
  P4 bump), then the licence decision (1) last and alone, since it is the only
  one that changes who receives what.

---

## 9. Deliberately rejected

- Programme-level completeness gate for women's evidence — unexplainable to an
  operator.
- Count-only regional copy — removes the country identity the claim rests on.
- A regional-Evidence-specific country dictionary — duplicates
  `canonicalCountry`.
- Full-timestamp manifest inclusion — 11,856 values, flaps on every re-scrape.
- Extending the canonical corpus or adding a saved template to a real athlete —
  both break ratified isolation.
- Three separate policy bumps.
