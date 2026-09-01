/**
 * What a programme's arrivals add up to — counted, never characterised.
 *
 * Phase 2 answered "who arrived, and how sure are we". This answers "how many,
 * of what, when, and under whom". It does NOT answer what any of that means. No
 * function here returns "recruits internationally", "prefers transfers" or
 * "needs defenders"; it returns "4 defenders across 3 observed transitions" and
 * leaves the reading of that to a layer that has been asked to do the reading.
 *
 * That restraint is the design, not modesty. "Targets Oceania" is a claim about
 * intent, and intent is exactly the thing two roster snapshots cannot see. The
 * observation survives being wrong about intent; the sentence does not.
 *
 * Pure, like shared/matching and shared/evidence. It takes arrivals a caller
 * fetched, so the report script, a future route and the tests run identical
 * code, and it reads NOTHING from the evidence layer — the frozen outreach
 * baseline neither imports this file nor is imported by it.
 *
 * ---------------------------------------------------------------------------
 * THE COVERAGE FLOOR, which is what makes any of this usable.
 *
 * A pattern needs at least THREE comparable transitions behind it. Below that,
 * observations are still computed and returned — they are just marked
 * INSUFFICIENT, because the difference between the two states is not the size
 * of the number, it is whether a ZERO means anything:
 *
 *   0 New Zealand defenders across 4 observed transitions
 *     -> real data. Four chances, taken none.
 *   0 New Zealand defenders across 1 observed transition
 *     -> nothing at all. One intake is not a habit.
 *
 * So absence is only reportable inside SUFFICIENT coverage. Nothing here
 * discards a low-coverage programme; it refuses to let one be described.
 *
 * ---------------------------------------------------------------------------
 * TWO SCOPES, KEPT APART.
 *
 * PROGRAMME history is every DIRECT arrival. COACH history is only arrivals
 * with `coachAttribution === ATTRIBUTED` for the coach currently in post —
 * INHERITED and UNKNOWN are excluded outright, because a coach's first roster
 * is their predecessor's recruiting and attributing it to them is the single
 * most likely way to make a confident, false claim about how a programme
 * recruits.
 *
 * The floor applies to each scope SEPARATELY. Butler has four programme
 * transitions and a coach appointed for 2026: four transitions of programme
 * history, zero attributable coach transitions. The programme can be described;
 * the coach cannot.
 */

import { POSITIONS } from '../positions.js';
import { ARRIVAL_TRANSITIONS, COACH_ATTRIBUTION, ENTRY_TYPE } from './arrivals.js';
import { canonicalCountry, regionOf } from './regions.js';

/** Comparable transitions required before a scope may be described. */
export const COVERAGE_FLOOR = 3;

/**
 * How much of a field must be populated before its ABSENCE means anything.
 *
 * The transition floor asks "did we look enough times". This asks "was the
 * column filled in when we looked", and it catches a failure the transition
 * floor cannot see. Five men's programmes have four comparable transitions and
 * no position on a single arrival; eleven have positions on fewer than half.
 * Their recruiting history reads "0 defenders in 4 intakes", which is a
 * scraping artefact wearing the exact shape of a finding.
 *
 * Positive counts are never gated by this — a defender who arrived did arrive.
 * Only a ZERO is, because a zero is the reading that depends on the field
 * having been populated for everybody else.
 */
export const FIELD_COVERAGE_FLOOR = 0.8;

export const COVERAGE = Object.freeze({
  /** Enough observed transitions that an absence is also an observation. */
  SUFFICIENT: 'SUFFICIENT',
  /** Counts are real; the pattern is not. Never describe a zero from here. */
  INSUFFICIENT: 'INSUFFICIENT',
});

export const SCOPE = Object.freeze({
  PROGRAMME: 'PROGRAMME',
  COACH: 'COACH',
});

/** Every canonical position an intake can be filed under. */
export const POSITION_KEYS = Object.freeze([...POSITIONS, 'UNKNOWN']);

