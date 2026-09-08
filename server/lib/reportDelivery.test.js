/**
 * The delivery surface, held to one rule above all others.
 *
 *   DELIVERY MUST NOT ALTER THE DOCUMENT.
 *
 * The report product is frozen on main. This subsystem exists to put a PDF in
 * an operator's hands and to remember that it did, and the first test below
 * renders the same athlete and programme through the existing endpoint's path
 * and through the delivery service and compares the model, the section plan,
 * the page count, the extracted text and every content stream. Everything
 * after it is about the promises delivery makes on its own: that an artefact
 * is immutable, that a success row cannot describe a missing file, and that a
 * download route cannot be steered at something else.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// A store of its own, so a test run never touches an operator's artefacts.
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-reports-'));
process.env.THRIV3_REPORT_STORE = STORE;

const [
  { default: db },
  { programReportModel },
  { renderProgramReport, reportFilename },
  { pdfUnicodeText },
  { invalidatePoolBenchmarks },
  { invalidateLifecyclePool },
  delivery,
] = await Promise.all([
  import('../db/client.js'),
  import('../routes/philosophy.js'),
  import('./philosophyReport.js'),
  import('./pdfText.js'),
  import('./philosophyQueries.js'),
  import('./lifecycleQueries.js'),
  import('./reportDelivery.js'),
]);

const {
  generateReport, listReports, readArtifact, selectableAthletes, selectableProgrammes,
  selectableProgramme, checkPair, presentReport, STORE_ROOT, engineVersion,
} = delivery;

afterAll(() => { try { fs.rmSync(STORE, { recursive: true, force: true }); } catch { /* gone */ } });

/**
 * FIXTURES, NOT PRODUCTION DATA. Vitest gives every file its own in-memory
 * database, which is what keeps a suite from reading — or wiping — the working
 * one. So the pairs below are built here, in the same shape
 * `reportFront.test.js` uses.
 *
 * The named production fixtures and their page counts (Rhys Davies ×
 * Mercyhurst = 31, Shaan Anad × California = 25, Rhys Davies × Albright = 18)
 * are checked in `npm run verify:baseline`, which is where this repository
 * puts every claim that needs the real database.
 */
const now = new Date().toISOString();
const letters = (i) => String.fromCharCode(97 + (i % 26)).toUpperCase();
const insertRow = db.prepare(`INSERT INTO roster_players
  (id, created_date, updated_date, college_name, sport, division, season, player_name,
   class_year_label, position, minutes_played, games_played, games_started, nationality,
   eligibility_end_year, projected_minutes, prior_programme)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

let n = 0;
const addRow = (school, sport, o = {}) => insertRow.run(`r${n += 1}`, now, now, school, sport,
  'NCAA D2', o.season ?? '2025', o.name ?? `Player ${letters(n)}${n}`, o.cls ?? 'So.',
  o.position ?? 'DEFENSE', o.minutes ?? 600, 15, 10, 'USA',
  o.eligibleTo ?? null, o.projected ?? null, null);

function addProgramme(id, name, sport = 'mens-soccer') {
  db.prepare(`INSERT INTO colleges
      (id, created_date, updated_date, name, sport, division, conference, city, state, active)
    VALUES (?,?,?,?,?,'NCAA D2','Test Conference','Testville','TS',1)`)
    .run(id, now, now, name, sport);
  for (const season of ['2022', '2023', '2024', '2025']) {
    addRow(name, sport, { season, name: `Senior ${season}`, cls: 'Sr.', minutes: 1400 });
    addRow(name, sport, { season, name: `Fresh ${season}`, cls: 'Fr.', minutes: 900 });
    for (let i = 0; i < 8; i += 1) {
      addRow(name, sport, { season, name: `Mid ${i} ${season}`, cls: 'So.', position: 'MIDFIELD', minutes: 300 });
    }
  }
  addRow(name, sport, { season: '2026', name: 'Final Year', cls: 'Sr.', minutes: null, eligibleTo: 2027, projected: 900 });
  addRow(name, sport, { season: '2026', name: 'Around Later', cls: 'So.', minutes: null, eligibleTo: 2029, projected: 700 });
  for (const s of [2022, 2023, 2024, 2025, 2026]) {
    db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, coach_title, imported_at)
      VALUES (?,?,?,'A Coach','Head Coach',?)`).run(name, sport, s, now);
  }
}

