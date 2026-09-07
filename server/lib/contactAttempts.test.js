import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  ATTEMPT_STATE, UNREACHABLE_STATES,
  createContactAttempt, transitionContactAttempt, advanceContactAttemptStep,
  linkContactAttemptToOutreach,
  contactAttempt, attemptForCoach, attemptsForProgrammeCampaign, attemptsForCampaign,
  attemptsForOutreach,
} from './contactAttempts.js';
import { createOutreach, resolveToken } from './outreach.js';
import { recordDraft, confirmSend, sendsForOutreach, sendsForProgrammeCampaign } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { campaignContactDecision } from './campaignAttribution.js';
import { isSuppressed, suppress } from './suppressions.js';
import { recentSendCount } from './sendCap.js';

/**
 * B4 — this campaign is pursuing this coach at this programme.
 *
 * The two properties that matter most are both about what a row does NOT mean:
 *
 *   1. A row is a PLAN. It may exist before anything is drafted and before the
 *      campaign is active, and nothing may read it as "we contacted this coach".
 *   2. It is CAMPAIGN-SPECIFIC. Two campaigns pursuing one coach are two
 *      attempts sharing one lifetime relationship, and the second campaign's
 *      progression is its own.
 */

const ATHLETE = 'a-attempt';
const OTHER_ATHLETE = 'a-attempt-other';
let seq = 0;

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer', ?)
  `).run(id, name, randomUUID().slice(0, 10));
}

function makeCampaign({ athleteId = ATHLETE, state = 'active' } = {}) {
  // One active campaign per athlete — A1's index. A new one closes the last.
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(athleteId);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2020-01-01', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)
  `).run(id, athleteId, state);
  return id;
}

function makeProgramme(campaignId, { college = 'Duke', sport = 'mens-soccer', rank = null } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, sport, rank ?? ++seq);
  return id;
}

const makeCoach = ({ school = 'Duke', sport = 'mens-soccer', email } = {}) => findOrCreateCoach({
  full_name: 'A Coach', email: email ?? `c${++seq}@duke.edu`, school, sport, division: 'NCAA D1',
});

/** An active campaign, a Duke programme, one coach. */
function scene(overrides = {}) {
  const campaign = makeCampaign(overrides.campaign);
  const pc = makeProgramme(campaign, overrides.programme);
  const coach = makeCoach(overrides.coach);
  return { campaign, pc, coach };
}

beforeEach(() => {
  db.exec(`DELETE FROM programme_contact_attempts; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM programme_campaigns;
           DELETE FROM campaigns; DELETE FROM coaches; DELETE FROM players;
           DELETE FROM suppressions;`);
  insertAthlete(ATHLETE, 'Attempt Athlete');
  insertAthlete(OTHER_ATHLETE, 'Other Athlete');
});

// ---------------------------------------------------------------------------

describe('the schema', () => {
  it('creates the table with the approved shape', () => {
    const cols = db.prepare('PRAGMA table_info(programme_contact_attempts)').all();
    expect(cols.map((c) => c.name).sort()).toEqual([
      'coach_id', 'created_at', 'id', 'next_action_at', 'outreach_id',
      'programme_campaign_id', 'state', 'state_changed_at', 'state_reason', 'step', 'updated_at',
    ]);
    expect(cols.find((c) => c.name === 'outreach_id').notnull).toBe(0);
    expect(cols.find((c) => c.name === 'state').dflt_value).toBe("'planned'");
    expect(cols.find((c) => c.name === 'step').dflt_value).toBe('1');
  });

  it('owns the attempt from the programme campaign and merely references the rest', () => {
    const fks = db.prepare('PRAGMA foreign_key_list(programme_contact_attempts)').all();
    const by = Object.fromEntries(fks.map((f) => [f.from, f]));
    // Owned: an attempt is execution state for a pursuit that no longer exists.
    expect(by.programme_campaign_id.on_delete).toBe('CASCADE');
    // Referenced: refusing the delete, as every other reference to these two
    // tables in this schema does.
    expect(by.coach_id.on_delete).toBe('NO ACTION');
    expect(by.outreach_id.on_delete).toBe('NO ACTION');
  });

  it('is unique per coach per campaign, and NOT per relationship', () => {
    const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'programme_contact_attempts'").all();
    expect(indexes.map((i) => i.name)).toEqual(expect.arrayContaining([
      'idx_contact_attempts_programme', 'idx_contact_attempts_coach', 'idx_contact_attempts_outreach',
    ]));
    const { pc, coach } = scene();
    createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    expect(() => db.prepare(`
      INSERT INTO programme_contact_attempts (id, programme_campaign_id, coach_id, state, step,
        created_at, updated_at)
      VALUES (?, ?, ?, 'planned', 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
    `).run(randomUUID(), pc, coach.id)).toThrow(/UNIQUE constraint failed/);
  });

  it('permits the five states the column may ever hold', () => {
    const { pc, coach } = scene();
    const a = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    for (const state of ['planned', 'active', 'waiting', 'stopped', 'completed']) {
      expect(() => db.prepare('UPDATE programme_contact_attempts SET state = ? WHERE id = ?')
        .run(state, a.id)).not.toThrow();
    }
    expect(() => db.prepare('UPDATE programme_contact_attempts SET state = ? WHERE id = ?')
      .run('nonsense', a.id)).toThrow(/CHECK constraint failed/);
  });

  it('refuses a step below one', () => {
    const { pc, coach } = scene();
    const a = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    expect(() => db.prepare('UPDATE programme_contact_attempts SET step = 0 WHERE id = ?').run(a.id))
      .toThrow(/CHECK constraint failed/);
  });
});

