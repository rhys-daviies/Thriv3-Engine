# Stage J1 — what Thriv3 knows and does not say

Audit only. No production code changed. All six baselines PASS, dataset UNCHANGED.

## The headline number

**Half of all emails are generic — and three-quarters of those are generic
despite the system holding evidence about that exact programme.**

    4,742 athlete-programme pairs
      2,444  generic          51.5%
      2,298  personalised     48.5%

    Why the 2,444 are generic:
      1,811  ONLY_UNLICENSED_EVIDENCE   74.1%   we know things; none may be said
        633  NO_DATA_AT_ALL             25.9%   we genuinely know nothing

Nothing is lost to selection. Every licensed kind that qualifies is rendered,
with one exception (ACADEMIC_FIT, 232 held by the body cap). The funnel is not
leaking — **the licence is the constraint**.

## What the 1,811 silent pairs are holding

| denied kind | pairs | % of generic | confidence | athlete-specific? |
|---|---|---|---|---|
| POSITION_GROUP_SIZE | 1,446 | 59% | all HIGH | ✓ by position |
| FRESHMAN_MINUTES_LADDER | 1,405 | 58% | 1,105 HIGH | ✗ |
| PROGRAMME_POOL_BENCHMARK | 1,405 | 58% | 1,105 HIGH | ✗ |
| COACH_CONTEXT | 1,326 | 54% | all MEDIUM | ✗ |
| ELIGIBILITY_CLIFF | 1,152 | 47% | MEDIUM/LOW | ✓ position + class |
| PROGRAMME_DEVELOPMENT_PATTERN | 1,143 | 47% | 1,104 HIGH | ✗ |
| ATHLETE_COHORT_LADDER | 1,094 | 45% | mixed | ✓ cohort |
| INTERNATIONAL_ROSTER | 1,022 | 42% | all HIGH | ✗ |
| TRANSFER_BEHAVIOUR | 1,016 | 42% | all MEDIUM | ✓ atPosition |
| INTERNATIONAL_SHARE | 1,010 | 41% | all MEDIUM | ✗ |
| PROGRAM_MOMENTUM | 725 | 30% | MEDIUM | ✗ |
| **POSITION_INTAKE_HISTORY** | **640** | **26%** | **all HIGH** | **✓ position + country** |
| SQUAD_GRADUATION | 392 | 16% | MEDIUM | ~ class only |
| POSITION_GROUP_SCARCITY | 139 | 6% | MEDIUM | ✓ |
| RETURNING_POSITION_DEPTH | 73 | 3% | MEDIUM/LOW | ✓ |

## The three dimensions a reason should satisfy

**Why THIS athlete, for THIS programme, NOW?**

| licensed kind | this athlete | this programme | now | rendered |
|---|---|---|---|---|
| COACH_ARRIVAL_SAME_COUNTRY | ✓ country | ✓ | ~ season span | 177 |
| ARRIVAL_SAME_COUNTRY_POSITION | ✓ country+position | ✓ | ~ | 29 |
| HISTORICAL_SAME_COUNTRY | ✓ country | ✓ | ✗ past by definition | 249 |
| CURRENT_SAME_COUNTRY | ✓ country | ✓ | ✓ this season | 22 |
| ARRIVAL_SAME_REGION_POSITION | ~ region only | ✓ | ~ | 75 |
| HISTORICAL_SAME_REGION | ~ region only | ✓ | **✗ no date at all** | 286 |
| POSITION_GRADUATION | ✓ position | ✓ | ✓ | 814 |
| ACADEMIC_FIT | ✓ major | ✓ | ✗ timeless | 718 |
| CONFERENCE_TITLE | **✗** | ✓ | ✓ last year | 363 |
| POSTSEASON_RESULT | **✗** | ✓ | ✓ last season | 430 |

Two of ten satisfy all three. **POSITION_GRADUATION is the only kind that is
athlete-specific, programme-specific and current** — and it is doing most of
the work (814 renders, more than every hook combined).

## The weakest thing we currently say

`HISTORICAL_SAME_REGION` renders 286 times and reads:

> I saw one player from Australia has come through the programme — the same
> part of the world.

Measured across all region hooks: **81% report a count of one, and 79% carry no
season at all.** One player, from a country that is not the athlete's, at an
unstated time, as the opening line of a cold email. It is truthful and it is
thin, and it is the reason 838 emails are RELATIONSHIP_FIRST rather than
PLAYER_FIRST.

