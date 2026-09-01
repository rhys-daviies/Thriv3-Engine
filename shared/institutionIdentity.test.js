/**
 * The regressions this module exists for.
 *
 * Phase 12C filed four seasons of Columbia University's results under Columbia
 * College, Missouri, and four of Maryville University's under Maryville
 * College, Tennessee. Both fetches returned 200 and parsed cleanly. Every test
 * here is a way that can happen again.
 */
import { describe, it, expect } from 'vitest';
import {
  buildInstitutionResolver, institutionVariants, indexVariants, parseInstitutionName,
  normaliseInstitution, institutionFromPage, identityCorroborated,
  IDENTITY_UNRESOLVED, IDENTITY_METHOD, IDENTITY_EVIDENCE, ALIAS_TYPE,
} from './institutionIdentity.js';

/** The real UNITIDs, so a regression names the institutions it is about. */
const COLUMBIA_NY = 190150;
const COLUMBIA_MO = 177065;
const MARYVILLE_TN = 220710;
const MARYVILLE_MO = 178059;
const BERKELEY = 110635;
const PENNWEST = 498571;

const ALIASES = [
  { alias: 'Columbia', unitid: COLUMBIA_NY, aliasType: ALIAS_TYPE.CURRENT_NAME },
  { alias: 'Columbia (MO)', unitid: COLUMBIA_MO, aliasType: ALIAS_TYPE.CURRENT_NAME },
  { alias: 'Maryville (TN)', unitid: MARYVILLE_TN, aliasType: ALIAS_TYPE.CURRENT_NAME },
  { alias: 'Maryville University', unitid: MARYVILLE_MO, aliasType: ALIAS_TYPE.CURRENT_NAME },
  { alias: 'California', unitid: BERKELEY, aliasType: ALIAS_TYPE.CURRENT_NAME },
  { alias: 'PennWest California', unitid: PENNWEST, aliasType: ALIAS_TYPE.CURRENT_NAME },
  { alias: 'California (Pa.)', unitid: PENNWEST, aliasType: ALIAS_TYPE.HISTORICAL_NAME },
  { alias: 'Truman State', unitid: 179539, aliasType: ALIAS_TYPE.CURRENT_NAME },
  { alias: 'Thiel College', unitid: 216357, aliasType: ALIAS_TYPE.CURRENT_NAME },
  { alias: 'Framingham State', unitid: 166513, aliasType: ALIAS_TYPE.CURRENT_NAME },
  { alias: 'Wisconsin-Whitewater', unitid: 240365, aliasType: ALIAS_TYPE.CURRENT_NAME },
];
const STATES = {
  [COLUMBIA_NY]: 'NY', [COLUMBIA_MO]: 'MO', [MARYVILLE_TN]: 'TN', [MARYVILLE_MO]: 'MO',
  [BERKELEY]: 'CA', [PENNWEST]: 'PA', 179539: 'MO', 216357: 'PA', 166513: 'MA', 240365: 'WI',
};
const R = buildInstitutionResolver(ALIASES, STATES);

describe('the named wrong-institution regressions', () => {
  it('never resolves Columbia College (MO) to Columbia University (NY)', () => {
    expect(R.resolve('Columbia (MO)').unitid).toBe(COLUMBIA_MO);
    expect(R.resolve('Columbia College (MO)').unitid).toBe(COLUMBIA_MO);
    expect(R.resolve('Columbia').unitid).toBe(COLUMBIA_NY);
    // A state in the name reaches past the written-down "Columbia" to the
    // generated key that only the Missouri college answers to.
    expect(R.resolve('Columbia College (Mo.)').unitid).toBe(COLUMBIA_MO);
    expect(R.resolve('Columbia, Mo.').unitid).toBe(COLUMBIA_MO);
  });

  // A RESIDUAL RISK, RECORDED RATHER THAN CLAIMED FIXED. Our own table calls
  // Columbia University "Columbia" and states no institution type, so a source
  // printing the bare "Columbia College" — no state — resolves to the
  // university. Every source seen in 12D writes the state on this family, and
  // `resolveProgramme` refuses a match whose state contradicts the source, but
  // an unqualified "Columbia College" is not separable from what we hold.
  it('resolves an unqualified "Columbia College" to the university, and this is the known limit', () => {
    expect(R.resolve('Columbia College').unitid).toBe(COLUMBIA_NY);
  });

  it('never resolves Maryville College (TN) to Maryville University (MO)', () => {
    expect(R.resolve('Maryville (TN)').unitid).toBe(MARYVILLE_TN);
    expect(R.resolve('Maryville University').unitid).toBe(MARYVILLE_MO);
    expect(R.resolve('Maryville').reason).toBe(IDENTITY_UNRESOLVED.AMBIGUOUS);
  });

  it('never resolves a Columbia University page to Columbia College (MO)', () => {
    const said = institutionFromPage({ title: 'Columbia University Athletics', siteName: 'Columbia University Athletics' }, R);
    expect(said.unitid).toBe(COLUMBIA_NY);
  });

  it('never resolves PennWest California to the University of California', () => {
    expect(R.resolve('California (Pa.)').unitid).toBe(PENNWEST);
    expect(R.resolve('PennWest California').unitid).toBe(PENNWEST);
    expect(R.resolve('California').unitid).toBe(BERKELEY);
  });
});

