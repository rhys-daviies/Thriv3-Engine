/**
 * =============================================================================
 * OUTREACH PROVENANCE — A9.6 §X.
 *
 * One claim: a message that says which selection caused it is telling the
 * truth, and a message that says nothing is admitting it does not know.
 *
 * The failure mode worth testing for is not an error. It is a link that
 * resolves cleanly to the wrong programme - because every later question
 * ("did Priority Outreach reply more often than Viable Consideration?") would
 * be answered from it, confidently, for ever.
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
import { persistRun, currentRun } from './matchmakingRuns.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { recordSelection, SELECTION_SOURCE } from './matchmakingSelection.js';
import {
  attachSelectionToSend, sendProvenance, sendsForSelection,
  classifySend, PROVENANCE_CLASS,
} from './outreachProvenance.js';

const players = [];
const coaches = [];
const outreaches = [];
let player;
let runRow;
let result;
let topProgramme;

function athlete(extra = {}) {
  const row = Player.create({
    full_name: `A9.6 ${players.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    contribution_state: 'STATED',
    max_annual_contribution_usd: 25000,
    ...extra,
  });
  players.push(row.id);
  return Player.get(row.id);
}

function coach({ school, sport = 'mens-soccer' }) {
  const id = randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, new Date().toISOString(), 'Test Coach', `c${coaches.length}@example.test`, school, sport);
  coaches.push(id);
  return id;
}

/** A drafted message, with its programme identity frozen the way §E requires. */
function send({ athleteId, coachId, collegeName = null, sport = null }) {
  const outreachId = randomUUID();
  const sendId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO outreach (id, athlete_id, coach_id, token, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(outreachId, athleteId, coachId, randomUUID(), now);
  outreaches.push(outreachId);
  db.prepare(`INSERT INTO outreach_send
                (id, outreach_id, sequence, athlete_id, coach_id, college_name, sport,
                 policy_version, state, created_at)
              VALUES (?, ?, 1, ?, ?, ?, ?, 'TEST', 'DRAFT', ?)`)
    .run(sendId, outreachId, athleteId, coachId, collegeName, sport, now);
  return sendId;
}

beforeAll(() => {
  seedPool('mens-soccer', { count: 140, unscoreable: 6 });
  seedPool('womens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
  player = athlete();
  result = computeMatchmakingV2(db, player);
  persistRun(db, player, result);
  runRow = currentRun(db, player.id);
  topProgramme = result.programmes.find((p) => p.status === STATUS.RANKED && p.rank === 1);
});

afterAll(() => {
  for (const id of outreaches) {
    db.prepare('DELETE FROM outreach_send WHERE outreach_id = ?').run(id);
    db.prepare('DELETE FROM outreach WHERE id = ?').run(id);
  }
  for (const id of coaches) db.prepare('DELETE FROM coaches WHERE id = ?').run(id);
  for (const id of players) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

/**
 * Clearing the ATTACHMENT before the selection, because the foreign key now
 * refuses the other order — which is the point of X13 and is relied on here
 * rather than worked around.
 */
beforeEach(() => {
  for (const id of outreaches) {
    db.prepare('UPDATE outreach_send SET matchmaking_selection_id = NULL WHERE outreach_id = ?')
      .run(id);
  }
  db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(player.id);
});

const select = (programme, extra = {}) => recordSelection(db, player, {
  runId: runRow.id,
  collegeName: programme.name,
  sport: runRow.sport,
  source: SELECTION_SOURCE.TOP_100,
  ...extra,
});

/* ------------------------------------------------------------------ */
/* X1-X3. A V2 message keeps its cause                                */
/* ------------------------------------------------------------------ */

describe('A9.6 §X. a V2-originated message retains its selection', () => {
  it('X1. attaching resolves the whole chain: programme, run, rank, band', () => {
    const sel = select(topProgramme);
    const c = coach({ school: topProgramme.name });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: topProgramme.name, sport: runRow.sport,
    });

    expect(attachSelectionToSend(db, { sendId: s, selectionId: sel.id }).changed).toBe(true);

    const p = sendProvenance(db, s);
    expect(p.provenance).toBe(PROVENANCE_CLASS.V2_PROVENANCE);
    expect(p.run.id).toBe(runRow.id);
    expect(p.selection.collegeName).toBe(topProgramme.name);
    expect(p.selection.rank).toBe(1);
    expect(p.selection.band).toBe(topProgramme.band);
    expect(p.selection.status).toBe(STATUS.RANKED);
  });

  it('X2. the reverse read answers "what was written off this selection"', () => {
    const sel = select(topProgramme);
    const c = coach({ school: topProgramme.name });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: topProgramme.name, sport: runRow.sport,
    });
    attachSelectionToSend(db, { sendId: s, selectionId: sel.id });

    const rows = sendsForSelection(db, sel.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(s);
  });

  it('X3. re-attaching the SAME selection is idempotent, not an error', () => {
    const sel = select(topProgramme);
    const c = coach({ school: topProgramme.name });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: topProgramme.name, sport: runRow.sport,
    });
    attachSelectionToSend(db, { sendId: s, selectionId: sel.id });
    expect(attachSelectionToSend(db, { sendId: s, selectionId: sel.id }).changed).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* X4-X5. V1 / pre-provenance                                         */
/* ------------------------------------------------------------------ */

describe('A9.6 §X. V1 outreach is allowed to say nothing', () => {
  it('X4. a send with no selection is PRE_PROVENANCE, not broken', () => {
    const c = coach({ school: topProgramme.name });
    const s = send({ athleteId: player.id, coachId: c });

    const p = sendProvenance(db, s);
    expect(p.provenance).toBe(PROVENANCE_CLASS.PRE_PROVENANCE);
    expect(p.selection).toBeNull();
    expect(p.run).toBeNull();
  });

  it('X5. classification reads the column and nothing else', () => {
    expect(classifySend({ matchmaking_selection_id: null })).toBe(PROVENANCE_CLASS.PRE_PROVENANCE);
    expect(classifySend({ matchmaking_selection_id: 'x' })).toBe(PROVENANCE_CLASS.V2_PROVENANCE);
  });
});

/* ------------------------------------------------------------------ */
/* X6-X9. The four refusals                                           */
/* ------------------------------------------------------------------ */

describe('A9.6 §X. a link that would be false is refused', () => {
  it('X6. a selection belonging to another athlete is refused', () => {
    const other = athlete();
    const otherResult = computeMatchmakingV2(db, other);
    persistRun(db, other, otherResult);
    const otherRun = currentRun(db, other.id);
    const otherTop = otherResult.programmes.find((p) => p.status === STATUS.RANKED && p.rank === 1);
    const otherSel = recordSelection(db, other, {
      runId: otherRun.id,
      collegeName: otherTop.name,
      sport: otherRun.sport,
      source: SELECTION_SOURCE.TOP_100,
    });

    const c = coach({ school: otherTop.name });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: otherTop.name, sport: otherRun.sport,
    });

    expect(() => attachSelectionToSend(db, { sendId: s, selectionId: otherSel.id }))
      .toThrow(/different athlete/i);
    db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(other.id);
  });

  it('X7. a selection for a different programme is refused', () => {
    const sel = select(topProgramme);
    const elsewhere = result.programmes.find(
      (p) => p.status === STATUS.RANKED && p.name !== topProgramme.name,
    );
    const c = coach({ school: elsewhere.name });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: elsewhere.name, sport: runRow.sport,
    });

    expect(() => attachSelectionToSend(db, { sendId: s, selectionId: sel.id }))
      .toThrow(/was written for/i);
  });

  it('X8. a message that never froze its programme cannot be attributed', () => {
    const sel = select(topProgramme);
    const c = coach({ school: topProgramme.name });
    const s = send({ athleteId: player.id, coachId: c }); // college_name / sport NULL

    expect(() => attachSelectionToSend(db, { sendId: s, selectionId: sel.id }))
      .toThrow(/did not record which programme/i);
  });

  /**
   * THE TRINITY / WHEATON CASE, which is not hypothetical: the live database
   * holds two relationships whose recommendation says Trinity (TX) / Wheaton
   * (MA) and whose coach row says Trinity (CT) / Wheaton (IL).
   */
  it('X9. a coach the evidence places at another institution is refused', () => {
    const sel = select(topProgramme);
    const c = coach({ school: `${topProgramme.name} (CT)` });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: topProgramme.name, sport: runRow.sport,
    });

    expect(() => attachSelectionToSend(db, { sendId: s, selectionId: sel.id }))
      .toThrow(/evidence on file puts this coach/i);
  });

  it('X9b. the same name in the other sport is a different programme', () => {
    const sel = select(topProgramme);
    const c = coach({ school: topProgramme.name, sport: 'womens-soccer' });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: topProgramme.name, sport: runRow.sport,
    });

    expect(() => attachSelectionToSend(db, { sendId: s, selectionId: sel.id }))
      .toThrow(/evidence on file puts this coach/i);
  });
});

