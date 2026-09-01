# Competitive identity and structural history

*Phase 12D. What this layer knows, how it came to know it, and what it refuses.*

Phase 12C proved that Thriv3 can collect external competitive data. It also
proved that collecting it correctly is not the hard part. It fetched four
seasons of well-formed, correctly parsed athletics data from
`gocolumbialions.com` and filed them under **Columbia College, Missouri**. The
site belongs to **Columbia University, New York**. It did the same with
`maryvillesaints.com` for Maryville College, Tennessee — the site is Maryville
University, Missouri. Every request returned 200. Every parse succeeded.

That is what 12D is about. Before any competitive collection runs at scale, the
product needs to be able to say *which institution this is* and *which
competition it was playing in*, and to say so from evidence rather than from a
mapping file.

---

## 1. Institution identity

**The canonical institution is an IPEDS UNITID.** Not a name.

Names are the problem. `colleges.name` spells the same school two ways across
the two sports for 378 of the 896 institutions that field both — "Amherst" for
men and "Amherst College" for women. And "Columbia", "Bethel", "Maryville",
"Miami", "Concordia", "Trinity", "Westminster" and "Wilmington" each name
several different colleges. UNITID is assigned by the U.S. Department of
Education, one per institution, and is on 2,145 of the 2,155 rows in the report
universe. Under it, Columbia University is 190150 and Columbia College (MO) is
177065, and no normaliser, similarity score or state heuristic is needed to keep
them apart.

The 10 rows with no UNITID have no institution identity and are refused.

### `institution_aliases`

One row per spelling, `alias_key` (the normalised spelling) as the primary key —
so a spelling cannot name two institutions. 1,874 rows: every `colleges.name` in
both sports, plus a short curated file of 18 entries (`shared/institutionAliasData.js`) holding
what our own table does not say.

`alias_type` is one of `CURRENT_NAME`, `HISTORICAL_NAME`, `OFFICIAL_ABBREVIATION`,
`ATHLETICS_NAME`, `MERGER_NAME`, `RENAMED_INSTITUTION`, `CONFERENCE_DISPLAY_NAME`.
Every row carries a `source` that the claim can be re-checked against.

**An alias claimed by two institutions is refused, not resolved.** Letting the
second write win is how a spelling changes meaning between two runs of the same
importer. The importer reports the collision and writes neither.

### Resolution: a closed ladder, and no similarity anywhere

`resolve(raw)` looks up an exact normalised string in a table of written-down
aliases. `institutionVariants` generates a small **closed** set of rewritings —
"the" removed, a trailing "Athletics" removed, "University of X" as "X",
"Framingham St." as "Framingham State", "UW-Whitewater" as "Wisconsin-Whitewater"
— and each is looked up exactly. That is a finite enumeration of spellings, not a
similarity measure: it cannot return a near-miss, so it cannot return Central
Arkansas for Kansas.

Three rules carry the correctness:

1. **A written-down name always outranks a generated one.** `byKey` holds names
   somebody wrote; `byVariant` holds rewritings this module produced. "USC
   Aiken" generates "USC", which is a whole institution in its own right; in one
   map they would collide and the real USC would be refused as ambiguous.

2. **Shortening is asymmetric.** Our own names may be shortened for the index —
   a conference prints "Truman" and our table says "Truman State". A source's
   name is never shortened: doing it turned the Peach Belt's "USC Aiken" into
   "USC" and gave the University of Southern California two Division II seasons,
   and "San Diego Christian" into "San Diego".

3. **A state the source wrote is a veto, not a tiebreak.** "Embry-Riddle
   Aeronautical University (AZ)" matches exactly one row in a table holding only
   the Florida one, and the source has said it does not mean that one. The same
   rule is what stops "California (Pa.)" — PennWest California, Division II —
   being filed under the University of California.

