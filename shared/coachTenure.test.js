import { describe, it, expect } from 'vitest';
import {
  tenureFor, sameCoach, normaliseCoach, isVacancy, stillInPost,
  seasonWeights, isInheritedSeason, WEIGHT_CURRENT, WEIGHT_PREVIOUS,
  nonPersonWitness, NON_PERSON, readCoachRow, UNUSABLE,
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

/**
 * PHASE 11D — the title column, which this module did not read.
 *
 * `tenureFor` resolved a season from any name in the row, so a strength coach
 * or an associate head became the programme's head coach for that season and
 * four such seasons became "one coach throughout". The head-coach reader was
 * written in Phase 11B and used only by the attribution model; it now sits in
 * this module and both read the table through it.
 */
describe('tenureFor reads the title column', () => {
  const titled = (...pairs) => pairs.map(([coach_name, coach_title], i) => (
    { season: 2022 + i, coach_name, coach_title }));

  it('does not resolve a season from an associate head coach', () => {
    // Delaware women's: Mary Hearin was the associate head in 2022, and the
    // report called 2023 a coaching change and read the pattern across it.
    const t = tenureFor(titled(
      ['Mary Hearin', 'Associate Head Coach'],
      ['Kelly Lawrence', "Head Women's Soccer Coach"],
      ['Kelly Lawrence', "Head Women's Soccer Coach"],
    ));
    expect(t.unknownSeasons).toEqual([2022]);
    expect(t.resolvedSeasons).toEqual([2023, 2024]);
    expect(t.changes).toEqual([]);
  });

  it('does not resolve a season from a strength coach', () => {
    // Marist men's: every row on file names Aaron Suma, the strength coach,
    // and the report attributed four seasons to him.
    const t = tenureFor(titled(
      ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      ['Aaron Suma', 'Head Coach, Strength & Conditioning'],
    ));
    expect(t.resolvedSeasons).toEqual([]);
    expect(t.current).toBeNull();
    expect(t.continuous).toBe(false);
  });

  it('does not resolve a season from an operations or performance role', () => {
    // Tiffin women's 2026 is a Director of Soccer Operations, and Allegheny's
    // is a Head Peak Performance Coach. Both were reported as the new head
    // coach who "took over" for the season a recruit would join.
    const t = tenureFor(titled(
      ['Michael Cracas', 'Head Coach'],
      ['Rudy Brownell', 'Director of Soccer Operations'],
      ['Toby Cline', 'Head Peak Performance Coach'],
    ));
    expect(t.resolvedSeasons).toEqual([2022]);
    expect(t.unknownSeasons).toEqual([2023, 2024]);
  });

  // The distinction this module exists to keep. A title naming somebody else's
  // job says the post was filled — by a person the row does not name — which
  // is the opposite claim to "the page said there is nobody".
  it('files a non-head title as unread, never as a vacancy', () => {
    const t = tenureFor([
      { season: 2022, coach_name: 'A Coach', coach_title: 'Associate Head Coach' },
      { season: 2023, coach_name: '', reason: 'vacant-or-tba' },
    ]);
    expect(t.unknownSeasons).toEqual([2022]);
    expect(t.vacantSeasons).toEqual([2023]);
  });

  it('still resolves the head coach however the title is written', () => {
    const t = tenureFor(titled(
      ['A Coach', "Head Men's & Women's Soccer Coach"],
      ['A Coach', 'Head Coach/Assistant Athletic Director'],
      ['A Coach', 'Head Interim Women’s Soccer Coach'],
      ['A Coach', "Friends of Brown Men's Soccer Head Coaching Chair"],
    ));
    expect(t.resolvedSeasons).toEqual([2022, 2023, 2024, 2025]);
    expect(t.continuous).toBe(true);
  });

  // 840 rows carry no name and no title; none carries a name and no title. The
  // face-value branch is insurance, and the fixtures above every other suite
  // depend on it.
  it('takes a row with a name and no title at face value', () => {
    expect(tenureFor(seq('A Coach', 'A Coach')).continuous).toBe(true);
  });
});

/**
 * PHASE 12B.1 — the value in the coach column is sometimes the cell beside it.
 *
 * Concordia College-Moorhead's 2026 head coach was on file as "Detroit Lakes",
 * a Minnesota town, and its 2025 coach as "East Grand Forks". Both are the
 * roster's HOMETOWN column, read one cell too far: on 34 programmes' pages the
 * staff label ends in a colon and is followed by the roster grid.
 *
 * The witnesses are evidence, not resemblance. That distinction is the whole
 * design — coaches are called Preston, Houston and Austin, and the object is to
 * reject only where something other than the spelling says the value came from
 * another column.
 */
describe('nonPersonWitness', () => {
  it('names a high school, whatever precedes it', () => {
    for (const n of ['Glen Allen HS', 'Alcoa HS', 'Southwest Guilford HS', 'The Forman School',
      'Gray Collegiate Academy', 'Blue Hills Regional Tech.', "Martha's Vineyard Regional",
      'Thetford Academy', 'Winchendon School']) {
      expect(nonPersonWitness(n), n).toBe(NON_PERSON.INSTITUTION);
    }
  });

  it('names a field of study', () => {
    for (const n of ['Business Management', 'Emergency Management', 'Sports Management',
      'Criminal Justice', 'Computer Science', 'Health Sciences', 'Communications Media',
      'Elementary Education', 'Marine Engineering', 'Biological Sciences', 'Construction Management']) {
      expect(nonPersonWitness(n), n).toBe(NON_PERSON.MAJOR);
    }
  });

  /**
   * The half that matters more. A geographic blacklist would have taken these
   * with it; all 2,259 distinct coach names in the table pass.
   */
  it('leaves every real coach alone', () => {
    for (const n of ['Rebecca Quimby', 'Austin Solomon', 'Preston Goldfarb', 'Houston Baker',
      'Brandon Badgeley', 'Chris Goodwin', 'Sarah Goodman', 'Tom Badger', 'Ellie McDougall',
      'Breena Proctor', 'Vanessa Fyffe', 'Kevin Cumberbatch', 'Jared Embick', 'Detroit Jones',
      'Dallas Turner', 'Brooklyn Fisher', 'Chelsea Adams']) {
      expect(nonPersonWitness(n), n).toBeNull();
    }
  });

  it('is null for nothing at all', () => {
    expect(nonPersonWitness('')).toBeNull();
    expect(nonPersonWitness(null)).toBeNull();
    expect(nonPersonWitness(undefined)).toBeNull();
  });

  // The canonical reader carries it, so a raw row surviving a re-import is still
  // refused. There is one definition, and this is it.
  it('makes the canonical reader refuse the row', () => {
    for (const n of ['Business Management', 'Glen Allen HS']) {
      const r = readCoachRow({ coach_name: n, coach_title: 'Head Coach:' });
      expect(r.usable, n).toBe(false);
      expect(r.reason, n).toBe(UNUSABLE.NOT_A_NAME);
    }
    expect(readCoachRow({ coach_name: 'Rebecca Quimby', coach_title: 'Head Coach:' }).usable).toBe(true);
  });

  /**
   * A colon-terminated title is the parse path, not the verdict. 60 rows on it
   * carry real coaches — Brendan Adams, Chris Matejka, Breena Proctor — and
   * refusing the path would have thrown them away with the contamination.
   */
  it('does not refuse a row merely for having a label-shaped title', () => {
    const r = readCoachRow({ coach_name: 'Chris Matejka', coach_title: 'Head Coach:' });
    expect(r.usable).toBe(true);
    expect(r.name).toBe('Chris Matejka');
  });

  it('leaves a season unresolved rather than vacant when the value is refused', () => {
    const t = tenureFor([
      { season: 2024, coach_name: 'Rebecca Quimby', coach_title: 'Head Coach' },
      { season: 2025, coach_name: 'Business Management', coach_title: 'Head Coach:' },
    ]);
    expect(t.resolvedSeasons).toEqual([2024]);
    expect(t.unknownSeasons).toEqual([2025]);
    expect(t.vacantSeasons).toEqual([]);
  });
});
