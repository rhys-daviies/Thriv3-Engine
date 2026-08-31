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
import { charts, THEME, pageHead, spanText } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';

const { NAVY, PALE } = THEME;
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
    box: k.slot(134),
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
function minutesBlock(k, util, { plural: posPlural }) {
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
      denominator: true,
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
    box: k.slot(96),
    title: null,
    subtitle: 'A dot per season; the heavy bar is this programme’s median across them.',
    xMax,
    rows: rows.map((r) => ({
      label: r.label,
      comparable: true,
      n: r.seasons.length,
      low: r.range?.low ?? null,
      high: r.range?.high ?? null,
      // Always the season count, never the span. The renderer prints a span
      // for `wide` and a count for `tight`, and a page that showed "2–3" on
      // one rung and "2 seasons" on the next was reporting two different
      // things in the same column because one range happened to have width.
      // The span is in the note below and the dots show it; the count is the
      // thing a reader needs beside the median.
      agreement: 'tight',
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
    // The denominator rides ON the starter row rather than in a sentence of
    // its own below it. Four of eight and four of five are different findings,
    // and a reader who stops at the end of the first sentence should already
    // have both numbers: Akron women's defence used five defenders and all
    // five reached a starter's season.
    const denom = r.denominator
      ? ` out of ${util.medianPlayersWithMinutes} ${posPlural} used in a typical season` : '';
    // The range only where it HAS width. "a median of 5 out of 5 defenders
    // used in a typical season in every season" was two clauses saying the
    // same thing badly; the ladder beside it already prints the season count.
    const varies = span && span !== String(r.value);
    k.note(`${r.longLabel}: a median of ${r.value}${denom}`
      + (varies ? `, ranging ${span} across the seasons` : '')
      + `${r.pool ? `, compared with a comparable median of ${r.pool.median} and a middle half of `
        + `${spanText(r.pool.middleHalf)}` : ''}.`);
  }
  // The thin-history fact, once, beside the comparison it qualifies — it is
  // also in the scope line at the top of the page and in the synthesis, and
  // three places was already one too many.
  if (util.readableSeasons < util.seasons.length) {
    k.note(`Both medians are drawn from ${basisText(util.readableSeasons, util.seasons.length)}.`);
  }
  k.note('A count of players is only ever as wide as the squad it was counted in.');
}

/**
 * The page. One position, two histories, and a closing block that reads them
 * against each other rather than repeating either.
 */
export function positionRecordPage(k, model) {
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
  if (util) minutesBlock(k, util, { plural: posPlural });

  const sentences = positionRecordReading(model);
  if (sentences.length) k.reading(sentences);
}

/**
 * What the two halves say when read TOGETHER, and only that.
 *
 * This block used to restate four figures already printed a few centimetres
 * above it: the intake median and its pool band, the coming season's known
 * intake, the starter count with its denominator, and the three-quarters
 * count. A synthesis that reprints the evidence beside it is not a synthesis —
 * it is the same page twice, and it was the largest block of duplicate prose
 * in the report.
 *
 * What it adds instead is the RELATIONSHIP, which neither half states and
 * which no other page in the report can state: how often this programme adds
 * players here, set against how far the minutes here have reached, and the
 * warning that the two do not predict each other. Phase 8B measured them at
 * r = 0.05 to 0.13, so a reader who assumes a busy intake means shallow
 * minutes has assumed something the data does not support.
 *
 * It computes nothing. Every number is printed above it.
 */
export function positionRecordReading(model) {
  const intake = model.pressure?.athletePosition ?? null;
  const util = model.positionUtilisation?.athletePosition ?? null;
  const posPlural = util?.plural ?? intake?.plural ?? 'players';
  const h = intake?.historical;
  const intakeReads = Boolean(h && !h.suppressed);
  const minutesRead = Boolean(util?.available);
  const out = [];

  if (intakeReads && minutesRead) {
    out.push(`This programme has added a median of ${h.medianTotalIncoming} ${posPlural} a `
      + `recruiting cycle, and a median of ${util.medianPlayersWith600Plus} reached `
      + `${STARTER_MINUTES} minutes out of ${util.medianPlayersWithMinutes} used in a season.`);
    out.push('Those are two separate records of the same position, and neither one predicts the '
      + 'other: across the programmes we measure, how often a position is added to and how far its '
      + 'minutes reach are barely related.');
  } else if (intakeReads && util && !util.supported) {
    out.push(`The intake at this position reads across `
      + `${plural(h.cyclesWithReadableRosterPresence, 'recruiting cycle', 'recruiting cycles')}. `
      + 'How far the minutes reach is not reported for goalkeepers, so this page is one record '
      + 'rather than two.');
  } else if (intakeReads) {
    out.push(`The intake at this position reads across `
      + `${plural(h.cyclesWithReadableRosterPresence, 'recruiting cycle', 'recruiting cycles')}; `
      + 'the minutes at it do not, for the reasons above. Who arrived here is on file even where '
      + 'what they played is not.');
  } else if (minutesRead) {
    out.push(`The minutes at this position read across `
      + `${basisText(util.readableSeasons, util.seasons.length)}; how often the position has been `
      + 'added to does not, for the reasons above.');
  }
  return out.slice(0, 2);
}
