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
import {
  programmeHeadlines, athleteHeadlines, pathwayNarrative,
} from '../../shared/report/narrative.js';
import { actTitle } from '../../shared/report/sections.js';
import { coachContextFor, coachTimelineFor, PROMINENCE } from '../../shared/report/coachContext.js';

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
/**
 * The fallback chip and subline, for a card with no attribution to read.
 *
 * Both used to be the card's only source, and both said things the coach
 * record cannot support. "NEW COACH" asserts a recent appointment the
 * five-season window cannot see, and "stable across the seasons measured"
 * appeared over Mercyhurst men's, where one of four measured seasons was the
 * named coach's. `coachContextFor` supplies both now, counted from the
 * attribution; these remain for the case where it supplies nothing.
 */
export const COACH_HEADLINE = {
  'describes-current': 'CURRENT COACH HISTORY',
  'partly-describes-current': 'COACHING CHANGE IN WINDOW',
  'describes-previous': 'NO MEASURED SEASON',
  unknown: 'COACH RECORD UNRESOLVED',
};

export const COACH_SUBLINE = {
  'describes-current': 'the coach on file for 2026',
  'partly-describes-current': 'the measured seasons are not all this coach’s',
  'describes-previous': 'no measured season can be attributed to this coach',
  unknown: 'the measured seasons could not be attributed',
};

const EVIDENCE_LABEL = { strong: 'STRONG', moderate: 'MODERATE', limited: 'LIMITED' };

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

/**
 * The evidence strip's own space, reserved by the card that owns it.
 *
 * 17 is the strip's ink: a 6.5pt label, and a 6.5pt sample line nine points
 * under it. 6 is the white beneath that — less than the 14 the body sits on,
 * because a caption set that small does not need a body margin to read as
 * inside the border, and those eight points are what these cards had been
 * silently borrowing.
 */
const EVIDENCE_INK = 17;
const EVIDENCE_MARGIN = 6;

/**
 * A bordered panel with a small-caps title. Returns the inner content box.
 *
 * Drawn in absolute coordinates inside a box the caller reserved with
 * `k.slot()`, the same contract the charts keep — the flow cursor is never
 * consulted, so nothing here can auto-paginate out from under a half-drawn
 * card.
 *
 * `evidence: true` for a card that ends with an evidence strip. The strip is
 * part of the card, so the card reserves it: `evidenceY` is a fixed position
 * inside the box, and `bottom` — the floor for everything else — is that same
 * line. It used to be neither. The strip was placed at
 * `Math.max(y + 10, p.bottom - 20)`, which put it below the card whenever the
 * content ran long, and at 22 of 90 sampled reports it drew clean over the top
 * border of the panel beneath: at Akron women's the first-year card's
 * "EVIDENCE — MODERATE / 4 seasons · 30 measured first-years" sat inside the
 * REPLACEMENT BEHAVIOUR panel. The 14 points of bottom padding hid the same
 * overrun on the other two cards, which were over by up to 10.5.
 *
 * So the strip can no longer leave the card by construction, and the cards
 * that could overrun it now measure the room they have first.
 */
