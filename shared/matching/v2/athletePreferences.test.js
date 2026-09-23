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
      expect(f.helper).toMatch(/what you want/);
    }
  });

  it('never asks the athlete to assess their own ability or chances', () => {
    // "the strongest level you can realistically reach" invited exactly that.
    // What is reachable is Coach Recruitability's answer, not the athlete's.
    for (const f of Object.values(PREFERENCE_FIELDS)) {
      const text = `${f.question} ${Object.values(f.anchors).join(' ')}`.toLowerCase();
      for (const forbidden of ['realistic', 'reach', 'your ability', 'your level', 'good enough', 'likely']) {
        expect(text, `${f.question} contains "${forbidden}"`).not.toContain(forbidden);
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
