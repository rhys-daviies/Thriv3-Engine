/**
 * The Programme Intelligence baseline contract, as assertions rather than prose.
 *
 * WHY A SECOND CHECK ON TOP OF 1,530 TESTS. The unit suites hold each module to
 * its contract on fixtures it controls. These are the CROSS-MODULE claims the
 * report makes to a family, checked against the real database and the real
 * rendered document — the claims that could quietly stop being true because a
 * pool percentile moved, a gate was reordered, or a renderer started printing a
 * figure the model had refused. Every one of them is a sentence this product
 * would be wrong to print if it failed.
 *
 * READ-ONLY. No fixture is written; the programme model already carries every
 * position's intake and utilisation, and the two rendered documents are built
 * from real programmes.
 *
 *   npm run verify:baseline
 *
 * Exit code is the number of failed invariants, so it can gate a merge.
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { programReportModel } from '../routes/philosophy.js';
import { renderProgramReport } from '../lib/philosophyReport.js';
import { classRank, STARTER_MINUTES } from '../../shared/lifecycle/lifecycle.js';
import { readClassYear } from '../../shared/classYear.js';
import {
  MEASURED_SEASONS, MIN_SQUAD_FOR_SHARE, MIN_SEASONS_TO_QUOTE, ROTATION_MINUTES,
} from '../../shared/lifecycle/utilisation.js';
import {
  HISTORICAL_CYCLES, CURRENT_CYCLE, MIN_ROSTER_FOR_CYCLE,
} from '../../shared/lifecycle/pressure.js';
import {
  SUPPORTED_POSITIONS, CUMULATIVE_TARGET, MAX_UNKNOWN_MINUTE_SHARE, MIN_PLAYERS_USED,
  programmePositionUtilisation,
} from '../../shared/lifecycle/positionUtilisation.js';
import {
  MIN_SOURCE_ROSTER, performanceUnreadableSeasons, withReadablePerformance, programmeSeasonKey,
} from '../../shared/performanceSource.js';
import { MIN_MEASURED_SHARE } from '../../shared/freshmanMinutes.js';
import { readableRows } from '../../shared/lifecycle/readable.js';
import { tenureFor, sameCoach } from '../../shared/coachTenure.js';
import { programmePhilosophy } from '../../shared/philosophy.js';
import { competitiveHistoryFor, competitivePools } from '../lib/competitiveQueries.js';
import { MIN_POOL } from '../../shared/competitiveHistory.js';
import { DIVISIONS } from '../../shared/conferenceHistory.js';
import { buildResolvers } from '../lib/institutionQueries.js';
import { competitivePackageFor } from '../lib/conferenceQueries.js';
import {
  readerSentences, FORBIDDEN_READER_LANGUAGE, V1_FIELDS, COACH_INTEGRATION,
} from '../../shared/report/competitivePackage.js';

// ---------------------------------------------------------------------------

/** Source-level assertions read the module text, the same way the suites do. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

let failed = 0;
let passed = 0;
const group = (name) => console.log(`\n${name}`);
function check(claim, ok, evidence = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${claim}${evidence ? `  — ${evidence}` : ''}`); } else {
    failed += 1; console.log(`  FAIL  ${claim}${evidence ? `  — ${evidence}` : ''}`);
  }
}

const modelFor = (name, sport) => {
  const col = db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?').get(name, sport);
  if (!col) throw new Error(`no programme ${name}/${sport}`);
  return programReportModel({ collegeId: col.id, playerId: null });
};
/** The renderer's thousands separator, so an assertion can match the ink. */
const nfInt = (v) => Number(v).toLocaleString('en-US');
const rowsFor = (name, sport) => db.prepare(
  'SELECT * FROM roster_players WHERE college_name = ? AND sport = ?').all(name, sport);

/** The drawn text of a rendered report, for the claims about wording. */
const WINANSI = { 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0xb7: '·' };
function pdfText(buf) {
  const raw = buf.toString('latin1');
  const out = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let body;
    try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const op of body.matchAll(/(?:\[([^\]]*)\]\s*TJ|(<[0-9A-Fa-f]*>)\s*Tj)/g)) {
      let word = '';
      for (const hex of (op[1] ?? op[2] ?? '').matchAll(/<([0-9A-Fa-f]*)>/g)) {
        for (let i = 0; i + 1 < hex[1].length; i += 2) {
          const code = parseInt(hex[1].slice(i, i + 2), 16);
          word += WINANSI[code] ?? String.fromCharCode(code);
        }
      }
      if (word) out.push(word);
    }
  }
  return out.join(' ').replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------

const akron = modelFor('Akron', 'mens-soccer');
const albertus = modelFor('Albertus Magnus', 'mens-soccer');
const akronW = modelFor('Akron', 'womens-soccer');
const naia = modelFor('Aquinas', 'mens-soccer');

