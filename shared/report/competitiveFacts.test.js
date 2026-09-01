/**
 * What a competitive record is allowed to say out loud.
 *
 * The forbidden-vocabulary test is swept over every sentence the module can
 * emit for every shape of history, rather than asserted case by case: the
 * pressure to write "improving" arrives the moment somebody looks at four
 * seasons that happen to point the same way, and it should fail here.
 */
import { describe, it, expect } from 'vitest';
import { competitiveHistory } from '../competitiveHistory.js';
import { competitiveFacts, benchmarkFact, coachFact, FORBIDDEN } from './competitiveFacts.js';

const S = (season, wins, losses, draws, confidence = 'ROSTER_CONSISTENT') =>
  ({ season, wins, losses, draws, confidence });
const rising = [S(2022, 8, 7, 3), S(2023, 10, 5, 3), S(2024, 12, 4, 2), S(2025, 14, 3, 2)];
const falling = [S(2022, 19, 1, 1), S(2023, 14, 3, 1), S(2024, 8, 7, 2), S(2025, 3, 10, 4)];
const flat = [S(2022, 10, 5, 3), S(2023, 10, 5, 3), S(2024, 10, 5, 3), S(2025, 10, 5, 3)];
const pool = { rates: Array.from({ length: 200 }, (_, i) => i / 400), scope: 'NCAA D1 men’s' };

const allText = (rows, extra = {}) => {
  const h = competitiveHistory({ rows, ...extra });
  return [...competitiveFacts(h), ...h.seasons.map(benchmarkFact), coachFact(h)]
    .filter(Boolean).map((f) => f.text);
};

describe('what the facts may not say', () => {
  /**
   * The monotonic cases are the whole point. `falling` is Mercyhurst's real
   * four seasons — 19-1-1 down to 3-10-4 — and even that must not be called a
   * decline, because four seasons of a college programme are four seasons, not
   * a trend, and nothing here forecasts the fifth.
   */
  it.each([['rising', rising], ['falling', falling], ['flat', flat],
    ['three seasons', rising.slice(0, 3)], ['two', rising.slice(0, 2)], ['one', rising.slice(0, 1)]])(
    'uses no direction or judgement word for a %s history', (_label, rows) => {
      const texts = allText(rows, { pools: { 2022: pool, 2023: pool, 2024: pool, 2025: pool } });
      expect(texts.length).toBeGreaterThan(0);
      for (const t of texts) expect(t, t).not.toMatch(FORBIDDEN);
    });

  it('catches the words it is meant to catch', () => {
    for (const bad of ['The programme is improving.', 'Results are declining.', 'A rising programme.',
      'Trending up.', 'strong momentum', 'their best season', 'a weak year']) {
      expect(FORBIDDEN.test(bad), bad).toBe(true);
    }
  });

  it('makes no statement about a season that has not been played', () => {
    for (const t of allText(rising)) {
      expect(t).not.toMatch(/2026|next season|will |expect/i);
    }
  });
});

describe('what the facts do say', () => {
  it('leads with the sequence, unchanged', () => {
    const facts = competitiveFacts(competitiveHistory({ rows: rising }));
    expect(facts[0].text).toBe('2022 8-7-3 · 2023 10-5-3 · 2024 12-4-2 · 2025 14-3-2');
  });

  it('compares two endpoints without naming a direction', () => {
    const t = competitiveFacts(competitiveHistory({ rows: rising })).find((f) => f.id === 'wins-endpoints').text;
    expect(t).toBe('Win total went from 8 in 2022 to 14 in 2025.');
  });

  it('states the range between the two extreme rates', () => {
    const t = competitiveFacts(competitiveHistory({ rows: rising })).find((f) => f.id === 'range').text;
    expect(t).toMatch(/ranged from \.528 in 2022 to \.789 in 2025/);
  });

  it('says highest observed rather than best', () => {
    const t = competitiveFacts(competitiveHistory({ rows: rising })).find((f) => f.id === 'highest').text;
    expect(t).toMatch(/highest rate observed in this window/);
    expect(t).not.toMatch(/best/i);
  });

  it('states the denominator first where the window is short', () => {
    const facts = competitiveFacts(competitiveHistory({ rows: rising.slice(0, 3) }));
    expect(facts[0].id).toBe('denominator');
    expect(facts[0].text).toMatch(/3 seasons of the 4 in this window/);
  });

  it('refuses a comparison from one season and says why', () => {
    const facts = competitiveFacts(competitiveHistory({ rows: rising.slice(0, 1) }));
    const t = facts.map((f) => f.text).join(' ');
    expect(t).toMatch(/One season does not support a comparison/);
    expect(facts.some((f) => f.id === 'range')).toBe(false);
    expect(facts.some((f) => f.id === 'wins-endpoints')).toBe(false);
  });

  it('says nothing at all where no season is readable', () => {
    expect(competitiveFacts(competitiveHistory({ rows: [] }))).toEqual([]);
  });
});

