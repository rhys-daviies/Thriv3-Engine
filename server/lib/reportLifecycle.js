/**
 * The lifecycle pages: how players develop here, who comes back, and where
 * the ones who left can be traced to.
 *
 * Same contract as the evidence layer beside it. Nothing here computes —
 * every figure comes from `model.lifecycle`, which is built by
 * `shared/report/lifecycleSummary.js` and can be asserted without producing a
 * PDF. Every chart carries the sample it was drawn from, and every absence
 * carries its reason in the space the chart would have occupied.
 *
 * THE WORDS THESE PAGES MAY NOT USE, and why.
 *
 * Transfer. The rosters cannot tell a transfer from a graduate move, a
 * year abroad, a player who stopped, or a spelling the join missed. What they
 * show is a name at another programme the following season, and that is what
 * the pages say.
 *
 * A transfer rate, or any rate over departures. 84% of departures resolve to
 * no destination at all and resolution varies six-fold by division, so such a
 * rate measures how well the rosters were scraped.
 *
 * Satisfaction, happiness, culture, or any reason for leaving. Nothing in the
 * data records why anybody moved. A programme whose players return less often
 * than the pool is a programme whose players return less often than the pool.
 *
 * Successful or failed. A player's minutes at their next programme are their
 * minutes at their next programme.
 */
import { charts, THEME, TYPE, pageHead, fitText } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';
import { positionPlural } from '../../shared/positions.js';
import {
  developmentNarrative, continuityNarrative, destinationNarrative,
} from '../../shared/report/narrative.js';
import { MIN_POSITION_DESTINATIONS } from '../../shared/report/lifecycleSummary.js';

const { MUTED, CLARET, NAVY, MID, PALE, GREEN, INK, W, M } = THEME;
const THEME_LABEL = TYPE.label;

const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const pc = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const page = (k, title, question) => pageHead(k, { kicker: 'Programme evidence', title, question });

/** The pool a figure was compared against, in the words the page uses. */
const poolScope = (l) => (l.poolProgrammes
  ? `${l.poolProgrammes} comparable programmes` : 'the wider pool');

const BAND_WORD = {
  'above-benchmark': 'above the comparable pool',
  typical: 'inside the middle half of the pool',
  'below-benchmark': 'below the comparable pool',
  unclear: 'not enough on file to place against the pool',
  unavailable: 'no pool figure to compare against',
};

// ---------------------------------------------------------------------------
// Player development
// ---------------------------------------------------------------------------

/**
 * Replaces "After the first season", which compared year one with year two and
 * stopped. The question a family asks is not what happens in the second year;
 * it is whether a player who arrives here grows into a real role at all, and
 * that takes four years of denominators to answer.
 */
