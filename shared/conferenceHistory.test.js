/**
 * Division derivation, conference records, and the sequence they make.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveConferenceDivision, parseConferenceRecord, structuralHistory,
  conferenceRecordRow, reconcileMembership, coverageClass,
  DIVISION_PROVENANCE, COLLECTION_STATUS, MEMBERSHIP_PROVENANCE, MEMBERSHIP_PRIORITY,
  COVERAGE_CLASS,
} from './conferenceHistory.js';

describe('a conference’s division', () => {
  it('is EXPLICIT_OFFICIAL when the conference’s own page states it', () => {
    const r = deriveConferenceDivision({
      statements: [{ division: 'NAIA', kind: 'CONFERENCE_PAGE' }],
      memberDivisions: { NAIA: 12 },
    });
    expect(r).toMatchObject({ division: 'NAIA', provenance: DIVISION_PROVENANCE.EXPLICIT_OFFICIAL });
  });

  it('is DERIVED when a reference states it and the membership agrees', () => {
    const r = deriveConferenceDivision({
      statements: [{ division: 'NCAA D2', kind: 'REFERENCE_INFOBOX' }],
      memberDivisions: { 'NCAA D2': 17, 'NCAA D1': 1 },
    });
    expect(r).toMatchObject({ division: 'NCAA D2', provenance: DIVISION_PROVENANCE.DERIVED_FROM_OFFICIAL_MEMBERSHIP, corroboratedBy: 'membership' });
  });

  it('one member moving out does not make the conference ambiguous', () => {
    // Mercyhurst leaving the PSAC for Division I does not stop the PSAC being
    // Division II. A strict majority carries it; unanimity would not.
    const r = deriveConferenceDivision({
      statements: [{ division: 'NCAA D2', kind: 'REFERENCE_INFOBOX' }],
      memberDivisions: { 'NCAA D2': 16, 'NCAA D1': 1 },
    });
    expect(r.division).toBe('NCAA D2');
  });

  it('is CONFLICTING when a statement and the membership disagree', () => {
    const r = deriveConferenceDivision({
      statements: [{ division: 'NCAA D1', kind: 'REFERENCE_INFOBOX' }],
      memberDivisions: { 'NCAA D3': 7 },
    });
    expect(r.division).toBeNull();
    expect(r.provenance).toBe(DIVISION_PROVENANCE.CONFLICTING);
  });

  it('is not contradicted by members who left the division after the season', () => {
    // The Great Southwest Athletic Conference is NAIA and lost half its 2022
    // membership to Division II by 2024. A majority test would refuse the
    // conference for a move its members made two seasons later.
    const r = deriveConferenceDivision({
      statements: [{ division: 'NAIA', kind: 'REFERENCE_INFOBOX' }],
      memberDivisions: { 'NCAA D2': 6, NAIA: 4 },
    });
    expect(r.division).toBe('NAIA');
  });

  it('is CONFLICTING when two statements disagree', () => {
    const r = deriveConferenceDivision({
      statements: [{ division: 'NCAA D1', kind: 'CONFERENCE_PAGE' }, { division: 'NCAA D2', kind: 'REFERENCE_INFOBOX' }],
      memberDivisions: {},
    });
    expect(r.provenance).toBe(DIVISION_PROVENANCE.CONFLICTING);
  });

  it('takes membership alone only when it is unanimous', () => {
    expect(deriveConferenceDivision({ statements: [], memberDivisions: { NAIA: 12 } }).division).toBe('NAIA');
    // A majority with no second source is a guess, and it is refused.
    expect(deriveConferenceDivision({ statements: [], memberDivisions: { NAIA: 12, 'NCAA D2': 1 } }).division).toBeNull();
    expect(deriveConferenceDivision({ statements: [], memberDivisions: {} }).provenance).toBe(DIVISION_PROVENANCE.UNKNOWN);
  });

  it('never returns a division outside the four this product reports', () => {
    expect(deriveConferenceDivision({ statements: [{ division: 'NJCAA', kind: 'REFERENCE_INFOBOX' }], memberDivisions: {} }).division).toBeNull();
  });
});

describe('a conference record', () => {
  it('reads W-L-D, the way every source publishes it', () => {
    expect(parseConferenceRecord('6-0-1')).toMatchObject({ wins: 6, losses: 0, draws: 1, matches: 7 });
  });

  it('reads a two-part record as having no draws, not unknown draws', () => {
    expect(parseConferenceRecord('10-0')).toMatchObject({ wins: 10, losses: 0, draws: 0, record: '10-0-0' });
  });

  it('refuses a record that contradicts the matches the source printed', () => {
    expect(parseConferenceRecord('6-0-1', { matchesPlayed: 7 }).ok).toBe(true);
    expect(parseConferenceRecord('6-0-1', { matchesPlayed: 9 }).ok).toBe(false);
  });

  it('refuses anything that is not a record', () => {
    for (const s of ['', null, '—', 'T1', '.750', '6–0–1']) expect(parseConferenceRecord(s).ok).toBe(false);
  });

  it('states the conference beside the record, never a comparison across conferences', () => {
    const row = conferenceRecordRow({ season: 2022, record: '10-0', conferenceName: 'PSAC', conferenceSize: 18 });
    expect(row).toMatchObject({ season: 2022, available: true, record: '10-0-0', conferenceName: 'PSAC', conferenceSize: 18 });
  });
});

describe('the sequence', () => {
  const rows = [
    { season: 2022, conferenceId: 'psac', conferenceName: 'PSAC', historicalDivision: 'NCAA D2' },
    { season: 2023, conferenceId: 'psac', conferenceName: 'PSAC', historicalDivision: 'NCAA D2' },
    { season: 2024, conferenceId: 'nec', conferenceName: 'NEC', historicalDivision: 'NCAA D1' },
    { season: 2025, conferenceId: 'nec', conferenceName: 'NEC', historicalDivision: 'NCAA D1' },
  ];

  it('records a structural break rather than smoothing it', () => {
    const h = structuralHistory(rows);
    expect(h.changes).toEqual([
      { kind: 'CONFERENCE', season: 2024, fromSeason: 2023, from: 'PSAC', to: 'NEC' },
      { kind: 'DIVISION', season: 2024, fromSeason: 2023, from: 'NCAA D2', to: 'NCAA D1' },
    ]);
    expect(h.stableConference).toBeNull();
    expect(h.stableDivision).toBeNull();
    expect(h.movedDivision).toBe(true);
  });

  it('reports a stable conference only when every season on file agrees', () => {
    const h = structuralHistory(rows.slice(0, 2));
    expect(h.stableConference).toBe('PSAC');
    expect(h.knownSeasons).toEqual([2022, 2023]);
  });

  it('never invents a change across a gap it cannot see', () => {
    const h = structuralHistory([rows[0], rows[3]]);
    // 2022 PSAC then 2025 NEC is two changes' worth of ground with two seasons
    // between them missing; it is reported as the one transition observed, and
    // `fromSeason` names the season it was observed FROM rather than 2024.
    const div = h.changes.filter((c) => c.kind === 'DIVISION');
    expect(div).toHaveLength(1);
    expect(div[0]).toMatchObject({ season: 2025, fromSeason: 2022 });
    expect(h.divisionKnownSeasons).toEqual([2022, 2025]);
  });

  it('carries a season with no division without claiming one', () => {
    const h = structuralHistory([{ season: 2022, conferenceId: 'psac', conferenceName: 'PSAC', historicalDivision: null }]);
    expect(h.divisions).toEqual([]);
    expect(h.divisionKnownSeasons).toEqual([]);
  });
});

describe('refusal semantics', () => {
  it('names every way collection can fail, separately', () => {
    for (const k of ['SOURCE_NOT_FOUND', 'SEASON_NOT_AVAILABLE', 'SEASON_NOT_CONFIRMED', 'PARSE_FAILED',
      'CHALLENGED', 'TRANSPORT_FAILED', 'IDENTITY_UNRESOLVED', 'MEMBERSHIP_UNRESOLVED',
      'CONFERENCE_UNKNOWN', 'DIVISION_UNKNOWN', 'CONFERENCE_DIVISION_CONFLICT']) {
      expect(COLLECTION_STATUS[k]).toBe(k);
    }
  });
});

describe('the membership provenance hierarchy', () => {
  it('ranks the five accepted sources by how specific they are to the season', () => {
    expect(MEMBERSHIP_PRIORITY[0]).toBe(MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_STANDINGS);
    expect(MEMBERSHIP_PRIORITY[1]).toBe(MEMBERSHIP_PROVENANCE.OFFICIAL_PROGRAMME_SOURCE);
    expect(MEMBERSHIP_PRIORITY).toHaveLength(5);
    // Research evidence is not in the set at all.
    expect(Object.values(MEMBERSHIP_PROVENANCE).join(' ')).not.toMatch(/wiki/i);
  });

  it('takes the most specific source where several agree, and counts the rest', () => {
    const r = reconcileMembership([
      { conferenceId: 'psac', membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_NCAA_MEMBERSHIP },
      { conferenceId: 'psac', membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_STANDINGS },
    ]);
    expect(r.conferenceId).toBe('psac');
    expect(r.chosen.membershipProvenance).toBe(MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_STANDINGS);
    expect(r.corroborations).toBe(1);
  });
});

describe('when accepted official sources disagree', () => {
  it('refuses by default and keeps both records', () => {
    const r = reconcileMembership([
      { conferenceId: 'wcc', membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_STANDINGS },
      { conferenceId: 'pac-12', membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_NCAA_MEMBERSHIP },
    ]);
    expect(r.conferenceId).toBeNull();
    expect(r.status).toBe(COLLECTION_STATUS.CONFLICTING_OFFICIAL_SOURCES);
    expect(r.claims).toHaveLength(2);
    expect(r.reason).toMatch(/wcc/);
    expect(r.reason).toMatch(/pac-12/);
  });

  it('lets the programme’s own page settle a dispute between two conference tables', () => {
    // Two conferences printed the same short name for two institutions; the
    // programme itself says which competition it played in.
    const r = reconcileMembership([
      { conferenceId: 'big-east', membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_STANDINGS },
      { conferenceId: 'rrac', membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_STANDINGS },
      { conferenceId: 'big-east', membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_PROGRAMME_SOURCE },
    ]);
    expect(r.conferenceId).toBe('big-east');
    expect(r.resolvedBy).toBe('OFFICIAL_PROGRAMME_SOURCE_AGREEMENT');
  });

  it('does not let a newer or more general source resolve anything', () => {
    // A 2026 directory is not a better witness to 2022 than a 2022 table.
    const r = reconcileMembership([
      { conferenceId: 'psac', membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_STANDINGS },
      { conferenceId: 'nec', membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_NCAA_MEMBERSHIP },
    ]);
    expect(r.status).toBe(COLLECTION_STATUS.CONFLICTING_OFFICIAL_SOURCES);
  });
});

describe('membership truth and conference-record truth are separate', () => {
  it('classifies a season by what is known about each', () => {
    expect(coverageClass({ conferenceId: 'psac', seasonConfirmed: true, conferenceWins: 10 }))
      .toBe(COVERAGE_CLASS.MEMBERSHIP_KNOWN_RECORD_KNOWN);
    expect(coverageClass({ conferenceId: 'psac', seasonConfirmed: true, conferenceWins: null }))
      .toBe(COVERAGE_CLASS.MEMBERSHIP_KNOWN_RECORD_UNKNOWN);
    expect(coverageClass({ conferenceId: null, seasonConfirmed: true, conferenceWins: 10 }))
      .toBe(COVERAGE_CLASS.MEMBERSHIP_UNKNOWN);
    // A season whose source did not name its own season is not membership.
    expect(coverageClass({ conferenceId: 'psac', seasonConfirmed: false, conferenceWins: 10 }))
      .toBe(COVERAGE_CLASS.MEMBERSHIP_UNKNOWN);
  });
});
