import { describe, it, expect } from 'vitest';
import {
  starterState, STARTER_STATE, STARTER_MINUTES, STARTER_GAMES_STARTED,
  buildPositionIndex, assertStarterInputsSelected, positionEvidence,
} from './rosterEvidence.js';

const row = (over = {}) => ({
  college_name: 'C', sport: 'mens-soccer', season: '2026', division: 'NCAA D3',
  player_name: 'P', position: 'Midfielder', class_year_label: 'Sr.',
  minutes_played: null, projected_minutes: null,
  games_started: null, projected_games_started: null, ...over,
});

describe('three states, not two', () => {
  it('reads real minutes first', () => {
    expect(starterState(row({ minutes_played: STARTER_MINUTES }))).toBe(STARTER_STATE.STARTER);
    expect(starterState(row({ minutes_played: STARTER_MINUTES - 1 }))).toBe(STARTER_STATE.SQUAD);
  });

  it('prefers a start actually recorded this season to minutes carried forward', () => {
    // A start recorded now is better evidence than last season's total.
    expect(starterState(row({ games_started: STARTER_GAMES_STARTED, projected_minutes: 0 }))).toBe(STARTER_STATE.STARTER);
  });

  it('falls back to projected minutes, then to projected starts', () => {
    expect(starterState(row({ projected_minutes: 900 }))).toBe(STARTER_STATE.STARTER);
    expect(starterState(row({ projected_games_started: STARTER_GAMES_STARTED }))).toBe(STARTER_STATE.STARTER);
    expect(starterState(row({ projected_games_started: STARTER_GAMES_STARTED - 1 }))).toBe(STARTER_STATE.SQUAD);
  });

  it('returns UNKNOWN when nothing is recorded, rather than SQUAD', () => {
    // The defect this whole phase turns on: a player nobody recorded is not a
    // player we know did not start.
    expect(starterState(row())).toBe(STARTER_STATE.UNKNOWN);
  });

  it('treats a recorded zero as evidence, not as absence', () => {
    expect(starterState(row({ projected_games_started: 0 }))).toBe(STARTER_STATE.SQUAD);
    expect(starterState(row({ minutes_played: 0 }))).toBe(STARTER_STATE.SQUAD);
  });

  it('uses the calibrated appearance threshold', () => {
    expect(STARTER_GAMES_STARTED).toBe(7);
    expect(STARTER_MINUTES).toBe(600);
  });
});

describe('the stale-query guard', () => {
  it('throws when a roster query omits the appearance columns', () => {
    const stale = [{ college_name: 'C', player_name: 'P', position: 'Midfielder', minutes_played: null, projected_minutes: 100 }];
    expect(() => assertStarterInputsSelected(stale)).toThrow(/does not select games_started/);
    expect(() => buildPositionIndex(stale)).toThrow(/does not select/);
  });

  it('passes a query that selects them, even when every value is null', () => {
    expect(() => buildPositionIndex([row()])).not.toThrow();
  });

  it('ignores a list that is not a roster query at all', () => {
    expect(() => assertStarterInputsSelected([{ id: 1 }])).not.toThrow();
    expect(() => assertStarterInputsSelected([])).not.toThrow();
  });
});

describe('departing-cohort coverage travels with the evidence', () => {
  const evidenceFor = (rows) => positionEvidence({
    programme: 'C', position: 'MIDFIELD', sport: 'mens-soccer', division: 'NCAA D3',
    entryYear: 2028, rosterIndex: buildPositionIndex(rows), arrivalIndex: null, arrivalsHorizon: 2026,
  });

  it('counts a departing player nobody could place', () => {
    // A senior in D3 has four seasons, so 2026 is their last: they depart.
    const e = evidenceFor([row({ player_name: 'A' }), row({ player_name: 'B', projected_games_started: 12 })]);
    expect(e.starterEvidence.departing).toBe(2);
    expect(e.starterEvidence.departingUnknown).toBe(1);
    expect(e.vacatedStarters).toBe(1);
  });

  it('does not count a returning player as departing', () => {
    const e = evidenceFor([row({ class_year_label: 'Fy.' })]);
    expect(e.starterEvidence.departing).toBe(0);
    expect(e.starterEvidence.departingUnknown).toBe(0);
  });
});
