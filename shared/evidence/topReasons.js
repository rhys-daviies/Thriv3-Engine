/**
 * The strongest positive reasons to consider a programme for an athlete.
 *
 * A SELECTION POLICY over the ranking primitives in rank.js, and deliberately
 * not a summary of everything we know. It answers one question — what are the
 * best positive reasons we currently hold — and it is allowed to answer
 * "none", which is the behaviour most of the design rests on.
 *
 * WHAT IT IS NOT
 *
 * Not all evidence: the deeper panel keeps that, including everything rejected
 * here, with a disposition saying why.
 * Not the highest strengths: `strength` orders kinds for an EMAIL and is the
 * last tiebreak here, never the first.
 * Not an explanation of the matching score: no evidence is an input to it.
 * Not padded: fewer than four reasons is a normal result, and zero is a
 * finding rather than a failure.
 *
 * ONLY POSITIVE EVIDENCE ENTERS.
 *
 * NEUTRAL evidence is real, useful and browsable, and it stays out of here. A
 * freshman ladder is not a reason to choose a programme merely by existing —
 * it is a reason or a warning depending on what it says, and nothing has yet
 * been licensed to make that call. That exclusion is severe on today's
 * registry: it removes ATHLETE_COHORT_LADDER and PROGRAMME_DEVELOPMENT_PATTERN,
 * which were the most frequent PATHWAY and FIT leaders in the unfiltered
 * ranking. Sparser and honest beats fuller and asserted.
 */

import { kindSpec, PERMISSION, assertSurfaceRenderable, confidenceAtLeast } from './kinds.js';
import { rankEvidence } from './rank.js';

/** Primary reasons. A ceiling, never a target. */
export const MAX_REASONS = 4;

/**
 * Primary reasons per category.
 *
 * Two, matching the email engine's own `MAX_PER_FAMILY` — the judgement that
 * two observations about one subject is a fuller picture and three is a report
 * is the same judgement here. In practice it rarely binds, because grouping
 * collapses each dedupe group to a single reason first and only the roster
 * category holds two eligible groups at all.
 */
export const MAX_PER_CATEGORY = 2;

/**
 * Why a piece of evidence is or is not a top reason.
 *
 * `SELECTED` and `BELOW_CONFIDENCE` are borrowed from the email engine's
 * vocabulary because they mean exactly the same thing here. The rest are
 * operator-specific and deliberately NOT borrowed: the email's
 * `SUPPRESSED_REDUNDANT` means an item lost to a better one and was dropped,
 * whereas `GROUPED_SUPPORTING` means it is still attached and still shown. One
 * word for both would hide the difference this policy exists to create.
 */
export const OPERATOR_DISPOSITION = Object.freeze({
  /** A primary reason. */
  SELECTED: 'SELECTED',
  /** Kept, attached beneath the primary reason for its group. */
  GROUPED_SUPPORTING: 'GROUPED_SUPPORTING',
  /** Eligible and good, but four reasons were already chosen. */
  MAX_REASONS: 'MAX_REASONS',
  /** Eligible, but its category already had its two. */
  CATEGORY_CAP: 'CATEGORY_CAP',
  /** A measurement, not an argument. See the note at the top of this file. */
  NEUTRAL_ONLY: 'NEUTRAL_ONLY',
  /** True and useful, but not a reason to choose this programme. */
  CONTEXT_ONLY: 'CONTEXT_ONLY',
  /** The operator surface may not show it, or it lacks required qualification. */
  NOT_OPERATOR_LICENSED: 'NOT_OPERATOR_LICENSED',
  /** Below the floor its own kind declares. */
  BELOW_CONFIDENCE: 'BELOW_CONFIDENCE',
});

/**
 * May this item be a reason at all?
 *
 * Returns a disposition rather than a boolean so nothing is dropped without a
 * recorded reason — the property that makes the QA report readable and an
 * operator's "why is this not here" answerable.
 */
function ineligibility(ev) {
  const spec = kindSpec(ev.kind);

  if (ev.polarity !== 'POSITIVE') return OPERATOR_DISPOSITION.NEUTRAL_ONLY;
  if (ev.decisionClass === 'CONTEXT') return OPERATOR_DISPOSITION.CONTEXT_ONLY;

  if (ev.permissions?.OPERATOR_EVIDENCE === PERMISSION.DENIED) {
    return OPERATOR_DISPOSITION.NOT_OPERATOR_LICENSED;
  }
  /**
   * The Stage C guard, used rather than reimplemented.
   *
   * It throws, so it is called for its refusal: a required window or a required
   * comparison that never arrived means the item cannot be shown, and finding
   * that out here rather than in a renderer is the point of the guard existing.
   */
  try {
    assertSurfaceRenderable(ev, 'OPERATOR_EVIDENCE');
  } catch {
    return OPERATOR_DISPOSITION.NOT_OPERATOR_LICENSED;
  }

  if (!confidenceAtLeast(ev.confidence, spec.minConfidence)) {
    return OPERATOR_DISPOSITION.BELOW_CONFIDENCE;
  }
  return null;
}

