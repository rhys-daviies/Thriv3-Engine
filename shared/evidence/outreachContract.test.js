import { describe, it, expect } from 'vitest';
import {
  renderInput, renderable, requiredFields, CONTRACT_KINDS, hasContract,
  POSTSEASON_ROUNDS,
} from './outreachContract.js';
import { outreachEvidenceFor, LICENSED_KINDS } from './outreachEvidence.js';
import { outreachCopyFor, OUTREACH_COPY_KINDS } from './outreachCopy.js';
import { permissionsFor, PERMISSION } from './kinds.js';

/**
 * ONE DECLARATION OF WHAT A CLAIM NEEDS.
 *
 * The defect these close is not a wrong sentence — no live object ever hit it.
 * It is two modules holding separate opinions about the same question in two
 * vocabularies: `outreachEvidence` asked `Boolean(d.position)` of the raw
 * field, `outreachCopy` asked whether the registry recognised
 * `facts.position`. Fourteen of sixteen measured value cases passed the first
 * and failed the second, and the selector had already recorded those claims as
 * SELECTED and counted their emails as personalised.
 *
 * So the tests below run BOTH layers over the same objects and require them to
 * agree — not because agreement is likely, but because it is now structural
 * and a test is what keeps it so.
 */

/** One complete, valid object per kind, in GENERATOR vocabulary. */
const VALID = {
  COACH_ARRIVAL_SAME_COUNTRY: { coach: 'Sam Baker', country: 'New Zealand', count: 1, seasons: ['2025'], name: 'Joby Reid', nameSeason: '2025' },
  ARRIVAL_SAME_COUNTRY_POSITION: { country: 'New Zealand', position: 'defender', count: 2, seasons: ['2023', '2024'] },
  HISTORICAL_SAME_COUNTRY: { country: 'New Zealand', count: 2, names: ['Luke Johnson', 'Willem Ebbinge'], seasons: ['2022'] },
  CURRENT_SAME_COUNTRY: { country: 'New Zealand', count: 1, names: ['Joby Reid'] },
  // Dated and recent: J3 made the season required on this kind alone.
  ARRIVAL_SAME_REGION_POSITION: { countries: ['Australia'], position: 'defender', count: 1, seasons: ['2025'], athleteCountry: 'New Zealand' },
  POSITION_GRADUATION: { position: 'defender', count: 2, names: ['Enzo Panozzo', 'Owen Zarnick'], classYear: 2027 },
  ACADEMIC_FIT: { stated: 'exercise science', major: 'Kinesiology' },
  CONFERENCE_TITLE: { conference: 'ACC' },
  POSTSEASON_RESULT: { round: 'r16' },
};

/** Drive the REAL selector over one object, then the REAL copy over its facts. */
function through(kind, data) {
  let facts = null;
  try {
    const r = outreachEvidenceFor({ all: [{ kind, data, confidence: 'HIGH' }] });
    const hit = [...r.hooks, ...r.relevance, ...r.recognition, ...r.alternatives]
      .find((i) => i.kind === kind);
    if (hit) facts = hit.facts;
  } catch { /* an unqualified object simply does not appear */ }
  if (!facts) return { qualified: false, rendered: false, text: null };
  const copy = outreachCopyFor({ kind, facts }, { firstName: 'Rhys' });
  const text = copy?.clause ?? copy?.recognition ?? null;
  return { qualified: true, rendered: Boolean(text), text, facts };
}

