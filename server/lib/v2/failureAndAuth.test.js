/**
 * =============================================================================
 * FAILURE, RECOVERY AND AUTHORISATION — A9.7 §S, §T.
 *
 * §S's single rule: after any failure, what remains must still be TRUE. A
 * half-written campaign, an observation attached to the wrong message, or a
 * historical send quietly re-pointed at a newer run would all survive as
 * plausible data that nothing afterwards could detect.
 *
 * §T's single rule: nothing A9 added may be a new way in.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache, STATUS } from './matchmakingService.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { persistRun, currentRun, runStaleness } from './matchmakingRuns.js';
import { recordSelection, SELECTION_SOURCE } from './matchmakingSelection.js';
import { createCampaignFromRun } from './campaignFromRun.js';
import { recordObservation, OBSERVATION_KIND, OBSERVATION_SOURCE } from './recruitingObservations.js';
import { recordReply, classifyReply } from './replyIntake.js';
import { sendProvenance } from './outreachProvenance.js';
import { recordDraft } from '../outreachSend.js';
import { createOutreach } from '../outreach.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const K = OBSERVATION_KIND;
const players = [];
const coaches = [];
let player;
let run;
let target;

function athlete(extra = {}) {
  const row = Player.create({
    full_name: `A9.7 failure ${players.length}`,
    sport: 'mens-soccer', position: 'Midfielder', football_ability: 6,
    recruiting_class_year: 2028, state: 'CA', origin: 'USA',
    contribution_state: 'STATED', max_annual_contribution_usd: 25000,
    ...extra,
  });
  players.push(row.id);
  return Player.get(row.id);
}

function coach(school) {
  const id = randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport)
              VALUES (?, ?, ?, ?, ?, 'mens-soccer')`)
    .run(id, new Date().toISOString(), 'Coach', `f${coaches.length}@example.test`, school);
  coaches.push(id);
  return id;
}

const wipe = () => {
  db.prepare('DELETE FROM recruiting_observations WHERE athlete_id = ?').run(player.id);
  db.prepare(`DELETE FROM outreach_send_event WHERE outreach_send_id IN
              (SELECT id FROM outreach_send WHERE athlete_id = ?)`).run(player.id);
  db.prepare('DELETE FROM outreach_send WHERE athlete_id = ?').run(player.id);
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(player.id);
  db.prepare(`DELETE FROM programme_campaigns WHERE campaign_id IN
              (SELECT id FROM campaigns WHERE athlete_id = ?)`).run(player.id);
  db.prepare('DELETE FROM campaigns WHERE athlete_id = ?').run(player.id);
  db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(player.id);
};

beforeAll(() => {
  seedPool('mens-soccer', { count: 140, unscoreable: 6 });
  seedPool('womens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
  player = athlete();
  const result = computeMatchmakingV2(db, player);
  persistRun(db, player, result);
  run = currentRun(db, player.id);
  target = result.programmes.find((p) => p.status === STATUS.RANKED && p.rank === 1);
});

afterAll(() => {
  wipe();
  for (const id of coaches) db.prepare('DELETE FROM coaches WHERE id = ?').run(id);
  for (const id of players) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

beforeEach(wipe);

const select = () => recordSelection(db, player, {
  runId: run.id, collegeName: target.name, sport: run.sport,
  source: SELECTION_SOURCE.TOP_100,
});

/* ------------------------------------------------------------------ */
/* §S. Failures leave truthful records                                 */
/* ------------------------------------------------------------------ */

