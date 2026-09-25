# L7ZB — make the dataset line able to explain a behavioural movement

L7ZA changed 1,762 historical rows' `minutes_played` and nothing else, and
watched `PROGRAMME_POOL_BENCHMARK` move while **both** roster manifest
components reported UNCHANGED. The baseline was not wrong; the attribution layer
was incomplete.

**Manifest V3 → V4, with a new `roster_measurements` component.** The six
behavioural digests are byte-identical — every one wrote back to itself on
repin. No Evidence, pool, copy, permission, roster row or coverage figure moved.

---

## Containment

Started at `3738eaa`, nothing intervening, tree clean. `roster_players` 281,148,
coverage 1,748 / 1,731 / 17 / 14 / 3 = 99.0%, manifest `4955986edd3bc976` under
V3, six baselines PASS, P6. Every perturbation ran against a `VACUUM INTO` copy
or inside a rolled-back transaction.

## V3, and exactly why minutes were invisible

| component | projection |
|---|---|
| `players` | `id, full_name, sport, nationality, position, intended_major, recruiting_class_year` |
| `colleges` | `name, sport, unitid, division, conference` |
| **`roster_players`** | **`college_name, sport, season, player_name`** |
| `coaches` | `school, sport, full_name, position_title` |
| `athletics_domains` | `domain, unitid, status, role, confidence` |
| `programme_status` | `school, sport, status, reason, active_from_season, active_to_season` |
| `roster_freshness` | `MAX(updated_date)` per `(college_name, sport)` — **current season only** |

Digest: `canonical()` (recursive key-sorted JSON, `undefined` → null) → SHA-256.
Versions are **not comparable**: a pin from an older definition reports
`DEFINITION_CHANGED` and every product line reads `UNCOMPARABLE` rather than
`FAIL`.

**The cause, in one line:** the `roster_players` projection is *membership* —
who is on which squad in which season — and `roster_freshness` watches *when we
last looked* at the current season. A historical **measurement** is in neither.

This is the third time. K3A found timestamps missing (V1 → V2), L7O found
programme status missing (V2 → V3), and L7ZA found measurements missing. Each
time the symptom was identical: a behavioural hash moving while the dataset line
said nothing happened.

## What Evidence can actually read

The Evidence path loads roster rows through **exactly one projection** —
`ROSTER_COLUMNS` in `server/lib/philosophyQueries.js`, used by both
`programmeRows` (historical) and `squadRows` (current). **A column absent from
it is invisible to every generator by construction.** That boundary, not a
survey of column names, is what makes the field list provable.

| classification | fields |
|---|---|
| **A. behavioural input** | `position`, `class_year_label`, `minutes_played`, `games_played`, `games_started`, `estimated_graduation_year`, `eligibility_end_year`, `projected_minutes`, `nationality`, `country`, `hometown`, `prior_programme`, `source_roster_url` |
| **B. identity input** | `college_name`, `sport`, `season`, `player_name` |
| **C. provenance only** | `source_page_season`, `source_fetched_at`, `source_parser` (L7Z), `source_stats_url`, `data_confidence`, `notes` |
| **D. operational only** | `updated_date`, `created_date`, `created_by_id`, `id` |
| **E. unused by Evidence** | `division`, `conference`, `projected_minutes_season` |

Two entries need their reasons stated, because both look like the opposite of
what they are.

**`source_roster_url` is behavioural**, despite being a URL and despite L7Z
treating provenance as inert. `rosterSourceFor` in `evidenceQueries.js` resolves
the operator's verification link from it and returns `AMBIGUOUS_SOURCE` when a
programme-season carries more than one. It changes what an operator is shown, so
it is an input that happens to be a URL. The brief anticipated this case
explicitly, and the measurement confirms it.

**`division` and `conference` are unused** even though both words appear
throughout the Evidence code — those hits are `colleges.division` and
`colleges.conference`. The roster row objects handed to generators never carry
them, because `ROSTER_COLUMNS` does not select them.

**The L7Z provenance fields were not added merely because they exist.** No
generator can see them; a manifest that moved for a provenance repair would
report work that changed nothing anyone reads.

## The projection

`roster_measurements` = **`ROSTER_COLUMNS` minus `updated_date`**, seventeen
fields. A test pins that equality, so if `ROSTER_COLUMNS` ever gains a field the
manifest has to be told.

`updated_date` is excluded deliberately. It is a statement about when we looked,
`roster_freshness` already fingerprints it in the one form production reads, and
hashing it raw would move this component on every re-import — the L7D defect
that cost two behavioural surfaces their usefulness. Measured: restamping
**52,539** rows moves nothing.

**Ordering.** Rows are serialised and then **sorted**, so neither SQLite's row
order nor an index change can move the digest. Two identical player names in one
programme-season stay distinguishable; both are tested.

## Canonicalisation — production semantics, not new rules

