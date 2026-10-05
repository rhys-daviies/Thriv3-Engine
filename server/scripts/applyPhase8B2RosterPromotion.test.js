import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld, rosterPage } from '../lib/refresh/regressionWorld.js';
import { stageRefresh, writeStagedBatch, loadStagedBatch, stableJson } from '../lib/refresh/staging.js';
import { planPromotion } from '../lib/refresh/promotion.js';
import { conformRosterRow } from '../lib/refresh/rosterRowConformance.js';
import { walShapedCopy, physicalState } from '../../shared/testing/walShape.js';

/**
 * PHASE 8B.2 — the fixture applier's safety properties, on the synthetic regression world (RFC 2606 hosts,
 * invented people). The applier is a CLI, so every test drives the real command.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'server/scripts/applyPhase8B2RosterPromotion.js');
const PROG = 'Concordia University Texas';
let dir; let dbPath; let fxPath; let fxHash; let manifest; let ids;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const run = (args, { acknowledge = true } = {}) => { const r = spawnSync(process.execPath, [SCRIPT, '--db', dbPath, ...args, ...(acknowledge ? ['--canonical'] : [])], { cwd: ROOT, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const apply = (extra = []) => run(['--fixture', fxPath, '--fixture-hash', fxHash, '--apply', '--manifest-out', manifest, '--allow-ephemeral-manifest', ...extra]);
const CANON = ['colleges', 'coaches', 'athletics_domains', 'athletics_entities', 'institution_aliases', 'programme_membership_periods', 'programme_row_links', 'coach_seasons', 'roster_players', 'player_observation_links'];
const canon = () => { const db = new Database(dbPath, { readonly: true }); const h = sha(CANON.map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).raw().all())).join('|')); db.close(); return h; };
const q = (sql, ...p) => { const db = new Database(dbPath, { readonly: true }); try { return db.prepare(sql).get(...p); } finally { db.close(); } };

/** A fixture for the staged batch: two promotable players, one staff row (HELD), one verified continuation + prior. */
function makeFixture({ mutate } = {}) {
  const db = new Database(dbPath);
  const input = { season: 2027, scope: 'NAIA', parser_version: 'test-1', gathered_at: '2027-08-20T00:00:00Z', pages: [rosterPage({ players: [
    { player_name: 'Robin Rookie', class_year_label: 'Fr.', nationality: 'Denmark' },
    { player_name: 'Jordan Joiner', class_year_label: 'So.', position: 'DF' },
    { player_name: 'Coach Carter', position: 'Head Coach' },
  ] })] };
  const staged = stageRefresh(db, input); writeStagedBatch(db, staged);
  const { batch, observations } = loadStagedBatch(db, staged.batch.batch_id);
  const ops = planPromotion({ batch, observations }, { frozen: new Set([2025]) }).ops.filter((o) => o.action === 'INSERT_ROSTER_ROW');
  const robin = ops.find((o) => o.proposed.player_name === 'Robin Rookie');
  const link = { link_id: 'PL-test-1', relation: 'SAME_PROGRAMME_CONTINUATION', to_observation_id: robin.insert_id, from_observation_id: 'r-a26', sport: 'mens-soccer', to_programme: PROG, to_season: '2027', from_programme: PROG, from_season: '2026', decision: 'VERIFIED_SAME_PERSON', evidence_class: 'PROGRAMME_SCOPED', evidence_json: JSON.stringify({ signals: {} }), evidence_id: null, method: 'test', reviewed_at: null, reviewed_by: null, review_note: null };
  const body = {
    phase: '8B.2', fixture_version: 2, scope: 'synthetic',
    inputs: { staged_batch_id: batch.batch_id, staged_batch_hash: batch.batch_hash, staged_observations: observations.length },
    roster_insert: ops.map((o) => ({ observation_id: o.observation_id, roster_id: o.insert_id, action: 'INSERT_ROSTER_ROW', classification: 'AUTO_SAFE', expected_old: o.expected, proposed: conformRosterRow(o.proposed), provenance: { source_url: o.proposed.source_roster_url }, identity_consequence: { links: [], prior_programme: o === robin ? PROG : null }, reason: 'test', blast_radius: 'one row' })).sort((a, b) => a.observation_id.localeCompare(b.observation_id)),
    link_insert: [{ link_id: link.link_id, expected_old: 'ABSENT', proposed: link, reason: 'test' }], link_update: [],
    prior_change: [{ roster_id: robin.insert_id, expected_old: null, proposed: PROG, reason: 'test' }],
    held: observations.filter((o) => o.classification === 'SOURCE_UNTRUSTED').map((o) => ({ observation_id: o.observation_id, classification: 'HELD' })), contradiction: [], noop_already_present: [], review: [],
  };
  if (mutate) mutate(body);
  const fixture = { ...body, fixture_hash: sha(stableJson(body)) };
  db.close(); return { fixture, ids: { robin: robin.insert_id, jordan: ops.find((o) => o.proposed.player_name === 'Jordan Joiner').insert_id, staff: observations.find((o) => o.classification === 'SOURCE_UNTRUSTED').observation_id, batch: batch.batch_id } };
}
const install = (opts) => { const { fixture, ids: i } = makeFixture(opts); ids = i; fxHash = fixture.fixture_hash; fs.writeFileSync(fxPath, JSON.stringify(fixture)); };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p8b2-apply-')); dbPath = path.join(dir, 'w.sqlite'); fxPath = path.join(dir, 'fixture.json'); manifest = path.join(dir, 'manifest.json'); buildRegressionWorld(dbPath); install(); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('preconditions refuse before anything is written', () => {
  it('a wrong fixture hash', () => {
    const before = canon(); const r = run(['--fixture', fxPath, '--fixture-hash', 'deadbeef', '--apply', '--manifest-out', manifest, '--allow-ephemeral-manifest']);
    expect(r.code).toBe(1); expect(r.err).toMatch(/fixture hash mismatch/); expect(canon()).toBe(before); expect(fs.existsSync(manifest)).toBe(false);
  });
  it('an edited fixture (hash no longer matches its body)', () => {
    const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8')); fx.roster_insert[0].proposed.player_name = 'Someone Else'; fs.writeFileSync(fxPath, JSON.stringify(fx));
    expect(run(['--fixture', fxPath, '--fixture-hash', fxHash]).code).toBe(1);
  });
  it('--apply without a manifest, and with a temp-dir manifest', () => {
    const noManifest = run(['--fixture', fxPath, '--fixture-hash', fxHash, '--apply']); expect(noManifest.code).toBe(2); expect(noManifest.err).toMatch(/--manifest-out/);
    const tmp = run(['--fixture', fxPath, '--fixture-hash', fxHash, '--apply', '--manifest-out', manifest]); expect(tmp.code).toBe(2); expect(tmp.err).toMatch(/temp directory/);
    expect(q('SELECT COUNT(*) n FROM roster_players WHERE id=?', ids.jordan).n).toBe(0);
  });
  it('a write to a corpus outside this checkout without --canonical (reads stay free)', () => {
    const write = run(['--fixture', fxPath, '--fixture-hash', fxHash, '--apply', '--manifest-out', manifest, '--allow-ephemeral-manifest'], { acknowledge: false });
    expect(write.code).not.toBe(0); expect(write.err).toMatch(/SHARED canonical corpus/); expect(q('SELECT COUNT(*) n FROM roster_players WHERE id=?', ids.jordan).n).toBe(0);
    expect(run(['--fixture', fxPath, '--fixture-hash', fxHash], { acknowledge: false }).code).toBe(0);   // dry run needs no acknowledgement
  });
  it('a VERIFIED link that stands on non-factual evidence', () => {
    install({ mutate: (b) => { b.link_insert[0].proposed.evidence_class = 'NAME_ONLY'; } });
    const r = run(['--fixture', fxPath, '--fixture-hash', fxHash]); expect(r.code).toBe(1); expect(r.err).toMatch(/VERIFIED with evidence class NAME_ONLY/);
  });
  it('a fixture row that is not the conformed staged proposal (e.g. smuggled DEFAULT-0-style or "2027.0"-style values)', () => {
    install({ mutate: (b) => { b.roster_insert[0].proposed = { ...b.roster_insert[0].proposed, source_page_season: 2027 }; } });
    const r = run(['--fixture', fxPath, '--fixture-hash', fxHash]); expect(r.code).toBe(1); expect(r.err).toMatch(/differs from the fixture row/);
  });
  it('a staged batch that was edited after the fixture was built', () => {
    const db = new Database(dbPath); db.prepare("UPDATE refresh_observations SET proposed_json=replace(proposed_json,'Jordan Joiner','Jordan Joyner') WHERE observation_id IN (SELECT observation_id FROM refresh_observations WHERE proposed_json LIKE '%Jordan Joiner%')").run(); db.close();
    const r = run(['--fixture', fxPath, '--fixture-hash', fxHash]); expect(r.code).toBe(1); expect(r.err).toMatch(/staging was edited/);
  });
  it('a held / contradicted observation presented as an insert', () => {
    install({ mutate: (b) => { const o = b.roster_insert[0]; b.roster_insert.push({ ...o, observation_id: 'RO-doesnotexist', roster_id: 'bogus-id' }); } });
    const r = run(['--fixture', fxPath, '--fixture-hash', fxHash]); expect(r.code).toBe(1); expect(r.err).toMatch(/not a promotable staged INSERT|staged observation missing/);
  });
});

