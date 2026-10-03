import { describe, it, expect } from 'vitest';
import { buildPositionIndex, buildArrivalIndex, positionEvidence, divisionArrivalRates, arrivalBehaviour } from './rosterEvidence.js';

const row = (over = {}) => ({
  college_name: 'Test U', position: 'MIDFIELD', class_year_label: 'Sr.',
  division: 'NCAA D1', season: '2026', minutes_played: null, projected_minutes: 1200,
  games_started: null, projected_games_started: null, ...over,
});

const evidenceFor = (rows, over = {}) => positionEvidence({
  programme: 'Test U', position: 'MIDFIELD', sport: 'mens-soccer',
  division: rows[0]?.division ?? 'NCAA D1', entryYear: 2027,
  rosterIndex: buildPositionIndex(rows), arrivalIndex: new Map(), ...over,
});

describe('openings follow eligibility, not the class label', () => {
  it('a Division I senior in 2026 is NOT an opening for 2027', () => {
    // The five-year age-based window leaves them a season, so their place has
    // not opened - however the roster page labels them.
    const e = evidenceFor([row({ division: 'NCAA D1' })]);
    expect(e.vacatedStarters).toBe(0);
    expect(e.openings).toBe(0);
  });

  it('a Division II senior in 2026 is NOT an opening for 2027 either', () => {
    const e = evidenceFor([row({ division: 'NCAA D2' })], { division: 'NCAA D2' });
    expect(e.vacatedStarters).toBe(0);
  });

  it('a Division III senior in 2026 IS an opening for 2027', () => {
    // Four seasons of competition, and the five-year model is a proposal that
    // has not been adopted.
    const e = evidenceFor([row({ division: 'NCAA D3' })], { division: 'NCAA D3' });
    expect(e.vacatedStarters).toBe(1);
    expect(e.openings).toBe(1);
  });

  it('an NAIA senior in 2026 IS an opening for 2027', () => {
    const e = evidenceFor([row({ division: 'NAIA' })], { division: 'NAIA' });
    expect(e.vacatedStarters).toBe(1);
  });

  it('a graduate student is an opening for 2027 under every association', () => {
    for (const division of ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA']) {
      const e = evidenceFor([row({ division, class_year_label: 'Gr.' })], { division });
      expect(e.vacatedStarters, division).toBe(1);
    }
  });

  it('has no rule at all for a junior college', () => {
    const e = evidenceFor([row({ division: 'NJCAA' })], { division: 'NJCAA' });
    expect(e.eligibilityRuled).toBe(false);
  });

  it('counts a player eligible to remain as competition, never as a departure', () => {
    const e = evidenceFor([row({ class_year_label: 'So.', division: 'NCAA D3' })], { division: 'NCAA D3' });
    expect(e.vacatedStarters).toBe(0);
    expect(e.eligibleToRemain).toBe(1);
  });
});

describe('vacated STARTING places', () => {
  const D3 = { division: 'NCAA D3' };

  it('counts a departing starter and not a departing squad player', () => {
    const e = evidenceFor([
      row({ ...D3, projected_minutes: 1200 }),
      row({ ...D3, projected_minutes: 100 }),
    ], D3);
    expect(e.openings).toBe(2);
    expect(e.vacatedStarters).toBe(1);
  });

  it('prefers real minutes to projected ones', () => {
    const e = evidenceFor([row({ ...D3, minutes_played: 50, projected_minutes: 1500 })], D3);
    expect(e.vacatedStarters).toBe(0);
  });

  it('never calls a row with no minutes at all a starter', () => {
    const e = evidenceFor([row({ ...D3, minutes_played: null, projected_minutes: null })], D3);
    expect(e.openings).toBe(1);
    expect(e.vacatedStarters).toBe(0);
  });

  it('holds a row with no readable class as the programme own doubt', () => {
    const e = evidenceFor([row({ ...D3, class_year_label: null })], D3);
    expect(e.unreadable).toBe(1);
    expect(e.openings).toBe(0);
  });
});

