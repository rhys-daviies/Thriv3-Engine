/**
 * Published profiles against the database (§2d check 3), on throwaway files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { verifyPublishedProfiles, pageSlugs } from './verifyPublishedProfiles.js';

let dir;
const p = (...x) => path.join(dir, ...x);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/**
 *   pub1, pub2  published, live         -> must have pages
 *   draft1      live, never published   -> a page is normal (unstamped)
 *   gone1       archived, was published -> must NOT have a page
 */
function db() {
  const d = new Database(p('copy.sqlite'));
  d.exec('CREATE TABLE players (id TEXT PRIMARY KEY, full_name TEXT, email TEXT, public_slug TEXT, published_at TEXT, archived_at TEXT)');
  const ins = d.prepare('INSERT INTO players VALUES (?, ?, ?, ?, ?, ?)');
  ins.run('a1', 'Ann Real', 'ann@school.example', 'pub1', '2026-10-01T00:00:00Z', null);
  ins.run('a2', 'Bo Real', 'bo@school.example', 'pub2', '2026-10-02T00:00:00Z', null);
  ins.run('a3', 'Cy Draft', 'cy@school.example', 'draft1', null, null);
  ins.run('a4', 'Di Gone', 'di@school.example', 'gone1', '2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z');
  ins.run('a5', 'Ed NoSlug', 'ed@school.example', null, null, null);
  d.close();
}
function pages(slugs, root = p('profiles')) {
  fs.mkdirSync(path.join(root, 'p'), { recursive: true });
  fs.writeFileSync(path.join(root, 'robots.txt'), 'User-agent: *\n');
  fs.writeFileSync(path.join(root, '_worker.js'), '// worker\n');
  for (const s of slugs) fs.writeFileSync(path.join(root, 'p', `${s}.html`), `<html>${s}</html>`);
}
const tgz = () => { execFileSync('tar', ['-C', dir, '-czf', p('profiles.tgz'), 'profiles']); return p('profiles.tgz'); };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-prof-')); db(); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe.each([['a directory', (x) => x], ['the backup\'s profiles.tgz', () => tgz()]])('reading %s', (_, source) => {
  it('consistent: every published athlete has a page; a never-published one may; nothing is orphaned', () => {
    pages(['pub1', 'pub2', 'draft1']);
    const r = verifyPublishedProfiles(p('copy.sqlite'), source(p('profiles')));
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual({ athletesPublished: 2, pages: 3, missing: 0, orphaned: 0, unstamped: 1 });
    expect(r.unstamped).toEqual([{ athleteId: 'a3', slug: 'draft1' }]);
  });

  it('MISSING: a published athlete without a page fails, named by id and slug', () => {
    pages(['pub1']);
    const r = verifyPublishedProfiles(p('copy.sqlite'), source(p('profiles')));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([{ athleteId: 'a2', slug: 'pub2' }]);
  });

  it('ORPHANED: a page for an archived athlete, and a page no athlete owns, both fail', () => {
    pages(['pub1', 'pub2', 'gone1', 'ghost9']);
    const r = verifyPublishedProfiles(p('copy.sqlite'), source(p('profiles')));
    expect(r.ok).toBe(false);
    expect(r.orphaned).toEqual([
      { slug: 'ghost9', why: 'NO_ATHLETE' },
      { slug: 'gone1', why: 'ARCHIVED_ATHLETE' },
    ]);
    expect(r.missing).toEqual([]);
  });

  it('missing and orphaned at once: the shape of pages taken at a different moment from the rows', () => {
    pages(['pub1', 'gone1']);
    const r = verifyPublishedProfiles(p('copy.sqlite'), source(p('profiles')));
    expect(r.counts).toMatchObject({ missing: 1, orphaned: 1 });
  });
});

describe('details', () => {
  it('robots.txt, _worker.js and anything outside p/ are not pages', () => {
    pages(['pub1']);
    fs.writeFileSync(p('profiles', 'pub2.html'), 'not under p/');
    expect([...pageSlugs(p('profiles'))]).toEqual(['pub1']);
  });

  it('flags the leftovers of an interrupted publish beside a directory', () => {
    pages(['pub1', 'pub2']);
    fs.mkdirSync(p('profiles.staging'));
    expect(verifyPublishedProfiles(p('copy.sqlite'), p('profiles')).interruptedPublish).toEqual([p('profiles.staging')]);
  });

  it('read-only: the database copy is byte-identical afterwards, and output carries no names or addresses', () => {
    pages(['pub1']);
    const before = sha(p('copy.sqlite'));
    const r = verifyPublishedProfiles(p('copy.sqlite'), p('profiles'));
    expect(sha(p('copy.sqlite'))).toBe(before);
    expect(JSON.stringify(r)).not.toMatch(/Ann|Bo Real|school\.example/);
  });

  it('refuses the database the app is configured to use', () => {
    pages(['pub1']);
    expect(() => verifyPublishedProfiles(p('copy.sqlite'), p('profiles'), { env: { RECRUITMATCH_DB: p('copy.sqlite') } }))
      .toThrow(/live database/);
  });

  it('the command line exits 0 when consistent and 1 when not', () => {
    pages(['pub1', 'pub2']);
    const run = () => {
      try { execFileSync(process.execPath, ['server/scripts/verifyPublishedProfiles.js', p('copy.sqlite'), p('profiles')], { stdio: 'pipe', env: { ...process.env, RECRUITMATCH_DB: ':memory:' } }); return 0; } catch (e) { return e.status; }
    };
    expect(run()).toBe(0);
    fs.rmSync(p('profiles', 'p', 'pub2.html'));
    expect(run()).toBe(1);
  });
});
