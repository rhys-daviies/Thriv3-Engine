import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { corroborateFixtureCoaches, makeCoachesSendable } from '../testCanonicalCoaches.js';

/**
 * DI-08 PHASE 2 — EVERY SEND BOUNDARY ASKS THE RECRUITMENT-YEAR GATE.
 *
 * Part 1 enumerates, from source, every place a message can leave or be recorded as leaving —
 * the send primitives — and requires each to be one of the governed boundaries that asks the gate.
 * A new path that calls a primitive without being added here (and gated) fails this file.
 *
 * Part 2 drives each boundary for real on a throwaway database: the manual send function every
 * manual path shares (sendOutreach: the /api/outreach/send composer, Specific Search's manual
 * route, the drafting CLI), the manual relationship route, the programme-inbox fallback, the claim
 * of an approved campaign message (automated campaigns, the approval workflow's execution), and the
 * retry of a refused execution. Outlook and the provider transport are mocked; nothing is sent.
 */
delete process.env.THRIV3_ALLOW_LEGACY_COACHES;

/* =============================================================================================== */
/* Part 1 — the send primitives and who may call them                                              */
/* =============================================================================================== */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function sourceFiles(dir, out = []) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return out;
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', '.git', 'uploads', 'data'].includes(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(rel, out);
    else if (/\.(m?js|jsx)$/.test(e.name) && !/\.test\.(m?js|jsx)$/.test(e.name)) out.push(rel.split(path.sep).join('/'));
  }
  return out;
}
const FILES = ['server', 'shared', 'src', 'worker', 'tools'].flatMap((d) => sourceFiles(d));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * THE SEND PRIMITIVES. Each hands a message to a mail client or provider, records a send, or claims
 * one for a provider. Keyed by the module that DEFINES it (which may mention its own name).
 */
const PRIMITIVES = {
  composeInOutlook: 'server/lib/outlook.js',             // AppleScript compose / send
  attemptSend: 'server/lib/outboundTransport.js',        // the provider transport
  recordDraft: 'server/lib/outreachSend.js',             // the outreach_send row a send is recorded on
  claimSendForExecution: 'server/lib/outreachSend.js',   // a provider claim
  createOutreach: 'server/lib/outreach.js',              // the relationship a send mints a link for
  buildHandoff: 'server/lib/emailHandoff.js',            // the governed mailto handoff
};
/**
 * THE GOVERNED BOUNDARIES, and how each one asks the gate. Closed: a new caller of any primitive
 * fails below until it is added here WITH its gate.
 */
const BOUNDARIES = {
  'server/routes/sendOutreach.js': 'asks recruitmentYearDecision in its per-recipient loop; records drafts only through recordDraftWithGate',
  'server/lib/executionClaim.js': 'assertExecutionSafety asks assertRecruitmentYearEligible; CLAIM records the ALLOW with the send',
  'server/lib/executionRetry.js': 'calls assertExecutionSafety (the same gate) and records the ALLOW with the re-attempt',
  'server/lib/executeProgrammeMessage.js': 'transmits only what claimProgrammeMessageForExecution / reclaimRefusedExecution returned',
};
/**
 * Callers that are NOT send paths, each for a stated reason (the same allowance outreachBypass.test.js
 * makes): local engagement fixtures that create outreach rows so screens have something to render.
 * They hold no send primitive (asserted below), so they cannot mail anybody.
 */
const NOT_A_SEND_PATH = {
  'server/seed/seedEngagement.js': 'local engagement fixtures (createOutreach only)',
  'server/seed/simulateEngagement.js': 'local engagement fixtures (createOutreach only)',
};
const callsOf = (src, name) => (src.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) || []).length;

