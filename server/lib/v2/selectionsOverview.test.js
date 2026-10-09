/**
 * =============================================================================
 * THE SELECTIONS OPERATOR SURFACE — A9.7 §K.
 *
 * One claim, and it is the one a consultant's decisions rest on: every number
 * on this screen is the number that CAUSED the outreach, not the number a
 * later run would assign.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache, STATUS } from './matchmakingService.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { persistRun, currentRun } from './matchmakingRuns.js';
import { recordSelection, SELECTION_SOURCE } from './matchmakingSelection.js';
import { selectionsOverview, RECIPIENT_COUNT_SQL } from './selectionsOverview.js';
import { recordReply, classifyReply } from './replyIntake.js';
import { reviewObservation, recordObservation, OBSERVATION_KIND, OBSERVATION_SOURCE, REVIEW_STATE, CLASSIFIER_METHOD } from './recruitingObservations.js';
import { recordDraft, acceptSend } from '../outreachSend.js';
import { createOutreach } from '../outreach.js';
import { markResponded } from '../engagementRollup.js';

const K = OBSERVATION_KIND;
const players = [];
const coaches = [];
let player;
let run;
let result;
let target;

function athlete() {
  const row = Player.create({
    full_name: `A9.7 overview ${players.length}`,
    sport: 'mens-soccer', position: 'Midfielder', football_ability: 6,
    recruiting_class_year: 2028, state: 'CA', origin: 'USA',
    contribution_state: 'STATED', max_annual_contribution_usd: 25000,
  });
  players.push(row.id);
  return Player.get(row.id);
}

function coach(school) {
  const id = randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport)
              VALUES (?, ?, ?, ?, ?, 'mens-soccer')`)
    .run(id, new Date().toISOString(), 'Coach', `o${coaches.length}@example.test`, school);
  coaches.push(id);
  return id;
}

function sendFor(selectionId, collegeName, { accept = false } = {}) {
  const c = coach(collegeName);
  const outreach = createOutreach({ athleteId: player.id, coachId: c });
  const { id } = recordDraft({
    outreachId: outreach.id, athleteId: player.id, coachId: c,
    collegeName, sport: run.sport, matchmakingSelectionId: selectionId,
    evidence: null, subject: 's', body: 'b',
  });
  if (accept) acceptSend(id);
  return id;
}

const wipe = () => {
  db.prepare('DELETE FROM recruiting_observations WHERE athlete_id = ?').run(player.id);
  db.prepare('DELETE FROM engagement_rollup WHERE outreach_id IN (SELECT id FROM outreach WHERE athlete_id = ?)').run(player.id);
  db.prepare(`DELETE FROM outreach_send_event WHERE outreach_send_id IN
              (SELECT id FROM outreach_send WHERE athlete_id = ?)`).run(player.id);
  db.prepare(`DELETE FROM outreach_send WHERE outreach_id IN
              (SELECT id FROM outreach WHERE athlete_id = ?)`).run(player.id);
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(player.id);
  db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(player.id);
};

beforeAll(() => {
  seedPool('mens-soccer', { count: 140, unscoreable: 6 });
  seedPool('womens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
  player = athlete();
  result = computeMatchmakingV2(db, player);
  persistRun(db, player, result);
  run = currentRun(db, player.id);
  target = result.programmes.find((p) => p.status === STATUS.RANKED && p.rank === 2);
});

afterAll(() => {
  wipe();
  for (const id of coaches) db.prepare('DELETE FROM coaches WHERE id = ?').run(id);
  for (const id of players) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

beforeEach(wipe);

const select = (programme) => recordSelection(db, player, {
  runId: run.id, collegeName: programme.name, sport: run.sport,
  source: SELECTION_SOURCE.TOP_100,
});

describe('A9.7 §K. the surface a consultant acts on', () => {
  it('K1. a selection with nothing sent reads as exactly that', () => {
    select(target);
    const [row] = selectionsOverview(player.id).selections;

    expect(row.collegeName).toBe(target.name);
    expect(row.rank).toBe(2);
    expect(row.band).toBe(target.band);
    expect(row.runId).toBe(run.id);
    expect(row.outreach.messages).toBe(0);
    expect(row.reply.replies).toBe(0);
    expect(row.latest.programmeInterest).toBeNull();
  });

  it('K2. messages, coaches and replies are counted per selection', () => {
    const sel = select(target);
    const a = sendFor(sel.id, target.name, { accept: true });
    sendFor(sel.id, target.name);
    recordReply(db, { sendId: a });

    const [row] = selectionsOverview(player.id).selections;
    expect(row.outreach.messages).toBe(2);
    expect(row.outreach.coaches).toBe(2);
    expect(row.outreach.accepted).toBe(1);
    expect(row.reply.replies).toBe(1);
  });

  it('K3. the latest REVIEWED reading is shown; an unreviewed guess is not', () => {
    const sel = select(target);
    const sendId = sendFor(sel.id, target.name, { accept: true });
    recordReply(db, { sendId });
    classifyReply(db, {
      sendId, kind: K.NEGATIVE_REPLY,
      classifierMethod: CLASSIFIER_METHOD.AI_ASSISTED, classifierVersion: 'clf-0.1',
    });

    let [row] = selectionsOverview(player.id).selections;
    expect(row.latest.programmeInterest).toBeNull();

    const obs = db.prepare(
      'SELECT id FROM recruiting_observations WHERE outreach_send_id = ?',
    ).get(sendId);
    reviewObservation(db, { observationId: obs.id, state: REVIEW_STATE.CONFIRMED });

    [row] = selectionsOverview(player.id).selections;
    expect(row.latest.programmeInterest.kind).toBe(K.NEGATIVE_REPLY);
  });

  it('K4. recruiting need and athlete outcome stay on separate axes', () => {
    const sel = select(target);
    const sendId = sendFor(sel.id, target.name, { accept: true });
    recordReply(db, { sendId });
    classifyReply(db, {
      sendId, kind: K.POSITION_FILLED, attributes: { position: 'MIDFIELD' },
    });
    recordObservation(db, {
      athleteId: player.id, collegeName: target.name, sport: run.sport,
      kind: K.ATHLETE_NOT_INTERESTED, source: OBSERVATION_SOURCE.ATHLETE,
    });

    const [row] = selectionsOverview(player.id).selections;
    expect(row.latest.recruitingNeed.kind).toBe(K.POSITION_FILLED);
    expect(row.latest.athleteOutcome.kind).toBe(K.ATHLETE_NOT_INTERESTED);
    expect(row.latest.programmeInterest).toBeNull();
  });

  /**
   * §K's load-bearing property. A consultant reading this while deciding
   * whether to chase a reply must see the rank that caused the email.
   */
  it('K5. a newer run does NOT change the numbers on an older selection', () => {
    const sel = select(target);
    sendFor(sel.id, target.name, { accept: true });
    const before = selectionsOverview(player.id).selections[0];

    Player.update(player.id, { football_ability: 9, max_annual_contribution_usd: 70000 });
    clearContextCache();
    const resultB = computeMatchmakingV2(db, Player.get(player.id));
    persistRun(db, Player.get(player.id), resultB);
    const movedTo = resultB.programmes.find((p) => p.name === target.name)?.rank ?? null;
    expect(movedTo).not.toBe(before.rank);

    const after = selectionsOverview(player.id).selections
      .find((r) => r.selectionId === sel.id);
    expect(after.rank).toBe(before.rank);
    expect(after.band).toBe(before.band);
    expect(after.runId).toBe(run.id);

    Player.update(player.id, { football_ability: 6, max_annual_contribution_usd: 25000 });
    clearContextCache();
  });

  it('K6. the same programme chosen twice is two rows with one outcome history', () => {
    const first = select(target);
    clearContextCache();
    const resultB = computeMatchmakingV2(db, player);
    persistRun(db, player, resultB);
    const runB = currentRun(db, player.id);
    const second = recordSelection(db, player, {
      runId: runB.id, collegeName: target.name, sport: runB.sport,
      source: SELECTION_SOURCE.SPECIFIC_SEARCH,
    });
    recordObservation(db, {
      athleteId: player.id, collegeName: target.name, sport: run.sport,
      kind: K.INTERESTED, source: OBSERVATION_SOURCE.COACH_REPLY,
    });

    const rows = selectionsOverview(player.id).selections
      .filter((r) => r.collegeName === target.name);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.selectionId))).toEqual(new Set([first.id, second.id]));
    for (const r of rows) expect(r.latest.programmeInterest.kind).toBe(K.INTERESTED);
    expect(new Set(rows.map((r) => r.runId)).size).toBe(2);
  });

  it('K7. zero replies is an absence of observation, not a finding', () => {
    const sel = select(target);
    sendFor(sel.id, target.name, { accept: true });
    const [row] = selectionsOverview(player.id).selections;
    expect(row.reply.replies).toBe(0);
    expect(row.reply.lastReplyAt).toBeNull();
    // Nothing anywhere turned the silence into a judgement.
    expect(row.latest.programmeInterest).toBeNull();
  });

  it('K8. an athlete with no selections gets an empty list, not an error', () => {
    const fresh = athlete();
    expect(selectionsOverview(fresh.id)).toEqual({ playerId: fresh.id, selections: [] });
  });
});