**Known limit.** Our table calls Columbia University "Columbia" and states no
institution type, so an *unqualified* "Columbia College" resolves to the
university. Every source seen in 12D writes the state on this family, and
`resolveProgramme` refuses a match whose state contradicts the source, but the
unqualified string is not separable from what we hold. It is asserted as the
known limit in `shared/institutionIdentity.test.js` rather than left implicit.

### Programme identity is not institution identity

UNITID identifies an **institution**. PennWest California, PennWest Clarion and
PennWest Edinboro share UNITID 498571 — one institution created by the 2022
Pennsylvania Western merger — and field **three separate soccer programmes**.
Commonwealth University-Bloomsburg, -Lock Haven and -Mansfield are the same
shape. So `resolveProgramme(raw, sport)` tries the sport's own names first,
where `colleges` has a unique index on `(name, sport)` and an exact hit cannot be
wrong, and only then goes through the institution — and where one institution
fields several programmes in one sport, the printed name decides between them or
nothing does.

### Identity events

- **Mergers.** Pennsylvania Western (California, Clarion, Edinboro, 2022) and
  Commonwealth University (Bloomsburg, Lock Haven, Mansfield, 2022) are one
  UNITID each with several programmes. The pre-merger names are `HISTORICAL_NAME`
  aliases, because every 2022 conference table prints them.
- **Renames.** Blue Mountain College became Blue Mountain Christian University in
  2022. Without the historical alias, `bmcusports.com` — which still calls itself
  Blue Mountain College — resolved to Blue Mountain **Community** College,
  Oregon: a different institution, state and association.
- **Combined programmes.** Claremont-Mudd-Scripps is one athletics programme
  fielded by three institutions and Pomona-Pitzer by two. Four names claim
  `cmsathletics.org` and every one of those claims is correct.
  `COMBINED_PROGRAMME_DOMAINS` records them so the audit does not report the
  constituent colleges as wrong mappings.
- **Discontinued programmes.** Limestone's programme ended inside the window. Its
  2022 and 2023 conference rows are real history and are kept in
  `conference_membership_quarantine`; they are never forced onto a current
  programme identity that no longer exists.

---

## 2. Athletics domain verification

**A domain is a lead. What makes it an identity is what the host says it is.**

`athletics_domains` holds one row per distinct domain in
`tools/soccer/verification/known_domains.json` — 2,714 of them — with the
institution the **host itself** names, and the claims that host contradicts.
1,701 resolve to an institution, 56 contradict a claim made about them, 16 are
ambiguous, 229 did not answer, and 712 answered and named nothing resolvable.
By mapping rather than by domain: 813 `VERIFIED`, 1,345 `VERIFIED_ALIAS`, 1,061
`INSUFFICIENT_EVIDENCE`, 256 `UNREACHABLE`, 60 `WRONG_INSTITUTION`, 24
`AMBIGUOUS`.

### The method, and why it is the cheapest reliable one

One HTTPS GET per host, with the response stream stopped at `</head>` or 128 KB.
Identity is read from `og:site_name`, the `<title>` and the URL the request
finally landed on, because those are the only things in the transaction the
mapping file did not write. 2,714 domains, 2,571 requests, 76.9 MB.

### A mapping is the unit, not a domain

`known_domains.json` lists `gomatadors.com` under Cal State Northridge **and**
under Concordia Irvine. One of those is right. A per-domain verdict cannot say
which, so all 3,559 `(name, domain)` pairs are classified separately.

### Refuting takes more evidence than confirming

Confirming a claim is safe on a weak match, because the claimant's own name is
what generated the spelling being matched. Refuting one requires all three of:

- an **ATHLETICS** site — a university homepage titled with a system brand
  ("Purdue University" on `pnw.edu`, "Rutgers University" on `rutgers.edu`)
  cannot speak for a campus;
- the **og:site_name or the whole title**, never a fragment — splitting
  "University of Missouri - St. Louis Athletics" on its separator produces
  "University of Missouri", which is a different institution;
