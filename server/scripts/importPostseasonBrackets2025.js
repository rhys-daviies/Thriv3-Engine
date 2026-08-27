#!/usr/bin/env node
/**
 * Imports the 2025 D2/D3/NAIA postseason brackets (men's and women's,
 * researched via background agents against Wikipedia tournament articles)
 * into colleges.postseason_2025_round. D1 is already complete (48 men's /
 * 64 women's, matching the real bracket sizes) via
 * importPostseasonRounds.js's soccer_records CSV import; this fills the
 * D2/D3/NAIA gap that left only 1-2 schools per division/sex.
 *
 * Without --apply, runs as a dry run and prints what would change, plus
 * every unresolved name for manual review -- a wrong postseason claim in an
 * outreach email is worse than a missing one.
 */
import fs from 'node:fs';
import { College } from '../db/entities/college.js';
import { matchSchoolName } from '../lib/schoolMatch.js';

const APPLY = process.argv.includes('--apply');
const SCRATCH = '/private/tmp/claude-501/-Users-rhysdavies-Documents-Recruitmatch-app/1e1a3c6c-a178-4361-afa1-5cda2c84e616/scratchpad';

const SOURCES = [
  { file: 'postseason_d2_men.txt', sport: 'mens-soccer', division: 'NCAA D2' },
  { file: 'postseason_d2_women.txt', sport: 'womens-soccer', division: 'NCAA D2' },
  { file: 'postseason_d3_men.txt', sport: 'mens-soccer', division: 'NCAA D3' },
  { file: 'postseason_d3_women.txt', sport: 'womens-soccer', division: 'NCAA D3' },
  { file: 'postseason_naia_men.txt', sport: 'mens-soccer', division: 'NAIA' },
  { file: 'postseason_naia_women.txt', sport: 'womens-soccer', division: 'NAIA' },
];