/**
 * How narrow a claim an observation could support, if a later phase decided to
 * make one.
 *
 * METADATA ONLY. Nothing here ranks, orders, or gates on specificity — it is
 * recorded so Phase 4 can reason about "New Zealand defenders" being a stronger
 * thing to have observed than "internationals", without Phase 3 pre-deciding
 * that for it. Evidence priority is frozen and untouched.
 */
export const SPECIFICITY = Object.freeze({
  GENERAL: 'GENERAL',
  POSITION: 'POSITION',
  REGION: 'REGION',
  COUNTRY: 'COUNTRY',
  REGION_POSITION: 'REGION_POSITION',
  COUNTRY_POSITION: 'COUNTRY_POSITION',
  COACH_POSITION: 'COACH_POSITION',
  COACH_REGION: 'COACH_REGION',
  COACH_COUNTRY: 'COACH_COUNTRY',
  COACH_REGION_POSITION: 'COACH_REGION_POSITION',
  COACH_COUNTRY_POSITION: 'COACH_COUNTRY_POSITION',
});

/** The axes an observation was cut on, to the name for that cut. */
export function specificityOf({ country = null, region = null, position = null, coach = false } = {}) {
  const parts = [];
  if (country) parts.push('COUNTRY');
  else if (region) parts.push('REGION');
  if (position) parts.push('POSITION');
  const base = parts.length ? parts.join('_') : 'GENERAL';
  const key = coach ? (base === 'GENERAL' ? 'COACH_POSITION' : `COACH_${base}`) : base;
  return SPECIFICITY[key] ?? (coach ? SPECIFICITY.COACH_POSITION : SPECIFICITY.GENERAL);
}

/**
 * The international-data status of a sport, which is a POLICY decision and not
 * a measurement.
 *
 * Country is populated on 100% of rows flagged International in both sports,
 * and reading that as "both sports are equally safe" is the trap. 29.1% of
 * men's arrivals are flagged international against 9.7% of women's. Either
 * women's college soccer recruits a third as many internationals, or the
 * women's rosters we scraped record nationality a third as often — and the
 * roster data cannot tell those apart. One of those worlds licenses a claim
 * about a programme's international recruiting; the other makes the same
 * sentence a scraping artefact read out loud to a coach.
 *
 * So every country and region observation carries this. Coverage being
 * SUFFICIENT says the programme has enough transitions; this says whether the
 * underlying flag can bear a claim at all. Both must pass.
 */
export const DATA_STATUS = Object.freeze({
  /** Coverage of the underlying field is validated for this sport. */
  LICENSED: 'LICENSED',
  /** Computed and returned, but must not become FACT evidence. */
  UNVALIDATED: 'UNVALIDATED',
});

