/**
 * INSTITUTION RESOLVER — the trustworthy identity foundation (Phase 3A).
 *
 * Turns a raw school label (+ optional corroborating evidence) into an explicit
 * decision about which canonical institution (UNITID) it denotes. Unlike the
 * legacy fuzzy `matchSchoolName`, ambiguity is FIRST-CLASS: the result says
 * whether we KNOW the institution or merely found the closest-looking one.
 *
 *   resolve(label, { sport, sourceUrl?, email?, state?, unitid? })
 *     -> { unitid, canonicalSchool, method, confidence, evidence, decision }
 *
 *   decision ∈ RESOLVED | REVIEW | WITHHOLD
 *
 * Evidence hierarchy (first corroborated answer wins), per Phase 2:
 *   1 explicit UNITID
 *   2 VERIFIED authoritative athletics domain (source URL) → UNITID
 *   3 VERIFIED institution alias → UNITID
 *   4 exact canonical name + state
 *   5 exact normalized name, only where UNIQUE in the sport
 *   6 constrained fuzzy — only a uniquely dominant candidate WITH corroboration
 *   7 otherwise REVIEW / WITHHOLD
 *
 * Philosophy: FALSE NEGATIVE > FALSE POSITIVE. A confident wrong match is never
 * acceptable; declining to match is.
 *
 * Parentheticals are DISAMBIGUATORS (handled by normalizeForMatch), never
 * stripped to a collision nor promoted to a standalone alias.
 */
import { normalizeForMatch, disambiguatorTokens, matchSchoolName } from './coachingImport.js';

export const DECISION = { RESOLVED: 'RESOLVED', REVIEW: 'REVIEW', WITHHOLD: 'WITHHOLD' };

