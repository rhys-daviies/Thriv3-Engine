# Thriv3 — Road to Go Live

The single canonical roadmap. Tracks the four pillars of the Thriv3 Engine
deck against what is actually built. Update the checkboxes as work lands; keep
the "verified state" numbers honest by re-running the queries rather than
trusting this file.

Last audited: 2026-08-27, re-verified against the DB and the live edge
(rosters: five seasons 2022-2026 acquired and imported, 264,614 rows; the
graduation-year model now assumes five-year eligibility)
(branch `engagement-tracking`, 775 tests green). Coverage numbers below were
re-run, not copied. The academic-rating gap has closed completely; roster and
grad-year figures moved and are corrected in place.

The backtest figures in §1.2 were re-measured on 2026-08-26 after the 2024
minutes were finally imported, and they moved: the harness had been ranking
with the starter half of roster opportunity switched off, because every 2024
row held `minutes_played = 0`. Recall@10 rose from 28.9% to 34.1% for the men
and 25.3% to 27.2% for the women. **The old table quoted a different sample
and band and is not comparable to the new one** — the parameters are now
stated alongside the numbers so the next run can be.

**Phase 1.2 is complete** as of 2026-08-25 — Pillar 1 now has six weighted
criteria, a coupling layer, an operator ranking control in both the intake
form and the matching tab, and, for the first time, a backtest that says
whether any of it works.

**The trial send has happened, and the loop closed.** At 00:29 on 2026-08-26 a
tracked link was opened from a real inbox and the whole path ran unattended:
two sessions collected at the edge, 13 events synced down with non-null
`remote_id`s, the cursor advanced 6 → 19, and a rollup landed at 5/100, tier
`cold` — correct for a 13% skim. **Pillar 3 is no longer unproven.** The
second session collapsing into the first rather than counting twice is the
30-minute rule working as designed, on real data, for the first time.

What that leaves is a controlled test, not a coach: the recipient was a
mailbox we own. Nothing in the path is unproven any more, but nothing has yet
been read by someone deciding whether to recruit.

---

## Locked decisions

