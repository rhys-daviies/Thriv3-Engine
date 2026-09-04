/**
 * Everything the operator Evidence surface should receive for one athlete at
 * one programme.
 *
 * A PURE ASSEMBLY LAYER. It selects nothing new, derives nothing, and computes
 * no arithmetic: it takes an `evidenceFor` result, runs the existing top-reasons
 * policy over it, puts every licensed item through the existing fact extractor,
 * and files each into a section. No database, no Philosophy, no matching, no
 * recruiting.
 *
 * IT TAKES THE RESULT OBJECT, NOT AN ARRAY, AND THAT IS DELIBERATE.
 *
 * The policy must see the FULL pre-email-dedupe set. `selectFrom` produces
 * `all` before any filter, then `ranked` after the email engine has collapsed
 * each dedupe group to one survivor. At Jacksonville `all` carries
 * POSITION_GRADUATION, POSITION_GRADUATION_STARTERS and ELIGIBILITY_CLIFF;
 * `ranked` carries only the first, with the other two in `suppressed`. Handing
 * this a bare array would let a caller pass the wrong one and silently lose the
 * supporting evidence — the exact failure the Stage D QA harness hit — so the
 * shape is required and `all` is read from it here.
 *
 * GROUPING IS A NARRATIVE RELATIONSHIP, NOT A LICENCE TO RECOMPUTE.
 *
 * Three roster items may belong to one story and still describe different
 * populations over different windows. Jacksonville: three defenders graduate
 * before 2027, two of them projected starters, and the eligibility cliff counts
 * five players across 2026 AND 2027 — of whom the 2026 row is the same three.
 * Nothing here sums, substitutes or reconciles those. Each keeps its own facts
 * and the client decides what to say.
 */

import { kindSpec, PERMISSION, assertSurfaceRenderable, confidenceAtLeast } from './kinds.js';
import { compareEvidence } from './rank.js';
import { topReasons } from './topReasons.js';
import { operatorFactsFor } from './operatorFacts.js';
import { EVIDENCE_KINDS } from './kinds.js';

/**
 * The sections of the operator surface, in reading order.
 *
 * Semantic groupings, not decision classes: a section answers "what kind of
 * thing is this about", while `decisionClass` answers "how much does it bear on
 * the decision". Both matter and they cut across each other — ROSTER_OPPORTUNITY
 * holds OPENING and CONTEXT items, DEVELOPMENT holds three different classes.
 */
export const SECTIONS = Object.freeze({
  ROSTER_OPPORTUNITY: 'ROSTER_OPPORTUNITY',
  RECRUITMENT_PATHWAY: 'RECRUITMENT_PATHWAY',
  DEVELOPMENT: 'DEVELOPMENT',
  ACADEMIC_PROGRAMME_FIT: 'ACADEMIC_PROGRAMME_FIT',
  PROGRAMME_CONTEXT: 'PROGRAMME_CONTEXT',
});

export const SECTION_KEYS = Object.freeze(Object.keys(SECTIONS));

/**
 * Which section each kind belongs to.
 *
 * Two placements are worth stating rather than leaving to be discovered.
 * POSITION_INTAKE_HISTORY and TRANSFER_BEHAVIOUR are `category: 'internal'` and
 * sit in RECRUITMENT_PATHWAY because that is what they describe — arrivals at a
 * position, and whether the programme signs transfers. Their internal category
 * is about email licensing, not about subject, and both are already
 * OPERATOR_EVIDENCE: ALLOWED.
 */
