import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  usedEvidenceForCoaches, EVIDENCE_USE,
  sentEvidenceForContact, openDraftEvidenceForContact, campaignLocalStep,
} from './evidenceHistory.js';
import { identityOf } from '../../shared/evidence/sequenceStrategy.js';
import { createOutreach, revokeOutreach } from './outreach.js';
import { recordDraft, confirmSend, transitionSend } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { MESSAGE_STATE, ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';
import { OUTREACH_ORIGIN } from '../../shared/outreachOrigin.js';

/**
 * F9e — WHAT THESE COACHES HAVE ALREADY BEEN PUT.
 *
 * ===========================================================================
 * THREE PROPERTIES.
 *
 *   LIFETIME, PER COACH, ORIGIN-BLIND. A coach's inbox does not care which
 *   part of the product wrote to it, and manual outreach has no campaign cycle
 *   to scope to. A different coach at the same programme starts clean.
 *
 *   ONLY AN ACCEPTED MESSAGE COUNTS AS CONFIRMED. A draft, a cancelled
 *   message, a failed one and an unknown provider result each reached nobody
 *   we can name, and marking a claim used on the strength of one would take
 *   away the only true thing an operator had to say.
 *
 *   CAMPAIGN IS UNTOUCHED. This is a sibling query, not a widening: the three
 *   campaign-scoped helpers beside it answer exactly as they did.
 * ===========================================================================
 */

const ATHLETE = 'a-hist';
const OTHER_ATHLETE = 'a-hist-2';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let seq = 0;

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'DEFENSE', 'mens-soccer', ?)
  `).run(id, name, randomUUID().slice(0, 10));
}

function makeCampaign(athleteId = ATHLETE) {
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)
  `).run(id, athleteId);
  return id;
}

function makeProgramme(campaignId, college = COLLEGE) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(id, campaignId, college, SPORT, ++seq);
  return id;
}

const makeCoach = (email = `c${++seq}@duke.edu`, school = COLLEGE) => findOrCreateCoach({
  full_name: 'A Coach', email, school, sport: SPORT, division: 'NCAA D1',
  position_title: 'Head Coach',
});

/**
 * A real message through the real path.
 *
 * `recordDraft` derives `rendered_kinds` from the composition it is handed, so
 * the fixture supplies a composition rather than writing the column directly —
 * that column is the thing under test, and writing it by hand would prove only
 * that the test agrees with itself.
 */
