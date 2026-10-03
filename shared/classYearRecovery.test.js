/**
 * =============================================================================
 * A7.39 — what `readClassYear` must NOT start doing.
 *
 * A7.39 went looking for class-year information that the parser was failing to
 * read, and found NONE: every non-null label in the 2026 rosters is recognised,
 * so no mapping was added. What it found instead was 752 rows whose label is
 * ABSENT, almost all from a single 2026 acquisition regression, and a handful
 * of labels that genuinely carry no class.
 *
 * So this file does not test a recovery. It pins the three ways a future phase
 * could "improve coverage" by inventing evidence, each of which is forbidden by
 * A7.39 §5, and it pins the open question A7.39 declined to answer.
 *
 * THE STANDARD THIS FILE ENFORCES: Thriv3 may know more; it may not pretend to
 * know more. "Unknown" is a valid outcome and must stay reachable.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { readClassYear } from './classYear.js';
import { eligibilityCeiling } from './eligibility.js';

const read = (label, season = 2026) => readClassYear(label, { season });
const ceiling = (label, { season = 2026, division = 'NCAA D1' } = {}) => {
  const r = read(label, season);
  return eligibilityCeiling({ klass: r.klass, redshirt: r.redshirt, season, division });
};

describe('A. an absent label stays absent — it is the 91% case and no inference may fill it', () => {
  it.each([null, undefined, '', '   '])('%s yields no class and no year', (label) => {
    const r = read(label);
    expect(r.klass).toBeNull();
    expect(r.graduationYear).toBeNull();
    expect(r.eligibilityEndYear).toBeNull();
    // Absent is not WRONG. The importer must not treat it as a suspicious row.
    expect(r.recognised).toBe(true);
  });

  it('produces no eligibility ceiling, so the roster row cannot become a returner or a departure', () => {
    expect(ceiling(null).lastSeason).toBeNull();
  });

  it('reads nothing from the season it was given', () => {
    // The one inference closest to hand: "they are on the 2026 roster, so
    // they are somewhere in a four-year window". A7.39 section 5 forbids it.
    for (const season of [2022, 2024, 2026, 2030]) {
      expect(read(null, season).graduationYear, String(season)).toBeNull();
    }
  });
});

describe('B. a bare redshirt marker carries no class, and must not acquire one', () => {
  /**
   * 52 rows in the 2026 data ("Rs." 51, "RS" 1). The marker is REAL - the
   * parser recognises it and reports `redshirt: true` - and it says nothing
   * about which class the athlete is in. Mapping it to a class to gain 52 rows
   * of coverage would be the exact trade A7.39 was told not to make.
   */
  it.each(['Rs.', 'RS', 'rs', 'Redshirt', 'Medical Redshirt'])('%s is recognised, flagged, and classless', (label) => {
    const r = read(label);
    expect(r.recognised).toBe(true);
    expect(r.redshirt).toBe(true);
    expect(r.klass).toBeNull();
    expect(r.graduationYear).toBeNull();
  });

  it('yields no ceiling, rather than a graduate or senior default', () => {
    expect(ceiling('Rs.').lastSeason).toBeNull();
  });
});

describe('C. an explicit printed year is a graduation year and NOT a class', () => {
  it('keeps the year and refuses to name a class from it', () => {
    const r = read('2029');
    expect(r.graduationYear).toBe(2029);
    // The tempting inference - "graduating 2029 from a 2026 roster means a
    // first year" - assumes a four-year path, no redshirt and no transfer.
    expect(r.klass).toBeNull();
    expect(r.eligibilityEndYear).toBeNull();
  });

  it.each(["'27", '2027', '2030'])('%s produces no eligibility ceiling', (label) => {
    expect(ceiling(label).lastSeason).toBeNull();
  });
});

