/**
 * What V2 needs to know about an athlete, stated once, so a real Thriv3 record
 * can be run through the same harness as a fixture.
 *
 * -- WHY THIS EXISTS SEPARATELY FROM THE FIXTURES -------------------------
 *
 * The fixtures are literals written by us. A real athlete arrives as a
 * database row with fields missing, fields we never asked for, and fields that
 * exist but are not collected on the current form. This module is the place
 * that difference is made explicit: `missing` names what was absent and
 * `notCollected` names what the product does not ask at all, and neither is
 * silently replaced with a value.
 *
 * NO DEFAULTS, ANYWHERE. A budget we do not have is not the middle band; a
 * preference nobody was asked is UNDECLARED, which is what every existing
 * Thriv3 record legitimately is.
 *
 * The V1 athlete shape is passed IN rather than built here: a V2 module may
 * not import V1's pool, and the import guard enforces it in both directions.
 */
import { abilityToPercentile, abilityToProgrammeScore } from '../calibration/abilityScale.js';
import { budgetInterval } from '../financialRules.js';
import { readPriority } from '../athletePreferences.js';

/**
 * The fields a real athlete must carry, and what happens without each.
 *
 * REQUIRED means the athlete cannot be ranked at all. OPTIONAL means some
 * layer or component goes NOT_APPLICABLE or drops coverage - which is a
 * smaller, visible loss rather than an invented value.
 */
export const REQUIRED_INPUTS = Object.freeze({
  sport: { required: true, withoutIt: 'No calibration exists. Nothing can be scored.' },
  football_ability: { required: true, withoutIt: 'Coach Recruitability has no athlete percentile; every programme is UNSCOREABLE and the whole pool is LIMITED_DATA.' },
  position: { required: true, withoutIt: 'Positional opportunity is unscoreable, which takes most of Coach Recruitability with it.' },
  recruiting_class_year: { required: true, withoutIt: 'No entry year, so no roster opening can be computed.' },
  budget_range: { required: false, withoutIt: 'Financial Viability is UNSCOREABLE and every programme falls to LIMITED_DATA. Not fatal, but the list becomes unrankable in practice.' },
  state: { required: false, withoutIt: 'Public in-state cost cannot be applied; the cost basis becomes RESIDENCY_UNKNOWN and carries the wider interval.' },
  origin: { required: false, withoutIt: 'Inferred from nationality. International cost and international recruiting history both depend on it.' },
  nationality: { required: false, withoutIt: 'Origin falls back to domestic. International cost and international recruiting history are both read from it.' },
  gpa: { required: false, withoutIt: 'Academic eligibility screens cannot run. Does not affect any V2 layer score.' },
  sat_score: { required: false, withoutIt: 'Academic eligibility screens cannot run. Does not affect any V2 layer score.' },
  act_score: { required: false, withoutIt: 'Academic eligibility screens cannot run. Does not affect any V2 layer score.' },
  competitive_level_priority: { required: false, withoutIt: 'UNDECLARED. athleticOutcome goes NOT_APPLICABLE and Opportunity is built from measured evidence only.' },
  playing_opportunity_priority: { required: false, withoutIt: 'UNDECLARED. Component weights stay at their objective values.' },
  academic_strength_priority: { required: false, withoutIt: 'UNDECLARED. academicStrengthFit goes NOT_APPLICABLE and institutional academic strength reorders nothing.' },
  intended_major: { required: false, withoutIt: 'NOT COLLECTED on the current form. Major fit is NOT_APPLICABLE for every athlete today.' },
  preferred_divisions: { required: false, withoutIt: 'No division filter; nothing is ruled INELIGIBLE on division.' },
});

/** Fields the product does not ask anybody, so they are absent by design rather than by accident. */
export const NOT_COLLECTED = Object.freeze([
  'intended_major',
  'location preference (how far from home, or where)',
  'recruit type (high school / transfer / post-graduate / junior college)',
  'initial enrolment year and seasons used, which is what eligibility actually runs on',
  'whether the athlete has already been contacted by any programme',
]);

