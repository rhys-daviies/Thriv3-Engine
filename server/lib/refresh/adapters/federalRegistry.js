/**
 * FEDERAL REGISTRY RESOLUTION — Phase 8A. Institution name -> IPEDS UNITID, deterministically.
 *
 * Source: the College Scorecard institution file (U.S. Department of Education; the federal
 * registry tier). Rules, in order, each requiring a UNIQUE answer inside the listing's states:
 *   1 exact key on the registry's legal name, a hyphen part of it ("Institution-Campus"), or an alias
 *   2 core key (generic words removed) — accepted only if EVERY word of the listed name appears in
 *     the registry name (so "Central Community College" can never become "Central College")
 *   ties: operating institutions first; for NJCAA, a unique two-year institution
 * An 8-digit Scorecard id is a LOCATION code (parent UNITID + suffix), never a UNITID: the
 * result is a campus of the 6-digit parent. Reviewed overrides (by association + key) come
 * first and are the only way a name the rules cannot place is ever placed.
 */
import { nameKey, coreKey, stateHint, wordsContained } from './institutionNames.js';

export function createFederalIndex(rows) {
  const exact = new Map(); const core = new Map();
  const add = (m, k, r) => { if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(r); };
  for (const r of rows) {
    const parts = String(r.INSTNM).split(/\s*-\s*/).filter((x) => x.length > 3);
    const names = [r.INSTNM, ...(parts.length > 1 ? parts : []), ...String(r.ALIAS || '').split(/[|,;]/).map((x) => x.trim()).filter((x) => x.length > 3)];
    for (const n of new Set(names)) { add(exact, nameKey(n), r); add(core, coreKey(n), r); }
  }
  return { exact, core };
}

const uniq = (list) => [...new Map(list.map((x) => [x.UNITID, x])).values()];

/**
 * listing: { association, official_name, region? }; opts: { states, overrides }
 * -> { unitid, ipeds_name, state, url, method } | { parent_unitid, location_code, ... } | { ambiguous[], method } | { method: 'NONE' }
 */
export function resolveFederal(index, listing, { states = null, overrides = {} } = {}) {
  const ov = overrides[`${listing.association}|${nameKey(listing.official_name)}`];
  if (ov) return { ...ov };
  const hint = stateHint(listing.official_name);
  const st = hint ? [hint] : states;
  const inStates = (r) => !st || st.includes(r.STABBR);
  const pick = (list, method) => {
    let u = uniq(list.filter(inStates));
    if (method === 'CORE_NAME_STATE') u = u.filter((r) => wordsContained(listing.official_name, r.INSTNM) || String(r.ALIAS || '').split(/[|,;]/).some((a) => a.trim() && wordsContained(listing.official_name, a)));
    const op = u.filter((r) => r.CURROPER !== '0'); let l = op.length ? op : u;
    if (l.length > 1 && listing.association === 'NJCAA') { const two = l.filter((r) => String(r.ICLEVEL) === '2'); if (two.length === 1) l = two; }
    if (l.length === 1) {
      const id = Number(l[0].UNITID);
      const base = { ipeds_name: l[0].INSTNM, state: l[0].STABBR, url: l[0].INSTURL, method: `SCORECARD_${method}` };
      return String(id).length === 8 ? { ...base, location_code: id, parent_unitid: Math.floor(id / 100) } : { ...base, unitid: id };
    }
    return l.length > 1 ? { ambiguous: l.map((r) => `${r.UNITID} ${r.INSTNM} ${r.STABBR}`), method: `SCORECARD_${method}` } : null;
  };
  return pick(index.exact.get(nameKey(listing.official_name)) || [], 'EXACT_NAME') || pick(index.core.get(coreKey(listing.official_name)) || [], 'CORE_NAME_STATE') || { method: 'NONE' };
}
