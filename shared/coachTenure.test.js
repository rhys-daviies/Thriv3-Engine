import { describe, it, expect } from 'vitest';
import {
  tenureFor, sameCoach, normaliseCoach, isVacancy, stillInPost,
  seasonWeights, isInheritedSeason, WEIGHT_CURRENT, WEIGHT_PREVIOUS,
} from './coachTenure.js';

const seq = (...names) => names.map((coach_name, i) => ({ season: 2022 + i, coach_name }));

describe('isVacancy', () => {
  // South Carolina State printed "TBA" as its head coach for two straight
  // seasons — the most informative fact about the programme in the window,
  // and one an earlier parser read as a man called TBA TBA.
  it('reads the placeholders a staff page prints for an empty job', () => {
    for (const v of ['TBA', 'TBA TBA', 'TBD', 'Vacant', 'To Be Announced', 'Staff', '', '  ']) {
      expect(isVacancy(v), JSON.stringify(v)).toBe(true);
    }
  });

  it('does not mistake a real coach for a vacancy', () => {
    for (const n of ['Sarah Dacey', 'Duncan Gillis', 'Sadé Boswell']) {
      expect(isVacancy(n), n).toBe(false);
    }
  });
});

describe('sameCoach', () => {
  // Every one of these differences would otherwise read as a coaching change,
  // inventing a regime shift out of a typographic one.
  it('sees through case, accents and punctuation', () => {
    expect(sameCoach('Sadé Boswell', 'Sade Boswell')).toBe(true);
    expect(sameCoach('JARED EMBICK', 'Jared Embick')).toBe(true);
    // "Last, First" is one person written two ways, and reading it as two
    // would manufacture a coaching change out of a staff-page convention.
    expect(sameCoach('Mauzy-Fleming, Meghan', 'Meghan Mauzy Fleming')).toBe(true);
    // A suffix after the comma is not a forename, so it must not be flipped.
    expect(normaliseCoach('Smith, Jr.')).toBe('smith jr');
  });

  it('matches an initialled form to the full name', () => {
    expect(sameCoach('J. Smith', 'John Smith')).toBe(true);
    expect(sameCoach('Danny Blank', 'D Blank')).toBe(true);
  });

  // Merging two different coaches would erase the change this module exists
  // to find, which is the more expensive mistake of the two.
  it('does not merge different people who share a surname', () => {
    expect(sameCoach('John Smith', 'Peter Smith')).toBe(false);
    expect(sameCoach('Lauren Lukis', 'Sarah Dacey')).toBe(false);
  });

  it('refuses to guess from a single name', () => {
    expect(sameCoach('Smith', 'John Smith')).toBe(false);
    expect(sameCoach('', 'John Smith')).toBe(false);
  });
});

describe('tenureFor', () => {
  // Duncan Gillis, Caltech men's, 2022-2025 — the programme that started a
  // freshman in all four seasons.
  it('reads one coach across the window as continuous', () => {
    const t = tenureFor(seq('Duncan Gillis', 'Duncan Gillis', 'Duncan Gillis', 'Duncan Gillis'));
    expect(t.segments).toHaveLength(1);
    expect(t.changes).toEqual([]);
    expect(t.continuous).toBe(true);
    expect(t.current).toEqual({ coach: 'Duncan Gillis', since: 2022, seasons: 4 });
  });

  // Bentley women's: Lukis, then Dacey for three. Freshman share went
  // 4%, 2%, 26%, 32% — the change is real and it is here.
  it('finds the change and dates it', () => {
    const t = tenureFor(seq('Lauren Lukis', 'Sarah Dacey', 'Sarah Dacey', 'Sarah Dacey'));
    expect(t.segments.map((s) => s.coach)).toEqual(['Lauren Lukis', 'Sarah Dacey']);
    expect(t.changes).toEqual([{ from: 'Lauren Lukis', to: 'Sarah Dacey', season: 2023 }]);
    expect(t.continuous).toBe(false);
    expect(t.current).toEqual({ coach: 'Sarah Dacey', since: 2023, seasons: 3 });
  });

  it('handles a change in the final season', () => {
    const t = tenureFor(seq('Evan Marques', 'Evan Marques', 'Evan Marques', 'Max Correa'));
    expect(t.current).toEqual({ coach: 'Max Correa', since: 2025, seasons: 1 });
    expect(t.changes).toHaveLength(1);
  });

  it('records a vacancy as a gap, not as a coach', () => {
    const t = tenureFor(seq('TBA', 'TBA', 'Andrew Richardson', ''));
    expect(t.gaps).toEqual([2022, 2023, 2025]);
    expect(t.segments.map((s) => s.coach)).toEqual(['Andrew Richardson']);
    expect(t.continuous).toBe(false);
  });

  // The same name either side of an unresolved season is two observations,
  // not one spell — claiming continuity across a season we never saw would
  // assert exactly what the gap prevents us knowing.
  it('does not bridge a gap between two spells of the same name', () => {
    const t = tenureFor([
      { season: 2022, coach_name: 'A Coach' },
      { season: 2023, coach_name: '' },
      { season: 2024, coach_name: 'A Coach' },
    ]);
    expect(t.segments).toHaveLength(2);
    expect(t.continuous).toBe(false);
    expect(t.changes).toEqual([]);   // not a change either — it is a gap
  });

  it('sorts seasons given in any order', () => {
    const t = tenureFor([
      { season: 2024, coach_name: 'X Y' },
      { season: 2022, coach_name: 'X Y' },
      { season: 2023, coach_name: 'X Y' },
    ]);
    expect(t.seasons).toEqual([2022, 2023, 2024]);
    expect(t.continuous).toBe(true);
  });

  it('does not call a single observed season continuity', () => {
    expect(tenureFor([{ season: 2025, coach_name: 'Only One' }]).continuous).toBe(false);
  });

  it('returns null when there is nothing to read', () => {
    expect(tenureFor([])).toBeNull();
    expect(tenureFor([{ season: 'nope', coach_name: 'X Y' }])).toBeNull();
  });

  it('reports a programme with no coach at all in the window', () => {
    const t = tenureFor(seq('TBA', 'TBA', '', ''));
    expect(t.vacant).toBe(true);
    expect(t.current).toBeNull();
  });
});

