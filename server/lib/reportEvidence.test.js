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
import { invalidateLifecyclePool } from './lifecycleQueries.js';
import { kit, render, fitText, charts } from './philosophyPdf.js';

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

/**
 * The Albertus Magnus shape: three seasons that published no minutes, and one
 * where the importer assumed a zero for every player on the roster.
 */
function addFabricatedProgramme(name = 'Test College') {
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
    VALUES ('c1',?,?,?,'mens-soccer','NCAA D2','Test Conference','Testville','TS',1)`).run(now, now, name);
  const unpublished = db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name,
     class_year_label, position, minutes_played, games_played, games_started)
    VALUES (?,?,?,?,'mens-soccer','NCAA D2',?,?,?,'DEFENSE',NULL,NULL,NULL)`);
  for (const season of ['2022', '2023', '2024']) {
    for (let i = 0; i < 30; i += 1) {
      unpublished.run(`u${season}${i}`, now, now, name, season,
        `Unpublished ${letters(i)} ${word(season)}`, i < 8 ? 'Fr.' : 'Jr.');
    }
  }
  for (let i = 0; i < 32; i += 1) {
    addRow(name, {
      season: '2025', player_name: `Assumed ${letters(i)}`,
      class_year_label: i < 12 ? 'Fr.' : 'Sr.', minutes_played: 0, games_played: 0, games_started: 0,
    });
  }
  for (const s of [2022, 2023, 2024, 2025, 2026]) {
    db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)
      VALUES (?,'mens-soccer',?,'A Coach',?)`).run(name, s, now);
  }
}

beforeEach(() => {
  db.exec('DELETE FROM roster_players; DELETE FROM coach_seasons; DELETE FROM colleges; DELETE FROM players;');
  invalidatePoolBenchmarks();
  // The lifecycle pool is cached per sport per process too, and these suites
  // rebuild the database between tests.
  invalidateLifecyclePool();
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

  // A repeated column header is not an identity.
  it('carries its title onto a continuation page', async () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({ name: `Row ${letters(i)}`, value: i, from: 'X' }));
    const buf = await draw(rows, { continued: 'The supporting table' });
    const text = pdfText(buf);
    expect(pageCount(buf)).toBeGreaterThan(1);
    expect((text.match(/The supporting table/g) || []).length).toBe(pageCount(buf) - 1);
    expect(text).toContain('CONTINUED');
  });

  it('does not put a continuation heading on a table that fits', async () => {
    const text = pdfText(await draw([{ name: 'Alpha', value: 1, from: 'X' }],
      { continued: 'The supporting table' }));
    expect(text).not.toContain('CONTINUED');
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

  // Gating an empty column: opt-in, emptiness only, never a column of zeros.
  describe('empty-column gating', () => {
    const gated = [
      { key: 'name', label: 'Player', width: 0.5 },
      { key: 'value', label: 'Projected minutes', width: 0.25, align: 'right' },
      { key: 'from', label: 'Previous programme', width: 0.25, dropWhenEmpty: true },
    ];
    const drawGated = (rows, opts = {}) => render((k) => {
      k.table({ columns: gated, rows, ...opts });
    });

    it('omits a droppable column where every row is null for it', async () => {
      const text = pdfText(await drawGated([
        { name: 'Alpha', value: 900, from: null },
        { name: 'Bravo', value: 800, from: null },
      ]));
      expect(text).not.toContain('PREVIOUS PROGRAMME');
      expect(text).toContain('PLAYER');
      expect(text).toContain('PROJECTED MINUTES');
    });

    it('keeps the column where a single row records a value', async () => {
      const text = pdfText(await drawGated([
        { name: 'Alpha', value: 900, from: null },
        { name: 'Bravo', value: 800, from: 'Elsewhere' },
      ]));
      expect(text).toContain('PREVIOUS PROGRAMME');
      expect(text).toContain('Elsewhere');
      // The null row still shows a dash rather than a blank.
      expect(text).toMatch(/Alpha 900 —/);
    });

    it('does not drop a column that is entirely zero', async () => {
      const text = pdfText(await drawGated([{ name: 'Alpha', value: 0, from: 0 }]));
      expect(text).toContain('PREVIOUS PROGRAMME');
    });

    it('leaves a column without the flag alone when it is empty', async () => {
      const text = pdfText(await draw([{ name: 'Alpha', value: null, from: null }]));
      expect(text).toContain('PREVIOUS PROGRAMME');
    });

    it('shares the freed width among the surviving columns', async () => {
      // A name that fits only once the dropped column's width is reallocated.
      const name = 'A Player Name Of Some Considerable Length Indeed Yes';
      const kept = pdfText(await drawGated([{ name, value: 900, from: null }]));
      const lost = pdfText(await drawGated([{ name, value: 900, from: 'Elsewhere' }]));
      expect(kept.length).toBeGreaterThan(lost.length - name.length);
      expect(kept).toContain('A Player Name Of Some Considerable');
    });

    it('tells the note which columns were dropped', async () => {
      const text = pdfText(await drawGated([{ name: 'Alpha', value: 1, from: null }], {
        note: ({ dropped }) => (dropped.includes('from') ? 'column omitted' : 'column shown'),
      }));
      expect(text).toContain('column omitted');
    });

    it('ignores group heading rows when deciding emptiness', async () => {
      const text = pdfText(await drawGated([
        { group: 'Defenders' },
        { name: 'Alpha', value: 1, from: null },
      ]));
      expect(text).not.toContain('PREVIOUS PROGRAMME');
    });
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
    for (const title of ['How much first-years actually play',
      'How players develop after they arrive',
      'Players brought in ready to play', 'Replacing minutes', 'Position by position',
      'The squad you would be joining', 'The current squad in full']) {
      expect(text).toContain(title);
    }
  });

  it('no longer carries the year-one-to-year-two page it replaced', async () => {
    const { text, model } = await build();
    // "After the first season" answered a narrower question than the page that
    // replaced it, and the two side by side would have been two development
    // models disagreeing about their own denominators.
    expect(text).not.toContain('After the first season');
    // Narrowed in Phase 9B: the squad-usage page labels a row "Second year",
    // and the thing this test guards is the retired PAGE, not the phrase.
    expect(text).not.toMatch(/what happened in their second year/i);
    expect(model.sections.map((s2) => s2.id)).not.toContain('freshman-progression');
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

  // The two populations are now on two different pages — historical arrivals in
  // the squad-construction story, the current arrivals with the current squad —
  // so the distinction is made by placement as well as by wording. Both
  // statements still have to be in the document.
  it('separates minutes played from minutes projected', async () => {
    const { text } = await build();
    expect(text).toMatch(/Minutes they went on to play here — historical, not projected/i);
    // And the current side names its own scale, on the squad page.
    expect(text).toMatch(/PROJECTED MINUTES/i);
    expect(text).toMatch(/ARRIVED FOR 2026/i);
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

  // The column chart that used to carry a hatched bar for these years is gone —
  // the table below it said the same thing with more in it — so the claim is now
  // made by the table's own no-projection column and the note under it.
  it('reports a year whose players carry no projection as such, not as zero', async () => {
    const { text, model } = await build();
    const empty = model.squad.cliff.find((y) => y.playersWithProjection === 0);
    expect(empty).toBeTruthy();
    expect(text).toMatch(/A year with no projected minutes is a year whose players hold none/);
    expect(text).toMatch(/first-year, whose minutes would have to be carried forward/);
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
    expect(text).not.toContain('The squad you would be joining');
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
    const { text, model } = await build();
    // The appendices exist now, so the rule is the general one: every title
    // the contents lists must also appear as a page in the document.
    for (const s of model.sections) {
      if (s.page == null) continue;
      expect(text).toContain(s.title);
    }
    // The current-squad appendix is deliberately not registered: page twelve
    // already carries the complete roster with the same fields.
    expect(model.sections.some((s) => s.id === 'table-current-squad')).toBe(false);
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

/**
 * Helvetica is a standard font here, so pdfkit encodes text as WinAnsi. A
 * character outside that set does not fail — it prints as stray punctuation,
 * which is how an arrow in the eligibility column became "!'" and a
 * not-equals sign in the methodology callout became a quotation mark.
 */
describe('every character the report draws can be drawn', () => {
  it('uses no glyph outside WinAnsi', async () => {
    addProgramme();
    addAthlete('p1');
    const { text } = await build('p1');
    const unsupported = [...new Set([...text].filter((ch) => {
      const c = ch.codePointAt(0);
      if (c < 0x100) return false;
      // The punctuation WinAnsi does carry, which the extractor maps back.
      return !'…‘’“”–—·€™š›œžŸƒ†‡ˆ‰Š‹Œ•'.includes(ch);
    }))];
    expect(unsupported).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — athlete evidence, appendices, methodology
// ---------------------------------------------------------------------------

describe('the athlete evidence layer', () => {
  beforeEach(() => addProgramme());

  it('is absent entirely from a programme report', async () => {
    const { text, model } = await build();
    expect(model.sections.some((s) => s.scope === 'athlete')).toBe(false);
    for (const title of ['Your arrival window', 'When a place opens at', 'Where you are arriving from']) {
      expect(text).not.toContain(title);
    }
  });

  it('renders each athlete page once for an athlete report', async () => {
    addAthlete('p1');
    const { text } = await build('p1');
    // 13F consolidated two pairs. Every question they answered is still
    // answered; two of them are answered under one head.
    expect(text).toMatch(/What Thriv3 sees for you/);
    expect(text).toMatch(/Your position, and the timing around your arrival/);
    expect(text).toMatch(/When a place opens at defender/i);
    expect(text).toMatch(/What this position has looked like here/);
    expect(text).toMatch(/First-year defenders/i);
    expect(text).toMatch(/Where you are arriving from/);
    // And the pages they replaced are gone rather than duplicated.
    expect(text).not.toMatch(/Your arrival window, 2027/);
    expect(text).not.toMatch(/Defenders at this programme/);
  });

  // The comparison it replaced put a results-derived rating out of 100 beside
  // a self-entered level out of 10 and then disclaimed itself.
  it('no longer prints the level comparison', async () => {
    addAthlete('p1');
    const { text } = await build('p1');
    expect(text).not.toMatch(/Your stated level/i);
    expect(text).not.toMatch(/of 10\b/);
    expect(text).not.toMatch(/These two are not the same measurement/i);
  });

  it('names the cohort it actually used when narrowing was widened', async () => {
    addAthlete('p1');
    const { text, model } = await build('p1');
    const cohort = model.fit?.cohort;
    if (cohort?.refused) {
      expect(text).toMatch(/We could not read your exact group here/);
    } else if (cohort && !cohort.applied) {
      expect(text).toMatch(/too few first-years in your own group/);
    }
  });

  it('states opening outcomes as overlapping counts', async () => {
    addAthlete('p1');
    const { text } = await build('p1');
    expect(text).toMatch(/These two counts can describe the same season/);
    expect(text).not.toMatch(/replacement winner|who won the place/i);
  });

  it('accounts for players with no eligibility year rather than dropping them', async () => {
    addAthlete('p1');
    const { text, model } = await build('p1');
    const a = model.summary.athlete;
    // The three eligibility bands account for everyone, and the players with
    // no year recorded are named in the note rather than folded into a band.
    expect(text).toMatch(/BEFORE ENTRY|FINAL SEASON AT ENTRY|BEYOND ENTRY/);
    const placed = a.currentPlayersEligibleAtEntry.length
      + a.currentPlayersEligibilityEndsBeforeEntry.length
      + a.currentPlayersEligibilityUnknown.length;
    expect(placed).toBe(a.currentPositionPlayers.length);
  });

  it('exposes the beyond-entry group as its own aggregate', async () => {
    addAthlete('p1');
    const { model } = await build('p1');
    const a = model.summary.athlete;
    expect(a.currentPlayersBeyondEntry).toBeTruthy();
    expect(a.currentProjectedMinutesOfPlayersBeyondEntry).toBeTruthy();
    // The final-season group and the beyond-entry group partition those
    // eligible at entry.
    expect(a.currentPlayersInFinalSeasonAtEntry.length + a.currentPlayersBeyondEntry.length)
      .toBe(a.currentPlayersEligibleAtEntry.length);
  });

  it('refuses an origin comparison the programme cannot support, without borrowing the pool', async () => {
    addAthlete('p1');
    const { text, model } = await build('p1');
    const o = model.summary.athlete.originContext;
    if (!o.evidence.sufficient) {
      expect(text).toMatch(/Not enough programme-specific history to compare by origin/);
      expect(text).toMatch(/context, not a substitute/);
    }
  });
});

/**
 * The vocabulary, checked against what is actually drawn.
 *
 * Every one of these was inconsistent somewhere before this pass, and the
 * inconsistency is invisible in the source because the model's own field names
 * are `freshman` and `transfer` — which is correct, and exactly why a check on
 * the source would not catch it. This one reads the PDF.
 */
describe('reader-facing wording', () => {
  const both = async () => {
    addProgramme();
    addAthlete('p1');
    const generic = (await build()).text;
    const athlete = (await build('p1')).text;
    return [generic, athlete];
  };

  it('never says freshman or freshmen to the reader', async () => {
    for (const text of await both()) {
      expect(text).not.toMatch(/freshm[ae]n/i);
      expect(text).toMatch(/first-year/i);
    }
  });

  it('says experienced arrival, and names a transfer only where it disclaims it', async () => {
    for (const text of await both()) {
      expect(text).toMatch(/experienced arrival/i);
      // The only permitted uses are the two sentences that exist to say the
      // roster cannot tell a transfer from any other route in.
      for (const hit of text.match(/.{0,40}\btransfers?\b.{0,40}/gi) ?? []) {
        expect(hit).toMatch(/cannot (tell|reliably separate)/i);
      }
    }
  });

  it('uses the same apostrophe in a starter’s season everywhere', async () => {
    for (const text of await both()) {
      expect(text).toMatch(/starter’s season/);
      expect(text).not.toMatch(/starter's season/);
    }
  });

  it('names the three temporal groups identically wherever they appear', async () => {
    const [, athlete] = await both();
    for (const label of ['BEFORE ENTRY', 'FINAL SEASON AT ENTRY', 'BEYOND ENTRY']) {
      expect(athlete).toContain(label);
    }
  });

  it('says programme, not program, outside the report’s own name', async () => {
    for (const text of await both()) {
      // Nothing is exempt any more: the cover used to say PROGRAM INTELLIGENCE
      // REPORT and now says PROGRAMME INTELLIGENCE, so the whole document
      // spells it the same way.
      expect(text.match(/\bprogram\b/gi) ?? []).toEqual([]);
      expect(text).toMatch(/programme/i);
    }
  });
});

describe('the supporting record', () => {
  beforeEach(() => addProgramme());

  it('builds the appendices that carry names the charts do not', async () => {
    const { text, model } = await build();
    const ids = model.sections.map((s) => s.id);
    expect(ids).toContain('table-freshmen');
    expect(ids).toContain('table-vacancies');
    expect(text).toContain('Every first-year measured');
    expect(text).toContain('Every opening observed');
  });

  // Page twelve already lists every player with every field the appendix
  // would, so a second copy would pad the document rather than open it up.
  it('does not repeat the current squad as an appendix', async () => {
    const { text, model } = await build();
    expect(model.sections.some((s) => s.id === 'table-current-squad')).toBe(false);
    expect((text.match(/The current squad in full/g) || []).length).toBeLessThanOrEqual(2);
  });

  it('omits an appendix too small to add anything', async () => {
    db.exec("DELETE FROM roster_players WHERE class_year_label = 'Jr.' AND season != '2026'");
    const { model } = await build();
    const ids = model.sections.map((s) => s.id);
    if (model.transfer.points.length < 6) expect(ids).not.toContain('table-experienced-arrivals');
  });

  it('never infers a source for an arrival', async () => {
    const { text } = await build();
    expect(text).toMatch(/No source is inferred/);
  });

  // A whole column of dashes is a field this source does not carry, not a
  // fact about any of the players in it.
  it('omits the previous-programme column where no arrival records one', async () => {
    const { text } = await build();
    expect(text).toMatch(/Every experienced arrival measured/);
    expect(text).toMatch(/that column is not shown/);
    expect(text).not.toMatch(/STARTS PREVIOUS PROGRAMME/);
  });

  it('keeps the previous-programme column where one arrival records one', async () => {
    addRow('Test College', {
      season: '2025', player_name: 'Known Source', class_year_label: 'Jr.',
      minutes_played: 800, prior_programme: 'A Named Programme',
    });
    const { text } = await build();
    expect(text).toContain('A Named Programme');
    expect(text).toMatch(/A dash under Previous programme means the roster did not record one/);
  });

  it('keeps one row per opening rather than one per departing player', async () => {
    const { model } = await build();
    const rows = model.summary.programme.replacementBehaviour.record;
    const keys = rows.map((r) => `${r.transition}|${r.position}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the methodology page', () => {
  beforeEach(() => addProgramme());

  it('carries the three principles and no hardcoded origin figure', async () => {
    const { text } = await build();
    expect(text).toContain('HISTORY IS NOT FORECAST');
    expect(text).toContain('MISSING IS NOT ZERO');
    expect(text).toContain('SAMPLE SIZE MATTERS');
    expect(text).not.toMatch(/37%|27%|40% more likely/);
  });

  it('explains missing data, benchmarks and evidence strength', async () => {
    const { text } = await build();
    expect(text).toMatch(/A blank is not a zero/);
    expect(text).toMatch(/They do not mean good, average or bad/);
    expect(text).toMatch(/not a probability, a confidence interval or a quality score/);
    expect(text).toMatch(/never subtracted from each other/);
  });

  it('replaces the legacy limits page', async () => {
    const { text } = await build();
    expect(text).not.toContain('WHAT THIS CANNOT TELL YOU');
    expect(text).toContain('Methodology and limitations');
  });
});

