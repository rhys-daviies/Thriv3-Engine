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
import { charts, THEME, TYPE, pageHead } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';
import { POSITIONS, positionPlural, canonicalPosition } from '../../shared/positions.js';

const { MUTED, CLARET, NAVY, MID, PALE, GREEN, M, W } = THEME;

const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const cap = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pcInt = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

const page = (k, kicker, title, question) => pageHead(k, { kicker, title, question });
const scope = (k, parts) => k.scope(parts);

// ---------------------------------------------------------------------------
// How much first-years actually play
// ---------------------------------------------------------------------------

/**
 * How much first-years actually play — the intake page and the ladder, merged.
 *
 * THEY WERE THE SAME PLAYERS ON THE SAME AXIS, TWICE. 13A found the intake
 * scatter and the ladder plotting the same 57 first-years on the same
 * 0–1,600-minute axis with the same 600-minute marker on consecutive pages, and
 * both closing with the same "at least one first-year played a starter's season
 * in N of M seasons".
 *
 * WHAT LEADS. The ladder, because it answers the question a recruit actually
 * has: not what a first-year averaged — first-year minutes are far too uneven
 * for an average to describe anybody — but how deep into the class real playing
 * time went. The intake survives as the per-season counts underneath it, which
 * is the context the ladder cannot carry: how many arrived, how many were given
 * a minute, how many reached a starter's season, and what share of the squad's
 * minutes they took.
 *
 * WHAT IS NOT REDRAWN. The per-player scatter. Every dot in it is a named row
 * in the evidence act, with its position, minutes, games, starts, band and
 * origin — so nothing it showed is unavailable, and the page it was on is no
 * longer needed to show it.
 */
