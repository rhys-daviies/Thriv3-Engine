/**
 * The athlete evidence layer.
 *
 * Page three says what an athlete should notice. These pages show the record
 * that supports it, filtered to their position and their background — a
 * genuinely narrowed view of the programme, never a programme-wide chart with
 * a position-specific caption.
 *
 * Two rules run through all of it. Where narrowing was refused or widened,
 * the page says so and names the group it actually used; a ladder labelled
 * "defenders" that is quietly the whole intake is the single most misleading
 * thing this report could print. And nothing describes a future roster: every
 * count is of the squad as it stands today, read against a date.
 */
import { charts, THEME, TYPE, pageHead, humanCohort, fitText } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';
import { positionPlural } from '../../shared/positions.js';
import { originIsProgrammeSpecific } from '../../shared/report/sections.js';

const { INK, MUTED, LINE, CLARET, NAVY, PALE, GREEN, W } = THEME;

const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const cap = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const page = (k, kicker, title, question) => pageHead(k, { kicker, title, question });
const scope = (k, parts) => k.scope(parts);

/** The noun for the athlete's position group, singular and plural. */
const noun = (a) => positionPlural(a.position).replace(/s$/, '');
const nouns = (a) => positionPlural(a.position);

// ---------------------------------------------------------------------------
// A — how this programme has treated players at the athlete's position
// ---------------------------------------------------------------------------

/**
 * WHO HAS BEEN USED AT THIS POSITION — a block, not a page, since 13F / §14.
 *
 * It was "Your position, historically", a page of its own directly after "What
 * this position has looked like here". Both answered one question — what this
 * position's record is — and a reader met the intake and the minute reach on
 * one sheet and the people on the next. They are one section now; this draws
 * its second half, under the record page's own head and scope.
 *
 * The minute mix went with it and did NOT come here. It was on three surfaces
 * at once — this block, the openings page and the programme's position page —
 * so it is drawn once, on the page that owns the question "who takes the
 * minutes when they come free".
 */
