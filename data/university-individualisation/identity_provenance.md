# Visual identity — how it was populated and what was verified

Covers the `nickname`, `nickname_plural`, `mascot`, `primary_color`, `secondary_color` and
`logo_url` columns in both CSVs. Written for the question "can we send from this?".

## Coverage

| | Nickname | Mascot | Colours | Logo |
|---|---|---|---|---|
| Men's (1170) | 88.0% | 65.3% | 57.1% | 70.8% |
| Women's (1271) | **92.5%** | 71.3% | 62.9% | 82.1% |

Women's identity was at 32% / 26.8% / 21.3% / 30.1% before this pass.

## Source

`server/scripts/populateSchoolIdentity.js` reads each school's Wikipedia
`{{Infobox university}}`. It is sport-agnostic — it fills any row missing a nickname — so
one lookup per school name serves both sports, which is correct: nickname, mascot, colours
and logo are properties of the **institution**, not of one of its teams.

Every row records where its value came from in `identity_source`.

## Nickname resolution — why the raw infobox value is not emailable

The infobox lists *every* name a school's teams use, and preserving all of them is right for
a database and wrong for an email. Penn State arrives as
`"Nittany Lions / Lady Lions / Behrend Lions / Roaring Lions / Lions"`. Some rows also
arrived carrying raw `<br/>` markup, an unbalanced bracket (`"Wolves ("`), a superseded name
(`"Pride (introduced in 2006), formerly the Pioneers"`), or the school's own name in front of
the nickname (`"Howard Bison"`).

`server/scripts/resolveNicknamePerSport.js` picks one value per row and records why.
142 rows were rewritten; **0 were left unresolved**; 0 multi-valued strings remain.

### The rule that matters

A real subset of schools name their women's teams differently, and two cases look identical
on the surface but resolve oppositely:

| School | Infobox | Women's soccer | Why |
|---|---|---|---|
| Liberty | Flames / Lady Flames | **Flames** | "Flames" is neutral; "Lady Flames" is a basketball brand |
| Delta State | Statesmen / Lady Statesmen | **Lady Statesmen** | "Statesmen" is a men's word, so it cannot be the women's team |

The deciding question is whether the *men's* name is itself gendered — not the shape of the
women's one. Getting this backwards put "Lady Lions" on Penn State women's soccer in an
early version. Liberty was checked against `libertyflames.com` rather than assumed.

Splits carried through correctly: Cal Lutheran **Regals**, Oberlin **Yeowomen**, Hobart &
William Smith **Herons**, Illinois College **Lady Blues**, Lubbock Christian **Lady Chaps**,
Hawaii **Rainbow Wāhine**, Montana State Northern **Northern Skylights**.

Three splits no rule could derive — neither value gendered, neither a variant of the other —
were confirmed against Wikipedia's *athletics* article, whose title names both teams,
men's first (`verify_split_names.py`):

- Central Arkansas — Bears / **Sugar Bears** (title and lead sentence agree)
- Kentucky State — Thorobreds / **Thorobrettes** (title)
- Xavier (LA) — Gold Rush / **Gold Nuggets** (title)

## Verification, and its limits

