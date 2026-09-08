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
 * Countries whose English name takes the definite article.
 *
 * DISPLAY GRAMMAR ONLY. Identity is `canonicalCountry`; nothing compares,
 * groups, maps or stores the output of `countryPhrase`. "the Netherlands" is
 * how you say Netherlands in a sentence, not a second name for it.
 *
 * The rule in English is roughly "plurals and names built from a common noun",
 * but it is only roughly that, so this is an explicit list decided one country
 * at a time rather than a regex over `Republic|Kingdom|States`. That pattern
 * would be wrong at least twice in the data we actually hold:
 *
 *   Czechia          115 arrivals, and takes NO article. The Czech Republic
 *                    does; Czechia does not, and the canonical name here is
 *                    Czechia.
 *   Ukraine          takes no article in modern usage, and adding one is not a
 *                    neutral stylistic choice.
 *
 * EVERY ENTRY MUST BE A CANONICAL NAME. `countryPhrase` canonicalises before
 * it looks here, so an alias in this list is simply dead: "Czech Republic"
 * resolves to "Czechia" and would never match. That is not hypothetical — it
 * was in the first draft of this list, and the mistake is the same one the
 * regex would have made. A test asserts the invariant.
 *
 * Everything here is present in the current data except "United States", which
 * is one domestic query away, and a handful of small island states listed
 * because their first arrival should not be the moment we notice.
 */
const ARTICLE_COUNTRIES = Object.freeze(new Set([
  'United Kingdom',
  'Netherlands',
  'Dominican Republic',
  'Bahamas',
  'United Arab Emirates',
  'Democratic Republic of the Congo',
  'Republic of the Congo',
  'Congo',
  'Philippines',
  'Gambia',
  'United States',
  'Ivory Coast',
  'Maldives',
  'Comoros',
  'Seychelles',
  'Central African Republic',
  'Marshall Islands',
  'Solomon Islands',
  'Cayman Islands',
  'Falkland Islands',
  'Faroe Islands',
  'Isle of Man',
]));

/**
 * A country as it should appear inside a sentence.
 *
 * "from the Netherlands", "from Norway". Returns null for a country it cannot
 * canonicalise, so a caller that has nothing to say says nothing rather than
 * printing "the undefined". A canonical name not on the article list is
 * returned unchanged — which is the correct behaviour for the 150-odd
 * countries in the data that take no article, and for any country that arrives
 * tomorrow.
 */
export function countryPhrase(country) {
  const canonical = canonicalCountry(country);
  if (!canonical) return null;
  return ARTICLE_COUNTRIES.has(canonical) ? `the ${canonical}` : canonical;
}

/* -------------------------------------------------------------------------- */
/* Recruiting relevance                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A SECOND, TIGHTER GEOGRAPHY, AND WHY THERE ARE TWO.
 *
 * `REGIONS` below is an ANALYSIS taxonomy. It wants every country placed
 * somewhere so a coverage report has no holes, and 50 countries in EUROPE is
 * the right answer to "how many European arrivals were there".
 *
 * It is the wrong answer to "would this coach read Sweden and Spain as the
 * same part of the world", and K4 measured the cost: Spain->Sweden fired 20
 * times, Japan->India 9, Ghana->Morocco 4. True sentences, thin relationships,
 * and each one taking the hook slot at the top of an email.
 *
 * So outreach relevance gets its own layer rather than a redefinition of the
 * shared one. `generate.js` reached the same conclusion from the other
 * direction and kept a two-country OCEANIA map, with a docstring warning
 * against "a large subjective classification of the world". This is that
 * warning applied to the buckets that grew anyway.
 *
 * ---------------------------------------------------------------------------
 * ONLY FOUR BUCKETS ARE SPLIT, AND THE OTHERS ARE LEFT ALONE ON EVIDENCE.
 *
 * OCEANIA observes three countries and is really Australia<->New Zealand;
 * UK_IRELAND observes four and is really United Kingdom<->Ireland;
 * NORTH_AMERICA observes one; MIDDLE_EAST observes eleven compact ones; and
 * CARIBBEAN observes 22 island nations that are one football market — K4
 * listed it as a candidate and the data does not support splitting it.
 *
 * WESTERN_EUROPE IS DELIBERATELY LARGE. The first draft of this map split the
 * contiguous core into Iberia, Western and Central, and the simulation showed
 * it removing Germany<->Spain (1,274 arrivals) and France<->Germany (720) —
 * the two heaviest relationships in the whole dataset, between adjacent major
 * football nations. Those are not weak hooks, and a taxonomy that cuts them is
 * measuring tidiness rather than relevance.
 */
