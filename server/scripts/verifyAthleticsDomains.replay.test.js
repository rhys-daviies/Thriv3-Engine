/**
 * PHASE 2D REPLAY TEST — the registry generator must not recreate the Phase-2C
 * mis-stampings.
 *
 * verifyAthleticsDomains.audit() is the function that produces athletics_domains
 * rows from fetched-page evidence + the known_domains mapping. Phase 2C proved
 * it silently VERIFIED a domain at the page self-identification's UNITID even
 * when NO claiming name agreed — so a page that loosely matched the wrong
 * same-name sibling (uconn.edu → "Connecticut College") was stamped VERIFIED at
 * that sibling. The fix: when the host self-ID agrees with no claim, the strong
 * identifiers CONFLICT → AMBIGUOUS (verify externally), never a silent
 * cross-institution VERIFIED.
 *
 * This replays each real Phase-2C failure and asserts the generator now yields
 * AMBIGUOUS, and that a genuine agreement still yields VERIFIED.
 */
import { describe, it, expect, beforeAll } from 'vitest';

let audit; let DOMAIN_STATUS; let IDENTITY_METHOD;
beforeAll(async () => {
  process.env.RECRUITMATCH_DB = ':memory:'; // importing the script opens db/client
  ({ audit } = await import('./verifyAthleticsDomains.js'));
  ({ DOMAIN_STATUS, IDENTITY_METHOD } = await import('../../shared/institutionIdentity.js'));
});

/** A resolver that maps exact strings to a UNITID; anything else is unresolvable. */
const stubResolver = (map) => ({
  resolve: (text) => (map[text] != null
    ? { unitid: map[text], method: IDENTITY_METHOD.EXACT, strength: 'WHOLE_NAME', alias: null }
    : { unitid: null, reason: 'UNKNOWN' }),
});

/** Run audit() for one domain: `claim` name → claimU; the page self-IDs as `page` → hostU. */
function rowFor({ domain, claim, claimU, page, hostU }) {
  const evidence = { domains: [{ domain, http: 200, bytesRead: 100, title: page, siteName: page }] };
  const mapping = { [claim]: [domain] };
  const resolvers = stubResolver({ [claim]: claimU, [page]: hostU });
  const { rows } = audit({ evidence, mapping, resolvers, now: '2026-09-25T00:00:00.000Z' });
  return rows.find((r) => r.domain === domain);
}

// The seven required Phase-2C failure signatures: the page matched a DIFFERENT
// institution than the claiming name. (Penn College and WVU are here as the
// host-vs-claim conflict shape; their known_domains mapping fix is separate.)
const CONFLICTS = [
  { name: 'UConn', domain: 'uconn.edu', claim: 'UConn', claimU: 129020, page: 'Connecticut College', hostU: 128902 },
  { name: "St John's", domain: 'stjohns.edu', claim: "St. John's", claimU: 195809, page: 'New York University', hostU: 193900 },
  { name: 'Columbia', domain: 'ccis.edu', claim: 'Columbia College (MO)', claimU: 177065, page: 'Columbia University', hostU: 190150 },
  { name: 'Anderson', domain: 'andersonuniversity.edu', claim: 'Anderson (SC)', claimU: 217633, page: 'Anderson University Indiana', hostU: 150066 },
  { name: 'St Thomas', domain: 'tommiesports.com', claim: 'St. Thomas (MN)', claimU: 174914, page: 'University of St Thomas Texas', hostU: 227863 },
  { name: 'Penn College', domain: 'pct.edu', claim: 'Pennsylvania College of Technology', claimU: 366252, page: 'University of Pennsylvania', hostU: 215062 },
  { name: 'WVU', domain: 'wvu.edu', claim: 'West Virginia', claimU: 238032, page: 'WVU Institute of Technology', hostU: 237950 },
];

describe('verifyAthleticsDomains replay — no silent cross-institution VERIFIED', () => {
  for (const c of CONFLICTS) {
    it(`${c.name}: host self-ID conflicting every claim → AMBIGUOUS, not VERIFIED`, () => {
      const row = rowFor(c);
      expect(row.status).toBe(DOMAIN_STATUS.AMBIGUOUS);
      expect(row.status).not.toBe(DOMAIN_STATUS.VERIFIED);
    });
  }

  it('a genuine agreement (host self-ID matches the claim) still VERIFIES', () => {
    const row = rowFor({ domain: 'uconn.edu', claim: 'UConn', claimU: 129020, page: 'University of Connecticut', hostU: 129020 });
    expect(row.status).toBe(DOMAIN_STATUS.VERIFIED);
    expect(row.unitid).toBe(129020);
  });
});