describe('position intake', () => {
  // Phase 7 productionises the model without designing a page for it. This is
  // the guard on that: the report model carries it, and no section, page or
  // page count moves because of it.
  it('is on the model with its cycles, its history and 2026 apart', async () => {
    addProgramme();
    const { model } = await build();
    expect(model.pressure.available).toBe(true);
    expect(model.pressure.historicalCycles).toEqual(['2023', '2024', '2025']);
    expect(model.pressure.currentCycle).toBe('2026');
    const def = model.pressure.positions.find((p) => p.position === 'DEFENSE');
    expect(def.historical.seasons).toEqual(['2023', '2024', '2025']);
    expect(def.historical.seasons).not.toContain('2026');
    expect(def.current.season).toBe('2026');
  });

  it('adds no section and no page', async () => {
    addProgramme();
    const { model, buf } = await build();
    expect(model.sections.map((s) => s.id).join(',')).not.toMatch(/pressure|intake-per-cycle/);
    expect(pageCount(buf)).toBe(model.sections[model.sections.length - 1].page + 1);
  });

  // Phase 9B renders position intake on an ATHLETE report only. A programme
  // report has no position to be about, and printing all four would be another
  // large table rather than programme-level intelligence.
  it('stays out of a report with no athlete', async () => {
    addProgramme();
    const { text, model } = await build();
    expect(model.sections.map((s) => s.id)).not.toContain('athlete-position-record');
    expect(text).not.toMatch(/recruiting cycle/i);
    expect(text).not.toMatch(/added .* at this position/i);
  });
});

