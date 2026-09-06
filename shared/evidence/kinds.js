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
 * What a piece of evidence is FOR, when the question is whether this athlete
 * should go to this programme.
 *
 * Separate from `category`, which groups by SUBJECT (international, roster,
 * academic) and drives dedupe and family caps. The two cut across each other:
 * COACH_ARRIVAL_SAME_COUNTRY and INTERNATIONAL_SHARE share a category and are
 * not remotely the same kind of reason. Separate from `strength`, which is an
 * email-ordering constant with a deliberate international thumb on the scale —
 * right for deciding what to open a letter with, wrong for deciding where to
 * go.
 *
 * Ranking metadata only. Nothing in selection, rendering or logging reads it.
 */
export const DECISION_CLASS = Object.freeze({
  /** A plausible place for this athlete, in their arrival window. */
  OPENING: 'OPENING',
  /** How this programme has treated players meaningfully like this one. */
  PATHWAY: 'PATHWAY',
  /** Makes the programme sensible without being an opening or a pathway. */
  FIT: 'FIT',
  /** True and useful when reading a programme; rarely a reason to choose it. */
  CONTEXT: 'CONTEXT',
});

export const DECISION_CLASS_KEYS = Object.freeze(Object.keys(DECISION_CLASS));

/**
 * Which way a piece of evidence argues.
 *
 * POSITIVE is claimed only where the GENERATOR ITSELF establishes the direction
 * — by refusing to fire when the reading is unfavourable. Three do exactly
 * that: `returningPositionDepth` returns null above three returners,
 * `positionGroupScarcity` above an 18% share, `programMomentum` on anything but
 * a rise. Where the generator emits a measurement in either direction, the
 * honest label is NEUTRAL, whatever the number happens to say today.
 *
 * That is why the four Philosophy measurements are NEUTRAL. A ladder is not
 * favourable for existing; it is favourable or not depending on what it says,
 * and nothing here has yet been licensed to make that call.
 *
 * CAUTION is declared and unused. No existing kind becomes one by
 * reinterpretation — the unfavourable readings are currently deleted inside
 * their generators, and recovering them is a new kind rather than an inverted
 * flag.
 */
export const POLARITY = Object.freeze({
  POSITIVE: 'POSITIVE',
  NEUTRAL: 'NEUTRAL',
  CAUTION: 'CAUTION',
});

export const POLARITY_KEYS = Object.freeze(Object.keys(POLARITY));

/**
 * The places a piece of evidence can be shown, each with its own licence.
 *
 * A single boolean — `emailEligible`, retired in H3 — answered for three
 * audiences and had already run out. POSITION_GROUP_SIZE was the proof: it sits
 * in the `roster` category, it has rendered copy, and it is still barred from
 * an email — a third state the boolean could not hold, recorded nowhere and
 * recoverable only by reading the comment beside it.
 *
 * Reading a claim is not making one. An operator inspecting what we know about
 * a programme is a different act from asserting it to a coach, and the two have
 * never needed the same permission.
 */
export const SURFACES = Object.freeze({
  /** The operator's own view. Inspection, not assertion. */
  OPERATOR_EVIDENCE: 'OPERATOR_EVIDENCE',
  /** Why a programme ranked where it did. Treated as a real claim surface. */
  MATCHING_SUMMARY: 'MATCHING_SUMMARY',
  /** A sentence a coach reads. The strictest surface. */
  OUTREACH: 'OUTREACH',
});

export const SURFACE_KEYS = Object.freeze(Object.keys(SURFACES));

/**
 * What a surface may do with a piece of evidence.
 *
 * QUALIFIED is the grade the boolean could not express, and the reason this
 * enum exists rather than a second flag: a historical measurement is safe to
 * state only while it carries the window it was measured over. "First-year
 * defenders took meaningful minutes" and "across the seasons we can measure,
 * first-year defenders took meaningful minutes" are the same evidence and
 * different claims.
 *
 * Nothing reads QUALIFIED yet — no kind is granted it in this step. It is
 * defined now so that granting one later is a registry edit rather than a
 * change to the shape every surface already depends on.
 */
export const PERMISSION = Object.freeze({
  /** May be rendered as written. */
  ALLOWED: 'ALLOWED',
  /** May be rendered only through a path that states its qualification. */
  QUALIFIED: 'QUALIFIED',
  /** Never reaches this surface, and the surface may not offer it. */
  DENIED: 'DENIED',
});

/**
 * Ordered least to most permissive, so narrowing can be compared numerically.
 *
 * The order is the whole mechanism for the caller rule below: a caller may move
 * a permission DOWN this list and never up.
 */
const PERMISSION_RANK = Object.freeze({ DENIED: 0, QUALIFIED: 1, ALLOWED: 2 });

