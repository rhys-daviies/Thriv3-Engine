/**
 * The programme evidence layer: pages four to twelve.
 *
 * Denser than the two glance pages by design. Those interpret; these show the
 * record the interpretation was drawn from, and a reader who wants to disagree
 * with page two should be able to find the rows here and do it.
 *
 * Each page answers one question, stated in its subtitle. Every chart carries
 * the sample it was built from next to it, and every absence carries its
 * reason next to the space where the chart would have been — an empty axis
 * reads as a measured zero, which is the defect this module exists downstream
 * of.
 *
 * Nothing here computes. Numbers come from `model.summary` and the model
 * arrays; where a figure is missing the answer is to add it to the model, not
 * to derive it beside a drawing call.
 */
import { charts, THEME, pageHead, minutes as minutesOf } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';
import { POSITIONS, positionPlural, canonicalPosition } from '../../shared/positions.js';

const { MUTED, CLARET, NAVY, MID, PALE, GREEN } = THEME;

const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const cap = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const page = (k, kicker, title, question) => pageHead(k, { kicker, title, question });
const scope = (k, parts) => k.scope(parts);

// ---------------------------------------------------------------------------
// PAGE 4 — the first-year intake
// ---------------------------------------------------------------------------

export function freshmanIntakePage(k, model) {
  const s = model.summary.programme.freshmanOpportunity;
  const intake = model.freshman.intake;
  const pts = model.freshman.points;
  // Only seasons whose minutes were published widely enough to read. An empty
  // lane for a season we could not read would say "no first-year played" when
  // it means "we could not look" — the same rule the arrivals scatter keeps.
  const seasons = intake.filter((x) => x.readable).map((x) => x.season);
  const unreadable = intake.filter((x) => !x.readable).map((x) => x.season);

  page(k, 'Programme evidence', 'The first-year intake',
    'How many first-years arrive here, and how many of them actually play?');
  scope(k, [
    `${plural(seasons.length, 'season', 'seasons')} on file`,
    `${s.measuredFreshmen} first-years with minutes published`,
    s.rowsWithoutMinutes ? `${s.rowsWithoutMinutes} rows with none` : null,
    s.unreadableSeasons.length ? `${s.unreadableSeasons.join(', ')} not readable` : null,
  ]);

  const xMax = Math.max(1600, ...pts.map((p) => p.minutes));
  const maxGames = Math.max(1, ...pts.map((p) => p.gamesPlayed));
  charts.scatter(k, {
    box: k.slot(seasons.length * 28 + 40),
    title: 'Every first-year, one dot per player',
    subtitle: 'Further right is more minutes; bigger is more games played. A filled dot started at '
      + 'least half of them.',
    lanes: seasons,
    xMax,
    marker: STARTER_MINUTES,
    markerLabel: `${STARTER_MINUTES} — a starter’s season`,
    points: pts.map((p) => ({
      lane: p.season, value: p.minutes, size: p.gamesPlayed, sizeMax: maxGames,
      solid: p.gamesStarted >= p.gamesPlayed / 2 && p.gamesPlayed > 0,
      color: p.origin === 'international' ? GREEN : NAVY,
    })),
    unavailable: seasons.length && pts.length ? null
      : 'no season on file carries enough recorded minutes to place a first-year',
  });
  k.note('Navy is a recruit from within the United States, green one from outside it. A player '
    + 'whose minutes were never published is left out rather than drawn at zero.'
    + (unreadable.length
      ? ` ${unreadable.join(', ')} ${unreadable.length === 1 ? 'has' : 'have'} no lane at all: too `
        + 'few of those rosters carry minutes to place anybody.'
      : ''));

  const yMax = Math.max(1, ...intake.map((x) => x.freshmen));
  charts.columns(k, {
    box: k.slot(132),
    title: 'Arrived, played, and played a starter’s season',
    subtitle: 'Every first-year on the roster, then those given a minute, then those who reached '
      + `${STARTER_MINUTES} minutes.`,
    yMax,
    groups: intake.map((x) => ({
      label: x.season,
      note: x.readable ? `${x.freshmen} in` : null,
      bars: x.readable ? [
        { key: 'in', value: x.freshmen, color: PALE },
        { key: 'played', value: x.freshmanPlayed, color: MID },
        { key: 'started', value: x.freshmanStarters, color: NAVY },
      ] : [{ key: 'in', value: null }],
    })),
    unavailable: intake.length ? null : 'no seasons on file',
  });

  // The share is only meaningful where the season was readable, so an
  // unreadable season keeps its slot hatched rather than dropping to zero.
  const shareRows = intake.filter((x) => x.freshmanShare != null);
  charts.columns(k, {
    box: k.slot(118),
    title: 'Share of the squad’s minutes that went to first-years',
    subtitle: 'Out of every minute the whole squad played that season.',
    yMax: Math.max(0.05, ...shareRows.map((x) => x.freshmanShare)),
    unit: '',
    groups: intake.map((x) => ({
      label: x.season,
      note: x.freshmanShare == null ? null : `${Math.round(x.freshmanShare * 100)}%`,
      bars: x.freshmanShare == null
        ? [{ key: 'share', value: null }]
        : [{ key: 'share', value: x.freshmanShare, color: NAVY }],
    })),
    unavailable: shareRows.length ? null
      : 'no season on file carries enough recorded minutes for a share to mean anything',
  });
  k.note('A season with a hatched column is one whose minutes were never published widely enough '
    + 'to read — not a season in which first-years played nothing.');
}

