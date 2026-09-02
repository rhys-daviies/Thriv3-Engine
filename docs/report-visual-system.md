# The report's visual system

Phase 13D. What the Programme Intelligence PDF looks like, and the rules that
decide it. The information architecture is 13B's and the decision layer is
13C's; nothing here changes what the report says.

## The tiers

One hierarchy, applied on every primary page, in this order:

```
1  kicker      which act this page belongs to        claret small caps, 8pt
2  title       what this page is                     19pt bold ink
3  question    what it answers, and the scope strip  10pt / 7.5pt grey
4  reading     the page's own conclusion             9.5pt ink, claret left rule
5  section     a titled region begins here           claret small caps + hairline
   module      a chart's own title                   9.5pt bold ink
6  body / caption / note / label
```

Two rules were being broken across the report and are now enforced:

**The reading leads.** A page's own conclusion sits directly under its scope
strip, not at the foot of the sheet. *How this programme uses its squad* had it
last, under two charts and eight lines of annotation — the one primary page
where a reader had to reach the floor to find what the page concluded.

**A page's primary block is a section, not a module.** Four pages opened with a
chart under a 9.5pt module title while a supporting table below it carried a
claret section heading — so on those pages the hero was the quieter of the two
blocks. The chart's own title is now the section heading; the module tier still
belongs to a chart inside a section.

## No figure inside a chart is larger than the page title

The development page's four progression columns were set at 26pt — 37% larger
than the title above them, so the eye met the progression before the conclusion
the page had just stated. 19pt is the ceiling, which is the title's own size.

## Colour

Unchanged palette. What changed is that each colour has one job.

| | |
|---|---|
| **claret** `#8C2F39` | act, section and structural seams; the reading's left rule; the athlete's own position marked in the margin |
| **ink** `#131E2B` | the answer |
| **grey** `#78848F` | anything quieter than the answer — captions, notes, and the contents' evidence rows |
| **mid blue** `#5C8CB4` | the decision layer's metric gutter, and nothing else |
| navy / pale / green | the three replacement routes, and the same three on every page that draws them |

Nothing is colour-coded good or bad, no division is coloured by level, and the
count did not increase. The evidence rows on the contents page are grey rather
than the metric gutter's blue: a colour doing two jobs makes a quieter row read
as a different kind of row.

## Fewer boxes

The competitive timeline's division and conference spans were rounded, stroked,
tinted cards — the report's card language, which says "a module begins here". A
span of seasons in a lane is not a module. They are flat tints on a hairline
baseline now, with the dashed outline kept for an unestablished season, where
the absence of ink is the statement and needs an edge to be visible at all.

The decision layer's separators start at the text column rather than at the
margin, so six findings read as a list beside a column of numbers instead of six
horizontal rules crossing the page.

## The decision layer

- **The metric gutter is flush right and one size per page.** Sized per metric
  it stepped between 12.5 and 8.5 point inside one page, and left-aligned it was
  a ragged edge against the page's only clean vertical. The page now picks the
  largest step that fits all of its metrics.
- **The metric is a step quieter than the finding.** 13pt bold ink beside a
  10.5pt sentence made it a second headline for a finding that already had one.
- **Page references are navigation.** 7.5pt grey at the label's baseline, not
  9pt bold beside the sentence.
- **The snapshot is one weight.** Seven bold values under six findings made the
  orientation block the second-loudest thing on the report's most important
  page.

## Whitespace: intentional or unresolved

| page | before | after |
|---|---|---|
| Position by position | a 26-point strip of seven columns at the top of an empty page, with a wrapped header printing through the first row of data | four rows, 72 points each, with the minute mix as one bar |
| Destinations | a continuation page holding 350 points of ink on a 760-point sheet | the break moved one block earlier, so page one is "who stayed" and page two is "who left, and where the traceable few went" |
| First-year opportunity | the ladder in a 210-point band on a page with 600 to spare | 40 points a rung, opt-in per caller |
| Competitive history | five fact rows, three of them already printed above them on the same sheet | the two that are not |

A page with two blocks and a wide bottom margin is finished. A page whose
content stops a third of the way down and whose header wraps into its own data
is not, and those are what this phase went after.

## Font safety

*Rewritten in 13D.1. The homoglyph fold 13D shipped here is gone.*

### The defect

The report is set in the standard fourteen PDF faces, whose encoding is WinAnsi:
ASCII, Latin-1's upper half, and a handful of typographic extras. pdfkit's
`StandardFont.encode` does not **refuse** a code point outside that set — it
returns the code point itself as a glyph selector, with an advance width of
zero. The viewer reads the low byte of it against a WinAnsi encoding, so

