import { describe, it, expect } from 'vitest';
import { visibleTop100, suppressedProgrammeNames } from './visibleTop100.js';
import { TOP_RANKS } from './reserve.js';

/**
 * The derivation, which is the whole of this slice's risk.
 *
 * Two properties carry everything else. THE MODEL'S ANSWER IS NOT REWRITTEN —
 * the arrays that go in come out untouched, and every programme keeps the rank
 * the model gave it however high it is displayed. And SUPPRESSION IS ONE
 * DECISION, NOT THREE — a flag, a contact stance and a withdrawn request all
 * leave the list exactly as it was.
 */

const recs = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ name: `S${from + i}`, match_score: 200 - (from + i) }));
const RECS = recs(100);
const RESERVE = recs(50, 101);

const suppress = (...names) => names.map((n) => ({ college_name: n, visibility: 'suppressed' }));
const run = (relationships = [], { recommendations = RECS, reserve = RESERVE } = {}) =>
  visibleTop100({ recommendations, reserve, relationships });

const names = (out) => out.programmes.map((p) => p.name);
const ranks = (out) => out.programmes.map((p) => p.source_rank);

describe('with nothing suppressed', () => {
  it('returns the original recommendations, in order, unchanged', () => {
    const out = run();
    expect(out.programmes).toHaveLength(100);
    expect(names(out)).toEqual(RECS.map((r) => r.name));
    expect(ranks(out)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(out.promoted).toEqual([]);
    expect(out.suppressedCount).toBe(0);
    expect(out.exhausted).toBe(false);
  });

  it('does not top up a short list from the reserve', () => {
    // A pool narrowed by division and conference filters legitimately produces
    // 40, and 40 is this athlete's answer. The reserve replaces something
    // removed; it never extends the list.
    const out = run([], { recommendations: recs(40) });
    expect(out.programmes).toHaveLength(40);
    expect(out.promoted).toEqual([]);
    expect(out.exhausted).toBe(false);
    expect(out.shortfall).toBe(0);
  });
});

describe('suppression removes exactly one thing, and replaces it', () => {
  it('promotes when rank 1 is suppressed', () => {
    const out = run(suppress('S1'));
    expect(out.programmes).toHaveLength(100);
    expect(names(out)[0]).toBe('S2');
    // The displayed first slot is S2, and S2 is still rank 2. Nothing moved up
    // a number.
    expect(out.programmes[0].source_rank).toBe(2);
    expect(names(out)).not.toContain('S1');
    expect(out.promoted).toEqual([{ name: 'S101', source_rank: 101 }]);
  });

  it('promotes when rank 50 is suppressed', () => {
    const out = run(suppress('S50'));
    expect(out.programmes).toHaveLength(100);
    expect(names(out)).not.toContain('S50');
    expect(names(out)).toContain('S101');
    // Position 49 (0-indexed) is now S51, which is still rank 51.
    expect(out.programmes[49]).toMatchObject({ name: 'S51', source_rank: 51 });
  });

  it('promotes #101 when rank 100 is suppressed', () => {
    const out = run(suppress('S100'));
    expect(out.programmes).toHaveLength(100);
    expect(names(out)).not.toContain('S100');
    expect(out.programmes.at(-1)).toMatchObject({ name: 'S101', source_rank: 101, promoted: true });
  });

  it('promotes in original rank order for several suppressions', () => {
    const out = run(suppress('S1', 'S40', 'S99'));
    expect(out.programmes).toHaveLength(100);
    for (const gone of ['S1', 'S40', 'S99']) expect(names(out)).not.toContain(gone);
    // Three out, the next three in, in the order the model ranked them.
    expect(out.promoted.map((p) => p.name)).toEqual(['S101', 'S102', 'S103']);
    expect(out.promoted.map((p) => p.source_rank)).toEqual([101, 102, 103]);
    expect(out.suppressedCount).toBe(3);
  });

  it('never shows a suppressed recommendation, at any position', () => {
    const all = RECS.map((r) => r.name);
    for (const target of ['S1', 'S2', 'S51', 'S100']) {
      expect(names(run(suppress(target)))).not.toContain(target);
    }
    expect(all).toHaveLength(100);
  });
});

describe('a suppressed reserve programme', () => {
  it('is skipped without consuming a promotion slot', () => {
    // S101 is suppressed AND S1 is suppressed. S1's replacement should be S102
    // — the next programme the model actually ranked — not a hole. Suppressing
    // something that was never in the hundred cannot cost the hundred a slot.
    const out = run(suppress('S1', 'S101'));
    expect(out.programmes).toHaveLength(100);
    expect(names(out)).not.toContain('S101');
    expect(out.promoted).toEqual([{ name: 'S102', source_rank: 102 }]);
  });

  it('does not appear merely because something above it was removed', () => {
    const out = run(suppress('S101'));
    // Nothing was removed from the hundred, so nothing is promoted at all.
    expect(out.programmes).toHaveLength(100);
    expect(out.promoted).toEqual([]);
    expect(names(out)).not.toContain('S101');
  });
});

describe('the analysis is never rewritten', () => {
  it('leaves recommendations and reserve exactly as they were', () => {
    const before = JSON.stringify({ RECS, RESERVE });
    run(suppress('S1', 'S2', 'S3'));
    expect(JSON.stringify({ RECS, RESERVE })).toBe(before);
    // Not even the two fields this function authors.
    expect(RECS[0]).not.toHaveProperty('source_rank');
    expect(RESERVE[0]).not.toHaveProperty('promoted');
  });

  it('returns copies, so a caller cannot edit the analysis through them', () => {
    const out = run();
    out.programmes[0].name = 'MUTATED';
    expect(RECS[0].name).toBe('S1');
  });

  it('keeps every programme’s original rank recoverable', () => {
    const out = run(suppress('S1', 'S2'));
    // Displayed position 1 is S3; its rank is still 3, and #101/#102 are still
    // 101 and 102 however high they are shown.
    expect(out.programmes[0]).toMatchObject({ name: 'S3', source_rank: 3 });
    const promotedEntries = out.programmes.filter((p) => p.promoted);
    expect(promotedEntries.map((p) => p.source_rank)).toEqual([101, 102]);
  });

  it('invents no match score for a promoted programme', () => {
    const out = run(suppress('S1'));
    const promotedEntry = out.programmes.find((p) => p.promoted);
    // Whatever the model scored it, and nothing else.
    expect(promotedEntry.match_score).toBe(RESERVE[0].match_score);
  });
});

describe('capacity', () => {
  it('never returns more than 100', () => {
    expect(run().programmes).toHaveLength(TOP_RANKS);
    expect(run(suppress('S1')).programmes).toHaveLength(TOP_RANKS);
    expect(TOP_RANKS).toBe(100);
  });

  it('spends the whole reserve before it runs out', () => {
    const out = run(suppress(...RECS.slice(0, 50).map((r) => r.name)));
    expect(out.programmes).toHaveLength(100);
    expect(out.promoted).toHaveLength(50);
    expect(out.exhausted).toBe(false);
    expect(out.shortfall).toBe(0);
  });

  it('returns fewer than 100 truthfully when the reserve is exhausted', () => {
    const out = run(suppress(...RECS.slice(0, 51).map((r) => r.name)));
    // 49 survivors + 50 promoted = 99. Not 100, and it says so rather than
    // manufacturing a school to reach a round number.
    expect(out.programmes).toHaveLength(99);
    expect(out.exhausted).toBe(true);
    expect(out.shortfall).toBe(1);
    expect(out.promoted).toHaveLength(50);
  });

  it('has no headroom at all on an analysis written before the reserve existed', () => {
    // `null`, not `undefined` — a default parameter would swallow the latter.
    const out = run(suppress('S1'), { reserve: null });
    expect(out.programmes).toHaveLength(99);
    expect(out.exhausted).toBe(true);
    expect(out.shortfall).toBe(1);
    expect(out.promoted).toEqual([]);
  });
});

describe('only visibility suppresses', () => {
  it('ignores a flag, a contact stance and a withdrawn request', () => {
    const relationships = [
      { college_name: 'S1', visibility: 'default', flagged: true, flag_reason: 'knows the coach' },
      { college_name: 'S2', visibility: 'default', contact_stance: 'do_not_contact' },
      { college_name: 'S3', visibility: 'default', request_state: 'withdrawn' },
      { college_name: 'S4', visibility: 'default', request_state: 'requested' },
    ];
    const out = visibleTop100({ recommendations: RECS, reserve: RESERVE, relationships });
    // A coach the athlete already knows is often the MOST actionable school on
    // the list. A flag that hid it would be the opposite of what was asked.
    for (const n of ['S1', 'S2', 'S3', 'S4']) expect(names(out)).toContain(n);
    expect(out.suppressedCount).toBe(0);
  });

  it('suppresses a school that is flagged AND suppressed, for the visibility only', () => {
    const relationships = [{ college_name: 'S1', visibility: 'suppressed', flagged: true }];
    expect(names(visibleTop100({ recommendations: RECS, reserve: RESERVE, relationships })))
      .not.toContain('S1');
  });
});

describe('suppressedProgrammeNames', () => {
  it('collects only the suppressed ones', () => {
    const set = suppressedProgrammeNames([
      { college_name: 'A', visibility: 'suppressed' },
      { college_name: 'B', visibility: 'default' },
      { college_name: 'C', visibility: 'suppressed' },
      { college_name: null, visibility: 'suppressed' },
      null,
    ]);
    expect([...set].sort()).toEqual(['A', 'C']);
  });

  it('survives no relationships at all', () => {
    expect(suppressedProgrammeNames(undefined).size).toBe(0);
    expect(suppressedProgrammeNames([]).size).toBe(0);
  });
});

describe('degenerate inputs', () => {
  it('answers an empty analysis with an empty list rather than throwing', () => {
    const out = visibleTop100({});
    expect(out.programmes).toEqual([]);
    expect(out.target).toBe(0);
    expect(out.exhausted).toBe(false);
  });
});
