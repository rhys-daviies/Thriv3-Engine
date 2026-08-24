/**
 * Research results for the 2025 men's soccer conference champion of every
 * D2/D3/NAIA/NJCAA conference in our database, gathered by parallel research
 * agents (one per division, D3 and NJCAA split into two batches each) doing
 * targeted web searches per conference. D1 is handled separately by
 * populateConferenceChampions2025.js itself, which parses a single Wikipedia
 * table -- this file only covers the divisions Wikipedia doesn't track at
 * conference granularity.
 *
 * `champion` is whatever school the agent actually found, even when that
 * school wasn't one of the 2-4 sample members given to the agent for
 * disambiguation (samples were only there to confirm the agent found the
 * right REAL conference, not an exhaustive membership list -- most
 * conferences have 8-15+ members). The apply script matches `champion`
 * against every school in the given `division`, not just the ones we
 * happened to sample, and by name rather than by our own `conference`
 * field (which can be stale after realignment -- see the D1 script's notes
 * on Grand Canyon). A champion that isn't in our database at all under
 * that division simply produces no match; that's an expected, harmless
 * outcome, not an error.
 *
 * Excluded outright are only the cases an agent flagged as a genuine dead
 * end: a dissolved/merged conference, a sport not sponsored, or an
 * abbreviation it couldn't confidently resolve to any real conference at
 * all -- see the excluded-list comments per division.
 */

