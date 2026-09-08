/**
 * The v2 summary and section plan, through the real model path.
 *
 * These are the cases the unit tests cannot reach convincingly: an athlete
 * arriving after the rosters on file, a squad missing the columns the entry
 * pages are built from, and a position too thin to describe.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import { programReportModel } from './philosophy.js';
import { invalidatePoolBenchmarks } from '../lib/philosophyQueries.js';
import { CLASSIFICATIONS } from '../../shared/report/summary.js';

/**
 * Distinct names made of letters only.
 *
 * `nameKey` strips digits, so "Player 1" and "Player 2" are the same person to
 * the season join — and a fixture numbered that way reads as one first-year
 * returning for four years rather than four separate intakes.
 */
function letters(i) {
  let s = '';
  let x = i;
  do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return s.replace(/^./, (c) => c.toUpperCase());
}

/** A season as a word, for the same digit-stripping reason. */
const seasonWord = (season) => ['Alpha', 'Bravo', 'Charlie', 'Delta'][Number(season) - 2022] ?? 'Echo';

const now = new Date().toISOString();

function addCollege(id, name, sport = 'mens-soccer') {
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
    VALUES (?,?,?,?,?,'NCAA D2','Test Conference','Testville','TS',1)`).run(id, now, now, name, sport);
}

function addPlayer(id, over = {}) {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, nationality, sport, recruiting_class_year)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, now, now, over.full_name ?? 'Test Athlete', over.position ?? 'Defender',
      over.nationality ?? 'USA', over.sport ?? 'mens-soccer', over.recruiting_class_year ?? 2026);
}

const insertRow = db.prepare(`INSERT INTO roster_players
  (id, created_date, updated_date, college_name, sport, division, season, player_name,
   class_year_label, position, minutes_played, games_played, games_started, nationality,
   eligibility_end_year, projected_minutes, prior_programme)
  VALUES (?,?,?,?,?,'NCAA D2',?,?,?,?,?,?,?,?,?,?,?)`);

let rowId = 0;
function addRow(school, over = {}) {
  insertRow.run(`rr${rowId += 1}`, now, now, school, over.sport ?? 'mens-soccer',
    over.season ?? '2025', over.player_name ?? `Player ${letters(rowId)}`, over.class_year_label ?? 'So.',
    over.position ?? 'DEFENSE', over.minutes_played ?? 600, over.games_played ?? 15,
    over.games_started ?? 10, over.nationality ?? 'USA',
    over.eligibility_end_year ?? null, over.projected_minutes ?? null, over.prior_programme ?? null);
}

/** Four measured seasons deep enough for the guards to read. */
function addHistory(school) {
  for (const season of ['2022', '2023', '2024', '2025']) {
    addRow(school, { season, player_name: `Senior ${seasonWord(season)}`, class_year_label: 'Sr.', minutes_played: 1400 });
    // Distinct people each season: nameKey strips digits, so a season-suffixed
    // name would read as the same first-year returning for four years.
    addRow(school, { season, player_name: `Fresh One ${seasonWord(season)}`, class_year_label: 'Fr.', minutes_played: 900 });
    addRow(school, { season, player_name: `Fresh Two ${seasonWord(season)}`, class_year_label: 'Fr.', minutes_played: 100 });
    for (let i = 0; i < 10; i += 1) {
      addRow(school, { season, player_name: `Mid ${letters(i)} ${seasonWord(season)}`, class_year_label: 'So.', position: 'MIDFIELD', minutes_played: 300 });
    }
  }
  for (const s of [2022, 2023, 2024, 2025, 2026]) {
    db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)
      VALUES (?,'mens-soccer',?,'A Coach',?)`).run(school, s, now);
  }
}

/** A current squad, with the columns the entry pages are built from. */
function addSquad(school, rows) {
  for (const r of rows) addRow(school, { season: '2026', minutes_played: null, games_played: null, ...r });
}

