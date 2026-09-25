/**
 * What an operator has decided about a roster gap, kept apart from what the
 * machine observed.
 *
 * ---------------------------------------------------------------------------
 * THREE LAYERS, AND THE STAGE DOCUMENTS HAD THEM IN ONE PILE.
 *
 *   1. RAW ATTEMPT RESULT     what a stage literally saw: `-> fetch 404`,
 *                             `page season is not 2026`, `no candidate`.
 *                             Owned by the pipeline, written by the stage,
 *                             historical. `_state/state<S>.json`.
 *
 *   2. MACHINE DIAGNOSIS      the pipeline's own normalisation of that:
 *                             `failure_class` (L7J), and the live candidate
 *                             state from the planner. Derived, reproducible,
 *                             never a judgement about the world.
 *
 *   3. OPERATOR DISPOSITION   what a person concluded after looking. This
 *                             file. Durable, human-authored, and the only
 *                             layer that can say something the machine cannot
 *                             prove.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE STAGE LABELS WERE NOT ONE VOCABULARY.
 *
 * L7F through L7I reported residuals as `SOURCE_NOT_AVAILABLE`,
 * `PROGRAMME_STATUS_QUESTION`, `SITE_TEMPORARILY_UNAVAILABLE`, `MANUAL_REVIEW`
 * and `NO_HOST`. Sorted by who can establish them, they fall into three piles:
 *
 *   NO_HOST is a MACHINE fact. `hostsForInstitution` returns NO_TRUSTED_HOST or
 *   it does not, and three of the ten current gaps are in that state right now.
 *   Nothing human is involved, so it is not a disposition and is reported from
 *   the planner instead. Storing it here would mean a person re-asserting a
 *   query result, which then goes stale the moment the ledger changes.
 *
 *   MANUAL_REVIEW is a REVIEW STATUS, not a conclusion. "This needs a person"
 *   is exactly what the absence of a review means, so it is derived from
 *   whether a record exists. As a stored value it would be a row that says
 *   "this row is not filled in yet".
 *
 *   The other three are genuine dispositions: each states a condition a person
 *   established by looking at something the pipeline cannot interpret.
 *
 * ---------------------------------------------------------------------------
 * A CONDITION IS NOT AN INSTRUCTION, AND NORTHWOOD IS THE PROOF.
 *
 * Northwood women's was `SOURCE_NOT_AVAILABLE` for two stages. L7I separated
 * host identity from fetch form and acquired it at candidate one. The
 * disposition had been correct — no source had been established — and reading
 * it as "there is no source, stop asking" would have been wrong.
 *
 * So the condition and what to do about it are separate fields. A disposition
 * describes what was found; `next_action` says what should happen. That is
 * what stops a label becoming a blacklist, which is the failure mode a residual
 * queue tends towards.
 */

/** What a person concluded about a gap. Conditions, mutually exclusive. */
export const DISPOSITION = Object.freeze({
  /**
   * A trusted athletics host exists and no current roster source was
   * established on it. Says nothing about whether one exists — only that
   * looking did not find one.
   */
  SOURCE_NOT_AVAILABLE: 'SOURCE_NOT_AVAILABLE',
  /**
   * Whether the programme is fielded for this season is genuinely in question.
   *
   * Deliberately a QUESTION and not a verdict. Wisconsin-Oshkosh's own
   * navigation reads "Soccer (Coming in 2027)", which is evidence that the
   * registry may be ahead of the field — and evidence is not a decision.
   * Registry truth lives in `colleges`, this does not touch it, and nothing
   * here may mark a programme inactive. Resolving that is a separate,
   * deliberate act by whoever owns the registry.
   */
  PROGRAMME_STATUS_QUESTION: 'PROGRAMME_STATUS_QUESTION',
  /**
   * The expected host or source is transiently inaccessible — maintenance, an
   * outage, a block — with evidence that it is the SITE failing rather than our
   * search failing.
   *
   * The distinction is the whole value of the label. "We could not find a
   * source" is `SOURCE_NOT_AVAILABLE`; this one claims the source exists and
   * cannot be reached right now, and a claim about the future needs a date
   * against it or it quietly becomes permanent. So it requires `RETRY_AFTER`.
   */
  SITE_TEMPORARILY_UNAVAILABLE: 'SITE_TEMPORARILY_UNAVAILABLE',
});