// ---------------------------------------------------------------------------
// PAGE 5 — the first-year ladder
// ---------------------------------------------------------------------------

export function freshmanLadderPage(k, model) {
  const s = model.summary.programme.freshmanOpportunity;
  const ladder = (model.ladder ?? []).slice(0, 5);
  const pool = model.benchmarks?.ladderByRank ?? [];

  page(k, 'Programme evidence', 'The first-year ladder',
    'When this programme plays first-years, how deep into the class does real playing time go?');
  scope(k, [
    `${plural(s.seasonsObserved, 'season', 'seasons')} contributing`,
    s.pool ? `compared against ${nf(s.pool.programmes)} programmes` : 'no pool comparison available',
  ]);

  if (!ladder.length) {
    k.body('No season on file carries enough recorded minutes to rank a first year here. This '
      + 'programme’s rosters do not publish them consistently enough to build a ladder.',
    { color: MUTED });
    return;
  }

  const rows = ladder.map((r) => {
    const p = pool.find((x) => x.rank === r.rank) ?? null;
    return {
      label: r.rank === 1 ? 'Best first-year' : `${r.rank}${['', 'st', 'nd', 'rd'][r.rank] || 'th'} best`,
      contributions: r.contributions ?? [],
      median: r.median,
      low: r.low,
      high: r.high,
      n: r.seasonsWithThisMany,
      agreement: r.agreement,
      comparable: r.comparable,
      poolMedian: p?.median ?? null,
      poolP25: p?.p25 ?? null,
      poolP75: p?.p75 ?? null,
    };
  });
  const xMax = Math.max(1600, ...rows.flatMap((r) => [r.high ?? 0, r.poolP75 ?? 0]));

  charts.dotLadder(k, {
    box: k.slot(rows.length * 30 + 60),
    title: 'What the best, second-best and third-best first-year actually got',
    subtitle: 'One dot per season, placed at the minutes that rank played. The heavy bar is this '
      + 'programme’s median across those seasons.',
    rows,
    xMax,
    marker: STARTER_MINUTES,
    poolLabel: 'the middle half of programmes at the same rank',
    unavailable: null,
  });

  if (rows.some((r) => r.agreement === 'wide')) {
    k.note('Where a range is shown instead of a season count, the seasons disagree too much for '
      + 'one number to describe them — read the dots, not the bar.');
  }
  if (rows.some((r) => !r.comparable)) {
    k.note('A rank stops being comparable once the seasons contributing to it differ from the '
      + 'ranks above; those rungs are stated rather than drawn.');
  }
  k.gap(2);
  k.body(`In ${s.seasonsWithAnImpactFreshman} of ${s.seasonsObserved} seasons on file, at least one `
    + `first-year played a ${STARTER_MINUTES}-minute season.`);

  // Only where reweighting exists AND changes the answer. A second full ladder
  // for a programme whose seasons all describe the same approach would be a
  // chart of nothing.
  if (s.weightingApplied && s.weightedAgrees === false && s.weightedLadderTop?.median != null) {
    k.gap(4);
    k.heading('Current-coach relevance');
    k.facts([
      ['Programme history, all seasons', `${nf(s.ladderTop?.median)} min`],
      [`Weighted from ${s.weightFrom}`, `${nf(s.weightedLadderTop.median)} min`],
    ]);
    k.body(model.verdict?.note
      ? cap(model.verdict.note) + '.'
      : 'The seasons before the change count less because they describe a different approach.',
    { color: MUTED });
    k.note('Both are shown because they answer different questions: the first is what has happened '
      + 'here, the second is what has happened under the approach now in place. Neither replaces '
      + 'the other.');
  }
}