describe('minute concentration and years of study', () => {
  it('is on the model with its seasons, its medians and 2026 absent', async () => {
    addProgramme();
    const { model } = await build();
    const u = model.squadProfile.utilisation;
    expect(u.available).toBe(true);
    expect(u.seasons.map((s) => s.season)).toEqual(['2022', '2023', '2024', '2025']);
    expect(u.medianTop11Share).toBeGreaterThan(0);
    expect(u.medianTop11Share).toBeLessThanOrEqual(1);
    const e = model.squadProfile.experience;
    expect(e.compositionAvailable).toBe(true);
    expect(e.loadSeasons).not.toContain('2026');
    expect(e.groups.map((g) => g.group))
      .toEqual(['YEAR_1', 'YEAR_2', 'YEAR_3', 'YEAR_4', 'GRADUATE', 'UNKNOWN']);
  });

  it('adds no section and no page', async () => {
    addProgramme();
    const { model, buf } = await build();
    // Narrow on purpose: `experienced-arrival-intake` is an existing section
    // and is not what this is guarding against.
    expect(model.sections.map((s) => s.id).join(','))
      .not.toMatch(/utilisation|concentration|minute-share|experience-profile|years-of-study/);
    expect(pageCount(buf)).toBe(model.sections[model.sections.length - 1].page + 1);
  });

  // Phase 9B renders it. The guard that asserted silence has done its job and
  // is replaced by one that asserts the page says what the model holds.
  it('renders the squad-usage page from the model’s own figures', async () => {
    addProgramme();
    const { text, model } = await build();
    const u = model.squadProfile.utilisation;
    const e = model.squadProfile.experience;
    expect(model.sections.map((s) => s.id)).toContain('squad-usage');
    expect(text).toMatch(/how this programme uses its squad/i);
    expect(text).toMatch(/eleven, fourteen and eighteen most-used players/);
    expect(text).toContain(`${Math.round(u.medianTop11Share * 100)}% of the minutes`);
    const y1 = e.groups.find((g) => g.group === 'YEAR_1');
    expect(text).toContain(`${Math.round(y1.rosterShare * 100)}% of the roster`);
    // …and none of the measures Phase 8 rejected as client-facing.
    expect(text).not.toMatch(/share of the roster that appeared|200 minutes|top five/i);
  });

  // The sparse case, end to end: the minutes refuse and the roster does not.
  it('keeps the roster readable by year of study where the minutes are not', async () => {
    addFabricatedProgramme();
    const { model } = await build();
    expect(model.squadProfile.utilisation.available).toBe(false);
    expect(model.squadProfile.experience.compositionAvailable).toBe(true);
    expect(model.squadProfile.experience.loadAvailable).toBe(false);
    expect(model.squadProfile.loadVersusRoster).toBeNull();
  });
});

