/**
 * The Program Report: one document, three parts.
 *
 *   1. How this programme uses first-years.
 *   2. How it uses the transfer market.
 *   3. What each part of one athlete's profile changes about the first two.
 *
 * Written for the athlete and their family. Two rules run through every page.
 * Nothing here is a forecast — the season being recruited into has not been
 * played, and the document says so on page one at full size. And every absence
 * states its reason: a chart handed no data and no reason throws rather than
 * drawing an empty axis, because an empty axis reads as a confident zero.
 */
import {
  kit, render, charts, THEME, masthead, whatThisIs, whoRunsIt, ladderSection,
  benchmarkSection, fillMixSection, positionSection, limits, footer, humanCohort,
  minutes,
} from './philosophyPdf.js';
import { STARTER_MINUTES, arrivedFromElsewhere } from '../../shared/philosophy.js';
import { positionPlural } from '../../shared/positions.js';
import { contentsPage, programmeAtAGlance, athleteAtAGlance } from './reportFront.js';
import {
  freshmanIntakePage, freshmanLadderPage, freshmanDevelopmentPage,
  experiencedArrivalIntakePage, experiencedArrivalProfilePage,
  replacingMinutesPage, replacementByPositionPage,
  currentSquadOutlookPage, currentDepthPage,
} from './reportEvidence.js';
import {
  positionHistoryPage, positionOpeningsPage, currentPositionPage,
  arrivalWindowPage, originPage,
} from './reportAthlete.js';
import {
  freshmanRecordPage, arrivalRecordPage, vacancyRecordPage, methodologyPage,
} from './reportAppendix.js';

const { INK, MUTED, CLARET, NAVY, MID, PALE, GREEN } = THEME;

const ord = (n) => `${n}${['', 'st', 'nd', 'rd'][n] || 'th'}`;
const cap = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A part divider, so the reader always knows which of the three they are in. */
function part(k, number, title, lede) {
  k.doc.addPage();
  k.doc.font('Helvetica-Bold').fontSize(8).fillColor(CLARET)
    .text(`PART ${number}`, THEME.M, THEME.M - 18, { width: THEME.W, characterSpacing: 1.2 });
  k.title(title);
  if (lede) k.body(lede, { color: MUTED });
  k.gap(6);
}

// ---------------------------------------------------------------------------
// Part 1 — the freshman intake
// ---------------------------------------------------------------------------

function everyFreshman(k, model) {
  const pts = model.freshman.points;
  const seasons = model.freshman.intake.map((s) => s.season);
  const xMax = Math.max(1600, ...pts.map((p) => p.minutes));
  const maxGames = Math.max(1, ...pts.map((p) => p.gamesPlayed));
  charts.scatter(k, {
    box: k.slot(seasons.length * 26 + 34),
    title: 'Every freshman of the last four seasons',
    subtitle: 'One dot per player. Further right is more minutes; bigger is more games. '
      + 'A filled dot started at least half of them.',
    lanes: seasons,
    xMax,
    marker: STARTER_MINUTES,
    markerLabel: `${STARTER_MINUTES} — a starter's season`,
    points: pts.map((p) => ({
      lane: p.season, value: p.minutes, size: p.gamesPlayed, sizeMax: maxGames,
      solid: p.gamesStarted >= p.gamesPlayed / 2 && p.gamesPlayed > 0,
      color: p.origin === 'international' ? GREEN : NAVY,
    })),
    unavailable: pts.length ? null
      : 'no season on file carries enough recorded minutes to place a freshman',
  });
  k.note('Navy is a domestic recruit, green an international one. A player whose minutes were '
    + 'never published is left out rather than drawn at zero.');
}