/* ------------------------------------------------------------------ */
/* X10-X12. Immutability, and coach movement afterwards               */
/* ------------------------------------------------------------------ */

describe('A9.6 §X. history does not move', () => {
  it('X10. a message is never re-attributed to a different selection', () => {
    const sel = select(topProgramme);
    const c = coach({ school: topProgramme.name });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: topProgramme.name, sport: runRow.sport,
    });
    attachSelectionToSend(db, { sendId: s, selectionId: sel.id });

    // A later run, a later selection of the same programme.
    const second = computeMatchmakingV2(db, player);
    persistRun(db, player, second);
    const newRun = currentRun(db, player.id);
    const newSel = recordSelection(db, player, {
      runId: newRun.id,
      collegeName: topProgramme.name,
      sport: runRow.sport,
      source: SELECTION_SOURCE.SPECIFIC_SEARCH,
    });

    expect(() => attachSelectionToSend(db, { sendId: s, selectionId: newSel.id }))
      .toThrow(/already records the selection/i);
    expect(sendProvenance(db, s).selection.id).toBe(sel.id);
  });

  /**
   * §E's requirement stated as an experiment: move the coach AFTERWARDS and
   * read the attribution again. If anything re-derived programme identity from
   * `coaches`, this is where it would change its mind.
   */
  it('X11. a coach changing institutions does not rewrite old attribution', () => {
    const sel = select(topProgramme);
    const c = coach({ school: topProgramme.name });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: topProgramme.name, sport: runRow.sport,
    });
    attachSelectionToSend(db, { sendId: s, selectionId: sel.id });

    const before = sendProvenance(db, s);
    db.prepare('UPDATE coaches SET school = ?, sport = ? WHERE id = ?')
      .run('Somewhere Else', 'womens-soccer', c);
    const after = sendProvenance(db, s);

    expect(after).toEqual(before);
    expect(after.selection.collegeName).toBe(topProgramme.name);
  });

  it('X12. a selection cannot be edited once written — the database refuses', () => {
    const sel = select(topProgramme);
    expect(() => db.prepare('UPDATE matchmaking_selections SET rank = 999 WHERE id = ?').run(sel.id))
      .toThrow(/append-only/i);
  });

  it('X13. deleting a selection a message points at is refused', () => {
    const sel = select(topProgramme);
    const c = coach({ school: topProgramme.name });
    const s = send({
      athleteId: player.id, coachId: c,
      collegeName: topProgramme.name, sport: runRow.sport,
    });
    attachSelectionToSend(db, { sendId: s, selectionId: sel.id });

    expect(() => db.prepare('DELETE FROM matchmaking_selections WHERE id = ?').run(sel.id))
      .toThrow(/FOREIGN KEY/i);
  });
});