describe('dry run and apply', () => {
  it('a dry run writes nothing', () => { const before = canon(); const r = run(['--fixture', fxPath, '--fixture-hash', fxHash]); expect(r.code).toBe(0); expect(r.out).toMatch(/roster \+2/); expect(r.out).toMatch(/DRY RUN/); expect(canon()).toBe(before); });

  it('applies exactly the fixture: strict values, NULL minutes, UNKNOWN position, nationality convention, link and prior', () => {
    const r = apply(); expect(r.code).toBe(0); expect(r.out).toMatch(/APPLIED — roster \+2, links \+1/);
    const robin = q('SELECT * FROM roster_players WHERE id=?', ids.robin); const jordan = q('SELECT * FROM roster_players WHERE id=?', ids.jordan);
    for (const x of [robin, jordan]) { expect(x.minutes_played).toBeNull(); expect(x.games_played).toBeNull(); expect(x.games_started).toBeNull(); expect(x.season).toBe('2027'); expect(x.source_page_season).toBe('2027'); expect(x.data_confidence).toBe('high'); }
    expect(robin).toMatchObject({ position: 'UNKNOWN', nationality: 'International', country: 'Denmark', prior_programme: PROG });
    expect(jordan).toMatchObject({ position: 'DF', nationality: null, prior_programme: null });
    expect(q('SELECT decision d FROM player_observation_links WHERE link_id=?', 'PL-test-1').d).toBe('VERIFIED_SAME_PERSON');
    expect(q('SELECT status s FROM refresh_batches WHERE batch_id=?', ids.batch).s).toBe('PROMOTED');
    expect(q("SELECT status s, ops_applied n FROM refresh_promotions").n).toBe(2);
  });

  it('writes the manifest BEFORE the commit, and never deletes or promotes HELD rows', () => {
    apply(); const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    expect(m.fixture_hash).toBe(fxHash); expect(m.manifest.length).toBeGreaterThan(4);
    expect(q('SELECT promoted_at p FROM refresh_observations WHERE observation_id=?', ids.staff).p).toBeNull();               // the staff row stays staged
    expect(q('SELECT classification c FROM refresh_observations WHERE observation_id=?', ids.staff).c).toBe('SOURCE_UNTRUSTED');
    expect(q('SELECT COUNT(*) n FROM refresh_observations WHERE promoted_at IS NOT NULL').n).toBe(2);
  });

  it('is idempotent: a second apply does nothing and a third dry run reports every action as a no-op', () => {
    apply(); const once = canon(); const r = apply(); expect(r.code).toBe(0); expect(r.out).toMatch(/Nothing to do: already applied/); expect(canon()).toBe(once);
    expect(run(['--fixture', fxPath, '--fixture-hash', fxHash]).out).toMatch(/roster \+0 \(noop 2\)/);
  });

  it('rolls EVERYTHING back on any failure and leaves no manifest (no partial apply)', () => {
    const db = new Database(dbPath);   // a player-season now held by someone else: the second insert's guard throws after the first has been written
    db.prepare("INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division, season, player_name) VALUES ('held-1','t','t',?,?,?,?,?)").run(PROG, 'mens-soccer', 'NAIA', '2027', 'Robin Rookie'); db.close();
    const before = canon(); const r = apply();
    expect(r.code).toBe(1); expect(r.err).toMatch(/ROLLED BACK/); expect(canon()).toBe(before);
    expect(q('SELECT COUNT(*) n FROM roster_players WHERE id=?', ids.jordan).n).toBe(0); expect(q('SELECT COUNT(*) n FROM player_observation_links WHERE link_id=?', 'PL-test-1').n).toBe(0);
    expect(q('SELECT status s FROM refresh_batches WHERE batch_id=?', ids.batch).s).toBe('STAGED'); expect(fs.existsSync(manifest)).toBe(false);
  });

  it('refuses an existing prior that is neither the expected-old nor the proposed value', () => {
    const db = new Database(dbPath); db.prepare("UPDATE roster_players SET prior_programme='Somewhere Else' WHERE id='r-a26'").run(); db.close();
    install({ mutate: (b) => { b.prior_change.push({ roster_id: 'r-a26', expected_old: null, proposed: PROG, reason: 'test' }); } });
    const r = run(['--fixture', fxPath, '--fixture-hash', fxHash]); expect(r.code).toBe(1); expect(r.err).toMatch(/prior r-a26: expected-old mismatch/);
  });
});

