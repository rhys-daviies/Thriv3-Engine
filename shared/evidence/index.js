/**
 * The Program Intelligence -> Email Evidence engine.
 *
 * One entry point, `selectEvidence(athlete, programme)`, which answers: what
 * do we actually know about this pairing, which of it is worth saying, how
 * should the email be shaped, and what should we record so we can find out
 * later whether any of it worked.
 *
 * Pure, like shared/matching. It takes rows a caller fetched — the Node
 * drafting CLI reads them from SQLite, a route would read them the same way,
 * the tests hand-build them — because the alternative is an engine that only
 * runs in one of those places.
 *
 * It sits ALONGSIDE the matching model and changes nothing about it. Matching
 * asks how suitable a programme is; this asks what gives us a genuine reason
 * to write. Those are different questions and the answers disagree often:
 * a programme can be an excellent match with nothing specific to say about it,
 * and a mediocre one can have four New Zealanders in its recent history.
 */

import { canonicalPosition } from '../positions.js';
import { buildProgrammeContext, generateEvidence } from './generate.js';
import { MAX_EMAIL_EVIDENCE, priorityOf } from './select.js';
import { resolveStructure } from './structures.js';
import { composeOutreach } from '../email/compose.js';
import { outreachEvidenceFor, applyPrefer, internalEvidence } from './outreachEvidence.js';
import { renderEvidence, DEFAULT_HOOK_FRAMING } from './render.js';

export { buildProgrammeContext, generateEvidence, REGIONS, regionFor } from './generate.js';
export {
  priorityOf, MAX_EMAIL_EVIDENCE, FAMILY_LABELS, familyOf, outreachPermitted, meetsConfidence,
} from './select.js';
export {
  resolveStructure, FLOWS, FLOW_KEYS, BLOCKS, EVIDENCE_BLOCKS,
  eligibleFlows, LEGACY_STRUCTURE_KEYS,
  STRUCTURES, STRUCTURE_KEYS, eligibleStructures,
} from './structures.js';
export { composeOutreach, outreachSlots, structuredTemplate } from '../email/compose.js';
export {
  factParts, signalParts, evidenceParts, isRecognition,
  renderEvidence, renderSentence, joinNames, EvidenceRenderError,
} from './render.js';
export {
  EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TIERS, CONFIDENCE, defineEvidence, kindSpec, isFact, isSignal,
  KIND_LABELS, kindLabel, TEMPORALITY, FRESHNESS_SENSITIVE,
  assertSurfaceRenderable, COMPARISON_BANDS, COMPARISON_BAND_KEYS,
  DECISION_CLASS, DECISION_CLASS_KEYS, POLARITY, POLARITY_KEYS,
} from './kinds.js';
export {
  FRESHNESS, FRESH_DAYS, ACCEPTABLE_DAYS, rosterFreshness, applyFreshness,
  ageInDays, isFreshnessSensitive,
} from './freshness.js';
export { TEMPLATE_VARIANTS, templateVariant } from './templateVariant.js';

/**
 * Normalises a `players` row (or an already-normalised matching athlete) into
 * what the generators read.
 *
 * Accepts both shapes because the two callers have different objects in hand:
 * the CLI holds a raw database row, while anything downstream of
 * `normaliseAthlete` holds the matching model's version. Getting a raw row
 * where a normalised one was expected used to mean `country` was undefined and
 * every international generator silently returned null.
 */
export function normaliseEvidenceAthlete(player = {}) {
  const nationality = player.nationality ?? null;
  return {
    name: player.full_name ?? player.name ?? null,
    // Canonicalised, never upper-cased: "Defender" upper-cases to DEFENDER,
    // which matches no cohort key and no roster position, and every position
    // generator would return null while looking entirely reasonable.
    position: canonicalPosition(player.position),
    classYear: numOrNull(player.classYear ?? player.recruiting_class_year ?? player.graduation_year),
    // `country` is null for a domestic athlete by design — there is no "own
    // country" pipeline to look for — and mirrors normaliseAthlete in pool.js.
    country: player.country ?? (nationality && nationality !== 'USA' ? nationality : null),
    nationality,
    intendedMajor: player.intendedMajor ?? player.intended_major ?? null,
    sport: player.sport ?? 'mens-soccer',
  };
}

