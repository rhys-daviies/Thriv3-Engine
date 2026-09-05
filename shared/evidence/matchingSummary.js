import {
  EVIDENCE_KINDS, PERMISSION, permissionsFor, kindSpec,
  assertSurfaceRenderable, confidenceAtLeast,
} from './kinds.js';
import { operatorFactsFor } from './operatorFacts.js';

/**
 * The recruiting signals a match card may carry.
 *
 * "RECRUITING SIGNALS" IS NARROWER THAN "WHAT WE KNOW", and the narrowing is
 * the product. A match card shows a number, and any fact printed beside a
 * number is read as its cause. So this surface carries only evidence of a
 * demonstrated recruiting pathway that the match score does not already use:
 * two ALLOWED kinds and four QUALIFIED ones out of twenty-six. Everything the
 * score consumes, everything derived from what the score consumes, and
 * everything sharing a criterion's name is DENIED — not because it is untrue,
 * but because next to a score it would read as the reason for the score.
 *
 * "What Thriv3 knows" remains the Decision Evidence page, which has room to
 * explain a horizon and a caveat. This has room for one line.
 *
 * IT NEVER SEES THE SCORE. `matchingSummaryFor` takes an evidence result and
 * nothing else — no score, weight, contribution, criterion or breakdown. There
 * is no parameter through which one could arrive, which is the only way to
 * guarantee selection cannot depend on it.
 *
 * IT DOES NOT REUSE `topReasons`. That is the operator policy and it selects
 * kinds denied here — POSITION_GRADUATION leads most of its lists. Sharing it
 * would license by the back door.
 */

/**
 * The qualification each licensed kind must satisfy, and whether it may lead.
 *
 * FAILING CLOSED IS THE POINT. A QUALIFIED grade means the registry permits
 * the kind only through a path that states its qualification; if the evidence
 * cannot satisfy that path, the item is dropped rather than shown plainly.
 * Silent degradation to ALLOWED is the failure this table exists to prevent,
 * because it would be invisible: a correct-looking fact with its caveat
 * missing.
 *
 * Q-WINDOW IS ABSENT, DELIBERATELY. F1 defined four qualification concepts and
 * only three are reachable: `requiresWindow` is set on COACH_CONTEXT,
 * POSITION_INTAKE_HISTORY and the four development kinds, every one of which is
 * DENIED here. Building the machinery anyway would leave an untested branch
 * that looks load-bearing.
 *
 *   lead      may be the first fact shown. False means support-only: it may
 *             appear, but never above a lead.
 *   satisfied the qualification test. Absent means the grade is ALLOWED and
 *             there is nothing to satisfy.
 */
const RULES = Object.freeze({
  COACH_ARRIVAL_SAME_COUNTRY: { lead: true },

  ARRIVAL_SAME_COUNTRY_POSITION: { lead: true },

  ARRIVAL_SAME_REGION_POSITION: {
    lead: false,
    /**
     * Q-AXIS. A region claim is safe only when it can be stated as the
     * countries it actually covers and the position it was cut to. The region
     * key itself — OCEANIA — is a bucket name from the recruiting tables that
     * has never reached a surface, and countries are never reconstructed from
     * it.
     */
    satisfied: (f) => Boolean(f.position) && Array.isArray(f.countries) && f.countries.length > 0,
  },

  HISTORICAL_SAME_COUNTRY: {
    lead: false,
    // Q-TENSE. The distinction from CURRENT_SAME_COUNTRY is structural, not
    // editorial: the two kinds carry different temporality, and a card that
    // could not tell them apart would report a player who left in 2022 as
    // being on the squad.
    satisfied: (f, q) => q.temporality === 'HISTORICAL',
  },

  CURRENT_SAME_COUNTRY: {
    lead: false,
    // Q-TENSE, the other way.
    satisfied: (f, q) => q.temporality === 'CURRENT',
  },

  POSITION_GROUP_SCARCITY: {
    // Q-SUPPORT. Never first. Its `squadSize` disagrees with the field of the
    // same name on POSITION_GROUP_SIZE at 47 of 228 programmes, so it is not
    // yet trustworthy enough to be the one thing a card says.
    lead: false,
  },
});