// ---------------------------------------------------------------------------

describe('planning an attempt', () => {
  it('creates one planned, at step 1, linked to nothing', () => {
    const { pc, coach } = scene();
    const a = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    expect(a).toMatchObject({
      programme_campaign_id: pc, coach_id: coach.id, outreach_id: null,
      state: 'planned', step: 1, state_reason: null, state_changed_at: null,
      next_action_at: null, created: true,
    });
  });

  /**
   * THE POINT OF A DRAFT CAMPAIGN. An operator reviews and decides who to
   * pursue before activating anything, so planning must not require an active
   * campaign — while B3 still refuses the message.
   */
  it('plans against a draft campaign, which B3 still refuses to send for', () => {
    const { pc, coach } = scene({ campaign: { state: 'draft' } });
    expect(createContactAttempt({ programmeCampaignId: pc, coachId: coach.id }).state)
      .toBe('planned');
    expect(campaignContactDecision({
      programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id, onDate: '2026-09-15',
    }).reason).toBe('CAMPAIGN_NOT_ACTIVE');
  });

  it('is idempotent and never resurrects a stopped attempt', () => {
    const { pc, coach } = scene();
    const first = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    transitionContactAttempt(first.id, 'stopped', { reason: 'no_contact' });

    const again = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    expect(again.id).toBe(first.id);
    expect(again.created).toBe(false);
    // Resuming is said out loud through a transition, never as a side effect
    // of asking to plan.
    expect(again.state).toBe('stopped');
    expect(again.state_reason).toBe('no_contact');
    expect(db.prepare('SELECT COUNT(*) n FROM programme_contact_attempts').get().n).toBe(1);
  });

  /**
   * THE REASON THIS TABLE IS CAMPAIGN-SPECIFIC. One relationship, two pursuits,
   * each with its own progression.
   */
  it('gives each campaign its own attempt for the same coach', () => {
    const coach = makeCoach();
    const firstPc = makeProgramme(makeCampaign());
    const a = createContactAttempt({ programmeCampaignId: firstPc, coachId: coach.id });

    // A season later.
    const secondPc = makeProgramme(makeCampaign());
    const b = createContactAttempt({ programmeCampaignId: secondPc, coachId: coach.id });

    expect(b.id).not.toBe(a.id);
    expect(b.state).toBe('planned');
    expect(b.step).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_contact_attempts').get().n).toBe(2);
  });

  it('refuses a coach at another programme, in another sport, or that does not exist', () => {
    const { pc } = scene();
    expect(() => createContactAttempt({ programmeCampaignId: pc, coachId: makeCoach({ school: 'Clemson' }).id }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_PROGRAMME_MISMATCH' }));
    expect(() => createContactAttempt({ programmeCampaignId: pc, coachId: makeCoach({ sport: 'womens-soccer' }).id }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_PROGRAMME_MISMATCH' }));
    expect(() => createContactAttempt({ programmeCampaignId: pc, coachId: 'nope' }))
      .toThrow(expect.objectContaining({ code: 'COACH_NOT_FOUND' }));
    expect(db.prepare('SELECT COUNT(*) n FROM programme_contact_attempts').get().n).toBe(0);
  });

  it('refuses a programme campaign that does not exist, and a mismatched athlete', () => {
    const { pc, coach } = scene();
    expect(() => createContactAttempt({ programmeCampaignId: 'nope', coachId: coach.id }))
      .toThrow(expect.objectContaining({ code: 'PROGRAMME_CAMPAIGN_NOT_FOUND' }));
    expect(() => createContactAttempt({
      programmeCampaignId: pc, coachId: coach.id, athleteId: OTHER_ATHLETE,
    })).toThrow(expect.objectContaining({ code: 'CAMPAIGN_ATHLETE_MISMATCH' }));
  });
});

// ---------------------------------------------------------------------------

describe('state', () => {
  const planned = () => {
    const { pc, coach } = scene();
    return { ...createContactAttempt({ programmeCampaignId: pc, coachId: coach.id }), pc, coach };
  };

  it('moves planned -> active and active -> stopped with a reason', () => {
    const a = planned();
    expect(transitionContactAttempt(a.id, 'active').state).toBe('active');
    const stopped = transitionContactAttempt(a.id, 'stopped', {
      reason: 'not_recruiting', at: '2026-09-10T00:00:00.000Z',
    });
    expect(stopped).toMatchObject({
      state: 'stopped', state_reason: 'not_recruiting', state_changed_at: '2026-09-10T00:00:00.000Z',
    });
  });

  it('moves planned -> stopped without ever starting', () => {
    const a = planned();
    expect(transitionContactAttempt(a.id, 'stopped', { reason: 'suppressed' }).state).toBe('stopped');
  });

  it('resumes a stopped attempt and clears the stale reason', () => {
    const a = planned();
    transitionContactAttempt(a.id, 'stopped', { reason: 'no_contact' });
    const resumed = transitionContactAttempt(a.id, 'active');
    expect(resumed.state).toBe('active');
    expect(resumed.state_reason).toBeNull();
  });

  it('refuses a stop with no reason, leaving the attempt alone', () => {
    const a = planned();
    for (const reason of [undefined, null, '', '   ']) {
      expect(() => transitionContactAttempt(a.id, 'stopped', { reason }))
        .toThrow(expect.objectContaining({ code: 'ATTEMPT_STOP_REASON_REQUIRED' }));
    }
    expect(contactAttempt(a.id).state).toBe('planned');
  });

  it('refuses going back to planned', () => {
    const a = planned();
    transitionContactAttempt(a.id, 'active');
    expect(() => transitionContactAttempt(a.id, 'planned'))
      .toThrow(expect.objectContaining({ code: 'ILLEGAL_ATTEMPT_TRANSITION' }));
  });

  it('treats the same state as nothing having happened', () => {
    const a = planned();
    const first = transitionContactAttempt(a.id, 'stopped', {
      reason: 'not_recruiting', at: '2026-09-10T00:00:00.000Z',
    });
    const again = transitionContactAttempt(a.id, 'stopped', {
      reason: 'operator', at: '2027-01-01T00:00:00.000Z',
    });
    expect(again.changed).toBe(false);
    expect(again.state_changed_at).toBe(first.state_changed_at);
    expect(again.state_reason).toBe('not_recruiting');
  });

  /**
   * The column can hold them so B6 needs no table rebuild. Nothing can put them
   * there until the thing that gives each meaning exists.
   */
  it('refuses waiting and completed by name, saying what each needs', () => {
    const a = planned();
    for (const [state, needs] of Object.entries(UNREACHABLE_STATES)) {
      let thrown;
      try { transitionContactAttempt(a.id, state); } catch (err) { thrown = err; }
      expect(thrown.code, state).toBe('ATTEMPT_STATE_UNAVAILABLE');
      expect(thrown.message).toContain(needs);
    }
    expect(contactAttempt(a.id).state).toBe('planned');
  });

  it('refuses a state that is not a state, and an attempt that is not there', () => {
    const a = planned();
    expect(() => transitionContactAttempt(a.id, 'ACTIVE'))
      .toThrow(expect.objectContaining({ code: 'INVALID_ATTEMPT_STATE' }));
    expect(() => transitionContactAttempt('nope', 'active'))
      .toThrow(expect.objectContaining({ code: 'CONTACT_ATTEMPT_NOT_FOUND' }));
  });
});

// ---------------------------------------------------------------------------

describe('step', () => {
  const planned = () => {
    const { pc, coach } = scene();
    return createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
  };

  it('starts at 1 and advances one at a time', () => {
    const a = planned();
    expect(a.step).toBe(1);
    expect(advanceContactAttemptStep(a.id).step).toBe(2);
    expect(advanceContactAttemptStep(a.id).step).toBe(3);
  });

  it('cannot be jumped or wound back through the helper', () => {
    const a = planned();
    // There is no argument to set it: the only operation is +1.
    expect(advanceContactAttemptStep.length).toBeLessThanOrEqual(2);
    advanceContactAttemptStep(a.id);
    expect(contactAttempt(a.id).step).toBe(2);
  });

  it('does not advance a stopped attempt', () => {
    const a = planned();
    transitionContactAttempt(a.id, 'stopped', { reason: 'operator' });
    expect(() => advanceContactAttemptStep(a.id))
      .toThrow(expect.objectContaining({ code: 'ATTEMPT_STOPPED' }));
    expect(contactAttempt(a.id).step).toBe(1);
  });

  /**
   * `step` and `outreach_send.sequence` count different things, and a second
   * campaign is where the difference shows: its pursuit starts at step 1 while
   * the next message is the third that coach has ever had.
   */
  it('is campaign-local, unlike the relationship-lifetime sequence', () => {
    const coach = makeCoach();
    const firstPc = makeProgramme(makeCampaign());
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: firstPc });
    for (const n of [1, 2]) {
      recordDraft({
        outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: firstPc,
        evidence: null, body: `m${n}`, subject: `s${n}`,
      });
      confirmSend(o.id);
    }
    expect(sendsForOutreach(o.id).map((s) => s.sequence)).toEqual([1, 2]);

    const secondPc = makeProgramme(makeCampaign());
    const attempt = createContactAttempt({ programmeCampaignId: secondPc, coachId: coach.id });
    expect(attempt.step).toBe(1);          // the campaign's own progression
    expect(sendsForOutreach(o.id)).toHaveLength(2);   // the relationship's history
  });

  it('encodes no tier depth or upper bound', () => {
    const a = planned();
    for (let i = 0; i < 12; i += 1) advanceContactAttemptStep(a.id);
    expect(contactAttempt(a.id).step).toBe(13);
    const src = fs.readFileSync(new URL('./contactAttempts.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bTIER_|tierForRank|MAX_STEP/);
  });
});

// ---------------------------------------------------------------------------

describe('linking to the lifetime relationship', () => {
  it('plans unlinked, then links when execution begins', () => {
    const { pc, coach } = scene();
    const a = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    expect(a.outreach_id).toBeNull();

    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    const linked = linkContactAttemptToOutreach(a.id, o.id);
    expect(linked.outreach_id).toBe(o.id);
    expect(linked.changed).toBe(true);
  });

  it('accepts a relationship supplied at creation', () => {
    const { pc, coach } = scene();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    expect(createContactAttempt({
      programmeCampaignId: pc, coachId: coach.id, outreachId: o.id,
    }).outreach_id).toBe(o.id);
  });

  it('refuses another athlete’s relationship and another coach’s', () => {
    const { pc, coach } = scene();
    const a = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });

    const theirCoach = makeCoach({ email: 'theirs@duke.edu' });
    const theirs = createOutreach({ athleteId: OTHER_ATHLETE, coachId: theirCoach.id });
    expect(() => linkContactAttemptToOutreach(a.id, theirs.id))
      .toThrow(expect.objectContaining({ code: 'OUTREACH_ATHLETE_MISMATCH' }));

    const otherCoach = makeCoach({ email: 'other@duke.edu' });
    const wrongCoach = createOutreach({ athleteId: ATHLETE, coachId: otherCoach.id });
    expect(() => linkContactAttemptToOutreach(a.id, wrongCoach.id))
      .toThrow(expect.objectContaining({ code: 'OUTREACH_COACH_MISMATCH' }));

    expect(() => linkContactAttemptToOutreach(a.id, 'nope'))
      .toThrow(expect.objectContaining({ code: 'OUTREACH_NOT_FOUND' }));
    expect(contactAttempt(a.id).outreach_id).toBeNull();
  });

  it('is a no-op when relinked to the same relationship, and refuses a different one', () => {
    const { pc, coach } = scene();
    const a = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    linkContactAttemptToOutreach(a.id, o.id);
    expect(linkContactAttemptToOutreach(a.id, o.id).changed).toBe(false);

    // Repointing would falsify which conversation the messages belong to. There
    // is no second relationship for this pair, so this is written directly.
    db.prepare(`INSERT INTO outreach (id, athlete_id, coach_id, token, created_at)
      VALUES ('o-other', ?, ?, 'tok-other', '2026-09-01T00:00:00.000Z')`)
      .run(ATHLETE, makeCoach({ email: 'another@duke.edu' }).id);
    expect(() => linkContactAttemptToOutreach(a.id, 'o-other'))
      .toThrow(expect.objectContaining({ code: 'ATTEMPT_ALREADY_LINKED' }));
  });

  /**
   * ONE RELATIONSHIP, TWO CAMPAIGNS. The relationship is reused; each campaign
   * keeps its own attempt, and A6 keeps each message pointed at the campaign
   * that actually sent it.
   */
  it('lets two campaigns execute through one relationship', () => {
    const coach = makeCoach();
    const firstPc = makeProgramme(makeCampaign());
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: firstPc });
    const a = createContactAttempt({ programmeCampaignId: firstPc, coachId: coach.id, outreachId: o.id });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: firstPc,
      evidence: null, body: 'one', subject: 'one',
    });
    confirmSend(o.id);

    const secondPc = makeProgramme(makeCampaign());
    const b = createContactAttempt({ programmeCampaignId: secondPc, coachId: coach.id, outreachId: o.id });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: secondPc,
      evidence: null, body: 'two', subject: 'two',
    });
    confirmSend(o.id);

    expect(a.outreach_id).toBe(o.id);
    expect(b.outreach_id).toBe(o.id);
    expect(attemptsForOutreach(o.id).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    // A6 still attributes each message to the campaign that sent it.
    expect(sendsForProgrammeCampaign(firstPc)).toHaveLength(1);
    expect(sendsForProgrammeCampaign(secondPc)).toHaveLength(1);
    expect(sendsForOutreach(o.id).map((s) => s.sequence)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------

describe('reads', () => {
  it('lists a programme’s attempts in a deterministic order', () => {
    const { pc } = scene();
    const made = ['a@duke.edu', 'b@duke.edu', 'c@duke.edu'].map((email, i) =>
      createContactAttempt({
        programmeCampaignId: pc, coachId: makeCoach({ email }).id,
        at: `2026-09-0${i + 1}T00:00:00.000Z`,
      }));
    expect(attemptsForProgrammeCampaign(pc).map((a) => a.id)).toEqual(made.map((a) => a.id));
  });

  it('finds one coach’s attempt and returns null for a coach with none', () => {
    const { pc, coach } = scene();
    const a = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    expect(attemptForCoach(pc, coach.id).id).toBe(a.id);
    expect(attemptForCoach(pc, makeCoach({ email: 'none@duke.edu' }).id)).toBeNull();
    expect(contactAttempt('nope')).toBeNull();
  });

  it('lists a campaign’s attempts in snapshot rank order', () => {
    const campaign = makeCampaign();
    const duke = makeProgramme(campaign, { college: 'Duke', rank: 5 });
    const elon = makeProgramme(campaign, { college: 'Elon', rank: 1 });
    createContactAttempt({ programmeCampaignId: duke, coachId: makeCoach({ school: 'Duke' }).id });
    createContactAttempt({ programmeCampaignId: elon, coachId: makeCoach({ school: 'Elon' }).id });

    expect(attemptsForCampaign(campaign).map((a) => [a.rank, a.college_name]))
      .toEqual([[1, 'Elon'], [5, 'Duke']]);
  });

  it('leaks nothing across campaigns or athletes', () => {
    const mine = makeProgramme(makeCampaign());
    const theirs = makeProgramme(makeCampaign({ athleteId: OTHER_ATHLETE }));
    const coach = makeCoach();
    createContactAttempt({ programmeCampaignId: mine, coachId: coach.id });
    createContactAttempt({ programmeCampaignId: theirs, coachId: coach.id });

    expect(attemptsForProgrammeCampaign(mine)).toHaveLength(1);
    expect(attemptsForProgrammeCampaign(theirs)).toHaveLength(1);
    expect(attemptForCoach(mine, coach.id).id).not.toBe(attemptForCoach(theirs, coach.id).id);
  });
});

// ---------------------------------------------------------------------------

describe('deletes', () => {
  function world() {
    const { campaign, pc, coach } = scene();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    const a = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id, outreachId: o.id });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc,
      evidence: null, body: 'b', subject: 's',
    });
    confirmSend(o.id, '2026-09-10T00:00:00.000Z');
    return { campaign, pc, coach, o, a };
  }

  it('takes attempts with the campaign, and leaves outreach and sends standing', () => {
    const { campaign, o } = world();
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign);

    expect(db.prepare('SELECT COUNT(*) n FROM programme_contact_attempts').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_campaigns').get().n).toBe(0);
    // A6's semantics, preserved: the relationship, its token and its send
    // history survive with attribution set null.
    const outreach = db.prepare('SELECT * FROM outreach WHERE id = ?').get(o.id);
    expect(outreach.token).toBe(o.token);
    expect(outreach.programme_campaign_id).toBeNull();
    const send = sendsForOutreach(o.id)[0];
    expect(send.sent_at).toBe('2026-09-10T00:00:00.000Z');
    expect(send.programme_campaign_id).toBeNull();
    expect(resolveToken(o.token).id).toBe(o.id);
  });

  it('takes attempts with the programme campaign alone', () => {
    const { pc, o } = world();
    db.prepare('DELETE FROM programme_campaigns WHERE id = ?').run(pc);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_contact_attempts').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(1);
    expect(sendsForOutreach(o.id)).toHaveLength(1);
  });

  it('destroys nothing when the attempt itself is deleted', () => {
    const { a, o } = world();
    db.prepare('DELETE FROM programme_contact_attempts WHERE id = ?').run(a.id);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(1);
    expect(sendsForOutreach(o.id)).toHaveLength(1);
    expect(resolveToken(o.token).id).toBe(o.id);
  });

  it('refuses to delete an outreach or a coach an attempt is standing on', () => {
    const { o, coach } = world();
    expect(() => db.prepare('DELETE FROM outreach WHERE id = ?').run(o.id))
      .toThrow(/FOREIGN KEY constraint failed/);
    expect(() => db.prepare('DELETE FROM coaches WHERE id = ?').run(coach.id))
      .toThrow(/FOREIGN KEY constraint failed/);
  });
});