The same-country hooks are stronger but also mostly singular: 233 of 271 report
one player.

## Philosophy: not what the name suggests

There is **no tactical or playing-style data anywhere in the repository** —
no formation, pressing, possession or build-up column on `colleges`, and no
structured style field on `players` (`sport_attributes` holds `preferred_foot`;
`evaluation` is free prose). "Your style may suit" is unsupportable and must
not be attempted.

What the four Philosophy kinds actually measure is **freshman minutes**:
FRESHMAN_MINUTES_LADDER, ATHLETE_COHORT_LADDER, PROGRAMME_DEVELOPMENT_PATTERN,
PROGRAMME_POOL_BENCHMARK. Their own module says it: *"'This programme develops
defenders' is a forecast, and no roster row supports it."*

They are also, precisely, playing-time intelligence — the one category the
outreach copy contract forbids by name (opportunity, minutes, a route into the
side). **Philosophy stays operator-only.** Not because the wording could not be
made careful, but because the subject itself is the forbidden one.

## Personalised vs valuable

An email can be personalised and worthless. The test is not "does it name
something specific to this programme" but "does it tell the coach something
they would act on".

| | example | verdict |
|---|---|---|
| valuable | "two forwards are listed to graduate in 2027 — X and Y" | their roster, the athlete's position, next year |
| valuable | "you brought Joby Reid in from New Zealand in 2026" | their own decision, this athlete's country |
| thin | "one player from Australia has come through the programme" | one person, wrong country, no date |
| **superficial** | "you list seven forwards on the 2026 roster" | true, athlete-specific, and tells them nothing they do not know |
| **superficial** | "I saw you went 9-7-2 last season" | scraped-website flattery |
| **superficial** | "your programme has 2 internationals (7%)" | a statistic about them, not about the athlete |

POSITION_GROUP_SIZE is the trap here. It covers the most generic pairs (1,446),
is HIGH confidence and is athlete-specific by position — and it reads back a
coach's own roster count at them. Coverage is not the same as value.

## Copy findings

Read as whole emails, not clauses:

- **The intro and the bullet block say the same thing twice.** "a forward from
  New Zealand looking at options for the 2027 class" is immediately followed by
  "• Position: Forward • Graduation: 2027".
- **Four names is a data dump.** "four forwards are listed to graduate in 2027 —
  Leone Corzani, Jonas Zethofer, Adrian Castillo and Joshua Small."
- **The region hook has no time reference** and usually describes one person.
- Transitions are sound: "I saw …", "I also noticed …", "I was having a look
  through your program and noticed …" all read naturally.
- ACADEMIC_FIT reads well and correctly keeps both vocabularies apart.
- The generic email is two sentences of substance, and it is half the corpus.

Fact density recommendation: **names in the sentence up to three, count beyond
that**; season span in the sentence when it exists; squad sizes, shares and
percentages operator-only.

## Top five opportunities

1. **POSITION_INTAKE_HISTORY as a hook** — 640 generic pairs, all HIGH
   confidence, 584 with a coach-attributed arrival. Athlete-specific by
   position, programme-specific, and current (the window is 2023-2026). It is
   the same shape as the licensed arrival hooks with the country requirement
   removed, which is exactly why it reaches athletes who have no international
   connection. **Risk: the claim is a count of the coach's own recruiting, and
   the line between "you have signed fourteen forwards since 2023" and a
   recruiting-tendency inference is thin. This needs the copy contract's
   attention, not just a licence.**
2. **Give the region hooks a date, or stop leading with them.** 79% carry no
   season. Either the generator supplies one or the ladder should prefer a
   dated claim.
3. **SQUAD_GRADUATION as a fallback relevance** — 392 generic pairs. Weaker than
   POSITION_GRADUATION and never competes with it; would only fire where the
   athlete's position has no graduating cohort.
4. **Stop repeating the athlete's position and class** in the bullet block when
   the intro already says them.
5. **TRANSFER_BEHAVIOUR / prior_programme** — 12,803 arrivals carry a prior
   programme. Currently unused entirely. Whether "the programme has taken two
   players from four-year programmes at your position" is useful or creepy is a
   product judgement, not a data one.