// ---------------------------------------------------------------------------
// PAGE 7 — the experienced arrival intake
// ---------------------------------------------------------------------------

export function experiencedArrivalIntakePage(k, model) {
  const e = model.summary.programme.experiencedArrivalReliance;
  const t = model.transfer;

  page(k, 'Programme evidence', 'Experienced arrivals',
    'How often does this programme add players who are not first-years, and how much do they play?');
  scope(k, [
    e.measurable ? `${plural(e.measurableSeasons.length, 'season', 'seasons')} an arrival could be detected` : null,
    `${plural(e.arrivals, 'arrival', 'arrivals')} measured`,
    e.unmeasurableSeasons.length ? `${e.unmeasurableSeasons.join(', ')} not measurable` : null,
  ]);

  if (!e.measurable) {
    k.box('We cannot say whether this programme adds experienced players: none of the seasons on '
      + 'file has the season before it on file too, and an arrival is only visible by comparison '
      + 'with the roster that preceded it.', { color: CLARET });
    return;
  }

  if (e.density === 'none') {
    k.box(`Across ${plural(e.measurableSeasons.length, 'season', 'seasons')} we can measure, this `
      + 'programme did not add a single player who was not a first-year. It builds from its own '
      + 'recruiting class. About a quarter of programmes in this sport are the same, so this is a '
      + 'finding rather than a gap.', { color: GREEN });
    return;
  }

  k.body(`${plural(t.points.length, 'player', 'players')} arrived here who were not first-years. `
    + 'The roster cannot tell a transfer from a junior-college arrival or an older recruit, so they '
    + 'are counted together as experienced arrivals — for a recruit they mean the same thing, '
    + 'somebody brought in ready to play.');
  k.gap(2);

  // Only the seasons an arrival could be detected in. A lane for a season with
  // no prior roster would be drawn empty, and an empty lane reads as "nobody
  // came" when it means "we could not look".
  const lanes = e.measurableSeasons;
  const xMax = Math.max(1600, ...t.points.map((p) => p.minutes));
  const maxGames = Math.max(1, ...t.points.map((p) => p.gamesPlayed));
  charts.scatter(k, {
    box: k.slot(lanes.length * 28 + 40),
    title: 'Every experienced arrival, one dot per player',
    subtitle: 'Drawn exactly as the first-years are, so the two populations can be read against '
      + 'each other.',
    lanes,
    xMax,
    marker: STARTER_MINUTES,
    markerLabel: `${STARTER_MINUTES} — a starter’s season`,
    points: t.points.map((p) => ({
      lane: p.season, value: p.minutes, size: p.gamesPlayed, sizeMax: maxGames,
      solid: p.gamesStarted >= p.gamesPlayed / 2 && p.gamesPlayed > 0, color: GREEN,
    })),
    unavailable: t.points.length ? null : 'no arrival in these seasons has minutes on file',
  });
  if (e.unmeasurableSeasons.length) {
    k.note(`${e.unmeasurableSeasons.join(' and ')} ${e.unmeasurableSeasons.length === 1 ? 'is' : 'are'} `
      + 'not shown at all: without the season before it on file, an arrival cannot be told from a '
      + 'player who was already here.');
  }

  const rows = model.freshman.intake;
  charts.columns(k, {
    box: k.slot(136),
    title: 'Minutes played by first-years against minutes played by experienced arrivals',
    subtitle: 'Actual minutes played in each season, not projections.',
    yMax: Math.max(1, ...rows.flatMap((x) => [x.freshmanMinutes ?? 0, x.newcomerMinutes ?? 0])),
    unit: ' min',
    groups: rows.map((x) => ({
      label: x.season,
      note: x.arrivalsMeasurable ? `${x.newcomers} in` : 'not measurable',
      bars: x.readable ? [
        { key: 'fresh', value: x.freshmanMinutes, color: NAVY },
        { key: 'new', value: x.arrivalsMeasurable ? x.newcomerMinutes : null, color: GREEN },
      ] : [{ key: 'fresh', value: null }],
    })),
    unavailable: rows.some((x) => x.readable) ? null
      : 'no season on file carries enough recorded minutes',
  });
  k.note('Navy is first-years, green experienced arrivals. A season marked “not measurable” has no '
    + 'green bar because arrivals could not be identified in it, not because none arrived.');
}