export function panel(doc, box, title, { evidence = false } = {}) {
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
  const evidenceY = evidence ? box.y + box.h - EVIDENCE_MARGIN - EVIDENCE_INK : null;
  return {
    x: box.x + pad,
    y,
    w: box.w - pad * 2,
    bottom: evidenceY ?? box.y + box.h - pad,
    evidenceY,
  };
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

  // ---- the cover ---------------------------------------------------------
  //
  // The name leads. This page used to open with PROGRAM INTELLIGENCE REPORT
  // set above a smaller name and then hand two-thirds of itself to a contents
  // list with descriptions and scope notes on every row, which is what made
  // the front of the document read as a directory rather than as a
  // deliverable. The contents is still here, and it is now a list.
  let y = M + 10;
  const hero = a ? `${a.name} × ${c.name}` : c.name;
  doc.font('Helvetica-Bold');
  const heroSize = fitHeadline(doc, hero, W, a ? 30 : 34, 16);
  // Below the floor it WRAPS rather than clipping. Everywhere else in the
  // report a title that will not fit is cut, because a title is a fixed slot
  // in a layout; here it is the name on the front of the document.
  doc.fontSize(heroSize).fillColor(INK).text(hero, M, y, { width: W });
  y = doc.y + 8;

  // The programme identity rule: short, under the name, and the only place a
  // college colour appears anywhere in the document.
  doc.save().rect(M, y, 54, 3).fill(identity.colour).restore();
  y += 14;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
    .text('PROGRAMME INTELLIGENCE', M, y, { width: W, characterSpacing: 1.8, lineBreak: false });
  y += 20;

  const seasons = model.describes ?? [];
  const window = seasons.length
    ? `${seasons.length} season${seasons.length === 1 ? '' : 's'} of roster behaviour, `
      + `${seasons.length === 1 ? seasons[0] : `${seasons[0]}–${seasons[seasons.length - 1]}`}`
    : 'the roster seasons on file';

  const facts = a
    ? [a.positionLabel, `entering ${model.entrySeason}`,
      [c.name, c.division].filter(Boolean).join(' · ')]
    // Division, conference, location — the three facts that place a programme.
    // The nickname led this line for a while and answered nothing a reader was
    // asking on the cover.
    : [c.division, c.conference, [c.city, c.state].filter(Boolean).join(', ')];
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(facts.filter(Boolean).join('  ·  '), M, y, { width: W, lineBreak: false, ellipsis: true });
  y += 15;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(`${window}  ·  prepared ${new Date().toISOString().slice(0, 10)}`, M, y,
      { width: W, lineBreak: false, ellipsis: true });
  y += 24;

  doc.font('Helvetica').fontSize(11.5).fillColor(INK)
    .text(a
      ? 'A historical view of how players enter, develop and move through this programme.'
      : 'How this programme recruits, develops, retains and replaces players.',
    M, y, { width: W * 0.86 });
  y = doc.y + 16;

  // The one claim the document has to make on page one, and it stays at full
  // reading size rather than becoming a footnote under a nicer cover.
  const caveat = `Nothing here is a forecast. Every figure describes a season that has been `
    + `played; the ${model.recruitSeason} season has not.`;
  const caveatH = doc.font('Helvetica').fontSize(9).heightOfString(caveat, { width: W - 26 }) + 18;
  doc.save().rect(M, y, 3, caveatH).fill(CLARET).restore();
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(caveat, M + 14, y + 9, { width: W - 26 });
  y += caveatH + 26;

  // ---- the contents, as a list -------------------------------------------
  doc.font(TYPE.label.font).fontSize(7).fillColor(MUTED)
    .text('CONTENTS', M, y, { width: W * 0.6, characterSpacing: 1, lineBreak: false });
  doc.font(TYPE.label.font).fontSize(7).fillColor(MUTED)
    .text('PAGE', M + W - 40, y, { width: 40, align: 'right', characterSpacing: 1, lineBreak: false });
  y += 10;
  doc.save().moveTo(M, y).lineTo(M + W, y).lineWidth(0.75).strokeColor(LINE).stroke().restore();
  y += 10;

  // One line per section. The scope note survives because it is the only thing
  // on the row that says how much is behind a section; the description does
  // not, because the section's own page opens with the same sentence.
  const available = doc.page.height - M - 26 - y;
  const acts = [...new Set(listed.map((s) => s.act))];
  const rowH = Math.max(13, Math.min(18,
    (available - acts.length * 17) / Math.max(1, listed.length)));

  let lastAct = null;
  for (const s of listed) {
    if (s.act !== lastAct) {
      if (lastAct !== null) y += 5;
      lastAct = s.act;
      doc.font(TYPE.section.font).fontSize(6.5).fillColor(CLARET)
        .text(actHeading(s.act, Boolean(a)).toUpperCase(), M, y,
          { width: W, characterSpacing: 1.1, lineBreak: false });
      y += 12;
    }
    line(doc, s.title, M + 10, y, W * 0.46, { font: 'Helvetica-Bold', size: 9.5 });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
      .text(String(pages.get(s.id)), M + W - 40, y, { width: 40, align: 'right', lineBreak: false });
    const scope = (s.scopeNotes ?? []).slice(0, 2).join(' · ');
    if (scope) {
      line(doc, scope, M + W * 0.5, y + 1, W * 0.5 - 46, { size: 7, color: MUTED, align: 'right' });
    }
    y += rowH;
  }
}

