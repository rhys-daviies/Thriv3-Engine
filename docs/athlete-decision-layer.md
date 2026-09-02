# The athlete decision layer

Phase 13F. What an athlete report says first, and why it says that rather than
something else.

## The principle, inherited

**Rank the findings. Freeze the page order.** Same as the programme layer, and
the same renderer draws it. What differs is the subject: these findings are
about one position, one entry year and one origin group, and they are ranked
before the programme's own.

## The order the report now runs in

| page | what |
|---|---|
| 1 | cover and contents |
| 2 | **What Thriv3 sees for you** — ranked athlete findings, the input strip, the scope statement |
| 3 | **What Thriv3 sees about the programme** — the frozen programme findings and snapshot, one tier quieter |
| 4… | the athlete pathway pages |
| … | the frozen Programme Intelligence act, as substrate |
| … | the evidence, athlete evidence first |

The programme layer is not removed, reworded or re-ranked. It is called through
the same `decisionFindings` and drawn by the same `findingRow`; it simply no
longer opens a document named after an athlete.

## The candidate set

Eleven categories, and no others. Declaration order is the final tiebreak.

`position-depth-at-entry` · `position-arrival-reliance` ·
`position-first-year-record` · `position-opening-history` · `position-intake` ·
`position-minute-reach` · `origin-cohort` · `competitive-structure` ·
`coach-attribution` · `programme-development` · `traced-position-movement`

Nothing here computes. Every figure is already in the model and already printed
on a page of the report.

## Materiality

Deterministic, from established facts only: a measured departure from a pool,
a measured departure from the programme's own figure, a structural change, a
comparison of two measured quantities, or a repeated observed route. Never
prestige, conference, brand, coach reputation, or the athlete's own `level`.

### Class A — changes how the athlete must read everything else

| | rule |
|---|---|
| **position depth at entry** | the number of current players at this position eligible **beyond** the entry year is at least the number that a typical season at this position sees reach a starter's season. Two measured quantities compared; no new threshold. Below that it is class C. |
| **competitive structure** | a `DIVISION_CHANGE` inside the window. Every position pool comparison in the report is division-scoped, so a move means the seasons either side are read against different sets of programmes. |
| **coach attribution** | the coach context is `PROMINENT` — none or one measured season under the current coach, or an interim. Reframes every historical pathway statement. |

### Class B — a clear athlete-position pattern, measured against something

| | rule |
|---|---|
| **position arrival reliance** | the position's newcomer share of opened minutes differs from the **programme's own** newcomer share by at least `STEP_POINTS` (10 points, the margin `classifyProgramme` already uses to call a change a change). Otherwise class C. |
| **position first-year record** | the share of first-years at this position reaching a starter's season differs from the programme-wide share by at least `STEP_POINTS` points. Otherwise class C. |
| **position opening history** | at least two openings, and one route started after **every** one of them. A repeated route is a pattern; a split one is context. |
| **position intake** | the median added per cycle sits **outside** the pool's middle half. Inside it, class C. |
| **position minute reach** | the median reaching a starter's season sits **outside** the pool's middle half. Inside it, class C. |
| **origin cohort** | the same-origin and other-origin shares at this programme differ by at least `STEP_POINTS` points, and the cohort describes the athlete's own group. Otherwise class C. |

### Class C — pathway context

Any of the above whose measured departure is inside the normal range, stated
with its figures.

### Class D — secondary

| | rule |
|---|---|
| **programme development** | context, and a pointer. It is already a programme finding on page 3 and has its own page; it enters the athlete layer only where there is room, which is where there is little else. |
| **traced position movement** | only where the position's own traced sample cleared its gate — never where it fell back to the programme-wide group. The thinnest evidence in the report cannot lead. |

## Evidence

A gate first, a ceiling second, never a bonus — exactly the programme rule.

```
insufficient → not eligible                (except a class A record)
limited      → ceiling C
moderate     → ceiling B
strong       → ceiling A
record       → ceiling A
priority = the worse of (materiality, ceiling)
```