group('DATA — missing is never zero');
{
  // The Albertus 2025 shape, read from the real table: a roster whose every
  // stored minute is a zero the importer supplied.
  const rows = rowsFor('Albertus Magnus', 'mens-soccer');
  const unreadable = performanceUnreadableSeasons(rows);
  check('a programme-season of stored zeroes is ruled unreadable at source',
    unreadable.size > 0, `${unreadable.size} programme-season(s) flagged`);
  const blanked = withReadablePerformance(rows);
  const stillZero = blanked.filter((r) => unreadable.has(programmeSeasonKey(r))
    && r.minutes_played === 0);
  check('no row in an unreadable season survives as a zero', stillZero.length === 0,
    `${stillZero.length} rows still 0`);
  const nulled = blanked.filter((r) => unreadable.has(programmeSeasonKey(r))
    && r.minutes_played === null);
  check('those rows are null instead', nulled.length > 0, `${nulled.length} rows nulled`);
  check('a player with no published games keeps no minute figure',
    readableRows([{ minutes_played: 0, games_played: null, games_started: null }])[0]
      .minutes_played === null);
  check('every unreadable share is null and not 0 on the model',
    (albertus.squadProfile.experience.groups ?? []).every((g) => g.minuteShare === null)
      && albertus.squadProfile.utilisation.medianTop11Share == null,
    'Albertus minute shares');
  check('the source-readability floor is a roster of ten', MIN_SOURCE_ROSTER === 10);
  check('a season is only read above half its squad carrying minutes',
    MIN_MEASURED_SHARE === 0.5);
}

group('DATA — 2026 is current-known, never completed history');
{
  check('measured performance seasons are 2022–2025',
    JSON.stringify(MEASURED_SEASONS) === JSON.stringify(['2022', '2023', '2024', '2025']),
    MEASURED_SEASONS.join(','));
  check('2026 is not a measured performance season', !MEASURED_SEASONS.includes('2026'));
  check('squad utilisation reads no 2026 season',
    !akron.squadProfile.utilisation.seasons.some((s) => s.season === '2026'),
    akron.squadProfile.utilisation.seasons.map((s) => s.season).join(','));
  check('roster experience load reads no 2026 season',
    !(akron.squadProfile.experience.loadSeasons ?? []).includes('2026'));
  check('recruiting cycles quoted as history are 2023–2025',
    JSON.stringify(HISTORICAL_CYCLES) === JSON.stringify(['2023', '2024', '2025']),
    HISTORICAL_CYCLES.join(','));
  check('2026 is the current cycle only', CURRENT_CYCLE === '2026'
    && !HISTORICAL_CYCLES.includes('2026'));
  const fwd = akron.pressure.positions.find((p) => p.position === 'FORWARD');
  check('a position median is drawn from historical cycles alone',
    fwd.historical.totalIncomingPerCycle.length === fwd.historical.cyclesWithReadableRosterPresence
      && fwd.current.season === '2026',
    `${fwd.historical.totalIncomingPerCycle.join(',')} + ${fwd.current.totalIncoming} known for 2026`);
}

group('CLASS PARSING — one reader for the column');
{
  const labels = ['Fr.', 'Fy.', 'F.Y.', 'RS Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.', 'Grad', '2027', ''];
  const rank = { FRESHMAN: 1, SOPHOMORE: 2, JUNIOR: 3, SENIOR: 4, GRADUATE: 5 };
  const agree = labels.every((l) => classRank(l) === (rank[readClassYear(l).klass] ?? null));
  check('classRank delegates to readClassYear for every label shape', agree,
    labels.map((l) => `${l || '(blank)'}=${classRank(l)}`).join(' '));
  check('"Fy." is read as a first year, not as unrecognised', classRank('Fy.') === 1);
  check('a printed graduation year yields no class rank', classRank('2027') === null);
}

group('FIRST YEAR — true first-years, and no ladder of zeros');
{
  check('a redshirt first-year is not a true first-year',
    readClassYear('RS Fr.').klass === 'FRESHMAN' && readClassYear('RS Fr.').redshirt === true,
    'excluded by freshmanMinutes.isTrueFreshman');
  check('an all-zero ladder is not rendered', Array.isArray(albertus.ladder)
    && albertus.ladder.length === 0
    && !albertus.sections.some((s) => s.id === 'freshman-ladder'),
    'Albertus: no ladder section');
  check('a starter’s season is 600 minutes', STARTER_MINUTES === 600);
}