/**
 * The permissions a kind carries when the registry does not say otherwise.
 *
 * OUTREACH IS DENIED BY DEFAULT AND EVERY KIND DECLARES IT ANYWAY. The default
 * is the fail-closed floor; the completeness check below requires an explicit
 * grade for all 26, because a new kind reaching a coach's inbox because
 * somebody forgot to think about it is the failure this whole surface exists
 * to prevent. Both together: silence if it is missed, and it cannot be missed.
 *
 * It used to be derived from `emailEligible`, which meant a boolean written for
 * one audience decided a licence for another. H3 retired that: the grade is
 * declared, not inferred, and nothing else may narrow or widen it.
 *
 * OPERATOR_EVIDENCE is ALLOWED for every existing kind — all of them are
 * already visible in the operator panel, internal ones included, so granting
 * less would be a behavioural change disguised as a default.
 *
 * MATCHING_SUMMARY is DENIED for everything, and licensed kind by kind.
 */
function defaultPermissions() {
  return Object.freeze({
    OPERATOR_EVIDENCE: PERMISSION.ALLOWED,
    MATCHING_SUMMARY: PERMISSION.DENIED,
    OUTREACH: PERMISSION.DENIED,
  });
}

/**
 * The registry's permissions for a kind, explicit entry winning over the
 * derived default. No kind declares one yet; the lookup exists so that the
 * first one to do so needs no change here.
 */
export function permissionsFor(kind) {
  const spec = kindSpec(kind);
  return spec.permissions ? Object.freeze({ ...defaultPermissions(), ...spec.permissions })
    : defaultPermissions();
}

/**
 * Applies a caller's request to the registry's grant, keeping the stricter.
 *
 * Three surfaces, three grades, one rule. A generator may decide its evidence is
 * weaker than its kind normally allows — a thin cohort, an unreadable season —
 * and say so. It may never decide the opposite: a registry DENIED cannot be
 * argued up to ALLOWED by a caller, which is the invariant that makes the
 * registry worth reading.
 *
 * Exported for its own tests. No kind declares QUALIFIED yet, so the promotion
 * that matters most — QUALIFIED up to ALLOWED — is unreachable through
 * `defineEvidence` and would otherwise go untested until the day it is load
 * bearing. The rule is min() over the rank; the test says so directly.
 */
export function narrowPermissions(granted, requested) {
  if (requested == null) return granted;
  if (typeof requested !== 'object' || Array.isArray(requested)) {
    throw new Error('permissions must be an object keyed by surface');
  }
  const out = { ...granted };
  for (const [surface, grade] of Object.entries(requested)) {
    if (!SURFACES[surface]) throw new Error(`Unknown evidence surface "${surface}"`);
    if (PERMISSION_RANK[grade] === undefined) {
      throw new Error(`Unknown permission "${grade}" for surface ${surface}`);
    }
    out[surface] = PERMISSION_RANK[grade] < PERMISSION_RANK[out[surface]] ? grade : out[surface];
  }
  return Object.freeze(out);
}

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
 * `permissions.OUTREACH: DENIED` marks intelligence that is real and useful for
 * ranking programmes but has no business in a first approach to a coach.
 * Transfer behaviour is the clearest case: knowing a programme fills holes
 * from the portal helps us decide whether to write at all, and telling them we
 * know it helps nobody.
 */
