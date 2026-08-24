# data/ — soccer datasets

Committed so this work survives a disk failure. Until now these files existed only on one
laptop, and a large part of them was verified by hand against individual schools' athletics
sites — expensive to lose, trivial to store.

## THESE ARE MIRRORS, NOT THE WORKING COPIES

The tools in `tools/soccer/` read **absolute paths outside this repo**:

    ~/Documents/Thriv3/Soccer Records/soccer_records.csv
    ~/Documents/Thriv3/Soccer Records/soccer_records_women.csv
    ~/Documents/Thriv3/University individualisation/*.csv

So editing a file in `data/` changes nothing. Anything that writes records or rebuilds the
CSVs still writes to `Thriv3/`, and these copies then go stale — silently.

That matters more than usual here because **more than one process writes those files**.
During the session that produced this, three other Claude Code sessions were editing the
records files concurrently; the men's file changed several times in an afternoon, once
between generating a rankings file and comparing against it (which manufactured two phantom
"stale score" reports). Treat a copy in `data/` as a point-in-time snapshot, and check the
date before trusting it against the live file.

## Refreshing

    cp ~/Documents/Thriv3/"Soccer Records"/soccer_records{,_women}.csv data/soccer-records/
    cp ~/Documents/Thriv3/"University individualisation"/*.{csv,md} data/university-individualisation/

Then commit. A diff on these files is a readable record of what changed, which neither the
database nor the working copies give you.

## Contents

`soccer-records/` — the canonical per-sport records: school, division, conference,
conf_tier, W/L/D for 2022-25, and `{year}_ps` (postseason round reached). The `_ps` columns
are **informational only**; the rating no longer applies a postseason bonus, because W/L/D
already includes postseason games and the bonus was double-counting them.

`university-individualisation/` — the two deliverables, one row per university-sport with
everything used to individualise outreach: nickname, mascot, colours, logo, athletics domain,
2025 conference champion, program score and rank, four seasons of results, head coach and
email, roster URL, graduating-senior count. No individual player statistics.

`identity_provenance.md` is the important one to read before trusting any of it. It records
what was verified and how, what was deliberately refused, which checks are silent on what,
and the errors found and fixed — including several rows that had been matched to a
different institution of a similar name.

Point-in-time `.bak` / `.pre_*` files from the working directory are deliberately NOT
committed; git history serves that purpose better.

The identity data itself lives in the `colleges` table, which is gitignored under
`server/data/`. Its backup is `server/seed/data/identity_backup/`.
