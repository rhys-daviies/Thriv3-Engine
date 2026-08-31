/**
 * What one position has looked like at one programme.
 *
 * Two independent histories on one page, and they are on one page because
 * neither answers the family's question alone. How often the programme brings
 * new players into a position says nothing about how far the minutes at that
 * position reach; Phase 8B measured the two and found them uncorrelated
 * (r = 0.05 to 0.13). Akron is the case that makes it concrete: seven, nine
 * and four midfielders arrive per cycle AND meaningful midfield minutes have
 * reached more players than the comparable middle half. Either figure alone
 * invites the wrong reading.
 *
 * THEY ARE NEVER COMBINED. No score, no index, no arithmetic between them.
 * They are placed next to each other and the reader does the joining, which is
 * the only honest operation available: nothing in roster data says which of the
 * two matters more to one athlete.
 *
 * NO CATEGORY. Every model behind this page refuses banding, each for its own
 * measured reason, so this page prints counts, the programme's own range, and
 * the pool's median and middle half. There is no word here for "broad" or
 * "narrow" and there must not be one.
 *
 * GOALKEEPERS get the intake half and nothing else, quietly. Position-level
 * minute distribution is not reported for them because the median programme
 * uses two goalkeepers and one reaches a starter's season — there is no
 * distribution to describe. The page says so in one line and moves on; it does
 * not leave a blank panel and it never says the evidence was thin.
 */
import { charts, THEME, TYPE, pageHead, spanText, fitText } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';

const { MUTED, CLARET, NAVY, MID, PALE, INK } = THEME;
const pc = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "four seasons on file" / "the two seasons with enough position-level minutes". */
function basisText(n, total) {
  if (n >= total) return `all ${n} seasons on file`;
  return `${n === 1 ? 'the single season' : `the ${n === 2 ? 'two' : n === 3 ? 'three' : n} seasons`} `
    + `of ${total} on file with enough position-level minutes to read`;
}

/**
 * The intake half: how often the programme has added a player here.
 *
 * Cycles as raw counts, first-years and experienced arrivals stacked so the
 * mix is visible without a second chart, and the current season's known intake
 * held apart by a rule — a roster published before the season is played is not
 * a completed cycle and is never averaged with them.
 */
function intakeBlock(k, intake, { plural: posPlural }) {
  const h = intake.historical;
  k.heading('How often this position has been added to');
  if (h.suppressed) {
    k.note(h.suppressedReason
      ? `${h.suppressedReason[0].toUpperCase()}${h.suppressedReason.slice(1)}.`
      : 'Not enough recruiting cycles on file to read this position’s intake.');
    // The current roster is still an observation, and at a programme with one
    // season on file it is the only one there is.
    const now = intake.current;
    if (now?.readable && now.totalIncoming != null) {
      k.note(`The roster published for ${now.season} carries `
        + `${plural(now.totalIncoming, 'player', 'players')} new to the programme at this `
        + `position${now.experiencedArrivals ? `, ${now.experiencedArrivals} of them with college `
          + 'seasons behind them' : ''}. One roster is one roster, and there is no earlier season `
        + 'on file to read it against.');
    }
    return;
  }
  const cycles = intake.cycles.filter((c) => !c.current && c.readable);
  const current = intake.cycles.find((c) => c.current) ?? null;
  const yMax = Math.max(2, ...intake.cycles.map((c) => c.totalIncoming ?? 0));

  charts.columns(k, {
    box: k.slot(112),
    title: null,
    // A chart subtitle draws on ONE line and is truncated past it, so the
    // legend lives here and the explanation lives in the note below.
    subtitle: 'Navy: a first-time college player.   Pale: an arrival with college seasons behind them.',
    yMax,
    stacked: true,
    groups: [
      ...cycles.map((c) => ({
        label: c.season,
        note: `${c.totalIncoming} in`,
        bars: [
          { key: 'first', value: c.firstYears, color: NAVY },
          { key: 'experienced', value: c.experiencedArrivals, color: PALE },
        ],
      })),
      ...(current ? [{
        label: `${current.season} so far`,
        note: current.readable ? `${current.totalIncoming} in` : null,
        bars: current.readable
          ? [{ key: 'first', value: current.firstYears, color: NAVY },
            { key: 'experienced', value: current.experiencedArrivals, color: PALE }]
          : [{ key: 'first', value: null }],
      }] : []),
    ],
    unavailable: cycles.length ? null : 'no recruiting cycle on file has a roster on both sides',
  });

  k.note('Players new to the programme at this position, counted by the season they arrived into.');
  const bits = [
    `A median of ${h.medianTotalIncoming} across ${plural(h.cyclesWithReadableRosterPresence, 'cycle', 'cycles')}`,
    h.pool ? `the comparable middle half runs ${spanText(h.pool.middleHalf)}` : null,
    h.cyclesWithAnExperiencedArrival != null
      ? `an arrival with college experience in ${h.cyclesWithAnExperiencedArrival} of them` : null,
  ].filter(Boolean);
  k.note(`${bits.join(' · ')}. The final column is the roster published for the coming season, `
    + 'which is what is known so far rather than a completed cycle.');
  if (h.rosterJumpedSeasons?.length) {
    k.note(`The roster itself changed size sharply in ${h.rosterJumpedSeasons.join(', ')}, so `
      + `${h.rosterJumpedSeasons.length === 1 ? 'that intake' : 'those intakes'} describes the `
      + 'squad page as much as the recruiting.');
  }
}

