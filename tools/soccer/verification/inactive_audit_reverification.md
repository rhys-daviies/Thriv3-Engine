# Re-verification of `removed_inactive_2025.json`

An Aug-20 audit deleted 24 men's soccer programmes on the evidence *"absent from the NCAA
men's-soccer team list"*. Absence established by matching our school name against a registry
is the weakest signal available — it fails silently whenever the registry spells a school
differently, and it failed twice inside a single entry (Concordia Irvine's record block read
null for all five seasons while the school was playing 8-7-1).

All 24 were re-checked against **positive** evidence. Final: **3 wrong, 17 correct, 4 open.**

## Wrongly removed — 3 (all since restored)

Evidence: a men's 2025 roster in `Thriv3/2025 Roster Sheets`, scraped from the school's own
roster page.

| School | Evidence |
|---|---|
| Concordia Irvine | men's roster present; site confirms 8-7-1 |
| Emmanuel (GA) | men's roster present; site confirms 7-8-3 |
| Huntington University | men's roster, 39 players |

Huntington's evidence is NAIA-only, and the NAIA roster sheets cover 2025 alone, so it has no
second season to corroborate it. Carry that qualifier if it matters.

## Correctly removed — 17

**Closed or absorbed (7)** — Cazenovia (2023), Cardinal Stritch (2023), Wesley (absorbed by
Delaware State, 2021), Clarks Summit (2024), Wells (2024), Eastern Nazarene (wound down from
fall 2024), Fontbonne (closed summer 2025).

Eastern Nazarene still has five 2025 men's-soccer coaching contacts on file. A coach page can
outlive the programme; a contact record is weaker evidence than a roster.

**No men's soccer programme (7)** — established from each site's own sport navigation:

| School | Sports listed | Mentions of "soccer" in the page |
|---|---|---|
| Peru State | 24 | 0 |
| Kentucky State | 21 | 0 |
| Montana Western | 18 | 0 |
| Valley City State | 15 | 0 |
| Lewis-Clark State | 14 | 0 |
| Langston | 10 | 0 |
| Trinity International | — | has soccer, but see below |

Trinity International is the exception in this group: it does field soccer, but
`/sports/mens-soccer/roster/2023`, `/2024` and `/2025` all return the **2022** roster, byte
for byte. Its most recent published season is 2022, so the programme appears discontinued
after that — removal correct, for a different reason than the audit gave.

**Women's programme only, no men's (3)** — Montana State Billings, Edward Waters, Dakota
State. Each has a 2025 women's roster and no men's roster in any file, NCAA or NAIA. Their
women's rows are already present and correct in the women's records file.

## Still open — 4

| School | Why |
|---|---|
| Inter American (PR) | Spanish-language site; a `/department/balompie/` page titled "Fútbol" exists, but nothing establishes a 2025 **men's** team |
| Multnomah | site returns 403 |
| Montana State Northern | host unreachable |
| Cascade | probably not a school at all — "Cascade" is a conference name, and the audit row lists conference = "Cascade" too |

## Two traps this pass had to route around

**SideArm serves a "General" placeholder with HTTP 200 for a sport that does not exist.** A
200 response whose title names the school is NOT evidence the sport exists. Lewis-Clark
State's `/sports/mens-soccer` returns 389 KB titled "General", while `/sports/mens-basketball`
on the same site returns "Men's Basketball — Lewis-Clark State College". Requiring the title
to contain the sport is what separates them. An earlier version of this check reported 8
schools as having men's soccer on the strength of "General" pages.

**Always probe the opposite sex as a control.** Where *neither* men's nor women's soccer
resolves, the URL pattern is wrong and there is no verdict — that is a failed lookup, which is
the exact error being investigated. Only "men's missing while women's resolves", or an
explicit sport list without soccer, counts as evidence of absence.
