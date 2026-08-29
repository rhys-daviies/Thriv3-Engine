/**
 * Which of the things we know are worth saying, how many of them, and in what
 * order.
 *
 * Four passes, deliberately separate so each can be changed without the
 * others: reject what is too thin to use, collapse restatements of one idea,
 * rank what survives, then fill a bounded number of slots from the top of that
 * ranking under a diversity rule.
 *
 * The ranking is intentionally crude. We have 41 sends and one reply, so any
 * finer model would be fitting weights to nothing — the numbers here are
 * starting priorities, not findings, and the whole point of logging evidence
 * at send time (see server/lib/evidenceLog.js) is to replace them with
 * measurements. Everything tunable is a named constant in this file or a
 * `baseStrength` in kinds.js.
 *
 * NOTE ON THE MULTI-EVIDENCE CHANGE. Selection used to stop at two. It now
 * fills up to four slots, and every constant that decides how many is in this
 * file. No `baseStrength` and no category prior was touched when that limit
 * moved: the ordering of evidence is the same ordering it was, and what
 * changed is only how far down it we are willing to read. That matters for the
 * experiment — see the note in evidencePerformance.js — because it means an
 * email with three items contains the same first two an email of two would
 * have had.
 */

import { confidenceAtLeast, kindLabel, kindSpec, TIERS } from './kinds.js';

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
 *   A family is a SOFT cap. Position graduation, squad graduation and thin
 *   depth are genuinely different observations that happen to be about the
 *   same subject, so two of them in one email is a fuller picture and four is
 *   a database report. Hence MAX_PER_FAMILY rather than a collapse.
 *
 * The families are the registry's own `category` values, not a second
 * classification: a kind that is 'roster' for ranking and 'ROSTER' for
 * redundancy would eventually be one and not the other.
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

/**
 * How many items one family may contribute.
 *
 * Two. The brief's rule — "normally prefer evidence from multiple families
 * over four observations from one family" — is implemented as a cap rather
 * than a preference weight because a weight is a thing that can be tuned into
 * uselessness by one bad number, and this is a rule we are confident about
 * without any data at all.
 */
export const MAX_PER_FAMILY = 2;

/**
 * The priority a candidate must clear to take each successive slot.
 *
 * The floor rises because the argument for each additional sentence is weaker
 * than the one before it: the first piece of evidence is why we are writing,
 * and the fourth has to earn its place against the cost of a longer email.
 *
 * Calibrated against the real priorities rather than chosen round. Coach
 * tenure scores 45 and so can only ever lead — which happens when it is the
 * only thing we know, and never as padding behind three better items. That is
 * exactly the failure the brief names.
 *
 * Slot 1 has no floor of its own: an item that cleared its confidence
 * requirement is worth saying when it is the only thing we have.
 */
export const SLOT_FLOORS = Object.freeze([0, 50, 60, 70]);

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

/**
 * May this evidence open an email?
 *
 * Defaults to yes; only a kind that declares `canLead: false` in the registry
 * is excluded, and only while something else can take the slot.
 */
export function canLead(ev) {
  return kindSpec(ev.kind).canLead !== false;
}

/**
 * Moves a non-opening kind out of the first position.
 *
 * The opening sentence is `selected[0]` — four of the five structures lead on
 * it — so the decision about what opens an email is made HERE, in selection
 * order, and not by the structure. That is why demoting the academic angle
 * could not be done by retiring or re-gating the ACADEMIC_FIT structure: every
 * other structure would have opened on the same sentence.
 *
 * Order only. Nothing is added, nothing is dropped, and the relative order of
 * everything else is preserved — so an email that opened on the academic
 * sentence now opens on the item that was second and says the same three
 * things.
 *
 * If no selected item may lead, the order is returned untouched: an email that
 * opens with its one usable claim is better than one that opens with nothing.
 */
export function promoteLeadable(selected) {
  if (selected.length < 2 || canLead(selected[0])) return selected;
  const i = selected.findIndex(canLead);
  if (i <= 0) return selected;
  return [selected[i], ...selected.filter((_, j) => j !== i)];
}

/** How each generated piece ended up. One value per kind, for panel and log. */
export const DISPOSITION = Object.freeze({
  SELECTED: 'SELECTED',
  AVAILABLE: 'AVAILABLE',
  SUPPRESSED_REDUNDANT: 'SUPPRESSED_REDUNDANT',
  BELOW_THRESHOLD: 'BELOW_THRESHOLD',
  BELOW_CONFIDENCE: 'BELOW_CONFIDENCE',
  INTERNAL_ONLY: 'INTERNAL_ONLY',
});

