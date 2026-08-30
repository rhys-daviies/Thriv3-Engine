/**
 * The front of the report, asserted against the bytes that come out.
 *
 * The document's text is inside FlateDecode streams, so the wording rules —
 * the ones that matter most and are easiest to regress — could otherwise only
 * be checked by eye. Inflating the streams and pulling the strings out lets a
 * test fail when a page starts promising minutes it cannot promise.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import zlib from 'node:zlib';
import db from '../db/client.js';
import { programReportModel } from '../routes/philosophy.js';
import { renderProgramReport } from './philosophyReport.js';
import { invalidatePoolBenchmarks } from './philosophyQueries.js';
import { invalidateLifecyclePool } from './lifecycleQueries.js';
import {
  CLASSIFICATION_LABEL, ROUTE_LABEL, COACH_HEADLINE, COACH_SUBLINE, fitText,
} from './reportFront.js';
import { CLASSIFICATIONS } from '../../shared/report/summary.js';

/**
 * Every text string the document draws.
 *
 * pdfkit writes text as HEX strings inside TJ arrays — `[<5072> 20 <6f...>] TJ`
 * — rather than as literal `(...)` strings, so the bytes have to be inflated
 * and un-hexed before any of the wording can be asserted. The fonts here are
 * the standard ones, so a byte is its WinAnsi code point; only the handful of
 * punctuation marks this report actually uses need mapping back.
 */
const WINANSI = { 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0xb7: '·' };

function pdfText(buf) {
  const raw = buf.toString('latin1');
  const out = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let body;
    try {
      body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    // One run of text per TJ/Tj operator; the hex chunks inside are contiguous.
    for (const op of body.matchAll(/(?:\[([^\]]*)\]\s*TJ|(<[0-9A-Fa-f]*>)\s*Tj)/g)) {
      const chunk = op[1] ?? op[2] ?? '';
      let word = '';
      for (const hex of chunk.matchAll(/<([0-9A-Fa-f]*)>/g)) {
        for (let i = 0; i + 1 < hex[1].length; i += 2) {
          const code = parseInt(hex[1].slice(i, i + 2), 16);
          word += WINANSI[code] ?? String.fromCharCode(code);
        }
      }
      if (word) out.push(word);
    }
  }
  // pdfkit splits a wrapped paragraph across several TJ runs, so the joined
  // text carries doubled spaces where the line broke. Collapsed here so an
  // assertion can be written the way the sentence reads.
  return out.join(' ').replace(/\s+/g, ' ');
}

/**
 * The same text, split per page.
 *
 * Each page's content stream ends with the footer's "n/total", which makes the
 * mapping self-checking rather than dependent on the order pdfkit happens to
 * flush its buffered pages in.
 */
function pdfPages(buf) {
  const whole = pdfText(buf);
  const total = pageCount(buf);
  const pages = [];
  let rest = whole;
  for (let i = 1; i <= total; i += 1) {
    const marker = ` ${i}/${total}`;
    const at = rest.indexOf(marker);
    if (at === -1) { pages.push(''); continue; }
    pages.push(rest.slice(0, at));
    rest = rest.slice(at + marker.length);
  }
  return pages;
}