describe('A9.7 §S. a failure leaves nothing false behind', () => {
  it('S1. an interrupted campaign creation writes neither campaign nor selections', () => {
    expect(() => createCampaignFromRun(player.id, { runId: 'nonexistent' })).toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM campaigns WHERE athlete_id = ?').get(player.id).n)
      .toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_selections WHERE player_id = ?')
      .get(player.id).n).toBe(0);
  });

  it('S2. an observation naming an unknown message is refused and writes nothing', () => {
    const before = db.prepare('SELECT COUNT(*) n FROM recruiting_observations').get().n;
    expect(() => recordObservation(db, {
      athleteId: player.id, collegeName: target.name, sport: run.sport,
      outreachSendId: 'no-such-send', kind: K.POSITIVE_REPLY,
      source: OBSERVATION_SOURCE.COACH_REPLY,
    })).toThrow(/no outreach_send/i);
    expect(db.prepare('SELECT COUNT(*) n FROM recruiting_observations').get().n).toBe(before);
  });

  it('S3. a reply that cannot resolve a message is refused by name', () => {
    expect(() => recordReply(db, { sendId: 'no-such-send' })).toThrow(/no outreach_send/i);
    expect(() => classifyReply(db, { sendId: 'no-such-send', kind: K.POSITIVE_REPLY }))
      .toThrow(/no outreach_send/i);
  });

  it('S4. a programme with no coach on file cannot be written to, and says so', () => {
    const sel = select();
    const outreach = createOutreach({ athleteId: player.id, coachId: coach('Somewhere Else') });
    expect(() => recordDraft({
      outreachId: outreach.id, athleteId: player.id,
      coachId: outreach.coach_id,
      collegeName: target.name, sport: run.sport,
      matchmakingSelectionId: sel.id, evidence: null, subject: 's', body: 'b',
    })).toThrow(/evidence on file puts this coach/i);

    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send WHERE athlete_id = ?')
      .get(player.id).n).toBe(0);
  });

  /**
   * A STALE RUN IS PURSUABLE AND IS RECORDED AS STALE. §S lists it as a
   * failure case; it is not one. Acting on a historical run is a legitimate
   * decision, and A9.5 settled that the fact it was historical is part of
   * what happened. What must never occur is the silent substitution below.
   */
  it('S5. a stale run can still be acted on, and the staleness is recorded', () => {
    Player.update(player.id, { football_ability: 9 });
    const moved = Player.get(player.id);
    const staleness = runStaleness(db, moved, run);
    expect(staleness.current).toBe(false);

    const sel = recordSelection(db, moved, {
      runId: run.id, collegeName: target.name, sport: run.sport,
      source: SELECTION_SOURCE.TOP_100,
    });
    const row = db.prepare('SELECT * FROM matchmaking_selections WHERE id = ?').get(sel.id);
    expect(row.run_was_stale).toBe(1);
    expect(row.matchmaking_run_id).toBe(run.id);

    Player.update(player.id, { football_ability: 6 });
    clearContextCache();
  });

  it('S6. a newer run is NEVER silently substituted after a failure', () => {
    const sel = select();
    const c = coach(target.name);
    const outreach = createOutreach({ athleteId: player.id, coachId: c });
    const { id: sendId } = recordDraft({
      outreachId: outreach.id, athleteId: player.id, coachId: c,
      collegeName: target.name, sport: run.sport,
      matchmakingSelectionId: sel.id, evidence: null, subject: 's', body: 'b',
    });

    clearContextCache();
    const resultB = computeMatchmakingV2(db, player);
    persistRun(db, player, resultB);
    const runB = currentRun(db, player.id);

    // A failed re-attachment changes nothing.
    const newSel = recordSelection(db, player, {
      runId: runB.id, collegeName: target.name, sport: runB.sport,
      source: SELECTION_SOURCE.SPECIFIC_SEARCH,
    });
    expect(() => recordDraft({
      outreachId: outreach.id, athleteId: player.id, coachId: c,
      collegeName: 'Wrong Programme', sport: run.sport,
      matchmakingSelectionId: newSel.id, evidence: null, subject: 's', body: 'b',
    })).toThrow();

    expect(sendProvenance(db, sendId).run.id).toBe(run.id);
    expect(sendProvenance(db, sendId).selection.id).toBe(sel.id);
  });

  /**
   * THE CORPUS MOVING IS NOT A CORRECTION TO HISTORY. New programmes arrive,
   * rosters are imported, and none of it may reach back into what a campaign
   * recorded when it was frozen.
   */
  it('S7. a corpus change after campaign creation does not alter the frozen targets', () => {
    const { programmes, campaign } = createCampaignFromRun(player.id);
    const before = programmes.map((p) => `${p.rank}:${p.college_name}:${p.match_score}`);

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO colleges (id, name, sport, division, active, created_date, updated_date)
                VALUES (?, 'A97 Corpus Newcomer', 'mens-soccer', 'NCAA D1', 1, ?, ?)`)
      .run(randomUUID(), now, now);
    clearContextCache();
    clearCorpusDigestCache();

    const after = db.prepare(`
      SELECT rank, college_name, match_score FROM programme_campaigns
       WHERE campaign_id = ? ORDER BY rank`).all(campaign.id)
      .map((p) => `${p.rank}:${p.college_name}:${p.match_score}`);

    expect(after).toEqual(before);
    db.prepare("DELETE FROM colleges WHERE name = 'A97 Corpus Newcomer'").run();
    clearContextCache();
    clearCorpusDigestCache();
  });
});

/* ------------------------------------------------------------------ */
/* §T. Authorisation                                                   */
/* ------------------------------------------------------------------ */

describe('A9.7 §T. nothing A9 added is a new way in', () => {
  const index = () => fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');

  it('T1. every A9 router is mounted after requireOperator', () => {
    const src = index();
    const guard = src.indexOf("app.use('/api', requireOperator)");
    expect(guard).toBeGreaterThan(-1);

    for (const router of ['matchmakingRouter', 'observationsRouter', 'campaignsRouter']) {
      const mount = src.indexOf(`app.use('/api', ${router})`);
      expect({ router, mounted: mount > -1 }).toEqual({ router, mounted: true });
      expect({ router, afterGuard: mount > guard }).toEqual({ router, afterGuard: true });
    }
  });

  it('T2. every state-changing A9 route is also behind the CSRF origin check', () => {
    const src = index();
    const sameOrigin = src.indexOf("app.use('/api', requireSameOrigin)");
    expect(sameOrigin).toBeGreaterThan(-1);
    for (const router of ['matchmakingRouter', 'observationsRouter', 'campaignsRouter']) {
      expect(src.indexOf(`app.use('/api', ${router})`)).toBeGreaterThan(sameOrigin);
    }
  });

  it('T3. no A9 route file declares its own auth, bypass or public mount', () => {
    for (const file of ['server/routes/matchmaking.js', 'server/routes/observations.js']) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of [
        'requireOperator', 'attachOperator', 'publicRouter',
        'skipAuth', 'allowAnonymous', 'req.operator =',
      ]) {
        expect({ file, forbidden, present: code.includes(forbidden) })
          .toEqual({ file, forbidden, present: false });
      }
    }
  });

  /**
   * OWNERSHIP IS THE SHARED OPERATOR STORE'S, NOT A PER-USER ONE — §T is
   * explicit that no per-user model may be invented. What IS checked is that
   * a run, a selection or a message belongs to the ATHLETE the route is
   * scoped to, which is a data-integrity check and not an access one.
   */
  it('T4. athlete scoping is enforced on runs, selections and sends', () => {
    const other = athlete();
    const otherResult = computeMatchmakingV2(db, other);
    persistRun(db, other, otherResult);
    const otherRun = currentRun(db, other.id);

    expect(() => recordSelection(db, player, {
      runId: otherRun.id, collegeName: target.name, sport: run.sport,
      source: SELECTION_SOURCE.TOP_100,
    })).toThrow(/different athlete/i);

    expect(() => createCampaignFromRun(player.id, { runId: otherRun.id }))
      .toThrow(/different athlete/i);

    const otherTop = otherResult.programmes.find((p) => p.status === STATUS.RANKED && p.rank === 1);
    const foreign = recordSelection(db, other, {
      runId: otherRun.id, collegeName: otherTop.name, sport: otherRun.sport,
      source: SELECTION_SOURCE.TOP_100,
    });
    const c = coach(otherTop.name);
    const outreach = createOutreach({ athleteId: player.id, coachId: c });
    expect(() => recordDraft({
      outreachId: outreach.id, athleteId: player.id, coachId: c,
      collegeName: otherTop.name, sport: otherRun.sport,
      matchmakingSelectionId: foreign.id, evidence: null, subject: 's', body: 'b',
    })).toThrow(/different athlete/i);

    db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(other.id);
  });
});
