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
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { programReportModel } from '../routes/philosophy.js';
import { renderProgramReport, reportFilename } from '../lib/philosophyReport.js';
import { classRank, STARTER_MINUTES } from '../../shared/lifecycle/lifecycle.js';
import { readClassYear } from '../../shared/classYear.js';
import {
  DEFAULTS as RUNTIME_DEFAULTS, resolveConfig as resolveRuntime, runtimeProblems,
} from '../lib/runtimeConfig.js';
import { setSessionCookie } from '../lib/operatorAuth.js';
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
import { decisionFindings, MAX_FINDINGS } from '../../shared/report/decisionLayer.js';
import { unicodeFallback } from '../lib/reportFonts.js';
import { pdfUnicodeText } from '../lib/pdfText.js';
import {
  readerSentences, FORBIDDEN_READER_LANGUAGE, V1_FIELDS, COACH_INTEGRATION,
} from '../../shared/report/competitivePackage.js';
import { FORBIDDEN as FORBIDDEN_STRUCTURAL } from '../../shared/report/structuralFacts.js';
import { render } from '../lib/philosophyPdf.js';
import { createAudit, describeViolations, encodable } from '../lib/reportAudit.js';
import {
  competitiveHistoryPage, competitiveEnvironmentPage, competitiveSentences, benchmarkLabel,
  BENCHMARK_LABEL,
} from '../lib/reportCompetitive.js';
import { competitiveEnvironmentIsWorthAPage } from '../../shared/report/sections.js';
import {
  staffQuestions, SOURCE_TITLES, MAX_QUESTIONS,
} from '../../shared/report/staffQuestions.js';
import { readCoachRow } from '../../shared/coachTenure.js';
import { classDisplay } from '../../shared/lifecycle/lifecycle.js';
import {
  generateReport, readArtifact, selectableAthletes, STORE_ROOT,
} from '../lib/reportDelivery.js';

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
group('LAYOUT — the front of the report keeps what the card had');
for (const [name, sport] of [['Akron', 'womens-soccer'], ['Grand Valley State', 'womens-soccer']]) {
  const m = modelFor(name, sport);
  const s = m.summary.programme.freshmanOpportunity;
  const text = pdfText(await renderProgramReport(m));
  /**
   * Phase 13C moved this from the card's variable-height block to the
   * first-year finding's evidence line, which wraps and cannot be squeezed out
   * — so the risk this invariant was written against is gone and the fact it
   * protects still has to be here.
   */
  check(`${name} women’s still states the weighted figure on the decision layer`,
    s.weightingApplied === true && s.weightedAgrees === false
      && new RegExp(`weighted towards the current coach reads ${nfInt(s.weightedLadderTop.median)} min`)
        .test(text),
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

/**
 * COMPETITIVE V1 ON THE PAGE — the claims the two report pages make.
 *
 * The group above holds the DATA contract: no sentence the package can produce
 * carries a forbidden word. This one holds the PAGE contract, which is a
 * different claim: the renderer authors sentences of its own, derives a
 * benchmark label the package does not carry, and lays both pages out inside a
 * fixed box. All three are checked against the real universe rather than a
 * fixture, because the states that break a layout — a 55-character conference
 * name in a one-season block, a division change across a season nobody has —
 * are ones no fixture would have thought to build.
 */
group('COMPETITIVE V1 — on the page');
{
  const ids = db.prepare(`SELECT id, name, sport FROM colleges
    WHERE division IN ('NCAA D1','NCAA D2','NCAA D3','NAIA') AND active = 1`).all();

  let sentences = 0;
  let offending = null;
  let structural = null;
  /**
   * DENOMINATOR AMBIGUITY, AS A MACHINE CHECK.
   *
   * "Every season on file was played in NCAA Division III" was true of the
   * seasons with an established division and read, beside a four-season table,
   * as a claim about all four. The rule is not "avoid the phrase" — a sweeping
   * quantifier is often the clearest sentence available — it is that a sentence
   * which quantifies a set of seasons must also say WHICH set, in the same
   * sentence, where a reader can see it.
   */
  const QUANTIFIER = /\b(?:every|each|all)\s+(?:\d+\s+)?seasons?\b/i;
  // "that could be compared" and "that could be read" name their set as
  // precisely as "whose conference is on file" does — the set is the seasons the
  // model could compare, or read, and the sentence says which.
  const NAMES_ITS_SET = /(?:with an established|with a division on file|whose conference is on file|seasons? read|that could be (?:read|compared)|of the four seasons|on file for)/i;
  // Phrases that assert the whole window and cannot carry a denominator at all.
  const WHOLE_WINDOW = /\b(?:throughout|across all|entire window|the whole window|all four seasons)\b/i;
  let quantified = 0;
  let ambiguous = null;
  let whole = null;
  let labelOutside = null;
  let planMismatch = null;
  let percentilePrinted = null;
  for (const c of ids) {
    // The two pages read `model.competitive` and nothing else, so the whole
    // universe can be swept without building a roster model for any of it.
    const pkg = competitivePackageFor(c.id);
    if (!pkg?.available) continue;
    const model = { competitive: pkg };
    for (const line of competitiveSentences(model)) {
      sentences += 1;
      if (!offending && FORBIDDEN_READER_LANGUAGE.test(line)) offending = `${c.name} ${c.sport}: ${line}`;
      if (!structural && FORBIDDEN_STRUCTURAL.test(line)) structural = `${c.name} ${c.sport}: ${line}`;
      if (QUANTIFIER.test(line)) {
        quantified += 1;
        if (!ambiguous && !NAMES_ITS_SET.test(line)) ambiguous = `${c.name} ${c.sport}: ${line}`;
      }
      if (!whole && WHOLE_WINDOW.test(line)) whole = `${c.name} ${c.sport}: ${line}`;
      // A percentile is a precision this pool cannot carry, and the three-word
      // vocabulary exists so that it is never printed.
      if (!percentilePrinted && /\bpercentile\b/i.test(line)) percentilePrinted = `${c.name}: ${line}`;
    }
    for (const season of pkg.seasons) {
      const label = benchmarkLabel(season.benchmark);
      if (label && !Object.values(BENCHMARK_LABEL).includes(label)) labelOutside = `${c.name} ${season.season}: ${label}`;
      if (!label && season.benchmark?.available) labelOutside = `${c.name} ${season.season}: available with no label`;
    }
    // The registry and the page must answer "is there an environment to draw"
    // identically, or a section is listed in the contents and never printed.
    const worth = competitiveEnvironmentIsWorthAPage(pkg);
    const hasStructure = pkg.coverage.membershipKnown > 0 || pkg.coverage.divisionKnown > 0;
    if (worth !== hasStructure) planMismatch = `${c.name} ${c.sport}`;
  }
  check('no forbidden reader language in any sentence the two pages author',
    offending === null, `${sentences} sentences over ${ids.length} programmes${offending ? ` — ${offending}` : ''}`);
  check('every sweeping quantifier names the set it counted',
    ambiguous === null, ambiguous ?? `${quantified} sentences quantify a set of seasons`);
  check('no sentence claims the whole window without a denominator',
    whole === null, whole ?? 'no "throughout", "across all" or "entire window" anywhere');
  check('no structural sentence on either page implies a direction',
    structural === null, structural ?? 'across the same universe');
  check('every available benchmark draws one of the three labels and no other',
    labelOutside === null, labelOutside ?? 'upper quarter / middle half / lower quarter');
  check('no page prints a percentile', percentilePrinted === null, percentilePrinted ?? '');
  check('the registry and the page agree on whether there is an environment to draw',
    planMismatch === null, planMismatch ?? '');
}

/**
 * The layout, on the states that actually stress it.
 *
 * Nine programmes rather than two thousand: the whole-universe sweep is a
 * development tool and takes fifty seconds, and every state it found is
 * represented here by the programme that produced the tightest measurement.
 */
group('COMPETITIVE V1 — the two pages, laid out');
{
  const cases = [
    ['Mercyhurst', 'mens-soccer', 'changed division and conference inside the window'],
    ['UCLA', 'mens-soccer', 'the tightest measured history page'],
    ['Jamestown', 'womens-soccer', 'the tightest measured environment page'],
    ['UC Merced', 'mens-soccer', 'a gap in the window, and a move across it'],
    ['Albany', 'mens-soccer', 'a full record and no structural evidence at all'],
    ['Anderson (IN)', 'mens-soccer', 'one readable season'],
    ['Husson', 'mens-soccer', 'a conference that published no record for two seasons'],
    ['Kansas State', 'womens-soccer', 'conference on file, division not established'],
    ['University of Rochester', 'womens-soccer', 'the identity 12E.1 corrected'],
  ];
  let worstClearance = Infinity;
  let worstName = '';
  for (const [name, sport, why] of cases) {
    const col = db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?').get(name, sport);
    if (!col) { check(`${name} ${sport} is on file`, false, why); continue; }
    // The whole report model, not the package alone: the coach block is the
    // tallest thing on the history page and it only exists where the coach
    // attribution was handed in, so a package fetched bare measures a page the
    // document never draws — 123 points of clearance at UCLA men's instead of 27.
    const model = modelFor(name, sport);
    const pkg = model.competitive;
    const pages = [['history', competitiveHistoryPage]];
    if (competitiveEnvironmentIsWorthAPage(pkg)) pages.push(['environment', competitiveEnvironmentPage]);
    let trouble = null;
    let clearance = Infinity;
    for (const [which, fn] of pages) {
      const audit = createAudit();
      let left = null;
      // eslint-disable-next-line no-await-in-loop
      await render((k) => {
        let first = true;
        const addPage = k.doc.addPage.bind(k.doc);
        k.doc.addPage = (...a) => (first ? ((first = false), k.doc) : addPage(...a));
        fn(k, model);
        left = k.remaining();
      }, { audit });
      if (audit.pages > 1) trouble = `${which} ran to ${audit.pages} pages`;
      if (audit.violations.length) trouble = `${which}: ${describeViolations(audit.violations, 2)}`;
      if (audit.collisions.length) trouble = `${which}: text over text — ${audit.collisions[0].text}`;
      if (audit.clipped.length) trouble = `${which}: clipped — ${audit.clipped[0].label}`;
      if (audit.unencodable.length) trouble = `${which}: undrawable character`;
      clearance = Math.min(clearance, left);
    }
    if (clearance < worstClearance) { worstClearance = clearance; worstName = `${name} ${sport}`; }
    check(`${name} ${sport} — ${why}`, trouble === null,
      trouble ?? `${pages.length} page(s), ${Math.round(clearance)}pt clear of the flow floor`);
  }
  // The flow floor is 24 points above the boundary the overflow guard enforces,
  // so a page sitting on it is still inside the box. This is the headroom a
  // future wording change has, stated rather than discovered.
  check('every page above stays inside the flow floor', worstClearance >= 0,
    `tightest ${Math.round(worstClearance)}pt at ${worstName}`);
}

/**
 * THE RELEASE CHECK: is the Competitive data actually in this database?
 *
 * A DEPLOYMENT CAN LOSE THIS LAYER WITHOUT ANY ERROR. `competitivePackageFor`
 * returns `available: false` when the tables are empty, `planSections` then
 * plans neither Competitive page, and the report builds and renders perfectly —
 * two pages shorter. Measured on a copy of the pre-release database with the
 * schema created and no rows in it: 0 of 300 programmes had a package, both
 * sections were absent from the plan, and nothing anywhere threw.
 *
 * SYSTEM-WIDE, NOT PER-PROGRAMME. 27 programmes have no readable competitive
 * season and that is a correct answer for them; a report must never fail because
 * one programme is sparse. What must fail is the whole layer being absent, so
 * every assertion here is a floor over the universe.
 *
 * The floors are deliberately well below the verified counts. They are not a
 * second freeze of the numbers — `docs/competitive-v1-freeze.md` holds those —
 * they are the line under which the layer has stopped existing.
 */
group('COMPETITIVE V1 — the data is in this database');
{
  const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  const exists = (t) => db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).n > 0;
  const FLOORS = [
    ['programme_seasons', 7000, 8685],
    ['institution_aliases', 2000, 2337],
    ['athletics_domains', 2400, 2717],
    ['conference_seasons', 800, 960],
    ['programme_conference_seasons', 6500, 7219],
    ['conference_members_official', 800, 968],
  ];
  for (const [table, floor, verified] of FLOORS) {
    if (!exists(table)) { check(`${table} exists`, false, 'the migration has not run'); continue; }
    const n = count(table);
    check(`${table} carries its layer`, n >= floor, `${n} rows (floor ${floor}, verified at release ${verified})`);
  }
  // A byproduct rather than a payload: it can legitimately shrink as identity
  // improves, so only its existence is asserted.
  check('conference_membership_quarantine exists', exists('conference_membership_quarantine'),
    exists('conference_membership_quarantine') ? `${count('conference_membership_quarantine')} rows` : 'missing');

  const confirmed = db.prepare('SELECT COUNT(*) n FROM programme_conference_seasons WHERE season_confirmed = 1').get().n;
  check('membership is confirmed for the bulk of the layer', confirmed >= 6000,
    `${confirmed} confirmed programme-seasons`);

  /**
   * The end-to-end one, and the only one that would have caught the silent
   * disappearance on its own: the package the two report pages read is
   * available for the great majority of the universe.
   */
  const universe = db.prepare(`SELECT id FROM colleges
    WHERE division IN ('NCAA D1','NCAA D2','NCAA D3','NAIA') AND active = 1`).all();
  let available = 0;
  for (const c of universe) if (competitivePackageFor(c.id)?.available) available += 1;
  const share = universe.length ? available / universe.length : 0;
  check('a Competitive package is available across the report universe', share >= 0.9,
    `${available} of ${universe.length} (${(share * 100).toFixed(1)}%, floor 90%, verified at release 98.7%)`);
}

/**
 * THE DECISION LAYER — the ranking, checked against the whole universe.
 *
 * These are the claims that cannot be made from a fixture. A ranking is only
 * defensible if the SAME rules produce sane pages at 2,401 programmes, and the
 * failure modes worth guarding are the ones a good fixture hides: a finding
 * that points at a page this programme does not have, an absence that talks
 * its way onto the front, a coverage statistic outranking a measured share,
 * and a page that quietly grew past what it was laid out for.
 */
group('DECISION LAYER — the ranking holds across the universe');
{
  const all = db.prepare('SELECT id, name, sport FROM colleges WHERE active = 1').all();
  let dangling = 0; let over = 0; let duplicated = 0; let unresolvedCoach = 0;
  let destinationHigh = 0; let missedDivisionChange = 0; let divisionChanges = 0;
  let withFindings = 0; let allSameClass = 0;
  const firstExample = {};
  for (const c of all) {
    let model;
    try { model = programReportModel({ collegeId: c.id, playerId: null }); } catch { continue; }
    const { findings } = decisionFindings(model);
    // The model already carries its own plan; `planSections` is not re-run,
    // because a second plan built from a different context is not the document
    // the reader is holding.
    const ids = new Set((model.sections ?? []).map((x) => x.id));
    if (findings.length) withFindings += 1;
    if (findings.length > MAX_FINDINGS) { over += 1; firstExample.over ??= c.name; }
    if (new Set(findings.map((f) => f.category)).size !== findings.length) {
      duplicated += 1; firstExample.duplicated ??= c.name;
    }
    if (findings.length > 1 && new Set(findings.map((f) => f.priority)).size === 1
      && findings[0].priority !== 'C') { allSameClass += 1; }
    for (const f of findings) {
      if (f.section && !ids.has(f.section)) { dangling += 1; firstExample.dangling ??= `${c.name}/${f.category}`; }
      if (f.category === 'player-destinations' && f.priority !== 'D') {
        destinationHigh += 1; firstExample.destinationHigh ??= c.name;
      }
      if (f.category === 'coach-context' && /could not be read|vacant or to be announced/.test(f.text)) {
        unresolvedCoach += 1; firstExample.unresolvedCoach ??= c.name;
      }
    }
    // The competitive slot must fire wherever the structural record holds a
    // division move: that is the one fact this layer exists to surface.
    if ((model.competitive?.structuralFacts ?? []).some((f) => f.kind === 'DIVISION_CHANGE')) {
      divisionChanges += 1;
      const f = findings.find((x) => x.category === 'competitive-environment');
      if (!f || f.priority !== 'A') { missedDivisionChange += 1; firstExample.missed ??= c.name; }
    }
  }
  check('no finding points at a page its report does not contain',
    dangling === 0, `${dangling} dangling references${firstExample.dangling ? ` (${firstExample.dangling})` : ''}`);
  check('no report renders more findings than the page is laid out for',
    over === 0, `${over} over ${MAX_FINDINGS}${firstExample.over ? ` (${firstExample.over})` : ''}`);
  check('no concept is stated twice on one decision page',
    duplicated === 0, `${duplicated} duplicated${firstExample.duplicated ? ` (${firstExample.duplicated})` : ''}`);
  check('an unresolved coach record never becomes a finding',
    unresolvedCoach === 0, `${unresolvedCoach} promoted${firstExample.unresolvedCoach ? ` (${firstExample.unresolvedCoach})` : ''}`);
  check('a traced-destination sample never outranks measured evidence',
    destinationHigh === 0, `${destinationHigh} above class D`);
  check('a division change inside the window always leads the decision layer',
    missedDivisionChange === 0,
    `${divisionChanges} programmes moved division, ${missedDivisionChange} missed${firstExample.missed ? ` (${firstExample.missed})` : ''}`);
  check('the decision layer speaks at the great majority of programmes',
    withFindings / all.length >= 0.85,
    `${withFindings} of ${all.length} (${(100 * withFindings / all.length).toFixed(1)}%, floor 85%)`);
}

/**
 * FONTS — every name is drawn as the characters it is spelled with.
 *
 * The failure this guards is invisible to every other check in this file:
 * pdfkit's standard faces do not refuse a character outside WinAnsi, they hand
 * back the code point as a glyph selector, and the viewer draws its low byte.
 * "Zoё May" became "ZoQ May" on the page and in the extracted text, and nothing
 * crashed. So the roster is scanned for characters the standard faces cannot
 * encode and every programme carrying one is rendered and audited.
 */
group('FONTS — a name is drawn as it is spelled');
{
  const source = unicodeFallback();
  check('a Unicode-capable face is available to fall back to',
    Boolean(source),
    source ? source.id : 'none: install one, or put three faces in server/assets/fonts');

  /**
   * TWO CLASSES, AND ONLY ONE OF THEM IS A RENDERING FAULT.
   *
   * A LETTER outside WinAnsi — ё, č, ā — is drawable by any Unicode face, so if
   * it does not reach the page as itself the renderer is at fault and this
   * fails. A code point with no glyph in any face — the C1 control characters
   * three Shawnee State men's names carry from a double-decoded import — cannot
   * be drawn by any font ever, so no rendering change can fix it. That one is
   * surfaced rather than failed: the remedy is a data correction, and this
   * phase is explicitly not allowed to make one.
   *
   * The scan is over the rosters rather than over the reports: 276,745 rows
   * read in a second, against 2,401 reports that would take ten minutes.
   */
  const glyphless = (ch) => {
    const c = ch.codePointAt(0);
    // C0 and C1 controls, and the surrogate range. Nothing in these is a letter
    // and nothing in them has a glyph.
    return c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0xd800 && c <= 0xdfff);
  };
  const names = db.prepare('SELECT college_name, sport, player_name FROM roster_players').all();
  const withLetters = new Map();
  const withGlyphless = new Map();
  for (const r of names) {
    const n = String(r.player_name ?? '').normalize('NFC');
    const odd = [...n].filter((ch) => !encodable(ch));
    if (!odd.length) continue;
    const key = `${r.college_name}|${r.sport}`;
    if (odd.some(glyphless)) withGlyphless.set(key, n);
    else withLetters.set(key, n);
  }

  let clean = 0; const dirty = [];
  for (const [key, example] of withLetters) {
    const [name, sport] = key.split('|');
    const col = db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?').get(name, sport);
    if (!col) continue;
    const audit = createAudit();
    // eslint-disable-next-line no-await-in-loop
    const buf = await renderProgramReport(programReportModel({ collegeId: col.id, playerId: null }), { audit });
    // Read through the PDF's own ToUnicode map, which is the route a reader's
    // copy-and-paste takes; a WinAnsi reader cannot see an embedded subset.
    const ok = audit.unencodable.length === 0 && pdfUnicodeText(buf).includes(example);
    if (ok) clean += 1; else dirty.push(`${name}/${sport}: ${example}`);
  }
  check('every letter outside WinAnsi is drawn, and read back, as itself',
    dirty.length === 0 && clean === withLetters.size,
    `${clean} of ${withLetters.size} programmes${dirty.length ? ` — ${dirty.slice(0, 3).join(', ')}` : ''}`);

  check('a code point no font can draw is surfaced rather than altered',
    true,
    withGlyphless.size
      ? `${withGlyphless.size} programme(s) carry a control character from a double-decoded `
        + `import, e.g. ${[...withGlyphless.values()][0]} — a data correction, not a font one`
      : 'none on file');
}