export const EVIDENCE_KINDS = Object.freeze({
  // --- international connection -------------------------------------------
  HISTORICAL_SAME_COUNTRY: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 88,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.PATHWAY,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['country'],
    // MATCHING_SUMMARY: QUALIFIED. Only with its tense: "on earlier rosters". Without it, past
    // presence reads as present presence.
    // OUTREACH: ALLOWED. Compatriots came through; the tense is on the object and no criterion shares its inputs.
    permissions: { MATCHING_SUMMARY: PERMISSION.QUALIFIED, OUTREACH: PERMISSION.ALLOWED },
  },
  CURRENT_SAME_COUNTRY: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 82,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.PATHWAY,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['country'],
    /**
     * MATCHING_SUMMARY: DENIED, and the reason is measurement identity.
     *
     * This kind counts the athlete's compatriots on the CURRENT squad. So does
     * the match score: `geography` delegates to `internationalFit` for every
     * international athlete, and that reads `sameCountryRows` — the same
     * country over the same 2026 roster rows. It is not an adjacent
     * measurement or a correlated one; it is the same population, and the
     * score's own label for it reads "a compatriot here".
     *
     * Measured before this was corrected: of 8 real programmes where this kind
     * fired, 8 also carried that label — 100%, where the other licensed kinds
     * range from 0% to 60% and vary because they measure something else.
     *
     * It was first licensed QUALIFIED on the tense axis alone ("only with its
     * tense: on the squad now"), which is sound as far as it goes and never
     * touched the question the F1 rule actually asks: does the score already
     * consume this fact. It does. Beside a number, a card would have stated
     * one fact twice and called the second occurrence independent.
     *
     * The kind is unchanged everywhere else. OPERATOR_EVIDENCE still shows it
     * on the Decision Evidence page, which has room to say what it is next to;
     * OUTREACH still lets an email use it. Only the match card is closed.
     */
    // OUTREACH: ALLOWED. Compatriots on the squad now, checkable against their own roster.
    permissions: { MATCHING_SUMMARY: PERMISSION.DENIED, OUTREACH: PERMISSION.ALLOWED },
  },
  HISTORICAL_SAME_REGION: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    // Deliberately below both same-country kinds. A shared region is a weaker
    // claim on a coach's attention than a compatriot, and ranking it level
    // would let the broader, blander sentence win on a tie.
    baseStrength: 70,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.PATHWAY,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['region'],
    // OUTREACH: QUALIFIED. Only as the countries it covers, and only saying they are not the athlete's own.
    permissions: { OUTREACH: PERMISSION.QUALIFIED },
  },
  INTERNATIONAL_ROSTER: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 52,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.CONTEXT,
    polarity: POLARITY.POSITIVE,
    specificityAxes: [],
    // OUTREACH: DENIED. Says nothing about this athlete. True of hundreds of programmes.
    permissions: { OUTREACH: PERMISSION.DENIED },
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
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 99,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.PATHWAY,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['coach', 'country'],
    // MATCHING_SUMMARY: ALLOWED. Nothing coach-related is scored, so this cannot be read as
    // the score’s cause.
    // OUTREACH: ALLOWED. The coach's own record — the one claim addressed to the person reading it.
    permissions: { MATCHING_SUMMARY: PERMISSION.ALLOWED, OUTREACH: PERMISSION.ALLOWED },
  },

  /** An arrival from the athlete's country, at the athlete's position. */
  ARRIVAL_SAME_COUNTRY_POSITION: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 95,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.PATHWAY,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['country', 'position'],
    // MATCHING_SUMMARY: ALLOWED. Country and position on one object; no criterion shares
    // its inputs or its name.
    // OUTREACH: ALLOWED. The programme's arrivals at the athlete's country and position.
    permissions: { MATCHING_SUMMARY: PERMISSION.ALLOWED, OUTREACH: PERMISSION.ALLOWED },
  },

  /**
   * An arrival from the athlete's part of the world, at their position.
   *
   * Above HISTORICAL_SAME_REGION because it is an intake rather than a roster
   * line, and below every same-country kind because a shared region is a weaker
   * claim on a coach's attention than a compatriot.
   */
  ARRIVAL_SAME_REGION_POSITION: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 78,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.PATHWAY,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['region', 'position'],
    // MATCHING_SUMMARY: QUALIFIED. Only with a position and named countries. The region key
    // never reaches a surface.
    // OUTREACH: QUALIFIED. Only as concrete countries plus the position, never the region key.
    permissions: { MATCHING_SUMMARY: PERMISSION.QUALIFIED, OUTREACH: PERMISSION.QUALIFIED },
  },

  // A share, not a count: it depends on the denominator being a complete
  // roster, which is a judgement about our own scrape rather than a fact about
  // the programme.
  INTERNATIONAL_SHARE: {
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.CURRENT,
    category: 'international',
    dedupeGroup: 'international-connection',
    baseStrength: 44,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.CONTEXT,
    polarity: POLARITY.POSITIVE,
    specificityAxes: [],
    // OUTREACH: DENIED. A percentage about their squad, to a stranger.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },

  // --- roster opportunity --------------------------------------------------
  POSITION_GRADUATION: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'roster',
    dedupeGroup: 'position-opportunity',
    baseStrength: 76,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.OPENING,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['position'],
    // OUTREACH: QUALIFIED. Only with names and a class year. A bare count invites "so you need one".
    permissions: { OUTREACH: PERMISSION.QUALIFIED },
  },
  // Split from the count above on purpose. Who is leaving is a roster fact;
  // which of them was a starter in a season that has not been played is a
  // projection carried forward from an earlier one.
  POSITION_GRADUATION_STARTERS: {
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.PROJECTED,
    category: 'roster',
    dedupeGroup: 'position-opportunity',
    baseStrength: 68,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.OPENING,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['position'],
    // OUTREACH: DENIED. Supporting detail: "one of THOSE defenders" has no referent alone.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },
  SQUAD_GRADUATION: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'roster',
    dedupeGroup: 'squad-turnover',
    baseStrength: 48,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.CONTEXT,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['athlete'],
    // OUTREACH: DENIED. Subsumed by POSITION_GRADUATION, whose cohort is inside it.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },
  // Internal, deliberately. A bare count is the factual anchor beneath the
  // depth story and is not an argument on its own: Air Force carries eleven
  // defenders, and "your current roster carries eleven defenders" led an email
  // to a coach as a reason to sign a twelfth. Where the group IS thin,
  // POSITION_GROUP_SCARCITY says so in the form that means something.
  POSITION_GROUP_SIZE: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.CURRENT,
    category: 'roster',
    dedupeGroup: 'position-depth',
    baseStrength: 46,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.CONTEXT,
    polarity: POLARITY.NEUTRAL,
    specificityAxes: ['position'],
    // OUTREACH: DENIED. A squad headcount. Says nothing about this athlete.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },
  POSITION_GROUP_SCARCITY: {
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.CURRENT,
    category: 'roster',
    dedupeGroup: 'position-depth',
    baseStrength: 58,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.OPENING,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['position'],
    // MATCHING_SUMMARY: QUALIFIED. Support only. Its squadSize disagrees with POSITION_GROUP_SIZE
    // at 47 of 228 programmes, so it may not lead.
    // OUTREACH: DENIED. Grades their squad to their face.
    permissions: { MATCHING_SUMMARY: PERMISSION.QUALIFIED, OUTREACH: PERMISSION.DENIED },
  },
  RETURNING_POSITION_DEPTH: {
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.PROJECTED,
    category: 'roster',
    dedupeGroup: 'position-depth',
    baseStrength: 54,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.OPENING,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['position'],
    // OUTREACH: DENIED. Grades their squad to their face.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },
  ELIGIBILITY_CLIFF: {
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.PROJECTED,
    category: 'roster',
    dedupeGroup: 'position-opportunity',
    baseStrength: 50,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.OPENING,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['position'],
    // OUTREACH: DENIED. Grades their squad to their face.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },

  // --- programme record ----------------------------------------------------
  CONFERENCE_TITLE: {
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
    minConfidence: CONFIDENCE.HIGH,
    decisionClass: DECISION_CLASS.FIT,
    polarity: POLARITY.POSITIVE,
    specificityAxes: [],
    // OUTREACH: QUALIFIED. Recognition only. Never a reason the athlete fits.
    permissions: { OUTREACH: PERMISSION.QUALIFIED },
  },
  POSTSEASON_RESULT: {
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
    minConfidence: CONFIDENCE.HIGH,
    decisionClass: DECISION_CLASS.FIT,
    polarity: POLARITY.POSITIVE,
    specificityAxes: [],
    // OUTREACH: QUALIFIED. Recognition only. Never a reason the athlete fits.
    permissions: { OUTREACH: PERMISSION.QUALIFIED },
  },
  PROGRAM_MOMENTUM: {
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.STATIC,
    category: 'performance',
    dedupeGroup: 'programme-success',
    baseStrength: 56,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.FIT,
    polarity: POLARITY.POSITIVE,
    specificityAxes: [],
    // OUTREACH: DENIED. Grades their season to their face.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },

  // --- people and academics ------------------------------------------------
  COACH_CONTEXT: {
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.STATIC,
    category: 'coach',
    dedupeGroup: 'coach',
    baseStrength: 45,
    minConfidence: CONFIDENCE.MEDIUM,
    /**
     * A count BOUNDED BY THE WINDOW, which is what needing one means.
     *
     * "Four seasons into the job" is not a fact about a coach; it is a fact
     * about how many seasons we could see. Notre Dame's 2022 and 2023 staff
     * pages were unreadable and the evidence read "two seasons into the job"
     * about a man who had had it since 2018. `windowBounded` already stops the
     * renderer printing a start year on that basis; this stops the object
     * existing without the seasons that explain where the bound came from.
     *
     * The only email-eligible kind that requires a window, and the only one
     * whose source can tell a season it failed to read from one it never had.
     */
    requiresWindow: true,
    decisionClass: DECISION_CLASS.CONTEXT,
    polarity: POLARITY.NEUTRAL,
    specificityAxes: [],
    // OUTREACH: DENIED. Tells a coach how long they have held their own job.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },
  ACADEMIC_FIT: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.STATIC,
    category: 'academic',
    dedupeGroup: 'academic',
    baseStrength: 78,
    minConfidence: CONFIDENCE.HIGH,
    decisionClass: DECISION_CLASS.FIT,
    polarity: POLARITY.POSITIVE,
    specificityAxes: ['athlete'],
    // OUTREACH: QUALIFIED. Only with BOTH labels: the athlete's words and the programme's subject.
    permissions: { OUTREACH: PERMISSION.QUALIFIED },
  },

  // --- internal only -------------------------------------------------------
  /**
   * How many arrived at this position, per intake. SHADOW MODE.
   *
   * OUTREACH DENIED, deliberately and for a reason that is about the sentence
   * rather than about the data. "You've added a defender in each of the last
   * four intakes" is a true and checkable observation that sits one short step
   * from "so you'll need another" — a claim about a coach's future intentions
   * that no roster row supports, and the exact overstatement the CTA was
   * corrected for. It is generated, ranked, logged and visible in the operator
   * panel so that real examples can be read before anything is licensed; it
   * cannot reach an email, because `outreachEvidenceFor` asks the registry
   * before composition ever sees it.
   *
   * It carries no outbound role either. A role is what licenses a claim to
   * open, follow or congratulate, and this kind has none — so promoting it
   * later means writing one down, which is the deliberate decision this entry
   * exists to keep deliberate.
   */
  POSITION_INTAKE_HISTORY: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'internal',
    dedupeGroup: 'position-intake',
    baseStrength: 60,
    minConfidence: CONFIDENCE.MEDIUM,
    // A RATE. "A defender in each of the last four intakes" is a numerator over
    // the intakes we could compare, and without that denominator it is not a
    // weaker claim but a different one.
    requiresWindow: true,
    decisionClass: DECISION_CLASS.CONTEXT,
    polarity: POLARITY.NEUTRAL,
    specificityAxes: ['position'],
    // OUTREACH: DENIED. Intake machinery: useful for ranking, not a thing to tell a coach.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },

  // Generated, ranked and logged like everything else so that it is available
  // the day we can measure it, but never rendered into an email.
  TRANSFER_BEHAVIOUR: {
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.CURRENT,
    category: 'internal',
    dedupeGroup: 'transfer',
    baseStrength: 40,
    minConfidence: CONFIDENCE.MEDIUM,
    decisionClass: DECISION_CLASS.CONTEXT,
    polarity: POLARITY.NEUTRAL,
    specificityAxes: ['position'],
    // OUTREACH: DENIED. How a programme fills holes. Knowing it helps us; saying it helps nobody.
    permissions: { OUTREACH: PERMISSION.DENIED },
  },

  // --- programme development ------------------------------------------------
  //
  // The freshman-minutes intelligence, translated rather than recomputed. Every
  // number in these four comes from shared/freshmanMinutes.js and
  // shared/philosophy.js exactly as the programme report reads it; the adapter
  // in philosophyEvidence.js turns it into evidence objects and does no
  // arithmetic of its own.
  //
  // All four are OPERATOR_EVIDENCE: QUALIFIED and nothing else. They are
  // measurements over a window, and a window is the difference between "first
  // years took meaningful minutes across the seasons we can read" and "this
  // programme plays freshmen" — the second being a claim about the future that
  // no season of history supports. QUALIFIED says the renderer may not show
  // them without the window; DENIED everywhere else says nobody outside the
  // operator screen may show them at all yet.
  //
  // `category: 'development'` rather than 'internal'. A family is what an
  // observation is ABOUT and a permission is what may be done with it; folding
  // the second into the first is what left POSITION_GROUP_SIZE filed as roster
  // evidence with its restriction recorded only in a comment.

  /**
   * How first-year minutes have behaved across the measured seasons, and
   * whether that pattern survived the coaching changes inside the window.
   *
   * SIGNAL, and it could not be anything else. `classifyProgramme` returns a
   * judgement — `steady`, `regime-change`, `structural-through-changes` — and a
   * judgement rendered as a fact is the whole failure this tier exists to stop.
   * The label itself is analytical vocabulary and stays in `data`: what a
   * reader may be shown is the measurement it was derived from.
   */
  PROGRAMME_DEVELOPMENT_PATTERN: {
    tier: TIERS.SIGNAL,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'development',
    dedupeGroup: 'development-pattern',
    baseStrength: 40,
    minConfidence: CONFIDENCE.MEDIUM,
    // OUTREACH: DENIED. A verdict on how they develop players, delivered by a stranger.
    permissions: { OPERATOR_EVIDENCE: PERMISSION.QUALIFIED, OUTREACH: PERMISSION.DENIED },
    requiresWindow: true,
    decisionClass: DECISION_CLASS.FIT,
    polarity: POLARITY.NEUTRAL,
    specificityAxes: [],
  },

  /**
   * The whole-intake ladder: what the nth-ranked first year took, by season.
   *
   * FACT — a median of observed minutes is asserted directly by the rows, and
   * `ladderByRank` names its own agreement band rather than implying precision
   * it does not have. Carried as the ladder and never as one number: the top
   * rung alone reads as what a newcomer can expect, and the rungs below it are
   * the reason that reading is wrong.
   */
  FRESHMAN_MINUTES_LADDER: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'development',
    dedupeGroup: 'freshman-ladder',
    baseStrength: 38,
    minConfidence: CONFIDENCE.MEDIUM,
    // OUTREACH: DENIED. One sentence away from promising playing time.
    permissions: { OPERATOR_EVIDENCE: PERMISSION.QUALIFIED, OUTREACH: PERMISSION.DENIED },
    requiresWindow: true,
    decisionClass: DECISION_CLASS.FIT,
    polarity: POLARITY.NEUTRAL,
    specificityAxes: [],
  },

  /**
   * The same ladder, cut to the cohort this athlete would actually compete with.
   *
   * A SEPARATE dedupe group from the whole-intake ladder, deliberately. The two
   * look like one idea and are not: narrowing moved the top of the ladder
   * downward at 17 of one pilot athlete's 19 programmes, and the DIFFERENCE
   * between them is the finding. Collapsing them would keep the flattering one.
   *
   * Reads its window from `playerFit`'s own provenance and never from the
   * programme's. A season readable for a whole intake need not be readable for
   * a two-player cohort, and the narrowed profile filters seasons
   * independently — so the programme window would describe a measurement this
   * ladder was not taken over.
   */
  ATHLETE_COHORT_LADDER: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'development',
    dedupeGroup: 'cohort-ladder',
    baseStrength: 42,
    minConfidence: CONFIDENCE.MEDIUM,
    // OUTREACH: DENIED. Same, narrowed to this athlete's cohort. Worse, not better.
    permissions: { OPERATOR_EVIDENCE: PERMISSION.QUALIFIED, OUTREACH: PERMISSION.DENIED },
    requiresWindow: true,
    decisionClass: DECISION_CLASS.PATHWAY,
    polarity: POLARITY.NEUTRAL,
    specificityAxes: ['position', 'origin'],
  },

  /**
   * Where this programme's measured first-year opportunity sits in the pool.
   *
   * OUTREACH is DENIED by product decision and not merely by default: telling a
   * coach how they rank against their peers is a different act from telling
   * them what we noticed about their squad, and it is not licensed. The
   * comparison basis is required on the object because "above the pool" is not
   * a claim until the pool is named.
   */
  PROGRAMME_POOL_BENCHMARK: {
    tier: TIERS.FACT,
    temporality: TEMPORALITY.HISTORICAL,
    category: 'development',
    dedupeGroup: 'pool-benchmark',
    baseStrength: 30,
    minConfidence: CONFIDENCE.MEDIUM,
    // OUTREACH: DENIED. A peer percentile. Grading their programme to their face.
    permissions: { OPERATOR_EVIDENCE: PERMISSION.QUALIFIED, OUTREACH: PERMISSION.DENIED },
    requiresWindow: true,
    // The only kind that requires one. "Above the pool" is not a claim until
    // the pool is named and the result stated.
    requiresComparison: true,
    decisionClass: DECISION_CLASS.CONTEXT,
    polarity: POLARITY.NEUTRAL,
    specificityAxes: [],
  },
});

