/**
 * How often a programme has added a new player at a position.
 *
 * The one question in this layer that needs no minutes. Everything else the
 * lifecycle model answers — development, continuity, movement — is gated on a
 * published minutes column, and roughly a fifth of Division III programme-
 * seasons cannot clear that gate. This asks only who appeared on a roster and
 * what class the page said they were, which is why it survives at programmes
 * where nothing else does.
 *
 * WHAT IT IS NOT. It is a record of observed intake and nothing else. It does
 * not predict recruiting, does not describe risk, does not say whether adding
 * players is good, and cannot say why anybody was recruited. Two identical
 * intake histories can mean a coach replacing graduating seniors and a coach
 * replacing players who left early, and roster data does not separate them.
 * Nothing here is a rate that could be read as intent.
 *
 * ONE DEFINITION OF AN ARRIVAL, and it is the layer's existing one.
 * `buildLifecycles` already decides who a player is and when they first
 * appeared at a programme; this counts those first appearances. Rewriting the
 * test as "on this roster and not the previous one" would produce a second,
 * subtly different answer: 789 men's players have a gap season, and that test
 * would call each of them a new arrival on their return to a programme they
 * had already played for. It also gets deduplication for free — five men's
 * programme-seasons carry the same player twice, and a lifecycle is keyed by
 * identity, so those are one person.
 *
 * TWO SEPARATE READABILITY QUESTIONS, and this file only cares about the
 * second. `PERFORMANCE_UNREADABLE` says a season's minutes were never read;
 * that is irrelevant here and there is a test asserting the output is
 * unchanged by it. What matters is whether the ROSTER is readable: a cycle
 * needs a roster on both sides, each with enough players to be a roster. A
 * five-name 2026 fragment would otherwise report either an intake of zero or
 * an intake of everybody, and both are inventions.
 */
import { buildLifecycles } from './lifecycle.js';
import { POSITIONS } from '../positions.js';

/**
 * The cycles a completed intake can be counted over.
 *
 * A cycle is named for the season players arrive INTO, and needs the season
 * before it on file to know who is new. 2022 is the first season on file, so
 * it can never be a cycle: everyone on it looks new.
 */
export const HISTORICAL_CYCLES = Object.freeze(['2023', '2024', '2025']);

/**
 * The intake into the season being recruited into, held apart from all of it.
 *
 * 2026 is a genuinely countable cycle — arrivals need names and class labels,
 * not minutes — and it is still not a historical observation. It is a roster
 * published before the season is played, so a late arrival has not
 * necessarily appeared on it yet, and averaging it in would pull every
 * programme's figure toward whatever its page happened to carry in August.
 * It is reported as what is known so far.
 */
export const CURRENT_CYCLE = '2026';

/** Every cycle this model will discuss, current one last. */
export const ALL_CYCLES = Object.freeze([...HISTORICAL_CYCLES, CURRENT_CYCLE]);

/**
 * A roster smaller than this is a fragment, not a squad.
 *
 * The same floor `performanceUnreadableSeasons` uses, for the same reason and
 * against the same evidence: median rosters are 31 (men) and 28 (women), and
 * only seven men's and eight women's programme-seasons in the whole dataset
 * fall below ten. Most of those are partial 2026 pages — Hope and Swarthmore
 * carry five names each — where an intake count would be pure fiction.
 */
export const MIN_ROSTER_FOR_CYCLE = 10;

/**
 * How far a roster may change size between two seasons before its intake stops
 * describing a recruiting cycle.
 *
 * Roster size is remarkably stable — the median season-over-season ratio is
 * exactly 1.00 and the 95th percentile is 1.26 — so a jump past 1.5 is not a
 * large intake, it is a different page. Emory & Henry men's went from 31 named
 * players to 76 in 2025 and that cycle reads as 28 incoming midfielders;
 * Wright State went 32 to 47. It happens to 1.0% of men's and 0.9% of women's
 * cycles.
 *
 * The cycle is FLAGGED and NOT dropped. Its count stays visible, because
 * hiding a number is how a model starts lying, and the median over three
 * cycles already resists a single outlier — 6, 3, 28 has a median of 6. What
 * the flag buys is a report that can decline to draw the spike as behaviour.
 */
export const ROSTER_JUMP = 1.5;
export const ROSTER_COLLAPSE = 1 / ROSTER_JUMP;

