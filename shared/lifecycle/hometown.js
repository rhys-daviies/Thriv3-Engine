/**
 * Canonicalising a hometown, so two spellings of one place agree.
 *
 * Hometown is the only high-information identity signal this dataset carries:
 * 20,035 distinct values in the men's game and a ~0% chance that two randomly
 * chosen rows share one. Nationality, by contrast, has two values and two
 * strangers agree on it 62% of the time in the men's game and 85% in the
 * women's — which is why nationality is absent from the matching layer
 * entirely and this file exists instead.
 *
 * The whole gain is spelling. One roster writes "Phoenix, AZ" and the next
 * writes "Phoenix, Ariz."; both are the same place and an exact-string match
 * calls them different people.
 *
 * TWO RULES, both deliberate.
 *
 * The mapping is EXPLICIT. Every state, territory and common abbreviation is
 * written down below. There is no fuzzy matching, no edit distance and no
 * token overlap: "Springfield, IL" and "Springfield, MO" are 1 character apart
 * and 500 miles apart, and any similarity metric loose enough to join a
 * spelling variant is loose enough to join those.
 *
 * The city half is normalised for CASE AND PUNCTUATION ONLY. It is never
 * abbreviated, expanded or stemmed. "St. Louis" and "Saint Louis" are left
 * unequal, because the alternative is a rule that also joins "St. Charles" to
 * "Saint Charles County" and nobody can enumerate where that stops.
 */

/**
 * US states and territories: every spelling seen in the roster data, plus the
 * standard postal codes, mapped to the postal code.
 */
const US_STATES = Object.freeze({
  alabama: 'al', ala: 'al', al: 'al',
  alaska: 'ak', ak: 'ak',
  arizona: 'az', ariz: 'az', az: 'az',
  arkansas: 'ar', ark: 'ar', ar: 'ar',
  california: 'ca', calif: 'ca', cal: 'ca', ca: 'ca',
  colorado: 'co', colo: 'co', co: 'co',
  connecticut: 'ct', conn: 'ct', ct: 'ct',
  delaware: 'de', del: 'de', de: 'de',
  'district of columbia': 'dc', dc: 'dc', 'washington dc': 'dc',
  florida: 'fl', fla: 'fl', fl: 'fl',
  georgia: 'ga', ga: 'ga',
  hawaii: 'hi', hi: 'hi',
  idaho: 'id', id: 'id',
  illinois: 'il', ill: 'il', il: 'il',
  indiana: 'in', ind: 'in', in: 'in',
  iowa: 'ia', ia: 'ia',
  kansas: 'ks', kan: 'ks', kans: 'ks', ks: 'ks',
  kentucky: 'ky', ky: 'ky',
  louisiana: 'la', la: 'la',
  maine: 'me', me: 'me',
  maryland: 'md', md: 'md',
  massachusetts: 'ma', mass: 'ma', ma: 'ma',
  michigan: 'mi', mich: 'mi', mi: 'mi',
  minnesota: 'mn', minn: 'mn', mn: 'mn',
  mississippi: 'ms', miss: 'ms', ms: 'ms',
  missouri: 'mo', mo: 'mo',
  montana: 'mt', mont: 'mt', mt: 'mt',
  nebraska: 'ne', neb: 'ne', nebr: 'ne', ne: 'ne',
  nevada: 'nv', nev: 'nv', nv: 'nv',
  'new hampshire': 'nh', nh: 'nh',
  'new jersey': 'nj', nj: 'nj',
  'new mexico': 'nm', nm: 'nm',
  'new york': 'ny', ny: 'ny',
  'north carolina': 'nc', nc: 'nc',
  'north dakota': 'nd', nd: 'nd',
  ohio: 'oh', oh: 'oh',
  oklahoma: 'ok', okla: 'ok', ok: 'ok',
  oregon: 'or', ore: 'or', or: 'or',
  pennsylvania: 'pa', penn: 'pa', pa: 'pa',
  'puerto rico': 'pr', pr: 'pr',
  'rhode island': 'ri', ri: 'ri',
  'south carolina': 'sc', sc: 'sc',
  'south dakota': 'sd', sd: 'sd',
  tennessee: 'tn', tenn: 'tn', tn: 'tn',
  texas: 'tx', tex: 'tx', tx: 'tx',
  utah: 'ut', ut: 'ut',
  vermont: 'vt', vt: 'vt',
  virginia: 'va', va: 'va',
  washington: 'wa', wash: 'wa', wa: 'wa',
  'west virginia': 'wv', wv: 'wv',
  wisconsin: 'wi', wis: 'wi', wisc: 'wi', wi: 'wi',
  wyoming: 'wy', wyo: 'wy', wy: 'wy',
});

