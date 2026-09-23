# L7X — an import that may touch six programme-seasons and no others

L7W repaired six programmes' 2025 squads from season-pinned sources and then
could not put them in the database. `importRosterSheets.js` replaces a whole
`(sport, division, season)` slice per sheet, so reconciling six programmes meant
rewriting **2,122 programme-seasons and deleting 64,736 rows** — to change 219.

L7X makes the import addressable. It is containment only: **no roster row was
mutated, and every live artifact's hash is byte-identical to its value at
`1b59291`.**

```
broad   2,122 programme-seasons rewritten   64,736 rows deleted
scoped          6                                197
```

---

## Containment

Started at `1b59291`, nothing intervening, tree clean. `programme_status` 6,
`roster_gap_reviews` 7, coverage 1,748 / 1,731 / 17 / 14 / 3 = 99.0%, manifest
`dcfcf4dcb0947b52` under V3, six baselines PASS, P6. Hashed before and after:
content digests over `roster_players`, `athletics_domains`, `colleges` and
`programme_status`; the derived `roster_freshness` fingerprint; `_targets.csv`;
`state2026.json`; all six stage files; all twenty roster sheets.

## The existing importer

`server/scripts/importRosterSheets.js`, invoked only by `npm run import-rosters`.

| | |
|---|---|
| entry point | module scope — `run()` was **called on import** |
| callers | one: `package.json`'s `import-rosters`. No production code, no test |
| sheet loading | ten files per season, one per `(sport, division)`; a missing file is skipped, not an error |
| programme identity | `registrySchoolName(School, {sport, division})`, so the database name is the *resolved* one |
| season | a CLI argument, written into every row |
| write semantics | `RosterPlayer.deleteWhere({sport, division, season})` then `bulkCreate` — **replace the whole slice** |
| transactions | one per `bulkCreate`, so ten independent commits per season |
| removed players | deleted, as a side effect of the slice wipe |
| empty roster | a programme absent from the sheet loses every row |
| provenance | `Source Roster URL` and `Source Stats URL` carried verbatim; `Notes` carries the parser as prose |

### The risk, stated plainly

**A partial sheet is a deletion instruction.** The slice is the unit, so a sheet
holding six programmes deletes the other 343 in its file. That is correct for a
full re-import and unusable for a targeted one — and it is why L7W left its
repaired squads on disk.

**And the module could not be tested.** `run()` at module scope meant `import`ing
the file executed a full import against whatever season the ambient argv named.
An 800-line script that deletes rows has never had a test because there was no
way to load it without it writing first. Same defect L7Q found in
`build_targets.py`, in a file that deletes rather than rewrites.

## The canonical scoped identity

`School||sport||season` — the acquisition pipeline's own programme key
(`state.key`) with the season appended. Carried internally as a structured
`{ college_name, sport, season }`; the string exists for the CLI and for map
keys, because a concatenated key is a thing that can be built wrong silently.

```
Rutgers||mens-soccer||2025     Rutgers||womens-soccer||2025     Rutgers||mens-soccer||2026
```

Three distinct scopes, and no scope may address more than one. **Both dimensions
are load-bearing**: a programme key alone would carry 2025 and 2026 together, a
season alone would carry everything.

Matching happens **after** alias resolution, against the name the database
column holds. Matching the raw sheet spelling would silently miss every aliased
programme — the same defect that made 79 NAIA men's programmes invisible to
every join.

## Scope authority

```
npm run import-rosters                                  # broad, unchanged
npm run import-rosters -- --season 2025 --scope <file>  # scoped
                        --key 'Iowa||womens-soccer||2025'   # scoped, repeatable
                        --scope <file> --dry-run            # scoped, no mutation
```

A scope file is one entry per line; `#` comments and blanks are ignored. Order
is irrelevant — the plan sorts by key, and a test asserts the two orders produce
identical databases. `--scope` and `--key` together is an error: two scope
sources are two answers to "what may this import touch".

## Fail-closed

| condition | behaviour |
|---|---|
| no scope named | **broad mode** — the existing behaviour, for the existing caller |
| scoped mode entered, scope missing/unreadable | throws; never widens |
| `importScoped()` with no `scope` argument | throws — omitting it is not shorthand for the season |
| empty scope | **changes nothing**, reports zero entries. "Import these zero programmes" is a coherent instruction |
| malformed key | throws — wrong field count, empty school, unknown sport |
| missing or unsupported season | throws (`||`, `twenty-five`, `25` all refused) |
| duplicate entry | deduped, counted, reported |
| entry absent from the sheets | throws before the transaction opens; nothing written |
| entry ambiguous in the sheets | **STOP** — two division files claim it and the importer may not choose |
| `--dry-run` without a scope | throws; there is no broad dry-run |

