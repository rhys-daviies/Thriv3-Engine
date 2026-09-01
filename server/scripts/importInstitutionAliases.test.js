/**
 * The alias table's refusals.
 *
 * One alias, one institution — enforced by the primary key, so the failure this
 * has to get right is what happens when two institutions claim one spelling.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import { aliasRows, run } from './importInstitutionAliases.js';
import { ALIAS_TYPE } from '../../shared/institutionIdentity.js';

const quiet = () => {};
const colleges = (...rows) => rows.map(([name, sport, unitid]) => ({ name, sport, unitid }));

beforeEach(() => {
  db.exec('DELETE FROM colleges; DELETE FROM institution_aliases;');
});

describe('building the rows', () => {
  it('makes one alias of every name, in both sports, under one UNITID', () => {
    const { rows } = aliasRows({
      colleges: colleges(['Amherst', 'mens-soccer', 164465], ['Amherst College', 'womens-soccer', 164465]),
      curated: [], scoped: [], now: 'x',
    });
    expect(rows.map((r) => r.alias_key).sort()).toEqual(['amherst', 'amherst college']);
    expect(new Set(rows.map((r) => r.unitid))).toEqual(new Set([164465]));
    expect(rows[0].alias_type).toBe(ALIAS_TYPE.CURRENT_NAME);
  });

  it('refuses a spelling two institutions claim, and writes neither', () => {
    const { rows, collisions } = aliasRows({
      colleges: colleges(['Bethel', 'mens-soccer', 1], ['Bethel', 'womens-soccer', 2]),
      curated: [], scoped: [], now: 'x',
    });
    expect(rows).toHaveLength(0);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].unitids).toEqual([1, 2]);
  });

  it('does not let a third claimant re-create a refused spelling', () => {
    const { rows } = aliasRows({
      colleges: colleges(['Bethel', 'a', 1], ['Bethel', 'b', 2], ['Bethel', 'c', 1]),
      curated: [], scoped: [], now: 'x',
    });
    expect(rows).toHaveLength(0);
  });

  it('skips a row with no UNITID rather than inventing one', () => {
    const { rows, skippedNoUnitid } = aliasRows({
      colleges: colleges(['Simon Fraser', 'mens-soccer', null]), curated: [], scoped: [], now: 'x',
    });
    expect(rows).toHaveLength(0);
    expect(skippedNoUnitid).toEqual([{ name: 'Simon Fraser', sport: 'mens-soccer' }]);
  });

  it('carries a curated alias’s own provenance', () => {
    const { rows } = aliasRows({
      colleges: colleges(['PennWest California', 'mens-soccer', 498571]),
      curated: [{ alias: 'California (Pa.)', unitid: 498571, aliasType: ALIAS_TYPE.HISTORICAL_NAME, source: 'PSAC standings 2022', confidence: 'CURATED' }],
      scoped: [], now: 'x',
    });
    const curated = rows.find((r) => r.alias_key === 'california pa');
    expect(curated).toMatchObject({ alias_type: 'HISTORICAL_NAME', source: 'PSAC standings 2022', confidence: 'CURATED' });
  });

  it('does not store the bare base beside the written-down name', () => {
    // "anderson" is generated at resolve time, where it may collide and the
    // state the source wrote separates the two. A primary key cannot hold
    // "either of these, depending on what the source said".
    const { rows } = aliasRows({ colleges: colleges(['Anderson (SC)', 'mens-soccer', 217633]), curated: [], scoped: [], now: 'x' });
    expect(rows.map((r) => r.alias_key)).toEqual(['anderson sc']);
  });
});

describe('applying', () => {
  it('replaces the table rather than accumulating', () => {
    db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, unitid)
      VALUES ('c1','x','x','Test College','mens-soccer',1)`).run();
    run({ apply: true, log: quiet });
    run({ apply: true, log: quiet });
    expect(db.prepare('SELECT COUNT(*) n FROM institution_aliases').get().n)
      .toBe(db.prepare('SELECT COUNT(DISTINCT alias_key) n FROM institution_aliases').get().n);
  });
});

describe('a conference-scoped alias', () => {
  it('lives under its own key, so the same spelling can mean two institutions', () => {
    const { rows } = aliasRows({
      colleges: colleges(['Rochester', 'mens-soccer', 195030]),
      curated: [],
      scoped: [{
        conferenceScope: 'whac', alias: 'Rochester', unitid: 170967,
        aliasType: ALIAS_TYPE.HISTORICAL_NAME, confidence: 'CORROBORATED', source: 'test',
      }],
      now: 'x',
    });
    const global = rows.find((r) => r.alias_key === 'rochester' && r.conference_scope === '*');
    const scoped = rows.find((r) => r.alias_key === 'rochester' && r.conference_scope === 'whac');
    expect(global.unitid).toBe(195030);
    expect(scoped.unitid).toBe(170967);
    // And it is not a collision: the two live under different keys on purpose.
    expect(rows.filter((r) => r.alias_key === 'rochester')).toHaveLength(2);
  });

  it('is still refused when two institutions claim it within one scope', () => {
    const { rows, collisions } = aliasRows({
      colleges: [], curated: [],
      scoped: [
        { conferenceScope: 'whac', alias: 'Rochester', unitid: 1, aliasType: ALIAS_TYPE.HISTORICAL_NAME, confidence: 'CURATED', source: 'a' },
        { conferenceScope: 'whac', alias: 'Rochester', unitid: 2, aliasType: ALIAS_TYPE.HISTORICAL_NAME, confidence: 'CURATED', source: 'b' },
      ],
      now: 'x',
    });
    expect(rows).toHaveLength(0);
    expect(collisions).toHaveLength(1);
  });
});
