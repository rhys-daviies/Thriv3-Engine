import { describe, it, expect } from 'vitest';
import { outreachCopyFor, OUTREACH_COPY_KINDS } from './outreachCopy.js';
import { outreachEvidenceFor, LICENSED_KINDS } from './outreachEvidence.js';
import { defineEvidence, CONFIDENCE, permissionsFor, PERMISSION } from './kinds.js';

/**
 * The outbound copy contract, made real.
 *
 * The module has always PROMISED that a clause returns null rather than a
 * weaker sentence. Until H1 it did not: eight of the ten entries interpolated
 * whatever they were handed, so an object missing a field produced "you've
 * brought undefined players in from undefined". Nothing live reached it — 0 of
 * 1,459 licensed items were short a field — but the guarantee was a comment,
 * and `count` was read by seven entries while required by none of the
 * selector's rules. Two lists that had to agree, with nothing keeping them in
 * step: the same shape as `canLead` and `emailEligible` before them.
 *
 * So this suite asserts the promise twice over. The selector refuses a
 * malformed object, AND the copy refuses to write one — independently, because
 * two modules agreeing today is not a guarantee.
 */

const src = { source: 'roster_players', confidence: CONFIDENCE.HIGH };
const ctx = { firstName: 'Rhys' };
const say = (kind, facts) => outreachCopyFor({ kind, facts }, ctx);
const text = (out) => (out ? out.clause ?? out.recognition : null);

/** A complete, well-formed fact set per kind — the shape live data produces. */
const GOOD = {
  COACH_ARRIVAL_SAME_COUNTRY: { coach: 'Ali Simmons', country: 'New Zealand', count: 1, seasons: ['2025'], namedArrival: 'Hayden Aish', namedArrivalSeason: '2025' },
  ARRIVAL_SAME_COUNTRY_POSITION: { country: 'New Zealand', position: 'DEFENSE', count: 2, seasons: ['2023'] },
  HISTORICAL_SAME_COUNTRY: { country: 'New Zealand', count: 2, names: ['A', 'B'], seasons: ['2022'] },
  CURRENT_SAME_COUNTRY: { country: 'New Zealand', count: 1, names: ['A'] },
  ARRIVAL_SAME_REGION_POSITION: { countries: ['Australia'], position: 'DEFENSE', count: 1, seasons: ['2024'], widerThanOwnCountry: true, excludingCountry: 'New Zealand' },
  HISTORICAL_SAME_REGION: { countries: ['Australia'], count: 1, names: ['X'], widerThanOwnCountry: true, excludingCountry: 'New Zealand' },
  POSITION_GRADUATION: { position: 'DEFENSE', count: 3, names: ['A', 'B', 'C'], classYear: 2027 },
  ACADEMIC_FIT: { athleteStatedMajor: 'exercise science', programmeMatchedSubject: 'Kinesiology' },
  CONFERENCE_TITLE: { conference: 'ACC' },
  POSTSEASON_RESULT: { round: 'semi' },
};

/** The fields each clause interpolates and therefore must refuse without. */
const REQUIRED = {
  COACH_ARRIVAL_SAME_COUNTRY: ['country', 'count'],
  ARRIVAL_SAME_COUNTRY_POSITION: ['country', 'position', 'count'],
  HISTORICAL_SAME_COUNTRY: ['country', 'count'],
  CURRENT_SAME_COUNTRY: ['country', 'count'],
  ARRIVAL_SAME_REGION_POSITION: ['countries', 'position', 'count'],
  HISTORICAL_SAME_REGION: ['countries', 'count'],
  POSITION_GRADUATION: ['position', 'count', 'names', 'classYear'],
  ACADEMIC_FIT: ['athleteStatedMajor', 'programmeMatchedSubject'],
  CONFERENCE_TITLE: ['conference'],
  POSTSEASON_RESULT: ['round'],
};

// ---------------------------------------------------------------------------