/**
 * What each kind contributes to the payload.
 *
 * A per-kind projection rather than passing `operatorFactsFor` through whole,
 * for two reasons. The arrival kinds carry an `arrivals[]` array holding a
 * coach, a position and a REGION per arrival — passing it would leak the
 * region key this surface must never need, by a second route. And
 * COACH_ARRIVAL_SAME_COUNTRY carries a `position` that is null on 135 of 177
 * real items; a card naming it on the other 42 would make our record-keeping
 * look like a difference between programmes.
 *
 * `squadSize` is dropped from scarcity for the reason above: the share already
 * expresses the denominator, and the raw figure is the contested one.
 */
const FACTS = Object.freeze({
  COACH_ARRIVAL_SAME_COUNTRY: (f) => ({
    country: f.country,
    coach: f.coach,
    count: f.count,
    seasons: f.seasons ?? [],
    namedArrival: f.namedArrival ?? null,
    namedArrivalSeason: f.namedArrivalSeason ?? null,
  }),
  ARRIVAL_SAME_COUNTRY_POSITION: (f) => ({
    country: f.country,
    position: f.position,
    count: f.count,
    seasons: f.seasons ?? [],
    namedArrival: f.namedArrival ?? null,
    namedArrivalSeason: f.namedArrivalSeason ?? null,
  }),
  ARRIVAL_SAME_REGION_POSITION: (f) => ({
    // No `region`. The countries are what a card may name.
    countries: f.countries ?? [],
    position: f.position,
    count: f.count,
    seasons: f.seasons ?? [],
    namedArrival: f.namedArrival ?? null,
    namedArrivalSeason: f.namedArrivalSeason ?? null,
  }),
  HISTORICAL_SAME_COUNTRY: (f) => ({
    country: f.country,
    count: f.count,
    names: f.names ?? [],
    seasonsPresent: f.seasonsPresent ?? [],
  }),
  CURRENT_SAME_COUNTRY: (f) => ({
    country: f.country,
    count: f.count,
    names: f.names ?? [],
  }),
  POSITION_GROUP_SCARCITY: (f) => ({
    position: f.position,
    count: f.count,
    share: f.share,
  }),
});

/**
 * The qualification a card needs, and no more.
 *
 * `temporality` is here because it is the only thing separating the two
 * same-country kinds, and a surface that lost it would state a past presence
 * as a present one. `seasons` says what was read. Nothing else crosses:
 * confidence is enforced below as a floor and never shown, because a grade
 * beside a score invites arithmetic between the two.
 */
function qualificationFor(item) {
  const q = item.qualification ?? {};
  return {
    temporality: q.temporality ?? null,
    seasons: q.window?.seasons ?? (q.season ? [String(q.season)] : []),
  };
}

/** Registry declaration order, which is the tie-break below. */
const DECLARATION_ORDER = Object.freeze(Object.keys(EVIDENCE_KINDS));

/** Kinds this surface may carry at all, read from the registry, never listed. */
export const LICENSED_KINDS = Object.freeze(
  DECLARATION_ORDER.filter((k) => permissionsFor(k).MATCHING_SUMMARY !== PERMISSION.DENIED),
);

/**
 * Every licensed kind must declare a rule and a projection, checked at load.
 *
 * The registry and this module can be edited independently, and a kind
 * licensed in one without the other would either crash at render or — worse —
 * be dropped silently and look like a programme with no signals.
 */
for (const kind of LICENSED_KINDS) {
  if (!RULES[kind]) throw new Error(`${kind} is licensed for MATCHING_SUMMARY but declares no rule`);
  if (!FACTS[kind]) throw new Error(`${kind} is licensed for MATCHING_SUMMARY but declares no facts`);
  const grade = permissionsFor(kind).MATCHING_SUMMARY;
  const hasTest = typeof RULES[kind].satisfied === 'function';
  if (grade === PERMISSION.QUALIFIED && !hasTest && RULES[kind].lead !== false) {
    throw new Error(`${kind} is QUALIFIED but neither tests a qualification nor is support-only`);
  }
  if (grade === PERMISSION.ALLOWED && hasTest) {
    throw new Error(`${kind} is ALLOWED but declares a qualification test`);
  }
}
for (const kind of Object.keys(RULES)) {
  if (!LICENSED_KINDS.includes(kind)) {
    throw new Error(`${kind} declares a MATCHING_SUMMARY rule but the registry denies it`);
  }
}