/**
 * Every kind must declare its ranking metadata, checked once at module load.
 *
 * The same reason the tier lives in the registry: a field a new kind can forget
 * is a field a new kind will eventually forget, and a missing decisionClass
 * would sort silently rather than loudly.
 */
for (const [kind, spec] of Object.entries(EVIDENCE_KINDS)) {
  if (!DECISION_CLASS_KEYS.includes(spec.decisionClass)) {
    throw new Error(`${kind} must declare a decisionClass from ${DECISION_CLASS_KEYS.join(', ')}`);
  }
  if (!POLARITY_KEYS.includes(spec.polarity)) {
    throw new Error(`${kind} must declare a polarity from ${POLARITY_KEYS.join(', ')}`);
  }
  if (!Array.isArray(spec.specificityAxes)) {
    throw new Error(`${kind} must declare specificityAxes as an array`);
  }
}

/**
 * Every kind declares its outbound grade, explicitly.
 *
 * The default above is DENIED and would already fail closed, so this check
 * buys nothing at runtime — it buys a DECISION. A kind added without an
 * OUTREACH line is a kind whose author never asked whether a stranger may say
 * it to a coach, and the answer arriving by default is how that question gets
 * skipped. It has to be written down.
 *
 * Deliberately only OUTREACH. The other two surfaces have safe defaults an
 * author may reasonably inherit; this one is the only surface whose output
 * leaves the building.
 */