describe('reversal', () => {
  it('--revert-fixture restores the canonical state exactly, un-promotes the staging, and marks the audit row', () => {
    const before = canon(); apply(); expect(canon()).not.toBe(before);
    const dry = run(['--fixture', fxPath, '--fixture-hash', fxHash, '--revert-fixture']); expect(dry.out).toMatch(/REVERT-FROM-FIXTURE/); expect(dry.out).toMatch(/DRY RUN/); expect(q('SELECT COUNT(*) n FROM roster_players WHERE id=?', ids.jordan).n).toBe(1);
    const r = run(['--fixture', fxPath, '--fixture-hash', fxHash, '--revert-fixture', '--apply']); expect(r.code).toBe(0); expect(canon()).toBe(before);
    expect(q('SELECT status s FROM refresh_batches WHERE batch_id=?', ids.batch).s).toBe('STAGED'); expect(q('SELECT COUNT(*) n FROM refresh_observations WHERE promoted_at IS NOT NULL').n).toBe(0);
    expect(q('SELECT status s FROM refresh_promotions').s).toBe('REVERTED');
  });
  it('--revert <manifest> restores the canonical state exactly, audit row included, in one transaction', () => {
    const before = canon(); apply();
    const r = run(['--revert', manifest, '--apply']); expect(r.code).toBe(0); expect(r.out).toMatch(/REVERTED \d+ write/); expect(canon()).toBe(before);
    expect(q('SELECT status s FROM refresh_promotions').s).toBe('REVERTED'); expect(q('SELECT status s FROM refresh_batches WHERE batch_id=?', ids.batch).s).toBe('STAGED');
  });
  it('re-applies after a revert, reviving the audit row instead of colliding with it', () => {
    apply(); run(['--fixture', fxPath, '--fixture-hash', fxHash, '--revert-fixture', '--apply']);
    const r = apply(); expect(r.code).toBe(0); expect(r.out).toMatch(/APPLIED/);
    expect(q('SELECT COUNT(*) n FROM refresh_promotions').n).toBe(1); expect(q('SELECT status s FROM refresh_promotions').s).toBe('PROMOTED');
  });
  it('refuses to revert rows that were edited after the promotion', () => {
    apply(); const db = new Database(dbPath); db.prepare("UPDATE roster_players SET hometown='Edited, ZZ' WHERE id=?").run(ids.jordan); db.close();
    const r = run(['--fixture', fxPath, '--fixture-hash', fxHash, '--revert-fixture', '--apply']); expect(r.code).toBe(1); expect(r.err).toMatch(/revert refused/);
    expect(q('SELECT COUNT(*) n FROM roster_players WHERE id=?', ids.jordan).n).toBe(1);
  });
  it('flag order can never turn a revert into a forward apply', () => {
    for (const flags of [['--apply', '--revert-fixture'], ['--revert-fixture', '--apply']]) {
      const before = canon(); const r = run(['--fixture', fxPath, '--fixture-hash', fxHash, ...flags]);
      expect(r.out).toMatch(/REVERT-FROM-FIXTURE/); expect(r.out).not.toMatch(/APPLIED/); expect(canon()).toBe(before); expect(q('SELECT COUNT(*) n FROM roster_players WHERE id=?', ids.jordan).n).toBe(0);
    }
  });
});