No wildcard school, sport or season exists in scoped mode. **Scoped mode never
falls back to broad**: every unusable scope is an error.

## Dry run

`planScopedImport()` is the only selection and diff logic there is. The dry run
prints that plan; the live import executes it. A test asserts the two produce
identical per-entry insert/update/delete/unchanged/provenance shapes, so a
preview cannot describe an import that would not happen.

## Transactions

The broad path commits each sheet as it goes — ten independent transactions, so
a failure on the eighth leaves seven imported. For a targeted reconciliation
that is the wrong shape: **six repaired programmes are one decision, and three
of six is a state nobody asked for.**

The scoped path validates first — missing and ambiguous entries are reasons not
to start — then does all six deletes and inserts inside **one**
`better-sqlite3` transaction. Two tests cover rollback: one where validation
rejects an entry, and one where a failure is raised *inside* the transaction
after the first programme has been written. Neither leaves anything applied.

## Delete safety

The scoped delete is `(college_name, sport, season)` and nothing else.

**Division is deliberately absent from the delete key.** Including it would
leave a programme that changed division with its old rows still present and
outside every future scope — invisible to the very mechanism meant to address
it. Division is still written on each row, from the sheet that owns it.

A scope for `School A W 2025` cannot touch `School A W 2026`, `School A M 2025`
or `School B W 2025`, and tests 21–24 assert each of those separately.

## Freshness

**`roster_freshness` is not a table.** The manifest derives it as one
`MAX(updated_date)` per `(college_name, sport)` over the *current* season —
`rosterFreshnessFingerprint` in `evidenceBaseline.js`.

So scoping it is not a separate feature: a scoped 2025 import writes no 2026
row, and therefore cannot move 2026 freshness. That is asserted directly rather
than argued, and a second test confirms that freshness movement *within* 2025 is
confined to the scoped programme. No part of the freshness model was redesigned.

## Provenance

The importer **transports** roster facts; it does not establish source trust.

* The sheet's `Source Roster URL` is written verbatim. A test asserts that after
  importing the repaired scope, the only source URL on those rows is the
  season-pinned one — never the bare URL it replaced.
* Nothing is synthesised. `Data Confidence` is normalised from the sheet's own
  value, not invented.
* The page's season is never inferred from the database season. `season` comes
  from the scope, which the caller states.

## Tests

`server/scripts/importRosterSheetsScoped.test.js` — **30 tests, all passing.**
Network-free and database-free: six synthetic programme-seasons across two
institutions, two sports and two seasons, written to a temp directory with
`RECRUITMATCH_DB` pointed at a throwaway file.

The baseline is seeded **through the importer** from baseline sheets rather than
hand-written. Hand-deriving `estimated_graduation_year`, the position vocabulary
and the confidence casing put my own arithmetic inside the assertions, and
getting any of it wrong makes a row that should read *unchanged* read as an
update — which is the exact signal these tests exist to measure. Every
comparison is now importer-against-importer.

The 2026 sheets are written to **disagree** with the database on purpose: if a
2025 scope ever reached 2026, those rows would land and the test would see it.

### The property invariant

L7S's run containment, for the importer. Given arbitrary database state,
arbitrary sheet input and explicit scope R, for every programme-season key
`k ∉ R`:

    D_after[k] == D_before[k]      on every importer-owned field

Asserted exhaustively over all **eight** subsets of the three 2025
programme-seasons, and again over **200 randomised trials** with the sheets
regenerated to disagree each time. **0 leaks.**

## Caller inventory

| caller | mode | changed? |
|---|---|---|
| `package.json` → `npm run import-rosters` | broad | **no** |
| production code | none — nothing imports this module | — |
| tests | none existed; the new one uses the scoped and broad paths explicitly | — |

No caller's behaviour changed. The only structural change a broad run sees is
that `run()` is now reached through `main()` behind an
`import.meta.url === process.argv[1]` guard, so importing the module no longer
imports rosters.

## The six, derived structurally

**Not from the names.** 1,486 of the 2,123 accepted 2025 programmes satisfy
L7W's trustworthy-reference contract, so "has a good reference" does not
identify the repaired six. What distinguishes them is that **L7W rewrote their
sheets and deliberately did not import them**, so for exactly these
programme-seasons the sheet and the database disagree.