// Bracket-source abbreviations our existing matchSchoolName alias/normalise
// cascade cannot reach on its own -- verified by hand against the colleges
// table, not guessed. Left name -> exact colleges.name on the right.
const MANUAL_MAP = {
  'Trinity (TX)': 'Trinity (TX)',
  'WashU': 'Washington (MO)',
  'Wis.-Eau Claire': 'Wisconsin-Eau Claire',
  'Wis.-Whitewater': 'Wisconsin-Whitewater',
  'Wis.-Superior': 'Wisconsin-Superior',
  'Wis.-La Crosse': 'Wisconsin-La Crosse',
  'Chris. Newport': 'Christopher Newport',
  'Wash. & Lee': 'Washington & Lee',
  'Ill. Wesleyan': 'Illinois Wesleyan',
  'N.C. Wesleyan': 'North Carolina Wesleyan',
  'St. Joseph\'s (L.I.)': "St. Joseph's (NY)",
  'Connecticut Col.': 'Connecticut College',
  'Penn St. Harrisburg': 'Penn State Harrisburg',
  'Penn St.-Behrend': 'Pennsylvania State University-Penn State Erie (Behrend College)',
  'Claremont-M-S': 'Claremont-Mudd-Scripps',
  'CWRU': 'Case Western Reserve',
  'Southern Me.': 'Southern Maine',
  'Bridgewater St.': 'Bridgewater State',
  'Westfield St.': 'Westfield State',
  'St. Catherine': "St. Catherine's",
  'Mo.-St. Louis': 'UMSL',
  'UIndy': 'Indianapolis',
  'Lincoln University (MO)': 'Lincoln (MO)',
  'CSUSB': 'Cal State San Bernardino',
  'Stanislaus State': 'Cal State Stanislaus',
  'Point Loma': 'Point Loma Nazarene',
  'Midwestern State': 'Midwestern State',
  'Mississippi Christian': null, // no such D2 school found; excluded rather than guessed
  'St. Olaf': 'Saint Olaf',
  'Cortland': 'SUNY Cortland',
  'UChicago': 'University of Chicago',
  'Hobart': 'Hobart & William Smith',
  'Life': 'Life (GA)', // men's naming; women's overridden separately below
  'Stevens': 'Stevens Tech', // men's naming; women's overridden separately below
  // Genuinely no colleges row found under any name -- verified, not guessed.
  'Lynchburg': null,
  'UMass Boston': null,
  'Texas Lutheran': null,
  'Occidental': null,
  'SUNY Delhi': null,
  'MSOE': null,
  'Neumann': null,
  'Transylvania': null,
  'Lehman': null,
  'Saint Joseph (CT)': null,
  'Pittsburg St.': null, // no "Pittsburg State" womens-soccer row found under any name
  'Western Wash.': 'Western Washington',
  'Western Ore.': 'Western Oregon',
  'Colo. Sch. of Mines': 'Colorado School of Mines',
  'DBU': 'Dallas Baptist',
  'Minnesota St.': 'Minnesota State',
  'Central Mo.': 'Central Missouri',
  'Texas Woman\'s': "Texas Woman's",
  'West Virginia St.': 'West Virginia State',
  'Fairmont St.': 'Fairmont State',
  'UNG': 'North Georgia',
  'Embry-Riddle (FL)': 'Embry-Riddle',
  'Embry-Riddle (AZ)': 'Embry-Riddle Aeronautical University Prescott',
  'Bethel (IN)': 'Bethel College (Kansas)', // placeholder, verified below instead
  'Baker (Kan.)': 'Baker',
  'Oklahoma City': null, // NAIA D-I men's Oklahoma City University -- verify separately
  'Westcliff (Calif.)': 'Westcliff University',
  'Madonna (Mich.)': 'Madonna University',
  'Harris-Stowe (Mo.)': 'Harris-Stowe State University',
  'Lindsey Wilson (Ky.)': 'Lindsey Wilson',
  'William Carey (Miss.)': 'William Carey University',
  'Rio Grande (Ohio)': 'Rio Grande (University of)',
  'Wiley (Texas)': 'Wiley University',
  'Carroll (Mont.)': 'Carroll (MT)',
  'LSU Alexandria (La.)': 'LSU Alexandria',
  'Milligan (Tenn.)': 'Milligan University',
  'Rocky Mountain (Mont.)': 'Rocky Mountain',
  'Union Commonwealth (Ky.)': 'Union (KY)',
  'La Sierra (Calif.)': 'La Sierra University',
  'Olivet Nazarene (Ill.)': 'Olivet Nazarene',
  'Eastern Oregon': 'Eastern Oregon',
  'Concordia (Neb.)': 'Concordia (NE)',
  'Faulkner (Ala.)': 'Faulkner University',
  'Dalton State (Ga.)': 'Dalton State College',
  'Keiser (Fla.)': 'Keiser University',
  'Xavier (La.)': 'Xavier (LA)',
  'Grace (Ind.)': 'Grace',
  'Cumberland (Tenn.)': 'Cumberland University',
  'LSU Shreveport (La.)': 'LSU Shreveport',
  'Ottawa (Kan.)': 'Ottawa',
  'Warner Pacific (OR)': 'Warner Pacific University',
  'William Penn (Iowa)': 'William Penn',
  'Indiana Tech': 'Indiana Institute of Technology',
  'Cumberlands (Ky.)': 'Cumberlands',
  'WVU Tech (WV)': 'West Virginia University Institute of Technology',
  'Aquinas (Mich.)': 'Aquinas',
  'Campbellsville (KY)': 'Campbellsville University',
  'College of Idaho': 'College of Idaho',
  'Columbia (MO)': 'Columbia (MO)',
  'Friends (KS)': 'Friends',
  'Georgia Gwinnett': 'Georgia Gwinnett College',
  'Holy Cross (Ind.)': 'Holy Cross College',
  'Marian': 'Marian University (IN)',
  'Mid-America Christian': 'Mid-America Christian University',
  'Missouri Valley': 'Missouri Valley College',
  'Morningside (Iowa)': 'Morningside',
  'Northwestern Ohio': 'University of Northwestern Ohio',
  'Oakland City (IN)': 'Oakland City University',
  'Science and Arts': 'Science & Arts (OK)',
  'Southeastern (Fla.)': 'Southeastern University',
  'Spring Arbor (Mich.)': 'Spring Arbor',
  "St. Ambrose (IA)": 'Saint Ambrose',
  'Talladega (AL)': 'Talladega College',
  'Taylor (IN)': 'Taylor',
  'Tennessee Wesleyan': 'Tennessee Wesleyan University',
  "The Master's (Calif.)": "The Master's University",
};

