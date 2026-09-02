/**
 * The two programme reports, drawn.
 *
 * Written for the athlete and their family, so every figure is labelled in
 * words and every absence says why it is absent. `null` means "we could not
 * measure this" throughout — a bar of length zero is indistinguishable from a
 * programme that plays no freshmen, and that confusion is the single defect
 * this whole module exists downstream of.
 *
 * Buffered into a Buffer rather than piped to the response. Piping flushes the
 * headers on the first chunk, so a throw halfway down page two would produce a
 * 200 carrying a truncated PDF — a file that opens blank with no error
 * anywhere. While the bytes are in memory a failure is still a 500 with a
 * message, which is the contract every other route in this server keeps.
 */
import PDFDocument from 'pdfkit';
import { attachAudit, reserved } from './reportAudit.js';
import { registerUnicodeFallback, fallbackFor } from './reportFonts.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';
import { positionPlural } from '../../shared/positions.js';

const INK = '#131E2B';
const MUTED = '#78848F';
const LINE = '#DCE1E7';
const CLARET = '#8C2F39';
const NAVY = '#0F2A43';
const MID = '#5C8CB4';
const PALE = '#A9C4D9';
const GREEN = '#2C6350';

const M = 54;                       // page margin
const W = 595.28 - M * 2;           // A4 content width

/**
 * The typographic scale. Five levels, one definition each.
 *
 * Before this existed the same level was set at three different sizes
 * depending on which module drew it — a page title was 20pt on an evidence
 * page, 19pt on a glance page and 13pt on the methodology continuation, and
 * the reader had no way to tell whether a size change meant a level change.
 *
 *   1  kicker    which part of the report this page belongs to
 *   2  title     what this page is
 *   3  question  what it answers, and the scope strip under it
 *   4  section   a titled region: a card, or a block within a page
 *      module    a chart's own title
 *   5  body / caption / note / label
 *
 * Claret small capitals mean "a titled region begins here" wherever they
 * appear. Ink at module size means "this is a chart". Nothing else may use
 * either, which is what makes them legible as levels rather than decoration.
 */
export const TYPE = {
  kicker: { font: 'Helvetica-Bold', size: 8, color: CLARET, spacing: 1.2 },
  title: { font: 'Helvetica-Bold', size: 19, color: INK },
  question: { font: 'Helvetica', size: 10, color: MUTED },
  scope: { font: 'Helvetica', size: 7.5, color: MUTED },
  section: { font: 'Helvetica-Bold', size: 9, color: CLARET, spacing: 1 },
  module: { font: 'Helvetica-Bold', size: 9.5, color: INK },
  caption: { font: 'Helvetica', size: 8, color: MUTED },
  body: { font: 'Helvetica', size: 9.5, color: INK },
  note: { font: 'Helvetica', size: 8, color: MUTED },
  label: { font: 'Helvetica-Bold', size: 6.5, color: MUTED, spacing: 0.8 },
};

/** Vertical rhythm, so spacing is a decision made once rather than per page. */
export const SPACE = {
  afterTitle: 8,
  afterQuestion: 12,
  afterScope: 14,
  beforeSection: 15,
  afterSection: 11,
  afterBody: 7,
  afterNote: 7,
  afterChart: 10,
};

/** Plain-English names for the verdicts, so nothing renders as a slug. */
const VERDICT_LABEL = {
  steady: 'Consistent, one coach',
  'structural-through-changes': 'Consistent through several coaching changes',
  'continuity-through-change': 'Consistent through a coaching change',
  'policy-shift-same-coach': 'Same coach, changed approach',
  'erratic-same-coach': 'Same coach, swings season to season',
  'regime-change': 'New coach, and the pattern changed with them',
  'new-coach-no-record': 'New coach, no season we can measure yet',
  'change-too-recent': 'Coaching change too recent to compare',
  'vacancy-in-window': 'A season with nobody in the job',
  'coach-unknown': 'No coach on file for these seasons',
  'coach-unknown-recent': 'Recent seasons could not be attributed',
  'too-few-seasons': 'Too few seasons on file to describe a pattern',
};

const BAND_LABEL = {
  impact: 'a starter’s season', rotation: 'in the rotation',
  fringe: 'fringe minutes', none: 'did not play',
};

/**
 * Shorten a string until it actually fits, measured in the font now set.
 *
 * pdfkit's own `ellipsis` does not hold with `lineBreak: false` — the text
 * still wraps, and in a table that means a long programme name running down
 * into the row beneath it. Measuring and cutting is deterministic.
 */
export function fitText(doc, text, width, opts = undefined) {
  const str = String(text ?? '');
  if (doc.widthOfString(str, opts) <= width) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(`${str.slice(0, mid)}…`, opts) <= width) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? `${str.slice(0, lo)}…` : '';
}

/**
 * Two rules applied to every string this document draws.
 *
 * ELLIPSIS. pdfkit ignores `ellipsis` when it is paired with
 * `lineBreak: false`. Thirty-nine call sites in this report ask for that
 * pairing — a heading, a chip, a table cell, a roster name — and every one was
 * silently getting the wrap it had explicitly asked not to have. The layout
 * guard found it on a programme name long enough to run four hundred points
 * off the side of an A4 page.
 *
 * COMPOSITION. A name can arrive decomposed: "João" as J, o, a, a combining
 * tilde, o. Helvetica's WinAnsi encoding has "ã" and has no combining mark at
 * all, so the tilde is dropped and the player's name is silently misspelled on
 * the page. Composing to NFC is the same string written the other way, not a
 * transliteration — nothing is stripped and no letter is replaced by a
 * different letter. Three of the four unencodable names in 132,590 roster rows
 * are exactly this, and composing fixes all three.
 *
 * Installed on the document rather than fixed at each call site: the intent is
 * already declared everywhere it is wanted, and a rule that has to be
 * remembered thirty-nine times is a rule that will be missed on the fortieth.
 */
const COMBINING = /[\u0300-\u036F]/;

/**
 * THE HOMOGLYPH FOLD IS GONE — Phase 13D.1 / §1.
 *
 * 13D drew ё as ë, on the grounds that the two are the same shape and Helvetica
 * holds only the second. It rendered, and it was still not the name. It could
 * not have been made general either: the same encoding gap swallows č, ć, ā, š
 * and ž, which are Latin letters with no Latin twin to fold onto, and one of
 * them is already in this database.
 *
 * A name is now drawn in a face that has the glyph — see reportFonts.js — or
 * reported as undrawable. It is never respelled.
 */

function installTextRules(doc) {
  const prev = doc.text.bind(doc);
  doc.text = (text, x, y, options) => {
    let opts = options;
    let ox = x;
    if (typeof x === 'object' && x !== null) { opts = x; ox = undefined; }

    let str = text;
    if (typeof str === 'string' && COMBINING.test(str)) str = str.normalize('NFC');

    /**
     * A face that can draw this string, where the one set cannot.
     *
     * Chosen before the fitting below, because `fitText` measures with the
     * font that is set and the two must agree — measured in Helvetica and
     * drawn in an embedded face, a clipped string is cut at the wrong
     * character. The face is restored afterwards so a caller that sets a font
     * and then draws twice is unaffected.
     */
    const alias = fallbackFor(doc, str);
    if (!alias) {
      if (opts && opts.lineBreak === false && opts.ellipsis && opts.width) {
        str = fitText(doc, str, opts.width, opts);
      }
      if (str === text) return prev(text, x, y, options);
      return typeof ox === 'number' ? prev(str, x, y, options) : prev(str, options);
    }

    const restore = doc._font;
    const size = doc._fontSize;
    doc.font(alias).fontSize(size);
    try {
      if (opts && opts.lineBreak === false && opts.ellipsis && opts.width) {
        str = fitText(doc, str, opts.width, opts);
      }
      return typeof ox === 'number' ? prev(str, x, y, options) : prev(str, options);
    } finally {
      // Restored by identity rather than by name: a caller may have set an
      // alias of its own, and re-resolving a name would lose it.
      doc._font = restore;
      doc.fontSize(size);
    }
  };
}

/**
 * The largest size at or below `size` that fits `text` on one line.
 *
 * A title is a fixed slot in a layout: "West Virginia University Institute of
 * Technology" either shrinks or it takes a second line, and a second line
 * pushes the cards on a glance page down by a line height they were not sized
 * for. Shrinking to a floor keeps every page the same shape, and below the
 * floor the caller decides.
 */
export function fitHeadline(doc, text, width, size, floor = 13) {
  const str = String(text ?? '');
  for (let s = size; s >= floor; s -= 0.5) {
    doc.fontSize(s);
    if (doc.widthOfString(str) <= width) return s;
  }
  doc.fontSize(floor);
  return floor;
}