describe('the arrivals horizon', () => {
  const rows = [row({ division: 'NCAA D3' })];
  const arrivals = buildArrivalIndex([
    { programme: 'Test U', arrival_season: '2026', canonical_position: 'MIDFIELD', is_international: 1 },
    { programme: 'Test U', arrival_season: '2026', canonical_position: 'MIDFIELD', is_international: 0 },
    { programme: 'Test U', arrival_season: '2026', canonical_position: 'DEFENSE', is_international: 0 },
  ]);

  it('counts arrivals into the entry class at the position', () => {
    const e = evidenceFor(rows, { division: 'NCAA D3', entryYear: 2026, arrivalIndex: arrivals, arrivalsHorizon: 2026 });
    expect(e.arrivals).toBe(2);
    expect(e.arrivalsApplicable).toBe(true);
  });

  it('reports NOT applicable beyond the horizon rather than zero recruited', () => {
    const e = evidenceFor(rows, { division: 'NCAA D3', entryYear: 2028, arrivalIndex: arrivals, arrivalsHorizon: 2026 });
    expect(e.arrivalsApplicable).toBe(false);
    expect(e.arrivalsMeasured).toBe(false);
  });

  it('reports unknown inside the horizon when the programme is absent', () => {
    const e = positionEvidence({
      programme: 'Somewhere Else', position: 'MIDFIELD', sport: 'mens-soccer', division: 'NCAA D3',
      entryYear: 2026, rosterIndex: buildPositionIndex(rows.map((r) => ({ ...r, college_name: 'Somewhere Else' }))),
      arrivalIndex: arrivals, arrivalsHorizon: 2026,
    });
    expect(e.arrivals).toBeNull();
    expect(e.arrivalsApplicable).toBe(true);
  });
});

describe('international arrival behaviour', () => {
  const arrivals = buildArrivalIndex([
    { programme: 'A', arrival_season: '2026', canonical_position: 'MIDFIELD', is_international: 1 },
    { programme: 'A', arrival_season: '2025', canonical_position: 'DEFENSE', is_international: 1 },
    { programme: 'A', arrival_season: '2025', canonical_position: 'FORWARD', is_international: 0 },
    { programme: 'B', arrival_season: '2026', canonical_position: 'MIDFIELD', is_international: 0 },
  ]);

  it('counts a programme total and its international share across every season held', () => {
    const b = arrivalBehaviour({ programme: 'A', division: 'NCAA D1', sport: 'mens-soccer', arrivalIndex: arrivals });
    expect(b.programmeArrivals).toEqual({ total: 3, international: 2 });
  });

  it('returns nothing for a programme with no arrivals at all', () => {
    const b = arrivalBehaviour({ programme: 'C', division: 'NCAA D1', sport: 'mens-soccer', arrivalIndex: arrivals });
    expect(b.programmeArrivals).toBeNull();
  });

  it('pools a division rate for the fallback', () => {
    const colleges = new Map([['A', { division: 'NCAA D1' }], ['B', { division: 'NCAA D1' }]]);
    const rates = divisionArrivalRates([
      { programme: 'A', sport: 'mens-soccer', is_international: 1 },
      { programme: 'A', sport: 'mens-soccer', is_international: 0 },
      { programme: 'B', sport: 'mens-soccer', is_international: 0 },
      { programme: 'Unknown', sport: 'mens-soccer', is_international: 1 },
    ], colleges);
    expect(rates.get('mens-soccer|NCAA D1')).toEqual({ total: 3, international: 1 });
  });
});

describe('the index itself', () => {
  it('separates positions and keeps a programme total', () => {
    const index = buildPositionIndex([
      row({ position: 'MIDFIELD' }), row({ position: 'Defender' }), row({ position: 'Goalkeeper' }),
    ]);
    const entry = index.get('Test U');
    expect(entry.rows).toBe(3);
    expect([...entry.positions.keys()].sort()).toEqual(['DEFENSE', 'GOALKEEPER', 'MIDFIELD']);
  });

  it('counts a row with no position toward the programme but no position', () => {
    const index = buildPositionIndex([row({ position: null, class_year_label: null })]);
    expect(index.get('Test U').rows).toBe(1);
    expect(index.get('Test U').positions.size).toBe(0);
    expect(index.get('Test U').unreadable).toBe(1);
  });

  it('reports no roster for a programme it never saw', () => {
    const e = positionEvidence({
      programme: 'Ghost U', position: 'MIDFIELD', sport: 'mens-soccer', division: 'NCAA D1',
      entryYear: 2027, rosterIndex: buildPositionIndex([row()]), arrivalIndex: new Map(),
    });
    expect(e.rosterOnFile).toBe(false);
  });
});