// ---------------------------------------------------------------------------
// PAGE 8 — who the arrivals are
// ---------------------------------------------------------------------------

export function experiencedArrivalProfilePage(k, model) {
  const t = model.transfer;
  const e = model.summary.programme.experiencedArrivalReliance;
  const arrivals = model.squad.arrivals ?? [];
  const athletePos = model.athlete ? canonicalPosition(model.athlete.position) : null;

  page(k, 'Programme evidence', 'Who the arrivals are',
    'What kind of player does this programme bring in, and who has arrived for the current season?');

  // --- the historical half: actual minutes played ---
  k.heading('Historically — minutes actually played');
  if (!t.points.length) {
    k.body('No experienced arrival in the measurable seasons has minutes on file.', { color: MUTED });
  } else {
    const byPos = POSITIONS.map((pos) => {
      const at = t.points.filter((p) => p.position === pos);
      return {
        position: cap(positionPlural(pos)),
        players: at.length,
        starters: at.filter((p) => p.minutes >= STARTER_MINUTES).length,
        median: at.length
          ? nf([...at.map((p) => p.minutes)].sort((a, b) => a - b)[Math.floor(at.length / 2)]) : null,
        total: at.length ? nf(at.reduce((sum, p) => sum + p.minutes, 0)) : null,
      };
    }).filter((x) => x.players > 0);

    k.table({
      caption: `${plural(t.points.length, 'arrival', 'arrivals')} across `
        + `${plural(e.measurableSeasons.length, 'measurable season', 'measurable seasons')}. `
        + 'These are minutes they went on to play.',
      columns: [
        { key: 'position', label: 'Position', width: 0.3 },
        { key: 'players', label: 'Arrivals', width: 0.15, align: 'right' },
        { key: 'starters', label: `Reached ${STARTER_MINUTES} min`, width: 0.2, align: 'right' },
        { key: 'median', label: 'Median minutes', width: 0.18, align: 'right' },
        { key: 'total', label: 'Total minutes', width: 0.17, align: 'right' },
      ],
      rows: byPos,
      highlight: athletePos ? (row) => row.position === cap(positionPlural(athletePos)) : null,
    });
  }

  // --- the current half: projected minutes, on a different scale entirely ---
  k.gap(4);
  k.heading(`Arriving for ${model.squadSeason} — minutes projected, not played`);
  if (!model.squad.rostered) {
    k.body(`No ${model.squadSeason} roster is on file for this programme, so we cannot name who has `
      + 'arrived.', { color: MUTED });
  } else if (!arrivals.length) {
    k.body(`Nobody on the ${model.squadSeason} roster is recorded as arriving from another `
      + 'programme. The roster records a previous programme for some players and not others, so '
      + 'this is what is named rather than everyone who arrived.', { color: MUTED });
  } else {
    k.table({
      caption: `${plural(arrivals.length, 'player', 'players')} on the ${model.squadSeason} roster `
        + `${arrivals.length === 1 ? 'is' : 'are'} recorded as arriving from another programme. The `
        + 'minutes below are PROJECTED for the coming season — they are not comparable with the '
        + 'minutes actually played above.',
      columns: [
        { key: 'name', label: 'Player', width: 0.28, bold: true },
        { key: 'position', label: 'Position', width: 0.16, format: (v) => cap(positionPlural(v)).replace(/s$/, '') },
        { key: 'classLabel', label: 'Class', width: 0.12 },
        { key: 'from', label: 'Arrived from', width: 0.28 },
        { key: 'projectedMinutes', label: 'Projected minutes', width: 0.16, align: 'right', format: (v) => (v == null ? null : nf(v)) },
      ],
      rows: arrivals,
      highlight: athletePos ? (row) => row.position === athletePos : null,
      note: [
        arrivals.every((x) => x.projectedMinutes == null)
          ? 'None of them carries a projected-minutes figure: a projection is carried forward from '
            + 'a player’s previous season and is not always held for someone who has just moved.'
          : null,
        athletePos
          ? `${arrivals.filter((x) => x.position === athletePos).length} of them play the position `
            + 'this report is prepared for; what that means is on the athlete pages.'
          : null,
      ].filter(Boolean).join(' ') || null,
    });
  }
}

