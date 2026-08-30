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
import { charts, THEME, pageHead, fitText } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';
import { positionPlural } from '../../shared/positions.js';

const { MUTED, CLARET, NAVY, MID, PALE, GREEN, INK, W, M } = THEME;

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
  k.scope([
    `${plural(d.players, 'first-year', 'first-years')} followed from their first season here`,
    `${cov.measured} of ${cov.playerSeasons} of their seasons carry published minutes`,
    `compared against ${poolScope(l)}`,
  ]);

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
      count: `${y.reached} of ${y.denominator}`,
      unavailable: !cov.readable ? 'minutes not published here'
        : y.denominator === 0 ? 'no player has been here this long'
          : 'cohort too small to quote a share',
    })),
    poolLabel: `the grey mark is the median of ${poolScope(l)} in ${l.poolScope}`,
    unavailable: d.players ? null : 'no first-year here has a season on file',
  });

  if (!cov.readable) {
    k.aside(`Only ${cov.measured} of ${cov.playerSeasons} first-year seasons here carry a published `
      + 'minutes figure, so no share is quoted above. The counts are real; the percentages would '
      + 'not be, and a zero drawn from unpublished minutes reads exactly like a programme whose '
      + 'first-years never play.', { title: 'Why there are no percentages here' });
  } else {
    k.body(`${d.everStarter.reached} of ${d.everStarter.denominator} first-years with published `
      + `minutes have reached a ${STARTER_MINUTES}-minute season here at some point — `
      + `${BAND_WORD[d.everStarter.band]}.`, { bold: true });
  }

  // Individual lines, only for a cohort small enough to follow.
  const tr = d.trajectories;
  if (tr.shown.length) {
    const max = Math.max(1600, ...tr.shown.flatMap((t) => t.points.map((p) => p.minutes)));
    const years = Math.max(2, ...tr.shown.flatMap((t) => t.points.map((p) => p.year)));
    charts.trajectories(k, {
      box: k.slot(190),
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
      + 'the longest careers on file here, not the best ones — the selection rule is stated above '
      + 'so nothing has been chosen for how it looks.');
  } else {
    k.aside('No first-year here has three or more seasons of published minutes, so there is no '
      + 'career long enough to draw. That is a limit of what these rosters record, not a statement '
      + 'about how long players stay.', { title: 'No individual careers to draw' });
  }

  // The compact secondary module.
  const t = d.timeToStarter;
  k.heading('Time to 600 minutes');
  if (t.suppressed || t.denominator === 0) {
    k.note(`Not shown. It can only be asked of players who arrived by ${t.entrySeasonsUpTo} — early `
      + 'enough to have had three seasons with published minutes here — and '
      + `${t.denominator === 0 ? 'no first-year' : `only ${plural(t.denominator, 'first-year', 'first-years')}`}`
      + ' here qualifies.');
  } else {
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
    `${c.returnable} player-seasons where the next roster is on file`,
    c.unreadable ? `${c.unreadable} where it is not, and absence proves nothing` : null,
    `compared against ${poolScope(l)}`,
  ]);

  // Retention first.
  charts.paired(k, {
    // 38 points a row plus the legend beneath it, plus the chart's own title
    // and subtitle. `paired` draws its legend at the foot of its plot, so a
    // box sized to the bars alone puts that legend on the facts below.
    box: k.slot(26 + (c.starterRetention.suppressed ? 1 : 2) * 38 + 16),
    title: 'Players who could return, and did',
    subtitle: 'Every player on a roster whose programme has the following season on file too.',
    rows: [
      { label: 'All players', a: c.retention == null ? null : c.retention * 100,
        b: c.pool?.median == null ? null : c.pool.median * 100 },
      ...(c.starterRetention.suppressed ? [] : [{
        label: `Played ${STARTER_MINUTES}+ minutes`,
        a: c.starterRetention.retention == null ? null : c.starterRetention.retention * 100,
        b: c.starterRetention.pool?.median == null ? null : c.starterRetention.pool.median * 100,
      }]),
    ],
    aLabel: 'this programme (navy)',
    bLabel: `median of ${poolScope(l)} (pale)`,
    max: 100,
    unit: '%',
    unavailable: c.retention == null && c.starterRetention.suppressed
      ? `${c.returnable} readable player-seasons is too few to quote a rate over`
      : null,
  });

  k.body(`${nf(c.returned)} of ${nf(c.returnable)} player-seasons that could return did`
    + `${c.retention == null ? '' : ` — ${pc(c.retention)}, ${BAND_WORD[c.band]}`}.`
    + `${c.unreadable ? ` A further ${nf(c.unreadable)} cannot be read either way: the following `
      + 'season’s roster is not on file, and absence proves nothing without one.' : ''}`,
  { bold: true });
  k.note('This is a count of names on two rosters and nothing more. A player who is not on the next '
    + 'roster may have graduated, moved, been injured, stopped playing, or be sitting behind a '
    + 'spelling we could not match. A programme whose players return less often than the pool is a '
    + 'programme whose players return less often than the pool, and nothing else.');

  // By prior role, where the sample allows it.
  const roleRows = c.byRole.filter((r) => r.returnable > 0);
  if (roleRows.length) {
    k.heading('By what they played the season before');
    k.table({
      columns: [
        { key: 'label', label: 'The season before', width: 0.32 },
        { key: 'returnable', label: 'Could return', width: 0.17, align: 'right' },
        { key: 'returned', label: 'Came back', width: 0.17, align: 'right' },
        { key: 'notObserved', label: 'Not on next roster', width: 0.19, align: 'right' },
        { key: 'rate', label: 'Came back', width: 0.15, align: 'right' },
      ],
      rows: roleRows.map((r) => ({
        label: ROLE_LABEL[r.key] ?? r.key,
        returnable: r.returnable,
        returned: r.returned,
        notObserved: r.notObserved,
        rate: r.suppressed ? null : pc(r.retention),
      })),
      note: 'A dash in the last column is a group too small to quote a rate over; the counts beside '
        + 'it are the whole of what we know. Players whose minutes were never published appear in '
        + 'none of these rows — they cannot be placed in a band.',
    });
  }

  // ---- departure composition ----
  //
  // One table, with the traceable/untraceable split indented under the group it
  // belongs to. Drawn as two separate blocks it read as two independent
  // findings that happened to sit on the same page, and a reader had to do the
  // arithmetic to see that the second was a subdivision of a line in the first.
  const e = dep.earlyTracing;
  k.heading('What the departures are made of');
  k.body(`${plural(dep.departures.total, 'player-season', 'player-seasons')} ended without the `
    + 'player appearing on this programme’s next roster. The class label on their last season here '
    + 'is the only thing that says whether a return was expected at all.');
  k.table({
    columns: [
      { key: 'label', label: 'Group', width: 0.42 },
      { key: 'n', label: 'Player-seasons', width: 0.18, align: 'right' },
      { key: 'what', label: 'What this group is', width: 0.4 },
    ],
    rows: [
      { label: 'Expected exits', n: dep.departures.expectedExits,
        what: 'senior or graduate — the last season they were listed for' },
      { label: 'Early departures', n: dep.departures.earlyDepartures,
        what: 'first-year, sophomore or junior — seasons remained' },
      ...(e.departures ? [
        { label: '   of those, traced to another roster', n: e.observed,
          what: 'the same name elsewhere, with agreeing detail' },
        { label: '   of those, a name we could not settle', n: e.ambiguous,
          what: 'the name appears elsewhere; the evidence does not decide it' },
        { label: '   of those, no trace at all', n: e.unresolved,
          what: 'the name appears on no other roster we hold' },
      ] : []),
      ...(dep.departures.unknownClass ? [{
        label: 'Class not readable', n: dep.departures.unknownClass,
        what: 'no class label we could rank, so neither can be claimed' }] : []),
    ],
    note: 'The three indented rows divide the early departures and nothing else; they do not add to '
      + 'the total above them. Eligibility years are not used here — they are a fixed arithmetic '
      + 'step from the class label in every row on file, so reading them as separate evidence would '
      + 'classify every graduation as an early departure.',
  });
  k.note('“Traced” means the same name appears at another programme the next season with enough '
    + 'agreeing detail — hometown, position, class progression — to be confident it is the same '
    + 'person. It is not a record of transfers: most departures cannot be traced at all, and how '
    + 'many can depends on how completely rosters in that division were published.');
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

