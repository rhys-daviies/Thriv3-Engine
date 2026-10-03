/**
 * The counts Recruiting Market Match needs, and the geography behind them.
 *
 * WHY IT LIVES HERE. Everything that knows about tables, free-text hometowns
 * and coordinates is server-side; the layer under shared/ takes counts and
 * returns a result, so it can be tested against fixtures and cannot acquire a
 * query.
 *
 * -- HOMETOWNS ARE AP STYLE, NOT POSTAL CODES ------------------------------
 *
 * NCAA stats pages print "Madison, Wis." and "Croton on Hudson, N.Y.". A
 * two-letter rule reads 33% of them; with AP abbreviations it reads 87%. The
 * first pass of this analysis was built on the 33% and was therefore a finding
 * about which schools happen to publish postal codes.
 *
 * -- STATE CENTROIDS ARE NOT A GEOCODER ------------------------------------
 *
 * Thriv3 holds no coordinates for a hometown, so the finest honest resolution
 * is the state. The centroid is the mean position of every college in that
 * state, which gives a distance in kilometres with a known error - a median
 * within-state spread of about 124 km - and avoids the border artefact a
 * same-state flag creates, where a programme 20 miles across a line is foreign
 * and one 600 miles away in-state is local.
 */
import { NEAR_BAND_KM } from '../../../shared/matching/v2/index.js';

const AP_STATE = Object.freeze({
  'ala.': 'AL', alaska: 'AK', 'ariz.': 'AZ', 'ark.': 'AR', 'calif.': 'CA', 'colo.': 'CO',
  'conn.': 'CT', 'del.': 'DE', 'fla.': 'FL', 'ga.': 'GA', hawaii: 'HI', idaho: 'ID',
  'ill.': 'IL', 'ind.': 'IN', iowa: 'IA', 'kan.': 'KS', 'kans.': 'KS', 'ky.': 'KY',
  'la.': 'LA', maine: 'ME', 'md.': 'MD', 'mass.': 'MA', 'mich.': 'MI', 'minn.': 'MN',
  'miss.': 'MS', 'mo.': 'MO', 'mont.': 'MT', 'neb.': 'NE', 'nebr.': 'NE', 'nev.': 'NV',
  'n.h.': 'NH', 'n.j.': 'NJ', 'n.m.': 'NM', 'n.y.': 'NY', 'n.c.': 'NC', 'n.d.': 'ND',
  ohio: 'OH', 'okla.': 'OK', 'ore.': 'OR', 'pa.': 'PA', 'r.i.': 'RI', 's.c.': 'SC',
  's.d.': 'SD', 'tenn.': 'TN', texas: 'TX', utah: 'UT', 'vt.': 'VT', 'va.': 'VA',
  'wash.': 'WA', 'w.va.': 'WV', 'wis.': 'WI', 'wyo.': 'WY', 'd.c.': 'DC',
  alabama: 'AL', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', illinois: 'IL',
  indiana: 'IN', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
});

/** The state in a free-text hometown, or null. Never a guess. */
export function homeState(hometown) {
  if (!hometown) return null;
  const m = String(hometown).match(/,\s*([A-Z]{2})\s*$/);
  if (m) return m[1];
  const tail = String(hometown).split(',').pop()?.trim().toLowerCase();
  return tail ? (AP_STATE[tail] ?? null) : null;
}

/** Great-circle distance in kilometres. */
export function km(aLat, aLon, bLat, bLon) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat); const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + (Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2);
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function stateCentroids(colleges) {
  const by = new Map();
  for (const c of colleges) {
    if (!c.state || c.latitude === null || c.latitude === undefined) continue;
    const e = by.get(c.state) ?? { lat: 0, lon: 0, n: 0 };
    e.lat += c.latitude; e.lon += c.longitude; e.n += 1;
    by.set(c.state, e);
  }
  return new Map([...by].map(([s, e]) => [s, { lat: e.lat / e.n, lon: e.lon / e.n, colleges: e.n }]));
}

/**
 * Programme and division recruiting counts.
 *
 * @param {Array} rows  arrivals joined to the recruit's roster row and the
 *                      programme: { programme, division, is_international,
 *                      hometown, latitude, longitude }
 */
export function buildMarketIndex(rows, { centroids, nearBandKm = NEAR_BAND_KM } = {}) {
  const blank = () => ({ arrivals: 0, international: 0, domesticWithGeo: 0, near: 0 });
  const programmes = new Map();
  const divisions = new Map();
  for (const r of rows) {
    const p = programmes.get(r.programme) ?? blank();
    const d = divisions.get(r.division) ?? blank();
    for (const acc of [p, d]) acc.arrivals += 1;
    if (r.is_international === 1) {
      for (const acc of [p, d]) acc.international += 1;
    } else {
      const s = homeState(r.hometown);
      const cen = s && centroids ? centroids.get(s) : null;
      if (cen && r.latitude !== null && r.latitude !== undefined) {
        const dist = km(r.latitude, r.longitude, cen.lat, cen.lon);
        for (const acc of [p, d]) {
          acc.domesticWithGeo += 1;
          if (dist <= nearBandKm) acc.near += 1;
        }
      }
    }
    programmes.set(r.programme, p);
    divisions.set(r.division, d);
  }
  return { programmes, divisions };
}

/** How far this athlete's home state is from this programme. Null when unplaceable. */
export function athleteDistanceKm({ athleteState, college, centroids }) {
  if (!athleteState || !centroids) return null;
  const cen = centroids.get(athleteState);
  if (!cen || college.latitude === null || college.latitude === undefined) return null;
  return km(college.latitude, college.longitude, cen.lat, cen.lon);
}

/** The international roster/minutes counts the utilisation caveat needs. */
export function utilisationCounts(rosterRows) {
  const by = new Map();
  for (const r of rosterRows) {
    const e = by.get(r.college_name) ?? { rosterRows: 0, internationalRows: 0, totalMinutes: 0, internationalMinutes: 0 };
    const intl = r.country && r.country !== '' && r.country !== 'USA';
    const mins = Number(r.minutes_played ?? r.projected_minutes ?? 0) || 0;
    e.rosterRows += 1; e.totalMinutes += mins;
    if (intl) { e.internationalRows += 1; e.internationalMinutes += mins; }
    by.set(r.college_name, e);
  }
  return by;
}
