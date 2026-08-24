/**
 * Women's-soccer counterpart to populateConferenceChampions2025.data.js --
 * the 2025 conference champion for every D2/D3/NAIA conference in our
 * women's-soccer database, gathered the same way (parallel research agents,
 * one per division, D3 split into two batches). D1 is handled separately by
 * populateConferenceChampions2025Women.js, which parses a single Wikipedia
 * table. There is no NJCAA entry here because our database has no NJCAA
 * women's-soccer colleges at all yet (see memory graduating-db-rebuild /
 * the roadmap notes -- NJCAA women's is a deferred, not-yet-built gap).
 *
 * `champion` is whatever school the agent actually found, matched by name
 * against every college in the given `division` + `sport`, not scoped to
 * the conference the researcher started from (our own `conference` field
 * can be stale after realignment). A champion that isn't in our database
 * under that division/sport simply produces no match -- expected, not an
 * error.
 *
 * Excluded outright, confirmed genuine dead ends by the research agents:
 * - Colonial States Athletic Conference (D3): dissolved/merged into United
 *   East Conference in 2023, no independent 2025 season exists.
 * - New England Collegiate Conference (D3): rebranded to the New England
 *   Volleyball Conference in 2023-24 and no longer sponsors women's soccer.
 */

export const CHAMPIONS_2025_WOMEN = [
  // ---- NCAA D2 ----
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'CCAA', champion: 'Cal Poly Humboldt', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 CCAA tournament, beating Chico State 1-0 in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'CACC', champion: 'Wilmington (DE)', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 CACC tournament, beating Caldwell 2-0 in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'Conference Carolinas', champion: 'Belmont Abbey', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 Conference Carolinas tournament, beating Francis Marion 2-1 in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'ECC', champion: 'Roberts Wesleyan', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 ECC tournament, beating Mercy 1-0 in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'GAC', champion: 'Harding', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 GAC tournament, beating Ouachita Baptist 1-0 in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'GLIAC', champion: 'Grand Valley State', source: 'agent-research:2025-womens-soccer', notes: "won 2025 GLIAC women's soccer tournament" },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'GLVC', champion: 'Drury', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 GLVC tournament, beating McKendree 0-0 (3-2 PKs) in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'GMAC', champion: 'Ashland', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 G-MAC tournament, beating Findlay 3-0 in the final (back-to-back title)' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'GNAC', champion: 'Simon Fraser', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 GNAC tournament, beating Western Washington 1-0 (5-4 PKs) in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'GSC', champion: 'West Florida', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 GSC tournament, beating Montevallo 1-0 in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'LSC', champion: 'Dallas Baptist', source: 'agent-research:2025-womens-soccer', notes: "won 2025 LSC tournament, beating Texas Woman's 3-2 in the final" },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'MIAA', champion: 'Missouri Western', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 MIAA tournament, beating Central Oklahoma 2-1 in OT in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'MEC', champion: 'Fairmont State', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 MEC tournament, beating Charleston 4-1 in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'Northeast-10', champion: 'Saint Anselm', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 NE10 tournament on PKs (1-1, won 4-3) over Franklin Pierce' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'NSIC', champion: 'Minnesota State Mankato', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 NSIC tournament, beating St. Cloud State 2-1 in double OT' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'PacWest', champion: 'Point Loma Nazarene', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 PacWest tournament, beating Dominican 2-1 in double OT' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'PBC', champion: 'Columbus State', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 PBC tournament, beating North Georgia 1-0 in the final (third straight title)' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'PSAC', champion: 'Shepherd', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 PSAC tournament, beating Kutztown 4-1 in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'RMAC', champion: 'Colorado School of Mines', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 RMAC tournament, beating Colorado Mesa 1-0 in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'SAC', champion: 'Catawba', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 SAC tournament, beating Lenoir-Rhyne 3-2 in OT in the final' },
  { division: 'NCAA D2', sport: 'womens-soccer', conference: 'SSC', champion: 'Nova Southeastern', source: 'agent-research:2025-womens-soccer', notes: 'won 2025 SSC tournament, beating Florida Tech 1-1 (6-5 PKs)' },

  // ---- NCAA D3 ----
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'AMCC', champion: 'Pennsylvania State University-Penn State Erie (Behrend College)', source: 'agent-research:2025-womens-soccer', notes: 'beat Pitt-Greensburg 7-0 in the Nov 8, 2025 AMCC final' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'American Rivers', champion: 'Loras', source: 'agent-research:2025-womens-soccer', notes: 'beat Dubuque 1-0 on Nov 8, 2025 for the conference tournament title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'ASC', champion: 'Hardin-Simmons', source: 'agent-research:2025-womens-soccer', notes: 'beat Mary Hardin-Baylor 1-0 (golden goal) on Nov 8, 2025, 27th ASC title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'AEC', champion: 'Marymount', source: 'agent-research:2025-womens-soccer', notes: 'beat Gwynedd Mercy 4-0 on Nov 8, 2025 to reclaim the AEC title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'Centennial', champion: 'Johns Hopkins', source: 'agent-research:2025-womens-soccer', notes: 'beat Swarthmore 2-1 on Nov 9, 2025 in the Centennial final' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'CUNYAC', champion: 'CUNY John Jay College of Criminal Justice', source: 'agent-research:2025-womens-soccer', notes: 'beat CCNY 3-0 on Nov 8, 2025, 5th CUNYAC title in 6 years' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'C2C', champion: 'Christopher Newport', source: 'agent-research:2025-womens-soccer', notes: 'beat UC Santa Cruz 1-0 (OT) on Nov 9, 2025 in the C2C final' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'CCIW', champion: 'North Central', source: 'agent-research:2025-womens-soccer', notes: 'went 8-0-0 in league and won the CCIW tournament' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'CCS', champion: 'Belhaven', source: 'agent-research:2025-womens-soccer', notes: "beat Asbury 2-1 for the program's first CCS title" },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'CNE', champion: 'University of Hartford', source: 'agent-research:2025-womens-soccer', notes: 'beat Endicott 2-0 on Nov 8, 2025 for the CNE title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'ECAC', champion: 'Waynesburg', source: 'agent-research:2025-womens-soccer', notes: 'beat Keene State 1-0 in the DIII ECAC final' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'Empire 8', champion: 'Saint John Fisher University', source: 'agent-research:2025-womens-soccer', notes: "won its first Empire 8 title on Nov 8, 2025" },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'HCAC', champion: 'Rose-Hulman', source: 'agent-research:2025-womens-soccer', notes: 'beat Hanover 1-0 on Nov 8, 2025 for the HCAC title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'Landmark', champion: 'University of Scranton', source: 'agent-research:2025-womens-soccer', notes: 'beat Catholic 1-0 on Nov 8, 2025, 6th straight Landmark title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'Liberty League', champion: 'Vassar', source: 'agent-research:2025-womens-soccer', notes: 'beat RIT 1-0 in the 2025 Liberty League final' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'MASCAC', champion: 'Westfield State', source: 'agent-research:2025-womens-soccer', notes: 'beat Worcester State 1-0 for the 2025 MASCAC title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'MIAA-D3', champion: 'Calvin', source: 'agent-research:2025-womens-soccer', notes: 'beat Hope 2-1 on Nov 8, 2025, 4th straight MIAA tournament title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'MAC Commonwealth', champion: 'Messiah', source: 'agent-research:2025-womens-soccer', notes: 'beat Stevenson 4-0 on Nov 8, 2025, 7th straight MAC Commonwealth title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'MAC Freedom', champion: 'Stevens', source: 'agent-research:2025-womens-soccer', notes: 'beat Misericordia 3-0 on Nov 8, 2025 for the MAC Freedom title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'MWC-D3', champion: 'Lake Forest', source: 'agent-research:2025-womens-soccer', notes: 'beat Lawrence 1-0 on Nov 8, 2025, 3rd straight MWC title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'MIAC', champion: 'Carleton', source: 'agent-research:2025-womens-soccer', notes: 'won the MIAC playoff title on Nov 8, 2025 over St. Catherine' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'NESCAC', champion: 'Tufts', source: 'agent-research:2025-womens-soccer', notes: 'beat Williams 5-3 on PKs (2-2) to win the 2025 NESCAC title, first in 23 years' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'NEWMAC', champion: 'Massachusetts Institute of Technology', source: 'agent-research:2025-womens-soccer', notes: 'beat Springfield 3-0 in the 2025 NEWMAC championship game' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'NJAC', champion: 'Montclair State', source: 'agent-research:2025-womens-soccer', notes: 'beat Rowan on PKs to win the 2025 NJAC championship' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'NAC', champion: 'Lesley', source: 'agent-research:2025-womens-soccer', notes: 'beat Maine Maritime 3-1 to win the 2025 North Atlantic Conference title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'NCAC', champion: 'John Carroll', source: 'agent-research:2025-womens-soccer', notes: 'beat Denison 1-0 to win the 2025 NCAC tournament title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'NACC', champion: 'Illinois Institute of Technology', source: 'agent-research:2025-womens-soccer', notes: 'beat Milwaukee School of Engineering 3-1 on Nov 8 to win the 2025 NACC title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'NWC', champion: 'Pacific Lutheran', source: 'agent-research:2025-womens-soccer', notes: 'finished 12-0-4, 9th straight NWC regular-season title (no conference tournament)' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'OAC', champion: 'Wilmington College', source: 'agent-research:2025-womens-soccer', notes: 'beat Ohio Northern 3-2 to win the 2025 OAC tournament championship' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'ODAC', champion: 'Washington and Lee', source: 'agent-research:2025-womens-soccer', notes: 'beat Virginia Wesleyan in an 8-round shootout, second straight ODAC title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'PAC', champion: 'Grove City', source: 'agent-research:2025-womens-soccer', notes: 'beat Waynesburg 1-0 to win the 2025 PAC championship, third straight title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'Skyline', champion: "St. Joseph's University (Long Island)", source: 'agent-research:2025-womens-soccer', notes: 'won the 2025 Skyline championship in double overtime' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'SAA', champion: 'Trinity University', source: 'agent-research:2025-womens-soccer', notes: 'beat Rhodes 3-0 on Nov 9 to win the 2025 SAA championship' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'SCIAC', champion: 'California Lutheran University', source: 'agent-research:2025-womens-soccer', notes: "beat Pomona-Pitzer 2-1 for its first SCIAC tournament title since 2011" },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'SCAC', champion: 'McMurry', source: 'agent-research:2025-womens-soccer', notes: 'beat Concordia 1-0 to win the 2025 SCAC tournament championship' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'SLIAC', champion: 'Lyon', source: 'agent-research:2025-womens-soccer', notes: 'won the 2025 SLIAC tournament on Nov 9' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'SUNYAC', champion: 'SUNY College at Cortland', source: 'agent-research:2025-womens-soccer', notes: 'beat Plattsburgh 3-2 to win the 2025 SUNYAC title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'USA South', champion: 'Brevard', source: 'agent-research:2025-womens-soccer', notes: 'beat Southern Virginia 5-4 on PKs (0-0) for its first USA South tournament title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'United East', champion: 'Pennsylvania State University-Penn State Harrisburg', source: 'agent-research:2025-womens-soccer', notes: 'beat St. Mary\'s (MD) on PKs (0-0) to win the 2025 United East title' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'UAA', champion: 'Washington University in St. Louis', source: 'agent-research:2025-womens-soccer', notes: 'clinched the 2025 UAA title with a 3-1 win over NYU, third straight crown (no conference tournament)' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'UMAC', champion: 'University of Wisconsin-Superior', source: 'agent-research:2025-womens-soccer', notes: 'beat Northwestern (MN) 1-0 on Nov 8, fifth straight UMAC championship' },
  { division: 'NCAA D3', sport: 'womens-soccer', conference: 'WIAC', champion: 'University of Wisconsin-La Crosse', source: 'agent-research:2025-womens-soccer', notes: 'beat UW-Platteville 2-0 on Nov 9, fourth straight WIAC tournament title' },

  // ---- NAIA ----
  { division: 'NAIA', sport: 'womens-soccer', conference: 'AMC', champion: 'Columbia College (MO)', source: 'agent-research:2025-womens-soccer', notes: 'beat Harris-Stowe State 1-0 in the AMC tournament final, Nov 10, 2025' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'Appalachian', champion: 'Tennessee Wesleyan', source: 'agent-research:2025-womens-soccer', notes: "won the 2025 AAC women's soccer tournament title" },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'Cal Pac', champion: 'Westcliff', source: 'agent-research:2025-womens-soccer', notes: 'won the 2025 Cal Pac tournament title (17-1-1 season)' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'Cascade', champion: 'College of Idaho', source: 'agent-research:2025-womens-soccer + cascadeconference.org final standings', notes: '2025-26 CCC final all-sports standings confirm College of Idaho as women\'s soccer champion' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'CCAC', champion: 'Saint Ambrose University', source: 'agent-research:2025-womens-soccer', notes: 'won the 2025 CCAC title, a "double three-peat"' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'CAC', champion: 'Georgia Gwinnett', source: 'agent-research:2025-womens-soccer', notes: 'beat Bellevue 4-2 in the 2025 CAC final, 3rd straight/8th overall title' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'Crossroads League', champion: 'Grace', source: 'agent-research:2025-womens-soccer', notes: 'beat Marian to win the 2025 Crossroads League tournament' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'GPAC', champion: 'Hastings', source: 'agent-research:2025-womens-soccer', notes: '2025 GPAC postseason tournament champion' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'GSAC', champion: "The Master's University", source: 'agent-research:2025-womens-soccer', notes: 'beat Embry-Riddle (Ariz.) 5-4 on PKs (0-0) in the Nov 12 GSAC final' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'HBCUAC', champion: 'Talladega', source: 'agent-research:2025-womens-soccer', notes: 'beat Huston-Tillotson 3-1 in the 2025 HBCUAC final' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'Heart', champion: 'Missouri Valley', source: 'agent-research:2025-womens-soccer', notes: 'beat Central Methodist 2-0 to win the 2025 Heart tournament' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'KCAC', champion: 'Oklahoma Wesleyan', source: 'agent-research:2025-womens-soccer', notes: 'won the 2025 KCAC tournament title' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'Mid-South', champion: 'Campbellsville', source: 'agent-research:2025-womens-soccer', notes: 'beat Cumberlands 2-1 in OT in the 2025 Mid-South final, Nov 11' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'RRAC', champion: 'Xavier University of Louisiana', source: 'agent-research:2025-womens-soccer', notes: 'beat LSU Shreveport 2-0 to repeat as 2025 RRAC champion' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'RSC', champion: 'Oakland City', source: 'agent-research:2025-womens-soccer', notes: 'won its second consecutive RSC championship in 2025' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'Sooner', champion: 'John Brown', source: 'agent-research:2025-womens-soccer', notes: "beat Science & Arts (Okla.) 3-1 on Nov 12, 6th consecutive SAC tournament title" },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'SSAC', champion: 'William Carey', source: 'agent-research:2025-womens-soccer', notes: 'beat Life 2-0 in the 2025 SSAC final, 5th straight title' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'Sun Conference', champion: 'Southeastern University (Florida)', source: 'agent-research:2025-womens-soccer', notes: 'beat Keiser 3-2 in the 2025 Sun Conference final, Nov 12' },
  { division: 'NAIA', sport: 'womens-soccer', conference: 'WHAC', champion: 'University of Northwestern Ohio', source: 'agent-research:2025-womens-soccer', notes: 'beat Aquinas 1-0 in the 2025 WHAC final, Nov 12' },
];
