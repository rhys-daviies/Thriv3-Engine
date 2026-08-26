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

  // The property that matters is that a player's graduation year does not move
  // when they move up a class, which is what the turnover diff depends on.
  // That needs the offsets to be one apart, not to be any particular value —
  // and until 2026-08-25 every one of them was one too high while satisfying
  // this test perfectly. Hence the concordance test below, which pins the
  // absolute value to something outside the model's own convention.
  it('offsets from the season, so the same player scores the same in both seasons', () => {
    expect(grad('Jr.', 2024)).toBe(2027);
    expect(grad('Sr.', 2025)).toBe(2027);
  });
});

/**
 * What the stored year means, and why it no longer equals the year a roster prints.
 *
 * Until 2026-08-27 these were the same number, and this block existed to pin the
 * conversion to printed years as an external arbiter. That premise is gone by
 * design, so the block now pins the new relationship instead.
 *
 * The column is a match key: `players.recruiting_class_year` is the year a
 * recruit would arrive, and pool.js matches it against this on exact equality.
 * So it names the year the spot OPENS. Under five-year eligibility a senior has
 * one more season to play, so their spot opens two years out while their school
 * still prints graduation one year out. The two quantities genuinely differ now;
 * an explicit printed year is left exactly as printed, because it is a literal
 * statement about that individual and nothing tells us their class.
 */
describe('the stored year is when the spot opens, not when the school says they graduate', () => {
  it('gives a 2026 roster the 2027-2031 opening years', () => {
    expect(grad('Gr.', 2026)).toBe(2027);   // final season now, spot opens next year
    expect(grad('Sr.', 2026)).toBe(2028);   // one season still to play
    expect(grad('Jr.', 2026)).toBe(2029);
    expect(grad('So.', 2026)).toBe(2030);
    expect(grad('Fr.', 2026)).toBe(2031);
  });

  it('sits exactly one year after the last season the player can play', () => {
    for (const label of ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.', '5th', 'R-Sr.', 'R-Jr.']) {
      const r = readClassYear(label, { season: 2026 });
      expect([label, r.graduationYear]).toEqual([label, r.eligibilityEndYear + 1]);
    }
  });

  it('keeps a redshirt senior with the graduates, in both years', () => {
    // Already used the fifth year, so unlike "Sr." they have no season to come.
    // Reading one year from SENIOR and the other from GRADUATE produced "last
    // season 2026, graduating 2028".
    for (const label of ['R-Sr.', 'RS-Sr.', 'Redshirt Senior']) {
      expect([label, grad(label, 2026)]).toEqual([label, 2027]);
      expect(readClassYear(label, { season: 2026 }).eligibilityEndYear).toBe(2026);
    }
  });

  it('leaves a player on the same opening year as they move up a class', () => {
    // The offsets are season-relative, so a player does not drift year to year.
    expect(grad('So.', 2023)).toBe(grad('Jr.', 2024));
    expect(grad('Jr.', 2024)).toBe(grad('Sr.', 2025));
  });

  it('does NOT shift an explicitly printed year to match', () => {
    // Deliberate and documented: a printed year is literal, and a class-labelled
    // teammate will read one year later. 316 rows on the 2025 sheets.
    expect(grad('2029', 2026)).toBe(2029);
    expect(grad('Jr.', 2026)).toBe(2029);
    expect(grad('Sr.', 2026)).not.toBe(grad('2027', 2026));
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
    // Default season 2025. A redshirt freshman has a sophomore's eligibility
    // left, so their spot opens in 2029, not 2030.
    for (const label of ['RS-Fr.', 'RS Fr.', 'R-Fr.', 'RFr.', 'R.Fr.', 'Rf.', 'Redshirt Freshman', 'r-Fr']) {
      expect(grad(label), label).toBe(2029);
    }
    expect(grad('RS-So.')).toBe(2028);
    expect(grad('Redshirt Junior')).toBe(2027);
    expect(grad('RS-Sr.')).toBe(2026);
    expect(grad('Red 5th')).toBe(2026);
  });

  // Years TOTAL, not years competed: the redshirt season is one of the five
  // whether or not it was played, so a redshirt sits with the class above.
  it('puts each redshirt class on the eligibility of the class above it', () => {
    for (const [rs, plain] of [['R-Fr.', 'So.'], ['R-So.', 'Jr.'], ['R-Jr.', 'Sr.'], ['R-Sr.', 'Gr.']]) {
      expect([rs, grad(rs, 2026)]).toEqual([rs, grad(plain, 2026)]);
      expect(readClassYear(rs, { season: 2026 }).eligibilityEndYear)
        .toBe(readClassYear(plain, { season: 2026 }).eligibilityEndYear);
    }
  });

  it('does not advance a graduate, who has no further class to reach', () => {
    for (const label of ['Red 5th', 'RS-Gr.', 'Redshirt Graduate']) {
      expect([label, grad(label, 2026)]).toEqual([label, 2027]);
    }
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

describe('eligibilityEndYear is the last season, one year before the stored year', () => {
  it('names the final season a player can play', () => {
    for (const [label, last] of [['Fr.', 2030], ['So.', 2029], ['Jr.', 2028], ['Sr.', 2027], ['Gr.', 2026]]) {
      const r = readClassYear(label, { season: 2026 });
      expect([label, r.eligibilityEndYear]).toEqual([label, last]);
      expect([label, r.graduationYear]).toEqual([label, last + 1]);
    }
  });

  it('puts a graduate in their final season now, not next year', () => {
    // "Eligible to 2026, spot opens 2027" — the pair a human states and the
    // pair the matcher needs, and they must not drift apart.
    for (const label of ['Gr.', 'Graduate Student', '5th', 'R-Sr.', 'RS-Sr.', 'Redshirt Senior']) {
      const r = readClassYear(label, { season: 2026 });
      expect([label, r.eligibilityEndYear, r.graduationYear]).toEqual([label, 2026, 2027]);
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
