# L7I — an identity is not a network target

```
trusted ledger row ─┐
                    ├─→ IDENTITY HOST (equality, ownership, conflict)
observed roster  ───┘        │
source              ─────────┴─→ FETCH HOST FORMS (ordered, what goes on the wire)
```

**+37 roster rows. NCAA coverage 1,743 → 1,744. Legitimate active gaps 11 → 10.
One athlete-programme pair moved, and no email text changed.** USCAA, NAIA and
every unrelated NCAA sheet byte-identical.

---

## 1. What was wrong

`canonicalHost()` strips a leading `www.`, and for IDENTITY that is correct —
L7B measured it. `gonorthwood.com` and `www.gonorthwood.com` are one athletics
property, one owner, one thing to detect a conflict over.

What it is not is a network target, and the two were the same value:

```
athletics_domains.domain  →  canonicalHost()  →  hostsForInstitution().hosts
                                                          │
                                        candidatesForLookup takes hosts[0]
                                                          │
                                   `https://${host}${path}`   ← a fetch
```

`domainAuthority.js` collapsed the spelling and `rosterCandidates.js`
interpolated the result into a URL. A site whose apex does not serve the path
became unreachable, and nothing in the system could say why.

### Northwood, reproduced from current data

Four ledger rows carry unitid 171492. Two are separately `VERIFIED_ALIAS`,
`ATHLETICS_SITE`, `WHOLE_NAME`, `CERTAIN`, platform PRESTO:

| stored host | canonicalHost | trusted |
|---|---|---|
| `gonorthwood.com` | `gonorthwood.com` | yes |
| `www.gonorthwood.com` | **`gonorthwood.com`** | yes |
| `timberwolves.gonorthwood.com` | `timberwolves.gonorthwood.com` | yes |
| `northwood.edu` | — | no, institution site |

Both spellings were already known. Two live requests, made fresh for this stage:

```
gonorthwood.com/sports/wsoc/2026-27/roster
  → 200, final https://www.gonorthwood.com/landing/index
    title "Northwood University Athletics (Michigan)"   3 <tr>

www.gonorthwood.com/sports/wsoc/2026-27/roster
  → 200, final unchanged
    title "2026 Northwood Women's Soccer Roster"       38 <tr>, 37 players
```

The apex is not dead. **Its redirect discards the path** and answers every route
with the site's home page. So the one spelling that serves the roster is the one
`canonicalHost` removed, and the generator built all 24 candidates on the other.

Northwood's own men's programme has been fetched from `www.gonorthwood.com` for
three seasons. The evidence was in the corpus the whole time.

## 2. Two concepts, named

**IDENTITY HOST** — `canonicalHost(domain)`. Used for equality, ownership,
conflict detection, institution authority, and the `www.` collapse. **Unchanged
by this stage.** Two spellings of one site remain one institution and cannot
produce a duplicate.

**FETCH HOST FORM** — a concrete spelling that may be put on the wire. Several
may share one identity.

### The authority contract

A fetch form is admitted on one of exactly two grounds:

1. the ledger stores that spelling, on a row this profile stands behind for this
   institution; or
2. this institution's own rosters have actually been fetched from it.

Nothing is derived. `www.` is never prefixed onto an apex-only row, an apex is
never stripped off a `www.`-only one, and no subdomain is guessed. The bound is
structural rather than a rule to remember: a form qualifies only if it
canonicalises to the identity it is offered for, and `canonicalHost` rewrites
nothing but a leading `www.` and a port — so `timberwolves.gonorthwood.com` is a
different identity and cannot be reached from this one at all.

### Ordering — and why the obvious order was wrong

```
stored AND observed  →  observed only  →  stored only
```
ties by how many sources used the spelling, then lexically.

A ledger row establishes **ownership**: this property is Northwood's. An
observed roster source establishes **fetchability**: a squad was parsed out of a
page at this exact spelling. Only the second is evidence about the thing the
ordering decides.

That was measured, not reasoned. Ranking stored above observed put
Carson-Newman's two known-good sources past the attempt bound — only its `www.`
row is stored, and only its apex has ever been fetched from. Observation-first
returns them to ordinal two.

## 3. The inventory

**35 trusted rows carry a `www.` spelling** (STRICT; 34 under DISCOVERY — the
difference is one BASE_ONLY row). Of those 35:

| | n |
|---|---:|
| an apex sibling is also a trusted row | 25 |
| no apex row at all — `www.` is the only stored form | 10 |
| a `www.` roster source observed | 25 |
| an apex roster source observed | 25 |
| `www.` observed and apex never observed | 10 |

One row stores a port, `www.kstatesports.com:443`, which normalises to
`www.kstatesports.com` and deduplicates against its sibling.

**71 of the 1,602 distinct NCAA roster URLs in the 2026 corpus (4.4%) are on a
`www.` host** — L7H's figure, reproduced exactly. Behind them sit 51 canonical
identities, and **37 have no observed working form other than `www.`**. That is
the regression population: under the old collapse every one of them would have
been generated candidates on a spelling its own rosters have never used.

## 4. The fix

One owner distinguishes the concepts. `hostsForInstitution` returns `fetchHosts`
alongside `hosts`; `hosts` is unchanged and still canonical.

```js
export function fetchHostsForIdentity(rows, identityHost, { observed })
// → ordered concrete spellings, evidence-first
```

`candidatesForLookup` walks them **host-major**: one spelling's whole ladder
before the next. Interleaving was the alternative and it is the one that breaks
things — the sixteen-candidate bound is a measurement over a *single* host's
ladder, so alternating two spellings doubles every ordinal and Southwest
Minnesota State's winner at ten becomes twenty and falls off the end.

**The bound stays global.** `limit` is the length of the whole ordered ladder,
not a per-host allowance, so admitting a second spelling can never make a run
longer than it was.

Northwood's winning URL moves from **unreachable** to **ordinal 1**.

## 5. Simulation across every trusted NCAA host

1,761 programmes, generated both ways, network-free:

| | |
|---|---:|
| identical candidate list | **1,698** |
| changed | 63 |
| gained candidates | **63** |
| lost candidates | 6 |

Historical reproduction, against the 1,605 known 2026 NCAA roster URLs:

| | before | after |
|---|---:|---:|
| reproduced anywhere in the ladder | 1,253 | **1,282** |
| reproduced within the bound of 16 | 1,253 | **1,269** |

Per-URL movement: **0 vanished**, **29 newly reproduced**, 1,252 unchanged,
**1 fell out of the bound**.

### The six that lost candidates, and the one that moved

All six are identities with **no evidence-backed apex** — `vassarathletics.com`,
`usmmasports.com`, `wpupioneers.com` and three others whose only stored row and
only observed source are the `www.` form. What they lost is the apex URLs the
collapse used to invent. None is a known-good URL; that is what `0 vanished`
says.

The one out-of-bound movement is Endicott women's, whose recorded source is on
the apex while five of the institution's six observed sources are on `www.`. No
identity-level ordering satisfies both.

**Every one of the seven affected programmes is `EXISTING_CANDIDATE`** — it
already holds a roster source, and a known-good URL always beats a generated
one, so the generator is never consulted for them. Restricted to the 13
programmes the generator is actually asked about, the change loses nothing and
moves nothing out of bound.

## 6. The readiness verifier

Advisory, and it has now misled three stages in the same shape: L7E called SMSU
ready on a women's bio at a men's-soccer path; L7F called Endicott's shapes
ready on navigation markers; L7H was handed Wisconsin-Oshkosh as
`REDIRECT_TO_ROSTER` — a `2027 Men's Soccer Roster` served as an empty shell for
a programme whose own navigation says "Soccer (Coming in 2027)".