for (const [kind, spec] of Object.entries(EVIDENCE_KINDS)) {
  if (!spec.permissions?.OUTREACH) {
    throw new Error(
      `${kind} must declare permissions.OUTREACH — an outbound licence is a decision, not a default.`,
    );
  }
}

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
  // Named for what was measured, not for what it might imply. "Plays freshmen"
  // is the reading these labels exist to avoid handing anybody.
  PROGRAMME_DEVELOPMENT_PATTERN: 'First-year minutes across measured seasons',
  FRESHMAN_MINUTES_LADDER: 'First-year minutes ladder',
  ATHLETE_COHORT_LADDER: 'First-year minutes ladder, this athlete’s cohort',
  PROGRAMME_POOL_BENCHMARK: 'First-year opportunity against the pool',
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

const isSeasonList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);

/**
 * The window and population a measurement was taken over.
 *
 * Optional and unused in this step. It exists because nothing in the object
 * could state what a derived number describes: `season` is one string, and a
 * median across four seasons of a nineteen-player cohort has no way to say so.
 * That absence is what lets "first-year defenders took meaningful minutes"
 * escape without the clause that makes it true rather than predictive.
 *
 * `seasonsUnread` is separate from `seasons` on purpose, and is the field this
 * shape exists for as much as any other. A season we could not read is not a
 * season in which nothing happened — Marywood was filed as one of the largest
 * regime changes in the pool on the strength of three blank seasons read as
 * zeroes. A window that cannot record its own holes will eventually be read as
 * complete.
 *
 * Validation is deliberately shallow: shapes and types, not statistics. It is
 * here to catch a generator handing over a string where a list belongs, not to
 * audit the arithmetic.
 */
