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
import { athleteHeadlines, pathwayNarrative } from '../../shared/report/narrative.js';
import { decisionFindings, programmeSnapshot } from '../../shared/report/decisionLayer.js';
import {
  athleteDecisionFindings, athleteInputStrip, SCOPE_STATEMENT,
} from '../../shared/report/athleteDecisionLayer.js';
import { actTitle, groupTitle } from '../../shared/report/sections.js';
import { coachContextFor, coachTimelineFor } from '../../shared/report/coachContext.js';

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
 * THE CLASSIFICATION AND COACH CHIP VOCABULARIES WENT WITH THE CARDS.
 *
 * `CLASSIFICATION_LABEL`, `ROUTE_LABEL`, `COACH_HEADLINE` and `COACH_SUBLINE`
 * existed so five module cards could say ABOVE PROGRAMME BENCHMARK rather than
 * HIGH. Phase 13C replaced those cards with ranked sentences, and the same
 * refusal now lives in `againstPool` — "above the comparable pool", with its
 * own test — so keeping four unread maps here would leave two vocabularies for
 * one rule and no way to tell which one a reader had seen.
 */
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
  // The group headings take ten points each and there is one per group that has
  // a section in it, so they are reserved here rather than discovered when the
  // last row of the contents lands under the footer.
  const groups = [...new Set(listed.map((s) => s.group).filter(Boolean))];
  const rowH = Math.max(12, Math.min(18,
    (available - acts.length * 17 - groups.length * 10) / Math.max(1, listed.length)));

  /**
   * Acts, and inside the programme act the narrative groups.
   *
   * 13A: the contents listed sixteen modules at equal weight, so a parent could
   * not see the journey — nine of the titles were reader questions and seven
   * were analytical names, all in one flat run. The act headings are unchanged;
   * the group headings are what turn the middle act into five questions.
   *
   * A group heading is drawn only where the group has a section in it, so a
   * sparse programme never shows a heading over nothing.
   */
  let lastAct = null;
  let lastGroup = null;
  for (const s of listed) {
    if (s.act !== lastAct) {
      if (lastAct !== null) y += 5;
      lastAct = s.act;
      lastGroup = null;
      doc.font(TYPE.section.font).fontSize(6.5).fillColor(CLARET)
        .text(actHeading(s.act, Boolean(a)).toUpperCase(), M, y,
          { width: W, characterSpacing: 1.1, lineBreak: false });
      y += 12;
    }
    if (s.group && s.group !== lastGroup) {
      lastGroup = s.group;
      const heading = groupTitle(s.group);
      if (heading) {
        doc.font('Helvetica').fontSize(7.2).fillColor(MUTED)
          .text(heading, M + 10, y, { width: W * 0.6, lineBreak: false, ellipsis: true });
        y += 10;
      }
    }
    /**
     * THE EVIDENCE ROWS ARE QUIETER — 13D / §Q.
     *
     * Every row was bold ink at one size, and the supporting rows were the ones
     * with no group heading above them and therefore the least indented — so
     * the appendix read as the most prominent run on the contents page while
     * the intelligence it supports read as sub-items. Same size, regular
     * weight, one step greyer: the map now shows the hierarchy the document
     * has. Grey rather than the metric gutter's blue — a colour doing two jobs
     * makes a quieter row read as a different kind of row.
     */
    const quiet = s.act === 'supporting';
    line(doc, s.title, M + (s.group ? 20 : 10), y, W * 0.46 - (s.group ? 10 : 0),
      { font: quiet ? 'Helvetica' : 'Helvetica-Bold', size: 9.5, color: quiet ? MUTED : INK });
    doc.font(quiet ? 'Helvetica' : 'Helvetica-Bold').fontSize(9.5).fillColor(quiet ? MUTED : INK)
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


// ---------------------------------------------------------------------------
// PAGE 2 — the decision layer
// ---------------------------------------------------------------------------

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



// ---------------------------------------------------------------------------
// The decision layer: the findings, then the context they sit in
// ---------------------------------------------------------------------------

/**
 * ONE SIZE FOR EVERY METRIC ON A PAGE.
 *
 * Sized per metric, the gutter stepped between 12.5 and 8.5 point within one
 * page — "14%" large, "1 of 4 seasons" small — and a column of numbers set at
 * three sizes reads as three kinds of number. So the page picks the largest of
 * the three steps that fits ALL of its metrics, and the gutter becomes a
 * column. Null where even the smallest step does not fit, in which case the
 * metric is dropped: the sentence beside it already carries the figure, and a
 * truncated number is worse than no number.
 */
function metricSizeFor(doc, findings) {
  const metrics = findings.map((f) => f.metric).filter(Boolean).map(String);
  if (!metrics.length) return null;
  for (const size of [12.5, 10.5, 8.5]) {
    doc.font('Helvetica-Bold').fontSize(size);
    if (metrics.every((m) => doc.widthOfString(m) <= METRIC_W)) return size;
  }
  return null;
}

/**
 * The gutter the headline metric occupies, and the column the page reference
 * sits in. Measured rather than chosen: the widest metric the ten categories
 * produce is a four-season aggregate record ("41-25-9", 46pt at 13pt bold) and
 * a two-season structural move ("2023–2024", 66pt), so the gutter is sized for
 * the second and the type steps down where a metric still will not fit.
 *
 * THE METRICS ARE RIGHT-ALIGNED IN IT — 13D / §D. Left-aligned, six metrics of
 * six different widths ("14%", "1 of 4 seasons", "2023–2024", "30.9%") made a
 * ragged column against the one clean vertical the page has, and the ragged
 * edge was the first thing the eye found. Flush right, the gutter is a seam:
 * the numbers hang off the sentences they belong to instead of competing with
 * the label above them.
 */
const FINDING_GUTTER = 84;
const METRIC_W = FINDING_GUTTER - 14;
const PAGE_COL = 30;

/**
 * ONE FINDING, in three tiers, and the tiers are the whole point.
 *
 * The page this replaced was five equal cards and five one-line bullets: every
 * module was the same size, so nothing was more important than anything else
 * and a reader had to do the ranking themselves. Here the FINDING is the
 * largest thing on the row, the metric anchors it in the gutter, and the
 * sample it rests on is a grey line underneath. Nothing is coloured, nothing
 * is scored, and the priority class that decided the order is never printed —
 * it is an ordering over findings, not a rating of a programme.
 */
function findingRow(k, f, { last = false, metricSize = 12.5, quiet = false } = {}) {
  const { doc } = k;
  const textX = M + FINDING_GUTTER;
  const textW = W - FINDING_GUTTER - PAGE_COL - 10;

  // One tier quieter where a programme's findings sit behind an athlete's.
  const bodySize = quiet ? 9.5 : 10.5;
  const sentH = doc.font('Helvetica').fontSize(bodySize).heightOfString(f.text, { width: textW });
  const noteH = f.evidenceNote
    ? doc.font('Helvetica').fontSize(7).heightOfString(f.evidenceNote, { width: textW }) + 3 : 0;
  k.room(11 + sentH + noteH + 18);
  const top = doc.y;

  doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(CLARET)
    .text(String(f.label).toUpperCase(), textX, top,
      { width: textW, characterSpacing: TYPE.label.spacing, lineBreak: false });

  // Grey rather than the metric gutter's blue: one colour, one job — a
  // quieter row must not read as a different kind of row.
  doc.font('Helvetica').fontSize(bodySize).fillColor(quiet ? MUTED : INK)
    .text(f.text, textX, top + 11, { width: textW });
  let y = doc.y;
  if (f.evidenceNote) {
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(f.evidenceNote, textX, y + 3, { width: textW });
    y = doc.y;
  }

  // The metric, in the gutter, stepped down rather than clipped. A metric that
  // does not fit at all is dropped: the sentence beside it already carries the
  // figure, and a truncated number is worse than no number.
  /**
   * The metric, flush right in the gutter and a step quieter than the finding.
   *
   * It was 13pt bold ink beside a 10.5pt sentence, which made it the loudest
   * thing on its row — a second headline for a finding that already had one.
   * Same size band, MID rather than INK: present enough to anchor the row,
   * quiet enough that the sentence is what gets read first.
   */
  if (f.metric && metricSize) {
    doc.font('Helvetica-Bold').fontSize(metricSize).fillColor(MID)
      .text(String(f.metric), M, top + 11 + (12.5 - metricSize) * 0.6,
        { width: METRIC_W, align: 'right', lineBreak: false });
  }

  /**
   * Where to go for the evidence. Deferred, because page two cannot know what
   * page twelve is — the renderer records where each section started and fills
   * these in once the document is complete.
   */
  if (f.section) {
    const id = f.section;
    const at = top;
    k.defer(({ pageOf, doc: d }) => {
      const n = pageOf(id);
      if (n == null) return;
      // Navigation, not content: set at label size in the label's own grey so
      // it sits on the same tier as the finding's name rather than competing
      // with the sentence beneath it.
      d.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED)
        .text(`p.${n}`, M + W - PAGE_COL, at + 1, { width: PAGE_COL, align: 'right', lineBreak: false });
    });
  }

  doc.y = y;
  if (!last) {
    /**
     * A separator, not a table rule. It starts at the text column rather than
     * at the margin, so the metric gutter reads as a column of numbers hanging
     * beside a list and the page has one continuous left edge instead of six
     * horizontal rules crossing it.
     */
    doc.y += 10;
    doc.save().moveTo(textX, doc.y).lineTo(M + W, doc.y).lineWidth(0.4).strokeColor(LINE).stroke()
      .restore();
    doc.y += 11;
  }
}

