/**
 * The importer's refusals.
 *
 * The artefact is written outside this repository by a crawler, so the failure
 * modes worth testing are the ones a crawl produces: a file that is not there,
 * a table that does not name its own season, a member two conferences both
 * claim, and a record column whose order varies by site.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '../db/client.js';
import { readArtefact, build, pickConferenceRecord, run, QUARANTINE, ARTEFACT } from './importConferenceSeasons.js';
import { buildResolvers } from '../lib/institutionQueries.js';
import { DIVISION_PROVENANCE } from '../../shared/conferenceHistory.js';

let dir;
const college = (id, name, sport, division, unitid, state) => db.prepare(
  `INSERT INTO colleges (id, created_date, updated_date, name, sport, division, unitid, state)
   VALUES (?, 'x', 'x', ?, ?, ?, ?, ?)`).run(id, name, sport, division, unitid, state);

const season = (o = {}) => ({
  status: 'OK', url: 'https://psacsports.org/standings.aspx?standings=1',
  platform: 'SIDEARM_STANDINGS', title: '2022 Men’s Soccer Standings - Pennsylvania State Athletic Conference',
  seasonConfirmed: true, sportConfirmed: true, groups: [],
  members: [{ raw: 'Mercyhurst', printed: 'Mercyhurst', row: 1, conferenceRecord: '10-0', overallRecord: '19-1-1', conferenceMatches: null }],
  ...o,
});
const artefact = (conferences) => {
  const a = { collectedAt: 'x', seasons: [2022, 2023, 2024, 2025], conferences };
  fs.writeFileSync(path.join(dir, ARTEFACT), JSON.stringify(a));
  return a;
};
const psac = (seasons) => ({
  conferenceId: 'psac', conferenceName: 'Pennsylvania State Athletic Conference', sport: 'mens-soccer',
  host: 'psacsports.org', divisionStatements: [{ division: 'NCAA D2', kind: 'REFERENCE_INFOBOX', source: 'x' }],
  seasons,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  db.exec('DELETE FROM colleges; DELETE FROM institution_aliases; DELETE FROM programme_seasons;'
    + 'DELETE FROM programme_conference_seasons; DELETE FROM conference_seasons; DELETE FROM conference_membership_quarantine;');
  college('mercy-m', 'Mercyhurst', 'mens-soccer', 'NCAA D1', 213987, 'PA');
  // Two members that have not moved, so the conference's own membership can
  // establish its division while Mercyhurst's current division disagrees.
  college('slip-m', 'Slippery Rock', 'mens-soccer', 'NCAA D2', 216010, 'PA');
  college('gann-m', 'Gannon', 'mens-soccer', 'NCAA D2', 212832, 'PA');
});

const withPeers = (members) => [...members,
  { raw: 'Slippery Rock', printed: 'Slippery Rock', row: 90, conferenceRecord: '6-4' },
  { raw: 'Gannon', printed: 'Gannon', row: 91, conferenceRecord: '5-5' }];

describe('reading the artefact fails closed', () => {
  it('refuses an absent file', () => {
    expect(() => readArtefact(dir)).toThrow(/not found/);
  });

  it('refuses an empty one — it looks exactly like a universe with no conferences', () => {
    fs.writeFileSync(path.join(dir, ARTEFACT), JSON.stringify({ conferences: [] }));
    expect(() => readArtefact(dir)).toThrow(/empty/);
  });

  it('refuses a malformed entry rather than skipping it', () => {
    fs.writeFileSync(path.join(dir, ARTEFACT), JSON.stringify({ conferences: [{ conferenceName: 'x' }] }));
    expect(() => readArtefact(dir)).toThrow(/malformed/);
  });
});

describe('what gets written', () => {
  const collegeDivision = { 'mercy-m': 'NCAA D1' };

  it('files a member under the conference’s own division, not its current one', () => {
    const a = artefact([psac({ 2022: season({ members: withPeers(season().members) }) })]);
    const { programmeRows } = build({ artefact: a, resolvers: buildResolvers(), collegeDivision: { ...collegeDivision, 'slip-m': 'NCAA D2', 'gann-m': 'NCAA D2' }, now: 'x' });
    expect(programmeRows).toHaveLength(3);
    // Mercyhurst is Division I today and played 2022 in Division II.
    expect(programmeRows.find((r) => r.college_id === 'mercy-m')).toMatchObject({
      college_id: 'mercy-m', season: 2022, historical_division: 'NCAA D2',
      conference_id: 'psac', conference_wins: 10, conference_losses: 0, conference_draws: 0,
    });
  });

  it('carries a season the source did not confirm as evidence, flagged', () => {
    const a = artefact([psac({ 2022: season({ seasonConfirmed: false, title: 'Lone Star Conference' }) })]);
    const { programmeRows } = build({ artefact: a, resolvers: buildResolvers(), collegeDivision, now: 'x' });
    expect(programmeRows[0].season_confirmed).toBe(0);
    expect(programmeRows[0].confidence).toBe('CORROBORATED');
  });

  it('records the conference size the conference published, not the number we resolved', () => {
    const a = artefact([psac({
      2022: season({ members: [
        { raw: 'Mercyhurst', printed: 'Mercyhurst', row: 1, conferenceRecord: '10-0' },
        { raw: 'A School We Cannot Place', printed: 'A School We Cannot Place', row: 2, conferenceRecord: '0-10' },
      ] }),
    })]);
    const { programmeRows, conferenceRows } = build({ artefact: a, resolvers: buildResolvers(), collegeDivision, now: 'x' });
    expect(programmeRows[0].conference_size).toBe(2);
    expect(conferenceRows[0]).toMatchObject({ member_count: 2, resolved_member_count: 1 });
  });
});

describe('a member two conferences both claim', () => {
  it('is refused both times when nothing separates them', () => {
    const a = artefact([
      psac({ 2022: season() }),
      { ...psac({ 2022: season({ url: 'https://necsports.com/x', title: '2022 Men’s Soccer Standings - Northeast Conference' }) }), conferenceId: 'nec', conferenceName: 'Northeast Conference' },
    ]);
    const { programmeRows, quarantine } = build({ artefact: a, resolvers: buildResolvers(), collegeDivision: { 'mercy-m': 'NCAA D1' }, now: 'x' });
    expect(programmeRows).toHaveLength(0);
    expect(quarantine.filter((q) => q.reason === QUARANTINE.TWO_CONFERENCES_ONE_SEASON)).toHaveLength(2);
  });

  it('keeps the one whose source confirmed its own season', () => {
    const a = artefact([
      psac({ 2022: season() }),
      { ...psac({ 2022: season({ url: 'https://necsports.com/x', seasonConfirmed: false, title: 'Northeast Conference' }) }), conferenceId: 'nec', conferenceName: 'Northeast Conference' },
    ]);
    const { programmeRows } = build({ artefact: a, resolvers: buildResolvers(), collegeDivision: { 'mercy-m': 'NCAA D1' }, now: 'x' });
    expect(programmeRows).toHaveLength(1);
    expect(programmeRows[0].conference_id).toBe('psac');
  });
});

describe('one URL is one table, whatever it was fetched under', () => {
  it('does not let a shared standings page claim every member twice', () => {
    // gomacsports.com serves the MAC's Commonwealth and Freedom divisions from
    // one page, and cnesports.org serves the CNE and the conference it replaced.
    const shared = season({ url: 'https://gomacsports.com/standings.aspx?standings=224' });
    const a = artefact([
      { ...psac({ 2022: shared }), conferenceId: 'mac-commonwealth', conferenceName: 'MAC Commonwealth' },
      { ...psac({ 2022: shared }), conferenceId: 'mac-freedom', conferenceName: 'MAC Freedom' },
    ]);
    const { programmeRows, duplicateSources } = build({ artefact: a, resolvers: buildResolvers(), collegeDivision: { 'mercy-m': 'NCAA D1' }, now: 'x' });
    expect(programmeRows).toHaveLength(1);
    expect(duplicateSources).toHaveLength(1);
  });
});

describe('which record column is the conference one', () => {
  const overall = { wins: 19, losses: 1, draws: 1 };

  it('identifies the conference record by eliminating the overall record', () => {
    expect(pickConferenceRecord({ confRecord: '19-1-1', overallRecord: '10-0-0' }, overall))
      .toEqual({ record: '10-0-0', method: 'OVERALL_RECORD_IDENTIFIED' });
    expect(pickConferenceRecord({ confRecord: '10-0-0', overallRecord: '19-1-1' }, overall))
      .toEqual({ record: '10-0-0', method: 'OVERALL_RECORD_IDENTIFIED' });
  });

  it('falls back to the site’s header order when neither record is the overall one', () => {
    expect(pickConferenceRecord({ confRecord: '5-2-1', overallRecord: '8-6-2', recordColumnOrder: 'CONFERENCE_FIRST' }, overall))
      .toEqual({ record: '5-2-1', method: 'CONFERENCE_FIRST' });
  });

  it('takes the first record where nothing at all settles it', () => {
    expect(pickConferenceRecord({ confRecord: '5-2-1', overallRecord: null }, null))
      .toEqual({ record: '5-2-1', method: 'FIRST_RECORD_COLUMN' });
  });
});

describe('a name no programme claims is quarantined, never dropped', () => {
  it('keeps the row and the reason', () => {
    const a = artefact([psac({ 2022: season({ members: [{ raw: 'Limestone', printed: 'Limestone', row: 1, conferenceRecord: '2-8' }] }) })]);
    const { programmeRows, quarantine } = build({ artefact: a, resolvers: buildResolvers(), collegeDivision: {}, now: 'x' });
    expect(programmeRows).toHaveLength(0);
    expect(quarantine[0]).toMatchObject({ member_raw: 'Limestone', conference_id: 'psac', season: 2022, conference_record: '2-8' });
  });
});

describe('a conference whose division nothing establishes', () => {
  it('writes the membership and leaves the division null', () => {
    const a = artefact([{ ...psac({ 2022: season() }), divisionStatements: [] }]);
    const { programmeRows } = build({ artefact: a, resolvers: buildResolvers(), collegeDivision: { 'mercy-m': 'NCAA D1' }, now: 'x' });
    // One member, whose current division is D1 — unanimous, so it derives D1.
    expect(programmeRows[0].division_provenance).toBe(DIVISION_PROVENANCE.DERIVED_FROM_OFFICIAL_MEMBERSHIP);
    const b = artefact([{ ...psac({ 2022: season() }), divisionStatements: [{ division: 'NCAA D2', kind: 'REFERENCE_INFOBOX' }] }]);
    const r2 = build({ artefact: b, resolvers: buildResolvers(), collegeDivision: { 'mercy-m': 'NJCAA' }, now: 'x' });
    expect(r2.programmeRows[0].historical_division).toBe('NCAA D2');
  });
});

describe('applying', () => {
  it('replaces the tables rather than accumulating', () => {
    artefact([psac({ 2022: season() })]);
    const quiet = () => {};
    run({ apply: true, dir, log: quiet });
    run({ apply: true, dir, log: quiet });
    expect(db.prepare('SELECT COUNT(*) n FROM programme_conference_seasons').get().n).toBe(1);
  });
});