Within a class: stronger evidence first, then declaration order.

## Selection

All A and B. Then C to fill to six. Then D only while fewer than three have
been chosen. Six is the ceiling and **there is no floor** — a sparse programme
renders two findings, and the sparse pathway page's own
*what this record can be read for / what it cannot yet be read for* block
carries the rest.

## The canonical sentence

One statement per category, built in one place, returning the same contract the
programme layer uses:

```
{ category, label, priority, evidence, text, metric, evidenceNote, section }
```

`metric` is the single headline figure. No concept appears as two conflicting
headline metrics, and the renderer assembles nothing.

## The transfer assumption, stated

The athlete input carries `classYear` and no entry type, so the report cannot
tell a first-time college entrant from an athlete arriving with college seasons
behind them. **Every production athlete is assumed to be a first-time entrant**
and the first-year pathway is phrased accordingly.

`entryTypeIsFirstTime(athlete)` is the single place that assumption lives.
Where it cannot be established, the first-year categories are refused with
`entry-type-not-established` rather than phrased as if they described the
athlete's own route — and a regression test holds that, so a future transfer
fixture cannot silently inherit first-year framing.

## What this report does not assess

Stated once, on the athlete decision page: the report describes the football
environment the available data can measure. It does not assess academic fit,
cost, choice of major, campus preference or the institution. There is no
academic or cost data on the model, and nothing here should be read as a
judgement about the school.

## What the rules produce

Measured across every athlete × programme report the database can build —
4,733 of them, three athletes and the QA fixture against every active
programme in their sport.

| findings | reports | share |
|---|---|---|
| 0 | 924 | 19.5% |
| 1 | 566 | 12.0% |
| 2 | 493 | 10.4% |
| 3 | 144 | 3.0% |
| 4 | 82 | 1.7% |
| 5 | 312 | 6.6% |
| 6 | 2,212 | 46.7% |

| category | selected | share | mean rank | leads |
|---|---|---|---|---|
| position depth at entry | 3,506 | 74.1% | 1.23 | 3,026 |
| position intake | 3,068 | 64.8% | 3.19 | 355 |
| position minute reach | 2,480 | 52.4% | 3.88 | 82 |
| position arrival reliance | 2,385 | 50.4% | 3.78 | 74 |
| position opening history | 2,228 | 47.1% | 3.92 | 49 |
| position first-year record | 2,013 | 42.5% | 4.49 | 42 |
| coach attribution | 597 | 12.6% | 1.79 | 137 |
| origin cohort | 577 | 12.2% | 4.69 | 10 |
| programme development | 215 | 4.5% | 2.07 | 24 |
| competitive structure | 57 | 1.2% | 1.82 | 10 |
| traced position movement | 18 | 0.4% | 2.94 | 0 |

### Pathological behaviour, checked for

**Programme-general findings crowding out position findings** — no. The three
programme categories account for 18.3% of selections; the six position
categories account for 81.3%.

**Position depth leading too often** — it leads 3,026 times, and it is class A
on 2,124 of the 3,506 reports that carry it and class C on the other 1,383. It
is not automatically A: the comparison is the beyond-entry group against the
number of players at that position who typically reach a starter's season, and
where the group is smaller it is context.

**The same six every time** — 46.7% render six, but the six are drawn from a
set whose members range from 74% to 42% availability, so which six varies with
what is readable at that position. Only **21 of 2,212** six-finding reports are
six class C findings, and **2,814 of 3,809** reports with any finding lead with
a class A or B.

**Coach absence dominating** — no. It is refused 4,136 times as not-prominent
and selected on 12.6%; the unresolved case never enters at all.

**Origin over-selected** — no: 12.2%, refused 2,288 times on a closed cohort
gate and 1,527 times because the cohort does not describe the athlete.

**Low-traceability movement leading** — no: 0.4% of reports, and it leads none.

**Sparse padding** — no. 924 reports render nothing, and the pathway page's own
*what this record can be read for / what it cannot yet be read for* block
carries them.