group('LIFECYCLE — a returning player is not an arrival');
{
  const fwd = akron.pressure.positions.find((p) => p.position === 'FORWARD');
  const cycles = fwd.cycles.filter((c) => c.readable);
  check('every counted arrival is first seen in the cycle it is counted in',
    cycles.every((c) => (c.firstYears ?? 0) + (c.experiencedArrivals ?? 0) === c.totalIncoming),
    cycles.map((c) => `${c.season}:${c.totalIncoming}`).join(' '));
  const c = akron.lifecycle.continuity;
  check('continuity counts returns out of players who COULD return',
    c.returned <= c.returnable && c.retention === c.returned / c.returnable,
    `${c.returned}/${c.returnable}`);
  const d = akron.lifecycle.departures;
  check('traced destinations never exceed departures',
    d.tracing.observed <= d.departures.total,
    `${d.tracing.observed} of ${d.departures.total}`);
  check('a D3 programme’s destinations are withheld rather than quoted thin',
    albertus.lifecycle.departures.gate.allowed === false,
    albertus.lifecycle.departures.gate.reason ?? '');
}

group('POSITION INTAKE — measured, and never a category');
{
  check('the cycle floor is a roster of ten', MIN_ROSTER_FOR_CYCLE === 10);
  check('intake refuses banding with a measured reason',
    akron.pressure.banding.available === false && akron.pressure.banding.reason.length > 40,
    akron.pressure.banding.reason.slice(0, 60));
  const anyBand = JSON.stringify(akron.pressure).match(/"(band|category|tier)":/);
  check('no intake figure carries a band field', anyBand === null);
}

group('SQUAD UTILISATION — published team minutes, and never a category');
{
  const u = akron.squadProfile.utilisation;
  check('the squad floor for a minute share is twelve players', MIN_SQUAD_FOR_SHARE === 12);
  check('two seasons are required before a programme median is quoted',
    MIN_SEASONS_TO_QUOTE === 2);
  check('the primary measure is a share of published team minutes',
    u.medianTop11Share > 0 && u.medianTop11Share <= 1
    && u.seasons.every((s) => !s.readable || s.totalMeasuredTeamMinutes > 0),
    `top-11 ${(u.medianTop11Share * 100).toFixed(1)}%`);
  // Carried on the model and flagged, NOT removed from it: Phase 8 kept the
  // figure so the reason it is not quoted stays visible to whoever reads the
  // model next. The contract is that it never reaches a page — asserted
  // against the rendered document below.
  check('roster appearance share is carried flagged unreliable, with its reason',
    u.rosterAppearanceShare?.unreliable === true
    && /roster page/.test(u.rosterAppearanceShare.reason ?? ''),
    u.rosterAppearanceShare?.reason?.slice(0, 60) ?? 'absent');
  check('the rotation threshold is carried but is not a primary measure',
    ROTATION_MINUTES === 200 && u.medianPlayersWith200Plus != null);
  check('utilisation refuses banding with a measured reason',
    akron.squadProfile.banding.available === false,
    akron.squadProfile.banding.reason.slice(0, 60));
}

group('POSITION UTILISATION — the six gates, and never a category');
{
  const pu = akron.positionUtilisation;
  check('three positions are supported and goalkeeper is not',
    JSON.stringify(SUPPORTED_POSITIONS) === JSON.stringify(['DEFENSE', 'MIDFIELD', 'FORWARD']),
    SUPPORTED_POSITIONS.join(','));
  const gk = programmePositionUtilisation(rowsFor('Akron', 'mens-soccer'), { position: 'GOALKEEPER' });
  check('asking for goalkeeper returns a methodological exclusion',
    gk.supported === false && /not reported for goalkeepers/.test(gk.reason)
    && !/insufficient|too few|no data/i.test(gk.reason), gk.reason.slice(0, 60));
  check('no goalkeeper row appears in the by-position table',
    !(pu.byPosition ?? []).some((p) => p.position === 'GOALKEEPER'),
    (pu.byPosition ?? []).map((p) => p.position).join(','));
  check('at least five players must have been used at the position', MIN_PLAYERS_USED === 5);
  check('at most a tenth of a squad’s minutes may sit at an unknown position',
    MAX_UNKNOWN_MINUTE_SHARE === 0.10);
  check('three-quarters is the cumulative target', CUMULATIVE_TARGET === 0.75);
  check('two readable seasons are required for a programme median',
    (pu.byPosition ?? []).every((p) => !p.available || p.readableSeasons >= 2),
    (pu.byPosition ?? []).map((p) => `${p.position}:${p.readableSeasons}`).join(' '));
  check('the two primary measures are 600+ and three-quarters of the minutes',
    (pu.byPosition ?? []).every((p) => !p.available
      || (p.medianPlayersWith600Plus != null && p.medianPlayersFor75 != null)));
  check('position utilisation refuses banding with a measured reason',
    pu.banding.available === false, pu.banding.reason.slice(0, 60));
}

