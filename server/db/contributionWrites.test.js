/**
 * A7.9.2 — what the database will and will not accept as a family's answer.
 *
 * The contribution pair is the one athlete-side input Financial reads, and an
 * impossible pair is two different answers to one question. These assert the
 * write is REFUSED rather than repaired: coercing either way would put a
 * budget in the record that nobody stated, which is the exact failure the
 * field was added to prevent.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import db from './client.js';
import { Player } from './entities/player.js';

const NAMES = ['contribution-write-test'];
const base = { full_name: NAMES[0], position: 'Midfielder', sport: 'mens-soccer' };
const clean = () => db.prepare('DELETE FROM players WHERE full_name = ?').run(NAMES[0]);

beforeEach(clean);
afterAll(clean);

describe('the columns exist and round-trip', () => {
  it('accepts a stated maximum and reads it back as a number', () => {
    const p = Player.create({ ...base, contribution_state: 'STATED', max_annual_contribution_usd: 55000 });
    expect(Player.get(p.id).max_annual_contribution_usd).toBe(55000);
    expect(Player.get(p.id).contribution_state).toBe('STATED');
  });

  it('accepts NOT_A_CONSTRAINT with a null maximum', () => {
    const p = Player.create({ ...base, contribution_state: 'NOT_A_CONSTRAINT', max_annual_contribution_usd: null });
    expect(Player.get(p.id).contribution_state).toBe('NOT_A_CONSTRAINT');
    expect(Player.get(p.id).max_annual_contribution_usd).toBeNull();
  });

  it('accepts a stated maximum of zero, which is a measurement', () => {
    const p = Player.create({ ...base, contribution_state: 'STATED', max_annual_contribution_usd: 0 });
    expect(Player.get(p.id).max_annual_contribution_usd).toBe(0);
  });

  /** The whole existing surface: nothing about a player write needs the pair. */
  it('accepts a player carrying neither field, exactly as before', () => {
    const p = Player.create({ ...base, budget_range: '$20k-$25k/yr' });
    expect(Player.get(p.id).contribution_state).toBeNull();
    expect(Player.get(p.id).max_annual_contribution_usd).toBeNull();
    expect(Player.get(p.id).budget_range).toBe('$20k-$25k/yr');
  });
});

describe('impossible pairs are refused, not coerced', () => {
  it.each([
    ['STATED with a null maximum', { contribution_state: 'STATED', max_annual_contribution_usd: null }],
    ['STATED with no maximum key at all', { contribution_state: 'STATED' }],
    ['STATED with a negative maximum', { contribution_state: 'STATED', max_annual_contribution_usd: -5000 }],
    ['NOT_A_CONSTRAINT with a numeric maximum', { contribution_state: 'NOT_A_CONSTRAINT', max_annual_contribution_usd: 50000 }],
    ['NEEDS_CONFIRMATION with a numeric maximum', { contribution_state: 'NEEDS_CONFIRMATION', max_annual_contribution_usd: 50000 }],
    ['an unknown contribution_state', { contribution_state: 'WEALTHY' }],
    ['a maximum with no state', { max_annual_contribution_usd: 50000 }],
  ])('refuses to create %s', (_label, pair) => {
    expect(() => Player.create({ ...base, ...pair })).toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM players WHERE full_name = ?').get(NAMES[0]).n).toBe(0);
  });

  /**
   * The patch alone is legal; the ROW it would produce is not. Checking only
   * the patch would strand a stale maximum beside a state that forbids one.
   */
  it('refuses a patch that would strand a stale maximum', () => {
    const p = Player.create({ ...base, contribution_state: 'STATED', max_annual_contribution_usd: 55000 });
    expect(() => Player.update(p.id, { contribution_state: 'NOT_A_CONSTRAINT' })).toThrow();
    expect(Player.get(p.id).max_annual_contribution_usd).toBe(55000);
    expect(Player.get(p.id).contribution_state).toBe('STATED');
  });

  it('allows the same transition when the maximum is cleared in the same write', () => {
    const p = Player.create({ ...base, contribution_state: 'STATED', max_annual_contribution_usd: 55000 });
    Player.update(p.id, { contribution_state: 'NOT_A_CONSTRAINT', max_annual_contribution_usd: null });
    expect(Player.get(p.id).max_annual_contribution_usd).toBeNull();
  });

  it('refuses a patch that sets a maximum on a row with no state', () => {
    const p = Player.create({ ...base, budget_range: '$20k-$25k/yr' });
    expect(() => Player.update(p.id, { max_annual_contribution_usd: 50000 })).toThrow();
  });

  it('accepts a maximum sent as a numeric string, since a JSON body may send one', () => {
    const p = Player.create({ ...base, contribution_state: 'STATED', max_annual_contribution_usd: '55000' });
    expect(Number(Player.get(p.id).max_annual_contribution_usd)).toBe(55000);
  });

  it('refuses a maximum that is not a number at all', () => {
    expect(() => Player.create({ ...base, contribution_state: 'STATED', max_annual_contribution_usd: 'lots' })).toThrow();
  });

  /** Untouched writes must not start validating a pair that is not in them. */
  it('leaves an unrelated update alone', () => {
    const p = Player.create({ ...base, contribution_state: 'STATED', max_annual_contribution_usd: 55000 });
    Player.update(p.id, { gpa: 3.4 });
    expect(Player.get(p.id).gpa).toBe(3.4);
    expect(Player.get(p.id).max_annual_contribution_usd).toBe(55000);
  });
});
