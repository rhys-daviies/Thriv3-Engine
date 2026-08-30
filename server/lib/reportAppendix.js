/**
 * The supporting record, and how to read the whole report.
 *
 * The appendices exist so a sceptical reader can check the charts. They are
 * transparency, not headline: no chart, no interpretation, and no table that
 * only repeats one printed earlier. The current-squad record is deliberately
 * absent — page twelve already lists every player with every field an appendix
 * would, and printing it twice would pad the document rather than open it up.
 *
 * The methodology page is written for a player and a parent, not for a lawyer.
 * Its job is to make the three rules the whole report is built on obvious
 * enough that a reader can hold the numbers to them: history is not forecast,
 * missing is not zero, and sample size matters.
 */
import { THEME, TYPE, pageHead } from './philosophyPdf.js';
import { STARTER_MINUTES, MIN_POSITION_MINUTES } from '../../shared/philosophy.js';
import {
  MIN_COHORT_PLAYERS, MIN_COHORT_SEASONS, MIN_MEASURED_SHARE, MIN_SQUAD,
} from '../../shared/freshmanMinutes.js';
import { positionPlural } from '../../shared/positions.js';

const { INK, MUTED, CLARET, W, M } = THEME;

const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const cap = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const page = (k, kicker, title, question) => pageHead(k, { kicker, title, question });

/** The appendices, set one level quieter than the pages they support. */
const record = (k, title, question) => pageHead(k,
  { kicker: 'Supporting record', title, question, quiet: true });

const BAND_WORD = { impact: 'Starter season', rotation: 'Rotation', fringe: 'Fringe', none: 'Did not play' };

// ---------------------------------------------------------------------------
// The first-year record
// ---------------------------------------------------------------------------

export function freshmanRecordPage(k, model) {
  const pts = model.freshman.points;
  record(k, 'Every first-year measured', 'The rows behind the first-year charts.');

  k.table({
    continued: 'Every first-year measured',
    caption: `${plural(pts.length, 'first-year', 'first-years')} across `
      + `${plural(model.describes.length, 'season', 'seasons')}. Only players whose class label could `
      + 'be read as a true first year, and whose minutes were published, appear here — the rest are '
      + 'counted on the intake page rather than invented into this table.',
    columns: [
      { key: 'season', label: 'Season', width: 0.09 },
      { key: 'name', label: 'Player', width: 0.26, bold: true },
      { key: 'position', label: 'Position', width: 0.14, format: (v) => cap(positionPlural(v)).replace(/s$/, '') },
      { key: 'minutes', label: 'Minutes', width: 0.11, align: 'right', format: (v) => nf(v) },
      { key: 'gamesPlayed', label: 'Games', width: 0.09, align: 'right' },
      { key: 'gamesStarted', label: 'Starts', width: 0.09, align: 'right' },
      { key: 'band', label: 'Band', width: 0.13, format: (v) => BAND_WORD[v] ?? null },
      { key: 'origin', label: 'Origin', width: 0.09, format: (v) => (v === 'international' ? 'Intl' : v === 'domestic' ? 'US' : null) },
    ],
    rows: [...pts].sort((a, b) => Number(b.season) - Number(a.season) || b.minutes - a.minutes),
    note: 'A dash under Origin is a player whose roster row recorded neither a nationality nor a '
      + 'country. They are counted in neither origin group rather than assumed to be from either.',
  });
}

// ---------------------------------------------------------------------------
// The experienced-arrival record
// ---------------------------------------------------------------------------

export function arrivalRecordPage(k, model) {
  const pts = model.transfer.points;
  record(k, 'Every experienced arrival measured',
    'The rows behind the experienced-arrival charts.');

  k.table({
    continued: 'Every experienced arrival measured',
    caption: `${plural(pts.length, 'arrival', 'arrivals')} across `
      + `${plural(model.transfer.window.measurable.length, 'measurable season', 'measurable seasons')}. `
      + 'These are minutes they went on to play — historical, not projected.',
    columns: [
      { key: 'season', label: 'Season', width: 0.09 },
      { key: 'name', label: 'Player', width: 0.22, bold: true },
      { key: 'position', label: 'Position', width: 0.12, format: (v) => cap(positionPlural(v)).replace(/s$/, '') },
      { key: 'classLabel', label: 'Class', width: 0.08 },
      { key: 'priorProgramme', label: 'Previous programme', width: 0.2, dropWhenEmpty: true },
      { key: 'minutes', label: 'Minutes', width: 0.1, align: 'right', format: (v) => nf(v) },
      { key: 'gamesPlayed', label: 'Games', width: 0.09, align: 'right' },
      { key: 'gamesStarted', label: 'Starts', width: 0.1, align: 'right' },
    ],
    rows: [...pts].sort((a, b) => Number(b.season) - Number(a.season) || b.minutes - a.minutes),
    // Never inferred. A blank previous programme means the roster did not
    // record one, not that the player came from nowhere — and where NO row
    // records one the column is dropped rather than printed as dashes, so the
    // sentence explaining the dash goes with it.
    note: ({ dropped }) => (dropped.includes('priorProgramme')
      ? 'No row here records a previous programme, so that column is not shown rather than '
        + 'printed as a column of dashes. No source is inferred: an arrival is identified by not '
        + 'having been on the previous roster, which says nothing about where they came from.'
      : 'A dash under Previous programme means the roster did not record one. No source is '
        + 'inferred: an arrival is identified by not having been on the previous roster, which says '
        + 'nothing about where they came from.'),
  });
}

