import { POSITIONS } from './positions.js';

/**
 * =============================================================================
 * WHAT WE LEARNED ABOUT AN ATHLETE AND A PROGRAMME — A9.6.
 *
 * This is OBSERVATION, not scoring. Nothing here reaches the matchmaking
 * engine, and nothing here is an input to a rank. V2 is frozen; these rows
 * record what happened AFTERWARDS so that one day somebody can ask whether the
 * ranking was any good. Asking is a later phase. Collecting honestly is this
 * one.
 * =============================================================================
 *
 * -- THREE CATEGORIES, AND THEY ARE NOT ONE SCORE --------------------------
 *
 * A9.6 §C is explicit that these must not collapse into a "success" number,
 * and the reason is that they answer different questions about different
 * subjects:
 *
 *   ATHLETE_OUTCOME           did this athlete want this programme?
 *   PROGRAMME_INTEREST        did this programme want this athlete?
 *   RECRUITING_INTELLIGENCE   what is true of this programme right now,
 *                             regardless of this athlete?
 *
 * The third is the one that would do the most damage pooled with the others.
 * "We filled the goalkeeper spot in the 2027 class" is a fact about a
 * PROGRAMME AT A TIME. It is not a judgement of the athlete who happened to
 * receive it, and an engine that learned "this programme rejects our athletes"
 * from it would have learned something false.
 *
 * -- COMMUNICATION IS DELIBERATELY ABSENT -----------------------------------
 *
 * §G lists SENT / DELIVERED / OPENED / CLICKED / REPLIED. None of them is
 * here, because all of them already exist and a second copy would be a second
 * account of the same fact:
 *
 *   SENT               `outreach_send.state = ACCEPTED`, with `sent_at`
 *   DELIVERED/BOUNCED  `outreach_send_event` BOUNCE_HARD | BOUNCE_SOFT
 *   REPLIED            `outreach_send_event` REPLY
 *   OPENED/CLICKED     `tracking_events` (visit_start, visit_qualified,
 *                      play_start, coverage_*), rolled up by
 *                      `engagement_rollup`
 *
 * This codebase has already paid for duplicating a fact once: the schema notes
 * that `outreach_evidence` and `outreach_send` "came to disagree" because the
 * same values were written twice. So A9.6 adds the INTERPRETATION layer and
 * points at the communication layer rather than restating it.
 *
 * The distinction that matters: `outreach_send_event.REPLY` says A REPLY
 * ARRIVED. It does not say what the reply meant. What it meant is a
 * POSITIVE_REPLY / NEGATIVE_REPLY / POSITION_FILLED observation here, carrying
 * who decided that, how, and whether anybody checked.
 */

export const OBSERVATION_CATEGORY = Object.freeze({
  ATHLETE_OUTCOME: 'ATHLETE_OUTCOME',
  PROGRAMME_INTEREST: 'PROGRAMME_INTEREST',
  RECRUITING_INTELLIGENCE: 'RECRUITING_INTELLIGENCE',
});

/**
 * THE BOUNDED VOCABULARY. A kind belongs to exactly one category — see
 * `CATEGORY_OF_KIND`, which is the single source of that mapping and is
 * asserted total by the tests.
 *
 * COMPATIBLE WITH THE REASONS THE PRODUCT ALREADY USES. `campaigns.js` holds
 * seven stop reasons, and the four that are OBSERVATIONS rather than
 * operational decisions map onto this list without translation:
 *
 *   not_recruiting      -> NOT_RECRUITING_POSITION / ROSTER_COMPLETE
 *   not_interested      -> DECLINED_ATHLETE
 *   athlete_declined    -> ATHLETE_NOT_INTERESTED
 *   committed_elsewhere -> COMMITTED (recorded against where they went)
 *
 * The other three — no_contact, suppressed, operator — are decisions Thriv3
 * made, not things it learned, and they stay where they are.
 */
