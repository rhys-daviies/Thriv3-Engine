# L7M — the final ten, investigated

**For the operator. Nothing here has been saved. All ten remain UNREVIEWED.**

---

## Executive summary

I investigated all ten remaining NCAA roster gaps against first-party sources —
each institution's own athletics site, its own institutional site, and its
conference where it helped. The headline is that **most of these are not data
problems at all.**

**Seven of the ten programmes do not appear to exist for the 2026 season**, and
in most cases the institution's own website says so plainly:

- **Anna Maria College has closed.** Its homepage states it "has filed for
  bankruptcy protection under Chapter 11" and **"ceased academic operations at
  the end of the Spring 2026 semester."** Both Anna Maria entries were
  previously carried as `SITE_TEMPORARILY_UNAVAILABLE`. The outage is permanent.
- **New Jersey City University no longer exists independently.** Both
  `njcu.edu` and `njcugothicknights.com` now redirect to Kean University.
- **Wisconsin-La Crosse and Southwest Minnesota State do not list men's soccer**
  among their sponsored sports at all — both list women's soccer.
- **Wisconsin-Oshkosh's own navigation reads "Soccer (Coming in 2027)."**

**One is a genuine, actionable win.** **Trinity Washington University** has a
complete, current **"Soccer Roster / Fall 2026"** published on its own athletics
site — twelve players with numbers, positions, classes and hometowns. We cannot
fetch it for two specific, fixable reasons, both described below.

**Two are genuinely uncertain.** Bryn Athyn's athletics site is reachable and
serves a perfectly readable **2024** roster; the site has published nothing at
all since about May 2025. Whether the programmes still exist cannot be
determined from it.

**No case supports `SITE_TEMPORARILY_UNAVAILABLE`.** The only two outages are
Anna Maria's, which is closure, and Trinity's institutional domain, whose
athletics subdomain works fine.

One more thing worth knowing before you start: **every one of the ten still
records `no candidate` from L6D**, and for seven of them that is now provably
false — the planner offers twenty-four candidates each today. L7J fixed the
merge so the next real attempt rediagnoses; until then, ignore that column.

---

## Recommended review order

**A · Decide quickly — the institution has told us the answer (5)**
Anna Maria M, Anna Maria W, New Jersey City M, Wisconsin-La Crosse M,
Wisconsin-Oshkosh M. Each has an unambiguous first-party statement. Minutes each.

**B · One decision unlocks an acquisition (1)**
Trinity Washington W. A current roster exists and we can reach it; a later
engineering stage would close it.

**C · Needs your judgement on identity (1)**
New Jersey City W. A 2026 roster exists, but under a different institution's
name and at an apparently different level.

**D · Genuinely uncertain — defer or accept the uncertainty (2)**
Bryn Athyn M, Bryn Athyn W.

**E · One straightforward data case (1)**
Southwest Minnesota State M — clear evidence, grouped separately only because it
is the one case where an earlier stage's diagnosis was wrong in an instructive way.

---

## 1 · Anna Maria — men's soccer

**PROGRAMME** Anna Maria · men's soccer · NCAA D3 · MASCAC · unitid 164492
**MACHINE** planner `NEW_VERIFIED_HOST_CANDIDATES`, 24 candidates on
`goamcats.com`; durable state `failed / variants / "no candidate"` — **stale**.

**FIRST-PARTY EVIDENCE**
- `annamaria.edu` — *"Anna Maria College has filed for bankruptcy protection
  under Chapter 11"* and *"**Anna Maria ceased academic operations at the end of
  the Spring 2026 semester**"*. Contact address is `transition@annamaria.edu`;
  the site links a Massachusetts DHE public notification PDF dated April 2026.
- `goamcats.com` — **all 12 candidates return 403**, every one redirecting to
  `https://annamaria.prestosports.com/site-in-maintenance`.
- `annamaria.edu/athletics/` — loads, and mentions no sport at all.

**INVESTIGATION** The institution has closed. The athletics site is not having an
outage; it is switched off. **Uncertain:** nothing material.

