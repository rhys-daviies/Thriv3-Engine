/**
 * The canonical international recruiting geography.
 *
 * DELIBERATELY SEPARATE from `REGIONS` in shared/evidence/generate.js, which is
 * part of the frozen outreach baseline (`outreach-baseline-2026-08-29`). That
 * map has one member — OCEANIA — and widening it would change which programmes
 * HISTORICAL_SAME_REGION fires for. This file is the taxonomy recruiting
 * intelligence aggregates by; nothing in the evidence layer reads it, and
 * reconciling the two is a decision for whichever phase licenses regional
 * claims in an email.
 *
 * The separation is not duplication any more. The frozen map answers "which two
 * nationalities may an email treat as related", a deliberately tiny question.
 * This one answers "how do we file 160 country strings so a recruiting history
 * can be counted", which is a different job with a different tolerance: filing
 * a Senegalese arrival under AFRICA costs nothing if nobody says it out loud,
 * and Phase 3 says nothing out loud.
 *
 * INTERNATIONAL ONLY, by decision. US hometown and state parsing is out of
 * scope: `hometown` mixes "Houston, TX" with "Seattle, Washington", and a
 * half-working state parser would put domestic players into regions we would
 * then make claims about. A country string exists only on rows the roster
 * flagged International, so the two agree by construction.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, so that membership is auditable rather than a matter of taste.
 *
 * Regions are geographic, with exactly three documented departures:
 *
 *   1. UK_IRELAND is split out of Europe. It is the largest single source in
 *      the data (2,142 arrivals, more than any other country) and it is a
 *      distinct recruiting market — agencies, showcases and the academy system
 *      are shared across the British Isles and Ireland and shared with nowhere
 *      else. Folding it into EUROPE would make EUROPE mean "not American".
 *   2. CARIBBEAN is split out of the Americas, along the CONCACAF Caribbean
 *      zone rather than along a coastline. That is the boundary the recruiting
 *      market actually runs on: Guyana is mainland South America and plays in
 *      the Caribbean zone, Belize is an island-facing state that plays in the
 *      Central American one. Following football rather than geology here puts
 *      each country with the countries it is actually recruited alongside.
 *   3. Transcontinental states are filed where they are conventionally counted,
 *      and each one is listed explicitly below rather than left to a rule:
 *      Turkey, Russia and Cyprus in EUROPE; Israel in MIDDLE_EAST; Egypt,
 *      Morocco and Tunisia in AFRICA.
 *
 * Nothing here is a claim about a player. It is a filing system, and its only
 * promise is that the same country always lands in the same drawer.
 */

/**
 * The canonical name for a country that the data spells more than one way.
 *
 * Normalisation happens HERE, at the derived intelligence layer, and never in
 * `roster_players`. The raw string stays exactly as the roster page printed it
 * so that any aggregate can be walked back to a source row; two spellings of
 * one country are a counting bug, not a data-quality one, and the fix belongs
 * where the counting is.
 *
 * Only unambiguous aliases. "Congo" and "Democratic Republic of the Congo" are
 * two countries and are left alone.
 */
const ALIASES = Object.freeze({
  'Korea, Republic of': 'South Korea',
  'Korea, Democratic People\'s Republic of': 'North Korea',
  'Russian Federation': 'Russia',
  'Viet Nam': 'Vietnam',
  'Türkiye': 'Turkey',
  'Cote d\'Ivoire': 'Côte d\'Ivoire',
  'Sint Maarten (Dutch part)': 'Sint Maarten',
  'Czech Republic': 'Czechia',
  'Cape Verde': 'Cabo Verde',
  'Macedonia': 'North Macedonia',
  'Swaziland': 'Eswatini',
  'Burma': 'Myanmar',
  'Holland': 'Netherlands',
  'England': 'United Kingdom',
  'Scotland': 'United Kingdom',
  'Wales': 'United Kingdom',
  'Northern Ireland': 'United Kingdom',
  'Great Britain': 'United Kingdom',
  'USA': 'United States',
  'U.S.A.': 'United States',
});

