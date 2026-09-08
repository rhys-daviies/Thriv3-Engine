/**
 * Real matching-summary payloads, one page state each.
 *
 * CAPTURED FROM THE RUNNING ENDPOINT, not written by hand, for the same reason
 * the Decision Evidence fixtures were: a fixture invented to suit the copy
 * proves the copy renders the fixture. Every entry below except the two marked
 * SHAPED is the verbatim response for Rhys Davies (New Zealand, defender,
 * mens-soccer) at that programme, taken from a sweep of all 1,169 programmes
 * in which 969 — 82.9% — had no licensed signal at all and the maximum was
 * two.
 *
 * The sweep found all six licensed kinds in live data, which is what makes
 * this set a coverage claim rather than a sample:
 *
 *   HISTORICAL_SAME_COUNTRY        81
 *   COACH_ARRIVAL_SAME_COUNTRY     59
 *   ARRIVAL_SAME_REGION_POSITION   28
 *   POSITION_GROUP_SCARCITY        17
 *   ARRIVAL_SAME_COUNTRY_POSITION  10
 *   CURRENT_SAME_COUNTRY            8
 */

/** Two signals — the observed maximum, and the only shape that stacks rows. */
export const TWO_SIGNALS = {
  programme: { resolved: true },
  facts: [
    {
      kind: 'ARRIVAL_SAME_COUNTRY_POSITION',
      category: 'international',
      facts: {
        country: 'New Zealand',
        position: 'DEFENSE',
        count: 1,
        seasons: ['2023'],
        namedArrival: 'Zachary Cabiling',
        namedArrivalSeason: '2023',
      },
      qualification: { temporality: 'HISTORICAL', seasons: ['2023', '2024', '2025', '2026'] },
    },
    {
      kind: 'POSITION_GROUP_SCARCITY',
      category: 'roster',
      facts: { position: 'DEFENSE', count: 3, share: 0.16 },
      qualification: { temporality: 'CURRENT', seasons: ['2026'] },
    },
  ],
  hasEvidence: true,
};

/** One coach arrival, plural, spanning two seasons. Denver. */
export const COACH_ARRIVAL = {
  programme: { resolved: true },
  facts: [{
    kind: 'COACH_ARRIVAL_SAME_COUNTRY',
    category: 'international',
    facts: {
      country: 'New Zealand',
      coach: 'Jamie Franks',
      count: 2,
      seasons: ['2024', '2026'],
      namedArrival: null,
      namedArrivalSeason: null,
    },
    qualification: { temporality: 'HISTORICAL', seasons: ['2023', '2024', '2025', '2026'] },
  }],
  hasEvidence: true,
};

/** One coach arrival, singular, one season, with a name we hold. Jacksonville. */
export const COACH_ARRIVAL_SINGLE = {
  programme: { resolved: true },
  facts: [{
    kind: 'COACH_ARRIVAL_SAME_COUNTRY',
    category: 'international',
    facts: {
      country: 'New Zealand',
      coach: 'Ali Simmons',
      count: 1,
      seasons: ['2025'],
      namedArrival: 'Hayden Aish',
      namedArrivalSeason: '2025',
    },
    qualification: { temporality: 'HISTORICAL', seasons: ['2024', '2025', '2026'] },
  }],
  hasEvidence: true,
};

/**
 * Scarcity alone. Duke.
 *
 * The share is 0.18 against a count of 5, which puts the contested squad
 * figure at 28 for anyone given both numbers. The card is given both and
 * renders one.
 */
export const SCARCITY = {
  programme: { resolved: true },
  facts: [{
    kind: 'POSITION_GROUP_SCARCITY',
    category: 'roster',
    facts: { position: 'DEFENSE', count: 5, share: 0.18 },
    qualification: { temporality: 'CURRENT', seasons: ['2026'] },
  }],
  hasEvidence: true,
};

