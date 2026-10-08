import { describe, it, expect } from 'vitest';
import {
  positionSummary, locationText, recruitmentPreferenceRows, checkView, checksView,
} from './recruitmentPreferenceView';
import { preferenceChecks, recruitmentPreferencesOf } from '@shared/recruitmentPreferences.js';

describe('positionSummary', () => {
  it('shows the detail and the group the matcher ranks on', () => {
    expect(positionSummary({ position: 'CB', secondary_position: 'DM' }))
      .toEqual({ primary: 'Center back', rankedAs: 'Defender', secondary: 'Defensive midfielder' });
  });
  it('reads legacy coarse values and the None sentinel', () => {
    expect(positionSummary({ position: 'Defense', secondary_position: 'None' }))
      .toEqual({ primary: 'Defender', rankedAs: 'Defender', secondary: null });
  });
});

describe('recruitmentPreferenceRows', () => {
  it('names every preference, stated or not, and marks only location as ranked', () => {
    const rows = recruitmentPreferenceRows({});
    expect(rows.map((r) => r.text)).toEqual(Array(5).fill('No preference'));
    expect(rows.filter((r) => r.ranked).map((r) => r.field)).toEqual(['location']);
  });
  it('writes regions by name with extra states after them', () => {
    const p = recruitmentPreferencesOf({ preferred_regions: ['WEST'], preferred_states: ['NY', 'CA'] });
    expect(locationText(p)).toBe('West, plus NY');
    const rows = recruitmentPreferenceRows({
      preferred_regions: ['WEST'], preferred_states: ['NY'], preferred_institution_types: ['PRIVATE_NONPROFIT'],
      preferred_divisions: ['NCAA D1'], academic_minimum: 6,
    });
    expect(Object.fromEntries(rows.map((r) => [r.field, r.text]))).toEqual({
      location: 'West, plus NY',
      preferred_divisions: 'NCAA D1',
      preferred_conferences: 'No preference',
      preferred_institution_types: 'Private (non-profit)',
      academic_minimum: '6 or higher',
    });
  });
});

describe('checkView', () => {
  const prefs = recruitmentPreferencesOf({
    preferred_divisions: ['NCAA D1'], preferred_regions: ['NORTHEAST'], preferred_institution_types: ['PUBLIC'], academic_minimum: 6,
  });

  it('says inside, outside or not on file in words, and says whether it was ranked', () => {
    const outside = checksView(preferenceChecks(prefs, { division: 'NAIA', state: 'CA', control: 2, academic_rating: 4.5 }));
    expect(outside.map((c) => c.text)).toEqual([
      'NAIA is outside the divisions they asked for (NCAA D1).',
      'CA is outside where they want to be (Northeast).',
      'Private (non-profit) is not the kind of school they asked for (Public).',
      'Academic rating 4.5 is below their minimum of 6.',
    ]);
    expect(outside.map((c) => c.tone)).toEqual(['short', 'short', 'short', 'short']);
    expect(outside.map((c) => c.note)).toEqual(['Checked, not ranked', 'Counted in the ranking', 'Checked, not ranked', 'Checked, not ranked']);

    const inside = checksView(preferenceChecks(prefs, { division: 'NCAA D1', state: 'MA', control: 1, academic_rating: 7 }));
    expect(inside.map((c) => c.tone)).toEqual(['fit', 'fit', 'fit', 'fit']);
    expect(inside[1].text).toBe('MA is inside where they want to be (Northeast).');
  });

  it('never presents missing programme data as a fit or a shortfall', () => {
    const unknown = checksView(preferenceChecks(prefs, {}));
    expect(unknown.every((c) => c.tone === 'unknown')).toBe(true);
    expect(unknown.every((c) => /not on file/.test(c.text))).toBe(true);
  });

  it('is empty for a run that recorded no checks', () => {
    expect(checksView(undefined)).toEqual([]);
    expect(checkView(null)).toBeNull();
  });
});
