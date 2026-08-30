/**
 * The front of the Program Intelligence Report: the map and the two
 * at-a-glance pages.
 *
 * Everything here reads `model.summary` and `model.sections` and draws. It
 * computes nothing — if a number is needed and the model does not carry it,
 * the model is where it gets added, not here. That split is what lets the
 * whole interpretation layer be tested without producing a PDF.
 *
 * Three drawing rules, inherited from the evidence pages and worth restating
 * because this file is where a dashboard layout is most tempted to break them.
 *
 * A quantity that could not be measured prints its reason, never a zero, and
 * never an empty track. Colour carries no judgement: the classification chips
 * are all drawn identically and the WORD does the work, because a green chip
 * and a red chip would say something the arithmetic does not. And nothing is
 * scored — there is no composite number anywhere on these pages.
 */
import { THEME, TYPE, pageHead, fitHeadline, minutes, fitText } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';
import { positionPlural } from '../../shared/positions.js';

const { INK, MUTED, LINE, CLARET, NAVY, MID, PALE, GREEN, M, W } = THEME;

const GAP = 12;
const HALF = (W - GAP) / 2;

const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pctOf = (v, digits = 0) => (v == null ? '—' : `${(100 * v).toFixed(digits)}%`);

export { fitText };

/**
 * The one place a programme's own colour appears.
 *
 * Restrained on purpose, and measured before it was decided. Of 2,401 active
 * programmes across both sports, 1,438 record a primary colour at all — 60% —
 * so anything structural built on it would look like a different product for
 * the other 40%. Of the ones that do, 50 are effectively invisible on paper:
 * Indiana's #EDEBEB, three literal whites, and a run of school yellows.
 *
 * So: a single accent rule on the cover, falling back to Thriv3 navy so the
 * layout is identical either way. It never colours a chart, a classification
 * or a number, because a colour that carries meaning somewhere cannot be
 * decoration here. Logos are deliberately absent — the stored URLs are remote
 * Wikimedia SVGs, and fetching and rasterising one inside PDF generation buys
 * a fragile network dependency for an image nobody is reading the report for.
 */
export function identityColour(college) {
  const raw = String(college?.primary_color ?? '').trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(raw);
  if (!m) return { colour: NAVY, fromCollege: false };
  const v = parseInt(m[1], 16);
  const channel = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((v >> 16) & 255) + 0.7152 * channel((v >> 8) & 255)
    + 0.0722 * channel(v & 255);
  // 2:1 against the page, not the 3:1 a piece of text would need — this is a
  // solid mark carrying no information, so the only question is whether it
  // reads as deliberate. Below it (1,388 of 1,438 colours pass) the house
  // colour is used instead: 50 programmes' primaries are a near-white, a
  // literal white or a school yellow that prints as a smudge.
  if (1.05 / (lum + 0.05) < 2) return { colour: NAVY, fromCollege: false };
  return { colour: `#${m[1].toUpperCase()}`, fromCollege: true };
}

/** One line of text, guaranteed to stay on one line and inside `width`. */
function line(doc, text, x, y, width, { font = 'Helvetica', size = 7.5, color = INK, align = 'left' } = {}) {
  doc.font(font).fontSize(size).fillColor(color)
    .text(fitText(doc, text, width), x, y, { width, align, lineBreak: false });
}

/**
 * Reader-facing words for the machine-readable classifications.
 *
 * Kept here rather than in the model for the same reason VERDICT_LABEL is: the
 * PDF and the tab say different things about the same finding, and the
 * analytics layer should not be choosing between them.
 */
export const CLASSIFICATION_LABEL = {
  'above-benchmark': 'ABOVE PROGRAMME BENCHMARK',
  typical: 'TYPICAL',
  'below-benchmark': 'BELOW PROGRAMME BENCHMARK',
  mixed: 'MIXED HISTORY',
  unclear: 'UNCLEAR',
  unavailable: 'UNAVAILABLE',
};

/** The route a position's minutes have historically taken. */
export const ROUTE_LABEL = {
  returning: 'RETURNING PLAYERS',
  freshman: 'FIRST-YEARS',
  newcomer: 'EXPERIENCED ARRIVALS',
  mixed: 'MIXED',
};

/**
 * What the coaching record means for everything else on the page.
 *
 * Phrased as relevance rather than quality: a stable record and a new coach
 * are not better and worse, they are more and less applicable to the seasons
 * the rest of the report describes.
 */
export const COACH_HEADLINE = {
  'describes-current': 'CURRENT COACH HISTORY',
  'partly-describes-current': 'COACHING CHANGE',
  'describes-previous': 'NEW COACH',
  unknown: 'COACHING RECORD INCOMPLETE',
};

export const COACH_SUBLINE = {
  'describes-current': 'stable across the seasons measured',
  'partly-describes-current': 'older seasons less representative',
  'describes-previous': 'no measurable record yet',
  unknown: 'seasons could not be attributed',
};

const EVIDENCE_LABEL = { strong: 'STRONG', moderate: 'MODERATE', limited: 'LIMITED' };

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

/**
 * A bordered panel with a small-caps title. Returns the inner content box.
 *
 * Drawn in absolute coordinates inside a box the caller reserved with
 * `k.slot()`, the same contract the charts keep — the flow cursor is never
 * consulted, so nothing here can auto-paginate out from under a half-drawn
 * card.
 */
export function panel(doc, box, title) {
  doc.save().roundedRect(box.x, box.y, box.w, box.h, 4)
    .lineWidth(0.75).strokeColor(LINE).stroke().restore();
  const pad = 14;
  let y = box.y + pad;
  if (title) {
    // The same claret small capitals with a rule under them that opens a
    // section on a flowing page. A card and a section are the same level of
    // the document, so they are set the same way.
    doc.font(TYPE.section.font).fontSize(TYPE.section.size).fillColor(TYPE.section.color)
      .text(title.toUpperCase(), box.x + pad, y,
        { width: box.w - pad * 2, characterSpacing: TYPE.section.spacing, lineBreak: false, ellipsis: true });
    y += 13;
    doc.save().moveTo(box.x + pad, y).lineTo(box.x + box.w - pad, y)
      .lineWidth(0.5).strokeColor(LINE).stroke().restore();
    y += 11;
  }
  return { x: box.x + pad, y, w: box.w - pad * 2, bottom: box.y + box.h - pad };
}