- a **whole written-down name**, never a shared bare base — "Queens College" is
  Queens College CUNY, and refuting on it would have "corrected" a correct
  mapping towards Queens University of Charlotte.

### Nothing here rewrites `known_domains.json`

A `WRONG_INSTITUTION` verdict makes a mapping unusable, which is safe whether the
verdict is right or wrong. Proving a replacement is separate work and is not done
by a script.

**The 60 wrong mappings are a review queue, and they contain false positives of a
known shape.** Where a claimant's name is a longer form of what the host prints —
"Northwestern (MN)" against a host calling itself "University of Northwestern" —
the host's own words cannot separate the two, and neither can the state, because
both differ from the institution our table reaches. The verdict is conservative
in effect (the mapping becomes unusable either way) and must not be conservative
in reporting: it is a list for a person to work through, not an instruction.

Where the host's text is one the claimant could equally be called — Columbia
College, Missouri's own site says "Columbia College", which our table reads as
Columbia University — the verdict is `AMBIGUOUS` rather than
`WRONG_INSTITUTION`. Refuting there would report a correct mapping as wrong,
which is 12C's error in the other direction.

---

## 3. The identity corroboration contract

For any future competitive collection, a fetched programme page is accepted only
when at least one of these holds, and nothing conflicts:

| Evidence | What it means |
| --- | --- |
| `EXPLICIT_PAGE_INSTITUTION` | the page names the institution |
| `VERIFIED_DOMAIN_IDENTITY` | this host was audited and resolves to it |
| `VERIFIED_ALIAS` | the page names a written-down alias of it |
| `CONFERENCE_MEMBERSHIP_CORROBORATION` | its conference's own table lists it |

`DOMAIN_ONLY` is named in the enum **so that it can be refused**. It is what
produced eight wrong programme-seasons in 12C, and it is never sufficient.

A conflict is decisive on its own: if the page names an institution and it is not
the one expected, no quantity of other evidence rescues it.

---

## 4. Conference identity

`shared/conferenceIdentity.js` holds 122 canonical conferences with every
spelling that resolves to them. It resolves 99.3% of the conference strings in
`colleges` and holds **no division**: a conference's division is evidence to be
collected, not a property of its name.

**No fuzzy matching.** 12B.1 had a normaliser that stripped the word
"association", merging the Southern Conference (Division I) with the Southern
Athletic Association (Division III) — and since a conference is what a season's
division is derived from, that single merge would have benchmarked D1 programmes
against D3 pools. Every alias is written down; a spelling that is not written
down is refused.

**Sport and division are part of the key where the spelling demands it.** `MAC`
is the Mid-American Conference in Division I and the Middle Atlantic Conference
in Division III. There is no correct sport-blind answer, so the bare alias
resolves only inside a scope.

**Lifecycle is recorded, and it is not the same as an alias.**

- `renamedFrom` — one conference, two names. The American Athletic Conference
  became the American Conference; the Colonial Athletic Association became the
  Coastal Athletic Association.
- `mergedInto` — two conferences became a third. The Commonwealth Coast
  Conference and the New England Collegiate Conference both became the Conference
  of New England in 2023, and they were never each other. Each keeps its own id.
- `dissolved` — the Heartland Conference (2019) and the Capital Athletic
  Conference (2020) are still written in `colleges.conference` for programmes
  that have played four seasons somewhere else since. **A dissolved conference is
  never silently forwarded to its successor**: every Heartland programme we hold
  is in the Lone Star Conference now, and mapping the string that way would be
  inferring 2022 membership from a 2019 fact.

---

## 5. Historical membership, and the division derived from it

**Why the conference side.** One fetch of a conference's standings page returns
every member of that conference for that season, with each member's conference
record and the size of the conference. 12C spent 1,088 requests on 100
programmes and reached historical conference for 19.8% of their seasons; the
conference side covers the whole universe in about 1,300.