export function kit(doc) {
  const api = {
    doc,
    /** Set by the running order; consumed by the next `pageHead`. */
    pendingAct: null,
    /**
     * Draw something once every page exists.
     *
     * A page-two summary that cites "Roster continuity, page 12" cannot know
     * that 12 while page two is being written — the same problem the contents
     * page has, and the same solution. The callback is handed the page it was
     * registered on and is run after the document is complete, with the
     * document switched back to that page.
     */
    later: [],
    defer(fn) {
      api.later.push({ page: doc.bufferedPageRange().count - 1, fn });
      return api;
    },
    y() { return doc.y; },
    gap(n = 10) { doc.y += n; return api; },

    room(height) {
      if (doc.y + height > doc.page.height - M - 24) doc.addPage();
      return api;
    },

    /**
     * How much drawable height is left on the page being written.
     *
     * `room` decides for itself and adds a page; the running order sometimes
     * needs to ask BEFORE committing — a short section may flow beneath the
     * one above it, but only where it fits without cramping what is already
     * there. Same floor as `room`, so the two never disagree.
     */
    remaining() { return doc.page.height - M - 24 - doc.y; },

    title(text) {
      api.room(40);
      doc.font(TYPE.title.font);
      // Shrunk to fit rather than wrapped: a second line here would push the
      // cards on a glance page down by a line height they were not sized for.
      const size = fitHeadline(doc, text, W, TYPE.title.size, 13);
      doc.fontSize(size).fillColor(TYPE.title.color)
        .text(text, M, doc.y, { width: W, lineBreak: size > 13, ellipsis: size <= 13 });
      return api.gap(SPACE.afterTitle);
    },
    /** The question a page answers, under its title. */
    question(text) {
      api.room(26);
      doc.font(TYPE.question.font).fontSize(TYPE.question.size).fillColor(TYPE.question.color)
        .text(text, M, doc.y, { width: W });
      return api.gap(SPACE.afterQuestion);
    },
    /** What the figures on this page were built from, in one line. */
    scope(parts) {
      const text = (Array.isArray(parts) ? parts : [parts]).filter(Boolean).join('   ·   ');
      if (!text) return api;
      api.room(20);
      doc.font(TYPE.scope.font).fontSize(TYPE.scope.size).fillColor(TYPE.scope.color)
        .text(text, M, doc.y, { width: W, lineBreak: false, ellipsis: true });
      doc.y += 9;
      return api.gap(SPACE.afterScope - 9);
    },
    heading(text) {
      // Space above, so a section reads as a break rather than as the next
      // paragraph. Suppressed at the top of a page, where the title provides it.
      if (doc.y > M + 30) doc.y += SPACE.beforeSection;
      api.room(40);
      doc.font(TYPE.section.font).fontSize(TYPE.section.size).fillColor(TYPE.section.color)
        .text(text.toUpperCase(), M, doc.y, { width: W, characterSpacing: TYPE.section.spacing });
      doc.moveTo(M, doc.y + 3).lineTo(M + W, doc.y + 3).lineWidth(0.75).strokeColor(LINE).stroke();
      return api.gap(SPACE.afterSection);
    },
    body(text, opts = {}) {
      api.room(24);
      doc.font(opts.bold ? 'Helvetica-Bold' : TYPE.body.font).fontSize(TYPE.body.size)
        .fillColor(opts.color || TYPE.body.color)
        .text(text, M, doc.y, { width: opts.width || W, ...opts });
      return api.gap(SPACE.afterBody);
    },
    note(text) {
      api.room(20);
      doc.font(TYPE.note.font).fontSize(TYPE.note.size).fillColor(TYPE.note.color)
        .text(text, M, doc.y, { width: W });
      return api.gap(SPACE.afterNote);
    },

    /** A framed statement — used for the one caveat that must not be missed. */
    box(text, { color = CLARET, title = null } = {}) {
      const inner = W - 28;
      const titleH = title ? 12 : 0;
      const h = doc.font(TYPE.body.font).fontSize(TYPE.body.size)
        .heightOfString(text, { width: inner }) + 20 + titleH;
      api.room(h + 8);
      const top = doc.y;
      doc.save().rect(M, top, W, h).fillOpacity(0.05).fill(color).restore();
      doc.save().rect(M, top, 3, h).fill(color).restore();
      if (title) {
        doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(color)
          .text(String(title).toUpperCase(), M + 14, top + 10,
            { width: inner, characterSpacing: TYPE.label.spacing, lineBreak: false });
      }
      doc.font(TYPE.body.font).fontSize(TYPE.body.size).fillColor(INK)
        .text(text, M + 14, top + 10 + titleH, { width: inner });
      doc.y = top + h;
      return api.gap(12);
    },

    /**
     * What Thriv3 sees: the page's own reading of the evidence below it.
     *
     * Set as the first thing under the page's question and above the charts,
     * because it is the primary tier — a reader who takes one thing from a
     * page should take this. Left rule in claret, body at reading size, and
     * deliberately NOT a tinted panel: `box` is the limitation a reader must
     * not miss and `aside` is a coverage footnote, and a third tinted block
     * competing with both would flatten all three.
     */
    reading(sentences, { title = 'What Thriv3 sees' } = {}) {
      const list = (Array.isArray(sentences) ? sentences : [sentences]).filter(Boolean);
      if (!list.length) return api;
      const inner = W - 22;
      const h = list.reduce((sum, t) => sum + doc.font('Helvetica').fontSize(9.5)
        .heightOfString(t, { width: inner }) + 4, 0) + 16;
      api.room(h + 10);
      const top = doc.y;
      doc.save().rect(M, top, 2.5, h).fill(CLARET).restore();
      doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(CLARET)
        .text(String(title).toUpperCase(), M + 14, top,
          { width: inner, characterSpacing: TYPE.label.spacing, lineBreak: false });
      let y = top + 12;
      for (const t of list) {
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(t, M + 14, y, { width: inner });
        y = doc.y + 4;
      }
      doc.y = top + h;
      return api.gap(12);
    },

    /**
     * A quieter block than `box`, for a coverage detail rather than a limit.
     *
     * The report had one callout style doing both jobs: the limitation a
     * reader must not miss and the footnote about which rows were legible were
     * drawn as identical claret boxes, so neither was louder than the other.
     * This one is grey, unruled and labelled, and never carries the primary
     * caveat.
     */
    aside(text, { title = null } = {}) {
      const inner = W - 28;
      const titleH = title ? 11 : 0;
      const h = doc.font(TYPE.note.font).fontSize(TYPE.note.size)
        .heightOfString(text, { width: inner }) + 18 + titleH;
      api.room(h + 8);
      const top = doc.y;
      doc.save().rect(M, top, W, h).fillOpacity(0.04).fill(INK).restore();
      if (title) {
        doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
          .text(String(title).toUpperCase(), M + 14, top + 9,
            { width: inner, characterSpacing: TYPE.label.spacing, lineBreak: false, ellipsis: true });
      }
      doc.font(TYPE.note.font).fontSize(TYPE.note.size).fillColor(MUTED)
        .text(text, M + 14, top + 9 + titleH, { width: inner });
      doc.y = top + h;
      return api.gap(12);
    },

    /**
     * One horizontal bar. `value === null` draws the reason instead, never an
     * empty track, because an empty track reads as a confident zero.
     */
    bar({ label, value, max, unit = '', color = NAVY, marker = null, note = null, unavailable = null }) {
      const rowH = 20;
      api.room(rowH + 4);
      const top = doc.y;
      const labelW = 132;
      const trackX = M + labelW;
      const trackW = W - labelW - 96;

      doc.font('Helvetica').fontSize(9).fillColor(INK)
        .text(label, M, top + 4, { width: labelW - 8, ellipsis: true });

      if (unavailable || value == null) {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
          .text(unavailable || 'not enough on file', trackX, top + 4, { width: trackW + 90 });
        doc.y = top + rowH;
        return api;
      }

      doc.save().roundedRect(trackX, top + 3, trackW, 13, 2).fill('#EDEFF3').restore();
      const w = Math.max(2, Math.min(1, value / max) * trackW);
      doc.save().roundedRect(trackX, top + 3, w, 13, 2).fill(color).restore();
      if (marker != null && marker <= max) {
        const mx = trackX + (marker / max) * trackW;
        doc.save().moveTo(mx, top + 1).lineTo(mx, top + 18).lineWidth(1).strokeColor(CLARET).stroke().restore();
      }
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
        .text(`${Math.round(value).toLocaleString('en-US')}${unit}`, trackX + trackW + 8, top + 4,
          { width: 88, align: 'left' });
      if (note) {
        doc.font('Helvetica').fontSize(8).fillColor(MUTED)
          .text(note, trackX + trackW + 8, top + 4, { width: 88, align: 'right' });
      }
      doc.y = top + rowH;
      return api;
    },

    /**
     * Where a position's minutes went. The three shares partition the minutes
     * exactly, which is what makes a stacked bar honest here rather than a
     * picture of three unrelated averages.
     */
    stacked({ returning, freshman, newcomer, label, unavailable }) {
      api.room(34);
      const top = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(label, M, top, { width: W });
      const barTop = top + 13;
      if (unavailable || returning == null) {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
          .text(unavailable || 'no position-seasons we can read', M, barTop, { width: W });
        doc.y = barTop + 14;
        return api.gap(4);
      }
      // "Experienced arrival", not "transfer": the roster cannot tell a
      // transfer from a junior-college arrival or an older recruit, and
      // naming one of the three asserts something it does not record.
      const parts = [
        { v: returning, c: PALE, t: 'returning' },
        { v: freshman, c: NAVY, t: 'first-years' },
        { v: newcomer, c: GREEN, t: 'experienced arrivals' },
      ];
      const total = parts.reduce((s, p) => s + p.v, 0) || 100;
      let x = M;
      const unlabelled = [];
      for (const part of parts) {
        const w = (part.v / total) * W;
        doc.save().rect(x, barTop, Math.max(0, w - 2), 18).fill(part.c).restore();
        if (w > 46) {
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(part.c === PALE ? INK : '#FFFFFF')
            .text(`${Math.round(part.v)}% ${part.t}`, x + 4, barTop + 6, {
              width: w - 8, lineBreak: false, ellipsis: true,
            });
        } else {
          unlabelled.push(part);
        }
        x += w;
      }
      doc.y = barTop + 18;
      // Only the segments too narrow to carry their own label. Printing all
      // three underneath repeated the bar word for word.
      if (unlabelled.length) {
        api.gap(3);
        const legend = unlabelled.map((part) => `${Math.round(part.v)}% ${part.t}`).join('   ·   ');
        doc.font(TYPE.note.font).fontSize(TYPE.note.size).fillColor(MUTED)
          .text(legend, M, doc.y, { width: W });
      }
      return api.gap(6);
    },

    /**
     * Reserve a box for a chart and advance past it.
     *
     * Charts draw with absolute coordinates inside the box rather than off the
     * flow cursor, because pdfkit will auto-paginate out from under a
     * half-drawn axis the moment a `text` call runs past the page bottom.
     */
    slot(height) {
      api.room(height + 6);
      const box = { x: M, y: doc.y, w: W, h: height };
      doc.y = box.y + height;
      api.gap(8);
      return box;
    },

    /** Graphics-state guard: opacity leaks into everything drawn after it. */
    dim(alpha, fn) {
      doc.save().fillOpacity(alpha).strokeOpacity(alpha);
      try { fn(); } finally { doc.restore(); }
      return api;
    },

    /** A two-column fact list. */
    facts(rows) {
      for (const [k, v] of rows) {
        api.room(17);
        const top = doc.y;
        doc.font('Helvetica').fontSize(8.8).fillColor(MUTED).text(k, M, top, { width: 168 });
        // The LABEL is the one that wraps — "…of those, in their final eligible
        // season in 2027" takes two lines in 168 points. Advancing on the
        // value's height alone put the next row's label 4 points into this
        // one's second line.
        const afterLabel = doc.y;
        // A null value is a figure that could not be made, and prints as a dash
        // in the same grey a missing table cell does — never as a blank, and
        // never as a zero.
        const missing = v === null || v === undefined || v === '';
        doc.font('Helvetica').fontSize(8.8).fillColor(missing ? MUTED : INK)
          .text(missing ? '—' : v, M + 176, top, { width: W - 176 });
        doc.y = Math.max(afterLabel, doc.y, top + 14) + 1;
      }
      return api.gap(9);
    },

    /**
     * A table that flows down the page and continues onto the next.
     *
     * Every other primitive here draws inside a fixed `slot()` box in absolute
     * coordinates. A table cannot: it is as long as its data, so it is built
     * on the flow model `facts` and `bullets` use — `room()` before each row,
     * the cursor advanced per row — and the header is redrawn whenever a row
     * lands on a new page.
     *
     * A row is never split across a page boundary, and a null cell prints an
     * em dash rather than a blank or a zero.
     *
     * `columns` are `{ key, label, width, align, format }` where `width` is a
     * fraction of the content width and the fractions sum to 1.
     *
     * A column marked `dropWhenEmpty` is omitted where EVERY rendered row is
     * null for it, and its width is shared out among the rest. That is opt-in
     * per column and deliberately not automatic: a column of dashes is
     * sometimes the finding — an origin column with nothing in it says the
     * rosters record no nationality at all — whereas "previous programme" is
     * only ever recorded for some arrivals, so a whole column of dashes there
     * is a field this source does not carry rather than a fact about anybody.
     * Emptiness, never zero: a column of zeros is a measurement.
     *
     * `note` may be a function of `{ dropped }` so the sentence explaining a
     * dash is not printed for a column nobody can see.
     */
    table({ columns, rows, caption = null, note = null, rowHeight = 13, highlight = null,
      continued = null }) {
      const dropped = [];
      const shown = columns.filter((c) => {
        if (!c.dropWhenEmpty) return true;
        const any = rows.some((r) => {
          if (r.group) return false;
          const raw = c.format ? c.format(r[c.key], r) : r[c.key];
          return raw !== null && raw !== undefined && raw !== '';
        });
        if (!any) dropped.push(c.key);
        return any;
      });
      const total = shown.reduce((a, c) => a + c.width, 0) || 1;
      const widths = shown.map((c) => (c.width / total) * W);
      const xOf = (i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0);

      /**
       * A heading breaks onto a second line rather than losing its meaning.
       *
       * Ten headings across the report were clipping — "MINUTES VACATED" to
       * "MINUTES V…", "RETURNING SHARE" to "RETURNING…" — which leaves the
       * reader guessing what a column measures. A data cell may clip, because
       * a name is as long as it is; a heading may not.
       */
      doc.font(TYPE.label.font).fontSize(TYPE.label.size);
      const headOpt = (c, i) => ({ width: widths[i] - 6, align: c.align || 'left',
        lineBreak: false, characterSpacing: TYPE.label.spacing });
      const headLines = shown.map((c, i) => {
        const opt = headOpt(c, i);
        const label = String(c.label).toUpperCase();
        const w = widths[i] - 6;
        if (doc.widthOfString(label, opt) <= w) return [label];
        const words = label.split(' ');
        let first = '';
        let n = 0;
        while (n < words.length) {
          const next = first ? `${first} ${words[n]}` : words[n];
          if (first && doc.widthOfString(next, opt) > w) break;
          first = next;
          n += 1;
        }
        // BOTH lines have to be fitted. The first can be a single word wider
        // than the column — "FIRST-YEAR" in a 48pt column — and under
        // `align: 'right'` it then overflows to the LEFT, printing on top of
        // the column beside it. That is invisible to a page-bounds check,
        // because it never leaves the page.
        const rest = words.slice(n).join(' ');
        const head = fitText(doc, first, w, opt);
        const clipped = head !== first;
        if (!rest) {
          if (clipped) doc.__audit?.clip(label, head, w);
          return [head];
        }
        const cut = fitText(doc, rest, w, opt);
        if (clipped || cut !== rest) doc.__audit?.clip(label, `${head} ${cut}`, w);
        return [head, cut];
      });
      const headH = headLines.some((l) => l.length > 1) ? 20 : 11;

      const header = () => {
        api.room(rowHeight + headH + 6);
        const top = doc.y;
        shown.forEach((c, i) => {
          doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color);
          const opt = headOpt(c, i);
          // Bottom-aligned, so one-line and two-line headings share a baseline
          // and the rule under them is straight.
          const startY = top + headH - 8 - (headLines[i].length - 1) * 8;
          headLines[i].forEach((ln, j) => doc.text(ln, xOf(i), startY + j * 8, opt));
        });
        doc.moveTo(M, top + headH).lineTo(M + W, top + headH).lineWidth(0.75).strokeColor(INK).stroke();
        doc.y = top + headH + 5;
      };

      /**
       * A table that flows onto another page takes its title with it.
       *
       * A repeated column header is not an identity: a reader landing on the
       * second page of a fifty-row appendix saw SEASON / PLAYER / POSITION and
       * nothing at all to say which table it was. The methodology page already
       * carries a continuation heading for exactly this reason.
       */
      const carry = () => {
        if (!continued) return;
        doc.font(TYPE.kicker.font).fontSize(TYPE.kicker.size).fillColor(MUTED)
          .text('CONTINUED', M, M - 18,
            { width: W, characterSpacing: TYPE.kicker.spacing, lineBreak: false });
        doc.y = M;
        doc.font(TYPE.title.font).fontSize(14).fillColor(INK)
          .text(continued, M, doc.y, { width: W, lineBreak: false, ellipsis: true });
        doc.y += 2;
        doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(0.75).strokeColor(LINE).stroke();
        doc.y += 12;
      };

      if (caption) {
        api.room(16);
        doc.font(TYPE.caption.font).fontSize(TYPE.caption.size).fillColor(TYPE.caption.color)
          .text(caption, M, doc.y, { width: W });
        api.gap(6);
      }
      header();

      let striped = 0;
      for (const row of rows) {
        // A group heading keeps its rows with it: reserving two rows' worth
        // stops a heading stranding itself at the foot of a page.
        if (row.group) {
          const before = doc.bufferedPageRange().count;
          api.room(rowHeight * 2 + 10);
          if (doc.bufferedPageRange().count > before) { carry(); header(); }
          doc.y += 4;
          doc.font(TYPE.label.font).fontSize(7).fillColor(CLARET)
            .text(String(row.group).toUpperCase(), M, doc.y, { width: W, characterSpacing: 1, lineBreak: false });
          doc.y += 12;
          striped = 0;
          continue;
        }

        const before = doc.bufferedPageRange().count;
        api.room(rowHeight);
        if (doc.bufferedPageRange().count > before) { carry(); header(); striped = 0; }

        const top = doc.y;
        if (striped % 2 === 1) {
          doc.save().rect(M, top - 2, W, rowHeight).fillOpacity(0.03).fill(INK).restore();
        }
        if (highlight && highlight(row)) {
          doc.save().rect(M - 4, top - 2, 2, rowHeight).fill(CLARET).restore();
        }
        shown.forEach((c, i) => {
          const raw = c.format ? c.format(row[c.key], row) : row[c.key];
          const text = raw === null || raw === undefined || raw === '' ? '—' : String(raw);
          const missing = text === '—';
          doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
            .fillColor(missing ? MUTED : (c.color ? c.color(row) : INK));
          doc.text(fitText(doc, text, widths[i] - 6), xOf(i), top, {
            width: widths[i] - 6, align: c.align || 'left', lineBreak: false,
          });
        });
        doc.y = top + rowHeight;
        striped += 1;
      }

      const text = typeof note === 'function' ? note({ dropped }) : note;
      if (text) {
        api.gap(4);
        api.note(text);
      }
      return api.gap(6);
    },

    bullets(items) {
      for (const item of items) {
        api.room(22);
        const top = doc.y;
        doc.font(TYPE.body.font).fontSize(TYPE.body.size).fillColor(MUTED).text('•', M, top, { width: 10 });
        doc.font(TYPE.body.font).fontSize(TYPE.body.size).fillColor(INK)
          .text(item, M + 14, top, { width: W - 14 });
        doc.y += 5;
      }
      return api.gap(SPACE.afterBody);
    },
  };
  return api;
}