export const OBSERVATION_KIND = Object.freeze({
  /* -- PROGRAMME_INTEREST: did this programme want this athlete? ---------- */
  POSITIVE_REPLY: 'POSITIVE_REPLY',
  NEUTRAL_REPLY: 'NEUTRAL_REPLY',
  NEGATIVE_REPLY: 'NEGATIVE_REPLY',
  REQUESTED_FILM: 'REQUESTED_FILM',
  REQUESTED_TRANSCRIPT: 'REQUESTED_TRANSCRIPT',
  REQUESTED_CALL: 'REQUESTED_CALL',
  INTERESTED: 'INTERESTED',
  ROSTER_PLACE_OFFERED: 'ROSTER_PLACE_OFFERED',
  FINANCIAL_OFFER: 'FINANCIAL_OFFER',
  /**
   * NOT `DECLINED`. The bare word does not say WHO declined, and this file
   * carries an athlete-side refusal eight lines further down. One of the two
   * would eventually be read as the other.
   */
  DECLINED_ATHLETE: 'DECLINED_ATHLETE',

  /* -- RECRUITING_INTELLIGENCE: what is true of this programme? ----------- */
  POSITION_FILLED: 'POSITION_FILLED',
  POSITION_NEEDED: 'POSITION_NEEDED',
  CLASS_FILLED: 'CLASS_FILLED',
  RECRUITING_FUTURE_CLASS: 'RECRUITING_FUTURE_CLASS',
  ROSTER_COMPLETE: 'ROSTER_COMPLETE',
  NOT_RECRUITING_POSITION: 'NOT_RECRUITING_POSITION',
  OTHER_RECRUITING_INFORMATION: 'OTHER_RECRUITING_INFORMATION',

  /* -- ATHLETE_OUTCOME: did this athlete want this programme? ------------- */
  ATHLETE_INTERESTED: 'ATHLETE_INTERESTED',
  ATHLETE_NOT_INTERESTED: 'ATHLETE_NOT_INTERESTED',
  ATHLETE_WITHDREW: 'ATHLETE_WITHDREW',
  COMMITTED: 'COMMITTED',
});

const { ATHLETE_OUTCOME, PROGRAMME_INTEREST, RECRUITING_INTELLIGENCE } = OBSERVATION_CATEGORY;
const K = OBSERVATION_KIND;

export const CATEGORY_OF_KIND = Object.freeze({
  [K.POSITIVE_REPLY]: PROGRAMME_INTEREST,
  [K.NEUTRAL_REPLY]: PROGRAMME_INTEREST,
  [K.NEGATIVE_REPLY]: PROGRAMME_INTEREST,
  [K.REQUESTED_FILM]: PROGRAMME_INTEREST,
  [K.REQUESTED_TRANSCRIPT]: PROGRAMME_INTEREST,
  [K.REQUESTED_CALL]: PROGRAMME_INTEREST,
  [K.INTERESTED]: PROGRAMME_INTEREST,
  [K.ROSTER_PLACE_OFFERED]: PROGRAMME_INTEREST,
  [K.FINANCIAL_OFFER]: PROGRAMME_INTEREST,
  [K.DECLINED_ATHLETE]: PROGRAMME_INTEREST,

  [K.POSITION_FILLED]: RECRUITING_INTELLIGENCE,
  [K.POSITION_NEEDED]: RECRUITING_INTELLIGENCE,
  [K.CLASS_FILLED]: RECRUITING_INTELLIGENCE,
  [K.RECRUITING_FUTURE_CLASS]: RECRUITING_INTELLIGENCE,
  [K.ROSTER_COMPLETE]: RECRUITING_INTELLIGENCE,
  [K.NOT_RECRUITING_POSITION]: RECRUITING_INTELLIGENCE,
  [K.OTHER_RECRUITING_INFORMATION]: RECRUITING_INTELLIGENCE,

  [K.ATHLETE_INTERESTED]: ATHLETE_OUTCOME,
  [K.ATHLETE_NOT_INTERESTED]: ATHLETE_OUTCOME,
  [K.ATHLETE_WITHDREW]: ATHLETE_OUTCOME,
  [K.COMMITTED]: ATHLETE_OUTCOME,
});

/** WHERE THE INFORMATION CAME FROM — the actor, not the classifier. */
export const OBSERVATION_SOURCE = Object.freeze({
  COACH_REPLY: 'COACH_REPLY',
  COACH_CALL: 'COACH_CALL',
  ATHLETE: 'ATHLETE',
  OPERATOR: 'OPERATOR',
  PROVIDER: 'PROVIDER',
});

/**
 * HOW THE CLASSIFICATION WAS ARRIVED AT — §I.
 *
 * Recorded from the first row, and the schema is usable with only MANUAL. A
 * model that arrives later writes AI_ASSISTED beside a `classifier_version`,
 * and every row recorded before it keeps saying truthfully that a person
 * decided. Retrofitting this column afterwards would have left every existing
 * row ambiguous between "a person read it" and "an early model guessed".
 */
export const CLASSIFIER_METHOD = Object.freeze({
  MANUAL: 'MANUAL',
  RULE_BASED: 'RULE_BASED',
  AI_ASSISTED: 'AI_ASSISTED',
});

/**
 * WHETHER A HUMAN HAS CHECKED IT.
 *
 * A MANUAL observation is CONFIRMED on arrival — the person recording it is
 * the review. A RULE_BASED or AI_ASSISTED one starts UNREVIEWED and stays
 * there until somebody says otherwise, which is what lets the projection in
 * `recruitingObservations.js` answer "latest REVIEWED state" as §Q asks.
 */
export const REVIEW_STATE = Object.freeze({
  UNREVIEWED: 'UNREVIEWED',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
});

