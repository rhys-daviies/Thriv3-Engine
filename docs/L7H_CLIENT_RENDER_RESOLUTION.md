# L7H — the client-render cohort does not exist

L7H was to find why two NCAA programmes fail through the production browser path
and fix the extraction. Neither fails for that reason.

**The cohort is 0, not 2.** Stop condition 1. No acquisition was run, no parser
was changed, nothing was imported, and no data moved.

What the diagnosis found instead is worth more than a parser fix:

* **Northwood** is reachable and always was. Its roster is served on
  `www.gonorthwood.com` while every generated candidate targets the apex
  `gonorthwood.com`, which discards the path and bounces to the site's home
  page. A host-form defect, not a rendering one.
* **Wisconsin-Oshkosh men's soccer does not exist in 2026.** The site's own
  navigation reads *"Soccer (Coming in 2027)"*. There is no squad to acquire.

---

## 1. Deriving the cohort, and a defect in the attempt

The intended derivation was the durable pipeline state. It cannot be used:
**every one of the eleven gaps reports `variants / no candidate`**, the reason
written in L6D before any of them had a candidate at all.

`absorb` in the runner merges a failure only when the key is *absent*:

```python
elif v.get('status') != 'done' and k not in main: main[k] = v
```

So a programme's failure reason is frozen at its **first** failure, and every
later diagnosis — L7D's browser results, L7F's, L7G's — was written to a stage
file and never reached durable state. The state file records that a programme
failed; it does not record why it most recently failed. Recorded as debt.

The cohort was therefore derived by running the production browser path over
every gap whose candidate returns a page at all: Northwood, Wisconsin-Oshkosh,
and Bryn Athyn ×2.

## 2. What the browser actually sees

| programme | final URL | title | parsed | season |
|---|---|---|---:|---|
| Northwood W | **→ `/landing/index`** | "Northwood University Athletics (Michigan)" | 0 | — |
| Wisconsin-Oshkosh M | `/sports/mens-soccer/roster` | **"2027 Men's Soccer Roster"** | 0 | **False** |
| Bryn Athyn M | `/sports/mens-soccer/roster` | **"2024 Men's Soccer Roster"** | **19** | **False** |
| Bryn Athyn W | `/sports/womens-soccer/roster` | **"2024 Women's Soccer Roster"** | **19** | **False** |

Bryn Athyn is the control that proves the point: the parser reads its 19 players
perfectly. Nothing is wrong with extraction there — the page is four years old.
Both Bryn Athyn cases were already classified `SOURCE_NOT_AVAILABLE` and remain
out of scope.

**No programme in the cohort is `DOM_PRESENT_PARSER_MISS`, `DATA_IN_EMBEDDED_JSON`,
`DATA_FETCHED_AFTER_HYDRATION`, `IFRAME`, or `PAGINATION_OR_LAZY_LOAD`.** No
hydration contract was needed, no first-party API was used, no extraction code
was written.

## 3. Northwood — a host form, not a renderer

Walking the full ladder, **all 24 URLs across 9 candidates redirect to
`/landing/index`.** That reads as "the site has no women's soccer section", and
it is wrong.

The site's own landing page links `/sports/wsoc/2026-27/roster`. Fetched on the
`www` host:

```
www.gonorthwood.com/sports/wsoc/2026-27/roster   200
  "2026 Northwood Women's Soccer Roster - Northwood University Athletics (Michigan)"
  37 bio links · 38 table rows · static HTML, no rendering required

gonorthwood.com/sports/wsoc/2026-27/roster       200  →  /landing/index
```

The apex domain answers every path with the home page. The `www` host serves the
roster, statically, with the season and sport in its own title.

**Why the generator never tries it.** `canonicalHost()` strips `www.`, which is
correct for identity — L7B proved no canonical host maps to two institutions,
and that collapse is what lets one verified row answer for both spellings. But
`hostsForInstitution` returns that *identity key*, and the candidate generator
fetches it. Northwood's ledger holds `gonorthwood.com` **and**
`www.gonorthwood.com`, both trusted for 171492; the collapse picks the form that
does not serve paths.

Blast radius, measured:

| | |
|---|---|
| trusted rows recorded with `www.` | **35** of 951 |
| of those, no apex row exists | 11 |
| corpus roster URLs living on a `www` host | **71** of 1,602 (4.4%) |

So an identity key is not a fetch target, and about 35 hosts are exposed to the
difference. Northwood is the one that surfaced.

## 4. Wisconsin-Oshkosh — the programme starts next year

