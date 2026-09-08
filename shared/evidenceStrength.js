/**
 * How much history stands behind an interpretation.
 *
 * This is NOT confidence, probability, or statistical significance, and it
 * must never be rendered as any of those. It answers one question — "how much
 * of the record is this reading built on?" — and it answers it in three words
 * rather than a number, because a decimal score invites exactly the false
 * precision the rest of this module exists to refuse. There is no 72/100 here
 * and there must never be one.
 *
 * It says nothing about whether a programme is a good one. A programme that
 * plays no freshmen at all, measured across four complete seasons, has STRONG
 * evidence behind a low classification. The existing badge convention in
 * src/lib/philosophyLabels.js already draws this line for verdicts — colour
 * tracks predictability, not merit — and this module keeps it.
 *
 * Four families, not one universal scorer. The units genuinely differ: a
 * position-season transition, a measured first-year, a roster row and a
 * season are not interchangeable, and averaging them into a single number
 * would be inventing a measurement.
 *
 * Every family returns the same envelope so a renderer can treat them alike:
 *
 *   {
 *     level: 'strong' | 'moderate' | 'limited',
 *     sufficient: boolean,        // false → the caller must say 'unclear'
 *     reasons: [{ code, ... }],   // stable slugs, never prose
 *     sample: { seasons, players, observations },   // null where meaningless
 *     ...family-specific fields
 *   }
 *
 * `reasons` carries codes and numbers, never sentences. Wording belongs to
 * whichever surface is rendering — the PDF says one thing and the tab another,
 * and the analytics layer should not be choosing between them.
 */

import { MIN_COHORT_PLAYERS, MIN_COHORT_SEASONS } from './freshmanMinutes.js';

export const LEVELS = ['limited', 'moderate', 'strong'];

// ---------------------------------------------------------------------------
// Thresholds
//
// Every one of these is either inherited from an existing safeguard or derived
// from a structural ceiling in the data. None is a taste judgement, and the
// reason is recorded beside it so a later change has to argue with something.
// ---------------------------------------------------------------------------

/**
 * Seasons of freshman intake behind a reading of the programme.
 *
 * `classifyProgramme` already refuses to describe a pattern from fewer than
 * two seasons ('too-few-seasons'), so two is the floor rather than a new one.
 * Three is 'strong' because the window is four seasons deep: three readable
 * seasons means at most one was lost, and the half-and-half step test that
 * classifies the programme still has something either side of the split.
 */
export const SEASONS_FOR_STRONG = 3;
export const SEASONS_FOR_MODERATE = MIN_COHORT_SEASONS; // 2

/**
 * Measured first-years behind a reading of the programme.
 *
 * `MIN_COHORT_PLAYERS` is the established point below which a group describes
 * itself rather than the programme. Twice it is 'strong' here for a reason
 * that is specific to this quantity: a whole-intake read spanning several
 * seasons should not be carried by one season's arrivals, and a typical
 * intake is around six, so twelve is the point at which no single season can
 * be the whole sample.
 */
export const FRESHMEN_FOR_STRONG = MIN_COHORT_PLAYERS * 2; // 12
export const FRESHMEN_FOR_MODERATE = MIN_COHORT_PLAYERS;   // 6

/**
 * Readable vacancy observations behind a reading of replacement behaviour.
 *
 * One programme's ceiling is fixed by the data: four canonical positions times
 * three season transitions is twelve. Eight is two-thirds of everything there
 * is to see, four is a third, and below two there is no pattern to describe —
 * only individual events.
 */
export const VACANCY_OBSERVATIONS_CEILING = 12;
export const VACANCY_OBSERVATIONS_FOR_STRONG = 8;
export const VACANCY_OBSERVATIONS_FOR_MODERATE = 4;
export const VACANCY_OBSERVATIONS_MINIMUM = 2;

/**
 * Openings at one position before the outcomes read as a pattern.
 *
 * Three is not new: the report already boxes a warning below it — "too few to
 * be a pattern — read it as what happened, not as odds" — and this lifts that
 * existing threshold rather than inventing a second one. A position has at
 * most three transitions on file, so three openings means every transition
 * opened a place.
 */