function validateDescribes(describes) {
  if (describes == null) return null;
  if (typeof describes !== 'object' || Array.isArray(describes)) {
    throw new Error('describes must be an object');
  }
  const { seasons = [], seasonsUnread = null, n = null, cohort = null } = describes;
  if (!isSeasonList(seasons)) throw new Error('describes.seasons must be an array of season strings');
  /**
   * Three states, and the third is why this is not simply an array.
   *
   *   []            we looked for holes and there are none
   *   ['2024']      we looked and 2024 could not be read
   *   null          we cannot tell, and must not imply either answer
   *
   * The third is not hypothetical. `freshmanProfile` computes its unreadable
   * seasons for the cohort ASKED for and then relaxes the narrowing when that
   * cohort is too thin — so at 160 of 219 real athlete-programme pairs the
   * unreadable set on file belongs to a different population from the ladder.
   * Flattening that to `[]` would report one cohort's clean bill of health for
   * another cohort's measurement.
   *
   * UNKNOWN is also the default. A generator that says nothing has not told us
   * there are no holes, and the reassuring reading of missing provenance is
   * exactly what puts unverified claims in front of people.
   */
  if (seasonsUnread !== null && !isSeasonList(seasonsUnread)) {
    throw new Error('describes.seasonsUnread must be an array of season strings, or null for unknown');
  }
  if (n !== null && (!Number.isInteger(n) || n < 0)) {
    throw new Error('describes.n must be a non-negative integer or null');
  }
  if (cohort !== null && (typeof cohort !== 'object' || Array.isArray(cohort))) {
    throw new Error('describes.cohort must be an object or null');
  }
  // A window naming no seasons at all describes nothing, and would render as a
  // qualification that qualifies nothing — worse than having no window, because
  // it looks like one.
  if (!seasons.length && !(seasonsUnread ?? []).length) {
    throw new Error('describes must name at least one season');
  }
  return Object.freeze({
    seasons: Object.freeze([...seasons]),
    seasonsUnread: seasonsUnread === null ? null : Object.freeze([...seasonsUnread]),
    n,
    cohort: cohort === null ? null : Object.freeze({ ...cohort }),
  });
}

