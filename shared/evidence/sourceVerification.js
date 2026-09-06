import { integrityRefuses, canonicalHost } from './registryIntegrity.js';

/**
 * May this page be offered as the source of a claim?
 *
 * ONE OWNER. Every generator that wants to cite a roster page asks this, and
 * no generator re-implements a host check — two answers to "does this URL
 * belong to this school" would eventually disagree, and the failure mode is an
 * operator clicking through to a different programme.
 *
 * The bar is deliberately high, because the cost is asymmetric. A missing link
 * costs an operator a click they cannot make; a wrong link costs them the
 * belief that any of the panel is checkable. H11 found Stonehill's 2025 roster
 * row pointing at Stanton's athletics site, which is exactly that failure
 * sitting in the data already.
 *
 * ---------------------------------------------------------------------------
 * FIVE CONDITIONS, ALL DETERMINISTIC.
 *
 *   1. The URL parses, is absolute, and is http(s). No javascript:, no data:,
 *      no relative path, no empty host.
 *   2. The path is roster-shaped rather than a player bio. A bio page shows
 *      one player and proves nothing about a count.
 *   3. The host is a domain the athletics-domain registry has VERIFIED as an
 *      ATHLETICS_SITE, with CERTAIN or CORROBORATED confidence.
 *   4. That domain's institution id equals the programme's. IPEDS `unitid` on
 *      both sides — never a name comparison. 71 hosts differ from their
 *      college row only by naming variant ("Avila" against "Avila
 *      University"), and resolving those by string similarity would be a
 *      guess dressed as a check.
 *   4b. The registry does not contradict itself about that assignment. H15
 *      found ten hosts carrying every one of the checks above and still
 *      assigned to the wrong school, so the four are necessary and not
 *      sufficient; `registryIntegrity` supplies the fifth and refuses an
 *      assignment its own institution's rosters never corroborate.
 *   5. The URL is the source for the SEASON the claim is about. No fallback:
 *      a 2026 claim linked to a 2025 roster would show a squad that has since
 *      turned over.
 *
 * Anything else returns a reason and no URL. Null is a correct answer.
 */

/** Why a programme-season source cannot be offered. Engineering vocabulary. */
export const SOURCE_STATUS = Object.freeze({
  VERIFIED_DIRECT: 'VERIFIED_DIRECT',
  MISSING: 'MISSING',
  MALFORMED: 'MALFORMED',
  PLAYER_BIO: 'PLAYER_BIO',
  OTHER_SHAPE: 'OTHER_SHAPE',
  UNVERIFIED_HOST: 'UNVERIFIED_HOST',
  INSTITUTION_MISMATCH: 'INSTITUTION_MISMATCH',
  REGISTRY_CONFLICT: 'REGISTRY_CONFLICT',
  UNKNOWN_INSTITUTION: 'UNKNOWN_INSTITUTION',
});

/**
 * A path that shows a squad rather than a person.
 *
 * Built from the 4,038 real URLs rather than from what providers document:
 * `/sports/mens-soccer/roster/2024`, `/sports/msoc/roster/2023`,
 * `/sports/msoc/2025-26/roster`. The bio forms that must be refused are
 * `/bios/tinner_loic_yw5o` and `/roster/player/owen-purvis` — the second
 * matters because it contains the word "roster" and would pass a naive test.
 */
const PLAYER_PATH = /\/(bios?|player|players)\//i;
const ROSTER_PATH = /\/roster(\/|$|\?)|\/roster-\d|\/sports\/[^/]+\/[^/]*roster/i;

export { canonicalHost } from './registryIntegrity.js';

/**
 * The URL, if it is one we would ever follow.
 *
 * Returns null rather than throwing: a malformed stored value is a data
 * problem to report, not an exception to handle at every call site.
 */
export function safeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname) return null;
  return url;
}

/**
 * @param {object}  input
 * @param {string}  input.url        the stored source_roster_url for this programme-season
 * @param {number}  input.unitid     the programme's institution id, from `colleges`
 * @param {string}  input.season     the season the CLAIM is about
 * @param {string}  input.urlSeason  the season the stored URL was recorded for
 * @param {Map}     input.verifiedDomains  canonical host -> institution id, pre-filtered
 *   to VERIFIED/VERIFIED_ALIAS + ATHLETICS_SITE + CERTAIN/CORROBORATED
 * @param {Map}     input.registryIntegrity  canonical host -> `classifyRegistry` state
 * @returns {{status: string, url: string|null, host: string|null}}
 */
