/**
 * The official-membership loader, and the limits it must not exceed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '../db/client.js';
import { readMembership, build, run, ARTEFACT } from './importOfficialMembership.js';

let dir;
const write = (j) => fs.writeFileSync(path.join(dir, ARTEFACT), JSON.stringify(j));
const artefact = (members) => ({ source: 'https://web3.ncaa.org/directory/api/directory/memberList?type=12', members });
const quiet = () => {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmo-'));
  db.exec('DELETE FROM conference_members_official;');
});

describe('reading it fails closed', () => {
  it('refuses an absent file', () => {
    expect(() => readMembership(dir)).toThrow(/not found/);
  });

  it('refuses an empty one — it looks exactly like an association with no members', () => {
    write({ source: 'x', members: [] });
    expect(() => readMembership(dir)).toThrow(/empty/);
  });
});

describe('what it stores', () => {
  it('resolves the association’s conference spelling to a canonical id', () => {
    const { rows } = build({
      artefact: artefact([{ unitid: 213987, nameOfficial: 'Mercyhurst University', division: 'NCAA D1', conferenceRaw: 'Northeast Conference', athleticsHost: 'hurstathletics.com', state: 'PA' }]),
      now: 'x',
    });
    expect(rows[0]).toMatchObject({ unitid: 213987, conference_id: 'nec', division: 'NCAA D1', athletics_host: 'hurstathletics.com' });
  });

  it('keeps the raw spelling beside the canonical id', () => {
    const { rows } = build({ artefact: artefact([{ unitid: 1, nameOfficial: 'X', division: 'NCAA D2', conferenceRaw: 'PSAC' }]), now: 'x' });
    expect(rows[0].conference_raw).toBe('PSAC');
    expect(rows[0].conference_id).toBe('psac');
  });

  it('drops a row whose conference spelling resolves to nothing, and reports it', () => {
    const { rows, unresolved } = build({
      artefact: artefact([{ unitid: 1, nameOfficial: 'X', division: 'NCAA D1', conferenceRaw: 'Independent' }]),
      now: 'x',
    });
    expect(rows).toHaveLength(0);
    expect(unresolved).toEqual([['Independent', 1]]);
  });

  it('replaces the table rather than accumulating', () => {
    write(artefact([{ unitid: 1, nameOfficial: 'X', division: 'NCAA D2', conferenceRaw: 'PSAC' }]));
    run({ apply: true, dir, log: quiet });
    run({ apply: true, dir, log: quiet });
    expect(db.prepare('SELECT COUNT(*) n FROM conference_members_official').get().n).toBe(1);
  });
});

describe('what it is not for', () => {
  it('carries no season, because it is a current snapshot', () => {
    const { rows } = build({ artefact: artefact([{ unitid: 1, nameOfficial: 'X', division: 'NCAA D2', conferenceRaw: 'PSAC' }]), now: 'x' });
    expect(Object.keys(rows[0])).not.toContain('season');
    // And the table itself has no season column to put one in.
    expect(db.prepare('PRAGMA table_info(conference_members_official)').all().map((c) => c.name))
      .not.toContain('season');
  });
});