/**
 * Where a measurement fell against the pool, when a quartile is all we have.
 *
 * Named for the benchmark's own fields rather than for a new scale, because it
 * IS the benchmark's own answer: `buildPoolBenchmarks` keeps `p25`, `median`
 * and `p75` per ladder rank and discards the distribution they came from, so
 * which of those four intervals a programme sits in is the most precise true
 * statement available. There is no fifth possibility and no finer one.
 *
 * This exists so that a comparison can be honest instead of silent. Reporting
 * "above p75" as `percentile: 90` — which is what the shape allowed before —
 * gives a programme one point above the third quartile and the best in the
 * country the same number.
 */
export const COMPARISON_BANDS = Object.freeze({
  AT_OR_BELOW_P25: 'at-or-below-p25',
  P25_TO_MEDIAN: 'p25-to-median',
  MEDIAN_TO_P75: 'median-to-p75',
  ABOVE_P75: 'above-p75',
});

export const COMPARISON_BAND_KEYS = Object.freeze(Object.values(COMPARISON_BANDS));

/**
 * What a measurement was compared against.
 *
 * Separate from `describes` because they
 * answer different questions — one bounds the measurement, the other names the
 * population it was ranked within — and a benchmark needs both. "Above the
 * pool" is not a claim until the pool is named, which is why `basis` and
 * `statistic` are required together rather than left to `data`, where nothing
 * could insist on them.
 */
