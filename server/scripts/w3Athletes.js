/**
 * A7.19: the women's validation profile set. Data only. Nothing here runs.
 *
 * -- MIRRORED, NOT INVENTED ------------------------------------------------
 *
 * Every one of these is the men's V3 athlete of the same letter with the
 * sport changed and nothing else re-reasoned. Same ratings, same positions,
 * same entry year, same preferences, same stated contributions, same academic
 * profiles. That is deliberate: A7.19 asks whether the implemented
 * architecture behaves on a different universe, and the only way to read the
 * answer is to change the universe and not the athlete.
 *
 * NO WOMEN'S-SPECIFIC RECRUITING ASSUMPTION IS ENCODED HERE. The differences
 * that matter are already in the data and the calibration and are reported
 * rather than modelled: 1235 programmes against 1169, no junior colleges at
 * all, 95% roster coverage against 75%, 9.6% international arrivals against
 * 28.8%, and a per-sport ability scale in which a rating 9 means 82.7 rather
 * than 83.58 because there are 349 women's Division I programmes and 213
 * men's. Those are facts about the pool; if any of them should change the
 * scoring, that is a finding for a later phase and not a fixture.
 *
 * -- THE ONE THING THAT COULD NOT BE MIRRORED ------------------------------
 *
 * The men's set carries an international athlete (V3-C) because the men's
 * pool is 28.8% international arrivals and the market arm needed exercising.
 * W3-C keeps that, so the same arm is exercised against a pool where
 * international arrivals are a third as common. The result is a statement
 * about the data, not about the athlete.
 */

/** Shared by every W3 athlete: the columns `normaliseAthlete` reads. */
const BASE = {
  act_score: null,
  academic_minimum: null,
  preferred_divisions: '[]',
  preferred_conferences: '[]',
  match_weights: null,
  criterion_ranking: null,
  budget_range: null,
};

const SPORT = 'womens-soccer';

export const W3_ATHLETES = [
  {
    id: 'W3-A-elite-level-focused',
    role: 'ELITE / LEVEL-FOCUSED',
    mirrors: 'V3-A-elite-level-focused',
    player: {
      ...BASE,
      sport: SPORT, football_ability: 9, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.9, sat_score: 1450,
      state: 'CA', city: 'Los Angeles', nationality: 'USA', origin: 'USA',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 40000,
      competitive_level_priority: 5,
      playing_opportunity_priority: 1,
      academic_strength_priority: 3,
    },
  },
  {
    id: 'W3-B-elite-balanced',
    role: 'ELITE / BALANCED',
    mirrors: 'V3-B-elite-balanced',
    player: {
      ...BASE,
      sport: SPORT, football_ability: 9, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.9, sat_score: 1450,
      state: 'CA', city: 'Los Angeles', nationality: 'USA', origin: 'USA',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 40000,
      competitive_level_priority: 3,
      playing_opportunity_priority: 3,
      academic_strength_priority: 3,
    },
  },
  {
    id: 'W3-C-strong-playing-focused',
    role: 'STRONG / PLAYING-FOCUSED',
    mirrors: 'V3-C-strong-playing-focused',
    player: {
      ...BASE,
      sport: SPORT, football_ability: 7, position: 'Forward',
      recruiting_class_year: 2028, gpa: 3.3, sat_score: null,
      state: null, city: null, nationality: 'England', origin: 'International',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 18000,
      competitive_level_priority: 2,
      playing_opportunity_priority: 5,
      academic_strength_priority: 3,
    },
  },
  {
    id: 'W3-D-developmental-balanced',
    role: 'DEVELOPMENTAL / BALANCED',
    mirrors: 'V3-D-developmental-balanced',
    player: {
      ...BASE,
      sport: SPORT, football_ability: 3, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 4.0, sat_score: 1550,
      state: 'MA', city: 'Boston', nationality: 'USA', origin: 'USA',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 40000,
      competitive_level_priority: 3,
      playing_opportunity_priority: 3,
      academic_strength_priority: 3,
    },
  },
  {
    id: 'W3-E-academic-priority',
    role: 'ACADEMIC-PRIORITY',
    mirrors: 'V3-E-academic-priority',
    player: {
      ...BASE,
      sport: SPORT, football_ability: 6, position: 'Defender',
      recruiting_class_year: 2028, gpa: 3.4, sat_score: 1150,
      state: 'TX', city: 'Austin', nationality: 'USA', origin: 'USA',
      intended_major: 'Engineering',
      contribution_state: 'STATED', max_annual_contribution_usd: 13000,
      competitive_level_priority: 3,
      playing_opportunity_priority: 3,
      academic_strength_priority: 5,
    },
  },
  {
    id: 'W3-F-financially-constrained',
    role: 'FINANCIALLY CONSTRAINED',
    mirrors: 'V3-F-financially-constrained',
    player: {
      ...BASE,
      sport: SPORT, football_ability: 9, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.9, sat_score: 1450,
      state: 'CA', city: 'Los Angeles', nationality: 'USA', origin: 'USA',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 8000,
      competitive_level_priority: 3,
      playing_opportunity_priority: 3,
      academic_strength_priority: 3,
    },
  },
];

export const w3Athlete = (key) => W3_ATHLETES.find(
  (a) => a.id.toUpperCase().startsWith(`W3-${String(key).toUpperCase()}-`),
) ?? null;
