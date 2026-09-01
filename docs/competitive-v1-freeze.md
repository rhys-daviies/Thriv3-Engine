# Competitive Intelligence V1 — the freeze

*Phase 12E. What V1 knows, where it stops, what Phase 12F may render, and what
no later phase may quietly change.*

---

## 1. The coverage ceiling

| | 12C | 12D | **12E** |
| --- | --: | --: | --: |
| readable programme-seasons with a historical division | 19.5% | 68.6% | **83.7%** |
| programmes with all four seasons | — | 59.2% | **77.4%** |
| programmes with at least one season | — | 74.9% | **86.7%** |
| benchmark pools populated | 0 of 32 | 32 of 32 | **32 of 32** |
| smallest pool | — | 86 | **126** |

**6,852 of 8,191** readable programme-seasons carry a historical division. The
target for this phase was 85% and the evidence supports 83.7%; the shortfall is
reported rather than closed, because closing it would mean accepting a source
that cannot be checked.

By sport and division, programmes with all four seasons:

| sport | division | programmes | 4/4 | ≥1 |
| --- | --- | --: | --: | --: |
| men's | NCAA D1 | 213 | 176 | 204 |
| men's | NCAA D2 | 205 | 167 | 176 |
| men's | NCAA D3 | 318 | 265 | 298 |
| men's | NAIA | 194 | 119 | 145 |
| women's | NCAA D1 | 349 | 276 | 307 |
| women's | NCAA D2 | 260 | 214 | 219 |
| women's | NCAA D3 | 418 | 323 | 366 |
| women's | NAIA | 198 | 127 | 155 |

**NAIA is the weak segment and the cause is the sources, not the identity work.**
61% and 64% of NAIA programmes have all four seasons against 83–90% across the
NCAA divisions. Five NAIA conferences publish no readable standings on any of the
three routes; two of them — the Golden State Athletic Conference and the
Continental — are lifecycle cases rather than parsing failures. The NAIA also
publishes no equivalent of the NCAA's member directory, so the association-level
fallback that fixed the NCAA inventory has no NAIA counterpart.

---

## 2. The conference inventory is no longer circular

12D seeded its inventory from the conference strings already in `colleges`. That
made coverage self-limiting in two ways, and the second did most of the damage:
a conference our data never names was never looked for, **and a conference our
data names for only one sport was only looked for in that sport**. The
Mid-American is in the 12D inventory for women's soccer alone, which is why
Akron men's 2022 was missing.

The universe now comes from the associations:

- **the NCAA member directory** (`web3.ncaa.org/directory/api/directory/memberList?type=3`) — 145 conferences, each with its division and its official website;
- **the NAIA's own 2026-27 conference school listing** — 20 of the 21 NAIA conferences we hold, confirming the set.

**123 conferences · 246 conference-sports**, against 121 · 222. Both sports are
attempted for every conference and **sponsorship is discovered** rather than
assumed. 42 single-sport conferences are excluded because their own names state a
sport that is not soccer.

**The directory's `academicYear` parameter is accepted and silently ignored** —
it returns 2027 whatever is asked — and the conference it lists is a school's
primary conference, not its soccer one. So it establishes the universe and
breaks identity ties, and it is never historical membership.

---

## 3. The accepted membership provenance

All five are official. The order is about how specific the evidence is to the
fact being claimed, not about which collector produced it.

| provenance | what it is |
| --- | --- |
| `OFFICIAL_CONFERENCE_STANDINGS` | the conference's own table for that season |
| `OFFICIAL_PROGRAMME_SOURCE` | the programme's own season page |
| `OFFICIAL_CONFERENCE_MEMBERSHIP` | a conference's own member directory |
| `OFFICIAL_NCAA_MEMBERSHIP` | the NCAA member directory |
| `OFFICIAL_NAIA_MEMBERSHIP` | the NAIA conference school listing |

Research evidence is not in the set. Wikipedia found the conference hosts and a
candidate division; neither is a membership provenance and neither may become
production truth on its own.

**Phase 12C's programme-side evidence sits inside the order rather than beneath
it.** The Pac-12's site no longer publishes its pre-collapse tables and
`calbears.com` does publish California's own 2022 season; refusing that because
it came from the other collector would privilege ownership over truth.

### When two accepted sources disagree

Nothing is chosen. `CONFLICTING_OFFICIAL_SOURCES` is returned with both
provenance records, and the default is refusal because the alternative is a rule
that decides which official body was wrong.