const band = (rating) => (rating >= 9 ? 'ELITE' : rating >= 7 ? 'STRONG' : rating >= 5 ? 'MID' : 'DEVELOPMENTAL');

export function preferenceProfileOf(level, playing) {
  const l = readPriority(level); const p = readPriority(playing);
  if (l === null && p === null) return 'UNDECLARED';
  if (l >= 4 && p >= 4) return 'BOTH_HIGH';
  if (l >= 4 && p <= 2) return 'LEVEL_FIRST';
  if (p >= 4 && l <= 2) return 'PLAYING_FIRST';
  return 'MIXED';
}

/**
 * Turn a record into the athlete shape the V2 harness runs, plus the input
 * block a human reviewer reads, plus an honest list of what was absent.
 *
 * @param {object} args
 * @param {object} args.record     a player-shaped row
 * @param {object} args.v1Shape    normaliseAthlete(record), built by the caller
 * @param {string} args.position   canonicalPosition(record.position), built by the caller
 * @param {object} [args.profile]  { competitiveLevelPriority, playingOpportunityPriority }
 * @param {string} [args.label]
 */
export function buildValidationAthlete({ record, v1Shape, position, profile = {}, label = null, recruitType = null }) {
  const sport = record.sport;
  const rating = Number(record.football_ability);
  const level = profile.competitiveLevelPriority ?? readPriority(record.competitive_level_priority);
  const playing = profile.playingOpportunityPriority ?? readPriority(record.playing_opportunity_priority);
  const academic = profile.academicStrengthPriority ?? readPriority(record.academic_strength_priority);

  const missing = [];
  for (const [field, spec] of Object.entries(REQUIRED_INPUTS)) {
    const v = record[field];
    if (v === null || v === undefined || v === '') {
      if (NOT_COLLECTED.includes(field)) continue;
      missing.push({ field, required: spec.required, consequence: spec.withoutIt });
    }
  }

  const interval = (() => {
    try {
      const i = budgetInterval(record.budget_range);
      if (!i) return 'UNDECLARED';
      const [lo, hi] = i.interval;
      const top = Number.isFinite(hi) ? `$${hi.toLocaleString('en-US')}` : 'no stated ceiling';
      return `$${lo.toLocaleString('en-US')} to ${top} per year${i.legacy ? ' (legacy band)' : ''}`;
    } catch { return 'UNREADABLE'; }
  })();

  const inputs = {
    label: label ?? record.id ?? 'athlete',
    sport,
    sex: sport === 'womens-soccer' ? 'female' : 'male',
    position,
    abilityRating: rating,
    abilityBand: band(rating),
    athletePercentile: Number.isFinite(rating) ? abilityToPercentile(rating, sport) : null,
    equivalentProgrammeScore: Number.isFinite(rating) ? abilityToProgrammeScore(rating, sport) : null,
    entryYear: record.recruiting_class_year ?? null,
    eligibilityBasis: `openings computed for entry year ${record.recruiting_class_year} against the roster season on file; class label stands in for years-since-enrolment`,
    gpa: record.gpa ?? null,
    sat: record.sat_score ?? null,
    act: record.act_score ?? null,
    budgetRange: record.budget_range ?? 'UNDECLARED',
    budgetInterval: interval,
    origin: v1Shape.origin,
    nationality: record.nationality ?? null,
    state: record.state ?? null,
    city: record.city ?? null,
    recruitType: recruitType ?? 'NOT COLLECTED — V2 reads only domestic/international and the entry year',
    competitiveLevelPriority: level,
    playingOpportunityPriority: playing,
    academicStrengthPriority: academic,
    preferenceProfile: preferenceProfileOf(level, playing),
    /** Which of the three core questions this athlete has actually answered. */
    undeclaredPreferences: [
      ...(level === null ? ['competitive_level_priority'] : []),
      ...(playing === null ? ['playing_opportunity_priority'] : []),
      ...(academic === null ? ['academic_strength_priority'] : []),
    ],
    intendedMajor: record.intended_major ?? null,
    preferredDivisions: v1Shape.divisions ?? [],
    preferredConferences: v1Shape.conferences ?? [],
    criterionRanking: v1Shape.criterionRanking ?? [],
    notCollected: [...NOT_COLLECTED],
    missing,
  };

  const athlete = {
    label: { id: inputs.label, sport, position, rating, budget: record.budget_range },
    v1Shape,
    recruitability: {
      sport, rating, position,
      entryYear: record.recruiting_class_year,
      isInternational: v1Shape.origin === 'International',
      /**
       * REQUIRED by the domestic arm of Recruiting Market Match. Without it
       * the arm is NOT_APPLICABLE, and where positional evidence is also
       * unknown the evidence floor refuses - so a pack built without this
       * would describe a model with 60 fewer ranked programmes than the one
       * actually running. It did, until A7.7.6 caught it.
       */
      homeState: record.state ?? null,
    },
    opportunity: {
      sport, position, rating,
      intendedMajor: record.intended_major ?? null,
      priorityRanking: v1Shape.criterionRanking?.length ? v1Shape.criterionRanking : null,
      competitiveLevelPriority: level,
      playingOpportunityPriority: playing,
      academicStrengthPriority: academic,
    },
  };

  return { athlete, inputs };
}