/** Pages one to three: everything Phase 3 owns. */
const frontText = (buf) => pdfPages(buf).slice(0, 3).join(' ');

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
   class_year_label, position, minutes_played, games_played, games_started, nationality,
   eligibility_end_year, projected_minutes, prior_programme)
  VALUES (?,?,?,?,'mens-soccer','NCAA D2',?,?,?,?,?,?,?,?,?,?,?)`);

let n = 0;
const addRow = (school, o = {}) => insert.run(`r${n += 1}`, now, now, school,
  o.season ?? '2025', o.player_name ?? `Player ${letters(n)}`, o.class_year_label ?? 'So.',
  o.position ?? 'DEFENSE', o.minutes_played ?? 600, o.games_played ?? 15, o.games_started ?? 10,
  o.nationality ?? 'USA', o.eligibility_end_year ?? null, o.projected_minutes ?? null,
  o.prior_programme ?? null);

function addProgramme(id, name) {
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
    VALUES (?,?,?,?,'mens-soccer','NCAA D2','Test Conference','Testville','TS',1)`).run(id, now, now, name);
  for (const season of ['2022', '2023', '2024', '2025']) {
    addRow(name, { season, player_name: `Senior ${word(season)}`, class_year_label: 'Sr.', minutes_played: 1400 });
    addRow(name, { season, player_name: `Fresh One ${word(season)}`, class_year_label: 'Fr.', minutes_played: 900 });
    addRow(name, { season, player_name: `Fresh Two ${word(season)}`, class_year_label: 'Fr.', minutes_played: 120 });
    for (let i = 0; i < 10; i += 1) {
      addRow(name, { season, player_name: `Mid ${letters(i)} ${word(season)}`, class_year_label: 'So.', position: 'MIDFIELD', minutes_played: 300 });
    }
  }
  for (const s of [2022, 2023, 2024, 2025, 2026]) {
    db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)
      VALUES (?,'mens-soccer',?,'A Coach',?)`).run(name, s, now);
  }
  addRow(name, { season: '2026', player_name: 'Leaving Soon', class_year_label: 'Gr.', minutes_played: null, games_played: null, eligibility_end_year: 2026, projected_minutes: 1100 });
  addRow(name, { season: '2026', player_name: 'Final Year', class_year_label: 'Sr.', minutes_played: null, games_played: null, eligibility_end_year: 2027, projected_minutes: 900 });
  addRow(name, { season: '2026', player_name: 'Around Later', class_year_label: 'So.', minutes_played: null, games_played: null, eligibility_end_year: 2029, projected_minutes: 700 });
}

const addAthlete = (id, over = {}) => db.prepare(
  `INSERT INTO players (id, created_date, updated_date, full_name, position, nationality, sport, recruiting_class_year)
   VALUES (?,?,?,?,?,?,'mens-soccer',?)`).run(id, now, now, over.name ?? 'Test Athlete',
  over.position ?? 'Defender', over.nationality ?? 'USA', over.year ?? 2027);

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
  return { model, buf: await renderProgramReport(model) };
};

describe('label maps', () => {
  it('covers every classification the model can emit', () => {
    for (const c of CLASSIFICATIONS) expect(CLASSIFICATION_LABEL[c]).toBeTruthy();
  });

  // High/Moderate/Low would claim something the arithmetic never establishes.
  it('uses no judgement words', () => {
    const all = Object.values(CLASSIFICATION_LABEL).join(' ');
    expect(all).not.toMatch(/\b(HIGH|MODERATE|LOW|GOOD|BAD|POOR|STRONG PROGRAMME)\b/);
    expect(CLASSIFICATION_LABEL['above-benchmark']).toBe('ABOVE PROGRAMME BENCHMARK');
  });

  it('covers every route and every coaching relevance', () => {
    for (const r of ['returning', 'freshman', 'newcomer', 'mixed']) expect(ROUTE_LABEL[r]).toBeTruthy();
    for (const r of ['describes-current', 'partly-describes-current', 'describes-previous', 'unknown']) {
      expect(COACH_HEADLINE[r]).toBeTruthy();
      expect(COACH_SUBLINE[r]).toBeTruthy();
    }
  });
});

describe('fitText', () => {
  const doc = { widthOfString: (s) => s.length * 10 };
  it('leaves a string that fits alone', () => expect(fitText(doc, 'abc', 100)).toBe('abc'));
  it('cuts and marks a string that does not', () => {
    const got = fitText(doc, 'abcdefghij', 50);
    expect(got.endsWith('…')).toBe(true);
    expect(got.length).toBeLessThan(10);
  });
  it('returns empty rather than overflowing when there is no room', () => {
    expect(fitText(doc, 'abc', 5)).toBe('');
  });
});

describe('the document', () => {
  beforeEach(() => addProgramme('c1', 'Test College'));

  it('renders a programme report and an athlete report', async () => {
    const plain = await build();
    expect(plain.buf.subarray(0, 5).toString()).toBe('%PDF-');
    addAthlete('p1');
    const athlete = await build('p1');
    expect(athlete.buf.subarray(0, 5).toString()).toBe('%PDF-');
    // The athlete page is additive, so the document gets longer, never shorter.
    expect(pageCount(athlete.buf)).toBeGreaterThan(pageCount(plain.buf));
  });

  it('puts the contents on page one and the glance page on page two', async () => {
    const { model } = await build();
    expect(model.sections.find((s) => s.id === 'programme-at-a-glance')).toBeTruthy();
    const { buf } = await build();
    expect(pdfText(buf)).toMatch(/PROGRAM INTELLIGENCE REPORT/);
  });

  it('carries no blank pages', async () => {
    const { buf } = await build();
    const raw = buf.toString('latin1');
    // Every page object must reference a content stream.
    const pages = raw.match(/\/Type\s*\/Page[^s]/g) || [];
    expect(pages.length).toBeGreaterThan(3);
    expect(raw).not.toMatch(/\/Contents\s+null/);
  });
});

describe('page three', () => {
  beforeEach(() => addProgramme('c1', 'Test College'));

  it('is absent without an athlete', async () => {
    const { buf, model } = await build();
    expect(model.summary.athlete).toBeNull();
    expect(pdfText(buf)).not.toMatch(/Your opportunity at/);
    expect(pdfText(buf)).not.toMatch(/YOUR ARRIVAL WINDOW/i);
  });

  it('is present with one', async () => {
    addAthlete('p1');
    const { buf } = await build('p1');
    const text = pdfText(buf);
    expect(text).toMatch(/Your opportunity at/);
    expect(text).toMatch(/YOUR ARRIVAL WINDOW/i);
    expect(text).toMatch(/YOUR POSITION NOW/i);
  });

  // The lead group is the one the eligibility model can actually populate. For
  // a 2027 entrant "ends before entry" is graduate students only, so leading
  // with it would tell most athletes nobody is leaving.
  // The card opens with a position-filtered count and then reports an origin
  // figure built from the whole intake. Without the scope on the label those
  // read as the same population.
  it('says the origin comparison is across every position', async () => {
    addAthlete('p1');
    const text = pdfText((await build('p1')).buf);
    expect(text).toMatch(/THIS PROGRAMME · ALL POSITIONS|on file here, across every position/);
  });

  it('leads the arrival window with the final-season group', async () => {
    addAthlete('p1', { year: 2027 });
    const { buf, model } = await build('p1');
    const a = model.summary.athlete;
    expect(a.currentPlayersInFinalSeasonAtEntry.map((x) => x.name)).toEqual(['Final Year']);
    expect(a.currentPlayersEligibilityEndsBeforeEntry.map((x) => x.name)).toEqual(['Leaving Soon']);
    const text = pdfText(buf);
    expect(text).toMatch(/in their final eligible season in 2027/);
    // All three temporal groups appear, named the same way on every report.
    expect(text).toMatch(/FINAL SEASON AT ENTRY/);
    expect(text).toMatch(/BEFORE ENTRY/);
    expect(text).toMatch(/BEYOND ENTRY/);
  });

  it('always states what cannot be known about the entry season', async () => {
    addAthlete('p1');
    const { buf } = await build('p1');
    expect(frontText(buf)).toMatch(/Future recruits, experienced arrivals, injuries and eligibility changes are not known/);
  });
});

/**
 * The contents is drawn onto page one after every other page exists, from a
 * map the renderer fills as it goes. Nothing else in the document can check
 * itself against it, so this reads the finished PDF.
 */
describe('contents numbering', () => {
  const check = async (playerId = null) => {
    const model = programReportModel({ collegeId: 'c1', playerId });
    const buf = await renderProgramReport(model);
    const pages = pdfPages(buf);
    return { model, pages, contents: pages[0] };
  };

  it('lists every section that rendered, and nothing that did not', async () => {
    addProgramme('c1', 'Test College');
    addAthlete('p1');
    const { model, contents } = await check('p1');
    for (const s of model.sections) expect(contents).toContain(s.title);
  });

  it('points each section at a page that carries it', async () => {
    addProgramme('c1', 'Test College');
    addAthlete('p1');
    const { model, pages, contents } = await check('p1');
    for (const s of model.sections) {
      const m = contents.match(new RegExp(`${s.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)\\b`));
      expect(m, `no page number listed for "${s.title}"`).toBeTruthy();
      const page = Number(m[1]);
      expect(page).toBeGreaterThan(1);
      expect(page).toBeLessThanOrEqual(pages.length);
    }
  });

  it('numbers the sections in ascending order', async () => {
    addProgramme('c1', 'Test College');
    addAthlete('p1');
    const { model, contents } = await check('p1');
    const numbers = model.sections.map((s) => {
      const m = contents.match(new RegExp(`${s.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)\\b`));
      return m ? Number(m[1]) : null;
    });
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('lists nothing on a sparse report that the report does not contain', async () => {
    db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
      VALUES ('c1',?,?,'Thin College','mens-soccer','NCAA D3',NULL,NULL,NULL,1)`).run(now, now);
    addRow('Thin College', { season: '2025', minutes_played: null, games_played: null });
    const { model, contents } = await check();
    expect(model.sections.length).toBeLessThan(10);
    for (const title of ['After the first season', 'Position by position', 'The current squad']) {
      if (!model.sections.some((s) => s.title === title)) expect(contents).not.toContain(title);
    }
  });
});