/**
 * The act headings the contents groups under.
 *
 * An athlete report and a programme report name their acts differently — one
 * opens with a pathway and the other with a summary — so this asks the acts
 * rather than mapping a fixed set of layer ids.
 */
function actHeading(id, hasAthlete) {
  return actTitle(id, { hasAthlete });
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
  const p = panel(doc, box, 'First-year opportunity', { evidence: true });
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
  //
  // IN THE FORM THE CARD HAS ROOM FOR, and measured rather than assumed. This
  // block is the only variable-height thing on the card, and it is what pushed
  // the evidence strip out of the box: 23 of 90 sampled reports draw it, and
  // all 23 overran. Where the full block does not fit it falls back to a fact
  // line, and where even that does not fit the card says nothing — the
  // evidence page carries the finding in full, with both figures, the verdict
  // note and the reason neither replaces the other.
  if (s.weightingApplied && s.weightedAgrees === false && s.weightedLadderTop?.median != null) {
    const room = p.bottom - y;
    if (room >= 24) {
      y += 3;
      doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
        .text('WEIGHTED TOWARDS THE CURRENT COACH', p.x, y,
          { width: p.w, characterSpacing: TYPE.label.spacing, lineBreak: false });
      y += 9;
      line(doc, `${nf(s.weightedLadderTop.median)} min — both views are shown, neither replaces the other`,
        p.x, y, p.w, { size: 7, color: INK });
      y += 12;
    } else if (room >= 11) {
      y = factLine(doc, p.x, y, p.w, 'Weighted towards the current coach',
        `${nf(s.weightedLadderTop.median)} min`);
    }
  }

  const sample = [
    s.seasonsObserved ? plural(s.seasonsObserved, 'season') : null,
    s.measuredFreshmen ? `${plural(s.measuredFreshmen, 'measured first-year')}` : null,
  ].filter(Boolean).join(' · ');
  evidenceChip(doc, p.x, p.evidenceY, s.evidence, sample, p.w);
}

function arrivalCard(doc, box, s) {
  const p = panel(doc, box, 'Experienced arrival reliance', { evidence: true });
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
  evidenceChip(doc, p.x, p.evidenceY, s.evidence, sample, p.w);
}

