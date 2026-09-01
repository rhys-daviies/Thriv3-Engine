/**
 * COMPETITIVE INTELLIGENCE, on the page. Two pages, two questions.
 *
 *   COMPETITIVE HISTORY      How has this programme competed across the seasons
 *                            we can measure?
 *   COMPETITIVE ENVIRONMENT  Where were those results produced?
 *
 * They are not one page. A record and the competition it was recorded in are
 * different facts, and collapsing them is how "8-7-2" comes to mean the same
 * thing at Mercyhurst in 2022 and in 2024 — two seasons, two divisions, two
 * conferences, one string. The first page is what happened; the second is where.
 *
 * WHAT THIS FILE MAY READ. `model.competitive`, which is
 * `competitivePackageFor(collegeId)` and nothing else. No query, no SQL, no
 * `colleges.division`, no `soccer_score`, no second opinion about a season the
 * package refused. If a figure is not in the package it is not on the page, and
 * the frozen field contract in `shared/report/competitivePackage.js` says which
 * of the ones that ARE may be drawn and under what gate.
 *
 * WHAT IT MAY NOT SAY, and this is the whole design constraint. There is no
 * score here, no grade, no stars, no gauge and no traffic light. There is no
 * arrow, no green-to-red ramp and no upward or downward anything: a sequence of
 * four seasons drawn in year order is chronology, and the moment a line is run
 * through it the page has claimed a trajectory that four seasons cannot support.
 * Every division block is drawn in the same ink at the same weight, because a
 * palette that makes Division I darker than Division III has ranked the
 * divisions on a page that is not allowed to.
 *
 * THE BENCHMARK VOCABULARY IS THREE WORDS WIDE. Upper quarter, middle half,
 * lower quarter, and they describe a RATE against the programmes measured in
 * that season's own division — never a programme, and never across divisions.
 * `MIDDLE HALF` is the boundary's home on purpose: it is the least
 * consequential of the three, so a rate sitting exactly on a quartile is
 * reported as the non-statement rather than as the claim.
 *
 * MISSING IS NOT ZERO, and an absence never reads as a bad season. A season with
 * no benchmark still shows its own rate, with the reason the comparison could
 * not be made beside it. A season with no conference on file gets a labelled
 * block saying so, not a blank one.
 */
import { THEME, TYPE, pageHead } from './philosophyPdf.js';
import { competitiveEnvironmentIsWorthAPage } from '../../shared/report/sections.js';

const { INK, MUTED, LINE, CLARET, NAVY, MID } = THEME;
const TRACK = '#EDEFF3';

/**
 * The three words, and the reason they are the only three.
 *
 * A percentile is a real number and printing it — "the 2025 rate was in the
 * 9.8th percentile" — is a precision this pool cannot carry: every match inside
 * a division has a winner and a loser, so the median rate is .500 close to by
 * construction, and a rate is partly a property of who a programme scheduled.
 * A quarter-of-the-distribution statement survives that. A decimal does not.
 */
export const BENCHMARK_LABEL = Object.freeze({
  UPPER: 'UPPER QUARTER', MIDDLE: 'MIDDLE HALF', LOWER: 'LOWER QUARTER',
});

export function benchmarkLabel(benchmark) {
  if (!benchmark?.available || benchmark.percentile == null) return null;
  const p = benchmark.percentile;
  if (p > 0.75) return BENCHMARK_LABEL.UPPER;
  if (p < 0.25) return BENCHMARK_LABEL.LOWER;
  return BENCHMARK_LABEL.MIDDLE;
}

/** Why a season carries no benchmark, in four words, from the package's own reason. */
function benchmarkAbsence(benchmark) {
  if (!benchmark) return 'no comparison pool';
  if (/division/i.test(benchmark.reason ?? '')) return 'division not established';
  if (/too few/i.test(benchmark.reason ?? '')) return 'too few measured';
  return 'no comparison pool';
}

/**
 * The rate as the NCAA and the schools themselves print it.
 *
 * `.658`, not `65.8%`. A family checking our figure against their own
 * programme's website has to find the same characters, and every college
 * soccer site in this dataset publishes the leading-dot form.
 */
const rate = (v) => (v == null ? null : (v >= 1 ? '1.000' : v.toFixed(3).replace(/^0/, '')));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/**
 * "one season", not "1 season", in prose.
 *
 * The figure columns keep their digits — a table is read as figures — but a
 * sentence that opens "Across the 1 season that could be read" reads as a
 * template that failed to fill in.
 */
