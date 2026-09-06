/**
 * Registry questions about one piece of evidence, asked one at a time.
 *
 * Is it licensed for an email. Does it clear its own confidence floor. Which
 * family is it from, and what is that family called. How does it compare to
 * another piece for ordering a LIST. Five small answers, each derived from the
 * registry, each with its own callers.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE USED TO BE A SELECTOR, AND IS NOT ONE NOW.
 *
 * `selectFrom` lived here: four passes — reject what is too thin, collapse
 * restatements of one idea, rank what survives, fill a bounded number of slots
 * under a diversity rule — and until G4 it decided what every email said. G4
 * moved that decision to `outreachEvidenceFor`, which asks a licence question
 * rather than a ranking one. H6 stopped it explaining decisions it had not
 * made. H7 stopped it running. H8 deleted it, with `dedupe`, `fillSlots`,
 * `dispositionsFor`, `SLOT_FLOORS`, `MAX_PER_FAMILY` and the `DISPOSITION`
 * vocabulary, because a retired policy that still compiles is a policy someone
 * can call.
 *
 * What is left survived on its own merits, and each has live callers named
 * beside it. Nothing here ranks an email or bounds one.
 */

import {
  confidenceAtLeast, kindLabel, kindSpec, TIERS, PERMISSION, assertSurfaceRenderable,
} from './kinds.js';

/**
 * May this evidence reach an email at all?
 *
 * THE REGISTRY DECIDES. Until this function existed the gate was a per-kind
 * boolean that answered for one audience, and the OUTREACH permission beside
 * it was read by nothing. The two agreed for all 26 kinds — but by
 * construction rather than by enforcement, so a caller narrowing
 * `permissions.OUTREACH` to DENIED still got an email, and a QUALIFIED grade
 * could not have been honoured because no code path looked. H3 removed the
 * boolean; there is one field now, and this reads it.
 *
 * FAILS CLOSED, TWICE OVER.
 *
 * `assertSurfaceRenderable` throws for a denied kind and for one missing a
 * requirement it declares — COACH_CONTEXT is the only outbound kind with a
 * `requiresWindow`, and across 15,433 real objects it always carries one, so
 * this adds a guarantee rather than a behaviour.
 *
 * QUALIFIED COUNTS AS LICENSED HERE, AND DID NOT USED TO.
 *
 * While the selector that used to live in this file was the outbound owner it
 * refused QUALIFIED, because the grade means "renderable only through a path
 * that states the qualification" and no such path existed. G4 built one —
 * `outreachEvidenceFor` — and moved outbound selection to it. This function is
 * not the gate on what is SENT; it answers the narrower question the operator
 * panel asks: is this kind licensed for outreach at all, or is it intelligence
 * that may never leave the building.
 *
 * So DENIED is excluded and QUALIFIED is included, and whether a QUALIFIED
 * claim can actually state its qualification is decided where that decision
 * belongs, once, in the outbound selector.
 */
export function outreachPermitted(ev) {
  try {
    return assertSurfaceRenderable(ev, 'OUTREACH') !== PERMISSION.DENIED;
  } catch {
    return false;
  }
}

/**
 * A fact outranks an interpretation of the same strength.
 *
 * Small on purpose. It should break ties between comparable evidence, not let
 * a weak fact beat a strong signal — "you have one international player"
 * should not displace "your defensive group turns over substantially".
 */
export const FACT_BONUS = 6;

/**
 * How much a same-country connection is worth beyond its own strength.
 *
 * The audit measured this: for a New Zealand athlete, current-roster-only
 * matching reaches 57 of 1,151 men's programmes, five seasons of history
 * reaches 159, and adding Australia reaches 301. It is the most specific and
 * most checkable thing we can say, and it is the angle a coach is least
 * likely to have seen in another agency's mail merge.
 *
 * It is a starting bet, not a finding. If the engagement data says otherwise
 * this is the first number to move.
 */
export const INTERNATIONAL_PRIOR = 8;

const CATEGORY_PRIOR = Object.freeze({
  international: INTERNATIONAL_PRIOR,
  academic: 4,
  roster: 2,
  performance: 0,
  coach: 0,
  internal: 0,
});

/**
 * The conceptual families, one level coarser than `dedupeGroup`.
 *
 * Two different jobs need two different groupings and conflating them is how
 * this goes wrong:
 *
 *   `dedupeGroup` is a HARD collapse. Its members are restatements of one
 *   observation — a New Zealander on the roster, NZ history, an Australasian
 *   history and an international share are four readings of the same fact —
 *   and exactly one of them may survive.
 *
 *   A family was a SOFT cap — position graduation, squad graduation and thin
 *   depth are genuinely different observations about the same subject, so two
 *   in one email was a fuller picture and four a database report. The cap went
 *   with the selector in H8; the LICENCE bounds this now, and more tightly.
 *
 * These labels survive because the operator panel groups by them. They are the
 * registry's own `category` values and not a second classification: a kind
 * that is 'roster' for one purpose and 'ROSTER' for another would eventually
 * be one and not the other.
 */
export const FAMILY_LABELS = Object.freeze({
  international: 'International',
  roster: 'Roster',
  academic: 'Academic',
  performance: 'Programme',
  coach: 'Coach',
  internal: 'Internal',
});

export function familyOf(ev) {
  return ev?.category ?? null;
}

/**
 * How many pieces of evidence may reach one email.
 *
 * Four is a ceiling and not a target. It is roughly where an approach stops
 * reading as a reason to write and starts reading as a dossier, and it is only
 * reachable by a programme with four genuinely different, genuinely strong
 * things to say — which the slot floors below make uncommon.
 */
export const MAX_EMAIL_EVIDENCE = 4;

/** Priority for one piece of evidence. Higher wins. */
export function priorityOf(ev) {
  return ev.strength
    + (ev.tier === TIERS.FACT ? FACT_BONUS : 0)
    + (CATEGORY_PRIOR[ev.category] ?? 0);
}

/**
 * Evidence too thin to act on.
 *
 * Each kind declares its own floor because they are not comparable: an
 * academic match is worthless unless we are sure the school offers the
 * subject, while a returning-depth reading is useful at medium confidence.
 */
export function meetsConfidence(ev) {
  return confidenceAtLeast(ev.confidence, kindSpec(ev.kind).minConfidence);
}

/*
 * WHAT MAY OPEN AN EMAIL IS NOT DECIDED HERE, and a `canLead` /
 * `promoteLeadable` pair that claimed otherwise was removed from this spot.
 *
 * It read `kindSpec(ev.kind).canLead`, which NO KIND DECLARES — so the
 * predicate was always true and the reordering was an identity function. Its
 * comment described a five-structure architecture that `structures.js` reduced
 * to two.
 *
 * That concept was replaced by `leadSuitability`, and H4 replaced THAT with
 * the outbound role: a claim opens an email if and only if its role is HOOK,
 * decided once in `outreachEvidenceFor`. Tested in multiEvidence.test.js,
 * "what may open an email cold".
 *
 * Removed rather than left because the file a reader opens first should not
 * describe a policy it does not enforce. There must be ONE lead vocabulary;
 * this was the third, and there have been two since.
 */