export function playerDevelopmentPage(k, model) {
  const l = model.lifecycle;
  const d = l.development;
  const cov = d.minutesCoverage;

  page(k, 'How players develop after they arrive',
    'Do players who arrive here tend to grow into meaningful roles?');
  // Short enough to fit. `k.scope` draws one line and truncates rather than
  // wrapping, so a scope that runs long loses its last fact silently — this
  // one used to end "compared against 212 comparable p…".
  k.scope([
    `${plural(d.players, 'first-year', 'first-years')} followed`,
    `${cov.measured} of their ${cov.playerSeasons} seasons carry minutes`,
    `vs ${poolScope(l)}`,
  ]);

  k.reading(developmentNarrative(model));

  // Trajectory first, as four columns whose denominators shrink to the right.
  charts.yearSteps(k, {
    box: k.slot(136),
    title: `Reaching ${STARTER_MINUTES} minutes in a season — a starter’s season`,
    subtitle: 'Each column counts only the players who have been here long enough to have had that '
      + 'year in a season with published minutes.',
    years: d.byYear.map((y, i) => ({
      label: `Year ${i + 1}`,
      share: y.share,
      pool: y.pool?.median ?? null,
      caption: `reached ${STARTER_MINUTES}+ by then`,
      // "0 of 42" under "minutes not published here" is the same confident zero
      // the percentage was refused for, written as a fraction. Where the
      // minutes cannot be read, only the cohort is stated.
      count: cov.readable
        ? `${y.reached} of ${y.denominator}`
        : `${y.denominator} followed`,
      unavailable: !cov.readable ? 'minutes not published here'
        : y.denominator === 0 ? 'no player has been here this long'
          : 'cohort too small to quote a share',
    })),
    poolLabel: `the grey mark is the median of ${poolScope(l)} in ${l.poolScope}`,
    unavailable: d.players ? null : 'no first-year here has a season on file',
  });

  // Deliberately nothing here when the minutes cannot be read. The reading
  // block above has already said so once, and this page used to say it five
  // times over — in the block, in four refused columns, in an aside repeating
  // the block, in a second aside about the careers, and in a refused
  // time-to-600 section. Saying it once and showing the cohorts is the whole
  // of what a sparse programme can honestly be given.

  // Individual lines, only for a cohort small enough to follow.
  const tr = d.trajectories;
  if (tr.shown.length) {
    const max = Math.max(1600, ...tr.shown.flatMap((t) => t.points.map((p) => p.minutes)));
    const years = Math.max(2, ...tr.shown.flatMap((t) => t.points.map((p) => p.year)));
    charts.trajectories(k, {
      box: k.slot(150),
      title: 'Individual careers here, season by season',
      subtitle: tr.rule.replace(/^./, (c) => c.toUpperCase())
        + `. ${tr.omitted ? `${tr.omitted} more are not drawn.` : 'All of them are drawn.'}`,
      lines: tr.shown.map((t) => ({ name: t.name, points: t.points })),
      max,
      years,
      marker: STARTER_MINUTES,
      unavailable: null,
    });
    k.note('A season with no published minutes leaves a gap rather than a point at zero. These are '
      + 'the longest careers on file here, not the best ones.');
  } else if (cov.readable) {
    // Only where the minutes ARE readable is this its own finding: the
    // programme publishes minutes and nobody has been here long enough.
    k.aside('No first-year here has three or more seasons of published minutes, so there is no '
      + 'career long enough to draw. That is a limit of what these rosters record, not a statement '
      + 'about how long players stay.', { title: 'No individual careers to draw' });
  }

  // The compact secondary module.
  const t = d.timeToStarter;
  if (t.suppressed || t.denominator === 0) {
    // Where the minutes cannot be read at all, this section is the same
    // sentence a third time and is simply not opened.
    if (cov.readable) {
      k.heading('Time to 600 minutes');
      k.note(`Not shown. It can only be asked of players who arrived by ${t.entrySeasonsUpTo} — `
        + 'early enough to have had three seasons with published minutes here — and '
        + `${t.denominator === 0 ? 'no first-year' : `only ${plural(t.denominator, 'first-year', 'first-years')}`}`
        + ' here qualifies.');
    }
  } else {
    k.heading('Time to 600 minutes');
    k.body(`Of the ${t.denominator} first-years who arrived by ${t.entrySeasonsUpTo} and have three `
      + 'seasons of published minutes here:', { color: MUTED });
    k.table({
      columns: [
        { key: 'label', label: 'First reached 600 minutes', width: 0.55 },
        { key: 'n', label: 'Players', width: 0.2, align: 'right' },
        { key: 'of', label: 'Of', width: 0.25, align: 'right' },
      ],
      rows: [
        { label: 'In their first season', n: t.year1, of: t.denominator },
        { label: 'In their second season', n: t.year2, of: t.denominator },
        { label: 'In their third season', n: t.year3, of: t.denominator },
        { label: 'Not within their first three seasons', n: t.notWithinThree, of: t.denominator },
      ],
      note: 'The last row is not a failure and is not read as one: it counts players who had not '
        + 'reached 600 minutes in a season within their first three years here, in the seasons this '
        + 'data covers.',
    });
  }

  k.note('Nothing on this page says the programme caused any of it. These are the minutes players '
    + 'went on to play after arriving here, next to what players at comparable programmes went on '
    + 'to play. Who a programme recruits, who else is in the squad and who stays fit all move '
    + 'these figures, and none of them is separable in roster data.');
}

