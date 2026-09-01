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

const {
  HISTORICAL_NAME, MERGER_NAME, CURRENT_NAME, OFFICIAL_ABBREVIATION, CONFERENCE_DISPLAY_NAME,
} = ALIAS_TYPE;

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

  // ── the names conferences print, established by set difference ────────────
  //
  // Phase 12E / K, N. A conference's own standings table published a name; the
  // NCAA's own member directory says which of that conference's members the
  // table had not otherwise accounted for. Where exactly one candidate remains
  // and the printed name is a prefix, an initialism, or a token-for-token match
  // of the official one, the pairing is forced by evidence rather than measured
  // by similarity.
  //
  // A BARE NAME SEVERAL INSTITUTIONS SHARE IS NOT HERE. "Carroll", "Union",
  // "Emmanuel", "Eastern", "Thomas", "Dallas", "North Central", "York",
  // "Trinity" and "St. Mary's (Md.)" were all forced this way and all refused:
  // writing one of them down would defeat the ambiguity refusal that protects
  // it. Those resolve at read time, from the conference that published them.
  { alias: 'Canton', unitid: 196015, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the sunyac in 3 collected seasons; the NCAA member directory accounts for it as "State University of New York at Canton"' },
  { alias: 'Chris. Newport', unitid: 231712, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the ctc in 4 collected seasons; the NCAA member directory accounts for it as "Christopher Newport University"' },
  { alias: 'Coast Guard', unitid: 130624, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the newmac in 4 collected seasons; the NCAA member directory accounts for it as "U.S. Coast Guard Academy"' },
  { alias: 'DBU', unitid: 224226, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the lsc in 4 collected seasons; the NCAA member directory accounts for it as "Dallas Baptist University"' },
  { alias: 'E. Stroudsburg', unitid: 212115, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the psac in 6 collected seasons; the NCAA member directory accounts for it as "East Stroudsburg University of Pennsylvania"' },
  { alias: 'EMU', unitid: 232043, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the odac in 4 collected seasons; the NCAA member directory accounts for it as "Eastern Mennonite University"' },
  { alias: 'Geneseo', unitid: 196167, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the empire-8 in 2 collected seasons; the NCAA member directory accounts for it as "State University of New York at Geneseo"' },
  { alias: 'Hawai\'i Hilo', unitid: 141565, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the pacwest in 4 collected seasons; the NCAA member directory accounts for it as "University of Hawaii at Hilo"' },
  { alias: 'Hawai\'i Pacific', unitid: 141644, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the pacwest in 4 collected seasons; the NCAA member directory accounts for it as "Hawaii Pacific University"' },
  { alias: 'HCU', unitid: 225399, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the southland in 4 collected seasons; the NCAA member directory accounts for it as "Houston Christian University"' },
  { alias: 'Hobart', unitid: 191630, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the liberty-league in 4 collected seasons; the NCAA member directory accounts for it as "Hobart and William Smith Colleges"' },
  { alias: 'LMU', unitid: 117946, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the wcc in 1 collected season; the NCAA member directory accounts for it as "Loyola Marymount University"' },
  { alias: 'Merchant Marine', unitid: 197027, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the skyline in 4 collected seasons; the NCAA member directory accounts for it as "U.S. Merchant Marine Academy"' },
  { alias: 'Morrisville', unitid: 196051, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the sunyac in 3 collected seasons; the NCAA member directory accounts for it as "State University of New York at Morrisville"' },
  { alias: 'MTSU', unitid: 220978, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the cusa in 4 collected seasons; the NCAA member directory accounts for it as "Middle Tennessee State University"' },
  { alias: 'Nebraska Kearney', unitid: 181215, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the miaa-d2 in 4 collected seasons; the NCAA member directory accounts for it as "University of Nebraska at Kearney"' },
  { alias: 'Old Westbury', unitid: 196237, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the skyline in 4 collected seasons; the NCAA member directory accounts for it as "State University of New York at Old Westbury"' },
  { alias: 'Oneonta', unitid: 196185, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the sunyac in 7 collected seasons; the NCAA member directory accounts for it as "State University of New York at Oneonta"' },
  { alias: 'Parkside', unitid: 240374, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the gliac in 5 collected seasons; the NCAA member directory accounts for it as "University of Wisconsin-Parkside"' },
  { alias: 'Pitt', unitid: 215293, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the acc in 4 collected seasons; the NCAA member directory accounts for it as "University of Pittsburgh"' },
  { alias: 'Pitt.-Bradford', unitid: 215266, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the amcc in 4 collected seasons; the NCAA member directory accounts for it as "University of Pittsburgh, Bradford"' },
  { alias: 'Pitt.-Greensburg', unitid: 215275, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the amcc in 4 collected seasons; the NCAA member directory accounts for it as "University of Pittsburgh, Greensburg"' },
  { alias: 'Poly', unitid: 196112, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the empire-8 in 2 collected seasons; the NCAA member directory accounts for it as "State University of New York Polytechnic Institute"' },
  { alias: 'Potsdam', unitid: 196200, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the sunyac in 5 collected seasons; the NCAA member directory accounts for it as "State University of New York at Potsdam"' },
  { alias: 'Ramapo', unitid: 186201, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the njac in 4 collected seasons; the NCAA member directory accounts for it as "Ramapo College"' },
  { alias: 'RIT', unitid: 195003, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the liberty-league in 3 collected seasons; the NCAA member directory accounts for it as "Rochester Institute of Technology"' },
  { alias: 'RPI', unitid: 194824, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the liberty-league in 4 collected seasons; the NCAA member directory accounts for it as "Rensselaer Polytechnic Institute"' },
  { alias: 'SFA', unitid: 228431, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the southland in 2 collected seasons; the NCAA member directory accounts for it as "Stephen F. Austin State University"' },
  { alias: 'St. Joseph\'s-Brooklyn', unitid: 195544, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the skyline in 4 collected seasons; the NCAA member directory accounts for it as "St. Joseph\'s University NY (Brooklyn)"' },
  { alias: 'UNI', unitid: 154095, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the mvc in 4 collected seasons; the NCAA member directory accounts for it as "University of Northern Iowa"' },
  { alias: 'USC Beaufort', unitid: 218654, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the peach-belt in 4 collected seasons; the NCAA member directory accounts for it as "University of South Carolina Beaufort"' },
  { alias: 'Washington St. Louis', unitid: 179867, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the uaa in 4 collected seasons; the NCAA member directory accounts for it as "Washington University in St. Louis"' },
  { alias: 'William Smith', unitid: 191630, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the liberty-league in 4 collected seasons; the NCAA member directory accounts for it as "Hobart and William Smith Colleges"' },
  { alias: 'WKU', unitid: 157951, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the cusa in 4 collected seasons; the NCAA member directory accounts for it as "Western Kentucky University"' },
  { alias: 'WPI', unitid: 168421, aliasType: CONFERENCE_DISPLAY_NAME, confidence: 'CORROBORATED', source: 'printed by the newmac in 4 collected seasons; the NCAA member directory accounts for it as "Worcester Polytechnic Institute"' },
]);

/**
 * ONE CONFERENCE'S OWN SPELLING FOR ONE OF ITS MEMBERS.
 *
 * A bare name can mean two institutions in two conferences in the same season,
 * and a global alias cannot represent that. The Wolverine-Hoosier Athletic
 * Conference prints "Rochester" in its 2022 and 2023 tables and "Rochester
 * Christian (Mich.)" in its 2024 and 2025 tables: the institution renamed
 * (Rochester College, then Rochester University, then Rochester Christian
 * University) and the conference's own table followed. The University Athletic
 * Association prints the same bare "Rochester" for the University of Rochester,
 * in Division III, across the same four seasons.
 *
 * THE CONFERENCE'S OWN LATER TABLE IS THE SOURCE. This is not an inference from
 * geography or from similarity — it is the same conference naming the same
 * member two ways, with the explicit spelling in the later seasons.
 *
 * A GLOBAL ALIAS HERE WOULD BE A DEFECT, and it was: for want of this scope, the
 * WHAC's 2023 women's row published a 2023 NAIA season for the University of
 * Rochester, a Division III programme 400 miles away, and the only reason the
 * other three seasons did not do the same is that the UAA's own tables claimed
 * them first and both claims were refused as double-claimed.
 */
export const CONFERENCE_SCOPED_ALIASES = Object.freeze([
  {
    conferenceScope: 'whac',
    alias: 'Rochester',
    unitid: 170967,
    aliasType: ALIAS_TYPE.HISTORICAL_NAME,
    confidence: 'CORROBORATED',
    source: 'the Wolverine-Hoosier Athletic Conference publishes "Rochester" in its 2022 and 2023 soccer standings and "Rochester Christian (Mich.)" in its 2024 and 2025 standings; the institution renamed to Rochester Christian University',
    notes: 'scoped: the University Athletic Association prints the same bare name for the University of Rochester',
  },
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

/**
 * ATHLETICS DOMAINS PROVED WRONG, WITH THE REPLACEMENT PROVED TOO.
 *
 * Phase 12D's audit produced 60 wrong-institution mappings and said the list was
 * a review queue rather than a licence to rewrite anything. Phase 12E worked it
 * against the NCAA's own member directory, which publishes the athletics website
 * each institution says is theirs, and then fetched each proposed replacement
 * and read what that host itself says.
 *
 * ONLY WHAT SURVIVED BOTH CHECKS IS HERE. 21 mappings were confirmed wrong with
 * a candidate replacement; 15 of those replacements were confirmed by the
 * replacement host's own page and are below. The other six stay in the queue —
 * two hosts refused the connection, and four name themselves in a way our
 * resolver cannot confirm ("LaRoche", an untruncated "Concordia", a university
 * homepage rather than an athletics one). A correction nobody can check is not a
 * correction.
 *
 * `known_domains.json` IS NOT EDITED. It is a scrape artefact from an earlier
 * phase and rewriting it would put the proof somewhere no test reads. These rows
 * are applied by `verifyAthleticsDomains.js`, which records both the wrong
 * mapping and the proven one.
 */
export const ATHLETICS_DOMAIN_CORRECTIONS = Object.freeze([
  {
    unitid: 232706, institution: 'Marymount (VA)',
    wrongDomain: 'lmulions.com', wrongDomainBelongsTo: 'Loyola Marymount',
    correctDomain: 'marymountsaints.com',
    provenance: 'the NCAA member directory publishes marymountsaints.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "Marymount University"',
  },
  {
    unitid: 217907, institution: 'Coker',
    wrongDomain: 'catawbaathletics.com', wrongDomainBelongsTo: 'Catawba',
    correctDomain: 'cokercobras.com',
    provenance: 'the NCAA member directory publishes cokercobras.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "Coker University"',
  },
  {
    unitid: 165671, institution: 'Emmanuel (MA)',
    wrongDomain: 'goeulions.com', wrongDomainBelongsTo: 'Emmanuel (GA)',
    correctDomain: 'goecsaints.com',
    provenance: 'the NCAA member directory publishes goecsaints.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "Emmanuel College (Ma.)"',
  },
  {
    unitid: 148654, institution: 'Illinois Springfield',
    wrongDomain: 'illinoiscollegeathletics.com', wrongDomainBelongsTo: 'Illinois College',
    correctDomain: 'uisprairiestars.com',
    provenance: 'the NCAA member directory publishes uisprairiestars.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "UIS Athletics"',
  },
  {
    unitid: 165024, institution: 'Bridgewater State',
    wrongDomain: 'athletics.middlebury.edu', wrongDomainBelongsTo: 'Middlebury',
    correctDomain: 'bsubears.com',
    provenance: 'the NCAA member directory publishes bsubears.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "Bridgewater St."',
  },
  {
    unitid: 240462, institution: 'Wisconsin-Platteville',
    wrongDomain: 'athletics.carthage.edu', wrongDomainBelongsTo: 'Carthage',
    correctDomain: 'letsgopioneers.com',
    provenance: 'the NCAA member directory publishes letsgopioneers.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "University of Wisconsin Platteville"',
  },
  {
    unitid: 144351, institution: 'Concordia Chicago',
    wrongDomain: 'cuwfalcons.com', wrongDomainBelongsTo: 'Concordia Wisconsin',
    correctDomain: 'cucougars.com',
    provenance: 'the NCAA member directory publishes cucougars.com as this institution\'s athletics site, and that host\'s own TITLE_SEGMENT reads "Concordia University Chicago"',
  },
  {
    unitid: 165866, institution: 'Framingham State',
    wrongDomain: 'bantamsports.com', wrongDomainBelongsTo: 'Trinity (CT)',
    correctDomain: 'fsurams.com',
    provenance: 'the NCAA member directory publishes fsurams.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "Framingham State University"',
  },
  {
    unitid: 239017, institution: 'Lawrence',
    wrongDomain: 'ltuathletics.com', wrongDomainBelongsTo: 'Lawrence Technological University',
    correctDomain: 'vikings.lawrence.edu',
    provenance: 'the NCAA member directory publishes vikings.lawrence.edu as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "Lawrence University"',
  },
  {
    unitid: 147660, institution: 'North Central (IL)',
    wrongDomain: 'ncurams.com', wrongDomainBelongsTo: 'North Central University',
    correctDomain: 'northcentralcardinals.com',
    provenance: 'the NCAA member directory publishes northcentralcardinals.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "North Central College Athletics"',
  },
  {
    unitid: 204635, institution: 'Ohio Northern',
    wrongDomain: 'battlingbishops.com', wrongDomainBelongsTo: 'Ohio Wesleyan',
    correctDomain: 'onusports.com',
    provenance: 'the NCAA member directory publishes onusports.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "Ohio Northern University"',
  },
  {
    unitid: 240268, institution: 'Wisconsin-Eau Claire',
    wrongDomain: 'athletics.stolaf.edu', wrongDomainBelongsTo: 'Saint Olaf',
    correctDomain: 'blugolds.com',
    provenance: 'the NCAA member directory publishes blugolds.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "University of Wisconsin, Eau Claire"',
  },
  {
    unitid: 234207, institution: 'Washington & Lee',
    wrongDomain: 'lynchburgsports.com', wrongDomainBelongsTo: 'University of Lynchburg',
    correctDomain: 'generalssports.com',
    provenance: 'the NCAA member directory publishes generalssports.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "Washington and Lee University"',
  },
  {
    unitid: 240480, institution: 'Wisconsin-Stevens Point',
    wrongDomain: 'uwlathletics.com', wrongDomainBelongsTo: 'Wisconsin-La Crosse',
    correctDomain: 'athletics.uwsp.edu',
    provenance: 'the NCAA member directory publishes athletics.uwsp.edu as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "University of Wisconsin - Stevens Point Athletics"',
  },
  {
    unitid: 240329, institution: 'Wisconsin-La Crosse',
    wrongDomain: 'wlcsports.com', wrongDomainBelongsTo: 'Wisconsin Lutheran College',
    correctDomain: 'uwlathletics.com',
    provenance: 'the NCAA member directory publishes uwlathletics.com as this institution\'s athletics site, and that host\'s own OG_SITE_NAME reads "University of Wisconsin La Crosse Athletics"',
  },
]);
