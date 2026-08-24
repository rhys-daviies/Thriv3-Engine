# Thriv3 — Road to Go Live

The single canonical roadmap. Tracks the four pillars of the Thriv3 Engine
deck against what is actually built. Update the checkboxes as work lands; keep
the "verified state" numbers honest by re-running the queries rather than
trusting this file.

Last audited: 2026-08-24, re-verified against the DB and the live edge
(branch `engagement-tracking`, 262 tests green). Coverage numbers below were
re-run, not copied; two moved and are corrected in place.

---

## Locked decisions

| Decision | Answer | Consequence |
|---|---|---|
| Send architecture | **ESP on a warmed sending domain** | Outlook/AppleScript becomes a dev-only path. Domain warming is a calendar dependency — start it before any code. |
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

### Sending domain
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
- [ ] **Choose the ESP, checking cold-outreach policy first.** Several
      transactional providers prohibit unsolicited outreach on their streams
      outright; confirm terms before building against an API. Evaluate
      build-vs-buy — a purpose-built sequencing platform supplies warmup,
      A/B/C sequencing and reply detection natively and could remove most of
      §2.3.

### Data backfills

Ordered by lead time and blast radius, not by size. The 2026-08-24 audit
looked into each one rather than taking the headline count at face value, and
two of them are a different job than the count suggests.

- [ ] **2024 rosters, both sports.** Start first: longest lead time in the
      project, and the only Phase 0 item that gates an entire pillar (4's
      turnover metric needs a season to diff against). No code needed — the
      2025 pipeline takes eight CSVs, one per sport-division, through
      `npm run import-rosters`; 2024 is the same shape with `SEASON` changed.
      This is pure acquisition, so it parallelises with everything below.
- [ ] **Women's academic ratings — 318 programs to source, 5 to reconcile.**
      Not 323: five already exist in `server/seed/data/academic_scores.json`
      filed under a different division, which is a lookup fix rather than
      research. The other 318 are genuinely absent, and copying from the
      men's row is not available — only 5 of the 323 have a men's counterpart
      at all, because most of the gap is SEC/Big 12 schools that sponsor
      women's soccer and no men's programme. **Recover the scoring
      methodology before sourcing anything**: the existing 1,077 scores are a
      0–10 scale of unrecorded derivation, and 318 scores produced a different
      way are not comparable to them — they would quietly distort every
      ranking that mixes the two.
- [ ] **Roster scrape pass — 71 schools, one job not two.** The 56 programs
      with no 2025 roster and the 15 whose roster imported with no class year
      at all (451 rows) are the same failure and the same fix; doing them in
      one pass rather than as two roadmap lines saves a full crawl.
- [ ] **Fix the class-year parser before re-scraping.** Some schools' rosters
      put a club name in `class_year_label` — 'Real Colorado', 'FC Dallas',
      'DKSC', 'Portland Thorns Academy' — so a column is being read off by
      one. Re-scraping first would just re-import the same garbage.
- [ ] **`estimated_graduation_year` nulls — 1,250 rows, and it is a scrape,
      not a mapping fix.** 1,218 of them have no `class_year_label` either,
      so there is nothing to map from; only ~32 are unmapped labels
      ('Rs.', 'Medical Redshirt', 'Sr.-5'). After the 15 whole-roster failures
      above are re-scraped, what remains is 767 rows scattered thinly across
      267 schools — the expensive tail, and the one worth timeboxing.
- [ ] **Nicknames — 102 programs** (36 men's, 66 women's). Cheapest and least
      urgent; personalisation quality, not a blocker, and the template falls
      back cleanly. Fill in the gaps between the jobs above.

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
