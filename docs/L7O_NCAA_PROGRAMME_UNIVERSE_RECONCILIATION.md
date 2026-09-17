# L7O — which programmes belong in the 2026 NCAA universe

**A decision document. Nothing was changed.** No registry mutation, no roster
acquisition, no review written. Datasets, reviews, state, manifest and baselines
are all exactly as L7N left them.

---

## Executive decision summary

Three things came out of this stage, and the second two were not what the brief
expected.

**1. None of the nine remaining gaps is an active 2026 programme.** Five are
confirmed not active, one begins in 2027, one is an institution that no longer
exists, and two are genuinely unknown. Every finding rests on the institution's
own website or its conference's.

**2. The schema already does what the brief feared it could not.** `colleges` is
keyed `(name, sport)` — it is **programme-level, not institution-level** — and
there is live precedent: Montana State Billings carries `mens-soccer active=0`
and `womens-soccer active=1` under one unitid. So the Wisconsin-La Crosse
catastrophe the brief warned about **cannot happen**: switching off men's soccer
there cannot touch women's soccer or the institution.

What `active` genuinely cannot do is anything temporal or reasoned. It is one
boolean with no season, no reason and no source, and **Wisconsin-Oshkosh is the
case that breaks it** — a programme that is not active in 2026 and starts in
2027 would have to be recorded as permanently off.

**3. "1,745 rostered" is not a 2026 number.** The coverage figure this roadmap
has been quoting counts a roster in *any* season. **Only 1,607 NCAA programmes
have a 2026 roster; 138 are counted on the strength of an older one.** Both
numbers are true and they answer different questions, but the headline has been
reading as though it meant 2026. That is the largest single finding here and it
is independent of the nine.

**Recommended:** approve a new `programme_status` table rather than touching
`colleges.active`, and hold `UNKNOWN` and `IDENTITY_TRANSITION` inside the active
denominator until a person decides them.

---

## Current universe model

**Programme existence** is owned by `colleges`. One row per `(name, sport)`,
enforced by `UNIQUE INDEX idx_colleges_name_sport`. 2,404 rows, 2,404 distinct
`(name, sport)` pairs, 1,867 distinct names — so a school appears once per sport.

**Programme active status** is owned by `colleges.active`, on that same
programme row. It is therefore already programme-level.

**The target universe** is `rosterTargetUniverse()`:

```sql
SELECT name AS school, sport, division, conference, unitid, active
  FROM colleges
 WHERE division IN ('NCAA D1','NCAA D2','NCAA D3')
   AND sport IN ('mens-soccer','womens-soccer')
   AND active = 1
```