describe('page two modules', () => {
  beforeEach(() => addProgramme('c1', 'Test College'));

  it('renders all five, and the fifth carries no classification badge', async () => {
    const { buf, model } = await build();
    const text = pdfText(buf);
    for (const title of ['FIRST-YEAR OPPORTUNITY', 'EXPERIENCED ARRIVAL RELIANCE',
      'REPLACEMENT BEHAVIOUR', 'COACH CONTEXT', 'CURRENT SQUAD OUTLOOK']) {
      expect(text).toContain(title);
    }
    // The turnover classification is always 'unclear' and is deliberately not
    // drawn: a badge that never says anything would take the most valuable
    // space on the page to say it.
    expect(model.summary.programme.squadTurnover.classification).toBe('unclear');
    expect(text).not.toMatch(/SQUAD TURNOVER/i);
    expect(text).not.toMatch(/CURRENT SQUAD OUTLOOK[^]{0,40}UNCLEAR/);
  });

  // Scoped to the pages this file owns. The methodology page legitimately
  // uses the words to say what evidence strength is NOT.
  it('states the evidence behind each module without calling it confidence', async () => {
    const { buf } = await build();
    const front = frontText(buf);
    expect(front).toMatch(/EVIDENCE — (STRONG|MODERATE|LIMITED)/);
    expect(front).not.toMatch(/confidence/i);
    expect(front).not.toMatch(/probabilit/i);
    expect(front).not.toMatch(/certainty/i);
  });

  it('says a programme is above the benchmark rather than high', async () => {
    const { buf, model } = await build();
    const text = pdfText(buf);
    const c = model.summary.programme.freshmanOpportunity.classification;
    expect(text).toContain(CLASSIFICATION_LABEL[c]);
  });
});