export function positionCohortBlock(k, model) {
  const a = model.summary.athlete;
  const fit = model.fit;
  const fh = a.positionFreshmanHistory;
  const ea = a.experiencedArrivalsAtPosition;

  /**
   * The break, taken before the heading rather than after it.
   *
   * `k.heading` reserves forty points, which is enough for the heading and not
   * for the cohort statement, ladder and fact list beneath it — so the first
   * draft of this consolidation left "FIRST-YEAR DEFENDERS" alone at the foot
   * of a page with its content on the next one. 260 is measured: the cohort
   * line, a three-rung ladder and the three fact rows come to 244 at
   * Mercyhurst men's.
   */
  if (k.remaining() < 260) {
    k.doc.addPage();
    pageHead(k, {
      title: 'What this position has looked like here',
      question: 'And who has this programme actually used in those minutes?',
      continued: true,
    });
  }

  // --- first-years at this position ---
  k.heading(`First-year ${nouns(a)}`);

  // The cohort the ladder actually describes, stated before the ladder itself.
  // freshmanProfile relaxes one dimension at a time when a group is too thin,
  // and a reader must never be shown the wider group under the narrower label.
  const cohort = fit?.cohort ?? null;
  if (cohort?.refused) {
    k.box(`We could not read your exact group here — ${humanCohort(cohort.refused)}. The ladder `
      + `below is the wider ${humanCohort(cohort.relaxed ?? 'whole intake')} group instead, and `
      + 'every figure on it describes that wider group.', { color: CLARET });
  } else if (cohort && !cohort.applied) {
    k.box('There were too few first-years in your own group to read separately, so the ladder below '
      + 'is the whole intake — every position and every background together.', { color: CLARET });
  }

  const ladder = (fit?.ladder ?? []).slice(0, 5);
  if (!ladder.length) {
    k.body(`No season on file carries enough recorded minutes to rank first-year ${nouns(a)} here.`,
      { color: MUTED });
  } else {
    const rows = ladder.map((r) => ({
      label: r.rank === 1 ? 'Best in the group' : `${r.rank}${['', 'st', 'nd', 'rd'][r.rank] || 'th'} best`,
      contributions: r.contributions ?? [],
      median: r.median,
      low: r.low,
      high: r.high,
      n: r.seasonsWithThisMany,
      agreement: r.agreement,
      comparable: r.comparable,
      poolMedian: null,
      poolP25: null,
      poolP75: null,
    }));
    charts.dotLadder(k, {
      box: k.slot(rows.length * 28 + 58),
      title: cohort?.applied
        ? `The ladder for ${humanCohort([cohort.position, cohort.origin].filter(Boolean).join(' / ')) || 'this group'}`
        : 'The ladder, read across the whole intake',
      subtitle: 'One dot per season, placed at the minutes that rank played. The heavy bar is the '
        + 'median across those seasons.',
      rows,
      xMax: Math.max(1600, ...rows.map((r) => r.high ?? 0)),
      marker: STARTER_MINUTES,
      poolLabel: null,
      unavailable: null,
    });
  }
  k.facts([
    [`First-year ${nouns(a)} measured`, String(fh.measured)],
    [`…who reached ${STARTER_MINUTES} minutes`, `${fh.starters} of ${fh.measured}`],
    ['Evidence behind this group', fh.evidence.level],
  ]);

  // --- experienced arrivals at this position ---
  k.gap(4);
  k.heading(`Experienced arrivals at ${noun(a)}`);
  if (!ea.measurableSeasons.length) {
    k.body('No season on file has the season before it on file, so an arrival at this position '
      + 'cannot be told from a player who was already here.', { color: MUTED });
  } else if (!ea.measured) {
    k.body(`Across ${plural(ea.measurableSeasons.length, 'measurable season', 'measurable seasons')}, `
      + `this programme added no experienced ${nouns(a)}. It has filled this position from its own `
      + 'recruiting class and from players already on the roster.', { color: MUTED });
  } else {
    k.facts([
      ['Experienced arrivals measured', String(ea.measured)],
      [`…who reached ${STARTER_MINUTES} minutes`, `${ea.starters} of ${ea.measured}`],
      ['Seasons they arrived in', ea.seasonsRepresented.join(', ') || '—'],
    ]);
    const xMax = Math.max(1600, ...ea.players.map((p) => p.minutes));
    charts.scatter(k, {
      box: k.slot(ea.measurableSeasons.length * 24 + 36),
      title: `Every experienced arrival at ${nouns(a)}`,
      subtitle: 'Minutes they went on to play, drawn as the first-years are.',
      lanes: ea.measurableSeasons,
      xMax,
      marker: STARTER_MINUTES,
      markerLabel: `${STARTER_MINUTES} — a starter’s season`,
      points: ea.players.map((p) => ({
        lane: p.season, value: p.minutes, size: p.gamesPlayed, sizeMax: Math.max(1, ...ea.players.map((x) => x.gamesPlayed)),
        solid: p.gamesStarted >= p.gamesPlayed / 2 && p.gamesPlayed > 0, color: GREEN,
      })),
      unavailable: null,
    });
  }

}

// ---------------------------------------------------------------------------
// B — what happened when a place opened here
// ---------------------------------------------------------------------------

