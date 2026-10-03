/**
 * =============================================================================
 * REPLY INTAKE AND CLASSIFICATION — A9.7 §H, §I, §J, §Z.
 *
 * Two acts kept apart: a reply ARRIVING, and what it MEANT. The tests that
 * matter are the refusals, because every one of them is a false record this
 * would otherwise be able to produce - and a false record here is not a bug
 * anybody would notice. "Clemson said the goalkeeper spot is filled" reads
 * exactly the same whether a coach said it or an operator inferred it.
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
import { recordReply, classifyReply, replyChain } from './replyIntake.js';
import { currentState, OBSERVATION_KIND, REVIEW_STATE, CLASSIFIER_METHOD } from './recruitingObservations.js';
import { PROVENANCE_CLASS } from './outreachProvenance.js';
import { recordDraft } from '../outreachSend.js';
import { createOutreach } from '../outreach.js';

const K = OBSERVATION_KIND;
const players = [];
const coaches = [];
let player;
let run;
let target;

function athlete() {
  const row = Player.create({
    full_name: `A9.7 reply ${players.length}`,
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
    .run(id, new Date().toISOString(), 'Coach', `r${coaches.length}@example.test`, school);
  coaches.push(id);
  return id;
}

/** A real V2-provenance message, through the production path. */
function v2Send() {
  const sel = recordSelection(db, player, {
    runId: run.id, collegeName: target.name, sport: run.sport,
    source: SELECTION_SOURCE.TOP_100,
  });
  const c = coach(target.name);
  const outreach = createOutreach({ athleteId: player.id, coachId: c });
  const { id } = recordDraft({
    outreachId: outreach.id, athleteId: player.id, coachId: c,
    collegeName: target.name, sport: run.sport,
    matchmakingSelectionId: sel.id, evidence: null, subject: 's', body: 'b',
  });
  return { sendId: id, selectionId: sel.id, coachId: c };
}

/** A V1 message: no run, no selection. */
function v1Send() {
  const c = coach('Legacy College');
  const outreach = createOutreach({ athleteId: player.id, coachId: c });
  const { id } = recordDraft({
    outreachId: outreach.id, athleteId: player.id, coachId: c,
    collegeName: 'Legacy College', sport: 'mens-soccer',
    evidence: null, subject: 's', body: 'b',
  });
  return { sendId: id, coachId: c };
}

