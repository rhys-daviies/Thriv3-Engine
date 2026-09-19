/**
 * The components of Athlete Opportunity / Fit, in two families.
 *
 * -- THE SPLIT THAT MAKES THE GENERIC-ATHLETE TRAP IMPOSSIBLE ---------------
 *
 * OBJECTIVE VALUE is what is true about the opportunity whether or not the
 * athlete has told us anything: how widely this programme shares the minutes
 * at their position, and which way the programme is going.
 *
 * PREFERENCE FIT is scored only where the athlete has DECLARED something.
 * Where they have not, the component is NOT_APPLICABLE - it leaves the
 * coverage denominator and nothing is assumed. The system never decides on an
 * athlete's behalf that close to home is good, that prestige is good, or that
 * a particular division is better.
 *
 * Playing opportunity sits on the objective side, and that is a judgement
 * worth stating: an athlete recruiting for a place to play is, by the act of
 * recruiting, seeking somewhere to play. What we do NOT know is how much they
 * would trade playing time for a stronger programme - and that is exactly the
 * preference `athleticOutcome` would need and does not have.
 */
import { GRADE, REASON, scoreable, unscoreable, notApplicable } from '../types.js';
import { playingShareFor, playingScale, TRAJECTORY_SATURATION } from '../opportunityRules.js';
import { majorLabelFor, academicIntentState, ACADEMIC_INTENT } from '../../../academicMajors.js';

/**
 * Was this number actually given to us?
 *
 * `Number(null)` is 0 and `Number('')` is 0, and 0 is finite - so a bare
 * Number.isFinite test reads an ABSENT figure as a stated zero. It bit twice
 * in this file within an hour: a missing maximum distance became "will travel
 * at most zero miles" and scored every programme a perfect 1, and a missing
 * prior win rate became a prior of zero, turning any record at all into a
 * spectacular improvement. Every optional number here is read through this.
 */
const stated = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/**
 * How likely the athlete is to be one of the players who actually plays.
 *
 * The programme's measured share, placed on the p10-to-p90 range of programmes
 * at the same position in the same sport. A programme at the tenth percentile
 * of sharing scores 0, one at the ninetieth scores 1.
 *
 * GOALKEEPERS NEED NO SPECIAL CASE, and that was measured rather than assumed.
 * The distinctive goalkeeping structure - one player taking 86% of the minutes
 * - is already IN the measure: the median goalkeeping share is 0.40 against
 * 0.56-0.65 outfield, so goalkeepers come out lower on the same scale without
 * a rule being written for them. The candidate that WOULD have needed a
 * goalkeeper rule, newcomer minutes share, was rejected for being unstable
 * (split-half r = 0.002 at goalkeeper).
 */
export function playingOpportunity({ sport, position, division, programme, rosterOnFile }) {
  if (!rosterOnFile) {
    return unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['minutesHistory'], available: [] });
  }
  const norm = playingShareFor({ sport, division, position, programme });
  const scale = playingScale(sport, position);
  if (!norm || !scale) {
    return unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['playingShare'], available: [] });
  }
  const span = scale.p90 - scale.p10;
  const value = span <= 0 ? 0.5 : Math.min(1, Math.max(0, (norm.share - scale.p10) / span));
  return scoreable({
    value,
    // A programme's own seasons are a measurement of how it uses a squad. A
    // division or sport rate standing in for it is a proxy.
    grade: norm.level === 'programme' ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage: 1,
    basis: {
      playingShare: norm.share,
      seasons: norm.seasons,
      level: norm.level,
      scaleP10: scale.p10,
      scaleMedian: scale.median,
      scaleP90: scale.p90,
      measure: 'effective players sharing the minutes, as a share of the position group',
    },
  });
}

/**
 * Which way the programme is going.
 *
 * The CHANGE in win rate between the two most recent seasons, not its level.
 * That distinction is the whole point: recent win rate correlates with
 * `soccer_score` at 0.35-0.47 and would be programme strength restated, while
 * the change correlates at 0.023 / 0.087 and is genuinely new information.
 *
 * A programme holding steady scores 0.5. That is a MEASURED midpoint of a
 * measured quantity, not a prior standing in for an absent one - a programme
 * we have no win rates for is unscoreable below.
 */
export function programmeTrajectory({ recentWinPct, priorWinPct, saturation = TRAJECTORY_SATURATION }) {
  if (!stated(recentWinPct) || !stated(priorWinPct)) {
    return unscoreable({
      reason: REASON.NO_WIN_RATES,
      missing: [...(stated(recentWinPct) ? [] : ['recentWinPct']), ...(stated(priorWinPct) ? [] : ['priorWinPct'])],
      available: [...(stated(recentWinPct) ? ['recentWinPct'] : []), ...(stated(priorWinPct) ? ['priorWinPct'] : [])],
    });
  }
  const recent = Number(recentWinPct);
  const prior = Number(priorWinPct);
  const change = recent - prior;
  const value = Math.min(1, Math.max(0, 0.5 + (change / (2 * saturation))));
  return scoreable({
    value,
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: { recentWinPct: recent, priorWinPct: prior, change, saturation, direction: change > 0 ? 'improving' : (change < 0 ? 'declining' : 'steady') },
  });
}

