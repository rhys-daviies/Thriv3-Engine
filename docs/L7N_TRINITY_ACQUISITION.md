# L7N — seven decisions recorded, and the tenth gap closed

**Seven human reviews persisted. Trinity Washington acquired: 13 players, from a
generated candidate on a newly trusted host, through the normal gates.**
NCAA rostered 1,744 → **1,745**; active gaps 10 → **9**. Three cases deliberately
left unreviewed. `colleges.active` untouched.

---

## 1. The seven reviews

Recorded through the production API, validated by the same contract the operator
UI uses, with **no reviewer identity invented** — the application has no
authentication, so `reviewed_by_operator_id` is null on all seven, exactly as
L7L documented.

| programme | disposition | next action |
|---|---|---|
| Anna Maria M | `PROGRAMME_STATUS_QUESTION` | `CONFIRM_PROGRAMME_STATUS` |
| Anna Maria College W | `PROGRAMME_STATUS_QUESTION` | `CONFIRM_PROGRAMME_STATUS` |
| New Jersey City M | `PROGRAMME_STATUS_QUESTION` | `CONFIRM_PROGRAMME_STATUS` |
| Wisconsin-La Crosse M | `PROGRAMME_STATUS_QUESTION` | `CONFIRM_PROGRAMME_STATUS` |
| Wisconsin-Oshkosh M | `PROGRAMME_STATUS_QUESTION` | `CONFIRM_PROGRAMME_STATUS` |
| Southwest Minnesota State M | `PROGRAMME_STATUS_QUESTION` | `CONFIRM_PROGRAMME_STATUS` |
| Trinity Washington W | `SOURCE_NOT_AVAILABLE` | `RETRY_ACQUISITION` |

The six status questions came back **held, not retry-eligible** —
`CONFIRM_PROGRAMME_STATUS` waits for a person, which is the whole point of
separating a condition from an action. Only Trinity's review authorised an
attempt, and only Trinity was attempted.

Writing them changed `roster_gap_reviews` and nothing else: `colleges`,
`colleges.active`, `roster_players`, `athletics_domains`, `_targets.csv` and
`_state/state2026.json` were all byte-identical afterwards.

**Left unreviewed, as instructed:** New Jersey City W, Bryn Athyn M, Bryn Athyn W.

## 2. Trinity, reproduced before anything was changed

`https://athletics.trinitydc.edu/soccer-roster-2026` — 200, titled *"Soccer
Roster 2026 – Trinity Tigers Athletics"*, heading **"Soccer Roster / Fall
2026"**.

**L7M said twelve players. There are fifteen, and thirteen are usable.** L7M's
naive read missed `Na'Kiya Butler` on a typographic apostrophe and two more
below its cut. The page carries **17 entries**: 15 named players and **two
literal `"Player Name"` placeholders** the page builder left unfilled, with
their cells reading `Position`, `Class`, `Hometown`. Two real players carry the
author's own unknown-markers — `Position ?`, `Class ?`, `Hometown ?`.

A trap worth naming: `https://athletics.trinitydc.edu/soccer-roster` — the same
URL without the year — answers 200 with **"Soccer Roster 2025"**. The year-less
form is a stale season, not a shortcut.

## 3. The host

**Absent from `athletics_domains` entirely.** Added as one row, under review:

| | |
|---|---|
| domain | `athletics.trinitydc.edu` |
| unitid | 131876 · role `ATHLETICS_SITE` · status `VERIFIED` |
| identity | `EXACT` / `WHOLE_NAME` · confidence `CORROBORATED` |
| method | `OFFICIAL_DIRECTORY_AND_PAGE_SELF_IDENTIFICATION` · kind `CURATED_CORRECTION` |
| platform | `WPBAKERY` |

Two independent first-party signals. **Structural:** it is a subdomain of the
institution's own registered domain. **Self-identification:** the site titles
itself "Trinity Tigers Athletics" and its own copy reads *"Welcome to Trinity
Tigers Athletics. Trinity Washington University offers student-athletes the
opportunity to compete at the NCAA Division III level"* — naming the institution
exactly as the registry does, and the division with it.

**Why discovery missed it, recorded in the row's notes:** `trinitydc.edu` returns
**403 to every request**, including a plain Chrome user agent. A crawler
reasoning outward from the institution never reaches the subdomain. That is a
general lesson for future discovery, not a Trinity quirk.

No other institution was crawled or backfilled. `athletics_domains` 2,722 → 2,723.

## 4. The URL family, and how thin its evidence is