describe('a gap we could not read vs a job nobody held', () => {
  // These are opposite claims. The scraper writes `vacant-or-tba` only where
  // it found a name and rejected it as a placeholder; everything else is a
  // page it could not read, and reporting the second as the first invents a
  // vacancy out of a 404.
  it('separates a stated vacancy from an unread season', () => {
    const t = tenureFor([
      { season: 2022, coach_name: '', reason: 'vacant-or-tba' },
      { season: 2023, coach_name: 'A Coach' },
      { season: 2024, coach_name: '', reason: 'no-usable-page' },
    ]);
    expect(t.vacantSeasons).toEqual([2022]);
    expect(t.unknownSeasons).toEqual([2024]);
    expect(t.gaps).toEqual([2022, 2024]);      // the union, for callers that only need "missing"
    expect(t.knownThrough).toBe(2023);
  });

  it('reads a placeholder printed on the page as a vacancy whatever the reason says', () => {
    const t = tenureFor([{ season: 2022, coach_name: 'TBA' }, { season: 2023, coach_name: 'A Coach' }]);
    expect(t.vacantSeasons).toEqual([2022]);
    expect(t.unknownSeasons).toEqual([]);
  });

  it('treats a blank with no stated reason as unread, not as a vacancy', () => {
    const t = tenureFor([{ season: 2022, coach_name: 'A Coach' }, { season: 2023, coach_name: '' }]);
    expect(t.unknownSeasons).toEqual([2023]);
    expect(t.vacantSeasons).toEqual([]);
  });
});

describe('stillInPost', () => {
  const NF = tenureFor([
    { season: 2024, coach_name: 'Jamie Davies' },
    { season: 2025, coach_name: 'Jamie Davies' },
    { season: 2026, coach_name: 'Marlon Montanella' },
  ]);

  it('answers for a season it actually read', () => {
    expect(stillInPost(NF, 2026)).toBe(true);    // Montanella is current
    expect(stillInPost(NF, 2025)).toBe(false);   // Davies is not
  });

  // The third answer is the point: a season we never resolved must not be
  // filled in from the seasons around it.
  it('returns null for a season it could not read, rather than guessing', () => {
    const t = tenureFor([
      { season: 2024, coach_name: 'A Coach' },
      { season: 2025, coach_name: '', reason: 'no-usable-page' },
    ]);
    expect(stillInPost(t, 2025)).toBeNull();
  });

  it('returns null for a season outside the window entirely', () => {
    expect(stillInPost(NF, 2030)).toBeNull();
    expect(stillInPost(null, 2026)).toBeNull();
  });
});

describe('seasonWeights', () => {
  // A season played under a coach who has since left describes a programme
  // that no longer exists — down-weighted, not dropped, because it is still
  // evidence about the institution.
  it('weights seasons under the current coach fully and earlier ones down', () => {
    const t = tenureFor(seq('Lauren Lukis', 'Sarah Dacey', 'Sarah Dacey', 'Sarah Dacey'));
    expect(seasonWeights(t)).toEqual({
      2022: WEIGHT_PREVIOUS, 2023: WEIGHT_CURRENT, 2024: WEIGHT_CURRENT, 2025: WEIGHT_CURRENT,
    });
  });

  it('leaves an unbroken tenure evenly weighted', () => {
    const t = tenureFor(seq('Duncan Gillis', 'Duncan Gillis', 'Duncan Gillis', 'Duncan Gillis'));
    expect(new Set(Object.values(seasonWeights(t)))).toEqual(new Set([WEIGHT_CURRENT]));
  });

  it('is null when there is no current coach to weight toward', () => {
    expect(seasonWeights(tenureFor(seq('TBA', 'TBA', '', '')))).toBeNull();
    expect(seasonWeights(null)).toBeNull();
  });
});

describe('isInheritedSeason', () => {
  // Dacey's first year at Bentley ran 2% freshman share — lower than her
  // predecessor's — before 26% and 32%. A first season is played with the
  // squad the previous coach recruited.
  it('flags the new coach\'s first season', () => {
    const t = tenureFor(seq('Lauren Lukis', 'Sarah Dacey', 'Sarah Dacey', 'Sarah Dacey'));
    expect(isInheritedSeason(t, 2023)).toBe(true);
    expect(isInheritedSeason(t, 2024)).toBe(false);
    expect(isInheritedSeason(t, 2022)).toBe(false);
  });

  it('flags nothing where the coach never changed', () => {
    const t = tenureFor(seq('Duncan Gillis', 'Duncan Gillis', 'Duncan Gillis', 'Duncan Gillis'));
    expect(isInheritedSeason(t, 2022)).toBe(false);
  });
});
