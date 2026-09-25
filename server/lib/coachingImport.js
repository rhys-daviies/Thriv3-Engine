import { distance } from 'fastest-levenshtein';
import { parseCsvToObjects } from './csv.js';
import { registrableDomain, emailDomain } from './institutionResolver.js';

/**
 * Free/consumer mailbox providers. A generic email domain is corroboration of
 * nothing — it must never force (or contradict) an institution assignment.
 */
export const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com',
]);

// Small penalty applied when a match required stripping a generic
// institution word ("University"/"College"/"Of"/"The"). Real, literal name
// matches should always outrank a match that only exists because generic
// words were collapsed away — otherwise a genuinely distinct school whose
// proper name happens to contain "College" (e.g. "Connecticut College") can
// tie with the actual intended match (e.g. "UConn") once both are stripped
// down to "connecticut". See normalizeForMatch/buildVariants.
const GENERIC_STRIP_PENALTY = 0.08;

/**
 * Base normalization shared by every variant: lowercase, drop a parenthetical
 * suffix, strip periods/apostrophes, expand "St" -> "Saint", collapse
 * whitespace. Does NOT strip generic institution words — that's a separate,
 * penalized variant (see buildVariants) so it never wins a tie against a
 * literal match.
 */
export function normalizeForMatch(raw) {
  if (!raw) return '';
  const s = String(raw).toLowerCase();
  // Parenthetical content is a DISAMBIGUATOR (state/campus), not noise and not
  // an alias. Phase 1/2 proved that dropping it collapses distinct schools
  // ("St. Mary's (TX)" == "Saint Mary's") and that promoting it as a standalone
  // candidate produces absurd 100%-confidence maps ("Concordia (Texas)" ->
  // "Texas"). We therefore KEEP the disambiguator, appended to the base so it
  // is part of the identity string and two disambiguated siblings never
  // normalise to the same value.
  const norm = (t) => t
    .replace(/[.']/g, '')
    .replace(/\bst\b/g, 'saint')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const disamb = [...s.matchAll(/\(([^)]*)\)/g)].map((m) => norm(m[1])).filter(Boolean);
  const base = norm(s.replace(/\([^)]*\)/g, ' '));
  return disamb.length ? `${base} ${disamb.join(' ')}`.trim() : base;
}

