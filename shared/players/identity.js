/**
 * PLAYER-HISTORY IDENTITY — Phase 8B.1A.
 *
 *   A NAME MATCH IS A CANDIDATE. IT IS NOT PERSON IDENTITY.
 *
 * Two different things live in the roster data and must never be collapsed:
 *
 *   ROSTER OBSERVATION   a name printed on programme P's official roster for season S. Factual
 *                        when the source is valid. Needs no global person resolution, and an
 *                        uncertain identity never blocks storing one.
 *   PERSON IDENTITY      a claim that two observations (different programmes or seasons) are the
 *                        same human. Needs corroboration. Uncertain identity BLOCKS transfer,
 *                        prior-programme and cross-school progression claims.
 *
 * Phase 8B.1 measured the old rule (projectRosterMinutes.js: "the only programme with this
 * letters-only name last season") at 4,431 cross-programme links, 1,139 of them contradicted by
 * hometown. This module is the replacement. It decides ONE pairwise claim from the signals a
 * caller has gathered, and it is pure: no DB, no network.
 *
 * WHAT IS NOT A SIGNAL HERE
 *   nationality / country — derived from the hometown string in this dataset (USA/International),
 *     so counting it beside hometown would count one fact twice;
 *   graduation year — derived from the class label, same reason;
 *   email, social profiles, search snippets — never.
 *
 * Only VERIFIED_SAME_PERSON is factual. PROBABLE_SAME_PERSON is internal (review queue, operator
 * "possible transfer"), never canonical history without an approved review.
 */
import { canonicalHometown, HOMETOWN_TABLES } from '../lifecycle/hometown.js';
import { readClassYear } from '../classYear.js';
import { canonicalPosition } from '../positions.js';

export const LINK_DECISION = Object.freeze({
  VERIFIED_SAME_PERSON: 'VERIFIED_SAME_PERSON',
  PROBABLE_SAME_PERSON: 'PROBABLE_SAME_PERSON',
  CANDIDATE: 'CANDIDATE',
  AMBIGUOUS: 'AMBIGUOUS',
  CONTRADICTED: 'CONTRADICTED',
  DIFFERENT_PERSON: 'DIFFERENT_PERSON',
});
/** The ONLY decisions that may become factual history automatically. */
export const FACTUAL_DECISIONS = Object.freeze([LINK_DECISION.VERIFIED_SAME_PERSON]);
export const isFactual = (d) => FACTUAL_DECISIONS.includes(d);

export const EVIDENCE_CLASS = Object.freeze({
  /** The destination's official roster names the prior college in a structured field. */
  EXPLICIT_PRIOR_SCHOOL: 'EXPLICIT_PRIOR_SCHOOL',
  /** Hometown + class progression + uncommon name, nothing against. */
  MULTI_SIGNAL: 'MULTI_SIGNAL',
  HOMETOWN_ONLY: 'HOMETOWN_ONLY',
  NAME_ONLY: 'NAME_ONLY',
  CONFLICT: 'CONFLICT',
  REVIEWED: 'REVIEWED',
  /** Same programme, adjacent season, same name: scoped continuity, never a cross-programme claim. */
  PROGRAMME_SCOPED: 'PROGRAMME_SCOPED',
});

export const RELATION = Object.freeze({
  /** Same programme, adjacent season: the returning-player read every same-programme join uses. */
  SAME_PROGRAMME_CONTINUATION: 'SAME_PROGRAMME_CONTINUATION',
  /** Different programme, adjacent season: a transfer claim. */
  CROSS_PROGRAMME_PRIOR: 'CROSS_PROGRAMME_PRIOR',
  /** A structured prior school with no prior roster observation on file (outside coverage). */
  EXPLICIT_PRIOR_INSTITUTION: 'EXPLICIT_PRIOR_INSTITUTION',
});

/** The identity-link name key: accents folded (not dropped), letters only. */
export const linkNameKey = (name) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]/g, '');

// ------------------------------------------------------------------ hometown
export const HOMETOWN = Object.freeze({
  MATCH: 'MATCH',                         // canonical forms equal
  FORMAT_VARIANT: 'FORMAT_VARIANT',       // equal once a known formatting difference is removed
  PARTIAL: 'PARTIAL',                     // one side gives only a region/country, consistent with the other
  SAME_REGION_OTHER_CITY: 'SAME_REGION_OTHER_CITY',
  DIFFERENT_REGION: 'DIFFERENT_REGION',
  UNKNOWN: 'UNKNOWN',
});
const UK = new Set(['england', 'scotland', 'wales', 'northern ireland', 'united kingdom']);
const CA_PROVINCES = new Set(['ontario', 'ont', 'on', 'quebec', 'qc', 'que', 'british columbia', 'bc', 'alberta', 'alta', 'ab', 'manitoba', 'man', 'mb', 'saskatchewan', 'sask', 'sk', 'nova scotia', 'ns', 'new brunswick', 'nb', 'newfoundland', 'nl', 'pei', 'prince edward island', 'pe']);
const tidy = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
/**
 * Relaxed parse for the FORMAT_VARIANT test ONLY: drops a high-school/club tail after " / " or in
 * brackets, folds accents, reads "Saint"/"St", "Fort"/"Ft", "Mount"/"Mt" as one word, maps UK nations
 * and Canadian provinces to their country. Explicit tables; no similarity metric.
 */
