/**
 * A7.34 — an NCAA Eligibility ID is an identifier, not evidence.
 *
 * Presence of the number says somebody typed it. It is not evidence that the
 * athlete is academically eligible, certified, registered or admissible, and
 * it must not reach any scoring or eligibility decision. These tests hold that
 * boundary at the source level, because a field that leaked into a layer would
 * do so quietly and would be very hard to see in an output diff.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialEligibilityForAthlete, INITIAL_ELIGIBILITY_RESULT } from './initialEligibility.js';
import { eligibilityRuleFor, ELIGIBILITY_MODEL } from './eligibility.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELD = 'ncaa_eligibility_id';

function jsFilesUnder(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') jsFilesUnder(full, out); }
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

describe('the NCAA ID cannot reach a scoring or eligibility decision', () => {
  it.each([
    ['matchmaking', 'shared/matching'],
    ['V2 runners', 'server/lib/v2'],
    ['initial eligibility', 'shared/initialEligibility.js'],
    ['continuing eligibility', 'shared/eligibility.js'],
  ])('%s does not read the field', (_label, target) => {
    const full = path.join(ROOT, target);
    const files = full.endsWith('.js') ? [full] : jsFilesUnder(full);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => fs.readFileSync(f, 'utf8').includes(FIELD));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('initial eligibility returns the same result whatever the ID says', () => {
    for (const division of ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA', 'USCAA']) {
      const results = [null, '', 'not-an-id', '2110042886'].map((id) => initialEligibilityForAthlete({
        athlete: { origin: 'USA', [FIELD]: id }, division, asOf: '2026-09-26',
      }));
      expect(new Set(results.map((r) => r.result)).size, division).toBe(1);
      expect(new Set(results.map((r) => r.reason)).size, division).toBe(1);
    }
  });

  it('holding an ID never produces a favourable eligibility state', () => {
    const r = initialEligibilityForAthlete({
      athlete: { origin: 'USA', [FIELD]: '2110042886' }, division: 'NCAA D1', asOf: '2026-09-26',
    });
    expect(r.result).toBe(INITIAL_ELIGIBILITY_RESULT.NOT_ESTABLISHED);
    expect(r.thriv3Certifies).toBe(false);
  });

  it('continuing eligibility is likewise untouched by it', () => {
    expect(eligibilityRuleFor({ division: 'NCAA D1', season: 2026 }).model)
      .toBe(ELIGIBILITY_MODEL.NCAA_AGE_BASED_5Y);
  });
});
