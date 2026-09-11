import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import { searchColleges, findCanonicalCollege, SEARCH_LIMITS } from './collegeSearch.js';

/**
 * Discovery, and the line it must not cross.
 *
 * The behaviours here are ordinary — case-insensitive, partial, sport-scoped.
 * The one that matters is the last describe block: a search that finds nothing
 * finds nothing. This codebase has a matcher that answered anyway and
 * corrupted three columns doing it (see server/lib/schoolMatch.js), so
 * "returns an empty list" is a property worth asserting rather than assuming.
 */

let seq = 0;
function college({ name, sport = 'mens-soccer', division = 'NCAA D1', active = 1, unitid = null, ...rest }) {
  const id = `col-${++seq}`;
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference,
      city, state, active, unitid)
    VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, sport, division, rest.conference ?? 'Big East',
    rest.city ?? 'Durham', rest.state ?? 'NC', active, unitid);
  return id;
}

function alias(unitid, raw, scope = '*') {
  db.prepare(`
    INSERT INTO institution_aliases (alias_key, alias_raw, unitid, conference_scope,
      alias_type, source, confidence, imported_at)
    VALUES (?, ?, ?, ?, 'OFFICIAL_ABBREVIATION', 'test', 'CURATED', '2026-09-11T00:00:00.000Z')
  `).run(raw.toLowerCase().replace(/\s+/g, ''), raw, unitid, scope);
}

beforeEach(() => {
  db.exec('DELETE FROM institution_aliases; DELETE FROM colleges;');
});

