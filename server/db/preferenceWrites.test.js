/**
 * A7.12.1 — what the database will and will not accept as an athlete's
 * stated preference.
 *
 * These are the only three inputs that let an athlete change their own
 * ranking, so the write boundary has two jobs and they pull in opposite
 * directions: take every legitimate answer, and take nothing else. A 7
 * clamped to a 5 and a 7 dropped to NULL are both answers the athlete did
 * not give, so the write is REFUSED instead.
 *
 * The CHECK constraint is asserted separately from the entity validator.
 * They enforce the same rule in two places on purpose - a script that writes
 * SQL directly still cannot leave a 0 in a column the scorer reads as 1-5 -
 * and a test that only exercised one of them would not notice the other
 * being lost.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import db from './client.js';
import { Player } from './entities/player.js';
import { PREFERENCE_FIELD_NAMES, MAY_NOT_INFER_FROM } from '../../shared/matching/v2/athletePreferences.js';

const NAME = 'preference-write-test';
const base = { full_name: NAME, position: 'Midfielder', sport: 'mens-soccer' };
const clean = () => db.prepare('DELETE FROM players WHERE full_name = ?').run(NAME);

beforeEach(clean);
afterAll(clean);

describe('the columns exist and round-trip', () => {
  it('has all three columns on the players table', () => {
    const cols = new Set(db.prepare('PRAGMA table_info(players)').all().map((c) => c.name));
    for (const f of PREFERENCE_FIELD_NAMES) expect(cols.has(f), f).toBe(true);
  });

  it('stores and reads back every value on the scale', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      clean();
      const p = Player.create({
        ...base,
        competitive_level_priority: v,
        playing_opportunity_priority: v,
        academic_strength_priority: v,
      });
      const back = Player.get(p.id);
      for (const f of PREFERENCE_FIELD_NAMES) expect(back[f], `${f} = ${v}`).toBe(v);
    }
  });

  it('keeps the three independent of each other', () => {
    const p = Player.create({
      ...base,
      competitive_level_priority: 5,
      playing_opportunity_priority: 3,
      academic_strength_priority: 4,
    });
    const back = Player.get(p.id);
    expect(back.competitive_level_priority).toBe(5);
    expect(back.playing_opportunity_priority).toBe(3);
    expect(back.academic_strength_priority).toBe(4);
  });

  it('accepts a player carrying none of them, exactly as before', () => {
    const p = Player.create({ ...base, budget_range: '$20k-$25k/yr' });
    const back = Player.get(p.id);
    for (const f of PREFERENCE_FIELD_NAMES) expect(back[f], f).toBeNull();
    expect(back.budget_range).toBe('$20k-$25k/yr');
  });

  it('stores an explicit null as unanswered rather than refusing it', () => {
    const p = Player.create({ ...base, competitive_level_priority: null });
    expect(Player.get(p.id).competitive_level_priority).toBeNull();
  });

  /**
   * A select and a JSON body both send "4". The column's own affinity would
   * take it, so the entity takes it too - two layers disagreeing about this
   * is how a value passes the validator and dies at SQLite with a message
   * nobody can act on.
   */
  it('normalises a numeric string to an integer', () => {
    const p = Player.create({ ...base, competitive_level_priority: '4' });
    expect(Player.get(p.id).competitive_level_priority).toBe(4);
  });

  it('treats an empty string as unanswered', () => {
    const p = Player.create({ ...base, academic_strength_priority: '' });
    expect(Player.get(p.id).academic_strength_priority).toBeNull();
  });
});

describe('what the entity refuses', () => {
  const rejects = [
    ['zero', 0], ['six', 6], ['negative', -1], ['a fraction', 2.5],
    ['NaN', NaN], ['Infinity', Infinity], ['a word', 'very important'],
    ['an object', { value: 3 }], ['an array', [3]], ['a boolean', true],
  ];

  for (const [label, value] of rejects) {
    it(`refuses ${label} rather than repairing it`, () => {
      expect(() => Player.create({ ...base, competitive_level_priority: value })).toThrow();
      expect(db.prepare('SELECT COUNT(*) n FROM players WHERE full_name = ?').get(NAME).n).toBe(0);
    });
  }

  it('names the field that was wrong', () => {
    expect(() => Player.create({ ...base, playing_opportunity_priority: 9 }))
      .toThrow(/playing_opportunity_priority/);
  });

  it('refuses on update as firmly as on create, and leaves the row alone', () => {
    const p = Player.create({ ...base, competitive_level_priority: 4 });
    expect(() => Player.update(p.id, { competitive_level_priority: 6 })).toThrow();
    expect(Player.get(p.id).competitive_level_priority).toBe(4);
  });
});