describe('the benchmark sentence', () => {
  const withPool = competitiveHistory({ rows: rising, pools: { 2025: pool } });

  /**
   * About the RATE, never about the programme. A season's rate is partly a
   * property of who was scheduled, and nothing in this database holds a
   * fixture, so "the programme was in the upper quarter" claims more than the
   * measurement can carry.
   */
  it('describes where the rate sat, not where the programme sat', () => {
    const t = benchmarkFact(withPool.seasons.find((s) => s.season === 2025)).text;
    expect(t).toMatch(/^The 2025 results rate of/);
    expect(t).not.toMatch(/the programme (was|sat|ranked)/i);
    expect(t).toMatch(/of the 200 NCAA D1 men’s programmes measured that season/);
    expect(t).toMatch(/middle half/);
  });

  it('is null where the pool was refused', () => {
    const small = competitiveHistory({ rows: rising, pools: { 2025: { rates: [0.4, 0.5, 0.6], scope: 'x' } } });
    expect(benchmarkFact(small.seasons.find((s) => s.season === 2025))).toBeNull();
  });
});

describe('the coach sentence', () => {
  const att = (seasons) => ({ currentCoach: { name: 'Jane Kerr' }, measuredSeasons: seasons });
  const all4 = att([2022, 2023, 2024, 2025].map((s) => ({ season: String(s), attribution: 'CURRENT_COACH' })));
  const two = att([['2022', 'PREVIOUS_COACH'], ['2023', 'PREVIOUS_COACH'], ['2024', 'CURRENT_COACH'],
    ['2025', 'CURRENT_COACH']].map(([season, attribution]) => ({ season, attribution })));
  const none = att([2022, 2023, 2024, 2025].map((s) => ({ season: String(s), attribution: 'PREVIOUS_COACH' })));

  it('agrees with itself on number', () => {
    const one = att([['2022', 'PREVIOUS_COACH'], ['2023', 'PREVIOUS_COACH'], ['2024', 'PREVIOUS_COACH'],
      ['2025', 'CURRENT_COACH']].map(([season, attribution]) => ({ season, attribution })));
    const t = coachFact(competitiveHistory({ rows: rising, coachAttribution: one })).text;
    expect(t).toBe('1 of the 4 measured competitive season was under Jane Kerr; '
      + 'across that season the programme recorded 14-3-2.');
  });

  it('counts, and never credits', () => {
    const t = coachFact(competitiveHistory({ rows: rising, coachAttribution: two })).text;
    expect(t).toBe('2 of the 4 measured competitive seasons were under Jane Kerr; '
      + 'across those seasons the programme recorded 26-7-4.');
    expect(t).not.toMatch(FORBIDDEN);
    expect(t).not.toMatch(/took|led|built|turned|under (her|his) /i);
  });

  it('states a whole window and an empty one plainly', () => {
    expect(coachFact(competitiveHistory({ rows: rising, coachAttribution: all4 })).text)
      .toMatch(/^All 4 measured competitive seasons/);
    expect(coachFact(competitiveHistory({ rows: rising, coachAttribution: none })).text)
      .toMatch(/^None of the 4 measured competitive seasons/);
  });

  it('is null where there is no coach on file', () => {
    expect(coachFact(competitiveHistory({ rows: rising }))).toBeNull();
    expect(coachFact(competitiveHistory({ rows: rising,
      coachAttribution: { currentCoach: null, measuredSeasons: [] } }))).toBeNull();
  });
});