// ---------------------------------------------------------------------------
// The vacancy record
// ---------------------------------------------------------------------------

export function vacancyRecordPage(k, model) {
  const rows = model.summary.programme.replacementBehaviour.record ?? [];
  record(k, 'Every opening observed',
    'Each position-season in which a starter left, and what followed.');

  k.table({
    continued: 'Every opening observed',
    caption: `${plural(rows.length, 'position-season', 'position-seasons')} in which at least one `
      + `player of ${STARTER_MINUTES}+ minutes did not return. One row per transition — several `
      + 'departures at one position in one season are one opening, not several, because they share '
      + 'the following season that answers them.',
    columns: [
      { key: 'transition', label: 'Transition', width: 0.12 },
      { key: 'position', label: 'Position', width: 0.1, format: (v) => cap(positionPlural(v)).replace(/s$/, '') },
      // The widest column by some way. These are the names the whole analysis
      // rests on, and this is the one page that prints them.
      { key: 'departed', label: 'Starters who left', width: 0.3, format: (v) => (v?.length ? v.map((d) => `${d.name} (${nf(d.minutes)})`).join(', ') : null) },
      { key: 'vacatedStarterMinutes', label: 'Minutes vacated', width: 0.11, align: 'right', format: (v) => nf(v) },
      { key: 'freshStarters', label: 'First-year started', width: 0.13, align: 'right', format: (v) => (v ? `yes (${v})` : 'no') },
      { key: 'newcomerStarters', label: 'Arrival started', width: 0.12, align: 'right', format: (v) => (v ? `yes (${v})` : 'no') },
      { key: 'returningShare', label: 'Returning share', width: 0.12, align: 'right', format: (v) => (v == null ? null : `${Math.round(v)}%`) },
    ],
    rows,
    note: 'The last three columns are not alternatives. A first-year and an experienced arrival can '
      + 'both have started after the same opening, and returning players can hold most of the '
      + 'minutes while both did — which is why the report never names a single replacement.',
  });
}

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

/** A two-column flow for the methodology, so it reads as prose rather than a wall. */
function twoColumn(k, sections) {
  const colW = (W - 22) / 2;
  let top = k.doc.y;
  const bottom = k.doc.page.height - M - 26;
  let x = M;
  let y = top;

  for (const [heading, ...paras] of sections) {
    const height = 13 + paras.reduce((s, t) => s
      + k.doc.font('Helvetica').fontSize(8.5).heightOfString(t, { width: colW }) + 5, 0) + 8;
    // Move to the second column, then to a new page, rather than letting a
    // block run off the bottom.
    if (y + height > bottom) {
      if (x === M) {
        x = M + colW + 22;
        y = top;
      } else {
        // A continued page needs to say so: without a heading it reads as a
        // stray page rather than the second half of one section.
        k.doc.addPage();
        k.doc.font('Helvetica-Bold').fontSize(8).fillColor(CLARET)
          .text('HOW TO READ THIS REPORT', M, M - 18,
            { width: W, characterSpacing: 1.2, lineBreak: false });
        k.doc.font(TYPE.title.font).fontSize(TYPE.title.size).fillColor(INK)
          .text('Methodology and limitations, continued', M, M, { width: W, lineBreak: false, ellipsis: true });
        x = M;
        y = M + 34;
        top = y;
      }
    }
    k.doc.font(TYPE.section.font).fontSize(8.5).fillColor(TYPE.section.color)
      .text(heading.toUpperCase(), x, y, { width: colW, characterSpacing: TYPE.section.spacing,
        lineBreak: false, ellipsis: true });
    y += 13;
    for (const t of paras) {
      k.doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(t, x, y, { width: colW });
      y = k.doc.y + 5;
    }
    y += 8;
  }
  k.doc.y = bottom;
}