export function verifyRosterSource({
  url, unitid, season, urlSeason, verifiedDomains, registryIntegrity,
} = {}) {
  const no = (status, host = null) => ({ status, url: null, host });

  if (!url) return no(SOURCE_STATUS.MISSING);
  // No cross-season fallback, checked before anything else: a link to the
  // wrong year is wrong however well the host verifies.
  if (season != null && urlSeason != null && String(season) !== String(urlSeason)) {
    return no(SOURCE_STATUS.MISSING);
  }

  const parsed = safeUrl(url);
  if (!parsed) return no(SOURCE_STATUS.MALFORMED);

  const host = canonicalHost(parsed.hostname);
  if (PLAYER_PATH.test(parsed.pathname)) return no(SOURCE_STATUS.PLAYER_BIO, host);
  if (!ROSTER_PATH.test(parsed.pathname)) return no(SOURCE_STATUS.OTHER_SHAPE, host);

  if (unitid == null) return no(SOURCE_STATUS.UNKNOWN_INSTITUTION, host);
  const owner = verifiedDomains?.get(host);
  if (owner === undefined) return no(SOURCE_STATUS.UNVERIFIED_HOST, host);
  /**
   * The two institution ids disagree, so we cannot tell a genuinely wrong host
   * from a wrong id — and refusing is the only safe answer to that.
   *
   * Measured on the 2026 men's roster: ten cases, and six of them are hosts
   * whose registry entry names the right school while carrying a different
   * `unitid` (uconnhuskies.com claims "UConn" and 128902 against the college
   * row's 129020 — transposed digits). Those are an identity-data defect
   * rather than a bad link, which is why the status says what was observed
   * instead of asserting the school is wrong.
   */
  if (Number(owner) !== Number(unitid)) return no(SOURCE_STATUS.INSTITUTION_MISMATCH, host);

  /**
   * The registry's own contradictions, kept distinct from a bare unverified
   * host — the audit needs to tell "nobody checked this" from "the registry
   * disagrees with itself about it". The operator sees neither: `sourceUrl`
   * is simply null, as it is for every claim without a page that shows it.
   */
  if (integrityRefuses(registryIntegrity?.get(host)?.state)) {
    return no(SOURCE_STATUS.REGISTRY_CONFLICT, host);
  }

  return { status: SOURCE_STATUS.VERIFIED_DIRECT, url: parsed.toString(), host };
}

/**
 * The kinds whose sentence one current-season roster page actually shows.
 *
 * FOUR, NOT EIGHT. Every current-roster kind reads the same rows, and that is
 * not the test — the test is whether an operator opening the page can check
 * what the sentence SAYS:
 *
 *   CURRENT_SAME_COUNTRY, INTERNATIONAL_ROSTER  the players and their
 *     countries are columns on the page.
 *   INTERNATIONAL_SHARE  both of its numbers are countable there.
 *   POSITION_GROUP_SIZE  the position column and the length of the list.
 *
 * Excluded, and why:
 *
 *   POSITION_GRADUATION, SQUAD_GRADUATION, POSITION_GRADUATION_STARTERS,
 *   ELIGIBILITY_CLIFF, RETURNING_POSITION_DEPTH  rest on
 *   `eligibility_end_year`, which the importer records as "only ever derived"
 *   — the sheet has no column for it and the page prints a class label. The
 *   names are on the page; the year is our arithmetic, and linking the page
 *   would offer to prove the half we computed.
 *
 *   POSITION_GROUP_SCARCITY  its denominator is the CLASSIFIED squad, which
 *   an operator cannot reconstruct from the page: they would count everyone,
 *   including the players whose position we could not parse.
 *
 *   TRANSFER_BEHAVIOUR  `prior_programme` appears on some providers' pages
 *   and not others, so the link would prove the claim at some programmes and
 *   not at others with nothing to tell them apart.
 */
export const DIRECTLY_VERIFIABLE_KINDS = Object.freeze([
  'CURRENT_SAME_COUNTRY',
  'INTERNATIONAL_ROSTER',
  'INTERNATIONAL_SHARE',
  'POSITION_GROUP_SIZE',
]);