export function countryDataStatus(sport) {
  if (sport === 'mens-soccer') {
    return Object.freeze({
      status: DATA_STATUS.LICENSED,
      reason: 'nationality flagged on 29.1% of arrivals, consistent with the '
        + 'known international share of men\'s college soccer',
      validationNeeded: [],
    });
  }
  return Object.freeze({
    status: DATA_STATUS.UNVALIDATED,
    reason: 'only 9.7% of arrivals are flagged international, against 29.1% for '
      + 'men\'s. Under-recording and a genuinely smaller international share '
      + 'are indistinguishable in roster data.',
    validationNeeded: [
      'hand-check a sample of women\'s rosters against their published bios for '
        + 'internationals carrying no nationality flag',
      'compare the international share per source/parser, since a systematic '
        + 'gap would cluster by scrape route rather than by programme',
      'compare against a published women\'s international participation figure',
    ],
  });
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The coverage descriptor every pattern carries.
 *
 * `observedTransitions` is what we saw; `possibleTransitions` is what the
 * window could have offered. Reporting one without the other is how "2
 * defenders" becomes indistinguishable from "2 defenders out of a possible
 * eight intakes we never looked at".
 */
export function coverageOf({
  scope = SCOPE.PROGRAMME,
  transitions = [],
  arrivals = 0,
  possibleTransitions = ARRIVAL_TRANSITIONS.length,
  floor = COVERAGE_FLOOR,
} = {}) {
  const observed = [...transitions];
  return Object.freeze({
    scope,
    observedTransitions: observed.length,
    possibleTransitions,
    transitions: Object.freeze(observed),
    seasons: Object.freeze(observed.map((t) => String(t).split('->')[1]).filter(Boolean)),
    arrivals,
    floor,
    status: observed.length >= floor ? COVERAGE.SUFFICIENT : COVERAGE.INSUFFICIENT,
  });
}

/** Coverage good enough to read an absence as an observation. */
export const isSufficient = (coverage) => coverage?.status === COVERAGE.SUFFICIENT;

/* -------------------------------------------------------------------------- */
/* Observations                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether a zero on this axis may be read as an observation.
 *
 * Returns the reasons rather than just a boolean, because "we have not looked
 * enough times", "this sport's nationality data is not validated" and "this
 * programme records no nationalities at all" are three different problems and a
 * caller deciding what to do about them needs to know which one it has.
 */
export function absenceGate(reasons = []) {
  const blocking = reasons.filter(Boolean);
  return Object.freeze({ reportable: blocking.length === 0, reasons: Object.freeze(blocking) });
}

/** The gate for every country- and region-shaped cut. */
function countryAbsence(coverage, dataStatus, internationalCount) {
  return absenceGate([
    !isSufficient(coverage)
      && `${coverage.observedTransitions} comparable transition(s), floor is ${coverage.floor}`,
    dataStatus?.status === DATA_STATUS.UNVALIDATED
      && 'nationality coverage for this sport is UNVALIDATED',
    internationalCount === 0
      && 'this scope records no international arrivals at all, so "nobody from X" '
        + 'cannot be told from "no nationalities recorded"',
  ]);
}

/** The gate for a cut that depends on a field being filled in per arrival. */
function fieldAbsence(coverage, known, total, field) {
  const share = total ? known / total : 0;
  return absenceGate([
    !isSufficient(coverage)
      && `${coverage.observedTransitions} comparable transition(s), floor is ${coverage.floor}`,
    total > 0 && share < FIELD_COVERAGE_FLOOR
      && `${field} is recorded on ${(100 * share).toFixed(0)}% of arrivals, `
        + `below the ${(100 * FIELD_COVERAGE_FLOOR).toFixed(0)}% floor`,
  ]);
}

const tallyBy = (rows, fn) => rows.reduce((m, r) => {
  const k = fn(r);
  if (k == null) return m;
  m[k] = (m[k] || 0) + 1;
  return m;
}, {});

const uniqSorted = (values) => [...new Set(values.filter(Boolean))].sort();

/** The canonical country of an arrival, normalised at this layer only. */
export const countryOf = (a) => canonicalCountry(a?.country);

/**
 * The region of an arrival, recomputed rather than read from the stored column.
 *
 * The column was written under the two-country map this phase replaced. Storage
 * is a cache of a pure function and the function is the truth; deriving here
 * means a taxonomy change takes effect the moment it is made, not the next time
 * somebody remembers to rebuild.
 */
export const regionOfArrival = (a) => regionOf(a?.country);

/** The one row shape every aggregation in this file returns. */
function observe(rows, { key = null, coverage, specificity, dataStatus = null }) {
  const seasons = uniqSorted(rows.map((r) => String(r.arrivalSeason)));
  const transitions = uniqSorted(rows.map((r) => r.sourceTransition));

  // Zero-filled across the OBSERVED transitions, not the possible ones: the
  // denominator of "arrived in 3 of 4 transitions" must be transitions we
  // actually looked at, or a missing roster reads as a decision not to recruit.
  const byTransition = {};
  for (const t of coverage.transitions) byTransition[t] = 0;
  for (const r of rows) {
    if (r.sourceTransition in byTransition) byTransition[r.sourceTransition] += 1;
  }

  const entryTypes = { FRESHMAN: 0, EXPERIENCED: 0, UNKNOWN: 0, ...tallyBy(rows, (r) => r.entryType) };

  return {
    key,
    specificity,
    scope: coverage.scope,
    total: rows.length,
    seasons,
    transitions,
    transitionsWithArrival: transitions.filter((t) => coverage.transitions.includes(t)).length,
    byTransition,
    positions: tallyBy(rows, (r) => r.canonicalPosition ?? 'UNKNOWN'),
    countries: tallyBy(rows, countryOf),
    regions: tallyBy(rows, regionOfArrival),
    entryTypes,
    coachAttributed: rows.filter((r) => r.coachAttribution === COACH_ATTRIBUTION.ATTRIBUTED).length,
    mostRecentSeason: seasons.length ? seasons[seasons.length - 1] : null,
    named: rows.map((r) => ({
      playerName: r.playerName,
      // Whether this name may be spoken out loud. A RECONCILED row is one the
      // build merged from two spellings, and the surviving spelling is our
      // choice rather than the programme's — fine behind a count, wrong in an
      // email addressed to the person who signed them.
      identityMethod: r.identityMethod ?? null,
      reconciledFrom: r.reconciledFrom ?? [],
      arrivalSeason: r.arrivalSeason,
      sourceTransition: r.sourceTransition,
      canonicalPosition: r.canonicalPosition,
      country: countryOf(r),
      region: regionOfArrival(r),
      entryType: r.entryType,
      isInternational: Boolean(r.isInternational),
      coach: r.coach ?? null,
      coachAttribution: r.coachAttribution,
      priorProgramme: r.priorProgramme ?? null,
      priorConfidence: r.priorConfidence,
    })).sort((a, b) => a.arrivalSeason.localeCompare(b.arrivalSeason)
      || a.playerName.localeCompare(b.playerName)),
    coverage,
    dataStatus,
  };
}

/**
 * An observation for a cut that produced nothing.
 *
 * The reason a zero has to be a real object rather than a missing key: under
 * SUFFICIENT coverage "no New Zealand defender has arrived in four intakes" is
 * a finding, and a caller that reads absence as `undefined` cannot tell it from
 * a programme nobody has looked at.
 */
const emptyObservation = (opts) => observe([], opts);

/* -------------------------------------------------------------------------- */
/* Programme aggregations                                                      */
/* -------------------------------------------------------------------------- */

const asCoverage = (ctx) => (ctx?.coverage ?? coverageOf({
  scope: ctx?.scope ?? SCOPE.PROGRAMME,
  transitions: ctx?.transitions ?? [],
  arrivals: ctx?.arrivals ?? 0,
}));

/**
 * Arrivals by country of origin.
 *
 * Only international arrivals appear: a domestic row has no country, and
 * inventing "United States" for it would put every American freshman into a
 * country pattern and make the largest country in the data an artefact.
 */
export function countryHistory(arrivals = [], ctx = {}) {
  const coverage = asCoverage(ctx);
  const dataStatus = ctx.dataStatus ?? null;
  const coach = coverage.scope === SCOPE.COACH;

  const byCountry = new Map();
  for (const a of arrivals) {
    const country = countryOf(a);
    if (!country) continue;
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push(a);
  }

  const countries = {};
  for (const [country, rows] of [...byCountry.entries()].sort()) {
    countries[country] = observe(rows, {
      key: country,
      coverage,
      dataStatus,
      specificity: specificityOf({ country, coach }),
    });
  }
  const international = arrivals.filter((a) => a.isInternational);
  return {
    coverage,
    dataStatus,
    absence: countryAbsence(coverage, dataStatus, international.length),
    countries,
    distinctCountries: Object.keys(countries).length,
    international: observe(international, {
      key: 'INTERNATIONAL',
      coverage,
      dataStatus,
      specificity: specificityOf({ coach }),
    }),
    internationalShare: arrivals.length ? international.length / arrivals.length : null,
  };
}

/**
 * Country crossed with canonical position — New Zealand x Defender.
 *
 * Likely the highest-value cut in here, and the one where the coverage floor
 * matters most: it is narrow enough that most programmes will show a zero, and
 * a zero is only worth anything when we looked at enough intakes to have seen
 * a one.
 */
export function countryPositionHistory(arrivals = [], ctx = {}) {
  const coverage = asCoverage(ctx);
  const dataStatus = ctx.dataStatus ?? null;
  const coach = coverage.scope === SCOPE.COACH;

  const byPair = new Map();
  for (const a of arrivals) {
    const country = countryOf(a);
    if (!country) continue;
    const position = a.canonicalPosition ?? 'UNKNOWN';
    const key = `${country}||${position}`;
    if (!byPair.has(key)) byPair.set(key, { country, position, rows: [] });
    byPair.get(key).rows.push(a);
  }

  const pairs = {};
  for (const [key, { country, position, rows }] of [...byPair.entries()].sort()) {
    pairs[key] = observe(rows, {
      key,
      coverage,
      dataStatus,
      specificity: specificityOf({ country, position, coach }),
    });
  }
  return {
    coverage,
    dataStatus,
    absence: countryAbsence(coverage, dataStatus, arrivals.filter((a) => a.isInternational).length),
    pairs,
  };
}

/** The same aggregation by canonical international region. */
export function regionHistory(arrivals = [], ctx = {}) {
  const coverage = asCoverage(ctx);
  const dataStatus = ctx.dataStatus ?? null;
  const coach = coverage.scope === SCOPE.COACH;

  const byRegion = new Map();
  for (const a of arrivals) {
    const region = regionOfArrival(a);
    if (!region) continue;
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push(a);
  }

  const regions = {};
  for (const [region, rows] of [...byRegion.entries()].sort()) {
    regions[region] = observe(rows, {
      key: region,
      coverage,
      dataStatus,
      specificity: specificityOf({ region, coach }),
    });
  }
  // An international arrival from a country the taxonomy has not placed is
  // reported, not hidden: it is the signal that the map has gone stale.
  const unplaced = arrivals.filter((a) => a.isInternational && countryOf(a) && !regionOfArrival(a));
  return {
    coverage,
    dataStatus,
    absence: countryAbsence(coverage, dataStatus, arrivals.filter((a) => a.isInternational).length),
    regions,
    distinctRegions: Object.keys(regions).length,
    unplacedInternational: unplaced.length,
    unplacedCountries: uniqSorted(unplaced.map(countryOf)),
  };
}

/** Region crossed with canonical position — Oceania x Defender. */
export function regionPositionHistory(arrivals = [], ctx = {}) {
  const coverage = asCoverage(ctx);
  const dataStatus = ctx.dataStatus ?? null;
  const coach = coverage.scope === SCOPE.COACH;

  const byPair = new Map();
  for (const a of arrivals) {
    const region = regionOfArrival(a);
    if (!region) continue;
    const position = a.canonicalPosition ?? 'UNKNOWN';
    const key = `${region}||${position}`;
    if (!byPair.has(key)) byPair.set(key, { region, position, rows: [] });
    byPair.get(key).rows.push(a);
  }

  const pairs = {};
  for (const [key, { region, position, rows }] of [...byPair.entries()].sort()) {
    pairs[key] = observe(rows, {
      key,
      coverage,
      dataStatus,
      specificity: specificityOf({ region, position, coach }),
    });
  }
  return {
    coverage,
    dataStatus,
    absence: countryAbsence(coverage, dataStatus, arrivals.filter((a) => a.isInternational).length),
    pairs,
  };
}

/**
 * Intake by position, zero-filled across every canonical position.
 *
 * Every position appears whether or not anyone arrived there, because "no
 * goalkeeper in four intakes" is the observation a goalkeeper would care about
 * and a sparse map would lose it.
 *
 * `meanPerTransition` is deliberately not called a rate or a need. It is
 * arrivals divided by observed transitions and nothing else; what it licenses
 * is a later phase's problem.
 */
export function positionIntake(arrivals = [], ctx = {}) {
  const coverage = asCoverage(ctx);
  const coach = coverage.scope === SCOPE.COACH;

  const byPosition = new Map(POSITION_KEYS.map((p) => [p, []]));
  for (const a of arrivals) {
    const position = a.canonicalPosition ?? 'UNKNOWN';
    if (!byPosition.has(position)) byPosition.set(position, []);
    byPosition.get(position).push(a);
  }

  const known = arrivals.filter((a) => (a.canonicalPosition ?? 'UNKNOWN') !== 'UNKNOWN').length;
  const absence = fieldAbsence(coverage, known, arrivals.length, 'position');

  const positions = {};
  for (const [position, rows] of byPosition) {
    const o = observe(rows, {
      key: position,
      coverage,
      specificity: specificityOf({ position, coach }),
    });
    positions[position] = {
      ...o,
      meanPerTransition: coverage.observedTransitions
        ? rows.length / coverage.observedTransitions
        : null,
      // Carried onto each position as well as the group, because a caller that
      // reads one position's zero would otherwise never see the gate.
      absence,
    };
  }
  return {
    coverage,
    absence,
    positionsKnown: known,
    positionsUnknown: arrivals.length - known,
    knownShare: arrivals.length ? known / arrivals.length : null,
    positions,
  };
}

/**
 * Freshman against experienced, which is a class-label observation and not a
 * transfer count.
 *
 * EXPERIENCED means the player had college years behind them. It does not mean
 * they transferred, and nothing here should be read as a portal figure — where
 * they came from is `priorConfidence`'s question and is usually unanswerable.
 */
export function freshmanMix(arrivals = [], ctx = {}) {
  const coverage = asCoverage(ctx);
  const counts = {
    [ENTRY_TYPE.FRESHMAN]: 0,
    [ENTRY_TYPE.EXPERIENCED]: 0,
    [ENTRY_TYPE.UNKNOWN]: 0,
    ...tallyBy(arrivals, (a) => a.entryType),
  };
  const total = arrivals.length;
  const share = (n) => (total ? n / total : null);

  const bySeason = {};
  for (const season of coverage.seasons) {
    bySeason[season] = { FRESHMAN: 0, EXPERIENCED: 0, UNKNOWN: 0, total: 0 };
  }
  for (const a of arrivals) {
    const s = String(a.arrivalSeason);
    if (!bySeason[s]) continue;
    bySeason[s][a.entryType] = (bySeason[s][a.entryType] || 0) + 1;
    bySeason[s].total += 1;
  }

  const byPosition = {};
  for (const position of POSITION_KEYS) {
    byPosition[position] = { FRESHMAN: 0, EXPERIENCED: 0, UNKNOWN: 0, total: 0 };
  }
  for (const a of arrivals) {
    const p = a.canonicalPosition ?? 'UNKNOWN';
    if (!byPosition[p]) byPosition[p] = { FRESHMAN: 0, EXPERIENCED: 0, UNKNOWN: 0, total: 0 };
    byPosition[p][a.entryType] = (byPosition[p][a.entryType] || 0) + 1;
    byPosition[p].total += 1;
  }

  return {
    coverage,
    absence: fieldAbsence(coverage, total - counts.UNKNOWN, total, 'class year'),
    total,
    counts,
    proportions: {
      FRESHMAN: share(counts.FRESHMAN),
      EXPERIENCED: share(counts.EXPERIENCED),
      UNKNOWN: share(counts.UNKNOWN),
    },
    bySeason,
    byPosition,
  };
}

/* -------------------------------------------------------------------------- */
/* Coach scope                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Everything the current coach can be held to, and nothing else.
 *
 * `scope.attributableTransitions` comes from the caller (see
 * `currentCoachScope` in arrivals.js) rather than from the arrivals themselves.
 * Deriving it from the rows would make the denominator "transitions in which
 * this coach signed somebody", so a coach who took no defenders in a quiet year
 * would have that year vanish — and "an international defender in 3 of 3
 * transitions" would be counted out of a denominator the observation itself had
 * chosen. The transitions come from the tenure; only the numerator comes from
 * the rows.
 *
 * The floor applies here independently. A programme with four transitions and a
 * coach appointed last summer has a describable programme history and no
 * describable coach history, and collapsing the two would put the predecessor's
 * recruiting in the new coach's mouth.
 */
export function coachHistory(arrivals = [], ctx = {}) {
  const scope = ctx.currentCoach ?? null;
  const dataStatus = ctx.dataStatus ?? null;
  const attributable = scope?.attributableTransitions ?? [];

  const rows = scope
    ? arrivals.filter((a) => a.coachAttribution === COACH_ATTRIBUTION.ATTRIBUTED
      && attributable.includes(a.sourceTransition))
    : [];

  const coverage = coverageOf({
    scope: SCOPE.COACH,
    transitions: attributable,
    arrivals: rows.length,
    possibleTransitions: ctx.coverage?.observedTransitions ?? ARRIVAL_TRANSITIONS.length,
  });

  const inner = { coverage, dataStatus };
  const seasons = coverage.seasons;

  return {
    coach: scope?.coach ?? null,
    coverage,
    dataStatus,
    attributableTransitions: coverage.observedTransitions,
    attributableArrivals: rows.length,
    // The window the coach can actually be spoken for. Both null where nothing
    // is attributable, which is not the same as a coach who recruited nobody.
    earliestSupportedSeason: seasons.length ? seasons[0] : null,
    latestSupportedSeason: seasons.length ? seasons[seasons.length - 1] : null,
    excluded: {
      inherited: arrivals.filter((a) => a.coachAttribution === COACH_ATTRIBUTION.INHERITED).length,
      unknown: arrivals.filter((a) => a.coachAttribution === COACH_ATTRIBUTION.UNKNOWN).length,
      // ATTRIBUTED, but to whoever held the job before the current coach.
      otherCoach: arrivals.filter((a) => a.coachAttribution === COACH_ATTRIBUTION.ATTRIBUTED
        && !attributable.includes(a.sourceTransition)).length,
    },
    countries: countryHistory(rows, inner),
    countryPositions: countryPositionHistory(rows, inner),
    regions: regionHistory(rows, inner),
    regionPositions: regionPositionHistory(rows, inner),
    positions: positionIntake(rows, inner),
    entryMix: freshmanMix(rows, inner),
  };
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One programme's complete recruiting observations.
 *
 * @param {Array}  arrivals              that programme's DIRECT arrivals
 * @param {object} ctx.programme
 * @param {object} ctx.sport
 * @param {Array}  ctx.comparableTransitions  from Phase 2 coverage
 * @param {object} ctx.currentCoach      { coach, attributableTransitions } | null
 */
export function buildProgrammePatterns(arrivals = [], ctx = {}) {
  const {
    programme = arrivals[0]?.programme ?? null,
    sport = arrivals[0]?.sport ?? null,
    comparableTransitions = [],
    possibleTransitions = ARRIVAL_TRANSITIONS.length,
    currentCoach = null,
  } = ctx;

  const dataStatus = countryDataStatus(sport);
  const coverage = coverageOf({
    scope: SCOPE.PROGRAMME,
    transitions: comparableTransitions,
    arrivals: arrivals.length,
    possibleTransitions,
  });
  const inner = { coverage, dataStatus };

  return {
    programme,
    sport,
    coverage,
    dataStatus,
    arrivals: arrivals.length,
    countries: countryHistory(arrivals, inner),
    countryPositions: countryPositionHistory(arrivals, inner),
    regions: regionHistory(arrivals, inner),
    regionPositions: regionPositionHistory(arrivals, inner),
    positions: positionIntake(arrivals, inner),
    entryMix: freshmanMix(arrivals, inner),
    coach: coachHistory(arrivals, { ...inner, currentCoach }),
    // Kept so a caller can re-cut on an axis this file does not expose without
    // going back to the database for rows it already has.
    source: arrivals,
  };
}

/* -------------------------------------------------------------------------- */
/* Player-relative query                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The observations that concern one athlete, gathered so that a later phase does
 * not have to know how any of the above is keyed.
 *
 * DATA ONLY. Not named `recruitingFitHistory` — "fit" is a conclusion, this
 * function returns counts, and a name that implies the conclusion is how the
 * conclusion gets made by accident three files later. There is no ranking, no
 * threshold and no prose here.
 *
 * A null field means the axis does not apply — a domestic athlete has no
 * country history because they have no country. A zero-total observation means
 * the axis applies and nothing was found, which under SUFFICIENT coverage is
 * itself a finding. Those two are different and a caller must be able to tell
 * them apart.
 */
export function observationsFor(player = {}, patterns = null) {
  if (!patterns) return null;

  const country = canonicalCountry(player.country);
  const region = country ? regionOf(country) : null;
  const position = player.canonicalPosition ?? player.position ?? null;
  const entryType = player.entryType ?? null;

  const coverage = patterns.coverage;
  const coachCoverage = patterns.coach?.coverage ?? null;
  const dataStatus = patterns.dataStatus;

  /** A cut that applies but produced nothing still has to be an observation. */
  const orEmpty = (found, opts) => found ?? emptyObservation(opts);

  const countryObs = country
    ? orEmpty(patterns.countries.countries[country], {
      key: country, coverage, dataStatus, specificity: SPECIFICITY.COUNTRY,
    })
    : null;

  const countryPositionObs = country && position
    ? orEmpty(patterns.countryPositions.pairs[`${country}||${position}`], {
      key: `${country}||${position}`, coverage, dataStatus, specificity: SPECIFICITY.COUNTRY_POSITION,
    })
    : null;

  const regionObs = region
    ? orEmpty(patterns.regions.regions[region], {
      key: region, coverage, dataStatus, specificity: SPECIFICITY.REGION,
    })
    : null;

  const regionPositionObs = region && position
    ? orEmpty(patterns.regionPositions.pairs[`${region}||${position}`], {
      key: `${region}||${position}`, coverage, dataStatus, specificity: SPECIFICITY.REGION_POSITION,
    })
    : null;

  const positionObs = position ? patterns.positions.positions[position] ?? null : null;

  // Internationals at the athlete's position: the rung between "this country at
  // this position" and "this position at all".
  const internationalPositionObs = position
    ? observe(patterns.source.filter((a) => a.isInternational
        && (a.canonicalPosition ?? 'UNKNOWN') === position), {
      key: `INTERNATIONAL||${position}`,
      coverage,
      dataStatus,
      specificity: SPECIFICITY.POSITION,
    })
    : null;

  const coachCountryObs = country && coachCoverage
    ? orEmpty(patterns.coach.countries.countries[country], {
      key: country, coverage: coachCoverage, dataStatus, specificity: SPECIFICITY.COACH_COUNTRY,
    })
    : null;

  const coachCountryPositionObs = country && position && coachCoverage
    ? orEmpty(patterns.coach.countryPositions.pairs[`${country}||${position}`], {
      key: `${country}||${position}`,
      coverage: coachCoverage,
      dataStatus,
      specificity: SPECIFICITY.COACH_COUNTRY_POSITION,
    })
    : null;

  const coachRegionObs = region && coachCoverage
    ? orEmpty(patterns.coach.regions.regions[region], {
      key: region, coverage: coachCoverage, dataStatus, specificity: SPECIFICITY.COACH_REGION,
    })
    : null;

  const coachPositionObs = position && coachCoverage
    ? patterns.coach.positions.positions[position] ?? null
    : null;

  return {
    programme: patterns.programme,
    sport: patterns.sport,
    player: { country, region, canonicalPosition: position, entryType },
    coverage,
    coachCoverage,
    dataStatus,

    sameCountry: countryObs,
    sameCountryPosition: countryPositionObs,
    sameRegion: regionObs,
    sameRegionPosition: regionPositionObs,
    positionHistory: positionObs,
    internationalPositionHistory: internationalPositionObs,
    internationalHistory: patterns.countries.international,
    entryTypeHistory: entryType
      ? { entryType, count: patterns.entryMix.counts[entryType] ?? 0, mix: patterns.entryMix }
      : null,

    coachSameCountry: coachCountryObs,
    coachSameCountryPosition: coachCountryPositionObs,
    coachSameRegion: coachRegionObs,
    coachPositionHistory: coachPositionObs,
  };
}