/**
 * A classification pill.
 *
 * Every classification is drawn identically. A colour scale here would rank
 * programmes by hue, and the whole point of the benchmark vocabulary is that
 * it reports a position rather than a verdict. Only the two absences are
 * muted, because "we could not tell" should not read as loudly as a finding.
 */
export function chip(doc, x, y, text, { muted = false, max = 200 } = {}) {
  doc.font('Helvetica-Bold').fontSize(7);
  // Measured and cut before the pill is sized, so the pill can never be
  // narrower than its own label — which is what split TYPICAL across two
  // lines the first time this page was drawn.
  const label = fitText(doc, String(text ?? ''), max - 16);
  const w = doc.widthOfString(label) + 16;
  doc.save().roundedRect(x, y, w, 14, 7).fillOpacity(muted ? 0.06 : 0.1)
    .fill(muted ? MUTED : NAVY).restore();
  doc.font('Helvetica-Bold').fontSize(7).fillColor(muted ? MUTED : NAVY)
    .text(label, x + 8, y + 4.2, { lineBreak: false });
  return w;
}

/** The one number a module is about, at a size that finds the eye first. */
export function bigMetric(doc, x, y, value, { unit = '', caption = null, muted = false, width = 220 } = {}) {
  doc.font('Helvetica-Bold').fontSize(23).fillColor(muted ? MUTED : INK)
    .text(String(value), x, y, { lineBreak: false });
  const w = doc.widthOfString(String(value));
  if (unit) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(unit, x + w + 4, y + 12, { lineBreak: false });
  }
  if (caption) {
    line(doc, caption, x, y + 27, width, { size: 7.8, color: MUTED });
  }
  return y + (caption ? 40 : 30);
}

/**
 * How much record stands behind the statement above it.
 *
 * Never "confidence" and never a percentage: the words are the whole point,
 * and a number here would be the false precision the model refuses upstream.
 */
export function evidenceChip(doc, x, y, evidence, sample, width = 220) {
  if (!evidence) return y;
  const label = EVIDENCE_LABEL[evidence.level] ?? 'LIMITED';
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED)
    .text(`EVIDENCE — ${label}`, x, y, { characterSpacing: 0.8, lineBreak: false });
  if (sample) line(doc, sample, x, y + 9, width, { size: 6.5, color: MUTED });
  return y + (sample ? 20 : 11);
}

/** One horizontal bar with an optional pool marker. Null draws its reason. */
export function miniBar(doc, x, y, w, { value, max, marker = null, unavailable = null, color = NAVY }) {
  if (value == null || !max) {
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED)
      .text(unavailable || 'not enough on file', x, y + 1, { width: w, lineBreak: false, ellipsis: true });
    return y + 12;
  }
  doc.save().roundedRect(x, y, w, 8, 2).fill('#EDEFF3').restore();
  doc.save().roundedRect(x, y, Math.max(2, Math.min(1, value / max) * w), 8, 2).fill(color).restore();
  if (marker != null && marker > 0 && marker <= max) {
    const mx = x + (marker / max) * w;
    doc.save().moveTo(mx, y - 2).lineTo(mx, y + 10).lineWidth(1).strokeColor(CLARET).stroke().restore();
  }
  return y + 12;
}

/**
 * The three-way split, as a stacked bar.
 *
 * Honest here specifically because the shares partition the minutes exactly —
 * that is enforced in `vacancyObservations`. The opening COUNTS on the same
 * card overlap and are never drawn this way.
 */
export function miniStacked(doc, x, y, w, parts, { unavailable = null } = {}) {
  const usable = parts.filter((p) => p.value != null);
  if (usable.length !== parts.length) {
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED)
      .text(unavailable || 'no position-seasons we can read', x, y + 1, { width: w, lineBreak: false, ellipsis: true });
    return y + 12;
  }
  const total = usable.reduce((s, p) => s + p.value, 0) || 100;
  let cx = x;
  for (const p of parts) {
    const seg = (p.value / total) * w;
    doc.save().rect(cx, y, Math.max(0, seg - 1.5), 10).fill(p.color).restore();
    cx += seg;
  }
  let ly = y + 14;
  for (const p of parts) {
    doc.save().rect(x, ly + 1.5, 6, 6).fill(p.color).restore();
    doc.font('Helvetica').fontSize(7).fillColor(INK)
      .text(`${Math.round(p.value)}%  ${p.label}`, x + 10, ly, { width: w - 12, lineBreak: false, ellipsis: true });
    ly += 11;
  }
  return ly;
}

/**
 * The limitation a reader must not miss, and the coverage detail beneath it.
 *
 * They were drawn identically — same size, same colour, same italic — while
 * carrying different weight. The primary is bordered and set in ink; the
 * secondary is muted and unbordered. Neither is coloured for good or bad.
 */
export function calloutPrimary(doc, x, y, w, text) {
  const inner = w - 14;
  const h = doc.font('Helvetica').fontSize(7.2).heightOfString(text, { width: inner }) + 12;
  doc.save().rect(x, y, w, h).fillOpacity(0.04).fill(INK).restore();
  doc.save().rect(x, y, 2, h).fill(INK).restore();
  doc.font(TYPE.label.font).fontSize(6).fillColor(MUTED)
    .text('WHAT THIS CANNOT SEE', x + 8, y + 5, { width: inner, characterSpacing: 0.8, lineBreak: false });
  doc.font('Helvetica').fontSize(7.2).fillColor(INK).text(text, x + 8, y + 14, { width: inner });
  return y + h + 10;
}

export function calloutSecondary(doc, x, y, w, text) {
  doc.font('Helvetica').fontSize(6.8).fillColor(MUTED).text(text, x, y, { width: w });
  return doc.y + 6;
}

/** A key/value line, tight enough to stack several inside a card. */
export function factLine(doc, x, y, w, key, value) {
  doc.font('Helvetica-Bold').fontSize(7.5);
  const valueW = Math.min(w * 0.5, doc.widthOfString(String(value)) + 2);
  line(doc, key, x, y, w - valueW - 6, { size: 7.5, color: MUTED });
  line(doc, value, x + w - valueW, y, valueW, { font: 'Helvetica-Bold', size: 7.5, align: 'right' });
  return y + 11;
}

