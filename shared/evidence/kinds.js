/**
 * The evidence registry: every kind of thing Thriv3 can say about a programme,
 * and what it is permitted to claim.
 *
 * This file is the single place the FACT/SIGNAL boundary is decided. A
 * generator cannot choose its own tier — `defineEvidence` reads it from here —
 * so the distinction cannot be lost by a generator author copying a nearby
 * block, which is exactly how these distinctions are normally lost.
 *
 * FACT means the underlying rows assert it directly for a named season: a
 * roster page listed these players, a results page recorded this round. It may
 * be stated plainly to a coach.
 *
 * SIGNAL means somebody had to interpret something to get there — a projection,
 * a trend, an eligibility assumption, a share of a denominator we only mostly
 * trust. It may only ever be stated in hedged language, and `renderFact` in
 * render.js refuses to touch it.
 *
 * The registry is also where a new evidence type is added. Adding one is a row
 * here plus a generator; nothing in selection, rendering or logging needs to
 * know it exists in advance.
 */

import { applyFreshness } from './freshness.js';

export const TIERS = Object.freeze({ FACT: 'FACT', SIGNAL: 'SIGNAL' });

export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });

/**
 * What period a piece of evidence is a claim ABOUT.
 *
 * Two separate jobs, which is why it lives in the registry rather than being
 * inferred from the copy:
 *
 *   Freshness. "You currently have one New Zealander on the roster" is only
 *   true while the roster we read is still the roster they have. "You've had
 *   one come through since 2022" names its own window and an old source is the
 *   point of it. Applying one staleness rule to both would either suppress
 *   history for being historical or let a six-month-old scrape assert a
 *   present-tense fact.
 *
 *   Tense. A CURRENT kind must read as present, a HISTORICAL one as a span,
 *   a PROJECTED one as hedged about a season nobody has played. That is
 *   asserted in the tests against this field, after a renderer wrote "come
 *   through the programme since 2026" about an unplayed season.
 */
export const TEMPORALITY = Object.freeze({
  /** Asserts the squad as it stands now. Freshness applies in full. */
  CURRENT: 'CURRENT',
  /** Names its own seasons; an old source is expected. Exempt from freshness. */
  HISTORICAL: 'HISTORICAL',
  /** About a season not yet played. Always hedged; freshness downgrades it. */
  PROJECTED: 'PROJECTED',
  /** Not roster-derived at all — a title, a major, a coach record. Exempt. */
  STATIC: 'STATIC',
});

/**
 * How well a kind works as the FIRST line of an email to a stranger.
 *
 * A PRESENTATION property, deliberately separate from strength, confidence,
 * tier and priority — "strong evidence" and "good opening sentence" are not
 * the same judgement, and treating them as one is what produced
 *
 *   "I noticed you've got three defenders graduating in 2027, so I thought
 *    Ryan could be worth putting on your radar."
 *
 * as the opening line to a coach who does not yet know who Ryan is. The
 * evidence is good. Its placement was wrong.
 *
 * The test each classification below is answered against: can this sentence
 * stand as the first thing a stranger reads, before the athlete exists in
 * their mind? A useful tell is that several kinds NAME THE ATHLETE in their
 * reasoning, which is only coherent after the introduction.
 *
 * Nothing here affects what is selected or in what order. Selection asks what
 * is worth mentioning; this asks where it reads best.
 */
export const LEAD_SUITABILITY = Object.freeze({
  /** Explains why we wrote to THIS coach, needing no knowledge of the athlete. */
  NATURAL_LEAD: 'NATURAL_LEAD',
  /** Real evidence, but it lands after the athlete has been introduced. */
  CONTEXTUAL: 'CONTEXTUAL',
  /** Supports an argument someone else opened; never carries one alone. */
  SUPPORT_ONLY: 'SUPPORT_ONLY',
});

/** Ordered worst to best, so a minimum can be compared numerically. */
const CONFIDENCE_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function confidenceAtLeast(actual, minimum) {
  return (CONFIDENCE_RANK[actual] ?? -1) >= (CONFIDENCE_RANK[minimum] ?? 0);
}

/**
 * `dedupeGroup` is what stops an email saying the same thing three ways.
 *
 * A programme with a New Zealander on the current roster almost always also
 * has NZ history and a high international share, and all three sentences carry
 * one idea. Selection keeps the strongest member of each group and drops the
 * rest — see select.js. Groups are deliberately coarse: the failure being
 * engineered against is an email that reads like a list of database queries.
 *
 * `emailEligible: false` marks intelligence that is real and useful for
 * ranking programmes but has no business in a first approach to a coach.
 * Transfer behaviour is the clearest case: knowing a programme fills holes
 * from the portal helps us decide whether to write at all, and telling them we
 * know it helps nobody.
 */