/**
 * The minutes half: how far the playing time at this position has reached.
 *
 * Two counts, each with the programme's own season-by-season range and the
 * pool's middle half behind it. `playersWithMinutes` rides along on every row
 * because four of eight and four of five are different findings: Akron
 * women's defence used five defenders in two of its seasons and all five
 * reached a starter's season, which is a small squad rather than a wide one.
 */
function minutesBlock(k, util, { plural: posPlural, division }) {
  k.heading('How far the minutes at this position have reached');
  if (!util.supported) {
    k.note('Position-level minute distribution is not reported for goalkeepers: the position '
      + 'carries two or three players and one of them plays, so there is no distribution of '
      + 'minutes to describe. The pages either side of this one still read the goalkeeping '
      + 'position directly.');
    return;
  }
  if (!util.available) {
    // Grouped by reason rather than listed per season: four seasons refused
    // for the same cause printed the same sentence four times.
    const byReason = new Map();
    for (const r of util.refusedSeasons ?? []) {
      if (!byReason.has(r.reason)) byReason.set(r.reason, []);
      byReason.get(r.reason).push(r.season);
    }
    const said = [...byReason.entries()]
      .map(([reason, seasons]) => `${seasons.join(', ')}: ${reason}`)
      .join('. ');
    k.note(`${util.reason[0].toUpperCase()}${util.reason.slice(1)}.${said ? ` ${said}.` : ''}`);
    if (util.singleSeasonObservation) {
      const o = util.singleSeasonObservation;
      k.note(`One season on file can be read. In ${o.season}, `
        + `${plural(o.playersWith600Plus, 'player', 'players')} at this position reached `
        + `${STARTER_MINUTES} minutes out of ${o.playersWithMinutes} used, and `
        + `${plural(o.playersFor75, 'player', 'players')} held three-quarters of the minutes. `
        + 'One season is one season, and this is not a programme record.');
    }
    return;
  }

  const rows = [
    {
      label: `${STARTER_MINUTES}+ minutes`,
      longLabel: `Players reaching ${STARTER_MINUTES} minutes`,
      value: util.medianPlayersWith600Plus,
      range: util.rangePlayersWith600Plus,
      pool: util.pool?.playersWith600Plus ?? null,
      seasons: util.seasons.filter((s) => s.readable).map((s) => s.playersWith600Plus),
    },
    {
      label: '¾ of minutes',
      longLabel: 'Players holding three-quarters of the minutes',
      value: util.medianPlayersFor75,
      range: util.rangePlayersFor75,
      pool: util.pool?.playersFor75 ?? null,
      seasons: util.seasons.filter((s) => s.readable).map((s) => s.playersFor75),
    },
  ];
  const xMax = Math.max(8, ...rows.flatMap((r) => [
    r.range?.high ?? 0, r.pool?.p90 ?? 0, util.medianPlayersWithMinutes ?? 0,
  ])) + 1;

  const seasonList = util.seasons.filter((s) => s.readable).map((s) => s.season);
  charts.dotLadder(k, {
    box: k.slot(92),
    title: null,
    subtitle: 'A dot per season; the heavy bar is this programme’s median across them.',
    xMax,
    rows: rows.map((r) => ({
      label: r.label,
      comparable: true,
      n: r.seasons.length,
      low: r.range?.low ?? null,
      high: r.range?.high ?? null,
      // A degenerate range prints the season count instead of "4–4": the
      // renderer only shows a span where `agreement` says the seasons differ.
      agreement: (r.range && r.range.low !== r.range.high) ? 'wide' : 'tight',
      contributions: r.seasons.map((v, i) => ({ season: seasonList[i], minutes: v })),
      median: r.value,
      poolMedian: r.pool?.median ?? null,
      poolP25: r.pool?.p25 ?? null,
      poolP75: r.pool?.p75 ?? null,
    })),
    poolLabel: util.poolScope ? `the middle half of ${util.poolScope}` : null,
    unavailable: null,
  });

  // `dotLadder` prints its own key below the box and the flow cursor is
  // restored to the box edge, so anything written next lands on it.
  k.gap(18);
  for (const r of rows) {
    const span = spanText(r.range);
    k.note(`${r.longLabel}: a median of ${r.value}${span && span !== String(r.value) ? `, ranging ${span} across the seasons read` : ' in every season read'}`
      + `${r.pool ? `, against a comparable median of ${r.pool.median} and a middle half of ${spanText(r.pool.middleHalf)}` : ''}.`);
  }
  k.note(`Out of ${util.medianPlayersWithMinutes} ${posPlural} used in a typical season on this `
    + 'roster. A count is only as wide as the squad it came from.');
}