describe('position utilisation', () => {
  it('is on the model for all three supported positions', async () => {
    addProgramme();
    const { model } = await build();
    const pu = model.positionUtilisation;
    expect(pu.byPosition.map((p) => p.position)).toEqual(['DEFENSE', 'MIDFIELD', 'FORWARD']);
    expect(pu.athletePosition).toBeNull();
    expect(pu.banding.available).toBe(false);
    for (const p of pu.byPosition) {
      expect(p.seasons.map((s) => s.season)).toEqual(['2022', '2023', '2024', '2025']);
      expect(p.seasons.map((s) => s.season)).not.toContain('2026');
    }
  });

  it('uses the athlete’s own position on an athlete report', async () => {
    addProgramme();
    addAthlete('p1', { position: 'Defender' });
    const { model } = await build('p1');
    expect(model.positionUtilisation.athletePosition.position).toBe('DEFENSE');
  });

  // A methodological exclusion, not a missing-data refusal.
  it('tells a goalkeeper the analysis is not reported at their position', async () => {
    addProgramme();
    addAthlete('p1', { position: 'Goalkeeper' });
    const { model } = await build('p1');
    const gk = model.positionUtilisation.athletePosition;
    expect(gk.position).toBe('GOALKEEPER');
    expect(gk.supported).toBe(false);
    expect(gk.reason).toMatch(/not reported for goalkeepers/);
    expect(gk.reason).not.toMatch(/too few|insufficient/i);
    // …and the recruiting pressure at that position is untouched.
    expect(model.pressure.athletePosition.position).toBe('GOALKEEPER');
    expect(model.pressure.athletePosition.historical).toBeTruthy();
  });

  // Same rule: the minute distribution within a position is about the
  // athlete's position, so a programme report does not carry it.
  it('stays out of a report with no athlete', async () => {
    addProgramme();
    const { text, model } = await build();
    expect(model.sections.map((s) => s.id)).not.toContain('athlete-position-record');
    expect(text).not.toMatch(/three-quarters of the minutes/i);
  });

  // The sparse case: the squad's minutes were never read, so every position
  // refuses — while Phase 7's intake at the same positions still answers.
  it('refuses every position where the squad’s minutes are unreadable', async () => {
    addFabricatedProgramme();
    const { model } = await build();
    for (const p of model.positionUtilisation.byPosition) {
      expect(p.supported, p.position).toBe(true);
      expect(p.available, p.position).toBe(false);
      expect(p.seasons.every((s) => !s.readable), p.position).toBe(true);
      expect(p.seasons[0].reason).toMatch(/minutes were published/);
    }
    expect(model.pressure.available).toBe(true);
  });
});

