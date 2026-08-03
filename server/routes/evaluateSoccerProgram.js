import { College } from '../db/entities/college.js';
import { getAnthropicClient, MODEL } from '../lib/anthropic.js';

const DIVISION_BASE = { 'NCAA D1': 7.0, 'NCAA D2': 5.0, 'NCAA D3': 3.5, NAIA: 3.0, NJCAA: 2.0 };

const D1_ELITE_CONFS = new Set(['ACC', 'Big Ten', 'SEC', 'Big 12', 'Pac-12', 'Big East']);
const D1_STRONG_CONFS = new Set(['Atlantic 10', 'A-10', 'Missouri Valley', 'MVC', 'American Athletic', 'AAC', 'West Coast Conference', 'WCC']);
const D2_ELITE_STRONG_CONFS = new Set(['Great Lakes Valley', 'GLVC', 'Sunshine State', 'SSC', 'Peach Belt', 'PBC', 'Rocky Mountain Athletic', 'RMAC']);

function conferenceAdj(division, conference) {
  const conf = conference || '';
  if (division === 'NCAA D1') {
    if (D1_ELITE_CONFS.has(conf)) return 1.5;
    if (D1_STRONG_CONFS.has(conf)) return 0.75;
    return 0;
  }
  if (division === 'NCAA D2') {
    if (D2_ELITE_STRONG_CONFS.has(conf)) return 0.5;
    return 0;
  }
  return 0;
}

function rankBonus(rank) {
  if (!rank) return 0;
  if (rank <= 25) return 0.5 * (1 - (rank - 1) / 25);
  if (rank <= 50) return 0.25;
  if (rank <= 100) return 0.1;
  return 0;
}

function trendScore(seasons) {
  const nums = (seasons || []).map((v) => (v == null ? 0 : v));
  if (nums.length === 0) return 0;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const base = Math.min(0.75, avg * 0.75);
  const bonus = Math.min(0.25, Math.max(-0.25, (nums[nums.length - 1] - nums[0]) * 0.5));
  return base + bonus;
}

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v));
}

const OUTPUT_SCHEMA_INSTRUCTION = `Respond with ONLY a single JSON object (no markdown, no prose) matching exactly:
{
  "overall_win_pct": number|null,
  "recent_three_season_win_pcts": [number|null, number|null, number|null],
  "ncaa_tourney_appearances_last_10": number|null,
  "conference_titles_last_5": number|null,
  "academic_rating": number|null
}
Use null for any stat you cannot verify from real sources — never fabricate a number.`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

async function fetchProgramStats({ school_name, division, conference }) {
  const client = getAnthropicClient();
  const messages = [
    {
      role: 'user',
      content: `Research the men's college soccer program at "${school_name}" (${division}, ${conference || 'conference unknown'}). Find: overall win percentage across recent seasons, win percentage for each of the last 3 completed seasons (oldest to newest), NCAA tournament appearances in the last 10 years, conference titles won in the last 5 years, and an academic quality rating (1-10) based on the school's overall academic reputation.\n\n${OUTPUT_SCHEMA_INSTRUCTION}`,
    },
  ];

  let response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
    messages,
  });

  while (response.stop_reason === 'pause_turn') {
    messages.push({ role: 'assistant', content: response.content });
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      messages,
    });
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  return extractJson(textBlock?.text || '{}');
}

/**
 * Generates the 1–10 program-quality `rating` field (Section 8), using
 * Claude + the server-side web_search tool in place of Base44/Gemini's
 * add_context_from_internet, then applying the exact scoring formula.
 */
export async function evaluateSoccerProgram({ school_name, division, conference, location, website_domain, national_ranking }) {
  const stats = await fetchProgramStats({ school_name, division, conference });

  const divisionBase = DIVISION_BASE[division] ?? 3.0;
  const confAdj = conferenceAdj(division, conference);
  const overallWinScore = Math.min(1.5, (stats.overall_win_pct || 0) * 1.5);
  const trend = trendScore(stats.recent_three_season_win_pcts);
  const rank = rankBonus(national_ranking);
  const tourneyBonus = Math.min(0.5, (stats.ncaa_tourney_appearances_last_10 || 0) * 0.05);
  const titlesBonus = Math.min(0.25, (stats.conference_titles_last_5 || 0) * 0.05);

  const rawScore = divisionBase + confAdj + overallWinScore + trend + rank + tourneyBonus + titlesBonus;
  const rating = clamp(1, 10, Math.round(rawScore * 100) / 100);

  const { record } = College.upsert(
    { name: school_name, sport: 'mens-soccer' },
    {
      division,
      conference,
      location,
      website_domain,
      rating,
      academic_rating: stats.academic_rating ?? undefined,
      national_ranking: national_ranking ?? undefined,
    }
  );

  return {
    school_name,
    rating,
    academic_rating: stats.academic_rating,
    breakdown: { divisionBase, conferenceAdj: confAdj, overallWinScore, trendScore: trend, rankBonus: rank, tourneyBonus, titlesBonus },
    record,
  };
}
