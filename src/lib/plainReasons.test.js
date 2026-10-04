import { describe, it, expect } from 'vitest';
import { plainSentence, isFinancialCaveat, FINANCIAL_CAVEAT_CODES } from './plainReasons.js';
/**
 * The engine's own sentence comes through `reasonSentence`, which is the ONE
 * approved doorway from `src/` into `shared/matching/v2/` — importing
 * `render.js` here directly is an import-boundary offence, and the guard
 * caught it. Going through the doorway is also the better test: it compares
 * the plain wording against the sentence the APP would show, not against one
 * this file reached past the boundary to fetch.
 */
import { summaryView, explanationView, reasonSentence } from './matchmakingV2View.js';

/**
 * THE PLAIN REGISTER — A11.2 §2.
 *
 * ===========================================================================
 * THE DANGER IN THIS FILE IS NOT THAT A SENTENCE READS BADLY.
 *
 * It is that a sentence reads WELL and says something the evidence does not
 * support. The engine's wording carries its magnitude in a number; drop the
 * number and the adverb has to carry it, and "very close to the standard they
 * are aiming at" is true at a three-point gap and false at a thirty-point one.
 * The brief offers exactly that sentence as the example to aim for, which is
 * why the banding is tested at both ends rather than at the one that reads
 * nicely.
 *
 * The other property worth more than the prose: no reason is ever LOST. A code
 * with no plain wording falls through to the engine's sentence, and the
 * summary hoists financial caveats that polarity ordering would bury.
 * ===========================================================================
 */

const reason = (code, evidence, over = {}) => ({
  code,
  layer: 'opportunity',
  polarity: 'strength',
  band: 2,
  sub: 0,
  listLevel: false,
  evidence,
  ...over,
});

describe('A11.2 §2. a banded claim is banded from the evidence', () => {
  it('B1. "very close" is reserved for a gap inside the input\'s own noise', () => {
    const near = plainSentence(reason('LEVEL_PREFERENCE_BELOW', { priority: 4, levelGapBelow: 0.03 }));
    expect(near).toContain('very close to the standard they are aiming at');
  });

  it('B2. a LARGE gap never reads as "very close" — the failure that matters', () => {
    const far = plainSentence(reason('LEVEL_PREFERENCE_BELOW', { priority: 4, levelGapBelow: 0.34 }));
    expect(far, 'a 34-point gap is not closeness').not.toContain('very close');
    expect(far).toContain('below the standard they are aiming at');

    const middling = plainSentence(reason('LEVEL_PREFERENCE_BELOW', { priority: 4, levelGapBelow: 0.12 }));
    expect(middling).toContain('a little below');
    expect(middling).not.toContain('very close');
  });

  it('B3. the athlete\'s stated priority is carried through verbatim', () => {
    const s = plainSentence(reason('LEVEL_PREFERENCE_BELOW', { priority: 4, levelGapBelow: 0.03 }));
    expect(s, 'the engine\'s own clause, not a rewrite').toContain('strong priority for this athlete (4 of 5)');

    const moderate = plainSentence(reason('LEVEL_PREFERENCE_BELOW', { priority: 3, levelGapBelow: 0.03 }));
    expect(moderate).toContain('moderately important (3 of 5)');
  });

  it('B4. reach is banded the same way, in the other direction', () => {
    expect(plainSentence(reason('ATHLETIC_MODEST_REACH', { levelGap: 0.03 })))
      .toContain('a little above');
    expect(plainSentence(reason('ATHLETIC_SUBSTANTIAL_REACH', { levelGap: 0.4 })))
      .toContain('well above');
  });

  it('B5. a missing gap produces NO plain sentence, so the engine\'s is used', () => {
    expect(plainSentence(reason('LEVEL_PREFERENCE_BELOW', { priority: 4 })), 'no guess').toBeNull();
    expect(plainSentence(reason('ATHLETIC_MODEST_REACH', {})), 'no guess').toBeNull();
  });
});