beforeAll(() => {
  seedPool('mens-soccer', { count: 140, unscoreable: 6 });
  seedPool('womens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
  player = athlete();
  const result = computeMatchmakingV2(db, player);
  persistRun(db, player, result);
  run = currentRun(db, player.id);
  target = result.programmes.find((p) => p.status === STATUS.RANKED && p.rank === 3);
});

afterAll(() => {
  db.prepare('DELETE FROM recruiting_observations WHERE athlete_id = ?').run(player.id);
  db.prepare(`DELETE FROM outreach_send_event WHERE outreach_send_id IN
              (SELECT id FROM outreach_send WHERE athlete_id = ?)`).run(player.id);
  db.prepare(`DELETE FROM outreach_send WHERE outreach_id IN
              (SELECT id FROM outreach WHERE athlete_id = ?)`).run(player.id);
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(player.id);
  for (const id of coaches) db.prepare('DELETE FROM coaches WHERE id = ?').run(id);
  for (const id of players) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

beforeEach(() => {
  db.prepare('DELETE FROM recruiting_observations WHERE athlete_id = ?').run(player.id);
  db.prepare(`DELETE FROM outreach_send_event WHERE outreach_send_id IN
              (SELECT id FROM outreach_send WHERE athlete_id = ?)`).run(player.id);
  db.prepare(`DELETE FROM outreach_send WHERE outreach_id IN
              (SELECT id FROM outreach WHERE athlete_id = ?)`).run(player.id);
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(player.id);
  db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(player.id);
});

/* ------------------------------------------------------------------ */
/* §H. The chain resolves                                              */
/* ------------------------------------------------------------------ */

describe('A9.7 §H. a reply resolves to the run that caused the outreach', () => {
  it('H1. reply -> send -> selection -> programme -> run', () => {
    const { sendId, selectionId } = v2Send();
    recordReply(db, { sendId, observedAt: '2026-10-01T09:00:00.000Z' });

    const chain = replyChain(db, sendId);
    expect(chain.replied).toBe(true);
    expect(chain.programme.collegeName).toBe(target.name);
    expect(chain.selection.id).toBe(selectionId);
    expect(chain.selection.rank).toBe(3);
    expect(chain.run.id).toBe(run.id);
    expect(chain.provenance).toBe(PROVENANCE_CLASS.V2_PROVENANCE);
  });

  it('H2. a V1 message resolves as far as it honestly can, and no further', () => {
    const { sendId } = v1Send();
    recordReply(db, { sendId });

    const chain = replyChain(db, sendId);
    expect(chain.replied).toBe(true);
    expect(chain.programme.collegeName).toBe('Legacy College');
    expect(chain.selection).toBeNull();
    expect(chain.run).toBeNull();
    expect(chain.provenance).toBe(PROVENANCE_CLASS.PRE_PROVENANCE);
  });

  it('H3. recording a reply copies no part of the message', () => {
    const { sendId } = v2Send();
    recordReply(db, { sendId, note: 'wants film' });
    const row = db.prepare('SELECT * FROM outreach_send_event WHERE outreach_send_id = ?')
      .get(sendId);
    expect(row.type).toBe('REPLY');
    expect(row.source).toBe('OPERATOR');
    expect(JSON.parse(row.payload)).toEqual({ note: 'wants film' });
    expect(row.payload).not.toMatch(/@/);
  });
});

/* ------------------------------------------------------------------ */
/* §I. Classification is a separate, explicit act                      */
/* ------------------------------------------------------------------ */

describe('A9.7 §I. classifying is a second act, and a reviewed one', () => {
  it('I1. a classification carries the message, the programme and the selection', () => {
    const { sendId, selectionId, coachId } = v2Send();
    recordReply(db, { sendId });
    const { observation } = classifyReply(db, { sendId, kind: K.REQUESTED_FILM });

    expect(observation.kind).toBe(K.REQUESTED_FILM);
    expect(observation.outreach_send_id).toBe(sendId);
    expect(observation.matchmaking_selection_id).toBe(selectionId);
    expect(observation.college_name).toBe(target.name);
    expect(observation.coach_id).toBe(coachId);
    expect(observation.review_state).toBe(REVIEW_STATE.CONFIRMED);
    expect(observation.classifier_method).toBe(CLASSIFIER_METHOD.MANUAL);
  });

  it('I2. positive, neutral and negative are all available and distinct', () => {
    for (const kind of [K.POSITIVE_REPLY, K.NEUTRAL_REPLY, K.NEGATIVE_REPLY]) {
      const { sendId } = v2Send();
      recordReply(db, { sendId });
      const { observation } = classifyReply(db, { sendId, kind });
      expect(observation.kind).toBe(kind);
    }
  });

  it('I3. structured recruiting intelligence carries its attributes', () => {
    const { sendId } = v2Send();
    recordReply(db, { sendId });
    const { observation } = classifyReply(db, {
      sendId, kind: K.POSITION_FILLED,
      attributes: { position: 'GOALKEEPER', recruitingClassYear: 2027 },
    });
    expect(observation.attributes).toEqual({ position: 'GOALKEEPER', recruitingClassYear: 2027 });
  });

  it('I4. a machine classification arrives UNREVIEWED and stays out of the reviewed state', () => {
    const { sendId } = v2Send();
    recordReply(db, { sendId });
    classifyReply(db, {
      sendId, kind: K.NEGATIVE_REPLY,
      classifierMethod: CLASSIFIER_METHOD.AI_ASSISTED,
      classifierVersion: 'clf-0.1', confidence: 0.61,
    });

    const seen = currentState(db, {
      athleteId: player.id, collegeName: target.name, sport: run.sport,
    });
    const reviewedOnly = currentState(db, {
      athleteId: player.id, collegeName: target.name, sport: run.sport, unreviewed: false,
    });
    expect(seen.programmeInterest.kind).toBe(K.NEGATIVE_REPLY);
    expect(reviewedOnly.programmeInterest).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* §Z. The refusals                                                    */
/* ------------------------------------------------------------------ */

describe('A9.7 §Z. silence is not a reply, and a reply is not an inference', () => {
  it('Z1. NO REPLY cannot be classified at all', () => {
    const { sendId } = v2Send();
    expect(() => classifyReply(db, { sendId, kind: K.NEGATIVE_REPLY }))
      .toThrow(/no reply has been recorded/i);
    expect(db.prepare('SELECT COUNT(*) n FROM recruiting_observations WHERE outreach_send_id = ?')
      .get(sendId).n).toBe(0);
  });

  it('Z2. a coach who telephones instead of writing must be recorded as such', () => {
    const { sendId } = v2Send();
    const { observation } = classifyReply(db, {
      sendId, kind: K.REQUESTED_CALL, requireReply: false,
    });
    expect(observation.source).toBe('COACH_CALL');
    // And still no REPLY event was invented.
    expect(replyChain(db, sendId).replied).toBe(false);
  });

  it('Z3. recording a reply creates NO classification of any kind', () => {
    const { sendId } = v2Send();
    recordReply(db, { sendId });
    expect(db.prepare('SELECT COUNT(*) n FROM recruiting_observations WHERE outreach_send_id = ?')
      .get(sendId).n).toBe(0);
    const state = currentState(db, {
      athleteId: player.id, collegeName: target.name, sport: run.sport,
    });
    expect(state.programmeInterest).toBeNull();
  });

  it('Z4. a NEGATIVE_REPLY does not make the programme intelligence say anything', () => {
    const { sendId } = v2Send();
    recordReply(db, { sendId });
    classifyReply(db, { sendId, kind: K.NEGATIVE_REPLY });

    const state = currentState(db, {
      athleteId: player.id, collegeName: target.name, sport: run.sport,
    });
    expect(state.programmeInterest.kind).toBe(K.NEGATIVE_REPLY);
    expect(state.recruitingNeed).toBeNull();
  });

  it('Z5. POSITION_FILLED still needs its position, even through this path', () => {
    const { sendId } = v2Send();
    recordReply(db, { sendId });
    expect(() => classifyReply(db, { sendId, kind: K.POSITION_FILLED, attributes: {} }))
      .toThrow(/requires position/i);
  });

  it('Z6. an athlete outcome is not a reading of a coach\'s email', () => {
    const { sendId } = v2Send();
    recordReply(db, { sendId });
    for (const kind of [K.COMMITTED, K.ATHLETE_WITHDREW, K.ATHLETE_NOT_INTERESTED]) {
      expect(() => classifyReply(db, { sendId, kind })).toThrow(/athlete outcome/i);
    }
  });

  it('Z7. the programme is taken from the message, so it cannot be misfiled', () => {
    const { sendId } = v2Send();
    recordReply(db, { sendId });
    // There is no parameter to misfile with: the caller names only a kind.
    const { observation } = classifyReply(db, { sendId, kind: K.INTERESTED });
    expect(observation.college_name).toBe(target.name);
    expect(observation.sport).toBe(run.sport);
  });

  it('Z8. an unknown kind is refused before anything is written', () => {
    const { sendId } = v2Send();
    recordReply(db, { sendId });
    expect(() => classifyReply(db, { sendId, kind: 'SEEMED_KEEN' }))
      .toThrow(/unknown observation kind/i);
  });
});
