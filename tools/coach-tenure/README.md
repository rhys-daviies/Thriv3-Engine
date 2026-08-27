# tools/coach-tenure — head coach by season, 2022–2026

A committed record of how `coach_seasons` was built. **This is a copy, not the
original.** The scripts run from `~/Documents/Thriv3/_roster_pipeline/`, where
they sit beside the `lib.py` they import for fetching, caching and Wayback.
They will not run from this directory.

They are copied here because that directory is under no version control, and
its own README exists because a session restart once deleted the pipeline, an
11,000-page fetch cache and 1,475 resolved programmes — recovered only because
the code happened to be in a transcript. That was luck.

## How it works

`coaches_lib.py` — the parse and the identity check.
`coaches_run.py` — resumable pass over every in-scope school-sport.
`coaches_probe.py` — the feasibility gate; run it before a full pass.
`coaches_2026.py` — the 2026 slot: who is in the job for the season being
recruited into, live pages only.
`coaches_gapfill.py` — the archive-url unwrap; see Recovery.

The season's coach comes from that season's **own year-addressed roster page**
(`/sports/mens-soccer/roster/2022`), not from `/coaches`. Three reasons:

1. The staff block renders in the same markup as the players, which is why
   `lib.is_staff` exists.
2. A year-addressed URL is a **live page for a past season**, so it rates High
   confidence where a snapshot rates Medium.
3. Wayback coverage of `/coaches` is far thinner than it looks — Akron has
   nine snapshots across five years and **none at all for 2023 or 2024**.
   Building on that route would have collapsed.

2022 and 2023 are 100% year-addressed, 2024 98%, 2025 79%. The undated
remainder falls back to Wayback windowed to `{season}0801`–`{season+1}0228`,
so the snapshot lands inside the season it describes.

## What it refuses to accept as a name

Each of these was found by re-reading real output, and each survived the
guard before it:

- **Placeholders.** South Carolina State printed `TBA` for two seasons. That
  is a vacancy and the most informative fact about the programme, not a man
  called TBA TBA.
- **Headings.** Rejecting the placeholder made the parser fall through to the
  heading above the empty table — 142 rows across 53 programmes read
  "Men's Soccer Coaching Staff" as their coach.
- **Link labels.** Then it fell through again to `Full Bio`, which passes
  every structural test and reached 38 programmes. Frequency is the tell: no
  person coaches 38 programmes.

Identity is verified before any name is accepted — the page's own text must
carry the school **and** the sport, and a parenthetical qualifier must match,
because `athletics_domains.json` maps distinct schools onto one domain and a
rebuild that trusted it once wrote one school's record onto every colliding
row.

## Output

`~/Documents/Thriv3/Coach Tenure/coach_by_season.csv`, one row per
(school, sport, season) **including unresolved ones** — a missing row reads as
coverage, a row with a `reason` reads as a gap. Imported by
`server/scripts/importCoachTenure.js`.


## Why 2026 is in the window

2026 holds no minutes — the season has not been played — and nothing is
projected from it. The only thing read is **who**, because "what happened
here" and "whose programme is this now" are different questions and the engine
was answering the second with the first. Bellarmine men's carried
`steady · the projection is as firm as this gets` for a programme whose coach
of all four measured seasons is not on the 2026 staff page.

1,424 of 1,722 resolved on the first pass (83%), entirely from live
year-addressed roster pages. 221 programmes — 11% of the pool — turn out to
have a head coach who coached none of the seasons on file.

## Recovery

`coaches_reparse.py` — re-parses, from cache only, the seasons rejected on
identity. It touches the network for nothing and recovered 189 of 232 such
seasons, lifting coverage from 85/87/87/77 to 89/90/90/79.

`coaches_gapfill.py` — the one that mattered. The 2025 coverage dip was never
a sourcing problem: `Source Roster URL` in the 2025 and 2024 roster sheets
holds a **web.archive.org** address for 306 and 34 school-sports — the roster
pipeline had already fallen back to the archive and wrote the address it
actually used. The coach pass read that as the programme's own page and went
looking for a snapshot *of a snapshot*, so every one came back
`no-usable-page`, which reads as "this programme has no staff page" when it
means "we asked the wrong question". Unwrapping the address and trying the
year-addressed live page first recovered 216 of 254 (85%) and took 2025
coverage from 79% to 90%, 2024 to 92%.

`coaches_recover.py` — the wider ladder (the /coaches page live, then archived,
then a second capture of the roster page). **Do not run it while Wayback is
throttling.** A CDX query for a URL known to hold four snapshots returned zero
after 25 seconds, and because an empty body is indistinguishable from "no
snapshot", the run spent eleven hours writing false negatives before it was
stopped and the state restored from backup. `wayback2.py` has the backoff this
needs; wire it in before the next attempt.