**SUPPORTED OPTIONS** `PROGRAMME_STATUS_QUESTION`
*Not* `SITE_TEMPORARILY_UNAVAILABLE` — that label was applied in L7F and is now
contradicted; a closed college will not come back after a retry date.
**VALID NEXT ACTIONS** `CONFIRM_PROGRAMME_STATUS` · `NONE`
**CONFIDENCE HIGH**

## 2 · Anna Maria College — women's soccer

**PROGRAMME** Anna Maria College · women's soccer · NCAA D3 · MASCAC · unitid 164492
**MACHINE** identical to the men's entry; same host, same stale reason.

**FIRST-PARTY EVIDENCE** As above — the closure is institutional and covers both.

**INVESTIGATION** Same finding. **Uncertain:** nothing material.
**SUPPORTED OPTIONS** `PROGRAMME_STATUS_QUESTION`
**VALID NEXT ACTIONS** `CONFIRM_PROGRAMME_STATUS` · `NONE`
**CONFIDENCE HIGH**

## 3 · New Jersey City — men's soccer

**PROGRAMME** New Jersey City · men's soccer · NCAA D3 · NJAC · unitid 185129
**MACHINE** planner `NO_TRUSTED_HOST`, 0 candidates. Durable `no candidate` —
here that is **accurate**.

**FIRST-PARTY EVIDENCE**
- `njcu.edu` → redirects to `www.kean.edu/jersey-city`, titled *"Kean Jersey
  City | Kean University"*.
- `njcugothicknights.com` → redirects to `keanathletics.com`, *"Kean University
  Athletics"*.
- Kean's sport list includes `jc-mens-basketball` and `jc-womens-soccer` — the
  Jersey City programmes it kept. **There is no `jc-mens-soccer`.**

**INVESTIGATION** NJCU has merged into Kean, and men's soccer was not among the
Jersey City programmes carried over. Worth noting the ledger is *right* here: it
records `njcugothicknights.com` as Kean's with evidence "Kean University" and
status `WRONG_INSTITUTION`, which is exactly what the site now says. The
`NO_TRUSTED_HOST` result is correct behaviour, not a miss.
**Uncertain:** whether the NJAC registry row should be retired or remapped.

**SUPPORTED OPTIONS** `PROGRAMME_STATUS_QUESTION`
**VALID NEXT ACTIONS** `CONFIRM_PROGRAMME_STATUS` · `NONE`
**CONFIDENCE HIGH**

## 4 · Wisconsin-La Crosse — men's soccer

**PROGRAMME** Wisconsin-La Crosse · men's soccer · NCAA D3 · WIAC · unitid 240329
**MACHINE** planner `NEW_VERIFIED_HOST_CANDIDATES`, 24 candidates on
`uwlathletics.com`; durable `no candidate` — **stale**. Previously carried as
`MANUAL_REVIEW`.

**FIRST-PARTY EVIDENCE**
- `uwlathletics.com` sponsored-sport list: baseball, football, men's basketball,
  men's cross country, men's swimming & diving, men's tennis, men's track &
  field, softball, **women's soccer**, and eleven more. **Men's soccer is absent.**
- Every generated candidate 404s. The host is healthy — it redirects
  `/sports/mens-soccer/roster/season/2026` to a men's track athlete's bio, which
  is the `.aspx` fallback firing because the men's soccer section does not exist.

**INVESTIGATION** The institution fields women's soccer and not men's. The
registry row is stale. **Uncertain:** nothing material.

**SUPPORTED OPTIONS** `PROGRAMME_STATUS_QUESTION`
**VALID NEXT ACTIONS** `CONFIRM_PROGRAMME_STATUS` · `NONE`
**CONFIDENCE HIGH**

## 5 · Wisconsin-Oshkosh — men's soccer

**PROGRAMME** Wisconsin-Oshkosh · men's soccer · NCAA D3 · WIAC · unitid 240365
**MACHINE** planner `NEW_VERIFIED_HOST_CANDIDATES`, 24 candidates on
`uwoshkoshtitans.com`; durable `no candidate` — **stale**.