**9,704 of the 9,760 roster URLs this pipeline has ever fetched sit under
`/sports/<slug>/…roster…`.** The remaining 56 are Bradley's
`roster.aspx?rp_id=` and one Wayback URL. **Zero** use a `<sport>-roster-<year>`
shape. Trinity's family has no corpus precedent at all.

What it does have is first-party sibling evidence: its own team pages link
`/soccer-roster-2026`, `/basketball-roster-2026`, `/tennis-roster-2026` and
`/volleyball-roster-2026` — four sports, one deterministic form. That is the
whole evidence base, and the shape records it honestly as `observed: 0`.

**So the shape is `exclusive`.** An ordinary shape is generated for every host
and merely *ordered* by platform; this one is generated **only** for a host the
ledger records as `WPBAKERY`. The guarantee that this costs nothing is
structural rather than statistical: **no other host reaches the line.**

```
{ id: 'CMS_SPORT_ROSTER_YEAR', path: '/<SLUG>-roster-<YEAR>',
  observed: 0, providers: ['WPBAKERY'], exclusive: true }
```

There is no institution name anywhere in it — a test asserts that `SHAPES` and
`SLUGS` contain no "trinity".

### The bare `soccer` slug, readmitted under the condition that made it unsafe

Trinity's path uses `soccer`, the one slug the catalogue deliberately refuses:
asking a school that fields both programmes for "the soccer roster" gives no way
to know which answered, and a discovery target has no prior squad for the
turnover gate to catch a wrong-gender page with.

**That risk is a property of the institution, not the slug.** Where the registry
says a school fields exactly one soccer programme, `soccer` is unambiguous by
construction. **314 of the 1,029** NCAA institutions with soccer are in that
position — 297 women's-only, 17 men's-only — and Trinity, a women's college, is
one of them. The slug is offered only under that condition, and only to an
`exclusive` shape; the eight `/sports/` shapes never see it.

**This is also what proves the gender.** Trinity's page says "Soccer", not
"Women's Soccer". The programme's gender is established by the registry fact
that the institution fields one soccer programme — which is precisely the
condition under which the slug was readmitted, not an assumption laid on top.

### Simulation across the trusted NCAA universe

| | |
|---|---:|
| programmes with an identical candidate list | **1,760 of 1,761** |
| gaining candidates | **1** (Trinity, 24 → 28) |
| losing candidates | **0** |
| known 2026 sources reproduced, before → after | **1,283 → 1,283** |
| reproduced within the bound of 16 | **1,270 → 1,270** |
| known-good URLs that regressed | **0** |

## 5. Two normalisers that assumed a year is a path segment

Both surfaced during the run and both are general, not Trinity-shaped.

`build_targets.py::swap()` and `variants.py::ladder()` each look for a season as
its own path segment (`/2026/`), which is how all eight `/sports/` shapes carry
it. A page named `/soccer-roster-2026` states its season *inside* the segment,
so both fell through to "append a season" and produced
`/soccer-roster-2026/2026`.

The first run acquired the roster anyway, because WordPress redirects that back
to the real page — and recorded the redirect artefact as provenance. **That is
the defect worth catching**: a recorded `source_roster_url` must be the page that
served the roster, not a URL that happens to redirect to it. Both normalisers now
recognise a year that ends the final segment, Trinity's state was cleared, and
the programme was re-acquired so its provenance is the canonical URL.

## 6. The parser

`parse_any` returned `none` on the page, correctly — no parser had a shape for
it. The new one, `parse_list_roster`, is narrow because the danger is obvious:
"a heading followed by short strings" also describes a staff directory, a news
index and most footers.

**The page must prove itself first:** it must call itself a roster, in its title
or an early heading, and it must name a season. **Then each entry must prove
itself:** a player's name is an `<h3>`, and its fields are the `<h4>` headings
between it and the next `<h3>`. A heading with fewer than two fields under it is
a section title, not a player. That is a structural claim about the document,
not a CSS class one author happened to choose.

Refusals that matter, all tested: the two `"Player Name"` placeholders, a
navigation list, a staff list, a schedule, an empty styled list, a page with no
season, a page that never says "roster", and a heading carrying a digit. The
site's own `Position ?` markers become empty fields rather than a position
called "?". **Nationality is not inferred** — the parser reads a hometown and
stops, leaving `geo()` to do what it already does everywhere else.

**Thirteen of fifteen players are imported.** The two omitted are the ones whose
every field is the author's unknown-marker, so they carry no evidence that they
are players rather than headings. Admitting them would mean admitting any
heading — the conservative end of a contract that exists to keep staff lists out.

## 7. The acquisition