function relaxed(value) {
  let raw = String(value ?? '').split(/\s+\/\s+|\s*\|\s*/)[0].replace(/\([^)]*\)/g, ' ');
  raw = tidy(raw).replace(/\bsaint\b/g, 'st').replace(/\bfort\b/g, 'ft').replace(/\bmount\b/g, 'mt').replace(/\bturkiye\b/g, 'turkey');
  // a missing comma before a recognised state/country ("Millersville. Pa.", "Brandon Miss.")
  if (!raw.includes(',')) { const m = raw.match(/^(.+?)\s+([a-z]{2,5})$/); if (m && (HOMETOWN_TABLES.US_STATES[m[2]] || HOMETOWN_TABLES.COUNTRIES[m[2]])) raw = `${m[1]}, ${m[2]}`; }
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const regionOf = (t) => {
    if (HOMETOWN_TABLES.US_STATES[t]) return { region: HOMETOWN_TABLES.US_STATES[t], country: 'usa' };
    if (CA_PROVINCES.has(t)) return { region: t, country: 'canada' };
    const c = HOMETOWN_TABLES.COUNTRIES[t] || t;
    return { region: c, country: UK.has(c) ? 'united kingdom' : c };
  };
  if (parts.length === 1) { const r = regionOf(parts[0]); return HOMETOWN_TABLES.US_STATES[parts[0]] || HOMETOWN_TABLES.COUNTRIES[parts[0]] || CA_PROVINCES.has(parts[0]) ? { city: null, ...r } : { city: parts[0], region: null, country: null }; }
  const tail = parts[parts.length - 1]; const r = regionOf(tail);
  // "Toronto, Ontario, Canada": the province is the region, the last part the country
  if (parts.length >= 3) { const mid = regionOf(parts[parts.length - 2]); if (mid.country !== mid.region || CA_PROVINCES.has(parts[parts.length - 2]) || HOMETOWN_TABLES.US_STATES[parts[parts.length - 2]]) return { city: parts.slice(0, -2).join(' '), region: mid.region, country: r.country }; }
  return { city: parts.slice(0, -1).join(' ').replace(/[^a-z ]/g, '').trim() || null, ...r };
}
/** The relaxed parse, exported for DIAGNOSIS ONLY (Part C typo/suburb analysis). Never an identity input. */
export const hometownParts = (v) => relaxed(v);
export function compareHometown(a, b) {
  const x = canonicalHometown(a); const y = canonicalHometown(b);
  if (x && y && x === y) return HOMETOWN.MATCH;
  const p = relaxed(a); const q = relaxed(b);
  if (!p || !q) return HOMETOWN.UNKNOWN;
  const sameCountry = p.country && q.country && p.country === q.country;
  const sameRegion = p.region && q.region && (p.region === q.region || (UK.has(p.region) && UK.has(q.region) && (p.region === 'united kingdom' || q.region === 'united kingdom')));
  // a country-level tail ("Toronto, Canada") agrees with any region of that country; two different
  // states/provinces of one country never do ("Springfield, IL" vs "Springfield, MO")
  const countryLevel = sameCountry && (p.region === p.country || q.region === q.country);
  if (p.city && q.city && p.city === q.city && (sameRegion || countryLevel || !p.region || !q.region)) return HOMETOWN.FORMAT_VARIANT;
  if ((!p.city || !q.city) && (sameRegion || countryLevel)) return HOMETOWN.PARTIAL;
  if (!p.city || !q.city || !p.region || !q.region) return HOMETOWN.UNKNOWN;
  if (sameRegion) return HOMETOWN.SAME_REGION_OTHER_CITY;
  if (p.country && q.country && !sameCountry) return HOMETOWN.DIFFERENT_REGION;
  return HOMETOWN.DIFFERENT_REGION;
}

// ------------------------------------------------------------------ class / position / height
export const CLASS_STEP = Object.freeze({ PROGRESSES: 'PROGRESSES', REPEATS: 'REPEATS', SKIPS: 'SKIPS', BACKWARDS: 'BACKWARDS', RESET_TO_FRESHMAN: 'RESET_TO_FRESHMAN', UNKNOWN: 'UNKNOWN' });
const RANK = { FRESHMAN: 1, SOPHOMORE: 2, JUNIOR: 3, SENIOR: 4, GRADUATE: 5 };
/**
 * prior -> current class, one season apart. REPEATS covers redshirts and repeated eligibility
 * years; SKIPS a two-step jump. Neither is proof of anything. RESET_TO_FRESHMAN (a true,
 * non-redshirt first-year after a college season) and BACKWARDS are conflicts.
 */
