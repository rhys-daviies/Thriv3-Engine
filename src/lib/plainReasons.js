/**
 * THE PLAIN REGISTER — A11.2 §2.
 *
 * ===========================================================================
 * THE SAME FINDING, SAID WITHOUT THE ARITHMETIC. NOT A SECOND OPINION.
 *
 * The engine writes one sentence per reason, and those sentences are written
 * for an operator who may need to reproduce the reading: they carry the share
 * against the median, the percentile gap, the budget range. On the summary a
 * consultant reads to a family, "0.5276 against a median of 0.5635" is noise
 * that costs the sentence its meaning.
 *
 * So this is a SECOND WORDING of the same reason, and the rules it obeys are
 * what keep it honest:
 *
 *   KEYED BY CODE, NEVER BY SCORE. Every entry below is selected by the
 *   reason's own `code` and reads the same `evidence` object `render.js`
 *   reads. Nothing here looks at Pursuit, at a layer value, or at a rank.
 *   Writing prose from a number is the reverse-engineering A11 was explicitly
 *   told not to do, and the way it would creep in is a helper here that took
 *   a score instead of an evidence object.
 *
 *   A BANDED CLAIM IS BANDED FROM THE EVIDENCE. "Very close to the standard
 *   they are aiming at" is true at a three-point gap and false at a thirty-
 *   point one. Where the engine's number carried the magnitude, dropping it
 *   means the WORD has to carry it — so `LEVEL_PREFERENCE_BELOW` reads
 *   `levelGapBelow` and says "very close", "a little below" or "below"
 *   accordingly. A flat paraphrase of that sentence would state a closeness
 *   the evidence does not support.
 *
 *   UNCERTAINTY SURVIVES. "Assessed level", "estimated", "detected", "not
 *   established" are load-bearing and are kept. A plain sentence that reads
 *   more confidently than the engine's is a defect, not a simplification.
 *
 *   SILENCE IS NOT AN OPTION. A code with no entry here falls through to the
 *   engine's own sentence, unchanged. Dropping a reason because nobody wrote
 *   a plain version of it would quietly delete evidence.
 *
 * -- WHERE THE NUMBERS WENT -------------------------------------------------
 *
 * Nowhere. The engine's exact sentence, with every figure in it, is what the
 * detailed-reasoning disclosure renders — §5. This register is used for the
 * concise summary only. The two are the same reasons at two levels of detail,
 * which is why showing both expanded at once was the thing §6 objected to.
 * ===========================================================================
 */

/**
 * Codes whose plain wording must be stated in the summary even when the
 * polarity ordering would not have reached them — A11.2 §2.
 *
 * These are the financial caveats. A D3 programme that cannot award athletic
 * money, and a net price that is measured on domestically aided students and
 * therefore understates what an international family will pay, are the two
 * facts most likely to be discovered late and most expensive to discover
 * late. They are "context" or "concern" polarity and would often sit fourth
 * or fifth, so the summary hoists them rather than ranking them.
 */
export const FINANCIAL_CAVEAT_CODES = Object.freeze(new Set([
  'AID_KNOWN_NONE',
  'AID_PERMITTED_AMOUNT_UNKNOWN',
  'AID_POLICY_UNKNOWN',
  'INTERNATIONAL_COST_UNDERSTATED',
  'RESIDENCY_UNKNOWN',
  'CONTRIBUTION_FROM_LEGACY_BAND',
]));

export const isFinancialCaveat = (reason) => FINANCIAL_CAVEAT_CODES.has(reason?.code);

/** The engine's own priority wording, mirrored so the clause reads identically. */
function priorityClause(priority) {
  const n = Number(priority);
  if (!Number.isFinite(n)) return 'The athlete stated a competitive-level preference';
  if (n >= 4) return `Competitive level is a strong priority for this athlete (${n} of 5)`;
  if (n === 3) return `The athlete rated competitive level as moderately important (${n} of 5)`;
  return `Competitive level is a lower priority for this athlete (${n} of 5)`;
}

/**
 * How far below, in words rather than percentile points.
 *
 * The bands are deliberately coarse and deliberately cautious: anything past
 * a fifteen-point gap simply says "below", because there is no adverb that
 * distinguishes 20 from 40 without implying a precision the estimate does not
 * have. A7.17 measured one step of the 1-10 level input as worth between 3.5
 * and 16 percentile points, so a gap inside that range is inside the noise of
 * the input itself — which is exactly what "very close" should mean.
 */