describe('Part 1: every send primitive is reached only through a gated boundary', () => {
  it('found the source to scan', () => { expect(FILES.length).toBeGreaterThan(100); });

  it('the callers of every send primitive are exactly the governed boundaries (a new path fails here)', () => {
    const callers = new Set();
    for (const f of FILES) {
      const src = read(f);
      for (const [name, home] of Object.entries(PRIMITIVES)) {
        if (f === home) continue;
        // a definition or an import is not a call; a call is `name(` not preceded by `function `
        const calls = (src.match(new RegExp(`(?<!function\\s)(?<!\\.)\\b${name}\\s*\\(`, 'g')) || []).length;
        if (calls > 0) callers.add(f);
      }
    }
    expect([...callers].filter((f) => !NOT_A_SEND_PATH[f]).sort()).toEqual(Object.keys(BOUNDARIES).sort());
    for (const f of Object.keys(NOT_A_SEND_PATH)) {
      expect(read(f), f).not.toMatch(/composeInOutlook|attemptSend|recordDraft|claimSendForExecution|sendOutreach|buildHandoff|nodemailer|smtp/i);
    }
  });

  it('sendOutreach asks the gate for every recipient and writes a draft only with the decision', () => {
    const src = read('server/routes/sendOutreach.js');
    expect(callsOf(src, 'recruitmentYearDecision')).toBe(1);
    expect(callsOf(src, 'recordGateRefusal')).toBeGreaterThanOrEqual(1);
    // the only direct recordDraft call is inside recordDraftWithGate, beside recordGateDecision
    expect(callsOf(src, 'recordDraft')).toBe(1);
    expect(src).toMatch(/const recordDraftWithGate = \(args\) => db\.transaction\(\(\) => \{\s*const draft = recordDraft\(args\);\s*recordGateDecision\(/);
    // the gate is asked after the floor and before the relationship is minted
    const gate = src.indexOf('recruitmentYearDecision({'); const floor = src.indexOf('recipientIneligibility({ email'); const mint = src.indexOf('createOutreach({ athleteId');
    expect(floor).toBeGreaterThan(0); expect(gate).toBeGreaterThan(floor); expect(mint).toBeGreaterThan(gate);
  });

  it('the claim and the retry both pass assertExecutionSafety, which asks the gate', () => {
    const claim = read('server/lib/executionClaim.js');
    const safety = claim.slice(claim.indexOf('export function assertExecutionSafety('), claim.indexOf('const CLAIM = db.transaction('));
    expect(callsOf(safety, 'assertRecruitmentYearEligible')).toBe(1);
    expect(callsOf(claim.slice(claim.indexOf('const CLAIM = db.transaction(')), 'assertExecutionSafety')).toBe(1);
    expect(callsOf(claim, 'recordGateDecision')).toBe(1);
    const retry = read('server/lib/executionRetry.js');
    expect(callsOf(retry, 'assertExecutionSafety')).toBe(1);
    expect(callsOf(retry, 'recordGateDecision')).toBe(1);
    expect(callsOf(retry, 'recordRecruitmentGateRefusal')).toBe(1);
  });

  it('the provider transport is reached only after a claim or a reclaim', () => {
    const src = read('server/lib/executeProgrammeMessage.js');
    expect(callsOf(src, 'attemptSend')).toBe(1);
    expect(callsOf(src, 'claimProgrammeMessageForExecution')).toBe(1);
    expect(callsOf(src, 'reclaimRefusedExecution')).toBe(1);
  });

  it('every caller of sendOutreach is a route or script that therefore passes the gate', () => {
    const callers = FILES.filter((f) => f !== 'server/routes/sendOutreach.js' && /\bsendOutreach\s*\(/.test(read(f)));
    expect(callers.sort()).toEqual(['server/index.js', 'server/routes/manualOutreach.js', 'server/scripts/draftOutreach.js']);
  });
});

/* =============================================================================================== */
/* Part 2 — each boundary, driven                                                                   */
/* =============================================================================================== */

const composed = [];
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => { composed.push(message); return { ok: true, sent: false }; }),
}));
const { transportBehaviour } = vi.hoisted(() => ({ transportBehaviour: { current: null, calls: [] } }));
vi.mock('../lib/productionTransport.js', async () => {
  const { fakeTransport } = await import('../lib/outboundTransport.js');
  return {
    productionTransport() {
      if (!transportBehaviour.current) return null;
      const inner = fakeTransport(transportBehaviour.current);
      return { ...inner, async send(request) { transportBehaviour.calls.push({ ...request }); return inner.send(request); } };
    },
  };
});