beforeEach(() => {
  db.exec('DELETE FROM roster_players; DELETE FROM coach_seasons; DELETE FROM colleges; DELETE FROM players;');
  invalidatePoolBenchmarks();
});

describe('a report with no athlete', () => {
  beforeEach(() => {
    addCollege('c1', 'Test College');
    addHistory('Test College');
  });

  it('builds the programme summary and omits the athlete half', () => {
    const m = programReportModel({ collegeId: 'c1' });
    expect(m.summary.programme.freshmanOpportunity).toBeTruthy();
    expect(m.summary.athlete).toBeNull();
  });

  it('plans no athlete sections at all', () => {
    const m = programReportModel({ collegeId: 'c1' });
    expect(m.sections.some((s) => s.scope === 'athlete')).toBe(false);
  });

  // The v1 fields every existing reader depends on must be untouched.
  it('leaves the existing model shape in place', () => {
    const m = programReportModel({ collegeId: 'c1' });
    for (const key of ['college', 'ladder', 'dials', 'byPosition', 'freshman', 'transfer', 'squad', 'verdict', 'tenure']) {
      expect(m).toHaveProperty(key);
    }
    expect(m.kind).toBe('report');
  });
});

describe('an athlete arriving after the rosters on file', () => {
  beforeEach(() => {
    addCollege('c1', 'Test College');
    addHistory('Test College');
    addSquad('Test College', [
      { player_name: 'Leaves 2026', class_year_label: 'Sr.', eligibility_end_year: 2026, projected_minutes: 1200 },
      { player_name: 'Leaves 2026 too', class_year_label: 'Sr.', eligibility_end_year: 2026, projected_minutes: 800 },
      { player_name: 'Stays to 2028', class_year_label: 'So.', eligibility_end_year: 2028, projected_minutes: 900 },
      { player_name: 'Stays to 2029', class_year_label: 'Fr.', eligibility_end_year: 2029, projected_minutes: null },
    ]);
    addPlayer('p2027', { recruiting_class_year: 2027 });
  });

  it('reads the squad against the athlete’s own entry season, not the recruit season', () => {
    const m = programReportModel({ collegeId: 'c1', playerId: 'p2027' });
    const a = m.summary.athlete;
    expect(m.entrySeason).toBe(2027);
    expect(m.entrySeasonKnown).toBe(false);
    expect(a.currentPlayersEligibilityEndsBeforeEntry.map((x) => x.name).sort())
      .toEqual(['Leaves 2026', 'Leaves 2026 too']);
    expect(a.currentPlayersEligibleAtEntry.map((x) => x.name).sort())
      .toEqual(['Stays to 2028', 'Stays to 2029']);
  });

  it('attaches projected minutes to the expiring players without calling them available', () => {
    const a = programReportModel({ collegeId: 'c1', playerId: 'p2027' }).summary.athlete;
    expect(a.currentProjectedMinutesOfPlayersEndingBeforeEntry.currentProjectedMinutes).toBe(2000);
    expect(a.currentProjectedMinutesOfPlayersEligibleAtEntry.currentProjectedMinutes).toBe(900);
    expect(a.currentProjectedMinutesOfPlayersEligibleAtEntry.playersWithoutProjection).toBe(1);
  });

  // The wording rule, made mechanical. These phrases assert something the data
  // cannot support — that minutes attached to a departing player transfer to a
  // recruit — and a remembered rule would not survive two commits.
  it('names no field in the whole model after minutes being available', () => {
    const json = JSON.stringify(programReportModel({ collegeId: 'c1', playerId: 'p2027' }));
    for (const banned of [/available[ _]?minutes/i, /open[ _]?minutes/i, /expected[ _]?minutes/i, /minutes[ _]?up[ _]?for/i]) {
      expect(json).not.toMatch(banned);
    }
  });

  it('refuses to name a coach for a season the coaching record does not reach', () => {
    const m = programReportModel({ collegeId: 'c1', playerId: 'p2027' });
    expect(m.summary.programme.coachContext.coachForEntrySeason).toBeNull();
    expect(m.summary.programme.coachContext.coachForRecruitSeason).toBe('A Coach');
  });

  // Every player's eligibility ends in some year, so a share taken across the
  // whole cliff returns the denominator back — it read 100% at every programme
  // in the pool. Only bounded horizons are reported.
  it('measures turnover against bounded horizons, never the whole cliff', () => {
    const t = programReportModel({ collegeId: 'c1', playerId: 'p2027' }).summary.programme.squadTurnover;
    expect(t).not.toHaveProperty('expiringAcrossWindow');
    expect(t.expiringBeforeEntry.minutes).toBe(2000);
    expect(t.expiringBeforeEntry.ofDescribes).toBe('players with a prior season on file');
    // Through the entry season picks up anyone whose last eligible year is
    // 2027 as well; this fixture has none, so the two agree.
    expect(t.expiringThroughEntrySeason.minutes).toBe(2000);
    expect(t.expiringByYear.map((y) => y.year)).toEqual([2026, 2028, 2029]);
    expect(t.expiringByYear.find((y) => y.year === 2026).minutes).toBe(2000);
  });
});

