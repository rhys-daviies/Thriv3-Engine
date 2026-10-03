import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from './v2Fixtures.js';

/**
 * The V2 fixtures must BE the frozen baseline's fixtures, not a paraphrase.
 *
 * snapshotMatchingBaseline.js runs at module scope and exits, so it cannot be
 * imported; its fixture array is parsed out of the source instead. If that
 * parse ever fails this test fails loudly, which is the direction that matters.
 *
 * This exists because the first version of these fixtures was written from
 * memory and differed in budget band, ability, position, class year and state.
 * Every V2 diagnostic would have been describing eight people who are not the
 * eight the baseline pins.
 */
const SOURCE = path.join(new URL('.', import.meta.url).pathname, 'snapshotMatchingBaseline.js');

function baselineFixtures() {
  const src = fs.readFileSync(SOURCE, 'utf8');
  const start = src.indexOf('const FIXTURES = [');
  expect(start, 'the baseline no longer declares `const FIXTURES = [`').toBeGreaterThan(-1);
  const end = src.indexOf('\n];', start);
  expect(end, 'the baseline fixture array is not terminated as expected').toBeGreaterThan(start);
  const literal = src.slice(src.indexOf('[', start), end + 2);
  // A pure data literal, evaluated in its own scope with nothing in it.
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${literal});`)();
}

describe('the V2 fixtures against the frozen baseline', () => {
  const baseline = baselineFixtures();

  it('parses eight fixtures out of the baseline', () => {
    expect(baseline).toHaveLength(8);
  });

  it('holds exactly the same athletes, field for field', () => {
    expect(FIXTURES).toEqual(baseline);
  });

  it('states a budget band that the matching vocabulary can actually read', async () => {
    const { budgetCeiling } = await import('../../shared/matching/constants.js');
    const { budgetInterval } = await import('../../shared/matching/v2/financialRules.js');
    for (const f of FIXTURES) {
      const band = f.player.budget_range;
      expect(budgetCeiling(band), `V1 cannot read "${band}" on fixture ${f.id}`).toBeDefined();
      expect(budgetInterval(band), `V2 cannot read "${band}" on fixture ${f.id}`).not.toBeNull();
    }
  });

  it('covers both sports, both origins and both ends of the budget range', () => {
    expect(new Set(FIXTURES.map((f) => f.player.sport))).toEqual(new Set(['mens-soccer', 'womens-soccer']));
    expect(new Set(FIXTURES.map((f) => f.player.origin))).toEqual(new Set(['USA', 'International']));
    expect(FIXTURES.some((f) => f.player.budget_range === '$40k+/yr')).toBe(true);
    expect(FIXTURES.some((f) => f.player.budget_range === '$5k-$10k/yr')).toBe(true);
  });
});