function intakeColumns(k, model) {
  const rows = model.freshman.intake;
  const yMax = Math.max(1, ...rows.map((s) => s.freshmen));
  charts.columns(k, {
    box: k.slot(140),
    title: 'How many arrive, and how many of them play',
    subtitle: 'Every first-year on the roster, then those given a minute, then those who played '
      + `a ${STARTER_MINUTES}-minute season.`,
    yMax,
    groups: rows.map((s) => ({
      label: s.season,
      note: s.readable ? `${s.freshmen} in` : null,
      bars: s.readable ? [
        { key: 'in', value: s.freshmen, color: PALE },
        { key: 'played', value: s.freshmanPlayed, color: MID },
        { key: 'started', value: s.freshmanStarters, color: NAVY },
      ] : [{ key: 'in', value: null }],
    })),
    unavailable: rows.length ? null : 'no seasons on file',
  });
  k.note('Pale is everyone who arrived, mid-blue those who got on the pitch, navy those who '
    + 'played a starter’s season.');
}

function developmentSection(k, model) {
  const pairs = model.freshman.progression;
  const max = Math.max(1600, ...pairs.flatMap((p) => [p.year1, p.year2 ?? 0]));
  charts.slope(k, {
    box: k.slot(166),
    title: 'From the first year to the second',
    subtitle: 'One line per freshman. Rising means more minutes in year two.',
    pairs: pairs.map((p) => ({ from: p.year1, to: p.year2 ?? 0, toState: p.year2State })),
    max,
    leftLabel: 'first year',
    rightLabel: 'second year',
    unavailable: pairs.length ? null
      : 'no freshman here has a following season on file to compare against',
  });
  const r = model.freshman.retention;
  if (r) {
    k.body(`${r.stayed} of ${r.of} freshmen were still on the roster a year later.`);
    k.note('A name leaving a roster can mean a transfer, an injury, a player who stopped '
      + 'playing, or a spelling we could not match. It is the one departure that cannot mean '
      + 'graduation, which is why it is worth showing — but it is not four separate facts.');
  }
}

function heatSection(k, model) {
  const seasons = model.freshman.intake.map((s) => s.season);
  const rows = model.freshman.grid
    .map((g) => ({
      label: cap(positionPlural(g.position)),
      cells: g.cells
        .filter((c) => seasons.includes(c.season))
        .map((c) => ({ value: c.share, n: c.players })),
    }))
    .filter((r) => r.cells.some((c) => c.value != null));
  charts.heatGrid(k, {
    box: k.slot(rows.length * 22 + 24),
    title: 'Which positions the freshmen actually play in',
    subtitle: 'The share of each position’s minutes that went to first-years. n is how many '
      + 'players the cell is built from.',
    cols: seasons,
    rows,
    unavailable: rows.length ? null
      : 'no position group here carries enough recorded minutes to read season by season',
  });
}

function cliffSection(k, model) {
  const cliff = model.squad.cliff;
  const yMax = Math.max(1, ...(cliff ?? []).map((y) => y.total));
  charts.columns(k, {
    box: k.slot(142),
    title: 'When places actually come free',
    subtitle: `Minutes on the ${model.squadSeason} roster whose eligibility ends in each year, `
      + 'from the squad currently on campus.',
    yMax,
    unit: ' min',
    groups: (cliff ?? []).map((y) => ({
      label: `end of ${y.year}`,
      note: `${Math.round(y.total).toLocaleString('en-US')}`,
      bars: [{ key: 'min', value: y.total, color: y.year === model.entrySeason ? CLARET : NAVY }],
    })),
    unavailable: cliff?.length ? null
      : `no ${model.squadSeason} roster on file for this programme, so we cannot say when a place opens`,
  });
  if (cliff?.length && model.entrySeason) {
    const at = cliff.find((y) => y.year === model.entrySeason);
    if (at) {
      k.body(`${Math.round(at.total).toLocaleString('en-US')} minutes are due to come free at the `
        + `end of ${model.entrySeason}.`, { bold: true });
    }
  }
  k.note('Projected from each player’s last eligible season and the minutes they are expected to '
    + 'play. A fifth year, a transfer out or an injury all move it.');
}

// ---------------------------------------------------------------------------
// Part 2 — the transfer intake
// ---------------------------------------------------------------------------