describe('a squad missing the columns the entry pages need', () => {
  beforeEach(() => {
    addCollege('c1', 'Test College');
    addHistory('Test College');
    addPlayer('p1');
  });

  it('reports no eligibility cliff rather than an empty one', () => {
    addSquad('Test College', [
      { player_name: 'A', class_year_label: 'Sr.', eligibility_end_year: null, projected_minutes: 900 },
      { player_name: 'B', class_year_label: 'Jr.', eligibility_end_year: null, projected_minutes: 900 },
    ]);
    const m = programReportModel({ collegeId: 'c1', playerId: 'p1' });
    expect(m.squad.cliff).toBeNull();
    expect(m.summary.programme.squadTurnover.expiringThroughEntrySeason.reason).toBe('no-eligibility-years-on-file');
    expect(m.summary.programme.squadTurnover.expiringByYear).toEqual([]);
    expect(m.sections.some((s) => s.id === 'eligibility-outlook')).toBe(false);
  });

  // Missing must not become zero: a squad with no projections is not a squad
  // projected to play nothing.
  it('refuses the denominator where projections are too thin, and says so', () => {
    addSquad('Test College', [
      { player_name: 'A', class_year_label: 'Sr.', eligibility_end_year: 2026, projected_minutes: 900 },
      { player_name: 'B', class_year_label: 'Jr.', eligibility_end_year: 2028, projected_minutes: null },
      { player_name: 'C', class_year_label: 'So.', eligibility_end_year: 2029, projected_minutes: null },
    ]);
    const t = programReportModel({ collegeId: 'c1', playerId: 'p1' }).summary.programme.squadTurnover;
    expect(t.projectedMinutes.readable).toBe(false);
    expect(t.projectedMinutes.total).toBeNull();
    expect(t.expiringThroughEntrySeason.share).toBeNull();
    expect(t.expiringThroughEntrySeason.reason).toBe('projected-minutes-coverage-too-thin');
    // A per-year share is null for the same reason rather than computed from a
    // denominator that was refused.
    expect(t.expiringByYear.every((y) => y.share === null)).toBe(true);
    expect(t.classification).toBe('unclear');
  });

  it('keeps a player with no eligibility year out of both entry buckets', () => {
    addSquad('Test College', [
      { player_name: 'Known', class_year_label: 'Sr.', eligibility_end_year: 2026, projected_minutes: 900 },
      { player_name: 'Unknown', class_year_label: 'Jr.', eligibility_end_year: null, projected_minutes: 900 },
    ]);
    const a = programReportModel({ collegeId: 'c1', playerId: 'p1' }).summary.athlete;
    expect(a.currentPlayersEligibilityUnknown.map((x) => x.name)).toEqual(['Unknown']);
    expect(a.currentPlayersEligibilityEndsBeforeEntry.map((x) => x.name)).toEqual([]);
    expect(a.currentPlayersEligibleAtEntry.map((x) => x.name)).toEqual(['Known']);
  });

  it('drops the depth sections entirely when no squad is on file', () => {
    const m = programReportModel({ collegeId: 'c1', playerId: 'p1' });
    expect(m.squad.rostered).toBe(0);
    const ids = m.sections.map((s) => s.id);
    expect(ids).not.toContain('current-depth');
    expect(ids).not.toContain('athlete-current-competition');
  });

  // The arrivals section is purely historical since 13B — the current-season
  // half moved to the squad page — so it survives a missing current roster
  // outright rather than surviving on one of its two halves.
  it('keeps the arrivals section while there is history behind it', () => {
    const m = programReportModel({ collegeId: 'c1', playerId: 'p1' });
    const ids = m.sections.map((s) => s.id);
    expect(m.transfer.points.length).toBeGreaterThan(0);
    expect(ids).toContain('experienced-arrivals');
  });
});