export function positionOpeningsPage(k, model) {
  const a = model.summary.athlete;
  const v = a.positionVacancyHistory;
  const o = a.positionOpeningOutcomes;
  const events = a.positionVacancyRecord ?? [];

  page(k, 'Understanding your pathway', `When a place opens at ${noun(a)}`,
    'When a meaningful place has opened at your position, what actually happened next?');

  if (!v?.transitions) {
    k.body('This position does not carry enough recorded minutes here to read what happens when a '
      + 'place comes free. A season-to-season comparison needs both seasons to publish enough '
      + 'minutes at the position, and these do not.', { color: MUTED });
    return;
  }

  scope(k, [
    `${plural(v.transitions, 'readable transition', 'readable transitions')}`,
    `${plural(v.openings, 'starter opening', 'starter openings')}`,
    `evidence ${o.evidence.level}`,
  ]);

  if (!v.openings) {
    k.box(`No starter left ${noun(a)} in the seasons on file. That is a complete answer to what has `
      + 'happened, and no answer at all to what happens when one does.', { color: CLARET });
    return;
  }

  k.facts([
    ['Starters who left', String(v.startersDeparted)],
    ['Openings that followed', `${v.openings} of ${v.transitions} transitions`],
    ['A first-year then started', `${v.freshmanTookIt} of ${v.openings}`],
    ['An experienced arrival then started', `${v.newcomerTookIt} of ${v.openings}`],
  ]);
  k.note('These two counts can describe the same season. One opening can be filled by more than '
    + 'one player, so they are never subtracted from each other or from the total, and there is no '
    + 'single replacement to name.');

  // Small samples are stated loudly rather than converted into a percentage.
  if (!o.evidence.patternReadable) {
    k.box(`Only ${plural(v.openings, 'opening has', 'openings have')} been observed at this position. `
      + 'That is what happened, not a rate — a share of two reads far more confidently than it '
      + 'deserves to.', { color: CLARET });
  }

  /**
   * THE MINUTE MIX, DRAWN ONCE — 13F / §13.
   *
   * It was on three surfaces: the position-history page, the programme's own
   * position-by-position page, and per opening below. This is the page that
   * owns the question "who takes the minutes when they come free at this
   * position", so the aggregate is stated here and the history page stopped
   * drawing it. The programme page keeps its version, which is the comparison
   * ACROSS positions rather than the answer for this one.
   */
  const dials = o?.dials ?? null;
  if (dials?.n) {
    k.gap(2);
    k.heading(`Where ${noun(a)} minutes have gone`);
    k.stacked({ label: `Across ${plural(dials.n, 'readable position-season', 'readable position-seasons')}`, ...dials });
    k.note('These three shares divide the minutes played at this position exactly. They describe '
      + 'where the minutes went, not who won a place — a player can take minutes without anybody '
      + 'losing a job, and a place can be shared. The same three routes are compared across every '
      + 'position on the programme’s own position page.');
  }

  k.gap(4);
  k.heading('The openings themselves');

  // One card per opening, with the four facts an opening consists of kept
  // visibly apart: the transition, who left, how many minutes went with them,
  // and what the following season did about it. They were three run-on lines
  // that clipped the departing players' names on any position with more than
  // two departures, on a page that then ended in 400 points of nothing.
  for (const e of events) {
    const left = e.departed ?? [];
    // The card is as tall as its TALLER column. Sizing it off the departures
    // alone put the minute split and its key outside the card and on top of
    // the next one.
    const leftH = 12 + Math.max(1, left.length) * 13;
    const rightH = 12 + 26 + (e.returningShare != null ? 22 : 12);
    const bodyH = Math.max(leftH, rightH);
    const cardH = 28 + bodyH + 8;
    k.room(cardH + 12);
    const top = k.doc.y;
    const half = (W - 26) / 2;
    const rightX = THEME.M + 14 + half + 12;

    k.doc.save().roundedRect(THEME.M, top, W, cardH, 3)
      .lineWidth(0.75).strokeColor(LINE).stroke().restore();
    k.doc.save().rect(THEME.M, top, 3, cardH).fill(CLARET).restore();

    // The transition, and the size of the hole it left.
    k.doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
      .text(e.transition, THEME.M + 14, top + 9, { width: half, lineBreak: false });
    k.doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(e.vacatedStarterMinutes == null
        ? 'starter minutes vacated not readable'
        : `${nf(e.vacatedStarterMinutes)} starter minutes vacated`,
      THEME.M + W - 14 - 180, top + 11, { width: 180, align: 'right', lineBreak: false, ellipsis: true });
    k.doc.save().moveTo(THEME.M + 14, top + 24).lineTo(THEME.M + W - 14, top + 24)
      .lineWidth(0.5).strokeColor(LINE).stroke().restore();

    // Left: every departing starter by name, one per line, never truncated
    // into "and others".
    let ly = top + 32;
    k.doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
      .text('WHO LEFT', THEME.M + 14, ly, { width: half, characterSpacing: TYPE.label.spacing, lineBreak: false });
    ly += 10;
    for (const d of left) {
      k.doc.font('Helvetica').fontSize(7.8).fillColor(INK)
        .text(fitText(k.doc, d.name ?? '—', half - 60), THEME.M + 14, ly, { width: half - 60, lineBreak: false });
      k.doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
        .text(`${nf(d.minutes)} min`, THEME.M + 14 + half - 58, ly, { width: 58, align: 'right', lineBreak: false });
      ly += 13;
    }
    if (!left.length) {
      k.doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED)
        .text('no departing starter named', THEME.M + 14, ly, { width: half, lineBreak: false });
    }

    // Right: what the following season did about it.
    let ry = top + 32;
    k.doc.font(TYPE.label.font).fontSize(TYPE.label.size).fillColor(TYPE.label.color)
      .text('WHAT HAPPENED NEXT', rightX, ry, { width: half, characterSpacing: TYPE.label.spacing, lineBreak: false });
    ry += 10;
    for (const [label, n] of [['First-years who started', e.freshStarters],
      ['Experienced arrivals who started', e.newcomerStarters]]) {
      k.doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
        .text(fitText(k.doc, label, half - 30), rightX, ry, { width: half - 30, lineBreak: false });
      k.doc.font('Helvetica-Bold').fontSize(7.8).fillColor(INK)
        .text(n ? String(n) : 'none', rightX + half - 28, ry, { width: 28, align: 'right', lineBreak: false });
      ry += 13;
    }
    // The minute split for this one transition, on the same three colours the
    // rest of the report uses for it.
    if (e.returningShare != null) {
      const parts = [
        { v: e.returningShare, c: PALE }, { v: e.freshmanShare, c: NAVY }, { v: e.newcomerShare, c: GREEN },
      ].filter((x) => x.v != null);
      const total = parts.reduce((sum, x) => sum + x.v, 0) || 100;
      let cx = rightX;
      for (const part of parts) {
        const segW = (part.v / total) * (half - 4);
        k.doc.save().rect(cx, ry + 3, Math.max(0, segW - 1), 8).fill(part.c).restore();
        cx += segW;
      }
      ry += 13;
      k.doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(`${Math.round(e.returningShare)}% returning · ${Math.round(e.freshmanShare ?? 0)}% first-years`
          + ` · ${Math.round(e.newcomerShare ?? 0)}% experienced arrivals`,
        rightX, ry, { width: half, lineBreak: false, ellipsis: true });
    } else {
      k.doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED)
        .text('the minute split for this transition is not readable', rightX, ry,
          { width: half, lineBreak: false, ellipsis: true });
    }

    k.doc.y = top + cardH + 10;
  }
}