```
"Zoё May"   U+0451 CYRILLIC SMALL LETTER IO
   →  drawn "ZoQ May", extracted "ZoQ May", nothing thrown
```

A misspelling that looks like a spelling is the worst failure this report can
have, and it is invisible to every check that does not read the finished page.

### Why folding was the wrong answer

13D drew ё as ë on the grounds that the two are the same shape. It rendered, and
it was still not the name. It could not have been made general either: the same
gap swallows **č, ć, ā, ē and ņ**, which are Latin letters with no Latin twin to
fold onto, and one of them is in this database already.

### What happens instead

Where the active standard face cannot encode a character, the whole `doc.text`
call is drawn in an **embedded** face. pdfkit subsets the real font and writes a
`/ToUnicode` CMap with it, so the content stream carries the actual glyphs and
the extracted text carries the actual code points.

| | |
|---|---|
| **granularity** | the call, not the run. pdfkit has no per-run fallback and its `text` carries wrapping, alignment, ellipsis and continuation; splitting a string into runs would mean reimplementing all of it by hand. With a fallback that is the same typeface this costs nothing visually. |
| **face** | one fallback per primary face, so bold falls back to bold and oblique to oblique. A report never spells one name two ways. |
| **source** | `server/assets/fonts` (nothing today — see below), then `THRIV3_UNICODE_FONT_DIR`, then fonts already installed: macOS's Helvetica collection first, because it is the typeface the report is already set in, then DejaVu. Nothing is ever downloaded. |
| **cost** | none where it is not needed. Mercyhurst, Rochester, California and Akron render **byte-identical content streams** to 13D; only UTSA's changed. |

**The repository ships no font, and that is a decision rather than an
oversight.** A font in a client-facing PDF is a licensing question and a binary
in the tree. Dropping three OFL-licensed faces into `server/assets/fonts` —
DejaVu Sans or Noto Sans, named `Thriv3Unicode-Regular.ttf`, `-Bold.ttf`,
`-Oblique.ttf` — makes this portable on every host with no other change. Until
then it works wherever the host has a Unicode face and fails loudly where it
does not.

### When no face has the glyph

Reported, never substituted. The layout audit asks the font that is actually
set — `encodableBy`, not a static WinAnsi table — so a character the embedded
face holds is not a defect and one no face holds still is. `verify:baseline`
then fails the build, in two classes:

- **a letter** outside WinAnsi that did not reach the page as itself is a
  rendering fault and fails;
- **a code point with no glyph in any face** is surfaced and does not fail,
  because no font change can fix it. Three Shawnee State men's roster rows carry
  C1 control characters from a double-decoded import; the remedy is a data
  correction, and the source data is never altered here.

### The production audit

Every name column in `roster_players`, `players`, `colleges` and `coach_seasons`
— 276,745 roster rows among them:

| character | where | reaches a page |
|---|---|---|
| U+0451 `ё` ×2 | UTSA women's `player_name` — *Zoё May* | **yes** |
| U+010D `č` ×1 | Texas A&M International men's `hometown` — *Poreč, Croatia* | no |
| U+0101 `ā` ×1 | Hawaii `colleges.nickname` — *Rainbow Wāhine* | no |
| U+0081, U+0083, U+0089 ×4 | three Shawnee State men's `player_name` rows | no |

Four letters outside WinAnsi in the whole database, one of which is drawn. It is
drawn as itself now, and `pdfUnicodeText` reads it back as U+0451 through the
PDF's own CMap — the same route a reader's copy-and-paste takes.

## What it cost

Measured across every report the universe produces.

| | before | after |
|---|---|---|
| reports | 2,260 | 2,260 |
| pages | 36,518 | **36,519** |
| mean pages | 16.2 | 16.2 |
| layout problems | 1 | **0** |

One report of 2,260 gains one page: USC Upstate women's, where the current-squad
page now carries a section heading over the eligibility timeline like every
other page's primary block, and that heading is what tips a long arrivals table
onto a second sheet. Three other programmes were tipped over by the same change
and recovered by taking the slack out of the chart's own box, which the chart
was not using. Nothing was compressed to hit a page count.

The one layout problem in the universe — a character Helvetica could not draw at
UTSA women's — is fixed by the font fallback above, so the universe now renders
with no defects of any kind. 13D closed it by drawing a different letter; 13D.1
closed it by drawing the right one.
