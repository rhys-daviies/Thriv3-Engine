/**
 * Email flows: the two shapes an approach can take, and where each piece of
 * evidence lands inside them.
 *
 * A flow is an ordered list of blocks plus a predicate. It is not prose. The
 * copy for each block lives in shared/email/blocks.js and the assembly in
 * shared/email/compose.js; the factual wording lives in render.js. This file
 * decides ORDER and PLACEMENT and nothing else.
 *
 * ---------------------------------------------------------------------------
 * TWO FLOWS, WHERE THERE WERE FIVE.
 *
 * The five — INTERNATIONAL_CONNECTION, ACADEMIC_FIT, ROSTER_OPPORTUNITY,
 * EVIDENCE_FIRST, PLAYER_FIRST — were distinguished by which evidence opened
 * the email. Once it was settled that a roster count, a programme record and
 * an academic match all read badly as the first line to a stranger, three of
 * them collapsed onto the same shape: introduce the athlete, then explain what
 * made this programme worth writing to.
 *
 * What remains is the one distinction that carries meaning:
 *
 *   Do we have a genuinely natural reason to address THIS coach before the
 *   athlete has been introduced?
 *
 * Yes -> RELATIONSHIP_FIRST. No -> PLAYER_FIRST. Structures were not kept for
 * variety's sake; artificial variety is what the old set had become.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAY OPEN AN EMAIL IS NOT DECIDED HERE.
 *
 * A claim opens cold if and only if its ROLE is HOOK, and roles come from
 * `outreachEvidenceFor`. This file had a second answer to that question until
 * H4 — `leadSuitability`, a three-valued property on every kind, read through
 * a `canOpenCold` predicate. The two agreed for all 26 kinds, but only one of
 * them was reachable: production has supplied `roles` since G4, so the
 * predicate had been answering nobody for two stages while still looking like
 * policy. Agreement maintained by nothing is a coincidence with a deadline.
 *
 * Selection answers "what is worth mentioning" and is untouched here.
 * Placement answers "in what order, in which block" — and takes the roles as
 * given.
 */

/**
 * The blocks a flow can order.
 *
 * Three of them carry evidence, and each has a distinct job:
 *
 *   HOOK        one NATURAL_LEAD, before the introduction. Why this coach.
 *   RELEVANCE   what made the programme worth writing to, after the athlete
 *               has been introduced.
 *   RECOGNITION a programme congratulation, on its own, late.
 */
export const BLOCKS = Object.freeze({
  GREETING: 'GREETING',
  HOOK: 'HOOK',
  ATHLETE_INTRO: 'ATHLETE_INTRO',
  RELEVANCE: 'RELEVANCE',
  CREDENTIALS: 'CREDENTIALS',
  RECOGNITION: 'RECOGNITION',
  PROFILE: 'PROFILE',
  CTA: 'CTA',
  SIGNOFF: 'SIGNOFF',
});

/** The blocks that hold evidence, in the order a reader meets them. */
export const EVIDENCE_BLOCKS = Object.freeze([
  BLOCKS.HOOK, BLOCKS.RELEVANCE, BLOCKS.RECOGNITION,
]);

/**
 * How many observations may be gathered into the relevance paragraph beyond
 * the sentence that opens it.
 */

export const FLOWS = Object.freeze({
  /**
   * We have a genuine reason to be writing to this coach in particular.
   *
   * The hook explains it before the athlete is named, which is what makes the
   * introduction that follows read as a consequence rather than as a mailshot.
   */
  RELATIONSHIP_FIRST: {
    label: 'Relationship first',
    blocks: [
      BLOCKS.GREETING,
      BLOCKS.HOOK,
      BLOCKS.ATHLETE_INTRO,
      BLOCKS.RELEVANCE,
      BLOCKS.CREDENTIALS,
      BLOCKS.RECOGNITION,
      BLOCKS.PROFILE,
      BLOCKS.CTA,
      BLOCKS.SIGNOFF,
    ],
    /**
     * A HOOK, and nothing else, decides this.
     *
     * Roles come from `outreachEvidenceFor`, which has already asked whether a
     * claim may open cold — that is what HOOK means. There is no fallback:
     * a selection that arrives without roles gets PLAYER_FIRST, because the
     * absence of role data is not evidence of a relationship. Re-deriving one
     * from kind metadata is how the second lead policy got here in the first
     * place.
     */
    eligible: (sel) => (sel?.roles?.hooks?.length ?? 0) > 0,
  },

  /**
   * We do not, so we say who the athlete is and then what we noticed.
   *
   * The introduction and the relevance paragraph are one continuous thought —
   * who the player is, then why this programme came to mind — which is why the
   * credentials sit after them in both flows rather than between them.
   */
  PLAYER_FIRST: {
    label: 'Player first',
    blocks: [
      BLOCKS.GREETING,
      BLOCKS.ATHLETE_INTRO,
      BLOCKS.RELEVANCE,
      BLOCKS.CREDENTIALS,
      BLOCKS.RECOGNITION,
      BLOCKS.PROFILE,
      BLOCKS.CTA,
      BLOCKS.SIGNOFF,
    ],
    eligible: () => true,
  },
});

export const FLOW_KEYS = Object.freeze(Object.keys(FLOWS));

/**
 * The keys the log already carries, mapped to what replaced them.
 *
 * Reporting only. Nothing selects a flow through this map — an old key is not
 * eligible for a new send, it is only readable in an old row. Every row
 * written under the six-key and five-key sets predates composition changing
 * any wording at all; see evidencePerformance.js.
 */
