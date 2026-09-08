import { describe, it, expect } from 'vitest';
import {
  recruitingRegionOf, recruitingRegions, splitRegions, regionOf, canonicalCountry, REGIONS,
} from './regions.js';

/**
 * K3D — the relevance taxonomy, and the guards that keep it honest.
 *
 * K4 measured broad regions producing true-but-thin hooks: Spain->Sweden ×20,
 * Japan->India ×9, Ghana->Morocco ×4. This layer tightens what may be CLAIMED
 * without touching what is COUNTED, so both halves are asserted here.
 */

describe('the relevance layer is separate from the analysis layer', () => {
  it('leaves regionOf alone', () => {
    // Every one of these still reports its broad region; only the relevance
    // answer differs. A coverage report must not move because outreach got
    // stricter.
    expect(regionOf('Sweden')).toBe('EUROPE');
    expect(regionOf('Spain')).toBe('EUROPE');
    expect(regionOf('Turkey')).toBe('EUROPE');
    expect(regionOf('India')).toBe('ASIA');
    expect(Object.keys(REGIONS)).toContain('EUROPE');
  });

  it('splits exactly the four buckets the data said were too broad', () => {
    expect(splitRegions().sort()).toEqual(['AFRICA', 'ASIA', 'EUROPE', 'LATIN_AMERICA']);
  });

  it('passes unsplit regions straight through', () => {
    // Measured tight: OCEANIA observes 3 countries, UK_IRELAND 4,
    // NORTH_AMERICA 1, MIDDLE_EAST 11 compact ones, and CARIBBEAN's 22 island
    // nations are one football market — K4 listed it and the data disagreed.
    for (const [country, region] of [['New Zealand', 'OCEANIA'], ['Australia', 'OCEANIA'],
      ['Ireland', 'UK_IRELAND'], ['United Kingdom', 'UK_IRELAND'], ['Canada', 'NORTH_AMERICA'],
      ['Jamaica', 'CARIBBEAN'], ['Barbados', 'CARIBBEAN'], ['Israel', 'MIDDLE_EAST']]) {
      expect(recruitingRegionOf(country), country).toBe(region);
    }
  });
});

describe('the groupings a coach would recognise', () => {
  const same = (a, b) => {
    const x = recruitingRegionOf(a); const y = recruitingRegionOf(b);
    return Boolean(x) && x === y;
  };

  it('keeps the relationships that are worth mentioning', () => {
    for (const [a, b] of [['Norway', 'Sweden'], ['Denmark', 'Iceland'], ['Spain', 'Portugal'],
      ['Germany', 'Austria'], ['Germany', 'Spain'], ['France', 'Germany'], ['Italy', 'Germany'],
      ['Japan', 'South Korea'], ['Ghana', 'Nigeria'], ['Brazil', 'Argentina'],
      ['Australia', 'New Zealand'], ['Ireland', 'United Kingdom']]) {
      expect(same(a, b), `${a} <-> ${b}`).toBe(true);
    }
  });

  it('drops the ones K4 measured as thin', () => {
    for (const [a, b] of [['Spain', 'Sweden'], ['Norway', 'Portugal'], ['Norway', 'Austria'],
      ['Japan', 'India'], ['Ghana', 'Morocco'], ['Brazil', 'Mexico'], ['Italy', 'Norway']]) {
      expect(same(a, b), `${a} <-> ${b}`).toBe(false);
    }
  });

  it('keeps Germany<->Spain and France<->Germany, which a tidier map would have cut', () => {
    // The first draft split the contiguous core into Iberia / Western /
    // Central and removed the two heaviest relationships in the dataset,
    // between adjacent major football nations. Simulation caught it.
    expect(same('Germany', 'Spain')).toBe(true);
    expect(same('France', 'Germany')).toBe(true);
  });
});

describe('a country with no confident grouping says nothing', () => {
  it('returns null rather than falling back to the broad bucket', () => {
    // Falling back would hand the claim to exactly the grouping we decided was
    // too loose. Silence is the conservative answer and the deterministic one.
    for (const c of ['Turkey', 'Greece', 'Cyprus', 'Mauritius', 'Madagascar', 'Reunion']) {
      expect(regionOf(c), `${c} broad`).toBeTruthy();
      expect(recruitingRegionOf(c), `${c} relevance`).toBeNull();
    }
  });

  it('returns null for a country it cannot canonicalise', () => {
    for (const v of [null, undefined, '', 'Freedonia']) expect(recruitingRegionOf(v)).toBeNull();
  });

  it('canonicalises before grouping', () => {
    expect(recruitingRegionOf('Korea, Republic of')).toBe('EAST_ASIA');
    expect(recruitingRegionOf('Türkiye')).toBe(recruitingRegionOf('Turkey'));
  });
});

describe('the map itself', () => {
  it('places no country in two groups', () => {
    const seen = new Map();
    for (const [group, members] of Object.entries(recruitingRegions())) {
      for (const c of members) {
        expect(seen.has(c), `${c} in ${group} and ${seen.get(c)}`).toBe(false);
        seen.set(c, group);
      }
    }
  });

  it('lists only canonical names, so no entry is dead', () => {
    for (const members of Object.values(recruitingRegions())) {
      for (const c of members) expect(canonicalCountry(c), c).toBe(c);
    }
  });

  it('only ever names countries inside a split region', () => {
    for (const [group, members] of Object.entries(recruitingRegions())) {
      for (const c of members) {
        expect(splitRegions(), `${c} (${group})`).toContain(regionOf(c));
      }
    }
  });
});