/**
 * Countries and country-like tails, mapped to one spelling each.
 *
 * Short list on purpose: only the forms that actually appear as the tail of a
 * hometown in this data. An unknown tail is left exactly as written.
 */
const COUNTRIES = Object.freeze({
  england: 'england', eng: 'england',
  scotland: 'scotland', wales: 'wales',
  'northern ireland': 'northern ireland',
  'united kingdom': 'united kingdom', uk: 'united kingdom',
  'great britain': 'united kingdom',
  ireland: 'ireland', ire: 'ireland',
  canada: 'canada', can: 'canada',
  spain: 'spain', esp: 'spain',
  germany: 'germany', ger: 'germany', deutschland: 'germany',
  france: 'france', fra: 'france',
  netherlands: 'netherlands', holland: 'netherlands', ned: 'netherlands',
  brazil: 'brazil', bra: 'brazil',
  portugal: 'portugal', por: 'portugal',
  australia: 'australia', aus: 'australia',
  'new zealand': 'new zealand', nz: 'new zealand',
  japan: 'japan', jpn: 'japan',
  mexico: 'mexico', mex: 'mexico',
  argentina: 'argentina', arg: 'argentina',
  colombia: 'colombia', col: 'colombia',
  'south africa': 'south africa', rsa: 'south africa',
  sweden: 'sweden', swe: 'sweden',
  norway: 'norway', nor: 'norway',
  denmark: 'denmark', den: 'denmark', dnk: 'denmark',
  italy: 'italy', ita: 'italy',
  belgium: 'belgium', bel: 'belgium',
  nigeria: 'nigeria', ngr: 'nigeria',
  ghana: 'ghana', gha: 'ghana',
});

/** Case, punctuation and spacing only. Never abbreviates or expands a word. */
function tidy(part) {
  return String(part ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A hometown reduced to `city, region` in one spelling, or `null`.
 *
 * Returns `null` for anything with no comma — a bare "Manchester" could be
 * England or New Hampshire, and guessing is exactly the failure mode the
 * explicit table exists to avoid. A caller comparing two nulls must treat them
 * as unknown rather than equal.
 */
export function canonicalHometown(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parts = raw.split(',').map(tidy).filter(Boolean);
  if (parts.length < 2) return null;

  const tail = parts[parts.length - 1];
  const mapped = US_STATES[tail] ?? COUNTRIES[tail] ?? null;
  // An unrecognised tail is kept verbatim: it may be a country this list does
  // not carry, and dropping it would merge two different places.
  const region = mapped ?? tail;
  const city = parts.slice(0, -1).join(' ');
  if (!city) return null;
  return `${city}, ${region}`;
}

/**
 * Do two hometowns denote the same place?
 *
 * `null` is unknown, never a match — two players with no hometown on file have
 * not agreed about anything.
 */
export function sameHometown(a, b) {
  const x = canonicalHometown(a);
  const y = canonicalHometown(b);
  return Boolean(x && y && x === y);
}

export const HOMETOWN_TABLES = Object.freeze({ US_STATES, COUNTRIES });
