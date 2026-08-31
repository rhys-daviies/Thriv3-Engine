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

// ---------------------------------------------------------------------------

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed);
