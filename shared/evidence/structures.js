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
 * the email. Once `leadSuitability` decided that a roster count, a programme
 * record and an academic match all read badly as the first line to a stranger,
 * three of them collapsed onto the same shape: introduce the athlete, then
 * explain what made this programme worth writing to.
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
 * SELECTION AND PRESENTATION ARE SEPARATE.
 *
 * Selection answers "what is worth mentioning" and is untouched by this file.
 * Placement answers "what is the most natural way to say it". So a
 * second-ranked NATURAL_LEAD moves ahead of a first-ranked CONTEXTUAL item for
 * PRESENTATION, while the selection order — and therefore `primary_kind` in
 * the log — stays exactly as ranked. Both are recorded; neither is rewritten
 * to match the other.
 */

import { LEAD_SUITABILITY, kindSpec } from './kinds.js';

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
 *
 * Two. Three reads as a list however well each is written — "I also noticed
 * you offer Kinesiology, and you've got one defender graduating, and you've
 * got a pretty international squad" is the sentence this prevents.
 */
export const MAX_GATHERED = 2;

const suitability = (ev) => kindSpec(ev.kind).leadSuitability;
const isRecognitionKind = (ev) => Boolean(kindSpec(ev.kind).recognition);

/** Evidence that can open an email cold, before the athlete is introduced. */
export function canOpenCold(ev) {
  return suitability(ev) === LEAD_SUITABILITY.NATURAL_LEAD && !isRecognitionKind(ev);
}

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
    eligible: (sel) => sel.selected.some(canOpenCold),
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
 * Which piece of evidence goes where.
 *
 * Order within each block follows SELECTION order, so the ranking is visible
 * in the email wherever placement does not override it. The only reordering is
 * the one placement exists to do: lifting a NATURAL_LEAD to the hook, and
 * lifting a congratulation out of the prose.
 *
 * `held` is evidence that was selected and is deliberately not displayed. The
 * email does not have to carry everything worth logging, and a fourth
 * observation is where a note becomes a report.
 */
export function planPlacement(selected = [], flowKey = 'PLAYER_FIRST') {
  const queue = [...selected];

  // Congratulations come out first, wherever they ranked. They are their own
  // sentence and never part of the reasoning.
  const recognition = queue.filter(isRecognitionKind);
  const rest = queue.filter((ev) => !isRecognitionKind(ev));

  // The hook, only in the flow that has one. `find` takes the highest-ranked
  // NATURAL_LEAD, so among equals the ranking still decides.
  const hook = flowKey === 'RELATIONSHIP_FIRST' ? rest.find(canOpenCold) ?? null : null;
  const remaining = rest.filter((ev) => ev !== hook);

  /**
   * The relevance paragraph.
   *
   * With a hook, the reasoning has already been given, so this paragraph is
   * gathered clauses only. Without one, its first item carries the reasoning
   * and the rest are gathered behind it — so a hookless email still explains
   * itself, just after the introduction instead of before it.
   */
  const capacity = hook ? MAX_GATHERED : MAX_GATHERED + 1;
  const chosen = remaining.slice(0, capacity);

  /**
   * Without a hook, the FIRST relevance item carries the reasoning — so it is
   * the sentence that explains why we wrote, and a SUPPORT_ONLY kind must not
   * be the one doing it. At Elon the academic match outranked the graduating
   * defender and opened with "I noticed you offer Kinesiology, so it lines up
   * with what Rhys wants to study", which is not a reason to have written to a
   * soccer coach.
   *
   * Presentation only, and only within what was already selected: the
   * strongest CONTEXTUAL item moves in front of the SUPPORT_ONLY ones, and
   * everything keeps its relative order otherwise. With no CONTEXTUAL item
   * available the support evidence still leads, because saying the one thing
   * we know beats saying nothing.
   */
  const relevance = hook ? chosen : leadWithContextual(chosen);

  // One congratulation. CONFERENCE_TITLE and POSTSEASON_RESULT share a dedupe
  // group so selection already prevents both, but two congratulations in one
  // email is bad enough to be worth refusing here as well.
  const shownRecognition = recognition.slice(0, 1);

  return {
    hook,
    relevance,
    recognition: shownRecognition,
    held: [...remaining.slice(capacity), ...recognition.slice(1)],
  };
}

/**
 * Moves a CONTEXTUAL item in front of a SUPPORT_ONLY one, order otherwise
 * intact.
 *
 * Only when the first item is SUPPORT_ONLY. A NATURAL_LEAD at the front is
 * left exactly where it is — it is the best thing available at carrying a
 * reason, and displacing it would be the same mistake in reverse.
 */
function leadWithContextual(items) {
  if (!items.length || suitability(items[0]) !== LEAD_SUITABILITY.SUPPORT_ONLY) return items;
  const i = items.findIndex((ev) => suitability(ev) === LEAD_SUITABILITY.CONTEXTUAL);
  if (i <= 0) return items;
  return [items[i], ...items.filter((_, n) => n !== i)];
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

/** The flow to use, and the ones that were also available. */
export function chooseStructure(selection) {
  const eligible = eligibleFlows(selection);
  return describe(eligible[0] ?? 'PLAYER_FIRST', eligible, 'ENGINE');
}

/**
 * The flow to use when an operator asked for a particular one.
 *
 * Validated against the SAME eligibility list the engine chooses from, so a
 * manual choice cannot open an email on a relationship the evidence does not
 * support. A request for an ineligible or unknown flow is refused and
 * recorded — not honoured, and not silently swapped either, because an
 * operator who asked for something and got something else needs to be told.
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
