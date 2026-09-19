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
import { fillPropensity } from '../../../shared/matching/v2/index.js';

/** The same threshold the norms were derived at. */
const STARTER_MINUTES = 600;

const isStarter = (row) => {
  if (row.minutes_played !== null && row.minutes_played !== undefined) return row.minutes_played >= STARTER_MINUTES;
  if (row.projected_minutes !== null && row.projected_minutes !== undefined) return row.projected_minutes >= STARTER_MINUTES;
  // A row with neither figure is a newcomer. Counted as squad, never as a
  // starter on no evidence - the same conservative reading V1 settled on.
  return false;
};

/**
 * Index a roster by programme, then by position.
 *
 * @param {Array} rows  roster_players rows for one sport and the current season
 */
export function buildPositionIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const position = readPosition(row.position);
    const programme = row.college_name;
    if (!programme) continue;
    if (!index.has(programme)) index.set(programme, { positions: new Map(), rows: 0, unreadable: 0 });
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
      entry.unreadable += 1;
      continue;
    }
    if (!entry.positions.has(position)) {
      entry.positions.set(position, { rows: 0, unreadable: 0, byLastSeason: new Map(), starterLastSeason: new Map() });
    }
    const bucket = entry.positions.get(position);
    bucket.rows += 1;
    if (ceiling.lastSeason === null) {
      bucket.unreadable += 1;
      entry.unreadable += 1;
      continue;
    }
    bucket.byLastSeason.set(ceiling.lastSeason, (bucket.byLastSeason.get(ceiling.lastSeason) || 0) + 1);
    if (isStarter(row)) {
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
    arrivals: null,
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
