/**
 * A rendering guard: catches content drawn outside the page's content box.
 *
 * Three phases of this report shipped layout defects that only a human looking
 * at a raster could see — a chart key sitting on the footer, a minutes line
 * wrapping onto the sub-line beneath it, a column header clipped to "STA…".
 * Every one of them is the same shape: something was drawn wider or lower than
 * the box it was given. That is measurable at draw time, so it should not need
 * an eye.
 *
 * This is not a PDF validator. It instruments the drawing calls THIS report
 * makes — `text`, `rect`, `roundedRect`, `circle` — and records anything whose
 * bounding box leaves the content area. It knows nothing about the page's
 * contents and cannot tell whether a sentence is true; it can only tell
 * whether it fits.
 *
 * Two deliberate accommodations, both explicit rather than inferred:
 *
 *   - The bounds for a page are snapshotted when the page is CREATED, not when
 *     something is drawn on it. `footer()` drops `page.margins.bottom` to zero
 *     for the duration of its own write, and reading the margin at draw time
 *     would move the floor out from under the check exactly where the check
 *     matters most.
 *
 *   - Drawing that is genuinely meant to sit outside the content box — the
 *     footer, and anything else that must reach into a reserved band — calls
 *     `reserved()` around itself. Intent is declared, never guessed at from
 *     position, because "it is near the footer so it is probably the footer"
 *     is precisely the reasoning that would let a real overflow through.
 *
 * The top bleed is the one soft edge: the masthead kicker is drawn above the
 * top margin by design across every page of the report, so the band above the
 * margin is part of the layout rather than an escape from it.
 */

/** How far above the top margin the masthead kicker is allowed to reach. */
const TOP_BLEED = 22;

/** How far left of the left margin a rule or marker may reach. */
const LEFT_BLEED = 6;

/** Sub-point differences are rounding, not overflow. */
const TOLERANCE = 0.75;

const clip = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
};

/**
 * A collector to hand to `render()`.
 *
 * Kept as a plain object the caller owns so that `render` can keep returning a
 * Buffer: a test wanting the violations passes one in and reads it afterwards,
 * and nothing about the production call path changes shape.
 */
export function createAudit() {
  return { violations: [], clipped: [], unencodable: [], collisions: [], drawn: 0, pages: 0 };
}

/**
 * Every character the standard fourteen can draw: WinAnsi (CP1252).
 *
 * Anything outside it is not drawn as itself — pdfkit returns the code point
 * as a glyph selector and the viewer reads its low byte — so the page carries a
 * character nobody wrote. Three phases of this report shipped exactly that, an
 * arrow and a not-equals each time.
 *
 * The set lives in reportFonts.js since 13D.1, beside the fallback that uses
 * it, and is re-exported here because this module's own name for it is the one
 * the tests and the invariants have always used.
 */
import { encodableBy } from './reportFonts.js';

export { winAnsi as encodable } from './reportFonts.js';

function snapshot(page) {
  return {
    top: page.margins.top - TOP_BLEED,
    bottom: page.height - page.margins.bottom,
    left: page.margins.left - LEFT_BLEED,
    right: page.width - page.margins.right,
  };
}

/**
 * Patch a document's drawing calls to record out-of-bounds content.
 *
 * Returns the audit it was given. Attaches `doc.__audit` so that `reserved()`
 * can find it from anywhere in the drawing code without threading it through
 * every function signature.
 */