// ---------------------------------------------------------------------------

describe('nothing else moved', () => {
  it('leaves B3 the only contact gate, and B4 adds none', () => {
    const src = fs.readFileSync(new URL('./contactAttempts.js', import.meta.url), 'utf8');
    // Planning must work before a campaign is active, so this module must not
    // import the gate at all.
    expect(src).not.toContain('campaignContactDecision');
    expect(src).not.toContain('assertCampaignContactAllowed');
    expect(src).not.toContain('authorisedProgrammeCampaignId');
  });

  it('changes no programme campaign state', () => {
    const { pc, coach } = scene();
    const before = db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc);
    const a = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    transitionContactAttempt(a.id, 'active');
    advanceContactAttemptStep(a.id);
    // B1 proposed a programme becomes active on its first accepted message.
    // B4 deliberately does not decide that: there is no execution policy yet.
    expect(db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc)).toEqual(before);
  });

  it('leaves suppression, the per-inbox cap and the token untouched', () => {
    const { pc, coach } = scene({ coach: { email: 'popular@duke.edu' } });
    createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    suppress({ email: 'popular@duke.edu' });
    expect(isSuppressed('popular@duke.edu')).toBe(true);
    // Planning an attempt is not a send and consumes nothing.
    expect(recentSendCount('popular@duke.edu')).toBe(0);
    const cols = db.prepare('PRAGMA table_info(suppressions)').all().map((c) => c.name);
    expect(cols).not.toContain('programme_contact_attempt_id');
  });

  /**
   * B2 enforces one open message per lifetime relationship. A1 enforces one
   * active campaign per athlete, and an attempt is campaign-specific — so at
   * most one campaign can be executing through a relationship at a time, and
   * the B2 constraint stays correct. It is not loosened here.
   */
  it('leaves one-open-message-per-relationship in place', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()
      .map((r) => r.name);
    expect(names).toContain('idx_outreach_send_one_open');
  });

  it('adds no counter and no analytics column', () => {
    const cols = db.prepare('PRAGMA table_info(programme_contact_attempts)').all().map((c) => c.name);
    for (const forbidden of ['sent_count', 'reply_count', 'message_count', 'last_sent_at',
      'engagement_score', 'tier']) {
      expect(cols).not.toContain(forbidden);
    }
  });
});