describe('a state the source wrote is a veto, not a tiebreak', () => {
  it('refuses a unique match in the wrong state', () => {
    // "Embry-Riddle Aeronautical University (AZ)" matches exactly one row in a
    // table that holds only the Florida one. The source has said which.
    const r = buildInstitutionResolver([{ alias: 'Truman State', unitid: 179539 }], { 179539: 'MO' });
    expect(r.resolve('Truman State (TX)').reason).toBe(IDENTITY_UNRESOLVED.AMBIGUOUS);
    expect(r.resolve('Truman State (Mo.)').unitid).toBe(179539);
  });

  it('reads both the parenthetical and the comma spellings of a state', () => {
    expect(parseInstitutionName('Aquinas College (Mich.)')).toEqual({ base: 'Aquinas College', state: 'MI' });
    expect(parseInstitutionName('Springfield, Mo.')).toEqual({ base: 'Springfield', state: 'MO' });
    expect(parseInstitutionName('Queens (CUNY)').state).toBeNull();
  });

  it('strips a national ranking marker, which is not a qualifier', () => {
    expect(parseInstitutionName('Messiah (1)')).toEqual({ base: 'Messiah', state: null });
  });
});

describe('the rewriting ladder is closed, and asymmetric', () => {
  it('expands the abbreviations conference tables print', () => {
    expect(R.resolve('Framingham St.').unitid).toBe(166513);
    expect(R.resolve('UW-Whitewater').unitid).toBe(240365);
  });

  it('reaches a longer written-down name from a shorter printed one', () => {
    expect(R.resolve('Thiel').unitid).toBe(216357);
    expect(R.resolve('Truman').unitid).toBe(179539);
  });

  it('shortens OUR names and never a source’s', () => {
    // The index may generate "Truman" from "Truman State"…
    expect(indexVariants('Truman State')).toContain('truman');
    // …and a query must never generate "USC" from "USC Aiken", which is how the
    // University of Southern California acquired two Division II seasons.
    expect(institutionVariants('USC Aiken')).not.toContain('usc');
    expect(institutionVariants('San Diego Christian')).not.toContain('san diego');
  });

  it('a written-down name always beats a generated one', () => {
    const r = buildInstitutionResolver([
      { alias: 'USC', unitid: 1 }, { alias: 'USC Aiken', unitid: 2 }, { alias: 'USC Beaufort', unitid: 3 },
    ], {});
    expect(r.resolve('USC').unitid).toBe(1);
    expect(r.resolve('USC Aiken').unitid).toBe(2);
  });

  it('is spelling-only: no word is stripped by the normaliser', () => {
    expect(normaliseInstitution('Saint Mary’s College of Maryland')).toBe('saint mary s college of maryland');
    expect(normaliseInstitution('Texas A&M')).toBe('texas a and m');
  });
});

describe('what a page says it is', () => {
  it('does not split a school’s own hyphenated name into a different school', () => {
    const r = buildInstitutionResolver([
      { alias: 'Missouri', unitid: 178396 }, { alias: 'UMSL', unitid: 178402 },
    ], {});
    // Splitting on " - " produced "University of Missouri" here and filed a
    // campus's athletics site under the system's flagship.
    const said = institutionFromPage({ title: 'University of Missouri - St. Louis Athletics - Official Athletics Website', siteName: null }, r);
    expect(said.unitid).not.toBe(178396);
  });

  it('refuses a page whose candidates name two different institutions', () => {
    const said = institutionFromPage({ title: 'Columbia | Maryville University', siteName: null }, R);
    expect(said.unitid).toBeNull();
    expect(said.reason).toBe(IDENTITY_UNRESOLVED.AMBIGUOUS);
  });

  it('marks a match reached through a generated spelling as BASE_ONLY', () => {
    // "Thiel" is not a name anyone wrote down; it is a rewriting of "Thiel
    // College" that this module generated. Good enough to confirm a claim,
    // never good enough to refute one.
    const said = institutionFromPage({ title: null, siteName: 'Thiel Athletics' }, R);
    expect(said.unitid).toBe(216357);
    expect(said.strength).toBe('BASE_ONLY');
  });
});