export const POSITION_TRANSITIONS_CEILING = 3;
export const OPENINGS_FOR_PATTERN = 3;
export const POSITION_TRANSITIONS_MINIMUM = 2;

const rank = (level) => LEVELS.indexOf(level);
const weakest = (...levels) => LEVELS[Math.min(...levels.map(rank))];

/** One step down, never below 'limited'. */
function demote(level, by = 1) {
  return LEVELS[Math.max(0, rank(level) - by)];
}

function bandBy(value, strong, moderate) {
  if (value >= strong) return 'strong';
  if (value >= moderate) return 'moderate';
  return 'limited';
}

// ---------------------------------------------------------------------------
// Coaching relevance
//
// Not a sample-size question. The record can be four complete seasons and
// still describe somebody who has left, which is a different defect from
// having too little of it — so it is reported on its own axis and only
// demotes the level rather than deciding it.
// ---------------------------------------------------------------------------

/**
 * Whose programme the measured seasons describe, as a stable slug.
 *
 * `describes-previous` is the one that matters most: `new-coach-no-record`
 * means every season on file belongs to the previous staff, and a reader must
 * not be handed it as the current coach's record.
 */
export const COACH_RELEVANCE = {
  steady: 'describes-current',
  'erratic-same-coach': 'describes-current',
  'policy-shift-same-coach': 'describes-current',
  'structural-through-changes': 'describes-current',
  'continuity-through-change': 'describes-current',
  'regime-change': 'partly-describes-current',
  'vacancy-in-window': 'partly-describes-current',
  'change-too-recent': 'partly-describes-current',
  'new-coach-no-record': 'describes-previous',
  'coach-unknown': 'unknown',
  'coach-unknown-recent': 'unknown',
  'too-few-seasons': 'unknown',
};

/**
 * The coaching context behind a programme reading.
 *
 * `tenure` and `verdict` are the shapes `shared/coachTenure.js` and
 * `classifyProgramme` already return; both may be null, and null is reported
 * as 'unknown' rather than assumed continuous — a gap in the coaching record
 * is not evidence that nobody changed.
 */
export function coachContinuity(verdict, tenure) {
  const key = verdict?.verdict ?? null;
  const relevance = key ? (COACH_RELEVANCE[key] ?? 'unknown') : 'unknown';
  return {
    verdict: key,
    relevance,
    coach: tenure?.current?.coach ?? null,
    since: tenure?.current?.since ?? null,
    unknownSeasons: tenure?.unknownSeasons ?? [],
    vacantSeasons: tenure?.vacantSeasons ?? [],
    // Stated rather than inferred by the caller: a coaching record that stops
    // before the seasons being described cannot vouch for them.
    knownThrough: tenure?.knownThrough ?? null,
  };
}

/** How far coaching context should pull a sample-size level down. */
function coachPenalty(continuity) {
  if (continuity.relevance === 'describes-previous') return 2;
  if (continuity.relevance === 'unknown') return 1;
  if (continuity.relevance === 'partly-describes-current') return 1;
  if (continuity.unknownSeasons.length || continuity.vacantSeasons.length) return 1;
  return 0;
}

