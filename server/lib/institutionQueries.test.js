/**
 * Resolving a name a conference printed to one of OUR programmes.
 *
 * The hard case is not a spelling; it is that UNITID identifies an INSTITUTION
 * and PennWest California, PennWest Clarion and PennWest Edinboro are one
 * institution fielding three separate soccer programmes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import { buildResolvers, PROGRAMME_METHOD, PROGRAMME_UNRESOLVED } from './institutionQueries.js';

const college = (id, name, sport, division, unitid, state) => db.prepare(
  `INSERT INTO colleges (id, created_date, updated_date, name, sport, division, unitid, state)
   VALUES (?, 'x', 'x', ?, ?, ?, ?, ?)`).run(id, name, sport, division, unitid, state);

beforeEach(() => {
  db.exec('DELETE FROM colleges; DELETE FROM institution_aliases;');
  college('pw-cal-m', 'PennWest California', 'mens-soccer', 'NCAA D2', 498571, 'PA');
  college('pw-cla-w', 'PennWest Clarion', 'womens-soccer', 'NCAA D2', 498571, 'PA');
  college('pw-edi-w', 'PennWest Edinboro', 'womens-soccer', 'NCAA D2', 498571, 'PA');
  college('pw-cal-w', 'PennWest California', 'womens-soccer', 'NCAA D2', 498571, 'PA');
  college('cal-m', 'California', 'mens-soccer', 'NCAA D1', 110635, 'CA');
  college('truman-m', 'Truman State', 'mens-soccer', 'NCAA D2', 179539, 'MO');
  college('mercy-m', 'Mercyhurst', 'mens-soccer', 'NCAA D1', 213987, 'PA');
  db.prepare(`INSERT INTO institution_aliases (alias_key, alias_raw, unitid, alias_type, source, confidence, imported_at)
    VALUES ('california pa', 'California (Pa.)', 498571, 'HISTORICAL_NAME', 'test', 'CURATED', 'x')`).run();
});

describe('one institution, several programmes', () => {
  it('lets the printed name choose between campuses that share a UNITID', () => {
    const r = buildResolvers();
    expect(r.resolveProgramme('PennWest Edinboro', 'womens-soccer')).toMatchObject({ collegeId: 'pw-edi-w', method: PROGRAMME_METHOD.NAME_EXACT });
    expect(r.resolveProgramme('PennWest Clarion', 'womens-soccer').collegeId).toBe('pw-cla-w');
  });

  it('refuses when the institution resolves and the campus does not', () => {
    const r = buildResolvers();
    const hit = r.resolveProgramme('Pennsylvania Western University', 'womens-soccer');
    expect(hit.collegeId).toBeNull();
  });
});

describe('a state the source wrote is a veto', () => {
  it('does not file PennWest California under the University of California', () => {
    const r = buildResolvers();
    const hit = r.resolveProgramme('California (Pa.)', 'mens-soccer');
    expect(hit.collegeId).toBe('pw-cal-m');
    expect(hit.collegeId).not.toBe('cal-m');
  });

  it('reports the conflict rather than the nearest match', () => {
    const r = buildResolvers();
    expect(r.resolveProgramme('Truman State (Tex.)', 'mens-soccer').reason).toBe(PROGRAMME_UNRESOLVED.STATE_CONFLICT);
  });
});

describe('the sport is part of the question', () => {
  it('does not answer with a programme in the other sport', () => {
    const r = buildResolvers();
    expect(r.resolveProgramme('PennWest Edinboro', 'mens-soccer').collegeId).toBeNull();
    expect(r.resolveProgramme('Mercyhurst', 'womens-soccer').collegeId).toBeNull();
  });
});

describe('the rewriting ladder reaches our longer names', () => {
  it('resolves the short form a conference prints', () => {
    const r = buildResolvers();
    expect(r.resolveProgramme('Truman', 'mens-soccer').collegeId).toBe('truman-m');
    expect(r.resolveProgramme('Truman', 'mens-soccer').method).toBe(PROGRAMME_METHOD.NAME_VARIANT);
  });

  it('refuses a name nothing claims', () => {
    const r = buildResolvers();
    expect(r.resolveProgramme('Limestone', 'mens-soccer').collegeId).toBeNull();
  });
});

describe('the conference’s own membership beats a rewriting', () => {
  beforeEach(() => {
    db.exec('DELETE FROM conference_members_official;');
    db.prepare(`INSERT INTO conference_members_official
      (unitid, conference_id, conference_raw, division, name_official, source, imported_at)
      VALUES (NULL, 'centennial', 'Centennial Conference', 'NCAA D3', 'Washington College (Maryland)', 'test', 'x')`).run();
    db.prepare(`INSERT INTO conference_members_official
      (unitid, conference_id, conference_raw, division, name_official, source, imported_at)
      VALUES (213987, 'psac', 'PSAC', 'NCAA D2', 'Mercyhurst University', 'test', 'x')`).run();
  });

  it('refuses a rewriting the conference’s roster contradicts', () => {
    college('wash-m', 'Washington', 'mens-soccer', 'NCAA D1', 236948, 'WA');
    const r = buildResolvers();
    // "Washington College #1 seed" strips to "Washington College", which the
    // College-stripping rule reduces to "Washington" — a different university.
    const hit = r.resolveProgramme('Washington College #1 seed', 'mens-soccer', { conferenceId: 'centennial' });
    expect(hit.collegeId).toBeNull();
    expect(hit.reason).toBe(PROGRAMME_UNRESOLVED.OFFICIAL_ROSTER_CONTRADICTS);
    expect(hit.officialMember).toBe('Washington College (Maryland)');
  });

  it('never questions an exact name, so a genuine mover survives', () => {
    const r = buildResolvers();
    // Mercyhurst is Division I today and the PSAC's 2022 table is where its
    // Division II seasons come from.
    expect(r.resolveProgramme('Mercyhurst', 'mens-soccer', { conferenceId: 'psac' }).collegeId).toBe('mercy-m');
  });

  it('is inert where the association publishes no roster for that conference', () => {
    college('rmac-m', 'Some Programme', 'mens-soccer', 'NCAA D2', 900001, 'CO');
    const r = buildResolvers();
    // An NAIA conference has no NCAA roster; silence is not contradiction.
    expect(r.resolveProgramme('Some Programme', 'mens-soccer', { conferenceId: 'haac' }).collegeId).toBe('rmac-m');
  });
});

describe('a conference’s own spelling for its own member', () => {
  beforeEach(() => {
    db.exec('DELETE FROM institution_aliases;');
    db.prepare(`INSERT INTO institution_aliases
      (alias_key, alias_raw, unitid, conference_scope, alias_type, source, confidence, imported_at)
      VALUES ('rochester', 'Rochester', 170967, 'whac', 'HISTORICAL_NAME', 'test', 'CORROBORATED', 'x')`).run();
  });

  it('resolves the scoped spelling inside that conference only', () => {
    college('rc-w', 'Rochester Christian University', 'womens-soccer', 'NAIA', 170967, 'MI');
    college('ur-w', 'University of Rochester', 'womens-soccer', 'NCAA D3', 195030, 'NY');
    const r = buildResolvers();
    // The Wolverine-Hoosier prints "Rochester" and means Rochester Christian…
    expect(r.resolveProgramme('Rochester', 'womens-soccer', { conferenceId: 'whac' }))
      .toMatchObject({ collegeId: 'rc-w', method: PROGRAMME_METHOD.CONFERENCE_SCOPED_ALIAS });
    // …and the University Athletic Association prints it and means the other one.
    expect(r.resolveProgramme('Rochester', 'womens-soccer', { conferenceId: 'uaa' }).collegeId).toBe('ur-w');
    // With no conference in hand, the scope cannot apply.
    expect(r.resolveProgramme('Rochester', 'womens-soccer').collegeId).toBe('ur-w');
  });

  it('says NO_PROGRAMME_IN_SPORT where the named institution has no team here', () => {
    college('ur-w', 'University of Rochester', 'womens-soccer', 'NCAA D3', 195030, 'NY');
    const r = buildResolvers();
    // The conference has told us who it means; we simply do not model them.
    const hit = r.resolveProgramme('Rochester', 'womens-soccer', { conferenceId: 'whac' });
    expect(hit.collegeId).toBeNull();
    expect(hit.reason).toBe(PROGRAMME_UNRESOLVED.NO_PROGRAMME_IN_SPORT);
    expect(hit.unitid).toBe(170967);
  });
});

describe('a standings table is a membership table', () => {
  it('never lets a two-year college take a four-year college’s row', () => {
    college('okcc-m', 'Oklahoma City Community', 'mens-soccer', 'NJCAA', 207449, 'OK');
    const r = buildResolvers();
    // The Sooner Athletic Conference is NAIA; a junior college cannot be in it.
    const hit = r.resolveProgramme('Oklahoma City', 'mens-soccer', { conferenceId: 'sooner', membersOnly: true });
    expect(hit.collegeId).toBeNull();
    expect(hit.reason).toBe(PROGRAMME_UNRESOLVED.NO_PROGRAMME_IN_SPORT);
    expect(hit.note).toMatch(/NJCAA/);
    // Without the flag the same call resolves, so this is a caller's constraint
    // and not a change to what the name means.
    expect(r.resolveProgramme('Oklahoma City', 'mens-soccer', { conferenceId: 'sooner' }).collegeId).toBe('okcc-m');
  });

  it('prefers the report-universe programme where both match', () => {
    college('okcc-m', 'Oklahoma City Community', 'mens-soccer', 'NJCAA', 207449, 'OK');
    college('okcu-m', 'Oklahoma City', 'mens-soccer', 'NAIA', 207458, 'OK');
    const r = buildResolvers();
    expect(r.resolveProgramme('Oklahoma City', 'mens-soccer', { conferenceId: 'sooner', membersOnly: true }).collegeId)
      .toBe('okcu-m');
  });

  it('does not reject a programme that crossed an association boundary', () => {
    // The rule is about which association can be a MEMBER, never about whether a
    // programme's current division matches the season's.
    college('pp-m', 'Point Park', 'mens-soccer', 'NCAA D2', 211440, 'PA');
    const r = buildResolvers();
    expect(r.resolveProgramme('Point Park University', 'mens-soccer', { conferenceId: 'rsc', membersOnly: true }).collegeId)
      .toBe('pp-m');
  });
});
