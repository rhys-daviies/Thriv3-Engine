# Data integrity — annual refresh procedure

This is the operating procedure for refreshing Thriv3's programme, roster, coach, email,
domain and division data every year **without re-creating the defects Phases 1–7 removed**:
wrong-school coaches, same-name institution mix-ups, branch-campus contamination, NCAA/NAIA
cross-division errors, stale coaches, guessed emails, wrong domain owners, destructive
overwrites, wrong UNITIDs and duplicate programmes.

You do not need to have seen Phases 1–7 to follow it.

---

## The one rule

**Nothing you gather is written to the canonical database directly.**

```
GATHER → STAGE → RESOLVE → VALIDATE → DIFF → REVIEW → PROMOTE → MONITOR
```

- `npm run integrity:refresh` stages and reports. It never changes a canonical table.
- `npm run integrity:promote` is the **only** command that writes. It simulates on a copy,
  checks 12 integrity gates, and applies only what passed (and, where required, what a person
  approved).
- Old import scripts that wrote directly (domain rebuilds, alias rebuilds, roster sheet imports,
  coach tenure imports, matching-input loads, seeds) now **refuse** on this database. They can be
  forced with `--legacy-write-ack --reason "…"`, but only as a documented emergency, followed by
  `npm run integrity:monitor`.

Newer data is not automatically truer. Existing data is not automatically right forever. When
they disagree, the system says so and a person decides.

---

## Words used here

| Term | Meaning |
|---|---|
| **Athletics entity** | The institution or campus that actually runs the teams (`athletics_entity_id`). IU Columbus and IU Indianapolis share one federal UNITID but are two entities. |
| **Federal UNITID** | The entity's *own* six-digit IPEDS number, or nothing. Never guessed, never an 8-digit College Navigator location code. |
| **Programme** | Entity + sport (one active `colleges` row carries it). |
| **Membership period** | Division / conference / status over a range of seasons (`programme_membership_periods`). The open period is "now". |
| **Row link** | Two `colleges` rows that are one programme (alternate spelling, superseded division row, phantom row). Nothing is merged or deleted. |
| **Season freeze** | A fingerprint of a finished season. After a freeze, that season is read-only to refreshes. |
| **Batch / observation** | One refresh run, and one record inside it (a coach, a player-season, a membership, a host). |

---

## Commands

| Command | What it does | Writes |
|---|---|---|
| `npm run integrity:gather -- --db <db> --plan <plan.json> --season 2026 --scope NJCAA --out <gathered.json> [--report <f>]` | Run the adapters (roster, staff, programme listing) over a plan of targets. The database is opened read-only. Refused pages go to the report. | the gathered file only |
| `npm run integrity:refresh -- --db <db> --input <gathered.json> --season 2027 --division NAIA` | Stage + resolve + classify + diff report. **Dry run by default.** | nothing |
| `… integrity:refresh … --stage` | Same, and saves the batch for review. | staging tables only |
| `npm run integrity:promote -- --db <db> --batch <id> --batch-hash <hash> [--reviews <file>]` | Simulate on a copy, run the 12 gates, print what would change. | nothing |
| `… integrity:promote … --apply [--manifest-out m.json]` | Apply in one transaction, re-measure, auto-revert if the result differs from the simulation. | canonical |
| `npm run integrity:promote -- --db <db> --revert <promotion_id or manifest> --apply` | Undo a promotion. | canonical |
| `npm run integrity:monitor -- --db <db>` | Recurring checks (identity, coaches, rosters, domains, programmes, NAIA freeze). Exit 1 on a HARD finding. | nothing |
| `npm run integrity:freeze -- --db <db> --season 2026 --apply` | Freeze a finished season. `--verify` re-checks every freeze. | season_freezes |
| `npm run integrity:identity -- --db <db>` | The identity invariant alone (H1–H11). | nothing |

Never point any of these at production (`/data/...` paths are refused).

---

## The annual calendar

### 1. Before the season (June – July)

1. **Programme membership.** Gather the governing bodies' membership lists and conference
   announcements. Stage them as `PROGRAMME` pages (division, conference, status, the season
   they take effect). Also stage each division's *complete* membership list; any held programme
   missing from it becomes an investigation.
2. Read the **PROGRAMMES** section of the report:
   - *division / membership changed*: a transition. Needs a tier-A source (the governing body)
     or two independent tier-B sources (e.g. the conference's announcement and the school's own
     schedule). Approve it in review; it closes the old period at the season before and opens the
     new one. **It never edits past seasons.**
   - *discontinued* / *added*: always reviewed. A discontinued programme is made inactive, never
     deleted.
3. **Identity and domains.** Stage `DOMAIN` observations for any new or moved athletics site.
   A host is accepted only with the full chain: the institution's own site links to it, and the
   host names the institution about itself. Collisions (the page names another institution at
   least as specifically), shared platforms (`*.prestosports.com`, `sidearmsports.com` …) and
   hosts already owned by someone else are refused or sent to review.