function transferHeadline(k, model) {
  const t = model.transfer;
  if (!t.measurable) {
    k.box('We cannot say whether this programme signs transfers: none of the seasons on file has '
      + 'the season before it on file too, and an arrival is only visible by comparison.',
    { color: CLARET });
    return;
  }
  if (t.density === 'none') {
    k.box(`Across ${plural(t.window.measurable.length, 'season', 'seasons')} we can measure, this `
      + 'programme did not add a single player who was not a first-year. It builds from its own '
      + 'recruiting class. About a quarter of programmes in this sport are the same.',
    { color: GREEN });
    return;
  }
  k.body(`${plural(t.points.length, 'player', 'players')} arrived here who were not first-years `
    + `across ${plural(t.window.measurable.length, 'season', 'seasons')} — transfers, junior-college `
    + 'arrivals, or older recruits. The roster cannot tell those apart, and for a recruit they '
    + 'mean the same thing: somebody brought in ready to play.');
}

function everyTransfer(k, model) {
  const t = model.transfer;
  if (t.density === 'none' || !t.measurable) return;
  if (t.density === 'few') {
    k.heading('Who they were');
    k.facts(t.points.map((p) => [
      `${p.season}  ${p.name}`,
      `${cap(positionPlural(p.position)).replace(/s$/, '')} · ${p.classLabel ?? 'class not stated'}`
      + ` · ${minutes(p.minutes)}${p.gamesStarted ? `, ${p.gamesStarted} starts` : ''}`,
    ]));
    k.note('Too few to describe a policy. This is what happened, not what the programme does.');
    return;
  }
  // Only the seasons an arrival could be detected in. A lane for a season with
  // no prior roster on file would be drawn empty, and an empty lane reads as
  // "nobody came" when it means "we could not look".
  const seasons = t.window.measurable;
  const xMax = Math.max(1600, ...t.points.map((p) => p.minutes));
  const maxGames = Math.max(1, ...t.points.map((p) => p.gamesPlayed));
  charts.scatter(k, {
    box: k.slot(seasons.length * 26 + 34),
    title: 'Every arrival who was not a first-year',
    subtitle: 'Drawn the same way as the freshmen, so the two pages can be read against each other.',
    lanes: seasons,
    xMax,
    marker: STARTER_MINUTES,
    markerLabel: `${STARTER_MINUTES} — a starter's season`,
    points: t.points.map((p) => ({
      lane: p.season, value: p.minutes, size: p.gamesPlayed, sizeMax: maxGames,
      solid: p.gamesStarted >= p.gamesPlayed / 2 && p.gamesPlayed > 0, color: GREEN,
    })),
    unavailable: null,
  });
  if (t.window.unmeasurable.length) {
    k.note(`${t.window.unmeasurable.join(' and ')} ${t.window.unmeasurable.length === 1 ? 'is' : 'are'} `
      + 'not shown: without the season before it on file, an arrival cannot be told from a returner.');
  }
}

function freshmanVsTransfer(k, model) {
  const rows = model.freshman.intake.filter((s) => s.readable);
  const yMax = Math.max(1, ...rows.flatMap((s) => [s.freshmanMinutes ?? 0, s.newcomerMinutes ?? 0]));
  charts.columns(k, {
    box: k.slot(140),
    title: 'Who gets the minutes',
    subtitle: 'Minutes played by first-years against minutes played by everyone else who arrived.',
    yMax,
    unit: ' min',
    groups: model.freshman.intake.map((s) => ({
      label: s.season,
      bars: s.readable ? [
        { key: 'fresh', value: s.freshmanMinutes, color: NAVY },
        { key: 'new', value: s.arrivalsMeasurable ? s.newcomerMinutes : null, color: GREEN },
      ] : [{ key: 'fresh', value: null }],
    })),
    unavailable: rows.length ? null : 'no season on file carries enough recorded minutes',
  });
  k.note('Navy is first-years, green everyone else who arrived. A season with no bar is one whose '
    + 'minutes were never published.');
}