/**
 * A country string in its canonical spelling.
 *
 * Trims and collapses whitespace, then applies the alias table. An unknown
 * country comes back unchanged rather than nulled — an unrecognised value is
 * still a country, and dropping it would quietly shrink every denominator it
 * belongs in.
 */
export function canonicalCountry(country) {
  const raw = String(country ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  return ALIASES[raw] ?? raw;
}

/**
 * Region membership, by canonical country name.
 *
 * Countries with no arrivals in the current data are included where they are
 * obvious neighbours of ones that do. A map that only covers what has already
 * happened silently reclassifies the first arrival from anywhere new as
 * unmapped, which is the one moment the map is being asked a real question.
 */
export const REGIONS = Object.freeze({
  /** The British Isles and Ireland. See rule 1. */
  UK_IRELAND: Object.freeze([
    'United Kingdom', 'Ireland', 'Isle of Man', 'Guernsey', 'Jersey',
  ]),

  EUROPE: Object.freeze([
    'Albania', 'Andorra', 'Armenia', 'Austria', 'Azerbaijan', 'Belarus',
    'Belgium', 'Bosnia and Herzegovina', 'Bulgaria', 'Croatia', 'Cyprus',
    'Czechia', 'Denmark', 'Estonia', 'Faroe Islands', 'Finland', 'France',
    'Georgia', 'Germany', 'Gibraltar', 'Greece', 'Hungary', 'Iceland', 'Italy',
    'Kosovo', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Malta',
    'Moldova', 'Monaco', 'Montenegro', 'Netherlands', 'North Macedonia',
    'Norway', 'Poland', 'Portugal', 'Romania', 'Russia', 'San Marino',
    'Serbia', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland',
    'Turkey', 'Ukraine', 'Vatican City',
  ]),

  /** Mexico, Central America and mainland South America. See rule 2. */
  LATIN_AMERICA: Object.freeze([
    'Argentina', 'Belize', 'Bolivia', 'Brazil', 'Chile', 'Colombia',
    'Costa Rica', 'Ecuador', 'El Salvador', 'French Guiana', 'Guatemala',
    'Honduras', 'Mexico', 'Nicaragua', 'Panama', 'Paraguay', 'Peru',
    'Suriname', 'Uruguay', 'Venezuela',
  ]),

  /** The CONCACAF Caribbean zone. See rule 2. */
  CARIBBEAN: Object.freeze([
    'Anguilla', 'Antigua and Barbuda', 'Aruba', 'Bahamas', 'Barbados',
    'Bermuda', 'British Virgin Islands', 'Cayman Islands', 'Cuba', 'Curaçao',
    'Dominica', 'Dominican Republic', 'Grenada', 'Guadeloupe', 'Guyana',
    'Haiti', 'Jamaica', 'Martinique', 'Montserrat', 'Puerto Rico',
    'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Martin',
    'Saint Vincent and the Grenadines', 'Sint Maarten',
    'Trinidad and Tobago', 'Turks and Caicos Islands',
    'United States Virgin Islands',
  ]),

  AFRICA: Object.freeze([
    'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi',
    'Cabo Verde', 'Cameroon', 'Central African Republic', 'Chad', 'Comoros',
    'Congo', 'Côte d\'Ivoire', 'Democratic Republic of the Congo', 'Djibouti',
    'Egypt', 'Equatorial Guinea', 'Eritrea', 'Eswatini', 'Ethiopia', 'Gabon',
    'Gambia', 'Ghana', 'Guinea', 'Guinea-Bissau', 'Kenya', 'Lesotho',
    'Liberia', 'Libya', 'Madagascar', 'Malawi', 'Mali', 'Mauritania',
    'Mauritius', 'Mayotte', 'Morocco', 'Mozambique', 'Namibia', 'Niger',
    'Nigeria', 'Reunion', 'Rwanda', 'Sao Tome and Principe', 'Senegal',
    'Seychelles', 'Sierra Leone', 'Somalia', 'South Africa', 'South Sudan',
    'Sudan', 'Tanzania', 'Togo', 'Tunisia', 'Uganda', 'Zambia', 'Zimbabwe',
  ]),

  MIDDLE_EAST: Object.freeze([
    'Bahrain', 'Iran', 'Iraq', 'Israel', 'Jordan', 'Kuwait', 'Lebanon',
    'Oman', 'Palestine', 'Qatar', 'Saudi Arabia', 'Syria',
    'United Arab Emirates', 'Yemen',
  ]),

  ASIA: Object.freeze([
    'Afghanistan', 'Bangladesh', 'Bhutan', 'Brunei', 'Cambodia', 'China',
    'Hong Kong', 'India', 'Indonesia', 'Japan', 'Kazakhstan', 'Kyrgyzstan',
    'Laos', 'Macao', 'Malaysia', 'Maldives', 'Mongolia', 'Myanmar', 'Nepal',
    'North Korea', 'Pakistan', 'Philippines', 'Singapore', 'South Korea',
    'Sri Lanka', 'Taiwan', 'Tajikistan', 'Thailand', 'Timor-Leste',
    'Turkmenistan', 'Uzbekistan', 'Vietnam',
  ]),

  /** Canada, and the rest of the non-US mainland north of Mexico. */
  NORTH_AMERICA: Object.freeze([
    'Canada', 'Greenland', 'Saint Pierre and Miquelon',
  ]),

  /**
   * Unchanged in membership from the frozen evidence map for the two countries
   * that map carries, which is what keeps a future reconciliation possible:
   * OCEANIA here is a superset of OCEANIA there, never a different set.
   */
  OCEANIA: Object.freeze([
    'American Samoa', 'Australia', 'Cook Islands', 'Fiji', 'Guam', 'Kiribati',
    'Marshall Islands', 'Micronesia', 'Nauru', 'New Caledonia', 'New Zealand',
    'Palau', 'Papua New Guinea', 'Samoa', 'Solomon Islands', 'Tahiti',
    'Tonga', 'Tuvalu', 'Vanuatu',
  ]),
});

export const REGION_KEYS = Object.freeze(Object.keys(REGIONS));

const BY_COUNTRY = new Map();
for (const [region, members] of Object.entries(REGIONS)) {
  for (const country of members) {
    if (BY_COUNTRY.has(country)) {
      throw new Error(`${country} is in two regions: ${BY_COUNTRY.get(country)} and ${region}`);
    }
    BY_COUNTRY.set(country, region);
  }
}

/**
 * The region a country belongs to, or null where we have not placed it.
 *
 * Null, not a catch-all. The hierarchy a later phase will walk is
 *
 *   SAME COUNTRY -> SAME REGION -> INTERNATIONAL
 *
 * and an OTHER bucket would let the middle rung fire on two countries whose
 * only relationship is that neither was in the map.
 */
export function regionOf(country) {
  const canonical = canonicalCountry(country);
  if (!canonical) return null;
  return BY_COUNTRY.get(canonical) ?? null;
}

/** Every country placed in a region, for coverage reporting. */
export function placedCountries() {
  return [...BY_COUNTRY.keys()].sort();
}

/**
 * The countries in a set of values that we could not place.
 *
 * The build reports this against the live data every run, because the failure
 * mode of a hand-written map is not being wrong — it is going stale without
 * anybody noticing that a new source country arrived.
 */
export function unmappedCountries(countries = []) {
  const out = new Map();
  for (const raw of countries) {
    const canonical = canonicalCountry(raw);
    if (!canonical || BY_COUNTRY.has(canonical)) continue;
    out.set(canonical, (out.get(canonical) ?? 0) + 1);
  }
  return out;
}
