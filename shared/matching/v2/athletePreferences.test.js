import { describe, it, expect } from 'vitest';
import {
  UNDECLARED, PRIORITY_SCALE, PREFERENCE_FIELDS, readPriority, isDeclared, priorityStrength,
} from './athletePreferences.js';

describe('the intake contract', () => {
  it('names all three fields, nullable, defaulting to null', () => {
    expect(Object.keys(PREFERENCE_FIELDS).sort())
      .toEqual(['academic_strength_priority', 'competitive_level_priority', 'playing_opportunity_priority']);
    for (const f of Object.values(PREFERENCE_FIELDS)) {
      expect(f.nullable).toBe(true);
      expect(f.default).toBeNull();
      expect(f.allowed).toEqual([1, 2, 3, 4, 5]);
      expect(f.missingMeans).toBe('UNDECLARED');
    }
  });

  it('states in the contract itself that these are not ability ratings', () => {
    for (const f of Object.values(PREFERENCE_FIELDS)) {
      expect(f.notAnAbilityRating).toMatch(/WANTS/);
    }
  });

  it('asks a question an athlete can answer, anchored at every point', () => {
    for (const f of Object.values(PREFERENCE_FIELDS)) {
      expect(f.question).toMatch(/\?$/);
      for (const v of [1, 2, 3, 4, 5]) expect(f.anchors[v], `anchor ${v}`).toBeTruthy();
    }
  });

  /**
   * A7.12.1 REPLACED the old `/what you want/` assertion with this.
   *
   * That phrase was one way of saying the thing that matters, and asserting
   * the phrase rather than the thing meant the guard could be satisfied by
   * wording that said it and broken by wording that said it better. What
   * actually has to be true is that every question NAMES THE MISREADING AND
   * REFUSES IT - level is not a division, playing opportunity is not a
   * promise of minutes, academic preference is not a reading of grades.
   */
  it('disclaims, in every helper, the thing its question could be misread as', () => {
    for (const f of Object.values(PREFERENCE_FIELDS)) {
      expect(f.helper, `${f.question} has no disclaimer`).toMatch(/\b(does not|do not)\b/);
    }
    expect(PREFERENCE_FIELDS.competitive_level_priority.helper).toMatch(/division/i);
    expect(PREFERENCE_FIELDS.playing_opportunity_priority.helper).toMatch(/predict or guarantee/i);
    expect(PREFERENCE_FIELDS.academic_strength_priority.helper).toMatch(/grades and test scores/i);
  });

  /**
   * NARROWED AT A7.12.1, deliberately and with a cost.
   *
   * The list used to contain the bare token "realistic", because A7.7.5 had
   * just removed "the strongest level you can realistically reach" - a
   * question that asks a seventeen-year-old to estimate their own ceiling.
   * A7.12.1 locked the shipped wording as "the highest realistic college
   * level to you", which uses the word for the opposite purpose: it promises
   * that Thriv3 will not offer a level the athlete cannot reach.
   *
   * So the banned token moves from the word to the CONSTRUCTIONS that put the
   * assessment on the athlete, and a question that still uses "realistic" has
   * to have a helper saying who does the assessing. A bare re-ban of the word
   * would have failed the shipped copy; dropping the guard entirely would
   * have let "how realistic is D1 for you?" back in.
   */
  it('never asks the athlete to assess their own ability or chances', () => {
    for (const f of Object.values(PREFERENCE_FIELDS)) {
      const text = `${f.question} ${Object.values(f.anchors).join(' ')}`.toLowerCase();
      for (const forbidden of [
        'realistically reach', 'you can reach', 'could reach', 'able to reach',
        'your ability', 'your level', 'good enough', 'likely', 'your chances',
        'do you think you', 'realistic for you',
      ]) {
        expect(text, `${f.question} contains "${forbidden}"`).not.toContain(forbidden);
      }
      if (text.includes('realistic')) {
        expect(f.helper, `${f.question} uses "realistic" without saying who decides`)
          .toMatch(/thriv3/i);
      }
    }
  });
});

describe('missing means UNDECLARED, never a midpoint', () => {
  it('reads every kind of absence as undeclared', () => {
    for (const v of [null, undefined, '', NaN]) expect(readPriority(v)).toBe(UNDECLARED);
  });

  it('reads an out-of-scale answer as undeclared rather than clamping it', () => {
    // Clamping a 7 to a 5 records an answer nobody gave.
    for (const v of [0, 6, 7, -1, 2.5, 'a lot']) expect(readPriority(v), String(v)).toBe(UNDECLARED);
  });

  it('never resolves an absence to the neutral point', () => {
    expect(readPriority(null)).not.toBe(PRIORITY_SCALE.neutral);
    expect(priorityStrength(null)).toBeNull();
    expect(isDeclared(null)).toBe(false);
  });

  it('reads every value on the scale', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      expect(readPriority(v)).toBe(v);
      expect(isDeclared(v)).toBe(true);
    }
  });

  it('accepts the stored string form a form post produces', () => {
    expect(readPriority('4')).toBe(4);
  });
});

describe('priority strength', () => {
  it('spans zero to one across the scale', () => {
    expect(priorityStrength(1)).toBe(0);
    expect(priorityStrength(3)).toBe(0.5);
    expect(priorityStrength(5)).toBe(1);
  });

  it('is monotone', () => {
    let prev = -1;
    for (const v of [1, 2, 3, 4, 5]) {
      expect(priorityStrength(v)).toBeGreaterThan(prev);
      prev = priorityStrength(v);
    }
  });
});

describe('migration of existing records', () => {
  it('gives every existing athlete UNDECLARED, because nobody asked them', () => {
    // The migration is the column default. There is no backfill, and no value
    // derived from criterion_ranking - the legacy tokens are ambiguous across
    // exactly this boundary, which is why these fields exist.
    const existingRow = { id: 'p1', criterion_ranking: '["athletic","roster","academic","affordability","programQuality","geography"]' };
    expect(readPriority(existingRow.competitive_level_priority)).toBe(UNDECLARED);
    expect(readPriority(existingRow.playing_opportunity_priority)).toBe(UNDECLARED);
  });
});