// ---------------------------------------------------------------------------
// PAGE 9 — where the minutes go
// ---------------------------------------------------------------------------

export function replacingMinutesPage(k, model) {
  const r = model.summary.programme.replacementBehaviour;

  page(k, 'Programme evidence', 'Replacing minutes',
    'When established players leave a position, where do the following season’s minutes go?');
  scope(k, [
    `${r.observations} readable of ${r.totalObservations} position-seasons`,
    r.seasonsRepresented.length ? `${plural(r.seasonsRepresented.length, 'transition', 'transitions')}` : null,
    r.meanVacatedStarterShare != null
      ? `typically ${Math.round(r.meanVacatedStarterShare * 100)}% of starter minutes vacated` : null,
  ]);

  k.body('Every season, at every position, some players leave. This is where the minutes they were '
    + 'playing went the following season.');
  k.gap(4);

  // One axis, one legend, the two mixes stacked on top of each other. The
  // comparison is the page.
  const KEYS = [
    { key: 'returning', label: 'returning players', color: PALE, dark: true },
    { key: 'freshman', label: 'first-years', color: NAVY },
    { key: 'newcomer', label: 'experienced arrivals', color: GREEN },
  ];
  charts.stackedRows(k, {
    box: k.slot(r.poolMix ? 132 : 96),
    title: 'Where the minutes went',
    subtitle: 'The three shares divide the position’s minutes exactly, which is what makes them '
      + 'safe to read against each other.',
    keys: KEYS,
    rows: [
      {
        label: 'This programme',
        note: `${r.observations} position-seasons`,
        values: r.observations ? r.shares : null,
        unavailable: 'no position-season here carries enough recorded minutes to read the mix',
      },
      ...(r.poolMix ? [{
        label: 'Comparable programmes',
        note: `${nf(r.poolMix.n)} position-seasons`,
        values: r.poolMix,
      }] : []),
    ],
    unavailable: null,
  });
  if (r.poolMix) {
    k.note('The comparison band is programmes whose vacated starter minutes sat in the same range '
      + 'as this one’s, so like is read against like rather than against the sport as a whole.');
  } else if (r.poolReason) {
    k.note(`No comparable-programme mix could be built: ${r.poolReason}.`);
  }

  // The pool's own finding, stated as an association and never as a cause.
  if (r.poolVacancy?.starterDeparted?.pctWithAFreshStarter != null
    && r.poolVacancy?.noStarterDeparted?.pctWithAFreshStarter != null) {
    k.gap(6);
    k.heading('Across the pool, when a starter leaves');
    charts.paired(k, {
      box: k.slot(88),
      title: 'Position-seasons in which a first-year went on to play a starter’s season',
      subtitle: 'Every programme in this sport, split by whether a starter had departed that position.',
      rows: [
        { label: 'A starter departed', a: r.poolVacancy.starterDeparted.pctWithAFreshStarter, b: null },
        { label: 'No starter departed', a: r.poolVacancy.noStarterDeparted.pctWithAFreshStarter, b: null },
      ],
      aLabel: '', bLabel: '', max: 100, unit: '%',
      unavailable: null,
    });
    k.note(`Built from ${nf(r.poolVacancy.starterDeparted.n)} position-seasons following a departure `
      + `and ${nf(r.poolVacancy.noStarterDeparted.n)} without one. Across the pool, first-years `
      + 'started more often in the position-seasons that followed a departing starter. That is an '
      + 'association between two things the roster records, not a claim that one caused the other — '
      + 'a position losing a starter differs from one that did not in more ways than this measures.');
  }

  k.gap(4);
  k.facts([
    ['Position-seasons readable', `${r.observations} of ${r.totalObservations}`],
    ['Seasons represented', r.seasonsRepresented.join(', ') || '—'],
    ['Evidence', r.evidence.level],
  ]);
}