const db = (await import('../db/client.js')).default;
const { sendOutreach } = await import('./sendOutreach.js');
const { manualOutreachRouter } = await import('./manualOutreach.js');
const { campaignsRouter } = await import('./campaigns.js');
const { upsertAthleteProgramme } = await import('../lib/athleteProgrammes.js');
const { programmeContactId } = await import('../lib/programmeContactEligibility.js');
const { materialiseNextContactAttempt } = await import('../lib/pursuitPolicy.js');
const { reviewProgrammeMessage, programmeMessage } = await import('../lib/programmeMessages.js');
const { generateProgrammeMessage } = await import('../lib/programmeMessageGeneration.js');
const { TRANSPORT_OUTCOME } = await import('../lib/outboundTransport.js');
const { createConnectedMailbox, storeMailboxCredential } = await import('../lib/connectedMailboxes.js');
const { GATE_CODE, RECIPIENT, recordRecruitmentCycleAuthorisation, recordProgrammeSeasonFielding } = await import('../lib/recruitmentYearGate.js');

const T = '2026-09-20T10:00:00.000Z';
const NOW = Date.now();
const iso = (deltaDays) => new Date(NOW + deltaDays * 86_400_000).toISOString();
const ATH = 'gate-athlete';               // entry 2027
const ATH26 = 'gate-athlete-2026';        // entry 2026
const OPERATOR = 'op-gate';
const BODY = 'Hi Coach,\n\nI am writing about Marcus Reyes.\n\nBest regards,\nThriv3';
let baseUrl; let unit = 970000; let seq = 0;

const squad = (k = 20) => Array.from({ length: k }, (_, i) => `Player ${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);
/**
 * One programme with a corroborated head coach and a verified inbox. `fielded`: 'roster' gives it a
 * page-season-verified 2026 roster (the real-world evidence); 'none' gives it nothing; 'future'
 * records FUTURE/LAUNCHING from 2027 on its official host.
 */
function programme(key, { fielded = 'roster', inbox = true } = {}) {
  unit += 1;
  const ent = `AE-U${unit}`; const host = `${key}athletics.example`; const name = `${key} College`;
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?, ?, ?, 'SINGLE', 'test', ?)").run(ent, name, unit, T);
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D3', 1, ?, ?)").run(`col-${key}`, T, T, name, unit, ent);
  db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, ?, 'VERIFIED', 'ATHLETICS_SITE', '[]', ?, 'TEST', 'CERTAIN', ?)").run(host, unit, JSON.stringify([unit]), T);
  const coachId = `co-${key}`;
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, currentness_status, currentness_source_url)
    VALUES (?, ?, ?, ?, ?, 'NCAA D3', 'mens-soccer', 'Head Coach', 'verified', ?, 'CURRENT', ?)`)
    .run(coachId, T, `Coach ${key}`, `head@${host}`, name, `https://${host}/sports/mens-soccer/coaches`, `https://${host}/sports/mens-soccer/coaches`);
  // corroborate the coach only (NOT corroborateFixtureCoaches' fielding attestation: this file sets fielding itself)
  db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, method, imported_at) VALUES (?, 'mens-soccer', 1901, ?, 'test-fixture', ?)").run(name, `Coach ${key}`, T);
  if (fielded === 'roster') {
    for (const p of squad()) {
      db.prepare(`INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division, season, player_name, source_page_season)
        VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D3', '2026', ?, '2026')`).run(randomUUID(), T, T, name, `${key} ${p}`);
    }
  }
  if (fielded === 'future') {
    db.prepare(`INSERT INTO programme_status (school, sport, status, reason, active_from_season, evidence, source_url, recorded_at)
      VALUES (?, 'mens-soccer', 'FUTURE', 'LAUNCHING', 2027, 'Coming in 2027', ?, ?)`).run(name, `https://${host}/sports/mens-soccer/roster`, T);
  }
  let pc = null; const email = `msoccer@${host}`;
  if (inbox) {
    pc = programmeContactId(ent, 'mens-soccer', email);
    const seen = new Date(NOW - 3600_000).toISOString();
    db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, ?, ?, 'mens-soccer', ?, ?, 'TEAM_INBOX', ?, ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
      .run(pc, ent, `col-${key}`, email, `${name} Men's Soccer`, `https://${host}/sports/mens-soccer/coaches`, seen, seen, T, T);
  }
  return { key, name, host, coachId, email: `head@${host}`, pc, inboxEmail: email };
}
const decisions = (where = '1=1') => db.prepare(`SELECT * FROM recruitment_gate_decisions WHERE ${where} ORDER BY decided_at, rowid`).all();
const sendsAt = (name) => db.prepare('SELECT COUNT(*) n FROM outreach_send WHERE college_name = ?').get(name).n;
const manualSend = (athleteId, p, entry) => sendOutreach({ athleteId, coaches: [entry], subject: 'Marcus Reyes', body: BODY, greetingName: 'Coach', collegeName: p.name, division: 'NCAA D3' });
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
};
function player(id, year) {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug, recruiting_class_year, email, video_id, video_chapters, nationality, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'Left Winger', 'mens-soccer', ?, ?, 'a@example.com', 'aqz-KE-bpKQ', ?, 'New Zealand', 3.8)`)
    .run(id, randomUUID().slice(0, 10), year, JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]));
}
function authorise(p, { athleteId = ATH, recipient = { kind: RECIPIENT.COACH, coachId: p.coachId } } = {}) {
  return recordRecruitmentCycleAuthorisation({
    athleteId, collegeName: p.name, sport: 'mens-soccer', entrySeason: 2027, recipient, consultantOperatorId: OPERATOR,
    programmeEvidenceUrl: `https://${p.host}/sports/mens-soccer/roster`, programmeEvidenceVerifiedAt: iso(-1),
    staffEvidenceUrl: `https://${p.host}/sports/mens-soccer/coaches`, staffEvidenceVerifiedAt: iso(-1), expiresAt: iso(30),
  });
}

