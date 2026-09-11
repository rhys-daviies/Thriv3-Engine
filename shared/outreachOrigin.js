/**
 * WHAT KIND OF ACTION SENT A MESSAGE.
 *
 * Shared so the writer and every later reader agree on the spelling, and kept
 * out of the database as a CHECK constraint on purpose: SQLite cannot alter
 * one, and the next origin — an automated follow-up, a reply, an import — must
 * not need a table rebuild.
 *
 * NULL IS A REAL AND HONEST VALUE. Every row written before this vocabulary
 * existed has it, and it means "not recorded", which is different from either
 * of the two below. Nothing backfills it.
 */
export const OUTREACH_ORIGIN = Object.freeze({
  /** A person composed and approved this message for one athlete-programme pair. */
  MANUAL: 'manual',
  /** Attributed to a programme campaign, and subject to its cadence and gates. */
  CAMPAIGN: 'campaign',
});

export const OUTREACH_ORIGINS = Object.freeze(Object.values(OUTREACH_ORIGIN));

/** Refuses anything outside the vocabulary rather than storing it. */
export function normaliseOrigin(value) {
  if (value === null || value === undefined) return null;
  if (!OUTREACH_ORIGINS.includes(value)) {
    throw new Error(`Unknown outreach origin ${JSON.stringify(value)}; expected one of ${OUTREACH_ORIGINS.join(', ')}.`);
  }
  return value;
}
