/**
 * Ordering evidence by how much it bears on the decision.
 *
 * PURE PRIMITIVES ONLY. Nothing here selects, caps, dedupes or renders — it
 * answers "which of these two matters more" and stops. The policy that turns an
 * ordering into a handful of top reasons is a separate thing and is not built
 * yet, deliberately: the ordering should be read against real data before slot
 * rules hide it.
 *
 * WHY NOT REUSE `priorityOf` FROM select.js
 *
 * Because it answers a different question. `priorityOf` is
 * `strength + FACT_BONUS + CATEGORY_PRIOR`, where CATEGORY_PRIOR adds 8 to
 * anything international — a deliberate thumb on the scale for EMAIL, where a
 * shared nationality is a genuinely good reason to be writing to someone. It is
 * the wrong thumb for a decision, where a vacancy at the athlete's position
 * matters more than a compatriot three seasons ago.
 *
 * Measured, not assumed: across 100 real programmes `strength` barely moves
 * within a kind — most kinds show zero variance and the widest is
 * POSITION_GRADUATION at 75-84. It is an ordering of KINDS, not a measurement
 * of an instance, which is exactly why it belongs at the END of this comparator
 * rather than the front.
 *
 * NOT USED HERE, and each for a reason: CATEGORY_PRIOR and FACT_BONUS (email
 * weighting), SLOT_FLOORS (email slot gating), and the outbound ROLE (where a
 * sentence reads best in a letter). Those are all properties of how an email is
 * written.
 */

import { EVIDENCE_KINDS, DECISION_CLASS, CONFIDENCE, kindSpec } from './kinds.js';
import { SPECIFICITY } from '../recruiting/patterns.js';

/**
 * Decision classes, most to least decision-bearing.
 *
 * An OPENING beats a PATHWAY beats a FIT beats CONTEXT, and this ordering is
 * absolute: no amount of specificity, confidence or strength promotes an item
 * across a class. That is the point of having classes at all — it is what stops
 * a 97%-frequency programme measurement outranking the one fact that says
 * somebody is leaving.
 */
const CLASS_ORDER = Object.freeze([
  DECISION_CLASS.OPENING,
  DECISION_CLASS.PATHWAY,
  DECISION_CLASS.FIT,
  DECISION_CLASS.CONTEXT,
]);

/**
 * How narrow a population the evidence was cut to, least to most specific.
 *
 * The middle of this ladder IS `patterns.SPECIFICITY`, in its own declared
 * order — that vocabulary already exists, the arrival kinds already carry a
 * value from it in `data.provenance.specificity`, and its own comment says it
 * was recorded so that a later phase could reason about "New Zealand defenders"
 * being a stronger thing to have observed than "internationals". This is that
 * phase. Re-deriving a parallel scale would leave two answers to one question.
 *
 * Two values are added because the recruiting vocabulary does not cover the
 * whole registry, and both extensions are named for what they are:
 *
 *   ATHLETE          matched on something about this athlete that is not a
 *                    recruiting axis — an intended major, a class year. Above
 *                    GENERAL because it is about them, below POSITION because
 *                    it says nothing about the competition they would join.
 *   ORIGIN, and
 *   ORIGIN_POSITION  the freshman cohort cuts on international-vs-domestic,
 *                    which is neither a country nor a region. Coarser than
 *                    either, so ORIGIN sits below REGION; ORIGIN_POSITION sits
 *                    directly above POSITION because it adds a real second axis
 *                    without narrowing to a place.
 *
 * The placement of ORIGIN_POSITION against REGION is a judgement — two coarse
 * axes against one finer one — and is flagged in the Stage D report rather than
 * buried here.
 */
const SPECIFICITY_ORDER = Object.freeze([
  SPECIFICITY.GENERAL,
  'ATHLETE',
  'ORIGIN',
  SPECIFICITY.POSITION,
  'ORIGIN_POSITION',
  SPECIFICITY.REGION,
  SPECIFICITY.COUNTRY,
  SPECIFICITY.REGION_POSITION,
  SPECIFICITY.COUNTRY_POSITION,
  SPECIFICITY.COACH_POSITION,
  SPECIFICITY.COACH_REGION,
  SPECIFICITY.COACH_COUNTRY,
  SPECIFICITY.COACH_REGION_POSITION,
  SPECIFICITY.COACH_COUNTRY_POSITION,
]);

const CONFIDENCE_ORDER = Object.freeze([CONFIDENCE.LOW, CONFIDENCE.MEDIUM, CONFIDENCE.HIGH]);

/** Higher is more decision-bearing. Unknown classes sort last, not first. */
export function decisionClassRank(evidence) {
  const cls = evidence?.decisionClass ?? kindSpec(evidence?.kind)?.decisionClass;
  const i = CLASS_ORDER.indexOf(cls);
  return i === -1 ? -1 : CLASS_ORDER.length - 1 - i;
}

/** Higher is more confident. */
export function confidenceRank(evidence) {
  return CONFIDENCE_ORDER.indexOf(evidence?.confidence);
}

