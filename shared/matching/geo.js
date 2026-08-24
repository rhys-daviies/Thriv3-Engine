/**
 * Distance between an athlete and a school.
 *
 * The athlete side is resolved to a state centroid rather than geocoded. The
 * form collects a free-text city, and geocoding it would mean a network
 * dependency and a whole class of "Springfield, which one" failures for a
 * criterion that carries a tenth of the score. A centroid is accurate to a
 * couple of hundred miles, which is the resolution the decay curve works at
 * anyway — the difference between 400 and 500 miles from home does not change
 * anybody's college list.
 *
 * The school side is exact: Scorecard carries real coordinates for 99% of
 * them.
 */

/**
 * Population-weighted state centroids (US Census, 2020). Population-weighted
 * rather than geographic, because an athlete from New York State is far more
 * likely to be near New York City than near the geographic middle of it.
 */
export const STATE_CENTROIDS = {
  AL: [32.84, -86.63], AK: [61.37, -149.24], AZ: [33.44, -112.02], AR: [34.83, -92.32],
  CA: [35.46, -119.36], CO: [39.55, -104.86], CT: [41.53, -72.75], DE: [39.44, -75.55],
  DC: [38.90, -77.02], FL: [28.35, -81.87], GA: [33.36, -84.03], HI: [21.36, -157.90],
  ID: [43.68, -114.02], IL: [41.28, -88.38], IN: [39.90, -86.28], IA: [41.86, -93.32],
  KS: [38.48, -96.49], KY: [37.82, -85.32], LA: [30.86, -91.65], ME: [44.06, -69.77],
  MD: [39.18, -76.79], MA: [42.28, -71.55], MI: [43.00, -84.55], MN: [45.11, -93.36],
  MS: [32.68, -89.72], MO: [38.62, -92.48], MT: [46.68, -111.42], NE: [41.14, -97.15],
  NV: [36.65, -115.35], NH: [43.06, -71.53], NJ: [40.42, -74.42], NM: [34.83, -106.35],
  NY: [41.14, -74.20], NC: [35.54, -79.65], ND: [47.29, -99.79], OH: [40.19, -82.68],
  OK: [35.42, -97.35], OR: [44.66, -122.85], PA: [40.44, -77.00], RI: [41.75, -71.44],
  SC: [33.94, -80.90], SD: [44.10, -98.42], TN: [35.80, -86.36], TX: [30.86, -97.06],
  UT: [40.47, -111.83], VT: [44.15, -72.71], VA: [37.90, -77.71], WA: [47.38, -121.98],
  WV: [38.79, -80.63], WI: [43.72, -88.75], WY: [42.92, -106.63],
  PR: [18.22, -66.42], VI: [18.34, -64.93], GU: [13.45, 144.78],
};

/** Two-letter code for a state name or code, or null. */
const NAME_TO_CODE = Object.fromEntries(Object.entries({
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'puerto rico': 'PR',
}).map(([k, v]) => [k, v]));

export function normaliseState(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (STATE_CENTROIDS[upper]) return upper;
  return NAME_TO_CODE[s.toLowerCase()] || null;
}

const R_MILES = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in miles. */
export function haversineMiles(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((n) => Number.isFinite(n))) return null;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Miles from an athlete's home state to a school's coordinates, or null when
 * either side is unknown. An athlete in the same state as the school gets a
 * real (small) number rather than zero — the centroid is not the school.
 */
export function distanceFromState(athleteState, schoolLat, schoolLon) {
  const code = normaliseState(athleteState);
  const centroid = code ? STATE_CENTROIDS[code] : null;
  if (!centroid) return null;
  return haversineMiles(centroid[0], centroid[1], Number(schoolLat), Number(schoolLon));
}