| | rule | authority |
|---|---|---|
| numerics | `''` → null; numeric string → Number; so `998`, `'998'`, `'998.0'` are one value | the importer's `toIntOrNull` |
| text | `''` → null | the importer's `\|\| undefined` |
| zero | **a value, not an absence** | tested separately |
| `position` | hashed **as stored** | `normalizePosition` already runs at import — only 5 canonical values exist in 281,148 rows |
| `class_year_label` | hashed **raw** | `shared/philosophy.js` carries `classLabel: r.class_year_label` into output, so the exact spelling is itself behavioural |
| `season` | hashed as stored TEXT | philosophy does `String(r.season)`; 2022–2025 and 2026 stay distinct |

The live corpus has no representational ambiguity today — numerics are strictly
`integer` or `null`, text is strictly value-or-`NULL` with **zero** empty
strings — but the rules are defined so a future import that writes `''` or
`'998'` cannot invent movement.

## Split, not replace

The identity component stays and the measurement component is added beside it.
*"The squad changed"* and *"the same squad, measured differently"* are different
events with different causes, and one digest covering both would answer neither.
The report now prints which components moved, so the answer is legible:

```
roster_players       281148 rows  a6e400ae10e90736  unchanged
roster_measurements  281148 rows  81e0cebbccf9ef33  NEW
```

## Mutation matrix — everything behavioural moves it

Nineteen single-field mutations, each on a fixture row, all **MOVED**: player
added, player removed, player renamed, position, class year, minutes, games
played, games started, season, programme, sport, estimated graduation year,
eligibility end year, projected minutes, nationality, country, hometown, prior
programme, source roster URL.

## False-positive matrix — nothing else does

Ten mutations, all **unchanged**: `source_page_season`, `source_fetched_at`,
`source_parser`, `source_stats_url`, `data_confidence`, `notes`, `updated_date`
(every row), `created_date`, `division`, `conference`.

A manifest that flapped on provenance writes would be ignored within a month.
That is not a hypothetical: it is precisely what happened to the two surfaces
that hashed `rosterUpdatedAt` before `NON_BEHAVIOURAL_FIELDS` existed.

## The blind spot, closed — on the real corpus

| case | rows | V3 `roster_players` | V4 `roster_measurements` | `roster_freshness` | pool |
|---|---|---|---|---|---|
| **A** historical minutes only | 1,762 | **unchanged** | **MOVED** | unchanged | **MOVED** |
| **B** membership (players removed) | 50 | MOVED | MOVED | unchanged | MOVED |
| **C** `source_fetched_at` only | 64,700 | unchanged | unchanged | unchanged | unchanged |
| **D** `source_parser` only | 64,700 | unchanged | unchanged | unchanged | unchanged |
| **E** `source_roster_url` only | 28 | unchanged | **MOVED** | unchanged | unchanged |
| `updated_date` only | 52,539 | unchanged | unchanged | unchanged | unchanged |

Case A is the L7ZA finding exactly: V3 blind, V4 sees it, and the pool did move.
Case E is the interesting one — the measurement component moves because an
operator surface reads that URL, while the pool correctly does not.

## Other Evidence inputs V3 was also blind to

| mutation | rows | V3 | V4 | pool |
|---|---|---|---|---|
| `class_year_label` (freshman ladder) | 6,798 | unchanged | **MOVED** | **MOVED** |
| `position` (position groups) | 8,864 | unchanged | **MOVED** | **MOVED** |
| `estimated_graduation_year` (graduating cohort) | 33,246 | unchanged | **MOVED** | unchanged |

The projection covers more than the pool benchmark, which was the point of
tracing from every roster-reading kind rather than from the one that failed.
`estimated_graduation_year` is the clean demonstration: it moves the manifest and
not the pool, because it feeds a different kind.

## Version and baselines

**V3 → V4**, following the rule the file already states: a component list change
is a change to the *question* the digest answers, so old and new are
`UNCOMPARABLE` rather than PASS/FAIL. `LEGACY_MANIFEST_VERSION` becomes V3 so a
V3 pin stays nameable.

Manifest `4955986edd3bc976` (V3) → **`3854e1ec19d88c23`** (V4). Seven components
byte-identical; `roster_measurements` is NEW.

**The six behavioural digests are unchanged** — `16f5e4cdfb4af7f8`,
`279d05a0d284f577`, `4aac6a70ab6fab9c`, `acd24a40f554bcc7`, `5c92cdb5f022b03e`,
`6eaf3165211bb658`. Every one wrote back to itself on repin. This is a
**manifest pin, not a behavioural repin**: they read UNCOMPARABLE only because
the dataset definition moved underneath them, which is the designed behaviour
and not a product change.

## The attribution contract, going forward

* historical **measurements** change → manifest moves → a pool baseline movement
  is explained;
* roster **membership** changes → both roster components move, and the report
  says which;
* **provenance only** changes → nothing moves, so maintenance stays quiet;
* a provenance field that *acquires* a behavioural consumer must be added here —
  `source_roster_url` is the worked example of one that already has one.

## Remaining debt

`comparison.poolSize` still reports 1,202 against the 1,045 the quantiles used
(920 against 770 for men). **Untouched — reserved for L7ZC**, as is documenting
the pool cohort in the kind's definition. No pool behaviour, threshold, cohort,
permission or copy was changed here.