group('REPORTING — what the document may and may not say');
{
  const akronAthlete = (() => {
    const col = db.prepare("SELECT id FROM colleges WHERE name='Akron' AND sport='mens-soccer'").get();
    return programReportModel({ collegeId: col.id, playerId: '0c3348de-8709-4788-b6a9-bddb27a168a4' });
  })();
  const fwd = akronAthlete.positionUtilisation.athletePosition;
  const text = pdfText(await renderProgramReport(akronAthlete));

  check('a thin position history is disclosed on the page',
    fwd.readableSeasons < fwd.seasons.length
    && text.includes(`of ${fwd.seasons.length} on file with enough position-level minutes`),
    `${fwd.readableSeasons} of ${fwd.seasons.length} seasons`);
  check('the position count carries the squad it came from',
    new RegExp(`out of ${fwd.medianPlayersWithMinutes} forwards used`).test(text));
  check('projected minutes are never described as available minutes',
    !/available minutes|minutes available|open minutes|minutes will open/i.test(text));
  check('nothing in the document forecasts the coming season',
    !/will play|likely to play|expected to start|projected to start/i.test(text));
  check('no category is printed where a model refused one',
    !/\b(above typical|below typical|typical spread|broad distribution|narrow distribution)\b/i.test(text));
  check('no direction label is printed for a pool comparison',
    !/on the (wider|tighter) side/i.test(text));
  check('the unreliable roster-appearance share never reaches a page',
    !/share of the roster (that|who) appeared|of the roster appeared/i.test(text));
  check('the redundant utilisation measures Phase 8 rejected are not drawn',
    !/top five most-used|players over 200 minutes|most-used player took/i.test(text));

  const naiaText = pdfText(await renderProgramReport(naia));
  check('one NAIA season is not called a programme record',
    /One season is one season, and this is not a programme record/.test(naiaText),
    naia.squadProfile.utilisation.singleSeasonObservation?.season ?? 'n/a');

  const albText = pdfText(await renderProgramReport(albertus));
  check('a refusal is stated as a refusal, never as a zero',
    /Only 0 of 4 seasons on file carry enough published minutes/.test(albText)
    && !/took 0% of the minutes/.test(albText));
  check('the roster survives where the minutes do not',
    albertus.squadProfile.experience.compositionAvailable === true
    && albertus.squadProfile.experience.loadAvailable === false);
  check('a sparse programme still states what it cannot read',
    albertus.evidenceLimits.length > 0 && /Where the evidence runs out/i.test(albText),
    `${albertus.evidenceLimits.length} refusals`);
}

group('WOMEN’S GAME — its own pool, same contract');
{
  const u = akronW.squadProfile.utilisation;
  check('the women’s pool is built and scoped separately',
    u.poolScope === 'NCAA D1' && u.pool?.top11MinuteShare?.programmes > 100,
    `${u.pool.top11MinuteShare.programmes} programmes`);
  check('the same banding refusal applies', akronW.squadProfile.banding.available === false);
  const def = akronW.positionUtilisation.byPosition.find((p) => p.position === 'DEFENSE');
  check('a count is never wider than the squad it came from',
    def.medianPlayersWith600Plus <= def.medianPlayersWithMinutes,
    `${def.medianPlayersWith600Plus} of ${def.medianPlayersWithMinutes} used`);
}

/**
 * CONTINUITY IS A CLAIM ABOUT OBSERVATIONS.
 *
 * Swept across every programme in the database rather than sampled, because
 * the defect this catches was invisible on the four snapshot programmes and
 * present on 82 others. Three verdicts say one coach ran the whole window —
 * `steady`, `erratic-same-coach`, `policy-shift-same-coach` — and each of them
 * must be able to name that coach in every season it describes.
 *
 * Before Phase 11D, `tenureFor` read the coach table with no title column and
 * `classifyProgramme` inferred continuity from the ABSENCE of an observed
 * change, so an unread season, a missing row, an associate head and a strength
 * coach all counted as "nobody changed". Marist men's reported one coach
 * throughout four seasons whose only name on file is the strength coach's.
 */
group('COACH — one coach throughout needs an observation for every season');
{
  const programmes = db.prepare('SELECT DISTINCT college_name AS name, sport FROM roster_players').all();
  const CONTINUITY = new Set(['steady', 'erratic-same-coach', 'policy-shift-same-coach']);
  const coachRowsFor = db.prepare('SELECT * FROM coach_seasons WHERE school = ? AND sport = ?');
  let claims = 0;
  const unsupported = [];
  for (const c of programmes) {
    const coachRows = coachRowsFor.all(c.name, c.sport);
    const rows = rowsFor(c.name, c.sport);
    if (!rows.length) continue;
    let ph;
    try { ph = programmePhilosophy({ rows, coachRows }); } catch { continue; }
    if (!ph.verdict || !CONTINUITY.has(ph.verdict.verdict)) continue;
    claims += 1;
    const tenure = tenureFor(coachRows);
    const nameIn = (s) => tenure?.segments
      .find((g) => s >= g.from && s <= g.to)?.coach ?? null;
    const names = ph.verdict.describes.map(nameIn);
    if (names.some((n) => !n) || !names.every((n) => sameCoach(n, names[0]))) {
      unsupported.push(`${c.name}/${c.sport}`);
    }
  }
  check('no programme claims one coach across a season with no usable head-coach observation',
    unsupported.length === 0,
    `${claims} continuity claims, ${unsupported.length} unsupported${unsupported.length ? `: ${unsupported.slice(0, 5).join(', ')}` : ''}`);

  // The other half of the same claim: the row that resolves a season has to be
  // a head coach of THIS team. Marist men's is the case — every row on file
  // names the strength coach — and it must reach the report as a refusal.
  const marist = modelFor('Marist', 'mens-soccer');
  check('a strength coach never resolves a season',
    marist.verdict.verdict === 'coach-unknown'
      && !/Suma/.test(JSON.stringify(marist.verdict))
      && marist.coach === null,
    marist.verdict.verdict);
}

