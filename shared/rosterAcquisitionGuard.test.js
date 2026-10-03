/**
 * A7.40 — the guard that would have caught the defect, tested against the
 * defect's own shape.
 *
 * Every fixture below is a real A7.40 measurement rather than an invented one:
 * Clemson men's ran 29/29, 31/31, 34/34, 29/29 and then 0/29, and Hope men's
 * arrived as five rows against a 121-row history. The guard must separate
 * those two, because only the first is a field problem.
 */
import { describe, it, expect } from 'vitest';
import { assessFieldCoverage, ACQUISITION_SIGNAL, MIN_ROWS } from './rosterAcquisitionGuard.js';

const H = (...pairs) => pairs.map(([rows, populated], i) => ({ season: 2022 + i, rows, populated }));

describe('it catches the A7.40 signature', () => {
  it('flags Clemson: four full seasons of labels, then none', () => {
    const r = assessFieldCoverage({ rows: 29, populated: 0, history: H([29, 29], [31, 31], [34, 34], [29, 29]) });
    expect(r.signal).toBe(ACQUISITION_SIGNAL.CATASTROPHIC_FIELD_LOSS);
    expect(r.review).toBe(true);
  });

  it('flags a programme labelled in only ONE prior season', () => {
    // Bates men's: unlabelled 2022-24, labelled in 2025, gone again in 2026.
    // One good season is enough to prove the site publishes the field.
    const r = assessFieldCoverage({ rows: 29, populated: 0, history: H([32, 0], [27, 0], [32, 0], [34, 34]) });
    expect(r.signal).toBe(ACQUISITION_SIGNAL.CATASTROPHIC_FIELD_LOSS);
  });

  it('flags a partial collapse short of total', () => {
    const r = assessFieldCoverage({ rows: 30, populated: 4, history: H([30, 30], [28, 28]) });
    expect(r.signal).toBe(ACQUISITION_SIGNAL.FIELD_COVERAGE_DROP);
    expect(r.review).toBe(true);
  });
});

describe('it raises REVIEW and never manufactures a value', () => {
  it('returns no value to write, under any signal', () => {
    for (const args of [
      { rows: 29, populated: 0, history: H([29, 29]) },
      { rows: 30, populated: 4, history: H([30, 30]) },
      { rows: 29, populated: 29, history: H([29, 29]) },
    ]) {
      const keys = Object.keys(assessFieldCoverage(args));
      for (const forbidden of ['value', 'fill', 'label', 'suggested', 'inferred']) {
        expect(keys, forbidden).not.toContain(forbidden);
      }
    }
  });

  it('says confirm at the source, and says NOT to copy another season', () => {
    const r = assessFieldCoverage({ rows: 29, populated: 0, history: H([29, 29]) });
    expect(r.reason).toMatch(/Confirm at the source page/);
    expect(r.reason).toMatch(/do not fill the field from another season/);
  });
});

describe('it stays quiet where it has nothing to say', () => {
  it('a programme with no usable history gets NO_BASELINE, not a finding', () => {
    const r = assessFieldCoverage({ rows: 29, populated: 0, history: [] });
    expect(r.signal).toBe(ACQUISITION_SIGNAL.NO_BASELINE);
    expect(r.review).toBe(false);
  });

  it('a programme that NEVER published the field is not flagged for still not publishing it', () => {
    /**
     * Paul Quinn men's. A site may genuinely not publish a class column, and
     * the guard must not turn that into a recurring alarm. It reads OK rather
     * than NO_BASELINE - there IS a baseline here, and zero matches it - and
     * the property that matters either way is that nobody is sent looking.
     */
    const r = assessFieldCoverage({ rows: 22, populated: 0, history: H([23, 0], [21, 0]) });
    expect(r.review).toBe(false);
    expect(r.signal).toBe(ACQUISITION_SIGNAL.OK);
    expect(r.historicalBest).toBe(0);
  });

  it('a tiny partial acquisition is not a FIELD alarm', () => {
    /**
     * Hope men's: 5 rows against a 121-row history. Its problem is that the
     * roster was half-posted on 26 August, not that a column vanished, and
     * dressing it as a field defect would send the wrong person looking.
     */
    const r = assessFieldCoverage({ rows: 5, populated: 0, history: H([34, 34], [31, 31]) });
    expect(r.signal).toBe(ACQUISITION_SIGNAL.NO_BASELINE);
    expect(r.review).toBe(false);
    expect(r.reason).toMatch(/too few to judge/);
    expect(MIN_ROWS).toBe(8);
  });

  it('ordinary coverage passes, including a squad with a few genuine blanks', () => {
    const r = assessFieldCoverage({ rows: 30, populated: 28, history: H([29, 29]) });
    expect(r.signal).toBe(ACQUISITION_SIGNAL.OK);
    expect(r.review).toBe(false);
  });
});

describe('it is field-agnostic, so position or hometown loss reads the same', () => {
  it('the same shape flags whatever field it is given', () => {
    // A7.40 fixed a class column; the next silent loss may be another field.
    const r = assessFieldCoverage({ rows: 31, populated: 0, history: H([30, 29], [31, 30]) });
    expect(r.signal).toBe(ACQUISITION_SIGNAL.CATASTROPHIC_FIELD_LOSS);
  });
});