/** A compact roster row: who, what class, what they are projected to play. */
function playerLine(doc, x, y, w, p, { highlight = false } = {}) {
  doc.font(highlight ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(INK)
    .text(p.name ?? '—', x, y, { width: w * 0.44, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(p.classLabel ?? '—', x + w * 0.44, y, { width: w * 0.17, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(7).fillColor(p.projectedMinutes == null ? MUTED : INK)
    .text(p.projectedMinutes == null ? 'no projection' : `${nf(p.projectedMinutes)} min`,
      x + w * 0.61, y, { width: w * 0.22, align: 'right', lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(p.eligibleTo == null ? '—' : String(p.eligibleTo), x + w * 0.85, y,
      { width: w * 0.15, align: 'right', lineBreak: false });
  return y + 10.5;
}

/** Column headings for a roster list, so the bare years have a meaning. */
function playerHeader(doc, x, y, w) {
  const put = (t, ox, ow, align) => line(doc, t, x + ox, y, ow,
    { font: 'Helvetica-Bold', size: 6, color: MUTED, align });
  put('PLAYER', 0, w * 0.44, 'left');
  put('CLASS', w * 0.44, w * 0.17, 'left');
  put('PROJECTED', w * 0.61, w * 0.22, 'right');
  // Matched to the data column below it, and short enough to stay inside it.
  put('ELIG.', w * 0.85, w * 0.15, 'right');
  return y + 9;
}

// ---------------------------------------------------------------------------
// PAGE 1 — the report map
// ---------------------------------------------------------------------------

/**
 * The contents, drawn onto the reserved first page after everything else
 * exists.
 *
 * Called with the document switched back to page one, so it must draw in
 * absolute coordinates and must not use anything that consults the flow
 * cursor — `k.room()` would call `addPage()` mid-walk and append a blank page
 * to the end of a finished document, which is the defect `footer()` already
 * carries a comment about.
 *
 * `pages` maps a section id to the page it actually started on. Sections with
 * no entry are not in the document and are not listed: a contents page that
 * advertises a section the reader cannot find is worse than a shorter one.
 */
export function contentsPage(doc, model, plan, pages) {
  const c = model.college;
  const a = model.athlete;
  // Ordered by the page each section actually starts on, not by the order the
  // registry happens to declare. The two diverged the moment a v1 section was
  // rendered outside registry order, and a contents page whose numbers do not
  // ascend is worse than no contents page.
  const listed = plan.filter((s) => pages.has(s.id))
    .sort((x, y2) => pages.get(x.id) - pages.get(y2.id) || x.order - y2.order);
  const identity = identityColour(c);

  doc.font(TYPE.kicker.font).fontSize(TYPE.kicker.size).fillColor(TYPE.kicker.color)
    .text('THRIV3', M, M - 18, { width: W, characterSpacing: TYPE.kicker.spacing, lineBreak: false });

  let y = M + 4;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
    .text('PROGRAM INTELLIGENCE REPORT', M, y, { width: W, characterSpacing: 1.6, lineBreak: false });
  y += 20;

  // The cover is the one place the programme's full name must appear whole, so
  // it shrinks to fit rather than clipping. "West Virginia University
  // Institute of Technology" was arriving as "West Virginia University
  // Institute of T…" on the front of its own report.
  doc.font('Helvetica-Bold');
  const nameSize = fitHeadline(doc, c.name, W, 26, 15);
  // Below the floor it WRAPS rather than clipping. Everywhere else in the
  // report a title that will not fit is cut, because a title is a fixed slot
  // in a layout; here it is the name on the front of the document, and the
  // block beneath simply starts lower.
  doc.fontSize(nameSize).fillColor(INK).text(c.name, M, y, { width: W });
  y = doc.y + 5;

  // The programme identity rule. Short, under the name, and the only place a
  // college colour appears anywhere in the document.
  doc.save().rect(M, y, 46, 3).fill(identity.colour).restore();
  y += 12;

  const place = [c.nickname, c.division, c.conference, [c.city, c.state].filter(Boolean).join(', ')]
    .filter(Boolean).join('  ·  ');
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
    .text(place, M, y, { width: W, lineBreak: false, ellipsis: true });
  y += 20;

  if (a) {
    doc.save().moveTo(M, y).lineTo(M + W, y).lineWidth(0.75).strokeColor(LINE).stroke().restore();
    y += 11;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
      .text(`Prepared for ${a.name}`, M, y, { width: W, lineBreak: false, ellipsis: true });
    y += 15;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text([a.positionLabel, a.nationality, `entering ${model.entrySeason}`].filter(Boolean).join('  ·  '),
        M, y, { width: W, lineBreak: false, ellipsis: true });
    y += 20;
  }

  // The value statement, built from what the model actually holds rather than
  // from a sentence that claims four seasons whatever the data says.
  const seasons = model.describes ?? [];
  const span = seasons.length
    ? `${seasons.length} season${seasons.length === 1 ? '' : 's'} of roster behaviour `
      + `(${seasons.length === 1 ? seasons[0] : `${seasons[0]}–${seasons[seasons.length - 1]}`})`
    : 'the roster seasons on file';
  const scopeText = `${span}, recruiting patterns, playing-time evidence and current squad context — `
    + `applied to this programme${a ? ' and to your pathway' : ''}. Nothing here is a forecast: the `
    + `${model.recruitSeason} season has not been played.`;
  const scopeH = doc.font('Helvetica').fontSize(8.5).heightOfString(scopeText, { width: W - 28 }) + 20;
  doc.save().rect(M, y, W, scopeH).fillOpacity(0.05).fill(NAVY).restore();
  doc.font('Helvetica').fontSize(8.5).fillColor(INK)
    .text(scopeText, M + 14, y + 10, { width: W - 28 });
  y += scopeH + 26;

  doc.font(TYPE.label.font).fontSize(7.5).fillColor(MUTED)
    .text('CONTENTS', M, y, { width: W * 0.6, characterSpacing: 1, lineBreak: false });
  doc.font(TYPE.label.font).fontSize(7.5).fillColor(MUTED)
    .text('PAGE', M + W - 40, y, { width: 40, align: 'right', characterSpacing: 1, lineBreak: false });
  y += 12;
  doc.save().moveTo(M, y).lineTo(M + W, y).lineWidth(0.75).strokeColor(INK).stroke().restore();
  y += 12;

  // The list is spaced to fill the page rather than run out two-thirds of the
  // way down. The rows still have a floor and a ceiling: below the floor the
  // description is dropped rather than the row, because a listed section with
  // no page number would be worse than a terse one, and above the ceiling the
  // rows stop being a list and start being a menu.
  const available = doc.page.height - M - 30 - y;
  const layers = [...new Set(listed.map((s) => s.layer))];
  const rowsH = available - layers.length * 20;
  const rowH = Math.max(15, Math.min(34, rowsH / Math.max(1, listed.length)));
  const showDescriptions = rowH >= 21;

  let lastLayer = null;
  for (const s of listed) {
    if (s.layer !== lastLayer) {
      if (lastLayer !== null) y += 7;
      lastLayer = s.layer;
      doc.font(TYPE.section.font).fontSize(7).fillColor(CLARET)
        .text(layerTitle(s.layer).toUpperCase(), M, y, { width: W, characterSpacing: 1.1, lineBreak: false });
      y += 13;
    }
    line(doc, s.title, M + 10, y, W * 0.5, { font: 'Helvetica-Bold', size: 10 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
      .text(String(pages.get(s.id)), M + W - 40, y, { width: 40, align: 'right', lineBreak: false });

    // One scope indicator, not every number the section could report.
    const scope = (s.scopeNotes ?? []).slice(0, 2).join(' · ');
    if (scope) {
      line(doc, scope, M + W * 0.54, y + 2, W * 0.46 - 46, { size: 7, color: MUTED, align: 'right' });
    }
    if (showDescriptions && s.description) {
      // Where the rows are generous enough, a description gets a second line
      // rather than being cut off mid-word. `height` with `ellipsis` is the
      // combination pdfkit actually honours.
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(s.description, M + 10, y + 12,
          { width: W * 0.86, height: rowH >= 30 ? 19 : 10, ellipsis: true });
    }
    y += rowH;
  }
}

function layerTitle(id) {
  return {
    interpretation: 'At a glance',
    'programme-evidence': 'The programme',
    'athlete-evidence': 'For this athlete',
    supporting: 'Supporting detail',
  }[id] ?? id;
}

// ---------------------------------------------------------------------------
// PAGE 2 — programme at a glance
// ---------------------------------------------------------------------------

/**
 * The glance pages open exactly as every other page does.
 *
 * They used to set their own title at 19pt and then advance the cursor by a
 * fixed 24 on top of the advance `doc.text` had already made, which is where
 * the forty-point hole between the title and its subtitle came from.
 */
function pageHeading(k, title, subtitle) {
  pageHead(k, { kicker: 'At a glance', title, question: subtitle, newPage: false });
}

function freshmanCard(doc, box, s) {
  const p = panel(doc, box, 'First-year opportunity');
  let y = p.y;
  const unresolved = s.classification === 'unclear' || s.classification === 'unavailable';
  chip(doc, p.x, y, CLASSIFICATION_LABEL[s.classification] ?? 'UNCLEAR', { muted: unresolved });
  y += 22;

  // The dominant metric is suppressed where the classification could not be
  // made: a "0 min" beside "UNCLEAR" reads as a measurement of nothing.
  if (unresolved || !s.primaryMetric) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(s.evidence?.sufficient === false
        ? 'Not enough on file to place this programme against the pool.'
        : 'No season on file carries enough recorded minutes to rank a first year.',
      p.x, y, { width: p.w });
    y += 30;
  } else {
    y = bigMetric(doc, p.x, y, nf(s.primaryMetric.value), {
      unit: 'min', caption: 'median minutes, best first-year of a season', width: p.w,
    });
    const poolMedian = s.pool?.rank1?.median ?? null;
    const max = Math.max(s.primaryMetric.value, s.pool?.rank1?.p75 ?? 0, 1);
    y = miniBar(doc, p.x, y, p.w, { value: s.primaryMetric.value, max, marker: poolMedian });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(poolMedian != null ? `line marks the pool median, ${nf(poolMedian)} min` : 'no pool comparison available',
        p.x, y, { width: p.w, lineBreak: false, ellipsis: true });
    y += 12;
  }

  y = factLine(doc, p.x, y, p.w, 'Seasons contributing', s.primaryMetric?.seasons ?? s.seasonsObserved ?? 0);
  if (s.seasonsWithAnImpactFreshman != null) {
    y = factLine(doc, p.x, y, p.w, 'Seasons with a starter-level first-year',
      `${s.seasonsWithAnImpactFreshman} of ${s.seasonsObserved}`);
  }

  // Shown only where reweighting actually moved the answer. A note saying the
  // two agree would be clutter; substituting one for the other would be a lie.
  if (s.weightingApplied && s.weightedAgrees === false && s.weightedLadderTop?.median != null) {
    y += 3;
    doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
      .text('WEIGHTED TOWARDS THE CURRENT COACH', p.x, y,
        { width: p.w, characterSpacing: TYPE.label.spacing, lineBreak: false });
    y += 9;
    line(doc, `${nf(s.weightedLadderTop.median)} min — both views are shown, neither replaces the other`,
      p.x, y, p.w, { size: 7, color: INK });
    y += 12;
  }

  const sample = [
    s.seasonsObserved ? plural(s.seasonsObserved, 'season') : null,
    s.measuredFreshmen ? `${plural(s.measuredFreshmen, 'measured first-year')}` : null,
  ].filter(Boolean).join(' · ');
  evidenceChip(doc, p.x, p.bottom - 20, s.evidence, sample, p.w);
}

function arrivalCard(doc, box, s) {
  const p = panel(doc, box, 'Experienced arrival reliance');
  let y = p.y;
  const unresolved = s.classification === 'unclear' || s.classification === 'unavailable';
  chip(doc, p.x, y, CLASSIFICATION_LABEL[s.classification] ?? 'UNCLEAR', { muted: unresolved });
  y += 22;

  if (!s.measurable) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('No season on file has the season before it on file, so an arrival cannot be told from a returning player.',
        p.x, y, { width: p.w });
    y += 34;
  } else if (s.primaryMetric == null) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('No position-season here carries enough recorded minutes to read the mix.', p.x, y, { width: p.w });
    y += 30;
  } else {
    y = bigMetric(doc, p.x, y, `${s.primaryMetric.value}`, {
      unit: '%', caption: 'to arrivals who were not first-years', width: p.w,
    });
    const pool = s.pool?.newcomer ?? null;
    const max = Math.max(s.primaryMetric.value, pool?.p75 ?? 0, 1) * 1.15;
    y = miniBar(doc, p.x, y, p.w, { value: s.primaryMetric.value, max, marker: pool?.median ?? null, color: GREEN });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(pool ? `line marks the typical programme, ${pool.median}%` : 'no pool comparison available',
        p.x, y, { width: p.w, lineBreak: false, ellipsis: true });
    y += 12;
  }

  y = factLine(doc, p.x, y, p.w, 'Experienced arrivals measured', s.arrivals);
  y = factLine(doc, p.x, y, p.w, 'Seasons an arrival was detectable', s.measurableSeasons.length);
  if (s.starters != null && s.arrivals) {
    y = factLine(doc, p.x, y, p.w, 'Played a starter’s season', `${s.starters} of ${s.arrivals}`);
  }

  const sample = [
    s.measurableSeasons.length ? `${plural(s.measurableSeasons.length, 'measurable season')}` : null,
    s.evidence?.sample?.observations ? plural(s.evidence.sample.observations, 'position-season') : null,
  ].filter(Boolean).join(' · ');
  evidenceChip(doc, p.x, p.bottom - 20, s.evidence, sample, p.w);
}

function replacementCard(doc, box, s) {
  const p = panel(doc, box, 'Replacement behaviour');
  let y = p.y;
  const route = s.dominantRoute ? ROUTE_LABEL[s.dominantRoute] : 'INSUFFICIENT HISTORY';
  chip(doc, p.x, y, route, { muted: !s.dominantRoute });
  y += 20;

  doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
    .text('Where a position’s minutes went the season after players left it.', p.x, y, { width: p.w });
  y += 20;

  y = miniStacked(doc, p.x, y, p.w, [
    { value: s.shares.returning, label: 'returning', color: PALE },
    { value: s.shares.freshman, label: 'first-years', color: NAVY },
    { value: s.shares.newcomer, label: 'experienced arrivals', color: GREEN },
  ], { unavailable: 'no position-seasons carry enough recorded minutes' });

  y += 4;
  y = factLine(doc, p.x, y, p.w, 'Position-seasons readable',
    `${s.observations} of ${s.totalObservations}`);
  if (s.poolMix) {
    y = factLine(doc, p.x, y, p.w, 'Comparable programmes',
      `${Math.round(s.poolMix.returning)} / ${Math.round(s.poolMix.freshman)} / ${Math.round(s.poolMix.newcomer)}`);
  }

  const sample = s.seasonsRepresented?.length
    ? `${plural(s.observations, 'position-season')} · ${plural(s.seasonsRepresented.length, 'transition')}` : null;
  evidenceChip(doc, p.x, p.bottom - 20, s.evidence, sample, p.w);
}

/**
 * Who the seasons behind this report belong to.
 *
 * The dead space in this card used to be the point: a chip, a name, four fact
 * lines and then a third of a card of nothing. The seasons and the coaches
 * were both already here as counts — drawn as a strip they answer the actual
 * question, which is whether the record on the other four cards is this
 * coach's record or somebody else's. It is the same data, not more of it.
 */
function tenureStrip(doc, x, y, w, s) {
  const seasons = (s.describesSeasons ?? []).map(Number).filter(Number.isFinite).sort();
  if (!seasons.length) return y;
  const first = seasons[0];
  const last = Math.max(seasons[seasons.length - 1], Number(s.knownThrough) || 0);
  const span = Math.max(1, last - first + 1);
  const cellW = w / span;
  const unknown = new Set((s.unknownSeasons ?? []).map(Number));
  const vacant = new Set((s.vacantSeasons ?? []).map(Number));
  const segments = s.segments ?? [];
  // Distinct coaches get distinct tones from the one palette. Nothing here is
  // better or worse than anything else, so the tones never form a scale.
  const tone = [NAVY, MID, PALE, GREEN];
  const indexOfCoach = new Map(segments.map((seg, i) => [seg.coach, i]));

  doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
    .text('WHOSE SEASONS THESE ARE', x, y, { width: w, characterSpacing: TYPE.label.spacing, lineBreak: false });
  y += 11;

  for (let i = 0; i < span; i += 1) {
    const year = first + i;
    const seg = segments.find((g) => Number(g.from) <= year && year <= Number(g.to));
    const cx = x + i * cellW;
    let fill = LINE;
    if (vacant.has(year)) fill = '#EDEFF3';
    else if (!unknown.has(year) && seg) fill = tone[(indexOfCoach.get(seg.coach) ?? 0) % tone.length];
    doc.save().rect(cx, y, Math.max(1, cellW - 2), 11).fill(fill).restore();
    doc.font('Helvetica').fontSize(6).fillColor(MUTED)
      .text(`’${String(year).slice(-2)}`, cx, y + 13, { width: Math.max(1, cellW - 2), align: 'center', lineBreak: false });
  }
  y += 24;

  const key = segments.map((seg, i) => `${seg.coach} ${seg.from}${seg.to === seg.from ? '' : `–${seg.to}`}`);
  if (unknown.size) key.push(`${unknown.size} unattributed`);
  if (vacant.size) key.push(`${vacant.size} vacant`);
  doc.font('Helvetica').fontSize(6.6).fillColor(MUTED)
    .text(key.join('  ·  '), x, y, { width: w });
  return doc.y + 4;
}

function coachCard(doc, box, s) {
  const p = panel(doc, box, 'Coach context');
  let y = p.y;
  const rel = s.evidenceRelevance ?? 'unknown';
  chip(doc, p.x, y, COACH_HEADLINE[rel] ?? 'COACHING RECORD INCOMPLETE', { muted: rel !== 'describes-current' });
  y += 21;

  // The name is what the card is about, so it is the card's big metric —
  // sized like the number on every other card rather than like a fact line.
  doc.font('Helvetica-Bold').fontSize(17).fillColor(INK)
    .text(fitText(doc, s.currentCoach ?? 'Not on file', p.w), p.x, y, { width: p.w, lineBreak: false });
  y += 21;
  line(doc, COACH_SUBLINE[rel] ?? '', p.x, y, p.w, { size: 7.8, color: MUTED });
  y += 14;

  y = factLine(doc, p.x, y, p.w, `Head coach, ${s.coachForRecruitSeason ? 'named for' : 'for'} entry`,
    s.coachForRecruitSeason ?? 'not on file');
  y = factLine(doc, p.x, y, p.w, 'Seasons analysed', s.seasonsAnalysed ?? 0);
  y += 8;

  y = tenureStrip(doc, p.x, y, p.w, s);

  // The verdict's own sentence, which classifyProgramme wrote and which is a
  // stable explanation rather than report prose.
  if (s.verdictNote && y < p.bottom - 12) {
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(s.verdictNote.replace(/^./, (ch) => ch.toUpperCase()), p.x, y + 2,
        { width: p.w, height: p.bottom - y - 4, ellipsis: true });
  }
}

/**
 * The fifth module is factual and carries no classification.
 *
 * Deliberately not "Squad Turnover — Unclear". The pool distribution behind a
 * turnover band is not defensible — the expiring share moves with how complete
 * a programme's projections are — so a badge that always reads unclear would
 * occupy the most valuable space on the page to say nothing.
 */
function squadOutlookCard(doc, box, s) {
  const p = panel(doc, box, 'Current squad outlook');
  const colW = (p.w - 24) / 3;
  let y = p.y;

  doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
    .text(`The ${s.season ?? ''} roster as it stands. These minutes belong to the players listed; `
      + 'nothing here says they become available to anyone.', p.x, y, { width: p.w });
  y += 20;

  const proj = s.projectedMinutes;
  // The earliest year that carries a real share of the squad's projected load,
  // not merely the earliest year with a non-zero number. One programme's next
  // year held 50 minutes of 4,894 — true, and a headline about nothing.
  const expiring = s.expiringByYear ?? [];
  const meaningful = expiring.find((yy) => yy.share != null && yy.share >= 0.1);
  const nextYear = meaningful ?? expiring.find((yy) => yy.minutes > 0) ?? null;

  // With no eligibility years at all there is no timeline to draw, so the card
  // is one statement across its full width and the coverage beneath it. The
  // three-column layout used to survive, and the refusal — sized for two
  // columns and drawn from column one — printed straight through the
  // "ELIGIBILITY ENDS" heading.
  if (!expiring.length) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
      .text(s.rostered
        ? `No eligibility end year is recorded for any of the ${s.rostered} players on this roster.`
        : 'No current roster is on file for this programme.', p.x, y, { width: p.w });
    y = doc.y + 6;
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
      .text(s.rostered
        ? 'So this report cannot say when the playing-time load on this squad reaches the end of '
          + 'its eligibility. That is a gap in what this programme publishes, not a squad whose '
          + 'eligibility never ends.'
        : 'The squad pages read only players on the roster now, and there are none on file.',
      p.x, y, { width: p.w });
    y = doc.y + 10;
    factLine(doc, p.x, y, colW, 'On the roster', s.rostered ?? 0);
    factLine(doc, p.x + colW + 12, y, colW, 'Projections held',
      proj?.projectable ? `${proj.playersWithProjection} of ${proj.projectable}` : '—');
    factLine(doc, p.x + (colW + 12) * 2, y, colW, 'Returning-squad minutes',
      proj?.total == null ? 'not readable' : nf(proj.total));
    return;
  }

  // Column one: the next year anything meaningful comes off the roster.
  if (nextYear) {
    bigMetric(doc, p.x, y, nf(nextYear.minutes), { unit: 'min' });
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
      .text(`currently attached to players whose eligibility ends after ${nextYear.year}`,
        p.x, y + 27, { width: colW });
  } else {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('No year on this roster carries projected minutes.', p.x, y, { width: colW });
  }

  // Column two: the expirations, year by year.
  let cy = y;
  const cx = p.x + colW + 12;
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED)
    .text('ELIGIBILITY ENDS', cx, cy, { width: colW, characterSpacing: 0.8, lineBreak: false });
  cy += 10;
  const years = (s.expiringByYear ?? []).slice(0, 5);
  if (!years.length) {
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED)
      .text('none recorded', cx, cy, { width: colW, lineBreak: false });
  }
  const maxY = Math.max(1, ...years.map((yy) => yy.minutes));
  for (const yy of years) {
    doc.font('Helvetica').fontSize(7).fillColor(INK)
      .text(String(yy.year), cx, cy, { width: 24, lineBreak: false });
    doc.save().rect(cx + 26, cy + 1.5, Math.max(1, (yy.minutes / maxY) * (colW - 74)), 6)
      .fill(yy.minutes ? NAVY : LINE).restore();
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
      .text(`${nf(yy.minutes)}`, cx + colW - 44, cy, { width: 44, align: 'right', lineBreak: false });
    cy += 11.5;
  }

  // Column three: how complete the picture is. Stated, never implied.
  let ry = y;
  const rx = p.x + (colW + 12) * 2;
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED)
    .text('COVERAGE', rx, ry, { width: colW, characterSpacing: 0.8, lineBreak: false });
  ry += 10;
  ry = factLine(doc, rx, ry, colW, 'On the roster', s.rostered ?? 0);
  ry = factLine(doc, rx, ry, colW, 'Projections held',
    proj?.projectable ? `${proj.playersWithProjection} of ${proj.projectable}` : '—');
  ry = factLine(doc, rx, ry, colW, 'Returning-squad minutes', proj?.total == null ? 'not readable' : nf(proj.total));
  if (proj?.firstYears) {
    doc.font('Helvetica').fontSize(6.6).fillColor(MUTED)
      .text(`${proj.firstYears} first-years carry no projection: minutes are carried forward from a prior season, `
        + 'so a true first-year cannot have one.', rx, ry + 2, { width: colW });
  }
}

/**
 * Reserve a row for cards and put the flow cursor back afterwards.
 *
 * Cards draw in absolute coordinates, but every `doc.text` inside one still
 * moves `doc.y`. Without restoring it the NEXT `slot()` starts from wherever
 * the last label happened to land rather than below the row — which is how the
 * squad-outlook card ended up drawn on top of the replacement-behaviour card.
 *
 * `charts` in philosophyPdf.js wraps every chart for exactly this reason; this
 * is the same contract, kept here so the cards cannot drift out of it.
 */
function cardRow(k, height, draw) {
  const box = k.slot(height);
  const after = k.doc.y;
  try {
    draw(box);
  } finally {
    k.doc.y = after;
  }
  return box;
}

export function programmeAtAGlance(k, model) {
  const { doc } = k;
  const s = model.summary.programme;
  pageHeading(k, 'Programme at a glance', 'How this programme has built and used its squad.');

  // Sized to fill the page rather than to fit the content: the five modules
  // are fixed, so the spare 250 points the page used to end with belong
  // inside the cards as room to breathe.
  cardRow(k, 230, (row) => {
    freshmanCard(doc, { ...row, w: HALF }, s.freshmanOpportunity);
    arrivalCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, s.experiencedArrivalReliance);
  });
  cardRow(k, 230, (row) => {
    replacementCard(doc, { ...row, w: HALF }, s.replacementBehaviour);
    coachCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, s.coachContext);
  });
  cardRow(k, 152, (row) => squadOutlookCard(doc, row, s.squadTurnover));
}

