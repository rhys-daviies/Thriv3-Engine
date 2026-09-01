/**
 * The V1 contract, as tests rather than as a promise.
 *
 * Two things are being held: that a sparse programme gets a shorter package and
 * never an invented one, and that no sentence the package can produce contains
 * a word the reader-language contract forbids.
 */
import { describe, it, expect } from 'vitest';
import {
  competitivePackage, readerSentences, V1_FIELDS, V1_NON_CLAIMS,
  FORBIDDEN_READER_LANGUAGE, COVERAGE_SENTENCES, COACH_INTEGRATION,
} from './competitivePackage.js';
import { competitiveHistory } from '../competitiveHistory.js';
import { structuralHistory, conferenceRecordRow } from '../conferenceHistory.js';

const season = (y, w, d, l, div) => ({ season: y, wins: w, draws: d, losses: l, matches_played: w + d + l, confidence: 'ROSTER_CONSISTENT', historical_division: div });
const pools = (div) => Object.fromEntries([2022, 2023, 2024, 2025].map((y) => [y, { [div]: { rates: Array.from({ length: 60 }, (_, i) => i / 120), scope: `${div} men’s` } }]));
const structuralOf = (rows) => {
  const h = structuralHistory(rows);
  return {
    ...h,
    rows: rows.map((r) => ({ ...r, conferenceName: r.conferenceName, conferenceSize: 12, conferenceTableRow: 3, source: { provenance: 'x', url: 'https://example.test' } })),
    conferenceRecords: rows.map((r) => conferenceRecordRow({ season: r.season, record: r.record ?? '8-1-1', conferenceName: r.conferenceName, conferenceSize: 12 })),
  };
};

const FOUR = [2022, 2023, 2024, 2025];
const full = () => competitivePackage({
  history: competitiveHistory({ rows: FOUR.map((y) => season(y, 12, 3, 4, 'NCAA D1')), pools: pools('NCAA D1') }),
  structural: structuralOf(FOUR.map((y) => ({ season: y, conferenceId: 'big-east', conferenceName: 'Big East Conference', historicalDivision: 'NCAA D1' }))),
});

describe('the field contract travels with the data', () => {
  it('classifies every V1 field', () => {
    for (const [name, f] of Object.entries(V1_FIELDS)) {
      expect(['RENDER', 'RENDER_WITH_COVERAGE_GATE', 'INTERNAL_ONLY', 'DEFER'], name).toContain(f.verdict);
    }
  });

  it('gates the two fields that need their own denominator', () => {
    expect(V1_FIELDS.seasonBenchmark.verdict).toBe('RENDER_WITH_COVERAGE_GATE');
    expect(V1_FIELDS.seasonBenchmark.gate).toMatch(/pool size must be stated/);
    expect(V1_FIELDS.conferenceRecord.gate).toMatch(/never be compared across conferences/);
  });

  it('defers what 12A and 12C rejected, and keeps the table row internal', () => {
    for (const f of ['conferenceFinish', 'postseasonDepth', 'scheduleStrength', 'opponentStrength']) {
      expect(V1_FIELDS[f].verdict, f).toBe('DEFER');
    }
    expect(V1_FIELDS.conferenceTableRow.verdict).toBe('INTERNAL_ONLY');
    expect(V1_FIELDS.conferenceTableRow.note).toMatch(/NOT a finish/);
  });

  it('ships the non-claims with every package', () => {
    expect(full().contract.nonClaims).toEqual(V1_NON_CLAIMS);
    expect(V1_NON_CLAIMS.length).toBeGreaterThanOrEqual(14);
  });
});

