# University Individualisation

One CSV per sport. **One row per university-sport**, holding everything we use to
individualise a school — identity, achievement, program strength, staff, roster pointers.
Individual player statistics are deliberately **not** here; they stay in the roster and
graduating-seniors data. The only thing that crosses over is the school-level *count* of
graduating seniors.

| File | Rows | Columns |
|---|---|---|
| `mens_soccer_universities.csv` | 1,170 | 47 |
| `womens_soccer_universities.csv` | 1,271 | 47 |

Regenerate both (idempotent, overwrites in place):

```bash
python3 /Users/rhysdavies/Documents/Recruitmatch/individualisation/build.py
```

## Columns

**Who they are** — `school_id`, `school`, `sport`, `division`, `conference`, `conf_tier`

`conference` comes from the Soccer Records file, which is the version corrected by the
sport-specific conference audit (Kentucky men's play in the Sun Belt, not the SEC — 179
men's fixes). The app database never received those edits, so its own conference column is
knowingly stale and is not used here.

**Visual identity** — `nickname`, `nickname_plural`, `mascot`, `primary_color`,
`secondary_color`, `logo_url`, `athletics_domain`

These feed the email template tokens directly. `nickname_plural` drives grammar
("the Tigers **are**" vs "Army **is**").

**Achievement** — `conference_champion_2025`, `conference_champion_name`

Stored independently of `conference` on purpose: a school's conference label can go stale
after realignment, and the congratulations sentence has to stay correct when it does.

**Program strength** — `soccer_score_v6`, `soccer_score_rank`, `within_div_strength`,
`academic_rating`

Regenerated from `scoring/soccer_score_v6.py` at build time, so it includes the postseason
ladder. The database's own `soccer_score` matches for women but is ~1 point stale for men,
and its `national_ranking` is stale outright (Clemson stored 37, actual v6 rank 1) — so
neither database column is exported. One rank, from one source.

**Four-season record** — `{2022..2025}_W/_L/_D` and `{2022..2025}_ps`

`_ps` is the postseason round reached: `appearance`, `r32`, `r16`, `quarter`, `semi`,
`final`, `champion`. Low fill is expected — most programs do not reach the postseason.

**Staff and roster** — `head_coach`, `head_coach_title`, `head_coach_email`,
`head_coach_email_type`, `roster_url_2025`, `graduating_seniors_2025`

Only the actual head coach. `"Associate Head Coach"` and `"Assistant Head Coach"` both
contain the word "head", and taking the first match put the wrong person's name on
schools — titles are scored, and assistants, associates, GAs and shared team inboxes are
all excluded.

**Provenance** — `data_sources`, `identity_source`, `identity_notes`,
`conference_champion_source`, `conference_champion_notes`, `coach_source_url`

`data_sources` records which sources contributed to each row, e.g.
`records+db+v6+coach+grads`. `xsport` means a value was borrowed from the same
university's other-sport row; `identity_source` names it explicitly in that case.

## How the sources are joined

No single id spans all five sources, so rows are matched on school name. Vocabularies
differ in both directions — the coach files write "Adrian College" where the records file
says "Adrian", but the records file says "Colorado College" where another source says
"Colorado" — so matching is subset-based with the fewest extra tokens winning, and a tie
is **refused and reported** rather than guessed. 98.3% of men's and 97.4% of women's
coach-file schools land on a row; the residue are genuinely ambiguous names
(`Augustana`, `Maryville`, `Wilmington`) left blank on purpose.

"University" and "College" are kept as tokens, never stripped — stripping them collapses
Boston College onto Boston University and Colorado College onto Colorado.

Borrowing identity across the two sports requires an **exact** name match, which is
stricter than everything else here. Every looser rule was wrong in practice, because the
counterpart school is often simply absent from the other sport, leaving a same-named
neighbour as the best fuzzy candidate: "Florida State" (no men's programme) took *Eastern
Florida State's* identity, and allowing generic suffixes handed Colorado the identity of
*Colorado College*, Idaho that of *College of Idaho*, and Illinois that of *Illinois
College*. The cost of refusing is a blank field; the cost of guessing is the wrong
school's mascot in an outreach email.

## Known gaps

1. **Women's visual identity** — backfilled from Wikipedia infoboxes by
   `server/scripts/populateSchoolIdentity.js` (which is sport-agnostic: it fills any row
   missing a nickname, for either sport). Coverage and the verification applied to it are
   recorded in `identity_provenance.md` alongside this file.
2. **No 2025 conference champions for women** — that script has only been run for men (84
   schools). Same sentence, same value, just not collected yet.
3. **No graduating-senior counts or roster URLs for women** — `graduating_seniors` holds
   men's soccer only.
4. **NAIA men's records are now largely complete** — 191 of the 219 NAIA rows carry a
   W/L/D record, up from 85. That gap closed via a concurrent import, not this work; see
   `identity_provenance.md`, which also records the nine duplicate rows that import
   introduced and how they were resolved.
5. **No location data anywhere** — the `location` column is empty for all 2,282 database
   rows, so it is not exported rather than exported blank.
