/**
 * A7.44. How much of a position group Thriv3 could actually place there.
 *
 * -- THE FACT THAT WAS COMPUTED AND NEVER PASSED ----------------------------
 *
 * `buildPositionIndex` has always known that some roster rows carry a position
 * it cannot canonicalise. It counted them and then dropped them: the row
 * entered no position bucket, so every bucket at that programme was built from
 * a roster with a hole in it and no bucket was ever told. A programme with
 * twenty-three unplaceable players and four readable forwards reported four
 * forwards with the same confidence as a programme whose whole roster read.
 *
 * -- WHY IT IS NOT THE SAME FACT AS `unreadable` ----------------------------
 *
 * `bucket.unreadable` counts players we DID place at this position and whose
 * class year we could not read. These are players we could not place at ANY
 * position. The first is doubt about WHEN someone leaves; the second is doubt
 * about WHETHER they were ever in this group. They are not addends and adding
 * them would double-count every row that is both.
 *
 * -- WHAT IT MAY AND MAY NOT DO ---------------------------------------------
 *
 * It may lower a grade, lower coverage and refuse a cell. It may NOT move a
 * value: an unplaceable player is not evidence of more competition or of less,
 * and distributing them across the four positions - probabilistically or
 * otherwise - would be exactly the imputation this model exists to refuse.
 * `coverage.js` rule 1 again: value and coverage are never combined.
 */

/**
 * The readable-majority rule, asked of the positional axis.
 *
 * NOT A NEW NUMBER. It is A7.37's `ZERO_CLAIM_READABLE_SHARE`, whose reason
 * transfers without modification: one half is the smallest share at which the
 * rows we read cannot be outvoted by the rows we did not. There the unread
 * rows were players whose year we could not read; here they are players we
 * could not place. Minting a second threshold would invite the two to drift
 * apart on no evidence, so `positionReadability.test.js` asserts they are the
 * same number and fails if either moves alone.
 *
 * IT IS NOT THE MIRROR OF THE A7.37 RULE, AND THAT ASYMMETRY IS DELIBERATE.
 * A7.37's floor governs a ZERO claim only, because rows whose year we could
 * not read could only ever have made a returner count LARGER - refusing a
 * non-zero count would discard a real observation for being incomplete in the
 * athlete's favour. Unplaceable players run the other way: they can only ever
 * ADD competition that was not counted, so the count they undermine is the
 * LOW one, and a low returner count is exactly what scores as a wide-open
 * position. Here the optimistic reading is the one that needs the floor.
 */
export const POSITION_READABLE_SHARE_FLOOR = 0.5;

/**
 * The share of the plausible position group that was actually placed here.
 *
 * THE DENOMINATOR IS THE GROUP THIS POSITION COULD HAVE BEEN. Unplaceable
 * players are counted against every position at the programme, because any of
 * them could belong to any of them. That is pessimistic by construction and it
 * is the only reading that does not require knowing something we do not: the
 * alternative - dividing the unplaceable rows by four, or by the position's
 * usual share - is an imputation with a denominator bolted on.
 *
 * `placed === null` means a caller that predates A7.44 and has not been told.
 * It reads as fully readable, so an untold caller keeps its previous behaviour
 * rather than refusing on its own silence - the same convention A7.37 chose
 * for `positionRows`, and for the same reason.
 */
export function positionReadableShare({ placed, unplaceable = 0 }) {
  if (placed === null || placed === undefined) return 1;
  const here = Math.max(0, Number(placed) || 0);
  const lost = Math.max(0, Number(unplaceable) || 0);
  const group = here + lost;
  return group === 0 ? 1 : here / group;
}

/**
 * Does the unplaceable remainder leave a defensible positional estimate?
 *
 * Three states, matching the evidence vocabulary exactly and inventing no
 * fourth: full readability is MEASURED-eligible, a readable majority is
 * PARTIAL, and a readable minority is not a positional estimate at all.
 */
export const POSITION_EVIDENCE = Object.freeze({
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  INSUFFICIENT: 'INSUFFICIENT',
});

export function positionEvidenceState(share) {
  if (share >= 1) return POSITION_EVIDENCE.COMPLETE;
  if (share >= POSITION_READABLE_SHARE_FLOOR) return POSITION_EVIDENCE.PARTIAL;
  return POSITION_EVIDENCE.INSUFFICIENT;
}