/**
 * Everything we know about one athlete at one programme.
 *
 * @param {object} athlete   a players row, or a normalised athlete
 * @param {object} programme {college, match, squad, history, coachRows, sport}
 *   `squad` is the roster for the season being recruited into, `history` the
 *   earlier seasons, `match` the row this programme got from rankMatches, and
 *   `coachRows` its coach_seasons. Every one of them is optional: a missing
 *   input removes the evidence that depended on it and never fabricates a zero.
 */
export function selectEvidence(athlete, programme = {}, {
  maxEmail = MAX_EMAIL_EVIDENCE, prefer = null, preferStructure = null,
} = {}) {
  const subject = normaliseEvidenceAthlete(athlete);
  const ctx = buildProgrammeContext(programme);
  const evidence = generateEvidence(subject, ctx);

  /**
   * ONE SELECTOR RUNS. `selectFrom` is not it, and no longer runs at all.
   *
   * It decided nothing outbound after G4 and explained nothing after H6, and
   * it was still executing on every request — sorting the whole collection by
   * strength, deduping it, filling slot floors and building a parallel
   * disposition log — so that four fields could be derived from it. Three of
   * those were diagnostics nothing read. The fourth, `internal`, is a licence
   * question, and `internalEvidence` answers it from the registry.
   *
   * What was lost with it: the legacy ranking, `engineSelected` as "what the
   * old engine would have picked", and the side-by-side policy comparison.
   * Two policies were worth comparing while one was being replaced by the
   * other; that finished at G4, and the comparison has answered no question
   * since. It is still computable — `selectFrom` is exported and tested — and
   * a request no longer pays for it.
   */
  const roles = outreachEvidenceFor({ all: evidence });
  const byKind = new Map(evidence.map((ev) => [ev.kind, ev]));
  /**
   * The operator's own choice, applied to the LICENSED set.
   *
   * `prefer` carries kind names and is matched against what survived the
   * licence, the qualification and the dedupe — so it may change WHICH true,
   * sayable thing opens the email and in what order, and can never introduce a
   * denied kind, bypass a qualification, turn a congratulation into a hook or
   * make a relevance claim open cold. A role is a property of the kind, not of
   * the operator's preference.
   */
  const applied = applyPrefer(roles, prefer);

  /**
   * What the email actually carries, in the order it carries it.
   *
   * SELECTED IS NOT RENDERED. The selector licenses up to three body claims;
   * composition renders at most two. `selected` is the licensed set — logged,
   * offered to the operator, available to swap — and `sentences` is what a
   * coach will read.
   */
  const selected = [...applied.hooks, ...applied.relevance, ...applied.recognition]
    .map((i) => byKind.get(i.kind)).filter(Boolean);

  // Resolved AFTER selection and against the ROLES: an operator who swapped
  // the evidence has changed which structures the email can honestly carry,
  // and a request for an ineligible one is refused rather than swapped.
  //
  // `selected` was the LEGACY selector's list here until H7. `eligibleFlows`
  // has read only `roles` since H4, so it changed nothing — but a function
  // being handed one engine's answer to decide another engine's shape is the
  // arrangement this stage exists to remove, whether or not it was read.
  const structure = resolveStructure({ selected, roles: applied }, preferStructure);

  /**
   * What the copy layer needs to write like a person rather than a report.
   *
   * The first name lets a clause say why this programme made us think of THIS
   * player. It is the first name and never a pronoun: `players` stores no
   * gender or pronoun field, and inferring one from the sport would be a guess
   * about a real person that is wrong for anyone it is wrong for.
   *
   * Nothing here reaches the client. It is an input to rendering, and what
   * crosses the wire is still the rendered prose.
   */
  const renderCtx = { firstName: firstNameOf(subject.name) };

  // Rendering happens INSIDE composition, because the slot decides how a claim
  // is framed and the text cannot be produced before placement is known.
  const composed = composeOutreach(structure, applied, byKind, renderCtx);
  const sentences = composed.sentences;

  const renderedKinds = new Set(sentences.map((x) => x.kind));

  return {
    athlete: subject,
    programme: {
      name: ctx.college?.name ?? null,
      sport: ctx.sport,
      // Said out loud rather than inferred from empty arrays downstream. This
      // is the flag that keeps "we have no roster" from being read as "they
      // have nobody" — the distinction the whole fallback path turns on.
      hasSquad: ctx.hasSquad,
      hasHistory: ctx.hasHistory,
      squadSize: ctx.squadSize,
      // How old the roster behind any present-tense claim is. Reported even
      // when nothing was affected, so the operator view can explain a
      // downgrade and the log can record what the claim rested on.
      freshness: ctx.freshness,
      rosterUpdatedAt: ctx.rosterUpdatedAt,
      rosterAgeDays: ctx.freshness?.ageDays ?? null,
      rosterSeason: ctx.match?.roster_season ?? null,
    },
    /**
     * Everything generated, in generation order.
     *
     * It used to arrive sorted by the legacy engine's `priorityOf`. Nothing
     * downstream reads the order — `toWire` builds a Map, the reports group by
     * kind — and a ranking is a policy this file no longer runs.
     */
    all: evidence,
    /**
     * What we know and may not send, from the licence.
     *
     * See `internalEvidence`: not permitted for OUTREACH, and clearing its own
     * confidence floor. The same set `selectFrom` produced across all 3,498
     * live pairings, which is the point — the set did not change, only who
     * computes it.
     *
     * STRONGEST FIRST, and `priorityOf` rather than plain `strength`, because
     * that is the order the panel's drawer has always shown and an ownership
     * change should not silently reorder a list an operator reads. Measured
     * rather than assumed: the two orderings differ on 2,463 of the 3,498
     * pairings, so "sort by strength, it comes to the same thing" would have
     * been wrong. `priorityOf` is a comparator, not the legacy policy — what
     * H7 removed is `selectFrom`, the ranking-plus-dedupe-plus-slot-floors
     * engine, and a shared sort key is not that.
     */
    internal: [...internalEvidence(evidence)].sort((a, b) => priorityOf(b) - priorityOf(a)),
    /**
     * WHAT BECAME OF EACH KIND, ACCORDING TO THE ENGINE THAT DECIDED IT.
     *
     * Overwrites the legacy log's `dispositions` from the spread above, which
     * is the whole point: the legacy selector ranks by strength across
     * nineteen kinds under a different policy, and it was explaining outbound
     * decisions it did not make. At five programmes the two picked different
     * congratulations, so the panel labelled the claim it was sending
     * "suppressed as redundant" and offered the one it was not with no
     * explanation at all.
     *
     * Taken from `applied` rather than `roles`, so an operator's own ordering
     * is reflected here too — the state describes the email as it now stands.
     * The legacy answer is still computed and still returned, under `legacy`,
     * where it explains itself and nothing else.
     */
    dispositions: applied.dispositions ?? [],
    /**
     * Whether a human overrode the selector, and what they asked for that we
     * could not honour.
     *
     * From `applied`, which is the function that honoured or refused it. These
     * came from the legacy selector until H7 — a second, differently-scoped
     * `prefer` implementation matching against its own survivor list — so the
     * wire reported one function's answer about another function's decision.
     */
    operatorSelected: applied.operatorSelected ?? false,
    unavailableRequests: applied.unavailableRequests ?? [],
    /**
     * What the selector chose before the operator touched it.
     *
     * Logged so an analysis can ask whether operators improved on the engine.
     * It named the LEGACY engine's pick until H7, which had not been the
     * engine for two stages.
     */
    engineSelected: [...roles.hooks, ...roles.relevance, ...roles.recognition].map((i) => i.kind),
    // What the licence permits.
    selected,
    primary: selected[0] ?? null,
    secondary: selected[1] ?? null,
    /**
     * The outbound roles, carried whole.
     *
     * Kept rather than flattened so the log, the panel and any future surface
     * read the same three lists the composer did — a caller that had to
     * re-derive a role from the registry would be a second policy.
     */
    roles: applied,
    hasPersonalisation: applied.hasPersonalisation,
    renderedKinds: [...renderedKinds],
    structure,
    // Rendered here so callers never have to know which renderer to use for
    // which tier — the one place that decision could still be got wrong.
    sentences,
    // The structured body's own template and its filled evidence slots. A
    // caller that wants the composed email runs `fillTemplate` over
    // `composition.template` with a context carrying `composition.tokens`;
    // one that wants the old single-paragraph behaviour reads `paragraph`.
    composition: composed,
    // The finished paragraph, so a caller across a network boundary never has
    // to re-render. The browser composer receives this string rather than the
    // evidence objects that produced it, which means the client cannot render
    // a SIGNAL through a FACT sentence even by mistake — it has no renderer.
    /**
     * The one-paragraph form, for a saved template carrying a single
     * {{evidence_paragraph}} token. Built from the SAME rendered sentences the
     * structured body uses, so a customised template cannot say something the
     * composed email would not.
     */
    paragraph: sentences.map((x, i) => {
      const t = x.text;
      // The first clause carries the framing that makes it a sentence; the
      // rest are clauses too and need a capital of their own. Recognition
      // items already arrive as whole sentences.
      if (i === 0) return `${DEFAULT_HOOK_FRAMING} ${t}.`;
      if (/^[A-Z]/.test(t) && /[.!?]$/.test(t)) return t;
      return `${t[0].toUpperCase()}${t.slice(1)}.`;
    }).join(' '),
  };
}