export const CHAMPIONS_2025 = [
  // ---- NCAA D2 ----
  { division: 'NCAA D2', conference: 'CACC', champion: 'Bridgeport', source: 'https://caccathletics.org/news/2025/11/16/second-half-comeback-lifts-bridgeport-to-2025-cacc-mens-soccer-championship.aspx' },
  { division: 'NCAA D2', conference: 'CCAA', champion: 'Cal State Stanislaus', source: 'https://goccaa.org/news/2025/11/16/mens-soccer-stanislaus-state-wins-the-2025-ccaa-tournament-championship-presented-by-flocollege.aspx' },
  { division: 'NCAA D2', conference: 'CIAA', champion: 'Virginia State', source: 'https://theciaa.com/news/2025/11/10/about-the-ciaa-virginia-state-sweeps-inaugural-ciaa-soccer-cups-with-mens-and-womens-titles.aspx' },
  { division: 'NCAA D2', conference: 'ECC', champion: 'Roberts Wesleyan', source: 'https://eccsports.org/news/2025/11/16/roberts-wesleyan-wins-programs-first-ecc-mens-soccer-championship.aspx' },
  { division: 'NCAA D2', conference: 'GAC', champion: 'Fort Hays State', source: 'https://fhsuathletics.com/news/2025/11/15/mens-soccer-no-4-tigers-secure-gac-miaa-championship.aspx' },
  { division: 'NCAA D2', conference: 'GLIAC', champion: 'Northern Michigan', source: 'https://www.uppermichiganssource.com/2025/11/16/northern-michigan-mens-soccer-wins-gliac-title-first-time-program-history/' },
  { division: 'NCAA D2', conference: 'GLVC', champion: 'Maryville (MO)', source: 'https://glvcsports.com/news/2025/11/15/championships-maryville-claims-fourth-glvc-mens-soccer-championship.aspx' },
  { division: 'NCAA D2', conference: 'GMAC', champion: 'Tiffin', source: 'https://greatmidwestsports.com/news/2025/11/15/tiffin-secures-fourth-g-mac-mens-soccer-title.aspx' },
  { division: 'NCAA D2', conference: 'GNAC', champion: 'Western Oregon', source: 'https://gnacsports.com/news/2025/11/15/mens-soccer-wolves-win-gnac-championship-in-double-overtime.aspx' },
  { division: 'NCAA D2', conference: 'GSC', champion: 'West Florida', source: 'https://gscsports.org/news/2025/11/16/msoc-champs-25.aspx' },
  { division: 'NCAA D2', conference: 'LSC', champion: 'Midwestern State', source: 'https://msumustangs.com/news/2025/11/15/mens-soccer-wins-5th-straight-lone-star-conference-tournament-championship-beating-3-lubbock-christian-1-0.aspx' },
  { division: 'NCAA D2', conference: 'Lone Star', champion: 'Midwestern State', source: 'https://msumustangs.com/news/2025/11/15/mens-soccer-wins-5th-straight-lone-star-conference-tournament-championship-beating-3-lubbock-christian-1-0.aspx' },
  { division: 'NCAA D2', conference: 'MEC', champion: 'Charleston (WV)', source: 'https://mountaineast.org/news/2025/11/16/charleston-repeats-as-mec-mens-soccer-tournament-champion.aspx' },
  { division: 'NCAA D2', conference: 'MIAA', champion: 'Fort Hays State', source: 'https://fhsuathletics.com/news/2025/11/15/mens-soccer-no-4-tigers-secure-gac-miaa-championship.aspx' },
  { division: 'NCAA D2', conference: 'Mountain East', champion: 'Charleston (WV)', source: 'https://mountaineast.org/news/2025/11/16/charleston-repeats-as-mec-mens-soccer-tournament-champion.aspx' },
  { division: 'NCAA D2', conference: 'Northeast-10', champion: 'Franklin Pierce', source: 'https://bentleyfalcons.com/news/2025/11/15/mens-soccer-franklin-pierce-claims-ne10-title-over-bentley-4-1.aspx' },
  { division: 'NCAA D2', conference: 'PSAC', champion: 'Gannon', source: 'https://gannonsports.com/news/2025/11/16/mens-soccer-no-14-mens-soccer-claims-first-psac-title-in-program-history.aspx' },
  { division: 'NCAA D2', conference: 'PacWest', champion: 'Point Loma Nazarene', source: 'https://thepacwest.com/news/2025/12/15/pacwest-mens-soccer-season-one-for-the-books.aspx' },
  { division: 'NCAA D2', conference: 'RMAC', champion: 'UCCS', source: 'https://rmacsports.org/news/2025/11/16/rmac-mens-soccer-championship-uccs-claims-first-rmac-tournament-title.aspx' },
  { division: 'NCAA D2', conference: 'SAC', champion: 'Lincoln Memorial', source: 'https://sac.prestosports.com/sports/msoc/2025-26/news' },
  { division: 'NCAA D2', conference: 'WHAC', champion: 'Davenport', source: 'https://www.whac.net/sports/msoc/2025-26/releases/20251104eyspd5', notes: 'regular-season champion (no evidence of a separate WHAC D2 postseason tournament)' },
  // Excluded (agent-confirmed dissolved/stale/wrong-conference, or a
  // caveat too weak to trust): AMC, CAA, CCAC, Conference USA, ECAC,
  // Heartland, NSIC, Peach Belt, Sunshine State (not found / dissolved /
  // sport not sponsored), Mid-South (low confidence, unconfirmed quote),
  // Golden State (agent flagged that Menlo, our only D2 "Golden State"
  // school, has left this conference entirely).

  // ---- NCAA D3 ----
  { division: 'NCAA D3', conference: 'AMCC', champion: 'La Roche', source: 'https://mountieathletics.com/news/2025/11/8/mens-soccer-mount-aloysius-falls-short-in-amcc-championship-match.aspx' },
  { division: 'NCAA D3', conference: 'ASC', champion: 'Hardin-Simmons', source: 'https://ascsports.org/news/2025/11/9/hardin-simmons-wins-2025-asc-mens-soccer-championship-with-penalty-kicks.aspx' },
  { division: 'NCAA D3', conference: 'CAC', champion: 'Christopher Newport', source: 'https://www.c2csports.com/sports/msoc/index', notes: 'CAC was renamed the Coast-to-Coast (C2C) Conference in 2020' },
  { division: 'NCAA D3', conference: 'CCC', champion: 'Roger Williams', source: 'https://cnesports.org/news/2025/11/9/mens-soccer-hawks-take-home-cne-championship-defeat-suffolk-on-pks.aspx', notes: 'CCC was renamed the Conference of New England (CNE) for 2024-25' },
  { division: 'NCAA D3', conference: 'CCIW', champion: 'Illinois Wesleyan', source: 'https://cciw.org/news/2025/11/8/illinois-wesleyan-earns-second-cciw-mens-soccer-crown.aspx' },
  { division: 'NCAA D3', conference: 'CCS', champion: 'Maryville (TN)', source: 'https://mcscots.com/news/2025/11/10/mens-soccer-maryville-outlasts-covenant-in-shootout-to-bring-home-the-ccs-championship.aspx' },
  { division: 'NCAA D3', conference: 'Centennial', champion: 'Dickinson', source: 'https://www.dickinson.edu/news/article/6285/dickinson_wins_centennial_conference_mens_soccer_tournament' },
  { division: 'NCAA D3', conference: 'Empire 8', champion: 'SUNY Geneseo', source: 'https://empire8.com/news/2025/11/6/no-1-suny-geneseo-and-no-2-seed-suny-brockport-to-meet-in-2025-empire-8-mens-soccer-championship-match.aspx' },
  { division: 'NCAA D3', conference: 'HCAC', champion: 'Transylvania', source: 'https://heartlandconf.org/news/2025/11/9/2025-hcac-mens-soccer-championship-recap.aspx' },
  { division: 'NCAA D3', conference: 'Iowa Conference', champion: 'Luther', source: 'https://luthernorse.com/news/2025/11/8/mens-soccer-luther-wins-a-r-c-tournament-championship-with-1-0-victory-over-wartburg.aspx', notes: 'renamed the American Rivers Conference (A-R-C) in 2018' },
  { division: 'NCAA D3', conference: 'LANDMARK', champion: 'Catholic', source: 'https://landmarkconference.org/news/2025/11/9/11112025-mens-soccer-all-conference.aspx' },
  { division: 'NCAA D3', conference: 'Landmark', champion: 'Catholic', source: 'https://landmarkconference.org/news/2025/11/9/11112025-mens-soccer-all-conference.aspx' },
  { division: 'NCAA D3', conference: 'LEC', champion: 'UMass Boston', source: 'https://beaconsathletics.com/news/2025/11/8/mens-soccer-mens-soccer-captures-2025-lec-championship-in-danbury-over-westconn.aspx' },
  { division: 'NCAA D3', conference: 'Liberty League', champion: 'Hobart & William Smith', source: 'https://libertyleagueathletics.com/news/2025/11/11/liberty-league-unveils-2025-mens-soccer-accolades-vassars-fiske-named-player-of-the-year.aspx' },
  { division: 'NCAA D3', conference: 'MAC', champion: 'Stevens Tech', source: 'https://stevensducks.com/news/2025/11/1/mens-soccer-clinches-mac-freedom-regular-season-title-with-3-0-win-over-delaware-valley.aspx' },
  { division: 'NCAA D3', conference: 'MAC Commonwealth', champion: 'Messiah', source: 'https://gomacsports.com/news/2025/11/9/mens-soccer-defeats-stevenson-wins-seventh-straight-mac-commonwealth-championship.aspx' },
  { division: 'NCAA D3', conference: 'MAC Freedom', champion: 'Stevens Tech', source: 'https://stevensducks.com/news/2025/11/8' },
  { division: 'NCAA D3', conference: 'MASCAC', champion: 'Bridgewater State', source: 'https://www.mascac.com/sports/msoc/2025-26/releases/25_MSOC_Champ' },
  { division: 'NCAA D3', conference: 'MIAA-D3', champion: 'Calvin', source: 'https://calvinknights.com/news/2025/11/8/calvin-mens-soccer-defeats-hope-2-0-to-claim-miaa-tournament-title.aspx' },
  { division: 'NCAA D3', conference: 'MIAC', champion: 'Macalester', source: 'https://athletics.macalester.edu/news/2025/11/8/mens-soccer-mens-soccer-macalester-wins-miac-playoff-championship-with-4-1-victory-over-no-4-st-olaf.aspx' },
  { division: 'NCAA D3', conference: 'MWC-D3', champion: 'Lake Forest', source: 'https://midwestconference.org/news/2025/11/9/general-lake-forest-secures-fourth-mwc-tournament-title-in-a-row.aspx' },
  { division: 'NCAA D3', conference: 'NAC', champion: 'SUNY Delhi', source: 'https://athletics.thomas.edu/news/2025/11/8/mens-soccer-falls-short-in-nac-championship-against-suny-delhi.aspx' },
  { division: 'NCAA D3', conference: 'NACC', champion: 'Milwaukee School of Engineering', source: 'https://naccsports.org/news/2025/11/8/msoe-wins-nacc-mens-soccer-tournament.aspx' },
  { division: 'NCAA D3', conference: 'NCAC', champion: 'DePauw', source: 'https://depauwtigers.com/news/2025/11/8/mens-soccer-claim-ncac-tournament-title.aspx' },
  { division: 'NCAA D3', conference: 'NESCAC', champion: 'Tufts', source: 'https://nescac.com/news/2025/11/9/top-seeded-tufts-claims-2025-nescac-mens-soccer-crown.aspx' },
  { division: 'NCAA D3', conference: 'NEWMAC', champion: 'Babson', source: 'https://newmacsports.com/news/2025/11/8/general-babson-captures-second-straight-newmac-mens-soccer-championship.aspx' },
  { division: 'NCAA D3', conference: 'NWC', champion: 'Whitman', source: 'https://nwcsports.com/news/2025/11/9/whitman-claims-2025-nwc-mens-soccer-title-and-ncaa-automatic-qualification.aspx', notes: 'regular-season champion (no NWC postseason tournament)' },
  { division: 'NCAA D3', conference: 'OAC', champion: 'Otterbein', source: 'https://oac.org/news/2025/11/9/mens-soccer-otterbein-outlasts-onu-in-penalty-kicks-wins-second-straight-oac-tournament-title.aspx' },
  { division: 'NCAA D3', conference: 'ODAC', champion: 'Lynchburg', source: 'https://lynchburgsports.com/news/2025/11/8/mens-soccer-claims-20th-odac-championship-title-in-win-over-washington-and-lee.aspx' },
  { division: 'NCAA D3', conference: 'PAC', champion: 'Grove City', source: 'https://pacathletics.org/news/2025/11/8/2025-all-pac-mens-soccer-teams-major-awards-released.aspx' },
  { division: 'NCAA D3', conference: 'SAA', champion: 'Berry', source: 'https://saa-sports.com/news/2025/11/11/two-saa-mens-soccer-teams-heading-to-ncaa-division-iii-tournament.aspx' },
  { division: 'NCAA D3', conference: 'SCAC', champion: 'Texas Lutheran', source: 'https://tlubulldogs.com/news/2025/11/9/mens-soccer-triumphs-in-scac-tournament-championship.aspx' },
  { division: 'NCAA D3', conference: 'SCIAC', champion: 'Occidental', source: 'https://oxyathletics.com/news/2025/11/8/mens-soccer-champs-mens-soccer-wins-second-sciac-title-in-three-seasons.aspx' },
  { division: 'NCAA D3', conference: 'SLIAC', champion: 'Lyon College', source: 'https://www.kait8.com/2025/11/09/lyon-wins-sliac-mens-soccer-championship/' },
  { division: 'NCAA D3', conference: 'SUNYAC', champion: 'SUNY Oneonta', source: 'https://www.sunyacsports.com/sports/msoc/2025-26/releases/20251107e8snt6' },
  { division: 'NCAA D3', conference: 'Skyline', champion: 'St. Joseph\'s (NY)', source: 'https://sjliathletics.com/news/2025/11/8/mens-soccer-wins-skyline-conference-championship.aspx' },
  { division: 'NCAA D3', conference: 'UAA', champion: 'Washington (MO)', source: 'https://washubears.com/news/2025/11/8/champs-no-12-washu-mens-soccer-wins-2025-uaa-title-with-1-0-shutout-over-no-3-chicago.aspx' },
  { division: 'NCAA D3', conference: 'UMAC', champion: 'Wisconsin-Superior', source: 'https://umacathletics.com/news/2025/11/8/uw-superior-wins-2025-umac-mens-soccer-tournament-championship.aspx' },
  { division: 'NCAA D3', conference: 'USA South', champion: 'North Carolina Wesleyan', source: 'https://ncwsports.com/news/2025/11/8/mens-soccer-captures-usa-south-championship-punches-ticket-to-ncaa-tournament.aspx' },
  { division: 'NCAA D3', conference: 'WIAC', champion: 'Wisconsin-Eau Claire', source: 'WIAC official 2025 championship coverage' },
  // Excluded (dissolved/renamed away from our sample schools, or sport not
  // sponsored): CSAC, NEAC, NECC, NIAC.

  // ---- NAIA ----
  { division: 'NAIA', conference: 'AMC', champion: 'Harris-Stowe', source: 'https://hornetsathletics.com' },
  { division: 'NAIA', conference: 'Appalachian', champion: 'Union (KY)', source: 'https://www.aacsports.com/sports/msoc/2025-26/releases/20251108wnmit6' },
  { division: 'NAIA', conference: 'CCAC', champion: 'Bethel (IN)', source: 'https://www.crossroadsleague.com' },
  { division: 'NAIA', conference: 'Cascade', champion: 'Warner Pacific', source: 'https://cascadeconference.org/news/2025/11/6' },
  { division: 'NAIA', conference: 'GPAC', champion: 'Concordia (NE)', source: 'https://gpacsports.com/sports/msoc/2025-26/releases' },
  { division: 'NAIA', conference: 'Golden State', champion: 'La Sierra', source: 'https://gsacsports.org/news/2025/11/12/la-sierra-captures-2025-gsac-mens-soccer-championship.aspx', notes: 'conference rebranded Golden State -> Great Southwest Athletic Conference in 2024' },
  { division: 'NAIA', conference: 'HAAC', champion: 'MidAmerica Nazarene', source: 'https://heartofamericaconference.com/sports/msoc/2025-26/releases' },
  { division: 'NAIA', conference: 'Heart', champion: 'MidAmerica Nazarene', source: 'https://heartofamericaconference.com/sports/msoc/2025-26/releases', notes: '"Heart" and "HAAC" are the same real conference (Heart of America Athletic Conference)' },
  { division: 'NAIA', conference: 'KCAC', champion: 'Oklahoma Wesleyan', source: 'https://okwueagles.com/news/2025/11/12/mens-soccer-eagles-defeat-ottawa-to-claim-2025-kcac-tournament-championship.aspx' },
  { division: 'NAIA', conference: 'Mid-South', champion: 'Bethel (TN)', source: 'https://mid-southconference.org/news/bethel-wins-first-ever-mid-south-conference-mens-soccer-tournament' },
  { division: 'NAIA', conference: 'NACC', champion: 'Olivet Nazarene', source: 'https://www.ccacsports.com/sports/msoc/index', notes: 'real conference is the Chicagoland Collegiate Athletic Conference (also abbreviated CCAC)' },
  { division: 'NAIA', conference: 'Sooner', champion: 'Oklahoma City', source: 'https://soonerathletic.org' },
  { division: 'NAIA', conference: 'WHAC', champion: 'Indiana Institute of Technology', source: 'https://www.whac.net/sports/msoc' },
  // Excluded entirely: Frontier (no men's soccer sponsored), NDCAC
  // (dissolved), NSIC/SLIAC/UMAC (these NAIA-tagged rows collide with an
  // unrelated D2/D3 conference of the same abbreviation -- the D3 SLIAC/
  // UMAC results above are the real, different conferences and stay put),
  // RRAC (agent could not confirm which real conference this represents).

  // ---- NJCAA ----
  { division: 'NJCAA', conference: 'ACCAC', champion: 'Mohave College', source: 'https://www.accac.org/sports/msoc/2025-26/releases/20251029qd21rl' },
  { division: 'NJCAA', conference: 'ACCC', champion: 'Wallace State', source: 'https://www.wallacestate.edu/news/2025/10/26/soccer_accc_championship.html' },
  { division: 'NJCAA', conference: 'CCCAA', champion: 'Cerritos', source: 'https://www.cerritosfalcons.com/sports/msoc/2025-26/releases/20251207x3apa8' },
  { division: 'NJCAA', conference: 'EPAC', champion: 'Montgomery County Community College', source: 'https://www.mc3.edu/news/2025/11/mens-soccer-epac-champ' },
  { division: 'NJCAA', conference: 'FCSAA', champion: 'Daytona State', source: 'https://thefcsaasports.com/sports/msoc/2025-26/releases/20251103y047lx' },
  { division: 'NJCAA', conference: 'GCAA', champion: 'Georgia Military', source: 'https://www.instagram.com/gmcmenssoccer/' },
  { division: 'NJCAA', conference: 'ICCAC', champion: 'Indian Hills', source: 'https://iccac.org/Conference_Champions/Men_Soccer_Champions_Archive' },
  { division: 'NJCAA', conference: 'KJCCC', champion: 'Cowley County', source: 'https://kjccc.org/sports/msoc/2025-26/releases/Postseason/2025_D1_MSOC_District_Championship_Recap' },
  { division: 'NJCAA', conference: 'MCCAA', champion: 'St. Clair County Community College', source: 'https://www.mccaa.org/information/Championship/2025-26/Championships' },
  { division: 'NJCAA', conference: 'MDJUCO', champion: 'Howard Community College', source: 'https://howardccdragons.com/news/2026/1/26/mens-soccer-six-dragons-represent-to-earn-all-md-juco-honors.aspx' },
  { division: 'NJCAA', conference: 'NWAACC', champion: 'Highline', source: 'https://nwacsports.com/sports/msoc/2025-26/releases/2025111723zv6l' },
  // Excluded: CCAC-NJCAA, GNYAC, GRAC, MACJC, MCC (no soccer program),
  // MSJC, NECC, NJCAAD1/NJCAAD3 (these are NJCAA's own division labels,
  // not real conferences -- our data has them mislabeled), OHSJCC,
  // PSJUCO, RMJCAA, SACC, TCCAA, UCAC, VCCAA, WJCAC, WSC (not found), plus
  // MOVAL and MVAL (agent-flagged low confidence / region-vs-conference
  // ambiguity).
];