export function attachAudit(doc, audit) {
  const pages = [snapshot(doc.page)];
  let index = 0;
  let suspended = 0;

  const bounds = () => pages[index] ?? pages[pages.length - 1];

  const record = (kind, box, detail) => {
    if (suspended) return;
    const b = bounds();
    if (!b) return;
    const edges = [];
    if (box.bottom > b.bottom + TOLERANCE) edges.push('below');
    if (box.top < b.top - TOLERANCE) edges.push('above');
    if (box.left < b.left - TOLERANCE) edges.push('left');
    if (box.right > b.right + TOLERANCE) edges.push('right');
    if (!edges.length) return;
    audit.violations.push({
      page: index + 1,
      kind,
      edges,
      ...detail,
      box: {
        left: Math.round(box.left * 10) / 10,
        top: Math.round(box.top * 10) / 10,
        right: Math.round(box.right * 10) / 10,
        bottom: Math.round(box.bottom * 10) / 10,
      },
      limits: b,
    });
  };

  const origAddPage = doc.addPage.bind(doc);
  // ink is kept for the whole document; entries carry their page.
  doc.addPage = (...args) => {
    const out = origAddPage(...args);
    index = pages.length;
    pages.push(snapshot(doc.page));
    audit.pages = pages.length;
    return out;
  };

  const origSwitch = doc.switchToPage.bind(doc);
  doc.switchToPage = (n) => {
    const out = origSwitch(n);
    if (typeof n === 'number') index = n;
    return out;
  };

  /**
   * Text drawn on top of other text.
   *
   * The third distinct defect class this phase, after overflow and clipping,
   * and the one neither of the others can see: a refusal sized for two columns
   * and drawn from column one printed straight through the heading beside it,
   * entirely inside the content box and entirely inside its own declared
   * width.
   *
   * Compared as INK rather than as boxes. A `doc.text` with a generous `width`
   * and three words in it occupies three words' worth of page, and treating
   * its whole box as occupied would flag most of the report. Small overlaps
   * are ignored too: rounded glyph edges and a half-point of leading are not
   * a collision.
   */
  const ink = [];
  const OVERLAP = 2;

  const collide = (box, text) => {
    for (const prior of ink) {
      if (prior.page !== index) continue;
      const w = Math.min(prior.right, box.right) - Math.max(prior.left, box.left);
      const h = Math.min(prior.bottom, box.bottom) - Math.max(prior.top, box.top);
      if (w > OVERLAP && h > OVERLAP) {
        audit.collisions.push({
          page: index + 1,
          text,
          over: prior.text,
          overlap: { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 },
        });
        return;
      }
    }
  };

  const origText = doc.text.bind(doc);
  doc.text = (text, x, y, options) => {
    // pdfkit accepts (text, options) as well as (text, x, y, options).
    let ox = x;
    let oy = y;
    let opts = options;
    if (typeof x === 'object' && x !== null) { opts = x; ox = undefined; oy = undefined; }
    opts = opts || {};

    const str = String(text ?? '');
    if (!suspended && str.trim()) {
      const startX = typeof ox === 'number' ? ox : doc.x;
      const startY = typeof oy === 'number' ? oy : doc.y;
      const width = opts.width
        ?? (doc.page.width - doc.page.margins.right - startX);

      let left = startX;
      let right = startX + width;
      let height;
      if (opts.lineBreak === false) {
        // The drawn width is the true one and may exceed the box it was given
        // — which is the whole point of measuring it.
        const w = doc.widthOfString(str, opts);
        height = doc.currentLineHeight(true);
        if (opts.align === 'right') { left = startX + width - w; right = startX + width; }
        else if (opts.align === 'center') { left = startX + (width - w) / 2; right = left + w; }
        else { right = startX + w; }
      } else {
        // Wrapped text never exceeds its width, so only the box and the height
        // it grows to are in question.
        height = doc.heightOfString(str, { width, ...opts });
        if (opts.height != null) height = Math.min(height, opts.height);
      }
      const box = { left, right, top: startY, bottom: startY + height };
      record('text', box, { text: clip(str) });
      // Measured to the ink, not to the declared width, and inset so that
      // touching baselines are not a collision.
      const inkW = opts.lineBreak === false
        ? right - left
        : Math.min(right - left, doc.widthOfString(str, opts));
      const glyph = {
        page: index,
        text: clip(str),
        left: left + 1,
        right: left + Math.max(0, inkW - 1),
        top: startY + 1,
        bottom: startY + Math.max(0, height - 1),
      };
      if (glyph.right > glyph.left) {
        collide(glyph, clip(str));
        ink.push(glyph);
      }
      /**
       * WHAT THE FONT IN USE CAN DRAW, not what Helvetica can draw.
       *
       * This asked WinAnsi and nothing else, which was right while every face
       * in the report was one of the standard fourteen. Since 13D.1 a string
       * outside that set is drawn in an embedded face instead, and a character
       * that face holds is on the page as itself — so reporting it would be
       * reporting a defect that is not there. `encodableBy` asks whichever
       * font is actually set, which is the only answer true of both the page
       * and the extracted text.
       *
       * What is drawn, not what was handed in: the composing and fallback
       * layers sit above this one, so a decomposed name has already been made
       * whole and the face has already been switched by now.
       */
      const out = [...str].filter((ch) => !encodableBy(doc, ch));
      if (out.length) {
        audit.unencodable.push({ page: index + 1, text: clip(str), characters: [...new Set(out)] });
      }
      audit.drawn += 1;
    }
    return origText(text, x, y, options);
  };

  const rectLike = (name) => {
    const orig = doc[name].bind(doc);
    doc[name] = (rx, ry, rw, rh, ...rest) => {
      record(name, { left: rx, right: rx + rw, top: ry, bottom: ry + rh }, {});
      return orig(rx, ry, rw, rh, ...rest);
    };
  };
  rectLike('rect');
  rectLike('roundedRect');

  const origCircle = doc.circle.bind(doc);
  doc.circle = (cx, cy, r) => {
    record('circle', { left: cx - r, right: cx + r, top: cy - r, bottom: cy + r }, {});
    return origCircle(cx, cy, r);
  };

  doc.__audit = {
    reserved(fn) {
      suspended += 1;
      try { return fn(); } finally { suspended -= 1; }
    },
    /**
     * A column heading that did not fit its column.
     *
     * A truncated data cell is expected — names are as long as they are. A
     * truncated HEADING is always a layout fault: the reader is left guessing
     * what "RETURNING S…" measures, and the fix is column width or a shorter
     * label, never an ellipsis.
     */
    clip(label, fitted, width) {
      if (!suspended) audit.clipped.push({ page: index + 1, label, fitted, width: Math.round(width) });
    },
  };

  audit.pages = pages.length;
  return audit;
}

/**
 * Draw something that is intentionally outside the content box.
 *
 * A no-op when nothing is auditing, so the production path pays nothing for
 * it. Used by `footer()`, which writes into the bottom margin on purpose.
 */
export function reserved(doc, fn) {
  return doc.__audit ? doc.__audit.reserved(fn) : fn();
}

/** A human-readable listing, for a test failure message. */
export function describeViolations(violations, limit = 12) {
  return violations.slice(0, limit).map((v) => {
    const what = v.text ? `"${v.text}"` : v.kind;
    return `p${v.page} ${v.edges.join('+')}: ${what} `
      + `[${v.box.left}, ${v.box.top} → ${v.box.right}, ${v.box.bottom}] `
      + `outside [${Math.round(v.limits.left)}, ${Math.round(v.limits.top)} → `
      + `${Math.round(v.limits.right)}, ${Math.round(v.limits.bottom)}]`;
  }).join('\n');
}