describe('thin samples', () => {
  it('refuses a position with too little recorded to read', () => {
    addCollege('c1', 'Test College');
    addHistory('Test College');
    // A goalkeeper appears once and never again: no transition can be built.
    addRow('Test College', { season: '2025', player_name: 'Keeper', position: 'GOALKEEPER', class_year_label: 'Fr.', minutes_played: 1600 });
    addPlayer('gk', { position: 'Goalkeeper' });
    const a = programReportModel({ collegeId: 'c1', playerId: 'gk' }).summary.athlete;
    expect(a.position).toBe('GOALKEEPER');
    expect(a.positionVacancyHistory.transitions).toBe(0);
    expect(a.positionOpeningOutcomes.evidence.sufficient).toBe(false);
  });

  it('withholds an origin share for a cohort below the established minimum', () => {
    addCollege('c1', 'Test College');
    addHistory('Test College');
    addRow('Test College', { season: '2025', player_name: 'Solo Intl', class_year_label: 'Fr.', nationality: 'Brazil', minutes_played: 1200 });
    addPlayer('intl', { nationality: 'Brazil' });
    const o = programReportModel({ collegeId: 'c1', playerId: 'intl' }).summary.athlete.originContext;
    expect(o.requestedOrigin).toBe('international');
    expect(o.programme.sameOrigin.players).toBeLessThan(6);
    expect(o.programme.sameOrigin.share).toBeNull();
    expect(o.evidence.sufficient).toBe(false);
    expect(o.pool).toBeNull();
  });

  it('classifies nothing on a programme with almost nothing on file', () => {
    addCollege('c2', 'Sparse College');
    addRow('Sparse College', { season: '2025', player_name: 'Solo', class_year_label: 'Fr.', minutes_played: 0, games_played: 0 });
    const p = programReportModel({ collegeId: 'c2' }).summary.programme;
    expect(['unclear', 'unavailable']).toContain(p.freshmanOpportunity.classification);
    expect(['unclear', 'unavailable']).toContain(p.experiencedArrivalReliance.classification);
    expect(p.replacementBehaviour.dominantRoute).toBeNull();
  });
});

describe('the section plan on a real model', () => {
  it('lists fewer sections for a sparse programme than a full one', () => {
    addCollege('c1', 'Test College');
    addHistory('Test College');
    addCollege('c2', 'Sparse College');
    addRow('Sparse College', { season: '2025', player_name: 'Solo', class_year_label: 'Fr.', minutes_played: 0, games_played: 0 });
    const full = programReportModel({ collegeId: 'c1' }).sections.length;
    const sparse = programReportModel({ collegeId: 'c2' }).sections.length;
    expect(sparse).toBeLessThan(full);
  });

  it('adds sections rather than replacing them when an athlete is present', () => {
    addCollege('c1', 'Test College');
    addHistory('Test College');
    addPlayer('p1');
    const plain = programReportModel({ collegeId: 'c1' }).sections.map((s) => s.id);
    const withAthlete = programReportModel({ collegeId: 'c1', playerId: 'p1' }).sections.map((s) => s.id);
    for (const id of plain) expect(withAthlete).toContain(id);
    expect(withAthlete.length).toBeGreaterThan(plain.length);
  });
});

