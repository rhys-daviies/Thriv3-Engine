# Competitive Intelligence V1 — release record

*Phase 12H. What was merged, what was loaded into the production database, how to
rebuild it, and how to undo it.*

| | |
|---|---|
| merged | `2a8521c` (`--no-ff`, nine commits preserved) |
| source branch | `research/competitive-programme-intelligence` @ `b156759` |
| previous main | `2555ff7` — matched `origin/main`, zero divergence, zero commits behind |
| production database | `server/data/recruitmatch.sqlite` |
| size before | 210,649,088 bytes · 14 tables · 38 schema objects |
| pre-release backup | `server/data/recruitmatch.sqlite.pre-competitive-v1-2026-09-01T09-14-40-608Z` (200,114,176 bytes, `VACUUM INTO`, `integrity_check: ok`, opened and row-counted after writing) |
| completed | 2026-09-01T09:41Z |

## 1. The seven tables, and which importer owns each

None of the seven existed in `main`'s schema or in the production database, so
all seven are new. The "six tables" in the Phase 12G report was wrong: it counted
the six introduced by 12D's schema commit and missed `programme_seasons`, which
`0f1b4f0` introduced two phases earlier. Seven is the number.

| table | rows | introduced by | populated by |
|---|---|---|---|
| `programme_seasons` | 8,685 | `0f1b4f0` | `importProgrammeSeasons.js` |
| `institution_aliases` | 2,337 | `735092b` | `importInstitutionAliases.js` |
| `athletics_domains` | 2,717 | `735092b` | `verifyAthleticsDomains.js` |
| `conference_seasons` | 960 | `735092b` | `importConferenceSeasons.js` |
| `programme_conference_seasons` | 7,219 | `735092b` | `importConferenceSeasons.js` |
| `conference_membership_quarantine` | 1,330 | `735092b` | `importConferenceSeasons.js` |
| `conference_members_official` | 968 | `6d66ba7` | `importOfficialMembership.js` |

The schema migration added exactly those seven tables and eight indexes, removed
nothing, and left every pre-existing table byte-for-byte unchanged (13 tables
row-counted before and after).

## 2. Rebuilt, not copied

No staging table was copied. Every row was produced by the supported importers
reading the approved artefacts, all of which are offline — none of the five
importers contains a single `fetch`. `verifyAthleticsDomains.js` consumed the
stored head-probe evidence; **no live re-verification was performed and none was
needed.**

| artefact | md5 |
|---|---|
| `~/Documents/Thriv3/Soccer Records/soccer_records.csv` | `2473871e250e6992e988da94a5380225` |
| `~/Documents/Thriv3/Soccer Records/soccer_records_women.csv` | `63373fd67de5604215f4e14715bba258` |
| `~/Documents/Thriv3/Competitive Collection/athletics-domain-evidence.json` | `630597b119e8043a3b2d6004006689f8` |
| `~/Documents/Thriv3/Competitive Collection/ncaa-conference-membership.json` | `070330306f111566bf090de7954327db` |
| `~/Documents/Thriv3/Competitive Collection/conference-standings.json` | `3066cec3ea6c517288af20300d527551` |
| `tools/soccer/verification/known_domains.json` | `83d4924167c868b4018e53525c4b4079` |

## 3. The order, and why it is not the obvious one

Dependencies read from the code, not assumed:

```
1  importProgrammeSeasons.js  --apply     # colleges only
2  importInstitutionAliases.js --apply    # colleges + curated; athletics_domains still empty
3  verifyAthleticsDomains.js  --apply     # needs the alias table to resolve page titles
4  importInstitutionAliases.js --apply    # now picks up the athletics-site name aliases
5  importOfficialMembership.js --apply    # artefact only
6  importConferenceSeasons.js --apply     # needs 1, 4 and 5
```

`institution_aliases` and `athletics_domains` are **mutually derived**: the alias
table adds athletics-site names taken from the domain table, and the domain audit
resolves page titles through the alias table. Steps 2–4 are that bootstrap.

Step 5 is not optional and not last. Running step 6 before it produced 7,208
membership rows instead of 7,219 — the `OFFICIAL_ROSTER_CONTRADICTS` guard cannot
fire without `conference_members_official`, and 10 rows that the official-membership
tie-break resolves fell to `MEMBERSHIP_AMBIGUOUS` instead. With the correct order
the count is exact.