/**
 * LAYOUT — the evidence strip belongs to the card that owns it.
 *
 * `panel({ evidence: true })` reserves the strip, so it cannot be pushed out
 * of the box by a long card. The risk that creates is the opposite one: a card
 * that quietly drops a finding for want of room. These are the two programmes
 * whose first-year card overflowed — the weighted figure is what pushed the
 * strip over the panel beneath — so both the card and the evidence page must
 * still carry it.
 */
group('LAYOUT — the card keeps what it had');
for (const [name, sport] of [['Akron', 'womens-soccer'], ['Grand Valley State', 'womens-soccer']]) {
  const m = modelFor(name, sport);
  const s = m.summary.programme.freshmanOpportunity;
  const text = pdfText(await renderProgramReport(m));
  check(`${name} women’s still draws the weighted figure on the card`,
    s.weightingApplied === true && s.weightedAgrees === false
      && new RegExp(`Weighted towards the current coach.{0,24}${nfInt(s.weightedLadderTop.median)}`).test(text),
    `${nfInt(s.weightedLadderTop.median)} min`);
  check(`${name} women’s still states it in full on the evidence page`,
    /current-coach relevance/i.test(text) && /Neither replaces the other/i.test(text));
}

/**
 * STRUCTURAL HISTORY — the denominator the benchmark uses.
 *
 * Phase 12B.1 withheld every percentile because the only division on file was
 * the CURRENT one, and comparing Mercyhurst's 2022 Division II season against
 * 213 Division I programmes is a wrong denominator that no disclosure fixes.
 * 12D established the season's own division from the conferences' own standings
 * tables. These are the claims that would have to hold before any of it is
 * printed.
 */
group('STRUCTURAL HISTORY — the season’s own division, or none');
{
  const idOf = (name, sport) => db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?').get(name, sport)?.id ?? null;
  const seasonsOf = (name, sport) => {
    const id = idOf(name, sport);
    return id ? competitiveHistoryFor(id).seasons : [];
  };

  // The mandatory case. Both its Division II seasons and both its Division I
  // seasons, in one programme, inside the measured window.
  for (const sport of ['mens-soccer', 'womens-soccer']) {
    const rows = seasonsOf('Mercyhurst', sport);
    const by = Object.fromEntries(rows.map((r) => [r.season, r]));
    check(`Mercyhurst ${sport === 'mens-soccer' ? 'men’s' : 'women’s'} 2022 and 2023 are read as Division II`,
      by[2022]?.historicalDivision === 'NCAA D2' && by[2023]?.historicalDivision === 'NCAA D2',
      `${by[2022]?.historicalDivision} / ${by[2023]?.historicalDivision}`);
    check(`Mercyhurst ${sport === 'mens-soccer' ? 'men’s' : 'women’s'} 2024 and 2025 are read as Division I`,
      by[2024]?.historicalDivision === 'NCAA D1' && by[2025]?.historicalDivision === 'NCAA D1');
    check(`Mercyhurst ${sport === 'mens-soccer' ? 'men’s' : 'women’s'} D2 seasons reach a D2 pool`,
      by[2022]?.benchmark?.available === true && /NCAA D2/.test(by[2022].benchmark.scope ?? ''),
      `${by[2022]?.benchmark?.scope} n=${by[2022]?.benchmark?.n}`);
    check(`Mercyhurst ${sport === 'mens-soccer' ? 'men’s' : 'women’s'} D1 seasons reach a D1 pool`,
      by[2024]?.benchmark?.available === true && /NCAA D1/.test(by[2024].benchmark.scope ?? ''),
      `${by[2024]?.benchmark?.scope} n=${by[2024]?.benchmark?.n}`);
    // The current division is D1. If it were the fallback, 2022 would rank
    // against D1 — and it must not, even though the answer would look fine.
    check(`Mercyhurst ${sport === 'mens-soccer' ? 'men’s' : 'women’s'} 2022 is not ranked against its CURRENT division`,
      !/NCAA D1/.test(by[2022]?.benchmark?.scope ?? ''));
  }

  // Hartford men's moved out of Division I inside the window and its earliest
  // season is not on file at all — a structural case and a gap in one.
  const hartford = seasonsOf('Hartford', 'mens-soccer');
  check('Hartford men’s carries only the seasons a conference table established',
    hartford.every((r) => r.historicalDivision === null || DIVISIONS.includes(r.historicalDivision)),
    hartford.map((r) => `${r.season}:${r.historicalDivision ?? '—'}`).join(' '));

  for (const [name, sport, division] of [['Ohio State', 'womens-soccer', 'NCAA D1'],
    ['Grand Valley State', 'womens-soccer', 'NCAA D2'], ['Messiah', 'mens-soccer', 'NCAA D3'],
    ['Cumberlands', 'mens-soccer', 'NAIA']]) {
    const rows = seasonsOf(name, sport).filter((r) => r.historicalDivision);
    check(`${name} ${sport === 'mens-soccer' ? 'men’s' : 'women’s'} reads ${division} in every season established`,
      rows.length > 0 && rows.every((r) => r.historicalDivision === division),
      `${rows.length} seasons`);
  }

  // The refusal, which is the other half of the contract.
  const unplaced = db.prepare(
    `SELECT p.college_id, p.season FROM programme_seasons p
       LEFT JOIN programme_conference_seasons x ON x.college_id = p.college_id AND x.season = p.season
      WHERE x.historical_division IS NULL LIMIT 1`).get();
  if (unplaced) {
    const row = competitiveHistoryFor(unplaced.college_id).seasons.find((r) => r.season === unplaced.season);
    check('a season with no established division is refused a percentile, with a reason',
      row?.benchmark?.available === false && /division/i.test(row.benchmark.reason ?? ''),
      row?.benchmark?.reason);
  }

  const pools = competitivePools();
  const sizes = [];
  for (const sport of ['mens-soccer', 'womens-soccer']) {
    for (const season of [2022, 2023, 2024, 2025]) {
      for (const [d, v] of Object.entries(pools.byKey.get(sport)?.[season] ?? {})) sizes.push([sport, season, d, v.rates.length]);
    }
  }
  check('every sport-division-season pool is populated', sizes.length === 32, `${sizes.length} pools`);
  check('every pool clears the minimum this product will quote from',
    sizes.every(([, , , n]) => n >= MIN_POOL), `smallest ${Math.min(...sizes.map((x) => x[3]))}`);
}

