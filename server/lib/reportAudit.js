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
  return { violations: [], drawn: 0, pages: 0 };
}

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
      record('text', { left, right, top: startY, bottom: startY + height }, { text: clip(str) });
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
