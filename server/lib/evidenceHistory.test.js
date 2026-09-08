import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import { sentEvidenceForContact, openDraftEvidenceForContact } from './evidenceHistory.js';
import {
  evidenceStrategyForMessage, EVIDENCE_SEQUENCE_POLICY_VERSION, SEQUENCE_STATUS,
  SEQUENCE_REASON, MAX_FOLLOW_UP_EVIDENCE, MAX_SEQUENCE_STEP, identityOf,
} from '../../shared/evidence/sequenceStrategy.js';
import { ROLES, outreachEvidenceFor, applyPrefer } from '../../shared/evidence/outreachEvidence.js';
import { createOutreach } from './outreach.js';
import { recordDraft, confirmSend, transitionSend, openSendFor, sendsForOutreach } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { MESSAGE_STATE, ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * C2 — what the next message may say, given what the last one already said.
 *
 * The three properties that carry the slice:
 *
 *   1. IT NARROWS, NEVER WIDENS. A denied kind cannot become available because
 *      a permitted one was excluded, and there is nothing here that could make
 *      it — the strategy only ever reads a finished licence decision.
 *   2. STEP 1 IS PRODUCTION, UNTOUCHED. It returns null rather than a list, so
 *      an initial email is composed by exactly the code that composes it today.
 *   3. HISTORY IS CAMPAIGN-LOCAL AND PER-COACH. A season-old campaign, another
 *      coach at the same programme, and an unsent draft each say nothing about
 *      what THIS coach has read.
 */

const ATHLETE = 'a-seq';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let seq = 0;

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'DEFENSE', 'mens-soccer', ?)
  `).run(id, name, randomUUID().slice(0, 10));
}

function makeCampaign() {
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = 'x', close_reason = 'completed'
    WHERE athlete_id = ? AND state = 'active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)
  `).run(id, ATHLETE);
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
 * A real message, written through the real path, whose rendered kinds are the
 * ones named.
 *
 * `recordDraft` derives `rendered_kinds` from the composition it is given, so
 * the fixture supplies a composition rather than writing the column by hand —
 * the column is what the strategy reads, and a hand-written one would prove
 * only that the test agrees with itself.
 */
function writeMessage(pc, coach, kinds, { accept = true, at = '2026-09-07T09:00:00.000Z' } = {}) {
  const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId: coach.id,
    collegeName: COLLEGE, sport: SPORT, programmeCampaignId: pc,
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
  return o;
}

/** A minimal outreachEvidenceFor-shaped result, for the pure strategy tests. */
const item = (kind, role) => ({ kind, role, facts: {} });
const surface = ({ hooks = [], relevance = [], recognition = [], alternatives = [] } = {}) => ({
  hooks, relevance, recognition, alternatives, dispositions: [], hasPersonalisation: true,
});

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE, 'Sequence Athlete');
  seq = 0;
});

// ---------------------------------------------------------------------------