// ---------------------------------------------------------------------------
// PAGE 10 — the same question, position by position
// ---------------------------------------------------------------------------

export function replacementByPositionPage(k, model) {
  const r = model.summary.programme.replacementBehaviour;
  const athletePos = model.athlete ? canonicalPosition(model.athlete.position) : null;
  const live = r.byPosition.filter((p) => p.transitions > 0);

  page(k, 'Programme evidence', 'Position by position',
    'Does what happens when a place comes free depend on the position?');

  if (!live.length) {
    k.body('No position group here carries enough recorded minutes to read separately.', { color: MUTED });
    return;
  }

  k.table({
    caption: 'An opening is a season transition in which a starter left that position. The two '
      + '“started” columns count the openings a first-year, or an experienced arrival, then started '
      + 'in — they can describe the same season, because one opening can be filled by more than one '
      + 'player, so they are never subtracted from the total. The minutes split is returning / '
      + 'first-year / experienced arrival.',
    columns: [
      { key: 'position', label: 'Position', width: 0.2, bold: true, format: (v) => cap(positionPlural(v)) },
      { key: 'transitions', label: 'Transitions', width: 0.12, align: 'right' },
      { key: 'openings', label: 'Openings', width: 0.11, align: 'right' },
      { key: 'freshman', label: 'First-year', width: 0.14, align: 'right' },
      { key: 'newcomer', label: 'Arrival', width: 0.14, align: 'right' },
      { key: 'mix', label: 'Minutes split', width: 0.18, align: 'right' },
      { key: 'evidence', label: 'Evidence', width: 0.11, align: 'right' },
    ],
    rows: r.byPosition.map((p) => ({
      position: p.position,
      transitions: p.transitions || null,
      openings: p.transitions ? p.openings : null,
      // "2 of 5" rather than 40%: with at most three transitions a percentage
      // reads far more confidently than it deserves to.
      freshman: p.openings ? `${p.freshmanTookIt} of ${p.openings}` : null,
      newcomer: p.openings ? `${p.newcomerTookIt} of ${p.openings}` : null,
      mix: p.dials?.n
        ? `${Math.round(p.dials.returning)} / ${Math.round(p.dials.freshman)} / ${Math.round(p.dials.newcomer)}`
        : null,
      evidence: p.transitions ? p.evidence.level : null,
    })),
    highlight: athletePos ? (row) => row.position === athletePos : null,
  });

  k.note('A position with no numbers is one whose minutes were never recorded consistently enough '
    + 'to read — not one that never turns over. Goalkeepers land there often: one keeper plays '
    + 'nearly every minute and the rest play none, so a position-season rarely carries the spread '
    + 'the guard requires.');

  // Season detail only where it explains the row rather than repeating it.
  const withOpenings = model.byPosition.filter((p) => p.openings > 0);
  if (withOpenings.length) {
    k.gap(4);
    k.heading('The seasons behind those openings');
    for (const p of withOpenings) {
      for (const season of p.seasons.filter((x) => x.startersDeparted > 0)) {
        const names = season.departedNames.map((d) => `${d.name} (${minutesOf(d.minutes)})`).join(', ');
        k.body(`${cap(positionPlural(p.position)).replace(/s$/, '')}, ${season.season}: ${names} left — `
          + `${plural(season.freshStarters, 'first-year started', 'first-years started')}`
          + `${season.newcomerStarters ? `, and ${plural(season.newcomerStarters, 'experienced arrival', 'experienced arrivals')}` : ''}.`,
        { color: MUTED });
      }
    }
  }
  if (athletePos) {
    k.note(`${cap(positionPlural(athletePos))} is the position this report is prepared for and is `
      + 'marked in the table; what it means for this athlete is on the pages that follow.');
  }
}

