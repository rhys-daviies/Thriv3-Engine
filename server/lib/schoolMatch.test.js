import { describe, it, expect } from 'vitest';
import { matchSchoolName, normalizeSchoolName } from './schoolMatch.js';

describe('the matches that corrupted three columns', () => {
  // Every one of these was a confident wrong answer in live data.
  it('refuses a satellite campus for a flagship name', () => {
    expect(matchSchoolName('USC', ['USC Upstate'])).toBeNull();
    expect(matchSchoolName('Purdue', ['Purdue Fort Wayne'])).toBeNull();
    expect(matchSchoolName('Illinois', ['Eastern Illinois', 'Western Illinois'])).toBeNull();
    expect(matchSchoolName('Arkansas', ['Central Arkansas'])).toBeNull();
    expect(matchSchoolName('Houston', ['Houston Christian'])).toBeNull();
    expect(matchSchoolName('Utah', ['Utah Tech'])).toBeNull();
    expect(matchSchoolName('Florida', ['Florida Atlantic'])).toBeNull();
  });

  // "state" used to be stripped, so these normalised to one string.
  it('keeps a state university distinct from its namesake', () => {
    expect(normalizeSchoolName('Georgia')).not.toBe(normalizeSchoolName('Georgia State'));
    for (const [flagship, other] of [
      ['Georgia', 'Georgia State'], ['Ohio', 'Ohio State'],
      ['Missouri', 'Missouri State'], ['Oregon', 'Oregon State'],
    ]) {
      expect(matchSchoolName(flagship, [other]), `${flagship} vs ${other}`).toBeNull();
    }
  });

  it('refuses the ones that broke the other two columns', () => {
    expect(matchSchoolName('Belmont', ['Belmont Abbey'])).toBeNull();
    expect(matchSchoolName('Michigan', ['Northern Michigan'])).toBeNull();
    expect(matchSchoolName('Amherst', ['University of Massachusetts Amherst'])).toBeNull();
  });
});

describe('the case no rule over names can decide', () => {
  // "Adrian" plus "College" is one school. "Cornell" plus "College" is two.
  // Both are a generic word away, so the matcher cannot tell them apart, and
  // bridging generic words is not optional — the coach files write "Adrian
  // College" where the records file writes "Adrian". This documents the
  // limitation rather than pretending it is solved.
  it('bridges a generic word even when that is the wrong answer', () => {
    expect(matchSchoolName('Adrian', ['Adrian College'])).toBe('Adrian College');
    expect(matchSchoolName('Cornell', ['Cornell College'])).toBe('Cornell College');
  });

  // What actually protects against it: an exact entry wins outright, so a
  // source file holding both spellings is never at risk. That is why Cornell
  // (9.8, Ivy) and Cornell College (6.6, D3) are both correctly rated today.
  it('is protected wherever the source names both schools', () => {
    const candidates = ['Cornell', 'Cornell College'];
    expect(matchSchoolName('Cornell', candidates)).toBe('Cornell');
    expect(matchSchoolName('Cornell College', candidates)).toBe('Cornell College');
  });
});

describe('the matches it still has to make', () => {
  it('matches exactly, ignoring case and spacing', () => {
    expect(matchSchoolName('Duke', ['duke'])).toBe('duke');
    expect(matchSchoolName('  Akron ', ['Akron'])).toBe('Akron');
  });

  // The vocabularies genuinely differ in both directions.
  it('bridges generic words in either direction', () => {
    expect(matchSchoolName('Adrian', ['Adrian College'])).toBe('Adrian College');
    expect(matchSchoolName('Colorado College', ['Colorado College'])).toBe('Colorado College');
    expect(matchSchoolName('Amherst College', ['Amherst'])).toBe('Amherst');
    expect(matchSchoolName('Emory University', ['Emory'])).toBe('Emory');
  });

  it('still resolves the alias map', () => {
    expect(matchSchoolName('UConn', ['Connecticut'])).toBe('Connecticut');
    expect(matchSchoolName('BYU', ['Brigham Young'])).toBe('Brigham Young');
  });

  it('picks the right school out of a realistic candidate list', () => {
    const candidates = ['Eastern Illinois', 'Illinois', 'Northern Illinois', 'Illinois State'];
    expect(matchSchoolName('Illinois', candidates)).toBe('Illinois');
    expect(matchSchoolName('Illinois State', candidates)).toBe('Illinois State');
  });
});

describe('refusing rather than guessing', () => {
  it('returns null when nothing matches', () => {
    expect(matchSchoolName('Nowhere State', ['Duke', 'Akron'])).toBeNull();
    expect(matchSchoolName('', ['Duke'])).toBeNull();
  });

  // Two candidates normalising to one key cannot identify a school.
  it('refuses when candidates are ambiguous between themselves', () => {
    expect(matchSchoolName('Amherst', ['Amherst', 'Amherst College'])).toBe('Amherst');
    expect(matchSchoolName('Wheaton', ['Wheaton College (IL)', 'Wheaton College (MA)'])).toBeNull();
  });
});
