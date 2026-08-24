import { describe, it, expect } from 'vitest';
import { buildRosterIndex, qualityPercentiles, applyEligibility, rankMatches, normaliseAthlete, STARTER_MINUTES } from './pool.js';
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
    { college_name: 'A', player_name: 'p1', position: 'MIDFIELD', minutes_played: 1200, estimated_graduation_year: 2027 },
    { college_name: 'A', player_name: 'p2', position: 'MIDFIELD', minutes_played: 100, estimated_graduation_year: 2027 },
    { college_name: 'A', player_name: 'p3', position: 'DEFENSE', minutes_played: 1500, estimated_graduation_year: 2027 },
    { college_name: 'A', player_name: 'p4', position: 'MIDFIELD', minutes_played: 900, estimated_graduation_year: null },
    { college_name: 'B', player_name: 'p5', position: 'MIDFIELD', minutes_played: 1000, estimated_graduation_year: 2028 },
  ];
  const idx = buildRosterIndex(rows);

  it('splits starters from squad players at the minutes threshold', () => {
    const c = idx.get('A').cohorts.get('2027|MIDFIELD');
    expect(c.starters).toBe(1);
    expect(c.squad).toBe(1);
    expect(STARTER_MINUTES).toBe(900);
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
    { college_name: 'Near', player_name: 'a', position: 'MIDFIELD', minutes_played: 1200, estimated_graduation_year: 2027 },
    { college_name: 'Far', player_name: 'b', position: 'MIDFIELD', minutes_played: 1200, estimated_graduation_year: 2027 },
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
    { college_name: 'A', player_name: 'p1', position: 'MIDFIELD', minutes_played: 0, estimated_graduation_year: 2027, country: 'United Kingdom' },
    { college_name: 'A', player_name: 'p2', position: 'DEFENSE', minutes_played: 0, estimated_graduation_year: 2027, country: 'United Kingdom' },
    { college_name: 'A', player_name: 'p3', position: 'FORWARD', minutes_played: 0, estimated_graduation_year: 2027, country: 'Spain' },
    { college_name: 'A', player_name: 'p4', position: 'FORWARD', minutes_played: 0, estimated_graduation_year: 2027, country: '' },
    { college_name: 'A', player_name: 'p5', position: 'FORWARD', minutes_played: 0, estimated_graduation_year: 2027, country: 'USA' },
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