**1. Nickname against the school's own athletics domain** (`check_nickname_vs_domain.py`,
offline). Athletics hostnames are usually built from the nickname — `hlgtrojans.com`,
`fontbonnegriffins.com`, `pimaaztecs.com — which makes them an independent witness to the
one field that matters most. **1000 rows positively corroborated.** Clipped forms count as
agreement (`gopack` for the Wolfpack, `godogs` for the Bulldogs), and a leftover hostname
token is only treated as a contradiction if it is a team name somewhere in the table — which
filters `deacs`, `terps`, `cuse` and `mgoblue`.

This found **10 rows matched to a different institution of a similar name** — the one failure
mode the script's own guards cannot see, because the article it lands on is a perfectly valid
university article, just not ours. All were repaired via `repair_identity.js` against an
explicit corrected article, with an assertion that the correction agrees with the school's
own domain before writing:

| School | Was | Now | Had been matched to |
|---|---|---|---|
| Kansas City | KCU | **Roos** | Kansas City University |
| Lafayette | Ragin' Cajuns | **Leopards** | University of Louisiana at Lafayette |
| Pacific | Boxers | **Tigers** | Pacific University (Oregon) |
| Northwest University | Pride | **Eagles** | Purdue University Northwest |
| Washington (MO) | Revolutionaries | **Bears** | George Washington University |
| Springfield | Prairie Stars | **Pride** | University of Illinois Springfield |
| LaGrange | Trojans | **Panthers** | Hannibal–LaGrange University |
| Franklin | Ravens | **Grizzlies** | Franklin Pierce University |
| Lander | LU | **Bearcats** | (right article, junk value) |

**A correction to an earlier draft of this file:** Amherst and Army were reported here as
wrong matches. Amherst never was — both its rows point at `wikipedia:Amherst College`; the
"University of Massachusetts Amherst / Minutemen" mapping came from a *dry run* of the
batched population script that was never applied. Army was genuinely wrong (the women's row
pointed at "Army University" rather than the Military Academy) and is fixed below.

LaGrange's nickname comes from its own athletics domain, not Wikipedia — neither the
university nor the athletics article states one — and its `identity_source` says so rather
than implying a Wikipedia provenance it never had.

**Lewis & Clark was flagged and deliberately NOT changed.** Its stored "River Otters"
contradicted `lcpioneers.com`, but that host now redirects to `golcathletics.com`, so the
Pioneers branding is what is stale. Changing it would have been the error.

**2. Men's vs women's for the same university.** Two passes, because the two files spell
many schools differently and the first pass could only see the ones spelled identically.

`cross_sport_check.py` pairs on the exact normalised name: of 417 universities, **413
nicknames agree exactly**, 3 are the deliberate splits above, 1 (Lubbock Christian) is a
genuine split. Mascot and colours agree on all 417.

`cross_sport_names.py` then pairs on the *core* name, so "Franklin" reaches "Franklin
College" and "Washington (MO)" reaches "Washington University in St Louis". This was the
most productive check of the lot, because the counterpart row is an independent witness for
exactly the schools the domain check is blind to — small colleges with no
nickname-bearing athletics host. It found **8 more rows matched to a different institution**,
none of which any earlier check had caught:

| Row | Held | Belonged to | Corrected to |
|---|---|---|---|
| Franklin College (W) | Diplomats | Franklin **&&** Marshall | Grizzlies |
| Bethel University (IN) (W) | Wildcats | Bethel University **(Tennessee)** | Pilots |
| Grace (M) | Royals | **Grace University**, Omaha | Lancers |
| Hamilton (M) | Harriers | **Miami University** Hamilton | Continentals |
| Saint Vincent (M) | Dolphins | **Mount** Saint Vincent | Bearcats |
| Union (NY) (M) | Red Storm | **St. John's** University | Garnet Chargers |
| Williams (M) | Hawks | **Roger** Williams | Ephs |
| Army (W) | *(blank)* | **Army University** | Black Knights |

Each was repaired from the row that was right (`repair_from_counterpart.js`), which also
makes the pair consistent. The repair names both rows explicitly and asserts the source
carries the expected nickname before writing — core-name pairing is safe for *flagging* and
unsafe for *writing*, since "Pacific" and "Pacific University" share a core token and are
different schools (Tigers vs Boxers).

After this, the only cross-sport nickname differences left are the three deliberate ones:
Centenary (LA) Gentlemen/Ladies, Oberlin Yeomen/Yeowomen, Xavier (LA) Gold Rush/Gold
Nuggets. **266 pairs agree.**

The same pairing filled **13 rows** that were blank on one sport only
(`fill_from_counterpart.js`) — Adrian Bulldogs, Alma Scots, Hope Flying Dutch, Rhodes Lynx
and so on. It refuses unless the source row's *article title* names the target school, which
is what stopped it copying Northwest University's Eagles onto **Northwest College**, and UNC
Greensboro's identity onto **Greensboro College** — different schools in both cases. One bad
fill did get through a first pass and was caught: treating "institute" as a generic word made
**Lamar Institute** reduce to the same core as **Lamar** and take Lamar University's
Cardinals.

**3. What verification could NOT establish.** A first attempt compared each article's
infobox `website` against domains we hold. It is too weak to gate on: 1597 of 2167 articles
state no website, and most apparent mismatches were false, because the article gives the
academic domain while we hold the athletics one (`fontbonne.edu` vs
`fontbonnegriffins.com` — the same school). It did independently catch LaGrange, and it is
kept as `verify_db_identity.js` for that reason, but the domain-vs-nickname check above is
the one to trust.

Rows the checks are silent on: 504 have no athletics host to compare against, and 483 have a
host that carries no nickname (`govikings.com`, `athletics.x.edu`). Those rest on the
Wikipedia guards alone.

## Recovering a nickname from the athletics site

259 rows had no nickname simply because the university article never states one — Amherst
really are the Mammoths, but their infobox does not say so. `nickname_from_domain.js`
recovers it from the school's own athletics hostname (`bartonbulldogs.com`,
`kwcpanthers.com`, `gobluehose.com`), and **requires two independent factors**, because the
host list is not clean — it carries `blcvikings.com` under "Bethany (KS)" (that is Bethany
*Lutheran*) and `highpointpanthers.com` under "Point (GA)":

1. the hostname must yield a word that is a team name elsewhere in this table, so
   `gobluehose` gives "Blue Hose" while `navysports` and `stacathletics` give nothing;
2. the site's own `<title>` must name our school — every distinctive word of it. Athletics
   pages are JS-rendered so their body text is useless over plain HTTP, but the title is
   server-rendered and reliably carries the institution.

**37 confirmed, 8 rejected, 5 unreachable.** The rejections are the point: `gopresidents.com`
is Washington & Jefferson, `gostatesmen.com` is Delta State, `gomatadors.com` is CSUN, and
`southwesternpirates.com` is Southwestern University in *Texas*, not our Southwestern (CA).

Two guards were added after they let something through:

* A "two matching words is enough" title test accepted `southwesternpirates.com` for
  Southwestern (CA) on the single word "southwestern". Now **every** distinctive word must
  appear.
* Requiring a parenthesised state to be corroborated *only for single-word names* let
  "Lewis & Clark (ID)" (Lewis-Clark State, Warriors) take `lcpioneers.com`, whose title reads
  "Lewis & Clark College" — the Oregon school. Both words matched; only the state separated
  them. The state is now **always** required when our name carries one, which gives up some
  true fills (Eastern University really is in Pennsylvania, but its title never says so) in
  exchange for never taking a same-named school's nickname.

A stem-ambiguity guard was tried and removed: it counted our own spelling variants as
ambiguity, refusing Kentucky Wesleyan even though its title reads "Kentucky Wesleyan College
Athletics". The title is the stronger evidence.

## Filling a blank row from the same school's other row

`fill_from_counterpart.js` copies identity between the two sports' rows for one institution,
which the differing spellings otherwise prevent. **125 rows filled** across two passes.

Three guards, each added because it caught a real error:

* **Division must agree.** Without it, the men's **D2** "Salem" (Salem University, Tigers)
  took the nickname of the women's **D3** "Salem College" — a women's-only college in
  another state that the core-token test could not distinguish. That wrong value was written
  and later corrected to Tigers from `salemtigers.com`.
* **A gendered form is not copyable.** **Hope** College's women are the Flying Dutch and its
  men the Flying Dutch**men**; the first pass copied the women's form onto the men's row.
  Corrected, and the guard now refuses that shape.
* **The source's article must name the target** — this is what stopped Northwest
  University's Eagles going onto **Northwest College**, and UNC Greensboro's identity onto
  **Greensboro College**. `athletics-domain:` sources skip this test, since they were already
  confirmed against that site's own title.

## Duplicate programmes — removed

Nine rows were the same school twice in the same sport and division, under a short and a long
spelling, and could each have been emailed twice. Eight were men's NAIA pairs from a
concurrent import (`dedupe_schools.py`); the ninth was a stray seed row.

The short spelling survived in every case: it is the convention the men's records file uses
throughout ("Westminster (UT)", "Point (GA)") and its `school_id` carries no `naia_` prefix,
so existing joins keep working. Removed: `Bethany College (Kansas)`,
`Northwestern College (Iowa)`, `University of St. Francis (IL)`,
`University of Saint Mary (Kansas)`, `St. Thomas University (Florida)`,
`University of Science and Arts of Oklahoma`, `Southwestern College (Kansas)`,
`Xavier University of Louisiana`, and a men's row named simply `New England` that carried
Western New England's identity (logo included) while `Western New England` existed
separately, and had no row in the records file at all.

Backups: `soccer_records.pre_dedupe.csv` and `recruitmatch.pre_dedupe.sqlite`.

**The delete had to be scoped to men's soccer, and a first run was not.** In the WOMEN'S
file the long spelling is the *canonical* one — "Xavier University of Louisiana",
"Northwestern College (Iowa)", "Southwestern College (Kansas)" are how the women's records
file names those schools. Deleting by name alone therefore removed seven legitimate women's
rows (taking women's nicknames from 1147 to 1141) before they were restored from
`recruitmatch.pre_dedupe.sqlite`. `dedupe_schools.py` is now scoped to `mens-soccer`
throughout, so the same run cannot repeat it.

**Three pairs disagreed on the actual W-L-D records**, so the dedupe kept the survivor's
values and reported the conflict rather than silently picking — and checking them against the
schools' own sites showed that mattered:

| School | Verified against | Outcome |
|---|---|---|
| Saint Mary (KS) | `gospires.com` — 2022 13-5-3, 2023 5-8-6, 2024 9-8-2, 2025 7-9-2 | survivor was right on all four; no change |
| Bethany (KS) | `bethanyswedes.com` — 2022 6-9-3, 2025 3-13-1 | both rows agreed on those; the dropped row's 0-17-0 for *both* 2023 and 2024 is a scrape artifact, so the survivor stands |
| Southwestern (KS) | `buildersports.com` — 2022 **5-7-5**, 2024 **6-9-2** | **the survivor was wrong on both.** Corrected to the dropped row's figures |

Southwestern (KS) is now 5-7-5 / 7-10-0 / 6-9-2 / 10-9-0. 2022 and 2024 are confirmed by the
school; 2023 and 2025 are **adopted, not independently confirmed** — the site does not
publish an overall record for those seasons, and they come from the row that proved right on
the two that were checkable. Its v6 score was regenerated. Backup:
`soccer_records.pre_swks.csv`.

Not merged, because they are DIFFERENT schools despite reducing to the same core name:
`Boston College`/`Boston University`, `Colorado`/`Colorado College`,
`Trinity College`/`Trinity University`, `University of Saint Mary`/`College of Saint Mary`,
`North Central College`/`North Central University`,
`New England College`/`University of New England`.

## The imported NAIA men's records were wrong, and are corrected

The 107 NAIA men's programmes that arrived mid-session had not been verified by anyone. One
of them, Southwestern (KS), turned out to be wrong in a way that mattered — which was reason
to check the whole batch rather than assume (`verify_naia_records.py`). Each school's own
season page carries a server-rendered "Season Record Overall", compared cell-for-cell:

| | |
|---|---|
| season-cells agreeing | **199** |
| disagreeing | **32** |
| unreadable (no record in server HTML) | 139 |
| we hold no record | 18 |
| schools confirmed on every readable season | 49 of 97 |

**29 of the 32 disagreements had OUR count LOWER**, never higher, with deltas clustering at
one or two games. That 86% agreement rate is what settles the interpretation: the dataset's
convention already IS the sites' full-season Overall, so a shortfall is an undercount to fix,
not a different counting rule to respect. Had the split been the other way, the correct
action would have been the opposite — leaving them alone and reconciling conventions.

**31 cells corrected across 16 schools** (`apply_naia_corrections.py`, backup
`soccer_records.pre_naiafix.csv`). The largest were hand-confirmed rather than trusted to a
regex:

| School | Season | Was | Now | Confirmed on |
|---|---|---|---|---|
| WVU Tech | 2025 | 15-0-2 | **20-1-2** | goldenbearathletics.com, all four seasons |
| Columbia International | 2022 | 10-3-3 | **15-4-5** | ciurams.com 2022 page |
| Cumberland | 2023 | 9-4-3 | **12-5-3** | gocumberlandathletics.com 2023 page |

**One disagreement was rejected.** Huston-Tillotson 2022 read as `0-0-1` from
htramsathletics.com — an unpopulated page, not a season. Overwriting a real 8-7-0 with that
would have been worse than the error. (The similarly-named `htathletics.com` is a
domain-for-sale parking page, which is how this got noticed.)

Men's v6 scores were regenerated afterwards. **139 unreadable season-cells are NOT
confirmed** — roughly half of season pages do not expose an overall record in server HTML,
and silence is not agreement.

## Second pass — the audit round

An adversarial re-check found six more wrong-school matches that the first pass missed, plus
one the first pass reported and then failed to repair. All verified against the school's own
site before writing, and in every case the same-named neighbour keeps its own identity:

| Row | Held | Belonged to | Now |
|---|---|---|---|
| Providence (D1) | Argonauts | University of Providence (MT) | **Friars** |
| Wilson College | Owls | **Warren** Wilson College | **Phoenix** |
| University of Saint Francis (IN) | Red Wolves | Saint Francis University (PA) | **Cougars** |
| Dominican University (D3) | Penguins | Dominican University of **California** | **Stars** |
| Dominican (NY) + Dominican College (NY) | Red Storm | **St. John's** University | **Chargers** |
| UMass | "UMass" | *(infobox gave only the abbreviation)* | **Minutemen / Minutewomen** |

The D1 Providence row is the honest failure of the first pass: the domain check DID flag it
("stored Argonauts, domain says friars") and it was reported as a catch — then omitted from
the repair list and left wrong. Reporting a finding is not fixing it.

Two junk values also cleared: `Lone Star` held "LSCS" (the college *system's* abbreviation),
and UMass held its own abbreviation. UMass turned out to be a genuine sex split its own site
settles — women's pages say Minutewomen (20 mentions vs 8), men's say Minutemen (24 vs 1).

### Coverage widened

`roster_players.source_roster_url` / `source_stats_url` yield an athletics host for 1502
schools — a source the first pass never used. Merging them added 428 hosts and lifted the
domain check from 1050 confirmations to **1292**. These are better attributed than the
coaching-contact URLs, having been scraped per school rather than matched by name.

A bug in `attributable()` was also losing recoverable nicknames silently: it compared a host
stem against the school's INDIVIDUAL words, so `goairforcefalcons` → stem "airforce" failed
against {air, force} and Air Force stopped being a candidate rather than being reported.
Fixed — Air Force is now Falcons.

Three nicknames the vocabulary approach structurally could not reach were supplied by hand and
then verified on the school's own site, because a nickname unique in the table can never
appear in a vocabulary built from the table: Navy **Midshipmen** (43 mentions), Presbyterian
**Blue Hose** (20), Queens (NC) **Royals** (41).

### Contradictions now stand at 1

Down from 6, after removing misattributed reference hosts (`friars.com` filed under
Providence (MT), `northcentralcardinals.com` under North Central University) and teaching the
check about consonant-clipped forms — `gobucs` for the Buccaneers, `gomacs` for the Maccabees
are not substrings of the full word. The rule compares de-pluralised stems for a prefix
relation, which is deliberately too weak to make "cardinal" agree with "ram" or "friar" with
"argonaut", so genuinely contradicting hosts stay flagged.

The one remaining is Lewis & Clark, unchanged on purpose: its stored "River Otters"
contradicts `lcpioneers.com`, but that host now redirects to `golcathletics.com`, so the
Pioneers branding is the stale side.

## Known issues

1. **The two files name the same school differently** — `Washington (MO)` (men's) is
   `Washington University in St Louis` (women's); likewise Park/Park University,
   Centenary (LA)/Centenary College of Louisiana, Westminster (PA)/Westminster College (PA),
   Lewis & Clark/Lewis & Clark College, Xavier (LA)/Xavier University of Louisiana.
   These are **not** duplicate rows — each name appears in exactly one sport, so nothing can
   be emailed twice. (An earlier draft of this file called them duplicates; that was wrong.)
   What they do cause is repairs keyed on `name` reaching only one sport's row, which is what
   `cross_sport_names.py` exists to catch.
   A related caution: a parenthesised state is a **disambiguator, not a synonym** —
   `Columbia` and `Columbia (MO)` are different schools (Lions vs Cougars), as are
   Georgetown/Georgetown (KY), Northwestern/Northwestern (IA) and Washington/Washington (MO).
   A first version of the duplicate detector had this backwards and reported 17 "confident
   duplicates" that were almost all distinct institutions.
2. **`St. Joseph's (NY)`** took the Brooklyn campus's "Bears" because the row names no
   campus, while separate rows exist for both campuses. A guess, flagged rather than hidden.
