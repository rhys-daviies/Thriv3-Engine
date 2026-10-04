/**
 * INSTITUTION NAME KEYS — Phase 8A. Closed, deterministic rewrites only (no similarity scores).
 *
 * Governing-body listings print short or styled names ("CCBC Essex", "Truckee Meadows CC",
 * "Montgomery College (MD)"); the federal registry prints legal names ("Cochise County
 * Community College District"). A key is used to FIND a candidate; it never writes identity
 * on its own — a match must be unique within the listing's states and, for an existing
 * programme, agree with that programme's UNITID (see server/data/.../build_universe).
 */
const STATE = { AL: 1, AK: 1, AZ: 1, AR: 1, CA: 1, CO: 1, CT: 1, DE: 1, DC: 1, FL: 1, GA: 1, HI: 1, ID: 1, IL: 1, IN: 1, IA: 1, KS: 1, KY: 1, LA: 1, ME: 1, MD: 1, MA: 1, MI: 1, MN: 1, MS: 1, MO: 1, MT: 1, NE: 1, NV: 1, NH: 1, NJ: 1, NM: 1, NY: 1, NC: 1, ND: 1, OH: 1, OK: 1, OR: 1, PA: 1, RI: 1, SC: 1, SD: 1, TN: 1, TX: 1, UT: 1, VT: 1, VA: 1, WA: 1, WV: 1, WI: 1, WY: 1 };

/** State qualifier printed in a name: "Montgomery College (MD)", "GateWay Community College - AZ". */
export function stateHint(name) {
  const s = String(name || '');
  const m = s.match(/\(([A-Z]{2})\)\s*$/) || s.match(/\s[-–]\s*([A-Z]{2})\s*$/) || s.match(/,\s*([A-Z]{2})\s*$/);
  return m && STATE[m[1]] ? m[1] : null;
}

/** Exact key: lowercase, &->and, qualifiers and punctuation removed, trailing CC/CTC expanded. */
export function nameKey(name) {
  let s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/\(([A-Z]{2})\)\s*$/, '').replace(/\s[-–]\s*[A-Z]{2}\s*$/, '');
  s = s.replace(/&/g, ' and ').replace(/[’']/g, '').toLowerCase();
  s = s.replace(/\bcc\b/g, 'community college').replace(/\bctc\b/g, 'community and technical college').replace(/\bjc\b/g, 'junior college');
  s = s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.replace(/^the /, '');
}

const GENERIC = /\b(community and technical college|community college district|community college|technical college|junior college|state college|college|university|district|campus|of|the|and)\b/g;
/** Core key: the distinguishing words once generic institution words are removed. */
export function coreKey(name) {
  return nameKey(name).replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
}

/** Every word of the listed name appears in the candidate's name (the candidate may add words). */
export function wordsContained(listed, candidate) {
  const c = new Set(nameKey(candidate).split(' '));
  return nameKey(listed).split(' ').every((w) => c.has(w));
}

/** Region -> states it covers (discovery aid for disambiguation only; never identity). */
export const NJCAA_REGION_STATES = Object.freeze({
  1: ['AZ', 'NV'], 2: ['AR', 'OK'], 3: ['NY', 'PA'], 4: ['IL', 'IN', 'WI'], 5: ['TX', 'NM', 'OK'], 6: ['KS'], 7: ['TN', 'KY'],
  8: ['FL'], 9: ['CO', 'NE', 'WY'], 10: ['NC', 'SC', 'VA'], 11: ['IA', 'NE'], 12: ['MI', 'OH', 'IN'], 13: ['MN', 'ND', 'SD', 'WI'],
  14: ['TX', 'LA'], 15: ['NY'], 16: ['MO'], 17: ['GA'], 18: ['UT', 'ID', 'NV', 'OR', 'WA', 'CO', 'MT', 'CA'], 19: ['NJ', 'PA', 'DE'],
  20: ['MD', 'PA', 'WV'], 21: ['MA', 'RI', 'CT', 'NH', 'ME', 'VT'], 22: ['AL'], 23: ['LA', 'MS'], 24: ['IL', 'IN', 'MO'],
});