let ENMU; let UWO; let UWO_AUTH; let OK; let OPT; let HELD; let UNKNOWN_INBOX;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.operator = { id: OPERATOR, email: `${OPERATOR}@t.test` }; next(); });
  app.use('/api', manualOutreachRouter); app.use('/api', campaignsRouter);
  await new Promise((resolve) => { const s = app.listen(0, () => { baseUrl = `http://127.0.0.1:${s.address().port}`; resolve(); }); s.unref(); });
  player(ATH, 2027); player(ATH26, 2026);
  db.prepare("INSERT INTO operator_users (id, email, password_hash, active, created_at) VALUES (?, ?, 'scrypt$fake', 1, 'x')").run(OPERATOR, `${OPERATOR}@thriv3.test`);
  ENMU = programme('enmu', { fielded: 'none' });                 // no season-verified evidence (the phantom-roster case)
  UWO = programme('uwo', { fielded: 'future' });                 // FUTURE from 2027, no authorisation
  UWO_AUTH = programme('uwoauth', { fielded: 'future' });        // FUTURE from 2027, authorised for ATH / its coach
  OK = programme('okay');                                        // fielded: a page-season-verified 2026 roster
  OPT = programme('optout');
  HELD = programme('held');
  UNKNOWN_INBOX = programme('silentinbox', { fielded: 'none' });
  for (const p of [ENMU, UWO, UWO_AUTH, OK, OPT, HELD, UNKNOWN_INBOX]) upsertAthleteProgramme(ATH, { college_id: `col-${p.key}`, request_state: 'requested', requested_by: 'athlete' });
  authorise(UWO_AUTH);
});
beforeEach(() => { composed.length = 0; transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED }; transportBehaviour.calls = []; });