/**
 * What gets written to `outreach_evidence` at send time.
 *
 * Normalised columns for the questions we already know we will ask — does
 * HISTORICAL_SAME_COUNTRY out-reply POSITION_GRADUATION — plus the whole
 * picture as JSON for the ones we have not thought of. Suppressed and rejected
 * evidence is included deliberately: "this was available and we did not use
 * it" is what makes a later comparison possible rather than merely suggestive.
 */
export function evidenceLogPayload(result, { renderedKinds = null } = {}) {
  const placed = result.composition?.placement ?? [];
  const placement = new Map(placed.map((p) => [p.kind, p.slot]));
  // Selected but not carried by the email — the composer caps a paragraph at
  // two gathered clauses. Logged as selected-and-undisplayed rather than
  // dropped, so an analysis can tell "we chose not to say it" from "we never
  // had it", and `rendered` below stays false for it either way.
  const displayed = new Map(placed.map((p) => [p.kind, p.displayed !== false]));
  /**
   * Per-item render status.
   *
   * `renderedKinds` is the set the SEND PATH observed in the body it actually
   * handed to Outlook — not a prediction from the engine. Null means nobody
   * checked, which is a third state and not the same as "none survived": a CLI
   * dry run has no body to check against, and recording that as zero rendered
   * would understate every angle in the report.
   *
   * This is the brief's requirement that a three-item paragraph edited down to
   * one is not logged as three claims delivered. Without it the first
   * comparison of evidence kinds would be measuring what we selected rather
   * than what a coach read.
   */
  const renderedFor = (kind) => (renderedKinds ? renderedKinds.has(kind) : null);

  const selectedDetail = result.selected.map((e, i) => ({
    order: i,
    kind: e.kind,
    tier: e.tier,
    category: e.category,
    strength: e.strength,
    confidence: e.confidence,
    slot: placement.get(e.kind) ?? null,
    displayed: displayed.get(e.kind) ?? false,
    rendered: renderedFor(e.kind),
  }));

  /**
   * The claim this email rests on.
   *
   * ROLE, NOT RANKING. The legacy `primary` was `selected[0]` from an engine
   * that ranked by strength and category prior, so it reported ACADEMIC_FIT as
   * the primary of 701 emails — a kind that was SUPPORT_ONLY and never opened
   * one of them. The log said the email led on a sentence the email did not
   * contain.
   *
   * Defined now as: the HOOK if there is one, otherwise the first RELEVANCE
   * claim, otherwise nothing. A RECOGNITION item is never primary — a
   * congratulation is not why we wrote, and counting it would make the
   * reply-rate comparison between angles measure the wrong thing.
   */
  const roles = result.roles ?? { hooks: [], relevance: [], recognition: [] };
  const primaryItem = roles.hooks[0] ?? roles.relevance[0] ?? null;
  const primaryEvidence = primaryItem
    ? result.selected.find((e) => e.kind === primaryItem.kind) ?? null
    : null;

  return {
    primary_kind: primaryEvidence?.kind ?? null,
    primary_tier: primaryEvidence?.tier ?? null,
    primary_strength: primaryEvidence?.strength ?? null,
    /** Which role carried it, so an analysis never has to infer it back. */
    primary_role: primaryItem?.role ?? null,
    /** The hook specifically, when there was one. */
    hook_kind: roles.hooks[0]?.kind ?? null,
    /**
     * Whether this email said anything about THIS athlete at THIS programme.
     * Recognition alone is false — see `outreachEvidenceFor`.
     */
    has_personalisation: result.hasPersonalisation ?? false,
    secondary_kind: result.secondary?.kind ?? null,
    secondary_tier: result.secondary?.tier ?? null,
    secondary_strength: result.secondary?.strength ?? null,
    structure: result.structure?.key ?? null,
    // ENGINE or OPERATOR. A manually chosen structure is a different
    // treatment and has to be separable from the engine's own choice.
    structure_source: result.structure?.source ?? null,
    evidence_count: result.selected.length,
    /**
     * The ordered selected set as one groupable value.
     *
     * A comma-joined list of kinds in the order they appear in the email, so
     * "which COMBINATION replied best" is a GROUP BY rather than a JSON
     * extract. Order is part of the identity deliberately: leading with the
     * country connection and supporting with the roster is a different email
     * from the reverse, and collapsing them would hide exactly the effect
     * structures were built to create.
     */
    selected_kinds: result.selected.map((e) => e.kind).join(',') || null,
    rendered_count: renderedKinds
      ? result.selected.filter((e) => renderedKinds.has(e.kind)).length
      : null,
    payload: {
      selected: result.selected.map(compact),
      // The ordered set with its slot and its render status — the first-class
      // record the brief asks for, beside the convenience columns above.
      selectedDetail,
      engineSelected: result.engineSelected ?? [],
      internal: result.internal.map(compact),
      /**
       * What became of each kind, from the engine that decides outbound.
       *
       * Named without a qualifier because it is the answer: SELECTED with an
       * order for what is being sent, DEDUPED with the claim that superseded
       * it, and the licence, confidence, qualification and cap outcomes for
       * the rest. It read the legacy log until H6, so five programmes are on
       * record with the sent claim marked suppressed.
       */
      dispositions: result.dispositions ?? [],
      /**
       * The legacy selector's parallel account is gone from here.
       *
       * H6 gave these four fields a `legacy_` prefix so they could not be read
       * as this surface's answer. H7 asked the next question — who reads them —
       * and the answer was nobody. They recorded what a policy replaced at G4
       * would have done, on every send, forever. `dispositions` above is the
       * account of the engine that actually decided.
       */
      structureEligible: result.structure?.eligible ?? [],
      structureSource: result.structure?.source ?? null,
      structureRefused: result.structure?.refusedRequest ?? null,
      unavailableRequests: result.unavailableRequests ?? [],
      programme: result.programme,
      sentences: result.sentences,
    },
  };
}

