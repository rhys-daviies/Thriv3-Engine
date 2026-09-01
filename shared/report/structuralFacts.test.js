/**
 * The wording contract for structural facts.
 *
 * A division change is the single most tempting thing in this dataset to
 * editorialise, and every word that would do it is banned by a check that runs
 * over every sentence the module can emit.
 */
import { describe, it, expect } from 'vitest';
import { structuralFacts, conferenceRecordFact, FORBIDDEN } from './structuralFacts.js';
import { structuralHistory, conferenceRecordRow } from '../conferenceHistory.js';

const MERCYHURST = structuralHistory([
  { season: 2022, conferenceId: 'psac', conferenceName: 'Pennsylvania State Athletic Conference', historicalDivision: 'NCAA D2' },
  { season: 2023, conferenceId: 'psac', conferenceName: 'Pennsylvania State Athletic Conference', historicalDivision: 'NCAA D2' },
  { season: 2024, conferenceId: 'nec', conferenceName: 'Northeast Conference', historicalDivision: 'NCAA D1' },
  { season: 2025, conferenceId: 'nec', conferenceName: 'Northeast Conference', historicalDivision: 'NCAA D1' },
]);
const STABLE = structuralHistory([2022, 2023, 2024, 2025].map((season) => ({
  season, conferenceId: 'gliac', conferenceName: 'Great Lakes Intercollegiate Athletic Conference', historicalDivision: 'NCAA D2',
})));

describe('a move is a fact and never a direction', () => {
  it('states both sides and nothing else', () => {
    const f = structuralFacts(MERCYHURST).find((x) => x.kind === 'DIVISION_CHANGE');
    expect(f.text).toBe('The programme moved from NCAA Division II to NCAA Division I in 2024.');
  });

  it('emits no forbidden word, over every shape of input', () => {
    const shapes = [MERCYHURST, STABLE,
      structuralHistory([{ season: 2025, conferenceId: 'nec', conferenceName: 'Northeast Conference', historicalDivision: 'NCAA D1' }]),
      structuralHistory([{ season: 2024, conferenceId: 'nec', conferenceName: 'Northeast Conference', historicalDivision: null },
        { season: 2025, conferenceId: 'nec', conferenceName: 'Northeast Conference', historicalDivision: 'NCAA D1' }]),
    ];
    for (const s of shapes) {
      for (const f of structuralFacts(s)) {
        expect(f.text, f.text).not.toMatch(FORBIDDEN);
      }
    }
    for (const season of [2022, 2023]) {
      const f = conferenceRecordFact(conferenceRecordRow({ season, record: '10-0', conferenceName: 'PSAC', conferenceSize: 18 }));
      expect(f.text, f.text).not.toMatch(FORBIDDEN);
    }
  });

  it('catches the words it exists to catch', () => {
    for (const bad of ['The programme was promoted to Division I.', 'It stepped up a level.',
      'A move to a stronger conference.', 'The programme improved.', 'An elite division.']) {
      expect(bad).toMatch(FORBIDDEN);
    }
  });

  it('does not fire on a person’s name or an ordinary word', () => {
    for (const ok of ['Mercyhurst moved from NCAA Division II to NCAA Division I in 2024.',
      'The programme competed in the Northeast Conference in 2024.',
      'Stepanovic was the coach across every season measured.',
      'Risen and Bettering are surnames, not verdicts.']) {
      expect(ok).not.toMatch(FORBIDDEN);
    }
  });
});

describe('a fact needs both of its sides', () => {
  it('does not call one season a stable conference', () => {
    const one = structuralHistory([{ season: 2025, conferenceId: 'nec', conferenceName: 'Northeast Conference', historicalDivision: 'NCAA D1' }]);
    const kinds = structuralFacts(one).map((f) => f.kind);
    expect(kinds).not.toContain('CONFERENCE_STABLE');
    expect(kinds).toContain('WINDOW_INCOMPLETE');
  });

  it('states the denominator whenever the window is short', () => {
    const three = structuralHistory([2023, 2024, 2025].map((season) => ({
      season, conferenceId: 'big-east', conferenceName: 'Big East Conference', historicalDivision: 'NCAA D1',
    })));
    const f = structuralFacts(three).find((x) => x.kind === 'WINDOW_INCOMPLETE');
    expect(f.text).toContain('3 of the four seasons');
  });

  it('says so when a season on file has no division', () => {
    const mixed = structuralHistory([
      { season: 2024, conferenceId: 'nec', conferenceName: 'Northeast Conference', historicalDivision: null },
      { season: 2025, conferenceId: 'nec', conferenceName: 'Northeast Conference', historicalDivision: 'NCAA D1' },
    ]);
    expect(structuralFacts(mixed).find((f) => f.kind === 'DIVISION_UNKNOWN').text)
      .toContain('not established for 1 of the 2 seasons');
  });

  it('returns nothing at all for a programme with nothing collected', () => {
    expect(structuralFacts(null)).toEqual([]);
    expect(structuralFacts(structuralHistory([]))).toEqual([]);
  });
});

describe('a conference record is stated with its conference', () => {
  it('names the competition the record was made in', () => {
    const f = conferenceRecordFact(conferenceRecordRow({ season: 2022, record: '10-0', conferenceName: 'PSAC', conferenceSize: 18 }));
    expect(f.text).toBe("In 2022 the programme's record inside the PSAC was 10-0-0 from 10 matches, one of 18 programmes in it that season.");
  });

  it('emits nothing where the record is not readable', () => {
    expect(conferenceRecordFact(conferenceRecordRow({ season: 2022, record: null }))).toBeNull();
  });
});