/** Turns the stored cohort keys in a refusal string into words. */
export function humanCohort(text) {
  return String(text ?? '')
    .replace(/GOALKEEPER/g, 'goalkeepers').replace(/DEFENSE/g, 'defenders')
    .replace(/MIDFIELD/g, 'midfielders').replace(/FORWARD/g, 'forwards')
    .replace(/\binternational\b/g, 'international students')
    .replace(/\bdomestic\b/g, 'US recruits')
    .replace(/ \/ /g, ' who are ');
}

export const minutes = (v) => (v == null ? null : `${Math.round(v).toLocaleString('en-US')} min`);

/**
 * A range, or the single value when the range has no width.
 *
 * "4 to 4" is what a degenerate range prints if nobody stops it, and it reads
 * as a fault in the document rather than as a programme that did the same
 * thing every season. Counts here are often half-integers — a median over four
 * seasons — so the equality test has to tolerate that rather than assume
 * integers.
 */
export function spanText(range, { join = ' to ' } = {}) {
  if (!range || range.low == null || range.high == null) return null;
  const one = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
  return range.low === range.high ? one(range.low) : `${one(range.low)}${join}${one(range.high)}`;
}

export function footer(doc, line) {
  // The footer sits INSIDE the bottom margin, and pdfkit adds a page for any
  // text written below it — while this loop is walking the pages. One report
  // grew sixteen blank pages that way, each carrying nothing but the footer
  // that created it. Dropping the margin for the duration is the fix; the
  // range is read once, before anything is written, so it cannot grow.
  const range = doc.bufferedPageRange();
  const total = range.count;
  // Declared reserved rather than inferred: the overflow guard treats the band
  // below the content box as a failure everywhere else, and the footer is the
  // one thing entitled to be there.
  reserved(doc, () => {
    for (let i = range.start; i < range.start + total; i += 1) {
      doc.switchToPage(i);
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - M + 6;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(line, M, y, { width: W - 40, lineBreak: false });
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(`${i - range.start + 1}/${total}`, M + W - 40, y,
          { width: 40, align: 'right', lineBreak: false });
      doc.page.margins.bottom = keep;
    }
  });
}

/**
 * `audit` is an optional collector from `reportAudit.createAudit()`. It is
 * filled in place, so the return value stays a Buffer and the production call
 * path is unchanged whether or not anything is watching.
 */
export function render(build, { audit = null } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true,
      info: { Producer: 'Thriv3', Creator: 'Thriv3' } });
    // Order matters: the audit patches `text` first so that the fitting and
    // composing layer sits on top of it, and the guard therefore measures the
    // string that is actually drawn rather than the one handed in.
    if (audit) attachAudit(doc, audit);
    installTextRules(doc);
    // Registered, not embedded: pdfkit reads a face only when something is
    // drawn in it, so an ASCII-only report is byte-for-byte unaffected.
    registerUnicodeFallback(doc);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(kit(doc), doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Shared sections
// ---------------------------------------------------------------------------

/**
 * The top of a page: kicker, title, question, scope strip.
 *
 * One implementation. There were four near-identical ones — the evidence
 * pages, the athlete pages, the appendices and the glance pages each had their
 * own — which is why the page title was three different sizes depending on
 * which layer you happened to be reading.
 *
 * `newPage` is false only for a page the caller has already opened.
 *
 * `continued` is a section flowing BENEATH another on the same page: no page
 * is added, no kicker is drawn over the one already at the top, and the flow
 * cursor is left where the section above it finished rather than reset to the
 * margin. It is drawn at the supporting weight — a claret rule, a 14pt title —
 * because that is what it is: a second block on somebody else's page, not a
 * page of its own pretending otherwise.
 */
export function pageHead(k, { kicker, title, question = null, scope = null, newPage = true,
  quiet = false, continued = false }) {
  const { doc } = k;
  if (continued) {
    k.gap(14);
    doc.save().rect(M, doc.y, W, 2.5).fill(CLARET).restore();
    doc.y += 11;
    doc.font(TYPE.title.font).fontSize(14).fillColor(INK).text(title, M, doc.y, { width: W });
    doc.y += 3;
    if (question) {
      doc.font(TYPE.note.font).fontSize(8.5).fillColor(MUTED).text(question, M, doc.y, { width: W });
      doc.y += 6;
    }
    if (scope) k.scope(scope);
    return k;
  }
  if (newPage) doc.addPage();
  // An act divider, where one is pending. Drawn at the top of the first page
  // of a new act, in place of that page's kicker: the reader is told what the
  // next group of pages is FOR before being shown the first of them, which is
  // the whole reason the three acts exist rather than a running order.
  if (k.pendingAct) {
    const act = k.pendingAct;
    k.pendingAct = null;
    let y = M - 22;
    doc.save().rect(M, y, W, 2.5).fill(CLARET).restore();
    y += 9;
    doc.font(TYPE.kicker.font).fontSize(9.5).fillColor(CLARET)
      .text(String(act.title).toUpperCase(), M, y,
        { width: W, characterSpacing: 1.6, lineBreak: false, ellipsis: true });
    y += 14;
    if (act.blurb) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
        .text(act.blurb, M, y, { width: W * 0.86 });
      y = doc.y;
    }
    doc.y = y + 16;
    // The page's own weight still applies. A supporting page opening an act is
    // still a supporting page, and drawing its title at 19pt because a divider
    // happened to precede it was how a one-row table came to open the evidence
    // act at full volume.
    if (quiet) {
      doc.font(TYPE.title.font).fontSize(14).fillColor(INK).text(title, M, doc.y, { width: W });
      doc.y += 2;
      doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(0.75).strokeColor(LINE).stroke();
      doc.y += 10;
      if (question) {
        doc.font(TYPE.note.font).fontSize(8.5).fillColor(MUTED).text(question, M, doc.y, { width: W });
        doc.y += 8;
      }
    } else if (title) {
      k.title(title);
      if (question) k.question(question);
    }
    if (scope) k.scope(scope);
    return k;
  }
  if (kicker) {
    doc.font(TYPE.kicker.font).fontSize(TYPE.kicker.size)
      .fillColor(quiet ? MUTED : TYPE.kicker.color)
      .text(String(kicker).toUpperCase(), M, M - 18,
        { width: W, characterSpacing: TYPE.kicker.spacing, lineBreak: false, ellipsis: true });
  }
  doc.y = M;
  if (quiet) {
    // The supporting record is the rows behind the analysis, not another
    // headline. It says so by being set smaller and greyer than the pages it
    // supports, with a rule under it rather than a 19pt title.
    doc.font(TYPE.title.font).fontSize(14).fillColor(INK).text(title, M, doc.y, { width: W });
    doc.y += 2;
    doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(0.75).strokeColor(LINE).stroke();
    doc.y += 10;
    if (question) {
      doc.font(TYPE.note.font).fontSize(8.5).fillColor(MUTED).text(question, M, doc.y, { width: W });
      doc.y += 8;
    }
  } else {
    k.title(title);
    if (question) k.question(question);
  }
  if (scope) k.scope(scope);
  return k;
}

