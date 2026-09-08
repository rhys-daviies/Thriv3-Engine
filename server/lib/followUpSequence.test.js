import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import { campaignLocalStep } from './evidenceHistory.js';
import { evidenceFor } from './evidenceQueries.js';
import { buildSendSnapshot } from '../../shared/evidence/sendSnapshot.js';
import { EVIDENCE_SEQUENCE_POLICY_VERSION, SEQUENCE_STATUS } from '../../shared/evidence/sequenceStrategy.js';
import { OUTREACH_POLICY_VERSION } from '../../shared/evidence/outreachPolicy.js';
import { createOutreach } from './outreach.js';
import { recordDraft, confirmSend, sendsForOutreach } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * C3 at the server seam: which message of a campaign this is, and what that
 * costs the composition.
 *
 * The property that matters most is negative. A lifetime sequence of 2 is NOT
 * a follow-up — a coach an earlier campaign wrote to twice must receive an
 * initial email when a new campaign reaches them, and the only count that
 * describes the conversation they are actually in is the campaign-local one.
 */

const ATHLETE = 'a-c3';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let seq = 0;

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year)
    VALUES (?, 'x', 'x', ?, 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027)
  `).run(id, name, randomUUID().slice(0, 10));
}

function makeCampaign() {
  db.prepare(`UPDATE campaigns SET state='closed', closed_at='x', close_reason='completed'
    WHERE athlete_id = ? AND state='active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)
  `).run(id, ATHLETE);
  return id;
}

function makeProgramme(campaignId) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(id, campaignId, COLLEGE, SPORT, ++seq);
  return id;
}

const makeCoach = (email = `c${++seq}@duke.edu`) => findOrCreateCoach({
  full_name: 'A Coach', email, school: COLLEGE, sport: SPORT, division: 'NCAA D1',
  position_title: 'Head Coach',
});

/** A real accepted message, through the real write path. */
function sendUnder(pc, coach, kinds = ['CURRENT_SAME_COUNTRY']) {
  const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: COLLEGE, sport: SPORT,
    programmeCampaignId: pc,
    evidence: {
      composition: {
        sentences: kinds.map((kind, i) => ({ order: i, slot: 'RELEVANCE', kind, text: `t${kind}` })),
        placement: [],
      },
    },
    body: `b${++seq}`, subject: 's',
  });
  confirmSend(o.id, undefined, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

const athleteRow = () => db.prepare('SELECT * FROM players WHERE id = ?').get(ATHLETE);
const scope = (pc, coach) => ({ programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id });

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM players;`);
  insertAthlete(ATHLETE, 'C3 Athlete');
  seq = 0;
});

// ---------------------------------------------------------------------------