const nSeasons = (n) => (n === 1 ? 'one season' : `${n} seasons`);
const list = (xs) => (xs.length <= 1 ? String(xs[0] ?? '')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const seasonList = (xs) => list(xs.map(String));

// ---------------------------------------------------------------------------
// Coverage, said once each
// ---------------------------------------------------------------------------

/**
 * The refusals, grouped by kind rather than repeated per season.
 *
 * The package states an absence per season, which is right for a data contract
 * and wrong for a page: Albany men's carries eight refusals that are two
 * sentences said four times each, and a reader who has to wade through the
 * repetition stops reading before the one that matters. A group of one prints
 * the package's own frozen sentence verbatim; a group of more prints the same
 * sentence with its seasons listed. Nothing is dropped and no season loses its
 * mention — `coverageLines` is asserted to name every season the refusals do.
 */
export function coverageLines(pkg, kinds) {
  const wanted = new Set(kinds);
  const out = [];
  const byKind = new Map();
  for (const r of pkg.refusals ?? []) {
    if (!wanted.has(r.kind)) continue;
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind).push(r);
  }
  for (const kind of kinds) {
    const group = byKind.get(kind);
    if (!group?.length) continue;
    if (group.length === 1) { out.push(group[0].text); continue; }
    const seasons = seasonList(group.map((r) => r.season));
    switch (kind) {
      case 'SEASON_ABSENT':
        out.push(`No win/draw/loss record is on file for ${seasons}.`);
        break;
      case 'SEASON_NOT_READABLE':
        out.push(`The ${seasons} seasons are not readable: the programme's own roster records `
          + 'more appearances than those seasons’ records account for.');
        break;
      case 'CONFERENCE_UNKNOWN':
        out.push(`Historical conference membership could not be established for ${seasons}.`);
        break;
      case 'DIVISION_UNKNOWN':
        out.push(`Competitive benchmark unavailable for ${seasons} because the division the `
          + 'programme played in those seasons could not be established.');
        break;
      case 'RECORD_UNAVAILABLE':
        out.push(`Conference records for ${seasons} are not available from the verified source.`);
        break;
      default:
        // POOL_TOO_SMALL and anything added later carry a figure of their own,
        // so they are never merged into one sentence.
        for (const r of group) out.push(r.text);
    }
  }
  return out;
}

/**
 * Reserve a box, draw into it absolutely, and put the flow cursor back.
 *
 * pdfkit moves `doc.y` on every `text` call, absolute coordinates included, so a
 * figure whose last mark is near its TOP leaves the cursor near its top — and
 * the heading after it is then drawn over the figure's own bottom. The
 * structural timeline's last mark is a season range on its second lane, 35
 * points above the floor `slot` had already reserved, and the heading under it
 * came within 13 points of the conference blocks before this existed.
 */
function figure(k, height, draw) {
  const box = k.slot(height);
  const floor = k.y();
  draw(box);
  k.doc.y = floor;
  return box;
}

// ---------------------------------------------------------------------------
// Figure 1: the seasons, in order, each against its own division
// ---------------------------------------------------------------------------

/**
 * One row per season: the record, the rate, and where that rate sat.
 *
 * NO LINE THROUGH IT. Discrete rows in year order, deliberately: a connected
 * series is a trajectory, a trajectory is a direction, and four seasons of
 * college soccer cannot support one. The rows are chronological because that is
 * the order they happened in and because a reader looking for last season needs
 * to find it, and for no other reason.
 *
 * EACH ROW'S BAND IS ITS OWN. The pale band is the middle half of the
 * programmes measured in THAT season's division, so at a programme that changed
 * division the band moves between rows — which is the honest picture and is why
 * the division is printed under every season label rather than once at the top.
 * The x-axis is a winning percentage and is shared, because .500 is .500
 * wherever it was recorded; the BAND is what makes a row comparable, and it is
 * never shared.
 */