**The year parameter is a trap.** `standings.aspx?year=2022` is accepted and
silently ignored: it returns the current table. `themw.com` does the same with a
season in the path. So every fetched table is checked against the season asked
for — `season_confirmed` — and the benchmark reads no row where that is 0.

### Collection and truth are separated

The collector writes an artefact — `conference-standings.json`, outside this
repository — holding what each conference **published**: the member rows exactly
as printed, the URL, the platform, and whether the page's own title confirmed the
season and the sport. It resolves nothing and decides nothing.

Identity resolution, record parsing, division derivation and quarantine all
happen in `server/scripts/importConferenceSeasons.js`, which is production code
with tests. Adding one alias re-imports the whole layer in seconds with no
refetch.

### How a conference's division is established

Two independent sources, and they have to agree:

1. a **reference statement** about the conference, or the conference's own page
   where it makes one;
2. the **divisions of the programmes the conference's own table lists as its
   members**.

Across 120 conferences the two agree on 119. The one disagreement was a
reference lookup that had landed on the wrong article.

**Membership is used at the conference level and nowhere else.** Taking a
*programme's* current division as its historical one is the error this whole
layer exists to prevent. Taking a *conference's* division from where its members
sit is a different claim, and it holds because a conference does not change
division — its members change conference.

**A statement is contradicted only when no member supports it.** A stricter test
— the majority must agree — fires on the wrong thing: the Great Southwest
Athletic Conference is NAIA and lost half its 2022 membership to Division II by
2024, so a majority test would refuse the conference for a move its members made
two seasons later. Zero support is a real contradiction.

### What is never a source of division

`colleges.division`, opponents, `soccer_score`, a conference "tier", the current
roster stamp. `historical_division IS NULL` means not established, the benchmark
refuses with a stated reason, and no disclosure would make a substitution
acceptable.

### Conference finish is not here

`conference_table_row` is the row's position **as printed** and is explicitly not
a finish: the PSAC prints East then West, so Mercyhurst — first in the West — is
eighth by row. `seed` is stored only where the conference printed one in its own
notation. Nothing reaches a sentence.

---

## 6. Ownership: `programme_seasons` no longer carries a division

`historical_division` left `programme_seasons` in 12D and is owned by
`programme_conference_seasons`, joined on `(college_id, season)`.

The reason is mechanical rather than aesthetic. `importProgrammeSeasons.js`
rebuilds its table with `DELETE FROM programme_seasons` followed by a full
re-insert, so **any column that importer does not write is silently emptied every
time the win/draw/loss layer is refreshed from its CSVs**. A duplicated division
would have been wiped by a routine records refresh and the benchmark would have
gone quiet with no error raised anywhere.

The join costs 14.6 ms on the whole-universe pool build and 0.7 ms on one
programme. One owner, one writer, one rebuild path.

---

## 7. Refusal semantics

Missing is not zero, and the distinctions are not decoration — "the conference
has no page for that season" and "the page loaded and we could not read it" lead
to different work.

| Status | Meaning |
| --- | --- |
| `SOURCE_NOT_FOUND` | no standings page on this host |
| `SEASON_NOT_AVAILABLE` | the host has no table for that season |
| `SEASON_NOT_CONFIRMED` | a table came back and did not name the season |
| `PARSE_FAILED` | the page loaded and produced no rows |
| `CHALLENGED` | a bot check answered instead of the page |
| `TRANSPORT_FAILED` | no response. **Never** read as an absence. |
| `IDENTITY_UNRESOLVED` | a member name matched no programme |
| `MEMBERSHIP_AMBIGUOUS` | it matched several and none was chosen |
| `STATE_CONFLICT` | the source wrote a state and the match is in another |
| `NO_PROGRAMME_IN_SPORT` | the institution is known and fields no team here |
| `TWO_CONFERENCES_ONE_SEASON` | two conferences claimed the same programme-season |
| `CONFERENCE_UNKNOWN` / `DIVISION_UNKNOWN` / `CONFERENCE_DIVISION_CONFLICT` | nothing establishes it |

