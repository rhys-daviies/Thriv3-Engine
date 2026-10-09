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
 *   1 only an allow-listed set of files may name programme contacts. Since Step 1E that set
 *     includes selection (recipientSelection.js), typed planning, and the delivery boundaries —
 *     which name an inbox only to refuse it; composition and the manual staff lists still may not
 *   2 every outreach table addresses a coach OR a programme contact (exactly one), and only
 *     internal planning (contact attempts, first-touch approvals) ever writes an inbox
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
  // DI-03D: INTEGRITY, read-only — the correction engine measures inbox sendability before and after a
  // correction (and refuses any inbox a correction would open). It never selects, composes or sends.
  'server/lib/refresh/sendability.js',
  // Phase 1C: resolves a PROGRAMME_INBOX reference by id. No outreach row can produce one —
  // its SQL fragments join coaches only (recipient.test.js pins that) — so no send path reaches it.
  'server/lib/recipient.js',
  // Phase 1D: the recipient tables' foreign key to programme_contacts(contact_id)
  'server/db/migrate.js',
  // Phase 1E: SELECTION. The one place that chooses a programme inbox (named coach -> inbox -> none)
  'server/lib/recipientSelection.js',
  // Phase 1E: planning and safety carry a typed PROGRAMME_INBOX recipient through to an intent
  'server/lib/pursuitPolicy.js',
  'server/lib/campaignAttribution.js',             // stance + suppression on the inbox's address
  'server/lib/contactIntelligence.js',             // programme-level prior contact by recipient kind
  'server/lib/campaignExecution.js',               // currentRecipient: "Programme Contact", never a coach
  // Phase 1F: the typed delivery path — composition, persistence, relationship, provider, manual
  'server/lib/programmeMessage.js',                // composes an inbox with no name, "Hi Coach,"
  'server/lib/programmeMessages.js',               // persists the inbox's own address
  'server/lib/outreach.js',                        // a relationship with a VERIFIED inbox, by id
  'server/lib/v2/outreachProvenance.js',           // an inbox checked against a selection's programme
  'server/lib/executeProgrammeMessage.js',         // the provider: only the inbox's own address
  'server/lib/executionReadiness.js',              // reports the message's recipient kind
  'server/routes/sendOutreach.js',                 // manual: an inbox by id, never an address, never a coach row
  'server/routes/manualOutreach.js',               // offers the inbox only as the fallback
  'server/routes/campaigns.js',                    // the inbox's approval / generation routes
  // Phase 5 (PR A): DISPLAY ONLY. Turns the server's PROGRAMME_INBOX_ADDRESS_NOT_TYPED refusal
  // code into a sentence on the composer row; it reads a result, it cannot address or send.
  'src/lib/sendRefusal.js',
  'shared/recipientPresentation.js',               // "Programme Contact" and "Hi Coach,", once
  'src/lib/emailTemplate.js',                      // composes for a recipient kind
  'src/components/EmailComposer.jsx',              // the manual composer's programme-contact mode
  'src/components/CampaignProgrammeCard.jsx',      // presentation only
  'src/components/CampaignMessageDetail.jsx',      // presentation only
  'src/pages/player/CampaignTab.jsx',              // routes approve/generate by recipient kind
  // Phase 1G-B: the READ-ONLY legacy reconciliation dry run — finds each legacy row's verified
  // replacement and checks it against the floor; opens its database query_only and writes nothing
  'server/scripts/legacyReconciliationReport.js',
  // Phase 1G-E: the legacy reconciliation APPLY — writes only legacy_contact_reconciliation; names
  // programme_contacts solely to fingerprint it as a table the apply must leave unchanged
  'server/scripts/legacyReconciliationApply.js',
  // Phase 1G-D: the batch acquisition orchestrator — reads which programmes already hold a VERIFIED
  // contact (idempotency) on its OWN copies; every write goes through integrity:promote, never here
  'server/scripts/programmeContactAcquire.js',
  'server/lib/refresh/programmeContactAcquisition.js',  // its pure batching/outcome logic: no database, no send
]);