export const LEGACY_STRUCTURE_KEYS = Object.freeze({
  INTERNATIONAL_CONNECTION: 'RELATIONSHIP_FIRST',
  ACADEMIC_FIT: 'PLAYER_FIRST',
  ACADEMIC_FIRST: 'PLAYER_FIRST',
  ROSTER_OPPORTUNITY: 'PLAYER_FIRST',
  ROSTER_FIRST: 'PLAYER_FIRST',
  EVIDENCE_FIRST: 'PLAYER_FIRST',
  PROGRAM_SUCCESS: 'PLAYER_FIRST',
  SHORT: 'PLAYER_FIRST',
});

/** Specific before general: the fallback is always eligible and must be last. */
export const FLOW_PREFERENCE = Object.freeze(['RELATIONSHIP_FIRST', 'PLAYER_FIRST']);

export function eligibleFlows(selection) {
  return FLOW_PREFERENCE.filter((key) => FLOWS[key].eligible(selection));
}

/**
 * Placement from ROLES — the only placement there is.
 *
 * There was a second one, `planPlacement`, written before roles existed: it
 * inferred a hook from `leadSuitability` and a congratulation from a registry
 * flag, and by G4 nothing called it. This takes the roles as given.
 * `outreachEvidenceFor` has already decided what may open cold, what may only
 * follow the introduction, and what is a congratulation, under a licence and a
 * qualification rule per kind.
 *
 * ---------------------------------------------------------------------------
 * ONE HOOK, ONE RELEVANCE, ONE RECOGNITION. SELECTED IS NOT RENDERED.
 *
 * The selector permits up to three body facts; composition renders at most
 * two, and never three. A first approach that lists everything true about a
 * programme reads as a report however well each sentence is written — the
 * measured example being "you've got three defenders graduating in 2027 (…),
 * and you offer Kinesiology", two unrelated observations joined by an "and"
 * that carries no thought.
 *
 * What is selected and not rendered is still logged and still offered to the
 * operator, so "we knew this and chose not to lead with it" stays a visible
 * decision rather than a silent drop.
 *
 * @param {object} roles  an `outreachEvidenceFor` result
 * @param {Map}    byKind evidence objects by kind, for the renderer
 */
export function planFromRoles(roles, byKind, flowKey = 'PLAYER_FIRST') {
  const obj = (item) => byKind.get(item.kind) ?? null;
  const hookItem = flowKey === 'RELATIONSHIP_FIRST' ? roles.hooks[0] ?? null : null;
  const hook = hookItem ? obj(hookItem) : null;

  /**
   * Without a hook block, the strongest hook still has something to say — it
   * simply says it after the introduction instead of before it. A programme
   * we have a real pathway to must not become a generic email because the
   * flow lost its opening slot.
   */
  const body = flowKey === 'RELATIONSHIP_FIRST'
    ? roles.relevance
    : [...roles.hooks, ...roles.relevance];

  const shown = body.slice(0, 1);
  const heldItems = [
    ...body.slice(1),
    ...roles.recognition.slice(1),
  ];

  return {
    hook,
    relevance: shown.map(obj).filter(Boolean),
    recognition: (roles.recognition[0] ? [obj(roles.recognition[0])] : []).filter(Boolean),
    held: heldItems.map(obj).filter(Boolean),
    // The role each rendered object was carrying, so composition never has to
    // guess it back from the registry.
    roleOf: new Map([...roles.hooks, ...roles.relevance, ...roles.recognition]
      .map((i) => [i.kind, i.role])),
    itemOf: new Map([...roles.hooks, ...roles.relevance, ...roles.recognition]
      .map((i) => [i.kind, i])),
  };
}

function describe(key, eligible, source) {
  const f = FLOWS[key];
  return {
    key,
    label: f.label,
    blocks: f.blocks,
    eligible,
    // ENGINE or OPERATOR. Logged separately from the key: a manually chosen
    // flow is a different treatment from one the engine reached on its own,
    // and mixing them would make the first reply-rate comparison meaningless
    // in a way nobody could see afterwards.
    source,
    refusedRequest: null,
  };
}

/**
 * The flow to use, and the ones that were also available.
 *
 * THE ONLY CHOOSER. There was a second, `chooseStructure`, which was this
 * function's `requested === null` branch written out separately; every caller
 * came here instead, because an operator preference has to be validated
 * against the same eligibility list the engine chooses from — and a chooser
 * that could not be given one had nothing to validate.
 *
 * A manual choice therefore cannot open an email on a relationship the
 * evidence does not support. A request for an ineligible or unknown flow is
 * refused and recorded — not honoured, and not silently swapped either, because
 * an operator who asked for something and got something else needs to be told.
 */
export function resolveStructure(selection, requested = null) {
  const eligible = eligibleFlows(selection);
  const fallback = eligible[0] ?? 'PLAYER_FIRST';
  if (!requested) return describe(fallback, eligible, 'ENGINE');
  if (!eligible.includes(requested)) {
    return {
      ...describe(fallback, eligible, 'ENGINE'),
      refusedRequest: {
        key: requested,
        reason: FLOWS[requested]
          ? 'the evidence selected for this programme does not support it'
          : 'unknown flow',
      },
    };
  }
  return describe(requested, eligible, 'OPERATOR');
}

// Kept under the old names so callers that speak of "structures" keep working:
// the log column, the wire field and the operator control are all named that,
// and renaming them would be a logging change rather than a composition one.
export const STRUCTURES = FLOWS;
export const STRUCTURE_KEYS = FLOW_KEYS;
export const STRUCTURE_PREFERENCE = FLOW_PREFERENCE;
export const eligibleStructures = eligibleFlows;