/**
 * Collapses evidence that says the same thing.
 *
 * A programme with a New Zealander on this year's roster nearly always also
 * has NZ history, an Australasian history, a high international count and a
 * high international share — five objects carrying one idea. Sending all five
 * produces exactly the mail-merge texture this system exists to avoid, so the
 * strongest member of each `dedupeGroup` survives and the rest are recorded as
 * suppressed rather than dropped silently.
 *
 * Suppressed evidence is kept in the return value because it is still true and
 * still worth logging: knowing that the current-roster angle was available but
 * lost to the historical one is what lets us compare them later.
 */
export function dedupe(evidence) {
  const best = new Map();
  const suppressed = [];
  for (const ev of [...evidence].sort((a, b) => priorityOf(b) - priorityOf(a))) {
    const held = best.get(ev.dedupeGroup);
    if (!held) best.set(ev.dedupeGroup, ev);
    else {
      suppressed.push({
        kind: ev.kind,
        suppressedBy: held.kind,
        group: ev.dedupeGroup,
        // The LABEL, not the registry key. These reasons are read by an
        // operator in the panel, and "says the same thing as
        // POSITION_GRADUATION" makes them decode a constant to learn that we
        // dropped a sentence about the same graduating group.
        reason: `says the same thing as ${kindLabel(held.kind).toLowerCase()}`,
      });
    }
  }
  return { kept: [...best.values()], suppressed };
}

/**
 * Fills the email's evidence slots from a ranked list.
 *
 * Greedy down the ranking, subject to the family cap and the rising slot
 * floor. Greedy rather than an optimisation over subsets on purpose: with no
 * outcome data, a smarter combiner would be a more elaborate way of expressing
 * the same guesses, and it would be much harder to explain to an operator
 * looking at the panel and asking why a particular sentence is missing.
 *
 * Every rejection carries the reason it was rejected, because the panel has to
 * show it and "we cannot say" is not an answer an operator can act on.
 */
export function fillSlots(ranked, { maxEmail = MAX_EMAIL_EVIDENCE } = {}) {
  const selected = [];
  const familyUse = new Map();
  const belowThreshold = [];
  const familyLimited = [];
  const spare = [];

  for (const ev of ranked) {
    if (selected.length >= maxEmail) { spare.push(ev); continue; }

    const family = familyOf(ev);
    const used = familyUse.get(family) ?? 0;
    if (used >= MAX_PER_FAMILY) {
      familyLimited.push({
        kind: ev.kind,
        group: family,
        reason: `${FAMILY_LABELS[family] ?? family} evidence is already represented twice`,
      });
      continue;
    }

    // The floor for the slot this item would take, not for the slot it sits at
    // in the ranking: an item skipped by the family cap does not consume a
    // slot, so the next candidate is still competing for the same one.
    const floor = SLOT_FLOORS[selected.length] ?? SLOT_FLOORS[SLOT_FLOORS.length - 1];
    const priority = priorityOf(ev);
    if (priority < floor) {
      belowThreshold.push({
        kind: ev.kind,
        priority,
        floor,
        reason: `not strong enough to be the ${ordinal(selected.length + 1)} thing we say`,
      });
      continue;
    }

    selected.push(ev);
    familyUse.set(family, used + 1);
  }

  // Ordered for the email rather than for the ranking: see promoteLeadable.
  // Applied to the ENGINE's own choice only — an operator who ordered the
  // evidence themselves has said what should open the email, and quietly
  // reordering it would be overruling them.
  return { selected: promoteLeadable(selected), belowThreshold, familyLimited, spare };
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];
const ordinal = (n) => ORDINALS[n - 1] ?? `${n}th`;

/**
 * The full evidence picture for one athlete at one programme.
 *
 * Returns everything rather than just the winners, because the operator-facing
 * report and the send-time log both want the whole picture, and because
 * "what did we know and not use" is a question the engagement analysis will
 * ask as soon as there is engagement data to ask it of.
 *
 * @param {Array}  evidence  generated evidence objects
 * @param {object} opts.maxEmail  how many pieces may reach an email
 * @param {Array}  opts.prefer    the operator's own ordered choice of kinds
 */