export function masthead(k, model, title, subtitle) {
  const { doc } = k;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(CLARET)
    .text('THRIV3', M, M - 18, { width: W, characterSpacing: 1.4 });
  k.title(title);
  k.body(subtitle, { color: MUTED });
  k.gap(4);
}

/** The claim the whole document has to make on page one, at full size. */
export function whatThisIs(k, model) {
  const seasons = model.describes.length
    ? `${model.describes[0]}–${model.describes[model.describes.length - 1]}`
    : 'no seasons on file';
  k.box(`This is a record of what happened at this programme in ${seasons}. `
    + `The ${model.recruitSeason} season has not been played, so nothing here is a prediction — `
    + 'it is a track record to weigh, and the pages that follow say where it is thin.');
}

export function whoRunsIt(k, model) {
  k.heading('Who has been in charge');
  const segments = (model.tenure?.segments ?? [])
    .map((s) => `${s.coach} (${s.from}${s.to === s.from ? '' : `–${s.to}`})`);
  k.facts([
    ['Coaches on file', segments.length ? segments.join('  \u2013  ') : 'none on file'],
    [`Head coach, ${model.recruitSeason}`, model.coachForRecruitSeason || 'not on file'],
    ['What we can say', VERDICT_LABEL[model.verdict?.verdict] ?? 'Not enough on file'],
  ]);
  // The notes are written to sit mid-sentence in a terminal; here they open a
  // paragraph.
  if (model.verdict?.note) k.body(model.verdict.note.replace(/^./, (c) => c.toUpperCase()) + '.');

  if (model.verdict?.verdict === 'new-coach-no-record') {
    k.box(`${model.coachForRecruitSeason} has not yet coached a season we can measure. `
      + 'Everything below is the previous staff’s record, and it may not describe how this '
      + 'programme will be run.', { color: CLARET });
  } else if (model.coachStillInPost === null) {
    k.box(`We could not establish who is in charge for ${model.recruitSeason}, so we are not `
      + 'assuming the coach below is still there.', { color: CLARET });
  }
}

export function ladderSection(k, model) {
  k.heading('What a first year has looked like');
  if (!model.ladder.length) {
    k.body('No season on file carries enough recorded minutes to describe a first year here — '
      + 'this programme’s rosters do not publish them consistently enough to rank.',
      { color: MUTED });
    return;
  }
  k.body('Freshmen ranked by minutes, so a recruit can place themselves. The line marks '
    + `${STARTER_MINUTES} minutes — a starter’s season.`, { color: MUTED });
  k.gap(4);
  const max = Math.max(1600, ...model.ladder.map((r) => r.high ?? 0));
  for (const r of model.ladder.slice(0, 5)) {
    // A rank the seasons disagree about is shown as a range, because quoting
    // the median alone can assert the opposite of the truth.
    const wide = r.agreement === 'wide';
    k.bar({
      label: r.rank === 1 ? 'Best freshman' : `${r.rank}${['', 'st', 'nd', 'rd'][r.rank] || 'th'}`,
      value: r.comparable ? r.median : null,
      unavailable: r.comparable ? null : 'the seasons are not comparable this far down',
      max,
      marker: STARTER_MINUTES,
      color: r.rank <= 2 ? NAVY : MID,
      note: wide ? `${r.low}–${r.high}` : BAND_LABEL[r.band],
    });
  }
  if (model.ladder.some((r) => r.agreement === 'wide')) {
    k.note('Where a range is shown instead of a band, the seasons on file disagree too much '
      + 'for one number to describe them.');
  }
  const starterSeasons = model.seasons.filter((s) => s.starters > 0).length;
  k.gap(4);
  k.body(`In ${starterSeasons} of ${model.seasons.length} `
    + `season${model.seasons.length === 1 ? '' : 's'} on file, at least one freshman `
    + 'played a starter’s season.');
}

export function benchmarkSection(k, model) {
  k.heading('Against every other programme');
  if (!model.benchmarks) {
    k.body(`We could not place this programme against the pool: ${model.benchmarksReason}.`,
      { color: MUTED });
    return;
  }
  const b = model.benchmarks;
  const rank1 = b.ladderByRank.find((r) => r.rank === 1);
  const top = model.ladder[0]?.median ?? null;
  const max = Math.max(1600, rank1?.p75 ?? 0, top ?? 0);
  k.body(`Across ${b.programmes.toLocaleString('en-US')} programmes in this sport.`, { color: MUTED });
  k.gap(4);
  k.bar({ label: 'Here, best freshman', value: top, max, marker: STARTER_MINUTES, color: NAVY });
  k.bar({ label: 'Typical programme', value: rank1?.median ?? null, max, marker: STARTER_MINUTES, color: PALE });
  k.bar({ label: 'Top quarter of them', value: rank1?.p75 ?? null, max, marker: STARTER_MINUTES, color: PALE });
}

export function fillMixSection(k, model) {
  k.heading('When a place comes free, who takes it');
  k.body('Every season, at every position, some players leave. This is where the minutes they '
    + 'were playing went the following season.', { color: MUTED });
  k.gap(6);
  k.stacked({ label: 'At this programme', ...model.dials,
    unavailable: model.dials.n ? null : 'no position-seasons here carry enough recorded minutes' });
  if (model.benchmarks?.poolMix) {
    k.stacked({ label: 'A typical programme losing about as much', ...model.benchmarks.poolMix });
  }
  k.gap(2);
  k.note('"Experienced arrival" counts anyone arriving who is not a first-year — a transfer, a '
    + 'junior-college arrival, or an older recruit. The roster cannot tell them apart. Across the '
    + 'game, the bigger the hole at a position the more of it goes to experienced arrivals rather '
    + 'than to first-years.');
}

export function positionSection(k, model) {
  k.heading('Position by position');
  const rows = model.byPosition.filter((p) => p.transitions > 0);
  if (!rows.length) {
    k.body('No position group here carries enough recorded minutes to read separately.', { color: MUTED });
    return;
  }
  for (const p of rows) {
    const opened = p.openings;
    const line = opened === 0
      ? 'no starter left this position in the seasons on file'
      : `${opened} time${opened === 1 ? '' : 's'} a starter left; a freshman took the place `
        + `${p.freshmanTookIt}, an experienced arrival ${p.newcomerTookIt}`;
    k.facts([[positionPlural(p.position).replace(/^./, (c) => c.toUpperCase()), line]]);
  }
  k.note('Counts, not percentages: with at most three seasons to look at, a percentage of three '
    + 'reads far more confidently than it deserves to.');
}

export function limits(k, model, extra = []) {
  k.heading('What this cannot tell you');
  k.bullets([
    `Nothing here is a forecast. The ${model.recruitSeason} season has not been played.`,
    'A player who stops appearing on a roster may have graduated, transferred, been injured or '
      + 'left the squad — the roster does not say which.',
    'Positions are grouped into goalkeeper, defender, midfielder and forward, so a left back and '
      + 'a centre back are counted together.',
    'Goalkeepers are a special case: one keeper plays nearly every minute and the rest play none, '
      + 'so a typical figure describes nobody.',
    'A coaching change after this was written is not in it. The date is on every page.',
    ...extra,
  ]);
}

// ---------------------------------------------------------------------------
// The two documents
// ---------------------------------------------------------------------------

