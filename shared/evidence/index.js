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
import { selectFrom, MAX_EMAIL_EVIDENCE } from './select.js';
import { resolveStructure } from './structures.js';
import { composeStructured, paragraphFor } from '../email/compose.js';
import { renderEvidence } from './render.js';

export { buildProgrammeContext, generateEvidence, REGIONS, regionFor } from './generate.js';
export {
  selectFrom, priorityOf, MAX_EMAIL_EVIDENCE, MAX_PER_FAMILY, SLOT_FLOORS,
  DISPOSITION, FAMILY_LABELS, familyOf,
} from './select.js';
export {
  chooseStructure, resolveStructure, FLOWS, FLOW_KEYS, BLOCKS, EVIDENCE_BLOCKS,
  eligibleFlows, planPlacement, canOpenCold, MAX_GATHERED, LEGACY_STRUCTURE_KEYS,
  STRUCTURES, STRUCTURE_KEYS, eligibleStructures,
} from './structures.js';
export { composeStructured, evidenceSlots, structuredTemplate, paragraphFor } from '../email/compose.js';
export {
  factParts, signalParts, evidenceParts, isRecognition,
  renderEvidence, renderSentence, joinNames, EvidenceRenderError,
} from './render.js';
export {
  EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TIERS, CONFIDENCE, defineEvidence, kindSpec, isFact, isSignal,
  KIND_LABELS, kindLabel, TEMPORALITY, FRESHNESS_SENSITIVE, LEAD_SUITABILITY,
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
  const selection = selectFrom(evidence, { maxEmail, prefer });
  // Resolved AFTER selection, and against the selection: an operator who
  // swapped the evidence has changed which structures the email can honestly
  // carry, and a structure chosen before that would be describing a different
  // email. A request for an ineligible one is refused, not silently swapped.
  const structure = resolveStructure(selection, preferStructure);

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
  const renderCtx = {
    firstName: firstNameOf(subject.name),
    // Whether the introduction will name the athlete's subject, so the
    // academic clause can stop repeating it four lines later.
    academicIntro: selection.selected.some((e) => e.kind === 'ACADEMIC_FIT'),
  };

  // Rendering happens INSIDE composition now, because the slot decides which
  // variant a kind uses — the full "I saw X, so I thought Y" for the opener
  // and a bare clause for everything after. The text cannot be produced before
  // the placement is known.
  const composed = composeStructured(structure, selection.selected, renderCtx);
  const sentences = composed.sentences;

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
    ...selection,
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
    paragraph: evidenceParagraph(selection.selected, renderCtx),
  };
}

/**
 * Every selected clause as one paragraph.
 *
 * The single-paragraph form, for the templates that carry one
 * {{evidence_paragraph}} token — a saved template an operator has customised,
 * and anything written before structures existed. A structured email does not
 * use this: it places its evidence through the body, which is the whole point
 * of shared/email/compose.js.
 *
 * The FIRST clause takes the lead form — it opens the paragraph, so it carries
 * its own reasoning — and the rest are gathered under one lead-in, exactly as
 * a structured email's opening slot does. A customised template therefore gets
 * the same voice as a structured one, just all in one place.
 */
export function evidenceParagraph(selected = [], ctx = {}) {
  // Evidence objects straight through: `paragraphFor` renders them itself,
  // because the framing depends on position and cannot be decided before the
  // position is known.
  return paragraphFor(selected, ctx);
}

/**
 * The same paragraph, built from sentences somebody else already rendered.
 *
 * Exported so the browser can recombine the operator's chosen angles without a
 * round trip AND without gaining a renderer: it joins strings the server
 * wrote, and cannot manufacture a sentence from data. That distinction is the
 * whole reason the wire carries prose rather than evidence objects.
 *
 * The server re-renders from its own evidence at send time regardless, so a
 * client that got this wrong would change the preview and not the email.
 */
export function paragraphFromSentences(sentences = []) {
  return paragraphFor(sentences);
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

  return {
    primary_kind: result.primary?.kind ?? null,
    primary_tier: result.primary?.tier ?? null,
    primary_strength: result.primary?.strength ?? null,
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
      ranked: result.ranked.map((e) => ({ kind: e.kind, strength: e.strength, tier: e.tier })),
      internal: result.internal.map(compact),
      dispositions: result.dispositions ?? [],
      suppressed: result.suppressed,
      belowThreshold: result.belowThreshold ?? [],
      rejected: result.rejected,
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
