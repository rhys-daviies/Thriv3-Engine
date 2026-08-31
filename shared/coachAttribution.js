/**
 * Which coaching regime does each measured season belong to?
 *
 * The report describes four seasons of a programme's record. It does not say
 * whose record they are. At 741 of 1,449 measurable programmes the current
 * coach did not run the whole window, and at 391 of them they ran one season
 * or none — Hofstra's four measured seasons are Richard Nuttall's, and a
 * family reading that report about Stephen Roche cannot tell. This module is
 * the truth layer that lets a page say so.
 *
 * WHAT IT ANSWERS, and nothing else: which observable coaching context each
 * measured season belongs to, and how much of the measured window belongs to
 * the coach a recruit would join.
 *
 * WHAT IT DOES NOT ANSWER. Whether the coach caused any of the behaviour the
 * report measures. Whether one coach is better than another. Whether anything
 * observed will continue. What any analytic becomes when restricted to one
 * coach's seasons — that is a separate question and this module deliberately
 * cannot answer it, because it never touches a roster row.
 *
 * A PURE FUNCTION OF TWO INPUTS: the programme's `coach_seasons` rows, and the
 * list of seasons the report actually measured. It does not read
 * `roster_players` and does not re-derive readability. That is the whole design
 * decision — the denominator is handed in, so the attribution and the report
 * can never disagree about which seasons are being described, and so a second
 * definition of "readable" cannot come into existence here.
 *
 * IT NEVER INTERPOLATES. A season with no usable coach on file is UNRESOLVED
 * and stays UNRESOLVED, even when the same name sits either side of it. A gap
 * between two spells of one name is two observations, not one — the rule
 * `tenureFor` already keeps, for the reason it documents: Bellarmine women's
 * read as one coach across four seasons purely because two came back blank,
 * and it was three coaches.
 *
 * IT DOES NOT DECIDE WHAT A HEAD COACH IS. `readCoachRow` in `coachTenure.js`
 * does, and re-exporting it from here rather than restating it is deliberate:
 * the report's coach verdict reads the same table through `tenureFor`, and two
 * answers to "is this a head coach" is exactly the defect Phase 11D fixed.
 *
 * CO-HEAD COACHES CANNOT BE FULLY REPRESENTED. `coach_seasons` has primary key
 * (school, sport, season) and therefore stores exactly one row per
 * programme-season. Four programmes list a co-head arrangement; the model
 * flags it and does not pretend to resolve it.
 */
import { sameCoach, readCoachRow, UNUSABLE } from './coachTenure.js';

/**
 * The head-coach reader is one function, and it lives in `coachTenure.js`.
 *
 * It was written here in Phase 11B and moved in 11D, because `tenureFor` — the
 * input to the report's own coach verdict — did not use it. Re-exported rather
 * than re-imported by every caller so the interface this module has always
 * offered is unchanged.
 */
export { readCoachRow, UNUSABLE } from './coachTenure.js';

/** The season a recruit would be joining. Never a measured season. */
export const CURRENT_SEASON = 2026;

/** How a season was attributed. */
export const ATTRIBUTION = Object.freeze({
  CURRENT: 'CURRENT_COACH',
  PREVIOUS: 'PREVIOUS_COACH',
  UNRESOLVED: 'UNRESOLVED',
});

/**
 * The structural shape of a programme's coaching timeline.
 *
 * ONE ENUM AND THE FACTS BEHIND IT. Every state here is derived from
 * `facts` by the documented priority in `timelineStateOf`, and `facts` is
 * always present — so a consumer that needs more than the label has it, and
 * the label can be coarse without anything being lost. Ohio State men's is the
 * case that forced this: three measured seasons under the current coach and
 * one whose coach was never resolved. No single word covers that, and
 * flattening it to "incomplete" would throw away the three.
 */