// ---------------------------------------------------------------------------
// Roster continuity and departure composition
// ---------------------------------------------------------------------------

const ROLE_LABEL = {
  '600+': `Played ${STARTER_MINUTES}+ minutes`,
  '200-599': 'In the rotation',
  '1-199': 'Fringe minutes',
  0: 'Did not play',
  '0': 'Did not play',
};

export function rosterContinuityPage(k, model) {
  const l = model.lifecycle;
  const c = l.continuity;
  const dep = l.departures;

  page(k, 'Roster continuity',
    'How often do players who could return appear on the next roster?');
  k.scope([
    `${c.returnable} times a player could have returned`,
    c.unreadable ? `${c.unreadable} more we cannot read` : null,
    `vs ${poolScope(l)}`,
  ]);

  k.reading(continuityNarrative(model));

  // Retention first, and as a bar with the pool as a mark on it rather than
  // two bars and a pair of numbers. `paired` printed "50 · 56%", which asks
  // the reader to remember which of two unlabelled figures is theirs.
  k.heading('Players who could return, and did');
  k.body('Every player on a roster whose programme has the following season on file too. The claret '
    + `line is the median of ${poolScope(l)}.`, { color: MUTED });
  k.bar({
    label: 'All players',
    value: c.retention == null ? null : c.retention * 100,
    max: 100,
    unit: '%',
    marker: c.pool?.median == null ? null : c.pool.median * 100,
    unavailable: c.retention == null
      ? `only ${c.returnable} we can read — too few to quote a rate` : null,
  });
  if (!c.starterRetention.suppressed || c.starterRetention.returnable > 0) {
    k.bar({
      label: `Played ${STARTER_MINUTES}+ minutes`,
      value: c.starterRetention.retention == null ? null : c.starterRetention.retention * 100,
      max: 100,
      unit: '%',
      marker: c.starterRetention.pool?.median == null ? null : c.starterRetention.pool.median * 100,
      unavailable: c.starterRetention.retention == null
        ? `only ${c.starterRetention.returnable} of them — too few to quote a rate` : null,
    });
  }
  // `k.bar` draws its value and its note on one line in the same 88 points, so
  // a note beside the figure printed straight through it. The pool medians go
  // underneath instead, where there is room to name which is which.
  k.gap(2);
  k.note([c.pool?.median == null ? null : `Pool median, all players: ${pc(c.pool.median)}.`,
    c.starterRetention.pool?.median == null ? null
      : `Pool median for players on ${STARTER_MINUTES}+ minutes: ${pc(c.starterRetention.pool.median)}.`,
  ].filter(Boolean).join('  ') || 'No pool figure is available for this division.');

  if (c.unreadable) {
    k.note(`A further ${nf(c.unreadable)} players cannot be read either way: their programme’s next `
      + 'roster is not on file, and an absence proves nothing without one.');
  }
  k.note('This is a count of names on two rosters and nothing more. A player who is not on the next '
    + 'roster may have graduated, moved, been injured, stopped playing, or be sitting behind a '
    + 'spelling we could not match.');

  // By prior role, where the sample allows it.
  const roleRows = c.byRole.filter((r) => r.returnable > 0);
  if (roleRows.length) {
    k.heading('By what they played the season before');
    k.table({
      columns: [
        { key: 'label', label: 'The season before', width: 0.34 },
        { key: 'returnable', label: 'Could return', width: 0.17, align: 'right' },
        { key: 'returned', label: 'Came back', width: 0.16, align: 'right' },
        { key: 'notObserved', label: 'Did not', width: 0.16, align: 'right' },
        { key: 'rate', label: 'Share', width: 0.17, align: 'right' },
      ],
      rows: roleRows.map((r) => ({
        label: ROLE_LABEL[r.key] ?? r.key,
        returnable: r.returnable,
        returned: r.returned,
        notObserved: r.notObserved,
        rate: r.suppressed ? null : pc(r.retention),
      })),
      note: [roleRows.some((r) => r.suppressed)
        ? 'A dash under Share is a group too small to quote a rate over; the counts beside it are '
          + 'the whole of what we know.' : null,
      'Players whose minutes were never published appear in none of these rows — they cannot be '
        + 'placed in a band.'].filter(Boolean).join(' '),
    });
  }

  // ---- departure composition ----
  //
  // Two bars, nested by reading order: the first divides every departure, the
  // second divides the early half of it. This was a table with three indented
  // rows, which stated the hierarchy and did not show it — and the one thing
  // this page must never let a reader do is read the traced group as the whole
  // departure population.
  //
  // The definitions that used to sit in a third column are in the methodology,
  // which already carried them word for word.
  const e = dep.earlyTracing;
  const total = dep.departures.total;
  k.heading('What the departures are made of');
  if (!total) {
    // Every player who could return did. There is no population to divide, and
    // a bar drawn over a denominator of zero is not a picture of that.
    k.body('Every player who could return appeared on the next roster, so there are no departures '
      + 'to describe.', { bold: true });
    return;
  }
  k.body(`On ${plural(total, 'occasion', 'occasions')} a player did not appear on this `
    + 'programme’s next roster. The class label on their last season here is the only thing that '
    + 'says whether a return was expected at all.');

  charts.stackedRows(k, {
    box: k.slot(56),
    title: null,
    subtitle: null,
    rows: [{
      label: 'All departures',
      note: `${dep.departures.total} in total`,
      values: {
        expected: (100 * dep.departures.expectedExits) / total,
        early: (100 * dep.departures.earlyDepartures) / total,
        unknown: (100 * dep.departures.unknownClass) / total,
      },
    }],
    keys: [
      { key: 'expected', label: `senior or graduate (${dep.departures.expectedExits})`, color: PALE, dark: true },
      { key: 'early', label: `seasons still to run (${dep.departures.earlyDepartures})`, color: NAVY },
      ...(dep.departures.unknownClass
        ? [{ key: 'unknown', label: `class not readable (${dep.departures.unknownClass})`, color: MID }] : []),
    ],
    labelW: 130,
    barH: 20,
    unavailable: null,
  });

  if (e.departures > 0) {
    charts.stackedRows(k, {
      // Room for a legend on two lines: this row's is squeezed into the span
      // of its parent's segment, so it wraps where a full-width one would not.
      box: k.slot(68),
      title: null,
      subtitle: null,
      rows: [{
        label: 'Of those, early',
        note: `${e.departures} of them`,
        // Drawn under the navy segment of the bar above and nowhere else.
        trackFrom: dep.departures.expectedExits / total,
        trackTo: (dep.departures.expectedExits + dep.departures.earlyDepartures) / total,
        values: {
          observed: (100 * e.observed) / e.departures,
          ambiguous: (100 * e.ambiguous) / e.departures,
          unresolved: (100 * e.unresolved) / e.departures,
        },
      }],
      keys: [
        { key: 'observed', label: `traced to another roster (${e.observed})`, color: NAVY },
        { key: 'ambiguous', label: `evidence unsettled (${e.ambiguous})`, color: MID },
        { key: 'unresolved', label: `no trace at all (${e.unresolved})`, color: PALE, dark: true },
      ],
      labelW: 130,
      barH: 20,
      unavailable: null,
    });
    k.note('The second bar divides the first bar’s navy segment and nothing else. “Traced” means '
      + 'the same name appears at another programme the next season with enough agreeing detail to '
      + 'be confident it is the same person — most departures cannot be traced at all.');
  }
}