function replacementCard(doc, box, s) {
  const p = panel(doc, box, 'Replacement behaviour', { evidence: true });
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
  evidenceChip(doc, p.x, p.evidenceY, s.evidence, sample, p.w);
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
/**
 * Whose seasons these are, one cell per season.
 *
 * DRAWN FROM THE ATTRIBUTION where there is one. `tenureFor` does not read the
 * title column, so at Marist men's it reported one unbroken spell of "Aaron
 * Suma 2022-2026" — the strength coach — and this strip drew five solid cells
 * under a card that said the current coach could not be established. Same
 * table, two answers, on one card.
 *
 * `timeline` is null where the strip would add nothing: one name across every
 * season, or no name at all. In both cases the line above the strip says it
 * better than a row of identical cells can.
 */
function tenureStrip(doc, x, y, w, timeline) {
  if (!timeline?.cells?.length) return y;
  const cells = timeline.cells;
  const cellW = w / cells.length;
  // Distinct coaches get distinct tones from the one palette. Nothing here is
  // better or worse than anything else, so the tones never form a scale.
  const tone = [NAVY, MID, PALE, GREEN];

  doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
    .text('WHOSE SEASONS THESE ARE', x, y, { width: w, characterSpacing: TYPE.label.spacing, lineBreak: false });
  y += 11;

  cells.forEach((c, i) => {
    const cx = x + i * cellW;
    const fill = c.name ? tone[c.tone % tone.length] : (c.vacant ? '#EDEFF3' : LINE);
    doc.save().rect(cx, y, Math.max(1, cellW - 2), 11).fill(fill).restore();
    doc.font('Helvetica').fontSize(6).fillColor(MUTED)
      .text(`’${String(c.season).slice(-2)}`, cx, y + 13,
        { width: Math.max(1, cellW - 2), align: 'center', lineBreak: false });
  });
  y += 24;

  doc.font('Helvetica').fontSize(6.6).fillColor(MUTED).text(timeline.caption, x, y, { width: w });
  return doc.y + 4;
}

/**
 * The card the coach context lives on, upgraded rather than replaced.
 *
 * It already showed the name, a status chip and the season strip. What it
 * never showed was the COUNT, and the count is the whole finding: this card
 * read "CURRENT COACH HISTORY / stable across the seasons measured" at
 * Mercyhurst men's, one of whose four measured seasons was the named coach's,
 * while the strip immediately below it listed two other names. The chip and
 * the line under the name now come from the attribution, so the card and its
 * own chart cannot disagree.
 *
 * `ctx` is `coachContextFor(model.coachAttribution)`, or null on a model built
 * before attribution existed — in which case the card falls back to exactly
 * what it drew before.
 */
function coachCard(doc, box, s, ctx = null, timeline = null) {
  const p = panel(doc, box, 'Coach context');
  let y = p.y;
  const rel = s.evidenceRelevance ?? 'unknown';
  // `ctx.chip` is present for every case including ABSENT, which carries a
  // small unavailable state rather than a refusal. `attributed` is the subset
  // that has counts to show.
  const shown = ctx?.chip ? ctx : null;
  const attributed = ctx?.available ? ctx : null;
  // Muted where the record does not describe the coach a recruit would join:
  // the pill is quiet for a qualified answer and solid for a whole window.
  const solid = attributed
    ? attributed.prominence === PROMINENCE.QUIET && !attributed.interim
    : shown ? false : rel === 'describes-current';
  chip(doc, p.x, y, shown?.chip ?? COACH_HEADLINE[rel] ?? 'COACH RECORD UNRESOLVED',
    { muted: !solid, max: p.w });
  y += 21;

  // The name is what the card is about, so it is the card's big metric —
  // sized like the number on every other card rather than like a fact line.
  const name = shown?.headline ?? s.currentCoach ?? 'Not on file';
  doc.font('Helvetica-Bold').fontSize(17).fillColor(INK)
    .text(fitText(doc, name, p.w), p.x, y, { width: p.w, lineBreak: false });
  y += 21;
  line(doc, shown?.subline ?? COACH_SUBLINE[rel] ?? '', p.x, y, p.w, { size: 7.8, color: MUTED });
  y += 14;

  /**
   * The coach named for the entry season — from the attribution where there is
   * one, and never from the raw row.
   *
   * This line printed "Aaron Suma" at Marist men's, directly beneath a
   * headline reading "Could not establish": `coachForRecruitSeason` is the
   * 2026 coach_name with no title filtering, so it named the strength coach as
   * the head coach for entry. Where the attribution refused that row, this
   * line has nothing to show and says so.
   */
  const entryCoach = shown ? (shown.coach?.name ?? null) : (s.coachForRecruitSeason ?? null);
  y = factLine(doc, p.x, y, p.w, `Head coach, ${entryCoach ? 'named for' : 'for'} entry`,
    entryCoach ?? 'not on file');
  y = factLine(doc, p.x, y, p.w, 'Seasons analysed', s.seasonsAnalysed ?? 0);
  y += 8;

  y = tenureStrip(doc, p.x, y, p.w, timeline);

  /**
   * The bottom of the card, in priority order and only what fits.
   *
   * A co-head arrangement outranks the verdict note: a card showing one name
   * over two coaches is showing half the answer, and the reader needs to know
   * the record cannot hold the other half. The verdict note is
   * `classifyProgramme`'s own stable explanation and keeps the space
   * otherwise.
   */
  /**
   * The verdict note is shown as written, and in Phase 11D that stopped being
   * a risk.
   *
   * 11C withheld it on 8 cards, because `classifyProgramme` read the coach
   * table through `tenureFor`, which had no title column: at Marist men's it
   * produced "One coach throughout" — meaning the strength coach the
   * attribution had just refused — under a headline reading "Could not
   * establish". Hiding the sentence left the verdict itself wrong. 11D fixed
   * the input instead: `tenureFor` now reads rows through `readCoachRow`, and
   * a continuity claim needs a usable head-coach observation for every season
   * it describes. Marist's verdict is `coach-unknown`, and its note now agrees
   * with the card.
   *
   * One card still shows a refusal beside a continuity note, and it is not a
   * contradiction: Ursuline women's ran four measured seasons under Jason
   * Kubbins and has nobody on file for the season a recruit would join. Both
   * sentences are true, and the note says which seasons it means.
   */
  const note = attributed?.coHeadNote
    ?? (s.verdictNote ? s.verdictNote.replace(/^./, (ch) => ch.toUpperCase()) : null);
  if (note && y < p.bottom - 12) {
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(note, p.x, y + 2, { width: p.w, height: p.bottom - y - 4, ellipsis: true });
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
      // The why lives in the methodology and on the squad-outlook page, both
      // of which say it in full. Three lines of it here pushed the card's own
      // border and repeated a sentence the reader meets twice more.
      .text(`${proj.firstYears} of them are first-years, who cannot carry one.`,
        rx, ry + 2, { width: colW });
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

/**
 * The findings, in sentences, above the cards that evidence them.
 *
 * The reason this exists: a reader who stopped after page two used to have two
 * of the six questions answered — first-years and experienced arrivals — while
 * development, roster stability and traceable movement waited on pages five,
 * twelve and thirteen. Every line here restates a figure printed later and
 * carries the page it is printed on, so the band is a way in rather than a
 * summary that stands alone.
 *
 * The page numbers are drawn last: page two cannot know what page twelve is.
 */
export function headlineBand(k, lines, { title = 'What Thriv3 sees' } = {}) {
  const { doc } = k;
  if (!lines.length) return;
  const LABEL_W = 96;
  const PAGE_W = 34;
  const textW = W - LABEL_W - PAGE_W - 18;

  doc.font(TYPE.section.font).fontSize(TYPE.section.size).fillColor(CLARET)
    .text(title.toUpperCase(), M, doc.y, { width: W, characterSpacing: TYPE.section.spacing });
  doc.y += 4;
  doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(0.75).strokeColor(INK).stroke();
  doc.y += 9;

  for (const item of lines) {
    const top = doc.y;
    const h = doc.font('Helvetica').fontSize(9).heightOfString(item.text, { width: textW });
    doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(MUTED)
      .text(String(item.label).toUpperCase(), M, top + 1.5,
        { width: LABEL_W - 10, characterSpacing: TYPE.label.spacing });
    doc.font('Helvetica').fontSize(9).fillColor(INK)
      .text(item.text, M + LABEL_W, top, { width: textW });
    if (item.section) {
      // Filled in once the document is complete. Recorded, not guessed.
      const y = top;
      const id = item.section;
      k.defer(({ pageOf, doc: d }) => {
        const n = id ? pageOf(id) : null;
        if (n == null) return;
        d.font('Helvetica-Bold').fontSize(8.5).fillColor(MID)
          .text(`p.${n}`, M + W - PAGE_W, y + 1, { width: PAGE_W, align: 'right', lineBreak: false });
      });
    }
    doc.y = top + Math.max(h, 12) + 5;
  }
  doc.y += 4;
}

export function programmeAtAGlance(k, model) {
  const { doc } = k;
  const s = model.summary.programme;
  const coach = coachContextFor(model.coachAttribution, { division: model.college?.division });
  const coachTimeline = coachTimelineFor(coach, { recruitSeason: model.recruitSeason });
  /**
   * The subtitle carries the coach context where it is prominent.
   *
   * NOT A BAND ROW, and the reason is measured. This page is tight by design —
   * five cards sized out of whatever the band above them leaves, with floors
   * below which a card is squashed rather than short — and a sixth band row
   * fits at only 231 of the 357 programmes whose coach context is prominent.
   * At the other 126 it pushed the squad-outlook card onto a page of its own.
   *
   * The subtitle costs nothing, is the first line under the page title, and is
   * always there. What it replaces is a description of the page; on a report
   * whose history is largely somebody else's, that fact is the better subtitle.
   * The coach card two thirds down the page carries the same count either way.
   */
  const subtitle = coach.prominence === PROMINENCE.PROMINENT && coach.banner
    ? coach.banner
    : 'What this programme’s record shows, and where the evidence for it sits.';
  pageHeading(k, 'Programme at a glance', subtitle);

  headlineBand(k, programmeHeadlines(model));

  // The cards take the room the band leaves, rather than a height chosen once
  // and hoped for. The band is as long as the findings are — five lines for a
  // Division I programme, two for one whose minutes cannot be read — and a
  // fixed 230 under a variable band is how this page grew a second page twice
  // while it was being written.
  //
  // Floors, because a squashed card is worse than a slightly full page: the
  // evidence strip is no longer pinned to the card's floor, so a card that
  // runs past its box pushes the strip out of it rather than over its own
  // last fact, and the layout guard sees that.
  const room = doc.page.height - M - 26 - doc.y - 3 * 8;
  const third = Math.max(112, Math.min(136, room * 0.22));
  const pair = Math.max(176, (room - third) / 2);

  cardRow(k, pair, (row) => {
    freshmanCard(doc, { ...row, w: HALF }, s.freshmanOpportunity);
    arrivalCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, s.experiencedArrivalReliance);
  });
  cardRow(k, pair, (row) => {
    replacementCard(doc, { ...row, w: HALF }, s.replacementBehaviour);
    coachCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, s.coachContext, coach, coachTimeline);
  });
  cardRow(k, third, (row) => squadOutlookCard(doc, row, s.squadTurnover));
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
  // "None of them carries a projection" describes an empty set when the group
  // itself is empty, which reads as a data gap rather than as the finding.
  doc.font('Helvetica').fontSize(7.8).fillColor(INK)
    .text(finalSeason.length === 0
      ? `No current ${positionPlural(a.position).replace(/s$/, '')} is in a final eligible season `
        + `in ${a.entrySeason}.`
      : finalMinutes?.currentProjectedMinutes == null
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

  evidenceChip(doc, p.x, p.evidenceY, o.evidence,
    `${plural(v.transitions, 'transition')} · ${plural(v.openings, 'opening')}`, p.w);
}

function originCard(doc, box, a) {
  const p = panel(doc, box, 'First-years like you', { evidence: true });
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
        + `${same.players} ${originWord.toLowerCase()} first-year${same.players === 1 ? '' : 's'} `
        + 'on file here, across every position.',
      p.x, y, { width: p.w });
    y += 26;
  } else {
    // Across every position, unlike the count above it. The card opens with
    // "0 of 9 first-year goalkeepers" and then reports a figure built from all
    // 77 of the programme's first-years; without the scope on the label those
    // read as the same population.
    doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
      .text('THIS PROGRAMME · ALL POSITIONS', p.x, y,
        { width: p.w, characterSpacing: TYPE.label.spacing, lineBreak: false });
    y += 10;
    y = factLine(doc, p.x, y, p.w, `${originWord} first-years starting`,
      `${pctOf(same.share)}  (${same.starters} of ${same.players})`);
    y += 4;
  }

  if (o.pool?.sameOrigin?.impactShare != null) {
    doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
      .text(o.pool.scope === 'division'
        ? `${o.pool.division} BENCHMARK · ALL POSITIONS` : 'ALL DIVISIONS · ALL POSITIONS',
      p.x, y, { width: p.w, characterSpacing: TYPE.label.spacing, lineBreak: false });
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

/**
 * THE PATHWAY THRIV3 SEES — the synthesis, set apart from every page-level one.
 *
 * Deliberately a different object from `headlineBand` and from `k.reading`,
 * because it makes a different kind of claim and the difference has to be
 * visible. A page-level reading restates the page it sits on. This one reads
 * the first-year record at a position, the programme's multi-year development,
 * what happened when the position last opened and who is on the roster now,
 * and says what those four say together.
 *
 * It is the only block in this report that crosses analyses, so it is the only
 * one on a tinted ground with a rule down its full height.
 */
function pathwayBlock(k, sentences) {
  const { doc } = k;
  const list = (sentences ?? []).filter(Boolean);
  if (!list.length) return;
  const inner = W - 36;
  const h = list.reduce((sum, t) => sum + doc.font('Helvetica').fontSize(10)
    .heightOfString(t, { width: inner }) + 7, 0) + 24;
  k.room(h + 10);
  const top = doc.y;
  doc.save().rect(M, top, W, h).fillOpacity(0.05).fill(CLARET).restore();
  doc.save().rect(M, top, 3.5, h).fill(CLARET).restore();
  doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(CLARET)
    .text('THE PATHWAY THRIV3 SEES', M + 18, top + 12,
      { width: inner, characterSpacing: TYPE.label.spacing, lineBreak: false });
  let y = top + 27;
  for (const t of list) {
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(t, M + 18, y, { width: inner });
    y = doc.y + 7;
  }
  doc.y = top + h;
  k.gap(12);
}

/**
 * The hinge of an athlete report: four analyses read together, and nothing else.
 *
 * This page carried four cards — who is at the position now, the arrival
 * window, when the position opens, first-years like you. Every one of them is
 * now a page of its own immediately after this, so the cards were the same
 * evidence twice. A synthesis that reprints its own evidence is not a
 * synthesis; the band says where each part of it is set out, and stops.
 */
export function athletePathwayPage(k, model) {
  const a = model.summary.athlete;
  const athlete = model.athlete;

  pageHead(k, {
    kicker: 'Understanding your pathway',
    title: `Your pathway at ${model.college.name}`,
    question: 'How this programme’s history, this position, the entry year and the current roster '
      + 'intersect.',
    newPage: false,
  });
  k.scope([athlete.positionLabel, `entering ${model.entrySeason}`,
    `${(a.currentPositionPlayers ?? []).length} at this position on the current roster`]);

  const sentences = pathwayNarrative(model);
  pathwayBlock(k, sentences);

  k.aside('Nothing on this page says how many minutes an arriving player would get. That season '
    + 'has not been played, who is on the squad by then is not knowable from this data, and no '
    + 'figure here is a forecast.', { title: 'What this page is not' });

  headlineBand(k, athleteHeadlines(model), { title: 'Where the evidence for this sits' });

  /**
   * Only on a page whose synthesis is thin, and only where there is room.
   *
   * Both conditions, because either alone gets it wrong. Room alone drew it on
   * Akron's women's report, where it was six page titles and their numbers
   * under a band that already carries page pointers — the contents page for a
   * second time. A thin synthesis alone would draw it on a page that has no
   * space for it.
   *
   * A one-sentence pathway page is the case this exists for: three-quarters
   * empty under a single finding, which reads as a report that gave up rather
   * than one whose subject published less.
   */
  if (sentences.length <= 2 && k.remaining() >= 250) evidenceStatus(k, model);
}

/**
 * What this programme's record can be read for, and what it cannot — titles.
 *
 * NOT a second Evidence Runs Out page. That page states, for each refusal,
 * what was attempted, the threshold it missed, why, and what the absence does
 * not mean; it is four paragraphs per item and it stays exactly as it is. This
 * is the two lists, one line each, so a family reading the front of a sparse
 * report can see the shape of what follows instead of a blank half-page — and
 * it says where the long version is.
 *
 * It fabricates nothing. Every line on the left is a page that exists in this
 * document; every line on the right is a refusal the model already made.
 */
function evidenceStatus(k, model) {
  const { doc } = k;
  const plan = (model.sections ?? []).filter((x) => x.act === 'pathway'
    || x.act === 'programme-evidence');
  // Refused by id rather than by the registry's `unavailableWhenEmpty` flag.
  // That flag marks a section whose absence is worth stating, which is not the
  // same question: this programme's development page carries real cohort
  // counts and only its percentages were withheld, so it belongs on the left
  // and the withheld shares belong on the right.
  const refused = new Set((model.evidenceLimits ?? []).map((x) => x.id));
  const can = plan
    .filter((x) => x.id !== 'athlete-at-a-glance' && x.id !== 'programme-at-a-glance'
      && x.id !== 'evidence-limits' && !refused.has(x.id))
    .slice(0, 6);
  const cannot = (model.evidenceLimits ?? []).slice(0, 6);
  if (!can.length && !cannot.length) return;

  const colW = (W - 24) / 2;
  const top = doc.y;
  const heads = [['What this record can be read for', can.map((x) => ({ text: x.title, id: x.id }))],
    ['What it cannot yet be read for', cannot.map((x) => ({ text: x.title, id: null }))]];
  let deepest = top;
  heads.forEach(([title, items], col) => {
    const x = M + col * (colW + 24);
    let y = top;
    doc.font(TYPE.section.font).fontSize(TYPE.section.size).fillColor(col ? MUTED : CLARET)
      .text(title.toUpperCase(), x, y, { width: colW, characterSpacing: TYPE.section.spacing });
    y = doc.y + 3;
    doc.moveTo(x, y).lineTo(x + colW, y).lineWidth(0.75)
      .strokeColor(col ? LINE : INK).stroke();
    y += 8;
    if (!items.length) {
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
        .text(col ? 'Nothing was refused for this programme.' : 'No page of this report could be built.',
          x, y, { width: colW });
      y = doc.y + 4;
    }
    for (const item of items) {
      doc.save().circle(x + 2.5, y + 4.5, 1.6).fill(col ? MUTED : CLARET).restore();
      const h = doc.font('Helvetica').fontSize(9).fillColor(col ? MUTED : INK)
        .heightOfString(item.text, { width: colW - 34 });
      doc.text(item.text, x + 10, y, { width: colW - 34 });
      if (item.id) {
        const at = y;
        const id = item.id;
        k.defer(({ pageOf, doc: d }) => {
          const n = pageOf(id);
          if (n == null) return;
          d.font('Helvetica-Bold').fontSize(8).fillColor(MID)
            .text(`p.${n}`, x + colW - 22, at + 0.5, { width: 22, align: 'right', lineBreak: false });
        });
      }
      y = at2(y, h);
      deepest = Math.max(deepest, y);
    }
    deepest = Math.max(deepest, y);
  });
  doc.y = deepest + 4;
  if (cannot.length) {
    k.note('Each of those is set out in full — what was attempted, the threshold it missed, and '
      + 'what its absence does not mean — on the page titled “Where the evidence runs out”.');
  }
}

/** Advance past a list row: the text height, with a floor for the bullet. */
const at2 = (y, h) => y + Math.max(h, 11) + 5;
