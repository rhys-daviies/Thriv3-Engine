# Identity backup — why this file exists

`server/data/` is gitignored (it holds local player data and uploads), so the SQLite
database is **not** version controlled. That is correct for player data, but it also meant
the visual-identity work in `colleges` had no backup at all: ~2,100 nicknames, mascots,
colours and logos, a large slice of which were verified by hand against individual schools'
athletics sites. Rebuilding it from scratch is roughly a thousand Wikipedia lookups plus the
manual checks, so it is expensive to lose and cheap to store.

`colleges_identity.csv` is a flat export of exactly those columns, one row per
school-and-sport. It is plain CSV on purpose — diffable in review, and restorable without
needing this application to run.

## What is in it

name, sport, division, conference, nickname, nickname_plural, mascot, primary_color,
secondary_color, logo_url, identity_source, identity_notes, conference_champion_2025,
conference_champion_name, conference_champion_source, academic_rating, soccer_score

`identity_source` is the provenance of every value and is the reason this export is worth
more than the values alone. It records whether a nickname came from a Wikipedia article
(`wikipedia:<article title>`), from the school's own athletics domain
(`athletics-domain:<host>`), or was carried across from the same school's other-sport row.
`identity_notes` records the corrections — several rows say, in effect, "this had been
matched to a different institution of a similar name", which is the single most common defect
in this data and the hardest to detect later.

## Regenerating it

    sqlite3 -header -csv server/data/recruitmatch.sqlite "SELECT name, sport, division, \
      conference, nickname, nickname_plural, mascot, primary_color, secondary_color, \
      logo_url, identity_source, identity_notes, conference_champion_2025, \
      conference_champion_name, conference_champion_source, academic_rating, soccer_score \
      FROM colleges ORDER BY sport, name;" > server/seed/data/identity_backup/colleges_identity.csv

Re-run it after any identity work and commit the result. A diff on this file is a readable
record of what changed, which the database itself cannot give you.

## Restoring

Match on `(name, sport)` and write the identity columns back. Two cautions learned the hard
way:

* **Scope any restore by `sport`.** The men's and women's records files use different
  canonical spellings for the same school ("Xavier (LA)" vs "Xavier University of
  Louisiana"), so a name-only match reaches rows it should not. A delete-by-name without a
  sport filter previously destroyed seven legitimate women's rows.
* **Do not match on a name that merely *contains* another.** "Boston College" and "Boston
  University", "Colorado" and "Colorado College", "Pacific" and "Pacific University" are
  different institutions that collapse together under loose matching. Exact match only.

## Related, and NOT backed up here

The two per-sport deliverables live outside this repository, in
`~/Documents/Thriv3/University individualisation/` — along with `identity_provenance.md`,
which is the full written record of what was verified, what was refused, and which checks are
silent on what. The tooling is in `~/Documents/Recruitmatch/individualisation/`. See the
dated archive referenced in the commit message for a copy of both.