/**
 * PAGE 2 — the findings, ranked.
 *
 * The order is `decisionFindings`', which is deterministic and explained in
 * docs/decision-layer.md. Nothing on this page decides anything: it draws what
 * the ranking selected, in the order the ranking selected it.
 */
/**
 * THE PROGRAMME DECISION LAYER, unchanged analytically — 13F / §21.
 *
 * On a programme report this is page two and the report's own voice. On an
 * athlete report it is page three, retitled, and set one tier quieter: the
 * ranking, the sentences and the metrics are `decisionFindings`' own, called
 * exactly as they were and drawn by the same row. Only the title, the subtitle
 * and the size of the metric column change, and only where an athlete is
 * reading it — because a document named after somebody should not open with six
 * findings about somebody else.
 */
export function programmeAtAGlance(k, model) {
  const { doc } = k;
  const forAthlete = Boolean(model.athlete);
  const coach = coachContextFor(model.coachAttribution, { division: model.college?.division });
  const { findings } = decisionFindings({ ...model, coachContext: coach });

  pageHeading(k, forAthlete ? 'What Thriv3 sees about the programme' : 'What Thriv3 sees',
    forAthlete
      ? 'The programme’s own record, ranked the same way, behind the findings for this athlete.'
      : 'The findings this report rests on, most consequential first, each with the page that '
        + 'carries its evidence.');

  if (!findings.length) {
    // Never a blank page and never a padded one. A programme with nothing
    // eligible has that stated, and the pages behind it still render.
    k.note('No finding on this programme clears the evidence needed to lead a report. The pages '
      + 'that follow show what could be measured and what could not, season by season.');
    return;
  }

  // One step down where an athlete's own findings are the page before this.
  const metricSize = forAthlete
    ? Math.min(10.5, metricSizeFor(doc, findings) ?? 10.5) : metricSizeFor(doc, findings);
  findings.forEach((f, i) => findingRow(k, f,
    { last: i === findings.length - 1, metricSize, quiet: forAthlete }));
}