// ---------------------------------------------------------------------------
// Observed destinations
// ---------------------------------------------------------------------------

const FOOTBALL_KEYS = [
  { key: 'STRONGER_FOOTBALL_RATING', label: 'stronger football rating', color: NAVY },
  { key: 'SIMILAR_FOOTBALL_RATING', label: 'similar', color: MID },
  { key: 'LOWER_FOOTBALL_RATING', label: 'lower football rating', color: PALE, dark: true },
];
const ACADEMIC_KEYS = [
  { key: 'HIGHER_ACADEMIC_RATING', label: 'higher academic rating', color: NAVY },
  { key: 'SIMILAR_ACADEMIC_RATING', label: 'similar', color: MID },
  { key: 'LOWER_ACADEMIC_RATING', label: 'lower academic rating', color: PALE, dark: true },
];
const DIVISION_KEYS = [
  { key: 'DIVISION_UP', label: 'a higher division', color: NAVY },
  { key: 'DIVISION_SAME', label: 'the same division', color: MID },
  { key: 'DIVISION_DOWN', label: 'a lower division', color: PALE, dark: true },
];

const asShares = (t, keys) => {
  const total = keys.reduce((s, kk) => s + (t[kk.key] ?? 0), 0);
  if (!total) return null;
  return Object.fromEntries(keys.map((kk) => [kk.key, (100 * (t[kk.key] ?? 0)) / total]));
};