describe('A11.2 §2. the numbers go, the meaning stays', () => {
  it('N1. the share-against-median figures are gone from the plain wording', () => {
    const r = reason('PLAYING_SHARE_NARROW', {
      share: 0.5276, median: 0.5635, level: 'programme', strength: 'LIMITED',
    });
    const engine = reasonSentence(r);
    const plain = plainSentence(r);

    expect(engine, 'the engine does carry them').toContain('0.5276');
    expect(plain).not.toContain('0.5276');
    expect(plain).not.toContain('0.5635');
    /** Same direction, same hedge. */
    expect(plain).toMatch(/concentrated among fewer players/);
    expect(plain).toMatch(/suggests/);
  });

  it('N2. the plain wording never reads more confidently than the engine\'s', () => {
    const codes = [
      ['PLAYING_SHARE_NARROW', { share: 0.4, median: 0.56, level: 'programme', strength: 'LIMITED' }],
      ['PLAYING_SHARE_WIDE', { share: 0.7, median: 0.56, level: 'programme', strength: 'LIMITED' }],
      ['ATHLETIC_BEYOND_RANGE', { levelGap: 0.5 }],
      ['LEVEL_ANCHOR_APPLIED', {
        direction: 'REACH', levelGap: 0.2, competitiveLevelPriority: 4, priorityDefaulted: false, factor: 0.82,
      }],
    ];
    for (const [code, evidence] of codes) {
      const plain = plainSentence(reason(code, evidence));
      expect(plain, code).toBeTruthy();
      expect(plain, `${code} claims no certainty`).not.toMatch(/guarantee|will start|certain|assured|definitely/i);
      expect(plain, `${code} exposes no raw decimal`).not.toMatch(/\d\.\d{3,}/);
    }
  });

  it('N3. the level anchor keeps its "estimate, not a limit" caveat', () => {
    const plain = plainSentence(reason('LEVEL_ANCHOR_APPLIED', {
      direction: 'REACH', levelGap: 0.2, competitiveLevelPriority: 4, priorityDefaulted: false, factor: 0.82,
    }));
    expect(plain).toContain('estimate and an anchor, not a limit');
    expect(plain, 'the reduction factor is operator detail').not.toContain('0.82');
  });

  it('N4. an unmapped code has NO plain wording, and is not thereby dropped', () => {
    expect(plainSentence(reason('POSITION_OPENING_MEASURED', {
      vacatedStarters: 1, typicalStarters: 4, position: 'DEFENSE',
    }))).toBeNull();
  });

  it('N5. a malformed basis degrades to null rather than throwing', () => {
    expect(plainSentence(reason('LEVEL_PREFERENCE_BELOW', null))).toBeNull();
    expect(plainSentence(null)).toBeNull();
    expect(plainSentence({ code: 'NOT_A_REAL_CODE', evidence: {} })).toBeNull();
  });
});

describe('A11.2 §2. the summary keeps what ranking would bury', () => {
  const explanation = (reasons) => ({
    reasons,
    layerReasons: { recruitability: [], financial: [], opportunity: [] },
  });

  /** Three strengths that will take every ranked slot. */
  const strengths = [
    reason('POSITION_OPENING_MEASURED', { vacatedStarters: 1, typicalStarters: 4, position: 'DEFENSE' }, { band: 2 }),
    reason('COST_WITHIN_BUDGET', { stated: 30000, cost: [28400, 28400], budget: [0, 30000] }, { layer: 'financial', band: 2 }),
    reason('ATHLETIC_AT_OR_ABOVE_LEVEL', { levelGap: 0.03 }, { layer: 'recruitability', band: 2 }),
    reason('MARKET_INTERNATIONAL_HISTORY', { share: 0.31, count: 9, total: 29 }, { layer: 'recruitability', band: 3 }),
  ];

  const caveat = reason('AID_KNOWN_NONE', { rule: 'NCAA Division III' }, {
    layer: 'financial', polarity: 'context', band: 4,
  });

  it('S1. the caveat is hoisted past reasons that outranked it', () => {
    const rows = summaryView(explanation([...strengths, caveat]));
    const codes = rows.map((r) => r.code);

    expect(codes, 'present despite ranking fifth').toContain('AID_KNOWN_NONE');
    /** And it did not displace the leading answer. */
    expect(codes[0]).not.toBe('AID_KNOWN_NONE');
    expect(rows.find((r) => r.code === 'AID_KNOWN_NONE').text)
      .toContain('does not permit athletic scholarships');
  });

  it('S2. every caveat code is recognised as one', () => {
    for (const code of FINANCIAL_CAVEAT_CODES) {
      expect(isFinancialCaveat({ code }), code).toBe(true);
    }
    expect(isFinancialCaveat({ code: 'POSITION_OPENING_MEASURED' })).toBe(false);
  });

  it('S3. a caveat is never printed twice when it already ranked', () => {
    const rows = summaryView(explanation([caveat, ...strengths]));
    const codes = rows.map((r) => r.code);
    expect(codes.filter((c) => c === 'AID_KNOWN_NONE'), 'exactly once').toHaveLength(1);
  });

  it('S4. `text` is the plain wording where there is one, the engine\'s otherwise', () => {
    const narrow = reason('PLAYING_SHARE_NARROW', {
      share: 0.5276, median: 0.5635, level: 'programme', strength: 'LIMITED',
    }, { polarity: 'strength', band: 1 });

    const rows = summaryView(explanation([narrow, ...strengths]));
    const row = rows.find((r) => r.code === 'PLAYING_SHARE_NARROW');
    expect(row.text, 'plain register').not.toContain('0.5276');

    const opening = rows.find((r) => r.code === 'POSITION_OPENING_MEASURED');
    expect(opening.text, 'no plain wording, so the engine\'s own').toBe(opening.sentence);
    expect(opening.text).toContain('Roster evidence shows');
  });

  it('S5. the DETAILED view is untouched — it is still the engine, verbatim', () => {
    const narrow = reason('PLAYING_SHARE_NARROW', {
      share: 0.5276, median: 0.5635, level: 'programme', strength: 'LIMITED',
    });
    const e = {
      reasons: [narrow],
      layerReasons: { recruitability: [], financial: [], opportunity: [narrow] },
    };
    const rows = explanationView(e, { layer: 'opportunity' });
    expect(rows[0].sentence, 'figures intact for the operator').toContain('0.5276');
    expect(rows[0].sentence).toBe(reasonSentence(narrow));
  });
});
