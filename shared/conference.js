/**
 * A conference name as it should appear in prose.
 *
 * Two rows in `colleges` carry a division suffix that exists to disambiguate
 * our own data — "MWC-D3" and "MIAA-D3", because both conferences also exist
 * at another division. Neither is what the conference is called, and "congrats
 * on winning the MWC-D3 last year" tells a coach we are reading off a
 * spreadsheet.
 *
 * Display only. The stored value is untouched, because it is what the champion
 * lookup joins on.
 *
 * Deliberately narrow: it strips a trailing division tag and nothing else.
 * "Atlantic 10", "Big 12", "Northeast-10", "Empire 8" and "C2C" are real names
 * that a looser pattern would mangle, and all 124 distinct champion names and
 * 251 conference names on file were checked against this before it was
 * written — only the two above matched.
 *
 * Lives in shared/ because it is needed in two places that must agree: the
 * email token context (src/lib/emailTemplate.js) and the evidence renderer
 * (shared/evidence/render.js), which builds the congratulation sentence from
 * the generator's own copy of the name.
 */

const DIVISION_SUFFIX = /\s*[-–—]\s*(?:D[123]|DI{1,3}|NAIA|JUCO|USCAA)$/i;

export function conferenceLabel(name) {
  return String(name || '').replace(DIVISION_SUFFIX, '').trim();
}