/**
 * The three dimensions, on three separate rows, never summed.
 *
 * A move can be to a lower-rated programme with a stronger academic record in
 * the same division. Combining these into one number would have to decide
 * which of those a family cares about, and it is not the report's decision.
 */
function dimensionRows(dims) {
  return [
    { label: 'Football rating', note: `${dims.football.n} traced moves`,
      values: asShares(dims.football, FOOTBALL_KEYS), keys: FOOTBALL_KEYS },
    { label: 'Academic rating', note: `${dims.academic.n} traced moves`,
      values: asShares(dims.academic, ACADEMIC_KEYS), keys: ACADEMIC_KEYS },
    { label: 'Division', note: `${dims.division.n} traced moves`,
      values: asShares(dims.division, DIVISION_KEYS), keys: DIVISION_KEYS },
  ];
}

function dimensionCharts(k, dims, { compact = false } = {}) {
  dimensionRows(dims).forEach((row) => {
    charts.stackedRows(k, {
      // Title 14, bar, the 12 the chart puts under it, and 10 for the legend.
      // At 46 the legend cleared the box by six points and printed through the
      // table header on the athlete page — the collision guard caught it.
      box: k.slot(compact ? 44 : 48),
      // No chart title: the row's own label is the dimension's name, and both
      // printed "Football rating" one line apart.
      title: null,
      subtitle: null,
      rows: [{ label: row.label, note: row.note, values: row.values,
        unavailable: 'neither programme carries this rating' }],
      keys: row.keys,
      labelW: 118,
      barH: compact ? 18 : 22,
      unavailable: null,
    });
  });
}

export const MOVEMENT_COLUMNS = [
  { key: 'name', label: 'Player', width: 0.19 },
  { key: 'role', label: 'Last season here', width: 0.155, align: 'right' },
  { key: 'destination', label: 'Next roster', width: 0.185 },
  { key: 'division', label: 'Division', width: 0.115 },
  { key: 'football', label: 'Football rating', width: 0.13 },
  { key: 'academic', label: 'Academic rating', width: 0.125 },
  { key: 'post', label: 'Minutes there', width: 0.1, align: 'right', dropWhenEmpty: true },
];

const SHORT = {
  STRONGER_FOOTBALL_RATING: 'stronger', SIMILAR_FOOTBALL_RATING: 'similar',
  LOWER_FOOTBALL_RATING: 'lower',
  HIGHER_ACADEMIC_RATING: 'higher', SIMILAR_ACADEMIC_RATING: 'similar',
  LOWER_ACADEMIC_RATING: 'lower',
  DIVISION_UP: 'up', DIVISION_SAME: 'same', DIVISION_DOWN: 'down',
};

export function movementRows(records) {
  return records.map((m) => ({
    name: m.name,
    role: m.priorRole.minutes == null ? null : `${nf(m.priorRole.minutes)} min`,
    destination: m.destinationProgramme,
    division: m.destinationDivision,
    football: SHORT[m.comparison?.soccerScore?.band] ?? null,
    academic: SHORT[m.comparison?.academicRating?.band] ?? null,
    post: m.outcome?.measured ? `${nf(m.outcome.minutes)} min` : null,
  }));
}

