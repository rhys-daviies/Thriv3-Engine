import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld } from '../lib/refresh/regressionWorld.js';
import { walShapedCopy, physicalState } from '../../shared/testing/walShape.js';

/**
 * `npm run build:recruiting -- --report` IS OBSERVATIONAL.
 *
 * The script printed "REPORT ONLY — nothing written." but imported `db/client.js` first, and importing the client
 * is not a read: it runs schema.sql and migrate(), sets WAL mode and (through the corpus-revision triggers) moves
 * `corpus_revision`; as the last connection it could also checkpoint the WAL. A report now opens its own read-only
 * connection and loads neither the client nor the materialisation module. A normal build is unchanged, which the
 * contrast test pins. Synthetic world only; every database here is a disposable copy.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'server/scripts/buildRecruitingHistory.js');
let dir; let dbPath;
const build = (args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RECRUITMATCH_DB: dbPath } }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };
const read = (sql) => { const db = new Database(dbPath, { readonly: true }); try { return db.prepare(sql).get(); } finally { db.close(); } };
const revision = () => read('SELECT revision AS n FROM corpus_revision').n;
const arrivals = () => read('SELECT COUNT(*) AS n FROM recruiting_arrivals').n;
const builds = () => read('SELECT COUNT(*) AS n FROM recruiting_arrivals_build').n;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p8b4-report-')); dbPath = path.join(dir, 'w.sqlite'); buildRegressionWorld(dbPath); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('--report writes nothing, physically or logically', () => {
  it('leaves the main file, the WAL, corpus_revision, the arrivals and the build record exactly as they were', () => {
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite'));
    const files = physicalState(dbPath); const rev = revision(); const arr = arrivals(); const bld = builds();
    expect(files.walBytes).toBeGreaterThan(0);

    const r = build(['--report']);

    expect(r.code).toBe(0); expect(r.out).toMatch(/REPORT ONLY — nothing written\./); expect(r.out).toMatch(/mens-soccer/);
    expect(physicalState(dbPath)).toEqual(files);                    // not folded, not migrated
    expect(revision()).toBe(rev); expect(arrivals()).toBe(arr); expect(builds()).toBe(bld);
  });

  it('on a plain (non-WAL) database the main file is byte-identical too', () => {
    const files = physicalState(dbPath);
    const r = build(['--report', '--sport', 'womens-soccer']);
    expect(r.code).toBe(0); expect(r.out).toMatch(/REPORT ONLY/);
    expect(physicalState(dbPath).main).toBe(files.main);              // the main file is byte-identical
  });
});

describe('a normal build is unchanged', () => {
  it('still loads the client, rebuilds the arrivals, records the build, and says so', () => {
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite'));
    const files = physicalState(dbPath); const bld = builds();

    const r = build(['--canonical']);

    expect(r.code).toBe(0); expect(r.out).toMatch(/recruiting_arrivals rebuilt\./); expect(r.out).not.toMatch(/REPORT ONLY/);
    expect(builds()).toBeGreaterThan(bld);                            // recordBuild ran: the write path is untouched
    expect(physicalState(dbPath)).not.toEqual(files);                 // and a real build does change the database (the contrast the report must not show)
  });
});