export const EVIDENCE_KINDS = Object.freeze({
  // --- international connection -------------------------------------------
  HISTORICAL_SAME_COUNTRY: {
    leadSuitability: LEAD_SUITABILITY.NATURAL_LEAD,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 88,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  CURRENT_SAME_COUNTRY: {
    leadSuitability: LEAD_SUITABILITY.NATURAL_LEAD,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 82,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  HISTORICAL_SAME_REGION: {
    leadSuitability: LEAD_SUITABILITY.NATURAL_LEAD,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    // Deliberately below both same-country kinds. A shared region is a weaker
    // claim on a coach's attention than a compatriot, and ranking it level
    // would let the broader, blander sentence win on a tie.
    baseStrength: 70,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  INTERNATIONAL_ROSTER: {
    leadSuitability: LEAD_SUITABILITY.CONTEXTUAL,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 52,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  /**
   * --- recruiting history -------------------------------------------------
   *
   * These three say something the roster-derived kinds above cannot. A roster
   * shows that a New Zealander was HERE; an arrival shows that a New Zealander
   * CAME here, in a named intake, between two rosters we both hold. The second
   * is the checkable version of the first, and it is the one a coach recognises
   * as a decision somebody made rather than a fact about a list.
   *
   * They share `international-connection` with everything above, so exactly one
   * survives dedupe. The strength bands are deliberately non-overlapping with
   * the existing kinds' dynamic ranges — HISTORICAL_SAME_COUNTRY reaches 94 and
   * HISTORICAL_SAME_REGION reaches 76 — so the ordering is a property of the
   * numbers rather than of the order the generators happen to run in:
   *
   *   COACH_ARRIVAL_SAME_COUNTRY      99-100
   *   ARRIVAL_SAME_COUNTRY_POSITION   95-98
   *   HISTORICAL_SAME_COUNTRY         88-94   (unchanged)
   *   CURRENT_SAME_COUNTRY            82      (unchanged)
   *   ARRIVAL_SAME_REGION_POSITION    78-80
   *   HISTORICAL_SAME_REGION          70-76   (unchanged)
   *   INTERNATIONAL_ROSTER            52      (unchanged)
   *   INTERNATIONAL_SHARE             44      (unchanged)
   *
   * Men's soccer only at launch. The generators refuse any other sport
   * outright: 9.7% of women's arrivals carry a nationality flag against 29.1%
   * of men's, and roster data cannot separate under-recording from a smaller
   * international share.
   */

  /**
   * The current coach's own observed recruiting from this country.
   *
   * The strongest thing in the group because it is the only one addressed to
   * the person reading it. Requires three attributable transitions, which is a
   * separate floor from the programme's — a coach appointed last summer has a
   * programme history behind them and no record of their own.
   */
  COACH_ARRIVAL_SAME_COUNTRY: {
    leadSuitability: LEAD_SUITABILITY.NATURAL_LEAD,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 99,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },

  /** An arrival from the athlete's country, at the athlete's position. */
  ARRIVAL_SAME_COUNTRY_POSITION: {
    leadSuitability: LEAD_SUITABILITY.NATURAL_LEAD,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 95,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },

  /**
   * An arrival from the athlete's part of the world, at their position.
   *
   * Above HISTORICAL_SAME_REGION because it is an intake rather than a roster
   * line, and below every same-country kind because a shared region is a weaker
   * claim on a coach's attention than a compatriot.
   */
  ARRIVAL_SAME_REGION_POSITION: {
    leadSuitability: LEAD_SUITABILITY.NATURAL_LEAD,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 78,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },

  // A share, not a count: it depends on the denominator being a complete
  // roster, which is a judgement about our own scrape rather than a fact about
  // the programme.
  INTERNATIONAL_SHARE: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.CURRENT,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 44,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },

  // --- roster opportunity --------------------------------------------------
  POSITION_GRADUATION: {
    leadSuitability: LEAD_SUITABILITY.CONTEXTUAL,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'roster',
    dedupeGroup: 'position-opportunity',
    baseStrength: 76,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  // Split from the count above on purpose. Who is leaving is a roster fact;
  // which of them was a starter in a season that has not been played is a
  // projection carried forward from an earlier one.
  POSITION_GRADUATION_STARTERS: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.PROJECTED,
    category: 'roster',
    dedupeGroup: 'position-opportunity',
    baseStrength: 68,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  SQUAD_GRADUATION: {
    leadSuitability: LEAD_SUITABILITY.CONTEXTUAL,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'roster',
    dedupeGroup: 'squad-turnover',
    baseStrength: 48,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  // Internal, deliberately. A bare count is the factual anchor beneath the
  // depth story and is not an argument on its own: Air Force carries eleven
  // defenders, and "your current roster carries eleven defenders" led an email
  // to a coach as a reason to sign a twelfth. Where the group IS thin,
  // POSITION_GROUP_SCARCITY says so in the form that means something.
  POSITION_GROUP_SIZE: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'roster',
    dedupeGroup: 'position-depth',
    baseStrength: 46,
    emailEligible: false,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  POSITION_GROUP_SCARCITY: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.CURRENT,
    category: 'roster',
    dedupeGroup: 'position-depth',
    baseStrength: 58,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  RETURNING_POSITION_DEPTH: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.PROJECTED,
    category: 'roster',
    dedupeGroup: 'position-depth',
    baseStrength: 54,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  ELIGIBILITY_CLIFF: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.PROJECTED,
    category: 'roster',
    dedupeGroup: 'position-opportunity',
    baseStrength: 50,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },

  // --- programme record ----------------------------------------------------
  CONFERENCE_TITLE: {
    leadSuitability: LEAD_SUITABILITY.CONTEXTUAL,
    // Composition metadata, orthogonal to suitability: a congratulation is
    // its own sentence wherever it lands and is never gathered into another
    // clause. Placed late, after the relevance reasoning, where it reads as
    // attention paid rather than as flattery before an ask.
    recognition: true,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.STATIC,
    category: 'performance',
    dedupeGroup: 'programme-success',
    baseStrength: 80,
    emailEligible: true,
    minConfidence: CONFIDENCE.HIGH,
  },
  POSTSEASON_RESULT: {
    leadSuitability: LEAD_SUITABILITY.CONTEXTUAL,
    // Composition metadata, orthogonal to suitability: a congratulation is
    // its own sentence wherever it lands and is never gathered into another
    // clause. Placed late, after the relevance reasoning, where it reads as
    // attention paid rather than as flattery before an ask.
    recognition: true,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.STATIC,
    category: 'performance',
    dedupeGroup: 'programme-success',
    baseStrength: 74,
    emailEligible: true,
    minConfidence: CONFIDENCE.HIGH,
  },
  PROGRAM_MOMENTUM: {
    leadSuitability: LEAD_SUITABILITY.CONTEXTUAL,
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.STATIC,
    category: 'performance',
    dedupeGroup: 'programme-success',
    baseStrength: 56,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },

  // --- people and academics ------------------------------------------------
  COACH_CONTEXT: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.STATIC,
    category: 'coach',
    dedupeGroup: 'coach',
    baseStrength: 45,
    emailEligible: true,
    minConfidence: CONFIDENCE.MEDIUM,
  },
  ACADEMIC_FIT: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.STATIC,
    category: 'academic',
    dedupeGroup: 'academic',
    baseStrength: 78,
    emailEligible: true,
    minConfidence: CONFIDENCE.HIGH,
  },

  // --- internal only -------------------------------------------------------
  /**
   * How many arrived at this position, per intake. SHADOW MODE.
   *
   * `emailEligible: false`, deliberately and for a reason that is about the
   * sentence rather than about the data. "You've added a defender in each of
   * the last four intakes" is a true and checkable observation that sits one
   * short step from "so you'll need another" — a claim about a coach's future
   * intentions that no roster row supports, and the exact overstatement the CTA
   * was corrected for. It is generated, ranked, logged and visible in the
   * operator panel so that real examples can be read before anything is
   * licensed; it cannot reach an email, because selection separates
   * email-ineligible evidence before composition ever sees it.
   *
   * `leadSuitability` is inert while that flag is false — structures.js only
   * ever reads it for SELECTED evidence — and is set to the most conservative
   * value so that promoting the kind later is a deliberate decision rather than
   * an accident of what was already written here.
   */
  POSITION_INTAKE_HISTORY: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'internal',
    dedupeGroup: 'position-intake',
    baseStrength: 60,
    emailEligible: false,
    minConfidence: CONFIDENCE.MEDIUM,
  },

  // Generated, ranked and logged like everything else so that it is available
  // the day we can measure it, but never rendered into an email.
  TRANSFER_BEHAVIOUR: {
    leadSuitability: LEAD_SUITABILITY.SUPPORT_ONLY,
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.CURRENT,
    category: 'internal',
    dedupeGroup: 'transfer',
    baseStrength: 40,
    emailEligible: false,
    minConfidence: CONFIDENCE.MEDIUM,
  },
});

export const EVIDENCE_KIND_NAMES = Object.freeze(Object.keys(EVIDENCE_KINDS));

/**
 * What to call each kind in front of a person.
 *
 * The registry keys are shouted constants because they are grouping keys in a
 * database; an operator deciding which angle to lead with should not have to
 * read HISTORICAL_SAME_COUNTRY to work out that it means the programme has
 * recruited from this athlete's country before.
 */
export const KIND_LABELS = Object.freeze({
  HISTORICAL_SAME_COUNTRY: 'Historical same-country recruiting',
  CURRENT_SAME_COUNTRY: 'Compatriot on the current roster',
  HISTORICAL_SAME_REGION: 'Historical same-region recruiting',
  INTERNATIONAL_ROSTER: 'International roster',
  INTERNATIONAL_SHARE: 'International share of squad',
  POSITION_GRADUATION: 'Graduating at this position',
  POSITION_GRADUATION_STARTERS: 'Graduating starters at this position',
  SQUAD_GRADUATION: 'Squad-wide graduation',
  POSITION_GROUP_SIZE: 'Position group size',
  POSITION_GROUP_SCARCITY: 'Thin at this position',
  RETURNING_POSITION_DEPTH: 'Returning depth at this position',
  ELIGIBILITY_CLIFF: 'Eligibility running out',
  CONFERENCE_TITLE: 'Conference title',
  POSTSEASON_RESULT: 'Postseason run',
  PROGRAM_MOMENTUM: 'Programme momentum',
  COACH_CONTEXT: 'Coach tenure',
  ACADEMIC_FIT: 'Intended major offered',
  TRANSFER_BEHAVIOUR: 'Transfer recruiting behaviour',
  COACH_ARRIVAL_SAME_COUNTRY: 'Same-country arrival under this coach',
  ARRIVAL_SAME_COUNTRY_POSITION: 'Same-country arrival at this position',
  ARRIVAL_SAME_REGION_POSITION: 'Same-region arrival at this position',
  POSITION_INTAKE_HISTORY: 'Intake history at this position',
});

/** Kinds whose truth depends on the roster still being the current one. */
export const FRESHNESS_SENSITIVE = Object.freeze(
  Object.entries(EVIDENCE_KINDS)
    .filter(([, spec]) => spec.temporality === TEMPORALITY.CURRENT
      || spec.temporality === TEMPORALITY.PROJECTED)
    .map(([kind]) => kind),
);

export function kindLabel(kind) {
  return KIND_LABELS[kind] || kind;
}

export function kindSpec(kind) {
  const spec = EVIDENCE_KINDS[kind];
  if (!spec) throw new Error(`Unknown evidence kind: ${kind}`);
  return spec;
}

/**
 * Builds one evidence object.
 *
 * The tier, category, dedupe group and email eligibility are taken from the
 * registry and CANNOT be passed in — that is the whole mechanism. A caller may
 * adjust `strength` (selection is meant to be tunable from engagement data)
 * and must supply provenance, but cannot promote a projection to a fact by
 * writing `tier: 'FACT'` in a generator.
 *
 * Frozen because a later stage editing `tier` in place would defeat the same
 * guarantee by a different route.
 */
export function defineEvidence(kind, {
  strength = null,
  confidence = CONFIDENCE.MEDIUM,
  data = {},
  season = null,
  source = null,
  sourceUrl = null,
  emailEligible = null,
  freshness = null,
} = {}) {
  const spec = kindSpec(kind);
  if (!Object.values(CONFIDENCE).includes(confidence)) {
    throw new Error(`Unknown confidence "${confidence}" for evidence ${kind}`);
  }
  if (!source) throw new Error(`Evidence ${kind} must declare a source`);

  // Applied HERE rather than in each generator, for the same reason the tier
  // is read from the registry: a policy every generator has to remember to
  // call is a policy one of them will eventually not call. Returning null
  // suppresses the evidence outright — see applyFreshness.
  const effective = freshness ? applyFreshness(spec, confidence, freshness) : confidence;
  if (effective === null) return null;

  return Object.freeze({
    kind,
    tier: spec.tier,
    temporality: spec.temporality,
    // What the claim rests on, carried so the operator view can explain a
    // downgrade and the log can record it.
    freshness: freshness ? Object.freeze({ ...freshness }) : null,
    confidenceBeforeFreshness: confidence,
    category: spec.category,
    dedupeGroup: spec.dedupeGroup,
    strength: clampStrength(strength ?? spec.baseStrength),
    confidence: effective,
    data: Object.freeze({ ...data }),
    season,
    source,
    // Nothing populates this yet — the roster tables carry source_roster_url
    // per row but the aggregates here span many rows and several seasons, so
    // there is rarely one URL to name. Carried in the shape from the start so
    // adding it later is a generator change rather than a schema change.
    sourceUrl,
    emailEligible: emailEligible === null ? spec.emailEligible : (emailEligible && spec.emailEligible),
  });
}

function clampStrength(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function isFact(ev) {
  return ev?.tier === TIERS.FACT;
}

export function isSignal(ev) {
  return ev?.tier === TIERS.SIGNAL;
}