// Women's soccer uses full long-form names throughout (a systemic difference
// from men's short-form convention, confirmed by hand), so several bracket
// entries need a DIFFERENT target than the men's MANUAL_MAP above gives.
// Checked first for sport === 'womens-soccer', overriding MANUAL_MAP.
const WOMENS_OVERRIDES = {
  'Embry-Riddle (FL)': 'Embry–Riddle Aeronautical', // Daytona Beach, en-dash in the name -- not the Prescott/AZ campus
  'Minnesota St.': null, // three same-named schools (Mankato/Moorhead/Southwest) -- ambiguous, not guessed
  "St. Joseph's (L.I.)": "St. Joseph's University (Long Island)",
  'WashU': 'Washington University in St Louis',
  'Penn St. Harrisburg': 'Pennsylvania State University-Penn State Harrisburg',
  'Wash. & Lee': 'Washington and Lee University',
  'Wis.-La Crosse': 'University of Wisconsin-La Crosse',
  'Trinity (TX)': 'Trinity University',
  'CWRU': 'Case Western Reserve University',
  'Southern Me.': null, // no women's-soccer colleges row found under any name -- genuine gap
  'Westfield St.': 'Westfield State University',
  'Chris. Newport': 'Christopher Newport University',
  'Wis.-Superior': 'University of Wisconsin-Superior',
  'St. Catherine': 'St. Catherine University',
  'Aquinas (Mich.)': 'Aquinas College (Michigan)',
  'Columbia (MO)': 'Columbia College (MO)',
  'Cumberlands (Ky.)': 'University of the Cumberlands',
  'Eastern Oregon': 'Eastern Oregon University',
  'Friends (KS)': 'Friends University',
  'Grace (Ind.)': 'Grace College',
  'Lindsey Wilson (Ky.)': 'Lindsey Wilson University',
  'Morningside (Iowa)': 'Morningside University',
  'Science and Arts': 'University of Science and Arts of Oklahoma',
  'Southeastern (Fla.)': 'Southeastern University (Florida)',
  'Spring Arbor (Mich.)': 'Spring Arbor University',
  'St. Ambrose (IA)': 'Saint Ambrose University',
  'Taylor (IN)': 'Taylor University',
  'Xavier (La.)': 'Xavier University of Louisiana',
  'MIT': 'Massachusetts Institute of Technology',
  'North Central (IL)': 'North Central College', // NOT "North Central University" (Minneapolis) -- the same wrong-school pair app-55 found in roster_players
  'Illinois Tech': 'Illinois Institute of Technology',
  'Wesleyan (CT)': 'Wesleyan University',
  'Rochester (NY)': 'University of Rochester',
  'Stevens': 'Stevens Institute of Technology', // women's naming differs from men's "Stevens Tech"
  'Wilmington (OH)': 'Wilmington College',
  'Montclair St.': 'Montclair State University',
  'Cortland': 'SUNY College at Cortland', // women's naming differs from men's "SUNY Cortland"
  'NYU': 'New York University',
  'John Jay': 'CUNY John Jay College of Criminal Justice',
  'Rose-Hulman': 'Rose-Hulman Institute of Technology',
  'Bridgewater (VA)': 'Bridgewater College',
  'St. John Fisher': 'Saint John Fisher University',
  'Marymount (VA)': 'Marymount University',
  'Life': 'Life University',
  'Emmanuel (MA)': null, // no womens-soccer colleges row found under any name -- genuine gap
  'Bloomsburg': 'Commonwealth University-Bloomsburg',
  'Lee': 'Lee (TN)',
  'Columbus St.': 'Columbus State',
  'Bemidji St.': 'Bemidji State',
  'St. Cloud St.': 'St. Cloud State',
  'Grand Valley St.': 'Grand Valley State',
  'Midwestern St.': 'Midwestern State',
  // West Florida needs a cross-division write (its womens-soccer colleges
  // row sits under NCAA D1, not this D2 bracket) -- excluded here and
  // handled via CROSS_DIVISION below.
  'West Florida': null,
  'Azusa Pacific': 'Azusa Pacific University', // now correctly NCAA D2, resolves via the normal path
};