/**
 * The ambition profiles a validation pack is run under.
 *
 * They live beside the input contract rather than beside the fixtures because
 * a preference is not a different athlete: the same person, asked and not
 * asked, is one record and two profiles.
 *
 * UNDECLARED is the control and must reproduce the answer every earlier phase
 * reported, because no fixture states either preference.
 */
export const PROFILES = Object.freeze({
  UNDECLARED: {
    competitiveLevelPriority: null, playingOpportunityPriority: null, academicStrengthPriority: null,
    label: 'no preference declared',
  },
  LEVEL_FIRST: {
    competitiveLevelPriority: 5, playingOpportunityPriority: 1, academicStrengthPriority: null,
    label: 'competitive level 5, playing opportunity 1, academics undeclared',
  },
  PLAYING_FIRST: {
    competitiveLevelPriority: 1, playingOpportunityPriority: 5, academicStrengthPriority: null,
    label: 'competitive level 1, playing opportunity 5, academics undeclared',
  },
  BOTH_HIGH: {
    competitiveLevelPriority: 5, playingOpportunityPriority: 5, academicStrengthPriority: null,
    label: 'both athletic priorities 5, academics undeclared',
  },
  BALANCED: {
    competitiveLevelPriority: 3, playingOpportunityPriority: 3, academicStrengthPriority: null,
    label: 'both athletic priorities 3, academics undeclared',
  },
  /**
   * A7.7.6. The profile the first human review effectively asked for: an
   * athlete who has answered all three questions and says academics matter
   * most. Fixture C's review named academics as the missing preference, so
   * this is the one that tests whether collecting it was worth doing.
   */
  ACADEMIC_FIRST: {
    competitiveLevelPriority: 3, playingOpportunityPriority: 3, academicStrengthPriority: 5,
    label: 'competitive level 3, playing opportunity 3, academic strength 5',
  },
  FULLY_DECLARED_LEVEL: {
    competitiveLevelPriority: 5, playingOpportunityPriority: 1, academicStrengthPriority: 3,
    label: 'competitive level 5, playing opportunity 1, academic strength 3',
  },
  FULLY_DECLARED_PLAYING: {
    competitiveLevelPriority: 1, playingOpportunityPriority: 5, academicStrengthPriority: 3,
    label: 'competitive level 1, playing opportunity 5, academic strength 3',
  },
});
