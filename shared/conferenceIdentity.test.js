/**
 * Conference identity, and the two ways it goes wrong.
 *
 * A conference decides a season's division here, so a spelling that resolves to
 * the wrong conference benchmarks a programme against the wrong universe. Phase
 * 12B.1 produced exactly that by stripping the word "association", merging the
 * Southern Conference (Division I) with the Southern Athletic Association
 * (Division III).
 */
import { describe, it, expect } from 'vitest';
import {
  CONFERENCES, resolveConference, normaliseConferenceKey, aliasCollisions,
  conferenceById, CONFERENCE_UNRESOLVED, CONFERENCE_METHOD,
} from './conferenceIdentity.js';

describe('the 12B.1 regression', () => {
  it('keeps the Southern Conference and the Southern Athletic Association apart', () => {
    expect(resolveConference('Southern Conference').id).toBe('socon');
    expect(resolveConference('Southern Athletic Association').id).toBe('saa');
    expect(normaliseConferenceKey('Southern Athletic Association')).toContain('association');
  });

  it('keeps the two MIAAs apart', () => {
    expect(resolveConference('Mid-America Intercollegiate Athletics Association').id).toBe('miaa-d2');
    expect(resolveConference('Michigan Intercollegiate Athletic Association').id).toBe('miaa-d3');
  });

  it('keeps the two GNACs apart, and refuses the bare abbreviation for the D3 one', () => {
    expect(resolveConference('Great Northwest Athletic Conference').id).toBe('gnac');
    expect(resolveConference('Great Northeast Athletic Conference').id).toBe('gnac-d3');
  });
});

describe('a spelling that means two conferences', () => {
  it('resolves MAC only inside a scope', () => {
    expect(resolveConference('MAC', { division: 'NCAA D1' }).id).toBe('mac');
    expect(resolveConference('MAC', { division: 'NCAA D1' }).method).toBe(CONFERENCE_METHOD.SCOPED_ALIAS);
    expect(resolveConference('MAC').id).toBeNull();
    expect(resolveConference('MAC', { division: 'NCAA D3' }).id).toBeNull();
  });

  it('has no unscoped alias claimed by two conferences', () => {
    expect(aliasCollisions()).toEqual([]);
  });
});

describe('"Independent" is not a conference', () => {
  for (const s of ['Independent', 'NAIA Independent', 'Independents', 'None']) {
    it(`refuses ${JSON.stringify(s)} by name`, () => {
      expect(resolveConference(s).reason).toBe(CONFERENCE_UNRESOLVED.NOT_A_CONFERENCE);
    });
  }
});

describe('lifecycle', () => {
  it('records a merger without making the two predecessors each other', () => {
    expect(resolveConference('Commonwealth Coast Conference').id).toBe('ccc');
    expect(resolveConference('New England Collegiate Conference').id).toBe('necc');
    expect(conferenceById('ccc').mergedInto).toEqual({ id: 'cne', season: 2023 });
    expect(conferenceById('necc').mergedInto).toEqual({ id: 'cne', season: 2023 });
    expect(conferenceById('cne').formedFrom).toEqual(['ccc', 'necc']);
  });

  it('records a rename as one conference', () => {
    expect(resolveConference('American Athletic Conference').id).toBe('american');
    expect(resolveConference('American Conference').id).toBe('american');
    expect(resolveConference('Colonial Athletic Association').id).toBe('caa');
    expect(resolveConference('Coastal Athletic Association').id).toBe('caa');
  });

  it('never forwards a dissolved conference to its successor', () => {
    // Every Heartland programme we hold is in the Lone Star Conference now.
    // Mapping the string that way would infer 2022 membership from a 2019 fact.
    expect(resolveConference('Heartland').id).toBe('heartland-d2');
    expect(conferenceById('heartland-d2').dissolved).toBe(2019);
    expect(resolveConference('Heartland').id).not.toBe('lsc');
  });
});

describe('an unknown spelling is refused, never guessed', () => {
  for (const s of ['NIAC', 'ECAC', 'Not A Real Conference']) {
    it(`refuses ${JSON.stringify(s)}`, () => {
      expect(resolveConference(s).reason).toBe(CONFERENCE_UNRESOLVED.UNKNOWN);
    });
  }
  it('refuses an empty spelling', () => {
    expect(resolveConference('').reason).toBe(CONFERENCE_UNRESOLVED.EMPTY);
    expect(resolveConference(null).reason).toBe(CONFERENCE_UNRESOLVED.EMPTY);
  });
});

describe('the table itself', () => {
  it('has a unique id per conference', () => {
    const ids = CONFERENCES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds no division: a conference’s division is evidence, not a property of its name', () => {
    for (const c of CONFERENCES) expect(c.division).toBeUndefined();
  });
});