const addAthlete = (id, over = {}) => db.prepare(
  `INSERT INTO players (id, created_date, updated_date, full_name, position, nationality, sport,
     recruiting_class_year, archived_at, published_at, public_slug)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, now, now, over.name ?? 'Test Athlete', over.position ?? 'Defender', 'USA',
    over.sport ?? 'mens-soccer', over.year ?? 2027, over.archived ?? null,
    over.published ?? null, over.slug ?? null);

const college = (name, sport = 'mens-soccer') => db.prepare(
  'SELECT id, name, sport FROM colleges WHERE name = ? AND sport = ?').get(name, sport);
const athlete = (name) => db.prepare(
  'SELECT id, full_name, sport FROM players WHERE full_name = ?').get(name);

const streams = (buf) => [...buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
  .map((m) => m[1]).join('');
const pages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

beforeEach(() => {
  db.exec(`DELETE FROM generated_reports; DELETE FROM roster_players; DELETE FROM coach_seasons;
    DELETE FROM colleges; DELETE FROM players;`);
  invalidatePoolBenchmarks();
  invalidateLifecyclePool();
  n = 0;
  addProgramme('c1', 'Mercyhurst');
  addProgramme('c2', 'Mercyhurst', 'womens-soccer');
  addProgramme('c3', 'Albright');
  addAthlete('p1', { name: 'Rhys Davies' });
  addAthlete('p2', { name: 'Shaan Anad', position: 'Forward' });
  addAthlete('qa-fixture-womens-soccer-0001', {
    name: 'QA Fixture (women’s soccer)', sport: 'womens-soccer', archived: now,
  });
  for (const f of fs.readdirSync(STORE_ROOT, { withFileTypes: true }).filter((e) => e.isFile())) {
    fs.rmSync(path.join(STORE_ROOT, f.name), { force: true });
  }
});

describe('the delivery surface does not alter the report', () => {
  for (const [who, prog] of [['Rhys Davies', 'Mercyhurst'], ['Shaan Anad', 'Mercyhurst'],
    ['Rhys Davies', 'Albright']]) {
    it(`renders ${who} × ${prog} identically through both paths`, async () => {
      const a = athlete(who);
      const c = college(prog);
      expect(a && c).toBeTruthy();

      // A — the path the existing endpoint takes.
      const model = programReportModel({ collegeId: c.id, playerId: a.id });
      const direct = await renderProgramReport(model);

      // B — the delivery service.
      const row = await generateReport({ athleteId: a.id, collegeId: c.id });
      const { bytes: viaDelivery, filename } = readArtifact(row.id);

      expect(pages(viaDelivery)).toBe(pages(direct));
      expect(pages(viaDelivery)).toBeGreaterThan(5);
      expect(pdfUnicodeText(viaDelivery)).toBe(pdfUnicodeText(direct));
      // Every content stream, byte for byte. The only thing 13I found
      // non-deterministic in a PDF is the creation timestamp and the /ID
      // derived from it, neither of which is in a content stream.
      expect(streams(viaDelivery)).toBe(streams(direct));
      // And the name is the frozen helper's, not one delivery invented.
      expect(filename).toBe(reportFilename(model));
      expect(row.filename).toBe(reportFilename(model));
      expect(row.pages).toBe(pages(direct));
    });
  }

  it('renders a programme report through the same boundary', async () => {
    const c = college('Mercyhurst');
    const direct = await renderProgramReport(programReportModel({ collegeId: c.id }));
    const row = await generateReport({ collegeId: c.id });
    const { bytes } = readArtifact(row.id);
    expect(row.reportType).toBe('programme');
    expect(row.athlete).toBeNull();
    expect(streams(bytes)).toBe(streams(direct));
    expect(row.filename).toBe('Thriv3_Programme_Intelligence_Mercyhurst_Mens_Soccer.pdf');
  });
});

describe('an artefact is immutable', () => {
  /**
   * The product reason: rosters are re-imported and minutes are projected
   * forward, so the same two ids do not name the same document in March and in
   * June. A report that was sent has to stay the file that was sent.
   */
  it('writes a new artefact on every generation, and keeps the old one', async () => {
    const a = athlete('Rhys Davies');
    const c = college('Albright');
    const first = await generateReport({ athleteId: a.id, collegeId: c.id });
    const second = await generateReport({ athleteId: a.id, collegeId: c.id });

    expect(second.id).not.toBe(first.id);
    // The DISPLAY name repeats — it is canonical — and the files do not.
    expect(second.filename).toBe(first.filename);
    expect(fs.existsSync(path.join(STORE_ROOT, `${first.id}.pdf`))).toBe(true);
    expect(fs.existsSync(path.join(STORE_ROOT, `${second.id}.pdf`))).toBe(true);
    expect(readArtifact(first.id).bytes.length).toBeGreaterThan(0);

    const history = listReports({ athleteId: a.id });
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe(second.id);   // newest first
  });

  it('records both hashes and the engine that produced it', async () => {
    const c = college('Albright');
    const row = await generateReport({ collegeId: c.id });
    const { bytes } = readArtifact(row.id);
    const full = db.prepare(
      'SELECT sha256, content_sha256, engine_sha FROM generated_reports WHERE id = ?').get(row.id);
    // The file hash verifies the artefact as stored.
    expect(full.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    // The fingerprint an operator sees is the CONTENT hash, which is the one
    // that is stable across generations.
    expect(row.fingerprint).toBe(full.content_sha256.slice(0, 12));
    expect(full.content_sha256).not.toBe(full.sha256);
    // Provenance is internal: a short form on the row, and never in the PDF.
    expect(full.engine_sha).toBe(engineVersion());
    expect(pdfUnicodeText(bytes)).not.toContain(String(full.engine_sha ?? 'no-sha'));
  });

  it('answers the six questions an operator has about a sent report', async () => {
    const a = athlete('Rhys Davies');
    const c = college('Mercyhurst');
    const row = await generateReport({ athleteId: a.id, collegeId: c.id });
    for (const key of ['generatedAt', 'athlete', 'programme', 'reportType', 'filename', 'engine']) {
      expect(row[key], key).toBeTruthy();
    }
  });
});

describe('the pairing guard', () => {
  it('refuses an athlete against a programme in another sport', async () => {
    const a = athlete('Rhys Davies');           // men's soccer
    const c = college('Mercyhurst', 'womens-soccer');
    await expect(generateReport({ athleteId: a.id, collegeId: c.id })).rejects.toThrow(/plays men’s soccer/);
    // And nothing is recorded for a refusal the surface caught before rendering.
    expect(listReports({ athleteId: a.id })).toHaveLength(0);
  });

  it('says which sport each side is, in the operator’s words', () => {
    const msg = checkPair({
      athlete: { full_name: 'A Player', sport: 'mens-soccer' },
      college: { name: 'Somewhere', sport: 'womens-soccer' },
    });
    expect(msg).toMatch(/A Player plays men’s soccer/);
    expect(msg).toMatch(/Somewhere is a women’s soccer programme/);
  });

  it('offers only programmes in the athlete’s own sport', () => {
    const mens = selectableProgrammes({ query: 'Mercyhurst', sport: 'mens-soccer' });
    expect(mens.length).toBeGreaterThan(0);
    expect(mens.every((p) => p.sportKey === 'mens-soccer')).toBe(true);
    // Unscoped, the same name returns both, which is why the picker scopes it.
    expect(selectableProgrammes({ query: 'Mercyhurst' })).toHaveLength(2);
  });

  it('tells two programmes of one name apart', () => {
    const both = selectableProgrammes({ query: 'Mercyhurst' });
    for (const p of both) expect(p.division || p.state).toBeTruthy();
  });
});

describe('failure is recorded, and never as success', () => {
  it('refuses an unknown athlete and an unknown programme', async () => {
    const c = college('Albright');
    await expect(generateReport({ athleteId: 'no-such-athlete', collegeId: c.id }))
      .rejects.toThrow(/not on file/);
    await expect(generateReport({ collegeId: 'no-such-college' })).rejects.toThrow(/not on file/);
  });

  /**
   * ATOMICITY. The artefact is written before the row, so a store that cannot
   * be written to must produce a `failed` row and no success — the case that
   * would otherwise leave the history claiming a file exists.
   */
  it('records a failed row when the artefact cannot be persisted', async () => {
    const c = college('Albright');
    const readonly = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-ro-'));
    fs.chmodSync(readonly, 0o500);
    const saved = process.env.THRIV3_REPORT_STORE;
    try {
      // The module resolved STORE_ROOT at import, so reach the same failure by
      // making the resolved directory unwritable instead.
      fs.mkdirSync(STORE_ROOT, { recursive: true });
      fs.chmodSync(STORE_ROOT, 0o500);
      await expect(generateReport({ collegeId: c.id })).rejects.toThrow();
      const rows = db.prepare('SELECT * FROM generated_reports').all();
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('failed');
      expect(rows[0].artifact_path).toBeNull();
      expect(rows[0].sha256).toBeNull();
      // The operator gets a sentence, not a stack or a path.
      expect(rows[0].error).toMatch(/could not be written to|no space left/);
      expect(rows[0].error).not.toMatch(/\/(Users|private|tmp)\/|at Object|Error:/);
    } finally {
      fs.chmodSync(STORE_ROOT, 0o700);
      fs.chmodSync(readonly, 0o700);
      fs.rmSync(readonly, { recursive: true, force: true });
      process.env.THRIV3_REPORT_STORE = saved;
    }
  });

  it('reports a missing artefact rather than a broken download', async () => {
    const c = college('Albright');
    const row = await generateReport({ collegeId: c.id });
    fs.unlinkSync(path.join(STORE_ROOT, `${row.id}.pdf`));
    expect(() => readArtifact(row.id)).toThrow(/file is missing from the store/);
  });

  it('will not serve an artefact for a failed generation', () => {
    db.prepare(`INSERT INTO generated_reports
      (id, report_type, college_id, sport, filename, status, generated_at)
      VALUES ('aaaaaaaaaaaaaaaaaaaaaaaa','programme','x','mens-soccer','x.pdf','failed','now')`).run();
    expect(() => readArtifact('aaaaaaaaaaaaaaaaaaaaaaaa')).toThrow(/did not produce a report/);
  });
});

describe('the download route cannot be steered', () => {
  /** Two guards for one property: the id shape, and the resolved path. */
  it('rejects anything that is not a generation id', () => {
    for (const bad of ['../../../etc/passwd', '..%2f..%2fetc', 'a'.repeat(24) + '/x',
      '', null, undefined, '../server/data/recruitmatch.sqlite', 'ABCDEF012345678901234567',
      '0123456789abcdef0123456', '0123456789abcdef012345678']) {
      expect(() => readArtifact(bad), String(bad)).toThrow(/not valid|not on file/);
    }
  });

  it('rejects a row whose stored path points outside the store', () => {
    const id = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    db.prepare(`INSERT INTO generated_reports
      (id, report_type, college_id, sport, filename, artifact_path, status, generated_at)
      VALUES (?, 'programme','x','mens-soccer','x.pdf','../../../../etc/passwd','generated','now')`).run(id);
    expect(() => readArtifact(id)).toThrow(/not valid/);
  });
});

describe('the QA fixture stays out of the operator surface', () => {
  const QA = 'qa-fixture-womens-soccer-0001';

  it('is on file, archived, and absent from the athlete picker', () => {
    const row = db.prepare('SELECT archived_at, published_at, public_slug FROM players WHERE id = ?').get(QA);
    expect(row).toBeTruthy();
    expect(row.archived_at).toBeTruthy();
    expect(row.published_at).toBeNull();
    expect(row.public_slug).toBeNull();
    expect(selectableAthletes({ limit: 100 }).some((a) => a.id === QA)).toBe(false);
    expect(selectableAthletes({ query: 'QA', limit: 100 })).toHaveLength(0);
    expect(selectableAthletes({ query: 'Fixture', limit: 100 })).toHaveLength(0);
  });

  it('is absent from the report history', async () => {
    // Even addressed explicitly — which only a test does — its rows are its own
    // and never appear under another athlete or in the unscoped list of one.
    const c = college('Mercyhurst', 'womens-soccer');
    await generateReport({ athleteId: QA, collegeId: c.id });
    const rhys = athlete('Rhys Davies');
    expect(listReports({ athleteId: rhys.id }).some((r) => r.athlete?.includes('QA'))).toBe(false);
  });
});

describe('what the operator surface exposes', () => {
  it('shows enough to identify an athlete and no more', () => {
    const rows = selectableAthletes({ limit: 100 });
    expect(rows.length).toBeGreaterThan(0);
    for (const a of rows) {
      expect(Object.keys(a).sort()).toEqual(
        ['entryYear', 'id', 'name', 'position', 'published', 'sport', 'sportKey']);
    }
  });

  it('leaks no path, no raw column and no model internals in a history row', async () => {
    const c = college('Albright');
    const row = await generateReport({ collegeId: c.id });
    const json = JSON.stringify(row);
    expect(json).not.toMatch(/\/Users\/|\/private\/|\.sqlite|node_modules/);
    expect(json).not.toMatch(/artifact_path|athlete_id|college_id|sha256"/);
    // Neither full hash is surfaced; only a twelve-character fingerprint.
    const full = db.prepare(
      'SELECT sha256, content_sha256 FROM generated_reports WHERE id = ?').get(row.id);
    expect(json).not.toContain(full.sha256);
    expect(json).not.toContain(full.content_sha256);
  });

  it('presents a row without ever inventing a filename', () => {
    const presented = presentReport({
      id: 'x', report_type: 'athlete', athlete_name: 'A', college_name: 'B',
      sport: 'womens-soccer', filename: 'given.pdf', page_count: 3, byte_size: 9,
      sha256: 'ffffffffffffffff', content_sha256: 'abc123def456789',
      engine_sha: '0123456789', status: 'generated',
      error: null, generated_at: 'now',
    });
    expect(presented.filename).toBe('given.pdf');
    expect(presented.sport).toBe('Women’s soccer');
    expect(presented.fingerprint).toBe('abc123def456');
    expect(presented.engine).toBe('0123456');
  });
});

describe('one way to produce a client PDF — Phase 13K / §34', () => {
  /**
   * A MECHANICAL CHECK, not a remembered rule.
   *
   * Until 13K the Program Philosophy tab called the report endpoint directly
   * and handed over a PDF that nothing recorded, while the Reports tab
   * produced an immutable artefact with a history row, a fingerprint and an
   * operator against it. Two buttons that both say "report" and mean
   * different things is how the wrong file gets sent — and how "which document
   * did we send in March" stops having an answer.
   *
   * The endpoints themselves are untouched and remain the regression path.
   * What this holds is that no client surface reaches them.
   */
  const clientSource = () => {
    const root = path.resolve(import.meta.dirname, '../../src');
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.jsx?$/.test(entry.name) && !entry.name.endsWith('.test.js')) {
          files.push([full, fs.readFileSync(full, 'utf8')]);
        }
      }
    };
    walk(root);
    return files;
  };

  it('no client surface calls the direct, unrecorded report endpoint', () => {
    const offenders = clientSource()
      // The API client is where the endpoint is DEFINED; it is not a caller,
      // and the definition stays because tests and internal use need it.
      .filter(([file]) => !file.endsWith(path.join('src', 'api', 'client.js')))
      .filter(([, code]) => /philosophy\.report\s*\(/.test(code) || /report\.pdf/.test(code))
      .map(([file]) => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it('the Program Philosophy row navigates to the recorded flow instead', () => {
    const [, code] = clientSource()
      .find(([file]) => file.endsWith('PhilosophyRow.jsx'));
    // One click either way, and the result is always a document the system
    // remembers.
    expect(code).toMatch(/\/reports\?collegeId=/);
    expect(code).not.toMatch(/downloadBlob/);
  });

  it('the Reports tab is the only place a generation is triggered', () => {
    const callers = clientSource()
      .filter(([, code]) => /reports\.generate\s*\(/.test(code))
      .map(([file]) => path.basename(file));
    expect(callers).toEqual(['ReportsTab.jsx']);
  });
});

describe('who generated it — Phase 13K', () => {
  it('records the signed-in operator, and shows the address rather than the id', async () => {
    const c = college('Albright');
    const row = await generateReport({
      collegeId: c.id,
      operator: { id: 'user-1', email: 'operator@example.com' },
    });
    expect(row.operator).toBe('operator@example.com');

    const stored = db.prepare(
      'SELECT generated_by, generated_by_email FROM generated_reports WHERE id = ?').get(row.id);
    expect(stored.generated_by).toBe('user-1');
    expect(stored.generated_by_email).toBe('operator@example.com');
    // The id stays internal: an operator screen shows a person, not a UUID.
    expect(JSON.stringify(row)).not.toContain('user-1');
  });

  it('is attribution only — the artefact is byte-identical either way', async () => {
    const c = college('Albright');
    const anonymous = await generateReport({ collegeId: c.id });
    const attributed = await generateReport({
      collegeId: c.id, operator: { id: 'user-1', email: 'operator@example.com' },
    });
    // Same reading, same ink. Provenance changes the history row and nothing
    // about the document, and it is never drawn in the PDF.
    expect(attributed.fingerprint).toBe(anonymous.fingerprint);
    const bytes = readArtifact(attributed.id).bytes.toString('latin1');
    expect(bytes).not.toContain('operator@example.com');
    expect(bytes).not.toContain('user-1');
  });

  it('leaves prior rows readable with no operator at all', async () => {
    const c = college('Albright');
    const row = await generateReport({ collegeId: c.id });
    // Every row written before there were accounts carries null. Those
    // artefacts were still generated and are still valid, so the screen shows
    // no attribution rather than an error.
    expect(row.operator).toBeNull();
    expect(listReports({ collegeId: c.id })[0].operator).toBeNull();
    expect(readArtifact(row.id).bytes.length).toBeGreaterThan(0);
  });

  it('takes the operator from the session, never from the request', async () => {
    const c = college('Albright');
    // `generateReport` has no path by which a caller-supplied name could reach
    // the column other than the object the route builds from `req.operator`.
    const row = await generateReport({ collegeId: c.id, operator: null });
    expect(row.operator).toBeNull();
  });
});

describe('a programme reached by link is still subject to the picker\'s rules', () => {
  it('resolves one programme by id', () => {
    const c = college('Albright');
    const row = selectableProgramme({ id: c.id, sport: 'mens-soccer' });
    expect(row.name).toBe('Albright');
    expect(row.sportKey).toBe('mens-soccer');
    // The same shape the search returns, so the screen cannot tell them apart.
    expect(Object.keys(row).sort())
      .toEqual(Object.keys(selectableProgrammes({ q: 'Albright' })[0] ?? row).sort());
  });

  it('returns nothing for the wrong sport, an unknown id or no id', () => {
    const c = college('Albright');
    // A link is not a way around a guard: the Program Philosophy tab hands
    // this a college id, and it goes through the same sport and active filters
    // a hand-picked programme does.
    expect(selectableProgramme({ id: c.id, sport: 'womens-soccer' })).toBeNull();
    expect(selectableProgramme({ id: 'no-such-college', sport: 'mens-soccer' })).toBeNull();
    expect(selectableProgramme({ id: null })).toBeNull();
    expect(selectableProgramme({})).toBeNull();
  });

  it('returns nothing for an inactive programme', () => {
    const c = college('Albright');
    db.prepare('UPDATE colleges SET active = 0 WHERE id = ?').run(c.id);
    try {
      expect(selectableProgramme({ id: c.id })).toBeNull();
    } finally {
      db.prepare('UPDATE colleges SET active = 1 WHERE id = ?').run(c.id);
    }
  });
});

describe('two generations at once', () => {
  /**
   * The store key is the generation id, so concurrent requests for one pair
   * cannot land on the same file. Both must succeed and both must be readable.
   */
  it('produces two valid immutable artefacts', async () => {
    const a = athlete('Rhys Davies');
    const c = college('Albright');
    const [one, two] = await Promise.all([
      generateReport({ athleteId: a.id, collegeId: c.id }),
      generateReport({ athleteId: a.id, collegeId: c.id }),
    ]);
    expect(one.id).not.toBe(two.id);
    expect(readArtifact(one.id).bytes.length).toBeGreaterThan(0);
    expect(readArtifact(two.id).bytes.length).toBeGreaterThan(0);
    /**
     * THE FILES DIFFER AND THE DOCUMENTS DO NOT — and this test is what found
     * it. Every PDF embeds its own creation timestamp and an /ID derived from
     * it, so two simultaneous generations of identical data are two different
     * files. The whole-file hash therefore cannot detect a duplicate; the
     * content hash can, and that is why both are stored and why the operator
     * is shown the second.
     */
    const hashes = db.prepare(
      'SELECT sha256, content_sha256 FROM generated_reports WHERE id IN (?, ?)').all(one.id, two.id);
    expect(hashes[0].sha256).not.toBe(hashes[1].sha256);
    expect(hashes[0].content_sha256).toBe(hashes[1].content_sha256);
    expect(one.fingerprint).toBe(two.fingerprint);
    expect(listReports({ athleteId: a.id })).toHaveLength(2);
  });
});

describe('the intelligence data is untouched', () => {
  /**
   * The delivery subsystem may write to `generated_reports` and to its own
   * store. Generating must leave every table the report READS exactly as it
   * was — the read-only contract 13I established, checked from this side.
   */
  it('changes no table the report reads', async () => {
    const TABLES = ['colleges', 'roster_players', 'players', 'coach_seasons', 'programme_seasons',
      'programme_conference_seasons', 'conference_members_official', 'conference_seasons',
      'institution_aliases'];
    const snapshot = () => Object.fromEntries(TABLES.map((t) => [t,
      crypto.createHash('sha256').update(
        db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).join('\n'),
      ).digest('hex')]));
    const before = snapshot();
    const a = athlete('Rhys Davies');
    await generateReport({ athleteId: a.id, collegeId: college('Mercyhurst').id });
    await generateReport({ collegeId: college('Albright').id });
    expect(snapshot()).toEqual(before);
  });
});