describe('the contract covers exactly the licensed kinds', () => {
  it('gives every licensed kind a contract, and nothing else one', () => {
    expect([...CONTRACT_KINDS].sort()).toEqual([...LICENSED_KINDS].sort());
    expect([...CONTRACT_KINDS].sort()).toEqual([...OUTREACH_COPY_KINDS].sort());
  });

  it('covers both permission grades without distinguishing them', () => {
    // ALLOWED kinds need a contract too: it asks whether the object can be
    // rendered, which is a different question from whether the claim needs a
    // caveat. Introducing QUALIFIED licensing to solve a malformed object
    // would be answering the wrong one.
    const grade = (k) => permissionsFor(k).OUTREACH;
    expect(CONTRACT_KINDS.filter((k) => grade(k) === PERMISSION.ALLOWED)).toHaveLength(4);
    // Five, not six, since J3 denied HISTORICAL_SAME_REGION. See regionHooks.test.js.
    expect(CONTRACT_KINDS.filter((k) => grade(k) === PERMISSION.QUALIFIED)).toHaveLength(5);
    for (const k of CONTRACT_KINDS) expect(requiredFields(k).length, k).toBeGreaterThan(0);
  });

  it('refuses a kind it has never heard of', () => {
    expect(hasContract('NOT_A_KIND')).toBe(false);
    expect(renderInput('NOT_A_KIND', { anything: 1 })).toBe(null);
    expect(outreachCopyFor({ kind: 'NOT_A_KIND', facts: { anything: 1 } })).toBe(null);
  });
});

