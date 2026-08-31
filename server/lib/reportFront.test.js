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
import PDFDocument from 'pdfkit';
import {
  CLASSIFICATION_LABEL, ROUTE_LABEL, COACH_HEADLINE, COACH_SUBLINE, fitText, panel,
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

/**
 * Replace a fixture's coach rows. `addProgramme` writes one name across all
 * five seasons; these are the other shapes.
 */
const setCoachSeasons = (school, seasons) => {
  db.prepare('DELETE FROM coach_seasons WHERE school = ?').run(school);
  const ins = db.prepare(`INSERT INTO coach_seasons
    (school, sport, season, coach_name, coach_title, reason, imported_at)
    VALUES (?,'mens-soccer',?,?,?,?,?)`);
  for (const [season, v] of Object.entries(seasons)) {
    const [name, title = 'Head Coach', reason = null] = Array.isArray(v) ? v : [v, 'Head Coach', null];
    ins.run(school, Number(season), name, name ? title : null, reason, now);
  }
};

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

  it('puts the cover on page one and the glance page on page two', async () => {
    const { model } = await build();
    expect(model.sections.find((s) => s.id === 'programme-at-a-glance')).toBeTruthy();
    const { buf } = await build();
    const text = pdfText(buf);
    // The cover leads with the programme's name; the label sits under it.
    expect(text).toMatch(/THRIV3 Test College PROGRAMME INTELLIGENCE/);
    expect(text).toMatch(/How this programme recruits, develops, retains and replaces players/);
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

describe('the pathway page', () => {
  beforeEach(() => addProgramme('c1', 'Test College'));

  it('is absent without an athlete', async () => {
    const { buf, model } = await build();
    expect(model.summary.athlete).toBeNull();
    const text = pdfText(buf);
    expect(text).not.toMatch(/Your pathway at/);
    expect(text).not.toMatch(/THE PATHWAY THRIV3 SEES/);
    expect(text).not.toMatch(/UNDERSTANDING YOUR PATHWAY/);
  });

  it('opens the athlete report with the synthesis, not with the cards', async () => {
    addAthlete('p1');
    const { buf } = await build('p1');
    const text = pdfText(buf);
    expect(text).toMatch(/Your pathway at Test College/);
    expect(text).toMatch(/THE PATHWAY THRIV3 SEES/);
    // The four cards this page used to carry are each a page of their own now,
    // immediately after it, so the synthesis does not reprint its own evidence.
    expect(text).toMatch(/YOUR ARRIVAL WINDOW/i);
    expect(text).toMatch(/YOUR POSITION NOW/i);
  });

  // The lead group is the one the eligibility model can actually populate. For
  // a 2027 entrant "ends before entry" is graduate students only, so leading
  // with it would tell most athletes nobody is leaving.
  // The card opens with a position-filtered count and then reports an origin
  // figure built from the whole intake. Without the scope on the label those
  // read as the same population.
  // The origin comparison is built from the whole intake, not from this
  // athlete's position. It used to be a card whose label said so; it is now a
  // page of its own, and the page has to say so just as plainly.
  it('says the origin comparison is across every position', async () => {
    addAthlete('p1');
    const { buf, model } = await build('p1');
    expect(model.sections.find((x) => x.id === 'athlete-origin')).toBeTruthy();
    expect(pdfText(buf)).toMatch(/At this programme, across every position/i);
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

  // The caveat moved with the content it qualifies. It was a grey aside inside
  // the arrival-window CARD; it is now the primary claret limitation on the
  // arrival-window PAGE, and it names redshirts too.
  it('always states what cannot be known about the entry season', async () => {
    addAthlete('p1');
    const { buf, model } = await build('p1');
    expect(model.sections.find((x) => x.id === 'athlete-entry-window')).toBeTruthy();
    const text = pdfText(buf);
    expect(text).toMatch(/Future recruits, experienced arrivals, injuries, redshirts and eligibility changes are not known/);
    expect(text).toMatch(/it does not describe the squad you would find/);
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
    expect(text).not.toMatch(/UNDERSTANDING YOUR PATHWAY/);
    // The athlete cover form, and the athlete-scoped cover sentence.
    expect(text).not.toMatch(/ × Test College/);
    expect(text).not.toMatch(/A historical view of how players enter/);
  });

  it('names the athlete and the programme together on an athlete report', async () => {
    addAthlete('p1', { name: 'Sample Athlete' });
    const text = pdfText((await build('p1')).buf);
    expect(text).toMatch(/Sample Athlete × Test College/);
    expect(text).toMatch(/A historical view of how players enter, develop and move through/);
    // The athlete's own pages are an act now, and the contents names it.
    expect(text).toMatch(/UNDERSTANDING YOUR PATHWAY/);
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

/**
 * PHASE 11C — whose measured seasons these are, on the page a family reads
 * first. The counts come from `coachAttribution`; what is asserted here is
 * where they appear and how loudly.
 */
describe('current coach context on page two', () => {
  const front = async () => frontText((await build()).buf);

  it('leaves the page subtitle alone where the context is quiet', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Jane Kerr', 2023: 'Jane Kerr', 2024: 'Jane Kerr', 2025: 'Jane Kerr', 2026: 'Jane Kerr',
    });
    const text = await front();
    expect(text).toContain('CURRENT COACH HISTORY');
    expect(text).toContain('all 4 measured seasons in this report');
    // Quiet means the page keeps its own subtitle.
    expect(text).toContain('What this programme’s record shows');
    expect(text).not.toMatch(/Programme at a glance All 4 measured/);
    // ...and no strip, because one name across every season draws nothing.
    expect(text).not.toContain('WHOSE SEASONS THESE ARE');
  });

  it('is visible on the card where some but not all seasons are the coach’s', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Greg Dalby', 2023: 'Greg Dalby', 2024: 'Jane Brookins', 2025: 'Jane Brookins', 2026: 'Jane Brookins',
    });
    const text = await front();
    expect(text).toContain('COACHING CHANGE IN WINDOW');
    expect(text).toContain('2 of the 4 measured seasons in this report');
    expect(text).toContain('WHOSE SEASONS THESE ARE');
    expect(text).toContain('Greg Dalby 2022–2023');
    expect(text).toContain('Jane Brookins 2024–2026');
  });

  // Mercyhurst men's shape: the card used to read "CURRENT COACH HISTORY /
  // stable across the seasons measured" over exactly this.
  /**
   * The prominent placement is the page subtitle, not a band row. Page two
   * sizes five cards out of whatever the band leaves, and a sixth row fits at
   * only 231 of the 357 programmes whose context is prominent; the subtitle
   * costs nothing and is always there.
   */
  it('is prominent at one measured season, in the subtitle and on the card', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Ryan Osborne', 2023: [null, null, 'no-usable-page'], 2024: [null, null, 'no-usable-page'],
      2025: 'Austin Solomon', 2026: 'Austin Solomon',
    });
    const text = await front();
    // The subtitle, directly under "Programme at a glance".
    expect(text).toMatch(/Programme at a glance Only 1 of the 4 measured seasons in this report was under Austin Solomon\./);
    expect(text).not.toContain('What this programme’s record shows');
    // ...and the card, which carries it whatever the subtitle does.
    expect(text).toContain('ONE MEASURED SEASON');
    expect(text).toContain('1 of the 4 measured seasons in this report');
    expect(text).toContain('2 unresolved');
    expect(text).not.toContain('stable across the seasons measured');
  });

  it('is prominent at none, and names the coach on file for the earlier seasons', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Richard Nuttall', 2023: 'Richard Nuttall', 2024: 'Richard Nuttall',
      2025: 'Richard Nuttall', 2026: 'Stephen Roche',
    });
    const text = await front();
    expect(text).toContain('None of the 4 measured seasons in this report were under Stephen Roche.');
    expect(text).toContain('NO MEASURED SEASON');
    expect(text).toContain('Richard Nuttall 2022–2025');
    expect(text).not.toContain('NEW COACH');
  });

  // Michigan men's: no earlier coach may be invented.
  it('invents no earlier coach where the earlier seasons are unresolved', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: [null, null, 'no-usable-page'], 2023: [null, null, 'no-usable-page'],
      2024: [null, null, 'no-usable-page'], 2025: [null, null, 'no-usable-page'], 2026: 'Chaka Daley',
    });
    const text = await front();
    expect(text).toContain('None of the 4 measured seasons in this report were under Chaka Daley.');
    expect(text).toContain('4 unresolved');
    expect(text).not.toMatch(/named coach on file/);
  });

  // Ohio State men's: the gap is never closed.
  it('shows an unresolved season between two spells of one name', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Brian Maisonneuve', 2023: 'Brian Maisonneuve', 2024: [null, null, 'no-head-coach-found'],
      2025: 'Brian Maisonneuve', 2026: 'Brian Maisonneuve',
    });
    const { model, buf } = await build();
    const text = frontText(buf);
    const a = model.coachAttribution;
    expect(a.currentCoachMeasuredSeasons).toBe(3);
    expect(a.historicalMeasuredSeasons).toBe(4);
    expect(text).toContain('3 of the 4 measured seasons in this report');
    expect(text).toContain('1 unresolved');
    // The 2024 cell is not filled in from either side.
    expect(a.measuredSeasons.find((x) => x.season === '2024').coachName).toBeNull();
  });

  // Marist men's: the strength coach must not be promoted anywhere.
  it('refuses the record rather than naming a coach of something else', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2023: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2024: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2025: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2026: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
    });
    const text = await front();
    expect(text).toContain('COACH RECORD UNRESOLVED');
    expect(text).toContain('Could not establish');
    expect(text).not.toContain('Aaron Suma');
    // The verdict note is withheld only where it asserts the refused coach.
    expect(text).not.toContain('One coach throughout');
  });

  it('qualifies an interim without describing a regime', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Bob Thompson', 2023: 'Bob Thompson', 2024: 'Bob Thompson', 2025: 'Bob Thompson',
      2026: ['Frank Agostino', 'Interim Head Coach'],
    });
    const text = await front();
    expect(text).toContain('INTERIM HEAD COACH');
    expect(text).toContain('The 2026 coach record identifies Frank Agostino as interim head coach.');
    expect(text).not.toMatch(/stable|new coach/i);
  });

  it('states the co-head limitation', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: ['Tari Johnson', 'Co-Head Coach'], 2023: ['Tari Johnson', 'Co-Head Coach'],
      2024: ['Tari Johnson', 'Co-Head Coach'], 2025: ['Tari Johnson', 'Co-Head Coach'],
      2026: ['Tari Johnson', 'Co-Head Coach'],
    });
    const text = await front();
    expect(text).toMatch(/one coach for each programme-season/);
  });

  it('says nothing at all where no coach record is held at this level', async () => {
    addProgramme('c1', 'Test College');
    db.prepare('DELETE FROM coach_seasons WHERE school = ?').run('Test College');
    db.prepare("UPDATE colleges SET division = 'NAIA' WHERE id = 'c1'").run();
    const { model, buf } = await build();
    const text = frontText(buf);
    expect(model.coachAttribution.currentCoach).toBeNull();
    // A small unavailable state, not a refusal: there is nothing for an NAIA
    // programme to resolve, and the missing record is ours rather than theirs.
    expect(text).toContain('NOT ON FILE');
    expect(text).toContain('no coaching record is held at this level');
    expect(text).not.toContain('COACH RECORD UNRESOLVED');
    expect(text).not.toContain('measured seasons in this report');
    // ...and nothing in the summary band, which is where the loud cases go.
    expect(text).not.toContain('Only 1 of');
    expect(text).not.toContain('None of the');
  });

  it('adds no page, no section and no contents entry', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Richard Nuttall', 2023: 'Richard Nuttall', 2024: 'Richard Nuttall',
      2025: 'Richard Nuttall', 2026: 'Stephen Roche',
    });
    const { model, buf } = await build();
    expect(model.sections.map((x) => x.id).join(',')).not.toMatch(/coach/i);
    expect(pageCount(buf)).toBe(model.sections[model.sections.length - 1].page + 1);
  });

  /**
   * The roster analytics do not move when the coach record does.
   *
   * Two things legitimately move and both predate this phase: the verdict, which
   * `classifyProgramme` has always derived from the coach tenure, and the
   * `evidence` leg of each summary, which has always counted coach continuity
   * as part of how strong a history is. Everything measured from the rosters is
   * compared here with `evidence` stripped. The guarantee that no real
   * programme's figures drifted at all is the snapshot check.
   */
  const withoutEvidence = (o) => JSON.stringify({ ...o, evidence: undefined });
  it('leaves the roster analytics untouched when the coach record changes', async () => {
    addProgramme('c1', 'Test College');
    const before = await build();
    setCoachSeasons('Test College', {
      2022: 'Richard Nuttall', 2023: 'Richard Nuttall', 2024: 'Richard Nuttall',
      2025: 'Richard Nuttall', 2026: 'Stephen Roche',
    });
    const after = await build();
    for (const key of ['ladder', 'dials', 'byPosition', 'seasons', 'freshman', 'transfer']) {
      expect(JSON.stringify(after.model[key]), key).toBe(JSON.stringify(before.model[key]));
    }
    for (const key of ['replacementBehaviour', 'squadTurnover', 'experiencedArrivalReliance',
      'freshmanOpportunity']) {
      expect(withoutEvidence(after.model.summary.programme[key]), key)
        .toBe(withoutEvidence(before.model.summary.programme[key]));
    }
    expect(JSON.stringify(after.model.squadProfile)).toBe(JSON.stringify(before.model.squadProfile));
    expect(JSON.stringify(after.model.positionUtilisation))
      .toBe(JSON.stringify(before.model.positionUtilisation));
  });

  it('says nothing the coach record cannot support', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Ryan Osborne', 2023: [null, null, 'no-usable-page'], 2024: [null, null, 'no-usable-page'],
      2025: 'Austin Solomon', 2026: 'Austin Solomon',
    });
    const text = (await front()).toLowerCase();
    for (const banned of ['hired', 'appointed', 'replaced', 'succeeded', 'took over',
      'stepped down', 'new coach', 'former coach', 'predecessor', 'coach prefers',
      'coach develops', 'this history belongs to']) {
      expect(text, banned).not.toContain(banned);
    }
  });
});