/** Phase 1F: the two boundaries that hand an ADDRESS to a provider, mailto or Outlook. */
const ADDRESS_BOUNDARIES = ['server/lib/executeProgrammeMessage.js', 'server/routes/sendOutreach.js'];

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

  it('the coach floor, the per-address safety rules and the manual STAFF list still do not name them', () => {
    const coachOnly = ['server/lib/coachEligibility.js', 'server/lib/sendCap.js', 'server/lib/edgeSync.js',
      'server/lib/manualOutreachSafety.js', 'server/lib/manualContactStance.js', 'server/routes/programmeCoaches.js', 'shared/coachRoles.js'];
    for (const f of coachOnly) expect(TOKEN.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f).toBe(false);
  });

  it('1F. every address boundary refuses an inbox address that was not addressed as one', () => {
    for (const f of ADDRESS_BOUNDARIES) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, f).toMatch(/isProgrammeInboxAddress\(/);
      expect(src, f).toMatch(/PROGRAMME_INBOX_ADDRESS_NOT_TYPED/);
    }
    // and the manual path proves the inbox is the programme's fallback, by id, before any write
    expect(fs.readFileSync(path.join(ROOT, 'server/routes/sendOutreach.js'), 'utf8')).toMatch(/assertManualProgrammeInbox\(/);
  });

  it('1F. the programme_contacts table is read only by selection, the typed delivery checks and the 1B readers', () => {
    const readers = ['server', 'shared', 'src', 'worker']
      .flatMap((d) => sourceFiles(path.join(ROOT, d)))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => /FROM\s+programme_contacts\b/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(readers.sort()).toEqual(['server/lib/campaignAttribution.js', 'server/lib/executeProgrammeMessage.js', 'server/lib/outreach.js',
      'server/lib/programmeContactEligibility.js', 'server/lib/programmeContacts.js', 'server/lib/recipient.js', 'server/lib/recipientSelection.js',
      'server/lib/refresh/integrityGate.js', 'server/lib/refresh/integrityMeasure.js', 'server/lib/refresh/promotion.js', 'server/lib/refresh/sendability.js', 'server/lib/refresh/staging.js',
      'server/lib/v2/outreachProvenance.js', 'server/scripts/integrityMonitor.js', 'server/scripts/legacyReconciliationReport.js', 'server/scripts/programmeContactAcquire.js', 'server/scripts/programmeContactLeads.js', 'server/scripts/validateProgrammeContacts.js']);
    for (const f of ['server/lib/pursuitPolicy.js', 'server/routes/sendOutreach.js', 'server/routes/manualOutreach.js']) expect(readers, f).not.toContain(f);
  });

  it('every outreach table can address a coach OR a programme contact — exactly one, both foreign keys enforced', () => {
    for (const t of ['outreach', 'outreach_send', 'programme_contact_attempts', 'campaign_first_touch_approvals', 'programme_messages']) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all();
      expect(cols.find((c) => c.name === 'coach_id')?.notnull, t).toBe(0);
      expect(cols.find((c) => c.name === 'programme_contact_id')?.notnull, t).toBe(0);
      const fks = db.prepare(`PRAGMA foreign_key_list(${t})`).all();
      expect(fks.some((f) => f.from === 'coach_id' && f.table === 'coaches' && f.to === 'id'), t).toBe(true);
      expect(fks.some((f) => f.from === 'programme_contact_id' && f.table === 'programme_contacts' && f.to === 'contact_id'), t).toBe(true);
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t).sql, t).toContain('CHECK ((coach_id IS NULL) <> (programme_contact_id IS NULL))');
    }
  });

  it('29/T. a programme inbox is written only by the five typed recipient writers, never by a route or the UI', () => {
    // Phase 1F: the attempt, the approval, the message, the relationship and the send — each in
    // the one library writer of its table, each behind the selection/eligibility checks.
    const INSERT = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)/gi;
    const writers = new Map();
    for (const rel of ['server', 'shared', 'src', 'worker'].flatMap((d) => sourceFiles(path.join(ROOT, d))).map((f) => path.relative(ROOT, f).split(path.sep).join('/'))) {
      if (rel.startsWith('server/db/')) continue;
      for (const m of fs.readFileSync(path.join(ROOT, rel), 'utf8').matchAll(INSERT)) {
        if (/\bprogramme_contact_id\b/.test(m[2])) writers.set(`${rel}:${m[1]}`, true);
      }
    }
    expect([...writers.keys()].sort()).toEqual([
      'server/lib/contactAttempts.js:programme_contact_attempts',
      'server/lib/firstTouchApprovals.js:campaign_first_touch_approvals',
      'server/lib/outreach.js:outreach',
      'server/lib/outreachSend.js:outreach_send',
      'server/lib/programmeMessages.js:programme_messages',
    ]);
    // and the reader never writes it
    expect(fs.readFileSync(path.join(ROOT, 'server/lib/recipient.js'), 'utf8')).not.toMatch(/\b(INSERT|UPDATE)\b[\s\S]{0,80}programme_contact_id/i);
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
