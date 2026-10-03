import { describe, it, expect } from 'vitest';
import { standingsIndex, standingsFor, UNMATCHED, NO_RUN } from './matchmakingStandings.js';
import { persistedRun, RANKED_PROGRAMMES, LIMITED_DATA_PROGRAMME } from './__fixtures__/matchmakingV2Run.js';

/**
 * A10 §D — THE SPECIFIC-SCHOOL LOOKUP.
 *
 * Pure, so it can be held to its contract without mounting anything. The
 * contract is small and the whole of it is "say what the run says, or say that
 * the run does not say": there is no third behaviour, and in particular there
 * is no behaviour that produces a number.
 */

const run = persistedRun();
const SPORT = run.sport;

describe('A10 §D. reading a programme out of the persisted run', () => {
  it('D1. returns the run\'s own row for a ranked programme', () => {
    const standing = standingsIndex(run).for('Lindenwood', SPORT);
    expect(standing.programme).toBe(RANKED_PROGRAMMES[0]);
    expect(standing.programme.rank).toBe(1);
    expect(standing.programme.band).toBe('PRIORITY_OUTREACH');
  });

  it('D2. carries the run\'s own ranked count as the denominator', () => {
    const index = standingsIndex(run);
    expect(index.rankedCount).toBe(run.counts.ranked);
    expect(index.for('Lindenwood', SPORT).rankedCount).toBe(run.counts.ranked);
  });

  it('D3. NEVER derives the denominator from the array it was handed', () => {
    /**
     * `programmes` is a slice in every payload that matters — the persisted
     * run holds the whole universe, but the array's length is the number of
     * ROWS, which includes the unranked tail. Printing it as "of N" would be a
     * denominator the run never claimed.
     */
    const index = standingsIndex(run);
    expect(index.rankedCount).not.toBe(run.programmes.length);
  });

  it('D4. returns a non-ranked programme truthfully, with no rank', () => {
    const standing = standingsIndex(run).for(LIMITED_DATA_PROGRAMME.name, SPORT);
    expect(standing.programme).toBe(LIMITED_DATA_PROGRAMME);
    expect(standing.programme.status).toBe('SUPPORTED_LIMITED_DATA');
    expect(standing.programme.rank).toBeUndefined();
  });
});

describe('A10 §N. a programme the run does not hold', () => {
  it('N1. answers UNMATCHED rather than null, so a caller cannot drop the row', () => {
    const standing = standingsIndex(run).for('A College Nobody Ranked', SPORT);
    expect(standing).toBe(UNMATCHED);
    expect(standing.programme).toBe(null);
  });

  it('N2. a sport mismatch is a miss, not a wrong answer', () => {
    /**
     * The run is one sport's universe. A relationship row carries its own
     * `sport`, and the two are not assumed to agree — if they do not, this
     * must not hand back the men\'s programme for a women\'s request.
     */
    const standing = standingsIndex(run).for('Lindenwood', 'womens-soccer');
    expect(standing.programme).toBe(null);
  });

  it('N3. identity is EXACT — a near-miss is reported, never resolved', () => {
    const index = standingsIndex(run);
    for (const near of ['lindenwood', 'Lindenwood ', ' Lindenwood', 'Lindenwood University']) {
      expect(index.for(near, SPORT).programme, `"${near}" must not match`).toBe(null);
    }
    /**
     * THIS IS THE POINT, NOT A LIMITATION. A fuzzy match converts a real
     * identity defect into a confident wrong answer attached to someone
     * else\'s rank — which is the Belmont Abbey / Belmont failure recorded in
     * server/lib/schoolMatch.js. A miss is surfaced to the operator instead.
     */
  });

  it('N4. an empty or absent name does not collide with a real programme', () => {
    const index = standingsIndex(run);
    expect(index.for(undefined, SPORT).programme).toBe(null);
    expect(index.for(null, SPORT).programme).toBe(null);
    expect(index.for('', SPORT).programme).toBe(null);
  });
});

describe('A10 §D. no run, and nothing invented', () => {
  it('D5. no run yields NO_RUN, whose answer is null rather than UNMATCHED', () => {
    expect(standingsFor(null)).toBe(NO_RUN);
    /**
     * "There is no run" and "the run does not hold this school" are different
     * statements and the screen says different things about them. Collapsing
     * them would tell a consultant with no run at all that every school they
     * asked for is outside the athlete\'s universe.
     */
    expect(standingsFor(null).for('Lindenwood')).toBe(null);
  });

  it('D6. a run with no programmes indexes to nothing and still answers', () => {
    const index = standingsFor(persistedRun({ programmes: [] }));
    expect(index.size).toBe(0);
    expect(index.for('Lindenwood', SPORT).programme).toBe(null);
  });

  it('D7. the index holds every programme in the run exactly once', () => {
    const index = standingsIndex(run);
    expect(index.size).toBe(run.programmes.length);
  });

  it('D8. nothing it returns is computed — every value is the run\'s own object', () => {
    const index = standingsIndex(run);
    for (const p of run.programmes) {
      expect(index.for(p.name, SPORT).programme, p.name).toBe(p);
    }
  });
});