4. Re-check memberships whose `review_due_season` has arrived. The monitor lists them. Example:
   Shawnee State's provisional NCAA D2 status is due in 2028.

### 2. Roster publication (August – September)

1. Gather official rosters (roster pipeline) and stage them as `ROSTER` pages with the season
   the page itself shows (`page_season`).
2. The pipeline refuses on its own:
   - a page for a different season than claimed;
   - a frozen season;
   - staff rows on a roster;
   - a page on a host the programme's entity does not own;
   - names that appear twice on the same page.
3. Review the **ROSTERS** section:
   - *added player-seasons* promote.
   - *transfer candidates* are flagged, never linked automatically.
   - *changed class/position*: a held value is never overwritten. Empty fields are filled.
   - *departed*: players absent from a complete roster stay in history; nothing is deleted.
     A player missing from next year's roster simply has no new row.
4. Promote.

### 3. Coaching changes (main pass July – September; spot pass October – November; light pass January – February)

1. Gather each programme's **official staff page**, one fetch per programme. Only record an
   email address that is **printed on the page** (`email_origin: PUBLISHED_ON_SOURCE`). Anything
   else is discarded at staging and never stored.
2. What happens to each person:
   - **Unchanged.** Currentness and "email seen" are refreshed. This promotes on its own.
   - **New person.** A new coach row is created, with the address only if it was published.
     This promotes on its own.
   - **Same person, different published address, old address gone from the page.** This is an
     email change and needs review. If the old address is still on the page, it is only a
     possible change.
   - **Head coach absent, with a named successor in the role.** This is a stale candidate. On
     review they are marked `PROVEN_STALE`; the row is kept.
   - **Anyone absent without a successor.** This opens an investigation (one page's absence is
     not proof of departure). Nothing is written.
   - **A stale coach seen again.** Reinstatement needs review.
3. Pages that can never establish a current coach: archived pages, Wayback copies, prior-season
   pages, search results, aggregators, and any page on a host the programme's entity doesn't own.
   One example is the parent university's directory for a branch campus.

### 4. During the season

- Run `npm run integrity:monitor` weekly and after every promotion.
- HARD findings mean stop and investigate: an identity invariant break, a changed frozen season,
  an inferred/stale/wrong-sport eligible coach, a trusted host redirecting to another
  institution, or NAIA changing without a guarded promotion.
- Structural changes found mid-season go through the same refresh → promote path.

### 5. End of season (December)

1. Run a last roster and coach pass for the season, then promote.
2. **Freeze the season:** `npm run integrity:freeze -- --db <db> --season 2026 --reason "season complete" --apply`.
3. Open the next cycle: new gathers use `--season 2027`.

---

## Reviewing a batch

1. Read the report written by `integrity:refresh`. The unredacted one stays in
   `server/data/generated/refresh/`; never commit it.
2. Write a review file for the items marked **[review]**:
   ```json
   [ { "observation_id": "RO-…", "decision": "APPROVED", "note": "MEC announcement + official schedule" },
     { "observation_id": "RO-…", "decision": "REJECTED", "note": "page is the 2026 staff list" } ]
   ```
3. Run `integrity:promote` without `--apply` and read the gates. Then run it with `--apply`.
4. Keep the manifest (`--manifest-out`). It reverts the promotion exactly.

**Always reviewed:** division / membership changes, new or discontinued programmes, replaced
emails, departures (`PROVEN_STALE`), reinstatements, changes of domain owner, and anything that
names another institution's roster.

**Never done by a refresh:** deleting a coach, a programme or a roster row; merging programmes
physically (they are linked); rewriting a closed membership period or a frozen season.

---

## Source authority (what may establish what)

| Tier | Sources | May establish |
|---|---|---|
| **A** authoritative current | the entity's own athletics/staff/roster pages, the institution directory, the governing body's membership directory, NCES/IPEDS | identity, current coach, email seen, CURRENT, roster, division, domain ownership (with the chain); federal UNITID only from NCES |
| **B** authoritative supporting | conference site, institutional announcement, official schedule | conference, programme status; division only with **two independent** tier-B sources |
| **C** historical | archived official page, prior-season page, Wayback | history only (past coach seasons, past rosters) |
| **D** discovery | search results, aggregators, recruiting sites, guessed patterns | nothing. Leads only. |

A page's declared kind is a claim. Its tier is computed from where it actually lives.

## Identity order (how every record finds its programme)

1. Known athletics entity id.
2. The page's host (host-level ownership first: `gilbert.parkathletics.com` is Park Gilbert's,
   not Park's).
3. An alias tied to an entity.
4. A federal UNITID. A UNITID that is the parent of campuses cannot choose a campus.
5. A parent relationship plus an exact programme name inside it.
6. The exact programme name. This counts as "name only" and never promotes anything alone.
7. Otherwise: review. Fuzzy name matches are shown as candidates, never used.

