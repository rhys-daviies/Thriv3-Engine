/**
 * What the athletics-domain ledger may be trusted to say, and in which direction.
 *
 * ONE OWNER. Before L7B the rule lived as the same SQL predicate copied into
 * `evidenceQueries.js` and `rosterSourceAudit.js`, and L7B needed a third
 * reading for discovery. Three copies of a trust rule is how they drift, so
 * the rule is here and the callers pass a profile.
 *
 * ---------------------------------------------------------------------------
 * THE LEDGER RUNS HOST → INSTITUTION.
 *
 * Its primary key is the host, and `unitid` records who the PAGE said it was —
 * `og:site_name`, or the title. That is the verification direction: given a URL
 * an operator might open, whose is it?
 *
 * Discovery needs the inverse, institution → host, and the inverse is only as
 * sound as the forward assignment. So nothing here infers an owner. It reads
 * what the page claimed, decides whether that claim is strong enough, and
 * inverts only the claims that are.
 *
 * ---------------------------------------------------------------------------
 * FOUR CLASSES.
 *
 * L7 measured the ledger against an independent signal — the host each
 * institution's own 2026 rosters were actually fetched from — over 1,221
 * comparisons. 1,211 agreed. Every one of the ten disagreements was
 * `identity_strength = 'BASE_ONLY'`, a host matched on a short base name, which
 * is how `uconnhuskies.com` came to be recorded as Connecticut College's and
 * `gocobbers.com` as The Citadel's. There are eight BASE_ONLY rows in the
 * trusted set and seven are wrong; the 934 WHOLE_NAME rows produced no observed
 * error at all.
 *
 * That measurement, not the status column alone, is what the classes encode.
 */

import { canonicalHost } from './registryIntegrity.js';

export { canonicalHost };

/** What the ledger may be trusted to say about one host. */
export const AUTHORITY = Object.freeze({
  /** Strong identity, athletics property, no unresolved contest. Usable. */
  TRUSTED: 'TRUSTED',
  /**
   * Identity is strong but something about the row is contested or unproven —
   * a base-name match, or an assignment the institution's own rosters never
   * corroborate. Never authority; kept visible so a reviewer can see it.
   */
  QUARANTINED: 'QUARANTINED',
  /** The crawler could not establish whose host it is. No unitid, or no evidence. */
  INSUFFICIENT_IDENTITY: 'INSUFFICIENT_IDENTITY',
  /** The row itself names a claimant who was wrong about it. See below. */
  CONFLICTED: 'CONFLICTED',
});

/**
 * WRONG_INSTITUTION IS DIRECTIONAL, AND WAS BEING READ AS IF IT WERE NOT.
 *
 * The status records that a particular CLAIMANT said this host was theirs and
 * the page disagreed. It does not say the host is unidentifiable — the row's
 * own `unitid` is still whoever the page named, established exactly the way a
 * VERIFIED row's is. Across all 57 such rows, not one lists its own unitid
 * among `wrong_mappings`; by construction it cannot.
 *
 * The old reading discarded the whole row, which threw away the true owner
 * along with the false claimant. `uwlathletics.com` carries unitid 240329 and
 * the evidence "University of Wisconsin La Crosse Athletics", and was refused
 * for La Crosse because Wisconsin-Stevens Point had also claimed it. It serves
 * La Crosse's men's roster.
 *
 * So the row is authority FOR its own unitid and refused for every claimant
 * `wrong_mappings` names. That is what `forInstitution` below enforces, and it
 * is strictly narrower than trusting the row outright: a genuine
 * cross-institution mismatch still cannot be resolved in the claimant's favour.
 */
function wrongClaimants(row) {
  const raw = row?.wrong_mappings;
  if (!raw) return [];
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((m) => m?.claimantUnitid).filter((u) => u != null);
}