/**
 * A model/API quality gate.
 *
 * The renderer is about to be written against these names. A field called
 * `positionDepthAtEntry` reads as a predicted roster; one called
 * `currentPlayersEligibleAtEntry` reads as what it is — today's squad filtered
 * by a date. Names are cheap to fix now and load-bearing once a page depends
 * on them.
 */
describe('semantic audit of the summary field names', () => {
  const walk = (node, path = [], out = []) => {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      if (node.length) walk(node[0], [...path, '[]'], out);
      return out;
    }
    for (const [k, v] of Object.entries(node)) {
      out.push({ key: k, path: [...path, k].join('.') });
      walk(v, [...path, k], out);
    }
    return out;
  };

  const summaryOf = () => {
    addCollege('c1', 'Test College');
    addHistory('Test College');
    addSquad('Test College', [
      { player_name: 'Alpha One', class_year_label: 'Sr.', eligibility_end_year: 2027, projected_minutes: 1200 },
      { player_name: 'Bravo Two', class_year_label: 'Gr.', eligibility_end_year: 2026, projected_minutes: 800 },
    ]);
    addPlayer('p1', { recruiting_class_year: 2027 });
    return programReportModel({ collegeId: 'c1', playerId: 'p1' }).summary;
  };

  // Words that assert something about the future. Each is allowed only where
  // the surrounding name makes the tense explicit.
  it('uses no field name that promises a future roster or outcome', () => {
    const fields = walk(summaryOf());
    const forbidden = [
      /\bavailable\b/i, /\blikely\b/i, /\bwill\b/i, /\bguaranteed\b/i,
      /\bpredicted\b/i, /\bforecast/i, /\bchance\b/i, /\bodds\b/i,
    ];
    const bad = fields.filter((f) => forbidden.some((re) => re.test(f.key)));
    expect(bad.map((f) => f.path)).toEqual([]);
  });

  // The rule is about MINUTES specifically. "openings" is fine and stays — it
  // is a past-tense count of places that actually came free, which is exactly
  // what the vacancy data measures. What must never appear is a minute figure
  // named as though it were open, expected or available to a recruit.
  it('never describes minutes as open, expected or available', () => {
    const fields = walk(summaryOf());
    const bad = fields.filter((f) => /(expected|open|available|free|spare).*minutes/i.test(f.key));
    expect(bad.map((f) => f.path)).toEqual([]);
  });

  // The counterpart: every minute figure attached to a person says whose
  // minutes they are and that they are current.
  it('names every projected-minute group after the current roster', () => {
    const a = summaryOf().athlete;
    const minuteFields = Object.keys(a).filter((k) => /ProjectedMinutes/i.test(k));
    expect(minuteFields.length).toBeGreaterThan(2);
    for (const k of minuteFields) expect(k).toMatch(/^current/);
  });

  // Every athlete-side roster group is a statement about the CURRENT squad.
  it('marks every athlete roster group as current', () => {
    const a = summaryOf().athlete;
    const rosterGroups = Object.keys(a).filter((k) => /Entry$|EligibilityUnknown$/.test(k));
    expect(rosterGroups.length).toBeGreaterThan(3);
    for (const k of rosterGroups) expect(k).toMatch(/^current/i);
  });

  it('keeps the classification vocabulary free of judgement words', () => {
    const s = summaryOf();
    for (const module of Object.values(s.programme)) {
      if (!module || typeof module.classification !== 'string') continue;
      expect(['high', 'moderate', 'low']).not.toContain(module.classification);
      expect(CLASSIFICATIONS).toContain(module.classification);
    }
  });
});