/**
 * STRUCTURAL HISTORY — what the table may and may not contain.
 */
group('STRUCTURAL HISTORY — the table’s own rules');
{
  const bad = (sql) => db.prepare(sql).get().n;
  check('no season carries a division without a provenance that establishes it',
    bad(`SELECT COUNT(*) n FROM programme_conference_seasons
          WHERE historical_division IS NOT NULL
            AND division_provenance NOT IN ('EXPLICIT_OFFICIAL', 'DERIVED_FROM_OFFICIAL_MEMBERSHIP')`) === 0);
  check('no season carries a division outside the four this product reports',
    bad(`SELECT COUNT(*) n FROM programme_conference_seasons
          WHERE historical_division IS NOT NULL AND historical_division NOT IN ('NCAA D1','NCAA D2','NCAA D3','NAIA')`) === 0);
  check('a conflicting division is stored as null, never as the majority',
    bad(`SELECT COUNT(*) n FROM programme_conference_seasons
          WHERE division_provenance = 'CONFLICTING' AND historical_division IS NOT NULL`) === 0);
  check('no conference record contradicts its own matches played',
    bad(`SELECT COUNT(*) n FROM programme_conference_seasons
          WHERE conference_matches IS NOT NULL
            AND conference_matches <> conference_wins + conference_draws + conference_losses`) === 0);
  check('the benchmark reads no season whose source did not name its own season',
    db.prepare(`SELECT COUNT(*) n FROM programme_conference_seasons WHERE season_confirmed = 0`).get().n >= 0
      && db.prepare(`SELECT COUNT(*) n FROM programme_seasons p JOIN programme_conference_seasons x
            ON x.college_id = p.college_id AND x.season = p.season
           WHERE x.season_confirmed = 0 AND x.historical_division IS NOT NULL`).get().n >= 0
      && competitivePools().observations
        === db.prepare(`SELECT COUNT(*) n FROM programme_seasons p JOIN programme_conference_seasons x
             ON x.college_id = p.college_id AND x.season = p.season
            WHERE p.confidence <> 'ROSTER_CONTRADICTED' AND x.historical_division IS NOT NULL
              AND x.season_confirmed = 1`).get().n);
  check('`programme_seasons` no longer carries a division of its own',
    !db.prepare('PRAGMA table_info(programme_seasons)').all().some((c) => c.name === 'historical_division'));
}

/**
 * IDENTITY — a domain is not evidence.
 */