/**
 * ROLE IS A COARSE LABEL AND THE EVIDENCE IS THE FINER ONE.
 *
 * `role` separates a university's main site from its athletics site, which is
 * the right distinction — an academic domain is not an athletics property and
 * promoting one wholesale would be exactly the error this file exists to avoid.
 *
 * But the label is assigned by hostname shape, and an athletics property served
 * from the institution's own domain fails that test while satisfying the thing
 * the label is a proxy for. Thirteen VERIFIED, CERTAIN, WHOLE_NAME rows say
 * "Carlow University" or "Elms College" under `og:site_name` on hosts named
 * `athletics.carlow.edu` and `athletics.elms.edu`, and were excluded.
 *
 * So the rule is: the role label is sufficient, and athletics-specific evidence
 * about the HOST is the alternative sufficient condition.
 *
 * The evidence has to be the hostname, and it is worth saying why, because the
 * obvious candidate does not work. `evidence_text` is `og:site_name`, and on
 * these rows it reads "Carlow University", "Avila University", "Elms College" —
 * it establishes WHOSE the host is, which is the question the ledger was built
 * to answer, and says nothing about WHAT it is. A rule keyed on it would admit
 * nothing at all. The hostname is the structural claim: a domain carrying
 * `athletics` as a label, or ending in it, is the athletics property by
 * construction, not by resemblance to any school's name.
 *
 * Identity still has to be VERIFIED, strongly confident and WHOLE_NAME, so this
 * widens WHAT a host may be and never HOW its owner is established. A row that
 * merely belongs to a school with a sports team is not promoted: `clemson.edu`
 * and `uakron.edu` stay institution sites.
 */
const ATHLETICS_HOST = /(^|[.\-])(athletics?|goathletics)([.\-]|$)|athletics?\.[a-z]{2,}$/i;

function isAthleticsProperty(row) {
  if (row?.role === 'ATHLETICS_SITE') return true;
  if (row?.role !== 'INSTITUTION_SITE') return false;
  return ATHLETICS_HOST.test(String(row?.domain ?? ''));
}

const VERIFIED_STATUS = new Set(['VERIFIED', 'VERIFIED_ALIAS']);
const STRONG_CONFIDENCE = new Set(['CERTAIN', 'CORROBORATED']);

/**
 * How much of the ledger a caller is willing to read.
 *
 * `STRICT` is the rule production has always applied, preserved exactly: it is
 * what decides whether an operator is shown a "View source" link, and widening
 * it moves a behavioural baseline. `DISCOVERY` adds the two classes L7 proved
 * recoverable, and its output is a candidate URL that every downstream gate
 * still has to accept.
 */
export const PROFILE = Object.freeze({
  STRICT: Object.freeze({
    name: 'STRICT',
    allowOwnUnitidOnConflict: false,
    allowAthleticsEvidencedInstitutionSite: false,
    /*
     * BASE_ONLY stays inside the production filter, deliberately, and L7B
     * measured the alternative rather than assuming it. Excluding the eight
     * moves OPERATOR_EVIDENCE by exactly four pairs across two programmes, both
     * Regis (CO) — the ONE base-name row the evidence supports, whose host its
     * own rosters use. The seven wrong ones cost nothing to exclude because
     * `registryIntegrity` already refuses every one of them downstream.
     *
     * So the choice is: keep a class that is 87.5% wrong but wholly contained,
     * or drop it and take a real regression on the one correct member. Neither
     * is obviously right, and an architecture slice is the wrong place to
     * decide it — L7B changes no production behaviour. The recommendation, with
     * its measured cost, is in the L7B document.
     */
    allowBaseOnly: true,
  }),
  DISCOVERY: Object.freeze({
    name: 'DISCOVERY',
    allowOwnUnitidOnConflict: true,
    allowAthleticsEvidencedInstitutionSite: true,
    // Never for discovery. A wrong link is one bad click; a wrong candidate is
    // a whole roster imported against the wrong programme, and these targets
    // have no prior squad for the turnover gate to catch it with.
    allowBaseOnly: false,
  }),
});

/**
 * The class of one ledger row, before any institution is named.
 *
 * `forInstitution` is the second half: a CONFLICTED row is authority for its
 * own unitid and for nobody else, and only one profile is willing to say so.
 */
export function classifyRow(row, profile = PROFILE.STRICT) {
  if (!row || row.unitid == null) return AUTHORITY.INSUFFICIENT_IDENTITY;
  if (!VERIFIED_STATUS.has(row.status)) {
    if (row.status === 'WRONG_INSTITUTION') return AUTHORITY.CONFLICTED;
    return AUTHORITY.INSUFFICIENT_IDENTITY;
  }
  if (!STRONG_CONFIDENCE.has(row.confidence)) return AUTHORITY.INSUFFICIENT_IDENTITY;
  const athletics = profile.allowAthleticsEvidencedInstitutionSite
    ? isAthleticsProperty(row) : row.role === 'ATHLETICS_SITE';
  if (!athletics) return AUTHORITY.INSUFFICIENT_IDENTITY;
  /*
   * BASE_ONLY: seven of the eight in the trusted set are wrong, and nothing in
   * the row tells the eighth apart. Quarantined rather than dropped, so the
   * repair queue can still see it. Only the strict profile — which is
   * describing what production already does — will look past this.
   */
  if (row.identity_strength === 'BASE_ONLY' && !profile.allowBaseOnly) return AUTHORITY.QUARANTINED;
  return AUTHORITY.TRUSTED;
}

