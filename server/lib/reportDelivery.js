/**
 * THE DELIVERY SURFACE — Phase 13J.
 *
 * Everything an operator needs between "which athlete, which programme" and a
 * PDF in their downloads folder, and nothing that touches the report.
 *
 * WHAT THIS IS NOT. It is not a second renderer. It calls
 * `programReportModel` and `renderProgramReport` exactly as the existing
 * endpoints do and names the file with the frozen `reportFilename`. No
 * composition, no section list, no wording and no page geometry lives here,
 * and an equivalence test renders the same pair through both paths and
 * compares the model, the section plan, the page count, the extracted text and
 * every content stream.
 *
 * IMMUTABLE ARTEFACTS. A report sent to a family in March is not the document
 * the same two ids would produce in June: rosters are re-imported, minutes are
 * projected forward, coaches get resolved. 13I proved the renderer is
 * deterministic GIVEN FIXED DATA — the data is not fixed. So a generation
 * writes its bytes to disk under its own generation id and the history row
 * points at them. Regenerating writes a new id, a new file and a new row;
 * nothing is overwritten and nothing is deleted.
 *
 * THE ARTEFACT KEY IS NOT THE FILENAME. The display name is canonical and
 * therefore repeats — two generations of one pair are the same
 * `Thriv3_Rhys_Davies_Mercyhurst_Mens_Soccer.pdf`. On disk they are
 * `<id>.pdf`, so a regeneration cannot land on its predecessor and a download
 * route cannot be talked into reading something else by a crafted name.
 *
 * READ-ONLY WHERE IT MATTERS. This module writes to `generated_reports` and to
 * its own store directory. It writes to no table the report reads, and an
 * invariant checks that generating through it leaves the intelligence tables
 * byte-identical.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { programReportModel } from '../routes/philosophy.js';
import { renderProgramReport, reportFilename } from './philosophyReport.js';
import { utcNow } from './time.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where artefacts live: one application-owned directory, gitignored, outside
 * the source tree's reach. `THRIV3_REPORT_STORE` moves it for a deployment
 * that mounts a volume somewhere else.
 */
export const STORE_ROOT = process.env.THRIV3_REPORT_STORE
  || path.resolve(HERE, '..', 'reports');

export const REPORT_TYPES = Object.freeze({ ATHLETE: 'athlete', PROGRAMME: 'programme' });
export const STATUS = Object.freeze({ GENERATED: 'generated', FAILED: 'failed' });

/**
 * The engine that produced an artefact, resolved once.
 *
 * INTERNAL PROVENANCE ONLY. It is never drawn in the PDF and never returned to
 * a client-facing surface; it is how an operator answers "which frozen engine
 * made the file we sent in March". Read from git at first use, because a
 * deployment may be a checkout without a working tree — where it cannot be
 * read the column is null rather than a guess.
 */
let engineSha;
export function engineVersion() {
  if (engineSha !== undefined) return engineSha;
  try {
    engineSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).trim()
      || null;
  } catch { engineSha = null; }
  return engineSha;
}

const insert = db.prepare(`INSERT INTO generated_reports
  (id, report_type, athlete_id, college_id, sport, athlete_name, college_name,
   filename, artifact_path, page_count, byte_size, sha256, content_sha256, engine_sha,
   generated_by, generated_by_email, status, error, generated_at)
  VALUES (@id, @report_type, @athlete_id, @college_id, @sport, @athlete_name, @college_name,
   @filename, @artifact_path, @page_count, @byte_size, @sha256, @content_sha256, @engine_sha,
   @generated_by, @generated_by_email, @status, @error, @generated_at)`);

/**
 * A generation id, and therefore an artefact name.
 *
 * Hex from `randomBytes`, so it cannot contain a path separator, a dot or a
 * `..` — the download route still validates it, but the values it validates
 * are incapable of traversal by construction.
 */
const newId = () => crypto.randomBytes(12).toString('hex');
const ID = /^[0-9a-f]{24}$/;

const pageCountOf = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

