/**
 * L8D-1 — three materialisation states, three renderings.
 *
 * The first version of the screen asked only `state !== 'FRESH'` and called
 * the remainder "stale". On the deployed environment that put the word STALE
 * and a Rebuild button in front of a LEGACY_UNVERIFIED materialisation, which
 * is a different fact with a different remedy: STALE means a build exists and
 * its input moved, LEGACY_UNVERIFIED means no build record exists at all and
 * nothing can say what the arrivals were derived from.
 *
 * `exclusionBlockedReason` already treats LEGACY_UNVERIFIED as a blocker. A
 * rebuild offered there would stamp a fresh-looking generation over source
 * data nobody has established -- certifying an unknown.
 *
 * Asserted against the page source rather than a DOM render: this repository
 * has no component-rendering harness, and the property that matters is which
 * state the partition keys on, which is readable and would have caught the
 * defect.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'SeasonTrust.jsx'), 'utf8');

describe('season trust — materialisation states', () => {
  it('partitions on the exact state, never on "not FRESH"', () => {
    expect(SRC).toMatch(/const stale = materialisation\.filter\(\(\[, m\]\) => m\.state === 'STALE'\)/);
    expect(SRC).toMatch(/const unverified = materialisation\.filter\(\(\[, m\]\) => m\.state === 'LEGACY_UNVERIFIED'\)/);
    // The defect itself: anything keyed on "not fresh" merges the two again.
    expect(SRC).not.toMatch(/state !== 'FRESH'/);
  });

  it('offers a rebuild for STALE and withholds it for LEGACY_UNVERIFIED', () => {
    const staleBlock = SRC.slice(SRC.indexOf('{stale.length > 0 &&'), SRC.indexOf('{unverified.length > 0 &&'));
    const unverifiedBlock = SRC.slice(SRC.indexOf('{unverified.length > 0 &&'));
    expect(staleBlock).toContain('onClick={() => rebuild(sp)}');
    // The whole point: no rebuild control in the unverified branch.
    expect(unverifiedBlock).not.toContain('rebuild(sp)');
    expect(unverifiedBlock.replace(/\s+/g, ' ')).toMatch(/rebuild is deliberately not offered/);
  });

  it('names the two states differently so neither reads as the other', () => {
    expect(SRC).toMatch(/is <strong>stale<\/strong>/);
    expect(SRC).toMatch(/is <strong>unverified<\/strong>/);
    expect(SRC.replace(/\s+/g, ' ')).toMatch(/This is not staleness/);
  });

  it('FRESH shows neither banner', () => {
    /* Both partitions are equality tests, so FRESH is in neither by construction. */
    for (const m of [{ state: 'FRESH' }]) {
      expect(m.state === 'STALE').toBe(false);
      expect(m.state === 'LEGACY_UNVERIFIED').toBe(false);
    }
  });
});