**The gap queue** (`--gap-keys`, and L7K's read model) is that universe minus
programmes holding a roster, minus duplicate rows whose twin holds one.

**Programme key** is `School||Sport`, built by `state.key()` and `gapKey()`.

### Is `colleges.active` institution-level? No — and here is the proof

| name | sport | unitid | active |
|---|---|---:|---:|
| Montana State Billings | mens-soccer | 180179 | **0** |
| Montana State Billings | womens-soccer | 180179 | **1** |

Same institution, same unitid, one programme off and one on. All three currently
inactive rows are `mens-soccer` only. **The representation the brief asked for
already exists and has been used.**

### What it cannot represent

`active` is `INTEGER DEFAULT 1`. It has no season, no reason, no source, no
review date. So it cannot say:

- *not active in 2026, active from 2027* — Wisconsin-Oshkosh
- *active through Spring 2026, then the institution closed* — Anna Maria
- *the institution merged and this programme was not carried over* — NJCU
- *we do not know* — Bryn Athyn

And crucially, **`FUTURE` and `NOT_ACTIVE` would be the same value**, which would
quietly delete Wisconsin-Oshkosh's 2027 launch from the system.

## Status semantics

Four states, which is the fewest the nine real cases need:

| status | meaning | in the active denominator? |
|---|---|---|
| `ACTIVE` | fielded this season | yes |
| `NOT_ACTIVE` | not fielded this season, with a reason | no |
| `FUTURE` | not yet fielded; a start season is known | no, until that season |
| `UNKNOWN` | insufficient evidence | **yes** — absence of proof is not proof |

With a reason, because "not active" for four different causes is four different
follow-ups:

`INSTITUTION_CLOSED` · `NOT_SPONSORED` · `IDENTITY_TRANSITION` · `LAUNCHING`

**Temporal model: seasons, not dates.** A soccer season is a year label the whole
pipeline already speaks (`RB_SEASON`, `season='2026'`), and a date would invite
arguments about when a season begins. Two fields suffice: `active_from_season`
and `active_to_season`, either nullable.

- Anna Maria: `active_to_season = 2025` — it played through Spring 2026 and the
  2026 soccer season is the following autumn, which it will not play.
- Wisconsin-Oshkosh M: `active_from_season = 2027`.
- Wisconsin-La Crosse M: `NOT_ACTIVE`, `NOT_SPONSORED`, no end season — as far as
  our own five-season corpus shows, it was never fielded.

**Historical truth is preserved by construction**: this records when a programme
was active, never that it did not exist. Nothing is deleted.

## Evidence threshold

A programme may leave the active universe only on **a first-party statement from
the institution or its conference**: the institution's own athletics site listing
its sponsored sports, an explicit institutional notice, or the conference's own
current-season pages.

Explicitly **not sufficient on their own**: a 404, a missing roster, a pipeline
failure, a stale website, a search result, or an operator's impression. Our own
corpus history is corroboration, never the basis.

Every finding below meets that bar except the two marked `UNKNOWN`, which is why
they are marked `UNKNOWN`.

---

## Nine programme findings

### 1 · Anna Maria — men's soccer → `NOT_ACTIVE` / `INSTITUTION_CLOSED`

`annamaria.edu`, re-read today: *"Anna Maria College has filed for bankruptcy
protection under Chapter 11"* and *"**Anna Maria ceased academic operations at
the end of the Spring 2026 semester**"*, with teach-out and transfer partnerships
and a `transition@annamaria.edu` contact. Its athletics site returns **403 on
every route including the root**, redirecting to `annamaria.prestosports.com/site-in-maintenance`.
`active_to_season 2025`. **Evidence: HIGH.**

### 2 · Anna Maria College — women's soccer → `NOT_ACTIVE` / `INSTITUTION_CLOSED`

Assessed independently, as asked. The evidence is **institution-level and
explicit** — "ceased academic operations" ends every programme, not a sport — so
it covers the women's programme directly rather than by inference from the men's.
`active_to_season 2025`. **Evidence: HIGH.**

### 3 · New Jersey City — men's soccer → `NOT_ACTIVE` / `IDENTITY_TRANSITION`

`njcu.edu` redirects to `kean.edu/jersey-city`; `njcugothicknights.com` redirects
to `keanathletics.com`. Kean's sport list carries the Jersey City programmes it
kept — `jc-mens-basketball` and `jc-womens-soccer` — and **no `jc-mens-soccer`**.
The NJAC's own site mentions **Kean 55 times and Jersey City not once**.

The ledger is right here, and worth noting: it records `njcugothicknights.com` as
Kean's with evidence "Kean University" and status `WRONG_INSTITUTION`, which is
exactly what the site now says. **Evidence: HIGH.**

### 4 · Wisconsin-La Crosse — men's soccer → `NOT_ACTIVE` / `NOT_SPONSORED`

`uwlathletics.com` lists its sponsored sports and **men's soccer is not among
them**; women's soccer is. Every generated candidate 404s while the host is
plainly healthy — it redirects `/sports/mens-soccer/roster/season/2026` to a
men's *track* athlete's bio, the `.aspx` fallback firing because the section does
not exist. **Our corpus holds UW-La Crosse women's rosters for 2022–2025 and no
men's roster in any season.** **Evidence: HIGH.**

*This is the case the brief called the key test, and the answer is that the
existing schema handles it: the row to switch off is
`Wisconsin-La Crosse | mens-soccer`, and `University of Wisconsin-La Crosse |
womens-soccer` is a different row.*

### 5 · Wisconsin-Oshkosh — men's soccer → `FUTURE` / `LAUNCHING`, from 2027

The site's own navigation data, verbatim: `"title":"Soccer (Coming in 2027)"`
pointing at `/sports/mens-soccer` — **explicitly men's, explicitly 2027**. The
roster page is titled "2027 Men's Soccer Roster" and carries zero players.
`active_from_season = 2027`. **Evidence: HIGH.**

**This programme must not be recorded as inactive.** It is the case that proves a
boolean is the wrong instrument.

### 6 · Southwest Minnesota State — men's soccer → `NOT_ACTIVE` / `NOT_SPONSORED`

`smsumustangs.com` lists baseball, cheerleading, esports, football, men's
basketball, men's cross country, men's track & field, softball, **women's
soccer**, wrestling and others. **No men's soccer.** All 24 candidates 404. Our
corpus holds SMSU women's rosters 2022–2026 and no men's in any season.

This closes L7G's thread: the men's-soccer path served a *women's* player bio
because there is no men's section and the `.aspx` routing falls through.
**Evidence: HIGH.**

### 7 · New Jersey City University — women's soccer → `IDENTITY_TRANSITION` (hold)

The institution no longer exists independently. A Jersey City women's soccer team
**does** exist under Kean: `keanathletics.com/sports/jc-womens-soccer/roster`,
titled **"2026 JC Women's Soccer Roster — Kean University"**, 13 players. Its
schedule names the team *"Kean University- Jersey City"* and mixes NCAA D3
opponents (Bard, Mount Saint Mary) with community colleges (Bucks County,
Suffolk County).

Kean's own NJAC programmes are separate registry rows we already hold
(`Kean | mens-soccer`, `Kean University | womens-soccer`, unitid 185262), so this
is a third team, not a renaming of one we have.

**This is a question about what the registry row now means, and it is a person's
to answer.** Options: retire the NJCU row; migrate it to "Kean University–Jersey
City" preserving continuity; or leave it pending. **Evidence: HIGH on the facts,
and the facts do not settle the question.**

### 8 · Bryn Athyn — men's soccer → `UNKNOWN`

Three signals converge and none is an explicit statement:

- The athletics site is **reachable and serves a complete, readable 2024 roster**
  of 19 players at the 2026 path; the schedule is also 2024. Site-wide, the most
  recent dated item anywhere is **2025-05-03** and the string "2026" appears zero
  times. Men's lacrosse reached 2025 and basketball 2024-25, so this is a website
  that stopped in mid-2025, not a sport that was dropped.
- **Bryn Athyn appears zero times anywhere on its conference's site** — the
  United East men's soccer page, the women's page, the homepage and the general
  page — while a peer member, Cairn, appears ten times on each, and the
  conference's 2026 content is current.
- `brynathyn.edu` loads normally, shows no closure notice, and mentions athletics
  exactly twice — both under **Alumni**, as "Athletics Hall of Fame" and
  "Athletics Website". Zero mentions of soccer or NCAA.

That is a strong lean toward the athletics department having wound down, and it
is not proof. **`UNKNOWN`, held inside the active denominator.**

### 9 · Bryn Athyn College of the New Church — women's soccer → `UNKNOWN`

Assessed independently: `/sports/womens-soccer/roster` serves **"2024 Women's
Soccer Roster"**, 19 players; schedule likewise 2024; the same conference absence
covers the women's page specifically. Same conclusion, same reason.

### Findings at a glance

| | confirmed active 2026 | confirmed not active | future only | identity transition | unknown |
|---|---:|---:|---:|---:|---:|
| of the nine | **0** | **5** | **1** | **1** | **2** |

---

## Seven duplicates

Read-only. **None overlaps the nine** — so the 1,754 denominator is arithmetically
sound.

| registry row (no roster) | twin holding the roster |
|---|---|
| Mississippi College · W | **Mississippi Christian** (194 rows) |
| Cal Lutheran · W | California Lutheran University (176) |
| Claremont-Mudd-Scripps · W | Claremont McKenna College (154) |
| FDU-Florham · W | Fairleigh Dickinson University-Florham (129) |
| Pomona-Pitzer · W | Pomona College (152) |
| St. Joseph's University (Brooklyn) · W | St. Joseph's University (Long Island) (131) |
| UC Santa Cruz · W | University of California-Santa Cruz (144) |

All seven are women's rows, which is itself a pattern worth a later look.

**One is not a spelling variant and should be flagged.** *"Mississippi
Christian"* **is not a real institution.** It carries unitid 176053, city Clinton
MS, and its 2022–2026 rosters come from `gochoctaws.com/sports/womens-soccer/…` —
Mississippi College's own athletics site. **194 real roster rows are filed under
a fictitious name.** The arithmetic still works, but any join by name is wrong
about them.

*St. Joseph's (Brooklyn) ↔ (Long Island)* looked alarming — two campuses — but
both rows carry city Brooklyn and unitid 195544 and both rosters come from
`sjliathletics.com`. The university merged its campuses; these are historical
labels for one programme. Benign.

---

## The denominator, and a larger measurement problem

### Proposed 2026 active universe

```
  1,754   current legitimate universe (1,761 registry rows − 7 duplicates)
 −    5   confirmed NOT_ACTIVE   (Anna Maria M+W, NJCU M, UW-La Crosse M, SMSU M)
 −    1   FUTURE only            (Wisconsin-Oshkosh M, from 2027)
 ───────
  1,748   proposed ACTIVE_2026
```

**Held inside that 1,748, pending a human decision:** NJCU W
(`IDENTITY_TRANSITION`) and Bryn Athyn M + W (`UNKNOWN`). Absence of proof is not
proof, so they stay counted.

### Proposed gap accounting

| category | n |
|---|---:|
| active programmes with a roster | 1,745 *(any season — see below)* |
| active programmes missing a roster | **0 confirmed**, 3 pending |
| future programmes | 1 |
| non-active programmes | 5 |
| identity-transition cases | 1 |
| unknown status | 2 |

**None of the six non-active or future programmes should be called a roster gap.**
There is no roster to acquire because there is no team.

### The 1,745 problem

`rosterTargetUniverse`'s `withRoster` counts `roster_players WHERE college_name
= ? AND sport = ?` — **with no season filter**. So:

| | |
|---|---:|
| NCAA universe | 1,761 |
| with a roster in **any** season | **1,745** ← what "rostered" has meant |
| with a **2026** roster | **1,607** |
| counted as rostered on an older season | **138** |

Both are legitimate measures and the roadmap's coverage figures have been
internally consistent. But "NCAA roster coverage 1,745" reads as a 2026 number
and is not one — the 2026 acquisition figure is 1,607, which matches what the
pipeline itself reports. Kean's own programmes are among the 138, as is UW-La
Crosse women's.

**This is not something L7O should fix, and it changes none of the nine.** It
does mean any denominator decision should say which question it is answering.

---

## Proposed schema and authority

Four options considered.

| | verdict |
|---|---|
| **A. new `programme_status` table** | **recommended** |
| B. fields on `colleges` | rejected — mixes lifecycle into the matching entity, and every existing consumer reads `SELECT *` |
| C. exclusion/override table | rejected — expresses "not active" but not `FUTURE`, which is the case that matters |
| D. reuse `colleges.active` alone | rejected — no season, no reason, no source; `FUTURE` and `NOT_ACTIVE` collapse to one value |

```
programme_status
  school, sport               -- the programme key already in use
  status                      -- ACTIVE | NOT_ACTIVE | FUTURE | UNKNOWN
  reason                      -- INSTITUTION_CLOSED | NOT_SPONSORED
                              -- | IDENTITY_TRANSITION | LAUNCHING
  active_from_season          -- nullable
  active_to_season            -- nullable
  evidence                    -- a sentence, with the first-party URL
  source_url
  decided_at, decided_by      -- null until the app has authentication
  PRIMARY KEY (school, sport)
```

**Why not `colleges.active`, given it is already programme-level.** Because the
question is not *whether* it can hold the flag but whether the flag can hold the
truth. Wisconsin-Oshkosh needs "no for 2026, yes from 2027" and a boolean cannot
say it; Anna Maria needs a reason and a last season; every case needs the
evidence that justified it. `colleges.active` stays as it is, and a status row
becomes the authority where one exists.

**This is a proposal. Nothing has been created.**

## Consumer impact

Everything reading `active = 1` would need to consult programme status once it
exists. Measured:

| consumer | impact |
|---|---|
| `rosterTargetUniverse` / roster targets | **primary** — 6 programmes would stop being targets |
| roster gap queue (L7K/L7L) | **primary** — 9 gaps → 3 pending |
| matching (`matchingBacktest`, `backtestMatching`) | 6 programmes leave the candidate set |
| outreach (`draftOutreach`, `outreachQA`) | 6 programmes leave outreach selection |
| `rosterCandidatePlan` sole-soccer rule (L7N) | reads `active = 1`; a status change alters which institutions qualify for the bare slug |
| coaching/vacancy tooling | cosmetic |
| operator College DB (`c.active !== 0`) | 6 rows would disappear from the list |

**Two surfaces are unaffected, which is worth knowing before approving anything:**

- **Evidence corpus.** `canonicalCorpus()` selects every `colleges` row for the
  sport and **does not filter on `active`**. The 4,742-pair baseline would not
  move.
- **The manifest.** Its `colleges` fingerprint is
  `SELECT name, sport, unitid, division, conference` — **`active` is not in it**.
  So a status change cannot move the dataset digest.

## Historical preservation

Nothing proposed deletes anything. Rosters, Evidence, past outreach and
programme identity all live in tables this design does not touch; a status row
records *when* a programme was active, never that it did not exist. Wisconsin-
Oshkosh's 2027 launch is preserved as data rather than lost to a boolean.

## Human decisions required

**The six existing reviews should all be RETAINED AS HISTORICAL.** Each records
what a person concluded on 17 September and each is confirmed by this stage's
independent re-verification. When a registry decision follows, it **supersedes**
the review as the operative fact without deleting it — the review is why the
decision was made.

**The three unreviewed:**

| | recommendation |
|---|---|
| NJCU W | **Evidence now sufficient for a review**, but the disposition is a registry/identity question rather than a source one. Best resolved by the registry decision, not by a gap review. |
| Bryn Athyn M | **Not yet sufficient.** Three converging signals, no explicit statement. A direct enquiry to the institution or the conference would settle it. |
| Bryn Athyn W | As above, independently. |

**Decisions needed from you:**

1. Approve or reject the `programme_status` table as the authority.
2. Confirm `UNKNOWN` and `IDENTITY_TRANSITION` stay inside the active denominator.
3. Decide what the NJCU W registry row should become.
4. Decide whether "coverage" should henceforth mean 2026 (1,607) or any-season
   (1,745), and say so wherever it is reported.
5. Note the `Mississippi Christian` misnamed row for a later registry stage.

## Trinity verifier debt

L7N's finding, confirmed read-only and **not fixed**. `classifyReadiness` in
`shared/roster/rosterReadiness.js` requires the landing path to contain
`/sports/<slug>/`:

```js
if (path && !path.includes(`/sports/${slug}/`) && !path.endsWith(`/sports/${slug}`)) {
  return no(`redirected off the programme — ${path}`);
}
```

Trinity's page is `/soccer-roster-2026`, so the advisory verifier would return
`REFUSED` for a page the production pipeline acquired safely. The verifier is the
one that is wrong; production gates are authoritative and were not weakened. It
does not affect universe reconciliation, so it stays as separate technical debt.

## Next implementation stage

**L7P — implement `programme_status`, wire the six consumers, apply six
decisions.** Create the table, record the five `NOT_ACTIVE` and one `FUTURE`
programmes with their first-party evidence, teach `rosterTargetUniverse` and the
gap queue to respect it, and re-measure the denominator. Hold NJCU W and Bryn
Athyn until they are decided. Nothing in that stage needs to touch
`colleges.active`, the Evidence corpus or the manifest.