describe('Part 2a: the manual send boundary (sendOutreach) — composer, Specific Search, CLI', () => {
  it('ENMU-like (no verified 2026 evidence): 2026 and 2027 entries are refused, review requested, nothing drafted', async () => {
    for (const athleteId of [ATH26, ATH]) {
      const { results } = await manualSend(athleteId, ENMU, { name: 'Coach enmu', email: ENMU.email, title: 'Head Coach' });
      expect(results[0]).toMatchObject({ status: 'not-eligible', reason: GATE_CODE.FIELDING_UNKNOWN, reviewRequested: true });
    }
    expect(sendsAt(ENMU.name)).toBe(0);
    expect(composed).toEqual([]);
    const rows = decisions(`college_name = '${ENMU.name}'`);
    expect(rows.map((r) => [r.boundary, r.outcome, r.code, r.review_requested, r.entry_season])).toEqual([
      ['MANUAL_SEND', 'BLOCK', GATE_CODE.FIELDING_UNKNOWN, 1, 2026], ['MANUAL_SEND', 'BLOCK', GATE_CODE.FIELDING_UNKNOWN, 1, 2027]]);
    expect(rows.every((r) => r.coach_id === ENMU.coachId && r.outreach_send_id === null)).toBe(true);
  });

  it('UW-Oshkosh-like: 2026 refused (not fielded); 2027 refused without an explicit authorisation', async () => {
    const r26 = await manualSend(ATH26, UWO, { name: 'Coach uwo', email: UWO.email, title: 'Head Coach' });
    expect(r26.results[0]).toMatchObject({ status: 'not-eligible', reason: GATE_CODE.PROGRAMME_NOT_FIELDED });
    const r27 = await manualSend(ATH, UWO, { name: 'Coach uwo', email: UWO.email, title: 'Head Coach' });
    expect(r27.results[0]).toMatchObject({ status: 'not-eligible', reason: GATE_CODE.FUTURE_PROGRAMME_NOT_AUTHORISED });
    expect(sendsAt(UWO.name)).toBe(0);
  });

  it('UW-Oshkosh-like 2027 WITH authorisation + fresh official evidence + the coach on the staff page: drafted, CONDITIONAL_ALLOW recorded with the draft', async () => {
    const { results } = await manualSend(ATH, UWO_AUTH, { name: 'Coach uwoauth', email: UWO_AUTH.email, title: 'Head Coach' });
    expect(results[0].status).toBe('drafted');
    const send = db.prepare('SELECT * FROM outreach_send WHERE college_name = ?').get(UWO_AUTH.name);
    const [row] = decisions(`college_name = '${UWO_AUTH.name}'`);
    expect(row).toMatchObject({ boundary: 'MANUAL_SEND', outcome: 'CONDITIONAL_ALLOW', code: GATE_CODE.FUTURE_PROGRAMME_AUTHORISED, outreach_send_id: send.id, entry_season: 2027 });
    expect(row.authorisation_id).toMatch(/^RCA-/);
    // the same authorisation does not open the 2026 athlete, nor the programme's inbox
    expect((await manualSend(ATH26, UWO_AUTH, { name: 'Coach uwoauth', email: UWO_AUTH.email, title: 'Head Coach' })).results[0].reason).toBe(GATE_CODE.PROGRAMME_NOT_FIELDED);
  });

  it('a previously valid active programme is unchanged: drafted, with an ALLOW linked to its draft', async () => {
    const { results } = await manualSend(ATH, OK, { name: 'Coach okay', email: OK.email, title: 'Head Coach' });
    expect(results[0].status).toBe('drafted');
    const send = db.prepare('SELECT * FROM outreach_send WHERE college_name = ?').get(OK.name);
    expect(decisions(`college_name = '${OK.name}'`)).toEqual([expect.objectContaining({ outcome: 'ALLOW', code: GATE_CODE.FIELDED_BY_CONTINUITY, evidence_basis: 'ROSTER_PAGE_SEASON', outreach_send_id: send.id, review_requested: 0 })]);
  });

  it('existing opt-outs and activation holds still refuse first, exactly as before (the gate adds, never replaces)', async () => {
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES (?, 'unsubscribed', 'manual', ?)").run(OPT.email, T);
    const opt = await manualSend(ATH, OPT, { name: 'Coach optout', email: OPT.email, title: 'Head Coach' });
    expect(opt.results[0].status).toBe('suppressed');
    const SEED = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/seeds/coach_activation_holds.json'), 'utf8'));
    const heldId = SEED.holds.find((h) => h.hold === 'PENDING_SEND_TIME_VERIFICATION').coach_id;
    db.prepare('UPDATE coaches SET id = ? WHERE id = ?').run(heldId, HELD.coachId);
    const held = await manualSend(ATH, HELD, { name: 'Coach held', email: HELD.email, title: 'Head Coach' });
    expect(held.results[0]).toMatchObject({ status: 'not-eligible', reason: 'COACH_ACTIVATION_HELD:PENDING_SEND_TIME_VERIFICATION' });
    // neither reached the gate: no decision recorded, no draft
    expect(decisions(`college_name IN ('${OPT.name}', '${HELD.name}')`)).toEqual([]);
    expect(sendsAt(OPT.name) + sendsAt(HELD.name)).toBe(0);
  });
});

