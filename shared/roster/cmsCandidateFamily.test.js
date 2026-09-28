import { describe, it, expect } from 'vitest';
import {
  rosterCandidatesForVerifiedHost, SHAPES, SLUGS, MAX_ATTEMPTED_CANDIDATES,
} from './rosterCandidates.js';

/**
 * L7N — a roster URL family that is not under `/sports/`.
 *
 * 9,704 of the 9,760 roster URLs this pipeline has fetched sit under
 * `/sports/<slug>/…roster…`. Trinity Washington's WordPress site publishes
 * `/soccer-roster-2026`, and the same shape for three sibling sports.
 *
 * Adding a ninth shape to a catalogue every host draws from would lengthen
 * 1,760 ladders for one programme's benefit and put the measured
 * sixteen-candidate bound at risk. So the shape is `exclusive`: generated only
 * for a host the ledger records as using it. These tests are mostly about what
 * that gate keeps out.
 */

const cms = SHAPES.find((s) => s.id === 'CMS_SPORT_ROSTER_YEAR');
const gen = (o) => rosterCandidatesForVerifiedHost({ season: 2026, verified: true, ...o });
const urls = (o) => gen(o).candidates.map((c) => c.url);

describe('the CMS roster family', () => {
  it('is recorded as exclusive, and honestly as unprecedented', () => {
    expect(cms).toBeTruthy();
    expect(cms.exclusive).toBe(true);
    expect(cms.providers).toEqual(['WPBAKERY']);
    // No corpus precedent at all. Its evidence is four sibling sports on one
    // site, and recording that as zero is the point.
    expect(cms.observed).toBe(0);
  });

  it('generates Trinity\'s real roster URL inside the attempt bound', () => {
    const list = urls({ host: 'athletics.trinitydc.edu', sport: 'womens-soccer', platform: 'WPBAKERY', soleSoccerProgramme: true });
    const ordinal = list.indexOf('https://athletics.trinitydc.edu/soccer-roster-2026') + 1;
    expect(ordinal).toBeGreaterThan(0);
    expect(ordinal).toBeLessThanOrEqual(MAX_ATTEMPTED_CANDIDATES);
  });

  it('is never generated for a host on any other platform', () => {
    for (const platform of ['SIDEARM', 'PRESTO', 'NUXT', null]) {
      const list = gen({ host: 'one.test', sport: 'womens-soccer', platform });
      expect(list.candidates.some((c) => c.shape === 'CMS_SPORT_ROSTER_YEAR')).toBe(false);
      expect(list.candidates).toHaveLength(24);
    }
  });

  it('leaves an existing platform\'s ladder byte-identical', () => {
    // The guarantee that makes this safe is structural, not statistical: no
    // other host reaches the new line at all.
    const before = ['/sports/womens-soccer/roster/2026', '/sports/wsoc/roster/2026', '/sports/w-soccer/roster/2026'];
    expect(urls({ host: 'x.test', sport: 'womens-soccer', platform: 'SIDEARM' }).slice(0, 3))
      .toEqual(before.map((p) => `https://x.test${p}`));
  });

  it('contains no institution name — it is parameterised like every other shape', () => {
    expect(cms.path).toBe('/<SLUG>-roster-<YEAR>');
    expect(JSON.stringify(SHAPES)).not.toMatch(/trinity/i);
    expect(JSON.stringify(SLUGS)).not.toMatch(/trinity/i);
  });
});

describe('the bare `soccer` slug', () => {
  it('is offered only where the institution fields one soccer programme', () => {
    const sole = urls({ host: 't.test', sport: 'womens-soccer', platform: 'WPBAKERY', soleSoccerProgramme: true });
    const both = urls({ host: 't.test', sport: 'womens-soccer', platform: 'WPBAKERY', soleSoccerProgramme: false });
    expect(sole).toContain('https://t.test/soccer-roster-2026');
    expect(both).not.toContain('https://t.test/soccer-roster-2026');
  });

  it('is never offered to the eight /sports/ shapes, whatever the institution', () => {
    for (const platform of ['SIDEARM', 'PRESTO', 'NUXT', 'WPBAKERY']) {
      for (const sport of ['mens-soccer', 'womens-soccer']) {
        const list = urls({ host: 'x.test', sport, platform, soleSoccerProgramme: true });
        expect(list.filter((u) => u.includes('/sports/') && /\/sports\/soccer\//.test(u))).toEqual([]);
      }
    }
  });

  it('cannot produce a wrong-gender page for a school that fields both', () => {
    // The risk the bare slug was excluded for is a property of the institution,
    // and this is the condition that removes it.
    const men = urls({ host: 'x.test', sport: 'mens-soccer', platform: 'WPBAKERY', soleSoccerProgramme: false });
    const women = urls({ host: 'x.test', sport: 'womens-soccer', platform: 'WPBAKERY', soleSoccerProgramme: false });
    // The bare slug would appear as a path of exactly `/soccer-roster-<year>`;
    // `\b` is not enough here because it also matches inside `womens-soccer-…`.
    const bare = (list) => list.filter((u) => new URL(u).pathname.startsWith('/soccer-roster-'));
    expect(bare(men)).toEqual([]);
    expect(bare(women)).toEqual([]);
  });
});

describe('the global bound still holds', () => {
  it('a WPBakery host respects the same limit as everyone else', () => {
    const g = gen({
      host: 't.test', sport: 'womens-soccer', platform: 'WPBAKERY',
      soleSoccerProgramme: true, limit: MAX_ATTEMPTED_CANDIDATES,
    });
    expect(g.candidates).toHaveLength(MAX_ATTEMPTED_CANDIDATES);
  });

  it('every generated candidate is on the host it was asked for', () => {
    for (const c of gen({ host: 't.test', sport: 'womens-soccer', platform: 'WPBAKERY', soleSoccerProgramme: true }).candidates) {
      expect(new URL(c.url).hostname).toBe('t.test');
    }
  });
});
