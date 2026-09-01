/**
 * Institution names that are not in `colleges`, and where each one came from.
 *
 * `colleges.name` supplies most of this table automatically — every programme's
 * own name, for both sports, is an alias of its UNITID. What is written down
 * here is what our own table does not say: names institutions used earlier in
 * the window, names created by mergers, official short forms, and the two
 * spellings the 12D domain audit proved our resolver was getting wrong.
 *
 * EVERY ROW CARRIES ITS SOURCE, and the source is a place the claim can be
 * re-checked. A name with no source could not be re-examined, and this file
 * decides which institution a fetched page belongs to.
 *
 * IT IS DELIBERATELY SHORT. An alias table is a place where a plausible guess
 * becomes a fact, so nothing goes in it to raise a coverage number. A name that
 * is not here is refused, and a refusal costs one row its structural history.
 */
import { ALIAS_TYPE } from './institutionIdentity.js';

const { HISTORICAL_NAME, MERGER_NAME, CURRENT_NAME, OFFICIAL_ABBREVIATION } = ALIAS_TYPE;

export const CURATED_INSTITUTION_ALIASES = Object.freeze([
  // ── Pennsylvania's two university mergers, 2022 ───────────────────────────
  // Pennsylvania Western University (UNITID 498571) is California, Clarion and
  // Edinboro merged; Commonwealth University (498562) is Bloomsburg, Lock Haven
  // and Mansfield. Every 2022 and 2023 conference table prints the old names,
  // and every roster and record file we hold prints the new ones.
  //
  // NOTE THE LIMIT OF THIS. One UNITID covers three campuses, and those
  // campuses field SEPARATE soccer programmes — PennWest California and
  // PennWest Edinboro both play in the PSAC. UNITID identifies the institution
  // and cannot separate the programmes, so programme resolution falls back to
  // the name within a sport. See `resolveProgramme`.
  { alias: 'California University of Pennsylvania', unitid: 498571, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PASSHE integration, 2022; colleges lists the merged institution as PennWest California', notes: 'printed as "California (Pa.)" by the PSAC through 2022' },
  { alias: 'California (Pa.)', unitid: 498571, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PSAC standings 2022' },
  { alias: 'Clarion University', unitid: 498571, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PASSHE integration, 2022' },
  { alias: 'Clarion', unitid: 498571, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PSAC standings 2022' },
  { alias: 'Edinboro University', unitid: 498571, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PASSHE integration, 2022' },
  { alias: 'Edinboro', unitid: 498571, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PSAC standings 2022' },
  { alias: 'Pennsylvania Western University', unitid: 498571, aliasType: MERGER_NAME, confidence: 'CURATED', source: 'the merged institution’s own name' },
  { alias: 'Lock Haven University', unitid: 498562, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PASSHE integration, 2022' },
  { alias: 'Lock Haven', unitid: 498562, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PSAC standings 2022' },
  { alias: 'Bloomsburg University', unitid: 498562, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PASSHE integration, 2022' },
  { alias: 'Bloomsburg', unitid: 498562, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PSAC standings 2022' },
  { alias: 'Mansfield University', unitid: 498562, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PASSHE integration, 2022' },
  { alias: 'Mansfield', unitid: 498562, aliasType: HISTORICAL_NAME, confidence: 'CURATED', source: 'PSAC standings 2022' },
  { alias: 'Commonwealth University of Pennsylvania', unitid: 498562, aliasType: MERGER_NAME, confidence: 'CURATED', source: 'the merged institution’s own name' },

  // ── two spellings the domain audit proved were resolving to the wrong school
  // "Blue Mountain College" renamed to Blue Mountain Christian University in
  // 2022. Without this, `bmcusports.com` — which still calls itself Blue
  // Mountain College — resolved to Blue Mountain COMMUNITY College, Oregon, a
  // different institution in a different state and a different association.
  { alias: 'Blue Mountain College', unitid: 175430, aliasType: HISTORICAL_NAME, confidence: 'CORROBORATED', source: 'https://bmcusports.com og:site_name; renamed Blue Mountain Christian University, 2022' },
  // Queens College, City University of New York. `colleges` spells it
  // "Queens (CUNY)", so the bare "Queens College" its own site publishes fell
  // through to Queens University of Charlotte, 600 miles away and in D1.
  { alias: 'Queens College', unitid: 190664, aliasType: CURRENT_NAME, confidence: 'CORROBORATED', source: 'https://qc.cuny.edu og:site_name' },
  { alias: 'Queens College, CUNY', unitid: 190664, aliasType: CURRENT_NAME, confidence: 'CORROBORATED', source: 'https://qc.cuny.edu <title>' },
  { alias: 'CUNY Queens', unitid: 190664, aliasType: OFFICIAL_ABBREVIATION, confidence: 'CURATED', source: 'CUNYAC standings' },
]);

/**
 * Domains whose athletics programme is genuinely shared by several
 * institutions, and are therefore NOT wrong mappings.
 *
 * Claremont-Mudd-Scripps is one athletics programme fielded by Claremont
 * McKenna, Harvey Mudd and Scripps; Pomona-Pitzer is one fielded by Pomona and
 * Pitzer. Four names claim `cmsathletics.org` and three claim `sagehens.com`,
 * and every one of those claims is correct. The domain audit would otherwise
 * report the constituent colleges as wrong-institution mappings.
 */
export const COMBINED_PROGRAMME_DOMAINS = Object.freeze({
  'cmsathletics.org': { programme: 'Claremont-Mudd-Scripps', unitids: [112260, 115409, 123165] },
  'sagehens.com': { programme: 'Pomona-Pitzer', unitids: [121345, 121257] },
});