const RECRUITING_REGIONS = Object.freeze({
  WESTERN_EUROPE: Object.freeze(['Spain', 'Portugal', 'Andorra', 'Gibraltar', 'France', 'Monaco',
    'Netherlands', 'Belgium', 'Luxembourg', 'Germany', 'Austria', 'Switzerland', 'Liechtenstein',
    'Italy', 'San Marino', 'Vatican City', 'Malta']),
  NORDICS: Object.freeze(['Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland', 'Faroe Islands']),
  EASTERN_EUROPE: Object.freeze(['Poland', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia',
    'Serbia', 'Bosnia and Herzegovina', 'Montenegro', 'North Macedonia', 'Albania', 'Kosovo',
    'Bulgaria', 'Romania', 'Ukraine', 'Belarus', 'Moldova', 'Lithuania', 'Latvia', 'Estonia',
    'Russia']),
  WEST_AFRICA: Object.freeze(['Ghana', 'Nigeria', 'Senegal', 'Liberia', 'Côte d\'Ivoire',
    'Sierra Leone', 'Mali', 'Burkina Faso', 'Gambia', 'Togo', 'Guinea', 'Guinea-Bissau', 'Benin',
    'Cabo Verde', 'Niger', 'Mauritania']),
  NORTH_AFRICA: Object.freeze(['Morocco', 'Egypt', 'Tunisia', 'Algeria', 'Libya']),
  EAST_AFRICA: Object.freeze(['Kenya', 'Uganda', 'Tanzania', 'Ethiopia', 'Rwanda', 'Burundi',
    'Somalia', 'Djibouti', 'Eritrea', 'South Sudan', 'Sudan']),
  SOUTHERN_AFRICA: Object.freeze(['South Africa', 'Zimbabwe', 'Zambia', 'Botswana', 'Malawi',
    'Mozambique', 'Lesotho', 'Namibia', 'Eswatini', 'Angola']),
  CENTRAL_AFRICA: Object.freeze(['Cameroon', 'Democratic Republic of the Congo', 'Congo', 'Gabon',
    'Chad', 'Central African Republic', 'Equatorial Guinea', 'Sao Tome and Principe']),
  EAST_ASIA: Object.freeze(['Japan', 'South Korea', 'North Korea', 'China', 'Taiwan', 'Hong Kong',
    'Macao', 'Mongolia']),
  SOUTH_ASIA: Object.freeze(['India', 'Nepal', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Bhutan',
    'Maldives', 'Afghanistan']),
  SOUTHEAST_ASIA: Object.freeze(['Singapore', 'Thailand', 'Malaysia', 'Philippines', 'Vietnam',
    'Indonesia', 'Myanmar', 'Cambodia', 'Laos', 'Brunei', 'Timor-Leste']),
  CENTRAL_ASIA: Object.freeze(['Kazakhstan', 'Kyrgyzstan', 'Tajikistan', 'Turkmenistan',
    'Uzbekistan']),
  SOUTH_AMERICA: Object.freeze(['Brazil', 'Colombia', 'Argentina', 'Chile', 'Venezuela', 'Ecuador',
    'Peru', 'Paraguay', 'Uruguay', 'Bolivia', 'Suriname', 'French Guiana']),
  CENTRAL_AMERICA: Object.freeze(['Mexico', 'Costa Rica', 'Honduras', 'Panama', 'Guatemala',
    'El Salvador', 'Nicaragua', 'Belize']),
});

/**
 * The broad regions whose members must match at sub-region level.
 *
 * A region NOT in this set keeps its broad grouping, because the evidence says
 * it is already tight enough to mean something.
 */
const SPLIT_REGIONS = Object.freeze(new Set(['EUROPE', 'AFRICA', 'ASIA', 'LATIN_AMERICA']));

/**
 * The grouping outreach relevance uses, or null when we will not claim one.
 *
 * NULL IS A REAL ANSWER AND IT MEANS SILENCE. A country inside a split region
 * with no sub-region gets no regional hook at all — it does not fall back to
 * the broad bucket, because the broad bucket is the thing we just decided was
 * too loose to carry the claim. Today that is Turkey, Greece and Cyprus, whose
 * nearest neighbours sit across a boundary nobody would defend in one word,
 * and three Indian Ocean islands. Between them, 170 arrivals that will now say
 * nothing rather than say something weak.
 */
export function recruitingRegionOf(country) {
  const canonical = canonicalCountry(country);
  if (!canonical) return null;
  const broad = regionOf(canonical);
  if (!broad) return null;
  if (!SPLIT_REGIONS.has(broad)) return broad;
  for (const [key, members] of Object.entries(RECRUITING_REGIONS)) {
    if (members.includes(canonical)) return key;
  }
  return null;
}

/** For tests and for anyone auditing the relevance taxonomy. */
export const recruitingRegions = () => Object.fromEntries(
  Object.entries(RECRUITING_REGIONS).map(([k, v]) => [k, [...v]]),
);
export const splitRegions = () => [...SPLIT_REGIONS];

/** The article list, for tests and for anyone auditing display grammar. */
export const articleCountries = () => [...ARTICLE_COUNTRIES];

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
