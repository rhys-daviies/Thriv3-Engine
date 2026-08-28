import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import db from '../db/client.js';
import { philosophySummaries, programReportModel } from './philosophy.js';
import { renderProgramReport } from '../lib/philosophyReport.js';
import { invalidatePoolBenchmarks } from '../lib/philosophyQueries.js';

let baseUrl;

/** The same header handling index.js does, so the test covers the real shape. */
function mount(app) {
  const safe = (t) => String(t).replace(/[^A-Za-z0-9 .()'-]/g, ' ').replace(/\s+/g, ' ').trim();
  const send = (res, buf, name) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe(name)}"`);
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  };
  app.post('/api/players/:playerId/philosophy/summaries', (req, res) => {
    try {
      res.json(philosophySummaries({ playerId: req.params.playerId, collegeIds: (req.body || {}).collegeIds }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.get('/api/philosophy/:collegeId/report.pdf', async (req, res) => {
    try {
      const model = programReportModel({ collegeId: req.params.collegeId });
      send(res, await renderProgramReport(model), `${model.college.name} program report.pdf`);
    } catch (err) {
      res.status(/^Unknown college/.test(err.message) ? 404 : 500).json({ error: err.message });
    }
  });
  app.get('/api/players/:playerId/philosophy/:collegeId/report.pdf', async (req, res) => {
    try {
      const model = programReportModel({ playerId: req.params.playerId, collegeId: req.params.collegeId });
      send(res, await renderProgramReport(model), `${model.college.name} program report.pdf`);
    } catch (err) {
      const status = /^Unknown (college|player)/.test(err.message) ? 404
        : / plays /.test(err.message) ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });
  return app;
}

beforeAll(async () => {
  const app = mount(express().use(express.json()));
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

const now = new Date().toISOString();
function addCollege(id, name, sport = 'mens-soccer') {
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
    VALUES (?,?,?,?,?,?,?,?,?,1)`)
    .run(id, now, now, name, sport, 'NCAA D2', 'Test Conference', 'Testville', 'TS');
}
function addPlayer(id, over = {}) {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, nationality, sport, recruiting_class_year)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, now, now, over.full_name ?? 'Test Athlete', over.position ?? 'Defender',
      over.nationality ?? 'New Zealand', over.sport ?? 'mens-soccer', 2027);
}
/** A squad big enough that freshmanShare will read it, four seasons deep. */
function addRoster(school, sport = 'mens-soccer') {
  const ins = db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name,
     class_year_label, position, minutes_played, games_played, nationality)
    VALUES (?,?,?,?,?,'NCAA D2',?,?,?,?,?,?,?)`);
  let n = 0;
  for (const season of ['2022', '2023', '2024', '2025']) {
    ins.run(`r${n += 1}`, now, now, school, sport, season, `Senior ${season}`, 'Sr.', 'DEFENSE', 1400, 18, 'USA');
    ins.run(`r${n += 1}`, now, now, school, sport, season, `Fresh ${season}`, 'Fr.', 'DEFENSE', 900, 16, 'International');
    for (let i = 0; i < 10; i += 1) {
      ins.run(`r${n += 1}`, now, now, school, sport, season, `Sub ${i} ${season}`, 'So.', 'MIDFIELD', 300, 10, 'USA');
    }
  }
  db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)
    VALUES (?,?,?,?,?)`).run(school, sport, 2026, 'A Coach', now);
  for (const s of [2022, 2023, 2024, 2025]) {
    db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)
      VALUES (?,?,?,?,?)`).run(school, sport, s, 'A Coach', now);
  }
}

beforeEach(() => {
  db.exec('DELETE FROM roster_players; DELETE FROM coach_seasons; DELETE FROM colleges; DELETE FROM players;');
  invalidatePoolBenchmarks();
});

const get = (url) => fetch(`${baseUrl}${url}`);
const post = (url, body) => fetch(`${baseUrl}${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('summaries', () => {
  it('returns a compact row per school, and says which reports are available', async () => {
    addCollege('c1', 'Test College');
    addRoster('Test College');
    addPlayer('p1');
    const res = await post('/api/players/p1/philosophy/summaries', { collegeIds: ['c1'] });
    expect(res.status).toBe(200);
    const { summaries } = await res.json();
    expect(summaries.c1.school).toBe('Test College');
    expect(summaries.c1.verdict.verdict).toBeTruthy();
    expect(summaries.c1.reports.available).toBe(true);
    // The heavy per-position detail is not in the tab payload.
    expect(summaries.c1.observations).toBeUndefined();
    expect(summaries.c1.byPosition).toBeUndefined();
  });

  it('reports a school with no roster rows rather than failing the whole page', async () => {
    addCollege('c1', 'Empty College');
    addPlayer('p1');
    const { summaries } = await (await post('/api/players/p1/philosophy/summaries', { collegeIds: ['c1'] })).json();
    expect(summaries.c1.unavailable).toMatch(/no roster seasons/);
  });

  it('names an id it does not recognise instead of dropping it silently', async () => {
    addPlayer('p1');
    const { summaries } = await (await post('/api/players/p1/philosophy/summaries', { collegeIds: ['nope'] })).json();
    expect(summaries.nope.unavailable).toMatch(/no college on file/);
  });

  // A whole page of schools in one request is the point; an unbounded list is
  // 15 ms of synchronous work each, blocking every other route including the
  // tracking collector.
  it('refuses an unbounded list', async () => {
    addPlayer('p1');
    const ids = Array.from({ length: 41 }, (_, i) => `c${i}`);
    const res = await post('/api/players/p1/philosophy/summaries', { collegeIds: ids });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Too many/);
  });
});

describe('the PDFs', () => {
  it('serves a real PDF as an attachment', async () => {
    addCollege('c1', 'Test College');
    addRoster('Test College');
    const res = await get('/api/philosophy/c1/report.pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename=/);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(Number(res.headers.get('content-length'))).toBe(body.length);
  });

  it('serves the report with the athlete section', async () => {
    addCollege('c1', 'Test College');
    addRoster('Test College');
    addPlayer('p1');
    const res = await get('/api/players/p1/philosophy/c1/report.pdf');
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  // A quote in the name would close the filename early and truncate the
  // header; these school names really do contain apostrophes and parentheses.
  it('does not let a school name break the header', async () => {
    addCollege('c1', 'Saint Mary\'s (CA) "Gaels"\nX');
    addRoster('Saint Mary\'s (CA) "Gaels"\nX');
    const res = await get('/api/philosophy/c1/report.pdf');
    const cd = res.headers.get('content-disposition');
    expect(cd).toMatch(/^attachment; filename="[^"]*"$/);
    expect(cd).toContain("Saint Mary's (CA)");
  });

  // A zero-byte PDF with a 200 is the failure a family would discover by
  // opening a blank file, so an unknown id has to be a status, not a document.
  it('answers an unknown school with a status, not an empty document', async () => {
    const res = await get('/api/philosophy/missing/report.pdf');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/Unknown college/);
  });

  it('refuses to report the wrong sport rather than quietly reading it', async () => {
    addCollege('c1', 'Women Only', 'womens-soccer');
    addRoster('Women Only', 'womens-soccer');
    addPlayer('p1', { sport: 'mens-soccer' });
    const res = await get('/api/players/p1/philosophy/c1/report.pdf');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/plays mens-soccer/);
  });
});

describe('the document itself', () => {
  // The only assertion that closes the loop between a model we can test and a
  // drawing we cannot: a chart that silently overflowed shows up as pages the
  // report never planned.
  it('adds the athlete section rather than replacing anything', async () => {
    addCollege('c1', 'Test College');
    addRoster('Test College');
    addPlayer('p1');
    const plain = Buffer.from(await (await get('/api/philosophy/c1/report.pdf')).arrayBuffer());
    const withAthlete = Buffer.from(
      await (await get('/api/players/p1/philosophy/c1/report.pdf')).arrayBuffer());
    const pages = (b) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages(plain)).toBeGreaterThan(0);
    expect(pages(withAthlete)).toBeGreaterThan(pages(plain));
  });

  // Every chart is handed either data or a stated reason; a chart given
  // neither throws rather than drawing an empty axis. A programme with almost
  // nothing on file is the case that proves it.
  it('renders a programme with nothing to say without throwing', async () => {
    addCollege('c1', 'Sparse College');
    db.prepare(`INSERT INTO roster_players
      (id, created_date, updated_date, college_name, sport, division, season, player_name,
       class_year_label, position, minutes_played, games_played)
      VALUES ('x1',?,?,'Sparse College','mens-soccer','NCAA D3','2025','Solo','Fr.','DEFENSE',0,0)`)
      .run(now, now);
    const res = await get('/api/philosophy/c1/report.pdf');
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('the pool it compares against', () => {
  // Every :memory: database starts here, and a benchmark section of
  // zero-length bars is indistinguishable from a programme that plays nobody.
  it('says the pool is unreadable rather than reporting zeros', async () => {
    addCollege('c1', 'Only College');
    addRoster('Only College');
    const model = programReportModel({ collegeId: 'c1' });
    if (!model.benchmarks) {
      expect(model.benchmarksReason).toBeTruthy();
    } else {
      // One programme is a readable pool of one; the figures must still exist.
      expect(model.benchmarks.programmes).toBe(1);
    }
    const res = await get('/api/philosophy/c1/report.pdf');
    expect(res.status).toBe(200);
  });
});
