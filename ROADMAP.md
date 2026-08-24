# Thriv3 — Road to Go Live

The single canonical roadmap. Tracks the four pillars of the Thriv3 Engine
deck against what is actually built. Update the checkboxes as work lands; keep
the "verified state" numbers honest by re-running the queries rather than
trusting this file.

Last audited: 2026-08-24 (branch `engagement-tracking`, 232 tests green).

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
| Missing nickname (personalisation) | 38 | 67 | 105 |
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
| 3 · Interactions | Tracking, coach score, session timelines | Feature-complete, fully tested, **never run on real traffic** | One real end-to-end send; automated sync; real response detection |
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
- [ ] **Women's academic ratings — 323 programs** (119 D1, 61 D2, 143 D3).
      Blocking: the academic-importance filter in `playerAnalysis.js` drops
      every null-rated school without telling anyone, so a third of women's
      programs are currently invisible to matching whenever an athlete sets
      academic importance.
- [ ] **2024 rosters, both sports** → program turnover rate for Pillar 4.
      Only 2025 is loaded and turnover needs a season to diff against. Longest
      lead time in the project.
- [ ] **Roster gaps — 56 programs** (16 men's, 40 women's: 7 D2, 33 D3).
- [ ] **Nicknames — 105 programs** (38 men's, 67 women's). Personalisation
      quality, not a blocker; the template falls back cleanly.
- [ ] **`estimated_graduation_year` nulls — 1,250 rows**, concentrated in
      women's D1 (529). These rows can never match a recruiting class year, so
      they silently understate a program's openings.

---

## Phase 1 — Prove Pillar 3, finish Pillar 1

Cheapest high-information work. Do not start Phase 2 before task 1.1 passes.

### 1.1 Prove the tracking loop end to end
The pillar is validated entirely by simulator output — all 90 events in the DB
have a null `remote_id`, and the edge cursor stopped at 6. The path
*published profile → real inbox → coach opens → D1 → sync → rollup → Tab 3*
has never carried a genuine visit.

- [ ] Publish one real athlete profile and send one tracked link to a mailbox
      you control, from outside the local network.
- [ ] Confirm events land in D1, sync down with a non-null `remote_id`, roll
      up, and appear in Tab 3 with a correct session timeline.
- [ ] Fix whatever that exposes.
- [ ] Automate the sync (scheduled pull) instead of the manual button.

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
      of 7,239 men's and 5,336 of 7,000 women's `Fr.` rows carry
      `minutes_played`.
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
