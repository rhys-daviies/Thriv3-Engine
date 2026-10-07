import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import db from '../db/client.js';
import { extendRefreshObservationDatasets } from '../db/migrate.js';
import { programmeContactsRouter } from '../routes/programmeContacts.js';
import { programmeContactId } from './programmeContactEligibility.js';

/**
 * PHASE 1B — PROGRAMME CONTACTS ARE INTELLIGENCE ONLY. Mechanical guards, not cautions:
 *
 *   1 only an allow-listed set of files may name programme contacts; a pursuit plan, a manual
 *     outreach route, a composer or a send path that starts reading them fails here first
 *   2 every outreach table still takes its recipient as coach_id NOT NULL REFERENCES coaches —
 *     there is no column through which a programme contact could be addressed
 *   3 the read-only route shows kind PROGRAMME_INBOX with sendable:false and only answers GET
 *   4 the staging-table rebuild that admits the PROGRAMME_CONTACT dataset carries every staged
 *     row across byte for byte, and is idempotent
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOKEN = /\bprogramme_contacts\b|programmeContacts|programmeContactEligibility|PROGRAMME_INBOX/;

/**
 * Files allowed to name programme contacts in this build. Adding a SEND path here is the
 * decision Step 1C+ exists to make deliberately — not something a refactor slips in.
 */
const ALLOWED = new Set([
  'server/db/schema.sql',
  'server/index.js',                              // mounts the read-only router
  'server/lib/programmeContactEligibility.js',
  'server/lib/programmeContacts.js',              // read layer
  'server/routes/programmeContacts.js',           // GET only
  'server/lib/refresh/changeClassifier.js',       // staging
  'server/lib/refresh/staging.js',
  'server/lib/refresh/promotion.js',              // the only writer
  'server/lib/refresh/integrityGate.js',
  'server/lib/refresh/integrityMeasure.js',
  'server/lib/refresh/freshness.js',
  'server/scripts/integrityMonitor.js',
  'server/scripts/integrityPromote.js',
  'server/scripts/validateProgrammeContacts.js',
  'server/scripts/programmeContactLeads.js',
  // Phase 1C: resolves a PROGRAMME_INBOX reference by id. No outreach row can produce one —
  // its SQL fragments join coaches only (recipient.test.js pins that) — so no send path reaches it.
  'server/lib/recipient.js',
]);

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'data', 'dist', 'build', 'uploads', 'reports', 'export'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(m?js|jsx|ts|tsx|sql)$/.test(e.name) && !/\.test\.(m?js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no send path can consume programme contacts', () => {
  it('only the allow-listed intelligence, integrity and read-only files name them', () => {
    const naming = ['server', 'shared', 'src', 'worker']
      .flatMap((d) => sourceFiles(path.join(ROOT, d)))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => TOKEN.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(naming.filter((rel) => !ALLOWED.has(rel))).toEqual([]);
    // and the scan is not vacuous: it finds every allow-listed file (a stale entry fails too)
    expect(naming.sort()).toEqual([...ALLOWED].sort());
  });

  it('the known send-path modules do not name them (belt and braces for the allow-list)', () => {
    const sendPath = ['server/lib/pursuitPolicy.js', 'server/lib/contactAttempts.js', 'server/lib/campaignAttribution.js', 'server/lib/programmeMessage.js',
      'server/lib/programmeMessages.js', 'server/lib/programmeMessageGeneration.js', 'server/lib/executionClaim.js', 'server/lib/executeProgrammeMessage.js',
      'server/lib/outreach.js', 'server/lib/outreachSend.js', 'server/lib/coachEligibility.js', 'server/lib/sendCap.js', 'server/lib/edgeSync.js',
      'server/lib/manualOutreachSafety.js', 'server/lib/manualContactStance.js', 'server/routes/manualOutreach.js', 'server/routes/sendOutreach.js',
      'server/routes/campaigns.js', 'server/routes/programmeCoaches.js', 'shared/coachRoles.js'];
    for (const f of sendPath) expect(TOKEN.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f).toBe(false);
  });

  it('every outreach table still addresses a COACH: coach_id NOT NULL REFERENCES coaches, and no programme-contact column', () => {
    for (const t of ['outreach', 'outreach_send', 'programme_contact_attempts', 'campaign_first_touch_approvals', 'programme_messages']) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all();
      expect(cols.find((c) => c.name === 'coach_id')?.notnull, t).toBe(1);
      expect(cols.filter((c) => /programme_contact(_id|s)?$|contact_kind|recipient_kind/.test(c.name)).map((c) => c.name), t).toEqual([]);
      expect(db.prepare(`PRAGMA foreign_key_list(${t})`).all().some((f) => f.from === 'coach_id' && f.table === 'coaches'), t).toBe(true);
      expect(db.prepare(`PRAGMA foreign_key_list(${t})`).all().some((f) => f.table === 'programme_contacts'), t).toBe(false);
    }
  });
});