## 4. Reconciliation

| table | verified reference | production | difference |
|---|---|---|---|
| `programme_seasons` | 8,685 | 8,685 | — |
| `programme_conference_seasons` | 7,219 | 7,219 | — |
| `institution_aliases` | 2,344 | 2,337 | **−7**, see §5 |
| `athletics_domains` | 2,717 | 2,717 | — |
| `conference_membership_quarantine` | 1,330 | 1,330 | — |
| `conference_members_official` | 968 | 968 | — |
| `conference_seasons` | 960 | 960 | — |
| `coach_seasons` | 8,605 | 8,595 | **−10**, deliberately not applied, see §6 |

Everything else matched on the first correctly-ordered run: division coverage
83.7%, 32 pools with a smallest of 125, 133 conference movers, 32 division
movers, 7,134 confirmed membership rows.

## 5. A determinism defect in the alias/domain bootstrap

Because the two tables derive from each other, iterating the bootstrap does not
converge — it **oscillates with period two**:

| round | aliases | `WRONG_INSTITUTION` domains | published membership rows |
|---|---|---|---|
| odd | 2,337 | 57 | 7,219 |
| even | 2,330 | 65 | 7,219 |

More aliases make more page titles ambiguous, the collision rule refuses them,
fewer domains verify, and the next alias pass therefore offers fewer names. The
verified reference (2,344 aliases, 1,805 resolved domains) sits outside that
orbit and **cannot be rebuilt from cold by the current code** — the same code run
against the staging database does not reproduce staging's own stored domain table
either. Both stored states are fossils of the order the research phases happened
to use.

**It does not reach a reader.** The published membership layer is invariant at
7,219 rows and 7,215 with a division across the whole orbit, measured three ways:
odd round, even round, and staging's fossil alias set. The seven aliases that
differ resolve **zero** membership rows — checked by name against every
`member_raw` in the table. Production is pinned at the odd-round state (2,337 /
57).

Recommended fix for a later phase, out of scope for a release: break the cycle by
having `verifyAthleticsDomains` resolve using only the curated and
`colleges`-derived aliases, never the `ATHLETICS_NAME` aliases derived from its
own output. That makes the pipeline a function of the artefacts alone.

## 6. The coach rows: investigated, not applied

Phase 12G reported "+10 `coach_seasons` rows". The real difference is 15 rows only
in staging, 5 only in production and **51 rows with the same key and a different
`coach_name`** — and the 51 are the interesting ones. Production currently stores,
as head coaches:

- academic majors — `Construction Management` (Wentworth men's, five seasons),
  `Emergency Management`, `Criminal Justice`, `Computer Science`, `Health Sciences`,
  `Marine Engineering`, `Biological Sciences`, `Sports Management`;
- players' high schools and hometowns — `Gray Collegiate Academy`, `Glen Allen HS`,
  `Blue Hills Regional Tech.`, `The Forman School`, `Detroit Lakes`, `East Grand
  Forks`, `Grand Blanc`, `Park City`, `Old Saybrook`.

The scraper read the cell next to the coach. **The branch fixes this at read time**
(`nonPersonWitness` in `shared/coachTenure.js`), so merging the code alone
neutralises **46 of the 51** without touching a row. Five survive, because the
third witness — the value appears as a hometown on the programme's own roster —
needs the roster and lives in the importer:

| programme | season | stored as coach |
|---|---|---|
| Concordia College-Moorhead women's | 2025 | East Grand Forks |
| Concordia College-Moorhead women's | 2026 | Detroit Lakes |
| Northwood men's | 2022 | Grand Blanc |
| Ohio Northern men's | 2024 | Park City |
| Suffolk men's | 2023 | Old Saybrook |

The 15 additions are the USCAA schools and a rename (Bay Path, Penn State
Schuylkill, `Shawnee State University` → `Shawnee State`).

**Not applied here.** Clearing the residual five requires re-running
`importCoachTenure.js`, which fetches rosters live — new collection, a different
layer, and its own verification. Competitive Intelligence V1 does not depend on
it: `coach_seasons` already exists in production and the competitive coach block
reads whatever is on file. It is a follow-up release, and it is a real product
defect on five programmes today.

## 7. Verified against production

| gate | result |
|---|---|
| `PRAGMA integrity_check` before migration | ok |
| `PRAGMA integrity_check` after | ok |
| `npm test` on main | 83 files, **1,976 passed** |
| `npm run verify:baseline` on main, production-backed | **139 passed, 0 failed** |
| `npm run snapshot:pi -- --check` on main, production-backed | **0 differences** |
| identity sweep | 0 wrong-institution, 0 unresolved, 0 ambiguous, 0 state-conflicting, 0 double-conference, 0 two-year colleges, 0 Rochester 2023 rows, 0 Rochester NAIA rows |
| package sweep | 2,125 of 2,152 available (98.7%), **0 confirmed correctness errors** |
| representative reports | 9 of 9 carry both pages, 0 defects; Mercyhurst D2/D2/D1/D1, California Pac-12/Pac-12/ACC/ACC, Rochester women 2022 UAA / 2023 unavailable / 2024–25 UAA with no WHAC and no NAIA, Albertus Magnus GNAC across all four |
| stratified sweep | 506 programme + 36 athlete reports, **0 defects**, page-count distribution identical to the pre-merge verification |

## 8. The silent-disappearance regression

Demonstrated on a copy of the pre-release backup with the schema created and no
rows in it: **0 of 300 programmes had a package**, both Competitive sections were
absent from the plan, and the report built and rendered without throwing — 14
sections instead of 16. A deployment can lose this entire layer with no error
anywhere.

`verifyBaselineInvariants.js` now carries a group that fails on it: a row floor
for six of the seven tables, existence for the quarantine byproduct, a confirmed-
membership floor, and an end-to-end check that a package is available for at
least 90% of the report universe. Against the empty database it produces eight
failures and a non-zero exit; against production, nine passes.

It is **system-wide by construction**: 27 programmes legitimately have no readable
competitive season, and no report fails because one programme is sparse.

## 9. Traceability

`sync_state` is a key/value table that already existed, so no schema change was
needed. `sync_state['competitive_v1_release']` holds the code SHA, the import
timestamp, the md5 of every source artefact and the row count of every table.
Each table also carries its own `imported_at` (or `checked_at`).

```sql
SELECT value FROM sync_state WHERE key = 'competitive_v1_release';
```

## 10. Rollback

**Code.** The merge is a single commit with two parents:

```bash
git checkout main
git revert -m 1 2a8521c        # keeps history; undoes the merged tree
```

Or, only if `main` has not moved and nothing else has been committed on top:

```bash
git reset --hard 2555ff7
```

The nine branch commits and `research/competitive-programme-intelligence` are
untouched either way, so the merge can simply be redone.

**Database.** Two options, in increasing severity.

*Drop the layer, keep everything else* — the competitive tables are the only
things this release wrote, and no pre-existing table was touched:

```sql
DROP TABLE programme_conference_seasons;
DROP TABLE conference_membership_quarantine;
DROP TABLE conference_members_official;
DROP TABLE conference_seasons;
DROP TABLE athletics_domains;
DROP TABLE institution_aliases;
DROP TABLE programme_seasons;
DELETE FROM sync_state WHERE key = 'competitive_v1_release';
```

*Restore the whole file* — stop every process holding the database first, because
replacing the file under an open SQLite connection is what corrupts it:

```bash
cp server/data/recruitmatch.sqlite.pre-competitive-v1-2026-09-01T09-14-40-608Z \
   server/data/recruitmatch.sqlite
rm -f server/data/recruitmatch.sqlite-wal server/data/recruitmatch.sqlite-shm
```

The backup was verified after writing — `integrity_check: ok`, 14 tables, 2,404
colleges, 276,745 roster rows, 8,595 coach-seasons — and rollback was **not**
tested destructively against production.

`importProgrammeSeasons.js` took its own backup on the way through, at
`server/data/recruitmatch.sqlite.pre-programme-seasons-2026-09-01T092200195Z`.

## 11. Left running

Two `node server/index.js` processes were live against the production database
throughout (one from 14:03 today, one from Sunday), plus vite. They hold the
pre-merge code in memory and will not serve the Competitive pages until they are
restarted. Nothing was killed; the database was written through WAL alongside
them and `integrity_check` is ok.