describe('Part 2b: the programme-inbox fallback obeys the same rule', () => {
  it('an inbox at a programme with no verified evidence is refused through sendOutreach and the manual route', async () => {
    db.prepare('DELETE FROM coach_seasons WHERE school = ?').run(UNKNOWN_INBOX.name);   // uncorroborated coach: the inbox is the fallback
    const { results } = await manualSend(ATH, UNKNOWN_INBOX, { programmeContactId: UNKNOWN_INBOX.pc });
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: GATE_CODE.FIELDING_UNKNOWN, recipientKind: 'PROGRAMME_INBOX' });
    const rel = db.prepare('SELECT id FROM athlete_programmes WHERE athlete_id = ? AND college_name = ?').get(ATH, UNKNOWN_INBOX.name).id;
    const viaRoute = await api('POST', `/api/players/${ATH}/programmes/${rel}/outreach`, { programmeContactId: UNKNOWN_INBOX.pc, subject: 's', body: BODY, greetingName: 'Coach' });
    expect(viaRoute.status === 422 || viaRoute.body.results?.every((r) => r.status !== 'drafted')).toBe(true);
    expect(sendsAt(UNKNOWN_INBOX.name)).toBe(0);
    expect(decisions(`college_name = '${UNKNOWN_INBOX.name}'`).every((r) => r.recipient_kind === 'PROGRAMME_INBOX' && r.outcome === 'BLOCK' && r.programme_contact_id === UNKNOWN_INBOX.pc)).toBe(true);
  });
  it('a coach\'s future-programme authorisation does not open that programme\'s inbox', async () => {
    db.prepare('DELETE FROM coach_seasons WHERE school = ?').run(UWO_AUTH.name);
    const { results } = await manualSend(ATH, UWO_AUTH, { programmeContactId: UWO_AUTH.pc });
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: GATE_CODE.FUTURE_PROGRAMME_NOT_AUTHORISED });
  });
});