If two of these disagree (the page is on Concordia Texas's site but names "Texas"), the record
is a **contradiction**, never a quiet choice.

## Freshness (how old evidence may be)

Cycles run 1 July – 30 June. A check is **CURRENT** if made this cycle, **AGING** last cycle,
**STALE** before that, and **UNKNOWN** if never made.

| Evidence | Measured by |
|---|---|
| Coach currentness, email seen | the date of the last official-page observation |
| Rosters | the latest season on file. A prior-season roster is AGING until 1 October, then STALE. |
| Membership | the last tier-A/B verification. Rows seeded at the Phase 7E cut-over are UNKNOWN until first verified. |
| Domains | the last verification |

A stale check means "re-verify". It **never** marks a coach as departed.

---

## Gathering (adapters)

`integrity:gather` produces the input for `integrity:refresh`. The adapters live in
`server/lib/refresh/adapters/`. They cover PrestoSports (table and card themes), Sidearm, and
region/conference team listings. They never write the database.

A page is **refused**, and written to the report instead of the gathered file, when it is:
- blocked (403 / 429 / 503, a 202 or AWS-WAF bot challenge, Cloudflare, a tiny body);
- for an older season, or a different sport;
- mostly staff when a roster was expected;
- on a shared platform root, or it redirects to a foreign host;
- on a host the entity does not own;
- ambiguous;
- empty;
- or much shorter than last year (a collapse).

**A refusal is never evidence that a programme, player or coach disappeared.**

Some Presto hosts challenge every non-browser request. Others challenge once the request rate
across Presto rises. Gather serially, one request every ≥ 6 s. A host still challenged after one
retry is recorded `BLOCKED` and left for a serial real-browser pass. Never retry it in a loop.

**Registering a host.** Discovery proves an ownership chain: the institution's site links to
the host, and the host names the institution. That chain cannot tell an athletics site from the
institution's own main site, because that site always links to and names itself. So:
- the institution's main domain is never registered as an athletics site;
- an institution subdomain is accepted only if it looks like an athletics site: an
  `athletics`/`sports`/`go…` label, or a Sidearm/Presto site that is not admissions, esports or a
  portal;
- a host already owned or decided on the DB is never changed by a registration fixture.

Phase 8A held 38 institution domains and 2 non-athletics subdomains under this rule.

**Check the parse before you stage.** Some responsive Presto rosters print a mobile-only
duplicate cell and hidden "No.:" labels. Before `presto-roster-2`, those shifted every column,
and each player's name read "No.:". The staging classifier caught it as IDENTITY_AMBIGUOUS.
When a whole roster stages as ambiguous, inspect the parse before looking at the people.

## Divisions still being established (NJCAA, USCAA)

These have no coverage freeze. The monitor reports them against `shared/njcaaUscaaBaseline.json`:
- universe drift (WARN);
- unverified or stale memberships;
- unresolved entities;
- single-gender entities;
- entities without a trusted host.

Membership comes from region/conference team listings (tier B) or theuscaa.com (tier A). A
prior-season listing (tier C) is history, never current membership. A Thriv3 programme that
appears on no listing is **queued, not deactivated**, unless a complete listing proves its absence.

## Coach floor (runtime)

Every recipient chokepoint uses `server/lib/coachEligibility.js`:
- coach lists;
- campaign selection;
- the send route;
- the execution claim;
- the draft CLI;
- the composer.

A coach is outreach-eligible only with a usable, verified email, and only if not `PROVEN_STALE`.
The send route also checks that the address belongs to the programme (alternate row names
included). Legacy behaviour is available only with `THRIV3_ALLOW_LEGACY_COACHES=1`, and is for
tests that model it. Never set it in a deployed environment.

## When something goes wrong

| Message | Meaning / what to do |
|---|---|
| `batch hash mismatch` | The staged batch changed after review. Re-stage and re-review. |
| `expected-old … mismatch` / `SIMULATION REFUSED` | The database moved since staging. Re-stage. The whole batch was rolled back. |
| `GATE FAIL G10` | A membership change isn't explained by an op in the batch. Find what else changed the division or coverage. |
| `GATE FAIL G9` / monitor `frozen_season_changed` | A finished season was altered. If it was a deliberate correction, re-freeze with `--refreeze --reason`. Otherwise restore it. |
| `integrity-managed` refusal from an old script | Use refresh → promote. Force it only with `--legacy-write-ack --reason "…"`, then run the monitor. |
| `POST-APPLY MISMATCH … reverting` | The live result differed from the simulation. It was reverted automatically. Investigate concurrent writers (the dev database is shared by several checkouts). |

## Files

- Code: `server/lib/refresh/` (authority, identity, classification, temporal, staging, promotion,
  gate, diff, freshness, policy, guard); `server/scripts/integrity*.js`.
- Invariant: `server/scripts/validateAthleticsEntityIdentity.js` (H1–H11) and
  `shared/athleticsEntityExceptions.json` (only unresolved cases remain there).
- NAIA freeze: `shared/naiaIntegrityFreeze.json`.
- Regression fixtures: `server/lib/refresh/regressionWorld.js` and its tests. If one of them
  fails, a known defect has come back.