describe('Phase 5 (#13, #14): the reply the operator records, and recipients counted as recipients', () => {
  const outreachOf = (sendId) => db.prepare('SELECT outreach_id FROM outreach_send WHERE id = ?').get(sendId).outreach_id;

  it('#13 a reply marked on the Engagement tab ("Mark responded") reads as Replied here', () => {
    const sel = select(target);
    const a = sendFor(sel.id, target.name, { accept: true });
    markResponded(outreachOf(a), '2026-10-05T12:00:00.000Z');
    const [row] = selectionsOverview(player.id).selections;
    expect(row.reply.replies).toBe(1);
    expect(row.reply.lastReplyAt).toBe('2026-10-05T12:00:00.000Z');
  });

  it('#13 distinct replies split across the two paths each count: neither path hides the other', () => {
    const sel = select(target);
    const a = sendFor(sel.id, target.name, { accept: true });   // recipient A: reply via intake
    const b = sendFor(sel.id, target.name, { accept: true });   // recipient B: reply marked on Engagement
    const c = sendFor(sel.id, target.name, { accept: true });   // recipient C: replied both ways
    sendFor(sel.id, target.name, { accept: true });             // recipient D: no reply
    recordReply(db, { sendId: a });
    markResponded(outreachOf(b), '2026-10-04T12:00:00.000Z');
    recordReply(db, { sendId: c });
    markResponded(outreachOf(c), '2026-10-06T12:00:00.000Z');
    const [row] = selectionsOverview(player.id).selections;
    expect(row.reply.replies).toBe(3);   // A, B, C - C once
    expect(row.outreach.coaches).toBe(4);
  });

  it('#13 the same reply recorded both ways counts once, never twice', () => {
    const sel = select(target);
    const a = sendFor(sel.id, target.name, { accept: true });
    recordReply(db, { sendId: a });
    markResponded(outreachOf(a));
    const [row] = selectionsOverview(player.id).selections;
    expect(row.reply.replies).toBe(1);
  });

  it('#14 a coach and an inbox whose ids are identical are TWO recipients, not one', () => {
    // A typed inbox send is guarded by triggers, so the counting expression the query uses is run
    // over rows of the same shape. COALESCE would have merged these two into one.
    db.exec('CREATE TEMP TABLE rc (coach_id TEXT, programme_contact_id TEXT)');
    const insert = db.prepare('INSERT INTO rc VALUES (?, ?)');
    insert.run('42', null);          // a coach
    insert.run(null, '42');          // an inbox with the same id
    insert.run('42', null);          // the same coach again (a follow-up)
    insert.run('c-2', null);         // another coach
    expect(db.prepare(`SELECT ${RECIPIENT_COUNT_SQL} AS n FROM rc`).get().n).toBe(3);
    expect(db.prepare('SELECT COUNT(DISTINCT COALESCE(coach_id, programme_contact_id)) AS n FROM rc').get().n).toBe(2); // the defect
    db.exec('DROP TABLE rc');
  });

  it('#14 the query uses that expression', async () => {
    const fs = await import('node:fs');
    expect(fs.readFileSync('server/lib/v2/selectionsOverview.js', 'utf8')).toContain('${RECIPIENT_COUNT_SQL}                                AS coaches');
  });
});