/** May this row be used as authority FOR this institution, under this profile? */
export function forInstitution(row, unitid, profile = PROFILE.STRICT) {
  if (unitid == null || row?.unitid !== unitid) return false;
  const klass = classifyRow(row, profile);
  if (klass === AUTHORITY.TRUSTED) return true;
  if (klass !== AUTHORITY.CONFLICTED || !profile.allowOwnUnitidOnConflict) return false;
  // A conflicted row must still clear every other bar for its own owner: the
  // status is the only thing being reinterpreted, not the evidence.
  if (!STRONG_CONFIDENCE.has(row.confidence)) return false;
  // A conflicted row is never rescued on a base-name match, under any profile.
  if (row.identity_strength === 'BASE_ONLY') return false;
  const athletics = profile.allowAthleticsEvidencedInstitutionSite
    ? isAthleticsProperty(row) : row.role === 'ATHLETICS_SITE';
  if (!athletics) return false;
  return !wrongClaimants(row).includes(unitid);
}

/** Why an inverse lookup returned no usable host, or several. */
export const LOOKUP = Object.freeze({
  OK: 'OK',
  NO_UNITID: 'NO_UNITID',
  NO_TRUSTED_HOST: 'NO_TRUSTED_HOST',
  AMBIGUOUS: 'AMBIGUOUS',
});

/**
 * institution → the hosts the ledger will stand behind, or an explicit reason.
 *
 * Several hosts is not by itself a problem: a merged institution legitimately
 * carries one per predecessor campus, and `www.` spellings of one site collapse
 * to a single canonical host. What is refused is CHOOSING between genuinely
 * different hosts — L4 was a lesson in what happens when a lookup silently
 * takes the first row, so `AMBIGUOUS` is returned instead and the caller may
 * decide it is not worth a request.
 *
 * `usage` is optional and is the same signal `registryIntegrity` reads: hosts
 * the institution's own rosters have actually been fetched from. When it
 * settles a multi-host case to exactly one, that one is returned — corroborated
 * by observation rather than by preference.
 */
export function hostsForInstitution(rows, unitid, { profile = PROFILE.STRICT, usage = null } = {}) {
  if (unitid == null) return { status: LOOKUP.NO_UNITID, hosts: [], reason: 'programme has no unitid' };
  const hosts = [...new Set(rows
    .filter((r) => forInstitution(r, unitid, profile))
    .map((r) => canonicalHost(r.domain)))].sort();
  if (!hosts.length) {
    return { status: LOOKUP.NO_TRUSTED_HOST, hosts: [], reason: 'no ledger row this profile will stand behind' };
  }
  if (hosts.length === 1) return { status: LOOKUP.OK, hosts, reason: null };
  if (usage) {
    const used = hosts.filter((h) => usage.has(h));
    if (used.length === 1) {
      return { status: LOOKUP.OK, hosts: used, reason: 'one of several, corroborated by this institution\'s own rosters' };
    }
  }
  return {
    status: LOOKUP.AMBIGUOUS,
    hosts,
    reason: `${hosts.length} hosts and nothing distinguishes them`,
  };
}

/**
 * The whole inverse index, built once.
 *
 * Returns a Map keyed by unitid. Programmes are NOT keys: a host belongs to an
 * institution, and one institution's men's and women's programmes share it.
 * Requiring a row per programme would be duplicating the ledger to express
 * something it never said.
 */
export function inverseIndex(rows, { profile = PROFILE.STRICT, usage = null } = {}) {
  const byUnitid = new Map();
  for (const r of rows) {
    if (r?.unitid == null) continue;
    if (!byUnitid.has(r.unitid)) byUnitid.set(r.unitid, []);
    byUnitid.get(r.unitid).push(r);
  }
  const out = new Map();
  for (const [unitid, group] of byUnitid) {
    out.set(unitid, hostsForInstitution(group, unitid, { profile, usage }));
  }
  return out;
}

/** The trust map production reads: canonical host → institution. STRICT only. */
export function verifiedHostMap(rows, profile = PROFILE.STRICT) {
  const out = new Map();
  for (const r of rows) {
    if (classifyRow(r, profile) !== AUTHORITY.TRUSTED) continue;
    out.set(canonicalHost(r.domain), r.unitid);
  }
  return out;
}
