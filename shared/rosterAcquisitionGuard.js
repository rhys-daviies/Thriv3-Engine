/**
 * Did an acquisition silently lose a column?
 *
 * A7.40's defect shipped because every check the 2026 run performed was about
 * ROWS - how many, whether the squad had turned over, whether the season was
 * real - and none was about FIELDS. 30 programmes arrived with a complete
 * player list and an empty class column, and nothing noticed: the totals stayed
 * at 98.8% because 30 programmes are 1.2% of the field.
 *
 * -- WHAT THIS DOES AND WHAT IT REFUSES TO DO -------------------------------
 *
 * It compares the coverage of one field in a new acquisition against the same
 * programme's own history, and RAISES A REVIEW. It never writes a value, never
 * guesses one, and never rejects an acquisition on its own authority - a
 * programme that genuinely stopped publishing a field is a real finding, and
 * only a human looking at the page can tell that from an extractor that missed
 * it. A7.39 section 5 forbids manufacturing the value either way.
 *
 * DELIBERATELY NARROW. One field, one programme, one season, against that
 * programme's own past. No cross-programme inference, no thresholds tuned to a
 * pool, and no general data-quality framework - the defect was specific and so
 * is the guard.
 */

/** What the guard may conclude. Two of the three are not problems. */
export const ACQUISITION_SIGNAL = Object.freeze({
  /** Coverage is consistent with this programme's history. */
  OK: 'OK',
  /**
   * Substantial historical coverage, and none now. THE A7.40 SIGNATURE.
   * Not proof of a defect: a site can drop a column. It is proof that somebody
   * must look before the rows are trusted.
   */
  CATASTROPHIC_FIELD_LOSS: 'CATASTROPHIC_FIELD_LOSS',
  /** A real fall, short of total. Worth seeing, weaker evidence. */
  FIELD_COVERAGE_DROP: 'FIELD_COVERAGE_DROP',
  /** Not enough history to say anything. Never a finding about the data. */
  NO_BASELINE: 'NO_BASELINE',
});

/**
 * HEURISTIC, and set where the evidence was rather than at a round number.
 * Every one of A7.40's 30 programmes went from >= 96% coverage to exactly 0%,
 * and the field-wide rate is 98.8%, so a programme that has ever published a
 * field for most of its squad and now publishes it for none is the signature.
 * `MIN_ROWS` keeps a five-player partial roster from raising a field alarm
 * when its real problem is that it is a five-player roster.
 */
export const SUBSTANTIAL_COVERAGE = 0.6;
export const DROP_COVERAGE = 0.5;
export const MIN_ROWS = 8;

/**
 * @param {object} p
 * @param {number} p.rows           rows acquired for this programme-season
 * @param {number} p.populated      how many carry the field
 * @param {Array<{season: string|number, rows: number, populated: number}>} p.history
 *   the same programme's earlier seasons. The programme's OWN past is the only
 *   baseline used; other programmes are none of this check's business.
 */
export function assessFieldCoverage({ rows = 0, populated = 0, history = [] } = {}) {
  const coverage = rows > 0 ? populated / rows : 0;
  const usable = history.filter((h) => Number(h.rows) >= MIN_ROWS);
  const best = usable.reduce((m, h) => Math.max(m, Number(h.populated) / Number(h.rows)), 0);

  const base = { coverage, historicalBest: usable.length ? best : null, rows, populated };
  if (rows < MIN_ROWS || !usable.length) {
    return { ...base, signal: ACQUISITION_SIGNAL.NO_BASELINE, review: false,
      reason: !usable.length
        ? 'no earlier season with enough rows to compare against'
        : `only ${rows} rows acquired, too few to judge a field against` };
  }
  if (best >= SUBSTANTIAL_COVERAGE && populated === 0) {
    return { ...base, signal: ACQUISITION_SIGNAL.CATASTROPHIC_FIELD_LOSS, review: true,
      reason: `this programme published the field for ${(best * 100).toFixed(0)}% of a previous squad `
        + `and for none of these ${rows} rows. Confirm at the source page before trusting the acquisition; `
        + 'do not fill the field from another season.' };
  }
  if (best >= SUBSTANTIAL_COVERAGE && coverage < DROP_COVERAGE) {
    return { ...base, signal: ACQUISITION_SIGNAL.FIELD_COVERAGE_DROP, review: true,
      reason: `field coverage fell from ${(best * 100).toFixed(0)}% to ${(coverage * 100).toFixed(0)}%.` };
  }
  return { ...base, signal: ACQUISITION_SIGNAL.OK, review: false, reason: 'coverage is consistent with this programme\'s history' };
}