function seasonSequence(k, box, seasons) {
  const { doc } = k;
  // 62 rather than 46: the widest thing this column prints is not a year, it is
  // the sentence that stands in for one when the division is not established.
  const seasonW = 62;
  const recordW = 54;
  const rightW = 96;
  const axisX = box.x + seasonW + recordW;
  const axisW = box.w - seasonW - recordW - rightW - 10;
  const rowH = 30;
  const xOf = (v) => axisX + Math.min(1, Math.max(0, v)) * axisW;

  doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color);
  const head = (text, x, w, align = 'left') => doc.text(text, x, box.y, {
    width: w, align, characterSpacing: TYPE.label.spacing, lineBreak: false,
  });
  head('SEASON', box.x, seasonW - 4);
  head('RECORD', box.x + seasonW, recordW - 4);
  head('WINNING PERCENTAGE, AGAINST THAT SEASON’S DIVISION', axisX, axisW);
  head('RATE', axisX + axisW + 10, rightW, 'right');

  const top = box.y + 14;
  // Gridlines behind everything, at the two ends and the middle. A rate axis
  // with no marks on it invites the reader to read bar length as quantity.
  for (const t of [0, 0.5, 1]) {
    doc.save().moveTo(xOf(t), top).lineTo(xOf(t), top + seasons.length * rowH)
      .lineWidth(0.4).strokeColor(TRACK).stroke().restore();
  }

  seasons.forEach((s, i) => {
    const cy = top + i * rowH + 13;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
      .text(String(s.season), box.x, cy - 8, { width: seasonW - 4, lineBreak: false });
    // The division under the season, not once at the top of the figure: it is
    // what the row's band is drawn from, and a programme that moved has two.
    doc.font('Helvetica').fontSize(5.8).fillColor(MUTED)
      .text(s.historicalDivision ?? 'no division on file', box.x, cy + 2,
        { width: seasonW - 4, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
      .text(s.overallRecord, box.x + seasonW, cy - 7, { width: recordW - 4, lineBreak: false });
    doc.font('Helvetica').fontSize(5.8).fillColor(MUTED)
      .text(`${s.matchesPlayed} matches`, box.x + seasonW, cy + 3,
        { width: recordW - 4, lineBreak: false });

    doc.save().moveTo(axisX, cy).lineTo(axisX + axisW, cy)
      .lineWidth(0.4).strokeColor(LINE).stroke().restore();

    const bm = s.benchmark;
    if (bm?.available) {
      // The middle half of that division and season, behind the programme's own
      // mark. Context, not a target — and the same pale band this report uses
      // for a pool everywhere else, so it reads as the same kind of thing.
      const lo = xOf(bm.middleHalf.low);
      const hi = xOf(bm.middleHalf.high);
      doc.save().rect(lo, cy - 6, Math.max(1, hi - lo), 12).fillOpacity(0.12).fill(MID).restore();
      doc.save().moveTo(xOf(bm.median), cy - 7).lineTo(xOf(bm.median), cy + 7)
        .lineWidth(1).strokeColor(MID).stroke().restore();
    }
    if (s.winPercentage != null) {
      // Drawn whether or not there is a band. The rate is the programme's own
      // figure and carries no gate; only the comparison does.
      doc.save().moveTo(xOf(s.winPercentage), cy - 9).lineTo(xOf(s.winPercentage), cy + 9)
        .lineWidth(2).strokeColor(INK).stroke().restore();
    }

    const rx = axisX + axisW + 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
      .text(rate(s.winPercentage) ?? '—', rx, cy - 9, { width: rightW, align: 'right', lineBreak: false });
    const label = benchmarkLabel(bm);
    // The same grey for all three labels. A colour scale here would rank
    // programmes by hue, which is exactly what the vocabulary exists to avoid.
    doc.font(TYPE.label.font).fontSize(5.8).fillColor(MUTED)
      .text(label ?? 'NO BENCHMARK', rx, cy + 1,
        { width: rightW, align: 'right', characterSpacing: 0.7, lineBreak: false });
    doc.font('Helvetica').fontSize(5.5).fillColor(MUTED)
      .text(bm?.available ? `of ${bm.n} measured` : benchmarkAbsence(bm), rx, cy + 9,
        { width: rightW, align: 'right', lineBreak: false });
  });

  const footY = top + seasons.length * rowH + 4;
  doc.font('Helvetica').fontSize(6).fillColor(MUTED)
    .text('.000', axisX - 6, footY, { width: 24, lineBreak: false })
    .text('.500', xOf(0.5) - 12, footY, { width: 24, align: 'center', lineBreak: false })
    .text('1.000', xOf(1) - 20, footY, { width: 24, align: 'right', lineBreak: false });
  // Drawn from the left edge of the figure rather than from the axis: at the
  // axis it had 385 points for a 175-character key and shipped as
  // "…in that season'…", which is a sentence the reader has to guess at.
  doc.font('Helvetica').fontSize(6).fillColor(MUTED)
    .text('dark mark is this programme’s rate  ·  pale band and light mark are the middle half '
      + 'and median of that season’s division',
    box.x, footY + 10, { width: box.w, lineBreak: false, ellipsis: true });
}

// ---------------------------------------------------------------------------
// Figure 2: where those seasons were played
// ---------------------------------------------------------------------------

/**
 * Consecutive equal values merged into one block.
 *
 * The information is the SPAN, not the repetition: four rows saying
 * "Pennsylvania State Athletic Conference" is one membership drawn four times,
 * and it leaves no room to print the name. Merging also gives a change
 * somewhere to be — the seam between two blocks — without an arrow.
 *
 * A null merges with a null, so "not established" is a span of its own rather
 * than a gap. A gap in a lane reads as nothing having happened.
 */
function spans(cells) {
  const out = [];
  for (let i = 0; i < cells.length; i += 1) {
    const prev = out[out.length - 1];
    if (prev && prev.value === cells[i].value) { prev.to = i; continue; }
    out.push({ value: cells[i].value, from: i, to: i });
  }
  return out;
}

/**
 * Division and conference across the seasons read.
 *
 * EVERY BLOCK IS THE SAME BLOCK. Same fill, same opacity, same ink, whether it
 * says NCAA D1 or NAIA. The lane says which seasons were played where and
 * nothing else; a division drawn darker than another has been ranked, and
 * nothing in this data ranks divisions.
 *
 * A CHANGE IS A SEAM, NOT AN ARROW. Where two adjacent known blocks differ the
 * boundary carries a claret rule, in the same ink this report uses for a marker
 * everywhere else. The sentence underneath names both seasons and both values.
 * There is no glyph pointing anywhere.
 */
/** A sentinel value, so a year with no season read merges with nothing. */
const NO_SEASON = Symbol('no season read');

function structuralTimeline(k, box, seasons) {
  const { doc } = k;
  const laneW = 60;
  const gridX = box.x + laneW;
  const gridW = box.w - laneW;
  /**
   * THE AXIS IS YEARS, NOT ROWS.
   *
   * UC Merced men's has 2022, 2024 and 2025 readable and 2023 not. Drawn as
   * three columns, 2022 and 2024 sit side by side and the conference block over
   * them reads "2022–2024" — a membership across a season this data does not
   * establish. The missing year gets a column of its own, labelled, and it
   * breaks every span that crosses it.
   */
  const first = seasons[0].season;
  const last = seasons[seasons.length - 1].season;
  const years = [];
  for (let y = first; y <= last; y += 1) years.push(y);
  const bySeason = new Map(seasons.map((x) => [x.season, x]));
  const colW = gridW / years.length;

  doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color);
  years.forEach((y, i) => doc.text(String(y), gridX + i * colW, box.y, {
    width: colW - 4, characterSpacing: TYPE.label.spacing, lineBreak: false,
  }));

  const lanes = [
    { label: 'DIVISION',
      cells: years.map((y) => ({ value: bySeason.has(y) ? bySeason.get(y).historicalDivision : NO_SEASON })) },
    { label: 'CONFERENCE',
      cells: years.map((y) => ({ value: bySeason.has(y) ? bySeason.get(y).historicalConference : NO_SEASON })) },
  ];

  const BLOCK_H = 40;
  lanes.forEach((lane, li) => {
    const y = box.y + 14 + li * (BLOCK_H + 10);
    doc.font(TYPE.label.font).fontSize(6.2).fillColor(MUTED)
      .text(lane.label, box.x, y + 15, { width: laneW - 8, characterSpacing: 0.8, lineBreak: false });
    for (const span of spans(lane.cells)) {
      const x = gridX + span.from * colW;
      const w = (span.to - span.from + 1) * colW - 4;
      const absent = span.value === NO_SEASON;
      const known = span.value != null && !absent;
      if (known) {
        doc.save().roundedRect(x, y, w, BLOCK_H, 3).fillOpacity(0.07).fill(NAVY).restore();
        doc.save().roundedRect(x, y, w, BLOCK_H, 3).lineWidth(0.6).strokeColor(LINE).stroke().restore();
      } else {
        // Outlined and labelled, never blank. A blank block in a lane of filled
        // ones reads as a season that did not happen.
        doc.save().dash(2, { space: 2 }).roundedRect(x, y, w, BLOCK_H, 3)
          .lineWidth(0.6).strokeColor(LINE).stroke().undash().restore();
      }
      /**
       * THE CONFERENCE NAME IS NOT ABBREVIATED AND NOT CLIPPED.
       *
       * "Southern California Intercollegiate Athletic Conference" is 55
       * characters and a one-season block is 90 points wide, so a single line at
       * reading size cannot hold it — the first draft shipped "University
       * Athletic Ass…", which tells a reader who has never heard of the UAA
       * nothing at all. The name drops a size and takes the lines it needs
       * inside the block instead, and the block is tall enough for three.
       */
      const label = absent ? 'no season read' : (span.value ?? 'not established');
      const inner = w - 12;
      doc.font(known ? 'Helvetica-Bold' : 'Helvetica-Oblique').fontSize(7.5);
      if (doc.widthOfString(label) > inner) doc.fontSize(6.2);
      const textH = Math.min(24, doc.heightOfString(label, { width: inner }));
      doc.fillColor(known ? INK : MUTED)
        .text(label, x + 6, y + Math.max(5, (BLOCK_H - 12 - textH) / 2),
          { width: inner, height: 24, ellipsis: true });
      const range = span.from === span.to ? String(years[span.from])
        : `${years[span.from]}–${years[span.to]}`;
      doc.font('Helvetica').fontSize(5.8).fillColor(MUTED)
        .text(range, x + 6, y + BLOCK_H - 10, { width: inner, lineBreak: false });
      // The seam. Only between two blocks that are both established: a change
      // out of an unknown season is not a change we observed.
      const before = lane.cells[span.from - 1]?.value;
      if (span.from > 0 && known && before != null && before !== NO_SEASON) {
        doc.save().moveTo(x - 2, y - 2).lineTo(x - 2, y + BLOCK_H + 2)
          .lineWidth(1.6).strokeColor(CLARET).stroke().restore();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Page 1 — COMPETITIVE HISTORY
// ---------------------------------------------------------------------------

/**
 * How much of the history belongs to the current coaching era.
 *
 * A COUNT AND ITS DENOMINATOR, and the page stops there. There is no
 * before-and-after split of the record around an arrival, no per-coach rate and
 * no comparison with a predecessor, because the reader will read any difference
 * placed side by side as the coach's effect and four seasons cannot separate a
 * coach from a recruiting class, a conference move, a schedule or chance. What
 * this block answers is the question a family actually has when they read a
 * four-season record: how much of it is the person they would be playing for.
 */
function coachEra(k, pkg) {
  const c = pkg.coachContext;
  if (!c) return;
  k.heading('How much of this record belongs to the current coach');
  const total = c.competitiveSeasonCount ?? pkg.coverage.readableSeasons;
  if (!c.currentCoach) {
    k.note('No coach is on file for these seasons, so none of this record can be attributed to a '
      + 'coaching era. That is a gap in the coaching record, not a finding about the programme.');
    return;
  }
  const n = c.currentCoachCompetitiveSeasonCount ?? 0;
  if (!n) {
    k.note(`${total === 1 ? 'The one season' : `None of the ${nSeasons(total)}`} read here `
      + `${total === 1 ? 'is not' : 'is'} attributed to ${c.currentCoach}, the coach on file for `
      + 'the season being recruited into.');
  } else {
    k.body(`${n} of the ${nSeasons(total)} read here `
      + `(${seasonList(c.currentCoachCompetitiveSeasons)}) ${n === 1 ? 'is' : 'are'} attributed to `
      + `${c.currentCoach}, the coach on file for the season being recruited into.`);
  }
  if (c.unattributedSeasons?.length) {
    k.note(`${seasonList(c.unattributedSeasons)} could not be attributed to anybody from the `
      + 'coaching record on file.');
  }
  k.note('A count of seasons, and nothing more: this record cannot separate a coach from the '
    + 'players they inherited, the conference, or the schedule, so no part of it is presented as '
    + 'any coach’s doing.');
}

/** The page. */
export function competitiveHistoryPage(k, model) {
  const pkg = model.competitive;
  const cov = pkg.coverage;
  const scopes = [...new Set(pkg.seasons.map((s) => s.benchmark?.scope).filter(Boolean))];
  pageHead(k, {
    kicker: 'Programme evidence',
    title: 'How this programme has competed',
    question: 'How has this programme competed across the seasons we can measure?',
    scope: [
      `${cov.readableSeasons} of ${cov.expectedSeasons} seasons read`,
      cov.benchmarkAvailable
        ? `${cov.benchmarkAvailable} compared against ${scopes.join(' and ')} programmes`
        : 'no season could be compared against a division pool',
      'not a forecast',
    ].filter(Boolean),
  });

  // The page's own reading, first: the primary tier, where `reading` documents
  // it should be and where the lifecycle pages put it. Drawn last it was also
  // the block with no room left — at UC Merced men's it took a page of its own.
  const sentences = competitiveHistoryReading(model);
  if (sentences.length) k.reading(sentences);

  k.heading('Season by season');
  k.note('Each season’s record, the rate it produced, and where that rate sat among the '
    + 'programmes measured in the same division and the same year — against that division and '
    + 'that year, and against nothing else.');
  figure(k, pkg.seasons.length * 30 + 42, (box) => seasonSequence(k, box, pkg.seasons));

  const s = pkg.summary;
  if (s) {
    k.heading('Across the seasons read');
    // The highest and the lowest are the SAME season where only one was read,
    // and two rows saying ".579 in 2023" read as a fault in the document. The
    // model already refuses a range at one season; this reads that refusal.
    const extremes = s.winPercentageRange ? [
      ['Highest of the seasons read',
        `${rate(s.highestObservedSeason.winPercentage)} in ${s.highestObservedSeason.season} (${s.highestObservedSeason.record})`],
      ['Lowest of the seasons read',
        `${rate(s.lowestObservedSeason.winPercentage)} in ${s.lowestObservedSeason.season} (${s.lowestObservedSeason.record})`],
    ] : [];
    k.facts([
      [`Seasons read (${seasonList(pkg.describes)})`, `${cov.readableSeasons} of ${cov.expectedSeasons}`],
      ['Record across those seasons', `${s.aggregateRecord} from ${plural(s.totalMatches, 'match', 'matches')}`],
      ['Winning percentage across those seasons', rate(s.aggregateWinPercentage)],
      ...extremes,
    ]);
    if (cov.readableSeasons === 1) {
      k.note('One season is one season. There is nothing here to compare it with, and it is not a '
        + 'programme record.');
    }
  }

  coachEra(k, pkg);

  // The absences on this page's own terms: seasons that could not be read, and
  // comparisons that could not be made. Where the environment page is not being
  // drawn, the structural absences are stated here instead of nowhere.
  const kinds = ['SEASON_NOT_READABLE', 'SEASON_ABSENT', 'POOL_TOO_SMALL', 'DIVISION_UNKNOWN'];
  if (!competitiveEnvironmentIsWorthAPage(pkg)) kinds.push('CONFERENCE_UNKNOWN');
  const lines = coverageLines(pkg, kinds);
  if (lines.length) k.aside(lines.join(' '), { title: 'What could not be read' });
}

/**
 * What the page says, restated, with every figure printed above it.
 *
 * The band counts are counts. "Two seasons in the upper quarter and two in the
 * lower quarter" is four rows added up; "the programme has fallen away" is a
 * story about them, and this data does not carry it.
 */
export function competitiveHistoryReading(model) {
  const pkg = model.competitive;
  const cov = pkg.coverage;
  const s = pkg.summary;
  const out = [];
  if (s) {
    out.push(`Across the ${nSeasons(cov.readableSeasons)} that could be read `
      + `(${seasonList(pkg.describes)}), this programme recorded ${s.aggregateRecord} from `
      + `${plural(s.totalMatches, 'match', 'matches')}, a winning percentage of `
      + `${rate(s.aggregateWinPercentage)}.`);
  }
  const banded = pkg.seasons.filter((x) => x.benchmark?.available);
  if (banded.length >= 2) {
    const tally = (label) => banded.filter((x) => benchmarkLabel(x.benchmark) === label).length;
    const parts = [
      [tally(BENCHMARK_LABEL.UPPER), 'the upper quarter'],
      [tally(BENCHMARK_LABEL.MIDDLE), 'the middle half'],
      [tally(BENCHMARK_LABEL.LOWER), 'the lower quarter'],
    ].filter(([n]) => n > 0)
      .map(([n, where], i) => `${n} ${i === 0 ? 'sat in' : 'in'} ${where}`);
    out.push(`Of the ${nSeasons(banded.length)} that could be compared, `
      + `${list(parts)} of the programmes measured in that season’s own division.`);
  } else if (banded.length === 1) {
    const one = banded[0];
    out.push(`The ${one.season} rate of ${rate(one.winPercentage)} sat `
      + `${benchmarkLabel(one.benchmark) === BENCHMARK_LABEL.MIDDLE ? 'in the middle half'
        : benchmarkLabel(one.benchmark) === BENCHMARK_LABEL.UPPER ? 'in the upper quarter' : 'in the lower quarter'} `
      + `of the ${one.benchmark.n} ${one.benchmark.scope} programmes measured that season.`);
  }
  /**
   * The seasons that carry no comparison are NOT restated here.
   *
   * The aside at the foot of the page already names them — "Competitive
   * benchmark unavailable for 2022 and 2023 because…" — and a reading that says
   * the same thing without the years is the weaker of the two sentences saying
   * it. It also cost 26 points on a page that finished one point clear of the
   * floor at UCLA men's and five other programmes.
   */
  // The coach count is NOT restated here. It has its own titled block on this
  // page, with its own caveat under it, three inches above this one — and the
  // same fact said twice on one page is how a reader learns to skip the block
  // that says it properly.
  return out.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Page 2 — COMPETITIVE ENVIRONMENT
// ---------------------------------------------------------------------------

/** The page. */
export function competitiveEnvironmentPage(k, model) {
  const pkg = model.competitive;
  const cov = pkg.coverage;
  pageHead(k, {
    kicker: 'Programme evidence',
    title: 'Where those seasons were played',
    question: 'Where were these results produced?',
    scope: [
      cov.membershipKnown
        ? `conference on file for ${cov.membershipKnown} of ${cov.readableSeasons} seasons read`
        : `no conference on file for any of the ${cov.readableSeasons} seasons read`,
      cov.divisionKnown ? `division on file for ${cov.divisionKnown}`
        : 'no season’s division on file',
      'not a judgement about any conference',
    ],
  });

  const sentences = competitiveEnvironmentReading(model);
  if (sentences.length) k.reading(sentences);

  k.heading('Division and conference, season by season');
  k.note('Each of those seasons’ division and conference. A block carries the seasons it spans; a '
    + 'claret rule marks a season played in a different one.');
  figure(k, 112, (box) => structuralTimeline(k, box, pkg.seasons));

  // The frozen sentences, in sequence. Membership and division only: the
  // window and coverage facts are absences and are said in the aside, where
  // this report says absences.
  const facts = (pkg.structuralFacts ?? []).filter((f) => f.kind === 'CONFERENCE_STABLE'
    || f.kind === 'CONFERENCE_CHANGE' || f.kind === 'DIVISION_STABLE' || f.kind === 'DIVISION_CHANGE');
  if (facts.length) {
    k.heading('What the record establishes');
    k.bullets(facts.map((f) => f.text));
    if (facts.some((f) => f.kind === 'DIVISION_CHANGE')) {
      k.note('A division change is recorded here as two seasons and two divisions. It is not '
        + 'presented as a step in any direction: a programme changes division after investment, '
        + 'after a conference reorganises, after a merger and after an enrolment decision, and '
        + 'nothing collected here can tell those apart.');
    }
  }

  // EVERY SEASON WITH A CONFERENCE, not only the ones with a record. Husson has
  // four seasons in the North Atlantic Conference and two published records, and
  // a table listing 2022 and 2023 makes 2024 and 2025 look like seasons that
  // were not played rather than seasons the conference did not publish. They
  // appear with a dash, and the note under the table says what a dash is.
  // "What could not be established" sits with the membership it is about, not at
  // the foot of the page. Trailing, it was the block with no room left: at UC
  // Merced men's it took a second page of its own, and at Mount Mary women's it
  // finished one point past the floor.
  const missing = [
    ...coverageLines(pkg, ['CONFERENCE_UNKNOWN', 'WINDOW_PARTIAL']),
    ...(pkg.structuralFacts ?? []).filter((f) => f.kind === 'DIVISION_UNKNOWN').map((f) => f.text),
  ];
  if (missing.length) k.aside(missing.join(' '), { title: 'What could not be established' });

  const withRecord = pkg.seasons.filter((s) => s.historicalConference);
  if (withRecord.length && pkg.coverage.recordKnown) {
    k.heading('Inside the conference');
    // Grouped by conference, and the grouping is the point rather than tidiness:
    // 8-1-1 in one conference and 8-1-1 in another are the same string about two
    // different competitions, and four ungrouped rows invite exactly the
    // comparison this layer refuses to support.
    const rows = [];
    let current = null;
    for (const s of withRecord) {
      if (s.historicalConference !== current) {
        current = s.historicalConference;
        rows.push({ group: current ?? 'conference not established' });
      }
      rows.push(s);
    }
    k.table({
      columns: [
        { key: 'season', label: 'Season', width: 0.16 },
        { key: 'conferenceRecord', label: 'Record in conference', width: 0.28, bold: true },
        { key: 'conferenceMatches', label: 'Conference matches', width: 0.24, align: 'right' },
        { key: 'overallRecord', label: 'Record overall', width: 0.32, align: 'right' },
      ],
      rows,
      continued: 'Inside the conference',
      // The dash is explained where the dashes are, and so is the season the
      // conference never published — a refusal about this table belongs under
      // it rather than in a general note further down the page.
      // The dash is explained only where there is one. A table of four published
      // records under a sentence about missing ones is a caveat about nothing.
      note: [
        withRecord.some((x) => !x.conferenceRecord)
          ? 'A dash is a record the conference did not publish, not a season without one.' : null,
        ...coverageLines(pkg, ['RECORD_UNAVAILABLE']),
        'A conference record belongs to one competition and is not comparable with a record from '
          + 'another conference.',
      ].filter(Boolean).join(' '),
    });
  }
}

/**
 * What this page adds, rather than what it already printed.
 *
 * The structural sentences are above it, so restating them here would be the
 * same fact three times on one page. What a reader cannot get from those
 * sentences alone is what the structure MEANS for the figures on the page
 * before: whether the four benchmarks were drawn against one set of programmes
 * or several, and whether the conference records are one competition or two.
 */
export function competitiveEnvironmentReading(model) {
  const pkg = model.competitive;
  const cov = pkg.coverage;
  const out = [];
  const divisions = [...new Set(pkg.seasons.map((s) => s.historicalDivision).filter(Boolean))];
  const conferences = [...new Set(pkg.seasons.map((s) => s.historicalConference).filter(Boolean))];

  if (divisions.length === 1 && cov.divisionKnown === cov.readableSeasons) {
    out.push(`Every season read was played in ${divisions[0]}, so each season’s comparison on `
      + 'the previous page is against the same set of programmes.');
  } else if (divisions.length > 1) {
    out.push(`These seasons were not all played in the same division (${list(divisions)}), so each `
      + 'season’s comparison on the previous page is against a different set of programmes.');
  }
  if (conferences.length > 1) {
    out.push(`The seasons read cover ${plural(conferences.length, 'conference', 'conferences')} `
      + `(${list(conferences)}), so the conference records below cannot be compared with each `
      + 'other.');
  } else if (conferences.length === 1 && cov.recordKnown > 1) {
    out.push(`${cov.recordKnown === 2 ? 'Both' : `All ${cov.recordKnown}`} of the conference `
      + `records above were recorded in the ${conferences[0]}, against the programmes that were `
      + 'in it in each of those seasons.');
  }
  // The seasons with no conference are named in this page's own aside, for the
  // same reason the history page leaves its uncompared seasons to its aside.
  return out.slice(0, 4);
}

/** Every authored string these two pages can draw, for the language contract test. */
export function competitiveSentences(model) {
  const pkg = model.competitive;
  return [
    ...competitiveHistoryReading(model),
    ...competitiveEnvironmentReading(model),
    ...coverageLines(pkg, ['SEASON_NOT_READABLE', 'SEASON_ABSENT', 'POOL_TOO_SMALL',
      'DIVISION_UNKNOWN', 'CONFERENCE_UNKNOWN', 'RECORD_UNAVAILABLE', 'WINDOW_PARTIAL']),
    ...(pkg.structuralFacts ?? []).map((f) => f.text),
    ...(pkg.conferenceRecords ?? []).map((f) => f.text),
  ];
}