export function observedDestinationsPage(k, model) {
  const l = model.lifecycle;
  const d = l.departures;

  page(k, 'Where we can trace players next',
    'Observed destinations only — many departures cannot be traced from the available roster data.');
  k.scope([
    `${d.departures.total} departures across the seasons on file`,
    `${d.tracing.observed} we could trace`,
  ]);

  k.reading(destinationNarrative(model));

  // Coverage, as the largest thing on the page.
  //
  // It was a paragraph in a tinted box, which said the right thing at the same
  // weight as everything else and repeated the reading block above it. The
  // figure that qualifies every other number here now reads from across a
  // desk, and the sentence beside it says what the page is a sample of.
  {
    const box = k.slot(80);
    const { doc } = k;
    doc.font('Helvetica-Bold').fontSize(30).fillColor(CLARET)
      .text(pc(d.tracing.coverage), box.x, box.y, { width: 96, lineBreak: false });
    doc.font(THEME_LABEL.font).fontSize(THEME_LABEL.size).fillColor(MUTED)
      .text('OF DEPARTURES TRACED', box.x, box.y + 32,
        { width: 110, characterSpacing: THEME_LABEL.spacing });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK)
      .text(`${d.tracing.observed} of ${d.departures.total} departures could be traced to another `
        + `roster. Everything below describes those ${d.tracing.observed}: the other `
        + `${d.tracing.ambiguous + d.tracing.unresolved} appear on no roster we can see, may have `
        + 'moved anywhere or stopped playing, and are not a group this sample stands in for.'
        + (d.tracing.divisionCoverage == null ? ''
          : ` Across ${model.college.division} as a whole, ${pc(d.tracing.divisionCoverage)} of `
            + 'departures can be traced.'),
      box.x + 124, box.y, { width: box.w - 124 });
  }

  charts.stackedRows(k, {
    box: k.slot(72),
    title: 'How much of this programme’s movement can be seen at all',
    subtitle: 'The three groups are exclusive and add to every departure on file.',
    rows: [{
      label: 'All departures',
      note: `${d.departures.total} in total`,
      values: {
        observed: (100 * d.tracing.observed) / d.departures.total,
        ambiguous: (100 * d.tracing.ambiguous) / d.departures.total,
        unresolved: (100 * d.tracing.unresolved) / d.departures.total,
      },
    }],
    keys: [
      { key: 'observed', label: `traced (${d.tracing.observed})`, color: NAVY },
      { key: 'ambiguous', label: `evidence unsettled (${d.tracing.ambiguous})`, color: MID },
      { key: 'unresolved', label: `not traceable (${d.tracing.unresolved})`, color: PALE, dark: true },
    ],
    unavailable: null,
  });

  k.heading('The traced moves, on three separate measures');
  k.body('A move can be to a lower-rated programme, in a stronger academic one, in the same '
    + 'division. These are three facts about the same move and they are never combined into one.',
  { color: MUTED });
  dimensionCharts(k, d.dimensions, { compact: true });

  // Prior role against where they went, where the sample carries it.
  const roleRows = d.byPriorRole.filter((r) => r.observed > 0);
  if (roleRows.length) {
    k.heading('By what they played the season before they left');
    k.table({
      columns: [
        { key: 'label', label: 'Last season here', width: 0.28 },
        { key: 'departures', label: 'Departures', width: 0.15, align: 'right' },
        { key: 'observed', label: 'Traced', width: 0.13, align: 'right' },
        // Short, because the section heading and the note below say what these
        // three measure. Spelled out they wrapped, and the second line of "TO A
        // SIMILAR ONE" landed a point above the first row of data.
        { key: 'stronger', label: 'Stronger', width: 0.14, align: 'right' },
        { key: 'similar', label: 'Similar', width: 0.14, align: 'right' },
        { key: 'lower', label: 'Lower', width: 0.16, align: 'right' },
      ],
      rows: roleRows.map((r) => ({
        label: ROLE_LABEL[r.band] ?? r.band,
        departures: r.departures,
        observed: r.observed,
        stronger: r.football.STRONGER_FOOTBALL_RATING,
        similar: r.football.SIMILAR_FOOTBALL_RATING,
        lower: r.football.LOWER_FOOTBALL_RATING,
      })),
      note: 'Stronger, similar and lower are the football rating of the programme each player was '
        + 'traced to, read against this one. Counts rather than rates: the traced share differs by '
        + 'band, so a percentage would compare samples of different completeness.',
    });
  }

  k.note(`The ${d.tracing.observed} traced moves are listed by name, with the minutes each player `
    + 'went on to play where that season has been played, in the supporting record at the back of '
    + 'this report.');
}

