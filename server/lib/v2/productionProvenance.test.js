/**
 * =============================================================================
 * THE PROVENANCE CHAIN, THROUGH THE REAL SEND PATH — A9.7 §G, §L, §M.
 *
 * A9.6 built the linkage primitive and proved it in isolation. The claim here
 * is stronger and is the one the phase exists to make: that a message created
 * by the ACTUAL production `recordDraft` carries its cause, and that the cause
 * can still be read correctly a run later, a coach later, and a month later.
 *
 * §L is the test that matters most. A rank is a position in a population, and
 * populations move. If a send made when a programme was #20 could ever be read
 * back as #80 because a newer run exists, then every outcome question Thriv3
 * ever asks would be answered against the wrong number - silently, and with no
 * way to notice.
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
import { sendProvenance, PROVENANCE_CLASS } from './outreachProvenance.js';
import { recordDraft, acceptSend } from '../outreachSend.js';
import { createOutreach } from '../outreach.js';
import { recordObservation, OBSERVATION_KIND, OBSERVATION_SOURCE } from './recruitingObservations.js';

const players = [];
const coaches = [];
let player;
let runA;
let resultA;
let target;

function athlete() {
  const row = Player.create({
    full_name: `A9.7 ${players.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    contribution_state: 'STATED',
    max_annual_contribution_usd: 25000,
  });
  players.push(row.id);
  return Player.get(row.id);
}

function coach({ school, sport = 'mens-soccer', name = 'Head Coach' }) {
  const id = randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport, position_title)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, new Date().toISOString(), name, `c${coaches.length}@example.test`, school, sport, name);
  coaches.push(id);
  return id;
}

/** THE REAL PATH: the same two calls every production send makes. */
function draft({ coachId, collegeName, sport, selectionId = null, sequence = null }) {
  const outreach = createOutreach({ athleteId: player.id, coachId });
  if (sequence === 2) {
    // A follow-up needs the first message settled, exactly as production does.
    const open = db.prepare(
      "SELECT id FROM outreach_send WHERE outreach_id = ? AND state = 'DRAFT'",
    ).get(outreach.id);
    if (open) acceptSend(open.id);
  }
  return recordDraft({
    outreachId: outreach.id,
    athleteId: player.id,
    coachId,
    collegeName,
    sport,
    matchmakingSelectionId: selectionId,
    evidence: null,
    subject: 'Test subject',
    body: 'Test body',
  });
}

