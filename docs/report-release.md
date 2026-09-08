# The report product — release notes

Phase 13I. What the Programme Intelligence report is, what it depends on, what
it does not claim, and how to reproduce one. The architecture, the visual
system, both decision layers and the staff-question contract are frozen; this
is the operational document.

Read alongside: `programme-report-architecture.md`, `decision-layer.md`,
`athlete-decision-layer.md`, `staff-questions.md`, `report-visual-system.md`.

## What it is

Two documents from one renderer.

| | pages (universe) | what it answers |
|---|---|---|
| **Programme Intelligence** | 6–23, mean 15.6 | how one programme recruits, develops, retains and replaces players |
| **Athlete × Programme** | 8–31, median 25 | the same record read for one position, one entry year and one origin group, with the athlete's own reading first |

An athlete report is not the programme report plus athlete pages. Pages two and
three are two ranked readings — the athlete's, then the programme's one tier
quieter — followed by the athlete's own analysis, the questions it makes worth
asking, the frozen programme act as substrate, and the evidence.

## What it does not claim

Enforced in code and asserted in `npm run verify:baseline`, not left to review:

- **No score of any kind.** No overall fit, no fit score, no composite, no
  hidden total. The priority classes that order findings and questions are
  never printed.
- **No forecast.** Every figure describes a season that has been played.
  Projected minutes are attached to named current players and are never
  converted into minutes available to a reader.
- **No recommendation.** Nothing says whether to go. The staff-question page
  opens unknowns; it does not answer them.
- **No institutional judgement.** The report measures a football environment.
  It does not assess academic fit, cost, choice of major, campus or the
  institution, and page two says so.
- **A refusal is a statement about the published record**, never about the
  programme. Thresholds are the same for every programme in a sport.

## Endpoints

```
GET /api/philosophy/:collegeId/report.pdf
GET /api/players/:playerId/philosophy/:collegeId/report.pdf
```

Both return `application/pdf` with a `Content-Disposition` carrying an ASCII
`filename=` and an RFC 5987 `filename*=`. 404 for an unknown college or player,
400 where the athlete's sport does not match the programme's, 500 otherwise.

`programReportModel({ collegeId, playerId })` builds the model and
`renderProgramReport(model)` returns a `Buffer`. Nothing else is required.

### Filenames

```
Thriv3_Programme_Intelligence_Mercyhurst_Mens_Soccer.pdf
Thriv3_Rhys_Davies_Mercyhurst_Mens_Soccer.pdf
```

`reportFilename(model)`. Deterministic, filesystem-safe, no internal id and no
timestamp, so the same inputs name the same file and a regenerated report
replaces its predecessor. The sport is in the name because without it the men's
and women's reports for one college collide.

### Metadata

`Title`, `Author`, `Subject`, `Producer`, `Creator`. Every value is something
the cover already prints. No ids, no paths, no build strings.

## Data dependencies

One SQLite database, `server/data/recruitmatch.sqlite`, or whatever
`RECRUITMATCH_DB` points at. Tables read: `colleges`, `roster_players`,
`players`, `coach_seasons`, `programme_seasons`,
`programme_conference_seasons`, `conference_members_official`,
`conference_seasons`, `institution_aliases`.

**Generation is read-only.** After the client has opened and migrated,
generating a programme report and an athlete report leaves the file hash and
`PRAGMA data_version` unchanged. The database client itself runs migrations on
import, so a report process opens the file read-write even though the report
never writes.

## Fonts

The document is set in the standard fourteen PDF faces. A `doc.text` call
containing a character those faces cannot encode is drawn in
**Liberation Sans 2.1.5** instead, vendored under `server/assets/fonts` under
the SIL Open Font License 1.1 — see the README there for provenance and the
licence argument. It is first in the resolution chain, so a report generated in
a Linux container spells a name the way one generated on a developer's Mac
does. Host fonts remain as a last resort. Liberation Sans is metric-compatible
with Helvetica, which is why bundling it moved no page in any report.

A character no available face can draw is **surfaced, never substituted**: the
layout audit records it and the build gate prints it.

## Performance

Warm, on a developer Mac: a programme report 27–52 ms, an athlete report
36–62 ms, of which the model is 4–8 ms. Cold, the first report of a sport pays
3.5 s to build the division benchmark pool, which is then cached per process.
73–98 KB per document.

