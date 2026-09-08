/**
 * When the athletics-domain registry contradicts itself.
 *
 * H12 trusted a host on four registry facts: VERIFIED or VERIFIED_ALIAS, role
 * ATHLETICS_SITE, confidence CERTAIN or CORROBORATED, and an institution id.
 * H15 found ten hosts carrying all four and still assigned to the wrong
 * school — `uconnhuskies.com` recorded as Connecticut College's, Suffolk's
 * site recorded as The Citadel's — because the pipeline that built the
 * registry matched each site's own page title to a similarly-named
 * institution.
 *
 * So those four facts are necessary and not sufficient. This adds the missing
 * one, and it is deliberately a NEGATIVE test: it can say an assignment is
 * unsafe without saying who the real owner is, which is the only honest thing
 * the data supports. H15 established that distinction on UConn and it holds
 * here — nothing below repairs an id or names a replacement.
 *
 * ---------------------------------------------------------------------------
 * THE SIGNAL IS ROSTER USAGE, NOT NAMES.
 *
 * An institution may legitimately hold several athletics hosts: a merged one
 * carries a site per predecessor campus, and Commonwealth
 * University-Bloomsburg carries Bloomsburg's, Lock Haven's and Mansfield's.
 * So counting hosts proves nothing.
 *
 * What separates them is whether the institution's OWN rosters use each host.
 * Measured across every sport and season:
 *
 *   five institutions use every host assigned to them — Iona, Milwaukee,
 *   Vermont State, Commonwealth Bloomsburg, PennWest California. Usage
 *   corroborates the assignment and they stay trusted.
 *
 *   sixteen use one host and never touch the rest. Those seventeen dormant
 *   assignments include every known-bad one, and also innocent second domains
 *   like `chapmanathletics.com`. We cannot tell them apart — which is the
 *   point. Uncorroborated is not "wrong"; it is "unverified", and unverified
 *   is not a licence to put a link in front of an operator.
 *
 * No school name is compared anywhere in this file.
 */

/** Hosts compare without a leading www or a port; nothing else is rewritten. */
export const canonicalHost = (host) => String(host || '').toLowerCase()
  .replace(/^www\./, '').replace(/:\d+$/, '');

/** What the registry can say about one trusted host. */
export const INTEGRITY = Object.freeze({
  /** The only assignment its institution holds, or one its own rosters use. */
  CLEAN: 'CLEAN',
  /** Two institutions are both recorded as owning it. At most one is right. */
  SHARED_HOST_CONFLICT: 'SHARED_HOST_CONFLICT',
  /** One of several, and the institution's own rosters use this one too. */
  MULTI_SITE_CORROBORATED: 'MULTI_SITE_CORROBORATED',
  /** One of several, and the institution's own rosters use a different one. */
  MULTI_SITE_UNCORROBORATED: 'MULTI_SITE_UNCORROBORATED',
});

/** Statuses that are unsafe to offer as source identity. */
const REFUSED = new Set([
  INTEGRITY.SHARED_HOST_CONFLICT,
  INTEGRITY.MULTI_SITE_UNCORROBORATED,
]);
export const integrityRefuses = (state) => REFUSED.has(state);

/**
 * Classify every trusted host once, from the registry and roster usage.
 *
 * @param {Array}  trustedRows  {domain, unitid} already filtered to
 *   VERIFIED/VERIFIED_ALIAS + ATHLETICS_SITE + CERTAIN/CORROBORATED + unitid
 * @param {Array}  usage        {unitid, host} — which institution's own rosters
 *   point at which host, across every sport and season
 * @returns {Map<string, {unitid: number, state: string, siblings: string[]}>}
 *   keyed by canonical host
 */
export function classifyRegistry(trustedRows = [], usage = []) {
  const owner = new Map();
  const hostsOf = new Map();
  const contested = new Set();
  for (const r of trustedRows) {
    const host = canonicalHost(r.domain);
    /**
     * Two institutions trusted to one host. Empty on today's registry — and
     * kept because "the data is currently clean" is not a rule. Taking the
     * last row read would silently pick a winner, which is the one thing this
     * file exists not to do.
     */
    if (owner.has(host) && Number(owner.get(host)) !== Number(r.unitid)) contested.add(host);
    owner.set(host, r.unitid);
    if (!hostsOf.has(r.unitid)) hostsOf.set(r.unitid, new Set());
    hostsOf.get(r.unitid).add(host);
  }

  /** Which hosts each institution's own rosters actually point at. */
  const usedBy = new Map();
  for (const u of usage) {
    const host = canonicalHost(u.host);
    if (!usedBy.has(u.unitid)) usedBy.set(u.unitid, new Set());
    usedBy.get(u.unitid).add(host);
  }

  const out = new Map();
  for (const [host, unitid] of owner) {
    if (contested.has(host)) {
      out.set(host, { unitid, state: INTEGRITY.SHARED_HOST_CONFLICT, siblings: [] });
      continue;
    }
    const siblings = hostsOf.get(unitid) ?? new Set([host]);
    if (siblings.size === 1) {
      out.set(host, { unitid, state: INTEGRITY.CLEAN, siblings: [] });
      continue;
    }
    const used = usedBy.get(unitid) ?? new Set();
    out.set(host, {
      unitid,
      state: used.has(host) ? INTEGRITY.MULTI_SITE_CORROBORATED : INTEGRITY.MULTI_SITE_UNCORROBORATED,
      siblings: [...siblings].filter((h) => h !== host).sort(),
    });
  }
  return out;
}