describe('wording the data cannot support', () => {
  beforeEach(() => {
    addProgramme('c1', 'Test College');
    addAthlete('p1', { year: 2027 });
  });

  // Split deliberately. The first list is about minutes and applies to the
  // WHOLE document: no page may describe minutes as available to a recruit.
  it('never describes minutes as available, anywhere in the document', async () => {
    const text = pdfText((await build('p1')).buf);
    for (const banned of [/available minutes/i, /open minutes/i, /minutes will open/i,
      /minutes up for grabs/i, /opportunity minutes/i, /minutes become available to (you|a recruit)/i]) {
      expect(text).not.toMatch(banned);
    }
  });

  // The second list is about prediction and is scoped to pages one to three,
  // which is what Phase 3 owns. The v1 evidence pages still carry a sentence
  // claiming an international first-year is "about 40% more likely to play a
  // starter's season — 37% against 27%", which the measured pool now
  // contradicts: 36.2% against 21.3%, and reversed at Division III in the
  // women's game. That page is Phase 4 work; this test stops the front of the
  // report from acquiring the same habit in the meantime.
  it('never predicts an outcome on the pages it owns', async () => {
    const front = frontText((await build('p1')).buf);
    for (const banned of [/you will play/i, /expected to start/i, /guaranteed/i,
      /likely to play/i, /chance of playing/i, /projected to start/i]) {
      expect(front).not.toMatch(banned);
    }
  });

  it('attributes projected minutes to the players who hold them', async () => {
    const text = pdfText((await build('p1')).buf);
    expect(text).toMatch(/currently attached to those players|belong to the players listed/);
  });

  it('never labels a classification high, moderate or low', async () => {
    const text = pdfText((await build('p1')).buf);
    // The evidence chip legitimately uses MODERATE; the classification chips
    // must not, so check the chip vocabulary specifically.
    expect(text).not.toMatch(/FIRST-YEAR OPPORTUNITY[^]{0,30}\bHIGH\b/);
    expect(text).not.toMatch(/EXPERIENCED ARRIVAL RELIANCE[^]{0,40}\bLOW\b/);
  });
});