describe('the CHECK constraint, independent of the entity', () => {
  it('refuses an out-of-range value written straight to SQL', () => {
    const p = Player.create({ ...base });
    for (const bad of [0, 6, -2, 2.5]) {
      expect(
        () => db.prepare('UPDATE players SET competitive_level_priority = ? WHERE id = ?').run(bad, p.id),
        String(bad),
      ).toThrow(/CHECK constraint/);
    }
    expect(Player.get(p.id).competitive_level_priority).toBeNull();
  });

  it('allows NULL and every value on the scale written straight to SQL', () => {
    const p = Player.create({ ...base });
    for (const ok of [1, 2, 3, 4, 5, null]) {
      expect(() => db.prepare('UPDATE players SET academic_strength_priority = ? WHERE id = ?').run(ok, p.id)).not.toThrow();
    }
  });
});

describe('omitted is not the same as null', () => {
  it('leaves an answer alone when the patch does not mention it', () => {
    const p = Player.create({ ...base, competitive_level_priority: 5, playing_opportunity_priority: 2 });
    Player.update(p.id, { city: 'Boston' });
    const back = Player.get(p.id);
    expect(back.competitive_level_priority).toBe(5);
    expect(back.playing_opportunity_priority).toBe(2);
    expect(back.city).toBe('Boston');
  });

  it('clears an answer when the patch says null', () => {
    const p = Player.create({ ...base, competitive_level_priority: 5 });
    Player.update(p.id, { competitive_level_priority: null });
    expect(Player.get(p.id).competitive_level_priority).toBeNull();
  });

  it('changes only the field named', () => {
    const p = Player.create({
      ...base, competitive_level_priority: 5, playing_opportunity_priority: 5, academic_strength_priority: 5,
    });
    Player.update(p.id, { academic_strength_priority: 1 });
    const back = Player.get(p.id);
    expect(back.competitive_level_priority).toBe(5);
    expect(back.playing_opportunity_priority).toBe(5);
    expect(back.academic_strength_priority).toBe(1);
  });
});

describe('nothing infers a preference from anything else', () => {
  /**
   * The point of the whole field. A preference is a thing the athlete said,
   * and every input below is one somebody could plausibly derive one from.
   */
  it('leaves all three NULL however much else the record carries', () => {
    const p = Player.create({
      ...base,
      football_ability: 9,
      gpa: 4.0,
      sat_score: 1550,
      act_score: 36,
      intended_major: 'Engineering',
      budget_range: '$40k+/yr',
      origin: 'USA',
      preferred_divisions: ['NCAA D1'],
      criterion_ranking: ['athletic', 'roster', 'academic', 'geography', 'affordability', 'programQuality'],
    });
    const back = Player.get(p.id);
    for (const f of PREFERENCE_FIELD_NAMES) expect(back[f], `${f} was inferred`).toBeNull();
  });

  it('does not move a preference when an inference source changes', () => {
    const p = Player.create({ ...base, competitive_level_priority: 2 });
    for (const field of MAY_NOT_INFER_FROM) {
      if (field === 'recommendations') continue;
      const before = Player.get(p.id).competitive_level_priority;
      expect(before, `changing ${field} moved the preference`).toBe(2);
    }
    Player.update(p.id, { football_ability: 10, gpa: 4.0, criterion_ranking: ['athletic'] });
    expect(Player.get(p.id).competitive_level_priority).toBe(2);
    expect(Player.get(p.id).playing_opportunity_priority).toBeNull();
  });

  it('names every field a future reader might be tempted by', () => {
    for (const f of ['football_ability', 'gpa', 'sat_score', 'act_score', 'intended_major', 'criterion_ranking']) {
      expect(MAY_NOT_INFER_FROM, f).toContain(f);
    }
  });
});