export function classStep(priorLabel, currentLabel) {
  const a = readClassYear(priorLabel); const b = readClassYear(currentLabel);
  const ra = RANK[a.klass]; const rb = RANK[b.klass];
  if (!ra || !rb) return CLASS_STEP.UNKNOWN;
  if (rb === 1 && !b.redshirt && ra >= 1) return CLASS_STEP.RESET_TO_FRESHMAN;
  if (rb === ra + 1) return CLASS_STEP.PROGRESSES;
  if (rb === ra) return CLASS_STEP.REPEATS;
  if (rb === ra + 2) return CLASS_STEP.SKIPS;
  return rb < ra ? CLASS_STEP.BACKWARDS : CLASS_STEP.SKIPS;
}
export function positionCompat(a, b) {
  const x = canonicalPosition(a); const y = canonicalPosition(b);
  if (x === 'UNKNOWN' || y === 'UNKNOWN') return 'UNKNOWN';
  return x === y ? 'SAME' : 'DIFFERENT';
}
/** Inches from "5-11", "5'11\"", "5′11″", "180 cm"; null when unreadable. */
export function heightInches(h) {
  const s = String(h ?? '').replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  let m = s.match(/(\d)\s*['-]\s*(\d{1,2})/); if (m) return Number(m[1]) * 12 + Number(m[2]);
  m = s.match(/(\d{3})\s*cm/i); if (m) return Math.round(Number(m[1]) / 2.54);
  return null;
}
export function heightCompat(a, b) {
  const x = heightInches(a); const y = heightInches(b);
  if (x == null || y == null) return 'UNKNOWN';
  const d = Math.abs(x - y); return d <= 1 ? 'COMPATIBLE' : d >= 3 ? 'CONFLICT' : 'UNCLEAR';
}

// ------------------------------------------------------------------ explicit evidence
export const EXPLICIT = Object.freeze({
  AGREES: 'AGREES',                               // a structured prior-school value resolves to the prior programme
  NAMES_OTHER_COLLEGE: 'NAMES_OTHER_COLLEGE',     // it resolves to a different college programme
  /** It names another college whose EARLIER roster carries the name: the bio lists an earlier stop. Path-consistent, neutral. */
  EARLIER_SCHOOL_ON_FILE: 'EARLIER_SCHOOL_ON_FILE',
  HIGH_SCHOOL_ON_COLLEGE_AWARE_PAGE: 'HIGH_SCHOOL_ON_COLLEGE_AWARE_PAGE',
  UNINFORMATIVE: 'UNINFORMATIVE',                 // a high school on a page that lists high schools for everyone, ambiguous, unresolved
  NONE: 'NONE',
});

/**
 * Decide one pairwise identity claim.
 *
 * @param {object} s
 *   relation          RELATION.*
 *   explicit          EXPLICIT.*
 *   hometown          HOMETOWN.*
 *   classStep         CLASS_STEP.*
 *   position          'SAME' | 'DIFFERENT' | 'UNKNOWN'
 *   height            'COMPATIBLE' | 'CONFLICT' | 'UNCLEAR' | 'UNKNOWN'
 *   priorCandidates   programmes carrying the name in the prior season (excluding the destination)
 *   priorContinues    the prior observation's name is ALSO on the prior programme's next-season roster
 *   continuationHometown  HOMETOWN.* of that continuation against the prior observation
 *   commonName        the name is carried by >= 3 programmes across the sport's data
 *   reviewed          { decision } from an APPROVED review, if any
 * @returns {{ decision, evidence_class, reasons: string[] }}
 */
export function decideLink(s) {
  const r = []; const D = LINK_DECISION; const E = EVIDENCE_CLASS;
  if (s.reviewed?.decision && Object.values(D).includes(s.reviewed.decision)) return { decision: s.reviewed.decision, evidence_class: E.REVIEWED, reasons: ['approved review'] };
  if (s.relation === RELATION.SAME_PROGRAMME_CONTINUATION) {
    // the same programme's adjacent roster: the read projected minutes, retention and arrivals
    // already rely on. A conflict still withholds it from history.
    if (s.hometown === HOMETOWN.DIFFERENT_REGION || s.classStep === CLASS_STEP.RESET_TO_FRESHMAN || s.classStep === CLASS_STEP.BACKWARDS) return { decision: D.CONTRADICTED, evidence_class: E.CONFLICT, reasons: [`same-programme continuation contradicted (${s.hometown}, ${s.classStep})`] };
    return { decision: D.VERIFIED_SAME_PERSON, evidence_class: E.PROGRAMME_SCOPED, reasons: ['same programme, adjacent season, same name'] };
  }
  const hard = [];
  if (s.priorContinues) hard.push('the prior observation continues at the prior programme the same season (simultaneous rostering)');
  if (s.explicit === EXPLICIT.NAMES_OTHER_COLLEGE) hard.push('the destination roster names a different previous college');
  const soft = [];
  if (s.hometown === HOMETOWN.DIFFERENT_REGION) soft.push('hometowns in different states/countries');
  if (s.classStep === CLASS_STEP.RESET_TO_FRESHMAN) soft.push('true freshman after a college season');
  if (s.classStep === CLASS_STEP.BACKWARDS) soft.push('class went backwards');
  if (s.height === 'CONFLICT') soft.push('height differs by 3+ inches');
  if (s.explicit === EXPLICIT.HIGH_SCHOOL_ON_COLLEGE_AWARE_PAGE) soft.push('the destination roster lists a high school where it lists colleges for transfers');

  if (s.explicit === EXPLICIT.EARLIER_SCHOOL_ON_FILE) r.push('the destination roster names an earlier stop that is on file');
  if (s.explicit === EXPLICIT.AGREES && !hard.length) {
    // Measured on 1,321 links with a resolvable structured previous school: hometown in another
    // state/country did NOT predict a different person (50 of 61 such links were explicitly
    // confirmed). So a hometown difference alone never downgrades the source's own statement;
    // a class reset, a backwards class or a height conflict does (review).
    const downgrade = soft.filter((x) => !/^hometowns/.test(x));
    if (downgrade.length) return { decision: D.PROBABLE_SAME_PERSON, evidence_class: E.EXPLICIT_PRIOR_SCHOOL, reasons: ['structured previous school names the prior programme', ...downgrade.map((x) => `but ${x}`)] };
    return { decision: D.VERIFIED_SAME_PERSON, evidence_class: E.EXPLICIT_PRIOR_SCHOOL, reasons: ['structured previous school on the destination roster names the prior programme, and the name is on that programme\'s prior roster', ...soft.map((x) => `note: ${x}`)] };
  }
  if (hard.length) {
    const different = (s.priorContinues && s.continuationHometown === HOMETOWN.MATCH) || (s.explicit === EXPLICIT.NAMES_OTHER_COLLEGE && soft.length);
    return { decision: different ? D.DIFFERENT_PERSON : D.CONTRADICTED, evidence_class: E.CONFLICT, reasons: [...hard, ...soft] };
  }
  if ((s.priorCandidates ?? 1) > 1) return { decision: D.AMBIGUOUS, evidence_class: E.NAME_ONLY, reasons: [`name on ${s.priorCandidates} programmes in the prior season`] };
  if (soft.length) return { decision: D.CONTRADICTED, evidence_class: E.CONFLICT, reasons: soft };

  const home = s.hometown === HOMETOWN.MATCH ? 2 : (s.hometown === HOMETOWN.FORMAT_VARIANT ? 1 : 0);
  const cls = s.classStep === CLASS_STEP.PROGRESSES || s.classStep === CLASS_STEP.REPEATS ? 1 : 0;
  // MULTI_SIGNAL, validated against 729 links whose destination roster names the prior college:
  // 723 agree (99.2%, Wilson lower bound 98.2%), and the 6 that do not are same-hometown players
  // whose bio lists an earlier school. Position is not required (players re-list positions);
  // a common name (>= 3 programmes) never qualifies.
  if (home === 2 && cls && !s.commonName) {
    r.push(`same hometown, class ${s.classStep === CLASS_STEP.PROGRESSES ? 'progresses one year' : 'repeats (redshirt/repeat year)'}, name carried by < 3 programmes, nothing against`);
    if (s.position === 'DIFFERENT') r.push('note: listed position changed');
    if (s.height === 'COMPATIBLE') r.push('height agrees');
    return { decision: D.VERIFIED_SAME_PERSON, evidence_class: E.MULTI_SIGNAL, reasons: r };
  }
  if (home >= 1) return { decision: D.PROBABLE_SAME_PERSON, evidence_class: E.HOMETOWN_ONLY, reasons: [`hometown ${s.hometown.toLowerCase()}${cls ? ', class compatible' : `, class ${String(s.classStep).toLowerCase()}`}${s.commonName ? ', common name' : ''}`] };
  if (s.hometown === HOMETOWN.SAME_REGION_OTHER_CITY || s.hometown === HOMETOWN.PARTIAL) return { decision: D.AMBIGUOUS, evidence_class: E.NAME_ONLY, reasons: [`hometown ${s.hometown.toLowerCase()}`] };
  return { decision: D.CANDIDATE, evidence_class: E.NAME_ONLY, reasons: ['name match only'] };
}
