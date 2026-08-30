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
export function fitText(doc, text, width) {
  const str = String(text ?? '');
  if (doc.widthOfString(str) <= width) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(`${str.slice(0, mid)}…`) <= width) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? `${str.slice(0, lo)}…` : '';
}

export function kit(doc) {
  const api = {
    doc,
    y() { return doc.y; },
    gap(n = 10) { doc.y += n; return api; },

    room(height) {
      if (doc.y + height > doc.page.height - M - 24) doc.addPage();
      return api;
    },

    title(text) {
      api.room(40);
      doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(text, M, doc.y, { width: W });
      return api.gap(6);
    },
    heading(text) {
      api.room(46);
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor(CLARET)
        .text(text.toUpperCase(), M, doc.y, { width: W, characterSpacing: 0.8 });
      doc.moveTo(M, doc.y + 3).lineTo(M + W, doc.y + 3).lineWidth(0.75).strokeColor(LINE).stroke();
      return api.gap(12);
    },
    body(text, opts = {}) {
      api.room(24);
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5)
        .fillColor(opts.color || INK).text(text, M, doc.y, { width: opts.width || W, ...opts });
      return api.gap(6);
    },
    note(text) {
      api.room(20);
      doc.font('Helvetica').fontSize(8.8).fillColor(MUTED).text(text, M, doc.y, { width: W });
      return api.gap(6);
    },

    /** A framed statement — used for the one caveat that must not be missed. */
    box(text, { color = CLARET } = {}) {
      const h = doc.font('Helvetica').fontSize(9.5).heightOfString(text, { width: W - 24 }) + 20;
      api.room(h + 8);
      const top = doc.y;
      doc.save().rect(M, top, W, h).fillOpacity(0.05).fill(color).restore();
      doc.save().rect(M, top, 3, h).fill(color).restore();
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(text, M + 14, top + 10, { width: W - 24 });
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
      for (const part of parts) {
        const w = (part.v / total) * W;
        doc.save().rect(x, barTop, Math.max(0, w - 2), 15).fill(part.c).restore();
        if (w > 46) {
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(part.c === PALE ? INK : '#FFFFFF')
            .text(`${Math.round(part.v)}% ${part.t}`, x + 4, barTop + 4.5, { width: w - 8, ellipsis: true });
        }
        x += w;
      }
      doc.y = barTop + 15;
      api.gap(3);
      // A segment under about 46pt has no room for its own label, so the key
      // has to exist somewhere.
      const legend = parts.map((part) => `${Math.round(part.v)}% ${part.t}`).join('   ·   ');
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(legend, M, doc.y, { width: W });
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
        api.room(16);
        const top = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, M, top, { width: 150 });
        doc.font('Helvetica').fontSize(9).fillColor(INK).text(v, M + 158, top, { width: W - 158 });
        doc.y = Math.max(doc.y, top + 13);
      }
      return api.gap(8);
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
     */
    table({ columns, rows, caption = null, note = null, rowHeight = 13, highlight = null }) {
      const widths = columns.map((c) => c.width * W);
      const xOf = (i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0);

      const header = () => {
        api.room(rowHeight + 8);
        const top = doc.y;
        columns.forEach((c, i) => {
          doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED);
          doc.text(fitText(doc, String(c.label).toUpperCase(), widths[i] - 6), xOf(i), top, {
            width: widths[i] - 6, align: c.align || 'left', lineBreak: false,
          });
        });
        doc.moveTo(M, top + 10).lineTo(M + W, top + 10).lineWidth(0.75).strokeColor(INK).stroke();
        doc.y = top + 14;
      };

      if (caption) {
        api.room(16);
        doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(caption, M, doc.y, { width: W });
        api.gap(4);
      }
      header();

      let striped = 0;
      for (const row of rows) {
        // A group heading keeps its rows with it: reserving two rows' worth
        // stops a heading stranding itself at the foot of a page.
        if (row.group) {
          const before = doc.bufferedPageRange().count;
          api.room(rowHeight * 2 + 10);
          if (doc.bufferedPageRange().count > before) header();
          doc.y += 4;
          doc.font('Helvetica-Bold').fontSize(6.5).fillColor(CLARET)
            .text(String(row.group).toUpperCase(), M, doc.y, { width: W, characterSpacing: 0.9, lineBreak: false });
          doc.y += 11;
          striped = 0;
          continue;
        }

        const before = doc.bufferedPageRange().count;
        api.room(rowHeight);
        if (doc.bufferedPageRange().count > before) { header(); striped = 0; }

        const top = doc.y;
        if (striped % 2 === 1) {
          doc.save().rect(M, top - 2, W, rowHeight).fillOpacity(0.03).fill(INK).restore();
        }
        if (highlight && highlight(row)) {
          doc.save().rect(M - 4, top - 2, 2, rowHeight).fill(CLARET).restore();
        }
        columns.forEach((c, i) => {
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

      if (note) {
        api.gap(4);
        api.note(note);
      }
      return api.gap(6);
    },

    bullets(items) {
      for (const item of items) {
        api.room(22);
        const top = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('•', M, top, { width: 10 });
        doc.font('Helvetica').fontSize(9).fillColor(INK).text(item, M + 12, top, { width: W - 12 });
        doc.y += 4;
      }
      return api.gap(6);
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

export function footer(doc, line) {
  // The footer sits INSIDE the bottom margin, and pdfkit adds a page for any
  // text written below it — while this loop is walking the pages. One report
  // grew sixteen blank pages that way, each carrying nothing but the footer
  // that created it. Dropping the margin for the duration is the fix; the
  // range is read once, before anything is written, so it cannot grow.
  const range = doc.bufferedPageRange();
  const total = range.count;
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
}

export function render(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true,
      info: { Producer: 'Thriv3', Creator: 'Thriv3' } });
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
    ['Coaches on file', segments.length ? segments.join('  →  ') : 'none on file'],
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
  k.body(`In ${starterSeasons} of ${model.seasons.length} seasons on file, at least one freshman `
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
  if (title) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
      .text(title, box.x, top, { width: box.w, lineBreak: false });
    top += 13;
  }
  if (subtitle) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(subtitle, box.x, top, { width: box.w, lineBreak: false });
    top += 11;
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

const nice = (v) => Math.round(v).toLocaleString('en-US');

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
    const w = plot.w - 34;
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
      .text(nice(xMax), left + w - 24, plot.y + lanes.length * laneH + 2, { width: 30, align: 'right', lineBreak: false });
    if (ghosts) {
      doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(MUTED)
        .text(`${ghosts} with no minutes recorded, not shown`, plot.x, plot.y + lanes.length * laneH + 11,
          { width: plot.w, lineBreak: false });
    }
  },

  /** Year one on the left, year two on the right, one line per player. */
  slope(k, { box, title, subtitle, pairs, max, leftLabel, rightLabel, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !pairs?.length });
    if (!plot) return;
    const { doc } = k;
    const h = plot.h - 16;
    const lx = plot.x + 40;
    const rx = plot.x + plot.w - 96;
    const gx = plot.x + plot.w - 74;          // the gutter for those who left
    const yOf = (v) => plot.y + h - Math.min(1, v / max) * h;

    for (const axis of [lx, rx]) {
      doc.save().moveTo(axis, plot.y).lineTo(axis, plot.y + h).lineWidth(0.5).strokeColor(AXIS).stroke().restore();
    }
    for (const pr of pairs) {
      const y1 = yOf(pr.from);
      if (pr.toState === 'measured') {
        doc.save().moveTo(lx, y1).lineTo(rx, yOf(pr.to)).lineWidth(0.6)
          .strokeOpacity(0.5).strokeColor(pr.to >= pr.from ? NAVY : CLARET).stroke().restore();
        doc.save().circle(rx, yOf(pr.to), 1.6).fillOpacity(0.6).fill(NAVY).restore();
      } else {
        doc.save().dash(1.5, { space: 2 }).moveTo(lx, y1).lineTo(gx, y1).lineWidth(0.5)
          .strokeOpacity(0.45).strokeColor(MUTED).stroke().undash().restore();
        doc.save().circle(gx, y1, 1.8).lineWidth(0.5).strokeColor(MUTED).stroke().restore();
      }
      doc.save().circle(lx, y1, 1.6).fillOpacity(0.6).fill(MUTED).restore();
    }
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
      .text(leftLabel, plot.x, plot.y + h + 3, { width: 80, lineBreak: false })
      .text(rightLabel, rx - 40, plot.y + h + 3, { width: 80, align: 'center', lineBreak: false });
    const gone = pairs.filter((p) => p.toState !== 'measured').length;
    if (gone) {
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(`${gone} not on the next roster`, gx - 46, plot.y + h + 12, { width: 120, align: 'center', lineBreak: false });
    }
  },

  /** Grouped or stacked columns, one group per season. */
  columns(k, { box, title, subtitle, groups, yMax, unit = '', stacked = false, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !groups?.length });
    if (!plot) return;
    const { doc } = k;
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
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
      .text(`${nice(yMax)}${unit}`, plot.x, plot.y - 1, { width: plot.w, align: 'right', lineBreak: false });
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
  dotLadder(k, { box, title, subtitle, rows, xMax, marker, poolLabel, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !rows?.length });
    if (!plot) return;
    const { doc } = k;
    const labelW = 74;
    const valueW = 62;
    const left = plot.x + labelW;
    const w = plot.w - labelW - valueW;
    const rowH = Math.min(30, (plot.h - 14) / rows.length);
    const xOf = (v) => left + Math.min(1, Math.max(0, v) / xMax) * w;

    if (marker != null && marker <= xMax) {
      const mx = xOf(marker);
      doc.save().dash(2, { space: 2 }).moveTo(mx, plot.y).lineTo(mx, plot.y + rows.length * rowH)
        .lineWidth(0.75).strokeColor(CLARET).stroke().undash().restore();
      doc.font('Helvetica').fontSize(6).fillColor(CLARET)
        .text(`${marker} — a starter's season`, mx + 3, plot.y + rows.length * rowH + 2,
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
      const sorted = [...(r.contributions ?? [])].sort((x, y2) => x.minutes - y2.minutes);
      let lastLabelX = -Infinity;
      let tier = 0;
      sorted.forEach((c) => {
        const x = xOf(c.minutes);
        doc.save().circle(x, cy, 2.6).fillOpacity(0.55).fill(NAVY).restore();
        if (x - lastLabelX < 8) { tier = (tier + 1) % 2; } else { tier = 0; }
        if (x - lastLabelX < 4 && tier === 0) return;
        doc.font('Helvetica').fontSize(5.2).fillColor(MUTED)
          .text(`’${String(c.season).slice(-2)}`, x - 7, cy + 5 + tier * 6,
            { width: 14, align: 'center', lineBreak: false });
        lastLabelX = x;
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

    const footY = plot.y + rows.length * rowH + 2;
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
  eligibilityTimeline(k, { box, title, subtitle, lanes, years, marker, unplaceable, unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !lanes?.length || !years?.length });
    if (!plot) return;
    const { doc } = k;
    const labelW = 74;
    const left = plot.x + labelW;
    const w = plot.w - labelW - 8;
    const top = plot.y + 6;
    const laneH = Math.min(26, (plot.h - 32) / lanes.length);
    const step = years.length > 1 ? w / (years.length - 1) : 0;
    const xOf = (year) => left + years.indexOf(year) * step;
    const maxMin = Math.max(1, ...lanes.flatMap((l) => l.players.map((p) => p.projectedMinutes ?? 0)));

    years.forEach((y) => {
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
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
      // Jittered within the lane so two players leaving the same year do not
      // land on top of one another.
      const byYear = new Map();
      for (const p of lane.players) {
        if (p.eligibleTo == null || !years.includes(p.eligibleTo)) continue;
        const seen = byYear.get(p.eligibleTo) ?? 0;
        byYear.set(p.eligibleTo, seen + 1);
        const off = ((seen % 3) - 1) * 4.5;
        const r = 2 + Math.sqrt(Math.max(0, p.projectedMinutes ?? 0) / maxMin) * 4;
        doc.save().fillOpacity(p.projectedMinutes == null ? 0.18 : 0.6)
          .circle(xOf(p.eligibleTo), cy + off, p.projectedMinutes == null ? 2 : r)
          .fill(p.projectedMinutes == null ? MUTED : NAVY).restore();
      }
    });

    const footY = top + 12 + lanes.length * laneH;
    const key = ['dot size is projected minutes', 'hollow dots carry no projection',
      unplaceable ? `${unplaceable} with no eligibility year, not placed` : null]
      .filter(Boolean).join('   ·   ');
    doc.font('Helvetica').fontSize(6).fillColor(MUTED)
      .text(key, plot.x, footY, { width: plot.w, lineBreak: false, ellipsis: true });
  },

  /** Two bars per row, for here-versus-the-pool comparisons. */
  paired(k, { box, title, subtitle, rows, aLabel, bLabel, max, unit = '', unavailable }) {
    const plot = frame(k, box, { title, subtitle, unavailable, empty: !rows?.length });
    if (!plot) return;
    const { doc } = k;
    const labelW = 118;
    const trackW = plot.w - labelW - 64;
    const rh = Math.min(26, plot.h / rows.length);
    rows.forEach((row, i) => {
      const y = plot.y + i * rh;
      doc.font('Helvetica').fontSize(8).fillColor(INK)
        .text(row.label, plot.x, y + 4, { width: labelW - 6, lineBreak: false });
      [[row.a, NAVY, 0], [row.b, PALE, 7]].forEach(([v, colour, dy]) => {
        if (v == null) return;
        doc.save().rect(plot.x + labelW, y + 3 + dy, Math.max(1, (v / max) * trackW), 5.5)
          .fill(colour).restore();
      });
      const txt = [row.a == null ? null : nice(row.a), row.b == null ? null : nice(row.b)]
        .filter(Boolean).join('  ·  ');
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(`${txt}${unit}`, plot.x + labelW + trackW + 6, y + 4, { width: 58, lineBreak: false });
    });
    const legend = [aLabel, bLabel].filter(Boolean).join('  ·  ');
    if (legend) {
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(legend, plot.x, plot.y + rows.length * rh + 1, { width: plot.w, lineBreak: false });
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
