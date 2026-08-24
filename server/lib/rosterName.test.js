import { describe, it, expect } from 'vitest';
import { isPlausibleName } from './rosterName.js';

describe('rejecting a column that is not names', () => {
  // The 2024 scrape read the jersey column for four D1 women's programmes.
  it('rejects the jersey placeholders that reached the database', () => {
    for (const v of ['Jersey Number 0', 'Jersey Number 9', 'jersey number 12']) {
      expect(isPlausibleName(v), v).toBe(false);
    }
  });

  it('rejects bare numbers and filler', () => {
    for (const v of ['7', '#7', 'No. 7', 'TBA', 'TBD', 'N/A', 'Unknown', 'Total', '']) {
      expect(isPlausibleName(v), v).toBe(false);
    }
  });
});

describe('accepting the names rosters actually carry', () => {
  // A stricter rule would quietly delete real players, which is worse than
  // the bug it prevents.
  it('accepts names in every shape the roster holds', () => {
    for (const v of [
      'Koji Poon',
      'Kundalini Bien-Aimé Dominique',
      "Connor O'Keefe",
      'Javier Solá Martínez',
      'Zac Siebenlist Jr.',
      'La Vall Uixó',
      'Xu Li',
    ]) {
      expect(isPlausibleName(v), v).toBe(true);
    }
  });

  it('accepts a name that merely contains digits', () => {
    expect(isPlausibleName('John Smith 3rd')).toBe(true);
  });
});
