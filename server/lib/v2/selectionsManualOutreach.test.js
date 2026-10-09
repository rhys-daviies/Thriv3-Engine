/**
 * "SELECTED FOR OUTREACH" SEES MANUAL OUTREACH — Phase 5 follow-up (A).
 *
 * Manual drafts never carry `matchmaking_selection_id`, so the selections
 * surface read only campaign-linked messages: a programme contacted by hand,
 * confirmed sent and replied to still read "Not contacted yet". It now
 * attributes each unlinked manual send, at read time, to exactly one selection
 * of the same programme. These pin what that may and may not do.
 */
import {
  describe, it, expect, beforeAll, beforeEach,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache, STATUS } from './matchmakingService.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { persistRun, currentRun } from './matchmakingRuns.js';
import { recordSelection, SELECTION_SOURCE } from './matchmakingSelection.js';
import { selectionsOverview } from './selectionsOverview.js';
import { recordReply } from './replyIntake.js';
import { recordDraft, acceptSend } from '../outreachSend.js';
import { createOutreach } from '../outreach.js';
import { markResponded } from '../engagementRollup.js';
import { outreachProgress, OUTREACH_PROGRESS } from '../../../src/lib/outreachOutcomeView.js';

let player; let run; let target; let other;
let n = 0;

function coach(school) {
  const id = randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport)
              VALUES (?, ?, ?, ?, ?, 'mens-soccer')`).run(id, new Date().toISOString(), `Coach ${n}`, `m${n++}@example.test`, school);
  return id;
}

/** A send for `collegeName`, linked to a selection only when one is given. */
function send(collegeName, { coachId = coach(collegeName), selectionId = null, origin = 'manual', at, accept = false } = {}) {
  const outreach = createOutreach({ athleteId: player.id, coachId });
  const { id } = recordDraft({
    outreachId: outreach.id, athleteId: player.id, coachId, collegeName, sport: run.sport,
    matchmakingSelectionId: selectionId, evidence: null, subject: 's', body: 'b', origin, ...(at ? { at } : {}),
  });
  if (accept) acceptSend(id);
  return { sendId: id, outreachId: outreach.id, coachId };
}

const select = (collegeName, now) => recordSelection(db, player, { collegeName, source: SELECTION_SOURCE.SPECIFIC_SEARCH, now }).id;
const row = (selId) => selectionsOverview(player.id).selections.find((s) => s.selectionId === selId);

beforeAll(() => {
  seedPool('mens-soccer', { count: 140 });
  clearContextCache(); clearCorpusDigestCache();
  const p = Player.create({
    full_name: 'Manual overview', sport: 'mens-soccer', position: 'Midfielder', football_ability: 6,
    recruiting_class_year: 2028, state: 'CA', origin: 'USA', contribution_state: 'STATED', max_annual_contribution_usd: 25000,
  });
  player = Player.get(p.id);
  const result = computeMatchmakingV2(db, player);
  persistRun(db, player, result);
  run = currentRun(db, player.id);
  const ranked = result.programmes.filter((x) => x.status === STATUS.RANKED);
  [target, other] = [ranked[1], ranked[2]];
});

beforeEach(() => {
  db.prepare('DELETE FROM engagement_rollup WHERE outreach_id IN (SELECT id FROM outreach WHERE athlete_id = ?)').run(player.id);
  db.prepare('DELETE FROM outreach_send_event WHERE outreach_send_id IN (SELECT id FROM outreach_send WHERE athlete_id = ?)').run(player.id);
  db.prepare('DELETE FROM outreach_send WHERE athlete_id = ?').run(player.id);
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(player.id);
  db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(player.id);
});

describe('a manual send reaches its selection', () => {
  it('prepared, then confirmed, then replied to: the row follows, and a draft is never a send', () => {
    const sel = select(target.name);
    expect(outreachProgress(row(sel))).toBe(OUTREACH_PROGRESS.NOT_CONTACTED);

    const s = send(target.name);
    expect(row(sel).outreach).toMatchObject({ messages: 1, accepted: 0, lastSentAt: null });
    expect(outreachProgress(row(sel))).toBe(OUTREACH_PROGRESS.DRAFTED);

    acceptSend(s.sendId);
    expect(row(sel).outreach).toMatchObject({ messages: 1, accepted: 1 });
    expect(outreachProgress(row(sel))).toBe(OUTREACH_PROGRESS.SENT);

    markResponded(s.outreachId);
    expect(row(sel).reply.replies).toBe(1);
    expect(outreachProgress(row(sel))).toBe(OUTREACH_PROGRESS.REPLIED);
  });

  it('a legacy manual draft (no origin, no campaign) counts; another programme\'s does not', () => {
    const sel = select(target.name);
    send(target.name, { origin: null });
    send(other.name);
    expect(row(sel).outreach.messages).toBe(1);
  });

  it('nothing is written: the send keeps no selection link after being read', () => {
    const sel = select(target.name);
    const s = send(target.name);
    row(sel);
    expect(db.prepare('SELECT matchmaking_selection_id FROM outreach_send WHERE id = ?').get(s.sendId).matchmaking_selection_id).toBeNull();
  });
});

describe('each send counts once', () => {
  it('two selections of one programme: a send goes to the latest made before it, or the earliest if it predates both', () => {
    const before = send(target.name, { at: '2026-01-01T00:00:00.000Z', accept: true });
    const first = select(target.name, '2026-02-01T00:00:00.000Z');
    const mid = send(target.name, { at: '2026-03-01T00:00:00.000Z' });
    const second = select(target.name, '2026-04-01T00:00:00.000Z');
    const late = send(target.name, { at: '2026-05-01T00:00:00.000Z' });
    expect(before && mid && late).toBeTruthy();
    expect(row(first).outreach).toMatchObject({ messages: 2, accepted: 1 });   // before + mid
    expect(row(second).outreach).toMatchObject({ messages: 1, accepted: 0 });  // late
    // three sends, three counted across the two rows
    expect(row(first).outreach.messages + row(second).outreach.messages).toBe(3);
  });

  it('a campaign-linked and a manual send to the same coach: two messages, one recipient, one reply', () => {
    const sel = select(target.name);
    const c = coach(target.name);
    const linked = send(target.name, { coachId: c, selectionId: sel, accept: true });
    const manual = send(target.name, { coachId: c });
    expect(manual.outreachId).toBe(linked.outreachId);   // one relationship
    recordReply(db, { sendId: linked.sendId });
    markResponded(linked.outreachId);
    const r = row(sel);
    expect(r.outreach).toMatchObject({ messages: 2, accepted: 1, coaches: 1 });
    expect(r.reply.replies).toBe(1);
  });

  it('an unlinked campaign send is not attributed: its provenance is the campaign\'s', () => {
    const sel = select(target.name);
    const campaign = send(target.name, { origin: 'campaign' });
    const r = row(sel);
    expect(r.outreach?.messages ?? 0).toBe(0);
    expect(db.prepare('SELECT origin FROM outreach_send WHERE id = ?').get(campaign.sendId).origin).toBe('campaign');
  });
});