group('IDENTITY — the wrong-institution regressions');
{
  const resolvers = buildResolvers();
  const named = [
    ['Columbia (MO)', 'Columbia', 'mens-soccer'],
    ['Maryville (TN)', 'Maryville University', null],
  ];
  for (const [a, b] of named) {
    const ra = resolvers.resolve(a);
    const rb = resolvers.resolve(b);
    check(`"${a}" and "${b}" never resolve to the same institution`,
      ra.unitid == null || rb.unitid == null || ra.unitid !== rb.unitid,
      `${ra.unitid} vs ${rb.unitid}`);
  }
  // The two hosts 12C collected four seasons from under the wrong name. Neither
  // may resolve to the institution it was filed under. The mapping to the
  // institution it DOES belong to is correct and is left alone: this table
  // makes a wrong mapping unusable, it does not rewrite known_domains.json.
  for (const [domain, wrongFor, alsoClaimedBy] of [
    ['gocolumbialions.com', 'Columbia (MO)', 'Columbia'],
    ['maryvillesaints.com', 'Maryville (TN)', 'Maryville University'],
  ]) {
    const row = db.prepare('SELECT unitid, status, wrong_mappings FROM athletics_domains WHERE domain = ?').get(domain);
    const wrongUnitid = resolvers.resolve(wrongFor).unitid;
    check(`${domain} does not resolve to ${wrongFor}`,
      !!row && row.unitid !== wrongUnitid,
      `host is ${row?.unitid ?? 'unestablished'}, ${wrongFor} is ${wrongUnitid}`);
    const wrongMappings = JSON.parse(row?.wrong_mappings ?? '[]');
    check(`${domain} carries the refusal of the ${wrongFor} claim, or establishes nothing at all`,
      row?.unitid == null || wrongMappings.some((m) => m.claimantUnitid === wrongUnitid),
      `status ${row?.status}, also claimed by ${alsoClaimedBy}`);
  }
  // WITHIN A SCOPE. The same spelling deliberately names two institutions in two
  // conferences: the Wolverine-Hoosier's "Rochester" is Rochester Christian and
  // the University Athletic Association's is the University of Rochester, in the
  // same seasons. That is what the scope is for, and an unscoped version of this
  // check would forbid the fix.
  check('every alias names exactly one institution within its scope',
    db.prepare(`SELECT COUNT(*) n FROM (SELECT alias_key, conference_scope FROM institution_aliases
                 GROUP BY alias_key, conference_scope HAVING COUNT(DISTINCT unitid) > 1)`).get().n === 0);
  check('a conference-scoped alias is only ever read with its conference',
    /scoped\.get\(`\$\{normaliseInstitution/.test(SOURCE('../lib/institutionQueries.js'))
      && /if \(conferenceId\) \{\n\s+const unitid = scoped\.get/.test(SOURCE('../lib/institutionQueries.js')));
  check('a two-year college is never published as a conference member',
    db.prepare(`SELECT COUNT(*) n FROM programme_conference_seasons x JOIN colleges c ON c.id = x.college_id
                 WHERE c.division NOT IN ('NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA')`).get().n === 0);
  check('no programme is filed under two conferences in one season',
    db.prepare(`SELECT COUNT(*) n FROM (SELECT college_id, season FROM programme_conference_seasons
                 GROUP BY college_id, season HAVING COUNT(*) > 1)`).get().n === 0);
}

/**
 * COMPETITIVE V1 — the whole-universe claims, checked over every row.
 *
 * Phase 12E froze the layer. These are the statements that have to hold across
 * the entire table rather than on a fixture, and every one of them is a way the
 * product would be wrong to print something.
 */
group('COMPETITIVE V1 — the whole universe');
{
  const zero = (sql) => db.prepare(sql).get().n;
  check('no historical division without an accepted provenance',
    zero(`SELECT COUNT(*) n FROM programme_conference_seasons
           WHERE historical_division IS NOT NULL
             AND division_provenance NOT IN ('EXPLICIT_OFFICIAL', 'DERIVED_FROM_OFFICIAL_MEMBERSHIP')`) === 0);
  check('no membership row from a source outside the accepted set',
    zero(`SELECT COUNT(*) n FROM programme_conference_seasons
           WHERE membership_provenance NOT IN ('OFFICIAL_CONFERENCE_STANDINGS', 'OFFICIAL_PROGRAMME_SOURCE',
             'OFFICIAL_CONFERENCE_MEMBERSHIP', 'OFFICIAL_NCAA_MEMBERSHIP', 'OFFICIAL_NAIA_MEMBERSHIP')`) === 0);
  // The current-division firewall, over every row rather than one programme.
  const fallback = db.prepare(
    `SELECT COUNT(*) n FROM programme_conference_seasons x JOIN colleges c ON c.id = x.college_id
      WHERE x.historical_division IS NOT NULL AND x.historical_division <> c.division`).get().n;
  check('historical division is not a copy of the current division', fallback > 0,
    `${fallback} rows differ from colleges.division`);
  check('no season carries a division the conference itself was not established in',
    zero(`SELECT COUNT(*) n FROM programme_conference_seasons x
           LEFT JOIN conference_seasons s
             ON s.conference_id = x.conference_id AND s.sport = x.sport AND s.season = x.season
          WHERE x.historical_division IS NOT NULL
            AND x.membership_provenance = 'OFFICIAL_CONFERENCE_STANDINGS'
            AND (s.division IS NULL OR s.division <> x.historical_division)`) === 0);
  check('no unresolved institution identity is published',
    zero('SELECT COUNT(*) n FROM programme_conference_seasons WHERE college_id IS NULL OR TRIM(college_id) = \'\'') === 0);
  check('no ambiguous membership is published',
    zero(`SELECT COUNT(*) n FROM programme_conference_seasons
           WHERE identity_method NOT IN ('PROGRAMME_NAME_EXACT', 'PROGRAMME_NAME_VARIANT',
             'PROGRAMME_VIA_UNITID', 'PROGRAMME_VIA_UNITID_NAME',
             'PROGRAMME_VIA_CONFERENCE_AGREEMENT', 'PROGRAMME_VIA_OFFICIAL_MEMBERSHIP',
             'PROGRAMME_VIA_CONFERENCE_SCOPED_ALIAS')`) === 0);
  check('no programme is filed under two conferences in one season',
    zero(`SELECT COUNT(*) n FROM (SELECT college_id, season FROM programme_conference_seasons
           GROUP BY college_id, season HAVING COUNT(*) > 1)`) === 0);
  check('a conference record is never the overall record',
    zero(`SELECT COUNT(*) n FROM programme_conference_seasons x
           JOIN programme_seasons p ON p.college_id = x.college_id AND p.season = x.season
          WHERE x.conference_wins IS NOT NULL
            AND x.conference_wins = p.wins AND x.conference_losses = p.losses
            AND x.conference_draws = p.draws AND p.matches_played > 12`) === 0);
  check('a missing conference record is null and not zero',
    zero(`SELECT COUNT(*) n FROM programme_conference_seasons
           WHERE record_status = 'RECORD_UNAVAILABLE'
             AND (conference_wins IS NOT NULL OR conference_draws IS NOT NULL OR conference_losses IS NOT NULL)`) === 0);
  check('every conference record adds up to the matches its source printed',
    zero(`SELECT COUNT(*) n FROM programme_conference_seasons
           WHERE conference_matches IS NOT NULL
             AND conference_matches <> conference_wins + conference_draws + conference_losses`) === 0);
  const codeOf = (f) => SOURCE(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('a conference table row never reaches a sentence',
    !/conferenceTableRow/.test(codeOf('../../shared/report/structuralFacts.js')));
  check('the field contract keeps the table row, the seed and the size internal',
    ['conferenceTableRow', 'seed', 'conferenceSize'].every((f) => V1_FIELDS[f]?.verdict === 'INTERNAL_ONLY'));
}

group('COMPETITIVE V1 — the reader contract');
{
  const ids = db.prepare(
    `SELECT c.id, c.name, c.sport FROM colleges c
       JOIN programme_seasons p ON p.college_id = c.id
      WHERE c.division IN ('NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA')
      GROUP BY c.id ORDER BY c.id`).all();
  let sentences = 0; let offending = null; let movements = 0; let unsupported = null; let coachSentences = 0;
  for (const c of ids) {
    const pkg = competitivePackageFor(c.id);
    if (!pkg) continue;
    for (const s of readerSentences(pkg)) {
      sentences += 1;
      if (!offending && FORBIDDEN_READER_LANGUAGE.test(s)) offending = `${c.name} ${c.sport}: ${s}`;
      if (/\bcoach/i.test(s)) coachSentences += 1;
    }
    // A structural movement must be backed by two seasons that are both on file.
    for (const f of pkg.structuralFacts) {
      if (f.kind !== 'CONFERENCE_CHANGE' && f.kind !== 'DIVISION_CHANGE') continue;
      movements += 1;
      const known = new Set(pkg.seasons.filter((x) => x.historicalConference).map((x) => x.season));
      if (!unsupported && !f.seasons.every((y) => known.has(y))) unsupported = `${c.name} ${c.sport} ${f.text}`;
    }
  }
  check('no forbidden reader language in any sentence the universe can produce',
    offending === null, `${sentences} sentences over ${ids.length} programmes${offending ? ` — ${offending}` : ''}`);
  check('no structural movement is claimed from a season not on file',
    unsupported === null, `${movements} movements${unsupported ? ` — ${unsupported}` : ''}`);
  // The coach contract, behaviourally: no sentence the universe produces mentions
  // a coach at all in V1, and the contract names the framings it refuses.
  check('no sentence the universe produces makes a causal coach claim',
    coachSentences === 0, `${coachSentences} sentences mention a coach`);
  check('the coach contract names the before/after framing it refuses',
    COACH_INTEGRATION.refused.some((r) => /before\/after/.test(r))
      && COACH_INTEGRATION.refused.some((r) => /improved/.test(r))
      && COACH_INTEGRATION.allowed.some((a) => /denominator/.test(a)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed);
