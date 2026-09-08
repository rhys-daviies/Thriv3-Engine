import { describe, it, expect } from 'vitest';
import { outreachCopyFor } from './outreachCopy.js';
import { yearPhrase, BACK_IN_DISTANCE } from './render.js';
import { SQUAD_SEASON } from '../philosophy.js';
import { REGION_RECENCY_SEASONS } from './outreachContract.js';

/**
 * HOW MUCH TO SAY, AND WHEN TO STOP.
 *
 * The claims are unchanged — J7 moved no permission, qualification, selection
 * or dedupe. What moved is the wording of three things the corpus showed were
 * saying more than the fact needed:
 *
 *   a graduating cohort listed four and five names deep, which stops reading
 *   as a fact a coach can check and starts reading as a database showing its
 *   work;
 *
 *   "back in 2024" on a claim that only qualified BECAUSE it was recent —
 *   the copy calling distant what the qualification called current;
 *
 *   "— looks like a great season" appended to 363 congratulations in
 *   identical words, which is a compliment we added to a fact we scraped.
 *
 * Everything else was left alone. A shorter sentence is not automatically a
 * better one, and the names, dates and counts that carry a reason stay.
 */

const CUR = Number(SQUAD_SEASON);
const grad = (n, names) => outreachCopyFor({
  kind: 'POSITION_GRADUATION',
  facts: { position: 'defender', count: n, classYear: 2027, names },
})?.clause;
const NAMES = ['Davide Luppi', 'Samuel Dundas', 'Pierre Coat', 'Pontus Schmitz Gustafsson', 'Tim Haeussermann'];

describe('a graduating cohort names up to three, then counts', () => {
  it('names one', () => {
    expect(grad(1, ['Davide Luppi']))
      .toBe('one defender is listed to graduate in 2027 — Davide Luppi');
  });

  it('names two', () => {
    expect(grad(2, NAMES.slice(0, 2)))
      .toBe('two defenders are listed to graduate in 2027 — Davide Luppi and Samuel Dundas');
  });

  it('names three — still the complete list', () => {
    expect(grad(3, NAMES.slice(0, 3)))
      .toBe('three defenders are listed to graduate in 2027 — Davide Luppi, Samuel Dundas and Pierre Coat');
  });

  it('stops listing at four and says so', () => {
    expect(grad(4, NAMES.slice(0, 4)))
      .toBe('four defenders are listed to graduate in 2027, including Davide Luppi and Samuel Dundas');
  });

  it('stops listing at five too', () => {
    expect(grad(5, NAMES))
      .toBe('five defenders are listed to graduate in 2027, including Davide Luppi and Samuel Dundas');
  });

  /**
   * THE PUNCTUATION IS THE TRUTH CLAIM.
   *
   * An em-dash list says "these are all of them". "including" says "here are
   * some". A truncated list under an em-dash would tell a coach four players
   * are leaving and then name two of them as though that were the cohort.
   */
  it('never implies a truncated list is the whole cohort', () => {
    for (const n of [4, 5]) {
      const out = grad(n, NAMES.slice(0, n));
      expect(out, `n=${n}`).toContain('including');
      expect(out, `n=${n}`).not.toContain('—');
      // And the names shown are from the counted cohort, not invented.
      for (const shown of NAMES.slice(0, 2)) expect(out).toContain(shown);
    }
    for (const n of [1, 2, 3]) {
      const out = grad(n, NAMES.slice(0, n));
      expect(out, `n=${n}`).toContain('—');
      expect(out, `n=${n}`).not.toContain('including');
      // The complete form shows every name it counted.
      for (const shown of NAMES.slice(0, n)) expect(out).toContain(shown);
    }
  });

  it('keeps the count and the date, which carry the reason', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const out = grad(n, NAMES.slice(0, n));
      expect(out, `n=${n}`).toContain('2027');
      expect(out, `n=${n}`).toMatch(/one|two|three|four|five/);
    }
  });

  it('agrees its verb and noun with the count', () => {
    expect(grad(1, NAMES.slice(0, 1))).toContain('one defender is');
    expect(grad(2, NAMES.slice(0, 2))).toContain('two defenders are');
  });

  it('still refuses an object with no names at all', () => {
    const call = (names) => outreachCopyFor({
      kind: 'POSITION_GRADUATION',
      facts: { position: 'defender', count: 2, classYear: 2027, names },
    });
    expect(call([])).toBe(null);
    expect(call(['', '  '])).toBe(null);
  });
});