/**
 * CORRECTIONS POINT BACKWARDS — §P, and not in the shape the brief sketched.
 *
 * §P suggests `supersedes_event_id` OR `retracted_by_event_id`. The second
 * cannot be built on an append-only table: writing `retracted_by` onto the OLD
 * row is an UPDATE of history, which is the one thing the trigger forbids and
 * the one thing the design exists to prevent.
 *
 * So both directions are expressed by the NEW row pointing at the old one:
 *
 *   SUPERSEDES   this observation replaces that one — the coach said
 *                "interested", then said "we filled it"
 *   RETRACTS     that observation should never have been recorded — it was
 *                misread, or filed against the wrong programme
 *
 * The difference matters to analytics. A superseded observation WAS TRUE WHEN
 * MADE and belongs in any question about what was believed at the time; a
 * retracted one was never true and belongs in none.
 */
export const CORRECTION = Object.freeze({
  SUPERSEDES: 'SUPERSEDES',
  RETRACTS: 'RETRACTS',
});

const KIND_VALUES = Object.freeze(Object.values(OBSERVATION_KIND));

export const isObservationKind = (k) => KIND_VALUES.includes(k);
export const categoryOf = (k) => CATEGORY_OF_KIND[k] ?? null;
export const isObservationSource = (s) => Object.values(OBSERVATION_SOURCE).includes(s);
export const isClassifierMethod = (m) => Object.values(CLASSIFIER_METHOD).includes(m);
export const isReviewState = (s) => Object.values(REVIEW_STATE).includes(s);
export const isCorrection = (c) => Object.values(CORRECTION).includes(c);

/**
 * STRUCTURED ATTRIBUTES, AND ONLY WHERE THE CLAIM NEEDS THEM — §J.
 *
 * `required` is what the kind MEANS and cannot be inferred: "the position is
 * filled" is not a usable statement without saying WHICH position. `optional`
 * is recorded when a coach states it and left absent otherwise.
 *
 * NOTHING IS DEFAULTED. A missing recruiting class is missing, never "this
 * year" — the same rule the engine applies to evidence, for the same reason.
 */
export const KIND_ATTRIBUTES = Object.freeze({
  [K.POSITION_FILLED]: { required: ['position'], optional: ['recruitingClassYear'] },
  [K.POSITION_NEEDED]: { required: ['position'], optional: ['recruitingClassYear', 'urgency'] },
  [K.NOT_RECRUITING_POSITION]: { required: ['position'], optional: ['recruitingClassYear'] },
  [K.CLASS_FILLED]: { required: ['recruitingClassYear'], optional: [] },
  [K.RECRUITING_FUTURE_CLASS]: { required: ['recruitingClassYear'], optional: ['position'] },
  [K.ROSTER_COMPLETE]: { required: [], optional: ['recruitingClassYear'] },
  [K.OTHER_RECRUITING_INFORMATION]: { required: [], optional: ['position', 'recruitingClassYear'] },
});

export const ATTRIBUTE_RULES = Object.freeze({
  position: (v) => (POSITIONS.includes(v)
    ? null
    : `position must be one of ${POSITIONS.join(', ')}`),
  recruitingClassYear: (v) => (Number.isInteger(v) && v >= 2000 && v <= 2100
    ? null
    : 'recruitingClassYear must be a four-digit year'),
  /**
   * ONLY WHAT A COACH ACTUALLY SAID. §J: "Do not infer unspecified facts." An
   * urgency nobody stated is absent, not LOW.
   */
  urgency: (v) => (['IMMEDIATE', 'THIS_CYCLE', 'NEXT_CYCLE'].includes(v)
    ? null
    : 'urgency must be IMMEDIATE, THIS_CYCLE or NEXT_CYCLE'),
});

/**
 * Validates one observation's attributes against its kind.
 * Returns an array of human-readable problems; empty means valid.
 */
export function validateAttributes(kind, attributes) {
  const spec = KIND_ATTRIBUTES[kind];
  const attrs = attributes ?? {};
  const problems = [];

  if (!spec) {
    // A kind with no attribute spec carries no structured attributes at all.
    const extra = Object.keys(attrs);
    if (extra.length) {
      problems.push(`${kind} takes no structured attributes, but got ${extra.join(', ')}`);
    }
    return problems;
  }

  const allowed = new Set([...spec.required, ...spec.optional]);
  for (const name of spec.required) {
    if (attrs[name] === undefined || attrs[name] === null) {
      problems.push(`${kind} requires ${name}`);
    }
  }
  for (const [name, value] of Object.entries(attrs)) {
    if (!allowed.has(name)) {
      problems.push(`${kind} does not take ${name}`);
      continue;
    }
    if (value === undefined || value === null) continue;
    const rule = ATTRIBUTE_RULES[name];
    const problem = rule ? rule(value) : null;
    if (problem) problems.push(problem);
  }
  return problems;
}