/** A programme needs this many readable historical cycles to be summarised. */
export const MIN_CYCLES_TO_QUOTE = 2;
/** …and all of them before the pool carries it as a benchmark observation. */
export const MIN_CYCLES_FOR_POOL = HISTORICAL_CYCLES.length;
/** Incoming players needed before the first-year / experienced mix is a share. */
export const MIN_INCOMING_FOR_MIX = 6;

/**
 * How much of an intake must carry a readable position before the intake may
 * be split by position at all.
 *
 * Some roster pages carry no position column, and the importer records that
 * honestly: 3,111 men's and 2,776 women's rows have the literal string
 * UNKNOWN where a position belongs. At most programmes this is nobody — the
 * median share is zero and the 95th percentile is 23% — but at sixteen it is
 * more than half the intake and at six it is every single arrival. Eastern New
 * Mexico's roster names 33 arrivals and the position of none of them.
 *
 * Without this gate the model would report "a median of 0 defenders added in
 * three cycles" for those programmes, which is not a thin answer, it is a
 * false one. The threshold is the 0.5 the rest of the codebase already applies
 * to "how much of this could we read".
 */
export const MIN_POSITION_SHARE = 0.5;

export const ARRIVAL = Object.freeze({
  /** The class label at first appearance says first year on campus. */
  FIRST_YEAR: 'FIRST_YEAR',
  /** It says otherwise: this player had college seasons before this one. */
  EXPERIENCED: 'EXPERIENCED',
  /** It could not be read, so neither can be claimed. */
  UNKNOWN: 'UNKNOWN',
});

export const NO_POSITION_DATA = 'the rosters name too few of these arrivals\u2019 positions to split the intake by position';

const CYCLE_UNREADABLE = Object.freeze({
  NO_PRIOR_ROSTER: 'no roster on file for the season before',
  NO_ROSTER: 'no roster on file for this season',
  PRIOR_ROSTER_TOO_SMALL: 'the season before carries too few players to be a roster',
  ROSTER_TOO_SMALL: 'this season carries too few players to be a roster',
});

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** How many players each season's roster carries, and whether that is a roster. */
export function rosterPresence(rows, { minRoster = MIN_ROSTER_FOR_CYCLE } = {}) {
  const counts = new Map();
  for (const row of rows) {
    const season = String(row.season);
    counts.set(season, (counts.get(season) ?? 0) + 1);
  }
  const out = new Map();
  for (const [season, players] of counts) {
    out.set(season, { season, players, readable: players >= minRoster });
  }
  return out;
}

/**
 * Whether each cycle can be counted, and if not, which side failed.
 *
 * Stated rather than implied. "We have no 2024 roster for this programme" and
 * "this programme added nobody in 2024" are opposite facts, and a model that
 * returned zero for both would let a report print the second.
 */
export function cycleReadability(rows, { minRoster = MIN_ROSTER_FOR_CYCLE } = {}) {
  const presence = rosterPresence(rows, { minRoster });
  return ALL_CYCLES.map((season) => {
    const prior = presence.get(String(Number(season) - 1));
    const here = presence.get(season);
    const reason = !prior ? CYCLE_UNREADABLE.NO_PRIOR_ROSTER
      : !here ? CYCLE_UNREADABLE.NO_ROSTER
        : !prior.readable ? CYCLE_UNREADABLE.PRIOR_ROSTER_TOO_SMALL
          : !here.readable ? CYCLE_UNREADABLE.ROSTER_TOO_SMALL
            : null;
    const growth = prior?.players && here?.players ? here.players / prior.players : null;
    return {
      season,
      current: season === CURRENT_CYCLE,
      readable: reason == null,
      reason,
      rosterPlayers: here?.players ?? null,
      priorRosterPlayers: prior?.players ?? null,
      // How much the roster itself changed size. A cycle where the page grew
      // by half is measuring the page, not the recruiting.
      rosterGrowth: growth,
      rosterJumped: growth != null && (growth >= ROSTER_JUMP || growth <= ROSTER_COLLAPSE),
    };
  });
}

/**
 * Every new arrival at one programme, with the cycle and position they
 * arrived at.
 *
 * Position is the one the roster gave them IN THEIR FIRST SEASON, not the one
 * they were most often listed at. The question is what a programme added, and
 * a player who arrived as a defender and was later listed in midfield was
 * added as a defender. It differs from the modal position for 762 men's and
 * 1,193 women's players — about 1% of the whole — and `positionChanged`
 * travels on the record so a caller can see when it happened.
 */
