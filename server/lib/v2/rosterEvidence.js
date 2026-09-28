/**
 * Turn roster and arrivals rows into the plain evidence the recruitability
 * layers take.
 *
 * WHY IT LIVES HERE. The layers under shared/matching/v2/layers are pure: they
 * take counts and return results, so they can be tested against fixtures
 * without a database and cannot accidentally acquire a query. Everything that
 * knows about tables, seasons and column names is in this file.
 *
 * It reads `shared/eligibility.js` and `shared/classYear.js` directly, which
 * the import guard permits and A6.2 rules as REUSE: those are the rules, not
 * the V1 model, and V2 must answer the eligibility question the same way V1
 * does or the two are not comparable.
 */
import { readClassYear } from '../../../shared/classYear.js';
import { eligibilityCeiling, eligibilityRuleFor, ELIGIBILITY_MODEL } from '../../../shared/eligibility.js';
import { canonicalPosition } from '../../../shared/positions.js';

/**
 * `canonicalPosition` returns the string 'UNKNOWN' rather than a falsy value
 * for a row it cannot read, so an unguarded truthiness test silently builds an
 * 'UNKNOWN' position bucket and never records the row as doubt. Read through
 * this instead.
 */
const readPosition = (raw) => {
  const p = canonicalPosition(raw);
  return p && p !== 'UNKNOWN' ? p : null;
};

/**
 * A7.44. THREE STATES, AND THE MIDDLE ONE IS THE WHOLE PHASE.
 *
 *   READABLE    the row can be placed at one of the four supported positions.
 *   UNREADABLE  a position WAS recorded and cannot be canonicalised. Today
 *               every one of the 1,695 carries the single literal value
 *               'UNKNOWN' - a recorded absence written upstream, which is what
 *               A7.41 established and `positionReadability.test.js` pins.
 *   MISSING     no position was recorded at all.
 *
 * MISSING IS ZERO TODAY AND IS COUNTED ANYWAY. "Nobody wrote it down" and "we
 * cannot read what they wrote" are different failures with different repairs -
 * one is an acquisition gap, the other a vocabulary gap - and collapsing them
 * now would hide whichever appears first behind the other's explanation.
 */
export const POSITION_READABILITY = Object.freeze({
  READABLE: 'READABLE', UNREADABLE: 'UNREADABLE', MISSING: 'MISSING',
});

export function readPositionState(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { state: POSITION_READABILITY.MISSING, position: null };
  }
  const position = readPosition(raw);
  return position
    ? { state: POSITION_READABILITY.READABLE, position }
    : { state: POSITION_READABILITY.UNREADABLE, position: null };
}
import { fillPropensity } from '../../../shared/matching/v2/index.js';

/** The same threshold the norms were derived at. */
export const STARTER_MINUTES = 600;

/**
 * Starting appearances that stand in for the minutes threshold.
 *
 * CALIBRATED, not chosen. Across the 55,293 season rows that carry BOTH a
 * minutes figure and a starts figure, `games_started >= 7` reproduces the
 * 600-minute rule with precision 0.964, recall 0.902 and 94.3% agreement -
 * the joint maximum of F1 across every integer threshold tested (6 scores
 * 0.931, 7 scores 0.932, 8 scores 0.920). 7 is taken rather than 6 because
 * the errors are not symmetric: inventing a starter manufactures a departure
 * that never happens, while missing one leaves a real opening unseen, and the
 * layer's whole contract is that it would rather say nothing than say
 * something untrue.
 */
export const STARTER_GAMES_STARTED = 7;

/**
 * THREE STATES, NOT TWO.
 *
 * The old reading returned false for a row with no figures at all, which put
 * "we know this player did not start" and "we know nothing about this player"
 * in the same bucket. Downstream that became `vacatedStarters = 0`, graded
 * MEASURED, and a programme we hold no minutes for was reported as having no
 * starting place open - an absence presented as a measurement, in a model
 * whose founding rule forbids exactly that.
 *
 * Appearances are read AFTER real minutes and BEFORE projected minutes: a
 * start actually recorded this season is better evidence than a minutes total
 * carried forward from the last one.
 */
export const STARTER_STATE = Object.freeze({ STARTER: 'STARTER', SQUAD: 'SQUAD', UNKNOWN: 'UNKNOWN' });

const stated = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