```
key     Trinity Washington University||womens-soccer   digest 379707cbdd4a9341
TO ATTEMPT 1 · other NCAA 0 · non-NCAA 0 · 230 excluded by scope
```

Snapshot by `VACUUM INTO`, integrity `ok` both sides, 277,397 rows each.

Resolved at the **variants** stage, parser `list`, **13 players**, winning URL
`https://athletics.trinitydc.edu/soccer-roster-2026` — **generated candidate #4**
(`CMS_SPORT_ROSTER_YEAR` / slug `soccer`). No manual URL was inserted anywhere.

Every gate ran. The turnover gate re-measured all 1,910 done rosters and demoted
none; Trinity is among the 25 with no 2025 baseline to compare, which is expected
for a first acquisition.

**Output safety:** one sheet written, `ncaa_d3_womens_soccer_2026_rosters.csv`.
USCAA ×2, NAIA ×2 and the other five NCAA sheets **byte-identical by SHA-256**.

**Import:** 1 programme, **+13 rows**, 0 changed, 0 removed. `roster_players`
277,397 → **277,410**.

## 8. Coverage, and what a review does when its programme resolves

| | before → after |
|---|---|
| registry rows | 1,761, unchanged |
| duplicate rows | 7, unchanged |
| legitimate universe | **1,754, unchanged** |
| rostered | 1,744 → **1,745** |
| active gaps | 10 → **9** |
| reviewed / unreviewed gaps | — → **6 / 3** |

The denominator did **not** move. Six programmes now carry a status question,
and a question is not a decision: retiring a registry row is a separate act by
whoever owns the registry, and nothing here touched `colleges.active` (still 3
inactive).

**Trinity's review survived its programme leaving the queue.** All seven rows
remain in `roster_gap_reviews`; Trinity simply stops being an active gap because
it now holds a roster. That is L7K's contract behaving as designed, with no
redesign needed — the review is durable, the queue is derived.

## 9. Evidence

Measured pair-by-pair against the pre-L7N snapshot under `projectBehavioural`:
**1 of 4,742 pairs moved**, and it is the QA fixture athlete against Trinity. No
real athlete-programme pairing changed.

| | |
|---|---|
| pairs affected | **1** |
| generic → personalised | **0** |
| supplemented | **1** — `POSITION_GROUP_SIZE` and `RETURNING_POSITION_DEPTH`, `all` 0 → 2 |
| rendered kinds / sentences | unchanged (none either side) |
| held / deduped | 221 → 221 |

Both new facts carry `OUTREACH: DENIED`. The composed paragraph is byte-identical,
so **0 emails new or changed — GOOD 0, ACCEPTABLE 0, WEAK 0, BAD 0**, and the
unchanged `EMAIL_BODY` digest is independent proof rather than a claim.

**Baselines.** Manifest `194fcf38877e6686` → `e7860685c33c1aea`, **UNCOMPARABLE**
(`roster_players` and `athletics_domains` both moved). Predicted before repinning
and confirmed after: a stage that adds a squad must move the roster-derived
surfaces — `OUTBOUND_DECISION`, `OPERATOR_WIRE`, `LOG_PAYLOAD`,
`OPERATOR_EVIDENCE` — and must not move the composed email;
`COACH_COMPOSITION` and `EMAIL_BODY` are digest-**identical**. All six repinned.
**P6 unchanged.**

## 10. Remaining NCAA tail

Nine active gaps: **six carrying a status question** (Anna Maria ×2, New Jersey
City M, Wisconsin-La Crosse M, Wisconsin-Oshkosh M, Southwest Minnesota State M)
awaiting a registry decision, and **three unreviewed** (New Jersey City W, Bryn
Athyn M, Bryn Athyn W).

## 11. Debt

**The advisory readiness verifier still assumes `/sports/`.** `classifyReadiness`
requires the landing path to contain `/sports/<slug>/`, so it would refuse the
very page the pipeline just acquired. It was not on the acquisition path and was
not changed here, but the two now disagree and the verifier is the one that is
wrong.

**`geo()` defaults an unrecognised hometown to `('USA', '')`.** Pre-existing and
pipeline-wide — `Qwertyville` resolves to USA. It is correct for all thirteen
Trinity rows, whose hometowns are US, but it is an inference the system makes
silently across 277,410 rows and it deserves its own measurement some day.

**`build_targets.py` drops a candidate when a programme acquires.** Northwood's
candidate column emptied this run because an acquired programme leaves
`_registry_candidates.csv`. Its `Status` and `Notes` are intact, so nothing
operational was lost, but the column now reads as though no candidate was ever
generated.
