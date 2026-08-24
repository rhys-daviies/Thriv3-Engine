# tools/soccer — records and identity tooling

Committed as a record of how the datasets in `data/` were built and verified. Read the
caveat below before trying to run any of it.

## NOT PORTABLE AS-IS

Every script hardcodes absolute paths (`/Users/rhysdavies/Documents/Thriv3/...`,
`/Users/rhysdavies/Documents/Recruitmatch/...`). They were written to run from
`~/Documents/Recruitmatch/individualisation/`, not from this repo, and they will fail
anywhere else. Nothing here is parameterised. Making it portable means lifting those paths
into arguments or a config — worth doing before anyone else relies on it, and not done.

## What each group does

**Building the deliverables**
- `build.py` — joins five sources into the two per-sport CSVs. The spine is a UNION, not the
  records file alone: the records file has carried far fewer NAIA men's programmes than the
  coaching files, so a records-only spine silently drops programmes we hold contacts for.

**Identity, and repairing it**
- `nickname_from_domain.js` — recovers a nickname from the school's own athletics hostname
  where Wikipedia states none. Requires TWO independent factors: the host must yield a word
  that is a team name elsewhere in the table, AND the site's own `<title>` must name the
  school. Either alone writes wrong answers.
- `repair_identity.js`, `repair_from_counterpart.js` — fix rows matched to a different
  institution of a similar name. Both assert the correction agrees with independent evidence
  before writing, and refuse rather than substitute a second wrong answer.
- `fill_from_counterpart.js` — copies identity between a school's two sport rows. Guards:
  division must agree, the source article must name the target, and a gendered form is never
  copied across sports (Hope College's women are the Flying Dutch, its men the Flying
  Dutchmen).

**Verifying**
- `check_nickname_vs_domain.py` — offline. Athletics hostnames are usually built from the
  nickname (`hlgtrojans.com`, `fontbonnegriffins.com`), which makes them an independent
  witness. 1292 nicknames corroborated this way.
- `verify_naia_records.py` / `verify_women_records.py` — compare team records against each
  school's own season page. Roughly half of season pages do not expose an overall record in
  server-rendered HTML, so an unreadable season is reported as `no_data`, never as agreement.
- `impossible_games.py` — offline detector using `roster_players`: if a player logged more
  games than the team supposedly played, the team record must be wrong. Catches exactly the
  cells site-verification cannot reach. **Join on exact names only** — a prefix fallback
  produced 139 "impossible" rows that were mostly artifacts ("Penn" matching Penn State).
- `cross_sport_names.py` — pairs a school across the two sports by core name. The most
  productive check of the lot, because the counterpart row is an independent witness for
  small colleges with no nickname-bearing domain. Safe for FLAGGING, unsafe for WRITING:
  "Pacific" and "Pacific University" share a core token and are different schools.

**Scoring**
- `soccer_score_v6.py` — the cross-division rating. `BANDS` at the top is an editorial dial,
  not a fitted quantity: cross-division fixtures in this sport are almost entirely spring and
  exhibition games, so there is no honest way to fit the offsets from results. A score
  outside its division's band is structurally impossible and makes a cheap assertion.
- `postseason.py`, `apply_postseason.py` — harvest the `{year}_ps` columns. Retained as
  information; the rating no longer applies a bonus from them, because W/L/D already includes
  postseason games.

## verification/

Results that cost network calls to produce, kept so they need not be re-scraped:
site-verified NAIA and women's record checks, the athletics-domain reference map (hand-cleaned
of 16 misattributed hosts), the postseason harvest, and the men's/women's nickname-split
confirmations. The larger caches are deliberately not committed — they regenerate.