That difference is computed by the importer's own diff, run over a scope of
every programme-season the 2025 sheets hold. Of **2,122**, exactly **6**
disagree — which simultaneously re-proves L7W's containment claim.

| programme-season | div | sheet | db | +ins | ~upd | −del | =same | prov |
|---|---|---|---|---|---|---|---|---|
| `Boston University\|\|womens-soccer\|\|2025` | D1 | 28 | 34 | 0 | 28 | 6 | 0 | 28 |
| `Drexel\|\|womens-soccer\|\|2025` | D1 | 25 | 31 | 1 | 24 | 7 | 0 | 24 |
| `Iowa\|\|womens-soccer\|\|2025` | D1 | 30 | 28 | 13 | 17 | 11 | 0 | 17 |
| `Murray State\|\|womens-soccer\|\|2025` | D1 | 26 | 36 | 2 | 24 | 12 | 0 | 24 |
| `New Mexico\|\|womens-soccer\|\|2025` | D1 | 27 | 29 | 6 | 21 | 8 | 0 | 21 |
| `Oklahoma State\|\|womens-soccer\|\|2025` | D1 | 25 | 39 | 0 | 25 | 14 | 0 | 22 |
| **totals** | | **161** | **197** | **22** | **139** | **58** | **0** | **136** |

Every row of all six is an update or a move, and `=same` is zero — because the
repair changed each row's `source_roster_url` from the bare URL to the
season-pinned one, and that field is importer-owned.

**This is the exact L7Y preview. Nothing was written.**

## 2026 immunity

2026 immunity is a property of the **plan**, not a hope about execution: every
write the plan contains is addressed to a `(college_name, sport, season)`
triple, and the plan addresses **only 2025**.

```
seasons the plan addresses         : 2025
entries whose season is not 2025   : 0
2026 inserts / updates / deletes   : 0 / 0 / 0
2026 freshness rows it could move  : 0
```

The same six programmes hold 26, 24, 28, 26, 29 and 29 rows for 2026, each with
its own freshness timestamp, and the plan never names any of them.

## Broad versus scoped

| | broad 2025 | scoped six |
|---|---|---|
| programme-seasons considered | 2,122 | **6** |
| programme-seasons rewritten | 2,122 — every one, changed or not | **6** |
| db rows deleted first | 64,736 | **197** |
| sheet rows inserted | 64,700 | **161** |
| real changes | 219 | **219** |

The same 219 row changes, reached by deleting 197 rows instead of 64,736.

## Live-data immutability

Every hash byte-identical to its pre-L7X value: `roster_players`
(`30c30c61…`, 281,184 rows), the derived `roster_freshness` fingerprint
(`e0ba0955…`), all twenty roster sheets, `_targets.csv`, `state2026.json`, all
six stage files, `programme_status`, `athletics_domains`, `colleges`. Coverage
1,748 / 1,731 / 17 / 14 / 3 = 99.0%. Manifest `dcfcf4dcb0947b52` **UNCHANGED**,
six baselines **PASS**, no repin, P6 unchanged.

## Prospective provenance hardening — the ingestion point

Not implemented, as required. The point is **`run.build()` in
`tools/roster_pipeline/run.py`**, the one place an accepted roster becomes rows.

Three facts are already in hand at that moment and are discarded or flattened
into prose:

| fact | where it already exists | where it goes today |
|---|---|---|
| the page's own declared season | `lib.season_ok(title, season)` in the caller | nowhere |
| the fetch/capture time | the cache sidecar's `fetched_at` (L7U) | nowhere |
| the parser that read it | `parse_any`'s third return value | `Notes`, as prose |

The smallest hardening is three columns — `Source Page Season`,
`Source Fetched At`, `Source Parser` — written by `run.build`, carried in
`write_out.HDR`, and read by `recordsFromFile` into three new `roster_players`
columns. No new fetch, no new decision, no new policy: it persists what the
acquisition already established, at the only moment it is all still known.

That is what would stop the 641-programme problem recurring. **The 641 are not
repaired here** — a historical reference matters where it is being measured
against something, and 1,731 of 1,748 programmes now hold a current roster and
will not be re-measured. Retrospective repair should stay targeted, as L7W's was.

## Remaining debt

**L7Y is now a one-command stage**: the six scopes above, executed instead of
previewed, with the same containment proofs run afterwards. Everything else the
brief listed — the five remaining `TURNOVER_REFUSED`, the six
`PAGE_PRIOR_SEASON`, Bradley, George Mason, Valley Forge, the three
never-fetched, the registry duplicates — is untouched.
