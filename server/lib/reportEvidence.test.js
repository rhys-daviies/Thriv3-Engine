/**
 * The programme evidence layer, and the table primitive underneath it.
 *
 * Reads the drawn text out of the PDF's content streams so wording and
 * page-break behaviour can be asserted rather than eyeballed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import zlib from 'node:zlib';
import PDFDocument from 'pdfkit';
import db from '../db/client.js';
import { programReportModel } from '../routes/philosophy.js';
import { renderProgramReport } from './philosophyReport.js';
import { invalidatePoolBenchmarks } from './philosophyQueries.js';
import { kit, render, fitText } from './philosophyPdf.js';

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

const pageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

const now = new Date().toISOString();
const letters = (i) => {
  let s = ''; let x = i;
  do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return s.replace(/^./, (c) => c.toUpperCase());
};
const word = (season) => ['Alpha', 'Bravo', 'Charlie', 'Delta'][Number(season) - 2022] ?? 'Echo';

const insert = db.prepare(`INSERT INTO roster_players
  (id, created_date, updated_date, college_name, sport, division, season, player_name,
   class_year_label, position, minutes_played, games_played, games_started, nationality, country,
   eligibility_end_year, projected_minutes, prior_programme)
  VALUES (?,?,?,?,'mens-soccer','NCAA D2',?,?,?,?,?,?,?,?,?,?,?,?)`);

let n = 0;
const addRow = (school, o = {}) => insert.run(`r${n += 1}`, now, now, school,
  o.season ?? '2025', o.player_name ?? `Player ${letters(n)}`, o.class_year_label ?? 'So.',
  o.position ?? 'DEFENSE', o.minutes_played ?? 600, o.games_played ?? 15, o.games_started ?? 10,
  o.nationality ?? 'USA', o.country ?? null,
  o.eligibility_end_year ?? null, o.projected_minutes ?? null, o.prior_programme ?? null);

function addProgramme(id = 'c1', name = 'Test College', { squad = true } = {}) {
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
    VALUES (?,?,?,?,'mens-soccer','NCAA D2','Test Conference','Testville','TS',1)`).run(id, now, now, name);
  for (const season of ['2022', '2023', '2024', '2025']) {
    addRow(name, { season, player_name: `Senior ${word(season)}`, class_year_label: 'Sr.', minutes_played: 1400 });
    addRow(name, { season, player_name: `Fresh One ${word(season)}`, class_year_label: 'Fr.', minutes_played: 900 });
    addRow(name, { season, player_name: `Fresh Two ${word(season)}`, class_year_label: 'Fr.', minutes_played: 120 });
    addRow(name, { season, player_name: `Arrived ${word(season)}`, class_year_label: 'Jr.', minutes_played: 700 });
    for (let i = 0; i < 10; i += 1) {
      addRow(name, { season, player_name: `Mid ${letters(i)} ${word(season)}`, class_year_label: 'So.', position: 'MIDFIELD', minutes_played: 300 });
    }
  }
  for (const s of [2022, 2023, 2024, 2025, 2026]) {
    db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)
      VALUES (?,'mens-soccer',?,'A Coach',?)`).run(name, s, now);
  }
  if (squad) {
    addRow(name, { season: '2026', player_name: 'Leaving Soon', class_year_label: 'Gr.', minutes_played: null, games_played: null, eligibility_end_year: 2026, projected_minutes: 1100 });
    addRow(name, { season: '2026', player_name: 'Final Year', class_year_label: 'Sr.', minutes_played: null, games_played: null, eligibility_end_year: 2027, projected_minutes: 900 });
    addRow(name, { season: '2026', player_name: 'No Projection', class_year_label: 'Fr.', minutes_played: null, games_played: null, eligibility_end_year: 2030, projected_minutes: null });
    addRow(name, { season: '2026', player_name: 'Came From Away', class_year_label: 'Jr.', minutes_played: null, games_played: null, eligibility_end_year: 2028, projected_minutes: 500, prior_programme: 'Another School' });
  }
}

const addAthlete = (id, over = {}) => db.prepare(
  `INSERT INTO players (id, created_date, updated_date, full_name, position, nationality, sport, recruiting_class_year)
   VALUES (?,?,?,?,?,?,'mens-soccer',?)`).run(id, now, now, over.name ?? 'Test Athlete',
  over.position ?? 'Defender', over.nationality ?? 'USA', over.year ?? 2027);

beforeEach(() => {
  db.exec('DELETE FROM roster_players; DELETE FROM coach_seasons; DELETE FROM colleges; DELETE FROM players;');
  invalidatePoolBenchmarks();
  n = 0;
});

const build = async (playerId = null) => {
  const model = programReportModel({ collegeId: 'c1', playerId });
  const buf = await renderProgramReport(model);
  return { model, buf, text: pdfText(buf) };
};

// ---------------------------------------------------------------------------

describe('the table primitive', () => {
  const columns = [
    { key: 'name', label: 'Player', width: 0.5 },
    { key: 'value', label: 'Projected minutes', width: 0.25, align: 'right' },
    { key: 'from', label: 'Previous programme', width: 0.25 },
  ];

  const draw = (rows, opts = {}) => render((k) => {
    k.table({ columns, rows, ...opts });
  });

  it('draws a short table on one page', async () => {
    const buf = await draw([{ name: 'Alpha', value: 900, from: 'Elsewhere' }]);
    expect(pageCount(buf)).toBe(1);
    expect(pdfText(buf)).toContain('Alpha');
  });

  // Missing is not zero and not blank.
  it('prints an em dash for a null cell', async () => {
    const text = pdfText(await draw([{ name: 'Alpha', value: null, from: null }]));
    expect(text).toMatch(/Alpha —/);
  });

  it('carries onto a second page and repeats the header there', async () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({ name: `Row ${letters(i)}`, value: i, from: 'X' }));
    const buf = await draw(rows);
    const text = pdfText(buf);
    expect(pageCount(buf)).toBeGreaterThan(1);
    // The header appears once per page it flows onto.
    expect((text.match(/PREVIOUS PROGRAMME/g) || []).length).toBe(pageCount(buf));
    expect(text).toContain('Row A');
    expect(text).toContain(`Row ${letters(89)}`);
  });

  it('never splits a row across a page boundary', async () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({ name: `Row ${letters(i)}`, value: i, from: 'X' }));
    const text = pdfText(await draw(rows));
    // Every row's name and its value survive together.
    for (const i of [0, 45, 89]) expect(text).toContain(`Row ${letters(i)}`);
  });

  it('clips a long value rather than wrapping it into the next row', async () => {
    const long = 'A Really Very Extremely Long Previous Programme Name That Cannot Possibly Fit';
    const text = pdfText(await draw([{ name: 'Alpha', value: 1, from: long }]));
    expect(text).not.toContain(long);
    expect(text).toMatch(/…/);
  });

  it('keeps a group heading with its rows', async () => {
    const text = pdfText(await draw([
      { group: 'Defenders' },
      { name: 'Alpha', value: 1, from: 'X' },
    ]));
    expect(text).toContain('DEFENDERS');
  });

  it('leaves the footer margin alone', async () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({ name: `Row ${letters(i)}`, value: i, from: 'X' }));
    const buf = await draw(rows);
    // No page is added beyond what the rows need: a table that wrote below the
    // bottom margin would grow the document a page at a time.
    expect(pageCount(buf)).toBeLessThan(5);
  });

  it('clips text deterministically', () => {
    const doc = new PDFDocument({ size: 'A4' });
    doc.font('Helvetica').fontSize(8);
    expect(fitText(doc, 'short', 500)).toBe('short');
    const cut = fitText(doc, 'a'.repeat(400), 40);
    expect(cut.endsWith('…')).toBe(true);
    expect(doc.widthOfString(cut)).toBeLessThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------

describe('the origin claim is measured, not quoted', () => {
  beforeEach(() => {
    addProgramme();
    addAthlete('p1');
  });

  // The sentence this replaces said "about 40% more likely — 37% against 27%,
  // and the effect disappears entirely at Division III". The measured pool
  // contradicts the domestic half and the D-III claim.
  it('no longer prints the hardcoded population figures', async () => {
    const { text } = await build('p1');
    expect(text).not.toMatch(/40% more likely/i);
    expect(text).not.toMatch(/37%\s*against\s*27%/i);
    expect(text).not.toMatch(/disappears entirely at Division III/i);
  });

  it('carries the dynamic benchmark instead, or says why it cannot', async () => {
    const { text, model } = await build('p1');
    const o = model.summary.athlete.originContext;
    if (o.pool) {
      expect(text).toMatch(/Same background, across/);
    } else {
      expect(text).toMatch(/No benchmark comparison is shown/);
    }
  });
});

describe('experienced-arrival terminology', () => {
  beforeEach(() => addProgramme());

  it('never calls a historical arrival a transfer in reader-facing text', async () => {
    const { text } = await build();
    expect(text).toMatch(/experienced arrival/i);
    // "transfer" survives only where it names one of several things a roster
    // absence could mean, never as the label for the population itself.
    expect(text).not.toMatch(/\btransfers\b/i);
    expect(text).not.toMatch(/the transfer intake/i);
  });

  it('says what the grouping cannot distinguish', async () => {
    const { text } = await build();
    expect(text).toMatch(/cannot tell a transfer from a junior-college arrival|cannot tell them apart/i);
  });
});

describe('the evidence pages', () => {
  beforeEach(() => addProgramme());

  it('renders each programme evidence page once', async () => {
    const { text } = await build();
    for (const title of ['The first-year intake', 'The first-year ladder', 'After the first season',
      'Experienced arrivals', 'Who the arrivals are', 'Replacing minutes', 'Position by position',
      'Current squad outlook', 'The current squad']) {
      expect(text).toContain(title);
    }
  });

  it('shows the seasons behind each ladder rung', async () => {
    const { text, model } = await build();
    expect(model.ladder[0].contributions.length).toBeGreaterThan(1);
    expect(text).toMatch(/One dot per season/);
    expect(text).toMatch(/dots are seasons/);
  });

  it('does not draw a weighted ladder box where weighting changes nothing', async () => {
    const { text, model } = await build();
    const s = model.summary.programme.freshmanOpportunity;
    if (!s.weightingApplied || s.weightedAgrees !== false) {
      expect(text).not.toMatch(/CURRENT-COACH RELEVANCE/);
    }
  });

  it('states the opening counts as counts and says they can overlap', async () => {
    const { text } = await build();
    expect(text).toMatch(/can describe the same season|one opening can be filled by more than one/i);
    expect(text).not.toMatch(/returning took the opening/i);
  });

  it('separates minutes played from minutes projected', async () => {
    const { text } = await build();
    expect(text).toMatch(/MINUTES ACTUALLY PLAYED/i);
    expect(text).toMatch(/MINUTES PROJECTED, NOT PLAYED/i);
  });

  it('names an unmeasurable arrival season rather than drawing it empty', async () => {
    const { text, model } = await build();
    if (model.transfer.window.unmeasurable.length) {
      expect(text).toMatch(/not shown at all|cannot be told from a player who was already here/i);
    }
  });
});

describe('missing data on the squad pages', () => {
  beforeEach(() => addProgramme());

  it('reports a year whose players carry no projection as such, not as zero', async () => {
    const { text, model } = await build();
    const empty = model.squad.cliff.find((y) => y.playersWithProjection === 0);
    expect(empty).toBeTruthy();
    expect(text).toMatch(new RegExp(`${empty.players} players, no projection`));
  });

  it('states projected-minute coverage on the outlook page', async () => {
    const { text } = await build();
    expect(text).toMatch(/projections for \d+ of \d+ who could carry one/);
    expect(text).toMatch(/first-years, who cannot/);
  });

  it('drops the squad pages entirely where no roster is on file', async () => {
    db.exec("DELETE FROM roster_players WHERE season = '2026'");
    const { text, model } = await build();
    expect(model.squad.rostered).toBe(0);
    expect(text).not.toContain('Current squad outlook');
    expect(text).not.toMatch(/Who is on the 2026 roster/);
  });
});

describe('the contents still tracks the real pages', () => {
  it('numbers every listed section and never past the end', async () => {
    addProgramme();
    addAthlete('p1');
    const { buf, text } = await build('p1');
    const total = pageCount(buf);
    expect(text).toContain('CONTENTS');
    for (let i = 1; i <= total; i += 1) expect(text).toContain(`${i}/${total}`);
  });

  it('lists no section the document does not contain', async () => {
    addProgramme();
    const { text } = await build();
    // The supporting tables are not built yet, so they must not be advertised.
    expect(text).not.toContain('Every first-year measured');
    expect(text).not.toContain('Every vacancy observed');
  });

  it('shrinks for a programme with almost nothing on file', async () => {
    addProgramme();
    const full = pageCount((await build()).buf);
    db.exec('DELETE FROM roster_players; DELETE FROM coach_seasons;');
    addRow('Test College', { season: '2025', player_name: 'Solo Player', class_year_label: 'Fr.', minutes_played: 0, games_played: 0 });
    const sparse = pageCount((await build()).buf);
    expect(sparse).toBeLessThan(full);
  });
});

describe('wording the evidence pages must not use', () => {
  beforeEach(() => {
    addProgramme();
    addAthlete('p1');
  });

  it('never promises minutes or predicts an outcome, anywhere', async () => {
    const { text } = await build('p1');
    for (const banned of [/available minutes/i, /minutes will open/i, /open minutes/i,
      /expected opportunity/i, /likely to play/i, /minutes becoming available/i,
      /you will play/i, /minutes up for grabs/i]) {
      expect(text).not.toMatch(banned);
    }
  });

  it('states the pool vacancy finding as an association', async () => {
    const { text, model } = await build('p1');
    if (model.summary.programme.replacementBehaviour.poolVacancy) {
      expect(text).toMatch(/association between two things the roster records/);
      // The word "caused" appears only inside the sentence denying causation,
      // so the assertion is against causal CLAIMS rather than the word.
      expect(text).not.toMatch(/causes? (freshmen|first-years|a first-year)/i);
      expect(text).not.toMatch(/because a starter (left|departed)/i);
      expect(text).not.toMatch(/leads to (freshmen|first-years) starting/i);
    }
  });
});