describe('the athlete position record page', () => {
  it('renders both halves from the model’s own figures', async () => {
    addProgramme();
    addAthlete('p1', { position: 'Defender' });
    const { text, model } = await build('p1');
    const intake = model.pressure.athletePosition.historical;
    const util = model.positionUtilisation.athletePosition;
    expect(model.sections.map((s) => s.id)).toContain('athlete-position-record');
    expect(text).toContain('What this position has looked like here');
    expect(text).toMatch(/how often this position has been added to/i);
    expect(text).toContain(`added ${intake.totalIncomingPerCycle.join(', ')} defenders`);
    if (util.available) {
      expect(text).toMatch(/how far the minutes at this position have reached/i);
      expect(text).toContain(`${util.medianPlayersWith600Plus} defenders reached 600 minutes`);
      // The context measure, which is the whole point of carrying it.
      expect(text).toMatch(new RegExp(`out of ${util.medianPlayersWithMinutes} used`));
    }
  });

  // A methodological exclusion has to read as one. The page keeps its intake
  // half and says in one line why the other half is absent.
  it('gives a goalkeeper the intake half and a quiet reason for the rest', async () => {
    addProgramme();
    addAthlete('p1', { position: 'Goalkeeper' });
    const { text, model } = await build('p1');
    expect(model.sections.map((s) => s.id)).toContain('athlete-position-record');
    expect(text).toMatch(/how often this position has been added to/i);
    expect(text).toMatch(/not reported for goalkeepers/);
    expect(text).not.toMatch(/insufficient|too little data|no data/i);
    // …and no empty panel where the other half would have been.
    expect(text).not.toMatch(/not enough on file[\s\S]{0,40}three-quarters/);
  });

  // Every statement about the minutes has to disclose how many seasons it came
  // from. Akron's forwards are two of four.
  it('states the season basis wherever it is short of the seasons on file', async () => {
    addProgramme();
    // One season with a readable position and one without.
    for (let i = 0; i < 6; i += 1) {
      addRow('Test College', {
        season: '2025', player_name: `Thin D ${letters(i)}`, class_year_label: 'Jr.',
        position: 'FORWARD', minutes_played: 900,
      });
    }
    addAthlete('p1', { position: 'Forward' });
    const { text, model } = await build('p1');
    const util = model.positionUtilisation.athletePosition;
    if (util.available && util.readableSeasons < util.seasons.length) {
      expect(text).toMatch(new RegExp(`${util.readableSeasons === 1 ? 'the single season'
        : `the ${util.readableSeasons === 2 ? 'two' : util.readableSeasons} seasons`} of `
        + `${util.seasons.length} on file`));
    }
  });

  // A range with no width prints the single value.
  it('never prints a range of one value against itself', async () => {
    addProgramme();
    addAthlete('p1', { position: 'Defender' });
    const { text } = await build('p1');
    expect(text).not.toMatch(/\b(\d+(?:\.\d)?) to \1\b/);
    expect(text).not.toMatch(/\b(\d+(?:\.\d)?)–\1\b/);
  });

  // The sparse case, end to end: the intake renders and the minutes refuse.
  it('keeps the intake half where the squad’s minutes are unreadable', async () => {
    addFabricatedProgramme();
    addAthlete('p1', { position: 'Defender' });
    const { text, model } = await build('p1');
    expect(model.positionUtilisation.athletePosition.available).toBe(false);
    expect(model.sections.map((s) => s.id)).toContain('athlete-position-record');
    expect(text).toMatch(/how often this position has been added to/i);
    expect(text).toMatch(/minutes were published to read a distribution/);
  });

  it('says nothing that reads as a forecast or a verdict', async () => {
    addProgramme();
    addAthlete('p1', { position: 'Defender' });
    const { text } = await build('p1');
    for (const word of ['open pathway', 'crowded', 'good opportunity', 'high competition',
      'recruited over', 'risk', 'safe pathway', 'strong fit', 'weak fit', 'will play',
      'likely to play', 'aggressive']) {
      expect(text.toLowerCase(), word).not.toContain(word);
    }
  });
});