describe('D. the -R suffix: an open question, pinned as open', () => {
  /**
   * Found while auditing the 117 labels the parser ACCEPTS, not among failures.
   * Hawaii Hilo prints "Jr.-R"; at other programmes the same suffix slot holds
   * "-TR" and "-1L"/"-2L"/"-3L", so "-R" is plausibly Redshirt - and
   * hiloathletics.com publishes no legend, so nothing establishes it.
   *
   * THIS TEST ASSERTS THE CURRENT READING, WHICH MAY BE WRONG, and says so.
   * It exists so that changing it is a decision someone makes on evidence
   * rather than a silent drift. If a legend is ever found, this test should
   * fail and be updated with the source.
   */
  it.each(['Jr.-R', 'So.-R', 'Fr.-R', 'Sr.-R', 'Fr-R'])('%s reads the class and does NOT assert a redshirt', (label) => {
    const r = read(label);
    expect(r.klass).not.toBeNull();
    expect(r.redshirt).toBe(false);
  });

  it('the class half is unambiguous and is kept', () => {
    // Discarding the whole label to avoid the suffix would lose a class year
    // that nobody doubts - a worse answer than a recorded open question.
    expect(read('Jr.-R').klass).toBe('JUNIOR');
    expect(read('So.-R').klass).toBe('SOPHOMORE');
  });

  it('the PREFIX form is different, is sourced, and does assert a redshirt', () => {
    expect(read('R-Jr.').redshirt).toBe(true);
    expect(read('RS-Fr.').redshirt).toBe(true);
    // And a redshirt sits one class up, which is the A7.37-era behaviour.
    expect(read('R-Jr.').eligibilityEndYear).toBe(read('Sr.').eligibilityEndYear);
  });
});

describe('E. a division with no verified eligibility rule yields no ceiling, however clear the label', () => {
  /**
   * 19 women's rows, all USCAA, all reading "First/Second/Third/Fourth Year".
   * The PARSER IS FINE - it returns SOPHOMORE for "Second Year". The gap is
   * that A7.32 could not verify a USCAA eligibility rule, and no amount of
   * class-year work closes it. Recorded so the two problems stay apart.
   */
  it('reads the class correctly', () => {
    expect(read('Second Year').klass).toBe('SOPHOMORE');
    expect(read('Fourth Year').klass).toBe('SENIOR');
  });

  it('and still produces no ceiling at USCAA or NJCAA', () => {
    for (const division of ['USCAA', 'NJCAA']) {
      expect(ceiling('Second Year', { division }).lastSeason, division).toBeNull();
    }
  });

  it('while the same label at a ruled division does produce one', () => {
    expect(ceiling('Second Year', { division: 'NCAA D3' }).lastSeason).not.toBeNull();
  });
});

describe('F. the coverage the parser already has, pinned so a refactor cannot quietly lose it', () => {
  /**
   * A7.39 measured ZERO unrecognised labels across 117 distinct values in the
   * 2026 rosters. A sample of the awkward ones, so that number stays true.
   */
  it.each([
    ['Fr.', 'FRESHMAN'], ['Fy.', 'FRESHMAN'], ['F.Y.', 'FRESHMAN'], ['1st Yr.', 'FRESHMAN'],
    ['First-Year', 'FRESHMAN'], ['So. (2nd)', 'SOPHOMORE'], ['Sophmore', 'SOPHOMORE'],
    ['3rd YR', 'JUNIOR'], ['4th year', 'SENIOR'], ['sr.', 'SENIOR'],
    ['Graduate Student', 'GRADUATE'], ['5th+', 'GRADUATE'], ['5th-year Senior', 'GRADUATE'],
    ['Sixth Year', 'GRADUATE'], ['Gr. (5th)', 'GRADUATE'], ['Jr./Fy.', 'JUNIOR'],
  ])('%s reads as %s', (label, klass) => {
    const r = read(label);
    expect(r.recognised).toBe(true);
    expect(r.klass).toBe(klass);
  });

  it('a label that is not a class year at all is still reported as unrecognised', () => {
    // The signal the importer acts on. It must not be blunted by anything above.
    for (const junk of ['Midfielder', 'Barcelona FC', '#17', 'Leeds, England']) {
      expect(read(junk).recognised, junk).toBe(false);
    }
  });
});
