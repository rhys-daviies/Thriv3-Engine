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

function kit(doc) {
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
      const parts = [
        { v: returning, c: PALE, t: 'stayed' },
        { v: freshman, c: NAVY, t: 'freshmen' },
        { v: newcomer, c: GREEN, t: 'transfers' },
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
function humanCohort(text) {
  return String(text ?? '')
    .replace(/GOALKEEPER/g, 'goalkeepers').replace(/DEFENSE/g, 'defenders')
    .replace(/MIDFIELD/g, 'midfielders').replace(/FORWARD/g, 'forwards')
    .replace(/\binternational\b/g, 'international students')
    .replace(/\bdomestic\b/g, 'US recruits')
    .replace(/ \/ /g, ' who are ');
}

const minutes = (v) => (v == null ? null : `${Math.round(v).toLocaleString('en-US')} min`);

function footer(doc, line) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(line, M, doc.page.height - M + 6, { width: W - 40, lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(`${i - range.start + 1}/${range.count}`, M + W - 40, doc.page.height - M + 6,
        { width: 40, align: 'right', lineBreak: false });
  }
}

function render(build) {
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

function masthead(k, model, title, subtitle) {
  const { doc } = k;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(CLARET)
    .text('THRIV3', M, M - 18, { width: W, characterSpacing: 1.4 });
  k.title(title);
  k.body(subtitle, { color: MUTED });
  k.gap(4);
}

/** The claim the whole document has to make on page one, at full size. */
function whatThisIs(k, model) {
  const seasons = model.describes.length
    ? `${model.describes[0]}–${model.describes[model.describes.length - 1]}`
    : 'no seasons on file';
  k.box(`This is a record of what happened at this programme in ${seasons}. `
    + `The ${model.recruitSeason} season has not been played, so nothing here is a prediction — `
    + 'it is a track record to weigh, and the pages that follow say where it is thin.');
}

function whoRunsIt(k, model) {
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

function ladderSection(k, model) {
  k.heading('What a first year has looked like');
  if (!model.ladder.length) {
    k.body('No season on file carries enough recorded minutes to describe a first year here.',
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

function benchmarkSection(k, model) {
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

function fillMixSection(k, model) {
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
  k.note('"Transfers" counts anyone arriving who is not a first-year — a transfer, a junior-college '
    + 'arrival, or an older recruit. Across the game, the bigger the hole at a position the more '
    + 'of it goes to transfers rather than to freshmen.');
}

function positionSection(k, model) {
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
        + `${p.freshmanTookIt}, a transfer ${p.newcomerTookIt}`;
    k.facts([[positionPlural(p.position).replace(/^./, (c) => c.toUpperCase()), line]]);
  }
  k.note('Counts, not percentages: with at most three seasons to look at, a percentage of three '
    + 'reads far more confidently than it deserves to.');
}

function limits(k, model, extra = []) {
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