const compact = (e) => ({
  kind: e.kind, tier: e.tier, strength: e.strength, confidence: e.confidence,
  category: e.category, season: e.season, source: e.source, data: e.data,
});

/** "Rhys Davies" -> "Rhys". A mononym renders as itself rather than as nothing. */
function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ranking primitives. Pure, and read by no surface yet — the operator policy
 * that turns an ordering into top reasons is deliberately not built, so the
 * ordering can be read against real data before slot rules hide it.
 */
export {
  compareEvidence, rankEvidence, decisionClassRank, specificityRank,
  specificityKey, confidenceRank, rankingMetadata,
} from './rank.js';

/**
 * The operator Top Reasons policy. Internal in this step — no route, no UI,
 * and nothing in outreach or matching reads it.
 */
export { topReasons, MAX_REASONS, MAX_PER_CATEGORY, OPERATOR_DISPOSITION } from './topReasons.js';

/**
 * Operator fact extraction. Internal in this step — no route reads it, and the
 * existing composer wire is untouched.
 */
export {
  operatorFactsFor, operatorFactsForAll, qualificationFor, EXPOSURE,
} from './operatorFacts.js';

/**
 * The operator read model. Internal in this step — no route, no serializer, no
 * UI, and the existing composer wire is untouched.
 */
export {
  operatorEvidenceFor, SECTIONS, SECTION_KEYS, SECTION_OF, EXCLUSION,
} from './operatorEvidence.js';