// ---------------------------------------------------------------------------
// PAGE 2 of an athlete report — the athlete decision layer
// ---------------------------------------------------------------------------

/**
 * What Thriv3 sees FOR YOU.
 *
 * The same grammar as the programme layer and the same `findingRow`, because a
 * reader who has learned to read one has learned to read the other. What
 * differs is the subject and the order: these findings are about one position,
 * one entry year and one origin group, and they come first.
 *
 * Three things sit under them and nowhere else in the report: the inputs that
 * actually shaped it, what the report measures, and what it does not. The last
 * is there because a document titled "Rhys Davies × Mercyhurst" reads like a
 * verdict on a university, and this one only ever measured a football
 * environment.
 */
export function athleteAtAGlance(k, model) {
  const { doc } = k;
  const a = model.summary?.athlete;
  const { findings } = athleteDecisionFindings(model);

  pageHeading(k, 'What Thriv3 sees for you',
    `What this programme’s record shows for a ${String(a?.positionLabel ?? 'player').toLowerCase()} `
    + `arriving in ${a?.entrySeason}, most consequential first.`);

  if (!findings.length) {
    k.note('No finding at this position clears the evidence needed to lead a report. The pages '
      + 'that follow show what could be measured at it and what could not.');
  } else {
    const metricSize = metricSizeFor(doc, findings);
    findings.forEach((f, i) => findingRow(k, f,
      { last: i === findings.length - 1, metricSize }));
  }

  /**
   * The inputs that shaped this, and only those.
   *
   * `nationality` is on the model and used nowhere — the analysis groups origin
   * only as within or outside the United States, and says so on the page it
   * belongs to — and `level` is on the model and used nowhere at all. Showing
   * either would tell a reader that a figure was shaped by something that never
   * touched it.
   */
  k.heading('What this report was prepared from');
  const strip = athleteInputStrip(model);
  if (strip.length) {
    const rows = Math.ceil(strip.length / 2);
    absolute(k, rows * 13 + 4, (box) => {
      strip.forEach(([label, value], i) => {
        snapshotLine(k.doc, box.x + (i % 2) * (HALF + GAP), box.y + Math.floor(i / 2) * 13, HALF,
          label, value ?? '—');
      });
    });
  }
  k.note(SCOPE_STATEMENT);

  /**
   * What this programme's record can and cannot be read for — 13F / §28.
   *
   * Preserved exactly from the page this replaced, and gated on the same
   * question it always answered: whether this programme refused something. A
   * sparse report's most useful page is the one that tells a family the shape
   * of what follows instead of leaving them to notice the gaps, and 13E found
   * it better structured than the full-data page above it.
   */
  if ((model.evidenceLimits ?? []).length && k.remaining() >= 250) evidenceStatus(k, model);
}