export function freshmanOpportunityPage(k, model) {
  const s = model.summary.programme.freshmanOpportunity;
  const intake = model.freshman.intake;
  const ladder = (model.ladder ?? []).slice(0, 5);
  const pool = model.benchmarks?.ladderByRank ?? [];

  page(k, 'Programme intelligence', 'How much first-years actually play',
    'How much opportunity do first-years actually get here?');
  scope(k, [
    `${plural(s.seasonsObserved, 'season', 'seasons')} contributing`,
    `${s.measuredFreshmen} first-years with minutes published`,
    s.pool ? `compared against ${nf(s.pool.programmes)} programmes` : 'no pool comparison available',
    s.unreadableSeasons.length ? `${s.unreadableSeasons.join(', ')} not readable` : null,
  ]);

  // ---- the ladder, which is the finding -----------------------------------
  if (!ladder.length) {
    k.body('No season on file carries enough recorded minutes to rank a first year here. This '
      + 'programme’s rosters do not publish them consistently enough to build a ladder.',
    { color: MUTED });
  } else {
    const rows = ladder.map((r) => {
      const pr = pool.find((x) => x.rank === r.rank) ?? null;
      return {
        label: r.rank === 1 ? 'Best first-year' : `${r.rank}${['', 'st', 'nd', 'rd'][r.rank] || 'th'} best`,
        contributions: r.contributions ?? [],
        median: r.median,
        low: r.low,
        high: r.high,
        n: r.seasonsWithThisMany,
        agreement: r.agreement,
        comparable: r.comparable,
        poolMedian: pr?.median ?? null,
        poolP25: pr?.p25 ?? null,
        poolP75: pr?.p75 ?? null,
      };
    });
    const xMax = Math.max(1600, ...rows.flatMap((r) => [r.high ?? 0, r.poolP75 ?? 0]));

    /**
     * 44 points a rung, not 30 — 13D / §G.
     *
     * The ladder is the strongest visual in the report and it was drawn in a
     * 210-point band on a page with 600 points to spare, which left it reading
     * as one chart among several on a page that had nothing else on it. The
     * dots that share a rung also stop colliding: at 30 points a rung, four
     * seasons within a hundred minutes of each other overlapped their own
     * labels.
     */
    charts.dotLadder(k, {
      box: k.slot(rows.length * 40 + 78),
      rowPitch: 40,
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
    k.body(`In ${s.seasonsWithAnImpactFreshman} of ${plural(s.seasonsObserved, 'season', 'seasons')} on file, at least one `
      + `first-year played a ${STARTER_MINUTES}-minute season.`);
  }

  // ---- the intake, season by season ---------------------------------------
  //
  // A table rather than the two column charts it replaces. The charts drew four
  // bars and four percentages over 250 points of page; the same four seasons
  // read as figures in a third of that, and the trend a reader wants from them
  // — first-years taking a growing or shrinking share of the squad's minutes —
  // is a column of percentages either way.
  k.heading('Who arrived, and how much they played');
  k.table({
    columns: [
      { key: 'season', label: 'Season', width: 0.16, bold: true },
      { key: 'freshmen', label: 'First-years', width: 0.17, align: 'right' },
      { key: 'played', label: 'Given a minute', width: 0.2, align: 'right' },
      { key: 'starters', label: `Reached ${STARTER_MINUTES} min`, width: 0.23, align: 'right' },
      { key: 'share', label: 'Share of squad minutes', width: 0.24, align: 'right' },
    ],
    rows: intake.map((x) => ({
      season: x.season,
      freshmen: x.freshmen,
      // A season whose minutes were not published widely enough to read carries
      // a dash, never a zero: the roster is on file, the minutes are not.
      played: x.readable ? x.freshmanPlayed : null,
      starters: x.readable ? x.freshmanStarters : null,
      share: x.freshmanShare == null ? null : `${Math.round(x.freshmanShare * 100)}%`,
    })),
    note: intake.some((x) => !x.readable)
      ? 'A dash is a season whose minutes were never published widely enough to read — not a '
        + 'season in which first-years played nothing. Every first-year is named in the '
        + 'supporting record at the back, with the minutes, games and starts behind these counts.'
      : 'Every first-year is named in the supporting record at the back, with the minutes, games '
        + 'and starts behind these counts.',
  });

  // ---- the coach-weighted view, only where it changes the answer ----------
  //
  // Rochester women's is the case: one coach across every measured season, and
  // the recent seasons still describing something different from the early
  // ones. Two ladders would not fit here and two ladders were never the point;
  // the difference between the two tops is the whole of what the weighting says.
  if (s.weightingApplied && s.weightedAgrees === false && s.weightedLadderTop?.median != null) {
    k.heading('Current-coach relevance');
    k.facts([
      ['Programme history, all seasons', `${nf(s.ladderTop?.median)} min`],
      [`Weighted from ${s.weightFrom}`, `${nf(s.weightedLadderTop.median)} min`],
    ]);
    k.note(`${model.verdict?.note ? `${cap(model.verdict.note)}. ` : ''}Both are shown because they `
      + 'answer different questions: the first is what has happened here, the second is what has '
      + 'happened under the approach now in place. Neither replaces the other, and the ladder '
      + 'above is the first.');
  }
}

// ---------------------------------------------------------------------------
// Players brought in ready to play
// ---------------------------------------------------------------------------

/**
 * The arrivals page and "who the arrivals are", merged — historical half only.
 *
 * WHAT MOVED OUT. The current-season arrivals table. It describes the roster on
 * campus now and its minutes are PROJECTED, not played, which is why the page
 * that carried both halves had to warn that its own two tables were not
 * comparable. It now sits on the current-squad page, beside the other projected
 * figures, where that warning is the page's subject rather than an apology.
 *
 * WHAT LEADS. Frequency, then the share of the squad's minutes these players
 * took, then the distribution of what they went on to play, then the positions
 * they arrived at and how many reached a starter's season. Named arrivals are in
 * the evidence act.
 *
 * @param newPage - false where this section is flowing beneath the squad page.
 * It does that only where its whole finding is one box — no arrival could be
 * detected, or no season can be compared with the one before it — and the
 * running order has measured the room. Nothing is dropped in that case; the
 * section keeps its title, its scope line and its box.
 */
export function experiencedArrivalsPage(k, model, { newPage = true } = {}) {
  const e = model.summary.programme.experiencedArrivalReliance;
  const t = model.transfer;
  const athletePos = model.athlete ? canonicalPosition(model.athlete.position) : null;

  pageHead(k, {
    kicker: 'Programme intelligence',
    title: 'Players brought in ready to play',
    question: 'How does this programme use players who arrive with college experience?',
    newPage,
    continued: !newPage,
  });
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

  /**
   * A DEFINITION IS NOT A FINDING — 13D / §J.
   *
   * This paragraph was the loudest thing above the chart: body size, ink, three
   * lines, defining the word "arrival" — while the page's actual finding sat
   * under it in muted note type. Both are context for the chart that follows
   * and both are now set as notes, so the hero is what the eye finds first.
   */
  k.note(`${plural(t.points.length, 'player', 'players')} arrived here who were not first-years. `
    + 'The roster cannot tell a transfer from a junior-college arrival or an older recruit, so they '
    + 'are counted together as experienced arrivals — for a recruit they mean the same thing, '
    + 'somebody brought in ready to play.');

  /**
   * The squad-wide share, which is a different question from the one the glance
   * page's card answers.
   *
   * The card states the share of a VACATED POSITION'S minutes that went to
   * arrivals, which is the figure with a pool behind it. This is the share of
   * the whole squad's readable minutes. Both were on page two, unlabelled, as
   * 28% and 30.9% — 13A / §P. One belongs on the decision layer and the other
   * belongs here, where there is room to say which is which.
   */
  if (e.shareOfMeasuredLoad != null) {
    k.note(`Across the seasons whose minutes can be read, ${pcInt(e.shareOfMeasuredLoad)} of every `
      + 'minute the squad played went to a player who did not arrive as a first-year. That is a '
      + 'share of the whole squad’s minutes; the figure on the summary page is a share of the '
      + 'minutes that came free at a position, which is a narrower and differently measured thing.');
  }
  // Only the seasons an arrival could be detected in. A lane for a season with
  // no prior roster would be drawn empty, and an empty lane reads as "nobody
  // came" when it means "we could not look".
  const lanes = e.measurableSeasons;
  const xMax = Math.max(1600, ...t.points.map((p) => p.minutes));
  const maxGames = Math.max(1, ...t.points.map((p) => p.gamesPlayed));
  // The page's primary block is a titled region like the one below it. Drawn
  // under a module title while the positions table below carried a claret
  // section heading, the hero was the quieter of the two.
  k.heading('Every experienced arrival, one dot per player');
  charts.scatter(k, {
    box: k.slot(lanes.length * 28 + 34),
    title: null,
    subtitle: 'Drawn exactly as the first-year ladder is scaled, so the two populations can be '
      + 'read against each other.',
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

  // Position distribution and starter-level usage — the half of "who the
  // arrivals are" that is a finding rather than a list.
  if (t.points.length) {
    const byPos = POSITIONS.map((pos) => {
      const at = t.points.filter((p) => p.position === pos);
      return {
        position: cap(positionPlural(pos)),
        players: at.length,
        starters: at.filter((p) => p.minutes >= STARTER_MINUTES).length,
        median: at.length
          ? nf([...at.map((p) => p.minutes)].sort((x, y) => x - y)[Math.floor(at.length / 2)]) : null,
        total: at.length ? nf(at.reduce((sum, p) => sum + p.minutes, 0)) : null,
      };
    }).filter((x) => x.players > 0);

    k.heading('Which positions they arrived at');
    k.table({
      caption: 'Minutes they went on to play here — historical, not projected.',
      columns: [
        { key: 'position', label: 'Position', width: 0.3 },
        { key: 'players', label: 'Arrivals', width: 0.15, align: 'right' },
        { key: 'starters', label: `Reached ${STARTER_MINUTES} min`, width: 0.2, align: 'right' },
        { key: 'median', label: 'Median minutes', width: 0.18, align: 'right' },
        { key: 'total', label: 'Total minutes', width: 0.17, align: 'right' },
      ],
      rows: byPos,
      highlight: athletePos ? (row) => row.position === cap(positionPlural(athletePos)) : null,
      note: 'Every arrival is named in the supporting record at the back. Who has arrived for '
        + `${model.squadSeason} is with the current squad, because those minutes are projected `
        + 'rather than played.',
    });
  }
}

// ---------------------------------------------------------------------------
// PAGE 9 — where the minutes go
// ---------------------------------------------------------------------------

export function replacingMinutesPage(k, model) {
  const r = model.summary.programme.replacementBehaviour;

  page(k, 'Programme intelligence', 'Replacing minutes',
    'When established players leave a position, where do the following season’s minutes go?');
  /**
   * The three facts that used to trail the page are in its scope strip.
   *
   * They were a bare `facts` list at the foot of the page under no heading —
   * "Position-seasons readable / 10 of 10", which the scope strip's first line
   * already said, and "Evidence / moderate", which is a scope fact wearing the
   * clothes of a finding. Every page in the report states its sample in the
   * strip under the question; this one now does too, and the page ends on its
   * last chart instead of on an orphan list.
   */
  scope(k, [
    `${r.observations} readable of ${r.totalObservations} position-seasons`,
    r.seasonsRepresented.length
      ? `${plural(r.seasonsRepresented.length, 'transition', 'transitions')} — ${r.seasonsRepresented.join(', ')}`
      : null,
    r.meanVacatedStarterShare != null
      ? `typically ${Math.round(r.meanVacatedStarterShare * 100)}% of starter minutes vacated` : null,
    `${r.evidence.level} evidence`,
  ]);

  k.note('Every season, at every position, some players leave. This is where the minutes they were '
    + 'playing went the following season.');

  // One axis, one legend, the two mixes stacked on top of each other. The
  // comparison is the page.
  const KEYS = [
    { key: 'returning', label: 'returning players', color: PALE, dark: true },
    { key: 'freshman', label: 'first-years', color: NAVY },
    { key: 'newcomer', label: 'experienced arrivals', color: GREEN },
  ];
  /**
   * THE COMPARISON IS THE PAGE, so it is drawn like the page's subject — 13D.
   *
   * Two stacked bars under a module title, with the pool comparison beneath a
   * claret section heading further down, made the page's own finding the
   * quieter of the two blocks on it. The title is now the section, the bars are
   * taller, and the block below it stays a section: two peers rather than an
   * inversion.
   */
  k.heading('Where the minutes went');
  charts.stackedRows(k, {
    box: k.slot(r.poolMix ? 144 : 112),
    title: null,
    subtitle: 'The three shares divide the position’s minutes exactly, which is what makes them '
      + 'safe to read against each other.',
    barH: 26,
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

}

// ---------------------------------------------------------------------------
// PAGE 10 — the same question, position by position
// ---------------------------------------------------------------------------

/**
 * @param newPage - false where this reads as the second half of the replacement
 * story and the running order has measured the room for it. It keeps its title,
 * its question and its table either way; only the page break is conditional.
 */
export function replacementByPositionPage(k, model, { newPage = true } = {}) {
  const r = model.summary.programme.replacementBehaviour;
  const athletePos = model.athlete ? canonicalPosition(model.athlete.position) : null;
  const live = r.byPosition.filter((p) => p.transitions > 0);

  pageHead(k, {
    kicker: 'Programme intelligence',
    title: 'Position by position',
    question: 'Does what happens when a place comes free depend on the position?',
    newPage,
    continued: !newPage,
  });
  scope(k, [
    `${plural(live.length, 'position', 'positions')} of ${r.byPosition.length} readable`,
    `${plural(r.byPosition.reduce((n, p) => n + p.openings, 0), 'opening', 'openings')} observed`,
    athletePos ? `${cap(positionPlural(athletePos))} is this athlete’s position` : null,
  ]);

  if (!live.length) {
    k.body('No position group here carries enough recorded minutes to read separately.', { color: MUTED });
    return;
  }

  /**
   * FOUR ROWS, NOT A SEVEN-COLUMN TABLE — Phase 13D / §M.
   *
   * The table this replaces put the whole page in a 26-point strip: seven
   * columns, four rows, a header that wrapped "TRANSITIONS" onto the first
   * row of data, and a "Minutes split" column reading "69 / 4 / 27" whose key
   * was a clause in the caption above it. Everything on the page was the same
   * size, so nothing on it was findable.
   *
   * The three numbers in that column already partition the position's minutes
   * exactly — that is enforced in `vacancyObservations` and it is what makes
   * them safe to draw as one bar. So they are drawn as one bar, in the same
   * three colours the replacement page uses for the same three routes, and the
   * page becomes four things a reader can compare rather than a grid to parse.
   *
   * NO NEW ANALYTICS. Every figure below is the same field the table printed.
   */
  const NAME_W = W * 0.26;
  const BAR_X = M + W * 0.30;
  const BAR_W = W * 0.44;
  const STARTED_X = M + W * 0.76;
  const STARTED_W = W * 0.24;
  const ROW_H = 72;

  k.heading('What happened at each position');
  k.note('An opening is a season transition in which a starter left that position. One opening can '
    + 'be filled by more than one player, so the two “started” counts are never subtracted from '
    + 'the total.');

  const box = k.slot(r.byPosition.length * ROW_H + 30);
  const after = k.doc.y;
  const { doc } = k;
  try {
    // The legend once, above the rows, rather than a key inside every bar.
    let lx = BAR_X;
    for (const [label, colour] of [['returning players', PALE], ['first-years', NAVY],
      ['experienced arrivals', GREEN]]) {
      doc.save().rect(lx, box.y + 2, 7, 7).fill(colour).restore();
      doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
        .text(label, lx + 10, box.y + 2, { width: 100, lineBreak: false });
      lx += 12 + doc.widthOfString(label) + 12;
    }
    doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
      .text('STARTED THE OPENING', STARTED_X, box.y + 2,
        { width: STARTED_W, align: 'right', characterSpacing: TYPE.label.spacing, lineBreak: false });

    r.byPosition.forEach((p, i) => {
      const y = box.y + 26 + i * ROW_H;
      const mine = athletePos && p.position === athletePos;
      // The athlete's own position is marked by a claret rule in the margin,
      // never by a fill: a highlighted row on a page of four rows reads as the
      // best one.
      // Inside the content box: at M - 8 the rule sat two points past the left
      // edge the layout guard enforces, and the guard said so.
      if (mine) doc.save().rect(M - 5, y - 4, 2, ROW_H - 20).fill(CLARET).restore();

      doc.font('Helvetica-Bold').fontSize(13).fillColor(THEME.INK)
        .text(cap(positionPlural(p.position)), M, y, { width: NAME_W, lineBreak: false });
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(p.transitions
          ? `${plural(p.transitions, 'transition', 'transitions')} · ${plural(p.openings, 'opening', 'openings')}`
          : 'no transition on file', M, y + 19, { width: NAME_W, lineBreak: false });
      if (p.transitions) {
        doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
          .text(`${String(p.evidence.level).toUpperCase()} EVIDENCE`, M, y + 33,
            { width: NAME_W, characterSpacing: TYPE.label.spacing, lineBreak: false });
      }

      // The minute mix, as one bar. A position whose minutes could not be read
      // draws the REASON, never an empty track: an empty track reads as a
      // measured zero, which is exactly what this page must not say.
      if (p.dials?.n) {
        const parts = [['returning', p.dials.returning, PALE], ['freshman', p.dials.freshman, NAVY],
          ['newcomer', p.dials.newcomer, GREEN]];
        let x = BAR_X;
        for (const [, share, colour] of parts) {
          const w = Math.max(0, (share / 100) * BAR_W);
          if (w > 0.5) doc.save().rect(x, y + 2, w, 22).fill(colour).restore();
          if (w >= 22) {
            doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colour === PALE ? THEME.INK : '#FFFFFF')
              .text(`${Math.round(share)}%`, x + 5, y + 9.5, { width: w - 7, lineBreak: false });
          }
          x += w;
        }
        doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
          .text(`${plural(p.dials.n, 'position-season', 'position-seasons')} readable`,
            BAR_X, y + 29, { width: BAR_W, lineBreak: false });
      } else {
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED)
          .text(p.transitions
            ? 'minutes never recorded consistently enough to read the mix'
            : 'no season transition on file at this position',
          BAR_X, y + 8, { width: BAR_W });
      }

      // Who started, as two counts rather than two columns of "n of m".
      if (p.openings) {
        doc.font('Helvetica').fontSize(7.8).fillColor(THEME.INK)
          .text(`first-year  ${p.freshmanTookIt} of ${p.openings}`, STARTED_X, y + 5,
            { width: STARTED_W, align: 'right', lineBreak: false });
        doc.font('Helvetica').fontSize(7.8).fillColor(THEME.INK)
          .text(`arrival  ${p.newcomerTookIt} of ${p.openings}`, STARTED_X, y + 19,
            { width: STARTED_W, align: 'right', lineBreak: false });
      } else {
        doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
          .text('—', STARTED_X, y + 5, { width: STARTED_W, align: 'right', lineBreak: false });
      }

      if (i < r.byPosition.length - 1) {
        doc.save().moveTo(M, y + ROW_H - 20).lineTo(M + W, y + ROW_H - 20)
          .lineWidth(0.4).strokeColor(THEME.LINE).stroke().restore();
      }
    });
  } finally {
    doc.y = after;
  }

  k.note('A position with no numbers is one whose minutes were never recorded consistently enough '
    + 'to read — not one that never turns over. Goalkeepers land there often: one keeper plays '
    + 'nearly every minute and the rest play none, so a position-season rarely carries the spread '
    + 'the guard requires.');

  /**
   * The season-by-season openings are NOT restated here.
   *
   * They were nine lines of named departures under this table, and the evidence
   * act tabulates the same nine openings properly — one row per transition, with
   * the minutes vacated, whether a first-year then started and the returning
   * share. 13A found the two saying the same thing; this is the one that keeps
   * the pointer and drops the paraphrase.
   */
  const openings = model.byPosition.reduce((n, p) => n + p.openings, 0);
  if (openings) {
    k.note(`Each of the ${plural(openings, 'opening', 'openings')} above is listed in the `
      + 'supporting record at the back, with the players who left, the minutes they had been '
      + 'playing and who started the following season.');
  }
  if (athletePos) {
    k.note(`${cap(positionPlural(athletePos))} is the position this report is prepared for and is `
      + 'marked in the margin above; how this history intersects with one position and one entry '
      + 'year is on the pathway pages.');
  }
}

// ---------------------------------------------------------------------------
// PAGE 11 — the current squad's eligibility
// ---------------------------------------------------------------------------

export function currentSquadOutlookPage(k, model) {
  const t = model.summary.programme.squadTurnover;
  const squad = model.squad;
  const proj = t.projectedMinutes;

  page(k, 'Programme intelligence', 'The squad you would be joining',
    `When does the playing-time load on the ${model.squadSeason} roster reach the end of its eligibility?`);
  scope(k, [
    `${plural(t.rostered, 'player', 'players')} on the ${model.squadSeason} roster`,
    proj.projectable
      ? `projections for ${proj.playersWithProjection} of ${proj.projectable} who could carry one`
      : 'no player on this roster could carry a projection',
    proj.firstYears ? `${proj.firstYears} first-years, who cannot` : null,
  ]);

  /**
   * THE NON-CLAIM, moved here in 13C from the glance card that carried it.
   *
   * That card is gone and this page is now the only surface that shows a
   * roster's projected minutes by eligibility year — so the sentence that stops
   * them being read as a recruit's opportunity has to be here, on the page that
   * owns the subject, rather than nowhere.
   */
  k.note(`The ${model.squadSeason} roster as it stands. These minutes belong to the players `
    + 'listed; nothing here says they become available to anyone.');

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

  // The page's primary block is a titled region, like the arrivals block below
  // it. Under a module title it was the quieter of the two.
  k.heading('Every current player, at the year their eligibility ends');
  charts.eligibilityTimeline(k, {
    box: k.slot(lanes.length * 26 + 44),
    title: null,
    subtitle: 'One dot per player, sized by the minutes they are projected to play.',
    lanes,
    years,
    marker: model.entrySeason,
    unplaceable,
    unavailable: lanes.length ? null : 'no current roster on file',
  });

  /**
   * The projected-minutes column chart is not drawn here since 13B.
   *
   * It plotted one column per eligibility year — the same five years, the same
   * five totals — directly above a table that carries those totals AND the
   * player counts, the no-projection counts and the positions the minutes sit
   * in. One of the two was a strict subset of the other on the same page, and
   * the room it took is what the arrivals table now uses.
   */
  k.table({
    caption: `Every eligibility year on the ${model.squadSeason} roster, with the players behind it. `
      + `${model.entrySeason} is the season this report is prepared for.`,
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
    note: (proj.readable
      ? `Against ${nf(proj.total)} projected minutes across the players who carry a projection. `
      : 'Too few of the returning squad carry a projection for these totals to be read as a share '
        + 'of anything. ')
      + 'A year with no projected minutes is a year whose players hold none — every one of them a '
      + 'first-year, whose minutes would have to be carried forward from a season they have not '
      + 'played.',
  });

  /**
   * Who has arrived for the coming season — moved here from the historical
   * arrivals story, 13A / §H.
   *
   * It belongs with the current squad because that is what it describes: the
   * roster on campus now. Its minutes are PROJECTED, and the page it used to
   * share was a page of minutes actually played, which is why that page had to
   * warn a reader that its own two tables could not be read against each other.
   * Here every figure on the page is a current-roster figure and the warning is
   * the page's subject rather than an exception to it.
   */
  const arrivals = squad.arrivals ?? [];
  const athletePos = model.athlete ? canonicalPosition(model.athlete.position) : null;
  k.heading(arrivals.length
    ? `Arrived for ${model.squadSeason} — ${plural(arrivals.length, 'player', 'players')}`
    : `Arrived for ${model.squadSeason}`);
  if (!arrivals.length) {
    k.note(`Nobody on the ${model.squadSeason} roster is recorded as arriving from another `
      + 'programme. The roster records a previous programme for some players and not others, so '
      + `this is what is named rather than everyone who arrived. All `
      + `${plural(squad.rostered, 'player', 'players')} on this roster are listed individually in `
      + 'the supporting record at the back.');
  } else {
    k.table({
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
        // What the programme has historically done with arrivals is its own
        // section, and that section already points here. One direction is
        // enough; two is the cross-reference reading as an apology.
        `Recorded as arriving from another programme; the roster names a previous programme for `
          + `some players and not others. All ${plural(squad.rostered, 'player', 'players')} on `
          + 'this roster are listed individually in the supporting record at the back.',
      ].filter(Boolean).join(' ') || null,
    });
  }
}

// ---------------------------------------------------------------------------
// PAGE 12 — the roster in full
// ---------------------------------------------------------------------------

export function currentDepthPage(k, model) {
  const rows = model.summary.programme.squadTurnover.squad ?? [];
  const athletePos = model.athlete ? canonicalPosition(model.athlete.position) : null;

  // In the evidence act since 13B, and set one level quieter to say so: this is
  // the roster behind the outlook page, not a second analysis of it.
  pageHead(k, {
    kicker: 'The evidence behind it',
    title: 'The current squad in full',
    question: `Who is on the ${model.squadSeason} roster, and how established are they?`,
    quiet: true,
  });

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