/**
 * Does this institution teach what the athlete said they want to study?
 *
 * The ONLY athlete preference Thriv3 currently collects that belongs in this
 * layer. Set membership against the programme's notable majors, using the same
 * matcher the email composer uses, so an athlete is never told one thing and
 * scored another.
 *
 * STRONG ACADEMICS ARE NOT A FIT. A high GPA does not make a selective
 * institution a better opportunity for someone who never said they wanted one;
 * that is V1's academicFit and it is not reproduced here. The academic
 * MINIMUM an athlete sets is a filter and belongs to eligibility.
 */
export function majorFit({ intendedMajor, notableMajors }) {
  const state = academicIntentState(intendedMajor);
  if (state !== ACADEMIC_INTENT.VALID) {
    // Nobody asked, they have not decided, or the answer is not placeable.
    // None of the three is a fit of zero.
    return notApplicable({ intendedMajor: intendedMajor ?? null, academicIntent: state });
  }
  const wanted = majorLabelFor(intendedMajor);
  let offered = notableMajors;
  if (typeof offered === 'string') {
    try { offered = JSON.parse(offered); } catch { offered = null; }
  }
  if (!Array.isArray(offered) || offered.length === 0) {
    return unscoreable({ reason: REASON.NO_STATED_PREFERENCE, missing: ['notableMajors'], available: ['intendedMajor'] });
  }
  const matched = offered.includes(wanted);
  return scoreable({
    value: matched ? 1 : 0,
    // A named list of families against a matched family. Nothing is inferred.
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: { intendedMajor, majorFamily: wanted, matched, notableMajors: offered },
  });
}

/**
 * Where the athlete wants to be.
 *
 * ALWAYS NOT_APPLICABLE TODAY, and this is the sharpest departure from V1.
 * Thriv3 collects the athlete's home city, state or country; it collects no
 * preference about WHERE THEY WANT TO GO - no preferred states, no regions, no
 * maximum distance, no campus setting. V1 scores distance from home and treats
 * closer as better, which is a preference nobody was asked for.
 *
 * Residency pricing is Financial Viability's and international recruiting
 * history is Coach Recruitability's. Neither is a location preference and
 * neither is read here.
 *
 * The signature takes the preference so that the day it is collected, this
 * becomes a scorer and nothing else moves.
 */
export function locationFit({ preferredStates = null, preferredRegions = null, maxDistanceMiles = null, collegeState = null, distanceMiles = null }) {
  const declared = (Array.isArray(preferredStates) && preferredStates.length > 0)
    || (Array.isArray(preferredRegions) && preferredRegions.length > 0)
    || stated(maxDistanceMiles);
  if (!declared) {
    return notApplicable({ why: 'the athlete has stated no location preference, and a home address is not one' });
  }
  if (Array.isArray(preferredStates) && preferredStates.length > 0) {
    if (!collegeState) return unscoreable({ reason: REASON.NO_LOCATION, missing: ['collegeState'], available: ['preferredStates'] });
    const matched = preferredStates.map((s) => String(s).toUpperCase()).includes(String(collegeState).toUpperCase());
    return scoreable({ value: matched ? 1 : 0, grade: GRADE.MEASURED, coverage: 1, basis: { preferredStates, collegeState, matched } });
  }
  if (stated(maxDistanceMiles)) {
    if (!stated(distanceMiles)) return unscoreable({ reason: REASON.NO_LOCATION, missing: ['distanceMiles'], available: ['maxDistanceMiles'] });
    const within = Number(distanceMiles) <= Number(maxDistanceMiles);
    return scoreable({ value: within ? 1 : 0, grade: GRADE.MEASURED, coverage: 1, basis: { maxDistanceMiles, distanceMiles, within } });
  }
  return unscoreable({ reason: REASON.NO_STATED_PREFERENCE, missing: ['preferredRegions'], available: [] });
}

/**
 * How much this athlete wants the strongest programme they can reach, against
 * how much they want to play.
 *
 * ALWAYS NOT_APPLICABLE TODAY. The engine knows the athlete's ability. It does
 * not know their ambition, and those are different things. Scoring this
 * without the preference means choosing a shape - and any peaked shape is V1's
 * Gaussian coming back through the one door V2 has not closed, this time
 * wearing the athlete's name instead of the coach's.
 *
 * A6.2 marked this NOT_APPLICABLE and the preference audit confirms it: there
 * is no column, no form field and no collected value anywhere that states a
 * level ambition. Re-evaluated, not assumed.
 */
export function athleticOutcome({ levelPreference = null }) {
  if (!levelPreference) {
    return notApplicable({ why: 'no level ambition is collected: ability is not a preference about ambition' });
  }
  return unscoreable({
    reason: REASON.NO_STATED_PREFERENCE,
    missing: ['levelPreferenceScorer'],
    available: ['levelPreference'],
    detail: { note: 'a level preference now exists and no scorer has been designed for it - refusing rather than inventing a shape' },
  });
}
