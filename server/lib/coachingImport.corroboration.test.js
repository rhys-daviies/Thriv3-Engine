import { describe, it, expect } from 'vitest';
import { buildInstitutionIndex, resolveCoachInstitution, GENERIC_EMAIL_DOMAINS } from './coachingImport.js';

/**
 * PHASE 3B — the acquisition corroboration rule, pinned against the real
 * institution-name collisions Phase 3A found. Each family is a pair (or a sink)
 * of same/near-name institutions where a pure name match filed the coach at the
 * WRONG one. The rule must, for every one, EITHER file at the correct
 * institution OR return REVIEW_INSTITUTION_CONFLICT — and must NEVER reproduce
 * the known wrong filing.
 */

// Minimal but real institution index covering the collision families.
const colleges = [
  { name: 'Dominican (CA)', unitid: 113698 }, { name: 'Dominican (IL)', unitid: 148496 },
  { name: 'Wilmington (DE)', unitid: 131113 }, { name: 'Wilmington (OH)', unitid: 206507 },
  { name: 'Washington', unitid: 236948 }, { name: 'Washington (MO)', unitid: 179867 },
  { name: 'UCLA', unitid: 110662 }, { name: 'Massachusetts College of Liberal Arts', unitid: 167288 },
  { name: 'Kent State', unitid: 203517 }, { name: 'Keene State', unitid: 183062 },
  { name: 'Rhode Island', unitid: 217484 }, { name: 'Rhode Island College', unitid: 217420 },
  { name: 'University of New England', unitid: 161457 }, { name: 'New England College', unitid: 182980 },
  { name: 'Southern Miss', unitid: 176372 }, { name: 'Southern Maine', unitid: 161554 },
  { name: 'Michigan', unitid: 170976 }, { name: 'Aquinas', unitid: 168786 },
  { name: 'American International', unitid: 164447 }, { name: 'FIU', unitid: 133951 },
  { name: 'Bethel College (Kansas)', unitid: 154749 }, { name: 'Southwestern (KS)', unitid: 155900 },
  { name: 'Bethany (KS)', unitid: 154721 }, { name: 'Sterling', unitid: 155937 },
];
const domains = [
  // athletics source hosts (VERIFIED) -> true unitid
  { domain: 'dustars.com', unitid: 148496, status: 'VERIFIED' },
  { domain: 'wilmingtonquakers.com', unitid: 206507, status: 'VERIFIED' },
  { domain: 'washubears.com', unitid: 179867, status: 'VERIFIED' },
  { domain: 'keeneowls.com', unitid: 183062, status: 'VERIFIED' },
  { domain: 'goanchormen.com', unitid: 217420, status: 'VERIFIED' },
  { domain: 'southernmainehuskies.com', unitid: 161554, status: 'VERIFIED' },
  { domain: 'aqsaints.com', unitid: 168786, status: 'VERIFIED' },
  { domain: 'fiusports.com', unitid: 133951, status: 'VERIFIED' },
  { domain: 'buildersports.com', unitid: 155900, status: 'VERIFIED' },
  { domain: 'bethanyswedes.com', unitid: 154721, status: 'VERIFIED' },
  // academic domains -> true unitid (via colleges.website_domain surrogate)
];
const collegesWithWeb = colleges.map((c) => ({ ...c, website_domain: {
  148496: 'dom.edu', 206507: 'wilmington.edu', 179867: 'wustl.edu', 167288: 'mcla.edu',
  183062: 'keene.edu', 217420: 'ric.edu', 182980: 'nec.edu', 168786: 'aquinas.edu',
  133951: 'fiu.edu', 155900: 'sckans.edu', 154721: 'bethanylb.edu', 155937: 'sterling.edu',
}[c.unitid] }));
const index = buildInstitutionIndex({ domains, colleges: collegesWithWeb });
const candidateNames = colleges.map((c) => c.name);

