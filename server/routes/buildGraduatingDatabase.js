import { GraduatingSenior } from '../db/entities/graduatingSenior.js';
import { buildPositionData } from '../lib/positions.js';

/**
 * Section 9's real 4-step LLM prompt, preserved verbatim so it can be dropped
 * into this function later without touching any caller. NOT used yet — the
 * roster-research feature is stubbed with mock data per project scope; wiring
 * this up means replacing the mock-generation block below with an Anthropic
 * call (web_search tool) that returns JSON matching this instruction set.
 */
export const ROSTER_RESEARCH_PROMPT = `
You are researching a college soccer program's graduating senior roster.

1. Find the 2025 official roster: Go to the college's official athletics website,
   find the men's soccer roster labeled "2025" or "2024-2025". Save the URL as
   official_roster_url. If not found, set all arrays to [] and confidence to "low".

2. Identify all graduating seniors: Go row by row. A player is graduating if
   class = Senior, Sr., SR, 4th Year, Redshirt Senior, R-Sr., Graduate, Grad, GR,
   GS, 5th Year, Super Senior, Grad Transfer. NOT graduating = Freshman,
   Sophomore, Junior. Output all_graduating_senior_names.

3. For each graduating player — position and minutes: Classify position into
   GOALKEEPER/DEFENSE/MIDFIELD/FORWARD using label mappings (GK->GOALKEEPER,
   D/CB/RB/LB->DEFENSE, M/CM/DM->MIDFIELD, F/ST/W->FORWARD). For dual labels
   (M/F), use the LEFT side. Find minutes played in the most recent completed
   season. Output players array: {name, position, minutes_played}.

4. Coaching staff: Find head coach and assistants with official email
   addresses. Output coaching_staff: {name, title, email}. Use "N/A" if no
   email.
`;

const MOCK_FIRST_NAMES = ['Alex', 'Jordan', 'Sam', 'Morgan', 'Casey', 'Riley', 'Cameron', 'Jamie', 'Taylor', 'Drew'];
const MOCK_LAST_NAMES = ['Carter', 'Bennett', 'Reyes', 'Hughes', 'Nolan', 'Foster', 'Grant', 'Mercer', 'Whitfield', 'Doyle'];
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];

function mockName(seed) {
  const first = MOCK_FIRST_NAMES[seed % MOCK_FIRST_NAMES.length];
  const last = MOCK_LAST_NAMES[(seed * 7) % MOCK_LAST_NAMES.length];
  return `${first} ${last}`;
}

function seedFromName(collegeName) {
  let seed = 0;
  for (let i = 0; i < collegeName.length; i++) seed += collegeName.charCodeAt(i);
  return seed;
}

function generateMockPlayers(collegeName) {
  const seed = seedFromName(collegeName);
  const count = 3 + (seed % 4); // 3-6 mock graduating seniors
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push({
      name: mockName(seed + i),
      position: POSITIONS[(seed + i) % POSITIONS.length],
      minutes_played: 200 + ((seed + i * 137) % 900),
    });
  }
  return players;
}

function generateMockCoachingStaff(collegeName) {
  const seed = seedFromName(collegeName);
  const slug = collegeName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return [
    { name: mockName(seed + 100), title: 'Head Coach', email: `headcoach.mock@${slug}.example` },
    { name: mockName(seed + 200), title: 'Assistant Coach', email: `assistant.mock@${slug}.example` },
  ];
}

/**
 * STUBBED per project scope: returns realistic-looking mock data tagged
 * data_confidence "low" instead of running real LLM web research, so the
 * matching algorithm / CollegeCard three-tier breakdown can be built and
 * tested against realistic shapes. Keeps the exact function signature and
 * three-tier pipeline structure (all graduating -> position matches ->
 * 600+min starters) so real research drops in later without touching callers.
 */
export async function buildGraduatingDatabase({ college_name, division, website_domain, force, sport = 'mens-soccer' }) {
  const season = '2025';
  const existing = GraduatingSenior.filter({ college_name, season, sport })[0];

  if (existing && (existing.players || []).length > 0 && !force) {
    return { status: 'cached', college_name, count: existing.players.length, record: existing };
  }

  const players = generateMockPlayers(college_name);
  const record = {
    college_name,
    season,
    confirmed_division: division,
    official_roster_url: website_domain ? `https://${website_domain}` : undefined,
    total_graduating_seniors: players.length,
    all_graduating_senior_names: players.map((p) => p.name),
    players,
    position_data: buildPositionData(players),
    coaching_staff: generateMockCoachingStaff(college_name),
    data_confidence: 'low',
    notes: 'mock data — real research not yet wired up',
    sport,
  };

  const { record: saved } = GraduatingSenior.upsert({ college_name, season, sport }, record);
  return { status: 'saved', college_name, count: players.length, record: saved };
}
