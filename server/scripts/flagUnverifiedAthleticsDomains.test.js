import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** PHASE 6C.4 prevention flag — read-only report of authoritative athletics domains that
 * cannot corroborate a verified-email coach (missing/insufficient/wrong/unscraped). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'server/scripts/flagUnverifiedAthleticsDomains.js';
let dir; let dbPath;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6c4flag-')); dbPath = path.join(dir, 't.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (name TEXT, sport TEXT, unitid INTEGER);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT);
    CREATE TABLE coaches (id TEXT, school TEXT, sport TEXT, email_status TEXT, email_source_url TEXT, source TEXT);
    CREATE TABLE coach_seasons (school TEXT, sport TEXT, source_url TEXT);
  `);
  db.prepare('INSERT INTO colleges VALUES (?,?,?)').run('Good U', 'womens-soccer', 700);
  db.prepare('INSERT INTO colleges VALUES (?,?,?)').run('NotScraped U', 'womens-soccer', 701);
  db.prepare('INSERT INTO colleges VALUES (?,?,?)').run('Missing U', 'womens-soccer', 702);
  db.prepare('INSERT INTO athletics_domains VALUES (?,?,?)').run('good.com', 700, 'VERIFIED');
  db.prepare('INSERT INTO athletics_domains VALUES (?,?,?)').run('notscraped.com', 701, 'VERIFIED');
  // good.com scraped by coach_seasons; notscraped.com is not
  db.prepare('INSERT INTO coach_seasons VALUES (?,?,?)').run('Good U', 'womens-soccer', 'https://good.com/roster');
  const ins = db.prepare('INSERT INTO coaches VALUES (?,?,?,?,?,?)');
  ins.run('a', 'Good U', 'womens-soccer', 'verified', 'https://good.com/coaches', 'acq');       // corroborates -> NOT flagged
  ins.run('b', 'NotScraped U', 'womens-soccer', 'verified', 'https://notscraped.com/coaches', 'acq'); // VERIFIED not scraped -> flagged
  ins.run('c', 'Missing U', 'womens-soccer', 'verified', 'https://missing.com/coaches', 'acq');  // absent -> flagged
  ins.run('d', 'Good U', 'womens-soccer', 'inferred', 'https://whatever.com/x', 'acq');          // inferred email -> ignored
  db.close();
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

function run() { return execFileSync('node', [APP, '--db', dbPath, '--json'], { cwd: ROOT, encoding: 'utf8' }); }

describe('flagUnverifiedAthleticsDomains', () => {
  it('flags a VERIFIED-but-unscraped domain and an absent domain, not a corroborating one', () => {
    const out = JSON.parse(run());
    const byDomain = Object.fromEntries(out.map((r) => [r.domain, r]));
    expect(byDomain['good.com']).toBeUndefined();          // corroborates -> not flagged
    expect(byDomain['notscraped.com'].reason).toBe('ATHLETICS_DOMAIN_NOT_SCRAPED');
    expect(byDomain['missing.com'].reason).toBe('DOMAIN_MISSING');
  });
  it('ignores inferred-email coaches (never eligible regardless of domain)', () => {
    const out = JSON.parse(run());
    expect(out.find((r) => r.domain === 'whatever.com')).toBeUndefined();
  });
});
