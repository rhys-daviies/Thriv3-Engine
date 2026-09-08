import { describe, it, expect } from 'vitest';
import { registrySchoolName, ROSTER_SCHOOL_ALIASES } from './rosterSchoolAliases.js';

describe('registrySchoolName', () => {
  it('returns the registry spelling for a roster-file name', () => {
    expect(registrySchoolName('Avila University', { sport: 'mens-soccer', division: 'NAIA' }))
      .toBe('Avila');
  });

  it('leaves a name it does not know alone', () => {
    expect(registrySchoolName('Stonehill', { sport: 'mens-soccer', division: 'NCAA D2' }))
      .toBe('Stonehill');
  });

  // The same words name different institutions across divisions, which is the
  // whole reason these are scoped. Georgetown College is in Kentucky and plays
  // NAIA; Georgetown University is D1. An unscoped table maps one to the other.
  it('refuses to apply an NAIA alias to another division', () => {
    expect(registrySchoolName('Georgetown College', { sport: 'mens-soccer', division: 'NCAA D1' }))
      .toBe('Georgetown College');
    expect(registrySchoolName('Georgetown College', { sport: 'mens-soccer', division: 'NAIA' }))
      .toBe('Georgetown (KY)');
  });

  it('refuses to apply a men\'s alias to the women\'s file', () => {
    expect(registrySchoolName('Avila University', { sport: 'womens-soccer', division: 'NAIA' }))
      .toBe('Avila University');
  });

  it('survives a missing scope, a blank name and a null', () => {
    expect(registrySchoolName('Avila University')).toBe('Avila University');
    expect(registrySchoolName('', { sport: 'mens-soccer', division: 'NAIA' })).toBe('');
    expect(registrySchoolName(null, { sport: 'mens-soccer', division: 'NAIA' })).toBe(null);
  });
});

describe('the table itself', () => {
  const groups = Object.entries(ROSTER_SCHOOL_ALIASES);

  // Two roster names pointing at one registry row would merge two separate
  // institutions into one squad — invisibly, since the totals would still add
  // up. This is the failure the table exists to prevent, not to cause.
  it('never maps two schools onto the same registry row', () => {
    for (const [scope, table] of groups) {
      const seen = new Map();
      for (const [from, to] of Object.entries(table)) {
        expect(seen.has(to), `${scope}: ${seen.get(to)} and ${from} both map to ${to}`).toBe(false);
        seen.set(to, from);
      }
    }
  });

  // A target that is also a source means the table has to be applied twice to
  // settle, and applying it once — which is what the importer does — leaves
  // half the rows on the intermediate spelling.
  it('has no target that is also a source', () => {
    for (const [scope, table] of groups) {
      const sources = new Set(Object.keys(table));
      for (const to of Object.values(table)) {
        expect(sources.has(to), `${scope}: ${to} is both a target and a source`).toBe(false);
      }
    }
  });

  it('maps nothing to itself, to blank, or to a name with stray whitespace', () => {
    for (const [scope, table] of groups) {
      for (const [from, to] of Object.entries(table)) {
        expect(to, `${scope}: ${from}`).toBeTruthy();
        expect(to, `${scope}: ${from} maps to itself`).not.toBe(from);
        expect(to, `${scope}: ${to} has stray whitespace`).toBe(to.trim());
      }
    }
  });

  it('is scoped by a real sport and division', () => {
    for (const [scope] of groups) {
      const [sport, division] = scope.split('|');
      expect(['mens-soccer', 'womens-soccer']).toContain(sport);
      expect(division).toMatch(/^(NAIA|NJCAA|NCAA D[123])$/);
    }
  });
});