describe('what this coach has already been told', () => {
  it('finds the evidence an accepted campaign message rendered', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    writeMessage(pc, coach, ['CURRENT_SAME_COUNTRY', 'POSITION_GRADUATION']);

    expect(sentEvidenceForContact({ programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id }))
      .toEqual(['CURRENT_SAME_COUNTRY', 'POSITION_GRADUATION']);
  });

  it('does not count a draft nobody sent', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    writeMessage(pc, coach, ['ACADEMIC_FIT'], { accept: false });

    const args = { programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id };
    // A body in a window has reached nobody.
    expect(sentEvidenceForContact(args)).toEqual([]);
    // And it is visible as what it is, through the other question.
    expect(openDraftEvidenceForContact(args)).toEqual(['ACADEMIC_FIT']);
  });

  it('does not count a cancelled message', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    const o = writeMessage(pc, coach, ['ACADEMIC_FIT'], { accept: false });
    transitionSend(openSendFor(o.id).id, MESSAGE_STATE.CANCELLED);

    const args = { programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id };
    expect(sendsForOutreach(o.id)[0].state).toBe(MESSAGE_STATE.CANCELLED);
    expect(sentEvidenceForContact(args)).toEqual([]);
    // Cancelled is terminal, so it is not open either. It is simply gone.
    expect(openDraftEvidenceForContact(args)).toEqual([]);
  });

  it('ignores another campaign entirely', () => {
    const coach = makeCoach();
    const first = makeProgramme(makeCampaign());
    writeMessage(first, coach, ['CURRENT_SAME_COUNTRY']);
    const second = makeProgramme(makeCampaign());

    // A new recruiting cycle may put the same reason to the same coach.
    expect(sentEvidenceForContact({
      programmeCampaignId: second, athleteId: ATHLETE, coachId: coach.id,
    })).toEqual([]);
    expect(sentEvidenceForContact({
      programmeCampaignId: first, athleteId: ATHLETE, coachId: coach.id,
    })).toEqual(['CURRENT_SAME_COUNTRY']);
  });

  it('ignores another coach at the same programme', () => {
    const pc = makeProgramme(makeCampaign());
    const head = makeCoach('head@duke.edu');
    const assistant = makeCoach('asst@duke.edu');
    writeMessage(pc, head, ['CURRENT_SAME_COUNTRY']);

    // We do not observe forwarding, and assuming it would strip the strongest
    // reason from the assistant's first email on a guess about an inbox.
    expect(sentEvidenceForContact({
      programmeCampaignId: pc, athleteId: ATHLETE, coachId: assistant.id,
    })).toEqual([]);
  });

  it('cannot see a message that belongs to no campaign', () => {
    // The 41 historical sends carry NULL on both columns. SQL equality against
    // NULL is never true, so they are invisible here without a clause of their
    // own — which is right: they were sent under no campaign, and A6 forbids
    // guessing one for them.
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: COLLEGE, sport: SPORT,
      evidence: { composition: { sentences: [{ order: 0, slot: 'HOOK', kind: 'ACADEMIC_FIT', text: 't' }], placement: [] } },
      body: 'b', subject: 's',
    });
    confirmSend(o.id, undefined, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });

    expect(db.prepare('SELECT rendered_kinds FROM outreach_send').get().rendered_kinds)
      .toBe('ACADEMIC_FIT');
    expect(sentEvidenceForContact({ programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id }))
      .toEqual([]);
  });

  it('reads what was RENDERED, not what was selected', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: COLLEGE, sport: SPORT,
      programmeCampaignId: pc,
      evidence: {
        composition: {
          sentences: [
            { order: 0, slot: 'HOOK', kind: 'CURRENT_SAME_COUNTRY', text: 'a' },
            { order: 1, slot: 'RELEVANCE', kind: 'POSITION_GRADUATION', text: 'b' },
          ],
          placement: [],
        },
      },
      // The operator deleted the second paragraph before sending.
      renderedKinds: new Set(['CURRENT_SAME_COUNTRY']),
      body: 'b', subject: 's',
    });
    confirmSend(o.id, undefined, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });

    // A claim the coach never read must not be retired.
    expect(sentEvidenceForContact({ programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id }))
      .toEqual(['CURRENT_SAME_COUNTRY']);
  });
});

// ---------------------------------------------------------------------------