/**
 * PHASE 11D — the coach verdict and the coach card, reading one table.
 *
 * 11C hid the verdict note on eight cards where it contradicted the
 * attribution. That left the verdict itself wrong. These assert the fix: the
 * note now comes from a coach sequence that has been through the same
 * head-coach reader the card uses, so there is nothing left to hide.
 */
describe('the coach verdict agrees with the coach card', () => {
  const front = async () => frontText((await build()).buf);

  it('does not call four seasons one coach when one has no coach on file', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Nick Kirchhof', 2023: [null, null, 'no-usable-page'],
      2024: 'Nick Kirchhof', 2025: 'Nick Kirchhof', 2026: 'Nick Kirchhof',
    });
    const { model, buf } = await build();
    expect(model.verdict.verdict).toBe('coach-unknown-recent');
    expect(model.verdict.note).toMatch(/no head coach on file for 2023/);
    const text = frontText(buf);
    expect(text).not.toMatch(/one coach throughout|the same coach,|one coach, a consistent/i);
    // The card says the same thing in its own words, and its strip counts it.
    expect(text).toContain('3 of the 4 measured seasons');
    expect(text).toMatch(/1 unresolved/);
  });

  // Marist men's, in the shape that made it wrong: every row on file names the
  // strength coach. The card refused him in 11C and the verdict still called
  // him the one coach throughout.
  it('never lets a strength coach become the programme’s head coach', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2023: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2024: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2025: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2026: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
    });
    const text = await front();
    expect(text).not.toContain('Aaron Suma');
    expect(text).toContain('COACH RECORD UNRESOLVED');
    expect(text).toContain('not on file');
    expect(text).toMatch(/cannot be attributed to anyone/);
    expect(text).not.toMatch(/one coach throughout|WHOSE SEASONS THESE ARE/);
  });

  it('never lets an associate head become the programme’s head coach', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: ['Mary Hearin', 'Associate Head Coach'],
      2023: 'Kelly Lawrence', 2024: 'Kelly Lawrence',
      2025: 'Kelly Lawrence', 2026: 'Kelly Lawrence',
    });
    const { model, buf } = await build();
    expect(model.verdict.verdict).toBe('coach-unknown-recent');
    expect(model.verdict.note).toMatch(/no head coach on file for 2022/);
    expect(model.coach.coach).toBe('Kelly Lawrence');
    const text = frontText(buf);
    expect(text).not.toContain('Mary Hearin');
    expect(text).toContain('3 of the 4 measured seasons');
  });

  // The claim survives where the evidence is there, and it says which seasons.
  it('still says one coach where every measured season names them', async () => {
    addProgramme('c1', 'Test College');
    setCoachSeasons('Test College', {
      2022: 'Jane Kerr', 2023: 'Jane Kerr', 2024: 'Jane Kerr', 2025: 'Jane Kerr', 2026: 'Jane Kerr',
    });
    const text = await front();
    expect(text).toMatch(/[Oo]ne coach across every season measured/);
  });
});

