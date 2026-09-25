/**
 * The reconciliation boundary, proven rather than promised.
 *
 * The rule this file exists to hold: a canonical import may correct what the
 * MACHINE measured and may never touch what a PERSON decided. Production has
 * an operator, decisions and operational data that the local corpus does not,
 * and the whole reason the whole-database copy was rejected is that it would
 * have destroyed them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import {
  buildArtefact, validateArtefact, planReconciliation, applyReconciliation,
  artefactDigest, datasetDigest, MACHINE_COLUMNS, HUMAN_COLUMNS, DATASETS,
  ARTEFACT_FORMAT, ARTEFACT_VERSION,
} from './canonicalProductArtefact.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server/db/schema.sql'), 'utf8');

/** A throwaway database with the real schema — never the working corpus. */
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-'));
  const d = new Database(path.join(dir, 't.sqlite'));
  d.exec(SCHEMA);
  return d;
}

const ACK = 'RECONCILE_CANONICAL_PRODUCT';
const TRUST = (o = {}) => ({
  season: '2025', college_name: 'Probe College', sport: 'mens-soccer',
  diagnosis: 'SEASON_IDENTITY_UNPROVEN', diagnosis_evidence: '{"probe":1}',
  diagnosed_at: '2026-09-01T00:00:00.000Z', ...o,
});
const STATUS = (o = {}) => ({
  school: 'Probe College', sport: 'mens-soccer', status: 'NOT_ACTIVE', reason: 'probe',
  active_from_season: null, active_to_season: null, evidence: 'the site lists no such programme',
  source_url: 'https://probe.test/', recorded_at: '2026-09-01T00:00:00.000Z',
  recorded_by_operator_id: null, ...o,
});

/** An artefact built by hand, so a test can state exactly what travels. */
function artefactOf({ status = [STATUS()], trust = [TRUST()] } = {}) {
  const datasets = {
    programme_status: {
      table: 'programme_status', mode: 'REPLACE',
      key: [...DATASETS.programme_status.key], columns: [...DATASETS.programme_status.columns],
      rows: status.length, digest: datasetDigest('programme_status', status), data: status,
    },
    roster_season_trust_machine: {
      table: 'roster_season_trust', mode: 'MERGE_MACHINE',
      key: [...DATASETS.roster_season_trust_machine.key],
      columns: [...DATASETS.roster_season_trust_machine.columns],
      rows: trust.length, digest: datasetDigest('roster_season_trust_machine', trust), data: trust,
    },
  };
  const source = { manifestVersion: 'V7', corpusDigest: 'a'.repeat(64) };
  return {
    format: ARTEFACT_FORMAT, version: ARTEFACT_VERSION,
    createdAt: new Date().toISOString(), source, datasets,
    digest: artefactDigest({ source, datasets }),
  };
}

let target;
beforeEach(() => { target = freshDb(); });

/* ------------------------------------------------------------------------ */

describe('the ownership boundary is the column list, not a convention', () => {
  it('defines machine columns as exactly the machine writer\'s INSERT', () => {
    /*
     * The definition is tied to the only writer of the machine half, so it
     * cannot drift: if `recordSeasonTrust.js` ever names another column, this
     * fails rather than silently importing it.
     */
    const src = fs.readFileSync(path.join(ROOT, 'server/scripts/recordSeasonTrust.js'), 'utf8');
    const m = src.match(/INSERT INTO roster_season_trust\s*\(([^)]*)\)/);
    expect(m).toBeTruthy();
    const declared = m[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
    expect([...MACHINE_COLUMNS].sort()).toEqual(declared);
  });

  it('never lists a human column as writable', () => {
    for (const c of HUMAN_COLUMNS) {
      expect(DATASETS.roster_season_trust_machine.columns).not.toContain(c);
    }
  });

  it('carries no auth or operational table', () => {
    const tables = Object.values(DATASETS).map((d) => d.table);
    for (const forbidden of [
      'operator_users', 'operator_sessions', 'players', 'campaigns', 'programme_messages',
      'outreach', 'outreach_send', 'outreach_evidence', 'connected_mailboxes',
      'connected_mailbox_credentials', 'generated_reports', 'suppressions', 'tracking_events',
      'athlete_programmes', 'recruiting_arrivals', 'recruiting_arrivals_build',
    ]) expect(tables).not.toContain(forbidden);
  });
});

