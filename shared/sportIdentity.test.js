/**
 * A7.42 — the prevention contract, tested against the pages that produced the
 * contamination and the pages that did not.
 *
 * Every fixture is a real signal captured during A7.42, not an invented one.
 * The upstream pipeline is NOT changed by this phase, so these tests target
 * the specification in this repository and claim nothing about `lib.py`.
 */
import { describe, it, expect } from 'vitest';
import { assessPageIdentity, IDENTITY, IDENTITY_ACTION } from './sportIdentity.js';

const at = (observed, requestedSeason = 2026) => assessPageIdentity({ requestedSport: 'soccer', requestedSeason, observed });

describe('the two contaminated pages are refused before any player is read', () => {
  it('Grand Canyon: wrong sport, right year', () => {
    const r = at({
      title: 'Ashley Fairbanks - Cross Country - Grand Canyon University Athletics',
      canonical: 'https://gculopes.com/sports/mens-cross-country/roster/season/2026',
      displayTitle: '2026 Cross Country Roster',
    });
    expect(r.sport).toBe(IDENTITY.CONTRADICTS);
    expect(r.season).toBe(IDENTITY.AGREES);
    expect(r.action).toBe(IDENTITY_ACTION.REFUSE);
  });

  it('Kansas State: wrong sport AND wrong season', () => {
    const r = at({
      title: "Brady Grunder - Men's Track & Field - Kansas State University Athletics",
      canonical: 'https://www.kstatesports.com/sports/mens-track-and-field/roster/season/1536',
      displayTitle: "2016 Men's Track & Field",
    });
    expect(r.sport).toBe(IDENTITY.CONTRADICTS);
    expect(r.season).toBe(IDENTITY.CONTRADICTS);
    expect(r.action).toBe(IDENTITY_ACTION.REFUSE);
    expect(r.yearsSeen).toContain('2016');
  });

  it('sport and season are independent, so either alone refuses', () => {
    // Right sport, wrong year - the case a combined verdict would let through.
    const r = at({ title: "2016 Women's Soccer Roster", displayTitle: "2016 Women's Soccer Roster" });
    expect(r.sport).toBe(IDENTITY.AGREES);
    expect(r.season).toBe(IDENTITY.CONTRADICTS);
    expect(r.action).toBe(IDENTITY_ACTION.REFUSE);
  });
});

describe('the control pages extract', () => {
  it.each([
    ['Clemson', { title: "Men's Soccer 2026-27 - Clemson University Athletics" }],
    ['Northwestern', { title: "2026 Men's Soccer Roster - Northwestern Wildcats - Official Athletics Website" }],
    ['George Mason', { title: "2026 Women's Soccer Roster - George Mason University Athletics", canonical: 'https://gomason.com/sports/womens-soccer/roster/2026' }],
    ['Utah State', { title: "2026 Women's Soccer Roster - Utah State University Athletics", canonical: 'https://utahstateaggies.com/sports/womens-soccer/roster/2026' }],
    ['Wright State', { title: "2026 Men's Soccer Roster - Wright State University Athletics", canonical: 'https://wsuraiders.com/sports/mens-soccer/roster/2026', displayTitle: "2026 Men's Soccer Roster" }],
  ])('%s agrees on sport and season', (_name, observed) => {
    const r = at(observed);
    expect(r.sport).toBe(IDENTITY.AGREES);
    expect(r.action).toBe(IDENTITY_ACTION.EXTRACT);
  });

  it('Wright State extracts despite 0% year-over-year name overlap', () => {
    /**
     * THE COUNTEREXAMPLE THAT KEEPS OVERLAP OUT OF THE GATE. Wright State went
     * 47 rows to 27 with no shared names - the same anomaly signature as the
     * two contaminated programmes - and its page is unambiguously men's
     * soccer. Overlap detects anomalies; it does not establish identity.
     */
    const r = at({ title: "2026 Men's Soccer Roster - Wright State University Athletics" });
    expect(r.action).toBe(IDENTITY_ACTION.EXTRACT);
  });
});

describe('absence of a contradiction is never agreement', () => {
  it('a page with no identity signal is REVIEW, not EXTRACT', () => {
    const r = at({});
    expect(r.sport).toBe(IDENTITY.UNKNOWN);
    expect(r.action).toBe(IDENTITY_ACTION.REVIEW);
    expect(r.reason).toMatch(/absence of a contradiction is not agreement/);
  });

  it('an unknown season does not refuse on its own', () => {
    // A live roster page often carries no year. That is not a contradiction.
    const r = at({ title: "Women's Soccer Roster - Somewhere University" });
    expect(r.season).toBe(IDENTITY.UNKNOWN);
    expect(r.action).toBe(IDENTITY_ACTION.EXTRACT);
  });

  it('a page that names NO sport is UNKNOWN, not a contradiction', () => {
    /**
     * A7.43, corrected after measuring the port against 2,060 real 2026
     * acquisitions: eight legitimate pages are simply silent about the sport.
     * "Pomona Pitzer Athletics" and "2026 Kangaroos" are real titles, and so
     * is "Men's Socccer" - a typo that spells no sport this check knows.
     * Reading silence as contradiction would have refused all eight.
     */
    for (const title of ['Pomona Pitzer Athletics', '2026 Kangaroos - Austin College Kangaroos',
      'Long Island University Athletics', "Men's Socccer 2026 - Old Dominion Athletics"]) {
      const r = at({ title });
      expect(r.sport, title).toBe(IDENTITY.UNKNOWN);
      expect(r.action, title).toBe(IDENTITY_ACTION.REVIEW);
    }
  });

  it('a page naming a foreign sport contradicts even if it also says soccer', () => {
    // A combined athletics page mentions many sports; the safe reading of an
    // ambiguous page is not "yes".
    const r = at({ title: 'Soccer and Cross Country - Athletics' });
    expect(r.sport).toBe(IDENTITY.CONTRADICTS);
  });
});

describe('none of the downstream signals may stand in for identity', () => {
  /**
   * Section 16 of the brief, as assertions. The contaminated rosters had all
   * of these looking healthy, so a validator built on them would have passed.
   * `assessPageIdentity` cannot even accept them - they are not parameters.
   */
  it('field completeness, row count, turnover and positions are not inputs', () => {
    const r = at({ title: 'Cross Country Roster' });
    expect(r.action).toBe(IDENTITY_ACTION.REFUSE);
    // The signature takes page identity only; there is nothing to pass.
    const withNoise = assessPageIdentity({
      requestedSport: 'soccer', requestedSeason: 2026,
      observed: { title: 'Cross Country Roster' },
      rowCount: 43, fieldCompleteness: 1, turnover: 1, positionsLookLikeSoccer: true,
    });
    expect(withNoise.action).toBe(IDENTITY_ACTION.REFUSE);
  });
});