A quarantined member row is stored in `conference_membership_quarantine` with its
reason, its source URL and the record as printed. Silently discarding them would
make a conference look smaller than it was and would hide every alias still owed.

---

## 8. Rebuildability

Every importer is idempotent (each replaces its table inside one transaction),
dry-run by default, deterministic, and fails closed on a missing or empty source.
The collector is cache-aware, bounded-concurrency and restartable, and writes its
artefact atomically through a temporary file — a half-written artefact is a
coverage collapse the importer would load without complaint. A re-run against a
warm cache refetches nothing and reproduces the same artefact byte for byte.

```
node server/scripts/collectConferenceStandings.js --write   # ~1,300 requests, annual
node server/scripts/importInstitutionAliases.js --apply     #  30 ms
node server/scripts/verifyAthleticsDomains.js --apply       # 140 ms
node server/scripts/importConferenceSeasons.js --apply      # 176 ms
```

The three importers depend on nothing but the database and two artefact files, so
a fixed alias re-imports the whole layer in under half a second with no refetch.
No manual database edit is required or permitted at any point.

---

## 9. Known limitations

1. **68.6% of readable programme-seasons carry a division** — 5,623 of 8,191,
   against 19.5% at the end of 12C. 1,275 of the 2,155 programmes have all four
   seasons and 1,615 have at least one; the other 540 have none. Every season
   without one is refused a percentile with a stated reason.
2. **The conference inventory was built from our own vocabulary.** A conference
   `colleges.conference` never names was never looked for — the Great Northeast
   Athletic Conference is one, which is why Albertus Magnus has no structural
   history.
3. **Twelve conference-sports could not be collected at all** on any of the three
   routes: the SEC and Big 12 women's, the CUNYAC women's, the Heart of America
   and the Wolverine-Hoosier (both sports), the Continental (both sports), the
   NECC men's, the Frontier men's and the Golden State men's. Their standings sit
   on URL shapes none of the routes matched. A further seven read as uncollected
   because the conference does not sponsor the sport — the NSIC, the MIAA and the
   CIAA have no men's soccer — and two are the conferences that dissolved before
   the window.
4. **The Pac-12's own site no longer publishes its pre-collapse tables**, so
   California men's 2022 and 2023 Pac-12 seasons are established only by 12C's
   programme-side collection and are not in this layer.
5. **The Middle Atlantic Conference publishes one table for its Commonwealth and
   Freedom divisions**, so a MAC member's row names the parent conference and not
   which of the two it played in.
6. **1,450 member rows print a name no programme claims**, 361 print a name two
   claim, 175 name an institution that fields no team in that sport, 148 are
   claimed by two conferences at once, 42 print a record that contradicts its own
   matches played, and 11 name a state that contradicts the match. All 2,187 are
   quarantined with their reason and their source URL rather than guessed.
7. **`known_domains.json` is not rewritten.** 56 domains contradict at least one
   claim — 60 mappings in all; the claims are unusable and the file still holds
   them. The list is a review queue and contains false positives of the shape
   described in §2.
8. **Conference finish and postseason depth remain research-only**, unchanged
   from 12C.

---

## Update — Phase 12E

The conference inventory no longer comes from our own vocabulary. It comes from
the NCAA member directory and the NAIA's own conference school listing, both
sports are attempted for every conference, and sponsorship is discovered rather
than assumed. Historical-division coverage went from 68.6% to **83.8%**, and the
two conferences 12D could not see — the Great Northeast Athletic Conference and
the Mid-American's men's soccer league — are both collected.

Also new: a membership provenance hierarchy of five official sources, a
cross-source conflict contract that refuses by default, the separation of
membership truth from conference-record truth, and 15 domain corrections proved
against both the NCAA's own record and the replacement host's own page.

The layer is frozen. See `docs/competitive-v1-freeze.md`.