// ---------------------------------------------------------------------------
// PAGE 11 — the current squad's eligibility
// ---------------------------------------------------------------------------

export function currentSquadOutlookPage(k, model) {
  const t = model.summary.programme.squadTurnover;
  const squad = model.squad;
  const proj = t.projectedMinutes;

  page(k, 'Programme evidence', 'Current squad outlook',
    `When does the playing-time load on the ${model.squadSeason} roster reach the end of its eligibility?`);
  scope(k, [
    `${plural(t.rostered, 'player', 'players')} on the ${model.squadSeason} roster`,
    proj.projectable
      ? `projections for ${proj.playersWithProjection} of ${proj.projectable} who could carry one`
      : 'no player on this roster could carry a projection',
    proj.firstYears ? `${proj.firstYears} first-years, who cannot` : null,
  ]);

  if (!squad.cliff?.length) {
    k.body(squad.rostered
      ? 'No player on the current roster carries an eligibility end year, so we cannot say when '
        + 'places reach the end of their eligibility here.'
      : `No ${model.squadSeason} roster is on file for this programme.`, { color: MUTED });
    return;
  }

  const years = squad.cliff.map((y) => y.year);
  const depthRows = model.summary.programme.squadTurnover.squad ?? [];
  const lanes = POSITIONS.map((pos) => ({
    label: cap(positionPlural(pos)),
    players: depthRows.filter((p) => p.position === pos),
  })).filter((l) => l.players.length);
  const unplaceable = depthRows.filter((p) => p.eligibleTo == null).length;

  charts.eligibilityTimeline(k, {
    box: k.slot(lanes.length * 26 + 52),
    title: 'Every current player, at the year their eligibility ends',
    subtitle: 'One dot per player, sized by the minutes they are projected to play.',
    lanes,
    years,
    marker: model.entrySeason,
    unplaceable,
    unavailable: lanes.length ? null : 'no current roster on file',
  });

  charts.columns(k, {
    box: k.slot(132),
    title: 'Projected minutes currently attached to players whose eligibility ends in each year',
    subtitle: 'From the squad on campus now. A fifth year, a move away or an injury all move it.',
    yMax: Math.max(1, ...squad.cliff.map((y) => y.total)),
    unit: ' min',
    groups: squad.cliff.map((y) => ({
      label: String(y.year),
      // A year whose players carry no projection at all has no total — a
      // zero-height bar there would read as "these players are projected to
      // play nothing" when it means "we hold no projection for them".
      note: y.playersWithProjection ? nf(y.total) : `${y.players} players, no projection`,
      bars: y.playersWithProjection
        ? [{ key: 'min', value: y.total, color: y.year === model.entrySeason ? CLARET : NAVY }]
        : [{ key: 'min', value: null }],
    })),
    unavailable: null,
  });
  k.note(`The claret column is ${model.entrySeason}, the season this report is prepared for. A `
    + 'hatched column is a year whose players hold no projection — every one of them a first-year, '
    + 'whose minutes are carried forward from a season they have not played.');

  k.table({
    caption: 'The same figures by position, with the players behind them.',
    columns: [
      { key: 'year', label: 'Eligibility ends', width: 0.16, bold: true },
      { key: 'players', label: 'Players', width: 0.12, align: 'right' },
      { key: 'total', label: 'Projected minutes', width: 0.18, align: 'right', format: (v) => nf(v) },
      { key: 'missing', label: 'No projection', width: 0.14, align: 'right' },
      { key: 'positions', label: 'Where those minutes sit', width: 0.4, align: 'right' },
    ],
    rows: squad.cliff.map((y) => ({
      year: y.year,
      players: y.players,
      total: y.playersWithProjection ? y.total : null,
      missing: y.playersWithoutProjection || null,
      // Only positions that actually carry minutes: a "Def 0" beside a
      // no-projection count says the same thing twice and reads as a measured
      // zero the second time.
      positions: y.byPosition.filter((b) => b.minutes > 0).map(
        (b) => `${cap(positionPlural(b.position)).slice(0, 3)} ${nf(b.minutes)}`).join('   ') || null,
    })),
    note: proj.readable
      ? `Against ${nf(proj.total)} projected minutes across the players who carry a projection.`
      : 'Too few of the returning squad carry a projection for these totals to be read as a share '
        + 'of anything.',
  });
}