function dimensionCharts(k, dims, { compact = false, lead = null } = {}) {
  dimensionRows(dims).forEach((row, i) => {
    charts.stackedRows(k, {
      // Title 14, bar, the 12 the chart puts under it, and 10 for the legend.
      // At 46 the legend cleared the box by six points and printed through the
      // table header on the athlete page — the collision guard caught it.
      box: k.slot((compact ? 56 : 60) + (i === 0 && lead ? 12 : 0)),
      title: row.label,
      subtitle: i === 0 ? lead : null,
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
    `${d.tracing.observed} traced to another roster`,
    `${pc(d.tracing.coverage)} of departures`,
  ]);

  // Coverage first, and at full size. It is the finding that qualifies every
  // other figure on the page, and a footnote would not carry it.
  charts.stackedRows(k, {
    box: k.slot(84),
    title: 'How much of this programme’s movement can be seen at all',
    subtitle: 'The three groups are exclusive and add to every departure on file.',
    rows: [{
      label: 'All departures',
      note: `${d.departures.total} player-seasons`,
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

  // The counts are in the bar above and its legend. Repeating them as a fact
  // list said the same five numbers twice and cost a third of the page; what
  // has to be said in prose is what the sample IS, which the bar cannot say.
  k.box(`Everything below describes the ${d.tracing.observed} departures we could trace. `
    + `${d.tracing.unresolved} more left and appear on no roster we can see; they may have moved `
    + 'anywhere, or stopped playing. The traced group is not a random sample of the rest.'
    + (d.tracing.divisionCoverage == null ? ''
      : ` Across this division, ${pc(d.tracing.divisionCoverage)} of departures can be traced.`),
  { title: 'What this page is a sample of' });

  // Three measures, three bars, never one number. The sentence that used to
  // introduce them is in the first chart's subtitle instead: a heading and a
  // paragraph to say "these are separate" cost half the space the charts
  // themselves needed to stay on one page with the rows they describe.
  k.heading('The traced moves, on three separate measures');
  dimensionCharts(k, d.dimensions, { compact: true, lead: 'A move can be to a lower-rated '
    + 'programme, in a stronger academic one, in the same division. These are three facts about '
    + 'the same move and they are never combined into one.' });

  // Prior role against where they went, where the sample carries it.
  const roleRows = d.byPriorRole.filter((r) => r.observed > 0);
  if (roleRows.length) {
    k.heading('By what they played the season before they left');
    k.table({
      columns: [
        { key: 'label', label: 'Last season here', width: 0.26 },
        { key: 'departures', label: 'Departures', width: 0.14, align: 'right' },
        { key: 'observed', label: 'Traced', width: 0.12, align: 'right' },
        { key: 'stronger', label: 'To a stronger rating', width: 0.16, align: 'right' },
        { key: 'similar', label: 'To a similar one', width: 0.16, align: 'right' },
        { key: 'lower', label: 'To a lower rating', width: 0.16, align: 'right' },
      ],
      rows: roleRows.map((r) => ({
        label: ROLE_LABEL[r.band] ?? r.band,
        departures: r.departures,
        observed: r.observed,
        stronger: r.football.STRONGER_FOOTBALL_RATING,
        similar: r.football.SIMILAR_FOOTBALL_RATING,
        lower: r.football.LOWER_FOOTBALL_RATING,
      })),
      note: 'Counts, not rates: the traced share differs by band, so a percentage would compare '
        + 'samples of different completeness. Nothing here says why anybody moved.',
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

  pageHead(k, {
    kicker: 'For this athlete',
    title: p.group === 'position'
      ? `${label.replace(/^./, (c) => c.toUpperCase())} here we could trace`
      : 'Players here we could trace',
    question: p.group === 'position'
      ? `When a ${String(p.position).toLowerCase()} has left this programme, where have we been `
        + 'able to see them next?'
      : 'When a player has left this programme, where have we been able to see them next?',
  });
  k.scope([
    `${a.positionLabel} — the position ${a.name} plays`,
    `${p.atPositionObserved} of ${p.atPositionDepartures} departures at this position traced`,
    `${p.programmeObserved} traced across the whole programme`,
  ]);

  // Which group is on the page, said outright rather than left to be inferred.
  k.box(p.groupNote, {
    title: p.group === 'position' ? 'What this page shows' : 'This is not the position on its own',
    color: p.group === 'position' ? NAVY : CLARET,
  });

  dimensionCharts(k, p.dimensions, { compact: true });

  if (p.rows.length) {
    k.table({
      columns: MOVEMENT_COLUMNS,
      rows: movementRows(p.rows),
      continued: 'The traced moves, named (continued)',
      note: p.omitted ? `${p.omitted} further traced moves are not listed.` : null,
    });
  }
  k.note('These are the departures we could trace, which are a minority of the departures. Nothing '
    + 'here is a prediction, and nothing here says why any of these players moved.');
}
