import { positionNoun, positionPlural } from '@shared/positions.js';

/**
 * Operator-facing presentation for the recruitment-pathway evidence.
 *
 * THE AXES ARE THE WHOLE PROBLEM HERE. Every kind in this section is a
 * statement about some combination of country, region, position and coach, and
 * the tempting sentence is almost always the one that borrows an axis from the
 * item next to it. At Jacksonville the coach item names New Zealand with a
 * null position, and the item under it names a defender from Australia; "this
 * coach recruits New Zealand defenders" is fluent, plausible, and supported by
 * neither. Each entry below reads only its own facts, and a missing axis makes
 * the phrase shorter rather than borrowed.
 *
 * `position` is null on 135 of 177 real coach items — the common case, not an
 * edge one — so the null branch is the one that has to be right.
 *
 * NOTHING HERE IS RECOMPUTED. International count and share arrive as separate
 * measurements and stay separate; intake counts are not divided into a rate;
 * a historical count and a current count are never added or characterised as a
 * pattern. Where a relationship IS asserted — transfer arrivals and how many
 * play this position — it is because one evidence object states both.
 *
 * NOTHING HERE PREDICTS. Historical recruiting is not intent, current presence
 * is not demand, and absence is not refusal. No entry may say "likely",
 * "prefers", "needs" or "will".
 *
 * Each entry returns:
 *   headline   the measurement, in one short line
 *   detail     an optional qualifying sentence
 *   names      an optional list of players, rendered as secondary text
 *   timeline   an optional [{ label, value }] breakdown
 *   scope      'athlete' for evidence cut to this athlete's own background,
 *              'programme' for a measurement of the squad at large. Read from
 *              the item's own decisionClass, never assumed per kind.
 */

const n = (v) => (Number.isFinite(v) ? String(v) : null);
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : null);
const noun = (position, count) => (count === 1 ? positionNoun(position) : positionPlural(position));