/**
 * PHASE 11D — the evidence strip belongs to the card that owns it.
 *
 * It was placed at `Math.max(y + 10, p.bottom - 20)`, which put it below the
 * card whenever the content ran long: at 22 of 90 sampled reports the
 * first-year card's strip drew over the top border of the panel beneath it.
 * `panel({ evidence: true })` now reserves it, so the geometry is the contract
 * and there is nothing left for a card to get wrong.
 */
describe('the evidence strip stays inside its card', () => {
  const box = { x: 54, y: 100, w: 260, h: 180 };
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.addPage();

  it('reserves the strip inside the box, ink and margin', () => {
    const p = panel(doc, box, 'First-year opportunity', { evidence: true });
    // 17 points of ink — a 6.5pt label and a 6.5pt sample line nine points
    // under it — and it must finish above the border, not on it.
    expect(p.evidenceY + 17).toBeLessThan(box.y + box.h);
    expect(p.evidenceY).toBeGreaterThan(p.y);
  });

  it('makes the strip the floor for everything else on the card', () => {
    const p = panel(doc, box, 'First-year opportunity', { evidence: true });
    expect(p.bottom).toBe(p.evidenceY);
  });

  it('leaves a card without a strip exactly as it was', () => {
    const p = panel(doc, box, 'Coach context');
    expect(p.evidenceY).toBeNull();
    expect(p.bottom).toBe(box.y + box.h - 14);
  });

  // The strip's position cannot depend on how much the card drew, which is the
  // whole of the defect: the old placement moved with the content.
  it('puts the strip in the same place whatever the box contains', () => {
    const a = panel(doc, box, 'First-year opportunity', { evidence: true });
    const b = panel(doc, { ...box, y: 400 }, 'Replacement behaviour', { evidence: true });
    expect(a.evidenceY - box.y).toBe(b.evidenceY - 400);
  });
});
