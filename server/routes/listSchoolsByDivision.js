import { loadCollegeRankings, loadD1Schools } from '../lib/seedData.js';

/**
 * Returns all schools in a division. D1 uses the real 213-school RPI sheet
 * (no LLM call, matching Section 12's "authoritative hardcoded list" intent).
 * D2/D3/NAIA/NJCAA are also served from the bundled real rankings sheet
 * (Section 12 describes an LLM web-search fallback for these; since real
 * scraped data already exists locally for every division, that path isn't
 * needed for the initial dataset).
 */
export async function listSchoolsByDivision({ division }) {
  if (division === 'NCAA D1') {
    const schools = loadD1Schools();
    return { schools: schools.map((s) => ({ name: s.name, location: '', conference: s.conference, national_ranking: s.rpi_rank })) };
  }

  const rankings = loadCollegeRankings().filter((r) => r.division === division);
  const seen = new Set();
  const schools = [];
  for (const r of rankings) {
    const key = r.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    schools.push({ name: r.name, location: '', conference: r.conference });
  }
  return { schools };
}