export function arrivalsAt(rows) {
  const cycles = new Set(ALL_CYCLES);
  return buildLifecycles(rows)
    .filter((life) => cycles.has(life.firstSeason))
    .map((life) => ({
      playerKey: life.playerKey,
      name: life.name,
      programme: life.programme,
      season: life.firstSeason,
      current: life.firstSeason === CURRENT_CYCLE,
      position: life.seasons[0].canonicalPosition,
      positionChanged: life.positionChanged,
      classLabel: life.seasons[0].classLabel,
      arrival: life.entryType === 'FIRST_YEAR' ? ARRIVAL.FIRST_YEAR
        : life.entryType === 'EXPERIENCED' ? ARRIVAL.EXPERIENCED
          : ARRIVAL.UNKNOWN,
      seasonsObserved: life.seasonsObserved,
    }));
}

const emptyTally = () => ({ firstYears: 0, experiencedArrivals: 0, unclassified: 0, totalIncoming: 0 });

function tally(list) {
  const t = emptyTally();
  for (const a of list) {
    if (a.arrival === ARRIVAL.FIRST_YEAR) t.firstYears += 1;
    else if (a.arrival === ARRIVAL.EXPERIENCED) t.experiencedArrivals += 1;
    else t.unclassified += 1;
  }
  t.totalIncoming = list.length;
  return t;
}

/**
 * The historical summary for one position, with every cycle still visible.
 *
 * `cycles` is the raw record and is never replaced by its own summary. A
 * median of four drawn from 2, 2, 8 and 4 is a different object from one drawn
 * from 4, 4, 4 and 4, and only the cycles show which.
 */
function summarise(cycles, {
  minCyclesToQuote = MIN_CYCLES_TO_QUOTE, minIncomingForMix = MIN_INCOMING_FOR_MIX,
  positionsReadable = true,
} = {}) {
  const readable = cycles.filter((c) => c.readable);
  const totals = readable.map((c) => c.totalIncoming);
  const enough = positionsReadable && readable.length >= minCyclesToQuote;
  const incoming = totals.reduce((sum, n) => sum + n, 0);
  const firstYears = readable.reduce((sum, c) => sum + c.firstYears, 0);
  const experienced = readable.reduce((sum, c) => sum + c.experiencedArrivals, 0);
  const unclassified = readable.reduce((sum, c) => sum + c.unclassified, 0);
  const atLeast = (n) => (enough ? readable.filter((c) => c.totalIncoming >= n).length : null);

  return {
    cyclesObserved: cycles.length,
    cyclesWithReadableRosterPresence: readable.length,
    seasons: readable.map((c) => c.season),
    unreadableSeasons: cycles.filter((c) => !c.readable).map((c) => c.season),
    // Counts first, always. A suppressed rate still leaves the record behind.
    totalIncoming: incoming,
    firstYears,
    experiencedArrivals: experienced,
    unclassified,
    totalIncomingPerCycle: totals,
    firstYearsPerCycle: readable.map((c) => c.firstYears),
    experiencedArrivalsPerCycle: readable.map((c) => c.experiencedArrivals),
    medianTotalIncoming: enough ? median(totals) : null,
    medianFirstYears: enough ? median(readable.map((c) => c.firstYears)) : null,
    medianExperiencedArrivals: enough ? median(readable.map((c) => c.experiencedArrivals)) : null,
    range: totals.length ? { low: Math.min(...totals), high: Math.max(...totals) } : null,
    cyclesWithAtLeastOne: atLeast(1),
    cyclesWithAtLeastTwo: atLeast(2),
    cyclesWithAtLeastThree: atLeast(3),
    cyclesWithAnExperiencedArrival: enough
      ? readable.filter((c) => c.experiencedArrivals >= 1).length : null,
    /**
     * Cycles whose roster changed size enough that the intake describes the
     * page rather than the recruiting. Named, never removed.
     */
    rosterJumpedSeasons: readable.filter((c) => c.rosterJumped).map((c) => c.season),
    /**
     * How the players arrived, where enough of them did.
     *
     * The denominator is the CLASSIFIED arrivals, not every arrival: a player
     * whose class label could not be read belongs in neither half, and
     * dividing by them would understate both.
     */
    mix: (() => {
      const classified = firstYears + experienced;
      if (!enough || classified < minIncomingForMix) {
        return { classified, suppressed: true, firstYearShare: null, experiencedShare: null };
      }
      return {
        classified,
        suppressed: false,
        firstYearShare: firstYears / classified,
        experiencedShare: experienced / classified,
      };
    })(),
    suppressed: !enough,
    // Which of the two reasons, stated rather than left to be inferred from a
    // null: too few cycles is a gap in the rosters, no position data is a gap
    // in what the rosters say.
    suppressedReason: enough ? null
      : !positionsReadable ? NO_POSITION_DATA
        : `only ${readable.length} of ${cycles.length} recruiting cycles have a roster on file for both seasons`,
  };
}