## What we do not have

- coach-stated roster needs, recruiting priorities or depth-chart intent
- playing-style or tactical data on either side
- scholarship availability
- admissions likelihood for this athlete at this programme
- any record of what a coach has previously replied to

None of these is derivable from the current schema. All would be high value;
all are hard to acquire and fast to go stale; and **coach-stated need is the
one category that should never power coach-facing copy even if we had it** —
telling a coach what their own roster needs is the sentence the whole surface
exists to prevent.

## Matching vs email

Matching scores six criteria: athletic fit, roster opportunity, academic fit,
affordability, program quality, geography. Only **academic fit** reaches an
email. The rest are correctly internal:

| criterion | why it does not reach the email |
|---|---|
| athletic fit | a ranking judgement about the athlete's level — VALID DIFFERENCE |
| roster opportunity | playing-time inference — SHOULD REMAIN INTERNAL |
| affordability | the athlete's finances — SHOULD REMAIN INTERNAL |
| program quality | ranking the coach's own programme to them — VALID DIFFERENCE |
| geography | **MISSED OPPORTUNITY, narrowly** — location is why many programmes rank, and nothing in the email says it |

## Recommended J2

**Give athletes without an international connection a real reason.**

The audit points at one thing: the licensed set is built almost entirely around
country and region. An athlete with no compatriot history at a programme gets
POSITION_GRADUATION or nothing, and 51.5% get nothing. `POSITION_INTAKE_HISTORY`
is the only denied kind that is HIGH confidence, athlete-specific, current, and
about the coach's own decisions rather than their roster's statistics.

J2 should be: **design and implement a safe factual claim from
POSITION_INTAKE_HISTORY**, taken through the full contract — permission grade,
role, qualification, copy — with the same discipline as every kind before it,
and with the inference risk treated as the central design problem rather than a
footnote.

Expected impact, simulated against the canonical corpus and not run in
production: **up to 640 generic pairs (26% of all generic emails, 13.5% of the
corpus) gain a first reason.** If it is licensed as a HOOK it competes with the
region hooks on the specificity ladder, and the 286 dateless single-player
region claims would be the first thing it displaces — improving quality, not
just coverage.

**It should not be licensed if the claim cannot be worded without implying a
recruiting tendency.** That determination is J2's first task, not its last.

---

# Stage J backlog

## SAVE-TIME TEMPLATE VALIDATION (open, from J6)

An operator can save a custom template containing an unknown, retired or
malformed token. `unresolvedTokens()` exists and the preview surfaces the
result, but nothing blocks the save, so a template referencing a token J5 or J6
retired — `graduating_starters_names`, `is_conference_champion`,
`has_players_from_country` — is stored and renders literal `{{braces}}` at send
time.

The corpus has zero custom templates, so nothing is broken today. The fix is a
save path that runs `unresolvedTokens` against the full context and refuses, or
warns explicitly, before the row is written. It needs a UI touch rather than an
engine change, which is why J6 and J7 both left it.

## Copy density contract (J7)

What each licensed kind must say, what it may say, and what stays internal.

| kind | required in copy | optional if natural | operator only |
|---|---|---|---|
| COACH_ARRIVAL_SAME_COUNTRY | country, coach attribution ("you") | named arrival, season | coach name, count when 1 |
| ARRIVAL_SAME_COUNTRY_POSITION | country, position | named arrival, season | count when 1 |
| HISTORICAL_SAME_COUNTRY | country, past tense | name, season span | count when 1 |
| CURRENT_SAME_COUNTRY | country, present tense | name | count when 1 |
| ARRIVAL_SAME_REGION_POSITION | countries, position, season, "wider than own country" | — | region key, excluded country |
| POSITION_GRADUATION | position, count, class year, **1–3 names in full / 2 with "including" above that** | — | names beyond the cap |
| ACADEMIC_FIT | athlete's stated words AND programme's label, kept apart | athlete first name | matching internals |
| CONFERENCE_TITLE | conference name | — | anything about the season |
| POSTSEASON_RESULT | round | — | — |

Two rules the table encodes. **The punctuation is a truth claim**: an em-dash
list means "these are all of them", "including" means "here are some". And **a
shorter sentence is not automatically better** — the counts, dates and names
above are load-bearing, and removing one destroys the reason the claim is worth
making.