describe('a machine import corrects the machine half and nothing else', () => {
  it('inserts a diagnosis where production has no row', () => {
    applyReconciliation(artefactOf(), { target, acknowledgement: ACK });
    const row = target.prepare('SELECT * FROM roster_season_trust').get();
    expect(row.diagnosis).toBe('SEASON_IDENTITY_UNPROVEN');
    for (const c of HUMAN_COLUMNS) expect(row[c]).toBeNull();
  });

  it('updates an existing diagnosis deterministically', () => {
    target.prepare(`INSERT INTO roster_season_trust
      (season, college_name, sport, diagnosis, diagnosis_evidence, diagnosed_at)
      VALUES ('2025','Probe College','mens-soccer','DEFINITE_MISMATCH','{"old":1}','2020-01-01T00:00:00.000Z')`).run();
    applyReconciliation(artefactOf(), { target, acknowledgement: ACK });
    const row = target.prepare('SELECT * FROM roster_season_trust').get();
    expect(row.diagnosis).toBe('SEASON_IDENTITY_UNPROVEN');
    expect(row.diagnosis_evidence).toBe('{"probe":1}');
    expect(row.diagnosed_at).toBe('2026-09-01T00:00:00.000Z');
    expect(target.prepare('SELECT COUNT(*) n FROM roster_season_trust').get().n).toBe(1);
  });

  it.each([
    ['RETAIN', 'kept after review'],
    ['EXCLUDE_FROM_EVIDENCE', 'removed after review'],
  ])('leaves an existing %s decision completely untouched', (disposition, why) => {
    target.prepare(`INSERT INTO roster_season_trust
      (season, college_name, sport, diagnosis, diagnosis_evidence, diagnosed_at,
       disposition, disposition_evidence, reviewed_at, reviewed_by_operator_id,
       next_action, previous_disposition, previous_reviewed_at)
      VALUES ('2025','Probe College','mens-soccer','DEFINITE_MISMATCH','{"old":1}','2020-01-01T00:00:00.000Z',
              @d, @why, '2026-05-05T12:00:00.000Z', 'op-production-only',
              'RE_ACQUIRE', 'RETAIN', '2026-04-04T00:00:00.000Z')`)
      .run({ d: disposition, why });

    const plan = applyReconciliation(artefactOf(), { target, acknowledgement: ACK });
    const row = target.prepare('SELECT * FROM roster_season_trust').get();

    // machine half corrected
    expect(row.diagnosis).toBe('SEASON_IDENTITY_UNPROVEN');
    // human half, every field of it, exactly as the person left it
    expect(row.disposition).toBe(disposition);
    expect(row.disposition_evidence).toBe(why);
    expect(row.reviewed_by_operator_id).toBe('op-production-only');
    expect(row.reviewed_at).toBe('2026-05-05T12:00:00.000Z');
    expect(row.next_action).toBe('RE_ACQUIRE');
    expect(row.previous_disposition).toBe('RETAIN');
    expect(row.previous_reviewed_at).toBe('2026-04-04T00:00:00.000Z');
    // and the plan said so before it happened
    expect(plan.roster_season_trust_machine.humanPreserved).toBe(1);
  });

  it('never removes a trust row the artefact does not mention', () => {
    target.prepare(`INSERT INTO roster_season_trust
      (season, college_name, sport, diagnosis, diagnosed_at)
      VALUES ('2024','Production Only','womens-soccer','DEFINITE_MISMATCH','2026-01-01T00:00:00.000Z')`).run();
    applyReconciliation(artefactOf(), { target, acknowledgement: ACK });
    expect(target.prepare("SELECT COUNT(*) n FROM roster_season_trust WHERE college_name = 'Production Only'")
      .get().n).toBe(1);
  });

  it('refuses an artefact that smuggles a human field', () => {
    const bad = artefactOf({ trust: [TRUST()] });
    bad.datasets.roster_season_trust_machine.data[0].disposition = 'RETAIN';
    const v = validateArtefact(bad, { target });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/human-owned field/);
  });
});

describe('programme_status is authoritative in full', () => {
  it('ends up matching the artefact exactly, removals included', () => {
    target.prepare(`INSERT INTO programme_status
      (school, sport, status, reason, evidence, source_url, recorded_at)
      VALUES ('Obsolete College','mens-soccer','NOT_ACTIVE','old','old','https://old.test/','2020-01-01T00:00:00.000Z')`).run();
    const plan = applyReconciliation(artefactOf(), { target, acknowledgement: ACK });
    const rows = target.prepare('SELECT school, sport, status FROM programme_status').all();
    expect(rows).toEqual([{ school: 'Probe College', sport: 'mens-soccer', status: 'NOT_ACTIVE' }]);
    expect(plan.programme_status.removed).toBe(1);
    expect(plan.programme_status.removedKeys).toEqual([['Obsolete College', 'mens-soccer']]);
  });

  it('is an upsert, not a delete-and-insert that loses nothing quietly', () => {
    target.prepare(`INSERT INTO programme_status
      (school, sport, status, reason, evidence, source_url, recorded_at)
      VALUES ('Probe College','mens-soccer','ACTIVE','stale','stale','https://old.test/','2020-01-01T00:00:00.000Z')`).run();
    applyReconciliation(artefactOf(), { target, acknowledgement: ACK });
    const r = target.prepare('SELECT * FROM programme_status').get();
    expect(r.status).toBe('NOT_ACTIVE');
    expect(r.reason).toBe('probe');
  });
});