export function selectFrom(evidence, { maxEmail = MAX_EMAIL_EVIDENCE, prefer = null } = {}) {
  const cap = Math.max(0, Math.min(MAX_EMAIL_EVIDENCE, Number(maxEmail) || 0));
  const all = [...evidence].sort((a, b) => priorityOf(b) - priorityOf(a));

  const rejected = all.filter((ev) => !meetsConfidence(ev))
    .map((ev) => ({
      kind: ev.kind,
      reason: `confidence ${ev.confidence} below ${kindSpec(ev.kind).minConfidence}`,
    }));
  const usable = all.filter(meetsConfidence);

  // Internal evidence is separated before dedupe, not after: it must never
  // suppress an email-eligible piece it happens to outrank, because the thing
  // it would suppress is the thing that actually goes in the email.
  const internal = usable.filter((ev) => !ev.emailEligible);
  const emailable = usable.filter((ev) => ev.emailEligible);

  const { kept, suppressed } = dedupe(emailable);
  const ranked = kept.sort((a, b) => priorityOf(b) - priorityOf(a));

  const engine = fillSlots(ranked, { maxEmail: cap });

  /**
   * The operator's own choice of angle, when they made one.
   *
   * Named kinds only, in the order they named them. The client cannot supply
   * evidence, only point at evidence this function already generated,
   * validated and rendered — so an override can change WHICH true thing is
   * said, and in what order, and can never introduce an untrue one, promote a
   * SIGNAL, or reach a kind that failed its confidence floor or was suppressed
   * for staleness before it ever got here. Anything unrecognised is dropped
   * rather than honoured.
   *
   * Deliberately ignores the dedupe groups, the family cap and the slot
   * floors. Those are editorial rules the operator can see on screen, with the
   * reason printed beside each item; a worse email is their call to make, and
   * an unsafe one is not available to them by construction. The cap on COUNT
   * is enforced, because it bounds the wire and the log rather than expressing
   * a taste.
   */
  const requested = Array.isArray(prefer) ? prefer.filter(Boolean) : [];
  const byKind = new Map(emailable.map((ev) => [ev.kind, ev]));
  const seen = new Set();
  const chosen = [];
  for (const k of requested) {
    if (seen.has(k) || !byKind.has(k)) continue;
    seen.add(k);
    chosen.push(byKind.get(k));
  }
  const unavailable = requested.filter((k) => !byKind.has(k));

  const operatorSelected = chosen.length > 0;
  const selected = (operatorSelected ? chosen : engine.selected).slice(0, cap);

  return {
    all,
    usable,
    internal,
    ranked,
    selected,
    primary: selected[0] ?? null,
    secondary: selected[1] ?? null,
    // Redundancy, in the two forms it takes: a restatement of one observation,
    // and a third helping from a family already twice represented. Reported
    // together because they are one idea to an operator reading the panel.
    suppressed: [...suppressed, ...engine.familyLimited],
    belowThreshold: engine.belowThreshold,
    rejected,
    // What every generated kind ended up as, so the panel and the log agree
    // about the shape of the picture without either re-deriving it.
    dispositions: dispositionsFor({
      all, internal, rejected, suppressed: [...suppressed, ...engine.familyLimited],
      belowThreshold: engine.belowThreshold, selected,
    }),
    // Whether a human overrode the ranking, and what they asked for that we
    // could not honour. Both are logged: an override is a different treatment
    // and must be separable from the engine's own choice when the reply rates
    // are eventually compared.
    operatorSelected,
    // What the engine would have chosen on its own, kept even when overridden
    // so an analysis can ask whether operators improved on it.
    engineSelected: engine.selected.map((ev) => ev.kind),
    unavailableRequests: unavailable,
    facts: ranked.filter((ev) => ev.tier === TIERS.FACT),
    signals: ranked.filter((ev) => ev.tier === TIERS.SIGNAL),
  };
}

/**
 * One disposition per generated kind.
 *
 * Built from the outcomes rather than recomputed, so a kind cannot be
 * SELECTED here and suppressed three lines above. The order of the checks is
 * the order of the pipeline: an internal-only kind is never a candidate, a
 * kind that failed its confidence floor never reached dedupe, and so on.
 */
function dispositionsFor({ all, internal, rejected, suppressed, belowThreshold, selected }) {
  const internalKinds = new Set(internal.map((e) => e.kind));
  const rejectedBy = new Map(rejected.map((r) => [r.kind, r.reason]));
  const suppressedBy = new Map(suppressed.map((s) => [s.kind, s.reason]));
  const belowBy = new Map(belowThreshold.map((b) => [b.kind, b.reason]));
  const order = new Map(selected.map((e, i) => [e.kind, i]));

  return all.map((ev) => {
    const base = { kind: ev.kind, tier: ev.tier, category: ev.category };
    if (order.has(ev.kind)) {
      return { ...base, disposition: DISPOSITION.SELECTED, order: order.get(ev.kind), reason: null };
    }
    if (internalKinds.has(ev.kind)) {
      return {
        ...base,
        disposition: DISPOSITION.INTERNAL_ONLY,
        reason: 'useful for ranking, not permitted in an email',
      };
    }
    if (rejectedBy.has(ev.kind)) {
      return { ...base, disposition: DISPOSITION.BELOW_CONFIDENCE, reason: rejectedBy.get(ev.kind) };
    }
    if (suppressedBy.has(ev.kind)) {
      return {
        ...base, disposition: DISPOSITION.SUPPRESSED_REDUNDANT, reason: suppressedBy.get(ev.kind),
      };
    }
    if (belowBy.has(ev.kind)) {
      return { ...base, disposition: DISPOSITION.BELOW_THRESHOLD, reason: belowBy.get(ev.kind) };
    }
    // Cleared every gate and lost only to the slot count. Offerable: this is
    // the list the operator swaps from.
    return { ...base, disposition: DISPOSITION.AVAILABLE, reason: null };
  });
}