**FIRST-PARTY EVIDENCE**
- Site navigation, verbatim from its own data: `"title":"Soccer (Coming in
  2027)"`, linking to `/sports/mens-soccer`.
- `uwoshkoshtitans.com/sports/mens-soccer/roster` → 200, titled **"2027 Men's
  Soccer Roster"**, **zero players**.

**INVESTIGATION** The programme begins in 2027. There is no 2026 squad to
acquire, and the page that exists is an empty shell. Re-verified today rather
than carried over from L7H. **Uncertain:** nothing material.

**SUPPORTED OPTIONS** `PROGRAMME_STATUS_QUESTION`
**VALID NEXT ACTIONS** `CONFIRM_PROGRAMME_STATUS` · `NONE`
**CONFIDENCE HIGH**

## 6 · Southwest Minnesota State — men's soccer

**PROGRAMME** Southwest Minnesota State · men's soccer · NCAA D2 · NSIC · unitid 175078
**MACHINE** planner `NEW_VERIFIED_HOST_CANDIDATES`, 24 candidates on
`smsumustangs.com`; durable `no candidate` — **stale**. Previously carried as
`SOURCE_NOT_AVAILABLE`.

**FIRST-PARTY EVIDENCE**
- `smsumustangs.com` sponsored-sport list: baseball, cheerleading, esports,
  football, men's basketball, men's cross country, men's track & field, softball,
  **women's soccer**, wrestling and others. **Men's soccer is absent.**
- All 24 candidates 404.

**INVESTIGATION** This closes a thread L7G opened. L7G found the men's-soccer
path serving a *women's* player bio and concluded the page was the wrong
programme; the underlying reason is that **there is no men's programme** and the
site's `.aspx` routing falls through. The right classification is status, not
source. **Uncertain:** nothing material.

**SUPPORTED OPTIONS** `PROGRAMME_STATUS_QUESTION`
**VALID NEXT ACTIONS** `CONFIRM_PROGRAMME_STATUS` · `NONE`
**CONFIDENCE HIGH**

## 7 · Trinity Washington University — women's soccer

**PROGRAMME** Trinity Washington University · women's soccer · NCAA D3 ·
Independent · unitid 131876
**MACHINE** planner `NO_TRUSTED_HOST`, 0 candidates. Durable `no candidate` —
accurate as to candidates, but the conclusion behind it is wrong.

**FIRST-PARTY EVIDENCE**
- `https://athletics.trinitydc.edu/` — **200**, *"Trinity Tigers Athletics"*.
- `https://athletics.trinitydc.edu/soccer-roster-2026/` — **200**, headed
  **"Soccer Roster · Fall 2026"**, listing players with number, name, position,
  class and hometown: Alemia Tolentino, Alondra Ortega, Elisha Lewis, Zinn
  Kurose, Claudia Cerezo, Gady Martinez, Miriam Mendoza Pinzon, Claire
  Nkengafac, Sarah Diz, Evelyn Alobwede, Jimena Amaya, Andrea Montano — **twelve
  read by a naive pass.**
- Also published: `/soccer-schedule-2026/`, `/soccer-coaching-staff/`.
- `trinitydc.edu` (the institutional domain) returns **403 to every request**,
  including a plain Chrome user agent. The athletics subdomain does not.

**INVESTIGATION** The programme exists, is current, and publishes a roster we can
read. Two separate things stop us, and both are general rather than
Trinity-specific:

1. **`athletics.trinitydc.edu` is not in `athletics_domains` at all** — no row,
   under any unitid. The likely reason it was never discovered is the 403 on the
   institutional domain, which would have blocked a crawler working inward from
   `trinitydc.edu`.
2. **The URL shape is outside the catalogue.** Every one of the 1,602 corpus
   sources sits under `/sports/<slug>/…roster…`. Trinity's site is a WordPress
   build using `/soccer-roster-2026/`, `/basketball-roster-2026/`,
   `/volleyball-roster-2026/` — a consistent, deterministic family the generator
   has never seen. The roster is also not a table and carries no bio links, so
   the parser would need the shape as well.