// ---------------------------------------------------------------------------
// C — who is at the position now
// ---------------------------------------------------------------------------

/**
 * YOUR POSITION, AND THE TIMING AROUND YOUR ARRIVAL — 13F / §11.
 *
 * Two pages until this phase: "Defenders on the 2026 roster" and "Your arrival
 * window, 2027", consecutive, answering one question. The first opened with
 * four counts that were the second's three eligibility bands restated, and a
 * reader had to hold seventeen names across a page turn to put them together.
 *
 * One section now, in the order the question is actually asked: when do the
 * players at this position run out of eligibility, who are they, and what
 * playing-time load do they hold. It is allowed to run onto a second sheet —
 * seventeen defenders need one — because the consolidation is of the question,
 * not of the paper.
 *
 * NOTHING IS DROPPED. The timeline, the three bands with their names, the
 * primary limitation, the coverage note and the non-forecast sentence under the
 * table all survive. What went is the duplicated count block and the per-player
 * status column, which repeated the bands drawn immediately above it.
 */
export function currentPositionPage(k, model) {
  const a = model.summary.athlete;
  const players = a.currentPositionPlayers ?? [];

  page(k, 'Understanding your pathway', 'Your position, and the timing around your arrival',
    `Who is at your position now, and what eligibility timing sits around ${a.entrySeason}?`);

  if (!players.length) {
    k.body(`No ${model.squadSeason} roster is on file for this programme, or nobody on it is `
      + `recorded at ${nouns(a)}.`, { color: MUTED });
    return;
  }

  const before = a.currentProjectedMinutesOfPlayersEndingBeforeEntry;
  const final = a.currentProjectedMinutesOfPlayersInFinalSeasonAtEntry;
  const beyond = a.currentProjectedMinutesOfPlayersBeyondEntry;
  const unknown = a.currentProjectedMinutesOfPlayersWithUnknownEligibility;
  const years = [...new Set(players.map((p) => p.eligibleTo).filter((y) => y != null))]
    .map(Number).sort((x, y) => x - y);

  scope(k, [
    `${plural(players.length, `current ${noun(a)}`, `current ${nouns(a)}`)}`,
    years.length ? `${(a.currentPlayersBeyondEntry ?? []).length} eligible beyond ${a.entrySeason}` : null,
    years.length ? `${(a.currentPlayersInFinalSeasonAtEntry ?? []).length} in a final season in ${a.entrySeason}` : null,
  ].filter(Boolean));

  /**
   * Nothing on this roster can be placed against a year. The three bands would
   * all read zero for a reason that has nothing to do with the squad, which is
   * the null-is-not-zero defect this whole report exists downstream of. The
   * table still draws, because the players are still the answer to half the
   * question.
   */
  if (!years.length) {
    k.body(`No eligibility year is recorded for any of the ${plural(players.length, 'current', 'current')} `
      + `${nouns(a)} on the ${model.squadSeason} roster.`, { bold: true });
    k.body('So this section cannot say which of them are in a final season when you arrive, which '
      + 'have already finished, and which are eligible beyond it. That is a gap in what this '
      + 'programme publishes, not a squad with nobody in it — the players are listed below.',
    { color: MUTED });
    k.box('Future recruits, experienced arrivals, injuries, redshirts and eligibility changes are '
      + 'not known either. This section describes the squad as it stands today, and today it '
      + 'cannot be read against a year.', { color: CLARET, title: 'The primary limitation' });
  } else {
    charts.eligibilityTimeline(k, {
      box: k.slot(140),
      title: `Every current ${noun(a)}, at the year their eligibility ends`,
      subtitle: 'Dot size is the minutes they are projected to play. The dashed line is your entry year.',
      lanes: [{ label: cap(nouns(a)), players }],
      years,
      marker: a.entrySeason,
      unplaceable: a.currentPlayersEligibilityUnknown.length,
      unavailable: null,
    });

    // Three bands, with the final-season group as the visual focus.
    const bands = [
      { key: 'before', label: 'BEFORE ENTRY', sub: `eligibility ends before ${a.entrySeason}`,
        group: a.currentPlayersEligibilityEndsBeforeEntry, minutes: before, color: MUTED },
      { key: 'final', label: 'FINAL SEASON AT ENTRY', sub: `last eligible season is ${a.entrySeason}, the year you arrive`,
        group: a.currentPlayersInFinalSeasonAtEntry, minutes: final, color: CLARET, focus: true },
      { key: 'beyond', label: 'BEYOND ENTRY', sub: `eligible past ${a.entrySeason}`,
        group: a.currentPlayersBeyondEntry, minutes: beyond, color: NAVY },
    ];

    k.gap(4);
    for (const b of bands) {
      k.room(b.focus ? 60 : 44);
      const top = k.doc.y;
      const h = b.focus ? 52 : 38;
      if (b.focus) {
        k.doc.save().rect(THEME.M, top, W, h).fillOpacity(0.05).fill(CLARET).restore();
      }
      k.doc.save().rect(THEME.M, top, 3, h).fill(b.color).restore();
      k.doc.font('Helvetica-Bold').fontSize(b.focus ? 8 : 7).fillColor(b.focus ? CLARET : INK)
        .text(b.label, THEME.M + 12, top + 7, { width: W * 0.6, characterSpacing: 0.7, lineBreak: false });
      k.doc.font('Helvetica').fontSize(7).fillColor(MUTED)
        .text(b.sub, THEME.M + 12, top + (b.focus ? 18 : 17), { width: W * 0.6, lineBreak: false, ellipsis: true });
      k.doc.font('Helvetica-Bold').fontSize(b.focus ? 20 : 15).fillColor(INK)
        .text(String((b.group ?? []).length), THEME.M + W - 150, top + 6, { width: 40, align: 'right', lineBreak: false });
      // Measured and cut to one line: the longer phrasing wrapped and landed on
      // the sub-line beneath it.
      const minutesText = b.minutes?.currentProjectedMinutes == null
        ? 'no projected minutes recorded'
        : `${nf(b.minutes.currentProjectedMinutes)} projected minutes attached`;
      k.doc.font('Helvetica').fontSize(7).fillColor(MUTED);
      k.doc.text(fitText(k.doc, minutesText, 150), THEME.M + W - 150, top + (b.focus ? 12 : 8),
        { width: 150, align: 'right', lineBreak: false });
      if (b.minutes?.playersWithoutProjection) {
        k.doc.font('Helvetica').fontSize(6.5).fillColor(MUTED);
        k.doc.text(fitText(k.doc, `${b.minutes.playersWithoutProjection} of them carry no projection`, 150),
          THEME.M + W - 150, top + (b.focus ? 23 : 19), { width: 150, align: 'right', lineBreak: false });
      }
      if (b.focus) {
        const names = (b.group ?? []).map((p) => p.name).join(', ');
        k.doc.font('Helvetica').fontSize(7).fillColor(INK)
          .text(names || 'nobody at this position is in their final eligible season that year',
            THEME.M + 12, top + 34, { width: W - 24, lineBreak: false, ellipsis: true });
      }
      k.doc.y = top + h + 6;
    }

    if (a.currentPlayersEligibilityUnknown.length) {
      k.note(`${plural(a.currentPlayersEligibilityUnknown.length, 'current player', 'current players')} `
        + 'at this position has no eligibility year recorded and is counted in none of the three '
        + `bands${unknown?.currentProjectedMinutes == null ? '' : `, holding ${nf(unknown.currentProjectedMinutes)} projected minutes between them`}.`);
    }
  }

  /**
   * The players themselves.
   *
   * NO STATUS COLUMN since 13F. It read "final season in 2027" or "eligible
   * beyond 2027" on every row, which is the three bands drawn immediately above
   * it, one player at a time. The width goes to the two columns that were being
   * cut — the same fix the programme roster table took in 13D.1, where
   * "Texas A&M University-Victoria" arrived as "Texas A&M Universit…".
   */
  k.heading(`Every current ${noun(a)}`);
  k.table({
    continued: `${cap(nouns(a))} on the ${model.squadSeason} roster`,
    columns: [
      { key: 'name', label: 'Player', width: 0.28, bold: true },
      { key: 'classLabel', label: 'Class', width: 0.11 },
      { key: 'projectedMinutes', label: 'Projected minutes', width: 0.17, align: 'right', format: (v) => (v == null ? null : nf(v)) },
      { key: 'eligibleTo', label: 'Eligible through', width: 0.14, align: 'right' },
      { key: 'arrivedFrom', label: 'Previous programme', width: 0.3, dropWhenEmpty: true },
    ],
    rows: [...players].sort((x, y) => (y.projectedMinutes ?? -1) - (x.projectedMinutes ?? -1)),
    // The athlete's own entry year is the thing being read against, so the
    // final-season group is marked rather than colour-coded good or bad.
    highlight: (row) => row.eligibleTo != null && Number(row.eligibleTo) === a.entrySeason,
    note: 'The marked rows are players whose last eligible season is your entry year. Projected '
      + 'minutes are attached to those players for the coming season; they are not minutes that '
      + 'pass to anyone.',
  });

  if (years.length) {
    k.box('Future recruits, experienced arrivals, injuries, redshirts and eligibility changes are '
      + 'not known. This section describes the squad as it stands today, read against your entry '
      + 'year — it does not describe the squad you would find.',
    { color: CLARET, title: 'The primary limitation' });

    if (!a.entrySeasonKnown) {
      k.aside(`Rosters and coaching records are held through ${model.squadSeason}. You would arrive `
        + `in ${a.entrySeason}, which is beyond that horizon: who is in charge and who is on the `
        + 'squad by then is further outside what this data can show than the bands above already '
        + 'are.', { title: 'A note on coverage' });
    }
  }
}