/** The normalised disambiguator tokens of a name, e.g. "St. Mary's (TX)" -> ["tx"]. */
export function disambiguatorTokens(raw) {
  return [...String(raw || '').toLowerCase().matchAll(/\(([^)]*)\)/g)]
    .map((m) => m[1].replace(/[.']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const GENERIC_WORDS = /\b(university|college|of|the)\b/g;

function stripGenericWords(s) {
  return s.replace(GENERIC_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Builds every normalization variant worth trying for a name: the base form,
 * the generic-word-stripped form (penalized), and — for the CSV side — the
 * parenthetical content alone (e.g. "UConn"), also tried both ways.
 */
function buildVariants(raw) {
  const variants = [];
  const seen = new Set();
  const add = (text, penalty) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    variants.push({ text, penalty });
  };

  const base = normalizeForMatch(raw);
  add(base, 0);
  add(stripGenericWords(base), GENERIC_STRIP_PENALTY);
  // NOTE: the parenthetical is deliberately NOT added as a standalone variant.
  // Promoting it (e.g. "Concordia (Texas)" -> "Texas") is the Phase-1 defect.
  // It is retained by normalizeForMatch as a disambiguator instead, and
  // matchSchoolName enforces disambiguator consistency below.

  return variants;
}

// Penalty applied when the query carries a disambiguator (e.g. "(TX)") that the
// candidate does not. Sized to push a base-collision (e.g. "St. Mary's (TX)"
// against "Saint Mary's") well below any resolve-worthy threshold, so the
// matcher declines rather than silently picking a different institution.
const DISAMBIGUATOR_MISMATCH_PENALTY = 0.5;

/** Similarity in [0,1]: 1 - normalized Levenshtein distance. */
function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - distance(a, b) / maxLen;
}

/**
 * Matches a CSV school_name against a list of candidate College.name values.
 * Scores every (query variant x candidate variant) pair — including the
 * parenthetical content alone (e.g. "UConn" out of "Connecticut (UConn)"),
 * since for some schools the abbreviation in parentheses is the more useful
 * signal — and returns the best-scoring pair, net of the generic-word-strip
 * penalty so literal matches always win ties over collapsed ones.
 */
export function matchSchoolName(schoolName, candidateNames) {
  const queryVariants = buildVariants(schoolName);
  const queryDisamb = disambiguatorTokens(schoolName);
  const candidates = candidateNames.map((name) => ({
    name,
    variants: buildVariants(name),
    // The candidate's full normalised string carries its own disambiguator
    // tokens; we require the query's disambiguator to be present there.
    tokens: new Set(normalizeForMatch(name).split(' ')),
  }));

  let best = { matched_college: null, confidence: 0 };
  for (const candidate of candidates) {
    // Disambiguator consistency: if the query says "(TX)" the candidate must
    // carry "tx", otherwise this is a different institution and the pair is
    // penalised out of resolve-worthy range. Prevents "St. Mary's (TX)" from
    // resolving to "Saint Mary's".
    const disambPenalty = queryDisamb.some((t) => !candidate.tokens.has(t))
      ? DISAMBIGUATOR_MISMATCH_PENALTY
      : 0;
    for (const query of queryVariants) {
      for (const cVariant of candidate.variants) {
        const score = Math.max(
          0,
          similarity(query.text, cVariant.text) - query.penalty - cVariant.penalty - disambPenalty,
        );
        if (score > best.confidence) {
          best = { matched_college: candidate.name, confidence: score };
        }
      }
    }
  }
  return best;
}

/**
 * Builds the institution index the corroboration rule needs, from raw rows:
 *   - domains: [{ domain, unitid, status }] from athletics_domains
 *   - colleges: [{ name, unitid, website_domain }] from colleges (any sport)
 * Returns { domainToUnitid, nameToUnitid, unitidToName, sharedDomains }.
 * A domain that authoritative sources map to MORE THAN ONE unitid is treated as
 * shared/ambiguous (sharedDomains) and never used to force an assignment.
 */
export function buildInstitutionIndex({ domains = [], colleges = [] } = {}) {
  const nameToUnitid = new Map();
  const unitidToName = new Map();
  for (const c of colleges) {
    if (c.name != null && c.unitid != null) nameToUnitid.set(c.name, Number(c.unitid));
    if (c.unitid != null && !unitidToName.has(Number(c.unitid))) unitidToName.set(Number(c.unitid), c.name);
  }
  // domain -> set of unitids, from VERIFIED athletics hosts + colleges' academic website_domain
  const domainUnitids = new Map();
  const add = (dom, unitid) => {
    if (!dom || unitid == null) return;
    const d = String(dom).replace(/^www\./, '').toLowerCase();
    if (!domainUnitids.has(d)) domainUnitids.set(d, new Set());
    domainUnitids.get(d).add(Number(unitid));
  };
  for (const r of domains) {
    if (['VERIFIED', 'VERIFIED_ALIAS'].includes(r.status) && r.unitid != null) add(r.domain, r.unitid);
  }
  for (const c of colleges) if (c.website_domain) add(c.website_domain, c.unitid);

  const domainToUnitid = new Map();
  const sharedDomains = new Set();
  for (const [d, ids] of domainUnitids) {
    if (ids.size === 1) domainToUnitid.set(d, [...ids][0]);
    else sharedDomains.add(d); // one host, several institutions -> ambiguous
  }
  return { domainToUnitid, nameToUnitid, unitidToName, sharedDomains };
}

/**
 * Resolve which institution a scraped coach should be filed under, with a HARD
 * corroboration rule that prevents the same/near-name institution collisions
 * Phase 3A found (e.g. a "Dominican" scrape filed under Dominican (CA) when the
 * source domain dustars.com and email dom.edu are Dominican University IL).
 *
 * Evidence precedence (strongest first):
 *   1. authoritative athletics SOURCE domain (from source_url)
 *   2/3. corroborating institution/email domain (colleges.website_domain / edu)
 *   ...folded into institutionIndex.domainToUnitid...
 *   5. constrained fuzzy NAME match (matchSchoolName) — the weakest signal.
 *
 * Rules:
 *   - Generic mailbox domains and shared/ambiguous domains corroborate nothing.
 *   - If strong domain evidence resolves to a DIFFERENT institution than the
 *     name match, DO NOT choose the name: return REVIEW_INSTITUTION_CONFLICT
 *     with both competing unitids and the evidence, so nothing is filed wrongly.
 *   - Weak name matching never overrides contradictory strong domain evidence.
 */
export function resolveCoachInstitution({ scrapedName, sourceUrl, email, candidateNames, institutionIndex = null }) {
  const nameMatch = matchSchoolName(scrapedName, candidateNames);
  const round = (x) => Math.round(x * 1000) / 1000;
  const proposedUnitid = institutionIndex?.nameToUnitid?.get(nameMatch.matched_college) ?? null;

  const srcDom = registrableDomain(sourceUrl);
  const emDom = emailDomain(email);
  const domUnitid = (dom) => {
    if (!dom || GENERIC_EMAIL_DOMAINS.has(dom)) return null;
    if (institutionIndex?.sharedDomains?.has(dom)) return null;
    const u = institutionIndex?.domainToUnitid?.get(dom);
    return u == null ? null : Number(u);
  };
  const srcU = domUnitid(srcDom);
  const emU = domUnitid(emDom);
  const domainUnitid = srcU != null ? srcU : emU;
  const domainSignal = srcU != null ? 'ATHLETICS_SOURCE_DOMAIN' : (emU != null ? 'EMAIL_DOMAIN' : null);

  const base = {
    scrapedName, proposedCanonical: nameMatch.matched_college, proposedUnitid,
    sourceDomain: srcDom, emailDomain: emDom, nameConfidence: round(nameMatch.confidence),
  };

  if (domainUnitid != null && proposedUnitid != null && domainUnitid !== proposedUnitid) {
    return {
      ...base, decision: 'REVIEW_INSTITUTION_CONFLICT', domainSignal,
      competingUnitids: [proposedUnitid, domainUnitid],
      domainInstitution: institutionIndex?.unitidToName?.get(domainUnitid) ?? null,
    };
  }
  if (domainUnitid != null) {
    return {
      ...base, decision: 'RESOLVED', basis: domainSignal, confidence: 0.99,
      matched_college: institutionIndex?.unitidToName?.get(domainUnitid) ?? nameMatch.matched_college,
      unitid: domainUnitid,
    };
  }
  return {
    ...base, decision: nameMatch.matched_college ? 'RESOLVED' : 'UNRESOLVED', basis: 'NAME_MATCH',
    matched_college: nameMatch.matched_college, unitid: proposedUnitid, confidence: round(nameMatch.confidence),
  };
}

/**
 * Parses the coaching-contacts CSV (school_name, group, coach_name,
 * coach_title, email, source_url, status), drops any row with a blank email
 * (those coaches are never imported), and groups the remaining rows by
 * school_name.
 */
export function parseAndGroupCoachingCsv(csvText) {
  const rows = parseCsvToObjects(csvText);
  const bySchool = new Map();
  let droppedNoEmail = 0;

  for (const row of rows) {
    const schoolName = (row.school_name || '').trim();
    if (!schoolName) continue;
    if (!bySchool.has(schoolName)) bySchool.set(schoolName, { imported: [], dropped: [] });
    const entry = bySchool.get(schoolName);

    const email = (row.email || '').trim();
    if (!email) {
      droppedNoEmail++;
      entry.dropped.push({ name: row.coach_name, title: row.coach_title });
      continue;
    }

    entry.imported.push({
      name: (row.coach_name || '').trim(),
      title: (row.coach_title || '').trim(),
      email,
      source_url: (row.source_url || '').trim(),
    });
  }

  return { bySchool, droppedNoEmail };
}

/**
 * Builds the full preview report: for each unique CSV school_name, the
 * best-matching College.name, its confidence score, and the coach rows that
 * would be imported (plus any dropped for missing email). Writes nothing.
 */
export function buildCoachingImportReport(csvText, existingCollegeNames, institutionIndex = null) {
  const { bySchool, droppedNoEmail } = parseAndGroupCoachingCsv(csvText);

  const schools = [];
  for (const [schoolName, entry] of bySchool.entries()) {
    if (institutionIndex) {
      const rep = entry.imported.find((c) => c.source_url) || entry.imported.find((c) => c.email) || {};
      const res = resolveCoachInstitution({
        scrapedName: schoolName, sourceUrl: rep.source_url, email: rep.email,
        candidateNames: existingCollegeNames, institutionIndex,
      });
      schools.push({
        school_name: schoolName,
        matched_college: res.decision === 'REVIEW_INSTITUTION_CONFLICT' ? null : (res.matched_college ?? null),
        confidence: res.decision === 'REVIEW_INSTITUTION_CONFLICT' ? 0 : Math.round((res.confidence ?? 0) * 1000) / 1000,
        decision: res.decision,
        resolution_basis: res.basis || res.domainSignal || null,
        institution_conflict: res.decision === 'REVIEW_INSTITUTION_CONFLICT'
          ? { proposed_by_name: res.proposedCanonical, domain_institution: res.domainInstitution, competing_unitids: res.competingUnitids, source_domain: res.sourceDomain, email_domain: res.emailDomain }
          : null,
        coaches_to_import: entry.imported,
        coaches_dropped_no_email: entry.dropped,
      });
      continue;
    }
    const match = matchSchoolName(schoolName, existingCollegeNames);
    schools.push({
      school_name: schoolName,
      matched_college: match.matched_college,
      confidence: Math.round(match.confidence * 1000) / 1000,
      coaches_to_import: entry.imported,
      coaches_dropped_no_email: entry.dropped,
    });
  }

  schools.sort((a, b) => a.confidence - b.confidence);

  return {
    total_schools: schools.length,
    total_coaches_to_import: schools.reduce((n, s) => n + s.coaches_to_import.length, 0),
    total_coaches_dropped_no_email: droppedNoEmail,
    schools,
  };
}