Trinity is a women's college, so the unqualified "Soccer" is unambiguous.
**Uncertain:** the exact squad size — twelve is what a naive read returns, and a
real parse may find one or two more.

**SUPPORTED OPTIONS** `SOURCE_NOT_AVAILABLE` — true as stated: a current roster
source exists and *we* have not established one.
**VALID NEXT ACTIONS** `RETRY_ACQUISITION` — the honest one, since the work is
ours and a later stage can do it · `NONE`
**CONFIDENCE HIGH**

## 8 · New Jersey City University — women's soccer

**PROGRAMME** New Jersey City University · women's soccer · NCAA D3 · NJAC ·
unitid 185129
**MACHINE** planner `NO_TRUSTED_HOST`, 0 candidates. Accurate.

**FIRST-PARTY EVIDENCE**
- As entry 3: both NJCU domains redirect to Kean.
- `keanathletics.com/sports/jc-womens-soccer/roster` — **200**, titled **"2026 JC
  Women's Soccer Roster - Kean University"**, **13 players**.
- Its schedule names the team **"Kean University- Jersey City"** and its
  opponents mix NCAA D3 (Bard, Mount Saint Mary College) with community colleges
  (Bucks County CC, Suffolk County CC).

**INVESTIGATION** A current 2026 roster exists — but for *Kean University–Jersey
City*, not for New Jersey City University, and on a schedule that does not look
like an NJAC D3 slate. This is a question about what the registry row now means,
and it is squarely yours rather than the pipeline's.
**Uncertain:** whether this team is the NJAC D3 programme continued under a new
name, or a different-level programme that happens to inherit the campus.

**SUPPORTED OPTIONS** `PROGRAMME_STATUS_QUESTION`
**VALID NEXT ACTIONS** `CONFIRM_PROGRAMME_STATUS` · `NONE`
**CONFIDENCE MEDIUM** — the facts are certain; what they imply for the registry
row is a judgement.

## 9 · Bryn Athyn — men's soccer

**PROGRAMME** Bryn Athyn · men's soccer · NCAA D3 · CSAC / United East · unitid 210492
**MACHINE** planner `NEW_VERIFIED_HOST_CANDIDATES`, 24 candidates on
`brynathynathletics.com`; durable `no candidate` — **stale**.

**FIRST-PARTY EVIDENCE**
- `brynathynathletics.com/sports/mens-soccer/roster` — **200**, titled **"2024
  Men's Soccer Roster - Bryn Athyn College"**, **19 players**, fully parseable.
  The 2026 path redirects here.
- `/sports/mens-soccer/schedule` — titled **"2024 Men's Soccer Schedule"**.
- Site-wide recency: men's lacrosse **2025**, men's basketball **2024-25**,
  women's volleyball **2024**. The most recent dated item anywhere on the site is
  **2025-05-03**, and the word "2026" appears **zero** times.
- `brynathyn.edu` loads normally and shows no closure notice; it links only to
  the athletics site.

**INVESTIGATION** The athletics site stopped being updated around May 2025 —
after the spring sports, before the 2025 fall season. Soccer's last published
season is 2024 because fall 2025 was never published either. So this is not
"soccer was dropped"; it is "this website stopped". Whether the programme is
still fielded cannot be answered from any source I could reach.
**Uncertain:** everything about current sponsorship. The United East conference
site renders its membership with script and did not yield a list.

**SUPPORTED OPTIONS** both are reasonable and they mean different things —
`SOURCE_NOT_AVAILABLE` (the programme exists, the site publishes nothing current)
or `PROGRAMME_STATUS_QUESTION` (the department may be dormant). If you would
rather not choose on this evidence, **INSUFFICIENT EVIDENCE — KEEP UNREVIEWED**
is a legitimate outcome.
**VALID NEXT ACTIONS** `RETRY_ACQUISITION` or `NONE` under the first;
`CONFIRM_PROGRAMME_STATUS` or `NONE` under the second.
**CONFIDENCE MEDIUM** — the site evidence is certain, what it implies is not.