function namedArrivalsSection(k, model) {
  const arrivals = model.squad.arrivals;
  k.heading(`Named arrivals for ${model.squadSeason}`);
  if (!model.squad.rostered) {
    k.body(`No ${model.squadSeason} roster is on file for this programme, so we cannot name who `
      + 'has arrived.', { color: MUTED });
    return;
  }
  if (!arrivals.length) {
    k.body(`Nobody on the ${model.squadSeason} roster is recorded as arriving from another `
      + 'programme.', { color: MUTED });
    return;
  }
  k.facts(arrivals.map((a) => [
    a.name,
    `${cap(positionPlural(a.position)).replace(/s$/, '')} · ${a.classLabel ?? 'class not stated'}`
    + ` · from ${a.from}`,
  ]));
  k.note('This is the only place in the report where an arrival is named rather than inferred — '
    + 'the roster records where these players came from.');
}

// ---------------------------------------------------------------------------
// Part 3 — the athlete, one facet at a time
// ---------------------------------------------------------------------------

function facetPosition(k, model) {
  const a = model.athlete;
  const ph = model.fit?.position;
  k.heading(`If you are a ${positionPlural(a.position).replace(/s$/, '')}`);
  const grid = model.freshman.grid.find((g) => g.position === (model.fit?.asked?.position ?? ''));
  if (grid) {
    charts.heatGrid(k, {
      box: k.slot(46),
      title: `${cap(positionPlural(a.position))} — the share of the position’s minutes that went to first-years`,
      cols: grid.cells.map((c) => c.season),
      rows: [{ label: cap(positionPlural(a.position)), cells: grid.cells.map((c) => ({ value: c.share, n: c.players })) }],
      unavailable: grid.cells.some((c) => c.share != null) ? null
        : 'this position does not carry enough recorded minutes here to read',
    });
  }
  if (!ph || !ph.transitions) {
    k.body('There is not enough recorded at this position to say how it behaves when a place '
      + 'comes free.', { color: MUTED });
    return;
  }
  k.facts([
    ['Seasons we can read', String(ph.transitions)],
    ['Starters who left', String(ph.startersDeparted)],
    ['Seasons that opened a place', `${ph.openings} of ${ph.transitions}`],
    ['…where a first-year then started', `${ph.freshmanTookIt} of ${ph.openings}`],
    ['…where an experienced arrival did', `${ph.newcomerTookIt} of ${ph.openings}`],
  ]);
  for (const s of ph.seasons) {
    const names = s.departedNames.map((d) => `${d.name} (${minutes(d.minutes)})`).join(', ');
    k.body(`${s.season}: ${s.startersDeparted ? `${names} left` : 'no starter left'}`
      + ` — ${plural(s.freshStarters, 'first-year started', 'first-years started')}`
      + `${s.newcomerStarters ? `, and ${plural(s.newcomerStarters, 'experienced arrival', 'experienced arrivals')}` : ''}.`);
  }
  if (ph.openings > 0 && ph.openings < 3) {
    k.box(`Only ${plural(ph.openings, 'place has', 'places have')} come free at this position in `
      + 'the seasons on file. That is too few to be a pattern — read it as what happened, not as '
      + 'odds.', { color: CLARET });
  }
}

/**
 * Whether where the athlete is arriving from changes what the record says.
 *
 * The pool figures are READ FROM THE MODEL. This section used to carry a
 * sentence claiming an international first-year is "about 40% more likely to
 * play a starter's season — 37% against 27% — but the effect disappears
 * entirely at Division III". It sat beside computed numbers and looked like
 * one. Measured against the pool it described: 36.2% against 21.3%, six points
 * out on the domestic half, and at Division III in the women's game the
 * relationship reverses rather than disappearing. No percentage is written
 * into this file any more.
 */