## Determinism

Model, section plan, page count, extracted text, every content stream and total
byte length are identical across repeated generation from unchanged data. The
only bytes that differ are `/CreationDate` and the `/ID` derived from it.

## QA commands

```
npm test                        # 2,114 unit and rendering tests
npm run verify:baseline         # 166 invariants over the whole universe
npm run snapshot:pi -- --check  # analytical baseline, 0 differences expected
node server/scripts/seedQaAthlete.js   # re-seed the women's QA fixture
```

The seeded fixture `qa-fixture-womens-soccer-0001` is the only women's-soccer
athlete on file and exists because every production athlete is men's soccer. It
is archived, unpublished and has no public slug, and an invariant holds all
three.

## Reproducing a report

```js
import { programReportModel } from './server/routes/philosophy.js';
import { renderProgramReport, reportFilename } from './server/lib/philosophyReport.js';

const model = programReportModel({ collegeId, playerId });   // playerId optional
const pdf = await renderProgramReport(model);
writeFileSync(reportFilename(model), pdf);
```

Pass `{ audit: createAudit() }` as a second argument to collect layout defects:
`violations`, `clipped`, `unencodable`, `collisions`.

## Exemplar set

Ten frozen documents — five programme, five athlete — covering rich, sparse,
women's, division-change, coach-unresolved and the seeded QA fixture. They are
the release regression fixtures. Generated by the exemplar script in the phase
scratchpad; page counts are recorded in the 13I report.

## Known limitations and deferred debt

### Entry type is not modelled

Every production athlete is **assumed to be a first-time college entrant**.
`players` has no entry-type column and nothing outside the PDF model reads one.
The assumption lives in exactly one place, `entryTypeIsFirstTime`, and where a
future input does supply an entry type that is not first-time, the first-year
finding and the first-year staff question refuse rather than describe somebody
else's route. Two regression tests hold that. Closing it properly needs a field
on `players` and a decision about what a transfer report should say — neither
is a rendering change.

### Roster name fragments

69 of 9,161 programme-seasons (228 rows, 0.08%) hold a player name that is a
prefix of another name in the same programme-season. At Shawnee State 2025 one
player's season is split across three differently-mangled spellings — a
20-character truncation, a cut HTML entity (`Rodrigo Rold&aac`), and a cut
multibyte sequence that left a C1 control character — with the minutes divided
between them, so no single row reaches a starter's season where the true total
would.

This is why the three control characters are **not** repaired: no standard
encoding round-trip or Unicode normalisation recovers a clean name from them,
and repairing the characters would make three duplicate fragment rows look
legitimate. It is a source/importer defect, bounded, pre-existing and unrelated
to the report. An invariant prints the count so it cannot be forgotten.

### Class labels the analysis cannot read

574 rows in 16 forms carry something that is not a class — a graduation year,
or a redshirt with no year attached. `classDisplay` shows those exactly as
stored rather than guessing. 98.3% of rows resolve to one of FY/SO/JR/SR/GR.

### Position-movement placement

`athlete-position-movement` sits in the pathway act where the position's own
traced sample clears `MIN_POSITION_DESTINATIONS` (7.4% of athlete reports) and
in the evidence act where it does not (10.6%); it is absent from the other 82%.
This is **intentional dynamic prominence** and the page's own voice follows it —
a handful of traced players is filed with the supporting record and says so.
The contents heading follows the same rule, so a reader is never sent to an act
the page disowns. Documented rather than changed.

### Cold-rebuild timestamps

Two cold rebuilds of `institution_aliases` and `programme_seasons` from the
same inputs produce byte-identical analytical columns and differ only in
`imported_at`. Every published report output is identical. Non-blocking.

### Coach source contamination

129 programme-seasons carry a named coach row the role reader refuses — a
director of soccer, an associate head coach, a table cell that is not a person.
None of them attributes a season, as either a measured season or the current
coach, and an invariant checks it. A name appearing in a report because the
same person is the head coach in another season is not a leak. Importer debt.

### Not verified

Chrome's pdfium was not exercised: the in-app browser hands a PDF to the
operating system rather than rendering it, and no independent PDF validator
(`qpdf`, `mutool`, `pdftotext`) is installed on this machine. The exemplars
were verified with CoreGraphics and macOS Quick Look — which is Preview's own
engine — and with an independent ToUnicode text extractor.
