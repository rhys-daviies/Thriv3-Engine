/**
 * =============================================================================
 * A7.41 — what position evidence may and may not become.
 *
 * DIAGNOSTIC PHASE. No repair is encoded here. Each block pins a property the
 * audit established, including two DEFECTS that are recorded rather than fixed,
 * so a later phase changes them on purpose.
 *
 * The audit's headline: all 1,756 unreadable rows carry the single literal
 * value 'UNKNOWN'. Nothing is absent and nothing fails to parse - the value is
 * a RECORDED ABSENCE written upstream, which is the exact mirror of A7.39,
 * where every label parsed and the problem was that 752 were missing.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { canonicalPosition, POSITIONS } from './positions.js';
import { assessFieldCoverage, ACQUISITION_SIGNAL } from './rosterAcquisitionGuard.js';

describe('1. the parser never invents a position', () => {
  it.each([null, undefined, '', '   ', 'UNKNOWN', 'unknown', '—', 'N/A', 'Utility', 'Athlete'])(
    '%s reads as UNKNOWN', (raw) => {
      expect(canonicalPosition(raw)).toBe('UNKNOWN');
    });

  it('refuses a track-and-field event rather than guessing a soccer position', () => {
    /**
     * NOT HYPOTHETICAL. Grand Canyon and Kansas State women's soccer were
     * acquired from a page carrying DIS, Distance, Jumps, Throws and MD.
     * Refusing them is why the contamination was visible at all - see block 4.
     */
    for (const event of ['DIS', 'Distance', 'Jumps', 'Throws', 'MD', 'Hurdles', 'Pole Vault']) {
      expect(canonicalPosition(event), event).toBe('UNKNOWN');
    }
  });

  it('only ever returns one of the four groups, or UNKNOWN', () => {
    const seen = new Set(['GK', 'D', 'M', 'F', 'CB', 'ST', 'nonsense', '', null].map(canonicalPosition));
    for (const v of seen) expect([...POSITIONS, 'UNKNOWN']).toContain(v);
  });
});

describe('2. the deterministic vocabulary still reads, so a richer source would land', () => {
  /**
   * Worth pinning even though the stored data holds only the four group names:
   * the acquisition collapses to those BEFORE Thriv3 sees anything, so this
   * vocabulary is the contract for any future source that sends real labels.
   */
  it.each([
    ['GK', 'GOALKEEPER'], ['Goalie', 'GOALKEEPER'],
    ['CB', 'DEFENSE'], ['RB', 'DEFENSE'], ['WB', 'DEFENSE'], ['Defender', 'DEFENSE'],
    ['CDM', 'MIDFIELD'], ['CAM', 'MIDFIELD'], ['Midfielder', 'MIDFIELD'],
    ['ST', 'FORWARD'], ['RW', 'FORWARD'], ['Striker', 'FORWARD'],
  ])('%s reads as %s', (raw, group) => {
    expect(canonicalPosition(raw)).toBe(group);
  });
});

describe('3. DEFECT RECORDED — a multi-position label loses its second group silently', () => {
  /**
   * `canonicalPosition` takes the token before the first separator. Thomas
   * Jefferson's live page publishes "Defender/Midfielder"; a player listed
   * there is counted as competition at DEFENSE and as NOBODY at MIDFIELD.
   *
   * NOT REPAIRED HERE. A7.41 is a diagnosis, and the fix is a representation
   * question - whether the roster index can hold a player in two groups - not
   * a parsing one. These tests assert TODAY'S behaviour so the change is
   * deliberate; they should fail when a later phase fixes it.
   */
  it('collapses to the first group and reports nothing about the second', () => {
    expect(canonicalPosition('Defender/Midfielder')).toBe('DEFENSE');
    expect(canonicalPosition('M/F')).toBe('MIDFIELD');
    expect(canonicalPosition('D/M')).toBe('DEFENSE');
  });

  it('returns a bare string, so a caller cannot even discover a second group existed', () => {
    // The information is gone at the type level, not merely unused.
    expect(typeof canonicalPosition('Defender/Midfielder')).toBe('string');
  });
});

describe('4. the A7.40 guard catches position loss unmodified', () => {
  /**
   * Section 14 of the brief asks whether the field-agnostic guard already
   * covers this. It does: 14 CATASTROPHIC and 11 DROP programmes, holding 580
   * of the 1,756 rows. No guard change is recommended.
   */
  it('flags a programme that positioned every player last season and none now', () => {
    // Grand Canyon women's: 41/41 in 2025, 0/43 in 2026.
    const r = assessFieldCoverage({ rows: 43, populated: 0, history: [{ season: 2025, rows: 41, populated: 41 }] });
    expect(r.signal).toBe(ACQUISITION_SIGNAL.CATASTROPHIC_FIELD_LOSS);
    expect(r.review).toBe(true);
  });

  it('leaves chronically partial programmes alone', () => {
    // 294 of 328 programmes read OK: their gap matches their own history, and
    // turning those into 294 alarms would bury the 25 that matter.
    const r = assessFieldCoverage({ rows: 30, populated: 26, history: [{ season: 2025, rows: 28, populated: 24 }] });
    expect(r.signal).toBe(ACQUISITION_SIGNAL.OK);
    expect(r.review).toBe(false);
  });

  it('still refuses to supply a value', () => {
    const r = assessFieldCoverage({ rows: 43, populated: 0, history: [{ season: 2025, rows: 41, populated: 41 }] });
    expect(Object.keys(r)).not.toContain('value');
    expect(r.reason).toMatch(/do not fill the field from another season/);
  });
});

describe('5. DEFECT RECORDED — an unreadable position leaves no trace in the scorer', () => {
  /**
   * `buildPositionIndex` increments a PROGRAMME-level `unreadable` for a row
   * whose position it cannot read, and its own comment says why that matters:
   * "an unplaceable player is a gap in what we know about every position".
   *
   * That counter reaches diagnostics and report prose and NO SCORER. Both
   * `returningCompetition` and `positionalOpportunity` are handed the
   * BUCKET-level `unreadable`, and a row with no readable position is in no
   * bucket - so it is invisible to the very guard A7.37 added.
   *
   * Consequence, measured at entry 2027: of the cells scoring a MEASURED
   * zero-returner, 19 of 52 men's and 40 of 136 women's sit in programmes
   * holding position-unreadable rows, with 219 and 290 players unaccounted.
   *
   * NOT REPAIRED HERE, by instruction. This test states the shape of the gap
   * so the next phase has something to move.
   */
  it('the four groups are the whole ontology, so an unplaceable player has nowhere to go', () => {
    expect(POSITIONS).toEqual(['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD']);
    expect(POSITIONS).not.toContain('UNKNOWN');
  });

  it('UNKNOWN is not a group and must never become one', () => {
    // A bucket keyed 'UNKNOWN' would turn doubt into a position group and let
    // it be counted as competition somewhere. rosterEvidence.js guards this by
    // reading canonicalPosition through a null check; the property is pinned.
    expect(POSITIONS.includes(canonicalPosition('anything unparseable'))).toBe(false);
  });
});