describe('the identity corroboration contract', () => {
  it('refuses DOMAIN_ONLY as production evidence', () => {
    expect(identityCorroborated({ evidence: [IDENTITY_EVIDENCE.DOMAIN_ONLY] })).toEqual({ ok: false, reason: 'DOMAIN_ONLY' });
  });

  it('accepts any of the four established kinds', () => {
    for (const e of [IDENTITY_EVIDENCE.EXPLICIT_PAGE_INSTITUTION, IDENTITY_EVIDENCE.VERIFIED_DOMAIN_IDENTITY,
      IDENTITY_EVIDENCE.VERIFIED_ALIAS, IDENTITY_EVIDENCE.CONFERENCE_MEMBERSHIP_CORROBORATION]) {
      expect(identityCorroborated({ evidence: [e] }).ok).toBe(true);
    }
  });

  it('lets one conflict override any amount of agreement', () => {
    const r = identityCorroborated({
      evidence: [IDENTITY_EVIDENCE.EXPLICIT_PAGE_INSTITUTION, IDENTITY_EVIDENCE.VERIFIED_DOMAIN_IDENTITY],
      conflict: 'host identifies as 190150',
    });
    expect(r.ok).toBe(false);
  });
});

describe('a name claimed by two institutions', () => {
  it('is reported as a collision rather than resolved', () => {
    const r = buildInstitutionResolver([{ alias: 'Bethel', unitid: 1 }, { alias: 'Bethel', unitid: 2 }], {});
    expect(r.collisions()).toEqual([{ key: 'bethel', unitids: [1, 2] }]);
    expect(r.resolve('Bethel').reason).toBe(IDENTITY_UNRESOLVED.AMBIGUOUS);
  });

  it('resolves it when — and only when — the source wrote the state', () => {
    const r = buildInstitutionResolver([{ alias: 'Bethel', unitid: 1 }, { alias: 'Bethel', unitid: 2 }], { 1: 'IN', 2: 'TN' });
    expect(r.resolve('Bethel (Ind.)').unitid).toBe(1);
    expect(r.resolve('Bethel (Tenn.)').unitid).toBe(2);
    expect(r.resolve('Bethel (Kan.)').unitid).toBeNull();
    expect(r.resolve('Bethel').unitid).toBeNull();
  });
});

describe('the same-name risks named in the brief', () => {
  // Every one of these is a family of distinct institutions. None of them may
  // resolve from the bare name alone.
  const bare = ['Miami', 'Charleston', 'Bethel', 'Concordia', 'Trinity', "Saint Mary's",
    'Maryville', 'Columbia', 'Washington', 'Georgetown', 'Lincoln', 'Union'];
  const aliases = bare.flatMap((n, i) => [
    { alias: `${n} (AA)`, unitid: 1000 + i * 2 }, { alias: `${n} (BB)`, unitid: 1001 + i * 2 },
  ]);
  const r = buildInstitutionResolver(aliases, {});
  for (const n of bare) {
    it(`refuses the bare name "${n}"`, () => {
      expect(r.resolve(n).unitid).toBeNull();
      expect(r.resolve(n).reason).toBe(IDENTITY_UNRESOLVED.AMBIGUOUS);
    });
  }
});

describe('an institution with no UNITID has no identity', () => {
  it('contributes no alias and resolves to nothing', () => {
    const r = buildInstitutionResolver([{ alias: 'Simon Fraser', unitid: null }], {});
    expect(r.resolve('Simon Fraser').unitid).toBeNull();
    expect(r.size).toBe(0);
  });
});

describe('identity method', () => {
  it('separates an exact spelling from a rewritten one', () => {
    expect(R.resolve('Thiel College').method).toBe(IDENTITY_METHOD.EXACT);
    expect(R.resolve('Thiel').method).toBe(IDENTITY_METHOD.VARIANT);
  });
});