function coachReasons(continuity) {
  const out = [];
  if (continuity.relevance === 'describes-previous') {
    out.push({ code: 'record-describes-previous-coach', coach: continuity.coach, since: continuity.since });
  }
  if (continuity.relevance === 'partly-describes-current') {
    out.push({ code: 'coaching-changed-inside-window', since: continuity.since });
  }
  if (continuity.relevance === 'unknown') {
    out.push({ code: 'coaching-record-incomplete', verdict: continuity.verdict });
  }
  if (continuity.unknownSeasons.length) {
    out.push({ code: 'seasons-not-attributed', seasons: continuity.unknownSeasons });
  }
  if (continuity.vacantSeasons.length) {
    out.push({ code: 'seasons-with-no-head-coach', seasons: continuity.vacantSeasons });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Freshman opportunity
// ---------------------------------------------------------------------------

/**
 * How much record stands behind "this is what a first year looks like here".
 *
 * `unreadableSeasons` is counted rather than ignored: a season dropped because
 * its minutes were never published is a hole in the evidence even though every
 * downstream figure correctly excludes it.
 */
export function freshmanOpportunityEvidence({
  seasonsObserved = 0, measuredFreshmen = 0, unreadableSeasons = [], verdict = null, tenure = null,
} = {}) {
  const continuity = coachContinuity(verdict, tenure);
  const reasons = [];

  const bySeasons = bandBy(seasonsObserved, SEASONS_FOR_STRONG, SEASONS_FOR_MODERATE);
  const byPlayers = bandBy(measuredFreshmen, FRESHMEN_FOR_STRONG, FRESHMEN_FOR_MODERATE);
  let level = weakest(bySeasons, byPlayers);

  if (seasonsObserved < SEASONS_FOR_STRONG) {
    reasons.push({ code: 'few-measurable-seasons', seasons: seasonsObserved });
  }
  if (measuredFreshmen < FRESHMEN_FOR_STRONG) {
    reasons.push({ code: 'few-measured-freshmen', players: measuredFreshmen });
  }
  if (unreadableSeasons.length) {
    reasons.push({ code: 'seasons-without-published-minutes', seasons: [...unreadableSeasons] });
    level = demote(level);
  }

  const penalty = coachPenalty(continuity);
  if (penalty) {
    reasons.push(...coachReasons(continuity));
    level = demote(level, penalty);
  }

  return {
    level,
    sufficient: seasonsObserved >= SEASONS_FOR_MODERATE && measuredFreshmen >= FRESHMEN_FOR_MODERATE,
    reasons,
    sample: { seasons: seasonsObserved, players: measuredFreshmen, observations: null },
    coachContinuity: continuity,
  };
}

// ---------------------------------------------------------------------------
// 2. Vacancy / replacement behaviour
// ---------------------------------------------------------------------------

/**
 * How much record stands behind "when a place comes free, this is who takes it".
 *
 * `observations` is the readable count — the one `dials()` actually averages —
 * and `totalObservations` is everything the transitions produced. The gap
 * between them is a coverage loss worth naming: observations are dropped when
 * a position-season carries too few minutes to read, or when its class labels
 * could not be read at all.
 */
export function vacancyEvidence({
  observations = 0, totalObservations = null, seasons = 0, verdict = null, tenure = null,
} = {}) {
  const continuity = coachContinuity(verdict, tenure);
  const reasons = [];

  let level = bandBy(observations, VACANCY_OBSERVATIONS_FOR_STRONG, VACANCY_OBSERVATIONS_FOR_MODERATE);

  if (observations < VACANCY_OBSERVATIONS_FOR_STRONG) {
    reasons.push({
      code: 'few-vacancy-observations',
      observations,
      ceiling: VACANCY_OBSERVATIONS_CEILING,
    });
  }
  if (totalObservations != null && totalObservations > observations) {
    reasons.push({
      code: 'observations-not-readable',
      dropped: totalObservations - observations,
      of: totalObservations,
    });
    level = demote(level);
  }
  if (seasons && seasons < SEASONS_FOR_STRONG) {
    reasons.push({ code: 'few-transitions-represented', seasons });
    level = demote(level);
  }

  const penalty = coachPenalty(continuity);
  if (penalty) {
    reasons.push(...coachReasons(continuity));
    level = demote(level, penalty);
  }

  return {
    level,
    sufficient: observations >= VACANCY_OBSERVATIONS_MINIMUM,
    reasons,
    sample: { seasons: seasons || null, players: null, observations },
    coachContinuity: continuity,
  };
}

// ---------------------------------------------------------------------------
// 3. Position-specific behaviour
// ---------------------------------------------------------------------------

/**
 * How much record stands behind a claim about one position.
 *
 * Openings are tracked separately from transitions because they answer
 * different questions. Three transitions with no opening is complete evidence
 * that no starter left; it is no evidence at all about what happens when one
 * does, and only the second is a weakness.
 */
export function positionEvidence({
  transitions = 0, openings = 0, seasons = 0, players = null,
} = {}) {
  const reasons = [];

  let level = bandBy(transitions, POSITION_TRANSITIONS_CEILING, POSITION_TRANSITIONS_MINIMUM);

  if (transitions < POSITION_TRANSITIONS_CEILING) {
    reasons.push({ code: 'few-position-transitions', transitions, ceiling: POSITION_TRANSITIONS_CEILING });
  }
  if (openings === 0) {
    reasons.push({ code: 'no-starter-departed', transitions });
    // Not a demotion: it is a complete answer to a different question, and the
    // caller decides which question it is asking.
  } else if (openings < OPENINGS_FOR_PATTERN) {
    reasons.push({ code: 'too-few-openings-for-a-pattern', openings, needed: OPENINGS_FOR_PATTERN });
    level = demote(level);
  }
  if (seasons && seasons < POSITION_TRANSITIONS_CEILING) {
    reasons.push({ code: 'few-seasons-represented', seasons });
  }
  if (players != null && players < MIN_COHORT_PLAYERS) {
    reasons.push({ code: 'few-players-at-position', players, needed: MIN_COHORT_PLAYERS });
    level = demote(level);
  }

  return {
    level,
    sufficient: transitions >= POSITION_TRANSITIONS_MINIMUM,
    // Stated on its own so a caller can answer "what happens when a place
    // opens here" with silence rather than with a count of zero.
    openingsReadable: openings > 0,
    patternReadable: openings >= OPENINGS_FOR_PATTERN,
    reasons,
    sample: { seasons: seasons || null, players, observations: transitions },
  };
}

// ---------------------------------------------------------------------------
// 4. Origin / cohort analysis
// ---------------------------------------------------------------------------

/**
 * How much record stands behind a reading narrowed to one cohort.
 *
 * The thresholds are `MIN_COHORT_PLAYERS` and `MIN_COHORT_SEASONS` themselves,
 * not new ones. `freshmanProfile` has already refused or relaxed the cohort by
 * the time this is called, and this reports what that refusal means for the
 * reading rather than second-guessing it: a relaxed cohort is a real answer
 * about a wider group, not a failed answer about the one asked for.
 */
export function cohortEvidence({
  players = 0, seasons = 0, relaxed = null, refused = null, applied = true,
} = {}) {
  const reasons = [];

  const bySeasons = bandBy(seasons, SEASONS_FOR_STRONG, MIN_COHORT_SEASONS);
  const byPlayers = bandBy(players, FRESHMEN_FOR_STRONG, MIN_COHORT_PLAYERS);
  let level = weakest(bySeasons, byPlayers);

  if (players < FRESHMEN_FOR_STRONG) {
    reasons.push({ code: 'small-cohort', players, needed: MIN_COHORT_PLAYERS });
  }
  if (seasons < SEASONS_FOR_STRONG) {
    reasons.push({ code: 'few-cohort-seasons', seasons, needed: MIN_COHORT_SEASONS });
  }
  if (refused) {
    reasons.push({ code: 'requested-cohort-refused', detail: refused });
  }
  if (relaxed) {
    // The reading is sound; it is simply about a wider group than the one
    // asked for, and a reader must be told which.
    reasons.push({ code: 'cohort-relaxed', to: relaxed });
    level = demote(level);
  }
  if (!applied) {
    reasons.push({ code: 'read-across-whole-intake' });
  }

  return {
    level,
    sufficient: players >= MIN_COHORT_PLAYERS && seasons >= MIN_COHORT_SEASONS,
    // Whether the figures describe the cohort that was actually asked for.
    describesRequestedCohort: Boolean(applied) && !relaxed,
    reasons,
    sample: { seasons: seasons || null, players, observations: null },
  };
}
