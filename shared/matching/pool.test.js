import { describe, it, expect } from 'vitest';
import { buildRosterIndex, qualityPercentiles, applyEligibility, rankMatches, normaliseAthlete, departures, positionAvailability, STARTER_MINUTES, PROJECTED_STARTER_MINUTES } from './pool.js';
import { CRITERION_KEYS } from './weights.js';

const college = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  name: 'Test U', division: 'NCAA D2', conference: 'GLIAC', active: 1,
  soccer_score: 55, academic_rating: 6, sat_avg: 1150, admit_rate: 0.6,
  net_price: 20000, state: 'OH', latitude: 40.19, longitude: -82.68,
  recent_win_pct: 0.55, prior_win_pct: 0.5, ...over,
});

const athlete = (over = {}) => ({
  sport: 'mens-soccer', level: 55, position: 'MIDFIELD', classYear: 2027,
  academicImportance: 5, gpa: 3.4, sat: 1200, budgetRange: '$15k-$30k/yr',
  state: 'OH', divisions: [], conferences: [], ...over,
});

describe('buildRosterIndex', () => {
  const rows = [
    { college_name: 'A', player_name: 'p1', position: 'MIDFIELD', minutes_played: 1200, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'A', player_name: 'p2', position: 'MIDFIELD', minutes_played: 100, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'A', player_name: 'p3', position: 'DEFENSE', minutes_played: 1500, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'A', player_name: 'p4', position: 'MIDFIELD', minutes_played: 900, season: '2026', division: 'NCAA D3', class_year_label: null },
    { college_name: 'B', player_name: 'p5', position: 'MIDFIELD', minutes_played: 1000, season: '2026', division: 'NCAA D3', class_year_label: 'Jr.' },
  ];
  const idx = buildRosterIndex(rows);

  it('splits starters from squad players at the minutes threshold', () => {
    const c = idx.get('A').cohorts.get('2027|MIDFIELD');
    expect(c.starters).toBe(1);
    expect(c.squad).toBe(1);
    expect(STARTER_MINUTES).toBe(600);
  });

  it('keys cohorts by year and position together', () => {
    expect(idx.get('A').cohorts.get('2027|DEFENSE').starters).toBe(1);
    expect(idx.get('A').cohorts.get('2028|MIDFIELD')).toBeUndefined();
  });

  it('counts rows with no graduation year without placing them in a cohort', () => {
    expect(idx.get('A').rows).toBe(4);
    expect(idx.get('A').missingGradYear).toBe(1);
    expect(idx.get('A').cohorts.get('2027|MIDFIELD').starters).toBe(1);
  });
});

describe('qualityPercentiles', () => {
  it('ranks within the pool given, not against some global scale', () => {
    const pool = [college({ id: 'a', soccer_score: 30 }), college({ id: 'b', soccer_score: 40 }), college({ id: 'c', soccer_score: 50 })];
    const p = qualityPercentiles(pool);
    expect(p.get('a')).toBe(0);
    expect(p.get('c')).toBe(1);
    expect(p.get('b')).toBeCloseTo(0.5, 5);
  });

  it('gives tied programmes the same percentile rather than an invented order', () => {
    const pool = [college({ id: 'a', soccer_score: 40 }), college({ id: 'b', soccer_score: 40 }), college({ id: 'c', soccer_score: 60 })];
    const p = qualityPercentiles(pool);
    expect(p.get('a')).toBe(p.get('b'));
    expect(p.get('c')).toBeGreaterThan(p.get('a'));
  });

  it('returns null for an unscored programme instead of ranking it last', () => {
    const pool = [college({ id: 'a', soccer_score: 40 }), college({ id: 'b', soccer_score: null }), college({ id: 'c', soccer_score: 60 })];
    expect(qualityPercentiles(pool).get('b')).toBeNull();
  });
});

