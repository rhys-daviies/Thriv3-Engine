import { describe, it, expect } from 'vitest';
import { isFederalUnitid, singleEntityId, exceptionEntityId, entityProblems, buildEntityIndex, hostOf } from './athleticsEntity.js';

/** Phase 7D identifier semantics — pure. */
describe('athletics entity identifier semantics', () => {
  it('a federal UNITID is exactly six digits', () => {
    expect(isFederalUnitid(151111)).toBe(true);
    expect(isFederalUnitid('148584')).toBe(true);
    expect(isFederalUnitid(15111102)).toBe(false); // College Navigator location code (parent 151111 + 02)
    expect(isFederalUnitid(14570703)).toBe(false); // Lincoln Trail location code — not a UNITID
    expect(isFederalUnitid(12345)).toBe(false);
    expect(isFederalUnitid(null)).toBe(false);
    expect(isFederalUnitid('AE-U151111')).toBe(false);
  });
  it('entity ids are internal and never valid federal ids', () => {
    expect(singleEntityId(151111)).toBe('AE-U151111');
    expect(() => singleEntityId(15111102)).toThrow();
    expect(exceptionEntityId('iu columbus')).toBe('AE-X-IU-COLUMBUS');
    expect(isFederalUnitid(exceptionEntityId('x'))).toBe(false);
  });
  it('branch/campus entities need a parent + label and may not claim the parent id', () => {
    const ok = { athletics_entity_id: 'AE-X-B', entity_kind: 'BRANCH_CAMPUS', parent_unitid: 178721, campus_label: 'Gilbert', federal_unitid: null, provenance: 'p' };
    expect(entityProblems(ok)).toEqual([]);
    expect(entityProblems({ ...ok, parent_unitid: null })).toContain('campus/branch entity requires parent_unitid');
    expect(entityProblems({ ...ok, federal_unitid: 178721 }).join()).toMatch(/must not claim/);
    expect(entityProblems({ ...ok, campus_label: null }).join()).toMatch(/campus_label/);
  });
  it('non-Title-IV / foreign entities carry no federal id; SINGLE requires one; locator codes rejected', () => {
    expect(entityProblems({ athletics_entity_id: 'AE-X-S', entity_kind: 'NON_TITLE_IV', federal_unitid: 123456, provenance: 'p' }).join()).toMatch(/cannot carry/);
    expect(entityProblems({ athletics_entity_id: 'AE-U151111', entity_kind: 'SINGLE', federal_unitid: null, provenance: 'p' }).join()).toMatch(/requires federal_unitid/);
    expect(entityProblems({ athletics_entity_id: 'AE-X-L', entity_kind: 'UNRESOLVED_FEDERAL', federal_unitid: 15111102, provenance: 'p' }).join()).toMatch(/not a 6-digit/);
    expect(entityProblems({ athletics_entity_id: 'AE-U100001', entity_kind: 'SINGLE', federal_unitid: 100002, provenance: 'p' }).join()).toMatch(/must match/);
    expect(entityProblems({ athletics_entity_id: 'AE-U100001', entity_kind: 'SINGLE', federal_unitid: 100001 }).join()).toMatch(/provenance/);
  });
  it('index: host-level ownership, parent-only evidence, unique programme lookup', () => {
    const ix = buildEntityIndex({
      entities: [{ athletics_entity_id: 'AE-U100001', federal_unitid: 100001 }, { athletics_entity_id: 'AE-X-B', federal_unitid: null, parent_unitid: 100001 }],
      colleges: [{ id: 'a', name: 'P', sport: 'mens-soccer', active: 1, athletics_entity_id: 'AE-U100001' }, { id: 'b', name: 'B', sport: 'mens-soccer', active: 1, athletics_entity_id: 'AE-X-B' }, { id: 'c', name: 'B2', sport: 'mens-soccer', active: 1, athletics_entity_id: 'AE-X-B' }],
      domains: [{ domain: 'branch.example.net', status: 'VERIFIED', athletics_entity_id: 'AE-X-B' }, { domain: 'x.example.net', status: 'INSUFFICIENT_EVIDENCE', athletics_entity_id: 'AE-X-B' }],
    });
    expect(ix.entityForHost('branch.example.net')).toBe('AE-X-B');
    expect(ix.entityForHost('x.example.net')).toBeNull(); // untrusted host rows never own
    expect(ix.entityForUnitid(100001)).toBe('AE-U100001');
    expect(ix.isParentOnly('AE-X-B', 100001)).toBe(true);
    expect(ix.isParentOnly('AE-U100001', 100001)).toBe(false);
    expect(ix.programmeFor('AE-U100001', 'mens-soccer').id).toBe('a');
    expect(ix.programmeFor('AE-X-B', 'mens-soccer')).toBeNull(); // ambiguous (two active rows)
    expect(ix.programmeCount('AE-X-B', 'mens-soccer')).toBe(2);
  });
  it('hostOf keeps the full host and reads Wayback targets', () => {
    expect(hostOf('https://www.gilbert.example.net/sports/x')).toBe('gilbert.example.net');
    expect(hostOf('https://web.archive.org/web/2025/https://branch.example.net/x')).toBe('branch.example.net');
    expect(hostOf('pattern_inference:high')).toBeNull();
  });
});
