/**
 * =============================================================================
 * OBSERVATIONS — A9.6 §Y and §Z.
 *
 * §Y is that the ledger records what happened. §Z is the harder half: that it
 * never records something that DIDN'T.
 *
 * The dangerous errors in an outcome store are not crashes. They are silent
 * promotions - silence becoming a decline, a decline becoming a filled
 * position, an unreviewed guess becoming a fact - because each one produces a
 * row that looks exactly like a real observation and will be believed.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import {
  recordObservation, reviewObservation, observationsFor, observationsForSelection,
  programmeIntelligence, currentState,
  OBSERVATION_KIND, OBSERVATION_CATEGORY, OBSERVATION_SOURCE,
  CLASSIFIER_METHOD, REVIEW_STATE, CORRECTION, categoryOf,
  FUNNEL_STAGE, FUNNEL_EVIDENCE,
} from './recruitingObservations.js';
import { CATEGORY_OF_KIND } from '../../../shared/recruitingObservations.js';
import { STATUS } from './matchmakingService.js';

const K = OBSERVATION_KIND;
const PROGRAMME = { collegeName: 'Observation State', sport: 'mens-soccer' };
const players = [];
let player;

const athlete = () => {
  const row = Player.create({
    full_name: `A9.6 obs ${players.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    recruiting_class_year: 2028,
  });
  players.push(row.id);
  return Player.get(row.id);
};

beforeAll(() => { player = athlete(); });
afterAll(() => {
  for (const id of players) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});
beforeEach(() => {
  db.prepare('DELETE FROM recruiting_observations WHERE athlete_id = ?').run(player.id);
});

const observe = (kind, extra = {}) => recordObservation(db, {
  athleteId: player.id,
  ...PROGRAMME,
  kind,
  source: OBSERVATION_SOURCE.COACH_REPLY,
  ...extra,
}).observation;

/* ------------------------------------------------------------------ */
/* Y1-Y4. Valid events, the vocabulary, and the categories            */
/* ------------------------------------------------------------------ */

describe('A9.6 §Y. the vocabulary is bounded and total', () => {
  it('Y1. every kind maps to exactly one category', () => {
    const kinds = Object.values(OBSERVATION_KIND);
    expect(Object.keys(CATEGORY_OF_KIND).sort()).toEqual([...kinds].sort());
    for (const k of kinds) {
      expect(Object.values(OBSERVATION_CATEGORY)).toContain(categoryOf(k));
    }
  });

  it('Y2. a valid observation is recorded and reads back with its category', () => {
    const o = observe(K.POSITIVE_REPLY);
    expect(o.kind).toBe(K.POSITIVE_REPLY);
    expect(o.category).toBe(OBSERVATION_CATEGORY.PROGRAMME_INTEREST);
    expect(observationsFor(db, { athleteId: player.id, ...PROGRAMME })).toHaveLength(1);
  });

  it('Y3. an unknown kind is refused by name', () => {
    expect(() => observe('COACH_SEEMED_KEEN')).toThrow(/Unknown observation kind/i);
  });

  it('Y4. an unattributed observation is refused', () => {
    expect(() => recordObservation(db, {
      athleteId: player.id, ...PROGRAMME, kind: K.POSITIVE_REPLY, source: 'VIBES',
    })).toThrow(/Unknown observation source/i);
  });
});

/* ------------------------------------------------------------------ */
/* Y5-Y8. Structured attributes                                       */
/* ------------------------------------------------------------------ */

describe('A9.6 §Y. structured attributes say what the claim needs', () => {
  it('Y5. POSITION_FILLED carries a canonical position and a class year', () => {
    const o = observe(K.POSITION_FILLED, {
      attributes: { position: 'GOALKEEPER', recruitingClassYear: 2027 },
    });
    expect(o.attributes).toEqual({ position: 'GOALKEEPER', recruitingClassYear: 2027 });
  });

  it('Y6. POSITION_FILLED without a position is refused — it would say nothing', () => {
    expect(() => observe(K.POSITION_FILLED, { attributes: {} }))
      .toThrow(/requires position/i);
  });

  it('Y7. a free-text position is refused; the vocabulary is the canonical four', () => {
    expect(() => observe(K.POSITION_FILLED, { attributes: { position: 'left wing back' } }))
      .toThrow(/position must be one of/i);
  });

  it('Y8. an attribute the kind does not take is refused', () => {
    expect(() => observe(K.POSITION_FILLED, {
      attributes: { position: 'FORWARD', scholarshipAmount: 12000 },
    })).toThrow(/does not take scholarshipAmount/i);
  });

  it('Y9. urgency is only what a coach stated', () => {
    expect(() => observe(K.POSITION_NEEDED, {
      attributes: { position: 'MIDFIELD', urgency: 'probably soon' },
    })).toThrow(/urgency must be/i);
  });
});