// ---------------------------------------------------------------------------
// PAGE 12 — the roster in full
// ---------------------------------------------------------------------------

export function currentDepthPage(k, model) {
  const rows = model.summary.programme.squadTurnover.squad ?? [];
  const athletePos = model.athlete ? canonicalPosition(model.athlete.position) : null;

  page(k, 'Programme evidence', 'The current squad',
    `Who is on the ${model.squadSeason} roster, and how established are they?`);

  if (!rows.length) {
    k.body(`No ${model.squadSeason} roster is on file for this programme.`, { color: MUTED });
    return;
  }

  const withProjection = rows.filter((p) => p.projectedMinutes != null).length;
  const withEligibility = rows.filter((p) => p.eligibleTo != null).length;
  const withPrior = rows.filter((p) => p.arrivedFrom != null).length;
  scope(k, [
    `${plural(rows.length, 'player', 'players')}`,
    `class known for ${rows.filter((p) => p.classLabel).length}`,
    `projected minutes for ${withProjection}`,
    `eligibility end for ${withEligibility}`,
    `previous programme for ${withPrior}`,
  ]);

  // Grouped by position, then by who is projected to play most. UNKNOWN keeps
  // its own group rather than being dropped.
  const groups = [...POSITIONS, 'UNKNOWN'].map((pos) => ({
    pos,
    players: rows.filter((p) => p.position === pos)
      .sort((a, b) => (b.projectedMinutes ?? -1) - (a.projectedMinutes ?? -1)),
  })).filter((g) => g.players.length);

  const tableRows = [];
  for (const g of groups) {
    tableRows.push({ group: `${cap(positionPlural(g.pos))} (${g.players.length})` });
    for (const p of g.players) tableRows.push(p);
  }

  k.table({
    continued: `The ${model.squadSeason} squad`,
    columns: [
      { key: 'name', label: 'Player', width: 0.26, bold: true },
      { key: 'position', label: 'Position', width: 0.12, format: (v) => cap(positionPlural(v)).replace(/s$/, '') },
      { key: 'classLabel', label: 'Class', width: 0.11 },
      { key: 'projectedMinutes', label: 'Projected mins', width: 0.15, align: 'right', format: (v) => (v == null ? null : nf(v)) },
      { key: 'eligibleTo', label: 'Eligible to', width: 0.11, align: 'right' },
      { key: 'arrivedFrom', label: 'Previous programme', width: 0.25, dropWhenEmpty: true },
    ],
    rows: tableRows,
    highlight: athletePos ? (row) => row.position === athletePos : null,
    note: 'A dash is a field the roster did not record. Projected minutes are carried forward from '
      + 'a player’s previous season, so a true first-year cannot have one — an empty column there '
      + 'is the method, not a judgement about the player.',
  });
}