/**
 * The page. One position, two histories, and a sentence that only restates
 * what is printed above it.
 */
export function positionRecordPage(k, model) {
  const a = model.summary?.athlete;
  const intake = model.pressure?.athletePosition ?? null;
  const util = model.positionUtilisation?.athletePosition ?? null;
  const posPlural = util?.plural ?? intake?.plural ?? 'players';

  pageHead(k, {
    kicker: 'Understanding your pathway',
    title: `What this position has looked like here`,
    question: `How often has this programme added ${posPlural}, and how far have the minutes at `
      + 'this position reached?',
    scope: [
      util?.available
        ? basisText(util.readableSeasons, util.seasons.length)
        : (intake?.historical?.cyclesWithReadableRosterPresence
          ? `${plural(intake.historical.cyclesWithReadableRosterPresence, 'recruiting cycle', 'recruiting cycles')} on file`
          : null),
      util?.poolScope ? `compared against ${util.poolScope}` : null,
      'not a forecast',
    ].filter(Boolean),
  });

  if (intake) intakeBlock(k, intake, { plural: posPlural });
  k.gap(6);
  if (util) minutesBlock(k, util, { plural: posPlural, division: model.college?.division });

  const sentences = positionRecordReading(model);
  if (sentences.length) k.reading(sentences);
}

/**
 * What the two halves say when read together.
 *
 * Restates printed figures and does nothing else. No sentence here may exist
 * unless both of its numbers are on the page above it.
 */
export function positionRecordReading(model) {
  const intake = model.pressure?.athletePosition ?? null;
  const util = model.positionUtilisation?.athletePosition ?? null;
  const posPlural = util?.plural ?? intake?.plural ?? 'players';
  const out = [];
  const h = intake?.historical;

  if (h && !h.suppressed) {
    const poolBit = h.pool
      ? ` The comparable middle half is ${spanText(h.pool.middleHalf)} a cycle.` : '';
    out.push(`Across ${plural(h.cyclesWithReadableRosterPresence, 'recruiting cycle', 'recruiting cycles')} `
      + `this programme added ${h.totalIncomingPerCycle.join(', ')} ${posPlural}, a median of `
      + `${h.medianTotalIncoming}.${poolBit}`);
  }
  if (intake?.current?.readable && intake.current.totalIncoming != null) {
    const c = intake.current;
    out.push(c.totalIncoming === 0
      ? `The roster published for ${c.season} carries no new ${posPlural} so far.`
      : `The roster published for ${c.season} carries ${plural(c.totalIncoming, `new ${util?.noun ?? 'player'}`, `new ${posPlural}`)} so far`
        + `${c.experiencedArrivals ? `, ${c.experiencedArrivals} of them with college seasons behind them` : ''}.`);
  }
  if (util?.available) {
    const p = util.pool?.playersWith600Plus ?? null;
    out.push(`In ${basisText(util.readableSeasons, util.seasons.length)}, a median of `
      + `${util.medianPlayersWith600Plus} ${posPlural} reached ${STARTER_MINUTES} minutes, out of `
      + `${util.medianPlayersWithMinutes} used`
      + `${p ? `, against a comparable median of ${p.median}` : ''}.`);
    out.push(`Three-quarters of the minutes at this position went to a median of `
      + `${util.medianPlayersFor75} ${posPlural}.`);
  }
  return out.slice(0, 4);
}
