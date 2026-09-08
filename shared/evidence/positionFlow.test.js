import { describe, it, expect } from 'vitest';
import { outreachEvidenceFor, applyPrefer } from './outreachEvidence.js';
import { fragmentFor } from '../email/blocks.js';
import { BLOCKS } from './structures.js';

/**
 * TWO TRUE SENTENCES THAT ASSEMBLE A THIRD.
 *
 * Dedupe keeps one claim per connection, so several observations of one thing
 * cannot read as several reasons. It works inside a group and cannot see the
 * failure J2 and J3 both hit: claims from DIFFERENT groups combining into a
 * conclusion neither of them makes.
 *
 *   a forward came IN     "…came into the programme from New Zealand, also a forward"
 *   a forward goes OUT    "one forward is listed to graduate in 2027"
 *   and the athlete is a forward.
 *
 * Nobody wrote "you need another forward". The reader supplies it, and we laid
 * the two halves side by side. POSITION_FLOW_HOLD is the one named rule that
 * stops it, and it is deliberately a LIST of kinds rather than a property, so
 * it cannot quietly grow into a general inference engine.
 */

const D = {
  ARRIVAL_SAME_COUNTRY_POSITION: { country: 'New Zealand', position: 'forward', count: 1, seasons: ['2024'], name: 'Harrison Dudley', nameSeason: '2024' },
  ARRIVAL_SAME_REGION_POSITION: { countries: ['Australia'], position: 'forward', count: 1, seasons: ['2025'], athleteCountry: 'New Zealand' },
  COACH_ARRIVAL_SAME_COUNTRY: { coach: 'Sam Baker', country: 'New Zealand', count: 1, seasons: ['2025'], name: 'Leo Harbottle', nameSeason: '2025' },
  HISTORICAL_SAME_COUNTRY: { country: 'New Zealand', count: 1, names: ['Leo Harbottle'], seasons: ['2025'] },
  CURRENT_SAME_COUNTRY: { country: 'New Zealand', count: 1, names: ['Louis Spillane'] },
  POSITION_GRADUATION: { position: 'forward', count: 1, names: ['Adam Hill'], classYear: 2027 },
  ACADEMIC_FIT: { stated: 'exercise science', major: 'Kinesiology' },
  CONFERENCE_TITLE: { conference: 'ACC' },
  POSTSEASON_RESULT: { round: 'r16' },
};

const run = (...kinds) => outreachEvidenceFor({
  all: kinds.map((k) => ({ kind: k, data: D[k], confidence: 'HIGH' })),
});
const sent = (r) => [...r.hooks, ...r.relevance, ...r.recognition].map((i) => i.kind);
const heldNote = (r, kind) => (r.dispositions ?? []).find((d) => d.kind === kind && d.disposition === 'HELD');

/* -------------------------------------------------------------------------- */

describe('an arrival AT the position holds the departure at that position', () => {
  for (const arrival of ['ARRIVAL_SAME_COUNTRY_POSITION', 'ARRIVAL_SAME_REGION_POSITION']) {
    it(`${arrival} + POSITION_GRADUATION sends only the arrival`, () => {
      const r = run(arrival, 'POSITION_GRADUATION');
      expect(sent(r)).toEqual([arrival]);
      expect(sent(r)).not.toContain('POSITION_GRADUATION');
    });

    it(`${arrival} keeps the email opening on the relationship`, () => {
      // The measured alternative — holding the arrival instead — dropped all 30
      // of these to PLAYER_FIRST and deleted 38% of one kind's entire corpus
      // presence to save a claim available at 814 programmes.
      const r = run(arrival, 'POSITION_GRADUATION');
      expect(r.hooks.map((h) => h.kind)).toEqual([arrival]);
    });

    it(`${arrival} lets another relevance claim take the freed slot`, () => {
      const r = run(arrival, 'POSITION_GRADUATION', 'ACADEMIC_FIT');
      expect(sent(r)).toContain('ACADEMIC_FIT');
      expect(sent(r)).not.toContain('POSITION_GRADUATION');
    });
  }
});

