/**
 * DOES THE §3d EXCLUSION COVER EVERY RELATIONSHIP THE REHEARSAL WRITES?
 *
 * The no-collateral check excludes synthetic rows and everything that references
 * them, then requires every other row to be unchanged. If a rehearsal write
 * lands in a table the exclusion does not reach (an undeclared reference, a row
 * keyed by something other than the marker), that check would fail for a
 * reason that is not collateral damage, or worse, be loosened to pass.
 *
 * So this performs the rehearsal's own synthetic writes (R6, and the write paths
 * RB1/RB3 drive), through the real app functions with Outlook mocked, against a
 * database that also holds real-looking rows. Then it fingerprints before and
 * after, excluding synthetic rows. Every table must be identical. A table that
 * differs names a relationship the exclusion misses.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

vi.mock('./outlook.js', () => ({ isOutlookAvailable: () => true, composeInOutlook: vi.fn(async () => ({ ok: true, sent: false })) }));

const db = (await import('../db/client.js')).default;
const { Player } = await import('../db/entities/player.js');
const { seedPool } = await import('./v2/seedTestPool.js');
const { computeMatchmakingV2, clearContextCache } = await import('./v2/matchmakingService.js');
const { clearCorpusDigestCache } = await import('./v2/corpusIdentity.js');
const { persistRun } = await import('./v2/matchmakingRuns.js');
const { recordSelection, SELECTION_SOURCE } = await import('./v2/matchmakingSelection.js');
const { upsertAthleteProgramme } = await import('./athleteProgrammes.js');
const { sendOutreach } = await import('../routes/sendOutreach.js');
const { OUTREACH_ORIGIN } = await import('../../shared/outreachOrigin.js');
const { confirmManualDraftSent, discardManualDraft } = await import('./manualDraftConfirmation.js');
const { recordResponded, clearResponded } = await import('./engagementRollup.js');
const { recordOptOut } = await import('./optOut.js');
const { recordReply } = await import('./v2/replyIntake.js');
const { createOperator, createSession } = await import('./operatorAuth.js');
const { seedSendableCoach, corroborateFixtureCoaches } = await import('../testCanonicalCoaches.js');
const { fingerprint, compareFingerprints, DEFAULT_MARKER } = await import('./dbFingerprint.js');

let dir;
const T = '2026-10-01T00:00:00.000Z';
const SYN_COLLEGE = 'Rehearsal Synthetic College';
const snapshot = (name) => { const f = path.join(dir, name); fs.writeFileSync(f, db.serialize()); return f; };
/**
 * corpus_revision is ONE counter row (id = 1) that every corpus write bumps, through triggers.
 * No row-level exclusion can attribute it, so it is ignored BY NAME, and checked on its own below:
 * still one row, and the revision only went up.
 */
