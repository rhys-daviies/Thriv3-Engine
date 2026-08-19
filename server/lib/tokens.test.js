import { describe, it, expect } from 'vitest';
import { generateToken, generateSlug, generateUnique } from './tokens.js';
import { OUTREACH_TOKEN_LENGTH, PUBLIC_SLUG_LENGTH } from './config.js';

describe('token generation', () => {
  it('produces 32-character alphanumeric tokens', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateToken()).toMatch(new RegExp(`^[A-Za-z0-9]{${OUTREACH_TOKEN_LENGTH}}$`));
    }
  });

  it('produces 10-character slugs', () => {
    expect(generateSlug()).toMatch(new RegExp(`^[A-Za-z0-9]{${PUBLIC_SLUG_LENGTH}}$`));
  });

  it('does not repeat across a large sample', () => {
    const seen = new Set();
    for (let i = 0; i < 10_000; i++) seen.add(generateToken());
    expect(seen.size).toBe(10_000);
  });

  it('encodes nothing guessable — no ordering between successive tokens', () => {
    const tokens = Array.from({ length: 50 }, generateToken);
    const sorted = [...tokens].sort();
    expect(tokens).not.toEqual(sorted);
  });

  describe('generateUnique', () => {
    it('redraws past a collision', () => {
      const queue = ['taken', 'taken', 'free'];
      let calls = 0;
      const make = () => queue[calls++];
      const value = generateUnique(make, (candidate) => candidate === 'taken');
      expect(value).toBe('free');
      expect(calls).toBe(3);
    });

    it('gives up rather than looping forever', () => {
      expect(() => generateUnique(() => 'taken', () => true, 3)).toThrow(/unique value after 3/);
    });
  });
});