export function starterState(row) {
  if (stated(row.minutes_played)) {
    return Number(row.minutes_played) >= STARTER_MINUTES ? STARTER_STATE.STARTER : STARTER_STATE.SQUAD;
  }
  if (stated(row.games_started)) {
    return Number(row.games_started) >= STARTER_GAMES_STARTED ? STARTER_STATE.STARTER : STARTER_STATE.SQUAD;
  }
  if (stated(row.projected_minutes)) {
    return Number(row.projected_minutes) >= STARTER_MINUTES ? STARTER_STATE.STARTER : STARTER_STATE.SQUAD;
  }
  if (stated(row.projected_games_started)) {
    return Number(row.projected_games_started) >= STARTER_GAMES_STARTED ? STARTER_STATE.STARTER : STARTER_STATE.SQUAD;
  }
  // No figure of any kind. NOT a squad player - we do not know.
  return STARTER_STATE.UNKNOWN;
}

const isStarter = (row) => starterState(row) === STARTER_STATE.STARTER;

/**
 * Index a roster by programme, then by position.
 *
 * @param {Array} rows  roster_players rows for one sport and the current season
 */
/**
 * A roster query that forgot the appearance columns.
 *
 * An absent COLUMN and a null VALUE are different facts and a plain read
 * cannot tell them apart: both look like `undefined`. Without this guard a
 * query that simply does not SELECT `games_started` silently reclassifies
 * every player as UNKNOWN, which under rule R-b turns whole programmes
 * UNSCOREABLE for a reason that is nothing to do with the data. That happened
 * within minutes of the columns being added - the first diagnostic to run
 * against the repaired database reported MIT as unrankable because its own
 * SELECT was stale.
 *
 * V1 has the same guard for its own inputs, in pool.js, for the same reason.
 */
export function assertStarterInputsSelected(rows) {
  if (!rows?.length) return;
  const sample = rows[0];
  const has = (k) => Object.prototype.hasOwnProperty.call(sample, k);
  if (!has('minutes_played') && !has('projected_minutes')) return; // not a roster query
  const missing = ['games_started', 'projected_games_started'].filter((k) => !has(k));
  if (missing.length) {
    throw new Error(
      `buildPositionIndex: the roster query does not select ${missing.join(' and ')}. `
      + 'Starter evidence reads appearances as well as minutes, and a column left out of the '
      + 'SELECT is indistinguishable from a player nobody recorded - which would make this '
      + 'programme UNSCOREABLE for a reason that has nothing to do with the data.',
    );
  }
}

export function buildPositionIndex(rows) {
  assertStarterInputsSelected(rows);
  const index = new Map();
  for (const row of rows) {
    const { state: positionState, position } = readPositionState(row.position);
    const programme = row.college_name;
    if (!programme) continue;
    if (!index.has(programme)) {
      index.set(programme, {
        positions: new Map(),
        rows: 0,
        /**
         * EVERY row we could not fully read, for any reason. Kept with its
         * existing meaning because the diagnostics that read it mean exactly
         * that, and it is the UNION of the two counters below rather than a
         * third fact - so it must never be added to either.
         */
        unreadable: 0,
        /**
         * A7.44. The two programme-level position failures, apart. A row
         * counted here entered NO position bucket, so it is missing from
         * every bucket at this programme - which is precisely why it is held
         * at the programme and not at a position.
         */
        positionUnreadable: 0,
        positionMissing: 0,
        /**
         * Rows we DID place at a position and whose eligibility horizon we
         * could not read. The doubt A7.37 already propagated, named here so
         * the two can be told apart at a glance instead of by subtraction.
         */
        classUnreadable: 0,
      });
    }
    const entry = index.get(programme);
    entry.rows += 1;

    const read = readClassYear(row.class_year_label, { season: row.season });
    const ceiling = eligibilityCeiling({
      klass: read.klass, redshirt: read.redshirt, season: row.season, division: row.division,
    });

    if (!position) {
      // No readable position means no positional evidence. The row still
      // counts toward the programme's doubt about its own roster, whether or
      // not its class was readable - an unplaceable player is a gap in what we
      // know about every position.
      //
      // A7.44. Recorded at the programme under WHICH failure it was, and
      // propagated from here. Until A7.44 this line was the end of the row's
      // life: the count was kept and never read by anything that scores.
      if (positionState === POSITION_READABILITY.MISSING) entry.positionMissing += 1;
      else entry.positionUnreadable += 1;
      entry.unreadable += 1;
      continue;
    }
    if (!entry.positions.has(position)) {
      entry.positions.set(position, {
        rows: 0, unreadable: 0, byLastSeason: new Map(), starterLastSeason: new Map(),
        // How much of the position is classifiable at all, and how much of the
        // DEPARTING cohort specifically - which is the only group
        // `vacatedStarters` counts, so it is the only coverage that decides
        // whether a zero there means anything.
        classified: 0, unknownState: 0,
        byLastSeasonUnknown: new Map(),
      });
    }
    const bucket = entry.positions.get(position);
    bucket.rows += 1;
    if (ceiling.lastSeason === null) {
      bucket.unreadable += 1;
      entry.classUnreadable += 1;
      entry.unreadable += 1;
      continue;
    }
    bucket.byLastSeason.set(ceiling.lastSeason, (bucket.byLastSeason.get(ceiling.lastSeason) || 0) + 1);
    const state = starterState(row);
    if (state === STARTER_STATE.UNKNOWN) {
      bucket.unknownState += 1;
      bucket.byLastSeasonUnknown.set(ceiling.lastSeason, (bucket.byLastSeasonUnknown.get(ceiling.lastSeason) || 0) + 1);
    } else {
      bucket.classified += 1;
    }
    if (state === STARTER_STATE.STARTER) {
      bucket.starterLastSeason.set(ceiling.lastSeason, (bucket.starterLastSeason.get(ceiling.lastSeason) || 0) + 1);
    }
  }
  return index;
}