describe('the reader-language contract', () => {
  it('holds over every sentence a complete package can produce', () => {
    for (const s of readerSentences(full())) expect(s, s).not.toMatch(FORBIDDEN_READER_LANGUAGE);
  });

  it('holds over every coverage sentence', () => {
    const all = [
      COVERAGE_SENTENCES.CONFERENCE_UNKNOWN(2022), COVERAGE_SENTENCES.DIVISION_UNKNOWN(2022),
      COVERAGE_SENTENCES.RECORD_UNAVAILABLE(2022, 'Big East Conference'),
      COVERAGE_SENTENCES.SEASON_NOT_READABLE(2022), COVERAGE_SENTENCES.SEASON_ABSENT(2022),
      COVERAGE_SENTENCES.POOL_TOO_SMALL(2022, 12), COVERAGE_SENTENCES.WINDOW_PARTIAL(3),
    ];
    for (const s of all) expect(s, s).not.toMatch(FORBIDDEN_READER_LANGUAGE);
  });

  it('catches the words it exists to catch', () => {
    for (const bad of ['an elite programme', 'a weak conference', 'the programme improved',
      'a tough schedule', 'a dominant side', 'the programme is rising', 'results got worse',
      'a struggling programme', 'promoted to Division I', 'a stronger league']) {
      expect(bad, bad).toMatch(FORBIDDEN_READER_LANGUAGE);
    }
  });

  it('does not fire on a place, a surname or an ordinary sentence', () => {
    for (const ok of ['The programme recorded a .684 NCAA winning percentage in 2025.',
      'That rate sat in the upper quarter of the 194 NCAA Division I men’s programmes measured that season.',
      'The programme competed in the PSAC in 2023 and the NEC in 2024.',
      'The programme moved from NCAA Division II to NCAA Division I in 2024.',
      'Conference membership is established for three of the four seasons measured.',
      'Strongsville and Risen are a place and a surname.',
      'Eastern Kentucky and Western Carolina are institutions.']) {
      expect(ok, ok).not.toMatch(FORBIDDEN_READER_LANGUAGE);
    }
  });

  it('states an absence without saying anything about the programme', () => {
    const s = COVERAGE_SENTENCES.RECORD_UNAVAILABLE(2023, 'Big East Conference');
    expect(s).toBe('Conference record for 2023 is not available from the verified source for the Big East Conference.');
    // Not "no conference record", which reads as a programme that did badly.
    expect(s).not.toMatch(/\bno\b/i);
  });
});

describe('a sparse programme', () => {
  const withSeasons = (years, confYears = years) => competitivePackage({
    history: competitiveHistory({ rows: years.map((y) => season(y, 10, 4, 5, 'NCAA D2')), pools: pools('NCAA D2') }),
    structural: confYears.length
      ? structuralOf(confYears.map((y) => ({ season: y, conferenceId: 'psac', conferenceName: 'PSAC', historicalDivision: 'NCAA D2' })))
      : null,
  });

  it('returns a package for four seasons and names all four', () => {
    const p = withSeasons(FOUR);
    expect(p.available).toBe(true);
    expect(p.describes).toEqual(FOUR);
    expect(p.coverage).toMatchObject({ readableSeasons: 4, membershipKnown: 4, divisionKnown: 4 });
    expect(p.refusals).toEqual([]);
  });

  for (const n of [3, 2, 1]) {
    it(`states where the evidence runs out at ${n} of 4`, () => {
      const years = FOUR.slice(0, n);
      const p = withSeasons(years);
      expect(p.describes).toEqual(years);
      expect(p.coverage.readableSeasons).toBe(n);
      // The seasons with no record on file are named, one refusal each.
      const absent = p.refusals.filter((r) => r.kind === 'SEASON_ABSENT').map((r) => r.season);
      expect(absent).toEqual(FOUR.slice(n));
      if (n < 4) expect(p.refusals.some((r) => r.kind === 'WINDOW_PARTIAL')).toBe(true);
    });
  }

  it('returns an unavailable package at 0 of 4, and no seasons', () => {
    const p = competitivePackage({ history: competitiveHistory({ rows: [] }) });
    expect(p.available).toBe(false);
    expect(p.seasons).toEqual([]);
    expect(p.structuralFacts).toEqual([]);
    expect(p.contract.fields).toBe(V1_FIELDS);
  });

  it('creates no continuity across a gap', () => {
    const p = withSeasons([2022, 2025]);
    expect(p.structuralFacts.some((f) => f.kind === 'CONFERENCE_CHANGE')).toBe(false);
    expect(p.describes).toEqual([2022, 2025]);
  });

  it('carries a record with no membership, and a membership with no record', () => {
    const noConf = withSeasons(FOUR, []);
    expect(noConf.coverage.membershipKnown).toBe(0);
    expect(noConf.refusals.filter((r) => r.kind === 'CONFERENCE_UNKNOWN')).toHaveLength(4);

    const noRecord = competitivePackage({
      history: competitiveHistory({ rows: [season(2022, 10, 4, 5, 'NCAA D2')], pools: pools('NCAA D2') }),
      structural: {
        ...structuralHistory([{ season: 2022, conferenceId: 'psac', conferenceName: 'PSAC', historicalDivision: 'NCAA D2' }]),
        rows: [{ season: 2022, conferenceId: 'psac', conferenceName: 'PSAC', historicalDivision: 'NCAA D2', source: {} }],
        conferenceRecords: [conferenceRecordRow({ season: 2022, record: null, conferenceName: 'PSAC' })],
      },
    });
    expect(noRecord.seasons[0].coverageClass).toBe('MEMBERSHIP_KNOWN_RECORD_UNKNOWN');
    expect(noRecord.seasons[0].historicalConference).toBe('PSAC');
    expect(noRecord.seasons[0].conferenceRecord).toBeNull();
    expect(noRecord.refusals.some((r) => r.kind === 'RECORD_UNAVAILABLE')).toBe(true);
  });
});