describe('evidence identity', () => {
  it('is the dedupe group, so one connection is remembered once', () => {
    // Six pathway kinds, one connection. "You have a New Zealander now" and
    // "you've had New Zealanders before" are the same thing said twice.
    for (const kind of ['CURRENT_SAME_COUNTRY', 'HISTORICAL_SAME_COUNTRY',
      'COACH_ARRIVAL_SAME_COUNTRY', 'ARRIVAL_SAME_COUNTRY_POSITION',
      'ARRIVAL_SAME_REGION_POSITION']) {
      expect(identityOf(kind)).toBe('international-connection');
    }
    expect(identityOf('POSITION_GRADUATION')).toBe('position-opportunity');
    expect(identityOf('ACADEMIC_FIT')).toBe('academic');
    expect(identityOf('CONFERENCE_TITLE')).toBe('programme-success');
  });

  it('does not depend on wording', () => {
    // Identity comes from the registry, never from rendered English. A copy
    // revision cannot make a used reason look unused.
    const src = fs.readFileSync(new URL('../../shared/evidence/sequenceStrategy.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.text\b|sentences|body_hash|includes\(.*text/);
    expect(code).toMatch(/dedupeGroup/);
  });

  it('is deterministic', () => {
    const args = {
      outreach: surface({ hooks: [item('CURRENT_SAME_COUNTRY', ROLES.HOOK)] }),
      step: 2, previouslySentKinds: ['ACADEMIC_FIT'],
    };
    const first = evidenceStrategyForMessage(args);
    for (let i = 0; i < 3; i += 1) expect(evidenceStrategyForMessage(args)).toEqual(first);
  });
});

// ---------------------------------------------------------------------------

describe('the initial message', () => {
  it('has no opinion, so production composes it exactly as it does today', () => {
    const out = evidenceStrategyForMessage({
      outreach: surface({
        hooks: [item('CURRENT_SAME_COUNTRY', ROLES.HOOK)],
        relevance: [item('POSITION_GRADUATION', ROLES.RELEVANCE)],
      }),
      step: 1,
    });

    expect(out.status).toBe(SEQUENCE_STATUS.INITIAL);
    /**
     * NULL, not a list. A prefer list would make the result operator-selected,
     * rewrite its dispositions and set `operator_selected` in the stored
     * payload — visibly equivalent, materially different.
     */
    expect(out.preferredForThisMessage).toBeNull();
    expect(out.notPreferred).toEqual([]);
    expect(out.reasons).toEqual([{ code: SEQUENCE_REASON.FIRST_MESSAGE, detail: null }]);
  });

  it('ignores an older campaign history even if it is handed some', () => {
    const out = evidenceStrategyForMessage({
      outreach: surface({ hooks: [item('CURRENT_SAME_COUNTRY', ROLES.HOOK)] }),
      step: 1,
      previouslySentKinds: ['CURRENT_SAME_COUNTRY'],
    });
    expect(out.preferredForThisMessage).toBeNull();
    expect(out.previouslyUsed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('the follow-up', () => {
  const bothAngles = surface({
    hooks: [item('CURRENT_SAME_COUNTRY', ROLES.HOOK)],
    relevance: [item('POSITION_GRADUATION', ROLES.RELEVANCE), item('ACADEMIC_FIT', ROLES.RELEVANCE)],
  });

  it('drops what the initial message already said', () => {
    const out = evidenceStrategyForMessage({
      outreach: bothAngles, step: 2, previouslySentKinds: ['CURRENT_SAME_COUNTRY'],
    });

    expect(out.status).toBe(SEQUENCE_STATUS.NEW_EVIDENCE);
    expect(out.preferredForThisMessage).toEqual(['POSITION_GRADUATION']);
    expect(out.notPreferred).toContainEqual(expect.objectContaining({
      kind: 'CURRENT_SAME_COUNTRY', reason: SEQUENCE_REASON.PREVIOUSLY_SENT,
    }));
  });

  it('drops a different wording of the same connection', () => {
    // The initial message said "you have a New Zealander now"; the follow-up
    // may not say "you've had New Zealanders before" and call it a new reason.
    const out = evidenceStrategyForMessage({
      outreach: surface({
        hooks: [item('HISTORICAL_SAME_COUNTRY', ROLES.HOOK)],
        relevance: [item('ACADEMIC_FIT', ROLES.RELEVANCE)],
      }),
      step: 2, previouslySentKinds: ['CURRENT_SAME_COUNTRY'],
    });

    expect(out.preferredForThisMessage).toEqual(['ACADEMIC_FIT']);
    const held = out.notPreferred.find((n) => n.kind === 'HISTORICAL_SAME_COUNTRY');
    expect(held.reason).toBe(SEQUENCE_REASON.PREVIOUSLY_SENT);
    expect(held.detail).toMatch(/the same connection as .*, which this campaign has already sent/);
  });

  it('carries one body claim, and names the rest as over the cap', () => {
    const out = evidenceStrategyForMessage({ outreach: bothAngles, step: 2 });

    expect(MAX_FOLLOW_UP_EVIDENCE).toBe(1);
    expect(out.preferredForThisMessage).toEqual(['CURRENT_SAME_COUNTRY']);
    for (const kind of ['POSITION_GRADUATION', 'ACADEMIC_FIT']) {
      expect(out.notPreferred).toContainEqual(expect.objectContaining({
        kind, reason: SEQUENCE_REASON.OVER_FOLLOW_UP_CAP,
      }));
    }
  });

  it('says NO_NEW_EVIDENCE rather than repeating itself', () => {
    const out = evidenceStrategyForMessage({
      outreach: bothAngles, step: 2,
      previouslySentKinds: ['CURRENT_SAME_COUNTRY', 'POSITION_GRADUATION', 'ACADEMIC_FIT'],
    });

    expect(out.status).toBe(SEQUENCE_STATUS.NO_NEW_EVIDENCE);
    /** An empty ARRAY, unlike step 1's null: an opinion, and the opinion is none. */
    expect(out.preferredForThisMessage).toEqual([]);
    expect(out.notPreferred.every((n) => n.reason === SEQUENCE_REASON.PREVIOUSLY_SENT)).toBe(true);
  });

  it('has no fallback that repeats an initial claim', () => {
    const src = fs.readFileSync(new URL('../../shared/evidence/sequenceStrategy.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Whether a follow-up should recall the first message is a COPY decision,
    // and answering it here would dress it as an evidence one.
    expect(code).not.toMatch(/fallback|REPEAT|reuse/i);
  });

  it('lets an unused academic fit carry the follow-up', () => {
    const out = evidenceStrategyForMessage({
      outreach: bothAngles, step: 2,
      previouslySentKinds: ['CURRENT_SAME_COUNTRY', 'POSITION_GRADUATION'],
    });
    expect(out.preferredForThisMessage).toEqual(['ACADEMIC_FIT']);
  });

  it('lets unused position evidence carry the follow-up', () => {
    const out = evidenceStrategyForMessage({
      outreach: bothAngles, step: 2,
      previouslySentKinds: ['CURRENT_SAME_COUNTRY', 'ACADEMIC_FIT'],
    });
    expect(out.preferredForThisMessage).toEqual(['POSITION_GRADUATION']);
  });

  it('lets an unused licensed hook carry the follow-up', () => {
    const out = evidenceStrategyForMessage({
      outreach: bothAngles, step: 2,
      previouslySentKinds: ['POSITION_GRADUATION', 'ACADEMIC_FIT'],
    });
    expect(out.preferredForThisMessage).toEqual(['CURRENT_SAME_COUNTRY']);
  });
});

// ---------------------------------------------------------------------------

describe('recognition across a sequence', () => {
  it('is not a reason to write again', () => {
    // An unused congratulation on its own is not new evidence. The licence
    // layer already excludes recognition from `hasPersonalisation`; this is
    // that same rule across messages.
    const out = evidenceStrategyForMessage({
      outreach: surface({
        relevance: [item('ACADEMIC_FIT', ROLES.RELEVANCE)],
        recognition: [item('CONFERENCE_TITLE', ROLES.RECOGNITION)],
      }),
      step: 2, previouslySentKinds: ['ACADEMIC_FIT'],
    });

    expect(out.status).toBe(SEQUENCE_STATUS.NO_NEW_EVIDENCE);
    expect(out.preferredForThisMessage).toEqual([]);
    expect(out.notPreferred).toContainEqual(expect.objectContaining({
      kind: 'CONFERENCE_TITLE', reason: SEQUENCE_REASON.RECOGNITION_NOT_A_REASON,
    }));
  });

  it('is not repeated when the initial message already used it', () => {
    const out = evidenceStrategyForMessage({
      outreach: surface({
        relevance: [item('ACADEMIC_FIT', ROLES.RELEVANCE)],
        recognition: [item('CONFERENCE_TITLE', ROLES.RECOGNITION)],
      }),
      step: 2, previouslySentKinds: ['CONFERENCE_TITLE'],
    });

    expect(out.preferredForThisMessage).toEqual(['ACADEMIC_FIT']);
    expect(out.notPreferred).toContainEqual(expect.objectContaining({
      kind: 'CONFERENCE_TITLE', reason: SEQUENCE_REASON.PREVIOUSLY_SENT,
    }));
  });
});

// ---------------------------------------------------------------------------

describe('the message currently open', () => {
  it('is excluded separately from what the coach has read', () => {
    const out = evidenceStrategyForMessage({
      outreach: surface({
        hooks: [item('CURRENT_SAME_COUNTRY', ROLES.HOOK)],
        relevance: [item('ACADEMIC_FIT', ROLES.RELEVANCE)],
      }),
      step: 2,
      previouslySentKinds: ['CURRENT_SAME_COUNTRY'],
      openDraftKinds: ['ACADEMIC_FIT'],
    });

    // Nothing left that is both unsent and not already in the pending draft.
    expect(out.status).toBe(SEQUENCE_STATUS.NO_NEW_EVIDENCE);
    expect(out.previouslyUsed).toEqual([
      { kind: 'CURRENT_SAME_COUNTRY', group: 'international-connection', source: 'SENT' },
      { kind: 'ACADEMIC_FIT', group: 'academic', source: 'OPEN_DRAFT' },
    ]);
    expect(out.notPreferred).toContainEqual(expect.objectContaining({
      kind: 'ACADEMIC_FIT', reason: SEQUENCE_REASON.IN_OPEN_DRAFT,
    }));
  });

  it('makes regenerating a pending follow-up stable rather than churning', () => {
    const args = {
      outreach: surface({ relevance: [item('ACADEMIC_FIT', ROLES.RELEVANCE)] }),
      step: 2, previouslySentKinds: ['CURRENT_SAME_COUNTRY'], openDraftKinds: ['ACADEMIC_FIT'],
    };
    // Without the open-draft input the same call reports the claim as fresh
    // every time and rewrites the same message while calling it new.
    expect(evidenceStrategyForMessage({ ...args, openDraftKinds: [] }).preferredForThisMessage)
      .toEqual(['ACADEMIC_FIT']);
    for (let i = 0; i < 3; i += 1) {
      expect(evidenceStrategyForMessage(args).status).toBe(SEQUENCE_STATUS.NO_NEW_EVIDENCE);
    }
  });
});

// ---------------------------------------------------------------------------

describe('the boundaries this layer must not cross', () => {
  it('cannot make an unlicensed kind available', () => {
    // Everything it can choose came out of `outreachEvidenceFor`. Excluding a
    // permitted claim leaves fewer, never other.
    const out = evidenceStrategyForMessage({
      outreach: surface({ relevance: [item('ACADEMIC_FIT', ROLES.RELEVANCE)] }),
      step: 2, previouslySentKinds: ['ACADEMIC_FIT'],
    });
    expect(out.status).toBe(SEQUENCE_STATUS.NO_NEW_EVIDENCE);
    expect(out.available.map((a) => a.kind)).toEqual(['ACADEMIC_FIT']);

    const src = fs.readFileSync(new URL('../../shared/evidence/sequenceStrategy.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // It never generates, permits, qualifies or ranks. It reads a decision.
    expect(code).not.toMatch(/generateEvidence|assertSurfaceRenderable|permissionsFor|renderInput|confidenceAtLeast|strength/);
  });

  it('never offers a same-connection alternative as something new', () => {
    // `alternatives` lost their group to a sibling. Offering one as a
    // follow-up's fresh reason is the repetition this module prevents.
    const out = evidenceStrategyForMessage({
      outreach: {
        ...surface({ hooks: [item('CURRENT_SAME_COUNTRY', ROLES.HOOK)] }),
        alternatives: [{ kind: 'HISTORICAL_SAME_COUNTRY', role: ROLES.HOOK, facts: {}, group: 'international-connection' }],
      },
      step: 2, previouslySentKinds: ['CURRENT_SAME_COUNTRY'],
    });
    expect(out.available.map((a) => a.kind)).toEqual(['CURRENT_SAME_COUNTRY']);
    expect(out.preferredForThisMessage).toEqual([]);
  });

  it('refuses a step the pursuit policy would never plan', () => {
    const args = { outreach: surface({ relevance: [item('ACADEMIC_FIT', ROLES.RELEVANCE)] }) };
    expect(MAX_SEQUENCE_STEP).toBe(2);
    expect(() => evidenceStrategyForMessage({ ...args, step: 3 }))
      .toThrow(/describes 2 messages per coach/);
    try { evidenceStrategyForMessage({ ...args, step: 3 }); }
    catch (err) { expect(err.code).toBe('UNSUPPORTED_SEQUENCE_STEP'); }
    for (const bad of [0, -1, 1.5, '2', null]) {
      expect(() => evidenceStrategyForMessage({ ...args, step: bad })).toThrow();
    }
  });

  it('refuses to be asked without a licence decision to narrow', () => {
    expect(() => evidenceStrategyForMessage({ step: 2 })).toThrow(/needs an outreachEvidenceFor result/);
    expect(() => evidenceStrategyForMessage({ outreach: {}, step: 2 })).toThrow(/outreachEvidenceFor/);
  });

  it('reports the policy version, separately from the copy policy', () => {
    const out = evidenceStrategyForMessage({
      outreach: surface({ relevance: [item('ACADEMIC_FIT', ROLES.RELEVANCE)] }), step: 2,
    });
    expect(out.sequencePolicyVersion).toBe(EVIDENCE_SEQUENCE_POLICY_VERSION);
    expect(EVIDENCE_SEQUENCE_POLICY_VERSION).toBe('ESP1');
    // P3 answers what a claim may assert; ESP1 answers how a previous message
    // narrows the next. One number for both would make every later comparison
    // ambiguous about which policy moved.
    const src = fs.readFileSync(new URL('../../shared/evidence/sequenceStrategy.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/OUTREACH_POLICY_VERSION\s*=/);
  });
});

// ---------------------------------------------------------------------------

describe('the strategy flows through the existing engine', () => {
  it('narrows a real selection through applyPrefer, without widening it', () => {
    /**
     * The integration proof, over the REAL selector rather than a fixture: the
     * preference list is the shape the engine already accepts, so C2 needs no
     * new selection surface and changed no evidence file.
     */
    const all = [
      {
        kind: 'CURRENT_SAME_COUNTRY',
        confidence: 'HIGH',
        data: { country: 'New Zealand', count: 1, names: ['A Player'] },
      },
      {
        kind: 'POSITION_GRADUATION',
        confidence: 'HIGH',
        data: { position: 'DEFENSE', count: 2, names: ['C Defender', 'D Defender'], classYear: 2027 },
      },
      {
        kind: 'ACADEMIC_FIT',
        confidence: 'HIGH',
        data: { major: 'Exercise Science', stated: 'exercise science' },
      },
    ];
    const roles = outreachEvidenceFor({ all });
    const licensed = [...roles.hooks, ...roles.relevance].map((i) => i.kind);
    /**
     * Asserted rather than guarded. An earlier version of this test skipped
     * itself when the licence returned fewer than two claims, which meant it
     * passed while proving nothing — and it was doing exactly that, because
     * the fixture did not satisfy the contract. If the registry narrows, this
     * must fail loudly and be rewritten, not quietly stop testing.
     */
    expect(licensed).toEqual(['CURRENT_SAME_COUNTRY', 'POSITION_GRADUATION', 'ACADEMIC_FIT']);

    const strategy = evidenceStrategyForMessage({
      outreach: roles, step: 2, previouslySentKinds: [licensed[0]],
    });
    expect(strategy.preferredForThisMessage).toEqual([licensed[1]]);

    const applied = applyPrefer(roles, strategy.preferredForThisMessage);
    const sent = [...applied.hooks, ...applied.relevance, ...applied.recognition].map((i) => i.kind);
    expect(sent).toEqual([licensed[1]]);
    // Narrowing only: nothing appeared that the licence had not already passed.
    for (const kind of sent) expect(licensed).toContain(kind);
  });
});

// ---------------------------------------------------------------------------

describe('what C2 leaves behind', () => {
  it('is nothing', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    writeMessage(pc, coach, ['CURRENT_SAME_COUNTRY']);

    const tables = ['campaigns', 'programme_campaigns', 'programme_contact_attempts',
      'outreach', 'outreach_send', 'outbound_send_attempt', 'coaches', 'players'];
    const before = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));

    for (let i = 0; i < 3; i += 1) {
      const args = { programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id };
      evidenceStrategyForMessage({
        outreach: surface({ relevance: [item('ACADEMIC_FIT', ROLES.RELEVANCE)] }),
        step: 2,
        previouslySentKinds: sentEvidenceForContact(args),
        openDraftKinds: openDraftEvidenceForContact(args),
      });
    }

    for (const t of tables) expect(db.prepare(`SELECT * FROM ${t}`).all(), t).toEqual(before[t]);
  });

  /**
   * C2 asserted this was wired into NOTHING. C3 wired it in, and the property
   * worth defending changed with it: not that the strategy is unreachable, but
   * that exactly ONE thing reaches it.
   *
   * `evidenceQueries.evidenceFor` is that seam. Every path that composes an
   * outbound email for a real athlete goes through it, so a browser composer,
   * a CLI and a route cannot each grow their own reading of ESP1 — which is
   * how three surfaces came to disagree about what may open an email, twice,
   * before G4 settled it.
   *
   * Read off the IMPORTS. `shared/evidence/index.js` names the strategy in a
   * doc comment describing the argument it takes, and a guard that trips on
   * its own explanation is not a guard.
   */
  it('is reachable from exactly one production seam', () => {
    const importsOf = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
      .split('\n').filter((l) => /^\s*(import\b|\}\s*from|[A-Za-z_,{} ]+\bfrom ')/.test(l)).join('\n');

    // The seam, and it holds the whole policy.
    expect(importsOf('server/lib/evidenceQueries.js'))
      .toMatch(/evidenceStrategyForMessage|sequenceStrategy/);
    expect(importsOf('server/lib/evidenceQueries.js')).toMatch(/evidenceHistory/);

    // Nobody else, including every client that composes an email.
    for (const rel of ['src/lib/emailTemplate.js', 'shared/email/compose.js',
      'shared/evidence/index.js', 'shared/evidence/outreachEvidence.js',
      'shared/evidence/structures.js', 'server/routes/sendOutreach.js',
      'server/scripts/draftOutreach.js', 'src/components/BulkEmailComposer.jsx',
      'shared/evidence/sendSnapshot.js']) {
      expect(importsOf(rel), rel).not.toMatch(/sequenceStrategy|evidenceHistory/);
    }
  });

  it('writes nothing and composes nothing', () => {
    const strategy = fs.readFileSync(new URL('../../shared/evidence/sequenceStrategy.js', import.meta.url), 'utf8');
    expect(strategy).not.toMatch(/db\.prepare|INSERT|UPDATE|from '\.\.\/\.\.\/server/);
    const history = fs.readFileSync(new URL('./evidenceHistory.js', import.meta.url), 'utf8');
    expect(history).not.toMatch(/INSERT|UPDATE|DELETE|composeOutreach|outreachCopyFor/);
  });
});