/* ------------------------------------------------------------------ */
/* Y10-Y12. Time, classification provenance, review                   */
/* ------------------------------------------------------------------ */

describe('A9.6 §Y. provenance and time', () => {
  it('Y10. observed_at and recorded_at are separate', () => {
    const o = observe(K.POSITIVE_REPLY, {
      observedAt: '2026-04-01T00:00:00.000Z', now: '2026-06-01T00:00:00.000Z',
    });
    expect(o.observed_at).toBe('2026-04-01T00:00:00.000Z');
    expect(o.recorded_at).toBe('2026-06-01T00:00:00.000Z');
  });

  it('Y11. a manual classification is CONFIRMED; a machine one is UNREVIEWED', () => {
    const manual = observe(K.POSITIVE_REPLY, { classifierMethod: CLASSIFIER_METHOD.MANUAL });
    const ai = observe(K.NEUTRAL_REPLY, {
      classifierMethod: CLASSIFIER_METHOD.AI_ASSISTED,
      classifierVersion: 'reply-clf-0.1',
      confidence: 0.74,
    });
    expect(manual.review_state).toBe(REVIEW_STATE.CONFIRMED);
    expect(ai.review_state).toBe(REVIEW_STATE.UNREVIEWED);
    expect(ai.classifier_version).toBe('reply-clf-0.1');
    expect(ai.confidence).toBeCloseTo(0.74);
  });

  it('Y12. review writes the review and leaves the claim alone', () => {
    const o = observe(K.NEGATIVE_REPLY, { classifierMethod: CLASSIFIER_METHOD.AI_ASSISTED });
    const reviewed = reviewObservation(db, {
      observationId: o.id, state: REVIEW_STATE.REJECTED, operatorId: null,
    });
    expect(reviewed.review_state).toBe(REVIEW_STATE.REJECTED);
    expect(reviewed.kind).toBe(K.NEGATIVE_REPLY);
  });

  it('Y13. the recorded claim itself cannot be edited — the database refuses', () => {
    const o = observe(K.NEGATIVE_REPLY);
    expect(() => db.prepare("UPDATE recruiting_observations SET kind = ? WHERE id = ?")
      .run(K.POSITIVE_REPLY, o.id)).toThrow(/immutable/i);
    expect(() => db.prepare("UPDATE recruiting_observations SET note = 'edited' WHERE id = ?")
      .run(o.id)).toThrow(/immutable/i);
  });
});

/* ------------------------------------------------------------------ */
/* Y14-Y16. Idempotency and legitimate repeats                        */
/* ------------------------------------------------------------------ */

