# Stage K1 — the validation corpus, designed before it is built

Design only. No athlete added, no policy changed, no baseline repinned.

## What the current corpus can and cannot tell us

Four athletes, 4,742 pairs.

| athlete | sport | country | position | major | GPA/SAT | personalised | generic |
|---|---|---|---|---|---|---|---|
| Shaan Anad | men's | New Zealand | Forward | — | — | 406 | 763 |
| Rhys Davies | men's | New Zealand | Defender | exercise science | 3.6 / 1210 | 701 | 468 |
| Ryan Billings | men's | New Zealand | Defender | exercise science | — / 1440 | 701 | 468 |
| QA Fixture | women's | United States | Midfielder | — | — | 376 | 859 |

**Coverage matrix** (● exercised, ○ absent):

| dimension | state |
|---|---|
| OCEANIA | ● heavy — 3 of 4 athletes, every live regional instance |
| domestic US | ● partial — the QA fixture, women's only, no major |
| UK_IRELAND · EUROPE · AFRICA · ASIA · LATIN_AMERICA · CARIBBEAN · MIDDLE_EAST · NORTH_AMERICA | ○ none |
| DEFENSE ● (2) · FORWARD ● (1) · MIDFIELD ● (1) | GOALKEEPER ○ none |
| secondary position | ○ none — all four are `None` |
| major present ● (2, both "exercise science") · absent ● (2) | one major string only |
| GPA ● (1) · SAT ● (2) · ACT ○ (0) | |

**Blind spots, separated by kind:**

- **Mechanical:** none found. Goalkeeper was the prime suspect and it travels
  end to end — 6,162 goalkeepers are classified on the 2026 rosters, a probe
  produced all nine licensed kinds, and the copy reads *"one goalkeeper is
  listed to graduate in 2027 — Andrea Farinella"*.
- **Copy / product diversity:** every non-Oceania region, goalkeeper, secondary
  position, a second major vocabulary, ACT-only academics.

## The finding K1 exists to produce

**The regional rule's credibility depends on how tight the region is, and it
was validated on the tightest one.** Read-only probes across the taxonomy, one
athlete shape, 500 programmes each:

| region | athlete | regional renders | what it says |
|---|---|---|---|
| UK_IRELAND | Ireland | 52 | "two defenders from United Kingdom in 2026" — **credible** |
| AFRICA | Nigeria | 31 | "one defender from Ghana in 2025" — **credible**, neighbours |
| OCEANIA | New Zealand | 59 | "one forward from Australia in 2025" — credible, and the only one J3 could see |
| LATIN_AMERICA | Brazil | 23 | "one defender from Panama in 2025" — thin |
| ASIA | Japan | 10 | "one defender from Vietnam in 2024" — **weak** |
| EUROPE | Norway | 75 | **"four defenders from Austria, Belgium, Greece and Portugal since 2025 — the same part of the world"** |
| NORTH_AMERICA | Canada | 0 | correctly silent — the region is 3 countries |

The Norwegian case is the adversarial one. Austria, Belgium, Greece and
Portugal are not "the same part of the world" as Norway in any sense a coach
would accept, and the sentence asserts it four countries at a time.

**Hypothesis for K2, not a change now:** J3's `region + position + recency`
conjunction is mechanically correct everywhere and semantically credible only
where the region is tight. EUROPE holds 50 countries and AFRICA 56; OCEANIA and
UK_IRELAND, where it reads well, hold 19 and 5. **K1 does not touch J3 policy.**

A second, separate observation: **the country list is uncapped.** J7 capped
graduation names at three; `list(strings(f.countries))` has no equivalent, and
four is what a broad region produces. Same defect class, different clause.

## The personas — four, not five

| persona | country / region | position | major | academics | secondary | sport |
|---|---|---|---|---|---|---|
| **K-EU** | Norway / EUROPE | Defender | none | none | none | men's |
| **K-DOM** | United States / domestic | Goalkeeper | computer science | GPA + ACT | Midfield | men's |
| **K-ASIA** | Japan / ASIA | Forward | none | none | none | men's |
| **K-TIGHT** | Ireland / UK_IRELAND | Midfielder | nursing | GPA only | none | women's |

Five candidates collapsed to four: the goalkeeper, the secondary position, the
second major vocabulary and the ACT-only academics all ride on **K-DOM**,
because none of them interacts with country and combining them costs no
resolution. What each adds that no other does:

- **K-EU** — the broadest region, the multi-country list, and an international
  athlete with no academic data at all. The single most adversarial profile.
- **K-DOM** — removes every international kind at once; adds goalkeeper, a
  secondary position, a non-Oceania major vocabulary, and ACT-only academics.
- **K-ASIA** — a region that is broad *and* sparse: 10 regional renders against
  Europe's 75. Tests the rule where it fires rarely and weakly.
- **K-TIGHT** — the control. A region where the claim should read well, on the
  women's side, with a major that is not "exercise science". Without it a K2
  failure cannot be told from "regional evidence is bad everywhere".

## Synthetic or real

**All four synthetic.** The programme side of every claim is real — real
rosters, real arrivals, real conferences — and only the athlete is fabricated.
That is exactly the right split: the athlete supplies country, position, class
year and major, and nothing about a real athlete would make those more true.

What synthetic athletes prove: branch coverage, fail-closed behaviour, copy
construction, position and region semantics, that a decision survives a profile
shape it has never seen.

What they cannot prove: **how often these shapes occur in the real recruiting
pipeline, whether the resulting emails work, or how a coach reacts.** A K2 pass
means the system generalises; it does not mean the emails are effective. Real
athlete data is not required for K2 and should not be imported for it.

## Pairing and expectations

Not every persona needs all 1,169 programmes. Each needs pairs that reach:
same-country history / none; same-region recent / stale / none; position
graduation present / absent; academic match / none; recognition; multiple
evidence; zero evidence.

**Adversarial pairs, one per Stage J decision:**

| target | pair shape |
|---|---|
| regional recency (J3) | K-EU where the only regional arrival is 3+ seasons old → must not open |
| POSITION_FLOW_HOLD (J4) | K-EU with a same-country position arrival **and** a graduating cohort at that position → graduation held |
| dedupe | any persona with both CONFERENCE_TITLE and POSTSEASON_RESULT → one survives |
| copy density (J7) | a cohort of 4+ → "including", never a four-name list |
| one-authority (J6) | every persona against the richest college object → no retired token resolves |
| generic fallback | K-DOM against a programme with no US history and no cohort |
| recognition framing (J8) | recognition-only → no "as well" |

**Negative controls — every persona must have pairs where the system says
less:** a broad region with no position conjunction, a stale arrival, only
DENIED evidence, and programme facts with no athlete tie. Saying nothing is the
expected result, not a coverage failure.

**Expectations are written before K2 runs.** For each scenario: which kinds
generate, qualify, are licensed, render, are held or deduped; the expected
structure; and generic-vs-personalised. Judging after seeing the output is how
a generalisation defect gets rationalised.

## K2 pass / fail

Pass requires all ten: no denied evidence renders · no unqualified evidence
renders · no stale regional claim opens an email · POSITION_FLOW_HOLD holds for
new profiles · no template bypass · generic fallback professional · regional
copy semantically credible · academic labels distinct · position semantics
correct · **no Stage J baseline moves merely because fixtures were added.**

**A generalisation defect is a rule that stays technically true and becomes
obviously wrong** — the Norwegian sentence is the type case. It is *not* an
athlete having fewer personalised emails. K-DOM will be heavily generic and
that is the correct answer, not a defect: J2 and J3 both chose clean generic
over weak personalisation, and K2 must not reopen a denied kind to raise a
coverage number.

## K2 implementation plan

Fixtures, **not production rows**. The canonical corpus is `SELECT * FROM
players` and adding an athlete would move all six baselines and change what the
dataset manifest fingerprints — which K1's own success criterion forbids.

- **`shared/evidence/__fixtures__/validationAthletes.js`** — the four personas
  as plain objects, the shape `evidenceFor` already takes.
- **`shared/evidence/generalisation.test.js`** — drives each persona against
  named real programmes through the production path, asserting the expectation
  table.
- **`npm run test:generalisation`** — runs it alone, so a failure reads as a
  generalisation finding rather than a regression.
- **No migration, no seed, no DB write.** `evidenceFor(athlete, collegeName)`
  takes an athlete object; a fixture is enough.
- **Isolation:** because nothing is inserted, `canonicalCorpus()` still returns
  4,742 pairs and every Stage J baseline stays exactly as it is.
