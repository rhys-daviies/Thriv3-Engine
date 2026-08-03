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
  let s = String(raw).toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' '); // drop parenthetical content
  s = s.replace(/[.']/g, ''); // strip periods and apostrophes
  s = s.replace(/\bst\b/g, 'saint'); // "St" (post-period-strip) -> "saint"
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const GENERIC_WORDS = /\b(university|college|of|the)\b/g;

function stripGenericWords(s) {
  return s.replace(GENERIC_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

/** Extracts the parenthetical content from a name, e.g. "Connecticut (UConn)" -> "UConn". */
function extractParenthetical(raw) {
  const match = String(raw || '').match(/\(([^)]*)\)/);
  return match ? match[1] : null;
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

  const parenthetical = extractParenthetical(raw);
  if (parenthetical) {
    const pBase = normalizeForMatch(parenthetical);
    add(pBase, 0);
    add(stripGenericWords(pBase), GENERIC_STRIP_PENALTY);
  }

  return variants;
}

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
  const candidates = candidateNames.map((name) => ({ name, variants: buildVariants(name) }));

  let best = { matched_college: null, confidence: 0 };
  for (const query of queryVariants) {
    for (const candidate of candidates) {
      for (const cVariant of candidate.variants) {
        const score = Math.max(0, similarity(query.text, cVariant.text) - query.penalty - cVariant.penalty);
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