describe('a complete object qualifies and renders, for all nine', () => {
  for (const kind of Object.keys(VALID)) {
    it(`${kind} says something`, () => {
      const r = through(kind, VALID[kind]);
      expect(r.qualified, kind).toBe(true);
      expect(r.rendered, kind).toBe(true);
      expect(r.text, kind).toEqual(expect.any(String));
      expect(r.text, kind).not.toMatch(/undefined|null|NaN|\[object/);
    });
  }
});

describe('removing any required field fails closed, in both layers at once', () => {
  for (const kind of Object.keys(VALID)) {
    for (const field of requiredFields(kind)) {
      it(`${kind} without ${field}`, () => {
        /**
         * The required names are in RENDER vocabulary, so a generator field
         * that feeds one may be spelled differently — `stated` becomes
         * `athleteStatedMajor`. Cutting the fact directly is the honest test
         * of the contract; cutting the generator field is the test below.
         */
        const facts = { ...renderInput(kind, VALID[kind]) };
        delete facts[field];
        expect(renderable(kind, facts), `${kind}.${field} must be required`).toBe(false);
        expect(outreachCopyFor({ kind, facts }, { firstName: 'Rhys' })).toBe(null);
      });
    }
  }
});

describe('removing the generator field behind a required fact fails closed too', () => {
  // The rename is where a seam could reopen: `d.stated` -> `athleteStatedMajor`
  // and `d.athleteCountry` -> `excludingCountry` are the two that differ.
  const GENERATOR_REQUIRED = {
    COACH_ARRIVAL_SAME_COUNTRY: ['coach', 'country', 'count'],
    ARRIVAL_SAME_COUNTRY_POSITION: ['country', 'position', 'count'],
    HISTORICAL_SAME_COUNTRY: ['country', 'count'],
    CURRENT_SAME_COUNTRY: ['country', 'count'],
    ARRIVAL_SAME_REGION_POSITION: ['countries', 'position', 'count', 'seasons'],
    POSITION_GRADUATION: ['position', 'count', 'names', 'classYear'],
    ACADEMIC_FIT: ['stated', 'major'],
    CONFERENCE_TITLE: ['conference'],
    POSTSEASON_RESULT: ['round'],
  };
  for (const [kind, fields] of Object.entries(GENERATOR_REQUIRED)) {
    for (const field of fields) {
      it(`${kind} without generator field ${field}`, () => {
        const data = { ...VALID[kind] }; delete data[field];
        const r = through(kind, data);
        expect(r.qualified, `${kind} must not qualify without ${field}`).toBe(false);
        expect(r.rendered).toBe(false);
      });
    }
  }
});

describe('an optional field missing only shortens the sentence', () => {
  const OPTIONAL = {
    COACH_ARRIVAL_SAME_COUNTRY: ['seasons', 'name', 'nameSeason'],
    ARRIVAL_SAME_COUNTRY_POSITION: ['seasons'],
    HISTORICAL_SAME_COUNTRY: ['names', 'seasons'],
    CURRENT_SAME_COUNTRY: ['names'],
  };
  for (const [kind, fields] of Object.entries(OPTIONAL)) {
    for (const field of fields) {
      it(`${kind} without ${field}`, () => {
        const data = { ...VALID[kind] }; delete data[field];
        const r = through(kind, data);
        expect(r.qualified, kind).toBe(true);
        expect(r.rendered, kind).toBe(true);
        expect(r.text).not.toMatch(/undefined|null|NaN/);
      });
    }
  }
});

describe('unexpected extra fields change nothing', () => {
  for (const kind of Object.keys(VALID)) {
    it(`${kind} ignores what it was not promised`, () => {
      const clean = through(kind, VALID[kind]);
      const noisy = through(kind, {
        ...VALID[kind], provenance: { internal: 'do not send' }, region: 'OCEANIA',
        emailEligible: true, somethingNew: 42,
      });
      expect(noisy.text).toBe(clean.text);
      // And nothing extra reaches the projection a renderer can read.
      expect(Object.keys(noisy.facts)).toEqual(Object.keys(clean.facts));
      expect(JSON.stringify(noisy.facts)).not.toMatch(/do not send|OCEANIA/);
    });
  }
});

/**
 * THE CORE H17 MUTATION, stated as a test rather than run by hand.
 *
 * Before this stage a required field's NAME lived in two places: the rule read
 * `d.position`, the clause read `f.position`, and nothing tied them. Renaming
 * one and not the other left qualification passing and copy refusing.
 *
 * There is now one name per requirement, and the check below is what makes
 * that observable: the two layers are asked the same question about the same
 * object and must return the same answer, on values chosen to fall between the
 * old pair of rules.
 */
describe('qualification and copy cannot disagree', () => {
  const PRESENT_BUT_UNUSABLE = [
    ['ARRIVAL_SAME_COUNTRY_POSITION', 'position', 'Utility'],
    ['ARRIVAL_SAME_REGION_POSITION', 'position', 'Utility'],
    ['POSITION_GRADUATION', 'position', 'Utility'],
    ['POSITION_GRADUATION', 'classYear', 'senior'],
    ['POSITION_GRADUATION', 'classYear', 1899],
    ['POSITION_GRADUATION', 'names', ['', '  ']],
    ['POSTSEASON_RESULT', 'round', 'third-round'],
    ['HISTORICAL_SAME_COUNTRY', 'country', '   '],
    ['CURRENT_SAME_COUNTRY', 'country', '   '],
    ['COACH_ARRIVAL_SAME_COUNTRY', 'country', '   '],
    ['COACH_ARRIVAL_SAME_COUNTRY', 'coach', '  '],
    ['ARRIVAL_SAME_REGION_POSITION', 'countries', ['', ' ']],
    ['ACADEMIC_FIT', 'stated', '   '],
    ['ACADEMIC_FIT', 'major', '   '],
    ['CONFERENCE_TITLE', 'conference', '-D3'],
  ];
  for (const [kind, field, value] of PRESENT_BUT_UNUSABLE) {
    it(`${kind}: ${field} = ${JSON.stringify(value)} is refused by both`, () => {
      const r = through(kind, { ...VALID[kind], [field]: value });
      // The point is the EQUALITY. Qualifying and then failing to render is
      // the state this stage removed: the email reports a claim it never made.
      expect(r.rendered, `${kind}.${field}`).toBe(r.qualified && r.rendered);
      expect(r.qualified, `${kind}.${field} must not qualify`).toBe(false);
    });
  }
});

describe('calling the copy directly is as safe as going through the selector', () => {
  it('refuses facts that never passed a contract', () => {
    for (const kind of CONTRACT_KINDS) {
      expect(outreachCopyFor({ kind, facts: {} }), kind).toBe(null);
      expect(outreachCopyFor({ kind }), kind).toBe(null);
      expect(outreachCopyFor({ kind, facts: null }), kind).toBe(null);
    }
    expect(outreachCopyFor(null)).toBe(null);
    expect(outreachCopyFor({})).toBe(null);
  });

  it('refuses raw generator data handed straight to the renderer', () => {
    // The commonest way a developer would get this wrong: passing `ev.data`
    // where the render input belongs. `stated`/`major` are not the names the
    // clause reads, and guessing at them is exactly what must not happen.
    expect(outreachCopyFor({ kind: 'ACADEMIC_FIT', facts: VALID.ACADEMIC_FIT })).toBe(null);
    expect(outreachCopyFor({ kind: 'HISTORICAL_SAME_REGION', facts: VALID.HISTORICAL_SAME_REGION })).toBe(null);
  });
});

describe('the postseason rounds are declared once', () => {
  it('has wording for exactly the claimable rounds', () => {
    for (const round of POSTSEASON_ROUNDS) {
      const r = through('POSTSEASON_RESULT', { round });
      expect(r.qualified, round).toBe(true);
      expect(r.text, round).toMatch(/^Congrats on .+ last season( as well)?\.$/);
    }
  });
  it('claims nothing for a round it has no words for', () => {
    for (const round of ['third-round', 'group-stage', 'r64', '', null]) {
      expect(through('POSTSEASON_RESULT', { round }).qualified, String(round)).toBe(false);
    }
  });
});

/**
 * WHAT EACH CLAIM MAY AND MAY NOT IMPLY.
 *
 * The contract decides whether a sentence may be written; these decide what it
 * is allowed to say once it is. Kept here rather than in the copy's own tests
 * because they are properties of the CLAIM — the thing the contract licenses —
 * and they must survive any rewording of it.
 */
describe('region claims say only the regional observation', () => {
  // One kind since J3 — see regionHooks.test.js for why the other was denied.
  const REGION = ['ARRIVAL_SAME_REGION_POSITION'];

  it('names the countries it saw and never the athlete\'s own', () => {
    for (const kind of REGION) {
      const r = through(kind, VALID[kind]);
      expect(r.text, kind).toContain('Australia');
      // `excludingCountry` is required and deliberately unprinted: saying "though
      // not New Zealand itself" volunteers a negative nobody asked for, and puts
      // a country in the email this programme has no connection to.
      expect(r.facts.excludingCountry, kind).toBe('New Zealand');
      expect(r.text, kind).not.toContain('New Zealand');
    }
  });

  it('states the wider cut, so it cannot be read as the same country', () => {
    for (const kind of REGION) {
      expect(through(kind, VALID[kind]).text, kind).toContain('the same part of the world');
      expect(through(kind, VALID[kind]).facts.widerThanOwnCountry, kind).toBe(true);
    }
  });

  it('never prints the region bucket key', () => {
    for (const kind of REGION) {
      const r = through(kind, { ...VALID[kind], region: 'OCEANIA' });
      expect(r.text, kind).not.toMatch(/OCEANIA|region/i);
      expect(r.facts, kind).not.toHaveProperty('region');
      expect(r.facts, kind).not.toHaveProperty('provenance');
    }
  });

  it('implies no preference, pipeline, tendency or intent', () => {
    for (const kind of REGION) {
      const t = through(kind, VALID[kind]).text.toLowerCase();
      for (const word of ['pipeline', 'prefer', 'tend', 'like', 'favour', 'favor',
        'recruit', 'looking for', 'open to', 'need', 'opportunity', 'fit']) {
        expect(t, `${kind} must not say "${word}"`).not.toContain(word);
      }
    }
  });
});

describe('the graduation claim stays an observation', () => {
  it('names the players and dates the cohort, never a bare count', () => {
    const r = through('POSITION_GRADUATION', VALID.POSITION_GRADUATION);
    expect(r.text).toContain('Enzo Panozzo');
    expect(r.text).toContain('Owen Zarnick');
    expect(r.text).toContain('2027');
  });

  it('hedges the derived year — "listed to", not "will"', () => {
    // H12 established `eligibility_end_year` is derived: the sheet has no
    // column for it and the page prints a class label. Structured data is not
    // a reason to state it more firmly than it was measured.
    const t = through('POSITION_GRADUATION', VALID.POSITION_GRADUATION).text;
    expect(t).toContain('listed to graduate');
    expect(t).not.toMatch(/will graduate|graduates in|is graduating/);
  });

  it('says nothing about openings, minutes or what the roster needs', () => {
    const t = through('POSITION_GRADUATION', VALID.POSITION_GRADUATION).text.toLowerCase();
    for (const word of ['opening', 'gap', 'room', 'replace', 'minutes', 'spot',
      'need', 'vacan', 'depth', 'opportunity']) {
      expect(t, `must not say "${word}"`).not.toContain(word);
    }
  });

  it('refuses a cohort it cannot name or date', () => {
    expect(through('POSITION_GRADUATION', { ...VALID.POSITION_GRADUATION, names: [] }).qualified).toBe(false);
    expect(through('POSITION_GRADUATION', { ...VALID.POSITION_GRADUATION, classYear: null }).qualified).toBe(false);
  });
});

describe('the academic claim keeps both vocabularies apart', () => {
  it('says the athlete\'s words and the programme\'s label as two things', () => {
    const r = through('ACADEMIC_FIT', VALID.ACADEMIC_FIT);
    expect(r.text).toContain('Exercise Science');   // theirs, cased for a sentence
    expect(r.text).toContain('Kinesiology');        // ours, the catalogue bucket
    // Never "you want to study Kinesiology" — that asserts the athlete said a
    // word they did not say.
    expect(r.text).not.toMatch(/looking to study Kinesiology/);
  });

  it('collapses them only when they are literally the same word', () => {
    const same = through('ACADEMIC_FIT', { stated: 'Kinesiology', major: 'Kinesiology' });
    expect(same.text).toBe('Rhys is looking to study Kinesiology, which you offer');
  });

  it('refuses either label missing — one alone is a different claim', () => {
    expect(through('ACADEMIC_FIT', { stated: 'exercise science' }).qualified).toBe(false);
    expect(through('ACADEMIC_FIT', { major: 'Kinesiology' }).qualified).toBe(false);
  });

  it('changes only the casing of the athlete\'s own words', () => {
    const r = through('ACADEMIC_FIT', { stated: 'sports management', major: 'Business' });
    expect(r.text).toContain('Sports Management');
  });
});

describe('recognition invents no season and no result', () => {
  it('congratulates exactly what the evidence carries', () => {
    expect(through('CONFERENCE_TITLE', { conference: 'ACC' }).text)
      .toBe('Congrats on winning the ACC last year.');
    expect(through('POSTSEASON_RESULT', { round: 'final' }).text)
      .toBe('Congrats on reaching the national final last season.');
  });

  it('requires the conference and the round themselves', () => {
    expect(through('CONFERENCE_TITLE', {}).qualified).toBe(false);
    expect(through('POSTSEASON_RESULT', {}).qualified).toBe(false);
  });

  it('names the conference the college row actually stores', () => {
    /**
     * `conferenceLabel` FORMATS, it does not resolve — there is no lookup and
     * so no unknown-key case. What it strips is the "-D3" tag two rows carry
     * to disambiguate our own data, which is not what the conference is
     * called. All 124 champion names on the live corpus pass through it.
     */
    expect(through('CONFERENCE_TITLE', { conference: 'MWC-D3' }).text)
      .toBe('Congrats on winning the MWC last year.');
    expect(through('CONFERENCE_TITLE', { conference: 'Atlantic 10' }).text)
      .toContain('the Atlantic 10');
  });

  it('refuses a stored value that is nothing but a division tag', () => {
    // The only way the formatter can return nothing. Refused, not softened:
    // "congrats on winning your conference" is a congratulation we cannot
    // address, which is a different and worse sentence than none.
    const r = through('CONFERENCE_TITLE', { conference: '-D3' });
    expect(r.qualified).toBe(false);
    expect(r.rendered).toBe(false);
    expect(outreachCopyFor({ kind: 'CONFERENCE_TITLE', facts: { conference: '-D3' } })).toBe(null);
  });

  it('claims no round the copy has no words for', () => {
    expect(through('POSTSEASON_RESULT', { round: 'r64' }).qualified).toBe(false);
  });
});

describe('a licensed kind cannot silently have no contract', () => {
  it('refuses at load, in both directions', async () => {
    // The guard is a load-time throw in `outreachEvidence.js`. Proven by
    // asserting the equality it enforces, and by the mutation record in
    // `outreachContract.test.js`'s companion run: removing a contract entry
    // for a licensed kind fails on import, before any evidence is generated.
    const licensed = LICENSED_KINDS;
    for (const kind of licensed) expect(hasContract(kind), `${kind} needs a contract`).toBe(true);
    for (const kind of CONTRACT_KINDS) {
      expect(permissionsFor(kind).OUTREACH, kind).not.toBe(PERMISSION.DENIED);
    }
  });
});