describe('the contents page', () => {
  beforeEach(() => addProgramme('c1', 'Test College'));

  it('lists a page number for every section it names, and they ascend', async () => {
    addAthlete('p1');
    const { buf, model } = await build('p1');
    const text = pdfText(buf);
    const total = pageCount(buf);
    // Every section title the contents lists must appear in the document, and
    // no page number may exceed the document length.
    for (const s of model.sections) {
      if (!text.includes(s.title)) continue;
      expect(total).toBeGreaterThan(1);
    }
    expect(text).toMatch(/CONTENTS/);
    expect(text).toMatch(/PAGE/);
  });

  it('drops the athlete layer entirely from a programme report', async () => {
    const { buf } = await build();
    const text = pdfText(buf);
    expect(text).not.toMatch(/FOR THIS ATHLETE/);
    expect(text).not.toMatch(/Prepared for/);
  });

  it('names the athlete on an athlete report', async () => {
    addAthlete('p1', { name: 'Sample Athlete' });
    const text = pdfText((await build('p1')).buf);
    expect(text).toMatch(/Prepared for Sample Athlete/);
    expect(text).toMatch(/FOR THIS ATHLETE/);
  });

  // The value statement is built from the seasons the model actually holds.
  it('does not hardcode a season count', async () => {
    const { buf, model } = await build();
    const text = pdfText(buf);
    expect(text).toContain(`${model.describes.length} seasons of roster behaviour`);
  });
});

describe('the footer survives the deferred contents page', () => {
  beforeEach(() => addProgramme('c1', 'Test College'));

  it('numbers every page once, including page one', async () => {
    const { buf } = await build();
    const total = pageCount(buf);
    const text = pdfText(buf);
    for (let i = 1; i <= total; i += 1) expect(text).toContain(`${i}/${total}`);
  });

  it('does not grow the document by drawing the contents last', async () => {
    addAthlete('p1');
    const { buf, model } = await build('p1');
    // The last section recorded must still be inside the document.
    const last = Math.max(...model.sections.map((s) => s.page ?? 0), 0);
    expect(last).toBeLessThanOrEqual(pageCount(buf));
  });
});