beforeAll(() => {
  seedPool('mens-soccer', { count: 140, unscoreable: 6 });
  seedPool('womens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
  player = athlete();
  resultA = computeMatchmakingV2(db, player);
  persistRun(db, player, resultA);
  runA = currentRun(db, player.id);
  target = resultA.programmes.find((p) => p.status === STATUS.RANKED && p.rank === 5);
});

afterAll(() => {
  db.prepare('DELETE FROM recruiting_observations WHERE athlete_id = ?').run(player.id);
  db.prepare(`DELETE FROM outreach_send WHERE outreach_id IN
              (SELECT id FROM outreach WHERE athlete_id = ?)`).run(player.id);
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(player.id);
  for (const id of coaches) db.prepare('DELETE FROM coaches WHERE id = ?').run(id);
  for (const id of players) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

beforeEach(() => {
  db.prepare('DELETE FROM recruiting_observations WHERE athlete_id = ?').run(player.id);
  db.prepare(`DELETE FROM outreach_send WHERE outreach_id IN
              (SELECT id FROM outreach WHERE athlete_id = ?)`).run(player.id);
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(player.id);
});

const select = (programme, extra = {}) => recordSelection(db, player, {
  runId: runA.id,
  collegeName: programme.name,
  sport: runA.sport,
  source: SELECTION_SOURCE.TOP_100,
  ...extra,
});

/* ------------------------------------------------------------------ */
/* §G. The hard acceptance gate                                        */
/* ------------------------------------------------------------------ */

describe('A9.7 §G. a real send carries its whole cause', () => {
  it('G1. from the send record alone: athlete, programme, coach, selection, run, rank', () => {
    const sel = select(target);
    const c = coach({ school: target.name });
    const { id: sendId } = draft({
      coachId: c, collegeName: target.name, sport: runA.sport, selectionId: sel.id,
    });

    const row = db.prepare('SELECT * FROM outreach_send WHERE id = ?').get(sendId);
    const p = sendProvenance(db, sendId);

    // Everything §G requires, recovered from the stored record.
    expect(row.athlete_id).toBe(player.id);
    expect(row.coach_id).toBe(c);
    expect(row.college_name).toBe(target.name);
    expect(row.sport).toBe(runA.sport);
    expect(p.provenance).toBe(PROVENANCE_CLASS.V2_PROVENANCE);
    expect(p.selection.id).toBe(sel.id);
    expect(p.run.id).toBe(runA.id);
    expect(p.selection.rank).toBe(5);
    expect(p.selection.status).toBe(STATUS.RANKED);
    expect(p.selection.band).toBe(target.band);
  });

  it('G2. and the run still holds the layers that produced that rank', () => {
    const sel = select(target);
    const c = coach({ school: target.name });
    const { id: sendId } = draft({
      coachId: c, collegeName: target.name, sport: runA.sport, selectionId: sel.id,
    });
    const runId = sendProvenance(db, sendId).run.id;

    const stored = db.prepare(`
      SELECT * FROM matchmaking_programme_results
       WHERE run_id = ? AND college_name = ?`).get(runId, target.name);

    // §G: rank, status, Pursuit and all three layers, recovered from the send.
    expect(stored).toBeDefined();
    expect(stored.rank).toBe(5);
    expect(stored.status).toBe(STATUS.RANKED);
    expect(stored.pursuit).toBeCloseTo(target.pursuit, 10);
    for (const layer of ['recruitability', 'financial', 'opportunity']) {
      expect(stored[layer]).not.toBeNull();
      expect(stored[`${layer}_grade`]).toMatch(/MEASURED|PARTIAL/);
    }
  });

  it('G3. the provenance write is atomic — a refused selection leaves no message', () => {
    const other = athlete();
    const otherResult = computeMatchmakingV2(db, other);
    persistRun(db, other, otherResult);
    const otherRun = currentRun(db, other.id);
    const otherTop = otherResult.programmes.find((p) => p.status === STATUS.RANKED && p.rank === 1);
    const foreign = recordSelection(db, other, {
      runId: otherRun.id, collegeName: otherTop.name, sport: otherRun.sport,
      source: SELECTION_SOURCE.TOP_100,
    });

    const c = coach({ school: otherTop.name });
    expect(() => draft({
      coachId: c, collegeName: otherTop.name, sport: otherRun.sport, selectionId: foreign.id,
    })).toThrow(/different athlete/i);

    // Nothing was written: no message exists for this athlete and coach.
    const any = db.prepare(
      'SELECT COUNT(*) n FROM outreach_send WHERE athlete_id = ? AND coach_id = ?',
    ).get(player.id, c).n;
    expect(any).toBe(0);
    db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(other.id);
  });
});

/* ------------------------------------------------------------------ */
/* §D. V1 keeps working                                                */
/* ------------------------------------------------------------------ */

describe('A9.7 §D. V1 outreach is unchanged', () => {
  it('D1. a send with no selection is created exactly as before', () => {
    const c = coach({ school: target.name });
    const { id: sendId } = draft({ coachId: c, collegeName: target.name, sport: runA.sport });
    const row = db.prepare('SELECT * FROM outreach_send WHERE id = ?').get(sendId);

    expect(row.matchmaking_selection_id).toBeNull();
    expect(row.state).toBe('DRAFT');
    expect(sendProvenance(db, sendId).provenance).toBe(PROVENANCE_CLASS.PRE_PROVENANCE);
  });

  it('D2. a V1 send needs no run, no selection and no matchmaking of any kind', () => {
    const fresh = athlete();
    const c = coach({ school: 'Somewhere V1' });
    const outreach = createOutreach({ athleteId: fresh.id, coachId: c });
    const { id } = recordDraft({
      outreachId: outreach.id, athleteId: fresh.id, coachId: c,
      collegeName: 'Somewhere V1', sport: 'mens-soccer',
      evidence: null, subject: 's', body: 'b',
    });
    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_runs WHERE player_id = ?')
      .get(fresh.id).n).toBe(0);
    expect(sendProvenance(db, id).provenance).toBe(PROVENANCE_CLASS.PRE_PROVENANCE);
    db.prepare('DELETE FROM outreach_send WHERE id = ?').run(id);
    db.prepare('DELETE FROM outreach WHERE id = ?').run(outreach.id);
  });
});

/* ------------------------------------------------------------------ */
/* §L. HISTORICAL TRUTH — the scenario, exactly as specified           */
/* ------------------------------------------------------------------ */

describe('A9.7 §L. a send made at #20 is never re-read as #80', () => {
  it('L1. Run A #N, send, profile changes, Run B #M — the send still says Run A, #N', () => {
    /* -- Run A: choose a programme and write to it ---------------------- */
    const sel = select(target);
    const rankAtSend = sel.programme.rank;
    const c = coach({ school: target.name });
    const { id: sendId } = draft({
      coachId: c, collegeName: target.name, sport: runA.sport, selectionId: sel.id,
    });
    acceptSend(sendId);

    const before = sendProvenance(db, sendId);
    expect(before.run.id).toBe(runA.id);
    expect(before.selection.rank).toBe(rankAtSend);

    /* -- the athlete's profile changes, and a NEW run is generated ------ */
    Player.update(player.id, { football_ability: 9, max_annual_contribution_usd: 70000 });
    const moved = Player.get(player.id);
    clearContextCache();
    const resultB = computeMatchmakingV2(db, moved);
    persistRun(db, moved, resultB);
    const runB = currentRun(db, moved.id);

    expect(runB.id).not.toBe(runA.id);

    /**
     * The programme genuinely moved. If it did not, this test would pass
     * without testing anything - so the movement is asserted, not assumed.
     */
    const rankNow = resultB.programmes.find((p) => p.name === target.name)?.rank ?? null;
    expect(rankNow).not.toBe(rankAtSend);

    /* -- and the old send is unmoved ------------------------------------ */
    const after = sendProvenance(db, sendId);
    expect(after).toEqual(before);
    expect(after.run.id).toBe(runA.id);
    expect(after.selection.rank).toBe(rankAtSend);
    expect(after.run.id).not.toBe(runB.id);

    // Restore, so later tests read the athlete this suite set up.
    Player.update(player.id, { football_ability: 6, max_annual_contribution_usd: 25000 });
    clearContextCache();
  });

  it('L2. an observation recorded later still resolves to the ORIGINAL run', () => {
    const sel = select(target);
    const c = coach({ school: target.name });
    const { id: sendId } = draft({
      coachId: c, collegeName: target.name, sport: runA.sport, selectionId: sel.id,
    });

    recordObservation(db, {
      athleteId: player.id,
      collegeName: target.name,
      sport: runA.sport,
      outreachSendId: sendId,
      matchmakingSelectionId: sel.id,
      kind: OBSERVATION_KIND.POSITIVE_REPLY,
      source: OBSERVATION_SOURCE.COACH_REPLY,
    });

    const joined = db.prepare(`
      SELECT o.kind, s.rank, s.matchmaking_run_id
        FROM recruiting_observations o
        JOIN matchmaking_selections s ON s.id = o.matchmaking_selection_id
       WHERE o.outreach_send_id = ?`).get(sendId);

    expect(joined.kind).toBe(OBSERVATION_KIND.POSITIVE_REPLY);
    expect(joined.rank).toBe(5);
    expect(joined.matchmaking_run_id).toBe(runA.id);
  });
});

/* ------------------------------------------------------------------ */
/* §M. Duplicates and multi-coach                                      */
/* ------------------------------------------------------------------ */

describe('A9.7 §M. legitimate multi-coach and follow-up outreach still works', () => {
  it('M1. head coach AND assistant at the same programme, from one selection', () => {
    const sel = select(target);
    const head = coach({ school: target.name, name: 'Head Coach' });
    const assistant = coach({ school: target.name, name: 'Assistant Coach' });

    const a = draft({ coachId: head, collegeName: target.name, sport: runA.sport, selectionId: sel.id });
    const b = draft({ coachId: assistant, collegeName: target.name, sport: runA.sport, selectionId: sel.id });

    expect(a.id).not.toBe(b.id);
    for (const { id } of [a, b]) {
      expect(sendProvenance(db, id).selection.id).toBe(sel.id);
    }
    // ONE selection, TWO messages. The selection is the decision to pursue the
    // PROGRAMME; who is written to is a separate, later question.
    const n = db.prepare(
      'SELECT COUNT(*) n FROM outreach_send WHERE matchmaking_selection_id = ?',
    ).get(sel.id).n;
    expect(n).toBe(2);
  });

  it('M2. a follow-up is a second message on the same relationship, same cause', () => {
    const sel = select(target);
    const c = coach({ school: target.name });
    const first = draft({ coachId: c, collegeName: target.name, sport: runA.sport, selectionId: sel.id });
    const second = draft({
      coachId: c, collegeName: target.name, sport: runA.sport, selectionId: sel.id, sequence: 2,
    });

    expect(second.id).not.toBe(first.id);
    expect(second.sequence).toBe(2);
    expect(sendProvenance(db, second.id).selection.id).toBe(sel.id);
  });

  it('M3. selecting the same programme out of a LATER run is a new selection', () => {
    const first = select(target);
    const c = coach({ school: target.name });
    draft({ coachId: c, collegeName: target.name, sport: runA.sport, selectionId: first.id });

    clearContextCache();
    const resultB = computeMatchmakingV2(db, player);
    persistRun(db, player, resultB);
    const runB = currentRun(db, player.id);
    const second = recordSelection(db, player, {
      runId: runB.id, collegeName: target.name, sport: runB.sport,
      source: SELECTION_SOURCE.SPECIFIC_SEARCH,
    });

    expect(second.id).not.toBe(first.id);
    expect(second.runId).toBe(runB.id);
    // Two decisions, two rows, and the first message still names the first.
    const rows = db.prepare(
      'SELECT COUNT(*) n FROM matchmaking_selections WHERE player_id = ? AND college_name = ?',
    ).get(player.id, target.name).n;
    expect(rows).toBeGreaterThanOrEqual(2);
  });

  it('M4. the same draft rewritten in place keeps one message, not two', () => {
    const sel = select(target);
    const c = coach({ school: target.name });
    const first = draft({ coachId: c, collegeName: target.name, sport: runA.sport, selectionId: sel.id });
    const again = draft({ coachId: c, collegeName: target.name, sport: runA.sport, selectionId: sel.id });

    // Same open DRAFT replaced, not a second first-contact send.
    expect(again.id).toBe(first.id);
    expect(again.sequence).toBe(1);
    expect(sendProvenance(db, first.id).selection.id).toBe(sel.id);
  });
});