/** Index arrivals by programme, position and the season they arrived. */
export function buildArrivalIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const programme = row.programme;
    if (!programme) continue;
    if (!index.has(programme)) index.set(programme, { total: 0, international: 0, byPositionSeason: new Map() });
    const entry = index.get(programme);
    entry.total += 1;
    if (row.is_international === 1) entry.international += 1;
    const position = readPosition(row.canonical_position);
    if (!position) continue;
    const key = `${Number(row.arrival_season)}|${position}`;
    entry.byPositionSeason.set(key, (entry.byPositionSeason.get(key) || 0) + 1);
  }
  return index;
}

/**
 * Who is projected to STILL BE HERE at the entry year, split by the role we
 * can place them in.
 *
 * The departing side of these same maps has been read since A7.3; this reads
 * the other half. `starterLastSeason` and `byLastSeasonUnknown` are already
 * built by `buildPositionIndex`, so nothing new is ingested or indexed - the
 * returning cohort was simply never asked for.
 *
 * A player whose last eligible season IS the entry year is counted as neither.
 * They are there FOR that season and gone after it, so they are not a place
 * that has opened and not competition beyond it - the same rule the departing
 * side uses, from the other direction.
 */
export function returningDepthFor(bucket, entryYear) {
  if (!bucket) return null;
  const after = (m) => {
    let n = 0;
    for (const [last, count] of m) if (last > entryYear) n += count;
    return n;
  };
  const total = after(bucket.byLastSeason);
  const starters = after(bucket.starterLastSeason);
  const unknown = after(bucket.byLastSeasonUnknown);
  return {
    total,
    starters,
    unknown,
    squad: Math.max(0, total - starters - unknown),
    roleKnown: total - unknown,
  };
}

/**
 * The evidence `positionalOpportunity` needs, for one programme and position.
 *
 * `vacatedStarters` counts players whose ELIGIBILITY ends before the entry
 * year and who were holding a starting place. Not seniors: a Division I senior
 * listed in 2026 has a year of the five-year window left and is not an opening
 * for 2027, where a Division III senior is.
 */