/**
 * A DRY RUN IS OBSERVATIONAL — PHYSICALLY, NOT ONLY LOGICALLY.
 *
 * The first dry run against the shared development database opened it writable. As the last connection to
 * a WAL-mode database it checkpointed on close: the -wal file was folded into the main file and deleted.
 * No row moved, so a logical hash could not see it (the older "a dry run writes nothing" test compares only
 * that). These tests build the shape that exposed it — WAL mode, frames sitting in the -wal file, NO connection
 * open — and compare the main file and the WAL byte for byte.
 *
 * WHAT SQLITE MAY STILL DO, AND WHY IT IS NOT A DATA CHANGE: any reader of a WAL database may create or refresh
 * the `-shm` wal-index (a rebuildable cache of where pages sit in the WAL). It carries no data and is not
 * compared. The main file and the -wal file are.
 */
describe('a dry run is observational — the source database is not physically changed', () => {
  it('forward dry run: the main file and the WAL are byte-identical afterwards, the plan is the same', () => {
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite'));
    const logical = canon(); const before = physicalState(dbPath);
    expect(before.walBytes).toBeGreaterThan(0);                       // the shape that exposed the defect: a non-empty WAL

    const r = run(['--fixture', fxPath, '--fixture-hash', fxHash]);

    expect(r.code).toBe(0); expect(r.out).toMatch(/roster \+2 \(noop 0\)/); expect(r.out).toMatch(/DRY RUN/);
    expect(physicalState(dbPath)).toEqual(before);                                // main file + WAL: same bytes, same size, WAL not folded away
    expect(canon()).toBe(logical);
  });

  it('repeated dry runs print the same result and still leave the files alone', () => {
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite')); const before = physicalState(dbPath);
    const a = run(['--fixture', fxPath, '--fixture-hash', fxHash]); const b = run(['--fixture', fxPath, '--fixture-hash', fxHash]);
    expect(a.code).toBe(0); expect(b.out).toBe(a.out); expect(physicalState(dbPath)).toEqual(before);
  });

  it('a refused dry run (a precondition fails after the database is opened) leaves it alone too', () => {
    install({ mutate: (b) => { b.inputs.staged_batch_hash = '0'.repeat(64); } });          // refused: staged batch hash != fixture
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite')); const before = physicalState(dbPath); const logical = canon();
    const r = run(['--fixture', fxPath, '--fixture-hash', fxHash]);
    expect(r.code).toBe(1); expect(r.err).toMatch(/REFUSED/);
    expect(physicalState(dbPath)).toEqual(before); expect(canon()).toBe(logical);
  });

  it('both reversal dry runs (--revert-fixture, --revert <manifest>) are observational on an applied database', () => {
    expect(apply().code).toBe(0);                                     // a real apply on a disposable database, to have something to revert
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite')); const before = physicalState(dbPath); const logical = canon();

    const a = run(['--fixture', fxPath, '--fixture-hash', fxHash, '--revert-fixture']);
    const b = run(['--revert', manifest]);

    expect(a.code).toBe(0); expect(a.out).toMatch(/REVERT-FROM-FIXTURE/); expect(a.out).toMatch(/DRY RUN/);
    expect(b.code).toBe(0); expect(b.out).toMatch(/REVERT 8B\.2-roster-promotion/); expect(b.out).toMatch(/DRY RUN/);
    expect(physicalState(dbPath)).toEqual(before); expect(canon()).toBe(logical);
    expect(q('SELECT COUNT(*) n FROM roster_players WHERE id=?', ids.jordan).n).toBe(1);   // nothing was reverted
  });

  it('--apply still opens writable and works on the same WAL-shaped database, and is idempotent afterwards', () => {
    dbPath = walShapedCopy(dbPath, path.join(dir, 'live.sqlite'));
    const dry = run(['--fixture', fxPath, '--fixture-hash', fxHash]); expect(dry.out).toMatch(/roster \+2 \(noop 0\)/);

    const ap = apply();
    expect(ap.code).toBe(0); expect(ap.out).toMatch(/APPLIED — roster \+2/);
    expect(q('SELECT COUNT(*) n FROM roster_players WHERE id=?', ids.jordan).n).toBe(1);
    expect(fs.existsSync(manifest)).toBe(true);

    const after = physicalState(dbPath); const logical = canon();
    const again = run(['--fixture', fxPath, '--fixture-hash', fxHash]);          // idempotency: everything is a no-op, and observing it changes nothing
    expect(again.out).toMatch(/roster \+0 \(noop 2\)/);
    expect(physicalState(dbPath)).toEqual(after); expect(canon()).toBe(logical);
  });
});