// ---------------------------------------------------------------------------
// E — origin
// ---------------------------------------------------------------------------

export function originPage(k, model) {
  const a = model.summary.athlete;
  const o = a.originContext;
  const originWord = o.requestedOrigin === 'international' ? 'international' : 'US-based';

  /**
   * ONE KICKER AND ONE WEIGHT, since 13F pinned this page to the pathway act.
   *
   * It used to follow the act it was filed under, which moved with the cohort
   * gate: a page that was mostly division context announced itself as evidence
   * and was set quiet. It does not move any more, so it does not change voice.
   * What still changes is what the page SAYS — a programme with its own record
   * by origin shows it, and one without shows the refusal in full, which for an
   * international athlete is the finding.
   */
  pageHead(k, {
    kicker: 'Understanding your pathway',
    title: 'Where you are arriving from',
    question: 'Does this programme’s record show anything useful for first-years from your '
      + 'background?',
  });
  // Stated once, at the top, and never implied away: the origin split is
  // across the whole intake. The previous pages narrow to a position, and a
  // reader arriving here from them would otherwise carry that narrowing over.
  // The scope strip draws on ONE line, so the third item is short.
  k.scope(['every position, not only yours',
    'origin is grouped only as within or outside the United States',
    originIsProgrammeSpecific(o) ? null : 'mostly division context'].filter(Boolean));

  if (!o.requestedOrigin) {
    k.body('No origin is recorded for this athlete, so the record cannot be read by background.',
      { color: MUTED });
    return;
  }

  const same = o.programme.sameOrigin;
  const other = o.programme.otherOrigin;

  k.heading('At this programme, across every position');
  if (!o.evidence.sufficient || same.share == null) {
    k.body(`Not enough programme-specific history to compare by origin: `
      + `${plural(same.players, `${originWord} first-year`, `${originWord} first-years`)} on file here`
      + `${same.players ? `, of whom ${same.starters} reached ${STARTER_MINUTES} minutes` : ''}.`,
    { color: MUTED });
    k.note('The pool figures below describe the division, not this programme. They are context, not '
      + 'a substitute for evidence this programme has not produced.');
  } else {
    k.facts([
      [`${cap(originWord)} first-years measured here, all positions`, String(same.players)],
      [`…who reached ${STARTER_MINUTES} minutes`, `${same.starters} of ${same.players}`],
      ['Seasons represented', String(o.evidence.sample.seasons ?? '—')],
    ]);
    k.body(`At this programme, ${same.starters} of ${same.players} measured ${originWord} first-years `
      + `reached ${STARTER_MINUTES} minutes.`, { bold: true });
    if (other.share != null) {
      k.body(`The other group, for comparison: ${other.starters} of ${other.players}.`, { color: MUTED });
    }
  }
  if (o.programme.withoutRecordedOrigin) {
    k.note(`${plural(o.programme.withoutRecordedOrigin, 'first-year', 'first-years')} here `
      + 'record neither a nationality nor a country and are counted in neither group.');
  }

  if (o.pool?.sameOrigin?.impactShare != null) {
    k.gap(4);
    k.heading(o.pool.scope === 'division' ? `Across ${o.pool.division}` : 'Across every division measured');
    const rows = [
      { label: `${cap(originWord)} first-years`, a: Math.round(o.pool.sameOrigin.impactShare * 100), b: null },
      { label: 'The other group', a: o.pool.otherOrigin?.impactShare == null ? null
        : Math.round(o.pool.otherOrigin.impactShare * 100), b: null },
    ];
    charts.paired(k, {
      box: k.slot(64),
      title: `First-years who reached ${STARTER_MINUTES} minutes`,
      subtitle: `${nf(o.pool.sameOrigin.players)} and ${nf(o.pool.otherOrigin?.players)} players `
        + 'respectively, across every programme measured at this level.',
      rows,
      aLabel: '', bLabel: '', max: 100, unit: '%',
      unavailable: null,
    });
    k.note('Measured within this division rather than across the game, because the relationship is '
      + 'not one thing: it runs one way at some levels and the other way at others. It describes '
      + 'who has played, not why. Where a player is arriving from is not the cause of the '
      + 'difference, and the groups differ in more ways than this measures. Origin is grouped only '
      + 'as within or outside the United States — never by individual nationality, because there '
      + 'are never enough players from one country at one programme to measure.');
  } else if (o.poolReason) {
    k.note(`No benchmark comparison is shown: ${o.poolReason}.`);
  }

  if (o.cohortRelaxed) {
    k.gap(2);
    k.box(`The ladder on the earlier position page could not be read for your exact group and used `
      + `the wider ${humanCohort(o.cohortRelaxed)} group instead. The figures on this page are the `
      + 'origin split itself, counted directly, and are not affected by that widening.',
    { color: CLARET });
  }
}