describe('"back in" marks a fact that is genuinely old', () => {
  it('is three seasons, not two', () => {
    expect(BACK_IN_DISTANCE).toBe(3);
  });

  it('never calls a season distant that a recency window admits', () => {
    /**
     * The contradiction this fixes. J3 lets the regional hook open an email
     * only if the arrival is inside REGION_RECENCY_SEASONS, and the copy then
     * called the oldest admitted season "back in".
     */
    for (let back = 0; back <= REGION_RECENCY_SEASONS; back += 1) {
      expect(yearPhrase(CUR - back), `${CUR - back}`).toBe(`in ${CUR - back}`);
    }
  });

  it('still says it for a season outside any window', () => {
    expect(yearPhrase(CUR - 3)).toBe(`back in ${CUR - 3}`);
    expect(yearPhrase(CUR - 4)).toBe(`back in ${CUR - 4}`);
  });

  it('says nothing at all for a missing season', () => {
    for (const v of [null, undefined, '', '  ', 'soon']) expect(yearPhrase(v), String(v)).toBe('');
  });

  it('reaches the arrival clauses that carry a named season', () => {
    const arrival = (season) => outreachCopyFor({
      kind: 'COACH_ARRIVAL_SAME_COUNTRY',
      facts: { coach: 'Sam Baker', country: 'New Zealand', count: 1, seasons: [String(season)], namedArrival: 'Theo Gorman', namedArrivalSeason: String(season) },
    }).clause;
    expect(arrival(CUR - 2)).toBe(`you brought Theo Gorman in from New Zealand in ${CUR - 2}`);
    expect(arrival(CUR - 3)).toBe(`you brought Theo Gorman in from New Zealand back in ${CUR - 3}`);
  });
});

describe('a congratulation congratulates, and stops', () => {
  it('says the conference and nothing about the season', () => {
    expect(outreachCopyFor({ kind: 'CONFERENCE_TITLE', facts: { conference: 'NEWMAC' } }).recognition)
      .toBe('Congrats on winning the NEWMAC last year.');
  });

  it('has dropped the appended compliment', () => {
    const out = outreachCopyFor({ kind: 'CONFERENCE_TITLE', facts: { conference: 'ACC' } }).recognition;
    expect(out).not.toContain('looks like');
    expect(out).not.toContain('great season');
  });

  it('leaves the postseason rounds exactly as they were', () => {
    // Seven branches, all correct soccer terminology, none of them flagged.
    const round = (r) => outreachCopyFor({ kind: 'POSTSEASON_RESULT', facts: { round: r } }).recognition;
    expect(round('champion')).toBe('Congrats on the national title last season.');
    expect(round('final')).toBe('Congrats on reaching the national final last season.');
    expect(round('r16')).toBe('Congrats on reaching the round of 16 last season.');
    expect(round('appearance')).toBe('Congrats on getting to the postseason last season.');
  });
});

describe('the clauses J7 judged strong are untouched', () => {
  it('leaves the named compatriot claims alone', () => {
    expect(outreachCopyFor({
      kind: 'HISTORICAL_SAME_COUNTRY',
      facts: { country: 'New Zealand', count: 1, names: ['Sam Philip'], seasons: [String(CUR - 4)] },
    }).clause).toBe(`Sam Philip came through the programme from New Zealand back in ${CUR - 4}`);
  });

  it('leaves the current-roster claim alone', () => {
    expect(outreachCopyFor({
      kind: 'CURRENT_SAME_COUNTRY',
      facts: { country: 'New Zealand', count: 1, names: ['Louis Spillane'] },
    }).clause).toBe('Louis Spillane, from New Zealand, is on your roster this season');
  });

  it('keeps both academic vocabularies apart', () => {
    const out = outreachCopyFor({
      kind: 'ACADEMIC_FIT',
      facts: { athleteStatedMajor: 'exercise science', programmeMatchedSubject: 'Kinesiology' },
    }, { firstName: 'Rhys' }).clause;
    expect(out).toBe('Rhys is looking to study Exercise Science, and Kinesiology is among the programmes you list');
    expect(out).not.toMatch(/looking to study Kinesiology/);
  });

  it('still says the regional cut is wider than the athlete\'s country', () => {
    expect(outreachCopyFor({
      kind: 'ARRIVAL_SAME_REGION_POSITION',
      facts: { countries: ['Australia'], position: 'forward', count: 1, seasons: [String(CUR - 2)], excludingCountry: 'New Zealand', widerThanOwnCountry: true },
    }).clause).toBe(`the programme has taken one forward from Australia in ${CUR - 2} — the same part of the world`);
  });

  it('still refuses malformed facts outright', () => {
    for (const kind of ['POSITION_GRADUATION', 'CONFERENCE_TITLE', 'ACADEMIC_FIT']) {
      expect(outreachCopyFor({ kind, facts: {} }), kind).toBe(null);
      expect(outreachCopyFor({ kind }), kind).toBe(null);
    }
  });
});