Three distinct behaviours across its 18 ladder URLs:

* `/sports/mens-soccer/roster*` and `/sports/msoc/roster*` → **"2027 Men's
  Soccer Roster"**, season check `False`, 2 table rows, 0 players
* `/sports/m-soccer/roster*` → **"2026-27 General Roster"**, season check
  `True`, and still 0 players — an empty Sidearm shell with no bio links
* `/sports/*/roster/season/2026` → a **2013-14 men's track & field bio**
* `/sports/*/2026-27/roster` → 404

The "General Roster" page passes the season check and has roster markup, which
is exactly the trap L7G named. Its own navigation settles it, under **Men's
Sports**:

> Baseball · Basketball · Cross Country · Football · **Soccer (Coming in 2027)**
> · Swimming & Diving · Track & Field · Wrestling

There is no 2026 men's soccer squad at UW-Oshkosh because the programme has not
started. The registry lists it active for 2026; the school says 2027.

**No parser could ever produce this roster**, and building one that accepted the
empty shell would have manufactured a squad out of navigation markup.

## 5. Identity and sport, proved from the rendered source

Required by Phase 5, since L7G exposed a wrong-sport false positive. Navigation
markers were not accepted as proof in either case.

| | institution | sport | season |
|---|---|---|---|
| Northwood | `og:site_name` "Northwood University Athletics (Michigan)" — and the roster page's own title names Northwood | title names **Women's Soccer** | title names **2026** |
| Wisconsin-Oshkosh | `og:site_name` "University of Wisconsin–Oshkosh Athletics" | title names Men's Soccer | **2027**, or an untitled empty shell |

Northwood's evidence is complete on all three. Oshkosh's fails on season, and
its only season-passing page names no sport and holds no players.

## 6. Reclassification

| programme | was | is |
|---|---|---|
| Northwood W | `CLIENT_RENDER_FAILURE` | **`SOURCE_NOT_AVAILABLE`** — until the host form is fixed, at which point it is acquirable |
| Wisconsin-Oshkosh M | `CLIENT_RENDER_FAILURE` | **`PROGRAMME_STATUS_QUESTION`** — no 2026 programme |

Residual eleven, unchanged in count:

| | n |
|---|---:|
| `SOURCE_NOT_AVAILABLE` | **4** — Bryn Athyn ×2, SMSU, **Northwood** |
| `PROGRAMME_STATUS_QUESTION` | **3** — New Jersey City ×2, **Wisconsin-Oshkosh** |
| `SITE_TEMPORARILY_UNAVAILABLE` | 2 — Anna Maria ×2 |
| `MANUAL_REVIEW` | 1 — Wisconsin-La Crosse |
| `NO_HOST` | 1 — Trinity Washington |
| `CLIENT_RENDER_FAILURE` | **0** |

## 7. What was not done, and why

**No implementation.** Stop condition 1 fired on the cohort, and the fix
Northwood needs is not extraction — it is candidate generation, and it touches
35 hosts well beyond the two this stage owns. Making that change under a brief
whose stop condition has already fired would be overstepping twice.

The readiness verifier remains optimistic and this stage is the third time it
has been caught: it called Wisconsin-Oshkosh `REDIRECT_TO_ROSTER` on an empty
shell for a programme that does not exist. Its Phase 11 correction is recorded
below rather than applied, for the same reason.

Unchanged and verified: NCAA coverage **1,743**, legitimate gaps **11**,
`roster_players` 277,360, manifest `fe23cac71c83ec0e`, six baselines **PASS**
unrepinned, **P6 unchanged**, no new emails, every sheet byte-identical.

`BASE_ONLY` removal from STRICT still has **zero product effect** — the trusted
set is the same seven known-wrong rows, all already quarantined downstream.
`verified: true` has **no new caller**; L7H wrote no code.

## 8. Recommended next stage

Two changes, both small and both measured:

1. **An identity key is not a fetch target.** Where the ledger records a `www.`
   form for a trusted host, the generator should offer that form as part of the
   ranking. 35 hosts affected, 71 corpus URLs already living there, and Northwood
   becomes acquirable immediately.
2. **The readiness verifier should say UNKNOWN rather than READY** when it has
   only a 200, a host and roster-shaped markup. It must see programme-specific
   content — bio links, player rows, a title naming the sport AND the season —
   before it reports readiness. Three stages have now been misled by it, and each
   time the production gates were the thing that held.

Neither Bryn Athyn, SMSU, Anna Maria, New Jersey City, Trinity Washington nor
Wisconsin-La Crosse is affected by either change.