describe('which message of this campaign this is', () => {
  it('is one when nothing has been sent to this coach', () => {
    const pc = makeProgramme(makeCampaign());
    expect(campaignLocalStep(scope(pc, makeCoach()))).toBe(1);
  });

  it('is two after one accepted message', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    sendUnder(pc, coach);
    expect(campaignLocalStep(scope(pc, coach))).toBe(2);
  });

  it('counts messages, not claims — a generic email still counts', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    sendUnder(pc, coach, []);          // nothing licensed; still a message sent
    expect(sendsForOutreach(
      db.prepare('SELECT id FROM outreach').get().id,
    )[0].rendered_kinds).toBeNull();
    expect(campaignLocalStep(scope(pc, coach))).toBe(2);
  });

  it('is not the lifetime sequence', () => {
    const coach = makeCoach();
    const first = makeProgramme(makeCampaign());
    sendUnder(first, coach);
    sendUnder(first, coach);
    const outreachId = db.prepare('SELECT id FROM outreach').get().id;
    expect(sendsForOutreach(outreachId).map((s) => s.sequence)).toEqual([1, 2]);

    // A new campaign reaches the same coach. Lifetime says three; the
    // conversation this coach is in says one.
    const second = makeProgramme(makeCampaign());
    expect(campaignLocalStep(scope(second, coach))).toBe(1);
  });

  it('is per coach, not per programme', () => {
    const pc = makeProgramme(makeCampaign());
    const head = makeCoach('head@duke.edu');
    const assistant = makeCoach('asst@duke.edu');
    sendUnder(pc, head);

    expect(campaignLocalStep(scope(pc, head))).toBe(2);
    expect(campaignLocalStep(scope(pc, assistant))).toBe(1);
  });

  it('is nothing at all without campaign attribution', () => {
    expect(campaignLocalStep({ athleteId: ATHLETE, coachId: 'c' })).toBeNull();
    expect(campaignLocalStep({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('the seam turns on only for an attributed campaign', () => {
  it('composes with no sequence when nothing names a campaign', () => {
    const out = evidenceFor(athleteRow(), COLLEGE, { sport: SPORT });
    expect(out.sequence).toBeNull();
    expect(out.structure.key).not.toBe('FOLLOW_UP');
  });

  it('composes with no sequence when a campaign is named without a coach', () => {
    // The step is per coach; without one there is no conversation to be in.
    const pc = makeProgramme(makeCampaign());
    expect(evidenceFor(athleteRow(), COLLEGE, { sport: SPORT, programmeCampaignId: pc }).sequence)
      .toBeNull();
  });

  it('reports step 1 and the normal structure for a campaign first contact', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    const out = evidenceFor(athleteRow(), COLLEGE, {
      sport: SPORT, programmeCampaignId: pc, coachId: coach.id,
    });

    expect(out.sequence).toMatchObject({
      step: 1,
      status: SEQUENCE_STATUS.INITIAL,
      sequencePolicyVersion: EVIDENCE_SEQUENCE_POLICY_VERSION,
    });
    // Step 1 has no opinion, so the structure is whatever the evidence chose.
    expect(out.sequence.preferredForThisMessage).toBeNull();
    expect(out.structure.key).not.toBe('FOLLOW_UP');
  });

  it('reaches the follow-up structure at step 2', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    sendUnder(pc, coach);

    const out = evidenceFor(athleteRow(), COLLEGE, {
      sport: SPORT, programmeCampaignId: pc, coachId: coach.id,
    });
    expect(out.sequence.step).toBe(2);
    expect(out.structure.key).toBe('FOLLOW_UP');
    expect(out.structure.source).toBe('SEQUENCE');
  });

  it('gives a new campaign an initial email against a coach it has written to twice', () => {
    const coach = makeCoach();
    const first = makeProgramme(makeCampaign());
    sendUnder(first, coach);
    sendUnder(first, coach);

    const second = makeProgramme(makeCampaign());
    const out = evidenceFor(athleteRow(), COLLEGE, {
      sport: SPORT, programmeCampaignId: second, coachId: coach.id,
    });
    expect(out.sequence.step).toBe(1);
    expect(out.structure.key).not.toBe('FOLLOW_UP');
  });

  it('fails closed on a third message rather than composing a generic one', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    sendUnder(pc, coach);
    sendUnder(pc, coach);

    expect(() => evidenceFor(athleteRow(), COLLEGE, {
      sport: SPORT, programmeCampaignId: pc, coachId: coach.id,
    })).toThrow(/describes 2 messages per coach/);
    try {
      evidenceFor(athleteRow(), COLLEGE, {
        sport: SPORT, programmeCampaignId: pc, coachId: coach.id,
      });
    } catch (err) { expect(err.code).toBe('UNSUPPORTED_SEQUENCE_STEP'); }
  });

  it('holds the sequence policy in one place, not in each client', () => {
    // One production composition path: nothing outside evidenceQueries decides
    // what ESP1 means, so a browser, a CLI and a route cannot disagree.
    const callers = ['src/lib/emailTemplate.js', 'src/components/BulkEmailComposer.jsx',
      'server/scripts/draftOutreach.js', 'server/routes/sendOutreach.js'];
    for (const rel of callers) {
      const src = fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
      expect(src, rel).not.toMatch(/evidenceStrategyForMessage|sequenceStrategy|campaignLocalStep/);
    }
  });
});

// ---------------------------------------------------------------------------

describe('what a message remembers about its own sequence', () => {
  const sequence = {
    sequencePolicyVersion: EVIDENCE_SEQUENCE_POLICY_VERSION,
    step: 2,
    status: SEQUENCE_STATUS.NEW_EVIDENCE,
    available: [
      { kind: 'ACADEMIC_FIT', role: 'RELEVANCE', group: 'academic' },
      { kind: 'CURRENT_SAME_COUNTRY', role: 'HOOK', group: 'international-connection' },
    ],
    previouslyUsed: [
      { kind: 'CURRENT_SAME_COUNTRY', group: 'international-connection', source: 'SENT' },
      { kind: 'POSITION_GRADUATION', group: 'position-opportunity', source: 'OPEN_DRAFT' },
    ],
    preferredForThisMessage: ['ACADEMIC_FIT'],
  };

  it('records the policy, the step, the status and the groups', () => {
    const snap = buildSendSnapshot({
      evidence: {
        sequence,
        composition: { sentences: [{ order: 0, slot: 'RELEVANCE', kind: 'ACADEMIC_FIT', text: 't' }], placement: [] },
        structure: { key: 'FOLLOW_UP', source: 'SEQUENCE' },
      },
      body: 'b', subject: 's',
    });

    expect(snap.payload.sequence).toEqual({
      policy_version: 'ESP1',
      step: 2,
      status: SEQUENCE_STATUS.NEW_EVIDENCE,
      // Only what was SENT — an open draft is not something a coach has read.
      previously_used: ['international-connection'],
      selected: ['academic'],
    });
    expect(snap.structure).toBe('FOLLOW_UP');
    expect(snap.structure_source).toBe('SEQUENCE');
  });

  it('keeps the two policy authorities apart', () => {
    const snap = buildSendSnapshot({
      evidence: { sequence, composition: { sentences: [], placement: [] } },
      body: 'b', subject: 's',
    });
    // P5 says what a claim may assert; ESP1 says how a previous message
    // narrows the next. They move on different schedules and a row keeps both.
    expect(snap.policy_version).toBe(OUTREACH_POLICY_VERSION);
    expect(snap.payload.sequence.policy_version).toBe('ESP1');
    expect(snap.policy_version).not.toBe(snap.payload.sequence.policy_version);
  });

  it('records nothing at all for an unattributed message', () => {
    const snap = buildSendSnapshot({
      evidence: { composition: { sentences: [], placement: [] } }, body: 'b', subject: 's',
    });
    // Inventing a step 1 would claim a campaign the message was never part of,
    // and it is why no existing payload changes shape.
    expect(snap.payload).not.toHaveProperty('sequence');
    expect(Object.keys(snap.payload).sort())
      .toEqual(['engine_selected', 'held', 'operator_selected', 'rendered']);
  });

  it('records a NO_NEW_EVIDENCE follow-up as what it was', () => {
    const snap = buildSendSnapshot({
      evidence: {
        sequence: { ...sequence, status: SEQUENCE_STATUS.NO_NEW_EVIDENCE, preferredForThisMessage: [] },
        composition: { sentences: [], placement: [] },
      },
      body: 'b', subject: 's',
    });
    expect(snap.payload.sequence.status).toBe(SEQUENCE_STATUS.NO_NEW_EVIDENCE);
    expect(snap.payload.sequence.selected).toEqual([]);
    expect(snap.rendered_kinds).toBeNull();
    expect(snap.has_personalisation).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('composing a follow-up changes nothing', () => {
  it('writes no row and mutates no campaign state', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    sendUnder(pc, coach);

    const tables = ['campaigns', 'programme_campaigns', 'programme_contact_attempts',
      'outreach', 'outreach_send', 'outbound_send_attempt', 'coaches', 'players'];
    const before = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));

    for (let i = 0; i < 3; i += 1) {
      evidenceFor(athleteRow(), COLLEGE, {
        sport: SPORT, programmeCampaignId: pc, coachId: coach.id,
      });
    }

    for (const t of tables) expect(db.prepare(`SELECT * FROM ${t}`).all(), t).toEqual(before[t]);
  });

  it('advances no contact-attempt step and consumes no budget', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    sendUnder(pc, coach);
    evidenceFor(athleteRow(), COLLEGE, { sport: SPORT, programmeCampaignId: pc, coachId: coach.id });

    expect(db.prepare('SELECT COUNT(*) n FROM programme_contact_attempts').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outbound_send_attempt').get().n).toBe(0);

    const src = fs.readFileSync(new URL('./evidenceQueries.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/advanceContactAttemptStep|recordOutboundAttempt|transitionSend|composeInOutlook/);
  });
});