Each time the verifier was reading the SITE and reporting on the PROGRAMME. A
200 proves a server answered; a host proves ownership; roster markup proves the
site has a roster feature. The production gates, not the verifier, caught all
three.

| | old | new |
|---|---|---|
| `READY` | 200 + host + roster markup + landed on the slug | institution **and** sport **and** a usable current roster, each evidenced by the page's own content |
| `UNKNOWN` | — | host, path and status plausible; programme-specific evidence missing or insufficient |
| `REFUSED` | soft-404, wrong slug, contradicted sport | + wrong institution, **wrong season**, no squad |

The asymmetry is deliberate: UNKNOWN costs an attempt that may succeed, a wrong
READY costs a stage. A script-rendered roster looks exactly like UNKNOWN, and
`browse.py` exists for it.

### Counting entries without counting markup

Counting class names is the habit that produced every false READY, and it fails
here too: `sidearm-roster-player` appears **three times** in Wisconsin-Oshkosh's
empty shell — once on a container holding no players, twice inside a jQuery
selector in an inline script — and **not once** in Adrian's real roster of 27.

So an entry is one of two things the corpus expresses a player with: a bio link
carrying a numeric id (`/roster/monica-arndt/30949`), which site navigation
(`/roster/coaches`) cannot look like; or a table row of four or more non-empty
cells, which the one-cell `Statistic` rows of a navigation table cannot reach.

| page | entries | verdict |
|---|---:|---|
| Northwood `www.` roster | 38 | **READY** |
| Adrian, known-good Sidearm | 28 | **READY** |
| Northwood apex → `/landing/index` | 0 | REFUSED — redirected off the programme |
| SMSU men's path, women's bio | 0 | REFUSED — names another programme |
| Wisconsin-Oshkosh 2027 shell | 0 | REFUSED — season 2027, not 2026 |

Fixtures are trimmed from the real responses and committed, so no test here
touches the network and none of them is a page invented to agree with us.

**Production gates are untouched.** Nothing was weakened to make the verifier
agree; the verifier was tightened to stop disagreeing with them.

## 7. Northwood, acquired

Cohort derived, not declared: of 13 programmes the generator is consulted for,
2 have more than one approved fetch form, and 1 of those changes reachability.

```
TO ATTEMPT 1   ·   Northwood||womens-soccer   ·   86adb653f3d1a762
other NCAA 0   ·   non-NCAA 0
```

