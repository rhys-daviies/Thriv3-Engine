import { describe, it, expect } from 'vitest';
import { readClassYear, isClassYearLabel } from './classYear.js';

const grad = (label, season = 2025) => readClassYear(label, { season }).graduationYear;
const klass = (label) => readClassYear(label).klass;

describe('the plain labels', () => {
  it('reads the four classes and graduate', () => {
    expect(grad('Fr.')).toBe(2030);
    expect(grad('So.')).toBe(2029);
    expect(grad('Jr.')).toBe(2028);
    expect(grad('Sr.')).toBe(2027);
    expect(grad('Gr.')).toBe(2026);
  });

  // The convention is one year "late" versus the intuitive reading, and it is
  // deliberate: it keeps a player's graduation year stable across seasons,
  // which is what the turnover diff depends on.
  it('offsets from the season, so the same player scores the same in both seasons', () => {
    expect(grad('Jr.', 2024)).toBe(2027);
    expect(grad('Sr.', 2025)).toBe(2027);
  });
});

describe('the hundred ways a site writes it', () => {
  it('strips the field label some sites leave in the cell', () => {
    expect(grad('Cl.: Jr')).toBe(2028);
    expect(grad('Yr.: Sr')).toBe(2027);
    expect(grad('Class: Freshman')).toBe(2030);
    expect(grad('Year: So')).toBe(2029);
  });

  it('reads words, abbreviations and misspellings alike', () => {
    expect(grad('Sophomore')).toBe(2029);
    expect(grad('Sophmore')).toBe(2029);
    expect(grad('Soph.')).toBe(2029);
    expect(grad('First-Year')).toBe(2030);
    expect(grad('F.Y.')).toBe(2030);
    expect(grad('Graduate Student')).toBe(2026);
    expect(grad('GS')).toBe(2026);
  });

  it('reads years of study as well as class names', () => {
    expect(grad('1st')).toBe(2030);
    expect(grad('3rd year')).toBe(2028);
    expect(grad('Fourth Year')).toBe(2027);
  });

  // A fifth or sixth year is on the way out, whatever the site calls them.
  it('treats a fifth or sixth year as graduating', () => {
    expect(grad('5th')).toBe(2026);
    expect(grad('Fifth Year')).toBe(2026);
    expect(grad('Sixth Year')).toBe(2026);
    expect(grad('6th')).toBe(2026);
    // Not hypothetical — a 2024 roster listed an "8th".
    expect(grad('8th')).toBe(2026);
  });

  it('takes an explicit year straight from the cell', () => {
    expect(grad('2027')).toBe(2027);
    expect(grad("'27")).toBe(2027);
  });

  it('takes the left side of a dual label', () => {
    expect(grad('Jr./So.')).toBe(2028);
    expect(grad('So./Fr.')).toBe(2029);
  });

  it('ignores letter-winner and transfer suffixes', () => {
    expect(grad('Jr.-2L')).toBe(2028);
    expect(grad('Sr.-TR')).toBe(2027);
    expect(grad('Sr. (4th)')).toBe(2027);
  });
});

describe('redshirts', () => {
  // Leftmost-first alternation meant a bare "r" beat "rs" and "redshirt",
  // decomposing "RS-Fr." into the nonsense "s-fr" and losing 158 rows.
  it('reads every redshirt spelling without eating the class', () => {
    for (const label of ['RS-Fr.', 'RS Fr.', 'R-Fr.', 'RFr.', 'R.Fr.', 'Rf.', 'Redshirt Freshman', 'r-Fr']) {
      expect(grad(label), label).toBe(2030);
    }
    expect(grad('RS-So.')).toBe(2029);
    expect(grad('Redshirt Junior')).toBe(2028);
    expect(grad('RS-Sr.')).toBe(2027);
    expect(grad('Red 5th')).toBe(2026);
  });

  it('marks the redshirt without changing the class', () => {
    expect(readClassYear('RS-Jr.', { season: 2025 })).toMatchObject({ klass: 'JUNIOR', redshirt: true });
    expect(readClassYear('Jr.', { season: 2025 })).toMatchObject({ klass: 'JUNIOR', redshirt: false });
  });

  // "Rs." on its own says the player redshirted and nothing about their class.
  // Absent is the honest answer; inventing a class would be worse than a null.
  it('accepts a bare redshirt marker as carrying no class', () => {
    for (const label of ['Rs.', 'RS', 'Medical Redshirt']) {
      const read = readClassYear(label, { season: 2025 });
      expect(read.recognised, label).toBe(true);
      expect(read.graduationYear, label).toBeNull();
    }
  });
});

describe('refusing to read the wrong column', () => {
  // The Texas Tech failure: a Club column read as Class/Year. Fifteen players
  // arrived with club names, and "Solar" was assigned a graduation year of 2029.
  it('rejects the club names that reached the database', () => {
    for (const club of [
      'FC Dallas', 'FC Dallas (DA)', 'Real Colorado', 'DKSC', 'Concorde Fire',
      'Bloomfield Blast', 'Oklahoma Energy', 'Portland Thorns Academy',
      'Sting Black', 'Solar', 'U.S. Youth National Team',
    ]) {
      expect(isClassYearLabel(club), club).toBe(false);
    }
  });

  it('rejects other columns that could land here', () => {
    expect(isClassYearLabel('Dallas, Texas')).toBe(false);
    expect(isClassYearLabel('Goalkeeper')).toBe(false);
    expect(isClassYearLabel('England')).toBe(false);
  });

  it('gives a rejected label no graduation year at all', () => {
    expect(readClassYear('Solar', { season: 2025 })).toMatchObject({
      recognised: false, graduationYear: null, klass: null,
    });
  });

  // An empty cell is a gap, not a corrupted column. Conflating the two would
  // make 1,218 ordinary missing labels look like a scraper bug.
  it('treats an empty cell as absent rather than suspicious', () => {
    for (const empty of ['', '   ', null, undefined]) {
      const read = readClassYear(empty, { season: 2025 });
      expect(read.recognised).toBe(true);
      expect(read.graduationYear).toBeNull();
    }
  });
});

describe('without a season', () => {
  it('still classifies, but declines to invent a year', () => {
    expect(klass('Jr.')).toBe('JUNIOR');
    expect(readClassYear('Jr.').graduationYear).toBeNull();
  });
});
