/**
 * Track A and the hometown table.
 *
 * The first two tests are the ones that matter most: null minutes must never
 * become zero, anywhere, and a season with no row must never become a season
 * with no minutes.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLifecycles, seasonObservation, roleBand, classRank, originOf,
  isTerminalClass, playerKeyOf, firstYearCohort, experiencedCohort, lifecyclesAt,
} from './lifecycle.js';
import { readClassYear } from '../classYear.js';
import { canonicalHometown, sameHometown } from './hometown.js';

const row = (o = {}) => ({
  id: o.id ?? 'r1',
  college_name: o.college_name ?? 'Test College',
  sport: 'mens-soccer',
  season: o.season ?? '2023',
  player_name: o.player_name ?? 'Alex Morgan',
  class_year_label: 'class_year_label' in o ? o.class_year_label : 'Fr.',
  position: 'position' in o ? o.position : 'Defender',
  minutes_played: 'minutes_played' in o ? o.minutes_played : 500,
  games_played: 'games_played' in o ? o.games_played : 12,
  games_started: 'games_started' in o ? o.games_started : 4,
  nationality: 'nationality' in o ? o.nationality : 'USA',
  hometown: 'hometown' in o ? o.hometown : 'Phoenix, AZ',
  estimated_graduation_year: o.estimated_graduation_year ?? 2026,
  eligibility_end_year: o.eligibility_end_year ?? 2026,
  prior_programme: o.prior_programme ?? null,
});

describe('null is not zero', () => {
  it('keeps null minutes as null and marks the season unmeasured', () => {
    const s = seasonObservation(row({ minutes_played: null }));
    expect(s.minutes).toBeNull();
    expect(s.measured).toBe(false);
    expect(s.roleBand).toBeNull();
  });

  it('keeps a stored zero as zero and marks the season measured', () => {
    const s = seasonObservation(row({ minutes_played: 0 }));
    expect(s.minutes).toBe(0);
    expect(s.measured).toBe(true);
    expect(s.roleBand).toBe('0');
  });

  it('never gives an unmeasured season a role band', () => {
    expect(roleBand(null)).toBeNull();
    expect(roleBand(0)).toBe('0');
  });

  it('keeps null games and starts as null', () => {
    const s = seasonObservation(row({ games_played: null, games_started: null }));
    expect(s.games).toBeNull();
    expect(s.starts).toBeNull();
  });
});

describe('role bands', () => {
  it('bands on the documented boundaries', () => {
    expect(roleBand(0)).toBe('0');
    expect(roleBand(1)).toBe('1-199');
    expect(roleBand(199)).toBe('1-199');
    expect(roleBand(200)).toBe('200-599');
    expect(roleBand(599)).toBe('200-599');
    expect(roleBand(600)).toBe('600+');
    expect(roleBand(1800)).toBe('600+');
  });
});

describe('class labels', () => {
  it('ranks the labels rosters actually print', () => {
    expect(classRank('Fr.')).toBe(1);
    expect(classRank('R-Fr.')).toBe(1);
    expect(classRank('So.')).toBe(2);
    expect(classRank('Jr.')).toBe(3);
    expect(classRank('Sr.')).toBe(4);
    expect(classRank('R-Sr.')).toBe(4);
    expect(classRank('Gr.')).toBe(5);
    expect(classRank('Graduate')).toBe(5);
  });

  // Every one of these was on a roster and unreadable to the parser this
  // function used to carry. Between them they are 8,192 rows at 330
  // programmes, and the programmes that spell it "Fy." lost their whole
  // first-year cohort.
  it('ranks the labels the lifecycle parser used to be blind to', () => {
    for (const label of ['Fy.', 'FY', 'Fy', 'FY.', 'F.Y.', '1st', '1st Year',
      'First Year', 'Rf.', 'Rs.-Fr.']) {
      expect(classRank(label), label).toBe(1);
    }
    for (const label of ['2nd', '2nd Year', 'Second Year']) {
      expect(classRank(label), label).toBe(2);
    }
    for (const label of ['3rd', '3rd Year', '3rd Yr.', 'Third Year']) {
      expect(classRank(label), label).toBe(3);
    }
    for (const label of ['4th', '4th Year', 'Fourth Year']) {
      expect(classRank(label), label).toBe(4);
    }
    for (const label of ['5th', '6th', 'Fifth Year', 'Graduate Student']) {
      expect(classRank(label), label).toBe(5);
    }
  });

  // The narrow parser and the shared reader are now one function, so this is
  // the assertion that keeps them from drifting apart again.
  it('agrees with the reader the freshman layer uses, on every label', () => {
    const rank = { FRESHMAN: 1, SOPHOMORE: 2, JUNIOR: 3, SENIOR: 4, GRADUATE: 5 };
    for (const label of ['Fr.', 'Fy.', 'So.', 'R-So.', 'Jr.', 'Sr.', 'Gr.', '1st',
      '4th', 'Cl.: Jr', 'Year: So', 'Redshirt Freshman', '2027', "'29", 'Solar',
      'FC Dallas', 'Real Colorado', '', null]) {
      expect(classRank(label), label)
        .toBe(rank[readClassYear(label).klass] ?? null);
    }
  });

  // The two readers answer different questions about a redshirt: this one
  // names the class on the page, readClassYear's year fields count the
  // seasons already spent. Ranking a redshirt sophomore as a junior here
  // would break class progression as an identity signal.
  it('ranks a redshirt by the class the label names, not the one it implies', () => {
    expect(classRank('R-So.')).toBe(2);
    expect(classRank('Redshirt Junior')).toBe(3);
    expect(readClassYear('R-So.', { season: '2024' }).eligibilityEndYear).toBe(2026);
  });

  it('returns null rather than guessing at an unreadable label', () => {
    expect(classRank(null)).toBeNull();
    expect(classRank('')).toBeNull();
    expect(classRank('2027')).toBeNull();
    expect(classRank('Manchester United Academy')).toBeNull();
    // The Texas Tech club column, which is the reason the shared reader
    // reports `recognised` at all.
    expect(classRank('FC Dallas')).toBeNull();
    expect(classRank('Real Colorado')).toBeNull();
    expect(classRank('Solar')).toBeNull();
    expect(classRank("'29")).toBeNull();
  });

  it('knows which classes could be a last season', () => {
    expect(isTerminalClass('Sr.')).toBe(true);
    expect(isTerminalClass('Gr.')).toBe(true);
    expect(isTerminalClass('Jr.')).toBe(false);
    expect(isTerminalClass('nonsense')).toBeNull();
  });
});

describe('building a lifecycle', () => {
  const seasons = (mins) => mins.map((m, i) => row({
    season: String(2022 + i), minutes_played: m,
    class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.'][i],
  }));

  it('orders seasons and records the span', () => {
    const [life] = buildLifecycles(seasons([120, 640, 1220, 1400]));
    expect(life.seasons.map((s) => s.season)).toEqual(['2022', '2023', '2024', '2025']);
    expect(life.firstSeason).toBe('2022');
    expect(life.lastSeason).toBe('2025');
    expect(life.seasonsObserved).toBe(4);
    expect(life.measuredSeasons).toBe(4);
  });

  it('counts only measured seasons as measured', () => {
    const [life] = buildLifecycles(seasons([120, null, 1220, null]));
    expect(life.seasonsObserved).toBe(4);
    expect(life.measuredSeasons).toBe(2);
  });

  it('records a missing intermediate season as a gap rather than closing it up', () => {
    const rows = [
      row({ season: '2022', class_year_label: 'Fr.' }),
      row({ season: '2025', class_year_label: 'Sr.' }),
    ];
    const [life] = buildLifecycles(rows);
    expect(life.gapSeasons).toEqual(['2023', '2024']);
    expect(life.seasonsObserved).toBe(2);
  });

  it('splits one name across two programmes into two histories', () => {
    const rows = [
      row({ season: '2022', college_name: 'Alpha' }),
      row({ season: '2023', college_name: 'Beta' }),
    ];
    const lives = buildLifecycles(rows);
    expect(lives).toHaveLength(2);
    expect(lives.map((l) => l.programme).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('picks the most common position and flags a change', () => {
    const rows = [
      row({ season: '2022', position: 'Defender' }),
      row({ season: '2023', position: 'Defender' }),
      row({ season: '2024', position: 'Midfielder' }),
    ];
    const [life] = buildLifecycles(rows);
    expect(life.position).toBe('DEFENSE');
    expect(life.positionChanged).toBe(true);
  });

  it('ignores UNKNOWN when choosing a position', () => {
    const rows = [
      row({ season: '2022', position: null }),
      row({ season: '2023', position: 'Forward' }),
    ];
    const [life] = buildLifecycles(rows);
    expect(life.position).toBe('FORWARD');
  });

  it('claims an entry type only where the first class label is readable', () => {
    const [fresh] = buildLifecycles([row({ class_year_label: 'Fr.' })]);
    const [exp] = buildLifecycles([row({ class_year_label: 'Jr.' })]);
    const [unk] = buildLifecycles([row({ class_year_label: 'no idea' })]);
    expect(fresh.entryType).toBe('FIRST_YEAR');
    expect(exp.entryType).toBe('EXPERIENCED');
    expect(unk.entryType).toBeNull();
  });

  it('separates the two cohorts and narrows by programme and position', () => {
    const lives = buildLifecycles([
      row({ player_name: 'A One', class_year_label: 'Fr.', position: 'Forward' }),
      row({ player_name: 'B Two', class_year_label: 'Jr.', position: 'Defender' }),
    ]);
    expect(firstYearCohort(lives).map((l) => l.name)).toEqual(['A One']);
    expect(experiencedCohort(lives).map((l) => l.name)).toEqual(['B Two']);
    expect(lifecyclesAt(lives, 'Test College', { position: 'Forward' })).toHaveLength(1);
  });

  it('uses the shared name normalisation, so spelling variants join', () => {
    expect(playerKeyOf("Aidan O'Sullivan")).toBe(playerKeyOf('Aidan OSullivan'));
    expect(playerKeyOf('Rodgers, Sara')).toBe(playerKeyOf('Sara Rodgers'));
  });
});

describe('origin', () => {
  it('reads the two values the data holds, and null for neither', () => {
    expect(originOf({ nationality: 'USA' })).toBe('domestic');
    expect(originOf({ nationality: 'Spain' })).toBe('international');
    expect(originOf({ nationality: null })).toBeNull();
  });
});

describe('hometown canonicalisation', () => {
  it('joins the spelling variants the audit found', () => {
    expect(canonicalHometown('Phoenix, AZ')).toBe(canonicalHometown('Phoenix, Ariz.'));
    expect(canonicalHometown('Madison, Wis.')).toBe(canonicalHometown('Madison, WI'));
    expect(canonicalHometown('Raleigh, N.C.')).toBe(canonicalHometown('Raleigh, NC'));
    expect(sameHometown('Phoenix, AZ', 'Phoenix, Ariz.')).toBe(true);
  });

  it('keeps different places apart', () => {
    expect(sameHometown('Springfield, IL', 'Springfield, MO')).toBe(false);
    expect(sameHometown('Portland, OR', 'Portland, ME')).toBe(false);
  });

  it('refuses a bare city, because it could be two countries', () => {
    expect(canonicalHometown('Manchester')).toBeNull();
    expect(sameHometown('Manchester', 'Manchester')).toBe(false);
  });

  it('treats two unknown hometowns as unknown, never as agreement', () => {
    expect(sameHometown(null, null)).toBe(false);
    expect(sameHometown('', '')).toBe(false);
  });

  it('canonicalises country tails it knows and preserves ones it does not', () => {
    expect(sameHometown('London, England', 'London, Eng.')).toBe(true);
    expect(canonicalHometown('Reykjavik, Iceland')).toBe('reykjavik, iceland');
  });

  it('does not abbreviate or expand the city half', () => {
    // Deliberately unequal: any rule that joins these also joins St. Charles
    // to Saint Charles County.
    expect(sameHometown('St. Louis, MO', 'Saint Louis, MO')).toBe(false);
  });

  it('is case and punctuation insensitive', () => {
    expect(sameHometown('SAN DIEGO, CALIF.', 'San Diego, Calif')).toBe(true);
  });
});