/**
 * The ink, hashed — the only hash that can say "this is the same document".
 *
 * A hash of the whole file cannot: pdfkit writes a creation timestamp and an
 * /ID derived from it, so two generations of identical data differ. 13I proved
 * the content streams do NOT, so this is stable across generation and is what
 * distinguishes a genuine duplicate from a second copy of the same reading.
 * The concurrency test is what found this: two simultaneous generations of one
 * pair produced two different whole-file hashes.
 */
const contentHashOf = (buf) => crypto.createHash('sha256')
  .update(Buffer.from(
    [...buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map((m) => m[1]).join(''),
    'latin1',
  ))
  .digest('hex');

/** The operator-facing shape of a history row. Never a path, never an id. */
export function presentReport(row) {
  return {
    id: row.id,
    reportType: row.report_type,
    athlete: row.athlete_name,
    programme: row.college_name,
    sport: row.sport === 'womens-soccer' ? 'Women’s soccer' : 'Men’s soccer',
    filename: row.filename,
    pages: row.page_count,
    bytes: row.byte_size,
    status: row.status,
    error: row.error,
    generatedAt: row.generated_at,
    /**
     * What the operator sees to tell two generations apart — and to see that
     * two ARE the same document. The content hash, never the file hash: the
     * file hash changes every generation because of the embedded timestamp,
     * so showing it would say "different" about two identical readings.
     */
    fingerprint: row.content_sha256 ? row.content_sha256.slice(0, 12) : null,
    engine: row.engine_sha ? row.engine_sha.slice(0, 7) : null,
    /**
     * Who generated it — 13K / §32. Internal: it answers "who made the
     * document we sent" for an operator reading their own history, and it is
     * never drawn in the PDF, never in its metadata and never on any
     * client-facing surface. Null for every row written before there were
     * accounts, which the screen shows as no attribution rather than as an
     * error: those artefacts were still generated and are still valid.
     */
    operator: row.generated_by_email ?? null,
  };
}

/**
 * The one refusal an operator can cause: an athlete generated against a
 * programme in another sport.
 *
 * The report engine refuses this too, with " plays " in the message, which the
 * existing endpoint turns into a 400. It is checked here so the delivery
 * surface can say what is wrong in the operator's own words rather than
 * surfacing a model error.
 */
export function checkPair({ athlete, college }) {
  if (!college) return 'That programme is not on file.';
  if (athlete && athlete.sport && college.sport && athlete.sport !== college.sport) {
    const say = (s) => (s === 'womens-soccer' ? 'women’s soccer' : 'men’s soccer');
    return `${athlete.full_name} plays ${say(athlete.sport)} and ${college.name} is a `
      + `${say(college.sport)} programme. A report is only ever read within one sport.`;
  }
  return null;
}

/**
 * Generate one report, persist the artefact, then record it.
 *
 * THE ORDER IS THE ATOMICITY. Render, write the bytes, fsync the directory
 * entry by closing, and only then insert a `generated` row — so a history row
 * claiming success cannot describe a file that is not there. A failure at any
 * step before that records a `failed` row instead, with the operator-facing
 * reason, and removes a partial file if one was made.
 */
export async function generateReport({ athleteId = null, collegeId, operator = null }) {
  const college = collegeId
    ? db.prepare('SELECT id, name, sport, division FROM colleges WHERE id = ?').get(collegeId)
    : null;
  const athlete = athleteId
    ? db.prepare('SELECT id, full_name, sport, position, recruiting_class_year, archived_at '
      + 'FROM players WHERE id = ?').get(athleteId)
    : null;

  if (athleteId && !athlete) throw Object.assign(new Error('That athlete is not on file.'), { status: 404 });
  if (!college) throw Object.assign(new Error('That programme is not on file.'), { status: 404 });
  const mismatch = checkPair({ athlete, college });
  if (mismatch) throw Object.assign(new Error(mismatch), { status: 400 });

  const id = newId();
  const generated_at = utcNow();
  const base = {
    id,
    report_type: athlete ? REPORT_TYPES.ATHLETE : REPORT_TYPES.PROGRAMME,
    athlete_id: athlete?.id ?? null,
    college_id: college.id,
    sport: college.sport,
    athlete_name: athlete?.full_name ?? null,
    college_name: college.name,
    engine_sha: engineVersion(),
    // Attribution, not authorisation: every operator has the same reach in V1,
    // and this changes nothing about what a generation is allowed to do or
    // about the artefact's immutability. The email is denormalised beside the
    // id the way athlete_name and college_name are, so history still reads
    // correctly after an account is removed.
    generated_by: operator?.id ?? null,
    generated_by_email: operator?.email ?? null,
    generated_at,
  };

  let file = null;
  try {
    // THE FROZEN PATH, called exactly as the existing endpoint calls it.
    const model = programReportModel({ collegeId: college.id, playerId: athlete?.id ?? null });
    const buf = await renderProgramReport(model);
    const filename = reportFilename(model);

    fs.mkdirSync(STORE_ROOT, { recursive: true });
    file = path.join(STORE_ROOT, `${id}.pdf`);
    fs.writeFileSync(file, buf);

    const row = {
      ...base,
      filename,
      artifact_path: `${id}.pdf`,
      page_count: pageCountOf(buf),
      byte_size: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      content_sha256: contentHashOf(buf),
      status: STATUS.GENERATED,
      error: null,
    };
    insert.run(row);
    return presentReport(row);
  } catch (err) {
    // A partial artefact is worse than none: it would sit in the store with no
    // row pointing at it and no way to tell it from a good one.
    if (file) { try { fs.unlinkSync(file); } catch { /* nothing written */ } }
    const row = {
      ...base,
      filename: (() => {
        // Best effort, so a failed row is still recognisable in the history.
        try {
          return reportFilename({ college, athlete: athlete ? { name: athlete.full_name } : null });
        } catch { return `${college.name}.pdf`; }
      })(),
      artifact_path: null,
      page_count: null,
      byte_size: null,
      sha256: null,
      content_sha256: null,
      status: STATUS.FAILED,
      // The operator-facing sentence. The stack goes to the server log, not here.
      error: operatorMessage(err),
    };
    try { insert.run(row); } catch (writeErr) {
      // The history write itself failed. Report the original cause, and say
      // that the attempt was not recorded — silence would be worse.
      throw Object.assign(
        new Error(`${row.error} The attempt could not be recorded either.`),
        { status: 500, cause: writeErr },
      );
    }
    throw Object.assign(new Error(row.error), { status: err.status ?? 500, cause: err, recorded: id });
  }
}

/**
 * What an operator is told when generation fails.
 *
 * Never a stack, never a path, never a SQL string. The technical cause is
 * logged by the route; this is the sentence on the screen.
 */
export function operatorMessage(err) {
  const m = String(err?.message ?? '');
  if (/^Unknown college/.test(m)) return 'That programme is not on file.';
  if (/^Unknown player/.test(m)) return 'That athlete is not on file.';
  if (/ plays /.test(m)) return m;
  if (/ENOSPC/.test(m)) return 'There is no space left to save the report.';
  if (/EACCES|EPERM|EROFS/.test(m)) return 'The report store could not be written to.';
  if (/SQLITE_/.test(m)) return 'The report was produced but could not be recorded.';
  return 'The report could not be generated from the data on file.';
}

/** Newest first. Scoped to one athlete, or to one pair. */
export function listReports({ athleteId = null, collegeId = null, limit = 50 } = {}) {
  const where = [];
  const args = [];
  if (athleteId) { where.push('athlete_id = ?'); args.push(athleteId); }
  if (collegeId) { where.push('college_id = ?'); args.push(collegeId); }
  const sql = 'SELECT * FROM generated_reports'
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + ' ORDER BY generated_at DESC, rowid DESC LIMIT ?';
  return db.prepare(sql).all(...args, Math.min(200, Math.max(1, Number(limit) || 50)))
    .map(presentReport);
}

/**
 * One artefact, resolved server-side.
 *
 * The id is validated against the shape `newId` produces before it is joined
 * to anything, and the resolved path is checked to be inside the store — two
 * guards for one property, because a download route that can be steered at an
 * arbitrary file is the worst thing in this module.
 */
export function readArtifact(id) {
  if (!ID.test(String(id ?? ''))) {
    throw Object.assign(new Error('That report reference is not valid.'), { status: 400 });
  }
  const row = db.prepare('SELECT * FROM generated_reports WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('That report is not on file.'), { status: 404 });
  if (row.status !== STATUS.GENERATED || !row.artifact_path) {
    throw Object.assign(new Error('That generation did not produce a report.'), { status: 409 });
  }
  const file = path.resolve(STORE_ROOT, row.artifact_path);
  if (!file.startsWith(path.resolve(STORE_ROOT) + path.sep)) {
    throw Object.assign(new Error('That report reference is not valid.'), { status: 400 });
  }
  let bytes;
  try { bytes = fs.readFileSync(file); } catch {
    throw Object.assign(
      new Error('The report was recorded but its file is missing from the store. Regenerate it.'),
      { status: 410 },
    );
  }
  return { bytes, filename: row.filename, row: presentReport(row) };
}

/**
 * The athletes an operator may generate for.
 *
 * ARCHIVED RECORDS ARE EXCLUDED, which is what keeps the seeded women's-soccer
 * QA fixture out of the picker, out of generation and out of the history — it
 * is archived, and 13I added an invariant holding it that way. A test names
 * the fixture id explicitly.
 */
export function selectableAthletes({ query = '', limit = 25 } = {}) {
  const q = String(query ?? '').trim();
  const rows = db.prepare(`SELECT id, full_name, sport, position, recruiting_class_year,
      published_at FROM players
    WHERE archived_at IS NULL ${q ? 'AND full_name LIKE ?' : ''}
    ORDER BY full_name LIMIT ?`)
    .all(...(q ? [`%${q}%`] : []), Math.min(100, Math.max(1, Number(limit) || 25)));
  return rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    sport: r.sport === 'womens-soccer' ? 'Women’s soccer' : 'Men’s soccer',
    sportKey: r.sport,
    position: r.position,
    entryYear: r.recruiting_class_year,
    published: Boolean(r.published_at),
  }));
}