describe('the gates', () => {
  const cases = {
    'unsupported version': (a) => { a.version = 99; },
    'wrong format': (a) => { a.format = 'something.else'; },
    'missing source identity': (a) => { delete a.source.corpusDigest; },
    'tampered row': (a) => { a.datasets.programme_status.data[0].status = 'ACTIVE'; },
    'row count lie': (a) => { a.datasets.programme_status.rows = 99; },
    'missing dataset': (a) => { delete a.datasets.programme_status; },
    'unknown dataset': (a) => { a.datasets.operator_users = { table: 'operator_users' }; },
    'unknown diagnosis': (a) => {
      a.datasets.roster_season_trust_machine.data[0].diagnosis = 'MADE_UP';
      a.datasets.roster_season_trust_machine.digest =
        datasetDigest('roster_season_trust_machine', a.datasets.roster_season_trust_machine.data);
      a.digest = artefactDigest(a);
    },
    'empty identity': (a) => {
      a.datasets.programme_status.data[0].school = '   ';
      a.datasets.programme_status.digest = datasetDigest('programme_status', a.datasets.programme_status.data);
      a.digest = artefactDigest(a);
    },
    'unknown sport': (a) => {
      a.datasets.programme_status.data[0].sport = 'quidditch';
      a.datasets.programme_status.digest = datasetDigest('programme_status', a.datasets.programme_status.data);
      a.digest = artefactDigest(a);
    },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    it(`refuses: ${name}`, () => {
      const a = artefactOf();
      mutate(a);
      expect(validateArtefact(a, { target }).ok).toBe(false);
      expect(() => applyReconciliation(a, { target, acknowledgement: ACK })).toThrow();
      expect(target.prepare('SELECT COUNT(*) n FROM programme_status').get().n).toBe(0);
    });
  }

  it('refuses to apply without the explicit acknowledgement', () => {
    expect(() => applyReconciliation(artefactOf(), { target })).toThrow(/acknowledgement/);
    expect(target.prepare('SELECT COUNT(*) n FROM programme_status').get().n).toBe(0);
  });

  it('refuses when the target lacks the table', () => {
    const bare = new Database(':memory:');
    expect(validateArtefact(artefactOf(), { target: bare }).ok).toBe(false);
  });
});

describe('the dry run writes nothing and predicts what apply does', () => {
  it('reports the same numbers the apply then produces', () => {
    target.prepare(`INSERT INTO roster_season_trust
      (season, college_name, sport, diagnosis, diagnosed_at, disposition, disposition_evidence,
       reviewed_at, reviewed_by_operator_id)
      VALUES ('2025','Probe College','mens-soccer','DEFINITE_MISMATCH','2020-01-01T00:00:00.000Z',
              'RETAIN','keep','2026-05-05T12:00:00.000Z','op-prod')`).run();
    const a = artefactOf();

    const dry = planReconciliation(a, { target });
    const before = target.prepare('SELECT * FROM roster_season_trust').get();
    expect(before.diagnosis).toBe('DEFINITE_MISMATCH');         // nothing written
    expect(target.prepare('SELECT COUNT(*) n FROM programme_status').get().n).toBe(0);

    const applied = applyReconciliation(a, { target, acknowledgement: ACK });
    expect(applied).toEqual(dry);
    expect(dry.roster_season_trust_machine.updated).toBe(1);
    expect(dry.roster_season_trust_machine.humanPreserved).toBe(1);
    expect(dry.programme_status.inserted).toBe(1);
  });
});

describe('the export is deterministic apart from its timestamp', () => {
  it('produces the same digest twice from an unchanged corpus', () => {
    const src = freshDb();
    src.prepare(`INSERT INTO programme_status
      (school, sport, status, reason, evidence, source_url, recorded_at)
      VALUES ('A','mens-soccer','NOT_ACTIVE','r','e','https://a.test/','2026-01-01T00:00:00.000Z')`).run();
    const a = buildArtefact({ source: src, now: new Date('2026-01-01') });
    const b = buildArtefact({ source: src, now: new Date('2026-06-06') });
    expect(a.digest).toBe(b.digest);
    expect(a.createdAt).not.toBe(b.createdAt);
  });
});

describe('an all-or-nothing transaction', () => {
  it('leaves the target untouched when a later dataset fails', () => {
    const a = artefactOf();
    // Valid to the validator, fatal to SQLite: NOT NULL on the machine half.
    a.datasets.roster_season_trust_machine.data[0].diagnosis = 'SEASON_IDENTITY_UNPROVEN';
    a.datasets.roster_season_trust_machine.data[0].diagnosed_at = undefined;
    a.datasets.roster_season_trust_machine.digest =
      datasetDigest('roster_season_trust_machine', a.datasets.roster_season_trust_machine.data);
    a.digest = artefactDigest(a);
    target.prepare('CREATE TRIGGER boom BEFORE INSERT ON roster_season_trust BEGIN SELECT RAISE(ABORT, "no"); END').run();
    expect(() => applyReconciliation(a, { target, acknowledgement: ACK })).toThrow();
    // programme_status is written first; the rollback must undo it too.
    expect(target.prepare('SELECT COUNT(*) n FROM programme_status').get().n).toBe(0);
  });
});