describe('Part 2c: the manual relationship route (Specific Search)', () => {
  it('refuses the ENMU-like coach by id with the gate\'s code and drafts nothing', async () => {
    const rel = db.prepare('SELECT id FROM athlete_programmes WHERE athlete_id = ? AND college_name = ?').get(ATH, ENMU.name).id;
    const res = await api('POST', `/api/players/${ATH}/programmes/${rel}/outreach`, { coachIds: [ENMU.coachId], subject: 's', body: BODY, greetingName: 'Coach' });
    expect(res.status === 422 || res.body.results?.every((r) => r.status !== 'drafted')).toBe(true);
    expect(sendsAt(ENMU.name)).toBe(0);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* Part 2d — the claim of an approved campaign message, and its retry                            */
/* -------------------------------------------------------------------------------------------- */

function mailbox(athleteId) {
  const box = createConnectedMailbox({ operatorUserId: OPERATOR, athleteId, provider: 'GOOGLE', providerAccountId: randomUUID(), emailAddress: `mb${++seq}@example.com` });
  storeMailboxCredential(box.id, { refreshToken: `rt-${seq}`, operatorUserId: OPERATOR });
  return box.id;
}
/** A reviewed campaign message for a fielded programme's sendable head coach. */
function reviewedCampaignMessage(key) {
  const name = `${key} Campaign College`;
  const athleteId = `ath-${key}`; player(athleteId, 2027);   // one campaign per athlete
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference) VALUES (?, 'x', 'x', ?, 'mens-soccer', 'NCAA D1', 'ACC')").run(randomUUID(), name);
  const c = `camp-${key}`;
  db.prepare(`INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at, snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)`).run(c, athleteId);
  const pc = `pc-${key}`;
  db.prepare(`INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score, tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')`).run(pc, c, name, ++seq);
  const coachId = randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title) VALUES (?, 'x', ?, ?, ?, 'NCAA D1', 'mens-soccer', 'Head Coach')`)
    .run(coachId, `Coach ${key}`, `${key}@campaign.example`, name);
  makeCoachesSendable(db, [coachId]);          // verified + corroborated + the fixture's current-season fielding evidence
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId });
  reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
  const row = programmeMessage(message.id);
  return { name, coachId, messageId: row.id, bodyHash: row.body_hash, mailboxId: mailbox(athleteId) };
}
/** The programme is now recorded as NOT fielded in the athlete's entry season (2027). */
const unfield = (name) => recordProgrammeSeasonFielding({ collegeName: name, sport: 'mens-soccer', season: 2027, fielded: false, evidence: 'programme discontinued after 2026', sourceUrl: 'https://campaign.example/news', verifiedAt: iso(-1), expiresAt: iso(100) });
const claim = (m) => api('POST', `/api/programme-messages/${m.messageId}/send`, { bodyHash: m.bodyHash, connectedMailboxId: m.mailboxId });

describe('Part 2d: the execution claim (automated campaigns, the approval workflow) and its retry', () => {
  it('a claim at a fielded programme sends, and its ALLOW is recorded with the claimed send', async () => {
    const m = reviewedCampaignMessage('claimok');
    const res = await claim(m);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('ACCEPTED');
    expect(decisions(`college_name = '${m.name}'`)).toEqual([expect.objectContaining({ boundary: 'EXECUTION_CLAIM', outcome: 'ALLOW', outreach_send_id: res.body.executionId, programme_message_id: m.messageId })]);
  });

  it('a message approved while the programme was eligible is refused at claim time once it is not: 422, nothing claimed, BLOCK recorded', async () => {
    const m = reviewedCampaignMessage('claimblock');
    unfield(m.name);
    const res = await claim(m);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(GATE_CODE.PROGRAMME_NOT_FIELDED);
    expect(sendsAt(m.name)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outbound_send_attempt').get().n).toBe(1);   // only claimok's
    expect(transportBehaviour.calls).toEqual([]);
    expect(decisions(`college_name = '${m.name}'`)).toEqual([expect.objectContaining({ boundary: 'EXECUTION_CLAIM', outcome: 'BLOCK', code: GATE_CODE.PROGRAMME_NOT_FIELDED, programme_message_id: m.messageId, outreach_send_id: null })]);
  });

  it('a retry of a refused execution is re-gated: refused once the programme is not fielded, BLOCK recorded at EXECUTION_RETRY', async () => {
    const m = reviewedCampaignMessage('retryblock');
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT, reason: 'PRE_TRANSPORT_CONFIGURATION' };
    const first = await claim(m);
    expect(first.body.state).toBe('FAILED');
    unfield(m.name);
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED }; transportBehaviour.calls = [];
    const res = await api('POST', `/api/outreach-sends/${first.body.executionId}/retry`, {});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(GATE_CODE.PROGRAMME_NOT_FIELDED);
    expect(transportBehaviour.calls).toEqual([]);
    expect(decisions(`college_name = '${m.name}'`).map((r) => [r.boundary, r.outcome])).toEqual([['EXECUTION_CLAIM', 'ALLOW'], ['EXECUTION_RETRY', 'BLOCK']]);
  });

  it('a retry at a still-fielded programme goes through, with its ALLOW recorded against the same send', async () => {
    const m = reviewedCampaignMessage('retryok');
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT, reason: 'PRE_TRANSPORT_CONFIGURATION' };
    const first = await claim(m);
    transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
    const res = await api('POST', `/api/outreach-sends/${first.body.executionId}/retry`, {});
    expect(res.status).toBe(200);
    expect(decisions(`college_name = '${m.name}'`).map((r) => [r.boundary, r.outcome, r.outreach_send_id])).toEqual([
      ['EXECUTION_CLAIM', 'ALLOW', first.body.executionId], ['EXECUTION_RETRY', 'ALLOW', first.body.executionId]]);
  });
});

void corroborateFixtureCoaches;