/**
 * PHASE 9C — the polish pass. Every test here is about what the page SAYS or
 * how it is laid out; none of them touches a model value.
 */
describe('the paired roster and minutes bars', () => {
  const drawBars = (groups) => render((k) => {
    k.doc.addPage();
    charts.splitBars(k, {
      box: k.slot(140), title: null, subtitle: null, groups, max: 50, unit: '%', unavailable: null,
    });
  });

  it('writes what each bar measures on the row it is drawn on', async () => {
    const text = pdfText(await drawBars([
      { label: 'First year', bars: [{ caption: 'Roster', value: 42 }, { caption: 'Minutes', value: 11 }] },
      { label: 'Fourth year', bars: [{ caption: 'Roster', value: 17 }, { caption: 'Minutes', value: 33 }] },
    ]));
    expect(text).toContain('ROSTER');
    expect(text).toContain('MINUTES');
    expect(text).toContain('42%');
    expect(text).toContain('11%');
    // And never the two quantities collapsed into one value, which is what
    // this replaced: "42 · 11%" required a legend to be read at all.
    expect(text).not.toMatch(/\d+\s*·\s*\d+%/);
  });

  it('draws no bar and no zero where a quantity could not be measured', async () => {
    const text = pdfText(await drawBars([
      { label: 'First year', bars: [{ caption: 'Roster', value: 34 }, { caption: 'Minutes', value: null }] },
      { label: 'Graduate or fifth year', bars: [{ caption: 'Roster', value: 7 }, { caption: 'Minutes', value: null }] },
    ]));
    expect(text).toContain('ROSTER');
    expect(text).toContain('34%');
    expect(text).not.toContain('MINUTES');
    expect(text).not.toContain('0%');
  });

  it('fits the longest label it is given rather than clipping it', async () => {
    const text = pdfText(await drawBars([
      { label: 'Graduate or fifth year', bars: [{ caption: 'Roster', value: 7 }] },
    ]));
    expect(text).toContain('Graduate or fifth year');
    expect(text).not.toContain('…');
  });
});

