/**
 * The two readability rules, and the order they have to run in.
 */
import { describe, it, expect } from 'vitest';
import { readableRows, minutesCoverage } from './readable.js';
import { buildLifecycles } from './lifecycle.js';
import { developmentSummary } from './development.js';

const row = (o = {}) => ({
  sport: 'mens-soccer', college_name: 'Alpha', season: '2025',
  player_name: `P${Math.random()}`, class_year_label: 'Fr.', position: 'DEFENSE',
  minutes_played: 0, games_played: 0, games_started: 0, ...o,
});
// Names are letters only: the identity key strips digits and punctuation, so
// "p2025-1" and "p2025-2" are the same person to buildLifecycles.
const NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const nameFor = (i) => `${NAMES[i % 26]}${NAMES[Math.floor(i / 26) % 26]}${NAMES[Math.floor(i / 676) % 26]}`;
const many = (n, o = {}) => Array.from({ length: n }, (_, i) => row({
  player_name: `Player ${nameFor(i)}${o.season ? NAMES[Number(o.season) % 26] : ''}`, ...o,
}));

describe('readableRows', () => {
  // The row rule: a zero beside games played is a gap in the publishing, not
  // a benching.
  it('restores an unpublished zero to null', () => {
    const [out] = readableRows([row({ minutes_played: 0, games_played: 16 })]);
    expect(out.minutes_played).toBeNull();
  });

  it('leaves a zero that says zero games alone, inside a season that was read', () => {
    const rows = readableRows([
      ...many(20, { minutes_played: 900, games_played: 18, class_year_label: 'Sr.' }),
      row({ player_name: 'benched', minutes_played: 0, games_played: 0 }),
    ]);
    expect(rows.find((r) => r.player_name === 'benched').minutes_played).toBe(0);
  });

  // The source rule, which the row rule cannot reach: a fabricated row claims
  // zero games as confidently as zero minutes, so it survives the row rule
  // and arrives downstream as a measured zero.
  it('blanks a whole season no row of which carries a minute', () => {
    const rows = readableRows(many(34));
    expect(rows.every((r) => r.minutes_played === null)).toBe(true);
    expect(rows.every((r) => r.games_played === null)).toBe(true);
    expect(minutesCoverage(rows).readable).toBe(false);
  });

  // Albertus Magnus: three seasons that published nothing and one that
  // assumed a zero for everybody. Today that reads as a confident zero over a
  // cohort of 28; it has to read as no evidence at all.
  it('stops a fabricated season becoming a development finding', () => {
    const raw = [
      ...many(30, { season: '2023', minutes_played: null, games_played: null }),
      ...many(31, { season: '2024', minutes_played: null, games_played: null }),
      ...many(34, { season: '2025' }),
    ];
    const before = developmentSummary(
      buildLifecycles(raw).filter((l) => l.entryType === 'FIRST_YEAR'),
    ).everReachedStarter;
    expect(before.share).toBe(0);
    expect(before.denominator).toBeGreaterThan(8);

    const after = developmentSummary(
      buildLifecycles(readableRows(raw)).filter((l) => l.entryType === 'FIRST_YEAR'),
    ).everReachedStarter;
    expect(after.suppressed).toBe(true);
    expect(after.share).toBeNull();
    expect(after.denominator).toBe(0);
  });

  it('judges each season on its own and leaves the readable ones intact', () => {
    const rows = readableRows([
      ...many(30, { season: '2024', minutes_played: 700, games_played: 18 }),
      ...many(30, { season: '2025' }),
    ]);
    expect(rows.filter((r) => r.season === '2024').every((r) => r.minutes_played === 700)).toBe(true);
    expect(rows.filter((r) => r.season === '2025').every((r) => r.minutes_played === null)).toBe(true);
  });

  it('leaves the forward roster unmeasured rather than calling it unreadable', () => {
    const rows = readableRows(many(30, { season: '2026', minutes_played: null, games_played: null }));
    expect(rows.every((r) => r.minutes_played === null)).toBe(true);
    expect(minutesCoverage(rows).measured).toBe(0);
  });
});