describe('the coach integration contract', () => {
  it('allows a count with its denominator and refuses every causal framing', () => {
    expect(COACH_INTEGRATION.allowed.join(' ')).toMatch(/denominator/);
    expect(COACH_INTEGRATION.refused.join(' ')).toMatch(/before\/after/);
    for (const r of COACH_INTEGRATION.refused) expect(r).toBeTypeOf('string');
  });

  it('carries no coach context where there is no attribution', () => {
    expect(full().coachContext).toBeNull();
  });
});

describe('missing is never zero', () => {
  it('leaves an unestablished division null rather than defaulting it', () => {
    const p = competitivePackage({
      history: competitiveHistory({ rows: [season(2022, 10, 4, 5, null)], pools: pools('NCAA D2') }),
      structural: null,
    });
    expect(p.seasons[0].historicalDivision).toBeNull();
    expect(p.seasons[0].benchmark.available).toBe(false);
    expect(p.seasons[0].conferenceRecord).toBeNull();
    expect(p.seasons[0].conferenceMatches).toBeNull();
  });
});

describe('a false identity would show up as an impossible package', () => {
  it('never carries a division outside the four this product reports', () => {
    // The shape the Rochester defect took: a Division III programme with an
    // NAIA season, from a conference table that printed a bare shared name.
    const p = competitivePackage({
      history: competitiveHistory({ rows: FOUR.map((y) => season(y, 10, 4, 5, 'NCAA D3')), pools: pools('NCAA D3') }),
      structural: structuralOf(FOUR.map((y) => ({ season: y, conferenceId: 'uaa', conferenceName: 'University Athletic Association', historicalDivision: 'NCAA D3' }))),
    });
    for (const s of p.seasons) expect(['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA']).toContain(s.historicalDivision);
    expect(p.structuralFacts.some((f) => f.kind === 'DIVISION_CHANGE')).toBe(false);
  });

  it('produces no division-change fact from a single contaminated season', () => {
    // One NAIA season among three Division III ones is exactly what a false
    // identity looks like; if it ever happens again the fact must name both
    // seasons it comes from, and both must be on file.
    const rows = [
      { season: 2023, conferenceId: 'whac', conferenceName: 'Wolverine-Hoosier Athletic Conference', historicalDivision: 'NAIA' },
      { season: 2024, conferenceId: 'uaa', conferenceName: 'University Athletic Association', historicalDivision: 'NCAA D3' },
      { season: 2025, conferenceId: 'uaa', conferenceName: 'University Athletic Association', historicalDivision: 'NCAA D3' },
    ];
    const p = competitivePackage({
      history: competitiveHistory({ rows: [2023, 2024, 2025].map((y) => season(y, 10, 4, 5, y === 2023 ? 'NAIA' : 'NCAA D3')), pools: pools('NCAA D3') }),
      structural: structuralOf(rows),
    });
    const change = p.structuralFacts.find((f) => f.kind === 'DIVISION_CHANGE');
    expect(change.seasons).toEqual([2023, 2024]);
    const shown = new Set(p.seasons.map((s) => s.season));
    for (const y of change.seasons) expect(shown.has(y)).toBe(true);
  });
});