describe('GET /api/colleges/:id/programme-contacts', () => {
  let server; let base;
  const T = '2026-09-01T00:00:00.000Z';
  beforeAll(async () => {
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-U990001', 'Route College', 990001, 'SINGLE', 'test', ?)").run(T);
    db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES ('c-route', ?, ?, 'Route College', 'womens-soccer', 'NCAA D3', 1, 990001, 'AE-U990001')").run(T, T);
    db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES ('routeathletics.example', 990001, 'VERIFIED', 'ATHLETICS_SITE', '[]', '[990001]', 'TEST', 'CERTAIN', ?)").run(T);
    const email = 'wsoccer@routeathletics.example'; const observed = new Date(Date.now() - 3600_000).toISOString();
    db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, 'AE-U990001', 'c-route', 'womens-soccer', ?, 'Route College Women''s Soccer', 'TEAM_INBOX', 'https://routeathletics.example/sports/womens-soccer/coaches', ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
      .run(programmeContactId('AE-U990001', 'womens-soccer', email), email, observed, observed, T, T);
    const app = express(); app.use(express.json()); app.use('/api', programmeContactsRouter);
    await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('returns the eligible inbox as kind PROGRAMME_INBOX, sendable:false, with provenance and no person fields', async () => {
    const res = await fetch(`${base}/api/colleges/c-route/programme-contacts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.programme).toMatchObject({ college_id: 'c-route', sport: 'womens-soccer' });
    expect(body.contacts).toEqual([expect.objectContaining({ kind: 'PROGRAMME_INBOX', label: "Route College Women's Soccer", email: 'wsoccer@routeathletics.example', contact_role: 'TEAM_INBOX', sendable: false })]);
    expect(body.contacts[0].provenance).toMatchObject({ observed_on_url: 'https://routeathletics.example/sports/womens-soccer/coaches', source_tier: 'A', freshness: 'CURRENT' });
    for (const k of ['coach_id', 'name', 'full_name', 'title', 'position_title']) expect(body.contacts[0]).not.toHaveProperty(k);
  });

  it('404s an unknown college and refuses every verb but GET', async () => {
    expect((await fetch(`${base}/api/colleges/nope/programme-contacts`)).status).toBe(404);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect((await fetch(`${base}/api/colleges/c-route/programme-contacts`, { method })).status).toBe(404);
  });
});

describe('the staging-table rebuild that admits PROGRAMME_CONTACT', () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-mig-')); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const PRE_1B = `CREATE TABLE refresh_observations (
    observation_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, dataset TEXT NOT NULL, raw_json TEXT NOT NULL, classification TEXT NOT NULL,
    proposed_json TEXT, promoted_at TEXT,
    CHECK (dataset IN ('COACH', 'ROSTER', 'PROGRAMME', 'DOMAIN')))`;
  const digest = (d) => crypto.createHash('sha256').update(JSON.stringify(d.prepare('SELECT * FROM refresh_observations ORDER BY observation_id').raw().all())).digest('hex');

  it('widens the CHECK, carries every row across unchanged, recreates the index, and is idempotent', () => {
    const d = new Database(path.join(dir, 'm.sqlite'));
    d.exec(PRE_1B); d.exec('CREATE INDEX idx_refresh_obs_batch ON refresh_observations(batch_id, dataset, classification)');
    const ins = d.prepare('INSERT INTO refresh_observations VALUES (?,?,?,?,?,?,?)');
    for (let i = 0; i < 50; i++) ins.run(`RO-${i}`, `RB-${i % 3}`, ['COACH', 'ROSTER', 'PROGRAMME', 'DOMAIN'][i % 4], `{"i":${i}}`, 'NEW_RECORD', i % 2 ? null : `{"x":"é ${i}"}`, i % 5 ? null : '2026-01-01');
    expect(() => ins.run('RO-x', 'RB', 'PROGRAMME_CONTACT', '{}', 'NEW_RECORD', null, null)).toThrow(/CHECK/);
    const before = digest(d);
    expect(extendRefreshObservationDatasets(d)).toBe(true);
    expect(digest(d)).toBe(before);
    expect(d.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_refresh_obs_batch'").get()).toBeTruthy();
    ins.run('RO-x', 'RB', 'PROGRAMME_CONTACT', '{}', 'NEW_RECORD', null, null);
    expect(() => ins.run('RO-y', 'RB', 'SOMETHING_ELSE', '{}', 'NEW_RECORD', null, null)).toThrow(/CHECK/);
    expect(extendRefreshObservationDatasets(d)).toBe(false);
    d.close();
  });

  it('the schema every fresh database is built from already admits it (and the rebuild is then a no-op)', () => {
    expect(extendRefreshObservationDatasets(db)).toBe(false);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='refresh_observations'").get().sql).toMatch(/'PROGRAMME_CONTACT'/);
  });
});