function facetOrigin(k, model) {
  const a = model.athlete;
  const o = model.summary?.athlete?.originContext ?? null;
  k.heading(a.origin === 'international'
    ? 'If you are arriving from outside the United States'
    : 'If you are arriving from within the United States');

  if (!o?.requestedOrigin) {
    k.body('No origin is recorded for this athlete, so we cannot read the record by background.',
      { color: MUTED });
    return;
  }

  const here = o.programme;
  const pct = (v) => (v == null ? null : Math.round(v * 100));
  charts.paired(k, {
    box: k.slot(72),
    title: 'First-years here who played a starter’s season',
    subtitle: `${here.sameOrigin.players} and ${here.otherOrigin.players} players respectively.`,
    rows: [
      { label: a.origin === 'international' ? 'International' : 'From the US', a: pct(here.sameOrigin.share), b: null },
      { label: a.origin === 'international' ? 'From the US' : 'International', a: pct(here.otherOrigin.share), b: null },
    ],
    aLabel: '', bLabel: '', max: 100, unit: '%',
    unavailable: here.sameOrigin.share != null || here.otherOrigin.share != null ? null
      : 'too few first-years here record where they came from to split them',
  });
  k.body(`${here.sameOrigin.players} of this programme’s ${here.withRecordedOrigin} first-years with `
    + `an origin on file came from ${a.origin === 'international' ? 'outside' : 'within'} the United `
    + `States${here.withoutRecordedOrigin ? `, and ${here.withoutRecordedOrigin} record none` : ''}.`);

  if (o.pool?.sameOrigin?.impactShare != null) {
    const scopeLabel = o.pool.scope === 'division' ? o.pool.division : 'the whole pool';
    k.facts([
      [`Same background, across ${scopeLabel}`,
        `${pct(o.pool.sameOrigin.impactShare)}% of ${o.pool.sameOrigin.players.toLocaleString('en-US')}`],
      [`The other group, across ${scopeLabel}`,
        `${pct(o.pool.otherOrigin.impactShare)}% of ${o.pool.otherOrigin.players.toLocaleString('en-US')}`],
    ]);
    k.note('Measured across this division rather than the game as a whole, because the relationship '
      + 'is not one thing: it runs one way at Division I and Division II and reverses at Division '
      + 'III in the women\'s game. It describes who has played, not why — where a player comes from '
      + 'is not the cause of the difference. We can tell a US recruit from an international one, '
      + 'but not one country from another: there are never enough players from a single country at '
      + 'one programme to measure.');
  } else if (o.poolReason) {
    k.note(`No benchmark comparison is shown: ${o.poolReason}.`);
  }
}

function facetEntry(k, model) {
  const a = model.athlete;
  k.heading(`The squad you would be joining in ${model.entrySeason}`);
  const depth = model.squad.depth;
  if (!depth?.length) {
    k.body(`No ${model.squadSeason} roster is on file for this programme, so we cannot show who is `
      + 'already at your position.', { color: MUTED });
    return;
  }
  k.body(`Every ${positionPlural(a.position).replace(/s$/, '')} on the ${model.squadSeason} roster, `
    + 'with the minutes they are expected to play and the year their eligibility runs out.',
  { color: MUTED });
  k.facts(depth.slice(0, 10).map((d) => [
    d.name,
    `${d.classLabel ?? 'class not stated'}`
    + `${d.projectedMinutes != null ? ` · about ${minutes(d.projectedMinutes)} expected` : ''}`
    + `${d.eligibleTo != null ? ` · eligible through ${d.eligibleTo}` : ''}`
    + `${arrivedFromElsewhere(d.arrivedFrom, model.college.name) ? ` · from ${d.arrivedFrom}` : ''}`,
  ]));
  const goneBy = depth.filter((d) => d.eligibleTo != null && d.eligibleTo < model.entrySeason).length;
  if (goneBy) {
    k.body(`${plural(goneBy, 'of them is', 'of them are')} out of eligibility before ${model.entrySeason}.`,
      { bold: true });
  }
  if (!model.entrySeasonKnown) {
    k.box(`We hold rosters and coaching records through ${model.squadSeason}. You would arrive in `
      + `${model.entrySeason}, so who is in charge and who is on the squad by then is not `
      + 'something this report can tell you.', { color: CLARET });
  }
}