// ---------------------------------------------------------------------------
// PAGE 3 — the athlete's opportunity
// ---------------------------------------------------------------------------

function positionNowCard(doc, box, a) {
  const noun = positionPlural(a.position);
  const p = panel(doc, box, 'Your position now');
  let y = p.y;
  const players = a.currentPositionPlayers ?? [];

  if (!players.length) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('No current roster on file for this programme, so we cannot show who is already at your position.',
        p.x, y, { width: p.w });
    return;
  }

  const projected = players.filter((x) => x.projectedMinutes != null);
  const aboveStarter = projected.filter((x) => Number(x.projectedMinutes) >= STARTER_MINUTES).length;
  y = bigMetric(doc, p.x, y, players.length, { caption: `current ${noun} on the roster` });
  doc.font('Helvetica').fontSize(7.8).fillColor(INK)
    .text(projected.length
      ? `${aboveStarter} currently projected above ${STARTER_MINUTES} min (of ${projected.length} with a projection)`
      : 'none of them carries a projected-minutes figure',
    p.x, y, { width: p.w });
  y += 20;

  doc.save().moveTo(p.x, y).lineTo(p.x + p.w, y).lineWidth(0.5).strokeColor(LINE).stroke().restore();
  y += 4;
  y = playerHeader(doc, p.x, y, p.w);
  const room = Math.floor((p.bottom - y - 10) / 10.5);
  for (const player of players.slice(0, room)) y = playerLine(doc, p.x, y, p.w, player);
  if (players.length > room) {
    doc.font('Helvetica-Oblique').fontSize(6.8).fillColor(MUTED)
      .text(`and ${players.length - room} more — the full squad is listed later in this report`,
        p.x, y + 2, { width: p.w, lineBreak: false, ellipsis: true });
  }
}

