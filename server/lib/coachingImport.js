import { distance } from 'fastest-levenshtein';
import { parseCsvToObjects } from './csv.js';

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
    });
  }

  return { bySchool, droppedNoEmail };
}

/**
 * Builds the full preview report: for each unique CSV school_name, the
 * best-matching College.name, its confidence score, and the coach rows that
 * would be imported (plus any dropped for missing email). Writes nothing.
 */
export function buildCoachingImportReport(csvText, existingCollegeNames) {
  const { bySchool, droppedNoEmail } = parseAndGroupCoachingCsv(csvText);

  const schools = [];
  for (const [schoolName, entry] of bySchool.entries()) {
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