function facetLevel(k, model) {
  const a = model.athlete;
  k.heading('Level');
  const score = model.college.soccer_score;
  k.facts([
    ['This programme', score == null ? 'not rated' : `${Math.round(score)} of 100 · ${model.college.division}`],
    ['Your stated level', a.level == null ? 'not stated' : `${a.level} of 10`],
  ]);
  k.box('These two are not the same measurement and must not be read as one. The programme’s '
    + 'rating is built from results; your level is what you entered on the form. They are '
    + 'printed together because the gap is worth thinking about, not because it has been '
    + 'measured.', { color: CLARET });
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function renderProgramReport(model) {
  return render((k) => {
    const c = model.college;
    const a = model.athlete;
    const plan = model.sections ?? [];

    /**
     * Where each section actually started.
     *
     * `bufferedPageRange().count` is the number of pages that exist, so while
     * the document is written forward it is also the 1-based index of the page
     * being written. `atNext` records the page a section is ABOUT to open,
     * which is what the evidence pages need: each one begins by adding a page
     * of its own.
     */
    const pages = new Map();
    const at = (id) => { pages.set(id, k.doc.bufferedPageRange().count); };
    const atNext = (id) => { pages.set(id, k.doc.bufferedPageRange().count + 1); };

    /**
     * Render a section only where the registry says it has something to say.
     *
     * The plan decides, not the page: a section that discovers its own
     * emptiness has already opened a page by the time it finds out, and an
     * empty page is exactly what the dynamic-page rule exists to prevent.
     */
    const planned = new Set(plan.map((x) => x.id));
    const section = (id, draw) => {
      if (!planned.has(id)) return;
      atNext(id);
      draw();
    };

    // Page one is reserved for the contents and drawn last, once the section
    // starts are known. Nothing is written to it here.
    k.doc.addPage();

    at('programme-at-a-glance');
    programmeAtAGlance(k, model);

    if (a) {
      k.doc.addPage();
      at('athlete-at-a-glance');
      athleteAtAGlance(k, model);
    }

    // ---- the programme evidence layer ----

    section('freshman-intake', () => freshmanIntakePage(k, model));
    section('freshman-ladder', () => freshmanLadderPage(k, model));
    section('freshman-development', () => freshmanDevelopmentPage(k, model));
    section('experienced-arrival-intake', () => experiencedArrivalIntakePage(k, model));
    section('current-arrivals', () => experiencedArrivalProfilePage(k, model));
    section('replacing-minutes', () => replacingMinutesPage(k, model));
    section('replacement-by-position', () => replacementByPositionPage(k, model));
    section('eligibility-outlook', () => currentSquadOutlookPage(k, model));
    section('current-depth', () => currentDepthPage(k, model));

    // ---- the athlete evidence layer ----
    //
    // facetLevel is deliberately absent. It printed a results-derived
    // programme rating out of 100 beside a self-entered athlete level out of
    // 10, then disclaimed the comparison it had just invited. The honest
    // version is not to print them together.

    section('athlete-position-history', () => positionHistoryPage(k, model));
    section('athlete-position-openings', () => positionOpeningsPage(k, model));
    section('athlete-current-position', () => currentPositionPage(k, model));
    section('athlete-entry-window', () => arrivalWindowPage(k, model));
    section('athlete-origin', () => originPage(k, model));

    // ---- the supporting record ----

    section('table-freshmen', () => freshmanRecordPage(k, model));
    section('table-experienced-arrivals', () => arrivalRecordPage(k, model));
    section('table-vacancies', () => vacancyRecordPage(k, model));

    atNext('methodology');
    methodologyPage(k, model);

    // The contents, now that every page exists. Drawn in absolute coordinates
    // on the reserved first page: anything consulting the flow cursor could
    // call addPage() here and append a blank page to a finished document.
    k.doc.switchToPage(0);
    contentsPage(k.doc, model, plan, pages);

    footer(k.doc, `Thriv3 · ${c.name}${a ? ` · for ${a.name}` : ''} · prepared ${new Date().toISOString().slice(0, 10)}`);
  });
}