/** The most facts a card may carry. */
export const MAX_FACTS = 4;

/**
 * The recruiting signals for one athlete at one programme.
 *
 * @param {object} evidenceResult  an `evidenceFor` result, whole. Required as
 *   the object for the same reason the operator read model requires it: `all`
 *   is the pre-dedupe collection, and a post-dedupe array has already had the
 *   email engine's opinion applied to it.
 */
export function matchingSummaryFor(evidenceResult) {
  if (!evidenceResult || !Array.isArray(evidenceResult.all)) {
    throw new Error(
      'matchingSummaryFor needs an evidenceFor result with its full `all` collection.',
    );
  }
  if (typeof evidenceResult.programmeResolved !== 'boolean') {
    throw new Error(
      'matchingSummaryFor needs `programmeResolved` on the result. Whether the name '
      + 'resolved to a programme we hold must not be guessed from evidence counts.',
    );
  }

  const eligible = [];
  for (const ev of evidenceResult.all) {
    const rule = RULES[ev.kind];
    if (!rule) continue;                                   // denied, or unlicensed

    // The registry's own gate, including a caller's narrowing.
    try {
      assertSurfaceRenderable(ev, 'MATCHING_SUMMARY');
    } catch {
      continue;
    }
    // The kind's confidence floor, enforced as a floor and never as a rank.
    if (!confidenceAtLeast(ev.confidence, kindSpec(ev.kind).minConfidence)) continue;

    const item = operatorFactsFor(ev);
    const facts = FACTS[ev.kind](item.facts);
    const qualification = qualificationFor(item);

    // Fails closed: a QUALIFIED kind that cannot state its qualification is
    // dropped, never shown as though it were ALLOWED.
    if (rule.satisfied && !rule.satisfied(facts, qualification)) continue;

    eligible.push({
      kind: ev.kind,
      category: item.category,
      facts,
      qualification,
      // Selection metadata, removed before returning.
      _lead: rule.lead === true,
      _order: DECLARATION_ORDER.indexOf(ev.kind),
      _group: kindSpec(ev.kind).dedupeGroup,
    });
  }

  /**
   * Leads first, then registry declaration order.
   *
   * No score, no weight, no contribution, no confidence, no strength, and not
   * the operator comparator — that one leads on decision class, which is a
   * judgement about a different surface's question. Declaration order is
   * arbitrary but fixed and reviewable, which is what a tie-break needs to be.
   */
  eligible.sort((a, b) => (Number(b._lead) - Number(a._lead)) || (a._order - b._order));

  /**
   * One per dedupe group, and this cuts deeply here.
   *
   * Five of the six licensed kinds share `international-connection`: a coach
   * arrival from New Zealand, a New Zealand defender recruited, a New
   * Zealander on an earlier roster and one on the current squad are four
   * statements about ONE connection. Printed as four rows beside a match
   * score they would read as four independent signals, which is the same false
   * corroboration this surface's licensing exists to prevent. So a card shows
   * at most one of them — in practice at most two facts overall.
   */
  const seen = new Set();
  const facts = [];
  for (const item of eligible) {
    if (seen.has(item._group)) continue;
    seen.add(item._group);
    facts.push({
      kind: item.kind, category: item.category, facts: item.facts, qualification: item.qualification,
    });
    if (facts.length === MAX_FACTS) break;
  }

  return {
    // Reused from the operator read model rather than re-derived. An unknown
    // name is a lookup miss, never an assessment, and never inferred from
    // whether a roster happens to exist.
    programme: { resolved: evidenceResult.programmeResolved },
    facts,
    /**
     * Whether a card has anything to show.
     *
     * Defined as "at least one fact survived policy" — the same thing as
     * `facts.length > 0`, and kept anyway because it is the question the card
     * asks and the name it should ask it by. It deliberately does NOT mean
     * "we hold evidence": a programme with four development measurements and
     * no licensed pathway signal reports false here, which is correct for this
     * panel and would be wrong for the Decision Evidence page.
     */
    hasEvidence: facts.length > 0,
  };
}