/** The name of the axis set, from whichever source actually knows it. */
export function specificityKey(evidence) {
  if (!evidence?.kind) return SPECIFICITY.GENERAL;

  /**
   * The arrival kinds already computed this and it is instance-level.
   *
   * `COACH_ARRIVAL_SAME_COUNTRY` carries a position only when every supporting
   * arrival shares one, so its axes genuinely differ between two programmes.
   * Reading the registry instead would report the same specificity for both.
   */
  const fromProvenance = evidence.data?.provenance?.specificity;
  if (fromProvenance && SPECIFICITY_ORDER.includes(fromProvenance)) return fromProvenance;

  /**
   * A declared cohort is the APPLIED one, never the asked one, and it is read
   * by VALUE rather than by key.
   *
   * `freshmanProfile` relaxes a narrowing it finds too thin, and 160 of 219
   * real athlete-programme pairs relax. Taking the axes from the registry would
   * claim position+origin for a ladder actually built over one axis or none —
   * wrong in the majority case, and wrong in the flattering direction.
   *
   * Two things this used to get wrong, and both came from asking whether a KEY
   * existed rather than whether a VALUE did. `{ country, coach, position: null }`
   * satisfied `'position' in cohort`, so it entered here — and then only
   * position and origin were read, so the country and coach it actually names
   * were discarded and it resolved GENERAL. Reading every populated axis fixes
   * both: a null is not an axis, and an axis is not only position or origin.
   *
   * `excludingCountry` is deliberately not an axis. It records the country a
   * region item left OUT, which narrows nothing.
   */
  const cohort = evidence.describes?.cohort;
  if (cohort) return axesToKey(COHORT_AXES.filter((axis) => cohort[axis]));

  return axesToKey(kindSpec(evidence.kind).specificityAxes ?? []);
}

/**
 * The cohort keys that name a real narrowing, most to least place-like.
 *
 * Order is irrelevant to the result — `axesToKey` reads them by name — but the
 * list is the allowlist: anything else on a cohort object is descriptive rather
 * than an axis, and must not widen or narrow a reading.
 */
const COHORT_AXES = Object.freeze(['country', 'region', 'origin', 'position', 'coach']);

/** Higher is more specific. Unrecognised keys sort as GENERAL, never above it. */
export function specificityRank(evidence) {
  const i = SPECIFICITY_ORDER.indexOf(specificityKey(evidence));
  return i === -1 ? 0 : i;
}

/**
 * Declared axes to a name on the ladder above.
 *
 * A coach axis QUALIFIES another axis rather than being one. The vocabulary has
 * no bare COACH — every entry pairs it with a place or a position — because
 * knowing which coach did the recruiting narrows nothing on its own; it says
 * who, not who to. This used to map a lone coach to COACH_POSITION, inventing a
 * position axis the evidence never had, which would have promoted a
 * programme-wide coach-tenure item nine rungs up the ladder.
 */
function axesToKey(axes = []) {
  const has = (a) => axes.includes(a);
  const place = has('country') ? 'COUNTRY' : has('region') ? 'REGION' : has('origin') ? 'ORIGIN' : null;
  const parts = [place, has('position') ? 'POSITION' : null].filter(Boolean);
  let key = parts.length ? parts.join('_') : (has('athlete') ? 'ATHLETE' : SPECIFICITY.GENERAL);
  if (has('coach') && key !== SPECIFICITY.GENERAL) key = `COACH_${key}`;
  return SPECIFICITY_ORDER.includes(key) ? key : SPECIFICITY.GENERAL;
}

/**
 * Order two pieces of evidence by how much they bear on the decision.
 *
 * Negative when `a` should be shown first, so it drops straight into `sort`.
 *
 * POLARITY IS NOT CONSULTED, deliberately.
 *
 * A comparator that made POSITIVE beat CAUTION would encode "good news first"
 * as an ordering fact, and a caution that loses to four positives is a caution
 * nobody reads. The eventual policy reserves a slot for cautions instead, which
 * is a selection decision and not a sorting one — so this stays a total order
 * over everything and the policy above it decides what gets shown. It also
 * keeps NEUTRAL evidence sortable for the deeper panel, which it must be:
 * neutral evidence is browsable, and being browsable is not the same as being
 * a reason to choose the programme.
 */
export function compareEvidence(a, b) {
  const byClass = decisionClassRank(b) - decisionClassRank(a);
  if (byClass) return byClass;

  const bySpecificity = specificityRank(b) - specificityRank(a);
  if (bySpecificity) return bySpecificity;

  const byConfidence = confidenceRank(b) - confidenceRank(a);
  if (byConfidence) return byConfidence;

  // Last, and only here. See the note at the top of this file on why strength
  // cannot carry the ordering itself.
  const byStrength = (b.strength ?? 0) - (a.strength ?? 0);
  if (byStrength) return byStrength;

  /**
   * A stable, data-independent final tie-break.
   *
   * Kind name, because it is the only property of a piece of evidence that is
   * both always present and independent of the database. Sorting on insertion
   * order would make the display depend on generator order, and on query order
   * beneath that — the sort would be reproducible until somebody reordered a
   * list for an unrelated reason.
   */
  return String(a.kind).localeCompare(String(b.kind));
}

/** A new array in decision order. Does not mutate its input. */
export function rankEvidence(evidence = []) {
  return [...evidence].sort(compareEvidence);
}

/** Every kind's ranking metadata, for reports and tests. */
export function rankingMetadata() {
  return Object.fromEntries(Object.entries(EVIDENCE_KINDS).map(([kind, spec]) => [kind, {
    decisionClass: spec.decisionClass,
    polarity: spec.polarity,
    specificityAxes: spec.specificityAxes,
  }]));
}