## 10 · Bryn Athyn College of the New Church — women's soccer

**PROGRAMME** Bryn Athyn College of the New Church · women's soccer · NCAA D3 ·
United East · unitid 210492
**MACHINE** as entry 9; same host, same stale reason.

**FIRST-PARTY EVIDENCE** `/sports/womens-soccer/roster` — **200**, **"2024
Women's Soccer Roster"**, **19 players**. Schedule likewise 2024. Same site-wide
dormancy.

**INVESTIGATION** Identical to the men's entry, and should be decided the same way.
**SUPPORTED OPTIONS** `SOURCE_NOT_AVAILABLE` or `PROGRAMME_STATUS_QUESTION`, or
**INSUFFICIENT EVIDENCE — KEEP UNREVIEWED**.
**VALID NEXT ACTIONS** as entry 9.
**CONFIDENCE MEDIUM**

---

## Engineering wins

**Trinity Washington University women's soccer — one programme, two general defects.**

A current roster exists, we can reach the page, and the pipeline cannot acquire it:

- **Candidate generation assumes one URL family.** Every catalogued shape is
  `/sports/<slug>/…roster…`. Trinity's site publishes `/soccer-roster-2026/`,
  and the same pattern holds for its basketball, tennis and volleyball. This is
  a deterministic family, not a one-off, and it is presumably not unique to
  Trinity among small independents running a general-purpose CMS.
- **The parser has no shape for it.** The roster is neither a table nor Sidearm
  bio links; it is a styled list. L7I's `rosterEntries` reads it as zero.

Both are real work and neither is a hack. No other programme in the ten is
blocked by anything we could fix.

## Data / domain wins

**`athletics.trinitydc.edu`** — an official athletics host, reachable, serving
current rosters, and **absent from `athletics_domains` entirely**. A controlled
backfill candidate. The reason it was missed is worth carrying into any future
discovery work: **the institutional domain `trinitydc.edu` 403s every request**,
so a crawler reasoning outward from the institution would never see the
subdomain.

No other domain gap was found. In particular, `njcugothicknights.com` is already
recorded, and recorded *correctly*, as Kean's.

## Programme status questions

Seven, and five of them are settled by the institution's own words:

| | what the institution says |
|---|---|
| Anna Maria M | closed — Chapter 11, ceased operations end of Spring 2026 |
| Anna Maria W | as above |
| New Jersey City M | merged into Kean; no Jersey City men's soccer programme |
| Wisconsin-La Crosse M | men's soccer not among its sponsored sports |
| Wisconsin-Oshkosh M | "Soccer (Coming in 2027)" |
| Southwest Minnesota State M | men's soccer not among its sponsored sports |
| New Jersey City W | a 2026 roster exists, under another institution's name |

**None of this has touched `colleges.active`, and a review cannot.** Retiring or
remapping a registry row is a separate, deliberate act by whoever owns the
registry — which is the point of keeping the question and the registry apart.

## External blockers

- **Anna Maria** (both) — the college has closed. No engineering will help.
- **Bryn Athyn** (both) — the athletics site has published nothing since May
  2025. Nothing to fetch, and nothing we can do about it.

---

## Recommended next step

Review the five clear status cases first; they are quick and they remove half the
queue. Then decide Trinity Washington — it is the one case where your decision
leads somewhere, and `RETRY_ACQUISITION` against it would give a future stage a
concrete target with two named, generalisable defects to fix.

If **Trinity** is dispositioned `SOURCE_NOT_AVAILABLE` / `RETRY_ACQUISITION`,
the natural L7N is a narrow engineering stage: admit an evidence-backed second
URL family for non-Sidearm/Presto athletics sites, add the list-shaped roster to
the parser, and backfill `athletics.trinitydc.edu` under controlled review — then
acquire exactly one programme through the normal gates, as L7I did for Northwood.

**Nothing in this document has been saved as a review. reviewed 0, unreviewed 10.**