describe('a compatriot claim with no position in it is left alone', () => {
  /**
   * 159 live emails. "Leo Harbottle came through the programme from New
   * Zealand in 2025" beside "one forward is listed to graduate in 2027" is two
   * observations on two axes; there is no flow to read. Blocking these would
   * be the generic inference engine, and it would cost the strongest emails in
   * the corpus.
   */
  for (const hook of ['COACH_ARRIVAL_SAME_COUNTRY', 'HISTORICAL_SAME_COUNTRY', 'CURRENT_SAME_COUNTRY']) {
    it(`${hook} + POSITION_GRADUATION both send`, () => {
      const r = run(hook, 'POSITION_GRADUATION');
      expect(sent(r)).toContain(hook);
      expect(sent(r)).toContain('POSITION_GRADUATION');
      expect(heldNote(r, 'POSITION_GRADUATION')).toBeUndefined();
    });
  }

  it('leaves POSITION_GRADUATION alone when it is the only claim', () => {
    expect(sent(run('POSITION_GRADUATION'))).toEqual(['POSITION_GRADUATION']);
  });

  it('leaves ACADEMIC_FIT beside an arrival alone', () => {
    const r = run('ARRIVAL_SAME_COUNTRY_POSITION', 'ACADEMIC_FIT');
    expect(sent(r)).toEqual(['ARRIVAL_SAME_COUNTRY_POSITION', 'ACADEMIC_FIT']);
  });

  it('leaves recognition beside a graduation alone', () => {
    const r = run('POSITION_GRADUATION', 'CONFERENCE_TITLE');
    expect(sent(r)).toContain('POSITION_GRADUATION');
    expect(sent(r)).toContain('CONFERENCE_TITLE');
  });
});

describe('the held claim is withheld, not discarded', () => {
  const r = run('ARRIVAL_SAME_COUNTRY_POSITION', 'POSITION_GRADUATION');

  it('says why, in the operator\'s words', () => {
    const note = heldNote(r, 'POSITION_GRADUATION');
    expect(note).toBeTruthy();
    expect(note.reason).toMatch(/roster need/);
    expect(note.reason).toMatch(/arrival at this position/);
    expect(note.supersededBy).toBe('ARRIVAL_SAME_COUNTRY_POSITION');
  });

  it('stays offerable, because it is true and an operator may disagree', () => {
    expect((r.alternatives ?? []).map((a) => a.kind)).toContain('POSITION_GRADUATION');
    const preferred = applyPrefer(r, ['POSITION_GRADUATION']);
    expect([...preferred.hooks, ...preferred.relevance].map((i) => i.kind))
      .toContain('POSITION_GRADUATION');
  });

  it('is never silently dropped', () => {
    // Every kind the surface saw has a disposition. A claim that vanished
    // without one is the failure this whole log exists to prevent.
    const seen = new Set((r.dispositions ?? []).map((d) => d.kind));
    expect(seen).toContain('POSITION_GRADUATION');
    expect(seen).toContain('ARRIVAL_SAME_COUNTRY_POSITION');
  });
});

/**
 * THE INTRODUCTION OWNS THE ATHLETE'S IDENTITY. THE BULLETS OWN THE ACADEMICS.
 *
 * The block said "• Position: Forward / • Graduation: 2027" two lines after the
 * sentence "a forward from New Zealand looking at options for the 2027 class"
 * — in all 4,742 emails, and for the two athletes with no GPA or test score on
 * file it was NOTHING BUT that repetition.
 */
describe('athlete facts have one owner each', () => {
  const intro = fragmentFor(BLOCKS.ATHLETE_INTRO);
  const creds = fragmentFor(BLOCKS.CREDENTIALS);

  it('states the position and class year in the introduction', () => {
    expect(intro).toContain('{{player_position|lowercase}}');
    expect(intro).toContain('{{player_class_year}}');
  });

  it('does not repeat them in the bullets', () => {
    expect(creds).not.toContain('Position:');
    expect(creds).not.toContain('Graduation:');
    expect(creds).not.toContain('{{player_class_year}}');
  });

  it('keeps the academic facts the introduction does not carry', () => {
    for (const token of ['player_gpa', 'player_sat_score', 'player_act_score']) {
      expect(creds, token).toContain(token);
    }
    for (const token of ['has_gpa', 'has_sat_score', 'has_act_score']) {
      expect(creds, token).toContain(token);
    }
  });

  it('resolves to nothing when no academic fact is on file', () => {
    // Half the corpus. An empty block must disappear, not leave bullets behind.
    const empty = creds.replace(/\{\{#if has_\w+\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    expect(empty.replace(/\s/g, '')).toBe('');
  });
});