export function renderProgrammePdf(model) {
  return render((k) => {
    const c = model.college;
    masthead(k, model, `${c.name} — programme philosophy`,
      [c.division, c.conference, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join('  ·  '));
    whatThisIs(k, model);
    whoRunsIt(k, model);
    ladderSection(k, model);
    benchmarkSection(k, model);
    fillMixSection(k, model);
    positionSection(k, model);
    limits(k, model);
    footer(k.doc, `Thriv3 · ${c.name} · prepared ${new Date().toISOString().slice(0, 10)}`);
  });
}

export function renderPlayerProgrammePdf(model) {
  return render((k) => {
    const c = model.college;
    const a = model.athlete;
    masthead(k, model, `${a.name} at ${c.name}`,
      [a.positionLabel, a.nationality, a.classYear ? `class of ${a.classYear}` : null,
        c.division].filter(Boolean).join('  ·  '));
    whatThisIs(k, model);

    k.heading('The ladder you would actually be on');
    const fit = model.fit;
    if (!fit || !fit.ladder.length) {
      k.body('There is not enough of this programme’s intake on file to read separately for '
        + `${a.name}.`, { color: MUTED });
    } else {
      const cohort = [fit.cohort?.position && positionPlural(fit.cohort.position),
        fit.cohort?.origin === 'international' ? 'international students' : null,
        fit.cohort?.origin === 'domestic' ? 'US recruits' : null].filter(Boolean).join(', ');
      k.body(cohort
        ? `Read for ${cohort} only — the players ${a.name} would be competing with.`
        : 'Read across the whole intake: there were too few of this athlete’s own group to '
          + 'read separately.', { color: MUTED });
      if (fit.cohort?.relaxed) {
        // `refused` names the cohort with the stored keys — DEFENSE, MIDFIELD —
        // which are map keys, not words anybody says.
        k.note(`We could not read ${a.name}’s exact group here — ${humanCohort(fit.cohort.refused)} `
          + `— so this is the wider ${humanCohort(fit.cohort.relaxed)} group instead.`);
      }
      k.gap(4);
      const max = Math.max(1600, ...fit.ladder.map((r) => r.high ?? 0),
        ...model.ladder.map((r) => r.high ?? 0));
      for (const r of fit.ladder.slice(0, 4)) {
        k.bar({
          label: r.rank === 1 ? `Best in ${a.name}’s group` : `${r.rank}${['', 'st', 'nd', 'rd'][r.rank] || 'th'}`,
          value: r.comparable ? r.median : null,
          unavailable: r.comparable ? null : 'the seasons are not comparable this far down',
          max, marker: STARTER_MINUTES, color: r.rank <= 2 ? NAVY : MID,
          note: r.agreement === 'wide' ? `${r.low}–${r.high}` : BAND_LABEL[r.band],
        });
      }
      k.gap(4);
      k.bar({ label: 'The whole intake', value: model.ladder[0]?.median ?? null, max,
        marker: STARTER_MINUTES, color: PALE, note: 'any position' });
      k.note('The whole-intake figure is the best of every incoming player of every position and '
        + 'background. It is the right number only for someone who would be the best of the entire '
        + 'class; the figure above it is the honest one.');
    }

    k.heading(`${positionPlural(a.position).replace(/^./, (ch) => ch.toUpperCase())} here, season by season`);
    const ph = fit?.position;
    if (!ph || !ph.transitions) {
      k.body('This position does not carry enough recorded minutes here to read separately.',
        { color: MUTED });
    } else {
      k.facts([
        ['Seasons we can read', String(ph.transitions)],
        ['Starters who left', String(ph.startersDeparted)],
        ['Seasons that opened a place', `${ph.openings} of ${ph.transitions}`],
        ['…where a freshman then started', `${ph.freshmanTookIt} of ${ph.openings}`],
        ['…where a transfer then started', `${ph.newcomerTookIt} of ${ph.openings}`],
      ]);
      for (const s of ph.seasons) {
        const names = s.departedNames.map((d) => `${d.name} (${minutes(d.minutes)})`).join(', ');
        k.body(`${s.season}: ${s.startersDeparted ? `${names} left` : 'no starter left'}`
          + ` — ${s.freshStarters} freshman starter${s.freshStarters === 1 ? '' : 's'} followed`
          + `${s.newcomerStarters ? `, and ${s.newcomerStarters} transfer starter${s.newcomerStarters === 1 ? '' : 's'}` : ''}.`);
      }
      if (ph.openings > 0 && ph.openings < 3) {
        k.box(`Only ${ph.openings} place${ph.openings === 1 ? ' has' : 's have'} come free at this `
          + 'position in the seasons on file. That is too few to be a pattern — read it as what '
          + 'happened, not as odds.', { color: CLARET });
      }
    }

    fillMixSection(k, model);
    whoRunsIt(k, model);
    limits(k, model, [
      'We can tell a US recruit from an international one, but not one country from another — '
        + 'there are never enough players from a single country at one programme to measure.',
      'Nothing here knows about injuries, who else is arriving in the same class, or admissions.',
    ]);
    footer(k.doc, `Thriv3 · ${a.name} at ${c.name} · prepared ${new Date().toISOString().slice(0, 10)}`);
  });
}

// ---------------------------------------------------------------------------
// Charts
//
// One rule, enforced in `frame`: a chart handed no data and no reason THROWS.
// It does not draw an empty frame. `render()` buffers the document before any
// header is written, so the throw becomes a 500 with a message rather than a
// PDF that opens on a confident empty axis — which is the defect this project
// has shipped, found and fixed more times than any other.
// ---------------------------------------------------------------------------

const AXIS = '#C3CBD4';
export const THEME = { INK, MUTED, LINE, CLARET, NAVY, MID, PALE, GREEN, M, W, AXIS,
  VERDICT_LABEL, BAND_LABEL };

function frame(k, box, { title, subtitle, unavailable, empty }) {
  const { doc } = k;
  let top = box.y;
  // A chart's title and subtitle are authored prose on one line, so shortening
  // one is always a defect rather than a long name being handled. The guard
  // used to watch table headings only, and a subtitle carrying "these three
  // measures are never combined into one" shipped as "…never combi…" until a
  // test that reads the finished page found it.
  const watch = (label, text, font, size) => {
    doc.font(font).fontSize(size);
    const fitted = fitText(doc, text, box.w);
    if (fitted !== text) doc.__audit?.clip(`chart ${label}: ${String(text).slice(0, 30)}`, fitted, box.w);
  };
  if (title) {
    watch('title', title, TYPE.module.font, TYPE.module.size);
    doc.font(TYPE.module.font).fontSize(TYPE.module.size).fillColor(TYPE.module.color)
      .text(title, box.x, top, { width: box.w, lineBreak: false, ellipsis: true });
    top += 14;
  }
  if (subtitle) {
    watch('subtitle', subtitle, TYPE.caption.font, TYPE.caption.size);
    doc.font(TYPE.caption.font).fontSize(TYPE.caption.size).fillColor(TYPE.caption.color)
      .text(subtitle, box.x, top, { width: box.w, lineBreak: false, ellipsis: true });
    top += 12;
  }
  const plot = { x: box.x, y: top, w: box.w, h: box.h - (top - box.y) };
  if (unavailable) {
    // No axes. An axis with nothing on it reads as "measured, all zero".
    doc.save().roundedRect(plot.x, plot.y, plot.w, Math.max(24, plot.h), 3)
      .lineWidth(0.75).strokeColor(LINE).stroke().restore();
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
      .text(unavailable, plot.x + 12, plot.y + Math.max(24, plot.h) / 2 - 5,
        { width: plot.w - 24, align: 'center', lineBreak: false, ellipsis: true });
    return null;
  }
  if (empty) {
    throw new Error(`chart "${title}" has no data and no stated reason`);
  }
  return plot;
}

/**
 * A number as a chart prints it.
 *
 * Minutes are whole numbers and always were, so this rounded. Counts of
 * players are not: a median over four seasons is a half-integer, and rounding
 * 2.5 to 3 printed a figure the note beside it contradicted. One decimal where
 * there is one, none where there is not.
 */
const nice = (v) => (Number.isInteger(v)
  ? v.toLocaleString('en-US')
  : (Math.round(v * 10) / 10).toLocaleString('en-US'));

export const charts = {
  /**
   * Every player as a dot: minutes across the x-axis, one lane per season.
   *
   * Sized by games PLAYED, not games started — a start is roughly ninety
   * minutes, so sizing by starts on a minutes axis encodes the axis twice and
   * adds ink rather than information. Whether they started is the fill.
   */
  scatter(k, { box, title, subtitle, lanes, points, xMax, marker, markerLabel, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !points?.length });
    if (!plot) return;
    const { doc } = k;
    const left = plot.x + 34;
    // The axis stops short of the content edge by the widest dot's radius. A
    // player at xMax is drawn centred ON the axis end, so a full-width axis
    // put half of the best player in the report off the side of the page.
    const w = plot.w - 34 - 8;
    const laneH = Math.min(26, (plot.h - 14) / lanes.length);

    if (marker != null && marker <= xMax) {
      const mx = left + (marker / xMax) * w;
      doc.save().dash(2, { space: 2 }).moveTo(mx, plot.y).lineTo(mx, plot.y + lanes.length * laneH)
        .lineWidth(0.75).strokeColor(CLARET).stroke().undash().restore();
      if (markerLabel) {
        doc.font('Helvetica').fontSize(6.5).fillColor(CLARET)
          .text(markerLabel, mx + 3, plot.y + lanes.length * laneH + 2, { width: 90, lineBreak: false });
      }
    }

    lanes.forEach((lane, i) => {
      const cy = plot.y + i * laneH + laneH / 2;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(lane, plot.x, cy - 4, { width: 30, lineBreak: false });
      doc.save().moveTo(left, cy).lineTo(left + w, cy).lineWidth(0.4).strokeColor(LINE).stroke().restore();
      for (const pt of points.filter((p) => p.lane === lane)) {
        const cx = left + Math.min(1, pt.value / xMax) * w;
        const r = 2 + Math.sqrt(Math.max(0, pt.size ?? 0) / (pt.sizeMax || 20)) * 3.6;
        doc.save().fillOpacity(pt.solid ? 0.85 : 0.32)
          .circle(cx, cy, r).fill(pt.color ?? NAVY).restore();
      }
    });

    // Anyone whose minutes were never recorded sits in a gutter, not at zero.
    const ghosts = points.filter((p) => p.value == null).length;
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
      .text(`0${' '.repeat(0)}`, left - 3, plot.y + lanes.length * laneH + 2, { width: 20, lineBreak: false });
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
      .text(nice(xMax), left + w - 30, plot.y + lanes.length * laneH + 2, { width: 30, align: 'right', lineBreak: false });
    if (ghosts) {
      doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(MUTED)
        .text(`${ghosts} with no minutes recorded, not shown`, plot.x, plot.y + lanes.length * laneH + 11,
          { width: plot.w, lineBreak: false });
    }
  },

  /**
   * Year one on the left, year two on the right, one line per player.
   *
   * The chart carried no vertical scale at all for three phases: a reader
   * could see that a line rose, and had no way to learn whether it rose from
   * fringe minutes to a starter's season or from 40 to 90. A minutes axis and
   * the starter line are the difference between a shape and evidence.
   *
   * Rising and falling are two tones of the same blue. They were navy and
   * claret, which reads as good and bad — fewer minutes in a second year is
   * not a verdict, and claret means "the reader's own year" everywhere else in
   * this document.
   */
  slope(k, { box, title, subtitle, pairs, max, leftLabel, rightLabel, marker, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !pairs?.length });
    if (!plot) return;
    const { doc } = k;
    const h = plot.h - 20;
    const axisW = 34;                          // the minutes scale down the side
    const lx = plot.x + axisW + 8;
    const rx = plot.x + plot.w - 104;
    const gx = plot.x + plot.w - 76;           // the gutter for those who left
    const yOf = (v) => plot.y + h - Math.min(1, v / max) * h;

    // The scale, so a rise can be read in minutes rather than in slope.
    const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];
    for (const t of ticks) {
      const ty = yOf(t);
      doc.save().moveTo(lx, ty).lineTo(rx, ty).lineWidth(0.3).strokeColor('#EDEFF3').stroke().restore();
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(nice(t), plot.x, ty - 3.5, { width: axisW, align: 'right', lineBreak: false });
    }
    if (marker != null && marker <= max) {
      const my = yOf(marker);
      doc.save().dash(2, { space: 2 }).moveTo(lx, my).lineTo(gx + 6, my)
        .lineWidth(0.75).strokeColor(CLARET).stroke().undash().restore();
      doc.font('Helvetica').fontSize(6.5).fillColor(CLARET)
        .text(`${nice(marker)} — a starter’s season`, lx + 4, my - 9,
          { width: 140, lineBreak: false });
    }

    for (const axis of [lx, rx]) {
      doc.save().moveTo(axis, plot.y).lineTo(axis, plot.y + h).lineWidth(0.5).strokeColor(AXIS).stroke().restore();
    }
    for (const pr of pairs) {
      const y1 = yOf(pr.from);
      if (pr.toState === 'measured') {
        doc.save().moveTo(lx, y1).lineTo(rx, yOf(pr.to)).lineWidth(0.9)
          .strokeOpacity(0.55).strokeColor(pr.to >= pr.from ? NAVY : MID).stroke().restore();
        doc.save().circle(rx, yOf(pr.to), 2.4).fillOpacity(0.7).fill(NAVY).restore();
      } else {
        doc.save().dash(1.5, { space: 2 }).moveTo(lx, y1).lineTo(gx, y1).lineWidth(0.7)
          .strokeOpacity(0.5).strokeColor(MUTED).stroke().undash().restore();
        doc.save().circle(gx, y1, 2.4).lineWidth(0.6).strokeColor(MUTED).stroke().restore();
      }
      doc.save().circle(lx, y1, 2.4).fillOpacity(0.55).fill(MUTED).restore();
    }
    doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED)
      .text(leftLabel.toUpperCase(), lx - 24, plot.y + h + 5, { width: 90, lineBreak: false })
      .text(rightLabel.toUpperCase(), rx - 45, plot.y + h + 5, { width: 90, align: 'center', lineBreak: false });
    // On its own line: the two labels sit 28 points apart, so side by side the
    // gutter's caption printed straight through "SECOND YEAR".
    const gone = pairs.filter((p) => p.toState !== 'measured').length;
    if (gone) {
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(`${gone} not on the next roster`, plot.x, plot.y + h + 15,
          { width: plot.w, align: 'right', lineBreak: false });
    }
  },

  /** Grouped or stacked columns, one group per season. */
  columns(k, { box, title, subtitle, groups, yMax, unit = '', stacked = false, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !groups?.length });
    if (!plot) return;
    const { doc } = k;
    // Whether anything is actually drawn. Every season hatched is a real
    // answer — "we have the roster and could not read it" — but the scale
    // printed beside it is not: `yMax` floors at 1 so a chart with no bars was
    // labelling its axis "1", which reads as a count of one.
    const anyBars = groups.some((g) => g.bars.some((b) => b.value != null));
    // 22pt reserved below the axis for the season label and its value, so a
    // column's own caption cannot land on the sentence after the chart.
    const h = plot.h - 24;
    const gw = plot.w / groups.length;
    doc.save().moveTo(plot.x, plot.y + h).lineTo(plot.x + plot.w, plot.y + h)
      .lineWidth(0.5).strokeColor(AXIS).stroke().restore();

    groups.forEach((g, gi) => {
      const gx = plot.x + gi * gw;
      const bars = g.bars.filter((b) => b.value != null);
      if (!bars.length) {
        // A season we could not read keeps its slot, hatched — a missing
        // column reads as a season that did not happen.
        doc.save().dash(1, { space: 2 }).rect(gx + gw * 0.18, plot.y + 4, gw * 0.64, h - 4)
          .lineWidth(0.5).strokeColor(LINE).stroke().undash().restore();
        doc.font('Helvetica-Oblique').fontSize(6).fillColor(MUTED)
          .text('not recorded', gx, plot.y + h / 2, { width: gw, align: 'center', lineBreak: false });
      } else if (stacked) {
        let acc = 0;
        for (const b of bars) {
          const bh = (b.value / yMax) * h;
          doc.save().rect(gx + gw * 0.2, plot.y + h - acc - bh, gw * 0.6, Math.max(0.5, bh - 1))
            .fill(b.color).restore();
          acc += bh;
        }
      } else {
        const bw = (gw * 0.62) / bars.length;
        bars.forEach((b, bi) => {
          const bh = (b.value / yMax) * h;
          doc.save().rect(gx + gw * 0.19 + bi * bw, plot.y + h - bh, bw - 1.5, Math.max(0.5, bh))
            .fill(b.color).restore();
        });
      }
      doc.font('Helvetica').fontSize(7).fillColor(MUTED)
        .text(g.label, gx, plot.y + h + 3, { width: gw, align: 'center', lineBreak: false });
      if (g.note) {
        doc.font('Helvetica-Bold').fontSize(7).fillColor(INK)
          .text(g.note, gx, plot.y + h + 11, { width: gw, align: 'center', lineBreak: false });
      }
    });
    if (anyBars) {
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(`${nice(yMax)}${unit}`, plot.x, plot.y - 1, { width: plot.w, align: 'right', lineBreak: false });
    }
  },

  /** Position down the side, season across the top, share in the cell. */
  heatGrid(k, { box, title, subtitle, rows, cols, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !rows?.length });
    if (!plot) return;
    const { doc } = k;
    const labelW = 78;
    const cw = (plot.w - labelW) / cols.length;
    const rh = Math.min(22, (plot.h - 12) / rows.length);

    cols.forEach((c, ci) => {
      doc.font('Helvetica').fontSize(7).fillColor(MUTED)
        .text(c, plot.x + labelW + ci * cw, plot.y, { width: cw, align: 'center', lineBreak: false });
    });
    rows.forEach((row, ri) => {
      const y = plot.y + 11 + ri * rh;
      doc.font('Helvetica').fontSize(7.5).fillColor(INK)
        .text(row.label, plot.x, y + rh / 2 - 4, { width: labelW - 6, lineBreak: false });
      row.cells.forEach((cell, ci) => {
        const x = plot.x + labelW + ci * cw;
        if (cell.value == null) {
          doc.save().dash(1, { space: 1.5 }).rect(x + 1, y + 1, cw - 3, rh - 3)
            .lineWidth(0.5).strokeColor(LINE).stroke().undash().restore();
          doc.font('Helvetica').fontSize(7).fillColor(MUTED)
            .text('—', x, y + rh / 2 - 4, { width: cw, align: 'center', lineBreak: false });
          return;
        }
        // A flat interpolation between two palette steps: no gradients, which
        // band in several viewers and print badly.
        const t = Math.max(0, Math.min(1, cell.value));
        const FROM = [237, 239, 243];
        const TO = [15, 42, 67];
        const fill = `#${FROM.map((c, i) => Math.round(c + (TO[i] - c) * t)
          .toString(16).padStart(2, '0')).join('')}`;
        doc.save().rect(x + 1, y + 1, cw - 3, rh - 3).fill(fill).restore();
        doc.font('Helvetica-Bold').fontSize(7).fillColor(t > 0.45 ? '#FFFFFF' : INK)
          .text(`${Math.round(cell.value * 100)}%`, x, y + rh / 2 - 6, { width: cw, align: 'center', lineBreak: false });
        // n in every cell: a 100% built on one player must look like one player.
        doc.font('Helvetica').fontSize(5.5).fillColor(t > 0.45 ? '#FFFFFF' : MUTED)
          .text(`n=${cell.n}`, x, y + rh / 2 + 2, { width: cw, align: 'center', lineBreak: false });
      });
    });
  },

  /**
   * The freshman ladder as it is actually made: the seasons behind each rung.
   *
   * A rung is two to four observations, and a median of 846 drawn from 710,
   * 890, 801 and 1,020 is a different object from one drawn from 40, 42 and
   * 1,600. Showing the contributing seasons as dots on the same axis as the
   * median is the whole point of the chart — the reader can see the spread
   * rather than being told about it.
   *
   * Seasons with nobody at a rank are simply absent. Nothing is drawn at zero.
   */
  dotLadder(k, { box, title, subtitle, rows, xMax, marker, poolLabel, unavailable, rowPitch = 30 }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !rows?.length });
    if (!plot) return;
    const { doc } = k;
    const labelW = 74;
    const valueW = 62;
    const left = plot.x + labelW;
    const w = plot.w - labelW - valueW;
    /**
     * `rowPitch` is opt-in, and 30 unless a caller asks — Phase 13D / §G.
     *
     * The programme's first-year ladder is the strongest visual in the report
     * and 30 held it to a 150-point band on a page with 600 points spare, so
     * that page asks for 40. Raising the cap for everybody instead grew the
     * ladder on the athlete's position page past the box its caller had sized,
     * and the key line printed over the heading beneath it — which the layout
     * guard caught.
     */
    const rowH = Math.min(rowPitch, (plot.h - 14) / rows.length);
    const xOf = (v) => left + Math.min(1, Math.max(0, v) / xMax) * w;

    if (marker != null && marker <= xMax) {
      const mx = xOf(marker);
      doc.save().dash(2, { space: 2 }).moveTo(mx, plot.y).lineTo(mx, plot.y + rows.length * rowH)
        .lineWidth(0.75).strokeColor(CLARET).stroke().undash().restore();
      doc.font('Helvetica').fontSize(6).fillColor(CLARET)
        .text(`${marker} — a starter’s season`, mx + 3, plot.y + rows.length * rowH + 2,
          { width: 110, lineBreak: false });
    }

    rows.forEach((r, i) => {
      const cy = plot.y + i * rowH + rowH / 2 - 2;
      doc.font('Helvetica').fontSize(7.5).fillColor(INK)
        .text(r.label, plot.x, cy - 3, { width: labelW - 6, lineBreak: false, ellipsis: true });

      // The pool's middle half, behind everything, as context rather than a
      // target. Drawn first so the programme's own dots sit on top of it.
      if (r.poolP25 != null && r.poolP75 != null) {
        doc.save().rect(xOf(r.poolP25), cy - 5, Math.max(1, xOf(r.poolP75) - xOf(r.poolP25)), 10)
          .fillOpacity(0.10).fill(MID).restore();
      }
      doc.save().moveTo(left, cy).lineTo(left + w, cy).lineWidth(0.4).strokeColor(LINE).stroke().restore();

      if (!r.comparable) {
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED)
          .text('the seasons are not comparable this far down', left + 4, cy - 3,
            { width: w - 8, lineBreak: false, ellipsis: true });
        return;
      }

      // The range the seasons actually spanned.
      if (r.low != null && r.high != null && r.high > r.low) {
        doc.save().moveTo(xOf(r.low), cy).lineTo(xOf(r.high), cy)
          .lineWidth(0.8).strokeColor(PALE).stroke().restore();
      }
      // Labelled in ascending order with alternating rows, and a label is
      // dropped where it would land on the one before it — two seasons a few
      // minutes apart printed "2223" the first time this was drawn.
      // Two rows of labels, each tracking its OWN last position. Tracking one
      // shared position and alternating tiers still let two labels on the same
      // tier land two points apart — the guard caught "’25" printed across
      // "’23" three times on one page.
      const sorted = [...(r.contributions ?? [])].sort((x, y2) => x.minutes - y2.minutes);
      const lastAt = [-Infinity, -Infinity];
      const LABEL_W = 11;
      sorted.forEach((c) => {
        const x = xOf(c.minutes);
        doc.save().circle(x, cy, 2.6).fillOpacity(0.55).fill(NAVY).restore();
        // Whichever row has more room, and if neither has enough the label is
        // dropped rather than stacked on top of another one.
        const tier = (x - lastAt[0] >= x - lastAt[1]) ? 0 : 1;
        if (x - lastAt[tier] < LABEL_W) return;
        doc.font('Helvetica').fontSize(5.2).fillColor(MUTED)
          .text(`’${String(c.season).slice(-2)}`, x - 7, cy + 5 + tier * 6,
            { width: 14, align: 'center', lineBreak: false });
        lastAt[tier] = x;
      });
      if (r.median != null) {
        doc.save().moveTo(xOf(r.median), cy - 7).lineTo(xOf(r.median), cy + 7)
          .lineWidth(1.6).strokeColor(INK).stroke().restore();
      }
      if (r.poolMedian != null) {
        doc.save().moveTo(xOf(r.poolMedian), cy - 7).lineTo(xOf(r.poolMedian), cy + 7)
          .lineWidth(1).strokeColor(MID).stroke().restore();
      }

      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK)
        .text(nice(r.median ?? 0), left + w + 6, cy - 6, { width: valueW - 8, lineBreak: false });
      doc.font('Helvetica').fontSize(6).fillColor(MUTED)
        .text(r.agreement === 'wide' ? `${nice(r.low)}–${nice(r.high)}` : `${r.n} season${r.n === 1 ? '' : 's'}`,
          left + w + 6, cy + 2, { width: valueW - 8, lineBreak: false, ellipsis: true });
    });

    // Clear of the second tier of season labels on the bottom rung, which
    // reaches rowH/2 + 11 below that row's centre line.
    const footY = plot.y + rows.length * rowH + 8;
    doc.font('Helvetica').fontSize(6).fillColor(MUTED)
      .text('0', left - 3, footY, { width: 16, lineBreak: false })
      .text(nice(xMax), left + w - 30, footY, { width: 30, align: 'right', lineBreak: false });
    const key = [`dots are seasons · bar is this programme's median`,
      poolLabel ? `pale band and light bar are ${poolLabel}` : null].filter(Boolean).join('   ·   ');
    doc.font('Helvetica').fontSize(6).fillColor(MUTED)
      .text(key, plot.x, footY + 8, { width: plot.w, lineBreak: false, ellipsis: true });
  },

  /**
   * When eligibility runs out across the squad now on campus.
   *
   * One lane per position, one dot per player at the year their eligibility
   * ends, sized by the minutes they are projected to play. Players with no
   * eligibility year cannot be placed and are counted beneath rather than
   * dropped — an absence that vanishes is an absence nobody accounts for.
   */
  /**
   * `counts` and `markerLabel` are opt-in, and only the athlete page opts in.
   *
   * The programme's squad-outlook timeline draws five lanes of a whole roster
   * and is frozen; this is the single-lane view of one position group, where
   * the athlete's entry year is the thing being read against. Everything below
   * that is gated on `counts` exists because that view has to survive
   * seventeen players in four columns: at Mercyhurst men's, four defenders
   * eligible through 2027 — two of them projected past a thousand minutes, so
   * drawn at nine points of radius against a ten-point pitch — merged into one
   * shape a reader could not count, and eight unprojected players at 2030
   * drew as 2pt marks at 18% opacity that a printer loses altogether.
   */
  eligibilityTimeline(k, { box, title, subtitle, lanes, years, marker, unplaceable, unavailable,
    counts = false, markerLabel = null }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !lanes?.length || !years?.length });
    if (!plot) return;
    const { doc } = k;
    const labelW = 74;
    const left = plot.x + labelW;
    // The axis stops a dot's radius short of the edge. The same defect the
    // scatter had: a player at the last year is drawn centred ON the axis end,
    // so half of them hung off the page as soon as the dots grew.
    const w = plot.w - labelW - 14;
    const top = plot.y + 6;
    // The cap scales with how many lanes there are. A single-lane timeline —
    // one position, on an athlete page — was drawn 26 points tall on a page
    // with four hundred points spare, which made a chart of eleven players
    // look like a footnote.
    // Ten points of the single-lane cap pay for the count row under it, so the
    // chart costs the page exactly what it did before 13G added the counts —
    // a 12-point band on this page is a whole block at the bottom of it, and
    // at California it was the table's own footnote.
    const laneH = Math.min(lanes.length === 1 ? (counts ? 74 : 84) : 30,
      (plot.h - 32) / lanes.length);
    const step = years.length > 1 ? w / (years.length - 1) : 0;
    const xOf = (year) => left + years.indexOf(year) * step;
    const maxMin = Math.max(1, ...lanes.flatMap((l) => l.players.map((p) => p.projectedMinutes ?? 0)));

    years.forEach((y) => {
      // The entry year names itself, in the colour that means entry year on
      // this page. A separate "YOUR ENTRY YEAR" caption beside the line cost a
      // row of height the chart did not have and printed straight through the
      // year label it was pointing at.
      const isEntry = markerLabel && marker != null && y === marker;
      doc.font(isEntry ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.5)
        .fillColor(isEntry ? CLARET : MUTED)
        .text(String(y), xOf(y) - 12, top, { width: 24, align: 'center', lineBreak: false });
      doc.save().moveTo(xOf(y), top + 10).lineTo(xOf(y), top + 10 + lanes.length * laneH)
        .lineWidth(0.4).strokeColor(LINE).stroke().restore();
    });
    if (marker != null && years.includes(marker)) {
      doc.save().dash(2, { space: 2 }).moveTo(xOf(marker), top + 8)
        .lineTo(xOf(marker), top + 12 + lanes.length * laneH)
        .lineWidth(1).strokeColor(CLARET).stroke().undash().restore();
    }

    lanes.forEach((lane, i) => {
      const cy = top + 10 + i * laneH + laneH / 2;
      doc.font('Helvetica').fontSize(7).fillColor(INK)
        .text(lane.label, plot.x, cy - 3, { width: labelW - 6, lineBreak: false, ellipsis: true });
      // Grouped by year first, then spread symmetrically about the lane's
      // centre line. Offsetting from a running counter placed a year holding
      // one player at the top of its lane and a year holding five across the
      // middle of it, so the clusters did not share a baseline.
      const byYear = new Map();
      for (const p of lane.players) {
        if (p.eligibleTo == null || !years.includes(p.eligibleTo)) continue;
        if (!byYear.has(p.eligibleTo)) byYear.set(p.eligibleTo, []);
        byYear.get(p.eligibleTo).push(p);
      }
      /**
       * The spread is bounded by the lane, not only by taste — 13D.1 / §7A.
       *
       * At a fixed pitch a year holding 21 players without a projection ran
       * ±50 points out of a 30-point lane and drew its dots through the lane
       * below and the key beneath the chart. The group is fitted to the lane
       * instead: small groups keep the pitch they had, and a large one packs
       * until its dots touch. Overlapping hollow dots are honest — they are 21
       * identical marks, and the count beside them is in the table.
       */
      const biggest = Math.max(1, ...[...byYear.values()].map((g) => g.length));
      const spread = Math.min(11, laneH / 6, (laneH - 8) / Math.max(1, biggest - 1));
      // A dot may not be wider than the pitch it is stacked at. Sized off the
      // minutes alone, the two biggest dots in a year overlapped by seven
      // points and the column became one blob; the count under the axis is
      // then the only way to read it, which is a chart that needs a caption to
      // be a chart. The AREA still carries the minutes — it is the ceiling that
      // moves, not the encoding.
      const rMax = counts ? Math.max(3.5, spread / 2 - 0.5) : Infinity;
      for (const [year, group] of byYear) {
        group.forEach((p, i) => {
          const off = (i - (group.length - 1) / 2) * spread;
          const r = Math.min(rMax, 2 + Math.sqrt(Math.max(0, p.projectedMinutes ?? 0) / maxMin)
            * (laneH > 40 ? 7 : 4));
          if (p.projectedMinutes == null && counts) {
            // An open ring rather than a faint disc: a player with no
            // projection is present on the roster and must be as visible as
            // one with a projection, without being drawn as a quantity.
            doc.save().circle(xOf(year), cy + off, 2.6).lineWidth(0.7)
              .strokeColor(MUTED).stroke().restore();
            return;
          }
          doc.save().fillOpacity(p.projectedMinutes == null ? 0.18 : 0.6)
            .circle(xOf(year), cy + off, p.projectedMinutes == null ? 2 : r)
            .fill(p.projectedMinutes == null ? MUTED : NAVY).restore();
        });
      }
      // How many are in each column, under the axis. Not a second encoding of
      // the dots — the answer to the question a packed column stops answering.
      if (counts) {
        for (const [year, group] of byYear) {
          doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED)
            .text(String(group.length), xOf(year) - 12, top + 14 + lanes.length * laneH,
              { width: 24, align: 'center', lineBreak: false });
        }
      }
    });

    // The count row, where there is one, sits between the lane and the key.
    const footY = top + 12 + lanes.length * laneH + (counts ? 12 : 0);
    const key = [counts ? 'the figure under each year is how many' : null,
      'dot size is projected minutes', 'hollow dots carry no projection',
      unplaceable ? `${unplaceable} with no eligibility year, not placed` : null]
      .filter(Boolean).join('   ·   ');
    doc.font('Helvetica').fontSize(6).fillColor(MUTED)
      .text(key, plot.x, footY, { width: plot.w, lineBreak: false, ellipsis: true });
  },

  /**
   * Several stacked bars sharing one axis, one legend and one label gutter.
   *
   * Built for the comparison the replacing-minutes page exists to make. Two
   * `k.stacked` calls put the programme and the pool a paragraph apart, each
   * with its own repeated legend, and the segments did not line up — so the
   * one question the page asks, "how does this mix differ from a comparable
   * programme's", took real work to answer. Stacked on a shared axis the
   * difference is the first thing visible.
   *
   * The bars are thick enough to carry their percentages inside them, and a
   * segment too narrow for its own label simply goes unlabelled: the legend
   * beneath names the parts once, in order, so nothing is lost.
   */
  stackedRows(k, { box, title, subtitle, rows, keys, labelW = 150, barH = 30, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !rows?.length });
    if (!plot) return;
    const { doc } = k;
    const trackW = plot.w - labelW;
    let y = plot.y + 2;

    for (const row of rows) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK)
        .text(fitText(doc, row.label, labelW - 12), plot.x, y + barH / 2 - 8,
          { width: labelW - 12, lineBreak: false });
      if (row.note) {
        doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
          .text(fitText(doc, row.note, labelW - 12), plot.x, y + barH / 2 + 2,
            { width: labelW - 12, lineBreak: false });
      }
      if (row.values == null) {
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED)
          .text(row.unavailable || 'not enough on file', plot.x + labelW, y + barH / 2 - 4,
            { width: trackW, lineBreak: false, ellipsis: true });
        y += barH + 12;
        continue;
      }
      const total = keys.reduce((sum, kk) => sum + (row.values[kk.key] ?? 0), 0) || 100;
      // A row may occupy a SPAN of the track rather than all of it, so a bar
      // that divides one segment of the bar above it can be drawn under that
      // segment and nowhere else. Without this the second bar ran the full
      // width and read as another division of the whole population — which is
      // the one misreading the departure pages exist to prevent.
      const from = row.trackFrom ?? 0;
      const to = row.trackTo ?? 1;
      const span = Math.max(0, to - from) * trackW;
      let cx = plot.x + labelW + from * trackW;
      if (from > 0) {
        // A hairline from the parent segment's edge down to this bar, so the
        // relationship is drawn rather than only described underneath.
        doc.save().moveTo(plot.x + labelW + from * trackW, y - 6)
          .lineTo(cx, y).lineWidth(0.5).strokeColor(LINE).stroke().restore();
      }
      for (const kk of keys) {
        const v = row.values[kk.key] ?? 0;
        const segW = (v / total) * span;
        doc.save().rect(cx, y, Math.max(0, segW - 1.5), barH).fill(kk.color).restore();
        if (segW > 34) {
          doc.font('Helvetica-Bold').fontSize(9).fillColor(kk.dark ? INK : '#FFFFFF')
            .text(`${Math.round(v)}%`, cx + 6, y + barH / 2 - 5, { width: segW - 10, lineBreak: false });
        }
        cx += segW;
      }
      y += barH + 12;
    }

    // The legend wraps. It used to lay out in one row and walk off the right
    // edge as soon as a label carried its own count — "not traceable (12)" was
    // the one the layout guard caught, 38 points into the margin.
    // The legend runs the full width of the track, even under a row that only
    // occupies part of it. Started under the row's own span it had 13% of the
    // track to fit three keys into and printed "traced t…", "evidenc…", "no
    // trac…". The BAR carries the nesting; the legend is a key.
    const legendX = plot.x + labelW;
    let lx = legendX;
    let ly = y + 1;
    const right = plot.x + plot.w;
    doc.font('Helvetica').fontSize(7.5);
    for (const kk of keys) {
      const wNeeded = 14 + doc.widthOfString(kk.label) + 16;
      if (lx > legendX && lx + wNeeded > right) {
        lx = legendX;
        ly += 11;
      }
      doc.save().rect(lx, ly, 8, 8).fill(kk.color).restore();
      doc.font('Helvetica').fontSize(7.5).fillColor(INK)
        .text(kk.label, lx + 12, ly + 0.5, { width: right - lx - 12, lineBreak: false, ellipsis: true });
      lx += wNeeded;
    }
  },

  /**
   * One column per year, each carrying its own denominator.
   *
   * The whole point of this chart is that the denominators SHRINK to the
   * right: a programme's year-three figure is drawn from the players who have
   * had a year three at all, and that cohort is a fraction of the year-one
   * one. Printing four percentages in a row without their counts invites a
   * comparison between a rate over 42 players and a rate over 12.
   *
   * A year whose share could not be made prints the reason where the
   * percentage would be. Never a zero — a 0% here would say "nobody develops",
   * and it has meant "this programme publishes no minutes" often enough that
   * the guard is worth the space.
   */
  yearSteps(k, { box, title, subtitle, years, poolLabel, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !years?.length });
    if (!plot) return;
    const { doc } = k;
    const cw = plot.w / years.length;

    years.forEach((yr, i) => {
      const x = plot.x + i * cw;
      const inner = cw - 12;
      doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(MUTED)
        .text(yr.label.toUpperCase(), x, plot.y,
          { width: inner, characterSpacing: TYPE.label.spacing, lineBreak: false, ellipsis: true });

      if (yr.share == null) {
        // Under the label, and close to it. Forty points lower it read as a
        // chart that had failed to draw; directly beneath the label it reads
        // as the column's answer, which is what it is.
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
          .text(yr.unavailable || 'not enough on file', x, plot.y + 16, { width: inner });
      } else {
        /**
         * 19 point, not 26 — Phase 13D / §R.
         *
         * Four columns of 26-point numerals were the loudest ink in the report:
         * 37% larger than the page title above them, so a reader met the
         * progression before the conclusion the page had just stated. 19 is the
         * title's own size, which makes it the largest a figure inside a chart
         * may be and leaves the title as the page's first voice.
         */
        doc.font('Helvetica-Bold').fontSize(19).fillColor(INK)
          .text(`${Math.round(yr.share * 100)}%`, x, plot.y + 13, { width: inner, lineBreak: false });
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
          .text(yr.caption || '', x, plot.y + 36, { width: inner });
      }

      // The denominator, always, whether or not a share could be quoted.
      doc.font('Helvetica').fontSize(8).fillColor(INK)
        .text(yr.count ?? '—', x, plot.y + 52, { width: inner, lineBreak: false, ellipsis: true });

      // The pool, as a track under the column rather than a second number
      // competing with the first.
      const trackY = plot.y + 68;
      const trackW = inner;
      doc.save().rect(x, trackY, trackW, 6).fill('#EDEFF3').restore();
      if (yr.share != null) {
        doc.save().rect(x, trackY, Math.max(1.5, Math.min(1, yr.share) * trackW), 6)
          .fill(NAVY).restore();
      }
      if (yr.pool != null) {
        const px = x + Math.min(1, yr.pool) * trackW;
        doc.save().moveTo(px, trackY - 2).lineTo(px, trackY + 8)
          .lineWidth(1).strokeColor(MID).stroke().restore();
        doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
          .text(`pool ${Math.round(yr.pool * 100)}%`, x, trackY + 10,
            { width: inner, lineBreak: false, ellipsis: true });
      } else {
        doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
          .text('no pool figure', x, trackY + 10, { width: inner, lineBreak: false, ellipsis: true });
      }
    });

    if (poolLabel) {
      // Inside the box. Drawn eight points lower it landed on the sentence
      // after the chart, which the collision guard reported as ink over ink.
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(poolLabel, plot.x, plot.y + 90, { width: plot.w, lineBreak: false, ellipsis: true });
    }
  },

  /**
   * A handful of individual careers, one line each.
   *
   * Deliberately capped by the caller. Thirty lines on one axis is a texture,
   * not a chart, and the reader cannot follow any single player through it —
   * so the model picks a manageable cohort by a stated rule and this draws
   * exactly those, labelled, with the starter line behind them.
   *
   * Only seasons with published minutes are plotted. A gap year leaves a gap.
   */
  trajectories(k, { box, title, subtitle, lines, max, marker, years, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !lines?.length });
    if (!plot) return;
    const { doc } = k;
    const labelW = 92;
    const axisW = 30;
    const left = plot.x + axisW;
    const w = plot.w - axisW - labelW;
    const h = plot.h - 20;
    const step = years > 1 ? w / (years - 1) : 0;
    const xOf = (year) => left + (year - 1) * step;
    const yOf = (v) => plot.y + h - Math.min(1, v / max) * h;

    for (const t of [0, max / 2, max]) {
      doc.save().moveTo(left, yOf(t)).lineTo(left + w, yOf(t))
        .lineWidth(0.3).strokeColor('#EDEFF3').stroke().restore();
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(nice(t), plot.x, yOf(t) - 3.5, { width: axisW - 4, align: 'right', lineBreak: false });
    }
    if (marker != null && marker <= max) {
      doc.save().dash(2, { space: 2 }).moveTo(left, yOf(marker)).lineTo(left + w, yOf(marker))
        .lineWidth(0.75).strokeColor(CLARET).stroke().undash().restore();
      doc.font('Helvetica').fontSize(6).fillColor(CLARET)
        .text(`${nice(marker)} — a starter’s season`, left + 3, yOf(marker) - 8,
          { width: 130, lineBreak: false });
    }
    for (let yr = 1; yr <= years; yr += 1) {
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(`year ${yr}`, xOf(yr) - 16, plot.y + h + 5, { width: 32, align: 'center', lineBreak: false });
    }

    // Two passes. The lines first, then the names — because the names have to
    // be spread apart to be legible and a name nudged down one at a time can
    // walk out of the bottom of the chart. The first version did exactly that
    // and printed a player's name through the sentence under the chart.
    const ends = [];
    for (const line of lines) {
      const pts = line.points.filter((p) => p.minutes != null && p.year <= years);
      if (!pts.length) continue;
      for (let i = 1; i < pts.length; i += 1) {
        doc.save().moveTo(xOf(pts[i - 1].year), yOf(pts[i - 1].minutes))
          .lineTo(xOf(pts[i].year), yOf(pts[i].minutes))
          .lineWidth(1).strokeOpacity(0.6).strokeColor(NAVY).stroke().restore();
      }
      for (const p of pts) {
        doc.save().circle(xOf(p.year), yOf(p.minutes), 1.9).fillOpacity(0.7).fill(NAVY).restore();
      }
      ends.push({ name: line.name, y: yOf(pts[pts.length - 1].minutes) - 3.5 });
    }

    // Placed top-down with a minimum gap, then corrected bottom-up.
    //
    // The downward pass alone is not enough: several players finishing on
    // similar minutes push the stack past the foot of the chart, where a naive
    // clamp lands three names on one line. The second pass lifts anything that
    // reached the floor back up through the stack, which is why it runs in
    // reverse and compares against the row below it.
    const GAP = Math.min(9.5, ends.length > 1 ? (h - 9.5) / (ends.length - 1) : 9.5);
    const top = plot.y;
    const bottom = plot.y + h - 9.5;
    ends.sort((a, b) => a.y - b.y);
    let floor = top;
    for (const e of ends) {
      e.ly = Math.max(e.y, floor);
      floor = e.ly + GAP;
    }
    let ceiling = bottom;
    for (let i = ends.length - 1; i >= 0; i -= 1) {
      ends[i].ly = Math.max(top, Math.min(ends[i].ly, ceiling));
      ceiling = ends[i].ly - GAP;
    }
    for (const e of ends) {
      doc.font('Helvetica').fontSize(6.5).fillColor(INK)
        .text(fitText(doc, e.name, labelW - 8), left + w + 5, e.ly,
          { width: labelW - 5, lineBreak: false });
    }
  },

  /** Two bars per row, for here-versus-the-pool comparisons. */
  paired(k, { box, title, subtitle, rows, aLabel, bLabel, max, unit = '', unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !rows?.length });
    if (!plot) return;
    const { doc } = k;
    const labelW = 148;
    const trackW = plot.w - labelW - 64;
    const rh = Math.min(38, plot.h / rows.length);
    const paired = rows.some((r) => r.b != null);
    const barH = paired ? 8 : 14;
    rows.forEach((row, i) => {
      const y = plot.y + i * rh;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
        .text(fitText(doc, row.label, labelW - 8), plot.x, y + barH / 2 - 1,
          { width: labelW - 8, lineBreak: false });
      [[row.a, NAVY, 0], [row.b, PALE, barH + 2]].forEach(([v, colour, dy]) => {
        if (v == null) return;
        doc.save().rect(plot.x + labelW, y + 2 + dy, Math.max(1, (v / max) * trackW), barH)
          .fill(colour).restore();
      });
      const txt = [row.a == null ? null : nice(row.a), row.b == null ? null : nice(row.b)]
        .filter(Boolean).join('  ·  ');
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
        .text(`${txt}${unit}`, plot.x + labelW + trackW + 8, y + barH / 2 - 3,
          { width: 56, lineBreak: false });
    });
    const legend = [aLabel, bLabel].filter(Boolean).join('  ·  ');
    if (legend) {
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(legend, plot.x, plot.y + rows.length * rh + 1, { width: plot.w, lineBreak: false });
    }
  },

  /**
   * Grouped bars, each carrying its own written caption.
   *
   * `paired` needs a legend to say which of its two bars is which, and it
   * prints the two values together as "42 · 11%" — which is the least legible
   * thing this file draws when the two numbers measure DIFFERENT quantities.
   * Here every bar names itself on the row it is drawn on, so the reader never
   * has to look away from the row to know what they are reading.
   *
   * A bar is drawn only where the caller passes a value. A group whose second
   * quantity could not be measured is passed with one bar and draws one bar:
   * a zero-length bar for an unmeasured share is the false-zero defect this
   * codebase keeps finding, and it is worse here than anywhere because the bar
   * beside it is real.
   */
  splitBars(k, { box, title, subtitle, groups, max, unit = '', unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !groups?.length });
    if (!plot) return;
    const { doc } = k;
    // Sized to the widest label actually passed, within bounds. A fixed column
    // ellipsised "Graduate or fifth year" to "Graduate or fifth …", and this
    // primitive's labels are the whole point of it — a clipped one is not a
    // long name being handled gracefully, it is the caption failing to do the
    // job the legend used to do badly.
    doc.font('Helvetica-Bold').fontSize(8.5);
    const labelW = Math.min(150, Math.max(88,
      ...groups.map((g) => doc.widthOfString(String(g.label)) + 8)));
    const captionW = 44;
    const valueW = 40;
    const trackW = Math.max(40, plot.w - labelW - captionW - valueW - 10);
    const rowH = 13;
    const barH = 8;
    const scale = Math.max(1, max);
    let y = plot.y;
    for (const g of groups) {
      const bars = (g.bars ?? []).filter((b) => b.value != null);
      if (!bars.length) continue;
      const blockH = bars.length * rowH;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
        .text(fitText(doc, g.label, labelW - 6), plot.x, y + blockH / 2 - 5,
          { width: labelW - 6, lineBreak: false });
      bars.forEach((b, i) => {
        const ry = y + i * rowH;
        doc.font('Helvetica').fontSize(7).fillColor(MUTED)
          .text(b.caption.toUpperCase(), plot.x + labelW, ry + 1.5,
            { width: captionW - 4, characterSpacing: 0.3, lineBreak: false });
        doc.save().rect(plot.x + labelW + captionW, ry, Math.max(1, (b.value / scale) * trackW), barH)
          .fill(b.color ?? NAVY).restore();
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
          .text(`${nice(b.value)}${unit}`, plot.x + labelW + captionW + trackW + 6, ry - 0.5,
            { width: valueW, lineBreak: false });
      });
      y += blockH + 6;
    }
  },
};

// Every `doc.text` inside a chart moves the flow cursor, so a chart that draws
// its axis labels leaves `doc.y` wherever the last label landed rather than
// below the box it was given. The next `room()` then sees a cursor near the
// page bottom and adds a page — which is how one report grew fourteen blank
// pages carrying nothing but a footer. Charts draw in absolute coordinates;
// the cursor is restored for them, once, here.
for (const [name, fn] of Object.entries(charts)) {
  charts[name] = (k, opts) => {
    const out = fn(k, opts);
    if (opts?.box) k.doc.y = opts.box.y + opts.box.h;
    return out;
  };
}
