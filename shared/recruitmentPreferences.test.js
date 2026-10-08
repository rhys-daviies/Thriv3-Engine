import { describe, it, expect } from 'vitest';
import {
  REGIONS, REGION_KEYS, STATE_CODES, regionOfState, institutionTypeOfControl,
  readList, preferenceListError, preferredStatesOf, recruitmentPreferencesOf,
  preferenceChecks, CHECK, CHECK_STATUS,
} from './recruitmentPreferences.js';

describe('regions', () => {
  it('partition 50 states plus DC with no state in two regions', () => {
    const all = REGION_KEYS.flatMap((r) => REGIONS[r].states);
    expect(all).toHaveLength(51);
    expect(new Set(all).size).toBe(51);
    expect(STATE_CODES).toHaveLength(51);
    expect(regionOfState('ny')).toBe('NORTHEAST');
    expect(regionOfState('PR')).toBeNull();
  });
});

describe('reading stored lists', () => {
  it('accepts an array, a JSON string, or nothing - and guesses at nothing else', () => {
    expect(readList(['A'])).toEqual(['A']);
    expect(readList('["A"]')).toEqual(['A']);
    expect(readList(null)).toEqual([]);
    expect(readList('not json')).toEqual([]);
    expect(readList('{"a":1}')).toEqual([]);
  });

  it('expands regions into states and merges individually chosen states', () => {
    expect(preferredStatesOf({ preferred_states: ['tx'], preferred_regions: '["NORTHEAST"]' }))
      .toEqual(['CT', 'MA', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'TX', 'VT']);
  });

  it('is null when nothing was stated, so the matcher sees "no preference", not "nowhere"', () => {
    expect(preferredStatesOf({})).toBeNull();
    expect(preferredStatesOf({ preferred_states: '[]', preferred_regions: null })).toBeNull();
  });
});

describe('validation', () => {
  it('refuses an unknown state, region or institution type by name', () => {
    expect(preferenceListError({ preferred_states: ['TX', 'XX'] })).toMatch(/unknown state code: XX/);
    expect(preferenceListError({ preferred_regions: ['PACIFIC'] })).toMatch(/unknown region: PACIFIC/);
    expect(preferenceListError({ preferred_institution_types: ['CHARTER'] })).toMatch(/institution type: CHARTER/);
    expect(preferenceListError({ preferred_states: 'TX' })).toMatch(/must be a list/);
    expect(preferenceListError({ preferred_states: 5 })).toMatch(/must be a list/);
  });

  it('accepts valid lists, empty lists and fields not in the patch', () => {
    expect(preferenceListError({ preferred_states: ['tx'], preferred_regions: '["WEST"]', preferred_institution_types: [] })).toBeNull();
    expect(preferenceListError({ preferred_states: null })).toBeNull();
    expect(preferenceListError({ full_name: 'x' })).toBeNull();
  });
});

describe('preference checks', () => {
  const prefs = recruitmentPreferencesOf({
    preferred_divisions: '["NCAA D1","NCAA D2"]', preferred_conferences: [],
    preferred_regions: ['WEST'], preferred_institution_types: ['PRIVATE_NONPROFIT'], academic_minimum: 6,
  });

  it('reports only what the athlete stated', () => {
    const checks = preferenceChecks(prefs, { division: 'NCAA D1', state: 'CA', control: 2, academic_rating: 7 });
    expect(checks.map((c) => c.check)).toEqual([CHECK.DIVISION, CHECK.LOCATION, CHECK.INSTITUTION_TYPE, CHECK.ACADEMIC_MINIMUM]);
    expect(checks.every((c) => c.status === CHECK_STATUS.INSIDE)).toBe(true);
    expect(preferenceChecks(recruitmentPreferencesOf({}), { division: 'NCAA D1' })).toEqual([]);
  });

  it('says OUTSIDE when the programme is outside, and marks only location as ranked', () => {
    const checks = preferenceChecks(prefs, { division: 'NAIA', state: 'NY', control: 1, academic_rating: 4 });
    expect(checks.map((c) => c.status)).toEqual(['OUTSIDE', 'OUTSIDE', 'OUTSIDE', 'OUTSIDE']);
    expect(checks.filter((c) => c.ranked).map((c) => c.check)).toEqual([CHECK.LOCATION]);
  });

  it('never turns missing programme data into a match or a miss', () => {
    const checks = preferenceChecks(prefs, { division: null, state: null, control: null, academic_rating: null });
    expect(checks.map((c) => c.status)).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  });

  it('maps Scorecard control codes and leaves an absent code unknown', () => {
    expect([1, 2, 3, null, 9].map(institutionTypeOfControl)).toEqual(['PUBLIC', 'PRIVATE_NONPROFIT', 'PRIVATE_FOR_PROFIT', null, null]);
  });
});

describe('normalisation of what was stated', () => {
  it('trims, upper-cases and de-duplicates, and drops what is not a state', () => {
    expect(preferredStatesOf({ preferred_states: [' tx ', 'TX', 'ny', 'PR', ''], preferred_regions: ['west', 'Atlantis'] }))
      .toEqual(['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NM', 'NV', 'NY', 'OR', 'TX', 'UT', 'WA', 'WY']);
  });
  it('a lower-case school state still checks inside', () => {
    const prefs = recruitmentPreferencesOf({ preferred_states: ['TX'] });
    expect(preferenceChecks(prefs, { state: 'tx' })[0].status).toBe(CHECK_STATUS.INSIDE);
  });
});