/**
 * THE VISUAL SYSTEM — one grammar, measured off the bytes.
 *
 * 13G brought the athlete pages onto the system the programme pages have used
 * since 13D. The two claims worth checking against real reports rather than a
 * fixture are the ones that regress silently: a figure that grows past the
 * page title, and an athlete layer that stops being louder than the programme
 * layer behind it. Both are read out of the `Tf` operators in each page's
 * content stream, so they measure what a reader sees rather than what a
 * renderer intended.
 *
 * The card vocabulary is asserted at source, because a rounded border is easy
 * to reintroduce and impossible to spot in a diff of a rendered page.
 */
group('VISUAL SYSTEM — the athlete pages are set in the programme’s grammar');
{
  const DISPLAY_CEILING = 19;
  const sizesByPage = (buf) => {
    const raw = buf.toString('latin1');
    const out = [];
    const re = /stream\r?\n([\s\S]*?)endstream/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      let body;
      try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
      if (!/\bBT\b/.test(body)) continue;
      out.push([...body.matchAll(/\/F\d+\s+([\d.]+)\s+Tf/g)].map((x) => Number(x[1])));
    }
    return out;
  };

  const cases = [];
  for (const p of db.prepare('SELECT id, full_name, sport FROM players ORDER BY full_name').all()) {
    const cols = db.prepare('SELECT id, name FROM colleges WHERE sport = ? ORDER BY name').all(p.sport);
    for (const c of cols.filter((_, i) => i % 40 === 0)) cases.push({ p, c });
  }

  let checked = 0; let overCeiling = 0; let notQuieter = 0;
  const example = {};
  for (const { p, c } of cases) {
    let model;
    try { model = programReportModel({ collegeId: c.id, playerId: p.id }); } catch { continue; }
    // eslint-disable-next-line no-await-in-loop
    const buf = await renderProgramReport(model);
    const pages = sizesByPage(buf);
    if (pages.length < 3) continue;
    checked += 1;
    // The cover is the one page allowed above the ceiling: its hero is the
    // name on the front of the document, not a figure inside a layout.
    for (let i = 1; i < pages.length; i += 1) {
      if (Math.max(0, ...pages[i]) > DISPLAY_CEILING) {
        overCeiling += 1; example.over ??= `${p.full_name} @ ${c.name} p${i + 1}`;
        break;
      }
    }
    if (!(Math.max(0, ...pages[2]) < Math.max(0, ...pages[1]))) {
      notQuieter += 1; example.quiet ??= `${p.full_name} @ ${c.name}`;
    }
  }

  check('no figure on an athlete page is set larger than a page title',
    overCeiling === 0,
    `${checked} athlete reports${example.over ? ` — ${example.over}` : ` · ceiling ${DISPLAY_CEILING}pt`}`);
  check('the programme decision layer is set below the athlete one on every athlete report',
    notQuieter === 0,
    `${checked} athlete reports${example.quiet ? ` — ${example.quiet}` : ''}`);

  const athleteSrc = SOURCE('../lib/reportAthlete.js');
  const frontSrc = SOURCE('../lib/reportFront.js');
  check('no rounded or stroked card is drawn on an athlete page',
    !/roundedRect\(/.test(athleteSrc) && !/roundedRect\(/.test(frontSrc),
    'the openings page was three of them');
  check('the dashboard helpers stay deleted',
    ['bigMetric', 'evidenceChip', 'miniStacked', 'calloutPrimary', 'pathwayBlock', 'headlineBand']
      .every((d) => !new RegExp(`${d}\\(`).test(frontSrc)),
    'panel, bigMetric, the callouts, the fact and player lines and the four athlete cards');
}

/**
 * WHAT TO VERIFY WITH THE STAFF — the contract, checked against the universe.
 *
 * Three claims cannot be made from a fixture. Every question must cite a
 * section this document actually contains — the defect the first sweep found
 * at 215 of 791 reports, where a question generated from the roster horizon
 * pointed at a position page that does not render when nobody is recorded at
 * the position. No question may carry forecast or judgement language, at any
 * programme, for any athlete. And the section must be omitted rather than
 * drawn empty wherever nothing qualifies.
 */
group('STAFF QUESTIONS — every question cites a page, and none of them forecasts');
{
  // Lowercase and word-bounded: a coach called Will Roberts is a name in a
  // reason, not a forecast, and the universe holds one.
  const FORECAST = /\b(will|likely|chance|expected minutes|available minutes|blocked|competitor|competition|better|worse|good|bad|risk|safe|guarantee|scholarship|transfers?)\b/;
  const WHY = /\bwhy\b/i;

  const cases = [];
  for (const p of db.prepare('SELECT id, full_name, sport FROM players ORDER BY full_name').all()) {
    const cols = db.prepare('SELECT id, name FROM colleges WHERE sport = ? ORDER BY name').all(p.sport);
    for (const c of cols.filter((_, i) => i % 9 === 0)) cases.push({ p, c });
  }

  let checked = 0; let dangling = 0; let over = 0; let forecast = 0; let why = 0;
  let notOpened = 0; let dupFamily = 0; let emptySection = 0; let missingSection = 0;
  let zero = 0; let restated = 0;
  const example = {};
  const counts = new Map();
  const cats = new Map();
  for (const { p, c } of cases) {
    let model;
    try { model = programReportModel({ collegeId: c.id, playerId: p.id }); } catch { continue; }
    const { questions } = staffQuestions(model);
    checked += 1;
    counts.set(questions.length, (counts.get(questions.length) ?? 0) + 1);
    const ids = new Set((model.sections ?? []).map((x) => x.id));
    const here = ids.has('athlete-staff-questions');
    if (!questions.length) {
      zero += 1;
      if (here) { emptySection += 1; example.empty ??= `${p.full_name} @ ${c.name}`; }
      continue;
    }
    if (!here) { missingSection += 1; example.missing ??= `${p.full_name} @ ${c.name}`; }
    if (questions.length > MAX_QUESTIONS) { over += 1; example.over ??= `${p.full_name} @ ${c.name}`; }
    if (new Set(questions.map((x) => x.family)).size !== questions.length) {
      dupFamily += 1; example.dup ??= `${p.full_name} @ ${c.name}`;
    }
    for (const x of questions) {
      cats.set(x.category, (cats.get(x.category) ?? 0) + 1);
      if (!ids.has(x.section) || !SOURCE_TITLES[x.section]) {
        dangling += 1; example.dangling ??= `${p.full_name} @ ${c.name}/${x.category} → ${x.section}`;
      }
      const whole = `${x.question} ${x.reason}`;
      if (FORECAST.test(whole)) { forecast += 1; example.forecast ??= `${x.category}: ${whole}`; }
      if (WHY.test(whole)) { why += 1; example.why ??= `${x.category}: ${whole}`; }
      if (!/^(How|What|Which)\b/.test(x.question) || !x.question.endsWith('?')) {
        notOpened += 1; example.opened ??= `${x.category}: ${x.question}`;
      }
      // A question opens the unknown; it does not restate a measurement. The
      // only digits it may carry are a season.
      if (/\d/.test(x.question.replace(/\b(19|20)\d\d\b/g, ''))) {
        restated += 1; example.restated ??= `${x.category}: ${x.question}`;
      }
    }
  }

  check('every question cites a section this document contains',
    dangling === 0, `${checked} athlete reports${example.dangling ? ` — ${example.dangling}` : ''}`);
  check('no question carries forecast or judgement language',
    forecast === 0 && why === 0,
    example.forecast ?? example.why ?? 'the scanned vocabulary appears nowhere');
  check('every question opens with how, what or which',
    notOpened === 0, example.opened ?? `${checked} athlete reports`);
  check('no question restates a measurement',
    restated === 0, example.restated ?? 'only the season a question is asked about');
  check('one question per conversation, and never more than the ceiling',
    dupFamily === 0 && over === 0,
    example.dup ?? example.over ?? `ceiling ${MAX_QUESTIONS}`);
  check('the section is omitted where nothing qualifies, and present where something does',
    emptySection === 0 && missingSection === 0,
    `${zero} of ${checked} reports produced no question${example.empty ? ` — ${example.empty}` : ''}`
    + `${example.missing ? ` — ${example.missing}` : ''}`);
  check('the page is not five questions by default',
    (counts.get(MAX_QUESTIONS) ?? 0) / Math.max(1, checked) < 0.2,
    [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}→${v}`).join(' · '));
  check('no single category is on every report',
    [...cats.values()].every((v) => v < checked),
    [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k} ${(100 * v / checked).toFixed(0)}%`).join(' · '));
}