const COUNTERS = ['corpus_revision'];
const excludingSynthetic = (f) => fingerprint(f, { exclude: DEFAULT_MARKER, ignoreTables: COUNTERS });
const revisionOf = (f) => new Database(f, { readonly: true }).prepare('SELECT COUNT(*) n, MAX(revision) r FROM corpus_revision').get();
let before; let after; let revBefore; let revAfter;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-rehearsal-cov-'));

  // REAL rows: a ranked pool, a real athlete, a real coach and a real draft. These must not move.
  seedPool('mens-soccer');
  clearContextCache(); clearCorpusDigestCache();
  const realCoach = seedSendableCoach(db, { name: 'Real Coach', email: 'real.coach@seed.example', school: 'Seed M1' });
  const real = Player.create({ full_name: 'Real Athlete', sport: 'mens-soccer', position: 'CB', football_ability: 6, recruiting_class_year: 2028,
    state: 'CA', origin: 'USA', contribution_state: 'STATED', max_annual_contribution_usd: 25000,
    email: 'real.athlete@school.example', video_id: 'aqz-KE-bpKQ', video_chapters: JSON.stringify([{ t: 10, label: 'a' }, { t: 60, label: 'b' }, { t: 120, label: 'c' }]) });
  await sendOutreach({ athleteId: real.id, coaches: [{ name: 'Real Coach', email: 'real.coach@seed.example', title: 'Head Coach' }],
    subject: 's', body: 'Hi Coach,\n\nb', collegeName: 'Seed M1', division: 'NCAA D1', send: false, programmeCampaignId: null }, { origin: OUTREACH_ORIGIN.MANUAL });
  expect(realCoach).toBeTruthy();

  const fb = snapshot('before.sqlite');
  before = excludingSynthetic(fb);
  revBefore = revisionOf(fb);

  // ---- The rehearsal's synthetic writes (§3d), nothing else ----
  db.prepare(`INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at)
    VALUES ('RB-SYN-ENTITY', ?, 979999, 'SINGLE', 'rehearsal', ?)`).run(SYN_COLLEGE, T);
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id)
    VALUES ('RB-SYN-COLLEGE', ?, ?, ?, 'mens-soccer', 'NCAA D1', 1, 979999, 'RB-SYN-ENTITY')`).run(T, T, SYN_COLLEGE);
  db.prepare(`INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at)
    VALUES ('rehearsal.example.test', 979999, 'VERIFIED', 'ATHLETICS_SITE', '[]', '[979999]', 'REHEARSAL', 'CERTAIN', ?)`).run(T);
  const c1 = seedSendableCoach(db, { id: 'RB-SYN-COACH-1', name: 'Rehearsal Synthetic Coach 1', email: 'coach1@rehearsal.example.test', school: SYN_COLLEGE });
  const c2 = seedSendableCoach(db, { id: 'RB-SYN-COACH-2', name: 'Rehearsal Synthetic Coach 2', email: 'coach2@rehearsal.example.test', school: SYN_COLLEGE });
  corroborateFixtureCoaches(db, { ids: [c1, c2] });

  const op = await createOperator({ email: 'rehearsal-operator@rehearsal.example.test', password: 'rehearsal-only-Passw0rd!' });
  createSession(op.id ?? op.user?.id ?? db.prepare("SELECT id FROM operator_users WHERE email = 'rehearsal-operator@rehearsal.example.test'").get().id);

  const syn = Player.create({ full_name: 'Rehearsal Synthetic Athlete', sport: 'mens-soccer', position: 'CB', football_ability: 6, recruiting_class_year: 2028,
    state: 'CA', origin: 'USA', contribution_state: 'STATED', max_annual_contribution_usd: 25000, public_slug: 'rbsyn01',
    email: 'athlete@rehearsal.example.test', video_id: 'aqz-KE-bpKQ', video_chapters: JSON.stringify([{ t: 10, label: 'a' }, { t: 60, label: 'b' }, { t: 120, label: 'c' }]) });
  const player = Player.get(syn.id);
  clearContextCache();
  const result = computeMatchmakingV2(db, player);
  persistRun(db, player, result);                                            // runs + per-programme results (real colleges!)
  const inRun = result.programmes.find((x) => x.name === SYN_COLLEGE) ?? result.programmes[0];
  recordSelection(db, player, { collegeName: inRun.name, source: SELECTION_SOURCE.SPECIFIC_SEARCH });
  const rel = upsertAthleteProgramme(syn.id, { college_id: 'RB-SYN-COLLEGE' }).programme;
  expect(rel).toBeTruthy();

  const draft = (coach) => sendOutreach({ athleteId: syn.id, coaches: [coach], subject: 'Rehearsal', body: 'Hi Coach,\n\nRehearsal only.',
    collegeName: SYN_COLLEGE, division: 'NCAA D1', send: false, programmeCampaignId: null }, { origin: OUTREACH_ORIGIN.MANUAL });
  await draft({ name: 'Rehearsal Synthetic Coach 1', email: 'coach1@rehearsal.example.test', title: 'Head Coach' });
  await draft({ name: 'Rehearsal Synthetic Coach 2', email: 'coach2@rehearsal.example.test', title: 'Head Coach' });
  const sendOf = (coachId) => db.prepare(`SELECT s.id, s.outreach_id FROM outreach_send s JOIN outreach o ON o.id = s.outreach_id
    WHERE o.athlete_id = ? AND o.coach_id = ? ORDER BY s.sequence DESC`).get(syn.id, coachId);
  const s1 = sendOf(c1); const s2 = sendOf(c2);
  confirmManualDraftSent({ sendId: s1.id, athleteId: syn.id, collegeName: SYN_COLLEGE, sport: 'mens-soccer' });
  discardManualDraft({ sendId: s2.id, athleteId: syn.id, collegeName: SYN_COLLEGE, sport: 'mens-soccer' });
  await draft({ name: 'Rehearsal Synthetic Coach 1', email: 'coach1@rehearsal.example.test', title: 'Head Coach' });   // follow-up, sequence 2
  recordReply(db, { sendId: s1.id });
  recordResponded(s1.outreach_id, { respondedAt: new Date().toISOString().slice(0, 10) });
  clearResponded(s1.outreach_id);
  recordResponded(s1.outreach_id);
  recordOptOut(s2.outreach_id, { reason: 'manual', note: 'rehearsal' });

  const fa = snapshot('after.sqlite');
  after = excludingSynthetic(fa);
  revAfter = revisionOf(fa);
}, 60_000);

afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe('the rehearsal\'s synthetic writes are fully covered by the §3d exclusion', () => {
  it('every table, with synthetic rows and their dependants excluded, is identical before and after', () => {
    const r = compareFingerprints(before, after);
    expect(r.diffs, JSON.stringify(r.diffs, null, 1)).toEqual([]);
  });

  it('the one ignored table is the revision counter, and it only moved forward', () => {
    expect(revBefore.n).toBe(1);
    expect(revAfter.n).toBe(1);
    expect(Number(revAfter.r)).toBeGreaterThan(Number(revBefore.r));
    expect(after.ignoredTables).toEqual(['corpus_revision']);
  });

  it('and the writes really happened: the exclusion removed rows from each relationship the rehearsal exercises', () => {
    const ex = (t) => after.tables[t]?.excluded ?? 0;
    for (const t of ['colleges', 'athletics_entities', 'athletics_domains', 'coaches', 'coach_seasons', 'players',
      'operator_users', 'operator_sessions', 'matchmaking_runs', 'matchmaking_programme_results', 'matchmaking_selections',
      'athlete_programmes', 'outreach', 'outreach_send', 'outreach_send_event', 'engagement_rollup', 'suppressions']) {
      expect(ex(t), t).toBeGreaterThan(0);
    }
  });

  it('real rows are still there, and were not excluded', () => {
    expect(after.tables.players.rows).toBeGreaterThan(0);
    expect(after.tables.outreach.rows).toBeGreaterThan(0);
    expect(after.tables.colleges.rows).toBeGreaterThan(30);
  });
});