/**
 * A compact two-column orientation grid.
 *
 * `k.facts` gives its label 168 points and its value the rest of the page,
 * which is right for a page of fact lines and wrong for seven of them: the
 * snapshot must not read like an eighth analytical page, so it takes two
 * columns and half the height.
 */
/**
 * Reserve a box, draw absolutely inside it, and put the flow cursor back.
 *
 * `slot` advances `doc.y` past the box, but every `doc.text` drawn inside one
 * moves it again — and a block whose last line lands ABOVE the bottom of its
 * box leaves the cursor there, so the next block starts nine points too high.
 * That is exactly how the snapshot's coach label came to sit on the last row of
 * the grid above it. `charts` in philosophyPdf.js wraps every chart for the
 * same reason; this is the same contract.
 */
function absolute(k, height, draw) {
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
 * One snapshot line: label left, value right, both at one weight.
 *
 * `factLine` sets its value in bold, which is right on a card where the figure
 * is the point. Here it is not: seven bold values under six findings made the
 * orientation block the second-loudest thing on the report's most important
 * page. Same geometry, one weight, and the hierarchy does what §E asks.
 */
function snapshotLine(doc, x, y, w, key, value) {
  doc.font('Helvetica').fontSize(7.5);
  const valueW = Math.min(w * 0.56, doc.widthOfString(String(value)) + 2);
  line(doc, key, x, y, w - valueW - 6, { size: 7.5, color: MUTED });
  line(doc, value, x + w - valueW, y, valueW,
    { size: 7.5, color: value === '—' ? MUTED : INK, align: 'right' });
  return y + 11;
}

function snapshotGrid(k, facts) {
  const rows = Math.ceil(facts.length / 2);
  absolute(k, rows * 13 + 4, (box) => {
    facts.forEach(([label, value], i) => {
      snapshotLine(k.doc, box.x + (i % 2) * (HALF + GAP), box.y + Math.floor(i / 2) * 13, HALF,
        label, value ?? '—');
    });
  });
}

/**
 * PROGRAMME SNAPSHOT — the orientation the findings sit in.
 *
 * Not a second findings page. Every line here is a count, a name or a coverage
 * figure; nothing carries a band, a comparison or a conclusion, and the page
 * that owns each subject states it in full later. It exists so the findings
 * page can be findings, which is the whole of §B.
 *
 * `newPage: false` draws it as a block under the findings, where the findings
 * left room for it. Hierarchy is the requirement; two pages are not.
 */
export function programmeSnapshotPage(k, model, { newPage = true } = {}) {
  const coach = coachContextFor(model.coachAttribution, { division: model.college?.division });
  const snap = programmeSnapshot(model, { coach });

  if (newPage) {
    pageHead(k, {
      kicker: 'At a glance',
      title: 'Programme snapshot',
      question: 'What was measured, over how many seasons, and how complete the record is.',
    });
  } else {
    k.heading('Programme snapshot');
  }

  snapshotGrid(k, snap.facts);

  /**
   * The coach context, at the volume the record supports (§R).
   *
   * Five cases and five different heights, deliberately. A full history is a
   * name; an unresolved 2026 row is one grey sentence. The case that reframes
   * the whole report — none or one measured season under the current coach — is
   * not here at all: it is a finding on the page above, which is the only
   * placement proportional to what it changes.
   */
  const { doc } = k;
  const c = snap.coach;
  const strip = c.strip
    ? coachTimelineFor(coach, { recruitSeason: model.recruitSeason }) : null;
  const noteH = c.note
    ? doc.font('Helvetica').fontSize(7.5).heightOfString(c.note, { width: HALF }) : 0;
  absolute(k, Math.max(28, 26 + noteH, strip ? 60 : 0), (box) => {
    doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
      .text(String(c.label).toUpperCase(), box.x, box.y,
        { width: HALF, characterSpacing: TYPE.label.spacing, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
      .text(fitText(doc, c.value ?? 'Not on file', HALF), box.x, box.y + 10,
        { width: HALF, lineBreak: false });
    if (c.note) {
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(c.note, box.x, box.y + 25, { width: HALF });
    }
    if (strip) tenureStrip(doc, box.x + HALF + GAP, box.y, HALF, strip);
  });

  /**
   * How the page above was ordered, said once, in the reader's terms.
   *
   * Not a methodology note and not a disclaimer: a reader who can see that the
   * order means something is a reader who can trust it, and one who cannot will
   * read five ranked findings as five arbitrary ones.
   */
  // Not printed where there is nothing to have ordered.
  if (!snap.findings) return;
  k.note('The findings above are ordered by how much each one changes the reading of this '
    + 'programme’s record: a change to the level it competes at first, then a measured difference '
    + 'from comparable programmes, then a pattern inside the normal range. The pages themselves '
    + 'run in the same order for every programme, so a finding may point forward or back.');
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
/**
 * `athletePathwayPage` was replaced by `athleteAtAGlance` in Phase 13F.
 *
 * It carried five paragraphs of synthesis, a non-claim aside, a navigation band
 * and — on a sparse programme — the two lists below. Every sentence of the
 * synthesis is now a ranked finding with a metric and a page reference, and the
 * navigation band is the page references on those findings. The two lists
 * survive: they are the sparse programme's honest answer and 13E found them
 * better structured than the full-data page they sat behind.
 */

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