The run scope excluded 231 programmes by division. Stages: direct —, variants
fail, selector —, **browser OK**.

```
OK  Northwood||womens-soccer  n=37
    https://www.gonorthwood.com/sports/wsoc/2026-27/roster?view=table
```

The winning URL is **generated candidate #1** — shape `SPAN_ROSTER_TABLE`, slug
`wsoc`, fetch host `www.gonorthwood.com`, identity host `gonorthwood.com`. **No
manual URL was inserted anywhere**; the only edit to `_targets.csv` copied the
generator's own output into one row.

Every normal gate ran. The turnover gate was re-applied to everything absorbed
and nothing sat at or above 0.85. `roster_players` **277,360 → 277,397**, +37,
0 changed, 0 removed.

### Output safety

One sheet written, `ncaa_d2_womens_soccer_2026_rosters.csv`. USCAA ×2, NAIA ×2
and the other five NCAA sheets **byte-identical by SHA-256**.

`build_targets.py` was run and its output **discarded**, for a reason worth
recording: it rebuilds `_targets.csv` from scratch and **resets every `Status`
to `todo`, wiping `Notes`** — 1,933 `done` and 207 `failed` rows lost their
acquisition history. It is a pre-season step, not a mid-season one. The sheet
was restored byte-identical from the pre-run copy, and then, having confirmed
that across all 2,165 rows and all nine generated columns **exactly one row
differed**, that row's generated columns were copied across.

## 8. Coverage and Evidence

| | before → after |
|---|---|
| NCAA coverage | 1,743 → **1,744** (D2 women 258 → 259) |
| legitimate active gaps | 11 → **10** |
| `roster_players` | 277,360 → **277,397** |

Residual, unchanged except for Northwood leaving it:

| | n | |
|---|---:|---|
| `SOURCE_NOT_AVAILABLE` | 3 | Bryn Athyn ×2, SMSU |
| `PROGRAMME_STATUS_QUESTION` | 3 | New Jersey City ×2, Wisconsin-Oshkosh |
| `SITE_TEMPORARILY_UNAVAILABLE` | 2 | Anna Maria ×2 |
| `MANUAL_REVIEW` | 1 | Wisconsin-La Crosse |
| `NO_HOST` | 1 | Trinity Washington |
| `CLIENT_RENDER_FAILURE` | **0** | — |

### P6

Measured pair-by-pair against the pre-L7I snapshot under `projectBehavioural`:
**1 of 4,742 pairs moved**, and it is the QA fixture athlete against Northwood.
No real athlete-programme pairing changed at all.

| | |
|---|---|
| pairs affected | **1** |
| generic → personalised | **0** |
| supplemented | **1** — one new `POSITION_GROUP_SIZE` fact, `all` 2 → 3 |
| still generic | 1 |
| rendered kinds | `POSTSEASON_RESULT`, unchanged · sentences 1 → 1 |
| held / deduped | 221 → 221 |

The new fact carries `OPERATOR_EVIDENCE: ALLOWED`, `MATCHING_SUMMARY: DENIED`,
`OUTREACH: DENIED` — it reaches an operator and not an email. The composed
paragraph is byte-identical.

**Emails: 0 new, 0 changed — GOOD 0, ACCEPTABLE 0, WEAK 0, BAD 0.** The
`EMAIL_BODY` baseline digest is unchanged, which is independent proof rather
than a claim. **No policy change: P6 unchanged.**

### Baselines

Manifest `fe23cac71c83ec0e` → `194fcf38877e6686`, **UNCOMPARABLE**
(`roster_players` and `roster_freshness` moved).

| surface | moved? |
|---|---|
| `OUTBOUND_DECISION` · `OPERATOR_WIRE` · `LOG_PAYLOAD` · `OPERATOR_EVIDENCE` | moved, the one pair |
| `COACH_COMPOSITION` · `EMAIL_BODY` | **digest unchanged** |

Predicted before repinning and confirmed after: a stage that adds a squad must
move the roster-derived surfaces and must not move the composed email. All six
repinned, as L7F did on the same evidence. Six PASS afterwards.

## 9. Debt

**The frozen failure reason is confirmed and NOT fixed.** `absorb` merges a
failure only when the key is absent, so a programme's recorded reason is its
*first*. **All 10 residual gaps still report `stage: variants`** — including
Wisconsin-Oshkosh, which L7H proved is a 2027 programme, and SMSU, which L7G
proved serves a women's bio. Durable state cannot be read as a residual
classification, and saying so is the next observability stage.

**BASE_ONLY in STRICT: zero product effect, re-measured.** Excluding it drops 7
hosts from the trusted map, cited by 14 active 2026 programmes — and **0 of them
would lose a verified source link**, because all 14 are already refused
`INSTITUTION_MISMATCH` upstream (`uconnhuskies.com` carries 128902 against
UConn's 129020, and so on). The authority-map figure is not a product figure.

**`verified: true`** still has exactly one caller, `candidatesForLookup`. L7I
moved where the call sits, not how many there are. No unsafe new caller.