/**
 * One programme's position intake: the cycles, the history, and 2026 apart.
 *
 * `rows` is that programme's roster rows for every season on file. Minutes are
 * never read, so the result is identical whether or not the readability rules
 * have been applied to them.
 */
export function positionPressure(rows, options = {}) {
  const readability = cycleReadability(rows, options);
  const arrivals = arrivalsAt(rows);

  // Whether this programme's rosters say what position anybody plays. Asked
  // over the arrivals rather than over every row, because the arrivals are
  // what the intake is counted from.
  const minPositionShare = options.minPositionShare ?? MIN_POSITION_SHARE;
  const withPosition = arrivals.filter((a) => a.position !== 'UNKNOWN').length;
  const positionData = {
    arrivals: arrivals.length,
    withPosition,
    share: arrivals.length ? withPosition / arrivals.length : null,
    // A programme with no arrivals at all has nothing to split by position, so
    // this gate has no opinion: "we cannot tell you which position" and "there
    // was nobody" are different findings, and only the cycle count can say
    // whether the second is readable.
    readable: arrivals.length === 0 || withPosition / arrivals.length >= minPositionShare,
  };

  const forPosition = (position) => {
    const mine = arrivals.filter((a) => a.position === position);
    const cycles = readability.map((c) => ({
      season: c.season,
      current: c.current,
      readable: c.readable,
      reason: c.reason,
      rosterPlayers: c.rosterPlayers,
      priorRosterPlayers: c.priorRosterPlayers,
      rosterGrowth: c.rosterGrowth,
      rosterJumped: c.rosterJumped,
      ...(c.readable ? tally(mine.filter((a) => a.season === c.season)) : emptyTally()),
      // A cycle we cannot read has no counts, and its zeros must never be
      // mistaken for an observation.
      ...(c.readable ? {} : { firstYears: null, experiencedArrivals: null, unclassified: null, totalIncoming: null }),
      names: c.readable ? mine.filter((a) => a.season === c.season).map((a) => ({
        name: a.name, arrival: a.arrival, classLabel: a.classLabel,
      })) : [],
    }));
    const historical = cycles.filter((c) => !c.current);
    const current = cycles.find((c) => c.current) ?? null;
    return {
      position,
      cycles,
      historical: summarise(historical, { ...options, positionsReadable: positionData.readable }),
      /** What the 2026 roster shows so far, labelled as exactly that. */
      current: current ? {
        season: current.season,
        readable: current.readable,
        reason: current.reason,
        firstYears: current.firstYears,
        experiencedArrivals: current.experiencedArrivals,
        unclassified: current.unclassified,
        totalIncoming: current.totalIncoming,
        names: current.names,
      } : null,
    };
  };

  return {
    programme: rows[0]?.college_name ?? null,
    sport: rows[0]?.sport ?? null,
    cycles: readability,
    positionData,
    historicalCycles: HISTORICAL_CYCLES,
    currentCycle: CURRENT_CYCLE,
    positions: POSITIONS.map(forPosition),
    /**
     * Arrivals whose position the roster did not name in a way this can read.
     *
     * Counted rather than dropped: 3.5% of men's and 2.7% of women's arrivals
     * land here, and a position table that silently excluded them would not
     * add up to the intake.
     */
    unknownPosition: (() => {
      const mine = arrivals.filter((a) => a.position === 'UNKNOWN');
      const cycles = readability.map((c) => ({
        season: c.season,
        current: c.current,
        totalIncoming: c.readable ? mine.filter((a) => a.season === c.season).length : null,
      }));
      return { cycles, totalIncoming: mine.length };
    })(),
    arrivals,
  };
}

export { CYCLE_UNREADABLE, median as pressureMedian };