describe('A9.6 §Y. duplicates', () => {
  it('Y14. a provider redelivering the same event is not a second observation', () => {
    const first = recordObservation(db, {
      athleteId: player.id, ...PROGRAMME, kind: K.POSITIVE_REPLY,
      source: OBSERVATION_SOURCE.PROVIDER, providerEventId: 'evt_abc123',
    });
    const second = recordObservation(db, {
      athleteId: player.id, ...PROGRAMME, kind: K.POSITIVE_REPLY,
      source: OBSERVATION_SOURCE.PROVIDER, providerEventId: 'evt_abc123',
    });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.observation.id).toBe(first.observation.id);
    expect(observationsFor(db, { athleteId: player.id, ...PROGRAMME })).toHaveLength(1);
  });

  it('Y15. the same manual observation twice is TWO observations', () => {
    observe(K.INTERESTED, { observedAt: '2026-03-01T00:00:00.000Z' });
    observe(K.INTERESTED, { observedAt: '2026-06-01T00:00:00.000Z' });
    expect(observationsFor(db, { athleteId: player.id, ...PROGRAMME })).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* Y17-Y20. Corrections                                               */
/* ------------------------------------------------------------------ */

describe('A9.6 §P. corrections preserve what was believed', () => {
  it('Y16. a SUPERSEDES row leaves the original legible and in order', () => {
    const first = observe(K.INTERESTED, { observedAt: '2026-03-01T00:00:00.000Z' });
    observe(K.POSITION_FILLED, {
      observedAt: '2026-06-01T00:00:00.000Z',
      attributes: { position: 'MIDFIELD' },
      correctsObservationId: first.id,
      correction: CORRECTION.SUPERSEDES,
    });

    const all = observationsFor(db, { athleteId: player.id, ...PROGRAMME });
    expect(all).toHaveLength(2);
    expect(all[0].kind).toBe(K.INTERESTED);
    expect(all[0].review_state).not.toBe(REVIEW_STATE.REJECTED);
  });

  it('Y17. a half-stated correction is refused', () => {
    const first = observe(K.INTERESTED);
    expect(() => observe(K.NEGATIVE_REPLY, { correctsObservationId: first.id }))
      .toThrow(/must say both/i);
    expect(() => observe(K.NEGATIVE_REPLY, { correction: CORRECTION.RETRACTS }))
      .toThrow(/must say both/i);
  });

  it('Y18. a correction cannot cross to another athlete or programme', () => {
    const first = observe(K.INTERESTED);
    expect(() => recordObservation(db, {
      athleteId: player.id,
      collegeName: 'Somewhere Else', sport: 'mens-soccer',
      kind: K.NEGATIVE_REPLY, source: OBSERVATION_SOURCE.COACH_REPLY,
      correctsObservationId: first.id, correction: CORRECTION.RETRACTS,
    })).toThrow(/same athlete and the same programme/i);
  });

  it('Y19. SUPERSEDES and RETRACTS are different claims about the past', () => {
    const superseded = observe(K.INTERESTED, { observedAt: '2026-03-01T00:00:00.000Z' });
    observe(K.NEGATIVE_REPLY, {
      observedAt: '2026-04-01T00:00:00.000Z',
      correctsObservationId: superseded.id, correction: CORRECTION.SUPERSEDES,
    });
    const retracted = observe(K.REQUESTED_CALL, { observedAt: '2026-05-01T00:00:00.000Z' });
    const r = observe(K.NEUTRAL_REPLY, {
      observedAt: '2026-05-02T00:00:00.000Z',
      correctsObservationId: retracted.id, correction: CORRECTION.RETRACTS,
    });
    expect(r.correction).toBe(CORRECTION.RETRACTS);

    // Both are out of the CURRENT state; both remain in the history.
    const state = currentState(db, { athleteId: player.id, ...PROGRAMME });
    expect(state.observationCount).toBe(4);
    expect(state.effectiveCount).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* §Q. The projection                                                 */
/* ------------------------------------------------------------------ */

describe('A9.6 §Q. current state is derived, on three separate axes', () => {
  it('Q1. the three categories project independently', () => {
    observe(K.POSITIVE_REPLY, { observedAt: '2026-03-01T00:00:00.000Z' });
    observe(K.POSITION_NEEDED, {
      observedAt: '2026-03-02T00:00:00.000Z', attributes: { position: 'MIDFIELD' },
    });
    observe(K.ATHLETE_NOT_INTERESTED, {
      observedAt: '2026-03-03T00:00:00.000Z', source: OBSERVATION_SOURCE.ATHLETE,
    });

    const s = currentState(db, { athleteId: player.id, ...PROGRAMME });
    expect(s.programmeInterest.kind).toBe(K.POSITIVE_REPLY);
    expect(s.recruitingNeed.kind).toBe(K.POSITION_NEEDED);
    expect(s.athleteOutcome.kind).toBe(K.ATHLETE_NOT_INTERESTED);
  });

  it('Q2. the coach being keen does not overwrite the athlete having gone off it', () => {
    observe(K.ROSTER_PLACE_OFFERED, { observedAt: '2026-03-01T00:00:00.000Z' });
    observe(K.ATHLETE_WITHDREW, {
      observedAt: '2026-04-01T00:00:00.000Z', source: OBSERVATION_SOURCE.ATHLETE,
    });
    const s = currentState(db, { athleteId: player.id, ...PROGRAMME });
    expect(s.programmeInterest.kind).toBe(K.ROSTER_PLACE_OFFERED);
    expect(s.athleteOutcome.kind).toBe(K.ATHLETE_WITHDREW);
  });

  it('Q3. a REJECTED observation stops counting without disappearing', () => {
    const o = observe(K.NEGATIVE_REPLY, { classifierMethod: CLASSIFIER_METHOD.AI_ASSISTED });
    expect(currentState(db, { athleteId: player.id, ...PROGRAMME }).programmeInterest.kind)
      .toBe(K.NEGATIVE_REPLY);

    reviewObservation(db, { observationId: o.id, state: REVIEW_STATE.REJECTED });
    const s = currentState(db, { athleteId: player.id, ...PROGRAMME });
    expect(s.programmeInterest).toBeNull();
    expect(s.observationCount).toBe(1);
  });

  it('Q4. unreviewed machine guesses can be excluded from the projection', () => {
    observe(K.NEGATIVE_REPLY, { classifierMethod: CLASSIFIER_METHOD.AI_ASSISTED });
    const withGuess = currentState(db, { athleteId: player.id, ...PROGRAMME });
    const reviewedOnly = currentState(db, {
      athleteId: player.id, ...PROGRAMME, unreviewed: false,
    });
    expect(withGuess.programmeInterest.kind).toBe(K.NEGATIVE_REPLY);
    expect(reviewedOnly.programmeInterest).toBeNull();
  });

  it('Q5. the projection is rebuilt from the rows, never stored', () => {
    observe(K.INTERESTED, { observedAt: '2026-03-01T00:00:00.000Z' });
    const before = currentState(db, { athleteId: player.id, ...PROGRAMME });
    observe(K.DECLINED_ATHLETE, { observedAt: '2026-05-01T00:00:00.000Z' });
    const after = currentState(db, { athleteId: player.id, ...PROGRAMME });
    expect(before.programmeInterest.kind).toBe(K.INTERESTED);
    expect(after.programmeInterest.kind).toBe(K.DECLINED_ATHLETE);
  });
});

/* ------------------------------------------------------------------ */
/* §Z. SEMANTIC SAFETY — the promotions that must never happen        */
/* ------------------------------------------------------------------ */

describe('A9.6 §Z. silence is not a decline, and a decline is not a filled spot', () => {
  it('Z1. NO REPLY is null, not NEGATIVE_REPLY', () => {
    const s = currentState(db, { athleteId: player.id, ...PROGRAMME });
    expect(s.programmeInterest).toBeNull();
    expect(s.observationCount).toBe(0);
    // And nothing anywhere in the ledger invented one.
    expect(observationsFor(db, { athleteId: player.id, ...PROGRAMME })).toEqual([]);
  });

  it('Z2. NEGATIVE_REPLY is not POSITION_FILLED — different kind, different category', () => {
    observe(K.NEGATIVE_REPLY);
    const s = currentState(db, { athleteId: player.id, ...PROGRAMME });
    expect(s.programmeInterest.kind).toBe(K.NEGATIVE_REPLY);
    expect(s.recruitingNeed).toBeNull();
    expect(categoryOf(K.NEGATIVE_REPLY)).toBe(OBSERVATION_CATEGORY.PROGRAMME_INTEREST);
    expect(categoryOf(K.POSITION_FILLED)).toBe(OBSERVATION_CATEGORY.RECRUITING_INTELLIGENCE);
  });

  it('Z3. "not recruiting you" does not make the programme intelligence say anything', () => {
    observe(K.DECLINED_ATHLETE);
    expect(programmeIntelligence(db, PROGRAMME)).toEqual([]);
  });

  it('Z4. POSITION_FILLED requires being classified as POSITION_FILLED', () => {
    observe(K.NEGATIVE_REPLY);
    observe(K.ATHLETE_NOT_INTERESTED, { source: OBSERVATION_SOURCE.ATHLETE });
    observe(K.NEUTRAL_REPLY);
    const intel = programmeIntelligence(db, PROGRAMME);
    expect(intel.map((o) => o.kind)).not.toContain(K.POSITION_FILLED);
  });

  it('Z5. POSITION_NEEDED equally requires its own classification and a position', () => {
    observe(K.POSITIVE_REPLY);
    expect(programmeIntelligence(db, PROGRAMME)).toEqual([]);
    expect(() => observe(K.POSITION_NEEDED, { attributes: {} })).toThrow(/requires position/i);
  });

  /**
   * The matchmaking evidence states are about THRIV3'S EVIDENCE. A programme
   * that cannot be scored for want of a roster has said nothing about the
   * athlete, and an outcome vocabulary containing those words would invite
   * exactly that reading.
   */
  it('Z6. LIMITED_DATA and UNSUPPORTED_ASSOCIATION are not observation kinds', () => {
    const kinds = Object.values(OBSERVATION_KIND);
    expect(kinds).not.toContain(STATUS.SUPPORTED_LIMITED_DATA);
    expect(kinds).not.toContain(STATUS.UNSUPPORTED_ASSOCIATION);
    expect(kinds.join(' ')).not.toMatch(/LIMITED_DATA|UNSUPPORTED/);
    expect(() => observe(STATUS.UNSUPPORTED_ASSOCIATION)).toThrow(/Unknown observation kind/i);
  });

  it('Z7. no observation kind is an engine word', () => {
    const banned = [/RANKED/, /PURSUIT/, /RECRUITABILITY/, /MEASURED/, /PARTIAL/, /BAND/];
    for (const k of Object.values(OBSERVATION_KIND)) {
      for (const b of banned) expect(k).not.toMatch(b);
    }
  });

  it('Z8. the funnel is stage evidence, not a score', () => {
    expect(Object.values(FUNNEL_STAGE)).toContain('COMMITTED');
    for (const [, kinds] of Object.entries(FUNNEL_EVIDENCE)) {
      for (const k of kinds) expect(Object.values(OBSERVATION_KIND)).toContain(k);
    }
    // No weights, no ordering arithmetic — the stages are independent.
    expect(Object.values(FUNNEL_EVIDENCE).flat().every((k) => typeof k === 'string')).toBe(true);
  });
});