export function methodologyPage(k, model) {
  const s = model.summary.programme;
  page(k, 'How to read this report', 'Methodology and limitations', null);

  // The three rules, as a callout, because everything else is an application
  // of one of them.
  const cardW = (W - 20) / 3;
  const top = k.doc.y;
  // Sized to the tallest of the three, measured. The longest ran its final
  // line onto the boundary of its own tinted ground.
  const lines = [
    'Everything measured here has already happened. Nothing in this report predicts a season that '
    + 'has not been played.',
    'A figure that could not be read is never counted as none. It is left out, and the gap is stated.',
    'Small samples are shown as counts rather than rates. A share of three reads more confidently '
    + 'than it deserves to.',
  ];
  const cardH = 32 + Math.max(...lines.map((t) => k.doc.font('Helvetica').fontSize(7.5)
    .heightOfString(t, { width: cardW - 22 }))) + 10;
  [['HISTORY IS NOT FORECAST', lines[0]],
    ['MISSING IS NOT ZERO', lines[1]],
    ['SAMPLE SIZE MATTERS', lines[2]],
  ].forEach(([title, sub], i) => {
    const x = M + i * (cardW + 10);
    k.doc.save().rect(x, top, cardW, cardH).fillOpacity(0.06).fill(CLARET).restore();
    k.doc.save().rect(x, top, 4, cardH).fill(CLARET).restore();
    k.doc.font('Helvetica-Bold').fontSize(9).fillColor(CLARET)
      .text(title, x + 12, top + 11, { width: cardW - 20, characterSpacing: 0.4 });
    k.doc.font('Helvetica').fontSize(7.5).fillColor(INK)
      .text(sub, x + 12, top + 32, { width: cardW - 22 });
  });
  k.doc.y = top + cardH + 18;

  twoColumn(k, [
    ['History, not forecast',
      `This report describes roster behaviour that has already been measured, and the squad on `
      + `campus for ${model.squadSeason}. It does not predict future recruiting, future arrivals, `
      + 'injuries, redshirts, coaching changes or anybody’s playing time.',
      'Where a current player carries a projected-minutes figure, that is a planning estimate '
      + 'attached to that player for the coming season. It is not a forecast of what a recruit '
      + 'would play, and it does not pass to anyone when that player leaves.'],

    ['What counts as a first-year',
      'A true first-year: someone in their first year on campus, read from the class label the '
      + 'roster printed. Redshirt first-years are excluded where the label distinguishes them, '
      + 'because they have already spent a year at the programme.',
      'A label we could not read is never guessed. Some rosters print a graduation year, a club '
      + 'name or nothing at all where the class belongs, and a season whose labels cannot be read '
      + 'is reported as unreadable rather than counted as a season with no first-years.'],

    [`Why ${STARTER_MINUTES} minutes`,
      `${STARTER_MINUTES} minutes across a season is the threshold this report calls a starter\u2019s `
      + 'season. It is a consistent measure applied identically to every programme, not a claim '
      + 'that a player started every match — a regular starter and a heavily used substitute can '
      + 'both clear it, and a player who started ten matches and was injured may not.'],

    ['Why a ladder rather than an average',
      'First-year minutes are usually uneven. At one programme three first-years played over a '
      + 'thousand minutes and five played none; the average of 340 described nobody on the roster.',
      'So first-years are ranked within their own class — best, second-best, third-best — and the '
      + 'same rank is compared across seasons. The report shows the median of those seasons and '
      + 'the individual seasons behind it, so you can see whether they agree. Where the best and '
      + 'the median sit in different bands, the range is shown instead of the median.'],

    ['Coaching relevance',
      'When the person in charge changes, older seasons may describe a different approach. The '
      + 'report keeps the full programme history and, where a change is detected, may also show a '
      + 'view that weights recent seasons more heavily.',
      'The weighted view never silently replaces the programme history. Both are labelled, and it '
      + 'only appears where reweighting actually changes the answer.'],

    ['Missing data',
      'A blank is not a zero. A player whose minutes were never published is left out of a chart '
      + 'rather than drawn at zero, and counted separately so you can see how much was not visible.',
      `A season is only read where at least ${Math.round(MIN_MEASURED_SHARE * 100)}% of the squad `
      + `carries minutes and the squad has at least ${MIN_SQUAD} players; a position-season is only `
      + `read where at least ${nf(MIN_POSITION_MINUTES)} minutes were played at that position on `
      + 'both sides of the comparison. Below those, the report says it cannot tell you rather than '
      + 'showing a figure built from whichever rows happened to be legible.'],

    ['Experienced arrivals',
      'Roster data cannot reliably separate a four-year transfer, a junior-college arrival, an '
      + 'older first-time college player and any other route in. All of them look the same: '
      + 'somebody who was not on last season’s roster and is not a first-year.',
      'So the report calls all of them experienced arrivals rather than naming one route it '
      + 'cannot verify. Where '
      + 'a roster records a previous programme outright, that is shown as a fact; it is never '
      + 'inferred from absence.'],

    ['Replacing minutes',
      'For each position and each season-to-season transition, the report identifies who did not '
      + 'return, which of them had played a starter’s season, and then divides the following '
      + 'season’s minutes at that position three ways: players who were already here, first-years, '
      + 'and experienced arrivals. Those three shares add to everything played.',
      '\u201CA first-year then started\u201D and \u201Can experienced arrival then started\u201D are separate counts '
      + 'of the same openings and can both be true of one season. They are never subtracted from '
      + 'each other or from the total, and returning behaviour is shown as a share of minutes '
      + 'rather than as a count of openings anybody won.'],

    ['Position groups',
      'Positions are grouped as goalkeeper, defender, midfield and forward. A centre-back and a '
      + 'full-back are counted together, as are a winger and a striker.',
      'This makes the samples large enough to read and loses the distinction between roles inside '
      + 'a group. Where a roster printed a more specific position, it is shown in the squad list.'],

    ['Goalkeepers',
      'Goalkeepers behave differently from every other group: one keeper usually plays nearly every '
      + 'minute and the rest play none. A typical figure describes nobody, and a position-season '
      + 'rarely carries the spread of minutes the readability guard requires — so goalkeeper rows '
      + 'are often the ones the report declines to read.'],

    ['Origin',
      'Origin is grouped only as arriving from within the United States or from outside it. It is '
      + 'never split by individual nationality: there are never enough players from one country at '
      + 'one programme for that to mean anything.',
      `A programme comparison needs at least ${MIN_COHORT_PLAYERS} measured first-years in the group `
      + `across at least ${MIN_COHORT_SEASONS} seasons. Pool comparisons are measured within a `
      + 'division rather than across the game, because the relationship differs by level. Any figure '
      + 'shown is a description of who has played, not of why — the groups differ in more ways than '
      + 'this measures, and where somebody is arriving from is not the cause of the difference.'],

    ['Evidence strength',
      'Strong, moderate and limited describe how much usable history sits behind an interpretation. '
      + 'They are not a probability, a confidence interval or a quality score, and they say nothing '
      + 'about whether a programme is a good one.',
      'What feeds them differs by question: seasons measured, players measured, openings observed, '
      + 'whether the coaching record attributes those seasons to the current staff, and how much of '
      + 'the group survived the readability guards. Where too little stands behind a reading, the '
      + 'report says unclear even though raw numbers exist.'],

    ['What the benchmarks mean',
      'Above programme benchmark, typical and below programme benchmark are positions in the pool '
      + 'of programmes in this sport. Typical means the middle half of them.',
      'They do not mean good, average or bad. They say only where the measured behaviour sits '
      + 'among comparable programmes, and a programme can sit below the benchmark for reasons that '
      + 'have nothing to do with quality.'],

    ['The current squad',
      'The squad pages use only players on the roster now. Eligibility end year is the last season '
      + 'a player may play; projected minutes are what they are expected to play in the coming one.',
      'Projected minutes are carried forward from a player’s previous season, so a true first-year '
      + 'cannot have one — an empty column there is the method rather than a judgement. Coverage is '
      + 'stated wherever those figures are summed. Minutes attached to a player whose eligibility '
      + 'is ending do not pass to anyone else: who is on the squad afterwards depends on '
      + 'recruiting that has not happened.'],

    ['When a player disappears',
      'A player who is not on the following season’s roster is recorded as gone. The report cannot '
      + 'prove why. It may mean a move to another programme, an injury, a player who stopped '
      + 'playing, or two spellings of one name that the join could not match.',
      'It is the one kind of departure that cannot mean graduation, which is why it is worth '
      + 'showing — but no reason is inferred from it.'],
  ]);

  k.doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(`Prepared from roster seasons ${model.describes.join(', ') || 'on file'} and the `
      + `${model.squadSeason} squad. A change at this programme after the date on this page is not `
      + 'in it.', M, k.doc.page.height - M - 20, { width: W, lineBreak: false, ellipsis: true });
}