export const TIMELINE = Object.freeze({
  CURRENT_COACH_UNKNOWN: 'CURRENT_COACH_UNKNOWN',
  CURRENT_COACH_NO_MEASURED_SEASON: 'CURRENT_COACH_NO_MEASURED_SEASON',
  SAME_COACH_ALL_HISTORY: 'SAME_COACH_ALL_HISTORY',
  CURRENT_COACH_ONE_SEASON: 'CURRENT_COACH_ONE_SEASON',
  MULTIPLE_CHANGES: 'MULTIPLE_CHANGES',
  COACH_CHANGE_WITHIN_WINDOW: 'COACH_CHANGE_WITHIN_WINDOW',
  COACH_RECORD_INCOMPLETE: 'COACH_RECORD_INCOMPLETE',
});

/** The current coach, or null and the reason there is none. */
export function currentCoachFrom(coachRows = [], { currentSeason = CURRENT_SEASON } = {}) {
  const row = coachRows.find((r) => Number(r?.season) === Number(currentSeason)) ?? null;
  const read = readCoachRow(row);
  if (!read.usable) return { coach: null, reason: read.reason };
  return {
    coach: {
      name: read.name,
      title: read.title,
      season: Number(currentSeason),
      confidence: row.confidence ?? null,
      interim: read.interim,
      coHead: read.coHead,
      usable: true,
    },
    reason: null,
  };
}

/**
 * Observed named-coach transitions inside the measured window.
 *
 * CONSERVATIVE, and the rule is the point. A transition is counted only where
 * two seasons are adjacent IN THE CALENDAR, both resolved, and name different
 * coaches.
 * So `A → unresolved → B` counts nothing, because nothing observed says the
 * change happened at either boundary rather than in the gap. `A → unresolved →
 * A` counts nothing either. And a change across a season the report could not
 * measure is not counted, because this window is the measured window.
 *
 * The consequence is deliberate under-counting. A programme that changed coach
 * twice with an unresolved season between will report fewer transitions than it
 * had, and that is the direction of error this codebase chooses every time.
 */
export function observedTransitions(seasons = []) {
  const out = [];
  for (let i = 1; i < seasons.length; i += 1) {
    const prev = seasons[i - 1];
    const here = seasons[i];
    if (Number(here.season) !== Number(prev.season) + 1) continue;
    if (!prev.coachName || !here.coachName) continue;
    if (sameCoach(prev.coachName, here.coachName)) continue;
    out.push({ from: prev.coachName, to: here.coachName, season: Number(here.season) });
  }
  return out;
}

/**
 * The timeline state, from the facts, by an explicit priority.
 *
 * The order matters and is the whole of the design. An incomplete coach record
 * must not erase a known fact: Mercyhurst men's has one measured season under
 * its current coach and three that are somebody else's, and
 * `CURRENT_COACH_ONE_SEASON` is what a reader needs — not "incomplete", which
 * is true of a different programme and useless here.
 */
export function timelineStateOf(facts) {
  const { currentCoachKnown, measured, attributed, previous, unresolved, transitions } = facts;
  if (!currentCoachKnown) return TIMELINE.CURRENT_COACH_UNKNOWN;
  if (attributed === 0) return TIMELINE.CURRENT_COACH_NO_MEASURED_SEASON;
  if (attributed === measured) return TIMELINE.SAME_COACH_ALL_HISTORY;
  if (attributed === 1) return TIMELINE.CURRENT_COACH_ONE_SEASON;
  if (transitions >= 2) return TIMELINE.MULTIPLE_CHANGES;
  if (previous > 0) return TIMELINE.COACH_CHANGE_WITHIN_WINDOW;
  // Attributed seasons and no named earlier coach: the rest of the window was
  // never resolved, and nothing may be filled in for it.
  if (unresolved > 0) return TIMELINE.COACH_RECORD_INCOMPLETE;
  return TIMELINE.COACH_RECORD_INCOMPLETE;
}

/**
 * The attribution model for one programme.
 *
 * @param coachRows - this programme's `coach_seasons` rows, any order.
 * @param measuredSeasons - the seasons the REPORT measured, as strings or
 *   numbers. Handed in rather than derived: see the module note. An empty list
 *   is legitimate and yields a model with no denominator.
 * @param currentSeason - the season a recruit would join. Never measured.
 */