export function positionEvidence({
  programme, position, sport, division, entryYear, rosterIndex, arrivalIndex,
  arrivalsHorizon = null,
}) {
  const ruled = eligibilityRuleFor({ division, season: entryYear })?.model !== ELIGIBILITY_MODEL.UNKNOWN;
  const programmeRoster = rosterIndex.get(programme);
  const bucket = programmeRoster?.positions?.get(position);

  const evidence = {
    rosterOnFile: Boolean(programmeRoster && programmeRoster.rows > 0),
    eligibilityRuled: ruled,
    positionRows: bucket?.rows ?? 0,
    vacatedStarters: 0,
    openings: 0,
    eligibleToRemain: 0,
    unreadable: bucket?.unreadable ?? 0,
    /**
     * A7.44. PROGRAMME-LEVEL positional readability, which is a different fact
     * from `unreadable` directly above and must never be added to it.
     * `unreadable` counts players placed AT this position whose year could not
     * be read; these are players placed at no position at all, so they are
     * absent from this bucket and from every other bucket here.
     *
     * `programmeRows` is carried so a reader can see the denominator rather
     * than having to reconstruct it.
     */
    programmeRows: programmeRoster?.rows ?? 0,
    programmePositionUnreadable: programmeRoster?.positionUnreadable ?? 0,
    programmePositionMissing: programmeRoster?.positionMissing ?? 0,
    /**
     * How much of the position, and of the departing cohort, could be placed
     * as starter or squad at all. `positionalOpportunity` reads this to decide
     * whether a zero is a measurement or a silence.
     */
    starterEvidence: {
      positionRows: bucket?.rows ?? 0,
      classified: bucket?.classified ?? 0,
      unknown: bucket?.unknownState ?? 0,
      departing: 0,
      departingUnknown: 0,
    },
    arrivals: null,
    /** The returning side, for Athlete Opportunity. Null until the bucket is read. */
    returning: null,
    fill: fillPropensity({ sport, division, position, programme }),
  };

  if (bucket) {
    for (const [lastSeason, count] of bucket.byLastSeason) {
      if (lastSeason < entryYear) evidence.openings += count;
      else if (lastSeason > entryYear) evidence.eligibleToRemain += count;
      // lastSeason === entryYear is a final season: the player is there FOR the
      // entry year, so their place has not opened and they are not returning
      // competition beyond it. Counted as neither, deliberately.
    }
    for (const [lastSeason, count] of bucket.starterLastSeason) {
      if (lastSeason < entryYear) evidence.vacatedStarters += count;
    }
    for (const [lastSeason, count] of bucket.byLastSeasonUnknown) {
      if (lastSeason < entryYear) evidence.starterEvidence.departingUnknown += count;
    }
    evidence.starterEvidence.departing = evidence.openings;
    evidence.returning = returningDepthFor(bucket, entryYear);
  }

  /**
   * Three different states, and only one of them is a zero.
   *
   * BEYOND THE HORIZON. The entry year is later than any season we hold
   * arrivals for, so nobody has recruited that class yet - not this programme,
   * not anyone. There is nothing to have observed, which is NOT_APPLICABLE
   * rather than missing, and it must not read as "this programme has recruited
   * nobody". Today every fixture is here: arrivals run to 2026 and the classes
   * being recruited for are 2027 and 2028.
   *
   * WITHIN THE HORIZON, PROGRAMME ON FILE. A real count, zero included.
   *
   * WITHIN THE HORIZON, PROGRAMME ABSENT. We hold no arrivals for them at all,
   * so the count is unknown and the layer is graded PARTIAL.
   */
  const beyondHorizon = arrivalsHorizon !== null && Number(entryYear) > Number(arrivalsHorizon);
  evidence.arrivalsApplicable = !beyondHorizon;
  evidence.arrivalsHorizon = arrivalsHorizon;
  if (beyondHorizon) {
    evidence.arrivals = 0;
    evidence.arrivalsMeasured = false;
  } else {
    const arrivals = arrivalIndex?.get(programme);
    evidence.arrivals = arrivals ? (arrivals.byPositionSeason.get(`${entryYear}|${position}`) ?? 0) : null;
    evidence.arrivalsMeasured = Boolean(arrivals);
  }
  return evidence;
}

/** The international-arrival counts `internationalPropensity` needs. */
export function arrivalBehaviour({ programme, division, sport, arrivalIndex, divisionArrivals }) {
  const entry = arrivalIndex?.get(programme);
  return {
    programmeArrivals: entry ? { total: entry.total, international: entry.international } : null,
    divisionArrivals: divisionArrivals?.get(`${sport}|${division}`) ?? null,
  };
}

/** Pooled international-arrival rates per division, for the fallback. */
export function divisionArrivalRates(rows, collegesByName) {
  const out = new Map();
  for (const row of rows) {
    const division = collegesByName.get(row.programme)?.division;
    if (!division) continue;
    const key = `${row.sport}|${division}`;
    const v = out.get(key) || { total: 0, international: 0 };
    v.total += 1;
    if (row.is_international === 1) v.international += 1;
    out.set(key, v);
  }
  return out;
}