function nearness(gap) {
  if (!Number.isFinite(gap)) return null;
  if (gap <= 0.05) return 'very close to';
  if (gap <= 0.15) return 'a little below';
  return 'below';
}

function reach(gap) {
  if (!Number.isFinite(gap)) return null;
  if (gap <= 0.05) return 'a little above';
  if (gap <= 0.15) return 'above';
  return 'well above';
}

/**
 * code -> (evidence) => sentence | null.
 *
 * Returning null falls through to the engine's sentence, which is the right
 * answer whenever the evidence needed for the plain wording is missing: a
 * banded phrase built from a gap that is not a number would be a guess.
 */
const PLAIN = Object.freeze({
  /* ---- Playing time: the share-against-median pair §2 names ---- */
  PLAYING_SHARE_NARROW: () =>
    'Playing-time evidence suggests opportunities at this position are concentrated among '
    + 'fewer players than at a typical programme.',
  PLAYING_SHARE_WIDE: () =>
    'Playing-time evidence suggests this programme shares minutes at the position more widely '
    + 'than a typical one.',

  /* ---- Competitive level: percentile points, banded ---- */
  ATHLETIC_MODEST_REACH: (e) => {
    const r = reach(e?.levelGap);
    return r && `A modest reach: this programme recruits ${r} the athlete's assessed level.`;
  },
  ATHLETIC_SUBSTANTIAL_REACH: (e) => {
    const r = reach(e?.levelGap);
    return r && `A substantial reach: this programme recruits ${r} the athlete's assessed level.`;
  },
  ATHLETIC_BEYOND_RANGE: () =>
    'Well beyond the athlete\'s assessed range, which is what holds this back.',

  LEVEL_PREFERENCE_BELOW: (e) => {
    const n = nearness(e?.levelGapBelow);
    return n && `${priorityClause(e?.priority)}, and the competitive level here is ${n} the standard they are aiming at.`;
  },

  /**
   * The level anchor. The engine states the reduction factor because an
   * operator reconciling a rank needs it; a consultant needs to know that an
   * estimate nudged the ordering and that nothing was excluded for it.
   */
  LEVEL_ANCHOR_APPLIED: (e) => {
    const dir = e?.direction === 'REACH' ? 'above' : 'below';
    const weight = e?.priorityDefaulted
      ? 'no competitive-level importance was stated, so a moderate weighting was assumed'
      : `the athlete rated competitive level ${e?.competitiveLevelPriority} of 5 in importance`;
    return `This programme sits ${dir} the athlete's estimated competitive level and ${weight}, `
      + 'so its priority is adjusted. The athlete\'s level is an estimate and an anchor, not a '
      + 'limit: nothing is excluded for it.';
  },

  /**
   * Absolute priority. The raw 0-100 figure is already on the card as
   * Pursuit, so repeating it inside a sentence adds nothing a reader cannot
   * see two inches higher.
   */
  ABSOLUTE_PRIORITY_MODEST: (e) => (Number.isFinite(e?.rank)
    ? `Ranked #${e.rank}, with a modest absolute priority — worth an approach, not a leading one.`
    : 'A modest absolute priority — worth an approach, not a leading one.'),
  ABSOLUTE_PRIORITY_LOW: (e) => (Number.isFinite(e?.rank)
    ? `Ranked #${e.rank}, but the absolute priority is low: this is among the least unreachable options rather than a strong one.`
    : 'The absolute priority is low: this is among the least unreachable options rather than a strong one.'),
});

/**
 * The plain sentence for a reason, or null when there is no plain wording.
 *
 * Null is the caller's signal to use the engine's sentence, NOT to drop the
 * reason. Wrapped because every entry reads an evidence object it does not
 * own, and a surface that threw on one malformed basis would lose the whole
 * summary rather than one line of it.
 */
export function plainSentence(reason) {
  const make = PLAIN[reason?.code];
  if (!make) return null;
  try {
    const text = make(reason.evidence ?? {});
    return typeof text === 'string' && text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** True when this reason has a wording that differs from the engine's. */
export const hasPlainWording = (reason) => plainSentence(reason) !== null;
