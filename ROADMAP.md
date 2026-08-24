# Thriv3 — Road to Go Live

The single canonical roadmap. Tracks the four pillars of the Thriv3 Engine
deck against what is actually built. Update the checkboxes as work lands; keep
the "verified state" numbers honest by re-running the queries rather than
trusting this file.

Last audited: 2026-08-24, re-verified against the DB and the live edge
(branch `engagement-tracking`, 296 tests green). Coverage numbers below were
re-run, not copied; two moved and are corrected in place.

---

## Locked decisions

| Decision | Answer | Consequence |
|---|---|---|
| Send architecture | **Outlook drafting now, ESP before go live** (revised 2026-08-24) | Sequencing is proved against Outlook drafts first, so Phase 2 is not blocked on a provider choice. Domain warming stays a calendar dependency, but it moves to just before the pilot rather than the front of the project. |
| Product shape at go live | **Single user** (Rhys operates the engine on athletes' behalf) | No auth, no accounts, no athlete-facing UI. Pillar 1's weighting UI is an operator tool, not self-serve. |
| Pilot scope | **Men's and women's soccer, NCAA D1–D3** | 1,759 active programs, 1,621 with a coach email. NAIA/NJCAA and the four non-soccer sports are out of scope until after go live. |

### Verified coverage in scope

| D1–D3 | Men's | Women's | Total |
|---|---|---|---|
| Active programs | 734 | 1,025 | 1,759 |
| With a coach email | 703 | 918 | 1,621 |
| With a head-coach email | 683 | 891 | 1,574 |
| With 2025 roster data | 718 | 985 | 1,703 |
| **Missing academic rating** | **0** | **323** | **323** |
| Missing nickname (personalisation) | 36 | 66 | 102 |
| Missing `estimated_graduation_year` rows | 341 | 909 | 1,250 |

Adding women's soccer put two gaps back on the critical path that the men's-only
scope had retired: **academic rating** (0 men's, 323 women's — 31% of women's
programs) and **roster data** (16 men's, 40 women's). Both are data jobs with
lead time, so both sit in Phase 0.

---

## Pillar status at a glance

| Pillar | Deck promise | Verified state | Remaining |
|---|---|---|---|
| 1 · Matchmaking | Athlete-ranked criteria, adaptive re-weighting, top 100 | Fixed-weight scorer over strong data | Weighting model, 2 unscored criteria, explainability, null-rating handling, learning loop |
| 2 · Networking | 3-week A/B/C sequence, 100 programs at a time | Excellent personalisation, no campaign engine, no scalable send | ESP migration, campaign engine, coach table, compliance |
| 3 · Interactions | Tracking, coach score, session timelines | Feature-complete and tested; edge repaired, guarded and covered 2026-08-24; still **never run on real traffic** | One real end-to-end send; automated sync; real response detection |
| 4 · Recommendation | Quality/lifestyle reports, freshman minutes, turnover, match rating | Nothing built; 2 of 3 inputs un-sourced | 2024 roster backfill (both sports), lifestyle data source, metrics, UI |

---

## Phase 0 — Start today, runs in the background

Calendar lead times, not engineering ones. Nothing downstream compresses if
these start late.

### Sending domain — deferred 2026-08-24

Held deliberately, not forgotten. Sequencing will be proved end to end against
Outlook drafts, which the code already does, and the ESP is chosen once that
works. The trade is accepted with eyes open: **the warming ramp becomes the
long pole immediately before the pilot instead of running underneath the build**,
so budget three to four weeks between "sequencing works" and "cohort 1 sends".
Nothing below has changed except when it starts.
- [ ] Register and begin warming a sending **subdomain** (e.g.
      `send.striv3.com`), not the root — a reputation problem must not be able
      to poison `striv3.com` mail.
- [ ] Configure SPF, DKIM, DMARC before the first send.
- [ ] **Ramp target.** Two sports doubles the pilot: 6–10 athletes × 100
      programs × 3 emails ≈ 3,000 sends over three weeks — roughly 140/day at
      one coach per program, ~285/day at two. That is beyond a comfortable
      3–4 week ramp.
- [ ] **Stagger the cohorts** rather than stretching the ramp: men's cohort
      sends first, women's cohort starts 2–3 weeks later. Halves peak daily
      volume and gives cohort 1's deliverability data before cohort 2 sends a
      single email.
- [ ] **Choose the ESP, checking cold-outreach policy first** (deferred — see
      above). Several
      transactional providers prohibit unsolicited outreach on their streams
      outright; confirm terms before building against an API. Evaluate
      build-vs-buy — a purpose-built sequencing platform supplies warmup,
      A/B/C sequencing and reply detection natively and could remove most of
      §2.3.

### Data backfills

Ordered by lead time and blast radius, not by size. The 2026-08-24 audit
looked into each one rather than taking the headline count at face value, and
two of them are a different job than the count suggests.

- [x] **2024 rosters, both sports — acquired.** Six CSVs in
      `~/Documents/Thriv3/2024 Roster Sheets/`, 52,417 player rows from 1,661
      of 1,707 school-sports (97%). Verified rather than assumed: the headers
      match the 2025 files byte for byte, 95% of rows carry a class year, and
      the graduation-year convention is the intended season-relative one
      (Fr.→2029, Sr.→2026), so a player scores the same in both seasons and
      the turnover diff holds. The 46 failures are concentrated in D1 (35 of
      them) and each carries a reason.
- [x] **Imported both seasons.** `importRosterSheets.js` takes `--season` and
      `--dir`, and skips a division file that is not present rather than
      failing — the 2024 acquisition was scoped to D1–D3, and a missing NAIA
      file is a fact about scope, not an error.
      **roster_players now holds 52,912 rows for 2024 and 64,436 for 2025, and
      1,682 in-scope school-sports have both seasons — turnover is computable
      for the first time.**

      Importing exposed a defect the class-year guard could not see, because
      it only ever inspected the class column: four D1 women's programmes had
      their *jersey* column read as the player name, giving 120 players called
      "Jersey Number 9". They wreck the metric they feed rather than merely
      adding bad rows — a placeholder can never match a real name next season,
      so Akron's women showed 60 departures from a 25-player squad. A name
      guard now drops them loudly, `server/lib/rosterName.js` is tested, and
      the four schools are marked failed in the 2024 worklist for re-scrape.
      Turnover reads 44.6%, and the name-matching error behind it has now been
      measured rather than assumed — see below.
- [x] **Measured the name-mismatch error in turnover: 0.2 points, at most
      0.5.** Turnover is a diff, so a name spelled differently in the two
      seasons counts once as a departure and once as an arrival and the error
      does not cancel. `tools/soccer/turnover_error_rate.py` matches each
      apparent departure against the same programme's 2025 roster through
      progressively looser tiers, and reports the tiers separately rather than
      as one number, because they are not equally trustworthy: a reordering
      ("Nastuta, Catalin") is one person spelled two ways, while a shared
      surname and initial is usually two people — "Connor Smith" against
      "Carter Smith", "Jake Provenzano" against "Luke Provenzano".

      So **44.6% turnover is essentially real**, and the metric is sound
      enough to build on. Measuring it also turned up two more name-column
      defects, both now cleaned at import and tested: 118 schools prefix
      captains with a bare "C" (324 rows, 67 with an exact clean twin the
      following season), and 101 rows at three programmes repeat the whole
      name, "Trevor Rau Trevor Rau". Fixing those cut the edit-distance tier
      from 83 to 20.
- [x] **Turnover is two metrics, not one, and the second is the Pillar 4
      signal.** An earlier version of this entry treated the 11,746
      non-graduating departures as a problem to explain away. That was
      backwards. Separated properly:

      **Openings** — departures of players who were leaving anyway (Sr., Gr.,
      5th). 11,751 of them. This is a Pillar 1 input: it says a roster spot is
      coming free at a position, and the matcher already reads it.

      **Retention** — of the players who *could* have come back, how many did.
      This is the Pillar 4 quality signal, and it is the more interesting one:
      a programme whose freshmen and sophomores keep leaving is a programme
      players are choosing to leave, whatever its record says. Retention is
      the closest thing in the data to whether an athlete would enjoy being
      there, which is exactly what an 18-year-old picking a programme has no
      way to find out.

      Across 1,669 in-scope programmes with at least 10 players who could
      return: median **75%**, p10 53%, p90 94%. A 40-point spread between the
      deciles, so it genuinely discriminates rather than describing everyone
      the same way. It also behaves as reality would predict — D3 retains at
      79% against D1's 73% — which is evidence it is measuring something real
      rather than reflecting scrape quality.
- [ ] **Build the retention metric into the product.** It is a query today,
      not a column. Needs persisting per programme-season, exposing on the
      match card, and pairing with its own denominator so "80% of 5" is never
      shown as though it were "80% of 30".
- [x] **Luther College's 0% was a sixth name defect, not a result.** Their
      2025 sheet printed the surname twice — "Allison Dobbins Dobbins" — which
      the whole-name-doubled check missed because an odd word count never
      splits into equal halves. All 28 returning players failed to match.
      Fixed and tested; Luther now reads **75%**, exactly the median. **No
      programme reads 0% any more**, and the floor is USC Upstate at 10%
      (3 of 30), which is a plausible bad year rather than a broken join.

      A leading duplicate is only collapsed when a trailing one accompanies it
      ("Abbigail Abbigail Johnson Johnson"). Alone it is more likely a real
      name: Bushnell's Jay Jay Van Der Velde keeps both his Jays.

### Retention needs more than one year
One season pair is a snapshot, and a snapshot cannot tell a programme players
leave from a programme that had one bad year. A coaching change, a single
disastrous season or a strong graduating cohort all move a one-year number
without saying anything about what an athlete would be walking into. The
spread is real — p10 53% against p90 94% — but attributing a given programme's
place in it needs a trend.

**The backfill is running in a separate session** — 2024's remaining gaps,
then 2023 and 2022. Not to be picked up here.

- [ ] **Finish the 2024 acquisition first.** 46 school-sports failed, 35 of
      them D1, plus the 4 whose jersey column was scraped as the player name.
      Extending backwards over an incomplete 2024 would compound the gap
      rather than average it out.
- [ ] **Then 2023, then 2022**, through the same pipeline. `--season` and
      `--dir` already take them, `_targets.csv` regenerates by swapping the
      year, and the name guards now catch six distinct defect shapes, so each
      further season should cost less than the one before. Expect Wayback to
      carry more of the load each year back — it was 298 of 1,707 for 2024,
      and live sites drop older seasons.
- [ ] **Report retention as a multi-year rate with its trend**, not a single
      figure. Three pairs (22→23, 23→24, 24→25) distinguish a programme that
      consistently loses players from one that had a bad year, which is the
      difference between a recommendation and a coin toss.
- [x] **Reconciled the 5 division-mismatched ratings**, leaving 318 genuinely
      absent. Copying from the men's row is not available: only 5 of the 323
      have a men's counterpart at all, because most of the gap is SEC/Big 12
      schools that sponsor women's soccer and no men's programme.
- [x] **Established what the academic scale is: 70% US News, 30% Niche.**
      Recorded here because nothing in the code says so — there is no
      generator for `academic_scores.json` and the code calls the ratings
      "LLM-sourced", which is wrong. The blend is deliberate: US News for the
      official view, Niche for the student-reported one.

      The scale is sound where populated. Harvard, Yale, Princeton, Stanford
      and Duke at 10; MIT, Amherst, Williams, Swarthmore, Haverford and
      Grinnell at 10; Akron 5.6. And the divisional pattern is real rather
      than an artefact — among genuinely rated schools the median is **D3 8.2,
      D1 6.8, D2 6.0**, which is what anyone who knows the NESCAC and the UAA
      would expect.
- [x] **Separated a measured rating from a fill.** 55% of D2 schools hold
      exactly 5.4 and 58% of D3 hold exactly 6.5. A 70/30 blend of two
      continuous rankings cannot produce 327 identical values to one decimal,
      so those are schools that were not in either source and took a
      divisional fill. `colleges.academic_rating_source` now records `rated`
      against `division-modal`.

      **The fills are mostly landing correctly**, which an earlier version of
      this entry got wrong by treating them as a serious defect. Of 25
      well-known strong-academic programmes, 24 carry a real rating and only
      **Carnegie Mellon** sits at the fill — a top-25 national university
      scored 6.5. The rest of the fill population is genuinely mid-tier
      regional colleges, for which 6.5 and 5.4 are defensible.

      What remains true is narrower than first claimed: the filter moves a
      division as a block at the fill value — D2 keeps 97% at a threshold of
      5.0 and 28% at 5.5 — so the criterion cannot rank *within* the filled
      population, only include or exclude it wholesale.
- [x] **Audited every rating against its source, and the method is sound —
      the join was not.** 751 of the 878 rated schools carry exactly the score
      their name holds in `academic_scores.json`. Of the 127 without an exact
      entry, 113 are the same university spelled differently in the other
      sport ("Amherst" against "Amherst College"), which is fine.

      **14 were fuzzy matches to a different institution, and 12 of those were
      wrong.** All twelve are flagship women's D1 programmes — the most
      important schools in the pilot:

      | School | Held | Actually belonged to |
      |---|---|---|
      | Kansas / Arkansas | 4.8 | Central Arkansas |
      | USC | 4.8 | USC Upstate |
      | Purdue | 4.8 | Purdue Fort Wayne |
      | Illinois | 4.3 | Eastern Illinois |
      | Houston | 3.8 | Houston Christian |
      | Utah | 4.5 | Utah Tech |
      | Florida | 6.4 | Florida Atlantic |
      | Georgia | 6.1 | Georgia State |
      | Missouri | 5.8 | Missouri State |
      | Oregon | 7.8 | Oregon State |
      | Ohio | 8.9 | Ohio State |
      | Southern | 5.5 | Georgia Southern |

      Two flagged cases were legitimate and left alone: Army is West Point,
      and Jefferson University *is* Thomas Jefferson University.

      Caught by comparing each rating against its conference peers — Purdue at
      4.8 in a Big Ten whose median is 8.7 — then checking the source. US News
      puts Purdue at #46 and Penn State at #59, yet the data rated Penn State
      8.7 and Purdue 4.8. All twelve are now voided rather than left wrong,
      with the reason in `identity_notes`.

      **This is the third column the same bug has corrupted**, after
      `athletics_domain` and the identity mappings. `matchSchoolName` resolves
      a name absent from a source file to the nearest longer one, and a
      flagship university's short name is always a prefix of some satellite
      campus. It is a property of the matcher, not of any one dataset.
- [x] **Fixed `matchSchoolName`.** Two rules were at fault and both looked
      reasonable. `"state"` was a strip word, so "Georgia" and "Georgia State"
      normalised to one string — as did Ohio/Ohio State, Missouri/Missouri
      State, Oregon/Oregon State. And the last resort was a bare substring
      test, which is fatal because a flagship's short name is a prefix of some
      satellite campus almost by construction.

      Now an extra word is only ignorable when it carries no institutional
      identity, and the function returns null rather than guessing. Against
      real data it resolves 957 school names and **refuses 380** that it
      previously answered confidently. 11 tests, including every historical
      failure — Belmont/Belmont Abbey, Amherst/UMass Amherst, USC/USC Upstate.

      One case stays undecidable and is documented rather than papered over:
      "Adrian" plus "College" is one school and "Cornell" plus "College" is
      two. What protects against it is the exact-match stage, which is why
      Cornell (9.8, Ivy) and Cornell College (6.6, D3) are both correct today.
- [x] **Rated 11 of the 12 flagships from checked US News ranks.** USC #29 →
      9.7, Florida #30 → 9.7, Illinois #36 → 9.4, Georgia and Purdue #46 →
      9.1, Missouri #102 → 8.2, Oregon #110 → 8.1, Houston #132 → 8.0,
      Kansas #143 → 7.9, Utah #151 → 7.8, Arkansas #183 → 7.4, Ohio #198 →
      7.1. The Big Ten women's table now reads in the same range as the men's,
      which it did not before.

      **These are interpolated, not reproduced, and are labelled
      `rated-interpolated` to say so.** The original 70/30 computation exists
      nowhere on disk — no script, no source data — so the scores are placed
      against anchors whose rank *and* existing score were both verified
      (#24 Emory 10, #59 Penn State 8.7, #158 Louisville 7.8, #222 West
      Virginia 6.8), interpolated on log(rank) because the top of the scale is
      compressive. They are consistent with the existing scale by
      construction; they are not guaranteed identical to what the original
      method would have produced, and the ranking vintage may differ.

      Southern (SWAC) is left unrated: US News places it under Regional
      Universities South, so these anchors do not apply to it.
- [x] **Rebuilt every academic rating from scratch.** Decided 2026-08-24
      after the audit: the column had too many demonstrated errors to patch
      school by school, so all 1,337 in-scope schools were recollected.
      **1,337 of 1,337 collected (100%)** — 1,327 ranked, 9 that US News files
      outside the undergraduate taxonomy, 1 that it does not cover at all.
      Worklist:
      `~/Documents/Thriv3/University individualisation/academic_ratings_rebuild.csv`,
      D1 first, resumable, one row per distinct school name.

      **Raw data is collected separately from the score.** The sheet records
      the US News rank, its exact category and the Niche grade — not a
      computed rating. The formula has already changed once this session, and
      recollecting 1,337 schools because a weighting moved would be
      unforgivable. The raw numbers outlive any weighting.

      The extraction route took several dead ends to find, so it is written
      down. US News publishes `/best-colleges/sitemap.xml`, which yields
      **1,787 school slugs with their profile ids**; with a page open on the
      domain, profile pages fetch same-origin in bulk at roughly 25 schools a
      call, each returning rank, category and city. The rankings list is gated
      past rank 30 and paginates client-side, and Niche returns 403 to any
      programmatic fetch, so its grades need another route.

      **Every match is verified by location, not by name** — the lesson of the
      whole audit. The first candidate for "Belmont" was Belmont Abbey, and
      Nashville against Belmont NC is what rejected it. Likewise Colorado
      against Colorado College, Columbia against Columbia College Missouri,
      Auburn against Auburn Montgomery, Brown against John Brown. Anything
      unverifiable is marked `needs-manual` rather than guessed. Only one row
      stayed there: **Simon Fraser**, in Burnaby BC, which US News Best
      Colleges does not rank because it is Canadian. Every other open question
      closed, including "Buffalo" — the D1 programme is the University at
      Buffalo, a different university from SUNY Buffalo State.

      **Every one of the 1,029 distinct profile pages was then re-fetched and
      diffed against the recorded rank and category. Zero mismatches.** The
      same pass compared each page's own name against its slug, which is what
      no earlier check did, and it found two rows that had been wrong since a
      previous session:

      - **Cal State Bakersfield** carried the id 1141, which is Cal State
        Dominguez Hills, and so carried Dominguez Hills' #36. Now `csub-7993`,
        #31 Regional West.
      - **Gardner-Webb** carried the id 2928, which is Fayetteville State, and
        so carried Fayetteville State's #52 Regional South. Now
        `gardnerwebb-university-2929`, #384 National.

      Both are the same failure: **US News routes on the numeric id, not the
      slug text**, so a URL that reads perfectly can serve another school. The
      slug is not evidence of identity; the page's own name is. Any future
      collection against this source has to check the returned name.

      The pass also corrected five rows the earlier session had called
      unranked — Alabama State, Chicago State, Grand Canyon, Idaho State and
      Liberty. They are ranked; they sit in tier bands (`#395-434`), which the
      first parser only read as absent. Six such bands are now in the sheet
      and the scoring step has to handle them.
- [ ] **Build a rank-to-score curve per US News category.** Seven categories
      appeared in the first 60 schools alone — National Universities, National
      Liberal Arts Colleges, and Regional Universities and Colleges across four
      regions. **#3 Regional South is not #3 National**: Appalachian State is
      #3 Regional South and Butler #1 Regional Midwest, against Alabama at
      #169 National. One curve across all of them would repeat the category
      error the old column already made.
- [ ] **Decide how to treat the 9 schools outside the undergraduate
      taxonomy.** Not "unranked" in the ordinary sense: US News files Babson
      and Menlo and Northwood under Business Schools, Pratt under Arts
      Schools, Rose-Hulman under Engineering & Technology, Martin Luther under
      Miscellaneous — categories it publishes without a rank. Rose-Hulman in
      particular is a strong engineering school, so a low fill would be worse
      than no value. They need an explicit answer rather than a divisional
      fill — which is how the old column ended up 55% one value in D2. Simon
      Fraser needs a Canadian source instead.

- [ ] **Decide how tier bands score.** Six bands are in the sheet
      (`51-56`, `121-133`, `145-160`, `150-164`, `183-201`, `395-434`). The
      midpoint is the obvious choice; it should be a stated choice, not an
      accident of whatever the parser does.

- [ ] **Roster scrape pass — 72 school-sports, one job not two.** The 56
      programs with no 2025 roster and the 16 whose roster imported with no
      class year are the same failure and the same fix.
      **28 resolved, 44 outstanding.** 26 harvested clean (841 players, 837
      with a class year, every count matching the database where one existed)
      and 2 recorded as `no-class-data` because American International
      genuinely publishes none. The remaining 44 each carry a specific reason:
      13 need a real search, 8 use layouts the selectors miss, 7 had a
      candidate correctly rejected as the wrong school, 7 serve the wrong
      season, 6 returned an implausible count, 3 have an unconfirmed
      parenthetical qualifier.
      Tooling: `tools/soccer/discover_roster_urls.py` and
      `tools/soccer/harvest_rosters.py`.
- [x] **Merged the harvested 2025 rosters.** 208 class years written onto
      existing rows and 606 players appended for schools that had none, via
      `tools/soccer/merge_harvested_rosters.py`. The two gap types needed
      opposite treatment: a school missing only its class column already had
      minutes and games from the stats scrape, so replacing the row would have
      traded a season of minutes for a class label. In-scope schools with a
      2025 roster went from 1,703 to 1,725, and grad-year nulls from 1,245 to
      1,042.

      Re-validating the harvests first caught a wrong-school harvest that the
      earlier guards had let through: Simon Fraser's men had picked up **Saint
      Francis University** — `sfuathletics.com` is not `sfu.ca`. The merge now
      refuses outright when none of a harvest's players appear on an existing
      sheet, rather than reporting a quiet "filled 0". Re-validation also
      produced two false rejections, Kentucky ("UK Athletics") and UC Santa
      Barbara ("University of California, Santa Barbara"), so the school check
      now falls back to corroborating the host against `known_domains.json`
      — which still refuses Saint Francis, because its host is not among Simon
      Fraser's known domains.
- [x] **Guarded the class-year column before re-scraping.** There was no
      parser in this repo to fix — the bad values are in the scraped CSVs
      themselves, so the fix had to be validation at import, and it had to
      land before B1 delivers six fresh files. `server/lib/classYear.js`
      reads the label and, more to the point, refuses to read one that is not
      there; `importRosterSheets.js` nulls a rejected cell, records the raw
      value in `notes` so the rejection is auditable, and prints the offending
      schools rather than burying them in a total.

      Validated against every label in the database rather than invented:
      158 distinct labels agree with the existing graduation years, **none
      disagree**, and exactly 16 rows are rejected — 15 at Texas Tech, whose
      Club column was scraped as Class/Year, and one at Ursinus. Fixing the
      alternation bug found along the way (a bare `r` beating `rs` and
      `redshirt`, so `RS-Fr.` decomposed to nonsense) recovered 158 rows that
      would otherwise have been rejected.

      The Ursinus row is **not** a scraper bug: 'Team IMPACT' is the charity
      that drafts seriously ill children onto college teams, so that is a
      genuine honorary roster entry. It has no class year and now correctly
      has none. Whether honorary members belong in a turnover count at all is
      a separate question, deliberately left open.
- [ ] **`estimated_graduation_year` nulls — 1,245 rows, and it is a scrape,
      not a mapping fix.** Down from 1,250: the import now derives a year from
      the class label when the sheet carried a class but no year, which was
      worth 6 rows, against one lost to voiding the bogus `Solar` → 2029.
      That is the whole of what mapping can reach — 1,218 of the remainder
      have no `class_year_label` either, so there is nothing to map from, and
      the 11 bare redshirt markers ('Rs.', 'Medical Redshirt') genuinely carry
      no class and are correctly null rather than guessed at.

      After the 15 whole-roster failures above are re-scraped — Texas Tech is
      one of them, its entire 30-player roster having no usable class year —
      what remains is roughly 767 rows scattered thinly across 267 schools.
      That is the expensive tail, and the one worth timeboxing.
- [ ] **Nicknames — 102 programs** (36 men's, 66 women's). Cheapest and least
      urgent; personalisation quality, not a blocker, and the template falls
      back cleanly. Fill in the gaps between the jobs above.

### Newly discovered, and fixed 2026-08-24
- [x] **`athletics_domain` named the wrong institution in 235 of 2,441 rows.**
      Found while looking for roster URLs for job B3, not by looking for it.
      `athletics_domains.json` holds 727 entries and simply lacks the short
      names — no "Belmont", no "Cornell", no "Michigan" — and `build.py`
      resolved it with the bidirectional-subset matcher it uses for the coach
      files. There the two spellings are the same school; here the other rows
      are *other schools*, so a missing short name reached the nearest longer
      one and published Belmont Abbey's domain for Belmont, Northern
      Michigan's for Michigan, NC Wesleyan's for North Carolina.

      **Correction, same day.** An earlier version of this entry said the
      identity checks were consulting the wrong school because of this. That
      was wrong. `verify_db_identity.js` and `verify_mappings.py` both read
      `known_domains.json`, not this column, and that file already held the
      correct domains. The bad column fed outreach personalisation and the B3
      roster-URL discovery, not identity verification.

      No rule over names could have prevented the original fault: "Adrian"
      plus "College" is the same school and "Cornell" plus "College" is a
      different one. But taking the roster URL as authoritative instead was
      also wrong, and the first repair proved it by writing **53
      regressions** — Mississippi College to `hugedomains.com`, Dickinson to
      Fairleigh Dickinson's, Franklin and Franklin & Marshall swapped, New
      Jersey City to The College of New Jersey. `source_roster_url` was built
      by name matching too, so it carries the same wrong-school matches.
      Trading one unverified source for another is not a repair.

      The rule that works is **agreement between two independent sources**,
      the roster URL and `known_domains.json`, recorded in a new
      `athletics_domain_source` column. 1,952 rows agree and are trusted; 66
      disagree and are written down as conflicts rather than resolved by
      preferring whichever source the script likes; 299 rest on a single
      source and say so; 104 stay empty. Checked against the pre-repair file:
      zero regressions, zero parking domains. `build.py` no longer
      subset-matches this field, so a rebuild cannot reintroduce it.
- [x] **Re-ran both identity checks.** Not for the reason first given — they
      never read the broken column — but because their stored verdicts
      predated the current `known_domains.json` by a day.

      **No identity errors in pilot scope.** `verify_db_identity.js`: MISMATCH
      fell 31 → 22 overall and `unknown_school` 500 → 127. All five mismatches
      inside soccer D1–D3 are false positives, where the article gives the
      institutional domain (`augie.edu`, `suffolk.edu`) and our evidence holds
      only the athletics host (`goaugie.com`, `gosuffolkrams.com`) — same
      institution, different host. `verify_mappings.py`'s 7 mismatches are the
      identical pattern, and its 11 uncorroborated titles, including the
      notorious Amherst → UMass Amherst, refer to the older mappings file: the
      database already carries `wikipedia:Amherst College`, and each of those
      rows has either no nickname or a correct one.
- [ ] **Find a second corroborating source for identity.** The re-run also
      showed how little these checks cover: 1,609 of the 1,667 in-scope rows
      come back `unknown_article` because the Wikipedia infobox has no website
      to compare against, so only 27 rows are positively confirmed. The
      identity data is sound as far as it is checked, and 96% of it is not
      checked by this route. Treat a clean run as absence of evidence, not
      evidence of absence.

### Hedge, so the data work is not on the critical path
- [ ] **Handle null academic ratings in `playerAnalysis.js` now** rather than
      waiting for the backfill. The filter at `playerAnalysis.js:51` drops
      every null-rated school silently, so a third of women's programmes are
      invisible whenever an athlete sets academic importance. This is a
      Phase 1.2 line item, but doing it early converts the 318-school backfill
      from a blocker into an improvement — worth the reordering.

---

## Phase 1 — Prove Pillar 3, finish Pillar 1

Cheapest high-information work. Do not start Phase 2 before task 1.1 passes.

### 1.1 Prove the tracking loop end to end
The pillar is validated entirely by simulator output — all 90 events in the DB
have a null `remote_id`, and the edge cursor stopped at 6. The path
*published profile → real inbox → coach opens → D1 → sync → rollup → Tab 3*
has never carried a genuine visit.

The plumbing either side of that path is now sound and, as of 2026-08-24,
actually checked rather than assumed: 18 live tokens at the edge, delete
guard locked, three triggers in place, `npm run sync` clean. What remains is
the send itself.

**Two edge-state defects were found in the 2026-08-24 audit and both are now
resolved. Neither was visible from the local database, which is the lesson.**

- [x] **The edge token allowlist was empty.** `GET /p/<slug>?ref=<live token>`
      returned the neutral "Profile unavailable" page for a token that was
      live locally, byte-identical to the response for a bogus token — every
      tracked link in the wild was dead, and had been since 2026-08-20.
      Cause: D1 `29ac16ae` was never re-provisioned; its schema is intact and
      `outreach_tokens` and `tracking_events` had simply been emptied by hand,
      almost certainly a test-data cleanup during the build session. Nothing
      in the repository deletes remote D1 rows, so this is not a recurring
      automated hazard — it is an undetected manual one. Repaired by
      `pushTokens()`: 18 live tokens at the edge, live link serves the profile
      (22,200 bytes), bogus link still serves the neutral page (2,377 bytes).
- [x] **The event cursor was suspected to be ahead of the edge** —
      `edge_events_cursor` 6 against an empty event table. Resolved as a
      non-issue: `sqlite_sequence` on the edge holds `tracking_events = 6`, so
      `AUTOINCREMENT` resumes at 7 and `drain()`'s `id > 6` will pick up the
      first real event. The cursor is correct and was left alone. Worth
      knowing that the deleted rows kept their high-water mark — had the table
      been dropped and recreated, the first six real events would have been
      permanently invisible.
- [x] **Made the wipe detectable.** `POST /api/tokens` now returns
      `liveAtEdge`, and `pushTokens()` compares it against the live count it
      sent; `npm run sync` prints the count and exits non-zero on a mismatch,
      so whatever eventually schedules the sync has something to alert on. A
      worker too old to report the count reads as unknown, not as a mismatch.
      Deployed 2026-08-24; verified live (`pushed 18 token(s), 18 live at the
      edge`). Four tests added.
- [x] **Stopped the edge tables being emptied silently.** The append-only
      guarantee was a `BEFORE UPDATE` trigger only; `DELETE` was unguarded on
      both `tracking_events` and `outreach_tokens`, which is exactly how this
      happened. A flat `ABORT` would have been wrong — edge events genuinely
      need pruning once pulled down, and local retention already deletes its
      own copies — so deletion is now *deliberate* rather than impossible: a
      `BEFORE DELETE` trigger on each table aborts unless `edge_guard` holds
      an unexpired unlock window, which closes on its own if you forget to
      re-lock. Applied to production D1 (`npm run edge:schema`, idempotent)
      and proved live: a locked delete failed with `SQLITE_CONSTRAINT_TRIGGER`,
      the unlock/delete/re-lock cycle worked, and the allowlist came through
      at 18 live tokens. Eleven tests added — the worker had no coverage at
      all before this, so `worker/**` is now in the vitest include list.
- [x] **Made the trial one command to check and one command to run.**
      `npm run trial:preflight` verifies all thirteen preconditions —
      configuration, athlete publishability, allowlist sync, delete guard,
      cursor safety, and that a live token really does serve the profile while
      an unknown one really does not — then exits non-zero if any would make
      the trial misleading. It sends nothing and writes nothing, and the tests
      assert both. Currently all green against production. `/api/health` now
      reports the edge's own state to an authed caller, which is what makes
      the last four checks possible; unauthed callers still get liveness only,
      since counts would leak how much outreach is in flight.
- [ ] Publish one real athlete profile and send one tracked link to a mailbox
      you control, from outside the local network. **Deliberately not done
      yet** — building continues first, and the trial is revisited after.
      When it is: run the preflight, then `sendOutreach` with `send: false`
      to inspect the Outlook draft before anything leaves.
- [ ] Confirm events land in D1, sync down with a non-null `remote_id`, roll
      up, and appear in Tab 3 with a correct session timeline.
- [ ] Fix whatever that exposes.
- [ ] Automate the sync (scheduled pull) instead of the manual button. Nothing
      schedules it today — `POST /api/engagement/sync` and `npm run sync` are
      only ever called by hand, which is why the defects above went unnoticed
      for four days. The alerting half now exists (mismatch → non-zero exit);
      what is missing is something that runs it unprompted.

### 1.2 Pillar 1 weighting model
Replaces the hardcoded constants in `src/lib/playerAnalysis.js`
(ability ≤70, academic ≤15, starters ×5, position ×2).

- [ ] Persist per-athlete criterion weights on the player record.
- [ ] Operator UI to rank/weight the six deck criteria: player ability,
      academic prowess, scholarship needs, division/conference/state,
      players graduating, program quality.
- [ ] Score **scholarship needs** — `budget_range` is collected and never used.
- [ ] Score **state/geography** — `city`/`state` collected and never used.
- [ ] **Handle null academic ratings explicitly** rather than filtering them
      out silently. Even after the Phase 0 backfill, treat "unrated" as a
      visible state on the card, not an invisible exclusion.
- [ ] Per-criterion score breakdown on each match card. Required the moment
      weights are adjustable: "why is this school 7th?" must be answerable.
- [ ] Re-run matching on weight change (the deck's "re-weights as priorities
      change"). This is the *deterministic* half of slide 3 panel 2 — the
      learning half is Phase 5.

---

## Phase 2 — Pillar 2: the campaign engine

The largest remaining build. Everything here is gated on the ESP decision.

### 2.1 Coach data consolidation
- [ ] Promote `graduating_seniors.coaching_staff` into a first-class `coaches`
      table for the pilot scope (currently 18 rows, populated lazily on send).
- [ ] Normalise `division` — the table holds both `NCAA D1` and
      `NCAA Division I` today.
- [ ] Add a verified-email flag and last-verified date.
- [ ] **Decide coaches-per-program.** Sending per-coach is deliberate —
      attribution is per (athlete, coach) pair, and a shared link would credit
      one coach's viewing to whoever was in the To field. But it multiplies
      volume 2–3× against the warmup ramp, which is the binding constraint on
      a two-sport pilot. Settle this before fixing the ramp schedule.
- [ ] Handle coaches who staff both the men's and women's programme at one
      school — with both sports in scope, the same person can now receive two
      campaigns. The per-coach cap in §2.3 must be keyed on the person, not
      the (school, sport) pair.

### 2.2 ESP migration
- [ ] Replace the Outlook/AppleScript path with the ESP API; keep Outlook as a
      dev-only fallback.
- [ ] Per-send delivery status recorded against the outreach row. Today "sent"
      means "handed to Outlook" and nothing observes the outcome.
- [ ] Bounce and complaint webhooks → suppression list.
- [ ] Reply detection → auto-flip the `responded` tier, a manual toggle today.

### 2.3 Sequencing
- [ ] Campaign model: campaign → step → recipient, with per-athlete state.
- [ ] A/B/C variants, each differentiated, as promised on slide 4.
- [ ] Three-week schedule with batches of 100 programs.
- [ ] Stop-on-reply: a coach who responds drops out of the remaining steps.
- [ ] Per-coach send cap **across all athletes and both sports** — without it,
      several athletes hitting the same coach will burn the domain.

### 2.4 Compliance
- [ ] Unsubscribe/opt-out honoured across every athlete's campaigns.
- [ ] Physical address and identification in the footer (CAN-SPAM).
- [ ] Privacy line covering coach tracking on the public profile page.

---

## Phase 3 — Pilot

Runs in parallel with Phase 4. Entry criteria: Phases 1 and 2 complete, domain
warmed to cohort-1 volume.

- [ ] **Cohort 1 — men's soccer**, 3–5 athletes, D1–D3. One full three-week
      A/B/C cycle.
- [ ] Deliverability review at each step: delivered, opened, bounced,
      complained — **before** reading any engagement score. A spam-foldered
      email produces zero events and reads as a "cold" coach; the two must
      never be confused.
- [ ] **Cohort 2 — women's soccer**, 3–5 athletes, starting 2–3 weeks behind
      cohort 1 and only if cohort 1's deliverability holds.
- [ ] Review Tab 3 against reality: did the coaches the engine scored hot
      actually engage?
- [ ] Compare the two sports' results — different coach populations and
      different data completeness, so treat them as separate reads, not one
      pooled number.
- [ ] Capture the pilot's engagement data as the training set for Phase 5.

---

## Phase 4 — Pillar 4: Recommendation

Two tracks. The data track has the long lead time and starts in Phase 0.

### 4.1 Data
- [ ] 2024 roster backfill, both sports (started Phase 0) → program turnover.
- [ ] Freshman-minute analysis — **possible from existing data today**: 4,677
      of 7,239 men's and 5,812 of 7,616 women's `Fr.` rows carry
      `minutes_played` (women's grew as roster loading finished).
- [ ] Identify a source for university quality and lifestyle. Currently
      un-sourced; `academic_rating` is the only quality signal in the DB, and
      it is itself incomplete for women's (see Phase 0).

### 4.2 Product
- [ ] Athlete-program match rating combining the above with Pillar 1's score.
- [ ] Program-specific reporting.
- [ ] University quality and lifestyle report per school.
- [ ] Recommendations tab (`/player/:id/recommendations`).

---

## Phase 5 — Post-launch: the learning loop

Slide 3 panel 3, "AI continues to Learn". Deliberately last: it needs the
pilot's real engagement outcomes as its signal. `outreach.match_id` already
links each send back to the recommendation that produced it, so the join
exists — nothing reads it yet.

- [ ] Re-weight the matching model from observed engagement outcomes.
- [ ] Measure whether high-match-score programs actually engage more.
- [ ] Keep the two sports' models separable until there is evidence they
      behave the same way.

---

## Cross-cutting, before go live

- [ ] Backup and restore runbook. Today: ad-hoc `.bak` files beside a 36 MB
      SQLite database on one laptop.
- [ ] Decide where the operator app runs at go live (only the profile pages
      are deployed today).
- [ ] Data retention policy for coach tracking data
      (`ENGAGEMENT_RETENTION_GRACE_DAYS` is 90 — confirm that's the intent).

---

## Deferred past go live

- NAIA and NJCAA, both sports.
- The four non-soccer sports listed in `src/lib/sports.js`.
- Athlete-facing accounts and auth.