**One case resolves automatically, and it is not recency.** Where two conference
tables disagree — usually because two of them printed the same short name for
two different institutions — and the **programme's own season page** names one of
them, that claim wins. The institution has stated which competition it played in
and no third party is better placed to say. A newer source never beats an older
one: a 2026 directory is not a better witness to 2022 than a 2022 standings
table.

Two conflicts remain unresolved in the whole universe, both Gonzaga men's — the
parser-residue season 12C had already flagged.

---

## 4. Membership truth and conference-record truth are separate

A report may know **"Big East, NCAA Division I"** without knowing **"5-2-1 in
conference"**, and the two are never collapsed.

| class | count |
| --- | --: |
| `MEMBERSHIP_KNOWN_RECORD_KNOWN` | 7,098 |
| `MEMBERSHIP_KNOWN_RECORD_UNKNOWN` | 44 |
| `MEMBERSHIP_UNKNOWN` | the rest of the window |

Requiring a record before believing a membership would throw the membership
away — a conference member directory has no records in it at all — so it is
never required.

---

## 5. Historical division

Unchanged in method from 12D and unchanged in the one rule that matters:
**never the current division, and no fallback.** 121 rows carry a historical
division that differs from `colleges.division`, and a whole-universe invariant
asserts that the column is not a copy.

A conference's division is established from two independent sources that must
agree — a reference statement and the divisions of the members the conference's
own table published. A statement is contradicted only when **no** member
supports it, because a majority test refuses a conference for moves its members
made two seasons later.

**Season-aware division was audited and is not needed.** No conference in the
window changes association or division; every one of the 821 collected
conference-seasons resolves to a single division, and 0 are `CONFLICTING`. The
column is stored per conference-season anyway, so a future change is
representable without a migration.

---

## 6. Identity

- **1,229 institutions, keyed on IPEDS UNITID.** 2,350 aliases, 0 collisions.
- **450 `ATHLETICS_NAME` aliases** harvested from verified domains' own pages, gated on the audit's verdicts.
- **35 `CONFERENCE_DISPLAY_NAME` aliases** forced by set difference against the NCAA member directory, each with a name test (prefix, initialism, or every distinctive word) and each unambiguous. **11 bare names several institutions share — "Carroll", "Union", "Emmanuel", "Eastern", "Thomas", "Dallas", "North Central", "York", "Trinity" — were forced the same way and refused**: writing one down would defeat the ambiguity refusal that protects it.
- **A tail grammar removes table notation.** `Bloomsburg * (4)`, `Loras No. 23 | C | (1)`, `Cal Poly Pomona - y, z, $, ^`, `Grand Valley State 2x`, `Keene State 6`, `High Point (2.00)`, `Hanover #2 Seed`. Roughly 400 member rows were unresolvable for want of it, and an alias per decorated spelling would have put 150 rows in the alias table that are not names.
- **Two conference-scoped tie-breaks**, used only to separate institutions that share a spelling: the programme's own conference string, then the association's own membership record. Neither is used to assign a season.
- **A conference's own roster overrules a rewriting.** The Centennial prints "Washington College #1 seed"; strip the notation and the institution type and "Washington" is left, which is a whole written-down name belonging to a third university — and a Division I programme had acquired a Division III season. Where the conference's official membership names a *different* institution by the printed name, the rewriting is refused. 21 rows. It never questions an exact name, so Mercyhurst, Akron, West Georgia and Roosevelt are unaffected, and it is inert for NAIA conferences, which have no NCAA roster.
- **Shortening is asymmetric.** Our names may be shortened for the index; a source's name never is. Doing it turned the Peach Belt's "USC Aiken" into "USC" and gave the University of Southern California two Division II seasons.
- **The bare campus token is not generated.** "University of Missouri, Columbia" reduced that way resolved to Columbia College, Missouri — a different institution in the same city, which the state qualifier then confirmed instead of vetoing.

### The domain queue, worked

60 wrong-institution mappings, reviewed against the NCAA's own record of each
institution's athletics site:

| verdict | n |
| --- | --: |
| `CONFIRMED_WRONG` (replacement named by the NCAA directory) | 21 |
| `AMBIGUOUS` (no official record either way) | 22 |
| `OTHER` (claimant outside the report universe) | 15 |
| `FALSE_POSITIVE` (the directory names this very domain) | 2 |

**Only 15 were corrected**, and only because the replacement host's own page
confirmed it. Six replacements failed that check — two hosts refused the
connection and four name themselves in a way the resolver cannot confirm — and
stay in the queue. `known_domains.json` is not edited: it is a scrape artefact
and rewriting it would put the proof where no test reads it.

---

## 7. The V1 client information contract