describe('searchColleges', () => {
  it('is case-insensitive', () => {
    college({ name: 'Duke' });
    for (const q of ['duke', 'DUKE', 'DuKe']) {
      const results = searchColleges({ sport: 'mens-soccer', query: q });
      expect(results.map((r) => r.name)).toEqual(['Duke']);
    }
  });

  it('matches a partial name anywhere in it', () => {
    college({ name: 'North Carolina State' });
    college({ name: 'Wake Forest' });

    expect(searchColleges({ sport: 'mens-soccer', query: 'north' }).map((r) => r.name))
      .toEqual(['North Carolina State']);
    // Mid-string, not just a prefix.
    expect(searchColleges({ sport: 'mens-soccer', query: 'carolina' }).map((r) => r.name))
      .toEqual(['North Carolina State']);
    expect(searchColleges({ sport: 'mens-soccer', query: 'forest' }).map((r) => r.name))
      .toEqual(['Wake Forest']);
  });

  it('returns the canonical registry row, not a name it assembled', () => {
    const id = college({ name: 'Duke', division: 'NCAA D1', conference: 'ACC', city: 'Durham', state: 'NC' });
    const [row] = searchColleges({ sport: 'mens-soccer', query: 'duk' });
    expect(row).toMatchObject({
      id, name: 'Duke', sport: 'mens-soccer', division: 'NCAA D1', conference: 'ACC',
      city: 'Durham', state: 'NC', matched_on: 'name',
    });
  });

  it('is scoped to one sport', () => {
    college({ name: 'Duke', sport: 'mens-soccer' });
    college({ name: 'Duke', sport: 'womens-soccer' });

    const mens = searchColleges({ sport: 'mens-soccer', query: 'duke' });
    expect(mens).toHaveLength(1);
    expect(mens[0].sport).toBe('mens-soccer');

    const womens = searchColleges({ sport: 'womens-soccer', query: 'duke' });
    expect(womens).toHaveLength(1);
    expect(womens[0].sport).toBe('womens-soccer');
  });

  it('refuses a search that names no sport', () => {
    expect(() => searchColleges({ query: 'duke' })).toThrowError(/must name a sport/);
  });

  describe('inactive programmes', () => {
    it('excludes them by default', () => {
      college({ name: 'Duke' });
      college({ name: 'Duke Kunshan', active: 0 });
      expect(searchColleges({ sport: 'mens-soccer', query: 'duke' }).map((r) => r.name)).toEqual(['Duke']);
    });

    it('includes them only when asked', () => {
      college({ name: 'Duke' });
      college({ name: 'Duke Kunshan', active: 0 });
      const names = searchColleges({ sport: 'mens-soccer', query: 'duke', includeInactive: true })
        .map((r) => r.name);
      expect(names).toContain('Duke Kunshan');
    });

    it('keeps a row whose active column was never set', () => {
      // `active` defaults to 1 and predates nothing, but a NULL must read as
      // active — the same `active !== 0` reading src/pages/Colleges.jsx uses.
      const id = college({ name: 'Elon' });
      db.prepare('UPDATE colleges SET active = NULL WHERE id = ?').run(id);
      expect(searchColleges({ sport: 'mens-soccer', query: 'elon' })).toHaveLength(1);
    });
  });

  describe('aliases as discovery terms', () => {
    it('finds a school by a global alias and returns its canonical name', () => {
      const id = college({ name: 'Connecticut', unitid: 129020 });
      alias(129020, 'UConn');

      const results = searchColleges({ sport: 'mens-soccer', query: 'uconn' });
      expect(results).toHaveLength(1);
      // The canonical name, never the alias. The alias got us here; it is not
      // what gets stored.
      expect(results[0]).toMatchObject({ id, name: 'Connecticut', matched_on: 'alias' });
    });

    it('ignores conference-scoped aliases, which are ambiguous without a conference', () => {
      // The schema's own example: the Wolverine-Hoosier prints "Rochester" for
      // Rochester Christian while the UAA prints it for the University of
      // Rochester, in the same seasons. A search has no conference context, so
      // it must not use an alias that needs one.
      college({ name: 'Rochester Christian', unitid: 999001 });
      alias(999001, 'Rochester', 'whac');
      expect(searchColleges({ sport: 'mens-soccer', query: 'rochester christian' })).toHaveLength(1);
      expect(searchColleges({ sport: 'mens-soccer', query: 'rochester' }).map((r) => r.name))
        .toEqual(['Rochester Christian']); // by name, not by the scoped alias
    });

    it('does not let an alias drag in another sport or an inactive programme', () => {
      college({ name: 'Connecticut', sport: 'womens-soccer', unitid: 129020 });
      alias(129020, 'UConn');
      expect(searchColleges({ sport: 'mens-soccer', query: 'uconn' })).toEqual([]);
    });
  });

  describe('ordering', () => {
    it('puts a prefix match above a mid-string one', () => {
      college({ name: 'Duke Kunshan' });
      college({ name: 'Duke' });
      college({ name: 'Marmaduke State' });
      expect(searchColleges({ sport: 'mens-soccer', query: 'duke' }).map((r) => r.name))
        .toEqual(['Duke', 'Duke Kunshan', 'Marmaduke State']);
    });

    it('puts a name match above an alias-only match', () => {
      college({ name: 'Connecticut', unitid: 129020 });
      college({ name: 'UConn Avery Point' });
      alias(129020, 'UConn');
      expect(searchColleges({ sport: 'mens-soccer', query: 'uconn' }).map((r) => r.matched_on))
        .toEqual(['name', 'alias']);
    });
  });

  describe('the query itself', () => {
    it('refuses a query shorter than the minimum rather than returning nothing', () => {
      college({ name: 'Duke' });
      // A picker showing nothing for "D" looks identical to one showing
      // nothing for a school we do not hold. Those are different facts.
      expect(() => searchColleges({ sport: 'mens-soccer', query: 'D' }))
        .toThrowError(new RegExp(`at least ${SEARCH_LIMITS.MIN_QUERY_LENGTH}`));
      expect(() => searchColleges({ sport: 'mens-soccer', query: '   ' })).toThrowError(/at least/);
      expect(() => searchColleges({ sport: 'mens-soccer' })).toThrowError(/at least/);
    });

    it('treats LIKE metacharacters as literal text, not as a pattern', () => {
      college({ name: 'Duke' });
      college({ name: "St. Mary's" });
      // `%` and `_` would match everything and anything under LIKE. `instr`
      // has no metacharacters, so the query is only ever itself.
      expect(searchColleges({ sport: 'mens-soccer', query: '%%' })).toEqual([]);
      expect(searchColleges({ sport: 'mens-soccer', query: '%uke' })).toEqual([]);
      expect(searchColleges({ sport: 'mens-soccer', query: 'D_ke' })).toEqual([]);
      expect(searchColleges({ sport: 'mens-soccer', query: "Mary's" }).map((r) => r.name))
        .toEqual(["St. Mary's"]);
    });

    it('caps how much one search may return', () => {
      for (let i = 0; i < 60; i += 1) college({ name: `Duke ${i}` });
      expect(searchColleges({ sport: 'mens-soccer', query: 'duke' }))
        .toHaveLength(SEARCH_LIMITS.DEFAULT_LIMIT);
      expect(searchColleges({ sport: 'mens-soccer', query: 'duke', limit: 500 }))
        .toHaveLength(SEARCH_LIMITS.MAX_LIMIT);
      expect(searchColleges({ sport: 'mens-soccer', query: 'duke', limit: 3 })).toHaveLength(3);
    });
  });

  describe('a school the registry does not hold', () => {
    it('returns nothing rather than the nearest thing it could find', () => {
      college({ name: 'Duke' });
      college({ name: 'North Carolina' });
      // No fuzzy fallback, no "did you mean", no manufactured row.
      expect(searchColleges({ sport: 'mens-soccer', query: 'Hogwarts' })).toEqual([]);
      expect(searchColleges({ sport: 'mens-soccer', query: 'Dook' })).toEqual([]);
    });
  });
});

describe('findCanonicalCollege', () => {
  it('re-reads the selected row from the registry', () => {
    const id = college({ name: 'Duke' });
    expect(findCanonicalCollege({ collegeId: id, sport: 'mens-soccer' })).toMatchObject({ id, name: 'Duke' });
  });

  it('misses across sports, because (name, sport) is the identity', () => {
    const id = college({ name: 'Duke', sport: 'womens-soccer' });
    expect(findCanonicalCollege({ collegeId: id, sport: 'mens-soccer' })).toBeNull();
  });

  it('misses an inactive programme unless asked for one', () => {
    const id = college({ name: 'Gone', active: 0 });
    expect(findCanonicalCollege({ collegeId: id, sport: 'mens-soccer' })).toBeNull();
    expect(findCanonicalCollege({ collegeId: id, sport: 'mens-soccer', includeInactive: true }))
      .toMatchObject({ id });
  });

  it('misses on a college id that does not exist', () => {
    expect(findCanonicalCollege({ collegeId: 'col-nope', sport: 'mens-soccer' })).toBeNull();
    expect(findCanonicalCollege({ collegeId: '', sport: 'mens-soccer' })).toBeNull();
  });
});
