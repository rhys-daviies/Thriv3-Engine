# The report's Unicode fallback face

Three font files, vendored deliberately. They are the runtime contract for
drawing a name whose spelling is outside WinAnsi — see the docblock at the top
of `server/lib/reportFonts.js` for the defect they exist to close.

## What is here

| file | face it serves | sha256 |
|---|---|---|
| `LiberationSans-Regular.ttf` | `Helvetica` | `76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8` |
| `LiberationSans-Bold.ttf` | `Helvetica-Bold` | `788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173` |
| `LiberationSans-Italic.ttf` | `Helvetica-Oblique` | `e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0` |

`LICENSE` and `AUTHORS` are the upstream files, copied unchanged.

## Source and version

**Liberation Sans 2.1.5**, released 2021-09-30 by Red Hat.

- Project: https://github.com/liberationfonts/liberation-fonts
- Release: `liberation-fonts-ttf-2.1.5.tar.gz`
- Tarball sha256: `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`

The three files are byte-identical copies from that tarball. Nothing has been
subset, renamed inside the font, hinted, or otherwise modified.

## Licence, and why redistribution is permitted

**SIL Open Font License, Version 1.1** — the full text is in `LICENSE`.
Copyright (c) 2010 Google Corporation with Reserved Font Names Arimo, Tinos and
Cousine; copyright (c) 2012 Red Hat, Inc. with Reserved Font Name Liberation.

The OFL permits the font software to be "bundled, embedded, redistributed
and/or sold with any software" provided the copyright notice and licence travel
with it — which is what `LICENSE` beside these files does. It also states that
documents created *using* the fonts are not themselves bound by the licence, so
a generated report carries no obligation to its recipient. The one prohibition
that matters here is selling the fonts standalone, which we do not do, and
using the Reserved Font Name on a *modified* version, which is why the files
keep their upstream names and are copied rather than renamed.

## Why this family

- **Metric-compatible with Arial, and so with Helvetica.** Across the strings
  this report actually sets, Liberation Sans and Helvetica agree on width to
  within 1.2% at worst and about 0.3% typically. A fallback run therefore
  occupies the width the layout already reserved for it, which is why bundling
  it moved no page in any report.
- **Coverage.** 2,620 glyphs: Latin including Extended-A and Extended-B,
  Cyrillic, Greek. Every character in the production roster that Helvetica
  cannot encode is present, and so is every typographic mark the report uses.
- **Visually compatible.** A neutral grotesque, so a fallback line does not
  announce itself in a document set in Helvetica.
- **Mature and unambiguous.** Shipped by every major Linux distribution for
  over a decade, with a licence that has not changed since 2.00.

## What it does not do

It is not the report's primary face. The document is still set in the standard
fourteen, which keeps the PDFs small and the text extractable; these files are
reached only by a `doc.text` call containing a character the active standard
face cannot encode. An ASCII-only report never touches them and is byte-for-byte
unaffected by their presence.

A character no face here can draw is still **surfaced rather than substituted** —
the layout audit reports it and `npm run verify:baseline` prints it. Three rows
in the production database carry C1 control characters from a broken import;
those are a data defect and no font can fix them.
