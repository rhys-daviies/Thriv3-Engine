/**
 * What the athlete wants, as a form answers it.
 *
 * ALL OF THE RULES, NONE OF THE MARKUP - the same split as
 * `contributionIntake.js`, and for the same reason: the question text, the
 * legal values and the payload shape belong in one testable place rather
 * than spread across three event handlers.
 *
 * THE VOCABULARY COMES FROM THE MODEL. The questions, the 1-5 ladder and the
 * helper text are read from `PREFERENCE_FIELDS`, which is the layer's own
 * intake contract. A second copy here is how a form comes to offer a scale
 * the scorer cannot read - exactly how "$40k+/yr" survived as an option long
 * after it stopped meaning anything.
 *
 * THE ONE THING THIS MODULE MUST NEVER DO IS INFER. There is no ability, no
 * GPA and no criterion ranking in this file, and `MAY_NOT_INFER_FROM` names
 * every field a future reader might be tempted to reach for.
 */
import {
  PREFERENCE_FIELDS, PREFERENCE_FIELD_NAMES, PRIORITY_SCALE, ANCHORS,
  readPriority, normalisePriority, MAY_NOT_INFER_FROM,
} from '@shared/matching/v2/athletePreferences.js';

export {
  PREFERENCE_FIELDS, PREFERENCE_FIELD_NAMES, PRIORITY_SCALE, ANCHORS, MAY_NOT_INFER_FROM,
};

/** The five choices, in order, as a renderer wants them. */
export const PRIORITY_CHOICES = Object.freeze(
  [1, 2, 3, 4, 5].map((value) => Object.freeze({ value, label: ANCHORS[value] })),
);

/**
 * The three questions, ready to render.
 *
 * Order is the order they are asked, which the model states; the form does
 * not get to reorder them, because the helper text of one refers to what the
 * others do not cover.
 */
export const PREFERENCE_QUESTIONS = Object.freeze(PREFERENCE_FIELD_NAMES.map((field) => Object.freeze({
  field,
  question: PREFERENCE_FIELDS[field].question,
  helper: PREFERENCE_FIELDS[field].helper,
  choices: PRIORITY_CHOICES,
})));

/**
 * Pull the three answers off a stored player.
 *
 * A row written before A7.12.1 has NULL in all three, which is the truth
 * about it and is what the form must show. NOT a midpoint: `defaultsFrom`
 * gives every other field a display default, and giving these one would put
 * "Moderately important" on screen beside two hundred athletes nobody asked.
 */
export function preferencesFromPlayer(player = null) {
  const out = {};
  for (const field of PREFERENCE_FIELD_NAMES) out[field] = readPriority(player?.[field]);
  return out;
}

/** Record one answer. Selecting the value already selected clears it back to unanswered. */
export function setPreference(form, field, value) {
  if (!PREFERENCE_FIELD_NAMES.includes(field)) return form;
  const next = readPriority(value);
  return { ...form, [field]: form[field] === next ? null : next };
}

/** The first thing wrong with the answers, or null. */
export function preferenceError(form) {
  for (const field of PREFERENCE_FIELD_NAMES) {
    const r = normalisePriority(field, form?.[field]);
    if (!r.ok) return r.error;
  }
  return null;
}

export const preferencesValid = (form) => preferenceError(form) === null;

/** How many of the three have been answered. */
export const answeredCount = (form) => PREFERENCE_FIELD_NAMES.filter((f) => readPriority(form?.[f]) !== null).length;

/**
 * Whether V2 can describe this athlete's preferences at all.
 *
 * NOT a gate on creating the athlete. An athlete with no stated preferences
 * is a complete, rankable athlete - Opportunity simply builds itself from
 * measured evidence and says so. This is the flag a V2 surface uses to say
 * "these recommendations do not yet reflect what you want", which is a
 * different and much smaller claim than "this record is invalid".
 */
export const preferencesComplete = (player) => answeredCount(preferencesFromPlayer(player)) === PREFERENCE_FIELD_NAMES.length;

/**
 * The columns a save sends.
 *
 * ALWAYS ALL THREE, and always explicitly - an unanswered question must
 * travel as `null`, not be omitted. An omitted key is "do not change this",
 * which on an edit would silently keep an answer the operator just cleared.
 */
export function preferencePayload(form) {
  const err = preferenceError(form);
  if (err) throw new Error(err);
  const out = {};
  for (const field of PREFERENCE_FIELD_NAMES) out[field] = readPriority(form?.[field]);
  return out;
}

/** What the V2 athlete builder wants: the same three values, camelCased. */
export function preferenceProfile(player) {
  const f = preferencesFromPlayer(player);
  return {
    competitiveLevelPriority: f.competitive_level_priority,
    playingOpportunityPriority: f.playing_opportunity_priority,
    academicStrengthPriority: f.academic_strength_priority,
  };
}

/** A short human label for a profile screen. NULL reads as unanswered, never as 3. */
export function preferenceSummary(player) {
  return PREFERENCE_QUESTIONS.map(({ field, question }) => {
    const value = readPriority(player?.[field]);
    return {
      field,
      question,
      label: SHORT_LABEL[field],
      value,
      text: value === null ? 'Not answered' : `${ANCHORS[value]} (${value} of ${PRIORITY_SCALE.max})`,
      answered: value !== null,
    };
  });
}

/** The heading a profile row carries. The question itself is too long for a definition list. */
export const SHORT_LABEL = Object.freeze({
  competitive_level_priority: 'Competitive level',
  playing_opportunity_priority: 'Playing opportunity',
  academic_strength_priority: 'Academic strength',
});
