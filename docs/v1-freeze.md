# The V1 freeze

**Frozen at the tip of `fix/v1-baseline-repair`, 2026-09-19 — the commit carrying this document.**

The last commit to change behaviour or move a baseline is
`480a915645425c3286a19c2da10e3a1d60b3a3ec`; this one adds only the record. If
you need a single SHA to compare V2 against, use the tip.

V1 is the comparison baseline Matchmaking V2 will be measured against. It is
not the best model we can build. It is a model whose answers are recorded, so
that a V2 answer can be shown to differ and the difference can be argued about.

**After this point V1 changes only for a genuine implementation or data defect** —
something that makes it answer a different question than it claims to, not
something that makes it answer the question less well. Everything in *Known
limitations* below is the second kind, and each is a V2 requirement rather than
a V1 bug.

---

## What is frozen

| | |
|---|---|
| **Last behavioural commit** | `480a915` |
| **Freeze point** | tip of `fix/v1-baseline-repair` |
| **Branch** | `fix/v1-baseline-repair` (not merged to `main` at freeze time) |
| **Matching baseline** | `server/scripts/__baselines__/matching-v1-2026-09-19.json` — 8 athlete fixtures, 5 roster probes |
| **Evidence baseline** | `server/scripts/__baselines__/evidence.json` — 6 surfaces × 4,742 pairings |
| **Programme Intelligence baseline** | `server/scripts/__baselines__/programme-intelligence-2026-09-19.json` — 4 programmes, 4 athlete positions |
| **Report baselines** | output hashes in `server/scripts/reports.test.js` |
| **Eligibility rules** | `shared/eligibility.js`, verified against published rules 2026-09-19 |

Check all of them:

```bash
npm run snapshot:matching -- --check
npm run snapshot:pi -- --check
npx vitest run server/lib/evidenceBaseline.test.js server/scripts/reports.test.js
```

## Data assumptions

The baselines are answers over a particular database, and they move if it does.

- **Working database** `server/data/recruitmatch.sqlite` — 281,159 roster rows,
  2,404 college rows, seasons 2022–2026 for both soccer sports.
- **Current roster season is 2026**, meaning the fall 2026 season / academic
  year 2026-27. It is in progress, so it carries **no minutes at all**;
  `projected_minutes` carries the 2025 figures forward at a 450-minute starter
  cutoff and is produced by `npm run project-minutes`, **not** by the import.
  A roster re-import invalidates it. At freeze: 31,019 projections, 38,211
  prior-programme attributions.
- **Pinned evidence dataset** `server/data/baseline/recruitmatch-baseline.sqlite`
  — a separate, read-only snapshot. The evidence and report baselines are
  computed against it and are unaffected by the working database.
- **Known data characteristics, present before this work and unchanged by it:**
  7 duplicate player rows in the 2025 season; NJCAA (228 programmes) and USCAA
  (11) carry no 2026 roster at all.

## Eligibility rule version

`shared/eligibility.js`, verified 2026-09-19. Each rule carries its own source
and date; re-verify before trusting them.

| Association | Model | Note |
|---|---|---|
| NCAA D1 | age-based five-year, from the 2026 season | transitional for current athletes |
| NCAA D2 | age-based five-year, effective 2026-27 | transitional |
| NCAA D3 | four seasons | the five-year model is a 2027 Convention **proposal**, not adopted |
| NAIA | four seasons within the first ten semesters | separate association |
| NJCAA, USCAA | **UNKNOWN** | no rule established; no ceiling computed |

**The most likely of these to change is D3**, at the 2027 Convention. It governs
10,191 of the 29,000 men's roster rows.

---

## Known limitations

These are recorded so that nobody re-discovers them as bugs. **None is a reason
to modify V1.** Each is a V2 requirement.

### 1. The neutral-prior inversion
A programme we hold a roster for can score a *measured* zero on roster
opportunity while a programme we hold nothing for keeps the 0.5 prior — so
missing data outranks measured data. At entry year 2027 this affects a large
share of D1 and D2, where the new eligibility rule means very few places
genuinely open. **Deliberately left in V1**; it belongs in V2's
UNKNOWN / UNSCOREABLE / evidence-confidence architecture.

### 2. Class label is a proxy for eligibility, not eligibility
The five-year window runs from initial enrolment and the model is age-based. We
hold no `initial_enrollment_year`, `seasons_used`, `age`, or record of the
athlete's election between the old and new models. Class label stands in for
years-since-enrolment and breaks silently on transfers, gap years, medical
hardships and late international starts. 1.5% of rows carry no readable class
at all and are held as UNREADABLE.

### 3. Fifth-year retention is unmeasured
Eligibility to remain and likelihood of remaining are separate variables and V1
models only the first. No estimate of fifth-year uptake exists, because
2026-27 is the first season in which D1 and D2 athletes have the choice.
Openings for the 2027 intake span roughly 1.1 to 7.3 per squad across plausible
uptake — a 6.6× range on the nearest recruiting class. **The 2026 → 2027 roster
scrape is the first observation that could narrow it.**

### 4. NJCAA and USCAA carry no roster intelligence
239 active men's programmes have no 2026 roster and no eligibility rule on file,
so every one falls to the neutral prior on roster opportunity. NJCAA took 91 of
100 top-100 places for a developmental athlete on the strength of cost and
proximity alone.

### 5. Roster limits are not modelled
Nothing represents squad caps or scholarship counts. Under a five-year regime
"eligible to remain" and "will be kept" diverge, and roster limits are exactly
what decides between them.

### 6. The backtest measures destinations, not coach interest
`npm run backtest` ranks real arrivals and asks where an athlete *ended up* —
decided as much by who recruited, visited and offered first as by fit. It
cannot validate whether a coach would reply. Measured directly: roster
opportunity at the school an athlete chose is no higher than at a programme
drawn at random. Treat backtest numbers as a floor on quality, never a
definition of it.

### 7. Athlete ability is a coarse operator judgement
`football_ability` is a 1–10 slider, quantising ~1,150 programmes onto ten
buckets. Every athletic-fit and award calculation rests on it, and the backtest
is knowingly circular on it. Retained for V2 by explicit decision.

### 8. Affordability limitations
`net_price` is one average across the whole student body; family budget is a
ten-band ordinal; the award model is *assumed* rather than measured, since no
per-player award data exists anywhere. Affordability is a constant 1.0 for any
family in the top band, so it cannot express poor value. Income-bracketed net
price exists in the Scorecard extract on disk and is **not** imported. USCAA and
unconfigured divisions return UNKNOWN rather than a claimed zero.

---

## Operational notes

- **`npm run project-minutes` after every roster import.** The import does not
  produce projections and nothing else will. Losing them silently demotes every
  departure from starter to squad at all 1,166 programmes with no test failing.
  The rebuild is transactional as of `754a70c`, and
  `npm run snapshot:matching -- --check` refuses to run against a roster whose
  probes carry no graduating starter.
- **Seven roster queries feed `buildRosterIndex`** and each names its columns.
  `assertEligibilityInputsSelected` throws when one omits `class_year_label`,
  `division` or `season`; it has caught three real omissions so far.
