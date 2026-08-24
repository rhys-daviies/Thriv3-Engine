import { describe, it, expect } from 'vitest';
import { isPlausibleName, cleanRosterName } from './rosterName.js';

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

describe('stripping what the page decorated the name with', () => {
  // 118 schools mark captains with a bare "C", and 67 of those names have an
  // exact 2025 twin without it — a departure and an arrival from one player.
  it('removes a captain marker', () => {
    expect(cleanRosterName('C Nathan Lagoa')).toBe('Nathan Lagoa');
    expect(cleanRosterName('C Adrian Schulze Solano')).toBe('Adrian Schulze Solano');
    expect(cleanRosterName('Parker Owens (C)')).toBe('Parker Owens');
  });

  // A real initial is written with a period. Stripping it would rename people.
  it('leaves a genuine leading initial alone', () => {
    expect(cleanRosterName('C. Vicente Benitez Delgado')).toBe('C. Vicente Benitez Delgado');
    expect(cleanRosterName('C. Mckenzie')).toBe('C. Mckenzie');
  });

  it('will not eat a first name that is itself an initial', () => {
    expect(cleanRosterName('C J Smith')).toBe('C J Smith');
  });

  it('collapses a name printed twice', () => {
    expect(cleanRosterName('Trevor Rau Trevor Rau')).toBe('Trevor Rau');
    expect(cleanRosterName('Caden Gallagher Caden Gallagher')).toBe('Caden Gallagher');
  });

  it('leaves an ordinary name untouched', () => {
    for (const n of ['Koji Poon', 'Kundalini Bien-Aimé Dominique', "Connor O'Keefe", 'Xu Li']) {
      expect(cleanRosterName(n), n).toBe(n);
    }
  });
});