describe('the squad page states the comparison without naming a direction', () => {
  it('prints the programme figure and the pool band and stops', async () => {
    addProgramme();
    const { text, model } = await build();
    const u = model.squadProfile.utilisation;
    expect(u.available).toBe(true);
    expect(text).toContain(`${Math.round(u.medianTop11Share * 100)}% of the minutes in a typical `
      + 'season, compared with a middle half of');
    for (const banned of [/tighter/i, /wider side/i, /on the (wider|tighter) side/i,
      /more (broadly|narrowly) than/i, /concentrated/i, /widely distributed/i]) {
      expect(text, String(banned)).not.toMatch(banned);
    }
  });

  /**
   * The last client-facing gate that nothing held above season level: a season
   * whose published minutes do not reconcile with the matches it contained is
   * kept, summarised and NAMED. Gating on it would delete seasons whose
   * relative distribution is sound, which Phase 6A decided against.
   */
  it('names a season whose published minutes do not reconcile', async () => {
    addProgramme();
    const { text, model } = await build();
    const u = model.squadProfile.utilisation;
    expect(u.implausibleSeasons.length).toBeGreaterThan(0);
    expect(u.available).toBe(true);
    for (const s of u.implausibleSeasons) expect(text).toContain(s.season);
    expect(text).toMatch(/do not add up to the matches those seasons contained/);
  });

  it('explains how to read the years of study once, not four times', async () => {
    addProgramme();
    const { text } = await build();
    const occurrences = text.split('whole of what this chart shows').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('the position page keeps its denominator and its season basis', () => {
  /** Five forwards, all of whom reached a starter's season: 5 out of 5. */
  const addFiveForwards = (seasons) => {
    for (const season of seasons) {
      for (let i = 0; i < 5; i += 1) {
        addRow('Test College', {
          season, player_name: `Fwd ${letters(i)} ${word(season)}`, class_year_label: 'Jr.',
          position: 'FORWARD', minutes_played: 900,
        });
      }
    }
  };

  it('says five reached 600 minutes out of five used, on the same line', async () => {
    addProgramme();
    addFiveForwards(['2022', '2023', '2024', '2025']);
    addAthlete('p1', { position: 'Forward' });
    const { text, model } = await build('p1');
    const util = model.positionUtilisation.athletePosition;
    expect(util.available).toBe(true);
    expect(util.medianPlayersWith600Plus).toBe(5);
    expect(util.medianPlayersWithMinutes).toBe(5);
    expect(text).toContain('a median of 5 out of 5 forwards used in a typical season');
  });

  it('keeps the season basis where fewer seasons were readable than are on file', async () => {
    addProgramme();
    addFiveForwards(['2024', '2025']);
    addAthlete('p1', { position: 'Forward' });
    const { text, model } = await build('p1');
    const util = model.positionUtilisation.athletePosition;
    expect(util.available).toBe(true);
    expect(util.readableSeasons).toBeLessThan(util.seasons.length);
    // In the scope line at the top, and once beside the comparison itself.
    expect(text).toContain(`the two seasons of ${util.seasons.length} on file with enough `
      + 'position-level minutes to read');
    expect(text).toContain('Both medians are drawn from the two seasons');
  });

  it('reads the two halves against each other instead of restating them', async () => {
    addProgramme();
    addFiveForwards(['2022', '2023', '2024', '2025']);
    addAthlete('p1', { position: 'Forward' });
    const { text } = await build('p1');
    expect(text).toContain('neither one predicts the other');
    // The figures the block used to reprint are on the page ONCE, in the notes
    // beside the charts, rather than twice.
    expect(text.split('a median of 5 out of 5 forwards used').length - 1).toBe(1);
  });
});

describe('a short valid finding shares a page rather than taking one', () => {
  it('flows experienced arrivals under the squad page and lists both', async () => {
    addFabricatedProgramme();
    const { text, model, buf } = await build();
    const at = (id) => model.sections.find((x) => x.id === id)?.page ?? null;
    expect(model.summary.programme.experiencedArrivalReliance.density).toBe('none');
    expect(at('squad-usage')).not.toBeNull();
    expect(at('experienced-arrivals')).toBe(at('squad-usage'));
    // Nothing was dropped to get there: the heading, the scope line and the
    // finding itself are all on the page.
    expect(text).toMatch(/how this programme uses its squad/i);
    expect(text).toContain('Players brought in ready to play');
    expect(text).toContain('did not add a single player who was not a first-year');
    // And the contents still describes the document.
    const total = pageCount(buf);
    for (const sec of model.sections) {
      if (sec.page == null) continue;
      expect(sec.page).toBeLessThanOrEqual(total);
    }
    expect(model.sections.map((x) => x.page).filter((x) => x != null))
      .toEqual([...model.sections.map((x) => x.page).filter((x) => x != null)]
        .sort((x, y) => x - y));
  });

  it('leaves a programme with a full arrivals record on its own page', async () => {
    addProgramme();
    const { model } = await build();
    const at = (id) => model.sections.find((x) => x.id === id)?.page ?? null;
    expect(model.summary.programme.experiencedArrivalReliance.density).not.toBe('none');
    expect(at('experienced-arrivals')).toBe(at('squad-usage') + 1);
  });
});

describe('the origin page is placed on the evidence it has', () => {
  it('files it with the supporting record where it is mostly pool context', async () => {
    // Origin IS recorded here, for every first-year — just never for anyone
    // arriving from where this athlete is arriving from. The page has a pool
    // comparison and no record of its own, which is the Albertus shape.
    addProgramme();
    addAthlete('p1', { position: 'Defender', nationality: 'Ghana' });
    const { model, text, buf } = await build('p1');
    const origin = model.sections.find((x) => x.id === 'athlete-origin');
    expect(origin).toBeTruthy();
    expect(model.summary.athlete.originContext.evidence.sufficient).toBe(false);
    /**
     * PINNED SINCE 13F. This used to move to the supporting record, which put
     * it after every evidence table. For the reader it matters to — an athlete
     * arriving from somewhere this programme has no record of — the refusal IS
     * the finding, and it belongs where they will read it.
     */
    expect(origin.layer).toBe('athlete-evidence');
    expect(origin.act).toBe('pathway');
    // Kept whole, caveats and all.
    expect(text).toContain('Where you are arriving from');
    expect(text).toContain('Not enough programme-specific history to compare by origin');
    expect(text).toContain('context, not a substitute for evidence this programme has not produced');
    const dev = model.sections.find((x) => x.id === 'player-development');
    expect(origin.page).toBeLessThan(dev.page);
    expect(origin.page).toBeLessThanOrEqual(pageCount(buf));
  });

  it('keeps it in the pathway where the programme has its own record', async () => {
    addProgramme();
    for (const season of ['2022', '2023', '2024', '2025']) {
      for (let i = 0; i < 4; i += 1) {
        addRow('Test College', {
          season, player_name: `Intl ${letters(i)} ${word(season)}`, class_year_label: 'Fr.',
          position: 'MIDFIELD', minutes_played: 800, nationality: 'Ghana', country: 'Ghana',
        });
      }
    }
    addAthlete('p1', { position: 'Midfield', nationality: 'Ghana' });
    const { model } = await build('p1');
    const origin = model.sections.find((x) => x.id === 'athlete-origin');
    expect(model.summary.athlete.originContext.evidence.sufficient).toBe(true);
    expect(origin.layer).toBe('athlete-evidence');
    expect(origin.act).toBe('pathway');
    const intake = model.sections.find((x) => x.id === 'freshman-opportunity');
    expect(origin.page).toBeLessThan(intake.page);
  });
});

describe('the pathway page on a sparse report', () => {
  it('shows what the record can and cannot be read for', async () => {
    addFabricatedProgramme();
    addAthlete('p1', { position: 'Defender' });
    const { text, model } = await build('p1');
    expect(model.evidenceLimits.length).toBeGreaterThan(0);
    expect(text).toMatch(/what this record can be read for/i);
    expect(text).toMatch(/what it cannot yet be read for/i);
    // Titles only. The full account of each refusal stays on its own page and
    // is pointed at rather than repeated.
    expect(text).toContain('set out in full');
    for (const limit of model.evidenceLimits.slice(0, 6)) {
      expect(text, limit.id).toContain(limit.title);
    }
  });

  it('leaves a report with nothing refused alone', async () => {
    addProgramme();
    addAthlete('p1', { position: 'Midfield' });
    const { text, model } = await build('p1');
    // Gated on the refusals themselves since 13F rather than on how many
    // sentences the synthesis produced: the two lists exist to show the shape
    // of what a programme could not measure.
    if (!(model.evidenceLimits ?? []).length) {
      expect(text).not.toMatch(/what this record can be read for/i);
    }
  });
});

describe('a programme whose stats page was never read', () => {
  /**
   * The Albertus Magnus shape, built here rather than read from the working
   * database: three seasons that published no minutes, and one where the
   * importer assumed a zero for every player on the roster.
   */
  const addFabricated = addFabricatedProgramme;

  // What this replaces: a ladder reading 0 at every rank, over an intake of
  // twelve the report described as fully measured.
  it('prints no first-year ladder rather than a ladder of zeros', async () => {
    addFabricated();
    const { model, text } = await build();
    // The SECTION survives the merge — the per-season intake counts are still
    // worth a page, and they are on it — but the ladder itself is refused in
    // words rather than drawn as five rows of nothing.
    expect(model.sections.map((s) => s.id)).toContain('freshman-opportunity');
    expect(model.ladder).toEqual([]);
    expect(text).toContain('No season on file carries enough recorded minutes to rank a first year');
    expect(text).not.toContain('What the best, second-best and third-best first-year actually got');
  });

  it('says nothing about how many first-years were measured, because none were', async () => {
    addFabricated();
    const { model, text } = await build();
    expect(model.summary.programme.freshmanOpportunity.measuredFreshmen).toBe(0);
    expect(text).toContain('0 first-years with minutes published');
  });

  it('refuses the development shares instead of reporting a zero', async () => {
    addFabricated();
    const { model } = await build();
    expect(model.lifecycle.development.everStarter.suppressed).toBe(true);
    expect(model.lifecycle.development.everStarter.denominator).toBe(0);
    expect((model.evidenceLimits ?? []).map((e) => e.id)).toContain('player-development-shares');
  });

  // A chart with nothing drawn was printing its own axis maximum, which floors
  // at 1 — a bare "1" where a count of first-years belongs.
  // The two intake column charts are a table since 13B, so the guard moves with
  // them: a season whose minutes were never published carries a dash in the
  // played and starter columns, and never a zero.
  it('prints a dash rather than a zero for a season that was never read', async () => {
    addFabricated();
    const { text } = await build();
    expect(text).toMatch(/who arrived, and how much they played/i);
    expect(text).toMatch(/A dash is a season whose minutes were never published widely enough/);
  });

  // The same rows with one real minute in them: the season was read, the
  // zeros beside it are facts about players who did not appear, and every
  // page comes back.
  it('keeps everything when a single published minute proves the page was read', async () => {
    addFabricated();
    addRow('Test College', {
      season: '2025', player_name: 'Played A Bit', class_year_label: 'Fr.',
      minutes_played: 900, games_played: 18, games_started: 12,
    });
    const { model } = await build();
    expect(model.sections.map((s) => s.id)).toContain('freshman-opportunity');
    expect(model.summary.programme.freshmanOpportunity.measuredFreshmen).toBeGreaterThan(0);
  });
});
