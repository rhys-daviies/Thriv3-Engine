# Academic rating — raw stores

Raw first, score second. Nothing here is a rating; the rating is derived from
these by `tools/academic/build_academic_scores.py` in the app repo, and can be
rebuilt from scratch without re-collecting anything if the weighting changes.

| file | rows | what it is |
|---|---|---|
| `Most-Recent-Cohorts-Institution.csv` | 6,500+ | College Scorecard bulk release, unmodified. 3,308 columns. Federal IPEDS data, downloaded from ed-public-download.scorecard.network. Re-downloadable; kept so the extract is reproducible offline. |
| `academic_raw_scorecard.csv` | 2,664 | the 27 columns we use, for bachelor's-granting institutions still operating |
| `academic_raw_usnews.csv` | 1,029 | one row per US News profile: rank, category, city/state, SAT range, class size, founding year |
| `academic_crosswalk.csv` | 1,336 | our school name -> UNITID, with the basis each match was accepted on |
| `academic_unmatched.csv` | 1 | anything the crosswalk refused to guess at |
| `academic_inputs.csv` | 1,029 | the two sources joined, one row per institution, plus the derived rating |
| `academic_scores.csv` | 1,029 | rating per institution, sorted |

The deliverable is one level up: `academic_ratings_final.csv`, one row per
school name (1,336), which is what the app keys on.

## Why two sources

Scorecard is keyed on UNITID, a stable federal id, so a join cannot silently
land on the wrong school the way a slug can — US News routes on a numeric id
its slug does not have to agree with, which is how Cal State Bakersfield came
to hold Cal State Dominguez Hills' rank.

US News is kept for two things Scorecard lacks: the rank and category, which
are how the rating gets validated, and an SAT range that covers 70% of these
schools where Scorecard's average covers 38%.