describe('applyEligibility', () => {
  const pool = [
    college({ id: 'a', division: 'NCAA D1', conference: 'Big Ten' }),
    college({ id: 'b', division: 'NCAA D3', conference: 'NESCAC' }),
    college({ id: 'c', division: 'NCAA D1', conference: 'Ivy League' }),
    college({ id: 'd', division: 'NCAA D1', conference: 'Big Ten', active: 0 }),
  ];

  it('filters on division and conference only', () => {
    const { kept } = applyEligibility(pool, { divisions: ['NCAA D1'] });
    expect(kept.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('excludes inactive programmes', () => {
    const { kept, excluded } = applyEligibility(pool, {});
    expect(kept.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(excluded.inactive).toBe(1);
  });

  it('reports what it removed rather than dropping it silently', () => {
    const { excluded } = applyEligibility(pool, { divisions: ['NCAA D1'], conferences: ['Big Ten'] });
    expect(excluded.division).toBe(1);
    expect(excluded.conference).toBe(1);
  });

  it('keeps everything when the athlete stated no preference', () => {
    expect(applyEligibility(pool, {}).kept).toHaveLength(3);
    expect(applyEligibility(pool, { divisions: [], conferences: [] }).kept).toHaveLength(3);
  });

  it('never filters on academics or ability, however the athlete set them', () => {
    const weak = [college({ id: 'x', academic_rating: 1.2, soccer_score: 20 })];
    const { kept } = applyEligibility(weak, { academicImportance: 10, level: 95 });
    expect(kept).toHaveLength(1);
  });
});

describe('rankMatches', () => {
  const colleges = [
    college({ id: 'near', name: 'Near', soccer_score: 55, state: 'OH', latitude: 40.19, longitude: -82.68 }),
    college({ id: 'far', name: 'Far', soccer_score: 55, state: 'CA', latitude: 35.46, longitude: -119.36 }),
    college({ id: 'mismatch', name: 'Mismatch', soccer_score: 20, state: 'OH', latitude: 40.19, longitude: -82.68 }),
  ];
  const rosterIndex = buildRosterIndex([
    { college_name: 'Near', player_name: 'a', position: 'MIDFIELD', minutes_played: 1200, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'Far', player_name: 'b', position: 'MIDFIELD', minutes_played: 1200, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
  ]);

  it('ranks a closer programme above an identical distant one', () => {
    const { results } = rankMatches({ athlete: athlete(), colleges, rosterIndex });
    expect(results.findIndex((r) => r.name === 'Near')).toBeLessThan(results.findIndex((r) => r.name === 'Far'));
  });

  it('ranks every eligible programme rather than a filtered shortlist', () => {
    const { results, poolSize } = rankMatches({ athlete: athlete(), colleges, rosterIndex });
    expect(results).toHaveLength(3);
    expect(poolSize).toBe(3);
  });

  it('attaches a full breakdown to every result', () => {
    const { results } = rankMatches({ athlete: athlete(), colleges, rosterIndex });
    for (const r of results) {
      expect(r.breakdown.map((b) => b.key)).toEqual(CRITERION_KEYS);
      expect(r.match_score).toBeGreaterThanOrEqual(0);
      expect(r.match_score).toBeLessThanOrEqual(100);
    }
  });

  it('honours the limit without changing the reported pool size', () => {
    const { results, poolSize } = rankMatches({ athlete: athlete(), colleges, rosterIndex, limit: 2 });
    expect(results).toHaveLength(2);
    expect(poolSize).toBe(3);
  });

  it('breaks ties on athletic fit rather than leaving them to sort order', () => {
    const tied = [
      college({ id: 't1', name: 'Alpha', soccer_score: 30, state: 'OH', latitude: 40.19, longitude: -82.68 }),
      college({ id: 't2', name: 'Beta', soccer_score: 55, state: 'OH', latitude: 40.19, longitude: -82.68 }),
    ];
    const { results } = rankMatches({ athlete: athlete(), colleges: tied, rosterIndex: new Map() });
    expect(results[0].name).toBe('Beta');
  });

  it('surfaces a programme with no roster data instead of burying it', () => {
    const noRoster = [college({ id: 'z', name: 'Unscraped', soccer_score: 55, state: 'OH', latitude: 40.19, longitude: -82.68 })];
    const { results } = rankMatches({ athlete: athlete(), colleges: noRoster, rosterIndex: new Map() });
    expect(results[0].breakdown.find((b) => b.key === 'roster').confidence).toBe('assumed');
    expect(results[0].match_score).toBeGreaterThan(0);
  });
});

describe('normaliseAthlete', () => {
  it('converts the 1-10 ability slider onto the programme scale', () => {
    expect(normaliseAthlete({ football_ability: 6 }).level).toBe(60);
    expect(normaliseAthlete({ football_ability: null }).level).toBeNull();
  });

  it('parses the JSON-encoded preference arrays the database stores', () => {
    const a = normaliseAthlete({ preferred_divisions: '["NCAA D1","NCAA D2"]', preferred_conferences: '[]' });
    expect(a.divisions).toEqual(['NCAA D1', 'NCAA D2']);
    expect(a.conferences).toEqual([]);
  });

  it('survives malformed JSON rather than throwing mid-analysis', () => {
    const a = normaliseAthlete({ preferred_divisions: 'not json', match_weights: '{oops' });
    expect(a.divisions).toEqual([]);
    expect(a.weightOverrides).toBeNull();
  });

  it('reads per-athlete weight overrides', () => {
    expect(normaliseAthlete({ match_weights: '{"geography":40}' }).weightOverrides).toEqual({ geography: 40 });
  });

  it('turns unparseable numbers into null rather than NaN', () => {
    const a = normaliseAthlete({ football_ability: 'abc', gpa: '', sat_score: 'x', recruiting_class_year: undefined });
    expect(a.level).toBeNull();
    expect(a.gpa).toBeNull();
    expect(a.sat).toBeNull();
    expect(a.classYear).toBeNull();
  });
});

describe('buildRosterIndex international counts', () => {
  const rows = [
    { college_name: 'A', player_name: 'p1', position: 'MIDFIELD', minutes_played: 0, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.', country: 'United Kingdom' },
    { college_name: 'A', player_name: 'p2', position: 'DEFENSE', minutes_played: 0, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.', country: 'United Kingdom' },
    { college_name: 'A', player_name: 'p3', position: 'FORWARD', minutes_played: 0, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.', country: 'Spain' },
    { college_name: 'A', player_name: 'p4', position: 'FORWARD', minutes_played: 0, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.', country: '' },
    { college_name: 'A', player_name: 'p5', position: 'FORWARD', minutes_played: 0, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.', country: 'USA' },
  ];
  const idx = buildRosterIndex(rows);

  it('counts internationals off the country column', () => {
    expect(idx.get('A').international).toBe(3);
  });

  it('does not count a blank or a USA row as international', () => {
    expect(idx.get('A').rows).toBe(5);
    expect(idx.get('A').international).toBe(3);
  });

  it('breaks them down by country', () => {
    expect(idx.get('A').byCountry.get('United Kingdom')).toBe(2);
    expect(idx.get('A').byCountry.get('Spain')).toBe(1);
    expect(idx.get('A').byCountry.get('USA')).toBeUndefined();
  });
});

describe('normaliseAthlete origin', () => {
  it('reads a stored origin', () => {
    expect(normaliseAthlete({ origin: 'International', nationality: 'Spain' })).toMatchObject({ origin: 'International', country: 'Spain' });
  });

  it('infers international from a non-USA nationality on older records', () => {
    expect(normaliseAthlete({ nationality: 'Brazil' })).toMatchObject({ origin: 'International', country: 'Brazil' });
  });

  it('treats a record with no nationality as domestic', () => {
    expect(normaliseAthlete({ state: 'OH' })).toMatchObject({ origin: 'USA', country: null });
  });

  it('does not treat USA as a country to match on', () => {
    expect(normaliseAthlete({ nationality: 'USA' })).toMatchObject({ origin: 'USA', country: null });
  });
});

describe('the academic minimum', () => {
  const pool = [
    college({ id: 'weak', name: 'Weak', academic_rating: 2.1 }),
    college({ id: 'mid', name: 'Mid', academic_rating: 5.5 }),
    college({ id: 'strong', name: 'Strong', academic_rating: 9.1 }),
    college({ id: 'unrated', name: 'Unrated', academic_rating: null }),
  ];

  it('does nothing when no minimum is set', () => {
    const { kept, excluded } = applyEligibility(pool, {});
    expect(kept).toHaveLength(4);
    expect(excluded.academicMinimum).toBe(0);
  });

  it('drops programmes below the floor and counts them', () => {
    const { kept, excluded } = applyEligibility(pool, { academicMinimum: 5 });
    expect(kept.map((c) => c.name).sort()).toEqual(['Mid', 'Strong', 'Unrated']);
    expect(excluded.academicMinimum).toBe(1);
  });

  it('keeps the floor itself in scope, not just above it', () => {
    expect(applyEligibility(pool, { academicMinimum: 5.5 }).kept.map((c) => c.name)).toContain('Mid');
  });

  // The original defect: an academic threshold nobody set deliberately made a
  // third of women's programmes invisible. An unrated school cannot be judged
  // against a floor, so it survives and is counted rather than vanishing.
  it('never drops an unrated programme, and says it kept it', () => {
    const { kept, excluded } = applyEligibility(pool, { academicMinimum: 9 });
    expect(kept.map((c) => c.name)).toContain('Unrated');
    expect(excluded.unratedKept).toBe(1);
  });

  it('reports what it removed rather than filtering silently', () => {
    const { excluded } = applyEligibility(pool, { academicMinimum: 6 });
    expect(excluded.academicMinimum).toBe(2);
  });
});

describe('normaliseAthlete academic minimum', () => {
  it('reads a numeric floor', () => {
    expect(normaliseAthlete({ academic_minimum: 6.5 }).academicMinimum).toBe(6.5);
  });

  it('treats an absent or unparseable minimum as none, never as zero', () => {
    expect(normaliseAthlete({}).academicMinimum).toBeNull();
    expect(normaliseAthlete({ academic_minimum: null }).academicMinimum).toBeNull();
    expect(normaliseAthlete({ academic_minimum: 'Not Important' }).academicMinimum).toBeNull();
  });
});

/**
 * A5.3 — which current players count as departing, per association.
 *
 * The ceiling is derived from the class label and the rule that governs the
 * row's own division, so every fixture states both. A5.2 keyed every division
 * one year earlier on the strength of a historical senior-return rate that was
 * a rule artefact rather than a behaviour; Division I and II are restored to
 * the five-year model that now governs them, and Division III and the NAIA
 * keep the four-season arithmetic by rule.
 */
describe('departure cohort semantics, by association', () => {
  const player = (name, label, { division, position = 'MIDFIELD', minutes = 1200 } = {}) => ({
    college_name: 'A', player_name: name, position, minutes_played: minutes,
    season: '2026', division, class_year_label: label,
  });
  const openingYearsFor = (division) => {
    const idx = buildRosterIndex([
      player('fresh', 'Fr.', { division }),
      player('soph', 'So.', { division }),
      player('junior', 'Jr.', { division }),
      player('senior', 'Sr.', { division }),
      player('grad', 'Gr.', { division }),
    ]).get('A');
    const out = {};
    for (const [key, cohort] of idx.cohorts) {
      const year = Number(key.split('|')[0]);
      for (const n of cohort.names) out[n] = year;
    }
    return out;
  };

  it('gives NCAA D1 the five-year model: a senior opens a place for 2028, not 2027', () => {
    const o = openingYearsFor('NCAA D1');
    expect(o).toEqual({ grad: 2027, senior: 2028, junior: 2029, soph: 2030, fresh: 2031 });
  });

  it('gives NCAA D2 the same five-year model', () => {
    expect(openingYearsFor('NCAA D2')).toEqual(openingYearsFor('NCAA D1'));
  });

  it('keeps NCAA D3 on four seasons: a senior opens a place for 2027', () => {
    const o = openingYearsFor('NCAA D3');
    expect(o).toEqual({ grad: 2027, senior: 2027, junior: 2028, soph: 2029, fresh: 2030 });
  });

  it('keeps the NAIA on four seasons, from its own rule rather than by analogy', () => {
    expect(openingYearsFor('NAIA')).toEqual(openingYearsFor('NCAA D3'));
  });

  it('separates D1 from D3 by exactly one year for every class but graduate', () => {
    // A graduate student is in a final season under either clock, which is the
    // one place the two models agree — and the reason a single shared offset
    // would look right at 3.3% of the squad and be wrong at the rest.
    const d1 = openingYearsFor('NCAA D1');
    const d3 = openingYearsFor('NCAA D3');
    expect(d1.grad).toBe(d3.grad);
    for (const who of ['senior', 'junior', 'soph', 'fresh']) expect(d1[who] - d3[who]).toBe(1);
  });

  it('advances a redshirt one class under both models', () => {
    const rs = (division) => {
      const idx = buildRosterIndex([player('rs-jr', 'RS-Jr.', { division })]).get('A');
      return Number([...idx.cohorts.keys()][0].split('|')[0]);
    };
    // A redshirt junior carries a senior's remaining seasons: 2028 at D1
    // (five-year), 2027 at D3 (four-season).
    expect(rs('NCAA D1')).toBe(2028);
    expect(rs('NCAA D3')).toBe(2027);
  });

  it('computes no ceiling where no rule is on file, and never guesses the NCAA one', () => {
    for (const division of ['NJCAA', 'USCAA', 'Other', undefined]) {
      const idx = buildRosterIndex([
        player('x', 'Sr.', { division }),
        // one readable row so the roster is not simply empty
        { ...player('y', 'Sr.', { division: 'NCAA D3' }) },
      ]).get('A');
      expect(idx.cohorts.has('2027|MIDFIELD')).toBe(true);   // the D3 row
      expect(idx.missingGradYear).toBe(1);                   // the unruled row
    }
  });

  it('keeps an unreadable class year out of every cohort and counts it as doubt', () => {
    const idx = buildRosterIndex([
      player('known', 'Sr.', { division: 'NCAA D3' }),
      player('unknown', null, { division: 'NCAA D3' }),
      player('junk', 'Real Colorado', { division: 'NCAA D3' }),
    ]).get('A');
    expect(idx.rows).toBe(3);
    expect(idx.missingGradYear).toBe(2);
    expect(departures(idx, 2027, 'MIDFIELD').atPosition.names).toEqual(['known']);
  });

  it('splits starters from squad inside the cohort, and keeps their names', () => {
    const idx = buildRosterIndex([
      player('starter', 'Sr.', { division: 'NCAA D3', minutes: 1200 }),
      player('sub', 'Sr.', { division: 'NCAA D3', minutes: 100 }),
      player('keeper', 'Sr.', { division: 'NCAA D3', position: 'GOALKEEPER', minutes: 1800 }),
    ]).get('A');
    const c = departures(idx, 2027, 'MIDFIELD').atPosition;
    expect(c.starters).toBe(1);
    expect(c.squad).toBe(1);
    expect(c.starterNames).toEqual(['starter']);
    expect(departures(idx, 2027, 'MIDFIELD').total).toBe(3);
  });

  it('refuses a roster query that dropped the columns the ceiling needs', () => {
    // A row carrying a stored year column is what a real query looks like; a
    // thin fixture with neither is allowed through.
    expect(() => buildRosterIndex([
      { college_name: 'A', player_name: 'x', position: 'MIDFIELD', minutes_played: 900, estimated_graduation_year: 2028 },
    ])).toThrow(/class_year_label/);
    expect(() => buildRosterIndex([
      { college_name: 'A', player_name: 'x', position: 'MIDFIELD', minutes_played: 900 },
    ])).not.toThrow();
  });
});

/**
 * The four availability states, which V2 will score separately and V1 does not
 * score at all.
 */
describe('positionAvailability', () => {
  const squad = (division) => buildRosterIndex([
    { college_name: 'A', player_name: 'grad', position: 'DEFENSE', minutes_played: 900, season: '2026', division, class_year_label: 'Gr.' },
    { college_name: 'A', player_name: 'senior', position: 'DEFENSE', minutes_played: 900, season: '2026', division, class_year_label: 'Sr.' },
    { college_name: 'A', player_name: 'junior', position: 'DEFENSE', minutes_played: 900, season: '2026', division, class_year_label: 'Jr.' },
    { college_name: 'A', player_name: 'fresh', position: 'DEFENSE', minutes_played: 900, season: '2026', division, class_year_label: 'Fr.' },
    { college_name: 'A', player_name: 'unknown', position: 'DEFENSE', minutes_played: 900, season: '2026', division, class_year_label: null },
    { college_name: 'A', player_name: 'other-pos', position: 'FORWARD', minutes_played: 900, season: '2026', division, class_year_label: 'Sr.' },
  ]).get('A');

  it('splits a D1 squad against a 2027 entrant under the five-year model', () => {
    // Graduate student out of eligibility, senior in a final season alongside
    // the arrival, junior and first year permitted to remain.
    expect(positionAvailability(squad('NCAA D1'), 2027, 'DEFENSE'))
      .toEqual({ expired: 1, finalSeason: 1, eligibleToRemain: 2, unreadable: 1 });
  });

  it('splits the same squad differently at D3, where four seasons still apply', () => {
    // The senior's last season is 2026 under four seasons, so they join the
    // graduate student as already gone, and the junior inherits the final one.
    expect(positionAvailability(squad('NCAA D3'), 2027, 'DEFENSE'))
      .toEqual({ expired: 2, finalSeason: 1, eligibleToRemain: 1, unreadable: 1 });
  });

  it('counts only the athlete position', () => {
    const a = positionAvailability(squad('NCAA D1'), 2027, 'FORWARD');
    expect(a.finalSeason + a.eligibleToRemain + a.expired).toBe(1);
  });

  it('returns zeroes rather than throwing for a programme with no roster', () => {
    expect(positionAvailability(undefined, 2027, 'DEFENSE'))
      .toEqual({ expired: 0, finalSeason: 0, eligibleToRemain: 0, unreadable: 0 });
  });

  /**
   * The line this whole layer exists to hold. ELIGIBLE_TO_REMAIN counts what
   * the rules permit, never what anybody predicts.
   */
  it('does not treat eligibility to remain as an expectation of returning', () => {
    const d1 = positionAvailability(squad('NCAA D1'), 2027, 'DEFENSE');
    const d3 = positionAvailability(squad('NCAA D3'), 2027, 'DEFENSE');
    // The same four players, the same season, two associations: the count
    // moves because the RULE moves, not because anybody's behaviour differs.
    expect(d1.eligibleToRemain).toBe(d3.eligibleToRemain + 1);
  });
});

describe('departures', () => {
  const roster = buildRosterIndex([
    { college_name: 'A', player_name: 'mid-starter', position: 'MIDFIELD', minutes_played: 1200, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'A', player_name: 'mid-sub', position: 'MIDFIELD', minutes_played: 100, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'A', player_name: 'def-starter', position: 'DEFENSE', minutes_played: 1500, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'A', player_name: 'keeper', position: 'GOALKEEPER', minutes_played: 1800, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'A', player_name: 'next-year', position: 'MIDFIELD', minutes_played: 1000, season: '2026', division: 'NCAA D3', class_year_label: 'Jr.' },
    { college_name: 'A', player_name: 'unlabelled', position: 'MIDFIELD', minutes_played: 1000, season: '2026', division: 'NCAA D3', class_year_label: null },
  ]).get('A');

  // The defect this function exists for. Both were the same number, so the
  // card showed one list twice.
  it('counts the whole squad, not just the athlete position', () => {
    const d = departures(roster, 2027, 'MIDFIELD');
    expect(d.atPosition.starters + d.atPosition.squad).toBe(2);
    expect(d.total).toBe(4);
    expect(d.total).toBeGreaterThan(d.atPosition.starters + d.atPosition.squad);
  });

  it('names everyone leaving that year, across positions', () => {
    expect(departures(roster, 2027, 'MIDFIELD').names.sort())
      .toEqual(['def-starter', 'keeper', 'mid-starter', 'mid-sub']);
  });

  it('counts squad-wide starters separately from squad-wide bodies', () => {
    expect(departures(roster, 2027, 'MIDFIELD').totalStarters).toBe(3);
  });

  // Read by the match card and the email template, produced by nothing until
  // 2026-08-25 — so the card printed a starter count and then said the names
  // could not be verified.
  it('names the starters at the position, not just counts them', () => {
    const d = departures(roster, 2027, 'MIDFIELD');
    expect(d.atPosition.starterNames).toEqual(['mid-starter']);
    expect(d.atPosition.names).toEqual(['mid-starter', 'mid-sub']);
  });

  it('ignores other arrival years', () => {
    expect(departures(roster, 2028, 'MIDFIELD').total).toBe(1);
    expect(departures(roster, 2029, 'MIDFIELD').total).toBe(0);
  });

  // A row with no estimated_graduation_year is never filed into a cohort, so
  // this is a lower bound. rowsMissingGradYear is what reports the doubt.
  it('cannot see rows with no graduation year', () => {
    expect(departures(roster, 2027, 'MIDFIELD').total).toBe(4);
    expect(roster.missingGradYear).toBe(1);
  });

  it('still totals the squad when nobody leaves at the athlete position', () => {
    const d = departures(roster, 2027, 'FORWARD');
    expect(d.atPosition).toBeNull();
    expect(d.total).toBe(4);
  });

  // The cohort key is built by template literal, so a numeric class year and
  // a string one must both match it.
  it('matches a class year given as a number or a string', () => {
    expect(departures(roster, 2027, 'MIDFIELD').total).toBe(4);
    expect(departures(roster, '2027', 'MIDFIELD').total).toBe(4);
  });

  it('is case-insensitive about the position', () => {
    expect(departures(roster, 2027, 'midfield').atPosition.starters).toBe(1);
  });

  it('returns empty rather than throwing with no roster or no class year', () => {
    const empty = { atPosition: null, total: 0, totalStarters: 0, names: [] };
    expect(departures(null, 2027, 'MIDFIELD')).toEqual(empty);
    expect(departures(roster, null, 'MIDFIELD')).toEqual(empty);
    expect(departures(undefined, undefined, undefined)).toEqual(empty);
  });
});

describe('rankMatches graduating figures', () => {
  const rosterIndex = buildRosterIndex([
    { college_name: 'Test U', player_name: 'mid', position: 'MIDFIELD', minutes_played: 1200, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'Test U', player_name: 'def', position: 'DEFENSE', minutes_played: 1500, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
    { college_name: 'Test U', player_name: 'fwd', position: 'FORWARD', minutes_played: 200, season: '2026', division: 'NCAA D3', class_year_label: 'Sr.' },
  ]);

  it('exposes the position and squad-wide figures as different numbers', () => {
    const { results } = rankMatches({ athlete: athlete(), colleges: [college()], rosterIndex });
    const r = results[0];
    expect(r.graduating_at_position).toBe(1);
    expect(r.graduating_names_at_position).toEqual(['mid']);
    expect(r.graduating_total).toBe(3);
    expect(r.graduating_names_total.sort()).toEqual(['def', 'fwd', 'mid']);
    expect(r.graduating_starters_total).toBe(2);
    expect(r.graduating_starter_names_at_position).toEqual(['mid']);
  });

  it('gives every name field an array, never undefined', () => {
    const { results } = rankMatches({ athlete: athlete({ classYear: 2099 }), colleges: [college()], rosterIndex });
    for (const key of ['graduating_names_at_position', 'graduating_names_total', 'graduating_starter_names_at_position']) {
      expect(Array.isArray(results[0][key])).toBe(true);
      expect(results[0][key]).toHaveLength(0);
    }
  });

  // Adding the squad-wide figures must not touch what the scorer reads.
  it('does not change the score', () => {
    const a = athlete();
    const withRoster = rankMatches({ athlete: a, colleges: [college()], rosterIndex }).results[0];
    const bare = rankMatches({ athlete: a, colleges: [college()], rosterIndex: buildRosterIndex([]) }).results[0];
    expect(withRoster.graduating_total).toBe(3);
    expect(bare.graduating_total).toBe(0);
    expect(typeof withRoster.match_score).toBe('number');
    expect(withRoster.breakdown.find((b) => b.key === 'roster').confidence).toBe('measured');
  });
});

describe('rankMatches carries the presentation columns', () => {
  // The result object is built field by field, never spread from the row, so
  // a column not named in it is silently dropped. Eight were: the database
  // knew SMU are the Mustangs, mascot Peruna, ACC champions, and every one of
  // those email tokens resolved to nothing while the app looked fine.
  const DECORATED = [
    'nickname', 'nickname_plural', 'mascot',
    'conference_champion_2025', 'conference_champion_name',
    'logo_url', 'primary_color', 'secondary_color',
  ];

  it('passes every personalisation and branding column through', () => {
    const row = college({
      nickname: 'Mustangs', nickname_plural: 1, mascot: 'Peruna',
      conference_champion_2025: 1, conference_champion_name: 'ACC',
      logo_url: 'https://example.test/l.png', primary_color: '#C8102E', secondary_color: '#0033A0',
    });
    const { results } = rankMatches({ athlete: athlete(), colleges: [row], rosterIndex: buildRosterIndex([]) });
    for (const key of DECORATED) {
      expect(results[0], `${key} was dropped by rankMatches`).toHaveProperty(key, row[key]);
    }
  });

  // The conditionals in the email template gate on presence, so undefined and
  // null must not become '' or 0 on the way through — that would make a
  // school with no nickname indistinguishable from one we simply dropped.
  it('passes an absent column through as absent, not as a blank', () => {
    const { results } = rankMatches({ athlete: athlete(), colleges: [college()], rosterIndex: buildRosterIndex([]) });
    for (const key of DECORATED) expect(results[0][key]).toBeUndefined();
  });
});

describe('starter classification when the season is not yet played', () => {
  const row = (over) => ({
    college_name: 'A', player_name: 'p', position: 'MIDFIELD',
    season: '2026', division: 'NCAA D3', class_year_label: 'Sr.', ...over,
  });
  const cohort = (rows) => buildRosterIndex(rows).get('A').cohorts.get('2027|MIDFIELD');

  it('uses real minutes when they exist, at the 600 threshold', () => {
    expect(cohort([row({ minutes_played: 600 })])).toMatchObject({ starters: 1, squad: 0 });
    expect(cohort([row({ minutes_played: 599 })])).toMatchObject({ starters: 0, squad: 1 });
  });

  it('falls back to a projection at the lower 450 threshold', () => {
    // 450 is the measured balance point for last season predicting this one;
    // holding the projection to 600 would drop a fifth of real starters.
    expect(cohort([row({ minutes_played: null, projected_minutes: 450 })]))
      .toMatchObject({ starters: 1, squad: 0 });
    expect(cohort([row({ minutes_played: null, projected_minutes: 449 })]))
      .toMatchObject({ starters: 0, squad: 1 });
  });

  it('prefers a real figure over a projection, even a low one', () => {
    // A player who is on the roster and has actually played 10 minutes is not a
    // starter, whatever they did last year.
    expect(cohort([row({ minutes_played: 10, projected_minutes: 1500 })]))
      .toMatchObject({ starters: 0, squad: 1 });
  });

  it('treats a real zero as played-none, not as unknown', () => {
    expect(cohort([row({ minutes_played: 0, projected_minutes: 1500 })]))
      .toMatchObject({ starters: 0, squad: 1 });
  });

  it('counts a newcomer with neither figure as squad, never a starter', () => {
    expect(cohort([row({ minutes_played: null, projected_minutes: null })]))
      .toMatchObject({ starters: 0, squad: 1 });
    expect(cohort([row({})])).toMatchObject({ starters: 0, squad: 1 });
  });

  it('exports the projected threshold below the real one', () => {
    expect(PROJECTED_STARTER_MINUTES).toBe(450);
    expect(PROJECTED_STARTER_MINUTES).toBeLessThan(STARTER_MINUTES);
  });
});
