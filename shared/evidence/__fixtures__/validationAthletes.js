/**
 * FOUR ATHLETES THAT DO NOT EXIST, TO TEST A SYSTEM BUILT ON FOUR THAT DO.
 *
 * Stage J was proved against three New Zealanders and one US midfielder, and
 * every live regional Evidence instance in that corpus was Oceania-shaped. The
 * mechanics were tested hard; the SHAPES were not. These are the smallest set
 * of profiles that reach the assumptions Stage J could not see itself making.
 *
 * ---------------------------------------------------------------------------
 * NOT PRODUCTION ROWS, AND THAT IS THE DESIGN.
 *
 * They are never inserted. `canonicalCorpus()` enumerates `SELECT * FROM
 * players`, so adding one would move all six Stage J baselines and change the
 * dataset fingerprint they are checked against — which is exactly the isolation
 * K1 required. `evidenceFor` takes an athlete OBJECT, so a fixture is enough to
 * drive the entire production path.
 *
 * ONLY FIELDS PRODUCTION CONSUMES. `normaliseEvidenceAthlete` reads name,
 * position, classYear, country/nationality, intendedMajor and sport; the email
 * context adds gpa, sat, act and secondary_position. Nothing else is invented —
 * no club, no awards, no evaluation prose. These are validation objects, not
 * pretend recruits.
 *
 * THE PROGRAMME SIDE IS REAL. Every roster, arrival, conference and postseason
 * fact these are paired against is production data. Only the athlete is
 * synthetic, which is the right split: an athlete supplies a country, a
 * position, a class year and a major, and a real one would not make any of
 * those more true.
 */

/** The class year every persona shares, so cohort comparisons stay honest. */
const CLASS_YEAR = 2027;

/**
 * K-EU — the broadest, densest region in the taxonomy.
 *
 * EUROPE holds 50 countries. A Norwegian shares it with Portugal, Greece and
 * Austria, and 536 Norwegian arrivals across 263 programmes mean the
 * same-country path is well populated too — so this tests the regional claim
 * where a stronger claim is often available beside it.
 *
 * No major and no academic data: ACADEMIC_FIT must not render, and the email
 * has to stay natural without it.
 */
export const K_EU = Object.freeze({
  id: 'K-EU',
  full_name: 'Validation Persona EU',
  sport: 'mens-soccer',
  nationality: 'Norway',
  position: 'Defender',
  secondary_position: 'None',
  recruiting_class_year: CLASS_YEAR,
  intended_major: null,
  gpa: null,
  sat_score: null,
  act_score: null,
});

/**
 * K-DOM — every international kind removed at once, and four other firsts.
 *
 * A domestic athlete has no "own country" pipeline to look for, so the four
 * same-country kinds and both regional kinds disappear. What remains —
 * POSITION_GRADUATION, ACADEMIC_FIT and the two recognitions — is the honest
 * floor of the system, and this is the profile that measures it.
 *
 * It also carries the only goalkeeper, the only secondary position, the only
 * ACT-without-SAT academics and a major vocabulary that is not "exercise
 * science". None of those interacts with country, so combining them costs no
 * resolution and saves a persona.
 *
 * `nationality: 'United States'` rather than 'USA' deliberately — that is the
 * spelling the existing QA fixture carries, and `normaliseEvidenceAthlete`
 * treats the two differently.
 */
export const K_DOM = Object.freeze({
  id: 'K-DOM',
  full_name: 'Validation Persona DOM',
  sport: 'mens-soccer',
  nationality: 'United States',
  position: 'Goalkeeper',
  secondary_position: 'MIDFIELD',
  recruiting_class_year: CLASS_YEAR,
  intended_major: 'computer science',
  gpa: 3.4,
  sat_score: null,
  act_score: 29,
});

/**
 * K-ASIA — broad AND sparse, which EUROPE is not.
 *
 * ASIA holds 32 countries and produces roughly a seventh of Europe's regional
 * renders. If the regional rule is unreliable because regions are broad, this
 * should read worse than Oceania; if it is unreliable because they are sparse,
 * it should read differently from Europe. Two failure modes, told apart.
 */
export const K_ASIA = Object.freeze({
  id: 'K-ASIA',
  full_name: 'Validation Persona ASIA',
  sport: 'mens-soccer',
  nationality: 'Japan',
  position: 'Forward',
  secondary_position: 'None',
  recruiting_class_year: CLASS_YEAR,
  intended_major: null,
  gpa: null,
  sat_score: null,
  act_score: null,
});

/**
 * K-TIGHT — the positive control, and the reason the others mean anything.
 *
 * UK_IRELAND holds five members and an Irish athlete's regional peer is
 * British. If this reads well while Europe and Asia do not, the problem is
 * region GRANULARITY. If this fails too, the regional concept itself is weak.
 * Without it a failure elsewhere cannot be told from "regional evidence is
 * simply bad".
 *
 * Women's soccer, and a third major vocabulary, because both were single-valued
 * in the Stage J corpus.
 */
export const K_TIGHT = Object.freeze({
  id: 'K-TIGHT',
  full_name: 'Validation Persona TIGHT',
  sport: 'womens-soccer',
  nationality: 'Ireland',
  position: 'Midfielder',
  secondary_position: 'None',
  recruiting_class_year: CLASS_YEAR,
  intended_major: 'nursing',
  gpa: 3.8,
  sat_score: null,
  act_score: null,
});

export const VALIDATION_ATHLETES = Object.freeze([K_EU, K_DOM, K_ASIA, K_TIGHT]);
