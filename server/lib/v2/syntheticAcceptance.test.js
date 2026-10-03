/**
 * =============================================================================
 * THE END-TO-END SYNTHETIC JOURNEY — A9.7 §X.
 *
 * One athlete, one deterministic path, no real email, no mocked scoring: the
 * real engine, the real persistence, the real campaign writer, the real send
 * recorder, the real observation ledger and the real routes.
 *
 * Seventeen steps, in order, each asserting the thing that would be silently
 * wrong if the wiring were wrong. The two that matter most are 16 and 17:
 * that a second run does not rewrite the first run's history, and that none of
 * the outcomes recorded along the way moved the model by a single cell.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import {
  computeMatchmakingV2, clearContextCache, STATUS,
} from './matchmakingService.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { persistRun, currentRun } from './matchmakingRuns.js';
import { lookupProgramme, recordSelection, SELECTION_SOURCE } from './matchmakingSelection.js';
import { createCampaignFromRun } from './campaignFromRun.js';
import { recordReply, classifyReply, replyChain } from './replyIntake.js';
import { selectionsOverview } from './selectionsOverview.js';
import {
  recordObservation, currentState, OBSERVATION_KIND, OBSERVATION_SOURCE,
} from './recruitingObservations.js';
import { sendProvenance, PROVENANCE_CLASS } from './outreachProvenance.js';
import { recordDraft, acceptSend } from '../outreachSend.js';
import { createOutreach } from '../outreach.js';
import { observationsRouter } from '../../routes/observations.js';
import { matchmakingRouter } from '../../routes/matchmaking.js';

const K = OBSERVATION_KIND;

/** The whole journey's state, built up step by step. */
const journey = {};
const coaches = [];
let baseUrl;
let playerId;

const listen = (app) => new Promise((r) => {
  const s = app.listen(0, () => r(`http://127.0.0.1:${s.address().port}`));
  s.unref();
});