/** "A, B and C" — a list, never a total. */
function list(items = []) {
  const clean = (items ?? []).filter(Boolean);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/** The seasons an arrival kind observed, as a span or a single year. */
function span(seasons = []) {
  const clean = (seasons ?? []).filter(Boolean);
  if (!clean.length) return null;
  return clean.length === 1 ? clean[0] : `${clean[0]}–${clean[clean.length - 1]}`;
}

/**
 * A named arrival, when the evidence exposes one.
 *
 * Absent on 24 of 177 coach items and 22 of 215 arrival items. Absent means
 * "this evidence does not name one", never "there were none" — the count above
 * it says how many there were, and contradicting that with a zero state would
 * be inventing a finding out of a missing optional field.
 */
function named(f) {
  if (!f.namedArrival) return null;
  return f.namedArrivalSeason
    ? `${f.namedArrival}, ${f.namedArrivalSeason}`
    : f.namedArrival;
}

const PATHWAY_COPY = Object.freeze({
  // ---- Arrivals and presence cut to this athlete's background -------------

  COACH_ARRIVAL_SAME_COUNTRY: (f) => {
    if (!f.country || !f.coach || !n(f.count)) return null;
    /**
     * The position is NOT read, even when it is set.
     *
     * When every supporting arrival shared a position the generator records
     * it, and naming it here would be accurate for those 42 cases — but the
     * same phrase would then be absent for the other 135, and an operator
     * comparing two programmes would read the difference as a difference in
     * the programmes rather than in what we happened to record. The arrivals
     * beneath carry their own positions where they are known.
     */
    const when = span(f.seasons);
    return {
      headline: `${f.count} ${f.count === 1 ? 'arrival' : 'arrivals'} from ${f.country} under ${f.coach}`,
      detail: [
        when ? `Arriving ${when}.` : null,
        // Both figures are this item's own: how many intakes are attributable
        // to this coach, and how many of them carried such an arrival.
        n(f.attributableIntakes) && n(f.intakesWithArrival)
          ? `In ${f.intakesWithArrival} of ${f.attributableIntakes} intakes attributable to this coaching period.`
          : null,
      ].filter(Boolean).join(' ') || null,
      names: named(f) ? [named(f)] : null,
      scope: 'athlete',
    };
  },

  ARRIVAL_SAME_COUNTRY_POSITION: (f) => (f.country && f.position && n(f.count) ? {
    // Country AND position, because this one evidence object establishes both.
    headline: `${f.count} ${f.country} ${noun(f.position, f.count)} recruited`,
    detail: [
      span(f.seasons) ? `Arriving ${span(f.seasons)}.` : null,
      n(f.observedIntakes) && n(f.intakesWithArrival)
        ? `In ${f.intakesWithArrival} of ${f.observedIntakes} measured intakes.`
        : null,
    ].filter(Boolean).join(' ') || null,
    names: named(f) ? [named(f)] : null,
    scope: 'athlete',
  } : null),

  ARRIVAL_SAME_REGION_POSITION: (f) => (list(f.countries) && f.position && n(f.count) ? {
    /**
     * Names the COUNTRIES, never the region key. "OCEANIA" is a bucket name
     * from the recruiting tables; the countries are checkable against the
     * programme's own roster, which is the same choice the email renderer
     * makes. The region is a wider cut than the athlete's own country, and the
     * copy says so rather than letting it read as a country match.
     */
    headline: `${f.count} ${noun(f.position, f.count)} recruited from ${list(f.countries)}`,
    detail: [
      'From the athlete’s wider region rather than their own country.',
      span(f.seasons) ? `Arriving ${span(f.seasons)}.` : null,
      n(f.observedIntakes) ? `Across ${f.observedIntakes} measured intakes.` : null,
    ].filter(Boolean).join(' '),
    names: named(f) ? [named(f)] : null,
    scope: 'athlete',
  } : null),

  HISTORICAL_SAME_COUNTRY: (f) => (f.country && n(f.count) ? {
    headline: `${f.count} ${f.country} ${f.count === 1 ? 'player' : 'players'} on earlier rosters`,
    detail: list(f.seasonsPresent) ? `Present in ${list(f.seasonsPresent)}.` : null,
    names: f.names ?? null,
    scope: 'athlete',
  } : null),

  CURRENT_SAME_COUNTRY: (f) => (f.country && n(f.count) ? {
    // Deliberately worded as presence, not recruiting. Who is on the roster
    // now is not evidence of what the programme is looking for.
    headline: `${f.count} ${f.country} ${f.count === 1 ? 'player' : 'players'} on the current roster`,
    detail: 'On the squad now — this says nothing about current recruiting.',
    names: f.names ?? null,
    scope: 'athlete',
  } : null),

  HISTORICAL_SAME_REGION: (f) => (list(f.countries) && n(f.count) ? {
    headline: `${f.count} ${f.count === 1 ? 'player' : 'players'} from ${list(f.countries)} on earlier rosters`,
    /**
     * `excludingCountry` is stated, not hidden.
     *
     * It is set on all 507 real instances, and it is what makes the count
     * honest: the regional figure deliberately leaves out the athlete's own
     * country so it cannot double-count the country evidence above it.
     * Omitting the exclusion would make the number look like a wider total
     * than it is.
     */
    detail: f.excludingCountry
      ? `From the athlete’s wider region, counted separately from ${f.excludingCountry}.`
      : 'From the athlete’s wider region.',
    names: f.names ?? null,
    scope: 'athlete',
  } : null),

  // ---- Measurements of the squad and the programme's intake ---------------

  INTERNATIONAL_ROSTER: (f) => (n(f.count) && n(f.uniqueCountries) ? {
    headline: `${f.count} international ${f.count === 1 ? 'player' : 'players'} from `
      + `${f.uniqueCountries} ${f.uniqueCountries === 1 ? 'country' : 'countries'}`,
    detail: list(f.countries) ? `${list(f.countries)}.` : null,
    scope: 'programme',
  } : null),

  INTERNATIONAL_SHARE: (f) => (pct(f.share) && n(f.squadSize) ? {
    /**
     * The share as the server computed it, and its own squad size.
     *
     * Counted separately from INTERNATIONAL_ROSTER above rather than derived
     * from it: the two arrive as independent measurements, and recomputing
     * either from the other would put a third number on the page that nobody
     * calculated.
     */
    headline: `${pct(f.share)} of the squad is international`,
    detail: n(f.count) ? `${f.count} of ${f.squadSize} players.` : null,
    scope: 'programme',
  } : null),

  POSITION_INTAKE_HISTORY: (f) => (n(f.count) && f.position && n(f.observedIntakes) ? {
    /**
     * An observation, not a rate to plan against.
     *
     * `meanPerIntake` is the server's own figure and is shown as what it is —
     * an average of what happened — with no suggestion that another intake is
     * due. "They take about three defenders a year" is a forecast, and this
     * evidence is NEUTRAL and CONTEXT precisely because it does not support
     * one.
     */
    headline: `${f.count} ${noun(f.position, f.count)} recruited across `
      + `${f.observedIntakes} measured ${f.observedIntakes === 1 ? 'intake' : 'intakes'}`,
    detail: [
      n(f.intakesWithArrival)
        ? `${f.intakesWithArrival} of those intakes included at least one.`
        : null,
      // Rounded for display. The server's mean is 8/3 at Carleton and printed
      // as "Averaging 2.6666666666666665 per intake" — a true number that
      // reads as a bug and implies a precision the count cannot support.
      // Rounding a given value is formatting; it computes nothing.
      Number.isFinite(f.meanPerIntake)
        ? `Averaging ${Number(f.meanPerIntake.toFixed(1))} per intake.` : null,
    ].filter(Boolean).join(' ') || null,
    // Keys arrive as "2022->2023", one row per intake window.
    timeline: f.byIntake ? Object.entries(f.byIntake).map(([window, howMany]) => ({
      label: window.replace('->', '→'),
      value: `${howMany} ${noun(f.position, howMany)}`,
    })) : null,
    scope: 'programme',
  } : null),

  TRANSFER_BEHAVIOUR: (f) => (n(f.arrivals) && n(f.squadSize) ? {
    /**
     * What the current squad is made of, and nothing about appetite.
     *
     * `arrivals` counts players on the squad now whose prior programme was
     * somewhere else. `atPosition` is how many of those play this athlete's
     * position — a subset this single evidence object states, which is why it
     * may be phrased as one. It says nothing about whether the programme wants
     * another transfer, has a place for one, or would fund it.
     */
    headline: `${f.arrivals} of ${f.squadSize} came from another programme`,
    detail: n(f.atPosition)
      ? `${f.atPosition} of those play this athlete’s position.`
      : null,
    scope: 'programme',
  } : null),
});

/** Every pathway kind this module can present. Used by its tests, not the UI. */
export const PATHWAY_COPY_KINDS = Object.freeze(Object.keys(PATHWAY_COPY));

/** Presentation content for one pathway item, or null. */
export function pathwayCopyFor(item) {
  const build = PATHWAY_COPY[item?.kind];
  if (!build) return null;
  const content = build(item.facts ?? {});
  if (!content?.headline) return null;
  return {
    detail: null, names: null, timeline: null, ...content,
  };
}

/**
 * A compact qualification line, or null.
 *
 * Carries the two things this section's evidence turns on: whether the claim
 * is about now or about the past, and which seasons were read. Nothing about
 * how the server validated the item crosses — those fields are not on the
 * payload by design.
 */
export function pathwayQualification(item) {
  const q = item?.qualification ?? {};
  const parts = [];

  // Current or historical, from the payload's own temporality rather than from
  // the kind name. It is what separates "on the roster now" from "was on a
  // roster then", which two kinds here differ on and nothing else does.
  if (q.temporality === 'CURRENT') parts.push('Current roster');
  else if (q.temporality === 'HISTORICAL') parts.push('Recruiting history');

  const seasons = q.window?.seasons;
  if (seasons?.length) {
    parts.push(seasons.length === 1
      ? `${seasons[0]} read`
      : `${seasons[0]}–${seasons[seasons.length - 1]} read`);
  } else if (q.season) {
    parts.push(`${q.season} roster`);
  }

  if (q.freshness && q.freshness.state !== 'CURRENT') {
    parts.push(q.freshness.reason || `reading is ${String(q.freshness.state).toLowerCase()}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