// [label, scrapedName (what filed wrong by name), sourceUrl, email, TRUE unitid, WRONG unitid]
const FAMILIES = [
  ['Dominican CA/IL', 'Dominican University', 'https://dustars.com/x', 'a@dom.edu', 148496, 113698],
  ['Wilmington DE/OH', 'Wilmington', 'https://wilmingtonquakers.com/x', 'a@wilmington.edu', 206507, 131113],
  ['Washington/WashU', 'Washington', 'https://washubears.com/x', 'a@wustl.edu', 179867, 236948],
  ['MCLA/UCLA', 'UCLA', null, 'a@mcla.edu', 167288, 110662],
  ['Keene/Kent', 'Kent State', 'https://keeneowls.com/x', 'a@keene.edu', 183062, 203517],
  ['RIC/URI', 'Rhode Island', 'https://goanchormen.com/x', 'a@ric.edu', 217420, 217484],
  ['NEC/UNE', 'University of New England', null, 'a@nec.edu', 182980, 161457],
  ['Southern Maine/Miss', 'Southern Miss', 'https://southernmainehuskies.com/x', 'a@maine.edu', 161554, 176372],
  ['Aquinas/Michigan', 'Michigan', 'https://aqsaints.com/x', 'a@aquinas.edu', 168786, 170976],
  ['FIU/American Intl', 'American International', 'https://fiusports.com/x', 'a@fiu.edu', 133951, 164447],
  ['Bethel sink: Southwestern', 'Bethel College (Kansas)', 'https://buildersports.com/x', 'a@sckans.edu', 155900, 154749],
  ['Bethel sink: Bethany', 'Bethel College (Kansas)', 'https://bethanyswedes.com/x', 'a@bethanylb.edu', 154721, 154749],
  ['Bethel sink: Sterling', 'Bethel College (Kansas)', null, 'a@sterling.edu', 155937, 154749],
];

describe('acquisition corroboration — collision families never file wrongly', () => {
  it.each(FAMILIES)('%s: files correct OR REVIEW, never the wrong institution', (_l, scrapedName, sourceUrl, email, trueU, wrongU) => {
    const r = resolveCoachInstitution({ scrapedName, sourceUrl, email, candidateNames, institutionIndex: index });
    // never the known wrong filing
    if (r.decision === 'RESOLVED') expect(r.unitid).not.toBe(wrongU);
    // either resolved to the true institution, or explicitly flagged for review
    const ok = (r.decision === 'RESOLVED' && r.unitid === trueU)
      || (r.decision === 'REVIEW_INSTITUTION_CONFLICT' && r.competingUnitids.includes(trueU));
    expect(ok, `decision=${r.decision} unitid=${r.unitid} competing=${r.competingUnitids}`).toBe(true);
  });
});

describe('corroboration guards', () => {
  it('a generic mailbox domain corroborates nothing (falls back to name match)', () => {
    const r = resolveCoachInstitution({ scrapedName: 'UCLA', sourceUrl: null, email: 'coach@gmail.com', candidateNames, institutionIndex: index });
    expect(r.basis).toBe('NAME_MATCH');
    expect(r.decision).not.toBe('REVIEW_INSTITUTION_CONFLICT'); // no false conflict from a gmail address
    expect(GENERIC_EMAIL_DOMAINS.has('gmail.com')).toBe(true);
  });

  it('a shared/ambiguous domain (one host, several institutions) never forces an assignment', () => {
    const shared = buildInstitutionIndex({
      domains: [{ domain: 'sharedu.edu', unitid: 111, status: 'VERIFIED' }, { domain: 'sharedu.edu', unitid: 222, status: 'VERIFIED' }],
      colleges: [{ name: 'Alpha', unitid: 111 }, { name: 'Beta', unitid: 222 }],
    });
    expect(shared.sharedDomains.has('sharedu.edu')).toBe(true);
    const r = resolveCoachInstitution({ scrapedName: 'Alpha', sourceUrl: 'https://sharedu.edu/x', email: null, candidateNames: ['Alpha', 'Beta'], institutionIndex: shared });
    expect(r.decision).not.toBe('REVIEW_INSTITUTION_CONFLICT');
    expect(r.basis).toBe('NAME_MATCH');
  });

  it('an already-correct filing stays correct (domain agrees with name)', () => {
    const r = resolveCoachInstitution({ scrapedName: 'Dominican (IL)', sourceUrl: 'https://dustars.com/x', email: 'a@dom.edu', candidateNames, institutionIndex: index });
    expect(r.decision).toBe('RESOLVED');
    expect(r.unitid).toBe(148496);
  });

  it('parenthetical/campus distinctions survive: St. Mary\'s (TX) is not Saint Mary\'s', () => {
    // no domain evidence -> constrained name match must still respect the disambiguator
    const r = resolveCoachInstitution({ scrapedName: "St. Mary's (TX)", sourceUrl: null, email: null, candidateNames: ["Saint Mary's", "St. Mary's University (TX)"], institutionIndex: index });
    expect(r.matched_college).not.toBe("Saint Mary's");
  });
});