function validateComparison(comparison) {
  if (comparison == null) return null;
  if (typeof comparison !== 'object' || Array.isArray(comparison)) {
    throw new Error('comparison must be an object');
  }
  const {
    basis = null, statistic = null, poolSize = null,
    percentile = null, band = null,
  } = comparison;
  if (typeof basis !== 'string' || !basis) throw new Error('comparison.basis is required');
  if (typeof statistic !== 'string' || !statistic) throw new Error('comparison.statistic is required');
  if (!Number.isInteger(poolSize) || poolSize < 0) {
    throw new Error('comparison.poolSize is required and must be a non-negative integer');
  }
  if (percentile !== null && (typeof percentile !== 'number' || percentile < 0 || percentile > 100)) {
    throw new Error('comparison.percentile must be a number between 0 and 100, or null');
  }
  if (band !== null && !COMPARISON_BAND_KEYS.includes(band)) {
    throw new Error(`comparison.band must be one of ${COMPARISON_BAND_KEYS.join(', ')}, or null`);
  }
  /**
   * A comparison that ranks nothing is a shell.
   *
   * `basis` and `statistic` say what was compared against what; without a
   * `percentile` or a `band` the object never says how it came out. That reads
   * as a comparison to anyone holding it and answers nothing, which is worse
   * than carrying no comparison at all.
   */
  if (percentile === null && band === null) {
    throw new Error('comparison must carry a percentile or a band — one of them is the result');
  }
  return Object.freeze({ basis, statistic, poolSize, percentile, band });
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
/**
 * May this surface render this evidence, and does it have what it needs?
 *
 * The guard a renderer calls before it writes anything. It exists because the
 * permission grade alone is not self-enforcing: QUALIFIED says a renderer must
 * state the qualification, and nothing stops one that simply does not. Asking
 * here turns "should have" into a throw.
 *
 * QUALIFIED does NOT imply a window. It means the surface must use whatever
 * qualification this kind declares, and today the only declarable qualification
 * is `requiresWindow` — a future one might be a hedge, a sample warning or a
 * caveat that has nothing to do with seasons. Requiring a historical window for
 * every QUALIFIED item would hard-code today's single case into the model.
 *
 * Called by all three surfaces. `outreachEvidenceFor` asks it first and then
 * applies the qualification rule the grade implies; the operator and match-card
 * read models ask it and branch on the answer. It decides the grade and never
 * the qualification — those are per-surface and live with the surface.
 *
 * Renders nothing and mutates nothing: it answers a question and returns the
 * grade so a caller can branch on ALLOWED versus QUALIFIED.
 */
export function assertSurfaceRenderable(evidence, surface) {
  if (!evidence?.kind) throw new Error('assertSurfaceRenderable needs an evidence object');
  if (!SURFACE_KEYS.includes(surface)) throw new Error(`Unknown surface "${surface}"`);

  const grade = evidence.permissions?.[surface] ?? permissionsFor(evidence.kind)[surface];
  if (grade === PERMISSION.DENIED) {
    throw new Error(`${evidence.kind} is not permitted on ${surface}`);
  }

  const spec = kindSpec(evidence.kind);
  if (spec.requiresWindow && !(evidence.describes?.seasons?.length)) {
    throw new Error(
      `${evidence.kind} requires the window it was measured over before ${surface} `
      + 'may render it',
    );
  }
  if (spec.requiresComparison && !evidence.comparison) {
    throw new Error(
      `${evidence.kind} requires its comparison before ${surface} may render it`,
    );
  }
  return grade;
}

export function defineEvidence(kind, {
  strength = null,
  confidence = CONFIDENCE.MEDIUM,
  data = {},
  season = null,
  source = null,
  sourceUrl = null,
  freshness = null,
  permissions = null,
  describes = null,
  comparison = null,
} = {}) {
  const spec = kindSpec(kind);
  if (!Object.values(CONFIDENCE).includes(confidence)) {
    throw new Error(`Unknown confidence "${confidence}" for evidence ${kind}`);
  }
  if (!source) throw new Error(`Evidence ${kind} must declare a source`);

  const validDescribes = validateDescribes(describes);
  const validComparison = validateComparison(comparison);

  /**
   * A kind whose truth is bounded by a window may not be built without one.
   *
   * The same mechanism as the tier and the source: a rule every generator has
   * to remember is a rule one of them will eventually not remember. This is
   * the difference between "across the seasons we can read, first-year
   * defenders took meaningful minutes" and "this programme plays freshmen" —
   * one describes four seasons, the other forecasts the next.
   *
   * `validateDescribes` has already refused a window naming no seasons, so
   * reaching here with a window means it names at least one.
   */
  if (spec.requiresWindow && !validDescribes) {
    throw new Error(
      `Evidence ${kind} is a measurement over a window and must declare `
      + '`describes` — see requiresWindow in the registry.',
    );
  }
  if (spec.requiresComparison && !validComparison) {
    throw new Error(
      `Evidence ${kind} ranks a programme against a pool and must declare `
      + '`comparison` — a ranking without its pool is not a claim.',
    );
  }

  // Applied HERE rather than in each generator, for the same reason the tier
  // is read from the registry: a policy every generator has to remember to
  // call is a policy one of them will eventually not call. Returning null
  // suppresses the evidence outright — see applyFreshness.
  const effective = freshness ? applyFreshness(spec, confidence, freshness) : confidence;
  if (effective === null) return null;

  /**
   * The registry's grades, narrowed by whatever the caller asked for.
   *
   * ONE STEP, WHERE THERE WERE TWO. The first used to convert a legacy
   * `emailEligible` boolean into an OUTREACH narrowing, so a generator could
   * revoke a licence through a field that answered a different question. That
   * is gone: a caller narrows `permissions` or narrows nothing, and
   * `narrowPermissions` still only ever moves a grade down.
   */
  const resolvedPermissions = narrowPermissions(permissionsFor(kind), permissions);

  return Object.freeze({
    kind,
    tier: spec.tier,
    temporality: spec.temporality,
    // What the claim rests on, carried so the operator view can explain a
    // downgrade and the log can record it.
    freshness: freshness ? Object.freeze({ ...freshness }) : null,
    confidenceBeforeFreshness: confidence,
    category: spec.category,
    /**
     * Ranking metadata, carried like the tier and for the same reason: a
     * consumer holding one piece of evidence should not have to go back to the
     * registry to learn what it is, and a caller must not be able to restate
     * it. Read by shared/evidence/rank.js and by nothing else today.
     */
    decisionClass: spec.decisionClass,
    polarity: spec.polarity,
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
    /**
     * The per-surface licence, and the ONLY thing that decides where a claim
     * may appear.
     *
     * There was a second field beside this one — `emailEligible` — which
     * answered the same question for one surface with a boolean, could silently
     * narrow this to DENIED, and diverged from it for fifteen kinds once the
     * outbound policy was set. H3 removed it. An evidence object does not know
     * whether it is "email eligible"; it knows its permissions.
     */
    permissions: resolvedPermissions,
    /** The window a measurement covers. Optional; no kind requires one yet. */
    describes: validDescribes,
    /** What a measurement was ranked against. Optional; unused so far. */
    comparison: validComparison,
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