/** What should happen next. Separate from the condition, on purpose. */
export const NEXT_ACTION = Object.freeze({
  /** Nothing blocks another attempt; a better generator may reach it. */
  RETRY_ACQUISITION: 'RETRY_ACQUISITION',
  /** Blocked until a stated date. Requires `retryAfter`. */
  RETRY_AFTER: 'RETRY_AFTER',
  /** A person must settle whether the programme is fielded before we retry. */
  CONFIRM_PROGRAMME_STATUS: 'CONFIRM_PROGRAMME_STATUS',
  /** Reviewed, and there is nothing worth doing at the moment. */
  NONE: 'NONE',
});

/** Whether a gap has been looked at. Derived from whether a record exists. */
export const REVIEW_STATUS = Object.freeze({
  UNREVIEWED: 'UNREVIEWED',
  REVIEWED: 'REVIEWED',
});

/**
 * Which actions each condition may carry.
 *
 * Narrow rather than free, because the pairs that make no sense are the ones
 * that cause harm: a temporary outage with no date is a permanent blacklist
 * with a friendly name, and a status question answered by "retry" skips the
 * person who was supposed to decide.
 */
const ALLOWED = Object.freeze({
  [DISPOSITION.SOURCE_NOT_AVAILABLE]: [NEXT_ACTION.RETRY_ACQUISITION, NEXT_ACTION.NONE],
  [DISPOSITION.PROGRAMME_STATUS_QUESTION]: [NEXT_ACTION.CONFIRM_PROGRAMME_STATUS, NEXT_ACTION.NONE],
  [DISPOSITION.SITE_TEMPORARILY_UNAVAILABLE]: [NEXT_ACTION.RETRY_AFTER],
});

/** A review an operator may store, or an explicit reason it cannot be stored. */
export function validateReview({
  disposition, nextAction, retryAfter = null, evidence = null,
} = {}) {
  if (!DISPOSITION[disposition]) {
    return { ok: false, reason: `unknown disposition ${JSON.stringify(disposition ?? null)}` };
  }
  if (!NEXT_ACTION[nextAction]) {
    return { ok: false, reason: `unknown next action ${JSON.stringify(nextAction ?? null)}` };
  }
  if (!ALLOWED[disposition].includes(nextAction)) {
    return {
      ok: false,
      reason: `${disposition} may not carry ${nextAction} — allowed: ${ALLOWED[disposition].join(', ')}`,
    };
  }
  if (nextAction === NEXT_ACTION.RETRY_AFTER && !retryAfter) {
    return { ok: false, reason: 'RETRY_AFTER needs a date, or it is a permanent block wearing a temporary name' };
  }
  /*
   * A disposition is a claim, and a claim with nothing behind it is the thing
   * this file exists to prevent. The evidence is a sentence a person wrote
   * about what they saw — not a page, not a payload.
   */
  if (!String(evidence ?? '').trim()) {
    return { ok: false, reason: 'a disposition must record what was seen' };
  }
  return { ok: true, reason: null };
}

/**
 * May routine acquisition attempt this programme now?
 *
 * UNREVIEWED IS ELIGIBLE, deliberately. A gap nobody has looked at is a gap the
 * pipeline should keep trying — the alternative makes an unreviewed queue into
 * a quiet blocklist, and the ten current gaps have been retried by every stage
 * since L6D precisely because nothing stopped them.
 */
export function retryEligible(review, now = new Date()) {
  if (!review) return { eligible: true, reason: 'unreviewed' };
  if (review.nextAction === NEXT_ACTION.RETRY_ACQUISITION) return { eligible: true, reason: 'review says retry' };
  if (review.nextAction === NEXT_ACTION.RETRY_AFTER) {
    const due = review.retryAfter ? new Date(review.retryAfter) : null;
    if (!due || Number.isNaN(due.getTime())) return { eligible: true, reason: 'no usable retry date; not a block' };
    return due <= now
      ? { eligible: true, reason: `retry date ${review.retryAfter} has passed` }
      : { eligible: false, reason: `held until ${review.retryAfter}` };
  }
  if (review.nextAction === NEXT_ACTION.CONFIRM_PROGRAMME_STATUS) {
    return { eligible: false, reason: 'awaiting a programme-status decision' };
  }
  return { eligible: false, reason: 'reviewed, no action pending' };
}

/** The review status of a programme, from whether a record exists. */
export const reviewStatus = (review) => (review ? REVIEW_STATUS.REVIEWED : REVIEW_STATUS.UNREVIEWED);

/** The vocabulary an operator may use, for a CLI or a form. */
export const DISPOSITIONS = Object.freeze(Object.keys(DISPOSITION));
export const NEXT_ACTIONS = Object.freeze(Object.keys(NEXT_ACTION));
export const allowedActionsFor = (d) => Object.freeze([...(ALLOWED[d] ?? [])]);