function coach(school) {
  const id = randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport)
              VALUES (?, ?, ?, ?, ?, 'mens-soccer')`)
    .run(id, new Date().toISOString(), 'E2E Coach', `e2e${coaches.length}@example.test`, school);
  coaches.push(id);
  return id;
}

beforeAll(async () => {
  seedPool('mens-soccer', { count: 160, unscoreable: 8 });
  seedPool('womens-soccer');
  clearContextCache();
  clearCorpusDigestCache();

  const app = express();
  app.use(express.json());
  app.use('/api', matchmakingRouter);
  app.use('/api', observationsRouter);
  baseUrl = await listen(app);
});

afterAll(() => {
  if (!playerId) return;
  db.prepare('DELETE FROM recruiting_observations WHERE athlete_id = ?').run(playerId);
  db.prepare(`DELETE FROM outreach_send_event WHERE outreach_send_id IN
              (SELECT id FROM outreach_send WHERE athlete_id = ?)`).run(playerId);
  db.prepare(`DELETE FROM outreach_send WHERE athlete_id = ?`).run(playerId);
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(playerId);
  db.prepare(`DELETE FROM programme_campaigns WHERE campaign_id IN
              (SELECT id FROM campaigns WHERE athlete_id = ?)`).run(playerId);
  db.prepare('DELETE FROM campaigns WHERE athlete_id = ?').run(playerId);
  db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(playerId);
  for (const id of coaches) db.prepare('DELETE FROM coaches WHERE id = ?').run(id);
  db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
});

describe('A9.7 §X. the synthetic acceptance journey', () => {
  it('X1. a synthetic athlete exists', () => {
    const row = Player.create({
      full_name: 'A9.7 Synthetic Athlete',
      sport: 'mens-soccer',
      position: 'Midfielder',
      football_ability: 6,
      recruiting_class_year: 2028,
      state: 'CA',
      origin: 'USA',
    });
    playerId = row.id;
    journey.player = Player.get(row.id);
    expect(journey.player.full_name).toBe('A9.7 Synthetic Athlete');
  });

  it('X2. with no contribution resolved, V2 refuses to rank rather than guessing', () => {
    expect(() => computeMatchmakingV2(db, journey.player))
      .toThrow(/contribution/i);

    Player.update(playerId, {
      contribution_state: 'STATED',
      max_annual_contribution_usd: 25000,
    });
    journey.player = Player.get(playerId);
    expect(journey.player.contribution_state).toBe('STATED');
  });

  it('X3. a run is generated and persisted, immutably', () => {
    clearContextCache();
    journey.resultA = computeMatchmakingV2(db, journey.player);
    persistRun(db, journey.player, journey.resultA);
    journey.runA = currentRun(db, playerId);

    expect(journey.runA.id).toBeTruthy();
    expect(journey.resultA.programmes.length).toBeGreaterThan(100);
    const stored = db.prepare(
      'SELECT COUNT(*) n FROM matchmaking_programme_results WHERE run_id = ?',
    ).get(journey.runA.id).n;
    expect(stored).toBe(journey.resultA.programmes.length);
  });

  it('X4. the Top 100 is readable and is ranked only', async () => {
    const res = await fetch(
      `${baseUrl}/api/players/${playerId}/matchmaking/top?runId=${journey.runA.id}`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.programmes).toHaveLength(100);
    for (const p of body.programmes) expect(p.status).toBe(STATUS.RANKED);
    journey.top = body.programmes;
  });

  it('X5. Specific Search finds a #101+ school, and reports its real standing', () => {
    const ranked = journey.resultA.programmes
      .filter((p) => p.status === STATUS.RANKED)
      .sort((a, b) => a.rank - b.rank);
    const beyond = ranked.find((p) => p.rank > 100);
    expect(beyond).toBeDefined();

    const found = lookupProgramme(db, journey.player, {
      collegeName: beyond.name, runId: journey.runA.id,
    });
    expect(found.programme.rank).toBe(beyond.rank);
    expect(found.programme.rank).toBeGreaterThan(100);
    expect(found.rankedCount).toBeGreaterThan(100);
    journey.beyond = beyond;
  });

  it('X6. the consultant selects that #101+ programme deliberately', () => {
    journey.searchSelection = recordSelection(db, journey.player, {
      runId: journey.runA.id,
      collegeName: journey.beyond.name,
      sport: journey.runA.sport,
      source: SELECTION_SOURCE.SPECIFIC_SEARCH,
    });
    expect(journey.searchSelection.programme.rank).toBe(journey.beyond.rank);
  });

  it('X7. a V2 campaign is created from the persisted run', () => {
    const out = createCampaignFromRun(playerId, { label: 'A9.7 synthetic' });
    journey.campaign = out.campaign;
    journey.targets = out.programmes;

    expect(out.runId).toBe(journey.runA.id);
    expect(journey.targets).toHaveLength(100);
    expect(journey.campaign.state).toBe('draft');
    for (const t of journey.targets) expect(t.matchmaking_selection_id).toBeTruthy();
  });

  it('X8. a send record is created through the real draft path', () => {
    const target = journey.targets[0];
    journey.coachId = coach(target.college_name);
    const outreach = createOutreach({ athleteId: playerId, coachId: journey.coachId });
    const { id } = recordDraft({
      outreachId: outreach.id,
      athleteId: playerId,
      coachId: journey.coachId,
      collegeName: target.college_name,
      sport: target.sport,
      matchmakingSelectionId: target.matchmaking_selection_id,
      evidence: null,
      subject: 'Synthetic subject',
      body: 'Synthetic body',
    });
    acceptSend(id);
    journey.sendId = id;
    journey.target = target;
    expect(db.prepare('SELECT state FROM outreach_send WHERE id = ?').get(id).state)
      .toBe('ACCEPTED');
  });

  it('X9. the send resolves to athlete, programme, coach, selection, run and rank', () => {
    const p = sendProvenance(db, journey.sendId);
    expect(p.provenance).toBe(PROVENANCE_CLASS.V2_PROVENANCE);
    expect(p.run.id).toBe(journey.runA.id);
    expect(p.selection.collegeName).toBe(journey.target.college_name);
    expect(p.selection.rank).toBe(journey.target.rank);

    const stored = db.prepare(`
      SELECT * FROM matchmaking_programme_results WHERE run_id = ? AND college_name = ?`)
      .get(journey.runA.id, journey.target.college_name);
    expect(stored.status).toBe(STATUS.RANKED);
    for (const layer of ['recruitability', 'financial', 'opportunity']) {
      expect(stored[layer]).not.toBeNull();
    }
    journey.rankAtSend = p.selection.rank;
  });

  it('X10. a reply is recorded, and classifies nothing by itself', async () => {
    const res = await fetch(`${baseUrl}/api/sends/${journey.sendId}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'asked about the GK spot' }),
    });
    expect(res.status).toBe(201);
    expect(db.prepare(
      'SELECT COUNT(*) n FROM recruiting_observations WHERE outreach_send_id = ?',
    ).get(journey.sendId).n).toBe(0);
  });

  it('X11. an operator classifies the reply manually', async () => {
    const res = await fetch(`${baseUrl}/api/sends/${journey.sendId}/classification`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: K.NEUTRAL_REPLY }),
    });
    expect(res.status).toBe(201);
    const { observation } = await res.json();
    expect(observation.review_state).toBe('CONFIRMED');
    expect(observation.classifier_method).toBe('MANUAL');
  });

  it('X12. structured recruiting intelligence is recorded from the same reply', async () => {
    const res = await fetch(`${baseUrl}/api/sends/${journey.sendId}/classification`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: K.POSITION_FILLED,
        attributes: { position: 'GOALKEEPER', recruitingClassYear: 2028 },
      }),
    });
    expect(res.status).toBe(201);

    const state = currentState(db, {
      athleteId: playerId,
      collegeName: journey.target.college_name,
      sport: journey.target.sport,
    });
    // The two readings sit on different axes and neither overwrote the other.
    expect(state.recruitingNeed.kind).toBe(K.POSITION_FILLED);
    expect(state.recruitingNeed.attributes.position).toBe('GOALKEEPER');
    expect(state.programmeInterest.kind).toBe(K.NEUTRAL_REPLY);
  });

  it('X13. the operator view shows the pursuit with its frozen numbers', async () => {
    const res = await fetch(`${baseUrl}/api/players/${playerId}/selections/overview`);
    const body = await res.json();
    expect(res.status).toBe(200);

    const row = body.selections.find((r) => r.selectionId === journey.target.matchmaking_selection_id);
    expect(row.rank).toBe(journey.rankAtSend);
    expect(row.runId).toBe(journey.runA.id);
    expect(row.outreach.messages).toBe(1);
    expect(row.reply.replies).toBe(1);
    expect(row.latest.recruitingNeed.kind).toBe(K.POSITION_FILLED);

    // And the #101+ search selection is there too, with its real rank.
    const searched = body.selections.find((r) => r.selectionId === journey.searchSelection.id);
    expect(searched.rank).toBe(journey.beyond.rank);
    expect(searched.source).toBe('SPECIFIC_SEARCH');

    const chain = await (await fetch(`${baseUrl}/api/sends/${journey.sendId}/reply-chain`)).json();
    expect(chain.replied).toBe(true);
    expect(chain.run.id).toBe(journey.runA.id);
  });

  it('X14. the athlete\'s preferences change', () => {
    Player.update(playerId, {
      football_ability: 9,
      max_annual_contribution_usd: 70000,
    });
    journey.player = Player.get(playerId);
    expect(journey.player.football_ability).toBe(9);
  });

  it('X15. Run B is generated, and genuinely moves the programme', () => {
    clearContextCache();
    journey.resultB = computeMatchmakingV2(db, journey.player);
    persistRun(db, journey.player, journey.resultB);
    journey.runB = currentRun(db, playerId);

    expect(journey.runB.id).not.toBe(journey.runA.id);
    const now = journey.resultB.programmes
      .find((p) => p.name === journey.target.college_name)?.rank ?? null;
    expect(now).not.toBe(journey.rankAtSend);
    journey.rankInB = now;
  });

  /* ---------------------------------------------------------------- */
  /* The two that matter                                              */
  /* ---------------------------------------------------------------- */

  it('X16. the old outreach STILL points at Run A, with Run A\'s rank', async () => {
    const p = sendProvenance(db, journey.sendId);
    expect(p.run.id).toBe(journey.runA.id);
    expect(p.run.id).not.toBe(journey.runB.id);
    expect(p.selection.rank).toBe(journey.rankAtSend);
    expect(p.selection.rank).not.toBe(journey.rankInB);

    // And the operator surface agrees, which is where a consultant would see it.
    const body = await (await fetch(`${baseUrl}/api/players/${playerId}/selections/overview`)).json();
    const row = body.selections.find((r) => r.selectionId === journey.target.matchmaking_selection_id);
    expect(row.rank).toBe(journey.rankAtSend);
    expect(row.runId).toBe(journey.runA.id);

    // The campaign target's provenance is untouched too.
    const target = db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(journey.target.id);
    expect(target.matchmaking_selection_id).toBe(journey.target.matchmaking_selection_id);
    expect(target.rank).toBe(journey.rankAtSend);
  });

  it('X17. recomputing V2 over all of it returns an identical result', () => {
    // More outcomes, including the strongest signals there are.
    recordObservation(db, {
      athleteId: playerId,
      collegeName: journey.target.college_name,
      sport: journey.target.sport,
      kind: K.COMMITTED,
      source: OBSERVATION_SOURCE.ATHLETE,
    });
    recordObservation(db, {
      athleteId: playerId,
      collegeName: journey.beyond.name,
      sport: journey.runA.sport,
      matchmakingSelectionId: journey.searchSelection.id,
      kind: K.ROSTER_PLACE_OFFERED,
      source: OBSERVATION_SOURCE.COACH_REPLY,
    });

    const observations = db.prepare(
      'SELECT COUNT(*) n FROM recruiting_observations WHERE athlete_id = ?',
    ).get(playerId).n;
    expect(observations).toBeGreaterThanOrEqual(4);

    clearContextCache();
    clearCorpusDigestCache();
    const again = computeMatchmakingV2(db, Player.get(playerId));

    const shape = (r) => r.programmes.map((p) => ({
      name: p.name,
      status: p.status,
      rank: p.rank ?? null,
      band: p.band ?? null,
      pursuit: p.pursuit ?? null,
      recruitability: p.recruitability ?? null,
      financial: p.financial ?? null,
      opportunity: p.opportunity ?? null,
      grade: p.grade ?? null,
    }));

    expect(shape(again)).toEqual(shape(journey.resultB));
  });
});