describe('the copy registry covers exactly the licence', () => {
  it('has words for all ten licensed kinds and nothing else', () => {
    expect([...OUTREACH_COPY_KINDS].sort()).toEqual([...LICENSED_KINDS].sort());
    expect(OUTREACH_COPY_KINDS).toHaveLength(10);
  });

  it('writes a sentence for every one of them when the facts are whole', () => {
    // Non-vacuity for everything below: these all say something.
    for (const kind of OUTREACH_COPY_KINDS) {
      const out = text(say(kind, GOOD[kind]));
      expect(out, kind).toBeTruthy();
      expect(out.length, kind).toBeGreaterThan(10);
    }
  });

  it('names every required field it interpolates', () => {
    // The list above is the contract the selector must guarantee. Asserted so
    // that adding an interpolation without a guard fails here rather than in
    // an inbox.
    expect(Object.keys(REQUIRED).sort()).toEqual([...OUTREACH_COPY_KINDS].sort());
  });
});

describe('every handler fails closed', () => {
  it('returns null for all ten on empty facts', () => {
    for (const kind of OUTREACH_COPY_KINDS) expect(say(kind, {}), kind).toBeNull();
  });

  it('returns null when any single required field is missing', () => {
    for (const [kind, fields] of Object.entries(REQUIRED)) {
      for (const field of fields) {
        const facts = { ...GOOD[kind] };
        delete facts[field];
        expect(say(kind, facts), `${kind} without ${field}`).toBeNull();
      }
    }
  });

  it('refuses an empty string, a blank string and a null', () => {
    for (const [kind, fields] of Object.entries(REQUIRED)) {
      for (const field of fields) {
        for (const bad of ['', '   ', null, undefined]) {
          expect(say(kind, { ...GOOD[kind], [field]: bad }), `${kind}.${field}=${JSON.stringify(bad)}`)
            .toBeNull();
        }
      }
    }
  });

  it('refuses an empty or null array where a list is needed', () => {
    for (const kind of ['ARRIVAL_SAME_REGION_POSITION', 'HISTORICAL_SAME_REGION']) {
      for (const bad of [[], null, [''], ['   '], 'Australia']) {
        expect(say(kind, { ...GOOD[kind], countries: bad }), `${kind} countries=${JSON.stringify(bad)}`)
          .toBeNull();
      }
    }
    for (const bad of [[], null, ['']]) {
      expect(say('POSITION_GRADUATION', { ...GOOD.POSITION_GRADUATION, names: bad })).toBeNull();
    }
  });

  it('refuses a count of zero, a negative, a fraction and a string', () => {
    // Zero is the interesting one: "zero players from New Zealand have come
    // through the programme" is grammatical, true of most programmes, and not
    // a reason to write to anybody.
    for (const kind of Object.keys(REQUIRED).filter((k) => REQUIRED[k].includes('count'))) {
      for (const bad of [0, -1, 1.5, '2', NaN, null]) {
        expect(say(kind, { ...GOOD[kind], count: bad }), `${kind} count=${bad}`).toBeNull();
      }
    }
  });

  it('refuses a position the registry does not recognise', () => {
    for (const kind of ['ARRIVAL_SAME_COUNTRY_POSITION', 'ARRIVAL_SAME_REGION_POSITION', 'POSITION_GRADUATION']) {
      for (const bad of ['STRIKER_ISH', 'UNKNOWN', '', null]) {
        expect(say(kind, { ...GOOD[kind], position: bad }), `${kind} position=${bad}`).toBeNull();
      }
    }
  });

  it('never emits undefined, null, NaN or dangling punctuation, whatever it is given', () => {
    /**
     * The failure this whole file exists to prevent, swept rather than
     * enumerated: every kind against every partial combination of its required
     * fields. A sentence either says everything it needs to or is not written.
     */
    for (const [kind, fields] of Object.entries(REQUIRED)) {
      for (let mask = 0; mask < (1 << fields.length); mask += 1) {
        const facts = { ...GOOD[kind] };
        fields.forEach((f, i) => { if (!(mask & (1 << i))) delete facts[f]; });
        const out = text(say(kind, facts));
        if (out === null) continue;
        expect(out, `${kind} mask ${mask}`).not.toMatch(/undefined|null|NaN|\[object|,\s*,|\s{2,}| — $|study ,/);
        expect(out.trim(), `${kind} mask ${mask}`).toBe(out);
      }
    }
  });

  it('does not depend on a first name it was not given', () => {
    expect(text(outreachCopyFor({ kind: 'ACADEMIC_FIT', facts: GOOD.ACADEMIC_FIT }, {})))
      .toBe('the athlete is looking to study Exercise Science, and Kinesiology is among the programmes you list');
  });

  it('returns null for a kind it has never heard of', () => {
    expect(say('POSITION_GROUP_SCARCITY', { position: 'DEFENSE', count: 3 })).toBeNull();
    expect(outreachCopyFor(null, ctx)).toBeNull();
    expect(outreachCopyFor({}, ctx)).toBeNull();
  });
});

describe('the selector refuses the same objects, before copy is reached', () => {
  /**
   * Defence in depth, and the reason both layers check. The selector's rules
   * and the copy's guards are two lists over the same fields; if they ever
   * drift, the survivor of one is refused by the other and the email loses a
   * sentence rather than gaining a broken one.
   */
  const DATA = {
    COACH_ARRIVAL_SAME_COUNTRY: { coach: 'X', country: 'New Zealand', count: 2, seasons: ['2025'] },
    ARRIVAL_SAME_COUNTRY_POSITION: { country: 'New Zealand', position: 'DEFENSE', count: 2, seasons: ['2023'] },
    HISTORICAL_SAME_COUNTRY: { country: 'New Zealand', count: 2, names: ['A'], seasons: ['2022'] },
    CURRENT_SAME_COUNTRY: { country: 'New Zealand', count: 1, names: ['A'] },
    ARRIVAL_SAME_REGION_POSITION: { countries: ['Australia'], position: 'DEFENSE', count: 1, seasons: ['2024'], athleteCountry: 'New Zealand' },
    HISTORICAL_SAME_REGION: { countries: ['Australia'], athleteCountry: 'New Zealand', count: 1, names: ['X'] },
    POSITION_GRADUATION: { position: 'DEFENSE', count: 3, names: ['A', 'B', 'C'], classYear: 2027 },
    ACADEMIC_FIT: { stated: 'exercise science', major: 'Kinesiology' },
    CONFERENCE_TITLE: { conference: 'ACC' },
    POSTSEASON_RESULT: { round: 'semi' },
  };
  const one = (kind, data) => outreachEvidenceFor({
    all: [defineEvidence(kind, { ...src, season: '2026', data })],
  });
  const kinds = (r) => [...r.hooks, ...r.relevance, ...r.recognition].map((x) => x.kind);

  it('accepts each well-formed object', () => {
    for (const kind of Object.keys(DATA)) expect(kinds(one(kind, DATA[kind])), kind).toEqual([kind]);
  });

  it('drops one whose count is missing or zero, for every kind that states a count', () => {
    // `count` was the measured gap: read by seven clauses, required by none of
    // the rules.
    for (const kind of Object.keys(DATA).filter((k) => REQUIRED[k].includes('count'))) {
      expect(kinds(one(kind, { ...DATA[kind], count: undefined })), kind).toEqual([]);
      expect(kinds(one(kind, { ...DATA[kind], count: 0 })), kind).toEqual([]);
    }
  });

  it('drops a graduation claim with no position', () => {
    // The other measured gap: the rule checked names and classYear only.
    expect(kinds(one('POSITION_GRADUATION', { ...DATA.POSITION_GRADUATION, position: null }))).toEqual([]);
  });

  it('leaves the permission grades exactly where G4 put them', () => {
    // Hardening a rule must not quietly reclassify a kind.
    const by = { ALLOWED: 0, QUALIFIED: 0, DENIED: 0 };
    for (const kind of LICENSED_KINDS) by[permissionsFor(kind).OUTREACH] += 1;
    expect(by.ALLOWED).toBe(4);
    expect(by.QUALIFIED).toBe(6);
    expect(permissionsFor('COACH_ARRIVAL_SAME_COUNTRY').OUTREACH).toBe(PERMISSION.ALLOWED);
    expect(permissionsFor('POSITION_GRADUATION').OUTREACH).toBe(PERMISSION.QUALIFIED);
  });
});