/**
 * The programmes an operator may generate against.
 *
 * Scoped to one sport where the caller knows it, because the pairing guard
 * would refuse the others anyway and offering them is how the wrong report
 * gets made. Division is shown so two programmes of one name are told apart.
 */
/**
 * ONE programme, subject to the same rules as the picker — 13K / §34.
 *
 * The Program Philosophy tab links here with a college id, so a programme can
 * reach the delivery screen without being chosen from the list. It goes
 * through the same `active = 1` and sport filters, and returns nothing rather
 * than something unselectable: a link is not a way around a guard.
 */
export function selectableProgramme({ id, sport = null } = {}) {
  if (!id) return null;
  const clauses = ['id = ?', 'active = 1'];
  const args = [id];
  if (sport) { clauses.push('sport = ?'); args.push(sport); }
  const row = db.prepare(`SELECT id, name, sport, division, conference, state FROM colleges
      WHERE ${clauses.join(' AND ')}`).get(...args);
  return row ? presentProgramme(row) : null;
}

export function selectableProgrammes({ query = '', sport = null, limit = 25 } = {}) {
  const q = String(query ?? '').trim();
  const clauses = ['active = 1'];
  const args = [];
  if (sport) { clauses.push('sport = ?'); args.push(sport); }
  if (q) { clauses.push('name LIKE ?'); args.push(`%${q}%`); }
  return db.prepare(`SELECT id, name, sport, division, conference, state FROM colleges
      WHERE ${clauses.join(' AND ')} ORDER BY name LIMIT ?`)
    .all(...args, Math.min(100, Math.max(1, Number(limit) || 25)))
    .map(presentProgramme);
}

function presentProgramme(r) {
  return {
    id: r.id,
    name: r.name,
    sport: r.sport === 'womens-soccer' ? 'Women’s soccer' : 'Men’s soccer',
    sportKey: r.sport,
    division: r.division,
    conference: r.conference,
    state: r.state,
  };
}