| field | verdict |
| --- | --- |
| four-season overall W-L-D | **RENDER** |
| NCAA winning percentage | **RENDER** |
| historical division | **RENDER** |
| historical conference | **RENDER** |
| conference W-L-D | **RENDER_WITH_COVERAGE_GATE** — only where the record is known, with the conference named beside it, never compared across conferences |
| sport × division × season benchmark | **RENDER_WITH_COVERAGE_GATE** — only with an established division and a pool above the minimum, with the pool size in the same sentence |
| structural conference change | **RENDER** |
| structural division change | **RENDER** |
| coach-attributed season count | **RENDER_WITH_COVERAGE_GATE** — a count and its denominator only |
| coverage and refusal state | **RENDER** |
| membership provenance, conference size, table row, seed | **INTERNAL_ONLY** |
| conference finish, postseason depth, schedule strength, opponent strength, goals | **DEFER** |

### The frozen non-claims

No competitive score. No good/bad or strong/weak label. No rising or falling. No
improving or declining badge. No prediction. No causal coach attribution. No
schedule-strength claim. No opponent-strength claim. No stronger/similar/weaker
opponent analysis. No comparison of one conference's quality with another's. No
conference finish. No postseason depth. No current rating used as history. No
implication that moving division is an improvement or a decline.

### Reader language

Allowed: *"The programme recorded a .684 NCAA winning percentage in 2025."*
*"That rate sat in the upper quarter of the 194 NCAA Division I men's programmes
measured that season."* *"The programme competed in the PSAC in 2023 and the NEC
in 2024."* *"The programme moved from NCAA Division II to NCAA Division I in
2024."*

Refused, and checked by a test over **14,000 sentences across 2,125
programmes**: elite, weak, strong, dominant, rising, falling, improved, got
worse, tough, easy, successful, struggling, promoted, relegated, powerhouse,
better, worse. Inflection-bounded, so Strongsville and Risen are unaffected.

### Coverage language

Missing evidence must not sound like negative evidence.

> "Historical conference membership could not be established for 2022."
> "Competitive benchmark unavailable for 2022 because the division the programme played in that season could not be established."
> "Conference record for 2023 is not available from the verified source for the Big East Conference."
> "Conference membership is established for three of the four seasons measured."

### Coach integration

Allowed: the count of measured competitive seasons attributed to the current
coach with its denominator, which seasons those are, and the aggregate record
across them carrying the seasons it covers.

Refused: any before/after split around a coach's arrival, any statement that a
coach improved or damaged the programme, any comparison of one coach's seasons
with another's, any per-coach rate presented as the coach's rather than as those
seasons'. Four seasons cannot separate a coach from a recruiting class, a
conference move, a schedule, or chance. **0 of the 14,000 sentences the universe
produces mention a coach at all.**

---

## 8. The data package

`shared/report/competitivePackage.js`. Phase 12F renders from this and nothing
else: no geometry, no font, no column width. The field contract ships inside
every package, so a page can be checked against what it is allowed to draw
rather than against what happens to be in the object.

A sparse programme gets a **shorter** package, never an invented one. Every
aggregate carries the seasons it covers, no gap is interpolated, and a structural
fact is narrowed to the seasons the record side established — a change observed
at 2025 from a 2022 season says so, rather than naming a 2024 that is not on
file.

---

## 9. Frozen

Institution identity · conference identity · historical membership · historical
division · conference record · benchmark methodology · `MIN_POOL = 30` ·
structural movement semantics · coach integration · reader language · refusal
semantics · the V1 data package.

Any later change to these is an analytical change, not a refactor.

---

## 10. Known gaps and the research backlog

1. **16.3% of readable programme-seasons have no established division.**
2. **NAIA at 61%/64% complete**, and no association-level membership fallback exists for it.
3. **Twenty-nine conference-sports yielded nothing.** Twelve are genuine losses; the rest are conferences that do not sponsor the sport, or that dissolved before the window.
4. **Six proven-wrong domains have no confirmable replacement.**
5. **674 member rows print a name no programme claims**; 116 print a name two claim, 23 name a state that contradicts the match, and 21 are contradicted by their conference's own roster.
6. **One identity error survives and its cause is a spine gap.** The Wolverine-Hoosier's "Rochester" is Rochester Christian University, which we do not hold, so it resolves to the University of Rochester and shows a 2023 NAIA season. The roster guard is inert here because the NAIA publishes no member directory for the guard to read.
7. **The Middle Atlantic Conference publishes one table for both its divisions.**
8. **Conference finish, postseason depth, goals, schedule strength and opponent strength remain deferred**, unchanged since 12A and 12C.
9. **Two official-source conflicts remain unresolved** (Gonzaga men's 2023 and 2025).
