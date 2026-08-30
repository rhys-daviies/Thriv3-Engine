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
import { THEME, minutes, fitText } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';
import { positionPlural } from '../../shared/positions.js';

const { INK, MUTED, LINE, CLARET, NAVY, MID, PALE, GREEN, M, W } = THEME;

const GAP = 12;
const HALF = (W - GAP) / 2;

const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pctOf = (v, digits = 0) => (v == null ? '—' : `${(100 * v).toFixed(digits)}%`);

export { fitText };

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
  freshman: 'FRESHMEN',
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
  const pad = 13;
  let y = box.y + pad;
  if (title) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(CLARET)
      .text(title.toUpperCase(), box.x + pad, y, { width: box.w - pad * 2, characterSpacing: 0.9, lineBreak: false });
    y += 14;
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

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(CLARET)
    .text('THRIV3', M, M - 18, { width: W, characterSpacing: 1.4, lineBreak: false });

  let y = M + 6;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
    .text('PROGRAM INTELLIGENCE REPORT', M, y, { width: W, characterSpacing: 1.6, lineBreak: false });
  y += 20;

  doc.font('Helvetica-Bold').fontSize(23).fillColor(INK)
    .text(c.name, M, y, { width: W, lineBreak: false, ellipsis: true });
  y += 28;

  const place = [c.division, c.conference, [c.city, c.state].filter(Boolean).join(', ')]
    .filter(Boolean).join('  ·  ');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(place, M, y, { width: W, lineBreak: false, ellipsis: true });
  y += 16;

  if (a) {
    doc.save().moveTo(M, y).lineTo(M + W, y).lineWidth(0.75).strokeColor(LINE).stroke().restore();
    y += 9;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
      .text(`Prepared for ${a.name}`, M, y, { width: W, lineBreak: false, ellipsis: true });
    y += 13;
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text([a.positionLabel, a.nationality, `entering ${model.entrySeason}`].filter(Boolean).join('  ·  '),
        M, y, { width: W, lineBreak: false, ellipsis: true });
    y += 16;
  }

  // The value statement, built from what the model actually holds rather than
  // from a sentence that claims four seasons whatever the data says.
  const seasons = model.describes ?? [];
  const span = seasons.length
    ? `${seasons.length} season${seasons.length === 1 ? '' : 's'} of roster behaviour `
      + `(${seasons.length === 1 ? seasons[0] : `${seasons[0]}–${seasons[seasons.length - 1]}`})`
    : 'the roster seasons on file';
  doc.save().rect(M, y, W, 34).fillOpacity(0.05).fill(NAVY).restore();
  doc.font('Helvetica').fontSize(8.5).fillColor(INK)
    .text(`${span}, recruiting patterns, playing-time evidence and current squad context — applied to `
      + `this programme${a ? ' and to your pathway' : ''}. Nothing here is a forecast: the `
      + `${model.recruitSeason} season has not been played.`,
    M + 12, y + 9, { width: W - 24 });
  y += 46;

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED)
    .text('CONTENTS', M, y, { width: W * 0.6, characterSpacing: 1, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED)
    .text('PAGE', M + W - 40, y, { width: 40, align: 'right', characterSpacing: 1, lineBreak: false });
  y += 11;
  doc.save().moveTo(M, y).lineTo(M + W, y).lineWidth(0.75).strokeColor(INK).stroke().restore();
  y += 8;

  // Row height flexes so a long registry still lands on one page. Below the
  // floor the description is dropped rather than the row, because a listed
  // section with no page number would be worse than a terse one.
  const available = doc.page.height - M - 24 - y;
  const layers = [...new Set(listed.map((s) => s.layer))];
  const rowsH = available - layers.length * 13;
  const rowH = Math.max(15, Math.min(27, rowsH / Math.max(1, listed.length)));
  const showDescriptions = rowH >= 21;

  let lastLayer = null;
  for (const s of listed) {
    if (s.layer !== lastLayer) {
      lastLayer = s.layer;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(CLARET)
        .text(layerTitle(s.layer).toUpperCase(), M, y + 2, { width: W, characterSpacing: 1, lineBreak: false });
      y += 13;
    }
    line(doc, s.title, M + 8, y, W * 0.52, { font: 'Helvetica-Bold', size: 9 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
      .text(String(pages.get(s.id)), M + W - 40, y, { width: 40, align: 'right', lineBreak: false });

    // One scope indicator, not every number the section could report.
    const scope = (s.scopeNotes ?? []).slice(0, 2).join(' · ');
    if (scope) {
      line(doc, scope, M + W * 0.58, y + 1, W * 0.42 - 44, { size: 7, color: MUTED, align: 'right' });
    }
    if (showDescriptions && s.description) {
      line(doc, s.description, M + 8, y + 11, W * 0.74, { size: 7.2, color: MUTED });
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

function pageHeading(k, title, subtitle) {
  const { doc } = k;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(CLARET)
    .text('AT A GLANCE', M, M - 18, { width: W, characterSpacing: 1.2, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(19).fillColor(INK)
    .text(title, M, doc.y, { width: W, lineBreak: false, ellipsis: true });
  doc.y += 24;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(subtitle, M, doc.y, { width: W, lineBreak: false, ellipsis: true });
  doc.y += 18;
}

function freshmanCard(doc, box, s) {
  const p = panel(doc, box, 'Freshman opportunity');
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
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(CLARET)
      .text(`Current-coach-weighted history differs: ${nf(s.weightedLadderTop.median)} min`,
        p.x, y + 1, { width: p.w, lineBreak: false, ellipsis: true });
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

function coachCard(doc, box, s) {
  const p = panel(doc, box, 'Coach context');
  let y = p.y;
  const rel = s.evidenceRelevance ?? 'unknown';
  chip(doc, p.x, y, COACH_HEADLINE[rel] ?? 'COACHING RECORD INCOMPLETE', { muted: rel !== 'describes-current' });
  y += 20;
  doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
    .text(COACH_SUBLINE[rel] ?? '', p.x, y, { width: p.w, lineBreak: false, ellipsis: true });
  y += 16;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK)
    .text(s.currentCoach ?? 'Not on file', p.x, y, { width: p.w, lineBreak: false, ellipsis: true });
  y += 17;

  y = factLine(doc, p.x, y, p.w, `Head coach, ${s.coachForRecruitSeason ? 'named for' : 'for'} entry`,
    s.coachForRecruitSeason ?? 'not on file');
  y = factLine(doc, p.x, y, p.w, 'Seasons analysed', s.seasonsAnalysed ?? 0);
  y = factLine(doc, p.x, y, p.w, 'Coaches on file', s.segments?.length ?? 0);
  if (s.unknownSeasons?.length) {
    y = factLine(doc, p.x, y, p.w, 'Seasons unattributed', s.unknownSeasons.join(', '));
  }

  // The verdict's own sentence, which classifyProgramme wrote and which is a
  // stable explanation rather than report prose.
  if (s.verdictNote) {
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(s.verdictNote.replace(/^./, (ch) => ch.toUpperCase()), p.x, y + 2,
        { width: p.w, height: p.bottom - y - 6, ellipsis: true });
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

  // Column one: the next year anything meaningful comes off the roster.
  if (nextYear) {
    bigMetric(doc, p.x, y, nf(nextYear.minutes), { unit: 'min' });
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
      .text(`currently attached to players whose eligibility ends after ${nextYear.year}`,
        p.x, y + 27, { width: colW });
  } else {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(s.rostered ? 'No eligibility end years recorded for this squad.' : 'No current roster on file.',
        p.x, y, { width: colW * 2 });
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
    cy += 10;
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

  cardRow(k, 202, (row) => {
    freshmanCard(doc, { ...row, w: HALF }, s.freshmanOpportunity);
    arrivalCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, s.experiencedArrivalReliance);
  });
  cardRow(k, 202, (row) => {
    replacementCard(doc, { ...row, w: HALF }, s.replacementBehaviour);
    coachCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, s.coachContext);
  });
  cardRow(k, 146, (row) => squadOutlookCard(doc, row, s.squadTurnover));
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

  y = bigMetric(doc, p.x, y, finalSeason.length, {
    caption: `in their final eligible season in ${a.entrySeason}`,
  });
  doc.font('Helvetica').fontSize(7.8).fillColor(INK)
    .text(finalMinutes?.currentProjectedMinutes == null
      ? 'None of them carries a projected-minutes figure.'
      : `${nf(finalMinutes.currentProjectedMinutes)} projected minutes are currently attached to those players.`,
    p.x, y, { width: p.w });
  y += finalMinutes?.playersWithoutProjection ? 11 : 18;
  if (finalMinutes?.playersWithoutProjection) {
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
      .text(`${finalMinutes.playersWithoutProjection} of them has no projection on file.`, p.x, y, { width: p.w });
    y += 14;
  }

  // The timeline, drawn only where the three groups are actually separable.
  const bands = [
    { label: 'BEFORE YOU ARRIVE', n: endsBefore.length, note: `eligibility ends before ${a.entrySeason}`, color: MUTED },
    { label: 'YOUR ENTRY SEASON', n: finalSeason.length, note: `final eligible season is ${a.entrySeason}`, color: CLARET },
    { label: 'BEYOND ENTRY', n: eligible.length - finalSeason.length, note: `eligible past ${a.entrySeason}`, color: NAVY },
  ];
  doc.save().moveTo(p.x, y).lineTo(p.x + p.w, y).lineWidth(0.5).strokeColor(LINE).stroke().restore();
  y += 6;
  for (const b of bands) {
    doc.save().rect(p.x, y + 1, 3, 18).fill(b.color).restore();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(INK)
      .text(b.label, p.x + 8, y, { width: p.w * 0.55, characterSpacing: 0.5, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
      .text(String(Math.max(0, b.n)), p.x + p.w - 30, y - 1, { width: 30, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
      .text(b.note, p.x + 8, y + 9, { width: p.w - 44, lineBreak: false, ellipsis: true });
    y += 21;
  }
  if (unknown.length) {
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
      .text(`${unknown.length} with no eligibility year recorded, counted in none of the three.`,
        p.x, y, { width: p.w, lineBreak: false, ellipsis: true });
    y += 10;
  }

  // Allowed to wrap. It is the one sentence on this card that must survive
  // intact, and it was being clipped to "…are not kno" the moment the
  // ellipsis fix made the overflow visible.
  doc.font('Helvetica-Oblique').fontSize(6.8).fillColor(MUTED)
    .text('Future recruits, transfers, injuries and eligibility changes are not known.',
      p.x, Math.min(y + 2, p.bottom - 18), { width: p.w });
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

  doc.font('Helvetica-Bold').fontSize(8).fillColor(CLARET)
    .text('AT A GLANCE', M, M - 18, { width: W, characterSpacing: 1.2, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(19).fillColor(INK)
    .text(`Your opportunity at ${model.college.name}`, M, doc.y, { width: W, lineBreak: false, ellipsis: true });
  doc.y += 24;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text([athlete.positionLabel, `entering ${model.entrySeason}`].filter(Boolean).join('  ·  '),
      M, doc.y, { width: W, lineBreak: false });
  doc.y += 8;
  k.box('What the programme’s history and its currently known roster mean for someone entering at this '
    + 'position. This page does not say how many minutes you would play — that season has not been played, '
    + 'and who is on the squad by then is not knowable from this data.');

  cardRow(k, 232, (row) => {
    positionNowCard(doc, { ...row, w: HALF }, a);
    arrivalWindowCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, a, model);
  });
  cardRow(k, 226, (row) => {
    positionOpensCard(doc, { ...row, w: HALF }, a);
    originCard(doc, { ...row, x: row.x + HALF + GAP, w: HALF }, a);
  });
}