/** Compatriots on earlier rosters, plural, four seasons. Harding. */
export const HISTORICAL = {
  programme: { resolved: true },
  facts: [{
    kind: 'HISTORICAL_SAME_COUNTRY',
    category: 'international',
    facts: {
      country: 'New Zealand',
      count: 2,
      names: ['Jonah Pastiroff', 'Hayden Teixeira'],
      seasonsPresent: ['2022', '2023', '2025', '2026'],
    },
    qualification: { temporality: 'HISTORICAL', seasons: ['2022', '2023', '2024', '2025', '2026'] },
  }],
  hasEvidence: true,
};

/**
 * UNREACHABLE. Compatriots on the squad now, plural. Ferrum.
 *
 * Captured while CURRENT_SAME_COUNTRY was still licensed here. It is now
 * DENIED — `internationalFit` scores the same compatriots off the same 2026
 * roster, and on Ferrum's card the score's own geography row reads "a
 * compatriot here" — so the server can no longer produce this payload.
 *
 * Kept precisely because of that. The component must fail closed on a shape it
 * should never see, and "the server would never send that" is the assumption
 * that makes a client-side leak invisible on the day it stops being true.
 */
export const CURRENT = {
  programme: { resolved: true },
  facts: [{
    kind: 'CURRENT_SAME_COUNTRY',
    category: 'international',
    facts: { country: 'New Zealand', count: 2, names: ['Kaspar Szikszai', 'Ben Hooper'] },
    qualification: { temporality: 'CURRENT', seasons: ['2026'] },
  }],
  hasEvidence: true,
};

/** A wider-region intake, one country. Adams State. */
export const REGION = {
  programme: { resolved: true },
  facts: [{
    kind: 'ARRIVAL_SAME_REGION_POSITION',
    category: 'international',
    facts: {
      countries: ['Australia'],
      position: 'DEFENSE',
      count: 1,
      seasons: ['2025'],
      namedArrival: 'Jett McTavish',
      namedArrivalSeason: '2025',
    },
    qualification: { temporality: 'HISTORICAL', seasons: ['2023', '2024', '2025', '2026'] },
  }],
  hasEvidence: true,
};

/**
 * SHAPED. A wider-region intake covering two countries.
 *
 * No programme in the live sweep had one for this athlete, and the list
 * branch is exactly where a region key would surface if the projection ever
 * regressed — so it is exercised deliberately rather than left untested. The
 * field shape is `REGION`'s, with a second country added.
 */
export const REGION_TWO_COUNTRIES = {
  programme: { resolved: true },
  facts: [{
    kind: 'ARRIVAL_SAME_REGION_POSITION',
    category: 'international',
    facts: {
      countries: ['Australia', 'Fiji'],
      position: 'MIDFIELD',
      count: 3,
      seasons: ['2022', '2024', '2025'],
      namedArrival: null,
      namedArrivalSeason: null,
    },
    qualification: { temporality: 'HISTORICAL', seasons: ['2022', '2023', '2024', '2025', '2026'] },
  }],
  hasEvidence: true,
};

/** Resolved, looked at, nothing licensed. 82.9% of real pairs. Sacred Heart. */
export const ZERO = { programme: { resolved: true }, facts: [], hasEvidence: false };

/** The server could not read this one programme. */
export const UNAVAILABLE = { unavailable: 'roster unreadable' };

/**
 * SHAPED. A name that did not resolve to a programme we hold.
 *
 * Not observed in the sweep — every name on a match card came out of the
 * matching engine against a real college row, so it should not be reachable
 * from this surface at all. Kept because "should not be reachable" is a claim
 * about today's join, and the card's behaviour when it is wrong should be
 * decided here rather than discovered in front of an operator.
 */
export const UNRESOLVED = { programme: { resolved: false }, facts: [], hasEvidence: false };

/** Every state, for suites that sweep them. */
export const SIGNAL_FIXTURES = Object.freeze({
  TWO_SIGNALS,
  COACH_ARRIVAL,
  COACH_ARRIVAL_SINGLE,
  SCARCITY,
  HISTORICAL,
  CURRENT,
  REGION,
  REGION_TWO_COUNTRIES,
  ZERO,
  UNAVAILABLE,
  UNRESOLVED,
});