/**
 * The most important card on the page, and the one most at risk of overclaiming.
 *
 * It leads with the players whose LAST eligible season is the entry season,
 * because under five-year eligibility "gone before you arrive" is a near-empty
 * group for a later entrant — for a 2027 entrant it is graduate students only.
 * Leading with that would tell most athletes nobody is leaving while a quarter
 * of the squad plays its final season beside them.
 */
function arrivalWindowCard(doc, box, a, model) {
  const p = panel(doc, box, 'Your arrival window');
  let y = p.y;
  const finalSeason = a.currentPlayersInFinalSeasonAtEntry ?? [];
  const endsBefore = a.currentPlayersEligibilityEndsBeforeEntry ?? [];
  const eligible = a.currentPlayersEligibleAtEntry ?? [];
  const unknown = a.currentPlayersEligibilityUnknown ?? [];
  const finalMinutes = a.currentProjectedMinutesOfPlayersInFinalSeasonAtEntry;

  if (!a.currentPositionPlayers?.length) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('No current roster on file, so we cannot say who is at this position when you arrive.',
        p.x, y, { width: p.w });
    return;
  }

  // Not one player at this position carries an eligibility year. Every one of
  // the three groups is then empty for a reason that has nothing to do with
  // the squad, and drawing "0 · 0 · 0" beside "in their final eligible season"
  // is the exact null-is-not-zero defect this report exists downstream of —
  // stated here in the largest type on the most important card of the page.
  const placeable = a.currentPositionPlayers.length - unknown.length;
  if (!placeable) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
      .text(`No eligibility year is recorded for any of the ${a.currentPositionPlayers.length} `
        + `${positionPlural(a.position)} on this roster.`, p.x, y, { width: p.w });
    y = doc.y + 8;
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
      .text('So we cannot say which of them are in a final season when you arrive, which have '
        + 'already finished, and which are eligible beyond it. That is a gap in what this '
        + 'programme publishes, not a squad with nobody in it.', p.x, y, { width: p.w });
    y = doc.y + 10;
    calloutPrimary(doc, p.x, y, p.w,
      'Future recruits, experienced arrivals, injuries and eligibility changes are not known either.');
    return;
  }

  y = bigMetric(doc, p.x, y, finalSeason.length, {
    caption: `in their final eligible season in ${a.entrySeason}`,
  });
  doc.font('Helvetica').fontSize(7.8).fillColor(INK)
    .text(finalMinutes?.currentProjectedMinutes == null
      ? 'None of them carries a projected-minutes figure.'
      : `${nf(finalMinutes.currentProjectedMinutes)} projected minutes are currently attached to those players.`,
    p.x, y, { width: p.w });
  // Advanced by what the sentence actually took, not by a guess. Once the
  // minutes reached four digits it wrapped to two lines and the note beneath
  // was drawn straight through the second one.
  y = doc.y + 4;
  const without = finalMinutes?.playersWithoutProjection ?? 0;
  if (without) {
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
      .text(`${without} of them ${without === 1 ? 'has' : 'have'} no projection on file.`,
        p.x, y, { width: p.w });
    y = doc.y + 4;
  }

  // The three groups, with the entry season the loudest of them.
  //
  // Loudest, not best: an athlete arriving the year a group of players plays
  // its last season is the fact this card exists to surface, and it was being
  // set at exactly the weight of the two groups either side of it. The
  // emphasis is scale and rule weight — no colour means good or bad here, and
  // the entry band is claret because claret marks the reader's own year
  // everywhere else in this report, not because more is better.
  doc.save().moveTo(p.x, y).lineTo(p.x + p.w, y).lineWidth(0.5).strokeColor(LINE).stroke().restore();
  y += 8;
  const bands = [
    { label: 'BEFORE ENTRY', n: endsBefore.length, note: `eligibility ends before ${a.entrySeason}`,
      color: MUTED, lead: false },
    { label: 'FINAL SEASON AT ENTRY', n: finalSeason.length,
      note: `their last eligible season is ${a.entrySeason}`,
      color: CLARET, lead: true },
    { label: 'BEYOND ENTRY', n: eligible.length - finalSeason.length,
      note: `eligible past ${a.entrySeason}`, color: NAVY, lead: false },
  ];
  for (const b of bands) {
    const h = b.lead ? 30 : 21;
    if (b.lead) {
      doc.save().rect(p.x, y - 2, p.w, h + 2).fillOpacity(0.05).fill(CLARET).restore();
    }
    doc.save().rect(p.x, y, b.lead ? 4 : 2.5, h - 4).fill(b.color).restore();
    doc.font('Helvetica-Bold').fontSize(b.lead ? 8 : 7).fillColor(INK)
      .text(b.label, p.x + 10, y, { width: p.w * 0.62, characterSpacing: 0.5, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(b.lead ? 15 : 10).fillColor(INK)
      .text(String(Math.max(0, b.n)), p.x + p.w - 36, y - (b.lead ? 4 : 1),
        { width: 32, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
      .text(b.note, p.x + 10, y + (b.lead ? 12 : 9), { width: p.w - 50, lineBreak: false, ellipsis: true });
    y += h + 3;
  }
  y += 4;

  // Two notes of different weight, so they read as different things: the
  // limitation the reader must not miss, then the coverage detail.
  y = calloutPrimary(doc, p.x, y, p.w,
    'Future recruits, experienced arrivals, injuries and eligibility changes are not known.');
  if (unknown.length) {
    y = calloutSecondary(doc, p.x, y, p.w,
      `${unknown.length} of the ${a.currentPositionPlayers.length} current `
      + `${positionPlural(a.position)} record no eligibility year, and are counted in none of the `
      + 'three groups above.');
  }
}

function positionOpensCard(doc, box, a) {
  const p = panel(doc, box, 'When this position opens');
  let y = p.y;
  const o = a.positionOpeningOutcomes;
  const v = a.positionVacancyHistory;

  if (!o || !v?.transitions) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('This position does not carry enough recorded minutes here to say how it behaves when a place comes free.',
        p.x, y, { width: p.w });
    return;
  }

  y = bigMetric(doc, p.x, y, `${v.openings}`, {
    caption: `time${v.openings === 1 ? '' : 's'} a starter left, in ${v.transitions} season transitions`,
  });

  if (v.openings > 0) {
    y = factLine(doc, p.x, y, p.w, 'A first-year then started', `${v.freshmanTookIt} of ${v.openings}`);
    y = factLine(doc, p.x, y, p.w, 'An experienced arrival then started', `${v.newcomerTookIt} of ${v.openings}`);
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
      .text('These two can describe the same season: one opening can be filled by more than one player.',
        p.x, y + 1, { width: p.w });
    y += 20;
  } else {
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
      .text('No starter left this position in the seasons on file — a complete answer to what happened, '
        + 'and no answer at all to what happens when one does.', p.x, y, { width: p.w });
    y += 26;
  }

  if (o.dials?.returning != null) {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED)
      .text('MINUTES AT THIS POSITION WENT TO', p.x, y, { width: p.w, characterSpacing: 0.8, lineBreak: false });
    y += 10;
    y = miniStacked(doc, p.x, y, p.w, [
      { value: o.dials.returning, label: 'returning', color: PALE },
      { value: o.dials.freshman, label: 'first-years', color: NAVY },
      { value: o.dials.newcomer, label: 'experienced arrivals', color: GREEN },
    ]);
  }

  evidenceChip(doc, p.x, p.bottom - 20, o.evidence,
    `${plural(v.transitions, 'transition')} · ${plural(v.openings, 'opening')}`, p.w);
}

function originCard(doc, box, a) {
  const p = panel(doc, box, 'First-years like you');
  let y = p.y;
  const fh = a.positionFreshmanHistory;
  const o = a.originContext;
  const noun = positionPlural(a.position);

  // Position history leads, and stays even where origin cannot be read.
  if (fh?.measured) {
    y = bigMetric(doc, p.x, y, `${fh.starters} of ${fh.measured}`, {
      caption: `first-year ${noun} played a starter’s season`,
    });
  } else {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`No first-year ${noun} here has minutes on file.`, p.x, y, { width: p.w });
    y += 26;
  }

  doc.save().moveTo(p.x, y).lineTo(p.x + p.w, y).lineWidth(0.5).strokeColor(LINE).stroke().restore();
  y += 6;

  const originWord = o?.requestedOrigin === 'international' ? 'International' : 'US-based';
  if (!o?.requestedOrigin) {
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
      .text('No origin is recorded for this athlete, so we cannot compare by background.', p.x, y, { width: p.w });
    return;
  }

  const same = o.programme.sameOrigin;
  if (!o.evidence?.sufficient || same.share == null) {
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
      .text('Not enough programme-specific history to compare by origin: '
        + `${same.players} ${originWord.toLowerCase()} first-year${same.players === 1 ? '' : 's'} on file here.`,
      p.x, y, { width: p.w });
    y += 26;
  } else {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED)
      .text('THIS PROGRAMME', p.x, y, { width: p.w, characterSpacing: 0.8, lineBreak: false });
    y += 10;
    y = factLine(doc, p.x, y, p.w, `${originWord} first-years starting`,
      `${pctOf(same.share)}  (${same.starters} of ${same.players})`);
    y += 4;
  }

  if (o.pool?.sameOrigin?.impactShare != null) {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED)
      .text(o.pool.scope === 'division' ? `${o.pool.division} BENCHMARK` : 'ALL-DIVISION BENCHMARK',
        p.x, y, { width: p.w, characterSpacing: 0.8, lineBreak: false });
    y += 10;
    y = factLine(doc, p.x, y, p.w, `${originWord} first-years starting`,
      `${pctOf(o.pool.sameOrigin.impactShare)}  (n=${nf(o.pool.sameOrigin.players)})`);
    if (o.pool.otherOrigin?.impactShare != null) {
      y = factLine(doc, p.x, y, p.w, 'The other group',
        `${pctOf(o.pool.otherOrigin.impactShare)}  (n=${nf(o.pool.otherOrigin.players)})`);
    }
    doc.font('Helvetica').fontSize(6.6).fillColor(MUTED)
      .text('A description of who has played, not of why. Where a player comes from is not the cause of the difference.',
        p.x, y + 2, { width: p.w });
  } else if (o.poolReason) {
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
      .text(`No benchmark comparison: ${o.poolReason}.`, p.x, y, { width: p.w });
  }
}

export function athleteAtAGlance(k, model) {
  const { doc } = k;
  const a = model.summary.athlete;
  const athlete = model.athlete;

  pageHead(k, {
    kicker: 'At a glance',
    title: `Your opportunity at ${model.college.name}`,
    question: [athlete.positionLabel, `entering ${model.entrySeason}`].filter(Boolean).join('  ·  '),
    newPage: false,
  });
  k.box('What the programme’s history and its currently known roster mean for someone entering at this '
    + 'position. This page does not say how many minutes you would play — that season has not been played, '
    + 'and who is on the squad by then is not knowable from this data.');

  cardRow(k, 280, (row) => {
    positionNowCard(doc, { ...row, w: HALF }, a);
    arrivalWindowCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, a, model);
  });
  cardRow(k, 228, (row) => {
    positionOpensCard(doc, { ...row, w: HALF }, a);
    originCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, a);
  });
}
