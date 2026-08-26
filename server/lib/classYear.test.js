import { describe, it, expect } from 'vitest';
import { readClassYear, isClassYearLabel } from './classYear.js';

const grad = (label, season = 2025) => readClassYear(label, { season }).graduationYear;
const klass = (label) => readClassYear(label).klass;

describe('the plain labels', () => {
  it('reads the four classes and graduate', () => {
    expect(grad('Fr.')).toBe(2029);
    expect(grad('So.')).toBe(2028);
    expect(grad('Jr.')).toBe(2027);
    expect(grad('Sr.')).toBe(2026);
    expect(grad('Gr.')).toBe(2026);
  });

  // The property that matters is that a player's graduation year does not move
  // when they move up a class, which is what the turnover diff depends on.
  // That needs the offsets to be one apart, not to be any particular value —
  // and until 2026-08-25 every one of them was one too high while satisfying
  // this test perfectly. Hence the concordance test below, which pins the
  // absolute value to something outside the model's own convention.
  it('offsets from the season, so the same player scores the same in both seasons', () => {
    expect(grad('Jr.', 2024)).toBe(2026);
    expect(grad('Sr.', 2025)).toBe(2026);
  });
});

/**
 * The arbiter for the absolute offset.
 *
 * Some rosters print "Sr." and some print "2026" for the very same player, and
 * the printed year is literal fact while the class label has to be converted.
 * So the two must agree, and if they ever stop agreeing it is the conversion
 * that is wrong. They disagreed by a year until 2026-08-25 and nothing noticed,
 * because every other test was written against the conversion itself.
 */
describe('class labels agree with the years rosters print literally', () => {
  it('puts a fall-2025 roster into the 2026-2029 classes, as printed rosters do', () => {
    expect(grad('Sr.', 2025)).toBe(2026);
    expect(grad('Jr.', 2025)).toBe(2027);
    expect(grad('So.', 2025)).toBe(2028);
    expect(grad('Fr.', 2025)).toBe(2029);
  });

  it('agrees with an explicit year for the same player', () => {
    // A senior in the fall 2025 season finishes in spring 2026, whichever way
    // their school chose to write it.
    expect(grad('Sr.', 2025)).toBe(grad('2026', 2025));
    expect(grad('Fr.', 2025)).toBe(grad('2029', 2025));
  });

  it('leaves a player on the same graduation year as they move up a class', () => {
    expect(grad('So.', 2023)).toBe(grad('Jr.', 2024));
    expect(grad('Jr.', 2024)).toBe(grad('Sr.', 2025));
  });

  it('has seniors and graduate students both leaving after this season', () => {
    expect(grad('Sr.', 2025)).toBe(grad('Gr.', 2025));
  });
});

describe('the hundred ways a site writes it', () => {
  it('strips the field label some sites leave in the cell', () => {
    expect(grad('Cl.: Jr')).toBe(2027);
    expect(grad('Yr.: Sr')).toBe(2026);
    expect(grad('Class: Freshman')).toBe(2029);
    expect(grad('Year: So')).toBe(2028);
  });

  it('reads words, abbreviations and misspellings alike', () => {
    expect(grad('Sophomore')).toBe(2028);
    expect(grad('Sophmore')).toBe(2028);
    expect(grad('Soph.')).toBe(2028);
    expect(grad('First-Year')).toBe(2029);
    expect(grad('F.Y.')).toBe(2029);
    expect(grad('Graduate Student')).toBe(2026);
    expect(grad('GS')).toBe(2026);
  });

  it('reads years of study as well as class names', () => {
    expect(grad('1st')).toBe(2029);
    expect(grad('3rd year')).toBe(2027);
    expect(grad('Fourth Year')).toBe(2026);
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
    expect(grad('Jr./So.')).toBe(2027);
    expect(grad('So./Fr.')).toBe(2028);
  });

  it('ignores letter-winner and transfer suffixes', () => {
    expect(grad('Jr.-2L')).toBe(2027);
    expect(grad('Sr.-TR')).toBe(2026);
    expect(grad('Sr. (4th)')).toBe(2026);
  });
});

describe('redshirts', () => {
  // Leftmost-first alternation meant a bare "r" beat "rs" and "redshirt",
  // decomposing "RS-Fr." into the nonsense "s-fr" and losing 158 rows.
  it('reads every redshirt spelling without eating the class', () => {
    for (const label of ['RS-Fr.', 'RS Fr.', 'R-Fr.', 'RFr.', 'R.Fr.', 'Rf.', 'Redshirt Freshman', 'r-Fr']) {
      expect(grad(label), label).toBe(2029);
    }
    expect(grad('RS-So.')).toBe(2028);
    expect(grad('Redshirt Junior')).toBe(2027);
    expect(grad('RS-Sr.')).toBe(2026);
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

describe('eligibilityEndYear', () => {
  // The academic year is what a roster page implies; eligibility runs one
  // further for any class not already in its final year. Both are stored
  // because Pillar 1 wants to know when a spot frees up, while an athlete's
  // own class matches the academic year.
  it('runs one year past graduation for classes with a year still in hand', () => {
    for (const [label, grad, elig] of [
      ['Fr.', 2030, 2031],
      ['So.', 2029, 2030],
      ['Jr.', 2028, 2029],
      ['Sr.', 2027, 2028],
    ]) {
      const r = readClassYear(label, { season: 2026 });
      expect([label, r.graduationYear, r.eligibilityEndYear]).toEqual([label, grad, elig]);
    }
  });

  it('coincides with graduation for anyone already in their last year', () => {
    // A graduate student is leaving regardless, and a redshirt senior
    // decomposes to one -- neither gets an extra year.
    for (const label of ['Gr.', 'Graduate Student', '5th', 'R-Sr.', 'RS-Sr.', 'Redshirt Senior']) {
      const r = readClassYear(label, { season: 2026 });
      expect([label, r.eligibilityEndYear]).toEqual([label, r.graduationYear]);
      expect(r.eligibilityEndYear).toBe(2027);
    }
  });

  it('is null when the class is unknown, rather than guessed from the academic year', () => {
    // An explicitly printed year says nothing about which class the athlete is
    // in, so a senior (one year left) cannot be told from a graduate (none).
    expect(readClassYear('2029', { season: 2026 })).toMatchObject({
      graduationYear: 2029, eligibilityEndYear: null,
    });
    for (const label of ['', 'Rs.', 'FC Dallas']) {
      expect(readClassYear(label, { season: 2026 }).eligibilityEndYear).toBeNull();
    }
  });

  it('is null when no season is supplied, like graduationYear', () => {
    expect(readClassYear('Fr.')).toMatchObject({ graduationYear: null, eligibilityEndYear: null });
  });
});