/** Registrable athletics domain from a URL (handles Wayback wrappers). */
export function registrableDomain(url) {
  if (!url || typeof url !== 'string') return null;
  if (!/^https?:\/\//i.test(url)) return null;
  let host;
  const wb = url.match(/\/(https?):\/\/([^/]+)/); // .../web/<ts>/https://host/...
  if (/web\.archive\.org/i.test(url) && wb) host = wb[2];
  else { try { host = new URL(url).hostname; } catch { return null; } }
  host = host.toLowerCase().replace(/^www\./, '');
  const parts = host.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : host;
}
export function emailDomain(email) {
  if (!email || !email.includes('@')) return null;
  return email.split('@').pop().toLowerCase().replace(/^www\./, '');
}

const DOMAIN_TRUSTED = new Set(['VERIFIED', 'VERIFIED_ALIAS']);

/**
 * @param {object} data
 *   colleges: [{ name, sport, unitid, state, division }]
 *   domains:  [{ domain, unitid, status }]
 *   aliases:  [{ alias_key, unitid, alias_type }]
 *   canonicalByUnitidSport?: Map "unitid|sport" -> preferred canonical name
 */
export function createResolver(data) {
  const colleges = data.colleges || [];
  const domainMap = new Map();
  for (const d of data.domains || []) domainMap.set(String(d.domain).toLowerCase(), d);
  const aliasMap = new Map(); // alias_key -> Set(unitid)
  for (const a of data.aliases || []) {
    if (a.unitid == null) continue;
    if (!aliasMap.has(a.alias_key)) aliasMap.set(a.alias_key, new Set());
    aliasMap.get(a.alias_key).add(a.unitid);
  }
  // name/normkey indexes, scoped by sport
  const bySport = new Map(); // sport -> { names:Set, byNorm:Map(norm->Set(unitid)), byUnitid:Map, canon:Map(unitid->name), rows:[] , poolNames:[] }
  const canonOverride = data.canonicalByUnitidSport || new Map();
  for (const c of colleges) {
    if (!bySport.has(c.sport)) bySport.set(c.sport, { byNorm: new Map(), byUnitid: new Map(), canon: new Map(), rows: [], poolNames: [] });
    const s = bySport.get(c.sport);
    s.rows.push(c); s.poolNames.push(c.name);
    const nk = normalizeForMatch(c.name);
    if (!s.byNorm.has(nk)) s.byNorm.set(nk, new Set());
    s.byNorm.get(nk).add(c.unitid);
    if (c.unitid != null) {
      if (!s.byUnitid.has(c.unitid)) s.byUnitid.set(c.unitid, []);
      s.byUnitid.get(c.unitid).push(c);
    }
  }
  const canonicalName = (unitid, sport) => {
    const key = `${unitid}|${sport}`;
    if (canonOverride.has(key)) return canonOverride.get(key);
    const rows = (bySport.get(sport)?.byUnitid.get(unitid)) || [];
    if (!rows.length) return null;
    // deterministic: shortest name (canonical short form), tie-broken alphabetically
    return [...rows].map((r) => r.name).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  };
  const collegeState = (unitid, sport) => (bySport.get(sport)?.byUnitid.get(unitid) || [])[0]?.state || null;

  function result(unitid, sport, method, confidence, evidence, decision) {
    return { unitid: unitid ?? null, canonicalSchool: unitid != null ? canonicalName(unitid, sport) : null, method, confidence, evidence, decision };
  }

  function resolve(label, opts = {}) {
    const { sport, sourceUrl, email, state, unitid: explicitUnitid } = opts;
    const s = bySport.get(sport);
    if (!s) return result(null, sport, 'NO_SPORT', 0, `sport ${sport} not in corpus`, DECISION.WITHHOLD);

    // 1 explicit UNITID
    if (explicitUnitid != null && s.byUnitid.has(explicitUnitid)) {
      return result(explicitUnitid, sport, 'EXPLICIT_UNITID', 1, 'caller-supplied UNITID', DECISION.RESOLVED);
    }

    // 2 authoritative athletics domain (source URL)
    const sdom = registrableDomain(sourceUrl);
    if (sdom && domainMap.has(sdom)) {
      const d = domainMap.get(sdom);
      if (d.status === 'WRONG_INSTITUTION' || d.status === 'AMBIGUOUS') {
        return result(null, sport, `DOMAIN_${d.status}`, 0.2, `source domain ${sdom} flagged ${d.status}`, DECISION.REVIEW);
      }
      if (DOMAIN_TRUSTED.has(d.status) && d.unitid != null && s.byUnitid.has(d.unitid)) {
        return result(d.unitid, sport, 'DOMAIN', 0.99, `${sdom} → UNITID ${d.unitid} (${d.status})`, DECISION.RESOLVED);
      }
    }

    // 3 verified institution alias (normalized label as alias key)
    const nk = normalizeForMatch(label);
    if (aliasMap.has(nk)) {
      const us = [...aliasMap.get(nk)].filter((u) => s.byUnitid.has(u));
      if (us.length === 1) return result(us[0], sport, 'ALIAS', 0.95, `alias "${nk}" → UNITID ${us[0]}`, DECISION.RESOLVED);
      if (us.length > 1) return result(null, sport, 'ALIAS_AMBIGUOUS', 0.4, `alias "${nk}" maps to ${us.length} UNITIDs`, DECISION.REVIEW);
    }

    // 4 exact canonical name + state
    if (state) {
      const exact = s.rows.filter((r) => normalizeForMatch(r.name) === nk && (r.state || '').toUpperCase() === state.toUpperCase());
      const us = [...new Set(exact.map((r) => r.unitid))];
      if (us.length === 1) return result(us[0], sport, 'EXACT_NAME_STATE', 0.97, `exact normalized name + state ${state}`, DECISION.RESOLVED);
    }

    // 5 exact normalized name, unique in the sport
    if (s.byNorm.has(nk)) {
      const us = [...s.byNorm.get(nk)];
      if (us.length === 1) return result(us[0], sport, 'EXACT_NORMALIZED', 0.9, `unique normalized name "${nk}"`, DECISION.RESOLVED);
      return result(null, sport, 'NAME_AMBIGUOUS', 0.4, `normalized name "${nk}" maps to ${us.length} institutions`, DECISION.REVIEW);
    }

    // 6 constrained fuzzy — uniquely dominant AND corroborated
    const m = matchSchoolName(label, s.poolNames);
    if (m.matched_college && m.confidence >= 0.9) {
      const row = s.rows.find((r) => r.name === m.matched_college);
      const uid = row?.unitid ?? null;
      // corroboration: state agrees, or source/email domain resolves to same unitid
      const edom = emailDomain(email);
      const domUid = (sdom && DOMAIN_TRUSTED.has(domainMap.get(sdom)?.status) ? domainMap.get(sdom).unitid : null)
        || (edom && DOMAIN_TRUSTED.has(domainMap.get(edom)?.status) ? domainMap.get(edom).unitid : null);
      const stateOk = state && row && (row.state || '').toUpperCase() === state.toUpperCase();
      const domainOk = domUid != null && domUid === uid;
      // disambiguator must be consistent (matchSchoolName already penalises, but re-assert)
      const qd = disambiguatorTokens(label);
      const cok = qd.every((t) => normalizeForMatch(m.matched_college).split(' ').includes(t));
      if (uid != null && cok && (stateOk || domainOk)) {
        return result(uid, sport, 'FUZZY_CORROBORATED', Math.min(0.9, m.confidence), `fuzzy ${(m.confidence * 100).toFixed(0)}% + ${stateOk ? 'state' : 'domain'} corroboration`, DECISION.RESOLVED);
      }
      return result(uid, sport, 'FUZZY_UNCORROBORATED', m.confidence, `fuzzy ${(m.confidence * 100).toFixed(0)}% but no corroboration`, DECISION.REVIEW);
    }
    if (m.matched_college && m.confidence >= 0.7) {
      return result(null, sport, 'FUZZY_WEAK', m.confidence, `weak fuzzy ${(m.confidence * 100).toFixed(0)}% to ${m.matched_college}`, DECISION.REVIEW);
    }

    // 7 nothing trustworthy
    return result(null, sport, 'NONE', m.confidence || 0, 'no trustworthy evidence', DECISION.WITHHOLD);
  }

  return { resolve, canonicalName, _internals: { bySport, domainMap, aliasMap } };
}