| Decision | Answer | Consequence |
|---|---|---|
| Send architecture | **Outlook drafting. The ESP is off the plan** (revised 2026-08-25) | An ESP sending for many clients pools every client's list reputation into one domain, so one bad list poisons the rest — and a recruiting-service From address is pattern-matched and binned by coaches who have been trained for a decade to ignore exactly that. Both problems are avoided by the client sending from their own mailbox. §2.2 is on hold, not scheduled. |
| Client portal | **Deferred until pilot 1 has run** (decided 2026-08-25) | The likely shape of pilot 2 is a portal where the client reads their own matches and engagement and sends from their own mailbox at their own pace. Deliberately not started: pilot 1 needs no portal, and its results decide whether the portal is worth building. Recorded here so the decision is not re-litigated, not as scheduled work. |
| Product shape at go live | **Single user** (Rhys operates the engine on athletes' behalf) | No auth, no accounts, no athlete-facing UI. Pillar 1's weighting UI is an operator tool, not self-serve. A portal would reverse this — see above — which is most of why it waits for evidence. |
| Pilot scope | **Men's and women's soccer, NCAA D1–D3** | 1,759 active programs, 1,621 with a coach email. NAIA/NJCAA and the four non-soccer sports are out of scope until after go live. |

### Verified coverage in scope

| D1–D3 | Men's | Women's | Total |
|---|---|---|---|
| Active programs | 734 | 1,025 | 1,759 |
| With a coach email | 703 | 918 | 1,621 |
| With a head-coach email | 683 | 891 | 1,574 |
| With 2025 roster data | 725 | 996 | 1,721 |
| Missing academic rating | 0 | 0 | **0** |
| Missing nickname (personalisation) | 36 | 66 | 102 |
| Missing `estimated_graduation_year` rows (2025) | — | — | 1,042 |
| Missing `estimated_graduation_year` rows (2024) | — | — | 2,076 |

Adding women's soccer put two gaps back on the critical path that the men's-only
scope had retired. **The academic-rating gap is now closed** — every in-scope
programme is rated, 1,757 of 1,759 on `scorecard-v1` — so it is no longer a
blocker on anything. **Roster data** remains: 38 in-scope programmes still have
no 2025 roster, and the 2024 season it now sits alongside carries 2,076
grad-year nulls of its own, which the single 2025 figure used to hide.

---

## Progress

**75 of 119 boxes ticked. Five of the 44 open are struck through** — retired
with the sending domain and the ESP — so against live work it is 75 of 114,
**66%**.

The count is deliberately not the headline. Nothing is in front of the pilot:
Phase 1.1 closed on 2026-08-26, and every remaining box is either the pilot
itself or work that only makes sense once it has run.

**Pillar 4 stopped being a data pile and became analysis on 2026-08-27** — the
freshman-minutes ladder and coach tenure both landed, and between them they
answer "will I play here, and does the last four years still describe this
programme". Both are modelling inputs, not pages. Two Pillar 2 gaps closed the
same day: 45 more programmes are now reachable, and the opt-out moved off a
bulk-mail-looking link.

### Pillar by pillar

| Pillar | Progress | State |
|---|---|---|
| **1 · Matchmaking** | ✅✅✅✅✅✅✅✅✅✅ | **Complete.** Six weighted criteria, coupling layer, operator ranking in both UIs, backtested against 1,500 real arrivals per sport |
| **2 · Networking** | ✅✅✅✅✅⬜⬜⬜⬜⬜ | Personalisation, coach table, compliance, bulk drafting and best-contact fallback done — 1,984 of 1,986 programmes reachable. Campaign engine and A/B/C sequencing not started |
| **3 · Interactions** | ✅✅✅✅✅✅✅✅✅⬜ | **Proven on real traffic 2026-08-26.** Only automated reply detection remains |
| **4 · Recommendation** | ✅✅✅✅✅✅⬜⬜⬜⬜ | Five seasons imported (2022–2026, 264,614 rows); retention, **freshman-minutes ladder** and **coach tenure** all built. Lifestyle source and the whole product half outstanding |

### Phase by phase

| Phase | Progress | Boxes |
|---|---|---|
| **0 · Data & lead times** | ✅✅✅✅✅✅✅✅⬜⬜ | 34 done, 8 open (4 struck) |
| **1 · Prove Pillar 3, finish Pillar 1** | ✅✅✅✅✅✅✅✅✅✅ | 27 done, 0 open — **closed** |
| **2 · Campaign engine** | ✅✅✅✅✅⬜⬜⬜⬜⬜ | 11 done, 12 open (1 struck) |
| **3 · Pilot** | ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ | 0 done, 7 open — **next** |
| **4 · Recommendation** | ✅✅✅⬜⬜⬜⬜⬜⬜⬜ | 3 done, 6 open — analysis built, product not started |
| **5 · Learning loop** | ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ | 0 done, 3 open — needs pilot data |
| **Cross-cutting** | ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ | 0 done, 3 open |

## Pillar status at a glance

| Pillar | Deck promise | Verified state | Remaining |
|---|---|---|---|
| 1 · Matchmaking | Athlete-ranked criteria, adaptive re-weighting, top 100 | **Complete.** Six weighted criteria, coupling layer, operator ranking in both UIs, backtested at the 95.8th percentile (men) / 95.2nd (women) against 1,500 real arrivals each | Nothing before go live. The learning loop is Phase 5 and needs real replies |
| 2 · Networking | 3-week A/B/C sequence, 100 programs at a time | Excellent personalisation; coach table, compliance, per-inbox cap and bulk drafting all done. No campaign engine, and no automated send by design | Campaign model, A/B/C variants, sequencing. **Not** an ESP — see locked decisions |
| 3 · Interactions | Tracking, coach score, session timelines | **Proven end to end 2026-08-26** — 13 edge-sourced events, cursor 6 → 19, rollup and tiering correct on real data. Sync automated | Real response detection. Everything else waits on a coach, not on code |
| 4 · Recommendation | Quality/lifestyle reports, freshman minutes, turnover, match rating | Rosters 2022–2026; retention trend, freshman-minutes ladder and coach tenure (6,876 coach-seasons, 84% named) all built | September re-run for the 193 unpublished rosters, real mid-season minutes, lifestyle data source, persist the metrics as model inputs, UI |

---

## Phase 0 — Start today, runs in the background

Calendar lead times, not engineering ones. Nothing downstream compresses if
these start late.

### Sending domain — **retired 2026-08-25**

Deferred on 2026-08-24, and now off the plan entirely. This section existed to
serve an ESP sending from a Thriv3-owned domain; with the client sending from
their own mailbox there is no shared domain to warm, and **the one calendar
dependency in the whole project — three to four weeks of ramp that could not
be compressed or bought — disappears with it.** That is the single largest
schedule effect of the send-architecture decision.

Kept, struck through, rather than deleted: if the portal is ever built with a
Thriv3 send path behind it, this is the checklist that comes back, and the
ramp arithmetic below is the part worth not re-deriving.

One piece survives in reduced form: a portal needs to send password resets and
notifications. That is low-volume transactional mail on a separate subdomain,
a different risk profile, and it is not a blocker on anything today.
- [ ] ~~Register and begin warming a sending **subdomain**~~ (e.g.
      `send.striv3.com`), not the root — a reputation problem must not be able
      to poison `striv3.com` mail.
- [ ] ~~Configure SPF, DKIM, DMARC before the first send.~~
- [ ] ~~**Ramp target.**~~ Retained for the arithmetic: two sports doubles the pilot: 6–10 athletes × 100
      programs × 3 emails ≈ 3,000 sends over three weeks — roughly 140/day at
      one coach per program, ~285/day at two. That is beyond a comfortable
      3–4 week ramp.
- [ ] **Stagger the cohorts** — still worth doing, for deliverability evidence rather than for the ramp: men's cohort
      sends first, women's cohort starts 2–3 weeks later. Halves peak daily
      volume and gives cohort 1's deliverability data before cohort 2 sends a
      single email.
- [ ] ~~**Choose the ESP, checking cold-outreach policy first.**~~ Dropped;
      see locked decisions. The reason it was flagged still stands and is why
      the decision was not close: several
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
      `~/Documents/Thriv3/2024 Roster Sheets/`, **52,539 player rows from 1,717
      of 1,722 school-sports (99.7%)** as of 2026-08-25. Verified rather than
      assumed: the headers match the 2025 files byte for byte, 99% of rows carry
      a class year, and the graduation-year convention is the intended
      season-relative one (Fr.→2029, Sr.→2026), so a player scores the same in
      both seasons and the turnover diff holds. Each of the 5 remaining failures
      carries a reason: Alcorn State W, Virginia W, Wyoming W, Alverno College W,
      Notre Dame of Maryland W — all sites that no longer serve a 2024 roster and
      have no snapshot of one.

      The denominator moved because **the worklist was itself incomplete**: 18
      school-sports existed in the 2025 files but had never been listed in
      `_targets.csv`, so nothing was even trying to acquire them. All 18 were
      picked up from their live 2024 season pages. Three of those 18 then turned
      out to be the *same* programmes under the other sport's spelling and were
      removed, which is why 1,725 became 1,722.
- [x] **Imported both seasons.** `importRosterSheets.js` takes `--season` and
      `--dir`, and skips a division file that is not present rather than
      failing — the 2024 acquisition was scoped to D1–D3, and a missing NAIA
      file is a fact about scope, not an error.
      **roster_players now holds 52,539 rows for 2024 and 64,381 for 2025
      (re-imported 2026-08-25 from the corrected files), and 1,717 in-scope
      school-sports have both seasons — turnover is computable for the first
      time.** The 2025 figure includes NAIA, which is out of scope for 2024;
      the NCAA-only counts are 52,539 and 52,232.

      Reading `roster_players` now requires filtering by season. Every query
      was written when only 2025 existed and filtered by sport alone, so each
      one silently mixed both years the moment 2024 landed — a spot-check of
      North Central College returned 65 rows for a 35-player squad. Pinned via
      `CURRENT_ROSTER_SEASON` in `src/pages/GraduatingDatabase.jsx` and
      `src/lib/playerAnalysis.js`. Anything new built on the table needs the
      same filter; single-season is no longer a safe assumption.

      Importing exposed a defect the class-year guard could not see, because
      it only ever inspected the class column: four D1 women's programmes had
      their *jersey* column read as the player name, giving 120 players called
      "Jersey Number 9". They wreck the metric they feed rather than merely
      adding bad rows — a placeholder can never match a real name next season,
      so Akron's women showed 60 departures from a 25-player squad. A name
      guard now drops them loudly and `server/lib/rosterName.js` is tested.
      **All four are now fixed at source rather than marked failed** — the cause
      was a card parser reading the jersey badge when a page rendered no name
      element, and the same rewrite recovered Akron (33), Cincinnati (32),
      Penn State (33) and San Jose State (31) as real rosters. No row in either
      season now contains a jersey placeholder.
      Turnover reads 42.8%, and the name-matching error behind it has now been
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

      So **42.8% turnover is essentially real**, and the metric is sound
      enough to build on. Measuring it also turned up two more name-column
      defects, both now cleaned at import and tested: 118 schools prefix
      captains with a bare "C" (324 rows, 67 with an exact clean twin the
      following season), and 101 rows at three programmes repeat the whole
      name, "Trevor Rau Trevor Rau". Fixing those cut the edit-distance tier
      from 83 to 20.

      **All six defect shapes are now also fixed in the source CSVs**, so the
      import guards are a safety net rather than the only defence — a second
      consumer of these files would otherwise have to rediscover every one.
      Both seasons now read zero for jersey placeholders, captain prefixes,
      whole-name doubling and trailing-surname doubling. Two shapes needed a
      tighter rule than the guards use:

      A doubled name is only collapsed when the repeated unit is two tokens or
      more. **A two-token repeat is usually a real name**, and collapsing it
      leaves a single word — Drake's Deng Deng, Liberty's Gora Gora and
      Geneva's Ojha Ojha are all real players, and Ojha carries 228 minutes
      across 12 games in 2025 and appears in 2024 from the same town. An
      earlier pass here deleted three of them as placeholders on name shape
      alone and had to restore them; the only genuine placeholder in either
      season was Ferrum's "Team Team", which had no class, position, hometown
      or playing time either. Shape was the weaker signal.

      Surname-first storage is the mirror of the captain prefix and cost more:
      Idaho held 130 names as "Rodgers, Sara" while 2024 and every other school
      use "Sara Rodgers", so Idaho read as 100% turnover. A comma is not
      reliably an inversion, though — Emory & Henry's "Cesar Tobar Monge, Jr."
      is a suffix, and is left alone.
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

      Across **1,712** in-scope programmes with at least 10 players who could
      return: median **75%**, p10 53%, p90 93%. A 40-point spread between the
      deciles, so it genuinely discriminates rather than describing everyone
      the same way. It also behaves as reality would predict — D3 retains at
      79% against D1's 73% — which is evidence it is measuring something real
      rather than reflecting scrape quality.

      Recomputed 2026-08-25 after the source-level name and roster fixes, and
      **the centre did not move**: same 75% median, same 53% p10, same D3-over-D1
      ordering, across 43 more programmes. That is the useful result. Repairing
      six truncated rosters, 475 mismatched names and three duplicated school
      rows changed the population the metric is measured over without changing
      what it says, which is the behaviour you want from a signal you are about
      to build a product on — the earlier number was not an artefact of the
      defects.
- [ ] **Persist retention per programme-season as a modelling input.**
      Decided 2026-08-26: retention is a **feature for the Pillar 4 regression
      models and derived calculations, not a figure to display**. It does not
      need a place on the match card, and earlier versions of this entry
      framing "still a query, not a column" as a product gap were reading it
      wrong — do not re-raise it as one.

      What it does need is to be computable and stable: persisted per
      programme-season so a model trains on a fixed input rather than
      whatever the query returns that day, carrying its own denominator so a
      regression can weight "75% of 8" below "75% of 30" rather than treating
      them alike, and versioned alongside the name-guard fixes that move it.
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
spread is real — p10 53% against p90 93% — but attributing a given programme's
place in it needs a trend.

**Done — four seasons (2022–2025) plus the live 2026 are held.** The pipeline
now lives at `~/Documents/Thriv3/_roster_pipeline/` with a README, state under
`<season> Roster Sheets/_state/` and its page cache in `~/Library/Caches/`. It
used to live in a session scratchpad, which was deleted mid-run on 2026-08-26
and took an 11,000-page cache and 1,475 resolved programmes with it; the code
survived only because every file had been written by a shell heredoc the
transcript recorded. Nothing load-bearing goes in a scratchpad.

- [x] **Finished the 2024 acquisition.** 2026-08-25. 46 failures down to **5**,
      and the 4 jersey-column programmes fixed at source rather than re-scraped.
      Extending backwards over an incomplete 2024 would have compounded the gap
      rather than averaging it out, so this was the gate — it is now clear.

      The five that remain are not retryable by the same pipeline: Alcorn State
      W, Virginia W, Wyoming W, Alverno College W and Notre Dame of Maryland W
      each serve only the current season and have no archived 2024 page. Alcorn
      State is the instructive one — snapshots exist inside the 2024 window and
      all of them still show the 2023 roster, so the programme never published a
      2024 one. Worth expecting a few of these per season going back, rather
      than treating a gap as a scraper failure.
- [x] **2023 and 2022 acquired — four seasons now held.** 2026-08-25.
      **2023: 51,104 rows. 2022: 50,560 rows from 1,710 of 1,722 school-sports
      (99.3%).** Both pass the full validation battery.

      **The Wayback prediction was wrong, and instructively so.** The archive
      contributed *nothing* to either season — 0 of 1,722 twice. What actually
      degrades going back is anything that relies on a live site to *expose* its
      own history: live URL variants fell to 46%, and the season-selector
      dropdown returned **0 of 81** because the menus do not reach back four
      years. The plain year-swap held at **99.8%**, because it reuses a URL
      verified days earlier rather than one recorded a year ago. The browser
      picked up the rest: those pages exist, they just do not advertise
      themselves. Sourcing strategy should follow that — freshness of the URL
      matters more than age of the season.

      Four independent scrapes landing within 10 minutes of each other on median
      playing time (625 / 621 / 615 / 615) is the strongest evidence yet that the
      pipeline measures reality rather than its own artefacts.

      Two things from 2024 worth carrying forward. **Wayback was needed far
      less than predicted** — the worklist marked 298 school-sports as
      archive-only and in the end only **34** were, because a live season path
      almost always existed once you stopped trusting the recorded URL: the
      sport slug is often not the one on file (LSU serves soccer under
      `/sports/sc`, Auburn and Purdue under `/sports/soccer`), and appending
      `?view=table` renders a parseable table on most client-side rosters. Final
      sourcing was 1,273 direct year-swaps, 307 other live URL forms, 53
      browser-rendered, 34 Wayback, 28 discovered from scratch, and a handful
      via season selectors and player bio links.

      And **regenerate the worklist from the roster files, not from the
      previous worklist** — the 2024 one was missing 18 school-sports that
      existed in the 2025 files, which no amount of retrying would have found.
- [x] **Three retention pairs measured; the trend is now available.**
      2026-08-25. 22→23 overall 61.2% (eligible median 74%), 23→24 62.3% (76%),
      24→25 57.2% (74%). **1,284 programmes have all three pairs measurable**,
      which does the thing one pair cannot: **37 sit below 60% in all three
      years** — a characteristic, not a bad season — and **100 stay above 85%**
      throughout. The widest single-programme swing is Hardin-Simmons at 96
      points, exactly the case a single pair would have misread as a verdict.
- [ ] **Report the trend on the match card / in the model.** The three pairs
      exist; nothing consumes them yet. Per the entry above, retention is a
      modelling input rather than a displayed figure, so this is the persistence
      and weighting work, not a UI task.
- [x] **2026 rosters acquired mid-season — the current season is now readable.**
      2026-08-26. **1,529 of 1,722 school-sports, 46,028 players**, in
      `~/Documents/Thriv3/2026 Roster Sheets/`, all checks passing. Rosters,
      positions, nationality and hometown only: the season is unplayed, so the
      playing-time columns are empty *and the validator asserts they are empty*
      rather than merely not filling them. Minutes are a post-season job.

      **A live season cannot be verified the way a backfill is.** A backfill can
      demand the page name its season, because it is asking for an archived view
      the site labels. The live page usually carries no year at all — it is the
      only roster there is. So the season is proved from the data instead: the
      squad must have turned over. Calibrated on the three pairs above, a genuine
      new roster repeats **under 85%** of last season's names at p99, while a
      stale page scores ~100%. The 2026 field lands at p50 0.59, p90 0.74, p99
      0.82 — indistinguishable from the known-good pairs.

      Three findings worth keeping. **A page's own season label is not evidence**:
      40 stale rosters passed because the title said 2026 while the content was
      2025 — sites flip the label and URL before swapping the roster. **A gate
      must measure the rows it ships**: computing turnover on the raw parse
      included coaching staff, who never appear in the reference *player* list
      and so always counted as new names, running 20% of programmes low by up to
      33 points. And **the player filter must exist once** — it was written in
      both `build()` and `overlap()`, the copies drifted, and five more slipped
      through after the first two fixes. `run._players()` is now the single
      source of truth.

      The distinction that matters most for Pillar 4: among rosters repeating
      ~100% of last season, **8 were stale pages but 38 were real 2026 pages
      listing only returners**, intake not yet posted. Shipped, those would have
      recorded 100% retention with zero recruitment — corrupting the exact metric
      this data feeds. Both are excluded and carry their reason.

      **182 of the 193 gaps are a calendar problem, not a technique one** (159 in
      D3, which posts in September); genuine technique residue is 8 rows, 0.5%.
      Re-run in September for the rest. Notes in
      `2026 Roster Sheets/_2026_run_notes.md`.
- [x] **All five seasons are in `roster_players` — 264,614 rows.** 2026-08-27.
      2022 (50,559), 2023 (51,104), 2024 (52,539), 2025 (64,384), 2026 (46,028).
      The trend is now computable inside the product rather than only from the
      files.
- [x] **Unknown minutes are stored as NULL, not 0.** The importer collapsed an
      empty cell to zero, so a season not yet played read as every player on
      zero — a non-starter rather than an unknown. That is the wrong signal for
      the half of matching that reads playing time, and it also recovered
      6,000-9,000 rows in *each* earlier season that were never published and
      were being counted as "played none".
- [x] **An impossible graduation year is rejected at import.** A rostered player
      has not graduated yet, so a year at or before the season cannot be right.
      66 rows carried one — 63 from a cross-season inference that propagated an
      old value onto a still-enrolled player, 3 printed by the site itself — and
      they created a phantom cohort in the Graduating DB ("2024, 2 schools
      graduating"). The guard covers the derived value too, since the
      explicit-year path reads straight through.
- [x] **The Graduating Database runs on 2026.** 2026-08-27. Defaults to the
      cohort leaving after the pinned season rather than the earliest year on
      record, which had been landing the operator on a near-empty bucket of
      stragglers. The 193 school-sports with no 2026 roster are absent rather
      than back-filled from 2025: a 2025 row belongs to a different graduating
      cohort and would land in the wrong year bucket.
- [x] **`estimated_graduation_year` models five-year eligibility.** 2026-08-27.
      The column is a MATCH KEY, not a biography: `recruiting_class_year` is
      "the year this recruit would join as a freshman" and `pool.js` matches it
      on exact equality, so what the column has to name is the year the
      incumbent's spot OPENS — the year after their last season.

      | class | last season | spot opens |
      |---|---|---|
      | Fr. / Fy. / R-Fr.† | season+4 | **season+5** |
      | So. / R-So.† | season+3 | **season+4** |
      | Jr. / R-Jr.† | season+2 | **season+3** |
      | Sr. | season+1 | **season+2** |
      | Gr. / 5th / R-Sr. | season+0 | **season+1** |

      † A redshirt advances one class, because the redshirt year is one of
      the five whether or not it was played. R-Fr. therefore sits with So.,
      R-So. with Jr., R-Jr. with Sr. Stripping the prefix and reading the class
      underneath counted that year twice. This also subsumed a hand-written
      R-Sr. exception that had been reading one year from SENIOR and the other
      from GRADUATE, putting it at "last season 2026, graduating 2028".

      **The historical evidence points the other way and is kept in the code**,
      because any backtest will keep reproducing it: the four-season offsets
      predicted the year a spot actually opened for 55-79% of sophomores,
      juniors and seniors against 4-20% for these; only 7.9% of 2025 seniors
      appeared on a 2026 roster; and no roster printing a graduation year
      outright prints season+5. All of it describes a regime in which a senior
      was **not permitted** to return and only a redshirt senior was — a supply
      constraint, not a preference — so none of it predicts behaviour now the
      fifth year is generally available. Deliberate call, recorded so it is not
      re-litigated as a defect. `eligibility_end_year` holds the last season, and
      a test asserts the two stay exactly one apart.
- [x] **Minutes are carried forward as a labelled projection until the season is
      played.** 2026-08-27. 2026 has no minutes, so nothing can say who clears
      the 600-minute starter threshold. `projected_minutes` carries the prior
      season's figure at a **450** cutoff — measured, not chosen: on 2024→2025
      across 25,653 players, 600 is 80.6% precise but recalls only 65.9%, while
      450 on the graduating cohort gives 80.0%/80.3%. Coverage is 80.5% of the
      graduating cohort against 54.7% of the whole roster, because departing
      players have history and newcomers do not.

      It is never dressed up as current data: its own column beside its source
      season, amber italic with a `~` against emerald for a real figure, and a
      banner on the page so nobody has to hover to learn the number is last
      year's. Real minutes always win, so a mid-season scrape supersedes it per
      player with no cleanup step.
- [x] **The matcher reads the projection too, and the backtest decided that.**
      `(minutes_played || 0) >= STARTER_MINUTES` read an ABSENT figure as zero,
      so every 2026 departure became squad and the opportunity signal stopped
      weighting departures by quality and started counting them — a reordering
      that favoured programmes with many low-minute departures. Settled with a
      new `--minutes real|hidden|projected` flag on the backtest, which
      simulates an unplayed season on 2024→2025 where "real" is a measurable
      ceiling. Across two sports and two seeds the projection recovers 60-90% of
      the r@10 gap and 78-110% of the MRR gap, and `hidden` was worst in all
      four runs. The effect is invisible in the median percentile — the starter
      split decides the top of the list, which is the part an operator reads.
- [x] **A blank minutes cell says why it is blank.** `prior_programme` records
      where each player was the season before — 29,143 of the 46,028 2026 rows
      located, 3,524 of them at a different programme — so the view distinguishes
      a transfer from a newcomer from a roster that published no minutes. Their
      minutes are provenance only and deliberately not carried forward: prior
      minutes predict a 600+ season at 77.4% precision for a player who stayed
      but **54.9%** for one who moved, so filling those cells would have made
      the screen look more complete and be less trustworthy. Names not unique to
      one prior programme are skipped, because "transferred from X" has to be
      right.
- [ ] **Re-run the 2026 acquisition in September**, then import. 182 of the 193
      gaps are a calendar problem — schools, overwhelmingly D3, that had not
      posted a roster in August. The genuine technique residue is 8 rows, 0.5%.
      Nothing needs unwinding first: projections only fill rows where
      `minutes_played IS NULL`, so real data supersedes them per player, and the
      in-progress banner is derived from the rows rather than a flag.
- [x] **Reconciled the 5 division-mismatched ratings**, leaving 318 genuinely
      absent. Copying from the men's row is not available: only 5 of the 323
      have a men's counterpart at all, because most of the gap is SEC/Big 12
      schools that sponsor women's soccer and no men's programme.
- [x] **Established what the academic scale was: 70% US News, 30% Niche.**
      Recorded here because nothing in the code said so — there is no
      generator for `academic_scores.json` and the code calls the ratings
      "LLM-sourced", which is wrong. The blend was deliberate: US News for the
      official view, Niche for the student-reported one.

      **Superseded 2026-08-25.** Niche is dropped and the US News rank is no
      longer the driver — see the Scorecard entry below. Niche's Academics
      grade is largely recomputed from the same federal inputs, so it is a
      re-weighting rather than a second opinion; the genuinely independent
      part of Niche is its student reviews, which measure experience, not
      academic strength. (The scraping route does work, for the record: Niche
      403s a fetch but loads normally when a browser tab is navigated to it.)

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
- [x] **Built the academic rating on College Scorecard, not on the rank.**
      Decided 2026-08-25. The US News rank cannot be used directly and no
      per-category curve can fix it: #1 Regional Colleges South is the top of
      an 84-school pool of teaching colleges and #1 National Universities the
      top of a 434-school pool of research universities, so ranking a school
      against its Carnegie peers says nothing about where those peers sit.
      The category sizes come from the tier-band ceilings themselves —
      `#395-434` is the last band in National Universities.

      **Freshman retention was tried first and rejected.** It tracks the rank
      at -0.70 to -0.93 inside every category, which made it tempting, but US
      News's own label for it is "an indicator of student satisfaction". That
      belongs in a campus-experience measure, not an academic one. (It is
      institution-wide, not a sports figure — the sport-specific retention is
      the separate Pillar 4 roster metric.)

      What replaced it is **College Scorecard**, the federal IPEDS release
      that US News and Niche are both built on. It is keyed on UNITID, so the
      wrong-school join cannot happen the way it does on a URL slug, and it
      carries the inputs a ranking is computed FROM, so the weighting can be
      chosen for what this product means by academic strength rather than
      inherited from US News's view of social mobility and alumni giving.

      Three legs, none of them category-normalised:

      | leg | weight | inputs | coverage |
      |---|---|---|---|
      | intake calibre | 40% | SAT (Scorecard average, else US News range midpoint) | 82% |
      | academic resources | 35% | instructional spend/student, full-time faculty rate, endowment/student, class size | 96-100% |
      | outcome | 25% | six-year graduation rate | 100% |

      Excluded, each for a measured reason: **acceptance rate** swings from
      +0.76 to -0.03 against the rank depending on category, because it
      measures who chose to apply — Cal Poly Pomona admits 74% and is #3 in
      its category. **Earnings** track the mix of majors, not strength:
      Rose-Hulman $101k against Williams $88k says "engineering school".

      **All 1,029 institutions score, with no nulls** — which matters because
      `academic_rating` is a hard filter in `playerAnalysis.js`, so a null
      removes a school from matching entirely. A school missing a leg
      re-weights the others rather than scoring zero; `legs_used` records
      which, and the 184 schools with no SAT anywhere score *lower* on median
      (4.1 against 5.5), so the re-weighting is not inflating them.

      **The rank became the test instead of the input.** Spearman of the score
      against the US News order, inside each category: National Universities
      -0.87, National Liberal Arts -0.94, Regional Universities N/MW/S/W
      -0.73/-0.74/-0.80/-0.64, Regional Colleges S/N/MW -0.60/-0.67/-0.79. It
      reproduces US News's own ordering within every peer group and then
      extends across them.

      The old column was worse than "unsourced". Northwestern State
      (Natchitoches LA, SAT 1088, 43% graduation) carried **9.8** — which is
      Northwestern University's score. 271 of 1,018 ratings move by more than
      2 points, 26 by more than 4.

      **Loaded into the database 2026-08-25.** `node
      server/scripts/loadAcademicRatings.js --apply` wrote 1,757 rows —
      318 of them a first rating — matching exactly on `(name, sport)` and
      nothing else, because every corruption this column has suffered came
      from a matcher willing to guess. **All 1,762 NCAA D1/D2/D3 rows are now
      rated**, source `scorecard-v1`; five are deliberately untouched (Simon
      Fraser twice, three inactive placeholders). Divisional means come out
      D1 6.18, D3 5.95, D2 4.03 — the D1/D3 pattern that was assumed is real,
      and D2 sits well below both.
- [x] **Rated NAIA and NJCAA the same way.** 2026-08-25. 507 of 513 names
      matched to a UNITID and 631 rows written, 227 of them a first rating.
      Both wrong-school leftovers are gone: **Columbia College Missouri 10.0
      -> 3.7** (it had Columbia University's score) and **Lewis-Clark State
      8.5 -> 3.4** (it had Lewis & Clark College Oregon's). Whole-product
      academic order now reads MIT, Duke, Stanford, Princeton, Harvard.

      These rows carry no location — `colleges` has only name and conference
      for them — so the name had to carry the join. Three things made that
      work: **our own parenthetical is the disambiguator** ("Bethany (KS)",
      "Concordia (MI)") and was parsed as a state filter; **exact beats
      normalised**, since "Benedictine College" matches Atchison KS exactly
      and Lisle IL only after normalising; and our name is often a **prefix**
      of the legal one ("Blinn" for "Blinn College District"), which cannot
      swap the identifying word the way a subset test can. 50 names no rule
      resolved are an explicit hand-verified map, and 6 have no Scorecard
      entry at all — two closed in 2023-24, one is a branch campus, one is
      genuinely ambiguous between three Wallace colleges in the same
      conference.

      **One bug worth remembering.** The state hint was written as a
      preference rather than a rule: when no candidate sat in the named state
      the code fell back to the unfiltered list, which is how "Lewis & Clark
      (ID)" reached Portland Oregon *while reporting that it had used the
      state*. No candidate in the named state is a failure, not a licence to
      look elsewhere. Fixing it also corrected four other rows.

      **NJCAA is a substitution and is labelled as one.** Junior colleges have
      no SAT and no admission rate — 0% of them — and their completion figure
      is a different quantity: the share finishing an associate degree in
      three years, not a bachelor's in six. They are scored on resources plus
      that rate, under `academic_rating_source = 'scorecard-njcaa-v1'` rather
      than `scorecard-v1`, so the substitution stays visible in the column.
      Read a junior-college rating as "resources and completion on a two-year
      basis", not as the same quantity as a university's.

      Divisional means now: D1 6.18, D3 5.95, D2 4.03, NAIA 3.46, NJCAA 2.36.
      3 rows are still unrated, all NAIA schools with no Scorecard entry.

- [x] **The 9 schools outside the US News taxonomy are solved by the same
      change.** They never needed a category: Rose-Hulman scores 8.8 on SAT
      1427 and a 78% graduation rate, Babson 9.1, Pratt 7.2, Menlo 4.6. Only
      **Simon Fraser** is still unrated — it is in Burnaby BC and Scorecard is
      a US release, so it needs a Canadian source (Maclean's).

- [x] **Tier bands stopped mattering.** They are not inputs to the score,
      only to the validation, where the midpoint is used and stated.

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
- [ ] **`estimated_graduation_year` nulls — 2,160 rows across both seasons,
      and it is a scrape, not a mapping fix.** Re-counted 2026-08-25 after the
      class-year fix: **1,522 in 2025 and 638 in 2024**. (The 3,118 this item
      used to claim was stale — the 2025 sheets have been re-imported since.)
      Turnover and retention are diffs across the pair, so a null on either
      side drops that player from the metric; the 2024 half matters exactly as
      much even though it is now the smaller one.

      Mapping cannot reach any of it. **2,112 of the 2,160 have no
      `class_year_label` at all**, so there is nothing to convert from, and a
      check of the source sheets confirms no row carries a graduation year
      without also carrying a class — the sheet's `Estimated Graduation`
      column was always derived from the label, never scraped independently.
      The remaining 48 have a label the reader deliberately refuses (club
      names, bare redshirt markers). Only a re-scrape moves this number.

      It splits cleanly into a cheap half and an expensive one. **32
      school-seasons have no usable class year on any player** — Texas Tech
      among them, its whole 30-player roster — and those 947 rows are one
      re-scrape each. The other **1,213 are scattered across 444
      school-seasons**, a handful of rows at a time. That tail is the one
      worth timeboxing rather than finishing.
- [ ] **Nicknames — 102 programs** (36 men's, 66 women's). Cheapest and least
      urgent; personalisation quality, not a blocker, and the template falls
      back cleanly. Fill in the gaps between the jobs above.

### Newly discovered, and fixed 2026-08-25
- [x] **Every roster row's `estimated_graduation_year` was a year late.**
      `YEARS_TO_GRADUATE` counted a senior as two years from graduating, so
      all 116,920 rows named the wrong class and every recruit was matched
      against the wrong cohort. It is why retention could not be measured and
      why roster opportunity, when first backtested, scored *worse than
      knowing nothing*. Two checks caught it: 91.4% of players labelled "Sr."
      on a 2024 roster are absent from the 2025 roster, and rosters that print
      an explicit year spanned 2026–2029 for fall 2025 where the derived
      values spanned 2027–2030. All 21 existing tests passed throughout —
      they had been written against the conversion itself. Fixed in
      `classYear.js`, 109,886 rows re-derived by `refreshGraduationYears.js`,
      and pinned by a concordance test against the years rosters print
      literally. `importRosterSheets.js` also stopped preferring the sheet's
      own `Estimated Graduation` column, which held exactly the old wrong
      values and would have restored the bug on the next import.
      **Anything computed from turnover or retention before this date is
      wrong and needs re-running.** Full detail in Phase 1.2.

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
- [x] **Handle null academic ratings in `playerAnalysis.js`** rather than
      waiting for the backfill. The filter at `playerAnalysis.js:51` dropped
      every null-rated school silently, so a third of women's programmes went
      invisible whenever an athlete set academic importance. Closed by the
      Phase 1.2 rebuild rather than by patching the filter: academic
      importance became a *weight*, so nothing filters on `academic_rating`
      at all now, and an unrated school scores at the neutral prior with
      `confidence: 'assumed'` and a greyed bar on the card. The failure mode
      this item was guarding against — one unrated school silently vanishing —
      is no longer expressible.

---

## Phase 1 — Prove Pillar 3, finish Pillar 1

Cheapest high-information work. Do not start Phase 2 before task 1.1 passes.

### 1.1 Prove the tracking loop end to end — **closed 2026-08-26**
The path *published profile → real inbox → open → D1 → sync → rollup → Tab 3*
has now carried a genuine visit. Of 103 events in the database, **13 carry a
non-null `remote_id`** and came back from the edge rather than from the
simulator.

Superseded framing, kept for the record: this section previously read "the
pillar is validated entirely by simulator output" and called itself the only
thing standing between here and pilot 1. Both were true until 2026-08-26.

The state either side of the path, re-verified 2026-08-25 and unchanged
except where noted:

| | |
|---|---|
| `npm run trial:preflight` | **16 of 16 pass** — "Ready. Nothing blocking the trial send." |
| Trial athlete | Rhys Davies, published 2026-08-20, `/p/YMUlxdzGBw` |
| Tracked link | resolves live, 22,191 bytes of profile |
| Unknown token | refused with the neutral page, as designed |
| Token allowlist | 22 live at the edge, in sync |
| Delete guard | locked, no unlock window open |
| Event cursor | **19** — advanced by the trial, in step with the edge |
| Sync | scheduled every 15 minutes while the server runs |
| Compliance footer | identity and postal address set; refuses to send without them |

Send was pressed, and what arrived is recorded below.

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
- [x] **Sent one tracked link to a mailbox we control.** Outreach
      `01fa00f2`, athlete Ryan Billings, recipient a controlled test contact
      at an external domain, sent 2026-08-26T00:26:11Z.
- [x] **Confirmed the whole path.** Opened three minutes later. Two sessions,
      13 events — `visit_start`, `visit_qualified`, `play_start`,
      `coverage_10`, four `pause`, `session_end` — all synced down carrying
      edge `remote_id`s 7–19, and the cursor moved 6 → 19. The rollup reads
      1 qualified visit, best coverage 13%, 52 watched seconds, score 5,
      tier `cold`.

      **Two behaviours were verified rather than assumed.** The score being
      low is correct: a 13% skim *should* read cold, and a system that
      flattered it would be worse than useless. And the two sessions
      collapsing to one qualified visit is the 30-minute rule working on real
      data — they were 59 seconds apart, so they are one visit, not a return.
      Returning is what the score weights most heavily, so that gate mattering
      in production is the single most important thing this trial proved.
- [x] **Nothing needed fixing.** The trial exposed no defect — which is the
      expected outcome of the four repairs above having landed first, not
      evidence that the path was fine all along. It was not: on 2026-08-24
      this same send would have returned the neutral page.
- [x] **Automated the sync** — `server/lib/syncScheduler.js`, started at boot,
      cadence from `THRIV3_SYNC_INTERVAL_MINUTES`. A timer inside the server
      rather than launchd or cron: it runs whenever the app runs, needs no
      install, and cannot drift out of step with the code. The trade is stated
      rather than assumed — **nothing syncs while the server is stopped** — so
      `/api/engagement/sync/status` reports `minutesSinceSuccess`, where null
      means *never* rather than *a while ago*.

      Runs never overlap (a sync slower than the interval would stack up runs
      fighting over one cursor), failures are held and re-thrown rather than
      swallowed, and three in a row back the interval off to a cap of 8×. Both
      conditions that hid the August failure are logged loudly: a token count
      the edge disagrees with, and an opt-out that cannot be matched to a
      coach. **The server says at boot whether it is scheduled**, because
      silence about it is what let "nothing schedules the sync" stay true for
      four days.

### 1.2 Pillar 1 weighting model — **complete**
Replaced the hardcoded constants in `src/lib/playerAnalysis.js`
(ability ≤70, academic ≤15, starters ×5, position ×2) with six weighted
criteria in `shared/matching/`, scored 0..1 each and combined by weights that
sum to 1. The scoring is shared code, not client code, because
`server/lib/matchingBacktest.js` has to run the *same* functions over real
outcomes — a harness that scored differently would measure nothing.

**The model is now measured rather than asserted.** `npm run backtest` ranks
real 2025 arrivals per sport (an athlete on a 2025 roster who was not on that
school's 2024 roster) using only 2024 data, and reports where their actual
school landed.

Re-measured 2026-08-26, at the parameters the script now ships with —
`--sample 1500 --band 20 --seed 20260825`, reported from section B, where
athletic fit is near-constant so the ordering is decided by roster
opportunity and geography. **The previous table on this line quoted 600
arrivals in a ±5 band and is not comparable**; the numbers below are what a
plain `npm run backtest` reproduces today.

| | median %ile | recall@10 | recall@25 | MRR |
|---|---|---|---|---|
| chance, men's | 50.2% | 2.1% | 4.7% | 0.0141 |
| old model, men's | 88.8% | 10.4% | 23.4% | 0.0489 |
| **new model, men's** | **95.8%** | **34.1%** | **49.9%** | **0.1663** |
| chance, women's | 48.0% | 1.0% | 3.3% | 0.0088 |
| old model, women's | 88.1% | 8.3% | 19.2% | 0.0379 |
| **new model, women's** | **95.2%** | **27.2%** | **44.1%** | **0.1332** |

Read the header comment in `server/lib/matchingBacktest.js` before quoting
those: two criteria cannot be tested by this method at all and one is
circular. It is a floor on quality, not a definition of it.

#### The harness was measuring roster opportunity with half of it switched off

Found 2026-08-26 while consolidating the starter threshold. The backtest
reads the **2024** season, and every one of its 52,539 rows held
`minutes_played = 0` — not null, zero, maximum zero, with `games_played` and
`games_started` null throughout. So every 2024 player classified as squad,
never as a starter, and `rosterOpportunity` only ever applied its ×0.4 squad
weight. Changing the starter threshold from 900 to 600 produced *byte-
identical* backtest output, which is what exposed it.

The cause was not code. The 2024 CSVs in `~/Documents/Thriv3/2024 Roster
Sheets/` carry `Total Minutes Played`, the importer maps that column
correctly, and the two seasons' headers are identical — but the import ran
2026-08-24 20:09 and the minutes were written to those files 2026-08-25
17:19, twenty-one hours later. Nothing re-imported. The same shape as the
defect recorded in `importRosterSheets.js`'s own header, one step further
down the pipeline.

Re-imported 2026-08-26 after a `VACUUM INTO` backup
(`recruitmatch.sqlite.bak-pre-2024-minutes-reimport`). 52,539 rows in, same
count out; 38,976 now carry minutes and 49,052 carry games. Verified that
nothing else moved — row counts, school counts, unknown positions and null
grad years all identical, and a row-level comparison of all 52,539 grad years
found zero changes.

What it bought, section B, before → after:

| | men's | women's |
|---|---|---|
| recall@10 | 28.9% → **34.1%** | 25.3% → **27.2%** |
| MRR | 0.1341 → **0.1663** | 0.1199 → **0.1332** |
| recall@25 | 48.7% → 49.9% | 43.9% → 44.1% |
| median %ile | 96.1% → 95.8% | 95.4% → 95.2% |
| recall@100 | 80.1% → 79.3% | 75.5% → 72.7% |

A real trade, consistent across both sports: with genuine minutes the model
is markedly better at the **top** of the list — a 24% MRR gain and five
points of recall@10 for the men — and slightly worse in the tail. The top is
what a top-20 outreach list draws from, so this is the half worth having.

No product effect: the app ranks on the 2025 season, and 2024 is read by the
harness alone. Both athletes' live rankings are byte-identical.

- [x] Persist per-athlete criterion weights on the player record —
      `players.match_weights`, JSON, null meaning "use the defaults".
- [x] Score **scholarship needs** — `budget_range` was collected and never
      read. Scored against Scorecard *net price* (not sticker tuition, which
      at a well-endowed private school is routinely double what anyone pays).
      **Budget is a guideline, not a gate**, and the benchmark is not the
      average: this product exists to find awards well above average, so
      affordability prices what a *priority signing* could command rather than
      the squad mean, scaled by how far above a programme's level the athlete
      sits. The same D1 school scores 0.33 for a marginal recruit and 0.60 for
      one 25 points above its level, because the expected award moves from 33%
      to 75%. The sub-score never reaches zero — a school beyond the stated
      budget is exactly the school a scholarship exists to make reachable — so
      cost tilts the ranking and removes nothing.
      Concretely, for an athlete needing a full scholarship this took NJCAA
      from 0 to 9 of the top 20 with no change to their stated priorities,
      and moved a $40,007 D3 option from 3rd to 7th with its affordability at
      the floor and an explicit "no athletic scholarships" caveat attached.
- [x] Score **state/geography** — `city`/`state` were collected and never
      read, and `colleges.location` was empty on all 2,374 rows so there was
      nothing to compare them against. Backfilled city/state/lat/lon from
      Scorecard on UNITID (99% coverage, `loadMatchingInputs.js`), scored as
      distance from the athlete's state centroid. This turned out to be the
      single most underweighted thing in the model: **50.4% of men and 45.8%
      of women enrol in their home state**, median 145–165 miles from home.
      The criterion has two halves — see the international item below, which
      is the same question asked of an athlete for whom distance says nothing.
- [x] **Handle null academic ratings explicitly.** Academic importance is now
      a *weight*, not a floor — it was being compared against
      `academic_rating` as a minimum, which is a different quantity: a real
      athlete with the slider at 9 was shown 40 of 1,154 programmes, the
      academic floor alone deleting 734 → 55. Unrated schools are scored at a
      neutral prior and marked, never excluded.
- [x] Per-criterion score breakdown on each match result — weight, sub-score,
      contribution, confidence and a label per criterion, so "why is this
      school 7th?" is answerable from the data the scorer already returns.
- [x] Weights set from evidence, not feel. Two moved: geography 10 → 25, and
      roster opportunity 25 → 10. Held at 25 the roster term actively hurt —
      departures at a position correlate with arrivals across programmes
      (r=0.375), but the school an athlete actually chose scores no higher on
      opportunity (0.445) than one drawn at random (0.447). It is kept at 10
      rather than 0 deliberately: the backtest measures where athletes *ended
      up*, while opportunity is a claim about which coach *replies*, and
      nothing can test that until 1.1 lands. **Revisit this weight first when
      it does.**
- [x] **Criteria couple to one another** (`shared/matching/couplings.js`). A
      flat weighted sum gets this wrong: an athlete who needs a scholarship
      does not simply "care about cost more". Staying in state saves them
      $5,245 (NJCAA) to $17,871 (D1) a year, junior college costs a third of
      everything else, D3 is both the most expensive division and forbidden
      from offering athletic money, and being clearly the best player in a
      squad is worth real money where the pool is split by hand. So a stated
      priority now produces two things — weight multipliers on *other*
      criteria, and shape overrides on their curves. Each rule is named,
      carries its reasoning, declares whether it is `measured` or `assumed`,
      and explains itself in one sentence on the card.
- [x] **Affordability is residency-aware.** `net_price` is a single average
      across the student body, so an out-of-state athlete and a local one were
      quoted the same figure for the same school — blind to the largest cost
      lever in US college sport. The out-of-state premium is now added at
      public institutions: same D1 school, $9,380 in-state against $21,354
      out-of-state after athletic aid.
- [x] **A ranking is a first-class input** — `weightsFromRanking()`, persisted
      on `players.criterion_ranking` as a ranking rather than pre-translated
      into numbers, since the mapping to weights is a tuning decision that
      will move and a stored ranking survives it.
- [x] **Operator UI to rank the six criteria, in both places it is needed.**
      `src/components/PriorityTokens.jsx` sits under Placement Prefs in the
      intake form as moveable tokens — a quick pass while a player file is
      being built, placed directly under Budget Range because a tight budget
      shifts several of these weights on its own and the note underneath
      explains which. Reordering works three ways on purpose: drag for the
      mouse, arrow keys for the keyboard, and tap-to-select-then-tap-to-place
      for touch, where HTML5 drag never fires. Ordering, labels and the weight
      arithmetic live in `src/lib/criteriaRanking.js`, shared with the panel
      below so the two presentations cannot drift.

      A coupling can weight a criterion above the rank it was given — correct,
      but an ordered list whose percentages disagree with its numbering reads
      as a bug, so boosted entries carry an amber arrow and a one-line legend.

      `src/components/CriteriaRanking.jsx`, on the Analysis & Matching tab. A
      ranking rather than six number boxes, because that is how a family talks
      about it ("cost first, then near home") and because the rank-to-weight
      mapping is a tuning decision that will keep moving — what is stored is
      the ranking, the numbers are derived. Drag or arrow keys, so it is
      usable by keyboard and on touch. The panel opens showing the weights
      **currently in force** and only switches to a preview once something is
      moved: rendering the preview permanently reads as "these are your
      current weights", and for an athlete with no stored ranking they are not.
      Any couplings that fired are shown in the athlete's own words, since
      they move the percentages behind the operator's back otherwise.
      `criterion_ranking` is a `jsonField` on the player entity, so it is sent
      and stored as an array; an empty array is how "not set" is recorded, and
      the sanitiser writes one explicitly rather than dropping the key, or
      Reset to defaults would appear to do nothing on save.
- [x] **Re-run matching on weight change** — applying persists the ranking and
      re-ranks against the *saved* player rather than component state, which
      would otherwise race the update and rank against the priorities the
      operator just replaced. This is the deterministic half of slide 3 panel
      2; the learning half is Phase 5.
- [x] **Breakdown on the match card** — "Why this score", one row per
      criterion: weight, sub-score bar, status label, and the points it
      contributed to the total. Criteria at their neutral prior are greyed and
      captioned, so a gap in our data cannot be mistaken for a verdict on the
      school. The card's dead "Tuition —" cell now carries net price, and its
      location line reads city/state instead of the `location` column that was
      empty on all 2,374 rows.
- [x] **Ask where the athlete is from, and match internationals on who is
      already there.** Recruited From is an explicit USA or International, and
      the field beside it changes to suit: the fifty states and territories,
      or one of 169 countries generated from `roster_players.country` rather
      than hand-written — the athlete's country is matched by name against
      that same column, and a free-text "England" would never join to the
      roster's "United Kingdom".

      For an international athlete the location criterion stops measuring
      distance, since everywhere is far, and measures whether the program
      already does this: whether internationals are ordinary there at all (the
      stronger half — a coach who has never signed one has none of the visa,
      clearinghouse or overseas-network machinery, and **105 men's programs
      carry none while 116 are above 60%**), and whether the athlete's own
      countrymen are there, which is the clearest evidence of a live pipeline.
      The clusters are large: LSU Alexandria carries 18 UK players and 10
      Spanish. Neither is a filter — a program with no overseas players floors
      at 0.15, not zero.

      It discriminates by country rather than merely by "international": the
      same profile ranked as UK leads with LSU Alexandria, District of
      Columbia and Florida National; as Spanish it leads with LSU Alexandria,
      Marian and Francis Marion. A domestic athlete is untouched.
- [x] **Conferences grouped under their division.** Selecting three divisions
      put ninety checkboxes on the page in one undifferentiated wrap, with
      nothing to say which division any of them belonged to — the one piece of
      context that decides whether an athlete cares. Each division is now a
      collapsible section with its own count and its own Select all. Five
      conference names span two divisions each (WHAC, Mid-South, Golden State,
      CCAC and AMC are all D2 and NAIA), and since `preferred_conferences` is
      a flat list of names, those rows say so rather than looking broken when
      selecting all of D2 moves NAIA's counter.

- [x] **The intake form asks what the model needs, and only that.** Four
      changes, each closing a gap the model could not work around:
      **SAT and ACT** now have inputs — the columns, the profile row and the
      public page's academic record all existed, but nothing could fill them,
      so admissibility fell back to GPA or gave up.
      **Graduation year and recruiting class year merged** into the latter.
      They held one fact and gated different things — publishing wanted one,
      the form and matching the other — so an athlete could be created,
      matched and drafted and then fail to publish on a field nobody had asked
      for. `classYearOf()` is the single reader.
      **The academic importance slider is gone.** Once criteria could be
      ranked, a 0-10 slider said the same thing worse, and whenever a ranking
      existed it was already being discarded. Academics is an ordinary default
      weight of 15 now. SAT did not make it redundant — SAT says whether they
      can get in, the slider said whether they cared; it is the *ranking* that
      replaced it.
      **Budget split into $5k bands** from a top band of "$50k+" against a
      mean net price near $22k. Need is derived from the ceiling rather than
      a table, so a resplit can never leave a band with no need attached.
- [x] **Ranking first place means something.** The rank-to-weight curve was
      linear, giving first place 26.7% — so a programme merely good on the
      other five could outrank a strong one on the criterion the operator had
      just named as most important. Steepening a linear ramp barely helps,
      because lowering the tail lowers the denominator with it. Geometric
      decay puts first at **37.9%** and still leaves sixth carrying 4.4%,
      because a ranking says which matter *more*, not which to switch off.
- [x] **An academic minimum, as a constraint rather than a reinterpreted
      preference.** The retired slider was a preference the old model silently
      used as a threshold. This is the athlete stating a floor: it defaults to
      none, what it removes is counted and printed, it sets no weight, and an
      unrated programme is never dropped — that last case is what once made a
      third of the women's field vanish.
- [x] **Location is named for what it scores.** For an international athlete
      the criterion measures whether the programme recruits overseas and
      whether their countrymen are there, not distance — but the token still
      read "Near home", so an operator ranking it was ranking a belief about
      what it did. It now reads "International fit" for them.

#### Two more inversions of the same shape
Both found by running the model against a real athlete rather than by reading
it, and both the same failure as the roster one: **missing data scoring better
than measured-bad data**.

An athlete with **no GPA and no test score** had academic fit returning school
quality with admissibility assumed — a school *attribute* presented as a
*fit*, ranking them toward stronger academics on no evidence they could get in
or that they cared. Measured against 600 real placements it cost 3.2 points of
median percentile. It returns the prior now, like every other criterion with
no input.

A school with **no SAT average of its own** was falling back to that same
prior and scoring 0.5 — better than it deserved, and better than an equally
weak school with complete data. `academic_rating` is complete for every
programme in scope, so quality is known even when admissibility is not. A
1.4/10 programme went from 0.5 to 0.14; for a 1440-SAT athlete ranking
academics first it fell from 3rd to 167th, and with the steeper ranking curve,
to well outside his list.

#### A second defect this work uncovered
Testing the panel against a real athlete surfaced the same inversion as
before, reached by a different route: **an athlete with no
`recruiting_class_year` had no cohort to look up**, so every school we hold a
roster for scored a *measured* zero on opportunity while unscraped ones kept
the neutral prior — ranking the programmes we know least about highest. Simon
Fraser, which has no Scorecard row and no roster, came first. `rosterOpportunity`
now takes `classYearKnown` and falls back to the prior for everyone when the
arrival year is unknown. Two tests pin it. The `score.test.js` athlete fixture
had been missing `classYear` too, which is why nothing caught it.

#### What the backtest cannot see
The couplings are **unvalidated by construction**, and so is the international
half of the location criterion. The harness builds its athletes from roster
hometowns, which gives them no family budget and makes every one of them
domestic, so no coupling fires and the band numbers above are identical with
and without the layer.

The measured half of each rule is its premise — the cost figures are real, the
spread in international share across programs is real — but that a high-need
athlete should therefore be steered to a weaker program, or that an
international recruit is likelier to land where compatriots already are, is
recruiting knowledge rather than a finding. Both are marked `assumed` in
`couplings.js` and should be the first suspects if the lists look wrong. The
international rule was reviewed and accepted on its merits on 2026-08-25.

Extending the harness to build international athletes from the `country`
column would test that second one — the data is there. It has not been done.

#### A defect this work uncovered
`estimated_graduation_year` was **one year late on every roster row** —
`YEARS_TO_GRADUATE` counted a senior as two years from graduating. 91.4% of
players labelled "Sr." on a 2024 roster were gone before the 2025 season, and
rosters that print an explicit year spanned 2026–2029 for fall 2025 where the
derived values spanned 2027–2030. Every recruit was being matched against the
wrong cohort, and it is why roster opportunity first measured as *worse than
knowing nothing*. Fixed in `server/lib/classYear.js`, 109,886 rows re-derived
by `refreshGraduationYears.js`, and pinned by a concordance test that checks
derived years against the ones rosters print literally — the existing tests
all passed throughout, because they were written against the conversion
itself.

---

## Phase 2 — Pillar 2: the campaign engine

The largest remaining build. Everything here is gated on the ESP decision.

### 2.1 Coach data consolidation
- [x] **Fall through to the best contact a programme actually has.**
      2026-08-27. `pickHeadCoach` stopped at the associate head and returned
      nothing below it, so a programme listing only assistants — or only a
      shared inbox — was skipped entirely. Now `pickBestContact`, walking
      head → associate head → assistant → goalkeeper coach → team inbox.

      **45 more programmes reached**: 21 with assistants and no head, 24 with
      nothing but a shared address. Coverage goes 1,939 → **1,984 of 1,986**
      school-sports. Two have no usable address at all.

      Which assistant matters is **not seniority**: a recruiting coordinator is
      the person whose job this email is, and 53 are on file, so they rank
      above the explicit first/senior markers, which rank above whoever the
      staff page happened to list first. Volunteers and graduate assistants
      stay excluded at every rung — they are not who decides, and a recruit
      spends one approach per programme. The shared inbox is last and reached
      only when there is no person. Every non-head row now carries a badge
      saying what it is; Clemson shows both at once, an associate head at a
      generic address, which is exactly the pair worth seeing before sending.
- [x] **Promoted `coaching_staff` into a first-class `coaches` table** — 22
      rows to **6,346**, via `server/scripts/promoteCoaches.js` (dry run by
      default, backs up before writing, idempotent on `(email, school,
      sport)`). Lazy population is fine for a demo and wrong for a pilot: you
      cannot review, dedupe or suppress a list that does not exist until you
      mail it. All of it rather than pilot scope — 6,346 rows is small, and a
      partial table would keep the lazy path alive to drift again.
- [x] **Normalised `division`** — it held both `NCAA D1` (8 rows) and
      `NCAA Division I` (14). `normalizeDivision` moved to
      `shared/divisions.js` rather than being written a second time
      server-side; the ordering in it is a rule, not a preference, since the
      D3 test must precede D2 and D2 precede D1 or "Division II" satisfies the
      "Division I" check. **`findOrCreateCoach` normalises on write too** —
      the table drifted because the lazy writer never did, so repairing rows
      without fixing the writer would only reset the clock.
- [x] **Email provenance recorded, rather than a flag asserting verification.**
      The source sheets carried a `status` and a `source_url` per address and
      the original import dropped both, so every contact looked equally good.
      They are not: **4,993 verified** (read off a staff page), **1,159
      inferred** (guessed from the institution's address pattern, never
      observed anywhere), **169 generic** (shared inboxes), 25 unknown. That
      inferred fifth is what bounces, and on cold outreach a bounce costs
      sender reputation rather than just a lost email.

      `email_confirmed_at` is a separate column and stays null until something
      proves an address — a send that does not bounce, or a reply. Where we
      got an address and whether it works are different questions, and one
      field answering both would end up asserting the wrong one.

      **Re-measured 2026-08-25, and the old figure no longer reproduces.**
      This used to read "95 addresses across 29 programmes, 22% inferred".
      That was measured before the six-criterion model, so the top 30 is a
      different set of schools now. Current, for the two real athletes on
      file, top 30:

      | | addresses | inferred |
      |---|---|---|
      | Rhys Davies, head + assistants | 84 | 7 (8%) |
      | Ryan Billings, head + assistants | 100 | 12 (12%) |
      | Rhys Davies, head coaches only | 23 | 2 (9%) |
      | Ryan Billings, head coaches only | 30 | 1 (3%) |

      Neither has a programme with no contact at all any more. The important
      part is the split: **head-coach addresses are markedly cleaner than the
      staff behind them.** Across the whole pool, 1,829 of 1,939 head-coach
      addresses are verified (94%) against 78 inferred (4%) — a head coach is
      named on a staff page, an assistant is often the one whose address had
      to be guessed. A head-coach-only pilot therefore carries roughly a
      twentieth of its list as likely bounces, not a fifth.
- [x] **Provenance shown where the sending decision is made.** Recording
      `email_status` was only half the job: both composers read contacts from
      `graduating_seniors.coaching_staff`, which is the pre-promotion source
      and carries no provenance, so the tab showed a name and an address with
      nothing to say the address had never been observed to work. The only way
      to see it was `npm run draft` in a terminal — a check nobody performs
      while looking at the thing they are about to send.

      Joined on the address at read time rather than merged into the stored
      analysis: `recommendations` is a persisted blob, so an athlete analysed
      before a contact was re-verified would keep showing the old status
      forever. `email_status` is a property of the address and no address in
      the table carries two of them, so the address alone is a sound key.

      **Missing data warns rather than reassures** — an address the map has
      never heard of reads as *unverified*, and a failed lookup says so rather
      than rendering an empty map as a clean bill of health. The reassuring
      default is how you mail twenty addresses nothing has ever checked and
      call it a clean list. Red is reserved for `inferred`, which actually
      bounces; a shared inbox delivers perfectly well and merely has nobody's
      name on it, and colouring them alike would train the operator to ignore
      both. The bulk dialog counts the risk over the selected rows and offers
      to untick the inferred ones, so the warning can be acted on rather than
      only read.
- [ ] **191 of 1,986 school-sports have contacts on unrelated email domains** —
      9.6%, and several are plainly a same-named institution mixed in.
      "Saint Mary's" (women's) carries staff from four of them (smumn.edu,
      stmarys-ca.edu, stmarytx.edu, smcm.edu); "Trinity (TX)" mixes Trinity
      University in Texas with Trinity College in Connecticut; "Texas"
      (women's) has Concordia Texas addresses in it. The same
      ambiguous-short-name failure as [[duplicate-school-rows]] and the
      `matchSchoolName` defects, arriving this time through the coaching
      import.

      Nothing can adjudicate it yet: `colleges.website_domain` is empty on all
      2,374 rows, so there is no known-good domain to check against. Until
      there is, `draftOutreach.js` flags any programme whose contacts span
      unrelated domains and says to check before sending — it cannot say which
      domain is right, only that they disagree, which is enough to stop a
      coach at the wrong school being written to.
- [ ] **NJCAA has no coaching contacts at all** — 0 of 229 men's programmes,
      against 211/214 at D1 and 199/203 at D2. Does not block a D1–D3 pilot,
      but the affordability work made junior college a prominent
      recommendation for high-need athletes, and there is nobody to write to.
- [ ] **Decide coaches-per-program.** Sending per-coach is deliberate —
      attribution is per (athlete, coach) pair, and a shared link would credit
      one coach's viewing to whoever was in the To field. But it multiplies
      volume 2–3× against the warmup ramp, which is the binding constraint on
      a two-sport pilot. Settle this before fixing the ramp schedule.
- [ ] Handle coaches who staff both the men's and women's programme at one
      school — with both sports in scope, the same person can now receive two
      campaigns. The per-coach cap in §2.3 must be keyed on the person, not
      the (school, sport) pair.

### 2.2 ESP migration — **on hold, 2026-08-25**

Not deferred for capacity: **decided against.** An ESP sending on behalf of
many clients pools all of their list reputation into one domain, so a single
bad list damages every client at once — and the From address that results is
exactly the recruiting-service pattern coaches have learned to bin. Both
problems disappear when the client sends from their own mailbox.

The four items below are kept rather than deleted because three of them are
real gaps whatever sends the mail, and something will have to close them:

- [ ] ~~Replace the Outlook/AppleScript path with the ESP API~~ — dropped.
- [ ] Per-send delivery status recorded against the outreach row. Today "sent"
      means "handed to Outlook" and nothing observes the outcome. **Still
      true, and it gets worse under client sending** — if the client presses
      send in their own Outlook, we have no send event at all unless the act
      of drafting records one. `outreach.sent_at` already exists and is
      written when a draft is created, which is the right hook.
- [ ] Bounce and complaint webhooks → suppression list. Without an ESP there
      is no webhook; bounces land in the sender's own inbox. The provenance
      badges are the cheap substitute — they say which addresses will bounce
      *before* the send rather than reporting it after.
- [ ] **Reply detection.** A reply is the single most valuable event in the
      system and nothing detects one; `engagement_rollup.responded_at` is a
      manual toggle. Under client sending the reply goes to the client's inbox
      and we never see it at all, which makes a coach-engagement screen a
      click tracker. Mailbox OAuth (Microsoft Graph, read scope) is the real
      answer and belongs to the portal decision, not here.

### 2.3 Sequencing
- [x] **Bulk drafting for a manual pilot** — `npm run draft -- --athlete "…"`.
      The UI composes per school, so a top-20 list is twenty trips through the
      same dialog and three athletes is sixty. This ranks, picks the staff
      worth writing to, fills the athlete's own template and hands each message
      to Outlook **as a draft** — `send: false` always, since the operator
      presses send. Dry run by default, and the dry run is the useful half: it
      names every contact, every skip and why, before anything opens.

      Staff selection is a role classifier (`shared/coachRoles.js`) rather
      than a title match, because titles are free text off a hundred staff
      pages. Volunteers, graduate assistants and team inboxes are never
      written to however much "assistant" is in the title; a combined title
      like "Assistant Coach/Equipment Manager" is read as the coach they are
      rather than the second job; and a goalkeeper coach is contacted only for
      a goalkeeper, to whom they are the most relevant person on the staff.
      What it deliberately does *not* do is exclude a title naming the other
      sport — those turn out to be either mislabelled team addresses or people
      who genuinely coach both.
- [x] **Whole-page head-coach drafting, in the app.** `npm run draft` covered
      the terminal; the tab still composed one school at a time, so a top-20
      list was twenty trips through the same dialog. **Message all head
      coaches** above the results drafts the head coach at every programme on
      the page in one pass, sequentially, with a per-row tick as each lands.

      What you edit is the *template*, not a rendered message: `{{college_name}}`,
      the nickname and the graduating-senior counts resolve differently for
      all twenty, so one filled body would be a lie about nineteen of them.
      A preview underneath renders one chosen programme, with a dropdown to
      read any of the others. **Drafts only — there is no send-immediately
      option here**, deliberately, because twenty messages leaving one inbox
      in a burst is the thing most likely to get the address filtered.

      Picking the head coach moved `coachRoles.js` into `shared/` rather than
      growing a second classifier in the UI — because the UI already had one
      and it was wrong. `/head coach/i` matches "Head Coach" and misses
      "Head Men's Soccer Coach": **707 of the 2,036 head coaches on file, 35%**.
      `EmailComposer` had been seeding its greeting with an assistant's name
      for every one of them. Both paths now go through `classifyRole`.

      Where a programme has no head coach the associate head is used and
      labelled as such (15 school-sports); where it has neither, the programme
      is named in a warning rather than silently dropped (47). Head-coach
      coverage is 98% in both sports.
- [ ] Campaign model: campaign → step → recipient, with per-athlete state.
- [ ] A/B/C variants, each differentiated, as promised on slide 4.
- [ ] Three-week schedule with batches of 100 programs.
- [ ] Stop-on-reply: a coach who responds drops out of the remaining steps.
- [ ] Per-coach send cap **across all athletes and both sports** — without it,
      several athletes hitting the same coach will burn the domain.

### 2.4 Compliance
- [x] **Moved the opt-out from a link to a reply.** 2026-08-27. A long
      unsubscribe URL is the clearest "this is bulk mail" signal in the
      message, which is the one thing a first-touch email to a coach cannot
      afford to look like. The footer says so in a sentence instead.

      **Still compliant, and that mattered**: an opt-out is required by
      CAN-SPAM for the US recipients and independently by the NZ Unsolicited
      Electronic Messages Act, because the mail leaves from New Zealand. A
      reply-to address is an accepted facility under both, so the mechanism
      changes, not whether one exists.

      **The obligation moves from a machine to a person.** Opt-outs now arrive
      as email and someone must action them within ten business days;
      `npm run suppress -- <address>` is that action. The trial preflight
      states this on every run as a warning it *cannot verify*, because there
      is nothing here a machine can check — which is exactly why it is the
      part most likely to be forgotten. `/u/<token>` stays live, since emails
      already sent carry those links and an opt-out that stops working is
      worse than one never offered.
- [x] **Unsubscribe honoured across every athlete's campaigns.** A
      `suppressions` table keyed on the **address alone** — a coach opting out
      is opting out of Thriv3, not of one athlete, and keying it on (athlete,
      coach) would quietly mean the opposite. `sendOutreach` checks it inside
      the send loop rather than where a list is built, because every path to a
      send goes through the loop and only some go through a list builder. A
      suppressed address returns `status: 'suppressed'` and gets no outreach
      row, so nothing counts it as contacted.

      The link itself is `/u/<token>` at the edge. **GET only ever shows a
      confirmation; only POST records anything** — mail security gateways
      follow links to scan them, and a GET that opted people out would
      unsubscribe every recipient behind such a gateway without them seeing
      the page. The edge records the *token*, never an address: it does not
      know any coach's email and must not learn one, so `pullSuppressions()`
      resolves token → outreach → coach locally at sync time. The token is
      revoked at the edge in the same batch, so the opt-out holds even if the
      sync does not run for days.

      Replies that arrive as prose rather than through the link:
      `npm run suppress -- coach@example.edu`, and `-- --list` to review.
- [x] **Physical address and identification in the footer (CAN-SPAM).**
      Appended by `sendOutreach` at send time, deliberately **not** offered as
      a `{{token}}`: an operator editing a template can delete a token without
      noticing what it was for, and the resulting message is unlawful rather
      than merely worse. `THRIV3_SENDER_IDENTITY` and `THRIV3_POSTAL_ADDRESS`
      have no defaults — a placeholder address satisfies a code path while
      failing the law, and nothing downstream can tell the difference — so
      sending refuses outright while they are unset and the trial preflight
      fails on them by name.
- [x] **Privacy notice covering coach tracking.** The profile footer already
      said "described in our privacy notice" and there was no notice and no
      link — a dangling reference claims a disclosure has been made when it
      has not. There is now a real page at `/privacy`, linked from the footer:
      what is recorded, what is not (no name, no email, no third party, no
      cookies), why, and how to opt out or ask for deletion. Plain HTML with
      no scripts and no external requests, because these load inside corporate
      mail gateways that strip both.

---

## Phase 3 — Pilot

Runs in parallel with Phase 4.

**Entry criteria revised 2026-08-25.** They used to read "Phases 1 and 2
complete, domain warmed to cohort-1 volume". Both halves are now wrong:
domain warming went away with the ESP, and Phase 2's remaining items are the
*campaign engine* — a three-week automated sequence — which a first pilot
sent by hand does not need. The real entry criteria are Phase 1.1's three
boxes and nothing else.

What pilot 1 actually needs, all verified 2026-08-25:

| | |
|---|---|
| Match lists | ✅ backtested, 95.8th percentile (men) / 95.2nd (women); recall@10 34.1% / 27.2% |
| Coach contacts | ✅ 6,346, with provenance shown at the point of sending |
| Compliance | ✅ opt-out, identity, postal address, privacy notice — all live |
| Drafting | ✅ per school, whole page, or `npm run draft` per athlete |
| Per-inbox cap | ✅ `THRIV3_COACH_MAX_SENDS=3` over 30 days |
| Sync | ✅ every 15 minutes |
| Preflight | ✅ 16/16 |
| **Tracking proven** | ⬜ **never carried a real visit** |
| Athletes published | ◐ Rhys Davies live; Ryan Billings publishable, not published |

- [ ] **Cohort 1 — men's soccer**, 3–5 athletes, D1–D3. **Sent by hand from
      Outlook**, not as an automated three-week cycle — the sequencing engine
      in §2.3 is not built and pilot 1 does not wait for it. Head coaches
      only for the first pass: it is a fifth of the volume of head +
      assistants and roughly a twentieth of the bounce exposure (4% inferred
      against 12%), which is the right trade on a mailbox with no sending
      history.
- [ ] **Watch the bounce rate before anything else.** It is the number that
      decides whether pilot 2 is worth running, and the provenance badges
      predict it — if the measured rate is far off the predicted 3–4%, the
      `email_status` data is wrong and that matters more than any engagement
      score.
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
- [x] **2024 roster backfill, both sports — done, and the 2025 season was
      repaired against it.** 2026-08-25. 1,717 of 1,722 in-scope school-sports
      carry both seasons, so turnover is computable for all but five. Detail in
      Phase 0; what matters here is that the turnover signal Pillar 4 depends on
      is now built on two seasons normalised by one set of rules rather than two.

      Comparing the seasons was what found the defects, in both directions. The
      2024 acquisition was clean on its own terms and still disagreed with 2025
      on formatting: 340 captain-prefixed names in 2024 that 2025 did not have,
      and 130 names in 2025 stored surname-first that 2024 did not. Each scored
      a player as a departure *and* an arrival. Going the other way, 2025 held
      six truncated rosters — Purdue had 10 of 24 players and no goalkeeper at
      all, which is the tell — plus 495 unnormalised positions and three school
      rows duplicated under the other sport's spelling.

      **Turnover now reads 42.8%, down from 44.6%**, and the improvement is
      almost entirely formatting rather than data. Retention is unmoved at a
      median of 75% and covers 1,712 programmes rather than 1,669, which is the
      reassuring outcome: the metric was already measuring something real, and
      the fixes widened its base without shifting its centre.
- [x] **Freshman-minute analysis — built, and it reports no mean.**
      `shared/freshmanMinutes.js`, 2026-08-27. Freshman playing time is
      bimodal nearly everywhere, so an average describes nobody: Bentley 2025
      had three freshmen over a thousand minutes and five on none, and the
      mean of 340 fits neither group.

      The unit is **the ladder** — freshmen ranked by minutes — because a
      recruit can place themselves on it and cannot place themselves against
      an average. `ladderByRank` asks what the Nth-best freshman got in each
      season on file, which is the projection a recruit can act on: told they
      are the top incoming defender, they read rank 1.

      Four seasons rather than one, because **consistency is the finding**.
      Caltech started a freshman in 4 of 4 and its second-best played
      1,010–1,166 minutes every year. Bentley managed it in 2 of 4 and its
      freshman share went 4%, 2%, 26%, 32% — a regime change that a single
      season reads as either a promise or a warning depending which year you
      ask. Redshirt freshmen are counted separately, being in their second
      year on campus; that a programme redshirts at all is itself a first-year
      outcome. The blank-versus-zero trap below is handled by reading
      `games_played` alongside the minutes.
- [x] **Coach tenure, so a change of regime is not read as a trend.**
      `shared/coachTenure.js` and the `coach_seasons` table, 2026-08-27.
      Freshman usage moves sharply mid-window at a third of programmes and the
      roster data cannot say why — Bentley 4/2/26/32%, Hofstra 2/0/8/18%,
      Caltech flat. Those mean three different things to a recruit.

      **6,876 rows, 5,780 named (84%), 2022–2025**, one row per
      (school, sport, season) *including* the unresolved ones, because a
      missing row reads as coverage while a row carrying a reason reads as a
      gap. The 1,096 gaps each say why: 387 no head coach found, 366 no usable
      page, 135 sport not on page, 111 vacant or TBA. `confidence` records how
      it was learned — a year-addressed roster page rates High, a Wayback
      snapshot Medium.

      Tenure is **derived from the observed sequence, not scraped from "in his
      12th season" prose** — that sentence appears on 1 of 12 sampled pages,
      and deriving it is the more honest result anyway: a coach present in
      every season on file is "4+ seasons", not "since 2007", because 2021 was
      never observed. It refuses to merge two coaches sharing a surname, and
      refuses to bridge a gap, since both would assert exactly what the data
      cannot know.

      Three of `classifyProgramme`'s five verdicts were **forced by real data
      rather than designed**: Hofstra's spread filed as steady while its step
      was 12 (a coach changing his own mind is neither a hire nor noise);
      South Carolina State printed TBA for two seasons while running the
      highest freshman share in the pool, then collapsed (a programme being
      held together, not a policy shift); and a new coach's first season is
      excluded from their side of the comparison, because it is played with
      their predecessor's recruits.
- [ ] Freshman-minute analysis, raw-data notes — **the data is two seasons
      deep in the database for the first time.** The 2024 minutes reached the CSVs on
      2026-08-25 but were not imported until 2026-08-26; see §1.2 for what
      that gap was doing to the backtest. Figures below are queried from the
      database as it stands, not from the sheets.

      | | Fr. rows | who played | median minutes (of those) |
      |---|---:|---:|---:|
      | 2024 men's | 5,699 | 3,487 | 352 |
      | 2024 women's | 6,811 | 5,005 | 377 |
      | 2025 men's | 7,346 | 4,703 | 335 |
      | 2025 women's | 7,704 | 5,848 | 412 |

      Now consumed by `shared/freshmanMinutes.js` above rather than queried ad
      hoc. Like retention it is a **modelling input, not a product surface**;
      the denominator discipline still applies — "0 minutes" is only meaningful
      against how many freshmen a programme carried.

      **The trap, and the column that gets you out of it.** A blank cell means
      the stats page could not be read; a 0 means it was read and the player
      did not appear. `minutes_played` cannot tell you which, because the
      importer coerces a blank to 0 on the way in
      (`toIntOrNull(...) ?? 0`) — Central Connecticut's Michel Pinoncely is
      blank in the sheet and Akron's Lincoln McCarty is a literal 0, and both
      are 0 in the database.

      **`games_played` keeps the distinction**, because it is stored as
      `toIntOrNull` with no fallback. Read the pair, not the minutes alone:

      | | meaning | 2024 | 2025 |
      |---|---|---:|---:|
      | `minutes > 0` | played, minutes known | 38,976 | 46,769 |
      | `minutes = 0`, `games > 0` | played, **minutes not recorded** | 2,939 | 5,859 |
      | `minutes = 0`, `games = 0` | on the roster, did not appear | 7,137 | 8,316 |
      | `minutes = 0`, `games IS NULL` | nothing recorded at all | 3,487 | 3,437 |

      The second row is the one that will silently drag every average: mostly
      PrestoSports programmes whose team tables carry `gp, sh, g, a` and no
      minutes column. Rows two and four are missing data and must be excluded
      from any mean or median, not counted as zeros. 221 school-sports in 2024
      and 246 in 2025 record 0 minutes for every player on the roster; treat a
      programme like that as absent rather than as a squad nobody played.

- [ ] Identify a source for university quality and lifestyle. Currently
      un-sourced. `academic_rating` is now complete in scope, but it measures
      academic strength, not what living and playing somewhere is like.
      Retention is the closest signal the data already holds, and it feeds the
      models rather than the page — see Phase 0. What is missing is a source
      for the campus-experience side that retention only proxies.

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