// ---------------------------------------------------------------------------
// The athlete's own position
// ---------------------------------------------------------------------------

export function athletePositionMovementPage(k, model) {
  const l = model.lifecycle;
  const p = l.athletePosition;
  const a = model.athlete;
  const label = positionPlural(p.position) ?? 'players';

  // Set quiet where the position's own sample is a handful of players. A
  // 19pt title over one traced move claims more than one traced move can
  // carry; the supporting record is set this way for the same reason.
  const thin = p.positionRows.length < MIN_POSITION_DESTINATIONS;
  pageHead(k, {
    kicker: thin ? 'Supporting detail' : 'For this athlete',
    quiet: thin,
    title: p.group === 'position'
      ? `${label.replace(/^./, (c) => c.toUpperCase())} here we could trace`
      : `${label.replace(/^./, (c) => c.toUpperCase())} we could trace`,
    question: p.group === 'position'
      ? `When a ${String(p.position).toLowerCase()} has left this programme, where have we been `
        + 'able to see them next?'
      : `When a ${String(p.position).toLowerCase()} has left this programme, where have we been `
        + 'able to see them next?',
  });
  k.scope([
    `${a.positionLabel} — the position ${a.name} plays`,
    `${p.atPositionObserved} of ${p.atPositionDepartures} departures at this position traced`,
    `${p.programmeObserved} traced across the whole programme`,
  ]);

  // Which group is on the page, said outright rather than left to be inferred.
  // A thin sample gets the quiet grey treatment rather than a claret callout:
  // the limitation is real and it is not the loudest thing in the report.
  if (thin) k.aside(p.groupNote, { title: 'How little this is' });
  else {
    k.box(p.groupNote, {
      title: p.group === 'position' ? 'What this page shows' : 'This is not the position on its own',
      color: p.group === 'position' ? NAVY : CLARET,
    });
  }

  // The three measures only where this is genuinely the athlete's position.
  // Broadened to the programme they are the same three bars the destinations
  // page drew a few pages earlier, and a report should not say a thing twice
  // in order to fill a module.
  if (p.group === 'position') {
    dimensionCharts(k, p.dimensions, { compact: true });
    k.table({
      columns: MOVEMENT_COLUMNS,
      rows: movementRows(p.rows),
      continued: 'The traced moves, named (continued)',
      note: p.omitted ? `${p.omitted} further traced moves at this position are not listed; every `
        + 'one of them is in the supporting record at the back of this report.' : null,
    });
  } else if (p.positionRows.length) {
    // The position's own traced moves, however few. The programme-wide list is
    // in the supporting record and is not reprinted here.
    k.body(`${plural(p.positionRows.length, 'traced move', 'traced moves')} at this position, and `
      + `${p.positionRows.length === 1 ? 'it is' : 'they are'} shown because `
      + `${p.positionRows.length === 1 ? 'it is' : 'they are'} what there is:`);
    k.table({ columns: MOVEMENT_COLUMNS, rows: movementRows(p.positionRows) });
    k.note('Every traced move from this programme, at any position, is listed in the supporting '
      + 'record at the back of this report; the three measures across all of them are on the '
      + 'destinations page earlier. Nothing here is a prediction, and nothing here says why any of '
      + 'these players moved.');
    return;
  } else {
    k.body('No departure at this position could be traced to another roster at all.', { bold: true });
    k.note(`Every traced move from this programme — ${p.programmeObserved} of them, at other `
      + 'positions — is listed in the supporting record at the back of this report.');
    return;
  }

  k.note('These are the departures we could trace, which are a minority of the departures. Nothing '
    + 'here is a prediction, and nothing here says why any of these players moved.');
}