3. **Contaminated reference domains.** `known_domains.json` carries a wrong host for a few
   schools (`gotoros.com` under Cal State San Bernardino, `goconqs.com` under Garden City,
   `centenarycyclones.com` under Centenary LA). These produced false contradictions that
   were dismissed on inspection; the stored nicknames for those schools are correct.
4. **`soccer_records.csv` HAS A CONCURRENT WRITER — stop and check before editing it.**
   This is not a one-off: something outside this work was actively modifying the men's
   records file throughout the session.
   * 114 men's NAIA rows appeared in `colleges` and the records file grew 85 -> 199 NAIA
     rows mid-session.
   * That import created 8 same-sport duplicate pairs, removed here (see above).
   * Then, while this pass was verifying records, the other writer deduped **seven more
     pairs from the opposite direction** — dropping the short forms `Benedictine (KS)`,
     `Carroll (MT)`, `Georgetown (KY)`, `Life (GA)`, `Point (GA)`, `Providence (MT)`,
     `Union (KY)` in favour of its own long forms. No data was lost (the long-form rows
     carry the records), but NAIA men's naming is now MIXED: some pairs resolved to the
     short spelling, some to the long.
   * It also re-added a row this pass had removed, under a new spelling:
     `University of St. Francis (Illinois)` now sits beside `Saint Francis (IL)`.
   The identity scripts cannot have done any of this — `base.js` `update()` is a plain
   UPDATE, not an upsert, and none of them writes the records file. Verified intact after
   the last write: all 8 dedupe survivors and all 31 record corrections below.

5. **The dataset changed underneath this pass.** 114 men's NAIA rows were created in
   `colleges` mid-session, and `soccer_records.csv` grew from 85 to 199 NAIA men's
   programmes (195 with a 2025 record) at the same time. This closes the NAIA men's gap the
   folder README documents — but it was not done by this work: the identity scripts only
   UPDATE (`base.js` `update()` is a plain UPDATE, not an upsert) and none of them writes
   the records file. Most likely the long-running dev server or a concurrent job. The new
   rows have no `created_by_id`, and their records have not been verified here.
6. **2025 conference champions** (`conference_champion_*`) were populated in an earlier
   session, 111 women's rows and 84 men's, mostly from per-conference championship reports
   with a URL each. This pass did not touch or re-verify them.
7. **Schools whose Wikipedia article states no nickname at all** stay blank rather than
   guessed — Amherst (the Mammoths), Alvernia, Beloit, Berry and others have an
   `identity_source` but no nickname. Their athletics domains would supply many of these.
8. **`Rainbow Wāhine`** needed `nickname_plural` set by hand — "Wāhine" is plural in
   Hawaiian but does not end in "s", so the grammar helper read it as singular.