/** Bracket entries whose colleges row sits under a DIFFERENT division than
 * the tournament itself -- West Florida's womens-soccer row is filed under
 * NCAA D1 (a real multi-division-membership transition, confirmed earlier
 * this session). Azusa Pacific was ALSO mislabeled NCAA D3/SCIAC (a real
 * future transition target applied prematurely -- it plays 2025-26 as
 * NCAA D2/PacWest) but that has since been corrected directly on the row
 * (division/conference/score all fixed), so this list no longer needs an
 * entry for it. */
const CROSS_DIVISION = [
  { sport: 'womens-soccer', bracketName: 'West Florida', division: 'NCAA D1', name: 'West Florida', round: 'r16' },
];

function loadEntries(fp) {
  return fs.readFileSync(fp, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name, round] = line.split('|').map((s) => s.trim());
    return { name, round };
  });
}

function main() {
  let totalSet = 0;
  let totalUnchanged = 0;
  const unresolved = [];

  for (const { file, sport, division } of SOURCES) {
    const entries = loadEntries(`${SCRATCH}/${file}`);
    const candidates = College.filter({ sport, division }).map((c) => c.name);
    let set = 0;
    for (const { name, round } of entries) {
      // A `null` from one of OUR maps means "deliberately excluded, verified
      // not to exist -- do not guess". A `null` from matchSchoolName means
      // "the automatic matcher found nothing", which is not the same thing
      // and must not be silently swallowed the same way -- that bug is what
      // hid 15 real D3 men's misses (St. Olaf, Cortland, etc.) behind a
      // report that claimed zero unresolved names.
      const explicit = sport === 'womens-soccer' && WOMENS_OVERRIDES[name] !== undefined
        ? WOMENS_OVERRIDES[name]
        : MANUAL_MAP[name];
      if (explicit === null) continue; // deliberately excluded, not guessed
      const target = explicit !== undefined ? explicit : matchSchoolName(name, candidates);
      if (!target) { unresolved.push(`${sport}/${division}: '${name}' (${round})`); continue; }
      const row = College.filter({ sport, division, name: target })[0];
      if (!row) { unresolved.push(`${sport}/${division}: '${name}' -> '${target}' not found`); continue; }
      if (row.postseason_2025_round === round) { totalUnchanged++; continue; }
      set++;
      if (APPLY) College.update(row.id, { postseason_2025_round: round });
    }
    console.log(`${sport}/${division}: ${entries.length} teams, ${set} ${APPLY ? 'set' : 'would set'}`);
    totalSet += set;
  }

  for (const c of CROSS_DIVISION) {
    const row = College.filter({ sport: c.sport, division: c.division, name: c.name })[0];
    if (!row) { unresolved.push(`${c.sport}/${c.division}: '${c.bracketName}' -> '${c.name}' not found (cross-division)`); continue; }
    if (row.postseason_2025_round === c.round) { totalUnchanged++; continue; }
    totalSet++;
    console.log(`cross-division: ${c.bracketName} -> ${c.name} (${c.division}) ${APPLY ? 'set' : 'would set'} to ${c.round}`);
    if (APPLY) College.update(row.id, { postseason_2025_round: c.round });
  }

  console.log(`\nTotal ${APPLY ? 'set' : 'would set'}: ${totalSet}, already correct: ${totalUnchanged}, unresolved: ${unresolved.length}`);
  if (unresolved.length) {
    console.log('\nUnresolved (need a manual mapping):');
    unresolved.forEach((u) => console.log(' ', u));
  }
  if (!APPLY) console.log('\nDry run only -- re-run with --apply to write these to the database.');
}

main();