export function coachAttribution({ coachRows = [], measuredSeasons = [], currentSeason = CURRENT_SEASON } = {}) {
  const measured = [...new Set(measuredSeasons.map(Number))]
    .filter((s) => Number.isFinite(s) && s !== Number(currentSeason))
    .sort((a, b) => a - b);
  const bySeason = new Map();
  for (const r of coachRows) {
    const s = Number(r?.season);
    if (Number.isFinite(s)) bySeason.set(s, r);
  }

  const { coach: currentCoach, reason: currentCoachReason } = currentCoachFrom(coachRows, { currentSeason });

  const seasons = measured.map((season) => {
    const row = bySeason.get(season) ?? null;
    const read = readCoachRow(row);
    const coachName = read.usable ? read.name : null;
    const attribution = !coachName ? ATTRIBUTION.UNRESOLVED
      : (currentCoach && sameCoach(coachName, currentCoach.name)
        ? ATTRIBUTION.CURRENT : ATTRIBUTION.PREVIOUS);
    return {
      season: String(season),
      coachName,
      coachTitle: read.usable ? read.title : null,
      coachConfidence: coachName ? (row.confidence ?? null) : null,
      unusableReason: read.usable ? null : read.reason,
      interim: read.usable ? read.interim : false,
      coHead: read.usable ? read.coHead : false,
      attribution,
    };
  });

  const attributed = seasons.filter((s) => s.attribution === ATTRIBUTION.CURRENT);
  const previous = seasons.filter((s) => s.attribution === ATTRIBUTION.PREVIOUS);
  const unresolved = seasons.filter((s) => s.attribution === ATTRIBUTION.UNRESOLVED);
  const transitions = observedTransitions(seasons);

  // One named coach across every earlier season, or nothing. Named
  // `predecessor` for the interface and observational in meaning: the coach on
  // file for those seasons. Nothing here says they held the post before the
  // current coach, or that one followed the other — only that these seasons
  // carry that name and the current season carries a different one.
  const previousNames = [...new Set(previous.map((s) => s.coachName))];
  const singleNamed = previous.length > 0
    && previousNames.every((n) => sameCoach(n, previousNames[0]));
  const predecessor = singleNamed
    ? { name: previous[0].coachName, seasons: previous.map((s) => s.season) }
    : null;

  const facts = Object.freeze({
    currentCoachKnown: Boolean(currentCoach),
    measured: seasons.length,
    attributed: attributed.length,
    previous: previous.length,
    unresolved: unresolved.length,
    transitions: transitions.length,
    interim: Boolean(currentCoach?.interim),
    coHead: Boolean(currentCoach?.coHead) || seasons.some((s) => s.coHead),
  });

  const reasons = [];
  if (!currentCoach) reasons.push(currentCoachReason);
  if (!seasons.length) reasons.push('no measured season was handed to the attribution model');
  if (unresolved.length) {
    reasons.push(`${unresolved.length} of ${seasons.length} measured `
      + `season${seasons.length === 1 ? '' : 's'} has no usable coach on file`);
  }
  if (facts.interim) reasons.push('the coach on file for the current season is recorded as interim');
  if (facts.coHead) reasons.push('a co-head arrangement is on file, which one row per season cannot fully represent');

  return {
    currentCoach,
    currentCoachReason,
    measuredSeasons: seasons,
    // The two figures a page may state, and the share they make. Descriptive,
    // with no threshold and no label: "1 of the 4 measured seasons in this
    // report was under the current coach" is the whole claim.
    historicalMeasuredSeasons: seasons.length,
    currentCoachMeasuredSeasons: attributed.length,
    currentCoachShare: seasons.length ? attributed.length / seasons.length : null,
    previousCoachMeasuredSeasons: previous.length,
    incompleteCoachSeasons: unresolved.map((s) => s.season),
    observedTransitions: transitions,
    transitionCount: transitions.length,
    predecessor,
    predecessorIsSingleNamedCoach: Boolean(predecessor),
    timelineState: timelineStateOf(facts),
    facts,
    // An interim is not a regime. A page that reads the state above without
    // reading this would describe a caretaker as the programme's direction.
    requiresInterimQualifier: Boolean(currentCoach?.interim),
    evidence: {
      sufficient: Boolean(currentCoach) && seasons.length > 0,
      reasons,
    },
  };
}