/**
 * The strongest positive reasons, with the evidence that supports each.
 *
 * @param {object[]} evidence  everything generated for this athlete-programme
 *   pairing. Order is irrelevant: the result is sorted before anything else
 *   happens, so two callers holding the same set get the same reasons.
 * @returns {{reasons: object[], openingIdentified: boolean, dispositions: object[]}}
 */
export function topReasons(evidence = []) {
  const all = Array.isArray(evidence) ? evidence.filter(Boolean) : [];
  const dispositions = new Map();
  const eligible = [];

  for (const ev of all) {
    const why = ineligibility(ev);
    if (why) dispositions.set(ev.kind, { kind: ev.kind, disposition: why });
    else eligible.push(ev);
  }

  /**
   * Ranked first, then grouped — so the best member of each dedupe group
   * becomes its primary and the rest attach beneath it.
   *
   * This is where the operator policy parts company with the email engine.
   * `dedupe` in select.js keeps the strongest member of a group and DISCARDS
   * the others, which is right for a paragraph: "you've got three defenders
   * graduating" and "two of them were starters" as separate sentences is the
   * mail-merge texture the whole system avoids. For a screen it is wrong in the
   * opposite direction — the starter detail is the more decision-bearing half
   * of that one story, and losing it costs the operator the thing they most
   * need. So one reason, both facts.
   */
  const ranked = rankEvidence(eligible);
  const groups = new Map();
  for (const ev of ranked) {
    const key = kindSpec(ev.kind).dedupeGroup;
    if (!groups.has(key)) {
      groups.set(key, {
        primary: ev,
        supporting: [],
        dedupeGroup: key,
        decisionClass: ev.decisionClass,
        category: ev.category,
      });
    } else {
      groups.get(key).supporting.push(ev);
      dispositions.set(ev.kind, {
        kind: ev.kind,
        disposition: OPERATOR_DISPOSITION.GROUPED_SUPPORTING,
        under: groups.get(key).primary.kind,
      });
    }
  }

  const candidates = [...groups.values()];
  const chosen = [];
  const perCategory = new Map();
  const usedGroups = new Set();

  /** Take a candidate if the caps allow, and say so either way. */
  const take = (candidate) => {
    if (!candidate || usedGroups.has(candidate.dedupeGroup)) return false;
    if (chosen.length >= MAX_REASONS) return false;
    const used = perCategory.get(candidate.category) ?? 0;
    if (used >= MAX_PER_CATEGORY) return false;
    chosen.push(candidate);
    usedGroups.add(candidate.dedupeGroup);
    perCategory.set(candidate.category, used + 1);
    return true;
  };

  /**
   * STEP 1 — the opening, and nothing stands in for it.
   *
   * `openingIdentified` records whether the system found one. It is not a claim
   * that no opening exists: 21% of real pairs generate no OPENING evidence, and
   * for many of those the programme simply has a roster we could not read at
   * the athlete's position. Absence of evidence is the state being recorded,
   * and the distinction belongs here rather than in whatever eventually renders
   * it.
   */
  const bestOpening = candidates.find((c) => c.decisionClass === 'OPENING');
  const openingIdentified = Boolean(bestOpening) && take(bestOpening);

  // STEP 2 — the best pathway, if one survives the caps.
  take(candidates.find((c) => c.decisionClass === 'PATHWAY'));

  /**
   * STEP 3 — the rest, on merit alone.
   *
   * FIT is NOT guaranteed a slot. A second opening or a second pathway is
   * better evidence than a conference title, and reserving a slot for variety
   * would be a visual quota rather than a judgement about the programme.
   */
  for (const candidate of candidates) {
    if (chosen.length >= MAX_REASONS) break;
    take(candidate);
  }

  // Everything eligible that did not become a reason, with the cap that stopped
  // it. Recorded per group primary; grouped members already have their own.
  for (const candidate of candidates) {
    if (usedGroups.has(candidate.dedupeGroup)) continue;
    const used = perCategory.get(candidate.category) ?? 0;
    dispositions.set(candidate.primary.kind, {
      kind: candidate.primary.kind,
      disposition: chosen.length >= MAX_REASONS && used < MAX_PER_CATEGORY
        ? OPERATOR_DISPOSITION.MAX_REASONS
        : OPERATOR_DISPOSITION.CATEGORY_CAP,
    });
  }

  for (const c of chosen) {
    dispositions.set(c.primary.kind, {
      kind: c.primary.kind, disposition: OPERATOR_DISPOSITION.SELECTED,
    });
  }

  return {
    reasons: chosen.map((c) => ({
      primary: c.primary,
      supporting: c.supporting,
      decisionClass: c.decisionClass,
      category: c.category,
      dedupeGroup: c.dedupeGroup,
    })),
    openingIdentified,
    // One row per generated kind, so "why is this not a reason" is always
    // answerable and nothing is dropped silently.
    dispositions: all.map((ev) => dispositions.get(ev.kind)
      ?? { kind: ev.kind, disposition: OPERATOR_DISPOSITION.SELECTED }),
  };
}