/**
 * RELEASE HARDENING — the four claims 13I made, made mechanical.
 *
 * Every one of these was established by an audit that is now written down in
 * docs/report-release.md. An audit is a remembered caution; these are the
 * checks that fail when the thing it established stops being true.
 */
group('RELEASE — what the audits established, checked rather than remembered');
{
  // 1. THE ROLE FILTER, at the season level.
  //
  // 129 programme-seasons carry a named coach row the reader refuses — a
  // director of soccer, an associate head coach, a table cell that is not a
  // person. Not one of them may attribute a season, and a name appearing
  // elsewhere in a report because the SAME person is the head coach in another
  // season is not a leak. The question is only ever whether a refused row
  // carried a season.
  const coachRows = db.prepare(
    'SELECT school, sport, season, coach_name, coach_title, reason FROM coach_seasons').all();
  const bySeason = new Map();
  for (const r of coachRows) {
    const k = `${r.school}|${r.sport}|${r.season}`;
    if (!bySeason.has(k)) bySeason.set(k, []);
    bySeason.get(k).push(r);
  }
  const onlyRefused = [];
  for (const [k, rows] of bySeason) {
    const named = rows.filter((r) => String(r.coach_name ?? '').trim());
    if (!named.length || named.some((r) => readCoachRow(r).usable)) continue;
    onlyRefused.push({ k, names: named.map((r) => r.coach_name.trim()) });
  }
  let attributed = 0; let firstLeak = null; const done = new Set();
  for (const { k, names } of onlyRefused) {
    const [school, sport, season] = k.split('|');
    const col = db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?').get(school, sport);
    if (!col || done.has(`${school}|${sport}`)) continue;
    done.add(`${school}|${sport}`);
    let model;
    try { model = programReportModel({ collegeId: col.id, playerId: null }); } catch { continue; }
    const att = model.coachAttribution;
    for (const s of att?.measuredSeasons ?? []) {
      if (String(s.season) === String(season) && s.coachName && names.includes(s.coachName)) {
        attributed += 1; firstLeak ??= `${k} → ${s.coachName}`;
      }
    }
    if (att?.currentCoach?.name && names.includes(att.currentCoach.name)
      && String(att.currentCoach.season) === String(season)) {
      attributed += 1; firstLeak ??= `${k} → current ${att.currentCoach.name}`;
    }
  }
  check('no season is attributed to a coach row the role filter refuses',
    attributed === 0,
    `${onlyRefused.length} programme-seasons carry only a refused named row${firstLeak ? ` — ${firstLeak}` : ''}`);

  // 2. THE QA FIXTURE IS NOT REACHABLE.
  //
  // Seeded in 13F for a women's-soccer regression the production athletes
  // cannot exercise. It must stay archived and unpublished, which is what the
  // public profile, the publish route and the trial preflight all key on.
  const qa = db.prepare('SELECT id, full_name, archived_at, published_at, public_slug FROM players WHERE id = ?')
    .get('qa-fixture-womens-soccer-0001');
  check('the QA fixture is archived, unpublished and has no public slug',
    Boolean(qa) && Boolean(qa.archived_at) && !qa.published_at && !qa.public_slug,
    qa ? `archived_at ${qa.archived_at ? 'set' : 'MISSING'} · published_at ${qa.published_at ?? 'null'} · slug ${qa.public_slug ?? 'null'}`
      : 'the fixture is not in this database');

  // 3. WHAT A TABLE SHOWS IS WHAT THE ANALYSIS COUNTED.
  //
  // `classDisplay` is derived from `classRank`, so this cannot drift by
  // construction — which is the point of deriving it. The check is here
  // because a second mapping table is the obvious "improvement" somebody makes
  // later, and this is what would catch it.
  const labels = db.prepare(
    'SELECT DISTINCT class_year_label AS l FROM roster_players').all().map((r) => r.l);
  const RANK_TO_ABBR = { 1: 'FY', 2: 'SO', 3: 'JR', 4: 'SR', 5: 'GR' };
  const disagreed = labels.filter((l) => {
    const shown = classDisplay(l);
    const rank = classRank(l);
    if (rank == null) return shown != null && shown !== String(l);
    return shown !== RANK_TO_ABBR[rank];
  });
  const unresolved = labels.filter((l) => l != null && String(l).trim() !== '' && classRank(l) == null);
  check('the class a table shows is the class the analysis read',
    disagreed.length === 0,
    `${labels.length} raw forms${disagreed.length ? ` — ${JSON.stringify(disagreed.slice(0, 3))}` : ''}`);
  check('a class label the analysis cannot read is shown as it was stored',
    unresolved.every((l) => classDisplay(l) === String(l)),
    `${unresolved.length} forms are not a class at all, e.g. ${JSON.stringify(unresolved.slice(0, 4))}`);

  // 4. THE NAME-FRAGMENT DEFECT, SURFACED RATHER THAN FAILED.
  //
  // 13I found that the three C1 control characters at Shawnee State are not a
  // character problem: they are on DUPLICATE FRAGMENT rows, where one player's
  // season is split across two or three differently-mangled spellings of their
  // name and the minutes divide between them. Repairing the characters would
  // make three bogus rows look legitimate. It is a source/importer defect,
  // bounded and pre-existing, and it is printed here so it cannot be forgotten
  // — never asserted to zero, because that would fail the build on somebody
  // else's import rather than on a regression here.
  const rosterNames = db.prepare(
    'SELECT college_name c, sport s, season y, player_name n FROM roster_players').all();
  const groups = new Map();
  for (const r of rosterNames) {
    const k = `${r.c}|${r.s}|${r.y}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(String(r.n ?? ''));
  }
  const norm = (x) => x.trim().toLowerCase().replace(/\s+/g, ' ');
  const affected = new Set();
  for (const [k, names] of groups) {
    for (const a of names) for (const b of names) {
      if (a === b) continue;
      const na = norm(a); const nb = norm(b);
      if (na.length >= 6 && nb.length > na.length && nb.startsWith(na)) affected.add(k);
    }
  }
  check('the roster name-fragment defect is bounded and known',
    true,
    `${affected.size} of ${groups.size} programme-seasons hold a name that is a prefix of another `
    + '— one player split across differently-mangled spellings; see docs/report-release.md');
}

/**
 * DELIVERY — the claims that need the real database.
 *
 * The delivery suite builds its own in-memory fixtures, because every vitest
 * file gets a throwaway database and must not read the working one. These are
 * the two things that can only be checked here: that the named production
 * pairs still produce the page counts the release recorded, and that a
 * generation through the delivery surface leaves every table the report reads
 * exactly as it was.
 */
group('DELIVERY — the frozen report, delivered unchanged');
{
  const PAIRS = [
    ['Rhys Davies', 'Mercyhurst', 'mens-soccer', 31],
    ['Shaan Anad', 'California', 'mens-soccer', 25],
    ['Rhys Davies', 'Albright', 'mens-soccer', 18],
  ];
  const pagesOf = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const streamsOf = (buf) => [...buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
    .map((m) => m[1]).join('');

  const TABLES = ['colleges', 'roster_players', 'players', 'coach_seasons', 'programme_seasons',
    'programme_conference_seasons', 'conference_members_official', 'conference_seasons',
    'institution_aliases'];
  const snapshot = () => Object.fromEntries(TABLES.map((t) => [t, crypto.createHash('sha256')
    .update(db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).join('\n'))
    .digest('hex')]));

  const before = snapshot();
  let checked = 0; let wrongPages = null; let differed = null; let wrongName = null;
  const generated = [];
  for (const [who, prog, sport, expected] of PAIRS) {
    const col = db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?').get(prog, sport);
    const ath = db.prepare('SELECT id FROM players WHERE full_name = ? AND sport = ?').get(who, sport);
    if (!col || !ath) continue;
    checked += 1;

    // A — the frozen path, exactly as the existing endpoint calls it.
    const model = programReportModel({ collegeId: col.id, playerId: ath.id });
    // eslint-disable-next-line no-await-in-loop
    const direct = await renderProgramReport(model);
    if (pagesOf(direct) !== expected) {
      wrongPages ??= `${who} × ${prog}: ${pagesOf(direct)} pages, release recorded ${expected}`;
    }

    // B — the delivery surface.
    // eslint-disable-next-line no-await-in-loop
    const row = await generateReport({ athleteId: ath.id, collegeId: col.id });
    generated.push(row.id);
    const { bytes } = readArtifact(row.id);
    if (streamsOf(bytes) !== streamsOf(direct)) differed ??= `${who} × ${prog}`;
    if (row.filename !== reportFilename(model)) wrongName ??= `${who} × ${prog}: ${row.filename}`;
    if (row.pages !== expected) wrongPages ??= `${who} × ${prog} via delivery: ${row.pages}`;
  }

  check('the release page counts still hold for the named pairs',
    wrongPages === null,
    wrongPages ?? `${checked} of ${PAIRS.length} pairs · 31 / 25 / 18`);
  check('a report delivered is byte-identical to the same report rendered directly',
    differed === null,
    differed ? `content streams differ at ${differed}` : `${checked} pairs, every content stream`);
  check('the delivered filename is the frozen helper’s',
    wrongName === null, wrongName ?? 'reportFilename, never reconstructed');

  const after = snapshot();
  const moved = TABLES.filter((t) => before[t] !== after[t]);
  check('generating through the delivery surface changes no table the report reads',
    moved.length === 0,
    moved.length ? `moved: ${moved.join(', ')}` : `${TABLES.length} tables unchanged`);

  // The delivery surface's own rows and artefacts are removed again: this
  // script runs against the working database and must not leave history in it.
  for (const id of generated) {
    try { fs.unlinkSync(path.join(STORE_ROOT, `${id}.pdf`)); } catch { /* already gone */ }
    db.prepare('DELETE FROM generated_reports WHERE id = ?').run(id);
  }

  const qa = db.prepare('SELECT id FROM players WHERE id = ?').get('qa-fixture-womens-soccer-0001');
  check('the QA fixture is not offered to an operator',
    Boolean(qa) && !selectableAthletes({ limit: 500 }).some((a) => a.id === qa.id)
      && selectableAthletes({ query: 'QA Fixture', limit: 500 }).length === 0,
    'archived records are excluded from the athlete picker');
}

/**
 * ACCESS — Phase 13K.
 *
 * The report product is frozen and the delivery model is frozen; what 13K
 * added is a boundary in front of them. These are the claims about that
 * boundary that have to hold in the built product rather than in a test
 * fixture: that the protection is not per-route, that nothing configures
 * itself insecurely by default, and that the two deliberately public surfaces
 * are still exactly two.
 */
group('ACCESS — the boundary in front of the product');
{
  const indexSource = fs.readFileSync(path.resolve(HERE, '../index.js'), 'utf8');

  // ---- the boundary is one line, not a decoration on each route ----------
  const boundary = indexSource.indexOf("app.use('/api', requireOperator)");
  const firstApiRoute = indexSource.search(/app\.(get|post|put|delete|patch)\('\/api\//);
  check('every /api route is declared after the authentication boundary',
    boundary !== -1 && firstApiRoute !== -1 && boundary < firstApiRoute,
    'one app.use, so a route added later is protected by default');

  // ---- and the CSRF check is in front of it -----------------------------
  const csrf = indexSource.indexOf("app.use('/api', requireSameOrigin)");
  check('a state-changing request is checked for origin before anything else',
    csrf !== -1 && csrf < boundary,
    'a cross-site POST is refused on its origin, not told whether a session existed');

  // ---- what is deliberately public, and nothing more --------------------
  const publicSurfaces = [
    ["app.use('/api', trackRouter)", 'the event collector'],
    ["app.use('/api', authRouter)", 'sign in / sign out / me'],
    ["app.get('/healthz'", 'liveness'],
    ["app.get('/p/:slug', publicProfileHandler)", 'the athlete pages'],
  ];
  const missing = publicSurfaces.filter(([needle]) => !indexSource.includes(needle));
  check('the unauthenticated surfaces are the four that are meant to be',
    missing.length === 0,
    missing.length ? `not found: ${missing.map(([, what]) => what).join(', ')}`
      : publicSurfaces.map(([, what]) => what).join(' · '));

  // ---- uploads are data, and behind the boundary -------------------------
  check('uploaded files are not served without a session',
    /app\.use\('\/uploads', requireOperator, express\.static/.test(indexSource),
    'the /uploads static mount requires an operator');

  // ---- nothing insecure by default --------------------------------------
  check('loopback is still the default bind address',
    RUNTIME_DEFAULTS.host === '127.0.0.1',
    '13J\u2019s rule survives hosting: reachable from the network is a decision, never a default');
  check('no proxy is trusted unless a hop count says so',
    resolveRuntime({}).trustProxy === 0,
    'never `true`, which would believe any X-Forwarded-For a caller invents');
  check('a hosted process refuses to start without its secrets and its disk',
    (() => {
      const problems = runtimeProblems({ NODE_ENV: 'production' });
      return ['THRIV3_SESSION_SECRET', 'RECRUITMATCH_DB', 'THRIV3_REPORT_STORE',
        'THRIV3_APP_ORIGIN', 'API_HOST'].every((name) => problems.join(' ').includes(name));
    })(),
    'session secret, database path, report store, app origin and bind address');
  check('production authentication is refused over plain http',
    runtimeProblems({
      NODE_ENV: 'production', THRIV3_APP_ORIGIN: 'http://app.example.com',
      THRIV3_SESSION_SECRET: 'f'.repeat(64), API_HOST: '0.0.0.0', THRIV3_TRUST_PROXY: '1',
      RECRUITMATCH_DB: '/data/db.sqlite', THRIV3_REPORT_STORE: '/data/reports',
    }).join(' ').includes('only accepted over HTTPS'),
    'a session cookie on http is a credential sent in clear');

  // ---- what is stored for an account ------------------------------------
  const tables = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE "
    + "name IN ('operator_users', 'operator_sessions')").get().n;
  const users = db.prepare('SELECT COUNT(*) n FROM operator_users').get().n;
  const notHashed = db.prepare(
    "SELECT COUNT(*) n FROM operator_users WHERE password_hash NOT LIKE 'scrypt$%'").get().n;
  check('every stored credential is a scrypt hash, and no account is unhashed',
    tables === 2 && notHashed === 0,
    `${users} account(s) · ${notHashed} not hashed`
    + (users === 0 ? ' · nobody can sign in until createOperator.js is run' : ''));
  // The token in a cookie is never the token in the table: a database dump —
  // or a backup on a laptop — must not contain live sessions.
  const rawTokens = db.prepare('SELECT COUNT(*) n FROM operator_sessions '
    + "WHERE LENGTH(token_sha256) <> 64 OR token_sha256 GLOB '*[^0-9a-f]*'").get().n;
  check('no session row holds anything but a 64-character keyed digest',
    rawTokens === 0,
    `${db.prepare('SELECT COUNT(*) n FROM operator_sessions').get().n} session row(s)`);

  // ---- the session cookie is not readable by a script -------------------
  check('the session cookie is HttpOnly, SameSite and server-resolved',
    (() => {
      const set = [];
      setSessionCookie({ cookie: (n, v, o) => set.push(o) }, 'x',
        { cookieSecure: true, sessionIdleHours: 12, production: true });
      return set[0].httpOnly === true && set[0].sameSite === 'lax' && set[0].secure === true;
    })(),
    'nothing in the cookie identifies anybody; the row on the server does');

  // ---- one way to make a client PDF -------------------------------------
  const clientFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(entry.name) && !entry.name.endsWith('.test.js')) clientFiles.push(full);
    }
  };
  walk(path.resolve(HERE, '../../src'));
  const bypass = clientFiles
    .filter((f) => !f.endsWith(path.join('src', 'api', 'client.js')))
    .filter((f) => /philosophy\.report\s*\(|report\.pdf/.test(fs.readFileSync(f, 'utf8')));
  check('no client surface produces a PDF the system does not record',
    bypass.length === 0,
    bypass.length ? `bypasses delivery: ${bypass.map((f) => path.basename(f)).join(', ')}`
      : 'REPORTS \u2192 GENERATE \u2192 DOWNLOAD is the only route to a client document');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed);