export const SECTION_OF = Object.freeze({
  POSITION_GRADUATION: SECTIONS.ROSTER_OPPORTUNITY,
  POSITION_GRADUATION_STARTERS: SECTIONS.ROSTER_OPPORTUNITY,
  POSITION_GROUP_SCARCITY: SECTIONS.ROSTER_OPPORTUNITY,
  RETURNING_POSITION_DEPTH: SECTIONS.ROSTER_OPPORTUNITY,
  ELIGIBILITY_CLIFF: SECTIONS.ROSTER_OPPORTUNITY,
  POSITION_GROUP_SIZE: SECTIONS.ROSTER_OPPORTUNITY,
  SQUAD_GRADUATION: SECTIONS.ROSTER_OPPORTUNITY,

  COACH_ARRIVAL_SAME_COUNTRY: SECTIONS.RECRUITMENT_PATHWAY,
  ARRIVAL_SAME_COUNTRY_POSITION: SECTIONS.RECRUITMENT_PATHWAY,
  ARRIVAL_SAME_REGION_POSITION: SECTIONS.RECRUITMENT_PATHWAY,
  HISTORICAL_SAME_COUNTRY: SECTIONS.RECRUITMENT_PATHWAY,
  CURRENT_SAME_COUNTRY: SECTIONS.RECRUITMENT_PATHWAY,
  HISTORICAL_SAME_REGION: SECTIONS.RECRUITMENT_PATHWAY,
  INTERNATIONAL_ROSTER: SECTIONS.RECRUITMENT_PATHWAY,
  INTERNATIONAL_SHARE: SECTIONS.RECRUITMENT_PATHWAY,
  POSITION_INTAKE_HISTORY: SECTIONS.RECRUITMENT_PATHWAY,
  TRANSFER_BEHAVIOUR: SECTIONS.RECRUITMENT_PATHWAY,

  PROGRAMME_DEVELOPMENT_PATTERN: SECTIONS.DEVELOPMENT,
  FRESHMAN_MINUTES_LADDER: SECTIONS.DEVELOPMENT,
  ATHLETE_COHORT_LADDER: SECTIONS.DEVELOPMENT,
  PROGRAMME_POOL_BENCHMARK: SECTIONS.DEVELOPMENT,

  ACADEMIC_FIT: SECTIONS.ACADEMIC_PROGRAMME_FIT,
  CONFERENCE_TITLE: SECTIONS.ACADEMIC_PROGRAMME_FIT,
  POSTSEASON_RESULT: SECTIONS.ACADEMIC_PROGRAMME_FIT,
  PROGRAM_MOMENTUM: SECTIONS.ACADEMIC_PROGRAMME_FIT,

  COACH_CONTEXT: SECTIONS.PROGRAMME_CONTEXT,
});

/**
 * Every kind must be placed, checked once at module load.
 *
 * Fails closed for the same reason the fact extractor does: a kind added later
 * with no section would otherwise land nowhere, or in an "other" bucket nobody
 * decided on. A new kind should require a decision before it reaches a surface.
 */
for (const kind of Object.keys(EVIDENCE_KINDS)) {
  if (!SECTION_OF[kind]) {
    throw new Error(`${kind} has no operator section. Add one in operatorEvidence.js.`);
  }
}
for (const [kind, section] of Object.entries(SECTION_OF)) {
  if (!SECTION_KEYS.includes(section)) {
    throw new Error(`${kind} is mapped to unknown section "${section}"`);
  }
}

/** Why an item is not shown in its section at all. */
export const EXCLUSION = Object.freeze({
  NOT_OPERATOR_LICENSED: 'NOT_OPERATOR_LICENSED',
  BELOW_CONFIDENCE: 'BELOW_CONFIDENCE',
});

/**
 * May this item appear in a section?
 *
 * Deliberately MORE permissive than the top-reasons gate, and the difference is
 * the point: a section is inspection, so neutral and context evidence belong
 * there. Only two things bar an item — the operator surface not being permitted
 * to show it, and its own confidence floor.
 *
 * The licensing half must agree with `topReasons`, which applies the same two
 * checks before its own polarity and class rules. A test pins that agreement,
 * because the two live in separate files and could drift.
 */
function exclusionFor(ev) {
  if (ev.permissions?.OPERATOR_EVIDENCE === PERMISSION.DENIED) {
    return EXCLUSION.NOT_OPERATOR_LICENSED;
  }
  try {
    assertSurfaceRenderable(ev, 'OPERATOR_EVIDENCE');
  } catch {
    return EXCLUSION.NOT_OPERATOR_LICENSED;
  }
  if (!confidenceAtLeast(ev.confidence, kindSpec(ev.kind).minConfidence)) {
    return EXCLUSION.BELOW_CONFIDENCE;
  }
  return null;
}

/**
 * The operator read model for one athlete-programme pairing.
 *
 * @param {object} evidenceResult  a `selectEvidence` / `evidenceFor` result.
 *   Required as the whole object, not an array — see the note at the top.
 */