function writeMessage({
  athleteId = ATHLETE, coach, kinds, programmeCampaignId = null,
  origin = OUTREACH_ORIGIN.MANUAL, accept = true, at = '2026-09-07T09:00:00.000Z',
} = {}) {
  const o = createOutreach({ athleteId, coachId: coach.id, programmeCampaignId });
  const { id: sendId } = recordDraft({
    outreachId: o.id, athleteId, coachId: coach.id,
    collegeName: COLLEGE, sport: SPORT, programmeCampaignId, origin,
    evidence: {
      composition: {
        sentences: kinds.map((kind, i) => ({
          order: i, slot: i === 0 ? 'HOOK' : 'RELEVANCE', kind, text: `sentence for ${kind}`,
        })),
        placement: [],
      },
    },
    body: `b${++seq}`, subject: 's', at,
  });
  if (accept) confirmSend(o.id, at, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return { outreach: o, sendId };
}

const kinds = (entries) => entries.map((e) => e.kind);

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM players; DELETE FROM athlete_programmes;`);
  insertAthlete(ATHLETE, 'History Athlete');
  insertAthlete(OTHER_ATHLETE, 'Other Athlete');
  seq = 0;
});

/* ========================================================================== */
/*  WHAT COUNTS                                                               */
/* ========================================================================== */

describe('what counts as something a coach was told', () => {
  it('finds the evidence an accepted MANUAL message rendered', () => {
    const coach = makeCoach();
    writeMessage({ coach, kinds: ['CURRENT_SAME_COUNTRY', 'POSITION_GRADUATION'] });

    const { confirmed, open } = usedEvidenceForCoaches({
      athleteId: ATHLETE, coachIds: [coach.id],
    });
    expect(kinds(confirmed)).toEqual(['CURRENT_SAME_COUNTRY', 'POSITION_GRADUATION']);
    expect(open).toEqual([]);
  });

  /**
   * THE CROSS-MODE READ. Manual composition sees campaign history because the
   * coach read it either way. Campaign is not changed in return — see the
   * asymmetry assertions at the foot of this file.
   */
  it('finds the evidence an accepted CAMPAIGN message rendered', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    writeMessage({
      coach, kinds: ['ACADEMIC_FIT'], programmeCampaignId: pc, origin: OUTREACH_ORIGIN.CAMPAIGN,
    });

    const { confirmed } = usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [coach.id] });
    expect(kinds(confirmed)).toEqual(['ACADEMIC_FIT']);
  });

  it('retains the origin honestly, including where it was never recorded', () => {
    const pc = makeProgramme(makeCampaign());
    const manualCoach = makeCoach();
    const campaignCoach = makeCoach();
    const legacyCoach = makeCoach();
    writeMessage({ coach: manualCoach, kinds: ['ACADEMIC_FIT'] });
    writeMessage({
      coach: campaignCoach, kinds: ['ACADEMIC_FIT'],
      programmeCampaignId: pc, origin: OUTREACH_ORIGIN.CAMPAIGN,
    });
    writeMessage({ coach: legacyCoach, kinds: ['ACADEMIC_FIT'], origin: null });

    const origins = (coach) => usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [coach.id] })
      .confirmed.map((e) => e.origin);
    expect(origins(manualCoach)).toEqual(['manual']);
    expect(origins(campaignCoach)).toEqual(['campaign']);
    // Never guessed. A message written before the column existed says so.
    expect(origins(legacyCoach)).toEqual([null]);
  });

  it('does not count a draft nobody confirmed, and reports it as what it is', () => {
    const coach = makeCoach();
    writeMessage({ coach, kinds: ['ACADEMIC_FIT'], accept: false });

    const { confirmed, open } = usedEvidenceForCoaches({
      athleteId: ATHLETE, coachIds: [coach.id],
    });
    expect(confirmed).toEqual([]);
    expect(kinds(open)).toEqual(['ACADEMIC_FIT']);
    expect(open[0].source).toBe(EVIDENCE_USE.OPEN);
  });

  it('never calls a QUEUED or SENDING message confirmed', () => {
    for (const state of [MESSAGE_STATE.QUEUED, MESSAGE_STATE.SENDING]) {
      db.exec('DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM coaches;');
      const coach = makeCoach();
      const { sendId } = writeMessage({ coach, kinds: ['ACADEMIC_FIT'], accept: false });
      if (state === MESSAGE_STATE.SENDING) transitionSend(sendId, MESSAGE_STATE.QUEUED);
      transitionSend(sendId, state);

      const { confirmed, open } = usedEvidenceForCoaches({
        athleteId: ATHLETE, coachIds: [coach.id],
      });
      expect(confirmed, state).toEqual([]);
      expect(kinds(open), state).toEqual(['ACADEMIC_FIT']);
    }
  });

  it('excludes a cancelled message entirely', () => {
    const coach = makeCoach();
    const { sendId } = writeMessage({ coach, kinds: ['ACADEMIC_FIT'], accept: false });
    transitionSend(sendId, MESSAGE_STATE.CANCELLED);

    const { confirmed, open } = usedEvidenceForCoaches({
      athleteId: ATHLETE, coachIds: [coach.id],
    });
    // Withdrawn before it went anywhere. The angle is free again.
    expect(confirmed).toEqual([]);
    expect(open).toEqual([]);
  });

  it('excludes a failed message entirely', () => {
    const coach = makeCoach();
    const { sendId } = writeMessage({ coach, kinds: ['ACADEMIC_FIT'], accept: false });
    transitionSend(sendId, MESSAGE_STATE.QUEUED);
    transitionSend(sendId, MESSAGE_STATE.SENDING);
    transitionSend(sendId, MESSAGE_STATE.FAILED);

    const { confirmed, open } = usedEvidenceForCoaches({
      athleteId: ATHLETE, coachIds: [coach.id],
    });
    expect(confirmed).toEqual([]);
    expect(open).toEqual([]);
  });

  /**
   * THE UNCOMFORTABLE ONE, AND THE CHOICE IS DELIBERATE. It may have gone; the
   * state exists precisely because nobody knows. Calling it confirmed would
   * assert a send nobody observed, and under-marking is the error this feature
   * can survive.
   */
  it('does not treat an unknown provider result as confirmed', () => {
    const coach = makeCoach();
    const { sendId } = writeMessage({ coach, kinds: ['ACADEMIC_FIT'], accept: false });
    transitionSend(sendId, MESSAGE_STATE.QUEUED);
    transitionSend(sendId, MESSAGE_STATE.SENDING);
    transitionSend(sendId, MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);

    const { confirmed, open } = usedEvidenceForCoaches({
      athleteId: ATHLETE, coachIds: [coach.id],
    });
    expect(confirmed).toEqual([]);
    expect(open).toEqual([]);
  });

  /**
   * REVOCATION KILLS THE LINK, NOT THE HISTORY. The tracking token stops
   * resolving; the coach still read the email.
   */
  it('still counts an accepted message on a revoked relationship', () => {
    const coach = makeCoach();
    const { outreach } = writeMessage({ coach, kinds: ['CURRENT_SAME_COUNTRY'] });
    revokeOutreach(outreach.id);

    const { confirmed } = usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [coach.id] });
    expect(kinds(confirmed)).toEqual(['CURRENT_SAME_COUNTRY']);
  });
});

/* ========================================================================== */
/*  IDENTITY AND ISOLATION                                                    */
/* ========================================================================== */

describe('whose history this is', () => {
  it('never lets one athlete see another athlete’s history', () => {
    const coach = makeCoach();
    writeMessage({ athleteId: OTHER_ATHLETE, coach, kinds: ['ACADEMIC_FIT'] });

    expect(usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [coach.id] }).confirmed)
      .toEqual([]);
    expect(kinds(usedEvidenceForCoaches({
      athleteId: OTHER_ATHLETE, coachIds: [coach.id],
    }).confirmed)).toEqual(['ACADEMIC_FIT']);
  });

  /**
   * THE CASE THE WHOLE SCOPE DECISION TURNS ON. A first email to an assistant
   * must not lose the strongest angle because the head coach heard it — we do
   * not observe forwarding, and assuming it would strip a stranger's first
   * message on a guess about somebody else's inbox habits.
   */
  it('starts a different coach at the same programme clean', () => {
    const head = makeCoach('head@duke.edu');
    const assistant = makeCoach('assistant@duke.edu');
    writeMessage({ coach: head, kinds: ['CURRENT_SAME_COUNTRY'] });

    expect(usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [assistant.id] }).confirmed)
      .toEqual([]);
  });

  /**
   * SCOPED ON `coach_id`, WHICH IS WHY A CORRECTED TYPO DOES NOT ERASE A
   * CONVERSATION. `programme_messages` freezes an address beside the id for
   * exactly this reason: the row is mutable and the identity is not.
   */
  it('survives the coach changing email address', () => {
    const coach = makeCoach('old@duke.edu');
    writeMessage({ coach, kinds: ['ACADEMIC_FIT'] });
    db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('new@duke.edu', coach.id);

    expect(kinds(usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [coach.id] }).confirmed))
      .toEqual(['ACADEMIC_FIT']);
  });

  it('unions across the selected coaches, naming which one each entry came from', () => {
    const head = makeCoach('head@duke.edu');
    const assistant = makeCoach('assistant@duke.edu');
    writeMessage({ coach: head, kinds: ['CURRENT_SAME_COUNTRY'] });
    writeMessage({ coach: assistant, kinds: ['ACADEMIC_FIT'] });

    const { confirmed } = usedEvidenceForCoaches({
      athleteId: ATHLETE, coachIds: [head.id, assistant.id],
    });
    expect(kinds(confirmed).sort()).toEqual(['ACADEMIC_FIT', 'CURRENT_SAME_COUNTRY']);
    expect(confirmed.find((e) => e.kind === 'CURRENT_SAME_COUNTRY').coachId).toBe(head.id);
    expect(confirmed.find((e) => e.kind === 'ACADEMIC_FIT').coachId).toBe(assistant.id);
  });

  it('asks nothing and invents nothing for an unknown coach id', () => {
    expect(usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: ['no-such-coach'] }))
      .toEqual({ confirmed: [], open: [] });
  });

  it('returns nothing for an empty or missing coach list', () => {
    expect(usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [] }))
      .toEqual({ confirmed: [], open: [] });
    expect(usedEvidenceForCoaches({ athleteId: ATHLETE }))
      .toEqual({ confirmed: [], open: [] });
    expect(usedEvidenceForCoaches({ coachIds: ['x'] }))
      .toEqual({ confirmed: [], open: [] });
  });

  it('asks once per coach however often an id is repeated', () => {
    const coach = makeCoach();
    writeMessage({ coach, kinds: ['ACADEMIC_FIT'] });

    const { confirmed } = usedEvidenceForCoaches({
      athleteId: ATHLETE, coachIds: [coach.id, coach.id, coach.id],
    });
    expect(kinds(confirmed)).toEqual(['ACADEMIC_FIT']);
  });
});

/* ========================================================================== */
/*  EVIDENCE IDENTITY                                                         */
/* ========================================================================== */

describe('the identity a claim is remembered by', () => {
  /**
   * THE REGISTRY'S OWN ANSWER, NOT A SECOND MAPPING. Two kinds in one dedupe
   * group are one connection as far as a coach is concerned, and the marker
   * has to see that or it is no marker at all.
   */
  it('carries the existing dedupeGroup rather than a new one', () => {
    const coach = makeCoach();
    writeMessage({ coach, kinds: ['CURRENT_SAME_COUNTRY'] });

    const { confirmed } = usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [coach.id] });
    expect(confirmed[0].group).toBe(identityOf('CURRENT_SAME_COUNTRY'));
    expect(confirmed[0].group).toBeTruthy();
    // And the sibling kind shares it, which is the point of using the group.
    expect(identityOf('HISTORICAL_SAME_COUNTRY')).toBe(confirmed[0].group);
  });

  it('keeps an unrecognised kind rather than dropping or guessing it', () => {
    const coach = makeCoach();
    writeMessage({ coach, kinds: ['SOME_RETIRED_KIND'] });

    const { confirmed } = usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [coach.id] });
    expect(kinds(confirmed)).toEqual(['SOME_RETIRED_KIND']);
    expect(confirmed[0].group).toBeNull();
  });
});

/* ========================================================================== */
/*  WHAT MUST NOT HAVE MOVED                                                  */
/* ========================================================================== */

describe('nothing else changed', () => {
  it('writes nothing — no message, relationship or stance row moves', () => {
    const coach = makeCoach();
    writeMessage({ coach, kinds: ['ACADEMIC_FIT'] });
    const snapshot = () => JSON.stringify({
      sends: db.prepare('SELECT * FROM outreach_send ORDER BY id').all(),
      outreach: db.prepare('SELECT * FROM outreach ORDER BY id').all(),
      programmes: db.prepare('SELECT * FROM athlete_programmes ORDER BY id').all(),
      coaches: db.prepare('SELECT * FROM coaches ORDER BY id').all(),
    });
    const before = snapshot();

    usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [coach.id] });

    expect(snapshot()).toBe(before);
  });

  /**
   * CONTACT POLICY IS NOT SEQUENCE MEMORY. `contact_stance` answers whether a
   * campaign may write; this answers what has been said. Different tables,
   * different owners, and this query cannot reach the first.
   */
  it('leaves athlete_programmes completely alone', () => {
    const coach = makeCoach();
    db.prepare(`
      INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
        flagged, visibility, contact_stance, created_at, updated_at)
      VALUES ('ap-1', ?, ?, ?, 'requested', 0, 'default', 'default', 'x', 'x')
    `).run(ATHLETE, COLLEGE, SPORT);
    writeMessage({ coach, kinds: ['ACADEMIC_FIT'] });
    const before = db.prepare('SELECT * FROM athlete_programmes').all();

    usedEvidenceForCoaches({ athleteId: ATHLETE, coachIds: [coach.id] });

    expect(db.prepare('SELECT * FROM athlete_programmes').all()).toEqual(before);
  });

  /**
   * THE CAMPAIGN HELPERS ARE SIBLINGS, NOT ANCESTORS. A manual message with no
   * campaign attribution is invisible to every one of them, exactly as before:
   * `SCOPE` requires a campaign id and SQL equality against NULL is never true.
   */
  it('leaves the campaign-scoped helpers answering exactly as they did', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    // One campaign message and one manual message, same athlete, same coach.
    writeMessage({
      coach, kinds: ['ACADEMIC_FIT'], programmeCampaignId: pc,
      origin: OUTREACH_ORIGIN.CAMPAIGN, at: '2026-09-01T00:00:00.000Z',
    });
    const other = makeCoach('second@duke.edu');
    writeMessage({ coach: other, kinds: ['CURRENT_SAME_COUNTRY'] });

    const campaignArgs = { programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id };
    expect(sentEvidenceForContact(campaignArgs)).toEqual(['ACADEMIC_FIT']);
    expect(openDraftEvidenceForContact(campaignArgs)).toEqual([]);
    expect(campaignLocalStep(campaignArgs)).toBe(2);

    // The manual coach is invisible to the campaign scope, in both directions.
    const manualInCampaignScope = {
      programmeCampaignId: pc, athleteId: ATHLETE, coachId: other.id,
    };
    expect(sentEvidenceForContact(manualInCampaignScope)).toEqual([]);
    expect(campaignLocalStep(manualInCampaignScope)).toBe(1);

    // And the lifetime query sees both, which is the asymmetry F9d chose.
    const { confirmed } = usedEvidenceForCoaches({
      athleteId: ATHLETE, coachIds: [coach.id, other.id],
    });
    expect(kinds(confirmed).sort()).toEqual(['ACADEMIC_FIT', 'CURRENT_SAME_COUNTRY']);
  });
});
