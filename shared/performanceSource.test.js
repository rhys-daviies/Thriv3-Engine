import { describe, it, expect } from 'vitest';
import {
  performanceUnreadableSeasons, blankUnreadableSeasons, withReadablePerformance,
  teamMinuteRatio, teamMinutesArePlausible, programmeSeasonKey,
  MIN_SOURCE_ROSTER, MINUTES_PER_MATCH, PLAUSIBLE_TEAM_MINUTES,
} from './performanceSource.js';

const row = (over = {}) => ({
  sport: 'mens-soccer', college_name: 'Somewhere', season: '2025',
  player_name: 'A', class_year_label: 'Fr.', position: 'DEFENSE',
  minutes_played: 0, games_played: 0, games_started: 0, ...over,
});
/** n players, each built from `make(i)`. */
const squad = (n, make = () => ({})) => Array.from({ length: n }, (_, i) => row({ player_name: `P${i}`, ...make(i) }));

describe('a programme-season whose stats page was never read', () => {
  // The shape the 2025 import left behind: every player assumed to have
  // played nothing, in a season the team demonstrably played.
  it('is named when a full roster carries nothing above zero', () => {
    const keys = performanceUnreadableSeasons(squad(34));
    expect([...keys]).toEqual(['mens-soccer|Somewhere|2025']);
  });

  it('is not named when one player has a minute on file', () => {
    const rows = squad(34);
    rows[7].minutes_played = 12;
    rows[7].games_played = 1;
    expect(performanceUnreadableSeasons(rows).size).toBe(0);
  });

  // The distinction the whole rule rests on. A player who is on the roster
  // and not on a stats page that WAS read really did not appear, and that
  // zero is a fact about them.
  it('leaves a genuine non-playing squad member alone inside a read season', () => {
    const rows = [
      ...squad(20, (i) => ({ minutes_played: 900 + i, games_played: 18 })),
      row({ player_name: 'Benched', minutes_played: 0, games_played: 0 }),
    ];
    expect(performanceUnreadableSeasons(rows).size).toBe(0);
    const out = withReadablePerformance(rows);
    expect(out.find((r) => r.player_name === 'Benched').minutes_played).toBe(0);
  });

  it('judges each programme-season separately, not the programme', () => {
    const rows = [
      ...squad(30, () => ({ season: '2024', minutes_played: 500, games_played: 15 })),
      ...squad(30, () => ({ season: '2025' })),
    ];
    expect([...performanceUnreadableSeasons(rows)]).toEqual(['mens-soccer|Somewhere|2025']);
    const out = withReadablePerformance(rows);
    expect(out.filter((r) => r.season === '2024').every((r) => r.minutes_played === 500)).toBe(true);
    expect(out.filter((r) => r.season === '2025').every((r) => r.minutes_played === null)).toBe(true);
  });

  it('does not condemn a season on a fragment of a roster', () => {
    expect(performanceUnreadableSeasons(squad(MIN_SOURCE_ROSTER - 1)).size).toBe(0);
    expect(performanceUnreadableSeasons(squad(MIN_SOURCE_ROSTER)).size).toBe(1);
  });

  // 2026 is a named roster with no minutes anywhere by design. Calling it
  // unreadable would say the source failed, when the source was never asked.
  it('never names the forward roster, which claims no minutes at all', () => {
    const rows = squad(30, () => ({ season: '2026', minutes_played: null, games_played: null }));
    expect(performanceUnreadableSeasons(rows).size).toBe(0);
    expect(withReadablePerformance(rows).every((r) => r.minutes_played === null)).toBe(true);
  });

  // The games column is blanked with the minutes because the import assumed
  // both, and because minutesAreMissing reads games to decide whether a zero
  // can be believed — a surviving `games_played: 0` keeps the row measured.
  it('blanks minutes, games and starts together', () => {
    const [out] = blankUnreadableSeasons(squad(12), performanceUnreadableSeasons(squad(12)));
    expect(out.minutes_played).toBeNull();
    expect(out.games_played).toBeNull();
    expect(out.games_started).toBeNull();
  });

  it('keys on the sport as well as the programme and season', () => {
    expect(programmeSeasonKey(row())).toBe('mens-soccer|Somewhere|2025');
    const rows = [...squad(12), ...squad(12, () => ({ sport: 'womens-soccer', minutes_played: 700, games_played: 16 }))];
    expect([...performanceUnreadableSeasons(rows)]).toEqual(['mens-soccer|Somewhere|2025']);
  });

  it('does not write to the rows it was given', () => {
    const rows = squad(12);
    withReadablePerformance(rows);
    expect(rows.every((r) => r.minutes_played === 0)).toBe(true);
  });
});

describe('the team-minute invariant', () => {
  // Eleven players for ninety minutes is what a match contains, so a season's
  // published minutes have a size they must be near. Measured across every
  // programme-season that passes the coverage gate the median is 1.00 and 97%
  // land inside the band; this is the arithmetic behind that claim.
  it('reads a normally published season as about one', () => {
    const rows = [
      ...squad(11, () => ({ minutes_played: 18 * 90, games_played: 18 })),
      ...squad(14, () => ({ minutes_played: 0, games_played: 0 })),
    ];
    expect(teamMinuteRatio(rows)).toBeCloseTo(1, 5);
    expect(teamMinutesArePlausible(teamMinuteRatio(rows))).toBe(true);
  });

  it('reads a fabricated season as zero', () => {
    expect(teamMinuteRatio(squad(30, () => ({ games_played: 0 })))).toBeNull();
    expect(teamMinuteRatio(squad(30, () => ({ games_played: 18 })))).toBe(0);
    expect(teamMinutesArePlausible(0)).toBe(false);
  });

  it('refuses the question rather than answering it from nothing', () => {
    expect(teamMinuteRatio([])).toBeNull();
    expect(teamMinuteRatio(squad(20, () => ({ minutes_played: null })))).toBeNull();
    expect(teamMinutesArePlausible(null)).toBeNull();
  });

  it('agrees with the constants it is documented against', () => {
    expect(MINUTES_PER_MATCH).toBe(11 * 90);
    expect(PLAUSIBLE_TEAM_MINUTES).toEqual({ low: 0.85, high: 1.15 });
  });

  // Lake Erie, in miniature: 62 named players, 28 of whom played. The roster
  // is inflated and the minutes are real, and the rule must not confuse the
  // two — see the regression case in freshmanMinutes.test.js.
  it('holds on an inflated roster where the minutes are real', () => {
    const rows = [
      ...squad(28, () => ({ minutes_played: Math.round(18 * 90 * 11 / 28), games_played: 18 })),
      ...squad(34, (i) => ({ player_name: `Reserve${i}`, minutes_played: 0, games_played: 0 })),
    ];
    expect(performanceUnreadableSeasons(rows).size).toBe(0);
    expect(teamMinutesArePlausible(teamMinuteRatio(rows))).toBe(true);
  });
});
