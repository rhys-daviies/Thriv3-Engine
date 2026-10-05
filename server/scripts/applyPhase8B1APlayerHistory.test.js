import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld } from '../lib/refresh/regressionWorld.js';
import { walShapedCopy, physicalState } from '../../shared/testing/walShape.js';

/**
 * PHASE 8B.1A APPLIER — a dry run is observational, and apply is unchanged.
 *
 * The applier used to open its database writable even for a dry run. As the last connection to a WAL-mode
 * database it then checkpointed on close, folding the -wal file into the main file: a physical change to the
 * database although no row moved. The dry run (and the dry revert) now open it read-only; --apply opens it
 * writable exactly as before. Synthetic world only (RFC 2606 hosts, invented people).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'server/scripts/applyPhase8B1APlayerHistory.js');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let dir; let dbPath; let fxPath; let fxHash; let manifest;
const run = (args) => { const r = spawnSync(process.execPath, [SCRIPT, '--db', dbPath, ...args], { cwd: ROOT, encoding: 'utf8' }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };
const dry = () => run(['--fixture', fxPath, '--fixture-hash', fxHash]);
const apply = () => run(['--fixture', fxPath, '--fixture-hash', fxHash, '--apply', '--manifest-out', manifest]);
const evidenceCount = () => { const db = new Database(dbPath, { readonly: true }); try { return db.prepare('SELECT COUNT(*) n FROM player_prior_school_evidence').get().n; } finally { db.close(); } };

/** One evidence row to insert; no links, no priors: the smallest fixture the applier accepts. */
function writeFixture({ extra = {} } = {}) {
  const proposed = {
    evidence_id: 'EV-synthetic-1', observation_id: 'r-synthetic-1', source_url: 'https://concordiatx.example/sports/mens-soccer/roster/2026',
    observed_at: '2026-10-01T00:00:00Z', field_type: 'PREVIOUS_SCHOOL', raw_value: 'Synthetic State', resolution: 'COLLEGE',
    resolved_programmes: JSON.stringify(['Synthetic State']), resolved_entity: null, evidence_strength: 'STRUCTURED_COLLEGE',
    parser_version: 'test-1', recorded_at: '2026-10-01T00:00:00Z', ...extra,
  };
  const body = { evidence_insert: [{ label: 'synthetic evidence', expected_old: 'ABSENT', proposed, evidence: 'test', reason: 'test', blast_radius: 'none' }], link_insert: [], prior_set: [] };
  fxHash = sha(JSON.stringify(body));
  fs.writeFileSync(fxPath, JSON.stringify({ phase: '8B.1A-player-history', created_at: '2026-10-05T00:00:00Z', fixture_hash: fxHash, ...body }));
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p8b1a-apply-')); dbPath = path.join(dir, 'w.sqlite'); fxPath = path.join(dir, 'fixture.json'); manifest = path.join(dir, 'manifest.json'); buildRegressionWorld(dbPath); writeFixture(); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('a dry run is observational — the source database is not physically changed', () => {
  it('forward dry run: the main file and the WAL are byte-identical afterwards, and the plan is reported', () => {
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite')); const before = physicalState(dbPath);
    expect(before.walBytes).toBeGreaterThan(0);

    const r = dry();

    expect(r.code).toBe(0); expect(r.out).toMatch(/evidence \+1 \(noop 0\)/); expect(r.out).toMatch(/DRY RUN/);
    expect(physicalState(dbPath)).toEqual(before);
    expect(evidenceCount()).toBe(0);
  });

  it('a refused dry run (the evidence row exists with different content) leaves it alone too', () => {
    const db = new Database(dbPath);
    db.prepare(`INSERT INTO player_prior_school_evidence (evidence_id, observation_id, source_url, observed_at, field_type, raw_value, resolution, resolved_programmes, resolved_entity, evidence_strength, parser_version, recorded_at)
      VALUES ('EV-synthetic-1','r-synthetic-1','https://concordiatx.example/other','2026-10-01T00:00:00Z','PREVIOUS_SCHOOL','Different','COLLEGE','[]',NULL,'STRUCTURED_COLLEGE','test-1','2026-10-01T00:00:00Z')`).run();
    db.close();
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite')); const before = physicalState(dbPath);

    const r = dry();

    expect(r.code).toBe(1); expect(r.err).toMatch(/REFUSED/);
    expect(physicalState(dbPath)).toEqual(before);
  });

  it('the dry revert is observational on an applied database', () => {
    expect(apply().code).toBe(0);
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite')); const before = physicalState(dbPath);

    const r = run(['--revert', manifest]);

    expect(r.code).toBe(0); expect(r.out).toMatch(/REVERT 8B\.1A-player-history/); expect(r.out).toMatch(/DRY RUN/);
    expect(physicalState(dbPath)).toEqual(before);
    expect(evidenceCount()).toBe(1);                                  // nothing was reverted
  });
});

describe('--apply is unchanged', () => {
  it('opens writable, writes the evidence and a manifest, and is idempotent afterwards', () => {
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite'));
    const ap = apply();
    expect(ap.code).toBe(0); expect(ap.out).toMatch(/APPLIED — 1 action/);
    expect(evidenceCount()).toBe(1); expect(fs.existsSync(manifest)).toBe(true);

    const after = physicalState(dbPath);
    const again = dry();                                              // everything is a no-op, and observing that changes nothing
    expect(again.out).toMatch(/evidence \+0 \(noop 1\)/);
    expect(physicalState(dbPath)).toEqual(after);
  });

  it('a real revert still removes what the apply wrote', () => {
    expect(apply().code).toBe(0); expect(evidenceCount()).toBe(1);
    const r = run(['--revert', manifest, '--apply']);
    expect(r.code).toBe(0); expect(r.out).toMatch(/REVERTED/);
    expect(evidenceCount()).toBe(0);
  });
});