export function operatorEvidenceFor(evidenceResult) {
  if (!evidenceResult || !Array.isArray(evidenceResult.all)) {
    throw new Error(
      'operatorEvidenceFor needs an evidenceFor result with its full `all` '
      + 'collection. A post-dedupe array (ranked, selected) loses supporting '
      + 'evidence and must not be passed.',
    );
  }
  /**
   * REQUIRED, with no default in either direction.
   *
   * A default of `false` would report every real programme as one we have
   * never heard of; a default of `true` would do the reverse for the one case
   * this field exists to name. Both are a claim about a school made by an
   * omission, which is how this surface lost every ACADEMIC_FIT once already.
   * A caller that cannot answer must say so by not calling.
   */
  if (typeof evidenceResult.programmeResolved !== 'boolean') {
    throw new Error(
      'operatorEvidenceFor needs `programmeResolved` on the result. Only '
      + '`evidenceFor` knows whether the name resolved to a programme we hold, '
      + 'and it must not be guessed from evidence counts.',
    );
  }
  const all = evidenceResult.all;

  // The existing policy, over the full set. Not reimplemented and not tuned.
  const reasons = topReasons(all);

  const sectionItems = new Map(SECTION_KEYS.map((k) => [k, []]));
  const excluded = [];

  for (const ev of all) {
    const why = exclusionFor(ev);
    if (why) {
      excluded.push({ kind: ev.kind, section: SECTION_OF[ev.kind], exclusion: why });
      continue;
    }
    sectionItems.get(SECTION_OF[ev.kind]).push(ev);
  }

  /**
   * Ordered by the existing comparator, audited section by section.
   *
   * `compareEvidence` leads on decision class, which could in principle read
   * oddly inside a semantic section — DEVELOPMENT holds a PATHWAY, two FIT and
   * a CONTEXT item. It does not: it puts the athlete's own cohort ladder first,
   * the programme-wide measurements next and the pool comparison last, which is
   * most-specific-to-least and a coherent reading order. Roster leads with
   * openings and ends with context; academic leads with the athlete's own
   * subject. So the existing comparator is used directly rather than a second
   * one being invented for sections.
   */
  const sections = Object.fromEntries(SECTION_KEYS.map((key) => [
    key,
    [...sectionItems.get(key)].sort(compareEvidence).map(operatorFactsFor),
  ]));

  const sectionCounts = Object.fromEntries(
    SECTION_KEYS.map((key) => [key, sections[key].length]),
  );
  const evidenceCount = SECTION_KEYS.reduce((n, key) => n + sections[key].length, 0);

  return {
    /**
     * Does this name correspond to a programme we hold?
     *
     * SEPARATE FROM EVERY EVIDENCE FIELD, and that separation is the whole
     * point. A resolved programme may legitimately have no evidence at all —
     * 247 men's and 33 women's programmes on file have no roster rows — and
     * until now that read identically to a name nobody recognised. A surface
     * asking "did we find this school" had to answer it by counting evidence,
     * which is not what an evidence count means.
     *
     * Deliberately just the one fact. `hasSquad` and `hasHistory` are a second
     * axis, already computed and already on `result.programme` for the email
     * panel; folding them into a single status enum would make one field
     * answer two questions. If the zero state later needs them, that is a
     * decision to publish them, not a derivation to invent here.
     */
    programme: {
      resolved: evidenceResult.programmeResolved,
    },

    /**
     * Enough state for a surface to distinguish every empty case without
     * inferring anything. `openingIdentified: false` records that the system did
     * not identify one — never that none exists.
     */
    summary: {
      reasonCount: reasons.reasons.length,
      hasPositiveReasons: reasons.reasons.length > 0,
      openingIdentified: reasons.openingIdentified,
      // Anything at all in any section, including neutral and context.
      hasEvidence: evidenceCount > 0,
      evidenceCount,
      generatedCount: all.length,
      sectionCounts,
    },

    /**
     * The top-reasons policy result, with every evidence object put through the
     * fact extractor. `supporting` is NEVER folded into `primary`: each keeps
     * its own facts, which is what lets a client render one coherent reason
     * without this layer having decided what the sentence says.
     */
    topReasons: reasons.reasons.map((r) => ({
      primary: operatorFactsFor(r.primary),
      supporting: r.supporting.map(operatorFactsFor),
      decisionClass: r.decisionClass,
      category: r.category,
      dedupeGroup: r.dedupeGroup,
      section: SECTION_OF[r.primary.kind],
    })),

    /**
     * Every licensed item, filed by subject.
     *
     * An item that is a top reason ALSO appears here. The two answer different
     * questions — a summary and an inspection — and removing it from its
     * section would make the section a lie about what we hold. A surface may
     * de-emphasise the repetition; the read model does not pre-empt that.
     */
    sections,

    /**
     * QA and support, not a surface payload. Names what was withheld and why,
     * without carrying the objects themselves.
     */
    diagnostics: {
      /**
       * Sorted by kind so the whole read model is order-independent.
       *
       * `topReasons` returns its dispositions in the order evidence was handed
       * to it, which is correct for that function — one row per input, in the
       * caller's order. Here it would make an otherwise deterministic payload
       * depend on generator order, so it is normalised in this layer rather
       * than by changing a function three surfaces already rely on.
       */
      excluded: [...excluded].sort((a, b) => a.kind.localeCompare(b.kind)),
      dispositions: [...reasons.dispositions].sort((a, b) => a.kind.localeCompare(b.kind)),
    },
  };
}
